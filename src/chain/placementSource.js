// Backpack slots compact when a stack is consumed. Follow the selected block's
// resource proof instead of trusting an index captured before queued writes.
export function resolvePlacementBackpackSlotIndex(slots, reference, matchesBlock) {
  const preferred = Number(reference?.backpackIndex);
  const proof = reference?.proof;
  if (!proof) return Number.isInteger(preferred) && matchesBlock(slots[preferred]) ? preferred : -1;
  const coordinates = ["worldX", "worldY", "worldZ"];
  if (!coordinates.every((key) => Number.isSafeInteger(proof[key]))) return -1;
  const matches = (slot) => matchesBlock(slot)
    && coordinates.every((key) => slot.resource?.[key] === proof[key]);
  return Number.isInteger(preferred) && matches(slots[preferred]) ? preferred : slots.findIndex(matches);
}
