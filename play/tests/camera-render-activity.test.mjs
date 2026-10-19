import assert from 'node:assert/strict';
import test from 'node:test';
import {createCameraActivityTracker} from '../play-camera-activity.js';
import {createPlayRenderBudget} from '../play-render-budget.js';
import {createCameraState} from '../../chunk.js/renderer/camera.js';

test('orbit and first-person look pause only speculative uploads until camera settles',()=>{
 const camera=createCameraState(),budget=createPlayRenderBudget({getFps:()=>60,getRenderer:()=>({options:{maxChunkUploadsPerFrame:8}})});
 budget.noteWorldVisible();budget.noteWorldCovered();
 budget.noteCameraFrame(camera,0);assert.equal(budget.allowBackgroundUploads(0),true);
 const visibleBudget=budget.frameUploadBudget();
 camera.yaw+=.03;budget.noteCameraFrame(camera,16);
 assert.equal(budget.allowBackgroundUploads(16),false);
 assert.equal(budget.frameUploadBudget(),visibleBudget,'current-view upload throughput stays available');
 budget.noteCameraFrame(camera,100);assert.equal(budget.allowBackgroundUploads(100),false);
 budget.noteCameraFrame(camera,180);assert.equal(budget.allowBackgroundUploads(180),true);
 camera.targetWorldX=8;camera.targetWorldY=8;camera.targetWorldZ=8;
 budget.noteCameraFrame(camera,200);assert.equal(budget.allowBackgroundUploads(200),false);
 budget.reset();budget.noteCameraFrame(camera,201);assert.equal(budget.allowBackgroundUploads(201),true);
});

test('slow continuous rotation accumulates while normalized coordinate jitter stays idle',()=>{
 const tracker=createCameraActivityTracker(),camera=createCameraState({worldX:-1,localOffsetX:.75,yaw:0,pitch:0});
 tracker.update(camera,0);camera.worldX=0;camera.localOffsetX=-.25;
 assert.equal(tracker.update(camera,16),false,'same eye with a different floating origin');
 for(let i=1;i<=100;i++) {
  camera.yaw=i*.00003;tracker.update(camera,16+i*16);
  if(i>=5)assert.equal(tracker.active(16+i*16),true,'sub-threshold increments must accumulate');
 }
});

test('explicit targets ignore unused yaw fields and track actual projection changes',()=>{
 const tracker=createCameraActivityTracker(),camera=createCameraState({worldX:0,worldY:0,worldZ:0,targetWorldX:0,targetWorldY:0,targetWorldZ:10});
 tracker.update(camera,0);camera.yaw+=1;camera.pitch+=.5;
 assert.equal(tracker.update(camera,16),false);
 camera.aspect=16/9;assert.equal(tracker.update(camera,32),true);
 assert.equal(tracker.update(null,48),false);
 tracker.update(camera,1000);camera.targetWorldX=1;tracker.update(camera,1016);
 assert.equal(tracker.active(1016),true);
 assert.equal(tracker.update(camera,1),false,'clock reset must release the prior motion hold');
});

test('actual locomotion keeps speculative uploads paused with an unchanged camera',()=>{
 let moving=true;
 const budget=createPlayRenderBudget({isMotionActive:()=>moving}),camera=createCameraState();
 budget.noteCameraFrame(camera,0);assert.equal(budget.allowBackgroundUploads(1000),false);
 moving=false;assert.equal(budget.allowBackgroundUploads(1000),true);
});
