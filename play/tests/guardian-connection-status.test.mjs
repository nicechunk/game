import assert from "node:assert/strict";
import test from "node:test";

import {
  applyGuardianConnectionState,
  resolveGuardianConnectionState,
} from "../play-guardian-connection.js";

test("Guardian connection state distinguishes connected, connecting, and disconnected", () => {
  assert.equal(resolveGuardianConnectionState({ enabled: true, walletAvailable: true, connected: true }), "connected");
  assert.equal(resolveGuardianConnectionState({ enabled: true, walletAvailable: true, connecting: true }), "connecting");
  assert.equal(resolveGuardianConnectionState({ enabled: true, walletAvailable: true }), "disconnected");
});

test("disabled, offline, and walletless Guardian sessions stay disconnected", () => {
  assert.equal(resolveGuardianConnectionState({ enabled: false, walletAvailable: true, connected: true }), "disconnected");
  assert.equal(resolveGuardianConnectionState({ enabled: true, walletAvailable: true, connected: true, offline: true }), "disconnected");
  assert.equal(resolveGuardianConnectionState({ enabled: true, walletAvailable: false, connecting: true }), "disconnected");
});

test("the minimap indicator updates only when its state changes", () => {
  const indicator = { dataset: { state: "disconnected" } };

  assert.equal(applyGuardianConnectionState(indicator, "connecting"), true);
  assert.equal(indicator.dataset.state, "connecting");
  assert.equal(applyGuardianConnectionState(indicator, "connecting"), false);
  assert.equal(applyGuardianConnectionState(indicator, "connected"), true);
  assert.equal(indicator.dataset.state, "connected");
  assert.equal(applyGuardianConnectionState(indicator, "unknown"), true);
  assert.equal(indicator.dataset.state, "disconnected");
});
