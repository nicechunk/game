import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getChunkSnapshotApplyBudget } from "../play-chain-apply-budget.js";

test("snapshot preparation retains nominal budgets and scales low-cadence work with a bounded CPU cap", () => {
  assert.deepEqual(getChunkSnapshotApplyBudget({ moving: true }), { budgetMs: 0.45, maxDeltas: 64, maxPreparationEntries: 2048 });
  assert.deepEqual(getChunkSnapshotApplyBudget(), { budgetMs: 1.8, maxDeltas: 320, maxPreparationEntries: 8192 });
  assert.deepEqual(getChunkSnapshotApplyBudget({ moving: true, frameIntervalMs: 1000 / 30 }), { budgetMs: 0.9, maxDeltas: 128, maxPreparationEntries: 4096 });
  assert.deepEqual(getChunkSnapshotApplyBudget({ moving: true, frameIntervalMs: 200 }), { budgetMs: 4, maxDeltas: 569, maxPreparationEntries: 16384 });
});

test("suspension, invalid intervals and high frame rates cannot create unbounded or zero snapshot work", () => {
  for (const moving of [true, false]) for (const frameIntervalMs of [undefined, NaN, Infinity, -1, 0, 1, 8, 16.6667, 33, 200, 1e12]) {
    const budget = getChunkSnapshotApplyBudget({ moving, frameIntervalMs });
    assert.ok(budget.budgetMs >= (moving ? 0.45 : 1.8) && budget.budgetMs <= 4);
    assert.ok(budget.maxDeltas >= (moving ? 64 : 320) && budget.maxDeltas <= 2048);
    assert.ok(budget.maxPreparationEntries >= (moving ? 2048 : 8192) && budget.maxPreparationEntries <= 16384);
  }
});

test("the production frame synchronizer measures actual frame spacing and resets preparation cadence explicitly", async () => {
  // Only browser session event constants are substituted; frame scheduling and
  // its imported budget helper execute unchanged production code.
  const url = new URL("../play-chain-frame-sync.js", import.meta.url);
  let source = await readFile(url, "utf8");
  source = source.replace('"./play-chain-session.js"', JSON.stringify("data:text/javascript,export const RPC_CONFIG_CHANGED_EVENT='rpc';export const WALLET_SESSION_CHANGED_EVENT='wallet';"));
  source = source.replace('"./play-chain-apply-budget.js"', JSON.stringify(new URL("../play-chain-apply-budget.js", import.meta.url).href));
  const { createPlayChainFrameSync } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const applied = [];
  const session = createPlayChainFrameSync({ getChainChunkDeltas: () => ({ applyQueuedDeltas: (budget) => applied.push(budget), requestSync() {} }) });
  session.updateChunkDeltasForFrame(1000, { moving: true });
  session.updateChunkDeltasForFrame(1200, { moving: true });
  assert.deepEqual(applied[0], getChunkSnapshotApplyBudget({ moving: true }));
  assert.deepEqual(applied[1], getChunkSnapshotApplyBudget({ moving: true, frameIntervalMs: 200 }));
  session.resetTimers({ chunkDeltas: true });
  session.updateChunkDeltasForFrame(1e9, { moving: true });
  assert.deepEqual(applied[2], getChunkSnapshotApplyBudget({ moving: true }), "a reset cannot spend a tab suspension as unlimited catch-up work");
});
