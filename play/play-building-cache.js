const DB_NAME = "nicechunk-building-cache";
const DB_VERSION = 2;
const REGION_STORE = "regions";
const BUILDING_STORE = "buildings";
// Blueprint-v2 invalidates the pre-identity foundation cache. Only Guardian
// manifests verified under the one-blueprint/one-foundation model are reused.
const CACHE_SCHEMA = "guardian-blueprint-v3";
const memoryRegions = new Map();
const memoryBuildings = new Map();
let databasePromise = null;

export function createPlayBuildingCache({
  getScope = () => "default",
  maxRegions = 27,
  maxBuildings = 512,
} = {}) {
  let lastPruneAt = 0;
  return {
    getRegion,
    putVerifiedRegion,
    deleteRegion,
    getBuilding,
    getBuildings,
    putVerifiedBuilding,
    putVerifiedBuildings,
    prune,
  };

  async function getRegion(regionX, regionZ) {
    const key = regionCacheKey(scope(), regionX, regionZ);
    const value = await readRecord(REGION_STORE, key, memoryRegions);
    return value?.verified === true && value?.schema === CACHE_SCHEMA ? value : null;
  }

  async function putVerifiedRegion(manifest, foundations = []) {
    const regionX = requireI32(manifest?.regionX, "regionX");
    const regionZ = requireI32(manifest?.regionZ, "regionZ");
    const records = Array.isArray(manifest?.records) ? manifest.records.map(normalizeRecord) : [];
    const value = {
      key: regionCacheKey(scope(), regionX, regionZ),
      schema: CACHE_SCHEMA,
      scope: scope(),
      regionX,
      regionZ,
      revision: String(manifest?.revision ?? "0"),
      hash: normalizeHash(manifest?.hash),
      records,
      foundations: Array.isArray(foundations) ? foundations.map(normalizeFoundation) : [],
      verified: true,
      verifiedAt: Date.now(),
    };
    await writeRecord(REGION_STORE, value, memoryRegions);
    schedulePrune();
    return value;
  }

  async function deleteRegion(regionX, regionZ) {
    await removeRecord(REGION_STORE, regionCacheKey(scope(), regionX, regionZ), memoryRegions);
  }

  async function getBuilding(record) {
    return (await getBuildings([record]))[0] ?? null;
  }

  async function getBuildings(records = []) {
    const normalized = records.map((record) => normalizeRecord(record));
    const keys = normalized.map((record) => (
      record.activeRevision && !isZeroHash(record.contentHash)
        ? buildingCacheKey(scope(), record)
        : null
    ));
    const values = await readRecords(BUILDING_STORE, keys, memoryBuildings);
    return values.map((value) => (
      value?.verified === true && value?.schema === CACHE_SCHEMA ? value.building : null
    ));
  }

  async function putVerifiedBuilding(record, building) {
    return (await putVerifiedBuildings([{ record, building }]))[0] ?? null;
  }

  async function putVerifiedBuildings(entries = []) {
    const cacheScope = scope();
    const verifiedAt = Date.now();
    const values = [];
    for (const entry of entries) {
      const normalized = normalizeRecord(entry?.record);
      if (!normalized.activeRevision || isZeroHash(normalized.contentHash)) continue;
      values.push({
        key: buildingCacheKey(cacheScope, normalized),
        schema: CACHE_SCHEMA,
        scope: cacheScope,
        foundationId: normalized.foundationId,
        revision: normalized.activeRevision,
        contentHash: normalized.contentHash,
        building: normalizeBuilding(entry?.building, normalized),
        verified: true,
        verifiedAt,
      });
    }
    await writeRecords(BUILDING_STORE, values, memoryBuildings);
    schedulePrune();
    return values.map((value) => value.building);
  }

  async function prune() {
    await Promise.all([
      pruneStore(REGION_STORE, memoryRegions, maxRegions, scope()),
      pruneStore(BUILDING_STORE, memoryBuildings, maxBuildings, scope()),
    ]);
  }

  function schedulePrune() {
    const now = Date.now();
    if (now - lastPruneAt < 30_000) return;
    lastPruneAt = now;
    setTimeout(() => void prune(), 0);
  }

  function scope() {
    return `${CACHE_SCHEMA}:${String(getScope?.() || "default")}`;
  }
}

function normalizeRecord(record = {}) {
  const minX = requireI32(record.minX, "minX");
  const minZ = requireI32(record.minZ, "minZ");
  const width = requireU32(record.width, "width");
  const depth = requireU32(record.depth, "depth");
  return {
    foundationId: requireU64String(record.foundationId, "foundationId"),
    minX,
    minZ,
    maxX: minX + width - 1,
    maxZ: minZ + depth - 1,
    surfaceY: requireI16(record.surfaceY, "surfaceY"),
    flags: requireU16(record.flags ?? 1, "flags"),
    width,
    depth,
    activeRevision: requireU32(record.activeRevision ?? 0, "activeRevision"),
    contentHash: normalizeHash(record.contentHash),
    updatedSlot: requireU64String(record.updatedSlot ?? 0, "updatedSlot", { allowZero: true }),
  };
}

function normalizeFoundation(foundation = {}) {
  const record = normalizeRecord({
    ...foundation,
    flags: 1,
    contentHash: foundation.contentHash || "0".repeat(32),
  });
  return {
    ...record,
    id: String(foundation.id || `${foundation.owner || "foundation"}:${record.foundationId}`),
    owner: String(foundation.owner || ""),
    status: "active",
    sourcePda: String(foundation.sourcePda || ""),
    createdSlot: String(foundation.createdSlot || "0"),
    updatedSlot: String(foundation.updatedSlot || "0"),
    pendingRevision: requireU32(foundation.pendingRevision ?? 0, "pendingRevision"),
  };
}

function normalizeBuilding(building = {}, record) {
  return {
    id: String(building.id || `${record.foundationId}:building:${record.activeRevision}`),
    owner: String(building.owner || ""),
    foundationId: record.foundationId,
    foundation: String(building.foundation || ""),
    revision: record.activeRevision,
    quarterTurns: Math.max(0, Math.min(3, Math.trunc(Number(building.quarterTurns) || 0))),
    offsetX: requireI32(building.offsetX ?? 0, "offsetX"),
    offsetZ: requireI32(building.offsetZ ?? 0, "offsetZ"),
    code: String(building.code || ""),
    manifestPda: String(building.manifestPda || ""),
    updatedSlot: String(building.updatedSlot || "0"),
    contentHash: String(building.contentHash || record.contentHash).toLowerCase(),
  };
}

function regionCacheKey(scope, regionX, regionZ) {
  return `${scope}:region:${requireI32(regionX, "regionX")},${requireI32(regionZ, "regionZ")}`;
}

function buildingCacheKey(scope, record) {
  return `${scope}:building:${record.foundationId}:${record.activeRevision}:${record.contentHash}`;
}

function normalizeHash(value) {
  const hash = String(value || "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{32}$/.test(hash)) throw new Error("Invalid 16-byte building hash.");
  return hash;
}

function isZeroHash(hash) {
  return !hash || /^0+$/.test(hash);
}

function requireU64String(value, name, { allowZero = false } = {}) {
  const normalized = BigInt(value ?? 0);
  if (normalized < (allowZero ? 0n : 1n) || normalized > 0xffffffffffffffffn) throw new Error(`Invalid ${name}.`);
  return normalized.toString();
}

function requireI32(value, name) {
  return requireInteger(value, -0x80000000, 0x7fffffff, name);
}

function requireI16(value, name) {
  return requireInteger(value, -0x8000, 0x7fff, name);
}

function requireU16(value, name) {
  return requireInteger(value, 0, 0xffff, name);
}

function requireU32(value, name) {
  return requireInteger(value, 0, 0xffffffff, name);
}

function requireInteger(value, min, max, name) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) throw new Error(`Invalid ${name}.`);
  return normalized;
}

async function readRecord(storeName, key, memory) {
  const database = await openDatabase();
  if (!database) return memory.get(key) ?? null;
  return requestResult(database.transaction(storeName, "readonly").objectStore(storeName).get(key));
}

async function readRecords(storeName, keys, memory) {
  const database = await openDatabase();
  if (!database) return keys.map((key) => key ? memory.get(key) ?? null : null);
  const store = database.transaction(storeName, "readonly").objectStore(storeName);
  return Promise.all(keys.map((key) => key ? requestResult(store.get(key)) : null));
}

async function writeRecord(storeName, value, memory) {
  const database = await openDatabase();
  if (!database) {
    memory.set(value.key, structuredCloneSafe(value));
    return;
  }
  await transactionComplete(database.transaction(storeName, "readwrite"), (store) => store.put(value));
}

async function writeRecords(storeName, values, memory) {
  if (!values.length) return;
  const database = await openDatabase();
  if (!database) {
    for (const value of values) memory.set(value.key, structuredCloneSafe(value));
    return;
  }
  await transactionComplete(database.transaction(storeName, "readwrite"), (store) => {
    for (const value of values) store.put(value);
  });
}

async function removeRecord(storeName, key, memory) {
  const database = await openDatabase();
  if (!database) {
    memory.delete(key);
    return;
  }
  await transactionComplete(database.transaction(storeName, "readwrite"), (store) => store.delete(key));
}

async function pruneStore(storeName, memory, limitValue, scope) {
  const limit = Math.max(1, Math.trunc(Number(limitValue) || 1));
  const database = await openDatabase();
  if (!database) {
    const matches = [...memory.values()].filter((value) => value.scope === scope).sort((a, b) => b.verifiedAt - a.verifiedAt);
    for (const value of matches.slice(limit)) memory.delete(value.key);
    return;
  }
  const records = await requestResult(database.transaction(storeName, "readonly").objectStore(storeName).getAll());
  const stale = records.filter((value) => value.scope === scope).sort((a, b) => b.verifiedAt - a.verifiedAt).slice(limit);
  if (!stale.length) return;
  await transactionComplete(database.transaction(storeName, "readwrite"), (store) => {
    for (const value of stale) store.delete(value.key);
  });
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (!database.objectStoreNames.contains(REGION_STORE)) database.createObjectStore(REGION_STORE, { keyPath: "key" });
      if (!database.objectStoreNames.contains(BUILDING_STORE)) database.createObjectStore(BUILDING_STORE, { keyPath: "key" });
      if (event.oldVersion > 0 && event.oldVersion < DB_VERSION) {
        request.transaction.objectStore(REGION_STORE).clear();
        request.transaction.objectStore(BUILDING_STORE).clear();
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction, apply) {
  return new Promise((resolve, reject) => {
    apply(transaction.objectStore(transaction.objectStoreNames[0]));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}
