const DEFAULT_INTERVAL_MS = 1000 / 60;

// State application, mesh publication and uploads spend one shared allowance.
// Physics retains its own bounded dt; a clamped dt never conceals a long rAF.
export function createFrameWorkBudget({ rawFrameIntervalMs = DEFAULT_INTERVAL_MS,
  startedAt = performance.now(), now = performance.now() } = {}) {
  const interval = Number.isFinite(rawFrameIntervalMs) && rawFrameIntervalMs > 0
    ? rawFrameIntervalMs : DEFAULT_INTERVAL_MS;
  const allowanceMs = Math.min(5.5, Math.max(2, interval * 0.30));
  return { allowanceMs, deadline: Math.max(now, startedAt + allowanceMs) };
}

export function remainingFrameWorkMs(deadline, maxBudgetMs = Infinity, now = performance.now()) {
  return Math.max(0, Math.min(maxBudgetMs, deadline - now));
}
