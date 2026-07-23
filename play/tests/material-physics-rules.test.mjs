import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { smeltingRules } from "../../src/data/smeltingRules.js";

const ruleUrl = new URL("../../public/rules/material-physics-v2.json", import.meta.url);
const physics = JSON.parse(await readFile(ruleUrl, "utf8"));
const mainnetUrl = new URL("../../public/mainnet.json", import.meta.url);
const mainnet = JSON.parse(await readFile(mainnetUrl, "utf8"));

test("public MaterialPhysics v2 rules use the canonical compact schema", () => {
  assert.equal(physics.schemaVersion, 2);
  assert.equal(physics.seed, "material-physics-v2");
  assert.equal(physics.massFormula, "round(volumeMm3 * densityKgM3 / 1000000)");
  assert.equal(physics.ruleCount, physics.rules.length);
  assert.ok(physics.rules.length <= 128);

  const keys = physics.rules.map(ruleKey);
  assert.deepEqual(keys, [...keys].sort((left, right) => left - right));
  assert.equal(new Set(keys).size, keys.length);
  for (const rule of physics.rules) {
    assert.ok(Number.isInteger(rule.id) && rule.id > 0 && rule.id < 0x8000);
    assert.ok(Number.isInteger(rule.densityKgM3) && rule.densityKgM3 > 0 && rule.densityKgM3 <= 0xffff);
    assert.ok(Number.isInteger(rule.standardVolumeMm3) && rule.standardVolumeMm3 > 0 && rule.standardVolumeMm3 <= 0xffffffff);
  }
});

test("public runtime configuration advertises the exact MaterialPhysics rule set", () => {
  assert.deepEqual(mainnet.chain.materialPhysics, {
    schemaVersion: physics.schemaVersion,
    revision: physics.revision,
    seed: physics.seed,
    rulesUrl: "/rules/material-physics-v2.json",
    massFormula: physics.massFormula,
  });
});

test("every smelting output exactly matches its public on-chain physics rule", () => {
  const itemRules = new Map(
    physics.rules
      .filter((rule) => rule.kind === "item")
      .map((rule) => [rule.id, rule]),
  );

  assert.equal(itemRules.size, smeltingRules.materials.length);
  for (const material of smeltingRules.materials) {
    const rule = itemRules.get(material.itemCode);
    assert.ok(rule, `Missing MaterialPhysics rule for ${material.id} (${material.itemCode})`);
    assert.equal(rule.name, material.id);
    assert.equal(rule.densityKgM3, material.densityKgM3);
    assert.equal(rule.standardVolumeMm3, material.unitVolumeMm3);
  }
});

function ruleKey(rule) {
  return rule.kind === "item" ? 0x8000 | rule.id : rule.id;
}
