import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.route(`${origin}/play/tests/minimap-guardian-status`, (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><body><span id=world></span><span id=chunk></span></body></html>",
  }));
  await page.goto(`${origin}/play/tests/minimap-guardian-status`, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const { createPlayMinimap } = await import("/play/play-minimap.js");
    const minimap = createPlayMinimap({
      elements: {
        minimapWorldCoord: document.querySelector("#world"),
        minimapChunkCoord: document.querySelector("#chunk"),
      },
      worldSeed: "nicechunk-mainnet-001",
      getPlayerPosition: () => [32, 80, -16],
      translate: (key, fallback) => key === "main.mapGuardian.connectionLost" ? "Connection lost" : fallback,
    });
    minimap.setGuardianConnectionState("disconnected");
    const disconnected = document.querySelector("#chunk").textContent;
    minimap.setGuardianConnectionState("connecting");
    const connecting = document.querySelector("#chunk").textContent;
    minimap.setGuardianConnectionState("connected");
    const connected = document.querySelector("#chunk").textContent;
    return { disconnected, connecting, connected };
  });

  assert.equal(result.disconnected, "Connection lost");
  assert.equal(result.connecting, "Chunk: 2, 5, -1");
  assert.equal(result.connected, "Chunk: 2, 5, -1");
} finally {
  await browser.close();
}
