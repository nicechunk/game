import assert from "node:assert/strict";
import test from "node:test";
import { ChunkManager } from "../../chunk.js/chunk/chunk-manager.js";
import { ensureRenderSections } from "../../chunk.js/chunk/render-sections.js";
import { importHostChunkSync } from "./host-sync-module.mjs";

const { createPlayChainChunkDeltaSync } = await importHostChunkSync();

function records(chunkX, count) {
  return Array.from({ length: count }, (_, index) => ({
    worldX: chunkX * 16 + index % 16,
    worldY: -17 + Math.floor(index / 256),
    worldZ: Math.floor(index / 16) % 16,
    blockId: index % 2 ? 0 : 7,
  }));
}

async function harness(specs) {
  const chunks = new ChunkManager({ worldSeed: "nicechunk-mainnet-001", minY: -32, height: 353, viewDistance: 1, useWorkers: false });
  const starts = [], work = new Map();
  for (const [x, count] of specs) {
    const chunk = chunks.ensureChunk(x, 0, { deferBase: count === 0 }), original = chunk.prepareChainSnapshot.bind(chunk);
    chunk.prepareChainSnapshot = (...args) => {
      starts.push(chunk.id);
      const preparation = original(...args), step = preparation.step.bind(preparation);
      preparation.step = (...options) => {
        const result = step(...options);
        work.set(chunk.id, (work.get(chunk.id) || 0) + result.processed);
        return result;
      };
      return preparation;
    };
  }
  const sync = createPlayChainChunkDeltaSync({
    chunks,
    persistentScopeHint: { cluster: "devnet", programId: "program" },
    persistentCache: {
      async getVerifiedSnapshots() {
        return specs.map(([x, count]) => ({ id: `${x},0`, chunkX: x, chunkZ: 0, contextSlot: 10, deltas: records(x, count) }));
      },
      async putVerifiedSnapshots() {},
    },
  });
  await sync.preloadPersistentCache();
  return { chunks, sync, starts, work };
}

function apply(sync) {
  const result = sync.applyQueuedDeltas({ budgetMs: 100, maxDeltas: 64, maxPreparationEntries: 64 });
  assert.ok(result.preparedEntries <= 64, "fair selection must preserve the frame work limit");
  return result;
}

test("moving to a previously distant small snapshot reprioritizes the actual pending queue", async () => {
  const h = await harness([[0, 4096], [10, 1]]);
  try {
    h.chunks.centerChunkX = 10;
    apply(h.sync);
    assert.equal(h.starts[0], "10,0", "the current near snapshot must precede the old-center large task");
    for (let frame = 0; frame < 64 && h.chunks.chunks.get("10,0").chainDeltas.size === 0; frame++) apply(h.sync);
    assert.equal(h.chunks.chunks.get("10,0").chainDeltas.size, 1);
    assert.equal(h.chunks.chunks.get("0,0").chainDeltas.size, 0, "the large snapshot must not publish a partial state");
  } finally { h.sync.cancelActiveSync(); h.chunks.dispose(); }
});

test("an unfinished near snapshot shares bounded preparation work with a distant large snapshot", async () => {
  const h = await harness([[0, 4096], [10, 4096]]);
  try {
    for (let frame = 0; frame < 80; frame++) apply(h.sync);
    assert.ok(h.work.get("0,0") > 0);
    assert.ok(h.work.get("10,0") > 0, "a large near task cannot monopolize every preparation quantum");
    assert.ok(h.work.get("0,0") > h.work.get("10,0"), "near work retains a larger service share");
    for (const chunk of h.chunks.chunks.values()) assert.equal(chunk.chainDeltas.size, 0, "preparation remains private");
  } finally { h.sync.cancelActiveSync(); h.chunks.dispose(); }
});

test("small peer snapshots finish while large snapshots keep advancing and eventually commit atomically", async () => {
  const h = await harness([[-1, 4096], [1, 1]]);
  try {
    let nearFrame = null, largeFrame = null;
    for (let frame = 0; frame < 2048 && largeFrame === null; frame++) {
      apply(h.sync);
      const small = h.chunks.chunks.get("1,0").chainDeltas.size;
      const large = h.chunks.chunks.get("-1,0").chainDeltas.size;
      assert.ok(large === 0 || large === 4096, "collision must never observe an incomplete large snapshot");
      if (small && nearFrame === null) nearFrame = frame;
      if (large) largeFrame = frame;
    }
    assert.notEqual(nearFrame, null);
    assert.notEqual(largeFrame, null, "fair rotation cannot strand an oversized snapshot");
    assert.ok(nearFrame < 64, "a small equal-distance task must not wait for the complete large snapshot");
    assert.ok(nearFrame < largeFrame);
    assert.equal(h.sync.snapshot().pendingSnapshots, 0);
  } finally { h.sync.cancelActiveSync(); h.chunks.dispose(); }
});

test("hundreds of far snapshots cannot dilute the near tier's service share", async () => {
  const far = Array.from({ length: 400 }, (_, index) => [index + 10, 0]);
  const h = await harness([[0, 289], ...far]);
  try {
    let committedAt = null;
    for (let frame = 0; frame < 96; frame++) {
      apply(h.sync);
      if (h.chunks.chunks.get("0,0").chainDeltas.size === 289) { committedAt = frame; break; }
    }
    assert.notEqual(committedAt, null, "a full far tier cannot stretch near work behind hundreds of empty accounts");
    assert.ok([...h.work].some(([id, work]) => id !== "0,0" && work > 0), "background work must also receive service");
    assert.ok(h.starts.filter((id) => id !== "0,0").length < 64, "near work must commit without waiting for hundreds of distant task starts");
  } finally { h.sync.cancelActiveSync(); h.chunks.dispose(); }
});

test("wide-view background reads pause before queue overflow while a new near correction remains admissible", async () => {
  const chunks = new ChunkManager({ worldSeed: "nicechunk-mainnet-001", minY: -32, height: 353, viewDistance: 1, useWorkers: false });
  chunks.ensureChunk(0, 0);
  for (let x = 10; x < 650; x++) chunks.ensureChunk(x, 0, { deferBase: true });
  let reads = 0;
  const module = {
    isNicechunkChainSyncEnabled: () => true,
    getNicechunkConnection: () => ({ rpcEndpoint: "", getMultipleAccountsInfo() {}, async getMultipleAccountsInfoAndContext(keys) { reads++; return { value: keys.map(() => null), context: { slot: 10 } }; } }),
    deriveGameChunkBrokenPda: (x, z) => [`broken:${x},${z}`],
    deriveGameChunkPlacedPda: (x, z) => [`placed:${x},${z}`],
    getChunkBrokenPdaDerivationConfig: () => ({ seed: "broken", placedSeed: "placed", globalConfig: "global", programId: "program" }),
  };
  const sync = createPlayChainChunkDeltaSync({ chunks, loadChainModule: async () => module, persistentCache: { async getVerifiedSnapshots() { return []; }, async putVerifiedSnapshots() {} } });
  try {
    for (let round = 0; round < 12; round++) await sync.syncLoadedChunks();
    assert.ok(sync.snapshot().pendingSnapshots <= 448, "background admission must preserve room for near corrections");
    const pausedReads = reads;
    for (let round = 0; round < 3; round++) await sync.syncLoadedChunks();
    assert.equal(reads, pausedReads, "undrained far accounts must not be repeatedly fetched and evicted");
    assert.equal(sync.snapshot().verifiedChunks, 0, "deferred reads and queued snapshots do not advance freshness");
    chunks.ensureChunk(1, 0);
    await sync.syncLoadedChunks();
    assert.equal(reads, pausedReads + 1, "the reserved capacity must admit a new near account pair");
    assert.equal(sync.snapshot().pendingSnapshotsByTier[0], 2);
  } finally { sync.cancelActiveSync(); chunks.dispose(); }
});

test("continuing neighbor edits cannot restart preparation of an unchanged local authority snapshot forever", async () => {
  const h = await harness([[0, 4096], [1, 0]]);
  try {
    const target = h.chunks.chunks.get("0,0"), neighbor = h.chunks.chunks.get("1,0");
    ensureRenderSections(target);
    ensureRenderSections(neighbor);
    const beforeVersion = target.version;
    let finishedAt = null;
    for (let frame = 0; frame < 2048; frame++) {
      if (frame % 8 === 0) h.chunks.applyChainDelta([{ worldX: 16, worldY: -10, worldZ: 9, blockId: frame % 16 === 0 ? 3 : 0 }]);
      apply(h.sync);
      assert.ok(target.chainDeltas.size === 0 || target.chainDeltas.size === 4096, "a neighbor edit cannot expose a partial local authority snapshot");
      if (target.chainDeltas.size === 4096) { finishedAt = frame; break; }
    }
    assert.ok(target.version > beforeVersion, "the fixture must exercise repeated real neighbor render invalidation");
    assert.notEqual(finishedAt, null, "render-only invalidation must not discard unchanged authority preparation");
    assert.equal(h.starts.filter((id) => id === "0,0").length, 1, "the target's own voxel inputs did not change");
    assert.equal(target.pendingDeltas.size, 0);
    assert.equal(target.remoteDeltas.size, 0);
    assert.equal(target.confirmedDeltaProtection.size, 0);
    assert.equal(target.getFinalBlock(15, -13, 9), 0);
  } finally { h.sync.cancelActiveSync(); h.chunks.dispose(); }
});
