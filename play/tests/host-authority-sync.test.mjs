import assert from "node:assert/strict";
import test from "node:test";
import { ChunkManager } from "../../chunk.js/chunk/chunk-manager.js";
import { canonicalizeChunkSnapshot, prepareCanonicalChunkSnapshot } from "../play-chain-chunk-cache.js";
import { runChunkBatchPool } from "../play-chain-batch-scheduler.js";
import { importHostChunkSync } from "./host-sync-module.mjs";
const { createPlayChainChunkDeltaSync } = await importHostChunkSync();

function manager(coords = [[0, 0]]) {
  const chunks = new ChunkManager({ worldSeed: "nicechunk-mainnet-001", minY: -32, height: 353, viewDistance: 1, useWorkers: false });
  for (const [x, z] of coords) chunks.ensureChunk(x, z);
  return chunks;
}
function account(deltas, placed = false) {
  const count = deltas.length, capacity = Math.max(1, count), stride = placed ? 9 : 3;
  const data = new Uint8Array(16 + capacity * stride), view = new DataView(data.buffer);
  data.set(new TextEncoder().encode(placed ? "NCPB" : "NCBK"));
  data[4] = 1; view.setUint16(6, count, true); view.setUint16(8, capacity, true); view.setInt16(10, -32, true);
  deltas.forEach((delta, index) => {
    const packed = (delta.worldX & 15) | ((delta.worldZ & 15) << 4) | ((delta.worldY + 32) << 8), offset = 16 + index * stride;
    data[offset] = packed & 255; data[offset + 1] = packed >> 8 & 255; data[offset + 2] = packed >> 16 & 255;
    if (placed) { view.setUint16(offset + 3, delta.blockId, true); view.setUint32(offset + 5, 1, true); }
  });
  return { data, owner: "program", executable: false };
}
function mockModule(read) {
  return {
    isNicechunkChainSyncEnabled: () => true,
    getNicechunkConnection: () => ({ rpcEndpoint: "", getMultipleAccountsInfo() {}, getMultipleAccountsInfoAndContext: read }),
    deriveGameChunkBrokenPda: (x, z) => [`broken:${x},${z}`],
    deriveGameChunkPlacedPda: (x, z) => [`placed:${x},${z}`],
    getChunkBrokenPdaDerivationConfig: () => ({ seed: "broken", placedSeed: "placed", globalConfig: "global", programId: "program" }),
  };
}
const cache = () => ({ async getVerifiedSnapshots() { return []; }, async putVerifiedSnapshots() {} });
function drain(sync, max = 4096) {
  const slices = [];
  while (sync.snapshot().pendingSnapshots && slices.length < max) slices.push(sync.applyQueuedDeltas({ budgetMs: 1, maxDeltas: 64 }));
  assert.equal(sync.snapshot().pendingSnapshots, 0, "an oversized complete snapshot must eventually commit");
  return slices;
}

test("two clients recover missed dig/place events within near TTL and reconnect invalidates freshness", async () => {
  let time = 1_000, slot = 10, reads = 0;
  const delta = { worldX: 1, worldY: -17, worldZ: 2, blockId: 7 };
  let pairs = [null, null];
  const module = mockModule(async () => { reads++; return { value: pairs, context: { slot } }; });
  const clients = [manager(), manager()].map((chunks) => ({ chunks, sync: createPlayChainChunkDeltaSync({ chunks, loadChainModule: async () => module, persistentCache: cache(), now: () => time }) }));
  for (const { sync } of clients) { await sync.syncLoadedChunks(); drain(sync); }
  assert.equal(reads, 2);
  pairs = [account([{ ...delta, blockId: 0 }]), null]; slot++;
  for (const { sync } of clients) await sync.syncLoadedChunks();
  assert.equal(reads, 2, "ordinary polling and cache hits do not amplify reads before TTL");
  time += 15_001;
  for (const { sync, chunks } of clients) { await sync.syncLoadedChunks(); drain(sync); assert.equal(chunks.chunks.get("0,0").chainDeltas.size, 1); }
  assert.equal(reads, 4);
  pairs = [account([{ ...delta, blockId: 0 }]), account([delta], true)]; slot++;
  clients[1].sync.invalidateFreshness({ reason: "guardian-connect" });
  await clients[1].sync.syncLoadedChunks(); drain(clients[1].sync);
  assert.equal(clients[1].chunks.getBlockAtWorld(1, -17, 2), 7);
  time += 15_001;
  await clients[0].sync.syncLoadedChunks(); drain(clients[0].sync);
  assert.equal(clients[0].chunks.getBlockAtWorld(1, -17, 2), 7);
  for (const { sync } of clients) assert.equal(sync.snapshot().verifiedChunks, 1);
});

test("persistent restores enter the same budgeted queue and never advance network freshness", async () => {
  const chunks = manager();
  const deltas = Array.from({ length: 4096 }, (_, index) => ({ worldX: index % 16, worldY: -32 + Math.floor(index / 256), worldZ: Math.floor(index / 16) % 16, blockId: index % 2 ? 0 : 7 }));
  const persistentCache = { async getVerifiedSnapshots() { return [{ chunkX: 0, chunkZ: 0, id: "0,0", contextSlot: 10, deltas }]; }, async putVerifiedSnapshots() {} };
  const sync = createPlayChainChunkDeltaSync({ chunks, persistentCache, persistentScopeHint: { cluster: "devnet", programId: "program" } });
  const result = await sync.preloadPersistentCache();
  assert.equal(result.appliedSnapshots, 0);
  assert.equal(chunks.chunks.get("0,0").chainDeltas.size, 0);
  const first = sync.applyQueuedDeltas({ budgetMs: 1, maxDeltas: 64, maxPreparationEntries: 64 });
  assert.ok(first.preparedEntries <= 64);
  assert.equal(chunks.chunks.get("0,0").chainDeltas.size, 0, "collision cannot see half a snapshot");
  const slices = drain(sync);
  assert.ok(slices.length > 1);
  assert.equal(chunks.chunks.get("0,0").chainDeltas.size, 4096);
  assert.equal(sync.snapshot().verifiedChunks, 0);
});

test("real batch processing is progressive, keeps each pair in its own true RPC context, and limits concurrency", async () => {
  const chunks = manager([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]);
  let active = 0, peak = 0, releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  const module = mockModule(async (keys) => {
    active++; peak = Math.max(peak, active);
    assert.equal(keys.length, 2, "broken and placed remain one atomic getMultipleAccounts pair");
    assert.equal(keys[0].split(":")[1], keys[1].split(":")[1]);
    const x = Number(keys[0].split(":")[1].split(",")[0]);
    if (x === 3) await slow;
    active--;
    return { value: [null, null], context: { slot: 100 + x } };
  });
  const sync = createPlayChainChunkDeltaSync({ chunks, batchSize: 1, persistentCache: cache(), loadChainModule: async () => module });
  const all = sync.syncLoadedChunks();
  for (let attempt = 0; attempt < 100 && sync.snapshot().pendingSnapshots < 5; attempt++) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.ok(sync.snapshot().pendingSnapshots >= 4, "near completed batches arrive before the distant slow batch");
  drain(sync);
  assert.equal(chunks.chunks.get("0,0").chainSnapshotSlot, 100);
  assert.equal(chunks.chunks.get("4,0").chainSnapshotSlot, 104, "batch watermarks are not replaced by one round maximum");
  assert.equal(chunks.chunks.get("3,0").chainSnapshotSlot, null);
  releaseSlow(); await all; drain(sync);
  assert.equal(chunks.chunks.get("3,0").chainSnapshotSlot, 103);
  assert.ok(peak <= 4);
});

test("RPC epoch change rejects late results and a failed authority read does not mark a chunk fresh", async () => {
  const chunks = manager();
  let release, fail = false;
  const waiting = new Promise((resolve) => { release = resolve; });
  const module = mockModule(async () => { await waiting; if (fail) throw new Error("offline"); return { value: [null, null], context: { slot: 10 } }; });
  const sync = createPlayChainChunkDeltaSync({ chunks, persistentCache: cache(), loadChainModule: async () => module });
  const fetching = sync.syncLoadedChunks();
  await new Promise((resolve) => setTimeout(resolve, 5));
  sync.clearLocalCache(); release();
  assert.equal((await fetching).reason, "sync-superseded");
  assert.equal(sync.snapshot().pendingSnapshots, 0);
  assert.equal(sync.snapshot().verifiedChunks, 0);
  fail = true;
  assert.equal((await sync.syncLoadedChunks()).ok, false);
  assert.equal(sync.snapshot().verifiedChunks, 0);
});

test("staged normalization stays deterministic without a synchronous full-array sort", () => {
  const deltas = Array.from({ length: 8192 }, (_, index) => ({ worldX: index % 16, worldY: -32 + Math.floor(index / 256), worldZ: Math.floor(index / 16) % 16, blockId: index % 5 }));
  const input = { chunkX: 0, chunkZ: 0, contextSlot: null, deltas: [...deltas].reverse() };
  const staged = prepareCanonicalChunkSnapshot(input);
  let steps = 0;
  while (!staged.done) { assert.ok(staged.step({ maxEntries: 64, budgetMs: Infinity }).processed <= 64); steps++; }
  assert.ok(steps > 128);
  assert.deepEqual(staged.result, canonicalizeChunkSnapshot({ ...input, deltas }));
  assert.equal(staged.result.contextSlot, null);
});

test("a cancelled work-conserving pool stops launching queued batches", async () => {
  const controller = new AbortController(); let started = 0, delivered = 0;
  const result = await runChunkBatchPool(Array.from({ length: 20 }, (_, index) => index), { concurrency: 4, signal: controller.signal, fetchBatch: async () => { started++; await new Promise((resolve) => setTimeout(resolve, 1)); return { ok: true }; }, onResult: () => { delivered++; controller.abort(); } });
  assert.equal(started, 4); assert.equal(delivered, 1); assert.equal(result.cancelled, true);
});
