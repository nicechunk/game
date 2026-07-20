import { BLOCK_FLAGS, BLOCK_ID, worldToChunk } from "../chunk.js/play.js";

const DEFAULT_HORIZONTAL_RADIUS = 7;
const DEFAULT_DOWN_REACH = 8;
const DEFAULT_UP_REACH = 20;
const DEFAULT_MAX_BLOCKS = 48;
const DEFAULT_REWARD_NUMERATOR = 3;
const DEFAULT_REWARD_DENOMINATOR = 10;

const FACE_OFFSETS = Object.freeze([
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]);

export function createSupportCollapseMiningPlanner({
  chunks,
  blockDef,
  isFluidBlock,
  isMineableBlock,
  blockAirId = BLOCK_ID.air,
  minWorldY = -32,
  horizontalRadius = DEFAULT_HORIZONTAL_RADIUS,
  downReach = DEFAULT_DOWN_REACH,
  upReach = DEFAULT_UP_REACH,
  maxBlocks = DEFAULT_MAX_BLOCKS,
} = {}) {
  const limit = Math.max(1, Math.trunc(maxBlocks || DEFAULT_MAX_BLOCKS));
  return function supportCollapsePlanForHit(hit) {
    const primary = normalizeBlock(hit, chunks, blockDef);
    if (!primary || !isSupportCandidateBlock(primary.blockId, blockDef, isFluidBlock, isMineableBlock, blockAirId)) return null;

    const collapseBlocks = collectSupportCollapseBlocks(primary, {
      chunks,
      blockDef,
      isFluidBlock,
      isMineableBlock,
      blockAirId,
      minWorldY,
      horizontalRadius,
      downReach,
      upReach,
      maxBlocks: limit,
    });
    if (!collapseBlocks.length) return null;
    return {
      kind: "support-collapse",
      blocks: [primary, ...collapseBlocks],
      collapseBlocks,
      rewardBlocks: selectSupportCollapseRewardBlocks(collapseBlocks),
      requiredDamage: 3,
    };
  };
}

function collectSupportCollapseBlocks(originBlock, options) {
  const plannedRemoved = new Set([blockKey(originBlock)]);
  const collapsed = [];
  const bounds = supportCollapseBounds(originBlock, options);
  let changed = true;
  while (changed && collapsed.length < options.maxBlocks) {
    changed = false;
    const starts = supportCollapseCandidateStarts(plannedRemoved, bounds, options);
    const scanned = new Set();
    for (const start of starts) {
      if (scanned.has(blockKey(start)) || plannedRemoved.has(blockKey(start))) continue;
      const component = traceSupportComponent(start, plannedRemoved, bounds, scanned, options);
      if (!component.blocks.length || component.supported) continue;
      for (const block of component.blocks) {
        const key = blockKey(block);
        if (plannedRemoved.has(key)) continue;
        plannedRemoved.add(key);
        collapsed.push(block);
        changed = true;
        if (collapsed.length >= options.maxBlocks) break;
      }
      if (collapsed.length >= options.maxBlocks) break;
    }
  }
  return collapsed;
}

function supportCollapseBounds(originBlock, options) {
  return {
    minX: originBlock.worldX - options.horizontalRadius,
    maxX: originBlock.worldX + options.horizontalRadius,
    minY: originBlock.worldY - options.downReach,
    maxY: originBlock.worldY + options.upReach,
    minZ: originBlock.worldZ - options.horizontalRadius,
    maxZ: originBlock.worldZ + options.horizontalRadius,
  };
}

function supportCollapseCandidateStarts(plannedRemoved, bounds, options) {
  const starts = [];
  const seen = new Set();
  for (const removedKey of plannedRemoved) {
    const removed = worldPositionFromKey(removedKey);
    if (!removed) continue;
    for (const [dx, dy, dz] of FACE_OFFSETS) {
      const block = supportCollapseBlockAt(
        removed.worldX + dx,
        removed.worldY + dy,
        removed.worldZ + dz,
        plannedRemoved,
        bounds,
        options,
      );
      if (!block) continue;
      const key = blockKey(block);
      if (seen.has(key)) continue;
      seen.add(key);
      starts.push(block);
    }
  }
  return starts;
}

function traceSupportComponent(start, plannedRemoved, bounds, scanned, options) {
  const queue = [start];
  const blocks = [];
  const local = new Set([blockKey(start)]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const block = queue[cursor];
    const key = blockKey(block);
    scanned.add(key);
    blocks.push(block);
    if (isSupportAnchoredBlock(block, options)) return { blocks: [], supported: true };

    for (const [dx, dy, dz] of FACE_OFFSETS) {
      const nx = block.worldX + dx;
      const ny = block.worldY + dy;
      const nz = block.worldZ + dz;
      if (!isWithinBounds(nx, ny, nz, bounds)) {
        return { blocks: [], supported: true };
      }
      const next = supportCollapseBlockAt(nx, ny, nz, plannedRemoved, bounds, options);
      if (!next) {
        if (isSupportAnchorCell(nx, ny, nz, plannedRemoved, options)) return { blocks: [], supported: true };
        continue;
      }
      const nextKey = blockKey(next);
      if (local.has(nextKey)) continue;
      local.add(nextKey);
      queue.push(next);
    }
  }
  return { blocks, supported: false };
}

function supportCollapseBlockAt(worldX, worldY, worldZ, plannedRemoved, bounds, options) {
  if (!isWithinBounds(worldX, worldY, worldZ, bounds)) return null;
  const key = `${Math.trunc(worldX)},${Math.trunc(worldY)},${Math.trunc(worldZ)}`;
  if (plannedRemoved.has(key)) return null;
  const blockId = Math.trunc(Number(options.chunks?.getBlockAtWorld?.(worldX, worldY, worldZ)) || options.blockAirId);
  if (!isSupportCandidateBlock(blockId, options.blockDef, options.isFluidBlock, options.isMineableBlock, options.blockAirId)) return null;
  return blockFromWorld(options.chunks, options.blockDef, worldX, worldY, worldZ, blockId);
}

function isSupportAnchorCell(worldX, worldY, worldZ, plannedRemoved, options) {
  const key = `${Math.trunc(worldX)},${Math.trunc(worldY)},${Math.trunc(worldZ)}`;
  if (plannedRemoved.has(key)) return false;
  const blockId = Math.trunc(Number(options.chunks?.getBlockAtWorld?.(worldX, worldY, worldZ)) || options.blockAirId);
  return blockId === BLOCK_ID.bedrock;
}

function isSupportAnchoredBlock(block, options) {
  return block.worldY <= Math.trunc(Number(options.minWorldY) || -32);
}

function isSupportCandidateBlock(blockId, blockDef, isFluidBlock, isMineableBlock, blockAirId) {
  const id = Math.trunc(Number(blockId));
  if (!Number.isFinite(id) || id === blockAirId || id === BLOCK_ID.bedrock) return false;
  if (typeof isFluidBlock === "function" && isFluidBlock(id)) return false;
  if (typeof isMineableBlock === "function" && !isMineableBlock(id)) return false;
  const def = blockDef?.(id) ?? {};
  if (!def.hardness) return false;
  return Boolean((Math.trunc(Number(def.flags) || 0) & BLOCK_FLAGS.SOLID) !== 0);
}

function selectSupportCollapseRewardBlocks(blocks) {
  const normalized = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
  if (!normalized.length) return [];
  const count = Math.max(1, Math.floor(normalized.length * DEFAULT_REWARD_NUMERATOR / DEFAULT_REWARD_DENOMINATOR));
  return [...normalized]
    .sort((a, b) => supportCollapseRewardScore(a) - supportCollapseRewardScore(b))
    .slice(0, count);
}

function supportCollapseRewardScore(block) {
  const x = Math.imul((Number(block.worldX ?? block.x) | 0) ^ 0x45d9f3b, 0x27d4eb2d);
  const y = Math.imul((Number(block.worldY ?? block.y) | 0) ^ 0x165667b1, 0x85ebca6b);
  const z = Math.imul((Number(block.worldZ ?? block.z) | 0) ^ 0x9e3779b9, 0xc2b2ae35);
  return (x ^ y ^ z) >>> 0;
}

function normalizeBlock(block, chunks, blockDef) {
  if (!block) return null;
  const worldX = Math.trunc(Number(block.worldX ?? block.x));
  const worldY = Math.trunc(Number(block.worldY ?? block.y));
  const worldZ = Math.trunc(Number(block.worldZ ?? block.z));
  const blockId = Math.trunc(Number(block.blockId));
  if (![worldX, worldY, worldZ, blockId].every(Number.isFinite)) return null;
  return blockFromWorld(chunks, blockDef, worldX, worldY, worldZ, blockId, block);
}

function blockFromWorld(chunks, blockDef, worldX, worldY, worldZ, blockId, source = {}) {
  const coord = worldToChunk(worldX, worldY, worldZ, chunks?.chunkSize || 16);
  const def = blockDef?.(blockId) ?? {};
  return {
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
    resourceId: Math.trunc(Number(source.resourceId ?? def.resourceId) || 0),
    materialId: Math.trunc(Number(source.materialId ?? def.materialId) || 0),
    faceX: Math.trunc(Number(source.faceX) || 0),
    faceY: Math.trunc(Number(source.faceY) || 0),
    faceZ: Math.trunc(Number(source.faceZ) || 1),
  };
}

function isWithinBounds(worldX, worldY, worldZ, bounds) {
  return worldX >= bounds.minX && worldX <= bounds.maxX &&
    worldY >= bounds.minY && worldY <= bounds.maxY &&
    worldZ >= bounds.minZ && worldZ <= bounds.maxZ;
}

function blockKey(block) {
  return `${Math.trunc(block.worldX ?? block.x)},${Math.trunc(block.worldY ?? block.y)},${Math.trunc(block.worldZ ?? block.z)}`;
}

function worldPositionFromKey(key) {
  const values = String(key).split(",").map(Number);
  if (values.length !== 3 || !values.every(Number.isFinite)) return null;
  return {
    worldX: Math.trunc(values[0]),
    worldY: Math.trunc(values[1]),
    worldZ: Math.trunc(values[2]),
  };
}
