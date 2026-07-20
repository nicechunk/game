import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlayChainAdapter,
  migrateLegacyChainSyncPreference,
} from "../play-chain-adapter.js";

test("legacy chain sync disablement is removed before gameplay submissions", async () => {
  const originalStorage = globalThis.localStorage;
  const storage = memoryStorage({ "nicechunk.chainSync": "0" });
  globalThis.localStorage = storage;

  try {
    const adapter = createPlayChainAdapter({ getWalletAddress: () => "" });

    assert.equal(storage.getItem("nicechunk.chainSync"), null);
    assert.equal(adapter.isEnabled(), true);
    assert.equal(adapter.isReady(), false);
    assert.deepEqual(await adapter.submitMine({ txId: "pending-1" }), {
      submitted: false,
      reason: "wallet-unavailable",
    });
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});

test("legacy migration is idempotent and leaves the dedicated PDA read setting untouched", () => {
  const storage = memoryStorage({
    "nicechunk.chainSync": "0",
    "nicechunk.chainChunkPdaRead": "0",
  });

  assert.equal(migrateLegacyChainSyncPreference(storage), true);
  assert.equal(migrateLegacyChainSyncPreference(storage), false);
  assert.equal(storage.getItem("nicechunk.chainSync"), null);
  assert.equal(storage.getItem("nicechunk.chainChunkPdaRead"), "0");
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
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
