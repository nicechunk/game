export const BULK_MINING_BATCH_SIZE = 2;
export const BULK_MINING_MAX_SELECTION_BLOCKS = 640;
export const BULK_MINING_RANGE_MODE_DEBUG = 1;
export const BULK_MINING_RANGE_MODE_SUPPORT_PRIMARY = 2;
export const BULK_MINING_RANGE_MODE_SUPPORT_COLLAPSE = 3;
export const BULK_MINING_RANGE_MAX_PALETTE_SIZE = 8;
// These conservative weights are derived from Devnet CU probes against the
// canonical world generator. Guaranteed-deep cells avoid surface generation.
export const BULK_MINING_GUARANTEED_DEEP_MAX_Y = -9;
export const BULK_MINING_RANGE_MAX_ESTIMATED_WORK = 1_050_000;
export const BULK_MINING_RANGE_DEEP_BLOCK_WORK = 1_200;
export const BULK_MINING_RANGE_NON_DEEP_BLOCK_WORK = 1_500;
export const BULK_MINING_RANGE_NON_DEEP_COLUMN_WORK = 80_000;
export const BULK_MINING_RANGE_MAX_COMPUTE_SPLIT_DEPTH = 4;
const BULK_MINING_RANGE_HEADER_BYTES = 15;
const SUPPORT_COLLAPSE_ANCHOR_BYTES = 10;

export function partitionBulkMiningRanges(blocks, {
  chunkSize = 16,
  maxVolume = BULK_MINING_MAX_SELECTION_BLOCKS,
  maxEstimatedWork = BULK_MINING_RANGE_MAX_ESTIMATED_WORK,
  guaranteedDeepMaxY = BULK_MINING_GUARANTEED_DEEP_MAX_Y,
} = {}) {
  const safeChunkSize = Math.max(1, Math.trunc(Number(chunkSize) || 16));
  const safeMaxVolume = Math.max(1, Math.min(
    BULK_MINING_MAX_SELECTION_BLOCKS,
    Math.trunc(Number(maxVolume) || BULK_MINING_MAX_SELECTION_BLOCKS),
  ));
  const safeMaxEstimatedWork = Math.max(1, Math.trunc(
    Number(maxEstimatedWork) || BULK_MINING_RANGE_MAX_ESTIMATED_WORK,
  ));
  const safeGuaranteedDeepMaxY = finiteInteger(guaranteedDeepMaxY)
    ?? BULK_MINING_GUARANTEED_DEEP_MAX_Y;
  const groups = groupedUniqueBlocks(blocks, safeChunkSize);
  const ranges = [];
  for (const group of groups.values()) {
    let remaining = group.blocks.slice().sort(compareBlocks);
    while (remaining.length) {
      const minX = Math.min(...remaining.map((block) => block.x));
      const maxX = Math.max(...remaining.map((block) => block.x));
      const minZ = Math.min(...remaining.map((block) => block.z));
      const maxZ = Math.max(...remaining.map((block) => block.z));
      const layerArea = (maxX - minX + 1) * (maxZ - minZ + 1);
      const maxLayers = Math.max(1, Math.floor(safeMaxVolume / layerArea));
      const minY = remaining[0].y;
      const maxY = minY + maxLayers - 1;
      const slab = remaining.filter((block) => block.y <= maxY);
      const selectedKeys = new Set(slab.map(blockKey));
      remaining = remaining.filter((block) => !selectedKeys.has(blockKey(block)));
      for (const selected of partitionBlocksByPalette(slab)) {
        for (const workloadGroup of partitionBlocksByEstimatedWork(selected, {
          maxEstimatedWork: safeMaxEstimatedWork,
          guaranteedDeepMaxY: safeGuaranteedDeepMaxY,
        })) {
          ranges.push(createRange(group.chunkX, group.chunkZ, workloadGroup));
        }
      }
    }
  }
  return ranges;
}

export function encodeBulkMiningRangePayload(range, {
  mode = BULK_MINING_RANGE_MODE_DEBUG,
  supportAnchor = range?.supportAnchor ?? null,
} = {}) {
  const normalized = normalizedRange(range);
  if (![BULK_MINING_RANGE_MODE_DEBUG, BULK_MINING_RANGE_MODE_SUPPORT_PRIMARY, BULK_MINING_RANGE_MODE_SUPPORT_COLLAPSE].includes(mode)) {
    throw new Error("unsupported bulk mining range mode");
  }
  if (mode === BULK_MINING_RANGE_MODE_SUPPORT_PRIMARY && normalized.blocks.length !== 1) {
    throw new Error("support-collapse primary range requires exactly one block");
  }
  const normalizedAnchor = mode === BULK_MINING_RANGE_MODE_SUPPORT_COLLAPSE
    ? normalizeSupportAnchor(supportAnchor)
    : null;
  if (mode === BULK_MINING_RANGE_MODE_SUPPORT_COLLAPSE && !normalizedAnchor) {
    throw new Error("support-collapse range requires a prior support anchor");
  }
  if (normalized.volume < 1 || normalized.volume > BULK_MINING_MAX_SELECTION_BLOCKS) {
    throw new Error(`bulk mining range requires 1-${BULK_MINING_MAX_SELECTION_BLOCKS} cells`);
  }
  const byCoordinate = new Map(normalized.blocks.map((block) => [blockKey(block), block]));
  if (byCoordinate.size !== normalized.blocks.length || !byCoordinate.size) {
    throw new Error("bulk mining range requires unique selected blocks");
  }
  const bitmap = new Uint8Array(Math.ceil(normalized.volume / 8));
  const blockIds = [];
  let volumeIndex = 0;
  for (let y = normalized.minY; y <= normalized.maxY; y += 1) {
    for (let z = normalized.minZ; z <= normalized.maxZ; z += 1) {
      for (let x = normalized.minX; x <= normalized.maxX; x += 1) {
        const block = byCoordinate.get(`${x},${y},${z}`);
        if (block) {
          const blockId = Math.trunc(Number(block.blockId));
          if (!Number.isInteger(blockId) || blockId < 1 || blockId > 63 || blockId === 16 || blockId === 17) {
            throw new Error(`invalid canonical bulk mining block id: ${block?.blockId}`);
          }
          bitmap[volumeIndex >> 3] |= 1 << (volumeIndex & 7);
          blockIds.push(blockId);
        }
        volumeIndex += 1;
      }
    }
  }
  if (blockIds.length !== normalized.blocks.length) {
    throw new Error("bulk mining range contains a block outside its bounds");
  }
  const palette = [...new Set(blockIds)].sort((left, right) => left - right);
  if (palette.length < 1 || palette.length > BULK_MINING_RANGE_MAX_PALETTE_SIZE) {
    throw new Error(`bulk mining range requires 1-${BULK_MINING_RANGE_MAX_PALETTE_SIZE} block types`);
  }
  const paletteIndexes = new Map(palette.map((blockId, index) => [blockId, index]));
  const paletteIndexBits = bitsRequiredForPalette(palette.length);
  const packedPaletteIndexes = packBitValues(
    blockIds.map((blockId) => paletteIndexes.get(blockId)),
    paletteIndexBits,
  );
  const paletteOffset = BULK_MINING_RANGE_HEADER_BYTES + bitmap.length;
  const packedIndexesOffset = paletteOffset + 1 + palette.length;
  const anchorOffset = packedIndexesOffset + packedPaletteIndexes.length;
  const payload = new Uint8Array(
    anchorOffset + (normalizedAnchor ? SUPPORT_COLLAPSE_ANCHOR_BYTES : 0),
  );
  const view = new DataView(payload.buffer);
  payload[0] = mode;
  view.setInt32(1, normalized.minX, true);
  view.setInt16(5, normalized.minY, true);
  view.setInt32(7, normalized.minZ, true);
  payload[11] = normalized.sizeX;
  view.setUint16(12, normalized.sizeY, true);
  payload[14] = normalized.sizeZ;
  payload.set(bitmap, BULK_MINING_RANGE_HEADER_BYTES);
  payload[paletteOffset] = palette.length;
  payload.set(palette, paletteOffset + 1);
  payload.set(packedPaletteIndexes, packedIndexesOffset);
  if (normalizedAnchor) {
    view.setInt32(anchorOffset, normalizedAnchor.x, true);
    view.setInt16(anchorOffset + 4, normalizedAnchor.y, true);
    view.setInt32(anchorOffset + 6, normalizedAnchor.z, true);
  }
  return payload;
}

function normalizeSupportAnchor(source) {
  const x = finiteInteger(source?.x ?? source?.worldX);
  const y = finiteInteger(source?.y ?? source?.worldY);
  const z = finiteInteger(source?.z ?? source?.worldZ);
  if (x === null || y === null || z === null || y < -0x8000 || y > 0x7fff) return null;
  return { x, y, z };
}

export async function submitBulkMiningRanges(ranges, submitRange) {
  const queue = (Array.isArray(ranges) ? ranges : [])
    .filter((range) => range?.blocks?.length)
    .map((range) => ({ range, retryDepth: 0 }));
  const confirmed = [];
  const failures = [];
  const retryErrors = [];
  const aborted = [];
  while (queue.length) {
    const { range, retryDepth } = queue.shift();
    try {
      const result = await submitRange(range);
      for (const block of range.blocks) confirmed.push({ block, result, retried: retryDepth > 0 });
    } catch (error) {
      retryErrors.push({ batch: range, error });
      if (
        retryDepth < BULK_MINING_RANGE_MAX_COMPUTE_SPLIT_DEPTH
        && range.blocks.length > 1
        && isBulkMiningComputeLimitError(error)
      ) {
        const splits = splitRangeForComputeRetry(range);
        queue.unshift(...splits.map((split) => ({ range: split, retryDepth: retryDepth + 1 })));
        continue;
      }
      for (const block of range.blocks) failures.push({ block, error });
      for (const remaining of queue) {
        for (const block of remaining.range.blocks) {
          aborted.push({ block, error, reason: "range-wide-failure" });
        }
      }
      break;
    }
  }
  return { confirmed, failures, retryErrors, aborted };
}

export function estimateBulkMiningRangeWork(blocks, {
  guaranteedDeepMaxY = BULK_MINING_GUARANTEED_DEEP_MAX_Y,
} = {}) {
  const safeGuaranteedDeepMaxY = finiteInteger(guaranteedDeepMaxY)
    ?? BULK_MINING_GUARANTEED_DEEP_MAX_Y;
  let totalBlocks = 0;
  let nonDeepBlocks = 0;
  const nonDeepColumns = new Set();
  for (const source of Array.isArray(blocks) ? blocks : []) {
    const block = normalizeBlock(source);
    if (!block) continue;
    totalBlocks += 1;
    if (block.y <= safeGuaranteedDeepMaxY) continue;
    nonDeepBlocks += 1;
    nonDeepColumns.add(`${block.x},${block.z}`);
  }
  return totalBlocks * BULK_MINING_RANGE_DEEP_BLOCK_WORK
    + nonDeepBlocks * BULK_MINING_RANGE_NON_DEEP_BLOCK_WORK
    + nonDeepColumns.size * BULK_MINING_RANGE_NON_DEEP_COLUMN_WORK;
}

export function isBulkMiningComputeLimitError(error) {
  const logs = [
    ...(Array.isArray(error?.logs) ? error.logs : []),
    ...(Array.isArray(error?.result?.logs) ? error.result.logs : []),
  ];
  const text = [error?.message, error?.reason, ...logs].filter(Boolean).join("\n");
  return /exceeded (?:CUs|compute units?) meter|ComputationalBudgetExceeded|comput(?:e|ational) budget exceeded/iu.test(text);
}

export function partitionBulkMiningBlocks(blocks, {
  batchSize = BULK_MINING_BATCH_SIZE,
  chunkSize = 16,
} = {}) {
  const safeBatchSize = Math.max(1, Math.trunc(Number(batchSize) || BULK_MINING_BATCH_SIZE));
  const safeChunkSize = Math.max(1, Math.trunc(Number(chunkSize) || 16));
  const groups = new Map();
  const seen = new Set();
  for (const source of Array.isArray(blocks) ? blocks : []) {
    const block = normalizeBlock(source);
    if (!block) continue;
    const key = `${block.x},${block.y},${block.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const chunkX = Math.floor(block.x / safeChunkSize);
    const chunkZ = Math.floor(block.z / safeChunkSize);
    const chunkKey = `${chunkX},${chunkZ}`;
    if (!groups.has(chunkKey)) groups.set(chunkKey, { chunkX, chunkZ, blocks: [] });
    groups.get(chunkKey).blocks.push(block);
  }

  const batches = [];
  for (const group of groups.values()) {
    for (let index = 0; index < group.blocks.length; index += safeBatchSize) {
      batches.push({
        chunkX: group.chunkX,
        chunkZ: group.chunkZ,
        blocks: group.blocks.slice(index, index + safeBatchSize),
      });
    }
  }
  return batches;
}

function groupedUniqueBlocks(blocks, chunkSize) {
  const groups = new Map();
  const seen = new Set();
  for (const source of Array.isArray(blocks) ? blocks : []) {
    const block = normalizeBlock(source);
    if (!block) continue;
    const key = blockKey(block);
    if (seen.has(key)) continue;
    seen.add(key);
    const chunkX = Math.floor(block.x / chunkSize);
    const chunkZ = Math.floor(block.z / chunkSize);
    const chunkKey = `${chunkX},${chunkZ}`;
    if (!groups.has(chunkKey)) groups.set(chunkKey, { chunkX, chunkZ, blocks: [] });
    groups.get(chunkKey).blocks.push(block);
  }
  return groups;
}

function createRange(chunkX, chunkZ, blocks) {
  const minX = Math.min(...blocks.map((block) => block.x));
  const maxX = Math.max(...blocks.map((block) => block.x));
  const minY = Math.min(...blocks.map((block) => block.y));
  const maxY = Math.max(...blocks.map((block) => block.y));
  const minZ = Math.min(...blocks.map((block) => block.z));
  const maxZ = Math.max(...blocks.map((block) => block.z));
  return {
    chunkX,
    chunkZ,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    sizeX: maxX - minX + 1,
    sizeY: maxY - minY + 1,
    sizeZ: maxZ - minZ + 1,
    volume: (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1),
    blocks: blocks.slice().sort(compareBlocks),
  };
}

function normalizedRange(range) {
  const blocks = (Array.isArray(range?.blocks) ? range.blocks : []).map(normalizeBlock).filter(Boolean);
  const normalized = blocks.length ? createRange(
    finiteInteger(range?.chunkX) ?? Math.floor(blocks[0].x / 16),
    finiteInteger(range?.chunkZ) ?? Math.floor(blocks[0].z / 16),
    blocks,
  ) : null;
  if (!normalized) throw new Error("bulk mining range is empty");
  if (normalized.sizeX > 16 || normalized.sizeZ > 16 || normalized.sizeY > 0xffff) {
    throw new Error("bulk mining range dimensions are invalid");
  }
  return normalized;
}

function partitionBlocksByPalette(blocks) {
  const groups = [];
  const blockIdGroups = new Map();
  let distinctBlockIds = 0;
  for (const block of blocks) {
    const blockId = Math.trunc(Number(block?.blockId));
    let groupIndex = blockIdGroups.get(blockId);
    if (groupIndex === undefined) {
      groupIndex = Math.floor(distinctBlockIds / BULK_MINING_RANGE_MAX_PALETTE_SIZE);
      blockIdGroups.set(blockId, groupIndex);
      distinctBlockIds += 1;
    }
    if (!groups[groupIndex]) groups[groupIndex] = [];
    groups[groupIndex].push(block);
  }
  return groups;
}

function partitionBlocksByEstimatedWork(blocks, {
  maxEstimatedWork,
  guaranteedDeepMaxY,
}) {
  const groups = [];
  let current = [];
  for (const block of blocks.slice().sort(compareBlocks)) {
    const candidate = [...current, block];
    if (
      current.length
      && estimateBulkMiningRangeWork(candidate, { guaranteedDeepMaxY }) > maxEstimatedWork
    ) {
      groups.push(current);
      current = [block];
    } else {
      current = candidate;
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

function splitRangeForComputeRetry(range) {
  const blocks = range.blocks.slice().sort(compareBlocks);
  const midpoint = Math.max(1, Math.floor(blocks.length / 2));
  return [blocks.slice(0, midpoint), blocks.slice(midpoint)]
    .filter((group) => group.length)
    .map((group) => createRange(range.chunkX, range.chunkZ, group));
}

function bitsRequiredForPalette(paletteSize) {
  if (paletteSize <= 1) return 0;
  return Math.ceil(Math.log2(paletteSize));
}

function packBitValues(values, bitsPerValue) {
  if (bitsPerValue === 0) return new Uint8Array(0);
  const output = new Uint8Array(Math.ceil(values.length * bitsPerValue / 8));
  values.forEach((value, index) => {
    const bitIndex = index * bitsPerValue;
    const byteIndex = bitIndex >> 3;
    const shift = bitIndex & 7;
    const packed = value << shift;
    output[byteIndex] |= packed & 0xff;
    if (byteIndex + 1 < output.length) output[byteIndex + 1] |= (packed >> 8) & 0xff;
  });
  return output;
}

function compareBlocks(left, right) {
  return left.y - right.y || left.z - right.z || left.x - right.x;
}

function blockKey(block) {
  return `${block.x},${block.y},${block.z}`;
}

export async function submitBulkMiningBatches(batches, submitBatch) {
  const queue = Array.isArray(batches) ? batches.filter((batch) => batch?.blocks?.length) : [];
  const confirmed = [];
  const failures = [];
  const retryErrors = [];
  const aborted = [];

  for (let batchIndex = 0; batchIndex < queue.length; batchIndex += 1) {
    const batch = queue[batchIndex];
    try {
      const result = await submitBatch(batch);
      for (const block of batch.blocks) confirmed.push({ block, result, retried: false });
      continue;
    } catch (batchError) {
      retryErrors.push({ batch, error: batchError });
      if (batch.blocks.length === 1) {
        failures.push({ block: batch.blocks[0], error: batchError });
        continue;
      }

      let recoveredCount = 0;
      for (const block of batch.blocks) {
        try {
          const result = await submitBatch({ ...batch, blocks: [block] });
          confirmed.push({ block, result, retried: true });
          recoveredCount += 1;
        } catch (error) {
          failures.push({ block, error });
        }
      }
      if (recoveredCount === 0) {
        for (const remaining of queue.slice(batchIndex + 1)) {
          for (const block of remaining.blocks) {
            aborted.push({ block, error: batchError, reason: "batch-wide-failure" });
          }
        }
        break;
      }
    }
  }

  return { confirmed, failures, retryErrors, aborted };
}

function normalizeBlock(source) {
  const x = finiteInteger(source?.x ?? source?.worldX);
  const y = finiteInteger(source?.y ?? source?.worldY);
  const z = finiteInteger(source?.z ?? source?.worldZ);
  if (x === null || y === null || z === null) return null;
  return { ...source, x, y, z };
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}
