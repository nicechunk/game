export function buildPlacementPreviewOverlay(preview, { blockColor = fallbackBlockColor } = {}) {
  if (!preview?.target) return null;
  const target = preview.target;
  const color = blockColor(preview.blockId).map((channel) => clamp01(channel / 255));
  const ok = Boolean(preview.ok);
  return {
    worldX: target.worldX,
    worldY: target.worldY,
    worldZ: target.worldZ,
    expand: 0.012,
    fillColor: ok ? [color[0], color[1], color[2], 0.20] : [1.0, 0.12, 0.06, 0.16],
    lineColor: ok ? [0.78, 1.0, 0.72, 0.86] : [1.0, 0.18, 0.12, 0.88],
  };
}

export function placementPreviewStatus(preview) {
  if (!preview?.target) return "No block face in range for placement.";
  if (!preview.ok) return preview.reason || "Placement target is invalid.";
  return `Place block #${Math.trunc(preview.blockId || 0)} at ${preview.target.worldX}, ${preview.target.worldY}, ${preview.target.worldZ}.`;
}

function fallbackBlockColor() {
  return [144, 210, 118];
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
