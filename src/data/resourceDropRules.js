import { WorldMapBlock, renderTypeForBlock } from "../world/blocks.js";

export const resourceDropRuleSet = "nicechunk-resource-drops-v2";

// Visual bounds include air and surrounding feature geometry. Backpack volume
// records only the material that can actually be recovered from one mine action.
export const resourceDropSizeProfiles = {
  lava: sizeProfile([0.1, 0.08, 0.1], [0.38, 0.24, 0.38], [80_000, 500_000]),
  ice: sizeProfile([0.16, 0.08, 0.16], [0.72, 0.42, 0.72], [100_000, 1_000_000]),
  toxicWater: sizeProfile([0.12, 0.12, 0.12], [0.42, 0.42, 0.42], [100_000, 750_000]),
  coral: sizeProfile([0.1, 0.08, 0.08], [0.48, 0.34, 0.3], [50_000, 500_000]),
  deadCoral: sizeProfile([0.08, 0.06, 0.06], [0.36, 0.24, 0.24], [50_000, 500_000]),
  reed: sizeProfile([0.025, 0.45, 0.025], [0.12, 1.8, 0.12], [10_000, 200_000]),
  vine: sizeProfile([0.025, 0.5, 0.025], [0.1, 2.4, 0.1], [15_000, 250_000]),
  dryGrass: sizeProfile([0.04, 0.25, 0.04], [0.18, 0.9, 0.18], [10_000, 200_000]),
  deadBush: sizeProfile([0.16, 0.18, 0.16], [0.72, 0.9, 0.72], [25_000, 500_000]),
  thorn: sizeProfile([0.01, 0.04, 0.01], [0.06, 0.22, 0.06], [2_000, 100_000]),
  deadWood: sizeProfile([0.1, 0.28, 0.1], [0.42, 1.35, 0.42], [150_000, 1_200_000]),
  giantRoot: sizeProfile([0.18, 0.38, 0.18], [0.86, 2.2, 0.86], [250_000, 2_000_000]),
};

export const resourceDropRules = [
  rule("basalt", "lava", 35, -96, 8, 10, 511, 1),
  rule("ash", "lava", 20, -64, 12, 4, 511, 2),
  rule("deepStone", "lava", 10, -128, -18, 55, 511, 3),
  rule("snow", "ice", 300, 18, 160, 0, 4, 4),
  rule("frozenSoil", "ice", 220, 8, 160, 0, 8, 5),
  rule("deepStone", "ice", 40, -128, -32, 60, 511, 6),
  rule("mud", "toxicWater", 60, -12, 10, 0, 8, 7),
  rule("moss", "toxicWater", 45, -8, 14, 0, 8, 8),
  rule("clay", "toxicWater", 35, -10, 8, 0, 10, 9),
  rule("ash", "toxicWater", 25, -16, 18, 0, 16, 10),
  rule("shellBed", "coral", 260, -24, 3, 0, 4, 11),
  rule("sand", "coral", 55, -24, 2, 0, 3, 12),
  rule("clay", "coral", 45, -18, 2, 0, 5, 13),
  rule("shellBed", "deadCoral", 130, -32, 6, 0, 8, 14),
  rule("gravel", "deadCoral", 40, -28, 4, 0, 6, 15),
  rule("sand", "deadCoral", 35, -28, 4, 0, 6, 16),
  rule("mud", "reed", 550, -5, 8, 0, 3, 17),
  rule("clay", "reed", 320, -5, 8, 0, 3, 18),
  rule("moss", "reed", 260, -3, 10, 0, 4, 19),
  rule("leaves", "vine", 320, -8, 60, 0, 12, 20),
  rule("trunk", "vine", 160, -8, 60, 0, 12, 21),
  rule("moss", "vine", 180, -8, 36, 0, 8, 22),
  rule("grass", "dryGrass", 800, 2, 40, 0, 2, 23),
  rule("dryDirt", "dryGrass", 900, -4, 48, 0, 3, 24),
  rule("dryDirt", "deadBush", 320, -6, 52, 0, 3, 25),
  rule("sand", "deadBush", 220, -8, 52, 0, 3, 26),
  rule("ash", "deadBush", 180, -10, 44, 0, 5, 27),
  rule("dryDirt", "thorn", 160, -6, 52, 0, 4, 28),
  rule("sand", "thorn", 100, -8, 56, 0, 4, 29),
  rule("basalt", "thorn", 60, -8, 50, 0, 8, 30),
  rule("trunk", "deadWood", 260, -8, 72, 0, 10, 31),
  rule("pineTrunk", "deadWood", 220, -8, 90, 0, 10, 32),
  rule("ash", "deadWood", 110, -12, 52, 0, 12, 33),
  rule("trunk", "giantRoot", 75, -8, 40, 0, 8, 34),
  rule("pineTrunk", "giantRoot", 65, -8, 64, 0, 8, 35),
  rule("moss", "giantRoot", 55, -8, 28, 0, 7, 36),
  rule("mud", "giantRoot", 45, -8, 18, 0, 6, 37),
];

function rule(sourceKey, dropKey, chanceBps, minAltitude, maxAltitude, minDepth, maxDepth, salt) {
  const sourceBlockId = blockIdByKey(sourceKey);
  const dropBlockId = blockIdByKey(dropKey);
  const size = resourceDropSizeProfiles[dropKey];
  if (!size) throw new Error(`Missing resource drop size profile: ${dropKey}`);
  return {
    sourceKey,
    dropKey,
    sourceBlockId,
    dropBlockId,
    chanceBps,
    minAltitude,
    maxAltitude,
    minDepth,
    maxDepth,
    salt,
    minDimensionsM: size.minDimensionsM,
    maxDimensionsM: size.maxDimensionsM,
    minVolumeMm3: size.minVolumeMm3,
    maxVolumeMm3: size.maxVolumeMm3,
  };
}

function sizeProfile(minDimensions, maxDimensions, volumeRangeMm3) {
  return {
    minDimensionsM: dimensionsFromArray(minDimensions),
    maxDimensionsM: dimensionsFromArray(maxDimensions),
    minVolumeMm3: volumeRangeMm3[0],
    maxVolumeMm3: volumeRangeMm3[1],
  };
}

function dimensionsFromArray(values) {
  return {
    width: values[0],
    height: values[1],
    depth: values[2],
  };
}

export function blockIdByKey(key) {
  const normalized = String(key || "");
  for (const [name, value] of Object.entries(WorldMapBlock)) {
    if (renderTypeForBlock(value) === normalized || name === normalized) return value;
  }
  throw new Error(`Unknown resource drop block key: ${key}`);
}
