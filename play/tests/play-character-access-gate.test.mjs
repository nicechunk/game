import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlayerCreationUrl,
  enforcePlayCharacterAccess,
  hasVerifiedPlayCharacterAccess,
  isCompletePlayerAppearance,
  verifyPlayCharacterAccess,
} from "../play-character-access-gate.js";

const wallet = "6Pt43KKwUiDV7zDc1bxQ6hRiUbpy7XFDVsQcbM9dUeiT";

function completeAppearance(overrides = {}) {
  return {
    magic: "NCKAPP01",
    initialized: true,
    owner: wallet,
    modelCode: "NCM2:character-code",
    ...overrides,
  };
}

test("accepts only an initialized appearance owned by the active wallet", () => {
  assert.equal(isCompletePlayerAppearance(completeAppearance(), wallet), true);
  assert.equal(isCompletePlayerAppearance(completeAppearance({ initialized: false }), wallet), false);
  assert.equal(isCompletePlayerAppearance(completeAppearance({ owner: "another-wallet" }), wallet), false);
  assert.equal(isCompletePlayerAppearance(completeAppearance({ modelCode: "" }), wallet), false);
});

test("allows play after the on-chain appearance is verified", async () => {
  const result = await verifyPlayCharacterAccess({
    walletAddress: wallet,
    fetchAppearance: async () => completeAppearance(),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "verified");
});

test("fails closed when the appearance is missing or RPC verification fails", async () => {
  const missing = await verifyPlayCharacterAccess({
    walletAddress: wallet,
    fetchAppearance: async () => null,
  });
  const failed = await verifyPlayCharacterAccess({
    walletAddress: wallet,
    fetchAppearance: async () => {
      throw new Error("rpc unavailable");
    },
  });
  assert.deepEqual({ allowed: missing.allowed, reason: missing.reason }, { allowed: false, reason: "character-required" });
  assert.deepEqual({ allowed: failed.allowed, reason: failed.reason }, { allowed: false, reason: "verification-failed" });
});

test("preserves the return route and Guardian context in the creation URL", () => {
  const result = buildPlayerCreationUrl({
    href: "https://nicechunk.com/play/?guardian=genesis&guardianRegion=0%3A0#spawn",
  });
  assert.equal(result.pathname, "/player_creat/");
  assert.equal(result.searchParams.get("guardian"), "genesis");
  assert.equal(result.searchParams.get("guardianRegion"), "0:0");
  assert.equal(result.searchParams.get("redirect"), "/play/?guardian=genesis&guardianRegion=0%3A0#spawn");
});

test("redirects incomplete players instead of loading the game", async () => {
  let redirectedTo = null;
  const locationLike = {
    href: "https://nicechunk.com/play/?guardian=genesis&guardianRegion=0%3A0",
    replace(url) {
      redirectedTo = String(url);
    },
  };
  const result = await enforcePlayCharacterAccess({
    walletAddress: wallet,
    fetchAppearance: async () => null,
    locationLike,
  });
  assert.equal(result.allowed, false);
  assert.match(redirectedTo, /^https:\/\/nicechunk\.com\/player_creat\//);
});

test("shares a successful verification with the deferred game runtime", async () => {
  const locationLike = {
    href: "https://nicechunk.com/play/",
    replace() {},
  };
  assert.equal(hasVerifiedPlayCharacterAccess(wallet), false);
  const result = await enforcePlayCharacterAccess({
    walletAddress: wallet,
    fetchAppearance: async () => completeAppearance(),
    locationLike,
  });
  assert.equal(result.allowed, true);
  assert.equal(hasVerifiedPlayCharacterAccess(wallet), true);
  assert.equal(hasVerifiedPlayCharacterAccess("another-wallet"), false);
});
