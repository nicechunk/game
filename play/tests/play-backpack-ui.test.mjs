import assert from "node:assert/strict";
import test from "node:test";

import { backpackCategoryForSlot, createPlayBackpackUi } from "../play-backpack-ui.js";
import { backpackPhysicalDetailRows } from "../inventory-controller.js";
import { formatMassGrams, formatVolumeCm3 } from "../play-ui-format.js";

test("all mined and refined records stay visible in the Resources category", () => {
  const cotton = {
    kind: "resource",
    resourceId: 23,
    blockId: 48,
    decorationId: 12,
    decorationRuleId: 74,
  };

  assert.equal(backpackCategoryForSlot(cotton, "Cotton"), "resources");
  assert.equal(backpackCategoryForSlot(cotton, "localized-cotton-name"), "resources");
  assert.equal(backpackCategoryForSlot({ kind: "resource", blockId: 3 }, "Stone"), "resources");
  assert.equal(backpackCategoryForSlot({ kind: "smelted_material", materialId: 101 }), "resources");
  assert.equal(backpackCategoryForSlot({ kind: "material", materialId: 102 }), "resources");
});

test("physical items, blank contracts, and registered land use separate categories", () => {
  assert.equal(backpackCategoryForSlot({ kind: "forged", itemId: "iron_pickaxe" }), "items");
  assert.equal(backpackCategoryForSlot({ kind: "food", itemId: "bread" }), "items");
  assert.equal(backpackCategoryForSlot({ kind: "contract", itemId: "blank_land_contract" }), "contracts");
  assert.equal(backpackCategoryForSlot({ kind: "registered_land_contract", itemId: "registered_land_contract" }), "land");
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

test("five inventory categories separate physical stacks, blank contracts, and registered land", () => {
  const originalDocument = globalThis.document;
  const originalCustomEvent = globalThis.CustomEvent;
  const document = new FakeDocument();
  globalThis.document = document;
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  try {
    const backpackGrid = document.createElement("div");
    const backpackMeta = document.createElement("span");
    const categoryButtons = ["backpack", "resources", "items", "contracts", "land"].map((category) => {
      const button = document.createElement("button");
      button.dataset.backpackCategory = category;
      const label = document.createElement("span");
      label.textContent = category;
      const count = document.createElement("b");
      button.append(label, count);
      return button;
    });
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
    const registered = {
      id: "registered-land-contract:91",
      itemId: "registered_land_contract",
      kind: "registered_land_contract",
      foundationId: "91",
      landContractCount: 2,
      minChunkX: -2,
      minChunkZ: 1,
      maxChunkX: -1,
      maxChunkZ: 1,
    };
    const secondRegistered = {
      ...registered,
      id: "registered-land-contract:92",
      foundationId: "92",
      landContractCount: 1,
      minChunkX: 4,
      maxChunkX: 4,
    };
    const portfolio = {
      loading: false,
      error: "",
      blankContract: contract,
      registeredContracts: [registered, secondRegistered],
      items: [contract, registered, secondRegistered],
    };
    const ui = createPlayBackpackUi({
      elements: {
        backpackGrid,
        backpackMeta,
        backpackPanel: { hidden: false },
        backpackCategoryButtons: categoryButtons,
      },
      gameState: {
        backpackSlots: [
          { id: "stone", kind: "resource", resourceId: 3, count: 1, volumeMm3: 1000, massGrams: 2 },
          { id: "pickaxe", kind: "forged", itemId: "iron_pickaxe", count: 1, volumeMm3: 1000, massGrams: 3 },
        ],
        backpackCapacity: 5,
        totalBackpackItems: () => 2,
        totalBackpackMassGrams: () => "5",
        isBackpackSlotEquipped: () => false,
        getBackpackSlotEquipment: () => null,
        getLandContractPortfolio: () => portfolio,
        getLandContractEquipment: () => null,
      },
      createVoxelItemIconCanvas: () => document.createElement("canvas"),
      voxelItemLabel: (item) => item.itemId === "blank_land_contract" ? "Blank Land Contract" : "Item",
    });

    ui.render({ force: true });

    assert.equal(backpackGrid.children.length, 6, "the blank contract must not replace a physical capacity cell");
    assert.equal(backpackGrid.children.filter((cell) => cell.classList.contains("empty")).length, 3);
    assert.equal(backpackGrid.children.filter((cell) => cell.dataset.inventoryVirtualItem === contract.id).length, 1);
    assert.equal(backpackGrid.children.some((cell) => cell.dataset.inventoryVirtualItem === registered.id), false);
    assert.deepEqual(categoryButtons.map((button) => button.querySelector("b").textContent), ["3", "1", "1", "1", "2"]);
    assert.equal(backpackMeta.children[0].textContent, "2 stacks");
    assert.equal(backpackMeta.children[1].textContent, "2 / 5 slots · 2 items");

    categoryButtons[3].emit("click");
    assert.equal(ui.activeCategory(), "contracts");
    assert.equal(backpackGrid.children.length, 1);
    assert.equal(backpackGrid.children[0].dataset.inventoryVirtualItem, contract.id);
    assert.equal(backpackGrid.children[0].querySelector(".backpack-slot-count").textContent, "7");

    categoryButtons[4].emit("click");
    assert.equal(ui.activeCategory(), "land");
    assert.equal(backpackGrid.children.length, 2, "each foundation must occupy exactly one land cell");
    assert.equal(backpackGrid.children[0].dataset.inventoryVirtualItem, registered.id);
    assert.equal(backpackGrid.children[0].querySelector(".backpack-slot-count"), null, "registered land must not show contract-unit quantity");
    assert.equal(backpackGrid.children[0].children[0].dataset.landContractIcon, "registered");
    assert.equal(backpackGrid.children[1].dataset.inventoryVirtualItem, secondRegistered.id);

    categoryButtons[1].emit("click");
    assert.equal(backpackGrid.children.length, 5);
    assert.equal(backpackGrid.children.filter((cell) => cell.classList.contains("empty")).length, 4);
    assert.equal(backpackGrid.children[0].dataset.backpackItemCategory, "resources");
    assert.equal(backpackMeta.children[1].textContent, "2 / 5 slots · 2 items", "filtering must not alter physical capacity usage");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = originalCustomEvent;
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
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener({ target: this, ...event });
  }

  dispatchEvent(event) {
    this.emit(event.type, event);
    return true;
  }

  querySelector(selector) {
    if (selector === "b") return this.children.find((child) => child.tagName === "B") ?? null;
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return this.children.find((child) => child.classList?.contains(className)) ?? null;
    }
    return null;
  }

  closest(selector) {
    if (selector === "[data-contract-action]" && this.dataset.contractAction) return this;
    return null;
  }

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
