import assert from "node:assert/strict";
import test from "node:test";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  BUILDING_MAX_WRITE_LENGTH,
  decodeBuildingManifest,
  buildingUploadWritePlan,
  decodeBuildingShard,
  encodeBeginBuildingInstructionData,
} from "../../src/chain/nicechunkChain.js";
import { createPlayBuildingCache } from "../play-building-cache.js";

test("incomplete building shards are readable only for resumable uploads", () => {
  const data = Buffer.alloc(64 + 10);
  data.write("NCKBDT01", 0, "ascii");
  data.writeUInt8(1, 8);
  data.writeUInt8(0, 10);
  data.writeUInt16LE(10, 12);
  data.writeUInt16LE(4, 14);
  data.fill(7, 16, 48);
  data.writeBigUInt64LE(42n, 48);
  data.writeUInt32LE(3, 56);
  Buffer.from([1, 2, 3, 4]).copy(data, 64);

  assert.throws(() => decodeBuildingShard(data), /Incomplete BuildingShard/);
  const shard = decodeBuildingShard(data, "shard", { allowIncomplete: true });
  assert.equal(shard.uploadedLen, 4);
  assert.equal(shard.payloadLen, 10);
  assert.deepEqual([...shard.payload], [1, 2, 3, 4]);
});

test("building manifests preserve signed X/Z placement offsets", () => {
  const data = Buffer.alloc(160);
  data.write("NCKBLD02", 0, "ascii");
  data.writeUInt8(2, 8);
  data.writeUInt8(1, 9);
  data.writeUInt8(1, 10);
  data.writeUInt8(3, 11);
  data.writeUInt8(1, 12);
  data.writeUInt16LE(1, 14);
  Keypair.generate().publicKey.toBuffer().copy(data, 16);
  Keypair.generate().publicKey.toBuffer().copy(data, 48);
  data.writeBigUInt64LE(42n, 80);
  data.writeUInt32LE(3, 88);
  data.writeUInt32LE(13, 92);
  data.fill(7, 96, 128);
  data.writeUInt16LE(4, 128);
  data.writeUInt16LE(5, 130);
  data.writeUInt16LE(6, 132);
  data.writeBigUInt64LE(11n, 136);
  data.writeBigUInt64LE(12n, 144);

  const centered = decodeBuildingManifest(data);
  assert.equal(centered.offsetX, 0, "existing manifests default to centered placement");
  assert.equal(centered.offsetZ, 0, "existing manifests default to centered placement");

  data.writeInt32LE(-17, 152);
  data.writeInt32LE(23, 156);
  const shifted = decodeBuildingManifest(data);
  assert.equal(shifted.offsetX, -17);
  assert.equal(shifted.offsetZ, 23);
});

test("BeginBuilding encodes signed placement offsets in the extended payload", () => {
  const data = encodeBeginBuildingInstructionData({
    foundationId: 42n,
    revision: 3,
    quarterTurns: 2,
    payloadLen: 13,
    expectedHash: Buffer.alloc(32, 7),
    offsetX: -17,
    offsetZ: 23,
  });

  assert.equal(data.length, 58);
  assert.equal(data.readUInt8(0), 2);
  assert.equal(data.readBigUInt64LE(1), 42n);
  assert.equal(data.readUInt32LE(9), 3);
  assert.equal(data.readUInt8(13), 2);
  assert.equal(data.readUInt32LE(14), 13);
  assert.deepEqual(data.subarray(18, 50), Buffer.alloc(32, 7));
  assert.equal(data.readInt32LE(50), -17);
  assert.equal(data.readInt32LE(54), 23);
});

test("building writes use the contract maximum and resume from legacy boundaries", () => {
  const fullPlan = buildingUploadWritePlan(8192);
  assert.equal(BUILDING_MAX_WRITE_LENGTH, 700);
  assert.equal(fullPlan.length, 12);
  assert.deepEqual(fullPlan[0], { offset: 0, end: 700 });
  assert.deepEqual(fullPlan.at(-1), { offset: 7700, end: 8192 });

  const resumed = buildingUploadWritePlan(8192, 1280);
  assert.deepEqual(resumed[0], { offset: 1280, end: 1980 });
  assert.deepEqual(resumed.at(-1), { offset: 7580, end: 8192 });
  for (let index = 1; index < resumed.length; index += 1) {
    assert.equal(resumed[index].offset, resumed[index - 1].end);
  }
  assert.deepEqual(buildingUploadWritePlan(8192, 8192), []);
});

test("maximum building writes fit the Solana legacy transaction packet", () => {
  const authority = Keypair.generate();
  const accountKeys = [
    authority.publicKey,
    ...Array.from({ length: 6 }, () => Keypair.generate().publicKey),
    SystemProgram.programId,
  ];
  const instruction = new TransactionInstruction({
    programId: new PublicKey("39UMTUWXQkuomkFNbDPF5NGZnJmG6pDkJHVSkZyqVwWx"),
    keys: accountKeys.map((pubkey, index) => ({
      pubkey,
      isSigner: index === 0,
      isWritable: index === 0 || index === 4 || index === 5,
    })),
    data: Buffer.alloc(16 + BUILDING_MAX_WRITE_LENGTH),
  });
  const transaction = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
    instruction,
  );
  transaction.feePayer = authority.publicKey;
  transaction.recentBlockhash = Keypair.generate().publicKey.toBase58();
  transaction.sign(authority);
  const serialized = transaction.serialize();
  assert.ok(serialized.length <= 1232, `serialized write transaction is ${serialized.length} bytes`);
});

test("building cache batches preserve input order and misses", async () => {
  const scope = `upload-test-${Date.now()}`;
  const cache = createPlayBuildingCache({ getScope: () => scope });
  const first = cacheRecord("1", "11".repeat(16));
  const second = cacheRecord("2", "22".repeat(16));
  await cache.putVerifiedBuildings([
    { record: first, building: cacheBuilding(first) },
    { record: second, building: cacheBuilding(second) },
  ]);

  const values = await cache.getBuildings([second, cacheRecord("3", "33".repeat(16)), first]);
  assert.equal(values[0].foundationId, "2");
  assert.equal(values[1], null);
  assert.equal(values[2].foundationId, "1");
});

function cacheRecord(foundationId, contentHash) {
  return {
    foundationId,
    minX: 0,
    minZ: 0,
    surfaceY: 10,
    width: 2,
    depth: 2,
    activeRevision: 1,
    contentHash,
  };
}

function cacheBuilding(record) {
  return {
    owner: "owner",
    foundationId: record.foundationId,
    revision: record.activeRevision,
    contentHash: `${record.contentHash}${"44".repeat(16)}`,
    code: "NCM3:AQ",
  };
}
