import { loadPlayChainModule } from "./play-chain-adapter.js";
import { createPlayBuildingCache } from "./play-building-cache.js";
import { createStreamingWorkPool, mapStreaming, streamingContextKey } from "../src/chain/streamingWork.js";

const BUILDING_REFRESH_MS=60_000, BUILDING_RETRY_MS=5_000;
const ZERO_BUILDING_HASH="0".repeat(64);
const DEFAULT_VIEW_DISTANCE_CHUNKS=7, DEFAULT_PRELOAD_MARGIN_CHUNKS=2, DEFAULT_CHUNK_SIZE=16;

export function createPlayChainBuildingSync({
  cache=createPlayBuildingCache(), getWalletAddress=()=>"", getAuthorityContext=null,
  getFoundations=()=>[],getFoundationsNear=null,getFoundationVersion=null,
  getPlayerPosition=()=>[0,0,0],viewDistance=DEFAULT_VIEW_DISTANCE_CHUNKS,getViewDistance=()=>viewDistance,
  preloadMargin=DEFAULT_PRELOAD_MARGIN_CHUNKS,getPreloadMargin=()=>preloadMargin,chunkSize=DEFAULT_CHUNK_SIZE,
  refreshFoundations=async()=>({ok:false}),loadChainModule=loadPlayChainModule,applyBuildings=()=>{},
  onChanged=()=>{},onStatus=()=>{},translate=(_key,fallback)=>fallback,
  autoApply=true,clock=()=>performance.now(),maxQueuedBuildings=512,maxRequestsPerRound=128,
}={}) {
  const ready=new Map(), queued=new Map(), desired=new Map(), pending=new Map(), rounds=new Map();
  const disk=new Map(), diskPool=createStreamingWorkPool({concurrency:1,capacity:32});
  let diskActive=false,diskFailures=0,diskWrites=0,diskRetryAt=0,applicationScheduled=false,applicationVersion=0;
  let module=null,authorityKey=null,epoch=0,lastContextKey="",lastFoundationKey="",lastAppliedBuildingKey=null;
  let lastRefreshAt=0,retryAfterAt=0,refreshFailed=false,hasSuccessfulRefresh=false,publishPending=false;
  let desiredKey="", desiredList=[], cacheChecks=new WeakMap();

  function authorityContext(){return streamingContextKey([module?.getNicechunkDiscoveryContext?.()??"default",getAuthorityContext?.()??null,String(getWalletAddress()||"")]);}
  function ensureContext(){
    const key=authorityContext();if(key===authorityKey)return;
    const hadScene=lastAppliedBuildingKey!==null;
    authorityKey=key;epoch++;ready.clear();queued.clear();desired.clear();pending.clear();rounds.clear();disk.clear();
    cacheChecks=new WeakMap();desiredKey="";lastAppliedBuildingKey=null;lastRefreshAt=0;retryAfterAt=0;hasSuccessfulRefresh=false;publishPending=hadScene;
  }
  function reconcileDesired(){
    ensureContext();const context=currentContextKey();
    if(context===desiredKey)return;
    desiredKey=context;desiredList=foundationsForCurrentView();desired.clear();
    for(const foundation of desiredList)desired.set(foundationIdentity(foundation.owner,foundation.foundationId),{foundation,key:foundationRenderKey(foundation)});
    for(const [id,item]of ready)if(desired.get(id)?.key!==item.key){ready.delete(id);publishPending=true;}
    for(const [id,item]of queued)if(desired.get(id)?.key!==item.key)queued.delete(id);
    if(publishPending)scheduleApplication();
  }
  function scheduleApplication(){
    if(!autoApply||applicationScheduled)return;
    applicationScheduled=true;
    const schedule=globalThis.requestAnimationFrame||((callback)=>globalThis.setTimeout(callback,0));
    schedule(()=>{applicationScheduled=false;applyQueuedBuildings();if(queued.size||publishPending)scheduleApplication();});
  }
  function applyQueuedBuildings({deadline=Infinity,budgetMs=1,maxBuildings=2}={}){
    const start=performance.now(),end=Math.min(deadline,start+Math.max(0,Number(budgetMs)||0));
    if(start>=end)return {appliedBuildings:0,pending:queued.size,elapsedMs:performance.now()-start,buildings:ready.size};
    reconcileDesired();let applied=0;
    for(const [id,item]of queued){
      if(applied>=maxBuildings||performance.now()>=end)break;
      queued.delete(id);
      if(item.epoch!==epoch||desired.get(id)?.key!==item.key)continue;
      ready.set(id,item);publishPending=true;applied++;
    }
    if(publishPending&&performance.now()<end){
      const records=[...ready.values()].map(item=>item.building);
      const key=buildingsRenderKey(records,desiredList);
      publishPending=false;
      if(key!==lastAppliedBuildingKey){
        lastAppliedBuildingKey=key;
        applicationVersion++;
        try {Promise.resolve(applyBuildings(records)).catch(error=>{refreshFailed=true;retryAfterAt=clock()+BUILDING_RETRY_MS;onStatus(String(error?.message||error));});}
        catch(error){refreshFailed=true;retryAfterAt=clock()+BUILDING_RETRY_MS;onStatus(String(error?.message||error));}
        onChanged({foundations:desired.size,buildings:records.length,applied:true});
      }
    }
    return {appliedBuildings:applied,pending:queued.size,elapsedMs:performance.now()-start,buildings:ready.size};
  }
  function enqueueBuilding(building,foundation,requestEpoch){
    reconcileDesired();const id=foundationIdentity(foundation.owner,foundation.foundationId),key=foundationRenderKey(foundation);
    if(requestEpoch!==epoch||desired.get(id)?.key!==key||!buildingMatchesFoundation(building,foundation))return false;
    if(queued.size>=maxQueuedBuildings&&!queued.has(id))return false;
    queued.set(id,{building,foundation,key,epoch:requestEpoch});scheduleApplication();return true;
  }
  async function verifyCache(building,foundation){
    if(!building||typeof building!=="object"||!buildingMatchesFoundation(building,foundation))return false;
    const key=foundationRenderKey(foundation),cached=cacheChecks.get(building);
    if(cached?.key===key&&cached.code===building.code)return true;
    if(!await cachedBuildingMatchesFoundation(building,foundation))return false;
    cacheChecks.set(building,{key,code:building.code});return true;
  }
  function scheduleDisk(record,building){
    const id=foundationIdentity(record.owner,record.foundationId);
    if(disk.size>=128&&!disk.has(id))disk.delete(disk.keys().next().value);
    disk.set(id,{record,building,epoch,attempts:0});void pumpDisk();
  }
  async function pumpDisk(){
    if(diskActive||!disk.size||clock()<diskRetryAt)return;diskActive=true;
    const entries=[...disk].slice(0,8);for(const [id]of entries)disk.delete(id);
    const requestEpoch=epoch;
    try {
      await diskPool.run(async()=>{
        if(requestEpoch!==epoch)return;
        const values=entries.map(([,entry])=>entry).filter(entry=>entry.epoch===requestEpoch);
        if(typeof cache?.putVerifiedBuildings==="function")await cache.putVerifiedBuildings(values);
        else for(const entry of values)await cache?.putVerifiedBuilding?.(entry.record,entry.building);
        diskWrites+=values.length;
      });
    }catch{
      diskFailures++;diskRetryAt=clock()+1000;
      for(const [id,entry]of entries)if(entry.epoch===epoch&&entry.attempts<2&&!disk.has(id)&&disk.size<128)disk.set(id,{...entry,attempts:entry.attempts+1});
    }
    finally{diskActive=false;if(disk.size)globalThis.setTimeout(()=>void pumpDisk(),Math.max(0,diskRetryAt-clock()));}
  }
  function updateForFrame(now=clock()){
    reconcileDesired();if(now<retryAfterAt)return null;
    const missing=[...desired].some(([id,item])=>ready.get(id)?.key!==item.key&&!queued.has(id)&&!pending.has(`${epoch}:${item.key}`));
    if(!missing&&hasSuccessfulRefresh&&!refreshFailed&&desiredKey===lastContextKey&&now-lastRefreshAt<BUILDING_REFRESH_MS)return null;
    return refresh({quiet:true,now});
  }
  async function refresh({force=false,quiet=true,now=clock()}={}){
    reconcileDesired();if(!force&&now<retryAfterAt)return{ok:false,cached:true,retryAt:retryAfterAt,buildings:currentBuildings()};
    // Importing the SDK is independent of network hydration. Establish its
    // authority namespace before any cached payload is allowed into the scene.
    let moduleError=null;
    try{module=await loadChainModule();}catch(error){moduleError=error;}
    reconcileDesired();
    const initialContext=desiredKey;
    if(!force&&rounds.has(initialContext))return rounds.get(initialContext);
    const foundations=desiredList;
    if(!force&&hasSuccessfulRefresh&&!refreshFailed&&initialContext===lastContextKey&&now-lastRefreshAt<BUILDING_REFRESH_MS
      && foundations.every(f=>ready.has(foundationIdentity(f.owner,f.foundationId))||queued.has(foundationIdentity(f.owner,f.foundationId))))return{ok:true,cached:true,buildings:currentBuildings()};
    const requestEpoch=epoch,startClock=clock(),appliedBefore=applicationVersion;let failures=0,loaded=0;
    const needed=foundations.filter(f=>force||refreshFailed||ready.get(foundationIdentity(f.owner,f.foundationId))?.key!==foundationRenderKey(f))
      .filter(f=>!pending.has(`${requestEpoch}:${foundationRenderKey(f)}`)).slice(0,maxRequestsPerRound);
    const tokens=new Map();
    for(const foundation of needed){const key=`${requestEpoch}:${foundationRenderKey(foundation)}`;const token={};tokens.set(key,token);pending.set(key,token);}
    const work=(async()=>{
      const missing=[];
      await mapStreaming(needed,async(foundation)=>{
        try{
          const building=typeof cache?.getBuilding==="function"?await cache.getBuilding(foundation):(await cache?.getBuildings?.([foundation]))?.[0];
          if(await verifyCache(building,foundation))enqueueBuilding(building,foundation,requestEpoch);
          else missing.push(foundation);
        }catch{missing.push(foundation);}
      },4);
      if(missing.length){
        try{
          if(!module)throw moduleError||Error("Building chain module is unavailable.");
          // Loading the module may reveal an authority namespace not known at construction.
          const context=authorityContext();
          if(authorityKey!==context){ensureContext();reconcileDesired();return {ok:true,stale:true,buildings:currentBuildings()};}
          if(typeof module.loadBuildingsForFoundations!=="function")throw Error("Building PDA batch loader is unavailable.");
          const delivered=new Set();
          const accept=(building,foundation)=>{
            const descriptor=foundation||missing.find(f=>String(f.foundationId)===String(building?.foundationId)&&String(f.owner)===String(building?.owner));
            if(!descriptor||!buildingMatchesFoundation(building,descriptor)){failures++;return;}
            const id=foundationIdentity(building.owner,building.foundationId);
            if(delivered.has(id))return;delivered.add(id);
            if(enqueueBuilding(building,descriptor,requestEpoch)){loaded++;scheduleDisk(descriptor,building);}
          };
          const records=await module.loadBuildingsForFoundations(missing,{onBuilding:accept,onError:()=>{failures++;}});
          for(const building of records||[])accept(building);
        }catch(error){failures++;if(!quiet)onStatus(text("main.land.buildingSyncFailed","Building PDA sync failed: {reason}",{reason:String(error?.message||error)}));}
      }
      reconcileDesired();
      if(requestEpoch!==epoch)return {ok:true,stale:true,buildings:currentBuildings()};
      lastContextKey=initialContext;lastFoundationKey=foundationsRevisionKey(foundations);
      lastRefreshAt=now+Math.max(0,clock()-startClock);retryAfterAt=failures?lastRefreshAt+BUILDING_RETRY_MS:0;
      refreshFailed=failures>0;hasSuccessfulRefresh=true;
      if(autoApply)applyQueuedBuildings({budgetMs:2,maxBuildings:2});
      return{ok:!failures,partial:failures>0&&ready.size>0,stale:initialContext!==desiredKey,foundations,buildings:currentBuildings(),loaded,applied:applicationVersion!==appliedBefore};
    })().finally(()=>{
      for(const [key,token]of tokens)if(pending.get(key)===token)pending.delete(key);
      if(rounds.get(initialContext)===work)rounds.delete(initialContext);
    });
    rounds.set(initialContext,work);return work;
  }
  function currentBuildings(){return [...ready.values()].map(item=>item.building);}
  function foundationsForCurrentView(){const [x,,z]=getPlayerPosition?.()??[0,0,0],radius=syncRadiusBlocks();const candidates=getFoundationsNear?getFoundationsNear(finiteNumber(x),finiteNumber(z),radius):getFoundations();return verifiedBuildingFoundations(candidates).filter(f=>foundationIntersectsView(f,finiteNumber(x),finiteNumber(z),radius));}
  function currentContextKey(){const [x,,z]=getPlayerPosition?.()??[0,0,0];const version=getFoundationVersion?String(getFoundationVersion()??0):foundationsRevisionKey(getFoundations());return `${version}:${Math.floor(finiteNumber(x)/normalizedChunkSize())},${Math.floor(finiteNumber(z)/normalizedChunkSize())}:${normalizedViewDistance()}:${normalizedPreloadMargin()}`;}
  function syncRadiusBlocks(){return(normalizedViewDistance()+normalizedPreloadMargin()+1)*normalizedChunkSize();}
  function normalizedViewDistance(){return Math.max(1,Math.trunc(Number(getViewDistance?.())||DEFAULT_VIEW_DISTANCE_CHUNKS));}
  function normalizedPreloadMargin(){return Math.max(0,Math.trunc(Number(getPreloadMargin?.())||0));}
  function normalizedChunkSize(){return Math.max(1,Math.trunc(Number(chunkSize)||DEFAULT_CHUNK_SIZE));}
  function snapshot(){reconcileDesired();return{loading:rounds.size>0,lastRefreshAt,retryAfterAt,refreshFailed,foundationKey:lastFoundationKey,contextKey:lastContextKey,buildings:ready.size,pendingBuildings:queued.size,pendingReads:pending.size,authorityEpoch:epoch,diskQueued:disk.size,diskActive,diskWrites,diskFailures,mode:"on-chain-manifest-view-cache"};}
  function text(key,fallback,params={}){const value=translate?.(key,fallback,params);return typeof value==="string"&&value!==key?value:fallback.replace(/\{(\w+)\}/g,(_,name)=>String(params[name]??""));}
  return{refresh,create,updateForFrame,applyQueuedBuildings,snapshot};
  async function create(payload) {
    if (!getWalletAddress()) return { submitted: false, reason: "wallet-unavailable" };
    const foundation = (getFoundations() ?? []).find((candidate) => String(candidate?.foundationId) === String(payload?.foundationId));
    if (!foundation) return { submitted: false, reason: "foundation-not-found" };
    const module = await loadChainModule();
    if (typeof module.createBuildingOnChain !== "function") {
      return { submitted: false, reason: "building-chain-api-unavailable" };
    }
    const result = await module.createBuildingOnChain(payload);
    if (!result?.submitted) return result ?? { submitted: false, reason: "building-not-submitted" };
    const building = result.building ?? {};
    const revision = Math.max(1, Math.trunc(Number(building.revision) || 0));
    const contentHash = String(building.contentHash || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(contentHash)) {
      void refreshFoundations({ force: true, quiet: true });
      return {
        ...result,
        building,
        indexedOnChain: true,
        refreshPending: true,
        message: text("main.land.buildingHashPending", "Building confirmed on chain; waiting for its finalized manifest hash."),
      };
    }
    void refreshFoundations({ force: true, quiet: true });
    globalThis.setTimeout(async () => {
      await refreshFoundations({ force: true, quiet: true });
      await refresh({ force: true, quiet: true });
    }, 500);
    return { ...result, building: { ...building, revision, contentHash }, indexedOnChain: true };
  }

}

export function buildingMatchesFoundation(building, foundation) {
  const fullHash = String(building?.contentHash || "").trim().toLowerCase();
  const expectedHash = String(foundation?.contentHash || "").trim().toLowerCase();
  return String(building?.foundationId) === String(foundation?.foundationId)
    && String(building?.owner || "") === String(foundation?.owner || "")
    && (!foundation?.programId || String(building?.programId || "") === String(foundation.programId))
    && (!foundation?.globalConfig || String(building?.globalConfig || "") === String(foundation.globalConfig))
    && (!foundation?.buildingManifestPda || String(building?.manifestPda || "") === String(foundation.buildingManifestPda))
    && (foundation?.buildingQuarterTurns == null || Number(building?.quarterTurns ?? 0) === foundation.buildingQuarterTurns)
    && (foundation?.buildingOffsetX == null || Number(building?.offsetX ?? 0) === foundation.buildingOffsetX)
    && (foundation?.buildingOffsetZ == null || Number(building?.offsetZ ?? 0) === foundation.buildingOffsetZ)
    && Number(building?.revision) === Number(foundation?.activeRevision)
    && /^[0-9a-f]{64}$/.test(fullHash)
    && /^[0-9a-f]{64}$/.test(expectedHash)
    && expectedHash !== ZERO_BUILDING_HASH
    && fullHash === expectedHash;
}

export async function cachedBuildingMatchesFoundation(building, foundation) {
  if (!buildingMatchesFoundation(building, foundation)) return false;
  try {
    const payload = decodeNcm3Payload(building.code);
    return await sha256Hex(payload) === String(foundation.contentHash).toLowerCase();
  } catch {
    return false;
  }
}

function verifiedBuildingFoundations(foundations = []) {
  const unique = new Map();
  for (const foundation of foundations ?? []) {
    const revision = Math.max(0, Math.trunc(Number(foundation?.activeRevision) || 0));
    const hash = String(foundation?.contentHash || "").trim().toLowerCase();
    if (!foundation?.foundationId || !foundation?.owner || foundation.status && foundation.status!=="active" || foundation.hasActiveGeometry===false || !revision || !/^[0-9a-f]{64}$/.test(hash) || hash === ZERO_BUILDING_HASH) continue;
    unique.set(foundationIdentity(foundation.owner,foundation.foundationId), { ...foundation, activeRevision: revision, contentHash: hash });
  }
  return [...unique.values()];
}

function foundationsRevisionKey(foundations = []) {
  return verifiedBuildingFoundations(foundations)
    .map(foundationRenderKey)
    .sort()
    .join("|");
}

function buildingsRenderKey(buildings = [], foundations = []) {
  const foundationByKey = new Map(verifiedBuildingFoundations(foundations)
    .map((foundation) => [foundationIdentity(foundation.owner, foundation.foundationId), foundation]));
  return (buildings ?? []).map((building) => {
    const foundation = foundationByKey.get(foundationIdentity(building?.owner, building?.foundationId));
    return [
      foundation ? foundationRenderKey(foundation) : foundationIdentity(building?.owner, building?.foundationId),
      Math.max(0, Math.trunc(Number(building?.revision) || 0)),
      ((Math.trunc(Number(building?.quarterTurns) || 0) % 4) + 4) % 4,
      Math.max(-0x80000000, Math.min(0x7fffffff, Math.trunc(Number(building?.offsetX) || 0))),
      Math.max(-0x80000000, Math.min(0x7fffffff, Math.trunc(Number(building?.offsetZ) || 0))),
      String(building?.contentHash || "").trim().toLowerCase(),
    ].join(":");
  }).sort().join("|");
}

function foundationRenderKey(foundation) {
  return [
    foundationIdentity(foundation?.owner, foundation?.foundationId),
    String(foundation?.programId || ""),
    String(foundation?.globalConfig || ""),
    foundation?.buildingQuarterTurns ?? "",
    foundation?.buildingOffsetX ?? "",
    foundation?.buildingOffsetZ ?? "",
    String(foundation?.buildingManifestPda || ""),
    Math.trunc(Number(foundation?.minX) || 0),
    Math.trunc(Number(foundation?.minZ) || 0),
    Math.trunc(Number(foundation?.surfaceY) || 0),
    Math.max(0, Math.trunc(Number(foundation?.width) || 0)),
    Math.max(0, Math.trunc(Number(foundation?.depth) || 0)),
    Math.max(0, Math.trunc(Number(foundation?.activeRevision) || 0)),
    String(foundation?.contentHash || "").trim().toLowerCase(),
  ].join(":");
}

function foundationIdentity(owner, foundationId) {
  return `${String(owner || "")}:${String(foundationId ?? "0")}`;
}

function foundationIntersectsView(foundation, centerX, centerZ, radius) {
  const minX = finiteNumber(foundation?.minX);
  const minZ = finiteNumber(foundation?.minZ);
  const width = Math.max(1, Math.trunc(Number(foundation?.width) || 1));
  const depth = Math.max(1, Math.trunc(Number(foundation?.depth) || 1));
  const maxX = minX + width - 1;
  const maxZ = minZ + depth - 1;
  return minX <= centerX + radius
    && maxX >= centerX - radius
    && minZ <= centerZ + radius
    && maxZ >= centerZ - radius;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function decodeNcm3Payload(code) {
  const encoded = String(code || "").trim();
  if (!encoded.startsWith("NCM3:")) throw new Error("Invalid NCM3 code.");
  const value = encoded.slice(5).replace(/-/g, "+").replace(/_/g, "/");
  const padded = value + "=".repeat((4 - value.length % 4) % 4);
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  if (globalThis.Buffer) return Uint8Array.from(globalThis.Buffer.from(padded, "base64"));
  throw new Error("Base64 decoder is unavailable.");
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable.");
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
