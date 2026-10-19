/** Shared terrain/building/discovery policy. Distances are world blocks. */
export function computeViewEnvironment({
  viewDistance = 7, chunkSize = 16, preloadMargin = 2,
  cameraOffsetBlocks = 0,
} = {}) {
  const size = Math.max(1, Number(chunkSize) || 16);
  const view = Math.max(1, Math.trunc(Number(viewDistance) || 7));
  const preload = Math.max(0, Math.trunc(Number(preloadMargin) || 0));
  const renderRadius = view * size;
  const offset = Math.max(0, Number(cameraOffsetBlocks) || 0);
  return {
    viewDistance: view, preloadDistance: view + preload, renderRadiusBlocks: renderRadius,
    cameraOffsetBlocks: offset, fogEnabled: false,
    // Keep the entire selected range inside the camera clipping plane.
    cameraFar: Math.max(460, (view + preload + 2) * size * Math.SQRT2 + offset + 32),
  };
}

/** Gameplay has clear air regardless of selected range or streaming progress. */
export function computePlayViewEnvironment(options = {}) {
  return computeViewEnvironment(options);
}

/** Largest completely committed square ring, available for load diagnostics. */
export function loadedTerrainRadiusBlocks(chunks, playerX, playerZ, viewDistance, chunkSize = 16) {
  const size = Math.max(1, Number(chunkSize) || 16);
  const cx = Math.floor(playerX / size), cz = Math.floor(playerZ / size);
  const localX = playerX - cx * size, localZ = playerZ - cz * size;
  let readyRing = -1;
  for (let ring = 0; ring <= viewDistance; ring += 1) {
    for (let dz = -ring; dz <= ring; dz += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (ring && Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
        const chunk = chunks?.get?.(`${cx + dx},${cz + dz}`);
        if (!chunk?.mesh || chunk.meshVersion < 0) return ringRadius(readyRing);
      }
    }
    readyRing = ring;
  }
  return ringRadius(readyRing);

  function ringRadius(ring) {
    return ring < 0 ? 0 : (ring + 1) * size - Math.max(localX, size - localX, localZ, size - localZ);
  }
}
