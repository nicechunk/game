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
const BLUEPRINT = Object.freeze({
  slot: { itemId: "blueprint_tool", blueprintId: "10", blueprintOrdinal: 1 },
  index: 1,
});

test("blueprint footprints expand away from the player across negative coordinates", () => {
  assert.deepEqual(footprintForHit(
    { ...TOP_HIT, worldX: -1, worldZ: -17 },
    2,
    3,
    [0, 0, 0],
  ), {
    minX: -2,
    minZ: -19,
    maxX: -1,
    maxZ: -17,
    width: 2,
    depth: 3,
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

test("foundation outlines are submitted only while the blueprint tool is active", () => {
  const index = createFoundationSpatialIndex();
  index.upsert({
    id: "owner:10",
    owner: "owner",
    foundationId: "10",
    minX: 1,
    minZ: 2,
    surfaceY: 11,
    width: 12,
    depth: 8,
  });
  let blueprintModeActive = false;
  const controller = createFoundationController({
    index,
    getPlayerPosition: () => [0, 11, 0],
    getSelectedBlueprint: () => null,
    isBlueprintModeActive: () => blueprintModeActive,
  });

  assert.deepEqual(controller.overlays(), []);
  blueprintModeActive = true;
  assert.equal(controller.overlays().length, 1, "building edit mode should retain the foundation outline");
});

test("blueprint validates level clearance before submitting authoritative PDA state", async () => {
  const index = createFoundationSpatialIndex({ chunkSize: 16 });
  const submitted = [];
  const world = flatWorld();
  const controller = createFoundationController({
    index,
    getChunks: () => world,
    getPlayerPosition: () => [0, 11, 0],
    getSelectedBlueprint: () => BLUEPRINT,
    isBlockingBlock: (blockId) => blockId === 1,
    isFluidBlock: (blockId) => blockId === 17,
    submitFoundation: async (payload) => {
      submitted.push(payload);
      return {
        submitted: true,
        foundation: { id: "owner:10", owner: "owner", foundationId: "10", ...payload },
      };
    },
  });
  controller.setDimensions(2, 2);
  const selected = controller.selectAtHit(TOP_HIT);

  assert.equal(selected.ok, true);
  assert.equal(selected.preview.valid, true);
  assert.deepEqual(controller.overlays().at(-1), {
    shape: "foundation",
    worldX: 1,
    worldY: 11.018,
    worldZ: 2,
    width: 2,
    depth: 2,
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
  assert.deepEqual(submitted, [{ blueprintId: "10", minX: 1, minZ: 2, surfaceY: 11, width: 2, depth: 2 }]);
  assert.equal(index.isBlockProtected({ x: 1, y: 10, z: 2 }), true);
});

test("confirm locks and submits the current valid hologram without a second ground click", async () => {
  const submissions = [];
  const chunks = flatWorld();
  const index = createFoundationSpatialIndex({ chunkSize: 16 });
  const controller = createFoundationController({
    index,
    getChunks: () => chunks,
    getPlayerPosition: () => [0, 11, 0],
    getSelectedBlueprint: () => ({ slot: { ...BLUEPRINT.slot, blueprintId: "11" }, index: 1 }),
    isBlockingBlock: (blockId) => blockId === 1,
    isFluidBlock: () => false,
    submitFoundation: async (foundation) => {
      submissions.push(foundation);
      return { submitted: true, foundation: { ...foundation, id: "auto-anchor", owner: "owner", foundationId: "11" } };
    },
  });

  controller.setDimensions(2, 2);
  controller.setHoverHit({ ...TOP_HIT, worldX: 3, worldZ: 3 });
  assert.equal(controller.snapshot().anchored, false);
  assert.equal(controller.snapshot().preview?.valid, true);

  const result = await controller.confirm();
  assert.equal(result.submitted, true);
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0], { blueprintId: "11", minX: 3, minZ: 3, surfaceY: 11, width: 2, depth: 2 });
});

test("a blueprint with an existing foundation edits its size without moving its anchor", async () => {
  const index = createFoundationSpatialIndex();
  index.upsert({
    id: "owner:10",
    owner: "owner",
    foundationId: "10",
    minX: 1,
    minZ: 2,
    surfaceY: 11,
    width: 2,
    depth: 2,
  });
  let createSubmissions = 0;
  const resizeSubmissions = [];
  const controller = createFoundationController({
    index,
    getWalletAddress: () => "owner",
    getSelectedBlueprint: () => BLUEPRINT,
    getChunks: () => flatWorld(),
    isBlockingBlock: (blockId) => blockId === 1,
    submitFoundation: async () => {
      createSubmissions += 1;
      return { submitted: true };
    },
    submitFoundationResize: async (payload) => {
      resizeSubmissions.push(payload);
      return {
        submitted: true,
        foundation: { id: "owner:10", owner: "owner", foundationId: "10", ...payload },
      };
    },
  });

  assert.equal(controller.snapshot().foundationBound, true);
  assert.deepEqual(controller.dimensions(), { width: 2, depth: 2 });
  assert.equal(controller.snapshot().width, 2);
  assert.equal(controller.snapshot().depth, 2);
  controller.setDimensions(3, 4);
  assert.deepEqual(controller.dimensions(), { width: 3, depth: 4 });
  assert.equal(controller.snapshot().dimensionsDirty, true);
  assert.equal(controller.selectAtHit(TOP_HIT).editing, true);
  assert.equal((await controller.confirm()).submitted, true);
  assert.deepEqual(resizeSubmissions, [{ blueprintId: "10", minX: 1, minZ: 2, surfaceY: 11, width: 3, depth: 4 }]);
  assert.equal(createSubmissions, 0);
  assert.deepEqual(controller.dimensions(), { width: 3, depth: 4 });
});

test("foundation dimensions are isolated per blueprint instance", () => {
  let selected = BLUEPRINT;
  const controller = createFoundationController({
    getSelectedBlueprint: () => selected,
  });
  controller.setDimensions(20, 21);
  selected = { slot: { ...BLUEPRINT.slot, blueprintId: "12", blueprintOrdinal: 2 }, index: 2 };
  assert.deepEqual(controller.dimensions(), { width: 12, depth: 8 });
  controller.setDimensions(30, 31);
  selected = BLUEPRINT;
  assert.deepEqual(controller.dimensions(), { width: 20, depth: 21 });
});

test("blueprint rejects uneven ground, fluids, obstructions, and existing foundations", () => {
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
    const controller = controllerForWorld(world);
    controller.setDimensions(2, 2);
    const selected = controller.selectAtHit(TOP_HIT);
    assert.equal(selected.ok, false, reason);
    assert.equal(selected.preview.reason, reason);
  }

  const index = createFoundationSpatialIndex();
  index.upsert({ id: "owner:1", minX: 2, minZ: 3, surfaceY: 11, width: 2, depth: 2 });
  const controller = controllerForWorld(flatWorld(), index);
  controller.setDimensions(2, 2);
  const selected = controller.selectAtHit(TOP_HIT);
  assert.equal(selected.ok, false);
  assert.equal(selected.preview.reason, "overlap");
});

function controllerForWorld(world, index = createFoundationSpatialIndex()) {
  return createFoundationController({
    index,
    getChunks: () => world,
    getPlayerPosition: () => [0, 11, 0],
    getSelectedBlueprint: () => BLUEPRINT,
    isBlockingBlock: (blockId) => blockId === 1 || blockId === 17,
    isFluidBlock: (blockId) => blockId === 17,
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
