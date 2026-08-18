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

test("backpack contract portfolio stays outside item slots and exposes registered parcel details", async () => {
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
        const portfolio = contractModule.createLandContractPortfolio({
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
        const gameState = {
          backpackSlots: [],
          backpackCapacity: 50,
          totalBackpackItems: () => 0,
          totalBackpackMassGrams: () => 0,
          isBackpackSlotEquipped: () => false,
          getBackpackSlotEquipment: () => null,
          getLandContractEquipment: () => null,
          getLandContractPortfolio: () => portfolio,
        };
        const elements = {
          hotbar: byId("hotbar"),
          backpackPanel: byId("backpackPanel"),
          backpackGrid: byId("backpackGrid"),
          backpackContracts: byId("backpackContracts"),
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
        });
        const inventory = inventoryModule.createInventoryController({
          elements,
          gameState,
          createVoxelItemIconCanvas: () => document.createElement("canvas"),
        });
        inventory.bind();
        backpackUi.render({ force: true });
      });

      assert.equal(await page.locator("#backpackGrid .backpack-slot").count(), 50, `${viewport.width}px: contract assets changed the fixed backpack capacity`);
      const summary = page.locator("#backpackContracts .backpack-contract-summary");
      assert.equal(await summary.getAttribute("aria-expanded"), "false");
      assert.match(await summary.textContent(), /Land Contracts/);
      assert.match(await summary.textContent(), /5/);
      const summaryBox = await summary.boundingBox();
      assert.ok(summaryBox.width >= 40 && summaryBox.height >= 40, `${viewport.width}px: contract summary target is too small`);

      await summary.press("Enter");
      assert.equal(await summary.getAttribute("aria-expanded"), "true");
      assert.equal(await page.locator("#backpackContractList [data-inventory-virtual-item]").count(), 3);
      const registered = page.locator("[data-inventory-virtual-item='registered-land-contract:42']");
      const registeredBox = await registered.boundingBox();
      assert.ok(registeredBox.width >= 40 && registeredBox.height >= 40, `${viewport.width}px: registered contract target is too small`);
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
        const contracts = document.querySelector("#backpackContracts");
        const contractBox = contracts.getBoundingClientRect();
        const detail = document.querySelector("#backpackDetail").getBoundingClientRect();
        const preview = document.querySelector("#backpackDetail .backpack-detail-preview").getBoundingClientRect();
        const icon = document.querySelector("#backpackDetail .land-contract-icon").getBoundingClientRect();
        const tradeNote = document.querySelector("#backpackDetail .backpack-contract-trade-note").getBoundingClientRect();
        return {
          panel: panel.toJSON(),
          contracts: contractBox.toJSON(),
          detail: detail.toJSON(),
          preview: preview.toJSON(),
          icon: icon.toJSON(),
          tradeNote: tradeNote.toJSON(),
          contractsOverflow: Math.max(0, contracts.scrollWidth - contracts.clientWidth),
          pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        };
      });
      assert.equal(layout.contractsOverflow, 0, `${viewport.width}px: contract portfolio overflowed its column`);
      assert.equal(layout.pageOverflow, 0, `${viewport.width}px: contract portfolio caused page overflow`);
      assert.ok(layout.contracts.left >= layout.panel.left - 1, `${viewport.width}px: contract portfolio escaped left`);
      assert.ok(layout.contracts.right <= layout.panel.right + 1, `${viewport.width}px: contract portfolio escaped right`);
      assert.ok(layout.icon.left >= layout.preview.left - 1 && layout.icon.right <= layout.preview.right + 1, `${viewport.width}px: contract icon escaped its preview`);
      assert.ok(layout.icon.top >= layout.preview.top - 1 && layout.icon.bottom <= layout.preview.bottom + 1, `${viewport.width}px: contract icon escaped vertically`);
      assert.ok(layout.tradeNote.width >= layout.detail.width * 0.75, `${viewport.width}px: contract trade note collapsed into one detail column`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
