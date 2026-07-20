import { loadPlayChainModule } from "./play-chain-adapter.js";
import { createPlayBuildingCache } from "./play-building-cache.js";
import { decodeGuardianBuildingManifestBinary } from "./play-guardian-client.js";
import { chunkToGuardianRegion } from "./play-guardian-registry.js";

const FOUNDATION_REFRESH_MS = 60_000;
const GUARDIAN_REGION_SIZE_CHUNKS = 100;
const MANIFEST_FETCH_TIMEOUT_MS = 6_000;
const ZERO_BUILDING_HASH = "0".repeat(32);
const FORCE_GUARDIAN_MANIFEST_REVISION = "18446744073709551615";
const PENDING_FOUNDATION_MS = 30_000;

export function createPlayChainFoundationSync({
  index,
  cache = createPlayBuildingCache(),
  getWalletAddress = () => "",
  getBlueprintIds = () => [],
  getPlayerPosition = () => [0, 0, 0],
  getGuardianRegion = () => null,
  ensureGuardianNeighborhood = async () => [],
  refreshGuardianRegions = async () => [],
  ensureGuardianCoverage = async () => ({ ok: false, missing: [] }),
  requestCurrentGuardianManifest = () => false,
  announceGuardianBuilding = async () => ({ ok: false }),
  loadChainModule = loadPlayChainModule,
  fetchImpl = (...args) => globalThis.fetch(...args),
  chunkSize = 16,
  onChanged = () => {},
  onStatus = () => {},
  translate = (_key, fallback) => fallback,
} = {}) {
  let loadingPromise = null;
  let lastRefreshAt = 0;
  let lastCenterKey = "";
  const regionStates = new Map();
  const regionDigests = new Map();
  const regionTasks = new Map();
  const regionDigestRetries = new Map();
  const ownedFoundations = new Map();
  const pendingFoundations = new Map();
  let ownedWalletAddress = "";

  return {
    refresh,
    create,
    resize,
    updateForFrame,
    handleRegionDigest,
    handleRegionManifest,
    snapshot,
  };

  function updateForFrame(now = performance.now()) {
    const center = currentChunk();
    const key = guardianCenterKey(center.chunkX, center.chunkZ);
    if (key === lastCenterKey && now - lastRefreshAt < FOUNDATION_REFRESH_MS) return null;
    return refresh({ quiet: true });
  }

  async function refresh({ force = false, quiet = true } = {}) {
    if (loadingPromise) return loadingPromise;
    const center = currentChunk();
    const key = guardianCenterKey(center.chunkX, center.chunkZ);
    const now = performance.now();
    if (!force && key === lastCenterKey && now - lastRefreshAt < FOUNDATION_REFRESH_MS) {
      return { ok: true, cached: true, count: index?.size?.() ?? 0 };
    }
    loadingPromise = performRefresh(center, { quiet }).finally(() => {
      loadingPromise = null;
    });
    return loadingPromise;
  }

  async function performRefresh(center, { quiet }) {
    let ownedResult;
    try {
      ownedResult = await syncOwnedFoundations();
    } catch (error) {
      ownedResult = { ok: false, reason: String(error?.message || error), error };
      console.warn("[NiceChunk Owned Foundation Sync]", error);
    }
    prunePendingFoundations();
    rebuildIndex();
    try {
      const entries = await ensureGuardianNeighborhood(center);
      if (!Array.isArray(entries) || !entries.length) {
        lastCenterKey = guardianCenterKey(center.chunkX, center.chunkZ);
        lastRefreshAt = performance.now();
        onChanged({
          count: index?.size?.() ?? 0,
          regions: regionStates.size,
          owned: ownedFoundations.size,
          failures: ownedResult.ok ? 0 : 1,
        });
        if (!ownedResult.ok && !quiet) {
          onStatus(text("main.blueprint.syncFailed", "Foundation PDA sync failed: {reason}", {
            reason: ownedResult.reason,
          }));
        }
        return {
          ok: ownedResult.ok && ownedFoundations.size > 0,
          partial: ownedFoundations.size > 0,
          reason: "guardian-neighborhood-unavailable",
          count: index?.size?.() ?? 0,
          owned: ownedFoundations.size,
          foundations: index?.list?.() ?? [],
        };
      }
      const nextRegionKeys = new Set(entries.map((entry) => regionKey(entry?.region)).filter(Boolean));
      for (const key of regionStates.keys()) {
        if (!nextRegionKeys.has(key)) regionStates.delete(key);
      }
      const jobs = [];
      for (const entry of entries) {
        const key = regionKey(entry?.region);
        if (!key) continue;
        if (entry?.ok && entry?.buildingsUrl) {
          jobs.push(queueRegionTask(key, () => syncRegionFromHttp(entry)));
        } else if (entry?.status === "missing") {
          regionStates.delete(key);
          await cache?.deleteRegion?.(entry.region.x, entry.region.z);
        }
      }
      const settled = await Promise.allSettled(jobs);
      const failures = settled.filter((result) => result.status === "rejected");
      prunePendingFoundations();
      rebuildIndex();
      lastCenterKey = guardianCenterKey(center.chunkX, center.chunkZ);
      lastRefreshAt = performance.now();
      onChanged({
        count: index?.size?.() ?? 0,
        regions: regionStates.size,
        owned: ownedFoundations.size,
        failures: failures.length + (ownedResult.ok ? 0 : 1),
      });
      if ((failures.length || !ownedResult.ok) && !quiet) {
        const reason = !ownedResult.ok
          ? ownedResult.reason
          : String(failures[0].reason?.message || failures[0].reason || "guardian-manifest-unavailable");
        onStatus(text("main.blueprint.syncFailed", "Foundation PDA sync failed: {reason}", { reason }));
      }
      const guardianOk = failures.length < jobs.length || jobs.length === 0;
      return {
        ok: guardianOk && ownedResult.ok,
        count: index?.size?.() ?? 0,
        regions: regionStates.size,
        owned: ownedFoundations.size,
        failures: failures.length + (ownedResult.ok ? 0 : 1),
        foundations: index?.list?.() ?? [],
      };
    } catch (error) {
      const reason = String(error?.message || error || "foundation-sync-failed");
      if (!quiet) onStatus(text("main.blueprint.syncFailed", "Foundation PDA sync failed: {reason}", { reason }));
      console.warn("[NiceChunk Foundation Sync]", error);
      lastCenterKey = guardianCenterKey(center.chunkX, center.chunkZ);
      lastRefreshAt = performance.now();
      rebuildIndex();
      onChanged({
        count: index?.size?.() ?? 0,
        regions: regionStates.size,
        owned: ownedFoundations.size,
        failures: 1 + (ownedResult.ok ? 0 : 1),
      });
      return {
        ok: ownedResult.ok && ownedFoundations.size > 0,
        partial: ownedFoundations.size > 0,
        reason,
        error,
        count: index?.size?.() ?? 0,
        owned: ownedFoundations.size,
        foundations: index?.list?.() ?? [],
      };
    }
  }

  async function syncOwnedFoundations() {
    const wallet = String(getWalletAddress() || "");
    if (wallet !== ownedWalletAddress) {
      ownedFoundations.clear();
      ownedWalletAddress = wallet;
    }
    const rawIds = getBlueprintIds?.();
    const ids = [...new Set((Array.isArray(rawIds) ? rawIds : [])
      .map(normalizeBlueprintId)
      .filter(Boolean))];
    if (!wallet || !ids.length) {
      ownedFoundations.clear();
      return { ok: true, skipped: true, count: 0 };
    }
    const module = await loadChainModule();
    if (typeof module.loadBuildSitesByIds !== "function") {
      throw new Error("BuildSite batch loader is unavailable.");
    }
    const loaded = await module.loadBuildSitesByIds(ids);
    const allowedIds = new Set(ids);
    const next = new Map();
    for (const foundation of loaded ?? []) {
      const id = normalizeBlueprintId(foundation?.foundationId);
      if (!id
        || !allowedIds.has(id)
        || foundation?.owner !== wallet
        || foundation?.status === "removed"
        || foundation?.hasActiveGeometry === false) continue;
      const previous = ownedFoundations.get(id);
      const preservedHash = previous
        && Number(previous.activeRevision ?? 0) === Number(foundation.activeRevision ?? 0)
        ? foundationContentHash(previous)
        : ZERO_BUILDING_HASH;
      next.set(id, preservedHash === ZERO_BUILDING_HASH
        ? foundation
        : { ...foundation, contentHash: preservedHash });
      pendingFoundations.delete(id);
    }
    ownedFoundations.clear();
    for (const [id, foundation] of next) ownedFoundations.set(id, foundation);
    return { ok: true, count: ownedFoundations.size, requested: ids.length };
  }

  async function syncRegionFromHttp(entry) {
    const { x: regionX, z: regionZ } = entry.region;
    const key = regionKey(entry.region);
    const cached = await cache?.getRegion?.(regionX, regionZ);
    const chainDigest = guardianBlueprintDigest(entry);
    if (!chainDigest) {
      regionStates.delete(key);
      return { ok: false, reason: "guardian-blueprint-uncommitted" };
    }
    if (cached && blueprintHashMatchesCache(chainDigest, cached)) {
      applyCachedRegion(cached);
      return { ok: true, cached: true, source: "guardian-chain-hash" };
    }
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = globalThis.setTimeout(() => controller?.abort?.(), MANIFEST_FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(entry.buildingsUrl, {
        method: "GET",
        headers: {},
        cache: "no-store",
        signal: controller?.signal,
      });
      if (response.status === 304) {
        throw new Error("Guardian returned 304 for a changed on-chain blueprint hash.");
      }
      if (!response.ok) throw new Error(`Guardian building manifest HTTP ${response.status}`);
      const manifest = await decodeGuardianBuildingManifestBinary(await response.arrayBuffer());
      if (manifest.regionX !== regionX || manifest.regionZ !== regionZ) {
        throw new Error("Guardian building manifest region mismatch.");
      }
      const etag = normalizeEtag(response.headers?.get?.("etag"));
      if (etag && etag !== manifest.hash) throw new Error("Guardian building manifest ETag mismatch.");
      requireManifestMatchesGuardian(manifest, entry);
      await verifyAndApplyManifest(manifest, entry);
      return { ok: true, cached: false, source: "guardian-http" };
    } catch (error) {
      if (cached && blueprintHashMatchesCache(chainDigest, cached)) {
        applyCachedRegion(cached);
        return { ok: true, cached: true, stale: true, error };
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  async function handleRegionDigest(input = {}) {
    let digest;
    try {
      digest = normalizeDigest(input);
    } catch (error) {
      console.warn("[NiceChunk Guardian Building Digest]", error);
      return { ok: false, reason: "invalid-guardian-digest", error };
    }
    const key = regionKey(digest);
    if (regionDigests.get(key)?.hash !== digest.hash) clearRegionDigestRetry(key);
    regionDigests.set(key, digest);
    return queueRegionTask(key, async () => {
      let entry = getGuardianRegion(digest.regionX, digest.regionZ);
      if (!guardianBlueprintMatchesDigest(entry, digest)) {
        await refreshGuardianRegions([{ x: digest.regionX, z: digest.regionZ }]);
        entry = getGuardianRegion(digest.regionX, digest.regionZ);
      }
      if (!guardianBlueprintMatchesDigest(entry, digest)) {
        scheduleRegionDigestRetry(key, digest);
        return { ok: false, reason: "guardian-blueprint-chain-pending" };
      }
      clearRegionDigestRetry(key);
      const cached = await cache?.getRegion?.(digest.regionX, digest.regionZ);
      if (cached && blueprintHashMatchesCache(digest, cached)) {
        applyCachedRegion(cached);
        rebuildIndex();
        onChanged({ region: key, cached: true, count: index?.size?.() ?? 0 });
        return { ok: true, cached: true };
      }
      if (requestCurrentGuardianManifest(FORCE_GUARDIAN_MANIFEST_REVISION)) {
        return { ok: true, requested: true };
      }
      if (!entry?.ok || !entry?.buildingsUrl) return { ok: false, reason: "guardian-region-unavailable" };
      const result = await syncRegionFromHttp(entry);
      rebuildIndex();
      onChanged({ region: key, cached: Boolean(result.cached), count: index?.size?.() ?? 0 });
      return result;
    });
  }

  async function handleRegionManifest(input = {}) {
    let manifest;
    try {
      manifest = normalizeManifest(input);
    } catch (error) {
      console.warn("[NiceChunk Guardian Building Manifest]", error);
      return { ok: false, reason: "invalid-guardian-manifest", error };
    }
    const key = regionKey(manifest);
    const entry = getGuardianRegion(manifest.regionX, manifest.regionZ);
    if (!entry?.ok || !entry?.url || input.endpoint && normalizeUrl(input.endpoint) !== normalizeUrl(entry.url)) {
      return { ok: false, reason: "untrusted-guardian-manifest-source" };
    }
    try {
      requireManifestMatchesGuardian(manifest, entry);
    } catch (error) {
      return { ok: false, reason: "guardian-manifest-chain-hash-mismatch", error };
    }
    const digest = regionDigests.get(key);
    if (digest && (digest.hash !== manifest.hash || digest.revision !== manifest.revision)) {
      return { ok: false, reason: "guardian-manifest-digest-mismatch" };
    }
    return queueRegionTask(key, async () => {
      await verifyAndApplyManifest(manifest, entry);
      rebuildIndex();
      onChanged({ region: key, cached: false, count: index?.size?.() ?? 0 });
      return { ok: true, count: manifest.records.length };
    }).catch((error) => {
      console.warn("[NiceChunk Guardian Building Manifest]", error);
      return { ok: false, reason: String(error?.message || error), error };
    });
  }

  async function verifyAndApplyManifest(input, entry) {
    const manifest = normalizeManifest(input);
    if (manifest.regionX !== entry.region.x || manifest.regionZ !== entry.region.z) {
      throw new Error("Guardian building manifest region mismatch.");
    }
    requireManifestStillCurrent(manifest, entry);
    const records = manifest.records.map((record) => normalizeGuardianRecord(record, manifest));
    const ids = new Set();
    for (const record of records) {
      if (ids.has(record.foundationId)) throw new Error("Guardian building manifest contains duplicate foundation IDs.");
      ids.add(record.foundationId);
      if (!recordIntersectsGuardianRegion(record, manifest.regionX, manifest.regionZ, chunkSize)) {
        throw new Error("Guardian building record does not intersect its region.");
      }
    }
    const cached = await cache?.getRegion?.(manifest.regionX, manifest.regionZ);
    const previousRecords = new Map((cached?.records ?? []).map((record) => [String(record.foundationId), record]));
    const previousFoundations = new Map((cached?.foundations ?? []).map((foundation) => [String(foundation.foundationId), foundation]));
    const foundationsById = new Map();
    const changedRecords = [];
    for (const record of records) {
      const previousRecord = previousRecords.get(record.foundationId);
      const previousFoundation = previousFoundations.get(record.foundationId);
      if (previousRecord && previousFoundation
        && guardianRecordsMatch(previousRecord, record)
        && guardianRecordMatchesFoundation(record, previousFoundation)) {
        foundationsById.set(record.foundationId, verifiedFoundationForManifest(previousFoundation, record, manifest));
      } else {
        changedRecords.push(record);
      }
    }
    if (changedRecords.length) {
      const module = await loadChainModule();
      if (typeof module.loadBuildSitesByIds !== "function") {
        throw new Error("BuildSite batch loader is unavailable.");
      }
      const loaded = await module.loadBuildSitesByIds(changedRecords.map((record) => record.foundationId));
      const byId = new Map((loaded ?? []).map((foundation) => [String(foundation.foundationId), foundation]));
      for (const record of changedRecords) {
        const foundation = byId.get(record.foundationId);
        if (!foundation || !guardianRecordMatchesFoundation(record, foundation)) {
          throw new Error(`Guardian foundation ${record.foundationId} failed BuildSite verification.`);
        }
        foundationsById.set(record.foundationId, verifiedFoundationForManifest(foundation, record, manifest));
      }
    }
    requireManifestStillCurrent(manifest, entry);
    const foundations = records.map((record) => foundationsById.get(record.foundationId));
    const verified = await cache?.putVerifiedRegion?.({ ...manifest, records }, foundations) ?? {
      ...manifest,
      foundations,
      verified: true,
    };
    requireManifestStillCurrent(manifest, entry);
    regionStates.set(regionKey(manifest), verified);
    for (const foundation of foundations) pendingFoundations.delete(String(foundation.foundationId));
    return verified;
  }

  function requireManifestStillCurrent(manifest, fallbackEntry) {
    const current = getGuardianRegion(manifest.regionX, manifest.regionZ);
    if (current) {
      requireManifestMatchesGuardian(manifest, current);
      return;
    }
    requireManifestMatchesGuardian(manifest, fallbackEntry);
    const digest = regionDigests.get(regionKey(manifest));
    if (digest && (digest.hash !== manifest.hash
      || digest.revision !== manifest.revision
      || digest.recordCount !== manifest.recordCount)) {
      throw new Error("Guardian building manifest became stale during verification.");
    }
  }

  async function create(payload) {
    const wallet = String(getWalletAddress() || "");
    if (!wallet) return { submitted: false, reason: "wallet-unavailable" };
    const blueprintId = normalizeBlueprintId(payload?.blueprintId ?? payload?.foundationId);
    if (!blueprintId) return { submitted: false, reason: "blueprint-id-required" };
    const existing = (index?.list?.() ?? []).find((foundation) => (
      foundation.owner === wallet
      && String(foundation.foundationId) === blueprintId
      && foundation.status !== "removed"
    ));
    if (existing) {
      return {
        submitted: false,
        reason: "foundation-already-bound",
        foundation: existing,
        message: text("main.blueprint.foundationLocked", "This blueprint is permanently bound to its foundation."),
      };
    }
    const request = { ...payload, blueprintId };
    const coverage = await ensureGuardianCoverage(request);
    if (!coverage?.ok) {
      const regions = formatMissingRegions(coverage?.missing)
        || text("main.blueprint.guardianUnavailable", "Guardian unavailable");
      const message = text(
        "main.blueprint.guardianCoverageRequired",
        "Every Guardian region covered by this foundation must be active. Missing: {regions}.",
        { regions },
      );
      return { submitted: false, reason: "guardian-coverage-required", message, coverage };
    }
    const module = await loadChainModule();
    if (typeof module.createFoundationOnChain !== "function") {
      return { submitted: false, reason: "foundation-chain-api-unavailable" };
    }
    const result = await module.createFoundationOnChain(request);
    if (!result?.submitted) return result ?? { submitted: false, reason: "foundation-not-submitted" };
    const foundation = {
      ...request,
      ...result.foundation,
      activeRevision: Math.max(0, Math.trunc(Number(result.foundation?.activeRevision) || 0)),
      pendingRevision: Math.max(0, Math.trunc(Number(result.foundation?.pendingRevision) || 0)),
      contentHash: String(result.foundation?.contentHash || ZERO_BUILDING_HASH),
    };
    if (ownedWalletAddress !== wallet) {
      ownedFoundations.clear();
      ownedWalletAddress = wallet;
    }
    ownedFoundations.set(String(foundation.foundationId), foundation);
    pendingFoundations.set(String(foundation.foundationId), {
      foundation,
      expiresAt: Date.now() + PENDING_FOUNDATION_MS,
    });
    rebuildIndex();
    onChanged({ created: foundation, count: index?.size?.() ?? 0 });
    const announcement = await announceGuardianBuilding(guardianRecordForFoundation(foundation));
    if (!announcement?.ok) {
      const reason = formatMissingRegions(announcement?.failed)
        || text("main.blueprint.guardianUnavailable", "Guardian unavailable");
      const message = text(
        "main.blueprint.guardianIndexPending",
        "The foundation is on chain, but Guardian indexing is still pending: {reason}.",
        { reason },
      );
      return { ...result, foundation, guardianIndexed: false, guardianAnnouncement: announcement, message };
    }
    void refresh({ force: true, quiet: true });
    globalThis.setTimeout(() => void refresh({ force: true, quiet: true }), 500);
    return { ...result, foundation, guardianIndexed: true, guardianAnnouncement: announcement };
  }

  async function resize(payload) {
    const wallet = String(getWalletAddress() || "");
    if (!wallet) return { submitted: false, reason: "wallet-unavailable" };
    const blueprintId = normalizeBlueprintId(payload?.blueprintId ?? payload?.foundationId);
    if (!blueprintId) return { submitted: false, reason: "blueprint-id-required" };
    const existing = (index?.list?.() ?? []).find((foundation) => (
      foundation.owner === wallet
      && String(foundation.foundationId) === blueprintId
      && foundation.status !== "removed"
    ));
    if (!existing) return { submitted: false, reason: "foundation-not-found" };
    const request = {
      ...existing,
      ...payload,
      blueprintId,
      foundationId: blueprintId,
      minX: existing.minX,
      minZ: existing.minZ,
      surfaceY: existing.surfaceY,
    };
    const coverage = await ensureGuardianCoverage(request);
    if (!coverage?.ok) {
      const regions = formatMissingRegions(coverage?.missing)
        || text("main.blueprint.guardianUnavailable", "Guardian unavailable");
      const message = text(
        "main.blueprint.guardianCoverageRequired",
        "Every Guardian region covered by this foundation must be active. Missing: {regions}.",
        { regions },
      );
      return { submitted: false, reason: "guardian-coverage-required", message, coverage };
    }
    const module = await loadChainModule();
    if (typeof module.resizeFoundationOnChain !== "function") {
      return { submitted: false, reason: "foundation-resize-api-unavailable" };
    }
    const result = await module.resizeFoundationOnChain(request);
    if (!result?.submitted) return result ?? { submitted: false, reason: "foundation-not-resized" };
    const foundation = {
      ...existing,
      ...result.foundation,
      status: "active",
      contentHash: String(result.foundation?.contentHash || existing.contentHash || ZERO_BUILDING_HASH),
    };
    ownedFoundations.set(blueprintId, foundation);
    pendingFoundations.set(blueprintId, {
      foundation,
      expiresAt: Date.now() + PENDING_FOUNDATION_MS,
    });
    rebuildIndex();
    onChanged({ resized: foundation, count: index?.size?.() ?? 0 });
    const announcement = await announceGuardianBuilding(
      guardianRecordForFoundation(foundation),
      { previousRecord: guardianRecordForFoundation(existing) },
    );
    void refresh({ force: true, quiet: true });
    globalThis.setTimeout(() => void refresh({ force: true, quiet: true }), 500);
    return {
      ...result,
      foundation,
      guardianIndexed: Boolean(announcement?.ok),
      guardianAnnouncement: announcement,
    };
  }

  function applyCachedRegion(cached) {
    const recordsById = new Map((cached?.records ?? []).map((record) => [String(record.foundationId), record]));
    const foundations = (cached?.foundations ?? []).map((foundation) => {
      const record = recordsById.get(String(foundation?.foundationId));
      if (foundationContentHash(foundation) !== ZERO_BUILDING_HASH
        || !record
        || !guardianRecordMatchesFoundation(record, foundation)) return foundation;
      return { ...foundation, contentHash: foundationContentHash(record) };
    });
    regionStates.set(`${cached.regionX},${cached.regionZ}`, { ...cached, foundations });
  }

  function rebuildIndex() {
    const merged = new Map();
    const conflicted = new Set();
    for (const state of regionStates.values()) {
      for (const foundation of state?.foundations ?? []) mergeFoundation(merged, conflicted, foundation);
    }
    for (const foundation of ownedFoundations.values()) overrideFoundation(merged, conflicted, foundation);
    for (const entry of pendingFoundations.values()) overrideFoundation(merged, conflicted, entry.foundation);
    for (const id of conflicted) merged.delete(id);
    index?.replace?.([...merged.values()]);
  }

  function prunePendingFoundations() {
    const now = Date.now();
    for (const [id, entry] of pendingFoundations) {
      if (entry.expiresAt <= now) pendingFoundations.delete(id);
    }
  }

  function currentChunk() {
    const [x, , z] = getPlayerPosition();
    const size = Math.max(1, Math.trunc(Number(chunkSize) || 16));
    return { chunkX: Math.floor(Number(x || 0) / size), chunkZ: Math.floor(Number(z || 0) / size) };
  }

  function snapshot() {
    return {
      loading: Boolean(loadingPromise),
      lastRefreshAt,
      centerKey: lastCenterKey,
      regions: regionStates.size,
      digests: regionDigests.size,
      owned: ownedFoundations.size,
      pending: pendingFoundations.size,
      count: index?.size?.() ?? 0,
      mode: "guardian-regional-manifest",
    };
  }

  function text(key, fallback, params = {}) {
    const value = translate?.(key, fallback, params);
    return typeof value === "string" && value !== key
      ? value
      : fallback.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ""));
  }

  function queueRegionTask(key, task) {
    const previous = regionTasks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task).finally(() => {
      if (regionTasks.get(key) === next) regionTasks.delete(key);
    });
    regionTasks.set(key, next);
    return next;
  }

  function scheduleRegionDigestRetry(key, digest) {
    const current = regionDigestRetries.get(key) ?? { attempts: 0, timer: 0 };
    if (current.timer || current.attempts >= 5) return;
    const delay = Math.min(30_000, 1_500 * (2 ** current.attempts));
    current.attempts += 1;
    current.timer = globalThis.setTimeout(() => {
      current.timer = 0;
      void handleRegionDigest(digest);
    }, delay);
    regionDigestRetries.set(key, current);
  }

  function clearRegionDigestRetry(key) {
    const current = regionDigestRetries.get(key);
    if (current?.timer) globalThis.clearTimeout(current.timer);
    regionDigestRetries.delete(key);
  }
}

export function guardianRecordMatchesFoundation(record, foundation) {
  const recordUpdatedSlot = String(record?.updatedSlot ?? "0");
  const foundationUpdatedSlot = String(foundation?.updatedSlot ?? "0");
  return String(record?.foundationId) === String(foundation?.foundationId)
    && Number(record?.minX) === Number(foundation?.minX)
    && Number(record?.minZ) === Number(foundation?.minZ)
    && Number(record?.surfaceY) === Number(foundation?.surfaceY)
    && Number(record?.width) === Number(foundation?.width)
    && Number(record?.depth) === Number(foundation?.depth)
    && Number(record?.activeRevision) === Number(foundation?.activeRevision ?? 0)
    && (recordUpdatedSlot === "0" || recordUpdatedSlot === foundationUpdatedSlot)
    && foundation?.status !== "removed";
}

export function recordIntersectsGuardianRegion(record, regionX, regionZ, chunkSize = 16) {
  const size = Math.max(1, Math.trunc(Number(chunkSize) || 16));
  const regionSpan = GUARDIAN_REGION_SIZE_CHUNKS * size;
  const minX = Math.trunc(regionX) * regionSpan;
  const minZ = Math.trunc(regionZ) * regionSpan;
  const maxX = minX + regionSpan - 1;
  const maxZ = minZ + regionSpan - 1;
  return record.minX <= maxX && record.maxX >= minX && record.minZ <= maxZ && record.maxZ >= minZ;
}

function normalizeDigest(input) {
  return {
    regionX: requireI32(input.regionX, "regionX"),
    regionZ: requireI32(input.regionZ, "regionZ"),
    revision: requireU64String(input.revision ?? 0, "revision", { allowZero: true }),
    recordCount: requireU32(input.recordCount ?? 0, "recordCount"),
    hash: requireHash(input.hash),
    endpoint: String(input.endpoint || ""),
  };
}

function normalizeManifest(input) {
  const records = Array.isArray(input?.records) ? input.records : [];
  const manifest = {
    ...normalizeDigest({ ...input, recordCount: input?.recordCount ?? records.length }),
    records,
    source: String(input?.source || "guardian"),
  };
  if (manifest.recordCount !== records.length) throw new Error("Guardian building manifest record count mismatch.");
  return manifest;
}

function normalizeGuardianRecord(input, manifest) {
  const minX = requireI32(input?.minX, "minX");
  const minZ = requireI32(input?.minZ, "minZ");
  const width = requireU32(input?.width, "width");
  const depth = requireU32(input?.depth, "depth");
  const activeRevision = requireU32(input?.activeRevision ?? 0, "activeRevision");
  const updatedSlot = requireU64String(input?.updatedSlot ?? 0, "updatedSlot", { allowZero: true });
  const contentHash = requireHash(input?.contentHash);
  const flags = requireU16(input?.flags ?? 1, "flags");
  const maxX = minX + width - 1;
  const maxZ = minZ + depth - 1;
  if (flags !== 1 || width < 2 || depth < 2 || maxX > 0x7fffffff || maxZ > 0x7fffffff) {
    throw new Error("Invalid Guardian building record geometry.");
  }
  if (activeRevision === 0 && contentHash !== ZERO_BUILDING_HASH
    || activeRevision > 0 && contentHash === ZERO_BUILDING_HASH) {
    throw new Error("Guardian building revision hash mismatch.");
  }
  return {
    foundationId: requireU64String(input?.foundationId, "foundationId"),
    minX,
    minZ,
    maxX,
    maxZ,
    surfaceY: requireI16(input?.surfaceY, "surfaceY"),
    flags,
    width,
    depth,
    activeRevision,
    contentHash,
    updatedSlot,
    manifestHash: manifest.hash,
  };
}

function guardianRecordForFoundation(foundation) {
  return {
    foundationId: String(foundation.foundationId),
    minX: Math.trunc(foundation.minX),
    minZ: Math.trunc(foundation.minZ),
    surfaceY: Math.trunc(foundation.surfaceY),
    width: Math.trunc(foundation.width),
    depth: Math.trunc(foundation.depth),
    flags: 1,
    activeRevision: Math.max(0, Math.trunc(Number(foundation.activeRevision) || 0)),
    contentHash: String(foundation.contentHash || ZERO_BUILDING_HASH),
    updatedSlot: String(foundation.updatedSlot ?? "0"),
  };
}

function blueprintHashMatchesCache(digest, cached) {
  return Boolean(digest && cached && String(digest.hash || "").toLowerCase() === String(cached.hash || "").toLowerCase());
}

function guardianBlueprintDigest(entry) {
  const hash = String(entry?.guardian?.blueprintHash || "").trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hash) || /^0+$/.test(hash)) return null;
  return {
    regionX: requireI32(entry?.region?.x, "regionX"),
    regionZ: requireI32(entry?.region?.z, "regionZ"),
    hash,
    revision: requireU64String(entry?.guardian?.blueprintRevision ?? 0, "revision", { allowZero: true }),
    recordCount: requireU32(entry?.guardian?.blueprintRecordCount ?? 0, "recordCount"),
  };
}

function guardianBlueprintMatchesDigest(entry, digest) {
  const chain = guardianBlueprintDigest(entry);
  return Boolean(chain && digest && chain.hash === digest.hash
    && chain.revision === digest.revision
    && chain.recordCount === digest.recordCount);
}

function requireManifestMatchesGuardian(manifest, entry) {
  const chain = guardianBlueprintDigest(entry);
  if (!chain || chain.hash !== manifest.hash
    || chain.revision !== manifest.revision
    || chain.recordCount !== manifest.recordCount) {
    throw new Error("Guardian building manifest does not match its on-chain blueprint metadata.");
  }
}

export function guardianRecordsMatch(left, right) {
  return String(left?.foundationId) === String(right?.foundationId)
    && Number(left?.minX) === Number(right?.minX)
    && Number(left?.minZ) === Number(right?.minZ)
    && Number(left?.surfaceY) === Number(right?.surfaceY)
    && Number(left?.flags) === Number(right?.flags)
    && Number(left?.width) === Number(right?.width)
    && Number(left?.depth) === Number(right?.depth)
    && Number(left?.activeRevision) === Number(right?.activeRevision)
    && String(left?.updatedSlot ?? "0") === String(right?.updatedSlot ?? "0")
    && String(left?.contentHash || "").toLowerCase() === String(right?.contentHash || "").toLowerCase();
}

function verifiedFoundationForManifest(foundation, record, manifest) {
  return {
    ...foundation,
    contentHash: record.contentHash,
    guardianManifestHash: manifest.hash,
    guardianRegion: `${manifest.regionX},${manifest.regionZ}`,
  };
}

function mergeFoundation(merged, conflicted, foundation) {
  const id = String(foundation?.foundationId || "");
  if (!id || conflicted.has(id)) return;
  const previous = merged.get(id);
  if (!previous) {
    merged.set(id, foundation);
    return;
  }
  if (foundationCoreIdentity(previous) !== foundationCoreIdentity(foundation)) {
    const order = compareFoundationUpdatedSlot(foundation, previous);
    if (order > 0) merged.set(id, foundation);
    else if (order === 0) {
      conflicted.add(id);
      merged.delete(id);
    }
    return;
  }
  const previousHash = foundationContentHash(previous);
  const nextHash = foundationContentHash(foundation);
  if (previousHash !== ZERO_BUILDING_HASH && nextHash !== ZERO_BUILDING_HASH && previousHash !== nextHash) {
    conflicted.add(id);
    merged.delete(id);
    return;
  }
  if (previousHash === ZERO_BUILDING_HASH && nextHash !== ZERO_BUILDING_HASH) merged.set(id, foundation);
}

function overrideFoundation(merged, conflicted, foundation) {
  const id = String(foundation?.foundationId || "");
  if (!id) return;
  conflicted.delete(id);
  const previous = merged.get(id);
  const preserveVerifiedHash = previous
    && Number(previous.activeRevision ?? 0) === Number(foundation.activeRevision ?? 0)
    && foundationContentHash(foundation) === ZERO_BUILDING_HASH
    && foundationContentHash(previous) !== ZERO_BUILDING_HASH;
  merged.set(id, preserveVerifiedHash
    ? { ...previous, ...foundation, contentHash: foundationContentHash(previous) }
    : foundation);
}

function foundationCoreIdentity(foundation) {
  return [
    foundation.owner,
    foundation.foundationId,
    foundation.minX,
    foundation.minZ,
    foundation.surfaceY,
    foundation.width,
    foundation.depth,
    foundation.activeRevision ?? 0,
  ].join(":");
}

function foundationContentHash(foundation) {
  const hash = String(foundation?.contentHash || "").trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(hash) ? hash : ZERO_BUILDING_HASH;
}

function compareFoundationUpdatedSlot(left, right) {
  try {
    const leftSlot = BigInt(left?.updatedSlot ?? 0);
    const rightSlot = BigInt(right?.updatedSlot ?? 0);
    return leftSlot === rightSlot ? 0 : leftSlot > rightSlot ? 1 : -1;
  } catch {
    return 0;
  }
}

function guardianCenterKey(chunkX, chunkZ) {
  const region = chunkToGuardianRegion(chunkX, chunkZ);
  return `${region.x},${region.z}`;
}

function regionKey(region) {
  const x = Number(region?.regionX ?? region?.x);
  const z = Number(region?.regionZ ?? region?.z);
  return Number.isInteger(x) && Number.isInteger(z) ? `${x},${z}` : "";
}

function formatMissingRegions(entries = []) {
  const labels = (entries ?? []).map((entry) => {
    const region = entry?.region ?? entry;
    const x = Number(region?.x ?? region?.regionX);
    const z = Number(region?.z ?? region?.regionZ);
    return Number.isInteger(x) && Number.isInteger(z) ? `${x},${z}` : "";
  }).filter(Boolean);
  return labels.join(" | ");
}

function normalizeEtag(value) {
  return String(value || "").trim().replace(/^W\//i, "").replace(/^"|"$/g, "").toLowerCase();
}

function normalizeUrl(value) {
  try {
    return new URL(String(value || "")).toString();
  } catch {
    return String(value || "");
  }
}

function requireHash(value) {
  const hash = String(value || "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{32}$/.test(hash)) throw new Error("Invalid 16-byte Guardian building hash.");
  return hash;
}

function normalizeBlueprintId(value) {
  try {
    return requireU64String(value, "blueprintId");
  } catch {
    return "";
  }
}

function requireU64String(value, name, { allowZero = false } = {}) {
  const normalized = BigInt(value ?? 0);
  if (normalized < (allowZero ? 0n : 1n) || normalized > 0xffffffffffffffffn) throw new Error(`Invalid ${name}.`);
  return normalized.toString();
}

function requireI32(value, name) {
  return requireInteger(value, -0x80000000, 0x7fffffff, name);
}

function requireI16(value, name) {
  return requireInteger(value, -0x8000, 0x7fff, name);
}

function requireU16(value, name) {
  return requireInteger(value, 0, 0xffff, name);
}

function requireU32(value, name) {
  return requireInteger(value, 0, 0xffffffff, name);
}

function requireInteger(value, min, max, name) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) throw new Error(`Invalid ${name}.`);
  return normalized;
}
