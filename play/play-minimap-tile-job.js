// A fallback tile retains its cursor and publishes only a complete image.
export function createMinimapTileJob({ tileX, tileZ, worldStep, samples, tilePixels = 32,
  sampleScale = tilePixels / samples, sampleOffset = 0.5, mapColorAt, iterator = null }) {
  let pixels = iterator ? null : new Uint8ClampedArray(samples * samples * 4);
  const step = Math.max(1, Math.trunc(worldStep) || 1);
  const originX = tileX * tilePixels * step, originZ = tileZ * tilePixels * step;
  let cursor = 0;
  return {
    get pixels() { return pixels; },
    advance({ deadline = Infinity, maxSamples = 32, now = () => performance.now() } = {}) {
      let sampled = 0;
      if (iterator) {
        while (!pixels && sampled < maxSamples && now() < deadline) {
          const result = iterator.next(); sampled++; cursor++;
          if (result.done) pixels = result.value;
        }
        return { done: Boolean(pixels), sampled, completedSamples: cursor };
      }
      while (cursor < samples * samples && sampled < maxSamples && now() < deadline) {
        const x = cursor % samples, z = Math.floor(cursor / samples);
        const color = mapColorAt(originX + Math.floor((x + sampleOffset) * sampleScale * step),
          originZ + Math.floor((z + sampleOffset) * sampleScale * step));
        const offset = cursor++ * 4;
        pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = 255;
        sampled++;
      }
      return { done: cursor === samples * samples, sampled, completedSamples: cursor };
    },
  };
}
