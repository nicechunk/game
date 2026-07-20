import assert from "node:assert/strict";
import test from "node:test";

import { ChunkManager } from "../../chunk.js/chunk/chunk-manager.js";
import { BLOCK_ID, blockDef, isFluidBlock, isMineableBlock } from "../../chunk.js/world/block-registry.js";
import { createMiningController } from "../mining-controller.js";
import { reconcilePendingMineWithChainResult } from "../play-chain-mining-result.js";

test("a confirmed 640-block batch becomes air in the real chunk state and remesh", () => {
  const chunks = new ChunkManager({
    worldSeed: "nicechunk-mainnet-001",
    viewDistance: 1,
    height: 160,
    minY: 0,
    useWorkers: false,
  });
  const chunk = chunks.ensureChunk(0, 0);
  chunks.rebuildDirtyChunks(100_000);
  const blocks = collectMineableBlocks(chunks, 640);
  const previousMeshVersion = chunk.meshVersion;
  const gameState = {
    playerProfile: {
      minedBlocks: 0,
      confirmedMines: 0,
      resourcesCollected: 0,
      rolledBackMines: 0,
    },
    savePlayerProfile() {},
  };
  const mining = createMiningController({
    gameState,
    chunks,
    blockDef,
    isFluidBlock,
    isMineableBlock,
    blockAirId: BLOCK_ID.air,
  });

  const pending = mining.queueBatchMine(blocks, { authorization: "debug" });
  const reconciliation = reconcilePendingMineWithChainResult(pending, {
    confirmedBlocks: blocks.map((block) => ({
      x: block.worldX,
      y: block.worldY,
      z: block.worldZ,
      blockId: block.blockId,
      resourceId: block.resourceId,
    })),
    lossyRewards: true,
    storedRewardCount: 0,
    storedRewards: [],
  });
  const confirmed = mining.confirmTx(pending.txId);

  assert.equal(blocks.length, 640);
  assert.equal(reconciliation.confirmedCount, 640);
  assert.equal(confirmed?.minedBlockCount, 640);
  assert.equal(chunk.pendingDeltas.size, 0);
  assert.equal(chunk.chainDeltas.size, 640);
  assert.equal(chunk.unobservedChainDeltaKeys.size, 640);
  assert.equal(chunk.dirty, true);
  assert.ok(blocks.every((block) => chunks.getBlockAtWorld(block.worldX, block.worldY, block.worldZ) === BLOCK_ID.air));

  chunks.rebuildDirtyChunks(100_000);

  assert.equal(chunk.dirty, false);
  assert.ok(chunk.meshVersion > previousMeshVersion);
  assert.equal(chunk.meshVersion, chunk.version);
  assert.ok(blocks.every((block) => chunks.getBlockAtWorld(block.worldX, block.worldY, block.worldZ) === BLOCK_ID.air));
});

function collectMineableBlocks(chunks, count) {
  const blocks = [];
  for (let y = chunks.minY; y < chunks.minY + chunks.height && blocks.length < count; y += 1) {
    for (let z = 0; z < chunks.chunkSize && blocks.length < count; z += 1) {
      for (let x = 0; x < chunks.chunkSize && blocks.length < count; x += 1) {
        const blockId = chunks.getBlockAtWorld(x, y, z);
        const definition = blockDef(blockId);
        if (blockId === BLOCK_ID.air || isFluidBlock(blockId) || !isMineableBlock(blockId) || !definition.hardness) continue;
        blocks.push({
          worldX: x,
          worldY: y,
          worldZ: z,
          blockId,
          resourceId: definition.resourceId,
        });
      }
    }
  }
  assert.equal(blocks.length, count, "the generated test chunk must contain enough mineable blocks");
  return blocks;
}
