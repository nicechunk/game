import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import test from "node:test";
import { chromium } from "playwright";

const [rpcSettingsSource, rpcConfigSource, i18nSource, stylesSource, indexSource, localeSource] = await Promise.all([
  readFile(new URL("../play-rpc-settings.js", import.meta.url), "utf8"),
  readFile(new URL("../../src/rpcConfig.js", import.meta.url), "utf8"),
  readFile(new URL("../../src/i18n.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../../public/play/locales/en.json", import.meta.url), "utf8"),
]);
const panelMarkup = indexSource.match(/<section class="rpc-config-panel"[\s\S]*?<\/section>/u)?.[0];
assert.ok(panelMarkup, "RPC settings panel markup is missing");

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/fixture") return send(response, fixtureHtml(), "text/html; charset=utf-8");
  if (pathname === "/play/play-rpc-settings.js") return send(response, rpcSettingsSource, "text/javascript; charset=utf-8");
  if (pathname === "/src/rpcConfig.js") return send(response, rpcConfigSource, "text/javascript; charset=utf-8");
  if (pathname === "/src/i18n.js") return send(response, i18nSource, "text/javascript; charset=utf-8");
  if (pathname === "/play/styles.css") return send(response, stylesSource, "text/css; charset=utf-8");
  if (pathname === "/play/locales/en.json") return send(response, localeSource, "application/json; charset=utf-8");
  response.writeHead(404).end("not found");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

test("RPC settings preserve failure context, verify Devnet, and never expose credentials", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const consoleMessages = [];
    page.on("console", (message) => consoleMessages.push(message.text()));
    await page.route("https://devnet.helius-rpc.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: "nicechunk-rpc-check", result: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" }),
    }));
    await page.goto(`${origin}/fixture`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => globalThis.__rpcReady === true);

    const secret = "loader-rpc-secret-should-not-leak";
    await page.evaluate(() => globalThis.openRpcSettings({
      code: "rpc-rate-limited",
      stage: "characterAccess",
      reason: "RPC HTTP 429 at https://devnet.helius-rpc.com/?api-key=loader-rpc-secret-should-not-leak",
    }));
    await page.waitForSelector("#rpcConfigPanel:not([hidden])");
    const failureCopy = await page.locator("#rpcConfigContext").textContent();
    assert.match(failureCopy, /RPC request limit reached/);
    assert.match(failureCopy, /RPC HTTP 429/);
    assert.match(failureCopy, /\[endpoint-redacted\]/);
    assert.doesNotMatch(failureCopy, new RegExp(secret));

    const layout = await page.evaluate(() => {
      const rect = document.querySelector(".rpc-config-dialog").getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight };
    });
    assert.ok(layout.left >= -1 && layout.right <= layout.width + 1, `RPC settings overflow horizontally: ${JSON.stringify(layout)}`);
    assert.ok(layout.top >= -1 && layout.bottom <= layout.height + 1, `RPC settings overflow vertically: ${JSON.stringify(layout)}`);

    await page.locator("#rpcConfigApiKey").fill(secret);
    await page.locator("#rpcConfigSubmit").click();
    await page.waitForFunction(() => globalThis.__rpcResult?.action === "saved");
    const saved = await page.evaluate(() => ({
      result: globalThis.__rpcResult,
      key: sessionStorage.getItem("nicechunk.heliusApiKey"),
      override: localStorage.getItem("nicechunk.devnetRpcUrl"),
      panelHidden: document.querySelector("#rpcConfigPanel").hidden,
      bodyText: document.body.textContent,
    }));
    assert.deepEqual(saved.result, { action: "saved", mode: "helius" });
    assert.equal(saved.key, secret);
    assert.equal(saved.override, null);
    assert.equal(saved.panelHidden, true);
    assert.doesNotMatch(saved.bodyText, new RegExp(secret));
    assert.ok(consoleMessages.every((message) => !message.includes(secret)), "RPC credential leaked to console output");
  } finally {
    await browser.close();
  }
});

test("RPC settings reject non-Devnet endpoints, support custom HTTPS RPC, and reset to public", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 980, height: 760 } });
    let customGenesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
    await page.route("https://rpc.example.test/**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: "nicechunk-rpc-check", result: customGenesis }),
    }));
    await page.goto(`${origin}/fixture`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => globalThis.__rpcReady === true);

    await page.evaluate(() => globalThis.openRpcSettings());
    await page.locator("#rpcConfigMode").selectOption("custom");
    await page.locator("#rpcConfigEndpoint").fill("http://rpc.example.test/devnet");
    await page.locator("#rpcConfigSubmit").click();
    assert.equal(
      await page.locator("#rpcConfigStatus").textContent(),
      "Enter a valid HTTPS Solana Devnet RPC endpoint without embedded username or password credentials.",
    );

    await page.locator("#rpcConfigEndpoint").fill("https://rpc.example.test/devnet?token=private-value");
    await page.locator("#rpcConfigSubmit").click();
    await page.waitForFunction(() => document.querySelector("#rpcConfigStatus")?.textContent.includes("not Solana Devnet"));
    assert.match(await page.locator("#rpcConfigStatus").textContent(), /not Solana Devnet/);
    assert.equal(await page.evaluate(() => localStorage.getItem("nicechunk.devnetRpcUrl")), null);

    customGenesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    await page.locator("#rpcConfigSubmit").click();
    await page.waitForFunction(() => globalThis.__rpcResult?.mode === "custom");
    const custom = await page.evaluate(() => ({
      endpoint: localStorage.getItem("nicechunk.devnetRpcUrl"),
      key: sessionStorage.getItem("nicechunk.heliusApiKey"),
    }));
    assert.equal(custom.endpoint, "https://rpc.example.test/devnet?token=private-value");
    assert.equal(custom.key, null);

    await page.evaluate(() => globalThis.openRpcSettings());
    await page.locator("#rpcConfigUsePublic").click();
    await page.waitForFunction(() => globalThis.__rpcResult?.mode === "public");
    const reset = await page.evaluate(() => ({
      endpoint: localStorage.getItem("nicechunk.devnetRpcUrl"),
      key: sessionStorage.getItem("nicechunk.heliusApiKey"),
    }));
    assert.deepEqual(reset, { endpoint: null, key: null });
  } finally {
    await browser.close();
  }
});

test("Dismissing RPC settings resolves without changing the stored connection", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${origin}/fixture`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => globalThis.__rpcReady === true);
    await page.evaluate(() => {
      sessionStorage.setItem("nicechunk.heliusApiKey", "existing-key");
      return globalThis.openRpcSettings();
    });
    await page.locator("#rpcConfigDismiss").click();
    await page.waitForFunction(() => globalThis.__rpcResult?.action === "dismissed");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("nicechunk.heliusApiKey")), "existing-key");
  } finally {
    await browser.close();
  }
});

function fixtureHtml() {
  return `<!doctype html>
    <html lang="en" data-i18n-scope="play" data-i18n-build-version="rpc-test-v1">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
        <link rel="stylesheet" href="/play/styles.css">
      </head>
      <body>
        <button id="fixtureReturnFocus" type="button">Open settings</button>
        ${panelMarkup}
        <script type="module">
          import { initI18n } from "/src/i18n.js";
          import { getPlayRpcSettings } from "/play/play-rpc-settings.js";
          await initI18n(document);
          const settings = getPlayRpcSettings();
          globalThis.openRpcSettings = (context = null) => {
            globalThis.__rpcResult = null;
            settings.open({ context }).then((result) => { globalThis.__rpcResult = result; });
          };
          globalThis.__rpcReady = true;
        </script>
      </body>
    </html>`;
}

function send(response, body, contentType) {
  const payload = Buffer.from(body);
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-length": payload.length,
    "content-type": contentType,
  });
  response.end(payload);
}
