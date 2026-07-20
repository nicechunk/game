import assert from "node:assert/strict";
import test from "node:test";

import { ThirdPersonPlayerControls } from "../../chunk.js/input/controls.js";
import { cameraForward, createCameraState } from "../../chunk.js/renderer/camera.js";
import { createPlayInputActions } from "../play-input-actions.js";
import { createPlayerMotionController } from "../player-motion-controller.js";

test("first-person camera uses player eye height and control direction", () => {
  const player = {
    worldX: 10,
    worldY: 20,
    worldZ: 30,
    localOffsetX: 0.25,
    localOffsetY: 0.5,
    localOffsetZ: 0.75,
    controlYaw: Math.PI * 0.5,
    avatarYaw: 0,
    yaw: 0,
    cameraPitch: 0.3,
  };
  const camera = createCameraState();
  const motion = createPlayerMotionController({
    getPlayer: () => player,
    getCamera: () => camera,
    config: {
      firstPersonEyeHeight: 3.8,
      firstPersonCameraBackDistance: 0.16,
      cameraPitchMax: 0.18,
      firstPersonPitchMax: 0.42,
    },
  });

  assert.equal(motion.setFirstPersonCameraEnabled(true), true);
  motion.syncCameraToPlayer(1 / 60, { force: true });

  const position = motion.cameraWorldFloat();
  assert.ok(close(position[0], 10.41));
  assert.ok(close(position[1], 24.3));
  assert.ok(close(position[2], 30.75));
  const forward = cameraForward(camera);
  assert.ok(close(forward[0], -Math.cos(0.3)));
  assert.ok(close(forward[1], Math.sin(0.3)));
  assert.ok(close(forward[2], 0));
  assert.ok(close(player.avatarYaw, player.controlYaw));

  assert.equal(motion.toggleFirstPersonCamera(), false);
  assert.equal(player.cameraPitch, 0.18);
});

test("first-person controls use pointer-lock deltas and restore third-person pitch limits", () => {
  const environment = installInputEnvironment();
  try {
    const player = { controlYaw: 0, avatarYaw: 0, yaw: 0, cameraPitch: 0.1 };
    const camera = createCameraState({ pitch: 0.1 });
    const controls = new ThirdPersonPlayerControls(environment.canvas, camera, player, {
      lookSpeed: 0.01,
      pitchSpeed: 0.01,
      pitchMin: -0.5,
      pitchMax: 0.2,
      firstPersonPitchMin: -1,
      firstPersonPitchMax: 0.6,
    });

    controls.setFirstPersonEnabled(true);
    assert.equal(environment.pointerLockRequests(), 1);
    environment.document.pointerLockElement = environment.canvas;
    environment.documentListeners.get("mousemove")({ movementX: 10, movementY: -80 });
    assert.ok(close(player.controlYaw, -0.1));
    assert.equal(player.cameraPitch, 0.6);

    controls.setFirstPersonEnabled(false);
    assert.equal(player.cameraPitch, 0.2);
    assert.equal(environment.pointerLockExits(), 1);
    controls.dispose();
  } finally {
    environment.restore();
  }
});

test("E toggles first person only for an unmodified non-repeating gameplay key", () => {
  const environment = installInputEnvironment();
  try {
    let toggles = 0;
    createPlayInputActions({
      toggleFirstPersonCamera: () => {
        toggles += 1;
      },
    }).bind();
    const keydown = environment.windowListeners.get("keydown");

    const accepted = keyboardEvent();
    keydown(accepted);
    assert.equal(toggles, 1);
    assert.equal(accepted.prevented, true);

    keydown(keyboardEvent({ repeat: true }));
    keydown(keyboardEvent({ ctrlKey: true }));
    environment.document.activeElement = { tagName: "INPUT" };
    keydown(keyboardEvent());
    assert.equal(toggles, 1);
  } finally {
    environment.restore();
  }
});

function installInputEnvironment() {
  const originalAddEventListener = globalThis.addEventListener;
  const originalRemoveEventListener = globalThis.removeEventListener;
  const originalDocument = globalThis.document;
  const windowListeners = new Map();
  const documentListeners = new Map();
  const canvasListeners = new Map();
  let lockRequests = 0;
  let lockExits = 0;
  const canvas = {
    addEventListener(type, listener) {
      canvasListeners.set(type, listener);
    },
    removeEventListener(type) {
      canvasListeners.delete(type);
    },
    requestPointerLock() {
      lockRequests += 1;
    },
    setPointerCapture() {},
  };
  const document = {
    activeElement: null,
    pointerLockElement: null,
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    removeEventListener(type) {
      documentListeners.delete(type);
    },
    exitPointerLock() {
      lockExits += 1;
      this.pointerLockElement = null;
    },
  };
  globalThis.addEventListener = (type, listener) => windowListeners.set(type, listener);
  globalThis.removeEventListener = (type) => windowListeners.delete(type);
  globalThis.document = document;
  return {
    canvas,
    document,
    windowListeners,
    documentListeners,
    pointerLockRequests: () => lockRequests,
    pointerLockExits: () => lockExits,
    restore() {
      if (originalAddEventListener === undefined) delete globalThis.addEventListener;
      else globalThis.addEventListener = originalAddEventListener;
      if (originalRemoveEventListener === undefined) delete globalThis.removeEventListener;
      else globalThis.removeEventListener = originalRemoveEventListener;
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
    },
  };
}

function keyboardEvent(overrides = {}) {
  return {
    code: "KeyE",
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...overrides,
  };
}

function close(actual, expected, epsilon = 1e-6) {
  return Math.abs(actual - expected) <= epsilon;
}
