import assert from "node:assert/strict";

import { createPlayEffects } from "../play-effects.js";

const calls = [];
let collisionOptions = null;
const renderer = {
  emitVoxelParticles(kind, options) {
    calls.push({ kind, options });
    return true;
  },
  updateVoxelParticles(_dt, collision) {
    collisionOptions = collision;
    return 0;
  },
};
const chunks = {
  getBlockAtWorld(_x, y) {
    return y === 1 ? 3 : 0;
  },
};
const effects = createPlayEffects({
  getRenderer: () => renderer,
  getChunks: () => chunks,
  getPlayerPosition: () => [0, 8, 0],
  isBlockingBlock: (blockId) => blockId === 3,
});

assert.equal(effects.emitConfirmedBlockFracture({
  blocks: [
    { worldX: 4, worldY: 2, worldZ: 5, blockId: 1, unrelated: "ignored" },
    { worldX: 4, worldY: 3, worldZ: 5, blockId: 28 },
  ],
}), true);
assert.equal(calls.length, 1);
assert.equal(calls[0].kind, "fracture");
assert.deepEqual(calls[0].options.blocks, [
  { worldX: 4, worldY: 2, worldZ: 5, blockId: 1 },
  { worldX: 4, worldY: 3, worldZ: 5, blockId: 28 },
]);

effects.update(1000, 1 / 60);
assert.equal(typeof collisionOptions?.groundHeightAt, "function");
assert.equal(collisionOptions.groundHeightAt(4.5, 5.5, 2.08, 1.92), 2);
assert.equal(collisionOptions.groundHeightAt(4.5, 5.5, 4.08, 3.92), null);

console.log("play effects tests passed");
