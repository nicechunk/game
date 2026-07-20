import assert from "node:assert/strict";
import test from "node:test";

import {
  createForgeComponent,
  createForgeDesign,
  encodeNcf1,
  forgeChainDesignHash,
} from "../../chunk.js/index.js";
import { hydrateForgedPresentationSlot } from "../forged-hotbar-compat.js";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.get(String(key)) ?? null; },
  setItem(key, value) { storage.set(String(key), String(value)); },
  removeItem(key) { storage.delete(String(key)); },
};

test("a chain-forged cloth item restores its exact NCF1 presentation by design hash", () => {
  const code = encodeNcf1(createForgeDesign({
    equipment: { mass5g: 8, volumeCm3: 42, attributes6: new Uint8Array(12).fill(24) },
    components: [createForgeComponent({
      resourceId: "cloth",
      dimsQ: [120, 18, 72],
      grip: { offsetQ: [-48, 0, 0], axis: 0, sign: 1, rotation: 0 },
    })],
  }));
  const designHash = forgeChainDesignHash(code);
  storage.set("nicechunk.forging.savedCodes.v2", JSON.stringify([code]));

  const slot = hydrateForgedPresentationSlot({
    kind: "forged",
    itemId: "forged_item",
    source: "chain",
    chainIndex: 4,
    label: "Forged Item #91",
    designHash,
  });

  assert.equal(slot.code, code);
  assert.ok(slot.bytes.length > 0);
  assert.equal(slot.designHash, designHash);
  assert.equal(slot.label, "Forged Item #91");
  assert.equal(slot.chainIndex, 4);
});

test("a mismatched local code is never used as chain item presentation", () => {
  const slot = hydrateForgedPresentationSlot({
    kind: "forged",
    itemId: "forged_item",
    source: "chain",
    chainIndex: 5,
    designHash: 0x12345678,
  });
  assert.equal(slot.code, undefined);
  assert.equal(slot.bytes, undefined);
});
