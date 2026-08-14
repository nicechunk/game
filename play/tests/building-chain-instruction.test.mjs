import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  createBuildSiteInstruction,
  createCancelBuildSiteIndexingInstruction,
  createRegisterBuildSiteChunksInstruction,
  deriveBuildSitePda,
  deriveFoundationChunkPda,
  deriveGlobalConfigPda,
  deriveLandContractAuthorityPda,
  deriveMarketUserPda,
  derivePlayerProfilePda,
  derivePlayerSessionPda,
} from "../../src/chain/nicechunkChain.js";

const BUILDING_PROGRAM = new PublicKey("39UMTUWXQkuomkFNbDPF5NGZnJmG6pDkJHVSkZyqVwWx");
const CHUNK_PROGRAM = new PublicKey("GnVKn442KDTDgCyjVG7SEtCQQLjaCiLvrEZDWSU13wbj");
const MARKET_PROGRAM = new PublicKey("6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7");

test("land registration reserves contracts through the exact v3 BuildSite account layout", () => {
  const authority = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const foundationId = 1_871_540_354_255_386_112n;
  const globalConfig = deriveGlobalConfigPda();
  const [buildSite] = deriveBuildSitePda(foundationId);
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [marketUser] = deriveMarketUserPda(owner);
  const [landContractAuthority] = deriveLandContractAuthorityPda();
  const foundation = { minX: 128, surfaceY: 100, minZ: -32, width: 32, depth: 16 };

  const instruction = createBuildSiteInstruction({
    authority,
    owner,
    foundationId,
    foundation,
  });

  assert.equal(instruction.programId.toBase58(), BUILDING_PROGRAM.toBase58());
  assert.deepEqual(instruction.keys.map((key) => key.pubkey.toBase58()), [
    authority.toBase58(),
    playerProfile.toBase58(),
    playerSession.toBase58(),
    buildSite.toBase58(),
    globalConfig.toBase58(),
    SystemProgram.programId.toBase58(),
    owner.toBase58(),
    marketUser.toBase58(),
    landContractAuthority.toBase58(),
    MARKET_PROGRAM.toBase58(),
  ]);
  assert.deepEqual(instruction.keys.map((key) => key.isWritable), [
    true, false, false, true, false, false, false, true, false, false,
  ]);
  assert.equal(instruction.data.length, 27);
  assert.equal(instruction.data.readUInt8(0), 0);
  assert.equal(instruction.data.readBigUInt64LE(1), foundationId);
  assert.equal(instruction.data.readInt32LE(9), foundation.minX);
  assert.equal(instruction.data.readInt16LE(13), foundation.surfaceY);
  assert.equal(instruction.data.readInt32LE(15), foundation.minZ);
  assert.equal(instruction.data.readUInt32LE(19), foundation.width);
  assert.equal(instruction.data.readUInt32LE(23), foundation.depth);
});

test("land registration accepts only chunk-aligned 16 x 16 geometry", () => {
  const common = {
    authority: Keypair.generate().publicKey,
    owner: Keypair.generate().publicKey,
    foundationId: 42n,
  };
  assert.doesNotThrow(() => createBuildSiteInstruction({
    ...common,
    foundation: { minX: -16, minZ: 32, surfaceY: 64, width: 16, depth: 16 },
  }));
  for (const foundation of [
    { minX: 1, minZ: 0, surfaceY: 64, width: 16, depth: 16 },
    { minX: 0, minZ: 1, surfaceY: 64, width: 16, depth: 16 },
    { minX: 0, minZ: 0, surfaceY: 64, width: 15, depth: 16 },
    { minX: 0, minZ: 0, surfaceY: 64, width: 16, depth: 17 },
  ]) {
    assert.throws(() => createBuildSiteInstruction({ ...common, foundation }), /complete 16 x 16 chunks/);
  }
});

test("chunk registration indexes a multi-contract parcel in deterministic batches", () => {
  const authority = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const foundation = {
    foundationId: "77",
    status: "indexing",
    registeredChunks: "0",
    totalChunks: "6",
    minX: 16,
    minZ: 32,
    surfaceY: 70,
    width: 48,
    depth: 32,
  };

  const instruction = createRegisterBuildSiteChunksInstruction({ authority, owner, foundation });
  const expectedChunks = [[1, 2], [2, 2], [3, 2], [1, 3]]
    .map(([chunkX, chunkZ]) => deriveFoundationChunkPda(chunkX, chunkZ)[0].toBase58());

  assert.equal(instruction.data.readUInt8(0), 1);
  assert.equal(instruction.data.readBigUInt64LE(1), 77n);
  assert.equal(instruction.keys.length, 16);
  assert.equal(instruction.keys[6].pubkey.toBase58(), CHUNK_PROGRAM.toBase58());
  assert.deepEqual(instruction.keys.slice(12).map((key) => key.pubkey.toBase58()), expectedChunks);
  assert.ok(instruction.keys.slice(12).every((key) => key.isWritable));

  const finalBatch = createRegisterBuildSiteChunksInstruction({
    authority,
    owner,
    foundation: { ...foundation, registeredChunks: "4" },
  });
  assert.deepEqual(finalBatch.keys.slice(12).map((key) => key.pubkey.toBase58()), [
    deriveFoundationChunkPda(2, 3)[0].toBase58(),
    deriveFoundationChunkPda(3, 3)[0].toBase58(),
  ]);
});

test("failed land registration rolls chunk indexes back in reverse order and active land is immutable", () => {
  const authority = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const foundation = {
    foundationId: "77",
    status: "canceling",
    registeredChunks: "6",
    totalChunks: "6",
    minX: 16,
    minZ: 32,
    surfaceY: 70,
    width: 48,
    depth: 32,
  };
  const instruction = createCancelBuildSiteIndexingInstruction({ authority, owner, foundation });
  assert.equal(instruction.data.readUInt8(0), 6);
  assert.equal(instruction.data.readBigUInt64LE(1), 77n);
  assert.deepEqual(instruction.keys.slice(12).map((key) => key.pubkey.toBase58()), [
    deriveFoundationChunkPda(3, 3)[0].toBase58(),
    deriveFoundationChunkPda(2, 3)[0].toBase58(),
    deriveFoundationChunkPda(1, 3)[0].toBase58(),
    deriveFoundationChunkPda(3, 2)[0].toBase58(),
  ]);
  assert.throws(() => createCancelBuildSiteIndexingInstruction({
    authority,
    owner,
    foundation: { ...foundation, status: "active" },
  }), /Active land cannot be canceled/);
});
