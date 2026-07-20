export const FORGED_ITEM_ID = "forged_item";
export const LEGACY_HOTBAR_STORAGE_KEY = "nicechunk.hotbar.slots.v1";
export const LEGACY_FORGED_HOTBAR_QUEUE_KEY = "nicechunk.forged.hotbar.queue.v1";
export const WALLET_ADDRESS_STORAGE_KEY = "nicechunk.walletAddress";
export const FORGE_CODE_PREFIX = "NCF1.";

const FORGE_CODE_VERSION = 14;
const FORGE_CODE_MIN_RAW_BYTES = 14;
const FORGE_CODE_MAX_RAW_BYTES = 640;
const FORGE_CODE_MAX_BASE64URL_LENGTH = Math.ceil(FORGE_CODE_MAX_RAW_BYTES * 4 / 3);
const FORGED_DESIGN_ITEM_STORAGE_PREFIX = "nicechunk.forged.design.";
const FORGING_SAVED_CODES_STORAGE_KEY = "nicechunk.forging.savedCodes.v2";
const FORGED_RESERVATION_TTL_MS = 10 * 60 * 1000;
const FORGED_HOTBAR_INDEX_ORDER = [7, 1, 2, 3, 4, 5, 6, 8];

export function normalizeForgedHotbarSlot(slot, { defaultDurability = 999, ownerAddress = null } = {}) {
  if (!slot || typeof slot !== "object" || slot.itemId !== FORGED_ITEM_ID) return null;
  const hydrated = hydrateForgedSlotSource(slot);
  let bytes = forgeCodeToBytesSafe(hydrated);
  let validBytes = Boolean(bytes?.length && isCurrentForgeBytes(bytes));
  const suppliedDesignHash = normalizeDesignHash(hydrated.designHash);
  const decodedDesignHash = validBytes ? forgeDesignHashFromBytes(bytes) : null;
  if (validBytes && suppliedDesignHash !== null && suppliedDesignHash !== decodedDesignHash) {
    bytes = null;
    validBytes = false;
  }
  const designHash = suppliedDesignHash ?? decodedDesignHash;
  if (!validBytes && !isChainForgedReference(hydrated, designHash)) return null;
  const maxDurability = clampInt(
    hydrated.maxDurability ?? hydrated.durabilityMax ?? defaultDurability,
    1,
    0xffffffff,
  );
  return {
    itemId: FORGED_ITEM_ID,
    kind: "forged",
    count: 1,
    bytes: validBytes ? Array.from(bytes) : [],
    byteLength: validBytes ? bytes.length : 0,
    code: validBytes ? forgeBytesToCode(bytes) : "",
    chainItemId: hydrated.chainItemId ?? null,
    itemPda: hydrated.itemPda ?? null,
    designHash,
    backpack: hydrated.backpack ?? null,
    chainBackpack: hydrated.chainBackpack ?? null,
    chainIndex: Number.isInteger(hydrated.chainIndex) ? hydrated.chainIndex : null,
    source: hydrated.source ?? (validBytes ? "local" : "chain"),
    owner: hydrated.owner ?? directOwner(ownerAddress) ?? currentStorageOwner() ?? null,
    sourceItemId: hydrated.sourceItemId ?? hydrated.id ?? null,
    savedAt: Number(hydrated.savedAt) || Date.now(),
    durability: clampInt(hydrated.durability ?? hydrated.durabilityCurrent ?? maxDurability, 0, maxDurability),
    maxDurability,
  };
}

export function hydrateForgedPresentationSlot(slot) {
  if (!slot || typeof slot !== "object"
    || (slot.kind !== "forged" && slot.itemId !== FORGED_ITEM_ID)) return slot;
  const normalized = normalizeForgedHotbarSlot({ ...slot, itemId: FORGED_ITEM_ID });
  if (!normalized?.code || !normalized.bytes.length) return slot;
  return {
    ...slot,
    code: normalized.code,
    bytes: normalized.bytes,
    byteLength: normalized.byteLength,
    designHash: normalized.designHash,
  };
}

export function isForgedHotbarSlot(slot) {
  return Boolean(slot?.itemId === FORGED_ITEM_ID);
}

export function consumeLegacyForgedHotbarItems(hotbarSlots, { defaultDurability = 999, ownerAddress = null } = {}) {
  if (!Array.isArray(hotbarSlots)) return { changed: false, added: 0, addedSlots: [] };
  const seen = currentForgedSignatures(hotbarSlots);
  let changed = false;
  let added = 0;
  const addedSlots = [];

  for (const key of legacyStorageKeys(LEGACY_HOTBAR_STORAGE_KEY, ownerAddress)) {
    const legacySlots = loadJsonArray(key);
    if (!legacySlots) continue;
    for (const slot of legacySlots) {
      if (!legacyEntryMatchesOwner(slot, ownerAddress)) continue;
      const normalized = normalizeForgedHotbarSlot(slot, { defaultDurability, ownerAddress });
      if (!normalized) continue;
      const signature = forgedSlotSignature(normalized);
      if (seen.has(signature)) continue;
      const slotIndex = findForgedHotbarSlot(hotbarSlots);
      if (slotIndex < 0) break;
      hotbarSlots[slotIndex] = normalized;
      seen.add(signature);
      changed = true;
      added += 1;
      addedSlots.push(slotIndex);
    }
  }

  const queueResults = consumeLegacyForgedQueue(hotbarSlots, seen, { defaultDurability, ownerAddress });
  if (queueResults.changed) changed = true;
  added += queueResults.added;
  addedSlots.push(...queueResults.addedSlots);
  return { changed, added, addedSlots };
}

function consumeLegacyForgedQueue(hotbarSlots, seen, { defaultDurability, ownerAddress }) {
  let changed = false;
  let added = 0;
  const addedSlots = [];
  for (const key of legacyStorageKeys(LEGACY_FORGED_HOTBAR_QUEUE_KEY, ownerAddress)) {
    const queue = loadJsonArray(key);
    if (!queue) continue;
    const remaining = [];
    let keyChanged = false;
    for (const entry of queue) {
      if (!legacyEntryMatchesOwner(entry, ownerAddress)) continue;
      if (isActiveReservation(entry)) {
        remaining.push(entry);
        continue;
      }
      const normalized = normalizeForgedHotbarSlot(
        { ...entry, itemId: FORGED_ITEM_ID },
        { defaultDurability, ownerAddress },
      );
      if (!normalized) {
        keyChanged = true;
        continue;
      }
      const signature = forgedSlotSignature(normalized);
      if (seen.has(signature)) {
        keyChanged = true;
        continue;
      }
      const slotIndex = findForgedHotbarSlot(hotbarSlots);
      if (slotIndex < 0) {
        remaining.push(entry);
        continue;
      }
      hotbarSlots[slotIndex] = normalized;
      seen.add(signature);
      keyChanged = true;
      changed = true;
      added += 1;
      addedSlots.push(slotIndex);
    }
    if (keyChanged || remaining.length !== queue.length) saveJsonArray(key, remaining);
  }
  return { changed, added, addedSlots };
}

function isActiveReservation(entry) {
  return entry?.state === "reserved" && Date.now() - Number(entry.reservedAt || 0) < FORGED_RESERVATION_TTL_MS;
}

function currentForgedSignatures(slots) {
  const out = new Set();
  for (const slot of slots) {
    const normalized = normalizeForgedHotbarSlot(slot);
    if (normalized) out.add(forgedSlotSignature(normalized));
  }
  return out;
}

function forgedSlotSignature(slot) {
  if (slot.designHash) return `hash:${slot.designHash >>> 0}`;
  if (slot.code) return `code:${slot.code}`;
  return `bytes:${(slot.bytes || []).join(",")}`;
}

function findForgedHotbarSlot(slots) {
  for (const index of FORGED_HOTBAR_INDEX_ORDER) {
    if (index >= 0 && index < slots.length && !slots[index]) return index;
  }
  return -1;
}

function hydrateForgedSlotSource(slot) {
  if (slot?.code
    || hasByteSource(slot?.bytes)) return slot;
  const designHash = normalizeDesignHash(slot?.designHash);
  if (designHash === null) return slot;
  const key = `${FORGED_DESIGN_ITEM_STORAGE_PREFIX}${designHash.toString(16).padStart(8, "0")}`;
  try {
    const indexed = JSON.parse(localStorage.getItem(key) || "null");
    if (indexed && typeof indexed === "object") {
      return {
        ...indexed,
        ...slot,
        bytes: hasByteSource(slot.bytes) ? slot.bytes : indexed.bytes,
        code: slot.code || indexed.code,
        byteLength: hasByteSource(slot.bytes) || slot.code ? slot.byteLength : indexed.byteLength,
        designHash,
      };
    }
    const savedCode = savedForgeCodeForHash(designHash);
    return savedCode ? { ...slot, code: savedCode, designHash } : slot;
  } catch {
    return slot;
  }
}

function hasByteSource(value) {
  return (Array.isArray(value) || value instanceof Uint8Array) && value.length > 0;
}

function savedForgeCodeForHash(designHash) {
  const saved = loadJsonArray(FORGING_SAVED_CODES_STORAGE_KEY);
  if (!saved) return "";
  for (const code of saved) {
    const bytes = forgeCodeToBytesSafe(code);
    if (bytes?.length && isCurrentForgeBytes(bytes) && forgeDesignHashFromBytes(bytes) === designHash) return forgeBytesToCode(bytes);
  }
  return "";
}

function isChainForgedReference(slot, designHash) {
  return designHash !== null && Boolean(
    slot?.source === "chain"
    || slot?.chainBackpack
    || slot?.itemPda
    || Number.isInteger(slot?.chainIndex),
  );
}

function legacyStorageKeys(baseKey, ownerAddress = null) {
  const owner = currentStorageOwner(ownerAddress);
  return owner ? [`${baseKey}.${owner}`] : [baseKey];
}

function legacyEntryMatchesOwner(entry, ownerAddress) {
  const expectedOwner = directOwner(ownerAddress);
  const entryOwner = directOwner(entry?.owner);
  return !expectedOwner || !entryOwner || entryOwner === expectedOwner;
}

function directOwner(value) {
  const owner = String(value ?? "").trim();
  return owner || null;
}

function currentStorageOwner(ownerAddress = null) {
  const direct = normalizeStorageOwner(ownerAddress);
  if (direct) return direct;
  try {
    return normalizeStorageOwner(localStorage.getItem(WALLET_ADDRESS_STORAGE_KEY));
  } catch {
    return "";
  }
}

function normalizeStorageOwner(value) {
  const owner = String(value ?? "").trim();
  return owner ? owner.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "_") : "";
}

function loadJsonArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveJsonArray(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function forgeCodeToBytesSafe(input) {
  try {
    if (input instanceof Uint8Array) return input.length <= FORGE_CODE_MAX_RAW_BYTES ? new Uint8Array(input) : null;
    if (Array.isArray(input)) return normalizedByteArray(input);
    if (hasByteSource(input?.bytes)) return forgeCodeToBytesSafe(input.bytes);
    if (typeof input?.code === "string") return forgeCodeToBytesSafe(input.code);
    const encoded = String(input || "").startsWith(FORGE_CODE_PREFIX)
      ? String(input).slice(FORGE_CODE_PREFIX.length)
      : String(input || "");
    if (!encoded
      || encoded.length > FORGE_CODE_MAX_BASE64URL_LENGTH
      || !/^[A-Za-z0-9_-]+$/u.test(encoded)) return null;
    const bytes = base64UrlToBytes(encoded);
    if (bytes.length > FORGE_CODE_MAX_RAW_BYTES || bytesToBase64Url(bytes) !== encoded) return null;
    return bytes;
  } catch {
    return null;
  }
}

function normalizedByteArray(values) {
  if (values.length > FORGE_CODE_MAX_RAW_BYTES
    || values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return Uint8Array.from(values);
}

function forgeBytesToCode(bytes) {
  return `${FORGE_CODE_PREFIX}${bytesToBase64Url(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []))}`;
}

function isCurrentForgeBytes(bytes) {
  return bytes.length >= FORGE_CODE_MIN_RAW_BYTES
    && bytes.length <= FORGE_CODE_MAX_RAW_BYTES
    && (bytes[0] >> 4) === FORGE_CODE_VERSION;
}

function base64UrlToBytes(encoded) {
  const text = String(encoded || "").replace(/-/g, "+").replace(/_/g, "/");
  if (!text) return new Uint8Array();
  const padded = text.padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes || []) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function forgeDesignHashFromBytes(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes || []) {
    hash ^= Number(byte) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function normalizeDesignHash(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const normalized = Math.floor(number) >>> 0;
  return normalized === 0 ? null : normalized;
}

function clampInt(value, min, max) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Math.trunc(Number.isFinite(number) ? number : min)));
}
