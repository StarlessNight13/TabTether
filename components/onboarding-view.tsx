import { useEffect, useState, useTransition } from "react";

import { supportedSyncModes, supportsLanSync } from "@/lib/browser-capabilities";
import { defaultDeviceName } from "@/lib/device";
import { openDashboard } from "@/lib/open-dashboard";
import { sendMessage, type PopupSnapshot } from "@/lib/messaging";
import type { SyncModes } from "@/lib/types";
import { M3Button } from "../entrypoints/popup/components/m3-button";
import { M3SwitchRow } from "../entrypoints/popup/components/m3-switch";
import { M3TextField } from "../entrypoints/popup/components/m3-text-field";

export function OnboardingView({
  snapshot,
  onUpdate,
}: {
  snapshot: PopupSnapshot;
  onUpdate: (snapshot: PopupSnapshot) => void;
}) {
  const [step, setStep] = useState(0);
  const [deviceName, setDeviceName] = useState(
    () => snapshot.deviceName?.trim() || defaultDeviceName(),
  );
  const [syncModes, setSyncModes] = useState<SyncModes>(() =>
    supportedSyncModes(snapshot.syncModes),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setSyncModes(supportedSyncModes(snapshot.syncModes));
  }, [snapshot.syncModes]);

  const finish = () => {
    setError(null);
    startTransition(async () => {
      const res = await sendMessage({
        type: "COMPLETE_ONBOARDING",
        syncModes,
        deviceName: deviceName.trim() || defaultDeviceName(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.snapshot) {
        onUpdate(res.snapshot);
        if (syncModes.online && !snapshot.cloud.configuration) {
          openDashboard(res.snapshot, "database");
        }
      }
    });
  };

  return (
    <div className="stack onboarding">
      <div className="onboarding__brand">
        <h1 className="onboarding__title">TabTether</h1>
        <p className="muted onboarding__subtitle">
          Keep a persistent activity identity with its latest URL—resume reading, research, or a
          series on this browser or another.
        </p>
      </div>

      {step === 0 ? (
        <div className="panel stack settings-panel">
          <span className="section-title" style={{ margin: 0 }}>
            How it works
          </span>
          <ul className="onboarding__list">
            <li>Tether a tab from the popup—navigation updates that activity’s current URL.</li>
            <li>Open the same activity later from Resume or the dashboard.</li>
            <li>Optional cloud or LAN sync moves the latest URL between your devices.</li>
          </ul>
          <M3Button block disabled={pending} onClick={() => setStep(1)}>
            Continue
          </M3Button>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="panel stack settings-panel">
          <span className="section-title" style={{ margin: 0 }}>
            Sync modes
          </span>
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>
            At least one mode required. Offline works alone; Online needs a database you control.
          </p>
          <M3SwitchRow
            title="Offline"
            description="Store activities on this device"
            checked={syncModes.offline}
            onChange={(offline) => setSyncModes((current) => ({ ...current, offline }))}
          />
          <M3SwitchRow
            title="Online"
            description="Your cloud database (Turso / D1)"
            checked={syncModes.online}
            onChange={(online) => setSyncModes((current) => ({ ...current, online }))}
          />
          {supportsLanSync ? (
            <M3SwitchRow
              title="LAN"
              description="Nearby Chromium browsers while both stay open"
              checked={syncModes.lan}
              onChange={(lan) => setSyncModes((current) => ({ ...current, lan }))}
            />
          ) : null}
          <div className="row wrap" style={{ justifyContent: "space-between" }}>
            <M3Button variant="text" disabled={pending} onClick={() => setStep(0)}>
              Back
            </M3Button>
            <M3Button
              disabled={pending || !(syncModes.offline || syncModes.lan || syncModes.online)}
              onClick={() => setStep(2)}
            >
              Continue
            </M3Button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="panel stack settings-panel">
          <span className="section-title" style={{ margin: 0 }}>
            This device
          </span>
          <M3TextField
            id="onboarding-device-name"
            label="Device name"
            value={deviceName}
            onChange={setDeviceName}
          />
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>
            Shown when an activity is owned or updated from here.
          </p>
          <div className="row wrap" style={{ justifyContent: "space-between" }}>
            <M3Button variant="text" disabled={pending} onClick={() => setStep(1)}>
              Back
            </M3Button>
            <M3Button disabled={pending || !deviceName.trim()} onClick={finish}>
              {pending ? "Saving…" : "Get started"}
            </M3Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
