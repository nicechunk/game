/** Keep the original visual quality; optional GPU diagnostics stay off during play. */
export const PLAY_RENDER_OPTIONS = Object.freeze({
  antialias: false,
  environmentEffects: true,
  waterEffects: true,
  shadows: false,
  textureQuality: "balanced",
  maxVoxelParticles: 320,
  gpuTiming: false,
  deferredChunkUploads: true,
  sharedChunkBuffers: true,
  maxSharedChunkBufferBytes: 64 * 1024 * 1024,
  maxPrefetchGpuBytes: 192 * 1024 * 1024,
  prefetchWithFrameInFlight: true,
  maxChunkUploadsPerFrame: 16,
});
