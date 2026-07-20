import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createMobileChatController } from "../play-mobile-chat.js";

test("mobile chat opens, submits slash commands, and restores focus", async () => {
  const fixture = createFixture();
  const submissions = [];
  const controller = createMobileChatController({
    elements: fixture.elements,
    submitText: async (text) => {
      submissions.push(text);
      return true;
    },
    documentRoot: fixture.document,
    windowTarget: fixture.window,
  }).bind();

  fixture.elements.mobileChatTrigger.dispatch("click");
  assert.equal(controller.isOpen(), true);
  assert.equal(fixture.elements.mobileChatOverlay.hidden, false);
  assert.equal(fixture.elements.mobileChatTrigger.attribute("aria-expanded"), "true");
  assert.equal(fixture.document.activeElement, fixture.elements.mobileChatInput);

  fixture.elements.mobileChatInput.value = "  /debug   ";
  fixture.elements.mobileChatInput.dispatch("input");
  assert.equal(fixture.elements.mobileChatSend.disabled, false);
  assert.equal(await controller.submit(event()), true);
  assert.deepEqual(submissions, ["/debug"]);
  assert.equal(controller.isOpen(), false);
  assert.equal(fixture.elements.mobileChatInput.value, "");
  assert.equal(fixture.document.activeElement, fixture.elements.mobileChatTrigger);
});

test("mobile chat keeps the composer open when Guardian chat is unavailable", async () => {
  const fixture = createFixture();
  let submissions = 0;
  const controller = createMobileChatController({
    elements: fixture.elements,
    submitText: () => {
      submissions += 1;
      return false;
    },
    translate: (key, fallback) => key === "main.chat.guardianRequired" ? "guardian-required" : fallback,
    documentRoot: fixture.document,
    windowTarget: fixture.window,
  }).bind();

  controller.open(event());
  assert.equal(await controller.submit(event()), false);
  assert.equal(submissions, 0, "empty messages must not call the transport");

  fixture.elements.mobileChatInput.value = "hello";
  fixture.elements.mobileChatInput.dispatch("input");
  assert.equal(await controller.submit(event()), false);
  assert.equal(submissions, 1);
  assert.equal(controller.isOpen(), true);
  assert.equal(fixture.elements.mobileChatStatus.hidden, false);
  assert.equal(fixture.elements.mobileChatStatus.textContent, "guardian-required");

  fixture.window.dispatch("keydown", event({ key: "Escape" }));
  assert.equal(controller.isOpen(), false);
});

test("mobile chat clamps an oversized visual viewport to the layout viewport", () => {
  const fixture = createFixture();
  fixture.window.innerHeight = 844;
  fixture.window.visualViewport.offsetTop = 11;
  fixture.window.visualViewport.height = 855;

  createMobileChatController({
    elements: fixture.elements,
    documentRoot: fixture.document,
    windowTarget: fixture.window,
  }).bind();

  assert.equal(fixture.elements.mobileChatOverlay.styleProperties.get("--mobile-chat-viewport-top"), "11px");
  assert.equal(fixture.elements.mobileChatOverlay.styleProperties.get("--mobile-chat-viewport-height"), "833px");
});

test("debug implementation is optional and no longer a static main-module dependency", async () => {
  const source = await readFile(new URL("../main.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /import\s+\{\s*createPlayDebugController\s*\}/);
  assert.match(source, /import\("\.\/play-debug-controller\.js"\)/);
  assert.match(source, /submitMobileChatText/);
});

function createFixture() {
  const document = {
    activeElement: null,
    body: new FakeElement("body"),
  };
  const window = new FakeEventTarget();
  window.innerHeight = 720;
  window.visualViewport = new FakeEventTarget();
  window.visualViewport.offsetTop = 12;
  window.visualViewport.height = 520;
  const element = (tagName = "div") => new FakeElement(tagName, document);
  const elements = {
    mobileChatTrigger: element("button"),
    mobileChatOverlay: element("div"),
    mobileChatBackdrop: element("button"),
    mobileChatPanel: element("section"),
    mobileChatClose: element("button"),
    mobileChatForm: element("form"),
    mobileChatInput: element("input"),
    mobileChatSend: element("button"),
    mobileChatStatus: element("p"),
  };
  elements.mobileChatOverlay.hidden = true;
  elements.mobileChatStatus.hidden = true;
  return { document, window, elements };
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatch(type, payload = event()) {
    for (const listener of this.listeners.get(type) ?? []) listener(payload);
  }
}

class FakeElement extends FakeEventTarget {
  constructor(tagName, ownerDocument = null) {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.attributes = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name),
    };
    this.styleProperties = new Map();
    this.style = {
      setProperty: (name, value) => this.styleProperties.set(name, value),
    };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  attribute(name) {
    return this.attributes.get(name) ?? null;
  }

  toggleAttribute(name, force) {
    if (force) this.attributes.set(name, "");
    else this.attributes.delete(name);
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  blur() {
    if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = null;
  }
}

function event(overrides = {}) {
  return {
    key: "",
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
    ...overrides,
  };
}
