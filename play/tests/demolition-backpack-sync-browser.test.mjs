import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(`${origin}/play/tests/demolition-backpack-sync`, route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><meta charset=utf-8><main>Backpack sync regression</main>",
  }));
  await page.route(`${origin}/backpack-fixture.js`, route => route.fulfill({
    contentType: "text/javascript",
    body: `export const getEquippedBackpackStatus = () => globalThis.backpackFixture.status();
      export const fetchBackpack = address => globalThis.backpackFixture.fetch(address);`,
  }));
  await page.goto(`${origin}/play/tests/demolition-backpack-sync`);
  const result = await page.evaluate(async () => {
    globalThis.NICECHUNK_CHAIN_MODULE_URL = "/backpack-fixture.js";
    const { createPlayChainBackpackSync } = await import("/play/play-chain-backpack.js");
    const { createPlayGameState } = await import("/play/game-state.js");
    const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
    let wallet = "wallet-A", latest = null, delay = null, nextFetch = null, fetches = 0;
    const backpack = (updatedSlot, quantity, owner = wallet) => ({
      publicKey: `pack-${owner}`, owner, capacity: 50, itemCount: 1, updatedSlot,
      totalMassGrams: String(quantity * 2600),
      slots: [{ kind: "block", quantity, metadata: 0, volumeMm3: quantity * 1_000_000, massGrams: quantity * 2600,
        resource: { worldX: 2, worldY: 100, worldZ: 3, blockId: 3 } }],
    });
    globalThis.backpackFixture = {
      async status() { const value = latest; if (delay) { const wait = delay; delay = null; wait.started?.resolve(); await wait.promise; } return { equipped: true, backpack: value }; },
      async fetch() { fetches++; return nextFetch ? nextFetch() : latest; },
    };
    latest = backpack("100", 2);
    const gameState = createPlayGameState({ ownerAddress: wallet });
    let changes = 0;
    const sync = createPlayChainBackpackSync({ gameState, getWalletAddress: () => wallet, onChanged: () => { changes++; } });
    await sync.refresh({ force: true });

    // A slow pre-confirmation read previously consumed every retry without a
    // single fresh read, leaving the confirmed reward invisible when opened.
    const slow = deferred(); delay = slow;
    const periodicRead = sync.refresh({ force: true });
    const mutation = sync.refreshAfterMutation({ previousUpdatedSlot: "100", minimumUpdatedSlot: "101",
      previousResources: [{ identity: "3:0", blockId: 3, quantity: 2 }], storedRewards: [{ blockId: 3, count: 1 }] });
    await new Promise(resolve => setTimeout(resolve, 2100));
    latest = backpack("101", 3); slow.resolve();
    await periodicRead;
    const synced = await mutation;
    const slowReadResult = { ok: synced.ok, fetches, quantity: gameState.backpackSlots[0]?.count, slot: sync.snapshot().updatedSlot };

    // A replica behind the transaction must not erase the visible inventory.
    latest = backpack("99", 1);
    const stale = await sync.refresh({ force: true });
    const staleReadResult = { rejected: stale.ok === false, quantity: gameState.backpackSlots[0]?.count, slot: sync.snapshot().updatedSlot };

    // Multiple transactions can share a Solana slot. Validate reward quantity,
    // not merely an item count (which stays constant for stacked resources).
    let replicaReads = 0; const beforeRetryChanges = changes;
    nextFetch = () => ++replicaReads === 1 ? backpack("101", 3) : backpack("101", 4);
    const sameSlot = await sync.refreshAfterMutation({ previousUpdatedSlot: "101", minimumUpdatedSlot: "101",
      previousResources: [{ identity: "3:0", blockId: 3, quantity: 3 }], storedRewards: [{ blockId: 3, count: 1 }] });
    const sameSlotResult = { ok: sameSlot.ok, reads: replicaReads, changes: changes - beforeRetryChanges,
      quantity: gameState.backpackSlots[0]?.count, slot: sync.snapshot().updatedSlot };
    nextFetch = null;

    // A wallet change while waiting cannot merge or retry the old wallet's PDA.
    latest = backpack("101", 4); const switched = { ...deferred(), started: deferred() }; delay = switched;
    const oldRead = sync.refresh({ force: true });
    const oldMutation = sync.refreshAfterMutation({ previousUpdatedSlot: "101" });
    await switched.started.promise;
    wallet = "wallet-B"; latest = backpack("200", 7); gameState.setOwnerAddress(wallet);
    await sync.refresh({ force: true }); switched.resolve(); await oldRead;
    const abandoned = await oldMutation;
    const walletResult = { abandoned: abandoned.ok === false, owner: sync.snapshot().walletAddress, quantity: gameState.backpackSlots[0]?.count };
    return { slowReadResult, staleReadResult, sameSlotResult, walletResult };
  });
  assert.deepEqual(result.slowReadResult, { ok: true, fetches: 1, quantity: 3, slot: "101" });
  assert.deepEqual(result.staleReadResult, { rejected: true, quantity: 3, slot: "101" });
  assert.deepEqual(result.sameSlotResult, { ok: true, reads: 2, changes: 1, quantity: 4, slot: "101" });
  assert.deepEqual(result.walletResult, { abandoned: true, owner: "wallet-B", quantity: 7 });
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
