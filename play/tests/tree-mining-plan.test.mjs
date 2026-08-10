import assert from "node:assert/strict";
import test from "node:test";

import { BLOCK_ID, blockDef } from "../../chunk.js/play.js";
import { createTreeMiningPlanner } from "../tree-mining-plan.js";

test("a placed trunk always uses the single-block mining path", () => {
  const trunk = block(0, 10, 0, BLOCK_ID.trunk);
  const upperTrunk = block(0, 11, 0, BLOCK_ID.trunk);
  const planner = plannerFor([trunk, upperTrunk], [trunk]);

  assert.equal(planner(trunk), null);
});

test("tree felling never includes an adjacent placed tree block", () => {
  const trunk = block(0, 10, 0, BLOCK_ID.trunk);
  const placedTrunk = block(0, 11, 0, BLOCK_ID.trunk);
  const leaf = block(1, 11, 0, BLOCK_ID.leaves);
  const planner = plannerFor([trunk, placedTrunk, leaf], [placedTrunk]);

  const plan = planner(trunk);

  assert.equal(plan?.kind, "tree-fell");
  assert.ok(plan.blocks.some((entry) => key(entry) === key(leaf)));
  assert.ok(!plan.blocks.some((entry) => key(entry) === key(placedTrunk)));
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
  return createTreeMiningPlanner({ chunks, blockDef, blockAirId: BLOCK_ID.air });
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
