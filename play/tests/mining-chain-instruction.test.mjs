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
    actionId: 0x0102_0304_0506_0708n,
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
  assert.equal(single.data.readBigUInt64LE(1), accounts.actionId);
  assert.equal(single.data.readInt32LE(9), block.x);
  assert.equal(single.data.readInt16LE(13), block.y);
  assert.equal(single.data.readInt32LE(15), block.z);
  assert.equal(single.data.readUInt16LE(19), block.blockId);
  assertRewardMiningTail(single, accounts.backpack, accounts.owner);

  const batch = createBatchMineWithRewardsInstruction({
    ...accounts,
    blocks: [block, { ...block, x: 2 }],
  });
  assert.equal(batch.data.readUInt8(0), 20);
  assert.equal(batch.data.readBigUInt64LE(1), accounts.actionId);
  assert.equal(batch.data.readUInt8(9), 1);
  assert.equal(batch.data.readUInt8(10), 2);
  assert.equal(batch.data.readInt32LE(11), block.x);
  assertRewardMiningTail(batch, accounts.backpack, accounts.owner);

  const range = partitionBulkMiningRanges([block, { ...block, x: 2 }])[0];
  const rangeInstruction = createRangeMineWithRewardsInstruction({
    ...accounts,
    range,
  });
  assert.equal(rangeInstruction.data.readUInt8(0), 21);
  assert.equal(rangeInstruction.data.readBigUInt64LE(1), accounts.actionId);
  assert.equal(rangeInstruction.data.readUInt8(9), 1);
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
  assert.equal(instruction.data.readBigUInt64LE(1), accounts.actionId);
  assert.equal(instruction.data.readInt32LE(9), 1);
  assert.equal(instruction.data.readInt16LE(13), 80);
  assert.equal(instruction.data.readInt32LE(15), 1);
  assert.equal(instruction.data.readUInt16LE(19), 22);
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
  assert.equal(rangeInstruction.data.length, 1 + 8 + 15 + 80 + 1 + 8 + 240);
  const baselineInstruction = createSyncPlayerSkillsInstruction({
    payer: accounts.authority,
    owner: accounts.owner,
    sourceAccounts: [rangeInstruction.keys[3].pubkey],
  });
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
    baselineInstruction,
    rangeInstruction,
    syncInstruction,
  );

  assert.ok(
    transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232,
    "the largest palette range and skill sync must fit the Solana packet limit",
  );
});

test("split mining ranges can reuse one action id and reject a missing id", () => {
  const accounts = miningAccounts();
  const ranges = partitionBulkMiningRanges([
    { x: 0, y: 8, z: 0, blockId: 3 },
    { x: 16, y: 8, z: 0, blockId: 3 },
  ]);
  const instructions = ranges.map((range) => createRangeMineWithRewardsInstruction({
    ...accounts,
    range,
  }));
  assert.equal(instructions.length, 2);
  assert.ok(instructions.every((instruction) => instruction.data.readBigUInt64LE(1) === accounts.actionId));

  const { actionId: _actionId, ...missingActionAccounts } = accounts;
  assert.throws(() => createMineBlockWithRewardsInstruction({
    ...missingActionAccounts,
    block: { x: 0, y: 8, z: 0, blockId: 3 },
    expectedBlockId: 3,
  }), /actionId must be a nonzero unsigned 64-bit integer/);
});
