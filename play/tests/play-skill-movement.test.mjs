import assert from "node:assert/strict";
import test from "node:test";

import { PLAYER_SKILL_IDS } from "../../src/chain/playerSkillLevels.js";
import {
  PLAYER_SKILL_DEFINITIONS,
  buildProfileSkillState,
  profileSkillExperienceProgress,
  profileSkillExperienceRequirement,
  profileSkillTotalExperienceForLevel,
} from "../play-profile-skills.js";
import { createProfileSkillEffects } from "../play-skill-effects.js";
import {
  PLAYER_MOVEMENT_CONFIG,
  applyPlayerMovementSpeeds,
  playerMovementSpeeds,
} from "../play-movement-speed.js";

test("every skill keeps its gameplay parameters in one skill definition", () => {
  assert.deepEqual(PLAYER_SKILL_DEFINITIONS.map((skill) => skill.id), [...PLAYER_SKILL_IDS]);
  assert.equal(new Set(PLAYER_SKILL_DEFINITIONS.map((skill) => skill.effect.key)).size, PLAYER_SKILL_DEFINITIONS.length);
  for (const skill of PLAYER_SKILL_DEFINITIONS) {
    assert.ok(skill.effect && typeof skill.effect === "object", `${skill.id} must define an effect object`);
    assert.equal(Object.isFrozen(skill), true);
    assert.equal(Object.isFrozen(skill.effect), true);
    assert.ok(Number.isFinite(skill.effect.base), `${skill.id} must define an effect base`);
    assert.ok(Number.isFinite(skill.effect.perLevel), `${skill.id} must define an effect per-level increment`);
  }
  const smelting = PLAYER_SKILL_DEFINITIONS.find((skill) => skill.id === "smelting");
  assert.deepEqual(smelting.effect, {
    key: "smeltingOutputBps",
    base: 10000,
    perLevel: 500,
    max: 15000,
  });
  const burden = PLAYER_SKILL_DEFINITIONS.find((skill) => skill.id === "burden");
  assert.deepEqual(burden.effect, {
    key: "safeCarryKg",
    base: 50,
    perLevel: 10,
    max: 150,
  });
  assert.equal(profileSkillExperienceRequirement(burden, 0), 10_000);
  assert.equal(profileSkillExperienceRequirement(burden, 9), 10_000);
  assert.equal(profileSkillTotalExperienceForLevel(burden, 10), 100_000);
});

test("movement effects use chain-authoritative skill levels", () => {
  const noChainLevel = createProfileSkillEffects({ profile: { minedBlocks: 1_000_000 } });
  assert.equal(noChainLevel.levels.swiftness, 0);
  assert.equal(noChainLevel.movementSpeedMultiplier, 1);

  const explicitChainLevel = createProfileSkillEffects({
    chainLevels: { swiftness: 4 },
    chainXp: { swiftness: Number.MAX_SAFE_INTEGER },
  });
  assert.equal(explicitChainLevel.levels.swiftness, 4);
  assert.equal(explicitChainLevel.movementSpeedMultiplier, 1.12);

  const xpOnly = createProfileSkillEffects({
    chainXp: { swiftness: profileSkillTotalExperienceForLevel(
      PLAYER_SKILL_DEFINITIONS.find((skill) => skill.id === "swiftness"),
      2,
    ) },
  });
  assert.equal(xpOnly.levels.swiftness, 0);
  assert.equal(xpOnly.movementSpeedMultiplier, 1);
});

test("profile XP progress uses cumulative thresholds decoded from the chain rule table", () => {
  const skill = PLAYER_SKILL_DEFINITIONS.find((entry) => entry.id === "precisionGathering");
  const chainThresholds = {
    precisionGathering: [100, 300, 600, 1_000, 1_500, 2_100, 2_800, 3_600, 4_500, 5_500],
  };
  const state = buildProfileSkillState({
    chainXp: { precisionGathering: 175 },
    chainLevels: { precisionGathering: 1 },
    chainThresholds,
  });
  const progress = profileSkillExperienceProgress(
    skill,
    1,
    state.xpBySkill,
    state.thresholdsBySkill,
  );

  assert.equal(profileSkillExperienceRequirement(skill, 0, state.thresholdsBySkill), 100);
  assert.equal(profileSkillExperienceRequirement(skill, 1, state.thresholdsBySkill), 200);
  assert.equal(profileSkillTotalExperienceForLevel(skill, 2, state.thresholdsBySkill), 300);
  assert.deepEqual(progress, {
    total: 175,
    current: 75,
    required: 200,
    ratio: 0.375,
    label: "XP 75/200",
  });
});

test("running is exactly twice the skill-adjusted walking speed", () => {
  const speeds = playerMovementSpeeds(1.12);
  assert.ok(Math.abs(speeds.walking - PLAYER_MOVEMENT_CONFIG.baseSpeed * 1.12) < 1e-10);
  assert.ok(Math.abs(speeds.running - speeds.walking * 2) < 1e-10);

  const controls = { speed: 0, sprintMultiplier: 5 };
  assert.deepEqual(applyPlayerMovementSpeeds(controls, { movementSpeedMultiplier: 1.12 }), speeds);
  assert.equal(controls.speed, speeds.walking);
  assert.equal(controls.sprintMultiplier, 2);
});
