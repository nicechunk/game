import { BLOCK_ID, chunkId, worldToChunk } from "/chunk.js/play.js";
import { loadPlayChainModule } from "./play-chain-adapter.js";
import {
  canonicalizeChunkSnapshot,
  createPlayChainChunkCache,
  sameCanonicalChunkSnapshot,
} from "./play-chain-chunk-cache.js";

const DEFAULT_BATCH_SIZE = 100;
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
const CHUNK_BROKEN_MAX_CAPACITY = 2048;
export const CHAIN_CHUNK_PDA_READ_STORAGE_KEY = "nicechunk.chainChunkPdaRead";
export const DEFAULT_CHAIN_CHUNK_CACHE_SCOPE_HINT = Object.freeze({
  cluster: "devnet",
  programId: "GnVKn442KDTDgCyjVG7SEtCQQLjaCiLvrEZDWSU13wbj",
});
const CHUNK_BROKEN_MAGIC = "NCBK";
const CHUNK_BROKEN_VERSION = 1;
const CHUNK_BROKEN_HEADER_LENGTH = 16;
const CHUNK_BROKEN_RECORD_LENGTH = 3;
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
} = {}) {
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
    pendingSnapshots: [],
    pendingSnapshotHead: 0,
    pendingSnapshotById: new Map(),
    pendingDeltaCount: 0,
    snapshotCache: new Map(),
    snapshotCacheDeltaCount: 0,
    snapshotSerial: 1,
    syncEpoch: 1,
    rpcWorker: null,
    rpcWorkerDisabled: false,
    rpcWorkerTaskSerial: 1,
    rpcWorkerRequests: new Map(),
    lastRpcTransport: "main",
    lastRpcContextSlot: 0,
    lastRpcEndpoint: "",
    persistentCacheScope: "",
    persistentCacheWarmPromise: null,
    persistentClearPromise: null,
    persistentWriteById: new Map(),
    persistentWriteTimer: null,
    persistentCacheHits: 0,
    persistentCacheApplied: 0,
    unchangedSnapshotCount: 0,
  };
  const normalizedScopeHint = normalizePersistentScopeHint(persistentScopeHint);
  if (normalizedScopeHint) {
    state.persistentCacheScope = buildPersistentCacheScope({
      programId: normalizedScopeHint.programId,
      cluster: normalizedScopeHint.cluster,
      chunks,
    });
  }
  const durableCache = persistentCache || createPlayChainChunkCache({
    getScope: () => state.persistentCacheScope || "unconfigured",
  });

  return {
    requestSync,
    syncLoadedChunks,
    preloadPersistentCache,
    applyQueuedDeltas,
    clearLocalCache,
    invalidateChunk,
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
      persistentCache: durableCache.snapshot?.() ?? null,
    };
  }

  function clearLocalCache({ clearRenderDeltas = false, clearPersistent = false } = {}) {
    const persistentScope = state.persistentCacheScope;
    state.syncEpoch += 1;
    state.syncedChunkIds.clear();
    state.queued = false;
    state.queuedForce = false;
    state.lastError = "";
    state.lastInvalidAccountCount = 0;
    state.lastRpcContextSlot = 0;
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
      const clearing = Promise.resolve(durableCache.clearScope?.(persistentScope));
      const pendingClear = clearing.finally(() => {
        if (state.persistentClearPromise === pendingClear) state.persistentClearPromise = null;
      });
      state.persistentClearPromise = pendingClear;
    }
    appendEvent(`${clearPersistent ? "Persistent and in-memory" : "In-memory"} chunk PDA cache cleared. Chain accounts will be re-read from RPC.`);
  }

  function invalidateChunk(idOrChunk) {
    const id = typeof idOrChunk === "string" ? idOrChunk : chunkId(idOrChunk?.chunkX ?? 0, idOrChunk?.chunkZ ?? 0);
    state.syncedChunkIds.delete(id);
    supersedePendingSnapshot(id);
    const loaded = chunks?.chunks?.get?.(id);
    if (loaded?.chainDeltas?.size) {
      storeSnapshotCache({
        id,
        chunkX: loaded.chunkX,
        chunkZ: loaded.chunkZ,
        token: state.snapshotSerial++,
        deltas: Array.from(loaded.chainDeltas.values()),
      }, { needsRefresh: true });
    } else {
      deleteSnapshotCache(id);
    }
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
        configurePersistentCacheScope(module, connection);
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

  function requestSync({ force = false, reason = "auto", quiet = true } = {}) {
    if (!chunks) return Promise.resolve({ ok: false, reason: "chunks-unavailable" });
    if (!chainPdaReadEnabled()) return Promise.resolve({ ok: false, reason: "chunk-pda-read-disabled" });
    if (force) state.syncedChunkIds.clear();
    if (state.loading) {
      state.queued = true;
      state.queuedForce ||= force;
      return Promise.resolve({ ok: false, reason: "already-loading" });
    }
    const now = performance.now();
    if (!force && state.lastError && now - state.lastSyncAt < ERROR_RETRY_MS) {
      state.queued = true;
      return Promise.resolve({ ok: false, reason: "error-backoff" });
    }
    if (!force && now - state.lastSyncAt < SYNC_COOLDOWN_MS) {
      state.queued = true;
      return Promise.resolve({ ok: false, reason: "cooldown" });
    }
    return defer(() => syncLoadedChunks({ force, reason, quiet }));
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

    const targets = collectTargetChunks({ force });
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
    let deltaCount = 0;
    let batchCount = 0;
    let invalidAccountCount = 0;
    let firstInvalidAccountError = "";
    let failedBatchCount = 0;
    let firstBatchError = "";
    let minimumContextSlot = 0;
    let expectedOwner = "";
    let observedContextSlot = 0;
    try {
      const module = await loadChainModule();
      if (syncEpoch !== state.syncEpoch) return supersededSyncResult();
      if (module.isNicechunkChainSyncEnabled?.() === false) {
        state.lastError = "chain-sync-disabled";
        return { ok: false, reason: "chain-sync-disabled" };
      }
      const connection = module.getNicechunkConnection?.();
      const deriveChunkBrokenPda = module.deriveGameChunkBrokenPda || module.deriveChunkBrokenPda;
      if (!connection?.getMultipleAccountsInfo || typeof deriveChunkBrokenPda !== "function") {
        state.lastError = "chunk-pda-rpc-unavailable";
        return { ok: false, reason: "chunk-pda-rpc-unavailable" };
      }

      const rpcEndpoint = String(connection?.rpcEndpoint || connection?._rpcEndpoint || "");
      if (state.lastRpcEndpoint && state.lastRpcEndpoint !== rpcEndpoint) state.lastRpcContextSlot = 0;
      state.lastRpcEndpoint = rpcEndpoint;
      configurePersistentCacheScope(module, connection);
      if (state.persistentCacheWarmPromise) await state.persistentCacheWarmPromise;
      if (syncEpoch !== state.syncEpoch) return supersededSyncResult();
      await hydratePersistentSnapshots(targets, { syncEpoch });
      if (syncEpoch !== state.syncEpoch) return supersededSyncResult();
      minimumContextSlot = state.lastRpcContextSlot;
      expectedOwner = String(module.getChunkBrokenPdaDerivationConfig?.()?.programId || "");
      observedContextSlot = minimumContextSlot;

      const batches = chunkArray(targets, batchSize);
      batchCount = batches.length;
      if (!quiet) appendEvent(`Chunk PDA sync: ${targets.length} chunks in ${batchCount} RPC batches of ${batchSize}.`);

      const workerBatchResults = await fetchBatchesViaWorker(batches, connection, module, minimumContextSlot).catch(() => null);
      if (syncEpoch !== state.syncEpoch) return supersededSyncResult();
      if (workerBatchResults) {
        state.lastRpcTransport = "worker";
        state.totalRpcCalls += batches.length;
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          const batchResult = workerBatchResults[batchIndex];
          if (!batchResult?.ok) {
            failedBatchCount += 1;
            firstBatchError ||= readableError(batchResult?.error || "chunk PDA worker batch failed");
            continue;
          }
          if (!await consumeDecodedBatch(batches[batchIndex], batchResult.infos, batchResult.contextSlot)) return supersededSyncResult();
        }
      } else {
        state.lastRpcTransport = "main";
        for (let waveStart = 0; waveStart < batches.length; waveStart += RPC_BATCH_CONCURRENCY) {
          const wave = batches.slice(waveStart, waveStart + RPC_BATCH_CONCURRENCY);
          const pubkeyGroups = await Promise.all(wave.map((batch) => derivePubkeysForBatch(batch, deriveChunkBrokenPda)));
          if (syncEpoch !== state.syncEpoch) return supersededSyncResult();
          state.totalRpcCalls += pubkeyGroups.length;
          const infoResults = await Promise.allSettled(pubkeyGroups.map((pubkeys) => withTimeout(
            fetchMultipleAccountsWithContext(connection, pubkeys, minimumContextSlot),
            RPC_BATCH_TIMEOUT_MS,
            `chunk PDA RPC batch timed out after ${Math.round(RPC_BATCH_TIMEOUT_MS / 1000)}s`,
          )));
          if (syncEpoch !== state.syncEpoch) return supersededSyncResult();
          for (let waveIndex = 0; waveIndex < wave.length; waveIndex += 1) {
            const infoResult = infoResults[waveIndex];
            if (infoResult.status !== "fulfilled") {
              failedBatchCount += 1;
              firstBatchError ||= readableError(infoResult.reason);
              continue;
            }
            if (!await consumeDecodedBatch(wave[waveIndex], infoResult.value.infos, infoResult.value.contextSlot)) return supersededSyncResult();
          }
          if (waveStart + RPC_BATCH_CONCURRENCY < batches.length) await yieldToFrame();
        }
      }

      state.lastSyncAt = performance.now();
      state.lastBatchCount = batchCount;
      state.lastDeltaCount = deltaCount;
      state.lastInvalidAccountCount = invalidAccountCount;
      state.lastRpcContextSlot = Math.max(state.lastRpcContextSlot, observedContextSlot);
      state.totalDeltaCount += deltaCount;
      if (invalidAccountCount || failedBatchCount) {
        const issues = [];
        if (failedBatchCount) issues.push(`${failedBatchCount} failed RPC batch${failedBatchCount === 1 ? "" : "es"}${firstBatchError ? `: ${firstBatchError}` : ""}`);
        if (invalidAccountCount) issues.push(`${invalidAccountCount} invalid ChunkBroken account${invalidAccountCount === 1 ? "" : "s"}${firstInvalidAccountError ? `: ${firstInvalidAccountError}` : ""}`);
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
        appendEvent(`Chunk PDA sync done: ${targets.length} chunks scanned, ${deltaCount} broken block deltas queued in ${elapsed}ms.`);
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

    async function consumeDecodedBatch(batch, infos, contextSlot = 0) {
      const slot = Math.max(0, Math.trunc(Number(contextSlot) || 0));
      if (minimumContextSlot > 0 && slot < minimumContextSlot) {
        failedBatchCount += 1;
        firstBatchError ||= `RPC context slot ${slot || "missing"} is older than ${minimumContextSlot}`;
        return true;
      }
      const decodedBatch = await decodeBatchSnapshots(batch, infos, chunks.chunkSize || 16, chunks.minY, {
        contextSlot: slot,
        expectedOwner,
      });
      if (syncEpoch !== state.syncEpoch) return false;
      for (const decodedSnapshot of decodedBatch.snapshots) {
        const snapshot = canonicalizeSnapshot(decodedSnapshot);
        const loaded = chunks?.chunks?.get?.(snapshot.id);
        const cached = state.snapshotCache.get(snapshot.id);
        if (cached && sameCanonicalChunkSnapshot(cached, snapshot)) {
          const acknowledged = !loaded || chunks.acknowledgeChainSnapshotForChunk?.(snapshot.id, {
            snapshotToken: cached.token,
            snapshotSlot: snapshot.contextSlot,
          });
          if (acknowledged) {
            const refreshed = storeSnapshotCache({
              ...cached,
              contextSlot: Math.max(cached.contextSlot, snapshot.contextSlot),
            });
            state.syncedChunkIds.add(snapshot.id);
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
      observedContextSlot = Math.max(observedContextSlot, slot);
      return true;
    }
  }

  function collectTargetChunks({ force = false } = {}) {
    const manager = chunks;
    const result = [];
    for (const chunk of manager?.chunks?.values?.() ?? []) {
      if (!chunk) continue;
      if (!force && state.pendingSnapshotById.has(chunk.id)) continue;
      const cached = state.snapshotCache.get(chunk.id);
      if (!force && cached && chunk.chainRevision === 0 && chunk.chainSnapshotToken !== cached.token) {
        queueChainSnapshot({ ...cached, expectedChainRevision: 0 }, { updateCache: false });
        state.syncedChunkIds.add(chunk.id);
        continue;
      }
      if (!force && state.syncedChunkIds.has(chunk.id)) {
        if (cached && chunk.chainSnapshotToken === cached.token && !cached.needsRefresh) continue;
        state.syncedChunkIds.delete(chunk.id);
      }
      result.push({
        id: chunk.id,
        chunkX: chunk.chunkX,
        chunkZ: chunk.chunkZ,
        expectedChainRevision: Math.max(0, Math.trunc(Number(chunk.chainRevision) || 0)),
      });
    }
    result.sort((a, b) => chunkPriority(a, manager) - chunkPriority(b, manager));
    return result;
  }

  function queueChainSnapshot(snapshot, { updateCache = true } = {}) {
    if (!snapshot?.id) return;
    supersedePendingSnapshot(snapshot.id);
    const canonical = canonicalizeSnapshot(snapshot);
    const queued = {
      ...snapshot,
      ...canonical,
      token: Math.max(1, Math.trunc(Number(snapshot.token) || state.snapshotSerial++)),
      contextSlot: Math.max(0, Math.trunc(Number(snapshot.contextSlot) || 0)),
      superseded: false,
      cacheOnApply: updateCache,
    };
    state.pendingSnapshots.push(queued);
    state.pendingSnapshotById.set(queued.id, queued);
    state.pendingDeltaCount += queued.deltas.length;
  }

  function applyQueuedDeltas({ budgetMs = DEFAULT_APPLY_BUDGET_MS, maxDeltas = DEFAULT_APPLY_MAX_DELTAS } = {}) {
    if (!chunks || !pendingSnapshotCount()) return {
      applied: 0,
      appliedSnapshots: 0,
      changedChunks: 0,
      pending: state.pendingDeltaCount,
      pendingSnapshots: pendingSnapshotCount(),
      elapsedMs: 0,
    };
    const startedAt = performance.now();
    const budget = Math.max(0.1, Number(budgetMs) || DEFAULT_APPLY_BUDGET_MS);
    const limit = Math.max(1, Math.trunc(Number(maxDeltas) || DEFAULT_APPLY_MAX_DELTAS));
    let applied = 0;
    let appliedSnapshots = 0;
    let changedChunks = 0;
    let staleSnapshots = 0;
    let laggingSnapshots = 0;

    while (state.pendingSnapshotHead < state.pendingSnapshots.length) {
      const snapshot = state.pendingSnapshots[state.pendingSnapshotHead];
      if (!snapshot || snapshot.superseded) {
        state.pendingSnapshotHead += 1;
        continue;
      }
      if (appliedSnapshots > 0 && applied + snapshot.deltas.length > limit) break;
      state.pendingSnapshotHead += 1;
      if (state.pendingSnapshotById.get(snapshot.id) === snapshot) state.pendingSnapshotById.delete(snapshot.id);
      state.pendingDeltaCount = Math.max(0, state.pendingDeltaCount - snapshot.deltas.length);

      const result = chunks.replaceChainDeltasForChunk(snapshot.id, snapshot.deltas, {
        expectedChainRevision: snapshot.expectedChainRevision,
        snapshotToken: snapshot.token,
        snapshotSlot: snapshot.contextSlot,
      });
      if (result?.reason === "chunk-unloaded") {
        if (snapshot.cacheOnApply) queuePersistentWrite(storeSnapshotCache(snapshot));
        state.syncedChunkIds.add(snapshot.id);
      } else if (!result?.applied) {
        state.syncedChunkIds.delete(snapshot.id);
        const cached = state.snapshotCache.get(snapshot.id);
        if (cached) cached.needsRefresh = true;
        staleSnapshots += 1;
      } else {
        const cached = storeSnapshotCache({
          ...snapshot,
          deltas: result.effectiveDeltas,
        }, { needsRefresh: result.retainedUnobserved > 0 || (!snapshot.cacheOnApply && snapshot.needsRefresh) });
        if (snapshot.cacheOnApply) queuePersistentWrite(cached);
        state.syncedChunkIds.add(snapshot.id);
        if (result.retainedUnobserved > 0) laggingSnapshots += 1;
        if (result.changed) changedChunks += 1;
      }
      applied += snapshot.deltas.length;
      appliedSnapshots += 1;
      if (performance.now() - startedAt >= budget) break;
    }

    compactPendingSnapshots();
    const elapsedMs = performance.now() - startedAt;
    if (appliedSnapshots) {
      state.appliedDeltaCount += applied;
      if (changedChunks) onChanged();
    }
    if (staleSnapshots || laggingSnapshots) requestSync({ reason: staleSnapshots ? "stale-snapshot" : "rpc-lag", quiet: true });
    return {
      applied,
      appliedSnapshots,
      changedChunks,
      staleSnapshots,
      laggingSnapshots,
      pending: state.pendingDeltaCount,
      pendingSnapshots: pendingSnapshotCount(),
      elapsedMs,
    };
  }

  function supersedePendingSnapshot(id) {
    const pending = state.pendingSnapshotById.get(id);
    if (!pending) return;
    pending.superseded = true;
    state.pendingSnapshotById.delete(id);
    state.pendingDeltaCount = Math.max(0, state.pendingDeltaCount - pending.deltas.length);
  }

  function pendingSnapshotCount() {
    return state.pendingSnapshotById.size;
  }

  function clearPendingSnapshots() {
    state.pendingSnapshots.length = 0;
    state.pendingSnapshotHead = 0;
    state.pendingSnapshotById.clear();
    state.pendingDeltaCount = 0;
  }

  function compactPendingSnapshots() {
    if (state.pendingSnapshotHead < 512 || state.pendingSnapshotHead * 2 < state.pendingSnapshots.length) return;
    state.pendingSnapshots = state.pendingSnapshots.slice(state.pendingSnapshotHead);
    state.pendingSnapshotHead = 0;
  }

  function trimSnapshotCache() {
    if (state.snapshotCache.size <= SNAPSHOT_CACHE_LIMIT && state.snapshotCacheDeltaCount <= SNAPSHOT_CACHE_DELTA_LIMIT) return;
    for (const id of state.snapshotCache.keys()) {
      if (chunks?.chunks?.has?.(id) || state.pendingSnapshotById.has(id)) continue;
      deleteSnapshotCache(id);
      state.syncedChunkIds.delete(id);
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
      contextSlot: Math.max(0, Math.trunc(Number(snapshot.contextSlot) || 0)),
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
    if (!missing.length) return { cacheHits: 0, appliedSnapshots: 0, changedChunks: 0 };
    const snapshots = await durableCache.getVerifiedSnapshots?.(missing, { chunkSize: chunks.chunkSize || 16 }) ?? [];
    if (syncEpoch !== state.syncEpoch) return { cacheHits: 0, appliedSnapshots: 0, changedChunks: 0 };
    let appliedSnapshots = 0;
    let changedChunks = 0;
    let maxContextSlot = 0;
    for (const cachedSnapshot of snapshots) {
      if (syncEpoch !== state.syncEpoch) break;
      const loaded = chunks?.chunks?.get?.(cachedSnapshot.id);
      const token = state.snapshotSerial++;
      const expectedChainRevision = Math.max(0, Math.trunc(Number(loaded?.chainRevision) || 0));
      const snapshot = canonicalizeSnapshot({
        ...cachedSnapshot,
        token,
      });
      const result = chunks.replaceChainDeltasForChunk(snapshot.id, snapshot.deltas, {
        expectedChainRevision,
        snapshotToken: token,
        snapshotSlot: snapshot.contextSlot,
      });
      let effective = snapshot;
      if (result?.applied) {
        effective = canonicalizeSnapshot({ ...snapshot, deltas: result.effectiveDeltas });
        appliedSnapshots += 1;
        if (result.changed) changedChunks += 1;
      }
      storeSnapshotCache({ ...effective, token }, { needsRefresh: true });
      state.syncedChunkIds.delete(snapshot.id);
      maxContextSlot = Math.max(maxContextSlot, snapshot.contextSlot);
    }
    state.persistentCacheHits += snapshots.length;
    state.persistentCacheApplied += appliedSnapshots;
    state.lastRpcContextSlot = Math.max(state.lastRpcContextSlot, maxContextSlot);
    if (changedChunks) onChanged();
    return { cacheHits: snapshots.length, appliedSnapshots, changedChunks, maxContextSlot };
  }

  function configurePersistentCacheScope(module, connection) {
    const pdaConfig = module?.getChunkBrokenPdaDerivationConfig?.();
    const nextScope = buildPersistentCacheScope({
      programId: pdaConfig?.programId,
      cluster: normalizedScopeHint?.cluster || rpcClusterIdentity(String(connection?.rpcEndpoint || connection?._rpcEndpoint || "")),
      rpcEndpoint: String(connection?.rpcEndpoint || connection?._rpcEndpoint || ""),
      chunks,
    });
    if (state.persistentCacheScope === nextScope) return nextScope;
    if (state.persistentCacheScope) {
      state.syncedChunkIds.clear();
      state.snapshotCache.clear();
      state.snapshotCacheDeltaCount = 0;
      clearPendingSnapshots();
      clearTimeout(state.persistentWriteTimer);
      state.persistentWriteTimer = null;
      state.persistentWriteById.clear();
      state.lastRpcContextSlot = 0;
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
    const canonical = canonicalizeSnapshot(snapshot);
    state.persistentWriteById.set(canonical.id, canonical);
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

  function fetchBatchesViaWorker(batches, connection, chainModule, minContextSlot = 0) {
    if (state.rpcWorkerDisabled || typeof Worker === "undefined") return Promise.resolve(null);
    const rpcUrl = String(connection?.rpcEndpoint || connection?._rpcEndpoint || "");
    const pdaConfig = chainModule?.getChunkBrokenPdaDerivationConfig?.();
    if (!rpcUrl || !validPdaConfig(pdaConfig)) return Promise.resolve(null);
    const worker = ensureRpcWorker();
    if (!worker) return Promise.resolve(null);
    const taskId = state.rpcWorkerTaskSerial++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        disableRpcWorker(new Error("chunk PDA RPC worker timed out"));
      }, RPC_WORKER_TASK_TIMEOUT_MS);
      state.rpcWorkerRequests.set(taskId, { resolve, reject, timer });
      try {
        worker.postMessage({
          type: "fetchChunkPdas",
          taskId,
          pdaConfig,
          rpcUrl,
          timeoutMs: RPC_BATCH_TIMEOUT_MS,
          minContextSlot,
          batches: batches.map((batch) => batch.map((chunk) => ({ chunkX: chunk.chunkX, chunkZ: chunk.chunkZ }))),
        });
      } catch (error) {
        disableRpcWorker(error);
      }
    });
  }

  function ensureRpcWorker() {
    if (state.rpcWorker) return state.rpcWorker;
    try {
      const worker = new Worker(new URL("./play-chain-pda-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = (event) => {
        const message = event.data;
        const request = state.rpcWorkerRequests.get(message?.taskId);
        if (!request) return;
        state.rpcWorkerRequests.delete(message.taskId);
        clearTimeout(request.timer);
        if (message.type === "chunkPdasFetched") request.resolve(message.batchResults ?? []);
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
    state.rpcWorker?.terminate?.();
    state.rpcWorker = null;
    for (const request of state.rpcWorkerRequests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    state.rpcWorkerRequests.clear();
  }
}

function buildPersistentCacheScope({ programId, cluster, rpcEndpoint, chunks } = {}) {
  const normalizedProgramId = String(programId || "").trim();
  if (!normalizedProgramId) throw new Error("Chunk PDA cache scope is unavailable.");
  const worldSeed = String(chunks?.worldSeed ?? chunks?.config?.worldSeed ?? "unknown");
  return [
    "chunk-cache-v2",
    normalizeClusterIdentity(cluster) || rpcClusterIdentity(rpcEndpoint),
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
  return programId && cluster ? { programId, cluster } : null;
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
    return `solana-rpc:${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return `solana-rpc:${text || "unknown"}`;
  }
}

function validPdaConfig(config) {
  return Boolean(config && typeof config.seed === "string" && typeof config.globalConfig === "string" && typeof config.programId === "string");
}

async function derivePubkeysForBatch(batch, deriveChunkBrokenPda) {
  const pubkeys = [];
  let stepStartedAt = performance.now();
  for (const chunk of batch) {
    pubkeys.push(deriveChunkBrokenPda(chunk.chunkX, chunk.chunkZ)[0]);
    if (performance.now() - stepStartedAt >= ASYNC_STEP_BUDGET_MS) {
      await yieldToFrame();
      stepStartedAt = performance.now();
    }
  }
  return pubkeys;
}

async function decodeBatchSnapshots(batch, infos, chunkSize, expectedMinY, { contextSlot = 0, expectedOwner = "" } = {}) {
  const snapshots = [];
  const errors = [];
  let stepStartedAt = performance.now();
  for (let index = 0; index < batch.length; index += 1) {
    const chunk = batch[index];
    const account = infos[index];
    try {
      if (account && expectedOwner && accountOwnerAddress(account) !== expectedOwner) throw new Error("ChunkBroken account owner does not match the active chunk program.");
      if (account?.executable) throw new Error("ChunkBroken account cannot be executable.");
      const deltas = account?.data?.length
        ? decodeChunkBrokenDeltas(account.data, chunk.chunkX, chunk.chunkZ, chunkSize, expectedMinY)
        : [];
      snapshots.push({
        id: chunk.id ?? chunkId(chunk.chunkX, chunk.chunkZ),
        chunkX: chunk.chunkX,
        chunkZ: chunk.chunkZ,
        expectedChainRevision: chunk.expectedChainRevision,
        contextSlot: Math.max(0, Math.trunc(Number(contextSlot) || 0)),
        deltas,
      });
    } catch (error) {
      errors.push({
        id: chunk.id ?? chunkId(chunk.chunkX, chunk.chunkZ),
        error: readableError(error),
      });
    }
    if (performance.now() - stepStartedAt >= ASYNC_STEP_BUDGET_MS) {
      await yieldToFrame();
      stepStartedAt = performance.now();
    }
  }
  return { snapshots, errors };
}

async function fetchMultipleAccountsWithContext(connection, pubkeys, minContextSlot = 0) {
  if (typeof connection?.getMultipleAccountsInfoAndContext === "function") {
    const config = { commitment: "confirmed" };
    const minimumSlot = Math.max(0, Math.trunc(Number(minContextSlot) || 0));
    if (minimumSlot > 0) config.minContextSlot = minimumSlot;
    const response = await connection.getMultipleAccountsInfoAndContext(pubkeys, config);
    return {
      infos: Array.isArray(response?.value) ? response.value : [],
      contextSlot: Math.max(0, Math.trunc(Number(response?.context?.slot) || 0)),
    };
  }
  const infos = await connection.getMultipleAccountsInfo(pubkeys, "confirmed");
  return { infos, contextSlot: 0 };
}

function accountOwnerAddress(account) {
  return String(account?.owner?.toBase58?.() ?? account?.owner ?? "");
}

function decodeChunkBrokenDeltas(data, chunkX, chunkZ, chunkSize = 16, expectedMinY = null) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < CHUNK_BROKEN_HEADER_LENGTH) throw new Error("Invalid ChunkBroken account header length.");
  if (ascii(bytes, 0, 4) !== CHUNK_BROKEN_MAGIC) throw new Error("Invalid ChunkBroken account magic.");
  if (bytes[4] !== CHUNK_BROKEN_VERSION) throw new Error("Invalid ChunkBroken account version.");
  const count = readUint16LE(bytes, 6);
  const capacity = readUint16LE(bytes, 8);
  const minY = readInt16LE(bytes, 10);
  if (Number.isFinite(Number(expectedMinY)) && minY !== Math.trunc(Number(expectedMinY))) throw new Error("ChunkBroken minY does not match the active world.");
  if (count > capacity || capacity > CHUNK_BROKEN_MAX_CAPACITY || bytes.length !== CHUNK_BROKEN_HEADER_LENGTH + capacity * CHUNK_BROKEN_RECORD_LENGTH) {
    throw new Error("Invalid ChunkBroken account size or capacity.");
  }

  const deltas = [];
  for (let index = 0; index < count; index += 1) {
    const offset = CHUNK_BROKEN_HEADER_LENGTH + index * CHUNK_BROKEN_RECORD_LENGTH;
    const packed = readUint24LE(bytes, offset);
    const localX = packed & 0x0f;
    const localZ = (packed >> 4) & 0x0f;
    const yOffset = (packed >> 8) & 0x01ff;
    deltas.push({
      worldX: chunkX * chunkSize + localX,
      worldY: minY + yOffset,
      worldZ: chunkZ * chunkSize + localZ,
      blockId: BLOCK_ID.air,
      action: 1,
      sequence: index + 1,
    });
  }
  return deltas;
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

function ascii(bytes, offset, length) {
  let text = "";
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(bytes[offset + index] || 0);
  return text;
}

function readUint16LE(bytes, offset) {
  return (bytes[offset] || 0) | ((bytes[offset + 1] || 0) << 8);
}

function readInt16LE(bytes, offset) {
  const value = readUint16LE(bytes, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function readUint24LE(bytes, offset) {
  return (bytes[offset] || 0) | ((bytes[offset + 1] || 0) << 8) | ((bytes[offset + 2] || 0) << 16);
}

function defer(task) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(task()), 0);
  });
}

function yieldToFrame() {
  if (typeof globalThis.scheduler?.yield === "function") return globalThis.scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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
