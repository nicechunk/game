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
  getEquippedFoundationId = null,
  getPlayerPosition = () => [0, 0, 0],
  isConstructionModeActive = () => false,
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
  const chainJobs = new Map();
  let chainDesired = new Map();
  let chainRenderDirty=false,chainRenderQueued=false,renderGeometryRevision=0;
  let rangeCache=null,ownedCache=null;
  let meshingPreview = false;
  let meshingChain = false;
  let modeExplicit = false;
  let activationRevision = 0;
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
  let miningEntryByChunk = new WeakMap();

  return {
    activate,
    mode: () => {
      enforceConstructionStage();
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
    getMiningTargetAtWorld,
    applyConfirmedDemolition,
    liveChunkIds: () => new Set(renderChunkIds),
    snapshot,
  };

  function activate(nextActive = Boolean(isConstructionModeActive())) {
    const next = Boolean(nextActive && isConstructionModeActive());
    const previousMode = mode;
    const previousActive = active;
    active = next;
    if (previousActive !== active) activationRevision += 1;
    if (active) enforceConstructionStage();
    else if (previousActive) clearPreview();
    if (previousActive !== active || previousMode !== mode) onChanged(snapshot());
    return snapshot();
  }

  function setMode(nextMode) {
    const normalized = nextMode === "building" ? "building" : "foundation";
    if (normalized === "foundation" && typeof getEquippedFoundationId === "function" && getEquippedFoundationId()) return snapshot();
    const hasFoundation = Boolean(currentFoundation());
    if (normalized === "building" && !hasFoundation) {
      lastError = text("main.land.noFoundation", "Create a foundation before importing a building.");
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
    onChanged(snapshot());
    return snapshot();
  }

  function ownedFoundations() {
    const wallet = String(getWalletAddress() || "");
    if (!wallet) return [];
    const version=typeof index?.version==="function"?index.version():null;
    const equippedId = typeof getEquippedFoundationId === "function" ? String(getEquippedFoundationId() || "") : null;
    if(version!==null&&ownedCache?.wallet===wallet&&ownedCache.version===version&&ownedCache.equippedId===equippedId)return ownedCache.records;
    const records=(index?.list?.()??[]).filter(foundation=>foundation.owner===wallet&&foundation.status!=="removed"
      && (equippedId === null || foundation.status === "active" && String(foundation.foundationId) === equippedId));
    if(version!==null)ownedCache={wallet,version,equippedId,records};
    return records;
  }

  function currentFoundation() {
    ensureFoundationSelection();
    return ownedFoundations().find((foundation) => foundation.id === selectedFoundationId) ?? null;
  }

  function ensureFoundationSelection() {
    const foundations = ownedFoundations();
    if (!foundations.some((foundation) => foundation.id === selectedFoundationId)) {
      selectedFoundationId = foundations[0]?.id ?? "";
      clearPreview();
    }
    return selectedFoundationId;
  }

  function selectFoundation(id) {
    const value = String(id || "");
    const foundation = ownedFoundations().find((candidate) => candidate.id === value);
    if (!foundation) {
      lastError = text("main.land.noFoundation", "Create a foundation before importing a building.");
      onStatus(lastError);
      onChanged(snapshot());
      return { ok: false, reason: "foundation-not-found" };
    }
    if (selectedFoundationId !== foundation.id) {
      selectedFoundationId = foundation.id;
      clearPreview();
    }
    lastError = "";
    onChanged(snapshot());
    return { ok: true, foundation };
  }

  function selectAtHit(hit) {
    if (!active || mode !== "building" || !hit?.hit) return { ok: false, reason: "building-mode-inactive" };
    const wallet = String(getWalletAddress() || "");
    const foundation = (index?.foundationsAt?.(hit.worldX, hit.worldZ) ?? [])
      .find((candidate) => candidate.owner === wallet
        && candidate.status !== "removed");
    if (!foundation) return { ok: false, reason: "foundation-not-hit" };
    return selectFoundation(foundation.id);
  }

  function setCode(value) {
    const next = String(value ?? "").trim();
    if (next === code) return snapshot();
    code = next;
    parsed = null;
    clearPreview();
    lastError = "";
    onChanged(snapshot());
    return snapshot();
  }

  function setQuarterTurns(value) {
    quarterTurns = ((Math.trunc(Number(value) || 0) % 4) + 4) % 4;
    if (previewPlacement || parsed) void buildPreview();
    else onChanged(snapshot());
    return snapshot();
  }

  function setOffsets(xValue, zValue) {
    const nextX = normalizeBuildingOffset(xValue);
    const nextZ = normalizeBuildingOffset(zValue);
    if (nextX === offsetX && nextZ === offsetZ) return snapshot();
    offsetX = nextX;
    offsetZ = nextZ;
    if (previewPlacement || parsed) void buildPreview();
    else onChanged(snapshot());
    return snapshot();
  }

  async function buildPreview() {
    if (!active) return fail("construction-mode-inactive", text("main.land.modeClosed", "Land construction mode is closed."));
    const activation = activationRevision;
    const foundation = currentFoundation();
    if (!foundation) return fail("foundation-not-found", text("main.land.noFoundation", "Create a foundation before importing a building."));
    if (!code) return fail("missing-code", text("main.land.enterCode", "Paste an NCM3 building code first."));
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
      if (request !== previewRequest || activation !== activationRevision) return { ok: false, reason: "stale-preview" };
      parsed = result.building;
      previewPlacement = {
        ...result.placement,
        // Mesh results contain geometry only. Keep the selected on-chain land
        // record as the source of its owner and foundation identifier.
        foundation,
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
        : text("main.land.buildingDoesNotFit", "The building extends outside this foundation. Adjust X/Z or enlarge the foundation; the building will not be scaled.");
      onStatus(lastError || text("main.land.buildingReady", "NCM3 building fits this foundation at exact 1:1 scale."));
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
      if (request !== previewRequest || activation !== activationRevision) return { ok: false, reason: "stale-preview" };
      clearPreview();
      const message = error?.code === "building-does-not-fit"
        ? text("main.land.buildingDoesNotFit", "The building extends outside this foundation. Adjust X/Z or enlarge the foundation; the building will not be scaled.")
        : text("main.land.invalidCode", "The NCM3 building code is invalid: {reason}", { reason: String(error?.message || error) });
      return fail(error?.code || "invalid-code", message, error);
    } finally {
      if (previewAbortController === abortController) previewAbortController = null;
      if (request === previewRequest && activation === activationRevision) {
        meshingPreview = false;
        onChanged(snapshot());
      }
    }
  }

  async function confirm() {
    if (!active || mode !== "building") return { submitted: false, reason: "building-mode-inactive" };
    if (submitting) return { submitted: false, reason: "already-submitting" };
    const previewResult = previewPlacement ? { ok: true } : await buildPreview();
    if (!previewResult?.ok || !previewPlacement || !parsed) return { submitted: false, reason: previewResult?.reason || "invalid-building" };
    if (previewPlacement.fitsFoundation === false) {
      return fail(
        "building-does-not-fit",
        text("main.land.buildingDoesNotFit", "The building extends outside this foundation. Adjust X/Z or enlarge the foundation; the building will not be scaled."),
      );
    }
    const foundation = currentFoundation();
    if (!foundation || foundation.id !== previewPlacement.foundation?.id) {
      return fail("foundation-not-found", text("main.land.noFoundation", "Create a foundation before importing a building."));
    }
    submitting = true;
    lastError = "";
    onChanged(snapshot());
    try {
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
        result?.message || text("main.land.buildingSubmitFailed", "Building submission failed: {reason}", { reason: result?.reason || "unknown" }),
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
      await applyChainBuildings([...chainBuildings.values()].map((entry) => entry.record).concat(record));
      clearPreview();
      onStatus(result.message || text("main.land.buildingCreated", "Building created on this foundation."));
      return result;
    } catch (error) {
      console.error("[NiceChunk Building Submission Failed]", error);
      return fail("building-submit-exception", text("main.land.buildingSubmitFailed", "Building submission failed: {reason}", { reason: String(error?.message || error) }), error);
    } finally {
      submitting = false;
      onChanged(snapshot());
    }
  }

  function cancel() {
    clearPreview();
    lastError = "";
    onChanged(snapshot());
  }

  async function applyChainBuildings(records = []) {
    const request=++chainRequest;
    const foundationByKey=new Map((index?.list?.()??[]).filter(f=>(!f.status||f.status==="active")&&f.hasActiveGeometry!==false).map(f=>[foundationKey(f.owner,f.foundationId),f]));
    const desired=new Map();
    for(const suppliedRecord of records??[]){
      let record = suppliedRecord;
      const foundation=foundationByKey.get(foundationKey(record?.owner,record?.foundationId));
      if(!foundation||!record?.code)continue;
      const current = chainBuildings.get(foundation.id)?.record;
      if (current && current.revision === record.revision && current.hasDamage && (record.hasDamage !== true
          || BigInt(record.updatedSlot ?? 0) < BigInt(current.updatedSlot ?? 0)
          || String(record.updatedSlot) === String(current.updatedSlot)
            && ((Number(record.damageVersion ?? 0) - Number(current.damageVersion ?? 0) + 65536) % 65536) > 32768)) record = current;
      desired.set(foundation.id,{record,foundation,fingerprint:chainBuildingFingerprint(record,foundation)});
    }
    chainDesired=desired;
    for(const [id,job]of chainJobs)if(desired.get(id)?.fingerprint!==job.fingerprint){job.controller.abort();chainJobs.delete(id);}
    let removed=0,reused=0,changed=false;
    for(const [id,entry]of chainBuildings)if(!desired.has(id)){rememberChainMesh(entry);chainBuildings.delete(id);removed++;changed=true;}
    const work=[];
    for(const {record,foundation,fingerprint}of desired.values()){
      const existing=chainBuildings.get(foundation.id);
      if(existing?.fingerprint===fingerprint){
        chainBuildings.set(foundation.id,{...existing,record:{...record,code:existing.building.canonicalCode},foundation});reused++;continue;
      }
      if(existing){chainBuildings.delete(foundation.id);changed=true;}
      const cached=takeChainMesh(fingerprint);
      if(cached){chainBuildings.set(foundation.id,{...cached,record:{...record,code:cached.building.canonicalCode},foundation,placement:cached.placement?{...cached.placement,foundation}:cached.placement});reused++;changed=true;continue;}
      const pending=chainJobs.get(foundation.id);
      if(pending?.fingerprint===fingerprint){work.push({shared:pending});continue;}
      work.push({record,foundation,fingerprint});
    }
    if(changed)markChainRenderChanged(true);
    const player=playerWorldXZ(getPlayerPosition());
    work.sort((a,b)=>distanceSquared(a.foundation||a.shared.foundation,player.x,player.z)-distanceSquared(b.foundation||b.shared.foundation,player.x,player.z));
    let rebuilt=0;
    const jobs=work.map(item=>{
      if(item.shared)return item.shared.promise;
      const {record,foundation,fingerprint}=item,controller=new AbortController();
      const job={controller,fingerprint,foundation,promise:null};chainJobs.set(foundation.id,job);rebuilt++;
      const isCurrent=()=>chainJobs.get(foundation.id)===job&&chainDesired.get(foundation.id)?.fingerprint===fingerprint;
      let task;
      try{task=meshClient.build({code:record.code,buildingId:record.id||`${foundation.id}:building`,foundation,
        quarterTurns:record.quarterTurns,offsetX:normalizeBuildingOffset(record.offsetX),offsetZ:normalizeBuildingOffset(record.offsetZ),damageSections:record.damageSections,
        placementId:record.id||`${foundation.id}:building`,chunkSize,revision:++revision},
        {signal:controller.signal,priority:-distanceSquared(foundation,player.x,player.z),scope:`chain:${foundation.id}:${fingerprint}`});}
      catch(error){task=Promise.reject(error);}
      job.promise=Promise.resolve(task).then(result=>{
        if(!isCurrent())return {stale:true};
        if(!result.building?.canonicalCode||!result.placement||!Array.isArray(result.chunks))throw Error("Building mesh result is incomplete.");
        chainBuildings.set(foundation.id,{record:{...record,code:result.building.canonicalCode},building:result.building,placement:result.placement,chunks:result.chunks,foundation,fingerprint});
        markChainRenderChanged();return {ok:true};
      }).catch(error=>{
        if(!isCurrent())return {stale:true};
        chainBuildings.delete(foundation.id);markChainRenderChanged();
        if(error?.code!=="building-mesh-aborted")console.warn("[NiceChunk Building Decode]",foundation.id,error);
        return {ok:false,error};
      }).finally(()=>{if(chainJobs.get(foundation.id)===job)chainJobs.delete(foundation.id);meshingChain=chainJobs.size>0;});
      return job.promise;
    });
    meshingChain=chainJobs.size>0;
    if(jobs.length)onChanged(snapshot());
    await Promise.all(jobs);
    flushChainRenderChanges();meshingChain=chainJobs.size>0;
    if([...desired].some(([id,item])=>chainDesired.get(id)?.fingerprint!==item.fingerprint))return {count:chainBuildings.size,stale:true};
    if(jobs.length)onChanged(snapshot());
    return {count:chainBuildings.size,rebuilt,reused,removed};
  }
  function markChainRenderChanged(immediate=false){
    chainRenderDirty=true;
    if(immediate){flushChainRenderChanges();return;}
    if(chainRenderQueued)return;chainRenderQueued=true;scheduleNextRenderCommit(flushChainRenderChanges);
  }
  function flushChainRenderChanges(){
    chainRenderQueued=false;if(!chainRenderDirty)return;chainRenderDirty=false;rebuildRenderChunkCache();onChanged(snapshot());
  }

  function renderChunks() {
    return renderChunkList;
  }

  function renderChunksInRange(centerChunkX, centerChunkZ, radiusChunks) {
    const centerX = Math.trunc(Number(centerChunkX) || 0);
    const centerZ = Math.trunc(Number(centerChunkZ) || 0);
    const radius = Math.max(0, Math.trunc(Number(radiusChunks) || 0));
    const key=`${centerX},${centerZ}:${radius}:${renderGeometryRevision}`;
    if(rangeCache?.key===key)return rangeCache.chunks;
    const result = [...unindexedRenderChunks];
    for (let chunkZ = centerZ - radius; chunkZ <= centerZ + radius; chunkZ += 1) {
      for (let chunkX = centerX - radius; chunkX <= centerX + radius; chunkX += 1) {
        const chunks = renderChunksByColumn.get(`${chunkX},${chunkZ}`);
        if (chunks) result.push(...chunks);
      }
    }
    rangeCache={key,chunks:result};
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

  function getMiningTargetAtWorld(worldX, worldY, worldZ) {
    const x = Math.floor(worldX), y = Math.floor(worldY), z = Math.floor(worldZ);
    if (![x, y, z].every(Number.isSafeInteger)) return null;
    const column = renderChunksByColumn.get(`${Math.floor(x / chunkSize)},${Math.floor(z / chunkSize)}`) ?? [];
    for (const chunk of column) {
      const entry = miningEntryByChunk.get(chunk);
      if (!entry || !chunk.materialVoxels || y < chunk.minY || y >= chunk.minY + chunk.height) continue;
      const cx = x - chunk.chunkX * chunkSize, cz = z - chunk.chunkZ * chunkSize;
      const material = chunk.materialVoxels[((y - chunk.minY) * chunkSize + cz) * chunkSize + cx];
      if (!material) continue;
      const rx = x - entry.placement.origin.x, rz = z - entry.placement.origin.z;
      const turn = entry.placement.quarterTurns, size = entry.building.size;
      const localX = turn === 1 ? rz : turn === 2 ? size.x - 1 - rx : turn === 3 ? size.x - 1 - rz : rx;
      const localZ = turn === 1 ? size.z - 1 - rx : turn === 2 ? size.z - 1 - rz : turn === 3 ? rx : rz;
      return { blockId: material, materialId: material, resourceId: 0,
        buildingTarget: { owner: entry.record.owner, foundationId: String(entry.record.foundationId),
          revision: entry.record.revision, x: localX, y: y - entry.placement.origin.y, z: localZ } };
    }
    return null;
  }

  async function applyConfirmedDemolition(pending) {
    const record = pending?.chainResult?.building;
    if (!record) return;
    const records = [...chainBuildings.values()].map(entry => entry.record);
    const key = foundationKey(record.owner, record.foundationId);
    const existing = records.findIndex(candidate => foundationKey(candidate.owner, candidate.foundationId) === key);
    if (existing < 0 || records[existing].revision !== record.revision) return;
    records[existing] = record;
    await applyChainBuildings(records);
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
    renderGeometryRevision++;rangeCache=null;
    const result = [];
    miningEntryByChunk = new WeakMap();
    for (const [foundationId, entry] of chainBuildings) {
      for (const chunk of entry.chunks) miningEntryByChunk.set(chunk, entry);
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
    enforceConstructionStage();
    const foundations = ownedFoundations();
    const foundation = foundations.find((candidate) => candidate.id === selectedFoundationId) ?? foundations[0] ?? null;
    return {
      active,
      foundationBound: Boolean(foundation),
      registrationAllowed: typeof getEquippedFoundationId !== "function" || !getEquippedFoundationId(),
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

  function enforceConstructionStage() {
    if (!active) {
      mode = "foundation";
      modeExplicit = false;
      selectedFoundationId = "";
      return;
    }
    const foundations = ownedFoundations();
    const foundation = foundations.find((entry) => entry.id === selectedFoundationId) ?? foundations[0] ?? null;
    selectedFoundationId = foundation?.id ?? "";
    const boundDeed = typeof getEquippedFoundationId === "function" && getEquippedFoundationId();
    const requiredMode = foundation && (boundDeed || !modeExplicit) ? "building" : foundation ? mode : "foundation";
    if (mode === requiredMode) return;
    mode = requiredMode;
    clearPreview();
    lastError = "";
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
    String(foundation?.programId || ""), String(record?.programId || ""),
    Math.max(0, Math.trunc(Number(record?.revision) || 0)),
    ((Math.trunc(Number(record?.quarterTurns) || 0) % 4) + 4) % 4,
    normalizeBuildingOffset(record?.offsetX),
    normalizeBuildingOffset(record?.offsetZ),
    contentIdentity,
    record?.hasDamage === true, record?.damageVersion ?? 0, String(record?.updatedSlot ?? "0"),
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
    bytes += chunk?.materialVoxels?.byteLength || 0;
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
