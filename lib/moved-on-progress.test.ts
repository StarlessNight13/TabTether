import { describe, expect, it } from "vitest";

import { computeMovedOnProgress, formatChaptersBehind } from "./moved-on-progress";

describe("computeMovedOnProgress", () => {
  it("detects numeric chapter distance", () => {
    expect(
      computeMovedOnProgress(
        "https://example.com/chapter/500",
        "https://example.com/chapter/511",
      ),
    ).toEqual({
      chaptersBehind: 11,
      pageLabel: "500",
      currentLabel: "511",
    });
  });

  it("normalizes www and trailing slash", () => {
    expect(
      computeMovedOnProgress(
        "https://www.example.com/chapter/500/",
        "https://example.com/chapter/511",
      ).chaptersBehind,
    ).toBe(11);
  });

  it("returns null distance for non-numeric changing segments", () => {
    expect(
      computeMovedOnProgress(
        "https://example.com/posts/hello",
        "https://example.com/posts/world",
      ).chaptersBehind,
    ).toBeNull();
  });

  it("returns null when the page is ahead of current", () => {
    expect(
      computeMovedOnProgress(
        "https://example.com/chapter/520",
        "https://example.com/chapter/511",
      ).chaptersBehind,
    ).toBeNull();
  });
});

describe("formatChaptersBehind", () => {
  it("formats singular and plural", () => {
    expect(formatChaptersBehind(1)).toBe("1 chapter behind");
    expect(formatChaptersBehind(11)).toBe("11 chapters behind");
    expect(formatChaptersBehind(null)).toBeNull();
  });
});
