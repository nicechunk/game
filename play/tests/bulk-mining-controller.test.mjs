import assert from "node:assert/strict";
import test from "node:test";

import {
  BULK_MINING_MAX_SELECTION_BLOCKS,
  createBulkMiningController,
} from "../bulk-mining-controller.js";
import { BULK_MINING_MAX_SELECTION_BLOCKS as CHAIN_BULK_MINING_MAX_SELECTION_BLOCKS } from "../../src/chain/bulkMiningSubmission.js";

test("bulk mining exposes one 640-block selection limit to UI and chain submission", () => {
  const controller = createBulkMiningController();

  assert.equal(BULK_MINING_MAX_SELECTION_BLOCKS, 640);
  assert.equal(CHAIN_BULK_MINING_MAX_SELECTION_BLOCKS, 640);
  assert.equal(controller.snapshot().maxBlocks, 640);
});

test("a bulk selection touching protected land rejects the entire submission", () => {
  const submitted = [];
  const blocks = new Map([
    ["0,10,0", 1],
    ["1,10,0", 1],
    ["0,10,1", 1],
    ["1,10,1", 1],
  ]);
  const controller = createBulkMiningController({
    chunks: chunkStore(blocks),
    blockDef: (blockId) => ({ hardness: blockId ? 1 : 0, resourceId: blockId * 10, materialId: blockId }),
    isFluidBlock: () => false,
    isMineableBlock: (blockId) => blockId > 0,
    isBlockProtected: (block) => block.worldX === 1 && block.worldZ === 0,
    submitBlocks(selected, options) {
      submitted.push({ selected, options });
      return { txId: "bulk-1" };
    },
  });

  controller.setEnabled(true, { quiet: true });
  controller.selectAtHit(hit(0, 10, 0));
  controller.selectAtHit(hit(1, 10, 1));

  const ready = controller.snapshot();
  assert.equal(ready.phase, "ready");
  assert.equal(ready.count, 3);
  assert.equal(ready.protectedCount, 1);
  assert.equal(ready.canConfirm, false);
  assert.equal(controller.overlays()[0].sizeX, 2);
  assert.equal(controller.overlays()[0].sizeY, 1);
  assert.equal(controller.overlays()[0].sizeZ, 2);

  assert.equal(controller.confirm(), null);
  assert.equal(submitted.length, 0);
  assert.equal(controller.snapshot().phase, "ready");
});

test("a protected first corner is rejected before a bulk selection starts", () => {
  const statuses = [];
  const controller = createBulkMiningController({
    chunks: chunkStore(new Map([["0,10,0", 1]])),
    blockDef: () => ({ hardness: 1, resourceId: 10, materialId: 1 }),
    isFluidBlock: () => false,
    isMineableBlock: () => true,
    isBlockProtected: () => true,
    onStatus: (message) => statuses.push(message),
  });

  controller.setEnabled(true, { quiet: true });
  assert.equal(controller.selectAtHit(hit(0, 10, 0)), null);
  assert.equal(controller.snapshot().phase, "idle");
  assert.match(statuses.at(-1), /protected/i);
});

test("selection over the debug limit cannot be submitted", () => {
  let submissions = 0;
  const blocks = new Map();
  for (let x = 0; x < 3; x += 1) {
    for (let z = 0; z < 3; z += 1) blocks.set(`${x},10,${z}`, 1);
  }
  const controller = createBulkMiningController({
    chunks: chunkStore(blocks),
    blockDef: () => ({ hardness: 1, resourceId: 10, materialId: 1 }),
    isFluidBlock: () => false,
    isMineableBlock: () => true,
    maxSelectionBlocks: 4,
    submitBlocks() {
      submissions += 1;
      return {};
    },
  });

  controller.setEnabled(true, { quiet: true });
  controller.selectAtHit(hit(0, 10, 0));
  controller.selectAtHit(hit(2, 10, 2));

  assert.equal(controller.snapshot().overflow, true);
  assert.equal(controller.snapshot().canConfirm, false);
  assert.equal(controller.confirm(), null);
  assert.equal(submissions, 0);
});

function chunkStore(blocks) {
  return {
    chunkSize: 16,
    getBlockAtWorld(x, y, z) {
      return blocks.get(`${x},${y},${z}`) ?? 0;
    },
  };
}

function hit(worldX, worldY, worldZ) {
  return { hit: true, worldX, worldY, worldZ };
}
