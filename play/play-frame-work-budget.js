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

// One reserve per frame, shared by rotating lanes. A perpetually late host
// cannot starve one lane forever, nor grant four fresh full phase budgets.
export function createFrameServiceScheduler({ reserveMs = 0.8 } = {}) {
  const lanes = ["snapshot", "building", "mesh", "upload"];
  let frame = 0, reserveFrames = 0;
  const service = Object.fromEntries(lanes.map(lane => [lane, { zeroServiceFrames: 0, maximumZeroServiceFrames: 0, progressedFrames: 0, blockedFrames: 0 }]));
  return {
    beginFrame(options) {
      const budget = createFrameWorkBudget(options), lane = lanes[frame++ % lanes.length];
      let reservedDeadline = null;
      return { ...budget, serviceLane: lane, deadlineFor(stage, now = performance.now()) {
        if (stage !== lane) return budget.deadline;
        if (reservedDeadline === null) {
          reservedDeadline = Math.max(budget.deadline, now + Math.max(0.1, Math.min(1, reserveMs)));
          if (reservedDeadline > budget.deadline) reserveFrames++;
        }
        return reservedDeadline;
      } };
    },
    noteService({ lane = "snapshot", backlog = true, blocked = false, progressed = false } = {}) {
      const state = service[lane]; if (!state) return;
      if (blocked) state.blockedFrames++; if (progressed) state.progressedFrames++;
      if (!backlog || blocked || progressed) state.zeroServiceFrames = 0; else state.zeroServiceFrames++;
      state.maximumZeroServiceFrames = Math.max(state.maximumZeroServiceFrames, state.zeroServiceFrames);
    },
    snapshot: () => ({ frames: frame, reserveFrames, service: structuredClone(service), maximumScheduledGap: lanes.length - 1, reserveMs }),
  };
}
