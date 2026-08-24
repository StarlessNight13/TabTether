import { computeMovedOnProgress, formatChaptersBehind } from "./moved-on-progress";
import { restoreMatchKey } from "./restore-bindings";
import type { PrivacySettings, TrackedTab } from "./types";

export type LastSeenEntry = {
  urlKey: string;
  url: string;
  seenAt: string;
};

export type CatchUpItem = {
  trackedTabId: string;
  name: string;
  emoji: string | null;
  currentUrl: string;
  lastSeenUrl: string;
  lastSeenAt: string;
  chaptersBehind: number | null;
  progressLabel: string | null;
};

export function isActivityWatched(watchedActivityIds: string[], trackedTabId: string): boolean {
  return watchedActivityIds.includes(trackedTabId);
}

export function isCatchUpCandidate(options: {
  tab: TrackedTab;
  watchedActivityIds: string[];
  lastSeenOnDevice: Record<string, LastSeenEntry>;
  settings: PrivacySettings;
}): boolean {
  const { tab, watchedActivityIds, lastSeenOnDevice, settings } = options;
  if (tab.archivedAt || tab.deletedAt) return false;
  if (!isActivityWatched(watchedActivityIds, tab.id)) return false;
  const seen = lastSeenOnDevice[tab.id];
  if (!seen) return false;
  const currentKey = restoreMatchKey(tab.currentUrl, settings);
  return Boolean(currentKey && currentKey !== seen.urlKey);
}

export function buildCatchUpItems(options: {
  tabs: TrackedTab[];
  watchedActivityIds: string[];
  lastSeenOnDevice: Record<string, LastSeenEntry>;
  settings: PrivacySettings;
  historyByActivity?: Record<string, Array<{ url: string }>>;
}): CatchUpItem[] {
  const items: CatchUpItem[] = [];
  for (const tab of options.tabs) {
    if (
      !isCatchUpCandidate({
        tab,
        watchedActivityIds: options.watchedActivityIds,
        lastSeenOnDevice: options.lastSeenOnDevice,
        settings: options.settings,
      })
    ) {
      continue;
    }
    const seen = options.lastSeenOnDevice[tab.id]!;
    const historyUrls = (options.historyByActivity?.[tab.id] ?? []).map((entry) => entry.url);
    const progress = computeMovedOnProgress(seen.url, tab.currentUrl, historyUrls);
    items.push({
      trackedTabId: tab.id,
      name: tab.name,
      emoji: tab.emoji,
      currentUrl: tab.currentUrl,
      lastSeenUrl: seen.url,
      lastSeenAt: seen.seenAt,
      chaptersBehind: progress.chaptersBehind,
      progressLabel: formatChaptersBehind(progress.chaptersBehind),
    });
  }
  return items.toSorted(
    (a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt) || a.name.localeCompare(b.name),
  );
}

export function resumeRankScore(options: {
  tab: TrackedTab;
  watchedActivityIds: string[];
  catchUpIds: ReadonlySet<string>;
  boundTabCounts: Record<string, number>;
}): number {
  const { tab, watchedActivityIds, catchUpIds, boundTabCounts } = options;
  let score = Date.parse(tab.lastUpdatedAt) || 0;
  if (catchUpIds.has(tab.id)) score += 1_000_000;
  if (isActivityWatched(watchedActivityIds, tab.id)) score += 100_000;
  if ((boundTabCounts[tab.id] ?? 0) > 0) score += 10_000;
  if (tab.health?.ownershipConflict) score += 5_000;
  if (tab.health?.stale) score += 1_000;
  return score;
}

export function rankTabsForResume(
  tabs: TrackedTab[],
  options: {
    watchedActivityIds: string[];
    catchUpIds: ReadonlySet<string>;
    boundTabCounts: Record<string, number>;
  },
): TrackedTab[] {
  return tabs.toSorted(
    (a, b) =>
      resumeRankScore({ tab: b, ...options }) - resumeRankScore({ tab: a, ...options }),
  );
}
