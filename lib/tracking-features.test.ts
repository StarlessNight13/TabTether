import { describe, expect, it } from "vitest";

import {
  canUseTrackingFeaturesFrom,
  trackingFeaturesDisabledReasonFrom,
} from "./tracking";

describe("canUseTrackingFeaturesFrom", () => {
  it("allows offline or LAN without cloud credentials", () => {
    expect(
      canUseTrackingFeaturesFrom({ offline: true, lan: false, online: false }, false),
    ).toBe(true);
    expect(
      canUseTrackingFeaturesFrom({ offline: false, lan: true, online: false }, false),
    ).toBe(true);
  });

  it("allows online-only when a cloud database is configured", () => {
    expect(
      canUseTrackingFeaturesFrom({ offline: false, lan: false, online: true }, true),
    ).toBe(true);
  });

  it("blocks online-only without cloud credentials", () => {
    expect(
      canUseTrackingFeaturesFrom({ offline: false, lan: false, online: true }, false),
    ).toBe(false);
    expect(
      trackingFeaturesDisabledReasonFrom(
        { offline: false, lan: false, online: true },
        false,
      ),
    ).toBe("Connect a cloud database to tether tabs in Online mode");
  });

  it("blocks when no sync mode is enabled", () => {
    expect(
      canUseTrackingFeaturesFrom({ offline: false, lan: false, online: false }, true),
    ).toBe(false);
    expect(
      trackingFeaturesDisabledReasonFrom(
        { offline: false, lan: false, online: false },
        true,
      ),
    ).toBe("Enable Offline, LAN, or Online sync in settings");
  });
});
