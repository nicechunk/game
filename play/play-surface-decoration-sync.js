import { loadPlayChainModule } from "./play-chain-adapter.js";
import {
  compileSurfaceDecorationRules,
  surfaceDecorationVariantHash,
  BLOCK_ID, RESOURCE_ID, terrainSurfaceHeight,
  resolveSurfaceDecoration,
} from "../chunk.js/play.js";

export function createPlaySurfaceDecorationSync({
  chunks,
  worldSeed = "",
  initialRules = [],
  onRulesChanged = () => {},
} = {}) {
  const state = {
    started: false,
    loading: false,
    loaded: false,
    found: false,
    applied: false,
    revision: 0,
    ruleCount: 0,
    error: "",
  };
  let pickupsLoading = false;
  let syncPromise = null;
  const pickedByChunk = new Map();
  let compiledRules = compileSurfaceDecorationRules(initialRules);

  return {
    start,
    scheduleAfterWorldVisible,
    snapshot: () => ({ ...state }),
    resolveBackpackDecoration,
    bareHandPlan, markPicked, syncPickups,
  };

  function scheduleAfterWorldVisible() {
    return start();
  }

  function start() {
    if (state.started) return null;
    state.started = true;
    globalThis.setInterval(() => { syncPickups().catch(() => {}); }, 5000);
    syncPromise = sync();
    return syncPromise;
  }

  async function sync() {
    state.loading = true;
    state.error = "";
    try {
      const module = await loadPlayChainModule();
      if (typeof module.fetchSurfaceDecorationTableOnChain !== "function") {
        state.loaded = true;
        return { ok: false, reason: "surface-decoration-reader-unavailable" };
      }
      const table = await module.fetchSurfaceDecorationTableOnChain();
      state.loaded = true;
      state.found = Boolean(table?.found);
      state.revision = Math.max(0, Math.trunc(Number(table?.revision) || 0));
      state.ruleCount = Array.isArray(table?.rules) ? table.rules.length : 0;
      if (!state.found || !state.ruleCount) {
        compiledRules = compileSurfaceDecorationRules([]);
        state.applied = Boolean(chunks?.setSurfaceDecorationRules?.([], { revision: 0 }));
        onRulesChanged({ rules: [], revision: 0 });
        return { ok: true, found: false, applied: false, ruleCount: 0 };
      }
      compiledRules = compileSurfaceDecorationRules(table.rules);
      state.applied = Boolean(chunks?.setSurfaceDecorationRules?.(table.rules, {
        revision: state.revision,
      }));
      onRulesChanged({ rules: compiledRules.rules, revision: state.revision });
      await syncPickups();
      return {
        ok: true,
        found: true,
        applied: state.applied,
        revision: state.revision,
        ruleCount: state.ruleCount,
      };
    } catch (error) {
      state.error = error?.message || String(error);
      console.warn("[NiceChunk Decorations] PDA sync failed; non-tree decorations remain disabled until verified rules are available.", error);
      return { ok: false, reason: state.error };
    } finally {
      state.loading = false;
    }
  }

  function bareHandPlan(hit) {
    if (!hit?.hit || !chunks?.config || Number.isInteger(chunks.getDeltaAtWorld?.(hit.worldX,hit.worldY,hit.worldZ))) return null;
    const surface = terrainSurfaceHeight(chunks.config,hit.worldX,hit.worldZ);
    const single = {blocks:[{...hit}],rewardBlocks:[{...hit}],collapseBlocks:[]};
    if (hit.blockId===BLOCK_ID.leaves || hit.blockId===BLOCK_ID.pineLeaves) return {...single,kind:"bare-leaves",requiredDamage:3};
    if (hit.worldY!==surface || chunks.getBlockAtWorld(hit.worldX,surface+1,hit.worldZ)!==BLOCK_ID.air) return null;
    const cx=Math.floor(hit.worldX/16),cz=Math.floor(hit.worldZ/16),column=((hit.worldZ%16+16)%16)*16+(hit.worldX%16+16)%16;
    const decoration=resolveSurfaceDecoration({worldSeed,worldX:hit.worldX,surfaceY:surface,worldZ:hit.worldZ,surfaceBlockId:hit.blockId,rules:compiledRules});
    if (decoration?.decorationId>=100 && decoration.decorationId<=107 && !pickedByChunk.get(`${cx},${cz}`)?.includes(column)) {
      return {...single,kind:"surface-pebble",requiredDamage:1,rewardBlocks:[{...hit,worldY:surface+1,blockId:BLOCK_ID.stoneFragment,resourceId:RESOURCE_ID.stoneFragment}]};
    }
    return null;
  }
  function setPicked(cx,cz,columns) {
    const id=`${cx},${cz}`;columns=[...new Set([...(pickedByChunk.get(id)||[]),...columns])].sort((a,b)=>a-b);pickedByChunk.set(id,columns);
    if (chunks.setPickedSurfaceColumns) chunks.setPickedSurfaceColumns(cx,cz,columns);
    else {
      const chunk=chunks.chunks?.get(id);
      if (chunk && JSON.stringify(chunk.pickedSurfaceColumns)!==JSON.stringify(columns)) { chunk.pickedSurfaceColumns=columns;chunk.markDirty(); }
    }
  }
  function markPicked(hit) {
    const cx=Math.floor(hit.worldX/16),cz=Math.floor(hit.worldZ/16),column=((hit.worldZ%16+16)%16)*16+(hit.worldX%16+16)%16;
    const previous=pickedByChunk.get(`${cx},${cz}`)||[];setPicked(cx,cz,[...new Set([...previous,column])].sort((a,b)=>a-b));
  }
  async function syncPickups() {
    if (pickupsLoading || !state.applied || !chunks.chunks?.size) return;
    pickupsLoading=true;
    try {
      const module=await loadPlayChainModule();if (!module.fetchSurfacePickedChunksOnChain) return;
      const coords=[...chunks.chunks.values()].filter(c=>Math.abs(c.chunkX-chunks.centerChunkX)<=2 && Math.abs(c.chunkZ-chunks.centerChunkZ)<=2).map(c=>({chunkX:c.chunkX,chunkZ:c.chunkZ}));
      for (const row of await module.fetchSurfacePickedChunksOnChain(coords)) setPicked(row.chunkX,row.chunkZ,row.columns);
    } finally {pickupsLoading=false;}
  }

  function resolveBackpackDecoration(resource = {}) {
    const worldX = Math.trunc(Number(resource.worldX) || 0);
    const worldY = Math.trunc(Number(resource.worldY) || 0);
    const worldZ = Math.trunc(Number(resource.worldZ) || 0);
    const blockId = Math.max(0, Math.trunc(Number(resource.blockId) || 0));
    const metadata = Math.trunc(Number(resource.metadata) || 0) >>> 0;
    const decorationId = metadata & 0xffff;
    const ruleId = metadata >>> 16;
    const surfaceY = worldY - 1;
    if (!decorationId || !ruleId || !blockId) return null;
    const rule = compiledRules.rules.find((entry) => (
      entry.ruleId === ruleId && entry.decorationId === decorationId
    ));
    return decorationResult({
      decorationId,
      ruleId,
      surfaceBlockId: rule?.surfaceBlockId,
      variant: rule?.variant,
      flags: rule?.flags,
      worldX,
      surfaceY,
      worldZ,
    });
  }

  function decorationResult({ decorationId, ruleId, surfaceBlockId, variant, flags, worldX, surfaceY, worldZ }) {
    return {
      decorationId: Math.max(0, Math.trunc(Number(decorationId) || 0)),
      decorationRuleId: Math.max(0, Math.trunc(Number(ruleId) || 0)),
      decorationSurfaceBlockId: Math.max(0, Math.trunc(Number(surfaceBlockId) || 0)),
      decorationVariant: Math.max(0, Math.trunc(Number(variant) || 0)),
      decorationFlags: Math.max(0, Math.trunc(Number(flags) || 0)),
      decorationVariantHash: surfaceDecorationVariantHash({
        worldSeed,
        worldX,
        surfaceY,
        worldZ,
        ruleId,
      }),
    };
  }
}
