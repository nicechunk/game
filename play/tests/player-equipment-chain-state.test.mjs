import assert from "node:assert/strict";
import test from "node:test";

import { createPlayGameState } from "../game-state.js";
import { equipmentMigrationChanges } from "../play-chain-player.js";
import { resolveGuardianEquipmentFromChain } from "../play-guardian-equipment.js";

const OWNER = "WalletEquipmentOwner111111111111111111111111";
const BACKPACK = "BackpackEquipment111111111111111111111111";

test("chain-backed equip and unequip operations emit exact PDA references", () => {
  withLocalStorage(() => {
    const mutations = [];
    const state = createPlayGameState({
      ownerAddress: OWNER,
      onEquipmentChange: (mutation) => mutations.push(mutation),
    });
    state.mergeChainBackpackSlots([chainTool({ chainItemId: "7001", chainIndex: 4 })]);

    const equipped = state.equipBackpackSlotToHotbar(state.backpackSlots[0].id, 2);
    assert.equal(equipped.ok, true);
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].changes[0].reference.sourceType, "backpack");
    assert.equal(mutations[0].changes[0].reference.slot, 2);
    assert.equal(mutations[0].changes[0].reference.backpackAddress, BACKPACK);
    assert.equal(mutations[0].changes[0].reference.backpackIndex, 4);
    assert.equal(mutations[0].changes[0].reference.chainItemId, "7001");
    assert.equal(mutations[0].changes[0].reference.itemCode, 8);
    assert.equal(mutations[0].changes[0].reference.itemPda, "SharedForgePda");

    assert.equal(state.unequipHotbarSlot(2).ok, true);
    assert.equal(mutations.length, 2);
    assert.equal(mutations[1].changes[0].reference, null);
    assert.equal(mutations[1].changes[0].beforeReference.chainItemId, "7001");
  });
});

test("custodied equipment restores from its embedded record without reading Backpack slots", () => {
  withLocalStorage(() => {
    const modelBytes = validNcf1Bytes();
    const designHash = fnv1a32(modelBytes);
    const state = createPlayGameState({ ownerAddress: OWNER });
    const equipment = equipmentSnapshot({
      slot: 6,
      chainItemId: "8002",
      backpackIndex: 5,
      designHash,
      modelBytes,
      custodied: true,
    });

    const restored = state.restoreChainEquipmentSlots(equipment);

    assert.equal(restored.changed, true);
    assert.equal(restored.resolved, 1);
    assert.equal(restored.unresolved, 0);
    assert.equal(state.hotbarSlots[6].chainItemId, "8002");
    assert.equal(state.hotbarSlots[6].custodySource, "equipment");
    assert.equal(state.hotbarSlots[6].equipmentSlot, 6);
    assert.deepEqual(state.hotbarSlots[6].bytes, modelBytes);
    assert.equal(state.backpackSlots.length, 0);

    state.mergeChainBackpackSlots([]);
    assert.equal(state.hotbarSlots[6].chainItemId, "8002", "Backpack refresh must not remove custodied equipment");
    assert.equal(state.isBackpackSlotEquipped("8002"), false, "Custodied equipment must not reserve a Backpack slot");

    const cleared = state.restoreChainEquipmentSlots(equipmentSnapshot());
    assert.equal(cleared.changed, true);
    assert.equal(state.hotbarSlots[6], null);
  });
});

test("legacy wallet-scoped equipment is collected once for PlayerEquipment migration", () => {
  const references = new Map([
    [2, { slot: 2, sourceType: "backpack", backpackAddress: BACKPACK, backpackIndex: 4, modelBytes: [] }],
    [6, { slot: 6, sourceType: "backpack", backpackAddress: BACKPACK, backpackIndex: 5, modelBytes: [0xe0, 1] }],
  ]);
  const hotbarSlots = Array.from({ length: 9 }, (_, index) => references.has(index) ? { itemId: `item-${index}` } : null);
  const changes = equipmentMigrationChanges({
    hotbarSlots,
    getHotbarEquipmentChainReference: (index) => references.get(index) ?? null,
  });

  assert.deepEqual(changes.map((change) => change.index), [2, 6]);
  assert.equal(changes[0].before, hotbarSlots[2]);
  assert.equal(changes[1].reference.backpackIndex, 5);
  assert.equal(changes.every((change) => change.migration), true);
});

test("initialized legacy records migrate while custodied records are skipped", () => {
  const references = new Map([
    [2, { slot: 2, sourceType: "backpack", backpackAddress: BACKPACK, backpackIndex: 4, modelBytes: [] }],
    [6, { slot: 6, sourceType: "equipment", equipmentSlot: 6, backpackAddress: BACKPACK, backpackIndex: 5, modelBytes: [] }],
  ]);
  const equipment = equipmentSnapshot({ slot: 2, chainItemId: "9001", backpackIndex: 4, custodied: false });
  equipment.slots[6] = {
    ...equipment.slots[2],
    slot: 6,
    backpackIndex: 5,
    custodied: true,
  };
  const changes = equipmentMigrationChanges({
    hotbarSlots: Array.from({ length: 9 }, (_, index) => references.has(index) ? { itemId: `item-${index}` } : null),
    getHotbarEquipmentChainReference: (index) => references.get(index) ?? null,
  }, equipment);

  assert.deepEqual(changes.map((change) => change.index), [2]);
});

test("hotbar swaps retain the original Equipment PDA slot identity", () => {
  withLocalStorage(() => {
    const mutations = [];
    const state = createPlayGameState({
      ownerAddress: OWNER,
      onEquipmentChange: (mutation) => mutations.push(mutation),
    });
    const left = equipmentSnapshot({ slot: 2, chainItemId: "9101", backpackIndex: 4, designHash: 1, custodied: true });
    const right = equipmentSnapshot({ slot: 6, chainItemId: "9102", backpackIndex: 5, designHash: 2, custodied: true });
    left.slots[6] = right.slots[6];
    state.restoreChainEquipmentSlots(left);

    assert.equal(state.swapHotbarSlots(2, 6).ok, true);
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].changes[0].reference.sourceType, "equipment");
    assert.equal(mutations[0].changes[0].reference.equipmentSlot, 6);
    assert.equal(mutations[0].changes[1].reference.equipmentSlot, 2);
  });
});

test("remote forged and block equipment is verified against the public equipment PDA", () => {
  const modelBytes = validNcf1Bytes();
  const designHash = fnv1a32(modelBytes);
  const snapshot = {
    initialized: true,
    slots: [
      {
        equipped: true,
        custodied: true,
        backpackSlot: { kind: "item", category: 2, itemCode: 8, metadata: designHash },
        modelBytes,
      },
      {
        equipped: true,
        custodied: true,
        backpackSlot: { kind: "block", resource: { blockId: 3 } },
        modelBytes: [],
      },
    ],
  };

  const forged = resolveGuardianEquipmentFromChain({
    rightHand: "pickaxe",
    forged: true,
    designHash,
    payloadBytes: null,
  }, snapshot);
  assert.equal(forged.forged, true);
  assert.deepEqual(Array.from(forged.payloadBytes), modelBytes);
  assert.deepEqual(
    resolveGuardianEquipmentFromChain({ rightHand: "pickaxe", forged: true, designHash: designHash ^ 1 }, snapshot),
    { rightHand: "empty" },
  );
  assert.equal(resolveGuardianEquipmentFromChain({ rightHand: "block", blockId: 3 }, snapshot).blockId, 3);
  assert.deepEqual(
    resolveGuardianEquipmentFromChain({ rightHand: "block", blockId: 4 }, snapshot),
    { rightHand: "empty" },
  );
  assert.equal(resolveGuardianEquipmentFromChain({ rightHand: "pickaxe" }, snapshot).rightHand, "pickaxe");

  const legacySnapshot = {
    initialized: true,
    slots: snapshot.slots.map((slot) => ({ ...slot, custodied: false })),
  };
  assert.deepEqual(
    resolveGuardianEquipmentFromChain({ rightHand: "block", blockId: 3 }, legacySnapshot),
    { rightHand: "empty" },
  );
});

function equipmentSnapshot(overrides = {}) {
  const records = Array.from({ length: 9 }, (_, slot) => ({
    state: 0,
    slot,
    equipped: false,
    backpackIndex: 255,
    backpack: "11111111111111111111111111111111",
    backpackSlot: null,
    modelBytes: [],
  }));
  if (Number.isInteger(overrides.slot)) {
    records[overrides.slot] = {
      state: 1,
      slot: overrides.slot,
      equipped: true,
      custodied: overrides.custodied === true,
      backpackIndex: overrides.backpackIndex,
      backpack: BACKPACK,
      backpackSlot: {
        kind: "item",
        itemId: overrides.chainItemId,
        itemCode: 8,
        itemPda: "SharedForgePda",
        metadata: overrides.designHash,
        quantity: 1,
        volumeMm3: 80_000,
        durabilityCurrent: 80,
        durabilityMax: 100,
        grade: 2,
        itemLevel: 3,
        qualityBps: 8000,
      },
      modelBytes: overrides.modelBytes,
    };
  }
  return { initialized: true, slots: records };
}

function chainTool(overrides = {}) {
  const chainItemId = overrides.chainItemId || "1";
  return {
    id: overrides.id || `tool-${chainItemId}`,
    kind: "forged",
    itemId: "forged_item",
    label: "Forged Tool",
    count: 1,
    source: "chain",
    chainBackpack: BACKPACK,
    chainIndex: 4,
    chainItemId,
    itemPda: "SharedForgePda",
    itemCode: 8,
    designHash: 0x11223344,
    durabilityCurrent: 80,
    durabilityMax: 100,
    grade: 2,
    itemLevel: 3,
    qualityBps: 8000,
    ...overrides,
  };
}

function validNcf1Bytes() {
  return [0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
}

function fnv1a32(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function withLocalStorage(run) {
  const previous = globalThis.localStorage;
  const data = new Map();
  globalThis.localStorage = {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
  try {
    run();
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
}
