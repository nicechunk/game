import test from "node:test";
import assert from "node:assert/strict";
import { composeVerifiedChunkPair, decodeVerifiedChunkPairs, restoreVerifiedChunkPair, chunkPairWorkSnapshot } from "../play-chain-chunk-pair.js";
import { canonicalChunkWorkSnapshot } from "../play-chain-chunk-canonical.js";
import { fetchChunkAccountBatch, resetChunkRpcCapabilities } from "../play-chain-rpc-batch.js";
import { createChunkPairCache } from "../play-chain-pair-cache.js";
import { createFrameServiceScheduler } from "../play-frame-work-budget.js";
import { decompressChunkAccount } from "../play-chain-zstd.js";

const target = { id: "0,0", chunkX: 0, chunkZ: 0 };
const options = { scope: "genesis|program|global|broken-seed|placed-seed|v1", pubkeys: ["broken", "placed"], expectedOwner: "program", chunkSize: 16, minY: -64, contextSlot: 100, readStartedAt: 1, observedAt: 2 };
function account(kind, rows = [], capacity = Math.max(1, rows.length)) {
  const bytes = new Uint8Array(16 + capacity * (kind === "broken" ? 3 : 9)), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(kind === "broken" ? "NCBK" : "NCPB")); bytes[4] = 1;
  view.setUint16(6, rows.length, true); view.setUint16(8, capacity, true); view.setInt16(10, -64, true);
  rows.forEach(([x, y, z, block = 1, volume = 1], index) => {
    const coord = x | z << 4 | (y + 64) << 8, offset = 16 + index * (kind === "broken" ? 3 : 9);
    bytes[offset] = coord; bytes[offset + 1] = coord >> 8; bytes[offset + 2] = coord >> 16;
    if (kind === "placed") { view.setUint16(offset + 3, block, true); view.setUint32(offset + 5, volume, true); }
  });
  return { data: bytes, owner: "program", executable: false };
}
const full = (kind, rows, capacity) => ({ kind: "full", pubkey: kind, account: account(kind, rows, capacity) });
const unchanged = kind => ({ kind: "unchanged", pubkey: kind });
const absent = kind => ({ kind: "absent", pubkey: kind });
async function pair(rows = []) { return composeVerifiedChunkPair(target, [full("broken", [[1, 0, 1]]), full("placed", rows)], options); }

test("lossless mixed pair removal retains hidden Broken, volumes and source identity independently of render identity", async () => {
  const baseline = await pair([[1, 0, 1, 7, 10]]);
  const removed = await composeVerifiedChunkPair(target, [unchanged("broken"), full("placed", [])], { ...options, baseline, contextSlot: 200, changedSinceSlot: 100 });
  assert.equal(removed.canonical.deltas[0].blockId, 0);
  assert.equal(removed.broken, baseline.broken);
  const changedVolume = await composeVerifiedChunkPair(target, [unchanged("broken"), full("placed", [[1, 0, 1, 7, 11]], 2)], { ...options, baseline, contextSlot: 200, changedSinceSlot: 100 });
  assert.notEqual(changedVolume.pairToken, baseline.pairToken);
  assert.equal(changedVolume.placed.records[4], 11);
  assert.equal(changedVolume.canonical, baseline.canonical);
});

test("double unchanged adds zero decode/hash/canonical work; captured baseline survives eviction", async () => {
  const baseline = await pair([[1, 0, 1, 7, 10]]);
  const before = chunkPairWorkSnapshot(), canonical = canonicalChunkWorkSnapshot();
  const next = await composeVerifiedChunkPair(target, [unchanged("broken"), unchanged("placed")], { ...options, baseline, contextSlot: 200, changedSinceSlot: 100 });
  assert.equal(next.pairToken, baseline.pairToken);
  assert.equal(next.knownAtSlot, 200);
  assert.equal(chunkPairWorkSnapshot().componentDecodeCount, before.componentDecodeCount);
  assert.equal(chunkPairWorkSnapshot().rawDigestComputations, before.rawDigestComputations);
  assert.equal(canonicalChunkWorkSnapshot().canonicalizations, canonical.canonicalizations);
  assert.equal(next.canonical, baseline.canonical);
});

test("pair integrity/scope, absent/unknown, inclusive watermarks and per-pair errors fail closed", async () => {
  const baseline = await pair();
  for (const extra of [{ contextSlot: 99 }, { changedSinceSlot: 101 }, { baseline: null }, { scope: "another-world" }]) {
    await assert.rejects(composeVerifiedChunkPair(target, [unchanged("broken"), unchanged("placed")], { ...options, baseline, changedSinceSlot: 100, ...extra }));
  }
  const empty = await composeVerifiedChunkPair(target, [absent("broken"), absent("placed")], options);
  await assert.rejects(composeVerifiedChunkPair(target, [unchanged("broken"), absent("placed")], { ...options, baseline: empty, changedSinceSlot: 100 }));
  const bad = structuredClone(baseline); bad.placed.rawBytes[4] = 2;
  await assert.rejects(restoreVerifiedChunkPair(bad, { ...options, ...target }));
  const detached = structuredClone(baseline);
  structuredClone(detached.broken.rawBytes, { transfer: [detached.broken.rawBytes.buffer] });
  await assert.rejects(restoreVerifiedChunkPair(detached, { ...options, ...target }));
  const result = await decodeVerifiedChunkPairs([target, { id: "1,0", chunkX: 1, chunkZ: 0 }], [
    full("broken", []), { kind: "error", pubkey: "placed" }, absent("broken"), absent("placed"),
  ], options);
  assert.equal(result.pairs.length, 1); assert.equal(result.errors.length, 1);
  assert.equal(result.pairs[0].id, "1,0");
});

test("reordered/capacity changes preserve rendering; pair cache has both entry and byte bounds without owning request references", async () => {
  const baseline = await pair([[1, 0, 1, 7, 10], [2, 1, 2, 8, 1]]);
  const next = await composeVerifiedChunkPair(target, [unchanged("broken"), full("placed", [[2, 1, 2, 8, 1], [1, 0, 1, 7, 10]], 4)],
    { ...options, baseline, changedSinceSlot: 100 });
  assert.equal(next.canonical, baseline.canonical); assert.notEqual(next.pairToken, baseline.pairToken);
  const memoryStore = new Map(), cache = createChunkPairCache({ getScope: () => options.scope, openDatabase: async () => null, memoryStore, maxRecords: 1, maxBytes: 8192 });
  cache.put([baseline]); cache.put([{ ...next, chunkX: 1 }]);
  assert.ok(cache.snapshot().memoryRecords <= 1); assert.ok(cache.snapshot().memoryBytes <= 8192);
  const restored = await composeVerifiedChunkPair(target, [unchanged("broken"), unchanged("placed")], { ...options, baseline, changedSinceSlot: 100 });
  assert.equal(restored.pairToken, baseline.pairToken);
});

test("strict transport handles mixed observations, ignores extension without retry, targeted invalid envelope and bounded capability fallback", async () => {
  const original = globalThis.fetch;
  let calls = [], mode = "mixed";
  const encoded = { data: [Buffer.from(account("broken", []).data).toString("base64"), "base64"], owner: "program", executable: false };
  globalThis.fetch = async (_, init) => {
    const request = JSON.parse(init.body); calls.push(request);
    const result = mode === "mixed" ? [encoded, { status: "unchanged" }, null, {}]
      : mode === "ignored" ? [encoded, encoded, null, null] : [null, null, null, null];
    const payload = mode === "unsupported" && request.params[1].changedSinceSlot !== undefined
      ? { error: { code: -32602, message: "Invalid params changedSinceSlot" } }
      : { result: { context: { slot: 200 }, value: result } };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...payload }));
  };
  try {
    resetChunkRpcCapabilities();
    const read = extra => fetchChunkAccountBatch({ rpcUrl: "https://fixture.invalid/?api-key=REDACTED", requestId: 9, pubkeys: ["a", "b", "c", "d"], changedSinceSlot: 100, minContextSlot: 150, ...extra });
    const result = await read();
    assert.equal(result.ok, true);
    assert.deepEqual(result.observations.map(item => item.kind), ["full", "unchanged", "absent", "error"]);
    assert.equal(calls[0].params[1].changedSinceSlot, 100); assert.equal(calls[0].params[1].minContextSlot, 150);
    mode = "ignored"; calls = []; await read(); assert.equal(calls.length, 1);
    resetChunkRpcCapabilities(); mode = "unsupported"; calls = []; await read(); assert.equal(calls.length, 2);
    calls = []; await read(); assert.equal(calls.length, 1); assert.equal(calls[0].params[1].changedSinceSlot, undefined);
    resetChunkRpcCapabilities(); calls = [];
    globalThis.fetch = async () => { calls.push(1); return new Response("", { status: 429 }); };
    assert.equal((await read()).httpStatus, 429); assert.equal(calls.length, 1);
  } finally { globalThis.fetch = original; resetChunkRpcCapabilities(); }
});

test("persistent tight frames at 60/120/144Hz reserve every executable lane within four frames", () => {
  for (const hz of [60, 120, 144]) {
    const scheduler = createFrameServiceScheduler();
    const services = Object.fromEntries(["snapshot", "building", "mesh", "upload"].map(key => [key, []]));
    for (let frame = 0; frame < 180; frame++) {
      const start = frame * 1000 / hz, budget = scheduler.beginFrame({ rawFrameIntervalMs: 1000 / hz, startedAt: start, now: start });
      for (const key of Object.keys(services)) if (budget.deadlineFor(key, start + 5.2) > start + 5.2) services[key].push(frame);
    }
    for (const frames of Object.values(services)) {
      assert.equal(frames.length, 45); assert.ok(frames.every((frame, index) => !index || frame - frames[index - 1] === 4));
    }
  }
});

test("bounded Zstd decodes a real raw frame; truncated/oversized/concatenated input is rejected before allocation", () => {
  const content = account("broken", [[1, 0, 1]]).data;
  const frame = new Uint8Array(9 + content.length); frame.set([0x28,0xb5,0x2f,0xfd,0x20,content.length]);
  const header = content.length * 8 + 1; frame.set([header & 255, header >> 8 & 255, header >> 16], 6); frame.set(content, 9);
  assert.deepEqual(decompressChunkAccount(frame), content);
  assert.throws(() => decompressChunkAccount(frame.subarray(0, frame.length - 1)));
  const huge = frame.slice(); huge[4] = 0xa0; assert.throws(() => decompressChunkAccount(huge));
  assert.throws(() => decompressChunkAccount(Uint8Array.from([...frame, ...frame])));
});


test("actual RPC compressed frame with an unknown content size and 2 MiB window has identical account bytes", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixture = JSON.parse(await readFile(new URL("./fixtures/chunk-zstd.json", import.meta.url)));
  assert.deepEqual(Buffer.from(decompressChunkAccount(new Uint8Array(Buffer.from(fixture.zstd, "base64")))), Buffer.from(fixture.base64, "base64"));
});

test("cache byte eviction remains bounded across repeated world travel and never destroys a captured in-flight baseline", async () => {
  const memoryStore = new Map(), cache = createChunkPairCache({ getScope: () => options.scope,
    openDatabase: async () => null, memoryStore, maxRecords: 100, maxBytes: 6000 });
  const captured = await pair([[1, 0, 1, 7, 10]]); cache.put([captured]);
  for (let index = 1; index <= 256; index++) {
    const value = await composeVerifiedChunkPair({ id: index + ",0", chunkX: index, chunkZ: 0 },
      [full("broken", [[1, 0, 1]]), full("placed", [[1, 0, 1, 7, 10]])], options);
    cache.put([value]);
    assert.ok(cache.snapshot().memoryBytes <= 6000);
    assert.ok(cache.snapshot().memoryRecords < 100, "the byte cap independently limits entries");
  }
  assert.ok(cache.snapshot().evictions > 250); assert.equal(cache.peek(target), null);
  const completed = await composeVerifiedChunkPair(target, [unchanged("broken"), unchanged("placed")], { ...options, baseline: captured, changedSinceSlot: 100 });
  assert.equal(completed.pairToken, captured.pairToken);
});
