import assert from "node:assert/strict";
import test from "node:test";

import { createPlayGameState } from "../game-state.js";

test("chain backpack state preserves per-slot mass and authoritative total mass", () => {
  const state = createPlayGameState({ ownerAddress: "wallet-a" });
  const first = state.mergeChainBackpackSlots([{
    id: "stone-1",
    kind: "resource",
    source: "chain",
    resourceId: 3,
    blockId: 3,
    count: 4,
    chainIndex: 0,
    volumeMm3: 1_000_000,
    massGrams: 2_600,
  }], {
    capacity: 50,
    totalMassGrams: "2600",
  });

  assert.equal(first.changed, true);
  assert.equal(state.backpackSlots[0].count, 4);
  assert.equal(state.backpackSlots[0].volumeMm3, 1_000_000);
  assert.equal(state.backpackSlots[0].massGrams, 2_600);
  assert.equal(state.totalBackpackMassGrams(), "2600");

  const massOnlyChange = state.mergeChainBackpackSlots(state.backpackSlots, {
    capacity: 50,
    totalMassGrams: "2700",
  });
  assert.equal(massOnlyChange.changed, true);
  assert.equal(state.totalBackpackMassGrams(), "2700");
});
