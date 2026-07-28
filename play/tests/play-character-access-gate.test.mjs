import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlayerCreationUrl,
  characterAccessFailureCode,
  enforcePlayCharacterAccess,
  hasVerifiedPlayCharacterAccess,
  isCompletePlayerAppearance,
  isRpcRecoveryFailureCode,
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

test("distinguishes a missing account from invalid data and RPC failure", async () => {
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
  const invalid = await verifyPlayCharacterAccess({
    walletAddress: wallet,
    fetchAppearance: async () => completeAppearance({ modelCode: "" }),
  });
  assert.deepEqual({ allowed: missing.allowed, reason: missing.reason }, { allowed: false, reason: "character-required" });
  assert.deepEqual({ allowed: failed.allowed, reason: failed.reason }, { allowed: false, reason: "verification-failed" });
  assert.deepEqual({ allowed: invalid.allowed, reason: invalid.reason }, { allowed: false, reason: "character-data-invalid" });
});

test("classifies actionable character verification failures", () => {
  assert.equal(characterAccessFailureCode({ reason: "verification-timeout" }), "character-timeout");
  assert.equal(characterAccessFailureCode({ reason: "character-data-invalid" }), "character-data-invalid");
  assert.equal(characterAccessFailureCode({ reason: "verification-failed", error: new Error("RPC HTTP 429") }), "rpc-rate-limited");
  assert.equal(characterAccessFailureCode({ reason: "verification-failed", error: new Error("Failed to fetch") }), "network-unavailable");
  assert.equal(characterAccessFailureCode({ reason: "verification-failed", error: new Error("HTTP 403") }), "rpc-unauthorized");
  assert.equal(characterAccessFailureCode({ reason: "verification-failed" }, { online: false }), "network-offline");
  assert.equal(isRpcRecoveryFailureCode("rpc-rate-limited"), true);
  assert.equal(isRpcRecoveryFailureCode("character-timeout"), true);
  assert.equal(isRpcRecoveryFailureCode("network-offline"), false);
  assert.equal(isRpcRecoveryFailureCode("character-data-invalid"), false);
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

test("does not redirect when RPC verification fails or character data is invalid", async () => {
  const redirects = [];
  const locationLike = {
    href: "https://nicechunk.com/play/",
    replace(url) {
      redirects.push(String(url));
    },
  };
  const failed = await enforcePlayCharacterAccess({
    walletAddress: wallet,
    fetchAppearance: async () => {
      throw new Error("RPC HTTP 503");
    },
    locationLike,
  });
  const invalid = await enforcePlayCharacterAccess({
    walletAddress: wallet,
    fetchAppearance: async () => completeAppearance({ owner: "another-wallet" }),
    locationLike,
  });
  assert.equal(failed.reason, "verification-failed");
  assert.equal(invalid.reason, "character-data-invalid");
  assert.deepEqual(redirects, []);
});

test("does not redirect when character verification times out", async () => {
  let redirected = false;
  const result = await enforcePlayCharacterAccess({
    walletAddress: wallet,
    fetchAppearance: () => new Promise(() => {}),
    timeoutMs: 5,
    locationLike: {
      href: "https://nicechunk.com/play/",
      replace() {
        redirected = true;
      },
    },
  });
  assert.equal(result.reason, "verification-timeout");
  assert.equal(redirected, false);
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
