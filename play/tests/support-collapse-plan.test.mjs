import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOCK_ID,
  blockDef,
  isFluidBlock,
  isMineableBlock,
} from "../../chunk.js/play.js";
import { createSupportCollapseMiningPlanner } from "../support-collapse-plan.js";

test("mining grass never collects an unrelated isolated tree leaf", () => {
  const primary = block(0, 10, 0, BLOCK_ID.grass);
  const unrelatedLeaf = block(3, 13, 0, BLOCK_ID.leaves);
  const planner = plannerFor([primary, unrelatedLeaf]);

  assert.equal(planner(primary), null);
});

test("support collapse starts only from blocks touching the mined block", () => {
  const primary = block(0, 10, 0, BLOCK_ID.grass);
  const trunk = block(0, 11, 0, BLOCK_ID.trunk);
  const connectedLeaf = block(0, 12, 0, BLOCK_ID.leaves);
  const unrelatedLeaf = block(3, 13, 0, BLOCK_ID.leaves);
  const planner = plannerFor([primary, trunk, connectedLeaf, unrelatedLeaf]);

  const plan = planner(primary);

  assert.equal(plan?.kind, "support-collapse");
  assert.deepEqual(plan.blocks.map(key), [key(primary), key(trunk), key(connectedLeaf)]);
  assert.ok(!plan.blocks.some((entry) => key(entry) === key(unrelatedLeaf)));
});

test("a placed primary block never enters support-collapse mining", () => {
  const primary = block(0, 10, 0, BLOCK_ID.grass);
  const trunk = block(0, 11, 0, BLOCK_ID.trunk);
  const planner = plannerFor([primary, trunk], [primary]);

  assert.equal(planner(primary), null);
});

test("a placed block remains in the world while unsupported natural blocks collapse", () => {
  const primary = block(0, 10, 0, BLOCK_ID.grass);
  const trunk = block(0, 11, 0, BLOCK_ID.trunk);
  const placedLeaf = block(0, 12, 0, BLOCK_ID.leaves);
  const planner = plannerFor([primary, trunk, placedLeaf], [placedLeaf]);

  const plan = planner(primary);

  assert.deepEqual(plan?.collapseBlocks.map(key), [key(trunk)]);
  assert.ok(!plan.blocks.some((entry) => key(entry) === key(placedLeaf)));
});

test("loose resources collapse as one complete vertical chain", () => {
  const primary = block(0, 10, 0, BLOCK_ID.dirt);
  const gravel = [
    block(0, 11, 0, BLOCK_ID.gravel),
    block(0, 12, 0, BLOCK_ID.gravel),
    block(0, 13, 0, BLOCK_ID.gravel),
  ];
  const planner = plannerFor([primary, ...gravel]);

  const plan = planner(primary);

  assert.deepEqual(plan?.collapseBlocks.map(key), gravel.map(key));
});

test("rock carries a four-block cantilever but not a fifth block", () => {
  const primary = block(0, 9, 0, BLOCK_ID.dirt);
  const bridge = Array.from({ length: 6 }, (_unused, x) => block(x, 10, 0, BLOCK_ID.stone));
  const pillar = block(5, 9, 0, BLOCK_ID.stone);
  const planner = plannerFor([primary, ...bridge, pillar]);

  const plan = planner(primary);

  assert.deepEqual(plan?.collapseBlocks.map(key), [key(bridge[0])]);
});

test("basalt carries farther than soil", () => {
  const basaltPrimary = block(0, 9, 0, BLOCK_ID.dirt);
  const basaltBridge = Array.from({ length: 6 }, (_unused, x) => block(x, 10, 0, BLOCK_ID.basalt));
  const basaltPillar = block(5, 9, 0, BLOCK_ID.basalt);
  const basaltPlan = plannerFor([basaltPrimary, ...basaltBridge, basaltPillar])(basaltPrimary);
  assert.equal(basaltPlan, null);

  const soilPrimary = block(0, 9, 0, BLOCK_ID.stone);
  const soilBridge = Array.from({ length: 3 }, (_unused, x) => block(x, 10, 0, BLOCK_ID.dirt));
  const soilPillar = block(2, 9, 0, BLOCK_ID.dirt);
  const soilPlan = plannerFor([soilPrimary, ...soilBridge, soilPillar])(soilPrimary);
  assert.deepEqual(soilPlan?.collapseBlocks.map(key), [key(soilBridge[0])]);
});

test("an oversized connected collapse is blocked instead of truncated", () => {
  const primary = block(0, 10, 0, BLOCK_ID.dirt);
  const gravel = Array.from({ length: 5 }, (_unused, index) => (
    block(0, 11 + index, 0, BLOCK_ID.gravel)
  ));
  const planner = plannerFor([primary, ...gravel], [], { maxBlocks: 4 });

  const plan = planner(primary);

  assert.equal(plan?.kind, "support-collapse-blocked");
  assert.equal(plan?.blockedReason, "block-limit");
  assert.equal(plan?.blockedLimit, 4);
  assert.deepEqual(plan?.blocks.map(key), [key(primary)]);
});

function plannerFor(blocks, placedBlocks = [], options = {}) {
  const byPosition = new Map(blocks.map((entry) => [key(entry), entry.blockId]));
  const placed = new Set(placedBlocks.map(key));
  const chunks = {
    chunkSize: 16,
    getBlockAtWorld(worldX, worldY, worldZ) {
      return byPosition.get(`${worldX},${worldY},${worldZ}`) ?? BLOCK_ID.air;
    },
    getDeltaAtWorld(worldX, worldY, worldZ) {
      const position = `${worldX},${worldY},${worldZ}`;
      return placed.has(position) ? byPosition.get(position) : null;
    },
  };
  return createSupportCollapseMiningPlanner({
    chunks,
    blockDef,
    isFluidBlock,
    isMineableBlock,
    blockAirId: BLOCK_ID.air,
    ...options,
  });
}

function block(worldX, worldY, worldZ, blockId) {
  const def = blockDef(blockId);
  return {
    hit: true,
    worldX,
    worldY,
    worldZ,
    blockId,
    resourceId: def.resourceId,
    materialId: def.materialId,
  };
}

function key(entry) {
  return `${entry.worldX},${entry.worldY},${entry.worldZ}`;
}
