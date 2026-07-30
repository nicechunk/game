import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKPACK_STACK_LIMIT,
  backpackCapacityState,
  canBackpackAcceptSlot,
  diffBackpackBlockQuantities,
  snapshotBackpackBlockQuantities,
} from "../../src/chain/backpackCapacity.js";

test("32 PDA records grouped into 12 resources occupy 12 of 50 slots", () => {
  const slots = Array.from({ length: 32 }, (_, index) => blockSlot(index % 12 + 1, {
    quantity: index < 7 ? 2 : 1,
  }));

  const state = backpackCapacityState({ capacity: 50, slots });

  assert.equal(state.usedSlots, 12);
  assert.equal(state.freeSlots, 38);
  assert.equal(state.totalItems, 39);
});

test("the 100th matching resource opens a second capacity slot", () => {
  const state = backpackCapacityState({
    capacity: 50,
    slots: [blockSlot(3, { quantity: BACKPACK_STACK_LIMIT }), blockSlot(3)],
  });

  assert.equal(state.usedSlots, 2);
  assert.deepEqual(state.stacks.map((stack) => stack.quantity), [99, 1]);
});

test("50 full stacks expose 4950 resource capacity and reject item 4951", () => {
  const slots = Array.from({ length: 50 }, (_, index) => blockSlot(index + 1, { quantity: 99 }));
  const backpack = { capacity: 50, slots };

  assert.equal(backpackCapacityState(backpack).totalItems, 4_950);
  assert.equal(backpackCapacityState(backpack).availableResourceUnits, 0);
  assert.equal(canBackpackAcceptSlot(backpack, blockSlot(1)), false);
});

test("a full raw record array still accepts a new type after stack compaction", () => {
  const backpack = {
    capacity: 50,
    slots: Array.from({ length: 50 }, () => blockSlot(3)),
  };

  const state = backpackCapacityState(backpack);
  assert.equal(state.usedSlots, 1);
  assert.equal(state.freeSlots, 49);
  assert.equal(canBackpackAcceptSlot(backpack, blockSlot(4)), true);
});

test("a matching stack can receive the last unit when all visual slots are occupied", () => {
  const backpack = {
    capacity: 50,
    slots: Array.from({ length: 50 }, (_, index) => blockSlot(index + 1, {
      quantity: index === 0 ? 98 : 99,
    })),
  };

  assert.equal(canBackpackAcceptSlot(backpack, blockSlot(1)), true);
  assert.equal(canBackpackAcceptSlot(backpack, blockSlot(51)), false);
});

test("an incoming resource stack can use headroom across multiple occupied slots", () => {
  const backpack = {
    capacity: 50,
    slots: Array.from({ length: 50 }, () => blockSlot(3, { quantity: 98 })),
  };

  const state = backpackCapacityState(backpack);
  assert.equal(state.usedSlots, 50);
  assert.equal(state.stackHeadroom, 50);
  assert.equal(canBackpackAcceptSlot(backpack, blockSlot(3, { quantity: 2 })), true);
});

test("the block stack limit does not reject a material quantity in a free slot", () => {
  const backpack = { capacity: 50, slots: [] };
  const material = { kind: "item", category: 1, quantity: 125 };

  assert.equal(canBackpackAcceptSlot(backpack, material), true);
});

test("mining reward deltas detect quantity growth inside an existing slot", () => {
  const beforeBackpack = { capacity: 50, slots: [blockSlot(3, { quantity: 12 })] };
  const before = snapshotBackpackBlockQuantities(beforeBackpack);
  const after = {
    capacity: 50,
    slots: [blockSlot(3, { quantity: 15 }), blockSlot(4, { quantity: 2 })],
  };

  assert.deepEqual(
    diffBackpackBlockQuantities(after, before).map(({ blockId, quantity }) => ({ blockId, quantity })),
    [{ blockId: 3, quantity: 3 }, { blockId: 4, quantity: 2 }],
  );
});

function blockSlot(blockId, overrides = {}) {
  return {
    kind: "block",
    quantity: 1,
    metadata: 0,
    resource: {
      blockId,
      worldX: blockId,
      worldY: 10,
      worldZ: -blockId,
    },
    ...overrides,
  };
}
