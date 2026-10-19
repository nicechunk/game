import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayStartupLogger } from '../play-startup-logger.js';
import { measurePlayWorldReadiness, shouldDeferCoveredWorld, syncPlayStartupViewport } from '../play-world-readiness.js';
import { createPlayRenderBudget } from '../play-render-budget.js';
import { createCameraState } from '../../chunk.js/renderer/camera.js';

test('CPU-visible sections and sky draws cannot dismiss loading before terrain reaches the GPU',()=>{
  const previous=globalThis.NiceChunkLoading;
  let ready=0;
  globalThis.NiceChunkLoading={worldReady(){ready++;},worldProgress(){}};
  const logger=createPlayStartupLogger({enabled:false});
  try {
    logger.noteFrame(0,{renderStats:{visibleChunks:23,drawCalls:3,terrainDrawCalls:0}});
    assert.equal(ready,0);
    logger.noteFrame(1,{renderStats:{visibleChunks:1,drawCalls:4,terrainDrawCalls:1}});
    assert.equal(ready,1);
    logger.noteFrame(2,{renderStats:{visibleChunks:2,drawCalls:5,terrainDrawCalls:2}});
    assert.equal(ready,1);
  } finally {logger.stop();globalThis.NiceChunkLoading=previous;}
});

test('initial coverage waits for missing visible columns and both current GPU channels, excluding the preload ring',()=>{
  const camera=createCameraState({worldX:8,worldY:8,worldZ:0,targetWorldX:8,targetWorldY:8,targetWorldZ:8,aspect:1,far:160});
  const mesh=()=>({indexCount:3,vertexCount:3,bounds:{minX:0,maxX:16,minY:0,maxY:16,minZ:0,maxZ:16},originY:0});
  const center={id:'0,0',chunkX:0,chunkZ:0,chunkSize:16,minY:0,height:16,baseBlocksReady:true,mesh:mesh(),gpuUploaded:true};
  const front={id:'0,3',chunkX:0,chunkZ:3,chunkSize:16,minY:0,height:16,baseBlocksReady:false,mesh:null};
  const outside={...front,id:'0,5',chunkZ:5};
  const behind={...front,id:'0,-3',chunkZ:-3};
  const chunks={centerChunkX:0,centerChunkZ:0,viewDistance:4,chunks:new Map([center,front,outside,behind].map(c=>[c.id,c]))};
  const entries=new Map([[center,{mesh:center.mesh}]]);
  const visualEntries=new Map();
  const renderer={entryForChunk:(chunk,visual)=>(visual?visualEntries:entries).get(chunk)};
  let result=measurePlayWorldReadiness(chunks,renderer,camera);
  assert.equal(result.targetChunks,2);
  assert.equal(result.ready,false,'one drawn column cannot cover a missing visible column');
  front.baseBlocksReady=true;front.mesh=mesh();front.visualMesh=mesh();front.gpuUploaded=true;front.visualGpuUploaded=true;
  entries.set(front,{mesh:mesh()});visualEntries.set(front,{mesh:front.visualMesh});
  result=measurePlayWorldReadiness(chunks,renderer,camera);
  assert.equal(result.ready,false,'an older GPU mesh cannot satisfy the current initial commit');
  assert.equal(result.pendingChannels,1);
  entries.set(front,{mesh:front.mesh});visualEntries.delete(front);
  assert.equal(measurePlayWorldReadiness(chunks,renderer,camera).ready,false,'water also has to reach the GPU');
  visualEntries.set(front,{mesh:front.visualMesh});
  assert.equal(measurePlayWorldReadiness(chunks,renderer,camera).ready,true);
  camera.targetWorldZ=-64;
  assert.equal(measurePlayWorldReadiness(chunks,renderer,camera).ready,false,'turning must include the newly visible missing column');
});

test('a partial or deferred world frame never releases the initial coverage hold',()=>{
  const previous=globalThis.NiceChunkLoading;let ready=0;
  globalThis.NiceChunkLoading={worldReady(){ready++;},worldProgress(){}};
  const logger=createPlayStartupLogger({enabled:false});
  const stats={terrainDrawCalls:1,drawCalls:4,visibleChunks:1};
  try {
    logger.noteFrame(0,{renderStats:stats,worldReadiness:{ready:false,targetChunks:9,readyChunks:1}});
    assert.equal(ready,0);
    logger.noteFrame(1,{renderStats:{...stats,renderDeferred:true},worldReadiness:{ready:true,targetChunks:9,readyChunks:9}});
    assert.equal(ready,0);
    logger.noteFrame(2,{renderStats:stats,worldReadiness:{ready:true,targetChunks:9,readyChunks:9}});
    logger.noteFrame(3,{renderStats:stats});
    assert.equal(ready,1);
  }finally{logger.stop();globalThis.NiceChunkLoading=previous;}
});

test('startup skips hidden draws only under the opaque loader and retains interactive upload limits afterwards',()=>{
  assert.equal(shouldDeferCoveredWorld({ready:false},{coversWorld:()=>true}),true);
  assert.equal(shouldDeferCoveredWorld({ready:true},{coversWorld:()=>true}),false);
  assert.equal(shouldDeferCoveredWorld({ready:false},{coversWorld:()=>false}),false);
  assert.equal(shouldDeferCoveredWorld({ready:false},{}),false);
  const chunks={useWorkers:true,workerCount:4,buildQueue:[]};
  const budget=createPlayRenderBudget({getChunks:()=>chunks,getFps:()=>10});
  assert.equal(budget.frameBuildConcurrencyLimit(),4);
  assert.ok(budget.frameUploadBudget()>=4,'compilation/deferred FPS cannot serialize startup uploads');
  budget.noteWorldVisible();budget.noteWorldCovered();
  assert.equal(budget.frameBuildConcurrencyLimit(),1);
  assert.equal(budget.frameUploadBudget(),1);
});

test('covered startup and rotation use actual landscape/portrait projection before the first render',()=>{
  const camera=createCameraState({worldX:8,worldY:8,worldZ:0,targetWorldX:8,targetWorldY:8,targetWorldZ:64,aspect:1,far:160});
  const mesh={indexCount:3,vertexCount:3,bounds:{minX:0,maxX:16,minY:0,maxY:16,minZ:0,maxZ:16},originY:0};
  const front={id:'0,3',chunkX:0,chunkZ:3,chunkSize:16,minY:0,height:16,mesh,baseBlocksReady:true,gpuUploaded:true};
  const side={id:'3,3',chunkX:3,chunkZ:3,chunkSize:16,minY:0,height:16,mesh:null,baseBlocksReady:false};
  const chunks={centerChunkX:0,centerChunkZ:0,viewDistance:4,chunks:new Map([[front.id,front],[side.id,side]])};
  const renderer={canvas:{width:640,height:360},resize(){},entryForChunk:()=>({mesh})};
  assert.equal(measurePlayWorldReadiness(chunks,renderer,camera).ready,true,'the square placeholder projection excludes the side column');
  syncPlayStartupViewport(renderer,camera);
  assert.equal(camera.aspect,640/360);
  assert.equal(measurePlayWorldReadiness(chunks,renderer,camera).ready,false,'landscape must include its still-missing side column');
  renderer.canvas.width=360;renderer.canvas.height=640;syncPlayStartupViewport(renderer,camera);
  assert.equal(camera.aspect,360/640);
  assert.equal(measurePlayWorldReadiness(chunks,renderer,camera).ready,true);
});

test('camera-target boundary columns are included even when outside the player-centered view radius',()=>{
  const camera=createCameraState({worldX:8,worldY:8,worldZ:-8,targetWorldX:8,targetWorldY:8,targetWorldZ:16,
    targetLocalOffsetZ:-.001,aspect:1,far:160});
  const mesh={indexCount:3,vertexCount:3,bounds:{minX:0,maxX:16,minY:0,maxY:16,minZ:0,maxZ:16},originY:0};
  const center={id:'0,0',chunkX:0,chunkZ:0,chunkSize:16,minY:0,height:16,mesh,baseBlocksReady:true,gpuUploaded:true};
  const edge={id:'0,2',chunkX:0,chunkZ:2,chunkSize:16,minY:0,height:16,mesh:null,baseBlocksReady:false};
  const chunks={chunkSize:16,centerChunkX:0,centerChunkZ:0,viewDistance:1,chunks:new Map([[center.id,center],[edge.id,edge]])};
  const renderer={entryForChunk:()=>({mesh})};
  assert.equal(measurePlayWorldReadiness(chunks,renderer,camera).ready,true);
  camera.targetLocalOffsetZ=.001;
  assert.equal(measurePlayWorldReadiness(chunks,renderer,camera).ready,false,'rendered target-radius edge cannot be treated as preload');
  edge.mesh=mesh;edge.baseBlocksReady=true;edge.gpuUploaded=true;
  assert.equal(measurePlayWorldReadiness(chunks,renderer,camera).ready,true);
});
