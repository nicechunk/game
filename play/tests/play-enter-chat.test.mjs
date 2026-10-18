import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startStaticServer } from "../../scripts/serve-static-site.mjs";

const server = await startStaticServer({ rootDirectory: new URL("../..", import.meta.url).pathname });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route(`${server.baseUrl}/chat-keyboard`, (route) => route.fulfill({
    contentType: "text/html",
    body: '<canvas></canvas><form id="chat" hidden><input id="message"></form><input id="other">',
  }));
  await page.goto(`${server.baseUrl}/chat-keyboard`);
  await page.evaluate(async () => {
    const { createPlayInputActions } = await import("/play/play-input-actions.js");
    const { createPlayDebugController } = await import("/play/play-debug-controller.js");
    window.sent = [];
    window.confirmed = 0;
    window.opened = 0;
    const controller = createPlayDebugController({
      elements: { commandForm: document.querySelector("#chat"), commandInput: document.querySelector("#message") },
      canvas: document.querySelector("canvas"),
      setStatus() {},
      onChatMessage: (text) => { window.sent.push(text); return true; },
    });
    controller.bind();
    createPlayInputActions({
      getDebugController: () => controller,
      openDebugCommandLine: (value) => { window.opened++; controller.openCommandLine(value); },
      getPlacement: () => ({ pendingCount: () => 1, confirmLast: () => window.confirmed++ }),
    }).bind();
    document.querySelector("canvas").focus();
  });
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#message").evaluate((input) => document.activeElement === input), true);
  await page.keyboard.insertText("hello forge");
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => sent), ["hello forge"]);
  assert.equal(await page.locator("#chat").evaluate((form) => form.hidden), true);
  assert.equal(await page.evaluate(() => confirmed), 0);
  assert.equal(await page.evaluate(() => opened), 1, "submitting must not reopen chat on the same key event");

  await page.keyboard.press("NumpadEnter");
  assert.equal(await page.locator("#message").evaluate((input) => document.activeElement === input), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#chat").evaluate((form) => form.hidden), true);
  await page.keyboard.press("/");
  assert.equal(await page.locator("#message").inputValue(), "/");
  await page.keyboard.press("Escape");
  await page.locator("#other").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#chat").evaluate((form) => form.hidden), true);
  await page.locator("canvas").focus();
  for (const options of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { ctrlKey: true }]) {
    await page.evaluate((options) => window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", bubbles: true, cancelable: true, ...options,
    })), options);
    assert.equal(await page.locator("#chat").evaluate((form) => form.hidden), true);
  }
} finally {
  await browser.close();
  await server.close();
}
