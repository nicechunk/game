import { optionalContextSlot } from "./play-chain-batch-scheduler.js";

export async function fetchChunkAccountBatch({ rpcUrl, pubkeys, requestId, timeoutMs, minContextSlot = null, signal }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const readStartedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, Math.trunc(Number(timeoutMs) || 12_000)));
  try {
    const config = { commitment: "finalized", encoding: "base64" };
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
    const observedAt = Date.now();
    if (payload?.error) return { ok: false, error: readableError(payload.error?.message || payload.error), infos: [] };
    const values = payload?.result?.value;
    if (!Array.isArray(values) || values.length !== pubkeys.length) {
      return { ok: false, error: "Invalid getMultipleAccounts response length.", infos: [] };
    }
    return {
      ok: true,
      contextSlot: optionalContextSlot(payload?.result?.context?.slot),
      readStartedAt,
      observedAt,
      commitment: "finalized",
      infos: values.map(decodeAccountInfo),
    };
  } catch (error) {
    const reason = error?.name === "AbortError" ? "chunk PDA RPC batch timed out" : readableError(error);
    return { ok: false, error: reason, infos: [] };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
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


function readableError(error) { return String(error?.message || error || "unknown error").slice(0, 160); }
