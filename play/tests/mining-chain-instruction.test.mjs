import assert from "node:assert/strict";
import test from "node:test";
import { ComputeBudgetProgram, Keypair, SystemProgram, Transaction } from "@solana/web3.js";

import { partitionBulkMiningRanges } from "../../src/chain/bulkMiningSubmission.js";
import {
  createBatchMineWithRewardsInstruction,
  createFellTreeWithRewardsInstruction,
  createMineBlockWithRewardsInstruction,
  createRangeMineWithRewardsInstruction,
  createSyncPlayerSkillsInstruction,
  deriveMaterialPhysicsPda,
  derivePlayerSkillsPda,
} from "../../src/chain/nicechunkChain.js";

function miningAccounts() {
  return {
    authority: Keypair.generate().publicKey,
    owner: Keypair.generate().publicKey,
    backpack: Keypair.generate().publicKey,
  };
}

function assertRewardMiningTail(instruction, backpack, owner) {
  const [materialPhysics] = deriveMaterialPhysicsPda();
  const [playerSkills] = derivePlayerSkillsPda(owner);
  assert.equal(instruction.keys.length, 14);
  assert.equal(instruction.keys[10].pubkey.toBase58(), backpack.toBase58());
  assert.equal(instruction.keys[11].pubkey.toBase58(), materialPhysics.toBase58());
  assert.equal(instruction.keys[11].isWritable, false);
  assert.equal(instruction.keys[12].pubkey.toBase58(), playerSkills.toBase58());
  assert.equal(instruction.keys[13].pubkey.toBase58(), SystemProgram.programId.toBase58());
}

test("browser reward mining instructions include the material physics PDA", () => {
  const accounts = miningAccounts();
  const block = { x: 1, y: 80, z: 1, blockId: 3 };

  const single = createMineBlockWithRewardsInstruction({
    ...accounts,
    block,
    expectedBlockId: block.blockId,
  });
  assert.equal(single.data.readUInt8(0), 8);
  assertRewardMiningTail(single, accounts.backpack, accounts.owner);

  const batch = createBatchMineWithRewardsInstruction({
    ...accounts,
    blocks: [block, { ...block, x: 2 }],
  });
  assert.equal(batch.data.readUInt8(0), 20);
  assertRewardMiningTail(batch, accounts.backpack, accounts.owner);

  const range = partitionBulkMiningRanges([block, { ...block, x: 2 }])[0];
  const rangeInstruction = createRangeMineWithRewardsInstruction({
    ...accounts,
    range,
  });
  assert.equal(rangeInstruction.data.readUInt8(0), 21);
  assertRewardMiningTail(rangeInstruction, accounts.backpack, accounts.owner);
});

test("browser tree mining places material physics before system and chunk accounts", () => {
  const accounts = miningAccounts();
  const [materialPhysics] = deriveMaterialPhysicsPda();
  const instruction = createFellTreeWithRewardsInstruction({
    ...accounts,
    block: { x: 1, y: 80, z: 1 },
    expectedBlockId: 22,
    chunks: [{ chunkX: 0, chunkZ: 0 }],
  });

  assert.equal(instruction.data.readUInt8(0), 9);
  assert.equal(instruction.keys.length, 11);
  assert.equal(instruction.keys[6].pubkey.toBase58(), accounts.backpack.toBase58());
  assert.equal(instruction.keys[7].pubkey.toBase58(), materialPhysics.toBase58());
  assert.equal(instruction.keys[8].pubkey.toBase58(), SystemProgram.programId.toBase58());
  assert.equal(instruction.keys[9].pubkey.toBase58(), derivePlayerSkillsPda(accounts.owner)[0].toBase58());
  assert.equal(instruction.keys[10].isWritable, true);
});

test("a 640-block eight-type range plus skill sync fits one Solana packet", () => {
  const accounts = miningAccounts();
  const blocks = Array.from({ length: 640 }, (_unused, index) => ({
    x: index % 16,
    y: -20 + Math.floor(index / 128),
    z: Math.floor(index / 16) % 8,
    blockId: index % 8 + 1,
  }));
  const [range] = partitionBulkMiningRanges(blocks);
  const rangeInstruction = createRangeMineWithRewardsInstruction({
    ...accounts,
    range,
  });
  assert.equal(rangeInstruction.data.length, 1 + 15 + 80 + 1 + 8 + 240);
  const syncInstruction = createSyncPlayerSkillsInstruction({
    payer: accounts.authority,
    owner: accounts.owner,
    sourceAccounts: [
      rangeInstruction.keys[3].pubkey,
      rangeInstruction.keys[1].pubkey,
      accounts.backpack,
    ],
    miningCoordinate: { x: 0, y: -20, z: 0 },
  });
  const transaction = new Transaction({
    feePayer: accounts.authority,
    recentBlockhash: accounts.owner.toBase58(),
  }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    rangeInstruction,
    syncInstruction,
  );

  assert.ok(
    transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232,
    "the largest palette range and skill sync must fit the Solana packet limit",
  );
});
