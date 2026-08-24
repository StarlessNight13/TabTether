import {
  canAccessLocalStorage,
  getLocalStateViaBridge,
  setLocalStateViaBridge,
} from "./storage-bridge";
import {
  DEFAULT_LOCAL_STATE,
  type LanSignalingMode,
  type LocalState,
  type SyncModes,
} from "./types";
import { resolveLanSignalingMode } from "./sync-modes";

const KEYS = [
  "deviceId",
  "deviceName",
  "localDeviceId",
  "syncModes",
  "lanSignalingMode",
  "onboardingComplete",
  "pairedLanDevices",
  "localHistory",
  "bindings",
  "cachedTabs",
  "settings",
  "pendingReconnect",
  "queuedLocationUpdates",
  "restoreFingerprints",
  "watchedActivityIds",
  "lastSeenOnDevice",
] as const satisfies readonly (keyof LocalState)[];

/** Fresh installs stay incomplete; profiles that already have local data skip onboarding. */
export function migrateOnboardingComplete(
  stored: Record<string, unknown>,
  keys: readonly (keyof LocalState)[] = KEYS,
): boolean | undefined {
  if (stored.onboardingComplete !== undefined) return undefined;
  return keys.some((key) => key !== "onboardingComplete" && stored[key] !== undefined);
}

function parseSyncModes(raw: unknown): SyncModes {
  if (!raw || typeof raw !== "object") return DEFAULT_LOCAL_STATE.syncModes;
  const parsed = raw as Partial<SyncModes>;
  return {
    offline: Boolean(parsed.offline),
    lan: Boolean(parsed.lan),
    online: Boolean(parsed.online),
  };
}

function migrateLegacyState(stored: Record<string, unknown>): Partial<LocalState> {
  const patch: Partial<LocalState> = {};

  if (stored.syncModes === undefined) {
    patch.syncModes = DEFAULT_LOCAL_STATE.syncModes;
  }

  const onboardingComplete = migrateOnboardingComplete(stored, KEYS);
  if (onboardingComplete !== undefined) {
    patch.onboardingComplete = onboardingComplete;
  }

  if (stored.pairedLanDevices === undefined) {
    patch.pairedLanDevices = [];
  }

  if (stored.localHistory === undefined) {
    patch.localHistory = {};
  }

  if (stored.localDeviceId === undefined) {
    patch.localDeviceId = null;
  }

  if (stored.queuedLocationUpdates === undefined) {
    patch.queuedLocationUpdates = {};
  }

  if (stored.restoreFingerprints === undefined) {
    patch.restoreFingerprints = {};
  }

  if (stored.lanSignalingMode === undefined) {
    patch.lanSignalingMode = resolveLanSignalingMode();
  }

  return patch;
}

function parseLanSignalingMode(raw: unknown, _syncModes: SyncModes): LanSignalingMode {
  if (raw === "local") return raw;
  return resolveLanSignalingMode();
}

export async function getLocalState(): Promise<LocalState> {
  if (!canAccessLocalStorage()) {
    return getLocalStateViaBridge();
  }

  const stored = await browser.storage.local.get([...KEYS]);
  const migration = migrateLegacyState(stored);

  if (Object.keys(migration).length > 0) {
    await browser.storage.local.set(migration);
  }

  return {
    deviceId: typeof stored.deviceId === "string" ? stored.deviceId : DEFAULT_LOCAL_STATE.deviceId,
    deviceName:
      typeof stored.deviceName === "string" ? stored.deviceName : DEFAULT_LOCAL_STATE.deviceName,
    localDeviceId:
      typeof stored.localDeviceId === "string"
        ? stored.localDeviceId
        : (migration.localDeviceId ?? DEFAULT_LOCAL_STATE.localDeviceId),
    syncModes: parseSyncModes(stored.syncModes ?? migration.syncModes),
    lanSignalingMode: parseLanSignalingMode(
      stored.lanSignalingMode ?? migration.lanSignalingMode,
      parseSyncModes(stored.syncModes ?? migration.syncModes),
    ),
    onboardingComplete:
      typeof stored.onboardingComplete === "boolean"
        ? stored.onboardingComplete
        : (migration.onboardingComplete ?? DEFAULT_LOCAL_STATE.onboardingComplete),
    pairedLanDevices: Array.isArray(stored.pairedLanDevices)
      ? (stored.pairedLanDevices as LocalState["pairedLanDevices"])
      : (migration.pairedLanDevices ?? []),
    localHistory:
      stored.localHistory && typeof stored.localHistory === "object"
        ? (stored.localHistory as Record<string, LocalState["localHistory"][string]>)
        : (migration.localHistory ?? {}),
    bindings:
      stored.bindings && typeof stored.bindings === "object"
        ? (stored.bindings as Record<string, string>)
        : {},
    cachedTabs: Array.isArray(stored.cachedTabs)
      ? (stored.cachedTabs as LocalState["cachedTabs"])
      : [],
    settings:
      stored.settings && typeof stored.settings === "object"
        ? { ...DEFAULT_LOCAL_STATE.settings, ...(stored.settings as LocalState["settings"]) }
        : DEFAULT_LOCAL_STATE.settings,
    pendingReconnect: Array.isArray(stored.pendingReconnect)
      ? (stored.pendingReconnect as LocalState["pendingReconnect"])
      : [],
    queuedLocationUpdates:
      stored.queuedLocationUpdates && typeof stored.queuedLocationUpdates === "object"
        ? (stored.queuedLocationUpdates as LocalState["queuedLocationUpdates"])
        : (migration.queuedLocationUpdates ?? {}),
    restoreFingerprints: parseRestoreFingerprints(
      stored.restoreFingerprints ?? migration.restoreFingerprints,
    ),
    watchedActivityIds: parseWatchedActivityIds(stored.watchedActivityIds),
    lastSeenOnDevice: parseLastSeenOnDevice(stored.lastSeenOnDevice),
  };
}

function parseWatchedActivityIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function parseLastSeenOnDevice(raw: unknown): LocalState["lastSeenOnDevice"] {
  if (!raw || typeof raw !== "object") return {};
  const out: LocalState["lastSeenOnDevice"] = {};
  for (const [activityId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.urlKey !== "string" || entry.urlKey.length === 0) continue;
    if (typeof entry.url !== "string" || entry.url.length === 0) continue;
    if (typeof entry.seenAt !== "string" || entry.seenAt.length === 0) continue;
    out[activityId] = {
      urlKey: entry.urlKey,
      url: entry.url,
      seenAt: entry.seenAt,
    };
  }
  return out;
}

function parseRestoreFingerprints(raw: unknown): LocalState["restoreFingerprints"] {
  if (!raw || typeof raw !== "object") return {};
  const out: LocalState["restoreFingerprints"] = {};
  for (const [activityId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const fp = value as Record<string, unknown>;
    if (typeof fp.urlKey !== "string" || fp.urlKey.length === 0) continue;
    if (typeof fp.pinned !== "boolean") continue;
    if (typeof fp.index !== "number" || !Number.isFinite(fp.index)) continue;
    if (typeof fp.windowOrdinal !== "number" || !Number.isFinite(fp.windowOrdinal)) continue;
    if (typeof fp.windowTabCount !== "number" || !Number.isFinite(fp.windowTabCount)) continue;
    if (typeof fp.incognito !== "boolean") continue;
    if (typeof fp.capturedAt !== "string") continue;
    out[activityId] = {
      urlKey: fp.urlKey,
      title: typeof fp.title === "string" ? fp.title : null,
      pinned: fp.pinned,
      index: fp.index,
      windowOrdinal: fp.windowOrdinal,
      windowTabCount: fp.windowTabCount,
      openerActivityId: typeof fp.openerActivityId === "string" ? fp.openerActivityId : null,
      lastAccessed:
        typeof fp.lastAccessed === "number" && Number.isFinite(fp.lastAccessed)
          ? fp.lastAccessed
          : null,
      groupId:
        typeof fp.groupId === "number" && Number.isFinite(fp.groupId) ? fp.groupId : null,
      incognito: fp.incognito,
      capturedAt: fp.capturedAt,
      browserTabId:
        typeof fp.browserTabId === "number" && Number.isInteger(fp.browserTabId)
          ? fp.browserTabId
          : null,
    };
  }
  return out;
}

export async function setLocalState(patch: Partial<LocalState>): Promise<LocalState> {
  if (!canAccessLocalStorage()) {
    return setLocalStateViaBridge(patch);
  }

  await browser.storage.local.set(patch);
  return getLocalState();
}
