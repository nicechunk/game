export const BACKPACK_DISPLAY_STACK_LIMIT = 99;

export function buildBackpackDisplayStacks(slots, {
  isStackable = () => true,
  limit = BACKPACK_DISPLAY_STACK_LIMIT,
} = {}) {
  const source = Array.isArray(slots) ? slots : [];
  const safeLimit = Math.max(1, Math.trunc(Number(limit) || BACKPACK_DISPLAY_STACK_LIMIT));
  const stacks = [];
  const openStacks = new Map();
  source.forEach((slot, index) => {
    if (!slot) return;
    const count = slotCount(slot);
    const identity = defaultStackable(slot) && isStackable(slot, index) ? resourceStackIdentity(slot) : "";
    let stack = identity ? openStacks.get(identity) : null;
    if (!stack || stack.count + count > safeLimit) {
      stack = { identity, indexes: [], members: [], count: 0 };
      stacks.push(stack);
      if (identity) openStacks.set(identity, stack);
    }
    stack.indexes.push(index);
    stack.members.push(slot);
    stack.count += count;
  });
  return stacks.map(finalizeStack);
}

export function findBackpackDisplayStack(stacks, index) {
  const safeIndex = Math.trunc(Number(index));
  if (!Number.isInteger(safeIndex)) return null;
  return (stacks ?? []).find((stack) => stack.indexes.includes(safeIndex)) ?? null;
}

function finalizeStack(stack) {
  const representative = stack.members[0];
  const volume = summedPhysicalValue(stack.members, "volumeMm3");
  const mass = summedPhysicalValue(stack.members, "massGrams");
  return {
    indexes: stack.indexes,
    primaryIndex: stack.indexes[0],
    members: stack.members,
    slot: {
      ...representative,
      count: stack.count,
      volumeMm3: volume,
      massGrams: mass,
      displayStackIndexes: stack.indexes,
      displayStackPdaRecords: stack.indexes.length,
    },
  };
}

function defaultStackable(slot) {
  return slot?.kind === "resource" && slot?.source === "chain" && !slot?.pending;
}

function resourceStackIdentity(slot) {
  const resourceId = finiteInteger(slot?.resourceId);
  const blockId = finiteInteger(slot?.blockId);
  if (resourceId <= 0 && blockId <= 0) return "";
  return JSON.stringify([
    String(slot?.source || ""),
    String(slot?.chainBackpack || ""),
    resourceId,
    blockId,
    finiteInteger(slot?.decorationId),
    finiteInteger(slot?.decorationRuleId),
    finiteInteger(slot?.metadata) >>> 0,
  ]);
}

function slotCount(slot) {
  return Math.max(1, Math.trunc(Number(slot?.count) || 1));
}

function summedPhysicalValue(members, key) {
  let total = 0;
  for (const member of members) {
    const value = Number(member?.[key]);
    if (!Number.isFinite(value) || value < 0) return undefined;
    total += value;
  }
  return total;
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}
