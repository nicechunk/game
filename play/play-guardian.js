import { createNiceChunkGuardianClient } from "./play-guardian-client.js";
import {
  createPlayGuardianRegistryResolver,
  guardianBuildingAnnouncementPlan,
  guardianCoverageForRegions,
  guardianRegionsForFoundation,
} from "./play-guardian-registry.js";
import {
  forgePayloadIdentity,
  validatedNcf1EquipmentPayload,
} from "./forge-equipment-payload.js";
import { resolveGuardianConnectionState } from "./play-guardian-connection.js";
import {
  guardianEquipmentIdentity,
  resolveGuardianEquipmentFromChain,
} from "./play-guardian-equipment.js";
import { BLOCK_ID } from "/chunk.js/world/block-registry.js";

const EQUIPMENT_KIND = {
  empty: 0,
  pickaxe: 1,
  block: 2,
  forged: 3,
};
const EQUIPMENT_FLAG_FORGED = 1 << 0;
export const guardianEquipmentPayloadIdentity = forgePayloadIdentity;
export { guardianRegionsForFoundation };

const BLOCK_VARIANT_BY_ID = new Map([
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
  [5, 5],
]);

const REMOTE_SNAP_DISTANCE = 10;
const CONNECT_RETRY_MS = 1600;
const IDENTITY_RESEND_MS = 8000;
const EQUIPMENT_RESEND_MS = 1400;
const REMOTE_EXPIRE_MS = 45_000;
const CHAT_BUBBLE_DURATION_MS = 30_000;
const GUARDIAN_ERROR_NOTICE_MS = 30_000;
const GUARDIAN_REGION_SIZE_CHUNKS = 100;
const GUARDIAN_ANNOUNCE_TIMEOUT_MS = 5_000;
const GUARDIAN_ANNOUNCE_CONCURRENCY = 4;
const REMOTE_EQUIPMENT_CACHE_MS = 60_000;
const REMOTE_EQUIPMENT_REFRESH_DELAY_MS = 700;
const REMOTE_EQUIPMENT_CACHE_LIMIT = 256;

export function createPlayGuardian({
  chunks,
  getWalletAddress = () => "",
  getRpcUrl = () => "",
  getPlayerName = () => "Local Miner",
  getPlayerPose = () => null,
  getEquipment = () => ({ rightHand: "empty" }),
  fetchRemoteEquipmentSnapshots = null,
  resolveRemoteAvatarMeshId = null,
  appendEvent = () => {},
  onWorldChanged = () => {},
  onBuildingRegionDigest = () => {},
  onBuildingManifest = () => {},
  onGuardianRegionsChanged = () => {},
} = {}) {
  const state = {
    disabled: guardianDisabled(),
    client: null,
    walletAddress: "",
    connected: false,
    lastConnectAttemptAt: 0,
    lastIdentityName: "",
    lastIdentitySentAt: 0,
    lastEquipmentSignature: "",
    lastEquipmentSentAt: 0,
    lastErrorAt: 0,
    lastReconnectNoticeAt: 0,
    offline: false,
    offlineRetryAt: 0,
    guardianUrl: "",
    guardianRegionKey: "",
    guardianSource: "",
    registryLastNoticeAt: 0,
  };
  const registryResolver = createPlayGuardianRegistryResolver({
    getRpcUrl,
    appendEvent,
    onRegionsChanged: onGuardianRegionsChanged,
  });
  const remotePlayers = new Map();
  const pendingEquipment = new Map();
  const pendingIdentity = new Map();
  const pendingChat = new Map();
  const remoteEquipmentCache = new Map();
  const remoteEquipmentQueue = new Set();
  const remoteEquipmentVersions = new Map();
  const remoteEquipmentInFlight = new Map();
  let remoteEquipmentTimer = 0;
  let remoteEquipmentGeneration = 0;

  return {
    update,
    appendRemoteAvatars,
    appendOverlayTargets,
    sendDig,
    sendDigBatch,
    sendConfirmedMine,
    sendChat,
    sendEquipment: syncEquipment,
    getBuildingNeighborhood,
    getBuildingRegion,
    ensureBuildingNeighborhood,
    refreshBuildingRegions,
    ensureBuildingCoverage,
    requestCurrentBuildingManifest,
    announceBuilding,
    disconnect,
    connectionState,
    snapshot,
  };

  function update(now = performance.now(), dt = 1 / 60) {
    if (state.disabled) return;
    resolveGuardianEndpoint(now);
    ensureConnection(now);
    if (!state.client?.isReady?.()) return;
    const pose = normalizePose(getPlayerPose?.());
    if (pose) state.client.updateLocalPlayer(pose, now);
    syncIdentity(now);
    syncEquipment(now);
    updateRemotePlayers(now, dt);
  }

  function ensureConnection(now) {
    const wallet = String(getWalletAddress?.() || "").trim();
    if (!wallet) {
      if (state.client) disconnect("Guardian disconnected: wallet unavailable.", { quiet: true });
      state.walletAddress = "";
      state.guardianRegionKey = "";
      return;
    }
    const pose = normalizePose(getPlayerPose?.());
    if (!state.guardianUrl) {
      if (state.client) disconnect("Guardian disconnected: no RPC registry endpoint for this chunk.", { quiet: true });
      return;
    }
    if (state.offline && now < state.offlineRetryAt) return;
    if (state.offline && now >= state.offlineRetryAt) state.offline = false;
    if (state.client && wallet === state.walletAddress) {
      if (state.client.getUrl?.() !== state.guardianUrl) {
        state.client.reconnectTo?.(state.guardianUrl, { position: pose });
      }
      // The client owns its reconnect timer. Calling connect() from the render
      // frame would cancel that timer and can create a WebSocket storm when the
      // guardian endpoint is unavailable.
      return;
    }
    if (!state.client || wallet !== state.walletAddress) {
      if (now - state.lastConnectAttemptAt < CONNECT_RETRY_MS) return;
      disconnect("", { quiet: true });
      state.walletAddress = wallet;
      state.lastConnectAttemptAt = now;
      state.client = createGuardianClient(wallet);
      state.client.connect?.({ position: pose });
    }
  }

  function createGuardianClient(wallet) {
    return createNiceChunkGuardianClient({
      walletAddress: wallet,
      url: state.guardianUrl,
      playerName: String(getPlayerName?.() || "Local Miner"),
      chunkSize: chunks?.chunkSize || 16,
      onReady: (info) => {
        state.connected = true;
        state.lastEquipmentSignature = "";
        state.lastIdentityName = "";
        appendEvent(`Guardian connected as #${info.localPlayerId}.`);
        syncIdentity(performance.now(), { force: true });
        syncEquipment(performance.now(), { force: true });
      },
      onClose: () => {
        state.connected = false;
        remotePlayers.clear();
        clearRemoteEquipmentQueue();
      },
      onError: (event) => reportError("Guardian realtime unavailable; continuing in local mode.", event),
      onProtocolError: (event) => reportError(`Guardian protocol error ${event?.code ?? "unknown"}.`, event),
      onReconnectScheduled: (event) => reportReconnectScheduled(event),
      onOffline: (event) => reportOffline(event),
      onPlayerJoin: upsertRemotePlayer,
      onPlayerMove: upsertRemotePlayer,
      onPlayerLeave: removeRemotePlayer,
      onDig: handleRemoteDig,
      onChat: handleRemoteChat,
      onEquipment: handleRemoteEquipment,
      onPlayerIdentity: handleRemoteIdentity,
      onBuildingRegionDigest,
      onBuildingManifest,
    });
  }

  function disconnect(message = "", { quiet = false } = {}) {
    state.client?.disconnect?.();
    state.client = null;
    state.connected = false;
    state.offline = false;
    state.lastEquipmentSignature = "";
    state.lastIdentityName = "";
    remotePlayers.clear();
    pendingEquipment.clear();
    pendingIdentity.clear();
    clearRemoteEquipmentQueue();
    if (message && !quiet) appendEvent(message);
  }

  function upsertRemotePlayer(remotePlayer = {}) {
    if (!Number.isFinite(remotePlayer.localPlayerId)) return;
    let entry = remotePlayers.get(remotePlayer.localPlayerId);
    const now = performance.now();
    if (!entry) {
      const equipment = equipmentFromGuardianEvent(pendingEquipment.get(remotePlayer.localPlayerId));
      entry = createRemoteEntry(remotePlayer.localPlayerId, remotePlayer, equipment);
      remotePlayers.set(remotePlayer.localPlayerId, entry);
      const identity = pendingIdentity.get(remotePlayer.localPlayerId);
      if (identity) applyRemoteIdentity(entry, identity);
      const chat = pendingChat.get(remotePlayer.localPlayerId);
      if (chat) applyRemoteChat(entry, chat);
      pendingEquipment.delete(remotePlayer.localPlayerId);
      pendingIdentity.delete(remotePlayer.localPlayerId);
      pendingChat.delete(remotePlayer.localPlayerId);
    }
    entry.targetX = finite(remotePlayer.x, entry.targetX);
    entry.targetY = finite(remotePlayer.y, entry.targetY);
    entry.targetZ = finite(remotePlayer.z, entry.targetZ);
    entry.targetYaw = finite(remotePlayer.yaw, entry.targetYaw);
    entry.targetPitch = finite(remotePlayer.pitch, entry.targetPitch);
    entry.ownerWallet = normalizeOwnerWallet(remotePlayer) || entry.ownerWallet;
    entry.ownerHash = remotePlayer.ownerHash ?? entry.ownerHash;
    requestRemoteAvatarMesh(entry);
    requestRemoteEquipmentSnapshot(entry);
    entry.lastSeenAt = now;
    entry.ready = hasRemotePose(remotePlayer) || entry.ready;
  }

  function createRemoteEntry(localPlayerId, remotePlayer, equipment) {
    const x = finite(remotePlayer.x, 0);
    const y = finite(remotePlayer.y, 0);
    const z = finite(remotePlayer.z, 0);
    const yaw = finite(remotePlayer.yaw, 0);
    const render = {
      id: `guardian-${localPlayerId}`,
      meshId: "peasant-guy",
      worldX: Math.floor(x),
      worldY: Math.floor(y),
      worldZ: Math.floor(z),
      localOffsetX: fract(x),
      localOffsetY: fract(y),
      localOffsetZ: fract(z),
      yaw,
      shadowAlpha: 0.30,
      animation: {
        moving: false,
        timeMs: performance.now(),
        equipment,
        miningProgress: 0,
      },
    };
    return {
      localPlayerId,
      ownerWallet: normalizeOwnerWallet(remotePlayer),
      ownerHash: remotePlayer.ownerHash ?? 0,
      displayName: "",
      x,
      y,
      z,
      targetX: x,
      targetY: y,
      targetZ: z,
      yaw,
      targetYaw: yaw,
      pitch: finite(remotePlayer.pitch, 0),
      targetPitch: finite(remotePlayer.pitch, 0),
      equipment,
      guardianEquipment: equipment,
      guardianEquipmentSignature: guardianEquipmentIdentity(equipment),
      render,
      ready: hasRemotePose(remotePlayer),
      lastSeenAt: performance.now(),
      swingStartedAt: 0,
      swingDurationMs: 260,
    };
  }

  function removeRemotePlayer(remotePlayer = {}) {
    remotePlayers.delete(remotePlayer.localPlayerId);
    pendingEquipment.delete(remotePlayer.localPlayerId);
    pendingIdentity.delete(remotePlayer.localPlayerId);
    pendingChat.delete(remotePlayer.localPlayerId);
  }

  function handleRemoteDig(event = {}) {
    const entry = remotePlayers.get(event.localPlayerId);
    if (entry) {
      const dx = finite(event.x, entry.x) + 0.5 - entry.x;
      const dz = finite(event.z, entry.z) + 0.5 - entry.z;
      if (dx * dx + dz * dz > 0.0001) {
        entry.targetYaw = Math.atan2(-dx, -dz);
        entry.yaw = smoothAngle(entry.yaw, entry.targetYaw, 0.35);
      }
      startRemoteSwing(entry);
    }
    if (event.action !== 3 || !chunks?.applyChainDelta) return;
    const worldX = Math.trunc(event.x);
    const worldY = Math.trunc(event.y);
    const worldZ = Math.trunc(event.z);
    chunks.applyChainDelta([{ worldX, worldY, worldZ, blockId: BLOCK_ID.air }]);
    onWorldChanged({ type: "guardian-dig", worldX, worldY, worldZ, localPlayerId: event.localPlayerId });
  }

  function handleRemoteChat(event = {}) {
    const entry = remotePlayers.get(event.localPlayerId);
    const name = entry?.displayName || `Player ${event.localPlayerId}`;
    const chat = {
      message: normalizeChatMessage(event.message),
      until: performance.now() + CHAT_BUBBLE_DURATION_MS,
    };
    if (entry) applyRemoteChat(entry, chat);
    else if (Number.isFinite(event.localPlayerId)) pendingChat.set(event.localPlayerId, chat);
    appendEvent(`${name}: ${chat.message.slice(0, 120)}`);
  }

  function handleRemoteEquipment(event = {}) {
    const entry = remotePlayers.get(event.localPlayerId);
    if (!entry) {
      pendingEquipment.set(event.localPlayerId, event);
      return;
    }
    const equipment = equipmentFromGuardianEvent(event);
    const signature = guardianEquipmentIdentity(equipment);
    const changed = signature !== entry.guardianEquipmentSignature;
    entry.guardianEquipment = equipment;
    entry.guardianEquipmentSignature = signature;
    entry.equipment = resolveGuardianEquipmentFromChain(equipment, cachedRemoteEquipment(entry.ownerWallet));
    entry.render.animation.equipment = entry.equipment;
    requestRemoteAvatarMesh(entry);
    if (changed) requestRemoteEquipmentSnapshot(entry, { force: true, delayMs: REMOTE_EQUIPMENT_REFRESH_DELAY_MS });
  }

  function handleRemoteIdentity(event = {}) {
    const entry = remotePlayers.get(event.localPlayerId);
    if (!entry) {
      pendingIdentity.set(event.localPlayerId, event);
      return;
    }
    applyRemoteIdentity(entry, event);
  }

  function applyRemoteIdentity(entry, identity = {}) {
    entry.displayName = String(identity.displayName || "").trim();
    entry.ownerWallet = normalizeOwnerWallet(identity) || entry.ownerWallet;
    requestRemoteAvatarMesh(entry);
    requestRemoteEquipmentSnapshot(entry);
  }

  function requestRemoteEquipmentSnapshot(entry, { force = false, delayMs = 0 } = {}) {
    if (!entry || typeof fetchRemoteEquipmentSnapshots !== "function") return false;
    const wallet = String(entry.ownerWallet || "").trim();
    if (!wallet) return false;
    const cached = remoteEquipmentCache.get(wallet);
    if (!force && cached && performance.now() - cached.loadedAt < REMOTE_EQUIPMENT_CACHE_MS) {
      applyRemoteEquipmentToEntry(entry, cached.snapshot);
      return false;
    }
    if (!force && (remoteEquipmentQueue.has(wallet) || remoteEquipmentInFlight.has(wallet))) return false;
    if (force) remoteEquipmentCache.delete(wallet);
    remoteEquipmentVersions.set(wallet, (remoteEquipmentVersions.get(wallet) || 0) + 1);
    remoteEquipmentQueue.add(wallet);
    if (remoteEquipmentTimer) return true;
    remoteEquipmentTimer = globalThis.setTimeout(flushRemoteEquipmentQueue, Math.max(0, delayMs));
    return true;
  }

  async function flushRemoteEquipmentQueue() {
    remoteEquipmentTimer = 0;
    const wallets = Array.from(remoteEquipmentQueue);
    remoteEquipmentQueue.clear();
    if (!wallets.length || typeof fetchRemoteEquipmentSnapshots !== "function") return;
    const generation = remoteEquipmentGeneration;
    const versions = wallets.map((wallet) => remoteEquipmentVersions.get(wallet) || 0);
    wallets.forEach((wallet, index) => remoteEquipmentInFlight.set(wallet, versions[index]));
    try {
      const snapshots = await fetchRemoteEquipmentSnapshots(wallets);
      if (generation !== remoteEquipmentGeneration) return;
      const now = performance.now();
      for (let index = 0; index < wallets.length; index += 1) {
        const wallet = wallets[index];
        if (remoteEquipmentVersions.get(wallet) !== versions[index]) continue;
        const snapshot = snapshots?.[index] ?? null;
        remoteEquipmentCache.delete(wallet);
        remoteEquipmentCache.set(wallet, { snapshot, loadedAt: now });
        while (remoteEquipmentCache.size > REMOTE_EQUIPMENT_CACHE_LIMIT) {
          remoteEquipmentCache.delete(remoteEquipmentCache.keys().next().value);
        }
        applyRemoteEquipmentSnapshot(wallet, snapshot);
      }
    } catch (error) {
      if (guardianVerboseLogging()) console.warn("Failed to batch-load remote equipment PDA state", error);
    } finally {
      wallets.forEach((wallet, index) => {
        if (remoteEquipmentInFlight.get(wallet) === versions[index]) remoteEquipmentInFlight.delete(wallet);
      });
    }
  }

  function applyRemoteEquipmentSnapshot(wallet, snapshot) {
    for (const entry of remotePlayers.values()) {
      if (entry.ownerWallet !== wallet) continue;
      applyRemoteEquipmentToEntry(entry, snapshot);
    }
  }

  function applyRemoteEquipmentToEntry(entry, snapshot) {
    entry.equipment = resolveGuardianEquipmentFromChain(entry.guardianEquipment, snapshot);
    entry.render.animation.equipment = entry.equipment;
    requestRemoteAvatarMesh(entry);
  }

  function cachedRemoteEquipment(wallet) {
    return remoteEquipmentCache.get(String(wallet || "").trim())?.snapshot ?? null;
  }

  function clearRemoteEquipmentQueue() {
    remoteEquipmentGeneration += 1;
    remoteEquipmentQueue.clear();
    remoteEquipmentVersions.clear();
    remoteEquipmentInFlight.clear();
    if (remoteEquipmentTimer) globalThis.clearTimeout(remoteEquipmentTimer);
    remoteEquipmentTimer = 0;
  }

  function requestRemoteAvatarMesh(entry) {
    if (!entry || typeof resolveRemoteAvatarMeshId !== "function") return;
    const wallet = String(entry.ownerWallet || "").trim();
    if (!wallet) return;
    const payloadIdentity = forgePayloadIdentity(entry.equipment?.payloadBytes);
    const appearanceKey = `${wallet}:${entry.equipment?.designHash ?? 0}:${payloadIdentity}`;
    if (entry.appearanceKey === appearanceKey) return;
    entry.appearanceKey = appearanceKey;
    const token = Symbol(`remote-avatar:${entry.localPlayerId}:${appearanceKey}`);
    entry.appearanceRequest = token;
    resolveRemoteAvatarMeshId(wallet, {
      localPlayerId: entry.localPlayerId,
      equipment: entry.equipment,
    })
      .then((meshId) => {
        const current = remotePlayers.get(entry.localPlayerId);
        if (!current || current.appearanceRequest !== token || current.appearanceKey !== appearanceKey) return;
        const resolved = String(meshId || "").trim();
        if (resolved) current.render.meshId = resolved;
      })
      .catch((error) => {
        if (guardianVerboseLogging()) console.warn("Failed to resolve remote avatar mesh", error);
      });
  }

  function applyRemoteChat(entry, chat = {}) {
    const message = normalizeChatMessage(chat.message);
    if (!message) return;
    entry.chatMessage = message;
    entry.chatUntil = Number.isFinite(chat.until) ? chat.until : performance.now() + CHAT_BUBBLE_DURATION_MS;
  }

  function startRemoteSwing(entry) {
    const now = performance.now();
    entry.swingStartedAt = now;
    entry.swingDurationMs = 260;
  }

  function updateRemotePlayers(now, dt) {
    const alpha = 1 - Math.exp(-Math.max(0, dt) * 18);
    for (const [id, entry] of remotePlayers) {
      if (now - entry.lastSeenAt > REMOTE_EXPIRE_MS) {
        remotePlayers.delete(id);
        continue;
      }
      const dx = entry.targetX - entry.x;
      const dy = entry.targetY - entry.y;
      const dz = entry.targetZ - entry.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > REMOTE_SNAP_DISTANCE) {
        entry.x = entry.targetX;
        entry.y = entry.targetY;
        entry.z = entry.targetZ;
      } else {
        entry.x += dx * alpha;
        entry.y += dy * alpha;
        entry.z += dz * alpha;
      }
      entry.yaw = smoothAngle(entry.yaw, entry.targetYaw, alpha);
      entry.pitch += (entry.targetPitch - entry.pitch) * alpha;
      const moving = distance > 0.025;
      const swingProgress = remoteSwingProgress(entry, now);
      const render = entry.render;
      splitWorldFloat(entry.x, render, "X");
      splitWorldFloat(entry.y, render, "Y");
      splitWorldFloat(entry.z, render, "Z");
      render.yaw = entry.yaw;
      render.animation.moving = moving;
      render.animation.timeMs = now;
      render.animation.miningProgress = swingProgress;
      render.animation.equipment = entry.equipment;
    }
  }

  function appendRemoteAvatars(target) {
    if (!Array.isArray(target)) return target;
    for (const entry of remotePlayers.values()) {
      if (entry.ready) target.push(entry.render);
    }
    return target;
  }

  function appendOverlayTargets(target, now = performance.now()) {
    if (!Array.isArray(target)) return target;
    for (const entry of remotePlayers.values()) {
      if (!entry.ready) continue;
      if (entry.chatUntil && now >= entry.chatUntil) {
        entry.chatUntil = 0;
        entry.chatMessage = "";
      }
      target.push({
        id: `guardian-${entry.localPlayerId}`,
        name: entry.displayName || `Player ${entry.localPlayerId}`,
        x: entry.x,
        y: entry.y,
        z: entry.z,
        chatMessage: entry.chatMessage || "",
        chatUntil: entry.chatUntil || 0,
      });
    }
    return target;
  }

  function sendDig(block, action = 1) {
    if (!block || !state.client?.isReady?.()) return false;
    return state.client.sendDig({
      x: Math.trunc(block.worldX ?? block.x),
      y: Math.trunc(block.worldY ?? block.y),
      z: Math.trunc(block.worldZ ?? block.z),
      action,
      toolHint: 1,
    });
  }

  function sendDigBatch(blocks, action = 1) {
    const normalized = Array.isArray(blocks)
      ? blocks.map((block) => ({
          x: Math.trunc(block?.worldX ?? block?.x),
          y: Math.trunc(block?.worldY ?? block?.y),
          z: Math.trunc(block?.worldZ ?? block?.z),
        })).filter((block) => [block.x, block.y, block.z].every(Number.isFinite))
      : [];
    if (!normalized.length || !state.client?.isReady?.()) return false;
    return state.client.sendDigBatch(normalized, { action, toolHint: 1 });
  }

  function sendConfirmedMine(pending) {
    return pending?.blocks?.length > 1 ? sendDigBatch(pending.blocks, 3) : sendDig(pending, 3);
  }

  function sendChat(message) {
    const text = normalizeChatMessage(message);
    if (!text) return false;
    if (!state.client?.isReady?.()) return false;
    return state.client.sendChat(text);
  }

  function getBuildingNeighborhood() {
    const chunk = currentPlayerChunk();
    return chunk
      ? registryResolver.getCachedNeighborhoodForChunk(chunk.x, chunk.z)
      : [];
  }

  function getBuildingRegion(regionX, regionZ) {
    return registryResolver.getCachedRegion(regionX, regionZ);
  }

  async function ensureBuildingNeighborhood() {
    const chunk = currentPlayerChunk();
    if (!chunk) return [];
    try {
      return await registryResolver.loadNeighborhoodForChunk(chunk.x, chunk.z);
    } catch (error) {
      if (guardianVerboseLogging()) console.warn("Guardian building neighborhood unavailable", error);
      return getBuildingNeighborhood();
    }
  }

  async function refreshBuildingRegions(regions = []) {
    try {
      return await registryResolver.refreshRegions(regions);
    } catch (error) {
      if (guardianVerboseLogging()) console.warn("Guardian building region refresh unavailable", error);
      return regions.map((region) => registryResolver.getCachedRegion(region?.x, region?.z)).filter(Boolean);
    }
  }

  async function ensureBuildingCoverage(foundation) {
    const regions = guardianRegionsForFoundation(foundation, chunks?.chunkSize || 16);
    if (!regions.length) {
      return { ok: false, regions, entries: [], missing: regions, reason: "guardian-coverage-unavailable" };
    }
    let entries = [];
    try {
      entries = await registryResolver.ensureRegions(regions);
    } catch (error) {
      if (guardianVerboseLogging()) console.warn("Guardian building coverage unavailable", error);
    }
    return guardianCoverageForRegions(regions, entries);
  }

  function requestCurrentBuildingManifest(knownRevision = 0) {
    return state.client?.requestBuildingManifest?.(knownRevision) === true;
  }

  async function announceBuilding(record, { previousRecord = null } = {}) {
    const chunkSize = chunks?.chunkSize || 16;
    const plan = guardianBuildingAnnouncementPlan(record, { previousRecord, chunkSize });
    const regions = plan.map((entry) => entry.region);
    let entries = [];
    try {
      entries = await registryResolver.ensureRegions(regions);
    } catch (error) {
      if (guardianVerboseLogging()) console.warn("Guardian building announcement coverage unavailable", error);
    }
    const coverage = guardianCoverageForRegions(regions, entries);
    if (!coverage.ok) return { ok: false, coverage, announced: 0, failed: coverage.missing };
    const recordsByRegion = new Map(plan.map((entry) => [buildingRegionKey(entry.region), entry.record]));
    const results = await mapWithConcurrency(
      coverage.entries,
      GUARDIAN_ANNOUNCE_CONCURRENCY,
      (entry) => {
        const regionRecord = recordsByRegion.get(buildingRegionKey(entry?.region));
        return regionRecord ? announceBuildingToGuardian(entry, regionRecord) : false;
      },
    );
    const failed = coverage.entries.filter((_entry, index) => results[index] !== true);
    return {
      ok: failed.length === 0,
      coverage,
      announced: results.length - failed.length,
      failed,
    };
  }

  async function announceBuildingToGuardian(entry, record) {
    if (!entry?.url) return false;
    if (state.client?.getUrl?.() === entry.url) {
      const ready = await waitForCurrentGuardian(entry.url);
      return ready ? state.client?.announceBuilding?.(record) === true : false;
    }
    const wallet = String(getWalletAddress?.() || "").trim();
    if (!wallet) return false;
    const chunkSize = chunks?.chunkSize || 16;
    const region = entry.region || { x: 0, z: 0 };
    const position = {
      x: (region.x * GUARDIAN_REGION_SIZE_CHUNKS + GUARDIAN_REGION_SIZE_CHUNKS / 2 + 0.5) * chunkSize,
      y: 0,
      z: (region.z * GUARDIAN_REGION_SIZE_CHUNKS + GUARDIAN_REGION_SIZE_CHUNKS / 2 + 0.5) * chunkSize,
    };
    return new Promise((resolve) => {
      let settled = false;
      let client = null;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        client?.disconnect?.();
        resolve(Boolean(ok));
      };
      const timeout = globalThis.setTimeout(() => finish(false), GUARDIAN_ANNOUNCE_TIMEOUT_MS);
      client = createNiceChunkGuardianClient({
        walletAddress: wallet,
        url: entry.url,
        playerName: String(getPlayerName?.() || "Local Miner"),
        chunkSize,
        autoReconnect: false,
        onReady: () => {
          const sent = client?.announceBuilding?.(record) === true;
          globalThis.setTimeout(() => finish(sent), 120);
        },
        onError: () => finish(false),
        onProtocolError: () => finish(false),
        onClose: () => finish(false),
      });
      client.connect?.({ position });
    });
  }

  async function waitForCurrentGuardian(url) {
    const startedAt = performance.now();
    while (performance.now() - startedAt < GUARDIAN_ANNOUNCE_TIMEOUT_MS) {
      if (state.client?.getUrl?.() !== url) return false;
      if (state.client?.isReady?.()) return true;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    }
    return false;
  }

  function currentPlayerChunk() {
    const pose = normalizePose(getPlayerPose?.());
    if (!pose) return null;
    const chunkSize = chunks?.chunkSize || 16;
    return {
      x: Math.floor(pose.x / chunkSize),
      z: Math.floor(pose.z / chunkSize),
    };
  }

  function syncIdentity(now = performance.now(), { force = false } = {}) {
    if (!state.client?.isReady?.()) return false;
    const name = String(getPlayerName?.() || "Local Miner").trim();
    if (!force && name === state.lastIdentityName && now - state.lastIdentitySentAt < IDENTITY_RESEND_MS) return false;
    state.lastIdentityName = name;
    state.lastIdentitySentAt = now;
    return state.client.sendPlayerIdentity(name);
  }

  function syncEquipment(now = performance.now(), { force = false } = {}) {
    if (!state.client?.isReady?.()) return false;
    const encoded = guardianEquipmentFromAvatarEquipment(getEquipment?.());
    const signature = `${encoded.rightHandKind}:${encoded.rightHandVariant}:${encoded.flags}:${encoded.designHash}:${forgePayloadIdentity(encoded.payloadBytes)}`;
    if (!force && signature === state.lastEquipmentSignature && now - state.lastEquipmentSentAt < EQUIPMENT_RESEND_MS) return false;
    state.lastEquipmentSignature = signature;
    state.lastEquipmentSentAt = now;
    return state.client.sendEquipment(encoded);
  }

  function snapshot() {
    return {
      enabled: !state.disabled,
      connected: Boolean(state.client?.isReady?.()),
      connectionState: connectionState(),
      walletAddress: state.walletAddress,
      remotePlayers: remotePlayers.size,
      endpoint: state.client?.getUrl?.() || "",
      registryEndpoint: state.guardianUrl,
      registrySource: state.guardianSource,
      registryRegion: state.guardianRegionKey,
      registry: registryResolver.snapshot?.() ?? null,
      offline: state.offline,
    };
  }

  function connectionState() {
    return resolveGuardianConnectionState({
      enabled: !state.disabled,
      walletAvailable: Boolean(state.walletAddress),
      connected: Boolean(state.client?.isReady?.()),
      connecting: Boolean(state.client || state.guardianUrl),
      offline: state.offline,
    });
  }

  function resolveGuardianEndpoint(now = performance.now()) {
    const wallet = String(getWalletAddress?.() || "").trim();
    if (!wallet) {
      state.guardianUrl = "";
      state.guardianRegionKey = "";
      return;
    }
    const pose = normalizePose(getPlayerPose?.());
    if (!pose) return;
    const chunkSize = chunks?.chunkSize || 16;
    const chunkX = Math.floor(pose.x / chunkSize);
    const chunkZ = Math.floor(pose.z / chunkSize);
    const rpcUrl = String(getRpcUrl?.() || "").trim();
    if (!rpcUrl) {
      state.guardianUrl = "";
      state.guardianSource = "";
      state.guardianRegionKey = "";
      if (state.client) disconnect("", { quiet: true });
      return;
    }
    const currentRegionX = Math.floor(chunkX / GUARDIAN_REGION_SIZE_CHUNKS);
    const currentRegionZ = Math.floor(chunkZ / GUARDIAN_REGION_SIZE_CHUNKS);
    const currentRegionKey = `${rpcUrl}|${currentRegionX},${currentRegionZ}`;
    registryResolver.ensureNeighborhoodForChunk(chunkX, chunkZ);
    const cached = registryResolver.getCachedForChunk(chunkX, chunkZ);
    if (cached?.ok && cached.url) {
      if (state.guardianUrl !== cached.url) {
        state.guardianUrl = cached.url;
        state.guardianSource = cached.source || "registry-cache";
        state.guardianRegionKey = currentRegionKey;
        state.offline = false;
        state.offlineRetryAt = 0;
        appendGuardianNotice(`Guardian endpoint switched from cached RPC region ${currentRegionKey}.`);
      }
      return;
    }
    if (state.guardianUrl && state.guardianRegionKey === currentRegionKey) return;
    if (!state.guardianUrl) return;
    if (state.client) disconnect("", { quiet: true });
    if (state.guardianUrl) {
        state.guardianUrl = "";
        state.guardianSource = "";
        appendGuardianNotice(`No cached Guardian endpoint for chunk ${chunkX},${chunkZ}; realtime sync disabled until 9-region preload completes.`);
    }
  }

  function appendGuardianNotice(message) {
    const now = performance.now();
    if (now - state.registryLastNoticeAt < GUARDIAN_ERROR_NOTICE_MS) return;
    state.registryLastNoticeAt = now;
    appendEvent(message);
  }

  function reportError(message, event) {
    const now = performance.now();
    if (now - state.lastErrorAt < GUARDIAN_ERROR_NOTICE_MS) return;
    state.lastErrorAt = now;
    appendEvent(message);
    if (guardianVerboseLogging()) console.warn(message, event);
  }

  function reportReconnectScheduled(event = {}) {
    if (!guardianVerboseLogging()) return;
    const now = performance.now();
    if (now - state.lastReconnectNoticeAt < 5000) return;
    state.lastReconnectNoticeAt = now;
    appendEvent(`Guardian reconnect scheduled in ${Math.round((event.delayMs || 0) / 1000)}s.`);
  }

  function reportOffline(event = {}) {
    state.offline = true;
    state.offlineRetryAt = performance.now() + 60_000;
    state.connected = false;
    remotePlayers.clear();
    clearRemoteEquipmentQueue();
    const attempts = Math.max(1, Math.trunc(event.attempts || 0));
    appendEvent(`Guardian realtime offline after ${attempts} failed attempts. Local play continues.`);
    if (guardianVerboseLogging()) console.warn("Guardian realtime offline.", event);
  }
}

function buildingRegionKey(region) {
  const x = Number(region?.x ?? region?.regionX);
  const z = Number(region?.z ?? region?.regionZ);
  return Number.isInteger(x) && Number.isInteger(z) ? `${x},${z}` : "";
}

function validGuardianBlueprintHash(value) {
  const hash = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(hash) && !/^0+$/.test(hash);
}

export function guardianEquipmentFromAvatarEquipment(equipment = {}) {
  const rightHand = String(equipment?.rightHand || "empty");
  if (rightHand === "pickaxe") {
    const designHash = Math.trunc(Number(equipment.designHash) || 0) >>> 0;
    const forged = Boolean(equipment.forged || equipment.isForged || designHash);
    return {
      rightHandKind: forged ? EQUIPMENT_KIND.forged : EQUIPMENT_KIND.pickaxe,
      rightHandVariant: forged ? 2 : 1,
      flags: forged ? EQUIPMENT_FLAG_FORGED : 0,
      designHash: forged ? designHash : 0,
      payloadBytes: forged ? validatedNcf1EquipmentPayload(equipment.payloadBytes, designHash) : null,
    };
  }
  if (rightHand === "block") {
    const blockId = Math.trunc(equipment.blockId || 0);
    return { rightHandKind: EQUIPMENT_KIND.block, rightHandVariant: BLOCK_VARIANT_BY_ID.get(blockId) || clampByte(blockId), flags: 0, designHash: blockId >>> 0 };
  }
  return { rightHandKind: EQUIPMENT_KIND.empty, rightHandVariant: 0, flags: 0, designHash: 0 };
}

export function equipmentFromGuardianEvent(event = {}) {
  const kind = Math.trunc(event?.rightHandKind ?? EQUIPMENT_KIND.empty);
  if (kind === EQUIPMENT_KIND.pickaxe || kind === EQUIPMENT_KIND.forged) {
    const designHash = Math.trunc(Number(event.designHash) || 0) >>> 0;
    const forged = Boolean(
      kind === EQUIPMENT_KIND.forged
      || (Math.trunc(Number(event.flags) || 0) & EQUIPMENT_FLAG_FORGED)
      || designHash
      || Math.trunc(Number(event.rightHandVariant) || 0) === 2
    );
    return forged
      ? { rightHand: "pickaxe", forged: true, designHash, payloadBytes: validatedNcf1EquipmentPayload(event.payloadBytes, designHash) }
      : { rightHand: "pickaxe" };
  }
  if (kind === EQUIPMENT_KIND.block) return { rightHand: "block", blockId: Math.trunc(event.rightHandVariant || 0), color: [0.52, 0.72, 0.38, 1] };
  return { rightHand: "empty" };
}

async function mapWithConcurrency(values, concurrency, task) {
  const source = Array.isArray(values) ? values : [];
  const results = new Array(source.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < source.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await task(source[index], index);
      } catch {
        results[index] = false;
      }
    }
  };
  const count = Math.min(source.length, Math.max(1, Math.trunc(Number(concurrency) || 1)));
  await Promise.all(Array.from({ length: count }, worker));
  return results;
}

function normalizeOwnerWallet(source = {}) {
  return String(
    source.ownerWallet ||
    source.ownerAddress ||
    source.walletAddress ||
    source.owner ||
    "",
  ).trim();
}

function normalizePose(pose) {
  if (Array.isArray(pose)) return { x: finite(pose[0], 0), y: finite(pose[1], 0), z: finite(pose[2], 0), yaw: 0, pitch: 0 };
  if (!pose) return null;
  return {
    x: finite(pose.x ?? pose.worldX, 0),
    y: finite(pose.y ?? pose.worldY, 0),
    z: finite(pose.z ?? pose.worldZ, 0),
    yaw: finite(pose.yaw ?? pose.avatarYaw ?? pose.controlYaw, 0),
    pitch: finite(pose.pitch ?? pose.cameraPitch, 0),
  };
}

function splitWorldFloat(value, target, axis) {
  const world = Math.floor(value);
  const local = value - world;
  target[`world${axis}`] = world;
  target[`localOffset${axis}`] = local;
}

function remoteSwingProgress(entry, now) {
  if (!entry.swingStartedAt) return 0;
  const progress = (now - entry.swingStartedAt) / Math.max(1, entry.swingDurationMs || 260);
  if (progress >= 1) {
    entry.swingStartedAt = 0;
    return 0;
  }
  return Math.max(0, Math.min(1, progress));
}

function hasRemotePose(remotePlayer) {
  return Math.abs(Number(remotePlayer?.x) || 0) > 0.001
    || Math.abs(Number(remotePlayer?.y) || 0) > 0.001
    || Math.abs(Number(remotePlayer?.z) || 0) > 0.001;
}

function smoothAngle(current, target, alpha) {
  return current + angleDelta(current, target) * Math.max(0, Math.min(1, alpha));
}

function angleDelta(current, target) {
  let delta = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function guardianDisabled() {
  try {
    const params = new URLSearchParams(globalThis.location?.search || "");
    return params.get("guardian") === "0" || globalThis.localStorage?.getItem("nicechunk.guardian.enabled") === "0";
  } catch {
    return false;
  }
}

function guardianVerboseLogging() {
  try {
    const params = new URLSearchParams(globalThis.location?.search || "");
    return params.get("guardianDebug") === "1" || globalThis.localStorage?.getItem("nicechunk.guardian.debug") === "1";
  } catch {
    return false;
  }
}

function readableError(error) {
  return String(error?.message || error || "unknown error");
}

function finite(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function fract(value) {
  return value - Math.floor(value);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.trunc(Number(value) || 0)));
}

function normalizeChatMessage(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}
