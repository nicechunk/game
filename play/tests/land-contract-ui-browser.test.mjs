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
