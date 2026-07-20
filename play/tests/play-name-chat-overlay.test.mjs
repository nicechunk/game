import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("remote name nodes are removed without interrupting the frame update", async () => {
  const originalDocument = globalThis.document;
  const document = fakeDocument();
  globalThis.document = document;

  try {
    const { createNameChatOverlay } = await loadOverlayModule();
    let remoteVisible = true;
    const canvas = new FakeElement("canvas");
    canvas.getBoundingClientRect = () => ({ width: 320, height: 180 });
    const overlay = createNameChatOverlay({
      root: document.body,
      canvas,
      getCamera: () => ({}),
      appendRemoteTargets(targets) {
        if (!remoteVisible) return;
        targets.push({
          id: "remote-player",
          name: "Remote Player",
          x: 0,
          y: 0,
          z: 0,
          heightBlocks: 0,
        });
      },
    }).bind();

    overlay.update(1000);
    const container = document.body.children[0];
    assert.equal(container.children.length, 1);

    remoteVisible = false;
    assert.doesNotThrow(() => overlay.update(1016));
    assert.equal(container.children.length, 0);
    overlay.dispose();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

async function loadOverlayModule() {
  const source = await readFile(new URL("../play-name-chat-overlay.js", import.meta.url), "utf8");
  const cameraStub = [
    "const cameraOrigin = () => ({ worldX: 0, worldY: 0, worldZ: 0 });",
    "const cameraViewProjection = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];",
  ].join("\n");
  const transformed = source.replace(/^import[^;]+;\s*/, cameraStub);
  assert.notEqual(transformed, source, "camera import should be replaced by the deterministic test stub");
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
}

function fakeDocument() {
  return {
    body: new FakeElement("body"),
    createElement: (tagName) => new FakeElement(tagName),
  };
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.hidden = false;
    this.textContent = "";
    this.className = "";
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  setAttribute() {}
}
