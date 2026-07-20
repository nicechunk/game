import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

const GUARDIAN_PROGRAM_ID = "RQQZKA1fGELBxtxCQ6q7P26GJH4whWmPjH9XqmihVRK";
const GUARDIAN_GOVERNANCE_WALLET = "9XuoVVwqP2jipt3jpJVXCSS2N2jr9vDuV3d6K73FKVud";

import {
  createPlayGuardianRegistryResolver,
  guardianBuildingAnnouncementPlan,
  guardianCoverageForRegions,
  guardianRegionsForFoundation,
  neighborRegions,
} from "../play-guardian-registry.js";
import {
  createPlayChainFoundationSync,
  guardianRecordMatchesFoundation,
  guardianRecordsMatch,
  recordIntersectsGuardianRegion,
} from "../play-chain-foundations.js";
import { buildingMatchesFoundation, createPlayChainBuildingSync } from "../play-chain-buildings.js";
import {
  computeGuardianBuildingManifestHash,
  decodeGuardianBuildingManifestBinary,
} from "../play-guardian-client.js";

test("foundation coverage enumerates every intersected Guardian region across negative boundaries", () => {
  assert.deepEqual(guardianRegionsForFoundation({
    minX: 1599,
    minZ: -1601,
    width: 2,
    depth: 2,
  }, 16), [
    { x: 0, z: -2 },
    { x: 1, z: -2 },
    { x: 0, z: -1 },
    { x: 1, z: -1 },
  ]);
  assert.equal(neighborRegions(4, -3).length, 9);
});

test("foundation coverage depends on active chain regions, not Guardian server or blueprint metadata", () => {
  const region = { x: 0, z: 0 };
  const legacyActiveEntry = {
    ok: true,
    region,
    url: "",
    buildingsUrl: "",
    guardian: {
      status: 1,
      blueprintHash: null,
    },
  };

  const active = guardianCoverageForRegions([region], [legacyActiveEntry]);
  const missing = guardianCoverageForRegions([region], []);

  assert.equal(active.ok, true);
  assert.deepEqual(active.missing, []);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing.map((entry) => entry.region), [region]);
});

test("foundation resize announces new geometry and removes regions left by a shrink", () => {
  const previousRecord = {
    foundationId: "9",
    minX: 1590,
    minZ: 0,
    surfaceY: 10,
    width: 20,
    depth: 2,
    flags: 1,
    activeRevision: 0,
    contentHash: "0".repeat(32),
    updatedSlot: "10",
  };
  const record = { ...previousRecord, width: 5, updatedSlot: "22" };
  const plan = guardianBuildingAnnouncementPlan(record, { previousRecord, chunkSize: 16 });

  assert.deepEqual(plan.map((entry) => entry.region), [{ x: 0, z: 0 }, { x: 1, z: 0 }]);
  assert.equal(plan[0].record.flags, 1);
  assert.equal(plan[0].record.width, 5);
  assert.equal(plan[1].record.flags, 0);
  assert.equal(plan[1].record.width, 20);
  assert.equal(plan[1].record.updatedSlot, "22");
});

test("one GuardianRegion PDA read returns both endpoint and blueprint digest", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, request: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: { value: [{
          owner: GUARDIAN_PROGRAM_ID,
          data: [guardianRegionAccount().toString("base64"), "base64"],
        }] },
      }),
    };
  };
  try {
    const resolver = createPlayGuardianRegistryResolver({ getRpcUrl: () => "https://rpc.example.test" });
    const [entry] = await resolver.ensureRegions([{ x: 0, z: 0 }]);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://rpc.example.test");
    assert.equal(calls[0].request.method, "getMultipleAccounts");
    assert.equal(calls[0].request.params[0].length, 1);
    assert.equal(entry.ok, true);
    assert.equal(entry.url, "wss://guardian.example.test/ws");
    assert.equal(entry.guardian.blueprintHash, "25232284e49cf2cb4201bb072e27626c");
    assert.equal(entry.guardian.blueprintRevision, "7");
    assert.equal(entry.guardian.blueprintRecordCount, 3);
    assert.equal(entry.guardian.accountLength, 288);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function guardianRegionAccount() {
  const data = Buffer.alloc(288);
  data.write("NCKGRG01", 0, "ascii");
  data.writeUInt16LE(2, 8);
  data.writeUInt8(1, 11);
  data.writeInt32LE(0, 12);
  data.writeInt32LE(0, 16);
  data.writeInt32LE(0, 20);
  data.writeInt32LE(0, 24);
  data.writeInt32LE(99, 28);
  data.writeInt32LE(99, 32);
  new PublicKey(GUARDIAN_GOVERNANCE_WALLET).toBuffer().copy(data, 36);
  const host = Buffer.from("guardian.example.test", "utf8");
  data.writeUInt8(host.length, 132);
  host.copy(data, 133);
  data.writeUInt16LE(443, 197);
  data.writeUInt8(1, 199);
  Buffer.from("25232284e49cf2cb4201bb072e27626c", "hex").copy(data, 256);
  data.writeBigUInt64LE(7n, 272);
  data.writeUInt32LE(3, 280);
  return data;
}

test("Guardian records must exactly match authoritative BuildSite geometry and revision", () => {
  const foundation = {
    owner: "owner",
    foundationId: "91",
    minX: 1599,
    minZ: 8,
    surfaceY: 22,
    width: 4,
    depth: 7,
    activeRevision: 3,
    updatedSlot: "88",
    status: "active",
  };
  const record = {
    foundationId: "91",
    minX: 1599,
    minZ: 8,
    maxX: 1602,
    maxZ: 14,
    surfaceY: 22,
    width: 4,
    depth: 7,
    activeRevision: 3,
    updatedSlot: "88",
  };
  assert.equal(guardianRecordMatchesFoundation(record, foundation), true);
  assert.equal(guardianRecordMatchesFoundation({ ...record, activeRevision: 4 }, foundation), false);
  assert.equal(guardianRecordMatchesFoundation({ ...record, updatedSlot: "87" }, foundation), false);
  assert.equal(recordIntersectsGuardianRegion(record, 0, 0, 16), true);
  assert.equal(recordIntersectsGuardianRegion(record, 1, 0, 16), true);
  assert.equal(recordIntersectsGuardianRegion(record, 2, 0, 16), false);
});

test("foundation creation stops before loading the chain module when Guardian coverage is incomplete", async () => {
  let chainLoads = 0;
  const sync = createPlayChainFoundationSync({
    index: { size: () => 0, replace: () => {} },
    cache: null,
    getWalletAddress: () => "wallet",
    ensureGuardianCoverage: async () => ({
      ok: false,
      missing: [{ region: { x: 2, z: -1 } }],
    }),
    loadChainModule: async () => {
      chainLoads += 1;
      return {};
    },
    translate: (_key, fallback, params) => fallback.replace("{regions}", params.regions),
  });

  const result = await sync.create({ blueprintId: "42", minX: 0, minZ: 0, surfaceY: 10, width: 2, depth: 2 });
  assert.equal(result.submitted, false);
  assert.equal(result.reason, "guardian-coverage-required");
  assert.match(result.message, /2,-1/);
  assert.equal(chainLoads, 0);
});

test("foundation sync forwards the blueprint ID and locks it after chain success", async () => {
  let records = [];
  const submitted = [];
  const sync = createPlayChainFoundationSync({
    index: {
      list: () => records,
      size: () => records.length,
      replace: (next) => { records = [...next]; },
    },
    cache: null,
    getWalletAddress: () => "wallet",
    ensureGuardianCoverage: async () => ({ ok: true, missing: [] }),
    announceGuardianBuilding: async () => ({ ok: false, failed: [] }),
    loadChainModule: async () => ({
      createFoundationOnChain: async (payload) => {
        submitted.push(payload);
        return {
          submitted: true,
          signature: "signature",
          foundation: {
            id: `wallet:${payload.blueprintId}`,
            owner: "wallet",
            foundationId: payload.blueprintId,
            minX: payload.minX,
            minZ: payload.minZ,
            surfaceY: payload.surfaceY,
            width: payload.width,
            depth: payload.depth,
            status: "active",
          },
        };
      },
    }),
  });
  const payload = { blueprintId: "42", minX: 0, minZ: 0, surfaceY: 10, width: 2, depth: 2 };

  const first = await sync.create(payload);
  const duplicate = await sync.create({ ...payload, minX: 20 });

  assert.equal(first.submitted, true);
  assert.equal(first.guardianIndexed, false);
  assert.equal(submitted[0].blueprintId, "42");
  assert.equal(records[0].foundationId, "42");
  assert.equal(duplicate.reason, "foundation-already-bound");
  assert.equal(submitted.length, 1);
});

test("foundation resize keeps its fixed anchor and replaces stale Guardian geometry", async () => {
  const hash = "19".repeat(16);
  const oldFoundation = {
    id: "wallet:42",
    owner: "wallet",
    foundationId: "42",
    minX: 4,
    minZ: 8,
    surfaceY: 12,
    width: 2,
    depth: 2,
    status: "active",
    activeRevision: 0,
    updatedSlot: "10",
  };
  const newFoundation = { ...oldFoundation, width: 6, depth: 5, updatedSlot: "22" };
  let records = [oldFoundation];
  const resizeCalls = [];
  const announcements = [];
  let resizedOnChain = false;
  const sync = createPlayChainFoundationSync({
    index: {
      list: () => records,
      size: () => records.length,
      replace: (next) => { records = [...next]; },
    },
    cache: {
      getRegion: async () => ({
        regionX: 0,
        regionZ: 0,
        revision: "1",
        hash,
        records: [],
        foundations: [oldFoundation],
        verified: true,
      }),
    },
    getWalletAddress: () => "wallet",
    getBlueprintIds: () => ["42"],
    ensureGuardianNeighborhood: async () => [guardianEntry({ hash, revision: "1", recordCount: 0 })],
    ensureGuardianCoverage: async () => ({ ok: true, missing: [] }),
    announceGuardianBuilding: async (...args) => {
      announcements.push(args);
      return { ok: true };
    },
    loadChainModule: async () => ({
      loadBuildSitesByIds: async () => [resizedOnChain ? newFoundation : oldFoundation],
      resizeFoundationOnChain: async (payload) => {
        resizeCalls.push(payload);
        resizedOnChain = true;
        return { submitted: true, signature: "resize-signature", foundation: newFoundation };
      },
    }),
  });

  await sync.refresh({ force: true });
  const result = await sync.resize({ blueprintId: "42", minX: 999, minZ: 999, surfaceY: 99, width: 6, depth: 5 });

  assert.equal(result.submitted, true);
  assert.equal(resizeCalls.length, 1);
  assert.equal(resizeCalls[0].minX, 4);
  assert.equal(resizeCalls[0].minZ, 8);
  assert.equal(resizeCalls[0].surfaceY, 12);
  assert.equal(records.length, 1);
  assert.equal(records[0].width, 6);
  assert.equal(records[0].depth, 5);
  assert.equal(announcements.length, 1);
  assert.equal(announcements[0][0].updatedSlot, "22");
  assert.equal(announcements[0][1].previousRecord.updatedSlot, "10");
});

test("Guardian V3 binary manifests verify SHA-256 and preserve BuildSite updated slots", async () => {
  const bytes = Buffer.alloc(48 + 56);
  bytes.write("NCKBRG03", 0, "ascii");
  bytes.writeUInt16LE(3, 8);
  bytes.writeUInt16LE(56, 10);
  bytes.writeInt32LE(-1, 12);
  bytes.writeInt32LE(2, 16);
  bytes.writeBigUInt64LE(9n, 20);
  bytes.writeUInt32LE(1, 28);
  const offset = 48;
  bytes.writeBigUInt64LE(42n, offset);
  bytes.writeInt32LE(-12, offset + 8);
  bytes.writeInt32LE(3200, offset + 12);
  bytes.writeInt16LE(97, offset + 16);
  bytes.writeUInt16LE(1, offset + 18);
  bytes.writeUInt32LE(8, offset + 20);
  bytes.writeUInt32LE(6, offset + 24);
  bytes.writeUInt32LE(3, offset + 28);
  Buffer.from("22".repeat(16), "hex").copy(bytes, offset + 32);
  bytes.writeBigUInt64LE(123456n, offset + 48);
  const hash = await computeGuardianBuildingManifestHash([{
    foundationId: "42",
    minX: -12,
    minZ: 3200,
    surfaceY: 97,
    flags: 1,
    width: 8,
    depth: 6,
    activeRevision: 3,
    contentHash: "22".repeat(16),
    updatedSlot: "123456",
  }]);
  assert.equal(hash, "14bb85dc06026219c82225f0a455e9d4");
  assert.equal(await computeGuardianBuildingManifestHash([{
    foundationId: "42",
    minX: -12,
    minZ: 3200,
    surfaceY: 97,
    flags: 1,
    width: 8,
    depth: 6,
    activeRevision: 3,
    contentHash: "22".repeat(16),
    updatedSlot: "123456",
  }], { version: 2 }), "02eaf7a81ac6de4c22d5dc837b42d07f");
  Buffer.from(hash, "hex").copy(bytes, 32);

  const manifest = await decodeGuardianBuildingManifestBinary(bytes);
  assert.equal(manifest.regionX, -1);
  assert.equal(manifest.regionZ, 2);
  assert.equal(manifest.records[0].foundationId, "42");
  assert.equal(manifest.records[0].updatedSlot, "123456");

  const tampered = Buffer.from(bytes);
  tampered.writeInt32LE(-11, offset + 8);
  await assert.rejects(
    () => decodeGuardianBuildingManifestBinary(tampered),
    /manifest hash mismatch/i,
  );
});

test("building payload hashes must match the Guardian prefix and BuildSite identity", () => {
  const prefix = "ab".repeat(16);
  const foundation = {
    owner: "owner",
    foundationId: "5",
    activeRevision: 2,
    contentHash: prefix,
  };
  const building = {
    owner: "owner",
    foundationId: "5",
    revision: 2,
    contentHash: `${prefix}${"cd".repeat(16)}`,
  };
  assert.equal(buildingMatchesFoundation(building, foundation), true);
  assert.equal(buildingMatchesFoundation({ ...building, contentHash: "ef".repeat(32) }, foundation), false);
  assert.equal(buildingMatchesFoundation({ ...building, revision: 3 }, foundation), false);
});

test("verified building refresh skips an unchanged render set but reapplies moved foundations", async () => {
  const hashPrefix = "ab".repeat(16);
  let foundation = {
    id: "owner:5",
    owner: "owner",
    foundationId: "5",
    minX: 4,
    minZ: 8,
    surfaceY: 10,
    width: 12,
    depth: 8,
    activeRevision: 2,
    contentHash: hashPrefix,
    status: "active",
  };
  const building = {
    id: "owner:5:building:2",
    owner: "owner",
    foundationId: "5",
    revision: 2,
    quarterTurns: 0,
    contentHash: `${hashPrefix}${"cd".repeat(16)}`,
    code: "NCM3:AQ",
  };
  const applied = [];
  const sync = createPlayChainBuildingSync({
    cache: { getBuildings: async () => [building] },
    getFoundations: () => [foundation],
    applyBuildings: async (records) => applied.push(records),
    loadChainModule: async () => {
      throw new Error("unchanged verified cache must not load RPC");
    },
  });

  assert.equal((await sync.refresh({ force: true })).applied, true);
  assert.equal((await sync.refresh({ force: true })).applied, false);
  assert.equal(applied.length, 1);

  foundation = { ...foundation, minX: 20 };
  assert.equal((await sync.refresh({ force: true })).applied, true);
  assert.equal(applied.length, 2);
});

test("building sync hydrates only the view preload ring and does no foundation scan on steady frames", async () => {
  const prefix = "8a".repeat(16);
  const near = {
    id: "owner:1",
    owner: "owner",
    foundationId: "1",
    minX: 8,
    minZ: 8,
    surfaceY: 10,
    width: 8,
    depth: 8,
    activeRevision: 1,
    contentHash: prefix,
    status: "active",
  };
  const far = { ...near, id: "owner:2", foundationId: "2", minX: 2_000, minZ: 2_000 };
  const foundations = [near, far];
  let player = [0, 0, 0];
  let nearQueries = 0;
  const rpcLoads = [];
  const applied = [];
  const sync = createPlayChainBuildingSync({
    cache: { getBuildings: async (records) => records.map(() => null), putVerifiedBuildings: async () => [] },
    getFoundations: () => foundations,
    getFoundationsNear: (worldX, worldZ, radius) => {
      nearQueries += 1;
      return foundations.filter((foundation) => (
        foundation.minX <= worldX + radius
        && foundation.minX + foundation.width - 1 >= worldX - radius
        && foundation.minZ <= worldZ + radius
        && foundation.minZ + foundation.depth - 1 >= worldZ - radius
      ));
    },
    getFoundationVersion: () => 7,
    getPlayerPosition: () => player,
    viewDistance: 7,
    preloadMargin: 2,
    chunkSize: 16,
    loadChainModule: async () => ({
      loadBuildingsForFoundations: async (records) => {
        rpcLoads.push(records.map((record) => record.foundationId));
        return records.map((record) => ({
          id: `building-${record.foundationId}`,
          owner: record.owner,
          foundationId: record.foundationId,
          revision: record.activeRevision,
          quarterTurns: 0,
          contentHash: `${prefix}${"91".repeat(16)}`,
          code: `NCM3:${record.foundationId}`,
        }));
      },
    }),
    applyBuildings: async (records) => applied.push(records.map((record) => record.foundationId)),
  });

  await sync.refresh({ force: true });
  assert.deepEqual(rpcLoads, [["1"]]);
  assert.deepEqual(applied, [["1"]]);
  const queriesAfterRefresh = nearQueries;
  assert.equal(sync.updateForFrame(performance.now()), null);
  assert.equal(nearQueries, queriesAfterRefresh);

  player = [2_000, 0, 2_000];
  await sync.updateForFrame(performance.now());
  assert.deepEqual(rpcLoads, [["1"], ["2"]]);
  assert.deepEqual(applied, [["1"], ["2"]]);
});

test("building sync reuses the same verified set across Chunk crossings without rereading cache", async () => {
  const prefix = "9a".repeat(16);
  const foundation = {
    id: "owner:1",
    owner: "owner",
    foundationId: "1",
    minX: 0,
    minZ: 0,
    surfaceY: 10,
    width: 32,
    depth: 8,
    activeRevision: 1,
    contentHash: prefix,
    status: "active",
  };
  const building = {
    id: "building-1",
    owner: "owner",
    foundationId: "1",
    revision: 1,
    quarterTurns: 0,
    contentHash: `${prefix}${"92".repeat(16)}`,
    code: "NCM3:AQ",
  };
  let player = [1, 0, 1];
  let cacheReads = 0;
  const sync = createPlayChainBuildingSync({
    cache: {
      getBuildings: async () => {
        cacheReads += 1;
        return [building];
      },
    },
    getFoundations: () => [foundation],
    getFoundationsNear: () => [foundation],
    getFoundationVersion: () => 4,
    getPlayerPosition: () => player,
    loadChainModule: async () => {
      throw new Error("verified cache should not require RPC");
    },
  });

  await sync.refresh({ force: true, now: 1_000 });
  assert.equal(cacheReads, 1);
  const initialRefreshAt = sync.snapshot().lastRefreshAt;
  player = [17, 0, 1];
  const crossed = await sync.updateForFrame(1_100);
  assert.equal(crossed.cached, true);
  assert.equal(cacheReads, 1, "crossing a Chunk with the same building set must not touch IndexedDB");
  assert.equal(sync.snapshot().lastRefreshAt, initialRefreshAt, "movement must not postpone periodic verification");

  await sync.updateForFrame(61_001);
  assert.equal(cacheReads, 2, "the normal refresh interval must still revalidate the cached set");
});

test("building sync backs off after RPC failure, retains verified buildings, and permits forced retry", async () => {
  const prefix = "aa".repeat(16);
  const foundation = {
    id: "owner:7",
    owner: "owner",
    foundationId: "7",
    minX: 0,
    minZ: 0,
    surfaceY: 10,
    width: 8,
    depth: 8,
    activeRevision: 1,
    contentHash: prefix,
    status: "active",
  };
  const building = {
    id: "building-7",
    owner: "owner",
    foundationId: "7",
    revision: 1,
    quarterTurns: 0,
    contentHash: `${prefix}${"bb".repeat(16)}`,
    code: "NCM3:AQ",
  };
  let cacheMiss = false;
  let cacheReads = 0;
  let rpcAttempts = 0;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const sync = createPlayChainBuildingSync({
      cache: {
        getBuildings: async () => {
          cacheReads += 1;
          return [cacheMiss ? null : building];
        },
      },
      getFoundations: () => [foundation],
      getPlayerPosition: () => [0, 0, 0],
      loadChainModule: async () => {
        rpcAttempts += 1;
        throw new Error("temporary RPC failure");
      },
    });

    await sync.refresh({ force: true, now: 1_000 });
    assert.equal(sync.snapshot().buildings, 1);
    cacheMiss = true;
    const failed = await sync.refresh({ force: true, now: 2_000 });
    assert.equal(failed.ok, false);
    assert.equal(failed.buildings.length, 1, "a transient failure must not hide the last verified building set");
    assert.equal(sync.snapshot().retryAfterAt, 7_000);
    assert.equal(sync.updateForFrame(6_999), null, "animation frames must not retry before the backoff expires");
    assert.equal(cacheReads, 2);
    assert.equal(rpcAttempts, 1);

    const retried = await sync.updateForFrame(7_000);
    assert.equal(retried.ok, false);
    assert.equal(cacheReads, 3);
    assert.equal(rpcAttempts, 2, "the first retry should occur only after the backoff");

    await sync.refresh({ force: true, now: 7_001 });
    assert.equal(cacheReads, 4);
    assert.equal(rpcAttempts, 3, "a forced refresh must bypass the active retry delay");
  } finally {
    console.warn = originalWarn;
  }
});

test("building finalization refreshes BuildSite before announcing its revision and slot", async () => {
  const foundation = {
    id: "owner:5",
    owner: "owner",
    foundationId: "5",
    minX: 4,
    minZ: 8,
    surfaceY: 12,
    width: 6,
    depth: 5,
    activeRevision: 0,
    updatedSlot: "10",
    status: "active",
  };
  const authoritative = { ...foundation, activeRevision: 1, updatedSlot: "77" };
  const announcements = [];
  const sync = createPlayChainBuildingSync({
    cache: null,
    getWalletAddress: () => "owner",
    getFoundations: () => [foundation],
    announceGuardianBuilding: async (record) => {
      announcements.push(record);
      return { ok: true };
    },
    loadChainModule: async () => ({
      createBuildingOnChain: async () => ({
        submitted: true,
        building: {
          foundationId: "5",
          owner: "owner",
          revision: 1,
          contentHash: "ab".repeat(32),
        },
      }),
      loadBuildSitesByIds: async () => [authoritative],
    }),
  });

  const result = await sync.create({ foundationId: "5", code: "NCM3:AQ" });
  assert.equal(result.submitted, true);
  assert.equal(result.guardianIndexed, true);
  assert.equal(announcements.length, 1);
  assert.equal(announcements[0].activeRevision, 1);
  assert.equal(announcements[0].updatedSlot, "77");
  assert.equal(announcements[0].contentHash, "ab".repeat(32));
});

test("matching on-chain blueprint hash reuses the verified region without fetching the manifest", async () => {
  const hash = "11".repeat(16);
  let fetches = 0;
  let chainLoads = 0;
  const cached = {
    regionX: 0,
    regionZ: 0,
    revision: "1",
    hash,
    records: [],
    foundations: [],
    verified: true,
  };
  const sync = createPlayChainFoundationSync({
    index: { size: () => 0, replace: () => {} },
    cache: { getRegion: async () => cached },
    ensureGuardianNeighborhood: async () => [guardianEntry({ hash, revision: "1", recordCount: 0 })],
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("manifest should not be fetched");
    },
    loadChainModule: async () => {
      chainLoads += 1;
      return {};
    },
  });

  const result = await sync.refresh({ force: true });
  assert.equal(result.ok, true);
  assert.equal(fetches, 0);
  assert.equal(chainLoads, 0);
});

test("owned BuildSite refresh preserves a verified building hash for the same revision", async () => {
  const hash = "21".repeat(16);
  const contentHash = "43".repeat(16);
  const record = guardianRecord({ foundationId: "1", activeRevision: 2, contentHash, updatedSlot: "9" });
  const verifiedFoundation = foundationForRecord(record);
  let indexed = [];
  const sync = createPlayChainFoundationSync({
    index: {
      size: () => indexed.length,
      list: () => indexed,
      replace: (foundations) => { indexed = foundations; },
    },
    cache: {
      getRegion: async () => ({
        regionX: 0,
        regionZ: 0,
        revision: "1",
        hash,
        records: [record],
        foundations: [verifiedFoundation],
        verified: true,
      }),
    },
    getWalletAddress: () => "owner",
    getBlueprintIds: () => ["1"],
    ensureGuardianNeighborhood: async () => [guardianEntry({ hash, revision: "1", recordCount: 1 })],
    loadChainModule: async () => ({
      loadBuildSitesByIds: async () => [{ ...verifiedFoundation, contentHash: undefined }],
    }),
  });

  const result = await sync.refresh({ force: true });
  assert.equal(result.ok, true);
  assert.equal(indexed.length, 1);
  assert.equal(indexed[0].contentHash, contentHash);
});

test("owned BuildSite PDAs restore in one batch when the Guardian neighborhood is unavailable", async () => {
  const replacements = [];
  const loads = [];
  const foundation = {
    id: "wallet:42",
    owner: "wallet",
    foundationId: "42",
    minX: 748,
    minZ: 781,
    surfaceY: 136,
    width: 12,
    depth: 8,
    status: "active",
    activeRevision: 0,
  };
  const sync = createPlayChainFoundationSync({
    index: {
      size: () => replacements.at(-1)?.length ?? 0,
      list: () => replacements.at(-1) ?? [],
      replace: (foundations) => replacements.push(foundations),
    },
    getWalletAddress: () => "wallet",
    getBlueprintIds: () => ["42", "42", "not-a-blueprint"],
    ensureGuardianNeighborhood: async () => [],
    loadChainModule: async () => ({
      loadBuildSitesByIds: async (ids) => {
        loads.push(ids);
        return [foundation, { ...foundation, owner: "another-wallet", foundationId: "43" }];
      },
    }),
  });

  const result = await sync.refresh({ force: true });
  assert.equal(result.ok, true);
  assert.equal(result.partial, true);
  assert.deepEqual(loads, [["42"]]);
  assert.deepEqual(replacements.at(-1), [foundation]);
  assert.equal(sync.snapshot().owned, 1);
});

test("changed regional manifest batch-loads only new or changed BuildSite PDAs once", async () => {
  const previousHash = "22".repeat(16);
  const nextHash = "33".repeat(16);
  const unchanged = guardianRecord({ foundationId: "1", contentHash: "44".repeat(16) });
  const changed = guardianRecord({ foundationId: "2", minX: 4, activeRevision: 2, contentHash: "55".repeat(16) });
  const added = guardianRecord({ foundationId: "3", minX: 8, contentHash: "66".repeat(16) });
  const previousChanged = { ...changed, activeRevision: 1, contentHash: "77".repeat(16) };
  const cached = {
    regionX: 0,
    regionZ: 0,
    revision: "1",
    hash: previousHash,
    records: [unchanged, previousChanged],
    foundations: [foundationForRecord(unchanged), foundationForRecord(previousChanged)],
    verified: true,
  };
  const entry = guardianEntry({ hash: nextHash, revision: "2", recordCount: 3 });
  const calls = [];
  let stored = null;
  const sync = createPlayChainFoundationSync({
    index: { size: () => 0, replace: () => {} },
    cache: {
      getRegion: async () => cached,
      putVerifiedRegion: async (manifest, foundations) => {
        stored = { ...manifest, foundations, verified: true };
        return stored;
      },
    },
    getGuardianRegion: () => entry,
    loadChainModule: async () => ({
      loadBuildSitesByIds: async (ids) => {
        calls.push(ids);
        return [foundationForRecord(changed), foundationForRecord(added)];
      },
    }),
  });

  const result = await sync.handleRegionManifest({
    regionX: 0,
    regionZ: 0,
    revision: "2",
    recordCount: 3,
    hash: nextHash,
    records: [unchanged, changed, added],
    endpoint: entry.url,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [["2", "3"]]);
  assert.equal(stored.foundations.length, 3);
  assert.equal(stored.foundations[0].foundationId, "1");
  assert.equal(guardianRecordsMatch(unchanged, { ...unchanged }), true);
  assert.equal(guardianRecordsMatch(unchanged, { ...unchanged, contentHash: "ff".repeat(16) }), false);
});

test("an older manifest cannot overwrite cache after the on-chain digest changes mid-verification", async () => {
  const oldHash = "12".repeat(16);
  const nextHash = "34".repeat(16);
  const record = guardianRecord({ foundationId: "9", contentHash: "56".repeat(16) });
  let entry = guardianEntry({ hash: oldHash, revision: "1", recordCount: 1 });
  let release;
  let markStarted;
  const loading = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  let writes = 0;
  const sync = createPlayChainFoundationSync({
    index: { size: () => 0, replace: () => {} },
    cache: {
      getRegion: async () => null,
      putVerifiedRegion: async (manifest, foundations) => {
        writes += 1;
        return { ...manifest, foundations, verified: true };
      },
    },
    getGuardianRegion: () => entry,
    loadChainModule: async () => ({
      loadBuildSitesByIds: async () => {
        markStarted();
        await loading;
        return [foundationForRecord(record)];
      },
    }),
  });

  const pending = sync.handleRegionManifest({
    regionX: 0,
    regionZ: 0,
    revision: "1",
    recordCount: 1,
    hash: oldHash,
    records: [record],
    endpoint: entry.url,
  });
  await started;
  entry = guardianEntry({ hash: nextHash, revision: "2", recordCount: 1 });
  release();

  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(writes, 0);
});

function guardianEntry({ hash, revision, recordCount }) {
  return {
    ok: true,
    region: { x: 0, z: 0 },
    url: "wss://guardian.example/ws",
    buildingsUrl: "https://guardian.example/buildings",
    guardian: {
      blueprintHash: hash,
      blueprintRevision: revision,
      blueprintRecordCount: recordCount,
    },
  };
}

function guardianRecord({
  foundationId,
  minX = 0,
  minZ = 0,
  activeRevision = 1,
  contentHash,
  updatedSlot = "1",
}) {
  return {
    foundationId,
    minX,
    minZ,
    maxX: minX + 1,
    maxZ: minZ + 1,
    surfaceY: 10,
    flags: 1,
    width: 2,
    depth: 2,
    activeRevision,
    contentHash,
    updatedSlot,
  };
}

function foundationForRecord(record) {
  return {
    id: `owner:${record.foundationId}`,
    owner: "owner",
    foundationId: record.foundationId,
    minX: record.minX,
    minZ: record.minZ,
    maxX: record.maxX,
    maxZ: record.maxZ,
    surfaceY: record.surfaceY,
    width: record.width,
    depth: record.depth,
    activeRevision: record.activeRevision,
    pendingRevision: 0,
    updatedSlot: record.updatedSlot,
    status: "active",
  };
}
