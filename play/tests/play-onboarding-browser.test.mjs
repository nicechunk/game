import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "../..");
const files = new Map();
const requests = new Map();
let server;
let origin;

before(async () => {
  for (const [url, file, contentType] of [
    ["/play/play-onboarding-loader.js", "play/play-onboarding-loader.js", "text/javascript"],
    ["/play/play-onboarding.js", "play/play-onboarding.js", "text/javascript"],
    ["/play/play-onboarding.css", "play/play-onboarding.css", "text/css"],
    ["/src/i18n.js", "src/i18n.js", "text/javascript"],
    ["/play/locales/en.json", "public/play/locales/en.json", "application/json"],
  ]) {
    files.set(url, { body: await readFile(resolve(root, file)), contentType });
  }
  server = createServer(handleRequest);
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolveClose) => server.close(resolveClose));
});

test("completed wallets do not download the full onboarding module or stylesheet", async () => {
  resetRequests();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(() => {
      localStorage.setItem("nicechunk.walletAddress", "wallet-complete");
      localStorage.setItem("nicechunk.onboarding.v1.wallet-complete", JSON.stringify({
        completed: ["basics", "equipment", "session", "foundation", "smelting", "market"],
      }));
    });
    await page.goto(`${origin}/fixture`, { waitUntil: "networkidle" });
    await page.waitForTimeout(850);
    assert.equal(count("/play/play-onboarding.js"), 0);
    assert.equal(count("/play/play-onboarding.css"), 0);
    assert.equal(await page.locator(".nc-onboarding").count(), 0);
    assert.equal(await page.evaluate(() => globalThis.NiceChunkOnboarding.snapshot().observing), false);
  } finally {
    await browser.close();
  }
});

test("the first world visit loads the guide on demand and saves completion per wallet", async () => {
  resetRequests();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(() => localStorage.setItem("nicechunk.walletAddress", "wallet-first"));
    await page.goto(`${origin}/fixture`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.nc-onboarding[data-feature="basics"].is-visible');
    assert.equal(count("/play/play-onboarding.js"), 1);
    assert.equal(count("/play/play-onboarding.css"), 1);
    assert.equal(await page.locator("[data-onboarding-title]").textContent(), "World controls");
    for (let index = 0; index < 4; index += 1) await page.locator("[data-onboarding-primary]").click();
    await page.waitForSelector(".nc-onboarding", { state: "detached" });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("nicechunk.onboarding.v1.wallet-first")));
    assert.ok(stored.completed.includes("basics"));
  } finally {
    await browser.close();
  }
});

test("mobile onboarding remains clear of the joystick and hotbar", async () => {
  resetRequests();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("nicechunk.walletAddress", "wallet-mobile"));
    await page.goto(`${origin}/fixture`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.nc-onboarding[data-feature="basics"].is-visible');
    const layout = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        card: rect(".nc-onboarding-card"),
        joystick: rect("#joystick"),
        hotbar: rect("#hotbar"),
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    assert.ok(layout.card.left >= 0 && layout.card.right <= layout.viewport.width);
    assert.ok(layout.card.top >= 0 && layout.card.bottom <= layout.viewport.height);
    assert.ok(layout.card.bottom < layout.joystick.top);
    assert.ok(layout.card.bottom < layout.hotbar.top);
    assert.ok(layout.scrollWidth <= layout.viewport.width);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("contextual equipment guidance uses a live RPC rent estimate", async () => {
  resetRequests();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 768 } });
    await context.route("https://explorer-api.devnet.solana.com/", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: 49898928 }),
      });
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("nicechunk.walletAddress", "wallet-equipment");
      localStorage.setItem("nicechunk.onboarding.v1.wallet-equipment", JSON.stringify({ completed: ["basics"] }));
    });
    await page.goto(`${origin}/equipment`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.nc-onboarding[data-feature="equipment"].is-visible');
    await page.waitForFunction(() => document.querySelector(".nc-onboarding-cost")?.textContent.includes("0.049898928 SOL"));
    assert.match(await page.locator(".nc-onboarding-cost").textContent(), /Refundable account deposit/);
    assert.match(await page.locator(".nc-onboarding-cost").textContent(), /0\.049898928 SOL/);
    await context.close();
  } finally {
    await browser.close();
  }
});

function handleRequest(request, response) {
  const path = new URL(request.url, "http://localhost").pathname;
  requests.set(path, count(path) + 1);
  const asset = files.get(path);
  if (asset) {
    response.writeHead(200, { "content-type": `${asset.contentType}; charset=utf-8`, "cache-control": "no-store" });
    response.end(asset.body);
    return;
  }
  if (path === "/fixture" || path === "/equipment") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixtureHtml(path === "/equipment"));
    return;
  }
  response.writeHead(404).end("not found");
}

function fixtureHtml(equipment) {
  return `<!doctype html>
  <html lang="en" data-i18n-scope="play" data-i18n-build-version="onboarding-test">
    <head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#97c9d3;font-family:sans-serif}
      #worldCanvas{position:fixed;inset:0;width:100%;height:100%;background:linear-gradient(145deg,#dce4d2,#77a98e)}
      #joystick{position:fixed;left:25px;bottom:76px;width:82px;height:82px;border-radius:50%;background:#536d57}
      #hotbar{position:fixed;left:8px;right:8px;bottom:8px;height:54px;background:#eaf3dd}
      #profilePanel{position:fixed;inset:60px 110px;background:#d8edf3}
      #profileEquipmentBrowserList{position:absolute;left:30px;top:100px;width:45%;height:380px;background:#bfdce7}
      #profileEquipmentBrowserDetail{position:absolute;right:30px;top:100px;width:38%;height:380px;background:#c9e2eb}
    </style></head>
    <body>
      <canvas id="worldCanvas"></canvas><div id="joystick"></div><div id="hotbar"></div>
      ${equipment ? `<section id="profilePanel"><button data-profile-tab="equipment" aria-selected="true">Equipment</button><div id="profileEquipmentBrowserList"></div><div id="profileEquipmentBrowserDetail"></div></section>` : ""}
      <script src="/play/play-onboarding-loader.js" defer data-nicechunk-onboarding data-module="/play/play-onboarding.js" data-style="/play/play-onboarding.css"></script>
    </body>
  </html>`;
}

function count(path) {
  return requests.get(path) || 0;
}

function resetRequests() {
  requests.clear();
}
