import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { blockAtlasByKey } from "../../src/data/blockAtlas.js";
import { resourceDropRules, resourceDropSizeProfiles } from "../../src/data/resourceDropRules.js";

const physicsDocument = JSON.parse(fs.readFileSync(new URL("../../config/material_physics_v2.json", import.meta.url), "utf8"));
const expectedVolumeRanges = {
  lava: [80_000, 500_000],
  ice: [100_000, 1_000_000],
  toxicWater: [100_000, 750_000],
  coral: [50_000, 500_000],
  deadCoral: [50_000, 500_000],
  reed: [10_000, 200_000],
  vine: [15_000, 250_000],
  dryGrass: [10_000, 200_000],
  deadBush: [25_000, 500_000],
  thorn: [2_000, 100_000],
  deadWood: [150_000, 1_200_000],
  giantRoot: [250_000, 2_000_000],
};

test("extra resource drops use recoverable material volume instead of visual bounds", () => {
  assert.deepEqual(Object.keys(resourceDropSizeProfiles), Object.keys(expectedVolumeRanges));
  for (const [key, expectedRange] of Object.entries(expectedVolumeRanges)) {
    const profile = resourceDropSizeProfiles[key];
    assert.deepEqual([profile.minVolumeMm3, profile.maxVolumeMm3], expectedRange, key);
    assert.ok(profile.minVolumeMm3 <= boundingVolumeMm3(profile.minDimensionsM), `${key} minimum exceeds its visual bounds`);
    assert.ok(profile.maxVolumeMm3 <= boundingVolumeMm3(profile.maxDimensionsM), `${key} maximum exceeds its visual bounds`);

    const rules = resourceDropRules.filter((rule) => rule.dropKey === key);
    assert.ok(rules.length > 0, `${key} has no drop rule`);
    for (const rule of rules) {
      assert.deepEqual([rule.minVolumeMm3, rule.maxVolumeMm3], expectedRange, `${rule.sourceKey} -> ${key}`);
    }
  }
});

test("drop IDs, atlas densities, and MaterialPhysics produce bounded backpack mass", () => {
  const physicsByBlockId = new Map(
    physicsDocument.rules
      .filter((rule) => rule.kind === "block")
      .map((rule) => [rule.id, rule]),
  );
  for (const [key, [minVolumeMm3, maxVolumeMm3]] of Object.entries(expectedVolumeRanges)) {
    const rule = resourceDropRules.find((entry) => entry.dropKey === key);
    const physics = physicsByBlockId.get(rule.dropBlockId);
    const atlasDensity = blockAtlasByKey[key]?.physical?.densityKgM3;
    assert.equal(physics?.name, key);
    assert.equal(physics?.densityKgM3, atlasDensity, `${key} density drift`);
    assert.ok(massGrams(minVolumeMm3, atlasDensity) > 0, `${key} minimum mass rounds to zero`);
    assert.ok(massGrams(maxVolumeMm3, atlasDensity) <= 1_400, `${key} exceeds the extra-drop carry limit`);
  }
  const deadWoodRule = resourceDropRules.find((rule) => rule.dropKey === "deadWood");
  assert.equal(massGrams(deadWoodRule.minVolumeMm3, 450), 68);
  assert.equal(massGrams(deadWoodRule.maxVolumeMm3, 450), 540);
});

function boundingVolumeMm3(dimensions) {
  return Math.round(dimensions.width * dimensions.height * dimensions.depth * 1_000_000_000);
}

function massGrams(volumeMm3, densityKgM3) {
  return Math.floor((volumeMm3 * densityKgM3 + 500_000) / 1_000_000);
}
