import { optionalContextSlot, yieldChunkSyncTask } from "./play-chain-batch-scheduler.js";

// Only immutable arrays created by this module carry reusable provenance.
// A serialized boolean or a caller-supplied fingerprint never grants it.
const preparedByPacked = new WeakMap();
const work = { canonicalizations: 0, reuses: 0, sortComparisons: 0, transportValidations: 0 };
export function canonicalChunkWorkSnapshot() { return { ...work }; }

function reusableCanonical(snapshot, size) {
  const prepared = preparedByPacked.get(snapshot?.packedDeltas);
  if (!prepared || snapshot.deltas !== prepared.deltas || Number(snapshot.chunkX) !== prepared.chunkX
    || Number(snapshot.chunkZ) !== prepared.chunkZ || size !== prepared.chunkSize) return null;
  work.reuses++;
  return { ...prepared, id: snapshot.id ?? prepared.id, contextSlot: optionalContextSlot(snapshot.contextSlot) };
}

function rememberCanonical(record) {
  Object.freeze(record.packedDeltas);
  for (const delta of record.deltas) Object.freeze(delta);
  Object.freeze(record.deltas);
  Object.freeze(record);
  preparedByPacked.set(record.packedDeltas, record);
  return record;
}

export function canonicalizeChunkSnapshot(snapshot = {}, options = {}) {
  const reused = reusableCanonical(snapshot, Math.max(1, Math.trunc(Number(options.chunkSize) || 16)));
  if (reused) return reused;
  const preparation = prepareCanonicalChunkSnapshot(snapshot, options);
  while (!preparation.done) preparation.step({ maxEntries: Infinity, budgetMs: Infinity });
  return preparation.result;
}

export async function canonicalizeChunkSnapshotAsync(snapshot = {}, options = {}) {
  const reused = reusableCanonical(snapshot, Math.max(1, Math.trunc(Number(options.chunkSize) || 16)));
  if (reused) return reused;
  const preparation = prepareCanonicalChunkSnapshot(snapshot, options);
  while (!preparation.done) {
    preparation.step({ maxEntries: 128, budgetMs: 1 });
    if (!preparation.done) await yieldChunkSyncTask();
  }
  return preparation.result;
}

export function prepareCanonicalChunkSnapshot(snapshot = {}, { chunkSize = 16 } = {}) {
  work.canonicalizations++;
  const size = Math.max(1, Math.trunc(Number(chunkSize) || 16));
  const chunkX = requireI32(snapshot.chunkX, "chunkX");
  const chunkZ = requireI32(snapshot.chunkZ, "chunkZ");
  let result = null, done = false;
  function *prepare() {
    const byCoordinate = new Map();
    if (snapshot.packedDeltas !== undefined) {
      const packed = snapshot.packedDeltas;
      if ((!Array.isArray(packed) && !(packed instanceof Int32Array)) || packed.length % 4) throw new Error("Invalid packed chunk deltas.");
      for (let index = 0; index < packed.length; index += 4) {
        const entry = [requireLocalCoordinate(packed[index], size, "localX"), requireI32(packed[index + 1], "worldY"), requireLocalCoordinate(packed[index + 2], size, "localZ"), requireInteger(packed[index + 3], 0, 0xffff, "blockId")];
        byCoordinate.set(coordinateKey(entry[0], entry[1], entry[2]), entry); yield;
      }
    } else for (const raw of snapshot.deltas ?? []) {
      const worldX = optionalInteger(raw?.worldX ?? raw?.x);
      const worldY = requireI32(raw?.worldY ?? raw?.y, "worldY");
      const worldZ = optionalInteger(raw?.worldZ ?? raw?.z);
      const localX = requireLocalCoordinate(raw?.localX ?? (worldX === null ? null : worldX - chunkX * size), size, "localX");
      const localZ = requireLocalCoordinate(raw?.localZ ?? (worldZ === null ? null : worldZ - chunkZ * size), size, "localZ");
      const blockId = requireInteger(raw?.blockId ?? raw?.newBlockId ?? 0, 0, 0xffff, "blockId");
      byCoordinate.set(coordinateKey(localX, worldY, localZ), [localX, worldY, localZ, blockId]); yield;
    }
    // Bottom-up merge sort yields between comparisons; even very large restore
    // records cannot hide an unbounded Array.sort inside one application slice.
    let entries = [];
    for (const entry of byCoordinate.values()) { entries.push(entry); yield; }
    for (let width = 1; width < entries.length; width *= 2) {
      const merged = new Array(entries.length);
      for (let start = 0; start < entries.length; start += width * 2) {
        let left = start, right = Math.min(start + width, entries.length);
        const leftEnd = right, rightEnd = Math.min(start + width * 2, entries.length);
        for (let index = start; index < rightEnd; index++) {
          merged[index] = left < leftEnd && (right >= rightEnd || comparePackedDelta(entries[left], entries[right]) <= 0) ? entries[left++] : entries[right++]; yield;
        }
      }
      entries = merged;
    }
    const packedDeltas = [], deltas = [];
    let first = 0x811c9dc5, second = 0x9e3779b9;
    for (const [localX, worldY, localZ, blockId] of entries) {
      for (const integer of [localX, worldY, localZ, blockId]) {
        const index = packedDeltas.length; packedDeltas.push(integer);
        let value = integer | 0;
        for (let byte = 0; byte < 4; byte++) { const octet = value & 0xff; first = Math.imul(first ^ octet, 0x01000193); second = Math.imul(second ^ (octet + index + byte), 0x85ebca6b); second = (second << 13) | (second >>> 19); value >>= 8; }
      }
      deltas.push({ worldX: chunkX * size + localX, worldY, worldZ: chunkZ * size + localZ, localX, localY: worldY, localZ, blockId, source: "chain" }); yield;
    }
    result = rememberCanonical({ id: snapshot.id ?? `${chunkX},${chunkZ}`, chunkX, chunkZ, chunkSize: size, contextSlot: optionalContextSlot(snapshot.contextSlot), packedDeltas, fingerprint: `v1:${deltas.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`, deltas });
  }
  const iterator = prepare();
  return { get done() { return done; }, get result() { return result; }, step({ maxEntries = 64, budgetMs = 1 } = {}) {
    const started = performance.now(); let processed = 0;
    while (!done && processed < maxEntries) { done = iterator.next().done; processed++; if (performance.now() - started >= budgetMs) break; }
    return { done, processed, elapsedMs: performance.now() - started };
  } };
}

export function sameCanonicalChunkSnapshot(left, right) {
  if (!left || !right || left.fingerprint !== right.fingerprint) return false;
  const a = left.packedDeltas;
  const b = right.packedDeltas;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function compactCanonicalChunkSnapshot(snapshot) {
  const canonical = reusableCanonical(snapshot, snapshot.chunkSize);
  if (!canonical) throw new Error("Canonical chunk provenance is unavailable.");
  return { version: 1, chunkX: canonical.chunkX, chunkZ: canonical.chunkZ,
    chunkSize: canonical.chunkSize, contextSlot: canonical.contextSlot,
    count: canonical.deltas.length, fingerprint: canonical.fingerprint,
    packedDeltas: Int32Array.from(canonical.packedDeltas) };
}

// A Worker message is an input boundary. Validate its compact sorted form in
// linear, yielding work instead of running deduplication and sorting again.
export async function validateCompactCanonicalChunkSnapshot(record, { chunkX, chunkZ, chunkSize = 16, contextSlot = null, maxRecords = 4096 } = {}) {
  if (record?.version !== 1 || record.chunkX !== chunkX || record.chunkZ !== chunkZ
    || record.chunkSize !== chunkSize || record.contextSlot !== optionalContextSlot(contextSlot)
    || !Number.isInteger(record.count) || record.count < 0 || record.count > maxRecords
    || !(record.packedDeltas instanceof Int32Array) || record.packedDeltas.length !== record.count * 4) {
    throw new Error("Invalid canonical chunk transport header.");
  }
  work.transportValidations++;
  const packedDeltas = [], deltas = [];
  let first = 0x811c9dc5, second = 0x9e3779b9, started = performance.now();
  let previousX = -1, previousY = -Infinity, previousZ = -1;
  for (let offset = 0; offset < record.packedDeltas.length; offset += 4) {
    const localX = requireLocalCoordinate(record.packedDeltas[offset], chunkSize, "localX");
    const worldY = requireI32(record.packedDeltas[offset + 1], "worldY");
    const localZ = requireLocalCoordinate(record.packedDeltas[offset + 2], chunkSize, "localZ");
    const blockId = requireInteger(record.packedDeltas[offset + 3], 0, 0xffff, "blockId");
    if (worldY < previousY || worldY === previousY && (localZ < previousZ || localZ === previousZ && localX <= previousX)) {
      throw new Error("Canonical chunk coordinates are duplicated or out of order.");
    }
    previousX = localX; previousY = worldY; previousZ = localZ;
    for (const integer of [localX, worldY, localZ, blockId]) {
      const index = packedDeltas.length; packedDeltas.push(integer);
      let value = integer | 0;
      for (let byte = 0; byte < 4; byte++) {
        const octet = value & 0xff;
        first = Math.imul(first ^ octet, 0x01000193);
        second = Math.imul(second ^ (octet + index + byte), 0x85ebca6b);
        second = (second << 13) | (second >>> 19); value >>= 8;
      }
    }
    deltas.push(Object.freeze({ worldX: chunkX * chunkSize + localX, worldY,
      worldZ: chunkZ * chunkSize + localZ, localX, localY: worldY, localZ, blockId, source: "chain" }));
    if ((offset / 4 + 1) % 128 === 0 || performance.now() - started >= 1) {
      await yieldChunkSyncTask(); started = performance.now();
    }
  }
  const fingerprint = `v1:${deltas.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
  if (fingerprint !== record.fingerprint) throw new Error("Canonical chunk transport fingerprint mismatch.");
  return rememberCanonical({ id: `${chunkX},${chunkZ}`, chunkX, chunkZ, chunkSize,
    contextSlot: optionalContextSlot(contextSlot), packedDeltas, deltas, fingerprint });
}

function comparePackedDelta(a, b) {
  work.sortComparisons++;
  return a[1] - b[1] || a[2] - b[2] || a[0] - b[0] || a[3] - b[3];
}

function coordinateKey(localX, worldY, localZ) {
  return `${localX}:${worldY}:${localZ}`;
}

function optionalInteger(value) {
  if (value === null || value === undefined) return null;
  return requireI32(value, "coordinate");
}

function requireLocalCoordinate(value, chunkSize, name) {
  return requireInteger(value, 0, chunkSize - 1, name);
}

function requireI32(value, name) {
  return requireInteger(value, -0x80000000, 0x7fffffff, name);
}

function requireInteger(value, min, max, name) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) throw new Error(`Invalid ${name}.`);
  return normalized;
}
