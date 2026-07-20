import assert from "node:assert/strict";
import test from "node:test";

import {
  BULK_MINING_MAX_SELECTION_BLOCKS,
  encodeBulkMiningRangePayload,
  partitionBulkMiningBlocks,
  partitionBulkMiningRanges,
  submitBulkMiningBatches,
  submitBulkMiningRanges,
} from "../../src/chain/bulkMiningSubmission.js";

test("640 selected blocks fit one compressed same-chunk range", () => {
  const blocks = [];
  for (let y = 20; y < 25; y += 1) {
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
  assert.equal(payload.length, 15 + 80 + 480);
  assert.equal(new DataView(payload.buffer).getUint16(12, true), 5);
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
  assert.equal(payload.length, 15 + 32 + 2);
  assert.equal(payload[15] & 1, 1);
  assert.equal(payload[15 + 31] & 0x80, 0x80);
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

function block(x, y = 8, z = 0) {
  return { x, y, z, blockId: 1, resourceId: 1 };
}
