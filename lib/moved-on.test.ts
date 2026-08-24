import { describe, expect, it } from "vitest";

import { findMovedOnMatch, movedOnDismissKey } from "./moved-on";
import { restoreMatchKey } from "./restore-bindings";
import { DEFAULT_SETTINGS, type HistoryEntry, type TrackedTab } from "./types";

function activity(overrides: Partial<TrackedTab> & Pick<TrackedTab, "id" | "name" | "currentUrl">): TrackedTab {
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

function entry(url: string, visitedAt = "2026-01-01T12:00:00.000Z"): HistoryEntry {
  return { id: `h_${url}`, url, title: null, visitedAt };
}

describe("findMovedOnMatch", () => {
  const settings = { ...DEFAULT_SETTINGS, showMovedOnBanner: true };

  it("returns a match when the page is in history but not current", () => {
    const novel = activity({
      id: "tab_1",
      name: "Novel",
      emoji: "📖",
      currentUrl: "https://example.com/chapter/511",
    });
    const match = findMovedOnMatch({
      pageUrl: "https://example.com/chapter/500",
      activities: [novel],
      localHistory: {
        tab_1: [entry("https://example.com/chapter/511"), entry("https://example.com/chapter/500")],
      },
      settings,
    });
    expect(match).toEqual({
      trackedTabId: "tab_1",
      name: "Novel",
      emoji: "📖",
      currentUrl: "https://example.com/chapter/511",
      currentTitle: null,
      pageUrl: "https://example.com/chapter/500",
      chaptersBehind: 11,
      pageLabel: "500",
      currentLabel: "511",
      recentStops: [],
    });
  });

  it("does not match when the page is the current tether URL", () => {
    const novel = activity({
      id: "tab_1",
      name: "Novel",
      currentUrl: "https://example.com/chapter/500",
    });
    expect(
      findMovedOnMatch({
        pageUrl: "https://www.example.com/chapter/500/",
        activities: [novel],
        localHistory: {
          tab_1: [entry("https://example.com/chapter/500")],
        },
        settings,
      }),
    ).toBeNull();
  });

  it("respects dismissals for the current destination", () => {
    const novel = activity({
      id: "tab_1",
      name: "Novel",
      currentUrl: "https://example.com/chapter/511",
    });
    const pageUrl = "https://example.com/chapter/500";
    const pageKey = restoreMatchKey(pageUrl, settings)!;
    const currentKey = restoreMatchKey(novel.currentUrl, settings)!;
    expect(
      findMovedOnMatch({
        pageUrl,
        activities: [novel],
        localHistory: { tab_1: [entry(pageUrl)] },
        settings,
        dismissedKeys: new Set([movedOnDismissKey("tab_1", pageKey, currentKey)]),
      }),
    ).toBeNull();
  });

  it("is disabled when the setting is off", () => {
    const novel = activity({
      id: "tab_1",
      name: "Novel",
      currentUrl: "https://example.com/chapter/511",
    });
    expect(
      findMovedOnMatch({
        pageUrl: "https://example.com/chapter/500",
        activities: [novel],
        localHistory: { tab_1: [entry("https://example.com/chapter/500")] },
        settings: { ...settings, showMovedOnBanner: false },
      }),
    ).toBeNull();
  });
});
