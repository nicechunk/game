import {
  aabbIntersectsAabb,
  createBlockAabb,
  sweptAabbIntersection,
} from "../chunk.js/physics/motion-collision.js";
import { BULK_MINING_MAX_SELECTION_BLOCKS } from "./bulk-mining-controller.js";

export function createMiningController({
  gameState,
  chunks,
  getHit,
  getPlayerBounds = () => null,
  getToolCollisionFrame = null,
  getToolTargetingSolution = null,
  blockDef,
  isFluidBlock,
  isMineableBlock,
  getMiningPlan = null,
  blockAirId,
  onStatus = () => {},
  onChanged = () => {},
  onSwingStart = () => {},
  onDamage = () => {},
  onTargetSelected = () => {},
  onPending = () => {},
  onConfirm = () => {},
  onRollback = () => {},
  canMine = () => true,
  onMiningBlocked = () => {},
  isBlockProtected = () => false,
  getSkillEffects = () => null,
  swingDurationMs = 260,
  miningReach = 9.5,
  collisionStartProgress = 0.22,
  blockCollisionPadding = 0.06,
  defaultRequiredDamage = 3,
  partialDamageTtlMs = 2 * 60_000,
  maxPartialDamageEntries = 256,
  maxBatchBlocks = BULK_MINING_MAX_SELECTION_BLOCKS,
} = {}) {
  const pendingTx = [];
  const blockDamage = new Map();
  let txSerial = 1;
  let activeSwing = null;
  let lastDamagePruneAt = 0;

  function minePending() {
    // Consume the pointer hit even when mining is blocked or a swing is active,
    // so a stale click can never be reused by a later keyboard/button action.
    const rayHit = getHit?.();
    const now = performance.now();
    if (activeSwing && now < activeSwing.endsAt) {
      return activeSwing;
    }

    const miningPermission = canMine?.();
    if (miningPermission !== true) {
      const reason = typeof miningPermission === "string" ? miningPermission : "no-backpack";
      onStatus("Mining is locked until you create a backpack.");
      onMiningBlocked({ reason });
      return null;
    }

    const selectedTool = gameState.getSelectedToolSlot();
    if (!selectedTool) {
      onStatus("Select a usable mining tool in the hotbar before mining.");
      return null;
    }

    const targetSelection = selectMiningTarget(rayHit);
    if (!targetSelection.hit?.hit) {
      return null;
    }
    const targetHit = cloneHit(targetSelection.hit);
    const targeting = targetSelection.targeting ?? null;
    onTargetSelected(cloneHit(targetHit), targeting ? { ...targeting } : null);

    const def = blockDef(targetHit.blockId);
    const resourceId = Number.isFinite(targetHit.resourceId) ? targetHit.resourceId : def.resourceId;
    const miningPlan = miningPlanForHit(targetHit, def);
    if (miningPlan.blocks?.some?.((block) => isBlockProtected(block)) || isBlockProtected(targetHit)) {
      onStatus("This block is protected by a foundation.");
      return null;
    }
    const duration = Math.max(1, swingDurationMs);
    activeSwing = {
      startedAt: now,
      endsAt: now + duration,
      hitDone: false,
      hit: targetHit,
      blockId: targetHit.blockId,
      resourceId,
      blockName: def.name,
      selectedToolIndex: selectedTool.index,
      requiredDamage: miningPlan.requiredDamage,
      miningPlan,
      previousToolBoxes: null,
      previousToolBoxCount: 0,
      previousToolProgress: collisionStartProgress,
      aimYaw: Number.isFinite(targeting?.yaw) ? targeting.yaw : null,
      aimPitch: Number.isFinite(targeting?.pitchOffset) ? targeting.pitchOffset : 0,
      targeting,
    };
    onSwingStart(activeSwing);
    return activeSwing;
  }

  function queueBatchMine(blocks, { authorization = "" } = {}) {
    if (authorization !== "debug") {
      onStatus("Bulk mining requires an authorized debug or explosive action.");
      return null;
    }
    const miningPermission = canMine?.();
    if (miningPermission !== true) {
      const reason = typeof miningPermission === "string" ? miningPermission : "no-backpack";
      onStatus("Mining is locked until you create a backpack.");
      onMiningBlocked({ reason });
      return null;
    }

    const limit = Math.max(1, Math.trunc(Number(maxBatchBlocks) || BULK_MINING_MAX_SELECTION_BLOCKS));
    const selected = [];
    for (const source of Array.isArray(blocks) ? blocks : []) {
      if (selected.length >= limit) break;
      const block = normalizeMiningBlock(source);
      if (!block || isBlockPending(block) || isBlockProtected(block)) continue;
      const currentBlockId = chunks.getBlockAtWorld(block.worldX, block.worldY, block.worldZ);
      if (currentBlockId !== block.blockId) continue;
      const validation = validateMiningTarget(block, { checkReach: false });
      if (!validation.ok) continue;
      selected.push(block);
    }
    const uniqueBlocks = uniqueMiningBlocks(selected);
    if (!uniqueBlocks.length) {
      onStatus("The bulk selection contains no mineable blocks.");
      return null;
    }

    const first = uniqueBlocks[0];
    const def = blockDef(first.blockId);
    const txId = `local-pending-${txSerial++}`;
    const pending = {
      txId,
      worldX: first.worldX,
      worldY: first.worldY,
      worldZ: first.worldZ,
      blockId: first.blockId,
      resourceId: first.resourceId || def.resourceId,
      miningKind: "debug-bulk",
      batchAuthorization: "debug",
      lossyRewards: true,
      storedRewardCount: null,
      minedBlockCount: uniqueBlocks.length,
      blocks: uniqueBlocks.map((block) => ({ ...block })),
      collapseBlocks: [],
      rewardBlocks: [],
      rewardGroups: [],
      pendingDeltas: uniqueBlocks.map((block) => ({
        worldX: block.worldX,
        worldY: block.worldY,
        worldZ: block.worldZ,
        blockId: blockAirId,
      })),
      toolDamageBySlot: [],
      requiredDamage: 0,
      gatheringYieldBps: 0,
      resourceVolumeMilliLiters: 0,
      swingStartedAt: performance.now(),
      swingImpactAt: performance.now(),
    };
    pendingTx.push(pending);
    gameState.playerProfile.minedBlocks += uniqueBlocks.length;
    gameState.savePlayerProfile();
    onPending(pending);
    onChanged();
    return pending;
  }

  function selectMiningTarget(rayHit) {
    if (!rayHit?.hit) return { hit: null, reason: "no-click-target" };
    const rayValidation = validateMiningTarget(rayHit, { checkReach: false });
    if (!rayValidation.ok) return { hit: null, reason: rayValidation.reason };
    if (isBlockPending(rayHit)) return { hit: null, reason: "target-pending" };
    if (typeof getToolTargetingSolution === "function") {
      const targeting = getToolTargetingSolution({
        worldX: rayHit.worldX,
        worldY: rayHit.worldY,
        worldZ: rayHit.worldZ,
        padding: blockCollisionPadding,
      });
      if (targeting?.reachable && Number.isFinite(targeting.yaw)) return { hit: rayHit, targeting };
      if (targeting?.withinReachSphere) return { hit: null, reason: "swing-contact-unreachable" };
      return { hit: null, reason: "outside-tool-reach" };
    }
    if (!isHitInMiningReach(rayHit)) return { hit: null, reason: "outside-tool-reach" };
    if (canToolReachHit(rayHit)) return { hit: rayHit };
    return { hit: null, reason: "swing-contact-unreachable" };
  }

  function update(now = performance.now()) {
    if (!activeSwing) return null;
    const progress = clamp01((now - activeSwing.startedAt) / Math.max(1, activeSwing.endsAt - activeSwing.startedAt));
    if (!activeSwing.hitDone && progress < collisionStartProgress) {
      activeSwing.previousToolBoxes = null;
      activeSwing.previousToolBoxCount = 0;
      activeSwing.previousToolProgress = collisionStartProgress;
    } else if (!activeSwing.hitDone) {
      const hitResult = toolCollisionHitForProgress(activeSwing, progress);
      if (hitResult.hit) {
        activeSwing.hitDone = true;
        activeSwing.previousToolBoxes = null;
        activeSwing.previousToolBoxCount = 0;
        const result = applyMiningDamage(activeSwing, hitResult);
        if (now >= activeSwing.endsAt) activeSwing = null;
        return result;
      }
    }

    if (now >= activeSwing.endsAt) {
      activeSwing = null;
    }
    return null;
  }

  function toolCollisionHitForProgress(swing, toProgress) {
    const endProgress = clamp01(toProgress);
    const startProgress = Math.max(collisionStartProgress, Math.min(endProgress, Number(swing.previousToolProgress) || collisionStartProgress));
    let previousBoxes = swing.previousToolBoxes;
    let previousCount = swing.previousToolBoxCount || 0;
    if (!previousBoxes || !previousCount) {
      const startFrame = getToolCollisionFrame?.({ progress: startProgress, swing });
      const startBoxes = Array.isArray(startFrame?.boxes) ? startFrame.boxes : [];
      const startHit = toolCollisionHit(swing.hit, startBoxes, null, 0);
      if (startHit.hit) return startHit;
      previousBoxes = copyToolBoxes(startBoxes, previousBoxes);
      previousCount = startBoxes.length;
    }

    const stepCount = Math.max(1, Math.ceil(Math.max(0.001, endProgress - startProgress) / 0.10));
    for (let step = 1; step <= stepCount; step += 1) {
      const progress = startProgress + (endProgress - startProgress) * (step / stepCount);
      const frame = getToolCollisionFrame?.({ progress, swing });
      const boxes = Array.isArray(frame?.boxes) ? frame.boxes : [];
      if (!boxes.length) {
        previousBoxes = null;
        previousCount = 0;
        continue;
      }
      const hitResult = toolCollisionHit(swing.hit, boxes, previousBoxes, previousCount);
      if (hitResult.hit) return hitResult;
      previousBoxes = copyToolBoxes(boxes, previousBoxes);
      previousCount = boxes.length;
    }
    swing.previousToolBoxes = copyToolBoxes(previousBoxes ?? [], swing.previousToolBoxes);
    swing.previousToolBoxCount = previousCount;
    swing.previousToolProgress = endProgress;
    return { hit: false };
  }

  function validateMiningTarget(hit, { checkReach = true } = {}) {
    if (isBlockProtected(hit)) {
      return { ok: false, reason: "This block is protected by a foundation." };
    }
    if (checkReach && typeof getToolTargetingSolution !== "function" && !isHitInMiningReach(hit)) {
      return { ok: false, reason: "Target block is out of mining reach." };
    }
    const def = blockDef(hit.blockId);
    if (hit.blockId === blockAirId || isFluidBlock(hit.blockId) || !isMineableBlock(hit.blockId) || !def.hardness) {
      return { ok: false, reason: `Target ${def.name} is not a mineable solid block.` };
    }
    return { ok: true };
  }

  function canToolReachHit(hit, aimYaw = null) {
    if (typeof getToolCollisionFrame !== "function") return isHitInMiningReach(hit);
    const targetBox = createBlockAabb(hit.worldX, hit.worldY, hit.worldZ, blockCollisionPadding, scratchTargetBox);
    const samples = [collisionStartProgress, 0.34, 0.48, 0.64, 0.82, 0.96];
    let previous = null;
    let previousCount = 0;
    for (const progress of samples) {
      const frame = getToolCollisionFrame({ progress, yaw: aimYaw, swing: { hit, aimYaw } });
      const boxes = Array.isArray(frame?.boxes) ? frame.boxes : [];
      for (let index = 0; index < boxes.length; index += 1) {
        if (aabbIntersectsAabb(boxes[index], targetBox)) return true;
        const previousBox = previous?.[index];
        if (previousBox && index < previousCount && sweptAabbIntersection(previousBox, boxes[index], targetBox, scratchCollisionResult).hit) return true;
      }
      previous = copyToolBoxes(boxes, previous);
      previousCount = boxes.length;
    }
    return false;
  }

  function toolCollisionHit(hit, boxes, previousBoxes, previousBoxCount) {
    const targetBox = createBlockAabb(hit.worldX, hit.worldY, hit.worldZ, blockCollisionPadding, scratchTargetBox);
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      if (aabbIntersectsAabb(box, targetBox)) {
        return collisionResultFromBox(box, targetBox, 1);
      }
      const previous = previousBoxes?.[index];
      if (!previous || index >= previousBoxCount) continue;
      const result = sweptAabbIntersection(previous, box, targetBox, scratchCollisionResult);
      if (result.hit) return { hit: true, pointX: result.x, pointY: result.y, pointZ: result.z, time: result.time };
    }
    return { hit: false };
  }

  function applyMiningDamage(swing, hitResult) {
    const hit = swing.hit;
    const currentBlockId = chunks.getBlockAtWorld(hit.worldX, hit.worldY, hit.worldZ);
    if (currentBlockId !== swing.blockId) {
      onStatus(`Mining target changed before impact at ${hit.worldX}, ${hit.worldY}, ${hit.worldZ}.`);
      return null;
    }
    if (isBlockPending(hit)) return null;
    const selectedTool = gameState.hotbarSlots[swing.selectedToolIndex];
    if (!gameState.isUsableMiningToolSlot?.(selectedTool)) {
      onStatus("Mining tool is no longer usable.");
      return null;
    }
    const def = blockDef(hit.blockId);
    const validation = validateMiningTarget(hit, { checkReach: false });
    if (!validation.ok) {
      onStatus(validation.reason);
      return null;
    }

    const key = damageKey(hit);
    const now = performance.now();
    prunePartialDamage(now, key);
    const damageState = partialDamageState(key, now);
    const nextDamage = damageState.damage + 1;
    const requiredDamage = Math.max(1, swing.requiredDamage || requiredDamageForBlock(hit.blockId, def));
    damageState.damage = nextDamage;
    damageState.lastTouchedAt = now;
    damageState.toolDamageBySlot.set(
      swing.selectedToolIndex,
      (damageState.toolDamageBySlot.get(swing.selectedToolIndex) ?? 0) + 1,
    );
    selectedTool.durability = Math.max(0, Math.trunc(selectedTool.durability || 0) - 1);
    gameState.saveHotbarSlots();
    const damageInfo = {
      hit: cloneHit(hit),
      blockName: def.name,
      damage: nextDamage,
      requiredDamage,
      pointX: hitResult.pointX,
      pointY: hitResult.pointY,
      pointZ: hitResult.pointZ,
    };
    onDamage(damageInfo);
    onChanged();

    if (nextDamage < requiredDamage) {
      return damageInfo;
    }

    const resourceId = Number.isFinite(hit.resourceId) ? hit.resourceId : def.resourceId;
    const txId = `local-pending-${txSerial++}`;
    const skillEffects = getSkillEffects?.() ?? {};
    const yieldBps = Math.max(1, Math.min(10000, Math.trunc(skillEffects.precisionGatheringBps || 1000)));
    const volumeMilliLiters = Math.max(1, Math.floor(1000 * yieldBps / 10000));
    const planBlocks = currentPlanBlocks(swing, hit);
    const plannedRewardBlocks = swing.miningPlan?.rewardBlocks?.length ? swing.miningPlan.rewardBlocks : planBlocks;
    const rewardGroups = rewardGroupsForBlocks(uniqueMiningBlocks([hit, ...plannedRewardBlocks]), {
      yieldBps,
      volumeMilliLiters,
    });

    const toolDamageBySlot = Array.from(damageState.toolDamageBySlot, ([slotIndex, amount]) => ({
      slotIndex,
      amount,
    }));
    blockDamage.delete(key);
    const pendingDeltas = planBlocks.map((block) => ({ worldX: block.worldX, worldY: block.worldY, worldZ: block.worldZ, blockId: blockAirId }));
    const pending = {
      txId,
      worldX: hit.worldX,
      worldY: hit.worldY,
      worldZ: hit.worldZ,
      blockId: hit.blockId,
      resourceId,
      miningKind: swing.miningPlan?.kind || "single-block",
      minedBlockCount: planBlocks.length,
      blocks: planBlocks.map((block) => ({ ...block })),
      collapseBlocks: (swing.miningPlan?.collapseBlocks ?? []).map((block) => ({ ...block })),
      rewardBlocks: (swing.miningPlan?.rewardBlocks ?? []).map((block) => ({ ...block })),
      rewardGroups: rewardGroups.map((group) => ({ ...group })),
      pendingDeltas,
      toolSlotIndex: swing.selectedToolIndex,
      toolDamage: nextDamage,
      toolDamageBySlot,
      requiredDamage,
      gatheringYieldBps: yieldBps,
      resourceVolumeMilliLiters: volumeMilliLiters,
      swingStartedAt: swing.startedAt,
      swingImpactAt: performance.now(),
    };
    pendingTx.push(pending);
    gameState.playerProfile.minedBlocks += planBlocks.length;
    gameState.savePlayerProfile();
    onPending(pending);
    onChanged();
    return pending;
  }

  function confirmLast() {
    return confirmPendingAt(pendingTx.length - 1);
  }

  function confirmTx(txId) {
    return confirmPendingAt(pendingTx.findIndex((pending) => pending.txId === txId));
  }

  function confirmPendingAt(index) {
    const pending = index >= 0 ? pendingTx[index] : null;
    if (!pending) {
      onStatus("No pending delta to confirm.");
      return null;
    }
    const { txId } = pending;
    chunks.applyPendingDelta(pending.pendingDeltas ?? pending.blocks?.map((block) => ({
      worldX: block.worldX,
      worldY: block.worldY,
      worldZ: block.worldZ,
      blockId: blockAirId,
    })) ?? [], txId);
    chunks.confirmPendingDelta(txId);
    pendingTx.splice(index, 1);
    const confirmedItems = (pending.rewardGroups ?? []).reduce((sum, group) => sum + Math.max(0, Math.trunc(group.count || 0)), 0);
    gameState.playerProfile.confirmedMines += Math.max(1, Math.trunc(pending.minedBlockCount || 1));
    gameState.playerProfile.resourcesCollected += confirmedItems;
    gameState.savePlayerProfile();
    onConfirm(pending);
    onChanged();
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
      onStatus("No pending delta to rollback.");
      return null;
    }
    const damageEntries = Array.isArray(pending.toolDamageBySlot) && pending.toolDamageBySlot.length
      ? pending.toolDamageBySlot
      : Number.isInteger(pending.toolSlotIndex) && Number(pending.toolDamage) > 0
        ? [{ slotIndex: pending.toolSlotIndex, amount: pending.toolDamage }]
        : [];
    for (const entry of damageEntries) {
      gameState.restoreToolDamage(entry.slotIndex, entry.amount);
    }
    gameState.playerProfile.rolledBackMines += 1;
    gameState.playerProfile.minedBlocks = Math.max(0, gameState.playerProfile.minedBlocks - Math.max(1, Math.trunc(pending.minedBlockCount || 1)));
    gameState.savePlayerProfile();
    onRollback(pending);
    onChanged();
    return pending;
  }

  function isHitInMiningReach(hit) {
    const player = getPlayerBounds?.();
    if (!player || !hit?.hit) return true;
    const cx = Math.trunc(hit.worldX) + 0.5;
    const cy = Math.trunc(hit.worldY) + 0.5;
    const cz = Math.trunc(hit.worldZ) + 0.5;
    const px = Number(player.x) || 0;
    const py = (Number(player.y) || 0) + Math.min((Number(player.height) || 0) * 0.72, miningReach * 0.58);
    const pz = Number(player.z) || 0;
    const dx = cx - px;
    const dy = cy - py;
    const dz = cz - pz;
    return dx * dx + dy * dy + dz * dz <= miningReach * miningReach;
  }

  return {
    minePending,
    queueBatchMine,
    update,
    confirmLast,
    confirmTx,
    rollbackLast,
    rollbackTx,
    activeSwing: () => activeSwing ? { ...activeSwing, hit: { ...activeSwing.hit } } : null,
    pendingCount: () => pendingTx.length,
    pendingTargets: () => pendingTx,
    pendingSnapshot: () => pendingTx.map((entry) => ({
      ...entry,
      blocks: entry.blocks?.map((block) => ({ ...block })) ?? [],
      pendingDeltas: entry.pendingDeltas?.map((delta) => ({ ...delta })) ?? [],
    })),
  };

  function isBlockPending(hit) {
    const key = damageKey(hit);
    return pendingTx.some((pending) => {
      const blocks = pending.blocks?.length ? pending.blocks : [pending];
      return blocks.some((block) => damageKey(block) === key);
    });
  }

  function requiredDamageForBlock(blockId, def = blockDef(blockId)) {
    // Every mineable target resolves on the third valid physical tool contact.
    // Hardness still decides whether a block is mineable, not the visible hit count.
    return Math.max(1, Math.trunc(defaultRequiredDamage));
  }

  function partialDamageState(key, now) {
    const existing = blockDamage.get(key);
    if (existing) return existing;
    const state = {
      damage: 0,
      lastTouchedAt: now,
      toolDamageBySlot: new Map(),
    };
    blockDamage.set(key, state);
    return state;
  }

  function prunePartialDamage(now, retainedKey = "") {
    const ttl = Math.max(1_000, Number(partialDamageTtlMs) || 2 * 60_000);
    const limit = Math.max(8, Math.trunc(Number(maxPartialDamageEntries) || 256));
    const force = blockDamage.size >= limit;
    if (!force && now - lastDamagePruneAt < Math.min(5_000, ttl * 0.25)) return;
    lastDamagePruneAt = now;
    for (const [key, state] of blockDamage) {
      if (key !== retainedKey && now - state.lastTouchedAt >= ttl) blockDamage.delete(key);
    }
    while (blockDamage.size >= limit) {
      let oldestKey = "";
      let oldestAt = Infinity;
      for (const [key, state] of blockDamage) {
        if (key === retainedKey) continue;
        if (state.lastTouchedAt < oldestAt) {
          oldestAt = state.lastTouchedAt;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      blockDamage.delete(oldestKey);
    }
  }

  function miningPlanForHit(hit, def = blockDef(hit.blockId)) {
    const fallback = {
      kind: "single-block",
      blocks: [normalizeMiningBlock(hit)],
      rewardBlocks: [normalizeMiningBlock(hit)],
      requiredDamage: requiredDamageForBlock(hit.blockId, def),
    };
    if (typeof getMiningPlan !== "function") return fallback;
    const external = getMiningPlan(cloneHit(hit));
    if (!external?.blocks?.length) return fallback;
    const blocks = uniqueMiningBlocks(external.blocks.map(normalizeMiningBlock).filter(Boolean));
    if (!blocks.length) return fallback;
    if (!blocks.some((block) => damageKey(block) === damageKey(hit))) blocks.unshift(fallback.blocks[0]);
    const rewardBlocks = uniqueMiningBlocks((external.rewardBlocks?.length ? external.rewardBlocks : blocks).map(normalizeMiningBlock).filter(Boolean));
    return {
      kind: String(external.kind || "batch-mine"),
      blocks,
      collapseBlocks: uniqueMiningBlocks((external.collapseBlocks ?? []).map(normalizeMiningBlock).filter(Boolean)),
      rewardBlocks: rewardBlocks.length ? rewardBlocks : blocks,
      requiredDamage: fallback.requiredDamage,
    };
  }
}

function currentPlanBlocks(swing, hit) {
  const blocks = uniqueMiningBlocks((swing.miningPlan?.blocks?.length ? swing.miningPlan.blocks : [hit]).map(normalizeMiningBlock).filter(Boolean));
  const valid = blocks.filter((block) => swing.blockId === hit.blockId || damageKey(block) !== damageKey(hit) || block.blockId === hit.blockId);
  return valid.length ? valid : [normalizeMiningBlock(hit)];
}

function rewardGroupsForBlocks(blocks = [], { yieldBps = 10000, volumeMilliLiters = 1000 } = {}) {
  const groups = new Map();
  for (const block of blocks) {
    const normalized = normalizeMiningBlock(block);
    if (!normalized || normalized.resourceId === 0) continue;
    const key = `${normalized.resourceId}:${normalized.blockId}:${yieldBps}:${volumeMilliLiters}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, {
      resourceId: normalized.resourceId,
      blockId: normalized.blockId,
      count: 1,
    });
  }
  return Array.from(groups.values());
}

function uniqueMiningBlocks(blocks = []) {
  const seen = new Set();
  const output = [];
  for (const block of blocks) {
    const normalized = normalizeMiningBlock(block);
    if (!normalized) continue;
    const key = damageKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function normalizeMiningBlock(block) {
  if (!block) return null;
  const worldX = Math.trunc(Number(block.worldX ?? block.x));
  const worldY = Math.trunc(Number(block.worldY ?? block.y));
  const worldZ = Math.trunc(Number(block.worldZ ?? block.z));
  const blockId = Math.trunc(Number(block.blockId));
  if (![worldX, worldY, worldZ, blockId].every(Number.isFinite)) return null;
  return {
    hit: true,
    worldX,
    worldY,
    worldZ,
    chunkX: Math.trunc(Number(block.chunkX) || 0),
    chunkZ: Math.trunc(Number(block.chunkZ) || 0),
    localX: Math.trunc(Number(block.localX) || 0),
    localY: Math.trunc(Number(block.localY) || 0),
    localZ: Math.trunc(Number(block.localZ) || 0),
    blockId,
    resourceId: Math.trunc(Number(block.resourceId) || 0),
    materialId: Math.trunc(Number(block.materialId) || 0),
    faceX: Math.trunc(Number(block.faceX) || 0),
    faceY: Math.trunc(Number(block.faceY) || 0),
    faceZ: Math.trunc(Number(block.faceZ) || 1),
  };
}

function collisionResultFromBox(box, targetBox, time) {
  const cx = (box.minX + box.maxX) * 0.5;
  const cy = (box.minY + box.maxY) * 0.5;
  const cz = (box.minZ + box.maxZ) * 0.5;
  return {
    hit: true,
    pointX: clamp(cx, targetBox.minX, targetBox.maxX),
    pointY: clamp(cy, targetBox.minY, targetBox.maxY),
    pointZ: clamp(cz, targetBox.minZ, targetBox.maxZ),
    time,
  };
}

function copyToolBoxes(boxes, target = null) {
  const output = target ?? [];
  output.length = boxes.length;
  for (let index = 0; index < boxes.length; index += 1) {
    const source = boxes[index];
    const entry = output[index] ?? {};
    entry.minX = source.minX;
    entry.maxX = source.maxX;
    entry.minY = source.minY;
    entry.maxY = source.maxY;
    entry.minZ = source.minZ;
    entry.maxZ = source.maxZ;
    output[index] = entry;
  }
  return output;
}

function cloneHit(hit) {
  return {
    hit: true,
    worldX: Math.trunc(hit.worldX),
    worldY: Math.trunc(hit.worldY),
    worldZ: Math.trunc(hit.worldZ),
    chunkX: Math.trunc(hit.chunkX),
    chunkZ: Math.trunc(hit.chunkZ),
    localX: Math.trunc(hit.localX),
    localY: Math.trunc(hit.localY),
    localZ: Math.trunc(hit.localZ),
    blockId: Math.trunc(hit.blockId),
    resourceId: Math.trunc(hit.resourceId),
    faceX: Math.trunc(hit.faceX || 0),
    faceY: Math.trunc(hit.faceY || 0),
    faceZ: Math.trunc(hit.faceZ || 0),
  };
}

function damageKey(hit) {
  return `${Math.trunc(hit.worldX)},${Math.trunc(hit.worldY)},${Math.trunc(hit.worldZ)}`;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const scratchTargetBox = {};
const scratchCollisionResult = {};
