import test from "node:test";
import assert from "node:assert/strict";
import { importHostChunkSync } from "./host-sync-module.mjs";
const { createPlayChainChunkDeltaSync } = await importHostChunkSync();
test("identity bootstrap failures redact endpoint details and preserve existing chunk data", async () => {
  const chunk = { id:"0,0",chunkX:0,chunkZ:0,chainRevision:0 };
  const chunks = { chunks:new Map([[chunk.id,chunk]]),chunkSize:16,minY:-32,height:353 };
  const messages = [];
  const sync = createPlayChainChunkDeltaSync({ chunks, appendEvent: message=>messages.push(message),
    persistentCache:{getVerifiedSnapshots:async()=>[]},loadChainModule:async()=>({
      getNicechunkConnection:()=>({rpcEndpoint:"https://fixture.invalid/?api-key=REDACTED",getMultipleAccountsInfo(){},
        getGenesisHash:async()=>{throw new Error("429 from https://fixture.invalid/?api-key=REDACTED");}}),
      deriveGameChunkBrokenPda:()=>["broken"],deriveGameChunkPlacedPda:()=>["placed"],
      getChunkBrokenPdaDerivationConfig:()=>({seed:"broken",placedSeed:"placed",programId:"program",globalConfig:"global"}),
    }) });
  const result = await sync.syncLoadedChunks();
  assert.equal(result.ok,false);assert.equal(chunks.chunks.get("0,0"),chunk);
  assert.ok(messages.every(message=>!message.includes("fixture.invalid")&&!message.includes("api-key")));
  assert.equal((await sync.requestSync({urgent:true})).reason,"error-backoff");sync.cancelActiveSync();
});
