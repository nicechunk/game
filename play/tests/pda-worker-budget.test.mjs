import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { Worker } from "node:worker_threads";
const config = { seed: "chunk-broken", placedSeed: "chunk-placed", globalConfig: "11111111111111111111111111111111", programId: "6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("actual PDA Worker streams nearby batches, bounds concurrent RPC, preserves context, and aborts cancellation", async () => {
  let active = 0, peak = 0, releaseSlow;
  const requests = [], messages = [];
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  const server = http.createServer(async (request, response) => {
    active++; peak = Math.max(peak, active);
    let counted = false;
    response.on("close", () => { if (!counted) { active--; counted = true; } });
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    const batchIndex = body.id % 100; requests.push(body);
    if (batchIndex === 3) await slow;
    if (response.destroyed) return;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { context: { slot: 100 + batchIndex }, value: body.params[0].map(() => null) } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const worker = new Worker(new URL("./helpers/pda-worker-node.mjs", import.meta.url), { workerData: { entryUrl: new URL("../play-chain-pda-worker.js", import.meta.url).href } });
  worker.on("message", (message) => messages.push(message));
  const waitFor = async (predicate) => { for (let attempt = 0; attempt < 10000; attempt++) { if (predicate()) return; await sleep(1); } throw new Error("Worker test wait exceeded the bounded test startup deadline"); };
  try {
    await waitFor(() => messages.some((message) => message.type === "test-ready"));
    const task = { type: "fetchChunkPdas", taskId: 1, syncEpoch: 17, concurrency: 4, pdaConfig: config, rpcUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 5000, minContextSlot: 99, batches: Array.from({ length: 8 }, (_, index) => [{ chunkX: index, chunkZ: -1 }]) };
    worker.postMessage(task);
    await waitFor(() => messages.filter((message) => message.type === "chunkPdaBatchFetched").length >= 6);
    assert.ok(messages.some((message) => message.type === "chunkPdaBatchFetched" && message.batchIndex === 0));
    assert.ok(!messages.some((message) => message.type === "chunkPdasFetched"), "slow remote batch must not delay progressive near delivery");
    assert.ok(peak <= 4);
    assert.ok(requests.every((request) => request.params[0].length === 2 && request.params[1].commitment === "finalized" && request.params[1].minContextSlot === 99));
    for (const message of messages.filter((message) => message.type === "chunkPdaBatchFetched")) { assert.equal(message.syncEpoch, 17); assert.equal(message.result.contextSlot, 100 + message.batchIndex); }
    releaseSlow();
    await waitFor(() => messages.some((message) => message.type === "chunkPdasFetched"));
    const complete = messages.find((message) => message.type === "chunkPdasFetched");
    assert.equal(complete.stats.maxActive, 4);
    assert.equal(messages.filter((message) => message.type === "chunkPdaBatchFetched").length, 8);
    // A cancelled epoch cannot launch the remaining 16 queued requests, or emit
    // late batches into a new main-thread synchronization context.
    messages.length = 0;
    const beforeRequests = requests.length;
    worker.postMessage({ ...task, taskId: 2, syncEpoch: 18, batches: Array.from({ length: 20 }, (_, index) => [{ chunkX: index, chunkZ: -1 }]) });
    worker.postMessage({ type: "cancelChunkPdas", taskId: 2, syncEpoch: 18 });
    await sleep(50);
    assert.ok(requests.length - beforeRequests <= 4);
    assert.equal(messages.length, 0);
  } finally {
    releaseSlow(); await worker.terminate(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  }
});
