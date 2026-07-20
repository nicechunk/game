import assert from "node:assert/strict";
import test from "node:test";

import { createMiningController } from "../mining-controller.js";
import { createActionOverlayBuilder } from "../play-action-overlays.js";

const TARGET = Object.freeze({
  hit: true,
  worldX: 2,
  worldY: 10,
  worldZ: 3,
  chunkX: 0,
  chunkZ: 0,
  localX: 2,
  localY: 10,
  localZ: 3,
  blockId: 7,
  resourceId: 70,
  materialId: 7,
  faceX: 0,
  faceY: 1,
  faceZ: 0,
});

test("mining keeps the block visible while chain submission is pending", () => {
  const harness = createHarness();

  mineThreeTimes(harness);

  assert.equal(harness.controller.pendingCount(), 1);
  assert.equal(harness.blockId(), TARGET.blockId);
  assert.equal(harness.calls.apply.length, 0);
  assert.equal(harness.calls.confirm.length, 0);
});

test("failed mining removes pending state without touching world geometry", () => {
  const harness = createHarness();
  mineThreeTimes(harness);
  const pending = harness.controller.pendingSnapshot()[0];

  const rolledBack = harness.controller.rollbackTx(pending.txId);

  assert.equal(rolledBack?.txId, pending.txId);
  assert.equal(harness.controller.pendingCount(), 0);
  assert.equal(harness.blockId(), TARGET.blockId);
  assert.equal(harness.calls.apply.length, 0);
  assert.equal(harness.calls.rollback.length, 0);
  assert.equal(harness.gameState.hotbarSlots[0].durability, 20);
});

test("failed mining restores durability to every tool used on the target", () => {
  const harness = createHarness({ toolCount: 2 });

  mineOnce(harness);
  mineOnce(harness);
  harness.gameState.selectedToolIndex = 1;
  mineOnce(harness);
  const pending = harness.controller.pendingSnapshot()[0];

  assert.deepEqual(pending.toolDamageBySlot, [
    { slotIndex: 0, amount: 2 },
    { slotIndex: 1, amount: 1 },
  ]);
  assert.equal(harness.gameState.hotbarSlots[0].durability, 18);
  assert.equal(harness.gameState.hotbarSlots[1].durability, 19);

  harness.controller.rollbackTx(pending.txId);

  assert.equal(harness.gameState.hotbarSlots[0].durability, 20);
  assert.equal(harness.gameState.hotbarSlots[1].durability, 20);
});

test("confirmed mining applies and commits the air delta exactly once", () => {
  const harness = createHarness();
  mineThreeTimes(harness);
  const pending = harness.controller.pendingSnapshot()[0];

  const confirmed = harness.controller.confirmTx(pending.txId);

  assert.equal(confirmed?.txId, pending.txId);
  assert.equal(harness.controller.pendingCount(), 0);
  assert.equal(harness.blockId(), 0);
  assert.equal(harness.calls.apply.length, 1);
  assert.equal(harness.calls.confirm.length, 1);
  assert.equal(harness.calls.confirm[0], pending.txId);
});

test("mining never selects a block without a click-derived hit", () => {
  const harness = createHarness({ clickedHit: { hit: false } });

  assert.equal(harness.controller.minePending(), null);
  assert.equal(harness.calls.selected.length, 0);
  assert.equal(harness.controller.activeSwing(), null);
});

test("out-of-range clicks do not create a selection outline", () => {
  const harness = createHarness({ targeting: { reachable: false, withinReachSphere: false } });

  assert.equal(harness.controller.minePending(), null);
  assert.equal(harness.calls.selected.length, 0);
});

test("clicks received during a swing are consumed instead of reused later", () => {
  const hits = [{ ...TARGET }, { ...TARGET }, { hit: false }];
  const harness = createHarness({ hitProvider: () => hits.shift() ?? { hit: false } });
  const first = harness.controller.minePending();

  assert.ok(first);
  assert.equal(harness.controller.minePending(), first);
  harness.controller.update(first.endsAt + 1);
  assert.equal(harness.controller.minePending(), null);
  assert.equal(harness.calls.selected.length, 1);
});

test("reward summaries always keep the clicked block before collapse rewards", () => {
  const leaf = {
    ...TARGET,
    worldX: TARGET.worldX + 1,
    blockId: 23,
    resourceId: 10,
  };
  const harness = createHarness({
    getMiningPlan: () => ({
      kind: "support-collapse",
      blocks: [TARGET, leaf],
      collapseBlocks: [leaf],
      rewardBlocks: [leaf],
    }),
    extraBlocks: [leaf],
  });

  mineThreeTimes(harness);

  const pending = harness.controller.pendingSnapshot()[0];
  assert.deepEqual(pending.rewardGroups, [
    { resourceId: TARGET.resourceId, blockId: TARGET.blockId, count: 1 },
    { resourceId: leaf.resourceId, blockId: leaf.blockId, count: 1 },
  ]);
});

test("authorized bulk mining keeps all blocks pending and assumes no local rewards", () => {
  const second = {
    ...TARGET,
    worldX: TARGET.worldX + 1,
    blockId: 8,
    resourceId: 80,
  };
  const harness = createHarness({ extraBlocks: [second] });

  const pending = harness.controller.queueBatchMine([TARGET, second], { authorization: "debug" });

  assert.equal(pending?.miningKind, "debug-bulk");
  assert.equal(pending?.lossyRewards, true);
  assert.equal(pending?.minedBlockCount, 2);
  assert.deepEqual(pending?.rewardGroups, []);
  assert.equal(harness.chunks.getBlockAtWorld(TARGET.worldX, TARGET.worldY, TARGET.worldZ), TARGET.blockId);
  assert.equal(harness.chunks.getBlockAtWorld(second.worldX, second.worldY, second.worldZ), second.blockId);

  harness.controller.confirmTx(pending.txId);

  assert.equal(harness.chunks.getBlockAtWorld(TARGET.worldX, TARGET.worldY, TARGET.worldZ), 0);
  assert.equal(harness.chunks.getBlockAtWorld(second.worldX, second.worldY, second.worldZ), 0);
  assert.equal(harness.gameState.playerProfile.resourcesCollected, 0);
  assert.equal(harness.gameState.hotbarSlots[0].durability, 20);
});

test("authorized bulk mining keeps all 640 selected blocks instead of truncating at the legacy limit", () => {
  const selected = [];
  for (let y = 0; y < 5; y += 1) {
    for (let z = 0; z < 8; z += 1) {
      for (let x = 0; x < 16; x += 1) {
        selected.push({
          ...TARGET,
          worldX: TARGET.worldX + x,
          worldY: TARGET.worldY + y,
          worldZ: TARGET.worldZ + z,
        });
      }
    }
  }
  const harness = createHarness({ extraBlocks: selected });

  const pending = harness.controller.queueBatchMine(selected, { authorization: "debug" });

  assert.equal(selected.length, 640);
  assert.equal(pending?.minedBlockCount, 640);
  assert.equal(pending?.blocks.length, 640);
  assert.equal(pending?.pendingDeltas.length, 640);
});

test("ordinary callers cannot enter the bulk mining path", () => {
  const harness = createHarness();
  assert.equal(harness.controller.queueBatchMine([TARGET]), null);
  assert.equal(harness.controller.pendingCount(), 0);
});

test("action overlays ignore automatic center hits and flash only pending clicks", () => {
  let rememberedHit = null;
  let rememberedUntil = 0;
  let pending = [];
  const chunks = { getBlockAtWorld: () => TARGET.blockId };
  const builder = createActionOverlayBuilder({
    getChunks: () => chunks,
    getMining: () => ({ pendingSnapshot: () => pending, activeSwing: () => null }),
    getPlacement: () => ({ previewForHit: () => null }),
    getLastMiningHit: () => rememberedHit,
    getLastMiningHitUntil: () => rememberedUntil,
  });

  assert.deepEqual(builder.build(TARGET, 1000), []);

  rememberedHit = { ...TARGET };
  rememberedUntil = 2000;
  const selected = builder.build({ hit: false }, 1000);
  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0].lineColor, [1, 1, 1, 0.74]);

  pending = [{ txId: "tx-1", ...TARGET }];
  const submitting = builder.build({ hit: false }, 1100);
  assert.equal(submitting.length, 1);
  assert.equal(submitting[0].worldX, TARGET.worldX);
  assert.ok(submitting[0].lineColor[3] >= 0.34 && submitting[0].lineColor[3] <= 0.98);
});

function createHarness({
  clickedHit = TARGET,
  hitProvider = null,
  targeting = { reachable: true, yaw: 0.4, pitchOffset: 0 },
  toolCount = 1,
  getMiningPlan = null,
  extraBlocks = [],
} = {}) {
  const blocks = new Map([[key(TARGET), TARGET.blockId], ...extraBlocks.map((block) => [key(block), block.blockId])]);
  const calls = { apply: [], confirm: [], rollback: [], selected: [], pending: [], confirmed: [], rolledBack: [] };
  const gameState = {
    hotbarSlots: Array.from({ length: toolCount }, () => ({ kind: "tool", durability: 20, maxDurability: 20 })),
    selectedToolIndex: 0,
    playerProfile: { minedBlocks: 0, confirmedMines: 0, resourcesCollected: 0, rolledBackMines: 0 },
    getSelectedToolSlot() {
      return { index: this.selectedToolIndex, slot: this.hotbarSlots[this.selectedToolIndex] };
    },
    isUsableMiningToolSlot(slot) {
      return Boolean(slot?.durability > 0);
    },
    saveHotbarSlots() {},
    savePlayerProfile() {},
    restoreToolDamage(index, amount) {
      const slot = this.hotbarSlots[index];
      slot.durability = Math.min(slot.maxDurability, slot.durability + amount);
    },
  };
  const chunks = {
    getBlockAtWorld(x, y, z) {
      return blocks.get(`${x},${y},${z}`) ?? 0;
    },
    applyPendingDelta(deltas, txId) {
      calls.apply.push({ txId, deltas: deltas.map((delta) => ({ ...delta })) });
      for (const delta of deltas) blocks.set(key(delta), delta.blockId);
    },
    confirmPendingDelta(txId) {
      calls.confirm.push(txId);
    },
    rollbackPendingDelta(txId) {
      calls.rollback.push(txId);
    },
  };
  const controller = createMiningController({
    gameState,
    chunks,
    getHit: hitProvider ?? (() => ({ ...clickedHit })),
    getPlayerBounds: () => ({ x: 2.5, y: 8, z: 4, height: 4 }),
    getToolTargetingSolution: () => ({ ...targeting }),
    getToolCollisionFrame: () => ({ boxes: [{ minX: 2, minY: 10, minZ: 3, maxX: 3, maxY: 11, maxZ: 4 }] }),
    blockDef: (blockId) => ({ name: `Block ${blockId}`, hardness: 1, resourceId: blockId * 10, materialId: blockId }),
    isFluidBlock: () => false,
    isMineableBlock: (blockId) => blockId !== 0,
    getMiningPlan,
    blockAirId: 0,
    canMine: () => true,
    onTargetSelected: (hit) => calls.selected.push(hit),
    onPending: (pending) => calls.pending.push(pending),
    onConfirm: (pending) => calls.confirmed.push(pending),
    onRollback: (pending) => calls.rolledBack.push(pending),
    swingDurationMs: 100,
  });
  return { controller, chunks, calls, gameState, blockId: () => blocks.get(key(TARGET)) };
}

function mineThreeTimes(harness) {
  for (let index = 0; index < 3; index += 1) {
    mineOnce(harness, index + 1);
  }
}

function mineOnce(harness, index = 1) {
  const swing = harness.controller.minePending();
  assert.ok(swing, `swing ${index} should start`);
  harness.controller.update(swing.endsAt + 1);
}

function key(block) {
  return `${Math.trunc(block.worldX)},${Math.trunc(block.worldY)},${Math.trunc(block.worldZ)}`;
}
