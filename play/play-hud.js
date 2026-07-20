import { blockDef, inspectBlock } from "/chunk.js/play.js";

export function createPlayHud({
  elements,
  getChunks = () => null,
  getChainChunkDeltas = () => null,
  getPlayerPosition = () => [0, 0, 0],
  getPoseSnapshot = () => null,
  getDebugController = () => null,
  getLastHit = () => null,
  getLastMiningHit = () => null,
  getLastMiningHitUntil = () => 0,
} = {}) {
  return {
    updateViewRangeLabel,
    update,
  };

  function updateViewRangeLabel(value) {
    if (elements?.viewRangeValue) elements.viewRangeValue.textContent = `${value} chunks`;
  }

  function update(sample, renderStats, uploadStats = { uploaded: 0, pendingUploads: 0 }) {
    const chunks = getChunks();
    if (!chunks || !elements) return;
    const worldStats = chunks.stats();
    if (elements.fps) elements.fps.textContent = `${sample?.fps ?? 0} FPS`;
    if (elements.build) elements.build.textContent = `${worldStats.lastRebuildMs.toFixed(1)} ms / W ${worldStats.lastWorkerBuildMs.toFixed(1)} ms`;

    const chainDeltaStats = getChainChunkDeltas()?.snapshot?.();
    const pdaText = chainDeltaStats
      ? ` · PDA ${chainDeltaStats.syncedChunks}/${worldStats.chunks}${chainDeltaStats.loading ? " syncing" : ""}`
      : "";
    if (elements.chunks) {
      elements.chunks.textContent = `Loaded ${worldStats.chunks} · Ready ${worldStats.ready} · GPU ${worldStats.uploaded} · Queue ${worldStats.buildQueue}+${worldStats.inFlightBuilds} · Upload ${uploadStats.uploaded}/${uploadStats.pendingUploads}${pdaText}`;
    }
    if (elements.visible) elements.visible.textContent = `${renderStats.visibleChunks}`;
    if (elements.triangles) elements.triangles.textContent = formatNumber(renderStats.triangles);
    if (elements.draw) elements.draw.textContent = formatNumber(renderStats.drawCalls);
    if (elements.gpu) elements.gpu.textContent = `${(renderStats.bufferMemory / 1048576).toFixed(2)} MB`;

    const [px, py, pz] = getPlayerPosition();
    if (elements.position) elements.position.textContent = `${px.toFixed(1)}, ${py.toFixed(1)}, ${pz.toFixed(1)}`;

    const debugController = getDebugController();
    debugController?.updatePoseHud(getPoseSnapshot());
    debugController?.updateRenderLogPreview();

    updateHitText(chunks);
  }

  function updateHitText(chunks) {
    if (!elements.hit) return;
    const miningHit = getLastMiningHit();
    const useMiningSnapshot = miningHit?.hit && performance.now() < getLastMiningHitUntil();
    const hudHit = useMiningSnapshot ? miningHit : getLastHit();
    if (!hudHit?.hit) {
      elements.hit.textContent = "-";
      return;
    }
    if (useMiningSnapshot) {
      const def = blockDef(hudHit.blockId);
      const resourceId = Number.isFinite(hudHit.resourceId) ? hudHit.resourceId : def.resourceId;
      elements.hit.textContent = `${def.name} #${def.blockId} / R${resourceId} @ ${hudHit.worldX},${hudHit.worldY},${hudHit.worldZ}`;
      return;
    }
    const info = inspectBlock(chunks, hudHit.worldX, hudHit.worldY, hudHit.worldZ);
    elements.hit.textContent = `${info.blockName} #${info.blockId} / R${info.resourceId} @ ${info.worldX},${info.worldY},${info.worldZ}`;
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Math.round(value || 0));
}
