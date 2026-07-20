import { blockColor } from "../chunk.js/play.js";
import { buildPlacementPreviewOverlay } from "./play-placement-preview.js";

const MINING_TOOL_DEBUG_IDLE_PROGRESS_SAMPLES = Object.freeze([0.24, 0.38, 0.52, 0.66, 0.80]);
const MINING_TOOL_DEBUG_MAX_OVERLAYS = 18;

export function createActionOverlayBuilder({
  getMining = () => null,
  getPlacement = () => null,
  getChunks = () => null,
  isDebugVisible = () => false,
  getLastHit = () => null,
  getLastMiningHit = () => null,
  getLastMiningHitUntil = () => 0,
  getToolCollisionFrame = () => ({ boxes: [] }),
  getToolReachSphere = () => null,
  isToolRangeVisible = () => false,
} = {}) {
  return {
    build(hit, now = performance.now()) {
      const overlays = [];
      if (isDebugVisible() && isToolRangeVisible()) {
        const range = buildMiningToolRangeOverlay();
        if (range) overlays.push(range);
        overlays.push(...buildMiningToolDebugOverlays(now));
      }

      const pendingKeys = appendPendingMiningOverlays(overlays, now);

      if (hit?.hit) {
        const placementPreview = getPlacement()?.previewForHit?.(hit);
        if (placementPreview?.blockId) {
          const overlay = buildPlacementPreviewOverlay(placementPreview, { blockColor });
          if (overlay) overlays.push(overlay);
          return overlays;
        }
      }

      const selectedHit = now < getLastMiningHitUntil() ? getLastMiningHit() : null;
      const selectedKey = blockKey(selectedHit);
      const selectedBlockId = selectedHit?.hit
        ? getChunks()?.getBlockAtWorld?.(selectedHit.worldX, selectedHit.worldY, selectedHit.worldZ)
        : null;
      if (!selectedHit?.hit || pendingKeys.has(selectedKey) || selectedBlockId !== selectedHit.blockId) return overlays;
      overlays.push({
        worldX: selectedHit.worldX,
        worldY: selectedHit.worldY,
        worldZ: selectedHit.worldZ,
        expand: 0.006,
        fillColor: [1, 1, 1, 0],
        lineColor: [1, 1, 1, 0.74],
      });
      return overlays;
    },
  };

  function appendPendingMiningOverlays(overlays, now) {
    const pendingKeys = new Set();
    const mining = getMining();
    const pending = mining?.pendingTargets?.() ?? mining?.pendingSnapshot?.() ?? [];
    const wave = 0.5 + 0.5 * Math.sin(now * 0.0125);
    const alpha = 0.34 + wave * 0.64;
    for (const entry of pending) {
      const targets = Array.isArray(entry?.blocks) && entry.blocks.length ? entry.blocks : [entry];
      for (const target of targets) {
        const key = blockKey(target);
        if (!key || pendingKeys.has(key)) continue;
        pendingKeys.add(key);
        overlays.push({
          worldX: target.worldX,
          worldY: target.worldY,
          worldZ: target.worldZ,
          expand: 0.012 + wave * 0.004,
          fillColor: [1, 1, 1, 0.018 + wave * 0.028],
          lineColor: [1, 1, 1, alpha],
        });
      }
    }
    return pendingKeys;
  }

  function buildMiningToolDebugOverlays(now) {
    const swing = getMining()?.activeSwing?.();
    if (swing) return buildMiningToolFrameOverlays(swingToolProgress(swing, now), 0, 1, swing);
    const overlays = [];
    const rememberedHit = getLastMiningHit()?.hit && now < getLastMiningHitUntil() ? getLastMiningHit() : null;
    const debugHit = rememberedHit ?? getLastHit();
    if (debugHit?.hit) {
      overlays.push({
        worldX: debugHit.worldX,
        worldY: debugHit.worldY,
        worldZ: debugHit.worldZ,
        expand: 0.012,
        fillColor: [1.0, 0.82, 0.18, 0.04],
        lineColor: [1.0, 0.82, 0.18, 0.92],
      });
    }
    for (let index = 0; index < MINING_TOOL_DEBUG_IDLE_PROGRESS_SAMPLES.length; index += 1) {
      overlays.push(...buildMiningToolFrameOverlays(
        MINING_TOOL_DEBUG_IDLE_PROGRESS_SAMPLES[index],
        index,
        MINING_TOOL_DEBUG_IDLE_PROGRESS_SAMPLES.length,
        { hit: debugHit },
      ));
      if (overlays.length >= MINING_TOOL_DEBUG_MAX_OVERLAYS) break;
    }
    return overlays.slice(0, MINING_TOOL_DEBUG_MAX_OVERLAYS);
  }

  function buildMiningToolRangeOverlay() {
    const swing = getMining()?.activeSwing?.() ?? null;
    const sphere = getToolReachSphere({ swing });
    if (!sphere || !(sphere.radius > 0)) return null;
    return {
      shape: "sphere",
      centerX: sphere.centerX ?? sphere.x,
      centerY: sphere.centerY ?? sphere.y,
      centerZ: sphere.centerZ ?? sphere.z,
      radius: sphere.radius,
      lineColor: [0.18, 0.92, 1.0, 0.82],
    };
  }

  function buildMiningToolFrameOverlays(progress, sampleIndex = 0, sampleCount = 1, swing = null) {
    const frame = getToolCollisionFrame({ progress, swing });
    const boxes = (frame.boxes ?? []).slice(0, Math.max(1, MINING_TOOL_DEBUG_MAX_OVERLAYS));
    return boxes.map((box) => {
      const sampleT = sampleCount > 1 ? sampleIndex / Math.max(1, sampleCount - 1) : 1;
      const activeAlpha = sampleCount <= 1 ? 1 : (0.34 + sampleT * 0.44);
      return {
        worldX: box.minX,
        worldY: box.minY,
        worldZ: box.minZ,
        sizeX: box.maxX - box.minX,
        sizeY: box.maxY - box.minY,
        sizeZ: box.maxZ - box.minZ,
        fillColor: [0.08 + sampleT * 0.28, 0.72, 1.0, 0.035 * activeAlpha],
        lineColor: [0.35 + sampleT * 0.32, 0.88, 1.0, 0.40 + activeAlpha * 0.46],
      };
    });
  }
}

function blockKey(block) {
  if (!block?.hit && !Number.isFinite(Number(block?.worldX))) return "";
  const x = Math.trunc(Number(block.worldX));
  const y = Math.trunc(Number(block.worldY));
  const z = Math.trunc(Number(block.worldZ));
  if (![x, y, z].every(Number.isFinite)) return "";
  return `${x},${y},${z}`;
}

function swingToolProgress(swing, now) {
  const duration = Math.max(1, (swing.endsAt || now) - (swing.startedAt || now));
  return clamp((now - (swing.startedAt || now)) / duration, 0, 1);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}
