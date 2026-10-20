import assert from "node:assert/strict";
import test from "node:test";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import * as chain from "../../src/chain/nicechunkChain.js";
import { canonicalBlockIdAt } from "../../src/world/canonicalResource.js";
import * as bulk from "../../src/chain/bulkMiningSubmission.js";
const { BULK_MINING_PLACED_BATCH_SIZE, partitionBulkMiningOperations, submitBulkMiningRanges } = bulk;

const key = () => Keypair.generate().publicKey;
const coordinateKey = ({ x, y, z }) => `${x},${y},${z}`;
const chunkKey = ({ x, z }) => `${Math.floor(x / 16)},${Math.floor(z / 16)}`;

function placedAccount(blocks) {
  const data = Buffer.alloc(16 + 9 * Math.max(1, blocks.length));
  data.write("NCPB"); data[4] = 1;
  data.writeUInt16LE(blocks.length, 6); data.writeUInt16LE(Math.max(1, blocks.length), 8);
  data.writeInt16LE(-32, 10);
  blocks.forEach((block, index) => {
    const offset = 16 + 9 * index;
    data.writeUIntLE((block.x & 15) | ((block.z & 15) << 4) | ((block.y + 32) << 8), offset, 3);
    data.writeUInt16LE(block.blockId, offset + 3);
    data.writeUInt32LE(block.volumeMm3, offset + 5);
  });
  return { data, owner: new PublicKey(chain.getNicechunkDiscoveryContext().chunkProgram), executable: false };
}

async function withRpcFixture(placed, run) {
  const previous = { window: globalThis.window, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  const owner = key(), backpack = key();
  const values = new Map([["nicechunk.walletAddress", owner.toBase58()], ["nicechunk.devnetRpcUrl", "https://rpc.example.invalid/"]]);
  globalThis.localStorage = { getItem: (name) => values.get(name) ?? null, setItem: (name, value) => values.set(name, String(value)), removeItem: (name) => values.delete(name) };
  globalThis.window = { solana: { publicKey: owner, network: "devnet", connect: async () => ({ publicKey: owner }) } };
  const byChunk = new Map();
  for (const block of placed) {
    const id = chunkKey(block);
    if (!byChunk.has(id)) byChunk.set(id, []);
    byChunk.get(id).push(block);
  }
  const accounts = new Map([...byChunk].map(([chunk, blocks]) => {
    const [x, z] = chunk.split(",").map(Number);
    return [chain.deriveChunkPlacedPda(x, z)[0].toBase58(), placedAccount(blocks)];
  }));
  const calls = { config: 0, placed: [], broadcasts: 0 };
  const config = Buffer.alloc(293);
  config.write("NCKCFG01"); config.writeUInt16LE(1, 8); config[11] = 1;
  config.writeUInt16LE(16, 259); config.writeUInt16LE(16, 261); config.writeInt16LE(-32, 263);
  config.writeInt16LE(320, 265); config.writeInt16LE(240, 267); config.writeInt16LE(96, 269);
  const wireAccount = (account) => account ? { ...account, owner: account.owner.toBase58(), lamports: 1, rentEpoch: 0, data: [account.data.toString("base64"), "base64"] } : null;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    let value;
    if (request.method === "getMultipleAccounts") {
      calls.placed.push(request.params[0]);
      value = request.params[0].map((address) => wireAccount(accounts.get(address)));
    } else if (request.method === "getAccountInfo" && request.params[0] === chain.deriveGlobalConfigPda().toBase58()) {
      calls.config++;
      value = wireAccount({ data: config, owner: new PublicKey("9EhMCRYMJej1F21KzaA5Zao3khGGc5aJbDGbnxaogQHu"), executable: false });
    } else if (request.method === "getAccountInfo" && request.params[0] === backpack.toBase58()) value = null;
    else {
      if (request.method === "sendTransaction") calls.broadcasts++;
      assert.fail(`Unexpected fixture RPC: ${request.method}`);
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { context: { slot: 100 }, value } }));
  };
  try { await run({ owner, backpack, calls, accounts }); }
  finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
}

test("placed resources in air reach the bulk reclaim path before signing", async () => {
  const placed = [{ x: -1, y: 250, z: -17, blockId: 3, volumeMm3: 1234567 }];
  assert.equal(canonicalBlockIdAt({ config: chain.getNicechunkDiscoveryContext().world, ...placed[0] }), 0);
  await withRpcFixture(placed, async ({ backpack, calls }) => {
    const result = await chain.recordBulkMineOnChain(placed.map((block) => ({ ...block, blockId: 1, placed: false })), { mode: "debug", backpackAddress: backpack.toBase58() });
    assert.equal(result.reason, "no-backpack", "a placed resource must not be rejected as unmineable natural air");
    assert.equal(calls.config, 0);
    assert.equal(calls.placed.flat().length, 1);
    assert.equal(calls.broadcasts, 0);
  });
});

test("mixed selections use placed records before generation, preserving exact volume and ignoring caller flags", async () => {
  const placed = [
    { x: -1, y: 250, z: -17, blockId: 3, volumeMm3: 1234567 },
    { x: 0, y: -20, z: 0, blockId: 1, volumeMm3: 4194303 },
  ];
  const natural = { x: 1, y: -20, z: 0, blockId: 49, placed: true, volumeMm3: 1 };
  await withRpcFixture(placed, async ({ calls }) => {
    const targets = await chain.loadBulkMiningTargets([...placed.map((block) => ({ ...block, blockId: 49, volumeMm3: 1 })), natural]);
    assert.deepEqual(targets.slice(0, 2).map((block) => [block.placed, block.blockId, block.volumeMm3]), placed.map((block) => [true, block.blockId, block.volumeMm3]));
    assert.equal(targets[2].placed, false);
    assert.equal(targets[2].blockId, canonicalBlockIdAt({ config: chain.getNicechunkDiscoveryContext().world, ...natural }));
    assert.equal(calls.config, 1);
    assert.equal(calls.placed.length, 1);
    assert.equal(calls.placed.flat().length, 2);
    const operations = partitionBulkMiningOperations(targets);
    assert.deepEqual(operations.map((operation) => operation.kind), ["natural", "placed", "placed"]);
    assert.deepEqual(operations.flatMap((operation) => operation.blocks).map(coordinateKey).sort(), targets.map(coordinateKey).sort());
  });
});

test("640 placed targets use bounded unique-chunk account reads and bounded reclaim packets", async () => {
  const placed = Array.from({ length: 640 }, (_, i) => ({ x: -16 + i % 16, y: 250 + Math.floor(i / 128), z: -16 + Math.floor(i / 16) % 8, blockId: i % 2 ? 1 : 3, volumeMm3: 1000000 + i }));
  await withRpcFixture(placed, async ({ calls }) => {
    const targets = await chain.loadBulkMiningTargets(placed);
    assert.equal(calls.placed.length, 1);
    assert.equal(calls.placed[0].length, 1);
    assert.equal(calls.config, 0);
    assert.deepEqual(targets.map((block) => block.volumeMm3), placed.map((block) => block.volumeMm3));
    const operations = partitionBulkMiningOperations(targets);
    assert.equal(operations.length, 640 / BULK_MINING_PLACED_BATCH_SIZE);
    assert(operations.every((operation) => operation.kind === "placed" && operation.blocks.length <= BULK_MINING_PLACED_BATCH_SIZE));
  });
  const separated = Array.from({ length: 640 }, (_, i) => ({ ...placed[0], x: i * 16 }));
  await withRpcFixture(separated, async ({ calls }) => {
    assert.equal((await chain.loadBulkMiningTargets(separated)).length, 640);
    assert.equal(calls.placed.length, 7);
    assert(calls.placed.every((batch) => batch.length <= 100));
    assert.equal(new Set(calls.placed.flat()).size, 640);
  });
});

test("invalid or unavailable placed state cannot silently fall back to natural mining", async () => {
  const block = { x: -1, y: -20, z: -1, blockId: 3, volumeMm3: 1000000 };
  for (const corrupt of [
    (account) => { account.owner = key(); },
    (account) => { account.executable = true; },
    (account) => { account.data.writeInt16LE(-31, 10); },
    (account) => { account.data.writeUInt32LE(0, 21); },
  ]) {
    await withRpcFixture([block], async ({ accounts, calls }) => {
      corrupt(accounts.values().next().value);
      await assert.rejects(chain.loadBulkMiningTargets([block]));
      assert.equal(calls.config, 0);
      assert.equal(calls.broadcasts, 0);
    });
  }
  await assert.rejects(chain.loadBulkMiningTargets([block], { getMultipleAccountsInfo: async () => { throw Error("RPC unavailable"); } }), /RPC unavailable/);
});

test("placed instruction batches use reclaim opcode, real equipment accounts and one action id within a packet", () => {
  const authority = key(), owner = key(), backpack = key();
  const miningTool = { kind: "equipment", equipmentSlot: 2, itemPda: key().toBase58() };
  const targets = Array.from({ length: 8 }, (_, x) => ({ x: -16 + x, y: 250, z: -1, placed: true, blockId: 3, volumeMm3: 1000000 + x }));
  const [operation] = partitionBulkMiningOperations(targets);
  const mines = chain.createBulkMiningOperationInstructions({ authority, owner, backpack, operation, actionId: 99n, miningTool });
  assert.equal(mines.length, 8);
  mines.forEach((instruction, index) => {
    assert.equal(instruction.data[0], 16);
    assert.equal(instruction.data.readBigUInt64LE(1), 99n);
    assert.equal(instruction.data.readInt32LE(9), targets[index].x);
    assert.equal(instruction.data.readUInt16LE(19), 3);
    assert.equal(instruction.data[21], 2);
    assert.equal(instruction.keys[4].pubkey.toBase58(), chain.deriveChunkPlacedPda(-1, -1)[0].toBase58());
    assert.equal(instruction.keys[1].isWritable, true);
    assert.equal(instruction.keys.at(-1).pubkey.toBase58(), chain.derivePlayerEquipmentPda(owner)[0].toBase58());
  });
  const baseline = chain.createSyncPlayerSkillsInstruction({ payer: authority, owner, sourceAccounts: [mines[0].keys[3].pubkey] });
  const sync = chain.createSyncPlayerSkillsInstruction({ payer: authority, owner, sourceAccounts: [mines[0].keys[3].pubkey, mines[0].keys[1].pubkey, backpack], miningCoordinate: targets[0] });
  const tx = new Transaction({ feePayer: authority, recentBlockhash: owner.toBase58() }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }), baseline, ...mines, sync);
  assert(tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232);
});

test("mixed submissions stop after permission rejection and retain only confirmed blocks", async () => {
  const natural = { x: 0, y: -20, z: 0, blockId: 1 };
  const placed = Array.from({ length: 9 }, (_, x) => ({ x, y: 250, z: 0, blockId: 3, placed: true }));
  const operations = partitionBulkMiningOperations([natural, ...placed]);
  const calls = [];
  const outcome = await submitBulkMiningRanges(operations, async (operation) => {
    calls.push(operation.kind);
    if (operation.kind === "placed") throw Error("foundation-protected");
    return { signature: "confirmed-natural" };
  });
  assert.deepEqual(calls, ["natural", "placed"]);
  assert.deepEqual(outcome.confirmed.map((entry) => entry.block), [natural]);
  assert.equal(outcome.failures.length, 8);
  assert.equal(outcome.aborted.length, 1);
});

test("compute splits retain the reclaim kind and never replay already confirmed placed blocks", async () => {
  const placed = Array.from({ length: 9 }, (_, x) => ({ x, y: 250, z: 0, blockId: 3, placed: true, volumeMm3: 1000000 + x }));
  const confirmed = new Set();
  const outcome = await submitBulkMiningRanges(partitionBulkMiningOperations(placed), async (operation) => {
    assert.equal(operation.kind, "placed");
    if (operation.blocks.length > 2) throw Error("ComputationalBudgetExceeded");
    for (const block of operation.blocks) {
      assert(!confirmed.has(coordinateKey(block)));
      confirmed.add(coordinateKey(block));
    }
    return { signature: `confirmed-${confirmed.size}` };
  });
  assert.equal(outcome.confirmed.length, 9);
  assert.equal(outcome.failures.length, 0);
  assert.equal(new Set(outcome.confirmed.map((entry) => entry.block.volumeMm3)).size, 9);
});

test("unknown mixed transaction results retain confirmed, uncertain and unsubmitted subsets without retry", async () => {
  const targets = [{ x: 0, y: -20, z: 0, blockId: 1 }, ...Array.from({ length: 9 }, (_, x) => ({ x, y: 250, z: 0, blockId: 3, placed: true }))];
  const operations = partitionBulkMiningOperations(targets);
  let calls = 0;
  const unknown = Object.assign(Error("confirmation timeout"), { signature: "unknown-reclaim", nicechunkSubmissionUncertain: true });
  await assert.rejects(submitBulkMiningRanges(operations, async () => {
    calls++;
    if (calls === 1) return { signature: "confirmed-natural" };
    throw unknown;
  }), (error) => {
    assert.equal(error, unknown);
    assert.deepEqual(error.nicechunkConfirmedBlocks, operations[0].blocks);
    assert.deepEqual(error.nicechunkUncertainBlocks, operations[1].blocks);
    assert.deepEqual(error.nicechunkAbortedBlocks, operations[2].blocks);
    return true;
  });
  assert.equal(calls, 2);
});
