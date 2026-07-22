export const PROFILE_SKILL_MAX_LEVEL = 10;
export const PROFILE_SKILL_XP_REQUIREMENT_MULTIPLIER = 10;

const PROFILE_SKILL_STORAGE_PREFIX = "nicechunk.playerSkills.";
const PROFILE_SKILL_XP_STORAGE_PREFIX = "nicechunk.playerSkillXp.";

export const PLAYER_SKILL_DEFINITIONS = Object.freeze([
  {
    id: "precisionGathering",
    name: "Precision Gathering",
    tone: "green",
    xpBase: 90,
    xpGrowth: 1.52,
    effect: { key: "precisionGatheringBps", base: 1000, perLevel: 1000, max: 10000 },
    description: "Controls how much verified resource yield is recovered from each mined resource block.",
    xpSource: "Gains XP from confirmed mining and collected resources.",
    metrics(level) {
      const percent = profileSkillEffectValue(this, level) / 100;
      const nextPercent = profileSkillEffectValue(this, level + 1) / 100;
      return {
        current: `${formatSkillNumber(percent)}% gathered · ${formatSkillNumber(percent / 100, 2)} L per resource block`,
        next: `Next level: ${formatSkillNumber(nextPercent)}% · ${formatSkillNumber(nextPercent / 100, 2)} L per block`,
        max: "Max: 100% · 1 L per resource block",
        formula: "min(100%, 10% + Lv x 10%); one resource block is 0.1m x 0.1m x 0.1m = 1 L",
      };
    },
  },
  {
    id: "burden",
    name: "Burden",
    tone: "amber",
    xpBase: 130,
    xpGrowth: 1.58,
    effect: { key: "safeCarryKg", base: 30, perLevel: 10, max: 130 },
    description: "Defines safe carry capacity for mined resources, tools, and future equipment mass.",
    xpSource: "Gains XP from hauling mined and crafted items.",
    metrics(level) {
      const kg = profileSkillEffectValue(this, level);
      const nextKg = profileSkillEffectValue(this, level + 1);
      return {
        current: `${kg} kg safe carry capacity`,
        next: `Next level: ${nextKg} kg`,
        max: "Max: 130 kg safe carry capacity",
        formula: "30 kg + Lv x 10 kg",
      };
    },
  },
  {
    id: "smelting",
    name: "Smelting",
    tone: "red",
    xpBase: 120,
    xpGrowth: 1.56,
    effect: { key: "smeltingOutputBps", base: 7000, perLevel: 300, max: 10000 },
    description: "Improves ore processing efficiency for local and chain-backed material output.",
    xpSource: "Gains XP from smelting runs and confirmed output materials.",
    metrics(level) {
      const yieldPercent = profileSkillEffectValue(this, level) / 100;
      const lossPercent = 100 - yieldPercent;
      const nextYield = profileSkillEffectValue(this, level + 1) / 100;
      const nextLoss = 100 - nextYield;
      return {
        current: `${yieldPercent}% yield · ${lossPercent}% loss`,
        next: `Next level: ${nextYield}% yield · ${nextLoss}% loss`,
        max: "Max: 100% yield · 0% loss",
        formula: "Yield = 70% + Lv x 3%; loss = 30% - Lv x 3%",
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
    xpSource: "Gains XP from forging-ready material output and future forged equipment actions.",
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
    description: "Unlocks more advanced build, assembly, and civilization production tiers.",
    xpSource: "Gains XP from placement and material production.",
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
    xpSource: "Gains XP from traversal-like activity such as mining and placement sessions.",
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
    xpSource: "Gains XP from confirmed mines and rare extra-drop events.",
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
    description: "Reduces repeated action fatigue for mining, movement, and future work loops.",
    xpSource: "Gains XP from mining and placement actions.",
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
    description: "Controls one-hand equipment handling for future physically validated tools.",
    xpSource: "Gains XP from mining actions and heavy material handling.",
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
    description: "Reveals material traits for rare resources, markets, and civilization rules.",
    xpSource: "Gains XP from confirmed resources and processed materials.",
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

export function profileSkillExperienceRequirement(skill, level) {
  if (level >= PROFILE_SKILL_MAX_LEVEL) return 0;
  const nextLevel = Math.max(1, Math.min(PROFILE_SKILL_MAX_LEVEL, Math.trunc(level) + 1));
  return Math.round((skill?.xpBase ?? 100) * PROFILE_SKILL_XP_REQUIREMENT_MULTIPLIER * Math.pow(nextLevel, skill?.xpGrowth ?? 1.55));
}

export function profileSkillTotalExperienceForLevel(skill, level) {
  let total = 0;
  const capped = Math.max(0, Math.min(PROFILE_SKILL_MAX_LEVEL, Math.round(Number(level) || 0)));
  for (let previousLevel = 0; previousLevel < capped; previousLevel += 1) {
    total += profileSkillExperienceRequirement(skill, previousLevel);
  }
  return total;
}

export function profileSkillLevelFromXp(skill, xp) {
  const total = Math.max(0, Math.round(Number(xp) || 0));
  let level = 0;
  for (let nextLevel = 1; nextLevel <= PROFILE_SKILL_MAX_LEVEL; nextLevel += 1) {
    if (total < profileSkillTotalExperienceForLevel(skill, nextLevel)) break;
    level = nextLevel;
  }
  return level;
}

export function profileSkillExperienceProgress(skill, level, xpBySkill = {}) {
  const minimumTotal = profileSkillTotalExperienceForLevel(skill, level);
  const rawTotal = Number(xpBySkill?.[skill.id] ?? minimumTotal);
  const total = Number.isFinite(rawTotal) ? Math.max(0, Math.round(rawTotal)) : minimumTotal;
  const required = profileSkillExperienceRequirement(skill, level);
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

export function profileSkillEffectiveLevel(levels, skill, xpBySkill) {
  if (Number.isFinite(Number(xpBySkill?.[skill.id]))) {
    return profileSkillLevelFromXp(skill, xpBySkill[skill.id]);
  }
  return profileSkillLevel(levels, skill.id);
}

export function profileSkillStateLevel(state, skill) {
  if (!skill) return 0;
  if (Object.prototype.hasOwnProperty.call(state?.resolvedLevels || {}, skill.id)) {
    return profileSkillLevel(state.resolvedLevels, skill.id);
  }
  return profileSkillEffectiveLevel(state?.levels || {}, skill, state?.xpBySkill || {});
}

export function buildProfileSkillState({
  owner = "guest",
  profile = {},
  chainXp = null,
  chainLevels = null,
  chainAuthoritative = false,
} = {}) {
  if (chainAuthoritative) {
    const levels = normalizeSkillLevels(chainLevels);
    const xpBySkill = mergeSkillXp(chainXp || {});
    return {
      levels,
      xpBySkill,
      resolvedLevels: resolveSkillLevels(levels, xpBySkill, { preferLevels: true }),
      source: "chain",
    };
  }
  const levels = loadProfileSkillLevels(owner);
  const xpBySkill = mergeSkillXp(deriveProfileSkillXp(profile), loadProfileSkillXp(owner), chainXp || {});
  return {
    levels,
    xpBySkill,
    resolvedLevels: resolveSkillLevels(levels, xpBySkill),
    source: "legacy",
  };
}

export function deriveProfileSkillXp(profile = {}) {
  const mined = positiveInt(profile.minedBlocks);
  const confirmedMines = positiveInt(profile.confirmedMines);
  const resources = positiveInt(profile.resourcesCollected);
  const placed = positiveInt(profile.placedBlocks);
  const confirmedPlacements = positiveInt(profile.confirmedPlacements);
  const smeltingRuns = positiveInt(profile.smeltingRuns);
  const materials = positiveInt(profile.materialsSmelted);
  return {
    precisionGathering: resources * 90 + confirmedMines * 25,
    burden: resources * 18 + materials * 12,
    smelting: smeltingRuns * 160 + materials * 90,
    forging: materials * 38 + smeltingRuns * 45,
    craftsmanship: confirmedPlacements * 85 + placed * 18 + materials * 28,
    swiftness: mined * 5 + placed * 4,
    exploration: confirmedMines * 44 + resources * 10,
    stamina: mined * 9 + placed * 7,
    strength: mined * 12 + resources * 6,
    appraisal: resources * 22 + materials * 36,
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

function loadProfileSkillLevels(owner) {
  return loadJsonObject(profileSkillStorageKey(owner), "nicechunk.playerSkills");
}

function loadProfileSkillXp(owner) {
  return loadJsonObject(profileSkillXpStorageKey(owner), "nicechunk.playerSkillXp");
}

function profileSkillStorageKey(owner) {
  return `${PROFILE_SKILL_STORAGE_PREFIX}${String(owner || "guest")}`;
}

function profileSkillXpStorageKey(owner) {
  return `${PROFILE_SKILL_XP_STORAGE_PREFIX}${String(owner || "guest")}`;
}

function loadJsonObject(primaryKey, fallbackKey) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return {};
    const raw = storage.getItem(primaryKey) || storage.getItem(fallbackKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mergeSkillXp(...sources) {
  const result = {};
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const [key, value] of Object.entries(source)) {
      const numeric = Math.max(0, Math.round(Number(value) || 0));
      result[key] = Math.max(result[key] || 0, numeric);
    }
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

function resolveSkillLevels(levels, xpBySkill, { preferLevels = false } = {}) {
  return Object.fromEntries(PLAYER_SKILL_DEFINITIONS.map((skill) => {
    const hasLevel = Object.prototype.hasOwnProperty.call(levels, skill.id);
    const hasXp = Number.isFinite(Number(xpBySkill?.[skill.id]));
    const level = preferLevels && hasLevel
      ? profileSkillLevel(levels, skill.id)
      : hasXp
        ? profileSkillLevelFromXp(skill, xpBySkill[skill.id])
        : hasLevel
          ? profileSkillLevel(levels, skill.id)
          : 0;
    return [skill.id, level];
  }));
}

function positiveInt(value) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
