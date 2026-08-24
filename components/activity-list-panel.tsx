import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ActivityHealthBadges } from "@/components/activity-health-badges";
import { ActivityMetadataEditor } from "@/components/activity-metadata-editor";
import { ExportActivityButtons } from "@/components/export-activity-buttons";
import {
  activityHealthRecoveryHint,
  hasActivityHealthIssues,
} from "@/lib/activity-health";
import { activityMatchesQuery } from "@/lib/activity-search";
import { displayHostPath } from "@/lib/privacy";
import { sendMessage, type PopupSnapshot } from "@/lib/messaging";
import { describeSeriesPattern, type TrackedTab } from "@/lib/types";
import { formatDevice, relativeTime } from "@/lib/view-utils";
import { M3Button } from "../entrypoints/popup/components/m3-button";
import { IconMoreVertical } from "../entrypoints/popup/components/icons";
import { M3Select, M3TextField } from "../entrypoints/popup/components/m3-text-field";
import { SeriesTetherPanel } from "./series-tether-panel";

type ActivityView = "active" | "archived";

type CloudGroupOption = { id: string; name: string };

function TabActionsMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  const toggle = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        top: Math.min(rect.bottom + 6, window.innerHeight - 190),
        left: Math.max(8, Math.min(rect.right - 240, window.innerWidth - 248)),
      });
    }
    setOpen((value) => !value);
  };

  return (
    <>
      <button
        ref={trigger}
        className="btn secondary tab-actions-menu__trigger"
        type="button"
        aria-label="More actions"
        aria-expanded={open}
        onClick={toggle}
      >
        <IconMoreVertical />
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              className="tab-actions-menu__items"
              role="menu"
              style={position}
              onClick={() => setOpen(false)}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function ActivityListPanel({
  snapshot,
  pending,
  run,
  onUpdate,
  onOpenHistory,
  closeOnOpenTab,
  fullPage,
}: {
  snapshot: PopupSnapshot;
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
  onUpdate: (snapshot: PopupSnapshot) => void;
  onOpenHistory: (tab: TrackedTab) => void;
  closeOnOpenTab: boolean;
  fullPage: boolean;
}) {
  const [view, setView] = useState<ActivityView>("active");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [seriesPanelId, setSeriesPanelId] = useState<string | null>(null);
  const [bulkTags, setBulkTags] = useState("");
  const [bulkMoveGroupId, setBulkMoveGroupId] = useState("");
  const [showBulkTags, setShowBulkTags] = useState(false);
  const [showBulkMove, setShowBulkMove] = useState(false);
  const [groups, setGroups] = useState<CloudGroupOption[]>([]);
  const [, startGroupsTransition] = useTransition();

  const tabs = useMemo(() => {
    const byArchive = snapshot.trackedTabs.filter((tab) =>
      view === "active" ? !tab.archivedAt : Boolean(tab.archivedAt),
    );
    return byArchive.filter((tab) => activityMatchesQuery(tab, deferredQuery));
  }, [deferredQuery, snapshot.trackedTabs, view]);
  const selectedVisibleIds = tabs.filter((tab) => selectedIds.has(tab.id)).map((tab) => tab.id);
  const unhealthyCount = snapshot.trackedTabs.filter(
    (tab) => tab.health && hasActivityHealthIssues(tab.health),
  ).length;
  const hasCloudGroups = Boolean(snapshot.cloud.configuration);

  useEffect(() => {
    if (!hasCloudGroups) return;
    startGroupsTransition(async () => {
      const response = await sendMessage({ type: "LIST_CLOUD_GROUPS" });
      if (!response.ok) return;
      setGroups((response.groups ?? []) as CloudGroupOption[]);
    });
  }, [hasCloudGroups, snapshot.cloud.status.lastSyncAt]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [view]);

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulk = (fn: () => Promise<void>) => {
    run(async () => {
      await fn();
      setSelectedIds(new Set());
      setShowBulkTags(false);
      setShowBulkMove(false);
      setBulkTags("");
      setBulkMoveGroupId("");
    });
  };

  return (
    <div className="stack" role="tabpanel">
      <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <span className="section-title" style={{ margin: 0 }}>
          Tethered tabs
        </span>
        <div className="row wrap" style={{ gap: 6 }}>
          <button
            className={`btn ghost${view === "active" ? " provider-choice__option--selected" : ""}`}
            disabled={pending}
            onClick={() => setView("active")}
          >
            Active
          </button>
          <button
            className={`btn ghost${view === "archived" ? " provider-choice__option--selected" : ""}`}
            disabled={pending}
            onClick={() => setView("archived")}
          >
            Archived
          </button>
          <M3Button
            variant="text"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await sendMessage({ type: "SYNC_NOW" });
                if (!res.ok) throw new Error(res.error);
                if (res.snapshot) onUpdate(res.snapshot);
              })
            }
          >
            Sync now
          </M3Button>
        </div>
      </div>

      <M3TextField
        id="dashboard-activity-search"
        label="Search activities"
        value={query}
        onChange={setQuery}
      />

      {unhealthyCount > 0 && view === "active" ? (
        <div className="activity-health-banner">
          <p className="activity-health-banner__title">
            {unhealthyCount} activit{unhealthyCount === 1 ? "y needs" : "ies need"} attention
          </p>
          <p className="activity-health-banner__body">
            Stale activities, offline owners, and pending syncs show recovery actions on each card.
          </p>
        </div>
      ) : null}

      {selectedVisibleIds.length > 0 ? (
        <div className="panel bulk-actions-bar">
          <p className="bulk-actions-bar__title">{selectedVisibleIds.length} selected</p>
          <div className="row wrap">
            {view === "active" ? (
              <button
                className="btn secondary"
                disabled={pending}
                onClick={() =>
                  runBulk(async () => {
                    const res = await sendMessage({
                      type: "BULK_ARCHIVE_TABS",
                      trackedTabIds: selectedVisibleIds,
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
                className="btn secondary"
                disabled={pending}
                onClick={() =>
                  runBulk(async () => {
                    const res = await sendMessage({
                      type: "BULK_RESTORE_TABS",
                      trackedTabIds: selectedVisibleIds,
                    });
                    if (!res.ok) throw new Error(res.error);
                    if (res.snapshot) onUpdate(res.snapshot);
                  })
                }
              >
                Restore
              </button>
            )}
            <button className="btn secondary" disabled={pending} onClick={() => setShowBulkTags(true)}>
              Tag
            </button>
            {hasCloudGroups ? (
              <button className="btn secondary" disabled={pending} onClick={() => setShowBulkMove(true)}>
                Move to group
              </button>
            ) : null}
            <button
              className="btn secondary"
              disabled={pending}
              onClick={() =>
                runBulk(async () => {
                  const res = await sendMessage({
                    type: "BULK_CLEAR_HISTORY",
                    trackedTabIds: selectedVisibleIds,
                  });
                  if (!res.ok) throw new Error(res.error);
                  if (res.snapshot) onUpdate(res.snapshot);
                })
              }
            >
              Clear history
            </button>
            <button
              className="btn danger"
              disabled={pending}
              onClick={() => {
                if (
                  !confirm(
                    `Delete ${selectedVisibleIds.length} selected activit${selectedVisibleIds.length === 1 ? "y" : "ies"} and their history?`,
                  )
                ) {
                  return;
                }
                runBulk(async () => {
                  const res = await sendMessage({
                    type: "BULK_DELETE_TABS",
                    trackedTabIds: selectedVisibleIds,
                  });
                  if (!res.ok) throw new Error(res.error);
                  if (res.snapshot) onUpdate(res.snapshot);
                });
              }}
            >
              Delete
            </button>
            <button className="btn ghost" disabled={pending} onClick={() => setSelectedIds(new Set())}>
              Clear selection
            </button>
          </div>
        </div>
      ) : null}

      {showBulkTags ? (
        <div className="panel stack">
          <M3TextField
            id="bulk-tags"
            label="Tags to add"
            value={bulkTags}
            onChange={setBulkTags}
            placeholder="reading, research"
          />
          <div className="row wrap">
            <button
              className="btn secondary"
              disabled={pending || !bulkTags.trim()}
              onClick={() =>
                runBulk(async () => {
                  const res = await sendMessage({
                    type: "BULK_TAG_TABS",
                    trackedTabIds: selectedVisibleIds,
                    tags: bulkTags.split(/[,;\n]/).map((tag) => tag.trim()).filter(Boolean),
                    mode: "add",
                  });
                  if (!res.ok) throw new Error(res.error);
                  if (res.snapshot) onUpdate(res.snapshot);
                })
              }
            >
              Add tags
            </button>
            <button className="btn ghost" onClick={() => setShowBulkTags(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {showBulkMove ? (
        <div className="panel stack">
          <M3Select
            label="Move to group"
            value={bulkMoveGroupId}
            onChange={(event) => setBulkMoveGroupId(event.target.value)}
          >
            <option value="">No group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </M3Select>
          <div className="row wrap">
            <button
              className="btn secondary"
              disabled={pending}
              onClick={() =>
                runBulk(async () => {
                  const res = await sendMessage({
                    type: "BULK_MOVE_TABS",
                    trackedTabIds: selectedVisibleIds,
                    groupId: bulkMoveGroupId || null,
                  });
                  if (!res.ok) throw new Error(res.error);
                  if (res.snapshot) onUpdate(res.snapshot);
                })
              }
            >
              Move selected
            </button>
            <button className="btn ghost" onClick={() => setShowBulkMove(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {tabs.length === 0 ? (
        <div className="empty">
          {deferredQuery.trim()
            ? `No ${view} activities match “${deferredQuery.trim()}”.`
            : view === "archived"
              ? "No archived activities."
              : fullPage
                ? "No tethered tabs yet. Use the extension popup on any page to tether one."
                : "No tethered tabs yet. Tether a page from the popup home screen."}
        </div>
      ) : (
        <div className={`list compact-list${fullPage ? " local-dashboard__tab-grid" : ""}`}>
          {tabs.map((tracked) => (
            <div key={tracked.id} className="panel compact-track local-dashboard__tab-card">
              <label className="row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(tracked.id)}
                  onChange={() => toggleSelected(tracked.id)}
                />
                <span className="muted" style={{ fontSize: 11 }}>
                  Select
                </span>
              </label>

              {editingId === tracked.id ? (
                <ActivityMetadataEditor
                  tracked={tracked}
                  snapshot={snapshot}
                  onUpdate={onUpdate}
                  compact
                  onSaved={() => setEditingId(null)}
                />
              ) : (
                <>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="name">
                      {tracked.emoji ? `${tracked.emoji} ` : ""}
                      {tracked.name}
                    </span>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {tracked.tetherMode === "series" ? <span className="pill">Series</span> : null}
                      {tracked.isPrivate ? <span className="pill">Private</span> : null}
                      {tracked.archivedAt ? <span className="pill">Archived</span> : null}
                      {tracked.activeDevice ? (
                        <span className={`pill${tracked.health?.ownerOffline ? " pill--warning" : ""}`}>
                          {tracked.activeDevice.name}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <ActivityHealthBadges health={tracked.health} />
                  {tracked.health && activityHealthRecoveryHint(tracked.health) ? (
                    <p className="activity-health-hint">{activityHealthRecoveryHint(tracked.health)}</p>
                  ) : null}
                  {tracked.tetherMode === "series" ? (
                    <p className="muted" style={{ margin: "4px 0 0", fontSize: 11 }}>
                      {describeSeriesPattern(tracked.seriesPattern)}
                    </p>
                  ) : null}
                  {tracked.currentTitle ? (
                    <p className="sub" style={{ margin: "4px 0 0" }}>
                      {tracked.currentTitle}
                    </p>
                  ) : null}
                  <p className="muted local-dashboard__tab-url" style={{ margin: "4px 0 0", fontSize: 11 }}>
                    {displayHostPath(tracked.currentUrl)}
                  </p>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 11 }}>
                    {formatDevice(tracked)} · {relativeTime(tracked.lastUpdatedAt)}
                  </p>
                </>
              )}

              <div className="row wrap local-dashboard__tab-actions">
                {editingId === tracked.id ? (
                  <button className="btn ghost" disabled={pending} onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                ) : view === "archived" ? (
                  <>
                    <button
                      className="btn"
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
                    <TabActionsMenu>
                      <ExportActivityButtons tracked={tracked} disabled={pending} />
                      <button
                        className="btn danger"
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            const res = await sendMessage({
                              type: "BULK_DELETE_TABS",
                              trackedTabIds: [tracked.id],
                            });
                            if (!res.ok) throw new Error(res.error);
                            if (res.snapshot) onUpdate(res.snapshot);
                          })
                        }
                      >
                        Delete permanently
                      </button>
                    </TabActionsMenu>
                  </>
                ) : (
                  <>
                    <button
                      className="btn"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          const res = await sendMessage({
                            type: "OPEN_TAB",
                            trackedTabId: tracked.id,
                            takeOver: true,
                          });
                          if (!res.ok) throw new Error(res.error);
                          if (res.snapshot) onUpdate(res.snapshot);
                          if (closeOnOpenTab) window.close();
                        })
                      }
                    >
                      Resume
                    </button>
                    <TabActionsMenu>
                      <button
                        className="btn ghost"
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            const res = await sendMessage({
                              type: "OPEN_TAB",
                              trackedTabId: tracked.id,
                              takeOver: false,
                            });
                            if (!res.ok) throw new Error(res.error);
                            if (res.snapshot) onUpdate(res.snapshot);
                            if (closeOnOpenTab) window.close();
                          })
                        }
                      >
                        Open without taking over
                      </button>
                      <button
                        className="btn ghost"
                        disabled={pending}
                        onClick={() => setEditingId(tracked.id)}
                      >
                        Edit details
                      </button>
                      {snapshot.settings.recordHistory && !tracked.isPrivate ? (
                        <button className="btn ghost" disabled={pending} onClick={() => onOpenHistory(tracked)}>
                          History
                        </button>
                      ) : null}
                      <ExportActivityButtons tracked={tracked} disabled={pending} />
                      {tracked.health?.stale ? (
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
                          Archive stale
                        </button>
                      ) : null}
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
                      <button
                        className="btn ghost"
                        disabled={pending}
                        onClick={() =>
                          setSeriesPanelId((current) => (current === tracked.id ? null : tracked.id))
                        }
                      >
                        {seriesPanelId === tracked.id ? "Hide series pattern" : "Series pattern"}
                      </button>
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
                        Untether tab
                      </button>
                    </TabActionsMenu>
                  </>
                )}
              </div>

              {seriesPanelId === tracked.id ? (
                <SeriesTetherPanel
                  key={`${tracked.id}-${tracked.lastUpdatedAt}`}
                  tracked={tracked}
                  compact
                  onUpdate={onUpdate}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
