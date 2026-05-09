/**
 * Inter-rater agreement protocol for the judge-calibration gold set
 * (Issue #2109).
 *
 * EU AI Act Art. 14 (human oversight) implicitly requires that the
 * human-in-the-loop produces consistent decisions. Single-annotator
 * gold labels cannot demonstrate that. This module implements the
 * inter-rater agreement protocol layered on top of the
 * judge-calibration gold set:
 *
 *   - Each gold case carries at least two independent reviewer
 *     verdicts (`goldVerdicts`); when the reviewers disagree, an
 *     arbiter resolves the case (`adjudication`) and the case is
 *     marked `adjudicated: true`.
 *   - Cohen's κ (Cohen, 1960) is computed between the first two
 *     reviewers per judge type and per scenario class as the
 *     statistical evidence that human labels are stable.
 *   - The gate trips at `κ < 0.7` (per-judge overall) and warns at
 *     `κ < 0.8`. Per-scenario κ is reported but only gated when the
 *     paired-rating count is statistically meaningful
 *     ({@link INTER_RATER_PER_SCENARIO_GATE_MIN_PAIRS}).
 *   - A reviewer-rotation log per judge type surfaces the share of
 *     gold cases each reviewer rated so a single reviewer cannot
 *     dominate the calibration set silently.
 *
 * The module is pure: identical paired-rating inputs produce
 * byte-identical outputs.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { TEST_INTELLIGENCE_CONTRACT_VERSION } from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import type {
  JudgeCalibrationJudgeId,
  JudgeCalibrationScenarioKind,
  JudgeCalibrationVerdictLabel,
} from "./judge-calibration-eval.js";
import {
  JUDGE_CALIBRATION_EVAL_REPORT_DIRNAME,
  JUDGE_CALIBRATION_EVAL_SCHEMA_VERSION,
  JUDGE_CALIBRATION_JUDGE_IDS,
  JUDGE_CALIBRATION_SCENARIO_KINDS,
  JUDGE_CALIBRATION_VERDICT_LABELS,
} from "./judge-calibration-eval.js";

/** Stable principal label for a calibration reviewer or arbiter. */
export type CalibrationReviewer = string;

/** One reviewer's verdict on a single gold case. */
export interface CalibrationReviewerVerdict {
  readonly reviewer: CalibrationReviewer;
  readonly verdict: JudgeCalibrationVerdictLabel;
  readonly findingCodes: ReadonlyArray<string>;
  readonly rationale: string;
  readonly timestamp: string;
}

/** Arbiter resolution applied when reviewers disagreed. */
export interface CalibrationAdjudication {
  readonly arbiter: CalibrationReviewer;
  readonly verdict: JudgeCalibrationVerdictLabel;
  readonly findingCodes: ReadonlyArray<string>;
  readonly rationale: string;
  readonly timestamp: string;
}

/**
 * One paired rating between the first two reviewers on a fixture,
 * scoped to one judge × one scenario class. The kappa math is fed
 * from this projection.
 */
export interface CalibrationPairedRating {
  readonly fixtureId: string;
  readonly judge: JudgeCalibrationJudgeId;
  readonly scenarioKind: JudgeCalibrationScenarioKind;
  readonly reviewerA: CalibrationReviewer;
  readonly verdictA: JudgeCalibrationVerdictLabel;
  readonly reviewerB: CalibrationReviewer;
  readonly verdictB: JudgeCalibrationVerdictLabel;
  readonly adjudicated: boolean;
}

/** Scope key for a per-judge × per-scenario kappa cell. */
export interface InterRaterScopeKey {
  readonly judge: JudgeCalibrationJudgeId;
  readonly scenarioKind: JudgeCalibrationScenarioKind | "all";
}

/** Cohen's κ result for one scope (judge / judge × scenario). */
export interface CohenKappaResult {
  readonly sampleCount: number;
  readonly observedAgreement: number;
  readonly expectedAgreement: number;
  readonly cohensKappa: number;
  readonly degenerate: boolean;
}

export interface InterRaterScopeReport {
  readonly judge: JudgeCalibrationJudgeId;
  readonly scenarioKind: JudgeCalibrationScenarioKind | "all";
  readonly metrics: CohenKappaResult;
  readonly disagreementFixtureIds: ReadonlyArray<string>;
  readonly adjudicatedFixtureIds: ReadonlyArray<string>;
}

export interface ReviewerRotationCount {
  readonly reviewer: CalibrationReviewer;
  readonly fixtureCount: number;
  readonly share: number;
}

export interface ReviewerRotationReport {
  readonly judge: JudgeCalibrationJudgeId;
  readonly totalAssignments: number;
  readonly distinctReviewers: number;
  readonly maxShare: number;
  readonly counts: ReadonlyArray<ReviewerRotationCount>;
  readonly arbiters: ReadonlyArray<ReviewerRotationCount>;
}

export type InterRaterGateFailureReason =
  | "kappa_below_hard_floor"
  | "reviewer_share_above_hard_cap"
  | "missing_paired_ratings";

export type InterRaterGateWarningReason =
  | "kappa_below_target"
  | "reviewer_share_above_warn_cap"
  | "scenario_paired_rating_count_below_floor";

export interface InterRaterGateFailure {
  readonly reason: InterRaterGateFailureReason;
  readonly judge: JudgeCalibrationJudgeId;
  readonly scenarioKind?: JudgeCalibrationScenarioKind;
  readonly threshold: number;
  readonly observed: number;
  readonly subject?: string;
}

export interface InterRaterGateWarning {
  readonly reason: InterRaterGateWarningReason;
  readonly judge: JudgeCalibrationJudgeId;
  readonly scenarioKind?: JudgeCalibrationScenarioKind;
  readonly threshold: number;
  readonly observed: number;
  readonly subject?: string;
}

export interface InterRaterGateThresholds {
  /** Per-judge κ < this trips the hard-fail gate. */
  readonly kappaHardFloor: number;
  /** Per-judge κ < this raises a warning (but does not fail the gate). */
  readonly kappaWarnFloor: number;
  /**
   * Minimum paired-rating count below which the per-scenario κ floor is
   * reported as a warning rather than checked. With <8 paired ratings the
   * Cohen's κ point estimate is too unstable to reasonably gate against.
   */
  readonly perScenarioGateMinPairs: number;
  /** Reviewer share > this trips the hard-fail gate. */
  readonly reviewerShareHardCap: number;
  /** Reviewer share > this raises a warning. */
  readonly reviewerShareWarnCap: number;
}

export const INTER_RATER_KAPPA_HARD_FLOOR = 0.7 as const;
export const INTER_RATER_KAPPA_WARN_FLOOR = 0.8 as const;
export const INTER_RATER_PER_SCENARIO_GATE_MIN_PAIRS = 8 as const;
export const INTER_RATER_REVIEWER_SHARE_HARD_CAP = 0.6 as const;
export const INTER_RATER_REVIEWER_SHARE_WARN_CAP = 0.45 as const;

export const INTER_RATER_GATE_THRESHOLDS: InterRaterGateThresholds = Object.freeze(
  {
    kappaHardFloor: INTER_RATER_KAPPA_HARD_FLOOR,
    kappaWarnFloor: INTER_RATER_KAPPA_WARN_FLOOR,
    perScenarioGateMinPairs: INTER_RATER_PER_SCENARIO_GATE_MIN_PAIRS,
    reviewerShareHardCap: INTER_RATER_REVIEWER_SHARE_HARD_CAP,
    reviewerShareWarnCap: INTER_RATER_REVIEWER_SHARE_WARN_CAP,
  },
);

export interface InterRaterAgreementReport {
  readonly thresholds: InterRaterGateThresholds;
  readonly perJudge: Readonly<Record<JudgeCalibrationJudgeId, InterRaterScopeReport>>;
  readonly perJudgePerScenario: ReadonlyArray<InterRaterScopeReport>;
  readonly rotation: Readonly<Record<JudgeCalibrationJudgeId, ReviewerRotationReport>>;
  readonly failures: ReadonlyArray<InterRaterGateFailure>;
  readonly warnings: ReadonlyArray<InterRaterGateWarning>;
  readonly passed: boolean;
}

const round6 = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

/**
 * Compute Cohen's κ between two raters on the verdict alphabet
 * `accept | repair | reject`. Pure function: identical inputs always
 * produce byte-identical outputs (rounded to 1e-6).
 *
 * Edge cases:
 *   - Empty input: returns `{ sampleCount: 0, κ = 1, degenerate: true }`.
 *     A vacuous-truth κ keeps the gate composable: an empty cell is
 *     "perfectly aligned" by the absence of disagreement.
 *   - Marginals fully aligned (`pe == 1`): returns κ = 1 if observed
 *     agreement is also 1, otherwise κ = 0. Standard treatment for the
 *     degenerate case where chance agreement is unity.
 */
export const computeCohensKappa = (
  pairs: ReadonlyArray<{
    readonly raterA: JudgeCalibrationVerdictLabel;
    readonly raterB: JudgeCalibrationVerdictLabel;
  }>,
): CohenKappaResult => {
  const N = pairs.length;
  if (N === 0) {
    return {
      sampleCount: 0,
      observedAgreement: 1,
      expectedAgreement: 1,
      cohensKappa: 1,
      degenerate: true,
    };
  }
  const labels = JUDGE_CALIBRATION_VERDICT_LABELS;
  const rowTotals: Record<JudgeCalibrationVerdictLabel, number> = {
    accept: 0,
    repair: 0,
    reject: 0,
  };
  const colTotals: Record<JudgeCalibrationVerdictLabel, number> = {
    accept: 0,
    repair: 0,
    reject: 0,
  };
  let agree = 0;
  for (const { raterA, raterB } of pairs) {
    rowTotals[raterA] += 1;
    colTotals[raterB] += 1;
    if (raterA === raterB) agree += 1;
  }
  const observedAgreement = agree / N;
  let expectedAgreement = 0;
  for (const label of labels) {
    expectedAgreement += (rowTotals[label] * colTotals[label]) / (N * N);
  }
  const degenerate = expectedAgreement >= 1 - 1e-12;
  let cohensKappa: number;
  if (degenerate) {
    cohensKappa = observedAgreement >= 1 - 1e-12 ? 1 : 0;
  } else {
    cohensKappa = (observedAgreement - expectedAgreement) / (1 - expectedAgreement);
  }
  return {
    sampleCount: N,
    observedAgreement: round6(observedAgreement),
    expectedAgreement: round6(expectedAgreement),
    cohensKappa: round6(cohensKappa),
    degenerate,
  };
};

const sortIds = (ids: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...ids].sort((a, b) => a.localeCompare(b, "en"));

const buildScopeReport = (
  judge: JudgeCalibrationJudgeId,
  scenarioKind: JudgeCalibrationScenarioKind | "all",
  ratings: ReadonlyArray<CalibrationPairedRating>,
): InterRaterScopeReport => {
  const metrics = computeCohensKappa(
    ratings.map((rating) => ({
      raterA: rating.verdictA,
      raterB: rating.verdictB,
    })),
  );
  const disagreementFixtureIds = sortIds(
    ratings
      .filter((rating) => rating.verdictA !== rating.verdictB)
      .map((rating) => rating.fixtureId),
  );
  const adjudicatedFixtureIds = sortIds(
    ratings.filter((rating) => rating.adjudicated).map((rating) => rating.fixtureId),
  );
  return {
    judge,
    scenarioKind,
    metrics,
    disagreementFixtureIds,
    adjudicatedFixtureIds,
  };
};

const buildRotationReport = (
  judge: JudgeCalibrationJudgeId,
  ratings: ReadonlyArray<CalibrationPairedRating>,
  arbiters: ReadonlyArray<CalibrationReviewer>,
): ReviewerRotationReport => {
  const counts = new Map<CalibrationReviewer, number>();
  for (const rating of ratings) {
    counts.set(rating.reviewerA, (counts.get(rating.reviewerA) ?? 0) + 1);
    counts.set(rating.reviewerB, (counts.get(rating.reviewerB) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const flatCounts: ReviewerRotationCount[] = [...counts.entries()]
    .map(([reviewer, fixtureCount]) => ({
      reviewer,
      fixtureCount,
      share: total === 0 ? 0 : round6(fixtureCount / total),
    }))
    .sort((left, right) => {
      if (left.fixtureCount !== right.fixtureCount) {
        return right.fixtureCount - left.fixtureCount;
      }
      return left.reviewer.localeCompare(right.reviewer, "en");
    });
  const maxShare = flatCounts[0]?.share ?? 0;

  const arbiterCounts = new Map<CalibrationReviewer, number>();
  for (const arbiter of arbiters) {
    arbiterCounts.set(arbiter, (arbiterCounts.get(arbiter) ?? 0) + 1);
  }
  const arbiterTotal = arbiters.length;
  const arbiterFlat: ReviewerRotationCount[] = [...arbiterCounts.entries()]
    .map(([reviewer, fixtureCount]) => ({
      reviewer,
      fixtureCount,
      share: arbiterTotal === 0 ? 0 : round6(fixtureCount / arbiterTotal),
    }))
    .sort((left, right) => {
      if (left.fixtureCount !== right.fixtureCount) {
        return right.fixtureCount - left.fixtureCount;
      }
      return left.reviewer.localeCompare(right.reviewer, "en");
    });

  return {
    judge,
    totalAssignments: total,
    distinctReviewers: flatCounts.length,
    maxShare,
    counts: flatCounts,
    arbiters: arbiterFlat,
  };
};

export interface BuildInterRaterReportInput {
  readonly ratings: ReadonlyArray<CalibrationPairedRating>;
  readonly arbiters: ReadonlyArray<{
    readonly judge: JudgeCalibrationJudgeId;
    readonly arbiter: CalibrationReviewer;
  }>;
  readonly thresholds?: InterRaterGateThresholds;
}

const partitionByJudge = (
  ratings: ReadonlyArray<CalibrationPairedRating>,
): Record<JudgeCalibrationJudgeId, CalibrationPairedRating[]> => {
  const buckets: Record<JudgeCalibrationJudgeId, CalibrationPairedRating[]> = {
    logic: [],
    faithfulness: [],
  };
  for (const rating of ratings) {
    buckets[rating.judge].push(rating);
  }
  return buckets;
};

const partitionArbitersByJudge = (
  arbiters: ReadonlyArray<{
    readonly judge: JudgeCalibrationJudgeId;
    readonly arbiter: CalibrationReviewer;
  }>,
): Record<JudgeCalibrationJudgeId, CalibrationReviewer[]> => {
  const buckets: Record<JudgeCalibrationJudgeId, CalibrationReviewer[]> = {
    logic: [],
    faithfulness: [],
  };
  for (const entry of arbiters) {
    buckets[entry.judge].push(entry.arbiter);
  }
  return buckets;
};

/**
 * Build the full inter-rater agreement report from a flat list of
 * paired ratings (one per fixture, scoped to one judge type and one
 * scenario class). The report carries:
 *
 *   - per-judge κ
 *   - per-judge × per-scenario κ (informational when the paired-rating
 *     count is below {@link INTER_RATER_PER_SCENARIO_GATE_MIN_PAIRS};
 *     gated otherwise)
 *   - reviewer-rotation log per judge with max-share dominance check
 *   - structured failures + warnings against the gate thresholds
 */
export const buildInterRaterAgreementReport = (
  input: BuildInterRaterReportInput,
): InterRaterAgreementReport => {
  const thresholds = input.thresholds ?? INTER_RATER_GATE_THRESHOLDS;
  const sortedRatings = [...input.ratings].sort((a, b) =>
    a.fixtureId.localeCompare(b.fixtureId, "en"),
  );
  const byJudge = partitionByJudge(sortedRatings);
  const arbitersByJudge = partitionArbitersByJudge(input.arbiters);

  const perJudge: Record<JudgeCalibrationJudgeId, InterRaterScopeReport> = {
    logic: buildScopeReport("logic", "all", byJudge.logic),
    faithfulness: buildScopeReport(
      "faithfulness",
      "all",
      byJudge.faithfulness,
    ),
  };
  const perJudgePerScenario: InterRaterScopeReport[] = [];
  for (const judge of JUDGE_CALIBRATION_JUDGE_IDS) {
    for (const scenarioKind of JUDGE_CALIBRATION_SCENARIO_KINDS) {
      const subset = byJudge[judge].filter(
        (rating) => rating.scenarioKind === scenarioKind,
      );
      perJudgePerScenario.push(buildScopeReport(judge, scenarioKind, subset));
    }
  }
  const rotation: Record<JudgeCalibrationJudgeId, ReviewerRotationReport> = {
    logic: buildRotationReport("logic", byJudge.logic, arbitersByJudge.logic),
    faithfulness: buildRotationReport(
      "faithfulness",
      byJudge.faithfulness,
      arbitersByJudge.faithfulness,
    ),
  };

  const failures: InterRaterGateFailure[] = [];
  const warnings: InterRaterGateWarning[] = [];

  for (const judge of JUDGE_CALIBRATION_JUDGE_IDS) {
    const scope = perJudge[judge];
    if (scope.metrics.sampleCount === 0) {
      failures.push({
        reason: "missing_paired_ratings",
        judge,
        threshold: 1,
        observed: 0,
      });
      continue;
    }
    const kappa = scope.metrics.cohensKappa;
    if (kappa < thresholds.kappaHardFloor) {
      failures.push({
        reason: "kappa_below_hard_floor",
        judge,
        threshold: thresholds.kappaHardFloor,
        observed: kappa,
      });
    } else if (kappa < thresholds.kappaWarnFloor) {
      warnings.push({
        reason: "kappa_below_target",
        judge,
        threshold: thresholds.kappaWarnFloor,
        observed: kappa,
      });
    }
  }

  for (const scope of perJudgePerScenario) {
    if (scope.scenarioKind === "all") continue;
    const kappa = scope.metrics.cohensKappa;
    if (scope.metrics.sampleCount < thresholds.perScenarioGateMinPairs) {
      if (kappa < thresholds.kappaWarnFloor) {
        warnings.push({
          reason: "scenario_paired_rating_count_below_floor",
          judge: scope.judge,
          scenarioKind: scope.scenarioKind,
          threshold: thresholds.perScenarioGateMinPairs,
          observed: scope.metrics.sampleCount,
        });
      }
      continue;
    }
    if (kappa < thresholds.kappaHardFloor) {
      failures.push({
        reason: "kappa_below_hard_floor",
        judge: scope.judge,
        scenarioKind: scope.scenarioKind,
        threshold: thresholds.kappaHardFloor,
        observed: kappa,
      });
    } else if (kappa < thresholds.kappaWarnFloor) {
      warnings.push({
        reason: "kappa_below_target",
        judge: scope.judge,
        scenarioKind: scope.scenarioKind,
        threshold: thresholds.kappaWarnFloor,
        observed: kappa,
      });
    }
  }

  for (const judge of JUDGE_CALIBRATION_JUDGE_IDS) {
    const report = rotation[judge];
    if (report.totalAssignments === 0) continue;
    const dominant = report.counts[0];
    if (dominant === undefined) continue;
    if (dominant.share > thresholds.reviewerShareHardCap) {
      failures.push({
        reason: "reviewer_share_above_hard_cap",
        judge,
        threshold: thresholds.reviewerShareHardCap,
        observed: dominant.share,
        subject: dominant.reviewer,
      });
    } else if (dominant.share > thresholds.reviewerShareWarnCap) {
      warnings.push({
        reason: "reviewer_share_above_warn_cap",
        judge,
        threshold: thresholds.reviewerShareWarnCap,
        observed: dominant.share,
        subject: dominant.reviewer,
      });
    }
  }

  return {
    thresholds,
    perJudge,
    perJudgePerScenario,
    rotation,
    failures,
    warnings,
    passed: failures.length === 0,
  };
};

/** Filename of the inter-rater agreement artifact in the eval-reports bundle. */
export const INTER_RATER_AGREEMENT_ARTIFACT_FILENAME =
  "judge-calibration-inter-rater-agreement.json" as const;

export interface InterRaterAgreementArtifact {
  readonly schemaVersion: typeof JUDGE_CALIBRATION_EVAL_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly generatedAt: string;
  readonly report: InterRaterAgreementReport;
}

export interface BuildInterRaterAgreementArtifactInput {
  readonly report: InterRaterAgreementReport;
  readonly generatedAt: string;
}

export const buildInterRaterAgreementArtifact = (
  input: BuildInterRaterAgreementArtifactInput,
): InterRaterAgreementArtifact => ({
  schemaVersion: JUDGE_CALIBRATION_EVAL_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: input.generatedAt,
  report: input.report,
});

const writeAtomic = async (
  outputPath: string,
  content: string,
): Promise<void> => {
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, outputPath);
};

export interface WriteInterRaterAgreementArtifactInput {
  readonly artifact: InterRaterAgreementArtifact;
  readonly outputDir?: string;
}

export const writeInterRaterAgreementArtifact = async (
  input: WriteInterRaterAgreementArtifactInput,
): Promise<string> => {
  const dir = input.outputDir ?? JUDGE_CALIBRATION_EVAL_REPORT_DIRNAME;
  const outputPath = join(dir, INTER_RATER_AGREEMENT_ARTIFACT_FILENAME);
  await writeAtomic(outputPath, canonicalJson(input.artifact));
  return outputPath;
};

/** Format a gate failure as a single-line operator-readable string. */
export const formatInterRaterFailure = (
  failure: InterRaterGateFailure,
): string => {
  const scope =
    failure.scenarioKind !== undefined
      ? `${failure.judge}/${failure.scenarioKind}`
      : failure.judge;
  const subject =
    failure.subject !== undefined ? ` subject=${failure.subject}` : "";
  return (
    `${failure.reason}[${scope}](threshold=${failure.threshold},` +
    `observed=${failure.observed})${subject}`
  );
};

/** Format a gate warning as a single-line operator-readable string. */
export const formatInterRaterWarning = (
  warning: InterRaterGateWarning,
): string => {
  const scope =
    warning.scenarioKind !== undefined
      ? `${warning.judge}/${warning.scenarioKind}`
      : warning.judge;
  const subject =
    warning.subject !== undefined ? ` subject=${warning.subject}` : "";
  return (
    `${warning.reason}[${scope}](threshold=${warning.threshold},` +
    `observed=${warning.observed})${subject}`
  );
};
