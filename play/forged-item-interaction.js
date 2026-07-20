export const FORGED_ITEM_INTERACTION_MODE = Object.freeze({
  unknown: "unknown",
  loading: "loading",
  tool: "tool",
  placeable: "placeable",
  unavailable: "unavailable",
});

const interactionBySlot = new WeakMap();
const UNKNOWN_INTERACTION = Object.freeze({
  mode: FORGED_ITEM_INTERACTION_MODE.unknown,
  hasGrip: false,
  runtime: null,
  requestKey: "",
  reason: "not-resolved",
});

export function forgedItemInteraction(slot) {
  if (!isForgedSlot(slot)) return UNKNOWN_INTERACTION;
  return interactionBySlot.get(slot) ?? UNKNOWN_INTERACTION;
}

export function markForgedItemInteractionLoading(slot, requestKey = "") {
  return setInteraction(slot, {
    mode: FORGED_ITEM_INTERACTION_MODE.loading,
    hasGrip: false,
    runtime: null,
    requestKey,
    reason: "runtime-loading",
  });
}

export function setForgedItemRuntime(slot, runtime, { requestKey = "" } = {}) {
  if (!isForgedSlot(slot)) return UNKNOWN_INTERACTION;
  if (!isVerifiedRuntime(runtime)) {
    return markForgedItemInteractionUnavailable(slot, {
      requestKey,
      reason: "runtime-unavailable",
    });
  }
  const hasGrip = hasCanonicalGrip(runtime.grip);
  return setInteraction(slot, {
    mode: hasGrip
      ? FORGED_ITEM_INTERACTION_MODE.tool
      : FORGED_ITEM_INTERACTION_MODE.placeable,
    hasGrip,
    runtime,
    requestKey,
    reason: hasGrip ? "canonical-grip" : "no-grip",
  });
}

export function markForgedItemInteractionUnavailable(slot, {
  requestKey = "",
  reason = "runtime-unavailable",
} = {}) {
  return setInteraction(slot, {
    mode: FORGED_ITEM_INTERACTION_MODE.unavailable,
    hasGrip: false,
    runtime: null,
    requestKey,
    reason: String(reason || "runtime-unavailable"),
  });
}

export function isForgedMiningToolReady(slot) {
  return forgedItemInteraction(slot).mode === FORGED_ITEM_INTERACTION_MODE.tool;
}

export function isForgedPlacementReady(slot) {
  return forgedItemInteraction(slot).mode === FORGED_ITEM_INTERACTION_MODE.placeable;
}

function setInteraction(slot, state) {
  if (!isForgedSlot(slot)) return UNKNOWN_INTERACTION;
  const next = Object.freeze({ ...state });
  interactionBySlot.set(slot, next);
  return next;
}

function isForgedSlot(slot) {
  return Boolean(slot && typeof slot === "object" && slot.itemId === "forged_item");
}

function isVerifiedRuntime(runtime) {
  return Boolean(
    runtime?.kind === "ncf1-forge-runtime-v1"
    && runtime.mesh?.vertices?.byteLength
    && runtime.mesh?.indices?.length
    && Number.isInteger(runtime.designHash),
  );
}

function hasCanonicalGrip(grip) {
  if (!grip || !Array.isArray(grip.offsetQ) || grip.offsetQ.length !== 3) return false;
  if (!grip.offsetQ.every(Number.isInteger)) return false;
  const axis = Number(grip.axis);
  const sign = Number(grip.sign);
  const rotation = Number(grip.rotation);
  return Number.isInteger(axis)
    && axis >= 0
    && axis <= 2
    && (sign === -1 || sign === 1)
    && Number.isInteger(rotation)
    && rotation >= 0
    && rotation <= 3;
}
