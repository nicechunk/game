import {
  PLAYER_SKILL_DEFINITIONS,
  buildProfileSkillState,
  profileSkillEffectiveLevel,
} from "./play-profile-skills.js";

const SKILL_BY_ID = Object.freeze(Object.fromEntries(PLAYER_SKILL_DEFINITIONS.map((skill) => [skill.id, skill])));

export function createProfileSkillEffects({ owner = "guest", profile = {}, chainXp = null } = {}) {
  const state = buildProfileSkillState({ owner, profile, chainXp });
  const level = (skillId) => {
    const skill = SKILL_BY_ID[skillId];
    return skill ? profileSkillEffectiveLevel(state.levels, skill, state.xpBySkill) : 0;
  };
  const levels = Object.fromEntries(PLAYER_SKILL_DEFINITIONS.map((skill) => [skill.id, level(skill.id)]));
  return {
    levels,
    precisionGatheringBps: Math.min(10000, 1000 + levels.precisionGathering * 1000),
    safeCarryKg: 30 + levels.burden * 10,
    smeltingOutputBps: smeltingSkillOutputBpsForLevel(levels.smelting),
    forgingDurabilityBonusBps: levels.forging * 500,
    craftsmanshipTier: 1 + Math.floor(levels.craftsmanship / 2),
    movementSpeedMultiplier: (100 + levels.swiftness * 3) / 100,
    rareRollWeightBps: levels.exploration * 1000,
    fatigueCostMultiplier: Math.max(0.6, (100 - levels.stamina * 4) / 100),
    oneHandLiftKg: 8 + levels.strength * 4,
    visibleMaterialTraits: 2 + levels.appraisal,
  };
}

export function smeltingSkillOutputBpsForLevel(level) {
  return Math.min(10000, 7000 + Math.max(0, Math.min(10, Math.floor(Number(level) || 0))) * 300);
}

export function describeProfileSkillEffects(effects = {}) {
  return {
    movement: `${Math.round((effects.movementSpeedMultiplier || 1) * 100)}%`,
    gathering: `${Math.round((effects.precisionGatheringBps || 1000) / 100)}%`,
    smelting: `${Math.round((effects.smeltingOutputBps || 7000) / 100)}% yield`,
    carry: `${Math.round(effects.safeCarryKg || 30)} kg`,
  };
}
