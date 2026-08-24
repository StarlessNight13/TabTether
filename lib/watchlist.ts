import { restoreMatchKey } from "./restore-bindings";
import { getLocalState, setLocalState } from "./storage";
import { findSyncedTab } from "./sync/router";
import type { PrivacySettings } from "./types";

export async function setActivityWatching(trackedTabId: string, watching: boolean) {
  const state = await getLocalState();
  const watched = new Set(state.watchedActivityIds);
  if (watching) watched.add(trackedTabId);
  else watched.delete(trackedTabId);
  await setLocalState({ watchedActivityIds: [...watched] });
  if (watching) {
    const tab =
      state.cachedTabs.find((entry) => entry.id === trackedTabId) ??
      (await findSyncedTab(trackedTabId));
    if (tab) await markActivitySeen(trackedTabId, tab.currentUrl, state.settings);
  }
  return getLocalState();
}

export async function markActivitySeen(
  trackedTabId: string,
  url: string,
  settings?: PrivacySettings,
) {
  const state = await getLocalState();
  const resolvedSettings = settings ?? state.settings;
  const urlKey = restoreMatchKey(url, resolvedSettings);
  if (!urlKey) return state;
  await setLocalState({
    lastSeenOnDevice: {
      ...state.lastSeenOnDevice,
      [trackedTabId]: {
        urlKey,
        url,
        seenAt: new Date().toISOString(),
      },
    },
  });
  return getLocalState();
}
