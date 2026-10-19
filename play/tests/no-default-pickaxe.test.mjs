import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  HOTBAR_STORAGE_KEY,
  createDefaultHotbarSlots,
  createPlayGameState,
  normalizeHotbarSlots,
  walletScopedPlayStorageKey,
} from "../game-state.js";
import { setForgedItemRuntime } from "../forged-item-interaction.js";
import { createMineBlockWithRewardsInstruction, loadConfirmedMiningEquipmentResult } from "../../src/chain/nicechunkChain.js";

const OWNER = "WalletNoStarterPickaxe";
const TOOL = {
  itemId: "forged_item", kind: "forged", source: "chain", owner: OWNER,
  chainItemId: "42", chainBackpack: "BackpackPda", chainIndex: 1,
  designHash: 123, itemPda: Keypair.generate().publicKey.toBase58(),
  custodySource: "equipment", equipmentSlot: 2, durability: 20, maxDurability: 20,
};

test("new accounts, refresh, cache clearing and wallet switches never grant a tool", () => {
  withStorage(() => {
    for (const ownerAddress of ["", OWNER, "another-wallet"]) {
      const state = createPlayGameState({ ownerAddress });
      assert.deepEqual(state.hotbarSlots, createDefaultHotbarSlots());
      assert.equal(state.hotbarSlots.filter(Boolean).length, 1, "only the backpack shortcut remains");
      assert.equal(state.getSelectedToolSlot(), null);
      assert.equal(state.getPrimaryToolSlot(), null);
      assert.equal(state.hotbarItems.iron_pickaxe, undefined);
      state.saveHotbarSlots();
      assert.deepEqual(createPlayGameState({ ownerAddress }).hotbarSlots, state.hotbarSlots);
      localStorage.clear();
      assert.deepEqual(createPlayGameState({ ownerAddress }).hotbarSlots, state.hotbarSlots);
      state.setOwnerAddress(`${ownerAddress}-switched`);
      assert.equal(state.getPrimaryToolSlot(), null);
    }
  });
});

test("retired cached grants disappear without removing an actual forged tool", () => {
  withStorage(() => {
    const slots = createDefaultHotbarSlots();
    slots[0] = { itemId: "iron_pickaxe", durability: 999999, maxDurability: 999999 };
    slots[2] = TOOL;
    localStorage.setItem(walletScopedPlayStorageKey(HOTBAR_STORAGE_KEY, OWNER), JSON.stringify(slots));
    const state = createPlayGameState({ ownerAddress: OWNER });
    assert.equal(state.hotbarSlots[0], null);
    assert.equal(state.hotbarSlots[2].itemPda, TOOL.itemPda);
    assert.equal(state.hotbarSlots[2].durability, 20);
    assert.equal(state.hotbarSlots[2].equipmentSlot, 2);
    const stored = JSON.parse(localStorage.getItem(walletScopedPlayStorageKey(HOTBAR_STORAGE_KEY, OWNER)));
    assert.equal(stored[0], null);
    assert.equal(stored[2].itemPda, TOOL.itemPda);
    assert.equal(normalizeHotbarSlots(normalizeHotbarSlots(slots))[0], null);
    assert.equal(state.applyAuthoritativeMiningDurability({ kind: "starter", durabilityCurrent: 999, durabilityMax: 999 }), false);
    assert.equal(state.hotbarSlots.some((slot) => slot?.itemId === "iron_pickaxe"), false);
  });
});

test("legacy global migration preserves owned tools without reviving the default grant", () => {
  withStorage(() => {
    const slots = createDefaultHotbarSlots();
    slots[0] = { itemId: "iron_pickaxe", durability: 999, maxDurability: 999 };
    slots[2] = TOOL;
    localStorage.setItem(HOTBAR_STORAGE_KEY, JSON.stringify(slots));
    const state = createPlayGameState({ ownerAddress: OWNER });
    assert.equal(state.hotbarSlots[0], null);
    assert.equal(state.hotbarSlots[2].itemPda, TOOL.itemPda);
    assert.equal(createPlayGameState({ ownerAddress: "different-wallet" }).getPrimaryToolSlot(), null);
  });
});

test("mining requires a custodied tool and receipts update only the identified equipment slot", () => {
  const state = createPlayGameState({ ownerAddress: OWNER });
  const tool = { ...TOOL };
  const anotherCopy = { ...TOOL, equipmentSlot: 3, chainItemId: "43" };
  state.hotbarSlots[2] = tool;
  state.hotbarSlots[3] = anotherCopy;
  const runtime = { kind: "ncf1-forge-runtime-v1", designHash: TOOL.designHash,
    mesh: { vertices: new Float32Array(3), indices: [0] },
    grip: { offsetQ: [0, 0, 0], axis: 0, sign: 1, rotation: 0 } };
  setForgedItemRuntime(tool, runtime);
  assert.equal(state.isUsableMiningToolSlot(tool), true);
  assert.equal(state.isUsableMiningToolSlot({ itemId: "iron_pickaxe", durability: 999, durabilityKnown: false }), false);
  assert.equal(state.isUsableMiningToolSlot({ ...tool, custodySource: "backpack" }), false);
  assert.equal(state.applyAuthoritativeMiningDurability({ kind: "equipment", equipmentSlot: 2,
    itemPda: TOOL.itemPda, durabilityCurrent: 17, durabilityMax: 20 }), true);
  assert.equal(tool.durability, 17);
  assert.equal(anotherCopy.durability, 20, "different items sharing a design PDA keep separate balances");
});

test("legacy profile reserved bytes cannot advertise or recreate a default tool", async () => {
  const owner = Keypair.generate().publicKey;
  const miningTool = { kind: "equipment", equipmentSlot: 2, itemPda: TOOL.itemPda };
  const instruction = createMineBlockWithRewardsInstruction({ authority: owner, owner,
    backpack: Keypair.generate().publicKey, actionId: 1n, block: { x: 0, y: 8, z: 0 }, expectedBlockId: 4, miningTool });
  const profile = Buffer.alloc(773);
  profile.write("NCKPLY01"); profile.writeUInt16LE(7, 8); profile[11] = 1; profile[102] = 9;
  owner.toBuffer().copy(profile, 12);
  profile.write("DUR1", 765); profile.writeUInt32LE(999, 769);
  const receipt = Buffer.alloc(57);
  receipt.write("NCKDUR01"); receipt[8] = 2;
  receipt.writeUInt32LE(17, 9); receipt.writeUInt32LE(20, 13); receipt.writeBigUInt64LE(100n, 17);
  new PublicKey(TOOL.itemPda).toBuffer().copy(receipt, 25);
  const result = await loadConfirmedMiningEquipmentResult("confirmed", owner, miningTool, {
    async getTransaction() { return { slot: 100, meta: { err: null,
      returnData: { programId: instruction.programId.toBase58(), data: [receipt.toString("base64"), "base64"] } } }; },
    async getMultipleAccountsInfoAndContext() { return { context: { slot: 101 }, value: [
      { owner: instruction.keys.at(-2).pubkey, data: profile }, null,
    ] }; },
  });
  const decoded = result.playerProfileAfter;
  assert.equal(decoded.owner, owner.toBase58());
  assert.equal(Object.hasOwn(decoded, "starterMiningDurability"), false);
});

function withStorage(run) {
  const previous = globalThis.localStorage;
  const data = new Map();
  globalThis.localStorage = {
    getItem: (key) => data.get(String(key)) ?? null,
    setItem: (key, value) => data.set(String(key), String(value)),
    removeItem: (key) => data.delete(String(key)),
    clear: () => data.clear(),
  };
  try { run(); } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
}
