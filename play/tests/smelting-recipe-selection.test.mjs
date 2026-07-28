import assert from "node:assert/strict";
import test from "node:test";

import {
  createSmeltingMergeRecipe,
  smeltingRules,
} from "../../src/data/smeltingRules.js";
import {
  resolveSelectedSmeltingRecipe,
  smeltingRecipeChainIdentity,
} from "../smelting-recipe-selection.js";

test("every primary and merge recipe resolves its canonical chain identity", () => {
  assert.equal(smeltingRules.materials.length, 59);
  for (const material of smeltingRules.materials) {
    assert.deepEqual(smeltingRecipeChainIdentity(material), {
      recipeId: material.recipeId,
      recipeTableId: material.recipeTableId,
    });

    const merge = createSmeltingMergeRecipe(material);
    assert.deepEqual(smeltingRecipeChainIdentity(merge), {
      recipeId: material.mergeRecipeId,
      recipeTableId: material.mergeRecipeTableId,
    });
  }
});

test("blasting charge uses the last free slots in recipe tables 225 and 325", () => {
  const charge = smeltingRules.materials.find((material) => material.id === "blasting_charge");
  const merge = createSmeltingMergeRecipe(charge);

  assert.deepEqual(smeltingRecipeChainIdentity(charge), { recipeId: 1060, recipeTableId: 225 });
  assert.deepEqual(smeltingRecipeChainIdentity(merge), { recipeId: 2060, recipeTableId: 325 });
});

test("stone brick keeps separate primary and material-merge instructions", () => {
  const stoneBrick = smeltingRules.materials.find((material) => material.id === "stone_brick");
  const merge = createSmeltingMergeRecipe(stoneBrick);

  assert.deepEqual(smeltingRecipeChainIdentity(stoneBrick), { recipeId: 1040, recipeTableId: 223 });
  assert.deepEqual(smeltingRecipeChainIdentity(merge), { recipeId: 2040, recipeTableId: 323 });
});

test("an exact merge match remains selected instead of reverting to the primary recipe", () => {
  const primary = smeltingRules.materials.find((material) => material.id === "stone_brick");
  const merge = createSmeltingMergeRecipe(primary);
  const match = { recipe: merge, multiplier: 2 };

  assert.equal(resolveSelectedSmeltingRecipe(primary, match, 2), merge);
  assert.equal(resolveSelectedSmeltingRecipe(primary, match, 1), primary);
});
