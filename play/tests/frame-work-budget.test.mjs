import assert from "node:assert/strict";
import test from "node:test";
import { createFrameWorkBudget, remainingFrameWorkMs } from "../play-frame-work-budget.js";
import { createPlayFrameProbe } from "../play-frame-probe.js";

test("shared streaming deadlines reserve the same allowance across phases and bound resumed frames", () => {
  const budget = createFrameWorkBudget({ rawFrameIntervalMs: 1000 / 60, startedAt: 100, now: 101 });
  assert.equal(budget.deadline, 105);
  assert.equal(remainingFrameWorkMs(budget.deadline, 10, 102), 3);
  assert.equal(remainingFrameWorkMs(budget.deadline, 10, 106), 0);
  assert.equal(createFrameWorkBudget({ rawFrameIntervalMs: 20_000, startedAt: 100, now: 100 }).allowanceMs, 5.5);
});

test("frame diagnostics retain raw rAF stalls independently of physics clamp with a bounded sample ring", () => {
  const probe = createPlayFrameProbe({ sampleLimit: 16, longTaskWarnMs: Infinity });
  for (let frame = 0; frame < 32; frame++) {
    const state = probe.begin(frame * 250);
    state.dtMs = 50;
    probe.mark(state, "apply"); probe.end(state);
  }
  const snapshot = probe.snapshot();
  assert.equal(snapshot.rawFrameMs.samples, 16);
  assert.equal(snapshot.rawFrameMs.p99, 250);
  assert.equal(snapshot.stages.apply.samples, 32);
  assert.equal(probe.snapshot(), snapshot, "diagnostic sorting is rate limited");
});
