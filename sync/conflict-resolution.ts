import type { TrackedTabRecord } from "../core/entities";
import {
  isStoredConflict,
  toConflictView,
  type ConflictResolution,
  type ConflictView,
  type StoredConflict,
} from "../lib/conflict-view";
import { parseSeriesPattern, serializeSeriesPattern } from "../lib/series-sync";
import { createOperation } from "./outbox";
import { requestCloudSync } from "./coordinator";
import {
  cacheTabAndEnqueue,
  listConflicts as listRawConflicts,
  putCachedTab,
  removeConflict,
  type OutboxKind,
} from "../storage/indexed-db";
import { takeOverCloudTab, updateCloudTabLocation } from "./cloud-tabs";

export async function listConflictViews(): Promise<ConflictView[]> {
  const rows = await listRawConflicts();
  return rows
    .filter(isStoredConflict)
    .map(toConflictView)
    .toSorted((a, b) => b.recordedAt - a.recordedAt);
}

async function getStoredConflict(operationId: string): Promise<StoredConflict> {
  const rows = await listRawConflicts();
  const stored = rows.find((row) => isStoredConflict(row) && row.operationId === operationId);
  if (!stored || !isStoredConflict(stored)) throw new Error("Conflict not found");
  return stored;
}

async function acceptTheirs(stored: StoredConflict) {
  if (stored.conflict.current) {
    await putCachedTab(stored.conflict.current);
  }
  await removeConflict(stored.operationId);
}

function seriesPatternFromPayload(payload: Record<string, unknown>, fallback: string | null | undefined) {
  if (payload.seriesPattern === undefined) return fallback ?? null;
  if (payload.seriesPattern == null) return null;
  if (typeof payload.seriesPattern === "string") return payload.seriesPattern;
  return serializeSeriesPattern(parseSeriesPattern(payload.seriesPattern) ?? null);
}

function optimisticTabFromCurrent(
  current: TrackedTabRecord,
  kind: OutboxKind,
  payload: Record<string, unknown>,
): TrackedTabRecord {
  const now = Date.now();
  if (kind === "update_location") {
    return {
      ...current,
      currentUrl: String(payload.url ?? current.currentUrl),
      currentTitle:
        payload.title === undefined
          ? current.currentTitle
          : payload.title == null
            ? null
            : String(payload.title),
      updatedAt: now,
    };
  }
  if (kind === "rename") {
    return {
      ...current,
      name: String(payload.name ?? current.name),
      emoji:
        payload.emoji === undefined
          ? current.emoji
          : payload.emoji == null
            ? null
            : String(payload.emoji),
      tags: payload.tags !== undefined ? JSON.stringify(payload.tags) : current.tags,
      groupId:
        payload.groupId === undefined
          ? current.groupId
          : payload.groupId == null
            ? null
            : String(payload.groupId),
      isPrivate:
        payload.isPrivate !== undefined ? (payload.isPrivate ? 1 : 0) : current.isPrivate,
      updatedAt: now,
    };
  }
  if (kind === "update_tether") {
    return {
      ...current,
      tetherMode: String(payload.tetherMode ?? current.tetherMode ?? "loose"),
      seriesPattern: seriesPatternFromPayload(payload, current.seriesPattern),
      updatedAt: now,
    };
  }
  if (kind === "archive") {
    return { ...current, archivedAt: now, activeDeviceId: null, updatedAt: now };
  }
  if (kind === "restore") {
    return { ...current, archivedAt: null, updatedAt: now };
  }
  if (kind === "delete") {
    return { ...current, deletedAt: now, activeDeviceId: null, updatedAt: now };
  }
  if (kind === "takeover") {
    return { ...current, updatedAt: now };
  }
  return { ...current, updatedAt: now };
}

async function keepMine(stored: StoredConflict) {
  const current = stored.conflict.current;
  if (!current) {
    throw new Error("Cloud copy is missing; only dismiss is available");
  }
  if (stored.conflict.reason === "deleted" || stored.conflict.reason === "missing") {
    throw new Error("This activity no longer exists in the cloud");
  }
  if (stored.kind === "create") {
    throw new Error("Create conflicts can only be dismissed");
  }

  if (stored.conflict.reason === "ownership" && stored.kind === "update_location") {
    const taken = await takeOverCloudTab(stored.entityId);
    if (!taken) throw new Error("Could not take over this activity");
    await removeConflict(stored.operationId);
    await updateCloudTabLocation(
      stored.entityId,
      String(stored.payload.url),
      stored.payload.title == null ? null : String(stored.payload.title),
      stored.payload.recordHistory !== false,
    );
    void requestCloudSync("manual");
    return;
  }

  if (stored.conflict.reason === "archived" && stored.kind === "update_location") {
    throw new Error("Restore the activity before keeping your location update");
  }

  const optimistic = optimisticTabFromCurrent(current, stored.kind, stored.payload);
  const rebased: TrackedTabRecord = {
    ...optimistic,
    revision: current.revision,
  };
  const operation = createOperation({
    kind: stored.kind,
    tab: rebased,
    baseRevision: current.revision,
    payload: stored.payload,
  });
  await cacheTabAndEnqueue(rebased, operation);
  await removeConflict(stored.operationId);
  void requestCloudSync("manual");
}

export async function resolveConflict(
  operationId: string,
  resolution: ConflictResolution,
): Promise<ConflictView[]> {
  const stored = await getStoredConflict(operationId);
  if (resolution === "keep_mine") {
    await keepMine(stored);
  } else {
    await acceptTheirs(stored);
  }
  return listConflictViews();
}
