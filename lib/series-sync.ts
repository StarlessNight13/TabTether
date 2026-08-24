import type { SeriesTetherPattern, TetherMode } from "./tether-series";

const MAX_SYNCED_OBSERVATIONS = 12;

/** Compact pattern payload for cloud/LAN sync (caps observation list). */
export function serializeSeriesPattern(pattern: SeriesTetherPattern | undefined | null): string | null {
  if (!pattern) return null;
  const compact: SeriesTetherPattern = {
    ...pattern,
    observations: pattern.observations.slice(-MAX_SYNCED_OBSERVATIONS),
  };
  return JSON.stringify(compact);
}

export function parseSeriesPattern(raw: unknown): SeriesTetherPattern | undefined {
  if (raw == null || raw === "") return undefined;
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || typeof value !== "object") return undefined;
    const pattern = value as Partial<SeriesTetherPattern>;
    if (pattern.status !== "learning" && pattern.status !== "ready") return undefined;
    if (typeof pattern.anchorHostname !== "string") return undefined;
    if (!Array.isArray(pattern.observations)) return undefined;
    if (typeof pattern.navigationCount !== "number") return undefined;
    if (!Array.isArray(pattern.stableTokens) || !Array.isArray(pattern.changingHints)) {
      return undefined;
    }
    return {
      status: pattern.status,
      anchorHostname: pattern.anchorHostname,
      observations: pattern.observations.filter(
        (entry): entry is SeriesTetherPattern["observations"][number] =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof entry.url === "string" &&
          typeof entry.pathname === "string" &&
          typeof entry.hostname === "string",
      ),
      navigationCount: pattern.navigationCount,
      urlPattern: typeof pattern.urlPattern === "string" ? pattern.urlPattern : undefined,
      titlePattern: typeof pattern.titlePattern === "string" ? pattern.titlePattern : undefined,
      stableTokens: pattern.stableTokens.filter((token): token is string => typeof token === "string"),
      changingHints: pattern.changingHints.filter((hint): hint is string => typeof hint === "string"),
    };
  } catch {
    return undefined;
  }
}

export function parseTetherMode(raw: unknown): TetherMode {
  return raw === "series" ? "series" : "loose";
}
