import { useEffect, useState, useTransition } from "react";

import { ActivityListPanel } from "@/components/activity-list-panel";
import type { LocalDashboardTab } from "@/lib/open-dashboard";
import { HistoryRetentionPicker } from "@/components/history-retention-picker";
import { sendMessage, type PopupSnapshot } from "@/lib/messaging";
import { describeSyncModes } from "@/lib/sync-modes";
import type { PrivacySettings, SyncModes, TrackedTab } from "@/lib/types";
import { relativeTime } from "@/lib/view-utils";
import { CloudDatabasePanel } from "./cloud-database-panel";
import { CloudManagementPanel } from "./cloud-management-panel";

import { LanPairingPanel } from "../entrypoints/popup/components/lan-pairing-panel";
import { M3SwitchRow } from "../entrypoints/popup/components/m3-switch";
import { M3TextArea, M3TextField } from "../entrypoints/popup/components/m3-text-field";

export function LocalDashboardView({
  snapshot,
  onUpdate,
  onOpenHistory,
  initialTab = "tabs",
  onBack,
  closeOnOpenTab = false,
  syncHash = false,
  showHeader = true,
}: {
  snapshot: PopupSnapshot;
  onUpdate: (snapshot: PopupSnapshot) => void;
  onOpenHistory: (tab: TrackedTab) => void;
  initialTab?: LocalDashboardTab;
  onBack?: () => void;
  closeOnOpenTab?: boolean;
  syncHash?: boolean;
  showHeader?: boolean;
}) {
  const [tab, setTab] = useState<LocalDashboardTab>(initialTab);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const selectTab = (next: LocalDashboardTab) => {
    setTab(next);
    if (syncHash) {
      window.location.hash = next === "tabs" ? "" : next;
    }
  };

  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    });
  };

  const tabs: { id: LocalDashboardTab; label: string }[] = [
    { id: "tabs", label: "Tabs" },
    ...(snapshot.cloud.configuration
      ? [
          { id: "groups" as const, label: "Groups" },
          { id: "devices" as const, label: "Devices" },
        ]
      : []),
    ...(snapshot.syncModes.lan ? [{ id: "lan" as const, label: "LAN" }] : []),
    ...(snapshot.syncModes.online ? [{ id: "database" as const, label: "Database" }] : []),
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="stack local-dashboard">
      {showHeader ? (
        <div className="row local-dashboard__header">
          {onBack ? (
            <button className="btn ghost" type="button" onClick={onBack}>
              ← Back
            </button>
          ) : (
            <span />
          )}
          <span className="section-title" style={{ margin: 0 }}>
            {syncHash ? "TabTether" : "Local dashboard"}
          </span>
        </div>
      ) : null}

      {showHeader ? (
        <p className="muted" style={{ margin: 0, fontSize: 11 }}>
          {describeSyncModes(snapshot.syncModes)} · manage tabs on this device
          {snapshot.syncModes.lan ? " and nearby browsers" : ""}
        </p>
      ) : null}

      <div className="local-dashboard__tabs" role="tablist" aria-label="Dashboard sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`local-dashboard__tab${tab === item.id ? " local-dashboard__tab--active" : ""}`}
            onClick={() => selectTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "tabs" ? (
        <ActivityListPanel
          snapshot={snapshot}
          pending={pending}
          run={run}
          onUpdate={onUpdate}
          onOpenHistory={onOpenHistory}
          closeOnOpenTab={closeOnOpenTab}
          fullPage={syncHash}
        />
      ) : null}

      {tab === "lan" && snapshot.syncModes.lan ? (
        <LocalLanPanel
          snapshot={snapshot}
          pending={pending}
          onUpdate={onUpdate}
          setError={setError}
        />
      ) : null}

      {tab === "database" && snapshot.syncModes.online ? (
        <div role="tabpanel">
          <CloudDatabasePanel snapshot={snapshot} onUpdate={onUpdate} />
        </div>
      ) : null}

      {tab === "groups" ? (
        <CloudManagementPanel kind="groups" trackedTabs={snapshot.trackedTabs} onUpdate={onUpdate} />
      ) : null}
      {tab === "devices" ? (
        <CloudManagementPanel
          kind="devices"
          currentDeviceId={snapshot.cloud.configuration?.deviceId}
        />
      ) : null}

      {tab === "settings" ? <LocalSettingsPanel snapshot={snapshot} onUpdate={onUpdate} /> : null}

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

function LocalLanPanel({
  snapshot,
  pending,
  onUpdate,
  setError,
}: {
  snapshot: PopupSnapshot;
  pending: boolean;
  onUpdate: (snapshot: PopupSnapshot) => void;
  setError: (error: string | null) => void;
}) {
  const [, startTransition] = useTransition();

  return (
    <div className="stack" role="tabpanel">
      <div className="panel stack">
        <span className="section-title" style={{ margin: 0 }}>
          Pair a device
        </span>
        <LanPairingPanel compact snapshot={snapshot} lanSignalingMode="local" onUpdate={onUpdate} />
      </div>

      <div className="panel stack">
        <span className="section-title" style={{ margin: 0 }}>
          Paired devices
        </span>
        <p className="muted" style={{ margin: 0, fontSize: 11 }}>
          Connections last only while both browsers stay open. Offline devices must be paired again.
        </p>
        {snapshot.pairedLanDevices.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>
            No paired devices yet.
          </p>
        ) : (
          <div className="list compact-list">
            {snapshot.pairedLanDevices.map((device) => {
              const online = snapshot.lanPeerStatus[device.deviceId] ?? false;
              return (
                <div key={device.deviceId} className="panel compact-track">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="name">{device.deviceName}</span>
                    <span className="pill">{online ? "Connected" : "Offline"}</span>
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                    {device.browser ?? "Browser"} · paired {relativeTime(device.pairedAt)}
                  </p>
                  <div className="row wrap">
                    <button
                      className="btn danger"
                      disabled={pending}
                      onClick={() => {
                        setError(null);
                        startTransition(async () => {
                          const res = await sendMessage({
                            type: "REMOVE_LAN_PEER",
                            deviceId: device.deviceId,
                          });
                          if (!res.ok) {
                            setError(res.error);
                            return;
                          }
                          if (res.snapshot) onUpdate(res.snapshot);
                        });
                      }}
                    >
                      Unpair
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function LocalSettingsPanel({
  snapshot,
  onUpdate,
}: {
  snapshot: PopupSnapshot;
  onUpdate: (snapshot: PopupSnapshot) => void;
}) {
  const [deviceName, setDeviceName] = useState(snapshot.deviceName ?? "");
  const [syncModes, setSyncModes] = useState<SyncModes>(snapshot.syncModes);
  const [excluded, setExcluded] = useState(snapshot.settings.excludedHosts.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const patchSettings = (settings: Partial<PrivacySettings>) => {
    setError(null);
    startTransition(async () => {
      const res = await sendMessage({ type: "UPDATE_SETTINGS", settings });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.snapshot) onUpdate(res.snapshot);
      if (syncModes.online && !snapshot.syncModes.online) window.location.hash = "database";
    });
  };

  const saveSyncModes = () => {
    setError(null);
    startTransition(async () => {
      const res = await sendMessage({ type: "UPDATE_SYNC_MODES", syncModes });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.snapshot) onUpdate(res.snapshot);
    });
  };

  const saveDevice = () => {
    setError(null);
    startTransition(async () => {
      const res = await sendMessage({ type: "RENAME_DEVICE", name: deviceName.trim() });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.snapshot) onUpdate(res.snapshot);
    });
  };

  const saveExcluded = () => {
    const hosts = excluded
      .split(/[\n,]/)
      .map((h) => h.trim())
      .filter(Boolean);
    patchSettings({ excludedHosts: hosts });
  };

  const toggleSyncMode = (key: keyof SyncModes) => {
    setSyncModes((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className="stack" role="tabpanel">
      <div className="panel stack settings-panel">
        <span className="section-title" style={{ margin: 0 }}>
          Sync modes
        </span>
        <M3SwitchRow
          title="Offline"
          description="This browser only"
          checked={syncModes.offline}
          onChange={() => toggleSyncMode("offline")}
          id="dash-mode-offline"
        />
        <M3SwitchRow
          title="Online"
          description="Cloud database — enough on its own once connected"
          checked={syncModes.online}
          onChange={() => toggleSyncMode("online")}
          id="dash-mode-online"
        />
        <M3SwitchRow
          title="LAN"
          description="Same-network WebRTC sync"
          checked={syncModes.lan}
          onChange={() => toggleSyncMode("lan")}
          id="dash-mode-lan"
        />
        <button className="btn secondary" disabled={pending} onClick={saveSyncModes}>
          Save sync modes
        </button>
      </div>

      <div className="panel stack">
        <M3TextField
          id="local-dash-device"
          label="Device name"
          value={deviceName}
          onChange={setDeviceName}
        />
        <button className="btn secondary" disabled={pending} onClick={saveDevice}>
          Save device name
        </button>
      </div>

      <div className="panel stack settings-panel">
        <span className="section-title" style={{ margin: 0 }}>
          Privacy
        </span>
        <M3SwitchRow
          title="Record navigation history"
          checked={snapshot.settings.recordHistory}
          onChange={(checked) => patchSettings({ recordHistory: checked })}
          id="dash-record-history"
        />
        <M3SwitchRow
          title="Moved-on banner"
          description="Show a banner when a page is in tether history but the activity continued elsewhere"
          checked={snapshot.settings.showMovedOnBanner}
          onChange={(checked) => patchSettings({ showMovedOnBanner: checked })}
          id="dash-moved-on-banner"
        />
        <M3SwitchRow
          title="Store URL query parameters"
          checked={!snapshot.settings.stripQueryParams}
          onChange={(checked) => patchSettings({ stripQueryParams: !checked })}
          id="dash-store-query"
        />
        <M3SwitchRow
          title="Store URL fragments (#…)"
          checked={!snapshot.settings.stripFragments}
          onChange={(checked) => patchSettings({ stripFragments: !checked })}
          id="dash-store-fragments"
        />
        <HistoryRetentionPicker
          value={snapshot.settings.historyRetentionDays}
          disabled={pending}
          onChange={(historyRetentionDays) => patchSettings({ historyRetentionDays })}
        />
        <M3TextArea
          id="local-dash-excluded"
          label="Excluded websites"
          value={excluded}
          onChange={setExcluded}
          rows={3}
        />
        <button className="btn secondary" disabled={pending} onClick={saveExcluded}>
          Save exclusions
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
