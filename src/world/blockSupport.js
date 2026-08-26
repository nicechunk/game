import { WorldMapBlock } from "./blocks.js";

export const SUPPORT_COLLAPSE_MAX_BLOCKS = 640;
// Three ChunkBroken/FoundationChunk pairs leave enough room for the complete
// mining, durability, position, and skill instruction set in one Solana packet.
export const SUPPORT_COLLAPSE_MAX_CHUNKS = 3;

const DEFAULT_PROFILE = Object.freeze({
  bearingClass: "weak",
  horizontalSpan: 1,
  gravity: false,
});

const PROFILES = new Map([
  ...profile("loose", 0, true, [
    WorldMapBlock.Sand,
    WorldMapBlock.Gravel,
    WorldMapBlock.Snow,
    WorldMapBlock.Ash,
    WorldMapBlock.Quicksand,
  ]),
  ...profile("soil", 1, false, [
    WorldMapBlock.Grass,
    WorldMapBlock.Dirt,
    WorldMapBlock.Mud,
    WorldMapBlock.DryDirt,
    WorldMapBlock.SaltFlat,
  ]),
  ...profile("earthwork", 2, false, [
    WorldMapBlock.Clay,
    WorldMapBlock.FrozenSoil,
    WorldMapBlock.Cactus,
    WorldMapBlock.DeadCoral,
    WorldMapBlock.ShellBed,
  ]),
  ...profile("masonry", 4, false, [
    WorldMapBlock.Stone,
    WorldMapBlock.Ice,
    WorldMapBlock.Coal,
    WorldMapBlock.Coral,
  ]),
  ...profile("bedrock", 6, false, [
    WorldMapBlock.DeepStone,
    WorldMapBlock.Basalt,
  ]),
  ...profile("timber", 4, false, [
    WorldMapBlock.Trunk,
    WorldMapBlock.PineTrunk,
    WorldMapBlock.DeadWood,
  ]),
  ...profile("root", 5, false, [WorldMapBlock.GiantRoot]),
  ...profile("foliage", 2, false, [
    WorldMapBlock.Leaves,
    WorldMapBlock.PineLeaves,
  ]),
]);

export function blockSupportProfile(blockId) {
  return PROFILES.get(Math.trunc(Number(blockId))) ?? DEFAULT_PROFILE;
}

function profile(bearingClass, horizontalSpan, gravity, blockIds) {
  const value = Object.freeze({ bearingClass, horizontalSpan, gravity });
  return blockIds.map((blockId) => [blockId, value]);
}
