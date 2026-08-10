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

test("placed blocks anchor natural support components instead of collapsing", () => {
  const primary = block(0, 10, 0, BLOCK_ID.grass);
  const trunk = block(0, 11, 0, BLOCK_ID.trunk);
  const placedLeaf = block(0, 12, 0, BLOCK_ID.leaves);
  const planner = plannerFor([primary, trunk, placedLeaf], [placedLeaf]);

  assert.equal(planner(primary), null);
});

function plannerFor(blocks, placedBlocks = []) {
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
