export function isPlacedWorldBlock(chunks, worldX, worldY, worldZ, blockAirId = 0) {
  const deltaBlockId = chunks?.getDeltaAtWorld?.(worldX, worldY, worldZ);
  return Number.isInteger(deltaBlockId) && deltaBlockId !== blockAirId;
}
