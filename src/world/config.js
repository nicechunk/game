export let chunkSize = 16;
export const renderDistance = 6;
export const detailRenderDistance = 1;
export const cloudSectorSize = 64;
export const cloudRenderRadius = 1000;
export let landBaseHeight = 100;
export let seaLevel = 96;
export const waterFlowBudget = 160;
export const cloudMinHeight = 220;

export let sectionHeight = 16;
export let minBuildY = -32;
export let maxBuildY = 320;
export let maxTerrainHeight = 240;

export function applyWorldConfigFromChain(config) {
  if (!config || typeof config !== "object") return;
  if (Number.isInteger(config.chunkSize) && config.chunkSize > 0) {
    chunkSize = config.chunkSize;
  }
  if (Number.isInteger(config.sectionHeight) && config.sectionHeight > 0) {
    sectionHeight = config.sectionHeight;
  }
  if (Number.isInteger(config.minBuildY)) {
    minBuildY = config.minBuildY;
  }
  if (Number.isInteger(config.maxBuildY) && config.maxBuildY > minBuildY) {
    maxBuildY = config.maxBuildY;
  }
  if (Number.isInteger(config.maxTerrainHeight)) {
    maxTerrainHeight = Math.min(config.maxTerrainHeight, maxBuildY - 1);
  }
  if (Number.isInteger(config.seaLevel)) {
    seaLevel = config.seaLevel;
  }
  landBaseHeight = Math.max(seaLevel + 4, Math.min(landBaseHeight, maxTerrainHeight - 4));
}
