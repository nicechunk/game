import { GUARDIAN_REGION_SIZE } from "../../sdk/nicechunk-guardian.ts";
import { chunkSize } from "../world/config.js";

export const inviteRefParam = "ref";
export const inviteGuardianParam = "guardian";
export const inviteGuardianRegionParam = "guardianRegion";
export const inviteSpawnStoragePrefix = "nicechunk.inviteSpawn.v1.";
export const inviteReceiptStoragePrefix = "nicechunk.inviteReceipt.v1.";

export function parseInviteParams(input = typeof window !== "undefined" ? window.location.search : "") {
  const params = input instanceof URLSearchParams ? input : new URLSearchParams(String(input || ""));
  const referrer = firstParam(params, [inviteRefParam, "invite", "inviter"]);
  const guardianId = firstParam(params, [inviteGuardianParam, "guardianId"]) || "genesis";
  const region = parseGuardianRegionParams(params);
  return {
    referrer: normalizeParam(referrer),
    guardianId: normalizeParam(guardianId) || "genesis",
    region,
    hasInvite: Boolean(normalizeParam(referrer) || normalizeParam(guardianId) || region),
  };
}

export function appendInviteParams(url, invite = {}) {
  const referrer = normalizeParam(invite.referrer);
  const guardianId = normalizeParam(invite.guardianId);
  const region = normalizeGuardianRegion(invite.region);
  if (referrer) url.searchParams.set(inviteRefParam, referrer);
  if (guardianId) url.searchParams.set(inviteGuardianParam, guardianId);
  if (region) url.searchParams.set(inviteGuardianRegionParam, guardianRegionParamValue(region));
  return url;
}

export function guardianRegionParamValue(region) {
  const normalized = normalizeGuardianRegion(region) ?? genesisGuardianRegion();
  return `${normalized.regionX}:${normalized.regionY}`;
}

export function genesisGuardianRegion() {
  return { regionX: 0, regionY: 0 };
}

export function normalizeGuardianRegion(region) {
  if (!region || typeof region !== "object") return null;
  const regionX = Number(region.regionX);
  const regionY = Number(region.regionY ?? region.regionZ);
  if (!Number.isInteger(regionX) || !Number.isInteger(regionY)) return null;
  return { regionX, regionY };
}

export function guardianSpawnStateForRegion(region, { surfaceHeight, yaw = Math.PI * 0.25, cameraPitch = -0.42 } = {}) {
  const normalized = normalizeGuardianRegion(region) ?? genesisGuardianRegion();
  const centerChunkX = normalized.regionX * GUARDIAN_REGION_SIZE + GUARDIAN_REGION_SIZE / 2;
  const centerChunkZ = normalized.regionY * GUARDIAN_REGION_SIZE + GUARDIAN_REGION_SIZE / 2;
  const x = centerChunkX * chunkSize;
  const z = centerChunkZ * chunkSize;
  const ground = typeof surfaceHeight === "function" ? surfaceHeight(x, z) : 0;
  const y = Number.isFinite(ground) ? ground + 1.01 : 1.01;
  return {
    position: { x, y, z },
    yaw,
    cameraPitch,
    guardianRegion: normalized,
  };
}

export function playerPdaPositionFromState(state) {
  const position = state?.position ?? state;
  if (!position) return null;
  const x = Math.round(Number(position.x));
  const y = Math.round(Number(position.y));
  const z = Math.round(Number(position.z));
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

export function storePendingInviteSpawn(walletAddress, payload) {
  const wallet = normalizeParam(walletAddress);
  if (!wallet || !payload) return;
  try {
    localStorage.setItem(inviteSpawnStorageKey(wallet), JSON.stringify({
      ...payload,
      storedAt: Date.now(),
    }));
  } catch {
    // Spawn still works from the chain PDA if local storage is unavailable.
  }
}

export function consumePendingInviteSpawn(walletAddress, { surfaceHeight } = {}) {
  const wallet = normalizeParam(walletAddress);
  if (!wallet) return null;
  const key = inviteSpawnStorageKey(wallet);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    localStorage.removeItem(key);
    const parsed = JSON.parse(raw);
    const state = parsed?.position
      ? {
          position: parsed.position,
          yaw: Number.isFinite(Number(parsed.yaw)) ? Number(parsed.yaw) : Math.PI * 0.25,
          cameraPitch: Number.isFinite(Number(parsed.cameraPitch)) ? Number(parsed.cameraPitch) : -0.42,
          guardianRegion: normalizeGuardianRegion(parsed.guardianRegion),
        }
      : guardianSpawnStateForRegion(parsed?.guardianRegion, { surfaceHeight });
    return state;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function storeInviteReceipt(walletAddress, receipt) {
  const wallet = normalizeParam(walletAddress);
  if (!wallet || !receipt) return;
  try {
    localStorage.setItem(inviteReceiptStorageKey(wallet), JSON.stringify({
      ...receipt,
      storedAt: Date.now(),
    }));
  } catch {
    // Non-critical analytics cache.
  }
}

function inviteSpawnStorageKey(walletAddress) {
  return `${inviteSpawnStoragePrefix}${walletAddress}`;
}

function inviteReceiptStorageKey(walletAddress) {
  return `${inviteReceiptStoragePrefix}${walletAddress}`;
}

function parseGuardianRegionParams(params) {
  const explicit = firstParam(params, [inviteGuardianRegionParam, "region"]);
  const parsedExplicit = parseRegionPair(explicit);
  if (parsedExplicit) return parsedExplicit;
  const guardian = firstParam(params, [inviteGuardianParam, "guardianId"]);
  const parsedGuardian = parseRegionPair(guardian);
  if (parsedGuardian) return parsedGuardian;
  const x = Number(firstParam(params, ["guardianX", "regionX"]));
  const y = Number(firstParam(params, ["guardianY", "regionY"]));
  if (Number.isInteger(x) && Number.isInteger(y)) return { regionX: x, regionY: y };
  return null;
}

function parseRegionPair(value) {
  const text = normalizeParam(value);
  if (!text || text === "genesis") return text === "genesis" ? genesisGuardianRegion() : null;
  const match = text.match(/^\s*(-?\d+)\s*[:,]\s*(-?\d+)\s*$/);
  if (!match) return null;
  return {
    regionX: Number(match[1]),
    regionY: Number(match[2]),
  };
}

function firstParam(params, names) {
  for (const name of names) {
    const value = params.get(name);
    if (normalizeParam(value)) return value;
  }
  return "";
}

function normalizeParam(value) {
  return String(value ?? "").trim();
}
