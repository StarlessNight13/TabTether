export type Device = {
  id: string;
  workspaceId: string;
  name: string;
  browser: string;
  lastSeenAt: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type Group = {
  id: string;
  workspaceId: string;
  name: string;
  notes: string;
  pinnedTrackedTabId: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type TrackedTabRecord = {
  id: string;
  workspaceId: string;
  groupId: string | null;
  name: string;
  emoji: string | null;
  tags: string;
  currentUrl: string;
  currentTitle: string | null;
  activeDeviceId: string | null;
  lastUpdatedDeviceId: string | null;
  isPrivate: number;
  archivedAt: number | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  /** loose | series — defaults to loose for pre-migration rows. */
  tetherMode?: string | null;
  /** JSON SeriesTetherPattern or null. */
  seriesPattern?: string | null;
  activeDeviceName?: string | null;
  activeDeviceBrowser?: string | null;
  activeDeviceLastSeenAt?: number | null;
  lastUpdatedDeviceName?: string | null;
  lastUpdatedDeviceBrowser?: string | null;
  lastUpdatedDeviceLastSeenAt?: number | null;
};
