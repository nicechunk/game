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
    ["/play/styles.css", "play/styles.css", "text/css"],
    ["/src/i18n.js", "src/i18n.js", "text/javascript"],
    ["/chunk.js/renderer/camera.js", "chunk.js/renderer/camera.js", "text/javascript"],
    ["/chunk.js/core/math.js", "chunk.js/core/math.js", "text/javascript"],
    ["/play/locales/en.json", "public/play/locales/en.json", "application/json"],
    ["/play/locales/de.json", "public/play/locales/de.json", "application/json"],
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
    assert.equal(await page.locator("[data-onboarding-tile-arrow]").getAttribute("hidden"), "");
    await page.evaluate(() => { globalThis.__onboardingGameState.worldReady = true; });

    await page.waitForFunction(() => Boolean(globalThis.__onboardingGameState.highlightedBlock));
    const moveStep = await page.evaluate(() => {
      const target = globalThis.__onboardingGameState.highlightedBlock;
      const position = globalThis.__onboardingGameState.position;
      const curtainArea = [...document.querySelectorAll("[data-curtain]")]
        .reduce((area, element) => area + element.getBoundingClientRect().width * element.getBoundingClientRect().height, 0);
      return {
        target,
        distance: Math.hypot(target.worldX - Math.floor(position[0]), target.worldZ - Math.floor(position[2])),
        arrowVisible: !document.querySelector("[data-onboarding-tile-arrow]").hidden,
        focusCount: document.querySelectorAll(".nc-onboarding-focus").length,
        curtainArea,
      };
    });
    assert.ok(moveStep.distance >= 3 && moveStep.distance <= 5.01);
    assert.equal(moveStep.target.worldY, 0);
    assert.equal(await page.evaluate(({ worldX, worldZ }) => globalThis.__onboardingGameState.blockedCells.has(`${worldX},${worldZ}`), moveStep.target), false);
    assert.equal(moveStep.arrowVisible, true);
    assert.equal(moveStep.focusCount, 0);
    assert.equal(moveStep.curtainArea, 0);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("nc-onboarding-card")), true);

    await page.evaluate(() => {
      const target = globalThis.__onboardingGameState.highlightedBlock;
      globalThis.__onboardingGameState.position = [target.worldX + 0.5, target.worldY + 1, target.worldZ + 0.5];
    });
    await page.waitForFunction(() => document.querySelector("[data-onboarding-step-title]")?.textContent === "Orbit the camera");
    const orbitState = await page.evaluate(() => {
      const cue = document.querySelector("[data-onboarding-orbit-cue]");
      const rect = cue.getBoundingClientRect();
      return { hidden: cue.hasAttribute("hidden"), display: getComputedStyle(cue).display, width: rect.width, height: rect.height };
    });
    assert.equal(orbitState.hidden, false, JSON.stringify(orbitState));
    assert.ok(orbitState.display !== "none" && orbitState.width > 0 && orbitState.height > 0, JSON.stringify(orbitState));

    await page.evaluate(() => { globalThis.__onboardingGameState.player.controlYaw += 0.35; });
    await page.waitForTimeout(180);
    const cameraStep = await page.evaluate(() => ({
      title: document.querySelector("[data-onboarding-step-title]")?.textContent,
      yaw: globalThis.__onboardingGameState.player.controlYaw,
      cueHidden: document.querySelector("[data-onboarding-orbit-cue]")?.hasAttribute("hidden"),
    }));
    assert.equal(cameraStep.title, "Click a real block", JSON.stringify(cameraStep));
    const sceneLayers = await page.evaluate(() => ({
      focusCount: document.querySelectorAll(".nc-onboarding-focus").length,
      curtainArea: [...document.querySelectorAll("[data-curtain]")]
        .reduce((area, element) => area + element.getBoundingClientRect().width * element.getBoundingClientRect().height, 0),
    }));
    assert.equal(sceneLayers.focusCount, 0);
    assert.equal(sceneLayers.curtainArea, 0);

    const closedImmediately = await page.evaluate(() => {
      dispatchEvent(new CustomEvent("nicechunk:onboarding-real-block-click", {
        detail: { hit: true, worldX: 1, worldY: 0, worldZ: 1, blockId: 1 },
      }));
      return document.querySelector(".nc-onboarding")?.classList.contains("is-visible") === false;
    });
    assert.equal(closedImmediately, true);
    await page.waitForSelector(".nc-onboarding", { state: "detached" });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("nicechunk.onboarding.v1.wallet-first")));
    assert.ok(stored.completed.includes("basics"));
  } finally {
    await browser.close();
  }
});

test("the first pending mine explains Solana fees and opens the readable RPC settings", async () => {
  resetRequests();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(() => {
      localStorage.setItem("nicechunk.walletAddress", "wallet-mining");
      localStorage.setItem("nicechunk.onboarding.v1.wallet-mining", JSON.stringify({
        completed: ["basics", "equipment", "session", "foundation", "smelting", "market"],
      }));
    });
    await page.goto(`${origin}/mining`, { waitUntil: "domcontentloaded" });
    assert.equal(count("/play/play-onboarding.js"), 0);
    await page.evaluate(() => dispatchEvent(new CustomEvent("nicechunk:mining-submission-pending", {
      detail: { txId: "local-pending-1", worldX: 2, worldY: 0, worldZ: 3, blockId: 1 },
    })));
    await page.waitForSelector('.nc-onboarding[data-feature="mining"].is-visible');
    assert.equal(count("/play/play-onboarding.js"), 1);
    assert.match(await page.locator("[data-onboarding-step-body]").textContent(), /persisted on chain/i);
    assert.match(await page.locator("[data-onboarding-formula-code]").textContent(), /5,000/);
    assert.match(await page.locator("[data-onboarding-feature-action-note]").textContent(), /Helius/i);
    await page.locator("[data-onboarding-feature-action]").click();
    await page.waitForSelector("#rpcConfigPanel:not([hidden])");
    await page.waitForSelector(".nc-onboarding", { state: "detached" });
    const rpcStyles = await page.evaluate(() => {
      const dialog = getComputedStyle(document.querySelector(".rpc-config-dialog"));
      const input = getComputedStyle(document.querySelector("#rpcConfigApiKey"));
      const label = getComputedStyle(document.querySelector(".rpc-config-form label"));
      return {
        dialogColor: dialog.color,
        dialogBackground: dialog.backgroundImage,
        inputColor: input.color,
        inputBackground: input.backgroundColor,
        labelColor: label.color,
      };
    });
    assert.equal(rpcStyles.dialogColor, "rgb(16, 47, 74)");
    assert.match(rpcStyles.dialogBackground, /gradient/);
    assert.equal(rpcStyles.inputColor, "rgb(8, 47, 71)");
    assert.match(rpcStyles.inputBackground, /rgba\(255, 255, 255, 0\.86\)/);
    assert.equal(rpcStyles.labelColor, "rgb(56, 86, 109)");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("nicechunk.onboarding.v1.wallet-mining")));
    assert.ok(stored.completed.includes("mining"));
  } finally {
    await browser.close();
  }
});

test("smelting guidance moves the card away from every focused control", async () => {
  resetRequests();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("nicechunk.walletAddress", "wallet-smelting");
      localStorage.setItem("nicechunk.onboarding.v1.wallet-smelting", JSON.stringify({
        completed: ["basics", "equipment", "session", "foundation", "market"],
      }));
    });
    await page.goto(`${origin}/smelting`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.nc-onboarding[data-feature="smelting"].is-visible');
    for (let step = 0; step < 4; step += 1) {
      await page.waitForTimeout(80);
      const layout = await page.evaluate(() => {
        const card = document.querySelector(".nc-onboarding-card").getBoundingClientRect();
        const focus = document.querySelector(".nc-onboarding-focus")?.getBoundingClientRect();
        const intersection = focus
          ? Math.max(0, Math.min(card.right, focus.right) - Math.max(card.left, focus.left))
            * Math.max(0, Math.min(card.bottom, focus.bottom) - Math.max(card.top, focus.top))
          : -1;
        return {
          card: card.toJSON(),
          focus: focus?.toJSON() || null,
          intersection,
          placement: document.querySelector(".nc-onboarding").dataset.cardPlacement,
        };
      });
      assert.ok(layout.focus, `step ${step + 1} should have a visible focus target`);
      assert.equal(layout.intersection, 0, `step ${step + 1} card must not cover the focused control`);
      assert.ok(layout.card.top >= 0 && layout.card.bottom <= 844);
      if (step < 3) await page.locator("[data-onboarding-primary]").click();
    }
    await context.close();
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

test("small-screen guides keep controls visible and clear of the highlighted target", async () => {
  resetRequests();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("nicechunk.language", "de");
      localStorage.setItem("nicechunk.walletAddress", "wallet-small");
      localStorage.setItem("nicechunk.onboarding.v1.wallet-small", JSON.stringify({ completed: ["basics"] }));
    });
    await page.goto(`${origin}/session`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.nc-onboarding[data-feature="session"].is-visible');
    const enteringControls = await page.evaluate(() => [...document.querySelectorAll(".nc-onboarding-header button, .nc-onboarding-actions button")]
      .map((element) => element.getBoundingClientRect().toJSON()));
    assert.ok(enteringControls.every((control) => control.width >= 44 && control.height >= 44));
    await page.waitForTimeout(250);
    const layout = await page.evaluate(() => {
      const rect = (element) => element.getBoundingClientRect().toJSON();
      const card = document.querySelector(".nc-onboarding-card");
      const footer = document.querySelector(".nc-onboarding-footer");
      const focus = document.querySelector(".nc-onboarding-focus");
      const cardRect = rect(card);
      const focusRect = rect(focus);
      return {
        card: cardRect,
        footer: rect(footer),
        focus: focusRect,
        overlap: Math.max(0, Math.min(cardRect.right, focusRect.right) - Math.max(cardRect.left, focusRect.left))
          * Math.max(0, Math.min(cardRect.bottom, focusRect.bottom) - Math.max(cardRect.top, focusRect.top)),
        controls: [...document.querySelectorAll(".nc-onboarding-header button, .nc-onboarding-actions button")]
          .map((element) => rect(element)),
        textOverflow: [...document.querySelectorAll(".nc-onboarding-actions button")]
          .some((element) => element.scrollWidth > element.clientWidth + 1),
      };
    });
    assert.ok(layout.card.top >= 0 && layout.card.bottom <= 568);
    assert.ok(layout.footer.top >= layout.card.top && layout.footer.bottom <= layout.card.bottom + 1);
    assert.equal(layout.overlap, 0);
    assert.equal(layout.textOverflow, false);
    assert.ok(layout.controls.every((control) => control.width >= 44 && control.height >= 44));
    await context.close();
  } finally {
    await browser.close();
  }
});

test("reset query follows a wallet restored after the Loader starts", async () => {
  resetRequests();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(() => {
      localStorage.setItem("nicechunk.onboarding.v1.wallet-restored", JSON.stringify({
        completed: ["basics", "equipment", "session", "foundation", "smelting", "market"],
      }));
    });
    await page.goto(`${origin}/fixture?onboarding=reset`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("nicechunk.walletAddress", "wallet-restored");
      dispatchEvent(new CustomEvent("nicechunk:wallet-session-changed", {
        detail: { walletAddress: "wallet-restored" },
      }));
    });
    await page.waitForSelector('.nc-onboarding[data-feature="basics"].is-visible');
    assert.equal(await page.evaluate(() => localStorage.getItem("nicechunk.onboarding.v1.wallet-restored")), null);
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
  if (["/fixture", "/equipment", "/session", "/mining", "/smelting"].includes(path)) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixtureHtml(path.slice(1)));
    return;
  }
  response.writeHead(404).end("not found");
}

function fixtureHtml(mode) {
  const equipment = mode === "equipment";
  const session = mode === "session";
  const mining = mode === "mining";
  const smelting = mode === "smelting";
  return `<!doctype html>
  <html lang="en" data-i18n-scope="play" data-i18n-build-version="onboarding-test">
    <head><meta name="viewport" content="width=device-width,initial-scale=1">${mining ? '<link rel="stylesheet" href="/play/styles.css">' : ""}<style>
      html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#97c9d3;font-family:sans-serif}
      #worldCanvas{position:fixed;inset:0;width:100%;height:100%;background:linear-gradient(145deg,#dce4d2,#77a98e)}
      #joystick{position:fixed;left:25px;bottom:76px;width:82px;height:82px;border-radius:50%;background:#536d57}
      #hotbar{position:fixed;left:8px;right:8px;bottom:8px;height:54px;background:#eaf3dd}
      #profilePanel{position:fixed;inset:60px 110px;background:#d8edf3}
      #profileEquipmentBrowserList{position:absolute;left:30px;top:100px;width:45%;height:380px;background:#bfdce7}
      #profileEquipmentBrowserDetail{position:absolute;right:30px;top:100px;width:38%;height:380px;background:#c9e2eb}
      #sessionFundingPanel{position:fixed;inset:80px 12%;background:#d8edf3}
      #sessionFundingForm{position:absolute;inset:90px 8% 60px;background:#bfdce7}
      #sessionFundingAmount{position:absolute;left:10%;right:10%;top:48%;width:80%;height:50px}
      .session-funding-actions{position:absolute;left:10%;right:10%;bottom:8%;height:48px}
      #backpackPanel,#smeltingPanel{position:fixed;inset:0}
      #smeltingPanel{display:grid;grid-template-rows:64px 1fr;background:#cde1e8}
      .smelting-test-tabs{display:flex;gap:8px;padding:10px}
      .smelting-test-stage{position:relative;min-height:0}
      [data-smelting-section-panel]{position:absolute;inset:0;padding:22px}
      #smeltingRecipeList{position:absolute;right:18px;top:70px;width:150px;height:260px;background:#91b9c8}
      .nice-smelting-recipe-card{height:62px;margin:8px;background:#e8f5e6}
      #smeltingResourceGrid{position:absolute;left:18px;top:118px;width:158px;height:280px;background:#8fb4c2}
      .nice-smelting-resource-card{width:64px;height:64px;margin:8px;background:#e8f5e6}
      #smeltingFuelSlot{position:absolute;right:28px;top:180px;width:88px;height:88px;background:#e8c671}
      #smeltingStart{position:absolute;right:24px;bottom:86px;width:138px;height:52px}
      #smeltingRecipeDetails{position:absolute;left:24px;bottom:70px;width:180px;height:96px;background:#a7c7d1}
      .rpc-config-panel{z-index:2147483100}
    </style></head>
    <body>
      <canvas id="worldCanvas"></canvas><div id="joystick"></div><div id="hotbar"></div>
      ${equipment ? `<section id="profilePanel"><button data-profile-tab="equipment" aria-selected="true">Equipment</button><div id="profileEquipmentBrowserList"></div><div id="profileEquipmentBrowserDetail"></div></section>` : ""}
      ${session ? `<section id="sessionFundingPanel"><form id="sessionFundingForm"><input id="sessionFundingAmount"><div class="session-funding-actions"></div></form></section>` : ""}
      ${smelting ? `<section id="backpackPanel"><section id="smeltingPanel"><nav class="smelting-test-tabs"><button data-smelting-section="backpack">Backpack</button><button data-smelting-section="furnace">Furnace</button><button data-smelting-section="recipes">Recipes</button></nav><div class="smelting-test-stage"><section data-smelting-section-panel="backpack"><div id="smeltingResourceGrid"><button class="nice-smelting-resource-card selected-input"></button></div></section><section data-smelting-section-panel="furnace"><div id="smeltingFuelSlot"></div><button id="smeltingStart">Start</button></section><section data-smelting-section-panel="recipes"><div id="smeltingRecipeList"><button class="nice-smelting-recipe-card selected"></button></div><div id="smeltingRecipeDetails"></div></section></div></section></section>` : ""}
      ${mining ? `<section class="rpc-config-panel" id="rpcConfigPanel" hidden><div class="rpc-config-dialog"><div class="rpc-config-copy"><strong>RPC</strong><p>RPC connection</p><a href="https://www.helius.dev">Helius</a><div class="rpc-config-explainer"><article><span>Gateway</span><strong>Solana RPC</strong><p>Chain access</p></article></div></div><form class="rpc-config-form"><label for="rpcConfigApiKey">Helius API key</label><div class="rpc-config-row"><input id="rpcConfigApiKey" placeholder="API key"><button type="submit">Save</button><button id="rpcConfigDismiss" type="button">×</button></div></form></div></section>` : ""}
      <script>
        globalThis.__onboardingGameState = {
          worldReady: false,
          position: [0.5, 1, 0.5],
          player: { controlYaw: 0, cameraPitch: -0.35 },
          camera: {
            worldX: 0, worldY: 7, worldZ: -9,
            localOffsetX: 0.5, localOffsetY: 0.5, localOffsetZ: 0.5,
            targetWorldX: 0, targetWorldY: 1, targetWorldZ: 4,
            targetLocalOffsetX: 0.5, targetLocalOffsetY: 0.5, targetLocalOffsetZ: 0.5,
            yaw: 0, pitch: -0.35, fov: 58, aspect: innerWidth / innerHeight, near: 0.08, far: 420,
          },
          highlightedBlock: null,
          blockedCells: new Set(["0,1", "0,2", "0,3"]),
        };
        const chunks = {
          surfaceYAt() { return 1; },
          getBlockAtWorld(_x, y) { return y === 0 ? 1 : 0; },
        };
        addEventListener("nicechunk:onboarding-game-api-request", (event) => event.detail.accept({
          getPlayer: () => globalThis.__onboardingGameState.player,
          getPlayerPosition: () => globalThis.__onboardingGameState.position,
          getCamera: () => globalThis.__onboardingGameState.camera,
          getCanvas: () => document.querySelector("#worldCanvas"),
          getChunks: () => globalThis.__onboardingGameState.worldReady ? chunks : null,
          getMotion: () => ({
            playerCollidesAt: (x, _y, z) => globalThis.__onboardingGameState.blockedCells.has(Math.floor(x) + "," + Math.floor(z)),
          }),
          isBlockingBlock: (blockId) => blockId > 0,
          setHighlightedBlock: (block) => { globalThis.__onboardingGameState.highlightedBlock = block; },
        }));
        addEventListener("nicechunk:onboarding-open-rpc", () => {
          const panel = document.querySelector("#rpcConfigPanel");
          if (panel) panel.hidden = false;
        });
        document.querySelectorAll("[data-smelting-section]").forEach((button) => button.addEventListener("click", () => {
          document.querySelectorAll("[data-smelting-section-panel]").forEach((panel) => {
            panel.hidden = panel.dataset.smeltingSectionPanel !== button.dataset.smeltingSection;
          });
        }));
      </script>
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
