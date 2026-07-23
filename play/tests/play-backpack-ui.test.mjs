import assert from "node:assert/strict";
import test from "node:test";

import { backpackCategoryForSlot, createPlayBackpackUi } from "../play-backpack-ui.js";

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
      backpackStatusKnown: true,
      totalBackpackItems: () => 1,
      isBackpackAvailable: () => true,
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

test("backpack metadata renders authoritative mass", () => {
  const originalDocument = globalThis.document;
  const document = new FakeDocument();
  globalThis.document = document;
  try {
    const backpackGrid = document.createElement("div");
    const backpackMeta = document.createElement("span");
    const gameState = {
      backpackSlots: [],
      backpackCapacity: 50,
      backpackTotalMassGrams: "12550",
      backpackStatusKnown: true,
      totalBackpackItems: () => 0,
      isBackpackAvailable: () => true,
    };
    const ui = createPlayBackpackUi({
      elements: {
        backpackGrid,
        backpackMeta,
        backpackPanel: { hidden: false },
        backpackCategoryButtons: [],
      },
      gameState,
      createVoxelItemIconCanvas: () => document.createElement("canvas"),
      voxelItemLabel: () => "Item",
      translate: (_key, fallback, params = {}) => String(fallback).replace("{weight}", String(params.weight)),
    });

    ui.render({ force: true });
    assert.equal(backpackMeta.children[2].textContent, "Weight 12.6 kg");

  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("backpack slots render a shared loading animation while the PDA is unresolved", () => {
  const originalDocument = globalThis.document;
  const document = new FakeDocument();
  globalThis.document = document;
  try {
    const backpackGrid = document.createElement("div");
    const backpackMeta = document.createElement("span");
    const gameState = {
      backpackSlots: [],
      backpackCapacity: 4,
      backpackStatusKnown: false,
      totalBackpackItems: () => 0,
      isBackpackAvailable: () => false,
    };
    let snapshot = { loading: false, statusKnown: false, available: false, lastError: "" };
    const ui = createPlayBackpackUi({
      elements: {
        backpackGrid,
        backpackMeta,
        backpackPanel: { hidden: false },
        backpackCategoryButtons: [],
      },
      gameState,
      getBackpackSnapshot: () => snapshot,
      createVoxelItemIconCanvas: () => document.createElement("canvas"),
      voxelItemLabel: () => "Item",
    });

    ui.render({ force: true });
    assert.equal(backpackGrid.classList.contains("is-loading"), true);
    assert.equal(backpackGrid.attributes.get("aria-busy"), "true");
    assert.equal(backpackGrid.children.length, 5);
    assert.equal(backpackGrid.children[0].classList.contains("loading"), true);
    assert.equal(backpackGrid.children[4].classList.contains("is-loading"), true);
    assert.equal(backpackMeta.children[0].textContent, "Loading backpack...");

    snapshot = { loading: false, statusKnown: false, available: false, lastError: "rpc-timeout" };
    ui.render({ force: true });
    assert.equal(backpackGrid.classList.contains("is-loading"), false);
    assert.equal(backpackGrid.classList.contains("is-read-error"), true);
    assert.equal(backpackGrid.attributes.get("aria-busy"), "false");
    assert.equal(backpackGrid.children[4].classList.contains("is-error"), true);
    assert.equal(backpackMeta.children[0].textContent, "Backpack unavailable");
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
