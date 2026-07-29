import assert from "node:assert/strict";
import test from "node:test";

import { createCollisionBox } from "../../chunk.js/input/collision.js";
import { BLOCK_ID } from "../../chunk.js/world/block-registry.js";
import { createPlayerMotionController } from "../player-motion-controller.js";

test("walking requires 300ms of continuous obstacle intent before assisted jumping", () => {
  const { player, controls, motion } = movementFixture({ withStep: true, startX: 0.75 });

  const contactX = worldPosition(player)[0];
  advance(motion, controls, 5, 0.05, { dx: 0.1 });
  assert.equal(worldPosition(player)[0], contactX);
  assert.equal(worldPosition(player)[1], 1);
  assert.equal(player.velocityY, 0);

  advance(motion, controls, 1, 0.05, { dx: 0.1 });
  assert.ok(player.velocityY > 0);
  assert.ok(worldPosition(player)[1] > 1);
});

test("releasing movement clears accumulated walking step intent", () => {
  const { player, controls, motion } = movementFixture({ withStep: true, startX: 0.75 });

  advance(motion, controls, 4, 0.05, { dx: 0.1 });
  advance(motion, controls, 1, 0.05, { dx: 0 });
  advance(motion, controls, 4, 0.05, { dx: 0.1 });

  assert.equal(worldPosition(player)[1], 1);
  assert.equal(player.velocityY, 0);

  advance(motion, controls, 2, 0.05, { dx: 0.1 });
  assert.ok(player.velocityY > 0);
});

test("holding Shift preserves immediate sprint step-up behavior", () => {
  const { player, controls, motion } = movementFixture({ withStep: true, startX: 0.75 });
  controls.keys.add("ShiftLeft");

  advance(motion, controls, 1, 0.016, { dx: 0.1 });

  const [x, y, z] = worldPosition(player);
  assert.ok(Math.abs(x - 0.85) < 1e-9);
  assert.equal(y, 2);
  assert.equal(z, 0.5);
  assert.equal(player.grounded, true);
  assert.equal(player.velocityY, 0);
});

test("held and released jumps have smooth distinct arcs with accelerating descent", () => {
  const held = simulateJump({ releaseAfterSeconds: Infinity });
  const short = simulateJump({ releaseAfterSeconds: 0.08 });

  assert.ok(held.maxY > short.maxY + 0.25);
  assert.ok(held.maxY > 2.4 && held.maxY < 3.5);
  assert.ok(held.airtime > 0.65 && held.airtime < 1.2);
  assert.ok(held.fallSpeeds.length > 5);
  for (let index = 1; index < held.fallSpeeds.length; index += 1) {
    assert.ok(held.fallSpeeds[index] >= held.fallSpeeds[index - 1] - 1e-9);
  }
  assert.ok(Math.max(...held.fallSpeeds) <= 22);
  assert.equal(held.player.grounded, true);
  assert.equal(worldPosition(held.player)[1], 1);
});

test("holding Space through landing does not trigger another jump", () => {
  const { player, controls, motion } = movementFixture();
  const dt = 1 / 120;
  let landed = false;
  controls.keys.add("Space");

  for (let frame = 0; frame < 360; frame += 1) {
    motion.applyPlayerPhysics(dt);
    if (frame > 10 && player.grounded) {
      landed = true;
      break;
    }
  }

  assert.equal(landed, true);
  advance(motion, controls, 30, dt);
  assert.equal(player.grounded, true);
  assert.equal(player.velocityY, 0);
  assert.equal(worldPosition(player)[1], 1);
});

test("landing compression recovers and clears its animation state", () => {
  const { player, controls, motion, avatar } = simulateJump({ releaseAfterSeconds: Infinity });

  motion.syncAvatarToPlayer(0);
  assert.ok(avatar.localOffsetY < 0);
  assert.ok(avatar.animation.landingStrength > 0);

  advance(motion, controls, 1, 0.21);
  motion.syncAvatarToPlayer(210);
  assert.equal(avatar.localOffsetY, 0);
  assert.equal(avatar.animation.landingStrength, 0);
  assert.equal(player.grounded, true);
});

function movementFixture({ withStep = false, startX = 0.5 } = {}) {
  const body = createCollisionBox({ halfWidth: 0.2, halfDepth: 0.2, height: 1.8 });
  const player = {
    worldX: 0,
    worldY: 1,
    worldZ: 0,
    localOffsetX: startX,
    localOffsetY: 0,
    localOffsetZ: 0.5,
    controlYaw: 0,
    avatarYaw: 0,
    yaw: 0,
    velocityY: 0,
    grounded: true,
    collisionBoxes: [body],
    equipmentCollisionBoxes: [],
  };
  const controls = {
    keys: new Set(),
    move: { dx: 0, dz: 0, moving: false, actualMoving: false, yaw: 0 },
    jumpQueued: false,
    consumeJump() {
      const queued = this.jumpQueued || this.keys.has("Space");
      this.jumpQueued = false;
      return queued;
    },
  };
  const avatar = {};
  const chunks = collisionWorld({ withStep });
  const motion = createPlayerMotionController({
    getPlayer: () => player,
    getControls: () => controls,
    getChunks: () => chunks,
    getAvatar: () => avatar,
    defaultCollisionBox: body,
    config: {
      playerBodyHeight: 1.8,
      collisionStep: 0.1,
      stepHeightBlocks: 1.05,
      groundSnapUp: 0.22,
      walkStepIntentDelayMs: 300,
    },
  });
  return { player, controls, motion, avatar };
}

function collisionWorld({ withStep }) {
  return {
    minY: -8,
    height: 32,
    getCollisionBlockAtWorld(x, y, z) {
      if (y === 0) return BLOCK_ID.stone;
      if (withStep && x === 1 && y === 1 && z === 0) return BLOCK_ID.stone;
      return BLOCK_ID.air;
    },
    getCollisionTopAtWorld(x, z, maxBlockY) {
      let top = maxBlockY >= 0 ? 1 : -Infinity;
      if (withStep && x === 1 && z === 0 && maxBlockY >= 1) top = 2;
      return top;
    },
  };
}

function advance(motion, controls, frames, dt, { dx = 0, dz = 0 } = {}) {
  for (let index = 0; index < frames; index += 1) {
    controls.move.dx = dx;
    controls.move.dz = dz;
    controls.move.moving = Math.hypot(dx, dz) > 0;
    motion.applyPlayerPhysics(dt);
  }
}

function simulateJump({ releaseAfterSeconds }) {
  const fixture = movementFixture();
  const { player, controls, motion } = fixture;
  const dt = 1 / 120;
  let elapsed = 0;
  let maxY = worldPosition(player)[1];
  const fallSpeeds = [];
  controls.keys.add("Space");

  for (let frame = 0; frame < 360; frame += 1) {
    if (elapsed >= releaseAfterSeconds) controls.keys.delete("Space");
    controls.move.dx = 0;
    controls.move.dz = 0;
    controls.move.moving = false;
    motion.applyPlayerPhysics(dt);
    elapsed += dt;
    maxY = Math.max(maxY, worldPosition(player)[1]);
    if (player.velocityY < 0) fallSpeeds.push(-player.velocityY);
    if (elapsed > 0.1 && player.grounded) break;
  }

  return { ...fixture, maxY, airtime: elapsed, fallSpeeds };
}

function worldPosition(player) {
  return [
    player.worldX + player.localOffsetX,
    player.worldY + player.localOffsetY,
    player.worldZ + player.localOffsetZ,
  ];
}
