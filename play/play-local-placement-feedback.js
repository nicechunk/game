import { meshChunkOpaque } from "/chunk.js/chunk/chunk-mesher.js";
import { prepareMeshDrawRanges } from "/chunk.js/renderer/mesh-draw-ranges.js";
import { isOpaqueSolidBlock, BLOCK_ID } from "/chunk.js/world/block-registry.js";

// This layer only adds a bounded, fully textured ordinary opaque block. Removal
// and all exposed/halo faces remain the section mesher's job.
export function createLocalPlacementFeedback({ getChunks, getRenderer, maxActions = 32, maxModels = 64 } = {}) {
  const models = new Map(), actions = new Map(), samples = [];
  let serial = 1, overflow = 0, unsupported = 0, handedOff = 0;
  function prime(blockId) {
    if (models.has(blockId)) return models.get(blockId);
    if (!isOpaqueSolidBlock(blockId) || blockId === BLOCK_ID.cactus) { unsupported++; return null; }
    const source = { chunkX: 0, chunkZ: 0, chunkSize: 1, minY: 0, height: 1, shadows: false, treeInstances: [],
      getFinalBlock: (x, y, z) => x === 0 && y === 0 && z === 0 ? blockId : 0, getFinalDeltaMap: () => new Map() };
    const mesh = prepareMeshDrawRanges(meshChunkOpaque(source));
    if (mesh.vertices.byteLength + mesh.indices.byteLength > 8192) return null;
    models.set(blockId, mesh);
    while (models.size > maxModels) models.delete(models.keys().next().value);
    return mesh;
  }
  function enqueue(action) {
    const chunks = getChunks(), renderer = getRenderer();
    if (!chunks || !renderer || actions.size >= maxActions) { overflow++; return false; }
    const model = models.get(action.blockId);
    if (!model) { queueMicrotask(() => { if (prime(action.blockId)) enqueue(action); }); return false; }
    const chunkX = Math.floor(action.worldX / chunks.chunkSize), chunkZ = Math.floor(action.worldZ / chunks.chunkSize);
    const owner = chunks.chunks.get(chunkX + "," + chunkZ);
    const section = owner?.renderSections?.get(Math.floor((action.worldY - owner.minY) / 16));
    if (!section) return false;
    const vertices = model.vertices.slice(), view = new DataView(vertices.buffer);
    for (let offset = 0; offset < vertices.byteLength; offset += 20) {
      const scale = view.getInt16(offset + 6, true);
      view.setInt16(offset, view.getInt16(offset, true) + (action.worldX - chunkX * chunks.chunkSize) * scale, true);
      view.setInt16(offset + 4, view.getInt16(offset + 4, true) + (action.worldZ - chunkZ * chunks.chunkSize) * scale, true);
    }
    const mesh = { ...model, vertices, chunkX, chunkZ, chunkSize: chunks.chunkSize, originY: action.worldY };
    // Recompute local bounds after the small translation. Material partitions
    // and UVs are exactly those of the ordinary terrain cube.
    delete mesh.materialPassLayout;
    const proxy = { id: "local-placement:" + action.txId, generation: serial++, localPlacement: true,
      chunkX, chunkZ, chunkSize: chunks.chunkSize, minY: action.worldY, height: 1, originY: action.worldY,
      mesh: prepareMeshDrawRanges(mesh), meshVersion: 1, meshCommitToken: 1, visualMesh: null,
      meshReadyAt: performance.now(), gpuUploaded: false, materialVersion: owner.materialVersion };
    actions.set(action.txId, { ...action, proxy, owner, section, dataRevision: section.dataRevision,
      startedAt: performance.now(), sample: null });
    return true;
  }
  function remove(txId) {
    const action = actions.get(txId); if (!action) return false;
    getRenderer()?.removeChunk(action.proxy.id); actions.delete(txId); return true;
  }
  function collect() {
    const chunks = getChunks(), renderer = getRenderer();
    for (const [txId, action] of actions) {
      const { section, proxy } = action;
      const entry = renderer.entryForChunk(proxy);
      if (entry?.firstDrawAt != null && !action.sample) {
        action.sample = { txId, localAction: action.startedAt, firstDrawSubmitted: entry.firstDrawAt,
          elapsedMs: entry.firstDrawAt - action.startedAt, revision: action.dataRevision };
        samples.push(action.sample); if (samples.length > 128) samples.shift();
      }
      const official = renderer.entryForChunk(section);
      const current = chunks.chunks.get(action.owner.id) === action.owner
        && chunks.getBlockAtWorld(action.worldX, action.worldY, action.worldZ) === action.blockId;
      if (!current || !section.dirty && section.meshVersion >= action.dataRevision && section.gpuUploaded && official?.mesh === section.mesh) {
        if (current) handedOff++;
        remove(txId);
      }
    }
    return [...actions.values()].map(action => action.proxy);
  }
  return { prime, enqueue, remove, collect, ids: () => [...actions.values()].map(action => action.proxy.id),
    snapshot: () => ({ active: actions.size, models: models.size, overflow, unsupported, handedOff, samples: [...samples],
      bytes: [...models.values()].reduce((sum, mesh) => sum + mesh.vertices.byteLength + mesh.indices.byteLength, 0)
        + [...actions.values()].reduce((sum, action) => sum + action.proxy.mesh.vertices.byteLength, 0) }),
  };
}
