import { addTrackedTabBadge, stripTrackedTabBadge } from "../lib/title-badge";
import {
  DASHBOARD_BRIDGE_SOURCE,
  getExtensionBridgeInfo,
} from "../lib/extension-bridge";
import type { MovedOnMatch } from "../lib/moved-on";

type TitleBadgeMessage =
  | { type: "SET_TRACKED_TITLE_BADGE"; emoji?: string | null }
  | { type: "CLEAR_TRACKED_TITLE_BADGE" };

type MovedOnBannerMessage =
  | { type: "SET_MOVED_ON_BANNER"; payload: MovedOnMatch }
  | { type: "CLEAR_MOVED_ON_BANNER" };

type ContentInboundMessage = TitleBadgeMessage | MovedOnBannerMessage;

const BANNER_HOST_ID = "tabtether-moved-on-banner-host";

let isTracked = false;
let trackedEmoji: string | null = null;
let applyingOwnTitleChange = false;
let bannerHost: HTMLElement | null = null;
let bannerMatch: MovedOnMatch | null = null;
let bannerBusy = false;

function withOwnTitleChange(nextTitle: string) {
  if (document.title === nextTitle) return;
  applyingOwnTitleChange = true;
  document.title = nextTitle;
  queueMicrotask(() => {
    applyingOwnTitleChange = false;
  });
}

function syncTrackedTitle() {
  if (!isTracked) return;
  withOwnTitleChange(addTrackedTabBadge(document.title, trackedEmoji));
}

function clearTrackedTitle() {
  if (!isTracked) return;
  const previousEmoji = trackedEmoji;
  isTracked = false;
  trackedEmoji = null;
  withOwnTitleChange(stripTrackedTabBadge(document.title, previousEmoji));
}

function announceToPage() {
  window.postMessage(getExtensionBridgeInfo(), window.location.origin);
}

function ensureBannerHost(): HTMLElement | null {
  if (bannerHost?.isConnected) return bannerHost;
  const root = document.documentElement;
  if (!root) return null;

  const existing = document.getElementById(BANNER_HOST_ID);
  if (existing) {
    bannerHost = existing;
    return bannerHost;
  }

  const host = document.createElement("div");
  host.id = BANNER_HOST_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "0";
  host.style.right = "0";
  host.style.zIndex = "2147483646";
  host.style.pointerEvents = "none";
  (document.body ?? root).prepend(host);
  bannerHost = host;
  return host;
}

function removeBanner() {
  bannerMatch = null;
  bannerBusy = false;
  if (bannerHost) {
    bannerHost.remove();
    bannerHost = null;
  }
  const leftover = document.getElementById(BANNER_HOST_ID);
  leftover?.remove();
}

function renderBanner(match: MovedOnMatch) {
  bannerMatch = match;
  const host = ensureBannerHost();
  if (!host) return;

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const label = match.emoji ? `${match.emoji} ${match.name}` : match.name;
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .bar {
        pointer-events: auto;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
        padding: 10px 14px;
        font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
        color: #1c1b1f;
        background: #e8f0e9;
        border-bottom: 1px solid #c4d0c6;
        box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
      }
      .copy { flex: 1 1 220px; min-width: 0; }
      .title { font-weight: 600; margin: 0; }
      .sub {
        margin: 2px 0 0;
        color: #49454f;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .actions { display: flex; flex-wrap: wrap; gap: 8px; }
      button {
        appearance: none;
        border: 0;
        border-radius: 999px;
        padding: 7px 14px;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      button:disabled { opacity: 0.6; cursor: default; }
      .primary { background: #2e6b3f; color: #fff; }
      .secondary { background: #d6e3d8; color: #1c1b1f; }
      .ghost { background: transparent; color: #49454f; }
    </style>
    <div class="bar" role="status">
      <div class="copy">
        <p class="title">${escapeHtml(label)} continued from where you left</p>
        <p class="sub">${
          match.chaptersBehind && match.chaptersBehind > 0
            ? escapeHtml(
                match.chaptersBehind === 1
                  ? "1 chapter behind"
                  : `${match.chaptersBehind} chapters behind`,
              ) + " · "
            : ""
        }Now at ${escapeHtml(shortUrl(match.currentUrl))}</p>
      </div>
      <div class="actions">
        <button type="button" class="primary" data-action="go-to">Go To</button>
        <button type="button" class="secondary" data-action="reset">Reset to this page</button>
        <button type="button" class="ghost" data-action="dismiss">Dismiss</button>
      </div>
    </div>
  `;

  shadow.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-action");
      if (action === "go-to") void runBannerAction("MOVED_ON_GO_TO");
      if (action === "reset") void runBannerAction("MOVED_ON_RESET_HERE");
      if (action === "dismiss") void runBannerAction("MOVED_ON_DISMISS");
    });
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function shortUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}${parsed.search}`.replace(/\/$/, "") || parsed.host;
  } catch {
    return url;
  }
}

async function runBannerAction(type: "MOVED_ON_GO_TO" | "MOVED_ON_RESET_HERE" | "MOVED_ON_DISMISS") {
  if (!bannerMatch || bannerBusy) return;
  bannerBusy = true;
  try {
    await browser.runtime.sendMessage({
      type,
      trackedTabId: bannerMatch.trackedTabId,
      pageUrl: bannerMatch.pageUrl,
      currentUrl: bannerMatch.currentUrl,
    });
    if (type === "MOVED_ON_DISMISS" || type === "MOVED_ON_RESET_HERE") {
      removeBanner();
    }
  } catch {
    bannerBusy = false;
  }
}

const observer = new MutationObserver(() => {
  if (applyingOwnTitleChange || !isTracked) return;
  syncTrackedTitle();
});

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    browser.runtime.onMessage.addListener((message: ContentInboundMessage) => {
      if (message.type === "SET_TRACKED_TITLE_BADGE") {
        isTracked = true;
        trackedEmoji = message.emoji?.trim() || null;
        syncTrackedTitle();
        return;
      }

      if (message.type === "CLEAR_TRACKED_TITLE_BADGE") {
        clearTrackedTitle();
        return;
      }

      if (message.type === "SET_MOVED_ON_BANNER") {
        renderBanner(message.payload);
        return;
      }

      if (message.type === "CLEAR_MOVED_ON_BANNER") {
        removeBanner();
      }
    });

    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string } | null;
      if (data?.source === DASHBOARD_BRIDGE_SOURCE && data.type === "EXTENSION_PING") {
        announceToPage();
      }
    });

    void browser.runtime.sendMessage({ type: "CONTENT_SCRIPT_READY" }).catch(() => {
      // Background may still be starting during session restore.
    });

    syncTrackedTitle();
  },
});
