import assert from "node:assert/strict";
import test from "node:test";
import { computeViewEnvironment, computePlayViewEnvironment, loadedTerrainRadiusBlocks } from "../play-view-distance.js";
import { createUnderwaterLighting, createWorldLighting } from "../../chunk.js/renderer/lighting.js";

for (const viewDistance of [2, 7, 20]) {
  test(`clear-air clipping contains the selected range at view ${viewDistance}`, () => {
    const env = computeViewEnvironment({ viewDistance, cameraOffsetBlocks: 10 });
    assert.equal(env.fogEnabled, false);
    assert.equal(env.fogNearFar, undefined);
    assert.equal(env.preloadDistance, viewDistance + 2);
    assert.ok(env.cameraFar > (viewDistance + 2) * 16 * Math.SQRT2 + 10);
  });
}

test("loaded horizon uses committed rings and negative chunk coordinates", () => {
  const chunks = new Map();
  for (let z = -2; z <= 0; z++) for (let x = -2; x <= 0; x++) chunks.set(`${x},${z}`, { mesh: {}, meshVersion: 1 });
  assert.equal(loadedTerrainRadiusBlocks(chunks, -8, -8, 7), 24);
  chunks.delete("0,0");
  assert.equal(loadedTerrainRadiusBlocks(chunks, -8, -8, 7), 8);
});

test("joining at a chunk boundary cannot restore fog while adjacent chunks stream", () => {
  const chunks = new Map([["50,50", { mesh: {}, meshVersion: 1 }]]);
  const loaded = loadedTerrainRadiusBlocks(chunks, 800, 800, 7);
  assert.equal(loaded, 0);
  for (const aspect of [390 / 844, 16 / 9, 3.2]) {
    const common = { viewDistance: 7, cameraOffsetBlocks: 8, aspect };
    const joining = computePlayViewEnvironment({ ...common, loadedRadiusBlocks: loaded });
    const complete = computePlayViewEnvironment({ ...common, loadedRadiusBlocks: 112 });
    assert.deepEqual(joining, complete);
    assert.equal(joining.fogEnabled, false);
    assert.equal(joining.fogNearFar, undefined);
  }
});

test("underwater keeps its environmental tint without changing camera clipping", () => {
  const lighting = createWorldLighting();
  const surface = computePlayViewEnvironment({ viewDistance: 7 });
  const water = createUnderwaterLighting(lighting, 1);
  assert.notDeepEqual(water.clearColor, lighting.clearColor);
  assert.equal(surface.fogEnabled, false);
});
