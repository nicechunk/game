import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const englishLocale = await readFile(new URL("../../public/play/locales/en.json", import.meta.url), "utf8");
const browser = await chromium.launch({ headless: true });

try {
  const success = await runScenario({
    delayMs: 80,
    result: {
      submitted: true,
      signature: "bulk-confirmed-signature-111111",
      lossyRewards: true,
      storedRewardCount: 0,
      storedRewards: [],
    },
  });
  assert.equal(success.chainCalls, 1);
  assert.equal(success.confirmed, 1);
  assert.equal(success.rolledBack, 0);
  assert.equal(success.legacyChainSync, null);
  assert.equal(success.cardState, "confirmed");
  assert.equal(success.initialCardState, "pending");
  assert.match(success.initialCardText, /Submitting 2 blocks/);
  assert.doesNotMatch(success.initialCardText, /Mining complete/);
  assert.match(success.cardText, /Mining complete .* 2 blocks/);

  const rejected = await runScenario({
    result: { submitted: false, reason: "bulk-mining-not-confirmed" },
  });
  assert.equal(rejected.chainCalls, 1);
  assert.equal(rejected.confirmed, 0);
  assert.equal(rejected.rolledBack, 1);
  assert.equal(rejected.cardState, "error");
  assert.match(rejected.cardText, /Mining transaction failed/);
  assert.doesNotMatch(rejected.cardText, /Mining complete/);

  const unsigned = await runScenario({ result: { submitted: true } });
  assert.equal(unsigned.chainCalls, 1);
  assert.equal(unsigned.confirmed, 0);
  assert.equal(unsigned.rolledBack, 1);
  assert.equal(unsigned.cardState, "error");
  assert.match(unsigned.cardText, /missing-chain-signature/);

  const exception = await runScenario({ result: { throwMessage: "simulation failed" } });
  assert.equal(exception.chainCalls, 1);
  assert.equal(exception.confirmed, 0);
  assert.equal(exception.rolledBack, 1);
  assert.equal(exception.cardState, "error");
  assert.match(exception.cardText, /simulation failed/);

  const walletMissing = await runScenario({
    walletAddress: "",
    result: { submitted: true, signature: "must-not-submit" },
  });
  assert.equal(walletMissing.chainCalls, 0);
  assert.equal(walletMissing.confirmed, 0);
  assert.equal(walletMissing.rolledBack, 1);
  assert.equal(walletMissing.cardState, "error");
  assert.match(walletMissing.cardText, /wallet-needed/);
} finally {
  await browser.close();
}

async function runScenario({ result, delayMs = 0, walletAddress = "Wallet111111111111111111111111111111111" }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route(`${origin}/play/tests/bulk-chain-state`, (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html lang=\"en\" data-i18n-scope=\"play\"><body><div id=\"events\"></div></body></html>",
  }));
  await page.route(`${origin}/play/tests/fake-bulk-chain-module.js*`, (route) => route.fulfill({
    contentType: "text/javascript",
    body: [
      "export async function recordBulkMineOnChain(blocks) {",
      "  globalThis.__bulkChainCalls = (globalThis.__bulkChainCalls || 0) + 1;",
      "  if (localStorage.getItem('nicechunk.chainSync') === '0') return { submitted: false, reason: 'chain-sync-disabled' };",
      "  const result = structuredClone(globalThis.__bulkChainResult);",
      "  if (globalThis.__bulkChainDelayMs) await new Promise((resolve) => setTimeout(resolve, globalThis.__bulkChainDelayMs));",
      "  if (result.throwMessage) throw new Error(result.throwMessage);",
      "  if (result.submitted) result.confirmedBlocks = blocks;",
      "  return result;",
      "}",
    ].join("\n"),
  }));
  await page.route(`${origin}/play/locales/en.json*`, (route) => route.fulfill({
    contentType: "application/json",
    body: englishLocale,
  }));
  await page.goto(`${origin}/play/tests/bulk-chain-state`, { waitUntil: "domcontentloaded" });

  const output = await page.evaluate(async ({ chainResult, delayMs, walletAddress }) => {
    localStorage.clear();
    if (walletAddress) localStorage.setItem("nicechunk.walletAddress", walletAddress);
    localStorage.setItem("nicechunk.chainSync", "0");
    globalThis.NICECHUNK_BULK_MINING_MODULE_URL = "/play/tests/fake-bulk-chain-module.js";
    globalThis.__bulkChainResult = chainResult;
    globalThis.__bulkChainDelayMs = delayMs;
    globalThis.__bulkChainCalls = 0;

    const [{ createPlayChainSession }, { initI18n }] = await Promise.all([
      import("/play/play-chain-session.js"),
      import("/src/i18n.js"),
    ]);
    await initI18n();
    const pending = {
      txId: "local-pending-mobile-1",
      worldX: 4,
      worldY: 80,
      worldZ: 6,
      blockId: 1,
      resourceId: 1,
      miningKind: "debug-bulk",
      batchAuthorization: "debug",
      lossyRewards: true,
      minedBlockCount: 2,
      blocks: [
        { worldX: 4, worldY: 80, worldZ: 6, blockId: 1, resourceId: 1 },
        { worldX: 5, worldY: 80, worldZ: 6, blockId: 1, resourceId: 1 },
      ],
      pendingDeltas: [
        { worldX: 4, worldY: 80, worldZ: 6, blockId: 0 },
        { worldX: 5, worldY: 80, worldZ: 6, blockId: 0 },
      ],
      rewardGroups: [],
    };
    let confirmed = 0;
    let rolledBack = 0;
    let session;
    session = createPlayChainSession({
      elements: { chainEventLog: document.querySelector("#events") },
      gameState: {
        playerProfile: { minedBlocks: 2 },
        savePlayerProfile() {},
      },
      resourceName: () => "Grass",
    });
    session.handlePendingMine(pending, {
      confirmTx() {
        confirmed += 1;
        session.handleConfirmedMine(pending);
        return pending;
      },
      rollbackTx() {
        rolledBack += 1;
        session.handleRollbackMine(pending);
        return pending;
      },
    });
    const initialCard = document.querySelector(".chain-event-card");
    const initialCardState = initialCard?.dataset?.state || "";
    const initialCardText = initialCard?.textContent || "";
    const deadline = performance.now() + 1500;
    while (!confirmed && !rolledBack && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const card = document.querySelector(".chain-event-card");
    return {
      chainCalls: globalThis.__bulkChainCalls,
      confirmed,
      rolledBack,
      legacyChainSync: localStorage.getItem("nicechunk.chainSync"),
      initialCardState,
      initialCardText,
      cardState: card?.dataset?.state || "",
      cardText: card?.textContent || "",
    };
  }, { chainResult: result, delayMs, walletAddress });

  await page.close();
  return output;
}
