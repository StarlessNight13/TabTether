import type { WriteResult } from "../core/conflicts";
import type { TrackedTabRecord } from "../core/entities";
import { historyId } from "../core/ids";
import type { DatabaseClient, Statement } from "../db/client";
import { tabFromRow, takeOverTrackedTab, updateTrackedTabLocation } from "../db/tracked-tabs";
import { getCloudCredentials, setCloudStatus } from "../storage/cloud-configuration";
import { setLocalState } from "../lib/storage";
import { getLocalState } from "../lib/storage";
import { withDatabaseClient, type CloudSyncPolicy } from "../services/database-service";
import {
  applyPulledTabs,
  compactLocalDatabase,
  deferOperation,
  getTabsCursor,
  listCachedTabs,
  listPendingOperations,
  putCachedTab,
  removeOperation,
  storeConflict,
  type OutboxOperation,
} from "../storage/indexed-db";
import type { CloudSyncTrigger } from "./sync-triggers";

async function applyConditionalMutation(
  client: DatabaseClient,
  operation: OutboxOperation,
  workspaceId: string,
  deviceId: string,
): Promise<WriteResult<TrackedTabRecord>> {
  if (operation.kind === "update_location") {
    return updateTrackedTabLocation(client, {
      operationId: operation.operationId,
      workspaceId,
      tabId: operation.entityId,
      deviceId,
      baseRevision: operation.baseRevision ?? 0,
      url: String(operation.payload.url),
      title: operation.payload.title == null ? null : String(operation.payload.title),
      recordHistory: operation.payload.recordHistory !== false,
      now: operation.createdAt,
    });
  }
  if (operation.kind === "takeover") {
    return takeOverTrackedTab(client, {
      operationId: operation.operationId,
      workspaceId,
      tabId: operation.entityId,
      deviceId,
      now: operation.createdAt,
    });
  }

  const receipt = await client.execute({
    sql: "SELECT 1 FROM mutation_receipt WHERE operation_id = ? AND workspace_id = ?",
    args: [operation.operationId, workspaceId],
  });
  if (receipt.rows.length) {
    const row = await client.execute({
      sql: "SELECT * FROM tracked_tab WHERE id = ? AND workspace_id = ?",
      args: [operation.entityId, workspaceId],
    });
    return row.rows[0]
      ? { ok: true, value: tabFromRow(row.rows[0]) }
      : { ok: false, reason: "missing", current: null };
  }

  let mutation: Statement;
  let receiptCheck: Statement;
  let history: Statement | undefined;
  if (operation.kind === "create") {
    const tab = operation.payload as unknown as TrackedTabRecord;
    mutation = {
      sql: `INSERT OR IGNORE INTO tracked_tab
        (id, workspace_id, group_id, name, emoji, tags, current_url, current_title,
         active_device_id, last_updated_device_id, is_private, archived_at, revision,
         created_at, updated_at, deleted_at, tether_mode, series_pattern)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        tab.id,
        workspaceId,
        tab.groupId,
        tab.name,
        tab.emoji,
        tab.tags,
        tab.currentUrl,
        tab.currentTitle,
        deviceId,
        deviceId,
        tab.isPrivate,
        tab.archivedAt,
        tab.revision,
        tab.createdAt,
        tab.updatedAt,
        tab.deletedAt,
        tab.tetherMode ?? "loose",
        tab.seriesPattern ?? null,
      ],
    };
    receiptCheck = {
      sql: "SELECT 1 FROM tracked_tab WHERE id = ? AND workspace_id = ? AND created_at = ?",
      args: [tab.id, workspaceId, tab.createdAt],
    };
    if (operation.payload.recordHistory === true) {
      history = {
        sql: `INSERT OR IGNORE INTO tracked_tab_history
          (id, workspace_id, tracked_tab_id, operation_id, url, title, visited_at, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM tracked_tab WHERE id = ? AND workspace_id = ? AND created_at = ?
          )`,
        args: [
          historyId(operation.operationId),
          workspaceId,
          tab.id,
          operation.operationId,
          tab.currentUrl,
          tab.currentTitle,
          tab.createdAt,
          tab.createdAt,
          tab.id,
          workspaceId,
          tab.createdAt,
        ],
      };
    }
  } else if (operation.kind === "rename") {
    mutation = {
      sql: `UPDATE tracked_tab SET name = ?, emoji = ?, tags = ?, group_id = ?, is_private = ?,
        updated_at = ?, revision = revision + 1
        WHERE id = ? AND workspace_id = ? AND revision = ? AND deleted_at IS NULL`,
      args: [
        String(operation.payload.name),
        operation.payload.emoji == null ? null : String(operation.payload.emoji),
        JSON.stringify(operation.payload.tags ?? []),
        operation.payload.groupId == null ? null : String(operation.payload.groupId),
        operation.payload.isPrivate ? 1 : 0,
        operation.createdAt,
        operation.entityId,
        workspaceId,
        operation.baseRevision ?? 0,
      ],
    };
    receiptCheck = {
      sql: "SELECT 1 FROM tracked_tab WHERE id = ? AND workspace_id = ? AND revision = ? AND updated_at = ?",
      args: [operation.entityId, workspaceId, (operation.baseRevision ?? 0) + 1, operation.createdAt],
    };
  } else if (operation.kind === "update_tether") {
    mutation = {
      sql: `UPDATE tracked_tab SET tether_mode = ?, series_pattern = ?, last_updated_device_id = ?,
        updated_at = ?, revision = revision + 1
        WHERE id = ? AND workspace_id = ? AND revision = ? AND deleted_at IS NULL`,
      args: [
        String(operation.payload.tetherMode ?? "loose"),
        operation.payload.seriesPattern == null ? null : String(operation.payload.seriesPattern),
        deviceId,
        operation.createdAt,
        operation.entityId,
        workspaceId,
        operation.baseRevision ?? 0,
      ],
    };
    receiptCheck = {
      sql: "SELECT 1 FROM tracked_tab WHERE id = ? AND workspace_id = ? AND revision = ? AND updated_at = ?",
      args: [operation.entityId, workspaceId, (operation.baseRevision ?? 0) + 1, operation.createdAt],
    };
  } else if (operation.kind === "archive") {
    mutation = {
      sql: `UPDATE tracked_tab SET archived_at = ?, active_device_id = NULL,
        updated_at = ?, revision = revision + 1
        WHERE id = ? AND workspace_id = ? AND revision = ? AND deleted_at IS NULL`,
      args: [
        operation.createdAt,
        operation.createdAt,
        operation.entityId,
        workspaceId,
        operation.baseRevision ?? 0,
      ],
    };
    receiptCheck = {
      sql: "SELECT 1 FROM tracked_tab WHERE id = ? AND workspace_id = ? AND revision = ? AND archived_at = ?",
      args: [
        operation.entityId,
        workspaceId,
        (operation.baseRevision ?? 0) + 1,
        operation.createdAt,
      ],
    };
  } else if (operation.kind === "restore") {
    mutation = {
      sql: `UPDATE tracked_tab SET archived_at = NULL, updated_at = ?, revision = revision + 1
        WHERE id = ? AND workspace_id = ? AND revision = ? AND deleted_at IS NULL`,
      args: [operation.createdAt, operation.entityId, workspaceId, operation.baseRevision ?? 0],
    };
    receiptCheck = {
      sql: "SELECT 1 FROM tracked_tab WHERE id = ? AND workspace_id = ? AND revision = ? AND archived_at IS NULL AND updated_at = ?",
      args: [
        operation.entityId,
        workspaceId,
        (operation.baseRevision ?? 0) + 1,
        operation.createdAt,
      ],
    };
  } else {
    mutation = {
      sql: `UPDATE tracked_tab SET deleted_at = ?, active_device_id = NULL,
        updated_at = ?, revision = revision + 1
        WHERE id = ? AND workspace_id = ? AND revision = ? AND deleted_at IS NULL`,
      args: [
        operation.createdAt,
        operation.createdAt,
        operation.entityId,
        workspaceId,
        operation.baseRevision ?? 0,
      ],
    };
    receiptCheck = {
      sql: "SELECT 1 FROM tracked_tab WHERE id = ? AND workspace_id = ? AND revision = ? AND deleted_at = ?",
      args: [operation.entityId, workspaceId, (operation.baseRevision ?? 0) + 1, operation.createdAt],
    };
  }
  const [changed] = await client.batch(
    [
      mutation,
      ...(history ? [history] : []),
      {
        sql: `INSERT INTO mutation_receipt (operation_id, workspace_id, entity_type, entity_id, applied_at)
          SELECT ?, ?, 'tab', ?, ? WHERE EXISTS (${receiptCheck.sql})`,
        args: [
          operation.operationId,
          workspaceId,
          operation.entityId,
          Date.now(),
          ...((receiptCheck.args ?? []) as never[]),
        ],
      },
    ],
    "write",
  );
  if (changed?.rowsAffected !== 1) {
    const result = await client.execute({
      sql: "SELECT * FROM tracked_tab WHERE id = ? AND workspace_id = ?",
      args: [operation.entityId, workspaceId],
    });
    const current = result.rows[0] ? tabFromRow(result.rows[0]) : null;
    return {
      ok: false,
      reason: current?.deletedAt ? "deleted" : current ? "stale_revision" : "missing",
      current,
    };
  }
  const row = await client.execute({
    sql: "SELECT * FROM tracked_tab WHERE id = ? AND workspace_id = ?",
    args: [operation.entityId, workspaceId],
  });
  if (!row.rows[0]) return { ok: false, reason: "missing", current: null };
  return { ok: true, value: tabFromRow(row.rows[0]) };
}

async function push(client: DatabaseClient, workspaceId: string, deviceId: string) {
  const operations = await listPendingOperations();
  const revisions = new Map<string, number>();
  for (const operation of operations) {
    try {
      const effective = revisions.has(operation.entityId)
        ? { ...operation, baseRevision: revisions.get(operation.entityId)! }
        : operation;
      const result = await applyConditionalMutation(client, effective, workspaceId, deviceId);
      if (result.ok) {
        revisions.set(operation.entityId, result.value.revision);
        await putCachedTab(result.value);
        await removeOperation(operation.operationId);
      } else await storeConflict(operation, result);
    } catch (error) {
      await deferOperation(operation, error);
      break;
    }
  }
  return operations.length;
}

async function pull(client: DatabaseClient, workspaceId: string) {
  const cursor = await getTabsCursor();
  const result = await client.execute({
    sql: `SELECT t.*, active.name AS active_device_name, active.browser AS active_device_browser,
      active.last_seen_at AS active_device_last_seen_at, updated.name AS last_updated_device_name,
      updated.browser AS last_updated_device_browser, updated.last_seen_at AS last_updated_device_last_seen_at
      FROM tracked_tab t
      LEFT JOIN device active ON active.id = t.active_device_id AND active.deleted_at IS NULL
      LEFT JOIN device updated ON updated.id = t.last_updated_device_id AND updated.deleted_at IS NULL
      WHERE t.workspace_id = ?
      AND (t.updated_at > ? OR (t.updated_at = ? AND t.id > ?))
      ORDER BY t.updated_at, t.id LIMIT 500`,
    args: [workspaceId, cursor.updatedAt, cursor.updatedAt, cursor.id],
  });
  const tabs = result.rows.map(tabFromRow);
  const last = tabs.at(-1);
  if (tabs.length > 0) {
    const state = await getLocalState();
    const previousUrls = new Map<
      string,
      { currentUrl: string; currentTitle: string | null; updatedAt: number; isPrivate: boolean }
    >();
    for (const tab of await listCachedTabs()) {
      previousUrls.set(tab.id, {
        currentUrl: tab.currentUrl,
        currentTitle: tab.currentTitle,
        updatedAt: tab.updatedAt,
        isPrivate: Boolean(tab.isPrivate),
      });
    }
    for (const tab of state.cachedTabs) {
      if (previousUrls.has(tab.id)) continue;
      previousUrls.set(tab.id, {
        currentUrl: tab.currentUrl,
        currentTitle: tab.currentTitle,
        updatedAt: Date.parse(tab.lastUpdatedAt) || Date.now(),
        isPrivate: tab.isPrivate,
      });
    }

    if (last) await applyPulledTabs(tabs, { updatedAt: last.updatedAt, id: last.id });

    if (state.settings.recordHistory) {
      const localHistory = { ...state.localHistory };
      let historyChanged = false;
      for (const tab of tabs) {
        if (tab.deletedAt || tab.isPrivate) continue;
        const previous = previousUrls.get(tab.id);
        if (!previous || previous.isPrivate || previous.currentUrl === tab.currentUrl) continue;
        const entries = localHistory[tab.id] ?? [];
        if (entries.some((entry) => entry.url === previous.currentUrl)) continue;
        localHistory[tab.id] = [
          {
            id: `cloud_prior_${tab.id}_${previous.updatedAt}`,
            url: previous.currentUrl,
            title: previous.currentTitle,
            visitedAt: new Date(previous.updatedAt).toISOString(),
          },
          ...entries,
        ].slice(0, 200);
        historyChanged = true;
      }
      if (historyChanged) await setLocalState({ localHistory });
    }
  }

  const settings = await client.execute({
    sql: "SELECT * FROM workspace_settings WHERE workspace_id = ? AND deleted_at IS NULL",
    args: [workspaceId],
  });
  const row = settings.rows[0];
  if (row) {
    const previous = await getLocalState();
    await setLocalState({
      settings: {
        ...previous.settings,
        recordHistory: Boolean(row.record_history),
        stripQueryParams: Boolean(row.strip_query_params),
        stripFragments: Boolean(row.strip_fragments),
        excludedHosts: JSON.parse(String(row.excluded_hosts)) as string[],
        dashboardThemeSeed: String(row.dashboard_theme_seed),
        dashboardThemeVariant: String(row.dashboard_theme_variant) as never,
        historyRetentionDays: row.history_retention_days as 7 | 30 | 90 | null,
      },
    });
  }
  return tabs.length;
}

let syncing: Promise<{ pushed: number; pulled: number }> | undefined;

export function shouldRunCloudSync(trigger: CloudSyncTrigger, policy: CloudSyncPolicy) {
  if (trigger === "manual") return true;
  if (trigger === "activity") return policy.activitySync;
  return policy.scheduledSync;
}

export function syncCloudDatabase(options: { trigger?: CloudSyncTrigger } = {}) {
  if (!syncing) {
    syncing = (async () => {
      const credentials = await getCloudCredentials();
      const state = await getLocalState();
      const trigger = options.trigger ?? "scheduled";
      if (!credentials || !state.syncModes.online || !shouldRunCloudSync(trigger, credentials.behavior))
        return { pushed: 0, pulled: 0 };
      await setCloudStatus({ state: "syncing", lastSyncAt: null, lastError: null });
      try {
        const result = await withDatabaseClient(credentials, "sync", async (client) => ({
          pushed: await push(client, credentials.workspaceId, credentials.deviceId),
          pulled: await pull(client, credentials.workspaceId),
        }));
        await compactLocalDatabase();
        await setCloudStatus({ state: "idle", lastSyncAt: Date.now(), lastError: null });
        return result;
      } catch (error) {
        await setCloudStatus({
          state: "error",
          lastSyncAt: null,
          lastError: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    })().finally(() => {
      syncing = undefined;
    });
  }
  return syncing;
}
