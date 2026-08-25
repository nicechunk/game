import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mainSource = await readFile(path.join(root, "play/main.js"), "utf8");
const builderSource = await readFile(path.join(root, "scripts/build-play-debug-runtime.mjs"), "utf8");

test("the game uses a Vite-bundled Chunk worker URL", () => {
  assert.match(mainSource, /chunk-build-worker\.js\?worker&url/u);
  assert.match(mainSource, /workerUrl:\s*chunkBuildWorkerUrl/u);
});

test("the runtime build rejects workers with missing module imports", () => {
  assert.match(builderSource, /missingModuleImports\(resolve\(runtimeRoot, "assets", file\), runtimeRoot\)/u);
  assert.match(builderSource, /requires one self-contained Chunk worker/u);
  assert.match(builderSource, /does not reference the validated Chunk worker/u);
});
