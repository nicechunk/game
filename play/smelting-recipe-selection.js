function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

export function smeltingRecipeChainIdentity(recipe) {
  const merge = recipe?.recipeKind === "merge";
  return {
    recipeId: positiveInteger(merge ? recipe?.mergeRecipeId : recipe?.recipeId),
    recipeTableId: positiveInteger(merge ? recipe?.mergeRecipeTableId : recipe?.recipeTableId),
  };
}

export function resolveSelectedSmeltingRecipe(primaryRecipe, match, servings = 1) {
  const exactMatch = match?.recipe
    && match.recipe.id === primaryRecipe?.id
    && Math.max(1, Math.floor(Number(match.multiplier) || 1)) === Math.max(1, Math.floor(Number(servings) || 1));
  return exactMatch ? match.recipe : primaryRecipe ?? null;
}
