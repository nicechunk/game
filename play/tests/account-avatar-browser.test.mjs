import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.route(`${origin}/play/tests/account-avatar`, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><style>
      .account-avatar { position: relative; display: block; width: 64px; height: 64px; overflow: hidden; }
      .account-avatar-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    </style></head><body><span class="account-avatar" id="accountAvatar"></span></body></html>`,
  }));
  await page.goto(`${origin}/play/tests/account-avatar`, { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { createAccountAvatarSnapshot } = await import("/play/play-account-avatar.js");
    const element = document.querySelector("#accountAvatar");
    const snapshot = createAccountAvatarSnapshot({
      element,
      getModelCode: () => "NCM:peasant_guy:v1",
      scheduleTask(callback) {
        callback();
        return () => {};
      },
    });
    const firstRender = snapshot.render();
    const canvas = element.querySelector("canvas[data-account-avatar-snapshot]");
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let opaquePixels = 0;
    for (let offset = 3; offset < pixels.length; offset += 4) {
      if (pixels[offset] > 0) opaquePixels += 1;
    }
    const secondRender = snapshot.render();
    const canvasesBeforeDispose = document.querySelectorAll("canvas").length;
    snapshot.dispose();
    return {
      firstRender,
      secondRender,
      state: element.dataset.avatarState,
      width: canvas.width,
      height: canvas.height,
      opaquePixels,
      canvasesBeforeDispose,
      canvasesAfterDispose: document.querySelectorAll("canvas").length,
    };
  });

  assert.equal(result.firstRender, true);
  assert.equal(result.secondRender, false);
  assert.equal(result.state, "ready");
  assert.deepEqual([result.width, result.height], [128, 128]);
  assert.ok(result.opaquePixels > 1_000);
  assert.equal(result.canvasesBeforeDispose, 2);
  assert.equal(result.canvasesAfterDispose, 1);
} finally {
  await browser.close();
}
