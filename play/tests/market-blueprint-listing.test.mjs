import assert from "node:assert/strict";
import test from "node:test";

import { isMarketListableSlot } from "../play-market.js";

test("market inventory excludes unique Blueprint items", () => {
  assert.equal(isMarketListableSlot({ kind: "blueprint", itemId: "blueprint_tool" }), false);
  assert.equal(isMarketListableSlot({
    kind: "forged",
    itemId: "forged_item",
    source: "chain",
    chainBackpack: "BackpackAddress",
    chainIndex: 3,
  }), true);
  assert.equal(isMarketListableSlot({ kind: "resource", pending: true }), false);
});

test("market inventory accepts only authoritative unlocked chain custody", () => {
  const chainSlot = {
    kind: "resource",
    source: "chain-backpack",
    chainBackpack: "BackpackAddress",
    chainIndex: 4,
  };
  assert.equal(isMarketListableSlot(chainSlot), true);
  assert.equal(isMarketListableSlot(chainSlot, { equipped: true }), false);
  assert.equal(isMarketListableSlot({ ...chainSlot, chainIndex: -1 }), false);
  assert.equal(isMarketListableSlot({ ...chainSlot, source: "local" }), false);
  assert.equal(isMarketListableSlot({ kind: "resource", source: "local" }), false);
  assert.equal(isMarketListableSlot({
    kind: "forged",
    custodySource: "equipment",
    equipmentSlot: 2,
    chainBackpack: "BackpackAddress",
    pending: true,
  }), false);
  assert.equal(isMarketListableSlot({
    kind: "forged",
    custodySource: "equipment",
    equipmentSlot: 2,
    chainBackpack: "BackpackAddress",
  }), true);
});
