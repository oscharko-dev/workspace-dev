import { stat } from "node:fs/promises";
import {
  assertAllowedFixtureId,
  listVisualBenchmarkFixtureIds,
  resolveVisualBenchmarkFixturePaths,
  type VisualBenchmarkFixtureOptions,
} from "./visual-benchmark.helpers.js";
import {
  loadVisualBenchmarkBaseline,
  loadVisualBenchmarkLastRun,
  saveVisualBenchmarkBaseline,
  saveVisualBenchmarkLastRun,
  type VisualBenchmarkBaseline,
  type VisualBenchmarkResult,
  type VisualBenchmarkScoreEntry,
} from "./visual-benchmark-runner.js";
import {
  runVisualBenchmarkFixture,
  type VisualBenchmarkExecutionOptions,
} from "./visual-benchmark.execution.js";

export interface VisualBaselineStatusEntry {
  fixtureId: string;
  baselineScore: number | null;
  lastRunScore: number | null;
  hasPendingDiff: boolean;
  baselineUpdatedAt: string | null;
  referencePngExists: boolean;
}

export interface VisualBaselineStatusResult {
  entries: VisualBaselineStatusEntry[];
  baselineUpdatedAt: string | null;
  lastRunAt: string | null;
}

export interface VisualBaselineDiffEntry {
  fixtureId: string;
  baseline: number | null;
  current: number;
  delta: number | null;
  indicator: "improved" | "degraded" | "neutral" | "new";
}

export interface VisualBaselineDiffResult {
  diffs: VisualBaselineDiffEntry[];
  hasPendingDiffs: boolean;
}

export interface VisualBaselineUpdateResult {
  scores: VisualBenchmarkScoreEntry[];
  previousBaseline: VisualBenchmarkBaseline | null;
}

export interface VisualBaselineApproveResult {
  fixtureId: string;
  previousScore: number | null;
  newScore: number;
}

export interface VisualBaselineDependencies extends VisualBenchmarkFixtureOptions {
  log?: (message: string) => void;
  runFixtureBenchmark?: (fixtureId: string, options?: VisualBenchmarkExecutionOptions) => Promise<VisualBenchmarkScoreEntry>;
}

const NEUTRAL_DELTA_TOLERANCE = 1;

const defaultLog = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const fixtureIdToDisplayName = (fixtureId: string): string => {
  return fixtureId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const padRight = (value: string, width: number): string => {
  return value + " ".repeat(Math.max(0, width - value.length));
};

const padLeft = (value: string, width: number): string => {
  return " ".repeat(Math.max(0, width - value.length)) + value;
};

const formatDeltaCell = (delta: number | null, indicator: string): string => {
  if (delta === null) {
    return "\u2014 \u2796";
  }
  const sign = delta > 0 ? "+" : "";
  const emoji = indicator === "improved" ? " \u2705" : indicator === "degraded" ? " \u26A0\uFE0F" : indicator === "new" ? " \uD83C\uDD95" : " \u2796";
  return `${sign}${String(delta)}${emoji}`;
};

const hr = (left: string, mid: string, right: string, fill: string, colWidths: number[]): string => {
  return `${left}${colWidths.map((w) => fill.repeat(w + 2)).join(mid)}${right}`;
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

export const updateVisualBaselines = async (
  options?: VisualBaselineDependencies & { fixtureId?: string },
): Promise<VisualBaselineUpdateResult> => {
  const log = options?.log ?? defaultLog;
  const runFixture = options?.runFixtureBenchmark ?? (
    async (id: string, opts?: VisualBenchmarkExecutionOptions) => runVisualBenchmarkFixture(id, opts)
  );

  // Determine which fixtures to run
  let fixtureIds: string[];
  if (options?.fixtureId !== undefined) {
    assertAllowedFixtureId(options.fixtureId);
    fixtureIds = [options.fixtureId];
    log(`Updating baseline for fixture '${options.fixtureId}'...`);
  } else {
    fixtureIds = await listVisualBenchmarkFixtureIds(options);
    log(`Updating baselines for ${fixtureIds.length} fixture(s)...`);
  }

  // Run benchmarks
  const scores: VisualBenchmarkScoreEntry[] = [];
  for (const fixtureId of fixtureIds) {
    log(`Running benchmark for '${fixtureId}'...`);
    const entry = await runFixture(fixtureId, options);
    scores.push(entry);
    log(`  Score: ${entry.score}`);
  }

  // Save last-run
  await saveVisualBenchmarkLastRun(scores, options);

  // Load existing baseline and merge
  const previousBaseline = await loadVisualBenchmarkBaseline(options);

  // Build the new baseline result object for saveVisualBenchmarkBaseline
  // If single fixture: merge into existing baseline
  // If all fixtures: replace entire scores
  let allScores: VisualBenchmarkScoreEntry[];
  if (options?.fixtureId !== undefined && previousBaseline !== null) {
    // Merge: replace only the updated fixture(s), keep others from baseline
    const updatedIds = new Set(scores.map((s) => s.fixtureId));
    allScores = [
      ...previousBaseline.scores.filter((s) => !updatedIds.has(s.fixtureId)),
      ...scores,
    ];
  } else {
    allScores = scores;
  }

  // Build a VisualBenchmarkResult to pass to saveVisualBenchmarkBaseline
  const result: VisualBenchmarkResult = {
    deltas: allScores.map((s) => ({
      fixtureId: s.fixtureId,
      baseline: null,
      current: s.score,
      delta: null,
      indicator: "neutral" as const,
    })),
    overallBaseline: null,
    overallCurrent: allScores.reduce((sum, s) => sum + s.score, 0) / allScores.length,
    overallDelta: null,
  };
  await saveVisualBenchmarkBaseline(result, options);

  log("Baseline updated.");
  return { scores, previousBaseline };
};

export const approveVisualBaseline = async (
  screenName: string,
  options?: VisualBaselineDependencies,
): Promise<VisualBaselineApproveResult> => {
  assertAllowedFixtureId(screenName);

  const lastRun = await loadVisualBenchmarkLastRun(options);
  if (lastRun === null) {
    throw new Error("No last run found. Run 'pnpm visual:baseline update' first.");
  }

  const lastRunEntry = lastRun.scores.find((s) => s.fixtureId === screenName);
  if (lastRunEntry === undefined) {
    const available = lastRun.scores.map((s) => s.fixtureId).join(", ");
    throw new Error(`Screen '${screenName}' not found in last run. Available: ${available}`);
  }

  const previousBaseline = await loadVisualBenchmarkBaseline(options);
  const previousScore = previousBaseline?.scores.find((s) => s.fixtureId === screenName)?.score ?? null;

  // Merge into baseline
  const existingScores = previousBaseline?.scores ?? [];
  const otherScores = existingScores.filter((s) => s.fixtureId !== screenName);
  const allScores = [...otherScores, { fixtureId: screenName, score: lastRunEntry.score }];

  const result: VisualBenchmarkResult = {
    deltas: allScores.map((s) => ({
      fixtureId: s.fixtureId,
      baseline: null,
      current: s.score,
      delta: null,
      indicator: "neutral" as const,
    })),
    overallBaseline: null,
    overallCurrent: allScores.reduce((sum, s) => sum + s.score, 0) / allScores.length,
    overallDelta: null,
  };
  await saveVisualBenchmarkBaseline(result, options);

  return { fixtureId: screenName, previousScore, newScore: lastRunEntry.score };
};

export const computeVisualBaselineStatus = async (
  options?: VisualBaselineDependencies,
): Promise<VisualBaselineStatusResult> => {
  const fixtureIds = await listVisualBenchmarkFixtureIds(options);
  const baseline = await loadVisualBenchmarkBaseline(options);
  const lastRun = await loadVisualBenchmarkLastRun(options);

  const baselineMap = new Map<string, number>();
  if (baseline !== null) {
    for (const entry of baseline.scores) {
      baselineMap.set(entry.fixtureId, entry.score);
    }
  }

  const lastRunMap = new Map<string, number>();
  if (lastRun !== null) {
    for (const entry of lastRun.scores) {
      lastRunMap.set(entry.fixtureId, entry.score);
    }
  }

  const entries: VisualBaselineStatusEntry[] = [];
  for (const fixtureId of fixtureIds) {
    const paths = resolveVisualBenchmarkFixturePaths(fixtureId, options);
    const refExists = await fileExists(paths.referencePngPath);
    const baselineScore = baselineMap.get(fixtureId) ?? null;
    const lastRunScore = lastRunMap.get(fixtureId) ?? null;
    const hasPendingDiff = lastRunScore !== null && baselineScore !== null && Math.abs(lastRunScore - baselineScore) > NEUTRAL_DELTA_TOLERANCE;

    entries.push({
      fixtureId,
      baselineScore,
      lastRunScore,
      hasPendingDiff,
      baselineUpdatedAt: baseline?.updatedAt ?? null,
      referencePngExists: refExists,
    });
  }

  return {
    entries,
    baselineUpdatedAt: baseline?.updatedAt ?? null,
    lastRunAt: lastRun?.ranAt ?? null,
  };
};

export const computeVisualBaselineDiff = async (
  options?: VisualBaselineDependencies,
): Promise<VisualBaselineDiffResult> => {
  const lastRun = await loadVisualBenchmarkLastRun(options);
  if (lastRun === null) {
    throw new Error("No last run found. Run 'pnpm visual:baseline update' first.");
  }

  const baseline = await loadVisualBenchmarkBaseline(options);
  const baselineMap = new Map<string, number>();
  if (baseline !== null) {
    for (const entry of baseline.scores) {
      baselineMap.set(entry.fixtureId, entry.score);
    }
  }

  const diffs: VisualBaselineDiffEntry[] = [];
  for (const entry of lastRun.scores) {
    const baselineScore = baselineMap.get(entry.fixtureId) ?? null;
    const delta = baselineScore !== null ? Math.round((entry.score - baselineScore) * 100) / 100 : null;
    let indicator: "improved" | "degraded" | "neutral" | "new";
    if (baselineScore === null) {
      indicator = "new";
    } else if (delta === null || Math.abs(delta) <= NEUTRAL_DELTA_TOLERANCE) {
      indicator = "neutral";
    } else if (delta > 0) {
      indicator = "improved";
    } else {
      indicator = "degraded";
    }
    diffs.push({
      fixtureId: entry.fixtureId,
      baseline: baselineScore,
      current: entry.score,
      delta,
      indicator,
    });
  }

  const hasPendingDiffs = diffs.some((d) => d.indicator !== "neutral");
  return { diffs, hasPendingDiffs };
};

export const formatVisualBaselineStatusTable = (result: VisualBaselineStatusResult): string => {
  const cols = [23, 10, 10, 10, 10];
  const lines: string[] = [];

  lines.push(hr("\u250C", "\u252C", "\u2510", "\u2500", cols));
  lines.push(
    `\u2502 ${padRight("Fixture", cols[0])} \u2502 ${padRight("Baseline", cols[1])} \u2502 ${padRight("Last Run", cols[2])} \u2502 ${padRight("Diff", cols[3])} \u2502 ${padRight("Reference", cols[4])} \u2502`
  );
  lines.push(hr("\u251C", "\u253C", "\u2524", "\u2500", cols));

  for (const entry of result.entries) {
    const name = fixtureIdToDisplayName(entry.fixtureId);
    const baseStr = entry.baselineScore !== null ? String(entry.baselineScore) : "\u2014";
    const lastStr = entry.lastRunScore !== null ? String(entry.lastRunScore) : "\u2014";
    let diffStr: string;
    if (entry.lastRunScore === null || entry.baselineScore === null) {
      diffStr = "\u2014 \u2796";
    } else {
      const delta = Math.round((entry.lastRunScore - entry.baselineScore) * 100) / 100;
      const ind = Math.abs(delta) <= NEUTRAL_DELTA_TOLERANCE ? "neutral" : delta > 0 ? "improved" : "degraded";
      diffStr = formatDeltaCell(delta, ind);
    }
    const refStr = entry.referencePngExists ? "\u2713" : "\u2717";

    lines.push(
      `\u2502 ${padRight(name, cols[0])} \u2502 ${padLeft(baseStr, cols[1])} \u2502 ${padLeft(lastStr, cols[2])} \u2502 ${padRight(diffStr, cols[3])} \u2502 ${padRight(refStr, cols[4])} \u2502`
    );
  }

  lines.push(hr("\u251C", "\u253C", "\u2524", "\u2500", cols));

  const updatedStr = result.baselineUpdatedAt !== null ? `Updated: ${result.baselineUpdatedAt.slice(0, 10)}` : "No baseline";
  const lastRunStr = result.lastRunAt !== null ? `Last run: ${result.lastRunAt.slice(0, 10)}` : "No last run";
  lines.push(
    `\u2502 ${padRight(updatedStr, cols[0])} \u2502 ${padRight("", cols[1])} \u2502 ${padRight("", cols[2])} \u2502 ${padRight("", cols[3])} \u2502 ${padRight(lastRunStr, cols[4])} \u2502`
  );
  lines.push(hr("\u2514", "\u2534", "\u2518", "\u2500", cols));

  return lines.join("\n");
};

export const formatVisualBaselineDiffTable = (result: VisualBaselineDiffResult): string => {
  const cols = [23, 10, 10, 10];
  const lines: string[] = [];

  lines.push(hr("\u250C", "\u252C", "\u2510", "\u2500", cols));
  lines.push(
    `\u2502 ${padRight("Fixture", cols[0])} \u2502 ${padRight("Baseline", cols[1])} \u2502 ${padRight("Current", cols[2])} \u2502 ${padRight("Delta", cols[3])} \u2502`
  );
  lines.push(hr("\u251C", "\u253C", "\u2524", "\u2500", cols));

  for (const diff of result.diffs) {
    const name = fixtureIdToDisplayName(diff.fixtureId);
    const baseStr = diff.baseline !== null ? String(diff.baseline) : "\u2014";
    const curStr = String(diff.current);
    const deltaStr = formatDeltaCell(diff.delta, diff.indicator);

    lines.push(
      `\u2502 ${padRight(name, cols[0])} \u2502 ${padLeft(baseStr, cols[1])} \u2502 ${padLeft(curStr, cols[2])} \u2502 ${padRight(deltaStr, cols[3])} \u2502`
    );
  }

  lines.push(hr("\u2514", "\u2534", "\u2518", "\u2500", cols));
  return lines.join("\n");
};
