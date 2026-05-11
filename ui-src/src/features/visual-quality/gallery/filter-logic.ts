import {
  hotspotsMatchSeverity,
  screenKey,
  severityRank,
} from "../data/report-loader";
import { type HotspotSeverity, type MergedScreen } from "../data/types";

export type SortKey =
  | "score-asc"
  | "score-desc"
  | "fixture-asc"
  | "fixture-desc"
  | "screen-asc"
  | "screen-desc"
  | "severity-desc"
  | "delta-desc";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "score-desc", label: "Score (high → low)" },
  { value: "score-asc", label: "Score (low → high)" },
  { value: "fixture-asc", label: "Fixture (A → Z)" },
  { value: "fixture-desc", label: "Fixture (Z → A)" },
  { value: "screen-asc", label: "Screen (A → Z)" },
  { value: "screen-desc", label: "Screen (Z → A)" },
  { value: "severity-desc", label: "Severity (worst first)" },
  { value: "delta-desc", label: "Regression delta (worst first)" },
];

export interface FilterState {
  query: string;
  fixtures: string[];
  minScore: number;
  severities: HotspotSeverity[];
  sort: SortKey;
}

export const DEFAULT_FILTER_STATE: FilterState = {
  query: "",
  fixtures: [],
  minScore: 0,
  severities: [],
  sort: "score-desc",
};

/**
 * Previous scores for each screen, keyed by `screenKey(…)`, sourced from the
 * most recent history entry that is *not* the current run. Used to compute a
 * per-screen regression delta for the "delta-desc" sort option.
 */
export type PreviousScoreMap = Record<string, number>;

/**
 * Applies the current filter state to a list of merged screens, returning a
 * new sorted array. Pure — never mutates inputs.
 */
export function applyFilters(
  screens: MergedScreen[],
  state: FilterState,
  previousScores: PreviousScoreMap = {},
): MergedScreen[] {
  const query = state.query.trim().toLowerCase();
  const filtered = screens.filter((screen) => {
    if (query.length > 0) {
      const haystack = `${screen.fixtureId} ${screen.screenName}`.toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    if (
      state.fixtures.length > 0 &&
      !state.fixtures.includes(screen.fixtureId)
    ) {
      return false;
    }
    if (screen.score < state.minScore) {
      return false;
    }
    const hotspots = screen.report?.hotspots ?? [];
    if (!hotspotsMatchSeverity(hotspots, state.severities)) {
      return false;
    }
    return true;
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => compareBySort(a, b, state.sort, previousScores));
  return sorted;
}

function compareBySort(
  a: MergedScreen,
  b: MergedScreen,
  sort: SortKey,
  previousScores: PreviousScoreMap,
): number {
  switch (sort) {
    case "score-asc":
      return a.score - b.score;
    case "score-desc":
      return b.score - a.score;
    case "fixture-asc":
      return (
        a.fixtureId.localeCompare(b.fixtureId) ||
        a.screenName.localeCompare(b.screenName)
      );
    case "fixture-desc":
      return (
        b.fixtureId.localeCompare(a.fixtureId) ||
        a.screenName.localeCompare(b.screenName)
      );
    case "screen-asc":
      return a.screenName.localeCompare(b.screenName);
    case "screen-desc":
      return b.screenName.localeCompare(a.screenName);
    case "severity-desc":
      return severityRank(b.worstSeverity) - severityRank(a.worstSeverity);
    case "delta-desc": {
      const dA = deltaFor(a, previousScores);
      const dB = deltaFor(b, previousScores);
      return dA - dB;
    }
  }
}

/**
 * Regression delta = currentScore - previousScore. A negative delta is a
 * regression (current is worse). Screens with no previous score rank last.
 */
export function deltaFor(
  screen: MergedScreen,
  previous: PreviousScoreMap,
): number {
  const prev = previous[screen.key];
  if (prev === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  return screen.score - prev;
}

/**
 * Serializes filter state into a URL search params object so it can drive
 * shareable URLs like `?sort=score-asc&minScore=95&fixture=foo&severity=high`.
 */
export function filterStateToSearchParams(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.query.length > 0) {
    params.set("q", state.query);
  }
  if (state.fixtures.length > 0) {
    params.set("fixture", state.fixtures.join(","));
  }
  if (state.minScore > 0) {
    params.set("minScore", state.minScore.toString());
  }
  if (state.severities.length > 0) {
    params.set("severity", state.severities.join(","));
  }
  if (state.sort !== DEFAULT_FILTER_STATE.sort) {
    params.set("sort", state.sort);
  }
  return params;
}

function isSortKey(value: string): value is SortKey {
  return SORT_OPTIONS.some((option) => option.value === value);
}

function isSeverity(value: string): value is HotspotSeverity {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "critical"
  );
}

/**
 * Parses a URL search params object back into a `FilterState`, applying
 * defaults for missing or invalid fields.
 */
export function filterStateFromSearchParams(
  params: URLSearchParams,
): FilterState {
  const rawMin = params.get("minScore");
  const parsedMin = rawMin === null ? 0 : Number.parseFloat(rawMin);
  const minScore = Number.isFinite(parsedMin)
    ? Math.max(0, Math.min(100, parsedMin))
    : 0;
  const sortParam = params.get("sort");
  const sort: SortKey =
    sortParam !== null && isSortKey(sortParam)
      ? sortParam
      : DEFAULT_FILTER_STATE.sort;
  const fixtureParam = params.get("fixture");
  const fixtures =
    fixtureParam !== null && fixtureParam.length > 0
      ? fixtureParam.split(",").filter((v) => v.length > 0)
      : [];
  const severityParam = params.get("severity");
  const severities =
    severityParam !== null && severityParam.length > 0
      ? severityParam.split(",").filter(isSeverity)
      : [];
  return {
    query: params.get("q") ?? "",
    fixtures,
    minScore,
    severities,
    sort,
  };
}

/**
 * Extracts previous scores from a history entries list, keyed by the same
 * screen key as the merged report. Only the most recent entry *before* the
 * current run is considered — earlier runs are ignored so the "delta" reflects
 * the most recent step-change.
 */
export function buildPreviousScoreMap(
  entries: {
    runAt: string;
    scores: {
      fixtureId: string;
      screenId?: string;
      viewportId?: string;
      score: number;
    }[];
  }[],
  currentRunAt: string,
): PreviousScoreMap {
  const olderSorted = entries
    .filter((entry) => entry.runAt < currentRunAt)
    .sort((a, b) => b.runAt.localeCompare(a.runAt));
  const latest = olderSorted[0];
  if (!latest) {
    return {};
  }
  const map: PreviousScoreMap = {};
  for (const score of latest.scores) {
    const key = screenKey(score.fixtureId, score.screenId, score.viewportId);
    map[key] = score.score;
  }
  return map;
}
