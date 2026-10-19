// Fixed recipe and canonical model shared by the UI and custody display.
export const STARTER_AXE_RECIPE_ID = 9001;
export const STARTER_AXE_DURABILITY = 99;
export { STARTER_AXE_CODE, STARTER_AXE_BYTES, LEGACY_STARTER_AXE_CODE, LEGACY_STARTER_AXE_BYTES, isStarterAxeModelBytes } from "../../chunk.js/forge/starter-axe.js";

export const STARTER_AXE_RECIPE = Object.freeze({
  id: "basic_stone_axe", class: "tool", recipeKind: "starter", recipeId: STARTER_AXE_RECIPE_ID, recipeTableId: 900,
  rawInputs: [{key:"stoneFragment",amount:1},{key:"twig",amount:2}], requiredHeatTier:0, artisanLevel:0,
  yieldCount:1, yieldBps:10000, processType:"cold_assembly", station:"backpack", processSeconds:0,
  forgeUse:"tool", unitVolumeMm3:750000, densityKgM3:1467, durabilityCurrent:99, durabilityMax:99,
  description:"1 stone fragment + 2 twigs → 1 basic stone axe (99 durability). No fuel, station, or skill level required. Equip it from your backpack.",
  attributes:{hardness:36,durability:25,toughness:30,ductility:8,brittleness:65,density:35,heatResistance:20,corrosionResistance:60,conductivity:2,thermalConductivity:10,magnetism:0,workability:24},
  composition:[["O","40-50%"],["Si","20-35%"],["C","10-25%"],["H","2-6%"]],
});
