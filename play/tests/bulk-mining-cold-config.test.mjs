import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { deriveGlobalConfigPda, recordBulkMineOnChain } from "../../src/chain/nicechunkChain.js";

test("a cold 640-block bulk action reads world config once within a finite RPC allowance", async () => {
  const previous = { window: globalThis.window, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  const owner = Keypair.generate().publicKey;
  const backpack = Keypair.generate().publicKey;
  const values = new Map([["nicechunk.walletAddress", owner.toBase58()], ["nicechunk.devnetRpcUrl", "https://rpc.example.invalid/"]]);
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
  globalThis.window = { solana: { publicKey: owner, network: "devnet", connect: async () => ({ publicKey: owner }) } };
  const data = Buffer.alloc(293);
  data.write("NCKCFG01"); data.writeUInt16LE(1, 8); data[11] = 1;
  data.writeUInt16LE(16, 259); data.writeUInt16LE(16, 261); data.writeInt16LE(-32, 263);
  data.writeInt16LE(320, 265); data.writeInt16LE(240, 267); data.writeInt16LE(96, 269);
  const globalAddress = deriveGlobalConfigPda().toBase58();
  let configReads = 0, placedReads = 0, active = 0, peak = 0, broadcasts = 0;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.method === "sendTransaction") broadcasts++;
    if (request.method === "getMultipleAccounts") {
      placedReads++;
      assert.equal(request.params[0].length, 1, "one placed-state account per unique chunk");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { context: { slot: 100 }, value: request.params[0].map(() => null) } }), { status: 200 });
    }
    assert.equal(request.method, "getAccountInfo");
    let value = null;
    if (request.params[0] === globalAddress) {
      configReads++; active++; peak = Math.max(peak, active);
      const permitted = configReads <= 4;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (!permitted) return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32005, message: "Fixture RPC allowance exhausted by duplicate config reads" } }), { status: 200 });
      value = { owner: "9EhMCRYMJej1F21KzaA5Zao3khGGc5aJbDGbnxaogQHu", data: [data.toString("base64"), "base64"], executable: false, lamports: 1, rentEpoch: 0 };
    } else assert.equal(request.params[0], backpack.toBase58(), "stop before signing when the fixture has no backpack");
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { context: { slot: 100 }, value } }), { status: 200 });
  };
  try {
    const blocks = Array.from({ length: 640 }, (_, index) => ({ x: index % 16, y: -20 + Math.floor(index / 128), z: Math.floor(index / 16) % 8, blockId: 4 }));
    const result = await recordBulkMineOnChain(blocks, { mode: "debug", backpackAddress: backpack.toBase58() });
    assert.equal(result.reason, "no-backpack");
    assert.equal(configReads, 1, "all selected blocks share one world config snapshot");
    assert.equal(placedReads, 1, "the selection must not read placed state once per block");
    assert.equal(peak, 1);
    assert.equal(broadcasts, 0);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
});
