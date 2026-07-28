import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";

import { decodeMarketListing } from "../../src/chain/nicechunkChain.js";
import { marketCategoryForBackpackSlot } from "../../src/market/marketCategories.js";
import {
  marketItemDetailRows,
  marketItemSnapshotFromChainListing,
  marketListingDetailRows,
  normalizeMarketChainListing,
  solanaExplorerAddressUrl,
} from "../play-market.js";

test("chain material listings preserve their material model and market category", () => {
  const copper = chainItemListing({ itemCode: 1015, itemId: "41" });
  const normalized = normalizeMarketChainListing(copper);

  assert.equal(normalized.category, "raw");
  assert.equal(normalized.name, "Copper Bloom");
  assert.equal(normalized.itemSnapshot.kind, "smelted_material");
  assert.equal(normalized.itemSnapshot.materialId, "copper_bloom");
  assert.equal(normalized.itemSnapshot.itemCode, 1015);
  assert.equal(normalized.itemSnapshot.volumeMm3, 18_600);
  assert.notEqual(normalized.itemSnapshot.kind, "tool");
});

test("market detail rows expose authoritative item and listing fields", () => {
  const normalized = normalizeMarketChainListing(chainItemListing({ itemCode: 1015, itemId: "41" }));
  const itemRows = Object.fromEntries(marketItemDetailRows(normalized.itemSnapshot, {
    category: normalized.category,
  }).map((row) => [row.key, row]));
  const listingRows = Object.fromEntries(marketListingDetailRows(normalized).map((row) => [row.key, row]));

  assert.equal(itemRows.category.value, "Raw Materials");
  assert.equal(itemRows.mass.value, "152 g");
  assert.equal(itemRows.volume.value, "18.6 cm³");
  assert.equal(itemRows.material.value, "Copper Bloom");
  assert.equal(itemRows.quality.value, "80%");
  assert.equal(itemRows["item-code"].value, "1015");
  assert.equal(itemRows["item-id"].value, "41");
  assert.equal(itemRows["item-pda"].value, "ItemPdaAddress");
  assert.equal(listingRows["listing-id"].value, "7");
  assert.equal(listingRows["listing-pda"].value, "MarketListingAddress");
  assert.equal(listingRows.seller.value, "SellerAddress");
  assert.equal(listingRows.source.value, "Backpack");
});

test("chain block listings recover their canonical resource and display name", () => {
  const normalized = normalizeMarketChainListing(chainBlockListing({ blockId: 14 }), {
    voxelItemLabel: (item) => item.blockId === 14 ? "Basalt" : "Unknown Block",
  });

  assert.equal(normalized.itemSnapshot.kind, "resource");
  assert.equal(normalized.itemSnapshot.blockId, 14);
  assert.equal(normalized.itemSnapshot.resourceId, 7);
  assert.equal(normalized.name, "Basalt");
  assert.doesNotMatch(normalized.name, /#14|Resource 7/);

  const rows = Object.fromEntries(marketItemDetailRows(normalized.itemSnapshot, {
    category: normalized.category,
  }).map((row) => [row.key, row.value]));
  assert.equal(rows.mass, "840 g");
  assert.equal(rows.volume, "300 cm³");
  assert.equal(rows.resource, "Basalt / R7");
  assert.equal(rows["block-id"], "14");
  assert.equal(rows.coordinates, "12, 64, -7");
});

test("market PDA detail links follow the configured Solana cluster", () => {
  const address = Keypair.generate().publicKey.toBase58();
  assert.equal(
    solanaExplorerAddressUrl(address, "https://api.devnet.solana.com"),
    `https://explorer.solana.com/address/${address}?cluster=devnet`,
  );
  assert.equal(
    solanaExplorerAddressUrl(address, "https://api.testnet.solana.com"),
    `https://explorer.solana.com/address/${address}?cluster=testnet`,
  );
});

test("market categories distinguish construction, clothing, and equipment slots", () => {
  assert.equal(marketCategoryForBackpackSlot({ kind: "item", category: 1, itemCode: 1040 }), "building");
  assert.equal(marketCategoryForBackpackSlot({ kind: "item", category: 1, itemCode: 1025 }), "clothing");
  assert.equal(marketCategoryForBackpackSlot({ kind: "item", category: 2, itemCode: 8 }), "equipment");
  assert.equal(marketCategoryForBackpackSlot({ kind: "block", category: 0, itemCode: 0 }), "raw");
});

test("forged market listings retain exact model bytes for their item icon", () => {
  const modelBytes = [0xf0, 1, 2, 3, 4, 5, 6];
  const item = marketItemSnapshotFromChainListing(chainItemListing({
    category: 2,
    itemCode: 8,
    itemId: "99",
    metadata: 0x12345678,
    modelBytes,
  }));

  assert.equal(item.kind, "forged");
  assert.equal(item.itemId, "forged_item");
  assert.equal(item.designHash, 0x12345678);
  assert.deepEqual(item.bytes, modelBytes);
});

test("MarketListing decoder applies the same material categories before filtering", () => {
  assert.equal(decodeMarketListing(marketListingAccount({ category: 1, itemCode: 1015 })).category, "raw");
  assert.equal(decodeMarketListing(marketListingAccount({ category: 1, itemCode: 1040 })).category, "building");
  assert.equal(decodeMarketListing(marketListingAccount({ category: 1, itemCode: 1025 })).category, "clothing");
  assert.equal(decodeMarketListing(marketListingAccount({ category: 2, itemCode: 8 })).category, "equipment");
});

function chainItemListing({
  category = 1,
  itemCode,
  itemId,
  metadata = 0,
  modelBytes = null,
} = {}) {
  return {
    listing: "MarketListingAddress",
    listingId: "7",
    seller: "SellerAddress",
    stateLabel: "active",
    currency: "NCK",
    price: "12.5",
    quantity: 1,
    source: "backpack",
    sourceSlot: {
      kind: "item",
      kindCode: 2,
      category,
      itemCode,
      itemId,
      itemPda: "ItemPdaAddress",
      quantity: 1,
      volumeMm3: 18_600,
      massGrams: 152,
      qualityBps: 8_000,
      metadata,
      modelBytes,
    },
  };
}

function chainBlockListing({ blockId } = {}) {
  return {
    listing: "BlockMarketListingAddress",
    listingId: "8",
    seller: "SellerAddress",
    stateLabel: "active",
    currency: "NCK",
    price: "2.5",
    quantity: 3,
    source: "backpack",
    sourceRecord: {
      worldX: 12,
      worldY: 64,
      worldZ: -7,
      blockId,
    },
    sourceSlot: {
      kind: "block",
      kindCode: 1,
      category: 0,
      itemCode: 0,
      itemId: "0",
      itemPda: "11111111111111111111111111111111",
      quantity: 3,
      resource: {
        worldX: 12,
        worldY: 64,
        worldZ: -7,
        blockId,
      },
      volumeMm3: 300_000,
      massGrams: 840,
      metadata: 0,
    },
  };
}

function marketListingAccount({ category, itemCode }) {
  const seller = Keypair.generate().publicKey;
  const itemPda = Keypair.generate().publicKey;
  const data = Buffer.alloc(216);
  data.write("NCKMKT01", 0, "utf8");
  data.writeUInt16LE(5, 8);
  data.writeUInt8(1, 11);
  seller.toBuffer().copy(data, 12);
  data.writeBigUInt64LE(91n, 44);
  data.writeUInt8(1, 52);
  data.writeUInt8(1, 53);
  data.writeBigUInt64LE(1_000_000n, 54);
  data.writeUInt8(2, 62);
  data.writeUInt8(category, 63);
  data.writeUInt16LE(1 << 15, 64);
  data.writeUInt32LE(1, 66);
  data.writeUInt32LE(152, 70);
  data.writeUInt16LE(itemCode, 80);
  data.writeBigUInt64LE(77n, 82);
  itemPda.toBuffer().copy(data, 90);
  data.writeUInt32LE(18_600, 122);
  data.writeUInt16LE(8_000, 136);
  data.writeUInt8(1, 214);
  return data;
}
