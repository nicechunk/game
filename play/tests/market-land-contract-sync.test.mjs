import assert from "node:assert/strict";
import test from "node:test";

import { createPlayMarket } from "../play-market.js";

test("a stale MarketUser read cannot overwrite a newer land-contract balance", async () => {
  let resolveFirstRead = null;
  let readCount = 0;
  const snapshots = [];
  const membership = (blankLandContracts) => ({
    owner: "BuyerWalletAddress",
    marketUser: "BuyerMarketUserAddress",
    activeListingCount: 0,
    maxActiveListings: 50,
    blankLandContracts,
    reservedBlankLandContracts: 0,
  });
  const chainModule = {
    fetchMarketUserStateOnChain() {
      readCount += 1;
      if (readCount === 1) {
        return new Promise((resolve) => {
          resolveFirstRead = resolve;
        });
      }
      return Promise.resolve(membership(7));
    },
  };
  let market = null;
  market = createPlayMarket({
    elements: {},
    gameState: { backpackCapacity: 50, backpackSlots: [] },
    getChainSnapshot: () => ({ walletAddress: "BuyerWalletAddress" }),
    loadChainModule: async () => chainModule,
    onChanged: () => snapshots.push(market.getLandContractSnapshot()),
  });

  const staleRead = market.refreshLandContracts({ quiet: true });
  while (!resolveFirstRead) await new Promise((resolve) => setImmediate(resolve));
  const freshResult = await market.refreshLandContracts({ quiet: true });
  resolveFirstRead(membership(1));
  const staleResult = await staleRead;

  assert.equal(freshResult.ok, true);
  assert.equal(staleResult.reason, "stale");
  assert.equal(market.getLandContractSnapshot().blankLandContracts, 7);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.blankLandContracts), [7]);
});
