import assert from "node:assert/strict";
import test from "node:test";

import { createPlayInputActions } from "../play-input-actions.js";

test("debug bulk mode intercepts tool actions, confirmation, and cancellation", () => {
  const calls = { select: 0, confirm: 0, cancel: 0, mine: 0, blueprint: 0 };
  const bulk = {
    isEnabled: () => true,
    selectAtHit(hit) {
      assert.equal(hit.worldX, 9);
      calls.select += 1;
    },
    confirm() { calls.confirm += 1; },
    cancel() { calls.cancel += 1; },
  };
  const actions = createPlayInputActions({
    gameState: { isBlueprintSelected: () => true },
    getBulkMining: () => bulk,
    getBulkMiningHit: () => ({ hit: true, worldX: 9, worldY: 8, worldZ: 7 }),
    getMining: () => ({ minePending() { calls.mine += 1; } }),
    getBlueprint: () => ({ selectAtHit() { calls.blueprint += 1; } }),
  });

  actions.useSelectedHotbarAction();
  actions.confirmLastWorldDelta();
  actions.rollbackLastWorldDelta();

  assert.deepEqual(calls, { select: 1, confirm: 1, cancel: 1, mine: 0, blueprint: 0 });
});
