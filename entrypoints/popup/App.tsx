import { useEffect, useState, useTransition } from "react";

import { displayHostPath } from "@/lib/privacy";
import { sendMessage, type PopupSnapshot } from "@/lib/messaging";
import { ExportActivityButtons } from "@/components/export-activity-buttons";
import { HistoryView } from "@/components/history-view";
import { ActivityMetadataEditor } from "@/components/activity-metadata-editor";
import { ActivityHealthBadges } from "@/components/activity-health-badges";
import { OnboardingView } from "@/components/onboarding-view";
import { ResumePicker } from "@/components/resume-picker";
import { SeriesTetherPanel } from "@/components/series-tether-panel";
import { TabActionsMenu } from "@/components/tab-actions-menu";
import { openDashboard } from "@/lib/open-dashboard";
import { describeSyncModes } from "@/lib/sync-modes";
import type { PrivacySettings, SyncModes, TrackedTab, TetherMode } from "@/lib/types";
import { seriesLearningProgress } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { supportedSyncModes, supportsLanSync } from "@/lib/browser-capabilities";
import { formatDevice, relativeTime } from "@/lib/view-utils";
import { activityHealthRecoveryHint, hasActivityHealthIssues } from "@/lib/activity-health";

import { ExtensionThemeProvider } from "./components/extension-theme-provider";
import { CollapsibleSection } from "./components/collapsible-section";
import { IconSettings } from "./components/icons";
import { LanPairingPanel } from "./components/lan-pairing-panel";
import { HistoryRetentionPicker } from "@/components/history-retention-picker";
import { M3SwitchRow } from "./components/m3-switch";
import { M3TextArea, M3TextField } from "./components/m3-text-field";

type View = "main" | "settings" | "history" | "resume";

function SettingsView({
  snapshot,
  onBack,
  onUpdate,
}: {
  snapshot: PopupSnapshot;
  onBack: () => void;
  onUpdate: (snapshot: PopupSnapshot) => void;
}) {
  const [deviceName, setDeviceName] = useState(snapshot.deviceName ?? "");
  const [syncModes, setSyncModes] = useState<SyncModes>(() =>
    supportedSyncModes(snapshot.syncModes),
  );
  const [showPairing, setShowPairing] = useState(false);
  const [excluded, setExcluded] = useState(snapshot.settings.excludedHosts.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setSyncModes(supportedSyncModes(snapshot.syncModes));
  }, [snapshot.syncModes]);

  const patchSettings = (settings: Partial<PrivacySettings>) => {
    setError(null);
    startTransition(async () => {
      const res = await sendMessage({ type: "UPDATE_SETTINGS", settings });
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

  const saveSyncModes = () => {
    setError(null);
    startTransition(async () => {
      const res = await sendMessage({ type: "UPDATE_SYNC_MODES", syncModes });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.snapshot) onUpdate(res.snapshot);
      if (syncModes.online && !snapshot.syncModes.online) openDashboard(snapshot, "database");
    });
  };

  const toggleSyncMode = (key: keyof SyncModes) => {
    setSyncModes((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="btn ghost" onClick={onBack}>
          ← Back
        </button>
        <span className="section-title" style={{ margin: 0 }}>
          Privacy & device
        </span>
      </div>

      <CollapsibleSection id="settings-sync-modes" title="Sync modes" defaultOpen>
        <div className="panel stack settings-panel">
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>
            At least one mode required
          </p>
          <M3SwitchRow
            title="Online"
            description="Cloud database — enough on its own once connected"
            checked={syncModes.online}
            onChange={() => toggleSyncMode("online")}
            id="settings-mode-online"
          />
          <M3SwitchRow
            title="Offline"
            description="This browser only"
            checked={syncModes.offline}
            onChange={() => toggleSyncMode("offline")}
            id="settings-mode-offline"
          />
          {supportsLanSync ? (
            <M3SwitchRow
              title="LAN"
              description="Same-network WebRTC sync"
              checked={syncModes.lan}
              onChange={() => toggleSyncMode("lan")}
              id="settings-mode-lan"
            />
          ) : null}
          <button className="btn secondary" disabled={pending} onClick={saveSyncModes}>
            Save sync modes
          </button>
          <button
            className="btn ghost"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await sendMessage({ type: "SYNC_NOW" });
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                if (res.snapshot) onUpdate(res.snapshot);
              });
            }}
          >
            Sync all modes now
          </button>
        </div>
      </CollapsibleSection>

      {supportsLanSync && (snapshot.syncModes.lan || syncModes.lan) ? (
        <CollapsibleSection
          id="settings-lan"
          title="LAN devices"
          defaultOpen={snapshot.pairedLanDevices.length > 0}
          badge={`${snapshot.pairedLanDevices.length} paired`}
        >
          <div className="panel stack">
            <p className="muted" style={{ margin: 0, fontSize: 11 }}>
              Pair via copied tokens. A connection lasts only while both browsers stay open; an
              Offline peer needs a new pairing exchange.
            </p>
            {snapshot.pairedLanDevices.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                No paired devices. Pair from another browser using a token below.
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
                  );
                })}
              </div>
            )}
            {!showPairing ? (
              <button
                className="btn secondary"
                disabled={pending}
                onClick={() => setShowPairing(true)}
              >
                Pair new device
              </button>
            ) : (
              <LanPairingPanel
                compact
                snapshot={snapshot}
                lanSignalingMode="local"
                syncModes={syncModes}
                onUpdate={(next) => {
                  onUpdate(next);
                  setShowPairing(false);
                }}
                onPaired={() => setShowPairing(false)}
              />
            )}
          </div>
        </CollapsibleSection>
      ) : null}

      <CollapsibleSection id="settings-device" title="This device">
        <div className="panel stack">
          <M3TextField
            id="device"
            label="Device name"
            value={deviceName}
            onChange={setDeviceName}
          />
          <button className="btn secondary" disabled={pending} onClick={saveDevice}>
            Save device name
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection id="settings-privacy" title="Privacy">
        <div className="panel stack settings-panel">
          <M3SwitchRow
            title="Record navigation history"
            checked={snapshot.settings.recordHistory}
            onChange={(checked) => patchSettings({ recordHistory: checked })}
            id="settings-record-history"
          />
          <M3SwitchRow
            title="Moved-on banner"
            description="Show a banner when a page is in tether history but the activity continued elsewhere"
            checked={snapshot.settings.showMovedOnBanner}
            onChange={(checked) => patchSettings({ showMovedOnBanner: checked })}
            id="settings-moved-on-banner"
          />
          <M3SwitchRow
            title="Store URL query parameters"
            description="Auth-related query keys are always removed"
            checked={!snapshot.settings.stripQueryParams}
            onChange={(checked) => patchSettings({ stripQueryParams: !checked })}
            id="settings-store-query"
          />
          <M3SwitchRow
            title="Store URL fragments (#…)"
            checked={!snapshot.settings.stripFragments}
            onChange={(checked) => patchSettings({ stripFragments: !checked })}
            id="settings-store-fragments"
          />
          <HistoryRetentionPicker
            value={snapshot.settings.historyRetentionDays}
            disabled={pending}
            onChange={(historyRetentionDays) => patchSettings({ historyRetentionDays })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection id="settings-exclusions" title="Excluded websites">
        <div className="panel stack">
          <M3TextArea
            id="excluded"
            label="One host per line"
            value={excluded}
            onChange={setExcluded}
            rows={4}
          />
          <button className="btn secondary" disabled={pending} onClick={saveExcluded}>
            Save exclusions
          </button>
        </div>
      </CollapsibleSection>

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

function HistoryPanel({
  tab,
  onBack,
  onUpdate,
}: {
  tab: TrackedTab;
  onBack: () => void;
  onUpdate: (snapshot: PopupSnapshot) => void;
}) {
  return <HistoryView tab={tab} onBack={onBack} onUpdate={onUpdate} />;
}

function MainView({
  snapshot,
  onUpdate,
  onOpenSettings,
  onOpenHistory,
  onOpenResume,
}: {
  snapshot: PopupSnapshot;
  onUpdate: (snapshot: PopupSnapshot) => void;
  onOpenSettings: () => void;
  onOpenHistory: (tab: TrackedTab) => void;
  onOpenResume: () => void;
}) {
  const [name, setName] = useState("");
  const [tetherMode, setTetherMode] = useState<TetherMode>("loose");
  const [showSeriesPanel, setShowSeriesPanel] = useState(false);
  const [showDetailsPanel, setShowDetailsPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const current = snapshot.currentTab;
  const tracked = current?.tracked ?? null;
  const boundCount = tracked ? (snapshot.boundTabCounts[tracked.id] ?? 0) : 0;
  const tetheredOpenTabs = snapshot.openTabs.filter((tab) => tab.tracked);
  const untetheredOpenTabs = snapshot.openTabs.filter((tab) => !tab.tracked);
  const unhealthyCount = snapshot.trackedTabs.filter(
    (tab) => tab.health && hasActivityHealthIssues(tab.health),
  ).length;

  useEffect(() => {
    setName(tracked?.name ?? current?.title ?? "");
  }, [tracked?.id, tracked?.name, current?.title]);

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

  const canTrack = Boolean(current && !tracked);
  const movedOn = current?.movedOn ?? null;
  const seriesProgress = seriesLearningProgress(tracked?.seriesPattern);

  return (
    <div className="stack">
      <header className="popup-header">
        <div className="popup-header__brand">
          <img src="/icon/128.png" width={22} height={22} alt="" />
          <h1>TabTether</h1>
        </div>
        <div className="popup-header__actions">
          <span className="pill">{describeSyncModes(snapshot.syncModes)}</span>
          {snapshot.pendingSyncCount > 0 ? (
            <button
              className="btn ghost compact"
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const res = await sendMessage({ type: "SYNC_NOW" });
                  if (!res.ok) throw new Error(res.error);
                  if (res.snapshot) onUpdate(res.snapshot);
                })
              }
            >
              Retry sync
            </button>
          ) : null}
          <button
            className="btn ghost icon-btn"
            type="button"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
          >
            <IconSettings />
          </button>
        </div>
      </header>

      {snapshot.pendingSyncCount > 0 ? (
        <p className="muted sync-pending-note" role="status">
          {snapshot.pendingSyncCount} queued update
          {snapshot.pendingSyncCount === 1 ? "" : "s"} waiting to sync.
        </p>
      ) : null}

      {snapshot.pendingReconnect.length > 0 ? (
        <CollapsibleSection
          id="reconnect"
          title="Reconnect"
          defaultOpen
          badge={`${snapshot.pendingReconnect.length}`}
        >
          <div className="list">
            {snapshot.pendingReconnect.slice(0, 3).map((candidate) => (
              <div key={`${candidate.trackedTabId}:${candidate.browserTabId}`} className="panel">
                <p className="title" style={{ margin: 0 }}>
                  {candidate.trackedTabName}
                </p>
                <p className="url">{displayHostPath(candidate.url)}</p>
                <div className="row">
                  <button
                    className="btn"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const res = await sendMessage({
                          type: "CONFIRM_RECONNECT",
                          candidate,
                          takeOver: true,
                        });
                        if (!res.ok) throw new Error(res.error);
                        if (res.snapshot) onUpdate(res.snapshot);
                      })
                    }
                  >
                    Reconnect
                  </button>
                  <button
                    className="btn secondary"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const res = await sendMessage({
                          type: "DISMISS_RECONNECT",
                          candidate,
                        });
                        if (!res.ok) throw new Error(res.error);
                        if (res.snapshot) onUpdate(res.snapshot);
                      })
                    }
                  >
                    Skip
                  </button>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      ) : null}

      <CollapsibleSection
        id="current-page"
        title="Current page"
        defaultOpen
        badge={
          movedOn
            ? "Moved on"
            : tracked
              ? tracked.name
              : current
                ? current.title || displayHostPath(current.url)
                : undefined
        }
      >
        {movedOn ? (
          <div className="panel stack moved-on-card">
            <p className="title" style={{ margin: 0 }}>
              {movedOn.emoji ? `${movedOn.emoji} ` : ""}
              {movedOn.name} continued from where you left
            </p>
            <p className="url">
              {movedOn.chaptersBehind && movedOn.chaptersBehind > 0
                ? movedOn.chaptersBehind === 1
                  ? "1 chapter behind · "
                  : `${movedOn.chaptersBehind} chapters behind · `
                : null}
              Now at {displayHostPath(movedOn.currentUrl)}
            </p>
            {movedOn.pageLabel && movedOn.currentLabel ? (
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                {movedOn.pageLabel} → {movedOn.currentLabel}
              </p>
            ) : null}
            {movedOn.recentStops.length > 0 ? (
              <div className="stack" style={{ gap: 6 }}>
                <span className="muted" style={{ margin: 0, fontSize: 11 }}>
                  Jump to a recent stop:
                </span>
                <div className="list compact-list">
                  {movedOn.recentStops.map((stop) => (
                    <button
                      key={stop.url}
                      className="btn secondary"
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          const res = await sendMessage({
                            type: "MOVED_ON_GO_TO",
                            trackedTabId: movedOn.trackedTabId,
                            tabId: current?.id,
                            url: stop.url,
                          });
                          if (!res.ok) throw new Error(res.error);
                          if (res.snapshot) onUpdate(res.snapshot);
                        })
                      }
                    >
                      {stop.title?.trim() || displayHostPath(stop.url)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="row wrap action-row">
              <button
                className="btn compact"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const res = await sendMessage({
                      type: "MOVED_ON_GO_TO",
                      trackedTabId: movedOn.trackedTabId,
                      tabId: current?.id,
                    });
                    if (!res.ok) throw new Error(res.error);
                    if (res.snapshot) onUpdate(res.snapshot);
                  })
                }
              >
                Go To
              </button>
              <button
                className="btn secondary compact"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const res = await sendMessage({
                      type: "MOVED_ON_RESET_HERE",
                      trackedTabId: movedOn.trackedTabId,
                      tabId: current?.id,
                    });
                    if (!res.ok) throw new Error(res.error);
                    if (res.snapshot) onUpdate(res.snapshot);
                  })
                }
              >
                Reset to this page
              </button>
              <button
                className="btn ghost compact"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const res = await sendMessage({
                      type: "MOVED_ON_DISMISS",
                      trackedTabId: movedOn.trackedTabId,
                      pageUrl: movedOn.pageUrl,
                      currentUrl: movedOn.currentUrl,
                    });
                    if (!res.ok) throw new Error(res.error);
                    if (res.snapshot) onUpdate(res.snapshot);
                  })
                }
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
        {!current ? (
          <div className="panel">
            <p className="muted" style={{ margin: 0 }}>
              Open a normal web page to tether it.
            </p>
          </div>
        ) : tracked ? (
          <div className="panel compact-track">
            <div className="status-row">
              <span className="status-dot" />
              Tethered
              {tracked.tetherMode === "series" ? <span className="pill">Series</span> : null}
              {tracked.isPrivate ? <span className="pill">Private</span> : null}
              {!current.isActiveOwner ? (
                <span className="pill pill--warning">owned elsewhere</span>
              ) : null}
            </div>
            <ActivityHealthBadges health={tracked.health} />
            {tracked.health && activityHealthRecoveryHint(tracked.health) ? (
              <p className="activity-health-hint">{activityHealthRecoveryHint(tracked.health)}</p>
            ) : null}
            {boundCount > 1 ? (
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                {boundCount} browser tabs are linked to this activity.
              </p>
            ) : null}
            {tracked.tetherMode === "series" && seriesProgress ? (
              <p className="muted series-tether-notice" style={{ margin: 0, fontSize: 11 }}>
                Learning this series ({seriesProgress.current}/{seriesProgress.required} page
                changes). Stay on the same series while TabTether learns the pattern.
              </p>
            ) : null}
            {tracked.tetherMode === "series" && tracked.seriesPattern?.status === "ready" ? (
              <p className="muted series-tether-notice" style={{ margin: 0, fontSize: 11 }}>
                Series pattern active
                {tracked.seriesPattern.stableTokens.length
                  ? `: ${tracked.seriesPattern.stableTokens[0]}`
                  : ""}
                . Off-series pages will not update this tether.
              </p>
            ) : null}
            {showDetailsPanel ? (
              <ActivityMetadataEditor
                tracked={tracked}
                snapshot={snapshot}
                onUpdate={onUpdate}
                compact
                onSaved={() => setShowDetailsPanel(false)}
              />
            ) : (
              <button
                className="btn secondary"
                disabled={pending}
                onClick={() => setShowDetailsPanel(true)}
              >
                Edit name, emoji, tags…
              </button>
            )}
            <p className="url" title={displayHostPath(tracked.currentUrl)}>
              {displayHostPath(tracked.currentUrl)}
            </p>
            <p className="muted" style={{ margin: 0, fontSize: 11 }}>
              Last updated from {formatDevice(tracked)} · {relativeTime(tracked.lastUpdatedAt)}
            </p>
            <div className="row wrap action-row">
              {!current.isActiveOwner ? (
                <button
                  className="btn compact"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const res = await sendMessage({
                        type: "TAKE_OVER",
                        trackedTabId: tracked.id,
                      });
                      if (!res.ok) throw new Error(res.error);
                      if (res.snapshot) onUpdate(res.snapshot);
                    })
                  }
                >
                  Take over
                </button>
              ) : null}
              <button
                className="btn secondary compact"
                disabled={pending}
                onClick={() => onOpenHistory(tracked)}
              >
                History
              </button>
              <button
                className="btn secondary compact"
                disabled={pending}
                onClick={() => openDashboard(snapshot, "tabs")}
              >
                Dashboard
              </button>
              {boundCount > 1 ? (
                <button
                  className="btn danger compact"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const res = await sendMessage({ type: "UNBIND_TAB" });
                      if (!res.ok) throw new Error(res.error);
                      if (res.snapshot) onUpdate(res.snapshot);
                    })
                  }
                >
                  Untether this tab
                </button>
              ) : (
                <button
                  className="btn danger compact"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const res = await sendMessage({
                        type: "STOP_TRACKING",
                        trackedTabId: tracked.id,
                      });
                      if (!res.ok) throw new Error(res.error);
                      if (res.snapshot) onUpdate(res.snapshot);
                    })
                  }
                >
                  Untether
                </button>
              )}
              <TabActionsMenu>
                <button
                  className="btn ghost"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const watching = snapshot.watchedActivityIds.includes(tracked.id);
                      const res = await sendMessage({
                        type: "SET_WATCH",
                        trackedTabId: tracked.id,
                        watching: !watching,
                      });
                      if (!res.ok) throw new Error(res.error);
                      if (res.snapshot) onUpdate(res.snapshot);
                    })
                  }
                >
                  {snapshot.watchedActivityIds.includes(tracked.id) ? "Stop watching" : "Watch"}
                </button>
                <ExportActivityButtons tracked={tracked} disabled={pending} />
                {!tracked.archivedAt ? (
                  <button
                    className="btn ghost"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const res = await sendMessage({
                          type: "ARCHIVE_TAB",
                          trackedTabId: tracked.id,
                        });
                        if (!res.ok) throw new Error(res.error);
                        if (res.snapshot) onUpdate(res.snapshot);
                      })
                    }
                  >
                    Archive
                  </button>
                ) : (
                  <button
                    className="btn ghost"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const res = await sendMessage({
                          type: "RESTORE_TAB",
                          trackedTabId: tracked.id,
                        });
                        if (!res.ok) throw new Error(res.error);
                        if (res.snapshot) onUpdate(res.snapshot);
                      })
                    }
                  >
                    Restore
                  </button>
                )}
                <button
                  className="btn ghost"
                  disabled={pending}
                  onClick={() => setShowSeriesPanel((value) => !value)}
                >
                  {showSeriesPanel ? "Hide series pattern" : "Series pattern"}
                </button>
                {boundCount > 1 ? (
                  <button
                    className="btn danger"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const res = await sendMessage({
                          type: "STOP_TRACKING",
                          trackedTabId: tracked.id,
                        });
                        if (!res.ok) throw new Error(res.error);
                        if (res.snapshot) onUpdate(res.snapshot);
                      })
                    }
                  >
                    Delete activity
                  </button>
                ) : null}
              </TabActionsMenu>
            </div>
            {showSeriesPanel ? (
              <SeriesTetherPanel
                key={`${tracked.id}-${tracked.lastUpdatedAt}`}
                tracked={tracked}
                compact
                onUpdate={onUpdate}
              />
            ) : null}
          </div>
        ) : (
          <div className="panel stack">
            <p className="title" style={{ margin: 0 }} title={current.title || "Untitled page"}>
              {current.title || "Untitled page"}
            </p>
            <p className="url" title={displayHostPath(current.url)}>
              {displayHostPath(current.url)}
            </p>
            <M3TextField
              id="track-name"
              label="Name (optional)"
              value={name}
              onChange={setName}
              placeholder="e.g. Novel, Research notes"
            />
            <div className="provider-choice" role="group" aria-label="Tether mode">
              <span className="provider-choice__label">Tether mode</span>
              <button
                className={`provider-choice__option${tetherMode === "loose" ? " provider-choice__option--selected" : ""}`}
                type="button"
                aria-pressed={tetherMode === "loose"}
                onClick={() => setTetherMode("loose")}
              >
                Loose
              </button>
              <button
                className={`provider-choice__option${tetherMode === "series" ? " provider-choice__option--selected" : ""}`}
                type="button"
                aria-pressed={tetherMode === "series"}
                onClick={() => setTetherMode("series")}
              >
                Series
              </button>
            </div>
            {tetherMode === "loose" ? (
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                Loose tether follows any page on the same website.
              </p>
            ) : (
              <p className="muted series-tether-notice" style={{ margin: 0, fontSize: 11 }}>
                Series tether learns what stays the same across pages. Stay on the same series;
                after 3 page changes TabTether builds a regex from the repeating URL/title parts.
              </p>
            )}
            <button
              className="btn block track-cta"
              disabled={pending || !canTrack}
              onClick={() =>
                run(async () => {
                  const res = await sendMessage({
                    type: "TRACK_TAB",
                    name: name.trim() || undefined,
                    tetherMode,
                  });
                  if (!res.ok) throw new Error(res.error);
                  if (res.snapshot) onUpdate(res.snapshot);
                })
              }
            >
              {pending
                ? "Tethering…"
                : tetherMode === "series"
                  ? "Tether this series"
                  : "Tether this tab"}
            </button>
            {canTrack && snapshot.trackedTabs.length > 0 ? (
              <div className="stack">
                <span className="muted" style={{ margin: 0, fontSize: 11 }}>
                  Or link this tab to an existing activity:
                </span>
                <div className="list compact-list">
                  {snapshot.trackedTabs.map((activity) => (
                    <button
                      key={activity.id}
                      className="list-item"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          const res = await sendMessage({
                            type: "BIND_TAB",
                            trackedTabId: activity.id,
                          });
                          if (!res.ok) throw new Error(res.error);
                          if (res.snapshot) onUpdate(res.snapshot);
                        })
                      }
                    >
                      <span
                        className="name"
                        title={`${activity.emoji ? `${activity.emoji} ` : ""}${activity.name}`}
                      >
                        {activity.emoji ? `${activity.emoji} ` : ""}
                        {activity.name}
                      </span>
                      <span className="sub" title={displayHostPath(activity.currentUrl)}>
                        {displayHostPath(activity.currentUrl)}
                      </span>
                      {(snapshot.boundTabCounts[activity.id] ?? 0) > 0 ? (
                        <span className="sub">
                          {snapshot.boundTabCounts[activity.id]} tab
                          {snapshot.boundTabCounts[activity.id] === 1 ? "" : "s"} open
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </CollapsibleSection>

      {snapshot.catchUp.length > 0 ? (
        <CollapsibleSection
          id="catch-up"
          title="Catch up"
          defaultOpen
          badge={`${snapshot.catchUp.length}`}
        >
          <div className="list">
            {snapshot.catchUp.map((item) => (
              <div key={item.trackedTabId} className="panel">
                <p className="title" style={{ margin: 0 }}>
                  {item.emoji ? `${item.emoji} ` : ""}
                  {item.name}
                </p>
                <p className="url">
                  {item.progressLabel ? `${item.progressLabel} · ` : "Behind · "}
                  Now at {displayHostPath(item.currentUrl)}
                </p>
                <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                  Last opened here {relativeTime(item.lastSeenAt)}
                </p>
                <div className="row wrap">
                  <button
                    className="btn"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const res = await sendMessage({
                          type: "OPEN_TAB",
                          trackedTabId: item.trackedTabId,
                          takeOver: true,
                        });
                        if (!res.ok) throw new Error(res.error);
                        if (res.snapshot) onUpdate(res.snapshot);
                        window.close();
                      })
                    }
                  >
                    Catch up
                  </button>
                  <button
                    className="btn secondary"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const res = await sendMessage({
                          type: "MARK_SEEN",
                          trackedTabId: item.trackedTabId,
                          url: item.currentUrl,
                        });
                        if (!res.ok) throw new Error(res.error);
                        if (res.snapshot) onUpdate(res.snapshot);
                      })
                    }
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      ) : null}

      {snapshot.openTabs.length > 0 ? (
        <CollapsibleSection
          id="window-tabs"
          title="Tabs in this window"
          badge={`${tetheredOpenTabs.length} tethered · ${untetheredOpenTabs.length} untethered`}
        >
          <div className="list compact-list">
            {snapshot.openTabs.map((tab) => (
              <div
                key={tab.tabId}
                className={`list-item window-tab-item${tab.active ? " current" : ""}`}
                style={{ cursor: "default" }}
              >
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <span className="name" title={tab.title || "Untitled page"}>
                    {tab.title || "Untitled page"}
                  </span>
                  {tab.active ? <span className="pill">Active</span> : null}
                  {tab.tracked ? <span className="pill">Tethered</span> : null}
                </div>
                <span className="sub" title={displayHostPath(tab.url)}>
                  {displayHostPath(tab.url)}
                </span>
                {tab.tracked ? (
                  <span className="sub">
                    {tab.tracked.emoji ? `${tab.tracked.emoji} ` : ""}
                    {tab.tracked.name}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      ) : null}

      <CollapsibleSection
        id="all-activities"
        title="All activities"
        defaultOpen={snapshot.trackedTabs.length <= 4}
        badge={`${snapshot.trackedTabs.length}${unhealthyCount > 0 ? ` · ${unhealthyCount} need attention` : ""}`}
        actions={
          snapshot.trackedTabs.length > 0 ? (
            <button className="btn secondary" type="button" onClick={onOpenResume}>
              Resume…
            </button>
          ) : null
        }
      >
        {snapshot.trackedTabs.length === 0 ? (
          <div className="empty">No tethered activities yet.</div>
        ) : (
          <div className="list compact-list">
            {snapshot.trackedTabs.map((tab) => (
              <button
                key={tab.id}
                className={`list-item${tracked?.id === tab.id ? " current" : ""}`}
                disabled={pending}
                title="Resume on this device (open & take over)"
                onClick={() =>
                  run(async () => {
                    const res = await sendMessage({
                      type: "OPEN_TAB",
                      trackedTabId: tab.id,
                      takeOver: true,
                    });
                    if (!res.ok) throw new Error(res.error);
                    if (res.snapshot) onUpdate(res.snapshot);
                    window.close();
                  })
                }
              >
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <span
                    className="name"
                    title={`${tab.emoji ? `${tab.emoji} ` : ""}${tab.name}${tracked?.id === tab.id ? " (current page)" : ""}`}
                  >
                    {tab.emoji ? `${tab.emoji} ` : ""}
                    {tab.name}
                    {tracked?.id === tab.id ? " (current page)" : ""}
                  </span>
                  {snapshot.catchUp.some((item) => item.trackedTabId === tab.id) ? (
                    <span className="pill pill--warning">Behind</span>
                  ) : snapshot.watchedActivityIds.includes(tab.id) ? (
                    <span className="pill">Watching</span>
                  ) : null}
                </div>
                <ActivityHealthBadges health={tab.health} />
                <span className="sub" title={tab.currentTitle || displayHostPath(tab.currentUrl)}>
                  {tab.currentTitle || displayHostPath(tab.currentUrl)}
                </span>
                <span className="sub">
                  {(snapshot.boundTabCounts[tab.id] ?? 0) > 0
                    ? `${snapshot.boundTabCounts[tab.id]} tab${snapshot.boundTabCounts[tab.id] === 1 ? "" : "s"} open · `
                    : ""}
                  {formatDevice(tab)} · {relativeTime(tab.lastUpdatedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<PopupSnapshot | null>(null);
  const [view, setView] = useState<View>("main");
  const [historyTab, setHistoryTab] = useState<TrackedTab | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    void sendMessage({ type: "GET_SNAPSHOT" }).then((res) => {
      if (!res.ok) {
        setBootError(res.error);
        return;
      }

      setSnapshot(res.snapshot ?? null);
    });
  }, []);

  const themeSettings = snapshot?.settings ?? DEFAULT_SETTINGS;

  if (bootError) {
    return (
      <ExtensionThemeProvider settings={themeSettings}>
        <div className="app">
          <p className="error">{bootError}</p>
        </div>
      </ExtensionThemeProvider>
    );
  }

  if (!snapshot) {
    return (
      <ExtensionThemeProvider settings={themeSettings}>
        <div className="app">
          <div className="empty">Loading…</div>
        </div>
      </ExtensionThemeProvider>
    );
  }

  return (
    <ExtensionThemeProvider settings={snapshot.settings}>
      <div className="app">
        {!snapshot.onboardingComplete ? (
          <OnboardingView snapshot={snapshot} onUpdate={setSnapshot} />
        ) : view === "settings" ? (
          <SettingsView snapshot={snapshot} onBack={() => setView("main")} onUpdate={setSnapshot} />
        ) : view === "history" && historyTab ? (
          <HistoryPanel
            tab={historyTab}
            onBack={() => {
              setView("main");
              setHistoryTab(null);
            }}
            onUpdate={setSnapshot}
          />
        ) : view === "resume" ? (
          <ResumePicker
            snapshot={snapshot}
            onUpdate={setSnapshot}
            onBack={() => setView("main")}
            closeOnResume
          />
        ) : (
          <MainView
            snapshot={snapshot}
            onUpdate={setSnapshot}
            onOpenSettings={() => openDashboard(snapshot, "settings")}
            onOpenHistory={(tab) => {
              setHistoryTab(tab);
              setView("history");
            }}
            onOpenResume={() => setView("resume")}
          />
        )}
      </div>
    </ExtensionThemeProvider>
  );
}

export default App;
