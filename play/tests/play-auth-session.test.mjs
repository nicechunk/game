import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWalletLoginUrl,
  clearWalletSession,
  getWalletSession,
  hasBoundWallet,
} from "../play-auth-session.js";

test("play session requires both a wallet and binding timestamp", () => {
  const storage = memoryStorage({
    "nicechunk.walletAddress": "wallet-1",
    "nicechunk.walletBoundAt": "123",
  });

  assert.equal(hasBoundWallet(getWalletSession(storage)), true);
  storage.removeItem("nicechunk.walletBoundAt");
  assert.equal(hasBoundWallet(getWalletSession(storage)), false);
});

test("logout clears identity and wallet-scoped runtime caches only", () => {
  const storage = memoryStorage({
    "nicechunk.walletAddress": "wallet-1",
    "nicechunk.walletBoundAt": "123",
    "nicechunk.walletName": "Wallet",
    "nicechunk.username": "Miner",
    "nicechunk.session.v1.wallet-1": "session",
    "nicechunk.equippedBackpack.v1.wallet-1": "backpack",
    "nicechunk.unrelated": "keep",
  });

  clearWalletSession(storage);

  assert.deepEqual(getWalletSession(storage), {
    walletAddress: "",
    username: "",
    walletName: "",
    walletBoundAt: "",
  });
  assert.equal(storage.getItem("nicechunk.session.v1.wallet-1"), null);
  assert.equal(storage.getItem("nicechunk.equippedBackpack.v1.wallet-1"), null);
  assert.equal(storage.getItem("nicechunk.unrelated"), "keep");
});

test("login redirect keeps only local absolute return paths", () => {
  const valid = buildWalletLoginUrl({ redirectPath: "/play/?debug=1", autoConnect: false });
  const unsafe = buildWalletLoginUrl({ redirectPath: "//example.com/steal", autoConnect: false });

  assert.equal(valid.pathname, "/login/");
  assert.equal(valid.searchParams.get("redirect"), "/play/?debug=1");
  assert.equal(valid.searchParams.has("autoConnect"), false);
  assert.equal(unsafe.searchParams.get("redirect"), "/play/");
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}
