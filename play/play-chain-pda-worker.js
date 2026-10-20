import { decodeVerifiedChunkPairs, compactVerifiedChunkPair, restoreVerifiedChunkPair, chunkPairWorkSnapshot } from "./play-chain-chunk-pair.js";
const pairs = new Map(); let pairBytes = 0;
import { decodeChunkAccountBatch } from "./play-chain-chunk-codec.js";
import { canonicalChunkWorkSnapshot } from "./play-chain-chunk-canonical.js";
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
        const baselines = {};
        for (let index = 0; index < batch.length; index++) {
          const chunk = batch[index], id = chunk.chunkX + "," + chunk.chunkZ, incoming = task.baselines?.[id];
          let baseline = pairs.get(incoming?.pairToken);
          if (!baseline && incoming?.broken) {
            try { baseline = await restoreVerifiedChunkPair(incoming, { ...chunk, pubkeys: pubkeyPairs[index], scope: task.scope,
              expectedOwner: task.pdaConfig.programId, minY: task.minY, chunkSize: task.chunkSize || 16 }); } catch { /* Cold read repairs a lost Worker baseline in one RTT. */ }
          }
          if (baseline) baselines[id] = baseline;
        }
        const slots = Object.values(baselines).map(pair => pair.knownAtSlot);
        const readOptions = { minContextSlot: Math.max(task.minContextSlot || 0, ...slots) || null,
          changedSinceSlot: slots.length === batch.length ? Math.min(...slots) : null };
        const result = await fetchChunkAccountBatch({ ...readOptions, encoding: task.batchEncodings?.[batchIndex] || task.encoding, endpointEpoch: task.endpointEpoch, rpcUrl: task.rpcUrl, pubkeys: pubkeyPairs.flat(), requestId: task.taskId * 100 + batchIndex, timeoutMs: task.timeoutMs, signal });
        if (result.ok && !signal.aborted && task.scope) {
          const decoded = await decodeVerifiedChunkPairs(batch, result.observations, { baselines, scope: task.scope,
            chunkSize: task.chunkSize || 16, minY: task.minY, expectedOwner: task.pdaConfig.programId,
            contextSlot: result.contextSlot, changedSinceSlot: result.changedSinceSlot,
            readStartedAt: result.readStartedAt, observedAt: result.observedAt, signal });
          result.pairs = decoded.pairs.map(pair => {
            if (!pairs.has(pair.pairToken)) pairBytes += pair.byteLength;
            pairs.delete(pair.pairToken); pairs.set(pair.pairToken, pair);
            return compactVerifiedChunkPair(pair, baselines[pair.id]);
          });
          while (pairBytes > 64 * 1024 * 1024 || pairs.size > 2048) {
            const key = pairs.keys().next().value; pairBytes -= pairs.get(key).byteLength; pairs.delete(key);
          }
          result.pairErrors = decoded.errors;
          result.pairWork = chunkPairWorkSnapshot();
          delete result.infos; delete result.observations;
        } else if (result.ok && !signal.aborted) {
          result.decoded = await decodeChunkAccountBatch(batch, result.infos, {
            chunkSize: task.chunkSize || 16, minY: task.minY, contextSlot: result.contextSlot,
            expectedOwner: task.pdaConfig.programId, globalConfig: task.pdaConfig.globalConfig,
            signal, compact: true,
          });
          result.decodeWork = canonicalChunkWorkSnapshot();
          delete result.infos;
        }
        return result;
      },
      onResult: (result, batchIndex) => {
        const transfer = [];
        for (const record of result.decoded?.snapshots ?? []) transfer.push(record.packedDeltas.buffer);
        for (const record of result.pairs ?? []) if (record.canonical?.packedDeltas?.buffer) transfer.push(record.canonical.packedDeltas.buffer);
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
