import {
  forgePayloadIdentity,
  validatedNcf1EquipmentPayload,
} from "./forge-equipment-payload.js";

export function resolveGuardianEquipmentFromChain(equipment = {}, snapshot = null) {
  const live = equipment && typeof equipment === "object" ? equipment : { rightHand: "empty" };
  if (!snapshot?.initialized || !Array.isArray(snapshot.slots)) return live;
  const equippedSlots = snapshot.slots.filter((slot) => slot?.equipped && slot.custodied && slot.backpackSlot);
  if (live.rightHand === "empty" || live.rightHand === "blueprint") return live;
  if (live.rightHand === "pickaxe" && !live.forged) return live;
  if (live.rightHand === "block") {
    const blockId = Math.trunc(Number(live.blockId) || 0);
    return equippedSlots.some((slot) => (
      slot.backpackSlot?.kind === "block"
      && Math.trunc(Number(slot.backpackSlot?.resource?.blockId) || 0) === blockId
    )) ? live : { rightHand: "empty" };
  }
  if (live.rightHand === "pickaxe" && live.forged) {
    const designHash = Math.trunc(Number(live.designHash) || 0) >>> 0;
    const match = equippedSlots.find((slot) => {
      const source = slot.backpackSlot;
      return source?.kind === "item"
        && Number(source.category) === 2
        && Number(source.itemCode) === 8
        && (Math.trunc(Number(source.metadata) || 0) >>> 0) === designHash
        && validatedNcf1EquipmentPayload(slot.modelBytes, designHash);
    });
    const payloadBytes = match ? validatedNcf1EquipmentPayload(match.modelBytes, designHash) : null;
    return payloadBytes
      ? { rightHand: "pickaxe", forged: true, designHash, payloadBytes }
      : { rightHand: "empty" };
  }
  return { rightHand: "empty" };
}

export function guardianEquipmentIdentity(equipment = {}) {
  return `${String(equipment.rightHand || "empty")}:${Number(equipment.blockId) || 0}:${Number(equipment.designHash) || 0}:${forgePayloadIdentity(equipment.payloadBytes)}`;
}
