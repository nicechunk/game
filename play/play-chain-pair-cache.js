import { restoreVerifiedChunkPair } from "./play-chain-chunk-pair.js";

const memory = new Map(), memoryCharges = new WeakMap();
const STORE = "account-pairs";
export function createChunkPairCache({ getScope, openDatabase, memoryStore = memory, maxRecords = 2048,
  maxBytes = 64 * 1024 * 1024, now = () => Date.now() } = {}) {
  const pending = new Map(), lastStored = new Map();
  let charge = memoryCharges.get(memoryStore);
  if (!charge) { charge = { bytes: [...memoryStore.values()].reduce((sum, pair) => sum + pair.byteLength, 0) }; memoryCharges.set(memoryStore, charge); }
  let timer = null, pruning = false, lastPrune = 0, lastError = "", reads = 0, hits = 0, writes = 0, evictions = 0;
  const keyFor = target => JSON.stringify([getScope(), target.chunkX, target.chunkZ]);
  const touch = (key, pair) => { charge.bytes -= memoryStore.get(key)?.byteLength || 0; memoryStore.delete(key); memoryStore.set(key, pair); charge.bytes += pair.byteLength; trim(); };
  function trim() {
    for (const [key, pair] of memoryStore) {
      if (memoryStore.size <= maxRecords && charge.bytes <= maxBytes) break;
      charge.bytes -= pair.byteLength; memoryStore.delete(key); evictions++;
    }
  }
  function peek(target) {
    const key = keyFor(target), pair = memoryStore.get(key);
    if (!pair) return null;
    touch(key, pair); hits++; return pair;
  }
  async function get(targets, options = {}) {
    const scope = getScope(), result = [];
    const missing = [];
    for (const target of targets) { reads++; const pair = peek(target); if (pair) { result.push(pair); await options.onPair?.(pair); } else missing.push(target); }
    if (!missing.length) return result;
    try {
      const db = await openDatabase();
      if (!db || scope !== getScope()) return result;
      const transaction = db.transaction(STORE, "readonly"), store = transaction.objectStore(STORE);
      const records = await Promise.all(missing.map(target => requestValue(store.get(keyFor(target)))));
      for (let index = 0; index < records.length; index++) {
        const stored = records[index], target = missing[index];
        if (!stored || scope !== getScope()) continue;
        const current = memoryStore.get(keyFor(target));
        if (current) continue; // An old disk read never wins against an RPC publication.
        try {
          const pubkeys = [stored.pair?.broken?.pubkey, stored.pair?.placed?.pubkey];
          const pair = await restoreVerifiedChunkPair(stored.pair, { ...options, ...target, scope, pubkeys });
          if (scope !== getScope() || memoryStore.has(keyFor(target))) continue;
          touch(keyFor(target), pair); hits++; result.push(pair); await options.onPair?.(pair);
        } catch {
          const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(keyFor(target));
        }
      }
    } catch { lastError = "Account pair cache read failed."; }
    return result;
  }
  function put(pairs) {
    for (const pair of pairs) {
      if (pair.scope !== getScope() || !Number.isFinite(pair.byteLength) || pair.byteLength <= 0) continue;
      const key = keyFor(pair), previous = memoryStore.get(key);
      if (previous && previous.knownAtSlot > pair.knownAtSlot) continue;
      touch(key, pair);
      const saved = lastStored.get(key);
      const due = !saved || saved.token !== pair.pairToken || now() - saved.at >= 30000;
      if (due) pending.set(key, { key, scope: pair.scope, bytes: pair.byteLength, observedAt: pair.authoritativeObservedAt, pair });
    }
    let queuedBytes = [...pending.values()].reduce((sum, record) => sum + record.bytes, 0);
    for (const [key, record] of pending) {
      if (pending.size <= maxRecords && queuedBytes <= maxBytes) break;
      pending.delete(key); queuedBytes -= record.bytes;
    }
    if (pending.size && !timer) { timer = setTimeout(() => void flush(), 80); timer.unref?.(); }
  }
  async function flush() {
    clearTimeout(timer); timer = null;
    if (!pending.size) return;
    const records = [...pending.values()]; pending.clear();
    try {
      const db = await openDatabase(); if (!db) return;
      await transactionDone(db.transaction(STORE, "readwrite"), store => { for (const record of records) store.put(record); });
      for (const record of records) lastStored.set(record.key, { token: record.pair.pairToken, at: now() });
      while (lastStored.size > maxRecords) lastStored.delete(lastStored.keys().next().value);
      writes += records.length; lastError = "";
      if (!pruning && now() - lastPrune > 60000) { lastPrune = now(); void pruneDisk(db); }
    } catch { lastError = "Account pair cache write failed; verified memory retained."; }
  }
  async function pruneDisk(db) {
    pruning = true;
    try {
      // Cursor retains only compact metadata, not every world's account body.
      const rows = await new Promise((resolve, reject) => {
        const rows = [], request = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => { const cursor = request.result; if (!cursor) return resolve(rows);
          rows.push({ key: cursor.key, bytes: cursor.value.bytes, at: cursor.value.observedAt }); cursor.continue(); };
      });
      rows.sort((a, b) => b.at - a.at); let bytes = 0;
      const remove = rows.filter((row, index) => { bytes += row.bytes; return index >= maxRecords * 2 || bytes > maxBytes * 2 || now() - row.at > 30 * 86400000; });
      if (remove.length) await transactionDone(db.transaction(STORE, "readwrite"), store => { for (const row of remove) store.delete(row.key); });
    } catch { lastError = "Account pair disk pruning failed."; }
    finally { pruning = false; }
  }
  async function clearScope(scope = getScope()) {
    for (const [key, pair] of memoryStore) if (pair.scope === scope) { charge.bytes -= pair.byteLength; memoryStore.delete(key); pending.delete(key); lastStored.delete(key); }
    try {
      const db = await openDatabase(); if (!db) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE);
        const request = store.openCursor(); request.onsuccess = () => { const c = request.result; if (!c) return; if (c.value.scope === scope) c.delete(); c.continue(); };
        tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error);
      });
    } catch { lastError = "Account pair cache clear failed."; }
  }
  return { peek, get, put, flush, clearScope, snapshot: () => ({
    memoryRecords: memoryStore.size, memoryBytes: charge.bytes,
    maxBytes, maxRecords, reads, hits, writes, evictions, pendingWrites: pending.size, lastError,
  }) };
}
function requestValue(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function transactionDone(tx, apply) {
  return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error); apply(tx.objectStore(STORE)); });
}
