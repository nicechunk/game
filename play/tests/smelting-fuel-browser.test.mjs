import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN;

test("browser fuel selection matches final consumable contract tiers", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/play/`, { waitUntil: "domcontentloaded" });
    const result = await page.evaluate(async () => {
      const rules = await import("/play/smelting-rules-lite.js");
      const { BLOCK_ID } = await import("/chunk.js/play.js");
      const blockSlot = (id, blockId) => ({ id, blockId, source: "chain", pending: false });
      const charcoal = {
        id: "charcoal",
        kind: "smelted_material",
        itemCode: 1001,
        materialId: "charcoal",
        source: "chain",
        pending: false,
      };
      const coal = blockSlot("coal", BLOCK_ID.coal);
      return {
        charcoalTier: rules.smeltingFuelForSlot(charcoal)?.heatTier ?? 0,
        coalTier: rules.smeltingFuelForSlot(coal)?.heatTier ?? 0,
        basaltTier: rules.smeltingFuelForSlot(blockSlot("basalt", BLOCK_ID.basalt))?.heatTier ?? 0,
        lavaTier: rules.smeltingFuelForSlot(blockSlot("lava", BLOCK_ID.lava))?.heatTier ?? 0,
        tierThreeChoice: rules.bestSmeltingFuelSlot([coal, charcoal], 3)?.id ?? null,
        tierFourChoice: rules.bestSmeltingFuelSlot([charcoal, coal], 4)?.id ?? null,
      };
    });

    assert.deepEqual(result, {
      charcoalTier: 3,
      coalTier: 4,
      basaltTier: 0,
      lavaTier: 0,
      tierThreeChoice: "charcoal",
      tierFourChoice: "coal",
    });
  } finally {
    await browser.close();
  }
});
