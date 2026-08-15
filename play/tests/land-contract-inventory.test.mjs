import assert from "node:assert/strict";
import test from "node:test";

import { createPlayGameState } from "../game-state.js";
import {
  LAND_CONTRACT_ITEM_ID,
  LAND_CONTRACT_INVENTORY_ID,
} from "../play-land-contract-item.js";

test("MarketUser land contracts project into inventory without consuming backpack state", () => {
  withLocalStorage(() => {
    const equipmentMutations = [];
    const selections = [];
    const state = createPlayGameState({
      ownerAddress: "WalletLandContract1111111111111111111111111",
      onEquipmentChange: (mutation) => equipmentMutations.push(mutation),
      onHotbarSelectionChange: (selection) => selections.push(selection),
    });

    assert.equal(state.getLandContractInventoryItem(), null);
    const synced = state.syncLandContractBalance({
      status: "joined",
      blankLandContracts: 3,
      reservedBlankLandContracts: 2,
      marketUser: "MarketUser111111111111111111111111111111",
    });
    const contract = state.getLandContractInventoryItem();

    assert.equal(synced.changed, true);
    assert.equal(contract.id, LAND_CONTRACT_INVENTORY_ID);
    assert.equal(contract.itemId, LAND_CONTRACT_ITEM_ID);
    assert.equal(contract.count, 5);
    assert.equal(contract.availableCount, 3);
    assert.equal(contract.reservedCount, 2);
    assert.equal(contract.backpackSlotsUsed, 0);
    assert.equal(state.backpackSlots.length, 0);
    assert.equal(state.totalBackpackItems(), 0);
    assert.equal(state.totalBackpackMassGrams(), "0");

    const equipped = state.equipLandContractToHotbar(1);
    assert.equal(equipped.ok, true);
    assert.equal(equipped.index, 1);
    assert.equal(state.hotbarSlots[1].itemId, LAND_CONTRACT_ITEM_ID);
    assert.equal(state.getSelectedLandContractSlot()?.index, 1);
    assert.equal(state.getHotbarEquipmentChainReference(1), null);
    assert.equal(equipmentMutations.length, 0, "local contract shortcuts must not mutate the Equipment PDA");
    assert.equal(selections.at(-1)?.reason, "contract-equipped");
  });
});

test("reserved contracts stay equipped until the authoritative total reaches zero", () => {
  withLocalStorage(() => {
    const selections = [];
    const state = createPlayGameState({
      ownerAddress: "WalletReservedContract11111111111111111111111",
      onHotbarSelectionChange: (selection) => selections.push(selection),
    });
    state.syncLandContractBalance({
      status: "joined",
      blankLandContracts: 1,
      reservedBlankLandContracts: 0,
      marketUser: "MarketUserReserved111111111111111111111111",
    });
    state.equipLandContractToHotbar(2);

    state.syncLandContractBalance({
      status: "joined",
      blankLandContracts: 0,
      reservedBlankLandContracts: 1,
      marketUser: "MarketUserReserved111111111111111111111111",
    });
    assert.equal(state.getLandContractInventoryItem()?.count, 1);
    assert.equal(state.hotbarSlots[2]?.itemId, LAND_CONTRACT_ITEM_ID);
    assert.equal(state.getSelectedLandContractSlot()?.index, 2);

    const cleared = state.syncLandContractBalance({
      status: "joined",
      blankLandContracts: 0,
      reservedBlankLandContracts: 0,
      marketUser: "MarketUserReserved111111111111111111111111",
    });
    assert.equal(cleared.hotbarChanged, true);
    assert.equal(cleared.removed, true);
    assert.equal(state.getLandContractInventoryItem(), null);
    assert.equal(state.hotbarSlots.some((slot) => slot?.itemId === LAND_CONTRACT_ITEM_ID), false);
    assert.equal(state.selectedHotbarSlot, 0);
    assert.equal(selections.at(-1)?.reason, "contract-balance-empty");
  });
});

test("a land contract needs a genuinely empty local hotbar slot", () => {
  withLocalStorage(() => {
    const state = createPlayGameState();
    state.syncLandContractBalance({ status: "joined", blankLandContracts: 1, reservedBlankLandContracts: 0 });
    for (let index = 1; index < state.hotbarSlots.length - 1; index += 1) {
      state.hotbarSlots[index] = {
        itemId: "resource_block",
        kind: "resource",
        backpackSlotId: `resource-${index}`,
        resourceId: index,
        blockId: index,
        count: 1,
      };
    }

    const result = state.equipLandContractToHotbar(1);
    assert.equal(result.ok, false);
    assert.match(result.reason, /No available hotbar slot/);
    assert.equal(state.hotbarSlots[1].itemId, "resource_block");
  });
});

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
