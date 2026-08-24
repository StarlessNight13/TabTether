import { useEffect, useMemo, useState } from "react";

import { HistoryView } from "@/components/history-view";
import { LocalDashboardView } from "@/components/local-dashboard-view";
import { OnboardingView } from "@/components/onboarding-view";
import { parseLocalDashboardTab } from "@/lib/open-dashboard";
import { sendMessage, type PopupSnapshot } from "@/lib/messaging";
import { describeSyncModes } from "@/lib/sync-modes";
import type { TrackedTab } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";

import { ExtensionThemeProvider } from "../popup/components/extension-theme-provider";

function readInitialTab() {
  return parseLocalDashboardTab(window.location.hash);
}

export default function App() {
  const [snapshot, setSnapshot] = useState<PopupSnapshot | null>(null);
  const [historyTab, setHistoryTab] = useState<TrackedTab | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [initialTab, setInitialTab] = useState(readInitialTab);

  useEffect(() => {
    const onHashChange = () => setInitialTab(readInitialTab());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    void sendMessage({ type: "GET_SNAPSHOT" }).then((res) => {
      if (!res.ok) {
        setBootError(res.error);
        return;
      }
      const next = res.snapshot ?? null;
      setSnapshot(next);
    });
  }, []);

  useEffect(() => {
    const refreshSnapshot = () => {
      void sendMessage({ type: "GET_SNAPSHOT" }).then((res) => {
        if (res.ok && res.snapshot) {
          setSnapshot(res.snapshot);
        }
      });
    };

    browser.storage.onChanged.addListener(refreshSnapshot);
    return () => browser.storage.onChanged.removeListener(refreshSnapshot);
  }, []);

  const themeSettings = snapshot?.settings ?? DEFAULT_SETTINGS;
  const lanSummary = useMemo(() => {
    if (!snapshot?.syncModes.lan || snapshot.pairedLanDevices.length === 0) return null;
    return `${snapshot.lanConnectedPeers}/${snapshot.pairedLanDevices.length} LAN peers online`;
  }, [snapshot]);

  if (bootError) {
    return (
      <ExtensionThemeProvider settings={themeSettings}>
        <div className="app app--dashboard">
          <p className="error">{bootError}</p>
        </div>
      </ExtensionThemeProvider>
    );
  }

  if (!snapshot) {
    return (
      <ExtensionThemeProvider settings={themeSettings}>
        <div className="app app--dashboard">
          <div className="empty">Loading…</div>
        </div>
      </ExtensionThemeProvider>
    );
  }

  return (
    <ExtensionThemeProvider settings={snapshot.settings}>
      <div className="app app--dashboard">
        {!snapshot.onboardingComplete ? (
          <div className="dashboard-onboarding">
            <OnboardingView snapshot={snapshot} onUpdate={setSnapshot} />
          </div>
        ) : historyTab ? (
          <HistoryView tab={historyTab} onBack={() => setHistoryTab(null)} onUpdate={setSnapshot} />
        ) : (
          <>
            <header className="dashboard-page__header">
              <div className="dashboard-page__brand">
                <img src="/icon/128.png" width={32} height={32} alt="" />
                <div>
                  <h1>TabTether</h1>
                  <p className="dashboard-page__subtitle">Activities on this device</p>
                </div>
              </div>
              <div className="row wrap dashboard-page__meta">
                <span className="pill">{describeSyncModes(snapshot.syncModes)}</span>
                {lanSummary ? <span className="muted">{lanSummary}</span> : null}
              </div>
            </header>
            <LocalDashboardView
              snapshot={snapshot}
              onUpdate={setSnapshot}
              onOpenHistory={setHistoryTab}
              initialTab={initialTab}
              syncHash
              showHeader={false}
            />
          </>
        )}
      </div>
    </ExtensionThemeProvider>
  );
}
