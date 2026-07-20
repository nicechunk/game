import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

import {
  clearLocalGameWallet,
  createLocalGameWallet,
  getLocalGameWalletProvider,
  getLocalGameWalletRecord,
  importLocalGameWallet,
  localGameWalletKeys,
} from "../../src/localGameWallet.js";

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let storage;

beforeEach(() => {
  storage = new MemoryLocalStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    enumerable: true,
    value: storage,
    writable: true,
  });
});

afterEach(() => {
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
  } else {
    delete globalThis.localStorage;
  }
});

test("create stores a matching address and a 64-byte Base58 secret", () => {
  const created = createLocalGameWallet();
  const decodedSecret = bs58.decode(created.secretKey);
  const restored = Keypair.fromSecretKey(decodedSecret);

  assert.equal(decodedSecret.length, 64);
  assert.equal(created.address, restored.publicKey.toBase58());
  assert.equal(storage.getItem(localGameWalletKeys.address), created.address);
  assert.equal(storage.getItem(localGameWalletKeys.secretKey), created.secretKey);
  assert.equal(storage.getItem(localGameWalletKeys.createdAt), created.createdAt);
  assert.equal(storage.getItem(localGameWalletKeys.source), "created");
});

test("wallet records hide the secret unless includeSecret is requested", () => {
  const created = createLocalGameWallet();
  const publicRecord = getLocalGameWalletRecord();
  const privateRecord = getLocalGameWalletRecord({ includeSecret: true });

  assert.deepEqual(publicRecord, {
    address: created.address,
    createdAt: created.createdAt,
    source: "created",
  });
  assert.equal("secretKey" in publicRecord, false);
  assert.deepEqual(privateRecord, created);
});

test("a 32-byte Base58 seed is normalized to a 64-byte secret", () => {
  const seed = deterministicSeed(7);
  assertImportedSeedIsNormalized(bs58.encode(seed), seed);
});

test("a 32-byte JSON seed is normalized to a 64-byte secret", () => {
  const seed = deterministicSeed(41);
  assertImportedSeedIsNormalized(JSON.stringify([...seed]), seed);
});

test("a valid 64-byte secret can be imported", () => {
  const original = Keypair.generate();
  const imported = importLocalGameWallet(bs58.encode(original.secretKey));

  assert.equal(imported.address, original.publicKey.toBase58());
  assert.deepEqual([...bs58.decode(imported.secretKey)], [...original.secretKey]);
  assert.equal(imported.source, "imported");
  assert.deepEqual(getLocalGameWalletRecord({ includeSecret: true }), imported);
});

test("imports reject invalid lengths, invalid Base58, and invalid 64-byte secrets", () => {
  assert.throws(
    () => importLocalGameWallet(bs58.encode(new Uint8Array(31))),
    /64-byte secret key or 32-byte seed/,
  );
  assert.throws(() => importLocalGameWallet("0OIl"), /Non-base58 character/i);

  const invalidSecret = Uint8Array.from(Keypair.generate().secretKey);
  invalidSecret[63] ^= 1;
  assert.throws(
    () => importLocalGameWallet(bs58.encode(invalidSecret)),
    /provided secretKey is invalid/i,
  );
});

test("provider partial-signs one transaction and transaction batches", async () => {
  const created = createLocalGameWallet();
  const provider = getLocalGameWalletProvider();
  const calls = [];
  const single = fakeTransaction("single", calls);

  const signedSingle = await provider.signTransaction(single);
  assert.equal(signedSingle, single);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].transaction, "single");
  assert.equal(calls[0].signer.publicKey.toBase58(), created.address);

  const batch = [fakeTransaction("first", calls), fakeTransaction("second", calls)];
  const signedBatch = await provider.signAllTransactions(batch);
  assert.equal(signedBatch, batch);
  assert.deepEqual(
    calls.slice(1).map(({ transaction, signer }) => ({
      transaction,
      address: signer.publicKey.toBase58(),
    })),
    [
      { transaction: "first", address: created.address },
      { transaction: "second", address: created.address },
    ],
  );
});

test("provider disconnect preserves the stored wallet", async () => {
  createLocalGameWallet();
  const before = storage.entries();
  const provider = getLocalGameWalletProvider();

  assert.equal(await provider.disconnect(), undefined);
  assert.deepEqual(storage.entries(), before);
  assert.notEqual(getLocalGameWalletRecord({ includeSecret: true }), null);
});

test("clear removes exactly the four local wallet keys", () => {
  for (const [index, key] of Object.values(localGameWalletKeys).entries()) {
    storage.setItem(key, `wallet-value-${index}`);
  }
  storage.setItem("nicechunk.language", "en");
  storage.setItem("unrelated.application.key", "keep-me");

  clearLocalGameWallet();

  for (const key of Object.values(localGameWalletKeys)) {
    assert.equal(storage.getItem(key), null);
  }
  assert.equal(storage.getItem("nicechunk.language"), "en");
  assert.equal(storage.getItem("unrelated.application.key"), "keep-me");
  assert.deepEqual(storage.removeCalls, Object.values(localGameWalletKeys));
});

function assertImportedSeedIsNormalized(input, seed) {
  const expected = Keypair.fromSeed(seed);
  const imported = importLocalGameWallet(input);
  const normalizedSecret = bs58.decode(imported.secretKey);

  assert.equal(normalizedSecret.length, 64);
  assert.deepEqual([...normalizedSecret], [...expected.secretKey]);
  assert.equal(imported.address, expected.publicKey.toBase58());
  assert.equal(imported.source, "imported");
}

function deterministicSeed(offset) {
  return Uint8Array.from({ length: 32 }, (_, index) => (offset + index * 13) % 256);
}

function fakeTransaction(name, calls) {
  return {
    partialSign(signer) {
      calls.push({ transaction: name, signer });
    },
  };
}

class MemoryLocalStorage {
  #values = new Map();

  removeCalls = [];

  getItem(key) {
    const normalizedKey = String(key);
    return this.#values.has(normalizedKey) ? this.#values.get(normalizedKey) : null;
  }

  setItem(key, value) {
    this.#values.set(String(key), String(value));
  }

  removeItem(key) {
    const normalizedKey = String(key);
    this.removeCalls.push(normalizedKey);
    this.#values.delete(normalizedKey);
  }

  entries() {
    return [...this.#values.entries()];
  }
}
