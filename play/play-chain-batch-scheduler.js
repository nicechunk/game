// Both Worker and main fallback use this work-conserving pool: a slow distant
// batch never blocks delivery of a completed near batch.
export async function runChunkBatchPool(batches, { concurrency = 4, signal, fetchBatch, onResult = async () => {} } = {}) {
  let cursor = 0;
  let active = 0;
  let maxActive = 0;
  const failures = [];
  const count = Math.max(1, Math.min(4, Math.trunc(concurrency) || 4));
  await Promise.all(Array.from({ length: Math.min(count, batches.length) }, async () => {
    while (!signal?.aborted) {
      const index = cursor++;
      if (index >= batches.length) return;
      active += 1;
      maxActive = Math.max(maxActive, active);
      let result;
      try { result = await fetchBatch(batches[index], index, signal); }
      catch (error) { result = { ok: false, error: String(error?.message || error) }; }
      finally { active -= 1; }
      if (signal?.aborted) return;
      try { await onResult(result, index); } catch (error) { failures.push(error); }
    }
  }));
  if (failures.length) throw failures[0];
  return { completed: Math.min(cursor, batches.length), maxActive, cancelled: Boolean(signal?.aborted) };
}

export function optionalContextSlot(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function pushChunkSnapshotHeap(heap, snapshot) {
  heap.push(snapshot);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (compareSnapshots(heap[parent], heap[index]) <= 0) break;
    [heap[parent], heap[index]] = [heap[index], heap[parent]]; index = parent;
  }
}

export function popChunkSnapshotHeap(heap) {
  const root = heap[0], last = heap.pop();
  if (!heap.length) return root;
  heap[0] = last;
  siftSnapshotDown(heap, 0);
  return root;
}

export function rebuildChunkSnapshotHeap(heap) {
  for (let index = (heap.length >> 1) - 1; index >= 0; index--) siftSnapshotDown(heap, index);
}

function siftSnapshotDown(heap, index) {
  while (true) {
    let child = index * 2 + 1;
    if (child >= heap.length) break;
    if (child + 1 < heap.length && compareSnapshots(heap[child + 1], heap[child]) < 0) child++;
    if (compareSnapshots(heap[index], heap[child]) <= 0) break;
    [heap[index], heap[child]] = [heap[child], heap[index]]; index = child;
  }
}

function compareSnapshots(a, b) {
  return (a.virtualFinish ?? a.priority) - (b.virtualFinish ?? b.priority)
    || (a.estimatedWork ?? 0) - (b.estimatedWork ?? 0)
    || a.priority - b.priority
    || a.queuedAt - b.queuedAt;
}

export function yieldChunkSyncTask() {
  if (typeof globalThis.scheduler?.yield === "function") return globalThis.scheduler.yield();
  if (typeof globalThis.setImmediate === "function") return new Promise((resolve) => globalThis.setImmediate(resolve));
  // A fresh channel is closed immediately after delivery. This avoids nested
  // timer clamping in older browsers without keeping an unbounded global queue.
  if (typeof MessageChannel === "function") return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  });
  return new Promise((resolve) => setTimeout(resolve, 0));
}
