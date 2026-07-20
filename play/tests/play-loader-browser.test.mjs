import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import test from "node:test";
import { chromium } from "playwright";

const loaderSource = await readFile(new URL("../play-loader.js", import.meta.url), "utf8");
const englishPlayDictionary = JSON.parse(await readFile(new URL("../../public/play/locales/en.json", import.meta.url), "utf8"));
const zhHansPlayDictionary = JSON.parse(await readFile(new URL("../../public/play/locales/zh-Hans.json", import.meta.url), "utf8"));
const counts = new Map();
const fixture = createFixture();
const server = http.createServer(handleRequest);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

test("Loader tracks real bytes, reuses boot resources, and waits for critical state", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(() => localStorage.setItem("nicechunk.language", "zh-Hans"));
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));

    await page.goto(`${origin}/normal`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#nc-loader");
    const manifestSnapshot = await page.evaluate(() => globalThis.NiceChunkLoading.snapshot());
    assert.ok(manifestSnapshot.files.some((file) => file.name === "manifest.json" && file.status === "loading"));
    assert.ok(manifestSnapshot.progress <= 8, `manifest-only progress overshot to ${manifestSnapshot.progress}%`);
    await page.waitForFunction(
      () => globalThis.__worldVisibleAt > 0 || Boolean(globalThis.NiceChunkLoading?.snapshot().error),
      null,
      { timeout: 5_000 },
    );

    const worldSnapshot = await page.evaluate(() => globalThis.NiceChunkLoading.snapshot());
    assert.equal(worldSnapshot.error, "", `Loader failed before the first world frame: ${worldSnapshot.error}`);
    assert.equal(worldSnapshot.visible, true, "the first world frame must not dismiss pending PDA work");
    assert.equal(worldSnapshot.worldVisible, true);
    assert.ok(worldSnapshot.pendingTasks.includes("chunks"));
    assert.equal(
      await page.locator(".nc-load-title").textContent(),
      zhHansPlayDictionary.main.loading.loader.generatingWorld,
    );

    await page.waitForFunction(() => !document.querySelector("#nc-loader"));
    const result = await page.evaluate(() => ({
      progress: globalThis.__progressSamples,
      entryRuns: globalThis.__entryRuns,
      localeMarker: globalThis.__localeMarker,
      worldAt: globalThis.__worldVisibleAt,
      taskDoneAt: globalThis.__chunkDoneAt,
      snapshot: globalThis.NiceChunkLoading.snapshot(),
    }));
    assert.equal(result.entryRuns, 1);
    assert.equal(result.localeMarker, "zh-Hans");
    assert.ok(result.taskDoneAt > result.worldAt);
    assert.equal(result.snapshot.progress, 100);
    assert.equal(result.snapshot.stage, "ready");
    assert.ok(result.progress.some((value) => value > 0 && value < 100));
    assertMonotonic(result.progress);
    assert.equal(requestCount("/entry.js"), 1, "fetch followed by import must reuse the HTTP cache");
    assert.equal(requestCount("/app.css"), 1, "the applied stylesheet must reuse the tracked response cache");
    assert.equal(requestCount("/locale-zh-Hans.json"), 1, "the game must reuse the Loader locale response");
    assert.deepEqual(pageErrors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("Loader exposes a localized failure state and retry reloads the failed entry", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto(`${origin}/failure`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#nc-loader.is-failed");
    assert.equal(await page.locator(".nc-load-error").textContent(), englishPlayDictionary.main.loading.loader.failureMessage);
    assert.equal(await page.locator(".nc-load-retry").textContent(), englishPlayDictionary.main.loading.loader.retry);
    assert.match((await page.evaluate(() => globalThis.NiceChunkLoading.snapshot().error)), /HTTP 503/);
    assert.ok(consoleErrors.some((message) => message.includes("NiceChunk Loader")));

    await page.locator(".nc-load-retry").click();
    await page.waitForFunction(() => !document.querySelector("#nc-loader"));
    assert.equal(requestCount("/failure"), 2);
    assert.equal(requestCount("/retry-entry.js"), 2);
  } finally {
    await browser.close();
  }
});

test("Loader stays inside common mobile and short-landscape viewports", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [
      { width: 360, height: 740 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 844, height: 390 },
    ]) {
      const context = await browser.newContext({ viewport, isMobile: viewport.width < viewport.height, hasTouch: true });
      const page = await context.newPage();
      await page.goto(`${origin}/hold`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => globalThis.NiceChunkLoading?.snapshot().worldVisible);
      const layout = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
        const visibleRows = [...document.querySelectorAll(".nc-load-row")]
          .filter((row) => getComputedStyle(row).display !== "none").length;
        return {
          viewport: { width: innerWidth, height: innerHeight },
          overlay: rect("#nc-loader"),
          head: rect(".nc-load-head"),
          voxels: rect(".nc-load-voxels"),
          card: rect(".nc-load-card"),
          footer: rect(".nc-load-foot"),
          visibleRows,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      assertInside(layout.overlay, layout.viewport);
      assertInside(layout.card, layout.viewport);
      assertInside(layout.footer, layout.viewport);
      assert.ok(layout.head.bottom <= layout.voxels.top + 1, `${viewport.width}x${viewport.height}: header overlaps mark`);
      assert.ok(layout.card.bottom <= layout.footer.top + 1, `${viewport.width}x${viewport.height}: card overlaps footer`);
      assert.ok(layout.scrollWidth <= viewport.width, `${viewport.width}x${viewport.height}: horizontal overflow`);
      assert.ok(layout.visibleRows <= (viewport.height <= 520 ? 2 : 3));
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

function handleRequest(request, response) {
  const path = new URL(request.url, "http://localhost").pathname;
  counts.set(path, requestCount(path) + 1);
  if (path === "/loader.js") return send(response, loaderSource, "text/javascript");
  if (path === "/normal") return send(response, html("/manifest.json"), "text/html");
  if (path === "/failure") return send(response, html("/manifest-failure.json"), "text/html");
  if (path === "/hold") return send(response, html("/manifest-hold.json"), "text/html");
  if (path === "/manifest.json") return sendSlow(response, JSON.stringify(fixture.normalManifest), "application/json", 8, 150);
  if (path === "/manifest-failure.json") return send(response, JSON.stringify(fixture.failureManifest), "application/json");
  if (path === "/manifest-hold.json") return send(response, JSON.stringify(fixture.holdManifest), "application/json");
  if (path === "/entry.js") return sendSlow(response, fixture.entry, "text/javascript", 7, 16);
  if (path === "/app.css") return sendSlow(response, fixture.css, "text/css", 5, 12);
  if (path === "/startup-worker.js") return sendSlow(response, fixture.worker, "text/javascript", 8, 10);
  if (path === "/locale-en.json") return sendSlow(response, fixture.localeEn, "application/json", 4, 8);
  if (path === "/locale-zh-Hans.json") return sendSlow(response, fixture.localeZhHans, "application/json", 4, 8);
  if (path === "/retry-entry.js") {
    if (requestCount(path) === 1) return send(response, "temporary failure", "text/plain", 503);
    return send(response, "NiceChunkLoading.worldReady();", "text/javascript");
  }
  if (path === "/hold-entry.js") return send(response, "NiceChunkLoading.taskStart('layout'); NiceChunkLoading.worldReady();", "text/javascript");
  response.writeHead(404).end("not found");
}

function createFixture() {
  const localeEn = JSON.stringify({ ...englishPlayDictionary, marker: "en" });
  const localeZhHans = JSON.stringify({ ...zhHansPlayDictionary, marker: "zh-Hans" });
  const css = `.fixture{color:#067580}${".voxel{display:block}".repeat(220)}`;
  const worker = `self.onmessage=()=>{};${"/* startup worker payload */".repeat(320)}`;
  const entry = `
    const preload = globalThis.__nicechunkLocalePreload;
    if (preload) {
      const localeResponse = await preload.promise;
      const locale = await localeResponse.json();
      globalThis.__localeMarker = locale.marker;
    }
    globalThis.__entryRuns = (globalThis.__entryRuns || 0) + 1;
    NiceChunkLoading.taskStart("chunks");
    NiceChunkLoading.stage("chainSync", 0.72);
    setTimeout(() => {
      globalThis.__worldVisibleAt = performance.now();
      NiceChunkLoading.worldReady();
    }, 25);
    setTimeout(() => {
      globalThis.__chunkDoneAt = performance.now();
      NiceChunkLoading.taskDone("chunks");
    }, 480);
    ${"/* application payload */".repeat(500)}
  `;
  const base = {
    schemaVersion: 1,
    version: "loader-test-v1",
    dictionary: loaderDictionary(englishPlayDictionary),
  };
  return {
    css,
    worker,
    entry,
    localeEn,
    localeZhHans,
    normalManifest: {
      ...base,
      entry: descriptor("/entry.js", entry, "module", "critical"),
      files: [
        descriptor("/app.css", css, "style", "critical"),
        descriptor("/entry.js", entry, "module", "critical"),
        descriptor("/startup-worker.js", worker, "worker", "startup"),
      ],
      locales: {
        en: descriptor("/locale-en.json", localeEn),
        "zh-Hans": descriptor("/locale-zh-Hans.json", localeZhHans),
      },
    },
    failureManifest: {
      ...base,
      entry: descriptor("/retry-entry.js", "NiceChunkLoading.worldReady();", "module", "critical"),
      files: [descriptor("/retry-entry.js", "NiceChunkLoading.worldReady();", "module", "critical")],
      locales: {},
    },
    holdManifest: {
      ...base,
      entry: descriptor("/hold-entry.js", "NiceChunkLoading.taskStart('layout'); NiceChunkLoading.worldReady();", "module", "critical"),
      files: [
        descriptor("/hold-entry.js", "NiceChunkLoading.taskStart('layout'); NiceChunkLoading.worldReady();", "module", "critical"),
        descriptor("/app.css", css, "style", "startup"),
        descriptor("/startup-worker.js", worker, "worker", "startup"),
      ],
      locales: {},
    },
  };
}

function loaderDictionary(dictionary) {
  return {
    main: {
      loading: {
        loader: dictionary.main.loading.loader,
        stages: Object.fromEntries(Object.entries(dictionary.main.loading.stages)
          .map(([key, stage]) => [key, { title: stage.title }])),
      },
    },
  };
}

function descriptor(url, body, type = "locale", phase = "critical") {
  return { url, bytes: Buffer.byteLength(body), type, phase };
}

function html(manifest) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><script src="/loader.js" data-nicechunk-loader data-manifest="${manifest}"></script></head><body><div style="min-width:648px;height:1px"></div><script>globalThis.__progressSamples=[];setInterval(()=>{const value=globalThis.NiceChunkLoading?.snapshot().progress;if(Number.isFinite(value))globalThis.__progressSamples.push(value)},8)</script></body></html>`;
}

function send(response, body, contentType, status = 200) {
  const payload = Buffer.from(body);
  response.writeHead(status, {
    "cache-control": status === 200 ? "public, max-age=3600" : "no-store",
    "content-length": payload.length,
    "content-type": contentType,
  });
  response.end(payload);
}

function sendSlow(response, body, contentType, chunks, delayMs) {
  const payload = Buffer.from(body);
  response.writeHead(200, {
    "cache-control": "public, max-age=3600",
    "content-length": payload.length,
    "content-type": contentType,
  });
  let offset = 0;
  const write = () => {
    const next = Math.min(payload.length, offset + Math.ceil(payload.length / chunks));
    response.write(payload.subarray(offset, next));
    offset = next;
    if (offset >= payload.length) return response.end();
    setTimeout(write, delayMs);
  };
  write();
}

function requestCount(path) {
  return counts.get(path) || 0;
}

function assertMonotonic(values) {
  assert.ok(values.length > 2);
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index] >= values[index - 1], `progress regressed at sample ${index}`);
  }
}

function assertInside(rect, viewport) {
  assert.ok(rect.left >= -1, `left edge escaped viewport: ${rect.left}`);
  assert.ok(rect.top >= -1, `top edge escaped viewport: ${rect.top}`);
  assert.ok(rect.right <= viewport.width + 1, `right edge escaped viewport: ${rect.right}`);
  assert.ok(rect.bottom <= viewport.height + 1, `bottom edge escaped viewport: ${rect.bottom}`);
}
