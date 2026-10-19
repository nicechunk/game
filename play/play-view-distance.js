/** Shared terrain/building/discovery policy. Distances are world blocks. */
export function computeViewEnvironment({
  viewDistance = 7, chunkSize = 16, preloadMargin = 2,
  cameraOffsetBlocks = 0, loadedRadiusBlocks = Infinity,
  fov = 58, aspect = 16 / 9,
  fogStartRatio = 0.62, edgeSafetyBlocks = chunkSize * 0.25,
} = {}) {
  const size = Math.max(1, Number(chunkSize) || 16);
  const view = Math.max(1, Math.trunc(Number(viewDistance) || 7));
  const preload = Math.max(0, Math.trunc(Number(preloadMargin) || 0));
  const renderRadius = view * size;
  const loaded = Number.isFinite(loadedRadiusBlocks) ? Math.max(0, loadedRadiusBlocks) : renderRadius;
  const offset = Math.max(0, Number(cameraOffsetBlocks) || 0);
  const tanVertical = Math.tan(Math.max(1, Math.min(170, Number(fov) || 58)) * Math.PI / 360);
  const tanHorizontal = tanVertical * Math.max(0.01, Number(aspect) || 1);
  // Fog shaders measure forward eye depth, not radial distance. At a frustum
  // corner, depth is smaller by this cosine; cover edges as well as the center.
  const depthProjectionScale = 1 / Math.hypot(1, tanHorizontal, tanVertical);
  const effectiveRadius = Math.max(0, Math.min(renderRadius, loaded) - offset - Math.max(0, edgeSafetyBlocks));
  const far = Math.max(4, effectiveRadius * depthProjectionScale);
  const near = Math.max(0.5, Math.min(far - 1, far * Math.max(0.1, Math.min(0.95, fogStartRatio))));
  return {
    viewDistance: view, preloadDistance: view + preload, renderRadiusBlocks: renderRadius,
    loadedRadiusBlocks: loaded, cameraOffsetBlocks: offset, fogDepthProjectionScale: depthProjectionScale, fogNearFar: [near, far],
    // Preserve the sky/sun pass while allowing the far plane to follow large views.
    cameraFar: Math.max(460, (view + preload + 2) * size * Math.SQRT2 + offset + 32),
  };
}

/** Largest completely committed square ring, inspected at low frequency. */
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
