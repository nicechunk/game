// Pure bounded scheduling shared by chain reads and host streaming.
export function createStreamingWorkPool({ concurrency = 3, capacity = 64 } = {}) {
  const limit = Math.max(1, Math.min(4, Math.trunc(concurrency) || 1));
  const queue = [];
  let active = 0;
  let peakActive = 0;
  let completed = 0;
  function pump() {
    while (active < limit && queue.length) {
      const task = queue.shift();
      if (task.signal?.aborted) { task.reject(aborted()); continue; }
      active++;
      peakActive = Math.max(active, peakActive);
      Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => {
        active--;
        completed++;
        pump();
      });
    }
  }
  return {
    run(run, { priority = 0, signal = null } = {}) {
      if (queue.length >= capacity) return Promise.reject(new Error("Streaming queue capacity exceeded."));
      if (signal?.aborted) return Promise.reject(aborted());
      return new Promise((resolve, reject) => {
        const task = { run, resolve, reject, priority, signal };
        const position = queue.findIndex((entry) => entry.priority > priority);
        if (position < 0) queue.push(task); else queue.splice(position, 0, task);
        queueMicrotask(pump);
      });
    },
    snapshot: () => ({ active, queued: queue.length, peakActive, completed, concurrency: limit, capacity }),
  };
}

export function streamingContextKey(value) {
  if (value == null || typeof value !== "object") return String(value ?? "default");
  if (Array.isArray(value)) return JSON.stringify(value.map(streamingContextKey));
  return JSON.stringify(Object.keys(value).sort().map((key) => [key, streamingContextKey(value[key])]));
}

export async function mapStreaming(items, transform, concurrency = 3) {
  const values = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    while (cursor < items.length) { const index = cursor++; values[index] = await transform(items[index], index); }
  }));
  return values;
}

export function foundationCoversChunk(foundation, coordinate, size = 16) {
  const minX = Number(foundation.minX), minZ = Number(foundation.minZ);
  const maxX = minX + Number(foundation.width) - 1, maxZ = minZ + Number(foundation.depth) - 1;
  return minX <= (coordinate.chunkX + 1) * size - 1 && maxX >= coordinate.chunkX * size
    && minZ <= (coordinate.chunkZ + 1) * size - 1 && maxZ >= coordinate.chunkZ * size;
}

function aborted() {
  return Object.assign(new Error("Streaming work cancelled."), { name: "AbortError" });
}
