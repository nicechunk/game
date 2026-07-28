import assert from "node:assert/strict";
import test from "node:test";

import { createPlayInputActions } from "../play-input-actions.js";

test("empty world-delta confirmation and rollback are no-ops", () => {
  const calls = [];
  const placement = {
    pendingCount: () => 0,
    confirmLast: () => calls.push("confirm-place"),
    rollbackLast: () => calls.push("rollback-place"),
  };
  const mining = {
    pendingCount: () => 0,
    confirmLast: () => calls.push("confirm-mine"),
    rollbackLast: () => calls.push("rollback-mine"),
  };
  const actions = createPlayInputActions({
    getPlacement: () => placement,
    getMining: () => mining,
  });

  assert.equal(actions.confirmLastWorldDelta(), null);
  assert.equal(actions.rollbackLastWorldDelta(), null);
  assert.deepEqual(calls, []);
});
