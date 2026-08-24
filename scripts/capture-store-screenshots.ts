/**
 * Capture Chrome Web Store listing screenshots (1280×800 PNG).
 *
 * Usage:
 *   bun run build:chrome
 *   bun run screenshots
 *
 * Output: store-assets/screenshots/
 */
import { chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(rootDir, ".output", "chrome-mv3");
const outDir = path.join(rootDir, "store-assets", "screenshots");
const WIDTH = 1280;
const HEIGHT = 800;

declare const chrome: {
  runtime: { sendMessage: (message: unknown) => Promise<{ ok?: boolean; error?: string }> };
  tabs: { query: (query: object) => Promise<Array<{ id?: number; url?: string }>> };
};

async function launchExtension() {
  if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
    throw new Error(`Missing Chrome build at ${extensionPath}. Run \`bun run build:chrome\` first.`);
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabtether-shots-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  const extensionId = serviceWorker.url().split("/")[2];
  if (!extensionId) throw new Error("Could not derive extension id");

  return { context, serviceWorker, extensionId, userDataDir };
}

async function waitForPopupReady(page: Page) {
  await page.getByRole("heading", { name: "TabTether" }).waitFor();
  await sendMessage(page, {
    type: "COMPLETE_ONBOARDING",
    syncModes: { offline: true, lan: false, online: false },
    deviceName: "Screenshot device",
  });
  await page.reload();
  await page.getByText("Current page").waitFor();
}

async function sendMessage(page: Page, message: Record<string, unknown>) {
  const response = await page.evaluate(async (msg) => {
    return await chrome.runtime.sendMessage(msg);
  }, message);
  if (!response?.ok) {
    throw new Error(response?.error ?? `Message failed: ${JSON.stringify(message)}`);
  }
  return response;
}

async function openSite(context: BrowserContext, url: string) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}

async function findTabId(serviceWorker: Worker, urlPrefix: string) {
  const tabId = await serviceWorker.evaluate(async (prefix) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.startsWith(prefix))?.id ?? null;
  }, urlPrefix);
  if (tabId === null) throw new Error(`No tab for ${urlPrefix}`);
  return tabId;
}

async function saveExactViewport(page: Page, filePath: string) {
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.waitForTimeout(250);
  await page.screenshot({
    path: filePath,
    type: "png",
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  });
  console.log(`Wrote ${filePath}`);
}

/** Center a narrow popup capture on a 1280×800 branded backdrop. */
async function composePopupShot(
  context: BrowserContext,
  popupPng: Buffer,
  filePath: string,
  caption: string,
) {
  const page = await context.newPage();
  const dataUrl = `data:image/png;base64,${popupPng.toString("base64")}`;
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.setContent(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
    body {
      display: grid;
      place-items: center;
      background:
        radial-gradient(1200px 600px at 15% 10%, #d8f0e0 0%, transparent 55%),
        radial-gradient(900px 500px at 90% 85%, #e8e4f5 0%, transparent 50%),
        linear-gradient(160deg, #f7f5f0 0%, #eef2ef 45%, #e7ebe8 100%);
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    }
    .frame {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 18px;
    }
    .caption {
      margin: 0;
      color: #2a332e;
      font-size: 22px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      box-shadow:
        0 1px 2px rgba(20, 30, 24, 0.08),
        0 18px 40px rgba(20, 30, 24, 0.16);
      overflow: hidden;
      line-height: 0;
    }
    img { display: block; max-height: 640px; width: auto; }
  </style>
</head>
<body>
  <div class="frame">
    <p class="caption">${caption}</p>
    <div class="card"><img src="${dataUrl}" alt="TabTether popup" /></div>
  </div>
</body>
</html>`);
  await page.waitForTimeout(150);
  await saveExactViewport(page, filePath);
  await page.close();
}

async function captureSeededShots() {
  const { context, serviceWorker, extensionId, userDataDir } = await launchExtension();
  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await waitForPopupReady(popup);

    const sites = [
      { url: "https://example.com/", prefix: "https://example.com", name: "Example Domain" },
      {
        url: "https://developer.mozilla.org/en-US/",
        prefix: "https://developer.mozilla.org",
        name: "MDN Web Docs",
      },
      {
        url: "https://www.wikipedia.org/",
        prefix: "https://www.wikipedia.org",
        name: "Wikipedia",
      },
    ] as const;

    for (const site of sites) {
      await openSite(context, site.url);
      const tabId = await findTabId(serviceWorker, site.prefix);
      await sendMessage(popup, { type: "TRACK_TAB", tabId, name: site.name });
    }

    await popup.reload();
    await popup.getByText("Tethered").waitFor();
    await popup.getByRole("button", { name: /Example Domain/ }).first().waitFor();

    const popupShot = await popup.locator(".app").screenshot({ type: "png" });
    await composePopupShot(
      context,
      popupShot,
      path.join(outDir, "01-popup-tethered.png"),
      "Tether a tab — keep the activity as the URL changes",
    );

    const dashboard = await context.newPage();
    await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await dashboard.getByText("Example Domain").first().waitFor();
    await saveExactViewport(dashboard, path.join(outDir, "02-dashboard-tabs.png"));

    await dashboard.getByRole("tab", { name: "Settings" }).click();
    await dashboard.getByText("Device name").first().waitFor();
    await saveExactViewport(dashboard, path.join(outDir, "03-dashboard-settings.png"));

    const overview = await context.newPage();
    await overview.goto(`chrome-extension://${extensionId}/popup.html`);
    await overview.getByText("Current page").waitFor();
    const overviewShot = await overview.locator(".app").screenshot({ type: "png" });
    await composePopupShot(
      context,
      overviewShot,
      path.join(outDir, "04-popup-overview.png"),
      "Local-first tethered tabs with optional cloud or LAN sync",
    );
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  await captureSeededShots();
  console.log(`\nDone. Upload PNGs from:\n  ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
