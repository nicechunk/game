import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { Worker } from "node:worker_threads";
import { decodeChunkAccountBatch, validateDecodedChunkAccountBatch } from "../play-chain-chunk-codec.js";
import { canonicalizeChunkSnapshotAsync, canonicalChunkWorkSnapshot } from "../play-chain-chunk-canonical.js";
import { createPlayChainChunkCache } from "../play-chain-chunk-cache.js";

const config = { seed: "chunk-broken", placedSeed: "chunk-placed", globalConfig: "11111111111111111111111111111111", programId: "6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7" };
const options = { chunkSize: 16, minY: -32, expectedOwner: config.programId, globalConfig: config.globalConfig, contextSlot: 321 };
const target = { chunkX: 0, chunkZ: -1 };

function account(kind, count = 4, startCoordinate = 0) {
  const length = kind === "broken" ? 3 : 9, data = new Uint8Array(16 + Math.max(1, count) * length), view = new DataView(data.buffer);
  data.set(new TextEncoder().encode(kind === "broken" ? "NCBK" : "NCPB")); data[4] = 1;
  view.setUint16(6, count, true); view.setUint16(8, Math.max(1, count), true); view.setInt16(10, -32, true);
  for (let index = 0; index < count; index++) {
    const offset = 16 + index * length, coordinate = index + startCoordinate;
    data[offset] = coordinate & 255; data[offset + 1] = coordinate >> 8 & 255; data[offset + 2] = coordinate >> 16 & 255;
    if (kind === "placed") { view.setUint16(offset + 3, index % 30 + 1, true); view.setUint32(offset + 5, 625000, true); }
  }
  return { data, owner: config.programId, executable: false };
}
function changed(kind, change) { const result = account(kind); change(result, new DataView(result.data.buffer)); return result; }
function cases() {
  return [
    [null, null], [account("broken"), null], [account("broken"), account("placed")],
    [changed("broken", value => { value.owner = "wrong-owner"; }), null],
    [null, changed("placed", value => { value.executable = true; })],
    [changed("broken", value => { value.data[0] = 0; }), null],
    [null, changed("placed", value => { value.data[4] = 9; })],
    [changed("broken", (_value, view) => view.setUint16(6, 5, true)), null],
    [null, changed("placed", (_value, view) => view.setInt16(10, -31, true))],
    [changed("broken", value => value.data.set(value.data.subarray(16, 19), 19)), null],
    [null, changed("placed", (_value, view) => view.setUint16(19, 0, true))],
    [null, changed("placed", (_value, view) => view.setUint32(21, 0, true))],
    [changed("broken", value => { value.data = value.data.subarray(0, value.data.length - 1); }), null],
    [account("broken", 2048), account("placed", 2048, 2048)],
  ];
}

test("shared decoding validates malformed account pairs identically on raw and compact paths", async () => {
  for (const infos of cases()) {
    const fallback = await decodeChunkAccountBatch([target], infos, options);
    const transport = await decodeChunkAccountBatch([target], infos, { ...options, compact: true });
    const restored = await validateDecodedChunkAccountBatch([target], structuredClone(transport), options);
    assert.deepEqual(restored.errors, fallback.errors);
    assert.deepEqual(restored.snapshots, fallback.snapshots);
  }
});

test("canonicalPrepared cannot bypass sorting, numeric bounds, identity, length, or fingerprint checks", async () => {
  await assert.rejects(canonicalizeChunkSnapshotAsync({ chunkX: 0, chunkZ: 0, canonicalPrepared: true,
    fingerprint: "trusted", packedDeltas: [99, 0, 0, 1], deltas: [] }), /Invalid localX/);
  const canonical = await canonicalizeChunkSnapshotAsync({ chunkX: 0, chunkZ: 0,
    deltas: [{ worldX: 2, worldY: 4, worldZ: 0, blockId: 1 }, { worldX: 1, worldY: 4, worldZ: 0, blockId: 2 }] });
  assert.deepEqual(canonical.packedDeltas, [1, 4, 0, 2, 2, 4, 0, 1]);
  assert.throws(() => { canonical.packedDeltas[0] = 10; }, TypeError);
  assert.throws(() => { canonical.deltas[0].blockId = 9; }, TypeError);
  const transport = await decodeChunkAccountBatch([target], [account("broken"), account("placed")], { ...options, compact: true });
  for (const change of [
    record => { record.version = 2; }, record => { record.chunkX = 1; },
    record => { record.fingerprint = "forged"; }, record => { record.packedDeltas = new Int32Array(0); },
    record => { record.packedDeltas[0] = 99; }, record => { record.pair[0].owner = "other"; },
    record => { record.pair[1].executable = true; }, record => { record.pair[0].capacity = 9000; },
  ]) {
    const malformed = structuredClone(transport); change(malformed.snapshots[0]);
    try { const result = await validateDecodedChunkAccountBatch([target], malformed, options); assert.equal(result.snapshots.length, 0); }
    catch (error) { assert.match(error.message, /Invalid|unexpected|duplicate/); }
  }
  await assert.rejects(validateDecodedChunkAccountBatch([target], transport, { ...options, globalConfig: "other" }), /envelope/);
});

test("validated canonical data is reused through cache writes and reads retain original observation time", async () => {
  const decoded = await decodeChunkAccountBatch([target], [account("broken", 2048), account("placed", 2048, 2048)], options);
  assert.equal(decoded.snapshots[0].deltas.length, 4096);
  const before = canonicalChunkWorkSnapshot(), memoryStore = new Map();
  const cache = createPlayChainChunkCache({ indexedDBFactory: null, memoryStore, now: () => 100000 });
  await cache.putVerifiedSnapshots([{ ...decoded.snapshots[0], verifiedAt: 12345 }]);
  const after = canonicalChunkWorkSnapshot();
  assert.equal(after.canonicalizations, before.canonicalizations, "writing internally verified canonical arrays does not repeat sorting");
  assert.ok(after.reuses > before.reuses);
  const restored = await cache.getVerifiedSnapshots([target]); assert.equal(restored[0].verifiedAt, 12345);
  assert.deepEqual(restored[0].packedDeltas, decoded.snapshots[0].packedDeltas);
  const forged = { ...decoded.snapshots[0], packedDeltas: [...decoded.snapshots[0].packedDeltas] };
  const count = canonicalChunkWorkSnapshot().canonicalizations; await cache.putVerifiedSnapshots([forged]);
  assert.equal(canonicalChunkWorkSnapshot().canonicalizations, count + 1, "an unproven copied array is validated again");
});

test("large fallback account parsing yields while preserving complete atomic canonical output", async () => {
  let turns = 0, running = true;
  const pulse = () => { if (running) { turns++; setImmediate(pulse); } }; setImmediate(pulse);
  const decoded = await decodeChunkAccountBatch([target], [account("broken", 2048), account("placed", 2048, 2048)], options);
  running = false;
  assert.ok(turns > 10, "fallback work returns control during account validation and canonical sorting");
  assert.equal(decoded.errors.length, 0); assert.equal(decoded.snapshots.length, 1);
  assert.equal(decoded.snapshots[0].deltas.length, 4096);
});

test("real Worker preserves malformed-input parity and handles the production peak of 400 paired chunks", async () => {
  let mode = "cases", active = 0, peak = 0;
  const matrix = cases(), messages = [], requests = [];
  const server = http.createServer(async (request, response) => {
    active++; peak = Math.max(peak, active);
    const buffers = []; for await (const buffer of request) buffers.push(buffer);
    const body = JSON.parse(Buffer.concat(buffers)); requests.push(body);
    const batch = body.id % 100;
    const infos = mode === "cases" ? matrix[batch] : body.params[0].map((_key, index) => account(index % 2 ? "placed" : "broken", 64));
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ result: { context: { slot: 321 + batch }, value: infos.map(info => info ? {
      owner: info.owner, executable: info.executable, data: [Buffer.from(info.data).toString("base64"), "base64"],
    } : null) } })); active--;
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const worker = new Worker(new URL("./helpers/pda-worker-node.mjs", import.meta.url), { workerData: { entryUrl: new URL("../play-chain-pda-worker.js", import.meta.url).href } });
  let failure; worker.on("error", error => { failure = error; }); worker.on("message", message => messages.push(message));
  const waitFor = async predicate => { for (let attempt = 0; attempt < 15000; attempt++) {
    if (failure) throw failure; if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 1));
  } throw new Error("Worker fixture exceeded its bounded deadline"); };
  try {
    await waitFor(() => messages.some(message => message.type === "test-ready"));
    const task = { type: "fetchChunkPdas", taskId: 4, syncEpoch: 15, concurrency: 4,
      pdaConfig: config, rpcUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 12000,
      minContextSlot: 300, chunkSize: 16, minY: -32,
      batches: matrix.map((_pair, chunkX) => [{ chunkX, chunkZ: 0 }]) };
    worker.postMessage(task); await waitFor(() => messages.some(message => message.type === "chunkPdasFetched"));
    const batches = messages.filter(message => message.type === "chunkPdaBatchFetched"); assert.equal(batches.length, matrix.length);
    for (const message of batches) {
      const batch = task.batches[message.batchIndex], contextSlot = 321 + message.batchIndex;
      const fallback = await decodeChunkAccountBatch(batch, matrix[message.batchIndex], { ...options, contextSlot });
      const restored = await validateDecodedChunkAccountBatch(batch, message.result.decoded, { ...options, contextSlot });
      assert.deepEqual(restored, { snapshots: fallback.snapshots, errors: fallback.errors });
      assert.equal(message.result.commitment, "finalized"); assert.ok(message.result.observedAt >= message.result.readStartedAt);
      assert.equal(message.result.infos, undefined, "account byte arrays are not copied back to the main thread");
      for (const record of message.result.decoded.snapshots) assert.ok(record.packedDeltas instanceof Int32Array);
    }
    mode = "peak"; messages.length = 0;
    const pressure = { ...task, taskId: 5, syncEpoch: 16,
      batches: Array.from({ length: 8 }, (_, batch) => Array.from({ length: 50 }, (_unused, index) => ({ chunkX: batch * 50 + index, chunkZ: -2 }))) };
    worker.postMessage(pressure); await waitFor(() => messages.some(message => message.type === "chunkPdasFetched"));
    const peakBatches = messages.filter(message => message.type === "chunkPdaBatchFetched");
    assert.equal(peakBatches.length, 8); assert.ok(peak <= 4); assert.ok(requests.every(request => request.params[0].length <= 100));
    const before = canonicalChunkWorkSnapshot(); let chunks = 0, records = 0;
    for (const message of peakBatches) {
      const restored = await validateDecodedChunkAccountBatch(pressure.batches[message.batchIndex], message.result.decoded, { ...options, contextSlot: 321 + message.batchIndex });
      assert.equal(restored.errors.length, 0); chunks += restored.snapshots.length;
      records += restored.snapshots.reduce((sum, record) => sum + record.deltas.length, 0);
    }
    const after = canonicalChunkWorkSnapshot(); assert.equal(chunks, 400); assert.equal(records, 25600);
    assert.equal(after.canonicalizations, before.canonicalizations, "main thread validates sorted compact records without sorting again");
    assert.equal(after.sortComparisons, before.sortComparisons);
    assert.equal(after.transportValidations - before.transportValidations, 400);
  } finally { await worker.terminate(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
