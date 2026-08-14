import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const sourceHtml = (await readFile(new URL("../index.html", import.meta.url), "utf8"))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "");

test("market renders chain item icons, mobile views, and transaction progress", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [
      { name: "desktop", width: 1440, height: 900, mobile: false },
      { name: "portrait", width: 390, height: 844, mobile: true },
      { name: "landscape", width: 844, height: 390, mobile: true },
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        screen: { width: viewport.width, height: viewport.height },
        isMobile: viewport.mobile,
        hasTouch: viewport.mobile,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.route(`${origin}/play/`, (route) => route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: sourceHtml,
      }));
      await page.goto(`${origin}/play/`, { waitUntil: "domcontentloaded" });
      await installMarketHarness(page);
      if (viewport.mobile) {
        const headerLayouts = await page.evaluate(() => {
          const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
          const panel = document.querySelector("#backpackPanel");
          const layouts = ["inventory", "smelting"].map((mode) => {
            panel.dataset.inventoryMode = mode;
            const controls = [
              rect("#inventoryModeButton"),
              rect("#smeltingModeButton"),
              rect("#marketButton"),
              rect("#closeBackpackButton"),
            ];
            return {
              mode,
              header: rect("#backpackPanel .backpack-header"),
              headingDisplays: [...panel.querySelectorAll(".backpack-heading")]
                .map((heading) => getComputedStyle(heading).display),
              controls,
              centers: controls.map((entry) => entry.top + (entry.height / 2)),
            };
          });
          panel.dataset.inventoryMode = "inventory";
          return layouts;
        });
        for (const headerLayout of headerLayouts) {
          assert.deepEqual(headerLayout.headingDisplays, ["none", "none"], `${viewport.name}/${headerLayout.mode}: mobile heading icons must be removed`);
          assert.ok(headerLayout.header.height <= 44.5, `${viewport.name}/${headerLayout.mode}: backpack header is too tall (${JSON.stringify(headerLayout)})`);
          assert.ok(headerLayout.controls[0].width >= 70 && headerLayout.controls[1].width >= 70, `${viewport.name}/${headerLayout.mode}: mode tabs were squeezed`);
          assert.ok(Math.max(...headerLayout.centers) - Math.min(...headerLayout.centers) <= 2, `${viewport.name}/${headerLayout.mode}: header controls wrapped`);
        }
      }
      await page.locator("#marketButton").click({ force: true });
      await page.waitForSelector("#marketListingGrid .market-loading");
      assert.equal(await page.locator("#marketListingGrid .market-listing-card").count(), 1, `${viewport.name}: only the real treasury product may render while chain listings load`);
      assert.equal(
        await page.locator("#marketListingGrid .market-listing-card").first().getAttribute("data-listing-id"),
        "treasury-blank-land-contract",
        `${viewport.name}: the treasury contract must rank first`,
      );
      assert.match(await page.locator("#marketSearchMeta").textContent(), /Syncing chain listings/);
      assert.deepEqual(await page.locator("[data-market-category]").evaluateAll((buttons) => (
        buttons.map((button) => button.dataset.marketCategory)
      )), ["all", "contracts", "raw", "building", "equipment", "clothing"]);
      await page.evaluate(() => globalThis.__marketHarness.releaseInitialListingRead());
      await page.waitForSelector('#marketListingGrid canvas[data-smelting-material-id="copper_bloom"]');
      await page.waitForSelector("#marketListingGrid .market-loading", { state: "detached" });

      const presentation = await page.evaluate(() => {
        const body = document.querySelector("#marketBody");
        const canvas = document.querySelector('#marketListingGrid canvas[data-smelting-material-id="copper_bloom"]');
        const card = canvas?.closest(".market-listing-card");
        const blockCard = [...document.querySelectorAll("#marketListingGrid .market-listing-card")]
          .find((entry) => entry.textContent.includes("Basalt"));
        return {
          materialId: canvas?.dataset.smeltingMaterialId || "",
          cardText: card?.textContent || "",
          blockCardText: blockCard?.textContent || "",
          mobileTabsDisplay: getComputedStyle(document.querySelector(".market-mobile-view-tabs")).display,
          view: body?.dataset.mobileMarketView,
          overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        };
      });
      assert.equal(presentation.materialId, "copper_bloom", `${viewport.name}: wrong market item icon`);
      assert.match(presentation.cardText, /Copper Bloom/);
      assert.match(presentation.cardText, /Raw Materials/);
      assert.match(presentation.blockCardText, /Basalt/);
      assert.doesNotMatch(presentation.blockCardText, /Block #14|Resource 7/);
      assert.equal(presentation.overflowX, 0, `${viewport.name}: market overflowed horizontally`);

      await page.locator('#marketListingGrid .market-listing-card:not(.own) canvas[data-smelting-material-id="copper_bloom"]')
        .first()
        .locator("xpath=ancestor::article[contains(@class, 'market-listing-card')]//div[contains(@class, 'market-listing-copy')]")
        .click();
      await page.waitForTimeout(viewport.mobile ? 220 : 20);
      const detail = await page.evaluate(() => {
        const readRows = (selector) => Object.fromEntries([...document.querySelectorAll(`${selector} [data-market-detail-key]`)].map((row) => [
          row.dataset.marketDetailKey,
          row.querySelector("dd")?.textContent || "",
        ]));
        const bounds = document.querySelector("#marketListingDetail")?.getBoundingClientRect();
        return {
          item: readRows("#marketListingDetail .market-item-details"),
          listing: readRows("#marketListingDetail .market-listing-details"),
          visibleHeight: bounds ? Math.max(0, Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0)) : 0,
        };
      });
      assert.equal(detail.item.mass, "152 g", `${viewport.name}: market mass detail is missing`);
      assert.equal(detail.item.volume, "18.6 cm³", `${viewport.name}: market volume detail is missing`);
      assert.equal(detail.item.material, "Copper Bloom", `${viewport.name}: market material detail is missing`);
      assert.equal(detail.item.quality, "80%", `${viewport.name}: market quality detail is missing`);
      assert.equal(detail.item["item-id"], "41", `${viewport.name}: market item identity is missing`);
      assert.equal(detail.listing["listing-id"], "7", `${viewport.name}: listing identity is missing`);
      assert.equal(detail.listing["listing-pda"], "MarketListingAddress", `${viewport.name}: listing PDA is missing`);
      assert.ok(detail.visibleHeight >= 100, `${viewport.name}: selected listing details are not visible`);

      assert.equal(await page.locator('[data-market-tab="history"]').count(), 0, `${viewport.name}: retired history tab rendered`);
      assert.equal(await page.locator("#marketHistoryGrid").count(), 0, `${viewport.name}: retired history panel rendered`);

      if (viewport.mobile) {
        assert.equal(presentation.mobileTabsDisplay, "grid");
        assert.equal(presentation.view, "listings");
        await page.locator('[data-market-mobile-view="inventory"]').click();
        const inventoryView = await page.evaluate(() => ({
          view: document.querySelector("#marketBody")?.dataset.mobileMarketView,
          inventoryDisplay: getComputedStyle(document.querySelector(".market-inventory-dock")).display,
          exchangeDisplay: getComputedStyle(document.querySelector(".market-exchange")).display,
        }));
        assert.equal(inventoryView.view, "inventory");
        assert.notEqual(inventoryView.inventoryDisplay, "none");
        assert.equal(inventoryView.exchangeDisplay, "none");
      } else {
        assert.equal(presentation.mobileTabsDisplay, "none");
      }

      if (viewport.name === "portrait") await verifyTransactionProgress(page);
      assert.deepEqual(errors, [], `${viewport.name}: browser errors`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

test("market inventory keeps an incomplete row directly below the preceding row", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    await page.route(`${origin}/play/`, (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: sourceHtml,
    }));
    await page.goto(`${origin}/play/`, { waitUntil: "domcontentloaded" });
    await installMarketHarness(page, { inventoryItemCount: 6 });
    await page.locator("#marketButton").click({ force: true });
    await page.waitForFunction(() => document.querySelectorAll("#marketInventoryGrid .market-inventory-item").length === 6);

    const layout = await page.locator("#marketInventoryGrid").evaluate((grid) => {
      const cards = [...grid.querySelectorAll(".market-inventory-item")]
        .map((card) => card.getBoundingClientRect().toJSON());
      const style = getComputedStyle(grid);
      return {
        cards,
        rowGap: Number.parseFloat(style.rowGap) || 0,
        columns: style.gridTemplateColumns.split(" ").filter(Boolean).length,
      };
    });
    assert.equal(layout.columns, 4);
    assert.ok(
      layout.cards[4].top <= layout.cards[0].bottom + layout.rowGap + 1,
      `incomplete inventory row was pushed away from the first row (${JSON.stringify(layout)})`,
    );
    assert.ok(Math.abs(layout.cards[4].top - layout.cards[5].top) <= 1);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("market shows a retryable error instead of placeholder listings", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.route(`${origin}/play/`, (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: sourceHtml,
    }));
    await page.goto(`${origin}/play/`, { waitUntil: "domcontentloaded" });
    await installMarketHarness(page, { failInitialListingRead: true });
    await page.locator("#marketButton").click({ force: true });
    await page.waitForSelector("#marketListingGrid .market-load-error");
    assert.equal(await page.locator("#marketListingGrid .market-listing-card").count(), 1);
    assert.equal(
      await page.locator("#marketListingGrid .market-listing-card").first().getAttribute("data-listing-id"),
      "treasury-blank-land-contract",
    );
    assert.match(await page.locator("#marketListingGrid .market-load-error").textContent(), /RPC HTTP 503/);
    await page.evaluate(() => globalThis.__marketHarness.allowListingReads());
    await page.locator("#marketListingGrid .market-load-error button").click();
    await page.waitForSelector('#marketListingGrid canvas[data-smelting-material-id="copper_bloom"]');
    await context.close();
  } finally {
    await browser.close();
  }
});

test("market requires an explicit owner-funded membership before loading listings", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.route(`${origin}/play/`, (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: sourceHtml,
    }));
    await page.goto(`${origin}/play/`, { waitUntil: "domcontentloaded" });
    await installMarketHarness(page, { marketJoined: false });
    await page.locator("#marketButton").click({ force: true });
    await page.waitForSelector("#marketMembership:not([hidden])");
    const prompt = await page.evaluate(() => ({
      title: document.querySelector("#marketMembershipTitle")?.textContent || "",
      total: document.querySelector("#marketMembershipTotal")?.textContent || "",
      rules: document.querySelector("#marketMembershipRules")?.getAttribute("href") || "",
      bodyInert: document.querySelector("#marketBody")?.inert,
      listingCalls: globalThis.__marketHarness.getOperationCalls().listingReads,
    }));
    assert.match(prompt.title, /Join the market/);
    assert.match(prompt.total, /0\.001/);
    assert.equal(prompt.rules, "/docs/marketplace-listings/#join-market-membership");
    assert.equal(prompt.bodyInert, true);
    assert.equal(prompt.listingCalls, 0);

    await page.locator("#marketMembershipSubmit").click();
    await page.waitForSelector('#marketMembership[data-state="submitting"]');
    await page.waitForSelector("#marketMembership", { state: "hidden" });
    await page.evaluate(() => globalThis.__marketHarness.releaseInitialListingRead());
    await page.waitForSelector('#marketListingGrid canvas[data-smelting-material-id="copper_bloom"]');
    const joined = await page.evaluate(() => ({
      bodyInert: document.querySelector("#marketBody")?.inert,
      calls: globalThis.__marketHarness.getOperationCalls(),
    }));
    assert.equal(joined.bodyInert, false);
    assert.equal(joined.calls.join, 1);
    assert.equal(joined.calls.listingReads, 1);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("market keeps every active chain listing and ignores local fake custody", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.route(`${origin}/play/`, (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: sourceHtml,
    }));
    await page.goto(`${origin}/play/`, { waitUntil: "domcontentloaded" });
    await installMarketHarness(page, { includeLocalOnlySlot: true });
    await page.locator("#marketButton").click({ force: true });
    await page.evaluate(() => globalThis.__marketHarness.releaseInitialListingRead());
    await page.waitForSelector("#marketListingGrid .market-listing-card");
    assert.equal(await page.locator("#marketInventoryGrid .market-inventory-item").count(), 1);

    await page.evaluate(async () => {
      globalThis.__marketHarness.setLargeListingSet();
      await globalThis.__marketHarness.market.refreshChainListings({ force: true, quiet: true });
    });
    await page.waitForFunction(() => document.querySelector("#marketSearchMeta")?.textContent.includes("106 listings"));
    await page.locator('[data-market-tab="orders"]').click();
    const ownIds = await page.locator("#marketOrdersGrid .market-listing-card").evaluateAll((cards) => (
      cards.map((card) => card.dataset.listingId)
    ));
    assert.deepEqual(ownIds, ["LargeMarketListing104"]);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("a stale market refresh cannot overwrite a newer chain snapshot", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.route(`${origin}/play/`, (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: sourceHtml,
    }));
    await page.goto(`${origin}/play/`, { waitUntil: "domcontentloaded" });
    await installMarketHarness(page);
    await page.locator("#marketButton").click({ force: true });
    await page.evaluate(() => globalThis.__marketHarness.releaseInitialListingRead());
    await page.waitForSelector("#marketListingGrid .market-listing-card");
    await page.evaluate(() => globalThis.__marketHarness.runRefreshRace());
    await page.waitForFunction(() => document.querySelector("#marketListingGrid")?.textContent.includes("99 NCK"));
    assert.equal(await page.locator('#marketListingGrid [data-listing-id="StaleMarketListing"]').count(), 0);
    assert.equal(await page.locator('#marketListingGrid [data-listing-id="FreshMarketListing"]').count(), 2);
    await context.close();
  } finally {
    await browser.close();
  }
});

async function installMarketHarness(page, options = {}) {
  await page.evaluate(async ({
    failInitialListingRead,
    marketJoined = true,
    includeLocalOnlySlot = false,
    inventoryItemCount = 1,
  }) => {
    const [{ createPlayMarket }, chunk] = await Promise.all([
      import("/play/play-market.js"),
      import("/chunk.js/play.js"),
    ]);
    const byId = (id) => document.getElementById(id);
    const elements = {
      backpackPanel: byId("backpackPanel"),
      marketButton: byId("marketButton"),
      marketPanel: byId("marketPanel"),
      marketBody: byId("marketBody"),
      closeMarket: byId("closeMarketButton"),
      marketTabs: document.querySelectorAll("[data-market-tab]"),
      marketTabPanels: document.querySelectorAll("[data-market-tab-panel]"),
      marketMobileViewTabs: document.querySelectorAll("[data-market-mobile-view]"),
      marketWallet: byId("marketWallet"),
      marketBackpack: byId("marketBackpack"),
      marketRefresh: byId("marketRefreshButton"),
      marketSearch: byId("marketSearch"),
      marketSort: byId("marketSort"),
      marketCurrencyFilter: byId("marketCurrencyFilter"),
      marketSearchMeta: byId("marketSearchMeta"),
      marketStatus: byId("marketStatus"),
      marketMembership: byId("marketMembership"),
      marketMembershipEyebrow: byId("marketMembershipEyebrow"),
      marketMembershipTitle: byId("marketMembershipTitle"),
      marketMembershipBody: byId("marketMembershipBody"),
      marketMembershipUserRent: byId("marketMembershipUserRent"),
      marketMembershipNetworkFee: byId("marketMembershipNetworkFee"),
      marketMembershipTotal: byId("marketMembershipTotal"),
      marketMembershipCapacity: byId("marketMembershipCapacity"),
      marketMembershipState: byId("marketMembershipState"),
      marketMembershipSubmit: byId("marketMembershipSubmit"),
      marketCategoryButtons: document.querySelectorAll("[data-market-category]"),
      marketListingGrid: byId("marketListingGrid"),
      marketListingPager: byId("marketListingPager"),
      marketInventoryGrid: byId("marketInventoryGrid"),
      marketListingForm: byId("marketListingForm"),
      marketListingCategory: byId("marketListingCategory"),
      marketListingCurrency: byId("marketListingCurrency"),
      marketListingPrice: byId("marketListingPrice"),
      marketCreateListing: byId("marketCreateListing"),
      marketSelectedItem: byId("marketSelectedItem"),
      marketFormStatus: byId("marketFormStatus"),
      marketOrdersGrid: byId("marketOrdersGrid"),
      marketOrdersPager: byId("marketOrdersPager"),
      marketActiveOrdersGrid: byId("marketActiveOrdersGrid"),
      marketListingDetail: byId("marketListingDetail"),
      marketInventoryCount: byId("marketInventoryCount"),
      marketMyListings: byId("marketMyListingsButton"),
      marketViewOrders: byId("marketViewOrdersButton"),
      marketTradeToast: byId("marketTradeToast"),
      marketTradeToastMessage: byId("marketTradeToastMessage"),
    };
    const copperSlot = {
      id: "chain-copper-bloom",
      kind: "smelted_material",
      itemId: "chain_material",
      materialId: "copper_bloom",
      itemCode: 1015,
      label: "Copper Bloom",
      className: "Metal",
      count: 1,
      source: "chain",
      chainBackpack: "BuyerBackpackAddress",
      chainIndex: 0,
      chainItemId: "41",
      volumeMm3: 18_600,
      massGrams: 152,
      qualityBps: 8_000,
      quality: 80,
      pending: false,
    };
    const chainListing = {
      listing: "MarketListingAddress",
      listingId: "7",
      seller: "SellerWalletAddress",
      stateLabel: "active",
      category: "raw",
      currency: "NCK",
      price: "12.5",
      quantity: 1,
      source: "backpack",
      sourceSlot: {
        kind: "item",
        kindCode: 2,
        category: 1,
        itemCode: 1015,
        itemId: "41",
        itemPda: "ItemPdaAddress",
        quantity: 1,
        volumeMm3: 18_600,
        massGrams: 152,
        qualityBps: 8_000,
        metadata: 0,
      },
    };
    const ownChainListing = {
      ...chainListing,
      listing: "OwnMarketListingAddress",
      listingId: "8",
      seller: "BuyerWalletAddress",
      price: "7.25",
      sourceSlot: {
        ...chainListing.sourceSlot,
        itemId: "42",
      },
    };
    const blockChainListing = {
      listing: "BlockMarketListingAddress",
      listingId: "9",
      seller: "BlockSellerWalletAddress",
      stateLabel: "active",
      category: "raw",
      currency: "NCK",
      price: "2.5",
      quantity: 3,
      source: "backpack",
      sourceRecord: {
        worldX: 12,
        worldY: 64,
        worldZ: -7,
        blockId: 14,
      },
      sourceSlot: {
        kind: "block",
        kindCode: 1,
        category: 0,
        itemCode: 0,
        itemId: "0",
        itemPda: "11111111111111111111111111111111",
        quantity: 3,
        resource: {
          worldX: 12,
          worldY: 64,
          worldZ: -7,
          blockId: 14,
        },
        volumeMm3: 300_000,
        massGrams: 840,
        metadata: 0,
      },
    };
    let listingRecords = [chainListing, ownChainListing, blockChainListing];
    let listingReadPlan = [];
    const operationCalls = { listing: 0, buy: 0, cancel: 0, contract: 0, join: 0, listingReads: 0 };
    let joinedMarket = marketJoined;
    let blankLandContracts = 4;
    const reservedBlankLandContracts = 1;
    let failNextBuy = false;
    const submissionFailures = { listing: "", buy: "", cancel: "" };
    let failListingReads = Boolean(failInitialListingRead);
    let holdInitialListingRead = !failInitialListingRead;
    let releaseInitialListingRead = null;
    const delayOperation = () => new Promise((resolve) => setTimeout(resolve, 360));
    const chainModule = {
      fetchMarketListingsOnChain: async () => {
        operationCalls.listingReads += 1;
        if (listingReadPlan.length) {
          const planned = listingReadPlan.shift();
          await new Promise((resolve) => setTimeout(resolve, planned.delay));
          return planned.items;
        }
        if (holdInitialListingRead) {
          await new Promise((resolve) => { releaseInitialListingRead = resolve; });
        } else {
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        if (failListingReads) throw new Error("RPC HTTP 503");
        return listingRecords;
      },
      fetchMarketUserStateOnChain: async () => joinedMarket ? ({
        owner: "BuyerWalletAddress",
        marketUser: "BuyerMarketUserAddress",
        activeListingCount: 1,
        maxActiveListings: 50,
        blankLandContracts,
        reservedBlankLandContracts,
      }) : null,
      estimateMarketJoinCostOnChain: async () => ({
        available: true,
        userStateRentSol: 0.00133632,
        storageRentSol: 0.00133632,
        networkFeeSol: 0.000005,
        totalSol: 0.00134132,
      }),
      joinMarketOnChain: async () => {
        operationCalls.join += 1;
        await delayOperation();
        joinedMarket = true;
        return { submitted: true, signature: "MarketJoinSignature123456789" };
      },
      createMarketListingOnChain: async () => {
        operationCalls.listing += 1;
        await delayOperation();
        if (submissionFailures.listing) {
          const reason = submissionFailures.listing;
          submissionFailures.listing = "";
          return { submitted: false, reason };
        }
        return { submitted: true, signature: "MarketCreateSignature123456789" };
      },
      buyMarketListingOnChain: async () => {
        operationCalls.buy += 1;
        await delayOperation();
        if (failNextBuy) {
          failNextBuy = false;
          throw new Error("simulated purchase rejection");
        }
        if (submissionFailures.buy) {
          const reason = submissionFailures.buy;
          submissionFailures.buy = "";
          return { submitted: false, reason };
        }
        return { submitted: true, signature: "MarketBuySignature123456789" };
      },
      buyLandContractsOnChain: async ({ quantity }) => {
        operationCalls.contract += 1;
        await delayOperation();
        blankLandContracts += quantity;
        return {
          submitted: true,
          signature: "LandContractPurchaseSignature123456789",
          quantity,
          marketUserState: {
            owner: "BuyerWalletAddress",
            marketUser: "BuyerMarketUserAddress",
            activeListingCount: 1,
            maxActiveListings: 50,
            blankLandContracts,
            reservedBlankLandContracts,
          },
        };
      },
      cancelMarketListingOnChain: async () => {
        operationCalls.cancel += 1;
        await delayOperation();
        if (submissionFailures.cancel) {
          const reason = submissionFailures.cancel;
          submissionFailures.cancel = "";
          return { submitted: false, reason };
        }
        return { submitted: true, signature: "MarketCancelSignature123456789" };
      },
    };
    const interpolate = (text, params = {}) => Object.entries(params).reduce(
      (value, [key, replacement]) => value.replaceAll(`{${key}}`, String(replacement)),
      String(text),
    );
    const chainInventorySlots = Array.from(
      { length: Math.max(1, Math.min(50, Math.trunc(Number(inventoryItemCount) || 1))) },
      (_, index) => ({
        ...copperSlot,
        id: `chain-copper-bloom-${index}`,
        chainIndex: index,
        chainItemId: String(41 + index),
      }),
    );
    const gameState = {
      backpackCapacity: 50,
      backpackSlots: [
        ...chainInventorySlots,
        ...(includeLocalOnlySlot ? [{
          ...copperSlot,
          id: "local-only-copper",
          source: "local",
          chainBackpack: "",
          chainIndex: null,
        }] : []),
      ],
      hotbarSlots: [],
      isBackpackSlotEquipped: () => false,
      addBackpackSlotSnapshot: () => true,
      consumeBackpackItems: () => ({ ok: false, reason: "chain-only-test" }),
    };
    if (includeLocalOnlySlot) {
      localStorage.setItem("nicechunk.play.marketListings.v1", JSON.stringify([{
        id: "fake-local-listing",
        source: "local",
        owner: "local-session",
        status: "active",
        name: "Fake local custody",
        category: "raw",
        currency: "NCK",
        price: "1",
        itemSnapshot: gameState.backpackSlots.at(-1),
      }]));
    }
    const market = createPlayMarket({
      elements,
      gameState,
      createVoxelItemIconCanvas: chunk.createVoxelItemIconCanvas,
      resourceName: chunk.resourceName,
      voxelItemLabel: chunk.voxelItemLabel,
      getChainSnapshot: () => ({
        walletAddress: "BuyerWalletAddress",
        walletShort: "Buyer...ress",
        chainBackpack: { backpackAddress: "BuyerBackpackAddress" },
      }),
      refreshChainInventory: async () => null,
      loadChainModule: async () => chainModule,
      translate: (_key, fallback, params) => interpolate(fallback, params),
      onEnterMarket: () => { elements.backpackPanel.hidden = true; },
      onReturnToBackpack: () => { elements.backpackPanel.hidden = false; },
    });
    market.bind();
    elements.marketPanel.hidden = true;
    elements.backpackPanel.hidden = false;
    globalThis.__marketHarness = {
      market,
      getOperationCalls: () => ({ ...operationCalls }),
      failNextBuy: () => { failNextBuy = true; },
      failNextSubmission: (action, reason) => { submissionFailures[action] = reason; },
      allowListingReads: () => { failListingReads = false; },
      releaseInitialListingRead: () => {
        holdInitialListingRead = false;
        releaseInitialListingRead?.();
        releaseInitialListingRead = null;
      },
      setLargeListingSet: () => {
        listingRecords = Array.from({ length: 105 }, (_, index) => ({
          ...chainListing,
          listing: `LargeMarketListing${index}`,
          listingId: String(1_000 + index),
          seller: index === 104 ? "BuyerWalletAddress" : `SellerWalletAddress${index}`,
          price: String(index + 1),
          createdAt: String(1_700_000_000 + index),
          sourceSlot: {
            ...chainListing.sourceSlot,
            itemId: String(2_000 + index),
          },
        }));
      },
      runRefreshRace: async () => {
        listingReadPlan = [
          {
            delay: 180,
            items: [{ ...chainListing, listing: "StaleMarketListing", listingId: "800", price: "1" }],
          },
          {
            delay: 20,
            items: [{ ...chainListing, listing: "FreshMarketListing", listingId: "801", price: "99" }],
          },
        ];
        const stale = market.refreshChainListings({ force: true, quiet: true });
        await Promise.resolve();
        const fresh = market.refreshChainListings({ force: true, quiet: true });
        await Promise.all([stale, fresh]);
      },
    };
  }, options);
}

async function verifyTransactionProgress(page) {
  await verifyContractPurchaseProgress(page);
  await page.locator('[data-market-tab="sell"]').click();
  await page.locator('[data-market-mobile-view="inventory"]').click();
  await page.locator("#marketInventoryGrid .market-inventory-item").click();
  await page.locator("#marketListingPrice").fill("3.5");
  await page.locator("#marketCreateListing").click();
  await page.waitForTimeout(60);
  const pending = await page.evaluate(() => ({
    disabled: document.querySelector("#marketCreateListing")?.disabled,
    busy: document.querySelector("#marketCreateListing")?.getAttribute("aria-busy"),
    pendingClass: document.querySelector("#marketCreateListing")?.classList.contains("is-pending"),
    toastTone: document.querySelector("#marketTradeToast")?.dataset.tone,
    toastHidden: document.querySelector("#marketTradeToast")?.hidden,
    calls: globalThis.__marketHarness.getOperationCalls().listing,
  }));
  assert.deepEqual(pending, {
    disabled: true,
    busy: "true",
    pendingClass: true,
    toastTone: "pending",
    toastHidden: false,
    calls: 1,
  });
  await page.evaluate(() => document.querySelector("#marketCreateListing")?.click());
  await page.waitForTimeout(520);
  const complete = await page.evaluate(() => ({
    disabled: document.querySelector("#marketCreateListing")?.disabled,
    busy: document.querySelector("#marketCreateListing")?.getAttribute("aria-busy"),
    toastTone: document.querySelector("#marketTradeToast")?.dataset.tone,
    toastText: document.querySelector("#marketTradeToastMessage")?.textContent,
    toastVisible: document.querySelector("#marketTradeToast")?.classList.contains("is-visible"),
    calls: globalThis.__marketHarness.getOperationCalls().listing,
  }));
  assert.equal(complete.disabled, false);
  assert.equal(complete.busy, "false");
  assert.equal(complete.toastTone, "success");
  assert.match(complete.toastText, /Listing created on-chain:/);
  assert.equal(complete.toastVisible, true);
  assert.equal(complete.calls, 1);

  await page.locator('[data-market-tab="browse"]').click();
  await page.locator('[data-market-mobile-view="listings"]').click();
  await verifyListingActionProgress(page, "buy", "buy", "success");
  await verifyListingActionProgress(page, "cancel", "cancel", "success", ".market-listing-card.own ");

  await page.evaluate(() => globalThis.__marketHarness.failNextBuy());
  await verifyListingActionProgress(page, "buy", "buy", "error");

  await verifyRejectedSubmissionReason(page, "buy", "no-backpack", /Equip a backpack to buy this listing/);
  await verifyRejectedSubmissionReason(page, "cancel", "no-backpack", /Free one backpack slot before canceling this listing/, ".market-listing-card.own ");

  await page.locator('[data-market-tab="sell"]').click();
  await page.locator('[data-market-mobile-view="inventory"]').click();
  await page.locator("#marketInventoryGrid .market-inventory-item").click();
  await page.locator("#marketListingPrice").fill("3.5");
  await page.evaluate(() => globalThis.__marketHarness.failNextSubmission("listing", "no-backpack"));
  await page.locator("#marketCreateListing").click();
  await page.waitForTimeout(520);
  assert.match(await page.locator("#marketTradeToastMessage").textContent(), /Listing unavailable/);
}

async function verifyContractPurchaseProgress(page) {
  await page.locator('[data-market-tab="browse"]').click();
  await page.locator('[data-market-mobile-view="listings"]').click();
  await page.locator('[data-listing-id="treasury-blank-land-contract"] .market-listing-copy').click();
  await page.waitForSelector("#marketContractQuantity");
  await page.locator("#marketContractQuantity").fill("3");
  assert.equal(await page.locator("#marketContractTotal strong").textContent(), "3 NCK");
  await page.locator('button[data-market-action="buy-contract"]').click();
  await page.waitForTimeout(60);

  const pending = await page.evaluate(() => {
    const button = document.querySelector('button[data-market-action="buy-contract"]');
    return {
      disabled: button?.disabled,
      busy: button?.getAttribute("aria-busy"),
      pendingClass: button?.classList.contains("is-pending"),
      toastTone: document.querySelector("#marketTradeToast")?.dataset.tone,
      toastText: document.querySelector("#marketTradeToastMessage")?.textContent,
      calls: globalThis.__marketHarness.getOperationCalls().contract,
    };
  });
  assert.deepEqual(pending, {
    disabled: true,
    busy: "true",
    pendingClass: true,
    toastTone: "pending",
    toastText: "Confirm the treasury contract purchase in your wallet.",
    calls: 1,
  });
  await page.evaluate(() => document.querySelector('button[data-market-action="buy-contract"]')?.click());
  await page.waitForTimeout(520);

  const complete = await page.evaluate(() => ({
    disabled: document.querySelector('button[data-market-action="buy-contract"]')?.disabled,
    busy: document.querySelector('button[data-market-action="buy-contract"]')?.getAttribute("aria-busy"),
    total: document.querySelector("#marketContractTotal strong")?.textContent,
    toastTone: document.querySelector("#marketTradeToast")?.dataset.tone,
    toastText: document.querySelector("#marketTradeToastMessage")?.textContent,
    calls: globalThis.__marketHarness.getOperationCalls().contract,
  }));
  assert.equal(complete.disabled, false);
  assert.equal(complete.busy, "false");
  assert.equal(complete.total, "3 NCK");
  assert.equal(complete.toastTone, "success");
  assert.match(complete.toastText, /Purchased 3 land contract\(s\)\. Owned: 7\./);
  assert.equal(complete.calls, 1, "pending contract purchases must ignore repeated clicks");
}

async function verifyRejectedSubmissionReason(page, action, reason, expectedMessage, cardPrefix = "") {
  const selector = `#marketListingGrid ${cardPrefix}button[data-market-action="${action}"]`;
  await page.evaluate(({ action, reason }) => globalThis.__marketHarness.failNextSubmission(action, reason), { action, reason });
  await page.locator(selector).first().click();
  await page.waitForTimeout(520);
  assert.equal(await page.locator("#marketTradeToast").getAttribute("data-tone"), "error");
  assert.match(await page.locator("#marketTradeToastMessage").textContent(), expectedMessage);
}

async function verifyListingActionProgress(page, action, counter, expectedTone, cardPrefix = "") {
  const selector = `#marketListingGrid ${cardPrefix}button[data-market-action="${action}"]`;
  await page.locator(selector).first().click();
  await page.waitForTimeout(60);
  const pending = await page.evaluate(({ selector, counter }) => {
    const button = document.querySelector(selector);
    return {
      disabled: button?.disabled,
      busy: button?.getAttribute("aria-busy"),
      pendingClass: button?.classList.contains("is-pending"),
      allActionsDisabled: [...document.querySelectorAll("button[data-market-action]")].every((entry) => entry.disabled),
      toastTone: document.querySelector("#marketTradeToast")?.dataset.tone,
      calls: globalThis.__marketHarness.getOperationCalls()[counter],
    };
  }, { selector, counter });
  assert.deepEqual(pending, {
    disabled: true,
    busy: "true",
    pendingClass: true,
    allActionsDisabled: true,
    toastTone: "pending",
    calls: expectedTone === "error" ? 2 : 1,
  });

  await page.evaluate((selector) => document.querySelector(selector)?.click(), selector);
  await page.waitForTimeout(520);
  const complete = await page.evaluate(({ selector, counter }) => {
    const button = document.querySelector(selector);
    return {
      disabled: button?.disabled,
      busy: button?.getAttribute("aria-busy"),
      pendingClass: button?.classList.contains("is-pending"),
      toastTone: document.querySelector("#marketTradeToast")?.dataset.tone,
      calls: globalThis.__marketHarness.getOperationCalls()[counter],
    };
  }, { selector, counter });
  assert.deepEqual(complete, {
    disabled: false,
    busy: "false",
    pendingClass: false,
    toastTone: expectedTone,
    calls: expectedTone === "error" ? 2 : 1,
  });
}
