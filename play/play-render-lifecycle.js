// GPU terrain entries may use section IDs while discovery retains chain chunk
// IDs. Let the renderer resolve parent ownership instead of deleting every
// section as if it were an unloaded whole chunk.
export function prunePlayRenderChunks(renderer,terrainChunks,buildingIds=new Set()) {
  const liveIds=new Set(terrainChunks.keys());
  for(const id of buildingIds)liveIds.add(id);
  renderer.pruneChunks(liveIds);
  return liveIds;
}
