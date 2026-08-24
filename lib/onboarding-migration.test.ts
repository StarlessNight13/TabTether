import { describe, expect, it } from "bun:test";

import { migrateOnboardingComplete } from "./storage";

describe("migrateOnboardingComplete", () => {
  it("leaves existing boolean alone", () => {
    expect(migrateOnboardingComplete({ onboardingComplete: false })).toBeUndefined();
    expect(migrateOnboardingComplete({ onboardingComplete: true })).toBeUndefined();
  });

  it("marks fresh installs incomplete", () => {
    expect(migrateOnboardingComplete({})).toBe(false);
  });

  it("marks legacy profiles complete when other keys exist", () => {
    expect(migrateOnboardingComplete({ deviceId: "dev_1" })).toBe(true);
    expect(migrateOnboardingComplete({ bindings: {} })).toBe(true);
  });
});
