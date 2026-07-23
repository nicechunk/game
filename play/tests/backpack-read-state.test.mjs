import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveBackpackReadState,
  verifyBackpackCreationEligibility,
} from "../backpack-read-state.js";

test("backpack creation remains locked until absence is authoritative", () => {
  const unknown = resolveBackpackReadState({
    gameState: gameState(false, false),
    snapshot: { loading: false, statusKnown: false, available: false },
  });
  assert.equal(unknown.pending, true);
  assert.equal(unknown.canCreate, false);

  const absent = resolveBackpackReadState({
    gameState: gameState(false, true),
    snapshot: { loading: false, statusKnown: true, available: false },
  });
  assert.equal(absent.pending, false);
  assert.equal(absent.canCreate, true);

  const existing = resolveBackpackReadState({
    gameState: gameState(false, false),
    snapshot: { loading: false, statusKnown: false, backpackAddress: "Backpack111" },
  });
  assert.equal(existing.available, true);
  assert.equal(existing.canCreate, false);
});

test("an active backpack read never falls through to creation", async () => {
  let refreshCalls = 0;
  const result = await verifyBackpackCreationEligibility({
    gameState: gameState(false, false),
    chainBackpack: {
      snapshot: () => ({ loading: true, statusKnown: false, available: false }),
      refresh: async () => {
        refreshCalls += 1;
        return { ok: false, reason: "already-loading" };
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "backpack-read-pending");
  assert.equal(refreshCalls, 0);
});

test("creation preflight detects a backpack returned by a forced refresh", async () => {
  let snapshot = { loading: false, statusKnown: false, available: false, lastError: "rpc-timeout" };
  const result = await verifyBackpackCreationEligibility({
    gameState: gameState(false, false),
    chainBackpack: {
      snapshot: () => snapshot,
      refresh: async () => {
        snapshot = { loading: false, statusKnown: true, available: true, backpackAddress: "Backpack222" };
        return { ok: true };
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "backpack-already-exists");
});

test("creation preflight proceeds only after a forced refresh confirms absence", async () => {
  let snapshot = { loading: false, statusKnown: false, available: false, lastError: "rpc-timeout" };
  const result = await verifyBackpackCreationEligibility({
    gameState: gameState(false, false),
    chainBackpack: {
      snapshot: () => snapshot,
      refresh: async () => {
        snapshot = { loading: false, statusKnown: true, available: false, lastError: "no-equipped-backpack" };
        return { ok: false, reason: "no-equipped-backpack" };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "backpack-absent");
});

test("creation preflight rechecks an earlier authoritative absence", async () => {
  let refreshCalls = 0;
  const result = await verifyBackpackCreationEligibility({
    gameState: gameState(false, true),
    chainBackpack: {
      snapshot: () => ({
        loading: false,
        statusKnown: true,
        available: false,
        lastError: "no-equipped-backpack",
      }),
      refresh: async (options) => {
        refreshCalls += 1;
        assert.deepEqual(options, { force: true, quiet: false });
        return { ok: false, reason: "no-equipped-backpack" };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "backpack-absent");
  assert.equal(refreshCalls, 1);
});

test("a failed latest read cannot reuse a stale absence result", async () => {
  const result = await verifyBackpackCreationEligibility({
    gameState: gameState(false, true),
    chainBackpack: {
      snapshot: () => ({
        loading: false,
        statusKnown: true,
        available: false,
        lastError: "no-equipped-backpack",
      }),
      refresh: async () => ({ ok: false, reason: "rpc-timeout" }),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "backpack-read-failed");
  assert.equal(result.detail, "rpc-timeout");
});

function gameState(available, known) {
  return {
    backpackStatusKnown: known,
    isBackpackAvailable: () => available,
  };
}
