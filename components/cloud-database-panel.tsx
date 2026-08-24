import { useEffect, useRef, useState, useTransition } from "react";

import { isFirefoxFamily } from "../lib/browser-capabilities";
import type { ConflictResolution, ConflictView } from "../lib/conflict-view";
import { sendMessage, type PopupSnapshot } from "../lib/messaging";
import { M3Button } from "../entrypoints/popup/components/m3-button";
import { M3SwitchRow } from "../entrypoints/popup/components/m3-switch";
import { M3Select, M3TextField } from "../entrypoints/popup/components/m3-text-field";
import { DEFAULT_CLOUD_SYNC_POLICY, type CloudSyncPolicy } from "../services/database-service";
import type { DatabaseProvider } from "../services/database-service";
import type { DatabaseLog } from "../storage/indexed-db";

const RESOLUTION_LABELS: Record<ConflictResolution, string> = {
  keep_mine: "Keep mine",
  keep_theirs: "Keep theirs",
  dismiss: "Dismiss",
};

/** Must be invoked synchronously from a click handler (not inside startTransition). */
function requestCloudConsent(): Promise<boolean> {
  if (!isFirefoxFamily || typeof browser.permissions?.request !== "function") {
    return Promise.resolve(true);
  }

  return browser.permissions.request({
    data_collection: ["browsingActivity", "websiteContent", "technicalAndInteraction"],
  } as Parameters<typeof browser.permissions.request>[0]);
}

export function CloudDatabasePanel({
  snapshot,
  onUpdate,
}: {
  snapshot: PopupSnapshot;
  onUpdate: (snapshot: PopupSnapshot) => void;
}) {
  const [url, setUrl] = useState(snapshot.cloud.configuration?.url ?? "");
  const [provider, setProvider] = useState<DatabaseProvider>(
    snapshot.cloud.configuration?.provider ?? "libsql",
  );
  const [token, setToken] = useState("");
  const [persistent, setPersistent] = useState(
    snapshot.cloud.configuration?.tokenPersistence !== "session",
  );
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictView[] | null>(null);
  const [logs, setLogs] = useState<DatabaseLog[]>([]);
  const [behavior, setBehavior] = useState<CloudSyncPolicy>(
    snapshot.cloud.configuration?.behavior ?? DEFAULT_CLOUD_SYNC_POLICY,
  );
  const [pending, startTransition] = useTransition();
  const importInput = useRef<HTMLInputElement>(null);
  const cloudImportInput = useRef<HTMLInputElement>(null);

  const loadLogs = () =>
    sendMessage({ type: "GET_DATABASE_LOGS" }).then((response) => {
      if (response.ok) setLogs((response.logs ?? []) as DatabaseLog[]);
    });

  useEffect(() => {
    void loadLogs();
  }, [snapshot.cloud.status.lastSyncAt, snapshot.cloud.pending]);

  useEffect(() => {
    const next = snapshot.cloud.configuration?.behavior ?? DEFAULT_CLOUD_SYNC_POLICY;
    setBehavior((current) =>
      current.activitySync === next.activitySync &&
      current.scheduledSync === next.scheduledSync &&
      current.scheduledSyncIntervalMinutes === next.scheduledSyncIntervalMinutes
        ? current
        : next,
    );
  }, [
    snapshot.cloud.configuration?.behavior?.activitySync,
    snapshot.cloud.configuration?.behavior?.scheduledSync,
    snapshot.cloud.configuration?.behavior?.scheduledSyncIntervalMinutes,
  ]);

  const run = (action: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Cloud database action failed");
      }
    });
  };

  const connect = () => {
    setError(null);
    void requestCloudConsent()
      .then((granted) => {
        if (!granted) {
          setError("Cloud data transmission was not allowed");
          return;
        }
        startTransition(async () => {
          try {
            const response = await sendMessage({
              type: "CONFIGURE_CLOUD_DATABASE",
              url,
              authToken: token,
              provider,
              tokenPersistence: persistent ? "persistent" : "session",
              deviceName: snapshot.deviceName ?? "Browser",
              behavior,
            });
            if (!response.ok) throw new Error(response.error);
            setToken("");
            if (response.snapshot) onUpdate(response.snapshot);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Cloud database action failed");
          }
        });
      })
      .catch((cause) => {
        setError(
          cause instanceof Error ? cause.message : "Cloud data transmission was not allowed",
        );
      });
  };

  const sync = () =>
    run(async () => {
      const response = await sendMessage({ type: "SYNC_NOW" });
      if (!response.ok) throw new Error(response.error);
      if (response.snapshot) onUpdate(response.snapshot);
    });

  const disconnect = () =>
    run(async () => {
      const response = await sendMessage({ type: "DISCONNECT_CLOUD_DATABASE" });
      if (!response.ok) throw new Error(response.error);
      if (response.snapshot) onUpdate(response.snapshot);
    });

  const exportData = () =>
    run(async () => {
      const response = await sendMessage({ type: "EXPORT_DATA" });
      if (!response.ok || !response.exportData) {
        throw new Error(response.ok ? "Export returned no data" : response.error);
      }
      const href = URL.createObjectURL(
        new Blob([JSON.stringify(response.exportData, null, 2)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `tabtether-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(href);
    });

  const importData = (file: File) =>
    run(async () => {
      const response = await sendMessage({
        type: "IMPORT_DATA",
        data: JSON.parse(await file.text()),
      });
      if (!response.ok) throw new Error(response.error);
      if (response.snapshot) onUpdate(response.snapshot);
    });

  const exportCloudData = () =>
    run(async () => {
      const response = await sendMessage({ type: "EXPORT_CLOUD_DATABASE" });
      if (!response.ok || !response.cloudDatabaseExport) {
        throw new Error(response.ok ? "Cloud export returned no data" : response.error);
      }
      const href = URL.createObjectURL(
        new Blob([JSON.stringify(response.cloudDatabaseExport, null, 2)], {
          type: "application/json",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `tabtether-cloud-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(href);
    });

  const importCloudData = (file: File) =>
    run(async () => {
      if (!window.confirm("Replace this cloud database workspace with this backup?")) return;
      const response = await sendMessage({
        type: "IMPORT_CLOUD_DATABASE",
        data: JSON.parse(await file.text()),
      });
      if (!response.ok) throw new Error(response.error);
      if (response.snapshot) onUpdate(response.snapshot);
    });

  const showConflicts = () =>
    run(async () => {
      const response = await sendMessage({ type: "GET_CONFLICTS" });
      if (!response.ok) throw new Error(response.error);
      setConflicts(response.conflicts ?? []);
    });

  const resolveConflictAction = (operationId: string, resolution: ConflictResolution) =>
    run(async () => {
      const response = await sendMessage({
        type: "RESOLVE_CONFLICT",
        operationId,
        resolution,
      });
      if (!response.ok) throw new Error(response.error);
      setConflicts(response.conflicts ?? []);
      if (response.snapshot) onUpdate(response.snapshot);
    });

  const configuration = snapshot.cloud.configuration;
  const status = snapshot.cloud.status;

  return (
    <div className="panel stack settings-panel">
      <div className="row wrap" style={{ justifyContent: "space-between" }}>
        <span className="section-title" style={{ margin: 0 }}>
          Cloud database
        </span>
        <span className="pill">{status.state}</span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 11 }}>
        Sends tethered URLs, page titles, this device name, and settings only to the database you
        choose.
      </p>
      <div className="provider-choice" role="group" aria-label="Database provider">
        <span className="provider-choice__label">Database provider</span>
        <button
          className={`provider-choice__option${provider === "libsql" ? " provider-choice__option--selected" : ""}`}
          type="button"
          aria-pressed={provider === "libsql"}
          onClick={() => setProvider("libsql")}
        >
          libSQL / Turso / self-hosted
        </button>
        <button
          className={`provider-choice__option${provider === "d1" ? " provider-choice__option--selected" : ""}`}
          type="button"
          aria-pressed={provider === "d1"}
          onClick={() => setProvider("d1")}
        >
          Cloudflare D1 Worker
        </button>
      </div>
      <M3TextField
        id="cloud-database-url"
        label={provider === "d1" ? "Worker URL" : "Database URL"}
        type="url"
        value={url}
        onChange={setUrl}
      />
      <M3TextField
        id="cloud-database-token"
        label={configuration ? "New access token" : "Access token"}
        type="password"
        value={token}
        onChange={setToken}
        autoComplete="off"
      />
      <M3SwitchRow
        id="cloud-persist-token"
        title="Remember token"
        description={
          persistent ? "Stored in this browser profile" : "Forgotten when the browser session ends"
        }
        checked={persistent}
        onChange={setPersistent}
      />
      <M3Button block disabled={pending || !url.trim() || !token.trim()} onClick={connect}>
        {pending ? "Working…" : configuration ? "Test and update connection" : "Connect database"}
      </M3Button>
      {configuration ? (
        <>
          <M3SwitchRow
            id="database-activity-sync"
            title="Activity sync"
            description="Upload new tethers, renames, archive changes, and other explicit edits right away."
            checked={behavior.activitySync}
            onChange={(activitySync) => setBehavior((current) => ({ ...current, activitySync }))}
          />
          <M3SwitchRow
            id="database-scheduled-sync"
            title="Time sync"
            description="Periodically upload navigation updates and download changes from other devices."
            checked={behavior.scheduledSync}
            onChange={(scheduledSync) => setBehavior((current) => ({ ...current, scheduledSync }))}
          />
          <M3Select
            label="Time sync interval"
            value={String(behavior.scheduledSyncIntervalMinutes)}
            disabled={!behavior.scheduledSync}
            onChange={(event) =>
              setBehavior((current) => ({
                ...current,
                scheduledSyncIntervalMinutes: Number(
                  event.target.value,
                ) as CloudSyncPolicy["scheduledSyncIntervalMinutes"],
              }))
            }
          >
            {[2, 5, 15, 30].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </M3Select>
          <M3Button
            variant="tonal"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const response = await sendMessage({ type: "UPDATE_DATABASE_BEHAVIOR", behavior });
                if (!response.ok) throw new Error(response.error);
                if (response.snapshot) onUpdate(response.snapshot);
              })
            }
          >
            Save sync policy
          </M3Button>
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>
            Last sync:{" "}
            {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "not yet"} ·{" "}
            {snapshot.cloud.pending} pending · {snapshot.cloud.conflicts} conflicts
          </p>
          {status.lastError ? <p className="error">{status.lastError}</p> : null}
          <div className="row wrap">
            <M3Button variant="tonal" disabled={pending} onClick={sync}>
              Retry sync
            </M3Button>
            {snapshot.cloud.conflicts ? (
              <M3Button variant="text" disabled={pending} onClick={showConflicts}>
                View conflicts
              </M3Button>
            ) : null}
            <M3Button variant="text" disabled={pending} onClick={disconnect}>
              Disconnect and forget token
            </M3Button>
          </div>
          <div className="row wrap">
            <M3Button variant="text" disabled={pending} onClick={exportCloudData}>
              Export cloud backup
            </M3Button>
            <M3Button
              variant="text"
              disabled={pending}
              onClick={() => cloudImportInput.current?.click()}
            >
              Restore cloud backup
            </M3Button>
            <input
              ref={cloudImportInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importCloudData(file);
                event.target.value = "";
              }}
            />
          </div>
        </>
      ) : null}
      {conflicts ? (
        <div className="cloud-conflicts" role="list" aria-label="Sync conflicts">
          {conflicts.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 11 }}>
              No conflicts
            </p>
          ) : (
            conflicts.map((conflict) => (
              <article key={conflict.operationId} className="cloud-conflict" role="listitem">
                <div className="cloud-conflict__header">
                  <strong>{conflict.activityName}</strong>
                  <span className="pill">{conflict.kindLabel}</span>
                </div>
                <p className="cloud-conflict__reason">{conflict.reasonLabel}</p>
                <p className="muted cloud-conflict__summary">
                  Yours: {conflict.mineSummary}
                  {conflict.theirsSummary ? (
                    <>
                      <br />
                      Cloud: {conflict.theirsSummary}
                    </>
                  ) : null}
                </p>
                <div className="row wrap cloud-conflict__actions">
                  {conflict.actions.map((action) => (
                    <M3Button
                      key={action}
                      variant={action === "keep_mine" ? "tonal" : "text"}
                      disabled={pending}
                      onClick={() => resolveConflictAction(conflict.operationId, action)}
                    >
                      {RESOLUTION_LABELS[action]}
                    </M3Button>
                  ))}
                </div>
              </article>
            ))
          )}
        </div>
      ) : null}
      <div className="row wrap">
        <M3Button variant="text" disabled={pending} onClick={exportData}>
          Export data
        </M3Button>
        <M3Button variant="text" disabled={pending} onClick={() => importInput.current?.click()}>
          Import data
        </M3Button>
        <input
          ref={importInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) importData(file);
            event.target.value = "";
          }}
        />
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 11 }}>
        {provider === "d1"
          ? "Use the Worker token configured as TABTETHER_TOKEN. Exports never contain it."
          : "Use a database-scoped token. This also supports a self-hosted libSQL HTTP server. Exports never contain the token."}
      </p>
      <div className="stack">
        <div className="row wrap" style={{ justifyContent: "space-between" }}>
          <span className="section-title">Local change log</span>
          <M3Button
            variant="text"
            disabled={!logs.length}
            onClick={() =>
              void sendMessage({ type: "CLEAR_DATABASE_LOGS" }).then(() => setLogs([]))
            }
          >
            Clear logs
          </M3Button>
        </div>
        {logs.length ? (
          <div className="list compact-list">
            {logs.map((log, index) => (
              <div className="list-item" key={log.id ?? `${log.at}-${index}`}>
                <span className="name">{log.operation}</span>
                <span className="sub">{log.message}</span>
                <span className="sub">{new Date(log.at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No database changes logged yet.</p>
        )}
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
