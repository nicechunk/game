import assert from "node:assert/strict";
import test from "node:test";

import {
  BULK_MINING_GUARANTEED_DEEP_MAX_Y,
  BULK_MINING_MAX_SELECTION_BLOCKS,
  BULK_MINING_RANGE_MAX_ESTIMATED_WORK,
  encodeBulkMiningRangePayload,
  estimateBulkMiningRangeWork,
  isBulkMiningComputeLimitError,
  partitionBulkMiningBlocks,
  partitionBulkMiningRanges,
  submitBulkMiningBatches,
  submitBulkMiningRanges,
} from "../../src/chain/bulkMiningSubmission.js";

test("640 selected blocks fit one compressed same-chunk range", () => {
  const blocks = [];
  for (let y = BULK_MINING_GUARANTEED_DEEP_MAX_Y - 4; y <= BULK_MINING_GUARANTEED_DEEP_MAX_Y; y += 1) {
    for (let z = 0; z < 8; z += 1) {
      for (let x = 0; x < 16; x += 1) blocks.push(block(x, y, z));
    }
  }
  assert.equal(blocks.length, BULK_MINING_MAX_SELECTION_BLOCKS);

  const ranges = partitionBulkMiningRanges(blocks);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].volume, 640);
  assert.equal(ranges[0].blocks.length, 640);
  const payload = encodeBulkMiningRangePayload(ranges[0]);
  assert.equal(payload.length, 15 + 80 + 1 + 1);
  assert.equal(new DataView(payload.buffer).getUint16(12, true), 5);
  assert.deepEqual([...payload.subarray(95)], [1, 1]);
});

test("non-deep ranges split before their measured compute workload becomes unsafe", () => {
  const blocks = Array.from({ length: 16 }, (_unused, x) => block(
    x,
    BULK_MINING_GUARANTEED_DEEP_MAX_Y + 1,
  ));
  const ranges = partitionBulkMiningRanges(blocks);

  assert.deepEqual(ranges.map((range) => range.blocks.length), [12, 4]);
  assert.ok(ranges.every((range) => (
    estimateBulkMiningRangeWork(range.blocks) <= BULK_MINING_RANGE_MAX_ESTIMATED_WORK
  )));
});

test("deep ranges retain the full 640-block transaction capacity", () => {
  const blocks = [];
  for (let y = -13; y <= BULK_MINING_GUARANTEED_DEEP_MAX_Y; y += 1) {
    for (let z = 0; z < 8; z += 1) {
      for (let x = 0; x < 16; x += 1) blocks.push(block(x, y, z));
    }
  }

  const ranges = partitionBulkMiningRanges(blocks);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].blocks.length, 640);
  assert.ok(estimateBulkMiningRangeWork(ranges[0].blocks) <= BULK_MINING_RANGE_MAX_ESTIMATED_WORK);
});

test("non-deep vertical selections account for both column and per-block work", () => {
  const blocks = [];
  for (let y = -8; y < 16; y += 1) {
    for (let x = 0; x < 8; x += 1) blocks.push(block(x, y));
  }
  assert.equal(blocks.length, 192);

  const ranges = partitionBulkMiningRanges(blocks);
  assert.ok(ranges.length > 1);
  assert.equal(ranges.reduce((count, range) => count + range.blocks.length, 0), blocks.length);
  assert.ok(ranges.every((range) => (
    estimateBulkMiningRangeWork(range.blocks) <= BULK_MINING_RANGE_MAX_ESTIMATED_WORK
  )));
});

test("compressed ranges preserve sparse occupancy and split only at chunk or volume boundaries", () => {
  const ranges = partitionBulkMiningRanges([
    block(0, 8, 0),
    block(15, 8, 15),
    block(16, 8, 0),
  ]);

  assert.deepEqual(ranges.map((range) => [range.chunkX, range.chunkZ, range.blocks.length]), [
    [0, 0, 2],
    [1, 0, 1],
  ]);
  const payload = encodeBulkMiningRangePayload(ranges[0]);
  assert.equal(payload.length, 15 + 32 + 1 + 1);
  assert.equal(payload[15] & 1, 1);
  assert.equal(payload[15 + 31] & 0x80, 0x80);
});

test("ranges split at eight canonical block types and keep palette indexes compact", () => {
  const ranges = partitionBulkMiningRanges(Array.from({ length: 9 }, (_unused, index) => ({
    ...block(index),
    blockId: index + 1,
  })));

  assert.deepEqual(ranges.map((range) => range.blocks.length), [8, 1]);
  const payload = encodeBulkMiningRangePayload(ranges[0]);
  assert.equal(payload[16], 8);
  assert.deepEqual([...payload.subarray(17, 25)], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(payload.length, 15 + 1 + 1 + 8 + 3);
});

test("bulk mining batches never cross chunks or exceed two proofs", () => {
  const batches = partitionBulkMiningBlocks([
    block(-1, 9, 0),
    block(0, 9, 0),
    block(1, 9, 0),
    block(2, 9, 0),
    block(16, 9, 0),
  ]);

  assert.deepEqual(batches.map((batch) => [batch.chunkX, batch.chunkZ, batch.blocks.length]), [
    [-1, 0, 1],
    [0, 0, 2],
    [0, 0, 1],
    [1, 0, 1],
  ]);
  assert.ok(batches.every((batch) => batch.blocks.every((entry) => Math.floor(entry.x / 16) === batch.chunkX)));
});

test("a failed pair retries as single blocks and preserves partial success", async () => {
  const batches = partitionBulkMiningBlocks([block(0), block(1), block(2)]);
  const calls = [];
  const outcome = await submitBulkMiningBatches(batches, async (batch) => {
    calls.push(batch.blocks.map((entry) => entry.x));
    if (batch.blocks.length > 1) throw new Error("compute budget exceeded");
    if (batch.blocks[0].x === 1) throw new Error("already mined");
    return { signature: `sig-${batch.blocks[0].x}` };
  });

  assert.deepEqual(calls, [[0, 1], [0], [1], [2]]);
  assert.deepEqual(outcome.confirmed.map((entry) => entry.block.x), [0, 2]);
  assert.deepEqual(outcome.failures.map((entry) => entry.block.x), [1]);
  assert.equal(outcome.aborted.length, 0);
});

test("range-wide failures stop without expanding into hundreds of single RPC submissions", async () => {
  const ranges = partitionBulkMiningRanges([block(0), block(1), block(16)]);
  let calls = 0;
  const outcome = await submitBulkMiningRanges(ranges, async () => {
    calls += 1;
    throw new Error("RPC unavailable");
  });

  assert.equal(calls, 1);
  assert.equal(outcome.failures.length, 2);
  assert.equal(outcome.aborted.length, 1);
  assert.equal(outcome.retryErrors.length, 1);
});

test("compute-limit failures split only the failed range and preserve one transaction per half", async () => {
  const ranges = partitionBulkMiningRanges([
    block(0, -9),
    block(1, -9),
    block(2, -9),
    block(3, -9),
  ]);
  const calls = [];
  const outcome = await submitBulkMiningRanges(ranges, async (range) => {
    calls.push(range.blocks.length);
    if (range.blocks.length > 2) {
      const error = new Error("Program failed to complete");
      error.logs = ["Program failed: exceeded CUs meter at BPF instruction"];
      throw error;
    }
    return { signature: `sig-${calls.length}` };
  });

  assert.deepEqual(calls, [4, 2, 2]);
  assert.equal(outcome.confirmed.length, 4);
  assert.ok(outcome.confirmed.every((entry) => entry.retried));
  assert.equal(outcome.failures.length, 0);
  assert.equal(outcome.aborted.length, 0);
  assert.equal(outcome.retryErrors.length, 1);
});

test("compute-limit detection does not classify unrelated program failures", () => {
  assert.equal(isBulkMiningComputeLimitError(new Error("RPC unavailable")), false);
  assert.equal(isBulkMiningComputeLimitError({
    message: "Simulation failed",
    logs: ["Program failed: exceeded CUs meter at BPF instruction"],
  }), true);
});

function block(x, y = 8, z = 0) {
  return { x, y, z, blockId: 1, resourceId: 1 };
}
