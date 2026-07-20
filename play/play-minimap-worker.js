import { buildMinimapTilePixels, createMinimapTerrainSampler } from "./play-minimap-terrain.js";

let sampler = null;

self.onmessage = (event) => {
  const task = event.data;
  if (!task) return;
  if (task.type === "init") {
    sampler = createMinimapTerrainSampler(task.worldSeed);
    return;
  }
  if (task.type !== "tile" || !sampler) return;
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
};
