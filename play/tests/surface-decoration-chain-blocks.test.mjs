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
import { DEFAULT_SURFACE_DECORATION_RULES } from "../../chunk.js/world/surface-decoration-rules.js";
import { createPlaySurfaceDecorationSync } from "../play-surface-decoration-sync.js";

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

test("ordinary stone metadata cannot be guessed into a pebble decoration", () => {
  const sync = createPlaySurfaceDecorationSync({
    worldSeed: "nicechunk-mainnet-001",
    initialRules: DEFAULT_SURFACE_DECORATION_RULES,
  });
  const resource = {
    worldX: 801,
    worldY: 133,
    worldZ: 796,
    blockId: BLOCK_ID.stone,
    metadata: 0,
  };

  assert.equal(sync.resolveBackpackDecoration(resource), null);

  const snowyPebbleMetadata = ((51 << 16) | 102) >>> 0;
  assert.deepEqual(
    sync.resolveBackpackDecoration({ ...resource, metadata: snowyPebbleMetadata }),
    {
      decorationId: 102,
      decorationRuleId: 51,
      decorationSurfaceBlockId: BLOCK_ID.snow,
      decorationVariant: 0,
      decorationFlags: 7,
      decorationVariantHash: 4054009468,
    },
  );
});
