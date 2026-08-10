import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route(`${origin}/play/tests/placement-pointer-targeting`, (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html lang=\"en\"><body></body></html>",
  }));
  await page.goto(`${origin}/play/tests/placement-pointer-targeting`, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const { createPlayActionHit } = await import("/play/play-action-hit.js");
    const { createPlayAvatarSession } = await import("/play/play-avatar-session.js");
    const { createPlayInputActions } = await import("/play/play-input-actions.js");
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 100;
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 });
    let firstPerson = false;
    const screenCalls = [];
    const actionHit = createPlayActionHit({
      canvas,
      getCamera: () => ({}),
      getChunks: () => ({}),
      getFirstPersonCamera: () => firstPerson,
      updateIntervalMs: 1_000,
      raycastFromScreen: (_camera, x, y) => {
        screenCalls.push([x, y]);
        return { hit: true, worldX: Math.round(x), worldY: 2, worldZ: Math.round(y), faceX: 0, faceY: 1, faceZ: 0 };
      },
      raycastFromCamera: () => ({ hit: true, worldX: 999, worldY: 2, worldZ: 999, faceX: 0, faceY: 1, faceZ: 0 }),
    });

    actionHit.handleCanvasPointerMove({ clientX: 42, clientY: 58, pointerType: "mouse" });
    const firstHover = actionHit.updateForFrame(100, { force: true });
    actionHit.handleCanvasPointerMove({ clientX: 166, clientY: 72, pointerType: "mouse" });
    const movedHover = actionHit.updateForFrame(101);
    actionHit.handleCanvasPointer({ clientX: 177, clientY: 73, pointerType: "mouse" });
    const clickedHit = actionHit.getActionHit(102);
    actionHit.handleCanvasPointerLeave();
    const leftCanvas = actionHit.updateForFrame(103, { force: true });

    firstPerson = true;
    actionHit.handleCanvasPointerMove({ clientX: 31, clientY: 37, pointerType: "mouse" });
    const firstPersonHover = actionHit.updateForFrame(104, { force: true });
    actionHit.handleCanvasPointer({ clientX: 31, clientY: 37, pointerType: "mouse" });
    const firstPersonClick = actionHit.getActionHit(105);

    const pointerListeners = new Map();
    const forwarded = [];
    const pointerCanvas = {
      addEventListener(type, listener) { pointerListeners.set(type, listener); },
    };
    createPlayInputActions({
      elements: { canvas: pointerCanvas },
      onCanvasPointerMove: (event) => forwarded.push(["move", event.clientX, event.clientY]),
      onCanvasPointerLeave: () => forwarded.push(["leave"]),
    }).bind();
    pointerListeners.get("pointermove")({ pointerId: 7, clientX: 88, clientY: 44, pointerType: "mouse" });
    pointerListeners.get("pointerleave")({ pointerId: 7, pointerType: "mouse" });

    const player = { avatarYaw: 0, yaw: 0 };
    const avatarSession = createPlayAvatarSession({
      getPlayer: () => player,
      getPlayerWorldFloat: () => [0.5, 1, 0.5],
      playerBodyHeight: 4,
      placementActionDurationMs: 360,
    });
    const placementStartedAt = performance.now();
    avatarSession.startPlacementAction({ target: { worldX: 3, worldY: 2, worldZ: 0 } });

    return {
      firstHover,
      movedHover,
      clickedHit,
      leftCanvas,
      firstPersonHover,
      firstPersonClick,
      screenCalls,
      forwarded,
      placementDuration: player.placementActionDurationMs,
      placementWindow: player.placementActionUntil - player.placementActionStartedAt,
      placementStarted: player.placementActionStartedAt >= placementStartedAt,
      placementYaw: player.placementAimYaw,
      placementPitch: player.placementAimPitch,
    };
  });

  assert.equal(result.firstHover.worldX, 42);
  assert.equal(result.firstHover.worldZ, 58);
  assert.equal(result.movedHover.worldX, 166, "a dirty pointer must bypass the slower stationary refresh interval");
  assert.equal(result.clickedHit.worldX, 177, "third-person placement must consume the clicked mouse ray");
  assert.equal(result.leftCanvas.hit, false, "leaving the canvas must remove the mouse placement preview");
  assert.equal(result.firstPersonHover.worldX, 999, "first-person preview must keep the camera-centre ray");
  assert.equal(result.firstPersonClick.worldX, 110, "first-person clicks must use the visual crosshair centre");
  assert.deepEqual(result.screenCalls.at(-1), [110, 70]);
  assert.deepEqual(result.forwarded, [["move", 88, 44], ["leave"]]);
  assert.equal(result.placementDuration, 360);
  assert.equal(result.placementWindow, 360);
  assert.equal(result.placementStarted, true);
  assert.ok(Number.isFinite(result.placementYaw));
  assert.ok(Number.isFinite(result.placementPitch));
} finally {
  await browser.close();
}

