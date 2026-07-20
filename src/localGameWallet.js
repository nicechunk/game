import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export const localGameWalletName = "NiceChunk Game Wallet";
export const localGameWalletKeys = {
  address: "nicechunk.localGameWallet.address",
  secretKey: "nicechunk.localGameWallet.secretKey",
  createdAt: "nicechunk.localGameWallet.createdAt",
  source: "nicechunk.localGameWallet.source",
};

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
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Missing private key.");
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw);
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error("Private key must be a Solana 64-byte secret key or 32-byte seed.");
}

function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}
