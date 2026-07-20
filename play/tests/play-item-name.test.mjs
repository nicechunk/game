import assert from "node:assert/strict";
import test from "node:test";
import { createPlayItemName } from "../play-item-name.js";
import { resourceDropRules } from "../../src/data/resourceDropRules.js";

const blockNames = new Map([
  [1, "grass"],
  [29, "dryGrass"],
  [48, "cotton"],
]);
const translations = new Map([
  ["main.block.grass", "Grass"],
  ["main.block.dryGrass", "Dry Grass"],
  ["main.block.cotton", "Cotton"],
]);

const itemName = createPlayItemName({
  blockDef: (blockId) => ({ name: blockNames.get(blockId) || "" }),
  voxelItemLabel: (item) => item.decorationId ? "Flower Clump" : "Grass Fiber",
  resourceName: () => "Grass Fiber",
  translate: (key) => translations.get(key) || key,
});

test("backpack names retain concrete block identity for shared resources", () => {
  const grass = itemName({ kind: "resource", resourceId: 1, blockId: 1 });
  const dryGrass = itemName({ kind: "resource", resourceId: 1, blockId: 29 });

  assert.equal(grass, "Grass");
  assert.equal(dryGrass, "Dry Grass");
  assert.notEqual(grass, dryGrass);
});

test("PDA surface decorations retain their decoration label", () => {
  assert.equal(itemName({
    kind: "resource",
    resourceId: 1,
    blockId: 28,
    decorationId: 1,
    decorationRuleId: 1,
  }), "Flower Clump");
});

test("new PDA plants prefer their localized block identity", () => {
  assert.equal(itemName({
    kind: "resource",
    resourceId: 23,
    blockId: 48,
    decorationId: 12,
    decorationRuleId: 74,
  }), "Cotton");
});

test("resource-only records still fall back to the resource class", () => {
  assert.equal(itemName({ kind: "resource", resourceId: 1 }), "Grass Fiber");
});

test("blueprint tools use the localized play label", () => {
  translations.set("main.blueprint.toolName", "Construction Plan");
  assert.equal(itemName({ kind: "blueprint", itemId: "blueprint_tool" }), "Construction Plan");
});

test("grass keeps its configured dry-grass special drop", () => {
  const rule = resourceDropRules.find((entry) => entry.sourceBlockId === 1 && entry.dropBlockId === 29);

  assert.ok(rule);
  assert.equal(rule.chanceBps, 800);
  assert.equal(rule.minAltitude, 2);
  assert.equal(rule.maxAltitude, 40);
  assert.equal(rule.minDepth, 0);
  assert.equal(rule.maxDepth, 2);
});
