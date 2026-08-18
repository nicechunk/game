import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import {
  decodeBuildSite,
  decodeFoundationChunk,
  deriveBuildingManifestPda,
  deriveBuildSitePda,
  deriveFoundationChunkPda,
  deriveGlobalConfigPda,
  deriveMarketUserPda,
  encodeBeginBuildingInstructionData,
  fetchLandContractPortfolioOnChain,
  loadFoundationsForChunks,
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

test("land contract portfolio combines blank balances with independently addressable BuildSite records", async () => {
  const owner = PublicKey.unique();
  const gameProgram = new PublicKey("6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7");
  const buildingProgram = new PublicKey("39UMTUWXQkuomkFNbDPF5NGZnJmG6pDkJHVSkZyqVwWx");
  const [marketUser, marketUserBump] = deriveMarketUserPda(owner);
  const marketUserData = Buffer.alloc(64);
  marketUserData.write("NCKMUS01", 0, "utf8");
  marketUserData.writeUInt16LE(1, 8);
  marketUserData.writeUInt8(marketUserBump, 10);
  owner.toBuffer().copy(marketUserData, 12);
  marketUserData.writeBigUInt64LE(91n, 44);
  marketUserData.writeUInt32LE(5, 52);
  marketUserData.writeUInt32LE(2, 56);

  const sites = [
    {
      pubkey: PublicKey.unique(),
      account: {
        owner: buildingProgram,
        data: buildSiteData({
          owner,
          foundationId: 12n,
          chunkX: 4,
          chunkZ: -2,
          activeRevision: 0,
          statusCode: 0,
          width: 32,
          registeredChunks: 1n,
        }),
      },
    },
    {
      pubkey: PublicKey.unique(),
      account: {
        owner: buildingProgram,
        data: buildSiteData({
          owner,
          foundationId: 2n,
          chunkX: -1,
          chunkZ: 3,
          activeRevision: 1,
        }),
      },
    },
  ];
  const conn = {
    getAccountInfo: async (address) => {
      assert.equal(address.toBase58(), marketUser.toBase58());
      return { owner: gameProgram, data: marketUserData };
    },
    getProgramAccounts: async (programId, options) => {
      assert.equal(programId.toBase58(), buildingProgram.toBase58());
      assert.deepEqual(options.filters[2], {
        memcmp: { offset: 16, bytes: owner.toBase58() },
      });
      return sites;
    },
  };

  const portfolio = await fetchLandContractPortfolioOnChain(owner, conn);
  assert.equal(portfolio.owner, owner.toBase58());
  assert.equal(portfolio.status, "ready");
  assert.equal(portfolio.blankLandContracts, 5);
  assert.equal(portfolio.reservedBlankLandContracts, 2);
  assert.equal(portfolio.registeredContractUnits, 3);
  assert.equal(portfolio.totalContractUnits, 8);
  assert.deepEqual(portfolio.registeredContracts.map((contract) => contract.foundationId), ["2", "12"]);
  assert.equal(portfolio.registeredContracts[0].sourcePda, sites[1].pubkey.toBase58());
  assert.equal(portfolio.registeredContracts[1].status, "indexing");
  assert.equal(portfolio.registeredContracts[1].registeredChunks, "1");
  assert.ok(Object.isFrozen(portfolio));
  assert.ok(Object.isFrozen(portfolio.registeredContracts));
});

test("view discovery resolves FoundationChunk indexes through BuildSite and BuildingManifest PDAs", async () => {
  const owner = PublicKey.unique();
  const foundationId = 777n;
  const chunkX = -2;
  const chunkZ = 3;
  const contentHash = Buffer.from("71".repeat(32), "hex");
  const [chunkAddress] = deriveFoundationChunkPda(chunkX, chunkZ);
  const [siteAddress] = deriveBuildSitePda(foundationId);
  const [manifestAddress] = deriveBuildingManifestPda(foundationId, 1);
  const chunkProgram = new PublicKey("GnVKn442KDTDgCyjVG7SEtCQQLjaCiLvrEZDWSU13wbj");
  const buildingProgram = new PublicKey("39UMTUWXQkuomkFNbDPF5NGZnJmG6pDkJHVSkZyqVwWx");
  const accounts = new Map([
    [chunkAddress.toBase58(), { owner: chunkProgram, data: foundationChunkData({ owner, foundationId, chunkX, chunkZ }) }],
    [siteAddress.toBase58(), { owner: buildingProgram, data: buildSiteData({ owner, foundationId, chunkX, chunkZ, activeRevision: 1 }) }],
    [manifestAddress.toBase58(), { owner: buildingProgram, data: buildingManifestData({ owner, foundationId, contentHash }) }],
  ]);
  const requests = [];
  const conn = {
    getMultipleAccountsInfo: async (addresses) => {
      requests.push(addresses.map((address) => address.toBase58()));
      return addresses.map((address) => accounts.get(address.toBase58()) ?? null);
    },
  };

  const records = await loadFoundationsForChunks([
    { chunkX, chunkZ },
    { chunkX, chunkZ },
  ], conn);
  assert.equal(records.length, 1);
  assert.equal(records[0].foundationId, foundationId.toString());
  assert.equal(records[0].contentHash, contentHash.toString("hex"));
  assert.deepEqual(requests, [
    [chunkAddress.toBase58()],
    [siteAddress.toBase58()],
    [manifestAddress.toBase58()],
  ]);
});

function foundationChunkData({ owner, foundationId, chunkX, chunkZ }) {
  const headerLength = 56;
  const recordLength = 58;
  const data = Buffer.alloc(headerLength + recordLength);
  data.write("NCKFCI03", 0, "utf8");
  data.writeUInt8(3, 8);
  data.writeUInt8(1, 9);
  data.writeUInt16LE(1, 10);
  data.writeUInt16LE(1, 12);
  deriveGlobalConfigPda().toBuffer().copy(data, 16);
  data.writeInt32LE(chunkX, 48);
  data.writeInt32LE(chunkZ, 52);
  owner.toBuffer().copy(data, headerLength);
  data.writeBigUInt64LE(foundationId, headerLength + 32);
  data.writeInt32LE(chunkX * 16, headerLength + 40);
  data.writeInt32LE(chunkZ * 16, headerLength + 44);
  data.writeInt16LE(100, headerLength + 48);
  data.writeUInt32LE(16, headerLength + 50);
  data.writeUInt32LE(16, headerLength + 54);
  return data;
}

function buildSiteData({
  owner,
  foundationId,
  chunkX,
  chunkZ,
  activeRevision,
  statusCode = 1,
  width = 16,
  depth = 16,
  registeredChunks = null,
} = {}) {
  const totalChunks = BigInt(Math.ceil(width / 16) * Math.ceil(depth / 16));
  const indexedChunks = registeredChunks === null
    ? (statusCode === 1 ? totalChunks : 0n)
    : BigInt(registeredChunks);
  const data = Buffer.alloc(160);
  data.write("NCKSITE3", 0, "utf8");
  data.writeUInt8(3, 8);
  data.writeUInt8(1, 9);
  data.writeUInt8(statusCode, 10);
  data.writeUInt8(1, 11);
  data.writeUInt32LE(Number(totalChunks), 12);
  owner.toBuffer().copy(data, 16);
  deriveGlobalConfigPda().toBuffer().copy(data, 48);
  data.writeBigUInt64LE(foundationId, 80);
  data.writeInt32LE(chunkX * 16, 88);
  data.writeInt32LE(chunkZ * 16, 92);
  data.writeInt16LE(100, 96);
  data.writeUInt32LE(width, 100);
  data.writeUInt32LE(depth, 104);
  data.writeBigUInt64LE(1n, 108);
  data.writeUInt32LE(activeRevision, 116);
  data.writeBigUInt64LE(2n, 124);
  data.writeBigUInt64LE(indexedChunks, 132);
  data.writeBigUInt64LE(totalChunks, 140);
  return data;
}

function buildingManifestData({ owner, foundationId, contentHash }) {
  const data = Buffer.alloc(160);
  data.write("NCKBLD03", 0, "utf8");
  data.writeUInt8(3, 8);
  data.writeUInt8(1, 10);
  data.writeUInt8(0, 11);
  data.writeUInt8(1, 12);
  data.writeUInt16LE(1, 14);
  owner.toBuffer().copy(data, 16);
  deriveGlobalConfigPda().toBuffer().copy(data, 48);
  data.writeBigUInt64LE(foundationId, 80);
  data.writeUInt32LE(1, 88);
  data.writeUInt32LE(1, 92);
  contentHash.copy(data, 96);
  data.writeUInt16LE(1, 128);
  data.writeUInt16LE(1, 130);
  data.writeUInt16LE(1, 132);
  data.writeBigUInt64LE(3n, 136);
  data.writeBigUInt64LE(4n, 144);
  return data;
}
