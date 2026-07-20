import { BLOCK_ID, blockDef } from "../chunk.js/world/block-registry.js";
import {
  createWorldGeneratorConfig,
  surfaceBlockAt,
  terrainSurfaceHeight,
  waterLevelAt,
} from "../chunk.js/world/world-generator.js";

export function createMinimapTerrainSampler(worldSeed) {
  const config = createWorldGeneratorConfig({ worldSeed });
  return {
    config,
    sampleAt,
    mapColorAt,
  };

  function sampleAt(worldX, worldZ) {
    const x = Math.trunc(worldX);
    const z = Math.trunc(worldZ);
    const surface = terrainSurfaceHeight(config, x, z);
    const water = waterLevelAt(config, x, z, surface);
    const blockId = water !== null && water > surface
      ? BLOCK_ID.water
      : surfaceBlockAt(config, x, z, surface);
    return {
      surface,
      blockId,
      fluid: isMapFluid(blockId),
      color: colorForSample(config, blockId, surface, x, z),
    };
  }

  function mapColorAt(worldX, worldZ, sampleDistance = 4) {
    const center = sampleAt(worldX, worldZ);
    const west = sampleAt(worldX - sampleDistance, worldZ);
    const east = sampleAt(worldX + sampleDistance, worldZ);
    const north = sampleAt(worldX, worldZ - sampleDistance);
    const south = sampleAt(worldX, worldZ + sampleDistance);
    return shadeSample(center, west, east, north, south);
  }
}

export function buildMinimapTilePixels(sampler, {
  tileX,
  tileZ,
  worldStep,
  tilePixels = 64,
  samples = 64,
} = {}) {
  const step = Math.max(1, Math.trunc(worldStep) || 1);
  const sampleCount = Math.max(8, Math.trunc(samples) || 64);
  const padded = sampleCount + 2;
  const sampleScale = tilePixels / sampleCount;
  const originX = Math.trunc(tileX) * tilePixels * step;
  const originZ = Math.trunc(tileZ) * tilePixels * step;
  const heights = new Int16Array(padded * padded);
  const fluid = new Uint8Array(padded * padded);
  const colors = new Uint8ClampedArray(padded * padded * 3);

  for (let pz = 0; pz < padded; pz += 1) {
    for (let px = 0; px < padded; px += 1) {
      const localX = px - 1;
      const localZ = pz - 1;
      const worldX = originX + Math.floor((localX + 0.5) * sampleScale * step);
      const worldZ = originZ + Math.floor((localZ + 0.5) * sampleScale * step);
      const sample = sampler.sampleAt(worldX, worldZ);
      const index = pz * padded + px;
      heights[index] = sample.surface;
      fluid[index] = sample.fluid ? 1 : 0;
      colors[index * 3] = sample.color[0];
      colors[index * 3 + 1] = sample.color[1];
      colors[index * 3 + 2] = sample.color[2];
    }
  }

  const pixels = new Uint8ClampedArray(sampleCount * sampleCount * 4);
  for (let z = 0; z < sampleCount; z += 1) {
    for (let x = 0; x < sampleCount; x += 1) {
      const centerIndex = (z + 1) * padded + x + 1;
      const westIndex = centerIndex - 1;
      const eastIndex = centerIndex + 1;
      const northIndex = centerIndex - padded;
      const southIndex = centerIndex + padded;
      const center = sampleFromFields(centerIndex);
      const west = sampleFromFields(westIndex);
      const east = sampleFromFields(eastIndex);
      const north = sampleFromFields(northIndex);
      const south = sampleFromFields(southIndex);
      const color = shadeSample(center, west, east, north, south);
      const output = (z * sampleCount + x) * 4;
      pixels[output] = color[0];
      pixels[output + 1] = color[1];
      pixels[output + 2] = color[2];
      pixels[output + 3] = 255;
    }
  }
  return pixels;

  function sampleFromFields(index) {
    return {
      surface: heights[index],
      fluid: fluid[index] === 1,
      color: [colors[index * 3], colors[index * 3 + 1], colors[index * 3 + 2]],
    };
  }
}

function shadeSample(center, west, east, north, south) {
  const sameSurface = [west, east, north, south].filter((sample) => sample.fluid === center.fluid);
  const divisor = 4 + sameSurface.length;
  const blended = [0, 1, 2].map((channel) => (
    center.color[channel] * 4 + sameSurface.reduce((sum, sample) => sum + sample.color[channel], 0)
  ) / divisor);
  const slopeX = west.surface - east.surface;
  const slopeZ = north.surface - south.surface;
  const relief = center.fluid ? 0 : clamp(Math.round(slopeX * 1.35 + slopeZ * 0.85), -26, 26);
  return blended.map((value) => clampByte(value + relief));
}

function colorForSample(config, blockId, surface, worldX, worldZ) {
  const base = baseColor(blockId);
  const relativeHeight = surface - config.seaLevel;
  const shade = clamp(Math.round(relativeHeight * 1.62), -38, 52);
  const waterShade = isMapFluid(blockId) ? clamp(Math.round((config.seaLevel - surface) * 4.2), 0, 76) : 0;
  const detail = smoothTerrainDetail(worldX, worldZ);
  const biomeBoost = biomeContrast(blockId, relativeHeight);
  return [
    clampByte(base[0] + shade * 0.30 - waterShade * 0.16 + detail + biomeBoost[0]),
    clampByte(base[1] + shade * 0.30 + detail + biomeBoost[1]),
    clampByte(base[2] + shade * 0.30 + waterShade * 0.40 + detail + biomeBoost[2]),
  ];
}

function baseColor(blockId) {
  switch (blockId) {
    case BLOCK_ID.water:
    case BLOCK_ID.swampWater:
    case BLOCK_ID.toxicWater:
      return [42, 151, 211];
    case BLOCK_ID.sand:
    case BLOCK_ID.saltFlat:
    case BLOCK_ID.shellBed:
      return [224, 196, 116];
    case BLOCK_ID.snow:
    case BLOCK_ID.ice:
    case BLOCK_ID.frozenSoil:
      return [229, 237, 232];
    case BLOCK_ID.stone:
    case BLOCK_ID.deepStone:
    case BLOCK_ID.gravel:
      return [128, 137, 130];
    case BLOCK_ID.basalt:
    case BLOCK_ID.ash:
      return [94, 94, 91];
    case BLOCK_ID.mud:
    case BLOCK_ID.clay:
      return [145, 109, 74];
    case BLOCK_ID.dryDirt:
    case BLOCK_ID.dirt:
      return [151, 105, 65];
    case BLOCK_ID.trunk:
    case BLOCK_ID.pineTrunk:
    case BLOCK_ID.deadWood:
    case BLOCK_ID.giantRoot:
      return [121, 82, 53];
    case BLOCK_ID.leaves:
    case BLOCK_ID.pineLeaves:
    case BLOCK_ID.bush:
    case BLOCK_ID.grassPlant:
    case BLOCK_ID.swampGrass:
      return [57, 133, 69];
    default: {
      const def = blockDef(blockId);
      return def.resourceId === 0 ? [103, 158, 89] : [94, 166, 82];
    }
  }
}

function biomeContrast(blockId, relativeHeight) {
  switch (blockId) {
    case BLOCK_ID.water:
    case BLOCK_ID.swampWater:
    case BLOCK_ID.toxicWater:
      return [0, 3, 10];
    case BLOCK_ID.sand:
    case BLOCK_ID.saltFlat:
    case BLOCK_ID.shellBed:
      return [8, 4, -7];
    case BLOCK_ID.snow:
    case BLOCK_ID.ice:
    case BLOCK_ID.frozenSoil:
      return [7, 8, 8];
    case BLOCK_ID.stone:
    case BLOCK_ID.deepStone:
    case BLOCK_ID.gravel:
      return relativeHeight > 34 ? [3, 3, 0] : [-3, -2, -4];
    case BLOCK_ID.mud:
    case BLOCK_ID.clay:
      return [4, -1, -8];
    default:
      return relativeHeight < 4 ? [-1, 5, -5] : [-5, 9, -7];
  }
}

function smoothTerrainDetail(worldX, worldZ) {
  const cellSize = 12;
  const gx = Math.floor(worldX / cellSize);
  const gz = Math.floor(worldZ / cellSize);
  const tx = smooth01(positiveModulo(worldX, cellSize) / cellSize);
  const tz = smooth01(positiveModulo(worldZ, cellSize) / cellSize);
  const n00 = detailNoise(gx, gz);
  const n10 = detailNoise(gx + 1, gz);
  const n01 = detailNoise(gx, gz + 1);
  const n11 = detailNoise(gx + 1, gz + 1);
  return Math.round(mix(mix(n00, n10, tx), mix(n01, n11, tx), tz) * 10 - 5);
}

function detailNoise(x, z) {
  const mixed = Math.imul((Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) >>> 0, 1274126177);
  return ((mixed ^ (mixed >>> 15)) >>> 0) / 0xffffffff;
}

function isMapFluid(blockId) {
  return blockId === BLOCK_ID.water || blockId === BLOCK_ID.swampWater || blockId === BLOCK_ID.toxicWater;
}

function positiveModulo(value, divisor) {
  return ((Math.trunc(value) % divisor) + divisor) % divisor;
}

function smooth01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
