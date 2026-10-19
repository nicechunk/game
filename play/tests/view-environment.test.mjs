import assert from "node:assert/strict";
import test from "node:test";
import { computeViewEnvironment, loadedTerrainRadiusBlocks } from "../play-view-distance.js";
import { createUnderwaterLighting, createWorldLighting } from "../../chunk.js/renderer/lighting.js";

for (const viewDistance of [2, 7, 20]) {
  test(`fog ends inside the rendered horizon at view ${viewDistance}`, () => {
    const env = computeViewEnvironment({ viewDistance, cameraOffsetBlocks: 10 });
    assert.ok(env.fogNearFar[0] < env.fogNearFar[1]);
    assert.ok(env.fogNearFar[1] + 10 < viewDistance * 16);
    assert.ok(env.cameraFar > env.fogNearFar[1]);
    const close = computeViewEnvironment({ viewDistance, cameraOffsetBlocks: 10, loadedRadiusBlocks: 32 });
    assert.ok(close.fogNearFar[1] <= env.fogNearFar[1], "unloaded transition may only reduce the horizon");
  });
}

test("fog horizon shrinks immediately as the camera moves behind the player", () => {
  const a = computeViewEnvironment({ viewDistance: 7, cameraOffsetBlocks: 0 });
  const b = computeViewEnvironment({ viewDistance: 7, cameraOffsetBlocks: 9 });
  assert.ok(Math.abs(a.fogNearFar[1] - b.fogNearFar[1] - 9 * a.fogDepthProjectionScale) < 1e-8);
});

test("loaded horizon uses committed rings and negative chunk coordinates", () => {
  const chunks = new Map();
  for (let z = -2; z <= 0; z++) for (let x = -2; x <= 0; x++) chunks.set(`${x},${z}`, { mesh: {}, meshVersion: 1 });
  assert.equal(loadedTerrainRadiusBlocks(chunks, -8, -8, 7), 24);
  chunks.delete("0,0");
  assert.equal(loadedTerrainRadiusBlocks(chunks, -8, -8, 7), 8);
});

test("underwater blending cannot push fog beyond a short render horizon", () => {
  const lighting = createWorldLighting({ fogNear: 10, fogFar: 20 });
  for (const blend of [0, 0.25, 0.5, 1]) {
    const water = createUnderwaterLighting(lighting, blend);
    assert.ok(water.fogNearFar[0] <= 10);
    assert.ok(water.fogNearFar[1] <= 20);
  }
});


test("fog reaches full opacity before the loaded horizon at projected screen corners", () => {
  for(const aspect of [9/19,1,16/9,3.2])for(const viewDistance of [2,7,20]) {
    const fov=58,offset=8,env=computeViewEnvironment({viewDistance,cameraOffsetBlocks:offset,fov,aspect});
    const tv=Math.tan(fov*Math.PI/360),radialAtFog=env.fogNearFar[1]*Math.hypot(1,tv*aspect,tv);
    assert.ok(radialAtFog+offset<viewDistance*16,`fog must cover frustum corners aspect=${aspect} view=${viewDistance}`);
  }
});
