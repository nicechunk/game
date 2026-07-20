import assert from "node:assert/strict";
import test from "node:test";

import {
  blockRenderTypeId,
  renderTypeForBlockId,
} from "../../src/chain/nicechunkChain.js";
import {
  BLOCK_ID,
  RESOURCE_ID,
  blockDef,
} from "../../chunk.js/world/block-registry.js";

const decorationDrops = Object.freeze([
  ["cotton", BLOCK_ID.cotton, RESOURCE_ID.cotton],
  ["flowerWhite", BLOCK_ID.flowerWhite, RESOURCE_ID.flowerWhite],
  ["flowerYellow", BLOCK_ID.flowerYellow, RESOURCE_ID.flowerYellow],
  ["flowerRed", BLOCK_ID.flowerRed, RESOURCE_ID.flowerRed],
  ["flowerBlue", BLOCK_ID.flowerBlue, RESOURCE_ID.flowerBlue],
  ["flowerPink", BLOCK_ID.flowerPink, RESOURCE_ID.flowerPink],
]);

test("chain backpack decoding recognizes cotton and five-color flower drops", () => {
  for (const [renderType, blockId, resourceId] of decorationDrops) {
    assert.equal(renderTypeForBlockId(blockId), renderType);
    assert.equal(blockRenderTypeId(renderType), blockId);
    assert.equal(blockDef(blockId).resourceId, resourceId);
  }
});
