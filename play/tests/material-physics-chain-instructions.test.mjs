import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, SystemProgram } from "@solana/web3.js";

import {
  createBatchMineWithRewardsInstruction,
  createBuyMarketListingInstruction,
  createCancelMarketListingInstruction,
  createFellTreeWithRewardsInstruction,
  createMineBlockWithRewardsInstruction,
  createMigrateBackpackMassInstruction,
  createRangeMineWithRewardsInstruction,
  createTransferPlayerEquipmentSlotInstruction,
  decodeBackpack,
  deriveGlobalConfigPda,
  deriveMaterialPhysicsPda,
} from "../../src/chain/nicechunkChain.js";
import { partitionBulkMiningRanges } from "../../src/chain/bulkMiningSubmission.js";

const owner = Keypair.generate().publicKey;
const authority = Keypair.generate().publicKey;
const backpack = Keypair.generate().publicKey;
const listing = Keypair.generate().publicKey;
const materialPhysics = deriveMaterialPhysicsPda()[0];

test("browser backpack v3 decoder exposes authoritative mass fields and per-slot mass", () => {
  const data = backpackFixture();
  const decoded = decodeBackpack(data);

  assert.equal(decoded.massInitialized, true);
  assert.equal(decoded.totalMassGrams, "12550");
  assert.equal(decoded.lastMinePreMassGrams, "10000");
  assert.equal(decoded.lastMineActionId, "998877");
  assert.equal(decoded.mineSequence, "42");
  assert.equal(decoded.slots[0].massGrams, 2600);
  assert.equal(decoded.slots[1].massGrams, 625);
});

test("backpack mass migration uses the canonical MaterialPhysics PDA", () => {
  const instruction = createMigrateBackpackMassInstruction({ owner, backpack });

  assert.equal(instruction.keys.length, 4);
  assert.equal(instruction.keys[1].pubkey.toBase58(), backpack.toBase58());
  assert.equal(instruction.keys[2].pubkey.toBase58(), materialPhysics.toBase58());
  assert.equal(instruction.keys[3].pubkey.toBase58(), deriveGlobalConfigPda().toBase58());
});

test("all mining instruction variants pass MaterialPhysics at the Rust account index", () => {
  const block = { x: 1, y: 12, z: 2, blockId: 3 };
  const single = createMineBlockWithRewardsInstruction({
    authority,
    block,
    owner,
    backpack,
    expectedBlockId: block.blockId,
  });
  const batch = createBatchMineWithRewardsInstruction({ authority, blocks: [block], owner, backpack });
  const range = createRangeMineWithRewardsInstruction({
    authority,
    range: partitionBulkMiningRanges([block])[0],
    owner,
    backpack,
  });
  const tree = createFellTreeWithRewardsInstruction({
    authority,
    block,
    owner,
    backpack,
    expectedBlockId: block.blockId,
    chunks: [{ chunkX: 0, chunkZ: 0 }],
  });

  for (const instruction of [single, batch, range]) {
    assert.equal(instruction.keys.length, 13);
    assert.equal(instruction.keys[10].pubkey.toBase58(), backpack.toBase58());
    assert.equal(instruction.keys[11].pubkey.toBase58(), materialPhysics.toBase58());
    assert.equal(instruction.keys[12].pubkey.toBase58(), SystemProgram.programId.toBase58());
  }
  assert.equal(tree.keys.length, 10);
  assert.equal(tree.keys[6].pubkey.toBase58(), backpack.toBase58());
  assert.equal(tree.keys[7].pubkey.toBase58(), materialPhysics.toBase58());
  assert.equal(tree.keys[8].pubkey.toBase58(), SystemProgram.programId.toBase58());
});

test("equipment custody transfer carries MaterialPhysics in its fixed nine-account ABI", () => {
  const instruction = createTransferPlayerEquipmentSlotInstruction({
    authority: owner,
    playerProfile: Keypair.generate().publicKey,
    playerEquipment: Keypair.generate().publicKey,
    backpack,
    slot: 1,
    backpackIndex: 3,
  });

  assert.equal(instruction.keys.length, 9);
  assert.equal(instruction.keys[4].pubkey.toBase58(), materialPhysics.toBase58());
  assert.equal(instruction.keys[6].pubkey.toBase58(), backpack.toBase58());
});

test("market cancel and both purchase currencies preserve destination mass accounts", () => {
  const cancel = createCancelMarketListingInstruction({
    seller: owner,
    listing,
    sourceInventory: backpack,
  });
  assert.equal(cancel.keys.length, 7);
  assert.equal(cancel.keys[2].pubkey.toBase58(), backpack.toBase58());
  assert.equal(cancel.keys[5].pubkey.toBase58(), materialPhysics.toBase58());
  assert.equal(cancel.keys[6].pubkey.toBase58(), deriveGlobalConfigPda().toBase58());

  const seller = Keypair.generate().publicKey;
  const sol = createBuyMarketListingInstruction({
    buyer: owner,
    seller,
    listing,
    currency: "SOL",
    buyerBackpackAddress: backpack,
  });
  assert.equal(sol.keys.length, 10);
  assert.equal(sol.keys[5].pubkey.toBase58(), backpack.toBase58());
  assert.equal(sol.keys[8].pubkey.toBase58(), materialPhysics.toBase58());
  assert.equal(sol.keys[9].pubkey.toBase58(), deriveGlobalConfigPda().toBase58());

  const nck = createBuyMarketListingInstruction({
    buyer: owner,
    seller,
    listing,
    currency: "NCK",
    buyerNckToken: Keypair.generate().publicKey,
    sellerNckToken: Keypair.generate().publicKey,
    treasuryNckToken: Keypair.generate().publicKey,
    buyerBackpackAddress: backpack,
  });
  assert.equal(nck.keys.length, 13);
  assert.equal(nck.keys[8].pubkey.toBase58(), backpack.toBase58());
  assert.equal(nck.keys[11].pubkey.toBase58(), materialPhysics.toBase58());
  assert.equal(nck.keys[12].pubkey.toBase58(), deriveGlobalConfigPda().toBase58());
});

function backpackFixture() {
  const data = Buffer.alloc(8048);
  data.write("NCKBPK01", 0, "utf8");
  data.writeUInt16LE(3, 8);
  data.writeUInt8(1, 11);
  data.writeBigUInt64LE(7n, 12);
  owner.toBuffer().copy(data, 20);
  data.writeUInt8(50, 52);
  data.writeUInt8(2, 53);
  data.writeUInt8(1, 55);
  data.writeBigUInt64LE(12550n, 90);
  data.writeBigUInt64LE(10000n, 98);
  data.writeBigUInt64LE(998877n, 106);
  data.writeBigUInt64LE(42n, 114);

  const blockOffset = 128;
  data.writeUInt8(1, blockOffset);
  data.writeUInt16LE(1 << 15, blockOffset + 2);
  data.writeUInt32LE(1, blockOffset + 4);
  data.writeInt16LE((3 << 9) | 12, blockOffset + 12);
  data.writeUInt32LE(1_000_000, blockOffset + 60);
  data.writeUInt32LE(2600, blockOffset + 64);

  const itemOffset = blockOffset + 80;
  data.writeUInt8(2, itemOffset);
  data.writeUInt8(1, itemOffset + 1);
  data.writeUInt16LE(1 << 15, itemOffset + 2);
  data.writeUInt32LE(1, itemOffset + 4);
  data.writeUInt32LE(625, itemOffset + 8);
  data.writeUInt16LE(1010, itemOffset + 18);
  data.writeUInt32LE(250_000, itemOffset + 60);
  return data;
}
