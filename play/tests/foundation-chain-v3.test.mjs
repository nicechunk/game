import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import {
  decodeBuildSite,
  decodeFoundationChunk,
  deriveGlobalConfigPda,
  encodeBeginBuildingInstructionData,
  loadOwnedFoundations,
} from "../../src/chain/nicechunkChain.js";

test("FoundationChunk v3 decodes chunk-aligned records and rejects v2 state", () => {
  const globalConfig = deriveGlobalConfigPda();
  const capacity = 8;
  const headerLength = 56;
  const recordLength = 58;
  const data = Buffer.alloc(headerLength + capacity * recordLength);
  data.write("NCKFCI03", 0, "utf8");
  data.writeUInt8(3, 8);
  data.writeUInt8(9, 9);
  data.writeUInt16LE(1, 10);
  data.writeUInt16LE(capacity, 12);
  globalConfig.toBuffer().copy(data, 16);
  data.writeInt32LE(-3, 48);
  data.writeInt32LE(4, 52);

  const owner = PublicKey.unique();
  owner.toBuffer().copy(data, headerLength);
  data.writeBigUInt64LE(99n, headerLength + 32);
  data.writeInt32LE(-48, headerLength + 40);
  data.writeInt32LE(64, headerLength + 44);
  data.writeInt16LE(100, headerLength + 48);
  data.writeUInt32LE(32, headerLength + 50);
  data.writeUInt32LE(16, headerLength + 54);

  const records = decodeFoundationChunk(data, { chunkX: -3, chunkZ: 4, address: "foundation-index" });
  assert.equal(records.length, 1);
  assert.equal(records[0].width, 32);
  assert.equal(records[0].depth, 16);
  assert.equal(records[0].sourcePda, "foundation-index");

  assert.throws(() => decodeFoundationChunk(data.subarray(0, data.length - 1)), /capacity or record count/);
  const retired = Buffer.from(data);
  retired.write("NCKFCI02", 0, "utf8");
  retired.writeUInt8(2, 8);
  assert.throws(() => decodeFoundationChunk(retired), /Invalid FoundationChunk/);
});

test("BuildSite v3 records contract reservation state and rejects v2 land", () => {
  const data = Buffer.alloc(160);
  const owner = PublicKey.unique();
  data.write("NCKSITE3", 0, "utf8");
  data.writeUInt8(3, 8);
  data.writeUInt8(1, 9);
  data.writeUInt8(1, 10);
  data.writeUInt8(1, 11);
  data.writeUInt32LE(4, 12);
  owner.toBuffer().copy(data, 16);
  deriveGlobalConfigPda().toBuffer().copy(data, 48);
  data.writeBigUInt64LE(99n, 80);
  data.writeInt32LE(-32, 88);
  data.writeInt32LE(48, 92);
  data.writeInt16LE(100, 96);
  data.writeUInt32LE(32, 100);
  data.writeUInt32LE(32, 104);
  data.writeBigUInt64LE(10n, 108);
  data.writeBigUInt64LE(12n, 124);
  data.writeBigUInt64LE(4n, 132);
  data.writeBigUInt64LE(4n, 140);

  const site = decodeBuildSite(data);
  assert.equal(site.accountVersion, 3);
  assert.equal(site.owner, owner.toBase58());
  assert.equal(site.globalConfig, deriveGlobalConfigPda().toBase58());
  assert.equal(site.status, "active");
  assert.equal(site.contractType, 1);
  assert.equal(site.landContractCount, 4);
  assert.equal(site.registeredChunks, "4");
  assert.equal(site.totalChunks, "4");
  assert.equal(site.hasActiveGeometry, true);

  const retired = Buffer.from(data);
  retired.write("NCKSITE2", 0, "utf8");
  retired.writeUInt8(2, 8);
  assert.throws(() => decodeBuildSite(retired), /Invalid BuildSite/);

  const wrongConfig = Buffer.from(data);
  PublicKey.unique().toBuffer().copy(wrongConfig, 48);
  assert.throws(() => decodeBuildSite(wrongConfig), /Invalid BuildSite GlobalConfig/);

  const oversized = Buffer.from(data);
  oversized.writeUInt32LE(4_097, 12);
  oversized.writeUInt32LE(4_097 * 16, 100);
  oversized.writeUInt32LE(16, 104);
  oversized.writeBigUInt64LE(4_097n, 132);
  oversized.writeBigUInt64LE(4_097n, 140);
  assert.throws(() => decodeBuildSite(oversized), /at most 4096 contracts/);

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

test("owned land discovery filters by v3 magic and version before decoding", async () => {
  const owner = PublicKey.unique();
  let request = null;
  const conn = {
    getProgramAccounts: async (_programId, options) => {
      request = options;
      return [];
    },
  };

  assert.deepEqual(await loadOwnedFoundations(owner.toBase58(), conn), []);
  assert.equal(request.filters[0].dataSize, 160);
  assert.deepEqual(request.filters[1], {
    memcmp: {
      offset: 0,
      bytes: bs58.encode(Buffer.concat([Buffer.from("NCKSITE3"), Buffer.from([3])])),
    },
  });
  assert.deepEqual(request.filters[2], {
    memcmp: { offset: 16, bytes: owner.toBase58() },
  });
});
