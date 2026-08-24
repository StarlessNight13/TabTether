import type { TrackedTabRecord } from "../core/entities";
import { createId } from "../core/ids";
import type { SeriesTetherPattern, TetherMode, TrackedTab } from "../lib/types";
import { parseSeriesPattern, parseTetherMode, serializeSeriesPattern } from "../lib/series-sync";
import { getCloudCredentials } from "../storage/cloud-configuration";
import { listCachedTabs } from "../storage/indexed-db";
import { requestCloudSync } from "./coordinator";
import { enqueueOptimisticTab } from "./outbox";
import { cloudSyncTriggerForKind } from "./sync-triggers";

export function cloudTabView(tab: TrackedTabRecord): TrackedTab {
  return {
    id: tab.id,
    name: tab.name,
    emoji: tab.emoji,
    tags: JSON.parse(tab.tags) as string[],
    groupId: tab.groupId,
    group: null,
    currentUrl: tab.currentUrl,
    currentTitle: tab.currentTitle,
    activeDeviceId: tab.activeDeviceId,
    lastUpdatedDeviceId: tab.lastUpdatedDeviceId,
    lastUpdatedAt: new Date(tab.updatedAt).toISOString(),
    createdAt: new Date(tab.createdAt).toISOString(),
    archivedAt: tab.archivedAt ? new Date(tab.archivedAt).toISOString() : null,
    isPrivate: Boolean(tab.isPrivate),
    tetherMode: parseTetherMode(tab.tetherMode),
    seriesPattern: parseSeriesPattern(tab.seriesPattern),
    revision: tab.revision,
    deletedAt: tab.deletedAt ? new Date(tab.deletedAt).toISOString() : null,
    activeDevice:
      tab.activeDeviceId && tab.activeDeviceName
        ? {
            id: tab.activeDeviceId,
            name: tab.activeDeviceName,
            browser: tab.activeDeviceBrowser ?? "Unknown browser",
            lastSeenAt: tab.activeDeviceLastSeenAt
              ? new Date(tab.activeDeviceLastSeenAt).toISOString()
              : undefined,
          }
        : null,
    lastUpdatedDevice:
      tab.lastUpdatedDeviceId && tab.lastUpdatedDeviceName
        ? {
            id: tab.lastUpdatedDeviceId,
            name: tab.lastUpdatedDeviceName,
            browser: tab.lastUpdatedDeviceBrowser ?? "Unknown browser",
            lastSeenAt: tab.lastUpdatedDeviceLastSeenAt
              ? new Date(tab.lastUpdatedDeviceLastSeenAt).toISOString()
              : undefined,
          }
        : null,
  };
}

export async function createCloudTab(input: {
  name: string;
  emoji?: string | null;
  url: string;
  title?: string | null;
  recordHistory: boolean;
  tetherMode?: TetherMode;
  seriesPattern?: SeriesTetherPattern;
}) {
  const cloud = await getCloudCredentials();
  if (!cloud) return null;
  const now = Date.now();
  const tetherMode = input.tetherMode ?? "loose";
  const tab: TrackedTabRecord = {
    id: createId("tab"),
    workspaceId: cloud.workspaceId,
    groupId: null,
    name: input.name,
    emoji: input.emoji ?? null,
    tags: "[]",
    currentUrl: input.url,
    currentTitle: input.title ?? null,
    activeDeviceId: cloud.deviceId,
    lastUpdatedDeviceId: cloud.deviceId,
    isPrivate: 0,
    archivedAt: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    tetherMode,
    seriesPattern: serializeSeriesPattern(input.seriesPattern),
  };
  await enqueueOptimisticTab(tab, "create", {
    ...(tab as unknown as Record<string, unknown>),
    recordHistory: input.recordHistory,
  });
  void requestCloudSync("activity");
  return cloudTabView(tab);
}

async function mutateCloudTab(
  id: string,
  kind:
    | "update_location"
    | "update_tether"
    | "rename"
    | "delete"
    | "takeover"
    | "archive"
    | "restore",
  payload: Record<string, unknown>,
) {
  const cloud = await getCloudCredentials();
  if (!cloud) return null;
  const tab = (await listCachedTabs()).find((candidate) => candidate.id === id);
  if (!tab) return null;
  const now = Date.now();
  const renamePayload =
    kind === "rename"
      ? {
          name: String(payload.name),
          emoji:
            payload.emoji == null
              ? null
              : payload.emoji !== undefined
                ? String(payload.emoji)
                : tab.emoji,
          tags:
            payload.tags !== undefined
              ? (payload.tags as string[])
              : (JSON.parse(tab.tags) as string[]),
          groupId:
            payload.groupId !== undefined
              ? payload.groupId == null
                ? null
                : String(payload.groupId)
              : tab.groupId,
          isPrivate:
            payload.isPrivate !== undefined ? Boolean(payload.isPrivate) : Boolean(tab.isPrivate),
        }
      : null;
  const tetherPayload =
    kind === "update_tether"
      ? {
          tetherMode: parseTetherMode(payload.tetherMode),
          seriesPattern:
            payload.seriesPattern === undefined
              ? tab.seriesPattern
              : serializeSeriesPattern(payload.seriesPattern as SeriesTetherPattern | null),
        }
      : null;
  const optimistic: TrackedTabRecord = {
    ...tab,
    ...(kind === "update_location"
      ? {
          currentUrl: String(payload.url),
          currentTitle: payload.title == null ? tab.currentTitle : String(payload.title),
          activeDeviceId: cloud.deviceId,
          lastUpdatedDeviceId: cloud.deviceId,
        }
      : {}),
    ...(kind === "update_tether" && tetherPayload
      ? {
          tetherMode: tetherPayload.tetherMode,
          seriesPattern: tetherPayload.seriesPattern,
          lastUpdatedDeviceId: cloud.deviceId,
        }
      : {}),
    ...(kind === "rename" && renamePayload
      ? {
          name: renamePayload.name,
          emoji: renamePayload.emoji,
          tags: JSON.stringify(renamePayload.tags),
          groupId: renamePayload.groupId,
          isPrivate: renamePayload.isPrivate ? 1 : 0,
        }
      : {}),
    ...(kind === "delete" ? { deletedAt: now, activeDeviceId: null } : {}),
    ...(kind === "archive" ? { archivedAt: now, activeDeviceId: null } : {}),
    ...(kind === "restore" ? { archivedAt: null } : {}),
    ...(kind === "takeover"
      ? { activeDeviceId: cloud.deviceId, lastUpdatedDeviceId: cloud.deviceId }
      : {}),
    updatedAt: now,
  };
  await enqueueOptimisticTab(optimistic, kind, tetherPayload ?? renamePayload ?? payload);
  void requestCloudSync(cloudSyncTriggerForKind(kind));
  return cloudTabView(optimistic);
}

export const updateCloudTabLocation = (
  id: string,
  url: string,
  title: string | null,
  recordHistory: boolean,
) => mutateCloudTab(id, "update_location", { url, title, recordHistory });
export const updateCloudTabTether = (
  id: string,
  tetherMode: TetherMode,
  seriesPattern?: SeriesTetherPattern | null,
) => mutateCloudTab(id, "update_tether", { tetherMode, seriesPattern });
export const renameCloudTab = (
  id: string,
  name: string,
  emoji?: string | null,
  tags?: string[],
  groupId?: string | null,
  isPrivate?: boolean,
) => mutateCloudTab(id, "rename", { name, emoji, tags, groupId, isPrivate });
export const deleteCloudTab = (id: string) => mutateCloudTab(id, "delete", {});
export const takeOverCloudTab = (id: string) => mutateCloudTab(id, "takeover", {});
export const archiveCloudTab = (id: string) => mutateCloudTab(id, "archive", {});
export const restoreCloudTab = (id: string) => mutateCloudTab(id, "restore", {});
