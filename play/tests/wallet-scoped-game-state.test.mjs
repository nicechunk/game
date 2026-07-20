import assert from "node:assert/strict";
import test from "node:test";

import {
  HOTBAR_STORAGE_KEY,
  PLAYER_PROFILE_STORAGE_KEY,
  createDefaultHotbarSlots,
  createPlayGameState,
  walletScopedPlayStorageKey,
} from "../game-state.js";

const OWNER_A = "WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OWNER_B = "WalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

test("wallet-scoped hotbars restore only equipment owned by that wallet", () => {
  withLocalStorage(() => {
    const stateA = createPlayGameState({ ownerAddress: OWNER_A });
    stateA.mergeChainBackpackSlots([chainTool({ owner: OWNER_A, chainItemId: "101", chainBackpack: "BackpackA" })]);
    assert.equal(stateA.equipBackpackSlotToHotbar(stateA.backpackSlots[0].id, 1).ok, true);

    const stateB = createPlayGameState({ ownerAddress: OWNER_B });
    assert.equal(forgedSlots(stateB).length, 0);
    stateB.mergeChainBackpackSlots([chainTool({ owner: OWNER_B, chainItemId: "202", chainBackpack: "BackpackB" })]);
    assert.equal(stateB.equipBackpackSlotToHotbar(stateB.backpackSlots[0].id, 2).ok, true);

    const restoredA = createPlayGameState({ ownerAddress: OWNER_A });
    const restoredB = createPlayGameState({ ownerAddress: OWNER_B });
    assert.deepEqual(forgedSlots(restoredA).map((slot) => slot.chainItemId), ["101"]);
    assert.deepEqual(forgedSlots(restoredB).map((slot) => slot.chainItemId), ["202"]);
    assert.notEqual(
      walletScopedPlayStorageKey(HOTBAR_STORAGE_KEY, OWNER_A),
      walletScopedPlayStorageKey(HOTBAR_STORAGE_KEY, OWNER_B),
    );
  });
});

test("switching owners replaces the full local equipment and profile state", () => {
  withLocalStorage(() => {
    const stateA = createPlayGameState({ ownerAddress: OWNER_A });
    stateA.playerProfile.name = "Owner A";
    stateA.savePlayerProfile();
    stateA.mergeChainBackpackSlots([chainTool({ owner: OWNER_A, chainItemId: "303", chainBackpack: "BackpackA" })]);
    stateA.equipBackpackSlotToHotbar(stateA.backpackSlots[0].id, 1);

    const stateBSeed = createPlayGameState({ ownerAddress: OWNER_B });
    stateBSeed.playerProfile.name = "Owner B";
    stateBSeed.savePlayerProfile();

    const switched = stateA.setOwnerAddress(OWNER_B);
    assert.equal(switched.changed, true);
    assert.equal(stateA.ownerAddress, OWNER_B);
    assert.equal(stateA.playerProfile.name, "Owner B");
    assert.equal(stateA.backpackSlots.length, 0);
    assert.equal(forgedSlots(stateA).length, 0);
    assert.equal(stateA.getSelectedForgedSlot(), null);
    assert.equal(stateA.backpackStatusKnown, false);
    assert.equal(stateA.backpackAvailable, false);
    assert.ok(localStorage.getItem(walletScopedPlayStorageKey(PLAYER_PROFILE_STORAGE_KEY, OWNER_A)));
  });
});

test("authoritative backpack sync removes a forged shortcut no longer owned on chain", () => {
  withLocalStorage(() => {
    const first = createPlayGameState({ ownerAddress: OWNER_A });
    first.mergeChainBackpackSlots([chainTool({ owner: OWNER_A, chainItemId: "404", chainBackpack: "BackpackA" })]);
    first.equipBackpackSlotToHotbar(first.backpackSlots[0].id, 1);

    const restored = createPlayGameState({ ownerAddress: OWNER_A });
    assert.equal(forgedSlots(restored).length, 1, "the shortcut may be restored while the chain backpack is still loading");
    const result = restored.mergeChainBackpackSlots([]);
    assert.equal(result.changed, true);
    assert.equal(forgedSlots(restored).length, 0);
    assert.equal(restored.selectedHotbarSlot, 0);
  });
});

test("unscoped legacy equipment is migrated only when its explicit owner matches", () => {
  withLocalStorage(() => {
    const legacy = createDefaultHotbarSlots();
    legacy[1] = persistedChainTool({ owner: OWNER_A, chainItemId: "505", chainBackpack: "BackpackA" });
    localStorage.setItem(HOTBAR_STORAGE_KEY, JSON.stringify(legacy));

    const stateB = createPlayGameState({ ownerAddress: OWNER_B });
    assert.equal(forgedSlots(stateB).length, 0);

    const stateA = createPlayGameState({ ownerAddress: OWNER_A });
    assert.deepEqual(forgedSlots(stateA).map((slot) => slot.chainItemId), ["505"]);
    assert.ok(localStorage.getItem(walletScopedPlayStorageKey(HOTBAR_STORAGE_KEY, OWNER_A)));
  });
});

test("a forged item disappears from the hotbar when its chain backpack is cleared", () => {
  withLocalStorage(() => {
    const state = createPlayGameState({ ownerAddress: OWNER_A });
    state.mergeChainBackpackSlots([chainTool({ owner: OWNER_A, chainItemId: "606", chainBackpack: "BackpackA" })]);
    state.equipBackpackSlotToHotbar(state.backpackSlots[0].id, 1);

    const cleared = state.clearBackpackSlots();
    assert.equal(cleared.changed, true);
    assert.equal(forgedSlots(state).length, 0);
  });
});

function chainTool(overrides = {}) {
  return {
    id: `chain-tool-${overrides.chainItemId || "1"}`,
    kind: "forged",
    itemId: "forged_item",
    label: "Forged Tool",
    count: 1,
    source: "chain",
    chainBackpack: "BackpackA",
    chainIndex: 3,
    chainItemId: "1",
    itemPda: `ToolPda${overrides.chainItemId || "1"}`,
    itemCode: 1,
    designHash: 0x11223344,
    durabilityCurrent: 80,
    durabilityMax: 100,
    ...overrides,
  };
}

function persistedChainTool(overrides = {}) {
  const slot = chainTool(overrides);
  return {
    ...slot,
    sourceItemId: slot.id,
    durability: slot.durabilityCurrent,
    maxDurability: slot.durabilityMax,
  };
}

function forgedSlots(state) {
  return state.hotbarSlots.filter((slot) => slot?.itemId === "forged_item");
}

function withLocalStorage(run) {
  const originalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
  };
  try {
    return run();
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
}
