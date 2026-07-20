import { DEFAULT_CHUNK_SIZE, blockDef } from "/chunk.js/play.js";
import {
  deriveSmeltingMaterialProperties,
  smeltingMaterialById,
  smeltingMaterialIdForItemCode,
} from "/src/data/smeltingRules.js";
import { loadPlayChainModule } from "./play-chain-adapter.js";

const CHAIN_BACKPACK_SYNC_INTERVAL_MS = 14_000;
const MUTATION_REFRESH_DELAYS_MS = Object.freeze([0, 180, 500, 1_200]);
const CHAIN_BACKPACK_SOURCE = "chain";
const CHAIN_ITEM_CATEGORY_MATERIAL = 1;
const CHAIN_ITEM_CATEGORY_FORGED = 2;
const CHAIN_ITEM_CATEGORY_BLUEPRINT = 3;
const CHAIN_FORGED_ITEM_CODE = 8;
const CHAIN_BLUEPRINT_ITEM_CODE = 9;

export function createPlayChainBackpackSync({
  gameState,
  getWalletAddress = () => "",
  onChanged = () => {},
  onStatus = () => {},
  appendEvent = () => {},
  chunkSize = DEFAULT_CHUNK_SIZE,
  resolveSurfaceDecoration = null,
} = {}) {
  const state = {
    loading: false,
    walletAddress: "",
    lastSyncAt: 0,
    lastError: "",
    backpackAddress: "",
    capacity: 0,
    itemCount: 0,
    updatedSlot: "0",
    syncedSlots: 0,
    available: false,
    statusKnown: false,
  };
  let requestSerial = 0;
  let loadedBackpack = null;

  return {
    refresh,
    refreshAfterMutation,
    refreshDecorationIdentity,
    discardSlots,
    snapshot,
  };

  function snapshot() {
    return { ...state };
  }

  async function refresh({ force = false, quiet = true } = {}) {
    const wallet = String(getWalletAddress() || "");
    if (!wallet) {
      requestSerial += 1;
      state.loading = false;
      state.walletAddress = "";
      state.backpackAddress = "";
      state.capacity = 0;
      state.itemCount = 0;
      state.updatedSlot = "0";
      state.syncedSlots = 0;
      state.lastError = "wallet-unavailable";
      loadedBackpack = null;
      const availability = setAvailability(false, true);
      const cleared = gameState?.clearBackpackSlots?.();
      if (cleared?.changed || availability.changed) onChanged();
      return { ok: false, reason: "wallet-unavailable", changed: Boolean(cleared?.changed || availability.changed) };
    }
    const walletChanged = state.walletAddress !== wallet;
    if (walletChanged) {
      requestSerial += 1;
      state.loading = false;
      state.walletAddress = wallet;
      state.backpackAddress = "";
      state.capacity = 0;
      state.itemCount = 0;
      state.updatedSlot = "0";
      state.syncedSlots = 0;
      state.lastSyncAt = 0;
      loadedBackpack = null;
      const availability = setAvailability(false, false);
      const cleared = gameState?.clearBackpackSlots?.();
      if (cleared?.changed || availability.changed) onChanged();
    }
    const now = performance.now();
    if (state.loading) return { ok: false, reason: "already-loading" };
    if (!force && now - state.lastSyncAt < CHAIN_BACKPACK_SYNC_INTERVAL_MS) return { ok: false, reason: "cooldown" };
    const requestId = ++requestSerial;
    state.loading = true;
    try {
      const module = await loadPlayChainModule();
      if (!isCurrentRequest(requestId, wallet)) return { ok: false, reason: "stale-wallet-request" };
      if (typeof module.getEquippedBackpackStatus !== "function") return fail("backpack-status-unavailable", quiet);
      const status = await module.getEquippedBackpackStatus({ prompt: false });
      if (!isCurrentRequest(requestId, wallet)) return { ok: false, reason: "stale-wallet-request" };
      if (!status?.equipped || !status.backpack?.publicKey) {
        state.backpackAddress = "";
        state.capacity = 0;
        state.itemCount = 0;
        state.updatedSlot = "0";
        state.syncedSlots = 0;
        state.lastError = "no-equipped-backpack";
        loadedBackpack = null;
        state.lastSyncAt = performance.now();
        const availability = setAvailability(false, true);
        const cleared = gameState?.clearBackpackSlots?.();
        if (cleared?.changed || availability.changed) onChanged();
        if (!quiet) appendEvent("No equipped chain backpack found for this wallet.");
        return { ok: false, reason: "no-equipped-backpack", changed: Boolean(cleared?.changed || availability.changed) };
      }
      const backpack = await loadBackpack(module, status.backpack);
      if (!isCurrentRequest(requestId, wallet)) return { ok: false, reason: "stale-wallet-request" };
      const applied = applyBackpack(backpack, status.backpack.publicKey);
      if (!quiet) onStatus(`Synced chain backpack PDA: ${applied.chainSlots.length}/${state.capacity || 50} slots.`);
      return { ok: true, backpack, ...applied };
    } catch (error) {
      if (!isCurrentRequest(requestId, wallet)) return { ok: false, reason: "stale-wallet-request" };
      return fail(readableError(error), quiet);
    } finally {
      if (requestId === requestSerial) state.loading = false;
    }
  }

  async function refreshAfterMutation({ previousUpdatedSlot = "", minimumItemCount = null } = {}) {
    const wallet = String(getWalletAddress() || "");
    const backpackAddress = state.backpackAddress;
    if (!wallet || !backpackAddress) return refresh({ force: true, quiet: true });
    const previousSlot = parseSlot(previousUpdatedSlot);
    const minimumCount = Number.isFinite(Number(minimumItemCount)) ? Math.max(0, Math.trunc(Number(minimumItemCount))) : null;
    let lastResult = null;
    for (const delay of MUTATION_REFRESH_DELAYS_MS) {
      if (delay) await sleep(delay);
      if (wallet !== String(getWalletAddress() || "") || backpackAddress !== state.backpackAddress) {
        return { ok: false, reason: "stale-wallet-request" };
      }
      if (state.loading) continue;
      lastResult = await refreshKnownBackpack(wallet, backpackAddress);
      if (!lastResult?.ok) continue;
      const visibleSlot = parseSlot(lastResult.backpack?.updatedSlot);
      const slotAdvanced = previousSlot === null || (visibleSlot !== null && visibleSlot > previousSlot);
      const countVisible = minimumCount === null || Number(lastResult.backpack?.itemCount) >= minimumCount;
      if (slotAdvanced && countVisible) return lastResult;
    }
    state.lastSyncAt = 0;
    return { ...(lastResult ?? {}), ok: false, reason: "mutation-not-visible-yet", stale: true };
  }

  async function refreshKnownBackpack(wallet, backpackAddress) {
    const requestId = ++requestSerial;
    state.loading = true;
    try {
      const module = await loadPlayChainModule();
      if (typeof module.fetchBackpack !== "function") return { ok: false, reason: "backpack-reader-unavailable" };
      const backpack = await module.fetchBackpack(backpackAddress);
      if (!isCurrentRequest(requestId, wallet)) return { ok: false, reason: "stale-wallet-request" };
      if (!backpack?.publicKey || String(backpack.owner || "") !== wallet) {
        return { ok: false, reason: "backpack-owner-mismatch" };
      }
      const applied = applyBackpack(backpack, backpackAddress);
      return { ok: true, backpack, ...applied };
    } catch (error) {
      state.lastError = readableError(error);
      return { ok: false, reason: state.lastError };
    } finally {
      if (requestId === requestSerial) state.loading = false;
    }
  }

  function applyBackpack(backpack, fallbackAddress = "") {
    loadedBackpack = backpack;
    const chainSlots = chainSlotsFromBackpack(backpack, { chunkSize, resolveSurfaceDecoration });
    const capacity = Math.max(0, Math.trunc(Number(backpack.capacity) || 0));
    const merged = gameState?.mergeChainBackpackSlots?.(chainSlots, {
      source: CHAIN_BACKPACK_SOURCE,
      capacity,
    });
    state.backpackAddress = String(backpack.publicKey || fallbackAddress || "");
    state.capacity = capacity;
    state.itemCount = Math.max(0, Math.trunc(Number(backpack.itemCount) || 0));
    state.updatedSlot = String(backpack.updatedSlot ?? "0");
    state.syncedSlots = chainSlots.length;
    state.lastError = "";
    state.lastSyncAt = performance.now();
    const availability = setAvailability(true, true);
    if (merged?.changed || availability.changed) onChanged();
    return { chainSlots, changed: Boolean(merged?.changed || availability.changed) };
  }

  function isCurrentRequest(requestId, wallet) {
    return requestId === requestSerial && wallet === String(getWalletAddress() || "") && wallet === state.walletAddress;
  }

  function refreshDecorationIdentity() {
    if (!loadedBackpack) return { ok: false, reason: "backpack-not-loaded" };
    const chainSlots = chainSlotsFromBackpack(loadedBackpack, { chunkSize, resolveSurfaceDecoration });
    const merged = gameState?.mergeChainBackpackSlots?.(chainSlots, {
      source: CHAIN_BACKPACK_SOURCE,
      capacity: state.capacity,
    });
    if (merged?.changed) onChanged();
    return { ok: true, changed: Boolean(merged?.changed), chainSlots };
  }

  function fail(reason, quiet) {
    state.lastError = reason;
    state.lastSyncAt = performance.now();
    const availability = setAvailability(state.available, false);
    if (availability.changed) onChanged();
    if (!quiet) {
      appendEvent(`Chain backpack sync failed: ${reason}.`);
      onStatus(`Chain backpack sync failed: ${reason}.`);
    }
    return { ok: false, reason, changed: availability.changed };
  }

  function setAvailability(available, known) {
    const nextAvailable = available === true;
    const nextKnown = known === true;
    const changed = state.available !== nextAvailable || state.statusKnown !== nextKnown;
    state.available = nextAvailable;
    state.statusKnown = nextKnown;
    const gameStateResult = gameState?.setBackpackAvailability?.(nextAvailable, { known: nextKnown });
    return { changed: Boolean(changed || gameStateResult?.changed), available: nextAvailable, known: nextKnown };
  }

  async function discardSlots(items = [], { quiet = false } = {}) {
    if ((items ?? []).some((item) => isEquippedDiscardItem(item))) {
      return failDiscard("equipped-backpack-item", quiet);
    }
    const normalized = normalizeDiscardItems(items);
    if (!normalized.length) return { ok: false, reason: "no-chain-backpack-slots" };
    const backpackAddress = normalized[0].chainBackpack;
    if (!backpackAddress || normalized.some((item) => item.chainBackpack !== backpackAddress)) {
      return { ok: false, reason: "mixed-chain-backpacks" };
    }
    try {
      const module = await loadPlayChainModule();
      const method = normalized.length === 1 ? "discardBackpackResourceAt" : "discardBackpackResourcesAt";
      if (typeof module[method] !== "function") return failDiscard("discard-unavailable", quiet);
      const result = normalized.length === 1
        ? await module.discardBackpackResourceAt({
            backpackAddress,
            index: normalized[0].chainIndex,
          })
        : await module.discardBackpackResourcesAt({
            backpackAddress,
            indexes: normalized.map((item) => item.chainIndex),
          });
      if (!result?.submitted) return failDiscard(String(result?.reason || "not-submitted"), quiet, result);
      appendEvent(`Backpack discard submitted ${shortSignature(result.signature)} for ${normalized.length} chain slot${normalized.length === 1 ? "" : "s"}.`);
      if (!quiet) onStatus(`Discarded ${normalized.length} chain backpack slot${normalized.length === 1 ? "" : "s"}: ${shortSignature(result.signature)}.`);
      await refresh({ force: true, quiet: true });
      return { ok: true, submitted: true, signature: result.signature, count: normalized.length, result };
    } catch (error) {
      return failDiscard(readableError(error), quiet);
    }
  }

  function failDiscard(reason, quiet, result = null) {
    state.lastError = reason;
    if (!quiet) {
      appendEvent(`Chain backpack discard failed: ${reason}.`);
      onStatus(`Chain backpack discard failed: ${reason}.`);
    }
    return { ok: false, reason, result };
  }

  function isEquippedDiscardItem(item) {
    if (gameState?.isBackpackSlotEquipped?.(item)) return true;
    const chainBackpack = String(item?.chainBackpack || "");
    const chainIndex = Number(item?.chainIndex);
    if (!chainBackpack || !Number.isInteger(chainIndex)) return false;
    const currentSlot = gameState?.backpackSlots?.find((slot) => (
      String(slot?.chainBackpack || "") === chainBackpack
      && Number(slot?.chainIndex) === chainIndex
    ));
    return Boolean(currentSlot && gameState?.isBackpackSlotEquipped?.(currentSlot));
  }
}

async function loadBackpack(module, backpack) {
  if (backpack?.slots?.length || backpack?.records?.length) return backpack;
  if (typeof module.fetchBackpack !== "function") return backpack;
  return await module.fetchBackpack(backpack.publicKey) || backpack;
}

export function chainSlotsFromBackpack(backpack, {
  chunkSize = DEFAULT_CHUNK_SIZE,
  resolveSurfaceDecoration = null,
} = {}) {
  const address = String(backpack?.publicKey || "");
  const owner = String(backpack?.owner || "");
  const rawSlots = Array.isArray(backpack?.slots) ? backpack.slots : [];
  const slots = [];
  for (let index = 0; index < rawSlots.length; index += 1) {
    const slot = rawSlots[index];
    if (!slot) continue;
    if (slot.kind === "item") {
      slots.push(chainItemSlot(slot, index, address, owner));
      continue;
    }
    const resource = slot.resource || slot;
    const blockId = Math.trunc(Number(resource.blockId) || 0);
    if (blockId <= 0) continue;
    const def = blockDef(blockId);
    const worldX = Math.trunc(Number(resource.worldX) || 0);
    const worldY = Math.trunc(Number(resource.worldY) || 0);
    const worldZ = Math.trunc(Number(resource.worldZ) || 0);
    const quantity = Math.max(1, Math.trunc(Number(slot.quantity) || 1));
    const metadata = Math.trunc(Number(slot.metadata) || 0) >>> 0;
    const decoration = resolvedSurfaceDecoration({
      resolver: resolveSurfaceDecoration,
      resource: { worldX, worldY, worldZ, blockId, metadata },
    });
    slots.push({
      id: `chain-${address || "backpack"}-${index}-${worldX},${worldY},${worldZ}`,
      kind: "resource",
      resourceId: def.resourceId,
      blockId,
      count: quantity,
      pending: false,
      pendingTxId: null,
      source: CHAIN_BACKPACK_SOURCE,
      chainBackpack: address,
      chainIndex: index,
      volumeMm3: Math.max(0, Math.trunc(Number(slot.volumeMm3) || 0)),
      volumeMilliLiters: Math.max(0, Math.trunc((Number(slot.volumeMm3) || 0) / 1000)),
      metadata,
      ...decoration,
      proof: {
        worldX,
        worldY,
        worldZ,
        blockId,
        chunkX: Math.floor(worldX / chunkSize),
        chunkZ: Math.floor(worldZ / chunkSize),
        decorationId: decoration.decorationId || 0,
        decorationRuleId: decoration.decorationRuleId || 0,
      },
    });
  }
  return slots;
}

function resolvedSurfaceDecoration({ resolver, resource }) {
  if (typeof resolver === "function") {
    try {
      const resolved = resolver(resource);
      if (Number(resolved?.decorationId) > 0) return normalizeSurfaceDecoration(resolved);
    } catch {
      // Decoration formatting must not prevent the authoritative PDA inventory from loading.
    }
  }
  const metadata = Math.trunc(Number(resource?.metadata) || 0) >>> 0;
  const decorationId = metadata & 0xffff;
  const decorationRuleId = metadata >>> 16;
  return decorationId && decorationRuleId
    ? normalizeSurfaceDecoration({ decorationId, decorationRuleId })
    : {};
}

function normalizeSurfaceDecoration(decoration = {}) {
  return {
    decorationId: Math.max(0, Math.trunc(Number(decoration.decorationId) || 0)),
    decorationRuleId: Math.max(0, Math.trunc(Number(decoration.decorationRuleId ?? decoration.ruleId) || 0)),
    decorationSurfaceBlockId: Math.max(0, Math.trunc(Number(decoration.decorationSurfaceBlockId ?? decoration.surfaceBlockId) || 0)),
    decorationVariant: Math.max(0, Math.trunc(Number(decoration.decorationVariant ?? decoration.variant) || 0)),
    decorationFlags: Math.max(0, Math.trunc(Number(decoration.decorationFlags ?? decoration.flags) || 0)),
    decorationVariantHash: Math.trunc(Number(decoration.decorationVariantHash ?? decoration.variantHash) || 0) >>> 0,
  };
}

function chainItemSlot(slot, index, address, owner) {
  const category = Math.max(0, Math.trunc(Number(slot.category) || 0));
  const itemCode = Math.max(0, Math.trunc(Number(slot.itemCode) || 0));
  const chainItemId = String(slot.itemId || "0");
  const blueprint = category === CHAIN_ITEM_CATEGORY_BLUEPRINT && itemCode === CHAIN_BLUEPRINT_ITEM_CODE;
  if (blueprint) {
    const itemPda = String(slot.itemPda || "");
    return {
      id: `chain-${address || "backpack"}-${index}-blueprint-${chainItemId}`,
      kind: "blueprint",
      itemId: "blueprint_tool",
      label: `Blueprint #${chainItemId}`,
      className: "Blueprint",
      count: 1,
      pending: false,
      pendingTxId: null,
      source: CHAIN_BACKPACK_SOURCE,
      chainBackpack: address,
      chainIndex: index,
      chainItemId,
      itemCode,
      itemPda,
      blueprintId: chainItemId,
      blueprintInstanceId: itemPda ? `blueprint-pda:${itemPda}` : `blueprint:${chainItemId}`,
      blueprintOrdinal: index + 1,
      blueprintOwner: owner,
      locked: false,
      volumeMm3: Math.max(0, Math.trunc(Number(slot.volumeMm3) || 0)),
      metadata: Math.max(0, Math.trunc(Number(slot.metadata) || 0)),
      proofHash: itemPda,
    };
  }
  const forged = category === CHAIN_ITEM_CATEGORY_FORGED || itemCode === CHAIN_FORGED_ITEM_CODE;
  const qualityBps = Math.max(0, Math.trunc(Number(slot.qualityBps) || 0));
  const materialId = forged ? "" : smeltingMaterialIdForItemCode(itemCode) || `material-${itemCode}`;
  const material = forged ? null : smeltingMaterialById(materialId);
  const materialProperties = material
    ? deriveSmeltingMaterialProperties({ material, itemId: chainItemId, itemCode, sourceSeed: `${address}:${index}` })
    : null;
  return {
    id: `chain-${address || "backpack"}-${index}-item-${chainItemId}`,
    kind: forged ? "forged" : "smelted_material",
    itemId: forged ? "forged_item" : "chain_material",
    materialId,
    label: forged ? `Forged Item #${chainItemId}` : material ? humanize(material.id) : `Material ${itemCode}`,
    className: forged ? "Forged" : material ? humanize(material.class) : category === CHAIN_ITEM_CATEGORY_MATERIAL ? "Material" : "Item",
    count: Math.max(1, Math.trunc(Number(slot.quantity) || 1)),
    pending: false,
    pendingTxId: null,
    source: CHAIN_BACKPACK_SOURCE,
    chainBackpack: address,
    chainIndex: index,
    chainItemId,
    itemCode,
    itemPda: String(slot.itemPda || ""),
    volumeMm3: Math.max(0, Math.trunc(Number(slot.volumeMm3) || 0)),
    durabilityCurrent: Math.max(0, Math.trunc(Number(slot.durabilityCurrent) || 0)),
    durabilityMax: Math.max(0, Math.trunc(Number(slot.durabilityMax) || 0)),
    grade: Math.max(0, Math.trunc(Number(slot.grade) || 0)),
    itemLevel: Math.max(0, Math.trunc(Number(slot.itemLevel) || 0)),
    qualityBps,
    quality: Math.max(0, Math.min(100, Math.round(qualityBps / 100))),
    previewColor: materialPreviewColor(material),
    materialProperties,
    metadata: Math.max(0, Math.trunc(Number(slot.metadata) || 0)),
    designHash: chainItemDesignHash(chainItemId, slot.metadata),
    proofHash: String(slot.itemPda || ""),
  };
}

function materialPreviewColor(material) {
  return ({
    carbon: [53, 50, 43],
    fiber: [171, 150, 82],
    polymer: [194, 130, 71],
    ceramic: [195, 136, 83],
    chemical: [191, 217, 183],
    glass: [104, 213, 239],
    crystal: [105, 235, 255],
    metal: [184, 199, 210],
    alloy: [153, 174, 190],
    composite: [82, 166, 151],
  })[material?.class] || [150, 170, 180];
}

function humanize(value) {
  return String(value || "material")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function chainItemDesignHash(_itemId, metadata) {
  // The backpack program stores the verified FNV-1a NCF1 identity directly in
  // forged-slot metadata. Mixing in itemId breaks the local code lookup and
  // makes the same design render differently for every minted instance.
  return Math.trunc(Number(metadata) || 0) >>> 0;
}

function readableError(error) {
  const message = String(error?.message || error || "unknown error");
  return message.length > 140 ? `${message.slice(0, 137)}...` : message;
}

function normalizeDiscardItems(items = []) {
  return (items ?? [])
    .map((item) => ({
      chainBackpack: String(item?.chainBackpack || ""),
      chainIndex: Number(item?.chainIndex),
    }))
    .filter((item) => item.chainBackpack && Number.isInteger(item.chainIndex) && item.chainIndex >= 0 && item.chainIndex <= 98);
}

function shortSignature(signature) {
  const value = String(signature || "");
  return value.length <= 12 ? value : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseSlot(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    const slot = BigInt(value);
    return slot >= 0n ? slot : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
