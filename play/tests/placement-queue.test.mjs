import assert from "node:assert/strict";
import test from "node:test";
import { createPlacementController } from "../placement-controller.js";
import { createPlacementSubmissionQueue } from "../play-placement-queue.js";
import { createActionOverlayBuilder } from "../play-action-overlays.js";
import { resolvePlacementBackpackSlotIndex } from "../../src/chain/placementSource.js";

function fixture({ count = 3, maxPendingPlacements = 64 } = {}) {
  const world = new Map([["0,0,0", 7]]);
  const deltas = new Map();
  const slot = { resourceId: 41, blockId: 7, count };
  const source = { kind: "block", blockId: 7, sourceType: "equipment", equipmentSlot: 2, backpackAddress: "backpack-pda" };
  let anchorX = 0;
  const statuses = [];
  const controller = createPlacementController({
    gameState: {
      playerProfile: {}, savePlayerProfile() {},
      getSelectedPlaceableSlot: () => ({ slot, index: 2 }),
      getHotbarEquipmentChainReference: () => source,
    },
    chunks: {
      getBlockAtWorld: (x, y, z) => world.get(`${x},${y},${z}`) ?? 0,
      applyPendingDelta([delta], txId) {
        const key = `${delta.worldX},${delta.worldY},${delta.worldZ}`;
        deltas.set(txId, key); world.set(key, delta.blockId);
      },
      confirmPendingDelta(txId) { deltas.delete(txId); },
      rollbackPendingDelta(txId) { world.delete(deltas.get(txId)); deltas.delete(txId); },
    },
    getHit: () => ({ hit: true, worldX: anchorX, worldY: 0, worldZ: 0, faceX: 1, faceY: 0, faceZ: 0 }),
    blockDef: () => ({ name: "Stone" }), isBlockingBlock: () => true, blockAirId: 0,
    onStatus: (message) => statuses.push(message), maxPendingPlacements,
  });
  return { controller, slot, world, statuses, anchor: (x) => { anchorX = x; } };
}

test("continuous previews reserve stock and a failed parent invalidates its queued child", () => {
  const { controller, slot, anchor, statuses, world } = fixture();
  const first = controller.placePending();
  assert.equal(controller.placePending(), null, "the same target cannot be queued twice");
  anchor(1); const second = controller.placePending();
  anchor(2); const third = controller.placePending();
  assert.equal(controller.pendingCount(), 3);
  assert.equal(world.get("3,0,0"), 7, "all previews are visible before any confirmation");
  anchor(3); assert.equal(controller.placePending(), null);
  assert.match(statuses.at(-1), /already queued/);
  assert.equal(controller.confirmLast(), null, "manual confirmation cannot bypass the chain");
  controller.confirmTx(first.txId, { chainResolution: true });
  assert.equal(controller.placePending(), null, "a stale inventory read cannot release spent stock");
  slot.count = 2;
  assert.equal(controller.placePending(), null, "the two remaining blocks are already reserved");
  controller.rollbackTx(second.txId, { chainResolution: true });
  assert.deepEqual(controller.validateQueuedTx(third.txId), { ok: false, reason: "placement-anchor-unavailable" });
  controller.rollbackTx(third.txId, { chainResolution: true });
  anchor(1);
  assert.ok(controller.placePending(), "failed previews release reservations without inventing stock");
});

test("the queue has a bounded size without imposing a one-transaction input lock", () => {
  const { controller, anchor, statuses } = fixture({ count: 10, maxPendingPlacements: 2 });
  assert.ok(controller.placePending()); anchor(1); assert.ok(controller.placePending());
  anchor(2); assert.equal(controller.placePending(), null);
  assert.match(statuses.at(-1), /queue is full/);
});

test("submission runs FIFO, remains interactive, and continues after a rejected task", async () => {
  const started = [], failed = [];
  const release = [];
  let active = 0, peak = 0;
  const queue = createPlacementSubmissionQueue({
    submit: async (pending) => {
      active++; peak = Math.max(peak, active); started.push(pending.txId);
      try { await new Promise((resolve, reject) => release.push(pending.txId === "b" ? reject : resolve)); }
      finally { active--; }
    },
    onError: (pending) => failed.push(pending.txId),
  });
  const completions = ["a", "b", "c"].map((txId) => queue.enqueue({ txId }, {}));
  assert.deepEqual(started, ["a"]);
  assert.equal(queue.pendingCount(), 3);
  release.shift()(); await completions[0];
  assert.deepEqual(started, ["a", "b"]);
  release.shift()(new Error("rejected")); await completions[1];
  assert.deepEqual(started, ["a", "b", "c"]);
  release.shift()(); await Promise.all(completions);
  assert.deepEqual(failed, ["b"]); assert.equal(peak, 1); assert.equal(queue.pendingCount(), 0);
});

test("every unconfirmed placement pulses and its overlay disappears on resolution", () => {
  let pending = [{ worldX: 1, worldY: 2, worldZ: 3 }, { worldX: 2, worldY: 2, worldZ: 3 }];
  const builder = createActionOverlayBuilder({ getPlacement: () => ({ pendingSnapshot: () => pending }) });
  const dim = builder.build(null, 0), bright = builder.build(null, Math.PI / 0.016);
  assert.equal(dim.length, 2); assert.equal(bright.length, 2);
  assert.ok(bright[0].fillColor[3] > dim[0].fillColor[3]);
  pending = pending.slice(1); assert.equal(builder.build(null, 0).length, 1);
  pending = []; assert.equal(builder.build(null, 0).length, 0);
});

test("a queued backpack source follows compaction without consuming another resource", () => {
  const resource = (worldX) => ({ worldX, worldY: 4, worldZ: 5 });
  const selected = { quantity: 2, blockId: 7, resource: resource(9) };
  const other = { quantity: 1, blockId: 7, resource: resource(3) };
  const ref = { backpackIndex: 1, proof: resource(9) };
  const matches = (slot) => slot?.quantity > 0 && slot.blockId === 7;
  assert.equal(resolvePlacementBackpackSlotIndex([other, selected], ref, matches), 1);
  assert.equal(resolvePlacementBackpackSlotIndex([selected, other], ref, matches), 0);
  assert.equal(resolvePlacementBackpackSlotIndex([other], ref, matches), -1);
});
