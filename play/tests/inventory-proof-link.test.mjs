import assert from "node:assert/strict";
import test from "node:test";

import { solanaExplorerAddressUrl } from "../inventory-controller.js";

const ITEM_PDA = "6MXrWyBqhaimPPmwGRE94DPqMvzPLMCaaiEUDn7duPWd";

test("backpack proof links open the Solana devnet explorer by default", () => {
  assert.equal(
    solanaExplorerAddressUrl(ITEM_PDA),
    `https://explorer.solana.com/address/${ITEM_PDA}?cluster=devnet`,
  );
  assert.equal(
    solanaExplorerAddressUrl(ITEM_PDA, "https://devnet.helius-rpc.com/?api-key=secret"),
    `https://explorer.solana.com/address/${ITEM_PDA}?cluster=devnet`,
  );
});

test("backpack proof links follow explicit Solana clusters", () => {
  assert.equal(
    solanaExplorerAddressUrl(ITEM_PDA, "https://api.mainnet-beta.solana.com"),
    `https://explorer.solana.com/address/${ITEM_PDA}`,
  );
  assert.equal(
    solanaExplorerAddressUrl(ITEM_PDA, "https://api.testnet.solana.com"),
    `https://explorer.solana.com/address/${ITEM_PDA}?cluster=testnet`,
  );
});

test("non-address proofs stay plain text", () => {
  assert.equal(solanaExplorerAddressUrl("-"), "");
  assert.equal(solanaExplorerAddressUrl("not-a-solana-address"), "");
  assert.equal(solanaExplorerAddressUrl("0".repeat(44)), "");
});
