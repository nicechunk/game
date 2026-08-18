const LAND_CHUNK_SIZE = 16;
const DEFAULT_CHUNKS_X = 1;
const DEFAULT_CHUNKS_Z = 1;
const MAX_CHUNKS_PER_AXIS = 4_096;
const MAX_LAND_CONTRACTS_PER_SITE = 4_096;
const VISIBLE_FOUNDATION_RADIUS = 384;
const TERRAIN_PROFILE_CACHE_LIMIT = 32;
const TERRAIN_PROFILE_SAMPLE_LIMIT = 256;
const FOUNDATION_SURFACE_OFFSET = 0.035;

export function createFoundationController({
  index,
  getChunks = () => null,
  getPlayerPosition = () => [0, 0, 0],
  getWalletAddress = () => "",
  isConstructionModeActive = () => false,
  getLandContractBalance = () => null,
  submitFoundation = async () => ({ submitted: false, reason: "chain-unavailable" }),
  refreshFoundations = async () => ({ ok: false, reason: "chain-unavailable" }),
  refreshLandContracts = async () => null,
  onChanged = () => {},
  onStatus = () => {},
  translate = (_key, fallback) => fallback,
} = {}) {
  let configuredChunksX = DEFAULT_CHUNKS_X;
  let configuredChunksZ = DEFAULT_CHUNKS_Z;
  let hoverHit = null;
  let anchor = null;
  let corner = null;
  let selectionLocked = false;
  let manualSizing = false;
  let preview = null;
  let previewCacheKey = "";
  let submitting = false;
  let lastError = "";
  const terrainProfileCache = new Map();

  return {
    bind: () => {},
    isActive: () => Boolean(isConstructionModeActive?.()),
    dimensions: dimensionSnapshot,
    setDimensions,
    lockDimensions,
    setHoverHit,
    selectAtHit,
    confirm,
    cancel,
    clearSelection,
    preview: () => preview,
    snapshot,
    overlays,
    isBlockProtected: (block) => Boolean(index?.isBlockProtected?.(block, getWalletAddress?.())),
    refresh: refreshFoundations,
  };

  function dimensionSnapshot() {
    const chunksX = preview?.chunksX ?? configuredChunksX;
    const chunksZ = preview?.chunksZ ?? configuredChunksZ;
    return {
      chunksX,
      chunksZ,
      width: chunksX * LAND_CHUNK_SIZE,
      depth: chunksZ * LAND_CHUNK_SIZE,
      requiredContracts: chunksX * chunksZ,
    };
  }

  function setDimensions(nextChunksX, nextChunksZ) {
    if (!isConstructionModeActive?.()) return snapshot();
    const normalizedX = clampInt(nextChunksX, 1, MAX_CHUNKS_PER_AXIS);
    const normalizedZ = clampInt(nextChunksZ, 1, MAX_CHUNKS_PER_AXIS);
    if (BigInt(normalizedX) * BigInt(normalizedZ) > BigInt(MAX_LAND_CONTRACTS_PER_SITE)) {
      lastError = text("main.land.contractCountTooLarge", "This land area requires too many contracts.");
      onStatus(lastError);
      return snapshot();
    }
    configuredChunksX = normalizedX;
    configuredChunksZ = normalizedZ;
    selectionLocked = false;
    corner = null;
    manualSizing = true;
    lastError = "";
    previewCacheKey = "";
    if (anchor) rebuildManualPreview({ force: true });
    else rebuildHoverPreview({ force: true });
    onChanged(snapshot());
    return snapshot();
  }

  function lockDimensions() {
    if (!isConstructionModeActive?.()) return { ok: false, reason: "construction-mode-inactive" };
    if (selectionLocked) return { ok: true, stage: "locked", preview };
    const baseHit = anchor?.hit ?? hoverHit;
    if (!isWorldHit(baseHit)) {
      lastError = text("main.land.selectFirst", "Tap terrain or press F to select the first Chunk.");
      onStatus(lastError);
      onChanged(snapshot());
      return { ok: false, reason: "missing-anchor" };
    }
    const createdAnchor = !anchor;
    if (createdAnchor) anchor = { hit: cloneHit(baseHit) };
    manualSizing = true;
    const rect = manualFootprint(anchor.hit);
    const candidate = buildPreview(rect, anchor.hit, { anchored: true, locked: true, force: true });
    if (!candidate?.valid) {
      if (createdAnchor) anchor = null;
      selectionLocked = false;
      corner = null;
      preview = candidate;
      lastError = candidate?.message || text("main.land.invalid", "This Chunk area cannot be registered as land.");
      onStatus(lastError);
      onChanged(snapshot());
      return { ok: false, reason: candidate?.reason || "invalid-land", preview: candidate };
    }
    corner = { hit: cornerHitForRect(rect, anchor.hit) };
    selectionLocked = true;
    preview = candidate;
    lastError = "";
    onStatus(candidate.message);
    onChanged(snapshot());
    return { ok: true, stage: "locked", preview: candidate };
  }

  function setHoverHit(hit) {
    if (!isConstructionModeActive?.()) {
      if (hoverHit || preview) clearSelection();
      return null;
    }
    hoverHit = cloneHit(hit);
    if (selectionLocked) return preview;
    if (!anchor) rebuildHoverPreview();
    else if (!manualSizing) rebuildCornerPreview(hoverHit ?? anchor.hit);
    return preview;
  }

  function selectAtHit(hit) {
    if (!isConstructionModeActive?.()) return { ok: false, reason: "construction-mode-inactive" };
    const nextHit = cloneHit(hit);
    if (!isWorldHit(nextHit)) {
      lastError = text("main.land.selectTerrain", "Point at terrain inside the Chunk you want to select.");
      onStatus(lastError);
      onChanged(snapshot());
      return { ok: false, reason: "terrain-hit-required" };
    }
    if (selectionLocked) {
      lastError = text("main.land.alreadyLocked", "The area is locked. Clear it before selecting another area.");
      onStatus(lastError);
      onChanged(snapshot());
      return { ok: false, reason: "selection-locked", preview };
    }

    if (!anchor) {
      anchor = { hit: nextHit };
      corner = null;
      manualSizing = false;
      configuredChunksX = 1;
      configuredChunksZ = 1;
      previewCacheKey = "";
      const candidate = buildPreview(
        footprintForCorners(nextHit, nextHit),
        nextHit,
        { anchored: true, locked: false, force: true },
      );
      if (!candidate?.valid) {
        anchor = null;
        preview = { ...candidate, anchored: false, locked: false };
        lastError = candidate?.message || text("main.land.invalid", "This Chunk area cannot be registered as land.");
        onStatus(lastError);
        onChanged(snapshot());
        return { ok: false, reason: candidate?.reason || "invalid-land", preview };
      }
      preview = candidate;
      lastError = "";
      onStatus(candidate.message);
      onChanged(snapshot());
      return { ok: true, stage: "anchor", preview: candidate };
    }

    manualSizing = false;
    const rect = footprintForCorners(anchor.hit, nextHit);
    const candidate = buildPreview(rect, anchor.hit, { anchored: true, locked: true, force: true });
    configuredChunksX = rect.chunksX;
    configuredChunksZ = rect.chunksZ;
    if (!candidate?.valid) {
      corner = null;
      selectionLocked = false;
      preview = { ...candidate, locked: false };
      lastError = candidate?.message || text("main.land.invalid", "This Chunk area cannot be registered as land.");
      onStatus(lastError);
      onChanged(snapshot());
      return { ok: false, reason: candidate?.reason || "invalid-land", preview };
    }
    corner = { hit: nextHit };
    selectionLocked = true;
    preview = candidate;
    lastError = "";
    onStatus(candidate.message);
    onChanged(snapshot());
    return { ok: true, stage: "locked", preview: candidate };
  }

  async function confirm() {
    if (submitting) return { submitted: false, reason: "already-submitting" };
    if (!isConstructionModeActive?.()) return { submitted: false, reason: "construction-mode-inactive" };
    if (!anchor) {
      lastError = text("main.land.selectFirst", "Tap terrain or press F to select the first Chunk.");
      onStatus(lastError);
      onChanged(snapshot());
      return { submitted: false, reason: "missing-anchor" };
    }
    if (!selectionLocked || !preview) {
      lastError = text("main.land.selectCorner", "Select the opposite Chunk corner to lock the area.");
      onStatus(lastError);
      onChanged(snapshot());
      return { submitted: false, reason: "selection-not-locked" };
    }
    const requiredLandContracts = preview.requiredContracts;
    const availableLandContracts = normalizedContractBalance(getLandContractBalance?.());
    if (availableLandContracts !== null && availableLandContracts < requiredLandContracts) {
      lastError = text(
        "main.land.insufficientContracts",
        "You need {required} land contracts but only have {available}. Buy more in Market > Contracts.",
        { required: requiredLandContracts, available: availableLandContracts },
      );
      onStatus(lastError);
      onChanged(snapshot());
      return {
        submitted: false,
        reason: "insufficient-land-contracts",
        requiredLandContracts,
        availableLandContracts,
      };
    }

    submitting = true;
    lastError = "";
    onChanged(snapshot());
    try {
      const lockedPreview = buildPreview(
        footprintForCorners(anchor.hit, corner?.hit ?? anchor.hit),
        anchor.hit,
        { anchored: true, locked: true, force: true },
      );
      preview = lockedPreview;
      if (!lockedPreview?.valid) {
        selectionLocked = false;
        lastError = lockedPreview?.message || text("main.land.invalid", "This Chunk area cannot be registered as land.");
        onStatus(lastError);
        return { submitted: false, reason: lockedPreview?.reason || "invalid-land" };
      }
      const payload = {
        minX: lockedPreview.minX,
        minZ: lockedPreview.minZ,
        surfaceY: lockedPreview.surfaceY,
        width: lockedPreview.width,
        depth: lockedPreview.depth,
      };
      const result = await submitFoundation(payload);
      if (!result?.submitted) {
        lastError = submissionMessage(result, requiredLandContracts);
        onStatus(lastError);
        return result ?? { submitted: false, reason: lastError };
      }
      if (result.foundation) index?.upsert?.(result.foundation);
      await Promise.allSettled([
        refreshFoundations({ force: true, quiet: true }),
        refreshLandContracts({ force: true, quiet: true }),
      ]);
      onStatus(result.message || text("main.land.created", "Land registered on chain and {count} contract(s) consumed.", {
        count: requiredLandContracts,
      }));
      resetSelection({ keepHover: true });
      return result;
    } catch (error) {
      lastError = String(error?.message || error || text("main.land.submitFailed", "Land registration failed."));
      console.error("[NiceChunk Land Submission Failed]", error);
      onStatus(lastError);
      await refreshLandContracts({ force: true, quiet: true }).catch(() => null);
      return { submitted: false, reason: lastError, error };
    } finally {
      submitting = false;
      onChanged(snapshot());
    }
  }

  function submissionMessage(result, requiredLandContracts) {
    if (result?.reason === "insufficient-land-contracts") {
      return text(
        "main.land.insufficientContracts",
        "You need {required} land contracts but only have {available}. Buy more in Market > Contracts.",
        {
          required: result.requiredLandContracts ?? requiredLandContracts,
          available: result.availableLandContracts ?? 0,
        },
      );
    }
    if (result?.reason === "market-membership-required") {
      return text("main.land.marketMembershipRequired", "Join the market before buying or using land contracts.");
    }
    return String(result?.message || result?.reason || text("main.land.submitFailed", "Land registration failed."));
  }

  function cancel() {
    resetSelection({ keepHover: true });
    rebuildHoverPreview({ force: true });
    onChanged(snapshot());
  }

  function clearSelection() {
    resetSelection({ keepHover: false });
    onChanged(snapshot());
  }

  function resetSelection({ keepHover }) {
    anchor = null;
    corner = null;
    selectionLocked = false;
    manualSizing = false;
    configuredChunksX = DEFAULT_CHUNKS_X;
    configuredChunksZ = DEFAULT_CHUNKS_Z;
    if (!keepHover) hoverHit = null;
    preview = null;
    previewCacheKey = "";
    lastError = "";
  }

  function rebuildHoverPreview({ force = false } = {}) {
    if (!isWorldHit(hoverHit)) {
      preview = null;
      previewCacheKey = "";
      return null;
    }
    const rect = manualSizing
      ? footprintForHit(hoverHit, configuredChunksX, configuredChunksZ, getPlayerPosition())
      : footprintForCorners(hoverHit, hoverHit);
    preview = buildPreview(rect, hoverHit, { anchored: false, locked: false, force });
    return preview;
  }

  function rebuildCornerPreview(hit, { force = false } = {}) {
    if (!anchor || !isWorldHit(hit)) return preview;
    const rect = footprintForCorners(anchor.hit, hit);
    configuredChunksX = rect.chunksX;
    configuredChunksZ = rect.chunksZ;
    preview = buildPreview(rect, anchor.hit, { anchored: true, locked: false, force });
    return preview;
  }

  function rebuildManualPreview({ force = false } = {}) {
    if (!anchor) return rebuildHoverPreview({ force });
    const rect = manualFootprint(anchor.hit);
    preview = buildPreview(rect, anchor.hit, { anchored: true, locked: false, force });
    return preview;
  }

  function manualFootprint(anchorHit) {
    const directionHit = corner?.hit ?? hoverHit;
    const directions = chunkDirections(anchorHit, directionHit, getPlayerPosition());
    return footprintFromAnchor(anchorHit, configuredChunksX, configuredChunksZ, directions);
  }

  function buildPreview(rect, referenceHit, { anchored, locked, force = false }) {
    const surfaceY = surfaceYForHit(referenceHit, getChunks());
    const cacheKey = [
      rect.minX,
      rect.minZ,
      rect.width,
      rect.depth,
      surfaceY,
      anchored ? 1 : 0,
      locked ? 1 : 0,
      indexVersion(index),
    ].join(":");
    if (!force && cacheKey === previewCacheKey && preview) return preview;
    previewCacheKey = cacheKey;

    const requiredContracts = rect.chunksX * rect.chunksZ;
    const base = {
      ...rect,
      chunkMinX: Math.floor(rect.minX / LAND_CHUNK_SIZE),
      chunkMinZ: Math.floor(rect.minZ / LAND_CHUNK_SIZE),
      chunkMaxX: Math.floor(rect.maxX / LAND_CHUNK_SIZE),
      chunkMaxZ: Math.floor(rect.maxZ / LAND_CHUNK_SIZE),
      surfaceY,
      minSurfaceY: surfaceY,
      maxSurfaceY: surfaceY,
      requiredContracts,
      valid: false,
      reason: "",
      message: "",
      anchored: Boolean(anchored),
      locked: Boolean(locked),
      editing: false,
      changed: false,
      terrain: null,
    };
    const invalid = validateSelection(base);
    if (invalid) return invalid;
    const terrain = terrainProfileForRect(rect, surfaceY);
    return {
      ...base,
      minSurfaceY: terrain.minSurfaceY,
      maxSurfaceY: terrain.maxSurfaceY,
      terrain,
      valid: true,
      message: locked
        ? validPreviewMessage()
        : anchored
          ? text("main.land.selectCorner", "Move the preview, then select the opposite Chunk corner.")
          : text("main.land.selectFirst", "Tap terrain or press F to select the first Chunk."),
    };
  }

  function validateSelection(base) {
    if (base.chunksX < 1 || base.chunksZ < 1
      || base.chunksX > MAX_CHUNKS_PER_AXIS || base.chunksZ > MAX_CHUNKS_PER_AXIS
      || base.requiredContracts > MAX_LAND_CONTRACTS_PER_SITE) {
      return {
        ...base,
        reason: "contract-count-too-large",
        message: text("main.land.contractCountTooLarge", "This land area requires too many contracts."),
      };
    }
    if (base.minX < -0x8000_0000 || base.maxX > 0x7fff_ffff
      || base.minZ < -0x8000_0000 || base.maxZ > 0x7fff_ffff
      || base.surfaceY < -0x8000 || base.surfaceY > 0x7fff) {
      return {
        ...base,
        reason: "coordinate-range",
        message: text("main.land.coordinateRange", "The land exceeds the supported world coordinate range."),
      };
    }
    if (index?.intersects?.(base)) {
      return {
        ...base,
        reason: "overlap",
        message: text("main.land.overlap", "This Chunk area overlaps registered land."),
      };
    }
    return null;
  }

  function overlays() {
    if (!isConstructionModeActive?.()) return [];
    const [playerX, , playerZ] = getPlayerPosition();
    const result = (index?.listNear?.(playerX, playerZ, VISIBLE_FOUNDATION_RADIUS) ?? []).map((foundation) => {
      const rect = rectForFoundation(foundation);
      const terrain = cachedTerrainProfile(foundation, rect);
      return foundationOverlay({
        foundation,
        rect,
        terrain,
        preview: false,
        grid: false,
        valid: true,
        fillColor: [0.50, 0.82, 1.0, 0.055],
        gridColor: [0.82, 0.94, 1.0, 0],
        edgeColor: [0.91, 0.98, 1.0, 0.92],
        glowColor: [0.35, 0.84, 1.0, 0.18],
      });
    });
    if (preview) {
      const valid = preview.valid;
      result.push(foundationOverlay({
        foundation: preview,
        rect: preview,
        terrain: preview.terrain,
        preview: true,
        grid: true,
        valid,
        xray: true,
        geometryKey: "land-selection-preview",
        fillColor: valid ? [0.08, 0.48, 1.0, 0.24] : [1.0, 0.12, 0.10, 0.20],
        gridColor: valid ? [0.48, 0.84, 1.0, 0.72] : [1.0, 0.46, 0.42, 0.72],
        edgeColor: valid ? [0.72, 0.96, 1.0, 0.98] : [1.0, 0.56, 0.50, 0.98],
        glowColor: valid ? [0.12, 0.68, 1.0, 0.34] : [1.0, 0.08, 0.06, 0.28],
      }));
    }
    return result;
  }

  function foundationOverlay({ foundation, rect, terrain, geometryKey, ...appearance }) {
    const surfaceHeights = terrain?.overlayHeights ?? null;
    return {
      shape: "foundation",
      worldX: rect.minX,
      worldY: (terrain?.minSurfaceY ?? foundation.surfaceY) + FOUNDATION_SURFACE_OFFSET,
      worldZ: rect.minZ,
      width: rect.width,
      depth: rect.depth,
      terrainColumns: rect.chunksX,
      terrainRows: rect.chunksZ,
      terrainCellSize: LAND_CHUNK_SIZE,
      surfaceHeights,
      geometryKey: geometryKey || `land:${foundation.id ?? foundation.foundationId ?? `${rect.minX}:${rect.minZ}`}`,
      geometryRevision: terrain?.revision ?? `flat:${foundation.surfaceY}`,
      ...appearance,
    };
  }

  function cachedTerrainProfile(foundation, rect) {
    const key = [
      foundation.id ?? foundation.foundationId ?? "land",
      rect.minX,
      rect.minZ,
      rect.width,
      rect.depth,
      foundation.surfaceY,
    ].join(":");
    const cached = terrainProfileCache.get(key);
    if (cached) {
      terrainProfileCache.delete(key);
      terrainProfileCache.set(key, cached);
      return cached;
    }
    const profile = terrainProfileForRect(rect, foundation.surfaceY);
    terrainProfileCache.set(key, profile);
    while (terrainProfileCache.size > TERRAIN_PROFILE_CACHE_LIMIT) {
      terrainProfileCache.delete(terrainProfileCache.keys().next().value);
    }
    return profile;
  }

  function terrainProfileForRect(rect, fallbackSurfaceY) {
    const chunks = getChunks();
    const totalChunks = rect.chunksX * rect.chunksZ;
    const { strideX, strideZ } = terrainSampleStrides(rect.chunksX, rect.chunksZ);
    const heights = new Float32Array(totalChunks);
    let minSurfaceY = Infinity;
    let maxSurfaceY = -Infinity;
    let hash = 0x811c9dc5;
    for (let groupZ = 0; groupZ < rect.chunksZ; groupZ += strideZ) {
      const groupRows = Math.min(strideZ, rect.chunksZ - groupZ);
      for (let groupX = 0; groupX < rect.chunksX; groupX += strideX) {
        const groupColumns = Math.min(strideX, rect.chunksX - groupX);
        const sampleChunkX = groupX + Math.floor((groupColumns - 1) * 0.5);
        const sampleChunkZ = groupZ + Math.floor((groupRows - 1) * 0.5);
        const sampleX = rect.minX + sampleChunkX * LAND_CHUNK_SIZE + Math.floor(LAND_CHUNK_SIZE * 0.5);
        const sampleZ = rect.minZ + sampleChunkZ * LAND_CHUNK_SIZE + Math.floor(LAND_CHUNK_SIZE * 0.5);
        const groupSurfaceY = terrainSurfaceYAt(
          chunks,
          sampleX,
          sampleZ,
          fallbackSurfaceY,
        );
        for (let chunkZ = groupZ; chunkZ < groupZ + groupRows; chunkZ += 1) {
          for (let chunkX = groupX; chunkX < groupX + groupColumns; chunkX += 1) {
            heights[chunkZ * rect.chunksX + chunkX] = groupSurfaceY;
            hash ^= Math.trunc(groupSurfaceY) & 0xffff;
            hash = Math.imul(hash, 0x01000193) >>> 0;
          }
        }
        minSurfaceY = Math.min(minSurfaceY, groupSurfaceY);
        maxSurfaceY = Math.max(maxSurfaceY, groupSurfaceY);
      }
    }
    if (!Number.isFinite(minSurfaceY)) minSurfaceY = fallbackSurfaceY;
    if (!Number.isFinite(maxSurfaceY)) maxSurfaceY = fallbackSurfaceY;
    const overlayHeights = new Array(heights.length);
    for (let index = 0; index < heights.length; index += 1) {
      overlayHeights[index] = heights[index] + FOUNDATION_SURFACE_OFFSET;
    }
    return {
      heights,
      overlayHeights,
      minSurfaceY,
      maxSurfaceY,
      revision: `${rect.chunksX}x${rect.chunksZ}:${hash.toString(16).padStart(8, "0")}`,
    };
  }

  function terrainSampleStrides(chunksX, chunksZ) {
    let sampleColumns = chunksX;
    let sampleRows = chunksZ;
    while (sampleColumns * sampleRows > TERRAIN_PROFILE_SAMPLE_LIMIT) {
      if (sampleColumns >= sampleRows && sampleColumns > 1) sampleColumns = Math.ceil(sampleColumns * 0.5);
      else sampleRows = Math.ceil(sampleRows * 0.5);
    }
    return {
      strideX: Math.max(1, Math.ceil(chunksX / sampleColumns)),
      strideZ: Math.max(1, Math.ceil(chunksZ / sampleRows)),
    };
  }

  function snapshot() {
    const active = Boolean(isConstructionModeActive?.());
    const wallet = String(getWalletAddress?.() || "");
    const ownedFoundations = (index?.list?.() ?? []).filter((foundation) => (
      foundation.status !== "removed" && (!wallet || foundation.owner === wallet)
    ));
    const dimensions = dimensionSnapshot();
    return {
      active,
      foundation: null,
      foundationBound: ownedFoundations.length > 0,
      ownedFoundationCount: ownedFoundations.length,
      ...dimensions,
      availableLandContracts: normalizedContractBalance(getLandContractBalance?.()),
      minSize: 1,
      maxSize: MAX_CHUNKS_PER_AXIS,
      maxContracts: MAX_LAND_CONTRACTS_PER_SITE,
      anchored: Boolean(anchor),
      locked: selectionLocked,
      manualSizing,
      canLockDimensions: Boolean((anchor || hoverHit) && !selectionLocked),
      editing: false,
      dimensionsDirty: manualSizing && !selectionLocked,
      submitting,
      preview,
      lastError,
      step: !active ? 1 : !anchor ? 2 : !selectionLocked ? 3 : 4,
    };
  }

  function validPreviewMessage() {
    return text(
      "main.land.ready",
      "Chunk-aligned territory is locked. Existing terrain will remain unchanged.",
    );
  }

  function text(key, fallback, params = {}) {
    const value = translate?.(key, fallback, params);
    return typeof value === "string" && value !== key
      ? value
      : fallback.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ""));
  }
}

export function footprintForCorners(firstHit, secondHit, chunkSize = LAND_CHUNK_SIZE) {
  const safeChunkSize = clampInt(chunkSize, 1, 0xffff);
  const first = chunkCoordinates(firstHit, safeChunkSize);
  const second = chunkCoordinates(secondHit, safeChunkSize);
  const chunkMinX = Math.min(first.chunkX, second.chunkX);
  const chunkMaxX = Math.max(first.chunkX, second.chunkX);
  const chunkMinZ = Math.min(first.chunkZ, second.chunkZ);
  const chunkMaxZ = Math.max(first.chunkZ, second.chunkZ);
  const chunksX = chunkMaxX - chunkMinX + 1;
  const chunksZ = chunkMaxZ - chunkMinZ + 1;
  const minX = chunkMinX * safeChunkSize;
  const minZ = chunkMinZ * safeChunkSize;
  const width = chunksX * safeChunkSize;
  const depth = chunksZ * safeChunkSize;
  return {
    minX,
    minZ,
    maxX: minX + width - 1,
    maxZ: minZ + depth - 1,
    width,
    depth,
    chunksX,
    chunksZ,
  };
}

export function footprintForHit(
  hit,
  chunksX,
  chunksZ,
  playerPosition = [0, 0, 0],
  chunkSize = LAND_CHUNK_SIZE,
) {
  const safeChunkSize = clampInt(chunkSize, 1, 0xffff);
  const safeChunksX = clampInt(chunksX, 1, MAX_CHUNKS_PER_AXIS);
  const safeChunksZ = clampInt(chunksZ, 1, MAX_CHUNKS_PER_AXIS);
  const directions = chunkDirections(hit, null, playerPosition, safeChunkSize);
  return footprintFromAnchor(hit, safeChunksX, safeChunksZ, directions, safeChunkSize);
}

function footprintFromAnchor(hit, chunksX, chunksZ, directions, chunkSize = LAND_CHUNK_SIZE) {
  const safeChunkSize = clampInt(chunkSize, 1, 0xffff);
  const anchor = chunkCoordinates(hit, safeChunkSize);
  const safeChunksX = clampInt(chunksX, 1, MAX_CHUNKS_PER_AXIS);
  const safeChunksZ = clampInt(chunksZ, 1, MAX_CHUNKS_PER_AXIS);
  const chunkMinX = directions.x > 0 ? anchor.chunkX : anchor.chunkX - safeChunksX + 1;
  const chunkMinZ = directions.z > 0 ? anchor.chunkZ : anchor.chunkZ - safeChunksZ + 1;
  const minX = chunkMinX * safeChunkSize;
  const minZ = chunkMinZ * safeChunkSize;
  const width = safeChunksX * safeChunkSize;
  const depth = safeChunksZ * safeChunkSize;
  return {
    minX,
    minZ,
    maxX: minX + width - 1,
    maxZ: minZ + depth - 1,
    width,
    depth,
    chunksX: safeChunksX,
    chunksZ: safeChunksZ,
  };
}

function chunkDirections(anchorHit, directionHit, playerPosition, chunkSize = LAND_CHUNK_SIZE) {
  const anchor = chunkCoordinates(anchorHit, chunkSize);
  if (isWorldHit(directionHit)) {
    const target = chunkCoordinates(directionHit, chunkSize);
    return {
      x: target.chunkX === anchor.chunkX ? playerDirection(anchor.chunkX, playerPosition?.[0], chunkSize) : Math.sign(target.chunkX - anchor.chunkX),
      z: target.chunkZ === anchor.chunkZ ? playerDirection(anchor.chunkZ, playerPosition?.[2], chunkSize) : Math.sign(target.chunkZ - anchor.chunkZ),
    };
  }
  return {
    x: playerDirection(anchor.chunkX, playerPosition?.[0], chunkSize),
    z: playerDirection(anchor.chunkZ, playerPosition?.[2], chunkSize),
  };
}

function playerDirection(anchorChunk, playerCoordinate, chunkSize) {
  const center = anchorChunk * chunkSize + chunkSize * 0.5;
  return center >= (Number(playerCoordinate) || 0) ? 1 : -1;
}

function chunkCoordinates(hit, chunkSize) {
  return {
    chunkX: Math.floor(Math.trunc(Number(hit?.worldX) || 0) / chunkSize),
    chunkZ: Math.floor(Math.trunc(Number(hit?.worldZ) || 0) / chunkSize),
  };
}

function cornerHitForRect(rect, anchorHit) {
  const anchor = chunkCoordinates(anchorHit, LAND_CHUNK_SIZE);
  const chunkMinX = Math.floor(rect.minX / LAND_CHUNK_SIZE);
  const chunkMaxX = Math.floor(rect.maxX / LAND_CHUNK_SIZE);
  const chunkMinZ = Math.floor(rect.minZ / LAND_CHUNK_SIZE);
  const chunkMaxZ = Math.floor(rect.maxZ / LAND_CHUNK_SIZE);
  const chunkX = anchor.chunkX === chunkMinX ? chunkMaxX : chunkMinX;
  const chunkZ = anchor.chunkZ === chunkMinZ ? chunkMaxZ : chunkMinZ;
  return {
    ...anchorHit,
    hit: true,
    worldX: chunkX * LAND_CHUNK_SIZE,
    worldZ: chunkZ * LAND_CHUNK_SIZE,
  };
}

function rectForFoundation(foundation) {
  const minX = Math.trunc(Number(foundation?.minX) || 0);
  const minZ = Math.trunc(Number(foundation?.minZ) || 0);
  const width = Math.max(1, Math.trunc(Number(foundation?.width) || LAND_CHUNK_SIZE));
  const depth = Math.max(1, Math.trunc(Number(foundation?.depth) || LAND_CHUNK_SIZE));
  return {
    minX,
    minZ,
    maxX: minX + width - 1,
    maxZ: minZ + depth - 1,
    width,
    depth,
    chunksX: Math.max(1, Math.ceil(width / LAND_CHUNK_SIZE)),
    chunksZ: Math.max(1, Math.ceil(depth / LAND_CHUNK_SIZE)),
  };
}

function surfaceYForHit(hit, chunks) {
  const fallback = clampInt(Number(hit?.worldY) + 1, -0x8000, 0x7fff);
  return terrainSurfaceYAt(chunks, hit?.worldX, hit?.worldZ, fallback);
}

function terrainSurfaceYAt(chunks, worldX, worldZ, fallbackSurfaceY) {
  if (!chunks?.getOpaqueColumnTopAtWorld) return fallbackSurfaceY;
  try {
    const terrainTop = Number(chunks.getOpaqueColumnTopAtWorld(Math.trunc(worldX), Math.trunc(worldZ)));
    if (!Number.isFinite(terrainTop)) return fallbackSurfaceY;
    let visibleTop = Math.trunc(terrainTop);
    if (chunks.getWaterLevelAtWorld) {
      const rawWater = chunks.getWaterLevelAtWorld(Math.trunc(worldX), Math.trunc(worldZ), visibleTop);
      const waterTop = rawWater == null ? NaN : Number(rawWater);
      if (Number.isFinite(waterTop)) visibleTop = Math.max(visibleTop, Math.trunc(waterTop));
    }
    return clampInt(visibleTop + 1, -0x8000, 0x7fff);
  } catch {
    return fallbackSurfaceY;
  }
}

function indexVersion(index) {
  const value = Number(index?.version?.());
  return Number.isFinite(value) ? Math.trunc(value) : Number(index?.size?.()) || 0;
}

function normalizedContractBalance(value) {
  if (value == null || value === "") return null;
  const balance = Number(value);
  return Number.isSafeInteger(balance) && balance >= 0 ? balance : null;
}

function isWorldHit(hit) {
  return Boolean(hit?.hit)
    && [hit.worldX, hit.worldY, hit.worldZ].every((value) => Number.isFinite(Number(value)));
}

function cloneHit(hit) {
  if (!isWorldHit(hit)) return null;
  return {
    ...hit,
    worldX: Math.trunc(Number(hit.worldX)),
    worldY: Math.trunc(Number(hit.worldY)),
    worldZ: Math.trunc(Number(hit.worldZ)),
    faceX: Math.trunc(Number(hit.faceX) || 0),
    faceY: Math.trunc(Number(hit.faceY) || 0),
    faceZ: Math.trunc(Number(hit.faceZ) || 0),
  };
}

function clampInt(value, min, max) {
  const number = Math.trunc(Number(value));
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : min));
}
