import {
  BULK_MINING_MAX_SELECTION_BLOCKS,
  BULK_MINING_RANGE_MAX_ESTIMATED_WORK,
  BULK_MINING_RANGE_MODE_SUPPORT_COLLAPSE,
  BULK_MINING_RANGE_MODE_SUPPORT_PRIMARY,
  estimateBulkMiningRangeWork,
  partitionBulkMiningRanges,
} from "./bulkMiningSubmission.js";

export const SUPPORT_COLLAPSE_MAX_BLOCKS = BULK_MINING_MAX_SELECTION_BLOCKS;
export const SUPPORT_COLLAPSE_MAX_CHUNKS = 3;
export const SUPPORT_COLLAPSE_MAX_RANGES = 8;
export const SUPPORT_COLLAPSE_MAX_ESTIMATED_WORK = BULK_MINING_RANGE_MAX_ESTIMATED_WORK;
export const SOLANA_TRANSACTION_PACKET_BYTES = 1232;

const FACE_OFFSETS = Object.freeze([
  [0, -1, 0],
  [0, 1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
]);

export class SupportCollapseCapacityError extends Error {
  constructor(reason, message, details = {}) {
    super(message);
    this.name = "SupportCollapseCapacityError";
    this.code = "SUPPORT_COLLAPSE_CAPACITY";
    this.reason = reason;
    Object.assign(this, details);
  }
}

export function createAtomicSupportCollapsePlan(primary, collapseBlocks, {
  chunkSize = 16,
  maxBlocks = SUPPORT_COLLAPSE_MAX_BLOCKS,
  maxChunks = SUPPORT_COLLAPSE_MAX_CHUNKS,
  maxRanges = SUPPORT_COLLAPSE_MAX_RANGES,
  maxEstimatedWork = SUPPORT_COLLAPSE_MAX_ESTIMATED_WORK,
} = {}) {
  const normalizedPrimary = normalizeBlock(primary);
  if (!normalizedPrimary) throw new TypeError("support-collapse primary block is required");
  const blocks = uniqueBlocks([normalizedPrimary, ...(collapseBlocks ?? [])]);
  if (blocks.length < 2) throw new TypeError("support-collapse requires at least one collapsed block");
  if (blocks.length > maxBlocks) {
    throw capacityError("block-limit", `Support collapse requires ${blocks.length} blocks; the atomic limit is ${maxBlocks}.`, {
      blockCount: blocks.length,
      limit: maxBlocks,
    });
  }

  const primaryKey = blockKey(normalizedPrimary);
  if (blockKey(blocks[0]) !== primaryKey) {
    throw new TypeError("support-collapse primary block must be first");
  }
  const collapsed = blocks.slice(1);
  const chunkCount = new Set(blocks.map((block) => (
    `${Math.floor(block.x / chunkSize)},${Math.floor(block.z / chunkSize)}`
  ))).size;
  if (chunkCount > maxChunks) {
    throw capacityError("chunk-limit", `Support collapse crosses ${chunkCount} chunks; the atomic limit is ${maxChunks}.`, {
      chunkCount,
      limit: maxChunks,
    });
  }

  const [primaryRange] = partitionBulkMiningRanges([normalizedPrimary], {
    chunkSize,
    maxEstimatedWork: Number.MAX_SAFE_INTEGER,
  });
  const rawCollapseRanges = partitionBulkMiningRanges(collapsed, {
    chunkSize,
    maxEstimatedWork: Number.MAX_SAFE_INTEGER,
  });
  const collapseRanges = orderConnectedCollapseRanges(rawCollapseRanges, normalizedPrimary, {
    chunkSize,
  });
  const ranges = [
    { ...primaryRange, mode: BULK_MINING_RANGE_MODE_SUPPORT_PRIMARY },
    ...collapseRanges.map((range) => ({ ...range, mode: BULK_MINING_RANGE_MODE_SUPPORT_COLLAPSE })),
  ];
  if (ranges.length > maxRanges) {
    throw capacityError("range-limit", `Support collapse needs ${ranges.length} compressed ranges; the atomic limit is ${maxRanges}.`, {
      rangeCount: ranges.length,
      limit: maxRanges,
    });
  }

  const estimatedWork = ranges.reduce(
    (sum, range) => sum + estimateBulkMiningRangeWork(range.blocks),
    0,
  );
  if (estimatedWork > maxEstimatedWork) {
    throw capacityError("compute-limit", "The complete support collapse exceeds one Solana transaction compute budget.", {
      estimatedWork,
      limit: maxEstimatedWork,
    });
  }

  return {
    primary: normalizedPrimary,
    collapseBlocks: collapsed,
    blocks,
    ranges,
    chunkCount,
    estimatedWork,
  };
}

export function assertAtomicSupportCollapseTransactionFits(transaction, {
  feePayer,
  recentBlockhash = feePayer?.toBase58?.(),
  maxBytes = SOLANA_TRANSACTION_PACKET_BYTES,
} = {}) {
  if (!transaction?.serialize || !feePayer || !recentBlockhash) {
    throw new TypeError("support-collapse packet validation requires a transaction and fee payer");
  }
  const originalFeePayer = transaction.feePayer;
  const originalRecentBlockhash = transaction.recentBlockhash;
  transaction.feePayer = feePayer;
  transaction.recentBlockhash = recentBlockhash;
  try {
    const packetBytes = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).length;
    if (packetBytes > maxBytes) throw packetCapacityError(packetBytes, maxBytes);
    return packetBytes;
  } catch (error) {
    if (error instanceof SupportCollapseCapacityError) throw error;
    const match = String(error?.message || error).match(/(?:too large:\s*)?(\d+)\s*>\s*(\d+)/i);
    if (match) throw packetCapacityError(Number(match[1]), Math.min(maxBytes, Number(match[2])));
    throw error;
  } finally {
    transaction.feePayer = originalFeePayer;
    transaction.recentBlockhash = originalRecentBlockhash;
  }
}

export async function submitSupportCollapseAtomically(plan, submitTransaction) {
  if (!plan?.ranges?.length || typeof submitTransaction !== "function") {
    throw new TypeError("an atomic support-collapse plan and submitter are required");
  }
  const result = await submitTransaction(plan.ranges);
  return {
    result,
    confirmedBlocks: plan.blocks.slice(),
    collapseBlocks: plan.collapseBlocks.slice(),
  };
}

function uniqueBlocks(values) {
  const output = [];
  const seen = new Set();
  for (const source of values) {
    const block = normalizeBlock(source);
    if (!block) throw new TypeError("support-collapse contains an invalid block coordinate");
    const key = blockKey(block);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(block);
  }
  return output;
}

function orderConnectedCollapseRanges(rawRanges, primary, { chunkSize }) {
  const pending = rawRanges.flatMap((range) => (
    connectedComponents(range.blocks).map((blocks) => {
      const [componentRange] = partitionBulkMiningRanges(blocks, {
        chunkSize,
        maxEstimatedWork: Number.MAX_SAFE_INTEGER,
      });
      return componentRange;
    })
  ));
  const committed = new Map([[blockKey(primary), primary]]);
  const ordered = [];
  while (pending.length) {
    let selectedIndex = -1;
    let supportAnchor = null;
    for (let index = 0; index < pending.length && selectedIndex < 0; index += 1) {
      supportAnchor = adjacentCommittedBlock(pending[index].blocks, committed);
      if (supportAnchor) selectedIndex = index;
    }
    if (selectedIndex < 0 || !supportAnchor) {
      throw new TypeError("support-collapse blocks must form one face-connected structure");
    }
    const [range] = pending.splice(selectedIndex, 1);
    const anchoredRange = {
      ...range,
      supportAnchor: {
        x: supportAnchor.x,
        y: supportAnchor.y,
        z: supportAnchor.z,
      },
    };
    ordered.push(anchoredRange);
    for (const block of range.blocks) committed.set(blockKey(block), block);
  }
  return ordered;
}

function connectedComponents(blocks) {
  const remaining = new Map(blocks.map((block) => [blockKey(block), block]));
  const components = [];
  while (remaining.size) {
    const first = remaining.values().next().value;
    const queue = [first];
    const component = [];
    remaining.delete(blockKey(first));
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const block = queue[cursor];
      component.push(block);
      for (const [dx, dy, dz] of FACE_OFFSETS) {
        const key = `${block.x + dx},${block.y + dy},${block.z + dz}`;
        const neighbor = remaining.get(key);
        if (!neighbor) continue;
        remaining.delete(key);
        queue.push(neighbor);
      }
    }
    components.push(component);
  }
  return components;
}

function adjacentCommittedBlock(blocks, committed) {
  for (const block of blocks) {
    for (const [dx, dy, dz] of FACE_OFFSETS) {
      const neighbor = committed.get(`${block.x + dx},${block.y + dy},${block.z + dz}`);
      if (neighbor) return neighbor;
    }
  }
  return null;
}

function normalizeBlock(source) {
  const x = finiteInteger(source?.x ?? source?.worldX);
  const y = finiteInteger(source?.y ?? source?.worldY);
  const z = finiteInteger(source?.z ?? source?.worldZ);
  const blockId = finiteInteger(source?.blockId);
  if (x === null || y === null || z === null || blockId === null || blockId <= 0) return null;
  return { ...source, x, y, z, blockId };
}

function blockKey(block) {
  return `${block.x},${block.y},${block.z}`;
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function capacityError(reason, message, details) {
  return new SupportCollapseCapacityError(reason, message, details);
}

function packetCapacityError(packetBytes, limit) {
  return capacityError(
    "packet-limit",
    `Support collapse needs a ${packetBytes}-byte transaction; Solana allows ${limit} bytes. Nothing was mined.`,
    { packetBytes, limit },
  );
}
