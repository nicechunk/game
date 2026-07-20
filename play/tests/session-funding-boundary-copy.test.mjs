import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, sessionSource] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../play-chain-session.js", import.meta.url), "utf8"),
]);

test("session funding copy calls the amount a top-up target rather than a spending boundary", () => {
  assert.match(html, /client-side top-up target/);
  assert.match(html, /not escrow, a transaction spending cap, or an authorization limit/);
  assert.match(html, /Local Game Wallet mode uses the Game Wallet balance directly/);
  assert.doesNotMatch(html, /will bound real Solana transaction spending/);

  assert.match(sessionSource, /Session funding target set/);
  assert.match(sessionSource, /not a spending cap or authorization limit/);
  assert.doesNotMatch(sessionSource, /Real chain transactions will use this boundary/);
});

test("local Game Wallet event copy names the unencrypted origin storage boundary", () => {
  assert.match(sessionSource, /stored as unencrypted Base58 text for this browser origin/);
  assert.doesNotMatch(sessionSource, /Private key is stored only in this browser/);
});
