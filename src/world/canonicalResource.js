import { maxBuildY, maxTerrainHeight, minBuildY, seaLevel } from "./config.js";
import { EMPTY_BLOCK, WorldMapBlock, renderTypeForBlock } from "./blocks.js";

const defaultSeedBytes = new Uint8Array(32).fill(7);
let activeConfig = null;
const canonicalCacheLimit = 150000;
const seedSaltHashCache = new WeakMap();

export function setCanonicalWorldConfig(config = null) {
  const parts = canonicalConfigParts(config);
  if (activeConfig?.signature === parts.signature) return activeConfig;
  activeConfig = createCanonicalConfig(parts);
  return activeConfig;
}

export function canonicalBlockIdAt({ x, y, z, worldSeed = null, config = null } = {}) {
  const cfg = resolveCanonicalConfig(config, worldSeed);
  return canonicalBlockId(cfg, Math.trunc(Number(x) || 0), Math.trunc(Number(y) || 0), Math.trunc(Number(z) || 0));
}

export function canonicalRenderTypeAt(input = {}) {
  return renderTypeForBlock(canonicalBlockIdAt(input));
}

export function canonicalSurfaceHeightAt({ x, z, worldSeed = null, config = null } = {}) {
  const cfg = resolveCanonicalConfig(config, worldSeed);
  return canonicalSurfaceHeight(cfg, Math.trunc(Number(x) || 0), Math.trunc(Number(z) || 0));
}

export function canonicalWaterLevelAt({ x, z, surface = null, worldSeed = null, config = null } = {}) {
  const cfg = resolveCanonicalConfig(config, worldSeed);
  const worldX = Math.trunc(Number(x) || 0);
  const worldZ = Math.trunc(Number(z) || 0);
  const ground = surface === null || surface === undefined ? canonicalSurfaceHeight(cfg, worldX, worldZ) : Math.trunc(Number(surface) || 0);
  return canonicalWaterLevel(cfg, worldX, worldZ, ground);
}

export function canonicalAboveSurfaceBlocksInArea({ minX, maxX, minZ, maxZ, worldSeed = null, config = null } = {}) {
  const cfg = resolveCanonicalConfig(config, worldSeed);
  const x0 = Math.trunc(Number(minX) || 0);
  const x1 = Math.trunc(Number(maxX) || 0);
  const z0 = Math.trunc(Number(minZ) || 0);
  const z1 = Math.trunc(Number(maxZ) || 0);
  const out = [];
  const occupied = new Set();

  for (let treeZ = z0 - 2; treeZ <= z1 + 2; treeZ += 1) {
    for (let treeX = x0 - 2; treeX <= x1 + 2; treeX += 1) {
      const surface = canonicalSurfaceHeight(cfg, treeX, treeZ);
      if (!canonicalCanGrowTree(cfg, treeX, treeZ, surface)) continue;
      const tree = canonicalTreeAt(cfg, treeX, treeZ, surface);
      if (!tree.exists) continue;
      appendCanonicalTreeBlocks(cfg, tree, x0, x1, z0, z1, occupied, out);
    }
  }

  return out;
}

export function canonicalTreeFellBlocks({ x, y, z, worldSeed = null, config = null } = {}) {
  const cfg = resolveCanonicalConfig(config, worldSeed);
  const cutX = Math.trunc(Number(x) || 0);
  const cutY = Math.trunc(Number(y) || 0);
  const cutZ = Math.trunc(Number(z) || 0);
  const cutBlock = canonicalBlockId(cfg, cutX, cutY, cutZ);
  if (cutBlock !== WorldMapBlock.Trunk && cutBlock !== WorldMapBlock.PineTrunk) return [];

  const surface = canonicalSurfaceHeight(cfg, cutX, cutZ);
  const tree = canonicalTreeAt(cfg, cutX, cutZ, surface);
  if (!tree.exists) return [];

  const out = [];
  const topY = surface + 9;
  for (let blockY = cutY; blockY <= topY; blockY += 1) {
    for (let blockZ = cutZ - 2; blockZ <= cutZ + 2; blockZ += 1) {
      for (let blockX = cutX - 2; blockX <= cutX + 2; blockX += 1) {
        const treeBlock = canonicalTreeVolumeBlock(cfg, tree, blockX, blockY, blockZ);
        if (treeBlock === EMPTY_BLOCK) continue;
        const actualBlock = canonicalBlockId(cfg, blockX, blockY, blockZ);
        if (actualBlock !== treeBlock) continue;
        const type = renderTypeForBlock(actualBlock);
        if (!type) continue;
        out.push({ x: blockX, y: blockY, z: blockZ, block: actualBlock, type, key: `${blockX},${blockY},${blockZ}` });
      }
    }
  }
  return out;
}

export function isCanonicalMineableBlockId(blockId) {
  return ![EMPTY_BLOCK, WorldMapBlock.Water, WorldMapBlock.Bedrock].includes(Number(blockId));
}

function normalizeCanonicalConfig(config = null) {
  return createCanonicalConfig(canonicalConfigParts(config));
}

function canonicalConfigParts(config = null) {
  const seedInput = config?.worldSeed ?? config?.worldSeedHex ?? config?.seed ?? null;
  const worldSeed = normalizeSeedBytes(seedInput);
  const normalized = {
    worldSeed,
    minBuildY: finiteInt(config?.minBuildY, minBuildY),
    maxBuildY: finiteInt(config?.maxBuildY, maxBuildY),
    maxTerrainHeight: finiteInt(config?.maxTerrainHeight, maxTerrainHeight),
    seaLevel: finiteInt(config?.seaLevel, seaLevel),
  };
  normalized.signature = `${seedBytesHex(worldSeed)}:${normalized.minBuildY}:${normalized.maxBuildY}:${normalized.maxTerrainHeight}:${normalized.seaLevel}`;
  return normalized;
}

function createCanonicalConfig(parts) {
  return {
    worldSeed: parts.worldSeed,
    minBuildY: parts.minBuildY,
    maxBuildY: parts.maxBuildY,
    maxTerrainHeight: parts.maxTerrainHeight,
    seaLevel: parts.seaLevel,
    signature: parts.signature,
    cache: {
      block: new Map(),
      surface: new Map(),
      terrain: new Map(),
      water: new Map(),
    },
  };
}

function resolveCanonicalConfig(config = null, worldSeed = null) {
  if (config || worldSeed !== null && worldSeed !== undefined) {
    const parts = canonicalConfigParts(config ?? { worldSeed });
    if (activeConfig?.signature === parts.signature) return activeConfig;
    return createCanonicalConfig(parts);
  }
  if (activeConfig) return activeConfig;
  return normalizeCanonicalConfig(null);
}

function canonicalBlockId(cfg, x, y, z) {
  const cacheKey = `${x},${y},${z}`;
  const cached = cfg.cache?.block?.get(cacheKey);
  if (cached !== undefined) return cached;
  const blockId = canonicalBlockIdUncached(cfg, x, y, z);
  cacheSetBounded(cfg.cache?.block, cacheKey, blockId);
  return blockId;
}

function canonicalBlockIdUncached(cfg, x, y, z) {
  if (y <= cfg.minBuildY) return WorldMapBlock.Bedrock;
  if (y > cfg.maxBuildY) return EMPTY_BLOCK;

  const surface = canonicalSurfaceHeight(cfg, x, z);
  if (y > surface) {
    const waterLevel = canonicalWaterLevel(cfg, x, z, surface);
    if (waterLevel !== null && y <= waterLevel) return WorldMapBlock.Water;
    const treeBlock = canonicalTreeBlockIdAt(cfg, x, y, z);
    if (treeBlock !== EMPTY_BLOCK) return treeBlock;
    return EMPTY_BLOCK;
  }

  if (y === surface) return canonicalSurfaceBlockId(cfg, x, z, surface);

  const depth = surface - y;
  if (depth <= 3) return canonicalSubsurfaceBlockId(cfg, x, z, surface);
  if (depth >= 8 && canonicalCoalSeamAt(cfg, x, y, z, surface)) return WorldMapBlock.Coal;
  if (y <= cfg.minBuildY + 40 || depth >= 52) return WorldMapBlock.DeepStone;
  if (canonicalVolcanicAt(cfg, x, z) > 238 && hashCoord3(cfg.worldSeed, x, y, z, 601) > 210) return WorldMapBlock.Basalt;
  return WorldMapBlock.Stone;
}

function canonicalSurfaceHeight(cfg, x, z) {
  const cacheKey = `${x},${z}`;
  const cached = cfg.cache?.surface?.get(cacheKey);
  if (cached !== undefined) return cached;
  const height = canonicalSurfaceHeightUncached(cfg, x, z);
  cacheSetBounded(cfg.cache?.surface, cacheKey, height);
  return height;
}

function canonicalSurfaceHeightUncached(cfg, x, z) {
  const maxSurface = Math.max(cfg.minBuildY + 8, Math.min(cfg.maxTerrainHeight, cfg.maxBuildY - 1));
  const desiredMinSurface = Math.max(cfg.minBuildY + 8, cfg.seaLevel - 28);
  const minSurface = Math.min(desiredMinSurface, maxSurface);
  const terrain = canonicalTerrainFactors(cfg, x, z);
  const { wx, wz, shelf, inland, waterMask, valleyMask, floodplainMask, lake, valleySoftness, openRiver } = terrain;

  const ocean =
    cfg.seaLevel - 16 +
    Math.trunc((valueNoise2(cfg.worldSeed, wx, wz, 96, 24) - 128) * 5 / 128) +
    Math.trunc((valueNoise2(cfg.worldSeed, wx, wz, 36, 25) - 128) * 2 / 128);
  const coast = cfg.seaLevel - 3 + Math.trunc(shelf * 8 / 1024);
  const plains = Math.trunc((valueNoise2(cfg.worldSeed, wx, wz, 120, 26) - 128) * 4 / 128);
  const hills = Math.trunc((valueNoise2(cfg.worldSeed, wx, wz, 56, 27) - 128) * 7 / 128);
  const rolling = Math.trunc((valueNoise2(cfg.worldSeed, wx, wz, 28, 28) - 128) * 2 / 128);
  const roughness = smoothRangeFixed(Math.abs(valueNoise2(cfg.worldSeed, wx, wz, 180, 40) - 128), 54, 122);

  const mountainRange = scaleByFixed(smoothRangeFixed(valueNoise2(cfg.worldSeed, wx, wz, 360, 30), 136, 226), inland);
  const highland = scaleByFixed(34, scaleByFixed(smoothRangeFixed(valueNoise2(cfg.worldSeed, wx, wz, 620, 46), 116, 206), inland));
  const ridgeLine = 128 - Math.abs(valueNoise2(cfg.worldSeed, wx, wz, 92, 29) - 128);
  const ridgeLift = smoothRangeFixed(ridgeLine, 44, 126);
  const peakMask = scaleByFixed(smoothRangeFixed(valueNoise2(cfg.worldSeed, wx, wz, 176, 47), 176, 242), mountainRange);
  const crag = scaleByFixed(smoothRangeFixed(Math.abs(valueNoise2(cfg.worldSeed, wx, wz, 52, 48) - 128), 48, 126), mountainRange);
  const mountain = highland + scaleByFixed(24 + scaleByFixed(72, ridgeLift) + scaleByFixed(24, crag), mountainRange) + scaleByFixed(34, peakMask);

  const land = cfg.seaLevel + 7 + Math.trunc(inland * 8 / 1024) + scaleByFixed(plains + scaleByFixed(hills + rolling, roughness), inland) + mountain;
  let shapedLand = Math.max(coast, land);
  if (floodplainMask > 0) {
    const flatNoise = Math.trunc((valueNoise2(cfg.worldSeed, wx, wz, 54, 38) - 128) / 128);
    const floodplainLift = 2 + Math.trunc((1024 - openRiver) * 2 / 1024);
    const floodplainFloor = cfg.seaLevel + floodplainLift + flatNoise;
    const floodplainBlend = Math.min(1024, Math.trunc(floodplainMask * (720 + Math.trunc(openRiver * 420 / 1024)) / 1024));
    shapedLand = lerpIntFixed(shapedLand, Math.min(shapedLand, floodplainFloor), floodplainBlend);
  }
  if (valleyMask > 0) {
    const bedNoise = Math.trunc((valueNoise2(cfg.worldSeed, wx, wz, 32, 39) - 128) * 2 / 128);
    const slopeNoise = valueNoise2(cfg.worldSeed, wx, wz, 150, 42);
    const canyon = scaleByFixed(smoothRangeFixed(slopeNoise, 190, 252), 1024 - scaleByFixed(openRiver, 640));
    const gentle = 1024 - scaleByFixed(openRiver, 1024 - canyon);
    const slopeStrength = 220 + scaleByFixed(360, canyon) + scaleByFixed(90, gentle);
    const valleyBlend = Math.min(1024, Math.trunc(valleyMask * slopeStrength / 1024));
    const bankLift = 2 + Math.trunc((255 - valleySoftness) * 4 / 255);
    const valleyCut = Math.trunc(valleyMask * (1 + Math.trunc(slopeNoise / 86)) / 1024);
    const bankFloor = cfg.seaLevel + bankLift - valleyCut + bedNoise;
    shapedLand = lerpIntFixed(shapedLand, Math.min(shapedLand, bankFloor), valleyBlend);

    const coreStart = 84 + Math.trunc((255 - slopeNoise) * 172 / 255);
    const coreBlend = smoothRangeFixed(waterMask, coreStart, 1024);
    if (coreBlend > 0) {
      const waterBed = cfg.seaLevel - 1 - Math.trunc(waterMask * 4 / 1024) - Math.trunc(lake * 3 / 1024) + bedNoise;
      shapedLand = lerpIntFixed(shapedLand, waterBed, coreBlend);
    }
  }

  return clampInt(lerpIntFixed(ocean, shapedLand, shelf), minSurface, maxSurface);
}

function canonicalSurfaceBlockId(cfg, x, z, surface) {
  const waterLevel = canonicalWaterLevel(cfg, x, z, surface);
  const underwater = waterLevel !== null && surface < waterLevel;
  const moisture = canonicalMoistureAt(cfg, x, z);
  const desert = canonicalDesertScoreAt(cfg, x, z);
  const gravelPatch = valueNoise2(cfg.worldSeed, x, z, 44, 103);
  const clayPatch = valueNoise2(cfg.worldSeed, x, z, 52, 104);

  if (underwater || surface <= cfg.seaLevel + 1) {
    if (moisture > 190 && clayPatch > 148) return WorldMapBlock.Clay;
    if (gravelPatch > 218) return WorldMapBlock.Gravel;
    if (valueNoise2(cfg.worldSeed, x, z, 96, 105) > 236) return WorldMapBlock.ShellBed;
    return WorldMapBlock.Sand;
  }
  if (canonicalVolcanicAt(cfg, x, z) > 246) return valueNoise2(cfg.worldSeed, x, z, 64, 106) > 180 ? WorldMapBlock.Basalt : WorldMapBlock.Ash;
  if (canonicalColdAt(cfg, x, z, surface)) return surface > cfg.seaLevel + 34 || valueNoise2(cfg.worldSeed, x, z, 72, 107) > 164 ? WorldMapBlock.Snow : WorldMapBlock.FrozenSoil;
  if (desert > 178) {
    if (desert > 226 && valueNoise2(cfg.worldSeed, x, z, 88, 108) > 188) return WorldMapBlock.SaltFlat;
    return desert > 204 ? WorldMapBlock.Sand : WorldMapBlock.DryDirt;
  }
  if (moisture > 188) {
    return moisture > 208 ? WorldMapBlock.Mud : WorldMapBlock.Grass;
  }
  if (surface >= cfg.seaLevel + 36) return WorldMapBlock.Stone;
  return WorldMapBlock.Grass;
}

function canonicalSubsurfaceBlockId(cfg, x, z, surface) {
  const top = canonicalSurfaceBlockId(cfg, x, z, surface);
  switch (top) {
    case WorldMapBlock.Sand:
    case WorldMapBlock.SaltFlat:
    case WorldMapBlock.Quicksand:
      return WorldMapBlock.Sand;
    case WorldMapBlock.Mud:
    case WorldMapBlock.Clay:
    case WorldMapBlock.Moss:
      return hashCoord3(cfg.worldSeed, x, surface - 1, z, 121) > 112 ? WorldMapBlock.Clay : WorldMapBlock.Mud;
    case WorldMapBlock.Snow:
    case WorldMapBlock.FrozenSoil:
      return WorldMapBlock.FrozenSoil;
    case WorldMapBlock.Basalt:
    case WorldMapBlock.Ash:
      return WorldMapBlock.Basalt;
    case WorldMapBlock.Stone:
      return WorldMapBlock.Stone;
    default:
      return WorldMapBlock.Dirt;
  }
}

function canonicalCoalSeamAt(cfg, x, y, z, surface) {
  const depth = surface - y;
  if (depth < 10 || y <= cfg.minBuildY + 4) return false;
  if (depth > 92 && y < cfg.minBuildY + 12) return false;

  const layerY = divFloor(y - cfg.minBuildY, 6);
  const cellX = divFloor(x, 10);
  const cellZ = divFloor(z, 10);
  const band = hashCoord3(cfg.worldSeed, cellX, layerY, cellZ, 301) & 255;
  if (band < 214) return false;
  if (depth < 18 || depth > 76) return false;

  const lens = hashCoord3(cfg.worldSeed, x + layerY * 17, y, z - layerY * 13, 302) & 255;
  const vein = hashCoord3(cfg.worldSeed, divFloor(x + y * 2, 4), layerY, divFloor(z - y * 3, 4), 303) & 255;
  return lens + Math.trunc(vein / 2) >= 228;
}

function canonicalTreeBlockIdAt(cfg, x, y, z) {
  for (let cz = z - 2; cz <= z + 2; cz += 1) {
    for (let cx = x - 2; cx <= x + 2; cx += 1) {
      const surface = canonicalSurfaceHeight(cfg, cx, cz);
      if (!canonicalCanGrowTree(cfg, cx, cz, surface)) continue;
      const tree = canonicalTreeAt(cfg, cx, cz, surface);
      if (!tree.exists) continue;
      const block = canonicalTreeVolumeBlock(cfg, tree, x, y, z);
      if (block !== EMPTY_BLOCK) return block;
    }
  }
  return EMPTY_BLOCK;
}

function canonicalCanGrowTree(cfg, x, z, surface) {
  if (surface <= cfg.seaLevel + 1) return false;
  const waterLevel = canonicalWaterLevel(cfg, x, z, surface);
  if (waterLevel !== null && surface < waterLevel) return false;
  if (canonicalDesertAt(cfg, x, z) || canonicalVolcanicAt(cfg, x, z) > 236) return false;
  return true;
}

function canonicalTreeAt(cfg, x, z, surface) {
  const growth = canonicalTreeGrowthProfile(cfg, x, z, surface);
  const density = growth.density;
  const cellSize = growth.cellSize;
  const cellX = divFloor(x, cellSize);
  const cellZ = divFloor(z, cellSize);
  const originX = cellX * cellSize;
  const originZ = cellZ * cellSize;
  const inner = Math.max(1, cellSize - 2);
  const treeX = originX + 1 + (hashCoord3(cfg.worldSeed, cellX, 0, cellZ, 401) % inner);
  const treeZ = originZ + 1 + (hashCoord3(cfg.worldSeed, cellX, 0, cellZ, 402) % inner);
  const roll = hashCoord3(cfg.worldSeed, cellX, 0, cellZ, 403) & 255;
  const exists = x === treeX && z === treeZ && roll > density;
  const pine = growth.pine;
  const trunkHeight = (pine ? 5 : 4) + (hashCoord3(cfg.worldSeed, x, surface, z, 405) % 3);
  return { exists, x, z, baseY: surface + 1, trunkHeight, pine };
}

function canonicalTreeVolumeBlock(cfg, tree, x, y, z) {
  const top = tree.baseY + tree.trunkHeight;
  if (x === tree.x && z === tree.z && y >= tree.baseY && y < top) {
    return tree.pine ? WorldMapBlock.PineTrunk : WorldMapBlock.Trunk;
  }
  if (tree.pine) {
    if (leafLayerContains(cfg, tree.x, top - 4, tree.z, x, y, z, 2, 158, 501)) return WorldMapBlock.PineLeaves;
    if (leafLayerContains(cfg, tree.x, top - 3, tree.z, x, y, z, 2, 188, 502)) return WorldMapBlock.PineLeaves;
    if (leafLayerContains(cfg, tree.x, top - 2, tree.z, x, y, z, 1, 218, 503)) return WorldMapBlock.PineLeaves;
    if (leafLayerContains(cfg, tree.x, top - 1, tree.z, x, y, z, 1, 184, 504)) return WorldMapBlock.PineLeaves;
    if (leafLayerContains(cfg, tree.x, top, tree.z, x, y, z, 1, 138, 505)) return WorldMapBlock.PineLeaves;
    if (x === tree.x && y === top + 1 && z === tree.z) return WorldMapBlock.PineLeaves;
    return EMPTY_BLOCK;
  }
  if (leafLayerContains(cfg, tree.x, top - 2, tree.z, x, y, z, 2, 174, 511)) return WorldMapBlock.Leaves;
  if (leafLayerContains(cfg, tree.x, top - 1, tree.z, x, y, z, 2, 214, 512)) return WorldMapBlock.Leaves;
  if (leafLayerContains(cfg, tree.x, top, tree.z, x, y, z, 2, 148, 513)) return WorldMapBlock.Leaves;
  if (leafLayerContains(cfg, tree.x, top + 1, tree.z, x, y, z, 1, 194, 514)) return WorldMapBlock.Leaves;
  return EMPTY_BLOCK;
}

function appendCanonicalTreeBlocks(cfg, tree, minX, maxX, minZ, maxZ, occupied, out) {
  const top = tree.baseY + tree.trunkHeight;
  for (let z = Math.max(minZ, tree.z - 2); z <= Math.min(maxZ, tree.z + 2); z += 1) {
    for (let x = Math.max(minX, tree.x - 2); x <= Math.min(maxX, tree.x + 2); x += 1) {
      for (let y = tree.baseY; y <= top + 1; y += 1) {
        const block = canonicalTreeVolumeBlock(cfg, tree, x, y, z);
        if (block === EMPTY_BLOCK) continue;
        const key = `${x},${y},${z}`;
        if (occupied.has(key)) continue;
        const type = renderTypeForBlock(block);
        if (!type) continue;
        occupied.add(key);
        out.push({ x, y, z, block, type });
      }
    }
  }
}

function leafLayerContains(cfg, cx, cy, cz, x, y, z, radius, density, salt) {
  if (y !== cy) return false;
  const dx = x - cx;
  const dz = z - cz;
  if (Math.abs(dx) > radius || Math.abs(dz) > radius) return false;
  const distance = Math.abs(dx) + Math.abs(dz);
  if (distance > radius + 1) return false;
  const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
  const roll = hashCoord3(cfg.worldSeed, cx + dx * 23, cy, cz + dz * 29, salt) & 255;
  if (corner && roll < 178) return false;
  return roll <= density;
}

function canonicalColdAt(cfg, x, z, surface) {
  const snowLine = canonicalSnowLineAt(cfg, x, z);
  return surface >= snowLine || (surface >= snowLine - 7 && valueNoise2(cfg.worldSeed, x, z, 160, 201) < 28);
}

function canonicalSnowLineAt(cfg, x, z) {
  return cfg.seaLevel + 58 + Math.trunc((valueNoise2(cfg.worldSeed, x, z, 220, 202) - 128) * 8 / 128);
}

function canonicalTreeGrowthProfile(cfg, x, z, surface) {
  const top = canonicalSurfaceBlockId(cfg, x, z, surface);
  if (top === WorldMapBlock.Sand || top === WorldMapBlock.SaltFlat || top === WorldMapBlock.Ash || top === WorldMapBlock.Basalt) {
    return { cellSize: 14, density: 255, pine: false };
  }
  const moisture = canonicalMoistureAt(cfg, x, z);
  const altitude = surface - cfg.seaLevel;
  const snowLine = canonicalSnowLineAt(cfg, x, z);
  const terrain = canonicalTerrainFactors(cfg, x, z);
  let cellSize = 9;
  let density = 218;
  if (moisture > 214 && altitude <= 44) {
    cellSize = 6;
    density = 136;
  } else if (moisture > 188 && altitude <= 54) {
    cellSize = 6;
    density = 154;
  } else if (moisture < 116) {
    cellSize = 11;
    density = 226;
  } else if (moisture < 150) {
    cellSize = 9;
    density = 210;
  } else {
    cellSize = 7;
    density = 184;
  }

  if (altitude <= 6) {
    cellSize += 2;
    density += 22;
  } else if (altitude <= 18 && terrain.floodplainMask > 360) {
    cellSize += 1;
    density += 10;
  }
  if (terrain.floodplainMask > 620 && terrain.openRiver > 520) density += 10;
  if (altitude >= 36) {
    cellSize += 1;
    density += 12;
  }
  if (altitude >= 54) {
    cellSize += 1;
    density += 14;
  }
  if (surface >= snowLine - 10) {
    cellSize += 1;
    density += 12;
  }
  if (surface >= snowLine) {
    cellSize += 1;
    density += 12;
  }
  if (top === WorldMapBlock.Stone || top === WorldMapBlock.Gravel) {
    cellSize += 1;
    density += 14;
  } else if (top === WorldMapBlock.FrozenSoil || top === WorldMapBlock.Snow) {
    cellSize += 1;
    density += 8;
  } else if (top === WorldMapBlock.Mud || top === WorldMapBlock.Clay) {
    density -= 8;
  }

  const patch = valueNoise2(cfg.worldSeed, x, z, 260, 406);
  if (patch > 204) {
    cellSize -= 1;
    density -= 24;
  } else if (patch < 58) {
    cellSize += 1;
    density += 14;
  }
  cellSize = Math.max(6, Math.min(14, cellSize));
  density = Math.max(128, Math.min(250, density));
  const pine = surface >= snowLine - 18
    || altitude >= 46
    || (altitude >= 26 && moisture < 168)
    || (hashCoord3(cfg.worldSeed, x, surface, z, 404) & 255) > 218;
  return { cellSize, density, pine };
}

function canonicalDesertAt(cfg, x, z) {
  return canonicalDesertScoreAt(cfg, x, z) > 178;
}

function canonicalWetAt(cfg, x, z) {
  return canonicalMoistureAt(cfg, x, z) > 188;
}

function canonicalVolcanicAt(cfg, x, z) {
  return valueNoise2(cfg.worldSeed, x, z, 192, 205);
}

function canonicalTerrainFactors(cfg, x, z) {
  const cacheKey = `${x},${z}`;
  const cached = cfg.cache?.terrain?.get(cacheKey);
  if (cached) return cached;
  const warpX = Math.trunc((valueNoise2(cfg.worldSeed, x, z, 160, 31) - 128) * 22 / 128);
  const warpZ = Math.trunc((valueNoise2(cfg.worldSeed, x, z, 160, 32) - 128) * 22 / 128);
  const wx = x + warpX;
  const wz = z + warpZ;
  const continent =
    Math.trunc((valueNoise2(cfg.worldSeed, wx, wz, 520, 21) - 128) * 86 / 128) +
    Math.trunc((valueNoise2(cfg.worldSeed, wx, wz, 220, 22) - 128) * 42 / 128) +
    Math.trunc((valueNoise2(cfg.worldSeed, wx, wz, 96, 23) - 128) * 14 / 128) +
    46;
  const shelf = smoothRangeFixed(continent, -50, 34);
  const inland = smoothRangeFixed(continent, -8, 78);
  const riverWarpX = Math.trunc((valueNoise2(cfg.worldSeed, wx, wz, 128, 33) - 128) * 36 / 128);
  const riverWarpZ = Math.trunc((valueNoise2(cfg.worldSeed, wx, wz, 128, 34) - 128) * 36 / 128);
  const riverLine = 128 - Math.abs(valueNoise2(cfg.worldSeed, wx + riverWarpX, wz + riverWarpZ, 104, 35) - 128);
  const lakeNoise = valueNoise2(cfg.worldSeed, wx, wz, 220, 37);
  const widthNoise = Math.trunc((valueNoise2(cfg.worldSeed, wx, wz, 420, 43) * 2 + valueNoise2(cfg.worldSeed, wx, wz, 96, 44)) / 3);
  const canyonNoise = valueNoise2(cfg.worldSeed, wx, wz, 340, 47);
  const broadPlain = smoothRangeFixed(valueNoise2(cfg.worldSeed, wx, wz, 760, 49), 144, 224);
  const riverWidth = Math.min(255, widthNoise + Math.trunc(broadPlain * 64 / 1024));
  const lakeWidth = valueNoise2(cfg.worldSeed, wx, wz, 520, 45);
  const openRiver = scaleByFixed(smoothRangeFixed(riverWidth, 72, 198), 1024 - smoothRangeFixed(canyonNoise, 190, 252));
  const riverValleyStart = 104 - Math.trunc(riverWidth * 88 / 255);
  const riverTerraceStart = Math.max(0, riverValleyStart - 64 - Math.trunc(riverWidth * 42 / 255));
  const riverFloodplainStart = Math.max(0, riverTerraceStart - 44 - Math.trunc(riverWidth * 32 / 255));
  const riverCoreStart = 122 - Math.trunc(riverWidth * 44 / 255);
  const riverTerrace = scaleByFixed(smoothRangeFixed(riverLine, riverTerraceStart, 128), 220 + Math.trunc(riverWidth * 430 / 255));
  const riverFloodplain = scaleByFixed(smoothRangeFixed(riverLine, riverFloodplainStart, 128), openRiver);
  const river = scaleByFixed(smoothRangeFixed(riverLine, riverCoreStart, 128), inland);
  const riverValley = scaleByFixed(Math.max(smoothRangeFixed(riverLine, riverValleyStart, 128), riverTerrace), inland);
  const lakeCoreStart = 226 - Math.trunc(lakeWidth * 28 / 255);
  const lake = scaleByFixed(smoothRangeFixed(lakeNoise, lakeCoreStart, 242), inland);
  const lakeValleyStart = 194 - Math.trunc(lakeWidth * 74 / 255);
  const lakeTerrace = scaleByFixed(smoothRangeFixed(lakeNoise, Math.max(0, lakeValleyStart - 42), 242), 180 + Math.trunc(lakeWidth * 260 / 255));
  const lakeValley = scaleByFixed(Math.max(smoothRangeFixed(lakeNoise, lakeValleyStart, 242), lakeTerrace), inland);
  const floodplainMask = scaleByFixed(Math.max(riverFloodplain, lakeTerrace), inland);
  const terrain = { wx, wz, continent, shelf, inland, river, lake, riverValley, lakeValley, waterMask: Math.max(river, lake), valleyMask: Math.max(riverValley, lakeValley), floodplainMask, valleySoftness: Math.max(riverWidth, lakeWidth), openRiver };
  cacheSetBounded(cfg.cache?.terrain, cacheKey, terrain);
  return terrain;
}

function canonicalWaterLevel(cfg, x, z, surface) {
  const cacheKey = `${x},${z},${surface}`;
  const cached = cfg.cache?.water?.get(cacheKey);
  if (cached !== undefined) return cached;
  const waterLevel = canonicalWaterLevelUncached(cfg, x, z, surface);
  cacheSetBounded(cfg.cache?.water, cacheKey, waterLevel);
  return waterLevel;
}

function canonicalWaterLevelUncached(cfg, x, z, surface) {
  if (surface < cfg.seaLevel) return cfg.seaLevel;
  return null;
}

function canonicalMoistureAt(cfg, x, z) {
  return Math.trunc(
    (
      valueNoise2(cfg.worldSeed, x, z, 176, 211) * 3 +
      valueNoise2(cfg.worldSeed, x, z, 72, 212)
    ) / 4,
  );
}

function canonicalDesertScoreAt(cfg, x, z) {
  return Math.trunc(
    (
      valueNoise2(cfg.worldSeed, x, z, 224, 213) * 3 +
      (255 - canonicalMoistureAt(cfg, x, z))
    ) / 4,
  );
}

function valueNoise2(seed, x, z, scale, salt) {
  const cellX = divFloor(x, scale);
  const cellZ = divFloor(z, scale);
  const localX = positiveModulo(x, scale);
  const localZ = positiveModulo(z, scale);
  const tx = smoothFixed(localX, scale);
  const tz = smoothFixed(localZ, scale);
  const a = hashCoord3(seed, cellX, 0, cellZ, salt) & 255;
  const b = hashCoord3(seed, cellX + 1, 0, cellZ, salt) & 255;
  const c = hashCoord3(seed, cellX, 0, cellZ + 1, salt) & 255;
  const d = hashCoord3(seed, cellX + 1, 0, cellZ + 1, salt) & 255;
  return lerpFixed(lerpFixed(a, b, tx), lerpFixed(c, d, tx), tz);
}

function hashCoord3(seed, x, y, z, salt) {
  let hash = seedSaltHash(seed, salt);
  hash = hashI32Bytes(hash, x);
  hash = hashI32Bytes(hash, y);
  hash = hashI32Bytes(hash, z);
  hash ^= hash >>> 16;
  hash = Math.imul(hash >>> 0, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash >>> 0, 0x846ca68b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function seedSaltHash(seed, salt) {
  let saltCache = seedSaltHashCache.get(seed);
  if (!saltCache) {
    saltCache = new Map();
    seedSaltHashCache.set(seed, saltCache);
  }
  const key = salt >>> 0;
  const cached = saltCache.get(key);
  if (cached !== undefined) return cached;
  let hash = (0x811c9dc5 ^ key) >>> 0;
  for (const byte of seed) hash = Math.imul((hash ^ byte) >>> 0, 0x01000193) >>> 0;
  saltCache.set(key, hash);
  return hash;
}

function hashI32Bytes(hash, value) {
  const v = value | 0;
  hash = Math.imul((hash ^ (v & 255)) >>> 0, 0x01000193) >>> 0;
  hash = Math.imul((hash ^ ((v >>> 8) & 255)) >>> 0, 0x01000193) >>> 0;
  hash = Math.imul((hash ^ ((v >>> 16) & 255)) >>> 0, 0x01000193) >>> 0;
  return Math.imul((hash ^ ((v >>> 24) & 255)) >>> 0, 0x01000193) >>> 0;
}

function normalizeSeedBytes(input) {
  if (input instanceof Uint8Array || Array.isArray(input)) {
    const bytes = Uint8Array.from(input).slice(0, 32);
    if (bytes.length === 32) return bytes;
    const padded = new Uint8Array(32);
    padded.set(bytes);
    return padded;
  }
  if (typeof input === "string" && /^[0-9a-fA-F]{64}$/.test(input)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) bytes[i] = Number.parseInt(input.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }
  if (typeof input === "string" && input.length) {
    const bytes = new TextEncoder().encode(input);
    const out = new Uint8Array(32);
    for (let i = 0; i < bytes.length; i += 1) out[i % 32] ^= bytes[i];
    return out;
  }
  return defaultSeedBytes;
}

function seedBytesHex(seed) {
  let out = "";
  for (const byte of seed) out += byte.toString(16).padStart(2, "0");
  return out;
}

function finiteInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function divFloor(value, divisor) {
  return Math.floor(value / divisor);
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function smoothFixed(distance, scale) {
  const fixed = Math.trunc((distance * 1024) / scale);
  return Math.trunc((fixed * fixed * (3072 - fixed * 2)) / (1024 * 1024));
}

function smoothRangeFixed(value, edge0, edge1) {
  if (value <= edge0) return 0;
  if (value >= edge1) return 1024;
  return smoothFixed(value - edge0, edge1 - edge0);
}

function lerpFixed(a, b, t) {
  return Math.trunc((a * (1024 - t) + b * t + 512) / 1024);
}

function lerpIntFixed(a, b, t) {
  return Math.trunc((a * (1024 - t) + b * t + 512) / 1024);
}

function scaleByFixed(value, fixed) {
  return Math.trunc((value * fixed) / 1024);
}

function cacheSetBounded(cache, key, value) {
  if (!cache) return;
  if (cache.size > canonicalCacheLimit) cache.clear();
  cache.set(key, value);
}
