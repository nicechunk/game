import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerMotionController} from '../player-motion-controller.js';
import {createCameraState} from '../../chunk.js/renderer/camera.js';
import {createCollisionBox} from '../../chunk.js/play.js';

test('camera sweeps query each voxel once per call and observe world edits on the next call',()=>{
  const camera=createCameraState(),player={worldX:0,worldY:1,worldZ:0,localOffsetX:.5,localOffsetY:0,localOffsetZ:.5,
    cameraPitch:-.21,controlYaw:0,yaw:0},queries=new Map();
  let wall=false;
  const chunks={isCameraOccluderAtWorld:(x,y,z)=>{
    const key=`${x}:${y}:${z}`;queries.set(key,(queries.get(key)??0)+1);
    return y<1||(wall&&z===3&&y<20);
  }};
  const motion=createPlayerMotionController({getPlayer:()=>player,getCamera:()=>camera,getChunks:()=>chunks});
  motion.syncCameraToPlayer(1/60,{force:true});
  const before=camera.worldZ+camera.localOffsetZ;
  assert.ok(before>3);assert.ok(queries.size>0);assert.equal(Math.max(...queries.values()),1);
  queries.clear();wall=true;
  motion.syncCameraToPlayer(1/60,{force:true});
  assert.ok(camera.worldZ+camera.localOffsetZ<3);assert.equal(camera.cameraSafety.safe,true);
  assert.equal(Math.max(...queries.values()),1,'new world data must be read without duplicate queries');
});

test('no-shadow avatar synchronization skips ground projection queries while keeping animation',()=>{
  const player={worldX:0,worldY:1,worldZ:0,avatarYaw:.5,grounded:true},avatar={},controls={move:{moving:true,actualMoving:true}},camera=createCameraState();
  let queries=0;
  const chunks={minY:0,height:16,getCollisionTopAtWorld:()=>{queries++;return 1;}};
  for(const shadows of [false,true]) {
    const motion=createPlayerMotionController({getPlayer:()=>player,getCamera:()=>camera,getChunks:()=>chunks,
      getControls:()=>controls,getAvatar:()=>avatar,config:{shadows},
      defaultCollisionBox:createCollisionBox({halfWidth:.35,halfDepth:.35,height:4})});
    motion.syncAvatarToPlayer(1000);
    assert.equal(avatar.animation.moving,true);assert.equal(avatar.yaw,.5);
    if(!shadows){assert.equal(queries,0);assert.equal(avatar.shadowAlpha,0);}
  }
  assert.ok(queries>0,'enabled-shadow standalone callers retain their ground lookup');
});
