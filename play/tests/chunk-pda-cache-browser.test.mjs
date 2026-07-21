import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";

test("persistent chunk cache renders first and unchanged PDA snapshots avoid replacement", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route(`${origin}/play/tests/chunk-pda-cache`, (route) => route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body></body></html>",
    }));
    await page.goto(`${origin}/play/tests/chunk-pda-cache`, { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(async () => {
      const [{ createPlayChainChunkDeltaSync }, { createPlayChainChunkCache }] = await Promise.all([
        import("/play/play-chain-chunk-deltas.js"),
        import("/play/play-chain-chunk-cache.js"),
      ]);
      const delta = { worldX: 2, worldY: 80, worldZ: 3, blockId: 0 };
      let rpcAccount = chunkBrokenAccount(delta);
      let rpcSlot = 101;
      const persistentWrites = [];
      let finishPersistentClear;
      const persistentClear = new Promise((resolve) => { finishPersistentClear = resolve; });
      const cache = {
        async getVerifiedSnapshots(targets) {
          return targets.some((target) => target.id === "0,0")
            ? [{ id: "0,0", chunkX: 0, chunkZ: 0, contextSlot: 100, deltas: [delta] }]
            : [];
        },
        async putVerifiedSnapshots(snapshots) {
          persistentWrites.push(...structuredClone(snapshots));
          return snapshots.length;
        },
        clearScope() {
          return persistentClear;
        },
        snapshot() {
          return { test: true };
        },
      };
      const chunk = {
        id: "0,0",
        chunkX: 0,
        chunkZ: 0,
        chainRevision: 0,
        chainSnapshotToken: 0,
        chainSnapshotSlot: 0,
        chainDeltas: new Map(),
      };
      const calls = { replace: 0, acknowledge: 0, changed: 0 };
      const chunks = {
        chunks: new Map([[chunk.id, chunk]]),
        chunkSize: 16,
        minY: -32,
        height: 352,
        worldSeed: "nicechunk-mainnet-001",
        generationVersion: 4,
        resourceRuleVersion: 2,
        centerChunkX: 0,
        centerChunkZ: 0,
        replaceChainDeltasForChunk(id, deltas, options = {}) {
          calls.replace += 1;
          if (id !== chunk.id || options.expectedChainRevision !== chunk.chainRevision) {
            return { applied: false, reason: "stale-chain-revision", changed: false };
          }
          const before = JSON.stringify([...chunk.chainDeltas.values()].map(compactDelta));
          const after = JSON.stringify(deltas.map(compactDelta));
          chunk.chainDeltas = new Map(deltas.map((item) => [`${item.worldX}:${item.worldY}:${item.worldZ}`, { ...item }]));
          chunk.chainRevision += 1;
          chunk.chainSnapshotToken = options.snapshotToken;
          chunk.chainSnapshotSlot = options.snapshotSlot;
          return {
            applied: true,
            changed: before !== after,
            boundaryMask: 0,
            retainedUnobserved: 0,
            effectiveDeltas: [...chunk.chainDeltas.values()],
          };
        },
        acknowledgeChainSnapshotForChunk(id, options = {}) {
          calls.acknowledge += 1;
          if (id !== chunk.id || options.snapshotToken !== chunk.chainSnapshotToken || options.snapshotSlot < chunk.chainSnapshotSlot) return false;
          chunk.chainSnapshotSlot = options.snapshotSlot;
          return true;
        },
        resetChainSnapshotAuthority() {
          chunk.chainSnapshotToken = 0;
          chunk.chainSnapshotSlot = 0;
        },
        clearChainDeltas() {},
      };
      const connection = {
        rpcEndpoint: "",
        async getMultipleAccountsInfo() {
          return [rpcAccount];
        },
        async getMultipleAccountsInfoAndContext() {
          return { value: [rpcAccount], context: { slot: rpcSlot } };
        },
      };
      const chainModule = {
        isNicechunkChainSyncEnabled: () => true,
        getNicechunkConnection: () => connection,
        deriveGameChunkBrokenPda: () => ["test-pda"],
        getChunkBrokenPdaDerivationConfig: () => ({
          seed: "chunk-broken",
          globalConfig: "GlobalConfig111",
          programId: "ChunkProgram111",
        }),
      };
      let chainModuleLoads = 0;
      const sync = createPlayChainChunkDeltaSync({
        chunks,
        persistentCache: cache,
        persistentScopeHint: { cluster: "devnet", programId: "ChunkProgram111" },
        loadChainModule: async () => {
          chainModuleLoads += 1;
          return chainModule;
        },
        onChanged: () => { calls.changed += 1; },
      });

      const warm = await sync.preloadPersistentCache();
      const afterWarm = {
        blockId: [...chunk.chainDeltas.values()][0]?.blockId,
        replaceCalls: calls.replace,
        changedCalls: calls.changed,
        cacheHits: warm.cacheHits,
        chainModuleLoads,
      };

      const sameSync = await sync.syncLoadedChunks({ force: true, reason: "test-same" });
      const sameApply = sync.applyQueuedDeltas({ budgetMs: 10, maxDeltas: 100 });
      const afterSame = {
        replaceCalls: calls.replace,
        acknowledgeCalls: calls.acknowledge,
        changedCalls: calls.changed,
        pendingSnapshots: sameApply.pendingSnapshots,
        unchangedSnapshots: sync.snapshot().unchangedSnapshots,
        contextSlot: sameSync.contextSlot,
      };

      rpcAccount = null;
      rpcSlot = 102;
      await sync.syncLoadedChunks({ force: true, reason: "test-delete" });
      const deleteApply = sync.applyQueuedDeltas({ budgetMs: 10, maxDeltas: 100 });
      await new Promise((resolve) => setTimeout(resolve, 80));
      const afterDelete = {
        replaceCalls: calls.replace,
        changedCalls: calls.changed,
        deltaCount: chunk.chainDeltas.size,
        changedChunks: deleteApply.changedChunks,
        persistedDeltaCount: persistentWrites.at(-1)?.deltas?.length,
      };

      let cacheClearCompleted = false;
      const clearing = sync.clearLocalCache({ clearRenderDeltas: true, clearPersistent: true }).then(() => {
        cacheClearCompleted = true;
      });
      await Promise.resolve();
      const clearWait = { beforePersistentDelete: cacheClearCompleted };
      finishPersistentClear();
      await clearing;
      clearWait.afterPersistentDelete = cacheClearCompleted;

      const indexedScope = `browser-cache-${Date.now()}-${Math.random()}`;
      const indexedWriter = createPlayChainChunkCache({ getScope: () => indexedScope });
      await indexedWriter.putVerifiedSnapshots([{ id: "8,9", chunkX: 8, chunkZ: 9, contextSlot: 444, deltas: [
        { worldX: 129, worldY: 72, worldZ: 146, blockId: 33 },
      ] }]);
      const indexedReader = createPlayChainChunkCache({ getScope: () => indexedScope });
      const indexedHits = await indexedReader.getVerifiedSnapshots([{ id: "8,9", chunkX: 8, chunkZ: 9 }]);
      await indexedReader.clearScope();

      return {
        afterWarm,
        afterSame,
        afterDelete,
        clearWait,
        indexedDb: {
          hits: indexedHits.length,
          blockId: indexedHits[0]?.deltas?.[0]?.blockId,
          contextSlot: indexedHits[0]?.contextSlot,
        },
      };

      function compactDelta(item) {
        return [item.worldX, item.worldY, item.worldZ, item.blockId];
      }

      function chunkBrokenAccount(item) {
        const bytes = new Uint8Array(19);
        bytes.set([78, 67, 66, 75], 0);
        bytes[4] = 1;
        bytes[6] = 1;
        bytes[8] = 1;
        bytes[10] = 0xe0;
        bytes[11] = 0xff;
        const localX = item.worldX & 0x0f;
        const localZ = item.worldZ & 0x0f;
        const yOffset = item.worldY + 32;
        const packed = localX | (localZ << 4) | (yOffset << 8);
        bytes[16] = packed & 0xff;
        bytes[17] = (packed >> 8) & 0xff;
        bytes[18] = (packed >> 16) & 0xff;
        return { data: bytes, owner: "ChunkProgram111", executable: false };
      }
    });

    assert.deepEqual(result.afterWarm, {
      blockId: 0,
      replaceCalls: 1,
      changedCalls: 1,
      cacheHits: 1,
      chainModuleLoads: 0,
    });
    assert.equal(result.afterSame.replaceCalls, 1);
    assert.equal(result.afterSame.acknowledgeCalls, 1);
    assert.equal(result.afterSame.changedCalls, 1);
    assert.equal(result.afterSame.pendingSnapshots, 0);
    assert.equal(result.afterSame.unchangedSnapshots, 1);
    assert.equal(result.afterSame.contextSlot, 101);
    assert.equal(result.afterDelete.replaceCalls, 2);
    assert.equal(result.afterDelete.changedCalls, 2);
    assert.equal(result.afterDelete.deltaCount, 0);
    assert.equal(result.afterDelete.changedChunks, 1);
    assert.equal(result.afterDelete.persistedDeltaCount, 0);
    assert.deepEqual(result.clearWait, { beforePersistentDelete: false, afterPersistentDelete: true });
    assert.deepEqual(result.indexedDb, { hits: 1, blockId: 33, contextSlot: 444 });
  } finally {
    await browser.close();
  }
});
