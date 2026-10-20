import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { Worker as NodeWorker } from "node:worker_threads";
import { ChunkManager } from "../../chunk.js/chunk/chunk-manager.js";
import { importHostChunkSync } from "./host-sync-module.mjs";
const { createPlayChainChunkDeltaSync } = await importHostChunkSync();
const pdaConfig = { seed: "chunk-broken", placedSeed: "chunk-placed", globalConfig: "11111111111111111111111111111111", programId: "6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7" };

for (const failWorker of [false, true]) test(failWorker ? "an actual Worker startup failure falls back to the same validated decoder" : "Worker delivery and disk delay cannot advance the original network observation timestamp", async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker"), workers = [], writes = [];
  let observedAt = null, deliveredAt = null, finishWrite, writeTimer;
  const written = new Promise(resolve => { finishWrite = resolve; });
  const server = http.createServer(async (request, response) => {
    const parts = []; for await (const part of request) parts.push(part);
    const body = JSON.parse(Buffer.concat(parts));
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { context: { slot: 777 }, value: body.params[0].map(() => null) } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const chunks = new ChunkManager({ worldSeed: "nicechunk-mainnet-001", minY: -32, height: 353, viewDistance: 1, useWorkers: false });
  chunks.ensureChunk(0, 0, { deferBase: true });
  globalThis.Worker = class {
    constructor(entryUrl) {
      const entry = failWorker ? "data:text/javascript,throw new Error('Injected Worker startup failure')" : String(entryUrl);
      this.worker = new NodeWorker(new URL("./helpers/pda-worker-node.mjs", import.meta.url), { workerData: { entryUrl: entry } }); workers.push(this.worker);
      this.worker.on("message", message => {
        if (message.type === "test-ready") return;
        if (message.type === "chunkPdaBatchFetched") observedAt = message.result.observedAt;
        // Worker postMessage ordering is part of the transport contract: delay
        // both partial and final messages without moving final ahead of partial.
        setTimeout(() => {
          if (message.type === "chunkPdaBatchFetched") deliveredAt = Date.now();
          this.onmessage?.({ data: message });
        }, 35);
      });
      this.worker.on("error", error => this.onerror?.({ message: error.message, preventDefault() {} }));
    }
    postMessage(message) { this.worker.postMessage(message); }
    terminate() { return this.worker.terminate(); }
  };
  const connection = { rpcEndpoint: `http://127.0.0.1:${server.address().port}`, getMultipleAccountsInfo() {} };
  const sync = createPlayChainChunkDeltaSync({ chunks, loadChainModule: async () => ({
    isNicechunkChainSyncEnabled: () => true, getNicechunkConnection: () => connection,
    deriveGameChunkBrokenPda: () => ["test-broken"], deriveGameChunkPlacedPda: () => ["test-placed"], getChunkBrokenPdaDerivationConfig: () => pdaConfig,
  }), persistentCache: { async getVerifiedSnapshots() { return []; }, async putVerifiedSnapshots(records) { writes.push(...records); finishWrite(); } } });
  try {
    const result = await sync.syncLoadedChunks(); assert.equal(result.ok, true); assert.equal(result.transport, failWorker ? "main" : "worker");
    while (sync.snapshot().pendingSnapshots) sync.applyQueuedDeltas({ budgetMs: 10, maxDeltas: 64 });
    await Promise.race([written, new Promise((_resolve, reject) => {
      writeTimer = setTimeout(() => reject(new Error("Expected verified background cache write did not arrive")), 5000);
    })]);
    clearTimeout(writeTimer); assert.equal(writes.length, 1);
    if (!failWorker) {
      assert.ok(Math.abs(writes[0].verifiedAt - observedAt) <= 2, "persisted freshness retains RPC observation rather than message delivery time");
      assert.ok(deliveredAt - writes[0].verifiedAt >= 30);
      assert.equal(sync.snapshot().canonicalWork.transportValidations > 0, true);
    }
  } finally {
    clearTimeout(writeTimer); sync.cancelActiveSync(); await Promise.all(workers.map(worker => worker.terminate()));
    if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker); else delete globalThis.Worker;
    chunks.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
