import { loadPlayChainModule } from "./play-chain-adapter.js";
import { createStreamingWorkPool, streamingContextKey, foundationCoversChunk } from "../src/chain/streamingWork.js";

const FOUNDATION_REFRESH_MS = 60_000;
const FOUNDATION_RETRY_MS = 5_000;
const PENDING_FOUNDATION_MS = 30_000;
const DEFAULT_VIEW_DISTANCE_CHUNKS = 7;
const DEFAULT_PRELOAD_MARGIN_CHUNKS = 2;
const DEFAULT_CHUNK_SIZE = 16;

export function createPlayChainFoundationSync({
  index, getWalletAddress = () => "", getPlayerPosition = () => [0, 0, 0],
  loadChainModule = loadPlayChainModule, getAuthorityContext = null,
  viewDistance = DEFAULT_VIEW_DISTANCE_CHUNKS, getViewDistance = () => viewDistance,
  preloadMargin = DEFAULT_PRELOAD_MARGIN_CHUNKS, getPreloadMargin = () => preloadMargin,
  chunkSize = DEFAULT_CHUNK_SIZE, batchSize = 100, concurrency = 3,
  freshnessMs = FOUNDATION_REFRESH_MS, negativeFreshnessMs = 15_000,
  ownedFreshnessMs = FOUNDATION_REFRESH_MS, maxCachedCoordinates = 8192,
  clock = () => performance.now(), onChanged = () => {}, onStatus = () => {},
  translate = (_key, fallback) => fallback,
} = {}) {
  const nearbyFoundations = new Map(), ownedFoundations = new Map(), pendingFoundations = new Map();
  const observations = new Map(), coordinateRetries = new Map(), inFlight = new Map(), rounds = new Map();
  const pool = createStreamingWorkPool({ concurrency, capacity: 64 });
  const querySize = Math.max(1, Math.min(1024, Math.trunc(batchSize) || 100));
  let module = null, authorityKey = null, epoch = 0, serial = 0;
  let targetKey = "", targets = new Map(), lastCenterKey = "", lastScannedChunkCount = 0;
  let lastRefreshAt = 0, retryAfterAt = 0, ownedWalletAddress = "", ownedAt = -Infinity, ownedPromise = null;
  let ownedGeneration = 0, ownedRetryAfterAt = 0, lastIndexKey = "", lastPublishedTargetKey = "";

  function authorityContext() {
    return streamingContextKey([module?.getNicechunkDiscoveryContext?.() ?? "default", getAuthorityContext?.() ?? null, String(getWalletAddress() || "")]);
  }
  function ensureContext() {
    const next = authorityContext();
    if (next === authorityKey) return;
    authorityKey = next; epoch++;
    observations.clear(); coordinateRetries.clear(); inFlight.clear(); rounds.clear(); nearbyFoundations.clear(); ownedFoundations.clear(); pendingFoundations.clear();
    ownedWalletAddress = String(getWalletAddress() || ""); ownedAt = -Infinity; ownedPromise = null; ownedGeneration++; ownedRetryAfterAt = 0;
    retryAfterAt = 0; lastRefreshAt = 0; lastCenterKey = ""; lastPublishedTargetKey = "";
    rebuildIndex();
  }
  function currentTargets() {
    const center = currentChunk(), key = contextKey(center);
    if (key !== targetKey) {
      targetKey = key;
      const radius = normalizedViewDistance() + normalizedPreloadMargin() + 1;
      targets = new Map();
      for (let z = center.chunkZ-radius; z <= center.chunkZ+radius; z++) for (let x = center.chunkX-radius; x <= center.chunkX+radius; x++) {
        targets.set(chunkKey(x,z), { chunkX: x, chunkZ: z });
      }
    }
    lastScannedChunkCount = targets.size;
    return targets;
  }
  function logicalNow(attemptAt, startClock) { return attemptAt + Math.max(0, clock() - startClock); }
  function rowExpired(row, at) { return !row || at-row.verifiedAt >= (row.foundations.length ? freshnessMs : negativeFreshnessMs); }
  function updateForFrame(now = clock()) {
    ensureContext(); currentTargets();
    if (lastPublishedTargetKey !== targetKey) publish();
    const needed = [...targets.keys()].some((id) => !inFlight.has(id) && (rowExpired(observations.get(id), now) || coordinateRetries.has(id)) && now >= (coordinateRetries.get(id) || 0));
    const ownedNeeded = !ownedPromise && now >= ownedRetryAfterAt && now-ownedAt >= ownedFreshnessMs;
    if (!needed && !ownedNeeded) return null;
    if (now < retryAfterAt && targetKey === lastCenterKey) return null;
    return refresh({ quiet: true, now });
  }
  async function refresh({ force = false, quiet = true, now = clock() } = {}) {
    ensureContext(); currentTargets();
    const windowKey = targetKey;
    if (!force && rounds.has(windowKey)) return rounds.get(windowKey);
    const attemptAt = Number.isFinite(now) ? Number(now) : clock();
    if (!force && attemptAt < retryAfterAt && windowKey === lastCenterKey) return refreshResult({ ok: false, cached: true, retryAt: retryAfterAt });
    const startClock = clock(), startWall = Date.now();
    try { module = await loadChainModule(); } catch (error) { return failure(error, quiet, attemptAt); }
    ensureContext(); currentTargets();
    const requestEpoch = epoch;
    if (force) {
      for (const id of targets.keys()) { observations.get(id) && (observations.get(id).verifiedAt = -Infinity); inFlight.delete(id); }
    }
    const center = currentChunk();
    const needed = [...targets].filter(([id]) => !inFlight.has(id) && (force || (rowExpired(observations.get(id), attemptAt) || coordinateRetries.has(id))) && (force || attemptAt >= (coordinateRetries.get(id) || 0)))
      .sort(([a,x],[b,y]) => Number(observations.has(a))-Number(observations.has(b))
        || Math.max(Math.abs(x.chunkX-center.chunkX),Math.abs(x.chunkZ-center.chunkZ))-Math.max(Math.abs(y.chunkX-center.chunkX),Math.abs(y.chunkZ-center.chunkZ)));
    const owned = refreshOwned({ force, attemptAt, startClock, requestEpoch, quiet });
    let ownedResult = null;
    void owned.then(result => { ownedResult = result; });
    let successes = 0, failures = 0;
    const jobs = [];
    for (let start = 0; start < needed.length; start += querySize) {
      const batch = needed.slice(start,start+querySize), token = ++serial;
      for (const [id] of batch) inFlight.set(id,token);
      jobs.push(pool.run(async () => {
        ensureContext();
        const eligible = batch.filter(([id]) => epoch === requestEpoch && inFlight.get(id) === token && currentTargets().has(id));
        if (!eligible.length) return;
        if (typeof module.loadFoundationsForChunks !== "function") throw Error("FoundationChunk batch loader is unavailable.");
        const loaded = await module.loadFoundationsForChunks(eligible.map(([,coordinate]) => coordinate));
        ensureContext(); if (epoch !== requestEpoch) return;
        const verified = (loaded ?? []).map((record) => normalizeVerifiedFoundation(record)).filter(Boolean);
        const details = new Map((loaded?.observations ?? []).map((row) => [chunkKey(row.chunkX,row.chunkZ), row]));
        const hasCoordinateMetadata = Array.isArray(loaded?.observations);
        if (loaded?.failedCoordinates?.length || loaded?.issues?.length) failures++;
        const batchRetryAt = logicalNow(attemptAt,startClock)+FOUNDATION_RETRY_MS;
        for (const [id,coordinate] of eligible) {
          if (inFlight.get(id) !== token) continue;
          const metadata = details.get(id);
          if (hasCoordinateMetadata && !metadata) { coordinateRetries.set(id,batchRetryAt); continue; }
          const verifiedAt = Number.isFinite(metadata?.observedAt)
            ? attemptAt + Math.max(0, metadata.observedAt-startWall)
            : logicalNow(attemptAt,startClock);
          const records = verified.filter((foundation) => metadata?.foundationIds
            ? metadata.foundationIds.includes(String(foundation.foundationId))
            : foundationCoversChunk(foundation,coordinate,normalizedChunkSize()));
          if (metadata?.retryRequired) coordinateRetries.set(id,batchRetryAt); else coordinateRetries.delete(id);
          observations.delete(id); observations.set(id,{ ...metadata, foundations: records, verifiedAt });
          successes++;
        }
        for (const id of loaded?.invalidatedFoundationIds ?? []) {
          for (const row of observations.values()) row.foundations = row.foundations.filter((record) => String(record.foundationId) !== String(id));
          for (const [key,record] of ownedFoundations) if (String(record.foundationId) === String(id)) ownedFoundations.delete(key);
        }
        trimCache(); publish();
      }, { priority: start }).catch((error) => {
        ensureContext(); if (epoch !== requestEpoch) return;
        failures++;
        const retryAt = logicalNow(attemptAt,startClock)+FOUNDATION_RETRY_MS;
        for (const [id] of batch) if (inFlight.get(id) === token) {
          coordinateRetries.set(id,retryAt);
        }
        trimCache();
        if (!quiet) onStatus(text("main.land.syncFailed","Foundation PDA sync failed: {reason}",{reason:String(error?.message || error)}));
      }).finally(() => { for (const [id] of batch) if (inFlight.get(id) === token) inFlight.delete(id); }));
    }
    const work = Promise.all(force ? [...jobs, owned] : jobs).then(() => {
      ensureContext();
      if (epoch !== requestEpoch) return refreshResult({ok:true,stale:true});
      const ownerStatus = ownedResult || {ok:true,loading:!!ownedPromise};
      lastCenterKey = windowKey; lastRefreshAt = logicalNow(attemptAt,startClock);
      retryAfterAt = failures || ownerStatus.ok === false ? lastRefreshAt+FOUNDATION_RETRY_MS : 0;
      publish();
      return refreshResult({ ok: failures === 0 && ownerStatus.ok !== false, partial: failures>0 && (successes>0 || ownerStatus.ok),
        cached: needed.length===0, failures, scannedChunks: lastScannedChunkCount, ownedStatus: ownerStatus.ok === false ? "error" : ownerStatus.loading ? "loading" : "ready",
        stale: windowKey !== targetKey });
    }).finally(() => { if (rounds.get(windowKey) === work) rounds.delete(windowKey); });
    rounds.set(windowKey,work);
    return work;
  }
  function refreshOwned({ force, attemptAt, startClock, requestEpoch, quiet }) {
    const wallet = String(getWalletAddress() || "");
    if (!force && (ownedPromise || attemptAt < ownedRetryAfterAt || attemptAt-ownedAt < ownedFreshnessMs)) return ownedPromise || Promise.resolve({ok:true,cached:true});
    const generation = ++ownedGeneration;
    const work = (async () => {
      try {
        if (wallet && typeof module.loadOwnedFoundations !== "function") throw Error("Owned BuildSite loader is unavailable.");
        const loaded = wallet ? await module.loadOwnedFoundations(wallet) : [];
        ensureContext(); if (epoch !== requestEpoch || generation !== ownedGeneration) return {ok:true,stale:true};
        replaceVerifiedFoundations(ownedFoundations,loaded,{owner:wallet,allowIndexing:true});
        ownedWalletAddress=wallet; ownedAt=logicalNow(attemptAt,startClock); ownedRetryAfterAt=0; publish();
        return {ok:true};
      } catch (error) {
        if (epoch === requestEpoch && generation === ownedGeneration) ownedRetryAfterAt=logicalNow(attemptAt,startClock)+FOUNDATION_RETRY_MS;
        if (!quiet) onStatus(String(error?.message || error)); return {ok:false};
      }
    })().finally(() => { if (ownedPromise === work) ownedPromise=null; });
    ownedPromise=work; return work;
  }
  function publish() {
    currentTargets(); lastPublishedTargetKey=targetKey; nearbyFoundations.clear();
    const latest = new Map();
    for (const id of targets.keys()) for (const foundation of observations.get(id)?.foundations ?? []) {
      const at=observations.get(id).verifiedAt;
      if (at >= (latest.get(foundation.id)?.at ?? -Infinity)) latest.set(foundation.id,{foundation,at});
    }
    for (const [id,{foundation}] of latest) nearbyFoundations.set(id,foundation);
    prunePendingFoundations(); rebuildIndex();
  }
  function rebuildIndex() {
    const merged = new Map();
    for (const foundation of ownedFoundations.values()) if (foundation.status === "active" && foundation.hasActiveGeometry !== false) merged.set(foundation.id,foundation);
    for (const foundation of nearbyFoundations.values()) merged.set(foundation.id,mergeFoundationHash(foundation,merged.get(foundation.id)));
    for (const {foundation} of pendingFoundations.values()) merged.set(foundation.id,foundation);
    const key=JSON.stringify([...merged.values()]);
    if (key !== lastIndexKey) { lastIndexKey=key; index?.replace?.([...merged.values()]); onChanged(refreshResult({count:index?.size?.() ?? merged.size,ownedStatus:"ready"})); }
  }
  function replaceVerifiedFoundations(target,foundations,options={}) {
    const next=new Map();
    for(const input of foundations ?? []) { const foundation=normalizeVerifiedFoundation(input,options); if(foundation) {next.set(foundation.id,mergeFoundationHash(foundation,target.get(foundation.id)));pendingFoundations.delete(foundation.id);} }
    target.clear(); for(const [id,record] of next) target.set(id,record);
  }
  function trimCache() {
    for (const id of observations.keys()) { if (observations.size <= maxCachedCoordinates) break; if (!targets.has(id)) { observations.delete(id); coordinateRetries.delete(id); } }
    for (const id of coordinateRetries.keys()) { if (coordinateRetries.size <= maxCachedCoordinates) break; if (!targets.has(id)) coordinateRetries.delete(id); }
  }
  function prunePendingFoundations() { for(const [id,row] of pendingFoundations) if(row.expiresAt<=Date.now()) pendingFoundations.delete(id); }
  function currentChunk() {const [x,,z]=getPlayerPosition?.() ?? [0,0,0];return {chunkX:Math.floor(finiteNumber(x)/normalizedChunkSize()),chunkZ:Math.floor(finiteNumber(z)/normalizedChunkSize())};}
  function contextKey(center) { return `${chunkKey(center.chunkX,center.chunkZ)}:${normalizedViewDistance()}:${normalizedPreloadMargin()}`; }
  function normalizedViewDistance(){return Math.max(1,Math.trunc(Number(getViewDistance?.()) || DEFAULT_VIEW_DISTANCE_CHUNKS));}
  function normalizedPreloadMargin(){return Math.max(0,Math.trunc(Number(getPreloadMargin?.()) || 0));}
  function normalizedChunkSize(){return Math.max(1,Math.trunc(Number(chunkSize) || DEFAULT_CHUNK_SIZE));}
  function ownedList(){return [...ownedFoundations.values()];}
  function snapshot(){ensureContext();return {loading:rounds.size>0||!!ownedPromise,discoveryRounds:rounds.size,ownedLoading:!!ownedPromise,ownedRetryAfterAt,lastRefreshAt,retryAfterAt,centerChunk:lastCenterKey,scannedChunks:lastScannedChunkCount,nearby:nearbyFoundations.size,owned:ownedFoundations.size,pending:pendingFoundations.size,count:index?.size?.() ?? 0,mode:"on-chain-chunk-index",ownedFoundations:ownedList(),cachedCoordinates:observations.size,inFlightCoordinates:inFlight.size,authorityEpoch:epoch,requests:pool.snapshot()};}
  function refreshResult(result={}){return {...result,foundations:index?.list?.() ?? [],ownedFoundations:ownedList()};}
  function failure(error,quiet,at){retryAfterAt=at+FOUNDATION_RETRY_MS;if(!quiet)onStatus(String(error?.message || error));return refreshResult({ok:false,reason:String(error?.message || error),retryAt:retryAfterAt,ownedStatus:"error"});}
  function text(key,fallback,params={}){const value=translate?.(key,fallback,params);return typeof value==="string"&&value!==key?value:fallback.replace(/\{(\w+)\}/g,(_,name)=>String(params[name] ?? ""));}
  return {refresh,create,updateForFrame,snapshot,ownedList};
  async function create(payload) {
    const wallet = String(getWalletAddress() || "");
    if (!wallet) return { submitted: false, reason: "wallet-unavailable" };
    const module = await loadChainModule();
    if (typeof module.createFoundationOnChain !== "function") {
      return { submitted: false, reason: "foundation-chain-api-unavailable" };
    }
    const result = await module.createFoundationOnChain({ ...payload });
    if (!result?.submitted) return result ?? { submitted: false, reason: "foundation-not-submitted" };
    const foundation = normalizeVerifiedFoundation({
      ...payload,
      ...result.foundation,
      owner: result.foundation?.owner || wallet,
    }, { owner: wallet });
    if (!foundation) {
      return { ...result, submitted: false, reason: "invalid-foundation-result" };
    }
    if (ownedWalletAddress !== wallet) {
      ownedWalletAddress = wallet;
      ownedFoundations.clear();
    }
    ownedFoundations.set(foundation.id, foundation);
    pendingFoundations.set(foundation.id, {
      foundation,
      expiresAt: Date.now() + PENDING_FOUNDATION_MS,
    });
    rebuildIndex();
    onChanged(refreshResult({ created: foundation, count: index?.size?.() ?? 0, ownedStatus: "ready" }));
    globalThis.setTimeout(() => void refresh({ force: true, quiet: true }), 500);
    return { ...result, foundation, indexedOnChain: true };
  }

}

function normalizeVerifiedFoundation(input = {}, { owner = "", allowIndexing = false } = {}) {
  const foundationId = normalizeFoundationId(input.foundationId);
  const expectedOwner = String(owner || "");
  const actualOwner = String(input.owner || "");
  const status = String(input.status || "");
  if (!foundationId
    || !actualOwner
    || expectedOwner && actualOwner !== expectedOwner
    || input.accountVersion !== 3
    || status === "active" && input.hasActiveGeometry === false
    || status !== "active" && !(allowIndexing && (status === "indexing" || status === "canceling"))) {
    return null;
  }
  return {
    ...input,
    id: String(input.id || `${actualOwner}:${foundationId}`),
    owner: actualOwner,
    foundationId,
  };
}

function mergeFoundationHash(primary, fallback) {
  const hash = normalizeBuildingHash(primary?.contentHash);
  if (hash) return { ...primary, contentHash: hash };
  const sameRevision = !primary?.buildingVerificationFailed && String(primary?.owner) === String(fallback?.owner)
    && String(primary?.foundationId) === String(fallback?.foundationId)
    && Number(primary?.activeRevision) === Number(fallback?.activeRevision)
    && String(primary?.programId || "") === String(fallback?.programId || "");
  const fallbackHash = sameRevision ? normalizeBuildingHash(fallback?.contentHash) : "";
  return fallbackHash ? { ...primary, contentHash: fallbackHash } : primary;
}

function normalizeBuildingHash(value) {
  const hash = String(value || "").trim().toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{64}$/.test(hash) && !/^0+$/.test(hash) ? hash : "";
}

function normalizeFoundationId(value) {
  try {
    const id = BigInt(value ?? 0);
    return id > 0n && id <= 0xffffffffffffffffn ? id.toString() : "";
  } catch {
    return "";
  }
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function chunkKey(chunkX, chunkZ) {
  return `${Math.trunc(chunkX)},${Math.trunc(chunkZ)}`;
}
