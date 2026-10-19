/** Gameplay favors bounded GPU work. DOM HUD and pointer coordinates stay at CSS resolution. */
export const PLAY_RENDER_OPTIONS = Object.freeze({
  antialias: false,
  maxMobileDpr: 1,
  maxDesktopDpr: 1,
  maxRenderPixels: 1280 * 720,
  environmentEffects: false,
  waterEffects: false,
  textureQuality: "pixel",
  maxVoxelParticles: 80,
});
