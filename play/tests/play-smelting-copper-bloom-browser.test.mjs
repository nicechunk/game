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

test("a four-plank stack submits one wooden-stick input index", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route(`${origin}/play/tests/smelting-wooden-stick`, (route) => route.fulfill({
      contentType: "text/html",
      body: fixtureHtml(),
    }));
    await page.goto(`${origin}/play/tests/smelting-wooden-stick`, { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(async () => {
      const { createPlaySmelting } = await import("/play/play-smelting.js");
      const backpackAddress = "Backpack111111111111111111111111111111";
      const itemPda = "Planks111111111111111111111111111111111";
      const plankSlot = ({ id, count, chainIndex, volumeMm3, massGrams }) => ({
        id,
        kind: "smelted_material",
        materialId: "wooden_plank",
        itemCode: 1031,
        chainItemId: "1031",
        itemPda,
        count,
        pending: false,
        source: "chain",
        chainBackpack: backpackAddress,
        chainIndex,
        volumeMm3,
        massGrams,
      });
      const gameState = {
        backpackSlots: [
          plankSlot({ id: "wooden-plank-stack", count: 4, chainIndex: 7, volumeMm3: 950_000, massGrams: 520 }),
          plankSlot({ id: "wooden-plank-decoy", count: 1, chainIndex: 8, volumeMm3: 2_000_000, massGrams: 1_100 }),
        ],
      };
      const byId = (id) => document.getElementById(id);
      let submittedPayload = null;
      let refreshCount = 0;
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
        resourceName: () => "Wooden Plank",
        voxelItemLabel: () => "Wooden Plank",
        getBackpackSnapshot: () => ({ backpackAddress, updatedSlot: "10" }),
        refreshBackpack: async () => {
          refreshCount += 1;
          if (refreshCount === 1) {
            gameState.backpackSlots = [
              plankSlot({ id: "refreshed-decoy", count: 1, chainIndex: 3, volumeMm3: 2_000_000, massGrams: 1_100 }),
              plankSlot({ id: "refreshed-stack", count: 4, chainIndex: 11, volumeMm3: 950_000, massGrams: 520 }),
            ];
          }
          return { ok: true };
        },
        refreshPlayerProgress: async () => ({ ok: true }),
        loadChainModule: async () => ({
          async executeSmeltingOnChain(payload) {
            submittedPayload = payload;
            return { submitted: true, signature: "wooden-stick-signature" };
          },
        }),
      });
      smelting.bind();
      smelting.openPanel();
      document.querySelector('[data-recipe-id="wooden_stick"]').click();
      const selectedText = byId("smeltingInputSlot").textContent;
      byId("smeltingStart").click();
      for (let attempt = 0; attempt < 40 && !submittedPayload; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return { selectedText, submittedPayload, refreshCount };
    });

    assert.match(result.selectedText, /x2\/2/);
    assert.equal(result.submittedPayload.recipeId, 1032);
    assert.equal(result.submittedPayload.recipeTableId, 223);
    assert.deepEqual(result.submittedPayload.inputIndexes, [11]);
    assert.deepEqual(result.submittedPayload.fuelIndexes, []);
    assert.equal(result.submittedPayload.batchMultiplier, 1);
    assert.ok(result.refreshCount >= 2);
  } finally {
    await browser.close();
  }
});

test("every primary recipe can be planned from canonical quantity-aware slots", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route(`${origin}/play/tests/smelting-all-recipes`, (route) => route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html lang=\"en\"><body></body></html>",
    }));
    await page.goto(`${origin}/play/tests/smelting-all-recipes`, { waitUntil: "domcontentloaded" });

    const failures = await page.evaluate(async () => {
      const {
        SMELTING_RECIPES,
        recipeRequirements,
        smeltingMaterialById,
        smeltingMaterialIdForInputKey,
        smeltingRawKeyBlockId,
        smeltingRecipePlan,
      } = await import("/play/smelting-rules-lite.js");
      return SMELTING_RECIPES.flatMap((recipe) => {
        let nextIndex = 0;
        const slots = recipeRequirements(recipe).flatMap((requirement) => {
          const materialId = smeltingMaterialIdForInputKey(requirement.key);
          if (materialId) {
            const material = smeltingMaterialById(materialId);
            return [{
              id: `${recipe.id}-${nextIndex}`,
              kind: "smelted_material",
              materialId,
              itemCode: material.itemCode,
              count: requirement.amount,
              chainIndex: nextIndex++,
            }];
          }
          return Array.from({ length: requirement.amount }, () => ({
            id: `${recipe.id}-${nextIndex}`,
            kind: "resource",
            blockId: smeltingRawKeyBlockId(requirement.key),
            count: 1,
            chainIndex: nextIndex++,
          }));
        });
        const plan = smeltingRecipePlan(recipe, slots, 1);
        const allocated = plan.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
        const required = recipeRequirements(recipe).reduce((sum, requirement) => sum + requirement.amount, 0);
        return plan.complete && plan.selectedCount === required && allocated === required
          ? []
          : [{ id: recipe.id, plan, required, allocated }];
      });
    });

    assert.deepEqual(failures, []);
  } finally {
    await browser.close();
  }
});

test("ambient recipes can use 99 input records while heated recipes reserve one fuel record", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route(`${origin}/play/tests/smelting-record-limits`, (route) => route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html lang=\"en\"><body></body></html>",
    }));
    await page.goto(`${origin}/play/tests/smelting-record-limits`, { waitUntil: "domcontentloaded" });
    const limits = await page.evaluate(async () => {
      const { smeltingInputRecordLimit } = await import("/play/play-smelting.js");
      return {
        ambient: smeltingInputRecordLimit({ requiredHeatTier: 0 }),
        heated: smeltingInputRecordLimit({ requiredHeatTier: 3 }),
        selectedFuel: smeltingInputRecordLimit({ requiredHeatTier: 0 }, { hasFuel: true }),
      };
    });
    assert.deepEqual(limits, { ambient: 99, heated: 98, selectedFuel: 98 });
  } finally {
    await browser.close();
  }
});

test("material merge displays and submits the real item quantity without skill output", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route(`${origin}/play/tests/smelting-material-merge`, (route) => route.fulfill({
      contentType: "text/html",
      body: fixtureHtml(),
    }));
    await page.goto(`${origin}/play/tests/smelting-material-merge`, { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(async () => {
      const { createPlaySmelting } = await import("/play/play-smelting.js");
      const backpackAddress = "Backpack111111111111111111111111111111";
      const materialSlot = (id, count, chainIndex, volumeMm3) => ({
        id,
        kind: "smelted_material",
        materialId: "copper_bloom",
        itemCode: 1015,
        chainItemId: "1015",
        itemPda: "CopperBloom11111111111111111111111111111",
        count,
        pending: false,
        source: "chain",
        chainBackpack: backpackAddress,
        chainIndex,
        volumeMm3,
      });
      const gameState = {
        backpackSlots: [
          materialSlot("copper-a", 6, 7, 600_000),
          materialSlot("copper-b", 4, 9, 313_880),
        ],
      };
      const byId = (id) => document.getElementById(id);
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
        resourceName: () => "Copper Bloom",
        voxelItemLabel: () => "Copper Bloom",
        getSkillEffects: () => ({ levels: { smelting: 10 }, smeltingOutputBps: 15_000 }),
        getBackpackSnapshot: () => ({ backpackAddress, updatedSlot: "10" }),
        refreshBackpack: async () => ({ ok: true }),
        refreshPlayerProgress: async () => ({ ok: true }),
        loadChainModule: async () => ({
          async executeSmeltingOnChain(payload) {
            submittedPayload = payload;
            return { submitted: true, signature: "merge-signature" };
          },
        }),
      });
      smelting.bind();
      smelting.openPanel();
      document.querySelector('[data-smelting-slot-id="copper-a"] [data-smelting-use="input"]').click();
      document.querySelector('[data-smelting-slot-id="copper-b"] [data-smelting-use="input"]').click();
      const display = {
        input: byId("smeltingInputSlot").textContent,
        output: byId("smeltingOutput").textContent,
        details: byId("smeltingRecipeDetails").textContent,
        stepperHidden: byId("smeltingRecipeDetails").querySelector(".nice-smelting-serving-stepper")?.hidden,
      };
      byId("smeltingStart").click();
      for (let attempt = 0; attempt < 40 && !submittedPayload; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return { display, submittedPayload };
    });

    assert.match(result.display.input, /x10\/10/);
    assert.match(result.display.output, /x10/);
    assert.match(result.display.details, /x10/);
    assert.equal(result.display.stepperHidden, true);
    assert.equal(result.submittedPayload.recipeId, 2015);
    assert.equal(result.submittedPayload.recipeTableId, 321);
    assert.deepEqual(result.submittedPayload.inputIndexes, [7, 9]);
    assert.deepEqual(result.submittedPayload.fuelIndexes, []);
    assert.equal(result.submittedPayload.batchMultiplier, 2);
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
