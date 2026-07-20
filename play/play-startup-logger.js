const DEFAULT_PREFIX = "[NiceChunk Load]";
const CHUNK_SAMPLE_INTERVAL_MS = 250;
const LONG_TASK_LIMIT_MS = 50;
const LOADING_TASK_IDS = new Map([
  ["chunk delta persistent cache warm", "cache"],
  ["player PDA initial refresh", "player"],
  ["backpack PDA initial refresh", "backpack"],
  ["chunk PDA startup sync", "chunks"],
]);

export function createPlayStartupLogger({ enabled = true, prefix = DEFAULT_PREFIX } = {}) {
  const navigationStartAt = 0;
  const bootStartedAt = performance.now();
  const milestones = new Set();
  const chunkProgressMilestones = new Set();
  let frameCount = 0;
  let lastChunkSampleAt = -Infinity;
  let longTaskObserver = null;
  let longTaskCount = 0;
  let longTaskTotalMs = 0;
  let initialChunkTarget = 0;

  if (enabled) {
    installLongTaskObserver();
    scheduleResourceReport();
  }

  return {
    enabled,
    begin,
    end,
    fail,
    mark,
    step,
    track,
    rendererStage,
    logEnvironment,
    setInitialChunkTarget,
    noteFrame,
    stop,
  };

  function begin(label, details = null) {
    const startedAt = performance.now();
    if (enabled) write("START", label, null, startedAt, details);
    return { label, startedAt };
  }

  function end(token, details = null) {
    if (!token) return 0;
    const endedAt = performance.now();
    const elapsedMs = endedAt - token.startedAt;
    if (enabled) write("DONE", token.label, elapsedMs, endedAt, resolveDetails(details));
    return elapsedMs;
  }

  function fail(token, error, details = null) {
    const endedAt = performance.now();
    const elapsedMs = token ? endedAt - token.startedAt : 0;
    if (enabled) {
      console.error(`${prefix} FAIL ${token?.label || "unknown"} | ${formatMs(elapsedMs)} | T+${formatMs(endedAt - navigationStartAt)}`, {
        ...resolveDetails(details),
        error: String(error?.message || error || "unknown error"),
      });
    }
    return elapsedMs;
  }

  function mark(label, details = null) {
    if (!enabled) return;
    write("MARK", label, null, performance.now(), resolveDetails(details));
  }

  function step(label, callback, details = null) {
    const token = begin(label);
    try {
      const result = callback();
      end(token, typeof details === "function" ? () => details(result) : details);
      return result;
    } catch (error) {
      fail(token, error);
      throw error;
    }
  }

  function track(label, promise, details = null) {
    const token = begin(label, details);
    const loadingTaskId = LOADING_TASK_IDS.get(label);
    if (loadingTaskId) loadingApi()?.taskStart?.(loadingTaskId);
    return Promise.resolve(promise).then((result) => {
      end(token, () => summarizeResult(result));
      if (loadingTaskId) loadingApi()?.taskDone?.(loadingTaskId);
      return result;
    }, (error) => {
      fail(token, error);
      if (loadingTaskId) loadingApi()?.taskDone?.(loadingTaskId);
      throw error;
    });
  }

  function rendererStage(label, elapsedMs, details = null) {
    loadingApi()?.stage?.("engine", 0.52);
    if (!enabled) return;
    write("GPU", `WebGL2: ${label}`, elapsedMs, performance.now(), resolveDetails(details));
  }

  function logEnvironment(details = {}) {
    if (!enabled) return;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const rows = {
      userAgent: navigator.userAgent,
      logicalCpuCores: navigator.hardwareConcurrency || "unknown",
      deviceMemoryGb: navigator.deviceMemory || "unknown",
      connection: connection?.effectiveType || "unknown",
      downlinkMbps: connection?.downlink ?? "unknown",
      viewport: `${innerWidth}x${innerHeight}`,
      devicePixelRatio: globalThis.devicePixelRatio || 1,
      visibility: document.visibilityState,
      crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
      ...details,
    };
    console.groupCollapsed(`${prefix} runtime environment | T+${formatMs(performance.now())}`);
    console.table(rows);
    console.groupEnd();
  }

  function setInitialChunkTarget(count) {
    initialChunkTarget = Math.max(0, Math.trunc(Number(count) || 0));
    loadingApi()?.stage?.("chunks", 0.8);
    mark("initial chunk range queued", { chunks: initialChunkTarget });
  }

  function noteFrame(now, { getWorldStats = null, worldStats = null, renderStats = null, uploadStats = null } = {}) {
    frameCount += 1;
    if (!milestones.has("first-frame")) {
      milestones.add("first-frame");
      mark("first requestAnimationFrame rendered", {
        frame: frameCount,
        visibleChunks: renderStats?.visibleChunks || 0,
        drawCalls: renderStats?.drawCalls || 0,
        triangles: renderStats?.triangles || 0,
      });
    }
    if ((renderStats?.visibleChunks || 0) > 0 && !milestones.has("first-world")) {
      milestones.add("first-world");
      loadingApi()?.worldReady?.();
      mark("first visible world frame", {
        frame: frameCount,
        visibleChunks: renderStats.visibleChunks,
        drawCalls: renderStats.drawCalls || 0,
        triangles: renderStats.triangles || 0,
      });
    }
    if ((uploadStats?.uploaded || 0) > 0 && !milestones.has("first-upload")) {
      milestones.add("first-upload");
      mark("first GPU chunk upload", uploadStats);
    }
    if (now - lastChunkSampleAt < CHUNK_SAMPLE_INTERVAL_MS) return;
    lastChunkSampleAt = now;
    const stats = worldStats || (typeof getWorldStats === "function" ? getWorldStats() : null);
    if (stats) reportChunkProgress(stats, renderStats);
  }

  function reportChunkProgress(stats, renderStats) {
    const target = initialChunkTarget || stats.chunks || 1;
    const ready = Math.max(0, stats.ready || 0);
    const ratio = ready / Math.max(1, target);
    loadingApi()?.worldProgress?.(Math.min(1, ratio));
    const thresholds = [
      ["first", ready > 0],
      ["25%", ratio >= 0.25],
      ["50%", ratio >= 0.5],
      ["75%", ratio >= 0.75],
      ["100%", ready >= target && stats.buildQueue === 0 && stats.inFlightBuilds === 0],
    ];
    for (const [label, reached] of thresholds) {
      if (!reached || chunkProgressMilestones.has(label)) continue;
      chunkProgressMilestones.add(label);
      mark(`initial chunks ready ${label}`, {
        ready,
        target,
        queued: stats.buildQueue || 0,
        inFlight: stats.inFlightBuilds || 0,
        workers: stats.workers || 0,
        uploadedChunks: stats.uploaded || 0,
        visibleChunks: renderStats?.visibleChunks || 0,
        workerLastMs: round(stats.lastWorkerBuildMs || 0),
      });
    }
    if (chunkProgressMilestones.has("100%") && !milestones.has("startup-summary")) {
      milestones.add("startup-summary");
      const elapsedMs = performance.now() - bootStartedAt;
      if (enabled) {
        console.info(`${prefix} READY initial world generation | ${formatMs(elapsedMs)} since boot | T+${formatMs(performance.now())}`, {
          chunks: target,
          uploadedChunks: stats.uploaded || 0,
          longTasks: longTaskCount,
          longTaskTotalMs: round(longTaskTotalMs),
        });
      }
      stop();
    }
  }

  function installLongTaskObserver() {
    if (typeof PerformanceObserver !== "function") return;
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < LONG_TASK_LIMIT_MS) continue;
          longTaskCount += 1;
          longTaskTotalMs += entry.duration;
          console.warn(`${prefix} LONG main-thread task | ${formatMs(entry.duration)} | T+${formatMs(entry.startTime)}`, {
            name: entry.name,
            startTime: round(entry.startTime),
          });
        }
      });
      longTaskObserver.observe({ type: "longtask", buffered: true });
    } catch {
      longTaskObserver = null;
    }
  }

  function scheduleResourceReport() {
    const report = () => globalThis.setTimeout(reportResources, 0);
    if (document.readyState === "complete") report();
    else globalThis.addEventListener("load", report, { once: true });
  }

  function reportResources() {
    const navigation = performance.getEntriesByType("navigation")[0];
    if (navigation) {
      console.groupCollapsed(`${prefix} browser navigation timing | ${formatMs(navigation.duration)}`);
      console.table({
        redirect: round(navigation.redirectEnd - navigation.redirectStart),
        dns: round(navigation.domainLookupEnd - navigation.domainLookupStart),
        tcpTls: round(navigation.connectEnd - navigation.connectStart),
        requestToFirstByte: round(navigation.responseStart - navigation.requestStart),
        responseDownload: round(navigation.responseEnd - navigation.responseStart),
        domInteractive: round(navigation.domInteractive),
        domContentLoaded: round(navigation.domContentLoadedEventEnd),
        windowLoad: round(navigation.loadEventEnd || performance.now()),
      });
      console.groupEnd();
    }
    const resources = performance.getEntriesByType("resource")
      .map((entry) => ({
        resource: safeResourceName(entry.name),
        type: entry.initiatorType || "other",
        startMs: round(entry.startTime),
        durationMs: round(entry.duration),
        transferKb: entry.transferSize ? round(entry.transferSize / 1024) : "cached/unknown",
      }))
      .sort((a, b) => b.durationMs - a.durationMs);
    console.groupCollapsed(`${prefix} resource timings (${resources.length}, slowest first)`);
    console.table(resources);
    console.groupEnd();
  }

  function stop() {
    longTaskObserver?.disconnect();
    longTaskObserver = null;
  }

  function write(kind, label, elapsedMs, at, details) {
    const duration = elapsedMs == null ? "" : ` | ${formatMs(elapsedMs)}`;
    const suffix = details && Object.keys(details).length ? details : "";
    console.info(`${prefix} ${kind} ${label}${duration} | T+${formatMs(at - navigationStartAt)}`, suffix);
  }
}

function loadingApi() {
  return globalThis.NiceChunkLoading;
}

function resolveDetails(details) {
  if (typeof details === "function") return details() || {};
  return details && typeof details === "object" ? details : {};
}

function summarizeResult(result) {
  if (!result || typeof result !== "object") return { result };
  const summary = {};
  for (const key of [
    "ok",
    "reason",
    "changed",
    "requestedChunks",
    "batchCount",
    "deltaCount",
    "invalidAccountCount",
    "failedBatchCount",
    "contextSlot",
    "transport",
    "count",
  ]) {
    if (result[key] !== undefined) summary[key] = result[key];
  }
  return summary;
}

function safeResourceName(value) {
  try {
    const url = new URL(value, location.href);
    return url.origin === location.origin ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return String(value || "").split("?")[0];
  }
}

function round(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function formatMs(value) {
  return `${round(value).toFixed(1)} ms`;
}
