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

test("solid policy hides names and chat through walls but keeps doorway visibility", async () => {
  const { createOverlayOcclusion } = await loadOverlayModule();
  let doorway = false;
  const policy = createOverlayOcclusion({ isBlockedAt: (x,y,z) => z === 2 && !(doorway && x === 0 && y === 1), intervalMs: 100 });
  const eye = { x: 0.5, y: 1.5, z: 0.5 };
  const targets = [{ id: "remote", x: 0.5, y: 1.5, z: 4.5 }];
  policy.evaluate(targets, eye, 1000);
  assert.equal(targets[0].occluded, true);
  doorway = true;
  policy.evaluate(targets, eye, 1050);
  assert.equal(targets[0].occluded, true, "uses bounded cached query between intervals");
  policy.evaluate(targets, eye, 1100);
  assert.equal(targets[0].occluded, false);
});

test("explicit none policy permits labels without terrain queries", async () => {
  const { createOverlayOcclusion } = await loadOverlayModule();
  const policy = createOverlayOcclusion({ mode: "none", isBlockedAt: () => { throw new Error("must not query"); } });
  const targets = [{ id: "remote", x: 0.5, y: 1.5, z: 4.5 }];
  policy.evaluate(targets, { x: 0.5, y: 1.5, z: 0.5 }, 1000);
  assert.equal(targets[0].occluded, false);
});

test("crowd occlusion work is capped and all targets eventually progress", async () => {
  const { createOverlayOcclusion } = await loadOverlayModule();
  const policy = createOverlayOcclusion({ isBlockedAt: () => false, maxChecksPerUpdate: 3, intervalMs: 150 });
  const targets = Array.from({length: 30}, (_,i) => ({id: String(i), x:0.5,y:1.5,z:i+2.5}));
  for (let frame = 0; frame < 10; frame++) {
    policy.evaluate(targets, {x:0.5,y:1.5,z:0.5},1000+frame*16);
    assert.ok(policy.stats().checks <= 3);
  }
  assert.ok(targets.every((target) => !target.occluded));
  assert.equal(policy.stats().totalChecks,30);
  policy.evaluate([], {x:0,y:0,z:0},1200);
  assert.equal(policy.stats().cached,0);
});

test("wall policy hides actual DOM nodes and restores them when the wall opens", async () => {
  const previous = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    const { createNameChatOverlay } = await loadOverlayModule();
    let wall = true, reads = 0;
    const canvas = { getBoundingClientRect() { reads += 1; return {width:320,height:180}; } };
    const overlay = createNameChatOverlay({ canvas, getCamera: () => ({localOffsetZ:-1.5}),
      isBlockedAt: (_x,_y,z) => wall && z === -1, occlusion:{ intervalMs:50 },
      appendRemoteTargets: (targets) => targets.push({id:"remote",name:"Remote",chatMessage:"Hello",chatUntil:2000,x:0,y:0,z:0.5,heightBlocks:0}),
    }).bind();
    const container = document.body.children[0];
    overlay.update(1000);
    assert.equal(container.children.length,0);
    wall = false;
    overlay.update(1050);
    assert.equal(container.children.length,1);
    assert.equal(container.children[0].children[0].hidden,false);
    assert.equal(container.children[0].children[1].hidden,false);
    assert.equal(reads,2,"one layout read per update");
    overlay.dispose();
  } finally { if(previous===undefined) delete globalThis.document; else globalThis.document=previous; }
});
