import assert from "node:assert/strict";
import { formatAccountBalanceValue } from "../play-account-balance.js";

assert.equal(formatAccountBalanceValue(), "0.000000");
assert.equal(formatAccountBalanceValue({ connected: true, status: "ready", lamports: 0 }), "0.000000");
assert.equal(formatAccountBalanceValue({ connected: true, status: "ready", lamports: 1_234_567_890 }), "1.234568");
assert.equal(formatAccountBalanceValue({ connected: true, status: "stale", lamports: 42_000 }), "0.000042");
assert.equal(formatAccountBalanceValue({ connected: true, status: "loading" }), "Loading...");
assert.equal(formatAccountBalanceValue({ connected: true, status: "error" }), "--");

console.log("account balance format tests passed");
