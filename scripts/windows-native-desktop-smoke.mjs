import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

if (process.env.GITHUB_ACTIONS !== "true") throw new Error("CI-only desktop smoke test.");
const require = createRequire(path.join(process.env.SILONR_UI_TEST_DEPENDENCIES, "package.json"));
const { chromium } = require("playwright");
const [port, mode, screenshot] = process.argv.slice(2);
const endpoint = `http://127.0.0.1:${Number(port)}`;
const deadline = Date.now() + 60000;
while (true) {
  try {
    if ((await fetch(`${endpoint}/json/version`)).ok) break;
  } catch { /* WebView2 starts after the native window. */ }
  if (Date.now() > deadline) throw new Error("WebView2 debugging endpoint did not start.");
  await new Promise((resolve) => setTimeout(resolve, 500));
}
const browser = await chromium.connectOverCDP(endpoint);
try {
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 30000 });
  if (mode === "online") {
    await page.waitForURL((url) => url.origin === "https://silonr.local", { timeout: 45000 });
    await page.locator("#email").waitFor({ state: "visible" });
    await page.locator("#password").waitFor({ state: "visible" });
    assert.match(await page.title(), /SiloNR/);
  } else {
    await page.locator("#pairing-section").waitFor({ state: "visible" });
    assert.equal(new URL(page.url()).hostname, "tauri.localhost");
    if (mode === "unavailable") {
      await page.locator("#global-error").waitFor({ state: "visible" });
      assert.match(await page.locator("#global-error").innerText(), /servidor local/i);
      assert.equal(await page.locator("#open-online").isVisible(), true);
    } else {
      assert.equal(mode, "offline");
      assert.equal(await page.locator("#global-error").isVisible(), false);
    }
  }
  await page.screenshot({ path: screenshot });
  console.log(`Native Desktop ${mode}: expected UI displayed inside WebView2.`);
} finally {
  await browser.close();
}
