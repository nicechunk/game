import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.route(`${origin}/play/tests/profile-lifecycle`, (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><body>
      <section id="profilePanel" hidden>
        <div id="profileEquipmentList"></div>
        <div id="profileEquipmentBrowserList"></div>
        <div id="equipmentPanel"></div>
        <div id="profileEquipmentBrowserDetail"></div>
      </section>
    </body></html>`,
  }));
  await page.goto(`${origin}/play/tests/profile-lifecycle`, { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { createPlayProfileUi } = await import("/play/play-profile-ui.js");
    let sourceCanvasCount = 0;
    const byId = (id) => document.getElementById(id);
    const gameState = {
      playerProfile: {},
      selectedHotbarSlot: 0,
      hotbarItems: { iron_pickaxe: { itemId: "iron_pickaxe", label: "Iron Pickaxe" } },
      hotbarSlots: [{ itemId: "iron_pickaxe", durability: 100, maxDurability: 100 }],
    };
    const profile = createPlayProfileUi({
      elements: {
        profilePanel: byId("profilePanel"),
        profileEquipmentList: byId("profileEquipmentList"),
        profileEquipmentBrowserList: byId("profileEquipmentBrowserList"),
        equipmentPanel: byId("equipmentPanel"),
        profileEquipmentBrowserDetail: byId("profileEquipmentBrowserDetail"),
      },
      gameState,
      createVoxelItemIconCanvas() {
        sourceCanvasCount += 1;
        return document.createElement("canvas");
      },
      voxelItemLabel: (slot) => slot.label || slot.itemId,
      getChainSnapshot: () => ({
        walletAddress: "Wallet111111111111111111111111111111111",
        chainBackpack: { backpackAddress: "Pack11111111111111111111111111111111111", syncedSlots: 2, capacity: 50 },
      }),
    });
    const equipmentList = byId("profileEquipmentList");
    profile.render();
    const hiddenInitial = { sources: sourceCanvasCount, children: equipmentList.childElementCount };
    profile.openPanel();
    const opened = { sources: sourceCanvasCount, children: equipmentList.childElementCount };
    profile.closePanel();
    const firstChild = equipmentList.firstElementChild;
    profile.render();
    const hiddenRefresh = {
      sources: sourceCanvasCount,
      children: equipmentList.childElementCount,
      preserved: firstChild === equipmentList.firstElementChild,
    };
    profile.openPanel();
    const reopened = { sources: sourceCanvasCount, children: equipmentList.childElementCount };
    return { hiddenInitial, opened, hiddenRefresh, reopened };
  });

  assert.deepEqual(result.hiddenInitial, { sources: 0, children: 0 });
  assert.ok(result.opened.sources > 0);
  assert.equal(result.opened.children, 12);
  assert.equal(result.hiddenRefresh.sources, result.opened.sources);
  assert.equal(result.hiddenRefresh.children, result.opened.children);
  assert.equal(result.hiddenRefresh.preserved, true);
  assert.ok(result.reopened.sources > result.opened.sources);
  assert.equal(result.reopened.children, 12);
} finally {
  await browser.close();
}
