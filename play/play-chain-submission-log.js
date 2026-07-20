const FAILURE_PREFIX = "[NiceChunk Chain Submission Failed]";

export function logChainSubmissionFailure({
  action = "unknown",
  stage = "unknown",
  pending = null,
  reason = "unknown-error",
  error = null,
  result = null,
  walletAddress = "",
  adapter = null,
  logger = globalThis.console,
} = {}) {
  const report = buildChainSubmissionFailureReport({
    action,
    stage,
    pending,
    reason,
    error,
    result,
    walletAddress,
    adapter,
  });
  const label = `${FAILURE_PREFIX} ${report.action}/${report.stage}`;
  logger?.error?.(`${label}: ${report.reason}`, report);
  if (error) logger?.error?.(`${label} original error`, error);
  if (report.programLogs.length) {
    logger?.error?.(`${label} Solana program logs\n${report.programLogs.join("\n")}`);
  }
  return report;
}

export function buildChainSubmissionFailureReport({
  action = "unknown",
  stage = "unknown",
  pending = null,
  reason = "unknown-error",
  error = null,
  result = null,
  walletAddress = "",
  adapter = null,
} = {}) {
  const programLogs = collectProgramLogs(error, result);
  return {
    timestamp: new Date().toISOString(),
    action: cleanText(action) || "unknown",
    stage: cleanText(stage) || "unknown",
    reason: cleanText(reason) || readableError(error),
    txId: cleanText(pending?.txId),
    signature: firstText(
      errorChainValue(error, "signature"),
      result?.signature,
      result?.result?.signature,
      pending?.chainSignature,
    ),
    walletAddress: cleanText(walletAddress),
    block: miningBlockSummary(pending),
    submission: submissionSummary(pending),
    adapter: adapterSummary(adapter),
    errorChain: errorChainSummary(error),
    transactionError: firstValue(
      errorChainValue(error, "transactionError"),
      errorChainValue(error, "data")?.err,
      errorChainValue(error, "simulationResponse")?.value?.err,
      result?.transactionError,
      result?.result?.transactionError,
      result?.result?.err,
    ),
    programLogReadError: errorChainLogReadError(error),
    result: resultSummary(result),
    programLogs,
  };
}

export async function hydrateChainTransactionFailure(error, {
  rpcUrl = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = 3000,
} = {}) {
  const signature = cleanText(errorChainValue(error, "signature"));
  if (!error || !signature) return { updated: false, reason: "signature-unavailable" };
  if (collectProgramLogs(error, null).length) return { updated: false, reason: "logs-present" };
  if (!cleanText(rpcUrl) || typeof fetchImpl !== "function") {
    return { updated: false, reason: "rpc-unavailable" };
  }

  const abortController = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = globalThis.setTimeout?.(() => abortController?.abort(), Math.max(250, Number(timeoutMs) || 3000));
  try {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `nicechunk-mining-failure-${Date.now()}`,
        method: "getTransaction",
        params: [signature, {
          commitment: "confirmed",
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        }],
      }),
      signal: abortController?.signal,
    });
    if (!response?.ok) throw new Error(`RPC HTTP ${response?.status ?? "unknown"}`);
    const payload = await response.json();
    if (payload?.error) {
      throw new Error(`RPC ${payload.error.code ?? "error"}: ${payload.error.message || "getTransaction failed"}`);
    }
    const meta = payload?.result?.meta;
    if (!meta) throw new Error("RPC transaction details are not available yet");
    const logs = Array.isArray(meta.logMessages) ? meta.logMessages : [];
    if (logs.length) error.nicechunkLogs = mergeLogs(error.nicechunkLogs, logs);
    if (error.transactionError == null && meta.err != null) error.transactionError = meta.err;
    return { updated: Boolean(logs.length || meta.err != null), signature, logCount: logs.length };
  } catch (logError) {
    error.nicechunkLogError = logError;
    return { updated: false, reason: readableError(logError), signature };
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout?.(timeout);
  }
}

function errorChainLogReadError(error) {
  const seen = new Set();
  let current = error;
  while (current && (typeof current === "object" || typeof current === "function") && !seen.has(current) && seen.size < 8) {
    seen.add(current);
    if (current.nicechunkLogError) return readableError(current.nicechunkLogError);
    current = current.cause;
  }
  return "";
}

function errorChainValue(error, key) {
  const seen = new Set();
  let current = error;
  while (current && (typeof current === "object" || typeof current === "function") && !seen.has(current) && seen.size < 8) {
    seen.add(current);
    if (current[key] !== undefined && current[key] !== null) return current[key];
    current = current.cause;
  }
  return null;
}

function miningBlockSummary(pending) {
  if (!pending) return null;
  return {
    x: finiteInteger(pending.worldX),
    y: finiteInteger(pending.worldY),
    z: finiteInteger(pending.worldZ),
    chunkX: finiteInteger(pending.chunkX),
    chunkZ: finiteInteger(pending.chunkZ),
    blockId: finiteInteger(pending.blockId),
    resourceId: finiteInteger(pending.resourceId),
  };
}

function submissionSummary(pending) {
  if (!pending) return null;
  return {
    miningKind: cleanText(pending.miningKind),
    toolSlotIndex: finiteInteger(pending.toolSlotIndex),
    minedBlockCount: finiteInteger(pending.minedBlockCount),
    blockCount: Array.isArray(pending.blocks) ? pending.blocks.length : 1,
    rewardBlockCount: Array.isArray(pending.rewardBlocks) ? pending.rewardBlocks.length : 0,
    rewardGroupCount: Array.isArray(pending.rewardGroups) ? pending.rewardGroups.length : 0,
  };
}

function adapterSummary(adapter) {
  if (!adapter || typeof adapter !== "object") return null;
  return {
    enabled: Boolean(adapter.enabled),
    ready: Boolean(adapter.ready),
    moduleUrl: cleanText(adapter.moduleUrl),
    lastError: cleanText(adapter.lastError),
    lastSignature: cleanText(adapter.lastSignature),
    lastSubmittedAt: finiteInteger(adapter.lastSubmittedAt),
  };
}

function errorChainSummary(error) {
  const chain = [];
  const seen = new Set();
  let current = error;
  while (current && (typeof current === "object" || typeof current === "function") && !seen.has(current) && chain.length < 8) {
    seen.add(current);
    chain.push({
      name: cleanText(current.name),
      message: readableError(current),
      code: cleanText(current.code),
      signature: cleanText(current.signature),
      transactionMessage: cleanText(current.transactionMessage),
      transactionError: current.transactionError ?? null,
      stack: cleanText(current.stack),
    });
    current = current.cause;
  }
  return chain;
}

function collectProgramLogs(error, result) {
  const logs = [];
  const seenLogs = new Set();
  const seenErrors = new Set();
  let current = error;
  while (current && (typeof current === "object" || typeof current === "function") && !seenErrors.has(current) && seenErrors.size < 8) {
    seenErrors.add(current);
    appendLogs(logs, seenLogs, current.nicechunkLogs);
    appendLogs(logs, seenLogs, current.logs);
    appendLogs(logs, seenLogs, current.transactionLogs);
    appendLogs(logs, seenLogs, current.data?.logs);
    appendLogs(logs, seenLogs, current.simulationResponse?.value?.logs);
    current = current.cause;
  }
  appendLogs(logs, seenLogs, result?.logs);
  appendLogs(logs, seenLogs, result?.result?.logs);
  appendLogs(logs, seenLogs, result?.result?.programLogs);
  return logs;
}

function appendLogs(target, seen, values) {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    const line = cleanText(value);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    target.push(line);
  }
}

function mergeLogs(existing, incoming) {
  const merged = [];
  const seen = new Set();
  appendLogs(merged, seen, existing);
  appendLogs(merged, seen, incoming);
  return merged;
}

function resultSummary(result) {
  if (!result || typeof result !== "object") return result ?? null;
  const inner = result.result && typeof result.result === "object" ? result.result : null;
  return {
    submitted: Boolean(result.submitted),
    reason: cleanText(result.reason || inner?.reason),
    signature: cleanText(result.signature || inner?.signature),
    blockId: finiteInteger(result.blockId ?? inner?.blockId),
    requiredSlots: finiteInteger(result.requiredSlots ?? inner?.requiredSlots),
    programId: cleanText(result.programId || inner?.programId),
    partialCollapse: Boolean(result.partialCollapse ?? inner?.partialCollapse),
    confirmedBlockCount: Array.isArray(result.confirmedBlocks ?? inner?.confirmedBlocks)
      ? (result.confirmedBlocks ?? inner.confirmedBlocks).length
      : null,
    failedCollapseBlockCount: Array.isArray(result.failedCollapseBlocks ?? inner?.failedCollapseBlocks)
      ? (result.failedCollapseBlocks ?? inner.failedCollapseBlocks).length
      : null,
    signatureCount: Array.isArray(result.signatures ?? inner?.signatures)
      ? (result.signatures ?? inner.signatures).length
      : null,
  };
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function readableError(error) {
  return cleanText(error?.transactionMessage || error?.message || error) || "unknown error";
}

function cleanText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}
