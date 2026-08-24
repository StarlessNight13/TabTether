import type {
  LanSignalingMode,
  PairedLanDevice,
  PrivacySettings,
  ReconnectCandidate,
  SyncModes,
  TrackedTab,
} from "./types";
import type { TetherMode } from "./tether-series";
import type { CloudDatabaseSpikeResult } from "./cloud-db/spike";
import type { CloudConfiguration, CloudStatus } from "../storage/cloud-configuration";
import type { TrackingExtExport } from "../storage/export";
import type { CloudSyncPolicy } from "../services/database-service";
import type { DatabaseProvider } from "../services/database-service";
import type { MovedOnMatch } from "./moved-on";
import type { CatchUpItem } from "./catch-up";
import type { ConflictView } from "./conflict-view";

export type OpenWindowTab = {
  tabId: number;
  url: string;
  title: string;
  active: boolean;
  tracked: TrackedTab | null;
};

export type PopupSnapshot = {
  deviceId: string | null;
  deviceName: string | null;
  syncModes: SyncModes;
  lanSignalingMode: LanSignalingMode;
  onboardingComplete: boolean;
  pairedLanDevices: PairedLanDevice[];
  lanConnectedPeers: number;
  lanPeerStatus: Record<string, boolean>;
  currentTab: {
    id: number;
    url: string;
    title: string;
    tracked: TrackedTab | null;
    isActiveOwner: boolean;
    movedOn: MovedOnMatch | null;
  } | null;
  /** Trackable browser tabs in the current window and their tether bindings. */
  openTabs: OpenWindowTab[];
  /** trackedTabId -> number of open browser tabs currently bound. */
  boundTabCounts: Record<string, number>;
  trackedTabs: TrackedTab[];
  pendingReconnect: ReconnectCandidate[];
  pendingSyncCount: number;
  settings: PrivacySettings;
  watchedActivityIds: string[];
  catchUp: CatchUpItem[];
  cloud: {
    configuration: CloudConfiguration | null;
    status: CloudStatus;
    pending: number;
    conflicts: number;
  };
};

export type ExtensionRequest =
  | { type: "GET_SNAPSHOT" }
  | { type: "TRACK_TAB"; name?: string; emoji?: string; tabId?: number; tetherMode?: TetherMode; trackedTabId?: string }
  | { type: "BIND_TAB"; trackedTabId: string; tabId?: number }
  | { type: "UNBIND_TAB"; tabId?: number }
  | { type: "STOP_TRACKING"; trackedTabId: string }
  | { type: "RENAME_TAB"; trackedTabId: string; name: string; emoji?: string | null }
  | {
      type: "UPDATE_TAB";
      trackedTabId: string;
      name: string;
      emoji?: string | null;
      tags?: string[];
      groupId?: string | null;
      isPrivate?: boolean;
    }
  | {
      type: "UPDATE_SERIES_TETHER";
      trackedTabId: string;
      tetherMode?: TetherMode;
      urlPattern?: string;
      titlePattern?: string;
      resetLearning?: boolean;
    }
  | { type: "OPEN_TAB"; trackedTabId: string; takeOver?: boolean }
  | { type: "TAKE_OVER"; trackedTabId: string }
  | { type: "CONFIRM_RECONNECT"; candidate: ReconnectCandidate; takeOver?: boolean }
  | { type: "DISMISS_RECONNECT"; candidate: ReconnectCandidate }
  | { type: "UPDATE_SETTINGS"; settings: Partial<PrivacySettings> }
  | { type: "UPDATE_SYNC_MODES"; syncModes: SyncModes }
  | {
      type: "COMPLETE_ONBOARDING";
      syncModes: SyncModes;
      deviceName: string;
    }
  | { type: "UPDATE_LAN_SIGNALING_MODE"; lanSignalingMode: LanSignalingMode }
  | { type: "RENAME_DEVICE"; name: string }
  | { type: "START_LOCAL_LAN_PAIRING" }
  | { type: "JOIN_LOCAL_LAN_PAIRING"; offerToken: string }
  | { type: "COMPLETE_LOCAL_LAN_PAIRING"; answerToken: string }
  | { type: "CANCEL_LOCAL_LAN_PAIRING" }
  | { type: "SYNC_NOW" }
  | { type: "REMOVE_LAN_PEER"; deviceId: string }
  | { type: "REFRESH" }
  | { type: "CLEAR_HISTORY"; trackedTabId: string }
  | { type: "GET_HISTORY"; trackedTabId: string }
  | { type: "MOVED_ON_DISMISS"; trackedTabId: string; pageUrl: string; currentUrl?: string; tabId?: number }
  | { type: "MOVED_ON_GO_TO"; trackedTabId: string; tabId?: number; url?: string }
  | { type: "MOVED_ON_RESET_HERE"; trackedTabId: string; tabId?: number }
  | { type: "REFRESH_MOVED_ON_BANNERS" }
  | { type: "SET_WATCH"; trackedTabId: string; watching: boolean }
  | { type: "MARK_SEEN"; trackedTabId: string; url?: string }
  | { type: "RUN_CLOUD_DB_SPIKE"; url: string; authToken: string }
  | {
      type: "CONFIGURE_CLOUD_DATABASE";
      url: string;
      authToken: string;
      provider: DatabaseProvider;
      tokenPersistence: "persistent" | "session";
      deviceName: string;
      behavior?: CloudSyncPolicy;
    }
  | { type: "DISCONNECT_CLOUD_DATABASE" }
  | { type: "ARCHIVE_TAB"; trackedTabId: string }
  | { type: "RESTORE_TAB"; trackedTabId: string }
  | {
      type: "BULK_ARCHIVE_TABS";
      trackedTabIds: string[];
    }
  | {
      type: "BULK_DELETE_TABS";
      trackedTabIds: string[];
    }
  | {
      type: "BULK_TAG_TABS";
      trackedTabIds: string[];
      tags: string[];
      mode: "add" | "replace";
    }
  | {
      type: "BULK_MOVE_TABS";
      trackedTabIds: string[];
      groupId: string | null;
    }
  | {
      type: "BULK_RESTORE_TABS";
      trackedTabIds: string[];
    }
  | {
      type: "BULK_CLEAR_HISTORY";
      trackedTabIds: string[];
    }
  | { type: "EXPORT_DATA" }
  | { type: "IMPORT_DATA"; data: unknown }
  | { type: "EXPORT_CLOUD_DATABASE" }
  | { type: "IMPORT_CLOUD_DATABASE"; data: unknown }
  | { type: "GET_CONFLICTS" }
  | {
      type: "RESOLVE_CONFLICT";
      operationId: string;
      resolution: "keep_mine" | "keep_theirs" | "dismiss";
    }
  | { type: "GET_DATABASE_LOGS" }
  | { type: "CLEAR_DATABASE_LOGS" }
  | { type: "UPDATE_DATABASE_BEHAVIOR"; behavior: CloudSyncPolicy }
  | { type: "LIST_CLOUD_GROUPS" }
  | { type: "SAVE_CLOUD_GROUP"; id?: string; name: string; notes?: string; revision?: number; pinnedTrackedTabId?: string | null }
  | { type: "DELETE_CLOUD_GROUP"; id: string; revision: number }
  | { type: "LIST_CLOUD_DEVICES" }
  | { type: "RENAME_CLOUD_DEVICE"; id: string; name: string; revision: number }
  | { type: "REMOVE_CLOUD_DEVICE"; id: string; revision: number }

export type ExtensionResponse =
  | {
      ok: true;
      snapshot?: PopupSnapshot;
      history?: unknown;
      localPairingToken?: string;
      cloudDatabaseSpike?: CloudDatabaseSpikeResult;
      exportData?: TrackingExtExport;
      cloudDatabaseExport?: unknown;
      conflicts?: ConflictView[];
      groups?: unknown[];
      devices?: unknown[];
      logs?: unknown[];
    }
  | { ok: false; error: string };

export function sendMessage(message: ExtensionRequest): Promise<ExtensionResponse> {
  return browser.runtime
    .sendMessage(message)
    .then((response): ExtensionResponse => {
      if (response === undefined) {
        return {
          ok: false,
          error: `"${message.type}" got no response from the extension background. Reload the extension and try again.`,
        };
      }
      if (typeof response === "object" && response !== null && "ok" in response) {
        return response as ExtensionResponse;
      }
      return {
        ok: false,
        error: `"${message.type}" returned an unexpected response from the extension background.`,
      };
    })
    .catch((error: unknown): ExtensionResponse => {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: `"${message.type}" failed: ${detail}`,
      };
    });
}
