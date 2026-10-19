export const PLAY_CHUNK_STREAMING_OPTIONS = Object.freeze({
  maxPredictivePreloadChunks: 3,
  maxCachedMeshBytes: 128 * 1024 * 1024,
});

/** Predict from actual travel, independently of where the camera is looking. */
export function createChunkPrefetchPlanner({ lookaheadSeconds = 4, maxAheadChunks = 3 } = {}) {
  let previous = null;
  let velocityX = 0, velocityZ = 0;
  return {
    update(worldX, worldZ, now, { moving = false, chunkSize = 16 } = {}) {
      const sample = { x: worldX, z: worldZ, now };
      const elapsed = previous ? (now - previous.now) / 1000 : 0;
      const dx = previous ? worldX - previous.x : 0, dz = previous ? worldZ - previous.z : 0;
      const continuous = elapsed > 0 && elapsed <= 0.5 && Math.hypot(dx, dz) <= chunkSize;
      if (!moving || !continuous) velocityX = velocityZ = 0;
      else {
        const alpha = 1 - Math.exp(-elapsed / 0.12);
        velocityX += (dx / elapsed - velocityX) * alpha;
        velocityZ += (dz / elapsed - velocityZ) * alpha;
      }
      previous = sample;
      const speed = Math.hypot(velocityX, velocityZ);
      const scale = speed > 0.1 ? Math.min(lookaheadSeconds, maxAheadChunks * chunkSize / speed) : 0;
      return {
        prefetchWorldX: worldX + velocityX * scale,
        prefetchWorldZ: worldZ + velocityZ * scale,
      };
    },
    reset() { previous = null; velocityX = velocityZ = 0; },
  };
}
