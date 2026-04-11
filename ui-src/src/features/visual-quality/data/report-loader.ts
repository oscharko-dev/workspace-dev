import {
  type HistoryRuns,
  type Hotspot,
  type HotspotSeverity,
  type LastRunAggregate,
  type MergedFixture,
  type MergedReport,
  type MergedScreen,
  type ScoreEntry,
  type ScreenReport,
} from "./types";

/**
 * Map from a screen key (derived via `screenKey`) to its per-screen report
 * and any image URLs provided by the loader.
 */
export interface ScreenArtifacts {
  report?: ScreenReport;
  referenceUrl?: string;
  actualUrl?: string;
  diffUrl?: string;
}

const SEVERITY_RANK: Record<HotspotSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const SCREEN_ID_TOKEN_ESCAPE = "~";
const SCREEN_ID_TOKEN_UNDERSCORE_ESCAPE = `${SCREEN_ID_TOKEN_ESCAPE}u`;

function normalizedScreenId(
  fixtureId: string,
  screenId: string | undefined,
): string {
  const trimmed = screenId?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }
  return fixtureId;
}

/**
 * Build the canonical lookup key used to correlate a score entry from
 * `last-run.json` with a per-screen report on disk. The key deliberately
 * mirrors the on-disk directory convention:
 *   `{fixtureId}/{screenIdToken}/{viewportId}`
 * where `screenIdToken` follows the reversible benchmark encoding:
 * underscores are escaped as `~u` and colons become `_`.
 */
export function screenKey(
  fixtureId: string,
  screenId: string | undefined,
  viewportId: string | undefined,
): string {
  return screenKeyFromToken(
    fixtureId,
    toScreenIdToken(normalizedScreenId(fixtureId, screenId)),
    viewportId,
  );
}

export function toScreenIdToken(screenId: string): string {
  return screenId
    .replace(/_/g, SCREEN_ID_TOKEN_UNDERSCORE_ESCAPE)
    .replace(/:/g, "_");
}

export function screenKeyFromToken(
  fixtureId: string,
  screenIdToken: string,
  viewportId: string | undefined,
): string {
  const viewport = viewportId?.trim() || "default";
  return `${fixtureId}/${screenIdToken}/${viewport}`;
}

/**
 * Returns the highest-severity hotspot from a report, or null if there are
 * none. Used for severity filtering and "worst first" sorting.
 */
export function worstSeverityFor(
  report: ScreenReport | null,
): HotspotSeverity | null {
  if (!report || report.hotspots.length === 0) {
    return null;
  }
  let worst: HotspotSeverity | null = null;
  let worstRank = 0;
  for (const hotspot of report.hotspots) {
    const rank = SEVERITY_RANK[hotspot.severity];
    if (rank > worstRank) {
      worstRank = rank;
      worst = hotspot.severity;
    }
  }
  return worst;
}

/**
 * Returns the numeric rank of a severity, where higher = worse. Exposed so
 * sort comparators don't duplicate the table.
 */
export function severityRank(severity: HotspotSeverity | null): number {
  if (severity === null) {
    return 0;
  }
  return SEVERITY_RANK[severity];
}

/**
 * Returns `true` if any hotspot in `hotspots` matches one of the severities
 * in `selected`. Empty `selected` means "no filter".
 */
export function hotspotsMatchSeverity(
  hotspots: Hotspot[],
  selected: HotspotSeverity[],
): boolean {
  if (selected.length === 0) {
    return true;
  }
  for (const hotspot of hotspots) {
    if (selected.includes(hotspot.severity)) {
      return true;
    }
  }
  return false;
}

function mergedScreenFrom(
  score: ScoreEntry,
  artifacts: ScreenArtifacts | undefined,
): MergedScreen {
  const fixtureId = score.fixtureId;
  const screenId = normalizedScreenId(fixtureId, score.screenId);
  const screenName = score.screenName ?? screenId;
  const viewportId = score.viewportId?.trim() || "default";
  const viewportLabel = score.viewportLabel ?? viewportId;
  const key = screenKey(fixtureId, score.screenId, score.viewportId);
  const report = artifacts?.report ?? null;
  const worst = worstSeverityFor(report);
  return {
    key,
    fixtureId,
    screenId,
    screenName,
    viewportId,
    viewportLabel,
    score: score.score,
    report,
    referenceUrl: artifacts?.referenceUrl ?? null,
    actualUrl: artifacts?.actualUrl ?? null,
    diffUrl: artifacts?.diffUrl ?? null,
    worstSeverity: worst,
  };
}

/**
 * Merges the `last-run.json` aggregate with a map of per-screen artifacts
 * (reports + images) into a single `MergedReport` shape. Pure; returns a new
 * object and does not mutate inputs.
 */
export function mergeReport(
  aggregate: LastRunAggregate,
  artifactsByKey: Record<string, ScreenArtifacts>,
  history: HistoryRuns | null,
): MergedReport {
  const screensByKey: Record<string, MergedScreen> = {};
  const fixtureMap = new Map<string, MergedScreen[]>();
  let hasImages = false;

  for (const score of aggregate.scores) {
    const key = screenKey(score.fixtureId, score.screenId, score.viewportId);
    const artifacts = artifactsByKey[key];
    const merged = mergedScreenFrom(score, artifacts);
    screensByKey[key] = merged;
    if (
      merged.diffUrl !== null ||
      merged.actualUrl !== null ||
      merged.referenceUrl !== null
    ) {
      hasImages = true;
    }
    const existing = fixtureMap.get(score.fixtureId);
    if (existing) {
      existing.push(merged);
    } else {
      fixtureMap.set(score.fixtureId, [merged]);
    }
  }

  const fixtures: MergedFixture[] = [];
  for (const [fixtureId, screens] of fixtureMap.entries()) {
    const total = screens.reduce((sum, s) => sum + s.score, 0);
    const average = screens.length > 0 ? total / screens.length : 0;
    fixtures.push({
      fixtureId,
      averageScore: average,
      screens,
    });
  }
  fixtures.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));

  return {
    aggregate,
    fixtures,
    screensByKey,
    history,
    hasImages,
  };
}
