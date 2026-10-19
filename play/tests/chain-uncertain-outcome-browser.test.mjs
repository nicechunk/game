import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";

test("a signature confirmation timeout remains unknown, never retries submission, and uses receipts for recovery", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of ["place-confirmed", "mine-confirmed", "tree-confirmed", "mine-unknown", "mine-failed"]) {
      const page = await browser.newPage();
      await page.route(`${origin}/play/tests/uncertain`, (route) => route.fulfill({ contentType: "text/html", body: '<div id="events"></div>' }));
      await page.route(`${origin}/uncertain-chain.js`, (route) => route.fulfill({ contentType: "text/javascript", body: `
        function submit() { window.calls.submitted++; throw Object.assign(new Error('status wait timeout'), {signature:'local-only-uncertain-signature', nicechunkSubmissionUncertain:true}); }
        export const recordBlockBreakOnChain=submit,recordTreeFellOnChain=submit,recordBlockPlacementOnChain=submit;
        export function renderTypeForBlockId(){return 'stone'}
        export async function fetchNicechunkTransactionConfirmation(signature) { window.calls.statusReads++; return {state:window.outcome,signature,executionSlot:17,commitment:'confirmed',responseContextSlot:999}; }
      ` }));
      await page.goto(`${origin}/play/tests/uncertain`);
      await page.evaluate(async (scenario) => {
        localStorage.setItem("nicechunk.walletAddress", "local-only-browser-fixture");
        window.NICECHUNK_CHAIN_MODULE_URL = "/uncertain-chain.js";
        window.calls = { submitted: 0, statusReads: 0, confirmed: [], rolledBack: [], deferred: [] };
        window.outcome = scenario.split("-")[1] === "unknown" ? "unknown" : scenario.split("-")[1] === "failed" ? "failed" : "confirmed";
        const nativeTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, ms, ...args) => nativeTimeout(callback, ms === 5000 ? 0 : ms, ...args);
        const { createPlayChainSession } = await import("/play/play-chain-session.js");
        const session = createPlayChainSession({ elements: { chainEventLog: document.querySelector("#events") }, gameState: { playerProfile: {}, savePlayerProfile() {} } });
        const pending = { txId: scenario, worldX: 2, worldY: -17, worldZ: 3, blockId: 7, resourceId: 41, anchorWorldX: 2, anchorWorldY: -18, anchorWorldZ: 3 };
        if (scenario.startsWith("mine")) { pending.miningKind = "single-block"; pending.blocks = [{ ...pending }]; }
        if (scenario.startsWith("tree")) { pending.miningKind = "tree-fell"; pending.blocks = [{ ...pending }, { ...pending, worldY: -16 }]; }
        const controls = { validateTx: () => ({ ok: true }), confirmTx: (txId, receipt) => { calls.confirmed.push({ txId, receipt }); return pending; }, rollbackTx: (txId) => { calls.rolledBack.push(txId); return pending; }, deferToAuthorityTx: (txId) => { calls.deferred.push(txId); return pending; } };
        if (scenario.startsWith("place")) session.handlePendingPlace(pending, controls);
        else session.handlePendingMine(pending, controls);
      }, scenario);
      await page.waitForFunction(() => calls.confirmed.length + calls.rolledBack.length + calls.deferred.length > 0);
      const calls = await page.evaluate(() => window.calls);
      assert.equal(calls.submitted, 1, "status recovery must not broadcast the action again");
      if (scenario === "place-confirmed" || scenario === "mine-confirmed") {
        assert.equal(calls.confirmed.length, 1);
        assert.equal(calls.confirmed[0].receipt.executionSlot, 17);
        assert.equal(calls.confirmed[0].receipt.responseContextSlot, 999);
        assert.equal(calls.rolledBack.length, 0);
        assert.equal(calls.deferred.length, 0);
      } else if (scenario === "mine-failed") {
        assert.equal(calls.rolledBack.length, 1, "only a signature execution error proves failure");
      } else {
        assert.equal(calls.confirmed.length, 0, "an unknown or multi-action receipt cannot fabricate full confirmation");
        assert.equal(calls.rolledBack.length, 0);
        assert.deepEqual(calls.deferred, [scenario]);
      }
      await page.close();
    }
  } finally { await browser.close(); }
});
