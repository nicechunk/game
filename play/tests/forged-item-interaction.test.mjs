import assert from "node:assert/strict";
import test from "node:test";

import {
  createForgeComponent,
  createForgeDesign,
  encodeNcf1,
  forgeChainDesignHash,
  restoreForgeRuntime,
} from "../../chunk.js/index.js";
import { createForgedWorldItemMesh } from "../../chunk.js/renderer/forged-world-mesh.js";
import { createPlayGameState } from "../game-state.js";
import {
  FORGED_ITEM_INTERACTION_MODE,
  forgedItemInteraction,
  markForgedItemInteractionUnavailable,
  setForgedItemRuntime,
} from "../forged-item-interaction.js";
import { createForgedItemPlacementController } from "../play-forged-item-placement.js";
import { createPlayInputActions } from "../play-input-actions.js";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.get(String(key)) ?? null; },
  setItem(key, value) { storage.set(String(key), String(value)); },
  removeItem(key) { storage.delete(String(key)); },
};

const grippedCode = forgeCode({
  grip: { offsetQ: [0, -28, 0], axis: 2, sign: 1, rotation: 0 },
});
const placeableCode = forgeCode({ grip: null });
const grippedRuntime = restoreForgeRuntime(grippedCode, { expectedDesignHash: forgeChainDesignHash(grippedCode) });
const placeableRuntime = restoreForgeRuntime(placeableCode, { expectedDesignHash: forgeChainDesignHash(placeableCode) });

test("only a verified NCF1 grip enables forged mining actions", () => {
  storage.clear();
  const gameState = createPlayGameState();
  const slot = forgedSlot(grippedCode, grippedRuntime.designHash);
  gameState.hotbarSlots[1] = slot;
  gameState.selectHotbarSlot(1);

  assert.equal(gameState.isUsableMiningToolSlot(slot), false, "unresolved forged items must fail closed");
  const gripped = setForgedItemRuntime(slot, grippedRuntime, { requestKey: "gripped" });
  assert.equal(gripped.mode, FORGED_ITEM_INTERACTION_MODE.tool);
  assert.equal(gripped.hasGrip, true);
  assert.equal(gameState.isUsableMiningToolSlot(slot), true);

  const placeable = setForgedItemRuntime(slot, placeableRuntime, { requestKey: "placeable" });
  assert.equal(placeable.mode, FORGED_ITEM_INTERACTION_MODE.placeable);
  assert.equal(placeable.hasGrip, false);
  assert.equal(gameState.isUsableMiningToolSlot(slot), false);
  assert.equal(gameState.getSelectedForgedPlaceableSlot()?.slot, slot);

  markForgedItemInteractionUnavailable(slot, { reason: "missing-code" });
  assert.equal(gameState.isUsableMiningToolSlot(slot), false);
  assert.equal(gameState.getSelectedForgedPlaceableSlot(), null);
});

test("gripless forged objects keep exact NCF1 scale in the world preview", () => {
  const mesh = createForgedWorldItemMesh(placeableRuntime);
  assert.equal(mesh.vertexCount, placeableRuntime.vertexCount);
  assert.equal(mesh.triangleCount, placeableRuntime.triangleCount);
  assert.ok(mesh.bounds.width > 0 && mesh.bounds.height > 0 && mesh.bounds.depth > 0);

  let minY = Infinity;
  let maxY = -Infinity;
  for (let offset = 0; offset < mesh.vertices.length; offset += 10) {
    minY = Math.min(minY, mesh.vertices[offset + 1]);
    maxY = Math.max(maxY, mesh.vertices[offset + 1]);
  }
  assert.equal(minY, 0, "world placement must rest on the selected surface");
  assert.ok(Math.abs(maxY - mesh.bounds.height) < 1e-6);
});

test("gripless clicks select an exact model placement instead of mining", async () => {
  storage.clear();
  const gameState = createPlayGameState();
  const slot = forgedSlot(placeableCode, placeableRuntime.designHash);
  gameState.hotbarSlots[1] = slot;
  gameState.selectHotbarSlot(1);
  setForgedItemRuntime(slot, placeableRuntime, { requestKey: "placeable" });

  const uploads = [];
  const statuses = [];
  const hit = { hit: true, worldX: 2, worldY: 4, worldZ: 2, faceX: 0, faceY: 1, faceZ: 0 };
  const controller = createForgedItemPlacementController({
    gameState,
    chunks: { getBlockAtWorld: () => 0 },
    getHit: () => hit,
    getPlayerBounds: () => ({ x: 0, y: 4, z: 0, radius: 0.3, height: 4.3 }),
    getRenderer: () => ({
      uploadAvatarMesh(meshId, mesh) { uploads.push({ meshId, mesh }); return { meshId }; },
      removeAvatarMesh() {},
    }),
    onStatus: (reason) => statuses.push(reason),
  });

  const selected = await controller.selectAtHit();
  assert.equal(selected.ok, true);
  assert.equal(statuses.at(-1), "selected");
  assert.deepEqual(selected.target, { worldX: 2, worldY: 5, worldZ: 2 });
  assert.equal(uploads.length, 1);
  const entity = controller.previewEntity(hit);
  assert.equal(entity.opacity, 0.48);
  assert.equal(entity.castShadow, false);
  assert.equal(controller.overlays(hit).length, 1);

  let mined = 0;
  let positioned = 0;
  const actions = createPlayInputActions({
    gameState,
    getMining: () => ({ minePending() { mined += 1; } }),
    getForgedPlacement: () => ({ selectAtHit() { positioned += 1; } }),
  });
  actions.useSelectedHotbarAction();
  assert.equal(positioned, 1);
  assert.equal(mined, 0, "a gripless forged click must never fall through to mining");

  setForgedItemRuntime(slot, grippedRuntime, { requestKey: "gripped" });
  actions.useSelectedHotbarAction();
  assert.equal(positioned, 1);
  assert.equal(mined, 1, "a verified gripped item must retain its tool action");
});

test("missing forged presentation data never enables a generic tool fallback", () => {
  const slot = {
    itemId: "forged_item",
    designHash: 0x12345678,
    durability: 999,
    maxDurability: 999,
  };
  assert.equal(forgedItemInteraction(slot).mode, FORGED_ITEM_INTERACTION_MODE.unknown);
  markForgedItemInteractionUnavailable(slot, { reason: "presentation-source-unavailable" });
  assert.equal(forgedItemInteraction(slot).mode, FORGED_ITEM_INTERACTION_MODE.unavailable);
});

function forgeCode({ grip }) {
  return encodeNcf1(createForgeDesign({
    equipment: { mass5g: 28, volumeCm3: 72, attributes6: new Uint8Array(12).fill(26) },
    components: [createForgeComponent({
      resourceId: "iron",
      dimsQ: [76, 112, 52],
      offsetQ: [0, 18, 0],
      grip,
    })],
  }));
}

function forgedSlot(code, designHash) {
  return {
    itemId: "forged_item",
    kind: "forged",
    code,
    bytes: [],
    designHash,
    durability: 900,
    maxDurability: 900,
  };
}
