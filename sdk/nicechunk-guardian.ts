import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  deriveGlobalConfigPda,
  NICECHUNK_CORE_PROGRAM_ID,
} from "./nicechunk-core.ts";

const env = typeof process !== "undefined" ? process.env : {};

export const NICECHUNK_GUARDIAN_PROGRAM_ID = new PublicKey(
  env.NICECHUNK_GUARDIAN_PROGRAM_ID ?? "RQQZKA1fGELBxtxCQ6q7P26GJH4whWmPjH9XqmihVRK",
);
export const DEVNET_NCK_MINT = new PublicKey(
  env.NCK_MINT ?? "HSnWF5kjkWVrceW2SaSskScuLveUZE4gpthZ2ZXRPQPo",
);
export const GUARDIAN_GOVERNANCE_WALLET = new PublicKey(
  "9XuoVVwqP2jipt3jpJVXCSS2N2jr9vDuV3d6K73FKVud",
);
export const GUARDIAN_TREASURY_WALLET = GUARDIAN_GOVERNANCE_WALLET;
export const GUARDIAN_REGISTRY_SEED = "guardian-registry";
export const GUARDIAN_REGION_SEED = "guardian-region";
export const GUARDIAN_TREASURY_AUTHORITY_SEED = "guardian-treasury";
export const GUARDIAN_REGISTRY_LEN = 160;
export const GUARDIAN_REGION_LEN = 288;
export const GUARDIAN_REGISTRY_MAGIC = "NCKGDR01";
export const GUARDIAN_REGION_MAGIC = "NCKGRG01";
export const GUARDIAN_REGION_SIZE = 100;
export const EMPTY_GUARDIAN_BLUEPRINT_HASH = "25232284e49cf2cb4201bb072e27626c";
export const GUARDIAN_STAKE_AMOUNT = 100_000_000_000n;
export const GUARDIAN_STATUS_ACTIVE = 1;
export const GUARDIAN_STATUS_REMOVED = 2;

export interface DecodedGuardianRegistry {
  magic: string;
  version: number;
  bump: number;
  treasuryBump: number;
  globalConfig: PublicKey;
  nckMint: PublicKey;
  treasuryToken: PublicKey;
  activeCount: bigint;
  totalRegistrations: bigint;
  genesisRegistered: boolean;
  regionSizeChunks: number;
  stakeAmount: bigint;
  slashAmount: bigint;
  createdSlot: bigint;
  createdAt: bigint;
}

export interface DecodedGuardianRegion {
  publicKey?: PublicKey;
  magic: string;
  version: number;
  bump: number;
  status: number;
  regionX: number;
  regionY: number;
  minChunkX: number;
  minChunkY: number;
  maxChunkX: number;
  maxChunkY: number;
  owner: PublicKey;
  operator: PublicKey;
  globalConfig: PublicKey;
  host: string;
  port: number;
  useTls: boolean;
  stakeAmount: bigint;
  totalSlashed: bigint;
  penaltyCount: number;
  registeredAt: bigint;
  lastProofAt: bigint;
  penaltyCursorAt: bigint;
  proofCount: bigint;
  updatedSlot: number;
  blueprintHash: string | null;
  blueprintRevision: bigint;
  blueprintRecordCount: number;
  accountLength: number;
}

export function chunkToGuardianRegion(chunkCoord: number): number {
  return Math.floor(chunkCoord / GUARDIAN_REGION_SIZE);
}

export function deriveGuardianRegistryPda({
  globalConfig,
  programId = NICECHUNK_GUARDIAN_PROGRAM_ID,
}: {
  globalConfig: PublicKey;
  programId?: PublicKey;
}): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(GUARDIAN_REGISTRY_SEED), globalConfig.toBuffer()],
    programId,
  );
}

export function deriveGuardianTreasuryAuthorityPda({
  globalConfig,
  programId = NICECHUNK_GUARDIAN_PROGRAM_ID,
}: {
  globalConfig: PublicKey;
  programId?: PublicKey;
}): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(GUARDIAN_TREASURY_AUTHORITY_SEED), globalConfig.toBuffer()],
    programId,
  );
}

export function deriveGuardianRegionPda({
  globalConfig,
  regionX,
  regionY,
  programId = NICECHUNK_GUARDIAN_PROGRAM_ID,
}: {
  globalConfig: PublicKey;
  regionX: number;
  regionY: number;
  programId?: PublicKey;
}): [PublicKey, number] {
  const x = Buffer.alloc(4);
  const y = Buffer.alloc(4);
  x.writeInt32LE(regionX, 0);
  y.writeInt32LE(regionY, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(GUARDIAN_REGION_SEED), globalConfig.toBuffer(), x, y],
    programId,
  );
}

export function deriveNeighborGuardianRegions({
  globalConfig,
  regionX,
  regionY,
  programId = NICECHUNK_GUARDIAN_PROGRAM_ID,
}: {
  globalConfig: PublicKey;
  regionX: number;
  regionY: number;
  programId?: PublicKey;
}): PublicKey[] {
  return [
    deriveGuardianRegionPda({ globalConfig, regionX: regionX + 1, regionY, programId })[0],
    deriveGuardianRegionPda({ globalConfig, regionX: regionX - 1, regionY, programId })[0],
    deriveGuardianRegionPda({ globalConfig, regionX, regionY: regionY + 1, programId })[0],
    deriveGuardianRegionPda({ globalConfig, regionX, regionY: regionY - 1, programId })[0],
  ];
}

export function createInitializeGuardianRegistryInstruction({
  treasury,
  treasuryNckToken,
  guardianProgramId = NICECHUNK_GUARDIAN_PROGRAM_ID,
  coreProgramId = NICECHUNK_CORE_PROGRAM_ID,
  nckMint = DEVNET_NCK_MINT,
}: {
  treasury: PublicKey;
  treasuryNckToken: PublicKey;
  guardianProgramId?: PublicKey;
  coreProgramId?: PublicKey;
  nckMint?: PublicKey;
}): TransactionInstruction {
  const [globalConfig] = deriveGlobalConfigPda(coreProgramId);
  const [registry] = deriveGuardianRegistryPda({ globalConfig, programId: guardianProgramId });
  const [treasuryAuthority] = deriveGuardianTreasuryAuthorityPda({
    globalConfig,
    programId: guardianProgramId,
  });
  return new TransactionInstruction({
    programId: guardianProgramId,
    keys: [
      { pubkey: treasury, isSigner: true, isWritable: true },
      { pubkey: registry, isSigner: false, isWritable: true },
      { pubkey: globalConfig, isSigner: false, isWritable: false },
      { pubkey: treasuryAuthority, isSigner: false, isWritable: false },
      { pubkey: treasuryNckToken, isSigner: false, isWritable: false },
      { pubkey: nckMint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([0]),
  });
}

export function createRegisterGuardianInstruction({
  payer,
  operator,
  operatorNckToken,
  treasuryNckToken,
  regionX,
  regionY,
  host,
  port,
  useTls,
  isGenesis = false,
  genesisAuthority,
  guardianProgramId = NICECHUNK_GUARDIAN_PROGRAM_ID,
  coreProgramId = NICECHUNK_CORE_PROGRAM_ID,
  nckMint = DEVNET_NCK_MINT,
}: {
  payer: PublicKey;
  operator: PublicKey;
  operatorNckToken: PublicKey;
  treasuryNckToken: PublicKey;
  regionX: number;
  regionY: number;
  host: string;
  port: number;
  useTls: boolean;
  isGenesis?: boolean;
  genesisAuthority?: PublicKey;
  guardianProgramId?: PublicKey;
  coreProgramId?: PublicKey;
  nckMint?: PublicKey;
}): TransactionInstruction {
  const [globalConfig] = deriveGlobalConfigPda(coreProgramId);
  const [registry] = deriveGuardianRegistryPda({ globalConfig, programId: guardianProgramId });
  const [region] = deriveGuardianRegionPda({ globalConfig, regionX, regionY, programId: guardianProgramId });
  const [treasuryAuthority] = deriveGuardianTreasuryAuthorityPda({
    globalConfig,
    programId: guardianProgramId,
  });
  const hostBytes = encodeGuardianHost(host);
  assertGuardianPort(port);
  const data = Buffer.alloc(1 + 12 + hostBytes.length + 32);
  data.writeUInt8(isGenesis ? 1 : 2, 0);
  data.writeInt32LE(regionX, 1);
  data.writeInt32LE(regionY, 5);
  data.writeUInt16LE(port, 9);
  data.writeUInt8(useTls ? 1 : 0, 11);
  data.writeUInt8(hostBytes.length, 12);
  hostBytes.copy(data, 13);
  operator.toBuffer().copy(data, 13 + hostBytes.length);

  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: operator, isSigner: true, isWritable: false },
    { pubkey: operatorNckToken, isSigner: false, isWritable: true },
    { pubkey: registry, isSigner: false, isWritable: true },
    { pubkey: region, isSigner: false, isWritable: true },
    { pubkey: globalConfig, isSigner: false, isWritable: false },
    { pubkey: treasuryAuthority, isSigner: false, isWritable: false },
    { pubkey: treasuryNckToken, isSigner: false, isWritable: true },
    { pubkey: nckMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  if (isGenesis) {
    if (!genesisAuthority) throw new Error("Genesis guardian registration requires governance authority");
    keys.push({ pubkey: genesisAuthority, isSigner: true, isWritable: false });
  } else {
    keys.push(
      ...deriveNeighborGuardianRegions({ globalConfig, regionX, regionY, programId: guardianProgramId }).map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: false,
      })),
    );
  }

  return new TransactionInstruction({
    programId: guardianProgramId,
    keys,
    data,
  });
}

export function createUpdateGuardianEndpointInstruction({
  authority,
  regionX,
  regionY,
  host,
  port,
  useTls,
  guardianProgramId = NICECHUNK_GUARDIAN_PROGRAM_ID,
  coreProgramId = NICECHUNK_CORE_PROGRAM_ID,
}: {
  authority: PublicKey;
  regionX: number;
  regionY: number;
  host: string;
  port: number;
  useTls: boolean;
  guardianProgramId?: PublicKey;
  coreProgramId?: PublicKey;
}): TransactionInstruction {
  const [globalConfig] = deriveGlobalConfigPda(coreProgramId);
  const [registry] = deriveGuardianRegistryPda({ globalConfig, programId: guardianProgramId });
  const [region] = deriveGuardianRegionPda({ globalConfig, regionX, regionY, programId: guardianProgramId });
  const hostBytes = encodeGuardianHost(host);
  assertGuardianPort(port);
  const data = Buffer.alloc(13 + hostBytes.length);
  data.writeUInt8(5, 0);
  data.writeInt32LE(regionX, 1);
  data.writeInt32LE(regionY, 5);
  data.writeUInt16LE(port, 9);
  data.writeUInt8(useTls ? 1 : 0, 11);
  data.writeUInt8(hostBytes.length, 12);
  hostBytes.copy(data, 13);

  return new TransactionInstruction({
    programId: guardianProgramId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: registry, isSigner: false, isWritable: false },
      { pubkey: region, isSigner: false, isWritable: true },
      { pubkey: globalConfig, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function createUpdateGuardianOperatorInstruction({
  treasury,
  newOperator,
  regionX,
  regionY,
  guardianProgramId = NICECHUNK_GUARDIAN_PROGRAM_ID,
  coreProgramId = NICECHUNK_CORE_PROGRAM_ID,
}: {
  treasury: PublicKey;
  newOperator: PublicKey;
  regionX: number;
  regionY: number;
  guardianProgramId?: PublicKey;
  coreProgramId?: PublicKey;
}): TransactionInstruction {
  if (newOperator.equals(PublicKey.default)) throw new Error("Guardian operator cannot be the default public key");
  const [globalConfig] = deriveGlobalConfigPda(coreProgramId);
  const [region] = deriveGuardianRegionPda({ globalConfig, regionX, regionY, programId: guardianProgramId });
  const data = Buffer.alloc(41);
  data.writeUInt8(8, 0);
  data.writeInt32LE(regionX, 1);
  data.writeInt32LE(regionY, 5);
  newOperator.toBuffer().copy(data, 9);
  return new TransactionInstruction({
    programId: guardianProgramId,
    keys: [
      { pubkey: treasury, isSigner: true, isWritable: false },
      { pubkey: region, isSigner: false, isWritable: true },
      { pubkey: globalConfig, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function decodeGuardianRegistry(data: Buffer): DecodedGuardianRegistry {
  if (data.length !== GUARDIAN_REGISTRY_LEN) {
    throw new Error(`Invalid GuardianRegistry length: expected ${GUARDIAN_REGISTRY_LEN}, got ${data.length}`);
  }
  let offset = 0;
  const bytes = (length: number): Buffer => {
    const value = data.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  const u8 = () => data.readUInt8(offset++);
  const u16 = () => {
    const value = data.readUInt16LE(offset);
    offset += 2;
    return value;
  };
  const u64 = () => {
    const value = data.readBigUInt64LE(offset);
    offset += 8;
    return value;
  };
  const i64 = () => {
    const value = data.readBigInt64LE(offset);
    offset += 8;
    return value;
  };
  const pubkey = () => new PublicKey(bytes(32));
  const decoded = {
    magic: bytes(8).toString("utf8"),
    version: u16(),
    bump: u8(),
    treasuryBump: u8(),
    globalConfig: pubkey(),
    nckMint: pubkey(),
    treasuryToken: pubkey(),
    activeCount: u64(),
    totalRegistrations: u64(),
    genesisRegistered: u8() === 1,
    _reserved: u8(),
    regionSizeChunks: u16(),
    stakeAmount: u64(),
    slashAmount: u64(),
    createdSlot: u64(),
    createdAt: i64(),
  };
  if (decoded.magic !== GUARDIAN_REGISTRY_MAGIC || decoded.version !== 1 || offset !== GUARDIAN_REGISTRY_LEN) {
    throw new Error("Invalid GuardianRegistry data");
  }
  const { _reserved, ...result } = decoded;
  return result;
}

export function decodeGuardianRegion(data: Buffer, publicKey?: PublicKey): DecodedGuardianRegion {
  if (data.length !== GUARDIAN_REGION_LEN) {
    throw new Error(`Invalid GuardianRegion length: expected ${GUARDIAN_REGION_LEN}, got ${data.length}`);
  }
  let offset = 0;
  const bytes = (length: number): Buffer => {
    const value = data.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  const u8 = () => data.readUInt8(offset++);
  const u16 = () => {
    const value = data.readUInt16LE(offset);
    offset += 2;
    return value;
  };
  const u32 = () => {
    const value = data.readUInt32LE(offset);
    offset += 4;
    return value;
  };
  const u64 = () => {
    const value = data.readBigUInt64LE(offset);
    offset += 8;
    return value;
  };
  const i32 = () => {
    const value = data.readInt32LE(offset);
    offset += 4;
    return value;
  };
  const i64 = () => {
    const value = data.readBigInt64LE(offset);
    offset += 8;
    return value;
  };
  const pubkey = () => new PublicKey(bytes(32));

  const decoded: DecodedGuardianRegion = {
    publicKey,
    magic: bytes(8).toString("utf8"),
    version: u16(),
    bump: u8(),
    status: u8(),
    regionX: i32(),
    regionY: i32(),
    minChunkX: i32(),
    minChunkY: i32(),
    maxChunkX: i32(),
    maxChunkY: i32(),
    owner: pubkey(),
    operator: pubkey(),
    globalConfig: pubkey(),
    host: "",
    port: 0,
    useTls: false,
    stakeAmount: 0n,
    totalSlashed: 0n,
    penaltyCount: 0,
    registeredAt: 0n,
    lastProofAt: 0n,
    penaltyCursorAt: 0n,
    proofCount: 0n,
    updatedSlot: 0,
    blueprintHash: null,
    blueprintRevision: 0n,
    blueprintRecordCount: 0,
    accountLength: data.length,
  };
  const hostLen = u8();
  decoded.host = bytes(64).subarray(0, hostLen).toString("utf8");
  decoded.port = u16();
  decoded.useTls = u8() === 1;
  decoded.stakeAmount = u64();
  decoded.totalSlashed = u64();
  decoded.penaltyCount = u32();
  decoded.registeredAt = i64();
  decoded.lastProofAt = i64();
  decoded.penaltyCursorAt = i64();
  decoded.proofCount = u64();
  decoded.updatedSlot = u32();
  decoded.blueprintHash = bytes(16).toString("hex");
  decoded.blueprintRevision = u64();
  decoded.blueprintRecordCount = u32();
  u32();

  if (
    decoded.magic !== GUARDIAN_REGION_MAGIC
    || decoded.version !== 2
    || !decoded.owner.equals(GUARDIAN_GOVERNANCE_WALLET)
    || offset !== data.length
  ) {
    throw new Error("Invalid GuardianRegion data");
  }
  return decoded;
}

export function bigintJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function encodeGuardianHost(host: string): Buffer {
  const bytes = Buffer.from(host, "utf8");
  const valid = bytes.length > 0
    && bytes.length <= 64
    && bytes.every((byte) => (
      byte >= 0x30 && byte <= 0x39
      || byte >= 0x41 && byte <= 0x5a
      || byte >= 0x61 && byte <= 0x7a
      || byte === 0x2e
      || byte === 0x2d
      || byte === 0x5f
      || byte === 0x3a
      || byte === 0x5b
      || byte === 0x5d
    ));
  if (!valid) throw new Error("Guardian host must be a 1-64 byte hostname or IP without a URL scheme");
  return bytes;
}

function assertGuardianPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Guardian port must be an integer from 1 to 65535");
  }
}
