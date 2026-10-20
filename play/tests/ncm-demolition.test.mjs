import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { createBuildingController } from "../building-controller.js";
import { createMiningController } from "../mining-controller.js";
import { createBuildingMeshWorkerClient } from "../../chunk.js/construction/building-mesh-client.js";
import { createBuildingPlacement, parseNcm3Building } from "../../chunk.js/construction/building-parser.js";
import { createBlueprint, encodeNcm3 } from "../../chunk.js/ncm/blueprint-codec.js";
import { raycastBlock } from "../../chunk.js/input/raycast.js";
import { blockDef, BLOCK_ID, isFluidBlock, isMineableBlock } from "../../chunk.js/world/block-registry.js";
import { createBuildingDemolitionInstruction, decodeBuildingDamage, deriveBuildingDamagePda, deriveGlobalConfigPda } from "../../src/chain/nicechunkChain.js";

const owner = Keypair.generate().publicKey;
const foundationId = "18446744073709551615";
const foundation = { id: `${owner}:${foundationId}`, owner: String(owner), foundationId, status: "active", minX: -32, minZ: -16, surfaceY: 100, width: 32, depth: 16, maxX: -1, maxZ: -1 };
const code = encodeNcm3(createBlueprint({ x: 4, y: 2, z: 3 }).box(64, 0, 0, 0, 4, 2, 3).box(58, 0, 1, 0, 1, 1, 1));
const record = { id: "test-building", owner: String(owner), foundationId, revision: 1, quarterTurns: 0, offsetX: 2, offsetZ: -1, code, updatedSlot: "10" };

function maskAt(x, y, z, sizeY = 2) {
  const bitmap = new Uint8Array(sizeY * 32);
  const bit = (y * 16 + z % 16) * 16 + x % 16; bitmap[bit >>> 3] |= 1 << (bit & 7);
  return { sectionX: Math.floor(x / 16), sectionZ: Math.floor(z / 16), sizeY, bitmap };
}

for (const turn of [0, 1, 2, 3]) test(`NCM hits and confirmed demolition preserve local coordinates at rotation ${turn}`, async () => {
  const client = createBuildingMeshWorkerClient({ useWorker: false });
  const controller = createBuildingController({ index: { list: () => [foundation] }, createMeshClient: () => client });
  try {
    const active = { ...record, quarterTurns: turn };
    await controller.applyChainBuildings([active]);
    const parsed = parseNcm3Building(code);
    const placement = createBuildingPlacement(parsed, foundation, { quarterTurns: turn, offsetX: 2, offsetZ: -1 });
    for (const voxel of placement.worldVoxels.values()) {
      const target = controller.getMiningTargetAtWorld(voxel.x, voxel.y, voxel.z);
      assert.equal(target.blockId, voxel.material);
      assert.deepEqual(target.buildingTarget, { owner: String(owner), foundationId, revision: 1, x: voxel.localX, y: voxel.localY, z: voxel.localZ });
    }
    const first = [...placement.worldVoxels.values()][0];
    const removed = { ...active, hasDamage: true, damageVersion: 1, updatedSlot: "11", damageSections: [maskAt(first.localX, first.localY, first.localZ)] };
    await controller.applyConfirmedDemolition({ chainResult: { building: removed } });
    assert.equal(controller.getMiningTargetAtWorld(first.x, first.y, first.z), null);
    assert.equal(controller.hasCollisionAtWorld(first.x, first.y, first.z), false);
    assert.equal(controller.renderChunks().reduce((sum, chunk) => sum + chunk.voxelCount, 0), parsed.voxelCount - 1);
    await controller.applyChainBuildings([active]);
    assert.equal(controller.getMiningTargetAtWorld(first.x, first.y, first.z), null, "a late undamaged cache cannot undo confirmed demolition");
    await controller.applyChainBuildings([]);
    await controller.applyChainBuildings([removed]);
    assert.equal(controller.getMiningTargetAtWorld(first.x, first.y, first.z), null, "returning to a building cannot restore a removed voxel");
    assert.equal(controller.renderChunks().reduce((sum, chunk) => sum + chunk.voxelCount, 0), parsed.voxelCount - 1);
  } finally { client.dispose(); }
});

test("camera ray hits an NCM wall before the terrain behind it", async () => {
  const client = createBuildingMeshWorkerClient({ useWorker: false });
  const controller = createBuildingController({ index: { list: () => [foundation] }, createMeshClient: () => client });
  try {
    await controller.applyChainBuildings([record]);
    const p = createBuildingPlacement(parseNcm3Building(code), foundation, { offsetX: 2, offsetZ: -1 });
    const world = { chunkSize: 16, worldSeed: 1, getBlockAtWorld: () => BLOCK_ID.air,
      getActionTargetAtWorld: (...point) => controller.getMiningTargetAtWorld(...point) };
    const camera = { worldX: p.origin.x - 2, worldY: p.origin.y, worldZ: p.origin.z, localOffsetX: 0.5, localOffsetY: 0.5, localOffsetZ: 0.5 };
    const hit = raycastBlock(camera, [1, 0, 0], 12, world);
    assert.equal(hit.hit, true); assert.equal(hit.worldX, p.origin.x); assert.equal(hit.buildingTarget.foundationId, foundationId);
    assert.equal(raycastBlock(camera, [1, 0, 0], 12, { ...world, getActionTargetAtWorld: undefined }).hit, false);
  } finally { client.dispose(); }
});

test("demolition confirms without terrain deltas, resource rewards or bare-hand fallback", () => {
  const target = { hit: true, worldX: 1, worldY: 100, worldZ: 1, blockId: 64, resourceId: 0,
    buildingTarget: { owner: String(owner), foundationId, revision: 1, x: 0, y: 0, z: 0 } };
  const tool = { itemId: "forged_item", custodySource: "equipment", equipmentSlot: 2, itemPda: String(Keypair.generate().publicKey) };
  const deltas = [], confirmed = [], blocked = [];
  let equipped = true, protectedTarget = false;
  const gameState = { hotbarSlots: [tool], getSelectedToolSlot: () => equipped ? { index: 0, slot: tool } : null,
    isUsableMiningToolSlot: () => equipped, playerProfile: { minedBlocks: 0, confirmedMines: 0, resourcesCollected: 0 }, savePlayerProfile() {} };
  const controller = createMiningController({ gameState, chunks: { getBlockAtWorld: () => 0, applyPendingDelta: (...args) => deltas.push(args), confirmPendingDelta: (...args) => deltas.push(args) },
    getHit: () => target, getTargetBlock: () => target.blockId, blockDef, isFluidBlock, isMineableBlock, blockAirId: 0, swingDurationMs: 1,
    getBareHandPlan: () => ({ kind: "natural-leaf", blocks: [target], requiredDamage: 1 }),
    getToolCollisionFrame: () => ({ boxes: [{ minX: 1, maxX: 2, minY: 100, maxY: 101, minZ: 1, maxZ: 2 }] }),
    isBlockProtected: () => protectedTarget, onMiningBlocked: info => blocked.push(info), onConfirm: pending => confirmed.push(pending) });
  protectedTarget = true; assert.equal(controller.minePending(), null); assert.equal(blocked[0].reason, "foundation-protected");
  protectedTarget = false;
  equipped = false; assert.equal(controller.minePending(), null, "NCM leaves are not natural bare-hand gathering targets");
  equipped = true;
  for (let i = 0; i < 3; i++) { const swing = controller.minePending(); assert(swing); controller.update(swing.endsAt); }
  const pending = controller.pendingSnapshot()[0];
  assert.equal(pending.miningKind, "building-demolition"); assert.deepEqual(pending.buildingTarget, target.buildingTarget);
  assert.deepEqual(pending.pendingDeltas, []); assert.deepEqual(pending.rewardGroups, []);
  controller.confirmTx(pending.txId);
  assert.equal(confirmed.length, 1); assert.deepEqual(deltas, []); assert.equal(gameState.playerProfile.resourcesCollected, 0);
});

test("all cells can be removed and rebuilding at a new revision restores the model", async () => {
  const client = createBuildingMeshWorkerClient({ useWorker: false });
  try {
    const mask = maskAt(0, 0, 0); mask.bitmap.fill(255);
    const empty = await client.build({ code, foundation, damageSections: [mask] });
    assert.equal(empty.building.voxelCount, 0); assert.deepEqual(empty.chunks, []);
    const restored = await client.build({ code, foundation, damageSections: [], revision: 2 });
    assert.equal(restored.building.voxelCount, 24);
  } finally { client.dispose(); }
});

test("SDK demolition uses the exact revision, tool identity and section PDA", () => {
  const authority = Keypair.generate().publicKey;
  const miningTool = { kind: "equipment", equipmentSlot: 2, itemPda: String(Keypair.generate().publicKey) };
  const target = { foundationId, revision: 3, x: 255, y: 255, z: 255 };
  const ix = createBuildingDemolitionInstruction({ authority, owner, target, miningTool, backpack: owner, shardCount: 1 });
  assert.equal(ix.data.length, 49); assert.equal(ix.data[0], 7);
  assert.equal(ix.data.readBigUInt64LE(1), BigInt(foundationId)); assert.equal(ix.data.readUInt32LE(9), 3);
  assert.deepEqual([...ix.data.subarray(13, 17)], [255, 255, 255, 2]);
  assert.equal(ix.keys[5].pubkey.toBase58(), deriveBuildingDamagePda(foundationId, 3, 15, 15)[0].toBase58());
  assert.equal(ix.keys.filter(key => key.isSigner).length, 1);
  const data = Buffer.alloc(80 + 256 * 32); data.write("NCKBDM01"); data[8] = 1; data[10] = data[11] = 15;
  data.writeUInt16LE(256, 12); deriveGlobalConfigPda().toBuffer().copy(data, 16);
  data.writeBigUInt64LE(BigInt(foundationId), 48); data.writeUInt32LE(3, 56); data[data.length - 1] = 128;
  const args = { foundationId, revision: 3, sectionX: 15, sectionZ: 15, sizeY: 256 };
  assert.equal(decodeBuildingDamage(data, args).bitmap.at(-1), 128);
  assert.throws(() => decodeBuildingDamage(data, { ...args, revision: 4 }));
  assert.throws(() => createBuildingDemolitionInstruction({ authority, owner, target: { ...target, y: 256 }, miningTool, backpack: owner, shardCount: 1 }));
});
