import assert from "node:assert/strict";
import test from "node:test";

import {
  clearWalletOnboardingState,
  createPlayCacheMaintenance,
} from "../play-cache-maintenance.js";

test("cache maintenance clears only Chunk cache and the current wallet guide state", async () => {
  const storage = createStorage({
    "nicechunk.walletAddress": "wallet-a",
    "nicechunk.walletBoundAt": "1234",
    "nicechunk.localGameWallet.address": "wallet-a",
    "nicechunk.localGameWallet.secretKey": "private-wallet-material",
    "nicechunk.heliusApiKey": "rpc-key",
    "nicechunk.devnetRpcUrl": "https://rpc.example.test",
    "nicechunk.language": "zh-Hans",
    "nicechunk.playerProfile.v1.wallet-a": "character-data",
    "nicechunk.onboarding.v1.wallet-a": "current-guide-state",
    "nicechunk.onboarding.v1.wallet-b": "other-guide-state",
  });
  const protectedBefore = Object.fromEntries([...storage.entries()].filter(([key]) => (
    key !== "nicechunk.onboarding.v1.wallet-a"
  )));
  const button = createElement();
  const status = createElement();
  const chunkCalls = [];
  let onboardingResetCount = 0;
  let onboardingResetOptions = null;
  let reloadCount = 0;
  const maintenance = createPlayCacheMaintenance({
    elements: { profileClearCacheButton: button, profileClearCacheStatus: status },
    clearChunkCache: async (options) => { chunkCalls.push(options); },
    getWalletAddress: () => "wallet-a",
    getOnboardingApi: () => ({
      snapshot: () => ({ walletAddress: "wallet-a" }),
      reset: (_feature, options) => {
        onboardingResetCount += 1;
        onboardingResetOptions = options;
      },
    }),
    storage,
    reload: () => { reloadCount += 1; },
    translate: (_key, fallback, params = {}) => fallback.replace("{reason}", params.reason || ""),
    setTimer: () => 1,
    clearTimer: () => {},
    reloadDelayMs: 0,
  });

  assert.equal(maintenance.bind(), true);
  await button.emit("click");
  assert.equal(button.dataset.confirming, "true");
  assert.equal(chunkCalls.length, 0);
  await button.emit("click");

  assert.deepEqual(chunkCalls, [{ clearRenderDeltas: true, clearPersistent: true }]);
  assert.equal(storage.getItem("nicechunk.onboarding.v1.wallet-a"), null);
  assert.deepEqual(Object.fromEntries(storage.entries()), protectedBefore);
  assert.equal(onboardingResetCount, 1);
  assert.deepEqual(onboardingResetOptions, { deferUntilReload: true });
  assert.equal(reloadCount, 1);
  assert.equal(status.dataset.state, "success");
});

test("onboarding reset never targets a different wallet", () => {
  const storage = createStorage({
    "nicechunk.onboarding.v1.wallet-a": "current",
    "nicechunk.onboarding.v1.wallet-b": "other",
  });
  let resetCount = 0;
  clearWalletOnboardingState({
    storage,
    walletAddress: "wallet-a",
    onboardingApi: {
      snapshot: () => ({ walletAddress: "wallet-b" }),
      reset: () => { resetCount += 1; },
    },
  });
  assert.equal(storage.getItem("nicechunk.onboarding.v1.wallet-a"), null);
  assert.equal(storage.getItem("nicechunk.onboarding.v1.wallet-b"), "other");
  assert.equal(resetCount, 0);
});

function createStorage(initial) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    entries: () => values.entries(),
  };
}

function createElement() {
  const listeners = new Map();
  return {
    dataset: {},
    hidden: true,
    disabled: false,
    textContent: "",
    attributes: new Map(),
    addEventListener(type, handler) { listeners.set(type, handler); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
    async emit(type) { return listeners.get(type)?.({ type, target: this }); },
  };
}
