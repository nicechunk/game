import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { Worker as NodeWorker } from "node:worker_threads";
import { ChunkManager } from "../../chunk.js/chunk/chunk-manager.js";
import { importHostChunkSync } from "./host-sync-module.mjs";

const { createPlayChainChunkDeltaSync } = await importHostChunkSync();
const pdaConfig = {
  seed: "chunk-broken",
  placedSeed: "chunk-placed",
  globalConfig: "11111111111111111111111111111111",
  programId: "6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7",
};

for (const transport of ["main", "worker"]) {
  test(`${transport}: slow account decode cannot extend freshness for commits or unchanged acknowledgements`, async () => {
    const chunks = new ChunkManager({ worldSeed: "nicechunk-mainnet-001", minY: -32, height: 353, viewDistance: 1, useWorkers: false });
    chunks.ensureChunk(0, 0, { deferBase: true });
    let time = 1_000;
    let reads = 0;
    let decodeClockAdvance = 10_000;
    const workerInstances = [];
    const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
    const data = new Uint8Array(19);
    data.set(new TextEncoder().encode("NCBK"));
    data[4] = 1;
    new DataView(data.buffer).setUint16(8, 1, true);
    new DataView(data.buffer).setInt16(10, -32, true);
    const delayDecode = (info, field = "data") => {
      const bytes = info[field];
      Object.defineProperty(info, field, {
        get() {
          time += decodeClockAdvance;
          decodeClockAdvance = 0;
          return bytes;
        },
      });
      return info;
    };
    const info = delayDecode({ data, owner: pdaConfig.programId, executable: false });
    let server = null;
    let rpcEndpoint = "";
    let sync = null;
    try {
      globalThis.Worker = undefined;
      if (transport === "worker") {
        server = http.createServer(async (request, response) => {
          const parts = [];
          for await (const part of request) parts.push(part);
          const body = JSON.parse(Buffer.concat(parts));
          reads++;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              context: { slot: 10 },
              value: [{ data: [Buffer.from(data).toString("base64"), "base64"], owner: pdaConfig.programId, executable: false }, null],
            },
          }));
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        rpcEndpoint = `http://127.0.0.1:${server.address().port}`;
        globalThis.Worker = class {
          constructor(entryUrl) {
            this.worker = new NodeWorker(new URL("./helpers/pda-worker-node.mjs", import.meta.url), { workerData: { entryUrl: String(entryUrl) } });
            workerInstances.push(this.worker);
            this.worker.on("message", (message) => {
              if (message.type === "test-ready") return;
              if (message.type === "chunkPdaBatchFetched" && message.result.ok) delayDecode(message.result.decoded.snapshots[0], "packedDeltas");
              this.onmessage?.({ data: message });
            });
            this.worker.on("error", (error) => this.onerror?.({ message: error.message, preventDefault() {} }));
          }
          postMessage(message) { this.worker.postMessage(message); }
          terminate() { return this.worker.terminate(); }
        };
      }
      const module = {
        isNicechunkChainSyncEnabled: () => true,
        getNicechunkConnection: () => ({
          rpcEndpoint,
          getMultipleAccountsInfo() {},
          async getMultipleAccountsInfoAndContext() {
            reads++;
            return { value: [info, null], context: { slot: 10 } };
          },
        }),
        deriveGameChunkBrokenPda: (x, z) => [`broken:${x},${z}`],
        deriveGameChunkPlacedPda: (x, z) => [`placed:${x},${z}`],
        getChunkBrokenPdaDerivationConfig: () => pdaConfig,
      };
      sync = createPlayChainChunkDeltaSync({
        chunks,
        now: () => time,
        loadChainModule: async () => module,
        persistentCache: { async getVerifiedSnapshots() { return []; }, async putVerifiedSnapshots() {} },
      });
      const first = await sync.syncLoadedChunks();
      assert.equal(first.ok, true);
      assert.equal(first.transport, transport, "the real host must use the selected RPC path");
      assert.equal(time, 11_000, "the fake clock advances during account decoding after successful RPC delivery");
      while (sync.snapshot().pendingSnapshots) sync.applyQueuedDeltas({ budgetMs: 10, maxDeltas: 64 });
      assert.equal(sync.snapshot().verifiedChunks, 1);
      assert.equal(reads, 1);

      // Leave a scheduling margin around the wall-clock network observation.
      time = 14_900;
      await sync.syncLoadedChunks();
      assert.equal(reads, 1, "fresh observations should not cause extra reads before the 15s TTL");
      time = 17_000;
      decodeClockAdvance = 10_000;
      const unchanged = await sync.syncLoadedChunks();
      assert.equal(unchanged.transport, transport);
      assert.equal(reads, 2, "an expired successful RPC must refresh even when its decode completed 10s later");
      assert.equal(time, 27_000);
      assert.equal(sync.snapshot().unchangedSnapshots, 1, "the second slow decode must exercise canonical acknowledgement, not a new commit");
      assert.equal(sync.snapshot().pendingSnapshots, 0);

      time = 30_900;
      await sync.syncLoadedChunks();
      assert.equal(reads, 2);
      time = 33_000;
      await sync.syncLoadedChunks();
      assert.equal(reads, 3, "slow unchanged acknowledgements must use the same observation-based TTL");
      assert.equal(sync.snapshot().unchangedSnapshots, 2);
      assert.deepEqual(sync.snapshot().freshnessTtlMs, { near: 15_000, middle: 45_000, far: 120_000 });
    } finally {
      sync?.cancelActiveSync();
      await Promise.all(workerInstances.map((worker) => worker.terminate()));
      if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
      else delete globalThis.Worker;
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      chunks.dispose();
    }
  });
}
