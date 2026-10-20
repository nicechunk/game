export const WATER_BLOCK_ID = 17;
export const WATER_RESOURCE_ID = 8;
export const WATER_UNIT_ML = 1000;
export const WATER_UNIT_MM3 = 1_000_000;

// One standard water item requires ceil(1000 / certified capacity) contacts.
export function waterCollectionHits(capacityMl) {
  const ml = Math.floor(Number(capacityMl));
  return Number.isSafeInteger(ml) && ml > 0 ? Math.ceil(WATER_UNIT_ML / ml) : 0;
}
