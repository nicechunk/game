import { chunkIntersectsCameraFrustum, prepareCameraFrustum, cameraRenderCenterChunk } from "../chunk.js/renderer/frustum.js";

// render() normally updates aspect. Covered startup can skip that draw, so the
// current viewport must reach culling/readiness before any initial GPU upload.
export function syncPlayStartupViewport(renderer, camera) {
  renderer.resize();
  camera.aspect = Math.max(1, renderer.canvas.width) / Math.max(1, renderer.canvas.height);
}

/** Initial coverage uses both unbuilt column bounds and committed GPU channels. */
export function measurePlayWorldReadiness(chunks, renderer, camera) {
  const frustum = prepareCameraFrustum(camera);
  const center = cameraRenderCenterChunk(camera,chunks.chunkSize);
  let targetChunks = 0, readyChunks = 0, pendingChannels = 0;
  for (const chunk of chunks.chunks.values()) {
    const near = Math.max(Math.abs(chunk.chunkX - chunks.centerChunkX), Math.abs(chunk.chunkZ - chunks.centerChunkZ)) <= 1;
    const distance = Math.max(Math.abs(chunk.chunkX - center.chunkX), Math.abs(chunk.chunkZ - center.chunkZ));
    if (!near && distance > chunks.viewDistance) continue;
    const visible = distance <= chunks.viewDistance && chunkIntersectsCameraFrustum(chunk, camera, frustum);
    // The immediate collision neighborhood must also finish its initial base.
    if (!visible && !near) continue;
    targetChunks++;
    if (!chunk.baseBlocksReady || !chunk.mesh) continue;
    const sections = chunk.renderSections?.values() ?? [chunk];
    let complete = true;
    for (const section of sections) {
      if (section.mesh == null || (chunk.renderSections && section.visualMesh == null)) { complete = false; continue; }
      if (!section.mesh.indexCount && !section.visualMesh?.indexCount) continue;
      if (!visible || !chunkIntersectsCameraFrustum(section, camera, frustum)) continue;
      for (const visual of [false, true]) {
        const mesh = section[visual ? "visualMesh" : "mesh"];
        if (!mesh?.indexCount) continue;
        const entry = renderer.entryForChunk(section, visual);
        if (entry?.mesh === mesh && section[visual ? "visualGpuUploaded" : "gpuUploaded"]) continue;
        pendingChannels++;
        complete = false;
      }
    }
    if (complete) readyChunks++;
  }
  return { ready: targetChunks > 0 && targetChunks === readyChunks, targetChunks, readyChunks, pendingChannels };
}

/** Opaque loading UI hides these draws; buffer validation still progresses. */
export function shouldDeferCoveredWorld(readiness, loading = globalThis.NiceChunkLoading) {
  return Boolean(readiness && !readiness.ready && loading?.coversWorld?.());
}
