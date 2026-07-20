const DEFAULT_WIDTH = 12;
const DEFAULT_DEPTH = 8;
const MIN_SIZE = 2;
const MAX_PROTOCOL_SIZE = 0xffff_ffff;
const CLEARANCE_BLOCKS = 10;
const VISIBLE_FOUNDATION_RADIUS = 384;
const SYNC_VALIDATION_CELL_LIMIT = 1_024;
const VALIDATION_YIELD_BUDGET_MS = 4;

export function createFoundationController({
  index,
  getChunks = () => null,
  getPlayerPosition = () => [0, 0, 0],
  getWalletAddress = () => "",
  getSelectedBlueprint = () => null,
  isBlueprintModeActive = () => Boolean(getSelectedBlueprint?.()),
  isBlockingBlock = () => false,
  isFluidBlock = () => false,
  blockAirId = 0,
  submitFoundation = async () => ({ submitted: false, reason: "chain-unavailable" }),
  submitFoundationResize = async () => ({ submitted: false, reason: "chain-unavailable" }),
  refreshFoundations = async () => ({ ok: false, reason: "chain-unavailable" }),
  onChanged = () => {},
  onStatus = () => {},
  translate = (_key, fallback) => fallback,
} = {}) {
  let width = DEFAULT_WIDTH;
  let depth = DEFAULT_DEPTH;
  let hoverHit = null;
  let anchor = null;
  let preview = null;
  let validationCacheKey = "";
  let validationEpoch = 0;
  let validationTask = null;
  let submitting = false;
  let lastError = "";
  let activeBlueprintId = "";
  let boundFoundationSignature = "";
  let dimensionsDirty = false;
  const blueprintDrafts = new Map();

  return {
    bind: () => {},
    isActive: () => Boolean(syncSelectedBlueprint()),
    dimensions: () => {
      const blueprint = syncSelectedBlueprint();
      const foundation = foundationForBlueprint(blueprint);
      syncFoundationEditor(foundation);
      return { width, depth };
    },
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

  function setDimensions(nextWidth, nextDepth) {
    const blueprint = syncSelectedBlueprint();
    const foundation = foundationForBlueprint(blueprint);
    syncFoundationEditor(foundation);
    if (!blueprint) return snapshot();
    const normalizedWidth = clampInt(nextWidth, MIN_SIZE, MAX_PROTOCOL_SIZE);
    const normalizedDepth = clampInt(nextDepth, MIN_SIZE, MAX_PROTOCOL_SIZE);
    if (normalizedWidth === width && normalizedDepth === depth) return snapshot();
    width = normalizedWidth;
    depth = normalizedDepth;
    dimensionsDirty = Boolean(foundation)
      && (width !== foundation.width || depth !== foundation.depth);
    saveBlueprintDraft();
    cancelValidation();
    rebuildPreview(anchor?.hit ?? hoverHit, { force: true });
    onChanged(snapshot());
    return snapshot();
  }

  function setHoverHit(hit) {
    const blueprint = syncSelectedBlueprint();
    const foundation = foundationForBlueprint(blueprint);
    syncFoundationEditor(foundation);
    if (foundation) {
      hoverHit = null;
      return preview;
    }
    if (!blueprint) {
      if (hoverHit || preview) {
        hoverHit = null;
        if (!anchor) preview = null;
        onChanged(snapshot());
      }
      return null;
    }
    hoverHit = cloneHit(hit);
    if (!anchor) rebuildPreview(hoverHit);
    return preview;
  }

  function selectAtHit(hit) {
    const blueprint = syncSelectedBlueprint();
    if (!blueprint) return { ok: false, reason: "blueprint-not-selected" };
    const foundation = foundationForBlueprint(blueprint);
    syncFoundationEditor(foundation);
    if (foundation) {
      if (!hitWithinFoundation(hit, foundation)) {
        lastError = text("main.blueprint.selectBoundFoundation", "Click this blueprint's foundation to edit its size.");
        onStatus(lastError);
        onChanged(snapshot());
        return { ok: false, reason: "bound-foundation-not-selected" };
      }
      anchor = { hit: foundationHit(foundation), editing: true };
      cancelValidation();
      rebuildBoundPreview(foundation, { force: true });
      lastError = preview?.valid ? "" : preview?.message || "";
      onStatus(lastError);
      onChanged(snapshot());
      return { ok: Boolean(preview?.valid), editing: true, foundation, preview };
    }
    const nextHit = cloneHit(hit);
    if (!isTopFace(nextHit)) {
      lastError = text("main.blueprint.topFaceRequired", "Select the top face of a solid ground block.");
      onStatus(lastError);
      onChanged(snapshot());
      return { ok: false, reason: "top-face-required" };
    }
    anchor = { hit: nextHit };
    cancelValidation();
    rebuildPreview(nextHit);
    lastError = preview?.valid
      ? ""
      : preview?.message || text("main.blueprint.invalid", "This area cannot be used as a foundation.");
    if (lastError) onStatus(lastError);
    onChanged(snapshot());
    return { ok: Boolean(preview?.valid), preview };
  }

  async function confirm() {
    if (submitting) return { submitted: false, reason: "already-submitting" };
    const blueprint = syncSelectedBlueprint();
    if (!blueprint) return { submitted: false, reason: "blueprint-not-selected" };
    const foundation = foundationForBlueprint(blueprint);
    syncFoundationEditor(foundation);
    if (foundation && !dimensionsDirty) {
      return { submitted: false, reason: "foundation-size-unchanged", foundation };
    }
    if (!foundation && !anchor && isTopFace(hoverHit)) {
      anchor = { hit: cloneHit(hoverHit) };
      cancelValidation();
      rebuildPreview(anchor.hit, { force: true });
    }
    if (!anchor || !preview) {
      lastError = text("main.blueprint.chooseGround", "Click a flat area to place the blueprint.");
      onStatus(lastError);
      onChanged(snapshot());
      return { submitted: false, reason: "missing-anchor" };
    }
    submitting = true;
    lastError = "";
    onChanged(snapshot());
    try {
      rebuildPreview(anchor.hit, { force: true });
      const pendingValidation = validationTask?.promise;
      if (preview?.validating && pendingValidation) await pendingValidation;
      if (!preview?.valid) {
        lastError = preview?.message || text("main.blueprint.invalid", "This area cannot be used as a foundation.");
        onStatus(lastError);
        return { submitted: false, reason: preview?.reason || "invalid-foundation" };
      }
      const payload = {
        blueprintId: blueprint.blueprintId,
        minX: preview.minX,
        minZ: preview.minZ,
        surfaceY: preview.surfaceY,
        width: preview.width,
        depth: preview.depth,
      };
      const result = await (foundation ? submitFoundationResize(payload) : submitFoundation(payload));
      if (!result?.submitted) {
        lastError = String(result?.message || result?.reason || (foundation
          ? text("main.blueprint.resizeFailed", "Foundation size update failed.")
          : text("main.blueprint.submitFailed", "Foundation submission failed.")));
        onStatus(lastError);
        return result ?? { submitted: false, reason: lastError };
      }
      if (result.foundation) index?.upsert?.(result.foundation);
      await refreshFoundations({ force: true, quiet: true });
      onStatus(result.guardianIndexed === false
        ? result.message || text("main.blueprint.guardianIndexPending", "The foundation is on chain, but Guardian indexing is still pending: {reason}.", {
          reason: text("main.blueprint.guardianUnavailable", "Guardian unavailable"),
        })
        : foundation
          ? text("main.blueprint.resized", "Foundation size updated and protected on chain.")
          : text("main.blueprint.created", "Foundation created and protected on chain."));
      anchor = null;
      cancelValidation();
      preview = null;
      dimensionsDirty = false;
      boundFoundationSignature = "";
      saveBlueprintDraft();
      syncFoundationEditor(foundationForBlueprint(blueprint));
      return result;
    } catch (error) {
      lastError = String(error?.message || error || (foundation
        ? text("main.blueprint.resizeFailed", "Foundation size update failed.")
        : text("main.blueprint.submitFailed", "Foundation submission failed.")));
      console.error("[NiceChunk Foundation Submission Failed]", error);
      onStatus(lastError);
      return { submitted: false, reason: lastError, error };
    } finally {
      submitting = false;
      onChanged(snapshot());
    }
  }

  function cancel() {
    const blueprint = syncSelectedBlueprint();
    const foundation = foundationForBlueprint(blueprint);
    lastError = "";
    cancelValidation();
    if (foundation) {
      width = foundation.width;
      depth = foundation.depth;
      dimensionsDirty = false;
      anchor = { hit: foundationHit(foundation), editing: true };
      rebuildBoundPreview(foundation, { force: true });
    } else {
      anchor = null;
      rebuildPreview(hoverHit, { force: true });
    }
    onChanged(snapshot());
  }

  function clearSelection() {
    anchor = null;
    hoverHit = null;
    preview = null;
    lastError = "";
    boundFoundationSignature = "";
    dimensionsDirty = false;
    cancelValidation();
    onChanged(snapshot());
  }

  function rebuildPreview(hit, { force = false } = {}) {
    const blueprint = syncSelectedBlueprint();
    const foundation = foundationForBlueprint(blueprint);
    syncFoundationEditor(foundation);
    if (foundation) return rebuildBoundPreview(foundation, { force });
    if (!blueprint || !isTopFace(hit)) {
      preview = null;
      cancelValidation();
      return null;
    }
    const rect = footprintForHit(hit, width, depth, getPlayerPosition());
    const key = `${blueprint.blueprintId}:${rect.minX}:${hit.worldY}:${rect.minZ}:${width}:${depth}:${index?.size?.() ?? 0}`;
    if (key === validationCacheKey && (!force || preview?.validating)) return preview;
    cancelValidation();
    validationCacheKey = key;
    preview = validateFootprint(rect, hit.worldY);
    return preview;
  }

  function rebuildBoundPreview(foundation, { force = false } = {}) {
    const rect = rectForFoundationSize(foundation, width, depth);
    const key = `${foundation.id}:edit:${foundation.minX}:${foundation.surfaceY}:${foundation.minZ}:${width}:${depth}:${index?.size?.() ?? 0}`;
    if (key === validationCacheKey && (!force || preview?.validating)) return preview;
    cancelValidation();
    validationCacheKey = key;
    preview = validateFootprint(rect, foundation.surfaceY - 1, { editingFoundation: foundation });
    return preview;
  }

  function validateFootprint(rect, groundY, { editingFoundation = null } = {}) {
    const chunks = getChunks();
    const changed = Boolean(editingFoundation)
      && (rect.width !== editingFoundation.width || rect.depth !== editingFoundation.depth);
    const base = {
      ...rect,
      groundY,
      surfaceY: groundY + 1,
      valid: false,
      reason: "",
      message: "",
      anchored: Boolean(anchor),
      editing: Boolean(editingFoundation),
      changed,
      editingFoundation,
    };
    if (rect.minX < -0x8000_0000 || rect.maxX > 0x7fff_ffff
      || rect.minZ < -0x8000_0000 || rect.maxZ > 0x7fff_ffff) {
      return { ...base, reason: "coordinate-range", message: text("main.blueprint.coordinateRange", "The foundation exceeds the supported world coordinate range.") };
    }
    const overlap = index?.intersects?.(rect, { ignoreId: editingFoundation?.id || "" });
    if (overlap) {
      return { ...base, reason: "overlap", message: text("main.blueprint.overlap", "This area overlaps an existing foundation.") };
    }
    const cellsToValidate = addedCellCount(rect, editingFoundation);
    if (cellsToValidate === 0n) return { ...base, valid: true, message: validPreviewMessage(base) };
    if (!chunks?.getOpaqueColumnTopAtWorld || !chunks?.getBlockAtWorld) {
      return { ...base, reason: "world-unavailable", message: text("main.blueprint.worldLoading", "World data is still loading.") };
    }
    if (cellsToValidate > BigInt(SYNC_VALIDATION_CELL_LIMIT)) {
      const pending = {
        ...base,
        validating: true,
        reason: "validating",
        message: text("main.blueprint.validating", "Checking ground level and clearance..."),
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
    if (containsColumn(base.editingFoundation, x, z)) return null;
    const top = Math.trunc(chunks.getOpaqueColumnTopAtWorld(x, z));
    if (top !== groundY) {
      return {
        ...base,
        reason: "not-level",
        invalidCell: { x, y: top, z },
        message: text("main.blueprint.notLevel", "The entire foundation area must be level."),
      };
    }
    const groundBlock = chunks.getBlockAtWorld(x, groundY, z);
    if (!isBlockingBlock(groundBlock) || isFluidBlock(groundBlock)) {
      return {
        ...base,
        reason: "invalid-ground",
        invalidCell: { x, y: groundY, z },
        message: text("main.blueprint.solidGround", "The foundation requires solid, dry ground."),
      };
    }
    for (let y = groundY + 1; y <= groundY + CLEARANCE_BLOCKS; y += 1) {
      const blockId = chunks.getBlockAtWorld(x, y, z);
      if (blockId === blockAirId) continue;
      return {
        ...base,
        reason: "obstructed",
        invalidCell: { x, y, z },
        message: text("main.blueprint.clearArea", "Clear plants, rocks, and trees from the foundation area."),
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
    const blueprint = syncSelectedBlueprint();
    if (!isBlueprintModeActive?.()) return [];
    const selectedFoundation = foundationForBlueprint(blueprint);
    syncFoundationEditor(selectedFoundation);
    const [playerX, , playerZ] = getPlayerPosition();
    const result = (index?.listNear?.(playerX, playerZ, VISIBLE_FOUNDATION_RADIUS) ?? [])
      .filter((foundation) => !selectedFoundation || !preview || foundation.id !== selectedFoundation.id)
      .map((foundation) => ({
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
    if (blueprint && preview) {
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
    const blueprint = syncSelectedBlueprint();
    const foundation = foundationForBlueprint(blueprint);
    syncFoundationEditor(foundation);
    return {
      active: Boolean(blueprint),
      blueprint,
      blueprintId: blueprint?.blueprintId ?? "",
      blueprintOrdinal: blueprint?.blueprintOrdinal ?? 0,
      foundation,
      foundationBound: Boolean(foundation),
      width,
      depth,
      minSize: MIN_SIZE,
      maxSize: MAX_PROTOCOL_SIZE,
      anchored: Boolean(anchor),
      editing: Boolean(foundation),
      dimensionsDirty,
      submitting,
      preview,
      lastError,
      step: !blueprint ? 1 : foundation ? 5 : !anchor ? 2 : preview?.valid ? 4 : 3,
    };
  }

  function syncSelectedBlueprint() {
    const selected = getSelectedBlueprint?.();
    const slot = selected?.slot ?? selected;
    const blueprintId = normalizeBlueprintId(slot?.blueprintId);
    if (blueprintId === activeBlueprintId) return blueprintId ? { ...slot, blueprintId } : null;
    saveBlueprintDraft();
    activeBlueprintId = blueprintId;
    const draft = blueprintDrafts.get(blueprintId);
    width = draft?.width ?? DEFAULT_WIDTH;
    depth = draft?.depth ?? DEFAULT_DEPTH;
    hoverHit = null;
    anchor = null;
    preview = null;
    lastError = "";
    boundFoundationSignature = "";
    dimensionsDirty = false;
    cancelValidation();
    return blueprintId ? { ...slot, blueprintId } : null;
  }

  function saveBlueprintDraft() {
    if (!activeBlueprintId) return;
    blueprintDrafts.set(activeBlueprintId, { width, depth });
  }

  function syncFoundationEditor(foundation) {
    if (!foundation) {
      if (boundFoundationSignature) {
        boundFoundationSignature = "";
        dimensionsDirty = false;
        anchor = null;
        preview = null;
        cancelValidation();
      }
      return;
    }
    const signature = foundationGeometrySignature(foundation);
    if (signature === boundFoundationSignature) return;
    boundFoundationSignature = signature;
    width = clampInt(foundation.width, MIN_SIZE, MAX_PROTOCOL_SIZE);
    depth = clampInt(foundation.depth, MIN_SIZE, MAX_PROTOCOL_SIZE);
    dimensionsDirty = false;
    hoverHit = null;
    anchor = { hit: foundationHit(foundation), editing: true };
    cancelValidation();
    rebuildBoundPreview(foundation, { force: true });
  }

  function foundationForBlueprint(blueprint = null) {
    const selected = blueprint ?? selectedBlueprintWithoutSync();
    if (!selected?.blueprintId) return null;
    const wallet = String(getWalletAddress?.() || "");
    return (index?.list?.() ?? []).find((foundation) => (
      String(foundation.foundationId) === selected.blueprintId
      && foundation.status !== "removed"
      && (!wallet || foundation.owner === wallet)
    )) ?? null;
  }

  function selectedBlueprintWithoutSync() {
    if (!activeBlueprintId) return null;
    const selected = getSelectedBlueprint?.();
    const slot = selected?.slot ?? selected;
    return normalizeBlueprintId(slot?.blueprintId) === activeBlueprintId
      ? { ...slot, blueprintId: activeBlueprintId }
      : null;
  }

  function validPreviewMessage(base) {
    if (!base.editing) return text("main.blueprint.ready", "Flat area ready. Confirm to create the foundation.");
    return base.changed
      ? text("main.blueprint.resizeReady", "Foundation size ready. Save to update its protected area.")
      : text("main.blueprint.foundationSelected", "Foundation selected. Adjust its length or width to edit it.");
  }

  function text(key, fallback, params = {}) {
    const value = translate?.(key, fallback, params);
    return typeof value === "string" && value !== key
      ? value
      : fallback.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ""));
  }
}

function normalizeBlueprintId(value) {
  try {
    const normalized = BigInt(value ?? 0);
    return normalized > 0n && normalized <= 0xffffffffffffffffn ? normalized.toString() : "";
  } catch {
    return "";
  }
}

export function footprintForHit(hit, width, depth, playerPosition = [0, 0, 0]) {
  const worldX = Math.trunc(Number(hit?.worldX) || 0);
  const worldZ = Math.trunc(Number(hit?.worldZ) || 0);
  const safeWidth = clampInt(width, MIN_SIZE, MAX_PROTOCOL_SIZE);
  const safeDepth = clampInt(depth, MIN_SIZE, MAX_PROTOCOL_SIZE);
  const playerX = Number(playerPosition?.[0]) || 0;
  const playerZ = Number(playerPosition?.[2]) || 0;
  const xDirection = worldX + 0.5 >= playerX ? 1 : -1;
  const zDirection = worldZ + 0.5 >= playerZ ? 1 : -1;
  const minX = xDirection > 0 ? worldX : worldX - safeWidth + 1;
  const minZ = zDirection > 0 ? worldZ : worldZ - safeDepth + 1;
  return {
    minX,
    minZ,
    maxX: minX + safeWidth - 1,
    maxZ: minZ + safeDepth - 1,
    width: safeWidth,
    depth: safeDepth,
  };
}

function rectForFoundationSize(foundation, width, depth) {
  const safeWidth = clampInt(width, MIN_SIZE, MAX_PROTOCOL_SIZE);
  const safeDepth = clampInt(depth, MIN_SIZE, MAX_PROTOCOL_SIZE);
  const minX = Math.trunc(Number(foundation?.minX) || 0);
  const minZ = Math.trunc(Number(foundation?.minZ) || 0);
  return {
    minX,
    minZ,
    maxX: minX + safeWidth - 1,
    maxZ: minZ + safeDepth - 1,
    width: safeWidth,
    depth: safeDepth,
  };
}

function foundationHit(foundation) {
  return {
    hit: true,
    worldX: Math.trunc(Number(foundation?.minX) || 0),
    worldY: Math.trunc(Number(foundation?.surfaceY) || 0) - 1,
    worldZ: Math.trunc(Number(foundation?.minZ) || 0),
    faceX: 0,
    faceY: 1,
    faceZ: 0,
  };
}

function hitWithinFoundation(hit, foundation) {
  if (!hit?.hit || !foundation) return false;
  const x = Math.trunc(Number(hit.worldX));
  const z = Math.trunc(Number(hit.worldZ));
  return Number.isFinite(x) && Number.isFinite(z) && containsColumn(foundation, x, z);
}

function containsColumn(rect, x, z) {
  if (!rect) return false;
  const minX = Math.trunc(Number(rect.minX));
  const minZ = Math.trunc(Number(rect.minZ));
  const width = Math.trunc(Number(rect.width));
  const depth = Math.trunc(Number(rect.depth));
  return x >= minX && x < minX + width && z >= minZ && z < minZ + depth;
}

function addedCellCount(candidate, existing) {
  const candidateArea = BigInt(candidate.width) * BigInt(candidate.depth);
  if (!existing) return candidateArea;
  const existingMaxX = existing.minX + existing.width - 1;
  const existingMaxZ = existing.minZ + existing.depth - 1;
  const overlapWidth = Math.max(0, Math.min(candidate.maxX, existingMaxX) - Math.max(candidate.minX, existing.minX) + 1);
  const overlapDepth = Math.max(0, Math.min(candidate.maxZ, existingMaxZ) - Math.max(candidate.minZ, existing.minZ) + 1);
  return candidateArea - BigInt(overlapWidth) * BigInt(overlapDepth);
}

function foundationGeometrySignature(foundation) {
  return [
    foundation?.id,
    foundation?.minX,
    foundation?.minZ,
    foundation?.surfaceY,
    foundation?.width,
    foundation?.depth,
  ].join(":");
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
