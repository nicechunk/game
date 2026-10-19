import assert from 'node:assert/strict';
import test from 'node:test';
import {createPlayGameState} from '../game-state.js';
import {createMiningController} from '../mining-controller.js';
import {createActionOverlayBuilder} from '../play-action-overlays.js';
import {STARTER_AXE_BYTES} from '../../src/data/starterTools.js';
import {setForgedItemRuntime} from '../forged-item-interaction.js';
import {ForgeRuntimeCache} from '../../chunk.js/forge/forge-runtime-cache.js';
const runtime=new ForgeRuntimeCache().restore(STARTER_AXE_BYTES);

function stateWithTool() {
 const state=createPlayGameState();
 state.hotbarSlots[1]={itemId:'forged_item',kind:'forged',custodySource:'equipment',equipmentSlot:1,itemPda:'Axe111',chainItemId:'1',
  bytes:[...STARTER_AXE_BYTES],durability:50,maxDurability:100};
 setForgedItemRuntime(state.hotbarSlots[1],runtime);
 state.selectHotbarSlot(1);assert.ok(state.getSelectedToolSlot(),'fixture must contain a usable verified tool');
 state.selectHotbarSlot(3);
 return state;
}

test('backpack refresh, equipment refresh and delayed rollback preserve an explicitly selected empty slot',()=>{
 const state=stateWithTool();
 for(let i=0;i<4;i++)state.mergeChainBackpackSlots([]);
 assert.equal(state.selectedHotbarSlot,3);assert.equal(state.getSelectedToolSlot(),null);
 const slots=Array.from({length:9},(_,slot)=>({slot,equipped:false}));
 slots[1]={slot:1,equipped:true,custodied:true,backpack:'Backpack111',backpackIndex:1,
  backpackSlot:{kind:'item',itemCode:8,itemId:'1',itemPda:'Axe111',quantity:1,metadata:runtime.designHash,
   durabilityCurrent:49,durabilityMax:100},modelBytes:[...STARTER_AXE_BYTES]};
 state.restoreChainEquipmentSlots({initialized:true,slots});
 assert.equal(state.selectedHotbarSlot,3);
 state.hotbarSlots[2]={...state.hotbarSlots[1]};
 assert.equal(state.restoreEquipmentMutation([{index:2,before:null,after:state.hotbarSlots[1]}]).changed,true);
 assert.equal(state.selectedHotbarSlot,3);
 assert.equal(state.hotbarSlots[1].durability,49);assert.equal(state.hotbarSlots[1].maxDurability,100);
});

test('repeated bare leaf strikes and pebble confirmations keep the hand empty through inventory refresh',()=>{
 for(const kind of ['bare-leaves','surface-pebble']){
  const state=stateWithTool(),hit={hit:true,worldX:0,worldY:1,worldZ:0,blockId:23,resourceId:10};
  const decoration={decorationId:100,variantHash:0x12345678,surfaceBlockId:1,variant:0,flags:0};
  let picked=0;
  const controller=createMiningController({gameState:state,getHit:()=>hit,
   chunks:{getBlockAtWorld:()=>23,applyPendingDelta(){},confirmPendingDelta(){}},
   blockDef:()=>({name:'leaves',resourceId:10,hardness:1}),isFluidBlock:()=>false,isMineableBlock:()=>true,blockAirId:0,
   getBareHandPlan:()=>({kind,blocks:[hit],rewardBlocks:[hit],requiredDamage:kind==='surface-pebble'?1:3,surfaceDecoration:kind==='surface-pebble'?decoration:null}),
   onChanged:()=>state.syncHotbarBackpackSlots({authoritative:true}),
   onConfirm:()=>state.mergeChainBackpackSlots([]),onSurfacePicked:()=>picked++});
  for(let i=0;i<(kind==='surface-pebble'?1:3);i++){
   const swing=controller.minePending();assert.equal(swing.miningTool.kind,'bare-hands');controller.update(swing.endsAt+1);
   assert.equal(state.selectedHotbarSlot,3);
  }
  const pending=controller.pendingSnapshot()[0];assert.equal(pending.miningTool.kind,'bare-hands');
  if(kind==='surface-pebble')assert.deepEqual(pending.surfaceDecoration,decoration);
  controller.confirmTx(pending.txId);assert.equal(state.selectedHotbarSlot,3);
  assert.equal(state.getSelectedToolSlot(),null);assert.equal(state.hotbarSlots[1].durability,50);
  assert.equal(picked,kind==='surface-pebble'?1:0);
 }
});

test('pending pebble feedback pulses its exact descriptor above the supporting ground and ends with the transaction',()=>{
 const decoration={decorationId:100,variantHash:0x12345678,surfaceBlockId:1,variant:0,flags:0};
 let pending=[{miningKind:'surface-pebble',worldX:-17,worldY:100,worldZ:33,surfaceDecoration:decoration}];
 const builder=createActionOverlayBuilder({getMining:()=>({pendingTargets:()=>pending})});
 const low=builder.build(null,Math.PI*1.5/.0125),high=builder.build(null,Math.PI*.5/.0125);
 assert.equal(low.length,2);assert.equal(high.length,2);
 const body=high.find(o=>o.shape==='surface-decoration');
 assert.deepEqual(body.decoration,decoration);assert.equal(body.worldY,101);assert.equal(body.worldX,-17);assert.equal(body.worldZ,33);
 assert.ok(body.fillColor[3]-low.find(o=>o.shape==='surface-decoration').fillColor[3]>.5);
 pending=[];assert.deepEqual(builder.build(null,1000),[]);
});
