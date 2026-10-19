import assert from 'node:assert/strict';
import test from 'node:test';
import {createChunkPrefetchPlanner} from '../play-chunk-prefetch.js';

test('travel forecasts boundary rows before crossing and supports strafing independent of camera',()=>{
  const planner=createChunkPrefetchPlanner();
  planner.update(15,0,0,{moving:true});
  const forecast=planner.update(15.56,0,70,{moving:true});
  assert.equal(Math.floor(15.56/16),0);
  assert.ok(Math.floor(forecast.prefetchWorldX/16)>=1);
  assert.equal(forecast.prefetchWorldZ,0);
  for(let i=2;i<20;i++) {
    const x=15+i*.56,result=planner.update(x,0,i*70,{moving:true});
    assert.ok(result.prefetchWorldX>x);
    assert.ok(result.prefetchWorldX-x<=48);
  }
});

test('stops, teleports, timer gaps, clock resets and negative coordinates cannot carry a stale prediction',()=>{
  const planner=createChunkPrefetchPlanner();
  planner.update(-15,0,1000,{moving:true});
  assert.ok(planner.update(-15.56,0,1070,{moving:true}).prefetchWorldX < -16);
  assert.deepEqual(planner.update(-15.56,0,1140),{prefetchWorldX:-15.56,prefetchWorldZ:0});
  assert.equal(planner.update(500,0,1210,{moving:true}).prefetchWorldX,500);
  assert.equal(planner.update(501,0,5000,{moving:true}).prefetchWorldX,501);
  assert.equal(planner.update(502,0,1,{moving:true}).prefetchWorldX,502);
  planner.reset();assert.equal(planner.update(503,0,70,{moving:true}).prefetchWorldX,503);
});
