import {
  PLAYER_SKILL_DEFINITIONS,
  buildProfileSkillState,
  profileSkillEffectValue,
  profileSkillStateLevel,
} from "./play-profile-skills.js";

const SKILL_BY_ID = Object.freeze(Object.fromEntries(PLAYER_SKILL_DEFINITIONS.map((skill) => [skill.id, skill])));

export function createProfileSkillEffects({
  chainXp = null,
  chainLevels = null,
} = {}) {
  const state = buildProfileSkillState({ chainXp, chainLevels });
  const level = (skillId) => {
    const skill = SKILL_BY_ID[skillId];
    return skill ? profileSkillStateLevel(state, skill) : 0;
  };
  const levels = Object.fromEntries(PLAYER_SKILL_DEFINITIONS.map((skill) => [skill.id, level(skill.id)]));
  const effects = Object.fromEntries(PLAYER_SKILL_DEFINITIONS.map((skill) => [
    skill.effect.key,
    profileSkillEffectValue(skill, levels[skill.id]),
  ]));
  return {
    levels,
    ...effects,
  };
}

export function smeltingSkillOutputBpsForLevel(level) {
  return profileSkillEffectValue(SKILL_BY_ID.smelting, level);
}

export function describeProfileSkillEffects(effects = {}) {
  return {
    movement: `${Math.round((effects.movementSpeedMultiplier || 1) * 100)}%`,
    gathering: `${Math.round((effects.precisionGatheringBps || 1000) / 100)}%`,
    smelting: `+${Math.round(((effects.smeltingOutputBps || 10000) - 10000) / 100)}% extra output`,
    carry: `${Math.round(effects.safeCarryKg || 30)} kg`,
  };
}
