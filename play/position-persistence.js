import { fixed3 } from "./pose-utils.js";

export function loadSavedPlayerPosition({ storageKey, seed, storage = globalThis.localStorage } = {}) {
  let raw = null;
  try {
    raw = storage?.getItem(storageKey);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    if (!saved || saved.version !== 1 || saved.seed !== seed) return null;
    if (!Number.isFinite(saved.worldX) || !Number.isFinite(saved.worldY) || !Number.isFinite(saved.worldZ)) return null;
    return saved;
  } catch {
    return null;
  }
}

export function createPositionPersistence({ storageKey, seed, saveIntervalMs = 650, getSnapshot, storage = globalThis.localStorage } = {}) {
  let lastSaveAt = 0;
  let lastSaveKey = "";
  return {
    save(now = performance.now(), { force = false } = {}) {
      const snapshot = getSnapshot?.();
      if (!snapshot) return false;
      const payload = normalizePositionPayload(snapshot, seed);
      const key = positionSaveKey(payload);
      if (!force && key === lastSaveKey) return false;
      if (!force && now - lastSaveAt < saveIntervalMs) return false;
      try {
        storage?.setItem(storageKey, JSON.stringify(payload));
        lastSaveAt = now;
        lastSaveKey = key;
        return true;
      } catch {
        return false;
      }
    },
  };
}

function normalizePositionPayload(snapshot, seed) {
  return {
    version: 1,
    seed,
    savedAt: Date.now(),
    worldX: Math.trunc(snapshot.worldX || 0),
    worldY: Math.trunc(snapshot.worldY || 0),
    worldZ: Math.trunc(snapshot.worldZ || 0),
    localOffsetX: clamp(Number(snapshot.localOffsetX) || 0, 0, 0.999999),
    localOffsetY: clamp(Number(snapshot.localOffsetY) || 0, 0, 0.999999),
    localOffsetZ: clamp(Number(snapshot.localOffsetZ) || 0, 0, 0.999999),
    controlYaw: Number.isFinite(snapshot.controlYaw) ? snapshot.controlYaw : snapshot.avatarYaw,
    avatarYaw: Number.isFinite(snapshot.avatarYaw) ? snapshot.avatarYaw : snapshot.controlYaw,
    cameraPitch: Number.isFinite(snapshot.cameraPitch) ? snapshot.cameraPitch : 0,
    flightEnabled: Boolean(snapshot.flightEnabled),
  };
}

function positionSaveKey(payload) {
  return [
    payload.worldX,
    payload.worldY,
    payload.worldZ,
    fixed3(payload.localOffsetX),
    fixed3(payload.localOffsetY),
    fixed3(payload.localOffsetZ),
    fixed3(payload.avatarYaw),
    fixed3(payload.controlYaw),
    fixed3(payload.cameraPitch),
    payload.flightEnabled ? "fly1" : "fly0",
  ].join(":");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
