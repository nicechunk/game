import {
  buildingChunkCollisionTopAt,
  buildingChunkHasCollisionAt,
  createBuildingMeshWorkerClient,
} from "../chunk.js/play.js";

const DEFAULT_CHAIN_MESH_CACHE_ENTRIES = 64;
const DEFAULT_CHAIN_MESH_CACHE_BYTES = 48 * 1024 * 1024;

export function createBuildingController({
  index,
  getWalletAddress = () => "",
  getPlayerPosition = () => [0, 0, 0],
  getSelectedBlueprint = () => null,
  submitBuilding = async () => ({ submitted: false, reason: "chain-unavailable" }),
  onChanged = () => {},
  onCollisionGeometryChanged = () => {},
  onStatus = () => {},
  translate = (_key, fallback) => fallback,
  chunkSize = 16,
  createMeshClient = createBuildingMeshWorkerClient,
  chainMeshCacheEntries = DEFAULT_CHAIN_MESH_CACHE_ENTRIES,
  chainMeshCacheBytes = DEFAULT_CHAIN_MESH_CACHE_BYTES,
} = {}) {
  let active = false;
  let mode = "foundation";
  let selectedFoundationId = "";
  let code = "";
  let quarterTurns = 0;
  let offsetX = 0;
  let offsetZ = 0;
  let parsed = null;
  let previewPlacement = null;
  let previewChunks = [];
  let chainBuildings = new Map();
  let submitting = false;
  let lastError = "";
  let revision = 1;
  let previewRequest = 0;
  let chainRequest = 0;
  let previewAbortController = null;
  let chainAbortController = null;
  let meshingPreview = false;
  let meshingChain = false;
  let activeBlueprintId = "";
  let activeBlueprint = null;
  let modeExplicit = false;
  const blueprintStates = new Map();
  const meshClient = createMeshClient();
  const chainMeshCache = new Map();
  const maxChainMeshCacheEntries = Math.max(0, Math.trunc(Number(chainMeshCacheEntries) || 0));
  const maxChainMeshCacheBytes = Math.max(0, Math.trunc(Number(chainMeshCacheBytes) || 0));
  let cachedChainMeshBytes = 0;
  let renderChunkList = [];
  let renderChunkIds = new Set();
  let renderChunksByColumn = new Map();
  let unindexedRenderChunks = [];
  let collisionChunksByColumn = new Map();
  let collisionGeometryKey = "";

  return {
    activate,
    mode: () => {
      syncSelectedBlueprint();
      enforceBlueprintStage();
      return mode;
    },
    setMode,
    foundations: ownedFoundations,
    selectedFoundation: currentFoundation,
    selectFoundation,
    selectAtHit,
    setCode,
    setQuarterTurns,
    setOffsets,
    rotate: (delta = 1) => setQuarterTurns(quarterTurns + Math.trunc(Number(delta) || 0)),
    preview: buildPreview,
    confirm,
    cancel,
    applyChainBuildings,
    renderChunks,
    renderChunksInRange,
    hasCollisionAtWorld,
    collisionTopAtWorld,
    liveChunkIds: () => new Set(renderChunkIds),
    snapshot,
  };

  function activate(nextActive = Boolean(selectedBlueprintFromGameState())) {
    const changedBlueprint = syncSelectedBlueprint();
    const next = Boolean(nextActive && activeBlueprintId);
    const previousMode = mode;
    const previousActive = active;
    active = next;
    if (active) enforceBlueprintStage();
    else if (previousActive) clearPreview();
    if (changedBlueprint || previousActive !== active || previousMode !== mode) onChanged(snapshot());
    return snapshot();
  }

  function setMode(nextMode) {
    syncSelectedBlueprint();
    const normalized = nextMode === "building" ? "building" : "foundation";
    const hasFoundation = Boolean(currentFoundation());
    if (normalized === "building" && !hasFoundation) {
      lastError = text("main.blueprint.noFoundation", "Create a foundation before importing a building.");
      onStatus(lastError);
      onChanged(snapshot());
      return snapshot();
    }
    if (mode === normalized) return snapshot();
    mode = normalized;
    modeExplicit = true;
    if (mode === "building") ensureFoundationSelection();
    else clearPreview();
    lastError = "";
    saveBlueprintState();
    onChanged(snapshot());
    return snapshot();
  }

  function ownedFoundations() {
    syncSelectedBlueprint();
    return foundationsForBlueprint(activeBlueprintId);
  }

  function foundationsForBlueprint(blueprintId) {
    if (!blueprintId) return [];
    const wallet = String(getWalletAddress() || "");
    if (!wallet) return [];
    return (index?.list?.() ?? [])
      .filter((foundation) => foundation.owner === wallet
        && foundation.status !== "removed"
        && String(foundation.foundationId) === blueprintId)
      .slice(0, 1);
  }

  function currentFoundation() {
    syncSelectedBlueprint();
    ensureFoundationSelection();
    return foundationsForBlueprint(activeBlueprintId).find((foundation) => foundation.id === selectedFoundationId) ?? null;
  }

  function ensureFoundationSelection() {
    const foundations = foundationsForBlueprint(activeBlueprintId);
    if (!foundations.some((foundation) => foundation.id === selectedFoundationId)) {
      selectedFoundationId = foundations[0]?.id ?? "";
      clearPreview();
    }
    return selectedFoundationId;
  }

  function selectFoundation(id) {
    syncSelectedBlueprint();
    const value = String(id || "");
    const foundation = foundationsForBlueprint(activeBlueprintId).find((candidate) => candidate.id === value);
    if (!foundation) {
      lastError = text("main.blueprint.noFoundation", "Create a foundation before importing a building.");
      onStatus(lastError);
      onChanged(snapshot());
      return { ok: false, reason: "foundation-not-found" };
    }
    if (selectedFoundationId !== foundation.id) {
      selectedFoundationId = foundation.id;
      clearPreview();
    }
    lastError = "";
    saveBlueprintState();
    onChanged(snapshot());
    return { ok: true, foundation };
  }

  function selectAtHit(hit) {
    syncSelectedBlueprint();
    if (mode !== "building" || !hit?.hit) return { ok: false, reason: "building-mode-inactive" };
    const wallet = String(getWalletAddress() || "");
    const foundation = (index?.foundationsAt?.(hit.worldX, hit.worldZ) ?? [])
      .find((candidate) => candidate.owner === wallet
        && candidate.status !== "removed"
        && String(candidate.foundationId) === activeBlueprintId);
    if (!foundation) return { ok: false, reason: "foundation-not-hit" };
    return selectFoundation(foundation.id);
  }

  function setCode(value) {
    syncSelectedBlueprint();
    const next = String(value ?? "").trim();
    if (next === code) return snapshot();
    code = next;
    parsed = null;
    clearPreview();
    lastError = "";
    saveBlueprintState();
    onChanged(snapshot());
    return snapshot();
  }

  function setQuarterTurns(value) {
    syncSelectedBlueprint();
    quarterTurns = ((Math.trunc(Number(value) || 0) % 4) + 4) % 4;
    saveBlueprintState();
    if (previewPlacement || parsed) void buildPreview();
    else onChanged(snapshot());
    return snapshot();
  }

  function setOffsets(xValue, zValue) {
    syncSelectedBlueprint();
    const nextX = normalizeBuildingOffset(xValue);
    const nextZ = normalizeBuildingOffset(zValue);
    if (nextX === offsetX && nextZ === offsetZ) return snapshot();
    offsetX = nextX;
    offsetZ = nextZ;
    saveBlueprintState();
    if (previewPlacement || parsed) void buildPreview();
    else onChanged(snapshot());
    return snapshot();
  }

  async function buildPreview() {
    syncSelectedBlueprint();
    const blueprintId = activeBlueprintId;
    const foundation = currentFoundation();
    if (!foundation) return fail("foundation-not-found", text("main.blueprint.noFoundation", "Create a foundation before importing a building."));
    if (!code) return fail("missing-code", text("main.blueprint.enterCode", "Paste an NCM3 building code first."));
    cancelPreviewMeshing();
    const abortController = new AbortController();
    previewAbortController = abortController;
    const request = ++previewRequest;
    meshingPreview = true;
    previewPlacement = null;
    previewChunks = [];
    rebuildRenderChunkCache();
    lastError = "";
    onChanged(snapshot());
    try {
      const result = await meshClient.build({
        code,
        foundation,
        quarterTurns,
        offsetX,
        offsetZ,
        placementId: `preview:${foundation.id}:${quarterTurns}:${offsetX}:${offsetZ}:${request}`,
        chunkSize,
        revision: ++revision,
        allowFoundationOverflow: true,
      }, {
        signal: abortController.signal,
        priority: Number.MAX_SAFE_INTEGER,
        scope: "preview",
      });
      if (request !== previewRequest || blueprintId !== activeBlueprintId) return { ok: false, reason: "stale-preview" };
      parsed = result.building;
      previewPlacement = {
        ...result.placement,
        fitsFoundation: result.placement?.fitsFoundation !== false,
      };
      previewChunks = (result.chunks ?? []).map((chunk) => ({
        ...chunk,
        buildingPreview: true,
        regionBatchEligible: false,
      }));
      rebuildRenderChunkCache();
      lastError = previewPlacement.fitsFoundation
        ? ""
        : text("main.blueprint.buildingDoesNotFit", "The building extends outside this foundation. Adjust X/Z or enlarge the foundation; the building will not be scaled.");
      saveBlueprintState();
      onStatus(lastError || text("main.blueprint.buildingReady", "NCM3 building fits this foundation at exact 1:1 scale."));
      onChanged(snapshot());
      return {
        ok: true,
        fitsFoundation: previewPlacement.fitsFoundation,
        building: parsed,
        placement: previewPlacement,
        chunks: previewChunks,
      };
    } catch (error) {
      if (error?.code === "building-mesh-aborted") return { ok: false, reason: "stale-preview" };
      if (request !== previewRequest || blueprintId !== activeBlueprintId) return { ok: false, reason: "stale-preview" };
      clearPreview();
      const message = error?.code === "building-does-not-fit"
        ? text("main.blueprint.buildingDoesNotFit", "The building extends outside this foundation. Adjust X/Z or enlarge the foundation; the building will not be scaled.")
        : text("main.blueprint.invalidCode", "The NCM3 building code is invalid: {reason}", { reason: String(error?.message || error) });
      return fail(error?.code || "invalid-code", message, error);
    } finally {
      if (previewAbortController === abortController) previewAbortController = null;
      if (request === previewRequest && blueprintId === activeBlueprintId) {
        meshingPreview = false;
        saveBlueprintState();
        onChanged(snapshot());
      }
    }
  }

  async function confirm() {
    syncSelectedBlueprint();
    if (mode !== "building") return { submitted: false, reason: "building-mode-inactive" };
    if (submitting) return { submitted: false, reason: "already-submitting" };
    const previewResult = previewPlacement ? { ok: true } : await buildPreview();
    if (!previewResult?.ok || !previewPlacement || !parsed) return { submitted: false, reason: previewResult?.reason || "invalid-building" };
    if (previewPlacement.fitsFoundation === false) {
      return fail(
        "building-does-not-fit",
        text("main.blueprint.buildingDoesNotFit", "The building extends outside this foundation. Adjust X/Z or enlarge the foundation; the building will not be scaled."),
      );
    }
    submitting = true;
    lastError = "";
    onChanged(snapshot());
    try {
      const foundation = previewPlacement.foundation;
      const result = await submitBuilding({
        owner: foundation.owner,
        foundationId: foundation.foundationId,
        foundation: foundation.id,
        quarterTurns,
        offsetX,
        offsetZ,
        code: parsed.canonicalCode,
      });
      if (!result?.submitted) return fail(
        result?.reason || "building-not-submitted",
        result?.message || text("main.blueprint.buildingSubmitFailed", "Building submission failed: {reason}", { reason: result?.reason || "unknown" }),
        result,
      );
      const record = result.building ?? {
        id: `${foundation.id}:building`,
        owner: foundation.owner,
        foundationId: foundation.foundationId,
        quarterTurns,
        offsetX,
        offsetZ,
        code: parsed.canonicalCode,
        signature: result.signature || "",
      };
      if (result.guardianIndexed !== false) {
        await applyChainBuildings([...chainBuildings.values()].map((entry) => entry.record).concat(record));
      }
      clearPreview();
      saveBlueprintState();
      onStatus(result.guardianIndexed === false
        ? result.message || text("main.blueprint.guardianIndexPending", "The building is on chain, but Guardian indexing is still pending: {reason}.", {
          reason: text("main.blueprint.guardianUnavailable", "Guardian unavailable"),
        })
        : text("main.blueprint.buildingCreated", "Building created on this foundation."));
      return result;
    } catch (error) {
      console.error("[NiceChunk Building Submission Failed]", error);
      return fail("building-submit-exception", text("main.blueprint.buildingSubmitFailed", "Building submission failed: {reason}", { reason: String(error?.message || error) }), error);
    } finally {
      submitting = false;
      onChanged(snapshot());
    }
  }

  function cancel() {
    syncSelectedBlueprint();
    clearPreview();
    lastError = "";
    saveBlueprintState();
    onChanged(snapshot());
  }

  async function applyChainBuildings(records = []) {
    chainAbortController?.abort();
    const abortController = new AbortController();
    chainAbortController = abortController;
    const request = ++chainRequest;
    const foundationByKey = new Map((index?.list?.() ?? [])
      .filter((foundation) => foundation.status !== "removed")
      .map((foundation) => [foundationKey(foundation.owner, foundation.foundationId), foundation]));
    const desired = new Map();
    for (const record of records ?? []) {
      const foundation = foundationByKey.get(foundationKey(record?.owner, record?.foundationId));
      if (!foundation || !record?.code) continue;
      desired.set(foundation.id, {
        record,
        foundation,
        fingerprint: chainBuildingFingerprint(record, foundation),
      });
    }

    const next = new Map();
    const pending = [];
    let reused = 0;
    let reusedChanged = false;
    for (const [foundationId, existing] of chainBuildings) {
      if (!desired.has(foundationId)) rememberChainMesh(existing);
    }
    for (const { record, foundation, fingerprint } of desired.values()) {
      const existing = chainBuildings.get(foundation.id);
      if (existing?.fingerprint === fingerprint) {
        next.set(foundation.id, {
          ...existing,
          record: { ...record, code: existing.building.canonicalCode },
          foundation,
        });
        reused += 1;
        continue;
      }
      const cached = takeChainMesh(fingerprint);
      if (cached) {
        next.set(foundation.id, {
          ...cached,
          record: { ...record, code: cached.building.canonicalCode },
          placement: cached.placement ? { ...cached.placement, foundation } : cached.placement,
          foundation,
          fingerprint,
        });
        reused += 1;
        reusedChanged = true;
        continue;
      }
      if (existing) next.set(foundation.id, existing);
      pending.push({ record, foundation, fingerprint });
    }
    const player = playerWorldXZ(getPlayerPosition());
    pending.sort((left, right) => distanceSquared(left.foundation, player.x, player.z)
      - distanceSquared(right.foundation, player.x, player.z));
    const removed = [...chainBuildings.keys()].filter((id) => !desired.has(id)).length;
    const changedBeforeMeshing = removed > 0 || reusedChanged || next.size !== chainBuildings.size;
    chainBuildings = next;
    if (!pending.length) {
      if (request !== chainRequest) return { count: chainBuildings.size, stale: true };
      if (chainAbortController === abortController) chainAbortController = null;
      if (changedBeforeMeshing) rebuildRenderChunkCache();
      meshingChain = false;
      if (changedBeforeMeshing) onChanged(snapshot());
      return { count: next.size, rebuilt: 0, reused, removed };
    }

    let renderCommitDirty = changedBeforeMeshing;
    let renderCommitQueued = false;
    const flushRenderCommit = () => {
      renderCommitQueued = false;
      if (!renderCommitDirty || request !== chainRequest) return;
      renderCommitDirty = false;
      rebuildRenderChunkCache();
      onChanged(snapshot());
    };
    const scheduleRenderCommit = () => {
      renderCommitDirty = true;
      if (renderCommitQueued) return;
      renderCommitQueued = true;
      scheduleNextRenderCommit(flushRenderCommit);
    };

    meshingChain = true;
    onChanged(snapshot());
    if (changedBeforeMeshing) scheduleRenderCommit();
    const jobs = pending.map(({ record, foundation, fingerprint }) => {
      const distance = distanceSquared(foundation, player.x, player.z);
      return meshClient.build({
        code: record.code,
        buildingId: record.id || `${foundation.id}:building`,
        foundation,
        quarterTurns: record.quarterTurns,
        offsetX: normalizeBuildingOffset(record.offsetX),
        offsetZ: normalizeBuildingOffset(record.offsetZ),
        placementId: record.id || `${foundation.id}:building`,
        chunkSize,
        revision: ++revision,
      }, {
        signal: abortController.signal,
        priority: -distance,
        scope: `chain:${request}`,
      }).then((result) => {
        if (request !== chainRequest) return { stale: true };
        try {
          const building = result.building;
          const placement = result.placement;
          const chunks = result.chunks;
          if (!building?.canonicalCode || !placement || !Array.isArray(chunks)) {
            throw new Error("Building mesh result is incomplete.");
          }
          next.set(foundation.id, {
            record: { ...record, code: building.canonicalCode },
            building,
            placement,
            chunks,
            foundation,
            fingerprint,
          });
          scheduleRenderCommit();
          return { ok: true };
        } catch (error) {
          next.delete(foundation.id);
          scheduleRenderCommit();
          console.warn("[NiceChunk Building Decode]", foundation.id, error);
          return { ok: false, error };
        }
      }, (error) => {
        if (request !== chainRequest) return { stale: true };
        next.delete(foundation.id);
        scheduleRenderCommit();
        if (error?.code !== "building-mesh-aborted") console.warn("[NiceChunk Building Decode]", error);
        return { ok: false, error };
      });
    });
    await Promise.all(jobs);
    if (request !== chainRequest) return { count: chainBuildings.size, stale: true };
    flushRenderCommit();
    if (chainAbortController === abortController) chainAbortController = null;
    meshingChain = false;
    onChanged(snapshot());
    return { count: next.size, rebuilt: jobs.length, reused, removed };
  }

  function renderChunks() {
    return renderChunkList;
  }

  function renderChunksInRange(centerChunkX, centerChunkZ, radiusChunks) {
    const centerX = Math.trunc(Number(centerChunkX) || 0);
    const centerZ = Math.trunc(Number(centerChunkZ) || 0);
    const radius = Math.max(0, Math.trunc(Number(radiusChunks) || 0));
    const result = [...unindexedRenderChunks];
    for (let chunkZ = centerZ - radius; chunkZ <= centerZ + radius; chunkZ += 1) {
      for (let chunkX = centerX - radius; chunkX <= centerX + radius; chunkX += 1) {
        const chunks = renderChunksByColumn.get(`${chunkX},${chunkZ}`);
        if (chunks) result.push(...chunks);
      }
    }
    return result;
  }

  function hasCollisionAtWorld(worldX, worldY, worldZ) {
    const x = Math.floor(Number(worldX));
    const y = Math.floor(Number(worldY));
    const z = Math.floor(Number(worldZ));
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !Number.isSafeInteger(z)) return false;
    const chunks = collisionChunksByColumn.get(Math.floor(x / chunkSize))?.get(Math.floor(z / chunkSize));
    if (!chunks) return false;
    for (const chunk of chunks) {
      if (buildingChunkHasCollisionAt(chunk, x, y, z)) return true;
    }
    return false;
  }

  function collisionTopAtWorld(worldX, worldZ, maxBlockY = Infinity) {
    const x = Math.floor(Number(worldX));
    const z = Math.floor(Number(worldZ));
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z)) return -Infinity;
    const chunks = collisionChunksByColumn.get(Math.floor(x / chunkSize))?.get(Math.floor(z / chunkSize));
    if (!chunks) return -Infinity;
    let top = -Infinity;
    for (const chunk of chunks) {
      top = Math.max(top, buildingChunkCollisionTopAt(chunk, x, z, maxBlockY));
    }
    return top;
  }

  function rebuildRenderChunkCache() {
    const result = [];
    for (const [foundationId, entry] of chainBuildings) {
      if (previewPlacement?.foundation?.id === foundationId) continue;
      result.push(...entry.chunks);
    }
    result.push(...previewChunks);
    const byColumn = new Map();
    const unindexed = [];
    const ids = new Set();
    for (const chunk of result) {
      if (chunk?.id != null) ids.add(chunk.id);
      const chunkX = Number(chunk?.chunkX);
      const chunkZ = Number(chunk?.chunkZ);
      if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ)) {
        unindexed.push(chunk);
        continue;
      }
      const key = `${chunkX},${chunkZ}`;
      const column = byColumn.get(key) ?? [];
      column.push(chunk);
      byColumn.set(key, column);
    }
    renderChunkList = result;
    renderChunkIds = ids;
    renderChunksByColumn = byColumn;
    unindexedRenderChunks = unindexed;
    const collisionByColumn = new Map();
    for (const entry of chainBuildings.values()) {
      for (const chunk of entry.chunks ?? []) {
        if (!(chunk?.collisionMask instanceof Uint32Array) || !(chunk.collisionBlockCount > 0)) continue;
        const chunkX = Number(chunk.chunkX);
        const chunkZ = Number(chunk.chunkZ);
        if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ)) continue;
        let chunksByZ = collisionByColumn.get(chunkX);
        if (!chunksByZ) {
          chunksByZ = new Map();
          collisionByColumn.set(chunkX, chunksByZ);
        }
        const column = chunksByZ.get(chunkZ) ?? [];
        column.push(chunk);
        chunksByZ.set(chunkZ, column);
      }
    }
    collisionChunksByColumn = collisionByColumn;
    const nextCollisionGeometryKey = [...chainBuildings]
      .flatMap(([foundationId, entry]) => (entry.chunks ?? [])
        .filter((chunk) => chunk?.collisionMask instanceof Uint32Array && chunk.collisionBlockCount > 0)
        .map((chunk) => `${foundationId}:${entry.fingerprint || ""}:${chunk.id || ""}:${chunk.collisionBlockCount}`))
      .sort()
      .join("|");
    if (nextCollisionGeometryKey !== collisionGeometryKey) {
      collisionGeometryKey = nextCollisionGeometryKey;
      onCollisionGeometryChanged({
        buildings: chainBuildings.size,
        collisionColumns: collisionByColumn.size,
      });
    }
  }

  function rememberChainMesh(entry) {
    const fingerprint = String(entry?.fingerprint || "");
    if (!fingerprint || !maxChainMeshCacheEntries || !maxChainMeshCacheBytes) return false;
    const bytes = chainMeshByteLength(entry);
    if (bytes > maxChainMeshCacheBytes) return false;
    const previous = chainMeshCache.get(fingerprint);
    if (previous) cachedChainMeshBytes -= previous.bytes;
    chainMeshCache.delete(fingerprint);
    chainMeshCache.set(fingerprint, { entry, bytes });
    cachedChainMeshBytes += bytes;
    while (chainMeshCache.size > maxChainMeshCacheEntries || cachedChainMeshBytes > maxChainMeshCacheBytes) {
      const oldestKey = chainMeshCache.keys().next().value;
      const oldest = chainMeshCache.get(oldestKey);
      cachedChainMeshBytes -= oldest?.bytes || 0;
      chainMeshCache.delete(oldestKey);
    }
    return chainMeshCache.has(fingerprint);
  }

  function takeChainMesh(fingerprint) {
    const key = String(fingerprint || "");
    const cached = chainMeshCache.get(key);
    if (!cached) return null;
    chainMeshCache.delete(key);
    cachedChainMeshBytes -= cached.bytes;
    return cached.entry;
  }

  function clearPreview() {
    cancelPreviewMeshing();
    const changed = Boolean(previewPlacement || previewChunks.length);
    previewRequest += 1;
    previewPlacement = null;
    previewChunks = [];
    meshingPreview = false;
    if (changed) rebuildRenderChunkCache();
  }

  function cancelPreviewMeshing() {
    previewAbortController?.abort();
    previewAbortController = null;
  }

  function snapshot() {
    syncSelectedBlueprint();
    enforceBlueprintStage();
    const foundations = foundationsForBlueprint(activeBlueprintId);
    const foundation = foundations.find((candidate) => candidate.id === selectedFoundationId) ?? foundations[0] ?? null;
    return {
      active: Boolean(active && activeBlueprintId),
      blueprint: activeBlueprint,
      blueprintId: activeBlueprintId,
      blueprintOrdinal: activeBlueprint?.blueprintOrdinal ?? 0,
      foundationBound: Boolean(foundation),
      mode,
      foundations,
      selectedFoundationId: foundation?.id ?? "",
      selectedFoundation: foundation,
      code,
      quarterTurns,
      offsetX,
      offsetZ,
      parsed,
      preview: previewPlacement,
      meshing: meshingPreview || meshingChain,
      meshingPreview,
      meshingChain,
      submitting,
      lastError,
      buildingCount: chainBuildings.size,
      cachedBuildingCount: chainMeshCache.size,
      cachedBuildingBytes: cachedChainMeshBytes,
      canBuild: Boolean(foundation && code && !submitting && previewPlacement?.fitsFoundation !== false),
    };
  }

  function fail(reason, message, error = null) {
    lastError = String(message || reason);
    saveBlueprintState();
    onStatus(lastError);
    onChanged(snapshot());
    return { ok: false, submitted: false, reason, message: lastError, error };
  }

  function text(key, fallback, params = {}) {
    const value = translate?.(key, fallback, params);
    return typeof value === "string" && value !== key
      ? value
      : fallback.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ""));
  }

  function syncSelectedBlueprint() {
    const selected = selectedBlueprintFromGameState();
    const nextId = selected?.blueprintId ?? "";
    if (nextId === activeBlueprintId) {
      activeBlueprint = selected;
      return false;
    }
    saveBlueprintState();
    cancelPreviewMeshing();
    previewRequest += 1;
    activeBlueprintId = nextId;
    activeBlueprint = selected;
    selectedFoundationId = "";
    const stored = blueprintStates.get(nextId);
    mode = stored?.mode === "building" || stored?.mode === "foundation" ? stored.mode : "foundation";
    modeExplicit = Boolean(stored?.mode);
    code = stored?.code ?? "";
    quarterTurns = stored?.quarterTurns ?? 0;
    offsetX = normalizeBuildingOffset(stored?.offsetX);
    offsetZ = normalizeBuildingOffset(stored?.offsetZ);
    parsed = stored?.parsed ?? null;
    previewPlacement = stored?.previewPlacement ?? null;
    previewChunks = stored?.previewChunks ?? [];
    rebuildRenderChunkCache();
    lastError = stored?.lastError ?? "";
    meshingPreview = false;
    enforceBlueprintStage();
    return true;
  }

  function selectedBlueprintFromGameState() {
    const selected = getSelectedBlueprint?.();
    const slot = selected?.slot ?? selected;
    const blueprintId = normalizeBlueprintId(slot?.blueprintId);
    return blueprintId ? { ...slot, blueprintId } : null;
  }

  function saveBlueprintState() {
    if (!activeBlueprintId) return;
    blueprintStates.set(activeBlueprintId, {
      mode,
      code,
      quarterTurns,
      offsetX,
      offsetZ,
      parsed,
      previewPlacement,
      previewChunks,
      lastError,
    });
  }

  function enforceBlueprintStage() {
    if (!activeBlueprintId) {
      mode = "foundation";
      modeExplicit = false;
      selectedFoundationId = "";
      return;
    }
    const foundation = foundationsForBlueprint(activeBlueprintId)[0] ?? null;
    selectedFoundationId = foundation?.id ?? "";
    const requiredMode = foundation && !modeExplicit ? "building" : foundation ? mode : "foundation";
    if (mode === requiredMode) return;
    mode = requiredMode;
    clearPreview();
    lastError = "";
    saveBlueprintState();
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

function foundationKey(owner, foundationId) {
  return `${String(owner || "")}:${String(foundationId ?? "0")}`;
}

function chainBuildingFingerprint(record, foundation) {
  const contentHash = String(record?.contentHash || "").trim().toLowerCase();
  const contentIdentity = /^[0-9a-f]{64}$/.test(contentHash)
    ? contentHash
    : String(record?.code || "");
  return JSON.stringify([
    foundationKey(record?.owner, record?.foundationId),
    Math.max(0, Math.trunc(Number(record?.revision) || 0)),
    ((Math.trunc(Number(record?.quarterTurns) || 0) % 4) + 4) % 4,
    normalizeBuildingOffset(record?.offsetX),
    normalizeBuildingOffset(record?.offsetZ),
    contentIdentity,
    Math.trunc(Number(foundation?.minX) || 0),
    Math.trunc(Number(foundation?.minZ) || 0),
    Math.trunc(Number(foundation?.surfaceY) || 0),
    Math.max(0, Math.trunc(Number(foundation?.width) || 0)),
    Math.max(0, Math.trunc(Number(foundation?.depth) || 0)),
  ]);
}

function normalizeBuildingOffset(value) {
  const number = Math.trunc(Number(value) || 0);
  return Math.max(-0x80000000, Math.min(0x7fffffff, number));
}

function distanceSquared(foundation, xValue, zValue) {
  const x = Number(xValue) || 0;
  const z = Number(zValue) || 0;
  const centerX = foundation.minX + foundation.width * 0.5;
  const centerZ = foundation.minZ + foundation.depth * 0.5;
  return (centerX - x) ** 2 + (centerZ - z) ** 2;
}

function scheduleNextRenderCommit(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(callback);
    return;
  }
  queueMicrotask(callback);
}

function playerWorldXZ(value) {
  const x = Number(value?.x ?? value?.[0]);
  const z = Number(value?.z ?? value?.[2]);
  return {
    x: Number.isFinite(x) ? x : 0,
    z: Number.isFinite(z) ? z : 0,
  };
}

function chainMeshByteLength(entry) {
  let bytes = 0;
  for (const chunk of entry?.chunks ?? []) {
    bytes += chunk?.collisionMask?.byteLength || 0;
    for (const mesh of [chunk?.mesh, chunk?.visualMesh]) {
      bytes += mesh?.vertices?.byteLength || 0;
      bytes += mesh?.indices?.byteLength || 0;
    }
  }
  return bytes;
}

function numericFoundationId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 0;
}
