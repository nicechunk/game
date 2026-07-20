import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    screen: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.route(`${origin}/play/tests/mobile-landscape-layout`, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html>
      <html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/play/styles.css"></head><body>
        <button class="account-hud"><span class="account-avatar"></span><span class="account-copy"><span class="account-row"><strong>Player</strong></span><span id="accountBalance"><svg class="account-solana-icon"></svg>1 SOL</span></span></button>
        <section class="play-panel backpack-panel" data-inventory-mode="inventory">
          <header class="backpack-header"><span class="backpack-heading"><strong>Inventory</strong></span><span class="backpack-header-actions"><button id="closeBackpackButton">x</button></span></header>
          <div class="backpack-inventory-view"><div class="backpack-layout">
            <nav class="backpack-categories"><button><i></i><span>All</span></button><button><i></i><span>Blocks</span></button></nav>
            <div class="backpack-inventory"><div class="backpack-grid"></div></div>
            <aside class="backpack-detail"><strong>No item selected</strong></aside>
          </div></div>
        </section>
        <div class="map-overlay open"><div class="map-modal"><div class="map-guardian-status">Connected</div><canvas id="largeMinimap"></canvas><form class="map-teleport"><label>X<input></label><label>Z<input></label><button>Load</button><span class="map-teleport-status"></span></form></div></div>
      </body></html>`,
  }));
  await page.goto(`${origin}/play/tests/mobile-landscape-layout`, { waitUntil: "networkidle" });

  const result = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    return {
      coarse: matchMedia("(pointer: coarse)").matches,
      avatarDisplay: getComputedStyle(document.querySelector(".account-avatar")).display,
      account: rect(".account-hud"),
      backpack: rect(".backpack-panel"),
      backpackColumns: getComputedStyle(document.querySelector(".backpack-layout")).gridTemplateColumns,
      map: rect(".map-modal"),
      mapColumns: getComputedStyle(document.querySelector(".map-modal")).gridTemplateColumns,
    };
  });

  assert.equal(result.coarse, true);
  assert.equal(result.avatarDisplay, "none");
  assert.ok(result.account.width <= 164.5);
  assertInsideViewport(result.account);
  assertInsideViewport(result.backpack);
  assert.ok(result.backpack.width > 820);
  assert.equal(result.backpackColumns.split(" ").length, 3);
  assertInsideViewport(result.map);
  assert.equal(result.mapColumns.split(" ").length, 2);
  await context.close();
} finally {
  await browser.close();
}

function assertInsideViewport(rect) {
  assert.ok(rect.left >= -1, `left edge escaped the viewport: ${rect.left}`);
  assert.ok(rect.top >= -1, `top edge escaped the viewport: ${rect.top}`);
  assert.ok(rect.right <= 845, `right edge escaped the viewport: ${rect.right}`);
  assert.ok(rect.bottom <= 391, `bottom edge escaped the viewport: ${rect.bottom}`);
}
