import { createChunkBrokenPdaDeriver } from "./play-solana-pda-lite.js";

const pdaCache = new Map();
let activeConfigKey = "";

self.onmessage = async (event) => {
  const task = event.data;
  if (!task || task.type !== "fetchChunkPdas") return;
  try {
    const deriveChunkBrokenPda = configuredDeriver(task.pdaConfig);
    const batches = Array.isArray(task.batches) ? task.batches : [];
    const batchResults = await Promise.all(batches.map(async (batch, batchIndex) => {
      const pubkeys = await Promise.all((batch ?? []).map((chunk) => deriveCachedPda(
        deriveChunkBrokenPda,
        chunk.chunkX,
        chunk.chunkZ,
      )));
      return fetchAccountBatch({
        rpcUrl: task.rpcUrl,
        pubkeys,
        requestId: task.taskId * 100 + batchIndex,
        timeoutMs: task.timeoutMs,
        minContextSlot: task.minContextSlot,
      });
    }));
    const transfer = [];
    for (const result of batchResults) {
      for (const info of result.infos ?? []) {
        if (info?.data?.buffer) transfer.push(info.data.buffer);
      }
    }
    self.postMessage({ type: "chunkPdasFetched", taskId: task.taskId, batchResults }, transfer);
  } catch (error) {
    self.postMessage({
      type: "chunkPdasFetchError",
      taskId: task.taskId,
      error: readableError(error),
    });
  }
};

function configuredDeriver(config) {
  const key = [config?.seed, config?.globalConfig, config?.programId].map((value) => String(value || "")).join(":");
  if (!config?.seed || !config?.globalConfig || !config?.programId) throw new Error("Chunk PDA derivation config is unavailable.");
  if (key !== activeConfigKey) {
    activeConfigKey = key;
    pdaCache.clear();
  }
  return createChunkBrokenPdaDeriver(config);
}

async function deriveCachedPda(deriveChunkBrokenPda, chunkX, chunkZ) {
  const key = `${Math.trunc(chunkX)},${Math.trunc(chunkZ)}`;
  const cached = pdaCache.get(key);
  if (cached) return cached;
  const address = await deriveChunkBrokenPda(Math.trunc(chunkX), Math.trunc(chunkZ));
  if (!address) throw new Error(`Failed to derive chunk PDA ${chunkX},${chunkZ}.`);
  if (pdaCache.size >= 4096) pdaCache.delete(pdaCache.keys().next().value);
  pdaCache.set(key, address);
  return address;
}

async function fetchAccountBatch({ rpcUrl, pubkeys, requestId, timeoutMs, minContextSlot = 0 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, Math.trunc(Number(timeoutMs) || 12_000)));
  try {
    const config = { commitment: "confirmed", encoding: "base64" };
    const minimumSlot = Math.max(0, Math.trunc(Number(minContextSlot) || 0));
    if (minimumSlot > 0) config.minContextSlot = minimumSlot;
    const response = await fetch(String(rpcUrl || ""), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "getMultipleAccounts",
        params: [pubkeys, config],
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: `RPC HTTP ${response.status}`, infos: [] };
    const payload = await response.json();
    if (payload?.error) return { ok: false, error: readableError(payload.error?.message || payload.error), infos: [] };
    const values = payload?.result?.value;
    if (!Array.isArray(values) || values.length !== pubkeys.length) {
      return { ok: false, error: "Invalid getMultipleAccounts response length.", infos: [] };
    }
    return {
      ok: true,
      contextSlot: Math.max(0, Math.trunc(Number(payload?.result?.context?.slot) || 0)),
      infos: values.map(decodeAccountInfo),
    };
  } catch (error) {
    const reason = error?.name === "AbortError" ? "chunk PDA RPC batch timed out" : readableError(error);
    return { ok: false, error: reason, infos: [] };
  } finally {
    clearTimeout(timeout);
  }
}

function decodeAccountInfo(account) {
  if (!account) return null;
  const encoded = Array.isArray(account.data) ? account.data[0] : account.data;
  if (typeof encoded !== "string") throw new Error("Invalid base64 account data.");
  const binary = atob(encoded);
  const data = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
  return {
    data,
    owner: String(account.owner || ""),
    executable: Boolean(account.executable),
  };
}

function readableError(error) {
  const message = String(error?.message || error || "unknown error");
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}
