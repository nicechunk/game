import {
  blockColor,
  createAvatarToolCollisionResolver,
  createCollisionBox,
  loadPeasantGuyAvatarMesh,
} from "/chunk.js/play.js";
import { forgePayloadSourceIdentity } from "./forge-equipment-payload.js";
import {
  FORGED_ITEM_INTERACTION_MODE,
  forgedItemInteraction,
  markForgedItemInteractionLoading,
  markForgedItemInteractionUnavailable,
  setForgedItemRuntime,
} from "./forged-item-interaction.js";

export function createPlayAvatarSession({
  elements,
  gameState,
  getPlayer = () => null,
  getRenderer = () => null,
  getMotion = () => null,
  getPlayerWorldFloat = () => [0, 0, 0],
  getModelCode = () => "",
  setStatus = () => {},
  readableError = (error) => String(error?.message || error || "unknown error"),
  localMeshId = "local-player",
  remoteDefaultMeshId = "peasant-guy",
  defaultModelCode = "NCM:peasant_guy:v1",
  visualScale = 1,
  defaultCollisionBox,
  playerBodyHeight = 4,
  avatarHeightMeters = 1.75,
  blockSizeMeters = 0.4,
  collisionSkinBlocks = 0.02,
  footClearanceBlocks = 0.02,
  miningSwingDurationMs = 260,
} = {}) {
  let avatar = null;
  let avatarMesh = null;
  let activeModelCode = "";
  let activeForgeRequestKey = "no-forge";
  let activeForgeRuntime = null;
  let pendingForgeRequestKey = "";
  let modelLoadSerial = 0;
  let equipmentCacheKey = "";
  let equipmentCache = Object.freeze({ rightHand: "empty" });
  const toolCollision = createAvatarToolCollisionResolver({
    getAvatarMesh: () => avatarMesh,
    getAvatar: () => avatar,
    getPlayer,
    getPlayerWorldFloat,
    getSelectedEquipment: selectedEquipment,
    playerBodyHeight,
  });

  return {
    init,
    avatar: () => avatar,
    avatarMesh: () => avatarMesh,
    selectedEquipment,
    syncModelFromProfile,
    syncAvatarToPlayer,
    syncEquipment,
    selectedForgedInteraction,
    ensureSelectedForgedRuntime,
    startMiningSwing,
    toolCollisionFrame,
    toolReachSphere,
    toolTargetingSolution,
  };

  async function init() {
    try {
      const renderer = getRenderer();
      const player = getPlayer();
      if (!renderer || !player) return null;
      const remoteDefaultMesh = await loadPeasantGuyAvatarMesh({
        scale: visualScale,
        attachIronPickaxe: true,
        name: remoteDefaultMeshId,
      });
      renderer.uploadAvatarMesh(remoteDefaultMeshId, remoteDefaultMesh);
      avatar = {
        id: localMeshId,
        meshId: localMeshId,
        worldX: player.worldX,
        worldY: player.worldY,
        worldZ: player.worldZ,
        localOffsetX: player.localOffsetX,
        localOffsetY: 0,
        localOffsetZ: player.localOffsetZ,
        yaw: player.avatarYaw,
        equipment: selectedEquipment(),
        animation: { moving: false, timeMs: performance.now(), equipment: selectedEquipment() },
      };
      return await syncModelFromProfile({ force: true });
    } catch (error) {
      console.error(error);
      if (elements?.avatar) elements.avatar.textContent = "failed";
      return null;
    }
  }

  async function syncModelFromProfile({ force = false, quiet = true } = {}) {
    const renderer = getRenderer();
    const player = getPlayer();
    if (!renderer || !player) return null;
    const modelCode = getModelCode() || defaultModelCode;
    const forgeRequest = selectedForgeRuntimeRequest();
    if (!force
      && modelCode === activeModelCode
      && avatarMesh
      && (!forgeRequest || forgeRequest.key === activeForgeRequestKey)) {
      if (forgeRequest?.forged && activeForgeRuntime) {
        setForgedItemRuntime(forgeRequest.slot, activeForgeRuntime, { requestKey: forgeRequest.key });
      }
      return avatarMesh;
    }
    const serial = ++modelLoadSerial;
    pendingForgeRequestKey = forgeRequest?.key ?? activeForgeRequestKey;
    const nextForgeRequestKey = forgeRequest?.key ?? activeForgeRequestKey;
    let nextForgeRuntime = activeForgeRuntime;
    if (forgeRequest?.forged) markForgedItemInteractionLoading(forgeRequest.slot, forgeRequest.key);
    try {
      nextForgeRuntime = forgeRequest
        ? await restoreSelectedForgeRuntime(forgeRequest)
        : activeForgeRuntime;
      const forgeInteraction = forgeRequest?.forged
        ? (nextForgeRuntime
            ? setForgedItemRuntime(forgeRequest.slot, nextForgeRuntime, { requestKey: forgeRequest.key })
            : markForgedItemInteractionUnavailable(forgeRequest.slot, {
                requestKey: forgeRequest.key,
                reason: forgeRequest.source ? "runtime-restore-failed" : "presentation-source-unavailable",
              }))
        : null;
      const mesh = await loadPeasantGuyAvatarMesh({
        ncmCode: modelCode,
        scale: visualScale,
        attachIronPickaxe: true,
        attachForgedPickaxe: Boolean(forgeRequest?.forged && forgeInteraction?.hasGrip),
        forgeRuntime: nextForgeRuntime,
        name: avatarMeshNameForCode(modelCode),
      });
      if (serial !== modelLoadSerial) return null;
      applyMesh(mesh, modelCode, {
        forgeRequestKey: nextForgeRequestKey,
        forgeRuntime: nextForgeRuntime,
      });
      if (!quiet) setStatus(`Avatar model loaded: ${mesh.name}.`);
      return mesh;
    } catch (error) {
      console.warn("Failed to load chunk.js avatar model", error);
      const fallbackModelCode = avatarMesh ? activeModelCode : defaultModelCode;
      if (fallbackModelCode && fallbackModelCode !== modelCode) {
        try {
          const fallbackMesh = await loadPeasantGuyAvatarMesh({
            ncmCode: fallbackModelCode,
            scale: visualScale,
            attachIronPickaxe: true,
            attachForgedPickaxe: Boolean(forgeRequest?.forged && forgedItemInteraction(forgeRequest.slot).hasGrip),
            forgeRuntime: nextForgeRuntime,
            name: "peasant_guy",
          });
          if (serial !== modelLoadSerial) return null;
          applyMesh(fallbackMesh, fallbackModelCode, {
            forgeRequestKey: nextForgeRequestKey,
            forgeRuntime: nextForgeRuntime,
          });
          if (!quiet) setStatus(`Avatar model failed, using default: ${readableError(error)}.`);
          return fallbackMesh;
        } catch (fallbackError) {
          console.error(fallbackError);
        }
      }
      pendingForgeRequestKey = "";
      if (!quiet) setStatus(`Avatar model unavailable, keeping current mesh: ${readableError(error)}.`);
      return avatarMesh;
    }
  }

  function applyMesh(mesh, modelCode, { forgeRequestKey = activeForgeRequestKey, forgeRuntime = activeForgeRuntime } = {}) {
    const renderer = getRenderer();
    activeModelCode = modelCode;
    activeForgeRequestKey = forgeRequestKey;
    activeForgeRuntime = forgeRuntime;
    pendingForgeRequestKey = "";
    avatarMesh = mesh;
    renderer?.uploadAvatarMesh(localMeshId, mesh);
    getMotion()?.setPlayerCollisionBoxes?.([collisionBoxFromAvatarMesh(mesh)]);
    if (avatar) {
      avatar.id = localMeshId;
      avatar.meshId = localMeshId;
    }
    getMotion()?.resolvePlayerPenetration?.();
    updateDebugLabel(mesh, modelCode);
  }

  function syncAvatarToPlayer(now) {
    getMotion()?.syncAvatarToPlayer?.(now);
    syncEquipment();
  }

  function syncEquipment() {
    if (!avatar) return;
    const equipment = selectedEquipment();
    scheduleForgeGeometrySync();
    if (avatar.equipment === equipment && avatar.animation?.equipment === equipment) return;
    avatar.equipment = equipment;
    if (avatar.animation) avatar.animation.equipment = equipment;
  }

  function selectedEquipment() {
    const slot = gameState?.hotbarSlots?.[gameState?.selectedHotbarSlot];
    if (slot?.itemId === "blueprint_tool") {
      return cachedEquipment("tool:blueprint", () => ({
        rightHand: "blueprint",
        equipmentId: "blueprint_tool",
      }));
    }
    if (slot?.itemId === "forged_item") {
      const request = selectedForgeRuntimeRequest();
      const interaction = forgedItemInteraction(slot);
      const runtimeReady = interaction.mode === FORGED_ITEM_INTERACTION_MODE.tool
        && interaction.runtime === activeForgeRuntime
        && request?.key === activeForgeRequestKey;
      if (!runtimeReady) {
        return cachedEquipment(`empty:forged:${request?.key || "unavailable"}:${interaction.mode}`, () => ({ rightHand: "empty" }));
      }
      const payloadSource = slot.bytes instanceof Uint8Array || Array.isArray(slot.bytes)
        ? slot.bytes
        : null;
      const key = `forged:${slot.designHash ?? 0}:${forgePayloadSourceIdentity(payloadSource ?? slot.code)}`;
      return cachedEquipment(key, () => ({
        rightHand: "pickaxe",
        miningTool: true,
        equipmentId: "forged_pickaxe",
        forged: true,
        designHash: slot.designHash ?? 0,
        payloadBytes: payloadSource?.length ? Uint8Array.from(payloadSource) : null,
      }));
    }
    if (gameState?.isUsableMiningToolSlot?.(slot)) {
      return cachedEquipment("tool:basic_iron_pickaxe", () => ({
        rightHand: "pickaxe",
        miningTool: true,
        equipmentId: "basic_iron_pickaxe",
      }));
    }
    if (slot?.itemId === "resource_block" && Number.isFinite(slot.blockId) && slot.count > 0) {
      const blockId = Math.trunc(slot.blockId);
      return cachedEquipment(`block:${blockId}`, () => ({
        rightHand: "block",
        blockId,
        color: blockColor(blockId).map((channel) => channel / 255),
      }));
    }
    return cachedEquipment("empty", () => ({ rightHand: "empty" }));
  }

  function scheduleForgeGeometrySync() {
    const request = selectedForgeRuntimeRequest();
    if (!request || request.key === activeForgeRequestKey || request.key === pendingForgeRequestKey) return;
    pendingForgeRequestKey = request.key;
    syncModelFromProfile({ force: true }).catch((error) => {
      pendingForgeRequestKey = "";
      console.warn("Failed to restore forged equipment geometry", error);
    });
  }

  function selectedForgeRuntimeRequest() {
    const slot = gameState?.hotbarSlots?.[gameState?.selectedHotbarSlot];
    if (slot?.itemId !== "forged_item") {
      return activeForgeRequestKey !== "no-forge" || (pendingForgeRequestKey && pendingForgeRequestKey !== "no-forge")
        ? { key: "no-forge", source: null, designHash: 0, forged: false }
        : null;
    }
    const source = slot.bytes instanceof Uint8Array || Array.isArray(slot.bytes) && slot.bytes.length
      ? slot.bytes
      : typeof slot.code === "string" && slot.code
        ? slot.code
        : null;
    if (!source) {
      return {
        key: `forged-unavailable:${Math.trunc(Number(slot.designHash) || 0) >>> 0}`,
        source: null,
        designHash: slot.designHash ?? 0,
        forged: true,
        slot,
      };
    }
    return {
      key: `ncf1:${slot.designHash ?? 0}:${forgePayloadSourceIdentity(source)}`,
      source,
      designHash: slot.designHash ?? 0,
      forged: true,
      slot,
    };
  }

  async function restoreSelectedForgeRuntime(request) {
    if (!request?.source) return null;
    try {
      const { restoreForgeRuntime } = await import("/chunk.js/forge/forge-runtime-cache.js");
      return restoreForgeRuntime(request.source, {
        expectedDesignHash: request.designHash || null,
        requireCanonical: true,
      });
    } catch (error) {
      console.warn("Forged equipment code is unavailable; hand binding remains disabled", error);
      return null;
    }
  }

  function selectedForgedInteraction() {
    const slot = gameState?.hotbarSlots?.[gameState?.selectedHotbarSlot];
    return slot?.itemId === "forged_item" ? forgedItemInteraction(slot) : null;
  }

  async function ensureSelectedForgedRuntime() {
    const request = selectedForgeRuntimeRequest();
    if (!request?.forged) return null;
    const current = forgedItemInteraction(request.slot);
    if ((current.mode === FORGED_ITEM_INTERACTION_MODE.tool
      || current.mode === FORGED_ITEM_INTERACTION_MODE.placeable)
      && current.requestKey === request.key) return current;
    await syncModelFromProfile({ force: true });
    return forgedItemInteraction(request.slot);
  }

  function cachedEquipment(key, create) {
    if (key === equipmentCacheKey) return equipmentCache;
    equipmentCacheKey = key;
    equipmentCache = Object.freeze(create());
    return equipmentCache;
  }

  function startMiningSwing(swing = null) {
    const player = getPlayer();
    if (!player) return;
    const now = performance.now();
    const aimYaw = Number(swing?.aimYaw);
    if (Number.isFinite(aimYaw)) {
      player.miningAimYaw = normalizeAngle(aimYaw);
      player.avatarYaw = player.miningAimYaw;
      player.yaw = player.miningAimYaw;
      if (avatar) avatar.yaw = player.miningAimYaw;
    } else {
      player.miningAimYaw = null;
    }
    player.miningAimPitch = Number.isFinite(Number(swing?.aimPitch)) ? Number(swing.aimPitch) : 0;
    player.miningSwingStartedAt = now;
    player.miningSwingDurationMs = miningSwingDurationMs;
    player.miningSwingUntil = now + miningSwingDurationMs;
  }

  function toolCollisionFrame(args = {}) {
    return toolCollision?.toolCollisionFrame(args) ?? { boxes: [] };
  }

  function toolReachSphere(args = {}) {
    return toolCollision?.toolReachSphere(args) ?? null;
  }

  function toolTargetingSolution(args = {}) {
    return toolCollision?.toolTargetingSolution(args) ?? { reachable: false, reason: "tool-collision-unavailable" };
  }

  function collisionBoxFromAvatarMesh(mesh) {
    const coreParts = (mesh?.parts ?? []).filter((part) => part?.bone !== "left_arm" && part?.bone !== "right_arm" && !part?.equipment);
    const bounds = boundsOfAvatarParts(coreParts.length ? coreParts : mesh?.parts ?? []);
    if (!bounds) return defaultCollisionBox;
    return createCollisionBox({
      name: "player-body",
      halfWidth: Math.max(0.08, (bounds.maxX - bounds.minX) * 0.5 + collisionSkinBlocks),
      halfDepth: Math.max(0.08, (bounds.maxZ - bounds.minZ) * 0.5 + collisionSkinBlocks),
      height: Math.max(0.2, bounds.maxY - bounds.minY - footClearanceBlocks),
      offsetX: 0,
      offsetY: bounds.minY + footClearanceBlocks,
      offsetZ: 0,
    });
  }

  function updateDebugLabel(mesh, modelCode) {
    if (!elements?.avatar || !mesh) return;
    const body = getPlayer()?.collisionBoxes?.[0];
    const equipmentLabel = mesh.equipment?.length ? " · runtime right-hand equipment" : "";
    const sourceLabel = /^NCM2:/i.test(modelCode) ? "chain NCM2" : modelCode;
    const collisionLabel = body
      ? ` · collision ${(body.halfWidth * 2 * blockSizeMeters).toFixed(2)}x${(body.halfDepth * 2 * blockSizeMeters).toFixed(2)}m`
      : "";
    elements.avatar.textContent = `${mesh.name}${equipmentLabel} · ${sourceLabel} · ${mesh.bounds.height.toFixed(2)} blocks / ${avatarHeightMeters.toFixed(2)}m${collisionLabel} · ${Math.round(mesh.triangleCount)} tris`;
  }
}

function avatarMeshNameForCode(modelCode) {
  const code = String(modelCode || "");
  if (code === "NCM:peasant_guy:v1" || code === "NCM:peasant_guy_blackhair:v1") return "peasant_guy";
  if (/^NCM2:/i.test(code)) return "ncm2_avatar";
  return "custom_avatar";
}

function normalizeAngle(value) {
  let angle = Number(value) || 0;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function boundsOfAvatarParts(parts) {
  if (!Array.isArray(parts) || !parts.length) return null;
  const bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (const part of parts) {
    bounds.minX = Math.min(bounds.minX, part.cx - part.sx * 0.5);
    bounds.maxX = Math.max(bounds.maxX, part.cx + part.sx * 0.5);
    bounds.minY = Math.min(bounds.minY, part.cy - part.sy * 0.5);
    bounds.maxY = Math.max(bounds.maxY, part.cy + part.sy * 0.5);
    bounds.minZ = Math.min(bounds.minZ, part.cz - part.sz * 0.5);
    bounds.maxZ = Math.max(bounds.maxZ, part.cz + part.sz * 0.5);
  }
  return Number.isFinite(bounds.minX) ? bounds : null;
}
