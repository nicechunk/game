import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import {
  decodeBuildSite,
  decodeFoundationChunk,
  deriveGlobalConfigPda,
  encodeBeginBuildingInstructionData,
} from "../../src/chain/nicechunkChain.js";

test("FoundationChunk V2 decodes dynamic capacity and u32 dimensions", () => {
  const globalConfig = deriveGlobalConfigPda();
  const capacity = 8;
  const headerLength = 56;
  const recordLength = 58;
  const data = Buffer.alloc(headerLength + capacity * recordLength);
  data.write("NCKFCI02", 0, "utf8");
  data.writeUInt8(2, 8);
  data.writeUInt8(9, 9);
  data.writeUInt16LE(1, 10);
  data.writeUInt16LE(capacity, 12);
  globalConfig.toBuffer().copy(data, 16);
  data.writeInt32LE(-3, 48);
  data.writeInt32LE(4, 52);

  const owner = PublicKey.unique();
  owner.toBuffer().copy(data, headerLength);
  data.writeBigUInt64LE(99n, headerLength + 32);
  data.writeInt32LE(-40, headerLength + 40);
  data.writeInt32LE(64, headerLength + 44);
  data.writeInt16LE(100, headerLength + 48);
  data.writeUInt32LE(300, headerLength + 50);
  data.writeUInt32LE(17, headerLength + 54);

  const records = decodeFoundationChunk(data, { chunkX: -3, chunkZ: 4, address: "foundation-index" });
  assert.equal(records.length, 1);
  assert.equal(records[0].width, 300);
  assert.equal(records[0].depth, 17);
  assert.equal(records[0].sourcePda, "foundation-index");

  assert.throws(() => decodeFoundationChunk(data.subarray(0, data.length - 1)), /capacity or record count/);
  const retired = Buffer.from(data);
  retired.write("NCKFCI01", 0, "utf8");
  retired.writeUInt8(1, 8);
  assert.throws(() => decodeFoundationChunk(retired), /Invalid FoundationChunk/);
});

test("BuildSite accepts only V2 and BeginBuilding always includes explicit offsets", () => {
  const data = Buffer.alloc(160);
  data.write("NCKSITE2", 0, "utf8");
  data.writeUInt8(2, 8);
  data.writeUInt8(1, 10);
  PublicKey.unique().toBuffer().copy(data, 16);
  deriveGlobalConfigPda().toBuffer().copy(data, 48);
  data.writeBigUInt64LE(99n, 80);
  data.writeInt16LE(100, 96);
  data.writeUInt32LE(2, 100);
  data.writeUInt32LE(2, 104);
  data.writeBigUInt64LE(1n, 132);
  data.writeBigUInt64LE(1n, 140);
  assert.equal(decodeBuildSite(data).accountVersion, 2);

  const retired = Buffer.alloc(136);
  retired.write("NCKSITE1", 0, "utf8");
  retired.writeUInt8(1, 8);
  assert.throws(() => decodeBuildSite(retired), /Invalid BuildSite/);

  const instructionData = encodeBeginBuildingInstructionData({
    foundationId: 99n,
    revision: 1,
    quarterTurns: 0,
    payloadLen: 3,
    expectedHash: Buffer.alloc(32),
    offsetX: -2,
    offsetZ: 3,
  });
  assert.equal(instructionData.length, 58);
  assert.equal(instructionData.readInt32LE(50), -2);
  assert.equal(instructionData.readInt32LE(54), 3);
});
