export const BULK_MINING_MAX_SELECTION_BLOCKS = 640;

export function createBulkMiningController({
  chunks,
  blockDef,
  isFluidBlock,
  isMineableBlock,
  blockAirId = 0,
  isBlockProtected = () => false,
  submitBlocks = () => null,
  onStatus = () => {},
  onChanged = () => {},
  translate = (_, fallback) => fallback,
  maxSelectionBlocks = BULK_MINING_MAX_SELECTION_BLOCKS,
} = {}) {
  let enabled = false;
  let phase = "idle";
  let anchor = null;
  let endpoint = null;
  let blocks = [];
  let overflow = false;
  let protectedCount = 0;

  return {
    setEnabled,
    isEnabled: () => enabled,
    selectAtHit,
    confirm,
    cancel,
    clear,
    overlays,
    snapshot,
  };

  function setEnabled(value, { quiet = false } = {}) {
    const next = Boolean(value);
    if (enabled === next) return enabled;
    enabled = next;
    clear({ quiet: true });
    if (!quiet) {
      onStatus(enabled
        ? text("main.bulkMining.enabled", "Bulk mining enabled. Click two blocks to define a volume.")
        : text("main.bulkMining.disabled", "Bulk mining disabled."));
    }
    onChanged(snapshot());
    return enabled;
  }

  function selectAtHit(hit) {
    if (!enabled) return null;
    const target = blockFromHit(hit);
    if (!target) {
      onStatus(text("main.bulkMining.selectSolid", "Select a mineable solid block."));
      return null;
    }
    if (phase === "idle" || phase === "ready") {
      anchor = target;
      endpoint = target;
      phase = "anchored";
      blocks = [target];
      overflow = false;
      protectedCount = 0;
      onStatus(text(
        "main.bulkMining.anchorSet",
        "Selection start set at {x}, {y}, {z}. Click the opposite corner.",
        target,
      ));
      onChanged(snapshot());
      return snapshot();
    }

    endpoint = target;
    phase = "ready";
    rebuildSelection();
    if (overflow) {
      onStatus(text("main.bulkMining.tooLarge", "Selection exceeds the {max}-block debug limit.", {
        max: safeMaxBlocks(),
      }));
    } else if (!blocks.length) {
      onStatus(text("main.bulkMining.empty", "The selected volume contains no mineable blocks."));
    } else {
      onStatus(text("main.bulkMining.ready", "{count} blocks selected. Confirm to submit in chain batches.", {
        count: blocks.length,
      }));
    }
    onChanged(snapshot());
    return snapshot();
  }

  function confirm() {
    if (!enabled || phase !== "ready" || overflow || !blocks.length) {
      onStatus(text("main.bulkMining.incomplete", "Select two corners before confirming bulk mining."));
      return null;
    }
    const selected = blocks.map((block) => ({ ...block }));
    const pending = submitBlocks(selected, { authorization: "debug" });
    if (!pending) return null;
    clear({ quiet: true });
    onStatus(text("main.bulkMining.submitting", "Submitting {count} blocks in chunk batches.", {
      count: selected.length,
    }));
    onChanged(snapshot());
    return pending;
  }

  function cancel() {
    if (!enabled || phase === "idle") return null;
    clear({ quiet: true });
    onStatus(text("main.bulkMining.cancelled", "Bulk mining selection cleared."));
    onChanged(snapshot());
    return snapshot();
  }

  function clear({ quiet = false } = {}) {
    phase = "idle";
    anchor = null;
    endpoint = null;
    blocks = [];
    overflow = false;
    protectedCount = 0;
    if (!quiet) onChanged(snapshot());
  }

  function rebuildSelection() {
    blocks = [];
    overflow = false;
    protectedCount = 0;
    if (!anchor || !endpoint) return;
    const minX = Math.min(anchor.worldX, endpoint.worldX);
    const maxX = Math.max(anchor.worldX, endpoint.worldX);
    const minY = Math.min(anchor.worldY, endpoint.worldY);
    const maxY = Math.max(anchor.worldY, endpoint.worldY);
    const minZ = Math.min(anchor.worldZ, endpoint.worldZ);
    const maxZ = Math.max(anchor.worldZ, endpoint.worldZ);
    const limit = safeMaxBlocks();
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const block = blockAt(x, y, z);
          if (!block) continue;
          if (isBlockProtected(block)) {
            protectedCount += 1;
            continue;
          }
          if (blocks.length >= limit) {
            overflow = true;
            return;
          }
          blocks.push(block);
        }
      }
    }
  }

  function overlays() {
    if (!enabled || !anchor) return [];
    if (phase === "anchored" || !endpoint) {
      return [{
        worldX: anchor.worldX,
        worldY: anchor.worldY,
        worldZ: anchor.worldZ,
        expand: 0.018,
        fillColor: [0.08, 0.78, 1, 0.12],
        lineColor: [0.42, 0.94, 1, 0.96],
      }];
    }
    const bounds = selectionBounds();
    if (!bounds) return [];
    const invalid = overflow || !blocks.length;
    return [{
      worldX: bounds.minX,
      worldY: bounds.minY,
      worldZ: bounds.minZ,
      sizeX: bounds.maxX - bounds.minX + 1,
      sizeY: bounds.maxY - bounds.minY + 1,
      sizeZ: bounds.maxZ - bounds.minZ + 1,
      expand: 0.012,
      fillColor: invalid ? [1, 0.16, 0.08, 0.10] : [0.08, 0.78, 1, 0.09],
      lineColor: invalid ? [1, 0.28, 0.18, 0.96] : [0.54, 0.96, 1, 0.98],
    }];
  }

  function snapshot() {
    return {
      enabled,
      phase,
      anchor: anchor ? { ...anchor } : null,
      endpoint: endpoint ? { ...endpoint } : null,
      blocks: blocks.map((block) => ({ ...block })),
      count: blocks.length,
      overflow,
      protectedCount,
      canConfirm: enabled && phase === "ready" && !overflow && blocks.length > 0,
      maxBlocks: safeMaxBlocks(),
      bounds: selectionBounds(),
    };
  }

  function blockFromHit(hit) {
    if (!hit?.hit) return null;
    return blockAt(
      Math.trunc(Number(hit.worldX)),
      Math.trunc(Number(hit.worldY)),
      Math.trunc(Number(hit.worldZ)),
    );
  }

  function blockAt(worldX, worldY, worldZ) {
    if (![worldX, worldY, worldZ].every(Number.isFinite)) return null;
    const blockId = Math.trunc(Number(chunks?.getBlockAtWorld?.(worldX, worldY, worldZ)) || 0);
    const def = blockDef?.(blockId) ?? {};
    if (blockId === blockAirId || isFluidBlock?.(blockId) || !isMineableBlock?.(blockId) || !def.hardness) return null;
    const chunkSize = Math.max(1, Math.trunc(Number(chunks?.chunkSize) || 16));
    const chunkX = Math.floor(worldX / chunkSize);
    const chunkZ = Math.floor(worldZ / chunkSize);
    return {
      hit: true,
      worldX,
      worldY,
      worldZ,
      chunkX,
      chunkZ,
      localX: positiveModulo(worldX, chunkSize),
      localY: worldY,
      localZ: positiveModulo(worldZ, chunkSize),
      blockId,
      resourceId: Math.trunc(Number(def.resourceId) || 0),
      materialId: Math.trunc(Number(def.materialId) || blockId),
      faceX: 0,
      faceY: 1,
      faceZ: 0,
    };
  }

  function selectionBounds() {
    if (!anchor || !endpoint) return null;
    return {
      minX: Math.min(anchor.worldX, endpoint.worldX),
      maxX: Math.max(anchor.worldX, endpoint.worldX),
      minY: Math.min(anchor.worldY, endpoint.worldY),
      maxY: Math.max(anchor.worldY, endpoint.worldY),
      minZ: Math.min(anchor.worldZ, endpoint.worldZ),
      maxZ: Math.max(anchor.worldZ, endpoint.worldZ),
    };
  }

  function safeMaxBlocks() {
    return Math.max(1, Math.trunc(Number(maxSelectionBlocks) || BULK_MINING_MAX_SELECTION_BLOCKS));
  }

  function text(key, fallback, params = {}) {
    return translate(key, fallback, params) || fallback;
  }
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}
