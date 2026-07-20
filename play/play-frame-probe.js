const DEFAULT_LONG_TASK_WARN_MS = 80;
const DEFAULT_SEGMENT_WARN_MS = 24;
const DEFAULT_NOTICE_MS = 2000;

export function createPlayFrameProbe({
  renderLog = null,
  longTaskWarnMs = DEFAULT_LONG_TASK_WARN_MS,
  segmentWarnMs = DEFAULT_SEGMENT_WARN_MS,
  noticeMs = DEFAULT_NOTICE_MS,
  consoleWarn = (...args) => console.warn(...args),
} = {}) {
  let lastNoticeAt = 0;

  return {
    begin,
    mark,
    end,
    reset,
  };

  function begin(now) {
    const startedAt = performance.now();
    return {
      rafNow: now,
      startedAt,
      lastAt: startedAt,
      slowSegments: [],
      dtMs: 0,
    };
  }

  function mark(probe, label) {
    if (!probe) return;
    const at = performance.now();
    const elapsedMs = at - probe.lastAt;
    if (elapsedMs >= segmentWarnMs) probe.slowSegments.push({ label, elapsedMs });
    probe.lastAt = at;
  }

  function end(probe) {
    if (!probe) return null;
    const totalMs = performance.now() - probe.startedAt;
    if (totalMs < longTaskWarnMs && !probe.slowSegments.length) return null;
    const now = performance.now();
    if (now - lastNoticeAt < noticeMs) return null;
    lastNoticeAt = now;
    const entry = {
      frame: renderLog?.frame ?? 0,
      elapsedMs: totalMs,
      dtMs: probe.dtMs || 0,
      slowSegments: probe.slowSegments.map((item) => `${item.label}:${item.elapsedMs.toFixed(1)}ms`).join(", "),
    };
    renderLog?.record?.("frame-long-task", entry);
    if (totalMs >= longTaskWarnMs) consoleWarn("[NiceChunk frame probe]", entry);
    return entry;
  }

  function reset() {
    lastNoticeAt = 0;
  }
}
