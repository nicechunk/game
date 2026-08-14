const LAND_CHUNK_SIZE = 16;
const DEFAULT_CHUNKS_X = 1;
const DEFAULT_CHUNKS_Z = 1;
const MAX_CHUNKS_PER_AXIS = 4_096;
const MAX_LAND_CONTRACTS_PER_SITE = 4_096;
const CLEARANCE_BLOCKS = 10;
const VISIBLE_FOUNDATION_RADIUS = 384;
const SYNC_VALIDATION_CELL_LIMIT = 1_024;
const VALIDATION_YIELD_BUDGET_MS = 4;

export function createFoundationController({
  index,
  getChunks = () => null,
  getPlayerPosition = () => [0, 0, 0],
  getWalletAddress = () => "",
  isConstructionModeActive = () => false,
  getLandContractBalance = () => null,
  isBlockingBlock = () => false,
  isFluidBlock = () => false,
  blockAirId = 0,
  submitFoundation = async () => ({ submitted: false, reason: "chain-unavailable" }),
  refreshFoundations = async () => ({ ok: false, reason: "chain-unavailable" }),
  refreshLandContracts = async () => null,
  onChanged = () => {},
  onStatus = () => {},
  translate = (_key, fallback) => fallback,
} = {}) {
  let chunksX = DEFAULT_CHUNKS_X;
  let chunksZ = DEFAULT_CHUNKS_Z;
  let hoverHit = null;
  let anchor = null;
  let preview = null;
  let validationCacheKey = "";
  let validationEpoch = 0;
  let validationTask = null;
  let submitting = false;
  let lastError = "";

  return {
    bind: () => {},
    isActive: () => Boolean(isConstructionModeActive?.()),
    dimensions: dimensionSnapshot,
    setDimensions,
    setHoverHit,
    selectAtHit,
    confirm,
    cancel,
    clearSelection,
    preview: () => preview,
    snapshot,
    overlays,
    isBlockProtected: (block) => Boolean(index?.isBlockProtected?.(block)),
    refresh: refreshFoundations,
  };

  function dimensionSnapshot() {
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
    if (normalizedX === chunksX && normalizedZ === chunksZ) return snapshot();
    chunksX = normalizedX;
    chunksZ = normalizedZ;
    cancelValidation();
    rebuildPreview(anchor?.hit ?? hoverHit, { force: true });
    onChanged(snapshot());
    return snapshot();
  }

  function setHoverHit(hit) {
    if (!isConstructionModeActive?.()) {
      if (hoverHit || preview) clearSelection();
      return null;
    }
    hoverHit = cloneHit(hit);
    if (!anchor) rebuildPreview(hoverHit);
    return preview;
  }

  function selectAtHit(hit) {
    if (!isConstructionModeActive?.()) return { ok: false, reason: "construction-mode-inactive" };
    const nextHit = cloneHit(hit);
    if (!isTopFace(nextHit)) {
      lastError = text("main.land.topFaceRequired", "Select the top face of solid ground.");
      onStatus(lastError);
      onChanged(snapshot());
      return { ok: false, reason: "top-face-required" };
    }
    anchor = { hit: nextHit };
    cancelValidation();
    rebuildPreview(nextHit);
    lastError = preview?.valid
      ? ""
      : preview?.message || text("main.land.invalid", "This chunk area cannot be registered as land.");
    if (lastError) onStatus(lastError);
    onChanged(snapshot());
    return { ok: Boolean(preview?.valid), preview };
  }

  async function confirm() {
    if (submitting) return { submitted: false, reason: "already-submitting" };
    if (!isConstructionModeActive?.()) return { submitted: false, reason: "construction-mode-inactive" };
    if (!anchor && isTopFace(hoverHit)) {
      anchor = { hit: cloneHit(hoverHit) };
      cancelValidation();
      rebuildPreview(anchor.hit, { force: true });
    }
    if (!anchor || !preview) {
      lastError = text("main.land.chooseGround", "Select a flat chunk area for this land contract.");
      onStatus(lastError);
      onChanged(snapshot());
      return { submitted: false, reason: "missing-anchor" };
    }
    const requiredLandContracts = dimensionSnapshot().requiredContracts;
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
      rebuildPreview(anchor.hit, { force: true });
      const pendingValidation = validationTask?.promise;
      if (preview?.validating && pendingValidation) await pendingValidation;
      if (!preview?.valid) {
        lastError = preview?.message || text("main.land.invalid", "This chunk area cannot be registered as land.");
        onStatus(lastError);
        return { submitted: false, reason: preview?.reason || "invalid-foundation" };
      }
      const payload = {
        minX: preview.minX,
        minZ: preview.minZ,
        surfaceY: preview.surfaceY,
        width: preview.width,
        depth: preview.depth,
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
      anchor = null;
      cancelValidation();
      preview = null;
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
    lastError = "";
    anchor = null;
    cancelValidation();
    rebuildPreview(hoverHit, { force: true });
    onChanged(snapshot());
  }

  function clearSelection() {
    anchor = null;
    hoverHit = null;
    preview = null;
    lastError = "";
    cancelValidation();
    onChanged(snapshot());
  }

  function rebuildPreview(hit, { force = false } = {}) {
    if (!isConstructionModeActive?.() || !isTopFace(hit)) {
      preview = null;
      cancelValidation();
      return null;
    }
    const rect = footprintForHit(hit, chunksX, chunksZ, getPlayerPosition());
    const key = `${rect.minX}:${hit.worldY}:${rect.minZ}:${chunksX}:${chunksZ}:${index?.size?.() ?? 0}`;
    if (key === validationCacheKey && (!force || preview?.validating)) return preview;
    cancelValidation();
    validationCacheKey = key;
    preview = validateFootprint(rect, hit.worldY);
    return preview;
  }

  function validateFootprint(rect, groundY) {
    const chunks = getChunks();
    const base = {
      ...rect,
      groundY,
      surfaceY: groundY + 1,
      valid: false,
      reason: "",
      message: "",
      anchored: Boolean(anchor),
      editing: false,
      changed: false,
    };
    if (rect.minX < -0x8000_0000 || rect.maxX > 0x7fff_ffff
      || rect.minZ < -0x8000_0000 || rect.maxZ > 0x7fff_ffff) {
      return { ...base, reason: "coordinate-range", message: text("main.land.coordinateRange", "The land exceeds the supported world coordinate range.") };
    }
    if (index?.intersects?.(rect)) {
      return { ...base, reason: "overlap", message: text("main.land.overlap", "This chunk area overlaps registered land.") };
    }
    const cellsToValidate = BigInt(rect.width) * BigInt(rect.depth);
    if (!chunks?.getOpaqueColumnTopAtWorld || !chunks?.getBlockAtWorld) {
      return { ...base, reason: "world-unavailable", message: text("main.land.worldLoading", "World data is still loading.") };
    }
    if (cellsToValidate > BigInt(SYNC_VALIDATION_CELL_LIMIT)) {
      const pending = {
        ...base,
        validating: true,
        reason: "validating",
        message: text("main.land.validating", "Checking ground level and clearance..."),
      };
      startAsyncValidation(rect, groundY, base, chunks);
      return pending;
    }
    return scanFootprintSync(rect, groundY, base, chunks);
  }

  function scanFootprintSync(rect, groundY, base, chunks) {
    for (let z = rect.minZ; z <= rect.maxZ; z += 1) {
      for (let x = rect.minX; x <= rect.maxX; x += 1) {
        const invalid = validateColumn(x, z, groundY, base, chunks);
        if (invalid) return invalid;
      }
    }
    return { ...base, valid: true, message: validPreviewMessage(base) };
  }

  function startAsyncValidation(rect, groundY, base, chunks) {
    const epoch = ++validationEpoch;
    const key = validationCacheKey;
    const task = { epoch, key, promise: null };
    task.promise = scanFootprintAsync(rect, groundY, base, chunks, epoch)
      .then((result) => {
        if (result && validationEpoch === epoch && validationCacheKey === key) {
          preview = result;
          lastError = result.valid ? "" : result.message;
          if (lastError) onStatus(lastError);
          onChanged(snapshot());
        }
        return result;
      })
      .finally(() => {
        if (validationTask === task) validationTask = null;
      });
    validationTask = task;
  }

  async function scanFootprintAsync(rect, groundY, base, chunks, epoch) {
    let sliceStartedAt = nowMs();
    for (let z = rect.minZ; z <= rect.maxZ; z += 1) {
      for (let x = rect.minX; x <= rect.maxX; x += 1) {
        if (validationEpoch !== epoch) return null;
        const invalid = validateColumn(x, z, groundY, base, chunks);
        if (invalid) return invalid;
        if (nowMs() - sliceStartedAt < VALIDATION_YIELD_BUDGET_MS) continue;
        await yieldToMainThread();
        sliceStartedAt = nowMs();
      }
    }
    return { ...base, valid: true, message: validPreviewMessage(base) };
  }

  function validateColumn(x, z, groundY, base, chunks) {
    const top = Math.trunc(chunks.getOpaqueColumnTopAtWorld(x, z));
    if (top !== groundY) {
      return {
        ...base,
        reason: "not-level",
        invalidCell: { x, y: top, z },
        message: text("main.land.notLevel", "Every block in the selected chunks must be level."),
      };
    }
    const groundBlock = chunks.getBlockAtWorld(x, groundY, z);
    if (!isBlockingBlock(groundBlock) || isFluidBlock(groundBlock)) {
      return {
        ...base,
        reason: "invalid-ground",
        invalidCell: { x, y: groundY, z },
        message: text("main.land.solidGround", "Land registration requires solid, dry ground."),
      };
    }
    for (let y = groundY + 1; y <= groundY + CLEARANCE_BLOCKS; y += 1) {
      const blockId = chunks.getBlockAtWorld(x, y, z);
      if (blockId === blockAirId) continue;
      return {
        ...base,
        reason: "obstructed",
        invalidCell: { x, y, z },
        message: text("main.land.clearArea", "Clear plants, rocks, trees, and buildings from the selected chunks."),
      };
    }
    return null;
  }

  function cancelValidation() {
    validationEpoch += 1;
    validationTask = null;
    validationCacheKey = "";
  }

  function overlays() {
    if (!isConstructionModeActive?.()) return [];
    const [playerX, , playerZ] = getPlayerPosition();
    const result = (index?.listNear?.(playerX, playerZ, VISIBLE_FOUNDATION_RADIUS) ?? []).map((foundation) => ({
      shape: "foundation",
      worldX: foundation.minX,
      worldY: foundation.surfaceY + 0.012,
      worldZ: foundation.minZ,
      width: foundation.width,
      depth: foundation.depth,
      preview: false,
      grid: false,
      fillColor: [0.50, 0.82, 1.0, 0.055],
      gridColor: [0.82, 0.94, 1.0, 0],
      edgeColor: [0.91, 0.98, 1.0, 0.92],
      glowColor: [0.35, 0.84, 1.0, 0.18],
    }));
    if (preview) {
      const valid = preview.valid;
      result.push({
        shape: "foundation",
        worldX: preview.minX,
        worldY: preview.surfaceY + 0.018,
        worldZ: preview.minZ,
        width: preview.width,
        depth: preview.depth,
        preview: true,
        grid: true,
        valid,
        fillColor: valid ? [0.08, 0.48, 1.0, 0.28] : [1.0, 0.12, 0.10, 0.22],
        gridColor: valid ? [0.48, 0.84, 1.0, 0.58] : [1.0, 0.46, 0.42, 0.62],
        edgeColor: valid ? [0.72, 0.96, 1.0, 0.98] : [1.0, 0.56, 0.50, 0.98],
        glowColor: valid ? [0.12, 0.68, 1.0, 0.34] : [1.0, 0.08, 0.06, 0.28],
      });
    }
    return result;
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
      editing: false,
      dimensionsDirty: false,
      submitting,
      preview,
      lastError,
      step: !active ? 1 : !anchor ? 2 : preview?.valid ? 4 : 3,
    };
  }

  function validPreviewMessage() {
    return text("main.land.ready", "Chunk-aligned land is ready. Confirm to consume the required contracts.");
  }

  function text(key, fallback, params = {}) {
    const value = translate?.(key, fallback, params);
    return typeof value === "string" && value !== key
      ? value
      : fallback.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ""));
  }
}

export function footprintForHit(
  hit,
  chunksX,
  chunksZ,
  playerPosition = [0, 0, 0],
  chunkSize = LAND_CHUNK_SIZE,
) {
  const worldX = Math.trunc(Number(hit?.worldX) || 0);
  const worldZ = Math.trunc(Number(hit?.worldZ) || 0);
  const safeChunkSize = clampInt(chunkSize, 1, 0xffff);
  const safeChunksX = clampInt(chunksX, 1, MAX_CHUNKS_PER_AXIS);
  const safeChunksZ = clampInt(chunksZ, 1, MAX_CHUNKS_PER_AXIS);
  const anchorMinX = Math.floor(worldX / safeChunkSize) * safeChunkSize;
  const anchorMinZ = Math.floor(worldZ / safeChunkSize) * safeChunkSize;
  const playerX = Number(playerPosition?.[0]) || 0;
  const playerZ = Number(playerPosition?.[2]) || 0;
  const xDirection = anchorMinX + safeChunkSize * 0.5 >= playerX ? 1 : -1;
  const zDirection = anchorMinZ + safeChunkSize * 0.5 >= playerZ ? 1 : -1;
  const width = safeChunksX * safeChunkSize;
  const depth = safeChunksZ * safeChunkSize;
  const minX = xDirection > 0 ? anchorMinX : anchorMinX - (safeChunksX - 1) * safeChunkSize;
  const minZ = zDirection > 0 ? anchorMinZ : anchorMinZ - (safeChunksZ - 1) * safeChunkSize;
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

function normalizedContractBalance(value) {
  if (value == null || value === "") return null;
  const balance = Number(value);
  return Number.isSafeInteger(balance) && balance >= 0 ? balance : null;
}

function isTopFace(hit) {
  return Boolean(hit?.hit && Math.trunc(Number(hit.faceY)) === 1);
}

function cloneHit(hit) {
  if (!hit?.hit) return null;
  return {
    ...hit,
    worldX: Math.trunc(Number(hit.worldX)),
    worldY: Math.trunc(Number(hit.worldY)),
    worldZ: Math.trunc(Number(hit.worldZ)),
    faceY: Math.trunc(Number(hit.faceY)),
  };
}

function clampInt(value, min, max) {
  const number = Math.trunc(Number(value));
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : min));
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function yieldToMainThread() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
