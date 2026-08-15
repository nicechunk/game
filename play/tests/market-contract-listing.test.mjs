import assert from "node:assert/strict";
import test from "node:test";

import {
  LAND_CONTRACT_UNIT_PRICE_NCK,
  isMarketListableSlot,
  normalizeLandContractPurchaseQuantity,
} from "../play-market.js";

test("market inventory excludes retired Blueprint items", () => {
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

test("blank land contract purchases accept only whole quantities from 1 through 4,096", () => {
  assert.equal(LAND_CONTRACT_UNIT_PRICE_NCK, 10);
  assert.equal(normalizeLandContractPurchaseQuantity(1), 1);
  assert.equal(normalizeLandContractPurchaseQuantity("4096"), 4096);
  for (const value of [0, -1, 4097, "1.5", "1e2", "", null]) {
    assert.equal(normalizeLandContractPurchaseQuantity(value), null, String(value));
  }
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
