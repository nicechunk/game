import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { waterCollectionHits } from "../../src/data/waterCollection.js";
import { createCollectWaterInstruction, createCertifyForgeContainerInstruction, createForgeEquipmentVerifiedInstruction } from "../../src/chain/nicechunkChain.js";
import { decodeMiningDurabilityReceipt, waterCollectionFromTransaction } from "../../src/chain/miningDurability.js";
import { createMiningController } from "../mining-controller.js";
import { reconcilePendingMineWithChainResult } from "../play-chain-mining-result.js";
import { backpackSlotMeta } from "../play-ui-format.js";
import { marketItemDetailRows, marketItemSnapshotFromChainListing } from "../play-market.js";
import { createPlayGameState } from "../game-state.js";
import { forgeChainDesignHash } from "../../chunk.js/forge/forge-core.js";

test("water uses the confirmed ceil(1000/capacity) rule without a four-hit cap", () => {
  for (const [ml,hits] of [[1,1000],[100,10],[249,5],[250,4],[333,4],[334,3],[500,2],[1000,1],[5000,1]]) assert.equal(waterCollectionHits(ml),hits);
  for (const ml of [0,-1,NaN,Infinity]) assert.equal(waterCollectionHits(ml),0);
});

test("water instructions carry identity and nonce, never a claimed volume, hit count or skill bonus", () => {
  const key = () => Keypair.generate().publicKey;
  const instruction = createCollectWaterInstruction({ authority:key(),owner:key(),backpack:key(),item:key(),equipmentSlot:2,block:{x:-1,y:80,z:3},actionId:7n });
  assert.equal(instruction.data.length,22); assert.equal(instruction.data[0],24);
  assert.equal(instruction.keys.length,15); assert.equal(instruction.data.readUInt16LE(19),17);
  assert.equal(instruction.keys[5].isWritable,false); assert.equal(instruction.keys[6].isWritable,false);
  assert.equal(createCertifyForgeContainerInstruction({owner:key(),item:key(),seedIndex:130}).data.length,4);
  assert.throws(()=>createCertifyForgeContainerInstruction({owner:key(),item:key(),seedIndex:0xf000}));
});

function harness({ml=100,durability=20,blockId=17,contact=true}={}) {
  const slot={itemId:"forged_item",custodySource:"equipment",equipmentSlot:2,itemPda:Keypair.generate().publicKey.toBase58(),waterCapacityMl:ml,durability,maxDurability:99};
  const profile={minedBlocks:0,confirmedMines:0,resourcesCollected:0,rolledBackMines:0};
  const gameState={hotbarSlots:[slot],selectedHotbarSlot:0,playerProfile:profile,getSelectedToolSlot(){return durability>=3?{index:0,slot}:null;},isUsableMiningToolSlot:()=>durability>=3,savePlayerProfile(){}};
  const calls={pending:[],terrain:0}, hit={hit:true,worldX:0,worldY:0,worldZ:0,blockId,resourceId:8};
  const controller=createMiningController({gameState,chunks:{getBlockAtWorld:()=>blockId,applyPendingDelta(){calls.terrain++;},confirmPendingDelta(){calls.terrain++;},rollbackPendingDelta(){}},getHit:()=>hit,
    blockDef:()=>({name:"Water",hardness:0,resourceId:8}),isFluidBlock:()=>true,isMineableBlock:()=>false,blockAirId:0,
    getToolTargetingSolution:()=>({reachable:true,yaw:0}),getToolCollisionFrame:()=>({boxes:contact?[{minX:0,minY:0,minZ:0,maxX:1,maxY:1,maxZ:1}]:[]}),
    getSkillEffects(){throw Error("Water must not read Skills");},onPending:p=>calls.pending.push(p),swingDurationMs:1});
  return {slot,profile,calls,controller};
}

test("a completed water round settles once without local durability, rewards or terrain edits", () => {
  const h=harness();
  for(let i=0;i<10;i++) {
    const swing=h.controller.minePending(); assert.ok(swing); h.controller.update(swing.endsAt+1);
    assert.equal(h.calls.pending.length,i===9?1:0);
  }
  const pending=h.calls.pending[0]; assert.equal(pending.requiredDamage,10); assert.deepEqual(pending.pendingDeltas,[]);
  assert.equal(h.slot.durability,20); assert.equal(h.profile.minedBlocks,0);
  assert.equal(h.controller.minePending(),null,"serialize unconfirmed rounds");
  reconcilePendingMineWithChainResult(pending,{waterUnits:1});
  h.controller.confirmTx(pending.txId);
  assert.equal(h.profile.resourcesCollected,1); assert.equal(h.profile.confirmedMines,0); assert.equal(h.calls.terrain,0);
});

test("a two-hit container with two durability remains usable for water", () => {
  const h=harness({ml:500,durability:2});
  for(let i=0;i<2;i++) { const swing=h.controller.minePending(); assert.ok(swing); h.controller.update(swing.endsAt+1); }
  assert.equal(h.calls.pending.length,1);assert.equal(h.calls.pending[0].requiredDamage,2);
});

test("zero capacity, exhausted containers, toxic water and missed swings grant no water", () => {
  for(const options of [{ml:0},{durability:0},{blockId:18}]) assert.equal(harness(options).controller.minePending(),null);
  const h=harness({contact:false}),swing=h.controller.minePending(); h.controller.update(swing.endsAt+1); assert.equal(h.calls.pending.length,0);
});

test("water receipt binds result to issuer, action and equipped item", () => {
  const item=Keypair.generate().publicKey, issuer=Keypair.generate().publicKey.toBase58(), data=Buffer.alloc(85);
  data.write("NCKWAT01");data.writeBigUInt64LE(7n,8);data.writeUInt32LE(100,16);data.writeUInt32LE(100,20);
  data.write("NCKDUR01",28);data[36]=2;data.writeUInt32LE(98,37);data.writeUInt32LE(99,41);item.toBuffer().copy(data,53);
  const tx={meta:{returnData:{programId:issuer,data:[data.toString("base64"),"base64"]}}};
  const tool={kind:"equipment",equipmentSlot:2,itemPda:item.toBase58()};
  assert.equal(waterCollectionFromTransaction(tx,issuer,tool,7n).waterRemainderMl,100);
  assert.equal(decodeMiningDurabilityReceipt(data).durabilityCurrent,98);
  assert.equal(waterCollectionFromTransaction(tx,issuer,tool,8n),null);
  assert.equal(waterCollectionFromTransaction(tx,new PublicKey(new Uint8Array(32)).toBase58(),tool,7n),null);
  assert.equal(backpackSlotMeta({kind:"resource",blockId:17,resourceId:8,count:2}),"2 × 1000 mL");
});

test("capacity above one litre still produces one unit per completed round", () => {
  const h=harness({ml:5000,durability:1}),swing=h.controller.minePending();assert.ok(swing);h.controller.update(swing.endsAt+1);
  assert.equal(h.calls.pending.length,1);assert.equal(h.calls.pending[0].requiredDamage,1);
});

test("equipment capacity survives market conversion and is hidden when absent", () => {
  const source={kind:"item",kindCode:2,category:2,itemCode:8,itemId:"42",waterCapacityMl:500,durabilityCurrent:99,durabilityMax:99};
  const item=marketItemSnapshotFromChainListing({sourceSlot:source});
  assert.equal(item.waterCapacityMl,500);
  const row=marketItemDetailRows(item).find(row=>row.id==="water-capacity" || row.key==="water-capacity");
  assert.ok(row);
  assert.equal(marketItemDetailRows({...item,waterCapacityMl:0}).some(row=>row.id==="water-capacity" || row.key==="water-capacity"),false);
});

test("capacity-only certification refresh updates backpack presentation", () => {
  const storage=globalThis.localStorage, values=new Map();
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
  try {
    const fixture=JSON.parse(fs.readFileSync(new URL("../../chunk.js/tests/fixtures/water-containers.json",import.meta.url)))[0];
    const bytes=Array.from(Buffer.from(fixture.codeHex,"hex"));
    const slot={id:"container-42",kind:"forged",source:"chain",chainBackpack:Keypair.generate().publicKey.toBase58(),chainIndex:0,chainItemId:"42",itemCode:8,itemPda:Keypair.generate().publicKey.toBase58(),count:1,bytes,designHash:forgeChainDesignHash(bytes),durabilityCurrent:99,durabilityMax:99,waterCapacityMl:0};
    const state=createPlayGameState();state.mergeChainBackpackSlots([slot]);
    assert.equal(state.mergeChainBackpackSlots([{...slot,waterCapacityMl:360}]).changed,true);
    assert.equal(state.backpackSlots[0].waterCapacityMl,360);
    assert.equal(state.mergeChainBackpackSlots([{...slot,waterCapacityMl:360}]).changed,false);
  } finally { if(storage===undefined) delete globalThis.localStorage; else globalThis.localStorage=storage; }
});

test("water forging is explicitly selected and embeds the cavity seed in atomic creation", () => {
  const owner = Keypair.generate().publicKey, backpack = Keypair.generate().publicKey;
  const args = { owner, backpack, itemId: 1n, codeBytes: Uint8Array.of(1,2,3), inputIndexes: [0] };
  const normal = createForgeEquipmentVerifiedInstruction(args);
  const water = createForgeEquipmentVerifiedInstruction({ ...args, waterCollection: true, containerSeedIndex: 130 });
  assert.equal(normal.data[1],8);
  assert.equal(water.data[1],22);
  assert.equal(water.data.readUInt16LE(2),130);
  assert.deepEqual(water.data.subarray(4),normal.data.subarray(2));
  assert.throws(() => createForgeEquipmentVerifiedInstruction({ ...args, waterCollection: true }));
});
