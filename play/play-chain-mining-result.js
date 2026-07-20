export function reconcilePendingMineWithChainResult(pending, chainResult) {
  if (!pending) {
    return { changed: false, droppedCount: 0, confirmedCount: 0 };
  }

  const originalBlocks = Array.isArray(pending.blocks) && pending.blocks.length ? pending.blocks : [pending];
  const previousCount = Math.max(1, Math.trunc(Number(pending.minedBlockCount) || originalBlocks.length || 1));
  const chainConfirmedBlocks = Array.isArray(chainResult?.confirmedBlocks) ? chainResult.confirmedBlocks : [];
  let confirmedBlocks = originalBlocks;
  if (chainConfirmedBlocks.length) {
    const confirmedKeys = new Set(chainConfirmedBlocks.map(blockKey).filter(Boolean));
    confirmedBlocks = originalBlocks.filter((block) => confirmedKeys.has(blockKey(block)));
    if (!confirmedBlocks.length) return { changed: false, droppedCount: 0, confirmedCount: 0 };
    const confirmedKeySet = new Set(confirmedBlocks.map(blockKey));
    pending.blocks = confirmedBlocks.map((block) => ({ ...block }));
    pending.pendingDeltas = (Array.isArray(pending.pendingDeltas) ? pending.pendingDeltas : [])
      .filter((delta) => confirmedKeySet.has(blockKey(delta)))
      .map((delta) => ({ ...delta }));
    pending.collapseBlocks = (Array.isArray(pending.collapseBlocks) ? pending.collapseBlocks : [])
      .filter((block) => confirmedKeySet.has(blockKey(block)))
      .map((block) => ({ ...block }));
    pending.minedBlockCount = confirmedBlocks.length;
  }

  if (chainResult?.lossyRewards) {
    const storedRewards = normalizeStoredRewards(chainResult.storedRewards, originalBlocks);
    pending.lossyRewards = true;
    pending.storedRewardCount = Math.max(
      0,
      Math.trunc(Number(chainResult.storedRewardCount) || storedRewards.length),
    );
    pending.rewardBlocks = storedRewards.map((block) => ({ ...block }));
    pending.rewardGroups = rewardGroupsForBlocks(storedRewards);
  } else if (chainConfirmedBlocks.length) {
    const primaryKey = blockKey(pending);
    const rewardedKeys = new Set([
      primaryKey,
      ...(Array.isArray(chainResult?.rewardBlocks) ? chainResult.rewardBlocks.map(blockKey) : []),
    ].filter(Boolean));
    const rewardBlocks = confirmedBlocks.filter((block) => rewardedKeys.has(blockKey(block)));
    pending.rewardBlocks = rewardBlocks.map((block) => ({ ...block }));
    pending.rewardGroups = rewardGroupsForBlocks(rewardBlocks);
  }
  pending.chainPartialCollapse = Boolean(chainResult?.partialCollapse);
  pending.failedCollapseBlocks = Array.isArray(chainResult?.failedCollapseBlocks)
    ? chainResult.failedCollapseBlocks.map((entry) => ({ ...entry }))
    : [];
  pending.chainPartialBulkMine = Boolean(chainResult?.partialBulkMine);
  pending.failedBulkBlocks = Array.isArray(chainResult?.failedBulkBlocks)
    ? chainResult.failedBulkBlocks.map((entry) => ({ ...entry }))
    : [];

  return {
    changed: confirmedBlocks.length !== previousCount || Boolean(chainResult?.lossyRewards),
    droppedCount: Math.max(0, previousCount - confirmedBlocks.length),
    confirmedCount: confirmedBlocks.length,
    confirmedBlocks: pending.blocks,
  };
}

function rewardGroupsForBlocks(blocks) {
  const groups = new Map();
  for (const block of blocks) {
    const resourceId = finiteInteger(block?.resourceId);
    const blockId = finiteInteger(block?.blockId);
    if (resourceId === null || resourceId <= 0 || blockId === null) continue;
    const key = `${resourceId}:${blockId}`;
    const existing = groups.get(key);
    const count = Math.max(1, Math.trunc(Number(block?.count) || 1));
    if (existing) existing.count += count;
    else groups.set(key, { resourceId, blockId, count });
  }
  return Array.from(groups.values());
}

function normalizeStoredRewards(rewards, fallbackBlocks) {
  const output = [];
  for (const reward of Array.isArray(rewards) ? rewards : []) {
    const blockId = finiteInteger(reward?.blockId);
    if (blockId === null || blockId <= 0) continue;
    const fallback = (fallbackBlocks ?? []).find((block) => finiteInteger(block?.blockId) === blockId);
    const resourceId = finiteInteger(reward?.resourceId) ?? finiteInteger(fallback?.resourceId) ?? 0;
    output.push({
      ...reward,
      blockId,
      resourceId,
      count: Math.max(1, Math.trunc(Number(reward?.count) || 1)),
    });
  }
  return output;
}

function blockKey(block) {
  const x = finiteInteger(block?.worldX ?? block?.x);
  const y = finiteInteger(block?.worldY ?? block?.y);
  const z = finiteInteger(block?.worldZ ?? block?.z);
  return x === null || y === null || z === null ? "" : `${x},${y},${z}`;
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}
