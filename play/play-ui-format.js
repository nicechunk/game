export function backpackSlotMeta(slot) {
  if (slot.kind === "smelted_material") {
    const quality = Number.isFinite(slot.quality) ? ` · Q${slot.quality}` : "";
    const proof = slot.proofHash ? ` · ${slot.proofHash}` : "";
    return `${slot.count} item${slot.count === 1 ? "" : "s"}${quality}${proof}`;
  }
  const yieldText = Number.isFinite(slot.yieldBps) && slot.yieldBps !== 10000 ? ` · ${Math.round(slot.yieldBps / 100)}% yield` : "";
  return `${slot.count} item${slot.count === 1 ? "" : "s"}${yieldText}${slot.pending ? " · pending" : ""}`;
}

export function formatMassGrams(value) {
  const grams = nonNegativeBigInt(value);
  if (grams === null) return "-";
  if (grams < 1_000n) return `${grams} g`;
  const kilograms = grams / 1_000n;
  const remainder = String(grams % 1_000n).padStart(3, "0").replace(/0+$/u, "");
  return `${kilograms}${remainder ? `.${remainder}` : ""} kg`;
}

export function formatVolumeCm3(value) {
  const volumeMm3 = Number(value);
  if (!Number.isFinite(volumeMm3) || volumeMm3 < 0) return "-";
  const volumeCm3 = volumeMm3 / 1_000;
  return `${formatDecimal(volumeCm3, 3)} cm³`;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function shortAddress(address) {
  const value = String(address || "");
  return value.length > 12 ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;
}

function nonNegativeBigInt(value) {
  try {
    const result = BigInt(value ?? 0);
    return result >= 0n ? result : null;
  } catch {
    return null;
  }
}

function formatDecimal(value, maximumFractionDigits) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(maximumFractionDigits).replace(/(?:\.0+|(\.\d*?[1-9])0+)$/u, "$1");
}
