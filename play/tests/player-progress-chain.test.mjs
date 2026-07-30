import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  deriveGlobalConfigPda,
  derivePlayerSkillsPda,
  deriveSkillRuleTablePda,
  fetchPlayerProgress,
  NICECHUNK_SKILLS_PROGRAM_ID,
} from "../../src/chain/nicechunkChain.js";

const chunkProgramId = new PublicKey("GnVKn442KDTDgCyjVG7SEtCQQLjaCiLvrEZDWSU13wbj");
const smeltingProgramId = new PublicKey("6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7");
const context = Object.freeze({ chunkProgramId, smeltingProgramId });

function deriveProgress(owner, programId) {
  return PublicKey.findProgramAddressSync([
    Buffer.from("player-progress"),
    deriveGlobalConfigPda().toBuffer(),
    owner.toBuffer(),
  ], programId);
}

function progressAccount({ owner, programId, bump, precision = 0n, smelting = 0n, exploration = 0n }) {
  const data = Buffer.alloc(128);
  data.write("NCKPRG01", 0, "utf8");
  data.writeUInt16LE(1, 8);
  data.writeUInt8(bump, 10);
  data.writeUInt8(1, 11);
  owner.toBuffer().copy(data, 12);
  deriveGlobalConfigPda().toBuffer().copy(data, 44);
  data.writeBigUInt64LE(precision, 76);
  data.writeBigUInt64LE(smelting, 108);
  data.writeBigUInt64LE(exploration, 116);
  return { owner: programId, data };
}

function playerSkillsAccount({ owner, revision = 19, xp = 0n, level = 0 }) {
  const [, bump] = derivePlayerSkillsPda(owner);
  const data = Buffer.alloc(480);
  data.write("NCKSKL02", 0, "utf8");
  data.writeUInt16LE(2, 8);
  data.writeUInt8(bump, 10);
  data.writeUInt8(1, 11);
  owner.toBuffer().copy(data, 12);
  deriveGlobalConfigPda().toBuffer().copy(data, 44);
  data.writeBigUInt64LE(xp, 76);
  data.writeUInt8(level, 156);
  data.writeUInt32LE(revision, 172);
  return { owner: NICECHUNK_SKILLS_PROGRAM_ID, data };
}

function skillRuleTableAccount({ revision = 19 } = {}) {
  const [, bump] = deriveSkillRuleTablePda();
  const data = Buffer.alloc(912 + 32 * 136);
  data.write("NCKXPR02", 0, "utf8");
  data.writeUInt16LE(2, 8);
  data.writeUInt8(bump, 10);
  data.writeUInt8(1, 11);
  deriveGlobalConfigPda().toBuffer().copy(data, 44);
  data.writeUInt8(10, 77);
  data.writeUInt32LE(revision, 80);
  for (let skillIndex = 0; skillIndex < 10; skillIndex += 1) {
    for (let levelIndex = 0; levelIndex < 10; levelIndex += 1) {
      const offset = 108 + (skillIndex * 10 + levelIndex) * 8;
      data.writeBigUInt64LE(BigInt((skillIndex + 1) * 1_000 + levelIndex + 1), offset);
    }
  }
  return { owner: NICECHUNK_SKILLS_PROGRAM_ID, data };
}

function withRuleTable(connection, account = skillRuleTableAccount()) {
  return {
    ...connection,
    async getAccountInfo(publicKey, commitment) {
      assert.equal(publicKey.toBase58(), deriveSkillRuleTablePda()[0].toBase58());
      assert.equal(commitment, "confirmed");
      return account;
    },
  };
}

test("player progress loads Chunk, Smelting, and authoritative Skills domains", async () => {
  const owner = Keypair.generate().publicKey;
  const [chunkProgress, chunkBump] = deriveProgress(owner, chunkProgramId);
  const [smeltingProgress, smeltingBump] = deriveProgress(owner, smeltingProgramId);
  const requested = [];
  const connection = withRuleTable({
    async getMultipleAccountsInfo(publicKeys, commitment) {
      requested.push(...publicKeys);
      assert.equal(commitment, "confirmed");
      return [
        progressAccount({
          owner,
          programId: chunkProgramId,
          bump: chunkBump,
          precision: 31n,
          smelting: 999n,
          exploration: 47n,
        }),
        progressAccount({
          owner,
          programId: smeltingProgramId,
          bump: smeltingBump,
          smelting: 83n,
        }),
        playerSkillsAccount({ owner, xp: 1_001n, level: 1 }),
      ];
    },
  });

  const progress = await fetchPlayerProgress(owner, { connection, context });

  assert.deepEqual(requested.map((key) => key.toBase58()), [
    chunkProgress.toBase58(),
    smeltingProgress.toBase58(),
    derivePlayerSkillsPda(owner)[0].toBase58(),
  ]);
  assert.equal(progress.publicKey, chunkProgress.toBase58());
  assert.equal(progress.smeltingPublicKey, smeltingProgress.toBase58());
  assert.equal(progress.precisionGatheringXp, 31);
  assert.equal(progress.smeltingXp, 83);
  assert.equal(progress.explorationXp, 47);
  assert.equal(progress.skillXp.precisionGathering, 1_001);
  assert.equal(progress.skillLevels.precisionGathering, 1);
  assert.deepEqual(progress.skillThresholds.precisionGathering, [
    1_001, 1_002, 1_003, 1_004, 1_005,
    1_006, 1_007, 1_008, 1_009, 1_010,
  ]);
  assert.equal(progress.skillRuleRevision, 19);
  assert.equal(progress.skillRuleTableRevision, 19);
  assert.equal(progress.skillRulesCurrent, true);
});

test("missing progress domains resolve to zero without changing either PDA", async () => {
  const owner = Keypair.generate().publicKey;
  const connection = withRuleTable({
    async getMultipleAccountsInfo() {
      return [null, null, null];
    },
  });

  const progress = await fetchPlayerProgress(owner, { connection, context });

  assert.equal(progress.precisionGatheringXp, 0);
  assert.equal(progress.smeltingXp, 0);
  assert.equal(progress.explorationXp, 0);
  assert.equal(progress.playerSkillsInitialized, false);
  assert.equal(progress.skillRulesCurrent, false);
  assert.equal(progress.skillRuleTableRevision, 19);
  assert.notEqual(progress.publicKey, progress.smeltingPublicKey);
});

test("a malformed or substituted progress account is rejected", async () => {
  const owner = Keypair.generate().publicKey;
  const [, smeltingBump] = deriveProgress(owner, smeltingProgramId);
  const connection = withRuleTable({
    async getMultipleAccountsInfo() {
      return [
        null,
        progressAccount({
          owner,
          programId: chunkProgramId,
          bump: smeltingBump,
          smelting: 83n,
        }),
        null,
      ];
    },
  });

  await assert.rejects(
    fetchPlayerProgress(owner, { connection, context }),
    /player-progress-domain-invalid/u,
  );
});

test("skill rule table reads are cached until the PlayerSkills revision changes", async () => {
  const owner = Keypair.generate().publicKey;
  let revision = 19;
  let ruleTableReads = 0;
  const connection = {
    async getMultipleAccountsInfo() {
      return [null, null, playerSkillsAccount({ owner, revision })];
    },
    async getAccountInfo() {
      ruleTableReads += 1;
      return skillRuleTableAccount({ revision });
    },
  };

  const first = await fetchPlayerProgress(owner, { connection, context });
  const second = await fetchPlayerProgress(owner, { connection, context });
  assert.equal(first.skillRuleTableRevision, 19);
  assert.equal(second.skillRuleTableRevision, 19);
  assert.equal(ruleTableReads, 1);

  revision = 20;
  const updated = await fetchPlayerProgress(owner, { connection, context });
  assert.equal(updated.skillRuleRevision, 20);
  assert.equal(updated.skillRuleTableRevision, 20);
  assert.equal(updated.skillRulesCurrent, true);
  assert.equal(ruleTableReads, 2);
});
