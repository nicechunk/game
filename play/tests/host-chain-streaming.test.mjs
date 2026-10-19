import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createPlayChainFoundationSync } from "../play-chain-foundations.js";
import { createPlayChainBuildingSync } from "../play-chain-buildings.js";
import { loadFoundationsForChunks } from "../../src/chain/nicechunkChain.js";

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function indexFixture() {
  let records = [];
  return { replace(next) { records = next; }, list: () => records, size: () => records.length };
}
function land(id = "1", values = {}) {
  return { id: `owner:${id}`, owner: "owner", foundationId: id, accountVersion: 3,
    status: "active", hasActiveGeometry: true, minX: 0, minZ: 0, width: 16, depth: 16,
    surfaceY: 100, activeRevision: 1, ...values };
}
function buildingFixture(id = "1", values = {}) {
  const bytes = Buffer.from(`building:${id}`), contentHash = createHash("sha256").update(bytes).digest("hex");
  return { foundation: land(id, { contentHash, ...values }), building: { foundationId: id,
    owner: "owner", revision: 1, contentHash, code: `NCM3:${bytes.toString("base64url")}` } };
}

test("all four discovery views reach the real SDK with complete union and RPC batches at most 100", async () => {
  for (const [view, count] of [[7, 441], [12, 961], [13, 1089], [20, 2209]]) {
    const queried = [], rpc = [];
    let active = 0, peak = 0;
    const connection = { async getMultipleAccountsInfo(addresses, commitment) {
      assert.equal(commitment, "confirmed"); assert.ok(addresses.length <= 100);
      active++; peak = Math.max(active, peak); rpc.push(addresses.length); await turn(); active--;
      return addresses.map(() => null);
    } };
    const sync = createPlayChainFoundationSync({ index: indexFixture(), viewDistance: view, clock: () => 0,
      loadChainModule: async () => ({ loadFoundationsForChunks: coordinates => {
        assert.ok(coordinates.length <= 1024); queried.push(...coordinates);
        return loadFoundationsForChunks(coordinates, connection);
      } }),
    });
    assert.equal((await sync.refresh({ now: 0 })).ok, true);
    assert.equal(queried.length, count);
    assert.equal(new Set(queried.map(row => `${row.chunkX},${row.chunkZ}`)).size, count);
    assert.equal(rpc.reduce((sum, value) => sum + value, 0), count);
    assert.ok(peak >= 2 && peak <= 4); assert.equal(sync.snapshot().cachedCoordinates, count);
  }
  await assert.rejects(loadFoundationsForChunks(Array.from({ length: 1025 }, (_, chunkX) => ({ chunkX, chunkZ: 0 })), {}), /exceeds 1024/);
});

test("movement queries only new boundaries and does not reread owned land until its own TTL", async () => {
  let player = [0, 0, 0], ownedReads = 0;
  const batches = [];
  const sync = createPlayChainFoundationSync({ index: indexFixture(), clock: () => 0,
    getPlayerPosition: () => player, getWalletAddress: () => "owner",
    loadChainModule: async () => ({ loadFoundationsForChunks: async batch => { batches.push(batch); return []; },
      loadOwnedFoundations: async () => { ownedReads++; return []; } }),
  });
  for (let step = 0; step < 3; step++) {
    const before = batches.length; player = [step * 16, 0, 0];
    await sync.updateForFrame(step);
    const queried = batches.slice(before).flat();
    assert.equal(queried.length, step ? 21 : 441);
    if (step) assert.ok(queried.every(row => row.chunkX === step + 10));
  }
  assert.equal(ownedReads, 1);
  await sync.refresh({ now: 15000 });
  assert.equal(ownedReads, 1, "negative discoveries have an independent shorter TTL");
  await sync.refresh({ now: 60000 });
  assert.equal(ownedReads, 2);
});

test("near discovery publishes before a blocked independent owner scan", async () => {
  const owned = deferred(), index = indexFixture();
  const sync = createPlayChainFoundationSync({ index, viewDistance: 1, clock: () => 0,
    getWalletAddress: () => "owner", loadChainModule: async () => ({
      loadFoundationsForChunks: async () => [land()], loadOwnedFoundations: () => owned.promise,
    }),
  });
  const pending = sync.refresh({ now: 0 });
  for (let attempt = 0; attempt < 50 && !index.size(); attempt++) await turn();
  assert.equal(index.size(), 1); assert.equal(sync.snapshot().loading, true);
  owned.resolve([]); await pending;
});


test("blocked owned reads do not retain a discovery round for every movement", async () => {
  let player = [0, 0, 0]; const owned = deferred();
  const sync = createPlayChainFoundationSync({ index: indexFixture(), viewDistance: 1, preloadMargin: 0,
    getWalletAddress: () => "owner", getPlayerPosition: () => player, clock: () => 0,
    loadChainModule: async () => ({ loadFoundationsForChunks: async () => [], loadOwnedFoundations: () => owned.promise }),
  });
  for (let center = 0; center < 30; center++) {
    player = [center * 16, 0, 0]; await sync.updateForFrame(center);
    assert.equal(sync.snapshot().discoveryRounds, 0);
    assert.equal(sync.snapshot().ownedLoading, true);
  }
  owned.resolve([]); await turn();
});

test("failed coordinates retain verified land and respect backoff while successful negatives remove it", async () => {
  let fail = false, empty = false, reads = 0;
  const index = indexFixture();
  const sync = createPlayChainFoundationSync({ index, viewDistance: 1, clock: () => 0,
    loadChainModule: async () => ({ loadFoundationsForChunks: async () => {
      reads++; if (fail) throw new Error("RPC unavailable"); return empty ? [] : [land()];
    } }),
  });
  await sync.refresh({ now: 0 }); fail = true;
  await sync.refresh({ force: true, now: 100 }); assert.equal(index.size(), 1);
  const before = reads; assert.equal(sync.updateForFrame(5099), null); assert.equal(reads, before);
  fail = false; empty = true; await sync.updateForFrame(5100); assert.equal(index.size(), 0);
});

test("multi-coordinate coverage survives moving its first coordinate outside the window", async () => {
  const index = indexFixture(), long = land("2", { width: 64 });
  let player = [0, 0, 0];
  const sync = createPlayChainFoundationSync({ index, viewDistance: 1, preloadMargin: 0,
    getPlayerPosition: () => player, clock: () => 0,
    loadChainModule: async () => ({ loadFoundationsForChunks: async () => [long] }),
  });
  await sync.refresh({ now: 0 }); player = [80, 0, 0]; await sync.updateForFrame(1);
  assert.equal(index.size(), 1); assert.equal(index.list()[0].foundationId, "2");
  player = [160, 0, 0]; await sync.updateForFrame(2); assert.equal(index.size(), 0);
});

test("authority changes reject overlapping late reads and clear their coordinate cache", async () => {
  const gate = deferred(), started = deferred(), index = indexFixture(); let authority = "world-a";
  const sync = createPlayChainFoundationSync({ index, viewDistance: 1, clock: () => 0,
    getAuthorityContext: () => authority, loadChainModule: async () => ({ loadFoundationsForChunks: async () => {
      started.resolve(); await gate.promise; return [land()];
    } }),
  });
  const first = sync.refresh({ now: 0 }); await started.promise; authority = "world-b"; gate.resolve();
  assert.equal((await first).stale, true); assert.equal(index.size(), 0); assert.equal(sync.snapshot().cachedCoordinates, 0);
});

test("SDK identity remains part of discovery context when a host world getter is provided", async () => {
  let rpc = "rpc-a"; const queried = [];
  const sdk = { getNicechunkDiscoveryContext: () => ({ rpc }), loadFoundationsForChunks: async rows => { queried.push(rows.length); return []; } };
  const sync = createPlayChainFoundationSync({ index: indexFixture(), viewDistance: 1, preloadMargin: 0, clock: () => 0,
    getAuthorityContext: () => ({ world: "same-host-world" }), loadChainModule: async () => sdk,
  });
  await sync.refresh({ now: 0 }); const epoch = sync.snapshot().authorityEpoch;
  rpc = "rpc-b"; await sync.updateForFrame(1);
  assert.deepEqual(queried, [25, 25]); assert.ok(sync.snapshot().authorityEpoch > epoch);
});

test("SDK identity invalidates a pending building even when host world identity is unchanged", async () => {
  const fixture = buildingFixture(), gate = deferred(), started = deferred(); let rpc = "rpc-a";
  const sdk = { getNicechunkDiscoveryContext: () => ({ rpc }), loadBuildingsForFoundations: async () => {
    started.resolve(); await gate.promise; return [fixture.building];
  } };
  const applications = [];
  const sync = createPlayChainBuildingSync({ autoApply: false, clock: () => 0,
    getAuthorityContext: () => ({ world: "same-host-world" }), getFoundations: () => [fixture.foundation],
    cache: { getBuilding: async () => null }, loadChainModule: async () => sdk,
    applyBuildings: records => applications.push(records),
  });
  const request = sync.refresh({ now: 0 }); await started.promise; rpc = "rpc-b"; gate.resolve();
  assert.equal((await request).stale, true); sync.applyQueuedBuildings({ budgetMs: 10 });
  assert.deepEqual(applications, []);
});

test("a missing per-coordinate verification is retained as failure rather than negative cached", async () => {
  const index = indexFixture(); let partial = false;
  const sync = createPlayChainFoundationSync({ index, viewDistance: 1, clock: () => 0,
    loadChainModule: async () => ({ loadFoundationsForChunks: async batch => {
      const result = partial ? [] : [land()];
      if (partial) Object.defineProperties(result, { observations: { value: [] }, failedCoordinates: { value: batch } });
      return result;
    } }),
  });
  await sync.refresh({ now: 0 }); partial = true;
  assert.equal((await sync.refresh({ force: true, now: 1 })).ok, false); assert.equal(index.size(), 1);
});

test("cached and complete network buildings publish before pending network and disk work", async () => {
  const a = buildingFixture("1"), b = buildingFixture("2"), network = deferred(), started = deferred(), disk = deferred();
  const applications = [];
  const sync = createPlayChainBuildingSync({ autoApply: false, clock: () => 0,
    getFoundations: () => [a.foundation, b.foundation], applyBuildings: records => applications.push(records),
    cache: { getBuilding: async foundation => foundation.foundationId === "1" ? a.building : null,
      putVerifiedBuildings: () => disk.promise },
    loadChainModule: async () => ({ loadBuildingsForFoundations: async (_missing, options) => {
      started.resolve(); await network.promise; options.onBuilding(b.building, b.foundation); return [b.building];
    } }),
  });
  const request = sync.refresh({ now: 0 }); await started.promise;
  sync.applyQueuedBuildings({ budgetMs: 10 }); assert.deepEqual(applications.at(-1).map(row => row.foundationId), ["1"]);
  network.resolve(); await request; assert.equal(sync.snapshot().diskActive, true);
  sync.applyQueuedBuildings({ budgetMs: 10 }); assert.deepEqual(applications.at(-1).map(row => row.foundationId), ["1", "2"]);
  disk.resolve(); await turn();
});

test("application obeys the shared deadline and bounded building count", async () => {
  const fixtures = Array.from({ length: 9 }, (_, index) => buildingFixture(String(index + 1)));
  const sync = createPlayChainBuildingSync({ autoApply: false, clock: () => 0,
    getFoundations: () => fixtures.map(row => row.foundation),
    cache: { getBuilding: async foundation => fixtures.find(row => row.foundation.foundationId === foundation.foundationId).building },
    loadChainModule: async () => ({}),
  });
  await sync.refresh({ now: 0 }); assert.equal(sync.snapshot().pendingBuildings, 9);
  assert.equal(sync.applyQueuedBuildings({ deadline: performance.now() - 1, budgetMs: 10 }).appliedBuildings, 0);
  assert.equal(sync.applyQueuedBuildings({ budgetMs: 10, maxBuildings: 2 }).appliedBuildings, 2);
  assert.equal(sync.snapshot().pendingBuildings, 7);
});

test("individual network failures retain unrelated complete buildings and removal clears known obsolete scene", async () => {
  const a = buildingFixture("1"), b = buildingFixture("2"); let foundations = [a.foundation, b.foundation];
  const applications = [];
  const sync = createPlayChainBuildingSync({ autoApply: false, clock: () => 0,
    getFoundations: () => foundations, cache: { getBuilding: async () => null },
    applyBuildings: records => applications.push(records), loadChainModule: async () => ({
      loadBuildingsForFoundations: async (_missing, options) => { options.onError(new Error("bad shard"), b.foundation); options.onBuilding(a.building, a.foundation); return [a.building]; },
    }),
  });
  assert.equal((await sync.refresh({ now: 0 })).ok, false);
  sync.applyQueuedBuildings({ budgetMs: 10 }); assert.deepEqual(applications.at(-1).map(row => row.foundationId), ["1"]);
  foundations = []; sync.applyQueuedBuildings({ budgetMs: 10 }); assert.deepEqual(applications.at(-1), []);
});

test("movement preserves a still-needed pending building but an authority change rejects it", async () => {
  for (const changeAuthority of [false, true]) {
    const fixture = buildingFixture(), gate = deferred(), started = deferred(); let authority = "a", player = [0, 0, 0];
    const applications = [];
    const sync = createPlayChainBuildingSync({ autoApply: false, clock: () => 0,
      getFoundations: () => [fixture.foundation], getPlayerPosition: () => player, getAuthorityContext: () => authority,
      cache: { getBuilding: async () => null }, applyBuildings: records => applications.push(records),
      loadChainModule: async () => ({ loadBuildingsForFoundations: async () => { started.resolve(); await gate.promise; return [fixture.building]; } }),
    });
    const request = sync.refresh({ now: 0 }); await started.promise;
    player = [16, 0, 0]; if (changeAuthority) authority = "b";
    gate.resolve(); await request; sync.applyQueuedBuildings({ budgetMs: 10 });
    assert.equal(applications.flat().length, changeAuthority ? 0 : 1);
  }
});
