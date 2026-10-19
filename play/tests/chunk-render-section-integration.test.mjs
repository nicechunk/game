import assert from "node:assert/strict";
import test from "node:test";
import { WebGL2VoxelRenderer } from "../../chunk.js/renderer/webgl2-renderer.js";
import { prunePlayRenderChunks } from "../play-render-lifecycle.js";

test("host pruning retains unchanged section handles, then frees them when the chain chunk unloads",()=>{
  const renderer=new WebGL2VoxelRenderer({addEventListener(){},removeEventListener(){}});
  const released=[];renderer.bufferManager={disposeChunkBuffers(handle){released.push(handle);}};
  const opaque={parentId:"-1,0",handle:{id:"opaque"}},visual={parentId:"-1,0",handle:{id:"visual"}};
  renderer.chunkBuffers.set("-1,0@7",opaque);renderer.visualChunkBuffers.set("-1,0@7",visual);
  const chunks=new Map([["-1,0",{}]]);
  for(let frame=0;frame<10;frame++)prunePlayRenderChunks(renderer,chunks);
  assert.equal(renderer.chunkBuffers.get("-1,0@7"),opaque);
  assert.equal(renderer.visualChunkBuffers.get("-1,0@7"),visual);assert.equal(released.length,0);
  chunks.clear();prunePlayRenderChunks(renderer,chunks);
  assert.equal(renderer.chunkBuffers.size,0);assert.equal(renderer.visualChunkBuffers.size,0);
  assert.deepEqual(released,[opaque.handle,visual.handle]);
});
