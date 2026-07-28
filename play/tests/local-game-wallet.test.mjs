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
  localGameWalletImportErrorCodes,
  localGameWalletImportMaxCharacters,
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
  assertSecretTextEqual(
    storage.getItem(localGameWalletKeys.secretKey),
    created.secretKey,
    "stored secret should match the generated secret",
  );
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
  assertWalletRecordMatches(privateRecord, created);
});

test("an explicitly labeled 32-byte Base58 seed is normalized to a 64-byte secret", () => {
  const seed = throwawaySeed();
  assertImportedSeedIsNormalized(JSON.stringify({
    type: "nicechunk-game-wallet-seed",
    version: 1,
    seed: bs58.encode(seed),
  }), seed);
});

test("explicit seed records reject arrays and extra fields", () => {
  const seed = throwawaySeed();
  assertImportError(
    JSON.stringify({ type: "nicechunk-game-wallet-seed", version: 1, seed: [...seed] }),
    localGameWalletImportErrorCodes.invalidSeedRecord,
  );
  assertImportError(
    JSON.stringify({
      type: "nicechunk-game-wallet-seed",
      version: 1,
      seed: bs58.encode(seed),
      label: "unexpected",
    }),
    localGameWalletImportErrorCodes.invalidSeedRecord,
  );
  assertImportError(
    JSON.stringify({
      type: "nicechunk-game-wallet-seed",
      version: 1,
      seed: ` ${bs58.encode(seed)}`,
    }),
    localGameWalletImportErrorCodes.invalidSeedRecord,
  );
});

test("a valid 64-byte secret can be imported", () => {
  const original = Keypair.generate();
  const imported = importLocalGameWallet(bs58.encode(original.secretKey));

  assert.equal(imported.address, original.publicKey.toBase58());
  assertSecretBytesEqual(
    bs58.decode(imported.secretKey),
    original.secretKey,
    "imported secret bytes should match the supplied throwaway key",
  );
  assert.equal(imported.source, "imported");
  assertWalletRecordMatches(getLocalGameWalletRecord({ includeSecret: true }), imported);
});

test("quoted Base58 and a strict JSON array import the same 64-byte secret", () => {
  const original = Keypair.generate();
  const encoded = bs58.encode(original.secretKey);
  const inputs = [
    JSON.stringify(encoded),
    JSON.stringify([...original.secretKey]),
  ];

  for (const input of inputs) {
    const imported = importLocalGameWallet(input);
    assert.equal(imported.address, original.publicKey.toBase58());
    assertSecretTextEqual(imported.secretKey, encoded, "equivalent import formats should preserve the secret");
  }
});

test("BOM, outer whitespace, and multiline strict JSON are accepted", () => {
  const original = Keypair.generate();
  const encoded = bs58.encode(original.secretKey);
  const inputs = [
    `\uFEFF \r\n${encoded}\t `,
    `\uFEFF \n${JSON.stringify([...original.secretKey], null, 2)}\r\n `,
  ];

  for (const input of inputs) {
    const imported = importLocalGameWallet(input);
    assert.equal(imported.address, original.publicKey.toBase58());
    assertSecretTextEqual(imported.secretKey, encoded, "outer whitespace should not change the imported secret");
  }
});

test("an explicitly labeled seed rejects unknown versions and incorrect lengths", () => {
  assertImportError(
    JSON.stringify({
      type: "nicechunk-game-wallet-seed",
      version: 2,
      seed: bs58.encode(throwawaySeed()),
    }),
    localGameWalletImportErrorCodes.invalidSeedRecord,
  );
  assertImportError(
    JSON.stringify({
      type: "nicechunk-game-wallet-seed",
      version: 1,
      seed: bs58.encode(new Uint8Array(31)),
    }),
    localGameWalletImportErrorCodes.invalidSeedLength,
  );
});

test("imports reject ambiguous 32-byte values, invalid Base58, and unsupported encodings", () => {
  const publicAddress = Keypair.generate().publicKey.toBase58();
  assertImportError(publicAddress, localGameWalletImportErrorCodes.ambiguous32ByteValue);
  assertImportError(
    JSON.stringify([...bs58.decode(publicAddress)]),
    localGameWalletImportErrorCodes.ambiguous32ByteValue,
  );
  assertImportError(bs58.encode(new Uint8Array(31)), localGameWalletImportErrorCodes.invalidLength);
  assertImportError("0OIl", localGameWalletImportErrorCodes.invalidCharacters);
  assertImportError(`1234\n5678`, localGameWalletImportErrorCodes.invalidCharacters);
  assertImportError(`1234\u200b5678`, localGameWalletImportErrorCodes.invalidCharacters);
  assertImportError(
    "abandon ability able about above absent absorb abstract absurd abuse access accident",
    localGameWalletImportErrorCodes.unsupportedRecoveryPhrase,
  );
  assertImportError("00".repeat(64), localGameWalletImportErrorCodes.unsupportedEncoding);
  assertImportError(Buffer.alloc(64).toString("base64"), localGameWalletImportErrorCodes.unsupportedEncoding);
  assertImportError(
    "1".repeat(localGameWalletImportMaxCharacters + 1),
    localGameWalletImportErrorCodes.inputTooLarge,
  );
});

test("JSON imports reject malformed structures and byte coercion", () => {
  const valid = [...Keypair.generate().secretKey];
  const encoded = bs58.encode(Uint8Array.from(valid));
  const invalidValues = [256, -1, 1.5, "1", null];
  for (const invalidValue of invalidValues) {
    const bytes = [...valid];
    bytes[0] = invalidValue;
    assertImportError(JSON.stringify(bytes), localGameWalletImportErrorCodes.invalidByteArray);
  }
  assertImportError("[1,2", localGameWalletImportErrorCodes.invalidJson);
  assertImportError(JSON.stringify(JSON.stringify(encoded)), localGameWalletImportErrorCodes.invalidCharacters);
  assertImportError(JSON.stringify({ address: "not-secret-material" }), localGameWalletImportErrorCodes.invalidJsonStructure);
  assertImportError(
    JSON.stringify({ publicKey: "session-owner", secretKey: valid, expiresAt: Date.now() + 60_000 }),
    localGameWalletImportErrorCodes.invalidJsonStructure,
  );
  assertImportError(
    JSON.stringify({ secretKey: valid.slice(0, 32), redirectTarget: "/login/", createdAt: Date.now() }),
    localGameWalletImportErrorCodes.invalidJsonStructure,
  );
  assertImportError(
    JSON.stringify({ type: "Buffer", data: valid }),
    localGameWalletImportErrorCodes.invalidJsonStructure,
  );
});

test("invalid input preserves every field of an existing local game wallet", () => {
  createLocalGameWallet();
  const before = storage.entries();
  assertImportError("Private key: invalid", localGameWalletImportErrorCodes.invalidCharacters);
  assertStorageEntriesEqual(storage.entries(), before, "invalid input should not change stored wallet fields");
});

test("imports reject an internally inconsistent 64-byte secret", () => {
  const invalidSecret = Uint8Array.from(Keypair.generate().secretKey);
  invalidSecret[63] ^= 1;
  assertImportError(bs58.encode(invalidSecret), localGameWalletImportErrorCodes.invalidSecret);
  assertImportError(
    JSON.stringify([...invalidSecret]),
    localGameWalletImportErrorCodes.invalidSecret,
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
  assertStorageEntriesEqual(storage.entries(), before, "disconnect should preserve stored wallet fields");
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
  assertSecretBytesEqual(
    normalizedSecret,
    expected.secretKey,
    "an explicit seed should normalize to its deterministic keypair secret",
  );
  assert.equal(imported.address, expected.publicKey.toBase58());
  assert.equal(imported.source, "imported");
}

function assertImportError(input, code) {
  assert.throws(
    () => importLocalGameWallet(input),
    (error) => error?.name === "LocalGameWalletImportError" && error?.code === code,
  );
}

function throwawaySeed() {
  return Keypair.generate().secretKey.slice(0, 32);
}

function assertSecretTextEqual(actual, expected, message) {
  assert.ok(typeof actual === "string" && actual === expected, message);
}

function assertSecretBytesEqual(actual, expected, message) {
  assert.ok(Buffer.from(actual).equals(Buffer.from(expected)), message);
}

function assertWalletRecordMatches(actual, expected) {
  assert.equal(actual?.address, expected?.address);
  assert.equal(actual?.createdAt, expected?.createdAt);
  assert.equal(actual?.source, expected?.source);
  assertSecretTextEqual(actual?.secretKey, expected?.secretKey, "wallet record secrets should match");
}

function assertStorageEntriesEqual(actual, expected, message) {
  const expectedMap = new Map(expected);
  assert.ok(
    actual.length === expected.length
      && actual.every(([key, value]) => expectedMap.has(key) && expectedMap.get(key) === value),
    message,
  );
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
