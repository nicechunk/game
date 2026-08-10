import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.NICECHUNK_TEST_ORIGIN || "http://127.0.0.1:4182";
const sourceHtml = (await readFile(new URL("../index.html", import.meta.url), "utf8"))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "");
const viewports = [
  { name: "compact desktop", width: 1248, height: 720, mobile: false },
  { name: "desktop breakpoint", width: 901, height: 700, mobile: false },
  { name: "mobile portrait", width: 390, height: 844, mobile: true },
  { name: "mobile landscape", width: 844, height: 390, mobile: true },
];

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      screen: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
    });
    const page = await context.newPage();
    await page.route(`${origin}/play/tests/backpack-header-overflow`, (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: sourceHtml,
    }));
    await page.goto(`${origin}/play/tests/backpack-header-overflow`, { waitUntil: "domcontentloaded" });

    const layouts = await page.evaluate(() => {
      const panel = document.querySelector("#backpackPanel");
      const meta = document.querySelector("#backpackMeta");
      panel.hidden = false;
      meta.replaceChildren(...[
        ["backpack-meta-stacks", "18 stacks"],
        ["backpack-meta-items", "18 / 50 slots · 62 items"],
        ["backpack-meta-weight", "Weight: 20.839 kg"],
      ].map(([className, text]) => Object.assign(document.createElement("span"), { className, textContent: text })));
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
      return ["inventory", "smelting"].map((mode) => {
        panel.dataset.inventoryMode = mode;
        const header = document.querySelector("#backpackPanel .backpack-header");
        return {
          mode,
          panel: rect("#backpackPanel"),
          header: rect("#backpackPanel .backpack-header"),
          actions: rect("#backpackPanel .backpack-header-actions"),
          close: rect("#closeBackpackButton"),
          headerClientWidth: header.clientWidth,
          headerScrollWidth: header.scrollWidth,
          pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        };
      });
    });

    for (const layout of layouts) {
      const label = `${viewport.name}/${layout.mode}`;
      assert.ok(layout.close.left >= layout.header.left - 1, `${label}: close button escaped the left edge`);
      assert.ok(layout.close.right <= layout.header.right + 1, `${label}: close button escaped the header (${JSON.stringify(layout)})`);
      assert.ok(layout.close.right <= layout.panel.right + 1, `${label}: close button escaped the panel`);
      assert.ok(layout.actions.right <= layout.header.right + 1, `${label}: header actions overflowed`);
      assert.ok(layout.headerScrollWidth <= layout.headerClientWidth + 1, `${label}: header content overflowed`);
      assert.equal(layout.pageOverflow, 0, `${label}: backpack created horizontal page overflow`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
