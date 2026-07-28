import assert from "node:assert/strict";
import test from "node:test";

import { isMarketListableSlot } from "../play-market.js";

test("market inventory excludes unique Blueprint items", () => {
  assert.equal(isMarketListableSlot({ kind: "blueprint", itemId: "blueprint_tool" }), false);
  assert.equal(isMarketListableSlot({ kind: "forged", itemId: "forged_item" }), true);
  assert.equal(isMarketListableSlot({ kind: "resource", pending: true }), false);
});
