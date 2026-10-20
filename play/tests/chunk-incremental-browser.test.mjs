import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { startStaticServer } from "../../scripts/serve-static-site.mjs";
const ownServer = process.env.NICECHUNK_TEST_ORIGIN ? null : await startStaticServer({ rootDirectory: new URL("../../", import.meta.url).pathname });
const origin = process.env.NICECHUNK_TEST_ORIGIN || ownServer.baseUrl;
test.after(async () => { await ownServer?.close(); });
const pdaConfig = { seed: "chunk-broken", placedSeed: "chunk-placed", globalConfig: "11111111111111111111111111111111", programId: "6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7" };
const evidence = {};
async function save() { if (process.env.NICECHUNK_INCREMENTAL_EVIDENCE) { await mkdir(process.env.NICECHUNK_INCREMENTAL_EVIDENCE, { recursive: true }); await writeFile(process.env.NICECHUNK_INCREMENTAL_EVIDENCE + "/browser.json", JSON.stringify(evidence, null, 2)); } }
function account(kind, empty = false) {
  const data = Buffer.alloc(16 + 64 * (kind === "broken" ? 3 : 9)); data.write(kind === "broken" ? "NCBK" : "NCPB");
  data[4] = 1; data.writeUInt16LE(empty ? 0 : 1, 6); data.writeUInt16LE(64, 8); data.writeInt16LE(-32, 10);
  if (!empty) { data[16] = 17; data[17] = 32; if (kind === "placed") { data.writeUInt16LE(7, 19); data.writeUInt32LE(10, 21); } }
  return { data: [data.toString("base64"), "base64"], owner: pdaConfig.programId, executable: false, space: data.length };
}
test("real browser and PDA Worker: 50 lossless pairs, conditional mixed response, atomic removal, unchanged hot return and targeted repair", async () => {
  let mode = "cold", slot = 2000, changedKey = null;
  const requests = [], keys = new Set(), deleted = new Set();
  const server = http.createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*"); response.setHeader("access-control-allow-headers", "content-type");
    if (request.method === "OPTIONS") { response.end(); return; }
    const parts = []; for await (const part of request) parts.push(part);
    const body = JSON.parse(Buffer.concat(parts)); requests.push(body);
    const values = body.params[0].map((key, index) => {
      keys.add(key);
      if (mode === "invalid" && key === changedKey) return { ...account("placed", true), owner: "wrong-program" };
      if (mode === "mixed" && key === changedKey) { deleted.add(key); return account("placed", true); }
      if (mode !== "cold" && body.params[1].changedSinceSlot !== undefined) return { status: "unchanged" };
      return account(index % 2 ? "placed" : "broken", deleted.has(key));
    });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { context: { slot }, value: values } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.goto(origin + "/play/tests/");
    await page.evaluate(async ({ rpcUrl, pdaConfig }) => {
      const [{ createPlayChainChunkDeltaSync }, { ChunkManager }, { createChunkPdaDeriver }] = await Promise.all([
        import("/play/play-chain-chunk-deltas.js"), import("/chunk.js/chunk/chunk-manager.js"), import("/play/play-solana-pda-lite.js"),
      ]);
      const chunks = new ChunkManager({ useWorkers: false, minY: -32, height: 64, viewDistance: 7, shadows: false });
      const addresses = new Map(), broken = createChunkPdaDeriver(pdaConfig), placed = createChunkPdaDeriver({ ...pdaConfig, seed: pdaConfig.placedSeed });
      for (let index = 0; index < 50; index++) {
        const x = index % 10 - 5, z = Math.floor(index / 10) - 2, id = x + "," + z;
        chunks.ensureChunk(x, z, { deferBase: true }); addresses.set("broken:" + id, await broken(x, z)); addresses.set("placed:" + id, await placed(x, z));
      }
      const connection = { rpcEndpoint: rpcUrl, getMultipleAccountsInfo() {}, getGenesisHash: async () => "fixture-genesis-verified-000000000000000" };
      let changed = 0;
      const sync = createPlayChainChunkDeltaSync({ chunks, batchSize: 50, onChanged: () => changed++, loadChainModule: async () => ({
        isNicechunkChainSyncEnabled: () => true, getNicechunkConnection: () => connection,
        deriveGameChunkBrokenPda: (x, z) => [addresses.get("broken:" + x + "," + z)],
        deriveGameChunkPlacedPda: (x, z) => [addresses.get("placed:" + x + "," + z)],
        getChunkBrokenPdaDerivationConfig: () => pdaConfig,
      }) });
      window.fixture = { sync, chunks, addresses, changed: () => changed, async run() {
        const start = performance.now(), result = await sync.syncLoadedChunks({ force: true });
        while (sync.snapshot().pendingSnapshots) sync.applyQueuedDeltas({ budgetMs: 5, maxDeltas: 256 });
        return { result, elapsedMs: performance.now() - start, state: sync.snapshot(), changed };
      } };
    }, { rpcUrl: "http://127.0.0.1:" + server.address().port, pdaConfig });
    evidence.cold = await page.evaluate(() => fixture.run());
    assert.equal(evidence.cold.result.ok, true); assert.equal(evidence.cold.state.pairCache.memoryRecords, 50);
    assert.equal(evidence.cold.state.rpcMetrics.fullAccountCount, 100);
    const beforeCalls = requests.length; mode = "warm"; slot = 2100;
    evidence.warm = await page.evaluate(() => fixture.run());
    assert.equal(evidence.warm.result.ok, true); assert.equal(evidence.warm.state.rpcMetrics.unchangedAccountCount, 100);
    assert.equal(evidence.warm.state.pairWork.componentDecodeCount, evidence.cold.state.pairWork.componentDecodeCount);
    assert.equal(evidence.warm.state.workerPairWork.componentDecodeCount, evidence.cold.state.workerPairWork.componentDecodeCount);
    assert.equal(evidence.warm.state.canonicalWork.canonicalizations, evidence.cold.state.canonicalWork.canonicalizations);
    assert.equal(evidence.warm.changed, evidence.cold.changed);
    assert.ok(requests.slice(beforeCalls).every(request => request.params[1].changedSinceSlot === 2000 && request.params[1].minContextSlot >= 2000));
    changedKey = await page.evaluate(() => fixture.addresses.get("placed:0,0")); mode = "mixed"; slot = 2200;
    evidence.mixed = await page.evaluate(() => fixture.run());
    assert.equal(evidence.mixed.result.ok, true);
    assert.equal(await page.evaluate(() => fixture.chunks.getBlockAtWorld(1, 0, 1)), 0, "Broken hidden by Placed survives the deletion");
    assert.equal(evidence.mixed.state.rpcMetrics.fullAccountCount - evidence.warm.state.rpcMetrics.fullAccountCount, 1);
    assert.equal(evidence.mixed.state.workerPairWork.componentDecodeCount - evidence.warm.state.workerPairWork.componentDecodeCount, 1);
    // Instance loss does not invalidate account content; a metadata-only
    // observation restores the exact pure snapshot to a new world instance.
    mode = "warm"; slot = 2300;
    await page.evaluate(() => { fixture.chunks.chunks.delete("0,0"); fixture.chunks.ensureChunk(0, 0, { deferBase: true }); });
    evidence.returned = await page.evaluate(() => fixture.run());
    assert.equal(await page.evaluate(() => fixture.chunks.getBlockAtWorld(1, 0, 1)), 0);
    assert.equal(evidence.returned.state.workerPairWork.componentDecodeCount, evidence.mixed.state.workerPairWork.componentDecodeCount);
    mode = "invalid"; slot = 2400;
    evidence.invalid = await page.evaluate(() => fixture.run());
    assert.equal(evidence.invalid.result.ok, false);
    assert.equal(await page.evaluate(() => fixture.chunks.getBlockAtWorld(1, 0, 1)), 0, "one invalid side retains the atomic prior pair");
    mode = "warm"; slot = 2500;
    await new Promise(resolve => setTimeout(resolve, 1100));
    const repairStart = requests.length;
    evidence.repair = await page.evaluate(async () => {
      const result = await fixture.sync.syncLoadedChunks();
      while (fixture.sync.snapshot().pendingSnapshots) fixture.sync.applyQueuedDeltas({ budgetMs: 5 });
      return { result, state: fixture.sync.snapshot() };
    });
    assert.equal(evidence.repair.result.ok, true); assert.equal(requests.length - repairStart, 1);
    assert.equal(requests.at(-1).params[0].length, 2); assert.equal(requests.at(-1).params[1].changedSinceSlot, undefined);
    evidence.requests = requests.map(request => ({ accounts: request.params[0].length, ...request.params[1] }));
    evidence.bytes = {
      coldResponseJson: evidence.cold.state.rpcMetrics.responseJsonBytes,
      warmResponseJson: evidence.warm.state.rpcMetrics.responseJsonBytes - evidence.cold.state.rpcMetrics.responseJsonBytes,
      coldCalls: evidence.cold.state.rpcMetrics.rpcCalls,
      warmCalls: evidence.warm.state.rpcMetrics.rpcCalls - evidence.cold.state.rpcMetrics.rpcCalls,
      availableWireBytes: null,
    };
    await page.evaluate(() => { fixture.sync.cancelActiveSync(); fixture.chunks.dispose(); });
    await save();
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("native WebGL local material feedback uses the terrain material, records actual draw and hands off only to the matching GPU revision", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 240 } }); await page.goto(origin + "/play/tests/");
    const result = await page.evaluate(async () => {
      const [{ createLocalPlacementFeedback }, { WebGL2VoxelRenderer }, { ChunkManager }, { ensureRenderSections }, { BLOCK_ID }] = await Promise.all([
        import("/play/play-local-placement-feedback.js"), import("/chunk.js/renderer/webgl2-renderer.js"), import("/chunk.js/chunk/chunk-manager.js"),
        import("/chunk.js/chunk/render-sections.js"), import("/chunk.js/world/block-registry.js"),
      ]);
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240; document.body.append(canvas);
      const renderer = new WebGL2VoxelRenderer(canvas, { clouds: false, shadows: false, deferredChunkUploads: true, maxChunkUploadsPerFrame: 4 });
      renderer.init();
      const chunks = new ChunkManager({ useWorkers: false, height: 16, minY: 0, viewDistance: 1, shadows: false });
      const owner = chunks.ensureChunk(0, 0, { deferBase: true }); owner.setBaseBlocks(new Uint16Array(16 * 16 * 16)); ensureRenderSections(owner);
      const feedback = createLocalPlacementFeedback({ getChunks: () => chunks, getRenderer: () => renderer });
      feedback.prime(BLOCK_ID.stone);
      const action = { txId: "first", worldX: 1, worldY: 1, worldZ: 1, blockId: BLOCK_ID.stone };
      chunks.applyPendingDelta([action], action.txId); if (!feedback.enqueue(action)) throw new Error("Feedback was not admitted");
      const proxies = feedback.collect(), proxy = proxies[0], camera = { worldX: 4, worldY: 4, worldZ: 6, localOffsetX: 0, localOffsetY: 0, localOffsetZ: 0, targetWorldX: 1, targetWorldY: 1, targetWorldZ: 1, yaw: -0.6, pitch: -0.3, fov: 60, aspect: 4 / 3, near: .1, far: 100 };
      let frames = 0;
      while (renderer.entryForChunk(proxy)?.firstDrawAt == null && frames++ < 120) {
        if (renderer.canPrepareFrame()) { renderer.prepareChunksForRender(proxies, { maxUploads: 4 }); renderer.render(camera, proxies); }
        else renderer.sealDeferredUploads();
        await new Promise(requestAnimationFrame);
      }
      feedback.collect();
      if (renderer.entryForChunk(proxy)?.firstDrawAt == null) throw new Error("No actual feedback draw: " + JSON.stringify({ stats: renderer.stats, entry: renderer.entryForChunk(proxy)?.token, bounds: proxy.mesh.bounds, error: String(renderer.lastUploadError || ""), ready: proxy.gpuUploaded }));
      const before = feedback.snapshot();
      const section = owner.renderSections.get(0);
      // A GPU entry from an older source mesh must not hide the live patch.
      section.dirty = false; section.meshVersion = section.dataRevision; section.gpuUploaded = true;
      if (feedback.collect().length !== 1) throw new Error("Early handoff without the matching GPU handle");
      section.dirty = true; owner.dirty = true;
      for (let step = 0; owner.dirty && step < 100; step++) chunks.rebuildDirtyChunks(50);
      if (owner.dirty || !section.mesh?.indexCount) throw new Error("Actual official section mesher did not finish");
      for (let attempt = 0; !section.gpuUploaded && attempt < 120; attempt++) {
        if (renderer.canPrepareFrame()) renderer.prepareChunksForRender([owner], { maxUploads: 4 });
        renderer.sealDeferredUploads(); await new Promise(requestAnimationFrame);
      }
      if (!section.gpuUploaded) throw new Error("Official GPU upload did not validate");
      if (feedback.collect().length !== 0) throw new Error("Matching GPU revision did not hand off");
      feedback.enqueue({ ...action, txId: "later" }); feedback.remove("first");
      if (feedback.snapshot().active !== 1) throw new Error("An old rollback removed a later action");
      feedback.remove("later");
      const after = feedback.snapshot(); renderer.dispose(); chunks.dispose();
      return { frames, before, after, resourcesAfterDispose: renderer.resourceLedger.snapshot(), software: true };
    });
    assert.equal(result.before.samples.length, 1); assert.equal(result.after.handedOff, 1); assert.equal(result.after.active, 0);
    assert.equal(result.resourcesAfterDispose.bufferBytes, 0); assert.equal(result.resourcesAfterDispose.textureBytes, 0);
    evidence.nativeFeedback = result; await save();
  } finally { await browser.close(); }
});

test("actual IndexedDB v1 upgrade retains legacy preview, atomically stores lossless pairs and rejects aborted watermark writes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.goto(origin + "/play/tests/");
    const result = await page.evaluate(async () => {
      const [{ createPlayChainChunkCache, canonicalizeChunkSnapshot }, { composeVerifiedChunkPair }] = await Promise.all([
        import("/play/play-chain-chunk-cache.js"), import("/play/play-chain-chunk-pair.js"),
      ]);
      const scope = "fixture-chain|program|global|seeds|format-v1", target = { id: "0,0", chunkX: 0, chunkZ: 0 };
      const legacy = canonicalizeChunkSnapshot({ ...target, packedDeltas: [1, 0, 1, 0], contextSlot: 100 });
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("nicechunk-chain-chunk-cache", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("snapshots", { keyPath: "key" });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction("snapshots", "readwrite");
          tx.objectStore("snapshots").put({ ...legacy, key: "chain-chunk-snapshot-v2-pure-rpc|" + scope + "|0,0",
            schema: "chain-chunk-snapshot-v2-pure-rpc", scope, deltaCount: 1, verifiedAt: 1000 });
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
        };
      });
      let clock = 2000;
      const makeCache = () => createPlayChainChunkCache({ getScope: () => scope, memoryStore: new Map(), pairMemoryStore: new Map(), now: () => clock });
      const first = makeCache(), preview = await first.getVerifiedSnapshots([target]);
      if (preview.length !== 1 || preview[0].verifiedAt !== 1000) throw new Error("Legacy cache migration changed observation identity");
      if ((await first.pairs.get([target])).length) throw new Error("Lossy legacy preview became an incremental baseline");
      const pairOptions = { scope, pubkeys: ["broken", "placed"], chunkSize: 16, minY: -32, contextSlot: 100, observedAt: 1000, readStartedAt: 900 };
      const pair = await composeVerifiedChunkPair(target, [{ kind: "absent", pubkey: "broken" }, { kind: "absent", pubkey: "placed" }], pairOptions);
      first.pairs.put([pair]); await first.pairs.flush();
      const restored = await makeCache().pairs.get([target], pairOptions);
      if (restored.length !== 1 || restored[0].knownAtSlot !== 100) throw new Error("Lossless pair did not survive real IDB serialization");
      // Metadata acknowledgements are bounded; no whole-body rewrite per hit.
      const writes = first.pairs.snapshot().writes;
      first.pairs.put([{ ...pair, knownAtSlot: 101, authoritativeObservedAt: 1100 }]); await first.pairs.flush();
      if (first.pairs.snapshot().writes !== writes) throw new Error("Unchanged metadata rewrote the body immediately");
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(stores, mode, ...rest) {
        const tx = original.call(this, stores, mode, ...rest);
        if (stores === "account-pairs" && mode === "readwrite") queueMicrotask(() => tx.abort());
        return tx;
      };
      clock += 31000;
      try { first.pairs.put([{ ...pair, knownAtSlot: 200, authoritativeObservedAt: 3000 }]); await first.pairs.flush(); }
      finally { IDBDatabase.prototype.transaction = original; }
      if (first.pairs.peek(target).knownAtSlot !== 200 || !first.pairs.snapshot().lastError) throw new Error("IDB abort damaged the valid memory pair");
      const afterAbort = await makeCache().pairs.get([target], pairOptions);
      if (afterAbort[0].knownAtSlot !== 100) throw new Error("Aborted transaction published a new watermark with an old body");
      return { upgraded: true, legacyPreviewOnly: true, restoredSlot: restored[0].knownAtSlot,
        memorySlotAfterAbort: first.pairs.peek(target).knownAtSlot, diskSlotAfterAbort: afterAbort[0].knownAtSlot, writes, boundedMetadata: true };
    });
    evidence.indexedDB = result; await save();
  } finally { await browser.close(); }
});

test("native validated pair reaches an actual revision draw, then unchanged restores evicted GPU and a lost context without decode or remesh", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 240 } }); await page.goto(origin + "/play/tests/");
    const result = await page.evaluate(async () => {
      const [{ createPlayChainChunkDeltaSync }, { ChunkManager }, { ensureRenderSections }, { WebGL2VoxelRenderer }] = await Promise.all([
        import("/play/play-chain-chunk-deltas.js"), import("/chunk.js/chunk/chunk-manager.js"), import("/chunk.js/chunk/render-sections.js"), import("/chunk.js/renderer/webgl2-renderer.js"),
      ]);
      const canvas = document.createElement("canvas"); document.body.append(canvas);
      const renderer = new WebGL2VoxelRenderer(canvas, { clouds: false, shadows: false, deferredChunkUploads: true }); renderer.init();
      const chunks = new ChunkManager({ useWorkers: false, minY: 0, height: 16, shadows: false, viewDistance: 1 });
      const chunk = chunks.ensureChunk(0, 0, { deferBase: true }); chunk.setBaseBlocks(new Uint16Array(4096)); ensureRenderSections(chunk);
      const data = new Uint8Array(25), view = new DataView(data.buffer); data.set(new TextEncoder().encode("NCPB")); data[4] = 1;
      view.setUint16(6, 1, true); view.setUint16(8, 1, true); data[16] = 17; data[17] = 1; view.setUint16(19, 7, true); view.setUint32(21, 1, true);
      const encoded = btoa(String.fromCharCode(...data)), savedFetch = window.fetch, savedWorker = window.Worker; let calls = 0;
      window.Worker = undefined;
      window.fetch = async (url, init) => {
        if (url !== "https://fixture.invalid/rpc") return savedFetch(url, init);
        calls++; const request = JSON.parse(init.body);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { context: { slot: 1000 + calls },
          value: [null, request.params[1].changedSinceSlot === undefined ? { data: [encoded, "base64"], owner: "program", executable: false } : { status: "unchanged" }] } }));
      };
      const sync = createPlayChainChunkDeltaSync({ chunks, persistentCache: { getVerifiedSnapshots: async () => [], putVerifiedSnapshots: async () => {} },
        loadChainModule: async () => ({ isNicechunkChainSyncEnabled: () => true,
          getNicechunkConnection: () => ({ rpcEndpoint: "https://fixture.invalid/rpc", getMultipleAccountsInfo() {}, getGenesisHash: async () => "fixture-genesis-000000000000000000" }),
          deriveGameChunkBrokenPda: () => ["broken"], deriveGameChunkPlacedPda: () => ["placed"],
          getChunkBrokenPdaDerivationConfig: () => ({ seed: "broken", placedSeed: "placed", globalConfig: "global", programId: "program" }) }) });
      const camera = { worldX: 4, worldY: 4, worldZ: 6, targetWorldX: 1, targetWorldY: 1, targetWorldZ: 1, localOffsetX: 0, localOffsetY: 0, localOffsetZ: 0, fov: 60, aspect: 4 / 3, near: .1, far: 100 };
      const section = chunk.renderSections.get(0);
      async function readAndDraw() {
        const result = await sync.syncLoadedChunks({ force: true }); if (!result.ok) throw new Error(result.reason);
        while (sync.snapshot().pendingSnapshots) sync.applyQueuedDeltas({ budgetMs: 5 });
        for (let frame = 0; frame < 240; frame++) {
          chunks.rebuildDirtyChunks(2);
          if (renderer.canPrepareFrame()) { renderer.prepareChunksForRender([chunk], { maxUploads: 4 }); renderer.render(camera, [chunk]); }
          else renderer.sealDeferredUploads();
          if (section.presentationRequest?.firstDrawSubmitted != null) return { frames: frame + 1, ...section.presentationRequest };
          await new Promise(requestAnimationFrame);
        }
        throw new Error("Validated pair did not reach its actual geometry draw");
      }
      try {
        const first = await readAndDraw(), mesh = section.mesh, before = sync.snapshot();
        const uploadedBeforeResident = renderer.resourceLedger.snapshot().uploadBytes;
        const resident = await readAndDraw();
        const residentExtraUploadBytes = renderer.resourceLedger.snapshot().uploadBytes - uploadedBeforeResident;
        if (section.mesh !== mesh || renderer.resourceLedger.snapshot().uploadBytes !== uploadedBeforeResident
          || sync.snapshot().pairWork.componentDecodeCount !== before.pairWork.componentDecodeCount
          || sync.snapshot().canonicalWork.canonicalizations !== before.canonicalWork.canonicalizations) throw new Error("Resident unchanged performed extra decode/canonical/mesh/GPU transfer");
        renderer.removeChunk(chunk.id);
        const evicted = await readAndDraw(), afterEviction = sync.snapshot();
        if (section.mesh !== mesh || afterEviction.pairWork.componentDecodeCount !== before.pairWork.componentDecodeCount
          || afterEviction.canonicalWork.canonicalizations !== before.canonicalWork.canonicalizations) throw new Error("GPU eviction repeated account decode/canonical/meshing");
        const extension = renderer.gl.getExtension("WEBGL_lose_context");
        if (!extension) throw new Error("Native context-loss extension unavailable");
        const lost = new Promise(resolve => canvas.addEventListener("webglcontextlost", resolve, { once: true }));
        extension.loseContext(); await Promise.race([lost, new Promise((_, reject) => setTimeout(() => reject(new Error("Context loss event timed out")), 5000))]);
        await new Promise(resolve => setTimeout(resolve, 100));
        const restored = new Promise(resolve => canvas.addEventListener("webglcontextrestored", resolve, { once: true }));
        extension.restoreContext(); await Promise.race([restored, new Promise((_, reject) => setTimeout(() => reject(new Error("Context restore event timed out")), 5000))]);
        const context = await readAndDraw(), afterContext = sync.snapshot();
        if (section.mesh !== mesh || afterContext.pairWork.componentDecodeCount !== before.pairWork.componentDecodeCount) throw new Error("Context restoration invalidated pure account content");
        renderer.dispose(); chunks.dispose();
        return { first, resident, residentExtraUploadBytes, evicted, context, calls, contextGeneration: renderer.contextGeneration, resourcesAfterDispose: renderer.resourceLedger.snapshot() };
      } finally { sync.cancelActiveSync(); window.fetch = savedFetch; window.Worker = savedWorker; renderer.dispose(); chunks.dispose(); }
    });
    assert.equal(result.calls, 4); assert.ok(result.first.pairToFirstDrawMs >= 0);
    assert.equal(result.resourcesAfterDispose.bufferBytes, 0); assert.equal(result.resourcesAfterDispose.textureBytes, 0);
    evidence.nativeAuthority = result; await save();
  } finally { await browser.close(); }
});
