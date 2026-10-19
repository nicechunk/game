import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createPlayGameState } from "../game-state.js";
import { createPlayChainPlayerSync } from "../play-chain-player.js";
import { decodeMiningDurabilityReceipt, encodeMiningToolReference, miningDurabilityFromTransaction } from "../../src/chain/miningDurability.js";
import { createMineBlockWithRewardsInstruction, derivePlayerEquipmentPda, loadConfirmedMiningEquipmentResult } from "../../src/chain/nicechunkChain.js";

const TOOL = { kind: "equipment", equipmentSlot: 2, itemPda: Keypair.generate().publicKey.toBase58() };

function receiptBytes(current = 17) {
  const data = Buffer.alloc(57);
  data.write("NCKDUR01"); data[8] = TOOL.equipmentSlot;
  data.writeUInt32LE(current, 9); data.writeUInt32LE(20, 13); data.writeBigUInt64LE(100n, 17);
  new PublicKey(TOOL.itemPda).toBuffer().copy(data, 25);
  return data;
}

test("mining requests identify a real slot and expose no damage amount", () => {
  const owner = Keypair.generate().publicKey;
  const options = { authority: owner, owner, backpack: Keypair.generate().publicKey,
    actionId: 1n, block: { x: 0, y: 8, z: 0 }, expectedBlockId: 4 };
  const instruction = createMineBlockWithRewardsInstruction({ ...options,
    miningTool: { ...TOOL, durability: 99999999, amount: 0 } });
  assert.equal(instruction.data.length, 22);
  assert.equal(instruction.data.at(-1), TOOL.equipmentSlot);
  assert.equal(instruction.keys[1].isWritable, true);
  assert.equal(instruction.keys.at(-1).pubkey.toBase58(), derivePlayerEquipmentPda(owner)[0].toBase58());
  assert.equal(encodeMiningToolReference({ kind: "equipment", equipmentSlot: 3,
    itemPda: Keypair.generate().publicKey, amount: 0 })[0], 3);
  assert.throws(() => encodeMiningToolReference({ kind: "equipment", equipmentSlot: 9 }), /equipped/);
  assert.throws(() => createMineBlockWithRewardsInstruction(options), /equipped/);
  assert.throws(() => encodeMiningToolReference({ kind: "starter" }), /equipped/);
  assert.throws(() => encodeMiningToolReference(), /equipped/);
});

test("only a successful mining program return can update durability", () => {
  const program = Keypair.generate().publicKey.toBase58();
  const encoded = receiptBytes().toString("base64");
  const tx = { meta: { err: null, logMessages: [`Program return: ${program} ${encoded}`] } };
  assert.equal(miningDurabilityFromTransaction(tx, program, TOOL)?.durabilityCurrent, 17);
  assert.equal(miningDurabilityFromTransaction({ meta: { ...tx.meta, err: { InstructionError: [1, "failure"] } } }, program, TOOL), null);
  assert.equal(miningDurabilityFromTransaction(tx, Keypair.generate().publicKey.toBase58(), TOOL), null);
  assert.equal(miningDurabilityFromTransaction({ meta: { err: null, logMessages: [`Program log: Program return: ${program} ${encoded}`] } }, program, TOOL), null);
  assert.equal(miningDurabilityFromTransaction({ meta: { err: null, logMessages: [`Program return: ${program} ${receiptBytes(0).toString("base64")}`] } }, program, TOOL).durabilityCurrent, 0);
  assert.equal(miningDurabilityFromTransaction(tx, program, { ...TOOL, itemPda: Keypair.generate().publicKey }), null);
  const retired = receiptBytes(); retired[8] = 255; retired.fill(0, 25);
  assert.equal(decodeMiningDurabilityReceipt(retired), null);
  const anonymous = receiptBytes(); anonymous.fill(0, 25);
  assert.equal(decodeMiningDurabilityReceipt(anonymous), null);
});

test("confirmation receipt delays preserve a successful transaction without local refunds", async () => {
  const owner = Keypair.generate().publicKey;
  const result = await loadConfirmedMiningEquipmentResult("already-confirmed", owner, undefined, {
    async getTransaction() { throw new Error("temporary RPC outage"); },
  });
  assert.equal(result.miningDurabilitySyncPending, true);
  assert.equal(result.miningDurability, undefined);
});

test("an old in-flight refresh cannot overwrite contract-returned durability", async () => {
  const owner = Keypair.generate().publicKey.toBase58();
  const state = createPlayGameState({ ownerAddress: owner });
  state.hotbarSlots[2] = { ...TOOL, itemId: "forged_item", custodySource: "equipment", durability: 20, maxDurability: 20 };
  let resolveProfile;
  const player = createPlayChainPlayerSync({ getWalletAddress: () => owner, getGameState: () => state,
    loadChainModule: async () => ({ fetchPlayerProfileForOwner: () => new Promise((resolve) => { resolveProfile = resolve; }) }),
  });
  const refresh = player.refresh({ force: true });
  await Promise.resolve();
  const outcome = { miningDurabilityOwner: owner, miningDurabilityReadSlot: 100,
    miningDurability: { ...TOOL, durabilityCurrent: 17, durabilityMax: 20 },
    playerProfileAfter: { initialized: true, owner } };
  assert.equal(player.applyMiningResult(outcome).changed, true);
  assert.equal(state.hotbarSlots[2].durability, 17);
  resolveProfile({ initialized: true, owner });
  assert.equal((await refresh).reason, "superseded-player-snapshot");
  assert.equal(state.hotbarSlots[2].durability, 17);
  assert.equal(player.applyMiningResult({ ...outcome, miningDurabilityReadSlot: 99 }).changed, false);
  assert.equal(player.applyMiningResult({ ...outcome, miningDurabilityOwner: "another-wallet" }).changed, false);
  state.applyAuthoritativeMiningDurability({ ...TOOL, durabilityCurrent: 0, durabilityMax: 20 });
  assert.equal(state.hotbarSlots[2].durability, 0);
  assert.equal(state.isUsableMiningToolSlot(state.hotbarSlots[2]), false);
});
