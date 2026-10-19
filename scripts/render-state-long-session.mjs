// Controlled two-client state/mesh/camera endurance. Never submits transactions.
// Run from an immutable source copy. DURATION_MS defaults to 60 real minutes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ChunkManager } from "../chunk.js/chunk/chunk-manager.js";
import { createCameraState, cameraForward } from "../chunk.js/renderer/camera.js";
import { createPlayerMotionController } from "../play/player-motion-controller.js";
import { createNiceChunkGuardianClient } from "../play/play-guardian-client.js";
import { getChunkSnapshotApplyBudget } from "../play/play-chain-apply-budget.js";
import { importHostChunkSync } from "../play/tests/host-sync-module.mjs";
import { actualFaces, expectedFaces } from "../chunk.js/tests/helpers/face-oracle.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const evidence=resolve(process.env.EVIDENCE_DIR || join(root,"evidence/state-long-session"));
const durationMs=Math.max(1000,Number(process.env.DURATION_MS)||3600000);
const smoke=durationMs<3600000;
const tickMs=Math.max(1,Number(process.env.TICK_MS)||1000/30);
const seed="nicechunk-mainnet-001";
const stageMs=smoke?Math.max(1500,durationMs/4):30000;
const editMs=smoke?Math.max(400,durationMs/16):5000;
const nearTtl=smoke?Math.max(500,durationMs/8):15000;
const output=(name,value)=>writeFile(join(evidence,name),JSON.stringify(value,null,2));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
await mkdir(evidence,{recursive:true});
const {createPlayChainChunkDeltaSync}=await importHostChunkSync();
const manifest={};
async function captureSources(directory,target=manifest){for(const entry of await readdir(directory,{withFileTypes:true})){if(["node_modules",".git","evidence","dist"].includes(entry.name))continue;const path=join(directory,entry.name);if(entry.isDirectory())await captureSources(path,target);else if(/\.(m?js|json)$/.test(entry.name)){const relative=path.slice(root.length+1);target[relative]=createHash("sha256").update(await readFile(path)).digest("hex");}}}
for(const dir of ["play","chunk.js","sdk","scripts"])await captureSources(join(root,dir));
const sourceDigest=createHash("sha256").update(JSON.stringify(manifest,Object.keys(manifest).sort())).digest("hex");
await output("source-manifest.json",{sourceDigest,files:manifest});

let slot=100,guardianProcess=null,guardianPort=null,serverLog="",running=true;
const authority=new Map(),clients=[],edits=new Map(),frameTimes=[],applyTimes=[],applyBudgetTimes=[],recentEvents=[],targetCoverage=new Map(),convergedMissedEdits=new Set();
const EVENT_HISTORY_LIMIT=8192;
const targetEvents=[];
let eventHistoryHead=0,targetEventHistoryHead=0,interruptedSignal=null;
const metrics={scope:"Two real ChunkManagers, actual host authority synchronizer and camera modules; controlled atomic RPC accounts, optional real loopback Guardian. CPU mesh/face oracle only; no GPU render or production chain.",sourceDigest,smoke,requestedDurationMs:durationMs,targetTickMs:tickMs,targetTicksPerSecond:1000/tickMs,applyBudgetPolicy:"Production getChunkSnapshotApplyBudget, moving=true, per-client real interval; <=4ms and <=16384 preparation entries",seed,frames:0,rpcReads:0,edits:0,digs:0,backfills:0,missedAuthorityEdits:0,missedEventsConverged:0,guardianEvents:0,guardianReconnects:0,cameraChecks:0,oracleChecks:0,convergenceChecks:0,maxDirtyAgeMs:0,maxApplySliceMs:0,maxTickMs:0,maxConfiguredPreparationEntries:0,maxConfiguredDeltas:0,applySlices:0,warmupApplySlices:0,maxWarmupApplySliceMs:0,atomicSnapshotsChecked:0,atomicSnapshotsByClient:[0,0],bulkUpdates:0,seenViews:[2],failures:[],heapPeakBytes:0};
function quantiles(values){const sorted=[...values].sort((a,b)=>a-b),at=q=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))]??null;return{samples:sorted.length,p50:at(.5),p95:at(.95),p99:at(.99),max:sorted.at(-1)??null};}
function storeTargetEvent(event){if(targetEvents.length<EVENT_HISTORY_LIMIT)targetEvents.push(event);else{targetEvents[targetEventHistoryHead]=event;targetEventHistoryHead=(targetEventHistoryHead+1)%EVENT_HISTORY_LIMIT;}}
function traceTarget(type,detail){storeTargetEvent({type,elapsedMs:startedAt?Date.now()-startedAt:null,...detail});}
function trace(type,detail){const event={type,elapsedMs:startedAt?Date.now()-startedAt:null,...detail};if(recentEvents.length<EVENT_HISTORY_LIMIT)recentEvents.push(event);else{recentEvents[eventHistoryHead]=event;eventHistoryHead=(eventHistoryHead+1)%EVENT_HISTORY_LIMIT;}if(type==="edit")storeTargetEvent(event);}
function orderedRecentEvents(){return eventHistoryHead?[...recentEvents.slice(eventHistoryHead),...recentEvents.slice(0,eventHistoryHead)]:recentEvents;}
function orderedTargetEvents(){return targetEventHistoryHead?[...targetEvents.slice(targetEventHistoryHead),...targetEvents.slice(0,targetEventHistoryHead)]:targetEvents;}
function clientDiagnostic(client){return{id:client.id,online:client.online,view:client.view,centerChunkX:client.chunks.centerChunkX,centerChunkZ:client.chunks.centerChunkZ,sync:client.sync.snapshot(),targets:targets.map(target=>{const chunk=client.chunks.chunks.get(`${Math.floor(target.worldX/16)},${Math.floor(target.worldZ/16)}`);return{...target,blockId:client.chunks.getBlockAtWorld(target.worldX,target.worldY,target.worldZ),authorityBlockId:authority.get(chunk?.id)?.get(key(target.worldX,target.worldY,target.worldZ))?.blockId??null,distanceChunks:chunk?Math.max(Math.abs(chunk.chunkX-client.chunks.centerChunkX),Math.abs(chunk.chunkZ-client.chunks.centerChunkZ)):null,chunkId:chunk?.id,chainRevision:chunk?.chainRevision,version:chunk?.version,authorityInputRevision:chunk?.authorityInputRevision,inputRevision:chunk?.inputRevision,chainSnapshotToken:chunk?.chainSnapshotToken,chainSnapshotSlot:chunk?.chainSnapshotSlot,chainDeltas:chunk?.chainDeltas.size,pendingDeltas:chunk?.pendingDeltas.size,remoteDeltas:chunk?.remoteDeltas.size,confirmedDeltaProtection:chunk?.confirmedDeltaProtection.size};})};}
function key(x,y,z){return `${x}:${y}:${z}`;}
function storeEdit(edit){const cx=Math.floor(edit.worldX/16),cz=Math.floor(edit.worldZ/16),id=`${cx},${cz}`;let map=authority.get(id);if(!map)authority.set(id,map=new Map());map.set(key(edit.worldX,edit.worldY,edit.worldZ),edit);}
// L/zig passage through five default horizontal chunks. The full height remains
// -32..320; no PDA, voxel semantics or permanent account format is changed.
for(let x=2;x<=29;x++)for(let z=6;z<=8;z++)for(let y=-17;y<=-12;y++)storeEdit({worldX:x,worldY:y,worldZ:z,blockId:0});
for(let x=27;x<=29;x++)for(let z=6;z<=35;z++)for(let y=-17;y<=-12;y++)storeEdit({worldX:x,worldY:y,worldZ:z,blockId:0});
for(let x=27;x<=45;x++)for(let z=33;z<=35;z++)for(let y=-17;y<=-12;y++)storeEdit({worldX:x,worldY:y,worldZ:z,blockId:0});
const targets=[[15,-14,9],[16,-14,9],[26,-14,15],[26,-14,16],[15,-13,9],[16,-13,9],[26,-13,15],[26,-13,16]].map(([worldX,worldY,worldZ])=>({worldX,worldY,worldZ}));
const targetChunkIds=new Set(targets.map(target=>`${Math.floor(target.worldX/16)},${Math.floor(target.worldZ/16)}`));
function rpcRecord(info,target,placed){
  if(!info)return null;
  const data=info.data,view=new DataView(data.buffer,data.byteOffset,data.byteLength),stride=placed?9:3,packed=(target.worldX&15)|((target.worldZ&15)<<4)|((target.worldY+32)<<8);
  for(let i=0;i<view.getUint16(6,true);i++){const offset=16+i*stride,found=data[offset]|(data[offset+1]<<8)|(data[offset+2]<<16);if(found===packed)return placed?view.getUint16(offset+3,true):0;}
  return null;
}
function recordTargetRpc(client,keys,values,snapshotSlot){
  for(const id of new Set(keys.map(pda=>pda.split(":")[1]).filter(id=>targetChunkIds.has(id)))){
    const broken=values[keys.indexOf(`broken:${id}`)],placed=values[keys.indexOf(`placed:${id}`)];
    traceTarget("target-rpc",{clientId:client.id,chunkId:id,slot:snapshotSlot,centerChunkX:client.chunks.centerChunkX,centerChunkZ:client.chunks.centerChunkZ,targets:targets.filter(target=>`${Math.floor(target.worldX/16)},${Math.floor(target.worldZ/16)}`===id).map(target=>{const brokenBlockId=rpcRecord(broken,target,false),placedBlockId=rpcRecord(placed,target,true);return{...target,brokenBlockId,placedBlockId,decodedBlockId:placedBlockId??brokenBlockId};})});
  }
}
function observeTargetPreparations(client){
  const observed=new WeakSet(),preparationIds=new WeakMap(),manager=client.chunks,ensure=manager.ensureChunk.bind(manager),commit=manager.commitPreparedChainSnapshotForChunk.bind(manager);let serial=0;
  function observe(chunk){
    if(observed.has(chunk)||!targetChunkIds.has(chunk.id)&&chunk.id!=="-2,-2")return chunk;
    observed.add(chunk);const original=chunk.prepareChainSnapshot;
    chunk.prepareChainSnapshot=function(deltas=[],options={}){
      const preparation=original.call(this,deltas,options),taskId=++serial,step=preparation.step;let processed=0;
      preparationIds.set(preparation,taskId);
      traceTarget("prepare-start",{clientId:client.id,chunkId:chunk.id,taskId,token:options.snapshotToken,slot:options.snapshotSlot,source:options.source,chainRevision:chunk.chainRevision,worldVersion:chunk.version,authorityInputRevision:chunk.authorityInputRevision,inputRevision:chunk.inputRevision,preparationInputRevision:preparation.inputRevision,deltaCount:deltas instanceof Int32Array?deltas.length/4:deltas?.length??0});
      preparation.step=function(stepOptions){const result=step.call(this,stepOptions);processed+=result.processed;traceTarget("prepare-step",{clientId:client.id,chunkId:chunk.id,taskId,token:options.snapshotToken,processed:result.processed,totalProcessed:processed,done:result.done,reason:preparation.result?.reason??null,chainRevision:chunk.chainRevision,worldVersion:chunk.version,authorityInputRevision:chunk.authorityInputRevision,inputRevision:chunk.inputRevision,preparationInputRevision:preparation.inputRevision});return result;};
      return preparation;
    };
    return chunk;
  }
  manager.ensureChunk=(...args)=>observe(ensure(...args));
  manager.commitPreparedChainSnapshotForChunk=(id,preparation)=>{const result=commit(id,preparation),chunkId=typeof id==="string"?id:`${id?.chunkX??0},${id?.chunkZ??0}`;if(targetChunkIds.has(chunkId)||chunkId==="-2,-2")traceTarget("snapshot-commit",{clientId:client.id,chunkId,taskId:preparationIds.get(preparation),authorityInputRevision:preparation.chunk?.authorityInputRevision,inputRevision:preparation.inputRevision,token:preparation.options.snapshotToken,slot:preparation.options.snapshotSlot,result:{applied:result?.applied,changed:result?.changed,reason:result?.reason,deltaCount:result?.deltaCount,chainRevision:result?.chainRevision,snapshotToken:result?.snapshotToken,retainedUnobserved:result?.retainedUnobserved},centerChunkX:manager.centerChunkX,centerChunkZ:manager.centerChunkZ});return result;};
  for(const chunk of manager.chunks.values())observe(chunk);
}
function account(records,placed){if(!records.length)return null;const stride=placed?9:3,data=new Uint8Array(16+records.length*stride),view=new DataView(data.buffer);data.set(new TextEncoder().encode(placed?"NCPB":"NCBK"));data[4]=1;view.setUint16(6,records.length,true);view.setUint16(8,records.length,true);view.setInt16(10,-32,true);records.forEach((d,i)=>{const packed=(d.worldX&15)|((d.worldZ&15)<<4)|((d.worldY+32)<<8),o=16+i*stride;data[o]=packed&255;data[o+1]=packed>>>8&255;data[o+2]=packed>>>16&255;if(placed){view.setUint16(o+3,d.blockId,true);view.setUint32(o+5,1,true);}});return{data,owner:"program",executable:false};}
function rpcModule(client){return{isNicechunkChainSyncEnabled:()=>true,getNicechunkConnection:()=>({rpcEndpoint:"",getMultipleAccountsInfo(){},async getMultipleAccountsInfoAndContext(keys){if(!client.online)throw Error("controlled offline client");metrics.rpcReads++;const snapshotSlot=slot;const values=keys.map(pda=>{const [kind,id]=pda.split(":"),records=[...(authority.get(id)?.values()||[])].filter(d=>kind==="broken"?d.blockId===0:d.blockId!==0);return account(records,kind==="placed");});trace("rpc",{clientId:client.id,slot:snapshotSlot,keys,recordCounts:values.map(value=>value?new DataView(value.data.buffer).getUint16(6,true):0)});recordTargetRpc(client,keys,values,snapshotSlot);return{value:values,context:{slot:snapshotSlot}};}}),deriveGameChunkBrokenPda:(x,z)=>[`broken:${x},${z}`],deriveGameChunkPlacedPda:(x,z)=>[`placed:${x},${z}`],getChunkBrokenPdaDerivationConfig:()=>({seed:"broken",placedSeed:"placed",globalConfig:"global",programId:"program"})};}
async function poll(client,force=false){
  if(!client.online)return;
  if(force)client.sync.invalidateFreshness({reason:"controlled-reconnect"});
  await client.sync.syncLoadedChunks();
  const pollApplyAt=performance.now(),frameIntervalMs=client.warmup||client.lastApplyAt==null?null:pollApplyAt-client.lastApplyAt;
  if(!client.warmup)client.lastApplyAt=pollApplyAt;
  const applyBudget=client.warmup?{budgetMs:1,maxDeltas:64,maxPreparationEntries:8192}:getChunkSnapshotApplyBudget({moving:true,frameIntervalMs});
  for(let n=0;n<(client.warmup?1024:1)&&client.sync.snapshot().pendingSnapshots;n++){
    const beforeRevision=client.chunks.chunks.get("-2,-2")?.chainRevision;
    const before=client.sync.snapshot(),at=performance.now();const result=client.sync.applyQueuedDeltas(applyBudget);
    const sliceMs=performance.now()-at;
    if(client.warmup){metrics.maxWarmupApplySliceMs=Math.max(metrics.maxWarmupApplySliceMs,sliceMs);metrics.warmupApplySlices++;}
    else{const{elapsedMs:applyElapsedMs,...progress}=result;metrics.maxApplySliceMs=Math.max(metrics.maxApplySliceMs,sliceMs);metrics.maxConfiguredPreparationEntries=Math.max(metrics.maxConfiguredPreparationEntries,applyBudget.maxPreparationEntries);metrics.maxConfiguredDeltas=Math.max(metrics.maxConfiguredDeltas,applyBudget.maxDeltas);metrics.applySlices++;applyTimes.push(sliceMs);applyBudgetTimes.push(applyBudget.budgetMs);trace("apply",{clientId:client.id,beforePending:before.pendingSnapshots,beforePrepared:before.preparedEntries,...progress,frameIntervalMs,configuredBudget:applyBudget,applyElapsedMs,sliceMs,targets:clientDiagnostic(client).targets});}
    const bulk=client.chunks.chunks.get("-2,-2"),count=bulk?.chainDeltas.size??0;
    assert.ok(count===0||count===4096,`partial authority snapshot became visible: ${count}`);
    if(bulk?.chainRevision!==beforeRevision&&count===4096){
      assert.equal(bulk.getFinalBlock(0,-16,0),0);
      assert.equal(bulk.getFinalBlock(15,-1,15),authority.get("-2,-2").get(key(-17,-1,-17)).blockId);
      for(const map of [bulk.renderDeltaColumns,bulk.renderDeltaSections])if(map)assert.equal([...map.values()].reduce((sum,column)=>sum+column.size,0),4096,"delta indexes must atomically match the complete final snapshot");
      metrics.atomicSnapshotsChecked++;
      metrics.atomicSnapshotsByClient[client.id]++;
    }
  }
}
function compareSection(client,chunk,section){const view={chunkX:chunk.chunkX,chunkZ:chunk.chunkZ,chunkSize:16,minY:section.originY,height:section.height,getFinalBlock:chunk.getFinalBlock.bind(chunk)};const got=actualFaces(section.mesh),want=expectedFaces(view,(...p)=>client.chunks.getBlockAtWorld(...p));const missing=[...want.keys()].filter(k=>!got.has(k)),extra=[...got.keys()].filter(k=>!want.has(k));assert.equal(missing.length,0,`client ${client.id} missing ${chunk.id}@${section.sectionIndex}: ${missing.slice(0,10)}`);assert.equal(extra.length,0,`client ${client.id} extra ${chunk.id}@${section.sectionIndex}: ${extra.slice(0,10)}`);metrics.oracleChecks++;}
function checkCamera(client){const eye=client.motion.cameraWorldFloat(),f=cameraForward(client.camera),h=Math.hypot(f[0],f[2]),r=h>1e-6?[f[2]/h,0,-f[0]/h]:[1,0,0],u=[-f[1]*r[2],f[2]*r[0]-f[0]*r[2],f[1]*r[0]],hh=client.camera.near*Math.tan(client.camera.fov*Math.PI/360),hw=hh*client.camera.aspect;assert.equal(client.camera.cameraSafety?.safe,true,"camera must have a legal volume anchor");for(const p of[eye,...[-1,1].flatMap(sx=>[-1,1].map(sy=>eye.map((v,i)=>v+f[i]*client.camera.near+r[i]*hw*sx+u[i]*hh*sy)))])assert.equal(client.chunks.isCameraOccluderAtWorld(...p.map(Math.floor)),false,`camera clipped at ${p}`);metrics.cameraChecks++;}
async function startGuardian(){const binary=process.env.NICECHUNK_GUARDIAN_TEST_BIN;if(!binary)return;metrics.guardianExecutableSha256=createHash("sha256").update(await readFile(binary)).digest("hex");const reserve=net.createServer();await new Promise(done=>reserve.listen(0,"127.0.0.1",done));guardianPort=reserve.address().port;await new Promise(done=>reserve.close(done));guardianProcess=spawn(binary,["--host","127.0.0.1","--port",String(guardianPort),"--no-tui"],{stdio:["ignore","pipe","pipe"]});guardianProcess.stdout.on("data",data=>{if(serverLog.length<64000)serverLog+=data;});guardianProcess.stderr.on("data",data=>{if(serverLog.length<64000)serverLog+=data;});for(let n=0;n<100;n++){if(guardianProcess.exitCode!==null)throw Error(`loopback Guardian exited: ${serverLog}`);const ok=await new Promise(done=>{const socket=net.connect(guardianPort,"127.0.0.1");socket.once("connect",()=>{socket.destroy();done(true);});socket.once("error",()=>done(false));});if(ok)return;await sleep(20);}throw Error("loopback Guardian did not bind");}
function connectGuardian(client){if(!guardianPort)return;if(!client.guardian){const wallets=["6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7","CHZHsBCGn58ih2WrPfKSYhvCEjMPGhArTiYCH7AWWBkB"];client.guardian=createNiceChunkGuardianClient({walletAddress:wallets[client.id],url:`ws://127.0.0.1:${guardianPort}/ws`,autoReconnect:false,onReady:()=>{metrics.guardianReconnects++;client.sync.invalidateFreshness({reason:"guardian-connect"});},onDig:event=>{metrics.guardianEvents++;client.chunks.applyRemoteDelta([{worldX:event.x,worldY:event.y,worldZ:event.z,blockId:0}]);client.sync.invalidateChunkForWorld(event.x,event.z);},onProtocolError:error=>metrics.failures.push({type:"guardian-protocol",error:String(error)})});}client.guardian.connect({position:{x:3.5,y:-17,z:7.5}});}
function poseAt(elapsed,id){let s=((elapsed/1000*8+id*3)%140);if(s>70)s=140-s;let x,z,yaw;if(s<=25){x=3.5+s;z=7.5;yaw=-Math.PI/2;}else if(s<=51){x=28.5;z=7.5+s-25;yaw=Math.PI;}else{x=28.5+s-51;z=33.5;yaw=-Math.PI/2;}return{x:Math.min(44.5,x),y:-17,z,yaw};}
async function changeView(client,distance){client.chunks.setViewDistance(distance,{preloadMargin:1});client.chunks.unloadFarChunks(client.chunks.centerChunkX,client.chunks.centerChunkZ);client.sync.invalidateFreshness({reason:"view-distance"});if(!metrics.seenViews.includes(distance))metrics.seenViews.push(distance);}
let startedAt=0,lastSample=-Infinity,lastEdit=-Infinity,lastTick=0,lastViewAt=0,viewIndex=0,lastBulkAt=-Infinity;
const warmupStartedAt=Date.now();
for(const signal of["SIGTERM","SIGINT"])process.once(signal,()=>{interruptedSignal=signal;running=false;});
try{
  globalThis.window=globalThis;
  await startGuardian();
  for(let id=0;id<2;id++){
    const chunks=new ChunkManager({worldSeed:seed,minY:-32,height:353,viewDistance:2,useWorkers:false});
    for(const chunkId of authority.keys()){const[x,z]=chunkId.split(",").map(Number);chunks.ensureChunk(x,z);}
    const player={worldX:3,worldY:-17,worldZ:7,localOffsetX:.5,localOffsetY:0,localOffsetZ:.5,controlYaw:-Math.PI/2,cameraPitch:-.4};
    const camera=createCameraState({aspect:id?9/19:16/9});
    const client={id,chunks,player,camera,online:true,warmup:true,lastRecoveredAt:Date.now(),view:2,lastOracleAt:-Infinity};
    observeTargetPreparations(client);
    client.motion=createPlayerMotionController({getPlayer:()=>player,getCamera:()=>camera,getChunks:()=>chunks,isMobileViewport:()=>id===1});
    client.sync=createPlayChainChunkDeltaSync({chunks,loadChainModule:async()=>rpcModule(client),persistentCache:{async getVerifiedSnapshots(){return[];},async putVerifiedSnapshots(){}},freshnessTtlMs:{near:nearTtl,middle:nearTtl*3,far:nearTtl*8}});
    clients.push(client);await poll(client,true);connectGuardian(client);
  }
  // Load and verify the initial near view before warming all its mesh sections.
  // Later range changes, cold chunks and edits remain inside the timed session.
  const meshWarmupStartedAt=Date.now();
  for(const client of clients){
    client.chunks.updatePlayerPosition(3.5,-17,7.5);
    await poll(client,true);
    assert.equal(client.sync.snapshot().pendingSnapshots,0,"initial RPC snapshots must finish before endurance timing");
    const deadline=Date.now()+120000;
    let passes=0;
    while([...client.chunks.chunks.values()].some(chunk=>chunk.dirty)&&Date.now()<deadline){client.chunks.rebuildDirtyChunks(4);if(++passes%8===0)await sleep(0);}
    assert.equal([...client.chunks.chunks.values()].some(chunk=>chunk.dirty),false,"initial view mesh warmup did not complete");
    client.motion.syncCameraToPlayer(1/30,{force:true});checkCamera(client);
  }
  metrics.warmup={elapsedMs:Date.now()-warmupStartedAt,meshAndInitialViewMs:Date.now()-meshWarmupStartedAt,clients:clients.map(client=>({id:client.id,chunks:client.chunks.chunks.size,sections:[...client.chunks.chunks.values()].reduce((count,chunk)=>count+(chunk.renderSections?.size??0),0)}))};
  for(const client of clients){client.warmup=false;client.lastApplyAt=null;}
  startedAt=Date.now();lastTick=startedAt;
  metrics.actualStartedAt=new Date(startedAt).toISOString();
  await output("started.json",{...metrics,startedAt:new Date(startedAt).toISOString(),guardianLoopback:Boolean(guardianPort),ttlMs:nearTtl});
  while(running&&Date.now()-startedAt<durationMs){
    const tickStart=performance.now(),now=Date.now(),elapsed=now-startedAt,dt=Math.min(.25,(now-lastTick)/1000);lastTick=now;
    if(elapsed-lastViewAt>=stageMs){viewIndex=(viewIndex+1)%3;lastViewAt=elapsed;}
    const view=[2,7,20][viewIndex];
    if(guardianProcess&&guardianProcess.exitCode!==null)throw Error(`loopback Guardian stopped during the session: ${serverLog}`);
    for(const client of clients){if(client.view!==view){client.view=view;await changeView(client,view);}const offline=client.id===1&&Math.floor(elapsed/(stageMs*2))%2===1&&elapsed%(stageMs*2)<Math.min(10000,stageMs/2);if(client.online===offline){client.online=!offline;client.lastApplyAt=null;if(offline){client.guardian?.disconnect();client.sync.cancelActiveSync?.();}else{client.lastRecoveredAt=now;client.sync.invalidateFreshness({reason:"guardian-connect"});connectGuardian(client);}}}
    if(elapsed-lastBulkAt>=(smoke?Math.max(5000,durationMs/2):120000)){
      lastBulkAt=elapsed;
      const id="-2,-2",records=new Map();
      for(let index=0;index<4096;index++){
        const edit={worldX:-32+index%16,worldY:-16+Math.floor(index/256),worldZ:-32+Math.floor(index/16)%16,blockId:index<2048?0:(metrics.bulkUpdates%2?14:3)};
        records.set(key(edit.worldX,edit.worldY,edit.worldZ),edit);
      }
      authority.set(id,records);slot++;metrics.bulkUpdates++;
      for(const client of clients)client.sync.invalidateChunkForWorld(-24,-24);
    }
    if(elapsed-lastEdit>=editMs){lastEdit=elapsed;const editIndex=metrics.edits,target=targets[editIndex%targets.length],targetKey=key(target.worldX,target.worldY,target.worldZ),prior=edits.get(targetKey),dig=!prior||prior.blockId!==0,blockId=dig?0:3,edit={...target,blockId},writer=clients[editIndex%2].online?clients[editIndex%2]:clients[0],txId=`controlled-${editIndex}`,missedByClient1=!clients[1].online;storeEdit(edit);slot++;edits.set(targetKey,{...edit,at:now,missedByClient1});if(missedByClient1)metrics.missedAuthorityEdits++;const coverage=targetCoverage.get(targetKey)||{digs:0,backfills:0};coverage[dig?"digs":"backfills"]++;targetCoverage.set(targetKey,coverage);trace("edit",{...edit,writer:writer.id,missedByClient1});writer.chunks.applyPendingDelta([edit],txId);writer.chunks.confirmPendingDelta(txId,{slot,commitment:"confirmed"});writer.sync.invalidateChunkForWorld(edit.worldX,edit.worldZ);if(dig&&writer.guardian?.isReady())writer.guardian.sendDig({x:edit.worldX,y:edit.worldY,z:edit.worldZ,action:3});metrics.edits++;metrics[dig?"digs":"backfills"]++;}
    for(const client of clients){await poll(client);const pose=poseAt(elapsed,client.id);client.motion.setPlayerWorldFloat(pose.x,pose.y,pose.z);client.player.controlYaw=pose.yaw;client.chunks.updatePlayerPosition(pose.x,pose.y,pose.z);client.chunks.rebuildDirtyChunks(4);client.guardian?.updateLocalPlayer({x:pose.x,y:pose.y,z:pose.z,yaw:pose.yaw,pitch:0},now);if(metrics.frames%300===0)client.motion.toggleFirstPersonCamera();assert.equal(client.motion.playerCollidesAt(pose.x,pose.y,pose.z),false,"pre-carved test path must remain legal");client.motion.syncCameraToPlayer(dt);checkCamera(client);const chunk=client.chunks.chunks.get(`${Math.floor(pose.x/16)},${Math.floor(pose.z/16)}`),section=chunk?.renderSections?.get(1);if(section?.dirty&&section.oldestDirtyAt!=null)metrics.maxDirtyAgeMs=Math.max(metrics.maxDirtyAgeMs,performance.now()-section.oldestDirtyAt);if(section?.mesh&&!section.dirty&&now-client.lastOracleAt>=1000){compareSection(client,chunk,section);client.lastOracleAt=now;}for(const edit of edits.values()){if(!client.online||now-client.lastRecoveredAt<nearTtl||now-edit.at<nearTtl+5000)continue;const local=client.chunks.getBlockAtWorld(edit.worldX,edit.worldY,edit.worldZ);assert.equal(local,edit.blockId,`client ${client.id} did not converge after near TTL at ${key(edit.worldX,edit.worldY,edit.worldZ)}`);metrics.convergenceChecks++;if(client.id===1&&edit.missedByClient1&&!convergedMissedEdits.has(edit.at)){convergedMissedEdits.add(edit.at);metrics.missedEventsConverged++;}}}
    metrics.frames++;const tickElapsedMs=performance.now()-tickStart;metrics.maxTickMs=Math.max(metrics.maxTickMs,tickElapsedMs);frameTimes.push(tickElapsedMs);metrics.heapPeakBytes=Math.max(metrics.heapPeakBytes,process.memoryUsage().heapUsed);
    if(elapsed-lastSample>=30000){lastSample=elapsed;const sorted=[...frameTimes].sort((a,b)=>a-b),p=q=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))]??null;const sample={elapsedMs:Date.now()-startedAt,...metrics,clients:clients.map(c=>({id:c.id,online:c.online,chunks:c.chunks.chunks.size,sections:[...c.chunks.chunks.values()].reduce((n,ch)=>n+(ch.renderSections?.size??0),0),sync:c.sync.snapshot(),camera:{...c.camera.cameraSafety}})),cpuTickMs:{p50:p(.5),p95:p(.95),p99:p(.99)}};await appendFile(join(evidence,"samples.jsonl"),JSON.stringify(sample)+"\n");console.log(JSON.stringify({elapsedMs:sample.elapsedMs,frames:metrics.frames,edits:metrics.edits,oracleChecks:metrics.oracleChecks,cameraChecks:metrics.cameraChecks,rpcReads:metrics.rpcReads,guardianEvents:metrics.guardianEvents,heap:metrics.heapPeakBytes}));}
    await sleep(Math.max(1,tickMs-(performance.now()-tickStart)));
  }
  if(interruptedSignal){await output("interrupted.json",{...metrics,status:"intentionally_interrupted",signal:interruptedSignal,interruptedAt:new Date().toISOString(),elapsedMs:Date.now()-startedAt,complete60Minutes:false,clients:clients.map(clientDiagnostic),recentEvents:orderedRecentEvents(),targetEvents:orderedTargetEvents()});process.exitCode=interruptedSignal==="SIGTERM"?143:130;}
  else{
  assert.equal(metrics.failures.length,0,"Guardian protocol errors must fail the session");
  assert.ok(metrics.oracleChecks>0&&metrics.cameraChecks>0&&metrics.digs>0,"the run must exercise state, geometry and camera checks");
  metrics.timedElapsedMs=Date.now()-startedAt;
  metrics.observedTicksPerSecond=metrics.frames/(metrics.timedElapsedMs/1000);
  metrics.cpuTickMs=quantiles(frameTimes);metrics.applySliceMs=quantiles(applyTimes);metrics.configuredApplyBudgetMs=quantiles(applyBudgetTimes);metrics.targetCoverage=Object.fromEntries(targetCoverage);
  if(!smoke){
    assert.equal(metrics.seenViews.length,3);assert.ok(metrics.backfills>0&&metrics.convergenceChecks>0);
    assert.ok(metrics.atomicSnapshotsByClient.every(count=>count>=1),"both clients must commit a complete 4096-entry authority snapshot");
    assert.ok(metrics.digs>=30&&metrics.backfills>=30,"the formal session must repeatedly dig and refill");
    for(const target of targets){const coverage=targetCoverage.get(key(target.worldX,target.worldY,target.worldZ));assert.ok(coverage?.digs>=10&&coverage?.backfills>=10,"every target must be dug and refilled at least ten times");}
    assert.ok(metrics.missedAuthorityEdits>0&&metrics.missedEventsConverged>0,"missed events must recover from authority after reconnect");
    if(guardianPort)assert.ok(metrics.guardianEvents>0&&metrics.guardianReconnects>2);
    for(const client of clients){client.online=true;client.sync.invalidateFreshness({reason:"final-authority-check"});}
    const deadline=Date.now()+20000;
    let converged=false;
    while(Date.now()<deadline){
      for(const client of clients){await poll(client);client.chunks.rebuildDirtyChunks(4);}
      converged=clients.every(client=>[...edits.values()].every(edit=>client.chunks.getBlockAtWorld(edit.worldX,edit.worldY,edit.worldZ)===edit.blockId)
        &&client.chunks.chunks.get("-2,-2")?.chainDeltas.size===4096);
      if(converged)break;
      await sleep(tickMs);
    }
    assert.equal(converged,true,"both clients must converge to the final controlled authority after edits stop");
    metrics.finalAuthorityConverged=true;
  }
  const finalManifest={};for(const dir of["play","chunk.js","sdk","scripts"])await captureSources(join(root,dir),finalManifest);
  const finalSourceDigest=createHash("sha256").update(JSON.stringify(finalManifest,Object.keys(finalManifest).sort())).digest("hex");assert.equal(finalSourceDigest,sourceDigest,"the frozen source must remain unchanged throughout the session");
  metrics.sourceManifestVerifiedAfterRun=true;
  await output("source-manifest-after.json",{sourceDigest:finalSourceDigest,files:finalManifest});
  await output("recent-events.json",orderedRecentEvents());
  await output("target-events.json",orderedTargetEvents());
  await output("summary.json",{...metrics,elapsedMs:Date.now()-startedAt,complete60Minutes:!smoke&&metrics.timedElapsedMs>=3600000,guardianLoopback:Boolean(guardianPort),productionChain:false,gpuRender:false});
  }
}catch(error){metrics.failures.push({message:String(error.stack||error),elapsedMs:startedAt?Date.now()-startedAt:0});await output("failure.json",{...metrics,reproduction:{targets:[...edits.values()],sourceDigest},clients:clients.map(clientDiagnostic),recentEvents:orderedRecentEvents(),targetEvents:orderedTargetEvents(),serverLog});process.exitCode=1;}
finally{running=false;for(const client of clients){client.guardian?.disconnect();client.sync.cancelActiveSync?.();client.chunks.dispose();}if(guardianProcess){guardianProcess.kill("SIGTERM");await new Promise(done=>{if(guardianProcess.exitCode!==null)done();else guardianProcess.once("exit",done);});}await output("cleanup.json",{clients:clients.length,sourceDigest,elapsedMs:startedAt?Date.now()-startedAt:0});}
