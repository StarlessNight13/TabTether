import { describe, expect, it } from "bun:test";

import { activityMatchesQuery } from "./activity-search";
import type { TrackedTab } from "./types";

function tab(overrides: Partial<TrackedTab> = {}): TrackedTab {
  return {
    id: "tab_1",
    name: "Manga",
    emoji: "📚",
    tags: ["reading", "weekly"],
    groupId: "g1",
    group: { id: "g1", name: "Series" },
    currentUrl: "https://example.com/ch/12",
    currentTitle: "Chapter 12",
    activeDeviceId: "dev_1",
    lastUpdatedDeviceId: "dev_1",
    lastUpdatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    archivedAt: null,
    isPrivate: false,
    activeDevice: { id: "dev_1", name: "Laptop", browser: "Chrome" },
    lastUpdatedDevice: { id: "dev_1", name: "Laptop", browser: "Chrome" },
    ...overrides,
  };
}

describe("activityMatchesQuery", () => {
  it("matches empty query", () => {
    expect(activityMatchesQuery(tab(), "")).toBe(true);
  });

  it("matches name, url, tags, and group", () => {
    expect(activityMatchesQuery(tab(), "manga")).toBe(true);
    expect(activityMatchesQuery(tab(), "ch/12")).toBe(true);
    expect(activityMatchesQuery(tab(), "weekly")).toBe(true);
    expect(activityMatchesQuery(tab(), "series")).toBe(true);
    expect(activityMatchesQuery(tab(), "laptop")).toBe(true);
  });

  it("rejects non-matches", () => {
    expect(activityMatchesQuery(tab(), "podcast")).toBe(false);
  });
});
