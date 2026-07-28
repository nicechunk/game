import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export const localGameWalletName = "NiceChunk Game Wallet";
export const localGameWalletImportMaxCharacters = 8192;
export const localGameWalletKeys = {
  address: "nicechunk.localGameWallet.address",
  secretKey: "nicechunk.localGameWallet.secretKey",
  createdAt: "nicechunk.localGameWallet.createdAt",
  source: "nicechunk.localGameWallet.source",
};

export const localGameWalletImportErrorCodes = Object.freeze({
  missing: "missing_private_key",
  inputTooLarge: "input_too_large",
  invalidCharacters: "invalid_base58_characters",
  invalidJson: "invalid_json",
  invalidJsonStructure: "invalid_json_structure",
  invalidByteArray: "invalid_byte_array",
  ambiguous32ByteValue: "ambiguous_32_byte_value",
  invalidSeedRecord: "invalid_seed_record",
  invalidSeedLength: "invalid_seed_length",
  unsupportedRecoveryPhrase: "unsupported_recovery_phrase",
  unsupportedEncoding: "unsupported_encoding",
  invalidLength: "invalid_secret_length",
  invalidSecret: "invalid_secret_key",
});

export function hasLocalGameWallet() {
  return Boolean(getLocalGameWalletRecord()?.address);
}

export function getLocalGameWalletRecord({ includeSecret = false } = {}) {
  if (!hasLocalStorage()) return null;
  const address = localStorage.getItem(localGameWalletKeys.address) || "";
  const secretKey = localStorage.getItem(localGameWalletKeys.secretKey) || "";
  const createdAt = localStorage.getItem(localGameWalletKeys.createdAt) || "";
  const source = localStorage.getItem(localGameWalletKeys.source) || "";
  if (!address || !secretKey) return null;
  return includeSecret ? { address, secretKey, createdAt, source } : { address, createdAt, source };
}

export function createLocalGameWallet() {
  const keypair = Keypair.generate();
  return storeLocalGameWalletKeypair(keypair, "created");
}

export function importLocalGameWallet(value) {
  const keypair = keypairFromSecretInput(value);
  return storeLocalGameWalletKeypair(keypair, "imported");
}

export function clearLocalGameWallet() {
  if (!hasLocalStorage()) return;
  localStorage.removeItem(localGameWalletKeys.address);
  localStorage.removeItem(localGameWalletKeys.secretKey);
  localStorage.removeItem(localGameWalletKeys.createdAt);
  localStorage.removeItem(localGameWalletKeys.source);
}

export function getLocalGameWalletProvider() {
  const keypair = loadLocalGameWalletKeypair();
  if (!keypair) return null;
  return {
    isNiceChunkLocalGameWallet: true,
    isConnected: true,
    publicKey: keypair.publicKey,
    async connect() {
      return { publicKey: keypair.publicKey };
    },
    async disconnect() {
      return undefined;
    },
    async signTransaction(transaction) {
      transaction.partialSign(keypair);
      return transaction;
    },
    async signAllTransactions(transactions) {
      for (const transaction of transactions) transaction.partialSign(keypair);
      return transactions;
    },
  };
}

export function getLocalGameWalletKeypair() {
  return loadLocalGameWalletKeypair();
}

export function isLocalGameWalletProvider(provider) {
  return Boolean(provider?.isNiceChunkLocalGameWallet && provider?.publicKey);
}

export function isLocalGameWalletAddress(address) {
  const value = address?.toBase58?.() ?? String(address ?? "");
  const record = getLocalGameWalletRecord();
  return Boolean(value && record?.address === value);
}

function storeLocalGameWalletKeypair(keypair, source = "created") {
  const address = keypair.publicKey.toBase58();
  const secretKey = bs58.encode(keypair.secretKey);
  const createdAt = String(Date.now());
  if (!hasLocalStorage()) throw new Error("Browser local storage is unavailable.");
  localStorage.setItem(localGameWalletKeys.address, address);
  localStorage.setItem(localGameWalletKeys.secretKey, secretKey);
  localStorage.setItem(localGameWalletKeys.createdAt, createdAt);
  localStorage.setItem(localGameWalletKeys.source, source === "imported" ? "imported" : "created");
  return { address, secretKey, createdAt, source: source === "imported" ? "imported" : "created" };
}

function loadLocalGameWalletKeypair() {
  try {
    const record = getLocalGameWalletRecord({ includeSecret: true });
    if (!record?.secretKey) return null;
    return keypairFromSecretInput(record.secretKey);
  } catch {
    return null;
  }
}

function keypairFromSecretInput(value) {
  const input = String(value || "");
  if (input.length > localGameWalletImportMaxCharacters) {
    throw importError(
      localGameWalletImportErrorCodes.inputTooLarge,
      `Private-key input exceeds ${localGameWalletImportMaxCharacters} characters.`,
    );
  }
  const raw = input.trim();
  if (!raw) throw importError(localGameWalletImportErrorCodes.missing, "Missing private key.");

  const material = startsWithJsonToken(raw)
    ? parseJsonSecretMaterial(raw)
    : parseBase58SecretMaterial(raw);

  if (material.kind === "seed") return Keypair.fromSeed(material.bytes);
  try {
    return Keypair.fromSecretKey(material.bytes);
  } catch (cause) {
    throw importError(
      localGameWalletImportErrorCodes.invalidSecret,
      "The supplied 64-byte value is not a valid Solana secret key.",
      cause,
    );
  }
}

function parseJsonSecretMaterial(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw importError(localGameWalletImportErrorCodes.invalidJson, "Private-key JSON is invalid.", cause);
  }
  return parseStructuredSecretMaterial(parsed);
}

function parseStructuredSecretMaterial(value, { allowSeed = false, seedOnly = false } = {}) {
  if (Array.isArray(value)) return parseStrictByteArray(value, { allowSeed, seedOnly });
  if (typeof value === "string") {
    return parseBase58SecretMaterial(value, { allowSeed, seedOnly });
  }
  if (!value || typeof value !== "object") {
    throw importError(
      localGameWalletImportErrorCodes.invalidJsonStructure,
      "Private-key JSON must contain a byte array or an encoded private key.",
    );
  }

  if (value.type === "nicechunk-game-wallet-seed") {
    const keys = Object.keys(value).sort();
    const validKeys = ["seed", "type", "version"];
    if (
      value.version !== 1
      || typeof value.seed !== "string"
      || value.seed !== value.seed.trim()
      || keys.length !== validKeys.length
      || keys.some((key, index) => key !== validKeys[index])
    ) {
      throw importError(
        localGameWalletImportErrorCodes.invalidSeedRecord,
        "A NiceChunk seed record must contain only type, version 1, and a Base58 seed string.",
      );
    }
    return parseBase58SecretMaterial(value.seed, { allowSeed: true, seedOnly: true });
  }

  throw importError(
    localGameWalletImportErrorCodes.invalidJsonStructure,
    "Private-key JSON must be a strict byte array, a quoted Base58 key, or an explicitly typed seed record.",
  );
}

function parseStrictByteArray(value, options = {}) {
  if (!value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw importError(
      localGameWalletImportErrorCodes.invalidByteArray,
      "Private-key JSON bytes must be integers from 0 through 255.",
    );
  }
  return classifySecretBytes(Uint8Array.from(value), options);
}

function parseBase58SecretMaterial(value, options = {}) {
  const text = String(value || "").trim();
  if (!text) throw importError(localGameWalletImportErrorCodes.missing, "Missing private key.");
  if (looksLikeRecoveryPhrase(text)) {
    throw importError(
      localGameWalletImportErrorCodes.unsupportedRecoveryPhrase,
      "Recovery phrases are not accepted by the Game Wallet importer.",
    );
  }
  if (looksLikeHexOrBase64(text)) {
    throw importError(
      localGameWalletImportErrorCodes.unsupportedEncoding,
      "Hex and Base64 private keys are not accepted by the Game Wallet importer.",
    );
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/u.test(text)) {
    throw importError(
      localGameWalletImportErrorCodes.invalidCharacters,
      "Private-key text contains characters that are not valid Base58.",
    );
  }

  let bytes;
  try {
    bytes = bs58.decode(text);
  } catch (cause) {
    throw importError(
      localGameWalletImportErrorCodes.invalidCharacters,
      "Private-key text contains characters that are not valid Base58.",
      cause,
    );
  }
  return classifySecretBytes(bytes, options);
}

function classifySecretBytes(bytes, { allowSeed = false, seedOnly = false } = {}) {
  if (seedOnly) {
    if (bytes.length === 32) return { bytes, kind: "seed" };
    throw importError(
      localGameWalletImportErrorCodes.invalidSeedLength,
      "An explicit seed field must contain exactly 32 bytes.",
    );
  }
  if (bytes.length === 64) return { bytes, kind: "secretKey" };
  if (bytes.length === 32) {
    if (allowSeed) return { bytes, kind: "seed" };
    throw importError(
      localGameWalletImportErrorCodes.ambiguous32ByteValue,
      "A bare 32-byte value may be a public address and is not accepted as a private seed.",
    );
  }
  throw importError(
    localGameWalletImportErrorCodes.invalidLength,
    "Private key must contain a complete 64-byte Solana secret key.",
  );
}

function looksLikeRecoveryPhrase(value) {
  const words = String(value).trim().split(/\s+/u);
  return [12, 15, 18, 21, 24].includes(words.length);
}

function looksLikeHexOrBase64(value) {
  const text = String(value).trim();
  if (/^(?:0x)?[0-9a-f]{64}(?:[0-9a-f]{64})?$/iu.test(text)) return true;
  return text.length >= 44
    && text.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/u.test(text)
    && /[+/=]/u.test(text);
}

function startsWithJsonToken(value) {
  const first = String(value || "").charAt(0);
  return first === "[" || first === "{" || first === '"';
}

function importError(code, message, cause) {
  const error = new Error(message);
  error.name = "LocalGameWalletImportError";
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}
