import assert from "node:assert/strict";
import test from "node:test";

import { reconcilePendingMineWithChainResult } from "../play-chain-mining-result.js";
import {
  partitionSupportCollapseBlocks,
  submitSupportCollapseBatches,
} from "../../src/chain/supportCollapseSubmission.js";

test("support collapse transactions never contain more than two terrain proofs", () => {
  const blocks = Array.from({ length: 7 }, (_, index) => ({ x: index, y: 10, z: 0 }));
  assert.deepEqual(partitionSupportCollapseBlocks(blocks).map((batch) => batch.length), [2, 2, 2, 1]);
});

test("an over-budget pair retries as single-block transactions", async () => {
  const blocks = [{ x: 1 }, { x: 2 }, { x: 3 }];
  const calls = [];
  const outcome = await submitSupportCollapseBatches(blocks, async (batch) => {
    calls.push(batch.map((block) => block.x));
    if (batch.length > 1) throw new Error("exceeded CUs meter");
    return { signature: `sig-${batch[0].x}` };
  });

  assert.deepEqual(calls, [[1, 2], [1], [2], [3]]);
  assert.deepEqual(outcome.confirmed.map((entry) => entry.block.x), [1, 2, 3]);
  assert.equal(outcome.failures.length, 0);
  assert.equal(outcome.retryErrors.length, 1);
});

test("two independent retry failures stop a batch-wide RPC failure from fanning out", async () => {
  const blocks = [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }];
  let calls = 0;
  const outcome = await submitSupportCollapseBatches(blocks, async () => {
    calls += 1;
    throw new Error("session expired");
  });

  assert.equal(calls, 3);
  assert.equal(outcome.failures.length, 2);
  assert.deepEqual(outcome.aborted.map((entry) => entry.block.x), [3, 4]);
});

test("local confirmation removes only blocks actually committed on chain", () => {
  const primary = block(10, 20, 30, 4, 40);
  const collapseA = block(10, 21, 30, 5, 50);
  const collapseB = block(10, 22, 30, 6, 60);
  const pending = {
    ...primary,
    txId: "local-pending-1",
    minedBlockCount: 3,
    blocks: [primary, collapseA, collapseB],
    collapseBlocks: [collapseA, collapseB],
    rewardBlocks: [collapseA, collapseB],
    pendingDeltas: [primary, collapseA, collapseB].map((entry) => ({ ...entry, blockId: 0 })),
  };

  const result = reconcilePendingMineWithChainResult(pending, {
    confirmedBlocks: [chainBlock(primary), chainBlock(collapseA)],
    rewardBlocks: [chainBlock(collapseA)],
    partialCollapse: true,
    failedCollapseBlocks: [{ block: chainBlock(collapseB), reason: "already-mined" }],
  });

  assert.equal(result.droppedCount, 1);
  assert.deepEqual(pending.blocks.map(key), [key(primary), key(collapseA)]);
  assert.deepEqual(pending.pendingDeltas.map(key), [key(primary), key(collapseA)]);
  assert.deepEqual(pending.collapseBlocks.map(key), [key(collapseA)]);
  assert.equal(pending.minedBlockCount, 2);
  assert.deepEqual(pending.rewardGroups, [
    { resourceId: 40, blockId: 4, count: 1 },
    { resourceId: 50, blockId: 5, count: 1 },
  ]);
});

test("lossy bulk rewards report only slots actually written to the backpack", () => {
  const first = block(1, 20, 1, 4, 40);
  const second = block(2, 20, 1, 5, 50);
  const pending = {
    ...first,
    txId: "bulk-1",
    miningKind: "debug-bulk",
    lossyRewards: true,
    minedBlockCount: 2,
    blocks: [first, second],
    pendingDeltas: [first, second].map((entry) => ({ ...entry, blockId: 0 })),
    rewardGroups: [],
  };

  const result = reconcilePendingMineWithChainResult(pending, {
    confirmedBlocks: [chainBlock(second)],
    storedRewardCount: 1,
    storedRewards: [{ ...second, count: 1 }],
    lossyRewards: true,
    partialBulkMine: true,
    failedBulkBlocks: [{ block: chainBlock(first), reason: "already-mined" }],
  });

  assert.equal(result.droppedCount, 1);
  assert.deepEqual(pending.blocks.map(key), [key(second)]);
  assert.equal(pending.storedRewardCount, 1);
  assert.deepEqual(pending.rewardGroups, [{ resourceId: 50, blockId: 5, count: 1 }]);
  assert.equal(pending.chainPartialBulkMine, true);
});

test("a full backpack keeps confirmed destruction but creates no local reward", () => {
  const target = block(4, 21, 4, 7, 70);
  const pending = {
    ...target,
    txId: "bulk-full",
    miningKind: "debug-bulk",
    lossyRewards: true,
    minedBlockCount: 1,
    blocks: [target],
    pendingDeltas: [{ ...target, blockId: 0 }],
    rewardGroups: [{ resourceId: 70, blockId: 7, count: 1 }],
  };

  const result = reconcilePendingMineWithChainResult(pending, {
    confirmedBlocks: [chainBlock(target)],
    storedRewardCount: 0,
    storedRewards: [],
    lossyRewards: true,
  });

  assert.equal(result.confirmedCount, 1);
  assert.equal(pending.storedRewardCount, 0);
  assert.deepEqual(pending.rewardGroups, []);
  assert.equal(pending.pendingDeltas.length, 1);
});

function block(worldX, worldY, worldZ, blockId, resourceId) {
  return { worldX, worldY, worldZ, blockId, resourceId };
}

function chainBlock(source) {
  return {
    x: source.worldX,
    y: source.worldY,
    z: source.worldZ,
    blockId: source.blockId,
    resourceId: source.resourceId,
  };
}

function key(entry) {
  return `${entry.worldX},${entry.worldY},${entry.worldZ}`;
}
