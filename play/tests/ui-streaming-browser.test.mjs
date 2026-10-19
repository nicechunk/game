import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startStaticServer } from '../../scripts/serve-static-site.mjs';

async function fixture(run) {
 const server=await startStaticServer({rootDirectory:fileURLToPath(new URL('../..',import.meta.url))});
 const browser=await chromium.launch({headless:true});
 try {const page=await browser.newPage({viewport:{width:800,height:600}});
  await page.route('**/ui-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body><canvas id="canvas" width="600" height="400" style="width:600px;height:400px"></canvas><div id="guide"></div><div id="measure"><span id="width"></span><span id="depth"></span></div><textarea id="code"></textarea></body>'}));
  await page.goto(server.baseUrl+'/ui-fixture');await run(page);
 }finally{await browser.close();await server.close();}
}

test('inactive land UI avoids snapshots and layout while active state, camera labels and typed input stay fresh',async()=>fixture(async page=>{
 const result=await page.evaluate(async()=>{
  const {createPlayLandUi}=await import('/play/play-land-ui.js');
  const {createCameraState}=await import('/chunk.js/renderer/camera.js');
  const byId=id=>document.getElementById(id);let active=false,mode='foundation',copies=0,measures=0;
  const canvas=byId('canvas'),read=canvas.getBoundingClientRect.bind(canvas);
  canvas.getBoundingClientRect=()=>{measures++;return read();};
  const camera=createCameraState({worldX:8,worldY:30,worldZ:-24,targetWorldX:8,targetWorldY:0,targetWorldZ:8,aspect:1.5,far:200});
  const foundation={active:true,chunksX:1,chunksZ:1,preview:{minX:0,minZ:0,width:16,depth:16,surfaceY:0,maxSurfaceY:0}};
  const building={code:'source',mode,foundations:[]};
  const ui=createPlayLandUi({elements:{landGuide:byId('guide'),foundationMeasurements:byId('measure'),foundationMeasureWidth:byId('width'),foundationMeasureDepth:byId('depth'),buildingCode:byId('code')},
   getController:()=>({snapshot(){copies++;return{...foundation};}}),
   getBuildingController:()=>({activate(){},snapshot(){copies++;return{...building,mode};}}),
   isConstructionModeActive:()=>active,getCamera:()=>camera,canvas});
  ui.update();const initialCopies=copies;for(let i=0;i<120;i++)ui.update();
  const hidden={copies:copies-initialCopies,measures,hidden:byId('guide').hidden};
  active=true;foundation.preview.width=32;const before=copies;ui.update();
  const open={copies:copies-before,measures,width:byId('width').textContent,transform:byId('width').style.transform};
  camera.worldX+=10;camera.targetWorldX+=10;ui.update();const moved=byId('width').style.transform;
  mode='building';ui.update();byId('code').focus();byId('code').value='unsubmitted NCM text';byId('code').setSelectionRange(4,9);
  building.code='another server value';ui.render({force:true});
  return{hidden,open,moved,input:byId('code').value,selection:[byId('code').selectionStart,byId('code').selectionEnd]};
 });
 assert.deepEqual(result.hidden,{copies:0,measures:0,hidden:true});assert.equal(result.open.copies,2);
 assert.equal(result.open.measures,1);assert.equal(result.open.width,'32');assert.notEqual(result.moved,result.open.transform);
 assert.equal(result.input,'unsubmitted NCM text');assert.deepEqual(result.selection,[4,9]);
}));

test('minimap real Worker and resumable fallback converge to the same complete pixels and drop closed view jobs',async()=>fixture(async page=>{
 const result=await page.evaluate(async()=>{
  const {createPlayMinimap}=await import('/play/play-minimap.js');
  const makeCanvas=()=>{const canvas=document.createElement('canvas');canvas.style.width=canvas.style.height='240px';document.body.append(canvas);return canvas;};
  const workerCanvas=makeCanvas(),fallbackCanvas=makeCanvas();
  const make=canvas=>createPlayMinimap({elements:{minimap:canvas},worldSeed:'nicechunk-mainnet-001',getPlayerPosition:()=>[48,80,-32],getCameraHeading:()=>0,getViewDistance:()=>7});
  const workerMap=make(workerCanvas);workerMap.bind();const fallbackMap=make(fallbackCanvas);
  for(let i=0;i<600;i++){
   workerMap.update(true);fallbackMap.update(true);
   const a=workerMap.diagnostics(),b=fallbackMap.diagnostics();
   if(a.tiles>=a.retainedSmall&&b.tiles>=b.retainedSmall&&a.pending===0&&b.fallbackPending===0)break;
   if(i%4===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  const first=workerMap.diagnostics(),second=fallbackMap.diagnostics();
  const a=workerCanvas.getContext('2d').getImageData(0,0,workerCanvas.width,workerCanvas.height).data;
  const b=fallbackCanvas.getContext('2d').getImageData(0,0,fallbackCanvas.width,fallbackCanvas.height).data;
  let different=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])different++;
  const large=makeCanvas(),overlay=document.createElement('div');document.body.append(overlay);
  const queued=[];const OriginalWorker=globalThis.Worker;
  globalThis.Worker=class{postMessage(message){queued.push(message);}addEventListener(){}terminate(){}};
  const largeMap=createPlayMinimap({elements:{minimap:makeCanvas(),largeMinimap:large,mapOverlay:overlay},worldSeed:'nicechunk-mainnet-001'});
  try{largeMap.bind();largeMap.update(true);largeMap.openLargeMap();largeMap.update(true);largeMap.closeLargeMap();}
  finally{globalThis.Worker=OriginalWorker;}
  return{first,second,different,length:a.length,closed:largeMap.diagnostics(),retain:queued.filter(m=>m.type==='retain').at(-1)?.keys?.length};
 });
 assert.equal(result.first.workerActive,true);assert.equal(result.second.workerActive,false);
 assert.ok(result.first.tiles>=result.first.retainedSmall);assert.ok(result.second.tiles>=result.second.retainedSmall);
 assert.equal(result.different,0,`${result.different}/${result.length} channels differ`);
 assert.equal(result.closed.retainedLarge,0);assert.equal(result.retain,result.closed.retainedSmall);
 assert.ok(result.closed.pending<=48);assert.ok(result.second.fallbackPending<=48);
}));
