import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChainSubmissionFailureReport,
  hydrateChainTransactionFailure,
  logChainSubmissionFailure,
} from "../play-chain-submission-log.js";

const PENDING = Object.freeze({
  txId: "local-pending-7",
  worldX: 288,
  worldY: 106,
  worldZ: -303,
  chunkX: 18,
  chunkZ: -19,
  blockId: 4,
  resourceId: 41,
  miningKind: "single",
  toolSlotIndex: 0,
  rewardBlocks: [{ blockId: 4 }],
  rewardGroups: [{ resourceId: 41 }],
});

test("submission failure report includes mining proof and nested Solana logs", () => {
  const cause = new Error("custom program error: 0x1771");
  cause.code = "SendTransactionError";
  cause.nicechunkLogs = [
    "Program NiceChunk invoke [1]",
    "Program log: AnchorError caused by account: backpack",
  ];
  const error = new Error("Transaction simulation failed", { cause });
  error.signature = "5ignature";
  error.transactionError = { InstructionError: [1, { Custom: 6001 }] };

  const report = buildChainSubmissionFailureReport({
    action: "mine",
    stage: "exception",
    pending: PENDING,
    reason: error.message,
    error,
    walletAddress: "Wallet111",
  });

  assert.equal(report.action, "mine");
  assert.equal(report.stage, "exception");
  assert.equal(report.txId, PENDING.txId);
  assert.equal(report.signature, "5ignature");
  assert.deepEqual(report.block, {
    x: 288,
    y: 106,
    z: -303,
    chunkX: 18,
    chunkZ: -19,
    blockId: 4,
    resourceId: 41,
  });
  assert.equal(report.errorChain.length, 2);
  assert.deepEqual(report.programLogs, cause.nicechunkLogs);
  assert.deepEqual(report.transactionError, error.transactionError);
});

test("logger prints a stable failure prefix, original error and program logs", () => {
  const calls = [];
  const logger = { error: (...args) => calls.push(args) };
  const error = new Error("preflight failed");
  error.logs = ["Program log: invalid generated block"];

  logChainSubmissionFailure({
    action: "mine",
    stage: "exception",
    pending: PENDING,
    reason: error.message,
    error,
    logger,
  });

  assert.equal(calls.length, 3);
  assert.match(calls[0][0], /^\[NiceChunk Chain Submission Failed\] mine\/exception:/);
  assert.equal(calls[1][1], error);
  assert.match(calls[2][0], /Solana program logs\nProgram log: invalid generated block/);
});

test("adapter rejection is logged even when no exception was thrown", () => {
  const report = buildChainSubmissionFailureReport({
    action: "mine",
    stage: "adapter-result",
    pending: PENDING,
    reason: "backpack-full",
    result: {
      submitted: false,
      reason: "backpack-full",
      result: { requiredSlots: 2 },
    },
  });

  assert.equal(report.reason, "backpack-full");
  assert.equal(report.result.submitted, false);
  assert.equal(report.result.requiredSlots, 2);
});

test("program log retrieval failures remain visible in the report", () => {
  const error = new Error("transaction failed");
  error.nicechunkLogError = new Error("RPC getTransaction timed out");

  const report = buildChainSubmissionFailureReport({
    action: "mine",
    stage: "exception",
    pending: PENDING,
    error,
  });

  assert.equal(report.programLogReadError, "RPC getTransaction timed out");
});

test("confirmation failures hydrate program logs from RPC without blocking rollback", async () => {
  const error = new Error("confirmed transaction failed");
  error.signature = "5ignature";
  let request = null;

  const result = await hydrateChainTransactionFailure(error, {
    rpcUrl: "https://rpc.example.test/",
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            result: {
              meta: {
                err: { InstructionError: [1, { Custom: 6001 }] },
                logMessages: ["Program log: canonical block mismatch"],
              },
            },
          };
        },
      };
    },
  });

  assert.equal(request.method, "getTransaction");
  assert.equal(request.params[0], "5ignature");
  assert.equal(result.updated, true);
  assert.deepEqual(error.nicechunkLogs, ["Program log: canonical block mismatch"]);
  assert.deepEqual(error.transactionError, { InstructionError: [1, { Custom: 6001 }] });
});
