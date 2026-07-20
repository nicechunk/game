import { loadPeasantGuyAvatarMesh } from "/chunk.js/play.js";
import {
  forgePayloadIdentity,
  validatedNcf1EquipmentPayload,
} from "./forge-equipment-payload.js";
import { loadPlayChainModule } from "./play-chain-adapter.js";

const DEFAULT_REMOTE_AVATAR_MESH_ID = "peasant-guy";
const DEFAULT_AVATAR_MODEL_CODE = "NCM:peasant_guy:v1";
const REMOTE_APPEARANCE_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_REMOTE_WALLET_CACHE_ENTRIES = 256;
const DEFAULT_REMOTE_MODEL_MESHES = 64;

export function createGuardianAppearanceMeshCache({
  renderer,
  scale = 1,
  defaultMeshId = DEFAULT_REMOTE_AVATAR_MESH_ID,
  defaultModelCode = DEFAULT_AVATAR_MODEL_CODE,
  attachIronPickaxe = true,
  maxWalletEntries = DEFAULT_REMOTE_WALLET_CACHE_ENTRIES,
  maxModelMeshes = DEFAULT_REMOTE_MODEL_MESHES,
  fetchModelCode = null,
  onStatus = () => {},
  appendEvent = () => {},
} = {}) {
  const cache = new Map();
  const modelMeshIds = new Map();
  const walletLimit = positiveInteger(maxWalletEntries, "remote appearance wallet cache entries");
  const modelLimit = positiveInteger(maxModelMeshes, "remote appearance model meshes");
  let refusedModelCount = 0;
  let generation = 0;

  return {
    resolveMeshIdForWallet,
    clear,
    snapshot,
  };

  function clear() {
    generation += 1;
    cache.clear();
    for (const entry of modelMeshIds.values()) {
      if (entry.meshId) renderer?.removeAvatarMesh?.(entry.meshId);
    }
    modelMeshIds.clear();
  }

  function snapshot() {
    return {
      cachedWallets: cache.size,
      cachedModels: modelMeshIds.size,
      maxWalletEntries: walletLimit,
      maxModelMeshes: modelLimit,
      refusedModelCount,
    };
  }

  function resolveMeshIdForWallet(ownerWallet, { equipment = null } = {}) {
    const wallet = String(ownerWallet || "").trim();
    if (!wallet) return Promise.resolve(defaultMeshId);
    const now = performance.now();
    const cached = cache.get(wallet);
    const modelPromise = cached?.promise
      ? cached.promise
      : cached && now - cached.loadedAt < REMOTE_APPEARANCE_CACHE_MS
        ? Promise.resolve(cached.modelCode || defaultModelCode)
        : loadRemoteModelCode(wallet)
          .then((modelCode) => {
            const resolved = modelCode || defaultModelCode;
            setWalletCache(wallet, { modelCode: resolved, loadedAt: performance.now() });
            return resolved;
          })
          .catch((error) => {
            setWalletCache(wallet, { modelCode: defaultModelCode, loadedAt: performance.now(), error: readableError(error) });
            appendEvent(`Remote appearance skipped for ${shortWallet(wallet)}: ${readableError(error)}.`);
            return defaultModelCode;
          });
    if (!cached || !cached.promise && now - cached.loadedAt >= REMOTE_APPEARANCE_CACHE_MS) {
      setWalletCache(wallet, { promise: modelPromise, loadedAt: now });
    }
    return modelPromise.then((modelCode) => uploadModelCode(modelCode, {
      wallet,
      forgeRequest: remoteForgeRequest(equipment),
    })).catch((error) => {
      appendEvent(`Remote appearance skipped for ${shortWallet(wallet)}: ${readableError(error)}.`);
      return defaultMeshId;
    });
  }

  async function loadRemoteModelCode(wallet) {
    if (typeof fetchModelCode === "function") {
      return normalizeModelCode(await fetchModelCode(wallet)) || defaultModelCode;
    }
    const module = await loadPlayChainModule();
    const appearance = typeof module.fetchPlayerAppearanceForOwner === "function"
      ? await module.fetchPlayerAppearanceForOwner(wallet)
      : null;
    return normalizeModelCode(appearance?.initialized === false ? "" : appearance?.modelCode) || defaultModelCode;
  }

  async function uploadModelCode(modelCode, { wallet = "", forgeRequest = null } = {}) {
    const code = normalizeModelCode(modelCode) || defaultModelCode;
    const requestRuntimeKey = forgeRequest
      ? `ncf1:${forgeRequest.designHash.toString(16).padStart(8, "0")}:${forgePayloadIdentity(forgeRequest.bytes)}`
      : "generic";
    const requestCacheKey = `${code}|${requestRuntimeKey}`;
    const requestExisting = modelMeshIds.get(requestCacheKey);
    if (requestExisting) return requestExisting.promise;
    if (forgeRequest && modelMeshIds.size >= modelLimit) {
      refusedModelCount += 1;
      return defaultMeshId;
    }
    const forgeRuntime = await restoreRemoteForgeRuntime(forgeRequest);
    if (code === defaultModelCode && !forgeRuntime) return defaultMeshId;
    const runtimeKey = forgeRuntime ? requestRuntimeKey : "generic";
    const cacheKey = `${code}|${runtimeKey}`;
    const existing = modelMeshIds.get(cacheKey);
    if (existing) return existing.promise;
    if (!renderer?.uploadAvatarMesh) return defaultMeshId;
    if (modelMeshIds.size >= modelLimit) {
      refusedModelCount += 1;
      return defaultMeshId;
    }
    const entry = { promise: null, meshId: "" };
    const meshGeneration = generation;
    const promise = (async () => {
      const meshId = `guardian-avatar-${fnv1a32(cacheKey).toString(16).padStart(8, "0")}-${secondaryHash32(cacheKey).toString(16).padStart(8, "0")}`;
      const mesh = await loadPeasantGuyAvatarMesh({
        ncmCode: code,
        scale,
        attachIronPickaxe,
        forgeRuntime,
        name: /^NCM2:/i.test(code) ? `remote_ncm_${meshId.slice(-8)}` : "remote_avatar",
      });
      if (meshGeneration !== generation) return defaultMeshId;
      renderer.uploadAvatarMesh(meshId, mesh);
      entry.meshId = meshId;
      onStatus?.(`Remote avatar loaded for ${shortWallet(wallet)}.`);
      return meshId;
    })().catch((error) => {
      modelMeshIds.delete(cacheKey);
      throw error;
    });
    entry.promise = promise;
    modelMeshIds.set(cacheKey, entry);
    return promise;
  }

  async function restoreRemoteForgeRuntime(request) {
    if (!request?.bytes?.length) return null;
    try {
      const { restoreForgeRuntime } = await import("/chunk.js/forge/forge-runtime-cache.js");
      return restoreForgeRuntime(request.bytes, {
        expectedDesignHash: request.designHash || null,
        requireCanonical: true,
      });
    } catch {
      return null;
    }
  }

  function setWalletCache(wallet, entry) {
    cache.delete(wallet);
    cache.set(wallet, entry);
    while (cache.size > walletLimit) cache.delete(cache.keys().next().value);
  }
}

function remoteForgeRequest(equipment) {
  const designHash = Math.trunc(Number(equipment?.designHash) || 0) >>> 0;
  const bytes = validatedNcf1EquipmentPayload(equipment?.payloadBytes, designHash);
  if (!bytes) return null;
  return { designHash, bytes };
}

function normalizeModelCode(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.startsWith("NCM") ? text.slice(0, 2048) : "";
}

function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function secondaryHash32(text) {
  let hash = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x85ebca6b) >>> 0;
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new RangeError(`${label} must be a positive integer.`);
  return number;
}

function shortWallet(value) {
  const text = String(value || "").trim();
  return text.length > 10 ? `${text.slice(0, 4)}...${text.slice(-4)}` : text || "remote";
}

function readableError(error) {
  const message = String(error?.message || error || "unknown error");
  return message.length > 140 ? `${message.slice(0, 137)}...` : message;
}
