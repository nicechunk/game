import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import {
  PLAYER_SKILL_DEFINITIONS,
  PLAYER_SKILL_XP_SOURCE_DEFINITIONS,
  profileSkillTotalExperienceForLevel,
} from "../play-profile-skills.js";
import {
  createSyncPlayerSkillsInstruction,
  derivePlayerSkillsPda,
  deriveSkillRuleTablePda,
  NICECHUNK_SKILLS_PROGRAM_ID,
} from "../../src/chain/nicechunkChain.js";

test("all ten skills expose chain XP parameters and at least one verified source", () => {
  assert.equal(PLAYER_SKILL_DEFINITIONS.length, 10);
  assert.equal(PLAYER_SKILL_XP_SOURCE_DEFINITIONS.length, 7);
  for (const skill of PLAYER_SKILL_DEFINITIONS) {
    assert.ok(skill.xp.base > 0, `${skill.id} XP base`);
    assert.ok(skill.xp.growth > 1, `${skill.id} XP growth`);
    assert.ok(skill.xp.sources.length > 0, `${skill.id} verified XP source`);
    assert.equal(profileSkillTotalExperienceForLevel(skill, 10) > 0, true);
    assert.equal(Object.isFrozen(skill.xp), true);
    assert.equal(Object.isFrozen(skill.xp.sources), true);
  }
});

test("XP reward matrix covers every current skill", () => {
  const covered = new Set();
  for (const source of PLAYER_SKILL_XP_SOURCE_DEFINITIONS) {
    for (const [skillId, rate] of Object.entries(source.rewards)) {
      if (rate > 0) covered.add(skillId);
    }
  }
  assert.deepEqual(
    [...covered].sort(),
    PLAYER_SKILL_DEFINITIONS.map((skill) => skill.id).sort(),
  );
});

test("skill sync instruction is wallet scoped and deduplicates source accounts", () => {
  const payer = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const source = Keypair.generate().publicKey;
  const [playerSkills] = derivePlayerSkillsPda(owner);
  const [ruleTable] = deriveSkillRuleTablePda();
  const instruction = createSyncPlayerSkillsInstruction({
    payer,
    owner,
    sourceAccounts: [source, source],
  });
  assert.equal(instruction.programId.toBase58(), NICECHUNK_SKILLS_PROGRAM_ID.toBase58());
  assert.equal(instruction.keys[0].pubkey.toBase58(), payer.toBase58());
  assert.equal(instruction.keys[1].pubkey.toBase58(), owner.toBase58());
  assert.equal(instruction.keys[2].pubkey.toBase58(), playerSkills.toBase58());
  assert.equal(instruction.keys[3].pubkey.toBase58(), ruleTable.toBase58());
  assert.equal(instruction.keys.filter((key) => key.pubkey.equals(source)).length, 1);
  assert.deepEqual([...instruction.data], [3]);
});

test("mining skill sync carries a trusted coordinate and instructions sysvar", () => {
  const payer = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const source = Keypair.generate().publicKey;
  const instruction = createSyncPlayerSkillsInstruction({
    payer,
    owner,
    sourceAccounts: [source],
    miningCoordinate: { x: -160, y: 95, z: 320 },
  });
  assert.equal(instruction.data.length, 13);
  assert.equal(instruction.data.readInt32LE(1), -160);
  assert.equal(instruction.data.readInt32LE(5), 95);
  assert.equal(instruction.data.readInt32LE(9), 320);
  assert.equal(instruction.keys[6].pubkey.toBase58(), SYSVAR_INSTRUCTIONS_PUBKEY.toBase58());
  assert.equal(instruction.keys[7].pubkey.toBase58(), source.toBase58());
});
