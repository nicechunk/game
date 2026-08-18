import assert from "node:assert/strict";
import test from "node:test";

import {
  createFoundationController,
  footprintForCorners,
  footprintForHit,
} from "../foundation-controller.js";
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

test("two-corner footprints work in every direction across negative coordinates", () => {
  const first = { ...TOP_HIT, worldX: 31, worldZ: -1 };
  const second = { ...TOP_HIT, worldX: -17, worldZ: 32 };
  const expected = {
    minX: -32,
    minZ: -16,
    maxX: 31,
    maxZ: 47,
    width: 64,
    depth: 64,
    chunksX: 4,
    chunksZ: 4,
  };
  assert.deepEqual(footprintForCorners(first, second), expected);
  assert.deepEqual(footprintForCorners(second, first), expected);
});

test("foundation index protects the full world column from non-owners only", () => {
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
    contentHash: "ab".repeat(32),
  };
  index.upsert(foundation);
  const version = index.version();
  index.upsert(foundation);

  assert.equal(index.size(), 1);
  assert.equal(index.version(), version);
  assert.equal(index.list()[0].contentHash, foundation.contentHash);
  assert.equal(index.listNear(0, 16, 32).length, 1);
  assert.equal(index.isBlockProtected({ worldX: -1, worldY: 10, worldZ: 15 }, "visitor"), true);
  assert.equal(index.isBlockProtected({ worldX: -1, worldY: -32, worldZ: 15 }, "visitor"), true);
  assert.equal(index.isBlockProtected({ worldX: -1, worldY: 255, worldZ: 15 }, "visitor"), true);
  assert.equal(index.isBlockProtected({ worldX: -1, worldY: 10, worldZ: 15 }, "owner"), false);
  assert.equal(index.isBlockProtected({ worldX: 15, worldY: 10, worldZ: 15 }, "visitor"), false);
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

test("two corner taps lock four Chunks and submit exact Chunk-aligned geometry", async () => {
  const index = createFoundationSpatialIndex({ chunkSize: 16 });
  const submitted = [];
  let foundationRefreshes = 0;
  let contractRefreshes = 0;
  const controller = controllerForWorld(flatWorld(), index, {
    getLandContractBalance: () => 4,
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

  assert.equal(controller.selectAtHit(TOP_HIT).stage, "anchor");
  controller.setHoverHit({ ...TOP_HIT, worldX: 20, worldZ: 21 });
  assert.equal(controller.snapshot().locked, false);
  assert.deepEqual(controller.dimensions(), {
    chunksX: 2,
    chunksZ: 2,
    width: 32,
    depth: 32,
    requiredContracts: 4,
  });
  assert.equal(controller.selectAtHit({ ...TOP_HIT, worldX: 20, worldZ: 21 }).stage, "locked");
  assert.equal(controller.snapshot().locked, true);

  const overlay = controller.overlays().at(-1);
  assert.equal(overlay.shape, "foundation");
  assert.equal(overlay.worldX, 0);
  assert.equal(overlay.worldZ, 0);
  assert.equal(overlay.width, 32);
  assert.equal(overlay.depth, 32);
  assert.equal(overlay.terrainColumns, 2);
  assert.equal(overlay.terrainRows, 2);
  assert.deepEqual(overlay.surfaceHeights, [11.035, 11.035, 11.035, 11.035]);
  assert.equal(overlay.xray, true);

  const result = await controller.confirm();
  assert.equal(result.submitted, true);
  assert.deepEqual(submitted, [{ minX: 0, minZ: 0, surfaceY: 11, width: 32, depth: 32 }]);
  assert.equal(index.isBlockProtected({ worldX: 0, worldY: 10, worldZ: 0 }), true);
  assert.equal(foundationRefreshes, 1);
  assert.equal(contractRefreshes, 1);
});

test("registration cannot submit before the opposite corner is locked", async () => {
  let submissions = 0;
  const controller = controllerForWorld(flatWorld(), createFoundationSpatialIndex(), {
    submitFoundation: async () => {
      submissions += 1;
      return { submitted: true };
    },
  });

  controller.selectAtHit(TOP_HIT);
  const result = await controller.confirm();
  assert.deepEqual(result, { submitted: false, reason: "selection-not-locked" });
  assert.equal(submissions, 0);
});

test("side faces, uneven terrain, water, and vegetation all remain selectable", () => {
  const world = flatWorld();
  world.tops.set("0,0", 18);
  world.tops.set("15,15", 24);
  world.waterLevel = 27;
  world.blocks.set("2,26,2", 22);
  const controller = controllerForWorld(world);
  const sideHit = { ...TOP_HIT, faceX: 1, faceY: 0, worldY: 16 };

  const first = controller.selectAtHit(sideHit);
  const second = controller.selectAtHit({ ...sideHit, worldX: 20, worldZ: 20 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.stage, "locked");
  assert.equal(second.preview.valid, true);
  assert.equal(second.preview.maxSurfaceY, 28);
});

test("the anchor terrain height remains the building reference on uneven land", async () => {
  const world = flatWorld();
  world.tops.set("0,0", 10);
  for (let z = 16; z < 32; z += 1) {
    for (let x = 16; x < 32; x += 1) world.tops.set(`${x},${z}`, 50);
  }
  const submitted = [];
  const controller = controllerForWorld(world, createFoundationSpatialIndex(), {
    submitFoundation: async (payload) => {
      submitted.push(payload);
      return { submitted: true, foundation: { ...payload, id: "height", owner: "owner", foundationId: "12" } };
    },
  });
  controller.selectAtHit(TOP_HIT);
  controller.selectAtHit({ ...TOP_HIT, worldX: 20, worldZ: 20, worldY: 50 });
  assert.equal(controller.snapshot().preview.maxSurfaceY, 51);

  await controller.confirm();
  assert.equal(submitted[0].surfaceY, 11);
});

test("exact-size controls lock an accessible selection without a second terrain tap", () => {
  const controller = controllerForWorld(flatWorld());
  controller.setHoverHit({ ...TOP_HIT, worldX: -1, worldZ: -17 });
  controller.setDimensions(2, 3);
  const result = controller.lockDimensions();

  assert.equal(result.ok, true);
  assert.equal(result.stage, "locked");
  assert.equal(controller.snapshot().locked, true);
  assert.deepEqual(controller.dimensions(), {
    chunksX: 2,
    chunksZ: 3,
    width: 32,
    depth: 48,
    requiredContracts: 6,
  });
});

test("insufficient land contracts block submission after a range is locked", async () => {
  let submissions = 0;
  const controller = controllerForWorld(flatWorld(), createFoundationSpatialIndex(), {
    getLandContractBalance: () => 3,
    submitFoundation: async () => {
      submissions += 1;
      return { submitted: true };
    },
  });
  controller.selectAtHit(TOP_HIT);
  controller.selectAtHit({ ...TOP_HIT, worldX: 20, worldZ: 20 });

  const result = await controller.confirm();
  assert.deepEqual(result, {
    submitted: false,
    reason: "insufficient-land-contracts",
    requiredLandContracts: 4,
    availableLandContracts: 3,
  });
  assert.equal(submissions, 0);
});

test("registered-land overlap remains rejected while natural terrain is ignored", () => {
  const index = createFoundationSpatialIndex();
  index.upsert({ id: "owner:1", minX: 16, minZ: 0, surfaceY: 11, width: 16, depth: 16 });
  const controller = controllerForWorld(flatWorld(), index);
  assert.equal(controller.selectAtHit(TOP_HIT).ok, true);

  const selected = controller.selectAtHit({ ...TOP_HIT, worldX: 20, worldZ: 2 });
  assert.equal(selected.ok, false);
  assert.equal(selected.reason, "overlap");
  assert.equal(controller.snapshot().locked, false);
});

test("one land parcel cannot schedule more than 4,096 Chunk registrations", () => {
  const statuses = [];
  const controller = controllerForWorld(flatWorld(), createFoundationSpatialIndex(), {
    onStatus: (message) => statuses.push(message),
  });
  controller.setDimensions(64, 64);
  assert.equal(controller.dimensions().requiredContracts, 4_096);

  controller.setDimensions(65, 64);
  assert.equal(controller.dimensions().requiredContracts, 4_096);
  assert.match(statuses.at(-1), /too many contracts/i);

  controller.selectAtHit(TOP_HIT);
  const tooWide = controller.selectAtHit({ ...TOP_HIT, worldX: 64 * 16, worldZ: 63 * 16 });
  assert.equal(tooWide.ok, false);
  assert.equal(tooWide.reason, "contract-count-too-large");
});

test("large terrain previews keep synchronous height sampling bounded", () => {
  for (const [chunksX, chunksZ] of [[64, 64], [4_096, 1], [1, 4_096], [128, 32]]) {
    const world = flatWorld();
    let terrainQueries = 0;
    world.getOpaqueColumnTopAtWorld = (x, z) => {
      terrainQueries += 1;
      return 10 + Math.abs((x + z) % 5);
    };
    const controller = controllerForWorld(world);

    controller.selectAtHit(TOP_HIT);
    const selected = controller.selectAtHit({
      ...TOP_HIT,
      worldX: (chunksX - 1) * 16,
      worldZ: (chunksZ - 1) * 16,
    });

    assert.equal(selected.ok, true);
    assert.equal(selected.preview.requiredContracts, 4_096);
    assert.equal(controller.overlays().at(-1).surfaceHeights.length, 4_096);
    assert.ok(terrainQueries <= 260, `${chunksX}x${chunksZ} used ${terrainQueries} terrain queries`);
  }
});

function controllerForWorld(world, index = createFoundationSpatialIndex(), overrides = {}) {
  return createFoundationController({
    index,
    getChunks: () => world,
    getPlayerPosition: () => [0, 11, 0],
    isConstructionModeActive: () => true,
    getLandContractBalance: () => 99,
    ...overrides,
  });
}

function flatWorld() {
  const tops = new Map();
  const blocks = new Map();
  return {
    tops,
    blocks,
    waterLevel: null,
    getOpaqueColumnTopAtWorld(x, z) {
      return tops.get(`${x},${z}`) ?? 10;
    },
    getWaterLevelAtWorld() {
      return this.waterLevel;
    },
    getBlockAtWorld(x, y, z) {
      return blocks.get(`${x},${y},${z}`) ?? (y === 10 ? 1 : 0);
    },
  };
}
