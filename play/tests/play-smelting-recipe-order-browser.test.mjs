import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.route(`${origin}/play/tests/smelting-recipe-order`, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><body>
      <section id="backpackPanel" hidden data-inventory-mode="inventory">
        <button id="inventoryModeButton"></button><button id="smeltingModeButton"></button>
        <div id="backpackInventoryView"></div>
        <div id="smeltingPanel" hidden>
          <div id="smeltingResourceGrid"></div><div id="smeltingRecipeList"></div>
          <div id="smeltingInputSlot"></div><div id="smeltingFuelSlot"></div>
          <div id="smeltingOutput"></div><div id="smeltingRecipeDetails"></div>
        </div>
      </section>
    </body></html>`,
  }));
  await page.goto(`${origin}/play/tests/smelting-recipe-order`, { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { createPlaySmelting } = await import("/play/play-smelting.js");
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
      },
      gameState: { backpackSlots: [] },
      createVoxelItemIconCanvas(_item, { size } = {}) {
        const canvas = document.createElement("canvas");
        canvas.width = size || 48;
        canvas.height = size || 48;
        return canvas;
      },
      resourceName: (id) => `Resource ${id}`,
      voxelItemLabel: () => "Item",
    });
    smelting.bind();
    smelting.openPanel();
    const recipeIds = () => [...document.querySelectorAll("#smeltingRecipeList [data-recipe-id]")]
      .map((card) => card.dataset.recipeId);
    const before = recipeIds();
    const selectedId = before[Math.floor(before.length * 0.7)];
    document.querySelector(`[data-recipe-id="${selectedId}"]`).click();
    const after = recipeIds();
    return {
      before,
      after,
      selectedId,
      activeId: document.querySelector("#smeltingRecipeList .selected")?.dataset.recipeId || "",
    };
  });

  assert.ok(result.before.length > 20);
  assert.equal(result.activeId, result.selectedId);
  assert.deepEqual(result.after, result.before);
} finally {
  await browser.close();
}
