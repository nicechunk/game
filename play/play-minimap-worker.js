import { buildMinimapTilePixels, createMinimapTerrainSampler } from "./play-minimap-terrain.js";

let sampler = null;
let scheduled = false;
let retained = null;
const queued = new Map();
const MAX_PENDING_TILES = 48;

self.onmessage = (event) => {
  const task = event.data;
  if (!task) return;
  if (task.type === "init") {
    sampler = createMinimapTerrainSampler(task.worldSeed);
    queued.clear(); retained = null;
    return;
  }
  if (task.type === "retain") {
    retained = new Set(task.keys);
    for (const key of queued.keys()) if (!retained.has(key)) queued.delete(key);
    return;
  }
  if (task.type !== "tile" || !sampler) return;
  if (retained && !retained.has(task.key)) return;
  if (!queued.has(task.key) && queued.size >= MAX_PENDING_TILES) return;
  queued.set(task.key, task);
  if (!scheduled) { scheduled = true; setTimeout(pump, 0); }
};

function pump() {
  scheduled = false;
  const task = queued.values().next().value;
  if (!task) return;
  queued.delete(task.key);
  const startedAt = performance.now();
  try {
    const pixels = buildMinimapTilePixels(sampler, task);
    self.postMessage({
      type: "tile",
      key: task.key,
      samples: task.samples,
      pixels,
      elapsedMs: performance.now() - startedAt,
    }, [pixels.buffer]);
  } catch (error) {
    self.postMessage({
      type: "error",
      key: task.key,
      error: error?.message || String(error),
    });
  }
  if (queued.size) { scheduled = true; setTimeout(pump, 0); }
}
