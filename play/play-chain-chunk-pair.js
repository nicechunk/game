import { describeAccount, validateAccountDescriptor } from "./play-chain-chunk-codec.js";
import { canonicalizeChunkSnapshotAsync, compactCanonicalChunkSnapshot, validateCompactCanonicalChunkSnapshot } from "./play-chain-chunk-canonical.js";
import { yieldChunkSyncTask } from "./play-chain-batch-scheduler.js";

export const CHUNK_PAIR_SCHEMA = "chain-chunk-pair-v1-finalized";
const trustedComponents = new WeakSet(), trustedPairs = new WeakSet();
const work = { componentDecodeCount: 0, rawDigestHit: 0, rawDigestComputations: 0, canonicalUnchanged: 0, baselineMiss: 0 };
export function chunkPairWorkSnapshot() { return { ...work }; }
export function validChunkPairBaseline(pair, { scope, pubkeys, chunkX, chunkZ } = {}) {
  return !!pair && trustedPairs.has(pair) && pair.schema === CHUNK_PAIR_SCHEMA && pair.scope === scope
    && pair.commitment === "finalized" && Number.isSafeInteger(pair.knownAtSlot) && pair.knownAtSlot >= 0
    && pair.chunkX === chunkX && pair.chunkZ === chunkZ
    && pair.broken.pubkey === pubkeys?.[0] && pair.placed.pubkey === pubkeys?.[1];
}

// Only finalized, immutable observations enter this layer. Pending/hints stay in ChunkState.
export async function decodeVerifiedChunkPairs(batch, observations, options) {
  if (!Array.isArray(observations) || observations.length !== batch.length * 2) throw new Error("Invalid account observation count.");
  const pairs = [], errors = [];
  for (let index = 0; index < batch.length; index++) {
    const target = batch[index], id = target.id ?? target.chunkX + "," + target.chunkZ;
    try {
      const pubkeys = observations.slice(index * 2, index * 2 + 2).map(item => item?.pubkey);
      const baseline = options.baselines?.[id] ?? null;
      const pair = await composeVerifiedChunkPair(target, observations.slice(index * 2, index * 2 + 2),
        { ...options, pubkeys, baseline });
      pairs.push(pair);
    } catch (error) { if (options.signal?.aborted) throw error; errors.push({ id, error: String(error?.message || error).slice(0, 140) }); }
    if (index % 8 === 7) await yieldChunkSyncTask();
  }
  return { pairs, errors };
}

export async function composeVerifiedChunkPair(target, observations, options) {
  abort(options.signal);
  const { scope, pubkeys, contextSlot: slot, changedSinceSlot: threshold = null } = options;
  if (!scope || !Number.isSafeInteger(slot) || slot < 0 || !Array.isArray(pubkeys) || pubkeys.length !== 2) throw new Error("Invalid pair authority.");
  let baseline = options.baseline;
  if (baseline && !validChunkPairBaseline(baseline, { ...target, scope, pubkeys })) {
    // Worker/IDB inputs lose in-process provenance. Verify once before use.
    baseline = await restoreVerifiedChunkPair(baseline, { ...options, ...target, pubkeys });
  }
  if (baseline && slot < baseline.knownAtSlot) throw new Error("Regressing pair context.");
  const components = [];
  for (let side = 0; side < 2; side++) {
    const kind = side ? "placed" : "broken", observation = observations[side], previous = baseline?.[kind];
    if (!observation || observation.pubkey !== pubkeys[side]) throw new Error("Account order mismatch.");
    if (observation.kind === "unchanged") {
      if (!previous?.present || !Number.isSafeInteger(threshold) || threshold > baseline.knownAtSlot || slot < baseline.knownAtSlot) {
        work.baselineMiss++; throw new Error("Unchanged account has no captured finalized baseline.");
      }
      components.push(previous); continue;
    }
    if (observation.kind !== "full" && observation.kind !== "absent") throw new Error("Invalid account observation.");
    if (observation.kind === "absent" && previous && !previous.present) { work.rawDigestHit++; components.push(previous); continue; }
    components.push(await decodeComponent(observation.kind === "full" ? observation.account : null, kind, pubkeys[side], options, previous));
  }
  const [broken, placed] = components;
  let canonical;
  if (baseline && baseline.broken === broken && baseline.placed === placed) {
    work.canonicalUnchanged++; canonical = baseline.canonical;
  } else {
    const packedDeltas = [], projection = new Map();
    for (const component of components) {
      for (let offset = 0; offset < component.records.length; offset += 5) {
        const [x, y, z, blockId] = component.records.slice(offset, offset + 4);
        projection.set(x + ":" + y + ":" + z, [x, y, z, blockId]);
      }
    }
    const unchanged = baseline && projection.size === baseline.canonical.deltas.length
      && baseline.canonical.deltas.every(delta => projection.get(delta.localX + ":" + delta.worldY + ":" + delta.localZ)?.[3] === delta.blockId);
    if (unchanged) { work.canonicalUnchanged++; canonical = baseline.canonical; }
    else {
      for (const row of projection.values()) packedDeltas.push(...row);
      canonical = await canonicalizeChunkSnapshotAsync({ ...target, packedDeltas, contextSlot: slot }, { chunkSize: options.chunkSize || 16 });
    }
  }
  const pairToken = baseline && baseline.broken.rawDigest === broken.rawDigest && baseline.placed.rawDigest === placed.rawDigest
    ? baseline.pairToken : await digest(["nicechunk-pair-v1", scope, target.chunkX, target.chunkZ, broken.rawDigest, placed.rawDigest]);
  abort(options.signal);
  return rememberPair({ schema: CHUNK_PAIR_SCHEMA, scope, id: target.id ?? target.chunkX + "," + target.chunkZ,
    chunkX: target.chunkX, chunkZ: target.chunkZ, pairToken, broken, placed, canonical,
    knownAtSlot: slot, commitment: "finalized", readStartedAt: options.readStartedAt,
    authoritativeObservedAt: options.observedAt, byteLength: pairBytes(broken, placed, canonical) });
}

async function decodeComponent(account, kind, pubkey, options, previous) {
  const raw = account === null ? new Uint8Array() : account?.data;
  if (!(raw instanceof Uint8Array) || raw.buffer.byteLength !== raw.byteLength && raw.byteLength === 0) throw new Error("Missing or detached account bytes.");
  const descriptor = describeAccount(account, raw, kind);
  validateAccountDescriptor(descriptor, kind, options);
  const rawDigest = await componentDigest(options.scope, pubkey, kind, descriptor, raw);
  if (previous && previous.rawDigest === rawDigest) { work.rawDigestHit++; return previous; }
  const bytes = raw.slice(), records = [], seen = new Set(), view = new DataView(bytes.buffer);
  if (descriptor.present) work.componentDecodeCount++;
  for (let row = 0; row < descriptor.count; row++) {
    const offset = 16 + row * (kind === "broken" ? 3 : 9);
    const coordinate = bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
    const x = coordinate & 15, z = coordinate >> 4 & 15, y = descriptor.minY + (coordinate >> 8 & 511);
    const block = kind === "placed" ? view.getUint16(offset + 3, true) : 0;
    const volume = kind === "placed" ? view.getUint32(offset + 5, true) : 0;
    if (coordinate >>> 17 || seen.has(coordinate) || x >= (options.chunkSize || 16) || z >= (options.chunkSize || 16)
      || kind === "placed" && (!block || !volume)) throw new Error("Invalid account coordinate/record.");
    seen.add(coordinate); records.push(x, y, z, block, volume);
    if (row % 128 === 127) { await yieldChunkSyncTask(); abort(options.signal); }
  }
  const component = Object.freeze({ kind, pubkey, present: descriptor.present, descriptor: Object.freeze(descriptor), rawDigest,
    rawBytes: bytes, records: Object.freeze(records) });
  trustedComponents.add(component);
  return component;
}

// Restored bytes and records must agree; corruption affects only this pair.
// Used at disk and Worker boundaries. Live main-thread baselines skip this path.
export async function restoreVerifiedChunkPair(record, options) {
  if (!record || record.schema !== CHUNK_PAIR_SCHEMA || record.scope !== options.scope
    || record.chunkX !== options.chunkX || record.chunkZ !== options.chunkZ || record.commitment !== "finalized"
    || !Number.isSafeInteger(record.knownAtSlot) || record.knownAtSlot < 0
    || !Number.isFinite(record.authoritativeObservedAt) || record.authoritativeObservedAt < 0) throw new Error("Invalid stored pair header.");
  const components = [];
  for (const [index, kind] of ["broken", "placed"].entries()) {
    let component = record[kind]; const pubkey = options.pubkeys[index];
    const captured = options.baseline?.[kind];
    if (captured?.rawDigest === component?.rawDigest && captured.pubkey === pubkey) component = captured;
    if (!component || component.kind !== kind || component.pubkey !== pubkey
      || !(component.rawBytes instanceof Uint8Array) || !Array.isArray(component.records)) throw new Error("Invalid stored component.");
    if (trustedComponents.has(component)) { components.push(component); continue; }
    const account = component.present ? { ...component.descriptor, data: component.rawBytes } : null;
    const validated = await decodeComponent(account, kind, pubkey, options);
    if (validated.rawDigest !== component.rawDigest || validated.records.length !== component.records.length
      || validated.records.some((value, i) => value !== component.records[i])) throw new Error("Stored component integrity mismatch.");
    components.push(validated);
  }
  const canonical = await validateCompactCanonicalChunkSnapshot({ version: 1, chunkX: record.chunkX, chunkZ: record.chunkZ,
    chunkSize: options.chunkSize || 16, contextSlot: record.knownAtSlot, count: record.canonical?.packedDeltas?.length / 4,
    packedDeltas: Int32Array.from(record.canonical?.packedDeltas || []), fingerprint: record.canonical?.fingerprint },
    { ...record, chunkSize: options.chunkSize || 16, contextSlot: record.knownAtSlot });
  const projection = new Map();
  for (const component of components) for (let offset = 0; offset < component.records.length; offset += 5) {
    const row = component.records;
    projection.set(row[offset] + ":" + row[offset + 1] + ":" + row[offset + 2], row[offset + 3]);
  }
  if (projection.size !== canonical.deltas.length || canonical.deltas.some(delta =>
    projection.get(delta.localX + ":" + delta.worldY + ":" + delta.localZ) !== delta.blockId)) throw new Error("Stored pair projection mismatch.");
  const [broken, placed] = components;
  const pairToken = await digest(["nicechunk-pair-v1", record.scope, record.chunkX, record.chunkZ, broken.rawDigest, placed.rawDigest]);
  if (pairToken !== record.pairToken) throw new Error("Stored pair integrity mismatch.");
  return rememberPair({ ...record, broken, placed, canonical, byteLength: pairBytes(broken, placed, canonical) });
}

export function compactVerifiedChunkPair(pair, baseline) {
  if (baseline?.pairToken === pair.pairToken) return { id: pair.id, pairToken: pair.pairToken,
    knownAtSlot: pair.knownAtSlot, authoritativeObservedAt: pair.authoritativeObservedAt, readStartedAt: pair.readStartedAt, unchanged: true };
  return { ...pair, canonical: compactCanonicalChunkSnapshot({ ...pair.canonical, contextSlot: pair.knownAtSlot }) };
}
export async function validateWorkerChunkPair(record, target, options) {
  const baseline = options.baseline;
  if (record?.knownAtSlot !== options.contextSlot || record?.id !== target.id) throw new Error("Worker pair context/identity mismatch.");
  if (record?.unchanged) {
    if (!validChunkPairBaseline(baseline, { ...target, ...options }) || baseline.pairToken !== record.pairToken
      || !Number.isSafeInteger(record.knownAtSlot) || record.knownAtSlot < baseline.knownAtSlot) throw new Error("Worker baseline mismatch.");
    return rememberPair({ ...baseline, knownAtSlot: record.knownAtSlot, authoritativeObservedAt: options.observedAt, readStartedAt: options.readStartedAt });
  }
  const pair = await restoreVerifiedChunkPair(record, { ...options, ...target });
  return pair;
}

function rememberPair(pair) { Object.freeze(pair); trustedPairs.add(pair); return pair; }
export function pairBytes(broken, placed, canonical) {
  // Typed byte sizes are exact; JS records use a conservative admission charge.
  return 2048 + broken.rawBytes.byteLength + placed.rawBytes.byteLength + (broken.records.length + placed.records.length) * 16 + canonical.packedDeltas.length * 64;
}
async function componentDigest(scope, pubkey, kind, descriptor, bytes) {
  work.rawDigestComputations++;
  const domain = new TextEncoder().encode(JSON.stringify(["nicechunk-component-v1", scope, pubkey, kind, descriptor]));
  const input = new Uint8Array(domain.length + bytes.length); input.set(domain); input.set(bytes, domain.length);
  return hex(await crypto.subtle.digest("SHA-256", input));
}
async function digest(value) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))); }
function hex(buffer) { return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join(""); }
function equal(a, b) { return a?.length === b?.length && a.every((value, i) => value === b[i]); }
function abort(signal) { if (signal?.aborted) throw Object.assign(new Error("Chunk pair cancelled."), { name: "AbortError" }); }
