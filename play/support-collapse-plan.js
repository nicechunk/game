import { BLOCK_FLAGS, BLOCK_ID, worldToChunk } from "../chunk.js/play.js";
import {
  blockSupportProfile,
  SUPPORT_COLLAPSE_MAX_BLOCKS,
  SUPPORT_COLLAPSE_MAX_CHUNKS,
} from "../src/world/blockSupport.js";
import { isPlacedWorldBlock } from "./placed-block-state.js";

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
  supportProfile = blockSupportProfile,
  blockAirId = BLOCK_ID.air,
  minWorldY = -32,
  maxBlocks = SUPPORT_COLLAPSE_MAX_BLOCKS,
  maxChunks = SUPPORT_COLLAPSE_MAX_CHUNKS,
} = {}) {
  const blockLimit = Math.max(1, Math.trunc(maxBlocks || SUPPORT_COLLAPSE_MAX_BLOCKS));
  const chunkLimit = Math.max(1, Math.trunc(maxChunks || SUPPORT_COLLAPSE_MAX_CHUNKS));
  return function supportCollapsePlanForHit(hit) {
    const primary = normalizeBlock(hit, chunks, blockDef);
    if (!primary || !isSupportCandidateBlock(primary.blockId, blockDef, isFluidBlock, isMineableBlock, blockAirId)) return null;
    if (isPlacedWorldBlock(chunks, primary.worldX, primary.worldY, primary.worldZ, blockAirId)) return null;

    const collapse = collectSupportCollapseBlocks(primary, {
      chunks,
      blockDef,
      isFluidBlock,
      isMineableBlock,
      supportProfile,
      blockAirId,
      minWorldY,
      maxBlocks: blockLimit,
      maxChunks: chunkLimit,
    });
    if (collapse.blockedReason) {
      return {
        kind: "support-collapse-blocked",
        blocks: [primary],
        collapseBlocks: [],
        rewardBlocks: [],
        blockedReason: collapse.blockedReason,
        blockedLimit: collapse.blockedLimit,
        requiredDamage: 3,
      };
    }
    if (!collapse.blocks.length) return null;
    return {
      kind: "support-collapse",
      blocks: [primary, ...collapse.blocks],
      collapseBlocks: collapse.blocks,
      rewardBlocks: selectSupportCollapseRewardBlocks(collapse.blocks),
      requiredDamage: 3,
    };
  };
}

function collectSupportCollapseBlocks(originBlock, options) {
  const plannedRemoved = new Set([blockKey(originBlock)]);
  const collapsed = [];
  const removedQueue = [originBlock];
  const chunks = new Set([originBlock.chunkId]);
  for (let cursor = 0; cursor < removedQueue.length; cursor += 1) {
    const removed = removedQueue[cursor];
    for (const [dx, dy, dz] of FACE_OFFSETS) {
      const block = supportCollapseBlockAt(
        removed.worldX + dx,
        removed.worldY + dy,
        removed.worldZ + dz,
        plannedRemoved,
        options,
      );
      if (!block) continue;
      const key = blockKey(block);
      if (plannedRemoved.has(key) || isBlockSupported(block, plannedRemoved, options)) continue;
      if (plannedRemoved.size >= options.maxBlocks) {
        return { blocks: [], blockedReason: "block-limit", blockedLimit: options.maxBlocks };
      }
      chunks.add(block.chunkId);
      if (chunks.size > options.maxChunks) {
        return { blocks: [], blockedReason: "chunk-limit", blockedLimit: options.maxChunks };
      }
      plannedRemoved.add(key);
      collapsed.push(block);
      removedQueue.push(block);
    }
  }
  return { blocks: collapsed, blockedReason: "", blockedLimit: 0 };
}

function supportCollapseBlockAt(worldX, worldY, worldZ, plannedRemoved, options) {
  const key = `${Math.trunc(worldX)},${Math.trunc(worldY)},${Math.trunc(worldZ)}`;
  if (plannedRemoved.has(key)) return null;
  if (isPlacedWorldBlock(options.chunks, worldX, worldY, worldZ, options.blockAirId)) return null;
  const blockId = Math.trunc(Number(options.chunks?.getBlockAtWorld?.(worldX, worldY, worldZ)) || options.blockAirId);
  if (!isSupportCandidateBlock(blockId, options.blockDef, options.isFluidBlock, options.isMineableBlock, options.blockAirId)) return null;
  return blockFromWorld(options.chunks, options.blockDef, worldX, worldY, worldZ, blockId);
}

function isBlockSupported(block, plannedRemoved, options) {
  if (block.worldY <= Math.trunc(Number(options.minWorldY) || -32)) return true;
  if (isSupportCell(block.worldX, block.worldY - 1, block.worldZ, plannedRemoved, options)) return true;

  const profile = options.supportProfile?.(block.blockId) ?? {};
  if (profile.gravity) return false;
  const initialSpan = Math.max(0, Math.trunc(Number(profile.horizontalSpan) || 0));
  if (!initialSpan) return false;

  const queue = [{ block, remaining: initialSpan }];
  const bestRemaining = new Map([[blockKey(block), initialSpan]]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current.block !== block && isSupportCell(
      current.block.worldX,
      current.block.worldY - 1,
      current.block.worldZ,
      plannedRemoved,
      options,
    )) return true;
    if (current.remaining <= 0) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = supportTransmissionBlockAt(
        current.block.worldX + dx,
        current.block.worldY,
        current.block.worldZ + dz,
        plannedRemoved,
        options,
      );
      if (!next) continue;
      const nextProfile = options.supportProfile?.(next.blockId) ?? {};
      if (nextProfile.gravity) continue;
      const nextRemaining = Math.min(
        current.remaining - 1,
        Math.max(0, Math.trunc(Number(nextProfile.horizontalSpan) || 0)),
      );
      const key = blockKey(next);
      if (nextRemaining < 0 || (bestRemaining.get(key) ?? -1) >= nextRemaining) continue;
      bestRemaining.set(key, nextRemaining);
      queue.push({ block: next, remaining: nextRemaining });
    }
  }
  return false;
}

function supportTransmissionBlockAt(worldX, worldY, worldZ, plannedRemoved, options) {
  const key = `${Math.trunc(worldX)},${Math.trunc(worldY)},${Math.trunc(worldZ)}`;
  if (plannedRemoved.has(key)) return null;
  if (isPlacedWorldBlock(options.chunks, worldX, worldY, worldZ, options.blockAirId)) {
    return blockFromWorld(options.chunks, options.blockDef, worldX, worldY, worldZ, options.chunks.getBlockAtWorld(worldX, worldY, worldZ));
  }
  const blockId = Math.trunc(Number(options.chunks?.getBlockAtWorld?.(worldX, worldY, worldZ)) || options.blockAirId);
  if (!isSupportCandidateBlock(blockId, options.blockDef, options.isFluidBlock, options.isMineableBlock, options.blockAirId)) return null;
  return blockFromWorld(options.chunks, options.blockDef, worldX, worldY, worldZ, blockId);
}

function isSupportCell(worldX, worldY, worldZ, plannedRemoved, options) {
  const key = `${Math.trunc(worldX)},${Math.trunc(worldY)},${Math.trunc(worldZ)}`;
  if (plannedRemoved.has(key)) return false;
  if (isPlacedWorldBlock(options.chunks, worldX, worldY, worldZ, options.blockAirId)) return true;
  const blockId = Math.trunc(Number(options.chunks?.getBlockAtWorld?.(worldX, worldY, worldZ)) || options.blockAirId);
  if (blockId === BLOCK_ID.bedrock) return true;
  return isSupportCandidateBlock(blockId, options.blockDef, options.isFluidBlock, options.isMineableBlock, options.blockAirId);
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

function blockKey(block) {
  return `${Math.trunc(block.worldX ?? block.x)},${Math.trunc(block.worldY ?? block.y)},${Math.trunc(block.worldZ ?? block.z)}`;
}
