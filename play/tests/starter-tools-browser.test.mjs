import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const origin=process.env.NICECHUNK_TEST_ORIGIN||'http://127.0.0.1:4182';const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();await page.goto(origin+'/play/tests/starter-tools.test.mjs');
 const result=await page.evaluate(async()=>{
  const {createPlaySmelting,maxSmeltingSelectableServings}=await import('/play/play-smelting.js');
  const {SMELTING_RECIPES,smeltingRecipeForSelectedSlots}=await import('/play/smelting-rules-lite.js');
  const {createPlaySurfaceDecorationSync}=await import('/play/play-surface-decoration-sync.js');
  const {createWorldGeneratorConfig,terrainSurfaceHeight}=await import('/chunk.js/play.js');
  const {DEFAULT_SURFACE_DECORATION_RULES}=await import('/chunk.js/world/surface-decoration-rules.js');
  const ids=['backpackPanel','inventoryModeButton','smeltingModeButton','backpackInventoryView','smeltingPanel','smeltingResourceGrid','smeltingRecipeList','smeltingInputSlot','smeltingFuelSlot','smeltingOutput','smeltingRecipeDetails','smeltingStatus','smeltingProgressValue','smeltingProgressBar','smeltingStart'];
  document.body.innerHTML=ids.map(id=>id==='smeltingStart'?`<button id="${id}"><i></i><span>Craft</span></button>`:`<div id="${id}"></div>`).join('');
  const backpackAddress='test-backpack';const slots=[{id:'stone',kind:'resource',blockId:55,resourceId:30,count:3,volumeMm3:1500000,chainIndex:0,source:'chain',chainBackpack:backpackAddress},{id:'twig',kind:'resource',blockId:54,resourceId:29,count:5,volumeMm3:1250000,chainIndex:1,source:'chain',chainBackpack:backpackAddress}];
  let submitted=null,refreshes=0;const elements=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
  const smelt=createPlaySmelting({elements,gameState:{backpackSlots:slots},createVoxelItemIconCanvas:()=>document.createElement('canvas'),resourceName:()=>'',voxelItemLabel:s=>s.id,getBackpackSnapshot:()=>({backpackAddress,updatedSlot:'10',capacity:50,itemCount:2}),refreshBackpack:async()=>{refreshes++;return {ok:true}},refreshPlayerProgress:async()=>({ok:true}),loadChainModule:async()=>({executeSmeltingOnChain:async p=>{submitted=p;return {submitted:true,signature:'confirmed-starter-craft'}}})});
  smelt.bind();smelt.openPanel();document.querySelector('[data-recipe-id="basic_stone_axe"]').click();
  const ready=elements.smeltingStart.getAttribute('aria-disabled');const status=elements.smeltingStatus.textContent;
  elements.smeltingStart.click();for(let i=0;i<100&&!submitted;i++)await new Promise(r=>setTimeout(r,10));
  smelt.closePanel();
  const recipe=SMELTING_RECIPES.find(r=>r.id==='basic_stone_axe');
  const chunks={config:createWorldGeneratorConfig({worldSeed:'nicechunk-mainnet-001'}),getDeltaAtWorld:()=>null,getBlockAtWorld:()=>0};
  const sync=createPlaySurfaceDecorationSync({chunks,worldSeed:'nicechunk-mainnet-001',initialRules:DEFAULT_SURFACE_DECORATION_RULES});
  const leaf=sync.bareHandPlan({hit:true,worldX:1050,worldY:112,worldZ:998,blockId:25});
  const gravelRecipe=smeltingRecipeForSelectedSlots(slots.map(s=>s.blockId===55?{...s,blockId:6,resourceId:3}:s))?.recipe?.id;
  const fragmentPlan=sync.bareHandPlan({hit:true,worldX:1014,worldY:100,worldZ:990,blockId:1});
  let unsupportedGravel=null;
  for(let x=1000;x<1040;x++){
   const y=terrainSurfaceHeight(chunks.config,x,1000);
   const plan=sync.bareHandPlan({hit:true,worldX:x,worldY:y,worldZ:1000,blockId:6});
   if(!plan) unsupportedGravel={x,y};
  }
  return {ready,status,submitted,refreshes,max:maxSmeltingSelectableServings(recipe,slots),auto:smeltingRecipeForSelectedSlots(slots)?.recipe?.id,leafKind:leaf?.kind,leafDamage:leaf?.requiredDamage,gravelRecipe,fragmentPlan,unsupportedGravel};
 });
 assert.equal(result.ready,'false');assert.equal(result.submitted.recipeId,9001);assert.deepEqual(result.submitted.inputIndexes,[0,1]);assert.deepEqual(result.submitted.fuelIndexes,[]);assert.equal(result.submitted.batchMultiplier,1);assert.equal(result.max,1);assert.equal(result.auto,'basic_stone_axe');assert.equal(result.leafKind,'bare-leaves');assert.equal(result.leafDamage,3);assert.match(result.status,/99/);assert.ok(result.refreshes>=1);
 assert.notEqual(result.gravelRecipe,'basic_stone_axe');assert.ok(result.unsupportedGravel);assert.equal(result.fragmentPlan?.kind,'surface-pebble');assert.equal(result.fragmentPlan.rewardBlocks[0].blockId,55);assert.equal(result.fragmentPlan.rewardBlocks[0].resourceId,30);
 console.log('starter browser: fuel-free recipe, exact inputs, one axe, bare leaves and authoritative refresh passed');
}finally{await browser.close();}
