import assert from "node:assert/strict";
import test from "node:test";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  BLANK_LAND_CONTRACT_PRICE_BASE_UNITS,
  compareMarketListingPrices,
  createBuyTreasuryContractInstruction,
  createTreasurySwapInstruction,
  createJoinMarketInstruction,
  createMarketListingInstruction,
  decodeBackpack,
  decodeForgedItem,
  decodeMarketListing,
  decodeMarketUserState,
  decodeTreasurySwapState,
  decodePlayerEquipment,
  deriveForgedItemPda,
  deriveGlobalConfigPda,
  deriveMarketUserPda,
  deriveTreasurySwapPdas,
  derivePlayerEquipmentPda,
  derivePlayerProfilePda,
  isNonTransferableMarketSourceSlot,
  parseMarketPriceBaseUnits,
  parseTreasurySwapAmountBaseUnits,
  quoteTreasurySwap,
} from "../../src/chain/nicechunkChain.js";

const GAME_PROGRAM = new PublicKey("6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7");
const PLAYER_PROGRAM = new PublicKey("CHZHsBCGn58ih2WrPfKSYhvCEjMPGhArTiYCH7AWWBkB");
const DEFAULT_KEY = PublicKey.default.toBase58();
const MASS_VALID_FLAG = 1 << 15;

test("market prices preserve exact token and lamport precision", () => {
  assert.equal(parseMarketPriceBaseUnits("0.000001", "NCK"), 1n);
  assert.equal(parseMarketPriceBaseUnits("0.000000001", "SOL"), 1n);
  assert.equal(parseMarketPriceBaseUnits("18446744073.709551615", "SOL"), 18_446_744_073_709_551_615n);
  assert.throws(() => parseMarketPriceBaseUnits(0.000000001, "SOL"), /Invalid market listing price/);
  assert.throws(() => parseMarketPriceBaseUnits("0.0000001", "NCK"), /at most 6 decimal places/);
  assert.throws(() => parseMarketPriceBaseUnits("9".repeat(1_000), "SOL"), /Invalid market listing price/);
  assert.equal(compareMarketListingPrices(
    { currency: "SOL", price: "18446744073.709551614", priceBaseUnits: "18446744073709551614" },
    { currency: "SOL", price: "18446744073.709551615", priceBaseUnits: "18446744073709551615" },
  ), -1);
});

test("market listing instructions use exact final account layouts", () => {
  const seller = Keypair.generate().publicKey;
  const listing = Keypair.generate().publicKey;
  const backpack = Keypair.generate().publicKey;
  const common = {
    seller,
    listing,
    listingId: 42n,
    currency: "NCK",
    priceBaseUnits: 1_000_000n,
  };

  const backpackListing = createMarketListingInstruction({
    ...common,
    sourceType: "backpack",
    sourceIndex: 7,
    sourceInventory: backpack,
  });
  assert.equal(backpackListing.programId.toBase58(), GAME_PROGRAM.toBase58());
  assert.equal(backpackListing.data.readUInt8(0), 4, "Game namespace");
  assert.equal(backpackListing.data.readUInt8(1), 0, "Market create-listing tag");
  assert.equal(backpackListing.keys.length, 6);
  assert.deepEqual(
    backpackListing.keys.map((key) => key.pubkey.toBase58()),
    [
      seller.toBase58(),
      listing.toBase58(),
      SystemProgram.programId.toBase58(),
      backpack.toBase58(),
      GAME_PROGRAM.toBase58(),
      deriveMarketUserPda(seller)[0].toBase58(),
    ],
  );

  const equipmentListing = createMarketListingInstruction({
    ...common,
    sourceType: "equipment",
    sourceIndex: 3,
  });
  const [playerProfile] = derivePlayerProfilePda(seller);
  const [playerEquipment] = derivePlayerEquipmentPda(seller);
  assert.equal(equipmentListing.keys.length, 8);
  assert.deepEqual(
    equipmentListing.keys.map((key) => key.pubkey.toBase58()),
    [
      seller.toBase58(),
      listing.toBase58(),
      SystemProgram.programId.toBase58(),
      playerProfile.toBase58(),
      playerEquipment.toBase58(),
      deriveGlobalConfigPda().toBase58(),
      PLAYER_PROGRAM.toBase58(),
      deriveMarketUserPda(seller)[0].toBase58(),
    ],
  );
  assert.equal(equipmentListing.keys[3].isWritable, true);
  assert.equal(equipmentListing.keys[4].isWritable, true);

  assert.throws(() => createMarketListingInstruction({
    ...common,
    sourceType: "equipment",
    sourceIndex: 9,
  }), /Invalid equipment market source index/);
  assert.throws(() => createMarketListingInstruction({
    ...common,
    sourceType: "backpack",
    sourceIndex: 0,
  }), /source Backpack PDA/);
});

test("market membership instruction creates only the owner-funded membership PDA", () => {
  const owner = Keypair.generate().publicKey;
  const join = createJoinMarketInstruction({ owner });
  assert.equal(join.data.readUInt8(0), 4, "Game namespace");
  assert.equal(join.data.readUInt8(1), 3, "Market join tag");
  assert.deepEqual(join.keys.map((key) => key.pubkey.toBase58()), [
    owner.toBase58(),
    deriveMarketUserPda(owner)[0].toBase58(),
    SystemProgram.programId.toBase58(),
  ]);
});

test("market transfer guards reject retired Blueprint records", () => {
  assert.equal(isNonTransferableMarketSourceSlot({
    kindCode: 2,
    category: 3,
    itemCode: 9,
  }), true);
  assert.equal(isNonTransferableMarketSourceSlot({
    kindCode: 2,
    category: 2,
    itemCode: 8,
  }), false);
});

test("final Backpack and PlayerEquipment decoders reject retired layouts", () => {
  const backpack = emptyBackpackAccount();
  const decodedBackpack = decodeBackpack(backpack);
  assert.equal(decodedBackpack.initialized, true);
  assert.equal(decodedBackpack.capacity, 50);
  assert.equal(decodedBackpack.itemCount, 0);

  const uninitializedBackpack = Buffer.from(backpack);
  uninitializedBackpack[11] = 0;
  assert.throws(() => decodeBackpack(uninitializedBackpack), /layout or mass state/);
  const invalidCapacity = Buffer.from(backpack);
  invalidCapacity[52] = 0;
  assert.throws(() => decodeBackpack(invalidCapacity), /layout or mass state/);

  const equipment = emptyPlayerEquipmentAccount();
  const decodedEquipment = decodePlayerEquipment(equipment);
  assert.equal(decodedEquipment.initialized, true);
  assert.equal(decodedEquipment.slotCount, 9);
  assert.ok(decodedEquipment.slots.every((slot) => !slot.equipped));

  const uninitializedEquipment = Buffer.from(equipment);
  uninitializedEquipment[11] = 0;
  assert.throws(() => decodePlayerEquipment(uninitializedEquipment), /initialized false/);
});

test("ForgedItem decoder accepts only immutable NCF1 v15 account data", () => {
  const creator = Keypair.generate().publicKey;
  const originBackpack = Keypair.generate().publicKey;
  const itemId = 77n;
  const [forgedItem, bump] = deriveForgedItemPda(creator, itemId);
  const codeBytes = Buffer.from([0xf0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  const data = Buffer.alloc(752);
  data.write("NCKFGI01", 0, "utf8");
  data.writeUInt16LE(1, 8);
  data.writeUInt8(bump, 10);
  data.writeUInt8(1, 11);
  data.writeBigUInt64LE(itemId, 12);
  creator.toBuffer().copy(data, 20);
  originBackpack.toBuffer().copy(data, 52);
  data.writeUInt32LE(fnv1a32(codeBytes), 84);
  data.writeUInt16LE(codeBytes.length, 88);
  codeBytes.copy(data, 96);
  data.writeBigUInt64LE(123n, 736);
  data.writeBigInt64LE(456n, 744);

  const decoded = decodeForgedItem(data);
  assert.equal(decoded.itemId, itemId.toString());
  assert.equal(decoded.creator, creator.toBase58());
  assert.equal(decoded.originBackpack, originBackpack.toBase58());
  assert.deepEqual(decoded.codeBytes, codeBytes);
  assert.equal(deriveForgedItemPda(new PublicKey(decoded.creator), decoded.itemId)[0].toBase58(), forgedItem.toBase58());

  const retired = Buffer.from(data);
  retired[96] = 0xe0;
  retired.writeUInt32LE(fnv1a32(retired.subarray(96, 96 + codeBytes.length)), 84);
  assert.throws(() => decodeForgedItem(retired), /NCF1 version/);
  const wrongHash = Buffer.from(data);
  wrongHash[84] ^= 1;
  assert.throws(() => decodeForgedItem(wrongHash), /model hash/);
});

test("MarketListing decoder rejects non-final state and preserves escrow source", () => {
  const seller = Keypair.generate().publicKey;
  const data = Buffer.alloc(216);
  data.write("NCKMKT01", 0, "utf8");
  data.writeUInt16LE(5, 8);
  data.writeUInt8(1, 11);
  seller.toBuffer().copy(data, 12);
  data.writeBigUInt64LE(91n, 44);
  data.writeUInt8(1, 52);
  data.writeUInt8(2, 53);
  data.writeBigUInt64LE(1_000_000n, 54);
  data.writeUInt8(1, 62);
  data.writeUInt16LE(MASS_VALID_FLAG, 64);
  data.writeUInt32LE(1, 66);
  data.writeUInt8(2, 214);

  const decoded = decodeMarketListing(data);
  assert.equal(decoded.version, 5);
  assert.equal(decoded.source, "equipment");
  assert.equal(decoded.sourceIndex, 2);
  assert.equal(decoded.sourceSlot.kind, "block");

  const retired = Buffer.from(data);
  retired.writeUInt16LE(4, 8);
  assert.throws(() => decodeMarketListing(retired), /layout/);
});

test("Market user decoder exposes available and reserved land-contract balances", () => {
  const owner = Keypair.generate().publicKey;
  const [marketUser, marketUserBump] = deriveMarketUserPda(owner);
  const userData = Buffer.alloc(64);
  userData.write("NCKMUS01", 0, "utf8");
  userData.writeUInt16LE(1, 8);
  userData.writeUInt8(marketUserBump, 10);
  userData.writeUInt8(50, 11);
  owner.toBuffer().copy(userData, 12);
  userData.writeBigUInt64LE(1234n, 44);
  userData.writeUInt32LE(17, 52);
  userData.writeUInt32LE(3, 56);

  const decodedUser = decodeMarketUserState(userData);
  assert.equal(decodedUser.owner, owner.toBase58());
  assert.equal(decodedUser.activeListingCount, 50);
  assert.equal(decodedUser.maxActiveListings, 50);
  assert.equal(decodedUser.updatedSlot, "1234");
  assert.equal(decodedUser.blankLandContracts, 17);
  assert.equal(decodedUser.reservedBlankLandContracts, 3);
  assert.equal(deriveMarketUserPda(owner)[0].toBase58(), marketUser.toBase58());

  const overLimit = Buffer.from(userData);
  overLimit.writeUInt8(51, 11);
  assert.throws(() => decodeMarketUserState(overLimit), /layout/);
  const nonZeroReserved = Buffer.from(userData);
  nonZeroReserved[60] = 1;
  assert.throws(() => decodeMarketUserState(nonZeroReserved), /layout/);
  assert.throws(() => decodeMarketUserState(Buffer.alloc(328)), /expected 64/);
});

test("treasury land-contract purchases use a fixed 10 NCK price and no Listing PDA", () => {
  const buyer = Keypair.generate().publicKey;
  const marketUser = Keypair.generate().publicKey;
  const buyerNckToken = Keypair.generate().publicKey;
  const treasuryNckToken = Keypair.generate().publicKey;
  const instruction = createBuyTreasuryContractInstruction({
    buyer,
    marketUser,
    buyerNckToken,
    treasuryNckToken,
    quantity: 7,
  });

  assert.equal(BLANK_LAND_CONTRACT_PRICE_BASE_UNITS, 10_000_000n);
  assert.equal(instruction.data.length, 7);
  assert.equal(instruction.data.readUInt8(0), 4, "Game market namespace");
  assert.equal(instruction.data.readUInt8(1), 4, "Treasury contract purchase tag");
  assert.equal(instruction.data.readUInt8(2), 1, "Blank land contract type");
  assert.equal(instruction.data.readUInt32LE(3), 7);
  assert.equal(instruction.keys.length, 6);
  assert.deepEqual(instruction.keys.slice(0, 4).map((key) => key.pubkey.toBase58()), [
    buyer.toBase58(),
    marketUser.toBase58(),
    buyerNckToken.toBase58(),
    treasuryNckToken.toBase58(),
  ]);
  assert.equal(instruction.keys[5].pubkey.toBase58(), TOKEN_PROGRAM_ID.toBase58());
  assert.throws(() => createBuyTreasuryContractInstruction({
    buyer,
    marketUser,
    buyerNckToken,
    treasuryNckToken,
    quantity: 0,
  }), /contract quantity/);
  assert.throws(() => createBuyTreasuryContractInstruction({
    buyer,
    marketUser,
    buyerNckToken,
    treasuryNckToken,
    quantity: 4_097,
  }), /contract quantity/);
});

test("Treasury Swap instructions lock quote revision, deadline, and exact PDA accounts", () => {
  const user = Keypair.generate().publicKey;
  const userNckToken = Keypair.generate().publicKey;
  const pdas = deriveTreasurySwapPdas();
  const common = {
    user,
    userNckToken,
    amountIn: 100_000_000n,
    minimumAmountOut: 4_000_000n,
    expectedRevision: 7n,
    deadlineSlot: 9_999n,
  };
  const buyNck = createTreasurySwapInstruction({ ...common, direction: "SOL_TO_NCK" });
  assert.equal(buyNck.programId.toBase58(), GAME_PROGRAM.toBase58());
  assert.equal(buyNck.data.length, 34);
  assert.equal(buyNck.data.readUInt8(0), 4, "Game market namespace");
  assert.equal(buyNck.data.readUInt8(1), 14, "SOL to NCK tag");
  assert.equal(buyNck.data.readBigUInt64LE(2), 100_000_000n);
  assert.equal(buyNck.data.readBigUInt64LE(10), 4_000_000n);
  assert.equal(buyNck.data.readBigUInt64LE(18), 7n);
  assert.equal(buyNck.data.readBigUInt64LE(26), 9_999n);
  assert.deepEqual(buyNck.keys.map((key) => key.pubkey.toBase58()), [
    user.toBase58(),
    pdas.state[0].toBase58(),
    pdas.solVault[0].toBase58(),
    pdas.authority[0].toBase58(),
    pdas.nckVault[0].toBase58(),
    userNckToken.toBase58(),
    "HSnWF5kjkWVrceW2SaSskScuLveUZE4gpthZ2ZXRPQPo",
    SystemProgram.programId.toBase58(),
    TOKEN_PROGRAM_ID.toBase58(),
  ]);
  assert.deepEqual(buyNck.keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]), [
    [true, true], [false, true], [false, true], [false, false], [false, true],
    [false, true], [false, false], [false, false], [false, false],
  ]);

  const sellNck = createTreasurySwapInstruction({
    ...common,
    direction: "NCK_TO_SOL",
    amountIn: 4_000_000n,
    minimumAmountOut: 100_000_000n,
  });
  assert.equal(sellNck.data.readUInt8(1), 15, "NCK to SOL tag");
  assert.deepEqual(sellNck.keys.map((key) => key.pubkey.toBase58()), [
    user.toBase58(),
    pdas.state[0].toBase58(),
    pdas.solVault[0].toBase58(),
    pdas.nckVault[0].toBase58(),
    userNckToken.toBase58(),
    "HSnWF5kjkWVrceW2SaSskScuLveUZE4gpthZ2ZXRPQPo",
    TOKEN_PROGRAM_ID.toBase58(),
  ]);
  assert.throws(() => createTreasurySwapInstruction({ ...common, direction: "INVALID" }), /direction/);
  assert.throws(() => createTreasurySwapInstruction({ ...common, amountIn: 0n, direction: "SOL_TO_NCK" }), /nonzero unsigned/);
});

test("Treasury Swap state decoder and BigInt quotes preserve fixed-price invariants", () => {
  const pdas = deriveTreasurySwapPdas();
  const data = Buffer.alloc(160);
  data.write("NCKSWP01", 0, "utf8");
  data.writeUInt16LE(1, 8);
  data.writeUInt8(pdas.state[1], 10);
  data.writeUInt8(pdas.authority[1], 11);
  data.writeUInt8(pdas.solVault[1], 12);
  data.writeUInt8(pdas.nckVault[1], 13);
  data.writeUInt8(0, 14);
  data.writeUInt16LE(100, 16);
  new PublicKey("CtPV2vmqNNwUSfMu5nz58ZtMPy6ZvxL4LyNdPHVW7WvF").toBuffer().copy(data, 24);
  new PublicKey("HSnWF5kjkWVrceW2SaSskScuLveUZE4gpthZ2ZXRPQPo").toBuffer().copy(data, 56);
  data.writeBigUInt64LE(25_000_000n, 88);
  data.writeBigUInt64LE(1n, 96);
  data.writeBigUInt64LE(1_000_000_000n, 104);
  data.writeBigUInt64LE(3n, 112);
  data.writeBigUInt64LE(99n, 120);

  const state = decodeTreasurySwapState(data);
  assert.equal(state.revision, "3");
  assert.equal(state.feeBps, 100);
  assert.deepEqual(quoteTreasurySwap({
    direction: "SOL_TO_NCK",
    amountInBaseUnits: parseTreasurySwapAmountBaseUnits("0.1", "SOL"),
    state,
  }), {
    direction: "SOL_TO_NCK",
    inputCurrency: "SOL",
    outputCurrency: "NCK",
    amountInBaseUnits: "100000000",
    grossAmountOutBaseUnits: "4000000",
    amountOutBaseUnits: "3960000",
    feeBaseUnits: "40000",
    amountOut: "3.96",
    fee: "0.04",
  });
  assert.equal(quoteTreasurySwap({
    direction: "NCK_TO_SOL",
    amountInBaseUnits: 4_000_000n,
    state,
  }).amountOutBaseUnits, "99000000");
  assert.equal(parseTreasurySwapAmountBaseUnits("0.000000001", "SOL"), 1n);
  assert.equal(parseTreasurySwapAmountBaseUnits("0.000001", "NCK"), 1n);
  assert.throws(() => parseTreasurySwapAmountBaseUnits("1e3", "SOL"), /valid Treasury Swap/);
  assert.throws(() => parseTreasurySwapAmountBaseUnits("0.0000001", "NCK"), /at most 6/);

  const forgedTreasury = Buffer.from(data);
  Keypair.generate().publicKey.toBuffer().copy(forgedTreasury, 24);
  assert.throws(() => decodeTreasurySwapState(forgedTreasury), /treasury or NCK mint mismatch/);
  const retired = Buffer.from(data);
  retired.writeUInt16LE(2, 8);
  assert.throws(() => decodeTreasurySwapState(retired), /layout/);
  for (const offset of [15, 18, 23]) {
    const noncanonical = Buffer.from(data);
    noncanonical[offset] = 1;
    assert.throws(() => decodeTreasurySwapState(noncanonical), /layout/);
  }
  assert.throws(() => quoteTreasurySwap({
    direction: "SOL_TO_NCK",
    amountInBaseUnits: 0x1_0000_0000_0000_0000n,
    state,
  }), /parameters/);
});

function emptyBackpackAccount() {
  const data = Buffer.alloc(8_048);
  data.write("NCKBPK01", 0, "utf8");
  data.writeUInt16LE(4, 8);
  data.writeUInt8(1, 11);
  data.writeBigUInt64LE(1n, 12);
  Keypair.generate().publicKey.toBuffer().copy(data, 20);
  data.writeUInt8(50, 52);
  data.writeUInt8(0, 53);
  data.writeUInt8(1, 54);
  data.writeUInt8(1, 55);
  return data;
}

function emptyPlayerEquipmentAccount() {
  const data = Buffer.alloc(7_040);
  data.write("NCKEQP01", 0, "utf8");
  data.writeUInt16LE(1, 8);
  data.writeUInt8(1, 11);
  Keypair.generate().publicKey.toBuffer().copy(data, 12);
  Keypair.generate().publicKey.toBuffer().copy(data, 44);
  Keypair.generate().publicKey.toBuffer().copy(data, 76);
  data.writeUInt8(9, 108);
  for (let slot = 0; slot < 9; slot += 1) {
    const offset = 128 + slot * 768;
    data.writeUInt8(slot, offset + 1);
    data.writeUInt8(255, offset + 2);
    assert.equal(new PublicKey(data.subarray(offset + 8, offset + 40)).toBase58(), DEFAULT_KEY);
  }
  return data;
}

function fnv1a32(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
