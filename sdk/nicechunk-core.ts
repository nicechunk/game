import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";

const env = typeof process !== "undefined" ? process.env : {};

export const NICECHUNK_CORE_PROGRAM_ID = new PublicKey(
  env.NICECHUNK_CORE_PROGRAM_ID ?? "9EhMCRYMJej1F21KzaA5Zao3khGGc5aJbDGbnxaogQHu",
);
export const GLOBAL_CONFIG_SEED = "global-config";
export const GLOBAL_CONFIG_LEN = 293;
export const CONFIG_MAGIC = "NCKCFG01";

export interface DecodedGlobalConfig {
  magic: string;
  version: number;
  globalConfigBump: number;
  sealed: boolean;
  nckMint: PublicKey;
  nckDecimals: number;
  nckGenesisSupply: bigint;
  developmentWallet: PublicKey;
  worldId: number;
  worldSeed: Buffer;
  terrainConfigHash: Buffer;
  resourceRuleHash: Buffer;
  clientWorldConfigHash: Buffer;
  starterPackPriceLamports: bigint;
  genesisPassPriceLamports: bigint;
  starterPackMaxPerWallet: number;
  genesisPassMaxPerWallet: number;
  genesisPassMaxSupply: number;
  guardianStakeAmount: bigint;
  guardianTaxBps: number;
  protocolFeeBps: number;
  marketFeeBps: number;
  slashBps: number;
  solToLiquidityBps: number;
  solToRewardBps: number;
  solToDevelopmentBps: number;
  chunkSize: number;
  sectionHeight: number;
  minBuildY: number;
  maxBuildY: number;
  maxTerrainHeight: number;
  seaLevel: number;
  guardianRegionSizeChunks: number;
  guardianRealtimeRadiusChunks: number;
  mineCooldownSlots: number;
  genesisSlot: bigint;
  createdAt: bigint;
}

export function deriveGlobalConfigPda(
  programId: PublicKey = NICECHUNK_CORE_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(GLOBAL_CONFIG_SEED)], programId);
}

export function createInitializeGlobalConfigInstruction({
  payer,
  nckMint,
  programId = NICECHUNK_CORE_PROGRAM_ID,
}: {
  payer: PublicKey;
  nckMint: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const [globalConfig] = deriveGlobalConfigPda(programId);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: globalConfig, isSigner: false, isWritable: true },
      { pubkey: nckMint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([0]),
  });
}

export function decodeGlobalConfig(data: Buffer): DecodedGlobalConfig {
  if (data.length !== GLOBAL_CONFIG_LEN) {
    throw new Error(`Invalid GlobalConfig length: expected ${GLOBAL_CONFIG_LEN}, got ${data.length}`);
  }

  let offset = 0;
  const bytes = (length: number): Buffer => {
    const value = data.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  const u8 = (): number => data.readUInt8(offset++);
  const u16 = (): number => {
    const value = data.readUInt16LE(offset);
    offset += 2;
    return value;
  };
  const i16 = (): number => {
    const value = data.readInt16LE(offset);
    offset += 2;
    return value;
  };
  const u32 = (): number => {
    const value = data.readUInt32LE(offset);
    offset += 4;
    return value;
  };
  const u64 = (): bigint => {
    const value = data.readBigUInt64LE(offset);
    offset += 8;
    return value;
  };
  const i64 = (): bigint => {
    const value = data.readBigInt64LE(offset);
    offset += 8;
    return value;
  };
  const pubkey = (): PublicKey => new PublicKey(bytes(32));

  const decoded: DecodedGlobalConfig = {
    magic: bytes(8).toString("utf8"),
    version: u16(),
    globalConfigBump: u8(),
    sealed: u8() === 1,
    nckMint: pubkey(),
    nckDecimals: u8(),
    nckGenesisSupply: u64(),
    developmentWallet: pubkey(),
    worldId: u16(),
    worldSeed: bytes(32),
    terrainConfigHash: bytes(32),
    resourceRuleHash: bytes(32),
    clientWorldConfigHash: bytes(32),
    starterPackPriceLamports: u64(),
    genesisPassPriceLamports: u64(),
    starterPackMaxPerWallet: u8(),
    genesisPassMaxPerWallet: u8(),
    genesisPassMaxSupply: u32(),
    guardianStakeAmount: u64(),
    guardianTaxBps: u16(),
    protocolFeeBps: u16(),
    marketFeeBps: u16(),
    slashBps: u16(),
    solToLiquidityBps: u16(),
    solToRewardBps: u16(),
    solToDevelopmentBps: u16(),
    chunkSize: u16(),
    sectionHeight: u16(),
    minBuildY: i16(),
    maxBuildY: i16(),
    maxTerrainHeight: i16(),
    seaLevel: i16(),
    guardianRegionSizeChunks: u16(),
    guardianRealtimeRadiusChunks: u16(),
    mineCooldownSlots: u16(),
    genesisSlot: u64(),
    createdAt: i64(),
  };

  if (offset !== GLOBAL_CONFIG_LEN) {
    throw new Error(`GlobalConfig decoder offset mismatch: ${offset}`);
  }
  if (decoded.magic !== CONFIG_MAGIC) {
    throw new Error(`Invalid GlobalConfig magic: ${decoded.magic}`);
  }
  return decoded;
}

export function bigintJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
