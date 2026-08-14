import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKPACK_HOTBAR_INDEX,
  createPlayGameState,
  createDefaultHotbarSlots,
  normalizeHotbarSlots,
} from "../game-state.js";

function retiredBlueprint(overrides = {}) {
  return {
    itemId: "blueprint_tool",
    kind: "blueprint",
    blueprintId: "42",
    blueprintInstanceId: "issued-blueprint:42",
    blueprintOrdinal: 1,
    blueprintOwner: "wallet-a",
    source: "chain",
    locked: true,
    ...overrides,
  };
}

test("the default hotbar does not grant blueprints", () => {
  const slots = createDefaultHotbarSlots();

  assert.equal(slots.length, 9);
  assert.equal(slots.filter((slot) => slot?.itemId === "blueprint_tool").length, 0);
  assert.equal(slots[0]?.itemId, "iron_pickaxe");
  assert.deepEqual(slots[BACKPACK_HOTBAR_INDEX], { itemId: "backpack", locked: true });
});

test("normalization removes all legacy automatically granted blueprints", () => {
  const legacy = createDefaultHotbarSlots();
  legacy[1] = retiredBlueprint({ source: "test", blueprintInstanceId: "blueprint:42" });
  legacy[2] = retiredBlueprint({ blueprintId: "43", source: "", blueprintInstanceId: "test-blueprint:43" });
  legacy[3] = { itemId: "blueprint_tool", kind: "blueprint", locked: true };

  const normalized = normalizeHotbarSlots(JSON.parse(JSON.stringify(legacy)));

  assert.equal(normalized.filter((slot) => slot?.itemId === "blueprint_tool").length, 0);
});

test("previously issued blueprint shortcuts are retired during normalization", () => {
  const slots = createDefaultHotbarSlots();
  slots[2] = retiredBlueprint();

  const normalized = normalizeHotbarSlots(JSON.parse(JSON.stringify(slots)));

  assert.equal(normalized[2], null);
});

test("every duplicate legacy blueprint identity is discarded", () => {
  const slots = createDefaultHotbarSlots();
  slots[1] = retiredBlueprint();
  slots[2] = retiredBlueprint({ blueprintInstanceId: "duplicate:42" });

  const normalized = normalizeHotbarSlots(slots);

  assert.equal(normalized.filter((slot) => slot?.itemId === "blueprint_tool").length, 0);
  assert.equal(normalized[1], null);
  assert.equal(normalized[2], null);
});

test("a full hotbar is not changed to inject blueprints", () => {
  const slots = createDefaultHotbarSlots().map((slot, index) => slot ?? {
    itemId: "resource_block",
    backpackSlotId: `slot-${index}`,
    resourceId: 1,
    blockId: 1,
    count: 1,
  });

  const normalized = normalizeHotbarSlots(slots);

  assert.equal(normalized.filter((slot) => slot?.itemId === "blueprint_tool").length, 0);
  assert.equal(normalized.filter((slot) => slot?.itemId === "resource_block").length, 7);
  assert.equal(normalized[0]?.itemId, "iron_pickaxe");
  assert.equal(normalized[BACKPACK_HOTBAR_INDEX]?.itemId, "backpack");
});

test("retired chain Blueprint records never enter the backpack or hotbar", () => {
  const state = createPlayGameState({ ownerAddress: "wallet-a" });
  state.setBackpackAvailability(true, { known: true });
  const result = state.mergeChainBackpackSlots([{
    id: "chain-backpack-50-blueprint-9001",
    kind: "blueprint",
    itemId: "blueprint_tool",
    label: "Blueprint #9001",
    count: 1,
    source: "chain",
    chainBackpack: "backpack-pda",
    chainIndex: 50,
    chainItemId: "9001",
    itemCode: 9,
    itemPda: "blueprint-pda",
    blueprintId: "9001",
    blueprintInstanceId: "blueprint-pda:blueprint-pda",
    blueprintOrdinal: 51,
    blueprintOwner: "wallet-a",
  }], { source: "chain", capacity: 51 });

  assert.equal(result.changed, true);
  assert.equal(state.backpackCapacity, 51);
  assert.equal(state.backpackSlots.length, 0);

  const equipped = state.equipBackpackSlotToHotbar("chain-backpack-50-blueprint-9001");
  assert.equal(equipped.ok, false);
  assert.equal(state.hotbarSlots.some((slot) => slot?.itemId === "blueprint_tool"), false);
});
