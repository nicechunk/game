import assert from "node:assert/strict";
import test from "node:test";

import { createPlayInputActions } from "../play-input-actions.js";

test("the backpack hotbar number shortcut toggles the backpack panel", () => {
  const originalAddEventListener = globalThis.addEventListener;
  const originalDocument = globalThis.document;
  const listeners = new Map();
  globalThis.addEventListener = (type, listener) => listeners.set(type, listener);
  globalThis.document = { activeElement: null };
  try {
    let toggles = 0;
    let selections = 0;
    let selectableChecks = 0;
    const hotbarSlots = Array.from({ length: 9 }, () => null);
    hotbarSlots[4] = { itemId: "backpack" };
    createPlayInputActions({
      gameState: {
        hotbarSlots,
        isHotbarSlotSelectable() {
          selectableChecks += 1;
          return false;
        },
        selectHotbarSlot() {
          selections += 1;
        },
      },
      toggleBackpackPanel() {
        toggles += 1;
      },
    }).bind();

    const event = keyboardEvent();
    listeners.get("keydown")(event);

    assert.equal(toggles, 1);
    assert.equal(selections, 0);
    assert.equal(selectableChecks, 0);
    assert.equal(event.prevented, true);

    listeners.get("keydown")(keyboardEvent({ repeat: true }));
    listeners.get("keydown")(keyboardEvent({ ctrlKey: true }));
    assert.equal(toggles, 1);
  } finally {
    if (originalAddEventListener === undefined) delete globalThis.addEventListener;
    else globalThis.addEventListener = originalAddEventListener;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("the retired L shortcut no longer opens land construction", () => {
  const originalAddEventListener = globalThis.addEventListener;
  const originalDocument = globalThis.document;
  const listeners = new Map();
  globalThis.addEventListener = (type, listener) => listeners.set(type, listener);
  globalThis.document = { activeElement: null };
  try {
    let toggles = 0;
    createPlayInputActions({
      gameState: { hotbarSlots: [] },
      getConstruction: () => ({ toggle: () => { toggles += 1; } }),
    }).bind();
    const event = keyboardEvent({ code: "KeyL" });

    listeners.get("keydown")(event);

    assert.equal(toggles, 0);
    assert.equal(event.prevented, false);
  } finally {
    if (originalAddEventListener === undefined) delete globalThis.addEventListener;
    else globalThis.addEventListener = originalAddEventListener;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

function keyboardEvent(overrides = {}) {
  return {
    code: "Digit5",
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...overrides,
  };
}
