import assert from "node:assert/strict";
import test from "node:test";

import { createCollisionBox } from "../../chunk.js/input/collision.js";
import { createPlacementController } from "../placement-controller.js";
import { createPlayerMotionController } from "../player-motion-controller.js";

test("a valid resource placement starts one hand action at the committed preview target", () => {
  const starts = [];
  const pendingDeltas = [];
  const slot = { resourceId: 41, blockId: 7, count: 3 };
  const gameState = {
    playerProfile: {},
    getSelectedPlaceableSlot: () => ({ slot, index: 2 }),
    consumeSelectedPlaceable: () => ({ ok: true, consumed: { slot: 2 } }),
    savePlayerProfile() {},
  };
  const controller = createPlacementController({
    gameState,
    chunks: {
      getBlockAtWorld: () => 0,
      applyPendingDelta(delta, txId) { pendingDeltas.push({ delta, txId }); },
    },
    getHit: () => ({ hit: true, worldX: 4, worldY: 5, worldZ: 6, faceX: 1, faceY: 0, faceZ: 0 }),
    getPlayerBounds: () => null,
    blockDef: () => ({ name: "Stone" }),
    isBlockingBlock: () => true,
    isFluidBlock: () => false,
    blockAirId: 0,
    onPlacementStart: (pending) => starts.push(pending),
  });

  const pending = controller.placePending();
  assert.deepEqual(
    { worldX: pending.worldX, worldY: pending.worldY, worldZ: pending.worldZ },
    { worldX: 5, worldY: 5, worldZ: 6 },
  );
  assert.equal(starts.length, 1);
  assert.equal(starts[0], pending);
  assert.equal(pendingDeltas.length, 1);
});

test("placement progress and target-facing pose are forwarded to the avatar renderer", () => {
  const player = {
    worldX: 0,
    worldY: 1,
    worldZ: 0,
    localOffsetX: 0.5,
    localOffsetY: 0,
    localOffsetZ: 0.5,
    avatarYaw: 0,
    yaw: 0,
    velocityY: 0,
    grounded: true,
    placementActionUntil: 400,
    placementActionDurationMs: 400,
    placementAimYaw: 1.25,
    placementAimPitch: 0.3,
  };
  const avatar = {};
  const controls = {
    keys: new Set(),
    move: { moving: false, actualMoving: false, dx: 0, dz: 0 },
  };
  const motion = createPlayerMotionController({
    getPlayer: () => player,
    getCamera: () => ({}),
    getControls: () => controls,
    getChunks: () => null,
    getAvatar: () => avatar,
    defaultCollisionBox: createCollisionBox({ halfWidth: 0.3, halfDepth: 0.3, height: 4 }),
  });

  motion.syncAvatarToPlayer(100);
  assert.equal(avatar.yaw, 1.25);
  assert.equal(avatar.animation.placementProgress, 0.25);
  assert.equal(avatar.animation.placementAimPitch, 0.3);

  motion.syncAvatarToPlayer(401);
  assert.equal(avatar.animation.placementProgress, 0);
  assert.equal(avatar.animation.placementAimPitch, 0);
  assert.equal(player.placementAimYaw, null);
});

