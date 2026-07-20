import assert from "node:assert/strict";
import test from "node:test";

import { ChunkManager } from "../../chunk.js/chunk/chunk-manager.js";
import { BLOCK_ID } from "../../chunk.js/world/block-registry.js";
import { createCollisionBox } from "../../chunk.js/input/collision.js";
import { createPlayerMotionController } from "../player-motion-controller.js";

test("player body cannot enter building voxels and can stand on a building floor", () => {
  const chunks = new ChunkManager({ height: 64, minY: -16, useWorkers: false });
  chunks.setSupplementalCollisionProvider({
    hasCollisionAtWorld(worldX, worldY, worldZ) {
      const floor = worldX === 0 && worldY === 1000 && worldZ === 0;
      const wall = worldX === 1 && worldY >= 1001 && worldY <= 1004 && worldZ === 0;
      return floor || wall;
    },
    collisionTopAtWorld(worldX, worldZ, maxBlockY) {
      if (worldX !== 0 || worldZ !== 0 || maxBlockY < 1000) return -Infinity;
      return 1001;
    },
  });
  const body = createCollisionBox({ halfWidth: 0.3, halfDepth: 0.3, height: 4 });
  const player = {
    worldX: 0,
    worldY: 1001,
    worldZ: 0,
    localOffsetX: 0.5,
    localOffsetY: 0,
    localOffsetZ: 0.5,
    collisionBoxes: [body],
  };
  const motion = createPlayerMotionController({
    getPlayer: () => player,
    getChunks: () => chunks,
    defaultCollisionBox: body,
  });

  assert.equal(motion.groundYAt(0.5, 0.5, { maxTopY: 1001.2 }), 1001);
  assert.equal(motion.playerCollidesAt(0.5, 1001, 0.5), false);
  assert.equal(motion.playerCollidesAt(0.8, 1001, 0.5), true);
  assert.equal(motion.collisionBlockAt(1, 1002, 0), BLOCK_ID.stone);
});

test("late building collision lifts an embedded player onto the nearest upper surface", () => {
  let buildingLoaded = false;
  const chunks = new ChunkManager({ height: 64, minY: -16, useWorkers: false });
  chunks.setSupplementalCollisionProvider({
    hasCollisionAtWorld(worldX, worldY, worldZ) {
      return buildingLoaded
        && worldX === 0
        && worldZ === 0
        && worldY >= 1000
        && worldY <= 1004;
    },
    collisionTopAtWorld(worldX, worldZ, maxBlockY) {
      if (!buildingLoaded || worldX !== 0 || worldZ !== 0 || maxBlockY < 1000) return -Infinity;
      return Math.min(1005, maxBlockY + 1);
    },
  });
  const body = createCollisionBox({ halfWidth: 0.3, halfDepth: 0.3, height: 4 });
  const player = {
    worldX: 0,
    worldY: 1000,
    worldZ: 0,
    localOffsetX: 0.5,
    localOffsetY: 0,
    localOffsetZ: 0.5,
    velocityY: -2,
    grounded: true,
    collisionBoxes: [body],
  };
  const motion = createPlayerMotionController({
    getPlayer: () => player,
    getChunks: () => chunks,
    defaultCollisionBox: body,
  });

  assert.equal(motion.playerCollidesAt(0.5, 1000, 0.5), false);
  buildingLoaded = true;
  assert.equal(motion.playerCollidesAt(0.5, 1000, 0.5), true);

  const result = motion.liftPlayerOutOfCollision({ maxRise: 64 });

  assert.equal(result.moved, true);
  assert.equal(result.fromY, 1000);
  assert.equal(result.toY, 1005);
  assert.deepEqual(motion.playerWorldFloat(), [0.5, 1005, 0.5]);
  assert.equal(player.velocityY, 0);
  assert.equal(player.grounded, true);
  assert.equal(motion.playerCollidesAt(0.5, 1005, 0.5), false);
});
