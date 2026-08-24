import { displayHostPath } from "./privacy";
import { getUrlPatternParts } from "./url-pattern";

export type MovedOnProgress = {
  /** How many numeric chapter/episode steps the activity is ahead of this page. */
  chaptersBehind: number | null;
  pageLabel: string | null;
  currentLabel: string | null;
};

function progressKey(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./i, "").toLowerCase();
    const path = parsed.pathname.length > 1 && parsed.pathname.endsWith("/")
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
    return `${host}${path}${parsed.search}`;
  } catch {
    return displayHostPath(url);
  }
}

/**
 * Infer "N chapters behind" from the changing URL segment between page and current.
 * Uses the same affix split as the history URL-diff UI.
 */
export function computeMovedOnProgress(
  pageUrl: string,
  currentUrl: string,
  extraComparisonUrls: string[] = [],
): MovedOnProgress {
  const page = progressKey(pageUrl);
  const current = progressKey(currentUrl);
  if (page === current) {
    return { chaptersBehind: null, pageLabel: null, currentLabel: null };
  }

  const comparison = [
    ...new Set([page, current, ...extraComparisonUrls.map((url) => progressKey(url))]),
  ];
  const pageParts = getUrlPatternParts(page, comparison);
  const currentParts = getUrlPatternParts(current, comparison);
  const pageLabel = pageParts.changing || null;
  const currentLabel = currentParts.changing || null;

  if (pageLabel && currentLabel && /^\d+$/.test(pageLabel) && /^\d+$/.test(currentLabel)) {
    const delta = Number(currentLabel) - Number(pageLabel);
    return {
      chaptersBehind: delta > 0 ? delta : null,
      pageLabel,
      currentLabel,
    };
  }

  return { chaptersBehind: null, pageLabel, currentLabel };
}

export function formatChaptersBehind(chaptersBehind: number | null | undefined): string | null {
  if (chaptersBehind == null || chaptersBehind <= 0) return null;
  if (chaptersBehind === 1) return "1 chapter behind";
  return `${chaptersBehind} chapters behind`;
}
