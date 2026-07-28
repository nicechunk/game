export const MARKET_CATEGORY_RAW = "raw";
export const MARKET_CATEGORY_EQUIPMENT = "equipment";
export const MARKET_CATEGORY_BUILDING = "building";
export const MARKET_CATEGORY_CLOTHING = "clothing";

const BACKPACK_SLOT_KIND_ITEM = 2;
const BACKPACK_ITEM_CATEGORY_MATERIAL = 1;

// MarketListing stores the escrowed Backpack slot, not a client-selected label.
// These stable chain item codes keep category filters identical for every wallet.
const BUILDING_MATERIAL_ITEM_CODES = new Set([
  1005,
  1009,
  1022,
  1031, 1032, 1033, 1034, 1035, 1036, 1037, 1038, 1039,
  1040, 1041, 1042, 1043, 1044, 1045, 1046, 1047, 1048, 1049,
  1050, 1051, 1052, 1053, 1054, 1055, 1056, 1057, 1058, 1059,
]);

const BUILDING_MATERIAL_IDS = new Set([
  "ceramic_brick",
  "ash_cement",
  "geopolymer_block",
  "wooden_plank",
  "wooden_stick",
  "squared_timber",
  "clear_glass_panel",
  "ice_blue_glass_panel",
  "amber_glass_panel",
  "basalt_reinforced_glass",
  "fired_clay_brick",
  "adobe_brick",
  "stone_brick",
  "deep_stone_brick",
  "basalt_brick",
  "sandstone_block",
  "cobblestone",
  "polished_stone_slab",
  "lime_plaster",
  "clay_plaster",
  "rammed_earth",
  "shell_terrazzo",
  "white_ceramic_tile",
  "blue_ceramic_tile",
  "volcanic_ash_concrete",
  "salt_crystal_block",
  "roof_tile_terracotta",
  "roof_tile_ice_blue",
  "roof_tile_shell_white",
  "roof_tile_charcoal",
  "roof_tile_ash_gray",
  "roof_tile_mycelium",
]);

const CLOTHING_MATERIAL_ITEM_CODES = new Set([1025]);
const CLOTHING_MATERIAL_IDS = new Set(["cotton_cloth"]);

export function marketCategoryForBackpackSlot(slot) {
  if (!slot || typeof slot !== "object") return MARKET_CATEGORY_RAW;
  const kind = String(slot.kind || "");
  const kindCode = Math.trunc(Number(slot.kindCode) || 0);
  const itemCategory = Math.trunc(Number(slot.category) || 0);
  const itemCode = Math.trunc(Number(slot.itemCode) || 0);
  const materialId = String(slot.materialId || "").trim();
  const isMaterial = kind === "smelted_material"
    || ((kind === "item" || kindCode === BACKPACK_SLOT_KIND_ITEM) && itemCategory === BACKPACK_ITEM_CATEGORY_MATERIAL);

  if (!isMaterial) {
    return kind === "item" || kindCode === BACKPACK_SLOT_KIND_ITEM || kind === "forged" || kind === "tool"
      ? MARKET_CATEGORY_EQUIPMENT
      : MARKET_CATEGORY_RAW;
  }
  if (CLOTHING_MATERIAL_ITEM_CODES.has(itemCode) || CLOTHING_MATERIAL_IDS.has(materialId)) {
    return MARKET_CATEGORY_CLOTHING;
  }
  if (BUILDING_MATERIAL_ITEM_CODES.has(itemCode) || BUILDING_MATERIAL_IDS.has(materialId)) {
    return MARKET_CATEGORY_BUILDING;
  }
  return MARKET_CATEGORY_RAW;
}
