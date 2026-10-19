import assert from "node:assert/strict";
import test from "node:test";
import { fetchNicechunkTransactionConfirmation, getNicechunkTransactionConfirmation } from "../../src/chain/nicechunkChain.js";

test("transaction execution slots come from signature status, never RPC context bank slots", async () => {
  const conn = { async getSignatureStatuses() { return { context: { slot: 999_999 }, value: [{ slot: 17, err: null, confirmationStatus: "confirmed" }] }; } };
  const result = await fetchNicechunkTransactionConfirmation("local-confirmation-vector", conn);
  assert.equal(result.state, "confirmed");
  assert.equal(result.executionSlot, 17);
  assert.equal(result.responseContextSlot, 999_999);
  assert.equal(result.commitment, "confirmed");
  assert.equal(getNicechunkTransactionConfirmation("local-confirmation-vector").executionSlot, 17);
});

test("unknown status is unresolved and unknown execution slot remains null", async () => {
  const unknown = await fetchNicechunkTransactionConfirmation("unknown-vector", { async getSignatureStatuses() { return { context: { slot: 2 }, value: [null] }; } });
  assert.equal(unknown.state, "unknown");
  assert.equal(getNicechunkTransactionConfirmation("unknown-vector"), null);
  const noSlot = await fetchNicechunkTransactionConfirmation("slot-not-provided-vector", { async getSignatureStatuses() { return { context: { slot: 100 }, value: [{ err: null, confirmationStatus: "finalized" }] }; } });
  assert.equal(noSlot.executionSlot, null);
  assert.equal(noSlot.commitment, "finalized");
  const failed = await fetchNicechunkTransactionConfirmation("failed-vector", { async getSignatureStatuses() { return { value: [{ slot: 2, err: { InstructionError: [0, "Custom"] }, confirmationStatus: "finalized" }] }; } });
  assert.equal(failed.state, "failed");
});
