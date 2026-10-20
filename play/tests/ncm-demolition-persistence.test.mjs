import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createFoundationSpatialIndex} from '../foundation-spatial-index.js';
import {createPlayBuildingCache} from '../play-building-cache.js';
import {createPlayChainBuildingSync} from '../play-chain-buildings.js';
import {createBuildingController} from '../building-controller.js';
import {createBuildingMeshWorkerClient} from '../../chunk.js/construction/building-mesh-client.js';
import {createBlueprint,encodeNcm3} from '../../chunk.js/ncm/blueprint-codec.js';
import {reconcilePendingMineWithChainResult} from '../play-chain-mining-result.js';

const code=encodeNcm3(createBlueprint({x:2,y:1,z:2}).box(64,0,0,0,2,1,2));
const contentHash=createHash('sha256').update(Buffer.from(code.slice(5),'base64url')).digest('hex');
const f={id:'fixture:45',owner:'fixture',foundationId:'45',minX:0,minZ:0,width:16,depth:16,surfaceY:100,
  status:'active',activeRevision:1,updatedSlot:'10',contentHash,buildingHasDamage:false,buildingDamageVersion:0,buildingDamageSlot:'10'};
const b={id:'fixture-building:1',owner:f.owner,foundationId:f.foundationId,revision:1,code,contentHash,updatedSlot:'10',hasDamage:false,damageVersion:0};
const bitmap=new Uint8Array(32);bitmap[0]=1;
const damaged={...b,hasDamage:true,damageVersion:1,updatedSlot:'11',damageSections:[{sectionX:0,sectionZ:0,sizeY:1,bitmap}]};
const fd={...f,buildingHasDamage:true,buildingDamageVersion:1,buildingDamageSlot:'11',updatedSlot:'11'};
const flush=sync=>sync.applyQueuedBuildings({budgetMs:1000,maxBuildings:100});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};

test('cold reload rejects an intact IndexedDB entry after the real spatial index normalizes a damaged deed',async()=>{
 const index=createFoundationSpatialIndex(),cache=createPlayBuildingCache({getScope:()=> 'ncm-air-regression'});
 await cache.putVerifiedBuilding(f,b);index.replace([fd]);
 assert.equal(index.list()[0].buildingHasDamage,true);
 const version=index.version();index.replace([{...fd,buildingDamageVersion:2}]);assert.equal(index.version(),version+1);
 index.replace([fd]);let reads=0;const applied=[];
 const client=createBuildingMeshWorkerClient({useWorker:false});const controller=createBuildingController({index,createMeshClient:()=>client});
 const sync=createPlayChainBuildingSync({autoApply:false,cache,getFoundations:()=>index.list(),getFoundationVersion:index.version,
  loadChainModule:async()=>({loadBuildingsForFoundations:async()=>{reads++;return[damaged];}}),
  applyBuildings:records=>{applied.push(records);return controller.applyChainBuildings(records);}});
 try {
  assert.equal((await sync.refresh({force:true})).ok,true);flush(sync);
  await new Promise(r=>setTimeout(r,100));
  assert.equal(reads,1,'chain damage must take precedence over matching cached NCM bytes');
  assert.equal(applied.at(-1)[0].hasDamage,true);
  assert.equal(controller.renderChunks().reduce((n,c)=>n+c.voxelCount,0),3);
  assert.equal(controller.getMiningTargetAtWorld(7,100,7),null);
 }finally{client.dispose();}
});

test('manifest changes retain the previous complete scene during delayed reads and mesh jobs',async()=>{
 const index=createFoundationSpatialIndex();index.replace([f]);const reads=deferred(),meshes=deferred(),published=[];
 let delayed=false;const client=createBuildingMeshWorkerClient({useWorker:false});
 const controller=createBuildingController({index,createMeshClient:()=>({build:async(...args)=>{if(delayed)await meshes.promise;return client.build(...args);}})});
 const sync=createPlayChainBuildingSync({autoApply:false,cache:null,getFoundations:()=>index.list(),getFoundationVersion:index.version,
  loadChainModule:async()=>({loadBuildingsForFoundations:async()=>{if(delayed)await reads.promise;return[delayed?damaged:b];}}),
  applyBuildings:records=>{published.push(records);return controller.applyChainBuildings(records);}});
 try{
  await sync.refresh({force:true});flush(sync);await new Promise(r=>setTimeout(r,50));
  assert.equal(controller.renderChunks().reduce((n,c)=>n+c.voxelCount,0),4);
  const originalChunks=controller.renderChunks();delayed=true;index.replace([fd]);
  const pending=sync.refresh({force:true});flush(sync);await new Promise(r=>setTimeout(r,0));
  assert.equal(controller.renderChunks(),originalChunks);assert(published.every(records=>records.length===1));
  reads.resolve();await pending;flush(sync);await new Promise(r=>setTimeout(r,0));
  assert.equal(controller.renderChunks(),originalChunks,'old collision and rendering survive until replacement mesh completes');
  meshes.resolve();await new Promise(r=>setTimeout(r,70));
  assert.equal(controller.renderChunks().reduce((n,c)=>n+c.voxelCount,0),3);
  assert(published.every(records=>records.length===1),'no intermediate empty scene may cause a flash');
 }finally{client.dispose();}
});

test('demolition counts only the atomically confirmed material and never writes terrain deltas',()=>{
 const pending={miningKind:'building-demolition',blocks:[{worldX:1,worldY:100,worldZ:1,blockId:64}],rewardGroups:[],pendingDeltas:[]};
 reconcilePendingMineWithChainResult(pending,{storedRewardCount:1,storedRewards:[{worldX:1,worldY:100,worldZ:1,blockId:64,resourceId:2,count:1}]});
 assert.deepEqual(pending.rewardGroups,[{blockId:64,resourceId:2,count:1}]);assert.equal(pending.storedRewardCount,1);assert.deepEqual(pending.pendingDeltas,[]);
});
