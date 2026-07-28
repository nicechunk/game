import assert from "node:assert/strict";
import test from "node:test";

import { ThirdPersonPlayerControls } from "../../chunk.js/input/controls.js";
import { createCameraState } from "../../chunk.js/renderer/camera.js";
import { createPlayInputActions } from "../play-input-actions.js";

test("a held mobile joystick keeps a stable world heading while the camera follows behind", () => {
  const environment = installInputEnvironment();
  try {
    const player = { controlYaw: 0, avatarYaw: 0, yaw: 0, cameraPitch: -0.4 };
    const controls = new ThirdPersonPlayerControls(environment.canvas, createCameraState(), player, {
      speed: 10,
      lookSpeed: 0.01,
      joystickDeadzone: 0.1,
      joystickCameraFollowSpeed: 2,
    });

    controls.setJoystick(1, 0, true);
    controls.update(0.1);
    assert.ok(close(controls.move.yaw, -Math.PI * 0.5));
    assert.ok(close(controls.move.dx, 1));
    assert.ok(close(controls.move.dz, 0));
    assert.ok(close(player.controlYaw, -0.2));

    for (let frame = 0; frame < 10; frame += 1) controls.update(0.1);
    assert.ok(close(controls.move.yaw, -Math.PI * 0.5));
    assert.ok(close(player.controlYaw, -Math.PI * 0.5));

    controls.updateLook(-50, 0);
    const draggedError = angleDistance(player.controlYaw, controls.move.yaw);
    controls.update(0.1);
    assert.ok(close(controls.move.yaw, -Math.PI * 0.5));
    assert.ok(angleDistance(player.controlYaw, controls.move.yaw) < draggedError);

    controls.setJoystick(0, -1, true);
    controls.update(0.1);
    assert.ok(close(controls.move.yaw, 0));

    controls.setJoystick(0, 0, false);
    player.controlYaw = 0.7;
    controls.setJoystick(0, -1, true);
    controls.update(0.1);
    assert.ok(close(controls.move.yaw, 0.7));
    controls.dispose();
  } finally {
    environment.restore();
  }
});

test("mobile joystick deadzone and analog travel allow precise one-thumb movement", () => {
  const environment = installInputEnvironment();
  try {
    const player = { controlYaw: 0, avatarYaw: 0, yaw: 0, cameraPitch: -0.4 };
    const controls = new ThirdPersonPlayerControls(environment.canvas, createCameraState(), player, {
      speed: 10,
      joystickDeadzone: 0.12,
    });

    controls.setJoystick(0, -0.08, true);
    controls.update(0.1);
    assert.equal(controls.move.moving, false);
    assert.equal(controls.move.strength, 0);

    controls.setJoystick(0, -0.56, true);
    controls.update(0.1);
    assert.ok(close(controls.move.strength, 0.5));
    assert.ok(close(controls.move.dx, 0));
    assert.ok(close(controls.move.dz, -0.5));
    controls.dispose();
  } finally {
    environment.restore();
  }
});

test("the visual joystick clamps diagonal touches to its circular travel", () => {
  const environment = installInputEnvironment();
  try {
    const baseListeners = new Map();
    const calls = [];
    const base = {
      addEventListener(type, listener) {
        baseListeners.set(type, listener);
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 100, height: 100 };
      },
      setPointerCapture() {},
    };
    const knob = { style: {} };
    createPlayInputActions({
      elements: { joystick: base, joystickKnob: knob },
      getControls: () => ({
        setJoystick(x, y, active) {
          calls.push({ x, y, active });
        },
      }),
    }).bind();

    baseListeners.get("pointerdown")({ pointerId: 4, clientX: 100, clientY: 100 });
    const pressed = calls.at(-1);
    assert.ok(close(Math.hypot(pressed.x, pressed.y), 1));
    assert.ok(close(pressed.x, Math.SQRT1_2));
    assert.ok(close(pressed.y, Math.SQRT1_2));

    baseListeners.get("pointerup")({ pointerId: 4 });
    assert.deepEqual(calls.at(-1), { x: 0, y: 0, active: false });
  } finally {
    environment.restore();
  }
});

function installInputEnvironment() {
  const originalAddEventListener = globalThis.addEventListener;
  const originalRemoveEventListener = globalThis.removeEventListener;
  const originalDocument = globalThis.document;
  const windowListeners = new Map();
  const canvasListeners = new Map();
  const canvas = {
    addEventListener(type, listener) {
      canvasListeners.set(type, listener);
    },
    removeEventListener(type) {
      canvasListeners.delete(type);
    },
    setPointerCapture() {},
  };
  globalThis.addEventListener = (type, listener) => windowListeners.set(type, listener);
  globalThis.removeEventListener = (type) => windowListeners.delete(type);
  globalThis.document = {
    activeElement: null,
    pointerLockElement: null,
    addEventListener() {},
    removeEventListener() {},
  };
  return {
    canvas,
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

function angleDistance(left, right) {
  let delta = left - right;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
}

function close(actual, expected, epsilon = 1e-6) {
  return Math.abs(actual - expected) <= epsilon;
}
