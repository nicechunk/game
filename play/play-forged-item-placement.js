import { createForgedWorldItemMesh } from "../chunk.js/renderer/forged-world-mesh.js";
import {
  FORGED_ITEM_INTERACTION_MODE,
  forgedItemInteraction,
} from "./forged-item-interaction.js";

const PREVIEW_OPACITY = 0.48;
const MAX_CACHED_PREVIEW_MESHES = 12;

export function createForgedItemPlacementController({
  gameState,
  chunks,
  getHit = () => null,
  getPlayerBounds = () => null,
  getPlayerYaw = () => 0,
  getRenderer = () => null,
  ensureSelectedRuntime = async () => null,
  onStatus = () => {},
  onChanged = () => {},
  placementReach = 6,
} = {}) {
  const meshByRuntime = new WeakMap();
  const meshEntries = [];
  let meshSerial = 1;
  let ensurePromise = null;
  let ensureSlot = null;
  let selectedPlacement = null;

  return {
    prepareSelected,
    selectAtHit,
    previewForHit,
    previewEntity,
    overlays,
    selectedPlacement: () => selectedPlacement ? { ...selectedPlacement } : null,
    clear,
    dispose,
  };

  function prepareSelected() {
    const selected = gameState?.getSelectedForgedSlot?.();
    if (!selected) return Promise.resolve(null);
    const interaction = forgedItemInteraction(selected.slot);
    if (interaction.mode === FORGED_ITEM_INTERACTION_MODE.tool
      || interaction.mode === FORGED_ITEM_INTERACTION_MODE.placeable) return Promise.resolve(interaction);
    if (ensurePromise && ensureSlot === selected.slot) return ensurePromise;
    ensureSlot = selected.slot;
    ensurePromise = Promise.resolve(ensureSelectedRuntime())
      .catch(() => null)
      .finally(() => {
        ensurePromise = null;
        ensureSlot = null;
        onChanged();
      });
    return ensurePromise;
  }

  async function selectAtHit(hit = getHit?.()) {
    const selected = gameState?.getSelectedForgedSlot?.();
    if (!selected) return null;
    let interaction = forgedItemInteraction(selected.slot);
    if (interaction.mode === FORGED_ITEM_INTERACTION_MODE.unknown
      || interaction.mode === FORGED_ITEM_INTERACTION_MODE.loading) {
      onStatus("loading");
      interaction = await prepareSelected() ?? forgedItemInteraction(selected.slot);
    }
    if (interaction.mode === FORGED_ITEM_INTERACTION_MODE.tool) return { ok: false, reason: "has-grip" };
    if (interaction.mode !== FORGED_ITEM_INTERACTION_MODE.placeable) {
      onStatus("unavailable");
      return { ok: false, reason: "runtime-unavailable" };
    }
    const preview = previewForHit(hit, selected, interaction);
    if (!preview.ok) {
      onStatus(preview.reason, preview);
      return preview;
    }
    selectedPlacement = {
      slot: selected.slot,
      slotIndex: selected.index,
      designHash: interaction.runtime.designHash >>> 0,
      runtime: interaction.runtime,
      target: { ...preview.target },
      origin: { ...preview.origin },
      bounds: { ...preview.bounds },
      yaw: preview.yaw,
    };
    onStatus("selected", preview);
    onChanged();
    return { ...preview, selected: true };
  }

  function previewForHit(
    hit = getHit?.(),
    selected = gameState?.getSelectedForgedPlaceableSlot?.(),
    interaction = selected?.slot ? forgedItemInteraction(selected.slot) : null,
  ) {
    const slot = selected?.slot ?? selected;
    if (!slot || interaction?.mode !== FORGED_ITEM_INTERACTION_MODE.placeable || !interaction.runtime) {
      return { ok: false, reason: "runtime-unavailable", hit: hit ?? null };
    }
    const mesh = meshEntry(interaction.runtime)?.mesh;
    if (!mesh) return { ok: false, reason: "runtime-unavailable", hit: hit ?? null };
    if (!isTopFace(hit)) return { ok: false, reason: "top-face-required", hit: hit ?? null, mesh };
    const target = {
      worldX: Math.trunc(hit.worldX),
      worldY: Math.trunc(hit.worldY) + 1,
      worldZ: Math.trunc(hit.worldZ),
    };
    const yaw = snappedQuarterTurn(getPlayerYaw());
    const origin = {
      x: target.worldX + 0.5,
      y: target.worldY,
      z: target.worldZ + 0.5,
    };
    const bounds = rotatedWorldBounds(mesh.localBounds, origin, yaw);
    const base = { hit, target, origin, bounds, yaw, mesh, runtime: interaction.runtime };
    if (!isWithinReach(bounds, getPlayerBounds?.(), placementReach)) return { ...base, ok: false, reason: "out-of-range" };
    if (intersectsPlayer(bounds, getPlayerBounds?.())) return { ...base, ok: false, reason: "player-overlap" };
    if (intersectsWorld(bounds, chunks)) return { ...base, ok: false, reason: "occupied" };
    return { ...base, ok: true, reason: "ready" };
  }

  function previewEntity(hit = getHit?.()) {
    const selected = gameState?.getSelectedForgedSlot?.();
    if (!selected) {
      selectedPlacement = null;
      return null;
    }
    const interaction = forgedItemInteraction(selected.slot);
    if (interaction.mode === FORGED_ITEM_INTERACTION_MODE.unknown) void prepareSelected();
    if (interaction.mode !== FORGED_ITEM_INTERACTION_MODE.placeable) return null;
    if (selectedPlacement?.slot !== selected.slot) selectedPlacement = null;
    const preview = selectedPlacement
      ? previewFromSelection(selectedPlacement)
      : previewForHit(hit, selected, interaction);
    if (!preview?.origin || !preview.mesh) return null;
    const entry = meshEntry(interaction.runtime);
    if (!entry) return null;
    return {
      id: entry.meshId,
      meshId: entry.meshId,
      worldX: Math.trunc(preview.origin.x),
      worldY: Math.trunc(preview.origin.y),
      worldZ: Math.trunc(preview.origin.z),
      localOffsetX: preview.origin.x - Math.trunc(preview.origin.x),
      localOffsetY: preview.origin.y - Math.trunc(preview.origin.y),
      localOffsetZ: preview.origin.z - Math.trunc(preview.origin.z),
      yaw: preview.yaw,
      opacity: PREVIEW_OPACITY,
      castShadow: false,
    };
  }

  function overlays(hit = getHit?.()) {
    const selected = gameState?.getSelectedForgedPlaceableSlot?.();
    if (!selected) return [];
    const interaction = forgedItemInteraction(selected.slot);
    const preview = selectedPlacement?.slot === selected.slot
      ? previewFromSelection(selectedPlacement)
      : previewForHit(hit, selected, interaction);
    if (!preview?.bounds) return [];
    const color = preview.ok === false ? [1, 0.18, 0.12] : [0.76, 1, 0.78];
    return [{
      worldX: preview.bounds.minX,
      worldY: preview.bounds.minY,
      worldZ: preview.bounds.minZ,
      sizeX: preview.bounds.maxX - preview.bounds.minX,
      sizeY: preview.bounds.maxY - preview.bounds.minY,
      sizeZ: preview.bounds.maxZ - preview.bounds.minZ,
      expand: 0.012,
      fillColor: [color[0], color[1], color[2], preview.ok === false ? 0.08 : 0.045],
      lineColor: [color[0], color[1], color[2], 0.88],
    }];
  }

  function previewFromSelection(selection) {
    return {
      ok: true,
      target: selection.target,
      origin: selection.origin,
      bounds: selection.bounds,
      yaw: selection.yaw,
      mesh: meshEntry(selection.runtime)?.mesh ?? null,
      runtime: selection.runtime,
    };
  }

  function meshEntry(runtime) {
    if (!runtime) return null;
    const cached = meshByRuntime.get(runtime);
    if (cached) return cached;
    let mesh;
    try {
      mesh = createForgedWorldItemMesh(runtime);
    } catch {
      return null;
    }
    const meshId = `forged-placement-${(runtime.designHash >>> 0).toString(16).padStart(8, "0")}-${meshSerial++}`;
    if (!getRenderer()?.uploadAvatarMesh?.(meshId, mesh)) return null;
    const entry = { meshId, mesh, runtime };
    meshByRuntime.set(runtime, entry);
    meshEntries.push(entry);
    while (meshEntries.length > MAX_CACHED_PREVIEW_MESHES) {
      const retired = meshEntries.shift();
      if (retired?.runtime) meshByRuntime.delete(retired.runtime);
      getRenderer()?.removeAvatarMesh?.(retired?.meshId);
    }
    return entry;
  }

  function clear() {
    selectedPlacement = null;
    onChanged();
  }

  function dispose() {
    selectedPlacement = null;
    for (const entry of meshEntries.splice(0)) getRenderer()?.removeAvatarMesh?.(entry.meshId);
  }
}

function isTopFace(hit) {
  return Boolean(hit?.hit
    && Math.trunc(Number(hit.faceX) || 0) === 0
    && Math.trunc(Number(hit.faceY) || 0) === 1
    && Math.trunc(Number(hit.faceZ) || 0) === 0);
}

function snappedQuarterTurn(value) {
  const quarter = Math.PI * 0.5;
  return Math.round((Number(value) || 0) / quarter) * quarter;
}

function rotatedWorldBounds(local, origin, yaw) {
  const quarterTurns = ((Math.round(yaw / (Math.PI * 0.5)) % 4) + 4) % 4;
  const swap = quarterTurns % 2 === 1;
  const halfX = (swap ? local.maxZ - local.minZ : local.maxX - local.minX) * 0.5;
  const halfZ = (swap ? local.maxX - local.minX : local.maxZ - local.minZ) * 0.5;
  return {
    minX: origin.x - halfX,
    minY: origin.y,
    minZ: origin.z - halfZ,
    maxX: origin.x + halfX,
    maxY: origin.y + (local.maxY - local.minY),
    maxZ: origin.z + halfZ,
  };
}

function isWithinReach(bounds, player, reach) {
  if (!player) return true;
  const x = (bounds.minX + bounds.maxX) * 0.5;
  const y = Math.min(bounds.maxY, bounds.minY + 1);
  const z = (bounds.minZ + bounds.maxZ) * 0.5;
  const dx = x - Number(player.x || 0);
  const dy = y - (Number(player.y || 0) + Number(player.height || 0) * 0.5);
  const dz = z - Number(player.z || 0);
  const limit = Math.max(1, Number(reach) || 6);
  return dx * dx + dy * dy + dz * dz <= limit * limit;
}

function intersectsPlayer(bounds, player) {
  if (!player) return false;
  const radius = Math.max(0, Number(player.radius) || 0);
  return bounds.minX < Number(player.x || 0) + radius
    && bounds.maxX > Number(player.x || 0) - radius
    && bounds.minY < Number(player.y || 0) + Number(player.height || 0)
    && bounds.maxY > Number(player.y || 0)
    && bounds.minZ < Number(player.z || 0) + radius
    && bounds.maxZ > Number(player.z || 0) - radius;
}

function intersectsWorld(bounds, chunks) {
  if (!chunks?.getBlockAtWorld) return false;
  const epsilon = 0.0001;
  const minX = Math.floor(bounds.minX + epsilon);
  const maxX = Math.ceil(bounds.maxX - epsilon) - 1;
  const minY = Math.floor(bounds.minY + epsilon);
  const maxY = Math.ceil(bounds.maxY - epsilon) - 1;
  const minZ = Math.floor(bounds.minZ + epsilon);
  const maxZ = Math.ceil(bounds.maxZ - epsilon) - 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (chunks.getBlockAtWorld(x, y, z) !== 0) return true;
      }
    }
  }
  return false;
}
