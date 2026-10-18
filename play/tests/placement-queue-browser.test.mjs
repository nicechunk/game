import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startStaticServer } from "../../scripts/serve-static-site.mjs";

const server = await startStaticServer({ rootDirectory: new URL("../..", import.meta.url).pathname });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route(`${server.baseUrl}/placement-queue`, (route) => route.fulfill({
    contentType: "text/html", body: '<div id="events"></div>',
  }));
  await page.route(`${server.baseUrl}/queue-chain.js`, (route) => route.fulfill({
    contentType: "text/javascript",
    body: `export function renderTypeForBlockId(){return 'stone'}
      export function recordBlockPlacementOnChain(block) {
        window.started.push(block.x);
        return new Promise(resolve => window.finish.push(resolve));
      }`,
  }));
  await page.goto(`${server.baseUrl}/placement-queue`);
  await page.evaluate(async () => {
    localStorage.setItem("nicechunk.walletAddress", "browser-fixture");
    window.NICECHUNK_CHAIN_MODULE_URL = "/queue-chain.js";
    window.started = []; window.finish = []; window.confirmed = []; window.rolledBack = [];
    const { createPlayChainSession } = await import("/play/play-chain-session.js");
    const session = createPlayChainSession({ elements: { chainEventLog: document.querySelector("#events") }, gameState: { playerProfile: {} } });
    const pending = [1, 2, 3].map((worldX) => ({ txId: `queued-${worldX}`, worldX, worldY: 1, worldZ: 0,
      anchorWorldX: 0, anchorWorldY: 1, anchorWorldZ: 0, blockId: 7, resourceId: 41 }));
    for (const item of pending) session.handlePendingPlace(item, {
      validateTx: () => ({ ok: true }),
      confirmTx(txId) { confirmed.push(txId); session.handleConfirmedPlace(item); return item; },
      rollbackTx(txId) { rolledBack.push(txId); session.handleRollbackPlace(item); return item; },
    });
  });
  await page.waitForFunction(() => started.length === 1);
  assert.deepEqual(await page.evaluate(() => started), [1]);
  const card = (id) => page.locator(`[data-event-id="queued-${id}"]`);
  assert.match(await card(1).innerText(), /SUBMITTING/);
  assert.match(await card(2).innerText(), /QUEUED/);
  await page.evaluate(() => finish.shift()({ submitted: true, signature: "fixture-one" }));
  await page.waitForFunction(() => started.length === 2);
  assert.equal(await card(1).getAttribute("data-state"), "confirmed");
  assert.match(await card(2).innerText(), /SUBMITTING/);
  assert.match(await card(3).innerText(), /QUEUED/);
  await page.evaluate(() => finish.shift()({ submitted: false, reason: "fixture-rejected" }));
  await page.waitForFunction(() => started.length === 3);
  assert.equal(await card(2).getAttribute("data-state"), "error");
  await page.evaluate(() => finish.shift()({ submitted: true, signature: "fixture-three" }));
  await page.waitForFunction(() => confirmed.length === 2);
  assert.deepEqual(await page.evaluate(() => ({ confirmed, rolledBack })), {
    confirmed: ["queued-1", "queued-3"], rolledBack: ["queued-2"],
  });
  assert.equal(await page.locator("#events article").count(), 3, "each log card updates through its lifecycle");
} finally {
  await browser.close(); await server.close();
}
