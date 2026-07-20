import assert from "node:assert/strict";
import test from "node:test";

import { createInventoryController } from "../inventory-controller.js";

test("Select All and discard skip the backpack slot currently equipped in the hotbar", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { addEventListener() {} };
  try {
    const cells = [new FakeCell(0), new FakeCell(1)];
    const backpackGrid = new FakeEventTarget();
    backpackGrid.querySelectorAll = () => cells;
    const selectAllBackpack = new FakeEventTarget();
    const discardSelectedBackpack = new FakeEventTarget();
    const cancelBackpackSelection = new FakeEventTarget();
    const equipped = { id: "tool-equipped", kind: "forged", count: 1 };
    const available = { id: "tool-available", kind: "forged", count: 1 };
    const discarded = [];
    const controller = createInventoryController({
      elements: {
        backpackGrid,
        backpackActions: { classList: new FakeClassList() },
        selectAllBackpack,
        discardSelectedBackpack,
        cancelBackpackSelection,
      },
      gameState: {
        backpackSlots: [equipped, available],
        isBackpackSlotEquipped: (slot) => slot === equipped,
        getBackpackSlotEquipment: (slot) => slot === equipped ? { index: 3 } : null,
      },
      onDiscardBackpackSlots: (indexes) => {
        discarded.push(...indexes);
        return { ok: true, discarded: indexes.map((index) => [equipped, available][index]) };
      },
      voxelItemLabel: (slot) => slot.id,
    });

    controller.bind();
    selectAllBackpack.dispatch("click");

    assert.equal(discardSelectedBackpack.disabled, false);
    assert.equal(discardSelectedBackpack.textContent, "Discard selected (1)");
    assert.equal(cells[0].classList.contains("selected-for-discard"), false);
    assert.equal(cells[0].attributes.get("aria-disabled"), "true");
    assert.equal(cells[1].classList.contains("selected-for-discard"), true);

    discardSelectedBackpack.dispatch("click");
    assert.deepEqual(discarded, [1]);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
    this.disabled = false;
    this.textContent = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ target: this, ...event });
    }
  }
}

class FakeCell {
  constructor(index) {
    this.dataset = { backpackSlot: String(index) };
    this.classList = new FakeClassList();
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(name) {
    this.values.add(name);
  }

  remove(name) {
    this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const active = force === undefined ? !this.values.has(name) : Boolean(force);
    if (active) this.values.add(name);
    else this.values.delete(name);
    return active;
  }
}
