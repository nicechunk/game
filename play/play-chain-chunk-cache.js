const DB_NAME = "nicechunk-chain-chunk-cache";
const DB_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const CACHE_SCHEMA = "chain-chunk-snapshot-v1";
const DEFAULT_MAX_RECORDS = 4096;
const DEFAULT_MAX_DELTAS = 262_144;
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60_000;
const memorySnapshots = new Map();

export function createPlayChainChunkCache({
  getScope = () => "default",
  indexedDBFactory = globalThis.indexedDB,
  memoryStore = memorySnapshots,
  maxRecords = DEFAULT_MAX_RECORDS,
  maxDeltas = DEFAULT_MAX_DELTAS,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  now = () => Date.now(),
} = {}) {
  let databasePromise = null;
  let lastPruneAt = 0;
  let lastError = "";
  let reads = 0;
  let hits = 0;
  let writes = 0;

  return {
    getVerifiedSnapshots,
    putVerifiedSnapshots,
    clearScope,
    prune,
    snapshot,
  };

  async function getVerifiedSnapshots(targets = [], { chunkSize = 16 } = {}) {
    const activeScope = scope();
    const normalizedTargets = uniqueTargets(targets);
    if (!normalizedTargets.length) return [];
    reads += normalizedTargets.length;
    const keys = normalizedTargets.map((target) => snapshotKey(activeScope, target.chunkX, target.chunkZ));
    let records;
    try {
      records = await readRecords(keys);
      lastError = "";
    } catch (error) {
      lastError = readableError(error);
      records = keys.map((key) => memoryStore.get(key) ?? null);
    }

    const currentTime = Math.max(0, Math.trunc(Number(now()) || 0));
    const snapshots = [];
    const invalidKeys = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record) continue;
      try {
        if (record.schema !== CACHE_SCHEMA || record.scope !== activeScope || record.key !== keys[index]) {
          throw new Error("Chunk cache namespace mismatch.");
        }
        if (currentTime - finiteTimestamp(record.verifiedAt) > normalizedMaxAge()) {
          invalidKeys.push(record.key);
          continue;
        }
        const canonical = canonicalizeChunkSnapshot({
          chunkX: record.chunkX,
          chunkZ: record.chunkZ,
          contextSlot: record.contextSlot,
          packedDeltas: record.packedDeltas,
        }, { chunkSize });
        if (record.fingerprint !== canonical.fingerprint || record.deltaCount !== canonical.deltas.length) {
          throw new Error("Chunk cache fingerprint mismatch.");
        }
        snapshots.push({
          ...canonical,
          id: normalizedTargets[index].id,
          verifiedAt: finiteTimestamp(record.verifiedAt),
          fromPersistentCache: true,
        });
        memoryStore.set(record.key, record);
        hits += 1;
      } catch {
        invalidKeys.push(keys[index]);
      }
    }
    if (invalidKeys.length) void removeRecords(invalidKeys).catch(() => {});
    return snapshots;
  }

  async function putVerifiedSnapshots(snapshots = [], { chunkSize = 16 } = {}) {
    const activeScope = scope();
    const verifiedAt = Math.max(0, Math.trunc(Number(now()) || 0));
    const byKey = new Map();
    for (const snapshotValue of snapshots ?? []) {
      const canonical = canonicalizeChunkSnapshot(snapshotValue, { chunkSize });
      const key = snapshotKey(activeScope, canonical.chunkX, canonical.chunkZ);
      byKey.set(key, {
        key,
        schema: CACHE_SCHEMA,
        scope: activeScope,
        chunkX: canonical.chunkX,
        chunkZ: canonical.chunkZ,
        chunkSize: canonical.chunkSize,
        contextSlot: canonical.contextSlot,
        fingerprint: canonical.fingerprint,
        deltaCount: canonical.deltas.length,
        packedDeltas: canonical.packedDeltas,
        verified: true,
        verifiedAt,
      });
    }
    const records = [...byKey.values()];
    if (!records.length) return 0;
    for (const record of records) memoryStore.set(record.key, cloneRecord(record));
    try {
      await writeRecords(records);
      lastError = "";
    } catch (error) {
      lastError = readableError(error);
    }
    writes += records.length;
    schedulePrune();
    return records.length;
  }

  async function clearScope(scopeValue = scope()) {
    const normalizedScope = normalizeScope(scopeValue);
    for (const [key, value] of memoryStore) {
      if (value?.scope === normalizedScope) memoryStore.delete(key);
    }
    try {
      const database = await openDatabase();
      if (!database) return;
      const records = await requestResult(database.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).getAll());
      const keys = (records ?? []).filter((record) => record?.scope === normalizedScope).map((record) => record.key);
      if (keys.length) await deleteDatabaseRecords(database, keys);
      lastError = "";
    } catch (error) {
      lastError = readableError(error);
    }
  }

  async function prune() {
    const currentTime = Math.max(0, Math.trunc(Number(now()) || 0));
    try {
      const database = await openDatabase();
      const records = database
        ? await requestResult(database.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).getAll())
        : [...memoryStore.values()];
      const staleKeys = pruneKeys(records ?? [], {
        currentTime,
        maxAge: normalizedMaxAge(),
        recordLimit: Math.max(1, Math.trunc(Number(maxRecords) || DEFAULT_MAX_RECORDS)),
        deltaLimit: Math.max(1, Math.trunc(Number(maxDeltas) || DEFAULT_MAX_DELTAS)),
      });
      for (const key of staleKeys) memoryStore.delete(key);
      if (database && staleKeys.length) await deleteDatabaseRecords(database, staleKeys);
      lastError = "";
      return staleKeys.length;
    } catch (error) {
      lastError = readableError(error);
      return 0;
    }
  }

  function snapshot() {
    return {
      schema: CACHE_SCHEMA,
      scope: scope(),
      reads,
      hits,
      writes,
      lastError,
      memoryRecords: memoryStore.size,
    };
  }

  function scope() {
    return normalizeScope(getScope?.());
  }

  function normalizedMaxAge() {
    return Math.max(60_000, Math.trunc(Number(maxAgeMs) || DEFAULT_MAX_AGE_MS));
  }

  function schedulePrune() {
    const currentTime = Math.max(0, Math.trunc(Number(now()) || 0));
    if (currentTime - lastPruneAt < PRUNE_INTERVAL_MS) return;
    lastPruneAt = currentTime;
    const run = () => void prune();
    if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 0);
  }

  async function readRecords(keys) {
    const database = await openDatabase();
    if (!database) return keys.map((key) => memoryStore.get(key) ?? null);
    const store = database.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE);
    return Promise.all(keys.map((key) => requestResult(store.get(key))));
  }

  async function writeRecords(records) {
    const database = await openDatabase();
    if (!database) return;
    await transactionComplete(database.transaction(SNAPSHOT_STORE, "readwrite"), (store) => {
      for (const record of records) store.put(record);
    });
  }

  async function removeRecords(keys) {
    for (const key of keys) memoryStore.delete(key);
    const database = await openDatabase();
    if (database && keys.length) await deleteDatabaseRecords(database, keys);
  }

  function openDatabase() {
    if (!indexedDBFactory?.open) return Promise.resolve(null);
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve) => {
      let request;
      try {
        request = indexedDBFactory.open(DB_NAME, DB_VERSION);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
          const store = database.createObjectStore(SNAPSHOT_STORE, { keyPath: "key" });
          store.createIndex("scope", "scope", { unique: false });
          store.createIndex("verifiedAt", "verifiedAt", { unique: false });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return databasePromise;
  }
}

export function canonicalizeChunkSnapshot(snapshot = {}, { chunkSize = 16 } = {}) {
  const size = Math.max(1, Math.trunc(Number(chunkSize) || 16));
  const chunkX = requireI32(snapshot.chunkX, "chunkX");
  const chunkZ = requireI32(snapshot.chunkZ, "chunkZ");
  const byCoordinate = new Map();
  if (snapshot.packedDeltas !== undefined) {
    const packed = normalizePackedDeltas(snapshot.packedDeltas, size);
    for (let index = 0; index < packed.length; index += 4) {
      const entry = packed.slice(index, index + 4);
      byCoordinate.set(coordinateKey(entry[0], entry[1], entry[2]), entry);
    }
  } else {
    for (const raw of snapshot.deltas ?? []) {
      const worldX = optionalInteger(raw?.worldX ?? raw?.x);
      const worldY = requireI32(raw?.worldY ?? raw?.y, "worldY");
      const worldZ = optionalInteger(raw?.worldZ ?? raw?.z);
      const localX = requireLocalCoordinate(raw?.localX ?? (worldX === null ? null : worldX - chunkX * size), size, "localX");
      const localZ = requireLocalCoordinate(raw?.localZ ?? (worldZ === null ? null : worldZ - chunkZ * size), size, "localZ");
      const blockId = requireInteger(raw?.blockId ?? raw?.newBlockId ?? 0, 0, 0xffff, "blockId");
      byCoordinate.set(coordinateKey(localX, worldY, localZ), [localX, worldY, localZ, blockId]);
    }
  }
  const entries = [...byCoordinate.values()].sort(comparePackedDelta);
  const packedDeltas = entries.flat();
  return {
    id: snapshot.id ?? `${chunkX},${chunkZ}`,
    chunkX,
    chunkZ,
    chunkSize: size,
    contextSlot: Math.max(0, Math.trunc(Number(snapshot.contextSlot) || 0)),
    packedDeltas,
    fingerprint: fingerprintPackedDeltas(packedDeltas),
    deltas: entries.map(([localX, worldY, localZ, blockId]) => ({
      worldX: chunkX * size + localX,
      worldY,
      worldZ: chunkZ * size + localZ,
      localX,
      localY: worldY,
      localZ,
      blockId,
      source: "chain",
    })),
  };
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

function normalizePackedDeltas(value, chunkSize) {
  if (!Array.isArray(value) || value.length % 4 !== 0) throw new Error("Invalid packed chunk deltas.");
  const packed = [];
  for (let index = 0; index < value.length; index += 4) {
    packed.push(
      requireLocalCoordinate(value[index], chunkSize, "localX"),
      requireI32(value[index + 1], "worldY"),
      requireLocalCoordinate(value[index + 2], chunkSize, "localZ"),
      requireInteger(value[index + 3], 0, 0xffff, "blockId"),
    );
  }
  return packed;
}

function fingerprintPackedDeltas(packed) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < packed.length; index += 1) {
    let value = packed[index] | 0;
    for (let byte = 0; byte < 4; byte += 1) {
      const octet = value & 0xff;
      first = Math.imul(first ^ octet, 0x01000193);
      second = Math.imul(second ^ (octet + index + byte), 0x85ebca6b);
      second = (second << 13) | (second >>> 19);
      value >>= 8;
    }
  }
  return `v1:${packed.length / 4}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
}

function comparePackedDelta(a, b) {
  return a[1] - b[1] || a[2] - b[2] || a[0] - b[0] || a[3] - b[3];
}

function coordinateKey(localX, worldY, localZ) {
  return `${localX}:${worldY}:${localZ}`;
}

function uniqueTargets(targets) {
  const byCoordinate = new Map();
  for (const target of targets ?? []) {
    const chunkX = requireI32(target?.chunkX, "chunkX");
    const chunkZ = requireI32(target?.chunkZ, "chunkZ");
    byCoordinate.set(`${chunkX},${chunkZ}`, {
      id: target?.id ?? `${chunkX},${chunkZ}`,
      chunkX,
      chunkZ,
    });
  }
  return [...byCoordinate.values()];
}

function snapshotKey(scope, chunkX, chunkZ) {
  return `${CACHE_SCHEMA}|${scope}|${requireI32(chunkX, "chunkX")},${requireI32(chunkZ, "chunkZ")}`;
}

function normalizeScope(value) {
  const normalized = String(value || "default").trim();
  return normalized || "default";
}

function pruneKeys(records, { currentTime, maxAge, recordLimit, deltaLimit }) {
  const sorted = [...records].sort((a, b) => finiteTimestamp(b?.verifiedAt) - finiteTimestamp(a?.verifiedAt));
  const stale = new Set();
  let keptRecords = 0;
  let keptDeltas = 0;
  for (const record of sorted) {
    if (!record?.key || record.schema !== CACHE_SCHEMA) {
      if (record?.key) stale.add(record.key);
      continue;
    }
    const age = currentTime - finiteTimestamp(record.verifiedAt);
    const deltaCount = Math.max(0, Math.trunc(Number(record.deltaCount) || 0));
    const fits = keptRecords < recordLimit && (keptRecords === 0 || keptDeltas + deltaCount <= deltaLimit);
    if (age > maxAge || !fits) {
      stale.add(record.key);
      continue;
    }
    keptRecords += 1;
    keptDeltas += deltaCount;
  }
  return [...stale];
}

function deleteDatabaseRecords(database, keys) {
  return transactionComplete(database.transaction(SNAPSHOT_STORE, "readwrite"), (store) => {
    for (const key of keys) store.delete(key);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction, apply) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
    apply(transaction.objectStore(SNAPSHOT_STORE));
  });
}

function cloneRecord(value) {
  return {
    ...value,
    packedDeltas: [...(value.packedDeltas ?? [])],
  };
}

function finiteTimestamp(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
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

function readableError(error) {
  const message = String(error?.message || error || "unknown error");
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}
