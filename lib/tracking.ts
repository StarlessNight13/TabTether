import { hasSameHostname } from "./url-pattern";
import {
  createInitialSeriesPattern,
  defaultTetherMode,
  evaluateSeriesTether,
  applyManualSeriesPatterns,
} from "./tether-series";
import type { SeriesTetherPattern, TetherMode } from "./tether-series";
import { ensureLocalDeviceId, getEffectiveDeviceId } from "./local-device";
import { displayHostPath, isExcludedHost, isTrackableUrl, sanitizeUrl } from "./privacy";
import { clearCloudHistory } from "../db/cloud-management";
import { getCloudCredentials } from "../storage/cloud-configuration";
import { releaseOfflineTab, clearOfflineHistory } from "./sync/offline-store";
import {
  syncCreateTab,
  syncDeleteTab,
  syncRenameTab,
  syncTakeOver,
  syncUpdateTabLocation,
  syncUpdateTabSeriesPattern,
  syncUpdateTabTether,
  findSyncedTab,
  listKnownTrackedTabs,
} from "./sync/router";
import { getLocalState, setLocalState } from "./storage";
import { stripTrackedTabBadge } from "./title-badge";
import type { ReconnectCandidate, SyncModes, TrackedTab } from "./types";
import {
  claimSessionRestoredBindings,
  matchRestoredBindings,
  reconnectCandidateMatchesTab,
  tabRestoreUrl,
  type RestorableBrowserTab,
} from "./restore-bindings";
import { buildRestoreFingerprint } from "./restore-fingerprint";
import {
  clearTabActivityId,
  readTabActivityId,
  writeTabActivityId,
} from "./tab-session-binding";
import { markActivitySeen } from "./watchlist";

type TitleBadgeMessage =
  | { type: "SET_TRACKED_TITLE_BADGE"; emoji?: string | null }
  | { type: "CLEAR_TRACKED_TITLE_BADGE" };

function bindingKey(tabId: number) {
  return String(tabId);
}

async function sendTitleBadgeMessage(tabId: number, message: TitleBadgeMessage) {
  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch {
    // Content script may not be ready yet or page may reject injection.
  }
}

async function applyTrackedTitleBadge(tabId: number, emoji?: string | null) {
  await sendTitleBadgeMessage(tabId, { type: "SET_TRACKED_TITLE_BADGE", emoji });
}

async function clearTrackedTitleBadge(tabId: number) {
  await sendTitleBadgeMessage(tabId, { type: "CLEAR_TRACKED_TITLE_BADGE" });
}

function getBoundTabIds(bindings: Record<string, string>, trackedTabId: string) {
  return Object.entries(bindings)
    .filter(([, id]) => id === trackedTabId)
    .map(([tabId]) => Number(tabId))
    .filter((tabId) => Number.isInteger(tabId));
}

async function captureRestoreFingerprint(
  tabId: number,
  trackedTabId: string,
  overrides?: { url?: string; title?: string | null; emoji?: string | null },
) {
  try {
    const [tab, allTabs, state, tracked] = await Promise.all([
      browser.tabs.get(tabId),
      browser.tabs.query({}),
      getLocalState(),
      findSyncedTab(trackedTabId),
    ]);
    const fingerprint = buildRestoreFingerprint({
      tab,
      allTabs,
      settings: state.settings,
      bindings: { ...state.bindings, [bindingKey(tabId)]: trackedTabId },
      emoji: overrides?.emoji ?? tracked?.emoji,
      urlOverride: overrides?.url,
      titleOverride: overrides?.title,
    });
    if (!fingerprint) return;
    await setLocalState({
      restoreFingerprints: {
        ...state.restoreFingerprints,
        [trackedTabId]: fingerprint,
      },
    });
  } catch (error) {
    console.warn("Failed to capture restore fingerprint", error);
  }
}

export async function refreshRestoreFingerprintForTab(tabId: number) {
  const trackedTabId = await getBindingForTab(tabId);
  if (!trackedTabId) return;
  await captureRestoreFingerprint(tabId, trackedTabId);
}

export function canUseTrackingFeaturesFrom(
  syncModes: SyncModes,
  hasCloudCredentials: boolean,
): boolean {
  if (syncModes.offline || syncModes.lan) return true;
  return Boolean(syncModes.online && hasCloudCredentials);
}

export function trackingFeaturesDisabledReasonFrom(
  syncModes: SyncModes,
  hasCloudCredentials: boolean,
): string | null {
  if (canUseTrackingFeaturesFrom(syncModes, hasCloudCredentials)) return null;
  if (syncModes.online && !hasCloudCredentials) {
    return "Connect a cloud database to tether tabs in Online mode";
  }
  return "Enable Offline, LAN, or Online sync in settings";
}

export async function canUseTrackingFeatures() {
  const state = await getLocalState();
  const hasCloud = Boolean(await getCloudCredentials());
  return canUseTrackingFeaturesFrom(state.syncModes, hasCloud);
}

export async function trackingFeaturesDisabledReason() {
  const state = await getLocalState();
  const hasCloud = Boolean(await getCloudCredentials());
  return trackingFeaturesDisabledReasonFrom(state.syncModes, hasCloud);
}

export async function refreshCachedTabs() {
  return listKnownTrackedTabs();
}

export async function syncSettings() {
  const state = await getLocalState();
  return state.settings;
}

export async function getBindingForTab(tabId: number) {
  const state = await getLocalState();
  return state.bindings[bindingKey(tabId)] ?? null;
}

export async function setBinding(tabId: number, trackedTabId: string) {
  const state = await getLocalState();
  await setLocalState({
    bindings: { ...state.bindings, [bindingKey(tabId)]: trackedTabId },
  });
  await writeTabActivityId(tabId, trackedTabId);
  await captureRestoreFingerprint(tabId, trackedTabId);
}

export async function clearBinding(tabId: number) {
  const state = await getLocalState();
  const next = { ...state.bindings };
  delete next[bindingKey(tabId)];
  await setLocalState({ bindings: next });
}

/** Clears local binding and Firefox session metadata (manual unbind / destroy). */
export async function clearBindingWithSession(tabId: number) {
  await clearTabActivityId(tabId);
  await clearBinding(tabId);
}

export async function clearBindingsForTrackedTab(trackedTabId: string) {
  const state = await getLocalState();
  const boundTabIds = getBoundTabIds(state.bindings, trackedTabId);
  await Promise.all(boundTabIds.map((tabId) => clearTabActivityId(tabId)));
  const next: Record<string, string> = {};
  for (const [tabId, id] of Object.entries(state.bindings)) {
    if (id !== trackedTabId) next[tabId] = id;
  }
  const fingerprints = { ...state.restoreFingerprints };
  delete fingerprints[trackedTabId];
  await setLocalState({ bindings: next, restoreFingerprints: fingerprints });
}

export async function releaseTrackedTabBindings(trackedTabId: string) {
  const state = await getLocalState();
  await Promise.all(
    getBoundTabIds(state.bindings, trackedTabId).map((tabId) => clearTrackedTitleBadge(tabId)),
  );
  await clearBindingsForTrackedTab(trackedTabId);
}

export async function trackCurrentTab(
  tabId: number,
  name?: string,
  emoji?: string,
  tetherMode: TetherMode = defaultTetherMode(),
  existingTrackedTabId?: string,
) {
  if (existingTrackedTabId) {
    return bindTabToActivity(tabId, existingTrackedTabId);
  }

  const tab = await browser.tabs.get(tabId);
  if (!isTrackableUrl(tab.url)) {
    throw new Error("This page cannot be tethered");
  }

  const state = await getLocalState();
  if (!(await canUseTrackingFeatures())) {
    throw new Error(
      (await trackingFeaturesDisabledReason()) ?? "Tab tethering is not available",
    );
  }

  const url = sanitizeUrl(tab.url!, state.settings);
  if (isExcludedHost(url, state.settings.excludedHosts)) {
    throw new Error("This website is excluded from tab tethering");
  }

  await ensureLocalDeviceId();

  const created = await syncCreateTab({
    name: name?.trim() || tab.title?.trim() || displayHostPath(url),
    emoji,
    url,
    title: tab.title ?? null,
    tetherMode,
    seriesPattern:
      tetherMode === "series" ? createInitialSeriesPattern(url, tab.title ?? null) : undefined,
  });

  await setBinding(tabId, created.id);
  await applyTrackedTitleBadge(tabId, created.emoji);
  await markActivitySeen(created.id, created.currentUrl);
  return created;
}

export async function bindTabToActivity(tabId: number, trackedTabId: string) {
  const tab = await browser.tabs.get(tabId);
  if (!isTrackableUrl(tab.url)) {
    throw new Error("This page cannot be tethered");
  }

  if (!(await canUseTrackingFeatures())) {
    throw new Error(
      (await trackingFeaturesDisabledReason()) ?? "Tab tethering is not available",
    );
  }

  const state = await getLocalState();
  const tracked = await findSyncedTab(trackedTabId);
  if (!tracked) throw new Error("Tethered activity not found");

  const existingBinding = state.bindings[bindingKey(tabId)];
  if (existingBinding === trackedTabId) {
    await writeTabActivityId(tabId, trackedTabId);
    return tracked;
  }

  await setBinding(tabId, trackedTabId);
  await applyTrackedTitleBadge(tabId, tracked.emoji);
  await markActivitySeen(trackedTabId, tracked.currentUrl);
  return tracked;
}

export async function unbindTab(tabId: number) {
  const state = await getLocalState();
  const trackedTabId = state.bindings[bindingKey(tabId)];
  if (!trackedTabId) return null;

  await clearTrackedTitleBadge(tabId);
  await clearBindingWithSession(tabId);

  const stillBound = Object.values((await getLocalState()).bindings).includes(trackedTabId);
  if (!stillBound) {
    const deviceId = await getEffectiveDeviceId();
    try {
      if (trackedTabId.startsWith("local_")) {
        await releaseOfflineTab(trackedTabId, deviceId);
      }
    } catch (error) {
      console.warn("Failed to release tracked tab", error);
    }
  }

  return state.cachedTabs.find((entry) => entry.id === trackedTabId) ?? null;
}

export async function stopTracking(trackedTabId: string) {
  const state = await getLocalState();
  await Promise.all(getBoundTabIds(state.bindings, trackedTabId).map(clearTrackedTitleBadge));
  await syncDeleteTab(trackedTabId);
  await clearBindingsForTrackedTab(trackedTabId);
}

export async function renameTrackedTab(
  id: string,
  name: string,
  emoji?: string | null,
  tags?: string[],
  groupId?: string | null,
  isPrivate?: boolean,
) {
  const existing = await findSyncedTab(id);
  const updated = await syncRenameTab(id, name, emoji, tags, groupId, isPrivate);
  if (!updated) throw new Error("Tethered tab not found");

  if (isPrivate === true && existing && !existing.isPrivate) {
    if (await getCloudCredentials()) {
      await clearCloudHistory(id);
    } else {
      await clearOfflineHistory(id);
    }
  }

  const state = await getLocalState();
  await Promise.all(
    getBoundTabIds(state.bindings, id).map((tabId) => applyTrackedTitleBadge(tabId, updated.emoji)),
  );
  return updated;
}

export async function takeOver(trackedTabId: string, browserTabId?: number) {
  await ensureLocalDeviceId();

  const updated = await syncTakeOver(trackedTabId);
  if (!updated) throw new Error("Tethered tab not found");

  if (browserTabId !== undefined) {
    await setBinding(browserTabId, trackedTabId);
    await applyTrackedTitleBadge(browserTabId, updated.emoji);
  }
  return updated;
}

export async function updateSeriesTether(input: {
  trackedTabId: string;
  tetherMode?: TetherMode;
  urlPattern?: string;
  titlePattern?: string;
  resetLearning?: boolean;
}) {
  const tab = await findSyncedTab(input.trackedTabId);
  if (!tab) throw new Error("Tethered tab not found");

  let tetherMode = input.tetherMode ?? tab.tetherMode ?? defaultTetherMode();
  let seriesPattern = tab.seriesPattern;

  if (input.tetherMode === "loose") {
    seriesPattern = undefined;
  } else if (input.resetLearning) {
    tetherMode = "series";
    seriesPattern = createInitialSeriesPattern(tab.currentUrl, tab.currentTitle);
  } else if (input.urlPattern !== undefined || input.titlePattern !== undefined) {
    if (!seriesPattern) {
      seriesPattern = createInitialSeriesPattern(tab.currentUrl, tab.currentTitle);
    }
    seriesPattern = applyManualSeriesPatterns({
      pattern: seriesPattern,
      urlPattern: input.urlPattern,
      titlePattern: input.titlePattern,
    });
    tetherMode = "series";
  } else if (input.tetherMode === "series" && !seriesPattern) {
    tetherMode = "series";
    seriesPattern = createInitialSeriesPattern(tab.currentUrl, tab.currentTitle);
  }

  const updated = await syncUpdateTabTether({
    tabId: input.trackedTabId,
    tetherMode,
    seriesPattern,
  });
  if (!updated) throw new Error("Tethered tab not found");
  return updated;
}

export async function openTrackedTab(tracked: TrackedTab, takeOverOwnership = false) {
  const created = await browser.tabs.create({ url: tracked.currentUrl, active: true });
  if (created.id === undefined) return tracked;

  if (takeOverOwnership) {
    await takeOver(tracked.id, created.id);
  } else {
    await setBinding(created.id, tracked.id);
  }
  await markActivitySeen(tracked.id, tracked.currentUrl);
  return tracked;
}

export async function handleTabUpdate(tabId: number, url?: string, title?: string) {
  let currentTab: { id?: number; url?: string; pendingUrl?: string; title?: string };
  try {
    currentTab = await browser.tabs.get(tabId);
  } catch {
    currentTab = { id: tabId, url, title };
  }
  await prunePendingReconnectForTab(tabId, currentTab);

  if (await isRestoreWindowActive()) {
    await considerRestoredTab(currentTab);
  }

  const state = await getLocalState();
  const trackedTabId = state.bindings[bindingKey(tabId)];
  if (!trackedTabId) return;
  let tracked = state.cachedTabs.find((tab) => tab.id === trackedTabId);
  if (!tracked) tracked = (await findSyncedTab(trackedTabId)) ?? undefined;

  await applyTrackedTitleBadge(tabId, tracked?.emoji);

  if (!url || !isTrackableUrl(url)) return;
  if (!(await canUseTrackingFeatures())) return;

  const sanitized = sanitizeUrl(url, state.settings);
  if (isExcludedHost(sanitized, state.settings.excludedHosts)) return;

  const cleanTitle = stripTrackedTabBadge(title ?? null, tracked?.emoji) ?? null;
  const deviceId = await getEffectiveDeviceId();
  const tetherMode = tracked?.tetherMode ?? defaultTetherMode();
  let seriesPattern: SeriesTetherPattern | undefined = tracked?.seriesPattern;

  if (tetherMode === "loose") {
    // A tracked activity is intentionally confined to the site where it started.
    // This ignores ad hops and off-site redirects without stopping the binding.
    if (tracked && !hasSameHostname(tracked.currentUrl, sanitized)) return;
  } else if (tracked) {
    const decision = evaluateSeriesTether({
      pattern:
        tracked.seriesPattern ??
        createInitialSeriesPattern(tracked.currentUrl, tracked.currentTitle),
      url: sanitized,
      title: cleanTitle,
      previousUrl: tracked.currentUrl,
    });
    if (!decision.shouldSync) return;
    seriesPattern = decision.pattern;
  }

  if (
    tracked &&
    tracked.currentUrl === sanitized &&
    (tracked.currentTitle ?? null) === cleanTitle &&
    tracked.activeDeviceId === deviceId &&
    seriesPattern === tracked.seriesPattern
  ) {
    return;
  }

  try {
    if (seriesPattern && seriesPattern !== tracked?.seriesPattern) {
      await syncUpdateTabSeriesPattern({ tabId: trackedTabId, seriesPattern });
    }
    await syncUpdateTabLocation({
      tabId: trackedTabId,
      url: sanitized,
      title: cleanTitle,
    });
    await captureRestoreFingerprint(tabId, trackedTabId, {
      url: sanitized,
      title: cleanTitle,
      emoji: tracked?.emoji,
    });
    await markActivitySeen(trackedTabId, sanitized, state.settings);
  } catch (error) {
    console.warn("Failed to sync tracked tab location", error);
  }
}

export async function handleTabRemoved(tabId: number) {
  await prunePendingReconnectForTab(tabId);
  const state = await getLocalState();
  const trackedTabId = state.bindings[bindingKey(tabId)];
  if (!trackedTabId) return;

  await clearTrackedTitleBadge(tabId);
  // Keep Firefox session tab values so Undo Close Tab / restart restore can rebind.
  await clearBinding(tabId);

  const deviceId = await getEffectiveDeviceId();
  const stillBound = Object.values((await getLocalState()).bindings).includes(trackedTabId);
  if (!stillBound && !(await isRestoreWindowActive())) {
    try {
      if (trackedTabId.startsWith("local_")) {
        await releaseOfflineTab(trackedTabId, deviceId);
      }
    } catch (error) {
      console.warn("Failed to release tracked tab", error);
    }
  }
}

const RESTORE_WINDOW_MS = 120_000;
const RESTORE_WINDOW_KEY = "restoreWindowUntil";
let memoryRestoreUntil = 0;
let restoreLock: Promise<void> | undefined;

export async function beginRestoreWindow() {
  memoryRestoreUntil = Date.now() + RESTORE_WINDOW_MS;
  try {
    await browser.storage.session.set({ [RESTORE_WINDOW_KEY]: memoryRestoreUntil });
  } catch {
    // session storage is missing in some browsers/tests
  }
}

export async function isRestoreWindowActive() {
  if (Date.now() < memoryRestoreUntil) return true;
  try {
    const stored = await browser.storage.session.get(RESTORE_WINDOW_KEY);
    const until = stored[RESTORE_WINDOW_KEY];
    return typeof until === "number" && Date.now() < until;
  } catch {
    return false;
  }
}

async function withRestoreLock(fn: () => Promise<void>) {
  while (restoreLock) await restoreLock;
  restoreLock = fn()
    .catch((error) => {
      console.warn("Failed to restore tethered tabs", error);
    })
    .finally(() => {
      restoreLock = undefined;
    });
  await restoreLock;
}

function restoreDeviceIds(
  state: { deviceId: string | null; localDeviceId: string | null },
  effectiveId: string,
) {
  return [effectiveId, state.deviceId, state.localDeviceId].filter((id): id is string =>
    Boolean(id),
  );
}

function mergePendingReconnect(existing: ReconnectCandidate[], incoming: ReconnectCandidate[]) {
  const seen = new Set(existing.map((item) => `${item.trackedTabId}:${item.browserTabId}`));
  const merged = [...existing];
  for (const item of incoming) {
    const key = `${item.trackedTabId}:${item.browserTabId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

async function prunePendingReconnectForTab(
  tabId: number,
  tab?: { id?: number; url?: string; pendingUrl?: string },
) {
  const state = await getLocalState();
  const pendingReconnect = state.pendingReconnect.filter(
    (candidate) =>
      candidate.browserTabId !== tabId ||
      (tab !== undefined && reconnectCandidateMatchesTab(candidate, tab, state.settings)),
  );
  if (pendingReconnect.length !== state.pendingReconnect.length) {
    await setLocalState({ pendingReconnect });
  }
}

function shouldClearStaleSessionActivityId(
  activityId: string,
  activities: TrackedTab[],
): boolean {
  const activity = activities.find((tab) => tab.id === activityId);
  if (!activity) return true;
  if (activity.archivedAt || activity.deletedAt) return true;
  // Foreign-owned activities stay attached so a later take-over can still use them.
  return false;
}

function browserTabRestoreFields(tab: RestorableBrowserTab): RestorableBrowserTab {
  return {
    id: tab.id,
    url: tab.url,
    pendingUrl:
      "pendingUrl" in tab && typeof tab.pendingUrl === "string" ? tab.pendingUrl : undefined,
    title: tab.title,
    pinned: tab.pinned,
    index: tab.index,
    windowId: tab.windowId,
    openerTabId: tab.openerTabId,
    lastAccessed: tab.lastAccessed,
    groupId: tab.groupId,
    incognito: tab.incognito,
  };
}

export async function applyBadgeForBrowserTab(tabId: number) {
  const trackedTabId = await getBindingForTab(tabId);
  if (!trackedTabId) return;
  const tracked = await findSyncedTab(trackedTabId);
  await applyTrackedTitleBadge(tabId, tracked?.emoji);
}

export async function considerRestoredTab(tab: {
  id?: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
}) {
  if (!(await isRestoreWindowActive())) return;
  if (tab.id === undefined) return;

  await withRestoreLock(async () => {
    const state = await getLocalState();
    if (state.bindings[bindingKey(tab.id!)]) return;

    const activities = await listKnownTrackedTabs();
    const effectiveId = await getEffectiveDeviceId();
    const deviceIds = restoreDeviceIds(state, effectiveId);
    const alreadyClaimedIds = new Set(Object.values(state.bindings));
    const sessionActivityId = await readTabActivityId(tab.id!);
    const sessionFields = {
      ...browserTabRestoreFields(tab),
      sessionActivityId,
    };
    const { bindings: sessionBindings } = claimSessionRestoredBindings(
      [sessionFields],
      activities.filter((activity) => !alreadyClaimedIds.has(activity.id)),
      state.settings,
      deviceIds,
    );
    const sessionTrackedId = sessionBindings[bindingKey(tab.id!)];
    if (sessionTrackedId) {
      await setBinding(tab.id!, sessionTrackedId);
      const tracked = activities.find((activity) => activity.id === sessionTrackedId);
      await applyTrackedTitleBadge(tab.id!, tracked?.emoji);
      return;
    }
    if (sessionActivityId && shouldClearStaleSessionActivityId(sessionActivityId, activities)) {
      await clearTabActivityId(tab.id!);
    }

    if (!tabRestoreUrl(tab)) return;

    const claimedIds = new Set(Object.values(state.bindings));
    const remainingActivities = activities.filter((activity) => !claimedIds.has(activity.id));
    const { bindings, pending } = matchRestoredBindings(
      [browserTabRestoreFields(tab)],
      remainingActivities,
      state.settings,
      deviceIds,
      state.restoreFingerprints,
      { priorBindings: state.bindings },
    );
    const trackedTabId = bindings[bindingKey(tab.id!)];
    if (!trackedTabId) {
      if (pending.length === 0) return;
      await setLocalState({
        pendingReconnect: mergePendingReconnect(state.pendingReconnect, pending),
      });
      return;
    }

    await setBinding(tab.id!, trackedTabId);
    const tracked = activities.find((activity) => activity.id === trackedTabId);
    await applyTrackedTitleBadge(tab.id!, tracked?.emoji);
  });
}

export async function reconcileRestoredTabs() {
  await beginRestoreWindow();
  await withRestoreLock(async () => {
    const state = await getLocalState();
    const effectiveId = await getEffectiveDeviceId();
    let remoteTabs: TrackedTab[];
    try {
      remoteTabs = await listKnownTrackedTabs();
    } catch {
      remoteTabs = state.cachedTabs;
    }

    const browserTabs = await browser.tabs.query({});
    const deviceIds = restoreDeviceIds(state, effectiveId);
    const liveTabIds = new Set(
      browserTabs.flatMap((tab) => (tab.id === undefined ? [] : [String(tab.id)])),
    );
    const liveBoundActivityIds = new Set(
      Object.entries(state.bindings)
        .filter(([tabId]) => liveTabIds.has(tabId))
        .map(([, trackedId]) => trackedId),
    );

    const tabsWithSession = await Promise.all(
      browserTabs.map(async (tab) => ({
        ...browserTabRestoreFields(tab),
        sessionActivityId: tab.id === undefined ? null : await readTabActivityId(tab.id),
      })),
    );

    const unboundSessionTabs = tabsWithSession.filter(
      (tab) => tab.id !== undefined && !state.bindings[String(tab.id)],
    );

    const { bindings: sessionBindings, claimedActivityIds } = claimSessionRestoredBindings(
      unboundSessionTabs,
      remoteTabs,
      state.settings,
      deviceIds,
    );

    await Promise.all(
      unboundSessionTabs.map(async (tab) => {
        if (tab.id === undefined || !tab.sessionActivityId) return;
        if (sessionBindings[String(tab.id)]) return;
        if (!shouldClearStaleSessionActivityId(tab.sessionActivityId, remoteTabs)) return;
        await clearTabActivityId(tab.id);
      }),
    );

    const unresolvedTabs = unboundSessionTabs.filter(
      (tab) => tab.id !== undefined && !sessionBindings[String(tab.id)],
    );
    const remainingActivities = remoteTabs.filter(
      (activity) =>
        !claimedActivityIds.has(activity.id) && !liveBoundActivityIds.has(activity.id),
    );

    const { bindings: urlBindings, pending } = matchRestoredBindings(
      unresolvedTabs,
      remainingActivities,
      state.settings,
      deviceIds,
      state.restoreFingerprints,
      { priorBindings: { ...state.bindings, ...sessionBindings } },
    );

    const keptBindings: Record<string, string> = {};
    for (const [tabId, trackedId] of Object.entries(state.bindings)) {
      if (liveTabIds.has(tabId) && !sessionBindings[tabId] && !urlBindings[tabId]) {
        keptBindings[tabId] = trackedId;
      }
    }

    const mergedBindings = { ...sessionBindings, ...urlBindings };
    const sawTrackable = browserTabs.some((tab) =>
      Boolean(tabRestoreUrl(tab) && isTrackableUrl(tabRestoreUrl(tab))),
    );
    const sawSessionClaim = Object.keys(sessionBindings).length > 0;
    if (!sawTrackable && !sawSessionClaim && Object.keys(mergedBindings).length === 0) {
      return;
    }

    const nextBindings = { ...keptBindings, ...mergedBindings };
    await setLocalState({
      bindings: nextBindings,
      pendingReconnect: pending,
    });
    await Promise.all(
      Object.entries(nextBindings).map(async ([tabId, trackedId]) => {
        await writeTabActivityId(Number(tabId), trackedId);
        const tracked = remoteTabs.find((tab) => tab.id === trackedId);
        return applyTrackedTitleBadge(Number(tabId), tracked?.emoji);
      }),
    );
  });
}

export async function confirmReconnect(candidate: ReconnectCandidate, takeOverOwnership = true) {
  const state = await getLocalState();
  const pendingCandidate = state.pendingReconnect.find(
    (pending) =>
      pending.trackedTabId === candidate.trackedTabId &&
      pending.browserTabId === candidate.browserTabId,
  );
  if (!pendingCandidate) throw new Error("Reconnect request is no longer available");

  let browserTab: { id?: number; url?: string; pendingUrl?: string } | undefined;
  try {
    browserTab = await browser.tabs.get(candidate.browserTabId);
  } catch {
    // A browser tab can close between rendering the popup and confirming its reconnect prompt.
  }
  if (!browserTab || !reconnectCandidateMatchesTab(pendingCandidate, browserTab, state.settings)) {
    await prunePendingReconnectForTab(pendingCandidate.browserTabId, browserTab);
    throw new Error("Reconnect request is no longer available");
  }

  await setBinding(pendingCandidate.browserTabId, pendingCandidate.trackedTabId);
  if (takeOverOwnership) {
    await takeOver(pendingCandidate.trackedTabId, pendingCandidate.browserTabId);
  }
  const latestState = await getLocalState();
  await setLocalState({
    pendingReconnect: latestState.pendingReconnect.filter(
      (p) =>
        !(
          p.trackedTabId === pendingCandidate.trackedTabId &&
          p.browserTabId === pendingCandidate.browserTabId
        ),
    ),
  });
}

export async function dismissReconnect(candidate: ReconnectCandidate) {
  const state = await getLocalState();
  await setLocalState({
    pendingReconnect: state.pendingReconnect.filter(
      (p) =>
        !(p.trackedTabId === candidate.trackedTabId && p.browserTabId === candidate.browserTabId),
    ),
  });
}
