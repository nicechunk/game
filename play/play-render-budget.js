const DEFAULT_CHUNK_LOAD_UPDATE_MS = 70;
const DEFAULT_GPU_PRUNE_MS = 650;
const DEFAULT_IDLE_UPLOAD_SCAN_MS = 220;

export function createPlayRenderBudget({
  preloadMargin = 2,
  maxViewDistance = 20,
  getFps = () => 60,
  getControls = () => null,
  getChunks = () => null,
  getRenderer = () => null,
  isMotionActive = () => false,
  isMobileViewport = () => false,
  chunkLoadUpdateMs = DEFAULT_CHUNK_LOAD_UPDATE_MS,
  gpuPruneMs = DEFAULT_GPU_PRUNE_MS,
  idleUploadScanMs = DEFAULT_IDLE_UPLOAD_SCAN_MS,
} = {}) {
  const state = {
    lastChunkLoadAt: 0,
    lastGpuPruneAt: 0,
    lastIdleUploadScanAt: 0,
    lastLoadChunkKey: "",
    worldVisible: false,
    worldCovered: false,
  };

  return {
    preferredWorkerCount,
    maxBuildQueueForViewDistance,
    frameUploadBudget,
    frameBuildConcurrencyLimit,
    shouldDeferRegionUploads,
    uploadCandidatesForFrame,
    noteWorldVisible,
    noteWorldCovered,
    shouldUpdateChunkLoad,
    shouldPruneGpu,
    reset,
  };

  function preferredWorkerCount() {
    const cores = Number(navigator.hardwareConcurrency) || 4;
    const coarse = Boolean(isMobileViewport() || globalThis.matchMedia?.("(pointer: coarse)")?.matches);
    if (coarse) return Math.max(1, Math.min(3, cores - 1));
    return Math.max(1, Math.min(6, cores - 2));
  }

  function maxBuildQueueForViewDistance(distance) {
    const preload = clampInt(distance, 2, maxViewDistance) + preloadMargin;
    const fullRing = preload * 2 + 1;
    return Math.max(768, fullRing * fullRing);
  }

  function frameUploadBudget() {
    const fps = normalizedFps();
    const controls = getControls();
    const sprinting = controls?.keys?.has("ShiftLeft") || controls?.keys?.has("ShiftRight");
    const base = getRenderer()?.options?.maxChunkUploadsPerFrame ?? 3;
    // During the covered startup, sampled FPS includes compilation/deferred
    // frames. It must not turn initial uploads into a one-channel serial queue.
    // The renderer still enforces its CPU deadline, byte cap and GPU fences.
    if (!state.worldCovered) return Math.min(12, Math.max(base, isMobileViewport() ? 4 : 8));
    if (fps < 36) return 1;
    if (isMotionActive() || controls?.move?.moving) {
      if (fps > 55) return sprinting ? 4 : 5;
      return sprinting ? 3 : 2;
    }
    if (fps > 55) return Math.max(base, 7);
    if (fps > 45) return Math.max(base, 4);
    return 2;
  }

  function frameBuildConcurrencyLimit() {
    const chunks = getChunks();
    if (!chunks?.useWorkers) return 0;
    const fps = normalizedFps();
    const controls = getControls();
    const sprinting = controls?.keys?.has("ShiftLeft") || controls?.keys?.has("ShiftRight");
    const workers = chunks.workerCount || 1;
    // preferredWorkerCount already reserves CPU cores for the main thread.
    // Serializing the first build delays both the scene and the rest of the
    // Worker startup. Give the bounded pool its initial work immediately.
    if (!state.worldVisible) return workers;
    // A large queue is a streaming backlog, not an incidental remesh. Let the
    // reserved worker pool drain it instead of creating a low-FPS serial loop.
    if (chunks.buildQueue.length > Math.max(2, workers)) return workers;
    if (fps < 36) return 1;
    if (sprinting) return Math.min(workers, fps > 52 ? 2 : 1);
    if (isMotionActive()) return Math.min(workers, fps > 55 ? 2 : 1);
    if (fps > 55) return workers;
    if (fps > 45) return Math.min(workers, 2);
    return 1;
  }

  function shouldDeferRegionUploads(moving = false) {
    if (moving) return true;
    const chunks = getChunks();
    return Boolean((chunks?.buildQueue?.length || 0) + (chunks?.inFlightBuilds?.size || 0));
  }

  function uploadCandidatesForFrame(now, visibleChunks, movingNow) {
    if (!movingNow && now - state.lastIdleUploadScanAt >= idleUploadScanMs) state.lastIdleUploadScanAt = now;
    return visibleChunks;
  }

  function noteWorldVisible(visible = true) {
    if (visible) state.worldVisible = true;
  }

  function noteWorldCovered(covered = true) {
    if (covered) state.worldCovered = true;
  }

  function shouldUpdateChunkLoad(now, chunkKey, { force = false } = {}) {
    if (!force && chunkKey === state.lastLoadChunkKey && now - state.lastChunkLoadAt < chunkLoadUpdateMs) return false;
    state.lastLoadChunkKey = chunkKey;
    state.lastChunkLoadAt = now;
    return true;
  }

  function shouldPruneGpu(now, { force = false } = {}) {
    if (!force && now - state.lastGpuPruneAt < gpuPruneMs) return false;
    state.lastGpuPruneAt = now;
    return true;
  }

  function reset() {
    state.lastChunkLoadAt = 0;
    state.lastGpuPruneAt = 0;
    state.lastIdleUploadScanAt = 0;
    state.lastLoadChunkKey = "";
    state.worldVisible = false;
    state.worldCovered = false;
  }

  function normalizedFps() {
    const fps = Number(getFps());
    return Number.isFinite(fps) && fps > 0 ? fps : 60;
  }
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(Number(value) || min)));
}
