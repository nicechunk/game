import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKPACK_DISPLAY_STACK_LIMIT,
  buildBackpackDisplayStacks,
  findBackpackDisplayStack,
} from "../backpack-display-stacks.js";
import { backpackPhysicalDetailRows } from "../inventory-controller.js";

test("matching chain resources fill one display stack up to 99 items", () => {
  const slots = Array.from({ length: BACKPACK_DISPLAY_STACK_LIMIT }, (_, index) => chainResource(index));
  const stacks = buildBackpackDisplayStacks(slots);

  assert.equal(stacks.length, 1);
  assert.equal(stacks[0].slot.count, 99);
  assert.deepEqual(stacks[0].indexes, Array.from({ length: 99 }, (_, index) => index));
});

test("the 100th matching resource starts a second display stack", () => {
  const slots = Array.from({ length: BACKPACK_DISPLAY_STACK_LIMIT + 1 }, (_, index) => chainResource(index));
  const stacks = buildBackpackDisplayStacks(slots);

  assert.deepEqual(stacks.map((stack) => stack.slot.count), [99, 1]);
  assert.equal(stacks[0].indexes.at(-1), 98);
  assert.deepEqual(stacks[1].indexes, [99]);
  assert.equal(findBackpackDisplayStack(stacks, 99), stacks[1]);
});

test("resource metadata and backpack identity prevent unsafe merging", () => {
  const slots = [
    chainResource(0),
    chainResource(1, { metadata: 7 }),
    chainResource(2, { chainBackpack: "backpack-b" }),
  ];

  assert.equal(buildBackpackDisplayStacks(slots).length, 3);
});

test("aggregated physical values are summed without mutating PDA records", () => {
  const slots = [
    chainResource(0, { count: 2, volumeMm3: 4_000, massGrams: 6 }),
    chainResource(1, { count: 1, volumeMm3: 5_000, massGrams: 9 }),
  ];
  const snapshot = structuredClone(slots);
  const [stack] = buildBackpackDisplayStacks(slots);

  assert.equal(stack.slot.count, 3);
  assert.equal(stack.slot.volumeMm3, 9_000);
  assert.equal(stack.slot.massGrams, 15);
  assert.deepEqual(backpackPhysicalDetailRows(stack.slot), [
    ["Quantity", "3"],
    ["Unit volume", "3 cm³"],
    ["Unit weight", "5 g"],
    ["Total volume", "9 cm³"],
    ["Total weight", "15 g"],
  ]);
  assert.deepEqual(slots, snapshot);
  assert.notEqual(stack.slot, slots[0]);
});

function chainResource(index, overrides = {}) {
  return {
    id: `stone-${index}`,
    kind: "resource",
    source: "chain",
    chainBackpack: "backpack-a",
    chainIndex: index,
    resourceId: 3,
    blockId: 3,
    decorationId: 0,
    decorationRuleId: 0,
    metadata: 0,
    count: 1,
    volumeMm3: 1_000,
    massGrams: 2.6,
    ...overrides,
  };
}
