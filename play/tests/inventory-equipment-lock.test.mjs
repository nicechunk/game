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

test("destructive inventory actions wait for the shared confirmation dialog", async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { addEventListener() {} };
  try {
    const backpackGrid = new FakeEventTarget();
    backpackGrid.querySelectorAll = () => [new FakeCell(0)];
    const selectAllBackpack = new FakeEventTarget();
    const discardSelectedBackpack = new FakeEventTarget();
    const item = { id: "stone-stack", kind: "resource", count: 4, blockId: 3 };
    const discarded = [];
    const confirmations = [];
    const controller = createInventoryController({
      elements: {
        backpackGrid,
        backpackActions: { classList: new FakeClassList() },
        selectAllBackpack,
        discardSelectedBackpack,
        cancelBackpackSelection: new FakeEventTarget(),
      },
      gameState: {
        backpackSlots: [item],
        isBackpackSlotEquipped: () => false,
      },
      confirmAction: (options) => new Promise((resolve) => confirmations.push({ options, resolve })),
      onDiscardBackpackSlots: (indexes) => {
        discarded.push(...indexes);
        return { ok: true, discarded: [item] };
      },
      voxelItemLabel: () => "Stone",
    });

    controller.bind();
    selectAllBackpack.dispatch("click");
    discardSelectedBackpack.dispatch("click");

    assert.equal(confirmations.length, 1);
    assert.equal(confirmations[0].options.tone, "danger");
    assert.match(confirmations[0].options.message, /4 items/);
    assert.deepEqual(discarded, []);

    confirmations[0].resolve(false);
    await Promise.resolve();
    assert.deepEqual(discarded, []);

    discardSelectedBackpack.dispatch("click");
    confirmations[1].resolve(true);
    await Promise.resolve();
    assert.deepEqual(discarded, [0]);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("discarding one merged display stack submits every underlying PDA index", async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { addEventListener() {} };
  try {
    const backpackGrid = new FakeEventTarget();
    const mergedCell = new FakeCell(0, [0, 1, 2]);
    backpackGrid.querySelectorAll = () => [mergedCell];
    const selectAllBackpack = new FakeEventTarget();
    const discardSelectedBackpack = new FakeEventTarget();
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
    }));
    const discarded = [];
    const statuses = [];
    const controller = createInventoryController({
      elements: {
        backpackGrid,
        backpackActions: { classList: new FakeClassList() },
        selectAllBackpack,
        discardSelectedBackpack,
        cancelBackpackSelection: new FakeEventTarget(),
      },
      gameState: {
        backpackSlots: slots,
        isBackpackSlotEquipped: () => false,
      },
      onDiscardBackpackSlots: async (indexes) => {
        discarded.push(...indexes);
        return { ok: true, discarded: indexes.map((index) => slots[index]) };
      },
      onStatus: (status) => statuses.push(status),
      voxelItemLabel: () => "Stone",
    });

    controller.bind();
    selectAllBackpack.dispatch("click");

    assert.equal(mergedCell.classList.contains("selected-for-discard"), true);
    assert.equal(discardSelectedBackpack.textContent, "Discard selected (1)");

    discardSelectedBackpack.dispatch("click");
    assert.deepEqual(discarded, [0, 1, 2]);
    assert.equal(statuses.at(-1), "Discarding 1 backpack stack containing 3 items...");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(statuses.at(-1), "Discarded 1 backpack stack.");
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
  constructor(index, indexes = [index]) {
    this.dataset = {
      backpackSlot: String(index),
      backpackIndexes: indexes.join(","),
    };
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
