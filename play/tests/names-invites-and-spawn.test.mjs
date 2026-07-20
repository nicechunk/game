import assert from "node:assert/strict";
import test from "node:test";

import {
  appendInviteParams,
  consumePendingInviteSpawn,
  guardianSpawnStateForRegion,
  parseInviteParams,
  storePendingInviteSpawn,
} from "../../src/player/inviteSpawn.js";

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function withStorage(storage, callback) {
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
}

test("documents the current empty-query Genesis fallback", () => {
  assert.deepEqual(parseInviteParams(""), {
    referrer: "",
    guardianId: "genesis",
    region: { regionX: 0, regionY: 0 },
    hasInvite: true,
  });
});

test("uses explicit region before guardian pair and legacy axis aliases", () => {
  assert.deepEqual(
    parseInviteParams("?ref=alice&guardian=8:9&guardianRegion=-2:3&guardianX=5&guardianY=6"),
    {
      referrer: "alice",
      guardianId: "8:9",
      region: { regionX: -2, regionY: 3 },
      hasInvite: true,
    },
  );
  assert.deepEqual(parseInviteParams("?guardian=8,9").region, { regionX: 8, regionY: 9 });
  assert.deepEqual(parseInviteParams("?regionX=5&regionY=-6").region, { regionX: 5, regionY: -6 });
});

test("writes only the canonical invite query keys", () => {
  const url = appendInviteParams(new URL("https://nicechunk.com/login/"), {
    referrer: "inviter",
    guardianId: "genesis",
    region: { regionX: 4, regionY: -7 },
  });
  assert.equal(url.searchParams.get("ref"), "inviter");
  assert.equal(url.searchParams.get("guardian"), "genesis");
  assert.equal(url.searchParams.get("guardianRegion"), "4:-7");
  assert.equal(url.searchParams.has("invite"), false);
  assert.equal(url.searchParams.has("region"), false);
});

test("calculates the current 100-chunk Region center with 16-block Chunks", () => {
  const genesis = guardianSpawnStateForRegion({ regionX: 0, regionY: 0 }, {
    surfaceHeight: (x, z) => {
      assert.deepEqual([x, z], [800, 800]);
      return 132;
    },
  });
  assert.deepEqual(genesis.position, { x: 800, y: 133.01, z: 800 });

  const offset = guardianSpawnStateForRegion({ regionX: 2, regionY: -3 }, {
    surfaceHeight: () => 17.5,
  });
  assert.deepEqual(offset.position, { x: 4000, y: 18.51, z: -4000 });
});

test("stores a wallet-scoped draft and consumes it exactly once without an age check", () => {
  const storage = new MemoryStorage();
  withStorage(storage, () => {
    storePendingInviteSpawn("wallet-a", {
      position: { x: 1, y: 2, z: 3 },
      yaw: 0.5,
      cameraPitch: -0.3,
      guardianRegion: { regionX: 4, regionY: 5 },
    });
    assert.equal(storage.values.size, 1);

    const state = consumePendingInviteSpawn("wallet-a");
    assert.deepEqual(state, {
      position: { x: 1, y: 2, z: 3 },
      yaw: 0.5,
      cameraPitch: -0.3,
      guardianRegion: { regionX: 4, regionY: 5 },
    });
    assert.equal(consumePendingInviteSpawn("wallet-a"), null);
    assert.equal(storage.values.size, 0);
  });
});

test("deletes malformed drafts and can rebuild a position from the stored Region", () => {
  const storage = new MemoryStorage([
    ["nicechunk.inviteSpawn.v1.bad", "not-json"],
    ["nicechunk.inviteSpawn.v1.region", JSON.stringify({
      guardianRegion: { regionX: 1, regionY: 2 },
      storedAt: 1,
    })],
  ]);
  withStorage(storage, () => {
    assert.equal(consumePendingInviteSpawn("bad"), null);
    assert.equal(storage.getItem("nicechunk.inviteSpawn.v1.bad"), null);
    assert.deepEqual(
      consumePendingInviteSpawn("region", { surfaceHeight: () => 20 }),
      {
        position: { x: 2400, y: 21.01, z: 4000 },
        yaw: Math.PI * 0.25,
        cameraPitch: -0.42,
        guardianRegion: { regionX: 1, regionY: 2 },
      },
    );
  });
});

test("the current consumer can rethrow when both read and cleanup storage operations fail", () => {
  const unavailable = {
    getItem() {
      throw new Error("read blocked");
    },
    removeItem() {
      throw new Error("cleanup blocked");
    },
  };
  withStorage(unavailable, () => {
    assert.throws(() => consumePendingInviteSpawn("wallet-a"), /cleanup blocked/);
  });
});
