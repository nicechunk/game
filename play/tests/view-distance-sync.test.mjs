import assert from "node:assert/strict";
import test from "node:test";
import { createPlayChainFoundationSync } from "../play-chain-foundations.js";
import { createPlayChainBuildingSync } from "../play-chain-buildings.js";

test("foundation discovery follows live 7 -> 2 -> 20 -> 7 view changes at the same position", async () => {
  let view = 7;
  const queried = [];
  const sync = createPlayChainFoundationSync({ getViewDistance: () => view, preloadMargin: 2,
    index: { replaceAll() {}, list: () => [], size: () => 0 },
    loadChainModule: async () => ({ loadFoundationsForChunks: async (chunks) => { queried.push(chunks); return []; } }),
  });
  for (const [index, distance] of [7, 2, 20, 7].entries()) {
    view = distance;
    await sync.updateForFrame(1000 + index);
    const radius = distance + 3;
    assert.equal(queried.length, index + 1, "range change must bypass the normal refresh TTL");
    assert.equal(queried.at(-1).length, (2 * radius + 1) ** 2);
  }
});

test("building discovery invalidates context and query radius when view changes", async () => {
  let view = 7;
  const radii = [];
  const sync = createPlayChainBuildingSync({ getViewDistance: () => view, preloadMargin: 2,
    getFoundationVersion: () => 0,
    getFoundationsNear: (_x, _z, radius) => { radii.push(radius); return []; },
    cache: { getBuildings: async () => [] },
  });
  for (const [index, distance] of [7, 2, 20, 7].entries()) {
    view = distance;
    await sync.updateForFrame(1000 + index);
    assert.equal(radii.length, index + 1);
    assert.equal(radii.at(-1), (distance + 3) * 16);
    assert.ok(sync.snapshot().contextKey.endsWith(`:${distance}:2`));
  }
});

test("a late foundation range result cannot replace the index after view shrink", async () => {
  let view=7,records=[],calls=0,release,started;
  const waiting=new Promise(resolve=>{release=resolve;});
  const firstStarted=new Promise(resolve=>{started=resolve;});
  const land=id=>({id:`owner:${id}`,owner:"owner",foundationId:id,minX:0,minZ:0,maxX:15,maxZ:15,
    width:16,depth:16,surfaceY:100,activeRevision:1,contentHash:"ab".repeat(32),status:"active",accountVersion:3,hasActiveGeometry:true});
  const sync=createPlayChainFoundationSync({getViewDistance:()=>view,
    index:{replace(next){records=next;},list:()=>records,size:()=>records.length},
    loadChainModule:async()=>({loadFoundationsForChunks:async()=>{calls++;if(calls===1){started();await waiting;return[land("1")];}return[land("2")];}}),
  });
  const request=sync.refresh({force:true,now:1000});await firstStarted;
  view=2;release();
  const stale=await request;
  assert.equal(stale.stale,true);
  assert.equal(records.length,0,"the old range must not reach the active index");
  await sync.updateForFrame(1100);
  assert.deepEqual(records.map(record=>record.foundationId),["2"]);
});

test("a late building range result cannot reintroduce far buildings after view shrink", async () => {
  const {createHash}=await import("node:crypto");
  const contentHash=createHash("sha256").update(new Uint8Array([1])).digest("hex");
  const land={owner:"owner",foundationId:"1",activeRevision:1,contentHash,minX:250,minZ:0,maxX:265,maxZ:15,width:16,depth:16};
  let view=20,release,started;const applied=[];
  const waiting=new Promise(resolve=>{release=resolve;});const firstStarted=new Promise(resolve=>{started=resolve;});
  const sync=createPlayChainBuildingSync({getViewDistance:()=>view,getFoundations:()=>[land],getFoundationVersion:()=>1,
    cache:{getBuildings:async foundations=>foundations.map(()=>null)},applyBuildings:buildings=>applied.push(buildings),
    loadChainModule:async()=>({loadBuildingsForFoundations:async()=>{started();await waiting;return[{owner:"owner",foundationId:"1",revision:1,contentHash,code:"NCM3:AQ"}];}}),
  });
  const request=sync.refresh({force:true,now:1000});await firstStarted;
  view=2;release();
  const stale=await request;
  assert.equal(stale.stale,true);
  assert.equal(applied.length,0,"the old range must not reach building geometry application");
  await sync.updateForFrame(1100);
  assert.deepEqual(applied,[[]]);
});
