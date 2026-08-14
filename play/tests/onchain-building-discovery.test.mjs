import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildingMatchesFoundation,
  cachedBuildingMatchesFoundation,
  createPlayChainBuildingSync,
} from "../play-chain-buildings.js";
import { createPlayChainFoundationSync } from "../play-chain-foundations.js";

test("foundation discovery reads the complete view ring from on-chain chunk indexes", async () => {
  let indexed = [];
  let queried = [];
  const land = foundation({ foundationId: "7", activeRevision: 0, contentHash: undefined });
  const sync = createPlayChainFoundationSync({
    index: spatialIndexStub((records) => { indexed = records; }),
    getPlayerPosition: () => [0, 0, 0],
    viewDistance: 1,
    preloadMargin: 0,
    chunkSize: 16,
    loadChainModule: async () => ({
      loadFoundationsForChunks: async (chunks) => {
        queried = chunks;
        return [land];
      },
    }),
  });

  const result = await sync.refresh({ force: true, now: 1_000 });
  assert.equal(result.ok, true);
  assert.equal(result.scannedChunks, 25);
  assert.deepEqual(queried[0], { chunkX: -2, chunkZ: -2 });
  assert.deepEqual(queried.at(-1), { chunkX: 2, chunkZ: 2 });
  assert.deepEqual(indexed.map((record) => record.foundationId), ["7"]);
  assert.equal(sync.snapshot().mode, "on-chain-chunk-index");
});

test("foundation discovery refreshes on Chunk crossings but not steady frames", async () => {
  let player = [1, 0, 1];
  let loads = 0;
  const sync = createPlayChainFoundationSync({
    index: spatialIndexStub(),
    getPlayerPosition: () => player,
    viewDistance: 1,
    preloadMargin: 0,
    loadChainModule: async () => ({
      loadFoundationsForChunks: async () => {
        loads += 1;
        return [];
      },
    }),
  });

  await sync.refresh({ force: true, now: 1_000 });
  assert.equal(sync.updateForFrame(1_100), null);
  assert.equal(loads, 1);
  player = [17, 0, 1];
  await sync.updateForFrame(1_101);
  assert.equal(loads, 2);
});

test("nearby manifest hashes override hashless owner scans for the same land", async () => {
  const hash = "31".repeat(32);
  let indexed = [];
  const nearby = foundation({ foundationId: "8", contentHash: hash });
  const owned = { ...nearby };
  delete owned.contentHash;
  const sync = createPlayChainFoundationSync({
    index: spatialIndexStub((records) => { indexed = records; }),
    getWalletAddress: () => "owner",
    loadChainModule: async () => ({
      loadFoundationsForChunks: async () => [nearby],
      loadOwnedFoundations: async () => [owned],
    }),
  });

  const result = await sync.refresh({ force: true });
  assert.equal(result.ok, true);
  assert.equal(indexed.length, 1);
  assert.equal(indexed[0].contentHash, hash);
});

test("a transient FoundationChunk failure retains the last verified land set", async () => {
  let fail = false;
  let indexed = [];
  const sync = createPlayChainFoundationSync({
    index: spatialIndexStub((records) => { indexed = records; }),
    loadChainModule: async () => ({
      loadFoundationsForChunks: async () => {
        if (fail) throw new Error("temporary RPC failure");
        return [foundation({ foundationId: "9", activeRevision: 0, contentHash: undefined })];
      },
    }),
  });

  await sync.refresh({ force: true, now: 1_000 });
  fail = true;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await sync.refresh({ force: true, now: 2_000 });
    assert.equal(result.ok, false);
    assert.equal(result.partial, true);
    assert.equal(result.retryAt, undefined);
    assert.equal(sync.snapshot().retryAfterAt, 7_000);
    assert.equal(indexed.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test("land creation needs no Guardian coverage or building announcement", async () => {
  let indexed = [];
  const sync = createPlayChainFoundationSync({
    index: spatialIndexStub((records) => { indexed = records; }),
    getWalletAddress: () => "owner",
    loadChainModule: async () => ({
      createFoundationOnChain: async (payload) => ({
        submitted: true,
        signature: "land-signature",
        foundation: foundation({ ...payload, owner: "owner", foundationId: "10", activeRevision: 0, contentHash: undefined }),
      }),
    }),
  });
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  try {
    const result = await sync.create({ minX: 0, minZ: 0, surfaceY: 100, width: 16, depth: 16 });
    assert.equal(result.submitted, true);
    assert.equal(result.indexedOnChain, true);
    assert.equal(result.guardianIndexed, undefined);
    assert.equal(indexed.length, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.equal(Object.hasOwn(sync, "resize"), false);
});

test("building identity requires the complete on-chain SHA-256 hash", () => {
  const hash = "ab".repeat(32);
  const land = foundation({ foundationId: "11", contentHash: hash });
  const building = chainBuilding({ foundationId: "11", contentHash: hash });
  assert.equal(buildingMatchesFoundation(building, land), true);
  assert.equal(buildingMatchesFoundation({ ...building, contentHash: `${hash.slice(0, 62)}ff` }, land), false);
  assert.equal(buildingMatchesFoundation({ ...building, revision: 2 }, land), false);
  assert.equal(buildingMatchesFoundation(building, { ...land, contentHash: hash.slice(0, 32) }), false);
});

test("persistent building cache bytes are rehashed against the on-chain manifest", async () => {
  const payload = Buffer.from([1, 2, 3, 4, 5]);
  const hash = createHash("sha256").update(payload).digest("hex");
  const land = foundation({ foundationId: "12", contentHash: hash });
  const building = chainBuilding({
    foundationId: "12",
    contentHash: hash,
    code: `NCM3:${payload.toString("base64url")}`,
  });
  assert.equal(await cachedBuildingMatchesFoundation(building, land), true);
  assert.equal(await cachedBuildingMatchesFoundation({
    ...building,
    code: `NCM3:${Buffer.from([9, 9, 9]).toString("base64url")}`,
  }, land), false);
});

test("building refresh reuses a byte-verified cache and reapplies moved land", async () => {
  const payload = Buffer.from("cached-building");
  const hash = createHash("sha256").update(payload).digest("hex");
  let land = foundation({ foundationId: "13", contentHash: hash });
  const building = chainBuilding({
    foundationId: "13",
    contentHash: hash,
    code: `NCM3:${payload.toString("base64url")}`,
  });
  const applied = [];
  const sync = createPlayChainBuildingSync({
    cache: { getBuildings: async () => [building] },
    getFoundations: () => [land],
    getFoundationsNear: () => [land],
    applyBuildings: async (records) => applied.push(records),
    loadChainModule: async () => {
      throw new Error("verified cache must not load RPC");
    },
  });

  assert.equal((await sync.refresh({ force: true, now: 1_000 })).applied, true);
  assert.equal((await sync.refresh({ force: true, now: 1_001 })).applied, false);
  land = { ...land, minX: 32, maxX: 47 };
  assert.equal((await sync.refresh({ force: true, now: 1_002 })).applied, true);
  assert.equal(applied.length, 2);
  assert.equal(sync.snapshot().mode, "on-chain-manifest-view-cache");
});

test("tampered building cache falls back to chain PDA loading", async () => {
  const payload = Buffer.from("authoritative-building");
  const hash = createHash("sha256").update(payload).digest("hex");
  const land = foundation({ foundationId: "14", contentHash: hash });
  const valid = chainBuilding({
    foundationId: "14",
    contentHash: hash,
    code: `NCM3:${payload.toString("base64url")}`,
  });
  let loads = 0;
  let writes = 0;
  const sync = createPlayChainBuildingSync({
    cache: {
      getBuildings: async () => [{ ...valid, code: "NCM3:CQkJ" }],
      putVerifiedBuildings: async () => { writes += 1; },
    },
    getFoundations: () => [land],
    getFoundationsNear: () => [land],
    loadChainModule: async () => ({
      loadBuildingsForFoundations: async () => {
        loads += 1;
        return [valid];
      },
    }),
  });

  const result = await sync.refresh({ force: true });
  assert.equal(result.ok, true);
  assert.equal(loads, 1);
  assert.equal(writes, 1);
});

test("building sync hydrates only land intersecting the preload ring", async () => {
  const nearHash = "41".repeat(32);
  const farHash = "42".repeat(32);
  const near = foundation({ foundationId: "15", contentHash: nearHash, minX: 0, minZ: 0 });
  const far = foundation({ foundationId: "16", contentHash: farHash, minX: 2_000, minZ: 2_000 });
  let player = [0, 0, 0];
  const loads = [];
  const sync = createPlayChainBuildingSync({
    cache: { getBuildings: async (records) => records.map(() => null), putVerifiedBuildings: async () => [] },
    getFoundations: () => [near, far],
    getFoundationsNear: (worldX, worldZ, radius) => [near, far].filter((record) => (
      record.minX <= worldX + radius
      && record.maxX >= worldX - radius
      && record.minZ <= worldZ + radius
      && record.maxZ >= worldZ - radius
    )),
    getPlayerPosition: () => player,
    loadChainModule: async () => ({
      loadBuildingsForFoundations: async (records) => {
        loads.push(records.map((record) => record.foundationId));
        return records.map((record) => chainBuilding({
          foundationId: record.foundationId,
          contentHash: record.contentHash,
        }));
      },
    }),
  });

  await sync.refresh({ force: true });
  assert.deepEqual(loads, [["15"]]);
  player = [2_000, 0, 2_000];
  await sync.updateForFrame(performance.now());
  assert.deepEqual(loads, [["15"], ["16"]]);
});

test("building finalization succeeds independently of Guardian availability", async () => {
  const hash = "51".repeat(32);
  const land = foundation({ foundationId: "17", contentHash: "50".repeat(32) });
  let foundationRefreshes = 0;
  const sync = createPlayChainBuildingSync({
    cache: null,
    getWalletAddress: () => "owner",
    getFoundations: () => [land],
    refreshFoundations: async () => {
      foundationRefreshes += 1;
      return { ok: true };
    },
    loadChainModule: async () => ({
      createBuildingOnChain: async () => ({
        submitted: true,
        signature: "building-signature",
        building: chainBuilding({ foundationId: "17", contentHash: hash }),
      }),
    }),
  });
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  try {
    const result = await sync.create({ foundationId: "17", code: "NCM3:AQ" });
    assert.equal(result.submitted, true);
    assert.equal(result.indexedOnChain, true);
    assert.equal(result.guardianIndexed, undefined);
    assert.equal(result.building.contentHash, hash);
    assert.equal(foundationRefreshes, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("building sync backs off after RPC failure and retains the verified render set", async () => {
  const payload = Buffer.from("backoff-building");
  const hash = createHash("sha256").update(payload).digest("hex");
  const land = foundation({ foundationId: "18", contentHash: hash });
  const building = chainBuilding({
    foundationId: "18",
    contentHash: hash,
    code: `NCM3:${payload.toString("base64url")}`,
  });
  let cacheMiss = false;
  let rpcAttempts = 0;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const sync = createPlayChainBuildingSync({
      cache: { getBuildings: async () => [cacheMiss ? null : building] },
      getFoundations: () => [land],
      getFoundationsNear: () => [land],
      loadChainModule: async () => ({
        loadBuildingsForFoundations: async () => {
          rpcAttempts += 1;
          throw new Error("temporary RPC failure");
        },
      }),
    });
    await sync.refresh({ force: true, now: 1_000 });
    cacheMiss = true;
    const failed = await sync.refresh({ force: true, now: 2_000 });
    assert.equal(failed.ok, false);
    assert.equal(failed.buildings.length, 1);
    assert.equal(sync.snapshot().retryAfterAt, 7_000);
    assert.equal(sync.updateForFrame(6_999), null);
    await sync.updateForFrame(7_000);
    assert.equal(rpcAttempts, 2);
  } finally {
    console.warn = originalWarn;
  }
});

function spatialIndexStub(onReplace = () => {}) {
  let records = [];
  let version = 0;
  return {
    replace(next) {
      records = next;
      version += 1;
      onReplace(records);
    },
    list: () => records,
    size: () => records.length,
    version: () => version,
  };
}

function foundation({
  owner = "owner",
  foundationId = "1",
  minX = 0,
  minZ = 0,
  surfaceY = 100,
  width = 16,
  depth = 16,
  activeRevision = 1,
  contentHash = "ab".repeat(32),
  status = "active",
  accountVersion = 3,
  hasActiveGeometry = true,
} = {}) {
  return {
    id: `${owner}:${foundationId}`,
    owner,
    foundationId,
    minX,
    minZ,
    maxX: minX + width - 1,
    maxZ: minZ + depth - 1,
    surfaceY,
    width,
    depth,
    activeRevision,
    pendingRevision: 0,
    contentHash,
    status,
    accountVersion,
    hasActiveGeometry,
  };
}

function chainBuilding({
  owner = "owner",
  foundationId = "1",
  revision = 1,
  contentHash = "ab".repeat(32),
  code = "NCM3:AQ",
} = {}) {
  return {
    id: `${owner}:${foundationId}:building:${revision}`,
    owner,
    foundationId,
    revision,
    quarterTurns: 0,
    offsetX: 0,
    offsetZ: 0,
    contentHash,
    code,
  };
}
