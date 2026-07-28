import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 320, height: 720 } });
  await page.route(`${origin}/play/tests/smelting-submit`, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><head>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="/play/styles.css">
      <style>
        html, body { margin: 0; width: 100%; overflow-x: hidden; }
        #backpackPanel { width: 300px; }
        .nice-smelting-workbench { display: grid; width: 280px; }
      </style>
    </head><body>
      <section id="backpackPanel" hidden data-inventory-mode="inventory">
        <button id="inventoryModeButton"></button><button id="smeltingModeButton"></button>
        <div id="backpackInventoryView"></div>
        <div id="smeltingPanel" hidden>
          <div id="smeltingResourceGrid"></div><div id="smeltingRecipeList"></div>
          <div class="nice-smelting-workbench" id="workbench">
            <div id="smeltingInputSlot"></div><div id="smeltingFuelSlot"></div>
            <div id="smeltingOutput"></div><div id="smeltingRecipeDetails"></div>
            <div id="smeltingStatus"></div>
            <div id="smeltingProgressValue"></div><div id="smeltingProgressBar"></div>
            <button class="nice-smelting-start" id="smeltingStart" type="button" disabled>
              <i aria-hidden="true"></i><span>Start Smelting</span>
            </button>
          </div>
        </div>
      </section>
    </body></html>`,
  }));
  await page.goto(`${origin}/play/tests/smelting-submit`, { waitUntil: "networkidle" });

  const result = await page.evaluate(async () => {
    const { createPlaySmelting } = await import("/play/play-smelting.js");
    const backpackAddress = "Backpack111111111111111111111111111111";
    const basaltSlots = (firstIndex, prefix) => Array.from({ length: 4 }, (_, offset) => ({
      id: `${prefix}-${offset}`,
      kind: "resource",
      blockId: 14,
      count: 1,
      pending: false,
      source: "chain",
      chainBackpack: backpackAddress,
      chainIndex: firstIndex + offset,
      volumeMm3: 1_000_000,
      proof: { worldX: 100 + offset, worldY: 70, worldZ: 200, blockId: 14 },
    }));
    const gameState = { backpackSlots: basaltSlots(5, "before") };
    let updatedSlot = "10";
    let refreshCount = 0;
    let submittedPayload = null;
    let releaseExecution;
    const execution = new Promise((resolve) => { releaseExecution = resolve; });
    const byId = (id) => document.getElementById(id);
    const smelting = createPlaySmelting({
      elements: {
        backpackPanel: byId("backpackPanel"),
        inventoryModeButton: byId("inventoryModeButton"),
        smeltingModeButton: byId("smeltingModeButton"),
        backpackInventoryView: byId("backpackInventoryView"),
        smeltingPanel: byId("smeltingPanel"),
        smeltingResourceGrid: byId("smeltingResourceGrid"),
        smeltingRecipeList: byId("smeltingRecipeList"),
        smeltingInputSlot: byId("smeltingInputSlot"),
        smeltingFuelSlot: byId("smeltingFuelSlot"),
        smeltingOutput: byId("smeltingOutput"),
        smeltingRecipeDetails: byId("smeltingRecipeDetails"),
        smeltingStatus: byId("smeltingStatus"),
        smeltingProgressValue: byId("smeltingProgressValue"),
        smeltingProgressBar: byId("smeltingProgressBar"),
        smeltingStart: byId("smeltingStart"),
      },
      gameState,
      createVoxelItemIconCanvas(_item, { size = 48 } = {}) {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        return canvas;
      },
      resourceName: () => "Basalt",
      voxelItemLabel: () => "Basalt",
      getBackpackSnapshot: () => ({ backpackAddress, updatedSlot }),
      refreshBackpack: async () => {
        refreshCount += 1;
        if (refreshCount === 1) gameState.backpackSlots = basaltSlots(1, "after");
        updatedSlot = String(10 + refreshCount);
        return { ok: true };
      },
      refreshPlayerProgress: async () => ({ ok: true }),
      loadChainModule: async () => ({
        executeSmeltingOnChain(payload) {
          submittedPayload = payload;
          return execution;
        },
      }),
    });
    smelting.bind();
    smelting.openPanel();
    document.querySelector('[data-recipe-id="basalt_brick"]').click();
    byId("smeltingStart").click();

    while (!submittedPayload) await new Promise((resolve) => setTimeout(resolve, 5));
    const start = byId("smeltingStart");
    start.querySelector("span").textContent = "Submitting this decentralized smelting transaction and waiting for confirmation";
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const startRect = start.getBoundingClientRect();
    const workbenchRect = byId("workbench").getBoundingClientRect();
    const spinnerStyle = getComputedStyle(start.querySelector("i"));
    const pendingLayout = {
      busy: start.getAttribute("aria-busy"),
      insideWorkbench: startRect.left >= workbenchRect.left - 1 && startRect.right <= workbenchRect.right + 1,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      spinnerCssWidth: Math.round(Number.parseFloat(spinnerStyle.width)),
      spinnerVisualWidth: Math.round(start.querySelector("i").getBoundingClientRect().width),
    };

    releaseExecution({ submitted: true, signature: "smelting-signature" });
    while (start.getAttribute("aria-busy") === "true") await new Promise((resolve) => setTimeout(resolve, 5));
    smelting.closePanel();
    return { submittedPayload, refreshCount, pendingLayout };
  });

  assert.equal(result.submittedPayload.recipeId, 1042);
  assert.equal(result.submittedPayload.recipeTableId, 224);
  assert.deepEqual(result.submittedPayload.inputIndexes, [1, 2, 3, 4]);
  assert.deepEqual(result.submittedPayload.fuelIndexes, []);
  assert.ok(result.refreshCount >= 2, "the backpack should refresh before and after submission");
  assert.equal(result.pendingLayout.busy, "true");
  assert.equal(result.pendingLayout.insideWorkbench, true);
  assert.equal(result.pendingLayout.pageOverflow, false);
  assert.equal(result.pendingLayout.spinnerCssWidth, 14);
  assert.ok(result.pendingLayout.spinnerVisualWidth <= 20, "the rotating indicator should remain compact");
} finally {
  await browser.close();
}
