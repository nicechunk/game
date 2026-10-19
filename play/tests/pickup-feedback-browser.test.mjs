import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

test('native pickup pulse covers the real pebble, preserves hand selection, and releases on rollback/confirmation/context recovery',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/pickup-feedback-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0"><canvas style="width:640px;height:360px"></canvas>'}));
  await page.goto((process.env.NICECHUNK_TEST_ORIGIN||'http://127.0.0.1:4182')+'/pickup-feedback-fixture');
  const result=await page.evaluate(async()=>{
   Object.defineProperty(performance,'now',{value:()=>10000});
   const {ChunkManager,blockDef,terrainSurfaceHeight}=await import('/chunk.js/play.js');
   const {DEFAULT_SURFACE_DECORATION_RULES}=await import('/chunk.js/world/surface-decoration-rules.js');
   const {createPlaySurfaceDecorationSync}=await import('/play/play-surface-decoration-sync.js');
   const {createMiningController}=await import('/play/mining-controller.js');
   const {createPlayGameState}=await import('/play/game-state.js');
   const {createActionOverlayBuilder}=await import('/play/play-action-overlays.js');
   const {WebGL2VoxelRenderer}=await import('/chunk.js/renderer/webgl2-renderer.js');
   const {createCameraState,cameraViewProjection,cameraOrigin}=await import('/chunk.js/renderer/camera.js');
   const {createSurfaceDecorationPreviewMesh}=await import('/chunk.js/chunk/chunk-mesher.js');
   const {PLAY_RENDER_OPTIONS}=await import('/play/play-render-options.js');
   const {STARTER_AXE_BYTES}=await import('/src/data/starterTools.js');
   const {setForgedItemRuntime}=await import('/play/forged-item-interaction.js');
   const {createForgeRuntimeAsset}=await import('/chunk.js/forge/forge-runtime-cache.js');
   const {decodeNcf1}=await import('/chunk.js/forge/forge-core.js');
   const check=(ok,message)=>{if(!ok)throw Error(message);};
   const manager=new ChunkManager({useWorkers:false,viewDistance:1,preloadMargin:0,shadows:false,surfaceDecorationRules:DEFAULT_SURFACE_DECORATION_RULES});
   const chunk=manager.ensureChunk(63,61);manager.rebuildDirtyChunks(10000);
   const sync=createPlaySurfaceDecorationSync({chunks:manager,worldSeed:'nicechunk-mainnet-001',initialRules:DEFAULT_SURFACE_DECORATION_RULES});
   let hit,plan;
   for(let z=976;z<992&&!plan;z++)for(let x=1008;x<1024&&!plan;x++){
    const y=terrainSurfaceHeight(manager.config,x,z),candidate={hit:true,worldX:x,worldY:y,worldZ:z,blockId:manager.getBlockAtWorld(x,y,z)};
    const p=sync.bareHandPlan(candidate);if(p?.kind==='surface-pebble'){hit=candidate;plan=p;}
   }
   check(plan?.surfaceDecoration,'verified world pebble fixture unavailable');
   const state=createPlayGameState();
   state.hotbarSlots[1]={itemId:'forged_item',kind:'forged',custodySource:'equipment',equipmentSlot:1,itemPda:'Axe111',bytes:[...STARTER_AXE_BYTES],durability:50,maxDurability:100};
   setForgedItemRuntime(state.hotbarSlots[1],createForgeRuntimeAsset(decodeNcf1(STARTER_AXE_BYTES,{requireCanonical:true})));
   state.selectHotbarSlot(3);
   const controller=createMiningController({gameState:state,chunks:manager,getHit:()=>hit,getBareHandPlan:sync.bareHandPlan,blockDef,
    isFluidBlock:()=>false,isMineableBlock:()=>true,blockAirId:0,onSurfacePicked:sync.markPicked,
    onChanged:()=>state.syncHotbarBackpackSlots({authoritative:true}),onConfirm:()=>state.mergeChainBackpackSlots([])});
   const builder=createActionOverlayBuilder({getMining:()=>controller,getChunks:()=>manager});
   const queue=()=>{const swing=controller.minePending();check(swing?.miningTool.kind==='bare-hands','selection switched before pickup');controller.update(swing.endsAt+1);check(controller.pendingCount()===1,'pickup did not queue');return controller.pendingTargets()[0];};
   let pending=queue();
   const highTime=Math.PI*.5/.0125,lowTime=Math.PI*1.5/.0125;
   const high=builder.build(null,highTime),body=high.find(o=>o.shape==='surface-decoration'),lines=high.filter(o=>o.shape!=='surface-decoration');
   check(body?.decoration.variantHash===plan.surfaceDecoration.variantHash,'world variant changed');
   const renderer=new WebGL2VoxelRenderer(document.querySelector('canvas'),{...PLAY_RENDER_OPTIONS,deferredChunkUploads:false,dpr:1,viewDistance:2,maxUploadCpuMs:10000});renderer.init();
   const camera=createCameraState({worldX:hit.worldX+1,localOffsetX:.2,worldY:hit.worldY+2,localOffsetY:.1,worldZ:hit.worldZ+1,localOffsetZ:.6,
    targetWorldX:hit.worldX,targetLocalOffsetX:.5,targetWorldY:hit.worldY+1,targetLocalOffsetY:.06,targetWorldZ:hit.worldZ,targetLocalOffsetZ:.5,fov:42,aspect:16/9,far:256});
   function draw(overlays){
    renderer.prepareChunksForRender([chunk],{maxUploads:512,cameraState:camera,allowBackgroundUploads:false});
    renderer.render(camera,[chunk],[],overlays);const gl=renderer.gl;gl.finish();
    check(gl.getError()===gl.NO_ERROR,'native GL submission error');
    const pixels=new Uint8Array(640*360*4);gl.readPixels(0,0,640,360,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;
   }
   const baseline=draw(lines),peak=draw(high),low=draw([...lines,builder.build(null,lowTime).find(o=>o.shape==='surface-decoration')]);
   const mesh=createSurfaceDecorationPreviewMesh(body.decoration),matrix=cameraViewProjection(camera),origin=cameraOrigin(camera);
   const bounds={minX:640,maxX:0,minY:360,maxY:0};
   for(const v of mesh.vertices){
    const p=v.p.map((n,i)=>Math.round(n*64)/64+[body.worldX-origin.worldX,body.worldY-origin.worldY,body.worldZ-origin.worldZ][i]);
    const x=matrix[0]*p[0]+matrix[4]*p[1]+matrix[8]*p[2]+matrix[12],y=matrix[1]*p[0]+matrix[5]*p[1]+matrix[9]*p[2]+matrix[13],w=matrix[3]*p[0]+matrix[7]*p[1]+matrix[11]*p[2]+matrix[15];
    const sx=(x/w*.5+.5)*640,sy=(y/w*.5+.5)*360;
    bounds.minX=Math.min(bounds.minX,sx);bounds.maxX=Math.max(bounds.maxX,sx);bounds.minY=Math.min(bounds.minY,sy);bounds.maxY=Math.max(bounds.maxY,sy);
   }
   let bodyPixels=0,outsidePixels=0,pulseDelta=0,brightnessDelta=0;
   for(let i=0;i<peak.length;i+=4){
    const changed=[0,1,2].some(c=>peak[i+c]!==baseline[i+c]);
    if(changed){const x=(i/4)%640,y=Math.floor(i/4/640);bodyPixels++;outsidePixels+=x<bounds.minX-2||x>bounds.maxX+2||y<bounds.minY-2||y>bounds.maxY+2;}
    for(let c=0;c<3;c++){pulseDelta+=Math.abs(peak[i+c]-low[i+c]);brightnessDelta+=peak[i+c]-baseline[i+c];}
   }
   check(bodyPixels>20&&brightnessDelta>1000,'pebble body did not brighten');check(outsidePixels===0,'flash leaked outside actual pebble bounds');check(pulseDelta>1000,'pebble body did not pulse');
   const cached=renderer.voxelOverlay.getPickupGeometry(body.decoration),bytes=renderer.voxelOverlay.pickupByteLength;
   for(let i=0;i<120;i++)check(renderer.voxelOverlay.getPickupGeometry(body.decoration)===cached,'geometry rebuilt every frame');
   check(renderer.voxelOverlay.pickupByteLength===bytes,'steady pulse increased GPU storage');
   controller.rollbackTx(pending.txId);check(builder.build(null,highTime).length===0,'failed pickup kept flashing');
   check(sync.bareHandPlan(hit)?.kind==='surface-pebble','failed pickup removed stone');
   pending=queue();
   const extension=renderer.gl.getExtension('WEBGL_lose_context');
   const lost=new Promise(resolve=>renderer.canvas.addEventListener('webglcontextlost',resolve,{once:true}));extension.loseContext();await lost;
   await new Promise(resolve=>setTimeout(resolve,50));
   const restored=new Promise(resolve=>renderer.canvas.addEventListener('webglcontextrestored',resolve,{once:true}));extension.restoreContext();await restored;
   const recovered=draw(builder.build(null,highTime));check(recovered.every((v,i)=>v===peak[i]),'restored pickup flash differs');
   for(let i=0;i<80;i++)renderer.voxelOverlay.getPickupGeometry({...body.decoration,variantHash:i});
   check(renderer.voxelOverlay.pickupGeometry.size===64,'pickup cache is unbounded');
   controller.confirmTx(pending.txId,{executionSlot:123});manager.rebuildDirtyChunks(10000);
   check(builder.build(null,highTime).length===0,'confirmed pickup kept flashing');check(sync.bareHandPlan(hit)===null,'confirmed stone still collectible');
   check(manager.getBlockAtWorld(hit.worldX,hit.worldY,hit.worldZ)===hit.blockId,'pickup removed supporting terrain');
   check(state.selectedHotbarSlot===3&&state.getSelectedToolSlot()===null,'pickup refresh selected a tool');check(state.hotbarSlots[1].durability===50,'bare-hand pickup damaged tool');
   const images={};
   for(const [name,pixels]of [['outline',baseline],['body-bright',peak],['body-dim',low]]){
    const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d'),image=ctx.createImageData(640,360);
    for(let y=0;y<360;y++)image.data.set(pixels.subarray((359-y)*640*4,(360-y)*640*4),y*640*4);ctx.putImageData(image,0,0);images[name]=c.toDataURL();
   }
   const overlay=renderer.voxelOverlay;renderer.dispose();manager.dispose();check(overlay.pickupByteLength===0&&overlay.pickupGeometry.size===0,'pickup cache survived disposal');
   return {passed:true,hit,decoration:body.decoration,bodyPixels,outsidePixels,pulseDelta,brightnessDelta,bounds,cachedBytes:bytes,contextRestored:true,images};
  });
  assert.deepEqual(errors,[]);assert.equal(result.passed,true);
  if(process.env.NICECHUNK_PICKUP_EVIDENCE){
   const directory=process.env.NICECHUNK_PICKUP_EVIDENCE;await mkdir(directory,{recursive:true});
   for(const [name,data]of Object.entries(result.images))await writeFile(directory+'/'+name+'.png',Buffer.from(data.split(',')[1],'base64'));
   delete result.images;await writeFile(directory+'/results.json',JSON.stringify(result,null,2)+'\n');
  }
 }finally{await browser.close();}
});
