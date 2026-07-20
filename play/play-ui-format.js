export function backpackSlotMeta(slot) {
  if (slot.kind === "smelted_material") {
    const quality = Number.isFinite(slot.quality) ? ` · Q${slot.quality}` : "";
    const proof = slot.proofHash ? ` · ${slot.proofHash}` : "";
    return `${slot.count} item${slot.count === 1 ? "" : "s"}${quality}${proof}`;
  }
  const yieldText = Number.isFinite(slot.yieldBps) && slot.yieldBps !== 10000 ? ` · ${Math.round(slot.yieldBps / 100)}% yield` : "";
  return `${slot.count} item${slot.count === 1 ? "" : "s"}${yieldText}${slot.pending ? " · pending" : ""}`;
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
