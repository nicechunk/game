import { canonicalizeChunkSnapshotAsync, compactCanonicalChunkSnapshot, validateCompactCanonicalChunkSnapshot } from "./play-chain-chunk-canonical.js";
import { optionalContextSlot, yieldChunkSyncTask } from "./play-chain-batch-scheduler.js";

const MAX_CAPACITY = 2048;
const HEADER_LENGTH = 16;
const FORMATS = Object.freeze({ broken: { magic: "NCBK", recordLength: 3 }, placed: { magic: "NCPB", recordLength: 9 } });

export async function decodeChunkAccountBatch(batch, infos, options = {}) {
  if (!Array.isArray(infos) || infos.length !== batch.length * 2) {
    throw new Error("Chunk PDA account batch length does not match the requested broken/placed pairs.");
  }
  const snapshots = [], errors = [];
  const chunkSize = options.chunkSize || 16, contextSlot = optionalContextSlot(options.contextSlot);
  for (let index = 0; index < batch.length; index++) {
    abortIfNeeded(options.signal);
    const chunk = batch[index], id = `${chunk.chunkX},${chunk.chunkZ}`;
    try {
      const packedDeltas = [], pair = [];
      for (const [kind, account] of [["broken", infos[index * 2]], ["placed", infos[index * 2 + 1]]]) {
        const bytes = account?.data instanceof Uint8Array ? account.data : new Uint8Array(account?.data || []);
        const descriptor = describeAccount(account, bytes, kind);
        validateAccountDescriptor(descriptor, kind, options);
        pair.push(descriptor);
        const coordinates = new Set();
        let stepStarted = performance.now();
        for (let row = 0; row < descriptor.count; row++) {
          const offset = HEADER_LENGTH + row * FORMATS[kind].recordLength;
          const coordinate = readU24(bytes, offset), localX = coordinate & 15, localZ = coordinate >> 4 & 15;
          if (coordinates.has(coordinate)) throw new Error(`Duplicate Chunk${kind === "broken" ? "Broken" : "Placed"} coordinate.`);
          coordinates.add(coordinate);
          if (localX >= chunkSize || localZ >= chunkSize) throw new Error("Chunk account coordinate exceeds chunk bounds.");
          const blockId = kind === "broken" ? 0 : readU16(bytes, offset + 3);
          if (kind === "placed" && (blockId === 0 || readU32(bytes, offset + 5) === 0)) throw new Error("Invalid ChunkPlaced record.");
          packedDeltas.push(localX, descriptor.minY + (coordinate >> 8 & 511), localZ, blockId);
          if ((row + 1) % 128 === 0 || performance.now() - stepStarted >= 1) {
            await yieldChunkSyncTask(); abortIfNeeded(options.signal); stepStarted = performance.now();
          }
        }
      }
      const canonical = await canonicalizeChunkSnapshotAsync({ id, chunkX: chunk.chunkX, chunkZ: chunk.chunkZ, contextSlot, packedDeltas }, { chunkSize });
      abortIfNeeded(options.signal);
      snapshots.push(options.compact ? { ...compactCanonicalChunkSnapshot(canonical), pair } : canonical);
    } catch (error) {
      abortIfNeeded(options.signal);
      errors.push({ id, error: String(error?.message || error).slice(0, 160) });
    }
    // A batch of empty accounts is also bounded work on the fallback path.
    if (index % 8 === 7) await yieldChunkSyncTask();
  }
  return { version: 1, authority: authorityKey(options), snapshots, errors };
}

export async function validateDecodedChunkAccountBatch(batch, decoded, options = {}) {
  if (decoded?.version !== 1 || decoded.authority !== authorityKey(options)
    || !Array.isArray(decoded.snapshots) || !Array.isArray(decoded.errors)
    || decoded.snapshots.length + decoded.errors.length !== batch.length) throw new Error("Invalid decoded chunk batch envelope.");
  const targets = new Map(batch.map(chunk => [`${chunk.chunkX},${chunk.chunkZ}`, chunk]));
  const snapshots = [], errors = [], seen = new Set();
  let sliceStarted = performance.now(), sliceRecords = 0;
  for (const record of decoded.snapshots) {
    abortIfNeeded(options.signal);
    const id = `${record.chunkX},${record.chunkZ}`, chunk = targets.get(id);
    if (!chunk || seen.has(id)) throw new Error("Decoded chunk batch contains an unexpected or duplicate pair.");
    seen.add(id);
    try {
      if (!Array.isArray(record.pair) || record.pair.length !== 2) throw new Error("Invalid canonical chunk account pair.");
      validateAccountDescriptor(record.pair[0], "broken", options);
      validateAccountDescriptor(record.pair[1], "placed", options);
      const minimumCount = Math.max(record.pair[0].count, record.pair[1].count);
      const maximumCount = record.pair[0].count + record.pair[1].count;
      if (record.count < minimumCount || record.count > maximumCount) throw new Error("Canonical chunk record count does not match its pair.");
      const canonical = await validateCompactCanonicalChunkSnapshot(record, {
        ...chunk, chunkSize: options.chunkSize || 16, contextSlot: options.contextSlot, maxRecords: MAX_CAPACITY * 2,
      });
      let airCount = 0, placedCount = 0;
      for (const delta of canonical.deltas) {
        const header = record.pair[delta.blockId ? 1 : 0];
        if (!header.count || delta.worldY < header.minY || delta.worldY > header.minY + 511) throw new Error("Canonical chunk Y range does not match its account.");
        if (delta.blockId) placedCount++; else airCount++;
      }
      if (airCount > record.pair[0].count || placedCount !== record.pair[1].count) throw new Error("Canonical chunk placement count does not match its account.");
      snapshots.push(canonical);
    } catch (error) { errors.push({ id, error: String(error?.message || error).slice(0, 160) }); }
    if (++sliceRecords >= 8 || performance.now() - sliceStarted >= 1) {
      await yieldChunkSyncTask(); abortIfNeeded(options.signal); sliceStarted = performance.now(); sliceRecords = 0;
    }
  }
  for (const error of decoded.errors) {
    if (!targets.has(error?.id) || seen.has(error.id) || typeof error.error !== "string") throw new Error("Invalid decoded chunk error identity.");
    seen.add(error.id); errors.push({ id: error.id, error: error.error.slice(0, 160) });
  }
  abortIfNeeded(options.signal);
  return { snapshots, errors };
}

function authorityKey(options) {
  return JSON.stringify([options.expectedOwner || "", options.globalConfig || "", options.chunkSize || 16,
    Number.isFinite(options.minY) ? options.minY : null]);
}

function describeAccount(account, bytes, kind) {
  const present = Boolean(account), hasData = bytes.length > 0;
  return { present, hasData, owner: String(account?.owner?.toBase58?.() ?? account?.owner ?? ""), executable: Boolean(account?.executable),
    byteLength: bytes.length, magic: hasData ? String.fromCharCode(...bytes.subarray(0, 4)) : "",
    version: hasData ? bytes[4] : 0, count: hasData ? readU16(bytes, 6) : 0,
    capacity: hasData ? readU16(bytes, 8) : 0, minY: hasData ? readI16(bytes, 10) : 0 };
}

function validateAccountDescriptor(record, kind, options) {
  const label = kind === "broken" ? "ChunkBroken" : "ChunkPlaced", format = FORMATS[kind];
  if (!record || typeof record.present !== "boolean" || typeof record.hasData !== "boolean"
    || typeof record.owner !== "string" || typeof record.executable !== "boolean") throw new Error(`Invalid ${label} account descriptor.`);
  if (record.present && options.expectedOwner && record.owner !== options.expectedOwner) throw new Error(`${label} account owner does not match the active chunk program.`);
  if (record.executable) throw new Error(`${label} account cannot be executable.`);
  if (!record.hasData) {
    if (record.byteLength !== 0 || record.count !== 0 || record.capacity !== 0 || record.magic !== "") throw new Error(`Invalid empty ${label} account.`);
    return;
  }
  if (!record.present || record.magic !== format.magic || record.version !== 1) throw new Error(`Invalid ${label} account magic or version.`);
  if (Number.isFinite(options.minY) && record.minY !== Math.trunc(options.minY)) throw new Error(`${label} minY does not match the active world.`);
  if (!Number.isInteger(record.minY) || record.minY < -32768 || record.minY > 32767
    || !Number.isInteger(record.count) || !Number.isInteger(record.capacity)
    || record.capacity < 1 || record.capacity > MAX_CAPACITY || record.count < 0 || record.count > record.capacity
    || record.byteLength !== HEADER_LENGTH + record.capacity * format.recordLength) throw new Error(`Invalid ${label} account size or capacity.`);
}

function readU16(bytes, offset) { return bytes[offset] | bytes[offset + 1] << 8; }
function readI16(bytes, offset) { const value = readU16(bytes, offset); return value & 0x8000 ? value - 0x10000 : value; }
function readU24(bytes, offset) { return bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16; }
function readU32(bytes, offset) { return (readU24(bytes, offset) | bytes[offset + 3] << 24) >>> 0; }
function abortIfNeeded(signal) { if (signal?.aborted) throw Object.assign(new Error("Chunk account decoding cancelled."), { name: "AbortError" }); }
