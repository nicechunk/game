import { loadPlayChainModule } from "./play-chain-adapter.js";

const FOUNDATION_REFRESH_MS = 60_000;
const FOUNDATION_RETRY_MS = 5_000;
const PENDING_FOUNDATION_MS = 30_000;
const DEFAULT_VIEW_DISTANCE_CHUNKS = 7;
const DEFAULT_PRELOAD_MARGIN_CHUNKS = 2;
const DEFAULT_CHUNK_SIZE = 16;

export function createPlayChainFoundationSync({
  index,
  getWalletAddress = () => "",
  getPlayerPosition = () => [0, 0, 0],
  loadChainModule = loadPlayChainModule,
  viewDistance = DEFAULT_VIEW_DISTANCE_CHUNKS,
  preloadMargin = DEFAULT_PRELOAD_MARGIN_CHUNKS,
  chunkSize = DEFAULT_CHUNK_SIZE,
  onChanged = () => {},
  onStatus = () => {},
  translate = (_key, fallback) => fallback,
} = {}) {
  let loadingPromise = null;
  let lastRefreshAt = 0;
  let retryAfterAt = 0;
  let lastCenterKey = "";
  let lastScannedChunkCount = 0;
  let ownedWalletAddress = "";
  const nearbyFoundations = new Map();
  const ownedFoundations = new Map();
  const pendingFoundations = new Map();

  return {
    refresh,
    create,
    updateForFrame,
    snapshot,
    ownedList,
  };

  function updateForFrame(now = performance.now()) {
    if (loadingPromise || now < retryAfterAt) return null;
    const center = currentChunk();
    const key = chunkKey(center.chunkX, center.chunkZ);
    if (key === lastCenterKey && now - lastRefreshAt < FOUNDATION_REFRESH_MS) return null;
    return refresh({ quiet: true, now });
  }

  async function refresh({ force = false, quiet = true, now = performance.now() } = {}) {
    if (loadingPromise) return loadingPromise;
    const attemptAt = Number.isFinite(now) ? Number(now) : performance.now();
    if (!force && attemptAt < retryAfterAt) {
      return refreshResult({ ok: false, cached: true, retryAt: retryAfterAt });
    }
    const center = currentChunk();
    const key = chunkKey(center.chunkX, center.chunkZ);
    if (!force && key === lastCenterKey && attemptAt - lastRefreshAt < FOUNDATION_REFRESH_MS) {
      return refreshResult({ ok: true, cached: true });
    }
    loadingPromise = performRefresh(center, { quiet, attemptAt }).finally(() => {
      loadingPromise = null;
    });
    return loadingPromise;
  }

  async function performRefresh(center, { quiet, attemptAt }) {
    prunePendingFoundations();
    const failures = [];
    let nearbyLoaded = false;
    let ownedLoaded = false;
    let module;
    try {
      module = await loadChainModule();
    } catch (error) {
      return failRefresh(error, { quiet, attemptAt });
    }

    const chunks = chunksForCurrentView(center);
    lastScannedChunkCount = chunks.length;
    if (typeof module.loadFoundationsForChunks !== "function") {
      failures.push(new Error("FoundationChunk batch loader is unavailable."));
    } else {
      try {
        const loaded = await module.loadFoundationsForChunks(chunks);
        replaceVerifiedFoundations(nearbyFoundations, loaded);
        nearbyLoaded = true;
      } catch (error) {
        failures.push(error);
      }
    }

    const wallet = String(getWalletAddress() || "");
    if (wallet !== ownedWalletAddress) {
      ownedWalletAddress = wallet;
      ownedFoundations.clear();
    }
    if (!wallet) {
      ownedFoundations.clear();
      ownedLoaded = true;
    } else if (typeof module.loadOwnedFoundations !== "function") {
      failures.push(new Error("Owned BuildSite loader is unavailable."));
    } else {
      try {
        const loaded = await module.loadOwnedFoundations(wallet);
        replaceVerifiedFoundations(ownedFoundations, loaded, { owner: wallet, allowIndexing: true });
        ownedLoaded = true;
      } catch (error) {
        failures.push(error);
      }
    }

    rebuildIndex();
    lastCenterKey = chunkKey(center.chunkX, center.chunkZ);
    lastRefreshAt = attemptAt;
    const ok = nearbyLoaded && ownedLoaded;
    retryAfterAt = failures.length ? attemptAt + FOUNDATION_RETRY_MS : 0;
    const reason = failures.length
      ? String(failures[0]?.message || failures[0] || "foundation-sync-failed")
      : "";
    if (failures.length) {
      console.warn("[NiceChunk On-chain Foundation Sync]", failures[0]);
      if (!quiet) onStatus(text("main.land.syncFailed", "Foundation PDA sync failed: {reason}", { reason }));
    }
    const result = refreshResult({
      ok,
      partial: !ok && (nearbyLoaded || ownedLoaded),
      reason,
      count: index?.size?.() ?? 0,
      nearby: nearbyFoundations.size,
      owned: ownedFoundations.size,
      scannedChunks: chunks.length,
      failures: failures.length,
      ownedStatus: ownedLoaded ? "ready" : "error",
    });
    onChanged(result);
    return result;
  }

  function failRefresh(error, { quiet, attemptAt }) {
    const reason = String(error?.message || error || "foundation-sync-failed");
    retryAfterAt = attemptAt + FOUNDATION_RETRY_MS;
    console.warn("[NiceChunk On-chain Foundation Sync]", error);
    if (!quiet) onStatus(text("main.land.syncFailed", "Foundation PDA sync failed: {reason}", { reason }));
    rebuildIndex();
    return refreshResult({
      ok: false,
      reason,
      error,
      retryAt: retryAfterAt,
      count: index?.size?.() ?? 0,
      ownedStatus: "error",
    });
  }

  async function create(payload) {
    const wallet = String(getWalletAddress() || "");
    if (!wallet) return { submitted: false, reason: "wallet-unavailable" };
    const module = await loadChainModule();
    if (typeof module.createFoundationOnChain !== "function") {
      return { submitted: false, reason: "foundation-chain-api-unavailable" };
    }
    const result = await module.createFoundationOnChain({ ...payload });
    if (!result?.submitted) return result ?? { submitted: false, reason: "foundation-not-submitted" };
    const foundation = normalizeVerifiedFoundation({
      ...payload,
      ...result.foundation,
      owner: result.foundation?.owner || wallet,
    }, { owner: wallet });
    if (!foundation) {
      return { ...result, submitted: false, reason: "invalid-foundation-result" };
    }
    if (ownedWalletAddress !== wallet) {
      ownedWalletAddress = wallet;
      ownedFoundations.clear();
    }
    ownedFoundations.set(foundation.id, foundation);
    pendingFoundations.set(foundation.id, {
      foundation,
      expiresAt: Date.now() + PENDING_FOUNDATION_MS,
    });
    rebuildIndex();
    onChanged(refreshResult({ created: foundation, count: index?.size?.() ?? 0, ownedStatus: "ready" }));
    globalThis.setTimeout(() => void refresh({ force: true, quiet: true }), 500);
    return { ...result, foundation, indexedOnChain: true };
  }

  function replaceVerifiedFoundations(target, foundations, options = {}) {
    const next = new Map();
    for (const input of foundations ?? []) {
      const foundation = normalizeVerifiedFoundation(input, options);
      if (!foundation) continue;
      const previous = target.get(foundation.id);
      next.set(foundation.id, mergeFoundationHash(foundation, previous));
      pendingFoundations.delete(foundation.id);
    }
    target.clear();
    for (const [id, foundation] of next) target.set(id, foundation);
  }

  function rebuildIndex() {
    const merged = new Map();
    for (const foundation of ownedFoundations.values()) {
      if (foundation.status === "active" && foundation.hasActiveGeometry !== false) {
        merged.set(foundation.id, foundation);
      }
    }
    for (const foundation of nearbyFoundations.values()) {
      merged.set(foundation.id, mergeFoundationHash(foundation, merged.get(foundation.id)));
    }
    for (const { foundation } of pendingFoundations.values()) merged.set(foundation.id, foundation);
    index?.replace?.([...merged.values()]);
  }

  function prunePendingFoundations() {
    const now = Date.now();
    for (const [id, pending] of pendingFoundations) {
      if (pending.expiresAt <= now) pendingFoundations.delete(id);
    }
  }

  function currentChunk() {
    const [worldX, , worldZ] = getPlayerPosition?.() ?? [0, 0, 0];
    const size = normalizedChunkSize();
    return {
      chunkX: Math.floor(finiteNumber(worldX) / size),
      chunkZ: Math.floor(finiteNumber(worldZ) / size),
    };
  }

  function chunksForCurrentView(center) {
    const radius = normalizedViewDistance() + normalizedPreloadMargin() + 1;
    const chunks = [];
    for (let chunkZ = center.chunkZ - radius; chunkZ <= center.chunkZ + radius; chunkZ += 1) {
      for (let chunkX = center.chunkX - radius; chunkX <= center.chunkX + radius; chunkX += 1) {
        chunks.push({ chunkX, chunkZ });
      }
    }
    return chunks;
  }

  function normalizedViewDistance() {
    return Math.max(1, Math.trunc(Number(viewDistance) || DEFAULT_VIEW_DISTANCE_CHUNKS));
  }

  function normalizedPreloadMargin() {
    return Math.max(0, Math.trunc(Number(preloadMargin) || 0));
  }

  function normalizedChunkSize() {
    return Math.max(1, Math.trunc(Number(chunkSize) || DEFAULT_CHUNK_SIZE));
  }

  function snapshot() {
    return {
      loading: Boolean(loadingPromise),
      lastRefreshAt,
      retryAfterAt,
      centerChunk: lastCenterKey,
      scannedChunks: lastScannedChunkCount,
      nearby: nearbyFoundations.size,
      owned: ownedFoundations.size,
      pending: pendingFoundations.size,
      count: index?.size?.() ?? 0,
      mode: "on-chain-chunk-index",
      ownedFoundations: ownedList(),
    };
  }

  function ownedList() {
    return [...ownedFoundations.values()];
  }

  function refreshResult(result = {}) {
    return {
      ...result,
      foundations: index?.list?.() ?? [],
      ownedFoundations: ownedList(),
    };
  }

  function text(key, fallback, params = {}) {
    const value = translate?.(key, fallback, params);
    return typeof value === "string" && value !== key
      ? value
      : fallback.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ""));
  }
}

function normalizeVerifiedFoundation(input = {}, { owner = "", allowIndexing = false } = {}) {
  const foundationId = normalizeFoundationId(input.foundationId);
  const expectedOwner = String(owner || "");
  const actualOwner = String(input.owner || "");
  const status = String(input.status || "");
  if (!foundationId
    || !actualOwner
    || expectedOwner && actualOwner !== expectedOwner
    || input.accountVersion !== 3
    || status === "active" && input.hasActiveGeometry === false
    || status !== "active" && !(allowIndexing && (status === "indexing" || status === "canceling"))) {
    return null;
  }
  return {
    ...input,
    id: String(input.id || `${actualOwner}:${foundationId}`),
    owner: actualOwner,
    foundationId,
  };
}

function mergeFoundationHash(primary, fallback) {
  const hash = normalizeBuildingHash(primary?.contentHash);
  if (hash) return { ...primary, contentHash: hash };
  const fallbackHash = normalizeBuildingHash(fallback?.contentHash);
  return fallbackHash ? { ...primary, contentHash: fallbackHash } : primary;
}

function normalizeBuildingHash(value) {
  const hash = String(value || "").trim().toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{64}$/.test(hash) && !/^0+$/.test(hash) ? hash : "";
}

function normalizeFoundationId(value) {
  try {
    const id = BigInt(value ?? 0);
    return id > 0n && id <= 0xffffffffffffffffn ? id.toString() : "";
  } catch {
    return "";
  }
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function chunkKey(chunkX, chunkZ) {
  return `${Math.trunc(chunkX)},${Math.trunc(chunkZ)}`;
}
