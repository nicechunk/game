import assert from "node:assert/strict";
import test from "node:test";
import {chromium} from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";

test("market, purchased backpack and hotbar share colored forged models without local codes", async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    await page.route(origin + "/appearance-fixture", route => route.fulfill({
      contentType: "text/html", body: "<!doctype html><html><body></body></html>",
    }));
    await page.goto(origin + "/appearance-fixture");
    const result = await page.evaluate(async () => {
      localStorage.clear();
      const {createForgeComponent, createForgeDesign, encodeNcf1Bytes, fnv1a32} = await import("/chunk.js/forge/forge-core.js");
      const {createVoxelItemIconCanvas} = await import("/chunk.js/renderer/item-preview.js");
      const {createPlayGameState} = await import("/play/game-state.js");
      const {chainSlotsFromBackpack} = await import("/play/play-chain-backpack.js");
      const {marketItemSnapshotFromChainListing} = await import("/play/play-market.js");
      const designs = [[0xe32, [32, 96, 28]], [0x25e, [96, 24, 40]]].map(([color444, dimsQ]) => encodeNcf1Bytes(createForgeDesign({
        equipment: {mass5g: 100, volumeMm3: 120000, attributes6: new Uint8Array(12).fill(30)},
        components: [createForgeComponent({color444, dimsQ,
          grip: {offsetQ: [0, 0, 0], axis: 1, sign: 1, rotation: 0}})],
      })));
      const rows = [];
      for (const [index, bytes] of designs.entries()) {
        const sourceSlot = {kind: "item", kindCode: 2, category: 2, itemCode: 8,
          itemId: String(7517507680304288235n + BigInt(index)), itemPda: "immutable-model-" + index,
          quantity: 1, modelBytes: [...bytes], metadata: fnv1a32(bytes), volumeMm3: 120000,
          durabilityCurrent: 80, durabilityMax: 100, grade: 3, itemLevel: 4, qualityBps: 8000};
        const item = marketItemSnapshotFromChainListing({listing: "listing-" + index, sourceSlot});
        const state = createPlayGameState({ownerAddress: "buyer"});
        state.mergeChainBackpackSlots(chainSlotsFromBackpack({publicKey: "buyer-backpack", slots: [sourceSlot]}));
        const equipped = state.equipBackpackSlotToHotbar(state.backpackSlots[0].id, 2);
        const icons = [item, state.backpackSlots[0], equipped.slot].map(slot => {
          const canvas = createVoxelItemIconCanvas(slot, {size: 96}); document.body.append(canvas); return canvas;
        });
        await new Promise((resolve, reject) => {
          const deadline = performance.now() + 10000;
          const tick = () => {
            if (icons.every(icon => icon.dataset.forgePreviewState === "ready")) return resolve();
            if (performance.now() > deadline) return reject(new Error("Appearance did not restore"));
            setTimeout(tick, 10);
          }; tick();
        });
        rows.push({hash: fnv1a32(bytes), pngs: icons.map(icon => icon.toDataURL()),
          hashes: icons.map(icon => icon.dataset.forgeDesignHash), equippedBytes: equipped.slot.bytes.length});
        state.clearHotbarSlot(2);
      }
      const unresolved = createVoxelItemIconCanvas({kind: "forged", itemId: "forged_item", designHash: 7});
      const basic = createVoxelItemIconCanvas({itemId: "iron_pickaxe"});
      return {rows, localLibrary: localStorage.getItem("nicechunk.forging.savedCodes.v2"),
        unresolvedState: unresolved.dataset.forgePreviewState,
        placeholderIsBasicTool: unresolved.toDataURL() === basic.toDataURL()};
    });
    assert.equal(result.localLibrary, null);
    assert.equal(result.unresolvedState, "unavailable");
    assert.equal(result.placeholderIsBasicTool, false);
    for (const row of result.rows) {
      assert.equal(new Set(row.pngs).size, 1, "chain appearance must match throughout trading and equipment");
      assert.deepEqual(row.hashes, Array(3).fill(String(row.hash)));
      assert.ok(row.equippedBytes > 0);
    }
    assert.notEqual(result.rows[0].pngs[0], result.rows[1].pngs[0], "different designs cannot share a generic tool icon");
  } finally {await browser.close();}
});
