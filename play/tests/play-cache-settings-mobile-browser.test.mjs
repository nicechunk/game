import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const playIndexUrl = new URL("../index.html", import.meta.url);
const playStylesUrl = new URL("../styles.css", import.meta.url);

test("mobile settings exposes a full-width cache control with a safe touch target", async () => {
  const [indexSource, styles] = await Promise.all([
    readFile(playIndexUrl, "utf8"),
    readFile(playStylesUrl, "utf8"),
  ]);
  const fixture = indexSource
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b(?![^>]*rel=["']stylesheet["'])[^>]*>/gi, "")
    .replace('href="./styles.css"', 'href="/styles.css"');
  const server = createServer((request, response) => {
    if (request.url === "/styles.css") {
      response.writeHead(200, { "content-type": "text/css" });
      response.end(styles);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(fixture);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      const panel = document.querySelector("#profilePanel");
      const settings = document.querySelector('[data-profile-panel="settings"]');
      panel.hidden = false;
      settings.hidden = false;
    });
    await page.waitForTimeout(220);
    const layout = await page.evaluate(() => {
      const button = document.querySelector("#profileClearCacheButton");
      const card = button.closest(".profile-settings-cache");
      const buttonBox = button.getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        visible: style.display !== "none" && style.visibility !== "hidden",
        width: buttonBox.width,
        height: buttonBox.height,
        cardWidth: cardBox.width,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    assert.equal(layout.visible, true);
    assert.ok(layout.width >= 44, JSON.stringify(layout));
    assert.ok(layout.height >= 44, JSON.stringify(layout));
    assert.ok(layout.cardWidth > 0);
    assert.ok(layout.overflow <= 0);
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
