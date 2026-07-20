import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.route(`${origin}/play/tests/smelting-lifecycle`, (route) => route.fulfill({
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
        </div>
      </section>
    </body></html>`,
  }));
  await page.goto(`${origin}/play/tests/smelting-lifecycle`, { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const [{ createPlaySmelting }, { createPlayGameUi }] = await Promise.all([
      import("/play/play-smelting.js"),
      import("/play/game-ui.js"),
    ]);
    let sourceCanvasCount = 0;
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
    };
    const smelting = createPlaySmelting({
      elements,
      gameState: { backpackSlots: [] },
      createVoxelItemIconCanvas() {
        sourceCanvasCount += 1;
        const canvas = document.createElement("canvas");
        canvas.width = 48;
        canvas.height = 48;
        return canvas;
      },
      resourceName: (id) => `Resource ${id}`,
      voxelItemLabel: () => "Item",
    });
    smelting.bind();

    const snapshot = () => ({
      elements: document.querySelectorAll("*").length,
      canvases: document.querySelectorAll("canvas").length,
      recipeChildren: elements.smeltingRecipeList.childElementCount,
    });
    const baseline = snapshot();
    const cycles = [];
    for (let index = 0; index < 4; index += 1) {
      smelting.openPanel();
      const opened = snapshot();
      const sourcesAfterOpen = sourceCanvasCount;
      smelting.showInventory();
      smelting.render({ force: true });
      cycles.push({ opened, closed: snapshot(), sourcesAfterOpen });
    }
    const gameUi = createPlayGameUi({
      elements,
      gameState: {
        backpackSlots: [],
        backpackCapacity: 1,
        hotbarSlots: [],
        hotbarItems: {},
        playerProfile: {},
        totalBackpackItems: () => 0,
      },
      createVoxelItemIconCanvas: () => document.createElement("canvas"),
      voxelItemLabel: () => "Item",
      onBackpackPanelClosed: () => smelting.closePanel(),
    });
    smelting.openPanel();
    const sharedPanelOpened = snapshot();
    gameUi.closeBackpackPanel();
    const sharedPanelClosed = snapshot();
    return { baseline, cycles, sharedPanelOpened, sharedPanelClosed };
  });

  for (const cycle of result.cycles) {
    assert.ok(cycle.opened.canvases > 100, "opening should mount the recipe previews");
    assert.ok(cycle.opened.recipeChildren > 20, "opening should render the complete recipe list");
    assert.equal(cycle.closed.canvases, result.baseline.canvases);
    assert.equal(cycle.closed.elements, result.baseline.elements);
    assert.equal(cycle.closed.recipeChildren, 0);
  }
  for (let index = 1; index < result.cycles.length; index += 1) {
    assert.ok(
      result.cycles[index].sourcesAfterOpen > result.cycles[index - 1].sourcesAfterOpen,
      "closing should release cached source canvases",
    );
  }
  assert.ok(result.sharedPanelOpened.canvases > 100);
  assert.equal(result.sharedPanelClosed.canvases, result.baseline.canvases);
  assert.equal(result.sharedPanelClosed.elements, result.baseline.elements);
} finally {
  await browser.close();
}
