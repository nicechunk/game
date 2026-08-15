import assert from "node:assert/strict";
import test from "node:test";

import { backpackCategoryForSlot, createPlayBackpackUi } from "../play-backpack-ui.js";
import { backpackPhysicalDetailRows } from "../inventory-controller.js";
import { formatMassGrams, formatVolumeCm3 } from "../play-ui-format.js";

test("PDA surface decorations stay visible in the Resources category", () => {
  const cotton = {
    kind: "resource",
    resourceId: 23,
    blockId: 48,
    decorationId: 12,
    decorationRuleId: 74,
  };

  assert.equal(backpackCategoryForSlot(cotton, "Cotton"), "resources");
  assert.equal(backpackCategoryForSlot(cotton, "localized-cotton-name"), "resources");
});

test("ordinary solid resource records remain in the Blocks category", () => {
  assert.equal(backpackCategoryForSlot({ kind: "resource", blockId: 3 }, "Stone"), "blocks");
});

test("backpack physical values use grams, kilograms, and cubic centimeters", () => {
  assert.equal(formatMassGrams(999), "999 g");
  assert.equal(formatMassGrams("2600"), "2.6 kg");
  assert.equal(formatMassGrams(34_125), "34.125 kg");
  assert.equal(formatMassGrams(2_600 / 3), "866.667 g");
  assert.equal(formatVolumeCm3(227_500), "227.5 cm³");
  assert.equal(formatVolumeCm3(1_000_000), "1000 cm³");
});

test("stack details separate quantity, unit values, and totals", () => {
  const rows = backpackPhysicalDetailRows({
    count: 4,
    volumeMm3: 800_000,
    massGrams: 2_080,
  });

  assert.deepEqual(rows, [
    ["Quantity", "4"],
    ["Unit volume", "200 cm³"],
    ["Unit weight", "520 g"],
    ["Total volume", "800 cm³"],
    ["Total weight", "2.08 kg"],
  ]);
});

test("backpack header renders the authoritative on-chain total mass", () => {
  const originalDocument = globalThis.document;
  const document = new FakeDocument();
  globalThis.document = document;
  try {
    const backpackGrid = document.createElement("div");
    const backpackMeta = document.createElement("span");
    const ui = createPlayBackpackUi({
      elements: {
        backpackGrid,
        backpackMeta,
        backpackPanel: { hidden: false },
        backpackCategoryButtons: [],
      },
      gameState: {
        backpackSlots: [],
        backpackCapacity: 50,
        totalBackpackItems: () => 0,
        totalBackpackMassGrams: () => "2600",
      },
      createVoxelItemIconCanvas: () => document.createElement("canvas"),
      voxelItemLabel: () => "Item",
      translate: (_key, fallback, params = {}) => String(fallback).replace("{weight}", String(params.weight)),
    });

    ui.render({ force: true });

    assert.equal(backpackMeta.children[2].className, "backpack-meta-weight");
    assert.equal(backpackMeta.children[2].textContent, "Weight: 2.6 kg");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("matching resources occupy one of the fixed visual backpack slots", () => {
  const originalDocument = globalThis.document;
  const document = new FakeDocument();
  globalThis.document = document;
  try {
    const backpackGrid = document.createElement("div");
    const backpackMeta = document.createElement("span");
    const slots = Array.from({ length: 3 }, (_, index) => ({
      id: `stone-${index}`,
      kind: "resource",
      source: "chain",
      chainBackpack: "backpack-a",
      chainIndex: index,
      resourceId: 3,
      blockId: 3,
      metadata: 0,
      count: 1,
      volumeMm3: 1_000,
      massGrams: 2.6,
    }));
    const ui = createPlayBackpackUi({
      elements: {
        backpackGrid,
        backpackMeta,
        backpackPanel: { hidden: false },
        backpackCategoryButtons: [],
      },
      gameState: {
        backpackSlots: slots,
        backpackCapacity: 5,
        totalBackpackItems: () => 3,
        totalBackpackMassGrams: () => 7.8,
        isBackpackSlotEquipped: () => false,
        getBackpackSlotEquipment: () => null,
      },
      createVoxelItemIconCanvas: () => document.createElement("canvas"),
      voxelItemLabel: () => "Stone",
    });

    ui.render({ force: true });

    const stackCell = backpackGrid.children[0];
    assert.equal(backpackGrid.children.length, 5);
    assert.equal(stackCell.dataset.backpackIndexes, "0,1,2");
    assert.equal(stackCell.children[3].textContent, "3");
    assert.match(stackCell.attributes.get("aria-label"), /display slot 1, count 3/);
    assert.equal(backpackMeta.children[0].textContent, "1 stack");
    assert.equal(backpackMeta.children[1].textContent, "1 / 5 slots · 3 items");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("32 PDA records grouped into 12 stacks render 50 visual slots", () => {
  const originalDocument = globalThis.document;
  const document = new FakeDocument();
  globalThis.document = document;
  try {
    const backpackGrid = document.createElement("div");
    const backpackMeta = document.createElement("span");
    const slots = Array.from({ length: 32 }, (_, index) => {
      const group = index % 12;
      return {
        id: `resource-${index}`,
        kind: "resource",
        source: "chain",
        chainBackpack: "backpack-a",
        chainIndex: index,
        resourceId: group + 1,
        blockId: group + 1,
        metadata: 0,
        count: index < 7 ? 2 : 1,
        volumeMm3: 1_000,
        massGrams: 2,
      };
    });
    const ui = createPlayBackpackUi({
      elements: {
        backpackGrid,
        backpackMeta,
        backpackPanel: { hidden: false },
        backpackCategoryButtons: [],
      },
      gameState: {
        backpackSlots: slots,
        backpackCapacity: 50,
        totalBackpackItems: () => 39,
        totalBackpackMassGrams: () => 64,
        isBackpackSlotEquipped: () => false,
        getBackpackSlotEquipment: () => null,
      },
      createVoxelItemIconCanvas: () => document.createElement("canvas"),
      voxelItemLabel: () => "Resource",
    });

    ui.render({ force: true });

    assert.equal(backpackGrid.children.length, 50);
    assert.equal(backpackGrid.children.filter((cell) => cell.classList.contains("empty")).length, 38);
    assert.equal(backpackMeta.children[0].textContent, "12 stacks");
    assert.equal(backpackMeta.children[1].textContent, "12 / 50 slots · 39 items");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("equipped backpack cells render a locked equipment marker", () => {
  const originalDocument = globalThis.document;
  const document = new FakeDocument();
  globalThis.document = document;
  try {
    const backpackGrid = document.createElement("div");
    const slot = { id: "chain-tool-42", kind: "forged", count: 1, source: "chain" };
    const gameState = {
      backpackSlots: [slot],
      backpackCapacity: 1,
      totalBackpackItems: () => 1,
      getBackpackSlotEquipment: (candidate) => candidate === slot ? { index: 2, slot: { itemId: "forged_item" } } : null,
    };
    const ui = createPlayBackpackUi({
      elements: {
        backpackGrid,
        backpackPanel: { hidden: false },
        backpackCategoryButtons: [],
      },
      gameState,
      createVoxelItemIconCanvas: () => document.createElement("canvas"),
      voxelItemLabel: () => "Forged Tool",
      translate: (key, fallback, params = {}) => key === "main.backpack.equipped"
        ? "Equipped"
        : String(fallback).replace("{slot}", String(params.slot)),
    });

    ui.render({ force: true });

    const cell = backpackGrid.children[0];
    const badge = cell.children.find((child) => child.classList.contains("backpack-slot-equipped"));
    assert.equal(cell.classList.contains("equipped"), true);
    assert.equal(cell.dataset.equipped, "true");
    assert.equal(cell.attributes.get("aria-disabled"), "true");
    assert.equal(cell.title.includes("hotbar slot 3"), true);
    assert.equal(badge?.textContent, "Equipped");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("a MarketUser contract renders beside all physical backpack capacity", () => {
  const originalDocument = globalThis.document;
  const document = new FakeDocument();
  globalThis.document = document;
  try {
    const backpackGrid = document.createElement("div");
    const backpackMeta = document.createElement("span");
    const contract = {
      id: "market-user-blank-land-contract",
      itemId: "blank_land_contract",
      kind: "contract",
      count: 7,
      availableCount: 5,
      reservedCount: 2,
      source: "market-user",
      marketUser: "MarketUser111",
      virtual: true,
    };
    const ui = createPlayBackpackUi({
      elements: {
        backpackGrid,
        backpackMeta,
        backpackPanel: { hidden: false },
        backpackCategoryButtons: [],
      },
      gameState: {
        backpackSlots: [],
        backpackCapacity: 5,
        totalBackpackItems: () => 0,
        totalBackpackMassGrams: () => "0",
        getLandContractInventoryItem: () => contract,
        getLandContractEquipment: () => null,
      },
      createVoxelItemIconCanvas: () => document.createElement("canvas"),
      voxelItemLabel: (item) => item.itemId === "blank_land_contract" ? "Blank Land Contract" : "Item",
    });

    ui.render({ force: true });

    assert.equal(backpackGrid.children.length, 6, "the contract is rendered in addition to five physical slots");
    assert.equal(backpackGrid.children[0].tagName, "BUTTON", "the contract must use a native keyboard-accessible control");
    assert.equal(backpackGrid.children[0].type, "button");
    assert.equal(backpackGrid.children[0].dataset.inventoryVirtualItem, contract.id);
    assert.equal(backpackGrid.children[0].children[3].textContent, "7");
    assert.equal(backpackMeta.children[0].textContent, "1 stack");
    assert.equal(backpackMeta.children[1].textContent, "0 / 5 slots · 0 items");
    assert.equal(backpackMeta.children[2].textContent, "Weight: 0 g");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "").toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.className = "";
    this.classList = new FakeClassList(this);
    this.textContent = "";
    this.title = "";
  }

  addEventListener() {}

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  add(...names) {
    const values = new Set(this.element.className.split(/\s+/).filter(Boolean));
    names.forEach((name) => values.add(name));
    this.element.className = Array.from(values).join(" ");
  }

  contains(name) {
    return this.element.className.split(/\s+/).includes(name);
  }

  toggle(name, force) {
    const active = force === undefined ? !this.contains(name) : Boolean(force);
    if (active) this.add(name);
    else this.element.className = this.element.className.split(/\s+/).filter((entry) => entry && entry !== name).join(" ");
    return active;
  }
}
