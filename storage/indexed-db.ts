import type { TrackedTabRecord } from "../core/entities";

export const DATABASE_NAME = "trackingext";
export const DATABASE_VERSION = 2;

export type OutboxKind =
  | "create"
  | "update_location"
  | "update_tether"
  | "rename"
  | "delete"
  | "takeover"
  | "archive"
  | "restore";

export type OutboxOperation = {
  version: 1;
  operationId: string;
  entityType: "tab";
  entityId: string;
  kind: OutboxKind;
  baseRevision: number | null;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
};

export type SyncCursor = { updatedAt: number; id: string };
export type DatabaseLog = {
  id?: number;
  at: number;
  level: "info" | "change" | "error";
  operation: string;
  message: string;
  entityId?: string;
};

const request = <T>(value: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });

const complete = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB aborted"));
  });

let opening: Promise<IDBDatabase> | undefined;

export function openLocalDatabase() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const open = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      open.onupgradeneeded = () => {
        const database = open.result;
        if (!database.objectStoreNames.contains("tabs")) {
          database.createObjectStore("tabs", { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
          const outbox = database.createObjectStore("outbox", { keyPath: "operationId" });
          outbox.createIndex("createdAt", "createdAt");
          outbox.createIndex("entityId", "entityId");
          database.createObjectStore("meta");
          database.createObjectStore("conflicts", { keyPath: "operationId" });
          database.createObjectStore("diagnostics", { keyPath: "id", autoIncrement: true });
        } else {
          open.transaction?.objectStore("meta").delete("tabsCursor");
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  return opening;
}

export async function cacheTabAndEnqueue(tab: TrackedTabRecord, operation: OutboxOperation) {
  const database = await openLocalDatabase();
  const transaction = database.transaction(["tabs", "outbox", "diagnostics"], "readwrite");
  transaction.objectStore("tabs").put(tab);
  const outbox = transaction.objectStore("outbox");
  if (operation.kind === "update_location") {
    const existing = (await request(
      outbox.index("entityId").getAll(operation.entityId),
    )) as OutboxOperation[];
    for (const candidate of existing) {
      if (candidate.kind === "update_location") outbox.delete(candidate.operationId);
    }
  }
  outbox.put(operation);
  transaction.objectStore("diagnostics").add({
    at: Date.now(),
    level: "change",
    operation: operation.kind,
    message: `${operation.kind.replaceAll("_", " ")} queued`,
    entityId: operation.entityId,
  } satisfies DatabaseLog);
  await complete(transaction);
}

export async function appendDatabaseLog(entry: Omit<DatabaseLog, "id" | "at">) {
  const database = await openLocalDatabase();
  const transaction = database.transaction("diagnostics", "readwrite");
  transaction.objectStore("diagnostics").add({ ...entry, at: Date.now() });
  await complete(transaction);
}

export async function listDatabaseLogs(limit = 100) {
  const database = await openLocalDatabase();
  const logs = (await request(
    database.transaction("diagnostics").objectStore("diagnostics").getAll(),
  )) as DatabaseLog[];
  return logs.slice(-limit).reverse();
}

export async function clearDatabaseLogs() {
  const database = await openLocalDatabase();
  const transaction = database.transaction("diagnostics", "readwrite");
  transaction.objectStore("diagnostics").clear();
  await complete(transaction);
}

export async function listCachedTabs() {
  const database = await openLocalDatabase();
  return (await request(
    database.transaction("tabs").objectStore("tabs").getAll(),
  )) as TrackedTabRecord[];
}

export async function putCachedTab(tab: TrackedTabRecord) {
  const database = await openLocalDatabase();
  const transaction = database.transaction("tabs", "readwrite");
  transaction.objectStore("tabs").put(tab);
  await complete(transaction);
}

export async function listPendingOperations(now = Date.now()) {
  const database = await openLocalDatabase();
  const operations = (await request(
    database.transaction("outbox").objectStore("outbox").index("createdAt").getAll(),
  )) as OutboxOperation[];
  return operations.filter((operation) => operation.nextAttemptAt <= now);
}

export async function getSyncStoreSummary() {
  const database = await openLocalDatabase();
  const transaction = database.transaction(["outbox", "conflicts"]);
  const [pending, conflicts] = await Promise.all([
    request(transaction.objectStore("outbox").count()),
    request(transaction.objectStore("conflicts").count()),
  ]);
  return { pending, conflicts };
}

export async function listConflicts() {
  const database = await openLocalDatabase();
  return request(database.transaction("conflicts").objectStore("conflicts").getAll());
}

export async function removeOperation(operationId: string) {
  const database = await openLocalDatabase();
  const transaction = database.transaction("outbox", "readwrite");
  transaction.objectStore("outbox").delete(operationId);
  await complete(transaction);
}

export async function deferOperation(operation: OutboxOperation, error: unknown, now = Date.now()) {
  const database = await openLocalDatabase();
  const transaction = database.transaction(["outbox", "diagnostics"], "readwrite");
  const attempts = operation.attempts + 1;
  const message = error instanceof Error ? error.message : String(error);
  transaction.objectStore("outbox").put({
    ...operation,
    attempts,
    nextAttemptAt: now + retryDelay(attempts),
    lastError: message,
  });
  transaction.objectStore("diagnostics").add({
    at: now,
    level: "error",
    operation: operation.kind,
    entityId: operation.entityId,
    message,
  } satisfies DatabaseLog);
  await complete(transaction);
}

export async function storeConflict(operation: OutboxOperation, conflict: unknown) {
  const database = await openLocalDatabase();
  const transaction = database.transaction(["outbox", "conflicts"], "readwrite");
  transaction.objectStore("outbox").delete(operation.operationId);
  transaction.objectStore("conflicts").put({ ...operation, conflict, recordedAt: Date.now() });
  await complete(transaction);
}

export async function removeConflict(operationId: string) {
  const database = await openLocalDatabase();
  const transaction = database.transaction("conflicts", "readwrite");
  transaction.objectStore("conflicts").delete(operationId);
  await complete(transaction);
}

export async function applyPulledTabs(tabs: TrackedTabRecord[], cursor: SyncCursor) {
  const database = await openLocalDatabase();
  const transaction = database.transaction(["tabs", "meta"], "readwrite");
  const store = transaction.objectStore("tabs");
  for (const tab of tabs) store.put(tab);
  transaction.objectStore("meta").put(cursor, "tabsCursor");
  await complete(transaction);
}

export async function getTabsCursor(): Promise<SyncCursor> {
  const database = await openLocalDatabase();
  return (
    ((await request(database.transaction("meta").objectStore("meta").get("tabsCursor"))) as
      | SyncCursor
      | undefined) ?? { updatedAt: 0, id: "" }
  );
}

export async function compactLocalDatabase(now = Date.now()) {
  const database = await openLocalDatabase();
  const transaction = database.transaction(["tabs", "diagnostics"], "readwrite");
  const tabs = transaction.objectStore("tabs");
  const allTabs = (await request(tabs.getAll())) as TrackedTabRecord[];
  const tombstoneCutoff = now - 30 * 24 * 60 * 60 * 1000;
  for (const tab of allTabs) {
    if (tab.deletedAt && tab.deletedAt < tombstoneCutoff) tabs.delete(tab.id);
  }
  const diagnostics = transaction.objectStore("diagnostics");
  const keys = await request(diagnostics.getAllKeys());
  for (const key of keys.slice(0, Math.max(0, keys.length - 100))) diagnostics.delete(key);
  await complete(transaction);
}

export function retryDelay(attempts: number) {
  return Math.min(60 * 60 * 1000, 1000 * 2 ** Math.min(attempts, 12));
}

export type IndexedDbExport = {
  tabs: TrackedTabRecord[];
  outbox: OutboxOperation[];
  conflicts: unknown[];
  tabsCursor: SyncCursor;
};

export async function exportIndexedDb(): Promise<IndexedDbExport> {
  const database = await openLocalDatabase();
  const transaction = database.transaction(["tabs", "outbox", "conflicts", "meta"]);
  const [tabs, outbox, conflicts, tabsCursor] = await Promise.all([
    request(transaction.objectStore("tabs").getAll()),
    request(transaction.objectStore("outbox").getAll()),
    request(transaction.objectStore("conflicts").getAll()),
    request(transaction.objectStore("meta").get("tabsCursor")),
  ]);
  return {
    tabs: tabs as TrackedTabRecord[],
    outbox: outbox as OutboxOperation[],
    conflicts,
    tabsCursor: (tabsCursor as SyncCursor | undefined) ?? { updatedAt: 0, id: "" },
  };
}

export async function importIndexedDb(data: IndexedDbExport) {
  if (!Array.isArray(data.tabs) || !Array.isArray(data.outbox) || !Array.isArray(data.conflicts)) {
    throw new Error("Invalid TabTether export data");
  }
  const database = await openLocalDatabase();
  const transaction = database.transaction(["tabs", "outbox", "conflicts", "meta"], "readwrite");
  const tabs = transaction.objectStore("tabs");
  const outbox = transaction.objectStore("outbox");
  const conflicts = transaction.objectStore("conflicts");
  tabs.clear();
  outbox.clear();
  conflicts.clear();
  for (const tab of data.tabs) tabs.put(tab);
  for (const operation of data.outbox) outbox.put(operation);
  for (const conflict of data.conflicts) conflicts.put(conflict);
  transaction.objectStore("meta").put(data.tabsCursor ?? { updatedAt: 0, id: "" }, "tabsCursor");
  await complete(transaction);
}
