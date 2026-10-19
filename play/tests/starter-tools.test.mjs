import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {createMiningController} from '../mining-controller.js';
import {createMineBlockWithRewardsInstruction,createCraftStarterAxeInstruction,createFellTreeWithRewardsInstruction,loadConfirmedMiningEquipmentResult} from '../../src/chain/nicechunkChain.js';
import {STARTER_AXE_BYTES,STARTER_AXE_CODE} from '../../src/data/starterTools.js';
import {decodeNcf1} from '../../chunk.js/forge/forge-core.js';
import {createForgeRuntimeAsset} from '../../chunk.js/forge/forge-runtime-cache.js';
import {resourceDropRules} from '../../src/data/resourceDropRules.js';
const owner=Keypair.generate().publicKey,backpack=Keypair.generate().publicKey;
const options={owner,authority:owner,backpack,block:{x:5,y:100,z:5},expectedBlockId:23,actionId:1n,miningTool:{kind:'bare-hands',action:'gather'}};
test('bare leaf and pebble instructions have no Equipment or local durability envelope',()=>{
 const leaf=createMineBlockWithRewardsInstruction(options);assert.equal(leaf.data[0],22);assert.equal(leaf.keys.length,14);assert.equal(leaf.data.length,21);
 const pick=createMineBlockWithRewardsInstruction({...options,miningTool:{kind:'bare-hands',action:'pick-pebble'}});assert.equal(pick.data[0],23);assert.equal(pick.keys.length,15);assert.equal(pick.data.length,21);assert.equal(pick.keys[14].isWritable,true);
 assert.throws(()=>createFellTreeWithRewardsInstruction({...options,chunks:[{chunkX:0,chunkZ:0}]}),/Bare hands/);
});
test('starter recipe sends only exact slot indexes and item id, never durability or geometry',()=>{
 const ix=createCraftStarterAxeInstruction({owner,backpack,itemId:123n,inputIndexes:[1,3]});assert.equal(ix.data[0],1);assert.equal(ix.data[1],17);assert.equal(ix.data.length,13);assert.equal(ix.keys.length,7);
 assert.throws(()=>createCraftStarterAxeInstruction({owner,backpack,itemId:1n,inputIndexes:[1,1]}));
});
test('starter axe has a canonical grip and real four-part geometry',()=>{
 const design=decodeNcf1(STARTER_AXE_CODE,{requireCanonical:true});assert.equal(design.components.length,4);assert.ok(design.components.some(c=>c.grip));
 const asset=createForgeRuntimeAsset(design);assert.ok(asset.mesh.vertices.length>0);assert.equal(STARTER_AXE_BYTES.length,62);
});
test('leaf resource rules advertise 30 percent and 250 cm3 without changing existing material ids',()=>{
 const rules=resourceDropRules.filter(r=>r.dropKey==='twig');assert.equal(rules.length,2);for(const r of rules){assert.equal(r.chanceBps,3000);assert.equal(r.minVolumeMm3,250000);assert.equal(r.maxVolumeMm3,250000);}
});
function harness(kind='bare-leaves',damage=3){
 const hit={hit:true,worldX:0,worldY:1,worldZ:0,blockId:23,resourceId:10};let picked=0;
 const state={hotbarSlots:[],getSelectedToolSlot:()=>null,playerProfile:{minedBlocks:0,confirmedMines:0,resourcesCollected:0},savePlayerProfile(){},isUsableMiningToolSlot:()=>false};
 const deltas=[],confirmations=[];const controller=createMiningController({gameState:state,chunks:{getBlockAtWorld:()=>23,applyPendingDelta:(d)=>deltas.push(...d),confirmPendingDelta:(txId,confirmation)=>confirmations.push({txId,confirmation})},getHit:()=>hit,blockDef:()=>({name:'leaves',resourceId:10,hardness:1}),isFluidBlock:()=>false,isMineableBlock:()=>true,blockAirId:0,getBareHandPlan:()=>({kind,blocks:[hit],requiredDamage:damage}),onSurfacePicked:()=>picked++});
 return {controller,deltas,confirmations,picked:()=>picked};
}
function strike(c){const swing=c.minePending();assert.ok(swing);c.update(swing.endsAt+1);}
test('empty-handed leaves queue exactly after three contacts with no durability state',()=>{
 const h=harness();strike(h.controller);strike(h.controller);assert.equal(h.controller.pendingCount(),0);strike(h.controller);assert.equal(h.controller.pendingCount(),1);assert.deepEqual(h.controller.pendingSnapshot()[0].miningTool,{kind:'bare-hands',action:'gather'});
 h.controller.rollbackLast();assert.equal(h.deltas.length,0);
});
test('picking a pebble confirms its pickup without removing ground blocks',()=>{
 const h=harness('surface-pebble',1);strike(h.controller);assert.equal(h.controller.pendingCount(),1);assert.deepEqual(h.controller.pendingSnapshot()[0].pendingDeltas,[]);h.controller.confirmLast();assert.equal(h.deltas.length,0);assert.equal(h.picked(),1);
});
test('starter gathering preserves execution metadata and marks only confirmed pebble pickups',()=>{
 for(const kind of ['bare-leaves','bare-gravel','surface-pebble']){
  const h=harness(kind,kind==='surface-pebble'?1:3);for(let i=0;i<(kind==='surface-pebble'?1:3);i++)strike(h.controller);
  const pending=h.controller.pendingSnapshot()[0],confirmation={executionSlot:123,commitment:'confirmed'};
  h.controller.confirmTx(pending.txId,confirmation);
  assert.deepEqual(h.confirmations,[{txId:pending.txId,confirmation}]);
  assert.equal(h.picked(),kind==='surface-pebble'?1:0);
  assert.equal(h.deltas.length,kind==='surface-pebble'?0:1);
 }
});
test('bare-hand confirmation does not invent equipment durability or request an equipment receipt',async()=>{
 let reads=0;const result=await loadConfirmedMiningEquipmentResult('bare-hand-vector',owner,{kind:'bare-hands',action:'gather'},{getTransaction(){reads++;throw Error('no equipment receipt for bare hands');}});
 assert.deepEqual(result,{bareHands:true});assert.equal(reads,0);
});
