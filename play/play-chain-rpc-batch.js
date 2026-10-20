// Capability belongs to the endpoint and configuration epoch, not the chain.
const capabilities = new Map();
const MAX_ACCOUNT_BYTES = 18448;
export function chunkRpcCapabilities() {
  return [...capabilities.values()].map(({ conditional, encoding }) => ({ conditional, encoding }));
}
export function resetChunkRpcCapabilities() { capabilities.clear(); }

export async function fetchChunkAccountBatch({ rpcUrl, pubkeys, requestId, timeoutMs,
  minContextSlot = null, changedSinceSlot = null, encoding = "base64", endpointEpoch = 0, signal }) {
  if (!Array.isArray(pubkeys) || !pubkeys.length || pubkeys.length > 100 || pubkeys.some(key => typeof key !== "string" || !key)) {
    return { ok: false, error: "Invalid chunk account request.", infos: [] };
  }
  const key = JSON.stringify([rpcUrl, endpointEpoch]);
  let capability = capabilities.get(key);
  if (!capability) {
    if (capabilities.size >= 16) capabilities.delete(capabilities.keys().next().value);
    capabilities.set(key, capability = { conditional: "unknown", encoding: "unknown" });
  }
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const readStartedAt = Date.now();
  const timeout = setTimeout(abort, Math.max(1000, Math.trunc(Number(timeoutMs) || 12000)));
  const minimum = validSlot(minContextSlot, true);
  let threshold = validSlot(changedSinceSlot, true);
  if (capability.conditional === "unsupported") threshold = null;
  let selectedEncoding = encoding === "base64+zstd" && capability.encoding !== "unsupported" ? encoding : "base64";
  const metrics = { rpcCalls: 0, fullCalls: 0, conditionalCalls: 0, responseJsonBytes: 0,
    requestJsonBytes: 0, availableWireBytes: null, encodedBodySize: null, decodedAccountBytes: 0,
    fullAccountCount: 0, unchangedAccountCount: 0, absentAccountCount: 0 };
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const config = { commitment: "finalized", encoding: selectedEncoding };
      if (minimum !== null) config.minContextSlot = minimum;
      if (threshold !== null) config.changedSinceSlot = threshold;
      const body = JSON.stringify({ jsonrpc: "2.0", id: requestId, method: "getMultipleAccounts", params: [pubkeys, config] });
      metrics.rpcCalls++; metrics[threshold === null ? "fullCalls" : "conditionalCalls"]++;
      metrics.requestJsonBytes += new TextEncoder().encode(body).byteLength;
      const response = await fetch(String(rpcUrl || ""), { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store", signal: controller.signal });
      if (!response.ok) return { ok: false, error: "RPC HTTP " + response.status, httpStatus: response.status, infos: [], metrics };
      const json = await response.text();
      if (json.length > pubkeys.length * 30000 + 8192) throw new Error("Oversized chunk RPC response.");
      metrics.responseJsonBytes += new TextEncoder().encode(json).byteLength;
      const payload = JSON.parse(json), observedAt = Date.now();
      if (payload?.id !== requestId || payload?.jsonrpc !== "2.0") throw new Error("Chunk RPC response identity mismatch.");
      if (payload.error) {
        const message = String(payload.error.message || "RPC error");
        const unsupported = payload.error.code === -32602 && /invalid param|unsupported|not support|unknown field/i.test(message);
        if (unsupported && threshold !== null && !/encoding|zstd/i.test(message)) {
          capability.conditional = "unsupported"; threshold = null; continue;
        }
        if (unsupported && selectedEncoding !== "base64") {
          capability.encoding = "unsupported"; selectedEncoding = "base64"; continue;
        }
        return { ok: false, error: "Chunk RPC rejected the read.", rpcCode: payload.error.code, infos: [], metrics };
      }
      const values = payload?.result?.value, contextSlot = validSlot(payload?.result?.context?.slot);
      if (contextSlot === null || minimum !== null && contextSlot < minimum || !Array.isArray(values) || values.length !== pubkeys.length) {
        throw new Error("Invalid chunk RPC context or response length.");
      }
      const observations = [];
      for (let index = 0; index < values.length; index++) {
        try {
          const observation = await decodeAccountObservation(values[index], pubkeys[index]);
          if (observation.kind === "unchanged") {
            if (threshold === null) throw new Error("Unsolicited unchanged account.");
            capability.conditional = "supported"; metrics.unchangedAccountCount++;
          } else if (observation.kind === "absent") metrics.absentAccountCount++;
          else { metrics.fullAccountCount++; metrics.decodedAccountBytes += observation.account.data.byteLength; }
          observations.push(observation);
        } catch { observations.push({ kind: "error", pubkey: pubkeys[index], error: "Invalid chunk account envelope." }); }
      }
      if (selectedEncoding === "base64+zstd" && observations.some(item => item.kind === "full")) capability.encoding = "supported";
      return { ok: true, contextSlot, readStartedAt, observedAt, commitment: "finalized",
        changedSinceSlot: threshold, observations, infos: observations.map(item => item.kind === "full" ? item.account : item.kind === "absent" ? null : item), metrics };
    }
    throw new Error("Chunk RPC capability fallback exhausted.");
  } catch (error) {
    return { ok: false, error: error?.name === "AbortError" ? "chunk PDA RPC batch timed out" : "Invalid chunk RPC response.", infos: [], metrics };
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}

export async function decodeAccountObservation(account, pubkey) {
  if (account === null) return { kind: "absent", pubkey };
  if (!account || typeof account !== "object" || Array.isArray(account)) throw new Error("Missing account.");
  if (Object.hasOwn(account, "status")) {
    if (account.status !== "unchanged" || Object.keys(account).length !== 1) throw new Error("Invalid unchanged account.");
    return { kind: "unchanged", pubkey };
  }
  if (!Array.isArray(account.data) || account.data.length !== 2 || typeof account.data[0] !== "string"
    || typeof account.owner !== "string" || !account.owner || account.executable !== false) throw new Error("Invalid account envelope.");
  const [encoded, encoding] = account.data;
  if (encoded.length > 30000 || encoded.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error("Invalid base64.");
  const binary = atob(encoded);
  let data = Uint8Array.from(binary, value => value.charCodeAt(0));
  if (encoding === "base64+zstd") {
    const { decompressChunkAccount } = await import("./play-chain-zstd.js");
    data = decompressChunkAccount(data, MAX_ACCOUNT_BYTES);
  } else if (encoding !== "base64") throw new Error("Unknown chunk encoding.");
  if (!data.byteLength || data.byteLength > MAX_ACCOUNT_BYTES
    || account.space !== undefined && (!Number.isSafeInteger(account.space) || account.space !== data.byteLength)) throw new Error("Invalid account output length.");
  return { kind: "full", pubkey, account: { data, owner: account.owner, executable: false, space: data.byteLength } };
}

function validSlot(value, optional = false) {
  if (optional && (value === null || value === undefined)) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
