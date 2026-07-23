import assert from "node:assert/strict";
import test from "node:test";

import { formatMassGrams, formatVolumeCm3 } from "../inventory-controller.js";

test("backpack resource volume uses cubic centimeters instead of liquid units", () => {
  assert.equal(formatVolumeCm3(1_000_000), "1,000 cm³");
  assert.equal(formatVolumeCm3(31_250), "31.25 cm³");
  assert.equal(formatVolumeCm3(20_000), "20 cm³");
});

test("backpack mass formats the authoritative chain grams", () => {
  assert.equal(formatMassGrams(14), "14 g");
  assert.equal(formatMassGrams(625), "625 g");
  assert.equal(formatMassGrams(2_600), "2.6 kg");
});
