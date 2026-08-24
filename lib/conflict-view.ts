import type { WriteConflictReason, WriteResult } from "../core/conflicts";
import type { TrackedTabRecord } from "../core/entities";
import type { OutboxKind, OutboxOperation } from "../storage/indexed-db";

export type StoredConflict = OutboxOperation & {
  conflict: Extract<WriteResult<TrackedTabRecord>, { ok: false }>;
  recordedAt: number;
};

export type ConflictResolution = "keep_mine" | "keep_theirs" | "dismiss";

export type ConflictView = {
  operationId: string;
  entityId: string;
  kind: OutboxKind;
  kindLabel: string;
  reason: WriteConflictReason;
  reasonLabel: string;
  recordedAt: number;
  activityName: string;
  mineSummary: string;
  theirsSummary: string | null;
  actions: ConflictResolution[];
};

const KIND_LABELS: Record<OutboxKind, string> = {
  create: "Create",
  update_location: "Location update",
  update_tether: "Series tether",
  rename: "Rename / metadata",
  delete: "Delete",
  takeover: "Take over",
  archive: "Archive",
  restore: "Restore",
};

const REASON_LABELS: Record<WriteConflictReason, string> = {
  stale_revision: "Changed on another device",
  ownership: "Owned by another device",
  deleted: "Deleted in the cloud",
  archived: "Archived in the cloud",
  missing: "Missing in the cloud",
};

export function isStoredConflict(value: unknown): value is StoredConflict {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (typeof row.operationId !== "string") return false;
  if (typeof row.entityId !== "string") return false;
  if (typeof row.kind !== "string") return false;
  if (typeof row.recordedAt !== "number") return false;
  if (!row.conflict || typeof row.conflict !== "object") return false;
  const conflict = row.conflict as Record<string, unknown>;
  return conflict.ok === false && typeof conflict.reason === "string";
}

export function conflictActionsFor(
  kind: OutboxKind,
  reason: WriteConflictReason,
): ConflictResolution[] {
  if (reason === "deleted" || reason === "missing") {
    return ["keep_theirs", "dismiss"];
  }
  if (reason === "archived" && kind === "update_location") {
    return ["keep_theirs", "dismiss"];
  }
  if (kind === "create") {
    return ["keep_theirs", "dismiss"];
  }
  return ["keep_mine", "keep_theirs", "dismiss"];
}

export function summarizeMinePayload(kind: OutboxKind, payload: Record<string, unknown>): string {
  switch (kind) {
    case "update_location":
      return typeof payload.url === "string" ? payload.url : "Updated location";
    case "rename": {
      const name = typeof payload.name === "string" ? payload.name : "Renamed";
      return name;
    }
    case "update_tether":
      return payload.tetherMode === "series" ? "Series tether" : "Loose tether";
    case "delete":
      return "Delete activity";
    case "archive":
      return "Archive activity";
    case "restore":
      return "Restore activity";
    case "takeover":
      return "Take ownership";
    case "create":
      return typeof payload.name === "string" ? `Create “${payload.name}”` : "Create activity";
    default:
      return kind;
  }
}

export function summarizeTheirs(current: TrackedTabRecord | null): string | null {
  if (!current) return null;
  if (current.deletedAt) return "Deleted";
  if (current.archivedAt) return `Archived · ${current.currentUrl}`;
  return `${current.name} · ${current.currentUrl}`;
}

export function toConflictView(stored: StoredConflict): ConflictView {
  const reason = stored.conflict.reason;
  const current = stored.conflict.current;
  return {
    operationId: stored.operationId,
    entityId: stored.entityId,
    kind: stored.kind,
    kindLabel: KIND_LABELS[stored.kind] ?? stored.kind,
    reason,
    reasonLabel: REASON_LABELS[reason] ?? reason,
    recordedAt: stored.recordedAt,
    activityName: current?.name ?? stored.entityId,
    mineSummary: summarizeMinePayload(stored.kind, stored.payload),
    theirsSummary: summarizeTheirs(current),
    actions: conflictActionsFor(stored.kind, reason),
  };
}
