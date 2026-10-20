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
    assert.equal(contract.count, 3);
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

test("reserved contracts leave the unused stack and usable hotbar", () => {
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
    assert.equal(state.getLandContractInventoryItem(), null);
    assert.equal(state.hotbarSlots[2], null);
    assert.equal(state.getSelectedLandContractSlot(), null);
    assert.equal(selections.at(-1)?.reason, "contract-balance-empty");

    const cleared = state.syncLandContractBalance({
      status: "joined",
      blankLandContracts: 0,
      reservedBlankLandContracts: 0,
      marketUser: "MarketUserReserved111111111111111111111111",
    });
    assert.equal(cleared.hotbarChanged, false);
    assert.equal(cleared.removed, false);
    assert.equal(state.getLandContractInventoryItem(), null);
    assert.equal(state.hotbarSlots.some((slot) => slot?.itemId === LAND_CONTRACT_ITEM_ID), false);
    assert.equal(state.selectedHotbarSlot, 2, "consuming a contract preserves the now-empty selected slot");
  });
});

test("registered contracts remain independent portfolio assets after blank contracts are consumed", () => {
  withLocalStorage(() => {
    const owner = "WalletRegisteredContract111111111111111111111";
    const state = createPlayGameState({ ownerAddress: owner });
    state.syncLandContractBalance({
      status: "joined",
      blankLandContracts: 2,
      reservedBlankLandContracts: 0,
      marketUser: "MarketUserRegistered111111111111111111111",
    });
    const synced = state.syncRegisteredLandContracts([
      {
        owner,
        foundationId: "41",
        minX: -32,
        minZ: 16,
        width: 32,
        depth: 16,
        surfaceY: 12,
        status: "active",
        landContractCount: 2,
        registeredChunks: "2",
        totalChunks: "2",
        sourcePda: "BuildSite41",
      },
      {
        owner,
        foundationId: "42",
        minX: 0,
        minZ: 0,
        width: 16,
        depth: 16,
        surfaceY: 10,
        status: "active",
        landContractCount: 1,
        registeredChunks: "1",
        totalChunks: "1",
        sourcePda: "BuildSite42",
      },
    ]);

    const portfolio = state.getLandContractPortfolio();
    assert.equal(synced.changed, true);
    assert.equal(portfolio.totalContractUnits, 5);
    assert.equal(portfolio.recordCount, 3);
    assert.equal(portfolio.registeredContracts.length, 2);
    assert.deepEqual(portfolio.registeredContracts[0], {
      ...portfolio.registeredContracts[0],
      foundationId: "41",
      minChunkX: -2,
      minChunkZ: 1,
      maxChunkX: -1,
      maxChunkZ: 1,
      areaBlocks: 512,
      landContractCount: 2,
      transferableIdentity: "41",
    });
    assert.equal(state.backpackSlots.length, 0);

    state.syncLandContractBalance({
      status: "joined",
      blankLandContracts: 0,
      reservedBlankLandContracts: 0,
      marketUser: "MarketUserRegistered111111111111111111111",
    });
    const consumed = state.getLandContractPortfolio();
    assert.equal(consumed.blankContract, null);
    assert.equal(consumed.totalContractUnits, 3);
    assert.equal(consumed.recordCount, 2);
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

test("each owned deed equips independently and keeps its exact identity across restoration", () => {
  withLocalStorage(() => {
    const mutations = [];
    const owner = "DeedOwner";
    const state = createPlayGameState({ ownerAddress: owner, onEquipmentChange: (change) => mutations.push(change) });
    const deeds = ["9007199254740997", "18446744073709551001"].map((foundationId, i) => ({
      owner, foundationId, minX: i * 32, minZ: -16, width: 16, depth: 16, status: "active", sourcePda: `site-${foundationId}`,
    }));
    state.syncRegisteredLandContracts(deeds);
    assert(state.equipLandDeedToHotbar(deeds[0].foundationId, 1).ok);
    assert(state.equipLandDeedToHotbar(deeds[1].foundationId, 2).ok);
    assert.equal(state.getSelectedLandDeedSlot().slot.foundationId, deeds[1].foundationId);
    assert.equal(state.equipLandDeedToHotbar(deeds[0].foundationId, 3).index, 1, "same deed is not duplicated");
    assert.equal(state.getSelectedLandDeedSlot().slot.foundationId, deeds[0].foundationId);
    assert.equal(state.getHotbarEquipmentChainReference(1), null);
    assert.deepEqual(mutations, [], "management shortcuts do not transfer physical equipment custody");
    const restored = createPlayGameState({ ownerAddress: owner });
    assert.equal(restored.hotbarSlots[1].foundationId, deeds[0].foundationId);
    assert.equal(restored.hotbarSlots[2].foundationId, deeds[1].foundationId);
    assert.equal(restored.getSelectedLandDeedSlot(), null, "cached shortcuts do not establish ownership");
    restored.syncRegisteredLandContracts(deeds);
    restored.selectHotbarSlot(2);
    assert.equal(restored.getSelectedLandDeedSlot().slot.foundationId, deeds[1].foundationId);
    restored.setOwnerAddress("AnotherWallet");
    assert.equal(restored.getSelectedLandDeedSlot(), null);
    assert(!restored.hotbarSlots.some((slot) => slot?.kind === "registered_land_contract"));
  });
});

test("a transferred deed is removed after confirmed refresh without falling back to another parcel", () => {
  withLocalStorage(() => {
    const owner = "DeedOwner";
    const state = createPlayGameState({ ownerAddress: owner });
    const deeds = [1, 2].map((id) => ({ owner, foundationId: String(id), minX: id * 16, minZ: 0, width: 16, depth: 16, status: "active" }));
    state.syncRegisteredLandContracts(deeds);
    state.equipLandDeedToHotbar("1", 0);
    state.equipLandDeedToHotbar("2", 2);
    state.syncRegisteredLandContracts(deeds, { status: "error", error: "RPC unavailable" });
    assert(state.getLandDeedEquipment("2"), "temporary RPC failure does not erase deeds");
    state.syncRegisteredLandContracts([deeds[0], { ...deeds[1], owner: "NewOwner" }]);
    assert.equal(state.getLandDeedEquipment("2"), null);
    assert.equal(state.getSelectedLandDeedSlot(), null);
    assert.notEqual(state.selectedHotbarSlot, 0, "losing a deed must not select another deed, even in the first slot");
    assert.equal(state.equipLandDeedToHotbar("2").ok, false);
    state.syncRegisteredLandContracts([{ ...deeds[0], status: "indexing" }]);
    assert.equal(state.equipLandDeedToHotbar("1").ok, false, "incomplete registration is not editable");
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
