import { BLOCK_ID, RESOURCE_ID, blockDef } from "/chunk.js/play.js";
import {
  SMELTING_MATERIAL_ATTRIBUTE_KEYS,
  createSmeltingInputCounts,
  deriveSmeltingMaterialProperties,
  findBestSmeltingRecipeForKeys,
  recipeRequirements,
  smeltingFuelForMaterialId,
  smeltingFuelForRawKey,
  smeltingHeatTierByTier,
  smeltingMaterialById,
  smeltingMaterialIdForItemCode,
  smeltingMaterialIdForInputKey,
  smeltingMaterialInputKey,
  smeltingRecipeInputMultiplier,
  smeltingRecipeRequiresFuel,
  smeltingRecipeYieldBps,
  smeltingRules,
  smeltingSkillOutputBpsForLevel,
  smeltingTopAttributeEntries,
} from "/src/data/smeltingRules.js";
export { smeltingRecipeChainIdentity } from "./smelting-recipe-selection.js";

export const SMELTING_RULE_SET = smeltingRules.ruleSet;
export const SMELTING_RECIPES = Object.freeze(smeltingRules.materials);
export const SMELTING_FUELS = Object.freeze(smeltingRules.fuels);
export const SMELTING_HEAT_TIERS = Object.freeze(smeltingRules.heatTiers);

const RESOURCE_FALLBACK_RAW_KEYS = Object.freeze({
  [RESOURCE_ID.grassFiber]: "dryGrass",
  [RESOURCE_ID.soil]: "mud",
  [RESOURCE_ID.stone]: "stone",
  [RESOURCE_ID.sand]: "sand",
  [RESOURCE_ID.clay]: "clay",
  [RESOURCE_ID.snow]: "snow",
  [RESOURCE_ID.basalt]: "basalt",
  [RESOURCE_ID.water]: "toxicWater",
  [RESOURCE_ID.wood]: "trunk",
  [RESOURCE_ID.leaves]: "leaves",
  [RESOURCE_ID.coal]: "coal",
  [RESOURCE_ID.salt]: "saltFlat",
  [RESOURCE_ID.ice]: "ice",
  [RESOURCE_ID.lava]: "lava",
  [RESOURCE_ID.organic]: "vine",
  [RESOURCE_ID.reed]: "reed",
  [RESOURCE_ID.moss]: "moss",
  [RESOURCE_ID.coral]: "coral",
  [RESOURCE_ID.shell]: "shellBed",
});

const MATERIAL_CLASS_COLORS = Object.freeze({
  carbon: [53, 50, 43],
  fiber: [171, 150, 82],
  polymer: [194, 130, 71],
  ceramic: [195, 136, 83],
  chemical: [191, 217, 183],
  glass: [104, 213, 239],
  crystal: [105, 235, 255],
  metal: [184, 199, 210],
  alloy: [153, 174, 190],
  composite: [82, 166, 151],
});

export {
  SMELTING_MATERIAL_ATTRIBUTE_KEYS,
  createSmeltingInputCounts,
  deriveSmeltingMaterialProperties,
  findBestSmeltingRecipeForKeys,
  recipeRequirements,
  smeltingHeatTierByTier,
  smeltingMaterialById,
  smeltingMaterialIdForInputKey,
  smeltingMaterialInputKey,
  smeltingRecipeInputMultiplier,
  smeltingRecipeRequiresFuel,
  smeltingRecipeYieldBps,
  smeltingSkillOutputBpsForLevel,
  smeltingTopAttributeEntries,
};

export function smeltingMaterial(materialId) {
  return smeltingMaterialById(normalizeSmeltingMaterialId(materialId));
}

export function normalizeSmeltingMaterialId(value, itemCode = 0) {
  const fromCode = smeltingMaterialIdForItemCode(Number(itemCode));
  if (fromCode) return fromCode;
  const text = String(value || "");
  if (smeltingMaterialById(text)) return text;
  const encoded = Number(text.replace(/^material-/, ""));
  return smeltingMaterialIdForItemCode(encoded) || "";
}

export function smeltingMaterialForSlot(slot) {
  if (!slot || slot.kind !== "smelted_material") return null;
  const materialId = normalizeSmeltingMaterialId(slot.materialId, slot.itemCode);
  return materialId ? smeltingMaterialById(materialId) : null;
}

export function smeltingInputKeyForSlot(slot) {
  const material = smeltingMaterialForSlot(slot);
  if (material) return smeltingMaterialInputKey(material.id);
  const blockId = Math.trunc(Number(slot?.blockId));
  if (Number.isFinite(blockId) && blockId > BLOCK_ID.air) {
    const key = String(blockDef(blockId)?.name || "");
    if (key && Object.hasOwn(BLOCK_ID, key)) return key;
  }
  return RESOURCE_FALLBACK_RAW_KEYS[Math.trunc(Number(slot?.resourceId))] || "";
}

export function smeltingFuelForSlot(slot) {
  if (!slot || slot.pending || slot.source !== "chain") return null;
  const material = smeltingMaterialForSlot(slot);
  if (material) return smeltingFuelForMaterialId(material.id);
  return smeltingFuelForRawKey(smeltingInputKeyForSlot(slot));
}

export function isSmeltingFuelSlot(slot) {
  return Boolean(smeltingFuelForSlot(slot));
}

export function isSmeltingInputSlot(slot) {
  const key = smeltingInputKeyForSlot(slot);
  return Boolean(key && SMELTING_RECIPES.some((recipe) => recipeRequirements(recipe).some((input) => input.key === key)));
}

export function smeltingRecipeForSelectedSlots(slots = []) {
  const keys = slots.map(smeltingInputKeyForSlot).filter(Boolean);
  const match = findBestSmeltingRecipeForKeys(keys);
  if (!match?.recipe || !match.score?.exact) return null;
  return { ...match, multiplier: smeltingRecipeInputMultiplier(match.recipe, createSmeltingInputCounts(keys)) };
}

export function smeltingRecipePlan(recipe, slots = [], servings = 1) {
  const multiplier = Math.max(1, Math.floor(Number(servings) || 1));
  const used = new Set();
  const selectedSlots = [];
  const requirements = recipeRequirements(recipe).map((requirement) => {
    const required = Math.max(1, Math.floor(Number(requirement.amount) || 1)) * multiplier;
    const candidates = slots
      .filter((slot) => !used.has(slot.id) && smeltingInputKeyForSlot(slot) === requirement.key)
      .sort(compareSmeltingSlots);
    const selected = candidates.slice(0, required);
    for (const slot of selected) {
      used.add(slot.id);
      selectedSlots.push(slot);
    }
    return {
      ...requirement,
      required,
      available: candidates.length,
      selected: selected.length,
      missing: Math.max(0, required - selected.length),
      slots: selected,
    };
  });
  return {
    recipe,
    servings: multiplier,
    requirements,
    slots: selectedSlots,
    used,
    requiredCount: requirements.reduce((sum, input) => sum + input.required, 0),
    selectedCount: requirements.reduce((sum, input) => sum + input.selected, 0),
    complete: requirements.length > 0 && requirements.every((input) => input.missing === 0),
  };
}

export function maxSmeltingRecipeServings(recipe, slots = []) {
  const counts = createSmeltingInputCounts(slots.map(smeltingInputKeyForSlot).filter(Boolean));
  const requirements = recipeRequirements(recipe);
  if (!requirements.length) return 0;
  return requirements.reduce((limit, input) => {
    const required = Math.max(1, Math.floor(Number(input.amount) || 1));
    return Math.min(limit, Math.floor((counts.get(input.key) || 0) / required));
  }, Number.POSITIVE_INFINITY) || 0;
}

export function bestSmeltingFuelSlot(slots = [], requiredHeatTier = 1, excludedIds = new Set()) {
  if (Math.max(0, Math.floor(Number(requiredHeatTier) || 0)) === 0) return null;
  return slots
    .filter((slot) => !excludedIds.has(slot.id))
    .map((slot) => ({ slot, fuel: smeltingFuelForSlot(slot) }))
    .filter(({ fuel }) => fuel && fuel.heatTier >= requiredHeatTier)
    .sort((a, b) => a.fuel.heatTier - b.fuel.heatTier || compareSmeltingSlots(a.slot, b.slot))[0]?.slot ?? null;
}

export function smeltingRawKeyBlockId(key) {
  return Number.isFinite(BLOCK_ID[key]) ? BLOCK_ID[key] : BLOCK_ID.stone;
}

export function smeltingMaterialPreviewItem(materialOrId, overrides = {}) {
  const material = typeof materialOrId === "string" ? smeltingMaterialById(materialOrId) : materialOrId;
  return {
    kind: "smelted_material",
    materialId: material?.id || "material",
    className: material?.class || "material",
    previewColor: MATERIAL_CLASS_COLORS[material?.class] || [150, 170, 180],
    ...overrides,
  };
}

export function smeltingMaterialColor(materialOrId) {
  const material = typeof materialOrId === "string" ? smeltingMaterialById(materialOrId) : materialOrId;
  return MATERIAL_CLASS_COLORS[material?.class] || [150, 170, 180];
}

function compareSmeltingSlots(a, b) {
  const volume = (Number(a?.volumeMm3) || 0) - (Number(b?.volumeMm3) || 0);
  return volume || String(a?.id || "").localeCompare(String(b?.id || ""));
}
