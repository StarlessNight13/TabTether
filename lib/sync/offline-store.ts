import type { HistoryEntry, TrackedTab } from "../types";
import type { SeriesTetherPattern, TetherMode } from "../tether-series";
import { defaultTetherMode } from "../tether-series";
import { buildLocalDeviceRef } from "../local-device";
import { detectBrowser } from "../device";
import { getLocalState, setLocalState } from "../storage";

function nowIso() {
  return new Date().toISOString();
}

function createLocalTabId() {
  return `local_tab_${crypto.randomUUID()}`;
}

function createHistoryId() {
  return `local_hist_${crypto.randomUUID()}`;
}

export async function listOfflineTabs(): Promise<TrackedTab[]> {
  const state = await getLocalState();
  return state.cachedTabs;
}

export async function createOfflineTab(input: {
  deviceId: string;
  deviceName: string;
  name: string;
  emoji?: string | null;
  url: string;
  title?: string | null;
  tetherMode?: TetherMode;
  seriesPattern?: SeriesTetherPattern;
}): Promise<TrackedTab> {
  const now = nowIso();
  const tab: TrackedTab = {
    id: createLocalTabId(),
    name: input.name,
    emoji: input.emoji ?? null,
    tags: [],
    groupId: null,
    group: null,
    currentUrl: input.url,
    currentTitle: input.title ?? null,
    activeDeviceId: input.deviceId,
    lastUpdatedDeviceId: input.deviceId,
    lastUpdatedAt: now,
    createdAt: now,
    archivedAt: null,
    isPrivate: false,
    tetherMode: input.tetherMode ?? defaultTetherMode(),
    seriesPattern: input.seriesPattern,
    activeDevice: buildLocalDeviceRef(input.deviceId, input.deviceName),
    lastUpdatedDevice: buildLocalDeviceRef(input.deviceId, input.deviceName),
  };

  const state = await getLocalState();
  const history = { ...state.localHistory };
  if (state.settings.recordHistory && !tab.isPrivate) {
    const entries = history[tab.id] ?? [];
    history[tab.id] = [
      {
        id: createHistoryId(),
        url: input.url,
        title: input.title ?? null,
        visitedAt: now,
      },
      ...entries,
    ].slice(0, 200);
  }

  await setLocalState({
    cachedTabs: [tab, ...state.cachedTabs],
    localHistory: history,
  });

  return tab;
}

export async function updateOfflineTabLocation(input: {
  tabId: string;
  deviceId: string;
  deviceName: string;
  url: string;
  title?: string | null;
}): Promise<TrackedTab | null> {
  const state = await getLocalState();
  const tab = state.cachedTabs.find((t) => t.id === input.tabId);
  if (!tab) return null;

  if (tab.activeDeviceId && tab.activeDeviceId !== input.deviceId) {
    return tab;
  }

  const now = nowIso();
  const urlChanged = tab.currentUrl !== input.url;
  const updated: TrackedTab = {
    ...tab,
    currentUrl: input.url,
    currentTitle: input.title ?? tab.currentTitle,
    activeDeviceId: input.deviceId,
    lastUpdatedDeviceId: input.deviceId,
    lastUpdatedAt: now,
    activeDevice: buildLocalDeviceRef(input.deviceId, input.deviceName),
    lastUpdatedDevice: buildLocalDeviceRef(input.deviceId, input.deviceName),
  };

  const history = { ...state.localHistory };
  if (state.settings.recordHistory && !tab.isPrivate && urlChanged) {
    const entries = history[input.tabId] ?? [];
    history[input.tabId] = [
      {
        id: createHistoryId(),
        url: input.url,
        title: input.title ?? null,
        visitedAt: now,
      },
      ...entries,
    ].slice(0, 200);
  }

  await setLocalState({
    cachedTabs: state.cachedTabs.map((t) => (t.id === input.tabId ? updated : t)),
    localHistory: history,
  });

  return updated;
}

export async function updateOfflineTabSeriesPattern(input: {
  tabId: string;
  seriesPattern: SeriesTetherPattern;
}): Promise<TrackedTab | null> {
  const state = await getLocalState();
  const tab = state.cachedTabs.find((t) => t.id === input.tabId);
  if (!tab) return null;

  const updated: TrackedTab = {
    ...tab,
    tetherMode: "series",
    seriesPattern: input.seriesPattern,
    lastUpdatedAt: nowIso(),
  };

  await setLocalState({
    cachedTabs: state.cachedTabs.map((t) => (t.id === input.tabId ? updated : t)),
  });

  return updated;
}

export async function updateOfflineTabTether(input: {
  tabId: string;
  tetherMode: TetherMode;
  seriesPattern?: SeriesTetherPattern;
}): Promise<TrackedTab | null> {
  const state = await getLocalState();
  const tab = state.cachedTabs.find((t) => t.id === input.tabId);
  if (!tab) return null;

  const updated: TrackedTab = {
    ...tab,
    tetherMode: input.tetherMode,
    seriesPattern: input.seriesPattern,
    lastUpdatedAt: nowIso(),
  };

  await setLocalState({
    cachedTabs: state.cachedTabs.map((t) => (t.id === input.tabId ? updated : t)),
  });

  return updated;
}

export async function archiveOfflineTab(tabId: string): Promise<TrackedTab | null> {
  const state = await getLocalState();
  const tab = state.cachedTabs.find((t) => t.id === tabId);
  if (!tab) return null;

  const updated: TrackedTab = {
    ...tab,
    archivedAt: nowIso(),
    activeDeviceId: null,
    activeDevice: null,
    lastUpdatedAt: nowIso(),
  };

  await setLocalState({
    cachedTabs: state.cachedTabs.map((t) => (t.id === tabId ? updated : t)),
  });
  return updated;
}

export async function restoreOfflineTab(tabId: string): Promise<TrackedTab | null> {
  const state = await getLocalState();
  const tab = state.cachedTabs.find((t) => t.id === tabId);
  if (!tab) return null;

  const updated: TrackedTab = {
    ...tab,
    archivedAt: null,
    lastUpdatedAt: nowIso(),
  };

  await setLocalState({
    cachedTabs: state.cachedTabs.map((t) => (t.id === tabId ? updated : t)),
  });
  return updated;
}

export async function applyOfflineTabTags(
  tabId: string,
  tags: string[],
  mode: "add" | "replace",
): Promise<TrackedTab | null> {
  const state = await getLocalState();
  const tab = state.cachedTabs.find((t) => t.id === tabId);
  if (!tab) return null;

  const nextTags =
    mode === "replace" ? tags : [...new Set([...tab.tags, ...tags])];
  return renameOfflineTab(tabId, tab.name, tab.emoji, nextTags, tab.groupId, tab.isPrivate);
}

export async function moveOfflineTabToGroup(
  tabId: string,
  groupId: string | null,
): Promise<TrackedTab | null> {
  const state = await getLocalState();
  const tab = state.cachedTabs.find((t) => t.id === tabId);
  if (!tab) return null;
  return renameOfflineTab(tabId, tab.name, tab.emoji, tab.tags, groupId, tab.isPrivate);
}

export async function renameOfflineTab(
  tabId: string,
  name: string,
  emoji?: string | null,
  tags?: string[],
  groupId?: string | null,
  isPrivate?: boolean,
): Promise<TrackedTab | null> {
  const state = await getLocalState();
  const tab = state.cachedTabs.find((t) => t.id === tabId);
  if (!tab) return null;

  const updated: TrackedTab = {
    ...tab,
    name,
    ...(emoji !== undefined ? { emoji } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(groupId !== undefined ? { groupId, group: null } : {}),
    ...(isPrivate !== undefined ? { isPrivate } : {}),
    lastUpdatedAt: nowIso(),
  };

  await setLocalState({
    cachedTabs: state.cachedTabs.map((t) => (t.id === tabId ? updated : t)),
  });

  return updated;
}

export async function deleteOfflineTab(tabId: string) {
  const state = await getLocalState();
  const { [tabId]: _removed, ...restHistory } = state.localHistory;
  await setLocalState({
    cachedTabs: state.cachedTabs.filter((t) => t.id !== tabId),
    localHistory: restHistory,
  });
}

export async function takeOverOfflineTab(tabId: string, deviceId: string, deviceName: string) {
  const state = await getLocalState();
  const tab = state.cachedTabs.find((t) => t.id === tabId);
  if (!tab) return null;

  const updated: TrackedTab = {
    ...tab,
    activeDeviceId: deviceId,
    lastUpdatedDeviceId: deviceId,
    lastUpdatedAt: nowIso(),
    activeDevice: buildLocalDeviceRef(deviceId, deviceName),
    lastUpdatedDevice: buildLocalDeviceRef(deviceId, deviceName),
  };

  await setLocalState({
    cachedTabs: state.cachedTabs.map((t) => (t.id === tabId ? updated : t)),
  });

  return updated;
}

export async function releaseOfflineTab(tabId: string, deviceId: string) {
  const state = await getLocalState();
  const tab = state.cachedTabs.find((t) => t.id === tabId);
  if (!tab || tab.activeDeviceId !== deviceId) return tab ?? null;

  const updated: TrackedTab = { ...tab, activeDeviceId: null, activeDevice: null };
  await setLocalState({
    cachedTabs: state.cachedTabs.map((t) => (t.id === tabId ? updated : t)),
  });
  return updated;
}

export async function getOfflineHistory(tabId: string): Promise<HistoryEntry[]> {
  const state = await getLocalState();
  return state.localHistory[tabId] ?? [];
}

export async function clearOfflineHistory(tabId: string) {
  const state = await getLocalState();
  await setLocalState({
    localHistory: { ...state.localHistory, [tabId]: [] },
  });
}

export async function mergeOfflineTabFromPeer(incoming: TrackedTab) {
  const state = await getLocalState();
  const existing = state.cachedTabs.find((t) => t.id === incoming.id);
  if (existing) {
    if (new Date(incoming.lastUpdatedAt).getTime() <= new Date(existing.lastUpdatedAt).getTime()) {
      return existing;
    }
  }

  // Older peers may omit series fields; don't wipe a richer local pattern on LWW URL updates.
  const mergedIncoming =
    existing && !incoming.seriesPattern && existing.seriesPattern
      ? {
          ...incoming,
          tetherMode: existing.tetherMode ?? incoming.tetherMode,
          seriesPattern: existing.seriesPattern,
        }
      : incoming;

  const cachedTabs = existing
    ? state.cachedTabs.map((t) => (t.id === mergedIncoming.id ? mergedIncoming : t))
    : [mergedIncoming, ...state.cachedTabs];

  const history = { ...state.localHistory };
  if (
    existing &&
    existing.currentUrl !== mergedIncoming.currentUrl &&
    state.settings.recordHistory &&
    !mergedIncoming.isPrivate
  ) {
    const entries = history[mergedIncoming.id] ?? [];
    const alreadyRecorded = entries.some((entry) => entry.url === existing.currentUrl);
    if (!alreadyRecorded) {
      history[mergedIncoming.id] = [
        {
          id: createHistoryId(),
          url: existing.currentUrl,
          title: existing.currentTitle,
          visitedAt: existing.lastUpdatedAt,
        },
        ...entries,
      ].slice(0, 200);
    }
  }

  await setLocalState({ cachedTabs, localHistory: history });
  return mergedIncoming;
}

export { detectBrowser };
