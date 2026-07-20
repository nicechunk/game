import assert from "node:assert/strict";
import {
  createForgeComponent,
  createForgeDesign,
  encodeNcf1,
  forgeChainDesignHash,
  restoreForgeRuntime,
} from "../../chunk.js/index.js";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.has(String(key)) ? storage.get(String(key)) : null; },
  setItem(key, value) { storage.set(String(key), String(value)); },
  removeItem(key) { storage.delete(String(key)); },
};

const code = encodeNcf1(createForgeDesign({
  equipment: { mass5g: 32, volumeCm3: 80, attributes6: new Uint8Array(12).fill(28) },
  components: [createForgeComponent({
    resourceId: "iron",
    dimsQ: [48, 96, 40],
    grip: { offsetQ: [0, -30, 0], axis: 2, sign: 1, rotation: 0 },
  })],
}));
const designHash = forgeChainDesignHash(code);
storage.set("nicechunk.forging.savedCodes.v2", JSON.stringify([code]));

const { createPlayGameState } = await import("../game-state.js");
const { normalizeForgedHotbarSlot } = await import("../forged-hotbar-compat.js");
const { setForgedItemRuntime } = await import("../forged-item-interaction.js");
const { createNiceChunkGuardianClient } = await import("../play-guardian-client.js");
const {
  forgePayloadIdentity,
  validatedNcf1EquipmentPayload,
} = await import("../forge-equipment-payload.js");
const gameState = createPlayGameState();
gameState.mergeChainBackpackSlots([chainForgedSlot(designHash)]);
const equipped = gameState.equipBackpackSlotToHotbar(gameState.backpackSlots[0].id, 1);
assert.equal(equipped.ok, true);
assert.equal(equipped.slot.itemId, "forged_item");
assert.equal(equipped.slot.designHash, designHash);
assert.equal(equipped.slot.code, code, "a chain hash should hydrate canonical NCF1 from the forge code library");
assert.ok(equipped.slot.bytes.length > 0);
assert.equal(gameState.isUsableMiningToolSlot(equipped.slot), false, "forged actions remain disabled before canonical runtime validation");
setForgedItemRuntime(equipped.slot, restoreForgeRuntime(code, { expectedDesignHash: designHash }));
assert.equal(gameState.isUsableMiningToolSlot(equipped.slot), true);

const staleLengthSlot = normalizeForgedHotbarSlot({
  itemId: "forged_item",
  code,
  designHash,
  byteLength: 4096,
});
assert.equal(staleLengthSlot.byteLength, equipped.slot.bytes.length, "presentation payload length must be derived from verified bytes");
const rehydratedFallbackSlot = normalizeForgedHotbarSlot({
  itemId: "forged_item",
  source: "chain",
  chainIndex: 3,
  bytes: [],
  code: "",
  designHash,
});
assert.equal(rehydratedFallbackSlot.code, code, "a persisted chain fallback should recover when matching presentation code becomes available");
assert.equal(normalizeForgedHotbarSlot({
  itemId: "forged_item",
  bytes: new Array(641).fill(0xe0),
  designHash,
}), null, "oversized local forge payloads must be rejected before runtime restoration");

storage.delete("nicechunk.play.hotbar.v2");
const fallbackState = createPlayGameState();
fallbackState.mergeChainBackpackSlots([chainForgedSlot(designHash ^ 0x01010101)]);
const fallback = fallbackState.equipBackpackSlotToHotbar(fallbackState.backpackSlots[0].id, 1);
assert.equal(fallback.ok, true, "verified chain equipment should remain equippable when this browser lacks matching presentation code");
assert.equal(fallback.slot.code, "");
assert.deepEqual(fallback.slot.bytes, []);
assert.equal(fallbackState.isUsableMiningToolSlot(fallback.slot), false, "missing NCF1 must not be guessed to have a grip");

let receivedEquipment = null;
const guardianClient = createNiceChunkGuardianClient({
  url: "wss://guardian.example/ws",
  walletAddress: "11111111111111111111111111111111",
  onEquipment: (event) => { receivedEquipment = event; },
});
const encodedEquipment = guardianClient.encodeEquipment({
  rightHandKind: 3,
  rightHandVariant: 2,
  flags: 1,
  designHash,
  payloadBytes: equipped.slot.bytes,
});
assert.equal(encodedEquipment.length, 12 + equipped.slot.byteLength);
assert.equal(encodedEquipment[3], 3, "Guardian forged equipment must use the protocol's dedicated forged kind");
assert.deepEqual(Array.from(encodedEquipment.subarray(12)), equipped.slot.bytes);
const equipmentEvent = new Uint8Array(14 + equipped.slot.byteLength);
const equipmentView = new DataView(equipmentEvent.buffer);
equipmentView.setUint8(0, 0x43);
equipmentView.setUint16(1, 7, true);
equipmentView.setUint16(3, 11, true);
equipmentView.setUint8(5, 3);
equipmentView.setUint8(6, 2);
equipmentView.setUint8(7, 1);
equipmentView.setUint16(8, equipped.slot.byteLength, true);
equipmentView.setUint32(10, designHash, true);
equipmentEvent.set(equipped.slot.bytes, 14);
guardianClient.decodeEquipmentEvent(equipmentView);
assert.equal(receivedEquipment?.designHash, designHash);
assert.deepEqual(Array.from(receivedEquipment?.payloadBytes ?? []), equipped.slot.bytes);

assert.equal(
  validatedNcf1EquipmentPayload(equipped.slot.bytes, designHash ^ 1),
  null,
  "a forged payload must not be broadcast under a mismatched design hash",
);
assert.equal(
  validatedNcf1EquipmentPayload(new Uint8Array(641).fill(0xe0), designHash),
  null,
  "a forged Guardian payload must respect the canonical 640-byte NCF1 limit",
);
assert.equal(
  validatedNcf1EquipmentPayload(Uint8Array.of(0xe0), 0x550c5d1f),
  null,
  "a forged Guardian payload must include the complete 108-bit NCF1 equipment header",
);
assert.notEqual(
  forgePayloadIdentity(equipped.slot.bytes),
  forgePayloadIdentity(Uint8Array.from(equipped.slot.bytes, (value, index) => index === equipped.slot.bytes.length - 1 ? value ^ 1 : value)),
  "same-length payload changes must invalidate Guardian appearance request keys",
);

console.log(JSON.stringify({
  designHash,
  hydratedBytes: equipped.slot.byteLength,
  guardianPacketBytes: encodedEquipment.length,
  fallback: fallback.slot.code === "",
}));

function chainForgedSlot(hash) {
  return {
    id: `chain-forged-${hash}`,
    kind: "forged",
    itemId: "forged_item",
    count: 1,
    source: "chain",
    chainBackpack: "Backpack1111111111111111111111111111111",
    chainIndex: 3,
    chainItemId: "42",
    itemCode: 8,
    itemPda: "Item11111111111111111111111111111111111",
    designHash: hash >>> 0,
    volumeMm3: 80_000,
    durabilityCurrent: 720,
    durabilityMax: 900,
    qualityBps: 8_000,
  };
}
