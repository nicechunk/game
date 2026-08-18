import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const sourceHtml = (await readFile(new URL("../index.html", import.meta.url), "utf8"))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "");

test("land contracts open on demand and collapse without viewport overflow", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [
      { width: 375, height: 812, mobile: true },
      { width: 768, height: 800, mobile: true },
      { width: 1280, height: 800, mobile: false },
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        screen: { width: viewport.width, height: viewport.height },
        isMobile: viewport.mobile,
        hasTouch: viewport.mobile,
      });
      const page = await context.newPage();
      await page.route(`${origin}/play/`, (route) => route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: sourceHtml,
      }));
      await page.goto(`${origin}/play/`, { waitUntil: "domcontentloaded" });
      await page.evaluate(async () => {
        const { createPlayLandUi } = await import("/play/play-land-ui.js");
        const byId = (id) => document.getElementById(id);
        let active = false;
        let mode = "foundation";
        const foundation = {
          chunksX: 1,
          chunksZ: 1,
          width: 16,
          depth: 16,
          requiredContracts: 1,
          availableLandContracts: 3,
          foundationBound: false,
          anchored: false,
          locked: false,
          canLockDimensions: true,
          submitting: false,
          preview: {
            valid: true,
            chunkMinX: -1,
            chunkMinZ: 2,
            chunkMaxX: -1,
            chunkMaxZ: 2,
            minX: -16,
            minZ: 32,
            maxX: -1,
            maxZ: 47,
            width: 16,
            depth: 16,
            surfaceY: 11,
            maxSurfaceY: 13,
            message: "Select the opposite Chunk corner.",
          },
          step: 2,
        };
        const foundationController = {
          snapshot: () => ({ ...foundation, active }),
          setDimensions(chunksX, chunksZ) {
            foundation.chunksX = chunksX;
            foundation.chunksZ = chunksZ;
          },
          lockDimensions() {
            foundation.anchored = true;
            foundation.locked = true;
            foundation.step = 4;
            ui?.render({ force: true });
          },
          cancel() {},
          confirm() {},
        };
        const buildingController = {
          activate() {},
          cancel() {},
          mode: () => mode,
          setMode: (next) => { mode = next; },
          snapshot: () => ({ active, mode, foundations: [], foundationBound: false }),
        };
        let ui = null;
        ui = createPlayLandUi({
          elements: {
            landGuide: byId("landGuide"),
            landGuideBody: byId("landGuideBody"),
            landCollapse: byId("landCollapse"),
            landClose: byId("landClose"),
            landModeButtons: document.querySelectorAll("[data-land-mode]"),
            foundationEditor: byId("foundationEditor"),
            buildingEditor: byId("buildingEditor"),
            landChunksX: byId("landChunksX"),
            landChunksZ: byId("landChunksZ"),
            landLockSize: byId("landLockSize"),
            landDimensionButtons: document.querySelectorAll("[data-land-dimension]"),
            landSteps: document.querySelectorAll("[data-land-step]"),
            landChunkDimensions: byId("landChunkDimensions"),
            landChunkRange: byId("landChunkRange"),
            landFootprint: byId("landFootprint"),
            landRequiredContracts: byId("landRequiredContracts"),
            landAvailableContracts: byId("landAvailableContracts"),
            landBuyContracts: byId("landBuyContracts"),
            landStatus: byId("landStatus"),
            landCancel: byId("landCancel"),
            landConfirm: byId("landConfirm"),
            landStepHint: byId("landStepHint"),
            landStepNumber: byId("landStepNumber"),
            landStepText: byId("landStepText"),
            foundationMeasurements: byId("foundationMeasurements"),
            buildingCode: byId("buildingCode"),
            buildingRotateLeft: byId("buildingRotateLeft"),
            buildingRotateRight: byId("buildingRotateRight"),
            buildingRotation: byId("buildingRotation"),
            buildingOffsetX: byId("buildingOffsetX"),
            buildingOffsetZ: byId("buildingOffsetZ"),
            buildingMetrics: byId("buildingMetrics"),
            buildingStatus: byId("buildingStatus"),
            buildingPreview: byId("buildingPreview"),
            buildingConfirm: byId("buildingConfirm"),
          },
          getController: () => foundationController,
          getBuildingController: () => buildingController,
          isConstructionModeActive: () => active,
          setConstructionModeActive: (next) => {
            active = Boolean(next);
            ui?.render({ force: true });
          },
          canvas: byId("canvas"),
        });
        ui.bind();
        ui.render({ force: true });
        globalThis.__landContractUi = {
          open() {
            active = true;
            ui.render({ force: true });
          },
          isActive: () => active,
        };
      });

      assert.equal(await page.locator("#landGuide").isHidden(), true, `${viewport.width}px: land UI was visible before selecting a contract`);
      await page.evaluate(() => globalThis.__landContractUi.open());
      assert.equal(await page.locator("#landGuide").isVisible(), true, `${viewport.width}px: selected contract did not open land UI`);
      assert.equal(await page.locator("#landStepHint").isVisible(), true, `${viewport.width}px: active instructions were not visible`);
      assert.equal(await page.locator("#landConfirm").isDisabled(), true, `${viewport.width}px: registration was enabled before range lock`);
      assert.equal(await page.locator("#landChunkRange").textContent(), "C -1,2 → C -1,2");
      await page.locator("#landLockSize").click();
      assert.equal(await page.locator("#landConfirm").isEnabled(), true, `${viewport.width}px: exact-size lock did not enable registration`);
      if (viewport.mobile) {
        const lockBox = await page.locator("#landLockSize").boundingBox();
        assert.ok(lockBox.width >= 39.5 && lockBox.height >= 39.5, `${viewport.width}px: exact-size lock target is too small`);
      }

      await page.locator("#landCollapse").press("Enter");
      const collapsed = await page.evaluate(() => {
        const panel = document.querySelector("#landGuide");
        const body = document.querySelector("#landGuideBody");
        const hint = document.querySelector("#landStepHint");
        const collapse = document.querySelector("#landCollapse");
        const close = document.querySelector("#landClose");
        return {
          panel: panel.getBoundingClientRect().toJSON(),
          collapse: collapse.getBoundingClientRect().toJSON(),
          close: close.getBoundingClientRect().toJSON(),
          bodyHidden: body.hidden,
          hintHidden: hint.hidden,
          expanded: collapse.getAttribute("aria-expanded"),
          pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        };
      });
      assert.equal(collapsed.bodyHidden, true, `${viewport.width}px: collapse left the panel body visible`);
      assert.equal(collapsed.hintHidden, true, `${viewport.width}px: collapse left the floating step hint visible`);
      assert.equal(collapsed.expanded, "false");
      assert.equal(collapsed.pageOverflow, 0, `${viewport.width}px: land UI caused horizontal overflow`);
      assert.ok(collapsed.panel.left >= -1 && collapsed.panel.right <= viewport.width + 1, `${viewport.width}px: land panel escaped the viewport`);
      assert.ok(collapsed.panel.top >= -1 && collapsed.panel.bottom <= viewport.height + 1, `${viewport.width}px: land panel escaped vertically`);
      if (viewport.mobile) {
        assert.ok(collapsed.collapse.width >= 39.5 && collapsed.collapse.height >= 39.5, `${viewport.width}px: collapse target is too small`);
        assert.ok(collapsed.close.width >= 39.5 && collapsed.close.height >= 39.5, `${viewport.width}px: close target is too small`);
      }

      await page.locator("#landCollapse").press("Space");
      assert.equal(await page.locator("#landGuideBody").isVisible(), true, `${viewport.width}px: keyboard expansion failed`);
      await page.locator("#landClose").click();
      assert.equal(await page.locator("#landGuide").isHidden(), true, `${viewport.width}px: close left land UI visible`);
      assert.equal(await page.evaluate(() => globalThis.__landContractUi.isActive()), false);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

test("backpack categories render stacked contracts and independent registered land cells", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [
      { width: 375, height: 812, mobile: true },
      { width: 768, height: 800, mobile: true },
      { width: 1280, height: 800, mobile: false },
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        screen: { width: viewport.width, height: viewport.height },
        isMobile: viewport.mobile,
        hasTouch: viewport.mobile,
      });
      const page = await context.newPage();
      await page.route(`${origin}/play/`, (route) => route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: sourceHtml,
      }));
      await page.goto(`${origin}/play/`, { waitUntil: "domcontentloaded" });
      await page.evaluate(async () => {
        const [backpackModule, inventoryModule, contractModule] = await Promise.all([
          import("/play/play-backpack-ui.js"),
          import("/play/inventory-controller.js"),
          import("/play/play-land-contract-item.js"),
        ]);
        const byId = (id) => document.getElementById(id);
        const owner = "ContractOwner11111111111111111111111111111";
        const readyPortfolio = contractModule.createLandContractPortfolio({
          owner,
          status: "ready",
          balance: {
            status: "ready",
            available: 2,
            reserved: 1,
            marketUser: "MarketUser111111111111111111111111111111",
          },
          registeredContracts: [
            {
              foundationId: "42",
              owner,
              minX: -32,
              minZ: 48,
              width: 32,
              depth: 16,
              surfaceY: 73,
              landContractCount: 2,
              registeredChunks: "2",
              totalChunks: "2",
              status: "active",
              sourcePda: "BuildSite42Pda1111111111111111111111111111",
            },
            {
              foundationId: "7",
              owner,
              minX: 16,
              minZ: -16,
              width: 16,
              depth: 16,
              surfaceY: 70,
              landContractCount: 1,
              registeredChunks: "0",
              totalChunks: "1",
              status: "indexing",
              sourcePda: "BuildSite7Pda11111111111111111111111111111",
            },
          ],
        });
        let portfolio = readyPortfolio;
        let retryCalls = 0;
        const gameState = {
          backpackSlots: [
            { id: "stone", kind: "resource", resourceId: 3, blockId: 3, count: 1, volumeMm3: 1000, massGrams: 2 },
            { id: "pickaxe", kind: "forged", itemId: "iron_pickaxe", count: 1, volumeMm3: 1000, massGrams: 3 },
          ],
          backpackCapacity: 50,
          totalBackpackItems: () => 2,
          totalBackpackMassGrams: () => 5,
          isBackpackSlotEquipped: () => false,
          getBackpackSlotEquipment: () => null,
          getLandContractEquipment: () => null,
          getLandContractPortfolio: () => portfolio,
        };
        const elements = {
          hotbar: byId("hotbar"),
          backpackPanel: byId("backpackPanel"),
          backpackGrid: byId("backpackGrid"),
          backpackDetail: byId("backpackDetail"),
          backpackMeta: byId("backpackMeta"),
          backpackActions: byId("backpackActions"),
          backpackCategoryButtons: document.querySelectorAll("[data-backpack-category]"),
          selectAllBackpack: byId("selectAllBackpackButton"),
          discardSelectedBackpack: byId("discardSelectedBackpackButton"),
          cancelBackpackSelection: byId("cancelBackpackSelectionButton"),
        };
        elements.backpackPanel.hidden = false;
        const backpackUi = backpackModule.createPlayBackpackUi({
          elements,
          gameState,
          createVoxelItemIconCanvas: () => document.createElement("canvas"),
          voxelItemLabel: (item) => item?.label || "Item",
          onRefreshLandContracts: async () => {
            retryCalls += 1;
            portfolio = readyPortfolio;
            return readyPortfolio;
          },
        });
        const inventory = inventoryModule.createInventoryController({
          elements,
          gameState,
          createVoxelItemIconCanvas: () => document.createElement("canvas"),
        });
        inventory.bind();
        backpackUi.render({ force: true });
        globalThis.__backpackCategoryHarness = {
          renderState(state) {
            if (state === "loading") {
              portfolio = {
                known: false,
                loading: true,
                error: "",
                blankContract: null,
                registeredContracts: [],
                items: [],
              };
            } else if (state === "empty") {
              portfolio = {
                known: true,
                loading: false,
                error: "",
                blankContract: null,
                registeredContracts: [],
                items: [],
              };
            } else if (state === "error") {
              portfolio = {
                known: false,
                loading: false,
                error: "RPC unavailable",
                blankContract: null,
                registeredContracts: [],
                items: [],
              };
            } else {
              portfolio = readyPortfolio;
            }
            backpackUi.render({ force: true });
          },
          retryCalls: () => retryCalls,
        };
      });

      const categoryButtons = page.locator("#backpackCategories [data-backpack-category]");
      assert.equal(await categoryButtons.count(), 5);
      assert.deepEqual(await categoryButtons.locator("span").allTextContents(), ["Backpack", "Resources", "Items", "Contracts", "Land"]);
      assert.equal(await page.locator("#backpackGrid .backpack-slot").count(), 51, `${viewport.width}px: the virtual blank contract should sit beside 50 physical capacity cells`);
      assert.equal(await page.locator("#backpackGrid .backpack-slot[data-backpack-slot]").count(), 2);
      assert.equal(await page.locator("#backpackGrid .backpack-slot.empty").count(), 48);
      assert.equal(await page.locator("#backpackGrid [data-inventory-virtual-item='market-user-blank-land-contract']").count(), 1);
      assert.match(await page.locator("#backpackMeta").textContent(), /2 \/ 50 slots · 2 items/);

      const contractsCategory = page.locator("#backpackCategories [data-backpack-category='contracts']");
      await contractsCategory.press("Enter");
      assert.equal(await contractsCategory.getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator("#backpackGrid .backpack-slot").count(), 1);
      const blankContract = page.locator("#backpackGrid [data-inventory-virtual-item='market-user-blank-land-contract']");
      assert.equal(await blankContract.locator(".backpack-slot-count").textContent(), "3");
      await blankContract.press("Space");
      assert.match(await page.locator("#backpackDetail").textContent(), /Blank Land Contract/);

      const landCategory = page.locator("#backpackCategories [data-backpack-category='land']");
      await landCategory.click();
      assert.equal(await page.locator("#backpackGrid [data-inventory-virtual-item]").count(), 2, `${viewport.width}px: two foundations must render as two land cells`);
      assert.equal(await page.locator("#backpackGrid .registered-land-slot .backpack-slot-count").count(), 0, "registered land must never show the consumed contract count as a stack badge");
      assert.equal(await page.locator("#backpackGrid .land-contract-icon[data-land-contract-icon='registered']").count(), 2);
      const registered = page.locator("[data-inventory-virtual-item='registered-land-contract:42']");
      const registeredBox = await registered.boundingBox();
      assert.ok(
        registeredBox.width >= 40 && registeredBox.height >= 40,
        `${viewport.width}px: registered contract target is too small (${registeredBox.width} × ${registeredBox.height})`,
      );
      await registered.press("Space");
      const detailText = await page.locator("#backpackDetail").textContent();
      assert.match(detailText, /Land Contract #42/);
      assert.match(detailText, /\(-2, 3\).*\(-1, 3\)/s);
      assert.match(detailText, /X -32…-1 · Z 48…63/);
      assert.match(detailText, /32 × 16 blocks/);
      assert.match(detailText, /512 block²/);
      assert.match(detailText, /2 \/ 2/);

      const layout = await page.evaluate(() => {
        const panel = document.querySelector("#backpackPanel").getBoundingClientRect();
        const categories = document.querySelector("#backpackCategories").getBoundingClientRect();
        const grid = document.querySelector("#backpackGrid");
        const gridBox = grid.getBoundingClientRect();
        const detail = document.querySelector("#backpackDetail").getBoundingClientRect();
        const preview = document.querySelector("#backpackDetail .backpack-detail-preview").getBoundingClientRect();
        const icon = document.querySelector("#backpackDetail .land-contract-icon").getBoundingClientRect();
        const tradeNote = document.querySelector("#backpackDetail .backpack-contract-trade-note").getBoundingClientRect();
        return {
          panel: panel.toJSON(),
          categories: categories.toJSON(),
          grid: gridBox.toJSON(),
          detail: detail.toJSON(),
          preview: preview.toJSON(),
          icon: icon.toJSON(),
          tradeNote: tradeNote.toJSON(),
          gridOverflow: Math.max(0, grid.scrollWidth - grid.clientWidth),
          pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        };
      });
      assert.equal(layout.gridOverflow, 0, `${viewport.width}px: land cells overflowed their grid`);
      assert.equal(layout.pageOverflow, 0, `${viewport.width}px: inventory categories caused page overflow`);
      assert.ok(layout.grid.left >= layout.panel.left - 1, `${viewport.width}px: land grid escaped left`);
      assert.ok(layout.grid.right <= layout.panel.right + 1, `${viewport.width}px: land grid escaped right`);
      assert.ok(layout.categories.left >= layout.panel.left - 1, `${viewport.width}px: categories escaped left`);
      assert.ok(layout.categories.right <= layout.panel.right + 1, `${viewport.width}px: categories escaped right`);
      assert.ok(layout.icon.left >= layout.preview.left - 1 && layout.icon.right <= layout.preview.right + 1, `${viewport.width}px: contract icon escaped its preview`);
      assert.ok(layout.icon.top >= layout.preview.top - 1 && layout.icon.bottom <= layout.preview.bottom + 1, `${viewport.width}px: contract icon escaped vertically`);
      assert.ok(layout.tradeNote.width >= layout.detail.width * 0.75, `${viewport.width}px: contract trade note collapsed into one detail column`);

      await page.evaluate(() => globalThis.__backpackCategoryHarness.renderState("loading"));
      assert.equal(await page.locator("#backpackGrid").getAttribute("aria-busy"), "true");
      assert.equal(await page.locator("#backpackGrid .backpack-contract-loading").count(), 2);

      await page.evaluate(() => globalThis.__backpackCategoryHarness.renderState("empty"));
      assert.match(await page.locator("#backpackGrid .backpack-grid-state").textContent(), /No registered land/);
      await contractsCategory.click();
      assert.match(await page.locator("#backpackGrid .backpack-grid-state").textContent(), /No blank contracts/);

      await page.evaluate(() => globalThis.__backpackCategoryHarness.renderState("error"));
      const retry = page.locator("#backpackGrid .backpack-grid-state.error [data-contract-action='refresh']");
      assert.match(await page.locator("#backpackGrid .backpack-grid-state.error").textContent(), /RPC unavailable/);
      await retry.click();
      await page.waitForFunction(() => document.querySelectorAll("#backpackGrid [data-inventory-virtual-item]").length === 1);
      assert.equal(await page.evaluate(() => globalThis.__backpackCategoryHarness.retryCalls()), 1);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
