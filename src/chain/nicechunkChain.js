import { Buffer } from "buffer";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionExpiredBlockheightExceededError,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getLocalGameWalletKeypair,
  getLocalGameWalletProvider,
  isLocalGameWalletProvider,
} from "../localGameWallet.js";
import { createNicechunkRpcFetch, getNicechunkRpcUrl, reportRpcError, rpcConfigChangedEventName } from "../rpcConfig.js";
import { assertNicechunkWalletNetwork, solanaClusterLabel } from "../solanaNetwork.js";
import { submitSupportCollapseBatches } from "./supportCollapseSubmission.js";
import { decodePlayerProfileSkillLevels, PLAYER_SKILL_IDS } from "./playerSkillLevels.js";
import {
  BULK_MINING_BATCH_SIZE,
  BULK_MINING_MAX_SELECTION_BLOCKS,
  BULK_MINING_RANGE_MODE_DEBUG,
  encodeBulkMiningRangePayload,
  partitionBulkMiningRanges,
  submitBulkMiningRanges,
} from "./bulkMiningSubmission.js";

if (!globalThis.Buffer) globalThis.Buffer = Buffer;

const coreProgramId = new PublicKey("9EhMCRYMJej1F21KzaA5Zao3khGGc5aJbDGbnxaogQHu");
const playerProgramId = new PublicKey("CHZHsBCGn58ih2WrPfKSYhvCEjMPGhArTiYCH7AWWBkB");
const gameProgramId = new PublicKey("6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7");
const chunkProgramId = new PublicKey("GnVKn442KDTDgCyjVG7SEtCQQLjaCiLvrEZDWSU13wbj");
const buildingProgramId = new PublicKey("39UMTUWXQkuomkFNbDPF5NGZnJmG6pDkJHVSkZyqVwWx");
export const NICECHUNK_SKILLS_PROGRAM_ID = new PublicKey("5gkdfmRJogdSdPrT8rvnEkPdn2N2fLBnQ6YDdegUcu3P");
const gameNamespaceBackpack = 1;
const gameNamespaceChunk = 2;
const gameNamespaceSmelting = 3;
const gameNamespaceMarket = 4;
const globalConfigSeed = "global-config";
const playerSeed = "player-v7";
const playerAppearanceSeed = "appearance-v1";
const playerEquipmentSeed = "player-equipment-v1";
const equipmentTransferAuthoritySeed = "equipment-transfer-v1";
const playerSessionSeed = "session";
const playerPositionSaveReasonResourceMine = "resource-mine-confirm";
const usernameIndexSeed = "player-name-v1";
const inviteIndexSeed = "invite-index-v1";
const chunkBrokenSeed = "chunk-broken";
const resourceDropTableSeed = "resource-drops-v2";
const surfaceDecorationTableSeed = "surface-decor-v1";
const foundationSeed = "foundation";
const foundationChunkSeed = "foundation-chunk";
const buildSiteSeed = "build-site-v1";
const buildingChunkAuthoritySeed = "chunk-authority-v1";
const buildingManifestSeed = "building-v2";
const buildingShardSeed = "building-data-v1";
const playerProgressSeed = "player-progress";
const playerSkillsSeed = "player-skills-v1";
const skillRuleTableSeed = "skill-rules-v1";
const backpackSeed = "backpack";
const materialPhysicsSeed = "material-physics-v1";
const marketListingSeed = "listing";
const marketAuthoritySeed = "market-authority";
const smeltingRecipeTableSeed = "smelting-recipes";
const smeltingAuthoritySeed = "smelting-authority";
const smeltingDefaultRecipeTableId = 220n;
const globalConfigLength = 293;
const globalConfigMagic = "NCKCFG01";
const worldConfigStorageKey = "nicechunk.worldConfig.v1";
const playerProfileLength = 773;
const playerAppearanceLength = 9612;
const playerEquipmentMagic = "NCKEQP01";
const playerEquipmentVersion = 1;
const playerEquipmentHeaderLength = 128;
const playerEquipmentSlotLength = 768;
const playerEquipmentModelCodeMaxBytes = 640;
const playerEquipmentSlotCount = 9;
const playerEquipmentLength = playerEquipmentHeaderLength + playerEquipmentSlotCount * playerEquipmentSlotLength;
const playerEquipmentFlagCustody = 1 << 1;
const appearanceModelCodeMaxBytes = 2048;
const appearanceTitleMaxBytes = 96;
const appearanceEquipmentSlotCount = 12;
const appearanceEquipmentSlotLength = 576;
const appearanceEquipmentCodeMaxBytes = 512;
const playerNameMaxChars = 32;
const playerNameMaxBytes = 300;
const playerNameLengthOffset = 463;
const playerNameBytesOffset = 465;
const usernameIndexMagic = "NCKNAM01";
const usernameIndexLength = 256;
const usernameIndexOwnerOffset = 12;
const usernameIndexNameHashOffset = 108;
const usernameIndexNameLengthOffset = 140;
const usernameIndexNameBytesOffset = 160;
const inviteIndexMagic = "NCKINV01";
const inviteIndexVersion = 1;
const inviteIndexCapacity = 64;
const inviteIndexLength = 128 + inviteIndexCapacity * 40;
const inviteIndexHeaderLength = 128;
const inviteIndexRecordLength = 40;
const inviteIndexCountOffset = 80;
const forgedItemCodeMaxLength = 1248;
const verifiedForgeCodeMaxRawLength = 640;
const chunkBrokenMagic = "NCBK";
const chunkBrokenHeaderLength = 16;
const chunkBrokenRecordLength = 3;
const surfaceDecorationTableMagic = "NCKDEC01";
const surfaceDecorationTableVersion = 1;
const surfaceDecorationTableHeaderLength = 16;
const surfaceDecorationRuleLength = 20;
const surfaceDecorationRuleMaxCount = 128;
const surfaceDecorationTableLength = surfaceDecorationTableHeaderLength + surfaceDecorationRuleMaxCount * surfaceDecorationRuleLength;
const foundationMagic = "NCKFND01";
const foundationLength = 112;
const foundationChunkMagic = "NCKFCI01";
const foundationChunkVersion = 1;
const foundationChunkHeaderLength = 52;
const foundationChunkRecordLength = 52;
const foundationChunkCapacity = 32;
const foundationChunkLength = foundationChunkHeaderLength + foundationChunkCapacity * foundationChunkRecordLength;
const foundationMinSize = 2;
const foundationMaxSize = 16;
const buildSiteMagic = "NCKSITE1";
const legacyBuildSiteVersion = 1;
const legacyBuildSiteLength = 136;
const buildSiteVersion = 2;
const buildSiteLength = 160;
const buildSiteOwnerOffset = 16;
const buildSiteStatusNames = new Map([
  [0, "indexing"],
  [1, "active"],
  [2, "edit-indexing"],
  [3, "edit-cleaning"],
]);
const buildingManifestMagic = "NCKBLD02";
const buildingManifestVersion = 2;
const buildingManifestLength = 160;
const buildingShardMagic = "NCKBDT01";
const buildingShardVersion = 1;
const buildingShardHeaderLength = 64;
const buildingShardPayloadLength = 8192;
const buildingMaxPayloadLength = 65535;
export const BUILDING_MAX_WRITE_LENGTH = 700;
const playerProgressMagic = "NCKPRG01";
const playerProgressLength = 128;
const playerSessionMagic = "NCKSES01";
const playerSessionLength = 184;
const playerSessionOwnerOffset = 12;
const playerSessionAuthorityOffset = 44;
const playerSessionExpiresAtOffset = 144;
const playerProgressPrecisionXpOffset = 76;
const playerProgressSmeltingXpOffset = 108;
const playerProgressExplorationXpOffset = 116;
const playerProgressExploredChunkCountOffset = 124;
const playerSkillsMagic = "NCKSKL01";
const playerSkillsVersion = 1;
const playerSkillsLength = 480;
const playerSkillsXpOffset = 76;
const playerSkillsLevelsOffset = 156;
const playerSkillsCursorMaskOffset = 166;
const playerSkillsRuleRevisionOffset = 172;
const playerSkillsCreatedSlotOffset = 432;
const playerSkillsUpdatedSlotOffset = 440;
const playerSkillsLastMineXOffset = 456;
const playerSkillsLastMineYOffset = 460;
const playerSkillsLastMineZOffset = 464;
const playerSkillsMiningFlagsOffset = 468;
const playerSkillsMiningTravelCountOffset = 472;
const backpackMagic = "NCKBPK01";
const backpackVersion = 3;
const backpackDefaultCapacity = 50;
const backpackMaxCapacity = 99;
const backpackHeaderLength = 128;
const backpackSlotRecordLength = 80;
const backpackRecordLength = backpackSlotRecordLength;
const backpackAccountLength = backpackHeaderLength + backpackMaxCapacity * backpackRecordLength;
const backpackSlotKindBlock = 1;
const backpackSlotKindItem = 2;
const backpackItemFlagMassValid = 1 << 15;
const backpackFlagTotalMassInitialized = 1;
const backpackTotalMassGramsOffset = 90;
const backpackLastMinePreMassGramsOffset = 98;
const backpackLastMineActionIdOffset = 106;
const backpackMineSequenceOffset = 114;
const backpackPackedYBits = 9;
const backpackPackedYMask = (1 << backpackPackedYBits) - 1;
const marketListingMagic = "NCKMKT01";
const marketListingLength = 216;
const marketListingStateOffset = 11;
const marketListingSellerOffset = 12;
const marketListingCurrencyOffset = 52;
const marketListingSourceSlotOffset = 62;
const marketListingSourceTypeOffset = 214;
const marketStateNames = new Map([
  [1, "active"],
  [2, "canceled"],
  [3, "sold"],
]);
const marketStateCodes = new Map(Array.from(marketStateNames.entries()).map(([code, key]) => [key, code]));
const marketCategoryCodes = new Map([
  ["raw", 1],
  ["equipment", 2],
  ["building", 3],
  ["clothing", 4],
]);
const marketCategoryNames = new Map(Array.from(marketCategoryCodes.entries()).map(([key, code]) => [code, key]));
const marketCurrencyCodes = new Map([
  ["NCK", 1],
  ["SOL", 2],
]);
const marketCurrencyNames = new Map(Array.from(marketCurrencyCodes.entries()).map(([key, code]) => [code, key]));
const marketCurrencyDecimals = new Map([
  ["NCK", 6],
  ["SOL", 9],
]);
const marketSourceCodes = new Map([
  ["backpack", 1],
  ["equipment", 2],
]);
const marketSourceNames = new Map(Array.from(marketSourceCodes.entries()).map(([key, code]) => [code, key]));
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const nckMint = new PublicKey("HSnWF5kjkWVrceW2SaSskScuLveUZE4gpthZ2ZXRPQPo");
const marketTreasury = new PublicKey("CtPV2vmqNNwUSfMu5nz58ZtMPy6ZvxL4LyNdPHVW7WvF");
const storageWalletKey = "nicechunk.walletAddress";
const chainSyncStorageKey = "nicechunk.chainSync";
const equippedBackpackStorageKeyPrefix = "nicechunk.equippedBackpack.v1.";
const sessionStorageKeyPrefix = "nicechunk.session.v1.";
const sessionFundingStorageKeyPrefix = "nicechunk.sessionFundingLamports.v1.";
const sessionFundingAcknowledgedKeyPrefix = "nicechunk.sessionFundingAcknowledged.v1.";
const sessionDurationSeconds = 8 * 60 * 60;
const sessionRefreshSkewSeconds = 15 * 60;
const lamportsPerSol = 1_000_000_000;
const minimumSessionFundingLamports = 100_000_000;
const sessionMinimumMiningLamports = 8_000_000;
const sessionAllowedActions = (1 << 1) | (1 << 2);
const sessionMaxActions = 10_000;
const miningComputeUnitLimit = 1_400_000;
const fallbackTransactionFeeLamports = 5_000;
const transactionConfirmationPollMs = 500;
const transactionBlockHeightPollMs = 1_000;
const transactionConfirmationTimeoutMs = 60_000;
const treeFellMaxChunkCount = 4;
const treeFellLeafRadius = 2;
const supportCollapseMaxOnChainBlocks = 48;
const bulkMiningModeDebug = 1;
const chunkDeltaCacheTtlMs = 60_000;
const gameplaySessionStatusCacheTtlMs = 60_000;
const gameplaySessionReadyCacheTtlMs = 5 * 60_000;
const resourceDropTableCacheTtlMs = 10 * 60_000;
const chunkDeltaCache = new Map();
const initializedChunkBrokenCache = new Set();
const gameplaySessionStatusCache = new Map();
const gameplaySessionReadyCache = new Map();
const resourceDropTableReadyAtByProgram = new Map();
const surfaceDecorationTableReadyAtByProgram = new Map();
const buildingPayloadCache = new Map();
const buildingPayloadCacheLimit = 128;
let surfaceDecorationTableCache = null;

const canonicalChunkWorldSeedHex = "6e6963656368756e6b2d6d61696e6e65742d3030310000000000000000000000";
const canonicalChunkWorldConfig = Object.freeze({
  worldSeedHex: canonicalChunkWorldSeedHex,
  chunkSize: 16,
  sectionHeight: 16,
  minBuildY: -32,
  maxBuildY: 320,
  maxTerrainHeight: 240,
  seaLevel: 96,
});
const chunkSize = canonicalChunkWorldConfig.chunkSize;
const minBuildY = canonicalChunkWorldConfig.minBuildY;
const EMPTY_BLOCK = 0;
const WorldMapBlock = Object.freeze({
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  DeepStone: 4,
  Sand: 5,
  Gravel: 6,
  Clay: 7,
  Mud: 8,
  DryDirt: 9,
  SaltFlat: 10,
  Snow: 11,
  Ice: 12,
  FrozenSoil: 13,
  Basalt: 14,
  Ash: 15,
  Bedrock: 16,
  Water: 17,
  SwampWater: 18,
  ToxicWater: 19,
  Lava: 20,
  Quicksand: 21,
  Trunk: 22,
  Leaves: 23,
  PineTrunk: 24,
  PineLeaves: 25,
  DeadWood: 26,
  GiantRoot: 27,
  GrassPlant: 28,
  DryGrass: 29,
  Bush: 30,
  DeadBush: 31,
  Cactus: 32,
  Reed: 33,
  SwampGrass: 34,
  SnowBush: 35,
  Thorn: 36,
  Moss: 37,
  Lichen: 38,
  Vine: 39,
  GlowMycelium: 40,
  Mushroom: 41,
  Seaweed: 42,
  AquaticPlant: 43,
  Coral: 44,
  DeadCoral: 45,
  ShellBed: 46,
  Coal: 47,
  Cotton: 48,
  FlowerWhite: 49,
  FlowerYellow: 50,
  FlowerRed: 51,
  FlowerBlue: 52,
  FlowerPink: 53,
});

function isCanonicalMineableBlockId(blockId) {
  return ![EMPTY_BLOCK, WorldMapBlock.Water, WorldMapBlock.Bedrock].includes(Number(blockId));
}

const blockIdByRenderType = new Map([
  ["grass", WorldMapBlock.Grass],
  ["dirt", WorldMapBlock.Dirt],
  ["stone", WorldMapBlock.Stone],
  ["deepStone", WorldMapBlock.DeepStone],
  ["coal", WorldMapBlock.Coal],
  ["sand", WorldMapBlock.Sand],
  ["sandstone", WorldMapBlock.Sand],
  ["gravel", WorldMapBlock.Gravel],
  ["clay", WorldMapBlock.Clay],
  ["mud", WorldMapBlock.Mud],
  ["dryDirt", WorldMapBlock.DryDirt],
  ["saltFlat", WorldMapBlock.SaltFlat],
  ["snow", WorldMapBlock.Snow],
  ["ice", WorldMapBlock.Ice],
  ["frozenSoil", WorldMapBlock.FrozenSoil],
  ["basalt", WorldMapBlock.Basalt],
  ["ash", WorldMapBlock.Ash],
  ["bedrock", WorldMapBlock.Bedrock],
  ["water", WorldMapBlock.Water],
  ["swampWater", WorldMapBlock.SwampWater],
  ["toxicWater", WorldMapBlock.ToxicWater],
  ["lava", WorldMapBlock.Lava],
  ["quicksand", WorldMapBlock.Quicksand],
  ["trunk", WorldMapBlock.Trunk],
  ["trunkDark", WorldMapBlock.Trunk],
  ["leaves", WorldMapBlock.Leaves],
  ["leavesDark", WorldMapBlock.Leaves],
  ["leavesLight", WorldMapBlock.Leaves],
  ["leavesTeal", WorldMapBlock.Leaves],
  ["leavesWarm", WorldMapBlock.Leaves],
  ["pineTrunk", WorldMapBlock.PineTrunk],
  ["pineLeaves", WorldMapBlock.PineLeaves],
  ["deadWood", WorldMapBlock.DeadWood],
  ["giantRoot", WorldMapBlock.GiantRoot],
  ["grassPlant", WorldMapBlock.GrassPlant],
  ["dryGrass", WorldMapBlock.DryGrass],
  ["bush", WorldMapBlock.Bush],
  ["deadBush", WorldMapBlock.DeadBush],
  ["cactus", WorldMapBlock.Cactus],
  ["reed", WorldMapBlock.Reed],
  ["swampGrass", WorldMapBlock.SwampGrass],
  ["snowBush", WorldMapBlock.SnowBush],
  ["thorn", WorldMapBlock.Thorn],
  ["moss", WorldMapBlock.Moss],
  ["lichen", WorldMapBlock.Lichen],
  ["vine", WorldMapBlock.Vine],
  ["glowMycelium", WorldMapBlock.GlowMycelium],
  ["mushroom", WorldMapBlock.Mushroom],
  ["seaweed", WorldMapBlock.Seaweed],
  ["aquaticPlant", WorldMapBlock.AquaticPlant],
  ["coral", WorldMapBlock.Coral],
  ["deadCoral", WorldMapBlock.DeadCoral],
  ["shellBed", WorldMapBlock.ShellBed],
  ["cotton", WorldMapBlock.Cotton],
  ["flowerWhite", WorldMapBlock.FlowerWhite],
  ["flowerYellow", WorldMapBlock.FlowerYellow],
  ["flowerRed", WorldMapBlock.FlowerRed],
  ["flowerBlue", WorldMapBlock.FlowerBlue],
  ["flowerPink", WorldMapBlock.FlowerPink],
]);
const renderTypeByBlockId = new Map(
  Array.from(blockIdByRenderType.entries()).map(([renderType, blockId]) => [blockId, renderType]),
);

let connection = null;
let connectionRpcUrl = "";
let globalConfigPda = null;

export function getNicechunkConnection() {
  const rpcUrl = getNicechunkRpcUrl();
  if (!connection || connectionRpcUrl !== rpcUrl) {
    connection = new Connection(rpcUrl, {
      commitment: "confirmed",
      fetch: createNicechunkRpcFetch("nicechunk-chain"),
    });
    connectionRpcUrl = rpcUrl;
  }
  return connection;
}

if (typeof window !== "undefined") {
  window.addEventListener(rpcConfigChangedEventName, () => {
    connection = null;
    connectionRpcUrl = "";
    clearChainReadCaches();
  });
}

function clearChainReadCaches() {
  chunkDeltaCache.clear();
  initializedChunkBrokenCache.clear();
  gameplaySessionStatusCache.clear();
  gameplaySessionReadyCache.clear();
  resourceDropTableReadyAtByProgram.clear();
  surfaceDecorationTableReadyAtByProgram.clear();
  buildingPayloadCache.clear();
  surfaceDecorationTableCache = null;
}

export function deriveGlobalConfigPda() {
  if (!globalConfigPda) {
    [globalConfigPda] = PublicKey.findProgramAddressSync([Buffer.from(globalConfigSeed)], coreProgramId);
  }
  return globalConfigPda;
}

export async function loadGlobalConfig({ useCache = true } = {}) {
  const globalConfig = deriveGlobalConfigPda();
  try {
    const account = await getNicechunkConnection().getAccountInfo(globalConfig, "confirmed");
    if (!account?.data?.length) throw new Error("GlobalConfig account was not found.");
    const decoded = applyCanonicalChunkWorldConfig(decodeGlobalConfig(account.data));
    const config = {
      ...decoded,
      programId: coreProgramId.toBase58(),
      globalConfig: globalConfig.toBase58(),
      loadedAt: Date.now(),
    };
    if (hasLocalStorage()) {
      localStorage.setItem(worldConfigStorageKey, JSON.stringify(serializeGlobalConfigForStorage(config)));
    }
    return config;
  } catch (error) {
    reportRpcError(error, "global-config");
    if (!useCache) throw error;
    const cached = loadCachedGlobalConfig();
    if (cached) return { ...cached, fromCache: true, loadError: error };
    throw error;
  }
}

export function loadCachedGlobalConfig() {
  try {
    if (!hasLocalStorage()) return null;
    const raw = localStorage.getItem(worldConfigStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.magic !== globalConfigMagic || !parsed.worldSeedHex) return null;
    return applyCanonicalChunkWorldConfig({
      ...parsed,
      worldSeed: Buffer.from(parsed.worldSeedHex, "hex"),
      fromCache: true,
    });
  } catch {
    return null;
  }
}

function applyCanonicalChunkWorldConfig(config) {
  if (!config || typeof config !== "object") return config;
  return {
    ...config,
    chainWorldSeedHex: config.worldSeed ? Buffer.from(config.worldSeed).toString("hex") : config.worldSeedHex,
    chainSeaLevel: Number.isFinite(config.seaLevel) ? Number(config.seaLevel) : null,
    worldSeed: Buffer.from(canonicalChunkWorldConfig.worldSeedHex, "hex"),
    worldSeedHex: canonicalChunkWorldConfig.worldSeedHex,
    chunkSize: canonicalChunkWorldConfig.chunkSize,
    sectionHeight: canonicalChunkWorldConfig.sectionHeight,
    minBuildY: canonicalChunkWorldConfig.minBuildY,
    maxBuildY: canonicalChunkWorldConfig.maxBuildY,
    maxTerrainHeight: canonicalChunkWorldConfig.maxTerrainHeight,
    seaLevel: canonicalChunkWorldConfig.seaLevel,
    canonicalSource: "chunk-v4",
  };
}

function hasLocalStorage() {
  return typeof localStorage !== "undefined";
}

export function derivePlayerProfilePda(owner) {
  return PublicKey.findProgramAddressSync([Buffer.from(playerSeed), owner.toBuffer()], playerProgramId);
}

export function derivePlayerAppearancePda(owner) {
  return PublicKey.findProgramAddressSync([Buffer.from(playerAppearanceSeed), owner.toBuffer()], playerProgramId);
}

export function derivePlayerEquipmentPda(owner) {
  return PublicKey.findProgramAddressSync([Buffer.from(playerEquipmentSeed), owner.toBuffer()], playerProgramId);
}

export function deriveEquipmentTransferAuthorityPda() {
  return PublicKey.findProgramAddressSync([Buffer.from(equipmentTransferAuthoritySeed)], playerProgramId);
}

export const derivePlayerCharacterPda = derivePlayerAppearancePda;

export function derivePlayerSessionPda(owner, sessionAuthority) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(playerSessionSeed), owner.toBuffer(), sessionAuthority.toBuffer()],
    playerProgramId,
  );
}

export function deriveInviteIndexPda(inviter, pageIndex = 0) {
  const owner = typeof inviter === "string" ? new PublicKey(inviter) : inviter;
  const pageBytes = Buffer.alloc(4);
  pageBytes.writeUInt32LE(Math.max(0, Math.floor(Number(pageIndex) || 0)), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(inviteIndexSeed), owner.toBuffer(), pageBytes],
    playerProgramId,
  );
}

export async function deriveUsernameIndexPdaForName(playerName) {
  const nameHash = await canonicalPlayerNameHash(playerName);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(usernameIndexSeed), nameHash],
    playerProgramId,
  );
}

function deriveChunkBrokenPdaForProgram(chunkX, chunkZ, programId = chunkProgramId) {
  const chunkXBytes = Buffer.alloc(4);
  const chunkZBytes = Buffer.alloc(4);
  chunkXBytes.writeInt32LE(chunkX, 0);
  chunkZBytes.writeInt32LE(chunkZ, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(chunkBrokenSeed), deriveGlobalConfigPda().toBuffer(), chunkXBytes, chunkZBytes],
    programId,
  );
}

export function deriveChunkBrokenPda(chunkX, chunkZ) {
  return deriveChunkBrokenPdaForProgram(chunkX, chunkZ, chunkProgramId);
}

export function deriveGameChunkBrokenPda(chunkX, chunkZ) {
  return deriveChunkBrokenPdaForProgram(chunkX, chunkZ, chunkProgramId);
}

export function getChunkBrokenPdaDerivationConfig() {
  return Object.freeze({
    seed: chunkBrokenSeed,
    globalConfig: deriveGlobalConfigPda().toBase58(),
    programId: chunkProgramId.toBase58(),
  });
}

function deriveFoundationPdaForProgram(owner, foundationId, programId = chunkProgramId) {
  const idBytes = Buffer.alloc(8);
  idBytes.writeBigUInt64LE(BigInt.asUintN(64, BigInt(foundationId)));
  return PublicKey.findProgramAddressSync(
    [Buffer.from(foundationSeed), deriveGlobalConfigPda().toBuffer(), owner.toBuffer(), idBytes],
    programId,
  );
}

function deriveFoundationChunkPdaForProgram(chunkX, chunkZ, programId = chunkProgramId) {
  const chunkXBytes = Buffer.alloc(4);
  const chunkZBytes = Buffer.alloc(4);
  chunkXBytes.writeInt32LE(chunkX, 0);
  chunkZBytes.writeInt32LE(chunkZ, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(foundationChunkSeed), deriveGlobalConfigPda().toBuffer(), chunkXBytes, chunkZBytes],
    programId,
  );
}

export function deriveFoundationPda(owner, foundationId) {
  return deriveFoundationPdaForProgram(new PublicKey(owner), foundationId, chunkProgramId);
}

export function deriveFoundationChunkPda(chunkX, chunkZ) {
  return deriveFoundationChunkPdaForProgram(chunkX, chunkZ, chunkProgramId);
}

function foundationIdBuffer(foundationId) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt.asUintN(64, BigInt(foundationId)));
  return bytes;
}

function revisionBuffer(revision) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(normalizeBuildingRevision(revision));
  return bytes;
}

function deriveBuildSitePdaForProgram(foundationId, programId = buildingProgramId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(buildSiteSeed), deriveGlobalConfigPda().toBuffer(), foundationIdBuffer(foundationId)],
    programId,
  );
}

function deriveBuildingManifestPdaForProgram(foundationId, revision, programId = buildingProgramId) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(buildingManifestSeed),
      deriveGlobalConfigPda().toBuffer(),
      foundationIdBuffer(foundationId),
      revisionBuffer(revision),
    ],
    programId,
  );
}

function deriveBuildingShardPdaForProgram(foundationId, revision, shardIndex, programId = buildingProgramId) {
  const normalizedIndex = Math.trunc(Number(shardIndex));
  if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0 || normalizedIndex > 255) {
    throw new Error("Invalid building shard index.");
  }
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(buildingShardSeed),
      deriveGlobalConfigPda().toBuffer(),
      foundationIdBuffer(foundationId),
      revisionBuffer(revision),
      Buffer.from([normalizedIndex]),
    ],
    programId,
  );
}

export function deriveBuildSitePda(foundationId) {
  return deriveBuildSitePdaForProgram(foundationId, buildingProgramId);
}

export function deriveBuildingManifestPda(foundationId, revision) {
  return deriveBuildingManifestPdaForProgram(foundationId, revision, buildingProgramId);
}

export function deriveBuildingShardPda(foundationId, revision, shardIndex) {
  return deriveBuildingShardPdaForProgram(foundationId, revision, shardIndex, buildingProgramId);
}

function deriveResourceDropTablePdaForProgram(programId = chunkProgramId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(resourceDropTableSeed), deriveGlobalConfigPda().toBuffer()],
    programId,
  );
}

function deriveSurfaceDecorationTablePdaForProgram(programId = chunkProgramId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(surfaceDecorationTableSeed), deriveGlobalConfigPda().toBuffer()],
    programId,
  );
}

function derivePlayerProgressPdaForProgram(owner, programId = chunkProgramId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(playerProgressSeed), deriveGlobalConfigPda().toBuffer(), owner.toBuffer()],
    programId,
  );
}

export function deriveMaterialPhysicsPda(programId = gameContext.backpackProgramId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(materialPhysicsSeed), deriveGlobalConfigPda().toBuffer()],
    programId,
  );
}

export function derivePlayerSkillsPda(owner, programId = NICECHUNK_SKILLS_PROGRAM_ID) {
  const normalizedOwner = typeof owner === "string" ? new PublicKey(owner) : owner;
  return PublicKey.findProgramAddressSync(
    [Buffer.from(playerSkillsSeed), deriveGlobalConfigPda().toBuffer(), normalizedOwner.toBuffer()],
    programId,
  );
}

export function deriveSkillRuleTablePda(programId = NICECHUNK_SKILLS_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(skillRuleTableSeed), deriveGlobalConfigPda().toBuffer()],
    programId,
  );
}

export function deriveResourceDropTablePda() {
  return deriveResourceDropTablePdaForProgram(chunkProgramId);
}

export function deriveGameResourceDropTablePda() {
  return deriveResourceDropTablePdaForProgram(chunkProgramId);
}

export function deriveSurfaceDecorationTablePda() {
  return deriveSurfaceDecorationTablePdaForProgram(chunkProgramId);
}

export async function fetchSurfaceDecorationTableOnChain({ force = false } = {}) {
  if (!force && surfaceDecorationTableCache) return surfaceDecorationTableCache;
  const [table] = deriveSurfaceDecorationTablePdaForContext(gameContext);
  try {
    const account = await getNicechunkConnection().getAccountInfo(table, "confirmed");
    if (!account?.data?.length) {
      surfaceDecorationTableReadyAtByProgram.delete(resourceDropProgramCacheKey(gameContext));
      return {
        found: false,
        address: table.toBase58(),
        programId: gameContext.chunkProgramId.toBase58(),
        revision: 0,
        rules: [],
      };
    }
    if (!account.owner.equals(gameContext.chunkProgramId)) {
      throw new Error(`SurfaceDecorationTable owner mismatch: ${account.owner.toBase58()}`);
    }
    const decoded = decodeSurfaceDecorationTable(account.data);
    const result = Object.freeze({
      found: true,
      address: table.toBase58(),
      programId: gameContext.chunkProgramId.toBase58(),
      ...decoded,
    });
    markSurfaceDecorationTableReady(gameContext);
    surfaceDecorationTableCache = result;
    return result;
  } catch (error) {
    reportRpcError(error, "surface-decoration-table");
    throw error;
  }
}

export function decodeSurfaceDecorationTable(input) {
  const data = Buffer.from(input ?? []);
  if (
    data.length !== surfaceDecorationTableLength ||
    data.subarray(0, 8).toString("utf8") !== surfaceDecorationTableMagic ||
    data.readUInt8(8) !== surfaceDecorationTableVersion
  ) {
    throw new Error(`Invalid SurfaceDecorationTable data length or header: ${data.length}`);
  }
  const count = data.readUInt8(10);
  if (count === 0 || count > surfaceDecorationRuleMaxCount) {
    throw new Error(`Invalid SurfaceDecorationTable rule count: ${count}`);
  }
  const rules = [];
  const ids = new Set();
  for (let index = 0; index < count; index += 1) {
    const offset = surfaceDecorationTableHeaderLength + index * surfaceDecorationRuleLength;
    const rule = {
      ruleId: data.readUInt16LE(offset),
      decorationId: data.readUInt16LE(offset + 2),
      surfaceBlockId: data.readUInt16LE(offset + 4),
      dropBlockId: data.readUInt16LE(offset + 6),
      rollStartBps: data.readUInt16LE(offset + 8),
      rollEndBps: data.readUInt16LE(offset + 10),
      minY: data.readInt16LE(offset + 12),
      maxY: data.readInt16LE(offset + 14),
      salt: data.readUInt16LE(offset + 16),
      variant: data.readUInt8(offset + 18),
      flags: data.readUInt8(offset + 19),
    };
    if (
      rule.ruleId === 0 ||
      rule.decorationId === 0 ||
      ids.has(rule.ruleId) ||
      rule.rollStartBps >= rule.rollEndBps ||
      rule.rollEndBps > 10_000 ||
      rule.minY > rule.maxY
    ) {
      throw new Error(`Invalid SurfaceDecorationTable rule at index ${index}`);
    }
    ids.add(rule.ruleId);
    rules.push(Object.freeze(rule));
  }
  return {
    version: data.readUInt8(8),
    bump: data.readUInt8(9),
    revision: data.readUInt32LE(12),
    rules: Object.freeze(rules),
  };
}

export function derivePlayerProgressPda(owner) {
  return derivePlayerProgressPdaForProgram(owner, chunkProgramId);
}

function deriveBackpackPdaForProgram(owner, backpackId, programId = gameProgramId) {
  const backpackIdBytes = Buffer.alloc(8);
  backpackIdBytes.writeBigUInt64LE(BigInt(backpackId), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(backpackSeed), owner.toBuffer(), backpackIdBytes],
    programId,
  );
}

export function deriveBackpackPda(owner, backpackId) {
  return deriveBackpackPdaForProgram(owner, backpackId, gameProgramId);
}

export function deriveGameBackpackPda(owner, backpackId) {
  return deriveBackpackPdaForProgram(owner, backpackId, gameProgramId);
}

function deriveMarketListingPdaForProgram(seller, listingId, programId = gameProgramId) {
  const listingIdBytes = Buffer.alloc(8);
  listingIdBytes.writeBigUInt64LE(BigInt(listingId), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(marketListingSeed), seller.toBuffer(), listingIdBytes],
    programId,
  );
}

export function deriveMarketListingPda(seller, listingId) {
  return deriveMarketListingPdaForProgram(seller, listingId, gameProgramId);
}

export function deriveGameMarketListingPda(seller, listingId) {
  return deriveMarketListingPdaForProgram(seller, listingId, gameProgramId);
}

function deriveMarketAuthorityPdaForProgram(programId = gameProgramId) {
  return PublicKey.findProgramAddressSync([Buffer.from(marketAuthoritySeed)], programId);
}

export function deriveMarketAuthorityPda() {
  return deriveMarketAuthorityPdaForProgram(gameProgramId);
}

export function deriveGameMarketAuthorityPda() {
  return deriveMarketAuthorityPdaForProgram(gameProgramId);
}

function deriveSmeltingRecipeTablePdaForProgram(tableId = smeltingDefaultRecipeTableId, programId = gameProgramId) {
  const tableIdBytes = Buffer.alloc(8);
  tableIdBytes.writeBigUInt64LE(BigInt(tableId), 0);
  return PublicKey.findProgramAddressSync([Buffer.from(smeltingRecipeTableSeed), tableIdBytes], programId);
}

export function deriveSmeltingRecipeTablePda(tableId = smeltingDefaultRecipeTableId) {
  return deriveSmeltingRecipeTablePdaForProgram(tableId, gameProgramId);
}

export function deriveGameSmeltingRecipeTablePda(tableId = smeltingDefaultRecipeTableId) {
  return deriveSmeltingRecipeTablePdaForProgram(tableId, gameProgramId);
}

function deriveSmeltingAuthorityPdaForProgram(programId = gameProgramId) {
  return PublicKey.findProgramAddressSync([Buffer.from(smeltingAuthoritySeed)], programId);
}

export function deriveSmeltingAuthorityPda() {
  return deriveSmeltingAuthorityPdaForProgram(gameProgramId);
}

export function deriveGameSmeltingAuthorityPda() {
  return deriveSmeltingAuthorityPdaForProgram(gameProgramId);
}

const gameContext = Object.freeze({
  isUnifiedGame: true,
  programId: gameProgramId,
  chunkProgramId,
  buildingProgramId,
  backpackProgramId: gameProgramId,
  marketProgramId: gameProgramId,
  smeltingProgramId: gameProgramId,
});

function contextInstructionData(context, namespace, data) {
  if (!context?.isUnifiedGame) return data;
  const targetProgram =
    namespace === gameNamespaceChunk ? context.chunkProgramId :
    namespace === gameNamespaceBackpack ? context.backpackProgramId :
    namespace === gameNamespaceMarket ? context.marketProgramId :
    namespace === gameNamespaceSmelting ? context.smeltingProgramId :
    context.programId;
  return targetProgram?.equals?.(context.programId) ? Buffer.concat([Buffer.from([namespace]), data]) : data;
}

function deriveChunkBrokenPdaForContext(chunkX, chunkZ, context = gameContext) {
  return deriveChunkBrokenPdaForProgram(chunkX, chunkZ, context.chunkProgramId);
}

function deriveFoundationPdaForContext(owner, foundationId, context = gameContext) {
  return deriveFoundationPdaForProgram(owner, foundationId, context.chunkProgramId);
}

function deriveFoundationChunkPdaForContext(chunkX, chunkZ, context = gameContext) {
  return deriveFoundationChunkPdaForProgram(chunkX, chunkZ, context.chunkProgramId);
}

function deriveBuildSitePdaForContext(foundationId, context = gameContext) {
  return deriveBuildSitePdaForProgram(foundationId, context.buildingProgramId);
}

function deriveBuildingManifestPdaForContext(foundationId, revision, context = gameContext) {
  return deriveBuildingManifestPdaForProgram(foundationId, revision, context.buildingProgramId);
}

function deriveBuildingShardPdaForContext(foundationId, revision, shardIndex, context = gameContext) {
  return deriveBuildingShardPdaForProgram(foundationId, revision, shardIndex, context.buildingProgramId);
}

function deriveResourceDropTablePdaForContext(context = gameContext) {
  return deriveResourceDropTablePdaForProgram(context.chunkProgramId);
}

function deriveSurfaceDecorationTablePdaForContext(context = gameContext) {
  return deriveSurfaceDecorationTablePdaForProgram(context.chunkProgramId);
}

function derivePlayerProgressPdaForContext(owner, context = gameContext) {
  return derivePlayerProgressPdaForProgram(owner, context.chunkProgramId);
}

function deriveSmeltingPlayerProgressPdaForContext(owner, context = gameContext) {
  return derivePlayerProgressPdaForProgram(owner, context.smeltingProgramId);
}

function deriveBackpackPdaForContext(owner, backpackId, context = gameContext) {
  return deriveBackpackPdaForProgram(owner, backpackId, context.backpackProgramId);
}

function deriveMarketListingPdaForContext(seller, listingId, context = gameContext) {
  return deriveMarketListingPdaForProgram(seller, listingId, context.marketProgramId);
}

function deriveMarketAuthorityPdaForContext(context = gameContext) {
  return deriveMarketAuthorityPdaForProgram(context.marketProgramId);
}

function deriveSmeltingRecipeTablePdaForContext(tableId = smeltingDefaultRecipeTableId, context = gameContext) {
  return deriveSmeltingRecipeTablePdaForProgram(tableId, context.smeltingProgramId);
}

function deriveSmeltingAuthorityPdaForContext(context = gameContext) {
  return deriveSmeltingAuthorityPdaForProgram(context.smeltingProgramId);
}

export async function executeSmeltingOnChain({
  recipeId,
  recipeTableId = smeltingDefaultRecipeTableId,
  inputIndexes = [],
  fuelIndexes = [],
  batchMultiplier = 1,
  backpackAddress = null,
} = {}) {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const normalizedInputIndexes = normalizeBackpackIndexes(inputIndexes);
  const normalizedFuelIndexes = normalizeBackpackIndexes(fuelIndexes);
  if (!isValidSmeltingSubmissionSelection({ recipeId, inputIndexes, fuelIndexes })) {
    return { submitted: false, reason: "invalid-smelting-inputs" };
  }
  const conn = getNicechunkConnection();
  const backpack = backpackAddress
    ? new PublicKey(backpackAddress)
    : (await loadEquippedBackpackForOwner(provider.publicKey, conn))?.publicKey;
  if (!backpack) return { submitted: false, reason: "no-backpack" };
  const backpackAccount = await fetchBackpack(backpack);
  if (!backpackAccount?.publicKey) return { submitted: false, reason: "no-backpack" };
  const context = gameContext;
  const [recipeTable] = deriveSmeltingRecipeTablePdaForContext(recipeTableId, context);
  const recipeTableAccount = await conn.getAccountInfo(recipeTable, "confirmed");
  if (!recipeTableAccount?.data?.length) {
    return { submitted: false, reason: "smelting-table-uninitialized", recipeTable: recipeTable.toBase58() };
  }
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  tx.add(createExecuteSmeltingInstruction({
    owner: provider.publicKey,
    recipeTable,
    backpack,
    recipeId,
    inputIndexes: normalizedInputIndexes,
    fuelIndexes: normalizedFuelIndexes,
    batchMultiplier,
    context,
  }));
  tx.add(createSyncPlayerSkillsInstruction({
    payer: provider.publicKey,
    owner: provider.publicKey,
    sourceAccounts: [
      deriveSmeltingPlayerProgressPdaForContext(provider.publicKey, context)[0],
      derivePlayerProfilePda(provider.publicKey)[0],
      backpack,
    ],
  }));
  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  return {
    submitted: true,
    signature,
    backpack: backpack.toBase58(),
    recipeId: BigInt(recipeId).toString(),
    inputIndexes: normalizedInputIndexes,
    fuelIndexes: normalizedFuelIndexes,
    batchMultiplier,
    recipeTable: recipeTable.toBase58(),
    recipeTableId: BigInt(recipeTableId).toString(),
    programId: context.smeltingProgramId.toBase58(),
  };
}

export function isValidSmeltingSubmissionSelection({
  recipeId,
  inputIndexes = [],
  fuelIndexes = [],
} = {}) {
  let normalizedRecipeId;
  try {
    normalizedRecipeId = BigInt(recipeId || 0);
  } catch {
    return false;
  }
  const rawInputs = Array.isArray(inputIndexes) ? inputIndexes : [];
  const rawFuels = Array.isArray(fuelIndexes) ? fuelIndexes : [];
  const inputs = normalizeBackpackIndexes(rawInputs);
  const fuels = normalizeBackpackIndexes(rawFuels);
  if (normalizedRecipeId <= 0n || !inputs.length) return false;
  if (inputs.length !== rawInputs.length || fuels.length !== rawFuels.length) return false;
  return new Set([...inputs, ...fuels]).size === inputs.length + fuels.length;
}

export async function createMarketListingOnChain({
  item,
  currency,
  price,
  backpackAddress = null,
}) {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const sourceType = item?.source === "equipment" ? "equipment" : item?.source === "backpack" ? "backpack" : "";
  if (!sourceType) return { submitted: false, reason: "listing-unavailable" };

  const listingId = createMarketListingId();
  const normalizedCurrency = String(currency || "NCK").toUpperCase();
  const priceBaseUnits = parseMarketPriceBaseUnits(price, normalizedCurrency);
  const backpackSource = await fetchBackpack(backpackAddress || item?.backpack).catch(() => null);
  const context = gameContext;
  const [listing] = deriveMarketListingPdaForContext(provider.publicKey, listingId, context);
  const sourceInventory = backpackSource?.publicKey ?? backpackAddress ?? item?.backpack;
  if (!backpackSource?.publicKey || !sourceInventory || !Number.isInteger(item?.slotIndex)) {
    return { submitted: false, reason: "listing-unavailable" };
  }
  if (sourceType === "equipment" && (item.slotIndex < 0 || item.slotIndex > 8)) {
    return { submitted: false, reason: "listing-unavailable" };
  }
  const tx = new Transaction();
  tx.add(createMarketListingInstruction({
    seller: provider.publicKey,
    listing,
    listingId,
    currency: normalizedCurrency,
    sourceType,
    sourceIndex: item.slotIndex,
    priceBaseUnits,
    sourceInventory,
    context,
  }));

  const conn = getNicechunkConnection();
  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  return {
    submitted: true,
    signature,
    listing: listing.toBase58(),
    listingId: listingId.toString(),
    seller: provider.publicKey.toBase58(),
    priceBaseUnits: priceBaseUnits.toString(),
    sourceInventory,
    source: sourceType,
    programId: context.marketProgramId.toBase58(),
  };
}

export async function cancelMarketListingOnChain({
  listing,
  listingId,
  source = null,
  sourceInventory = null,
}) {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const listingPublicKey = listing
    ? new PublicKey(listing)
    : deriveMarketListingPdaForContext(provider.publicKey, BigInt(listingId), gameContext)[0];
  const context = gameContext;
  const conn = getNicechunkConnection();
  const destinationBackpack = sourceInventory
    ? await loadBackpackAccountForOwner(sourceInventory, provider.publicKey, conn).catch(() => null)
    : await loadEquippedBackpackForOwner(provider.publicKey, conn);
  if (!destinationBackpack?.publicKey) return { submitted: false, reason: "no-backpack" };
  if (destinationBackpack.itemCount >= destinationBackpack.capacity) {
    return { submitted: false, reason: "backpack-full" };
  }
  const tx = new Transaction().add(createCancelMarketListingInstruction({
    seller: provider.publicKey,
    listing: listingPublicKey,
    source,
    sourceInventory: destinationBackpack.publicKey,
    context,
  }));
  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  return {
    submitted: true,
    signature,
    listing: listingPublicKey.toBase58(),
    programId: context.marketProgramId.toBase58(),
  };
}

export async function buyMarketListingOnChain({ listing, buyerBackpackAddress = null }) {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  if (!listing?.listing || !listing?.seller) return { submitted: false, reason: "listing-unavailable" };

  const listingPublicKey = new PublicKey(listing.listing);
  const seller = new PublicKey(listing.seller);
  if (seller.equals(provider.publicKey)) return { submitted: false, reason: "self-purchase" };

  const currency = String(listing.currency || "NCK").toUpperCase();
  if (!buyerBackpackAddress) {
    return { submitted: false, reason: "no-backpack" };
  }
  const conn = getNicechunkConnection();
  const context = gameContext;
  const buyerBackpack = await fetchBackpack(buyerBackpackAddress);
  if (!buyerBackpack?.publicKey) return { submitted: false, reason: "no-backpack" };
  if (buyerBackpack.itemCount >= buyerBackpack.capacity) return { submitted: false, reason: "backpack-full" };
  const tx = new Transaction();
  if (currency === "NCK") {
    const buyerNckToken = getAssociatedTokenAddressSync(nckMint, provider.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const sellerNckToken = getAssociatedTokenAddressSync(nckMint, seller, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const treasuryNckToken = getAssociatedTokenAddressSync(nckMint, marketTreasury, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const [buyerNckAccount, sellerNckAccount, treasuryNckAccount] = await Promise.all([
      conn.getAccountInfo(buyerNckToken, "confirmed"),
      conn.getAccountInfo(sellerNckToken, "confirmed"),
      conn.getAccountInfo(treasuryNckToken, "confirmed"),
    ]);
    if (!buyerNckAccount?.data?.length) return { submitted: false, reason: "nck-token-missing" };
    if (!sellerNckAccount?.data?.length) {
      tx.add(createAssociatedTokenAccountInstruction(
        provider.publicKey,
        sellerNckToken,
        seller,
        nckMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ));
    }
    if (!treasuryNckAccount?.data?.length) {
      tx.add(createAssociatedTokenAccountInstruction(
        provider.publicKey,
        treasuryNckToken,
        marketTreasury,
        nckMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ));
    }
    tx.add(createBuyMarketListingInstruction({
      buyer: provider.publicKey,
      seller,
      listing: listingPublicKey,
      currency,
      buyerNckToken,
      sellerNckToken,
      treasuryNckToken,
      buyerBackpackAddress,
      context,
    }));
  } else if (currency === "SOL") {
    tx.add(createBuyMarketListingInstruction({
      buyer: provider.publicKey,
      seller,
      listing: listingPublicKey,
      currency,
      buyerBackpackAddress,
      context,
    }));
  } else {
    throw new Error(`Unsupported market currency: ${currency}`);
  }

  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  return {
    submitted: true,
    signature,
    listing: listingPublicKey.toBase58(),
    buyer: provider.publicKey.toBase58(),
    seller: seller.toBase58(),
    currency,
    programId: context.marketProgramId.toBase58(),
  };
}

export async function fetchMarketListingsOnChain({
  seller = null,
  state = null,
  category = "all",
  currency = "all",
  source = null,
  query = "",
  sort = "newest",
} = {}) {
  const filters = [{ dataSize: marketListingLength }];
  if (seller) {
    const sellerKey = typeof seller === "string" ? new PublicKey(seller) : seller;
    filters.push({ memcmp: { offset: marketListingSellerOffset, bytes: sellerKey.toBase58() } });
  }
  const stateCode = state ? marketStateCodes.get(String(state).toLowerCase()) : null;
  if (stateCode) {
    filters.push(createSingleByteMemcmpFilter(marketListingStateOffset, stateCode));
  }
  const currencyCode = currency && currency !== "all" ? marketCurrencyCodes.get(String(currency).toUpperCase()) : null;
  if (currencyCode) {
    filters.push(createSingleByteMemcmpFilter(marketListingCurrencyOffset, currencyCode));
  }
  const conn = getNicechunkConnection();
  const accounts = (await conn.getProgramAccounts(gameProgramId, {
    commitment: "confirmed",
    filters,
  })).map((entry) => ({ ...entry, programId: gameProgramId }));
  const listings = accounts
    .map(({ pubkey, account, programId }) => {
      try {
        return { ...decodeMarketListing(account.data), listing: pubkey.toBase58(), programId: programId.toBase58() };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return filterAndSortMarketListings(listings, { state, category, currency, source, query, sort });
}

export async function fetchMarketListingsPageOnChain({
  page = 1,
  pageSize = 20,
  ...filters
} = {}) {
  const listings = await fetchMarketListingsOnChain(filters);
  const normalizedPageSize = Math.max(1, Math.min(500, Math.floor(Number(pageSize) || 20)));
  const total = listings.length;
  const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
  const currentPage = Math.min(Math.max(1, Math.floor(Number(page) || 1)), totalPages);
  const startIndex = total ? (currentPage - 1) * normalizedPageSize : 0;
  const endIndex = total ? Math.min(total, startIndex + normalizedPageSize) : 0;
  return {
    items: listings.slice(startIndex, endIndex),
    pageInfo: {
      page: currentPage,
      pageSize: normalizedPageSize,
      total,
      totalPages,
      start: total ? startIndex + 1 : 0,
      end: endIndex,
    },
  };
}

function createSingleByteMemcmpFilter(offset, value) {
  const byte = Number(value);
  if (!Number.isInteger(byte) || byte < 0 || byte >= base58Alphabet.length) {
    throw new Error(`Invalid single-byte memcmp value: ${value}`);
  }
  return { memcmp: { offset, bytes: base58Alphabet[byte] } };
}

function filterAndSortMarketListings(listings, {
  state = null,
  category = "all",
  currency = "all",
  source = null,
  query = "",
  sort = "newest",
} = {}) {
  const normalizedState = state ? String(state).toLowerCase() : null;
  const normalizedCategory = String(category || "all").toLowerCase();
  const normalizedCurrency = String(currency || "all").toUpperCase();
  const normalizedSource = source ? String(source).toLowerCase() : null;
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const filtered = listings.filter((listing) => {
    if (normalizedState && listing.stateLabel !== normalizedState) return false;
    if (normalizedCategory !== "all" && listing.category !== normalizedCategory) return false;
    if (normalizedCurrency !== "ALL" && listing.currency !== normalizedCurrency) return false;
    if (normalizedSource && listing.source !== normalizedSource) return false;
    if (!normalizedQuery) return true;
    return marketListingSearchText(listing).includes(normalizedQuery);
  });
  return filtered.sort((a, b) => {
    if (sort === "oldest") return marketListingCreatedAt(a) - marketListingCreatedAt(b);
    if (sort === "price-asc") return marketListingPriceValue(a) - marketListingPriceValue(b);
    if (sort === "price-desc") return marketListingPriceValue(b) - marketListingPriceValue(a);
    return marketListingCreatedAt(b) - marketListingCreatedAt(a);
  });
}

function marketListingCreatedAt(listing) {
  const value = Number(listing?.createdAt || 0);
  return Number.isFinite(value) ? value : 0;
}

function marketListingPriceValue(listing) {
  const value = Number(listing?.price || 0);
  return Number.isFinite(value) ? value : 0;
}

function marketListingSearchText(listing) {
  const record = listing?.sourceRecord;
  const slot = listing?.sourceSlot;
  return [
    listing?.listing,
    listing?.listingId,
    listing?.seller,
    listing?.category,
    listing?.currency,
    listing?.source,
    listing?.sourceInventory,
    listing?.price,
    record ? `${record.worldX},${record.worldY},${record.worldZ}` : "",
    slot?.itemId,
    slot?.itemCode,
  ]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .map((part) => String(part))
    .join(" ")
    .toLowerCase();
}

export async function loadChunkBlockDeltas(chunkX, chunkZ) {
  if (!isNicechunkChainSyncEnabled()) return [];
  const key = chunkCacheKey(chunkX, chunkZ);
  const cached = readFreshChunkDeltaCache(key);
  if (cached) return cached;
  const deltasByChunk = await loadChunkBlockDeltasBatch([{ chunkX, chunkZ }], { batchSize: 1 });
  return deltasByChunk.get(key) ?? [];
}

export async function loadChunkBlockDeltasBatch(chunks, { batchSize = 50 } = {}) {
  if (!isNicechunkChainSyncEnabled() || !Array.isArray(chunks) || !chunks.length) return new Map();
  const results = new Map();
  const uniqueChunks = dedupeChunks(chunks);
  const pendingReads = [];
  const chunksToFetch = [];
  for (const chunk of uniqueChunks) {
    const key = chunkCacheKey(chunk.chunkX, chunk.chunkZ);
    const cached = readFreshChunkDeltaCache(key);
    if (cached) {
      results.set(key, cached);
      continue;
    }
    const entry = chunkDeltaCache.get(key);
    if (entry?.promise) {
      pendingReads.push(entry.promise.then((deltas) => results.set(key, deltas ?? [])));
      continue;
    }
    chunksToFetch.push(chunk);
  }
  if (!chunksToFetch.length) {
    if (pendingReads.length) await Promise.all(pendingReads);
    return results;
  }
  const conn = getNicechunkConnection();

  for (let start = 0; start < chunksToFetch.length; start += batchSize) {
    const batch = chunksToFetch.slice(start, start + batchSize);
    const accounts = batch.map((chunk) => deriveChunkBrokenPdaForContext(chunk.chunkX, chunk.chunkZ, gameContext)[0]);
    const batchPromise = conn.getMultipleAccountsInfo(accounts, "confirmed")
      .then((infos) => {
        const loadedAt = Date.now();
        const batchResults = new Map();
        for (let index = 0; index < batch.length; index += 1) {
          const chunk = batch[index];
          const key = chunkCacheKey(chunk.chunkX, chunk.chunkZ);
          const brokenAccount = infos[index];
          const exists = Boolean(brokenAccount?.data?.length);
          const deltas = exists ? decodeChunkBrokenDeltas(brokenAccount.data, chunk.chunkX, chunk.chunkZ) : [];
          chunkDeltaCache.set(key, { deltas, exists, loadedAt, promise: null });
          if (exists) initializedChunkBrokenCache.add(chunkProgramCacheKey(gameContext, chunk.chunkX, chunk.chunkZ));
          batchResults.set(key, deltas);
        }
        return batchResults;
      })
      .catch((error) => {
        for (const chunk of batch) chunkDeltaCache.delete(chunkCacheKey(chunk.chunkX, chunk.chunkZ));
        reportRpcError(error, "chunk-delta-batch");
        throw error;
      });
    for (const chunk of batch) {
      const key = chunkCacheKey(chunk.chunkX, chunk.chunkZ);
      chunkDeltaCache.set(key, {
        deltas: [],
        loadedAt: 0,
        promise: batchPromise.then((batchResults) => batchResults.get(key) ?? []),
      });
    }
    let infos;
    try {
      infos = await batchPromise;
    } catch (error) {
      throw error;
    }
    for (const [key, deltas] of infos) results.set(key, deltas);
  }
  if (pendingReads.length) await Promise.all(pendingReads);
  return results;
}

export async function loadOwnedFoundations(wallet) {
  if (!isNicechunkChainSyncEnabled()) return [];
  const owner = new PublicKey(wallet);
  const conn = getNicechunkConnection();
  const query = (programId, dataSize) => conn.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      { dataSize },
      { memcmp: { offset: buildSiteOwnerOffset, bytes: owner.toBase58() } },
    ],
  });
  const [current, legacy] = await Promise.all([
    query(gameContext.buildingProgramId, buildSiteLength),
    query(gameContext.chunkProgramId, legacyBuildSiteLength),
  ]);
  const foundations = new Map();
  for (const [records, programId, isLegacy] of [
    [legacy, gameContext.chunkProgramId, true],
    [current, gameContext.buildingProgramId, false],
  ]) {
    for (const { pubkey, account } of records) {
      if (!account.owner.equals(programId)) throw new Error("Invalid BuildSite owner.");
      const foundation = {
        ...decodeBuildSite(account.data, pubkey.toBase58()),
        programId: programId.toBase58(),
        legacy: isLegacy,
      };
      foundations.set(foundation.foundationId, foundation);
    }
  }
  return [...foundations.values()];
}

export async function loadBuildingsForFoundations(foundations = []) {
  if (!isNicechunkChainSyncEnabled() || !Array.isArray(foundations) || !foundations.length) return [];
  const unique = new Map();
  for (const foundation of foundations) {
    const revision = normalizeBuildingRevision(foundation?.activeRevision || 0, { allowZero: true });
    if (!revision) continue;
    unique.set(String(foundation.foundationId), { ...foundation, activeRevision: revision });
  }
  if (!unique.size) return [];
  const conn = getNicechunkConnection();
  const records = [...unique.values()];
  const cachedByKey = new Map();
  const recordsToLoad = [];
  for (const foundation of records) {
    const key = buildingCacheKey(foundation);
    const cached = buildingPayloadCache.get(key);
    const expectedPrefix = String(foundation?.contentHash || "").trim().toLowerCase();
    if (expectedPrefix && !/^[0-9a-f]{32}$/.test(expectedPrefix)) {
      throw new Error("Invalid Guardian building hash prefix.");
    }
    if (cached && (!expectedPrefix || String(cached.contentHash || "").startsWith(expectedPrefix))) {
      buildingPayloadCache.delete(key);
      buildingPayloadCache.set(key, cached);
      cachedByKey.set(key, cached);
    } else {
      recordsToLoad.push(foundation);
    }
  }
  const manifestPrograms = recordsToLoad.map((foundation) => buildingProgramForFoundation(foundation, gameContext));
  const manifestAddresses = recordsToLoad.map((foundation, index) => deriveBuildingManifestPdaForProgram(
    foundation.foundationId,
    foundation.activeRevision,
    manifestPrograms[index],
  )[0]);
  const manifestInfos = await getMultipleAccountsInfoBatched(conn, manifestAddresses, 100);
  const manifests = [];
  for (let index = 0; index < recordsToLoad.length; index += 1) {
    const account = manifestInfos[index];
    if (!account?.data?.length) {
      throw new Error(`Building manifest ${recordsToLoad[index].foundationId}:${recordsToLoad[index].activeRevision} is unavailable.`);
    }
    if (!account.owner?.equals?.(manifestPrograms[index])) throw new Error("Invalid BuildingManifest owner.");
    const manifest = decodeBuildingManifest(account.data, manifestAddresses[index].toBase58());
    if (manifest.status !== "active") {
      throw new Error(`Building manifest ${manifest.foundationId}:${manifest.revision} is not active.`);
    }
    const foundation = recordsToLoad[index];
    if (manifest.foundationId !== String(foundation.foundationId)
      || manifest.revision !== foundation.activeRevision
      || manifest.owner !== foundation.owner) {
      throw new Error("BuildingManifest does not match its verified BuildSite.");
    }
    manifests.push({ foundation, manifest, programId: manifestPrograms[index] });
  }
  const shardRequests = [];
  for (const entry of manifests) {
    for (let shardIndex = 0; shardIndex < entry.manifest.shardCount; shardIndex += 1) {
      shardRequests.push({
        entry,
        shardIndex,
        address: deriveBuildingShardPdaForProgram(
          entry.foundation.foundationId,
          entry.foundation.activeRevision,
          shardIndex,
          entry.programId,
        )[0],
      });
    }
  }
  const shardInfos = await getMultipleAccountsInfoBatched(conn, shardRequests.map((request) => request.address), 100);
  const shardsByBuilding = new Map();
  for (let index = 0; index < shardRequests.length; index += 1) {
    const request = shardRequests[index];
    const account = shardInfos[index];
    if (!account?.data?.length || !account.owner?.equals?.(request.entry.programId)) {
      throw new Error(`Building shard ${request.shardIndex} is unavailable.`);
    }
    const shard = decodeBuildingShard(account.data, request.address.toBase58());
    if (shard.foundationId !== String(request.entry.foundation.foundationId)
      || shard.revision !== request.entry.foundation.activeRevision
      || shard.shardIndex !== request.shardIndex) {
      throw new Error("Building shard foundation mismatch.");
    }
    const key = `${request.entry.foundation.foundationId}:${request.entry.foundation.activeRevision}`;
    const list = shardsByBuilding.get(key) ?? [];
    list[request.shardIndex] = shard.payload;
    shardsByBuilding.set(key, list);
  }
  const loadedByKey = new Map();
  for (const { foundation, manifest } of manifests) {
    const key = `${foundation.foundationId}:${foundation.activeRevision}`;
    const shards = shardsByBuilding.get(key) ?? [];
    if (shards.length !== manifest.shardCount || shards.some((shard) => !shard)) {
      throw new Error(`Building ${key} has an incomplete shard set.`);
    }
    const payload = Buffer.concat(shards);
    if (payload.length !== manifest.payloadLen) throw new Error("Building payload length mismatch.");
    const digest = await sha256Buffer(payload);
    if (!digest.equals(manifest.expectedHash)) throw new Error("Building payload hash mismatch.");
    const expectedPrefix = String(foundation?.contentHash || "").trim().toLowerCase();
    const digestHex = digest.toString("hex");
    if (expectedPrefix && !digestHex.startsWith(expectedPrefix)) {
      throw new Error("Building payload does not match the Guardian manifest hash.");
    }
    const building = {
      id: `${foundation.id}:building:${foundation.activeRevision}`,
      owner: foundation.owner,
      foundationId: foundation.foundationId,
      foundation: foundation.id,
      revision: foundation.activeRevision,
      quarterTurns: manifest.quarterTurns,
      offsetX: manifest.offsetX,
      offsetZ: manifest.offsetZ,
      code: `NCM3:${base64UrlEncode(payload)}`,
      contentHash: digestHex,
      payloadBytes: payload.length,
      manifestPda: manifest.address,
      programId: buildingProgramForFoundation(foundation, gameContext).toBase58(),
      updatedSlot: manifest.updatedSlot,
    };
    loadedByKey.set(buildingCacheKey(foundation), building);
    cacheBuildingPayload(buildingCacheKey(foundation), building);
  }
  return records
    .map((foundation) => cachedByKey.get(buildingCacheKey(foundation)) ?? loadedByKey.get(buildingCacheKey(foundation)))
    .filter(Boolean);
}

export function decodeFoundationChunk(input, { chunkX = null, chunkZ = null, address = "" } = {}) {
  const data = Buffer.from(input ?? []);
  if (data.length !== foundationChunkLength
    || data.subarray(0, 8).toString("utf8") !== foundationChunkMagic
    || data.readUInt8(8) !== foundationChunkVersion) {
    throw new Error("Invalid FoundationChunk account data.");
  }
  const storedChunkX = data.readInt32LE(44);
  const storedChunkZ = data.readInt32LE(48);
  if (Number.isInteger(chunkX) && storedChunkX !== chunkX || Number.isInteger(chunkZ) && storedChunkZ !== chunkZ) {
    throw new Error("FoundationChunk coordinates do not match the requested PDA.");
  }
  const count = data.readUInt16LE(10);
  if (count > foundationChunkCapacity) throw new Error("Invalid FoundationChunk record count.");
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const offset = foundationChunkHeaderLength + index * foundationChunkRecordLength;
    const owner = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    const foundationId = data.readBigUInt64LE(offset + 32).toString();
    const minX = data.readInt32LE(offset + 40);
    const minZ = data.readInt32LE(offset + 44);
    const surfaceY = data.readInt16LE(offset + 48);
    const width = data.readUInt8(offset + 50);
    const depth = data.readUInt8(offset + 51);
    if (width < foundationMinSize || width > foundationMaxSize || depth < foundationMinSize || depth > foundationMaxSize) {
      throw new Error("Invalid FoundationChunk rectangle.");
    }
    records.push({
      id: `${owner}:${foundationId}`,
      owner,
      foundationId,
      minX,
      minZ,
      surfaceY,
      width,
      depth,
      status: "active",
      chunkX: storedChunkX,
      chunkZ: storedChunkZ,
      sourcePda: address,
    });
  }
  return records;
}

export function decodeBuildSite(input, address = "") {
  const data = Buffer.from(input ?? []);
  const version = data.length >= 11 ? data.readUInt8(8) : 0;
  const legacy = data.length === legacyBuildSiteLength && version === legacyBuildSiteVersion;
  const current = data.length === buildSiteLength && version === buildSiteVersion;
  const statusCode = data.length >= 11 ? data.readUInt8(10) : 255;
  if ((!legacy && !current)
    || data.subarray(0, 8).toString("utf8") !== buildSiteMagic
    || legacy && statusCode !== 1
    || current && !buildSiteStatusNames.has(statusCode)) {
    throw new Error("Invalid BuildSite account data.");
  }
  const owner = new PublicKey(data.subarray(16, 48)).toBase58();
  const foundationId = data.readBigUInt64LE(80).toString();
  const minX = data.readInt32LE(88);
  const minZ = data.readInt32LE(92);
  const width = data.readUInt32LE(100);
  const depth = data.readUInt32LE(104);
  const maxX = minX + width - 1;
  const maxZ = minZ + depth - 1;
  const activeRevision = data.readUInt32LE(116);
  const pendingRevision = data.readUInt32LE(120);
  const registeredChunks = current ? data.readBigUInt64LE(132) : 0n;
  const totalChunks = current ? data.readBigUInt64LE(140) : 0n;
  const stagedWidth = current ? data.readUInt32LE(148) : 0;
  const stagedDepth = current ? data.readUInt32LE(152) : 0;
  if (foundationId === "0" || width < foundationMinSize || depth < foundationMinSize
    || maxX > 0x7fffffff || maxX < -0x80000000
    || maxZ > 0x7fffffff || maxZ < -0x80000000
    || pendingRevision && (activeRevision === 0xffffffff || pendingRevision !== activeRevision + 1)
    || current && registeredChunks > totalChunks
    || current && statusCode === 1 && (registeredChunks !== totalChunks || stagedWidth || stagedDepth)
    || current && statusCode !== 1 && registeredChunks === totalChunks
    || current && statusCode >= 2 && (stagedWidth < foundationMinSize || stagedDepth < foundationMinSize)) {
    throw new Error("Invalid BuildSite rectangle.");
  }
  const status = legacy ? "active" : buildSiteStatusNames.get(statusCode);
  return {
    id: `${owner}:${foundationId}`,
    owner,
    foundationId,
    minX,
    minZ,
    maxX,
    maxZ,
    surfaceY: data.readInt16LE(96),
    width,
    depth,
    status,
    statusCode,
    hasActiveGeometry: legacy || statusCode !== 0,
    accountVersion: version,
    activeRevision,
    pendingRevision,
    registeredChunks: registeredChunks.toString(),
    totalChunks: totalChunks.toString(),
    stagedWidth,
    stagedDepth,
    createdSlot: data.readBigUInt64LE(108).toString(),
    updatedSlot: data.readBigUInt64LE(124).toString(),
    sourcePda: address,
  };
}

export function decodeBuildingManifest(input, address = "") {
  const data = Buffer.from(input ?? []);
  if (data.length !== buildingManifestLength
    || data.subarray(0, 8).toString("utf8") !== buildingManifestMagic
    || data.readUInt8(8) !== buildingManifestVersion
    || data.readUInt8(10) > 1
    || data.readUInt8(11) > 3) {
    throw new Error("Invalid BuildingManifest account data.");
  }
  const payloadLen = data.readUInt32LE(92);
  const shardCount = buildingShardCount(payloadLen);
  const status = data.readUInt8(10);
  const uploadedBitmap = data.readUInt16LE(14);
  const foundationId = data.readBigUInt64LE(80).toString();
  const revision = data.readUInt32LE(88);
  const sizeX = data.readUInt16LE(128);
  const sizeY = data.readUInt16LE(130);
  const sizeZ = data.readUInt16LE(132);
  const hasDimensions = sizeX > 0 && sizeY > 0 && sizeZ > 0;
  if (data.readUInt8(12) !== shardCount
    || uploadedBitmap & ~((1 << shardCount) - 1)
    || foundationId === "0"
    || revision === 0
    || sizeX > 256 || sizeY > 256 || sizeZ > 256
    || status === 0 && hasDimensions
    || status === 1 && !hasDimensions) {
    throw new Error("Invalid BuildingManifest state.");
  }
  return {
    address,
    status: status === 1 ? "active" : "uploading",
    quarterTurns: data.readUInt8(11),
    shardCount,
    uploadedBitmap,
    owner: new PublicKey(data.subarray(16, 48)).toBase58(),
    globalConfig: new PublicKey(data.subarray(48, 80)).toBase58(),
    foundationId,
    revision,
    payloadLen,
    expectedHash: data.subarray(96, 128),
    sizeX,
    sizeY,
    sizeZ,
    createdSlot: data.readBigUInt64LE(136).toString(),
    updatedSlot: data.readBigUInt64LE(144).toString(),
    offsetX: data.readInt32LE(152),
    offsetZ: data.readInt32LE(156),
  };
}

export function decodeBuildingShard(input, address = "", { allowIncomplete = false } = {}) {
  const data = Buffer.from(input ?? []);
  if (data.length < buildingShardHeaderLength
    || data.subarray(0, 8).toString("utf8") !== buildingShardMagic
    || data.readUInt8(8) !== buildingShardVersion) {
    throw new Error("Invalid BuildingShard account data.");
  }
  const payloadLen = data.readUInt16LE(12);
  const uploadedLen = data.readUInt16LE(14);
  if (!payloadLen || payloadLen > buildingShardPayloadLength
    || uploadedLen > payloadLen
    || !allowIncomplete && uploadedLen !== payloadLen
    || data.length !== buildingShardHeaderLength + payloadLen) {
    throw new Error("Incomplete BuildingShard account data.");
  }
  return {
    address,
    shardIndex: data.readUInt8(10),
    payloadLen,
    uploadedLen,
    globalConfig: new PublicKey(data.subarray(16, 48)).toBase58(),
    foundationId: data.readBigUInt64LE(48).toString(),
    revision: data.readUInt32LE(56),
    payload: data.subarray(buildingShardHeaderLength, buildingShardHeaderLength + uploadedLen),
  };
}

export async function loadBuildSitesByIds(foundationIds, conn = getNicechunkConnection()) {
  const ids = [...new Set((foundationIds ?? []).map((value) => BigInt(value).toString()))];
  if (!ids.length) return [];
  const addresses = ids.flatMap((id) => [
    deriveBuildSitePdaForProgram(id, gameContext.buildingProgramId)[0],
    deriveBuildSitePdaForProgram(id, gameContext.chunkProgramId)[0],
  ]);
  const infos = await getMultipleAccountsInfoBatched(conn, addresses, 100);
  const foundations = [];
  for (let index = 0; index < ids.length; index += 1) {
    const newAddress = addresses[index * 2];
    const legacyAddress = addresses[index * 2 + 1];
    const current = infos[index * 2];
    const legacy = infos[index * 2 + 1];
    const account = current?.data?.length ? current : legacy;
    const address = current?.data?.length ? newAddress : legacyAddress;
    const expectedProgram = current?.data?.length ? gameContext.buildingProgramId : gameContext.chunkProgramId;
    if (!account?.data?.length) continue;
    if (!account.owner?.equals?.(expectedProgram)) throw new Error("Invalid BuildSite owner.");
    const foundation = {
      ...decodeBuildSite(account.data, address.toBase58()),
      programId: expectedProgram.toBase58(),
      legacy: expectedProgram.equals(gameContext.chunkProgramId),
    };
    if (current?.data?.length && legacy?.data?.length && !foundation.hasActiveGeometry) {
      foundation.hasActiveGeometry = true;
      foundation.migrationSourcePda = legacyAddress.toBase58();
    }
    if (foundation.foundationId !== ids[index]) throw new Error("BuildSite PDA identifier mismatch.");
    foundations.push(foundation);
  }
  return foundations;
}

async function loadAuthoritativeMiningBackpack(owner, conn, options = {}) {
  const suppliedAddress = String(options?.backpackAddress || "").trim();
  if (suppliedAddress) {
    return loadBackpackAccountForOwner(suppliedAddress, owner, conn).catch(() => null);
  }
  return loadEquippedBackpackForOwner(owner, conn);
}

function availableBackpackSlots(backpack) {
  const itemCount = Number(backpack?.itemCount);
  const capacity = Number(backpack?.capacity);
  if (!Number.isInteger(itemCount) || !Number.isInteger(capacity) || itemCount < 0 || capacity < itemCount) return 0;
  return Math.max(0, capacity - itemCount);
}

function miningBackpackSnapshot(backpack) {
  return {
    backpackPreviousItemCount: Math.max(0, Math.trunc(Number(backpack?.itemCount) || 0)),
    backpackPreviousCapacity: Math.max(0, Math.trunc(Number(backpack?.capacity) || 0)),
    backpackPreviousUpdatedSlot: String(backpack?.updatedSlot ?? "0"),
  };
}

async function storedBackpackRewardsSince(backpack, previousItemCount) {
  if (!backpack || !Array.isArray(backpack.slots)) return [];
  const start = Math.max(0, Math.min(
    backpack.slots.length,
    Math.trunc(Number(previousItemCount) || 0),
  ));
  const end = Math.max(start, Math.min(
    backpack.slots.length,
    Math.trunc(Number(backpack.itemCount) || 0),
  ));
  if (end <= start) return [];
  let resourceIdForBlock = () => 0;
  try {
    ({ resourceIdForBlock } = await import("../world/blocks.js"));
  } catch {
    // The block id remains authoritative if the optional display mapping is unavailable.
  }
  return backpack.slots.slice(start, end)
    .filter((slot) => slot?.kind === "block" && Number(slot?.resource?.blockId) > 0)
    .map((slot) => ({
      worldX: Math.trunc(Number(slot.resource.worldX) || 0),
      worldY: Math.trunc(Number(slot.resource.worldY) || 0),
      worldZ: Math.trunc(Number(slot.resource.worldZ) || 0),
      blockId: Math.trunc(Number(slot.resource.blockId) || 0),
      resourceId: Math.trunc(Number(resourceIdForBlock(slot.resource.blockId)) || 0),
      metadata: Math.max(0, Math.trunc(Number(slot.metadata) || 0)),
      count: 1,
    }));
}

export async function createFoundationOnChain(input = {}) {
  if (!isNicechunkChainSyncEnabled()) return { submitted: false, reason: "chain-sync-disabled" };
  try {
    const provider = await connectedWalletProvider();
    if (!provider) return { submitted: false, reason: "wallet-unavailable" };
    const foundation = normalizeFoundationInput(input);
    const foundationId = requireBlueprintFoundationId(input?.blueprintId ?? input?.foundationId);
    const context = gameContext;
    const conn = getNicechunkConnection();
    const session = await getOrCreateGameplaySession(provider);
    const signatures = [];
    let current = (await loadBuildSitesByIds([foundationId], conn))[0] ?? null;
    const alreadyExists = Boolean(current);
    if (current && current.owner !== provider.publicKey.toBase58()) {
      return {
        submitted: false,
        reason: "blueprint-foundation-owner-mismatch",
        foundation: current,
      };
    }
    if (current && !foundationGeometryMatches(current, foundation)) {
      return {
        submitted: false,
        reason: "foundation-already-bound",
        foundation: current,
      };
    }
    if (!current) {
      const transaction = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }),
        createBuildSiteInstruction({
          authority: session.keypair.publicKey,
          owner: provider.publicKey,
          foundationId,
          foundation,
          context,
        }),
      );
      try {
        signatures.push(await signAndSendKeypairTransaction(session.keypair, transaction, conn));
      } catch (submissionError) {
        current = (await loadBuildSitesByIds([foundationId], conn).catch(() => []))[0] ?? null;
        if (!current) throw submissionError;
      }
      current = current ?? await loadCurrentBuildSite(conn, foundationId, context);
    } else if (current.legacy) {
      signatures.push(await migrateLegacyBuildSite({
        conn,
        context,
        provider,
        session,
        foundationId,
      }));
      current = await loadCurrentBuildSite(conn, foundationId, context);
    }
    current = await continueBuildSiteIndexing({ conn, context, provider, session, foundation: current, signatures });
    return {
      submitted: true,
      signature: signatures.at(-1) || "",
      signatures,
      alreadyExists,
      recovered: alreadyExists,
      programId: context.buildingProgramId.toBase58(),
      foundation: current,
    };
  } catch (error) {
    reportRpcError(error, "create-foundation");
    throw error;
  }
}

export async function resizeFoundationOnChain(input = {}) {
  if (!isNicechunkChainSyncEnabled()) return { submitted: false, reason: "chain-sync-disabled" };
  try {
    const provider = await connectedWalletProvider();
    if (!provider) return { submitted: false, reason: "wallet-unavailable" };
    const foundationId = requireBlueprintFoundationId(input?.blueprintId ?? input?.foundationId);
    const context = gameContext;
    const conn = getNicechunkConnection();
    const session = await getOrCreateGameplaySession(provider);
    const signatures = [];
    let current = (await loadBuildSitesByIds([foundationId], conn))[0] ?? null;
    if (!current) return { submitted: false, reason: "foundation-not-found" };
    if (current.owner !== provider.publicKey.toBase58()) {
      return { submitted: false, reason: "blueprint-foundation-owner-mismatch", foundation: current };
    }
    if (current.legacy) {
      signatures.push(await migrateLegacyBuildSite({ conn, context, provider, session, foundationId }));
      current = await loadCurrentBuildSite(conn, foundationId, context);
    }
    if (current.status === "indexing") {
      current = await continueBuildSiteIndexing({ conn, context, provider, session, foundation: current, signatures });
    }
    const desired = normalizeFoundationInput({
      ...current,
      width: input.width,
      depth: input.depth,
    });
    const resizingToDesired = current.status === "edit-indexing"
      && current.stagedWidth === desired.width
      && current.stagedDepth === desired.depth;
    const cleaningDesired = current.status === "edit-cleaning"
      && current.width === desired.width
      && current.depth === desired.depth;
    if (current.status !== "active" && !resizingToDesired && !cleaningDesired) {
      return { submitted: false, reason: "foundation-edit-in-progress", foundation: current };
    }
    if (current.status === "active" && (current.width !== desired.width || current.depth !== desired.depth)) {
      const transaction = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
        createResizeBuildSiteInstruction({
          authority: session.keypair.publicKey,
          owner: provider.publicKey,
          foundation: current,
          width: desired.width,
          depth: desired.depth,
          context,
        }),
      );
      signatures.push(await signAndSendKeypairTransaction(session.keypair, transaction, conn));
      current = await loadCurrentBuildSite(conn, foundationId, context);
    }
    current = await continueBuildSiteIndexing({ conn, context, provider, session, foundation: current, signatures });
    return {
      submitted: true,
      resized: true,
      signature: signatures.at(-1) || "",
      signatures,
      programId: context.buildingProgramId.toBase58(),
      foundation: current,
    };
  } catch (error) {
    reportRpcError(error, "resize-foundation");
    throw error;
  }
}

async function loadCurrentBuildSite(conn, foundationId, context = gameContext) {
  const [address] = deriveBuildSitePdaForContext(foundationId, context);
  const account = await conn.getAccountInfo(address, "confirmed");
  if (!account?.data?.length) throw new Error("BuildSite PDA is unavailable after confirmation.");
  if (!account.owner?.equals?.(context.buildingProgramId)) {
    throw new Error("BuildSite PDA has an invalid program owner.");
  }
  const foundation = {
    ...decodeBuildSite(account.data, address.toBase58()),
    programId: context.buildingProgramId.toBase58(),
    legacy: false,
  };
  if (foundation.foundationId !== foundationId.toString()) {
    throw new Error("BuildSite PDA identifier mismatch.");
  }
  return foundation;
}

async function migrateLegacyBuildSite({ conn, context, provider, session, foundationId }) {
  const transaction = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
    createMigrateLegacyBuildSiteInstruction({
      authority: session.keypair.publicKey,
      owner: provider.publicKey,
      foundationId,
      context,
    }),
  );
  return signAndSendKeypairTransaction(session.keypair, transaction, conn);
}

async function continueBuildSiteIndexing({ conn, context, provider, session, foundation, signatures = [] }) {
  let current = foundation;
  while (current?.status !== "active") {
    const batch = foundationIndexBatch(current, 4);
    if (!batch.length) throw new Error("BuildSite indexing cannot make progress.");
    const previousProgress = `${current.status}:${current.registeredChunks}:${current.totalChunks}`;
    const transaction = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      createRegisterBuildSiteChunksInstruction({
        authority: session.keypair.publicKey,
        owner: provider.publicKey,
        foundation: current,
        context,
      }),
    );
    signatures.push(await signAndSendKeypairTransaction(session.keypair, transaction, conn));
    current = await loadCurrentBuildSite(conn, current.foundationId, context);
    const nextProgress = `${current.status}:${current.registeredChunks}:${current.totalChunks}`;
    if (nextProgress === previousProgress) throw new Error("BuildSite indexing progress did not advance.");
  }
  return current;
}

function foundationGeometryMatches(left, right) {
  return left.minX === right.minX
    && left.minZ === right.minZ
    && left.surfaceY === right.surfaceY
    && left.width === right.width
    && left.depth === right.depth;
}

function normalizeFoundationInput(input) {
  const minX = Math.trunc(Number(input?.minX));
  const minZ = Math.trunc(Number(input?.minZ));
  const surfaceY = Math.trunc(Number(input?.surfaceY));
  const width = Math.trunc(Number(input?.width));
  const depth = Math.trunc(Number(input?.depth));
  if (![minX, minZ, surfaceY, width, depth].every(Number.isInteger)
    || width < foundationMinSize || width > 0xffffffff
    || depth < foundationMinSize || depth > 0xffffffff
    || surfaceY <= canonicalChunkWorldConfig.minBuildY || surfaceY > canonicalChunkWorldConfig.maxBuildY
    || minX + width - 1 > 0x7fffffff || minX + width - 1 < -0x80000000
    || minZ + depth - 1 > 0x7fffffff || minZ + depth - 1 < -0x80000000) {
    throw new Error("Invalid foundation rectangle.");
  }
  return { minX, minZ, surfaceY, width, depth };
}

function requireBlueprintFoundationId(value) {
  let foundationId;
  try {
    foundationId = BigInt(value ?? 0);
  } catch {
    throw new Error("A valid blueprint ID is required to create a foundation.");
  }
  if (foundationId <= 0n || foundationId > 0xffffffffffffffffn) {
    throw new Error("A valid blueprint ID is required to create a foundation.");
  }
  return foundationId;
}

export async function createBuildingOnChain(input = {}) {
  if (!isNicechunkChainSyncEnabled()) return { submitted: false, reason: "chain-sync-disabled" };
  try {
    const provider = await connectedWalletProvider();
    if (!provider) return { submitted: false, reason: "wallet-unavailable" };
    const foundationId = BigInt(input?.foundationId);
    const quarterTurns = ((Math.trunc(Number(input?.quarterTurns) || 0) % 4) + 4) % 4;
    const offsetX = normalizeBuildingOffset(input?.offsetX);
    const offsetZ = normalizeBuildingOffset(input?.offsetZ);
    const code = String(input?.code || "").trim();
    const payload = decodeNcm3Payload(code);
    if (!payload.length || payload.length > buildingMaxPayloadLength) {
      throw new Error(`NCM3 payload must contain 1-${buildingMaxPayloadLength} bytes.`);
    }
    const conn = getNicechunkConnection();
    const context = gameContext;
    const session = await getOrCreateGameplaySession(provider);
    let foundation = (await loadBuildSitesByIds([foundationId], conn))[0] ?? null;
    if (!foundation) {
      return { submitted: false, reason: "foundation-not-found" };
    }
    if (foundation.owner !== provider.publicKey.toBase58()) {
      return { submitted: false, reason: "foundation-owner-mismatch" };
    }
    if (foundation.legacy) {
      await migrateLegacyBuildSite({ conn, context, provider, session, foundationId });
      foundation = await loadCurrentBuildSite(conn, foundationId, context);
    }
    if (foundation.status !== "active") {
      foundation = await continueBuildSiteIndexing({ conn, context, provider, session, foundation });
    }
    const expectedHash = await sha256Buffer(payload);
    const shardCount = buildingShardCount(payload.length);
    let revision = foundation.pendingRevision
      ? normalizeBuildingRevision(foundation.pendingRevision)
      : normalizeBuildingRevision(foundation.activeRevision + 1);
    let uploadShards = null;
    let resumed = false;

    if (foundation.pendingRevision) {
      const pending = await loadBuildingUploadState({
        conn,
        foundation,
        revision,
        payload,
        expectedHash,
        quarterTurns,
        offsetX,
        offsetZ,
        context,
      });
      if (pending.matches) {
        uploadShards = pending.shards;
        resumed = true;
      } else {
        await fundBuildingUploadSession(provider, session.keypair.publicKey, [], conn);
        const cancel = new Transaction();
        cancel.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }));
        cancel.add(createCancelBuildingUploadInstruction({
          authority: session.keypair.publicKey,
          owner: provider.publicKey,
          foundationId,
          revision,
          shardCount: pending.manifest.shardCount,
          context,
        }));
        await signAndSendKeypairTransaction(session.keypair, cancel, conn);
        revision = normalizeBuildingRevision(foundation.activeRevision + 1);
      }
    }

    if (!resumed && foundation.activeRevision) {
      const active = await loadBuildingManifestForRevision(
        conn,
        foundation,
        foundation.activeRevision,
        context,
      );
      if (buildingManifestMatchesPayload(active, {
        payload,
        expectedHash,
        quarterTurns,
        offsetX,
        offsetZ,
      })) {
        return finalizedBuildingResult({
          foundation,
          manifest: active,
          code,
          expectedHash,
          offsetX,
          offsetZ,
          context,
          alreadyActive: true,
        });
      }
    }

    if (!resumed) {
      const accountLengths = buildingUploadMissingAccountLengths(payload.length, null);
      await fundBuildingUploadSession(provider, session.keypair.publicKey, accountLengths, conn);
      const begin = new Transaction();
      begin.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }));
      begin.add(createBeginBuildingInstruction({
        authority: session.keypair.publicKey,
        owner: provider.publicKey,
        foundationId,
        revision,
        quarterTurns,
        payloadLen: payload.length,
        expectedHash,
        offsetX,
        offsetZ,
        context,
      }));
      await signAndSendKeypairTransaction(session.keypair, begin, conn);
      uploadShards = Array.from({ length: shardCount }, () => null);
    } else {
      const accountLengths = buildingUploadMissingAccountLengths(payload.length, uploadShards);
      await fundBuildingUploadSession(provider, session.keypair.publicKey, accountLengths, conn);
    }

    for (let shardIndex = 0; shardIndex < shardCount; shardIndex += 1) {
      const shardStart = shardIndex * buildingShardPayloadLength;
      const shardPayload = payload.subarray(
        shardStart,
        Math.min(payload.length, shardStart + buildingShardPayloadLength),
      );
      const uploadedLen = Math.max(0, Math.trunc(Number(uploadShards?.[shardIndex]?.uploadedLen) || 0));
      for (const write of buildingUploadWritePlan(shardPayload.length, uploadedLen)) {
        const bytes = shardPayload.subarray(write.offset, write.end);
        const transaction = new Transaction();
        transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }));
        transaction.add(createWriteBuildingShardInstruction({
          authority: session.keypair.publicKey,
          owner: provider.publicKey,
          foundationId,
          revision,
          shardIndex,
          offset: write.offset,
          bytes,
          context,
        }));
        await signAndSendKeypairTransaction(session.keypair, transaction, conn);
      }
    }

    const finalize = new Transaction();
    finalize.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_300_000 }));
    finalize.add(createFinalizeBuildingInstruction({
      authority: session.keypair.publicKey,
      owner: provider.publicKey,
      foundationId,
      revision,
      shardCount,
      context,
    }));
    const signature = await signAndSendKeypairTransaction(session.keypair, finalize, conn);
    return finalizedBuildingResult({
      foundation,
      manifest: { revision, quarterTurns, offsetX, offsetZ },
      code,
      expectedHash,
      context,
      signature,
      resumed,
    });
  } catch (error) {
    reportRpcError(error, "create-building");
    throw error;
  }
}

async function loadBuildingUploadState({
  conn,
  foundation,
  revision,
  payload,
  expectedHash,
  quarterTurns,
  offsetX,
  offsetZ,
  context,
}) {
  const programId = buildingProgramForFoundation(foundation, context);
  const manifest = await loadBuildingManifestForRevision(conn, foundation, revision, context);
  if (!manifest || manifest.status !== "uploading") {
    throw new Error("Pending BuildingManifest is unavailable or already finalized.");
  }
  if (!buildingUploadManifestMatchesPayload(manifest, {
    payload,
    expectedHash,
    quarterTurns,
    offsetX,
    offsetZ,
  })) {
    return { manifest, shards: [], matches: false };
  }
  const addresses = Array.from({ length: manifest.shardCount }, (_unused, shardIndex) => (
    deriveBuildingShardPdaForProgram(foundation.foundationId, revision, shardIndex, programId)[0]
  ));
  const infos = await getMultipleAccountsInfoBatched(conn, addresses, 100);
  const shards = [];
  let matches = true;
  for (let shardIndex = 0; shardIndex < addresses.length; shardIndex += 1) {
    const account = infos[shardIndex];
    const expectedPayload = payload.subarray(
      shardIndex * buildingShardPayloadLength,
      Math.min(payload.length, (shardIndex + 1) * buildingShardPayloadLength),
    );
    if (!account?.data?.length) {
      shards[shardIndex] = null;
      if (manifest.uploadedBitmap & (1 << shardIndex)) matches = false;
      continue;
    }
    if (!account.owner?.equals?.(programId)) {
      throw new Error(`Pending building shard ${shardIndex} has an invalid owner.`);
    }
    const shard = decodeBuildingShard(account.data, addresses[shardIndex].toBase58(), { allowIncomplete: true });
    if (shard.globalConfig !== deriveGlobalConfigPda().toBase58()
      || shard.foundationId !== String(foundation.foundationId)
      || shard.revision !== revision
      || shard.shardIndex !== shardIndex
      || shard.payloadLen !== expectedPayload.length
      || !Buffer.from(shard.payload).equals(expectedPayload.subarray(0, shard.uploadedLen))) {
      matches = false;
    }
    const complete = shard.uploadedLen === shard.payloadLen;
    if (Boolean(manifest.uploadedBitmap & (1 << shardIndex)) !== complete) matches = false;
    shards[shardIndex] = shard;
  }
  return { manifest, shards, matches };
}

async function loadBuildingManifestForRevision(conn, foundation, revision, context) {
  const programId = buildingProgramForFoundation(foundation, context);
  const [address] = deriveBuildingManifestPdaForProgram(foundation.foundationId, revision, programId);
  const account = await conn.getAccountInfo(address, "confirmed");
  if (!account?.data?.length) return null;
  if (!account.owner?.equals?.(programId)) {
    throw new Error("BuildingManifest has an invalid owner.");
  }
  const manifest = decodeBuildingManifest(account.data, address.toBase58());
  if (manifest.owner !== foundation.owner
    || manifest.globalConfig !== deriveGlobalConfigPda().toBase58()
    || manifest.foundationId !== String(foundation.foundationId)
    || manifest.revision !== revision) {
    throw new Error("BuildingManifest does not match its BuildSite.");
  }
  return manifest;
}

function buildingUploadManifestMatchesPayload(manifest, {
  payload,
  expectedHash,
  quarterTurns,
  offsetX,
  offsetZ,
}) {
  return Boolean(manifest)
    && manifest.payloadLen === payload.length
    && manifest.quarterTurns === quarterTurns
    && manifest.offsetX === offsetX
    && manifest.offsetZ === offsetZ
    && Buffer.from(manifest.expectedHash).equals(expectedHash);
}

function buildingManifestMatchesPayload(manifest, desired) {
  return manifest?.status === "active" && buildingUploadManifestMatchesPayload(manifest, desired);
}

function buildingUploadMissingAccountLengths(payloadLen, shards) {
  const shardCount = buildingShardCount(payloadLen);
  const lengths = shards ? [] : [buildingManifestLength];
  for (let shardIndex = 0; shardIndex < shardCount; shardIndex += 1) {
    if (shards?.[shardIndex]) continue;
    lengths.push(buildingShardHeaderLength + Math.min(
      buildingShardPayloadLength,
      payloadLen - shardIndex * buildingShardPayloadLength,
    ));
  }
  return lengths;
}

export function buildingUploadWritePlan(payloadLength, uploadedLength = 0) {
  const payload = Math.trunc(Number(payloadLength));
  const uploaded = Math.trunc(Number(uploadedLength));
  if (!Number.isInteger(payload) || payload <= 0 || payload > buildingShardPayloadLength
    || !Number.isInteger(uploaded) || uploaded < 0 || uploaded > payload) {
    throw new Error("Invalid building upload progress.");
  }
  const writes = [];
  for (let offset = uploaded; offset < payload; offset += BUILDING_MAX_WRITE_LENGTH) {
    writes.push({ offset, end: Math.min(payload, offset + BUILDING_MAX_WRITE_LENGTH) });
  }
  return writes;
}

function finalizedBuildingResult({
  foundation,
  manifest,
  code,
  expectedHash,
  context,
  signature = "",
  resumed = false,
  alreadyActive = false,
}) {
  const revision = normalizeBuildingRevision(manifest.revision);
  const manifestPda = manifest.address || deriveBuildingManifestPdaForContext(
    foundation.foundationId,
    revision,
    context,
  )[0].toBase58();
  return {
    submitted: true,
    signature,
    resumed,
    alreadyActive,
    programId: context.buildingProgramId.toBase58(),
    building: {
      id: `${foundation.id}:building:${revision}`,
      owner: foundation.owner,
      foundationId: foundation.foundationId,
      foundation: foundation.id,
      revision,
      quarterTurns: manifest.quarterTurns,
      offsetX: manifest.offsetX,
      offsetZ: manifest.offsetZ,
      code,
      contentHash: expectedHash.toString("hex"),
      payloadBytes: decodeNcm3Payload(code).length,
      manifestPda,
      signature,
    },
  };
}

export async function recordBlockBreakOnChain(block, toolSlot = 0, options = {}) {
  if (!isNicechunkChainSyncEnabled()) {
    return { submitted: false, reason: "chain-sync-disabled" };
  }
  try {
    const provider = await connectedWalletProvider();
    if (!provider) return { submitted: false, reason: "wallet-unavailable" };

    const canonicalBlock = await resolveCanonicalMinedBlock(block);
    if (!isCanonicalMineableBlockId(canonicalBlock.blockId)) {
      return { submitted: false, reason: "unmineable-block", blockId: canonicalBlock.blockId };
    }

    const conn = getNicechunkConnection();
    const [alreadyBroken, equippedBackpack] = await Promise.all([
      isBlockAlreadyBrokenOnChain(block),
      loadAuthoritativeMiningBackpack(provider.publicKey, conn, options),
    ]);
    if (alreadyBroken) return { submitted: false, reason: "already-mined" };
    if (!equippedBackpack?.publicKey) {
      return { submitted: false, reason: "no-backpack" };
    }
    const context = gameContext;
    if (availableBackpackSlots(equippedBackpack) < 1) {
      return { submitted: false, reason: "backpack-full" };
    }
    const backpackBefore = miningBackpackSnapshot(equippedBackpack);
    const session = await getOrCreateGameplaySession(provider);
    const tx = new Transaction();
    const solSpend = createSolSpendSummary();
    const initSignature = await ensureMiningAccountsInitialized(conn, session.keypair, blockChunkX(canonicalBlock.x), blockChunkZ(canonicalBlock.z), context);
    await addTransactionSolSpend(solSpend, conn, initSignature, session.keypair.publicKey);
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: miningComputeUnitLimit }));
    tx.add(createMineBlockWithRewardsInstruction({
      authority: session.keypair.publicKey,
      block,
      owner: provider.publicKey,
      backpack: equippedBackpack.publicKey,
      expectedBlockId: canonicalBlock.blockId,
      context,
    }));
    const playerPositionSaved = maybeAddPlayerPositionUpdateInstruction(tx, {
      provider,
      session,
      position: playerPositionForResourceMine(canonicalBlock, options),
    });
    tx.add(createSyncPlayerSkillsInstruction({
      payer: session.keypair.publicKey,
      owner: provider.publicKey,
      sourceAccounts: [
        derivePlayerProgressPdaForContext(provider.publicKey, context)[0],
        derivePlayerProfilePda(provider.publicKey)[0],
        equippedBackpack.publicKey,
      ],
      miningCoordinate: canonicalBlock,
    }));

    const signature = await signAndSendKeypairTransaction(session.keypair, tx, conn);
    await addTransactionSolSpend(solSpend, conn, signature, session.keypair.publicKey);
    invalidateChunkDeltaCache(blockChunkX(canonicalBlock.x), blockChunkZ(canonicalBlock.z));
    return {
      submitted: true,
      signature,
      ...solSpendResult(solSpend),
      ...backpackBefore,
      backpack: equippedBackpack?.publicKey?.toBase58?.() ?? null,
      block: canonicalBlock,
      blockId: canonicalBlock.blockId,
      type: canonicalBlock.type,
      playerPositionSaved,
      programId: context.chunkProgramId.toBase58(),
    };
  } catch (error) {
    reportRpcError(error, "mine-block");
    throw error;
  }
}

export async function recordTreeFellOnChain(block, toolSlot = 0, options = {}) {
  if (!isNicechunkChainSyncEnabled()) {
    return { submitted: false, reason: "chain-sync-disabled" };
  }
  try {
    const provider = await connectedWalletProvider();
    if (!provider) return { submitted: false, reason: "wallet-unavailable" };

    const canonicalBlock = await resolveCanonicalMinedBlock(block);
    if (!isTreeTrunkBlockId(canonicalBlock.blockId)) {
      return { submitted: false, reason: "not-tree-trunk", blockId: canonicalBlock.blockId };
    }

    const conn = getNicechunkConnection();
    const [alreadyBroken, equippedBackpack] = await Promise.all([
      isBlockAlreadyBrokenOnChain(block),
      loadAuthoritativeMiningBackpack(provider.publicKey, conn, options),
    ]);
    if (alreadyBroken) return { submitted: false, reason: "already-mined" };
    if (!equippedBackpack?.publicKey) {
      return { submitted: false, reason: "no-backpack" };
    }
    const backpackBefore = miningBackpackSnapshot(equippedBackpack);
    const session = await getOrCreateGameplaySession(provider);
    const tx = new Transaction();
    const context = gameContext;
    const solSpend = createSolSpendSummary();

    const chunks = treeFellCandidateChunks(canonicalBlock);
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: miningComputeUnitLimit }));
    tx.add(createFellTreeWithRewardsInstruction({
      authority: session.keypair.publicKey,
      block: canonicalBlock,
      owner: provider.publicKey,
      backpack: equippedBackpack.publicKey,
      expectedBlockId: canonicalBlock.blockId,
      chunks,
      context,
    }));
    const playerPositionSaved = maybeAddPlayerPositionUpdateInstruction(tx, {
      provider,
      session,
      position: playerPositionForResourceMine(canonicalBlock, options),
    });
    tx.add(createSyncPlayerSkillsInstruction({
      payer: session.keypair.publicKey,
      owner: provider.publicKey,
      sourceAccounts: [
        derivePlayerProgressPdaForContext(provider.publicKey, context)[0],
        derivePlayerProfilePda(provider.publicKey)[0],
        equippedBackpack.publicKey,
      ],
      miningCoordinate: canonicalBlock,
    }));

    const signature = await signAndSendKeypairTransaction(session.keypair, tx, conn);
    await addTransactionSolSpend(solSpend, conn, signature, session.keypair.publicKey);
    chunks.forEach((chunk) => invalidateChunkDeltaCache(chunk.chunkX, chunk.chunkZ));
    const backpackAfter = await loadBackpackAccountForOwner(
      equippedBackpack.publicKey.toBase58(),
      provider.publicKey,
      conn,
    ).catch(() => null);
    const storedRewards = await storedBackpackRewardsSince(
      backpackAfter,
      backpackBefore.backpackPreviousItemCount,
    );
    return {
      submitted: true,
      signature,
      ...solSpendResult(solSpend),
      ...backpackBefore,
      playerPositionSaved,
      backpack: equippedBackpack?.publicKey?.toBase58?.() ?? null,
      storedRewardCount: storedRewards.length,
      storedRewards,
      lossyRewards: true,
      block: canonicalBlock,
      blockId: canonicalBlock.blockId,
      type: canonicalBlock.type,
      chunks,
      programId: context.chunkProgramId.toBase58(),
    };
  } catch (error) {
    reportRpcError(error, "fell-tree");
    throw error;
  }
}

export async function recordBulkMineOnChain(blocks, options = {}) {
  if (!isNicechunkChainSyncEnabled()) {
    return { submitted: false, reason: "chain-sync-disabled" };
  }
  if (options?.mode !== "debug") {
    return { submitted: false, reason: "bulk-mining-authorization-required" };
  }
  try {
    const provider = await connectedWalletProvider();
    if (!provider) return { submitted: false, reason: "wallet-unavailable" };

    const candidates = [];
    const seen = new Set();
    for (const block of Array.isArray(blocks) ? blocks : []) {
      const key = minedBlockKey(block);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push(block);
      if (candidates.length >= BULK_MINING_MAX_SELECTION_BLOCKS) break;
    }
    if (!candidates.length) return { submitted: false, reason: "bulk-mining-empty" };

    const canonicalBlocks = await Promise.all(candidates.map((block) => resolveCanonicalMinedBlock(block)));
    if (canonicalBlocks.some((block) => !isCanonicalMineableBlockId(block.blockId))) {
      return { submitted: false, reason: "bulk-mining-unmineable-block" };
    }
    const ranges = partitionBulkMiningRanges(canonicalBlocks, {
      chunkSize,
    });
    if (!ranges.length) return { submitted: false, reason: "bulk-mining-empty" };

    const conn = getNicechunkConnection();
    const equippedBackpack = await loadAuthoritativeMiningBackpack(provider.publicKey, conn, options);
    if (!equippedBackpack?.publicKey) return { submitted: false, reason: "no-backpack" };

    const context = gameContext;
    const session = await getOrCreateGameplaySession(provider);
    const solSpend = createSolSpendSummary();
    const backpackBefore = miningBackpackSnapshot(equippedBackpack);
    const outcome = await submitBulkMiningRanges(ranges, async (range) => {
      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: miningComputeUnitLimit }));
      tx.add(createRangeMineWithRewardsInstruction({
        authority: session.keypair.publicKey,
        range,
        owner: provider.publicKey,
        backpack: equippedBackpack.publicKey,
        mode: BULK_MINING_RANGE_MODE_DEBUG,
        context,
      }));
      const signature = await signAndSendKeypairTransaction(session.keypair, tx, conn);
      await addTransactionSolSpend(solSpend, conn, signature, session.keypair.publicKey);
      return { signature };
    });

    const confirmedBlocks = outcome.confirmed.map((entry) => entry.block);
    const firstFailure = outcome.failures[0] ?? outcome.aborted[0] ?? outcome.retryErrors[0];
    if (!confirmedBlocks.length) {
      if (firstFailure?.error) throw firstFailure.error;
      return { submitted: false, reason: "bulk-mining-not-confirmed" };
    }
    let skillsSignature = "";
    try {
      skillsSignature = await syncPlayerSkillsWithKeypair({
        payer: session.keypair,
        owner: provider.publicKey,
        sourceAccounts: [
          derivePlayerProgressPdaForContext(provider.publicKey, context)[0],
          derivePlayerProfilePda(provider.publicKey)[0],
          equippedBackpack.publicKey,
        ],
        conn,
      });
      await addTransactionSolSpend(solSpend, conn, skillsSignature, session.keypair.publicKey);
    } catch (error) {
      reportRpcError(error, "bulk-mine-skills");
    }
    const failedBulkBlocks = [...outcome.failures, ...outcome.aborted].map(supportCollapseFailureRecord);
    const signatures = outcome.confirmed
      .map((entry) => entry.result?.signature)
      .filter((signature, index, list) => signature && list.indexOf(signature) === index);
    const confirmedChunks = dedupeChunks(confirmedBlocks.map((block) => ({
      chunkX: blockChunkX(block.x),
      chunkZ: blockChunkZ(block.z),
    })));
    confirmedChunks.forEach((chunk) => invalidateChunkDeltaCache(chunk.chunkX, chunk.chunkZ));

    const backpackAfter = await loadBackpackAccountForOwner(
      equippedBackpack.publicKey.toBase58(),
      provider.publicKey,
      conn,
    ).catch(() => null);
    const storedRewards = await storedBackpackRewardsSince(
      backpackAfter,
      backpackBefore.backpackPreviousItemCount,
    );
    return {
      submitted: true,
      signature: signatures.at(-1) ?? "",
      signatures,
      skillsSignature,
      ...solSpendResult(solSpend),
      ...backpackBefore,
      backpack: equippedBackpack.publicKey.toBase58(),
      confirmedBlocks,
      rewardBlocks: [],
      storedRewardCount: storedRewards.length,
      storedRewards,
      lossyRewards: true,
      failedBulkBlocks,
      partialBulkMine: failedBulkBlocks.length > 0,
      retriedBatchCount: outcome.retryErrors.length,
      batchCount: ranges.length,
      playerPositionSaved: false,
      programId: context.chunkProgramId.toBase58(),
    };
  } catch (error) {
    reportRpcError(error, "bulk-mine");
    throw error;
  }
}

export async function recordSupportCollapseOnChain(block, options = {}) {
  if (!isNicechunkChainSyncEnabled()) {
    return { submitted: false, reason: "chain-sync-disabled" };
  }
  try {
    const provider = await connectedWalletProvider();
    if (!provider) return { submitted: false, reason: "wallet-unavailable" };

    const canonicalBlock = await resolveCanonicalMinedBlock(block);
    if (!isCanonicalMineableBlockId(canonicalBlock.blockId)) {
      return { submitted: false, reason: "unmineable-block", blockId: canonicalBlock.blockId };
    }
    const conn = getNicechunkConnection();
    const [alreadyBroken, equippedBackpack] = await Promise.all([
      isBlockAlreadyBrokenOnChain(block),
      loadAuthoritativeMiningBackpack(provider.publicKey, conn, options),
    ]);
    if (alreadyBroken) return { submitted: false, reason: "already-mined" };
    if (!equippedBackpack?.publicKey) return { submitted: false, reason: "no-backpack" };
    const availableSlots = availableBackpackSlots(equippedBackpack);
    if (availableSlots < 1) {
      return { submitted: false, reason: "backpack-full" };
    }

    const context = gameContext;
    const session = await getOrCreateGameplaySession(provider);
    const solSpend = createSolSpendSummary();
    const backpackBefore = miningBackpackSnapshot(equippedBackpack);
    const primaryKey = minedBlockKey(canonicalBlock);
    const collapseBlocks = await resolveCanonicalCollapseBlocks(options.collapseBlocks, primaryKey);
    const rewardKeySet = new Set((options.rewardBlocks ?? []).map((rewardBlock) => minedBlockKey(rewardBlock)));
    // A reward instruction can append the block plus up to two lossy secondary
    // drops. Reserve one base slot for the clicked block across the sequence.
    const availableRewardSlots = Math.max(0, Math.floor((availableSlots - 1) / 3));
    const rewardBlocks = collapseBlocks
      .filter((collapseBlock) => rewardKeySet.has(minedBlockKey(collapseBlock)))
      .slice(0, availableRewardSlots);
    const selectedRewardKeySet = new Set(rewardBlocks.map((rewardBlock) => minedBlockKey(rewardBlock)));

    const chunks = dedupeChunks([
      { chunkX: blockChunkX(canonicalBlock.x), chunkZ: blockChunkZ(canonicalBlock.z) },
      ...collapseBlocks.map((collapseBlock) => ({
        chunkX: blockChunkX(collapseBlock.x),
        chunkZ: blockChunkZ(collapseBlock.z),
      })),
    ]);
    for (const chunk of chunks) {
      const initSignature = await ensureMiningAccountsInitialized(conn, session.keypair, chunk.chunkX, chunk.chunkZ, context);
      await addTransactionSolSpend(solSpend, conn, initSignature, session.keypair.publicKey);
    }

    // A canonical terrain verification currently costs roughly 560k-625k CU.
    // Commit the clicked block first, then collapse blocks in pairs so no
    // transaction can contain the three verifications that exceed 1.4M CU.
    const primaryTx = new Transaction();
    primaryTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: miningComputeUnitLimit }));
    primaryTx.add(createMineBlockWithRewardsInstruction({
      authority: session.keypair.publicKey,
      block: canonicalBlock,
      owner: provider.publicKey,
      backpack: equippedBackpack.publicKey,
      expectedBlockId: canonicalBlock.blockId,
      context,
    }));
    const playerPositionSaved = maybeAddPlayerPositionUpdateInstruction(primaryTx, {
      provider,
      session,
      position: playerPositionForResourceMine(canonicalBlock, options),
    });
    primaryTx.add(createSyncPlayerSkillsInstruction({
      payer: session.keypair.publicKey,
      owner: provider.publicKey,
      sourceAccounts: [
        derivePlayerProgressPdaForContext(provider.publicKey, context)[0],
        derivePlayerProfilePda(provider.publicKey)[0],
        equippedBackpack.publicKey,
      ],
      miningCoordinate: canonicalBlock,
    }));
    const primarySignature = await signAndSendKeypairTransaction(session.keypair, primaryTx, conn);
    await addTransactionSolSpend(solSpend, conn, primarySignature, session.keypair.publicKey);

    const collapseOutcome = await submitSupportCollapseBatches(collapseBlocks, async (batch) => {
      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: miningComputeUnitLimit }));
      for (const collapseBlock of batch) {
        const mineWithReward = selectedRewardKeySet.has(minedBlockKey(collapseBlock));
        tx.add(mineWithReward
          ? createMineBlockWithRewardsInstruction({
              authority: session.keypair.publicKey,
              block: collapseBlock,
              owner: provider.publicKey,
              backpack: equippedBackpack.publicKey,
              expectedBlockId: collapseBlock.blockId,
              context,
            })
          : createMineBlockInstruction({
              authority: session.keypair.publicKey,
              block: collapseBlock,
              owner: provider.publicKey,
              expectedBlockId: collapseBlock.blockId,
              context,
            }));
      }
      const signature = await signAndSendKeypairTransaction(session.keypair, tx, conn);
      await addTransactionSolSpend(solSpend, conn, signature, session.keypair.publicKey);
      return { signature };
    });
    const confirmedCollapseBlocks = collapseOutcome.confirmed.map((entry) => entry.block);
    const confirmedCollapseKeys = new Set(confirmedCollapseBlocks.map(minedBlockKey));
    const confirmedRewardBlocks = rewardBlocks.filter((rewardBlock) => confirmedCollapseKeys.has(minedBlockKey(rewardBlock)));
    const failedCollapseBlocks = [...collapseOutcome.failures, ...collapseOutcome.aborted]
      .map(supportCollapseFailureRecord);
    const signatures = [
      primarySignature,
      ...collapseOutcome.confirmed.map((entry) => entry.result?.signature),
    ].filter((signature, index, list) => signature && list.indexOf(signature) === index);
    chunks.forEach((chunk) => invalidateChunkDeltaCache(chunk.chunkX, chunk.chunkZ));
    return {
      submitted: true,
      signature: signatures.at(-1) ?? primarySignature,
      signatures,
      ...solSpendResult(solSpend),
      ...backpackBefore,
      playerPositionSaved,
      backpack: equippedBackpack?.publicKey?.toBase58?.() ?? null,
      block: canonicalBlock,
      blockId: canonicalBlock.blockId,
      type: canonicalBlock.type,
      confirmedBlocks: [canonicalBlock, ...confirmedCollapseBlocks],
      collapseBlocks: confirmedCollapseBlocks,
      rewardBlocks: confirmedRewardBlocks,
      plannedCollapseBlockCount: collapseBlocks.length,
      failedCollapseBlocks,
      partialCollapse: failedCollapseBlocks.length > 0,
      retriedCollapseBatchCount: collapseOutcome.retryErrors.length,
      programId: context.chunkProgramId.toBase58(),
    };
  } catch (error) {
    reportRpcError(error, "support-collapse");
    throw error;
  }
}

async function ensureChunkBrokenInitialized(conn, sessionKeypair, chunkX, chunkZ, context = gameContext) {
  const key = chunkProgramCacheKey(context, chunkX, chunkZ);
  if (initializedChunkBrokenCache.has(key)) return null;
  const [chunkBrokenPda] = deriveChunkBrokenPdaForContext(chunkX, chunkZ, context);
  const account = await conn.getAccountInfo(chunkBrokenPda, "confirmed");
  if (account?.data?.length) {
    initializedChunkBrokenCache.add(key);
    return null;
  }
  const tx = new Transaction().add(createInitializeChunkBrokenInstruction({
    authority: sessionKeypair.publicKey,
    chunkX,
    chunkZ,
    context,
  }));
  const signature = await signAndSendKeypairTransaction(sessionKeypair, tx, conn);
  initializedChunkBrokenCache.add(key);
  invalidateChunkDeltaCache(chunkX, chunkZ);
  return signature;
}

async function ensureMiningAccountsInitialized(conn, sessionKeypair, chunkX, chunkZ, context = gameContext) {
  const key = chunkProgramCacheKey(context, chunkX, chunkZ);
  const needsChunkCheck = !initializedChunkBrokenCache.has(key);
  const needsDropCheck = !isResourceDropTableReady(context);
  const needsDecorationCheck = !isSurfaceDecorationTableReady(context);
  if (!needsChunkCheck && !needsDropCheck && !needsDecorationCheck) return null;

  const [chunkBrokenPda] = deriveChunkBrokenPdaForContext(chunkX, chunkZ, context);
  const [resourceDropTable] = deriveResourceDropTablePdaForContext(context);
  const [surfaceDecorationTable] = deriveSurfaceDecorationTablePdaForContext(context);
  const pubkeys = [];
  const labels = [];
  let chunkExists = !needsChunkCheck;
  let dropExists = !needsDropCheck;
  let decorationExists = !needsDecorationCheck;
  if (needsChunkCheck) {
    pubkeys.push(chunkBrokenPda);
    labels.push("chunk");
  }
  if (needsDropCheck) {
    pubkeys.push(resourceDropTable);
    labels.push("drops");
  }
  if (needsDecorationCheck) {
    pubkeys.push(surfaceDecorationTable);
    labels.push("decorations");
  }

  if (pubkeys.length) {
    const infos = await conn.getMultipleAccountsInfo(pubkeys, "confirmed");
    for (let index = 0; index < labels.length; index += 1) {
      if (labels[index] === "chunk") chunkExists = Boolean(infos[index]?.data?.length);
      if (labels[index] === "drops") dropExists = isProgramAccount(infos[index], context.chunkProgramId);
      if (labels[index] === "decorations") decorationExists = isProgramAccount(infos[index], context.chunkProgramId);
    }
  }

  if (chunkExists) initializedChunkBrokenCache.add(key);
  if (dropExists) markResourceDropTableReady(context);
  if (decorationExists) markSurfaceDecorationTableReady(context);
  if (!dropExists) throw new Error("mining-rule-table-uninitialized: resource drop PDA is missing or invalid");
  if (!decorationExists) throw new Error("mining-rule-table-uninitialized: surface decoration PDA is missing or invalid");
  if (chunkExists) return null;

  const tx = new Transaction().add(createInitializeChunkBrokenInstruction({
    authority: sessionKeypair.publicKey,
    chunkX,
    chunkZ,
    context,
  }));
  const signature = await signAndSendKeypairTransaction(sessionKeypair, tx, conn);
  initializedChunkBrokenCache.add(key);
  invalidateChunkDeltaCache(chunkX, chunkZ);
  return signature;
}

export async function purchaseDefaultBackpack() {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { purchased: false, reason: "wallet-unavailable" };
  const [playerProfile] = derivePlayerProfilePda(provider.publicKey);
  const conn = getNicechunkConnection();
  const playerAccount = await conn.getAccountInfo(playerProfile, "confirmed");
  if (playerAccount?.data?.length) {
    const profile = decodePlayerProfile(playerAccount.data);
    if (profile.equippedBackpack && profile.equippedBackpack !== PublicKey.default.toBase58()) {
      const equippedAccount = await conn.getAccountInfo(new PublicKey(profile.equippedBackpack), "confirmed").catch(() => null);
      if (equippedAccount?.owner?.equals(gameProgramId) && isCurrentBackpackAccountData(equippedAccount?.data)) {
        return {
          purchased: false,
          reason: "backpack-already-bound",
          backpack: profile.equippedBackpack,
        };
      }
    }
  }
  const backpackId = createBackpackId();
  const context = gameContext;
  const [backpack] = deriveBackpackPdaForContext(provider.publicKey, backpackId, context);
  const tx = new Transaction();
  if (!playerAccount?.data?.length) {
    tx.add(createInitializePlayerInstruction(provider.publicKey, playerProfile, ""));
  }
  tx.add(createInitializeBackpackInstruction({
    owner: provider.publicKey,
    playerProfile,
    backpack,
    backpackId,
    capacity: backpackDefaultCapacity,
    context,
  }));
  tx.add(createSetEquippedBackpackInstruction({
    authority: provider.publicKey,
    playerProfile,
    backpack,
  }));
  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  const record = {
    backpack: backpack.toBase58(),
    backpackId: backpackId.toString(),
    owner: provider.publicKey.toBase58(),
    equippedAt: Date.now(),
    programId: context.backpackProgramId.toBase58(),
  };
  storeEquippedBackpackRecord(provider.publicKey, record);
  return { purchased: true, signature, ...record };
}

export async function getEquippedBackpackStatus({ prompt = false } = {}) {
  const provider = await connectedWalletProvider({ prompt });
  const owner = provider?.publicKey ?? storedWalletPublicKey();
  if (!owner) return { walletAvailable: false, equipped: false, backpack: null };
  const equippedBackpack = await loadEquippedBackpackForOwner(owner);
  if (!equippedBackpack?.publicKey) {
    return { walletAvailable: Boolean(provider), owner: owner.toBase58(), equipped: false, backpack: null };
  }
  return { walletAvailable: Boolean(provider), owner: owner.toBase58(), equipped: true, backpack: equippedBackpack };
}

export async function migrateBackpackMassOnChain({ backpackAddress = null } = {}) {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, migrated: false, reason: "wallet-unavailable" };
  const conn = getNicechunkConnection();
  const backpack = backpackAddress
    ? await loadBackpackAccountForOwner(backpackAddress, provider.publicKey, conn).catch(() => null)
    : await loadEquippedBackpackForOwner(provider.publicKey, conn);
  if (!backpack?.publicKey) return { submitted: false, migrated: false, reason: "no-backpack" };
  if (backpack.massInitialized) {
    return {
      submitted: false,
      migrated: false,
      reason: "already-initialized",
      backpack: backpack.publicKey.toBase58(),
      totalMassGrams: backpack.totalMassGrams,
    };
  }
  const context = gameContext;
  const transaction = new Transaction().add(createMigrateBackpackMassInstruction({
    owner: provider.publicKey,
    backpack: backpack.publicKey,
    context,
  }));
  const signature = await signAndSendWalletTransaction(provider, transaction, conn);
  return {
    submitted: true,
    migrated: true,
    signature,
    backpack: backpack.publicKey.toBase58(),
    programId: context.backpackProgramId.toBase58(),
  };
}

export async function forgeEquipmentOnChain({
  code,
  materialInputs = [],
} = {}) {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const normalizedCode = String(code || "").trim();
  if (!normalizedCode) return { submitted: false, reason: "empty-code" };
  const codeBytes = new TextEncoder().encode(normalizedCode);
  if (codeBytes.length > forgedItemCodeMaxLength) {
    return {
      submitted: false,
      reason: "code-too-large",
      byteLength: codeBytes.length,
      maxByteLength: forgedItemCodeMaxLength,
    };
  }
  const rawCodeBytes = decodeVerifiedForgeCodeBytes(normalizedCode);
  if (!rawCodeBytes?.length) {
    return { submitted: false, reason: "invalid-forge-code" };
  }
  if (rawCodeBytes.length > verifiedForgeCodeMaxRawLength) {
    return {
      submitted: false,
      reason: "code-too-large",
      byteLength: rawCodeBytes.length,
      maxByteLength: verifiedForgeCodeMaxRawLength,
    };
  }
  const normalizedMaterialInputs = normalizeForgingMaterialInputs(materialInputs);
  if (!normalizedMaterialInputs.length) {
    return { submitted: false, reason: "no-material-inputs" };
  }

  const conn = getNicechunkConnection();
  const backpack = (await loadEquippedBackpackForOwner(provider.publicKey, conn))?.publicKey;
  if (!backpack) return { submitted: false, reason: "no-backpack" };
  const backpackAccountInfo = await conn.getAccountInfo(backpack, "confirmed");
  if (!backpackAccountInfo?.data?.length) return { submitted: false, reason: "no-backpack" };
  const backpackAccount = {
    ...decodeBackpack(backpackAccountInfo.data),
    publicKey: backpack.toBase58(),
  };
  const materialMismatch = normalizedMaterialInputs.find((input) => {
    const slotRecord = backpackAccount.slots[input.slotIndex];
    return !slotRecord || !backpackSlotMatchesForgingInput(slotRecord, input);
  });
  if (materialMismatch) {
    return { submitted: false, reason: "material-mismatch", material: materialMismatch };
  }
  const inputIndexes = normalizedMaterialInputs.map((input) => input.slotIndex);
  if (inputIndexes.length > 24) {
    return { submitted: false, reason: "too-many-material-inputs" };
  }
  if (
    Number.isFinite(backpackAccount.itemCount) &&
    Number.isFinite(backpackAccount.capacity) &&
    backpackAccount.itemCount - inputIndexes.length + 1 > backpackAccount.capacity
  ) {
    return { submitted: false, reason: "backpack-full" };
  }
  const itemId = createBackpackId();
  const designHash = forgeDesignHashFromCodeBytes(rawCodeBytes);
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 260_000 }));
  tx.add(createForgeEquipmentVerifiedInstruction({
    owner: provider.publicKey,
    backpack,
    itemId,
    codeBytes: rawCodeBytes,
    inputIndexes,
    context: gameContext,
  }));
  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  return {
    submitted: true,
    signature,
    owner: provider.publicKey.toBase58(),
    backpack: backpack.toBase58(),
    itemId: itemId.toString(),
    designHash,
    byteLength: codeBytes.length,
    consumedIndexes: inputIndexes,
    verificationMode: "material-parameters-v1",
    materialParametersVerifiedOnChain: true,
    destination: "backpack",
    programId: gameContext.backpackProgramId.toBase58(),
  };
}

function forgeDesignHashFromCodeBytes(codeBytes) {
  let hash = 0x811c9dc5;
  for (const byte of codeBytes ?? []) {
    hash ^= Number(byte) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function decodeVerifiedForgeCodeBytes(code) {
  const text = String(code || "").trim();
  if (!text.startsWith("NCF1.")) return null;
  const encoded = text.slice(5);
  if (!encoded || !/^[A-Za-z0-9_-]+$/u.test(encoded)) return null;
  try {
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(Buffer.from(padded, "base64"));
    return bytes.length ? bytes : null;
  } catch {
    return null;
  }
}

function normalizeForgingMaterialInputs(inputs = []) {
  const seen = new Set();
  const normalized = [];
  for (const input of inputs ?? []) {
    const slotIndex = Number(input?.slotIndex);
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 98 || seen.has(slotIndex)) continue;
    seen.add(slotIndex);
    normalized.push({
      slotIndex,
      itemCode: Number(input?.itemCode) || 0,
      itemId: String(input?.itemId ?? "0"),
      itemPda: String(input?.itemPda ?? ""),
      volumeMm3: Number(input?.volumeMm3) || 0,
      quantity: Number(input?.quantity) || 0,
      durabilityCurrent: Number(input?.durabilityCurrent) || 0,
      durabilityMax: Number(input?.durabilityMax) || 0,
      grade: Number(input?.grade) || 0,
      itemLevel: Number(input?.itemLevel) || 0,
      qualityBps: Number(input?.qualityBps) || 0,
      materialId: String(input?.materialId ?? ""),
    });
  }
  return normalized;
}

function backpackSlotMatchesForgingInput(slot, input) {
  if (slot.kind !== "item") return false;
  if (Number(slot.itemCode) !== input.itemCode) return false;
  if (String(slot.itemId ?? "0") !== input.itemId) return false;
  if (String(slot.itemPda ?? "") !== input.itemPda) return false;
  if (Number(slot.volumeMm3 || 0) !== input.volumeMm3) return false;
  if (Number(slot.quantity || 0) !== input.quantity) return false;
  if (Number(slot.durabilityCurrent || 0) !== input.durabilityCurrent) return false;
  if (Number(slot.durabilityMax || 0) !== input.durabilityMax) return false;
  if (Number(slot.grade || 0) !== input.grade) return false;
  if (Number(slot.itemLevel || 0) !== input.itemLevel) return false;
  if (Number(slot.qualityBps || 0) !== input.qualityBps) return false;
  return true;
}

export async function discardBackpackResourceAt({ backpackAddress = null, index = null } = {}) {
  const provider = await connectedWalletProvider();
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const resourceIndex = Number(index);
  if (!Number.isInteger(resourceIndex) || resourceIndex < 0 || resourceIndex > 98) {
    return { submitted: false, reason: "invalid-backpack-index" };
  }
  const session = await getOrCreateGameplaySession(provider);
  const backpack = backpackAddress
    ? new PublicKey(backpackAddress)
    : (await loadEquippedBackpackForOwner(provider.publicKey))?.publicKey;
  if (!backpack) return { submitted: false, reason: "no-backpack" };
  const backpackAccount = await fetchBackpack(backpack).catch(() => null);
  if (!backpackAccount?.publicKey) return { submitted: false, reason: "no-backpack" };
  const context = gameContext;
  const tx = new Transaction().add(createRemoveBackpackResourceInstruction({
    owner: provider.publicKey,
    sessionAuthority: session.keypair.publicKey,
    backpack,
    index: resourceIndex,
    context,
  }));
  const conn = getNicechunkConnection();
  const signature = await signAndSendKeypairTransaction(session.keypair, tx, conn);
  return {
    submitted: true,
    signature,
    backpack: backpack.toBase58(),
    index: resourceIndex,
    programId: context.backpackProgramId.toBase58(),
  };
}

export async function discardBackpackResourcesAt({ backpackAddress = null, indexes = [] } = {}) {
  const provider = await connectedWalletProvider();
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const resourceIndexes = normalizeBackpackIndexes(indexes);
  if (!resourceIndexes.length) {
    return { submitted: false, reason: "invalid-backpack-index" };
  }
  const session = await getOrCreateGameplaySession(provider);
  const backpack = backpackAddress
    ? new PublicKey(backpackAddress)
    : (await loadEquippedBackpackForOwner(provider.publicKey))?.publicKey;
  if (!backpack) return { submitted: false, reason: "no-backpack" };
  const backpackAccount = await fetchBackpack(backpack).catch(() => null);
  if (!backpackAccount?.publicKey) return { submitted: false, reason: "no-backpack" };
  const context = gameContext;
  const tx = new Transaction().add(createRemoveBackpackResourcesInstruction({
    owner: provider.publicKey,
    sessionAuthority: session.keypair.publicKey,
    backpack,
    indexes: resourceIndexes,
    context,
  }));
  const conn = getNicechunkConnection();
  const signature = await signAndSendKeypairTransaction(session.keypair, tx, conn);
  return {
    submitted: true,
    signature,
    backpack: backpack.toBase58(),
    indexes: resourceIndexes,
    count: resourceIndexes.length,
    programId: context.backpackProgramId.toBase58(),
  };
}

function normalizeBackpackIndexes(indexes = []) {
  return Array.from(new Set((indexes ?? [])
    .map((index) => Number(index))
    .filter((index) => Number.isInteger(index) && index >= 0 && index <= 98)));
}

export async function fetchBackpack(backpackAddress) {
  if (!backpackAddress) return null;
  const publicKey = typeof backpackAddress === "string" ? new PublicKey(backpackAddress) : backpackAddress;
  const account = await getNicechunkConnection().getAccountInfo(publicKey, "confirmed");
  if (!account?.data?.length) return null;
  if (!account.owner.equals(gameProgramId)) return null;
  const decoded = decodeBackpack(account.data);
  return {
    ...decoded,
    publicKey: publicKey.toBase58(),
    programId: account.owner.toBase58(),
  };
}

export async function fetchPlayerProfileForOwner(ownerAddress = null) {
  const owner = ownerAddress
    ? (typeof ownerAddress === "string" ? new PublicKey(ownerAddress) : ownerAddress)
    : (await connectedWalletProvider())?.publicKey ?? storedWalletPublicKey();
  if (!owner) return null;
  const [playerProfile] = derivePlayerProfilePda(owner);
  const account = await getNicechunkConnection().getAccountInfo(playerProfile, "confirmed");
  if (!account?.data?.length || !account.owner.equals(playerProgramId)) return null;
  const decoded = decodePlayerProfile(account.data);
  if (decoded.owner !== owner.toBase58()) return null;
  return {
    ...decoded,
    publicKey: playerProfile.toBase58(),
    programId: account.owner.toBase58(),
  };
}

export async function fetchPlayerEquipmentForOwner(ownerAddress = null) {
  const owner = ownerAddress
    ? (typeof ownerAddress === "string" ? new PublicKey(ownerAddress) : ownerAddress)
    : (await connectedWalletProvider())?.publicKey ?? storedWalletPublicKey();
  if (!owner) return null;
  const [playerEquipment] = derivePlayerEquipmentPda(owner);
  const account = await getNicechunkConnection().getAccountInfo(playerEquipment, "confirmed");
  if (!account?.data?.length || !account.owner.equals(playerProgramId)) return null;
  const decoded = decodePlayerEquipment(account.data);
  if (decoded.owner !== owner.toBase58()) return null;
  return {
    ...decoded,
    publicKey: playerEquipment.toBase58(),
    programId: account.owner.toBase58(),
  };
}

export async function fetchPlayerEquipmentForOwners(ownerAddresses = []) {
  const owners = Array.from(new Set((ownerAddresses ?? []).map((owner) => (
    typeof owner === "string" ? owner : owner?.toBase58?.()
  )).filter(Boolean))).map((owner) => new PublicKey(owner));
  if (!owners.length) return [];
  const addresses = owners.map((owner) => derivePlayerEquipmentPda(owner)[0]);
  const accounts = await getMultipleAccountsInfoBatched(getNicechunkConnection(), addresses, 100);
  return accounts.map((account, index) => {
    if (!account?.data?.length || !account.owner.equals(playerProgramId)) return null;
    const decoded = decodePlayerEquipment(account.data);
    if (decoded.owner !== owners[index].toBase58()) return null;
    return {
      ...decoded,
      publicKey: addresses[index].toBase58(),
      programId: account.owner.toBase58(),
    };
  });
}

export async function setPlayerEquipmentSlotsOnChain(changes = []) {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const normalized = normalizePlayerEquipmentChanges(changes);
  if (!normalized.length) return { submitted: false, reason: "no-equipment-changes" };

  const conn = getNicechunkConnection();
  const [playerProfile] = derivePlayerProfilePda(provider.publicKey);
  const [playerEquipment] = derivePlayerEquipmentPda(provider.publicKey);
  const currentEquipment = await fetchPlayerEquipmentForOwner(provider.publicKey);
  const simulatedSlots = simulatedPlayerEquipmentSlots(currentEquipment);
  const signatures = [];
  const changedBackpacks = new Set();

  const submitInstruction = async (instruction) => {
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 340_000 }));
    tx.add(instruction);
    const signature = await signAndSendWalletTransaction(provider, tx, conn);
    signatures.push(signature);
    return signature;
  };

  // Move already-custodied records first. One swap updates two slots without
  // reading or rewriting the Backpack PDA.
  for (const change of normalized) {
    const reference = change.reference;
    if (reference?.sourceType !== "equipment") continue;
    const currentSlot = findSimulatedEquipmentSlot(simulatedSlots, reference);
    if (currentSlot < 0) throw new Error("equipment-source-not-found");
    if (currentSlot === change.slot) continue;
    const source = simulatedSlots[currentSlot];
    const target = simulatedSlots[change.slot];
    if (!source?.custodied || target?.equipped && !target?.custodied) {
      throw new Error("equipment-migration-required");
    }
    await submitInstruction(createSwapPlayerEquipmentSlotsInstruction({
      authority: provider.publicKey,
      playerProfile,
      playerEquipment,
      fromSlot: currentSlot,
      toSlot: change.slot,
    }));
    simulatedSlots[currentSlot] = target;
    simulatedSlots[change.slot] = source;
  }

  // Backpack compaction changes every later index. Resolve each incoming item
  // by immutable identity against a fresh account read before submitting it.
  for (const change of normalized) {
    const reference = change.reference;
    if (reference?.sourceType !== "backpack") continue;
    const backpackAddress = reference.backpackAddress;
    const backpack = await fetchBackpack(backpackAddress);
    if (!backpack?.publicKey || backpack.owner !== provider.publicKey.toBase58()) {
      throw new Error("equipment-backpack-owner-mismatch");
    }
    const backpackIndex = findBackpackReferenceIndex(backpack, reference);
    if (backpackIndex < 0) throw new Error("equipment-backpack-item-not-found");
    await submitInstruction(createTransferPlayerEquipmentSlotInstruction({
      authority: provider.publicKey,
      playerProfile,
      playerEquipment,
      backpack: new PublicKey(backpack.publicKey),
      slot: change.slot,
      backpackIndex,
      modelBytes: reference.modelBytes,
    }));
    changedBackpacks.add(backpack.publicKey);
    simulatedSlots[change.slot] = simulatedEquipmentSlotFromBackpack(
      backpack.slots?.[backpackIndex],
      backpack.publicKey,
      backpackIndex,
      change.slot,
      reference.modelBytes,
    );
  }

  // Clears run last so a move-to-empty swap does not append the moved item back
  // into the Backpack. Legacy non-custody records are simply cleared in place.
  for (const change of normalized) {
    if (change.reference) continue;
    const current = simulatedSlots[change.slot];
    if (!current?.equipped) continue;
    const backpackAddress = String(
      change.beforeReference?.backpackAddress
      || current.backpack
      || "",
    ).trim();
    if (!backpackAddress) throw new Error("equipment-backpack-unavailable");
    await submitInstruction(createTransferPlayerEquipmentSlotInstruction({
      authority: provider.publicKey,
      playerProfile,
      playerEquipment,
      backpack: new PublicKey(backpackAddress),
      slot: change.slot,
      backpackIndex: 255,
      modelBytes: Buffer.alloc(0),
    }));
    if (current.custodied) changedBackpacks.add(backpackAddress);
    simulatedSlots[change.slot] = emptySimulatedEquipmentSlot(change.slot);
  }

  const equipment = await fetchPlayerEquipmentForOwner(provider.publicKey);
  const backpacks = await Promise.all(Array.from(changedBackpacks, async (address) => fetchBackpack(address)));
  return {
    submitted: true,
    signature: signatures.at(-1) || "",
    signatures,
    owner: provider.publicKey.toBase58(),
    playerProfile: playerProfile.toBase58(),
    playerEquipment: playerEquipment.toBase58(),
    equipment,
    backpackAddresses: Array.from(changedBackpacks),
    backpacks: backpacks.filter(Boolean),
    changes: normalized.map((change) => ({
      slot: change.slot,
      sourceType: change.reference?.sourceType || "empty",
      backpack: change.reference?.backpackAddress || change.beforeReference?.backpackAddress || "",
      backpackIndex: change.reference?.backpackIndex ?? 255,
      equipmentSlot: change.reference?.equipmentSlot ?? null,
      modelByteLength: change.reference?.modelBytes?.length || 0,
    })),
    programId: playerProgramId.toBase58(),
  };
}

function normalizePlayerEquipmentChanges(changes = []) {
  const bySlot = new Map();
  for (const change of changes ?? []) {
    const slot = Math.trunc(Number(change?.slot ?? change?.slotIndex));
    if (!Number.isInteger(slot) || slot < 0 || slot >= playerEquipmentSlotCount) continue;
    bySlot.set(slot, {
      slot,
      beforeReference: normalizePlayerEquipmentReference(change?.beforeReference),
      reference: normalizePlayerEquipmentReference(
        change?.reference === undefined ? change : change.reference,
      ),
    });
  }
  return Array.from(bySlot.values()).sort((left, right) => left.slot - right.slot);
}

function normalizePlayerEquipmentReference(reference) {
  if (!reference || typeof reference !== "object") return null;
  const backpackAddress = String(reference.backpackAddress ?? reference.backpack ?? "").trim();
  const equipmentSlot = Math.trunc(Number(reference.equipmentSlot));
  const backpackIndex = Math.trunc(Number(reference.backpackIndex ?? reference.chainIndex));
  const sourceType = reference.sourceType === "equipment" && equipmentSlot >= 0 && equipmentSlot < playerEquipmentSlotCount
    ? "equipment"
    : backpackAddress && backpackIndex >= 0 && backpackIndex < backpackMaxCapacity
      ? "backpack"
      : "";
  if (!sourceType || !backpackAddress) return null;
  const modelBytes = Buffer.from(reference.modelBytes ?? reference.payloadBytes ?? reference.bytes ?? []);
  if (modelBytes.length > playerEquipmentModelCodeMaxBytes) {
    throw new Error(`Equipment model is too large: max ${playerEquipmentModelCodeMaxBytes} bytes.`);
  }
  return {
    sourceType,
    equipmentSlot: sourceType === "equipment" ? equipmentSlot : null,
    backpackAddress,
    backpackIndex: backpackIndex >= 0 && backpackIndex < backpackMaxCapacity ? backpackIndex : 255,
    modelBytes,
    kind: String(reference.kind || ""),
    kindCode: Math.trunc(Number(reference.kindCode) || 0),
    chainItemId: String(reference.chainItemId ?? reference.itemId ?? ""),
    itemCode: Math.trunc(Number(reference.itemCode) || 0),
    itemPda: String(reference.itemPda || ""),
    blockId: Math.trunc(Number(reference.blockId ?? reference.proof?.blockId) || 0),
    worldX: finiteIntegerOrNull(reference.worldX ?? reference.proof?.worldX),
    worldY: finiteIntegerOrNull(reference.worldY ?? reference.proof?.worldY),
    worldZ: finiteIntegerOrNull(reference.worldZ ?? reference.proof?.worldZ),
    metadata: Math.trunc(Number(reference.metadata) || 0) >>> 0,
  };
}

function simulatedPlayerEquipmentSlots(equipment) {
  const records = Array.isArray(equipment?.slots) ? equipment.slots : [];
  return Array.from({ length: playerEquipmentSlotCount }, (_, slot) => {
    const record = records.find((entry) => Number(entry?.slot) === slot) ?? records[slot];
    return record?.equipped ? { ...record, slot } : emptySimulatedEquipmentSlot(slot);
  });
}

function emptySimulatedEquipmentSlot(slot) {
  return { slot, equipped: false, custodied: false, backpack: "", backpackSlot: null, modelBytes: [] };
}

function simulatedEquipmentSlotFromBackpack(backpackSlot, backpack, backpackIndex, slot, modelBytes) {
  return {
    slot,
    equipped: Boolean(backpackSlot),
    custodied: Boolean(backpackSlot),
    backpack,
    backpackIndex,
    backpackSlot: backpackSlot ? { ...backpackSlot } : null,
    modelBytes: Array.from(modelBytes ?? []),
  };
}

function findSimulatedEquipmentSlot(slots, reference) {
  const exact = slots.findIndex((slot) => equipmentSlotMatchesReference(slot, reference));
  if (exact >= 0) return exact;
  const fallback = Number(reference?.equipmentSlot);
  return Number.isInteger(fallback) && fallback >= 0 && fallback < slots.length && slots[fallback]?.equipped
    ? fallback
    : -1;
}

function equipmentSlotMatchesReference(slot, reference) {
  if (!slot?.equipped || !reference) return false;
  if (reference.backpackAddress && String(slot.backpack || "") !== reference.backpackAddress) return false;
  return backpackSlotMatchesReference(slot.backpackSlot, reference);
}

function findBackpackReferenceIndex(backpack, reference) {
  const slots = Array.isArray(backpack?.slots) ? backpack.slots : [];
  const exact = slots.findIndex((slot) => backpackSlotMatchesReference(slot, reference));
  if (exact >= 0) return exact;
  const fallback = Number(reference?.backpackIndex);
  return Number.isInteger(fallback) && fallback >= 0 && fallback < slots.length
    && backpackSlotMatchesReference(slots[fallback], reference, { allowIndexOnly: true })
    ? fallback
    : -1;
}

function backpackSlotMatchesReference(slot, reference, { allowIndexOnly = false } = {}) {
  if (!slot || !reference) return false;
  const itemId = String(slot.itemId || "0");
  const referenceItemId = String(reference.chainItemId || "");
  if (slot.kind === "item" || referenceItemId) {
    if (referenceItemId && itemId !== referenceItemId) return false;
    if (reference.itemCode && Number(slot.itemCode) !== reference.itemCode) return false;
    if (reference.itemPda && String(slot.itemPda || "") !== reference.itemPda) return false;
    return Boolean(referenceItemId || reference.itemCode || reference.itemPda || allowIndexOnly);
  }
  const resource = slot.resource || slot;
  if (reference.blockId && Number(resource.blockId) !== reference.blockId) return false;
  const coordinates = [reference.worldX, reference.worldY, reference.worldZ];
  if (coordinates.every(Number.isInteger)) {
    return Number(resource.worldX) === reference.worldX
      && Number(resource.worldY) === reference.worldY
      && Number(resource.worldZ) === reference.worldZ;
  }
  return Boolean(reference.blockId || allowIndexOnly);
}

function finiteIntegerOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

export async function fetchPlayerAppearanceForOwner(ownerAddress = null) {
  const owner = ownerAddress
    ? (typeof ownerAddress === "string" ? new PublicKey(ownerAddress) : ownerAddress)
    : (await connectedWalletProvider())?.publicKey ?? storedWalletPublicKey();
  if (!owner) return null;
  const [appearance] = derivePlayerAppearancePda(owner);
  const account = await getNicechunkConnection().getAccountInfo(appearance, "confirmed");
  if (!account?.data?.length || !account.owner.equals(playerProgramId)) return null;
  const decoded = decodePlayerAppearance(account.data);
  if (decoded.owner !== owner.toBase58()) return null;
  return {
    ...decoded,
    publicKey: appearance.toBase58(),
    programId: account.owner.toBase58(),
  };
}

export const fetchPlayerCharacterForOwner = fetchPlayerAppearanceForOwner;

export async function checkPlayerNameAvailability(playerName, ownerAddress = null) {
  const { normalized } = encodePlayerName(playerName);
  if (!normalized) return { available: false, reason: "empty-player-name" };
  const [usernameIndex] = await deriveUsernameIndexPdaForName(normalized);
  const account = await getNicechunkConnection().getAccountInfo(usernameIndex, "confirmed");
  if (!account?.data?.length) {
    return {
      available: true,
      usernameIndex: usernameIndex.toBase58(),
      playerName: normalized,
    };
  }
  if (!account.owner.equals(playerProgramId)) {
    return {
      available: false,
      reason: "invalid-username-index-owner",
      usernameIndex: usernameIndex.toBase58(),
      playerName: normalized,
    };
  }
  const decoded = decodeUsernameIndex(account.data);
  const owner = ownerAddress
    ? (typeof ownerAddress === "string" ? ownerAddress : ownerAddress?.toBase58?.())
    : null;
  const available = Boolean(owner && decoded?.owner === owner);
  return {
    available,
    reason: available ? "owned-by-current-wallet" : "username-taken",
    usernameIndex: usernameIndex.toBase58(),
    owner: decoded?.owner || null,
    playerName: normalized,
  };
}

export async function fetchInviteIndexPages(inviterAddress, { maxPages = 16 } = {}) {
  if (!inviterAddress) return { inviter: "", pages: [], entries: [], capacity: inviteIndexCapacity };
  const inviter = typeof inviterAddress === "string" ? new PublicKey(inviterAddress) : inviterAddress;
  const pageCount = Math.max(1, Math.min(64, Math.floor(Number(maxPages) || 16)));
  const pageKeys = Array.from({ length: pageCount }, (_value, index) => deriveInviteIndexPda(inviter, index)[0]);
  const accounts = await getNicechunkConnection().getMultipleAccountsInfo(pageKeys, "confirmed");
  const pages = [];
  const entries = [];
  let sawMissingAfterData = false;
  for (let index = 0; index < pageKeys.length; index += 1) {
    const account = accounts[index];
    if (!account?.data?.length || !account.owner.equals(playerProgramId)) {
      if (pages.length) sawMissingAfterData = true;
      if (!pages.length || sawMissingAfterData) break;
      continue;
    }
    const page = decodeInviteIndex(account.data, {
      publicKey: pageKeys[index],
      inviter,
      pageIndex: index,
      programId: account.owner,
    });
    if (!page) break;
    pages.push(page);
    for (const entry of page.entries) entries.push(entry);
    if (page.count < inviteIndexCapacity) break;
  }
  return {
    inviter: inviter.toBase58(),
    pages,
    entries,
    capacity: inviteIndexCapacity,
    pageSizeBytes: inviteIndexLength,
  };
}

export async function estimateInviteIndexPageStorageCost() {
  const lamports = await getNicechunkConnection().getMinimumBalanceForRentExemption(inviteIndexLength, "confirmed");
  return {
    lamports,
    sol: lamports / lamportsPerSol,
    pageSizeBytes: inviteIndexLength,
    capacity: inviteIndexCapacity,
  };
}

export async function initializeFirstInvitePageOnChain() {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const [inviteIndex] = deriveInviteIndexPda(provider.publicKey, 0);
  const conn = getNicechunkConnection();
  const existing = await conn.getAccountInfo(inviteIndex, "confirmed");
  if (existing?.data?.length && existing.owner.equals(playerProgramId)) {
    return {
      submitted: false,
      reason: "already-initialized",
      inviter: provider.publicKey.toBase58(),
      inviteIndex: inviteIndex.toBase58(),
      capacity: inviteIndexCapacity,
    };
  }
  const tx = new Transaction().add(createInitializeInviteIndexPageInstruction({
    payer: provider.publicKey,
    inviter: provider.publicKey,
    inviteIndex,
    pageIndex: 0,
  }));
  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  return {
    submitted: true,
    signature,
    inviter: provider.publicKey.toBase58(),
    inviteIndex: inviteIndex.toBase58(),
    pageIndex: 0,
    capacity: inviteIndexCapacity,
    programId: playerProgramId.toBase58(),
  };
}

export async function registerInviteOnChain({ inviterWallet } = {}) {
  const inviterText = String(inviterWallet || "").trim();
  if (!inviterText) return { submitted: false, reason: "missing-inviter" };
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const inviter = new PublicKey(inviterText);
  if (inviter.equals(provider.publicKey)) return { submitted: false, reason: "self-invite" };
  const current = await fetchInviteIndexPages(inviter, { maxPages: 16 });
  if (!current.pages.length) {
    return { submitted: false, reason: "invite-first-page-required", inviter: inviter.toBase58() };
  }
  const invitedWallet = provider.publicKey.toBase58();
  if (current.entries.some((entry) => String(entry.invitedWallet || entry.wallet || "") === invitedWallet)) {
    return {
      submitted: false,
      reason: "already-registered",
      invited: invitedWallet,
      inviter: inviter.toBase58(),
      capacity: inviteIndexCapacity,
    };
  }
  let targetPage = current.pages.find((page) => page.count < inviteIndexCapacity);
  if (!targetPage) {
    const nextIndex = current.pages.length;
    const [publicKey] = deriveInviteIndexPda(inviter, nextIndex);
    targetPage = { pageIndex: nextIndex, publicKey: publicKey.toBase58(), count: 0 };
  }
  const pageIndex = Number(targetPage.pageIndex);
  const [inviteIndex] = deriveInviteIndexPda(inviter, pageIndex);
  const previousInviteIndex = pageIndex > 0 ? deriveInviteIndexPda(inviter, pageIndex - 1)[0] : null;
  const tx = new Transaction().add(createAppendInviteRegistrationInstruction({
    invited: provider.publicKey,
    inviter,
    inviteIndex,
    pageIndex,
    previousInviteIndex,
  }));
  const conn = getNicechunkConnection();
  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  return {
    submitted: true,
    signature,
    invited: provider.publicKey.toBase58(),
    inviter: inviter.toBase58(),
    inviteIndex: inviteIndex.toBase58(),
    pageIndex,
    capacity: inviteIndexCapacity,
    programId: playerProgramId.toBase58(),
  };
}

export async function createPlayerAppearanceOnChain({
  playerName,
  title = "",
  gender = "male",
  ncmCode,
} = {}) {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const { normalized, bytes: nameBytes } = encodePlayerName(playerName);
  if (!normalized) return { submitted: false, reason: "empty-player-name" };
  const normalizedCode = String(ncmCode || "").trim();
  const titleBytes = Buffer.from(String(title || "").trim(), "utf8");
  if (titleBytes.length > appearanceTitleMaxBytes) {
    return {
      submitted: false,
      reason: "appearance-title-too-large",
      byteLength: titleBytes.length,
      maxByteLength: appearanceTitleMaxBytes,
    };
  }
  const codeBytes = Buffer.from(normalizedCode, "utf8");
  if (!normalizedCode.startsWith("NCM") || !codeBytes.length) {
    return { submitted: false, reason: "invalid-character-code" };
  }
  if (codeBytes.length > appearanceModelCodeMaxBytes) {
    return {
      submitted: false,
      reason: "character-code-too-large",
      byteLength: codeBytes.length,
      maxByteLength: appearanceModelCodeMaxBytes,
    };
  }
  const [playerProfile] = derivePlayerProfilePda(provider.publicKey);
  const [appearance] = derivePlayerAppearancePda(provider.publicKey);
  const [usernameIndex] = await deriveUsernameIndexPdaForName(normalized);
  const modelKind = String(gender).toLowerCase() === "female" ? 2 : 1;
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 240_000 }));
  tx.add(createUpsertPlayerAppearanceInstruction({
    authority: provider.publicKey,
    playerProfile,
    appearance,
    usernameIndex,
    modelKind,
    playerNameBytes: nameBytes,
    titleBytes,
    codeBytes,
  }));
  const conn = getNicechunkConnection();
  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  return {
    submitted: true,
    signature,
    owner: provider.publicKey.toBase58(),
    playerProfile: playerProfile.toBase58(),
    appearance: appearance.toBase58(),
    usernameIndex: usernameIndex.toBase58(),
    playerName: normalized,
    gender: modelKind === 2 ? "female" : "male",
    byteLength: codeBytes.length,
    programId: playerProgramId.toBase58(),
  };
}

export const createPlayerCharacterOnChain = createPlayerAppearanceOnChain;

export async function updatePlayerPositionOnChain(position, { prompt = true, reason = "", minedBlock = null } = {}) {
  if (String(reason || "") !== playerPositionSaveReasonResourceMine) {
    return { submitted: false, reason: "resource-mine-only" };
  }
  const minedResource = await resolvePlayerPositionMinedResourceBlock(minedBlock);
  if (!minedResource.block) {
    return { submitted: false, reason: minedResource.reason };
  }
  const canonicalMinedBlock = minedResource.block;
  const provider = await connectedWalletProvider({ prompt });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const [playerProfile] = derivePlayerProfilePda(provider.publicKey);
  const tx = new Transaction();
  tx.add(createUpdatePlayerPositionInstruction({
    authority: provider.publicKey,
    playerProfile,
    position,
  }));
  const conn = getNicechunkConnection();
  const localKeypair = isLocalGameWalletProvider(provider) ? getLocalGameWalletKeypair() : null;
  const signature = localKeypair
    ? await signAndSendKeypairTransaction(localKeypair, tx, conn)
    : await signAndSendWalletTransaction(provider, tx, conn);
  return {
    submitted: true,
    signature,
    owner: provider.publicKey.toBase58(),
    playerProfile: playerProfile.toBase58(),
    position: normalizePlayerPositionForChain(position),
    minedBlock: canonicalMinedBlock,
    programId: playerProgramId.toBase58(),
  };
}

export async function upsertPlayerProfileName(playerName) {
  const provider = await connectedWalletProvider({ prompt: true });
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const { normalized } = encodePlayerName(playerName);
  const conn = getNicechunkConnection();
  const [playerProfile] = derivePlayerProfilePda(provider.publicKey);
  const [usernameIndex] = await deriveUsernameIndexPdaForName(normalized);
  const account = await conn.getAccountInfo(playerProfile, "confirmed");
  const tx = new Transaction();
  if (!account?.data?.length) {
    tx.add(createInitializePlayerInstruction(provider.publicKey, playerProfile, normalized, usernameIndex));
  } else {
    if (!account.owner.equals(playerProgramId) || account.data.length !== playerProfileLength) {
      return {
        submitted: false,
        reason: "player-profile-version-mismatch",
        actualLength: account.data.length,
        expectedLength: playerProfileLength,
      };
    }
    const decoded = decodePlayerProfile(account.data);
    if (decoded.owner !== provider.publicKey.toBase58()) {
      return { submitted: false, reason: "invalid-player-profile-owner" };
    }
    if (decoded.playerName === normalized) {
      return {
        submitted: false,
        reason: "unchanged",
        playerProfile: playerProfile.toBase58(),
        playerName: normalized,
      };
    }
    tx.add(createSetPlayerNameInstruction({
      authority: provider.publicKey,
      playerProfile,
      usernameIndex,
      playerName: normalized,
    }));
  }
  const signature = await signAndSendWalletTransaction(provider, tx, conn);
  return {
    submitted: true,
    signature,
    playerProfile: playerProfile.toBase58(),
    usernameIndex: usernameIndex.toBase58(),
    playerName: normalized,
  };
}

export async function fetchPlayerProgress(ownerAddress) {
  if (!ownerAddress) return null;
  const owner = typeof ownerAddress === "string" ? new PublicKey(ownerAddress) : ownerAddress;
  const [playerProgress] = derivePlayerProgressPdaForContext(owner, gameContext);
  const account = await getNicechunkConnection().getAccountInfo(playerProgress, "confirmed");
  if (!account?.data?.length) {
    return {
      publicKey: playerProgress.toBase58(),
      owner: owner.toBase58(),
      precisionGatheringXp: 0,
      smeltingXp: 0,
      explorationXp: 0,
    };
  }
  if (!account.owner.equals(gameContext.chunkProgramId)) return null;
  const data = account.data;
  if (data.length !== playerProgressLength || data.subarray(0, 8).toString("utf8") !== playerProgressMagic) return null;
  return {
    publicKey: playerProgress.toBase58(),
    owner: owner.toBase58(),
    precisionGatheringXp: Number(data.readBigUInt64LE(playerProgressPrecisionXpOffset)),
    smeltingXp: Number(data.readBigUInt64LE(playerProgressSmeltingXpOffset)),
    explorationXp: Number(data.readBigUInt64LE(playerProgressExplorationXpOffset)),
    programId: account.owner.toBase58(),
  };
}

export async function fetchPlayerSkillsForOwner(ownerAddress) {
  if (!ownerAddress) return null;
  const owner = typeof ownerAddress === "string" ? new PublicKey(ownerAddress) : ownerAddress;
  const [playerSkills] = derivePlayerSkillsPda(owner);
  const account = await getNicechunkConnection().getAccountInfo(playerSkills, "confirmed");
  if (!account?.data?.length) {
    return {
      initialized: false,
      publicKey: playerSkills.toBase58(),
      owner: owner.toBase58(),
      xp: null,
      levels: null,
      programId: NICECHUNK_SKILLS_PROGRAM_ID.toBase58(),
    };
  }
  if (!account.owner.equals(NICECHUNK_SKILLS_PROGRAM_ID)) {
    throw new Error(`PlayerSkills owner mismatch: ${account.owner.toBase58()}`);
  }
  return {
    initialized: true,
    publicKey: playerSkills.toBase58(),
    ...decodePlayerSkillsAccount(account.data),
    programId: account.owner.toBase58(),
  };
}

export const fetchPlayerSkills = fetchPlayerSkillsForOwner;

export function createSyncPlayerSkillsInstruction({
  payer,
  owner,
  sourceAccounts = [],
  miningCoordinate = null,
  programId = NICECHUNK_SKILLS_PROGRAM_ID,
}) {
  const normalizedPayer = typeof payer === "string" ? new PublicKey(payer) : payer;
  const normalizedOwner = typeof owner === "string" ? new PublicKey(owner) : owner;
  const [playerSkills] = derivePlayerSkillsPda(normalizedOwner, programId);
  const [ruleTable] = deriveSkillRuleTablePda(programId);
  const uniqueSources = [...new Map(sourceAccounts.map((source) => {
    const publicKey = typeof source === "string" ? new PublicKey(source) : source;
    return [publicKey.toBase58(), publicKey];
  })).values()];
  const coordinate = miningCoordinate ? normalizeSkillMiningCoordinate(miningCoordinate) : null;
  const data = Buffer.alloc(coordinate ? 13 : 1);
  data.writeUInt8(3, 0);
  if (coordinate) {
    data.writeInt32LE(coordinate.x, 1);
    data.writeInt32LE(coordinate.y, 5);
    data.writeInt32LE(coordinate.z, 9);
  }
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: normalizedPayer, isSigner: true, isWritable: true },
      { pubkey: normalizedOwner, isSigner: false, isWritable: false },
      { pubkey: playerSkills, isSigner: false, isWritable: true },
      { pubkey: ruleTable, isSigner: false, isWritable: false },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...(coordinate ? [{ pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false }] : []),
      ...uniqueSources.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
    ],
    data,
  });
}

function normalizeSkillMiningCoordinate(value) {
  const coordinate = {
    x: Number(value?.x),
    y: Number(value?.y),
    z: Number(value?.z),
  };
  if (!Number.isInteger(coordinate.x)
    || coordinate.x < -0x8000_0000
    || coordinate.x > 0x7fff_ffff
    || !Number.isInteger(coordinate.y)
    || coordinate.y < -0x8000
    || coordinate.y > 0x7fff
    || !Number.isInteger(coordinate.z)
    || coordinate.z < -0x8000_0000
    || coordinate.z > 0x7fff_ffff) {
    throw new Error("Invalid mining coordinate for skill synchronization.");
  }
  return coordinate;
}

export async function syncPlayerSkillsOnChain({ ownerAddress = null, sourceAccounts = null } = {}) {
  const provider = await connectedWalletProvider();
  if (!provider) return { submitted: false, reason: "wallet-unavailable" };
  const owner = ownerAddress
    ? (typeof ownerAddress === "string" ? new PublicKey(ownerAddress) : ownerAddress)
    : provider.publicKey;
  if (!owner.equals(provider.publicKey)) {
    return { submitted: false, reason: "owner-signing-session-required" };
  }
  const context = gameContext;
  const conn = getNicechunkConnection();
  const equippedBackpack = sourceAccounts?.length
    ? null
    : await loadEquippedBackpackForOwner(owner, conn).catch(() => null);
  const candidates = sourceAccounts?.length
    ? sourceAccounts.map((source) => (typeof source === "string" ? new PublicKey(source) : source))
    : [
        derivePlayerProgressPdaForContext(owner, context)[0],
        deriveSmeltingPlayerProgressPdaForContext(owner, context)[0],
        derivePlayerProfilePda(owner)[0],
        ...(equippedBackpack?.publicKey ? [equippedBackpack.publicKey] : []),
      ];
  const accounts = await conn.getMultipleAccountsInfo(candidates, "confirmed");
  const availableSources = candidates.filter((_source, index) => Boolean(accounts[index]?.data?.length));
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 180_000 }));
  tx.add(createSyncPlayerSkillsInstruction({
    payer: provider.publicKey,
    owner,
    sourceAccounts: availableSources,
  }));
  const localKeypair = isLocalGameWalletProvider(provider) ? getLocalGameWalletKeypair() : null;
  const signature = localKeypair
    ? await signAndSendKeypairTransaction(localKeypair, tx, conn)
    : await signAndSendWalletTransaction(provider, tx, conn);
  return {
    submitted: true,
    signature,
    owner: owner.toBase58(),
    sourceAccounts: availableSources.map((source) => source.toBase58()),
    playerSkills: derivePlayerSkillsPda(owner)[0].toBase58(),
  };
}

async function syncPlayerSkillsWithKeypair({ payer, owner, sourceAccounts, conn }) {
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 180_000 }));
  tx.add(createSyncPlayerSkillsInstruction({
    payer: payer.publicKey,
    owner,
    sourceAccounts,
  }));
  return signAndSendKeypairTransaction(payer, tx, conn);
}

function decodePlayerSkillsAccount(data) {
  if (data.length !== playerSkillsLength || data.subarray(0, 8).toString("utf8") !== playerSkillsMagic) {
    throw new Error(`Invalid PlayerSkills account length or magic.`);
  }
  const version = data.readUInt16LE(8);
  if (version !== playerSkillsVersion || data.readUInt8(11) !== 1) {
    throw new Error(`Unsupported PlayerSkills version: ${version}.`);
  }
  const xp = {};
  const levels = {};
  for (let index = 0; index < PLAYER_SKILL_IDS.length; index += 1) {
    xp[PLAYER_SKILL_IDS[index]] = Number(data.readBigUInt64LE(playerSkillsXpOffset + index * 8));
    levels[PLAYER_SKILL_IDS[index]] = data.readUInt8(playerSkillsLevelsOffset + index);
  }
  return {
    version,
    owner: new PublicKey(data.subarray(12, 44)).toBase58(),
    globalConfig: new PublicKey(data.subarray(44, 76)).toBase58(),
    xp,
    levels,
    cursorMask: data.readUInt32LE(playerSkillsCursorMaskOffset),
    ruleRevision: data.readUInt32LE(playerSkillsRuleRevisionOffset),
    createdSlot: data.readBigUInt64LE(playerSkillsCreatedSlotOffset).toString(),
    updatedSlot: data.readBigUInt64LE(playerSkillsUpdatedSlotOffset).toString(),
    lastMiningCoordinate: data.readUInt8(playerSkillsMiningFlagsOffset) & 1
      ? {
          x: data.readInt32LE(playerSkillsLastMineXOffset),
          y: data.readInt32LE(playerSkillsLastMineYOffset),
          z: data.readInt32LE(playerSkillsLastMineZOffset),
        }
      : null,
    miningTravelCount: data.readBigUInt64LE(playerSkillsMiningTravelCountOffset).toString(),
  };
}

export function getMinimumGameplaySessionFundingSol() {
  return minimumSessionFundingLamports / lamportsPerSol;
}

export function getConfiguredGameplaySessionFundingSol(owner = null) {
  return getConfiguredGameplaySessionFundingLamports(owner) / lamportsPerSol;
}

export function setConfiguredGameplaySessionFundingSol(value, owner = null) {
  const parsed = Number(value);
  const lamports = Number.isFinite(parsed)
    ? Math.max(minimumSessionFundingLamports, Math.ceil(parsed * lamportsPerSol))
    : minimumSessionFundingLamports;
  if (hasLocalStorage()) localStorage.setItem(sessionFundingStorageKey(owner), String(lamports));
  return lamports / lamportsPerSol;
}

export function hasAcknowledgedGameplaySessionFunding(owner = null) {
  return hasLocalStorage() && localStorage.getItem(sessionFundingAcknowledgedKey(owner)) === "1";
}

export function acknowledgeGameplaySessionFunding(owner = null) {
  if (hasLocalStorage()) localStorage.setItem(sessionFundingAcknowledgedKey(owner), "1");
}

export async function getGameplaySessionStatus({ force = false } = {}) {
  const provider = await connectedWalletProvider();
  if (!provider) {
    return {
      walletAvailable: false,
      acknowledged: false,
      configuredFundingLamports: getConfiguredGameplaySessionFundingLamports(null),
      minimumFundingLamports: minimumSessionFundingLamports,
      balanceLamports: null,
      publicKey: null,
      expiresAt: null,
      usesGameplaySession: true,
      walletMode: "pluginWallet",
    };
  }

  const owner = provider.publicKey;
  const ownerKey = owner.toBase58();
  const cached = gameplaySessionStatusCache.get(ownerKey);
  if (!force && cached && Date.now() - cached.loadedAt < gameplaySessionStatusCacheTtlMs) {
    return { ...cached.status };
  }

  if (isLocalGameWalletProvider(provider)) {
    let balanceLamports = null;
    try {
      balanceLamports = await getNicechunkConnection().getBalance(owner, "confirmed");
    } catch (error) {
      reportRpcError(error, "local-game-wallet-balance");
      throw error;
    }
    const status = createLocalGameWalletStatus(owner, balanceLamports);
    gameplaySessionStatusCache.set(ownerKey, { status, loadedAt: Date.now() });
    return status;
  }

  const stored = loadStoredGameplaySession(owner);
  const configuredFundingLamports = getConfiguredGameplaySessionFundingLamports(owner);
  if (!stored) {
    const status = {
      walletAvailable: true,
      owner: ownerKey,
      acknowledged: hasAcknowledgedGameplaySessionFunding(owner),
      configuredFundingLamports,
      minimumFundingLamports: minimumSessionFundingLamports,
      balanceLamports: null,
      publicKey: null,
      expiresAt: null,
      usesGameplaySession: true,
      walletMode: "pluginWallet",
    };
    gameplaySessionStatusCache.set(ownerKey, { status, loadedAt: Date.now() });
    return status;
  }

  let balanceLamports = null;
  try {
    balanceLamports = await getNicechunkConnection().getBalance(stored.keypair.publicKey, "confirmed");
  } catch (error) {
    reportRpcError(error, "session-balance");
    throw error;
  }

  const status = {
    walletAvailable: true,
    owner: ownerKey,
    acknowledged: hasAcknowledgedGameplaySessionFunding(owner),
    configuredFundingLamports,
    minimumFundingLamports: minimumSessionFundingLamports,
    balanceLamports,
    balanceSol: balanceLamports / lamportsPerSol,
    publicKey: stored.keypair.publicKey.toBase58(),
    expiresAt: stored.expiresAt,
    usesGameplaySession: true,
    walletMode: "pluginWallet",
  };
  gameplaySessionStatusCache.set(ownerKey, { status, loadedAt: Date.now() });
  return status;
}

export async function ensureGameplaySessionFunded() {
  try {
    const provider = await connectedWalletProvider({ prompt: true });
    if (!provider) return { funded: false, reason: "wallet-unavailable" };
    const session = await getOrCreateGameplaySession(provider);
    if (isLocalGameWalletProvider(provider)) {
      const balanceLamports = await getNicechunkConnection().getBalance(provider.publicKey, "confirmed");
      updateGameplaySessionStatusCache(provider.publicKey, createLocalGameWalletStatus(provider.publicKey, balanceLamports, session.expiresAt));
      return {
        funded: true,
        usesGameplaySession: false,
        walletMode: "localGameWallet",
        balanceLamports,
        balanceSol: balanceLamports / lamportsPerSol,
        publicKey: provider.publicKey.toBase58(),
        expiresAt: session.expiresAt,
      };
    }
    const balanceLamports = await getNicechunkConnection().getBalance(session.keypair.publicKey, "confirmed");
    updateGameplaySessionStatusCache(provider.publicKey, {
      walletAvailable: true,
      owner: provider.publicKey.toBase58(),
      acknowledged: hasAcknowledgedGameplaySessionFunding(provider.publicKey),
      configuredFundingLamports: getConfiguredGameplaySessionFundingLamports(provider.publicKey),
      minimumFundingLamports: minimumSessionFundingLamports,
      balanceLamports,
      balanceSol: balanceLamports / lamportsPerSol,
      publicKey: session.keypair.publicKey.toBase58(),
      expiresAt: session.expiresAt,
      usesGameplaySession: true,
      walletMode: "pluginWallet",
    });
    return {
      funded: true,
      balanceLamports,
      balanceSol: balanceLamports / lamportsPerSol,
      publicKey: session.keypair.publicKey.toBase58(),
      expiresAt: session.expiresAt,
    };
  } catch (error) {
    reportRpcError(error, "session-funding");
    return {
      funded: false,
      reason: "session-funding-failed",
      error,
      message: readableErrorMessage(error),
    };
  }
}

function dedupeChunks(chunks) {
  const seen = new Set();
  const unique = [];
  for (const chunk of chunks) {
    const chunkX = Number(chunk?.chunkX);
    const chunkZ = Number(chunk?.chunkZ);
    if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ)) continue;
    const key = `${chunkX},${chunkZ}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ chunkX, chunkZ });
  }
  return unique;
}

function chunkCacheKey(chunkX, chunkZ) {
  return `${chunkX},${chunkZ}`;
}

function chunkProgramCacheKey(context, chunkX, chunkZ) {
  return `${context.chunkProgramId.toBase58()}:${chunkCacheKey(chunkX, chunkZ)}`;
}

function resourceDropProgramCacheKey(context) {
  return context.chunkProgramId.toBase58();
}

function isResourceDropTableReady(context) {
  const loadedAt = resourceDropTableReadyAtByProgram.get(resourceDropProgramCacheKey(context)) || 0;
  return Boolean(loadedAt && Date.now() - loadedAt < resourceDropTableCacheTtlMs);
}

function markResourceDropTableReady(context) {
  resourceDropTableReadyAtByProgram.set(resourceDropProgramCacheKey(context), Date.now());
}

function isSurfaceDecorationTableReady(context) {
  const loadedAt = surfaceDecorationTableReadyAtByProgram.get(resourceDropProgramCacheKey(context)) || 0;
  return Boolean(loadedAt && Date.now() - loadedAt < resourceDropTableCacheTtlMs);
}

function markSurfaceDecorationTableReady(context) {
  surfaceDecorationTableReadyAtByProgram.set(resourceDropProgramCacheKey(context), Date.now());
}

function isProgramAccount(account, programId) {
  return Boolean(account?.data?.length && account.owner?.equals?.(programId));
}

function readFreshChunkDeltaCache(key) {
  const entry = chunkDeltaCache.get(key);
  if (!entry || entry.promise) return null;
  return Date.now() - entry.loadedAt < chunkDeltaCacheTtlMs ? entry.deltas : null;
}

function invalidateChunkDeltaCache(chunkX, chunkZ) {
  chunkDeltaCache.delete(chunkCacheKey(chunkX, chunkZ));
}

function updateGameplaySessionStatusCache(owner, status) {
  const ownerKey = owner?.toBase58?.() ?? String(owner ?? "");
  if (!ownerKey || !status) return;
  gameplaySessionStatusCache.set(ownerKey, { status, loadedAt: Date.now() });
}

function createLocalGameWalletStatus(owner, balanceLamports = null, expiresAt = null) {
  const ownerKey = owner?.toBase58?.() ?? String(owner ?? "");
  const normalizedBalance = Number.isFinite(balanceLamports) ? Math.floor(balanceLamports) : null;
  return {
    walletAvailable: true,
    owner: ownerKey,
    acknowledged: true,
    configuredFundingLamports: 0,
    minimumFundingLamports: 0,
    balanceLamports: normalizedBalance,
    balanceSol: normalizedBalance === null ? null : normalizedBalance / lamportsPerSol,
    publicKey: ownerKey,
    sessionAuthority: ownerKey,
    expiresAt,
    usesGameplaySession: false,
    walletMode: "localGameWallet",
  };
}

function isFreshPlayerSessionAccount(account, owner, sessionAuthority, nowSeconds) {
  if (!account?.data?.length || !account.owner?.equals?.(playerProgramId)) return false;
  const data = account.data;
  if (data.length !== playerSessionLength) return false;
  if (data.subarray(0, 8).toString("utf8") !== playerSessionMagic) return false;
  if (!data.subarray(playerSessionOwnerOffset, playerSessionOwnerOffset + 32).equals(owner.toBuffer())) return false;
  if (!data.subarray(playerSessionAuthorityOffset, playerSessionAuthorityOffset + 32).equals(sessionAuthority.toBuffer())) return false;
  const expiresAt = Number(data.readBigInt64LE(playerSessionExpiresAtOffset));
  return Number.isFinite(expiresAt) && expiresAt > nowSeconds + sessionRefreshSkewSeconds;
}

function playerSessionExpiresAt(account) {
  try {
    if (!account?.data?.length || account.data.length !== playerSessionLength) return null;
    return Number(account.data.readBigInt64LE(playerSessionExpiresAtOffset));
  } catch {
    return null;
  }
}

function accountLamports(account) {
  const value = Number(account?.lamports);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function gameplaySessionReadyKey(owner, sessionAuthority) {
  const ownerKey = owner?.toBase58?.() ?? String(owner ?? "");
  const sessionKey = sessionAuthority?.toBase58?.() ?? String(sessionAuthority ?? "");
  return ownerKey && sessionKey ? `${ownerKey}:${sessionKey}` : "";
}

function markGameplaySessionReady(owner, sessionAuthority, balanceLamports = null) {
  const key = gameplaySessionReadyKey(owner, sessionAuthority);
  if (!key) return;
  gameplaySessionReadyCache.set(key, {
    loadedAt: Date.now(),
    balanceLamports: Number.isFinite(balanceLamports) ? Math.floor(balanceLamports) : null,
  });
}

function isGameplaySessionReadyCached(owner, sessionAuthority) {
  const key = gameplaySessionReadyKey(owner, sessionAuthority);
  if (!key) return false;
  const cached = gameplaySessionReadyCache.get(key);
  return Boolean(cached && Date.now() - cached.loadedAt < gameplaySessionReadyCacheTtlMs);
}

export async function recordBlockPlacementOnChain(_target, _renderType, _toolSlot = 0) {
  return { submitted: false, reason: "chain-placement-disabled" };
}


export function blockChunkX(x) {
  return Math.floor(x / chunkSize);
}

export function blockChunkZ(z) {
  return Math.floor(z / chunkSize);
}

export function blockLocalX(x) {
  return positiveModulo(x, chunkSize);
}

export function blockLocalZ(z) {
  return positiveModulo(z, chunkSize);
}

function treeFellCandidateChunks(block) {
  const xs = [
    blockChunkX(Number(block.x) - treeFellLeafRadius),
    blockChunkX(Number(block.x) + treeFellLeafRadius),
  ];
  const zs = [
    blockChunkZ(Number(block.z) - treeFellLeafRadius),
    blockChunkZ(Number(block.z) + treeFellLeafRadius),
  ];
  const chunks = [];
  const seen = new Set();
  for (const chunkX of xs) {
    for (const chunkZ of zs) {
      const key = chunkCacheKey(chunkX, chunkZ);
      if (seen.has(key)) continue;
      seen.add(key);
      chunks.push({ chunkX, chunkZ });
    }
  }
  return chunks.slice(0, treeFellMaxChunkCount);
}

async function countUninitializedChunkBrokenAccounts(conn, chunks, context = gameContext) {
  const uniqueChunks = dedupeChunks(chunks);
  const chunksToCheck = uniqueChunks.filter((chunk) => !initializedChunkBrokenCache.has(chunkProgramCacheKey(context, chunk.chunkX, chunk.chunkZ)));
  if (!chunksToCheck.length) return 0;
  const accounts = chunksToCheck.map((chunk) => deriveChunkBrokenPdaForContext(chunk.chunkX, chunk.chunkZ, context)[0]);
  const infos = await conn.getMultipleAccountsInfo(accounts, "confirmed");
  let missingCount = 0;
  for (let index = 0; index < chunksToCheck.length; index += 1) {
    const chunk = chunksToCheck[index];
    const exists = Boolean(infos[index]?.data?.length);
    if (exists) {
      initializedChunkBrokenCache.add(chunkProgramCacheKey(context, chunk.chunkX, chunk.chunkZ));
    } else {
      missingCount += 1;
    }
  }
  return missingCount;
}

export function blockRenderTypeId(type) {
  return blockIdByRenderType.get(type) ?? EMPTY_BLOCK;
}

export function renderTypeForBlockId(blockId) {
  return renderTypeByBlockId.get(Number(blockId)) ?? null;
}

export function isTreeTrunkBlockId(blockId) {
  return Number(blockId) === WorldMapBlock.Trunk || Number(blockId) === WorldMapBlock.PineTrunk;
}

async function resolveCanonicalMinedBlock(block) {
  const config = loadCachedGlobalConfig() ?? await loadGlobalConfig({ useCache: true });
  const [{ canonicalBlockIdAt }, { resourceIdForBlock }] = await Promise.all([
    import("../world/canonicalResource.js"),
    import("../world/blocks.js"),
  ]);
  const blockId = canonicalBlockIdAt({
    config,
    x: block.x,
    y: block.y,
    z: block.z,
  });
  return {
    ...block,
    blockId,
    resourceId: resourceIdForBlock(blockId),
    type: renderTypeForBlockId(blockId) ?? block.type ?? "stone",
  };
}

async function resolveCanonicalCollapseBlocks(blocks = [], primaryKey = "") {
  const candidates = [];
  const seen = new Set([primaryKey]);
  for (const block of blocks ?? []) {
    if (candidates.length >= supportCollapseMaxOnChainBlocks) break;
    if (!Number.isFinite(block?.x) || !Number.isFinite(block?.y) || !Number.isFinite(block?.z)) continue;
    const key = minedBlockKey(block);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push(block);
  }
  const resolved = await Promise.all(candidates.map((block) => resolveCanonicalMinedBlock(block)));
  return resolved.filter((block) => isCanonicalMineableBlockId(block.blockId));
}

function minedBlockKey(block) {
  if (!Number.isFinite(block?.x) || !Number.isFinite(block?.y) || !Number.isFinite(block?.z)) return "";
  return `${Math.trunc(block.x)},${Math.trunc(block.y)},${Math.trunc(block.z)}`;
}

function supportCollapseFailureRecord(entry) {
  const error = entry?.error ?? null;
  return {
    block: entry?.block ?? null,
    reason: entry?.reason || readableErrorMessage(error),
    error,
    errorName: String(error?.name || "Error"),
    code: error?.code ?? null,
    signature: error?.signature ?? "",
    transactionError: error?.transactionError ?? null,
    logs: Array.isArray(error?.nicechunkLogs)
      ? error.nicechunkLogs
      : Array.isArray(error?.logs)
        ? error.logs
        : [],
  };
}

export function isNicechunkChainSyncEnabled() {
  return localStorage.getItem(chainSyncStorageKey) !== "0";
}

function decodeChunkBrokenDeltas(data, chunkX, chunkZ) {
  if (data.length < chunkBrokenHeaderLength) return [];
  if (data.subarray(0, 4).toString("utf8") !== chunkBrokenMagic) return [];
  const count = data.readUInt16LE(6);
  const capacity = data.readUInt16LE(8);
  const minY = data.readInt16LE(10);
  if (count > capacity || data.length !== chunkBrokenHeaderLength + capacity * chunkBrokenRecordLength) return [];

  const deltas = [];
  for (let index = 0; index < count; index += 1) {
    const offset = chunkBrokenHeaderLength + index * chunkBrokenRecordLength;
    const packed = data.readUIntLE(offset, chunkBrokenRecordLength);
    const localX = packed & 0x0f;
    const localZ = (packed >> 4) & 0x0f;
    const yOffset = (packed >> 8) & 0x01ff;
    deltas.push({
      sequence: index + 1,
      x: chunkX * chunkSize + localX,
      y: minY + yOffset,
      z: chunkZ * chunkSize + localZ,
      localX,
      localZ,
      previousBlockId: null,
      newBlockId: EMPTY_BLOCK,
      action: 1,
      toolSlot: 0,
      packed: data.subarray(offset, offset + chunkBrokenRecordLength).toString("hex"),
    });
  }
  return deltas;
}

export function decodeBackpack(data) {
  if (data.length !== backpackAccountLength) {
    throw new Error(`Invalid Backpack length: expected ${backpackAccountLength}, got ${data.length}.`);
  }
  if (data.subarray(0, 8).toString("utf8") !== backpackMagic) {
    throw new Error("Invalid Backpack magic.");
  }
  const version = data.readUInt16LE(8);
  if (version !== backpackVersion) {
    throw new Error(`Invalid Backpack version: expected ${backpackVersion}, got ${version}.`);
  }
  const capacity = data.readUInt8(52);
  const itemCount = data.readUInt8(53);
  const flags = data.readUInt8(55);
  const readableCount = Math.min(itemCount, capacity, backpackMaxCapacity);
  const records = [];
  const slots = [];
  for (let index = 0; index < readableCount; index += 1) {
    const offset = backpackHeaderLength + index * backpackSlotRecordLength;
    const slot = decodeBackpackSlot(data, offset);
    slot.index = index;
    slots.push(slot);
    if (slot.kind === "block") records.push(slot.resource);
  }
  return {
    magic: backpackMagic,
    version,
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    backpackId: data.readBigUInt64LE(12).toString(),
    owner: new PublicKey(data.subarray(20, 52)).toBase58(),
    capacity,
    itemCount,
    state: data.readUInt8(54),
    flags,
    placed: {
      x: data.readInt32LE(56),
      y: data.readInt16LE(60),
      z: data.readInt32LE(62),
    },
    createdSlot: data.readBigUInt64LE(66).toString(),
    updatedSlot: data.readBigUInt64LE(74).toString(),
    createdAt: data.readBigInt64LE(82).toString(),
    massInitialized: (flags & backpackFlagTotalMassInitialized) !== 0,
    totalMassGrams: data.readBigUInt64LE(backpackTotalMassGramsOffset).toString(),
    lastMinePreMassGrams: data.readBigUInt64LE(backpackLastMinePreMassGramsOffset).toString(),
    lastMineActionId: data.readBigUInt64LE(backpackLastMineActionIdOffset).toString(),
    mineSequence: data.readBigUInt64LE(backpackMineSequenceOffset).toString(),
    records,
    slots,
  };
}

function decodeBackpackSlot(data, offset) {
  const kindCode = data.readUInt8(offset);
  const flags = data.readUInt16LE(offset + 2);
  const resource = decodeBackpackResource(data, offset + 8);
  const itemPda = new PublicKey(data.subarray(offset + 28, offset + 60)).toBase58();
  return {
    kind: kindCode === backpackSlotKindItem ? "item" : "block",
    kindCode,
    category: data.readUInt8(offset + 1),
    flags,
    quantity: data.readUInt32LE(offset + 4),
    resource,
    itemCode: data.readUInt16LE(offset + 18),
    itemId: data.readBigUInt64LE(offset + 20).toString(),
    itemPda,
    volumeMm3: data.readUInt32LE(offset + 60),
    durabilityCurrent: data.readUInt32LE(offset + 64),
    durabilityMax: data.readUInt32LE(offset + 68),
    grade: data.readUInt8(offset + 72),
    itemLevel: data.readUInt8(offset + 73),
    qualityBps: data.readUInt16LE(offset + 74),
    metadata: data.readUInt32LE(offset + 76),
    massGrams: (flags & backpackItemFlagMassValid) !== 0
      ? (kindCode === backpackSlotKindBlock ? data.readUInt32LE(offset + 64) : data.readUInt32LE(offset + 8))
      : null,
  };
}

function decodeBackpackResource(data, offset) {
  const decodedY = decodeBackpackPackedY(data.readInt16LE(offset + 4));
  return {
    worldX: data.readInt32LE(offset),
    worldY: decodedY.worldY,
    worldZ: data.readInt32LE(offset + 6),
    blockId: decodedY.blockId,
    renderType: renderTypeForBlockId(decodedY.blockId),
  };
}

function decodeMarketListing(data) {
  if (data.length !== marketListingLength) {
    throw new Error(`Invalid MarketListing length: expected ${marketListingLength}, got ${data.length}.`);
  }
  if (data.subarray(0, 8).toString("utf8") !== marketListingMagic) {
    throw new Error("Invalid MarketListing magic.");
  }
  const sourceSlot = decodeBackpackSlot(data, marketListingSourceSlotOffset);
  const currency = marketCurrencyNames.get(data.readUInt8(52)) ?? "NCK";
  const sourceTypeCode = data.readUInt8(marketListingSourceTypeOffset);
  const source = marketSourceNames.get(sourceTypeCode) ?? "backpack";
  const priceBaseUnits = data.readBigUInt64LE(54);
  const soldSlot = data.readBigUInt64LE(198);
  const soldAt = data.readBigInt64LE(206);
  const buyerBytes = data.subarray(166, 198);
  const hasBuyer = buyerBytes.some((byte) => byte !== 0);
  return {
    magic: marketListingMagic,
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    state: data.readUInt8(11),
    stateLabel: marketStateNames.get(data.readUInt8(11)) ?? "unknown",
    seller: new PublicKey(data.subarray(12, 44)).toBase58(),
    listingId: data.readBigUInt64LE(44).toString(),
    category: marketCategoryFromBackpackSlot(sourceSlot),
    currency,
    source,
    sourceTypeCode,
    sourceIndex: data.readUInt8(53),
    quantity: Math.max(1, Number(sourceSlot.quantity) || 1),
    priceBaseUnits: priceBaseUnits.toString(),
    price: formatMarketBaseUnits(priceBaseUnits, currency),
    sourceInventory: null,
    sourceSlot,
    sourceRecord: sourceSlot.resource,
    createdSlot: data.readBigUInt64LE(142).toString(),
    updatedSlot: data.readBigUInt64LE(150).toString(),
    createdAt: data.readBigInt64LE(158).toString(),
    buyer: hasBuyer ? new PublicKey(buyerBytes).toBase58() : null,
    soldSlot: soldSlot ? soldSlot.toString() : null,
    soldAt: soldAt ? soldAt.toString() : null,
  };
}

function marketCategoryFromBackpackSlot(slot) {
  return slot?.kind === "item" ? "equipment" : "raw";
}

async function isBlockAlreadyBrokenOnChain(block) {
  const chunkX = blockChunkX(block.x);
  const chunkZ = blockChunkZ(block.z);
  try {
    const deltas = await loadChunkBlockDeltas(chunkX, chunkZ);
    return deltas.some((delta) =>
      delta.x === block.x && delta.y === block.y && delta.z === block.z
    );
  } catch (error) {
    reportRpcError(error, "already-broken-check");
    throw error;
  }
}

function decodeGlobalConfig(data) {
  if (data.length !== globalConfigLength) {
    throw new Error(`Invalid GlobalConfig length: expected ${globalConfigLength}, got ${data.length}.`);
  }
  if (data.subarray(0, 8).toString("utf8") !== globalConfigMagic) {
    throw new Error("Invalid GlobalConfig magic.");
  }
  return {
    magic: globalConfigMagic,
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    nckMint: new PublicKey(data.subarray(12, 44)).toBase58(),
    nckDecimals: data.readUInt8(44),
    nckGenesisSupply: data.readBigUInt64LE(45).toString(),
    developmentWallet: new PublicKey(data.subarray(53, 85)).toBase58(),
    worldId: data.readUInt16LE(85),
    worldSeed: Buffer.from(data.subarray(87, 119)),
    terrainConfigHash: Buffer.from(data.subarray(119, 151)).toString("hex"),
    resourceRuleHash: Buffer.from(data.subarray(151, 183)).toString("hex"),
    clientWorldConfigHash: Buffer.from(data.subarray(183, 215)).toString("hex"),
    chunkSize: data.readUInt16LE(259),
    sectionHeight: data.readUInt16LE(261),
    minBuildY: data.readInt16LE(263),
    maxBuildY: data.readInt16LE(265),
    maxTerrainHeight: data.readInt16LE(267),
    seaLevel: data.readInt16LE(269),
    guardianRegionSizeChunks: data.readUInt16LE(271),
    guardianRealtimeRadiusChunks: data.readUInt16LE(273),
    mineCooldownSlots: data.readUInt16LE(275),
    genesisSlot: data.readBigUInt64LE(277).toString(),
    createdAt: data.readBigInt64LE(285).toString(),
  };
}

function decodePlayerProfile(data) {
  if (data.length !== playerProfileLength) {
    throw new Error(`Invalid PlayerProfile length: expected ${playerProfileLength}, got ${data.length}.`);
  }
  if (data.subarray(0, 8).toString("utf8") !== "NCKPLY01") {
    throw new Error("Invalid PlayerProfile magic.");
  }
  return {
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    owner: new PublicKey(data.subarray(12, 44)).toBase58(),
    globalConfig: new PublicKey(data.subarray(44, 76)).toBase58(),
    worldId: data.readUInt16LE(76),
    position: {
      x: data.readInt32LE(78),
      y: data.readInt32LE(82),
      z: data.readInt32LE(86),
    },
    attributes: {
      health: data.readUInt16LE(90),
      energy: data.readUInt16LE(92),
      stamina: data.readUInt16LE(94),
      miningPower: data.readUInt16LE(96),
      buildPower: data.readUInt16LE(98),
      defense: data.readUInt16LE(100),
    },
    equipmentSlotCount: data.readUInt8(102),
    equipment: Array.from(
      { length: Math.min(9, data.readUInt8(102)) },
      (_, index) => new PublicKey(data.subarray(103 + index * 32, 135 + index * 32)).toBase58(),
    ),
    backpackStyle: data.readUInt8(391),
    backpackFlags: data.readUInt8(392),
    equippedBackpack: new PublicKey(data.subarray(393, 425)).toBase58(),
    createdSlot: data.readBigUInt64LE(425).toString(),
    updatedSlot: data.readBigUInt64LE(433).toString(),
    createdAt: data.readBigInt64LE(441).toString(),
    forgingXp: data.readBigUInt64LE(449).toString(),
    forgedItemCount: data.readUInt32LE(457),
    bestForgedGrade: data.readUInt8(461),
    bestForgedItemLevel: data.readUInt8(462),
    playerName: decodePlayerName(data),
    skillLevels: decodePlayerProfileSkillLevels(data),
  };
}

function decodePlayerEquipment(data) {
  if (data.length !== playerEquipmentLength) {
    throw new Error(`Invalid PlayerEquipment length: expected ${playerEquipmentLength}, got ${data.length}.`);
  }
  if (data.subarray(0, 8).toString("utf8") !== playerEquipmentMagic) {
    throw new Error("Invalid PlayerEquipment magic.");
  }
  const version = data.readUInt16LE(8);
  const slotCount = data.readUInt8(108);
  if (version !== playerEquipmentVersion || slotCount !== playerEquipmentSlotCount) {
    throw new Error(`Invalid PlayerEquipment layout: version ${version}, slots ${slotCount}.`);
  }
  const slots = [];
  for (let index = 0; index < slotCount; index += 1) {
    const offset = playerEquipmentHeaderLength + index * playerEquipmentSlotLength;
    const modelLength = data.readUInt16LE(offset + 4);
    if (modelLength > playerEquipmentModelCodeMaxBytes) {
      throw new Error(`Invalid PlayerEquipment model length at slot ${index}: ${modelLength}.`);
    }
    const backpackSlotBytes = data.subarray(offset + 40, offset + 120);
    const equipped = data.readUInt8(offset) === 1;
    const flags = data.readUInt8(offset + 3);
    slots.push({
      state: data.readUInt8(offset),
      slot: data.readUInt8(offset + 1),
      equipped,
      custodied: equipped && (flags & playerEquipmentFlagCustody) !== 0,
      backpackIndex: data.readUInt8(offset + 2),
      flags,
      backpack: new PublicKey(data.subarray(offset + 8, offset + 40)).toBase58(),
      backpackSlot: equipped ? { ...decodeBackpackSlot(backpackSlotBytes, 0), index: data.readUInt8(offset + 2) } : null,
      modelBytes: Array.from(data.subarray(offset + 120, offset + 120 + modelLength)),
    });
  }
  return {
    magic: playerEquipmentMagic,
    version,
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    owner: new PublicKey(data.subarray(12, 44)).toBase58(),
    playerProfile: new PublicKey(data.subarray(44, 76)).toBase58(),
    globalConfig: new PublicKey(data.subarray(76, 108)).toBase58(),
    slotCount,
    createdSlot: data.readBigUInt64LE(112).toString(),
    updatedSlot: data.readBigUInt64LE(120).toString(),
    slots,
  };
}

function decodeUsernameIndex(data) {
  if (data.length !== usernameIndexLength) return null;
  if (data.subarray(0, 8).toString("utf8") !== usernameIndexMagic) return null;
  const nameLength = data.readUInt16LE(usernameIndexNameLengthOffset);
  if (nameLength > 96) return null;
  return {
    magic: usernameIndexMagic,
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    owner: new PublicKey(data.subarray(usernameIndexOwnerOffset, usernameIndexOwnerOffset + 32)).toBase58(),
    playerProfile: new PublicKey(data.subarray(44, 76)).toBase58(),
    globalConfig: new PublicKey(data.subarray(76, 108)).toBase58(),
    nameHash: Buffer.from(data.subarray(usernameIndexNameHashOffset, usernameIndexNameHashOffset + 32)).toString("hex"),
    playerName: data.subarray(usernameIndexNameBytesOffset, usernameIndexNameBytesOffset + nameLength).toString("utf8"),
    createdSlot: data.readBigUInt64LE(142).toString(),
    updatedSlot: data.readBigUInt64LE(150).toString(),
  };
}

function decodeInviteIndex(data, { publicKey, inviter, pageIndex, programId } = {}) {
  if (data.length !== inviteIndexLength) return null;
  if (data.subarray(0, 8).toString("utf8") !== inviteIndexMagic) return null;
  if (data.readUInt16LE(8) !== inviteIndexVersion) return null;
  const storedInviter = new PublicKey(data.subarray(12, 44));
  if (inviter && !storedInviter.equals(inviter)) return null;
  const storedPageIndex = data.readUInt32LE(76);
  if (Number.isFinite(Number(pageIndex)) && storedPageIndex !== Number(pageIndex)) return null;
  const count = data.readUInt16LE(inviteIndexCountOffset);
  if (count > inviteIndexCapacity) return null;
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const offset = inviteIndexHeaderLength + index * inviteIndexRecordLength;
    const invited = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    entries.push({
      invitedWallet: invited,
      wallet: invited,
      pageIndex: storedPageIndex,
      index,
      createdSlot: data.readBigUInt64LE(offset + 32).toString(),
      status: "registered",
    });
  }
  return {
    magic: inviteIndexMagic,
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    inviter: storedInviter.toBase58(),
    globalConfig: new PublicKey(data.subarray(44, 76)).toBase58(),
    pageIndex: storedPageIndex,
    count,
    capacity: data.readUInt16LE(82),
    createdSlot: data.readBigUInt64LE(84).toString(),
    updatedSlot: data.readBigUInt64LE(92).toString(),
    publicKey: publicKey?.toBase58?.() ?? String(publicKey ?? ""),
    programId: programId?.toBase58?.() ?? String(programId ?? playerProgramId),
    entries,
  };
}

function decodePlayerAppearance(data) {
  if (data.length !== playerAppearanceLength) {
    throw new Error(`Invalid PlayerAppearance length: expected ${playerAppearanceLength}, got ${data.length}.`);
  }
  if (data.subarray(0, 8).toString("utf8") !== "NCKAPP01") {
    throw new Error("Invalid PlayerAppearance magic.");
  }
  const displayNameLength = data.readUInt16LE(143);
  const titleLength = data.readUInt16LE(145);
  const modelCodeLength = data.readUInt16LE(147);
  const displayNameOffset = 256;
  const titleOffset = displayNameOffset + playerNameMaxBytes;
  const modelCodeOffset = titleOffset + appearanceTitleMaxBytes;
  const equipmentOffset = modelCodeOffset + appearanceModelCodeMaxBytes;
  if (displayNameLength > playerNameMaxBytes || titleLength > appearanceTitleMaxBytes || modelCodeLength > appearanceModelCodeMaxBytes) {
    throw new Error("Invalid PlayerAppearance string length.");
  }
  const equipment = [];
  for (let index = 0; index < appearanceEquipmentSlotCount; index += 1) {
    const offset = equipmentOffset + index * appearanceEquipmentSlotLength;
    const state = data.readUInt8(offset);
    const slot = data.readUInt8(offset + 1);
    const codeLength = data.readUInt16LE(offset + 36);
    equipment.push({
      state,
      slot,
      equipped: state === 1,
      flags: data.readUInt16LE(offset + 2),
      itemPda: new PublicKey(data.subarray(offset + 4, offset + 36)).toBase58(),
      massGrams: data.readUInt32LE(offset + 38),
      gripPoint: {
        x: data.readInt16LE(offset + 42),
        y: data.readInt16LE(offset + 44),
        z: data.readInt16LE(offset + 46),
      },
      gripRotation: {
        x: data.readInt16LE(offset + 48),
        y: data.readInt16LE(offset + 50),
        z: data.readInt16LE(offset + 52),
      },
      modelCode: codeLength > 0 && codeLength <= appearanceEquipmentCodeMaxBytes
        ? data.subarray(offset + 64, offset + 64 + codeLength).toString("utf8")
        : "",
    });
  }
  return {
    magic: "NCKAPP01",
    version: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    initialized: data.readUInt8(11) === 1,
    owner: new PublicKey(data.subarray(12, 44)).toBase58(),
    playerProfile: new PublicKey(data.subarray(44, 76)).toBase58(),
    globalConfig: new PublicKey(data.subarray(76, 108)).toBase58(),
    treasuryAuthority: new PublicKey(data.subarray(108, 140)).toBase58(),
    modelKind: data.readUInt8(140),
    flags: data.readUInt16LE(141),
    displayName: data.subarray(displayNameOffset, displayNameOffset + displayNameLength).toString("utf8"),
    title: data.subarray(titleOffset, titleOffset + titleLength).toString("utf8"),
    modelCode: data.subarray(modelCodeOffset, modelCodeOffset + modelCodeLength).toString("utf8"),
    equipment,
    createdSlot: data.readBigUInt64LE(150).toString(),
    updatedSlot: data.readBigUInt64LE(158).toString(),
    createdAt: data.readBigInt64LE(166).toString(),
    updatedAt: data.readBigInt64LE(174).toString(),
  };
}

function serializeGlobalConfigForStorage(config) {
  return {
    ...config,
    worldSeed: undefined,
    worldSeedHex: Buffer.from(config.worldSeed).toString("hex"),
    loadError: undefined,
  };
}

function createInitializePlayerInstruction(authority, playerProfile, playerName = "", usernameIndex = null) {
  const { bytes } = encodePlayerName(playerName);
  if (bytes.length && !usernameIndex) throw new Error("Username index PDA is required for non-empty player names.");
  const keys = [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: playerProfile, isSigner: false, isWritable: true },
    { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  if (bytes.length) {
    keys.push({ pubkey: usernameIndex, isSigner: false, isWritable: true });
  }
  return new TransactionInstruction({
    programId: playerProgramId,
    keys,
    data: Buffer.concat([Buffer.from([0]), bytes]),
  });
}

function createSetPlayerNameInstruction({ authority, playerProfile, usernameIndex = null, playerName }) {
  const { bytes } = encodePlayerName(playerName);
  if (bytes.length && !usernameIndex) throw new Error("Username index PDA is required for non-empty player names.");
  const keys = [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: playerProfile, isSigner: false, isWritable: true },
    { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
  ];
  if (bytes.length) {
    keys.push(
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: usernameIndex, isSigner: false, isWritable: true },
    );
  }
  return new TransactionInstruction({
    programId: playerProgramId,
    keys,
    data: Buffer.concat([Buffer.from([7]), bytes]),
  });
}

function createInitializeInviteIndexPageInstruction({ payer, inviter, inviteIndex, pageIndex = 0 }) {
  const pageBytes = Buffer.alloc(4);
  pageBytes.writeUInt32LE(Math.max(0, Math.floor(Number(pageIndex) || 0)), 0);
  return new TransactionInstruction({
    programId: playerProgramId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: inviter, isSigner: false, isWritable: false },
      { pubkey: inviteIndex, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([10]), pageBytes]),
  });
}

function createAppendInviteRegistrationInstruction({
  invited,
  inviter,
  inviteIndex,
  pageIndex = 0,
  previousInviteIndex = null,
}) {
  const pageBytes = Buffer.alloc(4);
  pageBytes.writeUInt32LE(Math.max(0, Math.floor(Number(pageIndex) || 0)), 0);
  const keys = [
    { pubkey: invited, isSigner: true, isWritable: true },
    { pubkey: inviter, isSigner: false, isWritable: false },
    { pubkey: inviteIndex, isSigner: false, isWritable: true },
    { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  if (previousInviteIndex) {
    keys.push({ pubkey: previousInviteIndex, isSigner: false, isWritable: false });
  }
  return new TransactionInstruction({
    programId: playerProgramId,
    keys,
    data: Buffer.concat([Buffer.from([11]), pageBytes]),
  });
}

function createUpdatePlayerPositionInstruction({ authority, playerProfile, position }) {
  const normalized = normalizePlayerPositionForChain(position);
  const data = Buffer.alloc(13);
  data.writeUInt8(1, 0);
  data.writeInt32LE(normalized.x, 1);
  data.writeInt32LE(normalized.y, 5);
  data.writeInt32LE(normalized.z, 9);
  return new TransactionInstruction({
    programId: playerProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: playerProfile, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
    ],
    data,
  });
}

function createSetPlayerEquipmentSlotV2Instruction({
  authority,
  playerProfile,
  playerEquipment,
  slot,
  backpack = null,
  backpackIndex = 255,
  modelBytes = Buffer.alloc(0),
}) {
  const bytes = Buffer.from(modelBytes ?? []);
  const clearsSlot = backpackIndex === 255;
  if (clearsSlot && bytes.length) throw new Error("Clearing equipment cannot include model bytes.");
  if (!clearsSlot && !backpack) throw new Error("Equipping an item requires a Backpack PDA.");
  const data = Buffer.alloc(5 + bytes.length);
  data.writeUInt8(12, 0);
  data.writeUInt8(slot, 1);
  data.writeUInt8(backpackIndex, 2);
  data.writeUInt16LE(bytes.length, 3);
  bytes.copy(data, 5);
  const keys = [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: playerProfile, isSigner: false, isWritable: true },
    { pubkey: playerEquipment, isSigner: false, isWritable: true },
    { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  if (!clearsSlot) keys.push({ pubkey: backpack, isSigner: false, isWritable: false });
  return new TransactionInstruction({ programId: playerProgramId, keys, data });
}

export function createTransferPlayerEquipmentSlotInstruction({
  authority,
  playerProfile,
  playerEquipment,
  backpack,
  slot,
  backpackIndex = 255,
  modelBytes = Buffer.alloc(0),
}) {
  const bytes = Buffer.from(modelBytes ?? []);
  const clearsSlot = backpackIndex === 255;
  if (clearsSlot && bytes.length) throw new Error("Clearing equipment cannot include model bytes.");
  if (bytes.length > playerEquipmentModelCodeMaxBytes) {
    throw new Error(`Equipment model is too large: max ${playerEquipmentModelCodeMaxBytes} bytes.`);
  }
  const data = Buffer.alloc(5 + bytes.length);
  data.writeUInt8(13, 0);
  data.writeUInt8(slot, 1);
  data.writeUInt8(backpackIndex, 2);
  data.writeUInt16LE(bytes.length, 3);
  bytes.copy(data, 5);
  const [materialPhysics] = deriveMaterialPhysicsPda(gameContext.backpackProgramId);
  return new TransactionInstruction({
    programId: playerProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: true },
      { pubkey: playerEquipment, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: materialPhysics, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: backpack, isSigner: false, isWritable: true },
      { pubkey: gameProgramId, isSigner: false, isWritable: false },
      { pubkey: deriveEquipmentTransferAuthorityPda()[0], isSigner: false, isWritable: false },
    ],
    data,
  });
}

function createSwapPlayerEquipmentSlotsInstruction({
  authority,
  playerProfile,
  playerEquipment,
  fromSlot,
  toSlot,
}) {
  if (fromSlot === toSlot) throw new Error("Equipment swap requires two different slots.");
  return new TransactionInstruction({
    programId: playerProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: playerProfile, isSigner: false, isWritable: true },
      { pubkey: playerEquipment, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
    ],
    data: Buffer.from([14, fromSlot, toSlot]),
  });
}

function maybeAddPlayerPositionUpdateInstruction(tx, { provider, session, position } = {}) {
  if (!tx || !provider?.publicKey || !session?.keypair?.publicKey || !position) return false;
  if (!session.keypair.publicKey.equals(provider.publicKey)) return false;
  const [playerProfile] = derivePlayerProfilePda(provider.publicKey);
  tx.add(createUpdatePlayerPositionInstruction({
    authority: provider.publicKey,
    playerProfile,
    position,
  }));
  return true;
}

function playerPositionForResourceMine(block, options = {}) {
  const resourceId = Math.trunc(Number(block?.resourceId));
  if (!Number.isFinite(resourceId) || resourceId <= 0) return null;
  return options.playerPosition ?? null;
}

async function resolvePlayerPositionMinedResourceBlock(block) {
  const normalized = normalizeMinedBlockForPlayerPosition(block);
  if (!normalized) return { block: null, reason: "resource-mine-block-required" };
  const canonicalBlock = await resolveCanonicalMinedBlock(normalized);
  const resourceId = Math.trunc(Number(canonicalBlock?.resourceId));
  return Number.isFinite(resourceId) && resourceId > 0
    ? { block: canonicalBlock, reason: "" }
    : { block: null, reason: "non-resource-mine" };
}

function normalizeMinedBlockForPlayerPosition(block) {
  const x = Math.trunc(Number(block?.x ?? block?.worldX));
  const y = Math.trunc(Number(block?.y ?? block?.worldY));
  const z = Math.trunc(Number(block?.z ?? block?.worldZ));
  if (![x, y, z].every(Number.isFinite)) return null;
  return {
    x,
    y,
    z,
    blockId: safeTrunc(block?.blockId),
    resourceId: safeTrunc(block?.resourceId),
    key: `${x},${y},${z}`,
  };
}

function safeTrunc(value, fallback = 0) {
  const normalized = Math.trunc(Number(value));
  return Number.isFinite(normalized) ? normalized : fallback;
}

function normalizePlayerPositionForChain(position) {
  const x = Math.round(Number(position?.x));
  const y = Math.round(Number(position?.y));
  const z = Math.round(Number(position?.z));
  if (![x, y, z].every(Number.isFinite)) throw new Error("Invalid player position.");
  return { x, y, z };
}

function createUpsertPlayerAppearanceInstruction({
  authority,
  playerProfile,
  appearance,
  usernameIndex,
  modelKind,
  playerNameBytes,
  titleBytes = Buffer.alloc(0),
  codeBytes,
}) {
  const name = Buffer.from(playerNameBytes || []);
  const title = Buffer.from(titleBytes || []);
  const code = Buffer.from(codeBytes || []);
  if (!name.length || name.length > playerNameMaxBytes) throw new Error("Invalid player appearance name.");
  if (!usernameIndex) throw new Error("Username index PDA is required.");
  if (title.length > appearanceTitleMaxBytes) throw new Error("Invalid player appearance title.");
  if (!code.length || code.length > appearanceModelCodeMaxBytes) throw new Error("Invalid player appearance model code.");
  const header = Buffer.alloc(8);
  header.writeUInt8(8, 0);
  header.writeUInt8(Number(modelKind) === 2 ? 2 : 1, 1);
  header.writeUInt16LE(name.length, 2);
  header.writeUInt16LE(title.length, 4);
  header.writeUInt16LE(code.length, 6);
  return new TransactionInstruction({
    programId: playerProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: true },
      { pubkey: appearance, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: usernameIndex, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([header, name, title, code]),
  });
}

function encodePlayerName(playerName) {
  const normalized = String(playerName ?? "").trim();
  if (Array.from(normalized).length > playerNameMaxChars) {
    throw new Error(`Player name is too long: max ${playerNameMaxChars} characters.`);
  }
  if (!/^[\p{Script=Han}A-Za-z0-9_]*$/u.test(normalized)) {
    throw new Error("Player name contains unsupported characters.");
  }
  const bytes = Buffer.from(normalized, "utf8");
  if (bytes.length > playerNameMaxBytes) {
    throw new Error(`Player name is too large: max ${playerNameMaxBytes} UTF-8 bytes.`);
  }
  return { normalized, bytes };
}

async function canonicalPlayerNameHash(playerName) {
  const { normalized } = encodePlayerName(playerName);
  const canonical = normalized.replace(/[A-Z]/g, (char) => char.toLowerCase());
  const bytes = Buffer.from(canonical, "utf8");
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto SHA-256 is unavailable.");
  const digest = await subtle.digest("SHA-256", bytes);
  return Buffer.from(new Uint8Array(digest));
}

function decodePlayerName(data) {
  const length = data.readUInt16LE(playerNameLengthOffset);
  if (length <= 0 || length > playerNameMaxBytes) return "";
  return data.subarray(playerNameBytesOffset, playerNameBytesOffset + length).toString("utf8");
}

function storedPlayerName() {
  try {
    return localStorage.getItem("nicechunk.username") || "";
  } catch {
    return "";
  }
}

function createSetEquippedBackpackInstruction({ authority, playerProfile, backpack }) {
  return new TransactionInstruction({
    programId: playerProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: true },
      { pubkey: backpack, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([5]),
  });
}

function createOrRefreshPlayerSessionInstruction({
  owner,
  sessionAuthority,
  playerProfile,
  playerSession,
  expiresAt,
}) {
  const data = Buffer.alloc(15);
  data.writeUInt8(4, 0);
  data.writeBigInt64LE(BigInt(expiresAt), 1);
  data.writeUInt16LE(sessionAllowedActions, 9);
  data.writeUInt32LE(sessionMaxActions, 11);

  return new TransactionInstruction({
    programId: playerProgramId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: sessionAuthority, isSigner: true, isWritable: false },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function createMineBlockInstruction({ authority, block, owner, expectedBlockId, context = gameContext }) {
  if (!owner) throw new Error("owner is required for canonical mining");
  if (!Number.isInteger(expectedBlockId)) throw new Error("expectedBlockId is required for canonical mining");
  const [chunkBrokenPda] = deriveChunkBrokenPdaForContext(blockChunkX(block.x), blockChunkZ(block.z), context);
  const [foundationChunkPda] = deriveFoundationChunkPdaForContext(blockChunkX(block.x), blockChunkZ(block.z), context);
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const data = Buffer.alloc(13);
  data.writeUInt8(5, 0);
  data.writeInt32LE(block.x, 1);
  data.writeInt16LE(block.y, 5);
  data.writeInt32LE(block.z, 7);
  data.writeUInt16LE(expectedBlockId, 11);

  return new TransactionInstruction({
    programId: context.chunkProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: chunkBrokenPda, isSigner: false, isWritable: true },
      { pubkey: foundationChunkPda, isSigner: false, isWritable: false },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceChunk, data),
  });
}

export function createMineBlockWithRewardsInstruction({ authority, block, owner, backpack, expectedBlockId, context = gameContext }) {
  if (!owner) throw new Error("owner is required for canonical mining");
  if (!backpack) throw new Error("backpack is required for reward mining");
  if (!Number.isInteger(expectedBlockId)) throw new Error("expectedBlockId is required for canonical mining");
  const [chunkBrokenPda] = deriveChunkBrokenPdaForContext(blockChunkX(block.x), blockChunkZ(block.z), context);
  const [foundationChunkPda] = deriveFoundationChunkPdaForContext(blockChunkX(block.x), blockChunkZ(block.z), context);
  const [resourceDropTable] = deriveResourceDropTablePdaForContext(context);
  const [surfaceDecorationTable] = deriveSurfaceDecorationTablePdaForContext(context);
  const [materialPhysics] = deriveMaterialPhysicsPda(context.backpackProgramId);
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [playerProgress] = derivePlayerProgressPdaForContext(owner, context);
  const data = Buffer.alloc(13);
  data.writeUInt8(8, 0);
  data.writeInt32LE(block.x, 1);
  data.writeInt16LE(block.y, 5);
  data.writeInt32LE(block.z, 7);
  data.writeUInt16LE(expectedBlockId, 11);

  return new TransactionInstruction({
    programId: context.chunkProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: playerProgress, isSigner: false, isWritable: true },
      { pubkey: chunkBrokenPda, isSigner: false, isWritable: true },
      { pubkey: foundationChunkPda, isSigner: false, isWritable: false },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: resourceDropTable, isSigner: false, isWritable: false },
      { pubkey: surfaceDecorationTable, isSigner: false, isWritable: false },
      { pubkey: context.backpackProgramId, isSigner: false, isWritable: false },
      { pubkey: backpack, isSigner: false, isWritable: true },
      { pubkey: materialPhysics, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceChunk, data),
  });
}

export function createBatchMineWithRewardsInstruction({
  authority,
  blocks,
  owner,
  backpack,
  mode = bulkMiningModeDebug,
  context = gameContext,
}) {
  if (!owner) throw new Error("owner is required for batch mining");
  if (!backpack) throw new Error("backpack is required for batch mining");
  if (mode !== bulkMiningModeDebug) throw new Error("unsupported batch mining mode");
  if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > BULK_MINING_BATCH_SIZE) {
    throw new Error(`batch mining requires 1-${BULK_MINING_BATCH_SIZE} blocks`);
  }
  const chunkX = blockChunkX(blocks[0].x);
  const chunkZ = blockChunkZ(blocks[0].z);
  for (const block of blocks) {
    if (!Number.isInteger(block?.blockId)) throw new Error("canonical blockId is required for batch mining");
    if (blockChunkX(block.x) !== chunkX || blockChunkZ(block.z) !== chunkZ) {
      throw new Error("all batch mining blocks must belong to one chunk");
    }
  }

  const [chunkBrokenPda] = deriveChunkBrokenPdaForContext(chunkX, chunkZ, context);
  const [foundationChunkPda] = deriveFoundationChunkPdaForContext(chunkX, chunkZ, context);
  const [resourceDropTable] = deriveResourceDropTablePdaForContext(context);
  const [surfaceDecorationTable] = deriveSurfaceDecorationTablePdaForContext(context);
  const [materialPhysics] = deriveMaterialPhysicsPda(context.backpackProgramId);
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [playerProgress] = derivePlayerProgressPdaForContext(owner, context);
  const data = Buffer.alloc(3 + blocks.length * 12);
  data.writeUInt8(20, 0);
  data.writeUInt8(mode, 1);
  data.writeUInt8(blocks.length, 2);
  blocks.forEach((block, index) => {
    const offset = 3 + index * 12;
    data.writeInt32LE(Math.trunc(block.x), offset);
    data.writeInt16LE(Math.trunc(block.y), offset + 4);
    data.writeInt32LE(Math.trunc(block.z), offset + 6);
    data.writeUInt16LE(Math.trunc(block.blockId), offset + 10);
  });

  return new TransactionInstruction({
    programId: context.chunkProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: playerProgress, isSigner: false, isWritable: true },
      { pubkey: chunkBrokenPda, isSigner: false, isWritable: true },
      { pubkey: foundationChunkPda, isSigner: false, isWritable: false },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: resourceDropTable, isSigner: false, isWritable: false },
      { pubkey: surfaceDecorationTable, isSigner: false, isWritable: false },
      { pubkey: context.backpackProgramId, isSigner: false, isWritable: false },
      { pubkey: backpack, isSigner: false, isWritable: true },
      { pubkey: materialPhysics, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceChunk, data),
  });
}

export function createRangeMineWithRewardsInstruction({
  authority,
  range,
  owner,
  backpack,
  mode = BULK_MINING_RANGE_MODE_DEBUG,
  context = gameContext,
}) {
  if (!owner) throw new Error("owner is required for range mining");
  if (!backpack) throw new Error("backpack is required for range mining");
  if (mode !== BULK_MINING_RANGE_MODE_DEBUG) throw new Error("unsupported range mining mode");
  const payload = encodeBulkMiningRangePayload(range, { mode });
  const data = Buffer.alloc(1 + payload.length);
  data.writeUInt8(21, 0);
  Buffer.from(payload).copy(data, 1);

  const chunkX = Math.trunc(Number(range?.chunkX));
  const chunkZ = Math.trunc(Number(range?.chunkZ));
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ)) {
    throw new Error("range mining requires one canonical chunk");
  }
  for (const block of range.blocks ?? []) {
    if (blockChunkX(block.x) !== chunkX || blockChunkZ(block.z) !== chunkZ) {
      throw new Error("all range mining blocks must belong to one chunk");
    }
  }

  const [chunkBrokenPda] = deriveChunkBrokenPdaForContext(chunkX, chunkZ, context);
  const [foundationChunkPda] = deriveFoundationChunkPdaForContext(chunkX, chunkZ, context);
  const [resourceDropTable] = deriveResourceDropTablePdaForContext(context);
  const [surfaceDecorationTable] = deriveSurfaceDecorationTablePdaForContext(context);
  const [materialPhysics] = deriveMaterialPhysicsPda(context.backpackProgramId);
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [playerProgress] = derivePlayerProgressPdaForContext(owner, context);

  return new TransactionInstruction({
    programId: context.chunkProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: playerProgress, isSigner: false, isWritable: true },
      { pubkey: chunkBrokenPda, isSigner: false, isWritable: true },
      { pubkey: foundationChunkPda, isSigner: false, isWritable: false },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: resourceDropTable, isSigner: false, isWritable: false },
      { pubkey: surfaceDecorationTable, isSigner: false, isWritable: false },
      { pubkey: context.backpackProgramId, isSigner: false, isWritable: false },
      { pubkey: backpack, isSigner: false, isWritable: true },
      { pubkey: materialPhysics, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceChunk, data),
  });
}

function createBuildSiteInstruction({ authority, owner, foundationId, foundation, context = gameContext }) {
  const normalized = normalizeFoundationInput(foundation);
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [buildSite] = deriveBuildSitePdaForContext(foundationId, context);
  const data = Buffer.alloc(27);
  data.writeUInt8(0, 0);
  data.writeBigUInt64LE(BigInt.asUintN(64, BigInt(foundationId)), 1);
  data.writeInt32LE(normalized.minX, 9);
  data.writeInt16LE(normalized.surfaceY, 13);
  data.writeInt32LE(normalized.minZ, 15);
  data.writeUInt32LE(normalized.width, 19);
  data.writeUInt32LE(normalized.depth, 23);
  return new TransactionInstruction({
    programId: context.buildingProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: buildSite, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function createMigrateLegacyBuildSiteInstruction({ authority, owner, foundationId, context = gameContext }) {
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [buildSite] = deriveBuildSitePdaForContext(foundationId, context);
  const [legacyBuildSite] = deriveBuildSitePdaForProgram(foundationId, context.chunkProgramId);
  const data = Buffer.alloc(9);
  data.writeUInt8(6, 0);
  data.writeBigUInt64LE(BigInt.asUintN(64, BigInt(foundationId)), 1);
  return new TransactionInstruction({
    programId: context.buildingProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: buildSite, isSigner: false, isWritable: true },
      { pubkey: legacyBuildSite, isSigner: false, isWritable: false },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function createResizeBuildSiteInstruction({ authority, owner, foundation, width, depth, context = gameContext }) {
  const foundationId = requireBlueprintFoundationId(foundation?.foundationId);
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [buildSite] = deriveBuildSitePdaForContext(foundationId, context);
  const data = Buffer.alloc(17);
  data.writeUInt8(7, 0);
  data.writeBigUInt64LE(foundationId, 1);
  data.writeUInt32LE(width, 9);
  data.writeUInt32LE(depth, 13);
  const keys = [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: playerProfile, isSigner: false, isWritable: false },
    { pubkey: playerSession, isSigner: false, isWritable: false },
    { pubkey: buildSite, isSigner: false, isWritable: true },
    { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  if (foundation.activeRevision > 0) {
    keys.push({
      pubkey: deriveBuildingManifestPdaForContext(foundationId, foundation.activeRevision, context)[0],
      isSigner: false,
      isWritable: false,
    });
  }
  return new TransactionInstruction({ programId: context.buildingProgramId, keys, data });
}

function createRegisterBuildSiteChunksInstruction({ authority, owner, foundation, context = gameContext }) {
  const batch = foundationIndexBatch(foundation, 4);
  if (!batch.length) throw new Error("BuildSite has no remaining Chunk index work.");
  const foundationId = requireBlueprintFoundationId(foundation.foundationId);
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [buildSite] = deriveBuildSitePdaForContext(foundationId, context);
  const [chunkAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from(buildingChunkAuthoritySeed), deriveGlobalConfigPda().toBuffer()],
    context.buildingProgramId,
  );
  const data = Buffer.alloc(9);
  data.writeUInt8(1, 0);
  data.writeBigUInt64LE(foundationId, 1);
  return new TransactionInstruction({
    programId: context.buildingProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: buildSite, isSigner: false, isWritable: true },
      { pubkey: chunkAuthority, isSigner: false, isWritable: false },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: context.chunkProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...batch.map(({ chunkX, chunkZ }) => ({
        pubkey: deriveFoundationChunkPdaForContext(chunkX, chunkZ, context)[0],
        isSigner: false,
        isWritable: true,
      })),
    ],
    data,
  });
}

function createBeginBuildingInstruction({
  authority,
  owner,
  foundationId,
  revision,
  quarterTurns,
  payloadLen,
  expectedHash,
  offsetX,
  offsetZ,
  context = gameContext,
}) {
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [buildSite] = deriveBuildSitePdaForContext(foundationId, context);
  const [manifest] = deriveBuildingManifestPdaForContext(foundationId, revision, context);
  const data = encodeBeginBuildingInstructionData({
    foundationId,
    revision,
    quarterTurns,
    payloadLen,
    expectedHash,
    offsetX,
    offsetZ,
  });
  return new TransactionInstruction({
    programId: context.buildingProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: buildSite, isSigner: false, isWritable: true },
      { pubkey: manifest, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function encodeBeginBuildingInstructionData({
  foundationId,
  revision,
  quarterTurns,
  payloadLen,
  expectedHash,
  offsetX = 0,
  offsetZ = 0,
}) {
  const turns = Number(quarterTurns);
  if (!Number.isInteger(turns) || turns < 0 || turns > 3) {
    throw new Error("Invalid building rotation.");
  }
  const length = Math.trunc(Number(payloadLen));
  buildingShardCount(length);
  const hash = Buffer.from(expectedHash ?? []);
  if (hash.length !== 32) throw new Error("Invalid building content hash.");
  const data = Buffer.alloc(58);
  data.writeUInt8(2, 0);
  data.writeBigUInt64LE(requireBlueprintFoundationId(foundationId), 1);
  data.writeUInt32LE(normalizeBuildingRevision(revision), 9);
  data.writeUInt8(turns, 13);
  data.writeUInt32LE(length, 14);
  hash.copy(data, 18);
  data.writeInt32LE(normalizeBuildingOffset(offsetX), 50);
  data.writeInt32LE(normalizeBuildingOffset(offsetZ), 54);
  return data;
}

function createWriteBuildingShardInstruction({
  authority,
  owner,
  foundationId,
  revision,
  shardIndex,
  offset,
  bytes,
  context = gameContext,
}) {
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [buildSite] = deriveBuildSitePdaForContext(foundationId, context);
  const [manifest] = deriveBuildingManifestPdaForContext(foundationId, revision, context);
  const [shard] = deriveBuildingShardPdaForContext(foundationId, revision, shardIndex, context);
  const payload = Buffer.from(bytes);
  if (!payload.length || payload.length > BUILDING_MAX_WRITE_LENGTH) throw new Error("Invalid building write length.");
  const data = Buffer.alloc(16 + payload.length);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(BigInt.asUintN(64, BigInt(foundationId)), 1);
  data.writeUInt32LE(normalizeBuildingRevision(revision), 9);
  data.writeUInt8(shardIndex, 13);
  data.writeUInt16LE(offset, 14);
  payload.copy(data, 16);
  return new TransactionInstruction({
    programId: context.buildingProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: buildSite, isSigner: false, isWritable: false },
      { pubkey: manifest, isSigner: false, isWritable: true },
      { pubkey: shard, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function createFinalizeBuildingInstruction({
  authority,
  owner,
  foundationId,
  revision,
  shardCount,
  context = gameContext,
}) {
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [buildSite] = deriveBuildSitePdaForContext(foundationId, context);
  const [manifest] = deriveBuildingManifestPdaForContext(foundationId, revision, context);
  const data = Buffer.alloc(13);
  data.writeUInt8(4, 0);
  data.writeBigUInt64LE(BigInt.asUintN(64, BigInt(foundationId)), 1);
  data.writeUInt32LE(normalizeBuildingRevision(revision), 9);
  return new TransactionInstruction({
    programId: context.buildingProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: buildSite, isSigner: false, isWritable: true },
      { pubkey: manifest, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...Array.from({ length: shardCount }, (_unused, shardIndex) => ({
        pubkey: deriveBuildingShardPdaForContext(foundationId, revision, shardIndex, context)[0],
        isSigner: false,
        isWritable: false,
      })),
    ],
    data,
  });
}

function createCancelBuildingUploadInstruction({
  authority,
  owner,
  foundationId,
  revision,
  shardCount,
  context = gameContext,
}) {
  const safeShardCount = Math.max(1, Math.min(
    Math.ceil(buildingMaxPayloadLength / buildingShardPayloadLength),
    Math.trunc(Number(shardCount) || 0),
  ));
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [buildSite] = deriveBuildSitePdaForContext(foundationId, context);
  const [manifest] = deriveBuildingManifestPdaForContext(foundationId, revision, context);
  const data = Buffer.alloc(13);
  data.writeUInt8(5, 0);
  data.writeBigUInt64LE(BigInt.asUintN(64, BigInt(foundationId)), 1);
  data.writeUInt32LE(normalizeBuildingRevision(revision), 9);
  return new TransactionInstruction({
    programId: context.buildingProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: buildSite, isSigner: false, isWritable: true },
      { pubkey: manifest, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...Array.from({ length: safeShardCount }, (_unused, shardIndex) => ({
        pubkey: deriveBuildingShardPdaForContext(foundationId, revision, shardIndex, context)[0],
        isSigner: false,
        isWritable: true,
      })),
    ],
    data,
  });
}

function foundationIndexBatch(foundation, limit = 4) {
  const status = String(foundation?.status || "");
  if (status === "active") return [];
  const registered = BigInt(foundation?.registeredChunks ?? 0);
  const total = BigInt(foundation?.totalChunks ?? 0);
  if (registered < 0n || total <= registered) return [];
  const count = Number((total - registered) < BigInt(limit) ? total - registered : BigInt(limit));
  const active = normalizeFoundationInput(foundation);
  let at;
  if (status === "indexing") {
    at = (index) => foundationChunkAt(active, index);
  } else if (status === "edit-indexing") {
    const staged = normalizeFoundationInput({
      ...active,
      width: foundation.stagedWidth,
      depth: foundation.stagedDepth,
    });
    at = (index) => foundationChunkAt(staged, index);
  } else if (status === "edit-cleaning") {
    const previous = normalizeFoundationInput({
      ...active,
      width: foundation.stagedWidth,
      depth: foundation.stagedDepth,
    });
    at = (index) => foundationChunkDifferenceAt(previous, active, index);
  } else {
    throw new Error(`Unsupported BuildSite indexing status: ${status || "unknown"}.`);
  }
  return Array.from({ length: count }, (_unused, offset) => at(registered + BigInt(offset)));
}

function foundationChunkAt(foundation, index) {
  const span = foundationChunkSpan(foundation);
  const offset = BigInt(index);
  const total = BigInt(span.spanX) * BigInt(span.spanZ);
  if (offset < 0n || offset >= total) throw new Error("Invalid BuildSite Chunk index.");
  return {
    chunkX: span.minChunkX + Number(offset % BigInt(span.spanX)),
    chunkZ: span.minChunkZ + Number(offset / BigInt(span.spanX)),
  };
}

function foundationChunkDifferenceAt(previous, next, index) {
  const oldSpan = foundationChunkSpan(previous);
  const newSpan = foundationChunkSpan(next);
  if (oldSpan.minChunkX !== newSpan.minChunkX || oldSpan.minChunkZ !== newSpan.minChunkZ) {
    throw new Error("BuildSite resize cannot move its anchor.");
  }
  const oldX = BigInt(oldSpan.spanX);
  const oldZ = BigInt(oldSpan.spanZ);
  const newX = BigInt(newSpan.spanX);
  const newZ = BigInt(newSpan.spanZ);
  const commonRows = oldZ < newZ ? oldZ : newZ;
  const rightWidth = oldX > newX ? oldX - newX : 0n;
  const rightCount = commonRows * rightWidth;
  const total = oldX * oldZ - (oldX < newX ? oldX : newX) * commonRows;
  const offset = BigInt(index);
  if (offset < 0n || offset >= total) throw new Error("Invalid BuildSite cleanup index.");
  let xOffset;
  let zOffset;
  if (offset < rightCount) {
    xOffset = newX + offset % rightWidth;
    zOffset = offset / rightWidth;
  } else {
    const remaining = offset - rightCount;
    xOffset = remaining % oldX;
    zOffset = newZ + remaining / oldX;
  }
  return {
    chunkX: oldSpan.minChunkX + Number(xOffset),
    chunkZ: oldSpan.minChunkZ + Number(zOffset),
  };
}

function foundationChunkSpan(foundation) {
  const normalized = normalizeFoundationInput(foundation);
  const minChunkX = Math.floor(normalized.minX / chunkSize);
  const maxChunkX = Math.floor((normalized.minX + normalized.width - 1) / chunkSize);
  const minChunkZ = Math.floor(normalized.minZ / chunkSize);
  const maxChunkZ = Math.floor((normalized.minZ + normalized.depth - 1) / chunkSize);
  return {
    minChunkX,
    minChunkZ,
    spanX: maxChunkX - minChunkX + 1,
    spanZ: maxChunkZ - minChunkZ + 1,
  };
}

function normalizeBuildingRevision(value, { allowZero = false } = {}) {
  const revision = Math.trunc(Number(value));
  if (!Number.isInteger(revision) || revision < (allowZero ? 0 : 1) || revision > 0xffffffff) {
    throw new Error("Invalid building revision.");
  }
  return revision;
}

function normalizeBuildingOffset(value) {
  const offset = value == null || value === "" ? 0 : Number(value);
  if (!Number.isInteger(offset) || offset < -0x80000000 || offset > 0x7fffffff) {
    throw new Error("Invalid building offset.");
  }
  return offset;
}

function buildingShardCount(payloadLen) {
  const length = Math.trunc(Number(payloadLen));
  if (!Number.isInteger(length) || length < 1 || length > buildingMaxPayloadLength) {
    throw new Error("Invalid building payload length.");
  }
  return Math.ceil(length / buildingShardPayloadLength);
}

function decodeNcm3Payload(code) {
  if (!String(code).startsWith("NCM3:")) throw new Error("Expected an NCM3 building code.");
  const encoded = String(code).slice(5).replace(/-/g, "+").replace(/_/g, "/");
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function base64UrlEncode(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildingCacheKey(foundation) {
  return `${buildingProgramForFoundation(foundation, gameContext).toBase58()}:${String(foundation?.foundationId ?? "0")}:${Math.max(0, Math.trunc(Number(foundation?.activeRevision) || 0))}`;
}

function buildingProgramForFoundation(foundation, context = gameContext) {
  const value = String(foundation?.programId || "").trim();
  if (!value) return context.buildingProgramId;
  try {
    return new PublicKey(value);
  } catch {
    throw new Error("Invalid BuildSite program ID.");
  }
}

function cacheBuildingPayload(key, building) {
  buildingPayloadCache.delete(key);
  buildingPayloadCache.set(key, building);
  while (buildingPayloadCache.size > buildingPayloadCacheLimit) {
    buildingPayloadCache.delete(buildingPayloadCache.keys().next().value);
  }
}

async function sha256Buffer(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable.");
  const source = Buffer.from(bytes);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
  );
  return Buffer.from(digest);
}

async function getMultipleAccountsInfoBatched(conn, addresses, batchSize = 100) {
  const result = [];
  const size = Math.max(1, Math.min(100, Math.trunc(Number(batchSize) || 100)));
  for (let start = 0; start < addresses.length; start += size) {
    const batch = addresses.slice(start, start + size);
    result.push(...await conn.getMultipleAccountsInfo(batch, "confirmed"));
  }
  return result;
}

async function fundBuildingUploadSession(provider, sessionAuthority, accountLengths, conn) {
  if (provider.publicKey.equals(sessionAuthority)) return;
  const lengths = (accountLengths ?? []).map((value) => Math.max(0, Math.trunc(Number(value) || 0))).filter(Boolean);
  const uniqueLengths = [...new Set(lengths)];
  const rentValues = await Promise.all(uniqueLengths.map((length) => conn.getMinimumBalanceForRentExemption(length)));
  const rentByLength = new Map(uniqueLengths.map((length, index) => [length, rentValues[index]]));
  const required = lengths.reduce((sum, length) => sum + (rentByLength.get(length) || 0), 0) + 1_000_000;
  const balance = await conn.getBalance(sessionAuthority, "confirmed");
  if (balance >= required) return;
  const transaction = new Transaction().add(SystemProgram.transfer({
    fromPubkey: provider.publicKey,
    toPubkey: sessionAuthority,
    lamports: required - balance,
  }));
  await signAndSendWalletTransaction(provider, transaction, conn);
}

export function createFellTreeWithRewardsInstruction({ authority, block, owner, backpack, expectedBlockId, chunks = [], context = gameContext }) {
  if (!owner) throw new Error("owner is required for tree felling");
  if (!backpack) throw new Error("backpack is required for tree felling");
  if (!Number.isInteger(expectedBlockId)) throw new Error("expectedBlockId is required for tree felling");
  const normalizedChunks = Array.isArray(chunks) ? chunks.slice(0, treeFellMaxChunkCount) : [];
  if (!normalizedChunks.length) throw new Error("at least one chunk is required for tree felling");
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, authority);
  const [playerProgress] = derivePlayerProgressPdaForContext(owner, context);
  const [materialPhysics] = deriveMaterialPhysicsPda(context.backpackProgramId);
  const data = Buffer.alloc(13);
  data.writeUInt8(9, 0);
  data.writeInt32LE(block.x, 1);
  data.writeInt16LE(block.y, 5);
  data.writeInt32LE(block.z, 7);
  data.writeUInt16LE(expectedBlockId, 11);

  return new TransactionInstruction({
    programId: context.chunkProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: playerSession, isSigner: false, isWritable: false },
      { pubkey: playerProgress, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: context.backpackProgramId, isSigner: false, isWritable: false },
      { pubkey: backpack, isSigner: false, isWritable: true },
      { pubkey: materialPhysics, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...normalizedChunks.map((chunk) => ({
        pubkey: deriveChunkBrokenPdaForContext(chunk.chunkX, chunk.chunkZ, context)[0],
        isSigner: false,
        isWritable: true,
      })),
    ],
    data: contextInstructionData(context, gameNamespaceChunk, data),
  });
}

function createInitializeChunkBrokenInstruction({ authority, chunkX, chunkZ, context = gameContext }) {
  const [chunkBrokenPda] = deriveChunkBrokenPdaForContext(chunkX, chunkZ, context);
  const data = Buffer.alloc(9);
  data.writeUInt8(6, 0);
  data.writeInt32LE(chunkX, 1);
  data.writeInt32LE(chunkZ, 5);

  return new TransactionInstruction({
    programId: context.chunkProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: chunkBrokenPda, isSigner: false, isWritable: true },
      { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceChunk, data),
  });
}

function createInitializeBackpackInstruction({ owner, playerProfile, backpack, backpackId, capacity = backpackDefaultCapacity, context = gameContext }) {
  const data = Buffer.alloc(10);
  data.writeUInt8(0, 0);
  data.writeBigUInt64LE(BigInt(backpackId), 1);
  data.writeUInt8(capacity, 9);
  return new TransactionInstruction({
    programId: context.backpackProgramId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: false },
      { pubkey: backpack, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceBackpack, data),
  });
}

export function createMigrateBackpackMassInstruction({ owner, backpack, context = gameContext }) {
  const globalConfig = deriveGlobalConfigPda();
  const [materialPhysics] = deriveMaterialPhysicsPda(context.backpackProgramId);
  return new TransactionInstruction({
    programId: context.backpackProgramId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: backpack, isSigner: false, isWritable: true },
      { pubkey: materialPhysics, isSigner: false, isWritable: false },
      { pubkey: globalConfig, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceBackpack, Buffer.from([14])),
  });
}

function createForgeEquipmentVerifiedInstruction({
  owner,
  backpack,
  itemId,
  codeBytes,
  inputIndexes = [],
  context = gameContext,
}) {
  const indexes = normalizeBackpackIndexes(inputIndexes);
  if (!indexes.length) throw new Error("material indexes are required for equipment forging");
  if (indexes.length > 24) throw new Error("too many material indexes for equipment forging");
  const canonicalBytes = codeBytes instanceof Uint8Array ? codeBytes : Uint8Array.from(codeBytes ?? []);
  if (!canonicalBytes.length || canonicalBytes.length > verifiedForgeCodeMaxRawLength) {
    throw new Error("valid canonical forge bytes are required for verified equipment forging");
  }
  const [playerProfile] = derivePlayerProfilePda(owner);
  const data = Buffer.alloc(12 + canonicalBytes.length + indexes.length);
  data.writeUInt8(8, 0);
  data.writeBigUInt64LE(BigInt(itemId), 1);
  data.writeUInt16LE(canonicalBytes.length, 9);
  data.writeUInt8(indexes.length, 11);
  Buffer.from(canonicalBytes).copy(data, 12);
  indexes.forEach((index, offset) => data.writeUInt8(index, 12 + canonicalBytes.length + offset));
  return new TransactionInstruction({
    programId: context.backpackProgramId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: playerProfile, isSigner: false, isWritable: true },
      { pubkey: backpack, isSigner: false, isWritable: true },
      { pubkey: playerProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceBackpack, data),
  });
}

function encodeBackpackPackedY(worldY, blockId) {
  const y = Number(worldY);
  const id = Number(blockId);
  const yOffset = y - minBuildY;
  if (
    Number.isInteger(y) &&
    Number.isInteger(yOffset) &&
    yOffset >= 0 &&
    yOffset <= backpackPackedYMask &&
    Number.isInteger(id) &&
    id > 0 &&
    id < (1 << (16 - backpackPackedYBits))
  ) {
    return (id << backpackPackedYBits) | yOffset;
  }
  return y;
}

function decodeBackpackPackedY(packedY) {
  const value = Number(packedY);
  if (!Number.isInteger(value) || value < 0) {
    return { worldY: value, blockId: 0 };
  }
  const blockId = value >> backpackPackedYBits;
  if (blockId <= 0 || !renderTypeForBlockId(blockId)) {
    return { worldY: value, blockId: 0 };
  }
  return {
    worldY: minBuildY + (value & backpackPackedYMask),
    blockId,
  };
}

function createRemoveBackpackResourceInstruction({ owner, sessionAuthority = null, backpack, index, context = gameContext }) {
  const data = Buffer.alloc(2);
  data.writeUInt8(2, 0);
  data.writeUInt8(index, 1);
  if (sessionAuthority) {
    const [playerProfile] = derivePlayerProfilePda(owner);
    const [playerSession] = derivePlayerSessionPda(owner, sessionAuthority);
    return new TransactionInstruction({
      programId: context.backpackProgramId,
      keys: [
        { pubkey: sessionAuthority, isSigner: true, isWritable: false },
        { pubkey: playerProfile, isSigner: false, isWritable: false },
        { pubkey: playerSession, isSigner: false, isWritable: false },
        { pubkey: backpack, isSigner: false, isWritable: true },
      ],
      data: contextInstructionData(context, gameNamespaceBackpack, data),
    });
  }
  return new TransactionInstruction({
    programId: context.backpackProgramId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: backpack, isSigner: false, isWritable: true },
    ],
    data: contextInstructionData(context, gameNamespaceBackpack, data),
  });
}

function createRemoveBackpackResourcesInstruction({ owner, sessionAuthority = null, backpack, indexes = [], context = gameContext }) {
  const normalizedIndexes = Array.from(new Set(indexes
    .map((index) => Number(index))
    .filter((index) => Number.isInteger(index) && index >= 0 && index <= 98)));
  const data = Buffer.alloc(2 + normalizedIndexes.length);
  data.writeUInt8(4, 0);
  data.writeUInt8(normalizedIndexes.length, 1);
  normalizedIndexes.forEach((index, offset) => data.writeUInt8(index, 2 + offset));
  if (sessionAuthority) {
    const [playerProfile] = derivePlayerProfilePda(owner);
    const [playerSession] = derivePlayerSessionPda(owner, sessionAuthority);
    return new TransactionInstruction({
      programId: context.backpackProgramId,
      keys: [
        { pubkey: sessionAuthority, isSigner: true, isWritable: false },
        { pubkey: playerProfile, isSigner: false, isWritable: false },
        { pubkey: playerSession, isSigner: false, isWritable: false },
        { pubkey: backpack, isSigner: false, isWritable: true },
      ],
      data: contextInstructionData(context, gameNamespaceBackpack, data),
    });
  }
  return new TransactionInstruction({
    programId: context.backpackProgramId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: backpack, isSigner: false, isWritable: true },
    ],
    data: contextInstructionData(context, gameNamespaceBackpack, data),
  });
}

export function createExecuteSmeltingInstruction({
  owner,
  recipeTable,
  backpack,
  recipeId,
  inputIndexes = [],
  fuelIndexes = [],
  batchMultiplier = 1,
  context = gameContext,
}) {
  const [smeltingAuthority] = deriveSmeltingAuthorityPdaForContext(context);
  const [playerProgress] = deriveSmeltingPlayerProgressPdaForContext(owner, context);
  const globalConfig = deriveGlobalConfigPda();
  const [materialPhysics] = deriveMaterialPhysicsPda(context.backpackProgramId);
  const inputs = normalizeBackpackIndexes(inputIndexes);
  const fuels = normalizeBackpackIndexes(fuelIndexes);
  const multiplier = Math.max(1, Math.min(0xffff, Math.floor(Number(batchMultiplier) || 1)));
  const data = Buffer.alloc(13 + inputs.length + fuels.length);
  data.writeUInt8(2, 0);
  data.writeBigUInt64LE(BigInt(recipeId), 1);
  data.writeUInt8(inputs.length, 9);
  data.writeUInt8(fuels.length, 10);
  data.writeUInt16LE(multiplier, 11);
  inputs.forEach((index, offset) => data.writeUInt8(index, 13 + offset));
  fuels.forEach((index, offset) => data.writeUInt8(index, 13 + inputs.length + offset));
  return new TransactionInstruction({
    programId: context.smeltingProgramId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: recipeTable, isSigner: false, isWritable: false },
      { pubkey: backpack, isSigner: false, isWritable: true },
      { pubkey: playerProgress, isSigner: false, isWritable: true },
      { pubkey: globalConfig, isSigner: false, isWritable: false },
      { pubkey: materialPhysics, isSigner: false, isWritable: false },
      { pubkey: smeltingAuthority, isSigner: false, isWritable: false },
      { pubkey: context.backpackProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: contextInstructionData(context, gameNamespaceSmelting, data),
  });
}

function createMarketListingInstruction({
  seller,
  listing,
  listingId,
  currency,
  sourceType = "backpack",
  sourceIndex,
  priceBaseUnits,
  sourceInventory,
  context = gameContext,
}) {
  const currencyCode = marketCurrencyCodes.get(currency);
  if (!currencyCode) throw new Error(`Unsupported market currency: ${currency}`);
  const normalizedSourceType = String(sourceType || "backpack").toLowerCase();
  const sourceTypeCode = marketSourceCodes.get(normalizedSourceType);
  if (!sourceTypeCode) throw new Error(`Unsupported market source: ${sourceType}`);
  const normalizedSourceIndex = Math.max(0, Math.min(98, Number(sourceIndex) || 0));
  const sourceInventoryKey = sourceInventory ? new PublicKey(sourceInventory) : PublicKey.default;

  const data = Buffer.alloc(20);
  data.writeUInt8(0, 0);
  data.writeBigUInt64LE(BigInt(listingId), 1);
  data.writeUInt8(currencyCode, 9);
  data.writeUInt8(sourceTypeCode, 10);
  data.writeUInt8(normalizedSourceIndex, 11);
  data.writeBigUInt64LE(BigInt(priceBaseUnits), 12);

  const keys = [
    { pubkey: seller, isSigner: true, isWritable: true },
    { pubkey: listing, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: sourceInventoryKey, isSigner: false, isWritable: true },
    { pubkey: context.backpackProgramId, isSigner: false, isWritable: false },
  ];
  const [playerProfile] = derivePlayerProfilePda(seller);
  keys.push(
    { pubkey: playerProfile, isSigner: false, isWritable: true },
    { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
    { pubkey: playerProgramId, isSigner: false, isWritable: false },
  );

  return new TransactionInstruction({
    programId: context.marketProgramId,
    keys,
    data: contextInstructionData(context, gameNamespaceMarket, data),
  });
}

export function createCancelMarketListingInstruction({ seller, listing, sourceInventory, context = gameContext }) {
  if (!sourceInventory) throw new Error("Canceling a listing requires a destination backpack.");
  const keys = [
    { pubkey: seller, isSigner: true, isWritable: true },
    { pubkey: listing, isSigner: false, isWritable: true },
    { pubkey: new PublicKey(sourceInventory), isSigner: false, isWritable: true },
    { pubkey: context.backpackProgramId, isSigner: false, isWritable: false },
    { pubkey: deriveMarketAuthorityPdaForContext(context)[0], isSigner: false, isWritable: false },
    { pubkey: deriveMaterialPhysicsPda(context.backpackProgramId)[0], isSigner: false, isWritable: false },
    { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    programId: context.marketProgramId,
    keys,
    data: contextInstructionData(context, gameNamespaceMarket, Buffer.from([1])),
  });
}

export function createBuyMarketListingInstruction({
  buyer,
  seller,
  listing,
  currency,
  buyerNckToken = null,
  sellerNckToken = null,
  treasuryNckToken = null,
  buyerBackpackAddress = null,
  context = gameContext,
}) {
  const normalizedCurrency = String(currency || "NCK").toUpperCase();
  const keys = [
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: seller, isSigner: false, isWritable: true },
    { pubkey: listing, isSigner: false, isWritable: true },
  ];
  if (normalizedCurrency === "NCK") {
    if (!buyerNckToken || !sellerNckToken || !treasuryNckToken) {
      throw new Error("NCK purchase requires buyer, seller, and treasury token accounts.");
    }
    keys.push(
      { pubkey: buyerNckToken, isSigner: false, isWritable: true },
      { pubkey: sellerNckToken, isSigner: false, isWritable: true },
      { pubkey: treasuryNckToken, isSigner: false, isWritable: true },
      { pubkey: nckMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    );
  } else if (normalizedCurrency === "SOL") {
    keys.push(
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: marketTreasury, isSigner: false, isWritable: true },
    );
  } else {
    throw new Error(`Unsupported market currency: ${currency}`);
  }
  if (!buyerBackpackAddress) throw new Error("Backpack listing purchase requires a buyer backpack.");
  keys.push(
    { pubkey: new PublicKey(buyerBackpackAddress), isSigner: false, isWritable: true },
    { pubkey: context.backpackProgramId, isSigner: false, isWritable: false },
    { pubkey: deriveMarketAuthorityPdaForContext(context)[0], isSigner: false, isWritable: false },
    { pubkey: deriveMaterialPhysicsPda(context.backpackProgramId)[0], isSigner: false, isWritable: false },
    { pubkey: deriveGlobalConfigPda(), isSigner: false, isWritable: false },
  );
  return new TransactionInstruction({
    programId: context.marketProgramId,
    keys,
    data: contextInstructionData(context, gameNamespaceMarket, Buffer.from([2])),
  });
}

async function getOrCreateGameplaySession(provider) {
  if (isLocalGameWalletProvider(provider)) {
    return getOrCreateLocalGameWalletGameplaySession(provider);
  }

  const owner = provider.publicKey;
  const stored = loadStoredGameplaySession(owner);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const conn = getNicechunkConnection();
  if (stored && stored.expiresAt > nowSeconds + sessionRefreshSkewSeconds) {
    const [playerSession] = derivePlayerSessionPda(owner, stored.keypair.publicKey);
    const [playerProfile] = derivePlayerProfilePda(owner);
    const [account, sessionAccount, profileAccount] = await conn.getMultipleAccountsInfo(
      [playerSession, stored.keypair.publicKey, playerProfile],
      "confirmed",
    );
    const sessionBalance = accountLamports(sessionAccount);
    if (account?.data?.length && isCurrentPlayerProfileAccount(profileAccount, owner)) {
      await fundGameplaySessionIfNeeded(provider, stored.keypair.publicKey, sessionBalance, conn);
      const configuredFundingLamports = getConfiguredGameplaySessionFundingLamports(owner);
      const effectiveBalance = sessionBalance < minimumSessionFundingLamports
        ? Math.max(sessionBalance, configuredFundingLamports)
        : sessionBalance;
      updateGameplaySessionStatusCache(owner, {
        walletAvailable: true,
        owner: owner.toBase58(),
        acknowledged: hasAcknowledgedGameplaySessionFunding(owner),
        configuredFundingLamports,
        minimumFundingLamports: minimumSessionFundingLamports,
        balanceLamports: effectiveBalance,
        balanceSol: effectiveBalance / lamportsPerSol,
        publicKey: stored.keypair.publicKey.toBase58(),
        expiresAt: stored.expiresAt,
      });
      markGameplaySessionReady(owner, stored.keypair.publicKey, effectiveBalance);
      return stored;
    }
  }

  const keypair = stored?.keypair ?? Keypair.generate();
  const expiresAt = nowSeconds + sessionDurationSeconds;
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, keypair.publicKey);
  const tx = new Transaction();
  const [profileAccount, sessionAccount] = await conn.getMultipleAccountsInfo(
    [playerProfile, keypair.publicKey],
    "confirmed",
  );
  const sessionBalance = accountLamports(sessionAccount);

  if (!profileAccount?.data?.length) {
    tx.add(createInitializePlayerInstruction(owner, playerProfile, ""));
  }
  const targetLamports = sessionBalance < minimumSessionFundingLamports
    ? getConfiguredGameplaySessionFundingLamports(owner)
    : sessionBalance;
  if (sessionBalance < targetLamports) {
    tx.add(SystemProgram.transfer({
      fromPubkey: owner,
      toPubkey: keypair.publicKey,
      lamports: targetLamports - sessionBalance,
    }));
  }
  tx.add(createOrRefreshPlayerSessionInstruction({
    owner,
    sessionAuthority: keypair.publicKey,
    playerProfile,
    playerSession,
    expiresAt,
  }));

  await signAndSendWalletTransaction(provider, tx, conn, [keypair]);
  const session = { keypair, expiresAt };
  storeGameplaySession(owner, session);
  markGameplaySessionReady(owner, keypair.publicKey, targetLamports);
  updateGameplaySessionStatusCache(owner, {
    walletAvailable: true,
    owner: owner.toBase58(),
    acknowledged: hasAcknowledgedGameplaySessionFunding(owner),
    configuredFundingLamports: getConfiguredGameplaySessionFundingLamports(owner),
    minimumFundingLamports: minimumSessionFundingLamports,
    balanceLamports: targetLamports,
    balanceSol: targetLamports / lamportsPerSol,
    publicKey: keypair.publicKey.toBase58(),
    expiresAt,
  });
  return session;
}

async function getOrCreateLocalGameWalletGameplaySession(provider) {
  const owner = provider.publicKey;
  const keypair = getLocalGameWalletKeypair();
  if (!keypair?.publicKey?.equals?.(owner)) {
    throw new Error("Local game wallet is unavailable.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + sessionDurationSeconds;
  if (isGameplaySessionReadyCached(owner, owner)) {
    return { keypair, expiresAt, localGameWallet: true };
  }

  const conn = getNicechunkConnection();
  const [playerProfile] = derivePlayerProfilePda(owner);
  const [playerSession] = derivePlayerSessionPda(owner, owner);
  const [profileAccount, sessionAccount] = await conn.getMultipleAccountsInfo(
    [playerProfile, playerSession],
    "confirmed",
  );

  if (
    isCurrentPlayerProfileAccount(profileAccount, owner) &&
    isFreshPlayerSessionAccount(sessionAccount, owner, owner, nowSeconds)
  ) {
    const currentExpiresAt = playerSessionExpiresAt(sessionAccount) ?? expiresAt;
    const balanceLamports = await conn.getBalance(owner, "confirmed").catch(() => null);
    markGameplaySessionReady(owner, owner, balanceLamports);
    updateGameplaySessionStatusCache(owner, createLocalGameWalletStatus(owner, balanceLamports, currentExpiresAt));
    return { keypair, expiresAt: currentExpiresAt, localGameWallet: true };
  }

  const tx = new Transaction();
  if (!profileAccount?.data?.length) {
    tx.add(createInitializePlayerInstruction(owner, playerProfile, ""));
  }
  tx.add(createOrRefreshPlayerSessionInstruction({
    owner,
    sessionAuthority: owner,
    playerProfile,
    playerSession,
    expiresAt,
  }));

  await signAndSendKeypairTransaction(keypair, tx, conn);
  const balanceLamports = await conn.getBalance(owner, "confirmed").catch(() => null);
  markGameplaySessionReady(owner, owner, balanceLamports);
  updateGameplaySessionStatusCache(owner, createLocalGameWalletStatus(owner, balanceLamports, expiresAt));
  return { keypair, expiresAt, localGameWallet: true };
}

function isCurrentPlayerProfileAccount(account, owner) {
  if (!account?.data?.length || !account.owner?.equals?.(playerProgramId)) return false;
  try {
    const profile = decodePlayerProfile(account.data);
    return profile.owner === owner.toBase58() && profile.globalConfig === deriveGlobalConfigPda().toBase58();
  } catch {
    return false;
  }
}

async function fundGameplaySessionIfNeeded(provider, sessionAuthority, sessionBalance, conn) {
  if (sessionBalance >= minimumSessionFundingLamports) return;
  const targetLamports = getConfiguredGameplaySessionFundingLamports(provider.publicKey);
  if (sessionBalance >= targetLamports) return;
  const lamports = targetLamports - sessionBalance;
  if (lamports <= 0) return;
  const tx = new Transaction();
  tx.add(SystemProgram.transfer({
    fromPubkey: provider.publicKey,
    toPubkey: sessionAuthority,
    lamports,
  }));
  await signAndSendWalletTransaction(provider, tx, conn);
}

async function loadEquippedBackpackForOwner(owner, conn = getNicechunkConnection()) {
  const cachedRecord = loadEquippedBackpackRecord(owner);
  if (cachedRecord?.backpack) {
    const cachedBackpack = await loadBackpackAccountForOwner(cachedRecord.backpack, owner, conn).catch(() => null);
    if (cachedBackpack) return cachedBackpack;
    clearEquippedBackpackRecord(owner);
  }

  const [playerProfile] = derivePlayerProfilePda(owner);
  const playerAccount = await conn.getAccountInfo(playerProfile, "confirmed");
  if (!playerAccount?.data?.length) return null;
  const profile = decodePlayerProfile(playerAccount.data);
  if (profile.owner !== owner.toBase58()) return null;
  if (!profile.equippedBackpack || profile.equippedBackpack === PublicKey.default.toBase58()) return null;
  const backpack = await loadBackpackAccountForOwner(profile.equippedBackpack, owner, conn);
  if (!backpack?.publicKey) return null;
  storeEquippedBackpackRecord(owner, {
    backpack: backpack.publicKey.toBase58(),
    backpackId: backpack.backpackId ?? "0",
    owner: owner.toBase58(),
    equippedAt: Date.now(),
    programId: backpack.programId ?? null,
  });
  return backpack;
}

async function loadBackpackAccountForOwner(backpackAddress, owner, conn = getNicechunkConnection()) {
  const publicKey = new PublicKey(backpackAddress);
  const account = await conn.getAccountInfo(publicKey, "confirmed");
  if (!account?.data?.length) return null;
  if (!account.owner.equals(gameProgramId)) return null;
  if (!isCurrentBackpackAccountData(account.data)) return null;
  const decoded = decodeBackpack(account.data);
  if (decoded.owner !== owner.toBase58()) {
    return null;
  }
  return { ...decoded, publicKey, programId: account.owner.toBase58() };
}

function isCurrentBackpackAccountData(data) {
  return Boolean(
    data?.length === backpackAccountLength &&
    data.subarray(0, 8).toString("utf8") === backpackMagic &&
    data.readUInt16LE(8) === backpackVersion,
  );
}

function loadStoredGameplaySession(owner) {
  try {
    if (!hasLocalStorage()) return null;
    const raw = localStorage.getItem(sessionStorageKey(owner));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.secretKey || !Number.isFinite(parsed.expiresAt)) return null;
    const secretKey = base64ToBytes(parsed.secretKey);
    const keypair = Keypair.fromSecretKey(secretKey);
    if (parsed.publicKey && keypair.publicKey.toBase58() !== parsed.publicKey) return null;
    return { keypair, expiresAt: Number(parsed.expiresAt) };
  } catch {
    return null;
  }
}

function loadEquippedBackpackRecord(owner) {
  try {
    if (!hasLocalStorage()) return null;
    const raw = localStorage.getItem(equippedBackpackStorageKey(owner));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.backpack || !parsed?.backpackId) return null;
    if (parsed.programId !== gameProgramId.toBase58()) {
      clearEquippedBackpackRecord(owner);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function storeEquippedBackpackRecord(owner, record) {
  if (!hasLocalStorage()) return;
  localStorage.setItem(equippedBackpackStorageKey(owner), JSON.stringify(record));
}

function clearEquippedBackpackRecord(owner) {
  if (!hasLocalStorage()) return;
  localStorage.removeItem(equippedBackpackStorageKey(owner));
}

function storeGameplaySession(owner, session) {
  if (!hasLocalStorage()) return;
  localStorage.setItem(sessionStorageKey(owner), JSON.stringify({
    publicKey: session.keypair.publicKey.toBase58(),
    secretKey: bytesToBase64(session.keypair.secretKey),
    expiresAt: session.expiresAt,
    savedAt: Date.now(),
  }));
}

function sessionStorageKey(owner) {
  return `${sessionStorageKeyPrefix}${owner.toBase58()}`;
}

function equippedBackpackStorageKey(owner) {
  return `${equippedBackpackStorageKeyPrefix}${owner.toBase58()}`;
}

function sessionFundingStorageKey(owner = null) {
  const suffix = sessionOwnerStorageSuffix(owner);
  return `${sessionFundingStorageKeyPrefix}${suffix}`;
}

function sessionFundingAcknowledgedKey(owner = null) {
  const suffix = sessionOwnerStorageSuffix(owner);
  return `${sessionFundingAcknowledgedKeyPrefix}${suffix}`;
}

function sessionOwnerStorageSuffix(owner = null) {
  if (typeof owner === "string" && owner) return owner;
  return owner?.toBase58?.() ?? "default";
}

function storedWalletPublicKey() {
  try {
    if (!hasLocalStorage()) return null;
    const value = localStorage.getItem(storageWalletKey);
    return value ? new PublicKey(value) : null;
  } catch {
    return null;
  }
}

function createBackpackId() {
  const time = BigInt(Date.now()) & ((1n << 42n) - 1n);
  const random = BigInt(Math.floor(Math.random() * 2 ** 22));
  return (time << 22n) | random;
}

function createMarketListingId() {
  const time = BigInt(Date.now()) & ((1n << 42n) - 1n);
  const random = BigInt(Math.floor(Math.random() * 2 ** 22));
  return (time << 22n) | random;
}

function parseMarketPriceBaseUnits(value, currency) {
  const decimals = marketCurrencyDecimals.get(currency) ?? 6;
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error("Invalid market listing price.");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Price supports at most ${decimals} decimal places for ${currency}.`);
  }
  const paddedFraction = fraction.padEnd(decimals, "0");
  const amount = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(paddedFraction || "0");
  if (amount <= 0n || amount > 2n ** 64n - 1n) throw new Error("Invalid market listing price.");
  return amount;
}

function formatMarketBaseUnits(value, currency) {
  const decimals = marketCurrencyDecimals.get(currency) ?? 6;
  const amount = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = amount % scale;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

function getConfiguredGameplaySessionFundingLamports(owner = null) {
  if (!hasLocalStorage()) return minimumSessionFundingLamports;
  const ownerValue = localStorage.getItem(sessionFundingStorageKey(owner));
  const defaultValue = localStorage.getItem(sessionFundingStorageKey(null));
  const parsed = Number(ownerValue ?? defaultValue);
  return Number.isFinite(parsed) && parsed >= minimumSessionFundingLamports
    ? Math.floor(parsed)
    : minimumSessionFundingLamports;
}

async function signAndSendWalletTransaction(provider, transaction, conn = getNicechunkConnection(), extraSigners = []) {
  transaction.feePayer = provider.publicKey;

  if (typeof conn.prepareTransaction === "function") {
    await conn.prepareTransaction(transaction, { commitment: "confirmed" });
  } else {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
  }

  for (const signer of extraSigners) transaction.partialSign(signer);

  if (typeof provider.signTransaction === "function") {
    const signed = await provider.signTransaction(transaction);
    const signature = await sendRawTransactionWithLogs(conn, signed.serialize(), "wallet");
    await confirmTransactionByHttpPolling(conn, {
      signature,
      blockhash: transaction.recentBlockhash,
      lastValidBlockHeight: transaction.lastValidBlockHeight,
    }, "confirmed");
    return signature;
  }

  if (typeof provider.signAndSendTransaction !== "function") {
    throw new Error("Wallet does not support transaction signing.");
  }
  const result = await provider.signAndSendTransaction(transaction);
  const signature = typeof result === "string" ? result : result?.signature;
  if (!signature) throw new Error("Wallet did not return a transaction signature.");
  await confirmTransactionByHttpPolling(conn, {
    signature,
    blockhash: transaction.recentBlockhash,
    lastValidBlockHeight: transaction.lastValidBlockHeight,
  }, "confirmed");
  return signature;
}

async function signAndSendKeypairTransaction(signer, transaction, conn = getNicechunkConnection()) {
  transaction.feePayer = signer.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.sign(signer);
  const signature = await sendRawTransactionWithLogs(conn, transaction.serialize(), "keypair");
  await confirmTransactionByHttpPolling(conn, { signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}

function createSolSpendSummary() {
  return {
    totalLamports: 0,
    transactionCount: 0,
    transactions: [],
  };
}

function solSpendResult(summary) {
  const totalLamports = Number(summary?.totalLamports);
  const transactionCount = Number(summary?.transactionCount);
  const transactions = Array.isArray(summary?.transactions) ? summary.transactions : [];
  if (!Number.isFinite(totalLamports) || !Number.isFinite(transactionCount) || transactionCount <= 0) {
    return {
      solSpentLamports: null,
      solSpentSol: null,
      solSpentEstimated: false,
      solSpentTransactions: [],
    };
  }
  return {
    solSpentLamports: Math.max(0, Math.floor(totalLamports)),
    solSpentSol: Math.max(0, Math.floor(totalLamports)) / lamportsPerSol,
    solSpentEstimated: transactions.some((transaction) => transaction?.estimated),
    solSpentTransactions: transactions,
  };
}

async function addTransactionSolSpend(summary, conn, signature, payer) {
  if (!summary || !signature || !payer) return null;
  const spend = await readTransactionSolSpend(conn, signature, payer);
  if (!spend) return null;
  summary.totalLamports += spend.lamports;
  summary.transactionCount += 1;
  summary.transactions.push(spend);
  return spend;
}

async function readTransactionSolSpend(conn, signature, payer) {
  const payerKey = payer?.toBase58?.() ?? String(payer ?? "");
  if (!signature || !payerKey) return null;
  const transaction = await conn.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  }).catch((error) => {
    reportRpcError(error, "transaction-sol-spend");
    return null;
  });
  const spend = transactionSolSpendFromMeta(transaction, payerKey, signature);
  if (spend) return spend;
  return estimatedTransactionSolSpend(signature, payerKey, "transaction-meta-unavailable");
}

function transactionSolSpendFromMeta(transaction, payerKey, signature) {
  const meta = transaction?.meta;
  const preBalances = meta?.preBalances;
  const postBalances = meta?.postBalances;
  if (!Array.isArray(preBalances) || !Array.isArray(postBalances)) return null;
  const accountKeys = transactionAccountKeys(transaction);
  let payerIndex = accountKeys.findIndex((key) => key === payerKey);
  if (payerIndex < 0) payerIndex = 0;
  const pre = Number(preBalances[payerIndex]);
  const post = Number(postBalances[payerIndex]);
  const balanceDelta = Number.isFinite(pre) && Number.isFinite(post) ? Math.max(0, pre - post) : 0;
  const fee = Number(meta?.fee);
  const lamports = Math.max(balanceDelta, Number.isFinite(fee) ? fee : 0);
  if (!Number.isFinite(lamports) || lamports <= 0) return null;
  return {
    signature,
    payer: payerKey,
    lamports: Math.floor(lamports),
    feeLamports: Number.isFinite(fee) ? Math.floor(fee) : null,
  };
}

function estimatedTransactionSolSpend(signature, payerKey, reason = "estimated-fee") {
  return {
    signature,
    payer: payerKey,
    lamports: fallbackTransactionFeeLamports,
    feeLamports: fallbackTransactionFeeLamports,
    estimated: true,
    reason,
  };
}

function transactionAccountKeys(transaction) {
  const message = transaction?.transaction?.message;
  const keys = Array.isArray(message?.accountKeys)
    ? message.accountKeys
    : Array.isArray(message?.staticAccountKeys)
      ? message.staticAccountKeys
      : [];
  return keys.map((key) => (
    key?.toBase58?.() ??
    key?.pubkey?.toBase58?.() ??
    key?.pubkey?.toString?.() ??
    key?.toString?.() ??
    String(key)
  ));
}

async function sendRawTransactionWithLogs(conn, serializedTransaction, context) {
  try {
    return await conn.sendRawTransaction(serializedTransaction, { skipPreflight: false });
  } catch (error) {
    await attachSendTransactionLogs(error, conn, context);
    throw error;
  }
}

async function confirmTransactionByHttpPolling(conn, strategy, commitment = "confirmed") {
  const { signature, lastValidBlockHeight } = strategy;
  const startedAt = Date.now();
  let nextBlockHeightCheckAt = 0;

  while (true) {
    const statusResponse = await conn.getSignatureStatuses([signature]);
    const status = statusResponse?.value?.[0] ?? null;
    if (status?.err) throw createTransactionStatusError(signature, status.err);
    if (hasReachedSignatureCommitment(status, commitment)) {
      return {
        context: statusResponse.context,
        value: { err: null },
      };
    }

    const now = Date.now();
    if (Number.isFinite(lastValidBlockHeight) && now >= nextBlockHeightCheckAt) {
      nextBlockHeightCheckAt = now + transactionBlockHeightPollMs;
      const blockHeight = await conn.getBlockHeight(commitment).catch(() => null);
      if (Number.isFinite(blockHeight) && blockHeight > lastValidBlockHeight) {
        const finalStatusResponse = await conn.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
        const finalStatus = finalStatusResponse?.value?.[0] ?? null;
        if (finalStatus?.err) throw createTransactionStatusError(signature, finalStatus.err);
        if (hasReachedSignatureCommitment(finalStatus, commitment)) {
          return {
            context: finalStatusResponse.context,
            value: { err: null },
          };
        }
        throw new TransactionExpiredBlockheightExceededError(signature);
      }
    } else if (!Number.isFinite(lastValidBlockHeight) && now - startedAt > transactionConfirmationTimeoutMs) {
      throw createTransactionConfirmationTimeoutError(signature);
    }

    await sleep(transactionConfirmationPollMs);
  }
}

function hasReachedSignatureCommitment(status, commitment = "confirmed") {
  if (!status) return false;
  const confirmationStatus = status.confirmationStatus ?? (status.confirmations === null ? "finalized" : null);
  if (commitment === "processed" || commitment === "recent") return true;
  if (commitment === "finalized" || commitment === "max" || commitment === "root") {
    return confirmationStatus === "finalized";
  }
  return (
    confirmationStatus === "confirmed" ||
    confirmationStatus === "finalized" ||
    (confirmationStatus === null && Number.isFinite(status.confirmations) && status.confirmations > 0)
  );
}

function createTransactionStatusError(signature, transactionError) {
  const error = new Error(`Transaction ${signature} failed: ${JSON.stringify(transactionError)}`);
  error.name = "TransactionStatusError";
  error.signature = signature;
  error.transactionError = transactionError;
  return error;
}

function createTransactionConfirmationTimeoutError(signature) {
  const error = new Error(`Transaction ${signature} was not confirmed within ${transactionConfirmationTimeoutMs / 1000} seconds.`);
  error.name = "TransactionConfirmationTimeoutError";
  error.signature = signature;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function attachSendTransactionLogs(error, conn, context) {
  if (!error || typeof error.getLogs !== "function") return;
  try {
    const logs = await error.getLogs(conn);
    error.nicechunkLogs = logs;
    if (isVerboseTransactionLogsEnabled() && Array.isArray(logs) && logs.length) {
      console.warn(`NiceChunk ${context} transaction logs`, logs);
    }
  } catch (logError) {
    error.nicechunkLogError = logError;
  }
}

function isVerboseTransactionLogsEnabled() {
  try {
    return Boolean(window.NiceChunkDebugMining) || localStorage.getItem("nicechunk.debugTransactionLogs") === "1";
  } catch {
    return false;
  }
}

async function connectedWalletProvider({ prompt = false } = {}) {
  const storedWallet = localStorage.getItem(storageWalletKey);
  const localGameWallet = getLocalGameWalletProvider();
  if (localGameWallet?.publicKey && storedWallet === localGameWallet.publicKey.toBase58()) {
    return localGameWallet;
  }

  const providers = [
    window.phantom?.solana,
    window.solflare,
    window.backpack?.solana,
    window.solana,
  ].filter((candidate, index, list) => (
    candidate &&
    typeof candidate.connect === "function" &&
    list.indexOf(candidate) === index
  ));
  if (!providers.length) return null;

  for (const provider of providers) {
    try {
      if (!provider.publicKey) {
        if (prompt) {
          await provider.connect();
        } else {
          await provider.connect({ onlyIfTrusted: true });
        }
      }
    } catch {
      continue;
    }
    if (!provider.publicKey) continue;
    if (storedWallet && provider.publicKey.toBase58() !== storedWallet) continue;
    try {
      await assertNicechunkWalletNetwork(provider, { requestSwitch: prompt });
    } catch (error) {
      if (prompt) throw createWalletNetworkMessageError(error);
      continue;
    }
    return provider;
  }
  return null;
}

function createWalletNetworkMessageError(error) {
  const expected = solanaClusterLabel(error?.requiredCluster);
  const detected = error?.detectedCluster ? solanaClusterLabel(error.detectedCluster) : "Unknown";
  const nextError = new Error(
    error?.code === "nicechunk_network_unsupported"
      ? `Switch your wallet to Solana ${expected}, then retry.`
      : `NiceChunk requires Solana ${expected}. Wallet network: ${detected}.`,
  );
  nextError.code = error?.code || "nicechunk_network_error";
  nextError.cause = error;
  return nextError;
}

function readableErrorMessage(error) {
  return error?.transactionMessage || error?.message || String(error || "Unknown error");
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
