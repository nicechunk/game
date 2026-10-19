import { createChunkPdaDeriver } from "./play-solana-pda-lite.js";

const pdaCache = new Map();
let activeConfigKey = "";

import { fetchChunkAccountBatch } from "./play-chain-rpc-batch.js";
import { runChunkBatchPool } from "./play-chain-batch-scheduler.js";
const activeTasks = new Map();

self.onmessage = async (event) => {
  const task = event.data;
  if (task?.type === "cancelChunkPdas") {
    activeTasks.get(task.taskId)?.abort();
    return;
  }
  if (task?.type !== "fetchChunkPdas") return;
  const controller = new AbortController();
  activeTasks.set(task.taskId, controller);
  try {
    const derivers = configuredDerivers(task.pdaConfig);
    const batches = Array.isArray(task.batches) ? task.batches : [];
    const stats = await runChunkBatchPool(batches, {
      concurrency: task.concurrency,
      signal: controller.signal,
      fetchBatch: async (batch, batchIndex, signal) => {
        const pubkeyPairs = [];
        for (const chunk of batch ?? []) {
          if (signal.aborted) return { ok: false, error: "cancelled" };
          pubkeyPairs.push([
            await deriveCachedPda("broken", derivers.broken, chunk.chunkX, chunk.chunkZ),
            await deriveCachedPda("placed", derivers.placed, chunk.chunkX, chunk.chunkZ),
          ]);
        }
        return fetchChunkAccountBatch({ rpcUrl: task.rpcUrl, pubkeys: pubkeyPairs.flat(), requestId: task.taskId * 100 + batchIndex, timeoutMs: task.timeoutMs, minContextSlot: task.minContextSlot, signal });
      },
      onResult: (result, batchIndex) => {
        const transfer = [];
        for (const info of result.infos ?? []) if (info?.data?.buffer) transfer.push(info.data.buffer);
        self.postMessage({ type: "chunkPdaBatchFetched", taskId: task.taskId, syncEpoch: task.syncEpoch, batchIndex, result }, transfer);
      },
    });
    if (!controller.signal.aborted) self.postMessage({ type: "chunkPdasFetched", taskId: task.taskId, syncEpoch: task.syncEpoch, stats });
  } catch (error) {
    if (!controller.signal.aborted) self.postMessage({ type: "chunkPdasFetchError", taskId: task.taskId, syncEpoch: task.syncEpoch, error: readableError(error) });
  } finally { activeTasks.delete(task.taskId); }
};

function configuredDerivers(config) {
  const key = [config?.seed, config?.placedSeed, config?.globalConfig, config?.programId]
    .map((value) => String(value || ""))
    .join(":");
  if (!config?.seed || !config?.placedSeed || !config?.globalConfig || !config?.programId) {
    throw new Error("Chunk PDA derivation config is unavailable.");
  }
  if (key !== activeConfigKey) {
    activeConfigKey = key;
    pdaCache.clear();
  }
  return {
    broken: createChunkPdaDeriver(config),
    placed: createChunkPdaDeriver({ ...config, seed: config.placedSeed }),
  };
}

async function deriveCachedPda(kind, deriveChunkPda, chunkX, chunkZ) {
  const key = `${kind}:${Math.trunc(chunkX)},${Math.trunc(chunkZ)}`;
  const cached = pdaCache.get(key);
  if (cached) return cached;
  const address = await deriveChunkPda(Math.trunc(chunkX), Math.trunc(chunkZ));
  if (!address) throw new Error(`Failed to derive chunk PDA ${chunkX},${chunkZ}.`);
  if (pdaCache.size >= 4096) pdaCache.delete(pdaCache.keys().next().value);
  pdaCache.set(key, address);
  return address;
}

function readableError(error) {
  const message = String(error?.message || error || "unknown error");
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}
