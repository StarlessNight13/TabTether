import type { TrackedTab } from "../types";
import type { SeriesTetherPattern, TetherMode } from "../tether-series";
import { getEffectiveDeviceId, getEffectiveDeviceName } from "../local-device";
import { getLocalState, setLocalState } from "../storage";
import { withLocalTether } from "../tether-overlay";
import { clearTabActivityId } from "../tab-session-binding";
import {
  createOfflineTab,
  deleteOfflineTab,
  mergeOfflineTabFromPeer,
  renameOfflineTab,
  takeOverOfflineTab,
  updateOfflineTabLocation,
} from "./offline-store";
import { broadcastLanTabEvent } from "../lan-sync/broadcast";
import { shouldRecordHistory } from "../../core/privacy";
import { getCloudCredentials, getCloudSummary } from "../../storage/cloud-configuration";
import { listCachedTabs } from "../../storage/indexed-db";
import {
  cloudTabView,
  createCloudTab,
  deleteCloudTab,
  renameCloudTab,
  takeOverCloudTab,
  updateCloudTabLocation,
  updateCloudTabTether,
} from "../../sync/cloud-tabs";

export async function findSyncedTab(tabId: string): Promise<TrackedTab | null> {
  const tabs = await listKnownTrackedTabs();
  return tabs.find((tab) => tab.id === tabId) ?? null;
}

export async function listKnownTrackedTabs(): Promise<TrackedTab[]> {
  const state = await getLocalState();
  const localById = new Map(state.cachedTabs.map((tab) => [tab.id, tab]));
  const cloud = await getCloudSummary();
  if (!cloud.configuration) return state.cachedTabs;

  const fromCloud = (await listCachedTabs())
    .filter((tab) => !tab.deletedAt)
    .map((record) => withLocalTether(cloudTabView(record), localById.get(record.id)));
  const cloudIds = new Set(fromCloud.map((tab) => tab.id));
  return [...fromCloud, ...state.cachedTabs.filter((tab) => !cloudIds.has(tab.id))];
}

export async function persistCachedTab(tab: TrackedTab) {
  const state = await getLocalState();
  await setLocalState({ cachedTabs: mergeTabList(state, tab) });
  return state;
}

export async function syncDeleteTabFromPeer(tabId: string) {
  const state = await getLocalState();

  const bindings = { ...state.bindings };
  const clearedBrowserTabIds: number[] = [];
  for (const [browserTabId, trackedTabId] of Object.entries(bindings)) {
    if (trackedTabId === tabId) {
      delete bindings[browserTabId];
      const numericId = Number(browserTabId);
      if (Number.isInteger(numericId)) clearedBrowserTabIds.push(numericId);
    }
  }

  await Promise.all(clearedBrowserTabIds.map((id) => clearTabActivityId(id)));
  await deleteOfflineTab(tabId);

  const localHistory = { ...state.localHistory };
  delete localHistory[tabId];

  await setLocalState({
    bindings,
    localHistory,
    cachedTabs: state.cachedTabs.filter((t) => t.id !== tabId),
  });
}

export async function syncCreateTab(input: {
  name: string;
  emoji?: string | null;
  url: string;
  title?: string | null;
  tetherMode?: TetherMode;
  seriesPattern?: SeriesTetherPattern;
}): Promise<TrackedTab> {
  const state = await getLocalState();
  if (state.syncModes.online && (await getCloudCredentials())) {
    const tab = await createCloudTab({ ...input, recordHistory: state.settings.recordHistory });
    if (!tab) throw new Error("Cloud database is not configured");
    await persistCachedTab(tab);
    if (state.syncModes.lan) void broadcastLanTabEvent({ type: "tab_created", tab });
    return tab;
  }
  const deviceId = await getEffectiveDeviceId();
  const deviceName = await getEffectiveDeviceName();
  let tab: TrackedTab | null = null;

  if (state.syncModes.offline || state.syncModes.lan) {
    tab = await createOfflineTab({
      deviceId,
      deviceName,
      name: input.name,
      emoji: input.emoji,
      url: input.url,
      title: input.title,
      tetherMode: input.tetherMode,
      seriesPattern: input.seriesPattern,
    });
  }

  if (!tab) {
    if (state.syncModes.online) {
      throw new Error("Connect a cloud database to tether tabs in Online mode");
    }
    throw new Error("No sync mode available to create tab");
  }

  if (state.syncModes.lan) {
    void broadcastLanTabEvent({ type: "tab_created", tab });
  }

  return tab;
}

export async function syncUpdateTabLocation(input: {
  tabId: string;
  url: string;
  title?: string | null;
}): Promise<TrackedTab | null> {
  const state = await getLocalState();
  const existing = await findSyncedTab(input.tabId);
  const recordHistory = existing
    ? shouldRecordHistory(state.settings, existing.isPrivate)
    : state.settings.recordHistory;
  if (state.syncModes.online && (await getCloudCredentials())) {
    const tab = await updateCloudTabLocation(
      input.tabId,
      input.url,
      input.title ?? null,
      recordHistory,
    );
    if (!tab) return null;
    // Keep local series overlay until cloud tether columns are populated / synced.
    const merged = withLocalTether(tab, existing);
    await persistCachedTab(merged);
    if (state.syncModes.lan) void broadcastLanTabEvent({ type: "tab_updated", tab: merged });
    return merged;
  }
  const deviceId = await getEffectiveDeviceId();
  const deviceName = await getEffectiveDeviceName();
  let tab: TrackedTab | null = null;
  const isLocalTab = input.tabId.startsWith("local_");

  if (state.syncModes.offline || state.syncModes.lan || isLocalTab) {
    tab = await updateOfflineTabLocation({
      tabId: input.tabId,
      deviceId,
      deviceName,
      url: input.url,
      title: input.title,
    });
  }

  if (tab && state.syncModes.lan) {
    void broadcastLanTabEvent({ type: "tab_updated", tab });
  }

  return tab;
}

export async function syncUpdateTabSeriesPattern(input: {
  tabId: string;
  seriesPattern: SeriesTetherPattern;
}): Promise<TrackedTab | null> {
  return syncUpdateTabTether({
    tabId: input.tabId,
    tetherMode: "series",
    seriesPattern: input.seriesPattern,
  });
}

export async function syncUpdateTabTether(input: {
  tabId: string;
  tetherMode: TetherMode;
  seriesPattern?: SeriesTetherPattern;
}): Promise<TrackedTab | null> {
  const existing = await findSyncedTab(input.tabId);
  if (!existing) return null;

  const state = await getLocalState();
  if (state.syncModes.online && (await getCloudCredentials())) {
    const tab = await updateCloudTabTether(input.tabId, input.tetherMode, input.seriesPattern);
    if (!tab) return null;
    const merged: TrackedTab = {
      ...tab,
      tetherMode: input.tetherMode,
      seriesPattern: input.seriesPattern,
    };
    await persistCachedTab(merged);
    if (state.syncModes.lan) void broadcastLanTabEvent({ type: "tab_updated", tab: merged });
    return merged;
  }

  const updated: TrackedTab = {
    ...existing,
    tetherMode: input.tetherMode,
    seriesPattern: input.seriesPattern,
    lastUpdatedAt: new Date().toISOString(),
  };
  await persistCachedTab(updated);
  if (state.syncModes.lan) void broadcastLanTabEvent({ type: "tab_updated", tab: updated });
  return updated;
}

export async function syncRenameTab(
  tabId: string,
  name: string,
  emoji?: string | null,
  tags?: string[],
  groupId?: string | null,
  isPrivate?: boolean,
): Promise<TrackedTab | null> {
  const state = await getLocalState();
  if (await getCloudCredentials()) {
    const tab = await renameCloudTab(tabId, name, emoji, tags, groupId, isPrivate);
    if (tab) {
      await persistCachedTab({
        ...tab,
        tags: tags ?? tab.tags,
        groupId: groupId ?? tab.groupId,
        isPrivate: isPrivate ?? tab.isPrivate,
      });
    }
    if (tab && state.syncModes.lan) void broadcastLanTabEvent({ type: "tab_updated", tab });
    return tab;
  }
  let tab = await renameOfflineTab(tabId, name, emoji, tags, groupId, isPrivate);

  if (tab && state.syncModes.lan) {
    void broadcastLanTabEvent({ type: "tab_updated", tab });
  }

  return tab;
}

export async function syncDeleteTab(tabId: string) {
  const state = await getLocalState();
  if (await getCloudCredentials()) {
    await deleteCloudTab(tabId);
    if (state.syncModes.lan) void broadcastLanTabEvent({ type: "tab_deleted", tabId });
    return;
  }
  await deleteOfflineTab(tabId);

  await setLocalState({
    cachedTabs: (await getLocalState()).cachedTabs.filter((t) => t.id !== tabId),
  });

  if (state.syncModes.lan) {
    void broadcastLanTabEvent({ type: "tab_deleted", tabId });
  }
}

export async function syncTakeOver(tabId: string): Promise<TrackedTab | null> {
  const state = await getLocalState();
  if (await getCloudCredentials()) {
    const tab = await takeOverCloudTab(tabId);
    if (tab && state.syncModes.lan) void broadcastLanTabEvent({ type: "tab_updated", tab });
    return tab;
  }
  const deviceId = await getEffectiveDeviceId();
  const deviceName = await getEffectiveDeviceName();
  let tab = await takeOverOfflineTab(tabId, deviceId, deviceName);

  if (tab && state.syncModes.lan) {
    void broadcastLanTabEvent({ type: "tab_updated", tab });
  }

  return tab;
}

export async function applyPeerTabUpdate(tab: TrackedTab) {
  const state = await getLocalState();
  if (state.syncModes.offline || state.syncModes.lan) {
    await mergeOfflineTabFromPeer(tab);
  } else {
    await setLocalState({
      cachedTabs: mergeTabList(state, tab),
    });
  }
}

function mergeTabList(state: { cachedTabs: TrackedTab[] }, tab: TrackedTab) {
  const exists = state.cachedTabs.some((t) => t.id === tab.id);
  return exists
    ? state.cachedTabs.map((t) => (t.id === tab.id ? tab : t))
    : [tab, ...state.cachedTabs];
}
