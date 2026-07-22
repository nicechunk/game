import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAYER_SKILL_IDS,
  PLAYER_SKILL_LEVELS_OFFSET,
  decodePlayerProfileSkillLevels,
} from "../../src/chain/playerSkillLevels.js";
import {
  PLAYER_SKILL_DEFINITIONS,
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
    base: 7000,
    perLevel: 300,
    max: 10000,
  });
});

test("packed Player PDA skill levels decode from the reserved profile bytes", () => {
  const profile = new Uint8Array(773);
  profile[PLAYER_SKILL_LEVELS_OFFSET] = 1;
  const expected = {};
  PLAYER_SKILL_IDS.forEach((skillId, index) => {
    const level = index + 1;
    expected[skillId] = level;
    const byteIndex = PLAYER_SKILL_LEVELS_OFFSET + 1 + (index >> 1);
    profile[byteIndex] |= index % 2 === 0 ? level : level << 4;
  });
  assert.deepEqual(decodePlayerProfileSkillLevels(profile), expected);
  assert.equal(decodePlayerProfileSkillLevels(new Uint8Array(773)), null);
});

test("movement effects use chain-authoritative skill levels", () => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() {
      return JSON.stringify({ swiftness: 10 });
    },
  };
  try {
    const noChainLevel = createProfileSkillEffects({ profile: { minedBlocks: 1_000_000 } });
    assert.equal(noChainLevel.levels.swiftness, 0);
    assert.equal(noChainLevel.movementSpeedMultiplier, 1);

    const explicitChainLevel = createProfileSkillEffects({
      chainLevels: { swiftness: 4 },
      chainXp: { swiftness: Number.MAX_SAFE_INTEGER },
    });
    assert.equal(explicitChainLevel.levels.swiftness, 4);
    assert.equal(explicitChainLevel.movementSpeedMultiplier, 1.12);

    const swiftness = PLAYER_SKILL_DEFINITIONS.find((skill) => skill.id === "swiftness");
    const xpDerived = createProfileSkillEffects({
      chainXp: { swiftness: profileSkillTotalExperienceForLevel(swiftness, 2) },
    });
    assert.equal(xpDerived.levels.swiftness, 2);
    assert.equal(xpDerived.movementSpeedMultiplier, 1.06);
  } finally {
    globalThis.localStorage = previousStorage;
  }
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
