import { describe, expect, it } from "vitest";

import { withLocalTether } from "./tether-overlay";
import type { TrackedTab } from "./types";

function tab(overrides: Partial<TrackedTab> = {}): TrackedTab {
  return {
    id: "tab_1",
    name: "Reader",
    emoji: null,
    tags: [],
    groupId: null,
    group: null,
    currentUrl: "https://reader.test/ch/1",
    currentTitle: "Chapter 1",
    activeDeviceId: "dev_1",
    lastUpdatedDeviceId: "dev_1",
    lastUpdatedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    isPrivate: false,
    activeDevice: null,
    lastUpdatedDevice: null,
    ...overrides,
  };
}

describe("withLocalTether", () => {
  it("keeps the cloud tab unchanged when there is no local overlay", () => {
    const cloud = tab();
    expect(withLocalTether(cloud)).toBe(cloud);
  });

  it("copies series tether fields from the local overlay without losing cloud URL state", () => {
    const cloud = tab({ currentUrl: "https://reader.test/ch/4", tetherMode: "loose" });
    const local = tab({
      currentUrl: "https://reader.test/ch/1",
      tetherMode: "series",
      seriesPattern: {
        status: "learning",
        anchorHostname: "reader.test",
        observations: [],
        navigationCount: 1,
        stableTokens: [],
        changingHints: [],
      },
    });

    expect(withLocalTether(cloud, local)).toMatchObject({
      currentUrl: "https://reader.test/ch/4",
      tetherMode: "series",
      seriesPattern: local.seriesPattern,
    });
  });

  it("prefers synced cloud series over a stale local loose overlay", () => {
    const cloud = tab({
      currentUrl: "https://reader.test/ch/4",
      tetherMode: "series",
      seriesPattern: {
        status: "ready",
        anchorHostname: "reader.test",
        observations: [],
        navigationCount: 3,
        urlPattern: "^/ch/\\d+$",
        stableTokens: ["/ch/"],
        changingHints: ["1", "2", "3"],
      },
    });
    const local = tab({
      tetherMode: "loose",
      seriesPattern: undefined,
    });

    expect(withLocalTether(cloud, local)).toMatchObject({
      tetherMode: "series",
      seriesPattern: cloud.seriesPattern,
    });
  });
});
