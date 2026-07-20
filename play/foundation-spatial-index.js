const DEFAULT_CHUNK_SIZE = 16;
const SPATIAL_CELL_BASE_CHUNKS = 16;
const SPATIAL_CELL_LEVEL_COUNT = 13;

export function createFoundationSpatialIndex({ chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  const size = positiveInt(chunkSize, DEFAULT_CHUNK_SIZE);
  const records = new Map();
  const byCell = new Map();
  let generation = 0;

  return {
    chunkSize: size,
    clear,
    replace,
    upsert,
    remove,
    get: (id) => records.get(String(id || "")) ?? null,
    list: () => [...records.values()],
    listNear,
    listInRect,
    foundationsAt,
    intersects,
    protectedFoundationAt,
    isBlockProtected: (block) => Boolean(protectedFoundationAt(block)),
    size: () => records.size,
    version: () => generation,
  };

  function clear() {
    if (!records.size && !byCell.size) return false;
    records.clear();
    byCell.clear();
    generation += 1;
    return true;
  }

  function replace(nextRecords = []) {
    const normalized = new Map();
    for (const input of nextRecords) {
      const record = normalizeFoundation(input, size);
      if (record) normalized.set(record.id, record);
    }
    if (sameRecordSet(records, normalized)) return records.size;
    records.clear();
    byCell.clear();
    for (const record of normalized.values()) indexRecord(record);
    generation += 1;
    return records.size;
  }

  function upsert(input) {
    const record = normalizeFoundation(input, size);
    if (!record) return null;
    const current = records.get(record.id);
    if (current?.fingerprint === record.fingerprint) return current;
    if (current) unindexRecord(current);
    indexRecord(record);
    generation += 1;
    return record;
  }

  function indexRecord(record) {
    records.set(record.id, record);
    for (const key of record.cellKeys) {
      let bucket = byCell.get(key);
      if (!bucket) {
        bucket = new Map();
        byCell.set(key, bucket);
      }
      bucket.set(record.id, record);
    }
  }

  function remove(idValue) {
    const id = String(idValue || "");
    const current = records.get(id);
    if (!current) return false;
    unindexRecord(current);
    generation += 1;
    return true;
  }

  function unindexRecord(current) {
    records.delete(current.id);
    for (const key of current.cellKeys) {
      const bucket = byCell.get(key);
      bucket?.delete(current.id);
      if (!bucket?.size) byCell.delete(key);
    }
  }

  function listNear(worldX, worldZ, radius = 256) {
    const x = finiteInt(worldX);
    const z = finiteInt(worldZ);
    const safeRadius = Math.max(0, finiteInt(radius));
    const range = {
      minX: x - safeRadius,
      minZ: z - safeRadius,
      maxX: x + safeRadius,
      maxZ: z + safeRadius,
    };
    return queryRange(range);
  }

  function listInRect(input = {}) {
    const range = normalizeRect(input);
    return range ? queryRange(range) : [];
  }

  function foundationsAt(worldX, worldZ) {
    const x = finiteInt(worldX);
    const z = finiteInt(worldZ);
    const chunkX = Math.floor(x / size);
    const chunkZ = Math.floor(z / size);
    const found = new Map();
    for (let level = 0; level < SPATIAL_CELL_LEVEL_COUNT; level += 1) {
      const span = buildIndexCellSpanChunks(level);
      const bucket = byCell.get(cellKey(level, Math.floor(chunkX / span), Math.floor(chunkZ / span)));
      if (!bucket) continue;
      for (const [id, record] of bucket) found.set(id, record);
    }
    return [...found.values()].filter((record) => containsColumn(record, x, z));
  }

  function intersects(input, { ignoreId = "" } = {}) {
    const candidate = normalizeRect(input);
    if (!candidate) return null;
    for (const record of queryRange(candidate)) {
      if (record.id === ignoreId) continue;
      if (rectsOverlap(candidate, record)) return record;
    }
    return null;
  }

  function protectedFoundationAt(block = {}) {
    const x = finiteInt(block.worldX ?? block.x);
    const y = finiteInt(block.worldY ?? block.y);
    const z = finiteInt(block.worldZ ?? block.z);
    for (const foundation of foundationsAt(x, z)) {
      if (foundation.status === "removed") continue;
      if (y === foundation.surfaceY - 1) return foundation;
    }
    return null;
  }

  function queryRange(range) {
    const minChunkX = Math.floor(range.minX / size);
    const maxChunkX = Math.floor(range.maxX / size);
    const minChunkZ = Math.floor(range.minZ / size);
    const maxChunkZ = Math.floor(range.maxZ / size);
    const found = new Map();
    for (let level = 0; level < SPATIAL_CELL_LEVEL_COUNT; level += 1) {
      const span = buildIndexCellSpanChunks(level);
      const minCellX = Math.floor(minChunkX / span);
      const maxCellX = Math.floor(maxChunkX / span);
      const minCellZ = Math.floor(minChunkZ / span);
      const maxCellZ = Math.floor(maxChunkZ / span);
      const cellCount = (maxCellX - minCellX + 1) * (maxCellZ - minCellZ + 1);
      if (!Number.isSafeInteger(cellCount) || cellCount > 4_096) {
        return [...records.values()].filter((record) => rectsOverlap(range, record));
      }
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
          const bucket = byCell.get(cellKey(level, cellX, cellZ));
          if (!bucket) continue;
          for (const [id, record] of bucket) found.set(id, record);
        }
      }
    }
    return [...found.values()].filter((record) => rectsOverlap(range, record));
  }
}

export function normalizeFoundationRect(input = {}) {
  return normalizeRect(input);
}

function normalizeFoundation(input = {}, chunkSize) {
  const rect = normalizeRect(input);
  if (!rect) return null;
  const surfaceY = finiteInt(input.surfaceY ?? input.y);
  const owner = String(input.owner || "");
  const foundationId = normalizeFoundationId(input.foundationId ?? input.id ?? 0);
  const id = String(input.id || `${owner || "foundation"}:${foundationId}`);
  const cellKeys = buildIndexCellKeys(rect, chunkSize);
  if (!cellKeys.length) return null;
  const record = {
    id,
    owner,
    foundationId,
    minX: rect.minX,
    minZ: rect.minZ,
    maxX: rect.maxX,
    maxZ: rect.maxZ,
    surfaceY,
    width: rect.width,
    depth: rect.depth,
    status: String(input.status || "active"),
    signature: String(input.signature || ""),
    activeRevision: nonNegativeInt(input.activeRevision),
    pendingRevision: nonNegativeInt(input.pendingRevision),
    contentHash: normalizeContentHash(input.contentHash),
    guardianManifestHash: normalizeContentHash(input.guardianManifestHash),
    guardianRegion: String(input.guardianRegion || ""),
    sourcePda: String(input.sourcePda || input.address || ""),
    programId: String(input.programId || ""),
    legacy: input.legacy === true,
    hasActiveGeometry: input.hasActiveGeometry !== false,
    createdSlot: String(input.createdSlot || "0"),
    updatedSlot: String(input.updatedSlot || ""),
    cellKeys: Object.freeze(cellKeys),
  };
  record.fingerprint = foundationFingerprint(record);
  return Object.freeze(record);
}

function sameRecordSet(current, next) {
  if (current.size !== next.size) return false;
  for (const [id, record] of next) {
    if (current.get(id)?.fingerprint !== record.fingerprint) return false;
  }
  return true;
}

function foundationFingerprint(record) {
  return [
    record.id,
    record.owner,
    record.foundationId,
    record.minX,
    record.minZ,
    record.maxX,
    record.maxZ,
    record.surfaceY,
    record.status,
    record.activeRevision,
    record.pendingRevision,
    record.contentHash,
    record.guardianManifestHash,
    record.guardianRegion,
    record.sourcePda,
    record.programId,
    record.legacy ? 1 : 0,
    record.hasActiveGeometry ? 1 : 0,
    record.createdSlot,
    record.updatedSlot,
  ].join(":");
}

function normalizeContentHash(value) {
  const hash = String(value || "").trim().toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{32}$/.test(hash) ? hash : "0".repeat(32);
}

function buildIndexCellKeys(rect, chunkSize) {
  const minChunkX = Math.floor(rect.minX / chunkSize);
  const maxChunkX = Math.floor(rect.maxX / chunkSize);
  const minChunkZ = Math.floor(rect.minZ / chunkSize);
  const maxChunkZ = Math.floor(rect.maxZ / chunkSize);
  const spanX = maxChunkX - minChunkX + 1;
  const spanZ = maxChunkZ - minChunkZ + 1;
  let level = 0;
  while (level < SPATIAL_CELL_LEVEL_COUNT - 1) {
    const span = buildIndexCellSpanChunks(level);
    if (spanX <= span && spanZ <= span) break;
    level += 1;
  }
  const span = buildIndexCellSpanChunks(level);
  if (spanX > span || spanZ > span) return [];
  const keys = [];
  for (let cellZ = Math.floor(minChunkZ / span); cellZ <= Math.floor(maxChunkZ / span); cellZ += 1) {
    for (let cellX = Math.floor(minChunkX / span); cellX <= Math.floor(maxChunkX / span); cellX += 1) {
      keys.push(cellKey(level, cellX, cellZ));
    }
  }
  return keys.length <= 4 ? keys : [];
}

function buildIndexCellSpanChunks(level) {
  return SPATIAL_CELL_BASE_CHUNKS * 4 ** level;
}

function normalizeRect(input = {}) {
  const minX = finiteInt(input.minX ?? input.worldX ?? input.x);
  const minZ = finiteInt(input.minZ ?? input.worldZ ?? input.z);
  const width = positiveInt(input.width ?? input.length, 0);
  const depth = positiveInt(input.depth, 0);
  if (!width || !depth) return null;
  const maxX = minX + width - 1;
  const maxZ = minZ + depth - 1;
  if (!Number.isSafeInteger(maxX) || !Number.isSafeInteger(maxZ)) return null;
  return { minX, minZ, maxX, maxZ, width, depth };
}

function containsColumn(rect, x, z) {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

function rectsOverlap(left, right) {
  return left.minX <= right.maxX
    && left.maxX >= right.minX
    && left.minZ <= right.maxZ
    && left.maxZ >= right.minZ;
}

function cellKey(level, cellX, cellZ) {
  return `${level}:${cellX},${cellZ}`;
}

function positiveInt(value, fallback) {
  const number = Math.trunc(Number(value));
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInt(value) {
  const number = Math.trunc(Number(value));
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function finiteInt(value) {
  const number = Math.trunc(Number(value));
  return Number.isSafeInteger(number) ? number : 0;
}

function normalizeFoundationId(value) {
  try {
    return BigInt(value ?? 0).toString();
  } catch {
    return "0";
  }
}
