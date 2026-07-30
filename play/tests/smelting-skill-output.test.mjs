import assert from "node:assert/strict";
import test from "node:test";

import { smeltingSkillOutputBpsForLevel as profileSkillOutputBps } from "../play-skill-effects.js";
import {
  calculateSmeltingOutputQuantity,
  calculateSmeltingOutputQuantityResult,
  calculateSmeltingOutputVolumeMm3,
  calculateSmeltingOutputVolumeResult,
  createSmeltingMergeRecipe,
  smeltingRules,
  smeltingSkillOutputBpsForLevel as rulesSkillOutputBps,
} from "../../src/data/smeltingRules.js";

test("smelting skill adds 0% output, gains 5% per level, and caps at 50%", () => {
  for (const calculate of [profileSkillOutputBps, rulesSkillOutputBps]) {
    assert.equal(calculate(0), 10_000);
    assert.equal(calculate(1), 10_500);
    assert.equal(calculate(5), 12_500);
    assert.equal(calculate(10), 15_000);
    assert.equal(calculate(99), 15_000);
  }
});

test("smelting bonus increases the base material volume in the preview calculation", () => {
  const recipe = {
    id: "test_ingot",
    rawInputs: [{ key: "test_ore", amount: 1 }],
    unitVolumeMm3: 1_000_000,
    yieldBps: 10_000,
  };
  const volumeAt = (level) => calculateSmeltingOutputVolumeMm3({
    recipe,
    inputVolumeMm3: 1_000_000,
    recipeInputVolumeMm3: 1_000_000,
    pdaOutputVolumeMm3: 1_000_000,
    skillOutputBps: rulesSkillOutputBps(level),
  });

  assert.equal(volumeAt(0), 1_000_000);
  assert.equal(volumeAt(1), 1_050_000);
  assert.equal(volumeAt(10), 1_500_000);
});

test("copper bloom yields 18.6 cm3 from 300 cm3 at level zero", () => {
  const recipe = {
    id: "copper_bloom",
    rawInputs: [
      { key: "gravel", amount: 2 },
      { key: "basalt", amount: 1 },
    ],
    yieldBps: 620,
  };
  assert.equal(calculateSmeltingOutputVolumeMm3({
    recipe,
    inputVolumeMm3: 300_000,
    recipeInputVolumeMm3: 3_000_000,
    pdaOutputVolumeMm3: 3_000_000,
    skillOutputBps: rulesSkillOutputBps(0),
  }), 18_600);
});

test("material merges preserve exact volume and quantity without a skill bonus", () => {
  const primary = smeltingRules.materials.find((material) => material.id === "copper_bloom");
  const recipe = createSmeltingMergeRecipe(primary);

  assert.equal(calculateSmeltingOutputVolumeMm3({
    recipe,
    inputVolumeMm3: 913_880,
    servings: 2,
    skillOutputBps: rulesSkillOutputBps(10),
  }), 913_880);
  assert.equal(calculateSmeltingOutputQuantity({
    recipe,
    consumedInputUnits: 10,
    servings: 2,
    skillOutputBps: rulesSkillOutputBps(10),
  }), 10);
});

test("ordinary recipe quantity includes batches and the floored skill bonus", () => {
  const recipe = { yieldCount: 4 };

  assert.equal(calculateSmeltingOutputQuantity({
    recipe,
    servings: 2,
    skillOutputBps: rulesSkillOutputBps(10),
  }), 12);
  assert.equal(calculateSmeltingOutputQuantity({
    recipe: { yieldCount: 1 },
    skillOutputBps: rulesSkillOutputBps(10),
  }), 1);
});

test("output calculations report chain-record overflow instead of hiding it", () => {
  const primary = { yieldCount: 0xffffffff };
  assert.deepEqual(calculateSmeltingOutputQuantityResult({
    recipe: primary,
    servings: 2,
    skillOutputBps: 10_000,
  }), { value: 0xffffffff, overflow: true });

  const merge = createSmeltingMergeRecipe(
    smeltingRules.materials.find((material) => material.id === "copper_bloom"),
  );
  assert.deepEqual(calculateSmeltingOutputVolumeResult({
    recipe: merge,
    inputVolumeMm3: 0x1_0000_0000,
  }), { value: 0xffffffff, overflow: true });
});
