import { createId } from "../core/ids";
import type { DatabaseClient } from "./client";
import { requiredText } from "../core/validation";
import { getCloudCredentials } from "../storage/cloud-configuration";
import { withDatabaseClient } from "../services/database-service";
import type { PrivacySettings } from "../lib/types";

const backupTables = {
  workspace: ["id", "singleton", "created_at", "updated_at"],
  device: [
    "id",
    "workspace_id",
    "name",
    "browser",
    "last_seen_at",
    "revision",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  group: [
    "id",
    "workspace_id",
    "name",
    "notes",
    "pinned_tracked_tab_id",
    "revision",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  tracked_tab: [
    "id",
    "workspace_id",
    "group_id",
    "name",
    "emoji",
    "tags",
    "current_url",
    "current_title",
    "active_device_id",
    "last_updated_device_id",
    "is_private",
    "archived_at",
    "revision",
    "created_at",
    "updated_at",
    "deleted_at",
    "tether_mode",
    "series_pattern",
  ],
  tracked_tab_history: [
    "id",
    "workspace_id",
    "tracked_tab_id",
    "operation_id",
    "url",
    "title",
    "visited_at",
    "created_at",
  ],
  workspace_settings: [
    "workspace_id",
    "record_history",
    "strip_query_params",
    "strip_fragments",
    "excluded_hosts",
    "dashboard_theme_seed",
    "dashboard_theme_variant",
    "history_retention_days",
    "revision",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  mutation_receipt: ["operation_id", "workspace_id", "entity_type", "entity_id", "applied_at"],
} as const;

type BackupTable = keyof typeof backupTables;
type BackupRows = Record<BackupTable, Record<string, unknown>[]>;

export type CloudDatabaseExport = {
  format: "trackingext-cloud-database";
  version: 1;
  exportedAt: string;
  workspaceId: string;
  data: BackupRows;
};

async function withDatabase<T>(run: (client: DatabaseClient, workspaceId: string) => Promise<T>) {
  const credentials = await getCloudCredentials();
  if (!credentials) throw new Error("Cloud database is not connected");
  return withDatabaseClient(credentials, "management", (client) =>
    run(client, credentials.workspaceId),
  );
}

export const listCloudGroups = () =>
  withDatabase(async (client, workspaceId) => {
    const result = await client.execute({
      sql: `SELECT g.*,
        (SELECT count(*) FROM tracked_tab t WHERE t.group_id = g.id AND t.deleted_at IS NULL) AS activity_count,
        pinned.name AS pinned_name, pinned.emoji AS pinned_emoji, pinned.current_url AS pinned_url
        FROM "group" g
        LEFT JOIN tracked_tab pinned ON pinned.id = g.pinned_tracked_tab_id AND pinned.deleted_at IS NULL
        WHERE g.workspace_id = ? AND g.deleted_at IS NULL
        ORDER BY g.name`,
      args: [workspaceId],
    });
    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      notes: String(row.notes),
      activityCount: Number(row.activity_count),
      revision: Number(row.revision),
      pinnedTrackedTabId: row.pinned_tracked_tab_id == null ? null : String(row.pinned_tracked_tab_id),
      pinnedActivity:
        row.pinned_tracked_tab_id == null
          ? null
          : {
              id: String(row.pinned_tracked_tab_id),
              name: String(row.pinned_name),
              emoji: row.pinned_emoji == null ? null : String(row.pinned_emoji),
              currentUrl: String(row.pinned_url),
            },
    }));
  });

export const saveCloudGroup = (input: {
  id?: string;
  name: string;
  notes?: string;
  revision?: number;
  pinnedTrackedTabId?: string | null;
}) =>
  withDatabase(async (client, workspaceId) => {
    const now = Date.now();
    const name = requiredText(input.name, "Group name", 120);
    const notes = input.notes ?? "";
    if (notes.length > 4000) throw new Error("Notes must be at most 4000 characters");

    if (input.pinnedTrackedTabId) {
      const pinned = await client.execute({
        sql: "SELECT id FROM tracked_tab WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
        args: [input.pinnedTrackedTabId, workspaceId],
      });
      if (!pinned.rows.length) throw new Error("Pinned activity not found");
    }

    if (input.id) {
      const pinnedValue =
        input.pinnedTrackedTabId !== undefined ? input.pinnedTrackedTabId : undefined;
      const result = await client.execute({
        sql:
          pinnedValue !== undefined
            ? `UPDATE "group" SET name = ?, notes = ?, pinned_tracked_tab_id = ?,
                updated_at = ?, revision = revision + 1
                WHERE id = ? AND workspace_id = ? AND revision = ? AND deleted_at IS NULL`
            : `UPDATE "group" SET name = ?, notes = ?, updated_at = ?, revision = revision + 1
                WHERE id = ? AND workspace_id = ? AND revision = ? AND deleted_at IS NULL`,
        args:
          pinnedValue !== undefined
            ? [name, notes, pinnedValue, now, input.id, workspaceId, input.revision ?? 0]
            : [name, notes, now, input.id, workspaceId, input.revision ?? 0],
      });
      if (result.rowsAffected !== 1)
        throw new Error("Group changed on another device; refresh and retry");
      return input.id;
    }
    const id = createId("grp");
    await client.execute({
      sql: `INSERT INTO "group" (id, workspace_id, name, notes, pinned_tracked_tab_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, workspaceId, name, notes, input.pinnedTrackedTabId ?? null, now, now],
    });
    return id;
  });

export const deleteCloudGroup = (id: string, revision: number) =>
  withDatabase(async (client, workspaceId) => {
    const now = Date.now();
    const result = await client.batch(
      [
        {
          sql: `UPDATE tracked_tab SET group_id = NULL, updated_at = ?, revision = revision + 1
            WHERE workspace_id = ? AND group_id = ? AND EXISTS (
              SELECT 1 FROM "group" WHERE id = ? AND workspace_id = ? AND revision = ? AND deleted_at IS NULL
            )`,
          args: [now, workspaceId, id, id, workspaceId, revision],
        },
        {
          sql: `UPDATE "group" SET deleted_at = ?, updated_at = ?, revision = revision + 1
            WHERE id = ? AND workspace_id = ? AND revision = ? AND deleted_at IS NULL`,
          args: [now, now, id, workspaceId, revision],
        },
      ],
      "write",
    );
    if (result[1]?.rowsAffected !== 1)
      throw new Error("Group changed on another device; refresh and retry");
  });

export const listCloudDevices = () =>
  withDatabase(async (client, workspaceId) => {
    const result = await client.execute({
      sql: "SELECT id, name, browser, last_seen_at, created_at, revision FROM device WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY last_seen_at DESC",
      args: [workspaceId],
    });
    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      browser: String(row.browser),
      lastSeenAt: Number(row.last_seen_at),
      createdAt: Number(row.created_at),
      revision: Number(row.revision),
    }));
  });

export const renameCloudDevice = (id: string, name: string, revision: number) =>
  withDatabase(async (client, workspaceId) => {
    const result = await client.execute({
      sql: `UPDATE device SET name = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND workspace_id = ? AND revision = ? AND deleted_at IS NULL`,
      args: [requiredText(name, "Device name", 120), Date.now(), id, workspaceId, revision],
    });
    if (result.rowsAffected !== 1)
      throw new Error("Device changed on another device; refresh and retry");
  });

export const removeCloudDevice = (id: string, revision: number) =>
  withDatabase(async (client, workspaceId) => {
    const now = Date.now();
    await client.batch(
      [
        {
          sql: `UPDATE tracked_tab SET active_device_id = NULL, updated_at = ?, revision = revision + 1
            WHERE workspace_id = ? AND active_device_id = ? AND EXISTS (
              SELECT 1 FROM device WHERE id = ? AND workspace_id = ? AND revision = ? AND deleted_at IS NULL
            )`,
          args: [now, workspaceId, id, id, workspaceId, revision],
        },
        {
          sql: `UPDATE device SET deleted_at = ?, updated_at = ?, revision = revision + 1
            WHERE id = ? AND workspace_id = ? AND revision = ? AND deleted_at IS NULL`,
          args: [now, now, id, workspaceId, revision],
        },
      ],
      "write",
    );
  });

export const getCloudHistory = (
  tabId: string,
  retentionDays: 7 | 30 | 90 | null = null,
) =>
  withDatabase(async (client, workspaceId) => {
    const cutoff =
      retentionDays === null ? null : Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const result = await client.execute({
      sql: `SELECT id, url, title, visited_at FROM tracked_tab_history
        WHERE workspace_id = ? AND tracked_tab_id = ?
        ${cutoff === null ? "" : "AND visited_at >= ?"}
        ORDER BY visited_at DESC LIMIT 200`,
      args: cutoff === null ? [workspaceId, tabId] : [workspaceId, tabId, cutoff],
    });
    return result.rows.map((row) => ({
      id: String(row.id),
      url: String(row.url),
      title: row.title == null ? null : String(row.title),
      visitedAt: new Date(Number(row.visited_at)).toISOString(),
    }));
  });

export const clearCloudHistory = (tabId: string) =>
  withDatabase(async (client, workspaceId) => {
    await client.execute({
      sql: "DELETE FROM tracked_tab_history WHERE workspace_id = ? AND tracked_tab_id = ?",
      args: [workspaceId, tabId],
    });
  });

export const purgeCloudHistoryByRetention = (retentionDays: 7 | 30 | 90 | null) =>
  withDatabase(async (client, workspaceId) => {
    if (retentionDays === null) return 0;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const result = await client.execute({
      sql: "DELETE FROM tracked_tab_history WHERE workspace_id = ? AND visited_at < ?",
      args: [workspaceId, cutoff],
    });
    return Number(result.rowsAffected ?? 0);
  });

export const updateCloudSettings = (settings: PrivacySettings) =>
  withDatabase(async (client, workspaceId) => {
    const current = await client.execute({
      sql: "SELECT revision FROM workspace_settings WHERE workspace_id = ? AND deleted_at IS NULL",
      args: [workspaceId],
    });
    const revision = Number(current.rows[0]?.revision ?? 0);
    const result = await client.execute({
      sql: `UPDATE workspace_settings SET record_history = ?, strip_query_params = ?,
        strip_fragments = ?, excluded_hosts = ?, dashboard_theme_seed = ?,
        dashboard_theme_variant = ?, history_retention_days = ?, updated_at = ?, revision = revision + 1
        WHERE workspace_id = ? AND revision = ? AND deleted_at IS NULL`,
      args: [
        settings.recordHistory ? 1 : 0,
        settings.stripQueryParams ? 1 : 0,
        settings.stripFragments ? 1 : 0,
        JSON.stringify(settings.excludedHosts),
        settings.dashboardThemeSeed,
        settings.dashboardThemeVariant,
        settings.historyRetentionDays,
        Date.now(),
        workspaceId,
        revision,
      ],
    });
    if (result.rowsAffected !== 1) throw new Error("Settings changed on another device; retry");
  });

export const exportCloudDatabase = () =>
  withDatabase(async (client, workspaceId) => {
    const data = {} as BackupRows;
    for (const [table, columns] of Object.entries(backupTables) as [BackupTable, readonly string[]][]) {
      const workspaceColumn = table === "workspace" ? "id" : "workspace_id";
      const result = await client.execute({
        sql: `SELECT ${columns.join(", ")} FROM "${table}" WHERE ${workspaceColumn} = ?`,
        args: [workspaceId],
      });
      data[table] = result.rows.map((row) => Object.fromEntries(columns.map((key) => [key, row[key]])));
    }
    return {
      format: "trackingext-cloud-database",
      version: 1,
      exportedAt: new Date().toISOString(),
      workspaceId,
      data,
    } satisfies CloudDatabaseExport;
  });

export const importCloudDatabase = (value: unknown) =>
  withDatabase(async (client, workspaceId) => {
    if (!value || typeof value !== "object") throw new Error("Invalid cloud database export");
    const backup = value as Partial<CloudDatabaseExport>;
    if (
      backup.format !== "trackingext-cloud-database" ||
      backup.version !== 1 ||
      backup.workspaceId !== workspaceId ||
      !backup.data
    ) {
      throw new Error("Choose a cloud backup from this database workspace");
    }
    const data = backup.data as Partial<BackupRows>;
    for (const table of Object.keys(backupTables) as BackupTable[]) {
      if (!Array.isArray(data[table])) throw new Error(`Cloud backup is missing ${table}`);
    }
    const statements = [
      "tracked_tab_history",
      "mutation_receipt",
      "tracked_tab",
      "group",
      "device",
      "workspace_settings",
      "workspace",
    ].map((table) => ({
      sql: `DELETE FROM "${table}" WHERE ${table === "workspace" ? "id" : "workspace_id"} = ?`,
      args: [workspaceId],
    }));
    for (const [table, columns] of Object.entries(backupTables) as [BackupTable, readonly string[]][]) {
      for (const row of data[table] ?? []) {
        if (!columns.every((column) => column in row)) throw new Error(`Cloud backup has an invalid ${table} row`);
        statements.push({
          sql: `INSERT INTO "${table}" (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
          args: columns.map((column) => (row[column] ?? null) as never),
        });
      }
    }
    await client.batch(statements, "write");
  });
