import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  createBuyMarketListingInstruction,
  createCancelMarketListingInstruction,
  createTransferPlayerEquipmentSlotInstruction,
  deriveGlobalConfigPda,
  deriveMarketUserPda,
  deriveMaterialPhysicsPda,
} from "../../src/chain/nicechunkChain.js";

const gameProgram = new PublicKey("6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7");

test("browser derives the canonical Material Physics v2 PDA", () => {
  const globalConfig = deriveGlobalConfigPda();
  const [expected] = PublicKey.findProgramAddressSync(
    [Buffer.from("material-physics-v2"), globalConfig.toBuffer()],
    gameProgram,
  );

  assert.equal(deriveMaterialPhysicsPda()[0].toBase58(), expected.toBase58());
});

test("equipment transfer passes Material Physics before the system program", () => {
  const authority = Keypair.generate().publicKey;
  const backpack = Keypair.generate().publicKey;
  const instruction = createTransferPlayerEquipmentSlotInstruction({
    authority,
    playerProfile: Keypair.generate().publicKey,
    playerEquipment: Keypair.generate().publicKey,
    backpack,
    slot: 2,
    backpackIndex: 4,
  });
  const [materialPhysics] = deriveMaterialPhysicsPda();

  assert.equal(instruction.keys.length, 9);
  assert.equal(instruction.keys[4].pubkey.toBase58(), materialPhysics.toBase58());
  assert.equal(instruction.keys[5].pubkey.toBase58(), SystemProgram.programId.toBase58());
  assert.equal(instruction.keys[6].pubkey.toBase58(), backpack.toBase58());
  assert.equal(instruction.keys[7].pubkey.toBase58(), gameProgram.toBase58());
});

test("market returns and purchases pass Material Physics and GlobalConfig", () => {
  const seller = Keypair.generate().publicKey;
  const buyer = Keypair.generate().publicKey;
  const listing = Keypair.generate().publicKey;
  const backpack = Keypair.generate().publicKey;
  const [materialPhysics] = deriveMaterialPhysicsPda();
  const globalConfig = deriveGlobalConfigPda();
  const [sellerMarketUser] = deriveMarketUserPda(seller);
  const [buyerMarketUser] = deriveMarketUserPda(buyer);

  const cancel = createCancelMarketListingInstruction({
    seller,
    listing,
    sourceInventory: backpack,
    marketUser: sellerMarketUser,
  });
  assert.equal(cancel.keys.length, 8);
  assert.equal(cancel.keys[5].pubkey.toBase58(), materialPhysics.toBase58());
  assert.equal(cancel.keys[6].pubkey.toBase58(), globalConfig.toBase58());
  assert.equal(cancel.keys[7].pubkey.toBase58(), sellerMarketUser.toBase58());

  const buy = createBuyMarketListingInstruction({
    buyer,
    seller,
    listing,
    currency: "SOL",
    buyerBackpackAddress: backpack,
    sellerMarketUser,
    buyerMarketUser,
  });
  assert.equal(buy.keys.length, 12);
  assert.equal(buy.keys[8].pubkey.toBase58(), materialPhysics.toBase58());
  assert.equal(buy.keys[9].pubkey.toBase58(), globalConfig.toBase58());
  assert.equal(buy.keys[10].pubkey.toBase58(), sellerMarketUser.toBase58());
  assert.equal(buy.keys[11].pubkey.toBase58(), buyerMarketUser.toBase58());
  assert.equal(buy.keys[10].isWritable, true);
  assert.equal(buy.keys[11].isWritable, false);
});

test("market cancellation rejects a missing destination Backpack", () => {
  assert.throws(() => createCancelMarketListingInstruction({
    seller: Keypair.generate().publicKey,
    listing: Keypair.generate().publicKey,
  }), /destination Backpack PDA/);
});
