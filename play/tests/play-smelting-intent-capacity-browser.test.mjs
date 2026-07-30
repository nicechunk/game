import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";

test("an explicitly selected ambiguous recipe remains pinned through input edits", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openFixture(page, "smelting-recipe-intent");

    const result = await page.evaluate(async () => {
      const { createPlaySmelting } = await import("/play/play-smelting.js");
      const { BLOCK_ID } = await import("/chunk.js/play.js");
      const byId = (id) => document.getElementById(id);
      const elements = {
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
        smeltingCoreLabel: byId("smeltingCoreLabel"),
        smeltingStatus: byId("smeltingStatus"),
        smeltingProgressValue: byId("smeltingProgressValue"),
        smeltingProgressBar: byId("smeltingProgressBar"),
        smeltingStart: byId("smeltingStart"),
      };
      const createIcon = (_item, { size = 48 } = {}) => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        return canvas;
      };
      const backpackAddress = "Backpack111111111111111111111111111111";
      const gameState = {
        backpackSlots: [{
          id: "trunk",
          kind: "resource",
          blockId: BLOCK_ID.trunk,
          count: 1,
          pending: false,
          source: "chain",
          chainBackpack: backpackAddress,
          chainIndex: 7,
          volumeMm3: 1_000_000,
          proof: { worldX: 100, worldY: 70, worldZ: 200, blockId: BLOCK_ID.trunk },
        }],
      };
      let submittedPayload = null;
      const smelting = createPlaySmelting({
        elements,
        gameState,
        createVoxelItemIconCanvas: createIcon,
        getBackpackSnapshot: () => ({ backpackAddress, capacity: 99, itemCount: 1, updatedSlot: "10" }),
        refreshBackpack: async () => ({ ok: true }),
        refreshPlayerProgress: async () => ({ ok: true }),
        loadChainModule: async () => ({
          async executeSmeltingOnChain(payload) {
            submittedPayload = payload;
            return { submitted: true, signature: "squared-timber-signature" };
          },
        }),
      });
      smelting.bind();
      smelting.openPanel();
      document.querySelector('[data-recipe-id="squared_timber"]').click();
      const selectedBefore = document.querySelector("#smeltingRecipeList .selected")?.dataset.recipeId;

      document.querySelector('[data-smelting-slot-id="trunk"] [data-smelting-use="input"]').click();
      document.querySelector('[data-smelting-slot-id="trunk"] [data-smelting-use="input"]').click();
      const selectedAfter = document.querySelector("#smeltingRecipeList .selected")?.dataset.recipeId;

      document.getElementById("smeltingStart").click();
      for (let attempt = 0; attempt < 40 && !submittedPayload; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      smelting.closePanel();
      return { selectedBefore, selectedAfter, submittedPayload };
    });

    assert.equal(result.selectedBefore, "squared_timber");
    assert.equal(result.selectedAfter, "squared_timber");
    assert.equal(result.submittedPayload.recipeId, 1033);
    assert.equal(result.submittedPayload.recipeTableId, 223);
    assert.deepEqual(result.submittedPayload.inputIndexes, [7]);
  } finally {
    await browser.close();
  }
});

test("a full backpack blocks output until the selected input frees a record", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openFixture(page, "smelting-output-capacity");

    const result = await page.evaluate(async () => {
      const { createPlaySmelting } = await import("/play/play-smelting.js");
      const { BLOCK_ID } = await import("/chunk.js/play.js");
      const byId = (id) => document.getElementById(id);
      const elements = {
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
        smeltingCoreLabel: byId("smeltingCoreLabel"),
        smeltingStatus: byId("smeltingStatus"),
        smeltingProgressValue: byId("smeltingProgressValue"),
        smeltingProgressBar: byId("smeltingProgressBar"),
        smeltingStart: byId("smeltingStart"),
      };
      const createIcon = (_item, { size = 48 } = {}) => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        return canvas;
      };
      const backpackAddress = "Backpack111111111111111111111111111111";
      const trunk = {
        id: "trunk-stack",
        kind: "resource",
        blockId: BLOCK_ID.trunk,
        count: 2,
        pending: false,
        source: "chain",
        chainBackpack: backpackAddress,
        chainIndex: 0,
        volumeMm3: 2_000_000,
        proof: { worldX: 100, worldY: 70, worldZ: 200, blockId: BLOCK_ID.trunk },
      };
      const fillers = Array.from({ length: 98 }, (_, offset) => ({
        id: `forged-${offset}`,
        kind: "forged",
        count: 1,
        pending: false,
        source: "chain",
        chainBackpack: backpackAddress,
        chainIndex: offset + 1,
        chainItemId: String(10_000 + offset),
        itemCode: 8,
        volumeMm3: 1_000,
      }));
      const gameState = { backpackSlots: [trunk, ...fillers] };
      let submittedPayload = null;
      const smelting = createPlaySmelting({
        elements,
        gameState,
        createVoxelItemIconCanvas: createIcon,
        getBackpackSnapshot: () => ({ backpackAddress, capacity: 99, itemCount: 99, updatedSlot: "10" }),
        refreshBackpack: async () => ({ ok: true }),
        refreshPlayerProgress: async () => ({ ok: true }),
        loadChainModule: async () => ({
          async executeSmeltingOnChain(payload) {
            submittedPayload = payload;
            return { submitted: true, signature: "wooden-plank-signature" };
          },
        }),
      });
      smelting.bind();
      smelting.openPanel();
      document.querySelector('[data-recipe-id="wooden_plank"]').click();

      const start = document.getElementById("smeltingStart");
      const blocked = {
        ariaDisabled: start.getAttribute("aria-disabled"),
        status: document.getElementById("smeltingStatus").textContent,
      };
      start.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const submittedWhileFull = Boolean(submittedPayload);

      trunk.count = 1;
      trunk.volumeMm3 = 1_000_000;
      smelting.render({ force: true });
      const ready = {
        ariaDisabled: start.getAttribute("aria-disabled"),
        status: document.getElementById("smeltingStatus").textContent,
      };
      start.click();
      for (let attempt = 0; attempt < 40 && !submittedPayload; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      smelting.closePanel();
      return { blocked, ready, submittedWhileFull, submittedPayload };
    });

    assert.equal(result.blocked.ariaDisabled, "true");
    assert.match(result.blocked.status, /cannot hold this output/i);
    assert.equal(result.submittedWhileFull, false);
    assert.equal(result.ready.ariaDisabled, "false");
    assert.match(result.ready.status, /ready/i);
    assert.equal(result.submittedPayload.recipeId, 1031);
    assert.deepEqual(result.submittedPayload.inputIndexes, [0]);
  } finally {
    await browser.close();
  }
});

async function openFixture(page, path) {
  await page.route(`${origin}/play/tests/${path}`, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><body>
      <section id="backpackPanel" hidden data-inventory-mode="inventory">
        <button id="inventoryModeButton"></button>
        <button id="smeltingModeButton"></button>
        <div id="backpackInventoryView"></div>
        <div id="smeltingPanel" hidden>
          <div id="smeltingResourceGrid"></div>
          <div id="smeltingRecipeList"></div>
          <div id="smeltingInputSlot"></div>
          <div id="smeltingFuelSlot"></div>
          <div id="smeltingOutput"></div>
          <div id="smeltingRecipeDetails"></div>
          <div id="smeltingCoreLabel"></div>
          <div id="smeltingStatus"></div>
          <div id="smeltingProgressValue"></div>
          <div id="smeltingProgressBar"></div>
          <button id="smeltingStart" type="button"><i></i><span>Start Smelting</span></button>
        </div>
      </section>
    </body></html>`,
  }));
  await page.goto(`${origin}/play/tests/${path}`, { waitUntil: "domcontentloaded" });
}
