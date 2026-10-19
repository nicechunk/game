const DEFAULT_LONG_TASK_WARN_MS = 80;
const DEFAULT_SEGMENT_WARN_MS = 24;
const DEFAULT_NOTICE_MS = 2000;

export function createPlayFrameProbe({
  renderLog = null,
  longTaskWarnMs = DEFAULT_LONG_TASK_WARN_MS,
  segmentWarnMs = DEFAULT_SEGMENT_WARN_MS,
  noticeMs = DEFAULT_NOTICE_MS,
  consoleWarn = (...args) => console.warn(...args),
  sampleLimit = 240,
} = {}) {
  let lastNoticeAt = 0;
  let lastRafNow = null;
  const capacity = Math.min(2048, Math.max(16, Math.trunc(sampleLimit) || 240));
  const intervals = new Float64Array(capacity);
  const cpuTimes = new Float64Array(capacity);
  const stages = new Map();
  let sampleCursor = 0, sampleCount = 0;
  let cachedSnapshot = null, snapshotAt = -Infinity;

  return {
    begin,
    mark,
    end,
    reset,
    snapshot,
  };

  function begin(now) {
    const startedAt = performance.now();
    const rawFrameIntervalMs = lastRafNow === null ? 0 : Math.max(0, now - lastRafNow);
    lastRafNow = now;
    return {
      rafNow: now,
      startedAt,
      lastAt: startedAt,
      slowSegments: [],
      dtMs: 0,
      rawFrameIntervalMs,
    };
  }

  function mark(probe, label) {
    if (!probe) return;
    const at = performance.now();
    const elapsedMs = at - probe.lastAt;
    let stats = stages.get(label);
    if (!stats && stages.size < 64) stages.set(label, stats = { count: 0, totalMs: 0, maxMs: 0 });
    if (stats) { stats.count++; stats.totalMs += elapsedMs; stats.maxMs = Math.max(stats.maxMs, elapsedMs); }
    if (elapsedMs >= segmentWarnMs) probe.slowSegments.push({ label, elapsedMs });
    probe.lastAt = at;
  }

  function end(probe) {
    if (!probe) return null;
    const totalMs = performance.now() - probe.startedAt;
    intervals[sampleCursor] = probe.rawFrameIntervalMs;
    cpuTimes[sampleCursor] = totalMs;
    sampleCursor = (sampleCursor + 1) % capacity;
    sampleCount = Math.min(capacity, sampleCount + 1);
    if (totalMs < longTaskWarnMs && !probe.slowSegments.length) return null;
    const now = performance.now();
    if (now - lastNoticeAt < noticeMs) return null;
    lastNoticeAt = now;
    const entry = {
      frame: renderLog?.frame ?? 0,
      elapsedMs: totalMs,
      dtMs: probe.dtMs || 0,
      rawFrameIntervalMs: probe.rawFrameIntervalMs,
      slowSegments: probe.slowSegments.map((item) => `${item.label}:${item.elapsedMs.toFixed(1)}ms`).join(", "),
    };
    renderLog?.record?.("frame-long-task", entry);
    if (totalMs >= longTaskWarnMs) consoleWarn("[NiceChunk frame probe]", entry);
    return entry;
  }

  function reset() {
    lastNoticeAt = 0;
    lastRafNow = null; sampleCursor = 0; sampleCount = 0;
    stages.clear(); cachedSnapshot = null; snapshotAt = -Infinity;
  }

  function snapshot(now = performance.now()) {
    if (cachedSnapshot && now - snapshotAt < 1000) return cachedSnapshot;
    snapshotAt = now;
    const distribution = storage => {
      const values = Array.from(storage.subarray(0, sampleCount)).filter(value => value > 0).sort((a, b) => a - b);
      const quantile = p => values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))] : null;
      return { samples: values.length, p50: quantile(0.50), p95: quantile(0.95), p99: quantile(0.99) };
    };
    cachedSnapshot = { rawFrameMs: distribution(intervals), cpuFrameMs: distribution(cpuTimes),
      stages: Object.fromEntries([...stages].map(([name, stats]) => [name,
        { samples: stats.count, meanMs: stats.count ? stats.totalMs / stats.count : 0, maxMs: stats.maxMs }])) };
    return cachedSnapshot;
  }
}
