import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";

import { reconcilePendingMineWithChainResult } from "../play-chain-mining-result.js";
import {
  assertAtomicSupportCollapseTransactionFits,
  createAtomicSupportCollapsePlan,
  submitSupportCollapseAtomically,
} from "../../src/chain/supportCollapseSubmission.js";

test("support collapse keeps primary and cross-chunk ranges in one atomic plan", () => {
  const primary = chainBlock(block(15, -20, 0, 3, 30));
  const collapse = [
    chainBlock(block(15, -19, 0, 3, 30)),
    chainBlock(block(16, -19, 0, 3, 30)),
  ];

  const plan = createAtomicSupportCollapsePlan(primary, collapse);

  assert.equal(plan.blocks.length, 3);
  assert.equal(plan.chunkCount, 2);
  assert.deepEqual(plan.ranges.map((range) => range.mode), [2, 3, 3]);
  assert.deepEqual(plan.ranges.map((range) => [range.chunkX, range.chunkZ]), [[0, 0], [0, 0], [1, 0]]);
  assert.deepEqual(plan.ranges.slice(1).map((range) => range.supportAnchor), [
    { x: 15, y: -20, z: 0 },
    { x: 15, y: -19, z: 0 },
  ]);
});

test("support collapse rejects disconnected blocks instead of authorizing a second mine", () => {
  assert.throws(
    () => createAtomicSupportCollapsePlan(
      { x: 0, y: -20, z: 0, blockId: 3 },
      [{ x: 4, y: -20, z: 0, blockId: 3 }],
    ),
    /one face-connected structure/,
  );
});

test("support collapse submits exactly once and confirms every planned block", async () => {
  const primary = { x: 1, y: -20, z: 0, blockId: 3 };
  const collapse = [{ x: 1, y: -19, z: 0, blockId: 3 }, { x: 1, y: -18, z: 0, blockId: 3 }];
  const plan = createAtomicSupportCollapsePlan(primary, collapse);
  let calls = 0;

  const outcome = await submitSupportCollapseAtomically(plan, async (ranges) => {
    calls += 1;
    assert.equal(ranges, plan.ranges);
    return { signature: "atomic-signature" };
  });

  assert.equal(calls, 1);
  assert.equal(outcome.result.signature, "atomic-signature");
  assert.deepEqual(outcome.confirmedBlocks, plan.blocks);
});

test("an atomic submission failure is never retried or reduced", async () => {
  const plan = createAtomicSupportCollapsePlan(
    { x: 1, y: -20, z: 0, blockId: 3 },
    [{ x: 1, y: -19, z: 0, blockId: 3 }],
  );
  let calls = 0;

  await assert.rejects(() => submitSupportCollapseAtomically(plan, async () => {
    calls += 1;
    throw new Error("compute budget exceeded");
  }), /compute budget exceeded/);

  assert.equal(calls, 1);
});

test("capacity failures reject the complete collapse instead of truncating it", () => {
  const primary = { x: 0, y: -20, z: 0, blockId: 3 };
  const collapse = Array.from({ length: 4 }, (_unused, index) => ({
    x: 0,
    y: -19 + index,
    z: 0,
    blockId: 3,
  }));

  assert.throws(
    () => createAtomicSupportCollapsePlan(primary, collapse, { maxBlocks: 4 }),
    (error) => error?.reason === "block-limit" && error?.blockCount === 5,
  );
  assert.throws(
    () => createAtomicSupportCollapsePlan(primary, collapse, { maxEstimatedWork: 1 }),
    (error) => error?.reason === "compute-limit",
  );
  assert.throws(
    () => createAtomicSupportCollapsePlan(
      { x: 0, y: -20, z: 0, blockId: 3 },
      Array.from({ length: 48 }, (_unused, index) => ({
        x: index + 1,
        y: -20,
        z: 0,
        blockId: 3,
      })),
    ),
    (error) => error?.reason === "chunk-limit" && error?.chunkCount === 4 && error?.limit === 3,
  );
});

test("packet validation rejects an oversized atomic transaction before signing", () => {
  const feePayer = Keypair.generate().publicKey;
  const transaction = new Transaction().add(new TransactionInstruction({
    programId: Keypair.generate().publicKey,
    keys: [{ pubkey: feePayer, isSigner: true, isWritable: true }],
    data: Buffer.alloc(1_200),
  }));

  assert.throws(
    () => assertAtomicSupportCollapseTransactionFits(transaction, { feePayer }),
    (error) => error?.reason === "packet-limit" && error?.limit === 1232,
  );
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
