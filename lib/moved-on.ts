import { restoreMatchKey } from "./restore-bindings";
import { computeMovedOnProgress } from "./moved-on-progress";
import type { HistoryEntry, PrivacySettings, TrackedTab } from "./types";

export type MovedOnMatch = {
  trackedTabId: string;
  name: string;
  emoji: string | null;
  currentUrl: string;
  currentTitle: string | null;
  pageUrl: string;
  chaptersBehind: number | null;
  pageLabel: string | null;
  currentLabel: string | null;
  /** Recent history stops (newest first) for jump list UI. */
  recentStops: Array<{ url: string; title: string | null }>;
};

export function movedOnDismissKey(
  trackedTabId: string,
  pageUrlKey: string,
  currentUrlKey: string,
): string {
  return `${trackedTabId}|${pageUrlKey}|${currentUrlKey}`;
}

function isActiveActivity(tab: TrackedTab): boolean {
  return !tab.archivedAt && !tab.deletedAt;
}

function historyContainsUrl(
  entries: HistoryEntry[] | undefined,
  pageKey: string,
  settings: PrivacySettings,
): boolean {
  if (!entries?.length) return false;
  return entries.some((entry) => restoreMatchKey(entry.url, settings) === pageKey);
}

/**
 * Find a tethered activity that has moved past `pageUrl`.
 * The page must appear in that activity's history (or match an explicit prior URL),
 * and must not be the activity's current URL.
 */
export function findMovedOnMatch(options: {
  pageUrl: string;
  activities: TrackedTab[];
  localHistory: Record<string, HistoryEntry[]>;
  settings: PrivacySettings;
  dismissedKeys?: ReadonlySet<string>;
  /** Extra prior URLs per activity (e.g. cloud history) already keyed by activity id. */
  extraHistory?: Record<string, HistoryEntry[]>;
}): MovedOnMatch | null {
  const { pageUrl, activities, localHistory, settings, dismissedKeys, extraHistory } = options;
  if (!settings.showMovedOnBanner) return null;

  const pageKey = restoreMatchKey(pageUrl, settings);
  if (!pageKey) return null;

  let best: MovedOnMatch | null = null;
  let bestUpdatedAt = 0;

  for (const activity of activities) {
    if (!isActiveActivity(activity)) continue;

    const currentKey = restoreMatchKey(activity.currentUrl, settings);
    if (!currentKey || currentKey === pageKey) continue;

    const inLocal = historyContainsUrl(localHistory[activity.id], pageKey, settings);
    const inExtra = historyContainsUrl(extraHistory?.[activity.id], pageKey, settings);
    if (!inLocal && !inExtra) continue;

    const dismissKey = movedOnDismissKey(activity.id, pageKey, currentKey);
    if (dismissedKeys?.has(dismissKey)) continue;

    const updatedAt = new Date(activity.lastUpdatedAt).getTime();
    if (!best || updatedAt > bestUpdatedAt) {
      bestUpdatedAt = updatedAt;
      const historyEntries = [
        ...(extraHistory?.[activity.id] ?? []),
        ...(localHistory[activity.id] ?? []),
      ];
      const historyUrls = historyEntries.map((entry) => entry.url);
      const progress = computeMovedOnProgress(pageUrl, activity.currentUrl, historyUrls);
      const seenStops = new Set<string>();
      const recentStops: Array<{ url: string; title: string | null }> = [];
      for (const entry of historyEntries) {
        const key = restoreMatchKey(entry.url, settings);
        if (!key || key === pageKey || key === currentKey) continue;
        if (seenStops.has(key)) continue;
        seenStops.add(key);
        recentStops.push({ url: entry.url, title: entry.title });
        if (recentStops.length >= 5) break;
      }
      best = {
        trackedTabId: activity.id,
        name: activity.name,
        emoji: activity.emoji,
        currentUrl: activity.currentUrl,
        currentTitle: activity.currentTitle,
        pageUrl,
        chaptersBehind: progress.chaptersBehind,
        pageLabel: progress.pageLabel,
        currentLabel: progress.currentLabel,
        recentStops,
      };
    }
  }

  return best;
}
