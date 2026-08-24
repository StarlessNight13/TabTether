import { getCloudCredentials } from "../storage/cloud-configuration";
import { getCloudHistory } from "../db/cloud-management";
import { isTrackableUrl, sanitizeUrl } from "./privacy";
import { restoreMatchKey } from "./restore-bindings";
import { getLocalState, setLocalState } from "./storage";
import {
  findSyncedTab,
  listKnownTrackedTabs,
  syncTakeOver,
  syncUpdateTabLocation,
} from "./sync/router";
import { ensureLocalDeviceId } from "./local-device";
import { hasSameHostname } from "./url-pattern";
import { filterHistoryByRetention } from "./history-retention";
import {
  findMovedOnMatch,
  movedOnDismissKey,
  type MovedOnMatch,
} from "./moved-on";
import type { HistoryEntry } from "./types";
import { writeTabActivityId } from "./tab-session-binding";

const DISMISS_SESSION_KEY = "movedOnDismissals";

type BannerMessage =
  | { type: "SET_MOVED_ON_BANNER"; payload: MovedOnMatch }
  | { type: "CLEAR_MOVED_ON_BANNER" };

async function readDismissedKeys(): Promise<Set<string>> {
  try {
    const stored = await browser.storage.session.get(DISMISS_SESSION_KEY);
    const raw = stored[DISMISS_SESSION_KEY];
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

async function writeDismissedKeys(keys: Set<string>) {
  try {
    await browser.storage.session.set({ [DISMISS_SESSION_KEY]: [...keys] });
  } catch {
    // session storage unavailable in some environments
  }
}

async function sendBannerMessage(tabId: number, message: BannerMessage) {
  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch {
    // Content script may not be ready yet.
  }
}

async function loadExtraHistoryForCandidates(
  activityIds: string[],
): Promise<Record<string, HistoryEntry[]>> {
  if (activityIds.length === 0) return {};
  if (!(await getCloudCredentials())) return {};

  const state = await getLocalState();
  const extra: Record<string, HistoryEntry[]> = {};
  await Promise.all(
    activityIds.map(async (id) => {
      try {
        const history = filterHistoryByRetention(
          await getCloudHistory(id, state.settings.historyRetentionDays),
          state.settings.historyRetentionDays,
        );
        if (history.length) extra[id] = history;
      } catch {
        // Cloud history is best-effort for banner matching.
      }
    }),
  );
  return extra;
}

export async function resolveMovedOnForUrl(pageUrl: string): Promise<MovedOnMatch | null> {
  if (!isTrackableUrl(pageUrl)) return null;

  const state = await getLocalState();
  if (!state.settings.showMovedOnBanner) return null;

  const activities = (await listKnownTrackedTabs()).filter(
    (tab) => !tab.archivedAt && !tab.deletedAt,
  );
  const dismissedKeys = await readDismissedKeys();

  const localMatch = findMovedOnMatch({
    pageUrl,
    activities,
    localHistory: state.localHistory,
    settings: state.settings,
    dismissedKeys,
  });
  if (localMatch) return localMatch;

  // Cloud-only histories: check same-hostname activities that already moved past this page.
  const pageKey = restoreMatchKey(pageUrl, state.settings);
  if (!pageKey) return null;

  const candidates = activities.filter((activity) => {
    const currentKey = restoreMatchKey(activity.currentUrl, state.settings);
    if (!currentKey || currentKey === pageKey) return false;
    return hasSameHostname(activity.currentUrl, pageUrl);
  });
  if (candidates.length === 0) return null;

  const extraHistory = await loadExtraHistoryForCandidates(candidates.map((tab) => tab.id));

  return findMovedOnMatch({
    pageUrl,
    activities: candidates,
    localHistory: state.localHistory,
    settings: state.settings,
    dismissedKeys,
    extraHistory,
  });
}

export async function applyMovedOnBannerForTab(tabId: number, url?: string) {
  let pageUrl = url;
  if (!pageUrl) {
    try {
      const tab = await browser.tabs.get(tabId);
      pageUrl = tab.url;
    } catch {
      return null;
    }
  }

  if (!pageUrl || !isTrackableUrl(pageUrl)) {
    await sendBannerMessage(tabId, { type: "CLEAR_MOVED_ON_BANNER" });
    return null;
  }

  const match = await resolveMovedOnForUrl(pageUrl);
  if (!match) {
    await sendBannerMessage(tabId, { type: "CLEAR_MOVED_ON_BANNER" });
    return null;
  }

  await sendBannerMessage(tabId, { type: "SET_MOVED_ON_BANNER", payload: match });
  return match;
}

export async function refreshMovedOnBanners() {
  const state = await getLocalState();
  if (!state.settings.showMovedOnBanner) {
    const tabs = await browser.tabs.query({});
    await Promise.all(
      tabs
        .filter((tab) => tab.id !== undefined)
        .map((tab) => sendBannerMessage(tab.id!, { type: "CLEAR_MOVED_ON_BANNER" })),
    );
    return;
  }

  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined && isTrackableUrl(tab.url))
      .map((tab) => applyMovedOnBannerForTab(tab.id!, tab.url)),
  );
}

export async function dismissMovedOnBanner(input: {
  trackedTabId: string;
  pageUrl: string;
  currentUrl?: string;
}) {
  const state = await getLocalState();
  const pageKey = restoreMatchKey(input.pageUrl, state.settings);
  const currentKey = restoreMatchKey(
    input.currentUrl ??
      (await findSyncedTab(input.trackedTabId))?.currentUrl ??
      "",
    state.settings,
  );
  if (!pageKey || !currentKey) return;

  const keys = await readDismissedKeys();
  keys.add(movedOnDismissKey(input.trackedTabId, pageKey, currentKey));
  await writeDismissedKeys(keys);
}

export async function goToMovedOnCurrent(
  trackedTabId: string,
  browserTabId: number,
  url?: string,
) {
  const tracked = await findSyncedTab(trackedTabId);
  if (!tracked) throw new Error("Tethered tab not found");
  await browser.tabs.update(browserTabId, { url: url ?? tracked.currentUrl });
  return tracked;
}

export async function resetMovedOnToHere(trackedTabId: string, browserTabId: number) {
  await ensureLocalDeviceId();
  const tab = await browser.tabs.get(browserTabId);
  const url = tab.url;
  if (!url || !isTrackableUrl(url)) {
    throw new Error("This page cannot be used as the tether location");
  }

  const state = await getLocalState();
  const sanitized = sanitizeUrl(url, state.settings);
  const title = tab.title ?? null;

  await syncTakeOver(trackedTabId);
  const updated = await syncUpdateTabLocation({
    tabId: trackedTabId,
    url: sanitized,
    title,
  });
  if (!updated) throw new Error("Tethered tab not found");

  const latest = await getLocalState();
  await setLocalState({
    bindings: { ...latest.bindings, [String(browserTabId)]: trackedTabId },
  });
  await writeTabActivityId(browserTabId, trackedTabId);
  return updated;
}
