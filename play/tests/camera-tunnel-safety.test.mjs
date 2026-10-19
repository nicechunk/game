import assert from "node:assert/strict";
import test from "node:test";
import { createPlayerMotionController } from "../player-motion-controller.js";
import { cameraForward, createCameraState } from "../../chunk.js/renderer/camera.js";

function blocked(x, y, z) {
  const air = ((x >= -2 && x <= 12 && z >= 0 && z <= 2)
    || (x >= 10 && x <= 12 && z >= 0 && z <= 14)
    || (x >= 10 && x <= 25 && z >= 12 && z <= 14));
  return y < 1 || y >= 5 || !air;
}
function world(camera) {
  return [camera.worldX + camera.localOffsetX, camera.worldY + camera.localOffsetY, camera.worldZ + camera.localOffsetZ];
}
function nearPlane(camera) {
  const eye = world(camera), f = cameraForward(camera);
  const h = Math.hypot(f[0], f[2]);
  const right = h > 1e-6 ? [f[2] / h, 0, -f[0] / h] : [1, 0, 0];
  const up = [-f[1] * right[2], f[2] * right[0] - f[0] * right[2], f[1] * right[0]];
  const hh = camera.near * Math.tan(camera.fov * Math.PI / 360), hw = hh * camera.aspect;
  return [-1, 1].flatMap((sx) => [-1, 1].map((sy) => eye.map((v, i) => v + f[i] * camera.near + right[i] * hw * sx + up[i] * hh * sy)));
}
for (const fps of [15, 30, 60, 120]) {
  for (const mobile of [false, true]) {
    for (const speed of [0, 8, 29.6]) {
      test(`L/zig tunnel eye and near-plane safety ${fps}fps mobile=${mobile} speed=${speed}`, () => {
        const camera = createCameraState({ fov: 58, aspect: mobile ? 9 / 19 : 16 / 9 });
        const player = { worldX: 0, worldY: 1, worldZ: 1, localOffsetX: 0.5, localOffsetY: 0, localOffsetZ: 0.5,
          cameraPitch: -0.1, controlYaw: -Math.PI / 2, yaw: 0 };
        const motion = createPlayerMotionController({ getPlayer: () => player, getCamera: () => camera,
          getChunks: () => ({ isCameraOccluderAtWorld: blocked, getBlockAtWorld: (x,y,z) => blocked(x,y,z) ? 3 : 0 }),
          isMobileViewport: () => mobile });
        let distance = 0;
        for (let frame = 0; frame < fps * 5; frame += 1) {
          const dt = (frame % 7 === 0 ? 1.7 : 0.88) / fps;
          distance = Math.min(35, distance + speed * dt);
          let x, z;
          if (distance <= 11) { x = 0.5 + distance; z = 1.5; player.controlYaw = -Math.PI / 2; }
          else if (distance <= 23) { x = 11.5; z = 1.5 + distance - 11; player.controlYaw = Math.PI; }
          else { x = 11.5 + distance - 23; z = 13.5; player.controlYaw = -Math.PI / 2; }
          motion.setPlayerWorldFloat(x, 1, z);
          assert.equal(motion.playerCollidesAt(x, 1, z), false, "trajectory must keep the player legal");
          if (frame % 37 === 0) motion.toggleFirstPersonCamera();
          player.cameraPitch = -0.92 + (frame % 20) / 20 * 1.1;
          motion.syncCameraToPlayer(dt, { force: frame === 0 });
          assert.equal(camera.cameraSafety?.safe, true, `frame ${frame} camera must be verified safe`);
          for (const point of [world(camera), ...nearPlane(camera)]) {
            assert.equal(blocked(...point.map(Math.floor)), false, `eye/near-plane in solid: frame=${frame} point=${point}`);
          }
        }
      });
    }
  }
}

test("a ceiling invalidating the old focus falls back to a safe player eye", () => {
  let ceiling = 7;
  const isBlocked = (x, y, z) => y >= ceiling || y < 0 || Math.abs(x) > 3 || Math.abs(z) > 3;
  const player = { worldX: 0, worldY: 0, worldZ: 0, localOffsetX: 0.5, localOffsetZ: 0.5, controlYaw: 0, cameraPitch: 0 };
  const camera = createCameraState();
  const motion = createPlayerMotionController({ getPlayer: () => player, getCamera: () => camera,
    getChunks: () => ({ isCameraOccluderAtWorld: isBlocked }), isMobileViewport: () => true });
  motion.syncCameraToPlayer(1 / 30, { force: true });
  ceiling = 4;
  motion.syncCameraToPlayer(1 / 30);
  assert.equal(camera.cameraSafety.safe, true);
  assert.equal(camera.cameraSafety.fallback, true);
  assert.ok(world(camera)[1] + camera.cameraSafety.radius < 4);
});

for (const fps of [15,30,60,120]) for (const mobile of [false,true]) {
  test(`vertical ledge/drop preserves camera volume ${fps}fps mobile=${mobile}`, () => {
    const isBlocked = (x,y,z) => y < (x < 4 ? 6 : 0) || y >= 13 || Math.abs(z) > 2;
    const player = { worldX:0,worldY:6,worldZ:0,localOffsetX:0.5,localOffsetZ:0.5,controlYaw:-Math.PI/2,cameraPitch:-0.5 };
    const camera = createCameraState({aspect:mobile ? 9/19 : 16/9});
    const motion = createPlayerMotionController({getPlayer:()=>player,getCamera:()=>camera,
      getChunks:()=>({isCameraOccluderAtWorld:isBlocked,getBlockAtWorld:(x,y,z)=>isBlocked(x,y,z)?3:0}),
      isMobileViewport:()=>mobile});
    for(let frame=0;frame<fps*3;frame++) {
      const x=0.5+frame/(fps*3)*8;
      const y=Math.max(0,6-Math.max(0,x-4.6)*2);
      motion.setPlayerWorldFloat(x,y,0.5);
      assert.equal(motion.playerCollidesAt(x,y,0.5),false);
      if(frame===fps || frame===fps*2) motion.toggleFirstPersonCamera();
      motion.syncCameraToPlayer((frame%3===0?1.5:0.75)/fps,{force:frame===0});
      assert.equal(camera.cameraSafety.safe,true);
      for(const point of [world(camera),...nearPlane(camera)]) assert.equal(isBlocked(...point.map(Math.floor)),false);
    }
  });
}
