import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

test("bare collection faces its captured target through the production avatar and motion sessions", async () => {
  const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/play/tests/bare-hand-facing-browser.test.mjs");
    const result = await page.evaluate(async () => {
      const { createPlayAvatarSession } = await import("/play/play-avatar-session.js");
      const { createPlayerMotionController } = await import("/play/player-motion-controller.js");
      const { createMiningController } = await import("/play/mining-controller.js");
      const { createPlayPlayerSession } = await import("/play/play-player-session.js");
      const { createCameraState } = await import("/chunk.js/renderer/camera.js");
      const { createCollisionBox } = await import("/chunk.js/input/collision.js");
      const { updateAvatarMeshVertices, AVATAR_VERTEX_STRIDE_FLOATS } = await import("/chunk.js/renderer/avatar-mesh.js");
      let checks = 0;
      function check(value, message) { checks++; if (!value) throw Error(message); }
      function near(a, b) { return Math.abs(a - b) < 1e-8; }
      async function harness({ position = [-10.25, 20.125, -30.75], kind = "bare-leaves" } = {}) {
        let session, hit = { hit: true, worldX: -7, worldY: 23, worldZ: -31, blockId: 23, resourceId: 10 };
        const player = { avatarYaw: 1.13, yaw: 1.13, controlYaw: -0.67, cameraPitch: 0.1, velocityY: 0, grounded: true };
        for (let i = 0; i < 3; i++) {
          const axis = ["X", "Y", "Z"][i]; player["world" + axis] = Math.floor(position[i]); player["localOffset" + axis] = position[i] - Math.floor(position[i]);
        }
        const world = () => [player.worldX + player.localOffsetX, player.worldY + player.localOffsetY, player.worldZ + player.localOffsetZ];
        const controls = { keys: new Set(), move: { moving: false, actualMoving: false } };
        const camera = createCameraState();
        const gameState = { hotbarSlots: [], selectedHotbarSlot: 0, getSelectedToolSlot: () => null, playerProfile: { minedBlocks: 0 }, savePlayerProfile() {} };
        const motion = createPlayerMotionController({ getPlayer: () => player, getCamera: () => camera, getControls: () => controls,
          getChunks: () => null, getAvatar: () => session?.avatar(), defaultCollisionBox: createCollisionBox({ halfWidth: .3, halfDepth: .3, height: 4.375 }) });
        session = createPlayAvatarSession({ gameState, getPlayer: () => player, getPlayerWorldFloat: world, getMotion: () => motion,
          getRenderer: () => ({ uploadAvatarMesh() {} }), visualScale: (1.75 / .4) / 2.52, playerBodyHeight: 4.375 });
        await session.init(); check(!!session.avatar(), "production avatar must initialize");
        const pose = createPlayPlayerSession({ getPlayer: () => player, getPlayerWorldFloat: world, getCamera: () => camera });
        const controller = createMiningController({ gameState, chunks: { getBlockAtWorld: () => 23 }, getHit: () => hit,
          getPlayerBounds: () => ({ x: world()[0], y: world()[1], z: world()[2], height: 4.375 }),
          getBareHandPlan: target => target?.hit ? { kind, blocks: [{ ...target }], requiredDamage: kind === "surface-pebble" ? 1 : 3 } : null,
          getToolTargetingSolution: () => { throw Error("bare collection must not request equipped-tool targeting"); },
          getSkillEffects: () => { throw Error("bare collection must not read Skills"); },
          blockDef: () => ({ name: "Leaves", resourceId: 10, hardness: 1 }), isFluidBlock: () => false, isMineableBlock: id => id === 23,
          blockAirId: 0, onSwingStart: swing => session.startMiningSwing(swing) });
        return { player, session, motion, controller, controls, pose, world, setHit: value => { hit = value; } };
      }
      function faceDot(h, target) {
        const [x, , z] = h.world(), dx = target.worldX + .5 - x, dz = target.worldZ + .5 - z;
        return (-Math.sin(h.session.avatar().yaw) * dx - Math.cos(h.session.avatar().yaw) * dz) / Math.hypot(dx, dz);
      }
      function frame(h, fraction = .64) {
        h.motion.syncCameraToPlayer(1 / 60);
        h.session.syncAvatarToPlayer(h.player.miningSwingStartedAt + h.player.miningSwingDurationMs * fraction);
      }
      const headings = [];
      for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [3, -3], [-3, 3], [-3, -3]]) {
        const h = await harness(), [x, y, z] = h.world();
        const target = { hit: true, worldX: Math.floor(x) + dx, worldY: Math.floor(y) + 3, worldZ: Math.floor(z) + dz, blockId: 23, resourceId: 10 };
        h.setHit(target); const swing = h.controller.minePending();
        check(swing?.miningTool.kind === "bare-hands", "empty hands must start a real bare swing");
        check(swing.aimYaw === null, "the regression must exercise a missing tool-solver yaw");
        frame(h); check(faceDot(h, target) > .999999, "avatar must face the clicked leaf in every quadrant");
        check(near(h.player.avatarYaw, h.player.yaw) && near(h.player.avatarYaw, h.pose.currentGuardianPose().yaw), "local and outgoing Guardian headings must agree");
        const vertices = updateAvatarMeshVertices(h.session.avatarMesh(), h.session.avatar().animation);
        check(vertices.length > 0 && Array.from(vertices).every(Number.isFinite), "target-facing pose must produce finite rendered vertices");
        // The raised arm must extend forward in the same heading as the torso.
        let cursor = 0, armZ = 0, count = 0;
        for (const part of h.session.avatarMesh().parts) {
          const size = part.geometry ? part.geometry.vertices.length / AVATAR_VERTEX_STRIDE_FLOATS : 24;
          if (part.bone === "right_arm") for (let i = 0; i < size; i++) { armZ += vertices[(cursor + i) * AVATAR_VERTEX_STRIDE_FLOATS + 2]; count++; }
          cursor += size;
        }
        check(count > 0 && armZ / count < -.1, "the animated hand must extend toward the leaf");
        check(near(h.player.controlYaw, -.67), "third-person targeting must preserve the camera orbit");
        headings.push(h.player.avatarYaw);
      }
      const repeated = await harness();
      const firstTarget = { hit: true, worldX: -7, worldY: 23, worldZ: -31, blockId: 23, resourceId: 10 };
      repeated.setHit(firstTarget);
      for (let i = 0; i < 3; i++) {
        const swing = repeated.controller.minePending(); frame(repeated);
        check(faceDot(repeated, firstTarget) > .999999, "all three leaf contacts must face the same target");
        repeated.controller.update(swing.endsAt + 1);
      }
      check(repeated.controller.pendingCount() === 1, "three bare contacts must still queue exactly one harvest");
      const pending = repeated.controller.pendingSnapshot()[0];
      check(pending.miningTool.kind === "bare-hands" && pending.toolDamage === undefined, "turning must not introduce local durability damage");
      const changed = await harness(); changed.setHit(firstTarget);
      const first = changed.controller.minePending(), yaw = changed.player.avatarYaw;
      const next = { ...firstTarget, worldX: -11, worldZ: -35 };
      changed.setHit(next); check(changed.controller.minePending() === first && near(changed.player.avatarYaw, yaw), "a new click must not redirect an active swing");
      firstTarget.worldX = 1000; frame(changed);
      check(near(changed.player.avatarYaw, yaw), "mutating an old raycast must not move the captured aim");
      changed.controller.update(first.endsAt + 1); changed.controller.minePending(); frame(changed);
      check(faceDot(changed, next) > .999999, "the next swing must turn toward its new leaf");
      changed.player.avatarYaw = 2.9; changed.player.yaw = 2.9; changed.controls.move.moving = true;
      frame(changed); check(faceDot(changed, next) > .999999, "movement must not override the swing heading");
      changed.session.syncAvatarToPlayer(changed.player.miningSwingUntil + 1);
      check(changed.player.miningAimYaw === null && changed.session.avatar().animation.miningProgress === 0, "the heading lock must expire with the action");
      const heights = [];
      for (const level of [21, 27]) {
        const h = await harness(); h.setHit({ hit: true, worldX: -7, worldY: level, worldZ: -31, blockId: 25, resourceId: 10 });
        h.controller.minePending(); frame(h); heights.push(h.session.avatar().animation.miningAimPitch);
      }
      check(heights[0] < 0 && heights[1] > 0, "lower and higher leaves must lower and raise the hand aim");
      const overhead = await harness({ position: [10.5, 20, 30.5] });
      overhead.setHit({ hit: true, worldX: 10, worldY: 28, worldZ: 30, blockId: 23, resourceId: 10 });
      overhead.controller.minePending(); frame(overhead);
      check(near(overhead.player.avatarYaw, 1.13) && overhead.player.miningAimPitch === 1.2, "directly overhead leaves must keep the current heading and clamp arm aim");
      const firstPerson = await harness(); firstPerson.motion.setFirstPersonCameraEnabled(true); firstPerson.setHit(next);
      firstPerson.controller.minePending(); frame(firstPerson);
      check(faceDot(firstPerson, next) > .999999, "first-person camera synchronization must not cancel the target-facing pose");
      firstPerson.session.syncAvatarToPlayer(firstPerson.player.miningSwingUntil + 1);
      check(near(firstPerson.player.avatarYaw, firstPerson.player.controlYaw), "first-person heading must return to camera controls after the swing");
      const explicit = await harness(); explicit.session.startMiningSwing({ aimYaw: 0, aimPitch: .25, hit: next }); frame(explicit);
      check(explicit.player.avatarYaw === 0 && explicit.player.miningAimPitch === .25, "equipped solver yaw zero must remain a valid explicit solution");
      for (const invalid of [null, undefined, NaN, Infinity, "", false]) {
        const h = await harness(); h.session.startMiningSwing({ aimYaw: invalid });
        check(h.player.avatarYaw === 1.13 && h.player.miningAimYaw === null, "missing/invalid angles without a target must not turn the player north");
      }
      const blocked = await harness(); blocked.setHit({ ...next, worldX: 500 });
      check(blocked.controller.minePending() === null && blocked.player.avatarYaw === 1.13, "rejected out-of-reach targets must not rotate the player");
      const pebble = await harness({ kind: "surface-pebble" }); pebble.setHit(next); pebble.controller.minePending(); frame(pebble);
      check(faceDot(pebble, next) > .999999, "surface pickup must use the same target-facing correction");
      return { checks, compassHeadings: headings.length, repeatedLeafContacts: 3, explicitToolYawPreserved: true, skillReads: 0 };
    });
    assert.equal(result.compassHeadings, 8);
    assert.ok(result.checks >= 90);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ bareHandFacingPassed: true, ...result }));
  } finally {
    await browser.close();
  }
});
