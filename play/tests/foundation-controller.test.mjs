import assert from "node:assert/strict";
import test from "node:test";

import { createFoundationController, footprintForHit } from "../foundation-controller.js";
import { createFoundationSpatialIndex } from "../foundation-spatial-index.js";

const TOP_HIT = Object.freeze({
  hit: true,
  worldX: 1,
  worldY: 10,
  worldZ: 2,
  faceX: 0,
  faceY: 1,
  faceZ: 0,
  blockId: 1,
});

test("land footprints align to complete chunks and expand away from the player", () => {
  assert.deepEqual(footprintForHit(
    { ...TOP_HIT, worldX: -1, worldZ: -17 },
    2,
    3,
    [0, 0, 0],
  ), {
    minX: -32,
    minZ: -64,
    maxX: -1,
    maxZ: -17,
    width: 32,
    depth: 48,
    chunksX: 2,
    chunksZ: 3,
  });
});

test("foundation index deduplicates cross-chunk records and protects only the surface layer", () => {
  const index = createFoundationSpatialIndex({ chunkSize: 16 });
  const foundation = {
    id: "owner:9",
    owner: "owner",
    foundationId: "9",
    minX: -1,
    minZ: 15,
    surfaceY: 11,
    width: 16,
    depth: 2,
    activeRevision: 3,
    contentHash: "ab".repeat(16),
  };
  index.upsert(foundation);
  const version = index.version();
  index.upsert(foundation);

  assert.equal(index.size(), 1);
  assert.equal(index.version(), version);
  assert.equal(index.list()[0].contentHash, foundation.contentHash);
  assert.equal(index.listNear(0, 16, 32).length, 1);
  assert.equal(index.isBlockProtected({ worldX: -1, worldY: 10, worldZ: 15 }), true);
  assert.equal(index.isBlockProtected({ worldX: -1, worldY: 9, worldZ: 15 }), false);
  assert.equal(index.isBlockProtected({ worldX: 15, worldY: 10, worldZ: 15 }), false);
  assert.equal(index.intersects({ minX: 14, minZ: 16, width: 2, depth: 2 })?.id, foundation.id);
});

test("land outlines render only while land construction mode is active", () => {
  const index = createFoundationSpatialIndex();
  index.upsert({
    id: "owner:10",
    owner: "owner",
    foundationId: "10",
    minX: 0,
    minZ: 0,
    surfaceY: 11,
    width: 16,
    depth: 16,
  });
  let constructionModeActive = false;
  const controller = createFoundationController({
    index,
    getPlayerPosition: () => [0, 11, 0],
    isConstructionModeActive: () => constructionModeActive,
  });

  assert.deepEqual(controller.overlays(), []);
  constructionModeActive = true;
  assert.equal(controller.overlays().length, 1);
});

test("two-by-two chunk land consumes four contracts and submits chunk-aligned geometry", async () => {
  const index = createFoundationSpatialIndex({ chunkSize: 16 });
  const submitted = [];
  let foundationRefreshes = 0;
  let contractRefreshes = 0;
  const controller = createFoundationController({
    index,
    getChunks: () => flatWorld(),
    getPlayerPosition: () => [0, 11, 0],
    isConstructionModeActive: () => true,
    getLandContractBalance: () => 4,
    isBlockingBlock: (blockId) => blockId === 1,
    isFluidBlock: (blockId) => blockId === 17,
    submitFoundation: async (payload) => {
      submitted.push(payload);
      return {
        submitted: true,
        foundation: { id: "owner:10", owner: "owner", foundationId: "10", ...payload },
      };
    },
    refreshFoundations: async () => { foundationRefreshes += 1; },
    refreshLandContracts: async () => { contractRefreshes += 1; },
  });
  controller.setDimensions(2, 2);

  const selected = controller.selectAtHit(TOP_HIT);
  assert.equal(selected.ok, true);
  assert.equal(selected.preview.valid, true);
  assert.deepEqual(controller.dimensions(), {
    chunksX: 2,
    chunksZ: 2,
    width: 32,
    depth: 32,
    requiredContracts: 4,
  });
  assert.deepEqual(controller.overlays().at(-1), {
    shape: "foundation",
    worldX: 0,
    worldY: 11.018,
    worldZ: 0,
    width: 32,
    depth: 32,
    preview: true,
    grid: true,
    valid: true,
    fillColor: [0.08, 0.48, 1, 0.28],
    gridColor: [0.48, 0.84, 1, 0.58],
    edgeColor: [0.72, 0.96, 1, 0.98],
    glowColor: [0.12, 0.68, 1, 0.34],
  });

  const result = await controller.confirm();
  assert.equal(result.submitted, true);
  assert.deepEqual(submitted, [{ minX: 0, minZ: 0, surfaceY: 11, width: 32, depth: 32 }]);
  assert.equal(index.isBlockProtected({ worldX: 0, worldY: 10, worldZ: 0 }), true);
  assert.equal(foundationRefreshes, 1);
  assert.equal(contractRefreshes, 1);
});

test("confirm locks and submits the current valid chunk hologram without a second click", async () => {
  const submissions = [];
  const controller = controllerForWorld(flatWorld(), createFoundationSpatialIndex(), {
    getLandContractBalance: () => 1,
    submitFoundation: async (foundation) => {
      submissions.push(foundation);
      return { submitted: true, foundation: { ...foundation, id: "auto-anchor", owner: "owner", foundationId: "11" } };
    },
  });

  controller.setHoverHit({ ...TOP_HIT, worldX: 3, worldZ: 3 });
  assert.equal(controller.snapshot().anchored, false);
  assert.equal(controller.snapshot().preview?.valid, true);

  const result = await controller.confirm();
  assert.equal(result.submitted, true);
  assert.deepEqual(submissions, [{ minX: 0, minZ: 0, surfaceY: 11, width: 16, depth: 16 }]);
});

test("insufficient land contracts block submission before any chain call", async () => {
  let submissions = 0;
  const controller = controllerForWorld(flatWorld(), createFoundationSpatialIndex(), {
    getLandContractBalance: () => 3,
    submitFoundation: async () => {
      submissions += 1;
      return { submitted: true };
    },
  });
  controller.setDimensions(2, 2);
  assert.equal(controller.selectAtHit(TOP_HIT).ok, true);

  const result = await controller.confirm();
  assert.deepEqual(result, {
    submitted: false,
    reason: "insufficient-land-contracts",
    requiredLandContracts: 4,
    availableLandContracts: 3,
  });
  assert.equal(submissions, 0);
});

test("land dimensions are expressed in chunks and contract count is their product", () => {
  const controller = controllerForWorld(flatWorld());
  controller.setDimensions(2, 3);
  assert.deepEqual(controller.dimensions(), {
    chunksX: 2,
    chunksZ: 3,
    width: 32,
    depth: 48,
    requiredContracts: 6,
  });
});

test("one land parcel cannot schedule more than 4,096 chunk registrations", () => {
  const statuses = [];
  const controller = controllerForWorld(flatWorld(), createFoundationSpatialIndex(), {
    onStatus: (message) => statuses.push(message),
  });
  controller.setDimensions(64, 64);
  assert.equal(controller.dimensions().requiredContracts, 4_096);

  controller.setDimensions(65, 64);
  assert.equal(controller.dimensions().requiredContracts, 4_096);
  assert.match(statuses.at(-1), /too many contracts/i);
});

test("land registration rejects uneven ground, fluids, obstructions, and existing land", () => {
  const cases = [
    {
      reason: "not-level",
      mutate(world) { world.tops.set("2,2", 11); },
    },
    {
      reason: "invalid-ground",
      mutate(world) { world.blocks.set("2,10,2", 17); },
    },
    {
      reason: "obstructed",
      mutate(world) { world.blocks.set("2,11,2", 22); },
    },
  ];

  for (const { reason, mutate } of cases) {
    const world = flatWorld();
    mutate(world);
    const selected = controllerForWorld(world).selectAtHit(TOP_HIT);
    assert.equal(selected.ok, false, reason);
    assert.equal(selected.preview.reason, reason);
  }

  const index = createFoundationSpatialIndex();
  index.upsert({ id: "owner:1", minX: 0, minZ: 0, surfaceY: 11, width: 16, depth: 16 });
  const selected = controllerForWorld(flatWorld(), index).selectAtHit(TOP_HIT);
  assert.equal(selected.ok, false);
  assert.equal(selected.preview.reason, "overlap");
});

function controllerForWorld(world, index = createFoundationSpatialIndex(), overrides = {}) {
  return createFoundationController({
    index,
    getChunks: () => world,
    getPlayerPosition: () => [0, 11, 0],
    isConstructionModeActive: () => true,
    getLandContractBalance: () => 99,
    isBlockingBlock: (blockId) => blockId === 1 || blockId === 17,
    isFluidBlock: (blockId) => blockId === 17,
    ...overrides,
  });
}

function flatWorld() {
  const tops = new Map();
  const blocks = new Map();
  return {
    tops,
    blocks,
    getOpaqueColumnTopAtWorld(x, z) {
      return tops.get(`${x},${z}`) ?? 10;
    },
    getBlockAtWorld(x, y, z) {
      return blocks.get(`${x},${y},${z}`) ?? (y === 10 ? 1 : 0);
    },
  };
}
