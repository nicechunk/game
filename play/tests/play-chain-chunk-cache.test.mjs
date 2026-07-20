import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalizeChunkSnapshot,
  createPlayChainChunkCache,
  sameCanonicalChunkSnapshot,
} from "../play-chain-chunk-cache.js";

test("early cache scope stays aligned with the public chain configuration", async () => {
  const [mainnet, source] = await Promise.all([
    readFile(new URL("../../public/mainnet.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../play-chain-chunk-deltas.js", import.meta.url), "utf8"),
  ]);
  const hint = source.match(/DEFAULT_CHAIN_CHUNK_CACHE_SCOPE_HINT\s*=\s*Object\.freeze\(\{\s*cluster:\s*"([^"]+)",\s*programId:\s*"([^"]+)"/s);
  assert.ok(hint, "static cache scope hint should remain explicit and auditable");
  assert.equal(hint[1], mainnet.chain.cluster);
  assert.equal(hint[2], mainnet.chain.programs.chunk);
});

test("chunk snapshots canonicalize placement and destruction deltas deterministically", () => {
  const canonical = canonicalizeChunkSnapshot({
    chunkX: -2,
    chunkZ: 3,
    contextSlot: 91,
    deltas: [
      { worldX: -29, worldY: 80, worldZ: 51, blockId: 7 },
      { worldX: -31, worldY: 79, worldZ: 49, blockId: 0 },
      { worldX: -29, worldY: 80, worldZ: 51, blockId: 42 },
    ],
  });

  assert.deepEqual(canonical.packedDeltas, [1, 79, 1, 0, 3, 80, 3, 42]);
  assert.deepEqual(canonical.deltas.map((delta) => [delta.worldX, delta.worldY, delta.worldZ, delta.blockId]), [
    [-31, 79, 49, 0],
    [-29, 80, 51, 42],
  ]);

  const reordered = canonicalizeChunkSnapshot({
    chunkX: -2,
    chunkZ: 3,
    deltas: [...canonical.deltas].reverse(),
  });
  assert.equal(sameCanonicalChunkSnapshot(canonical, reordered), true);

  const changed = canonicalizeChunkSnapshot({
    chunkX: -2,
    chunkZ: 3,
    deltas: canonical.deltas.map((delta, index) => index ? { ...delta, blockId: 41 } : delta),
  });
  assert.equal(sameCanonicalChunkSnapshot(canonical, changed), false);
});

test("verified chunk cache survives new instances and isolates namespaces", async () => {
  const memoryStore = new Map();
  let scope = "devnet:program-a:world-v4";
  const options = {
    getScope: () => scope,
    indexedDBFactory: null,
    memoryStore,
  };
  const writer = createPlayChainChunkCache(options);
  await writer.putVerifiedSnapshots([
    {
      id: "4,-7",
      chunkX: 4,
      chunkZ: -7,
      contextSlot: 1234,
      deltas: [{ worldX: 65, worldY: 88, worldZ: -110, blockId: 0 }],
    },
    { id: "5,-7", chunkX: 5, chunkZ: -7, contextSlot: 1234, deltas: [] },
  ]);

  const reader = createPlayChainChunkCache(options);
  const hits = await reader.getVerifiedSnapshots([
    { id: "4,-7", chunkX: 4, chunkZ: -7 },
    { id: "5,-7", chunkX: 5, chunkZ: -7 },
  ]);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].contextSlot, 1234);
  assert.equal(hits[0].deltas[0].blockId, 0);
  assert.deepEqual(hits[1].deltas, []);

  scope = "devnet:program-b:world-v4";
  assert.deepEqual(await reader.getVerifiedSnapshots([{ id: "4,-7", chunkX: 4, chunkZ: -7 }]), []);
});

test("corrupt cache entries are rejected and removed", async () => {
  const memoryStore = new Map();
  const cache = createPlayChainChunkCache({
    getScope: () => "corruption-test",
    indexedDBFactory: null,
    memoryStore,
  });
  const target = { id: "0,0", chunkX: 0, chunkZ: 0 };
  await cache.putVerifiedSnapshots([{ ...target, contextSlot: 7, deltas: [{ worldX: 1, worldY: 70, worldZ: 2, blockId: 0 }] }]);
  const record = [...memoryStore.values()][0];
  record.fingerprint = "corrupt";

  assert.deepEqual(await cache.getVerifiedSnapshots([target]), []);
  assert.equal(memoryStore.size, 0);
});

test("cache pruning keeps the newest records within record and delta limits", async () => {
  const memoryStore = new Map();
  let timestamp = 100_000;
  const cache = createPlayChainChunkCache({
    getScope: () => "prune-test",
    indexedDBFactory: null,
    memoryStore,
    maxRecords: 2,
    maxDeltas: 2,
    now: () => timestamp,
  });
  for (let chunkX = 0; chunkX < 3; chunkX += 1) {
    timestamp += 1;
    await cache.putVerifiedSnapshots([{
      id: `${chunkX},0`,
      chunkX,
      chunkZ: 0,
      contextSlot: timestamp,
      deltas: [{ worldX: chunkX * 16, worldY: 70, worldZ: 0, blockId: 0 }],
    }]);
  }

  assert.equal(await cache.prune(), 1);
  assert.equal(memoryStore.size, 2);
  assert.deepEqual(
    (await cache.getVerifiedSnapshots([
      { id: "0,0", chunkX: 0, chunkZ: 0 },
      { id: "1,0", chunkX: 1, chunkZ: 0 },
      { id: "2,0", chunkX: 2, chunkZ: 0 },
    ])).map((snapshot) => snapshot.id),
    ["1,0", "2,0"],
  );
});
