export const PROFILE_SKILL_MAX_LEVEL = 10;
export const PROFILE_SKILL_XP_REQUIREMENT_MULTIPLIER = 10;

export const PLAYER_SKILL_DEFINITIONS = Object.freeze([
  {
    id: "precisionGathering",
    name: "Precision Gathering",
    tone: "green",
    xpBase: 90,
    xpGrowth: 1.52,
    effect: { key: "precisionGatheringBps", base: 5000, perLevel: 500, max: 10000 },
    description: "Controls how much verified resource yield is recovered from each mined resource block.",
    xpSource: "Each successful mining action grants 1 XP. Batch mining, blasting, and whole-tree felling grant 1 XP for the complete action.",
    metrics(level) {
      const percent = profileSkillEffectValue(this, level) / 100;
      const nextPercent = profileSkillEffectValue(this, level + 1) / 100;
      return {
        current: `${formatSkillNumber(percent)}% gathered · ${formatSkillNumber(percent * 10)} cm3 per resource block`,
        next: `Next level: ${formatSkillNumber(nextPercent)}% · ${formatSkillNumber(nextPercent * 10)} cm3 per block`,
        max: "Max: 100% · 1,000 cm3 per resource block",
        formula: "Yield = 50% + Lv x 5%; one resource block is 1,000 cm3 and mass = volume x material density",
      };
    },
  },
  {
    id: "burden",
    name: "Burden",
    tone: "amber",
    xpBase: 1000,
    xpGrowth: 0,
    effect: { key: "safeCarryKg", base: 50, perLevel: 10, max: 150 },
    description: "Defines safe carry capacity for mined resources, tools, and equipment mass.",
    xpSource: "Each verified mine grants floor(carried kg / 20) x Chunk distance XP; same-Chunk mines grant 0 and distance is capped at 5.",
    metrics(level) {
      const kg = profileSkillEffectValue(this, level);
      const nextKg = profileSkillEffectValue(this, level + 1);
      return {
        current: `${kg} kg safe carry capacity`,
        next: `Next level: ${nextKg} kg`,
        max: "Max: 150 kg safe carry capacity",
        formula: "50 kg + Lv x 10 kg",
      };
    },
  },
  {
    id: "smelting",
    name: "Smelting",
    tone: "red",
    xpBase: 120,
    xpGrowth: 1.56,
    effect: { key: "smeltingOutputBps", base: 10000, perLevel: 500, max: 15000 },
    description: "Adds 5% output per level on top of each smelting recipe's base yield.",
    xpSource: "Each completed normal recipe grants 1 XP. Internal stack-merge operations grant no XP.",
    metrics(level) {
      const bonusPercent = (profileSkillEffectValue(this, level) - 10000) / 100;
      const nextBonus = (profileSkillEffectValue(this, level + 1) - 10000) / 100;
      return {
        current: `+${bonusPercent}% extra output`,
        next: `Next level: +${nextBonus}% extra output`,
        max: "Max: +50% extra output",
        formula: "Extra output = Lv x 5%",
      };
    },
  },
  {
    id: "forging",
    name: "Forging",
    tone: "steel",
    xpBase: 140,
    xpGrowth: 1.6,
    effect: { key: "forgingDurabilityBonusBps", base: 0, perLevel: 500, max: 5000 },
    description: "Improves forged equipment durability and future tool quality calculations.",
    xpSource: "Each successfully forged item grants 1 XP.",
    metrics(level) {
      const bonus = profileSkillEffectValue(this, level) / 100;
      const nextBonus = profileSkillEffectValue(this, level + 1) / 100;
      return {
        current: `+${bonus}% forged item durability`,
        next: `Next level: +${nextBonus}% durability`,
        max: "Max: +50% durability",
        formula: "Durability bonus = Lv x 5%",
      };
    },
  },
  {
    id: "craftsmanship",
    name: "Craftsmanship",
    tone: "cyan",
    xpBase: 180,
    xpGrowth: 1.66,
    effect: { key: "craftsmanshipTier", base: 1, perLevel: 0.5, max: 6, rounding: "floor" },
    description: "Planned: unlocks more advanced build, assembly, and civilization production tiers.",
    xpSource: "Planned rule: each successful advanced crafting or assembly action grants 1 XP.",
    metrics(level) {
      const tier = profileSkillEffectValue(this, level);
      const nextTier = profileSkillEffectValue(this, level + 1);
      return {
        current: `Process tier ${tier} available`,
        next: `Next level: process tier ${nextTier}`,
        max: "Max: process tier 6",
        formula: "Tier = 1 + floor(Lv / 2); unlocks advanced craft methods",
      };
    },
  },
  {
    id: "swiftness",
    name: "Swiftness",
    tone: "blue",
    xpBase: 110,
    xpGrowth: 1.5,
    effect: { key: "movementSpeedMultiplier", base: 1, perLevel: 0.03, max: 1.3 },
    description: "Improves movement efficiency without changing chain-verifiable world rules.",
    xpSource: "Verified mining positions at least 160 blocks apart grant 1 XP; shorter moves grant 0 XP.",
    metrics(level) {
      const speed = Math.round(profileSkillEffectValue(this, level) * 100);
      const nextSpeed = Math.round(profileSkillEffectValue(this, level + 1) * 100);
      return {
        current: `${speed}% movement speed`,
        next: `Next level: ${nextSpeed}% movement speed`,
        max: "Max: 130% movement speed",
        formula: "Speed = 100% + Lv x 3%",
      };
    },
  },
  {
    id: "exploration",
    name: "Exploration",
    tone: "violet",
    xpBase: 125,
    xpGrowth: 1.57,
    effect: { key: "rareRollWeightBps", base: 0, perLevel: 1000, max: 10000 },
    description: "Improves future rare discovery rolls while keeping resource truth coordinate based.",
    xpSource: "Each rare extra drop that actually triggers grants 1 XP.",
    metrics(level) {
      const chance = profileSkillEffectValue(this, level) / 100;
      const nextChance = profileSkillEffectValue(this, level + 1) / 100;
      return {
        current: `+${chance}% rare extra-drop roll weight`,
        next: `Next level: +${nextChance}% rare roll weight`,
        max: "Max: +100% rare extra-drop roll weight",
        formula: "Rare roll weight bonus = Lv x 10%; visual state never decides resource legality",
      };
    },
  },
  {
    id: "stamina",
    name: "Stamina",
    tone: "lime",
    xpBase: 105,
    xpGrowth: 1.5,
    effect: { key: "fatigueCostMultiplier", base: 1, perLevel: -0.04, min: 0.6 },
    description: "Planned: reduces repeated action fatigue for mining, movement, and future work loops.",
    xpSource: "Planned rule: each 100 verified stamina points consumed and safely recovered grants 1 XP.",
    metrics(level) {
      const reduction = Math.round((1 - profileSkillEffectValue(this, level)) * 100);
      const nextReduction = Math.round((1 - profileSkillEffectValue(this, level + 1)) * 100);
      return {
        current: `${reduction}% lower mining and movement fatigue`,
        next: `Next level: ${nextReduction}% lower fatigue`,
        max: "Max: 40% lower fatigue",
        formula: "Fatigue cost reduction = Lv x 4%",
      };
    },
  },
  {
    id: "strength",
    name: "Strength",
    tone: "orange",
    xpBase: 145,
    xpGrowth: 1.59,
    effect: { key: "oneHandLiftKg", base: 8, perLevel: 4, max: 48 },
    description: "Planned: controls one-hand equipment handling for physically validated tools.",
    xpSource: "Planned rule: a successful heavy-handling action at 50% or more of the safe one-hand load grants 1 XP.",
    metrics(level) {
      const liftKg = profileSkillEffectValue(this, level);
      const nextLiftKg = profileSkillEffectValue(this, level + 1);
      return {
        current: `${liftKg} kg one-hand lift control`,
        next: `Next level: ${nextLiftKg} kg one-hand control`,
        max: "Max: 48 kg one-hand lift control",
        formula: "Grip lift control = 8 kg + Lv x 4 kg; later combines mass, gravity and torque",
      };
    },
  },
  {
    id: "appraisal",
    name: "Appraisal",
    tone: "gold",
    xpBase: 160,
    xpGrowth: 1.62,
    effect: { key: "visibleMaterialTraits", base: 2, perLevel: 1, max: 12 },
    description: "Planned: reveals material traits for rare resources, markets, and civilization rules.",
    xpSource: "Planned rule: first-time identification of a new material trait grants 1 XP; repeats grant 0 XP.",
    metrics(level) {
      const traits = profileSkillEffectValue(this, level);
      const nextTraits = profileSkillEffectValue(this, level + 1);
      return {
        current: `Reveals ${traits} material traits`,
        next: `Next level: reveals ${nextTraits} traits`,
        max: "Max: reveals 12 material traits",
        formula: "Visible traits = 2 + Lv; shader visuals never become resource proof",
      };
    },
  },
].map((skill) => Object.freeze({
  ...skill,
  effect: Object.freeze({ ...skill.effect }),
})));

export function profileSkillEffectValue(skill, level) {
  const effect = skill?.effect;
  if (!effect?.key) return 0;
  const safeLevel = Math.round(clamp(Number(level) || 0, 0, PROFILE_SKILL_MAX_LEVEL));
  let value = (Number(effect.base) || 0) + (Number(effect.perLevel) || 0) * safeLevel;
  if (Number.isFinite(Number(effect.min))) value = Math.max(Number(effect.min), value);
  if (Number.isFinite(Number(effect.max))) value = Math.min(Number(effect.max), value);
  if (effect.rounding === "floor") value = Math.floor(value);
  if (effect.rounding === "round") value = Math.round(value);
  return value;
}

export function profileSkillExperienceRequirement(skill, level, thresholdsBySkill = null) {
  if (level >= PROFILE_SKILL_MAX_LEVEL) return 0;
  const thresholds = normalizedThresholdsForSkill(skill, thresholdsBySkill);
  if (thresholds) {
    const currentLevel = Math.max(0, Math.min(PROFILE_SKILL_MAX_LEVEL - 1, Math.trunc(level)));
    const previousTotal = currentLevel > 0 ? thresholds[currentLevel - 1] : 0;
    return thresholds[currentLevel] - previousTotal;
  }
  const nextLevel = Math.max(1, Math.min(PROFILE_SKILL_MAX_LEVEL, Math.trunc(level) + 1));
  return Math.round((skill?.xpBase ?? 100) * PROFILE_SKILL_XP_REQUIREMENT_MULTIPLIER * Math.pow(nextLevel, skill?.xpGrowth ?? 1.55));
}

export function profileSkillTotalExperienceForLevel(skill, level, thresholdsBySkill = null) {
  const capped = Math.max(0, Math.min(PROFILE_SKILL_MAX_LEVEL, Math.round(Number(level) || 0)));
  if (capped === 0) return 0;
  const thresholds = normalizedThresholdsForSkill(skill, thresholdsBySkill);
  if (thresholds) return thresholds[capped - 1];
  let total = 0;
  for (let previousLevel = 0; previousLevel < capped; previousLevel += 1) {
    total += profileSkillExperienceRequirement(skill, previousLevel);
  }
  return total;
}

export function profileSkillLevelFromXp(skill, xp, thresholdsBySkill = null) {
  const total = Math.max(0, Math.round(Number(xp) || 0));
  let level = 0;
  for (let nextLevel = 1; nextLevel <= PROFILE_SKILL_MAX_LEVEL; nextLevel += 1) {
    if (total < profileSkillTotalExperienceForLevel(skill, nextLevel, thresholdsBySkill)) break;
    level = nextLevel;
  }
  return level;
}

export function profileSkillExperienceProgress(skill, level, xpBySkill = {}, thresholdsBySkill = null) {
  const minimumTotal = profileSkillTotalExperienceForLevel(skill, level, thresholdsBySkill);
  const rawTotal = Number(xpBySkill?.[skill.id] ?? minimumTotal);
  const total = Number.isFinite(rawTotal) ? Math.max(0, Math.round(rawTotal)) : minimumTotal;
  const required = profileSkillExperienceRequirement(skill, level, thresholdsBySkill);
  if (level >= PROFILE_SKILL_MAX_LEVEL) {
    return {
      total,
      current: 0,
      required: 0,
      ratio: 1,
      label: `Total XP ${formatProfileSkillXp(total)}`,
    };
  }
  const current = Math.max(0, Math.min(required, total - minimumTotal));
  return {
    total,
    current,
    required,
    ratio: required > 0 ? current / required : 1,
    label: `XP ${formatProfileSkillXp(current)}/${formatProfileSkillXp(required)}`,
  };
}

export function profileSkillLevel(levels, skillId) {
  const raw = Number(levels?.[skillId] ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.round(clamp(raw, 0, PROFILE_SKILL_MAX_LEVEL));
}

export function profileSkillStateLevel(state, skill) {
  if (!skill) return 0;
  if (Object.prototype.hasOwnProperty.call(state?.resolvedLevels || {}, skill.id)) {
    return profileSkillLevel(state.resolvedLevels, skill.id);
  }
  return profileSkillLevel(state?.levels || {}, skill.id);
}

export function buildProfileSkillState({
  chainXp = null,
  chainLevels = null,
  chainThresholds = null,
} = {}) {
  const levels = normalizeSkillLevels(chainLevels);
  const xpBySkill = normalizeSkillXp(chainXp);
  const thresholdsBySkill = normalizeSkillThresholds(chainThresholds);
  return {
    levels,
    xpBySkill,
    thresholdsBySkill,
    resolvedLevels: { ...levels },
    source: "chain",
  };
}

export function formatProfileSkillXp(value) {
  return Math.max(0, Math.round(Number(value) || 0)).toLocaleString();
}

export function formatSkillNumber(value, decimals = 0) {
  if (!Number.isFinite(value)) return "0";
  return value
    .toFixed(decimals)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

function normalizeSkillXp(source) {
  const result = {};
  if (!source || typeof source !== "object") return result;
  for (const skill of PLAYER_SKILL_DEFINITIONS) {
    if (!Object.prototype.hasOwnProperty.call(source, skill.id)) continue;
    result[skill.id] = Math.max(0, Math.round(Number(source[skill.id]) || 0));
  }
  return result;
}

function normalizeSkillLevels(source) {
  const levels = {};
  if (!source || typeof source !== "object") return levels;
  for (const skill of PLAYER_SKILL_DEFINITIONS) {
    if (!Object.prototype.hasOwnProperty.call(source, skill.id)) continue;
    levels[skill.id] = profileSkillLevel(source, skill.id);
  }
  return levels;
}

function normalizeSkillThresholds(source) {
  const result = {};
  if (!source || typeof source !== "object") return result;
  for (const skill of PLAYER_SKILL_DEFINITIONS) {
    const thresholds = normalizedThresholdsForSkill(skill, source);
    if (thresholds) result[skill.id] = thresholds;
  }
  return result;
}

function normalizedThresholdsForSkill(skill, thresholdsBySkill) {
  const source = thresholdsBySkill?.[skill?.id];
  if (!Array.isArray(source) || source.length !== PROFILE_SKILL_MAX_LEVEL) return null;
  const thresholds = [];
  let previous = 0;
  for (const raw of source) {
    const value = Math.round(Number(raw));
    if (!Number.isSafeInteger(value) || value <= previous) return null;
    thresholds.push(value);
    previous = value;
  }
  return Object.freeze(thresholds);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
