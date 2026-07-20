export function createPlacementController({
  gameState,
  chunks,
  getHit,
  getPlayerBounds = () => null,
  blockDef,
  isBlockingBlock,
  isFluidBlock,
  blockAirId,
  onStatus = () => {},
  onChanged = () => {},
  onPending = () => {},
  onConfirm = () => {},
  onRollback = () => {},
  placementReach = 6,
} = {}) {
  const pendingTx = [];
  let txSerial = 1;

  function placePending() {
    const selected = gameState.getSelectedPlaceableSlot?.();
    if (!selected) {
      onStatus("Select a confirmed resource block in the hotbar before placing.");
      return null;
    }
    const hit = getHit?.();
    const validation = previewForHit(hit, selected);
    if (!validation.ok) {
      onStatus(validation.reason);
      return null;
    }
    const target = validation.target;
    const blockId = validation.blockId;
    const def = blockDef(blockId);

    const consumed = gameState.consumeSelectedPlaceable?.(1);
    if (!consumed?.ok) {
      onStatus(consumed?.reason || "Selected block stack could not be consumed.");
      return null;
    }

    const txId = `local-place-${txSerial++}`;
    chunks.applyPendingDelta([{ worldX: target.worldX, worldY: target.worldY, worldZ: target.worldZ, blockId }], txId);
    const pending = {
      txId,
      worldX: target.worldX,
      worldY: target.worldY,
      worldZ: target.worldZ,
      anchorWorldX: hit.worldX,
      anchorWorldY: hit.worldY,
      anchorWorldZ: hit.worldZ,
      faceX: hit.faceX,
      faceY: hit.faceY,
      faceZ: hit.faceZ,
      blockId,
      resourceId: selected.slot.resourceId,
      hotbarSlotIndex: selected.index,
      consumed: consumed.consumed,
    };
    pendingTx.push(pending);
    gameState.playerProfile.placedBlocks = (gameState.playerProfile.placedBlocks || 0) + 1;
    gameState.savePlayerProfile();
    onPending(pending);
    onChanged();
    onStatus(`Pending place ${txId}: ${def.name} at ${target.worldX}, ${target.worldY}, ${target.worldZ}.`);
    return pending;
  }

  function confirmLast() {
    return confirmPendingAt(pendingTx.length - 1);
  }

  function confirmTx(txId) {
    return confirmPendingAt(pendingTx.findIndex((pending) => pending.txId === txId));
  }

  function confirmPendingAt(index) {
    const pending = index >= 0 ? pendingTx.splice(index, 1)[0] : null;
    if (!pending) {
      onStatus("No pending placement to confirm.");
      return null;
    }
    chunks.confirmPendingDelta(pending.txId);
    gameState.playerProfile.confirmedPlacements = (gameState.playerProfile.confirmedPlacements || 0) + 1;
    gameState.savePlayerProfile();
    onConfirm(pending);
    onChanged();
    onStatus(`Confirmed placement ${pending.txId}.`);
    return pending;
  }

  function rollbackLast() {
    return rollbackPendingAt(pendingTx.length - 1);
  }

  function rollbackTx(txId) {
    return rollbackPendingAt(pendingTx.findIndex((pending) => pending.txId === txId));
  }

  function rollbackPendingAt(index) {
    const pending = index >= 0 ? pendingTx.splice(index, 1)[0] : null;
    if (!pending) {
      onStatus("No pending placement to rollback.");
      return null;
    }
    chunks.rollbackPendingDelta(pending.txId);
    if (pending.consumed) gameState.restoreBackpackSlotSnapshot?.(pending.consumed);
    gameState.syncHotbarResourceSlots?.();
    gameState.playerProfile.rolledBackPlacements = (gameState.playerProfile.rolledBackPlacements || 0) + 1;
    gameState.playerProfile.placedBlocks = Math.max(0, (gameState.playerProfile.placedBlocks || 0) - 1);
    gameState.savePlayerProfile();
    onRollback(pending);
    onChanged();
    onStatus(`Rolled back placement ${pending.txId}. Block and backpack stack restored.`);
    return pending;
  }

  function isPlaceableBlock(blockId) {
    return isPlaceableBlockId(blockId, { blockAirId, isFluidBlock, isBlockingBlock });
  }

  function previewForHit(hit, selected = gameState.getSelectedPlaceableSlot?.()) {
    const slot = selected?.slot ?? selected;
    if (!slot) return { ok: false, reason: "Select a confirmed resource block in the hotbar before placing.", hit: hit ?? null };
    const blockId = Math.trunc(slot.blockId || 0);
    const def = blockDef(blockId);
    if (!isPlaceableBlock(blockId)) {
      return {
        ok: false,
        reason: `${def.name} cannot be placed as a solid world block.`,
        hit: hit ?? null,
        blockId,
        resourceId: slot.resourceId,
      };
    }
    if (!hit?.hit) {
      return {
        ok: false,
        reason: "No block face in range for placement.",
        hit: hit ?? null,
        blockId,
        resourceId: slot.resourceId,
      };
    }
    const target = placementTargetFromHitRaw(hit);
    const validation = validatePlacementTargetRaw(target, {
      chunks,
      getPlayerBounds,
      blockAirId,
      placementReach,
    });
    return {
      ...validation,
      hit,
      target,
      blockId,
      resourceId: slot.resourceId,
      hotbarSlotIndex: selected?.index,
    };
  }

  return {
    placePending,
    confirmLast,
    confirmTx,
    rollbackLast,
    rollbackTx,
    previewForHit,
    pendingCount: () => pendingTx.length,
    pendingSnapshot: () => pendingTx.map((entry) => ({ ...entry, consumed: entry.consumed ? { ...entry.consumed } : null })),
  };
}

export function placementTargetFromHitRaw(hit) {
  const faceX = Math.trunc(hit?.faceX || 0);
  const faceY = Math.trunc(hit?.faceY || 0);
  const faceZ = Math.trunc(hit?.faceZ || 0);
  return {
    worldX: Math.trunc(hit?.worldX || 0) + faceX,
    worldY: Math.trunc(hit?.worldY || 0) + faceY,
    worldZ: Math.trunc(hit?.worldZ || 0) + faceZ,
    faceX,
    faceY,
    faceZ,
  };
}

export function validatePlacementTargetRaw(target, {
  chunks,
  getPlayerBounds = () => null,
  blockAirId = 0,
  placementReach = 6,
} = {}) {
  if (!target || (Math.abs(target.faceX) + Math.abs(target.faceY) + Math.abs(target.faceZ)) !== 1) {
    return { ok: false, reason: "Placement needs a clear block face." };
  }
  if (!isPlacementTargetInRangeRaw(target, getPlayerBounds, placementReach)) return { ok: false, reason: "Placement target is out of reach." };
  const existing = chunks?.getBlockAtWorld?.(target.worldX, target.worldY, target.worldZ);
  if (existing !== blockAirId) return { ok: false, reason: "Placement target is occupied." };
  if (wouldPlacementBlockIntersectPlayer(target, getPlayerBounds)) return { ok: false, reason: "Cannot place a block inside the player body." };
  return { ok: true };
}

export function isPlaceableBlockId(blockId, { blockAirId = 0, isFluidBlock = () => false, isBlockingBlock = () => true } = {}) {
  return blockId !== blockAirId && !isFluidBlock(blockId) && isBlockingBlock(blockId);
}

export function isPlacementTargetInRangeRaw(target, getPlayerBounds = () => null, placementReach = 6) {
  const player = getPlayerBounds?.();
  if (!player) return true;
  const cx = target.worldX + 0.5;
  const cy = target.worldY + 0.5;
  const cz = target.worldZ + 0.5;
  const dx = cx - player.x;
  const dy = cy - (player.y + player.height * 0.5);
  const dz = cz - player.z;
  return dx * dx + dy * dy + dz * dz <= placementReach * placementReach;
}

export function wouldPlacementBlockIntersectPlayer(target, getPlayerBounds = () => null) {
  const player = getPlayerBounds?.();
  if (!player) return false;
  const minX = player.x - player.radius;
  const maxX = player.x + player.radius;
  const minY = player.y;
  const maxY = player.y + player.height;
  const minZ = player.z - player.radius;
  const maxZ = player.z + player.radius;
  return target.worldX < maxX
    && target.worldX + 1 > minX
    && target.worldY < maxY
    && target.worldY + 1 > minY
    && target.worldZ < maxZ
    && target.worldZ + 1 > minZ;
}
