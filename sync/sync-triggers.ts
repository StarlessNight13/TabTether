import type { OutboxKind } from "../storage/indexed-db";

export type CloudSyncTrigger = "activity" | "scheduled" | "manual";

const ACTIVITY_SYNC_KINDS = new Set<OutboxKind>([
  "create",
  "rename",
  "delete",
  "takeover",
  "archive",
  "restore",
  "update_tether",
]);

export function cloudSyncTriggerForKind(kind: OutboxKind): CloudSyncTrigger {
  return ACTIVITY_SYNC_KINDS.has(kind) ? "activity" : "scheduled";
}
