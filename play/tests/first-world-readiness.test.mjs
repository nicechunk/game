import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayStartupLogger } from '../play-startup-logger.js';

test('CPU-visible sections and sky draws cannot dismiss loading before terrain reaches the GPU',()=>{
  const previous=globalThis.NiceChunkLoading;
  let ready=0;
  globalThis.NiceChunkLoading={worldReady(){ready++;},worldProgress(){}};
  const logger=createPlayStartupLogger({enabled:false});
  try {
    logger.noteFrame(0,{renderStats:{visibleChunks:23,drawCalls:3,terrainDrawCalls:0}});
    assert.equal(ready,0);
    logger.noteFrame(1,{renderStats:{visibleChunks:1,drawCalls:4,terrainDrawCalls:1}});
    assert.equal(ready,1);
    logger.noteFrame(2,{renderStats:{visibleChunks:2,drawCalls:5,terrainDrawCalls:2}});
    assert.equal(ready,1);
  } finally {logger.stop();globalThis.NiceChunkLoading=previous;}
});
