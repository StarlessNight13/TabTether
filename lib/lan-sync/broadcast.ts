import type { HistoryEntry, TrackedTab } from "../types";
import { getLocalState } from "../storage";
import { applyPeerTabUpdate, syncDeleteTabFromPeer } from "../sync/router";
import { mergePeerHistory, pickHistoryForTabs } from "../sync/history-sync";

export type LanTabEvent =
  | { type: "tab_created"; tab: TrackedTab }
  | { type: "tab_updated"; tab: TrackedTab }
  | { type: "tab_deleted"; tabId: string }
  | {
      type: "sync_snapshot";
      tabs: TrackedTab[];
      history?: Record<string, HistoryEntry[]>;
      sentAt: string;
    };

const channels = new Map<string, RTCDataChannel>();

export function registerLanChannel(peerDeviceId: string, channel: RTCDataChannel) {
  channels.set(peerDeviceId, channel);
  channel.addEventListener("message", (event) => {
    void handleLanMessage(String(event.data));
  });
}

export function unregisterLanChannel(peerDeviceId: string, channel?: RTCDataChannel) {
  if (channel && channels.get(peerDeviceId) !== channel) return;
  channels.delete(peerDeviceId);
}

export function isPeerConnected(peerDeviceId: string) {
  const channel = channels.get(peerDeviceId);
  return channel?.readyState === "open";
}

export async function sendLanSnapshot(channel: RTCDataChannel) {
  if (channel.readyState !== "open") return;

  const state = await getLocalState();
  const payload: LanTabEvent = {
    type: "sync_snapshot",
    tabs: state.cachedTabs,
    history: pickHistoryForTabs(
      state.localHistory,
      state.cachedTabs.map((tab) => tab.id),
    ),
    sentAt: new Date().toISOString(),
  };

  try {
    channel.send(JSON.stringify(payload));
  } catch {
    // ignore send failures
  }
}

export async function broadcastLanTabEventDirect(event: LanTabEvent) {
  const payload = JSON.stringify({ ...event, sentAt: new Date().toISOString() });
  for (const channel of channels.values()) {
    if (channel.readyState === "open") {
      try {
        channel.send(payload);
      } catch {
        // ignore send failures
      }
    }
  }
}

export async function broadcastLanTabEvent(event: LanTabEvent) {
  const { callOffscreenLan, canUseWebRtcInThisContext } = await import("./offscreen-bridge");
  if (canUseWebRtcInThisContext()) {
    await broadcastLanTabEventDirect(event);
    return;
  }

  const state = await getLocalState();
  if (!state.syncModes.lan) return;

  await callOffscreenLan({ type: "BROADCAST_TAB_EVENT", event });
}

async function handleLanMessage(raw: string) {
  try {
    const parsed = JSON.parse(raw) as LanTabEvent;

    if (parsed.type === "sync_snapshot") {
      for (const tab of parsed.tabs) {
        await applyPeerTabUpdate(tab);
      }
      if (parsed.history) {
        await mergePeerHistory(parsed.history);
      }
      void browser.runtime.sendMessage({ type: "REFRESH_MOVED_ON_BANNERS" }).catch(() => {});
      return;
    }

    if (parsed.type === "tab_deleted") {
      await syncDeleteTabFromPeer(parsed.tabId);
      return;
    }

    if (parsed.type === "tab_created" || parsed.type === "tab_updated") {
      await applyPeerTabUpdate(parsed.tab);
      void browser.runtime.sendMessage({ type: "REFRESH_MOVED_ON_BANNERS" }).catch(() => {});
    }
  } catch {
    // ignore malformed payloads
  }
}

export function getOpenLanChannelCount() {
  return [...channels.values()].filter((c) => c.readyState === "open").length;
}
