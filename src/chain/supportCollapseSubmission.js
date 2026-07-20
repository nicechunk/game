export const SUPPORT_COLLAPSE_BATCH_SIZE = 2;

export async function submitSupportCollapseBatches(blocks, submitBatch, {
  batchSize = SUPPORT_COLLAPSE_BATCH_SIZE,
} = {}) {
  const normalized = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
  const batches = partitionSupportCollapseBlocks(normalized, batchSize);
  const confirmed = [];
  const failures = [];
  const retryErrors = [];
  const aborted = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    try {
      const result = await submitBatch(batch);
      for (const block of batch) confirmed.push({ block, result, retried: false });
      continue;
    } catch (batchError) {
      retryErrors.push({ blocks: batch, error: batchError });
      if (batch.length === 1) {
        failures.push({ block: batch[0], error: batchError });
        continue;
      }

      let recoveredCount = 0;
      for (const block of batch) {
        try {
          const result = await submitBatch([block]);
          confirmed.push({ block, result, retried: true });
          recoveredCount += 1;
        } catch (error) {
          failures.push({ block, error });
        }
      }

      // Two independent failures normally indicate an expired session, RPC
      // outage, or another batch-wide fault. Do not fan that out to 48 calls.
      if (recoveredCount === 0) {
        for (const remaining of batches.slice(batchIndex + 1).flat()) {
          aborted.push({ block: remaining, error: batchError, reason: "batch-wide-failure" });
        }
        break;
      }
    }
  }

  return { confirmed, failures, retryErrors, aborted };
}

export function partitionSupportCollapseBlocks(blocks, batchSize = SUPPORT_COLLAPSE_BATCH_SIZE) {
  const size = Math.max(1, Math.trunc(Number(batchSize) || SUPPORT_COLLAPSE_BATCH_SIZE));
  const normalized = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
  const batches = [];
  for (let index = 0; index < normalized.length; index += size) {
    batches.push(normalized.slice(index, index + size));
  }
  return batches;
}
