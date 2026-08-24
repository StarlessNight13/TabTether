import { describe, expect, it } from "vitest";

import { restoreMatchKey } from "./restore-bindings";
import {
  buildCatchUpItems,
  isCatchUpCandidate,
  rankTabsForResume,
  resumeRankScore,
} from "./catch-up";
import { DEFAULT_SETTINGS, type TrackedTab } from "./types";

function tab(overrides: Partial<TrackedTab> & Pick<TrackedTab, "id" | "name" | "currentUrl">): TrackedTab {
  return {
    emoji: null,
    tags: [],
    groupId: null,
    group: null,
    currentTitle: null,
    activeDeviceId: "dev_1",
    lastUpdatedDeviceId: "dev_1",
    lastUpdatedAt: "2026-01-02T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    isPrivate: false,
    activeDevice: null,
    lastUpdatedDevice: null,
    ...overrides,
  };
}

function seen(url: string) {
  return {
    urlKey: restoreMatchKey(url, DEFAULT_SETTINGS)!,
    url,
    seenAt: "2026-01-01T12:00:00.000Z",
  };
}

describe("catch-up", () => {
  const settings = DEFAULT_SETTINGS;

  it("detects watched activities that moved past the last seen URL", () => {
    const novel = tab({
      id: "tab_1",
      name: "Novel",
      currentUrl: "https://example.com/chapter/511",
    });
    expect(
      isCatchUpCandidate({
        tab: novel,
        watchedActivityIds: ["tab_1"],
        lastSeenOnDevice: {
          tab_1: seen("https://example.com/chapter/500"),
        },
        settings,
      }),
    ).toBe(true);
  });

  it("builds catch-up items with chapter distance", () => {
    const items = buildCatchUpItems({
      tabs: [
        tab({
          id: "tab_1",
          name: "Novel",
          emoji: "📖",
          currentUrl: "https://example.com/chapter/511",
        }),
      ],
      watchedActivityIds: ["tab_1"],
      lastSeenOnDevice: {
        tab_1: seen("https://example.com/chapter/500"),
      },
      settings,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.chaptersBehind).toBe(11);
    expect(items[0]?.progressLabel).toBe("11 chapters behind");
  });

  it("ranks catch-up and watched activities first", () => {
    const stale = tab({
      id: "a",
      name: "A",
      currentUrl: "https://example.com/a",
      lastUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
    const watched = tab({
      id: "b",
      name: "B",
      currentUrl: "https://example.com/b",
      lastUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
    const catchUp = tab({
      id: "c",
      name: "C",
      currentUrl: "https://example.com/c",
      lastUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
    const ranked = rankTabsForResume([stale, watched, catchUp], {
      watchedActivityIds: ["b", "c"],
      catchUpIds: new Set(["c"]),
      boundTabCounts: {},
    });
    expect(ranked.map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(
      resumeRankScore({
        tab: catchUp,
        watchedActivityIds: ["c"],
        catchUpIds: new Set(["c"]),
        boundTabCounts: {},
      }),
    ).toBeGreaterThan(1_000_000);
  });
});
