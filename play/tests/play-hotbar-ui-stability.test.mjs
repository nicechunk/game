import assert from "node:assert/strict";
import test from "node:test";

import { createPlayHotbarUi } from "../play-hotbar-ui.js";

test("hotbar selection and durability updates preserve rendered icon canvases", () => {
  const originalDocument = globalThis.document;
  const document = new FakeDocument();
  globalThis.document = document;
  try {
    const hotbar = document.createElement("div");
    let iconRenderCount = 0;
    const gameState = {
      selectedHotbarSlot: 0,
      backpackAvailable: false,
      backpackStatusKnown: true,
      hotbarItems: {
        forged_item: { itemId: "forged_item", kind: "forged", label: "Forged Tool" },
        iron_pickaxe: { itemId: "iron_pickaxe", kind: "tool", label: "Pickaxe" },
        backpack: { itemId: "backpack", kind: "backpack", label: "Backpack" },
      },
      hotbarSlots: [
        { itemId: "forged_item", designHash: 7, code: "NCF1.first", bytes: [1, 2, 3], durability: 10 },
        { itemId: "iron_pickaxe", durability: 99 },
        { itemId: "backpack", locked: true },
      ],
      syncHotbarResourceSlots() {},
      isBackpackAvailable() { return this.backpackAvailable; },
      totalBackpackItems() { return 0; },
      selectHotbarSlot(index) { this.selectedHotbarSlot = index; },
    };
    let ui = null;
    ui = createPlayHotbarUi({
      elements: { hotbar },
      gameState,
      createVoxelItemIconCanvas() {
        iconRenderCount += 1;
        const canvas = document.createElement("canvas");
        canvas.dataset.renderNumber = String(iconRenderCount);
        return canvas;
      },
      voxelItemLabel: (item) => item.label,
      onRenderHotbar: () => ui.render(),
    });

    ui.render();
    const forgedButton = hotbar.children[0];
    const forgedCanvas = forgedButton.querySelector("canvas");
    assert.equal(iconRenderCount, 2);

    hotbar.children[1].dispatch("click");
    assert.equal(gameState.selectedHotbarSlot, 1);
    assert.equal(hotbar.children[0], forgedButton);
    assert.equal(hotbar.children[0].querySelector("canvas"), forgedCanvas);
    assert.equal(iconRenderCount, 2);

    gameState.hotbarSlots[0].durability = 9;
    ui.render();
    assert.equal(hotbar.children[0], forgedButton);
    assert.equal(hotbar.children[0].querySelector("canvas"), forgedCanvas);
    assert.equal(hotbar.children[0].querySelector(".hotbar-amount").textContent, "9");
    assert.equal(iconRenderCount, 2);

    gameState.hotbarSlots[0].designHash = 8;
    gameState.hotbarSlots[0].code = "NCF1.second";
    ui.render();
    assert.notEqual(hotbar.children[0], forgedButton);
    assert.equal(iconRenderCount, 3);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("the backpack entry remains usable while its PDA state is unresolved", () => {
  const originalDocument = globalThis.document;
  const document = new FakeDocument();
  globalThis.document = document;
  try {
    const hotbar = document.createElement("div");
    let openCount = 0;
    let iconCount = 0;
    const gameState = {
      selectedHotbarSlot: 0,
      backpackAvailable: false,
      backpackStatusKnown: false,
      hotbarItems: {
        backpack: { itemId: "backpack", kind: "backpack", label: "Backpack" },
      },
      hotbarSlots: [{ itemId: "backpack", locked: true }],
      syncHotbarResourceSlots() {},
      isBackpackAvailable() { return this.backpackAvailable; },
      totalBackpackItems() { return 0; },
      selectHotbarSlot() {},
    };
    const ui = createPlayHotbarUi({
      elements: { hotbar },
      gameState,
      createVoxelItemIconCanvas() {
        iconCount += 1;
        return document.createElement("canvas");
      },
      voxelItemLabel: (item) => item.label,
      onOpenBackpack: () => { openCount += 1; },
    });

    ui.render();
    assert.equal(iconCount, 1);
    assert.equal(hotbar.children[0].attributes.get("aria-label"), "Backpack loading");
    hotbar.children[0].dispatch("click");
    assert.equal(openCount, 1);

    gameState.backpackStatusKnown = true;
    ui.render();
    assert.equal(hotbar.children[0].attributes.get("aria-label"), "Create backpack");
    hotbar.children[0].dispatch("click");
    assert.equal(openCount, 2);
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
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.title = "";
    this._className = "";
    this._textContent = "";
    this.classList = {
      toggle: (name, force) => {
        const classes = new Set(this._className.split(/\s+/).filter(Boolean));
        if (force) classes.add(name);
        else classes.delete(name);
        this._className = Array.from(classes).join(" ");
      },
    };
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value || "");
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
  }

  get lastElementChild() {
    return this.children.at(-1) ?? null;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentElement = this;
      this.children.push(node);
    }
  }

  replaceWith(replacement) {
    if (!this.parentElement) return;
    const parent = this.parentElement;
    const index = parent.children.indexOf(this);
    if (index < 0) return;
    replacement.remove();
    replacement.parentElement = parent;
    parent.children[index] = replacement;
    this.parentElement = null;
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  querySelector(selector) {
    const matches = selector.startsWith(".")
      ? (node) => node.className.split(/\s+/).includes(selector.slice(1))
      : (node) => node.tagName === selector.toUpperCase();
    for (const child of this.children) {
      if (matches(child)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type) {
    this.listeners.get(type)?.({ target: this });
  }
}
