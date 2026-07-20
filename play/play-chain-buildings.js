import { loadPlayChainModule } from "./play-chain-adapter.js";
import { createPlayBuildingCache } from "./play-building-cache.js";

const BUILDING_REFRESH_MS = 60_000;
const BUILDING_RETRY_MS = 5_000;
const ZERO_BUILDING_HASH = "0".repeat(32);
const DEFAULT_VIEW_DISTANCE_CHUNKS = 7;
const DEFAULT_PRELOAD_MARGIN_CHUNKS = 2;
const DEFAULT_CHUNK_SIZE = 16;

export function createPlayChainBuildingSync({
  cache = createPlayBuildingCache(),
  getWalletAddress = () => "",
  getFoundations = () => [],
  getFoundationsNear = null,
  getFoundationVersion = null,
  getPlayerPosition = () => [0, 0, 0],
  viewDistance = DEFAULT_VIEW_DISTANCE_CHUNKS,
  preloadMargin = DEFAULT_PRELOAD_MARGIN_CHUNKS,
  chunkSize = DEFAULT_CHUNK_SIZE,
  refreshFoundations = async () => ({ ok: false }),
  announceGuardianBuilding = async () => ({ ok: false }),
  loadChainModule = loadPlayChainModule,
  applyBuildings = () => {},
  onChanged = () => {},
  onStatus = () => {},
  translate = (_key, fallback) => fallback,
} = {}) {
  let loadingPromise = null;
  let lastRefreshAt = 0;
  let retryAfterAt = 0;
  let refreshFailed = false;
  let hasSuccessfulRefresh = false;
  let lastFoundationKey = "";
  let lastContextKey = "";
  let lastAppliedBuildingKey = null;
  let currentBuildings = [];
  let refreshRequest = 0;

  return {
    refresh,
    create,
    updateForFrame,
    snapshot: () => ({
      loading: Boolean(loadingPromise),
      lastRefreshAt,
      retryAfterAt,
      refreshFailed,
      foundationKey: lastFoundationKey,
      contextKey: lastContextKey,
      buildings: currentBuildings.length,
      mode: "guardian-verified-view-cache",
    }),
  };

  function updateForFrame(now = performance.now()) {
    if (now < retryAfterAt) return null;
    const contextKey = currentContextKey();
    if (hasSuccessfulRefresh && !refreshFailed
      && contextKey === lastContextKey
      && now - lastRefreshAt < BUILDING_REFRESH_MS) return null;
    return refresh({ quiet: true, now });
  }

  async function refresh({ force = false, quiet = true, now = performance.now() } = {}) {
    if (loadingPromise) return loadingPromise;
    const attemptAt = Number.isFinite(now) ? Number(now) : performance.now();
    if (!force && attemptAt < retryAfterAt) {
      return { ok: false, cached: true, retryAt: retryAfterAt, buildings: currentBuildings };
    }
    const contextKey = currentContextKey();
    const foundations = foundationsForCurrentView();
    const foundationKey = foundationsRevisionKey(foundations);
    if (!force && hasSuccessfulRefresh && !refreshFailed
      && foundationKey === lastFoundationKey
      && attemptAt - lastRefreshAt < BUILDING_REFRESH_MS) {
      lastContextKey = contextKey;
      return { ok: true, cached: true, buildings: currentBuildings };
    }
    const request = ++refreshRequest;
    loadingPromise = performRefresh(foundations, { quiet, contextKey, request, attemptAt }).finally(() => {
      loadingPromise = null;
    });
    return loadingPromise;
  }

  async function performRefresh(foundations, { quiet, contextKey, request, attemptAt }) {
    try {
      const cached = new Map();
      const missing = [];
      const cachedBuildings = typeof cache?.getBuildings === "function"
        ? await cache.getBuildings(foundations)
        : await Promise.all(foundations.map((foundation) => cache?.getBuilding?.(foundation)));
      for (let index = 0; index < foundations.length; index += 1) {
        const foundation = foundations[index];
        const building = cachedBuildings[index];
        if (building && buildingMatchesFoundation(building, foundation)) {
          cached.set(String(foundation.foundationId), building);
        } else {
          missing.push(foundation);
        }
      }
      const loaded = new Map();
      const verifiedForCache = [];
      if (missing.length) {
        const module = await loadChainModule();
        if (typeof module.loadBuildingsForFoundations !== "function") {
          throw new Error("Building PDA batch loader is unavailable.");
        }
        const chainBuildings = await module.loadBuildingsForFoundations(missing);
        const foundationById = new Map(missing.map((foundation) => [String(foundation.foundationId), foundation]));
        for (const building of chainBuildings ?? []) {
          const foundation = foundationById.get(String(building?.foundationId));
          if (!foundation || !buildingMatchesFoundation(building, foundation)) {
            throw new Error(`Building ${building?.foundationId ?? "unknown"} failed Guardian hash verification.`);
          }
          verifiedForCache.push({ record: foundation, building });
          loaded.set(String(foundation.foundationId), building);
        }
        if (typeof cache?.putVerifiedBuildings === "function") {
          await cache.putVerifiedBuildings(verifiedForCache);
        } else {
          await Promise.all(verifiedForCache.map(({ record, building }) => cache?.putVerifiedBuilding?.(record, building)));
        }
      }
      const nextBuildings = foundations
        .map((foundation) => cached.get(String(foundation.foundationId)) ?? loaded.get(String(foundation.foundationId)))
        .filter(Boolean);
      if (request !== refreshRequest || contextKey !== currentContextKey()) {
        return { ok: true, stale: true, foundations, buildings: nextBuildings };
      }
      currentBuildings = nextBuildings;
      const appliedBuildingKey = buildingsRenderKey(currentBuildings, foundations);
      const applied = appliedBuildingKey !== lastAppliedBuildingKey;
      if (applied) {
        await Promise.resolve(applyBuildings(currentBuildings));
        lastAppliedBuildingKey = appliedBuildingKey;
      }
      lastFoundationKey = foundationsRevisionKey(foundations);
      lastContextKey = contextKey;
      lastRefreshAt = attemptAt;
      retryAfterAt = 0;
      refreshFailed = false;
      hasSuccessfulRefresh = true;
      if (applied || loaded.size) {
        onChanged({ foundations: foundations.length, buildings: currentBuildings.length, loaded: loaded.size, applied });
      }
      return { ok: true, foundations, buildings: currentBuildings, applied };
    } catch (error) {
      const reason = String(error?.message || error || "building-sync-failed");
      retryAfterAt = Math.max(retryAfterAt, attemptAt + BUILDING_RETRY_MS);
      refreshFailed = true;
      if (!quiet) onStatus(text("main.blueprint.buildingSyncFailed", "Building PDA sync failed: {reason}", { reason }));
      console.warn("[NiceChunk Building Sync]", error);
      return { ok: false, reason, error, retryAt: retryAfterAt, buildings: currentBuildings };
    }
  }

  function foundationsForCurrentView() {
    const [worldX, , worldZ] = getPlayerPosition?.() ?? [0, 0, 0];
    const centerX = finiteNumber(worldX);
    const centerZ = finiteNumber(worldZ);
    const radius = syncRadiusBlocks();
    const candidates = typeof getFoundationsNear === "function"
      ? getFoundationsNear(centerX, centerZ, radius)
      : getFoundations();
    return verifiedBuildingFoundations(candidates).filter((foundation) => foundationIntersectsView(
      foundation,
      centerX,
      centerZ,
      radius,
    ));
  }

  function currentContextKey() {
    const [worldX, , worldZ] = getPlayerPosition?.() ?? [0, 0, 0];
    const size = normalizedChunkSize();
    const centerChunkX = Math.floor(finiteNumber(worldX) / size);
    const centerChunkZ = Math.floor(finiteNumber(worldZ) / size);
    const version = typeof getFoundationVersion === "function"
      ? String(getFoundationVersion() ?? 0)
      : foundationsRevisionKey(getFoundations());
    return `${version}:${centerChunkX},${centerChunkZ}:${normalizedViewDistance()}:${normalizedPreloadMargin()}`;
  }

  function syncRadiusBlocks() {
    return (normalizedViewDistance() + normalizedPreloadMargin() + 1) * normalizedChunkSize();
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

  async function create(payload) {
    if (!getWalletAddress()) return { submitted: false, reason: "wallet-unavailable" };
    const foundation = (getFoundations() ?? []).find((candidate) => String(candidate?.foundationId) === String(payload?.foundationId));
    if (!foundation) return { submitted: false, reason: "foundation-not-found" };
    const module = await loadChainModule();
    if (typeof module.createBuildingOnChain !== "function") {
      return { submitted: false, reason: "building-chain-api-unavailable" };
    }
    const result = await module.createBuildingOnChain(payload);
    if (!result?.submitted) return result ?? { submitted: false, reason: "building-not-submitted" };
    const building = result.building ?? {};
    const revision = Math.max(1, Math.trunc(Number(building.revision) || 0));
    const contentHash = String(building.contentHash || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(contentHash)) {
      const reason = text("main.blueprint.invalidBuildingHash", "Invalid finalized building hash.");
      return { ...result, guardianIndexed: false, message: reason };
    }
    let authoritativeFoundation = null;
    if (typeof module.loadBuildSitesByIds === "function") {
      try {
        authoritativeFoundation = (await module.loadBuildSitesByIds([foundation.foundationId]))
          .find((candidate) => String(candidate?.foundationId) === String(foundation.foundationId)
            && String(candidate?.owner || "") === String(foundation.owner || "")
            && candidate?.status === "active") ?? null;
      } catch (error) {
        console.warn("[NiceChunk Building BuildSite Refresh]", error);
      }
    }
    if (!authoritativeFoundation || Number(authoritativeFoundation.activeRevision) !== revision) {
      const message = text(
        "main.blueprint.guardianIndexPending",
        "The building is on chain, but Guardian indexing is still pending: {reason}.",
        { reason: text("main.blueprint.foundationSyncPending", "BuildSite refresh pending") },
      );
      void refreshFoundations({ force: true, quiet: true });
      return { ...result, building, guardianIndexed: false, message };
    }
    const announcement = await announceGuardianBuilding({
      foundationId: authoritativeFoundation.foundationId,
      minX: authoritativeFoundation.minX,
      minZ: authoritativeFoundation.minZ,
      surfaceY: authoritativeFoundation.surfaceY,
      width: authoritativeFoundation.width,
      depth: authoritativeFoundation.depth,
      flags: 1,
      activeRevision: revision,
      contentHash,
      updatedSlot: authoritativeFoundation.updatedSlot,
    });
    if (!announcement?.ok) {
      const reason = formatFailedRegions(announcement?.failed)
        || text("main.blueprint.guardianUnavailable", "Guardian unavailable");
      const message = text(
        "main.blueprint.guardianIndexPending",
        "The building is on chain, but Guardian indexing is still pending: {reason}.",
        { reason },
      );
      return { ...result, building, guardianIndexed: false, guardianAnnouncement: announcement, message };
    }
    void refreshFoundations({ force: true, quiet: true });
    globalThis.setTimeout(async () => {
      await refreshFoundations({ force: true, quiet: true });
      await refresh({ force: true, quiet: true });
    }, 500);
    return { ...result, building, guardianIndexed: true, guardianAnnouncement: announcement };
  }

  function text(key, fallback, params = {}) {
    const value = translate?.(key, fallback, params);
    return typeof value === "string" && value !== key
      ? value
      : fallback.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ""));
  }
}

export function buildingMatchesFoundation(building, foundation) {
  const fullHash = String(building?.contentHash || "").trim().toLowerCase();
  const expectedPrefix = String(foundation?.contentHash || "").trim().toLowerCase();
  return String(building?.foundationId) === String(foundation?.foundationId)
    && String(building?.owner || "") === String(foundation?.owner || "")
    && Number(building?.revision) === Number(foundation?.activeRevision)
    && /^[0-9a-f]{64}$/.test(fullHash)
    && /^[0-9a-f]{32}$/.test(expectedPrefix)
    && expectedPrefix !== ZERO_BUILDING_HASH
    && fullHash.startsWith(expectedPrefix);
}

function verifiedBuildingFoundations(foundations = []) {
  const unique = new Map();
  for (const foundation of foundations ?? []) {
    const revision = Math.max(0, Math.trunc(Number(foundation?.activeRevision) || 0));
    const hash = String(foundation?.contentHash || "").trim().toLowerCase();
    if (!foundation?.foundationId || !revision || !/^[0-9a-f]{32}$/.test(hash) || hash === ZERO_BUILDING_HASH) continue;
    unique.set(String(foundation.foundationId), { ...foundation, activeRevision: revision, contentHash: hash });
  }
  return [...unique.values()];
}

function foundationsRevisionKey(foundations = []) {
  return verifiedBuildingFoundations(foundations)
    .map(foundationRenderKey)
    .sort()
    .join("|");
}

function buildingsRenderKey(buildings = [], foundations = []) {
  const foundationByKey = new Map(verifiedBuildingFoundations(foundations)
    .map((foundation) => [foundationIdentity(foundation.owner, foundation.foundationId), foundation]));
  return (buildings ?? []).map((building) => {
    const foundation = foundationByKey.get(foundationIdentity(building?.owner, building?.foundationId));
    return [
      foundation ? foundationRenderKey(foundation) : foundationIdentity(building?.owner, building?.foundationId),
      Math.max(0, Math.trunc(Number(building?.revision) || 0)),
      ((Math.trunc(Number(building?.quarterTurns) || 0) % 4) + 4) % 4,
      Math.max(-0x80000000, Math.min(0x7fffffff, Math.trunc(Number(building?.offsetX) || 0))),
      Math.max(-0x80000000, Math.min(0x7fffffff, Math.trunc(Number(building?.offsetZ) || 0))),
      String(building?.contentHash || "").trim().toLowerCase(),
    ].join(":");
  }).sort().join("|");
}

function foundationRenderKey(foundation) {
  return [
    foundationIdentity(foundation?.owner, foundation?.foundationId),
    Math.trunc(Number(foundation?.minX) || 0),
    Math.trunc(Number(foundation?.minZ) || 0),
    Math.trunc(Number(foundation?.surfaceY) || 0),
    Math.max(0, Math.trunc(Number(foundation?.width) || 0)),
    Math.max(0, Math.trunc(Number(foundation?.depth) || 0)),
    Math.max(0, Math.trunc(Number(foundation?.activeRevision) || 0)),
    String(foundation?.contentHash || "").trim().toLowerCase(),
  ].join(":");
}

function foundationIdentity(owner, foundationId) {
  return `${String(owner || "")}:${String(foundationId ?? "0")}`;
}

function formatFailedRegions(entries = []) {
  const labels = (entries ?? []).map((entry) => {
    const region = entry?.region ?? entry;
    const x = Number(region?.x ?? region?.regionX);
    const z = Number(region?.z ?? region?.regionZ);
    return Number.isInteger(x) && Number.isInteger(z) ? `${x},${z}` : "";
  }).filter(Boolean);
  return labels.join(" | ");
}

function foundationIntersectsView(foundation, centerX, centerZ, radius) {
  const minX = finiteNumber(foundation?.minX);
  const minZ = finiteNumber(foundation?.minZ);
  const width = Math.max(1, Math.trunc(Number(foundation?.width) || 1));
  const depth = Math.max(1, Math.trunc(Number(foundation?.depth) || 1));
  const maxX = minX + width - 1;
  const maxZ = minZ + depth - 1;
  return minX <= centerX + radius
    && maxX >= centerX - radius
    && minZ <= centerZ + radius
    && maxZ >= centerZ - radius;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
