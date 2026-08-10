import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, SystemProgram } from "@solana/web3.js";

import {
  PLACEMENT_SOURCE_EQUIPMENT,
  createMinePlacedBlockWithRewardsInstruction,
  createPlaceBlockInstruction,
  decodeChunkPlacedDeltas,
  deriveChunkBrokenPda,
  deriveChunkPlacedPda,
  deriveMaterialPhysicsPda,
  derivePlayerEquipmentPda,
  isCanonicalPlaceableBlockId,
} from "../../src/chain/nicechunkChain.js";

test("placement accepts only canonical blocking resource ids", () => {
  for (const blockId of [1, 12, 15, 21, 23, 27, 32, 44, 45, 46, 47]) {
    assert.equal(isCanonicalPlaceableBlockId(blockId), true, `block ${blockId} should be placeable`);
  }
  for (const blockId of [0, 16, 17, 18, 19, 20, 28, 31, 33, 37, 43, 48, 53, 54, 65_535]) {
    assert.equal(isCanonicalPlaceableBlockId(blockId), false, `block ${blockId} should be rejected`);
  }
});

test("block placement submits an exact inventory slot snapshot to ChunkPlaced", () => {
  const authority = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const backpack = Keypair.generate().publicKey;
  const expectedSlot = Buffer.alloc(80, 0x5a);
  const target = { x: -1, y: 80, z: 33 };
  const anchor = { x: 0, y: 80, z: 33 };
  const instruction = createPlaceBlockInstruction({
    authority,
    owner,
    backpack,
    target,
    anchor,
    sourceKind: PLACEMENT_SOURCE_EQUIPMENT,
    sourceIndex: 7,
    expectedSlot,
  });

  assert.equal(instruction.data.length, 103);
  assert.equal(instruction.data.readUInt8(0), 14);
  assert.equal(instruction.data.readInt32LE(1), target.x);
  assert.equal(instruction.data.readInt16LE(5), target.y);
  assert.equal(instruction.data.readInt32LE(7), target.z);
  assert.equal(instruction.data.readInt32LE(11), anchor.x);
  assert.equal(instruction.data.readInt16LE(15), anchor.y);
  assert.equal(instruction.data.readInt32LE(17), anchor.z);
  assert.equal(instruction.data.readUInt8(21), PLACEMENT_SOURCE_EQUIPMENT);
  assert.equal(instruction.data.readUInt8(22), 7);
  assert.equal(instruction.data.subarray(23).equals(expectedSlot), true);
  assert.equal(instruction.keys.length, 15);
  assert.equal(instruction.keys[4].pubkey.toBase58(), deriveChunkPlacedPda(-1, 2)[0].toBase58());
  assert.equal(instruction.keys[5].pubkey.toBase58(), deriveChunkBrokenPda(0, 2)[0].toBase58());
  assert.equal(instruction.keys[6].pubkey.toBase58(), deriveChunkPlacedPda(0, 2)[0].toBase58());
  assert.equal(instruction.keys[10].pubkey.toBase58(), backpack.toBase58());
  assert.equal(instruction.keys[11].pubkey.toBase58(), deriveMaterialPhysicsPda()[0].toBase58());
  assert.equal(instruction.keys[13].pubkey.toBase58(), derivePlayerEquipmentPda(owner)[0].toBase58());
  assert.equal(instruction.keys[14].pubkey.toBase58(), SystemProgram.programId.toBase58());
  assert.throws(() => createPlaceBlockInstruction({
    authority,
    owner,
    backpack,
    target,
    anchor,
    sourceKind: PLACEMENT_SOURCE_EQUIPMENT,
    sourceIndex: 7,
    expectedSlot: Buffer.alloc(79),
  }), /exactly 80 bytes/);
  assert.throws(() => createPlaceBlockInstruction({
    authority,
    owner,
    backpack,
    target,
    anchor: { x: 1, y: 80, z: 33 },
    sourceKind: PLACEMENT_SOURCE_EQUIPMENT,
    sourceIndex: 7,
    expectedSlot,
  }), /exactly one block face/);
});

test("placed-block mining addresses the sparse placement PDA and exact block id", () => {
  const authority = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const backpack = Keypair.generate().publicKey;
  const block = { x: 31, y: -20, z: -1 };
  const instruction = createMinePlacedBlockWithRewardsInstruction({
    authority,
    owner,
    backpack,
    block,
    actionId: 9n,
    expectedBlockId: 14,
  });

  assert.equal(instruction.data.length, 21);
  assert.equal(instruction.data.readUInt8(0), 16);
  assert.equal(instruction.data.readBigUInt64LE(1), 9n);
  assert.equal(instruction.data.readInt32LE(9), block.x);
  assert.equal(instruction.data.readInt16LE(13), block.y);
  assert.equal(instruction.data.readInt32LE(15), block.z);
  assert.equal(instruction.data.readUInt16LE(19), 14);
  assert.equal(instruction.keys.length, 12);
  assert.equal(instruction.keys[4].pubkey.toBase58(), deriveChunkPlacedPda(1, -1)[0].toBase58());
  assert.equal(instruction.keys[8].pubkey.toBase58(), backpack.toBase58());
});

test("ChunkPlaced decoding preserves block identity and physical volume", () => {
  const bytes = chunkPlacedAccount({ localX: 15, localZ: 2, y: -31, blockId: 14, volumeMm3: 625_001 });
  const [placed] = decodeChunkPlacedDeltas(bytes, -2, 3, -32);

  assert.deepEqual({
    x: placed.x,
    y: placed.y,
    z: placed.z,
    blockId: placed.blockId,
    volumeMm3: placed.volumeMm3,
  }, {
    x: -17,
    y: -31,
    z: 50,
    blockId: 14,
    volumeMm3: 625_001,
  });

  const duplicate = Buffer.concat([bytes, bytes.subarray(16, 25)]);
  duplicate.writeUInt16LE(2, 6);
  duplicate.writeUInt16LE(2, 8);
  assert.throws(() => decodeChunkPlacedDeltas(duplicate, -2, 3, -32), /Duplicate/);

  const liquid = chunkPlacedAccount({ localX: 1, localZ: 1, y: -31, blockId: 20, volumeMm3: 1_000_000 });
  assert.throws(() => decodeChunkPlacedDeltas(liquid, 0, 0, -32), /Invalid ChunkPlaced record/);
});

function chunkPlacedAccount({ localX, localZ, y, blockId, volumeMm3 }) {
  const bytes = Buffer.alloc(25);
  bytes.write("NCPB", 0, "utf8");
  bytes.writeUInt8(1, 4);
  bytes.writeUInt16LE(1, 6);
  bytes.writeUInt16LE(1, 8);
  bytes.writeInt16LE(-32, 10);
  const packed = localX | (localZ << 4) | ((y + 32) << 8);
  bytes.writeUIntLE(packed, 16, 3);
  bytes.writeUInt16LE(blockId, 19);
  bytes.writeUInt32LE(volumeMm3, 21);
  return bytes;
}
