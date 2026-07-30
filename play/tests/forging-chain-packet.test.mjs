import assert from "node:assert/strict";
import test from "node:test";
import { ComputeBudgetProgram, Keypair, Transaction } from "@solana/web3.js";

import {
  createForgeEquipmentVerifiedInstruction,
  createSyncPlayerSkillsInstruction,
} from "../../src/chain/nicechunkChain.js";

test("the largest verified forge plus baseline and final skill sync fits one Solana packet", () => {
  const owner = Keypair.generate().publicKey;
  const backpack = Keypair.generate().publicKey;
  const forgeInstruction = createForgeEquipmentVerifiedInstruction({
    owner,
    backpack,
    itemId: 0xffff_ffff_ffff_fffen,
    codeBytes: new Uint8Array(640).fill(0xa5),
    inputIndexes: Array.from({ length: 24 }, (_unused, index) => index),
  });
  const playerProfile = forgeInstruction.keys[1].pubkey;
  const baselineInstruction = createSyncPlayerSkillsInstruction({
    payer: owner,
    owner,
    sourceAccounts: [playerProfile],
  });
  const finalSyncInstruction = createSyncPlayerSkillsInstruction({
    payer: owner,
    owner,
    sourceAccounts: [playerProfile, backpack],
  });
  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 320_000 }),
    baselineInstruction,
    forgeInstruction,
    finalSyncInstruction,
  );

  const packetLength = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).length;
  assert.ok(packetLength <= 1232, `largest forge transaction is ${packetLength} bytes`);
});
