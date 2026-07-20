import { BLOCK_ID, worldToChunk } from "/chunk.js/play.js";

const DEFAULT_MAX_TREE_BLOCKS = 96;
const MAX_TRUNK_SCAN = 16;
const LEAF_RADIUS = 2;
const EXTRA_LEAF_Y = 3;

export function createTreeMiningPlanner({
  chunks,
  blockDef,
  maxTreeBlocks = DEFAULT_MAX_TREE_BLOCKS,
} = {}) {
  return function treeMiningPlanForHit(hit) {
    const primary = normalizeHit(hit, chunks, blockDef);
    if (!primary || !isTreeTrunkBlockId(primary.blockId)) return null;
    const x = primary.worldX;
    const z = primary.worldZ;
    const trunkBlockId = primary.blockId;
    const baseY = findTrunkBaseY(chunks, x, primary.worldY, z, trunkBlockId);
    const topY = findTrunkTopY(chunks, x, primary.worldY, z, trunkBlockId);
    if (!Number.isFinite(baseY) || !Number.isFinite(topY) || topY < baseY) return null;

    const blocks = collectTreeBlocks(chunks, blockDef, {
      x,
      z,
      baseY,
      topY,
      trunkBlockId,
      maxTreeBlocks,
    });
    if (blocks.length <= 1) return null;
    const rewardBlocks = selectTreeRewardBlocks(blocks, trunkBlockId);
    return {
      kind: "tree-fell",
      blocks,
      rewardBlocks,
      requiredDamage: 3,
    };
  };
}

export function selectTreeRewardBlocks(blocks = [], trunkBlockId = BLOCK_ID.trunk) {
  const rewards = [];
  let leafCount = 0;
  for (const block of blocks) {
    if (block.blockId === trunkBlockId) {
      rewards.push(block);
      continue;
    }
    if (!isSameTreeBlock(block.blockId, trunkBlockId)) continue;
    leafCount += 1;
    if (leafCount % 5 === 0) rewards.push(block);
  }
  return rewards;
}

function collectTreeBlocks(chunks, blockDef, { x, z, baseY, topY, trunkBlockId, maxTreeBlocks }) {
  const blocks = [];
  const seen = new Set();
  for (let y = baseY; y <= topY; y += 1) {
    pushTreeBlock(blocks, seen, chunks, blockDef, x, y, z, trunkBlockId);
  }
  const minY = baseY;
  const maxY = topY + EXTRA_LEAF_Y;
  const maxCount = Math.max(1, Math.trunc(maxTreeBlocks || DEFAULT_MAX_TREE_BLOCKS));
  for (let y = minY; y <= maxY && blocks.length < maxCount; y += 1) {
    for (let dz = -LEAF_RADIUS; dz <= LEAF_RADIUS && blocks.length < maxCount; dz += 1) {
      for (let dx = -LEAF_RADIUS; dx <= LEAF_RADIUS && blocks.length < maxCount; dx += 1) {
        if (dx === 0 && dz === 0 && y <= topY) continue;
        pushTreeBlock(blocks, seen, chunks, blockDef, x + dx, y, z + dz, trunkBlockId);
      }
    }
  }
  return blocks.sort((a, b) => (a.worldY - b.worldY) || (a.worldX - b.worldX) || (a.worldZ - b.worldZ));
}

function pushTreeBlock(blocks, seen, chunks, blockDef, worldX, worldY, worldZ, trunkBlockId) {
  const blockId = Math.trunc(Number(chunks?.getBlockAtWorld?.(worldX, worldY, worldZ)) || BLOCK_ID.air);
  if (!isSameTreeBlock(blockId, trunkBlockId)) return false;
  const key = `${Math.trunc(worldX)},${Math.trunc(worldY)},${Math.trunc(worldZ)}`;
  if (seen.has(key)) return false;
  seen.add(key);
  const coord = worldToChunk(worldX, worldY, worldZ, chunks?.chunkSize || 16);
  const def = blockDef?.(blockId) ?? {};
  blocks.push({
    hit: true,
    worldX: coord.worldX,
    worldY: coord.worldY,
    worldZ: coord.worldZ,
    chunkX: coord.chunkX,
    chunkZ: coord.chunkZ,
    chunkId: coord.chunkId,
    localX: coord.localX,
    localY: coord.localY,
    localZ: coord.localZ,
    blockId,
    resourceId: Math.trunc(Number(def.resourceId) || 0),
    materialId: Math.trunc(Number(def.materialId) || 0),
    faceX: 0,
    faceY: 0,
    faceZ: 1,
  });
  return true;
}

function findTrunkBaseY(chunks, x, y, z, trunkBlockId) {
  let current = Math.trunc(y);
  for (let step = 0; step < MAX_TRUNK_SCAN; step += 1) {
    const below = Math.trunc(Number(chunks?.getBlockAtWorld?.(x, current - 1, z)) || BLOCK_ID.air);
    if (below !== trunkBlockId) break;
    current -= 1;
  }
  return current;
}

function findTrunkTopY(chunks, x, y, z, trunkBlockId) {
  let current = Math.trunc(y);
  for (let step = 0; step < MAX_TRUNK_SCAN; step += 1) {
    const above = Math.trunc(Number(chunks?.getBlockAtWorld?.(x, current + 1, z)) || BLOCK_ID.air);
    if (above !== trunkBlockId) break;
    current += 1;
  }
  return current;
}

function normalizeHit(hit, chunks, blockDef) {
  if (!hit?.hit) return null;
  const worldX = Math.trunc(Number(hit.worldX));
  const worldY = Math.trunc(Number(hit.worldY));
  const worldZ = Math.trunc(Number(hit.worldZ));
  const blockId = Math.trunc(Number(hit.blockId));
  if (![worldX, worldY, worldZ, blockId].every(Number.isFinite)) return null;
  const coord = worldToChunk(worldX, worldY, worldZ, chunks?.chunkSize || 16);
  const def = blockDef?.(blockId) ?? {};
  return {
    hit: true,
    worldX,
    worldY,
    worldZ,
    chunkX: coord.chunkX,
    chunkZ: coord.chunkZ,
    chunkId: coord.chunkId,
    localX: coord.localX,
    localY: coord.localY,
    localZ: coord.localZ,
    blockId,
    resourceId: Math.trunc(Number(hit.resourceId ?? def.resourceId) || 0),
    materialId: Math.trunc(Number(hit.materialId ?? def.materialId) || 0),
    faceX: Math.trunc(Number(hit.faceX) || 0),
    faceY: Math.trunc(Number(hit.faceY) || 0),
    faceZ: Math.trunc(Number(hit.faceZ) || 1),
  };
}

function isTreeTrunkBlockId(blockId) {
  return blockId === BLOCK_ID.trunk || blockId === BLOCK_ID.pineTrunk;
}

function isSameTreeBlock(blockId, trunkBlockId) {
  if (trunkBlockId === BLOCK_ID.pineTrunk) return blockId === BLOCK_ID.pineTrunk || blockId === BLOCK_ID.pineLeaves;
  return blockId === BLOCK_ID.trunk || blockId === BLOCK_ID.leaves;
}
