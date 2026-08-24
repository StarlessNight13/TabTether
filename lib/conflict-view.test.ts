import { describe, expect, it } from "bun:test";

import {
  conflictActionsFor,
  isStoredConflict,
  summarizeMinePayload,
  summarizeTheirs,
  toConflictView,
  type StoredConflict,
} from "./conflict-view";
import type { TrackedTabRecord } from "../core/entities";

function tab(overrides: Partial<TrackedTabRecord> = {}): TrackedTabRecord {
  return {
    id: "tab_1",
    workspaceId: "ws_1",
    groupId: null,
    name: "Manga",
    emoji: null,
    tags: "[]",
    currentUrl: "https://example.com/ch/12",
    currentTitle: "Chapter 12",
    activeDeviceId: "dev_2",
    lastUpdatedDeviceId: "dev_2",
    isPrivate: 0,
    archivedAt: null,
    revision: 4,
    createdAt: 1,
    updatedAt: 2,
    deletedAt: null,
    ...overrides,
  };
}

function conflict(overrides: Partial<StoredConflict> = {}): StoredConflict {
  return {
    version: 1,
    operationId: "op_1",
    entityType: "tab",
    entityId: "tab_1",
    kind: "update_location",
    baseRevision: 3,
    payload: { url: "https://example.com/ch/11", title: "Chapter 11", recordHistory: true },
    createdAt: 1,
    attempts: 1,
    nextAttemptAt: 1,
    lastError: null,
    recordedAt: 100,
    conflict: {
      ok: false,
      reason: "stale_revision",
      current: tab(),
    },
    ...overrides,
  };
}

describe("conflictActionsFor", () => {
  it("offers keep mine for stale location updates", () => {
    expect(conflictActionsFor("update_location", "stale_revision")).toEqual([
      "keep_mine",
      "keep_theirs",
      "dismiss",
    ]);
  });

  it("limits deleted and missing conflicts to accept/dismiss", () => {
    expect(conflictActionsFor("update_location", "deleted")).toEqual(["keep_theirs", "dismiss"]);
    expect(conflictActionsFor("rename", "missing")).toEqual(["keep_theirs", "dismiss"]);
  });

  it("does not offer keep mine for create conflicts", () => {
    expect(conflictActionsFor("create", "stale_revision")).toEqual(["keep_theirs", "dismiss"]);
  });
});

describe("toConflictView", () => {
  it("builds guided copy for a stale location conflict", () => {
    const view = toConflictView(conflict());
    expect(view.activityName).toBe("Manga");
    expect(view.kindLabel).toBe("Location update");
    expect(view.reasonLabel).toBe("Changed on another device");
    expect(view.mineSummary).toBe("https://example.com/ch/11");
    expect(view.theirsSummary).toContain("https://example.com/ch/12");
    expect(view.actions).toContain("keep_mine");
  });

  it("summarizes ownership and deleted cloud state", () => {
    expect(summarizeMinePayload("rename", { name: "New name" })).toBe("New name");
    expect(summarizeTheirs(tab({ deletedAt: 9 }))).toBe("Deleted");
    expect(summarizeTheirs(null)).toBeNull();
  });

  it("rejects malformed stored rows", () => {
    expect(isStoredConflict({})).toBe(false);
    expect(isStoredConflict(conflict())).toBe(true);
  });
});
