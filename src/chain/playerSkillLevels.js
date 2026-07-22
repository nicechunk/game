export const PLAYER_SKILL_LEVEL_LAYOUT_VERSION = 1;
export const PLAYER_SKILL_LEVELS_OFFSET = 765;
export const PLAYER_SKILL_IDS = Object.freeze([
  "precisionGathering",
  "burden",
  "smelting",
  "forging",
  "craftsmanship",
  "swiftness",
  "exploration",
  "stamina",
  "strength",
  "appraisal",
]);

export function decodePlayerProfileSkillLevels(data, offset = PLAYER_SKILL_LEVELS_OFFSET) {
  if (!data || data.length < offset + 6 || data[offset] !== PLAYER_SKILL_LEVEL_LAYOUT_VERSION) return null;
  const levels = {};
  for (let index = 0; index < PLAYER_SKILL_IDS.length; index += 1) {
    const packed = data[offset + 1 + (index >> 1)];
    const level = index % 2 === 0 ? packed & 0x0f : packed >> 4;
    if (level > 10) return null;
    levels[PLAYER_SKILL_IDS[index]] = level;
  }
  return levels;
}
