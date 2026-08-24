import type { TrackedTab } from "./types";

function hasSeriesTether(tab: TrackedTab): boolean {
  return tab.tetherMode === "series" || Boolean(tab.seriesPattern);
}

/**
 * Merge cloud/peer tab state with a local cached overlay.
 * Prefer explicit series tether from either side; otherwise keep cloud fields.
 */
export function withLocalTether(tab: TrackedTab, local?: TrackedTab | null): TrackedTab {
  if (!local) return tab;
  if (hasSeriesTether(tab)) {
    return {
      ...tab,
      tetherMode: tab.tetherMode ?? local.tetherMode,
      seriesPattern: tab.seriesPattern ?? local.seriesPattern,
    };
  }
  return {
    ...tab,
    tetherMode: local.tetherMode ?? tab.tetherMode,
    seriesPattern: local.seriesPattern ?? tab.seriesPattern,
  };
}
