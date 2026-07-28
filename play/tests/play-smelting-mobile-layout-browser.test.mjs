import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await page.route(`${origin}/play/tests/smelting-mobile-layout`, (route) => route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <link rel="stylesheet" href="/play/styles.css">
        <style>
          html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
          #backpackPanel { position: fixed; inset: 5px; }
          #smeltingPanel, .nice-smelting-recipes-column, .nice-smelting-recipes { width: 100%; height: 100%; }
          .nice-smelting-recipes { display: grid; grid-template-rows: minmax(0, 1fr); }
        </style>
      </head><body>
        <section id="backpackPanel" hidden data-inventory-mode="inventory">
          <button id="inventoryModeButton"></button><button id="smeltingModeButton"></button>
          <div id="backpackInventoryView"></div>
          <div id="smeltingPanel" hidden>
            <div class="nice-smelting-recipes-column"><section class="nice-smelting-recipes">
              <div id="smeltingRecipeList" class="nice-smelting-recipe-list"></div>
            </section></div>
            <div id="smeltingResourceGrid"></div><div id="smeltingInputSlot"></div>
            <div id="smeltingFuelSlot"></div><div id="smeltingOutput"></div>
            <div id="smeltingRecipeDetails"></div>
          </div>
        </section>
      </body></html>`,
    }));
    await page.goto(`${origin}/play/tests/smelting-mobile-layout`, { waitUntil: "networkidle" });
    const layout = await page.evaluate(async () => {
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
      const intersectionArea = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const cards = [...document.querySelectorAll(".nice-smelting-recipe-card")].map((card) => {
        const formula = card.querySelector(".nice-smelting-recipe-formula");
        const copy = card.querySelector(".nice-smelting-recipe-copy");
        const status = card.querySelector(".nice-smelting-recipe-status");
        const cardRect = card.getBoundingClientRect();
        const formulaRect = formula.getBoundingClientRect();
        const copyRect = copy.getBoundingClientRect();
        const statusRect = status.getBoundingClientRect();
        return {
          formulaCopyOverlap: intersectionArea(formulaRect, copyRect),
          formulaStatusOverlap: intersectionArea(formulaRect, statusRect),
          copyStatusOverlap: intersectionArea(copyRect, statusRect),
          contentInsideCard: formulaRect.left >= cardRect.left - 1
            && formulaRect.right <= cardRect.right + 1
            && copyRect.left >= cardRect.left - 1
            && statusRect.right <= cardRect.right + 1,
          horizontalOverflow: card.scrollWidth > card.clientWidth + 1,
        };
      });
      return {
        cards,
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    assert.ok(layout.cards.length > 20, `expected the recipe catalog at ${viewport.width}px`);
    assert.equal(layout.pageOverflow, false, `page must not overflow at ${viewport.width}px`);
    for (const [index, card] of layout.cards.entries()) {
      assert.equal(card.formulaCopyOverlap, 0, `formula overlaps recipe copy in card ${index} at ${viewport.width}px`);
      assert.equal(card.formulaStatusOverlap, 0, `formula overlaps status in card ${index} at ${viewport.width}px`);
      assert.equal(card.copyStatusOverlap, 0, `recipe copy overlaps status in card ${index} at ${viewport.width}px`);
      assert.equal(card.contentInsideCard, true, `recipe content escapes card ${index} at ${viewport.width}px`);
      assert.equal(card.horizontalOverflow, false, `recipe card ${index} overflows at ${viewport.width}px`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
