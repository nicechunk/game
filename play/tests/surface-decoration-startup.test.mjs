import assert from "node:assert/strict";
import test from "node:test";
import { createPlaySurfaceDecorationSync } from "../play-surface-decoration-sync.js";
import { DEFAULT_SURFACE_DECORATION_RULES } from "../../chunk.js/world/surface-decoration-rules.js";

test("decoration reads can start before the first mesh and duplicate visibility notifications do not refetch",async()=>{
  const oldUrl=globalThis.NICECHUNK_CHAIN_MODULE_URL,oldInterval=globalThis.setInterval;
  const events=[];
  globalThis.setInterval=()=>0;
  globalThis.NICECHUNK_CHAIN_MODULE_URL='data:text/javascript,'+encodeURIComponent('export async function fetchSurfaceDecorationTableOnChain(){return globalThis.__chunkDecorationStartupTable();}');
  globalThis.__chunkDecorationStartupTable=()=>{events.push('fetch');return {found:true,revision:3,rules:DEFAULT_SURFACE_DECORATION_RULES};};
  try {
    const chunks={chunks:new Map(),setSurfaceDecorationRules(rules,options){events.push(['apply',rules.length,options.revision]);return true;}};
    const sync=createPlaySurfaceDecorationSync({chunks});
    const result=await sync.start();
    assert.equal(result.ok,true);assert.equal(result.revision,3);
    assert.equal(chunks.chunks.size,0,'rule retrieval does not depend on generated/visible chunks');
    assert.deepEqual(events,['fetch',['apply',DEFAULT_SURFACE_DECORATION_RULES.length,3]]);
    assert.equal(sync.scheduleAfterWorldVisible(),null);
    assert.equal(sync.start(),null);
  } finally {
    globalThis.NICECHUNK_CHAIN_MODULE_URL=oldUrl;globalThis.setInterval=oldInterval;
    delete globalThis.__chunkDecorationStartupTable;
  }
});

test("pickup updates use the manager's section invalidation API and remain available for unloaded columns",async()=>{
  const oldUrl=globalThis.NICECHUNK_CHAIN_MODULE_URL,oldInterval=globalThis.setInterval;
  globalThis.setInterval=()=>0;
  globalThis.NICECHUNK_CHAIN_MODULE_URL='data:text/javascript,'+encodeURIComponent('export async function fetchSurfaceDecorationTableOnChain(){return {found:false,rules:[]};}');
  const calls=[];
  try {
    const sync=createPlaySurfaceDecorationSync({chunks:{chunks:new Map(),setSurfaceDecorationRules(){return false;},
      setPickedSurfaceColumns(x,z,columns){calls.push({x,z,columns});}}});
    sync.markPicked({worldX:-1,worldZ:-1});
    assert.deepEqual(calls,[{x:-1,z:-1,columns:[255]}]);
  } finally {globalThis.NICECHUNK_CHAIN_MODULE_URL=oldUrl;globalThis.setInterval=oldInterval;}
});
