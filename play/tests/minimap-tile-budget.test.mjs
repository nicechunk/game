import assert from "node:assert/strict";
import test from "node:test";
import { createMinimapTileJob } from "../play-minimap-tile-job.js";

test("fallback minimap sampling stops at its deadline and resumes without sampling a pixel twice", () => {
  let calls = 0, clock = 0;
  const job = createMinimapTileJob({ tileX: -2, tileZ: 3, worldStep: 2, samples: 8,
    mapColorAt: (x, z) => { calls++; return [x & 255, z & 255, calls]; } });
  assert.deepEqual(job.advance({ deadline: 0, now: () => 0 }), { done: false, sampled: 0, completedSamples: 0 });
  assert.equal(calls, 0, "an exhausted frame does no terrain reads");
  const first = job.advance({ deadline: 5, now: () => clock++, maxSamples: 32 });
  assert.equal(first.sampled, 5);
  assert.equal(calls, 5);
  let result;
  do { result = job.advance({ maxSamples: 7 }); assert.ok(result.sampled <= 7); } while (!result.done);
  assert.equal(calls, 64);
  for (let index = 0; index < 64; index++) {
    const x = -128 + Math.floor((index % 8 + 0.5) * 8);
    const z = 192 + Math.floor((Math.floor(index / 8) + 0.5) * 8);
    assert.deepEqual(Array.from(job.pixels.subarray(index * 4, index * 4 + 4)), [x & 255, z & 255, index + 1, 255]);
  }
});
