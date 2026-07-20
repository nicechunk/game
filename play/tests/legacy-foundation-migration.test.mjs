import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";

import { decodeBuildSite } from "../../src/chain/nicechunkChain.js";

test("the deployed 136-byte legacy foundation remains readable for migration", () => {
  const data = Buffer.alloc(136);
  data.write("NCKSITE1", 0, "utf8");
  data.writeUInt8(1, 8);
  data.writeUInt8(1, 10);
  PublicKey.unique().toBuffer().copy(data, 16);
  PublicKey.unique().toBuffer().copy(data, 48);
  data.writeBigUInt64LE(12_065_219_072_965_175_186n, 80);
  data.writeInt32LE(748, 88);
  data.writeInt32LE(781, 92);
  data.writeInt16LE(136, 96);
  data.writeUInt32LE(12, 100);
  data.writeUInt32LE(8, 104);
  data.writeBigUInt64LE(475_380_541n, 108);
  data.writeBigUInt64LE(475_380_541n, 124);

  const foundation = decodeBuildSite(data, "legacy-pda");

  assert.equal(foundation.foundationId, "12065219072965175186");
  assert.equal(foundation.minX, 748);
  assert.equal(foundation.minZ, 781);
  assert.equal(foundation.surfaceY, 136);
  assert.equal(foundation.width, 12);
  assert.equal(foundation.depth, 8);
  assert.equal(foundation.status, "active");
  assert.equal(foundation.sourcePda, "legacy-pda");
});
