export const BACKPACK_STACK_LIMIT = 99;

export function backpackCapacityState(backpack) {
  const capacity = nonNegativeInteger(backpack?.capacity);
  const groups = new Map();
  const stacks = [];
  let totalItems = 0;

  for (const slot of Array.isArray(backpack?.slots) ? backpack.slots : []) {
    if (!slot) continue;
    const quantity = Math.max(1, nonNegativeInteger(slot.quantity) || 1);
    totalItems += quantity;
    const identity = blockStackIdentity(slot);
    if (!identity) {
      stacks.push({ identity: "", quantity, stackable: false });
      continue;
    }

    const bins = groups.get(identity) ?? [];
    let remaining = quantity;
    while (remaining > 0) {
      const target = bins.find((bin) => bin.quantity < BACKPACK_STACK_LIMIT);
      if (target) {
        const moved = Math.min(remaining, BACKPACK_STACK_LIMIT - target.quantity);
        target.quantity += moved;
        remaining -= moved;
      } else {
        const moved = Math.min(BACKPACK_STACK_LIMIT, remaining);
        const stack = { identity, quantity: moved, stackable: true };
        bins.push(stack);
        stacks.push(stack);
        remaining -= moved;
      }
    }
    groups.set(identity, bins);
  }

  const usedSlots = stacks.length;
  const freeSlots = Math.max(0, capacity - usedSlots);
  const stackHeadroom = stacks
    .filter((stack) => stack.stackable)
    .reduce((sum, stack) => sum + BACKPACK_STACK_LIMIT - stack.quantity, 0);
  return {
    capacity,
    usedSlots,
    freeSlots,
    totalItems,
    stackHeadroom,
    availableResourceUnits: freeSlots * BACKPACK_STACK_LIMIT + stackHeadroom,
    stacks,
  };
}

export function canBackpackAcceptSlot(backpack, incoming) {
  const state = backpackCapacityState(backpack);
  const identity = blockStackIdentity(incoming);
  const quantity = Math.max(1, nonNegativeInteger(incoming?.quantity) || 1);
  if (identity) {
    if (quantity > BACKPACK_STACK_LIMIT) return false;
    const matchingHeadroom = state.stacks
      .filter((stack) => stack.identity === identity)
      .reduce((sum, stack) => sum + BACKPACK_STACK_LIMIT - stack.quantity, 0);
    const additionalSlots = Math.ceil(Math.max(0, quantity - matchingHeadroom) / BACKPACK_STACK_LIMIT);
    return additionalSlots <= state.freeSlots;
  }
  return state.usedSlots < state.capacity;
}

export function availableBackpackResourceUnits(backpack) {
  return backpackCapacityState(backpack).availableResourceUnits;
}

export function snapshotBackpackBlockQuantities(backpack) {
  const resources = new Map();
  for (const slot of Array.isArray(backpack?.slots) ? backpack.slots : []) {
    const identity = blockStackIdentity(slot);
    if (!identity) continue;
    const quantity = Math.max(1, nonNegativeInteger(slot.quantity) || 1);
    const resource = slot.resource ?? slot;
    const current = resources.get(identity);
    if (current) {
      current.quantity += quantity;
      continue;
    }
    resources.set(identity, {
      identity,
      blockId: nonNegativeInteger(resource.blockId),
      metadata: nonNegativeInteger(slot.metadata) >>> 0,
      quantity,
      worldX: finiteInteger(resource.worldX),
      worldY: finiteInteger(resource.worldY),
      worldZ: finiteInteger(resource.worldZ),
    });
  }
  return Array.from(resources.values());
}

export function diffBackpackBlockQuantities(backpack, previous = []) {
  const before = new Map((Array.isArray(previous) ? previous : []).map((entry) => [
    String(entry?.identity || ""),
    Math.max(0, nonNegativeInteger(entry?.quantity)),
  ]));
  return snapshotBackpackBlockQuantities(backpack).flatMap((entry) => {
    const quantity = Math.max(0, entry.quantity - (before.get(entry.identity) || 0));
    return quantity > 0 ? [{ ...entry, quantity }] : [];
  });
}

function blockStackIdentity(slot) {
  if (String(slot?.kind || "").toLowerCase() !== "block") return "";
  const blockId = nonNegativeInteger(slot?.resource?.blockId ?? slot?.blockId);
  if (blockId <= 0) return "";
  const metadata = nonNegativeInteger(slot?.metadata) >>> 0;
  return `${blockId}:${metadata}`;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}
