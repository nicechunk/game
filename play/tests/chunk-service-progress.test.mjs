import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ChunkManager } from "../../chunk.js/chunk/chunk-manager.js";
import { ensureRenderSections } from "../../chunk.js/chunk/render-sections.js";
import { WebGL2VoxelRenderer } from "../../chunk.js/renderer/webgl2-renderer.js";
import { BufferManager } from "../../chunk.js/renderer/buffer-manager.js";
import { traceGl } from "../../chunk.js/tests/helpers/gpu-trace-gl.mjs";
import { createFrameServiceScheduler, remainingFrameWorkMs } from "../play-frame-work-budget.js";
import { createPlayChainBuildingSync } from "../play-chain-buildings.js";
import { importHostChunkSync } from "./host-sync-module.mjs";
const { createPlayChainChunkDeltaSync } = await importHostChunkSync();

for (const hz of [60, 120, 144]) test("production snapshot/building/mesh/GPU stages progress with persistent 5.2ms front work at " + hz + "Hz", async () => {
  const chunks = new ChunkManager({ useWorkers: false, chunkSize: 4, minY: 0, height: 16, viewDistance: 1, shadows: false });
  const owner = chunks.ensureChunk(0, 0, { deferBase: true }); owner.setBaseBlocks(new Uint16Array(4 * 16 * 4)); ensureRenderSections(owner);
  const sync = createPlayChainChunkDeltaSync({ chunks, persistentScopeHint: { cluster: "devnet", programId: "program" },
    persistentCache: { async getVerifiedSnapshots() { return [{ id: "0,0", chunkX: 0, chunkZ: 0, contextSlot: 1, deltas: [{ worldX: 1, worldY: 1, worldZ: 1, blockId: 7 }] }]; } } });
  await sync.preloadPersistentCache();
  const bytes = Buffer.from("budget-building"), contentHash = createHash("sha256").update(bytes).digest("hex");
  const foundation = { owner: "owner", foundationId: "1", accountVersion: 3, status: "active", hasActiveGeometry: true, minX: 0, minZ: 0, width: 16, depth: 16, surfaceY: 1, activeRevision: 1, contentHash };
  const building = { foundationId: "1", owner: "owner", revision: 1, contentHash, code: "NCM3:" + bytes.toString("base64url") };
  let published = 0;
  const buildings = createPlayChainBuildingSync({ autoApply: false, clock: () => 0, getFoundations: () => [foundation],
    cache: { getBuilding: async () => building }, loadChainModule: async () => ({}), applyBuildings: () => published++ });
  await buildings.refresh({ now: 0 });
  const f = traceGl(), renderer = new WebGL2VoxelRenderer({ width: 320, height: 240, addEventListener() {}, removeEventListener() {} },
    { deferredChunkUploads: false, sharedChunkBuffers: false, useRegionBatching: false });
  Object.assign(renderer, { gl: f.gl, initialized: true, bufferManager: new BufferManager(f.gl), textureArray: { bind() {}, dispose() {} } });
  const scheduler = createFrameServiceScheduler(), oldPerformance = globalThis.performance;
  let time = 0;
  globalThis.performance = { now: () => { const result = time; time += .01; return result; } };
  const completed = { snapshot: null, building: null, mesh: null, upload: null };
  try {
    for (let frame = 0; frame < 180; frame++) {
      const start = frame * 1000 / hz; time = start + 5.2;
      const budget = scheduler.beginFrame({ rawFrameIntervalMs: 1000 / hz, startedAt: start, now: time });
      let deadline = budget.deadlineFor("snapshot");
      const applied = sync.applyQueuedDeltas({ deadline, budgetMs: remainingFrameWorkMs(deadline, 1), maxDeltas: 64 });
      if (applied.appliedSnapshots && completed.snapshot === null) completed.snapshot = frame;
      deadline = budget.deadlineFor("building");
      const built = buildings.applyQueuedBuildings({ deadline, budgetMs: remainingFrameWorkMs(deadline, 1) });
      if (built.appliedBuildings && completed.building === null) completed.building = frame;
      deadline = budget.deadlineFor("mesh");
      chunks.rebuildDirtyChunks(remainingFrameWorkMs(deadline, 1), { deadline });
      if (!owner.dirty && owner.mesh?.indexCount && completed.mesh === null) completed.mesh = frame;
      deadline = budget.deadlineFor("upload");
      renderer.prepareChunksForRender([owner], { maxUploads: 2, deadline });
      if (renderer.entryForChunk(owner.renderSections.get(0)) && completed.upload === null) completed.upload = frame;
      if (Object.values(completed).every(frame => frame !== null)) break;
    }
    assert.equal(owner.getFinalBlock(1, 1, 1), 7);
    assert.ok(published > 0);
    assert.ok(Object.values(completed).every(frame => frame !== null && frame < 180), JSON.stringify(completed));
    assert.ok(completed.snapshot <= 3 && completed.building <= 3, "small immediately executable tasks receive their bounded reserved turn");
  } finally { globalThis.performance = oldPerformance; sync.cancelActiveSync(); chunks.dispose(); renderer.dispose(); }
});
