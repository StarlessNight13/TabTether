import type { TrackedTab } from "./types";

/** Case-insensitive match across name, title, URL, tags, devices, and group. */
export function activityMatchesQuery(tab: TrackedTab, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const haystack = [
    tab.name,
    tab.emoji ?? "",
    tab.currentTitle ?? "",
    tab.currentUrl,
    ...tab.tags,
    tab.group?.name ?? "",
    tab.activeDevice?.name ?? "",
    tab.lastUpdatedDevice?.name ?? "",
  ]
    .join(" ")
    .toLocaleLowerCase();
  return haystack.includes(normalized);
}
