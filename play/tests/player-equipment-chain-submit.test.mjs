import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  deriveForgedItemPda,
  getNicechunkConnection,
  getEquippedBackpackStatus,
  setPlayerEquipmentSlotsOnChain,
} from "../../src/chain/nicechunkChain.js";

test("equipment submission recovers purchased models from immutable chain data", async (t) => {
  const previousStorage = globalThis.localStorage;
  const previousWindow = globalThis.window;
  const owner = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const backpack = Keypair.generate().publicKey;
  const originBackpack = Keypair.generate().publicKey;
  const itemId = 7517507680304288235n;
  const [itemPda, bump] = deriveForgedItemPda(creator, itemId);
  const modelBytes = Buffer.from([0xf0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  let hash = 0x811c9dc5;
  for (const byte of modelBytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  const programId = new PublicKey("6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7");
  const sent = [];
  let modelAvailable = true;
  const storage = new Map([["nicechunk.walletAddress", owner.toBase58()]]);
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = { solana: {
    publicKey: owner,
    network: "devnet",
    connect: async () => {},
    signAndSendTransaction: async (transaction) => {
      sent.push(transaction);
      return { signature: "simulated-equipment-signature" };
    },
  } };
  try {
    const backpackData = Buffer.alloc(8048);
    backpackData.write("NCKBPK01");
    backpackData.writeUInt16LE(4, 8);
    backpackData[11] = 1;
    backpackData.writeBigUInt64LE(1n, 12);
    owner.toBuffer().copy(backpackData, 20);
    backpackData[52] = 50;
    backpackData[53] = 1;
    backpackData[55] = 1;
    backpackData[128] = 2;
    backpackData[129] = 2;
    backpackData.writeUInt16LE(1 << 15, 130);
    backpackData.writeUInt32LE(1, 132);
    backpackData.writeUInt16LE(8, 146);
    backpackData.writeBigUInt64LE(itemId, 148);
    itemPda.toBuffer().copy(backpackData, 156);
    backpackData.writeUInt32LE(hash, 204);
    const forgedData = Buffer.alloc(752);
    forgedData.write("NCKFGI01");
    forgedData.writeUInt16LE(1, 8);
    forgedData[10] = bump;
    forgedData[11] = 1;
    forgedData.writeBigUInt64LE(itemId, 12);
    creator.toBuffer().copy(forgedData, 20);
    originBackpack.toBuffer().copy(forgedData, 52);
    forgedData.writeUInt32LE(hash, 84);
    forgedData.writeUInt16LE(modelBytes.length, 88);
    modelBytes.copy(forgedData, 96);
    const conn = getNicechunkConnection();
    t.mock.method(conn, "getAccountInfo", async (address) => address.equals(backpack)
      ? { owner: programId, data: backpackData }
      : null);
    t.mock.method(conn, "getMultipleAccountsInfo", async (addresses) => addresses.map((address) => (
      address.equals(itemPda) && modelAvailable ? { owner: programId, data: forgedData } : null
    )));
    t.mock.method(conn, "getLatestBlockhash", async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100,
    }));
    t.mock.method(conn, "getSignatureStatuses", async () => ({ value: [{ err: null, confirmationStatus: "confirmed" }] }));
    storage.set(`nicechunk.equippedBackpack.v1.${owner.toBase58()}`, JSON.stringify({
      backpack: backpack.toBase58(), backpackId: "1", programId: programId.toBase58(),
    }));
    const status = await getEquippedBackpackStatus();
    assert.equal(status.equipped, true);
    assert.deepEqual(status.backpack.slots[0].modelBytes, [...modelBytes],
      "the normal UI backpack status read must include purchased appearance before any equipment transaction");
    const change = (bytes) => [{ slot: 2, reference: {
      sourceType: "backpack", backpackAddress: backpack.toBase58(), backpackIndex: 0,
      chainItemId: itemId.toString(), itemCode: 8, itemPda: itemPda.toBase58(), modelBytes: bytes,
    } }];

    for (const cachedBytes of [[], [0xf0, 9, 8]]) {
      const result = await setPlayerEquipmentSlotsOnChain(change(cachedBytes));
      assert.equal(result.submitted, true);
      assert.equal(result.changes[0].modelByteLength, modelBytes.length);
      const instruction = sent.at(-1).instructions[1];
      assert.equal(instruction.data.readUInt16LE(3), modelBytes.length);
      assert.deepEqual(instruction.data.subarray(5), modelBytes);
    }

    modelAvailable = false;
    const sentBeforeFailure = sent.length;
    await assert.rejects(setPlayerEquipmentSlotsOnChain(change([])), /equipment-model-unavailable/);
    assert.equal(sent.length, sentBeforeFailure, "missing model must be detected before requesting a signature");

    const result = await setPlayerEquipmentSlotsOnChain(change(modelBytes));
    assert.equal(result.submitted, true, "a hash-verified cached model remains usable during hydration failure");
    assert.deepEqual(sent.at(-1).instructions[1].data.subarray(5), modelBytes);
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
