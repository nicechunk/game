/** Keep the original visual quality; optional GPU diagnostics stay off during play. */
export const PLAY_RENDER_OPTIONS = Object.freeze({
  antialias: false,
  environmentEffects: true,
  waterEffects: true,
  textureQuality: "balanced",
  maxVoxelParticles: 320,
  gpuTiming: false,
});
