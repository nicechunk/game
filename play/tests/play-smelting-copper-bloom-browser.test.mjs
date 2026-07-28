import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN;

test("copper bloom selects tier-three fuel and explains a missing fuel", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route(`${origin}/play/tests/smelting-copper-bloom`, (route) => route.fulfill({
      contentType: "text/html",
      body: fixtureHtml(),
    }));

    await page.goto(`${origin}/play/tests/smelting-copper-bloom`, { waitUntil: "domcontentloaded" });
    const withFuel = await runScenario(page, true);
    assert.equal(withFuel.startDisabled, false);
    assert.equal(withFuel.startAriaDisabled, "false");
    assert.match(withFuel.fuelText, /Charcoal/);
    assert.equal(withFuel.submittedPayload.recipeId, 1015);
    assert.equal(withFuel.submittedPayload.recipeTableId, 221);
    assert.deepEqual(withFuel.submittedPayload.inputIndexes, [0, 1, 2]);
    assert.deepEqual(withFuel.submittedPayload.fuelIndexes, [3]);

    await page.reload({ waitUntil: "domcontentloaded" });
    const withoutFuel = await runScenario(page, false);
    assert.equal(withoutFuel.startDisabled, false, "an incomplete recipe remains clickable so it can explain what is missing");
    assert.equal(withoutFuel.startAriaDisabled, "true");
    assert.equal(withoutFuel.submittedPayload, null);
    assert.match(withoutFuel.fuelText, /Heat tier 3 required/);
    assert.match(withoutFuel.fuelText, /Charcoal/);
    assert.match(withoutFuel.fuelText, /Coal/);
    assert.match(withoutFuel.recipeStatus, /Charcoal/);
    assert.match(withoutFuel.recipeStatus, /Coal/);
    assert.match(withoutFuel.statusText, /Heat tier 3 required/);
    assert.match(withoutFuel.statusToast, /Charcoal/);
    assert.match(withoutFuel.statusToast, /Coal/);
  } finally {
    await browser.close();
  }
});

async function runScenario(page, includeFuel) {
  return page.evaluate(async ({ includeFuel: hasFuel }) => {
    const { createPlaySmelting } = await import("/play/play-smelting.js");
    const { BLOCK_ID } = await import("/chunk.js/play.js");
    const backpackAddress = "Backpack111111111111111111111111111111";
    const resourceSlot = (id, blockId, chainIndex, worldX) => ({
      id,
      kind: "resource",
      blockId,
      count: 1,
      pending: false,
      source: "chain",
      chainBackpack: backpackAddress,
      chainIndex,
      volumeMm3: 100_000_000,
      proof: { worldX, worldY: 70, worldZ: 200, blockId },
    });
    const slots = [
      resourceSlot("gravel-a", BLOCK_ID.gravel, 0, 100),
      resourceSlot("gravel-b", BLOCK_ID.gravel, 1, 101),
      resourceSlot("basalt", BLOCK_ID.basalt, 2, 102),
    ];
    if (hasFuel) {
      slots.push({
        id: "charcoal",
        kind: "smelted_material",
        itemCode: 1001,
        materialId: "charcoal",
        chainItemId: "charcoal-1",
        itemPda: "Charcoal1111111111111111111111111111111",
        count: 1,
        pending: false,
        source: "chain",
        chainBackpack: backpackAddress,
        chainIndex: 3,
        volumeMm3: 250_000,
      });
      slots.push(resourceSlot("coal", BLOCK_ID.coal, 4, 103));
    }

    const byId = (id) => document.getElementById(id);
    const gameState = { backpackSlots: slots };
    const statuses = [];
    let submittedPayload = null;
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
        smeltingCoreLabel: byId("smeltingCoreLabel"),
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
      resourceName: () => "Resource",
      voxelItemLabel: () => "Resource",
      getBackpackSnapshot: () => ({ backpackAddress, updatedSlot: "10" }),
      refreshBackpack: async () => ({ ok: true }),
      refreshPlayerProgress: async () => ({ ok: true }),
      loadChainModule: async () => ({
        async executeSmeltingOnChain(payload) {
          submittedPayload = payload;
          return { submitted: true, signature: "copper-bloom-signature" };
        },
      }),
      onStatus: (message) => statuses.push(message),
    });
    smelting.bind();
    smelting.openPanel();
    document.querySelector('[data-recipe-id="copper_bloom"]').click();

    const start = byId("smeltingStart");
    const before = {
      startDisabled: start.disabled,
      startAriaDisabled: start.getAttribute("aria-disabled"),
      fuelText: byId("smeltingFuelSlot").textContent,
      recipeStatus: document.querySelector('[data-recipe-id="copper_bloom"] .nice-smelting-recipe-status').textContent,
      statusText: byId("smeltingStatus").textContent,
    };
    start.click();
    for (let attempt = 0; attempt < 40 && hasFuel && !submittedPayload; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      ...before,
      statusToast: statuses.at(-1) || "",
      submittedPayload,
    };
  }, { includeFuel });
}

function fixtureHtml() {
  return `<!doctype html><html lang="en"><body>
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
        <button id="smeltingStart" type="button" disabled><i></i><span>Start Smelting</span></button>
      </div>
    </section>
  </body></html>`;
}
