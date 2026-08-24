import { createClient } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { bootstrapDatabase, migrateDatabase } from "./bootstrap";
import { takeOverTrackedTab, updateTrackedTabLocation } from "./tracked-tabs";

const clients: ReturnType<typeof createClient>[] = [];
const directories: string[] = [];

function database() {
  const directory = mkdtempSync(join(tmpdir(), "trackingext-db-"));
  directories.push(directory);
  return databaseAt(join(directory, "test.db"));
}

function databaseAt(path: string) {
  const client = createClient({ url: `file:${path}` });
  clients.push(client);
  return client;
}

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("cloud database", () => {
  it("handles simultaneous first connections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "trackingext-db-"));
    directories.push(directory);
    const path = join(directory, "test.db");
    const first = databaseAt(path);
    const second = databaseAt(path);

    const results = await Promise.all([
      bootstrapDatabase(first, { deviceName: "One", browser: "Firefox" }),
      bootstrapDatabase(second, { deviceName: "Two", browser: "Chromium" }),
    ]);
    expect(results[0]?.workspaceId).toBe(results[1]?.workspaceId);
    const counts = await first.execute(
      "SELECT (SELECT count(*) FROM workspace) workspaces, (SELECT count(*) FROM schema_migration) migrations",
    );
    expect(Number(counts.rows[0]?.workspaces)).toBe(1);
    expect(Number(counts.rows[0]?.migrations)).toBe(2);
  });

  it("bootstraps one workspace and safely repeats migrations", async () => {
    const client = database();
    const first = await bootstrapDatabase(client, { deviceName: "Firefox", browser: "Firefox" });
    const second = await bootstrapDatabase(client, {
      deviceId: first.deviceId,
      deviceName: "Firefox renamed",
      browser: "Firefox",
    });
    await migrateDatabase(client);

    expect(second.workspaceId).toBe(first.workspaceId);
    const counts = await client.execute(
      "SELECT (SELECT count(*) FROM workspace) workspaces, (SELECT count(*) FROM schema_migration) migrations",
    );
    expect(Number(counts.rows[0]?.workspaces)).toBe(1);
    expect(Number(counts.rows[0]?.migrations)).toBe(2);
  });

  it("commits an owned revision update atomically and replays idempotently", async () => {
    const client = database();
    const { workspaceId, deviceId } = await bootstrapDatabase(client, {
      deviceName: "Chromium",
      browser: "Chromium",
    });
    await client.execute({
      sql: `INSERT INTO tracked_tab
        (id, workspace_id, name, current_url, active_device_id, last_updated_device_id, created_at, updated_at)
        VALUES ('tab_1', ?, 'One', 'https://example.com/1', ?, ?, 1, 1)`,
      args: [workspaceId, deviceId, deviceId],
    });
    const input = {
      operationId: "op_1",
      workspaceId,
      tabId: "tab_1",
      deviceId,
      baseRevision: 1,
      url: "https://example.com/2",
      title: "Two",
      recordHistory: true,
      now: 2,
    };
    const first = await updateTrackedTabLocation(client, input);
    const replay = await updateTrackedTabLocation(client, input);

    expect(first.ok && first.value.revision).toBe(2);
    expect(replay.ok && replay.value.revision).toBe(2);
    const counts = await client.execute(
      "SELECT (SELECT count(*) FROM tracked_tab_history) history, (SELECT count(*) FROM mutation_receipt) receipts",
    );
    expect(Number(counts.rows[0]?.history)).toBe(1);
    expect(Number(counts.rows[0]?.receipts)).toBe(1);
  });

  it("classifies stale revisions and ownership conflicts without overwriting", async () => {
    const client = database();
    const owner = await bootstrapDatabase(client, { deviceName: "Owner", browser: "Firefox" });
    const other = await bootstrapDatabase(client, { deviceName: "Other", browser: "Chromium" });
    await client.execute({
      sql: `INSERT INTO tracked_tab
        (id, workspace_id, name, current_url, active_device_id, created_at, updated_at)
        VALUES ('tab_1', ?, 'One', 'https://example.com/1', ?, 1, 1)`,
      args: [owner.workspaceId, owner.deviceId],
    });
    const conflict = await updateTrackedTabLocation(client, {
      operationId: "op_conflict",
      workspaceId: owner.workspaceId,
      tabId: "tab_1",
      deviceId: other.deviceId,
      baseRevision: 1,
      url: "https://example.com/bad",
      title: null,
      recordHistory: true,
    });
    expect(conflict).toMatchObject({ ok: false, reason: "ownership" });

    const stale = await updateTrackedTabLocation(client, {
      operationId: "op_stale",
      workspaceId: owner.workspaceId,
      tabId: "tab_1",
      deviceId: owner.deviceId,
      baseRevision: 9,
      url: "https://example.com/bad",
      title: null,
      recordHistory: true,
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale_revision" });
    if (stale.ok) throw new Error("Expected a stale revision conflict");
    expect(stale.current?.currentUrl).toBe("https://example.com/1");

    const takeover = await takeOverTrackedTab(client, {
      operationId: "op_takeover",
      workspaceId: owner.workspaceId,
      tabId: "tab_1",
      deviceId: other.deviceId,
      now: 3,
    });
    expect(takeover.ok && takeover.value.activeDeviceId).toBe(other.deviceId);
    expect(takeover.ok && takeover.value.revision).toBe(2);

    const oldOwner = await updateTrackedTabLocation(client, {
      operationId: "op_old_owner",
      workspaceId: owner.workspaceId,
      tabId: "tab_1",
      deviceId: owner.deviceId,
      baseRevision: 2,
      url: "https://example.com/old-owner",
      title: null,
      recordHistory: true,
    });
    expect(oldOwner).toMatchObject({ ok: false, reason: "ownership" });
  });
});
