import { describe, expect, it } from "vitest";

import { parseSeriesPattern, parseTetherMode, serializeSeriesPattern } from "./series-sync";
import type { SeriesTetherPattern } from "./tether-series";

const sample: SeriesTetherPattern = {
  status: "ready",
  anchorHostname: "example.com",
  observations: [
    {
      url: "https://example.com/ch/1",
      title: "1",
      pathname: "/ch/1",
      hostname: "example.com",
    },
  ],
  navigationCount: 3,
  urlPattern: "^/ch/\\d+$",
  stableTokens: ["/ch/"],
  changingHints: ["1", "2", "3"],
};

describe("series-sync helpers", () => {
  it("round-trips a pattern through JSON", () => {
    const raw = serializeSeriesPattern(sample);
    expect(raw).toBeTruthy();
    expect(parseSeriesPattern(raw)).toMatchObject({
      status: "ready",
      anchorHostname: "example.com",
      urlPattern: "^/ch/\\d+$",
      navigationCount: 3,
    });
  });

  it("returns undefined for invalid payloads", () => {
    expect(parseSeriesPattern("{")).toBeUndefined();
    expect(parseSeriesPattern({ status: "nope" })).toBeUndefined();
    expect(serializeSeriesPattern(null)).toBeNull();
  });

  it("parses tether modes", () => {
    expect(parseTetherMode("series")).toBe("series");
    expect(parseTetherMode("loose")).toBe("loose");
    expect(parseTetherMode(undefined)).toBe("loose");
  });
});
