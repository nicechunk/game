const NOMINAL_FRAME_INTERVAL_MS = 1000 / 60;
const MAX_APPLY_BUDGET_MS = 4;
const MAX_APPLY_DELTAS = 2048;
const MAX_PREPARATION_ENTRIES = 16_384;

// Preserve nominal per-second preparation throughput when rendering is slower
// than 60Hz, without turning a long frame or resumed tab into unbounded work.
export function getChunkSnapshotApplyBudget({ moving = false, frameIntervalMs = NOMINAL_FRAME_INTERVAL_MS } = {}) {
  const interval = Number(frameIntervalMs);
  const timeScale = Number.isFinite(interval) && interval > 0 ? Math.max(1, interval / NOMINAL_FRAME_INTERVAL_MS) : 1;
  const baseBudget = moving ? 0.45 : 1.8;
  const budgetMs = Math.min(MAX_APPLY_BUDGET_MS, baseBudget * timeScale);
  const boundedScale = budgetMs / baseBudget;
  return {
    budgetMs,
    maxDeltas: Math.min(MAX_APPLY_DELTAS, Math.round((moving ? 64 : 320) * boundedScale)),
    maxPreparationEntries: Math.min(MAX_PREPARATION_ENTRIES, Math.round((moving ? 2048 : 8192) * boundedScale)),
  };
}
