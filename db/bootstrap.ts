import { createId } from "../core/ids";
import { requiredText } from "../core/validation";
import type { DatabaseClient } from "./client";
import { migrations } from "./migrations/manifest";

const MIGRATION_TABLE = `CREATE TABLE IF NOT EXISTS schema_migration (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
)`;

function statements(sql: string) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function isIgnorableMigrationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate column name|already exists/i.test(message);
}

export async function migrateDatabase(client: DatabaseClient) {
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute(MIGRATION_TABLE);
  const applied = await client.execute(
    "SELECT version, checksum FROM schema_migration ORDER BY version",
  );
  const known = new Map(applied.rows.map((row) => [Number(row.version), String(row.checksum)]));
  const newest = Math.max(0, ...known.keys());
  if (newest > migrations.length) throw new Error("Database schema is newer than this extension");

  for (const migration of migrations) {
    const checksum = known.get(migration.version);
    if (checksum && checksum !== migration.checksum) {
      throw new Error(`Migration ${migration.version} checksum does not match`);
    }
    if (checksum) continue;
    const now = Date.now();
    for (const sql of statements(migration.sql)) {
      try {
        await client.execute(sql);
      } catch (error) {
        // Concurrent bootstraps may race on non-idempotent ALTER TABLE ADD COLUMN.
        if (!isIgnorableMigrationError(error)) throw error;
      }
    }
    await client.execute({
      sql: "INSERT OR IGNORE INTO schema_migration (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      args: [migration.version, migration.name, migration.checksum, now],
    });
    const recorded = await client.execute({
      sql: "SELECT checksum FROM schema_migration WHERE version = ?",
      args: [migration.version],
    });
    if (recorded.rows[0]?.checksum !== migration.checksum) {
      throw new Error(`Migration ${migration.version} lost a concurrent schema race`);
    }
  }
}

export type BootstrapInput = { deviceId?: string; deviceName: string; browser: string };

export async function bootstrapDatabase(client: DatabaseClient, input: BootstrapInput) {
  await migrateDatabase(client);
  const now = Date.now();
  const workspaceId = createId("ws");
  await client.execute({
    sql: "INSERT OR IGNORE INTO workspace (id, singleton, created_at, updated_at) VALUES (?, 1, ?, ?)",
    args: [workspaceId, now, now],
  });
  const workspace = await client.execute("SELECT id FROM workspace WHERE singleton = 1");
  const id = String(workspace.rows[0]?.id ?? "");
  if (!id) throw new Error("Failed to create workspace");

  await client.execute({
    sql: `INSERT OR IGNORE INTO workspace_settings
      (workspace_id, created_at, updated_at) VALUES (?, ?, ?)`,
    args: [id, now, now],
  });

  const deviceId = input.deviceId || createId("dev");
  await client.execute({
    sql: `INSERT INTO device
      (id, workspace_id, name, browser, last_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, browser = excluded.browser, last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at, deleted_at = NULL, revision = device.revision + 1
      WHERE device.workspace_id = excluded.workspace_id`,
    args: [
      deviceId,
      id,
      requiredText(input.deviceName, "Device name", 120),
      requiredText(input.browser, "Browser", 60),
      now,
      now,
      now,
    ],
  });
  return { workspaceId: id, deviceId };
}
