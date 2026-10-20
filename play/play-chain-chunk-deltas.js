import { chunkId, worldToChunk } from "/chunk.js/play.js";
import { decodeChunkAccountBatch, validateDecodedChunkAccountBatch } from "./play-chain-chunk-codec.js";
import { decodeVerifiedChunkPairs, validateWorkerChunkPair, chunkPairWorkSnapshot } from "./play-chain-chunk-pair.js";
import { createChunkPairCache } from "./play-chain-pair-cache.js";
import { canonicalChunkWorkSnapshot } from "./play-chain-chunk-canonical.js";
import { fetchChunkAccountBatch } from "./play-chain-rpc-batch.js";
import { runChunkBatchPool, optionalContextSlot, pushChunkSnapshotHeap, popChunkSnapshotHeap, rebuildChunkSnapshotHeap, yieldChunkSyncTask } from "./play-chain-batch-scheduler.js";
import { loadPlayChainModule } from "./play-chain-adapter.js";
import {
  canonicalizeChunkSnapshot,
  canonicalizeChunkSnapshotAsync,
  createPlayChainChunkCache,
  sameCanonicalChunkSnapshot,
} from "./play-chain-chunk-cache.js";

const DEFAULT_BATCH_SIZE = 8;
const MAX_RPC_BATCHES_PER_SYNC = 8;
const MAX_PENDING_SNAPSHOTS = 512;
const BACKGROUND_PENDING_SNAPSHOT_LIMIT = MAX_PENDING_SNAPSHOTS - 64;
const SNAPSHOT_SERVICE_TIERS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2];
export const CHUNK_FRESHNESS_TTL_MS = Object.freeze({ near: 15_000, middle: 45_000, far: 120_000 });
const SYNC_COOLDOWN_MS = 900;
const ERROR_RETRY_MS = 15_000;
const RPC_BATCH_TIMEOUT_MS = 12_000;
const RPC_BATCH_CONCURRENCY = 4;
const RPC_WORKER_TASK_TIMEOUT_MS = RPC_BATCH_TIMEOUT_MS + 8_000;
const DEFAULT_APPLY_BUDGET_MS = 1.6;
const DEFAULT_APPLY_MAX_DELTAS = 256;
const ASYNC_STEP_BUDGET_MS = 2.0;
const SNAPSHOT_CACHE_LIMIT = 2048;
const SNAPSHOT_CACHE_DELTA_LIMIT = 131_072;
export const CHAIN_CHUNK_PDA_READ_STORAGE_KEY = "nicechunk.chainChunkPdaRead";
export const DEFAULT_CHAIN_CHUNK_CACHE_SCOPE_HINT = Object.freeze({
  cluster: "devnet",
  programId: "GnVKn442KDTDgCyjVG7SEtCQQLjaCiLvrEZDWSU13wbj",
});
const PERSISTENT_WRITE_DELAY_MS = 40;

export function createPlayChainChunkDeltaSync({
  chunks,
  batchSize = DEFAULT_BATCH_SIZE,
  onChanged = () => {},
  onStatus = () => {},
  appendEvent = () => {},
  loadChainModule = loadPlayChainModule,
  persistentCache = null,
  persistentScopeHint = null,
  now = () => Date.now(),
  freshnessTtlMs = CHUNK_FRESHNESS_TTL_MS,
  rpcEncoding = "base64",
} = {}) {
  const chunkBatchSize = Math.max(1, Math.min(50, Math.trunc(Number(batchSize) || DEFAULT_BATCH_SIZE)));
  const state = {
    loading: false,
    queued: false,
    queuedForce: false,
    syncedChunkIds: new Set(),
    lastSyncAt: 0,
    lastError: "",
    lastReason: "",
    lastRequestedChunks: 0,
    lastBatchCount: 0,
    lastDeltaCount: 0,
    lastInvalidAccountCount: 0,
    totalDeltaCount: 0,
    appliedDeltaCount: 0,
    totalRpcCalls: 0,
    pendingSnapshots: [[], [], []],
    pendingSnapshotHead: 0,
    pendingSnapshotById: new Map(),
    pendingDeltaCount: 0,
    snapshotVirtualTime: [0, 0, 0],
    snapshotServiceCursor: 0,
    pendingSnapshotsByTier: [0, 0, 0],
    snapshotQuantaByTier: [0, 0, 0],
    snapshotPriorityCenter: "",
    snapshotPriorityRebuilds: 0,
    snapshotPreparationQuanta: 0,
    snapshotCache: new Map(),
    snapshotCacheDeltaCount: 0,
    snapshotSerial: 1,
    syncEpoch: 1,
    rpcWorker: null,
    rpcWorkerDisabled: false,
    rpcWorkerTaskSerial: 1,
    rpcWorkerRequests: new Map(),
    lastRpcTransport: "main",
    lastRpcContextSlot: null,
    verifiedAtById: new Map(),
    activeSyncController: null,
    syncContextKey: "",
    freshnessInvalidations: 0,
    staleWorkerMessages: 0,
    maxApplySliceMs: 0,
    preparedEntries: 0,
    lastRpcEndpoint: "",
    persistentCacheScope: "",
    persistentCacheWarmPromise: null,
    persistentClearPromise: null,
    persistentWriteById: new Map(),
    persistentWriteTimer: null,
    persistentCacheHits: 0,
    persistentCacheApplied: 0,
    unchangedSnapshotCount: 0,
    lastWorkerPairWork: null, rpcWorkerPairTokens: new Set(), endpointEpoch: 1, interestKey: "", interestEpoch: 0, scheduledSync: null,
    metrics: { rpcCalls: 0, fullCalls: 0, conditionalCalls: 0, targetedRepairCalls: 0, responseJsonBytes: 0, requestJsonBytes: 0, decodedAccountBytes: 0, fullAccountCount: 0, unchangedAccountCount: 0, absentAccountCount: 0 },
    retryAtById: new Map(), retryFailuresById: new Map(), fullRepairIds: new Set(), globalRpcBackoffUntil: 0,
  };
  const normalizedScopeHint = normalizePersistentScopeHint(persistentScopeHint);
  if (normalizedScopeHint) {
    state.persistentCacheScope = buildPersistentCacheScope({
      programId: normalizedScopeHint.programId, globalConfig: normalizedScopeHint.globalConfig, seed: normalizedScopeHint.seed, placedSeed: normalizedScopeHint.placedSeed,
      cluster: normalizedScopeHint.cluster,
      chunks,
    });
  }
  const durableCache = persistentCache || createPlayChainChunkCache({
    getScope: () => state.persistentCacheScope || "unconfigured",
  });

  const pairCache = durableCache.pairs || createChunkPairCache({ getScope: () => state.persistentCacheScope, openDatabase: async () => null, now });

  return {
    updateInterest,
    ensurePresentation,
    pendingPresentationCount: () => state.pendingSnapshotById.size,
    requestSync,
    syncLoadedChunks,
    preloadPersistentCache,
    applyQueuedDeltas,
    clearLocalCache,
    invalidateChunk,
    invalidateFreshness,
    cancelActiveSync,
    invalidateChunkForWorld,
    snapshot,
  };

  function snapshot() {
    return {
      loading: state.loading,
      queued: state.queued,
      syncedChunks: state.syncedChunkIds.size,
      lastSyncAt: state.lastSyncAt,
      lastError: state.lastError,
      lastReason: state.lastReason,
      lastRequestedChunks: state.lastRequestedChunks,
      lastBatchCount: state.lastBatchCount,
      lastDeltaCount: state.lastDeltaCount,
      lastInvalidAccountCount: state.lastInvalidAccountCount,
      totalDeltaCount: state.totalDeltaCount,
      appliedDeltaCount: state.appliedDeltaCount,
      totalRpcCalls: state.totalRpcCalls,
      pendingDeltas: state.pendingDeltaCount,
      pendingSnapshots: pendingSnapshotCount(),
      readEnabled: chainPdaReadEnabled(),
      syncEpoch: state.syncEpoch,
      cachedSnapshots: state.snapshotCache.size,
      cachedDeltas: state.snapshotCacheDeltaCount,
      rpcTransport: state.lastRpcTransport,
      rpcContextSlot: state.lastRpcContextSlot,
      persistentCacheScope: state.persistentCacheScope,
      persistentCacheHits: state.persistentCacheHits,
      persistentCacheApplied: state.persistentCacheApplied,
      unchangedSnapshots: state.unchangedSnapshotCount,
      freshnessTtlMs,
      verifiedChunks: state.verifiedAtById.size,
      freshnessInvalidations: state.freshnessInvalidations,
      staleWorkerMessages: state.staleWorkerMessages,
      maxApplySliceMs: state.maxApplySliceMs,
      preparedEntries: state.preparedEntries,
      canonicalWork: canonicalChunkWorkSnapshot(),
      workerPairWork: state.lastWorkerPairWork, pairWork: chunkPairWorkSnapshot(), pairCache: pairCache.snapshot(),
      rpcMetrics: { ...state.metrics, availableWireBytes: null },
      interestEpoch: state.interestEpoch, endpointEpoch: state.endpointEpoch,
      maxConcurrentRequests: RPC_BATCH_CONCURRENCY,
      maxBatchesPerSync: MAX_RPC_BATCHES_PER_SYNC,
      preparationEntriesPerBatchStep: 64,
      preparationWorkFactor: 32,
      snapshotPriorityRebuilds: state.snapshotPriorityRebuilds,
      snapshotPreparationQuanta: state.snapshotPreparationQuanta,
      pendingSnapshotsByTier: [...state.pendingSnapshotsByTier],
      snapshotPreparationQuantaByTier: [...state.snapshotQuantaByTier],
      persistentCache: durableCache.snapshot?.() ?? null,
    };
  }

  function clearLocalCache({ clearRenderDeltas = false, clearPersistent = false } = {}) {
    const persistentScope = state.persistentCacheScope;
    cancelActiveSync("cache-clear");
    state.syncedChunkIds.clear();
    state.verifiedAtById.clear();
    state.queued = false;
    state.queuedForce = false;
    state.lastError = "";
    state.lastInvalidAccountCount = 0;
    state.lastRpcContextSlot = null;
    state.lastRpcEndpoint = "";
    state.persistentCacheWarmPromise = null;
    state.snapshotCache.clear();
    state.snapshotCacheDeltaCount = 0;
    clearPendingSnapshots();
    clearTimeout(state.persistentWriteTimer);
    state.persistentWriteTimer = null;
    state.persistentWriteById.clear();
    if (clearRenderDeltas) chunks?.clearChainDeltas?.();
    if (clearPersistent && persistentScope) {
      void pairCache.clearScope(persistentScope);
      const previousClear = state.persistentClearPromise;
      const clearing = Promise.resolve(previousClear)
        .catch(() => {})
        .then(() => durableCache.clearScope?.(persistentScope));
      const pendingClear = clearing.finally(() => {
        if (state.persistentClearPromise === pendingClear) state.persistentClearPromise = null;
      });
      state.persistentClearPromise = pendingClear;
    }
    appendEvent(`${clearPersistent ? "Persistent and in-memory" : "In-memory"} chunk PDA cache cleared. Chain accounts will be re-read from RPC.`);
    return state.persistentClearPromise ?? Promise.resolve();
  }

  function cancelActiveSync(reason = "context-change") {
    state.syncEpoch += 1;
    state.activeSyncController?.abort(reason);
    clearPendingSnapshots();
    for (const [taskId, request] of state.rpcWorkerRequests) {
      state.rpcWorker?.postMessage?.({ type: "cancelChunkPdas", taskId, syncEpoch: request.syncEpoch });
      clearTimeout(request.timer);
      request.resolve(false);
    }
    state.rpcWorkerRequests.clear();
  }

  function invalidateFreshness({ reason = "external-change" } = {}) {
    state.freshnessInvalidations += 1;
    state.verifiedAtById.clear();
    state.syncedChunkIds.clear();
    state.lastReason = reason;
  }

  function invalidateChunk(idOrChunk) {
    const id = typeof idOrChunk === "string" ? idOrChunk : chunkId(idOrChunk?.chunkX ?? 0, idOrChunk?.chunkZ ?? 0);
    state.syncedChunkIds.delete(id);
    state.retryAtById.delete(id); state.retryFailuresById.delete(id);
    state.verifiedAtById.delete(id);
    supersedePendingSnapshot(id);
    // Do not turn local optimistic or unobserved confirmed geometry into a
    // verified account cache. Existing pure-RPC data remains a stale preview.
    const cached = state.snapshotCache.get(id);
    if (cached) cached.needsRefresh = true;
  }

  function invalidateChunkForWorld(worldX, worldZ) {
    if (!chunks) return;
    const coord = worldToChunk(worldX, 0, worldZ, chunks.chunkSize || 16);
    invalidateChunk(coord.chunkId);
  }

  function preloadPersistentCache({ reason = "startup-cache" } = {}) {
    if (!chunks || !chainPdaReadEnabled()) return Promise.resolve({ ok: false, reason: "chunk-pda-read-disabled" });
    if (state.persistentCacheWarmPromise) return state.persistentCacheWarmPromise;
    const syncEpoch = state.syncEpoch;
    const warming = (async () => {
      try {
        if (state.persistentCacheScope) {
          const targets = collectLoadedChunkTargets();
          const result = await hydratePersistentSnapshots(targets, { syncEpoch });
          state.lastReason = reason;
          return { ok: true, ...result };
        }
        const module = await loadChainModule();
        if (syncEpoch !== state.syncEpoch) return { ok: false, reason: "cache-warm-superseded" };
        const connection = module.getNicechunkConnection?.();
        if (!connection) return { ok: false, reason: "chunk-pda-rpc-unavailable" };
        await configureAuthorityScope(module, connection);
        const targets = collectLoadedChunkTargets();
        const result = await hydratePersistentSnapshots(targets, { syncEpoch });
        state.lastReason = reason;
        return { ok: true, ...result };
      } catch (error) {
        return { ok: false, reason: readableError(error) };
      }
    });
    const pendingWarm = warming().finally(() => {
      if (state.persistentCacheWarmPromise === pendingWarm) state.persistentCacheWarmPromise = null;
    });
    state.persistentCacheWarmPromise = pendingWarm;
    return state.persistentCacheWarmPromise;
  }

  function requestSync({ force = false, reason = "auto", quiet = true, urgent = false } = {}) {
    if (!chunks) return Promise.resolve({ ok: false, reason: "chunks-unavailable" });
    if (!chainPdaReadEnabled()) return Promise.resolve({ ok: false, reason: "chunk-pda-read-disabled" });
    const contextKey = `${chunks.centerChunkX ?? 0}:${chunks.centerChunkZ ?? 0}:${chunks.viewDistance ?? chunks.viewDistanceChunks ?? ""}`;
    // Moving interest does not revoke authority or overlapping in-flight pairs.
    if (state.syncContextKey !== contextKey) state.interestEpoch++;
    state.syncContextKey = contextKey;
    if (force) invalidateFreshness({ reason });
    if (state.loading || state.scheduledSync) {
      state.queued = true;
      state.queuedForce ||= force;
      return Promise.resolve({ ok: false, reason: "already-loading" });
    }
    const now = performance.now();
    if (!force && state.globalRpcBackoffUntil > Date.now()) {
      state.queued = true;
      return Promise.resolve({ ok: false, reason: "error-backoff" });
    }
    if (!force && !urgent && now - state.lastSyncAt < SYNC_COOLDOWN_MS) {
      state.queued = true;
      return Promise.resolve({ ok: false, reason: "cooldown" });
    }
    state.scheduledSync = defer(() => { state.scheduledSync = null; return syncLoadedChunks({ force, reason, quiet }); });
    return state.scheduledSync;
  }

  async function syncLoadedChunks({ force = false, reason = "manual", quiet = true } = {}) {
    if (!chunks) return { ok: false, reason: "chunks-unavailable" };
    if (!chainPdaReadEnabled()) {
      state.lastError = "";
      state.lastSyncAt = performance.now();
      return { ok: false, reason: "chunk-pda-read-disabled" };
    }
    if (force) state.syncedChunkIds.clear();
    if (state.loading) {
      state.queued = true;
      state.queuedForce ||= force;
      return { ok: false, reason: "already-loading" };
    }

    const targets = collectTargetChunks({ force }).slice(0, chunkBatchSize * MAX_RPC_BATCHES_PER_SYNC);
    state.lastRequestedChunks = targets.length;
    state.lastReason = reason;
    if (!targets.length) {
      state.lastSyncAt = performance.now();
      return { ok: true, requestedChunks: 0, batchCount: 0, deltaCount: 0 };
    }

    state.loading = true;
    state.queued = false;
    state.queuedForce = false;
    state.lastError = "";
    state.lastInvalidAccountCount = 0;
    const startedAt = performance.now();
    const syncEpoch = state.syncEpoch;
    const controller = new AbortController();
    state.activeSyncController = controller;
    let deltaCount = 0;
    let batchCount = 0;
    let invalidAccountCount = 0;
    let firstInvalidAccountError = "";
    let failedBatchCount = 0;
    let firstBatchError = "";
    let minimumContextSlot = null;
    let expectedOwner = "", expectedGlobalConfig = "";
    let observedContextSlot = null;
    try {
      const module = await loadChainModule();
      if (syncEpoch !== state.syncEpoch) return supersededSyncResult();
      if (module.isNicechunkChainSyncEnabled?.() === false) {
        state.lastError = "chain-sync-disabled";
        return { ok: false, reason: "chain-sync-disabled" };
      }
      const connection = module.getNicechunkConnection?.();
      const deriveChunkBrokenPda = module.deriveGameChunkBrokenPda || module.deriveChunkBrokenPda;
      const deriveChunkPlacedPda = module.deriveGameChunkPlacedPda || module.deriveChunkPlacedPda;
      if (!connection?.getMultipleAccountsInfo
        || typeof deriveChunkBrokenPda !== "function"
        || typeof deriveChunkPlacedPda !== "function") {
        state.lastError = "chunk-pda-rpc-unavailable";
        return { ok: false, reason: "chunk-pda-rpc-unavailable" };
      }

      const rpcEndpoint = String(connection?.rpcEndpoint || connection?._rpcEndpoint || "");
      if (state.lastRpcEndpoint && state.lastRpcEndpoint !== rpcEndpoint) { state.lastRpcContextSlot = null; state.endpointEpoch++; }
      state.lastRpcEndpoint = rpcEndpoint;
      await configureAuthorityScope(module, connection);
      // Disk latency must not hold up a cold, visible network read.
      void hydratePersistentSnapshots(targets, { syncEpoch });
      if (syncEpoch !== state.syncEpoch) return supersededSyncResult();
      minimumContextSlot = state.lastRpcContextSlot;
      expectedOwner = String(module.getChunkBrokenPdaDerivationConfig?.()?.programId || "");
      expectedGlobalConfig = String(module.getChunkBrokenPdaDerivationConfig?.()?.globalConfig || "");
      observedContextSlot = minimumContextSlot;

      for (const target of targets) target.baseline = state.fullRepairIds.has(target.id) ? null : pairCache.peek(target);
      const cold = targets.filter(target => !target.baseline), warm = targets.filter(target => target.baseline);
      state.metrics.targetedRepairCalls += targets.filter(target => state.fullRepairIds.has(target.id)).length;
      const batches = [...chunkArray(cold.filter(target => snapshotServiceTier(target) === 0), Math.min(8, chunkBatchSize)),
        ...chunkArray(cold.filter(target => snapshotServiceTier(target) !== 0), chunkBatchSize), ...chunkArray(warm, chunkBatchSize)];
      batchCount = batches.length;
      if (!quiet) appendEvent(`Chunk PDA sync: ${targets.length} chunks in ${batchCount} RPC batches of ${chunkBatchSize}.`);

      const consumed = new Set();
      const consume = async (batchResult, batchIndex) => {
        if (syncEpoch !== state.syncEpoch || controller.signal.aborted || consumed.has(batchIndex)) return;
        consumed.add(batchIndex);
        for (const record of batchResult?.pairs ?? []) state.rpcWorkerPairTokens.add(record.pairToken);
        while (state.rpcWorkerPairTokens.size > 2048) state.rpcWorkerPairTokens.delete(state.rpcWorkerPairTokens.values().next().value);
        if (batchResult?.pairWork) state.lastWorkerPairWork = batchResult.pairWork;
        state.totalRpcCalls += batchResult?.metrics?.rpcCalls ?? 1;
        for (const key of Object.keys(state.metrics)) state.metrics[key] += batchResult?.metrics?.[key] || 0;
        if (!batchResult?.ok) {
          failedBatchCount += 1;
          if (batchResult?.httpStatus === 429 || /timed out|HTTP 5/.test(batchResult?.error || "")) state.globalRpcBackoffUntil = Date.now() + ERROR_RETRY_MS;
          firstBatchError ||= readableError(batchResult?.error || "chunk PDA batch failed");
          return;
        }
        try { await consumeDecodedBatch(batches[batchIndex], batchResult.infos, batchResult.contextSlot, batchResult); }
        catch (error) { consumed.delete(batchIndex); throw error; }
      };
      const usedWorker = await fetchBatchesViaWorker(batches, connection, module, minimumContextSlot, consume, syncEpoch).catch(() => false);
      if (syncEpoch !== state.syncEpoch) return supersededSyncResult();
      if (usedWorker) state.lastRpcTransport = "worker";
      else {
        state.lastRpcTransport = "main";
        const remaining = batches.map((batch, batchIndex) => ({ batch, batchIndex })).filter(({ batchIndex }) => !consumed.has(batchIndex));
        await runChunkBatchPool(remaining, {
          concurrency: RPC_BATCH_CONCURRENCY,
          signal: controller.signal,
          fetchBatch: async ({ batch }) => {
            const pubkeys = await derivePubkeysForBatch(batch, deriveChunkBrokenPda, deriveChunkPlacedPda);
            if (controller.signal.aborted) return { ok: false, error: "cancelled" };
            if (rpcEndpoint && typeof fetch === "function") return fetchChunkAccountBatch({ ...batchReadOptions(batch), encoding: "base64", endpointEpoch: state.endpointEpoch, rpcUrl: rpcEndpoint, pubkeys: pubkeys.map((key) => key?.toBase58?.() ?? String(key)), requestId: state.rpcWorkerTaskSerial++, timeoutMs: RPC_BATCH_TIMEOUT_MS, signal: controller.signal });
            // In-process/custom embedders may expose only the SDK interface.
            // Production HTTP fallback uses the same abortable transport as Worker.
            const result = await withTimeout(fetchMultipleAccountsWithContext(connection, pubkeys, minimumContextSlot), RPC_BATCH_TIMEOUT_MS, "chunk PDA RPC batch timed out");
            return { ok: true, ...result, pubkeys: pubkeys.map(key => key?.toBase58?.() ?? String(key)) };
          },
          onResult: async (result, index) => consume(result, remaining[index].batchIndex),
        });
      }
      if (syncEpoch !== state.syncEpoch) return supersededSyncResult();

      state.lastSyncAt = performance.now();
      state.lastBatchCount = batchCount;
      state.lastDeltaCount = deltaCount;
      state.lastInvalidAccountCount = invalidAccountCount;
      if (observedContextSlot !== null) state.lastRpcContextSlot = Math.max(state.lastRpcContextSlot ?? observedContextSlot, observedContextSlot);
      state.totalDeltaCount += deltaCount;
      if (invalidAccountCount || failedBatchCount) {
        const issues = [];
        if (failedBatchCount) issues.push(`${failedBatchCount} failed RPC batch${failedBatchCount === 1 ? "" : "es"}${firstBatchError ? `: ${firstBatchError}` : ""}`);
        if (invalidAccountCount) issues.push(`${invalidAccountCount} invalid chunk state account pair${invalidAccountCount === 1 ? "" : "s"}${firstInvalidAccountError ? `: ${firstInvalidAccountError}` : ""}`);
        const partialReason = issues.join("; ");
        state.lastError = partialReason;
        appendEvent(`Chunk PDA sync kept existing render data for ${partialReason}.`);
        if (!quiet) onStatus(`Chunk PDA sync partially completed; ${partialReason}.`);
        return {
          ok: false,
          reason: partialReason,
          requestedChunks: targets.length,
          batchCount,
          deltaCount,
          invalidAccountCount,
          failedBatchCount,
          contextSlot: state.lastRpcContextSlot,
          transport: state.lastRpcTransport,
        };
      }
      if (!quiet) {
        const elapsed = Math.max(0, performance.now() - startedAt).toFixed(0);
        appendEvent(`Chunk PDA sync done: ${targets.length} chunks scanned, ${deltaCount} block deltas queued in ${elapsed}ms.`);
        onStatus(`Chunk PDA sync done: ${targets.length} chunks, ${deltaCount} queued deltas, ${batchCount} RPC batches.`);
      }
      return {
        ok: true,
        requestedChunks: targets.length,
        batchCount,
        deltaCount,
        contextSlot: state.lastRpcContextSlot,
        transport: state.lastRpcTransport,
      };
    } catch (error) {
      const reasonText = readableError(error);
      state.lastError = reasonText;
      state.lastSyncAt = performance.now();
      appendEvent(`Chunk PDA sync failed: ${reasonText}.`);
      if (!quiet) onStatus(`Chunk PDA sync failed: ${reasonText}.`);
      return { ok: false, reason: reasonText };
    } finally {
      if (state.activeSyncController === controller) state.activeSyncController = null;
      state.loading = false;
      if (state.queued) {
        const queuedForce = state.queuedForce;
        state.queued = false;
        state.queuedForce = false;
        requestSync({ force: queuedForce, reason: "queued", quiet: true });
      }
    }

    function supersededSyncResult() {
      return { ok: false, reason: "sync-superseded", requestedChunks: targets.length, batchCount, deltaCount };
    }

    async function consumeDecodedBatch(batch, infos, contextSlot = null, metadata = {}) {
      // Account bytes were observed successfully before this yielding CPU work.
      // Decode/canonicalization must not extend their network freshness.
      const verifiedAt = Number.isFinite(metadata.observedAt)
        ? Math.max(0, now() - Math.max(0, Date.now() - metadata.observedAt)) : now();
      const slot = optionalContextSlot(contextSlot);
      if (minimumContextSlot !== null && (slot === null || slot < minimumContextSlot)) {
        failedBatchCount += 1;
        firstBatchError ||= `RPC context slot ${slot || "missing"} is older than ${minimumContextSlot}`;
        return true;
      }
      const decodeOptions = { chunkSize: chunks.chunkSize || 16, minY: chunks.minY,
        contextSlot: slot, expectedOwner, globalConfig: expectedGlobalConfig, signal: controller.signal };
      let decodedBatch;
      if (metadata.pairs || metadata.observations) {
        const options = { ...decodeOptions, scope: state.persistentCacheScope, observedAt: verifiedAt,
          readStartedAt: metadata.readStartedAt ?? verifiedAt, changedSinceSlot: metadata.changedSinceSlot,
          baselines: Object.fromEntries(batch.map(target => [target.id, target.baseline])) };
        const decoded = metadata.pairs ? { pairs: [], errors: metadata.pairErrors || [] }
          : await decodeVerifiedChunkPairs(batch, metadata.observations, options);
        if (metadata.pairs && (metadata.pairs.length + decoded.errors.length !== batch.length
          || new Set([...metadata.pairs, ...decoded.errors].map(record => record?.id)).size !== batch.length
          || [...metadata.pairs, ...decoded.errors].some(record => !batch.some(target => target.id === record?.id)))) throw new Error("Invalid Worker pair envelope.");
        if (metadata.pairs) for (const record of metadata.pairs) {
          const target = batch.find(target => target.id === record.id);
          if (!target) throw new Error("Worker returned an unsolicited chunk pair.");
          const baseline = target.baseline;
          const pubkeys = baseline ? [baseline.broken.pubkey, baseline.placed.pubkey] : [record.broken?.pubkey, record.placed?.pubkey];
          try { decoded.pairs.push(await validateWorkerChunkPair(record, target, { ...options, baseline, pubkeys })); }
          catch { decoded.errors.push({ id: target.id, error: "Worker chunk pair validation failed." }); }
        }
        decodedBatch = { snapshots: [], errors: decoded.errors };
        if (syncEpoch !== state.syncEpoch) return false;
        for (const pair of decoded.pairs) {
          const current = pairCache.peek(pair);
          if (current && current.knownAtSlot > pair.knownAtSlot) continue;
          pairCache.put([pair]); // Publish both components and their watermark atomically, before meshing.
          state.verifiedAtById.set(pair.id, pair.authoritativeObservedAt);
          state.retryAtById.delete(pair.id); state.retryFailuresById.delete(pair.id); state.fullRepairIds.delete(pair.id);
          decodedBatch.snapshots.push({ ...pair.canonical, id: pair.id, contextSlot: pair.knownAtSlot,
            pairToken: pair.pairToken, pairValidatedAt: performance.now() });
        }
        for (const error of decoded.errors) {
          const failures = Math.min(5, (state.retryFailuresById.get(error.id) || 0) + 1);
          state.retryFailuresById.set(error.id, failures);
          state.retryAtById.set(error.id, now() + Math.min(15000, 1000 * 2 ** (failures - 1))); state.fullRepairIds.add(error.id);
        }
      } else decodedBatch = metadata.decoded
        ? await validateDecodedChunkAccountBatch(batch, metadata.decoded, decodeOptions)
        : await decodeChunkAccountBatch(batch, infos, decodeOptions);
      if (syncEpoch !== state.syncEpoch) return false;
      for (const decodedSnapshot of decodedBatch.snapshots) {
        const snapshot = { ...decodedSnapshot, source: "rpc", snapshotCommitment: metadata.commitment || "finalized", readStartedAt: metadata.readStartedAt ?? verifiedAt, verifiedAt, syncEpoch };
        const requested = batch.find((target) => target.id === snapshot.id);
        // A completed authoritative pair remains useful even if its old instance left.
        // Presentation always targets the current instance.
        if (requested && !chunks?.chunks?.has?.(snapshot.id)) { storeSnapshotCache(snapshot); continue; }
        const loaded = chunks?.chunks?.get?.(snapshot.id);
        const cached = state.snapshotCache.get(snapshot.id);
        if (cached && sameCanonicalChunkSnapshot(cached, snapshot)) {
          const acknowledged = !loaded || chunks.acknowledgeChainSnapshotForChunk?.(snapshot.id, {
            snapshotToken: cached.token,
            snapshotSlot: snapshot.contextSlot,
            snapshotCommitment: snapshot.snapshotCommitment,
            source: snapshot.source,
            readStartedAt: snapshot.readStartedAt,
          });
          if (acknowledged) {
            chunks.ensureChainPresentation?.(snapshot.id);
            notePresentation(loaded, snapshot);
            const refreshed = storeSnapshotCache({
              ...cached,
              ...snapshot,
              contextSlot: snapshot.contextSlot,
            });
            state.syncedChunkIds.add(snapshot.id);
            state.verifiedAtById.set(snapshot.id, snapshot.verifiedAt);
            state.unchangedSnapshotCount += 1;
            queuePersistentWrite(refreshed);
            deltaCount += snapshot.deltas.length;
            continue;
          }
        }
        queueChainSnapshot({
          ...snapshot,
          expectedChainRevision: Math.max(0, Math.trunc(Number(loaded?.chainRevision) || 0)),
        });
        deltaCount += snapshot.deltas.length;
      }
      invalidAccountCount += decodedBatch.errors.length;
      firstInvalidAccountError ||= decodedBatch.errors[0]?.error || "";
      if (slot !== null) observedContextSlot = Math.max(observedContextSlot ?? slot, slot);
      return true;
    }
  }

  function collectTargetChunks({ force = false } = {}) {
    const manager = chunks;
    const result = [];
    for (const id of state.retryAtById.keys()) if (!manager?.chunks?.has?.(id)) { state.retryAtById.delete(id); state.retryFailuresById.delete(id); state.fullRepairIds.delete(id); }
    for (const id of state.verifiedAtById.keys()) if (!manager?.chunks?.has?.(id)) { state.verifiedAtById.delete(id); state.syncedChunkIds.delete(id); }
    for (const chunk of manager?.chunks?.values?.() ?? []) {
      if (!chunk) continue;
      if (!force && state.pendingSnapshotById.has(chunk.id)) continue;
      const cached = state.snapshotCache.get(chunk.id);
      if (!force && cached && !cached.needsRefresh && chunk.chainRevision === 0 && chunk.chainSnapshotToken !== cached.token) {
        queueChainSnapshot({ ...cached, source: "memory", expectedChainRevision: 0 }, { updateCache: false });
        state.syncedChunkIds.add(chunk.id);
        if (!freshnessExpired(chunk)) continue;
      }
      if (!force && state.syncedChunkIds.has(chunk.id)) {
        if (chunk.chainSnapshotToken && (!cached || chunk.chainSnapshotToken === cached.token && !cached.needsRefresh) && !freshnessExpired(chunk)) continue;
        state.syncedChunkIds.delete(chunk.id);
      }
      if (!force && (state.retryAtById.get(chunk.id) || 0) > now()) continue;
      result.push({
        id: chunk.id,
        chunkX: chunk.chunkX,
        chunkZ: chunk.chunkZ,
        instance: chunk,
        expectedChainRevision: Math.max(0, Math.trunc(Number(chunk.chainRevision) || 0)),
      });
    }
    result.sort((a, b) => chunkPriority(a, manager) - chunkPriority(b, manager) || (state.verifiedAtById.get(a.id) ?? -Infinity) - (state.verifiedAtById.get(b.id) ?? -Infinity));
    // Reserve admission capacity for near corrections. A wide view must not
    // repeatedly read far accounts which the bounded application queue then
    // discards. Deferred targets remain stale and are eligible as work drains.
    let projectedPending = state.pendingSnapshotById.size;
    return result.filter((target) => {
      if (state.pendingSnapshotById.has(target.id)) return true;
      if (snapshotServiceTier(target) !== 0 && projectedPending >= BACKGROUND_PENDING_SNAPSHOT_LIMIT) return false;
      projectedPending++;
      return true;
    });
  }

  function queueChainSnapshot(snapshot, { updateCache = true } = {}) {
    if (!snapshot?.id) return;
    refreshSnapshotPriorities();
    supersedePendingSnapshot(snapshot.id);
    const canonical = canonicalizeSnapshot(snapshot);
    const queued = {
      ...snapshot,
      ...canonical,
      token: Math.max(1, Math.trunc(Number(snapshot.token) || state.snapshotSerial++)),
      contextSlot: optionalContextSlot(snapshot.contextSlot),
      source: snapshot.source || "rpc",
      snapshotCommitment: snapshot.snapshotCommitment,
      readStartedAt: snapshot.readStartedAt,
      verifiedAt: snapshot.verifiedAt,
      syncEpoch: snapshot.syncEpoch ?? state.syncEpoch,
      instance: snapshot.instance ?? chunks?.chunks?.get?.(snapshot.id),
      queuedAt: snapshot.queuedAt ?? now(),
      priority: chunkPriority(snapshot, chunks),
      serviceTier: snapshotServiceTier(snapshot),
      estimatedWork: Math.max(1, Math.min(8, Math.ceil(canonical.deltas.length / 64))),
      superseded: false,
      cacheOnApply: updateCache,
    };
    queued.virtualFinish = state.snapshotVirtualTime[queued.serviceTier] + queued.estimatedWork;
    pushChunkSnapshotHeap(state.pendingSnapshots[queued.serviceTier], queued);
    state.pendingSnapshotById.set(queued.id, queued);
    state.pendingSnapshotsByTier[queued.serviceTier]++;
    state.pendingDeltaCount += queued.deltas.length;
    // Paused/hidden tabs must not accumulate every superseded immutable snapshot.
    if (state.pendingSnapshots.reduce((count, heap) => count + heap.length, 0) > Math.max(256, state.pendingSnapshotById.size * 2 + 64)) {
      for (const heap of state.pendingSnapshots) heap.length = 0;
      for (const item of state.pendingSnapshotById.values()) state.pendingSnapshots[item.serviceTier].push(item);
      for (const heap of state.pendingSnapshots) rebuildChunkSnapshotHeap(heap);
    }
    while (state.pendingSnapshotById.size > MAX_PENDING_SNAPSHOTS || state.pendingDeltaCount > SNAPSHOT_CACHE_DELTA_LIMIT) {
      let farthest = null;
      for (const item of state.pendingSnapshotById.values()) if (!farthest || item.priority > farthest.priority) farthest = item;
      if (!farthest) break;
      supersedePendingSnapshot(farthest.id);
      state.syncedChunkIds.delete(farthest.id);
    }
  }

  function freshnessExpired(chunk) {
    const verifiedAt = state.verifiedAtById.get(chunk.id);
    const distance = Math.max(Math.abs(chunk.chunkX - (chunks.centerChunkX || 0)), Math.abs(chunk.chunkZ - (chunks.centerChunkZ || 0)));
    const ttl = distance <= 2 ? freshnessTtlMs.near : distance <= 6 ? freshnessTtlMs.middle : freshnessTtlMs.far;
    return verifiedAt === undefined || now() - verifiedAt >= ttl;
  }

  function snapshotServiceTier(snapshot) {
    const distance = Math.max(Math.abs(snapshot.chunkX - (chunks?.centerChunkX || 0)), Math.abs(snapshot.chunkZ - (chunks?.centerChunkZ || 0)));
    return distance <= 2 ? 0 : distance <= 6 ? 1 : 2;
  }

  function refreshSnapshotPriorities() {
    const center = `${chunks?.centerChunkX || 0},${chunks?.centerChunkZ || 0}`;
    if (center === state.snapshotPriorityCenter) return;
    state.snapshotPriorityCenter = center;
    for (const heap of state.pendingSnapshots) heap.length = 0;
    state.pendingSnapshotsByTier.fill(0);
    // At most 512 pending snapshots: movement refresh is bounded independently
    // of the number of deltas. Reprice outstanding virtual work, not work already
    // served, so moving toward a chunk cannot leave it behind the old center.
    for (const snapshot of state.pendingSnapshotById.values()) {
      const tier = snapshotServiceTier(snapshot);
      const outstanding = Math.max(0, snapshot.virtualFinish - state.snapshotVirtualTime[snapshot.serviceTier]);
      snapshot.virtualFinish = state.snapshotVirtualTime[tier] + outstanding;
      snapshot.serviceTier = tier;
      snapshot.priority = chunkPriority(snapshot, chunks);
      state.pendingSnapshots[tier].push(snapshot);
      state.pendingSnapshotsByTier[tier]++;
    }
    for (const heap of state.pendingSnapshots) rebuildChunkSnapshotHeap(heap);
    state.snapshotPriorityRebuilds++;
  }

  function takeSnapshotPreparation() {
    // Shares belong to distance tiers, not individual tasks: adding hundreds of
    // far chunks cannot dilute the near tier's eight of thirteen quanta. Empty
    // tiers donate their share. Virtual service rotates fairly within each tier.
    for (let count = 0; count < SNAPSHOT_SERVICE_TIERS.length; count++) {
      const tier = SNAPSHOT_SERVICE_TIERS[state.snapshotServiceCursor];
      state.snapshotServiceCursor = (state.snapshotServiceCursor + 1) % SNAPSHOT_SERVICE_TIERS.length;
      if (state.pendingSnapshots[tier].length) return popChunkSnapshotHeap(state.pendingSnapshots[tier]);
    }
    return null;
  }

  function requeueSnapshotPreparation(snapshot, processed) {
    // A fixed preparation quantum is the scheduling unit within each tier.
    // Waiting large tasks accrue priority as that tier's virtual time advances.
    snapshot.virtualFinish = Math.max(state.snapshotVirtualTime[snapshot.serviceTier], snapshot.virtualFinish)
      + Math.max(1, processed) / 64;
    pushChunkSnapshotHeap(state.pendingSnapshots[snapshot.serviceTier], snapshot);
  }

  function applyQueuedDeltas({ budgetMs = DEFAULT_APPLY_BUDGET_MS, maxDeltas = DEFAULT_APPLY_MAX_DELTAS, maxPreparationEntries = null, deadline = Infinity } = {}) {
    const startedAt = performance.now();
    const requestedBudget = Number.isFinite(Number(budgetMs)) ? Math.max(0, Number(budgetMs)) : DEFAULT_APPLY_BUDGET_MS;
    const budget = Math.min(requestedBudget, deadline - startedAt);
    if (budget <= 0) return { applied: 0, appliedSnapshots: 0, changedChunks: 0, staleSnapshots: 0,
      laggingSnapshots: 0, preparedEntries: 0, pending: state.pendingDeltaCount,
      pendingSnapshots: pendingSnapshotCount(), elapsedMs: performance.now() - startedAt };
    const limit = Math.max(1, Math.trunc(Number(maxDeltas) || DEFAULT_APPLY_MAX_DELTAS));
    const preparationLimit = Math.max(64, Math.trunc(Number(maxPreparationEntries) || limit * 32));
    let applied = 0, appliedSnapshots = 0, changedChunks = 0, staleSnapshots = 0, laggingSnapshots = 0, preparedEntries = 0;
    chunks?.expireRemoteDeltas?.(now());
    refreshSnapshotPriorities();
    // Rotate after every bounded quantum. A large task can use spare frame work
    // without holding the head until its entire atomic snapshot is prepared.
    let inspected = 0;
    while (state.pendingSnapshotById.size && inspected++ < preparationLimit) {
      if (inspected > 1 && performance.now() - startedAt >= budget) break;
      const snapshot = takeSnapshotPreparation();
      if (!snapshot) break;
      if (snapshot.superseded) continue;
      if (snapshot.syncEpoch !== state.syncEpoch) { supersedePendingSnapshot(snapshot.id); continue; }
      const loaded = chunks?.chunks?.get?.(snapshot.id);
      if (snapshot.instance && loaded && snapshot.instance !== loaded) { supersedePendingSnapshot(snapshot.id); staleSnapshots++; continue; }
      state.snapshotVirtualTime[snapshot.serviceTier] = Math.max(state.snapshotVirtualTime[snapshot.serviceTier], snapshot.virtualFinish);
      let result;
      try {
        if (loaded?.prepareChainSnapshot && chunks.commitPreparedChainSnapshotForChunk) {
          if (!snapshot.preparation) snapshot.preparation = loaded.prepareChainSnapshot(snapshot.deltas, snapshotOptions(snapshot));
          const step = snapshot.preparation.step({ maxEntries: Math.min(64, Math.max(1, preparationLimit - preparedEntries)), budgetMs: Math.max(0.05, budget - (performance.now() - startedAt)) });
          preparedEntries += step.processed;
          state.snapshotPreparationQuanta++;
          state.snapshotQuantaByTier[snapshot.serviceTier]++;
          if (!step.done) {
            requeueSnapshotPreparation(snapshot, step.processed);
            if (preparedEntries >= preparationLimit || performance.now() - startedAt >= budget) break;
            continue;
          }
          result = chunks.commitPreparedChainSnapshotForChunk(snapshot.id, snapshot.preparation);
        } else {
          // Compatibility adapter for simple embedding hosts; production ChunkManager
          // always supplies staged preparation. Atomic legacy commits are bounded
          // by the on-chain 2048+2048 record cap and measured separately.
          result = chunks.replaceChainDeltasForChunk(snapshot.id, snapshot.deltas, snapshotOptions(snapshot));
        }
      } catch (error) {
        result = { applied: false, reason: readableError(error) };
      }
      if (result?.reason === "stale-world-revision" && loaded?.chainRevision === snapshot.expectedChainRevision) {
        snapshot.preparation = null;
        requeueSnapshotPreparation(snapshot, 64);
        if (preparedEntries >= preparationLimit || performance.now() - startedAt >= budget) break;
        continue;
      }
      supersedePendingSnapshot(snapshot.id);
      if (result?.reason === "chunk-unloaded") {
        if (snapshot.cacheOnApply) queuePersistentWrite(storeSnapshotCache(snapshot));
      } else if (!result?.applied) {
        state.syncedChunkIds.delete(snapshot.id);
        const cached = state.snapshotCache.get(snapshot.id);
        if (cached) cached.needsRefresh = true;
        staleSnapshots++;
      } else {
        // Cache the unmodified, validated account pair, never protected/remote overlays.
        const cached = storeSnapshotCache(snapshot, { needsRefresh: result.retainedUnobserved > 0 || snapshot.source !== "rpc" });
        if (snapshot.cacheOnApply && snapshot.source === "rpc") queuePersistentWrite(cached);
        state.syncedChunkIds.add(snapshot.id);
        if (snapshot.source === "rpc") state.verifiedAtById.set(snapshot.id, snapshot.verifiedAt);
        if (snapshot.source === "persistent") state.persistentCacheApplied++;
        notePresentation(loaded, snapshot);
        if (result.retainedUnobserved > 0) laggingSnapshots++;
        if (result.changed) changedChunks++;
      }
      applied += snapshot.deltas.length;
      appliedSnapshots++;
      if (preparedEntries >= preparationLimit || performance.now() - startedAt >= budget || applied >= limit) break;
    }
    if (!state.pendingSnapshotById.size) for (const heap of state.pendingSnapshots) heap.length = 0;
    state.appliedDeltaCount += applied;
    state.preparedEntries += preparedEntries;
    const elapsedMs = performance.now() - startedAt;
    state.maxApplySliceMs = Math.max(state.maxApplySliceMs, elapsedMs);
    if (changedChunks) onChanged();
    if (staleSnapshots || laggingSnapshots) requestSync({ reason: staleSnapshots ? "stale-snapshot" : "rpc-lag", quiet: true });
    return { applied, appliedSnapshots, changedChunks, staleSnapshots, laggingSnapshots, preparedEntries, pending: state.pendingDeltaCount, pendingSnapshots: pendingSnapshotCount(), elapsedMs };
  }

  function notePresentation(chunk, snapshot) {
    for (const section of chunk?.renderSections?.values?.() ?? []) {
      section.presentationRequest = { pairToken: snapshot.pairToken, pairValidatedAt: snapshot.pairValidatedAt ?? null,
        snapshotApplied: performance.now(), dataRevision: section.dataRevision, firstDrawSubmitted: null,
        interestEntered: chunk.interestEnteredAt ?? null, source: snapshot.source };
    }
  }

  function snapshotOptions(snapshot) {
    return { expectedChainRevision: snapshot.expectedChainRevision, snapshotToken: snapshot.token, snapshotSlot: snapshot.contextSlot, source: snapshot.source || "rpc", snapshotCommitment: snapshot.snapshotCommitment, readStartedAt: snapshot.readStartedAt };
  }

  function supersedePendingSnapshot(id) {
    const pending = state.pendingSnapshotById.get(id);
    if (!pending) return;
    pending.superseded = true;
    state.pendingSnapshotById.delete(id);
    state.pendingSnapshotsByTier[pending.serviceTier]--;
    state.pendingDeltaCount = Math.max(0, state.pendingDeltaCount - pending.deltas.length);
  }

  function pendingSnapshotCount() {
    return state.pendingSnapshotById.size;
  }

  function clearPendingSnapshots() {
    for (const heap of state.pendingSnapshots) heap.length = 0;
    state.pendingSnapshotHead = 0;
    state.pendingSnapshotById.clear();
    state.snapshotVirtualTime.fill(0);
    state.pendingSnapshotsByTier.fill(0);
    state.snapshotServiceCursor = 0;
    state.snapshotPriorityCenter = "";
    state.pendingDeltaCount = 0;
  }

  function trimSnapshotCache() {
    if (state.snapshotCache.size <= SNAPSHOT_CACHE_LIMIT && state.snapshotCacheDeltaCount <= SNAPSHOT_CACHE_DELTA_LIMIT) return;
    for (const id of state.snapshotCache.keys()) {
      if (state.pendingSnapshotById.has(id)) continue;
      deleteSnapshotCache(id);
      if (!chunks?.chunks?.has?.(id)) state.syncedChunkIds.delete(id);
      if (state.snapshotCache.size <= SNAPSHOT_CACHE_LIMIT && state.snapshotCacheDeltaCount <= SNAPSHOT_CACHE_DELTA_LIMIT) break;
    }
  }

  function storeSnapshotCache(snapshot, { needsRefresh = false } = {}) {
    if (!snapshot?.id) return null;
    const canonical = canonicalizeSnapshot(snapshot);
    const cached = {
      ...canonical,
      id: snapshot.id,
      token: Math.max(1, Math.trunc(Number(snapshot.token) || state.snapshotSerial++)),
      contextSlot: optionalContextSlot(snapshot.contextSlot),
      source: snapshot.source || "rpc",
      snapshotCommitment: snapshot.snapshotCommitment,
      readStartedAt: snapshot.readStartedAt,
      verifiedAt: snapshot.verifiedAt,
      needsRefresh: Boolean(needsRefresh),
    };
    deleteSnapshotCache(cached.id);
    state.snapshotCache.set(cached.id, cached);
    state.snapshotCacheDeltaCount += cached.deltas.length;
    trimSnapshotCache();
    return cached;
  }

  function deleteSnapshotCache(id) {
    const cached = state.snapshotCache.get(id);
    if (!cached) return false;
    state.snapshotCache.delete(id);
    state.snapshotCacheDeltaCount = Math.max(0, state.snapshotCacheDeltaCount - (cached.deltas?.length || 0));
    return true;
  }

  function collectLoadedChunkTargets() {
    const targets = [];
    for (const chunk of chunks?.chunks?.values?.() ?? []) {
      if (!chunk) continue;
      targets.push({
        id: chunk.id,
        chunkX: chunk.chunkX,
        chunkZ: chunk.chunkZ,
        instance: chunk,
        expectedChainRevision: Math.max(0, Math.trunc(Number(chunk.chainRevision) || 0)),
      });
    }
    targets.sort((a, b) => chunkPriority(a, chunks) - chunkPriority(b, chunks));
    return targets;
  }

  async function hydratePersistentSnapshots(targets, { syncEpoch = state.syncEpoch } = {}) {
    if (!state.persistentCacheScope || syncEpoch !== state.syncEpoch) return { cacheHits: 0, appliedSnapshots: 0, changedChunks: 0 };
    if (state.persistentClearPromise) await state.persistentClearPromise;
    if (syncEpoch !== state.syncEpoch) return { cacheHits: 0, appliedSnapshots: 0, changedChunks: 0 };
    const missing = (targets ?? []).filter((target) => !state.snapshotCache.has(target.id));
    void pairCache.get(missing, { chunkSize: chunks.chunkSize || 16, minY: chunks.minY,
      expectedOwner: state.authorityConfig?.programId || normalizedScopeHint?.programId,
      onPair: pair => {
        if (syncEpoch !== state.syncEpoch || state.snapshotCache.has(pair.id) || state.pendingSnapshotById.has(pair.id)) return;
        state.verifiedAtById.set(pair.id, pair.authoritativeObservedAt);
        const loaded = chunks.chunks.get(pair.id);
        if (!loaded) return;
        const snapshot = { ...pair.canonical, id: pair.id, contextSlot: pair.knownAtSlot, verifiedAt: pair.authoritativeObservedAt,
          token: state.snapshotSerial++, source: "persistent", syncEpoch, instance: loaded, expectedChainRevision: loaded.chainRevision ?? 0 };
        storeSnapshotCache(snapshot, { needsRefresh: true }); queueChainSnapshot(snapshot, { updateCache: false });
      } });
    const queuedIds = new Set();
    const enqueue = async (cachedSnapshot) => {
      if (syncEpoch !== state.syncEpoch || queuedIds.has(cachedSnapshot.id) || state.snapshotCache.has(cachedSnapshot.id) || state.pendingSnapshotById.has(cachedSnapshot.id)) return;
      queuedIds.add(cachedSnapshot.id);
      const loaded = chunks?.chunks?.get?.(cachedSnapshot.id);
      const canonical = await canonicalizeChunkSnapshotAsync(cachedSnapshot, { chunkSize: chunks.chunkSize || 16 });
      if (syncEpoch !== state.syncEpoch || state.snapshotCache.has(cachedSnapshot.id) || state.pendingSnapshotById.has(cachedSnapshot.id)) return;
      const snapshot = { ...canonical, token: state.snapshotSerial++, source: "persistent", syncEpoch, instance: loaded, verifiedAt: null, expectedChainRevision: loaded?.chainRevision ?? 0 };
      storeSnapshotCache(snapshot, { needsRefresh: true });
      queueChainSnapshot(snapshot, { updateCache: false });
      state.syncedChunkIds.delete(snapshot.id);
    };
    const snapshots = await durableCache.getVerifiedSnapshots?.(missing, { chunkSize: chunks.chunkSize || 16, onSnapshot: enqueue }) ?? [];
    const legacyScope = legacyPreviewScope();
    if (legacyScope && syncEpoch === state.syncEpoch) {
      // The reviewed v0.1.95 deployment has a fixed core/global PDA. Old merged
      // rows are visual previews only; they never enter the component cache.
      const legacyTargets = missing.filter(target => !state.snapshotCache.has(target.id) && !state.pendingSnapshotById.has(target.id));
      const legacy = await durableCache.getVerifiedSnapshots?.(legacyTargets, { chunkSize: chunks.chunkSize || 16, readScope: legacyScope, onSnapshot: enqueue }) ?? [];
      snapshots.push(...legacy);
    }
    if (syncEpoch !== state.syncEpoch) return { cacheHits: 0, appliedSnapshots: 0, changedChunks: 0 };
    // Embedders may implement the pre-streaming cache interface.
    for (const cachedSnapshot of snapshots) await enqueue(cachedSnapshot);
    state.persistentCacheHits += snapshots.length;
    return { cacheHits: snapshots.length, appliedSnapshots: 0, changedChunks: 0, queuedSnapshots: snapshots.length };
  }

  function legacyPreviewScope() {
    const config = state.authorityConfig;
    if (state.genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
      || config?.globalConfig !== "46bTKGThh96ChxJEmcKz6GvudGi3d7YDiAFtVhKb2Y5f"
      || config.programId !== DEFAULT_CHAIN_CHUNK_CACHE_SCOPE_HINT.programId
      || config.seed !== "chunk-broken" || config.placedSeed !== "chunk-placed") return null;
    return ["chunk-cache-v3", "solana-devnet", config.programId, String(chunks?.worldSeed ?? chunks?.config?.worldSeed ?? "unknown"),
      Math.trunc(Number(chunks?.generationVersion) || 0), Math.trunc(Number(chunks?.resourceRuleVersion) || 0),
      Math.trunc(Number(chunks?.chunkSize) || 16), Math.trunc(Number(chunks?.minY) || 0), Math.trunc(Number(chunks?.height) || 0)]
      .map(value => encodeURIComponent(String(value))).join("|");
  }

  function configurePersistentCacheScope(module, connection) {
    const pdaConfig = module?.getChunkBrokenPdaDerivationConfig?.();
    state.authorityConfig = pdaConfig;
    const nextScope = buildPersistentCacheScope({
      programId: pdaConfig?.programId, globalConfig: pdaConfig?.globalConfig, seed: pdaConfig?.seed, placedSeed: pdaConfig?.placedSeed, genesis: state.genesis,
      cluster: normalizedScopeHint?.cluster || rpcClusterIdentity(String(connection?.rpcEndpoint || connection?._rpcEndpoint || "")),
      rpcEndpoint: String(connection?.rpcEndpoint || connection?._rpcEndpoint || ""),
      chunks,
    });
    if (state.persistentCacheScope === nextScope) return nextScope;
    if (state.persistentCacheScope) {
      state.syncedChunkIds.clear();
      state.verifiedAtById.clear();
      state.snapshotCache.clear();
      state.snapshotCacheDeltaCount = 0;
      clearPendingSnapshots();
      clearTimeout(state.persistentWriteTimer);
      state.persistentWriteTimer = null;
      state.persistentWriteById.clear();
      state.lastRpcContextSlot = null;
      chunks?.resetChainSnapshotAuthority?.();
    }
    state.persistentCacheScope = nextScope;
    return nextScope;
  }

  function canonicalizeSnapshot(snapshot) {
    return canonicalizeChunkSnapshot(snapshot, { chunkSize: chunks?.chunkSize || 16 });
  }

  function queuePersistentWrite(snapshot) {
    if (!snapshot?.id || !state.persistentCacheScope) return;
    if (durableCache.pairs && pairCache.peek(snapshot)) return;
    const canonical = canonicalizeSnapshot(snapshot);
    state.persistentWriteById.set(canonical.id, { ...canonical, verifiedAt: snapshot.verifiedAt });
    if (state.persistentWriteTimer) return;
    state.persistentWriteTimer = setTimeout(flushPersistentWrites, PERSISTENT_WRITE_DELAY_MS);
  }

  async function flushPersistentWrites() {
    state.persistentWriteTimer = null;
    if (!state.persistentWriteById.size || !state.persistentCacheScope) return;
    const snapshots = [...state.persistentWriteById.values()];
    state.persistentWriteById.clear();
    try {
      await durableCache.putVerifiedSnapshots?.(snapshots, { chunkSize: chunks?.chunkSize || 16 });
    } catch {
      // IndexedDB can be unavailable in private browsing; the in-memory cache remains active.
    }
  }

  function fetchBatchesViaWorker(batches, connection, chainModule, minContextSlot = null, onBatch, syncEpoch = state.syncEpoch) {
    if (state.rpcWorkerDisabled || typeof Worker === "undefined") return Promise.resolve(false);
    const rpcUrl = String(connection?.rpcEndpoint || connection?._rpcEndpoint || "");
    const pdaConfig = chainModule?.getChunkBrokenPdaDerivationConfig?.();
    if (!rpcUrl || !validPdaConfig(pdaConfig)) return Promise.resolve(false);
    const worker = ensureRpcWorker();
    if (!worker) return Promise.resolve(false);
    const taskId = state.rpcWorkerTaskSerial++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => disableRpcWorker(new Error("chunk PDA RPC worker timed out")), RPC_WORKER_TASK_TIMEOUT_MS * Math.ceil(batches.length / RPC_BATCH_CONCURRENCY));
      state.rpcWorkerRequests.set(taskId, { resolve, reject, timer, onBatch, syncEpoch, pending: new Set() });
      try {
        worker.postMessage({ type: "fetchChunkPdas", taskId, syncEpoch, concurrency: RPC_BATCH_CONCURRENCY, pdaConfig, rpcUrl, timeoutMs: RPC_BATCH_TIMEOUT_MS, minContextSlot, scope: state.persistentCacheScope, endpointEpoch: state.endpointEpoch, encoding: rpcEncoding,
          baselines: Object.fromEntries(batches.flat().filter(chunk => chunk.baseline).map(chunk => [chunk.id, state.rpcWorkerPairTokens.has(chunk.baseline.pairToken) ? { pairToken: chunk.baseline.pairToken } : chunk.baseline])),
          batchReads: batches.map(batchReadOptions),
          batchEncodings: batches.map(batch => batch.some(chunk => state.fullRepairIds.has(chunk.id)) ? "base64" : rpcEncoding), chunkSize: chunks.chunkSize || 16, minY: chunks.minY, batches: batches.map((batch) => batch.map((chunk) => ({ chunkX: chunk.chunkX, chunkZ: chunk.chunkZ }))) });
      } catch (error) { disableRpcWorker(error); }
    });
  }

  function batchReadOptions(batch) {
    const baselines = batch.map(target => target.baseline);
    const slots = baselines.filter(Boolean).map(pair => pair.knownAtSlot);
    return { changedSinceSlot: slots.length === batch.length ? Math.min(...slots) : null,
      minContextSlot: Math.max(state.lastRpcContextSlot || 0, ...slots) || null };
  }

  function ensurePresentation(id) {
    const chunk = chunks?.chunks?.get?.(id), cached = state.snapshotCache.get(id);
    if (!chunk) return false;
    if (cached && chunk.chainSnapshotToken !== cached.token && !state.pendingSnapshotById.has(id)) {
      queueChainSnapshot({ ...cached, source: "memory", expectedChainRevision: chunk.chainRevision ?? 0 }, { updateCache: false });
    }
    chunks.ensureChainPresentation?.(id);
    return true;
  }

  function updateInterest() {
    const key = [chunks?.centerChunkX, chunks?.centerChunkZ, chunks?.viewDistance, chunks?.chunks?.size, chunks?.interestRevision].join(":");
    if (key === state.interestKey) return false;
    state.interestKey = key; state.interestEpoch++;
    for (const chunk of chunks?.chunks?.values?.() ?? []) { chunk.interestEnteredAt ??= performance.now(); ensurePresentation(chunk.id); }
    void preloadPersistentCache({ reason: "interest-cache" });
    void requestSync({ reason: "interest", urgent: true });
    return true;
  }

  async function configureAuthorityScope(module, connection) {
    const epoch = state.syncEpoch;
    const identityKey = JSON.stringify([connection.rpcEndpoint || connection._rpcEndpoint || "", module.getChunkBrokenPdaDerivationConfig?.()]);
    state.identityTarget = identityKey;
    if (typeof connection.getGenesisHash === "function") {
      const endpoint = String(connection.rpcEndpoint || connection._rpcEndpoint || "");
      if (state.genesisEndpoint !== endpoint) {
        const genesis = await withTimeout(connection.getGenesisHash(), RPC_BATCH_TIMEOUT_MS, "chain identity lookup timed out");
        if (epoch !== state.syncEpoch || identityKey !== state.identityTarget) throw new Error("Chain identity observation superseded.");
        if (typeof genesis !== "string" || genesis.length < 20) throw new Error("Invalid chain identity.");
        state.genesis = genesis; state.genesisEndpoint = endpoint;
      }
    }
    return configurePersistentCacheScope(module, connection);
  }

  function ensureRpcWorker() {
    if (state.rpcWorker) return state.rpcWorker;
    try {
      const worker = new Worker(new URL("./play-chain-pda-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (event) => {
        const message = event.data;
        const request = state.rpcWorkerRequests.get(message?.taskId);
        if (!request || message.syncEpoch !== request.syncEpoch || request.syncEpoch !== state.syncEpoch) { state.staleWorkerMessages++; return; }
        if (message.type === "chunkPdaBatchFetched") {
          const pending = Promise.resolve(request.onBatch(message.result, message.batchIndex));
          request.pending.add(pending);
          pending.finally(() => request.pending.delete(pending)).catch(() => {});
          return;
        }
        state.rpcWorkerRequests.delete(message.taskId);
        clearTimeout(request.timer);
        if (message.type === "chunkPdasFetched") Promise.all(request.pending).then(() => request.resolve(true), request.reject);
        else request.reject(new Error(message.error || "chunk PDA RPC worker failed"));
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        disableRpcWorker(new Error(event?.message || "chunk PDA RPC worker failed"));
      };
      worker.onmessageerror = () => disableRpcWorker(new Error("chunk PDA RPC worker message decode failed"));
      state.rpcWorker = worker;
      return worker;
    } catch (error) {
      state.rpcWorkerDisabled = true;
      return null;
    }
  }

  function disableRpcWorker(error) {
    state.rpcWorkerDisabled = true;
    state.rpcWorkerPairTokens.clear();
    state.rpcWorker?.terminate?.();
    state.rpcWorker = null;
    for (const request of state.rpcWorkerRequests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    state.rpcWorkerRequests.clear();
  }
}

function buildPersistentCacheScope({ programId, cluster, rpcEndpoint, chunks, globalConfig = "", seed = "chunk-broken", placedSeed = "chunk-placed", genesis = "" } = {}) {
  const normalizedProgramId = String(programId || "").trim();
  if (!normalizedProgramId) throw new Error("Chunk PDA cache scope is unavailable.");
  const worldSeed = String(chunks?.worldSeed ?? chunks?.config?.worldSeed ?? "unknown");
  return [
    "chunk-cache-v4-lossless",
    genesis || "unverified:" + (normalizeClusterIdentity(cluster) || rpcClusterIdentity(rpcEndpoint)),
    globalConfig, seed, placedSeed, "NCBK1:NCPB1",
    genesis ? "verified-genesis" : normalizeClusterIdentity(cluster) || rpcClusterIdentity(rpcEndpoint),
    normalizedProgramId,
    worldSeed,
    Math.trunc(Number(chunks?.generationVersion) || 0),
    Math.trunc(Number(chunks?.resourceRuleVersion) || 0),
    Math.trunc(Number(chunks?.chunkSize) || 16),
    Math.trunc(Number(chunks?.minY) || 0),
    Math.trunc(Number(chunks?.height) || 0),
  ].map((value) => encodeURIComponent(String(value))).join("|");
}

function normalizePersistentScopeHint(value) {
  const programId = String(value?.programId || "").trim();
  const cluster = normalizeClusterIdentity(value?.cluster);
  return programId && cluster ? { programId, cluster, globalConfig: String(value.globalConfig || ""), seed: value.seed, placedSeed: value.placedSeed } : null;
}

function normalizeClusterIdentity(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "devnet" || text === "solana-devnet") return "solana-devnet";
  if (text === "testnet" || text === "solana-testnet") return "solana-testnet";
  if (["mainnet", "mainnet-beta", "solana-mainnet-beta"].includes(text)) return "solana-mainnet-beta";
  return "";
}

function rpcClusterIdentity(endpoint) {
  const text = String(endpoint || "").trim().toLowerCase();
  if (/devnet/.test(text)) return "solana-devnet";
  if (/testnet/.test(text)) return "solana-testnet";
  if (/mainnet|api\.mainnet-beta/.test(text)) return "solana-mainnet-beta";
  try {
    const url = new URL(text);
    if (["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return `solana-local:${url.port || "8899"}`;
    return `solana-rpc-unverified:${url.host}`;
  } catch {
    return "solana-rpc-unverified:unknown";
  }
}

function validPdaConfig(config) {
  return Boolean(config
    && typeof config.seed === "string"
    && typeof config.placedSeed === "string"
    && typeof config.globalConfig === "string"
    && typeof config.programId === "string");
}

async function derivePubkeysForBatch(batch, deriveChunkBrokenPda, deriveChunkPlacedPda) {
  const pubkeys = [];
  let stepStartedAt = performance.now();
  for (const chunk of batch) {
    pubkeys.push(deriveChunkBrokenPda(chunk.chunkX, chunk.chunkZ)[0]);
    pubkeys.push(deriveChunkPlacedPda(chunk.chunkX, chunk.chunkZ)[0]);
    if (performance.now() - stepStartedAt >= ASYNC_STEP_BUDGET_MS) {
      await yieldToFrame();
      stepStartedAt = performance.now();
    }
  }
  return pubkeys;
}

async function fetchMultipleAccountsWithContext(connection, pubkeys, minContextSlot = 0) {
  if (typeof connection?.getMultipleAccountsInfoAndContext === "function") {
    const config = { commitment: "finalized" };
    const minimumSlot = Math.max(0, Math.trunc(Number(minContextSlot) || 0));
    if (minimumSlot > 0) config.minContextSlot = minimumSlot;
    const readStartedAt = Date.now();
    const response = await connection.getMultipleAccountsInfoAndContext(pubkeys, config);
    return {
      infos: Array.isArray(response?.value) ? response.value : [],
      contextSlot: optionalContextSlot(response?.context?.slot),
      readStartedAt, observedAt: Date.now(), commitment: "finalized",
    };
  }
  const readStartedAt = Date.now();
  const infos = await connection.getMultipleAccountsInfo(pubkeys, "finalized");
  return { infos, contextSlot: null, readStartedAt, observedAt: Date.now(), commitment: "finalized" };
}

function chunkPriority(chunk, manager) {
  const dx = chunk.chunkX - (manager?.centerChunkX || 0);
  const dz = chunk.chunkZ - (manager?.centerChunkZ || 0);
  return Math.max(Math.abs(dx), Math.abs(dz)) * 1000 + dx * dx + dz * dz;
}

function chunkArray(items, size) {
  const step = Math.max(1, Math.trunc(Number(size) || DEFAULT_BATCH_SIZE));
  const batches = [];
  for (let index = 0; index < items.length; index += step) batches.push(items.slice(index, index + step));
  return batches;
}

function defer(task) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(task()), 0);
  });
}

function yieldToFrame() { return yieldChunkSyncTask(); }

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), Math.max(1000, Math.trunc(timeoutMs || RPC_BATCH_TIMEOUT_MS)));
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function readableError(error) {
  const message = String(error?.message || error || "unknown error");
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

function chainPdaReadEnabled() {
  try {
    return globalThis.localStorage?.getItem(CHAIN_CHUNK_PDA_READ_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function getChainChunkRpcEncoding() {
  try { return globalThis.localStorage?.getItem("nicechunk.chunkRpcEncoding") === "base64+zstd" ? "base64+zstd" : "base64"; }
  catch { return "base64"; }
}

export function isChainChunkPdaReadEnabled() {
  return chainPdaReadEnabled();
}

export function setChainChunkPdaReadEnabled(enabled) {
  try {
    if (enabled) globalThis.localStorage?.removeItem(CHAIN_CHUNK_PDA_READ_STORAGE_KEY);
    else globalThis.localStorage?.setItem(CHAIN_CHUNK_PDA_READ_STORAGE_KEY, "0");
  } catch {
    // Storage can be unavailable; in that case the runtime default remains enabled.
  }
  return chainPdaReadEnabled();
}
