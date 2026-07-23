import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  createExecuteSmeltingInstruction,
  deriveGlobalConfigPda,
  deriveMaterialPhysicsPda,
  deriveSmeltingRecipeTablePda,
  isValidSmeltingSubmissionSelection,
} from "../../src/chain/nicechunkChain.js";

const chunkProgramId = new PublicKey("GnVKn442KDTDgCyjVG7SEtCQQLjaCiLvrEZDWSU13wbj");

test("browser smelting instruction derives player progress under the smelting program", () => {
  const owner = Keypair.generate().publicKey;
  const recipeTable = Keypair.generate().publicKey;
  const backpack = Keypair.generate().publicKey;
  const instruction = createExecuteSmeltingInstruction({
    owner,
    recipeTable,
    backpack,
    recipeId: 1025,
    inputIndexes: [10, 14, 18, 8, 20],
    fuelIndexes: [1],
  });
  const globalConfig = deriveGlobalConfigPda();
  const [materialPhysics] = deriveMaterialPhysicsPda();
  const [expectedProgress] = PublicKey.findProgramAddressSync([
    Buffer.from("player-progress"),
    globalConfig.toBuffer(),
    owner.toBuffer(),
  ], instruction.programId);
  const [incorrectChunkProgress] = PublicKey.findProgramAddressSync([
    Buffer.from("player-progress"),
    globalConfig.toBuffer(),
    owner.toBuffer(),
  ], chunkProgramId);

  assert.equal(instruction.keys.length, 9);
  assert.equal(instruction.keys[0].pubkey.toBase58(), owner.toBase58());
  assert.equal(instruction.keys[1].pubkey.toBase58(), recipeTable.toBase58());
  assert.equal(instruction.keys[2].pubkey.toBase58(), backpack.toBase58());
  assert.equal(instruction.keys[3].pubkey.toBase58(), expectedProgress.toBase58());
  assert.notEqual(instruction.keys[3].pubkey.toBase58(), incorrectChunkProgress.toBase58());
  assert.equal(instruction.keys[4].pubkey.toBase58(), globalConfig.toBase58());
  assert.equal(instruction.keys[5].pubkey.toBase58(), materialPhysics.toBase58());
  assert.equal(instruction.keys[8].pubkey.toBase58(), SystemProgram.programId.toBase58());
  assert.deepEqual([...instruction.data.subarray(0, 2)], [3, 2]);
});

test("ambient smelting accepts inputs without a fuel slot", () => {
  assert.equal(isValidSmeltingSubmissionSelection({
    recipeId: 1031,
    inputIndexes: [12],
    fuelIndexes: [],
  }), true);
  assert.equal(isValidSmeltingSubmissionSelection({
    recipeId: 1034,
    inputIndexes: [1, 2, 3, 4, 5, 6],
    fuelIndexes: [7],
  }), true);
});

test("smelting rejects missing, duplicate, overlapping, or malformed indexes", () => {
  assert.equal(isValidSmeltingSubmissionSelection({ recipeId: 1031, inputIndexes: [] }), false);
  assert.equal(isValidSmeltingSubmissionSelection({ recipeId: 1031, inputIndexes: [12, 12] }), false);
  assert.equal(isValidSmeltingSubmissionSelection({ recipeId: 1031, inputIndexes: [12], fuelIndexes: [12] }), false);
  assert.equal(isValidSmeltingSubmissionSelection({ recipeId: "invalid", inputIndexes: [12] }), false);
  assert.equal(isValidSmeltingSubmissionSelection({ recipeId: 1031, inputIndexes: [99] }), false);
});

test("ambient smelting instruction encodes an explicit zero fuel count", () => {
  const instruction = createExecuteSmeltingInstruction({
    owner: Keypair.generate().publicKey,
    recipeTable: Keypair.generate().publicKey,
    backpack: Keypair.generate().publicKey,
    recipeId: 1031,
    inputIndexes: [12],
    fuelIndexes: [],
  });

  assert.equal(instruction.data.readUInt8(10), 1);
  assert.equal(instruction.data.readUInt8(11), 0);
  assert.equal(instruction.data.readUInt16LE(12), 1);
  assert.equal(instruction.data.readUInt8(14), 12);
});

test("recipe table 221 recipe 1015 keeps its production selection and nine-account ABI", () => {
  const [recipeTable] = deriveSmeltingRecipeTablePda(221n);
  const instruction = createExecuteSmeltingInstruction({
    owner: Keypair.generate().publicKey,
    recipeTable,
    backpack: Keypair.generate().publicKey,
    recipeId: 1015,
    inputIndexes: [8, 9, 0],
    fuelIndexes: [1],
    batchMultiplier: 1,
  });
  const [materialPhysics] = deriveMaterialPhysicsPda();

  assert.equal(instruction.keys.length, 9);
  assert.equal(instruction.keys[1].pubkey.toBase58(), recipeTable.toBase58());
  assert.equal(instruction.keys[5].pubkey.toBase58(), materialPhysics.toBase58());
  assert.equal(instruction.data.readBigUInt64LE(2), 1015n);
  assert.equal(instruction.data.readUInt8(10), 3);
  assert.equal(instruction.data.readUInt8(11), 1);
  assert.equal(instruction.data.readUInt16LE(12), 1);
  assert.deepEqual([...instruction.data.subarray(14, 17)], [8, 9, 0]);
  assert.equal(instruction.data.readUInt8(17), 1);
});
