import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultHotbarSlots,
  createPlayGameState,
  normalizeHotbarSlots,
} from "../game-state.js";

test("equipping the same chain tool twice selects its existing hotbar slot", () => {
  withLocalStorage(() => {
    const state = createPlayGameState();
    state.mergeChainBackpackSlots([chainTool({ chainItemId: "501", chainIndex: 3, itemPda: "ToolPda501" })]);

    const first = state.equipBackpackSlotToHotbar(state.backpackSlots[0].id, 1);
    const second = state.equipBackpackSlotToHotbar(state.backpackSlots[0].id, 2);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.alreadyEquipped, true);
    assert.equal(second.index, 1);
    assert.equal(state.selectedHotbarSlot, 1);
    assert.equal(state.hotbarSlots[2], null);
    assert.equal(equippedChainTools(state.hotbarSlots).length, 1);
  });
});

test("distinct chain tools with the same model remain independently equippable", () => {
  withLocalStorage(() => {
    const state = createPlayGameState();
    state.mergeChainBackpackSlots([
      chainTool({ id: "tool-a", chainItemId: "601", chainIndex: 4, itemPda: "ToolPda601" }),
      chainTool({ id: "tool-b", chainItemId: "602", chainIndex: 5, itemPda: "ToolPda602" }),
    ]);

    const first = state.equipBackpackSlotToHotbar(state.backpackSlots[0].id, 1);
    const second = state.equipBackpackSlotToHotbar(state.backpackSlots[1].id, 2);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.alreadyEquipped, undefined);
    assert.equal(equippedChainTools(state.hotbarSlots).length, 2);
    assert.notEqual(state.hotbarSlots[1].itemPda, state.hotbarSlots[2].itemPda);
  });
});

test("distinct chain tools sharing one item PDA remain independently equippable", () => {
  withLocalStorage(() => {
    const sharedItemPda = "SharedForgeItemPda111111111111111111111111";
    const state = createPlayGameState();
    state.mergeChainBackpackSlots([
      chainTool({ id: "tool-a", chainItemId: "611", chainIndex: 4, itemPda: sharedItemPda, designHash: 0x11111111 }),
      chainTool({ id: "tool-b", chainItemId: "612", chainIndex: 5, itemPda: sharedItemPda, designHash: 0x22222222 }),
    ]);

    const first = state.equipBackpackSlotToHotbar(state.backpackSlots[0].id, 1);
    const second = state.equipBackpackSlotToHotbar(state.backpackSlots[1].id, 2);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.alreadyEquipped, undefined);
    assert.equal(state.selectedHotbarSlot, 2);
    assert.equal(equippedChainTools(state.hotbarSlots).length, 2);
    assert.equal(state.hotbarSlots[1].itemPda, sharedItemPda);
    assert.equal(state.hotbarSlots[2].itemPda, sharedItemPda);
    assert.notEqual(state.hotbarSlots[1].chainItemId, state.hotbarSlots[2].chainItemId);
    assert.equal(state.getBackpackSlotEquipment(state.backpackSlots[0])?.index, 1);
    assert.equal(state.getBackpackSlotEquipment(state.backpackSlots[1])?.index, 2);
    assert.equal(state.isBackpackSlotEquipped(state.backpackSlots[0]), true);
    assert.equal(state.isBackpackSlotEquipped(state.backpackSlots[1]), true);
  });
});

test("unequipping a forged tool clears only its hotbar shortcut", () => {
  withLocalStorage(() => {
    const state = createPlayGameState();
    state.mergeChainBackpackSlots([chainTool({ chainItemId: "621", chainIndex: 6 })]);
    const backpackSlotId = state.backpackSlots[0].id;
    const equipped = state.equipBackpackSlotToHotbar(backpackSlotId, 1);

    assert.equal(state.isBackpackSlotEquipped(backpackSlotId), true);
    assert.equal(state.getBackpackSlotEquipment(backpackSlotId)?.index, equipped.index);

    const result = state.unequipHotbarSlot(equipped.index);

    assert.equal(result.ok, true);
    assert.equal(state.hotbarSlots[equipped.index], null);
    assert.equal(state.backpackSlots.length, 1);
    assert.equal(state.backpackSlots[0].id, backpackSlotId);
    assert.equal(state.backpackSlots[0].chainItemId, "621");
    assert.equal(state.isBackpackSlotEquipped(backpackSlotId), false);
    assert.equal(state.getBackpackSlotEquipment(backpackSlotId), null);
  });
});

test("resource and blueprint shortcuts lock only their source backpack slots until unequipped", () => {
  withLocalStorage(() => {
    const state = createPlayGameState({ ownerAddress: "Owner111" });
    state.mergeChainBackpackSlots([
      chainResource({ id: "resource-a", chainIndex: 7 }),
      chainResource({ id: "resource-b", chainIndex: 8 }),
      chainBlueprint({ id: "blueprint-a", chainIndex: 9, blueprintId: "901" }),
    ]);

    const resource = state.equipBackpackSlotToHotbar("resource-a", 1);
    const blueprint = state.equipBackpackSlotToHotbar("blueprint-a", 2);

    assert.equal(resource.ok, true);
    assert.equal(blueprint.ok, true);
    assert.equal(state.isBackpackSlotEquipped("resource-a"), true);
    assert.equal(state.isBackpackSlotEquipped("resource-b"), false);
    assert.equal(state.isBackpackSlotEquipped("blueprint-a"), true);
    assert.equal(state.canUnequipHotbarSlot(resource.index), true);
    assert.equal(state.canUnequipHotbarSlot(blueprint.index), true);

    assert.equal(state.unequipHotbarSlot(resource.index).ok, true);
    assert.equal(state.isBackpackSlotEquipped("resource-a"), false);
    assert.equal(state.isBackpackSlotEquipped("blueprint-a"), true);
    assert.equal(state.unequipHotbarSlot(blueprint.index).ok, true);
    assert.equal(state.isBackpackSlotEquipped("blueprint-a"), false);
  });
});

test("hotbar normalization removes persisted copies of one chain tool", () => {
  const slots = createDefaultHotbarSlots();
  const duplicate = {
    itemId: "forged_item",
    kind: "forged",
    source: "chain",
    chainBackpack: "Backpack1111111111111111111111111111111",
    chainIndex: 3,
    chainItemId: "701",
    itemPda: "ToolPda701",
    sourceItemId: "chain-tool-701",
    designHash: 0x11223344,
    durability: 80,
    maxDurability: 100,
  };
  slots[1] = duplicate;
  slots[2] = { ...duplicate };

  const normalized = normalizeHotbarSlots(slots);

  assert.equal(equippedChainTools(normalized).length, 1);
  assert.equal(normalized[1]?.itemPda, "ToolPda701");
  assert.equal(normalized[2], null);
});

function chainTool(overrides = {}) {
  return {
    id: "chain-tool-501",
    kind: "forged",
    itemId: "forged_item",
    label: "Forged Tool",
    count: 1,
    source: "chain",
    chainBackpack: "Backpack1111111111111111111111111111111",
    chainIndex: 3,
    chainItemId: "501",
    itemPda: "ToolPda501",
    itemCode: 1,
    designHash: 0x11223344,
    durabilityCurrent: 80,
    durabilityMax: 100,
    ...overrides,
  };
}

function chainResource(overrides = {}) {
  return {
    id: "resource-a",
    kind: "resource",
    resourceId: 1,
    blockId: 1,
    count: 3,
    source: "chain",
    chainBackpack: "Backpack1111111111111111111111111111111",
    chainIndex: 7,
    ...overrides,
  };
}

function chainBlueprint(overrides = {}) {
  return {
    id: "blueprint-a",
    kind: "blueprint",
    itemId: "blueprint_tool",
    blueprintId: "901",
    count: 1,
    source: "chain",
    chainBackpack: "Backpack1111111111111111111111111111111",
    chainIndex: 9,
    chainItemId: "901",
    itemPda: "BlueprintPda901",
    blueprintOwner: "Owner111",
    ...overrides,
  };
}

function equippedChainTools(slots) {
  return slots.filter((slot) => slot?.itemId === "forged_item" && slot.source === "chain");
}

function withLocalStorage(run) {
  const originalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  try {
    return run();
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
}
