import { historyId } from "../core/ids";
import type { WriteResult } from "../core/conflicts";
import type { TrackedTabRecord } from "../core/entities";
import type { DatabaseClient } from "./client";

export function tabFromRow(row: Record<string, unknown>): TrackedTabRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    groupId: row.group_id == null ? null : String(row.group_id),
    name: String(row.name),
    emoji: row.emoji == null ? null : String(row.emoji),
    tags: String(row.tags),
    currentUrl: String(row.current_url),
    currentTitle: row.current_title == null ? null : String(row.current_title),
    activeDeviceId: row.active_device_id == null ? null : String(row.active_device_id),
    lastUpdatedDeviceId:
      row.last_updated_device_id == null ? null : String(row.last_updated_device_id),
    isPrivate: Number(row.is_private),
    archivedAt: row.archived_at == null ? null : Number(row.archived_at),
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
    tetherMode: row.tether_mode == null ? "loose" : String(row.tether_mode),
    seriesPattern: row.series_pattern == null ? null : String(row.series_pattern),
    activeDeviceName: row.active_device_name == null ? null : String(row.active_device_name),
    activeDeviceBrowser: row.active_device_browser == null ? null : String(row.active_device_browser),
    activeDeviceLastSeenAt:
      row.active_device_last_seen_at == null ? null : Number(row.active_device_last_seen_at),
    lastUpdatedDeviceName:
      row.last_updated_device_name == null ? null : String(row.last_updated_device_name),
    lastUpdatedDeviceBrowser:
      row.last_updated_device_browser == null ? null : String(row.last_updated_device_browser),
    lastUpdatedDeviceLastSeenAt:
      row.last_updated_device_last_seen_at == null
        ? null
        : Number(row.last_updated_device_last_seen_at),
  };
}

export async function getTrackedTab(client: DatabaseClient, workspaceId: string, id: string) {
  const result = await client.execute({
    sql: "SELECT * FROM tracked_tab WHERE id = ? AND workspace_id = ?",
    args: [id, workspaceId],
  });
  return result.rows[0] ? tabFromRow(result.rows[0]) : null;
}

export type LocationUpdate = {
  operationId: string;
  workspaceId: string;
  tabId: string;
  deviceId: string;
  baseRevision: number;
  url: string;
  title: string | null;
  recordHistory: boolean;
  now?: number;
};

export async function updateTrackedTabLocation(
  client: DatabaseClient,
  input: LocationUpdate,
): Promise<WriteResult<TrackedTabRecord>> {
  const receipt = await client.execute({
    sql: "SELECT 1 FROM mutation_receipt WHERE operation_id = ? AND workspace_id = ?",
    args: [input.operationId, input.workspaceId],
  });
  if (receipt.rows.length) {
    const current = await getTrackedTab(client, input.workspaceId, input.tabId);
    return current ? { ok: true, value: current } : { ok: false, reason: "missing", current };
  }

  const now = input.now ?? Date.now();
  const statements = [
    {
      sql: `UPDATE tracked_tab SET
        current_url = ?, current_title = ?, active_device_id = ?, last_updated_device_id = ?,
        updated_at = ?, revision = revision + 1
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL AND archived_at IS NULL
        AND (active_device_id IS NULL OR active_device_id = ?) AND revision = ?`,
      args: [
        input.url,
        input.title,
        input.deviceId,
        input.deviceId,
        now,
        input.tabId,
        input.workspaceId,
        input.deviceId,
        input.baseRevision,
      ],
    },
    ...(input.recordHistory
      ? [
          {
        sql: `INSERT OR IGNORE INTO tracked_tab_history
          (id, workspace_id, tracked_tab_id, operation_id, url, title, visited_at, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM tracked_tab WHERE id = ? AND workspace_id = ? AND revision = ?
              AND current_url = ? AND active_device_id = ?
          )`,
        args: [
          historyId(input.operationId),
          input.workspaceId,
          input.tabId,
          input.operationId,
          input.url,
          input.title,
          now,
          now,
          input.tabId,
          input.workspaceId,
          input.baseRevision + 1,
          input.url,
          input.deviceId,
        ],
          },
        ]
      : []),
    {
      sql: `UPDATE device SET last_seen_at = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL AND EXISTS (
          SELECT 1 FROM tracked_tab WHERE id = ? AND workspace_id = ? AND revision = ?
            AND current_url = ? AND active_device_id = ?
        )`,
      args: [
        now,
        now,
        input.deviceId,
        input.workspaceId,
        input.tabId,
        input.workspaceId,
        input.baseRevision + 1,
        input.url,
        input.deviceId,
      ],
    },
    {
      sql: `INSERT INTO mutation_receipt (operation_id, workspace_id, entity_type, entity_id, applied_at)
        SELECT ?, ?, 'tab', ?, ? WHERE EXISTS (
          SELECT 1 FROM tracked_tab WHERE id = ? AND workspace_id = ? AND revision = ?
            AND current_url = ? AND active_device_id = ?
        )`,
      args: [
        input.operationId,
        input.workspaceId,
        input.tabId,
        now,
        input.tabId,
        input.workspaceId,
        input.baseRevision + 1,
        input.url,
        input.deviceId,
      ],
    },
  ];
  const [updated] = await client.batch(statements, "write");
  if (updated?.rowsAffected !== 1) {
    const current = await getTrackedTab(client, input.workspaceId, input.tabId);
    const reason = !current
      ? "missing"
      : current.deletedAt
        ? "deleted"
        : current.archivedAt
          ? "archived"
          : current.activeDeviceId && current.activeDeviceId !== input.deviceId
            ? "ownership"
            : "stale_revision";
    return { ok: false, reason, current };
  }
  const value = await getTrackedTab(client, input.workspaceId, input.tabId);
  if (!value) throw new Error("Updated tab disappeared");
  return { ok: true, value };
}

export async function takeOverTrackedTab(
  client: DatabaseClient,
  input: Omit<LocationUpdate, "url" | "title" | "recordHistory" | "baseRevision">,
): Promise<WriteResult<TrackedTabRecord>> {
  const now = input.now ?? Date.now();
  await client.batch(
    [
      {
        sql: `UPDATE tracked_tab SET active_device_id = ?, last_updated_device_id = ?,
          updated_at = ?, revision = revision + 1
          WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL AND archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM mutation_receipt WHERE operation_id = ?)`,
        args: [
          input.deviceId,
          input.deviceId,
          now,
          input.tabId,
          input.workspaceId,
          input.operationId,
        ],
      },
      {
        sql: `INSERT OR IGNORE INTO mutation_receipt
          (operation_id, workspace_id, entity_type, entity_id, applied_at)
          SELECT ?, ?, 'tab', ?, ? WHERE EXISTS (
            SELECT 1 FROM tracked_tab WHERE id = ? AND workspace_id = ?
              AND active_device_id = ? AND deleted_at IS NULL AND archived_at IS NULL
          )`,
        args: [
          input.operationId,
          input.workspaceId,
          input.tabId,
          now,
          input.tabId,
          input.workspaceId,
          input.deviceId,
        ],
      },
    ],
    "write",
  );
  const current = await getTrackedTab(client, input.workspaceId, input.tabId);
  if (!current) return { ok: false, reason: "missing", current };
  if (current.deletedAt) return { ok: false, reason: "deleted", current };
  if (current.archivedAt) return { ok: false, reason: "archived", current };
  return { ok: true, value: current };
}
