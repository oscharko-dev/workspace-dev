/**
 * Active-learning sample-selection loop (Issue #2119).
 *
 * As the test-intelligence gold set grows past 50 fixtures the manual
 * curation cost dominates throughput. This module implements the
 * uncertainty-informed loop that picks the next batch of production
 * cases for SME labeling:
 *
 *   - **Predictive uncertainty.** Per-judge confidence near 0.5 (where
 *     the judge is least decisive) — the canonical active-learning
 *     signal.
 *   - **Cross-judge disagreement.** Reuses the `JudgeConsensusVerdict`
 *     `agreementShape` and `vetoBy` produced by Issue #2102. A `vetoed`
 *     or `split` shape, or any high-confidence reject veto, marks a
 *     case as a real ambiguity worth a human label.
 *   - **Drift-flagged cases.** Cases tagged by the canary harness from
 *     Issue #2103 (`drift-report.json` findings on metric shift,
 *     fingerprint change, or cross-family correlation) get prioritized
 *     so re-calibration data lands at the same time as the drift signal.
 *
 * The output is a canonical-JSON `active-learning-queue.json` artifact
 * picked up by the admin portal as the SME labeling queue. Queued cases
 * are tracked through to gold-set add via the `growth-log.json` and
 * gated quarterly (≥ 20 added cases per quarter) so the active-learning
 * loop stays load-bearing rather than decorative. Cases re-entering the
 * gold set are then routed through the inter-rater agreement protocol
 * (Issue #2109) so κ ≥ 0.8 stays the floor on calibration validity —
 * no active-learning add bypasses the human-oversight gate.
 *
 * The module is pure and deterministic: identical candidate inputs and
 * the same `(seed, generatedAt, capacity, weights)` always produce the
 * same queue, the same composite scores, and a byte-identical artifact.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  JUDGE_CONSENSUS_AGREEMENT_SHAPES,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type JudgeConsensusAgreementShape,
  type JudgeConsensusVeto,
  type JudgeModelFamily,
  type LogicJudgeVerdictLabel,
  type TestCaseRiskCategory,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildInterRaterAgreementReport,
  INTER_RATER_GATE_THRESHOLDS,
  type CalibrationPairedRating,
  type CalibrationReviewer,
  type InterRaterAgreementReport,
  type InterRaterGateThresholds,
} from "./inter-rater-agreement.js";
import {
  JUDGE_CALIBRATION_JUDGE_IDS,
  JUDGE_CALIBRATION_SCENARIO_KINDS,
  type JudgeCalibrationJudgeId,
  type JudgeCalibrationScenarioKind,
} from "./judge-calibration-eval.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Schema version pinned on every persisted active-learning artifact. */
export const ACTIVE_LEARNING_SAMPLER_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical filename written under `<runDir>/`. */
export const ACTIVE_LEARNING_QUEUE_ARTIFACT_FILENAME =
  "active-learning-queue.json" as const;

/** Canonical filename for the cycle-history growth log. */
export const ACTIVE_LEARNING_GROWTH_LOG_ARTIFACT_FILENAME =
  "active-learning-growth-log.json" as const;

/** Default capacity for one cycle (acceptance bar: ≥ 20 cases per quarter). */
export const ACTIVE_LEARNING_DEFAULT_CAPACITY = 25 as const;

/**
 * Quarterly floor on net gold-set growth via the active-learning loop.
 * The CI gate fails when fewer than this many cases are added in the
 * trailing calendar quarter.
 */
export const ACTIVE_LEARNING_QUARTERLY_GROWTH_FLOOR = 20 as const;

/**
 * Confidence band that triggers the uncertainty signal. A judge whose
 * confidence falls in `[0.5 - half-band, 0.5 + half-band]` is treated
 * as fully uncertain (score = 1).
 */
export const ACTIVE_LEARNING_UNCERTAINTY_HALF_BAND = 0.1 as const;

/**
 * High-confidence reject threshold imported from #2102. A reject from
 * a judge with confidence ≥ this value escalates the disagreement
 * signal even when no formal `vetoBy` field is set, mirroring the
 * `JudgeConsensusVeto` activation rule.
 */
export const ACTIVE_LEARNING_HIGH_CONFIDENCE_VETO_THRESHOLD = 0.8 as const;

/**
 * Risk classes that trigger a mandatory queueing override regardless
 * of composite score. Mirrors the #2102 rule that disagreement on
 * regulated data or financial-transaction cases is always escalated
 * to human review.
 */
export const ACTIVE_LEARNING_MANDATORY_RISK_CATEGORIES: ReadonlyArray<TestCaseRiskCategory> =
  Object.freeze(["regulated_data", "financial_transaction"]);

const MANDATORY_RISK_SET: ReadonlySet<TestCaseRiskCategory> = new Set(
  ACTIVE_LEARNING_MANDATORY_RISK_CATEGORIES,
);

/** Closed list of selection reasons annotated on every queue entry. */
export const ACTIVE_LEARNING_SELECTION_REASONS = [
  "drift",
  "high_confidence_veto",
  "mandatory_risk_override",
  "uncertainty",
  "vote_split",
] as const;

export type ActiveLearningSelectionReason =
  (typeof ACTIVE_LEARNING_SELECTION_REASONS)[number];

const SELECTION_REASON_SET: ReadonlySet<ActiveLearningSelectionReason> = new Set(
  ACTIVE_LEARNING_SELECTION_REASONS,
);

/** Default per-component weights. Kept in [0, 1] and summing to 1. */
export interface ActiveLearningWeights {
  readonly uncertainty: number;
  readonly disagreement: number;
  readonly drift: number;
}

export const ACTIVE_LEARNING_DEFAULT_WEIGHTS: ActiveLearningWeights =
  Object.freeze({ uncertainty: 0.5, disagreement: 0.3, drift: 0.2 });

const SCORE_PRECISION = 1_000_000;
const round6 = (value: number): number =>
  Math.round(value * SCORE_PRECISION) / SCORE_PRECISION;

const AGREEMENT_SHAPE_DISAGREEMENT: Readonly<Record<JudgeConsensusAgreementShape, number>> =
  Object.freeze({
    unanimous: 0,
    majority: 0.5,
    split: 1,
    vetoed: 1,
  });

const VERDICT_LABEL_SET: ReadonlySet<LogicJudgeVerdictLabel> = new Set([
  "accept",
  "repair",
  "reject",
]);

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One judge entry surfaced from the production-runner consensus panel. */
export interface ActiveLearningPanelEntry {
  readonly judgeId: string;
  readonly verdict: LogicJudgeVerdictLabel;
  /** Optional normalized confidence in [0, 1]. Missing → treated as 1.0. */
  readonly confidence?: number;
  readonly family?: JudgeModelFamily;
}

/**
 * Drift signal projection — only the bits the sampler needs to
 * compute the drift component score.
 */
export interface ActiveLearningDriftSignal {
  /** True when at least one finding flags this case in the drift report. */
  readonly flagged: boolean;
  /** Optional list of finding kinds for audit. Sorted on artifact emit. */
  readonly findingKinds?: ReadonlyArray<string>;
}

/** One candidate production case fed into a sampling cycle. */
export interface ActiveLearningCandidateCase {
  readonly caseId: string;
  /** Primary judge type the gold-set growth feeds (logic or faithfulness). */
  readonly judge: JudgeCalibrationJudgeId;
  readonly scenarioKind: JudgeCalibrationScenarioKind;
  readonly riskCategory: TestCaseRiskCategory;
  readonly observedAt: string;
  readonly panel: ReadonlyArray<ActiveLearningPanelEntry>;
  readonly agreementShape: JudgeConsensusAgreementShape;
  readonly vetoBy?: JudgeConsensusVeto;
  readonly drift: ActiveLearningDriftSignal;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** Component-wise score breakdown for one candidate. */
export interface ActiveLearningScoreBreakdown {
  readonly uncertainty: number;
  readonly disagreement: number;
  readonly drift: number;
  readonly composite: number;
}

/** One queued case ready for SME labeling. */
export interface ActiveLearningQueueItem {
  readonly caseId: string;
  readonly judge: JudgeCalibrationJudgeId;
  readonly scenarioKind: JudgeCalibrationScenarioKind;
  readonly riskCategory: TestCaseRiskCategory;
  readonly observedAt: string;
  readonly agreementShape: JudgeConsensusAgreementShape;
  readonly score: ActiveLearningScoreBreakdown;
  readonly reasons: ReadonlyArray<ActiveLearningSelectionReason>;
  readonly mandatoryOverride: boolean;
}

/** Roll-up counters surfaced on the persisted queue artifact. */
export interface ActiveLearningQueueAggregate {
  readonly populationSize: number;
  readonly capacity: number;
  readonly selectedCount: number;
  readonly mandatoryOverrideCount: number;
  readonly perJudgeCounts: Readonly<Record<JudgeCalibrationJudgeId, number>>;
  readonly perReasonCounts: Readonly<
    Record<ActiveLearningSelectionReason, number>
  >;
}

/** Persisted, canonical-JSON, per-cycle active-learning queue. */
export interface ActiveLearningQueueArtifact {
  readonly schemaVersion: typeof ACTIVE_LEARNING_SAMPLER_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly generatedAt: string;
  readonly cycleId: string;
  readonly capacity: number;
  readonly weights: ActiveLearningWeights;
  readonly aggregate: ActiveLearningQueueAggregate;
  readonly items: ReadonlyArray<ActiveLearningQueueItem>;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const assertWeightsValid = (weights: ActiveLearningWeights): void => {
  for (const [key, value] of Object.entries(weights)) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    ) {
      throw new RangeError(
        `active-learning-sampler: weights.${key} must be a finite number in [0, 1]`,
      );
    }
  }
  const sum = weights.uncertainty + weights.disagreement + weights.drift;
  if (Math.abs(sum - 1) > 1e-9) {
    throw new RangeError(
      `active-learning-sampler: weights must sum to 1; got ${sum}`,
    );
  }
};

const assertCandidateValid = (candidate: ActiveLearningCandidateCase): void => {
  if (typeof candidate.caseId !== "string" || candidate.caseId.length === 0) {
    throw new TypeError(
      "active-learning-sampler: every candidate must carry a non-empty caseId",
    );
  }
  if (
    !JUDGE_CALIBRATION_JUDGE_IDS.includes(
      candidate.judge as JudgeCalibrationJudgeId,
    )
  ) {
    throw new RangeError(
      `active-learning-sampler: candidate "${candidate.caseId}" judge "${candidate.judge}" is not a known JudgeCalibrationJudgeId`,
    );
  }
  if (
    !JUDGE_CALIBRATION_SCENARIO_KINDS.includes(
      candidate.scenarioKind as JudgeCalibrationScenarioKind,
    )
  ) {
    throw new RangeError(
      `active-learning-sampler: candidate "${candidate.caseId}" scenarioKind "${candidate.scenarioKind}" is not a known JudgeCalibrationScenarioKind`,
    );
  }
  if (!JUDGE_CONSENSUS_AGREEMENT_SHAPES.includes(candidate.agreementShape)) {
    throw new RangeError(
      `active-learning-sampler: candidate "${candidate.caseId}" agreementShape "${candidate.agreementShape}" is not a known JudgeConsensusAgreementShape`,
    );
  }
  if (candidate.panel.length === 0) {
    throw new RangeError(
      `active-learning-sampler: candidate "${candidate.caseId}" panel must be a non-empty array`,
    );
  }
  for (const entry of candidate.panel) {
    if (typeof entry.judgeId !== "string" || entry.judgeId.length === 0) {
      throw new TypeError(
        `active-learning-sampler: candidate "${candidate.caseId}" panel entry must carry a non-empty judgeId`,
      );
    }
    if (!VERDICT_LABEL_SET.has(entry.verdict)) {
      throw new RangeError(
        `active-learning-sampler: candidate "${candidate.caseId}" panel verdict "${entry.verdict}" is not a known LogicJudgeVerdictLabel`,
      );
    }
    if (entry.confidence !== undefined) {
      if (
        typeof entry.confidence !== "number" ||
        !Number.isFinite(entry.confidence) ||
        entry.confidence < 0 ||
        entry.confidence > 1
      ) {
        throw new RangeError(
          `active-learning-sampler: candidate "${candidate.caseId}" panel confidence must be a finite number in [0, 1]`,
        );
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Component scoring
// ---------------------------------------------------------------------------

/**
 * Uncertainty score per the canonical active-learning formulation:
 * the maximum across the panel of `1 − 2·|c − 0.5|`, clipped at the
 * `ACTIVE_LEARNING_UNCERTAINTY_HALF_BAND` plateau so a tight cluster
 * around 0.5 is not penalised by a knife-edge formula. Confidence-less
 * panel entries contribute 0 (treated as fully decisive).
 */
export const computeUncertaintyScore = (
  panel: ReadonlyArray<ActiveLearningPanelEntry>,
): number => {
  let best = 0;
  for (const entry of panel) {
    if (entry.confidence === undefined) continue;
    const distance = Math.abs(entry.confidence - 0.5);
    if (distance <= ACTIVE_LEARNING_UNCERTAINTY_HALF_BAND) {
      return 1;
    }
    const score = Math.max(0, 1 - 2 * distance);
    if (score > best) best = score;
  }
  return round6(best);
};

/**
 * Disagreement score — combines the consensus shape from #2102 with
 * the high-confidence reject heuristic so a unanimous-but-noisy panel
 * still surfaces when one judge rejects with high confidence.
 */
export const computeDisagreementScore = (
  candidate: ActiveLearningCandidateCase,
): number => {
  const shapeScore = AGREEMENT_SHAPE_DISAGREEMENT[candidate.agreementShape];
  if (candidate.vetoBy !== undefined) {
    return 1;
  }
  let highConfReject = 0;
  for (const entry of candidate.panel) {
    if (
      entry.verdict === "reject" &&
      entry.confidence !== undefined &&
      entry.confidence >= ACTIVE_LEARNING_HIGH_CONFIDENCE_VETO_THRESHOLD
    ) {
      highConfReject = 1;
      break;
    }
  }
  return round6(Math.max(shapeScore, highConfReject));
};

/** Drift score — 1 when the case is flagged by the canary harness, else 0. */
export const computeDriftScore = (
  drift: ActiveLearningDriftSignal,
): number => (drift.flagged ? 1 : 0);

const computeCompositeScore = (
  components: { uncertainty: number; disagreement: number; drift: number },
  weights: ActiveLearningWeights,
): number =>
  round6(
    components.uncertainty * weights.uncertainty +
      components.disagreement * weights.disagreement +
      components.drift * weights.drift,
  );

const collectReasons = (
  candidate: ActiveLearningCandidateCase,
  components: { uncertainty: number; disagreement: number; drift: number },
): ReadonlyArray<ActiveLearningSelectionReason> => {
  const reasons = new Set<ActiveLearningSelectionReason>();
  if (components.uncertainty > 0) reasons.add("uncertainty");
  if (
    candidate.vetoBy !== undefined ||
    candidate.agreementShape === "vetoed"
  ) {
    reasons.add("high_confidence_veto");
  }
  if (
    candidate.agreementShape === "split" ||
    candidate.agreementShape === "majority"
  ) {
    reasons.add("vote_split");
  }
  for (const entry of candidate.panel) {
    if (
      entry.verdict === "reject" &&
      entry.confidence !== undefined &&
      entry.confidence >= ACTIVE_LEARNING_HIGH_CONFIDENCE_VETO_THRESHOLD
    ) {
      reasons.add("high_confidence_veto");
    }
  }
  if (components.drift > 0) reasons.add("drift");
  if (MANDATORY_RISK_SET.has(candidate.riskCategory)) {
    reasons.add("mandatory_risk_override");
  }
  return [...reasons].sort((a, b) => a.localeCompare(b, "en"));
};

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface BuildActiveLearningQueueArtifactInput {
  readonly cycleId: string;
  readonly generatedAt: string;
  readonly candidates: ReadonlyArray<ActiveLearningCandidateCase>;
  readonly capacity?: number;
  readonly weights?: ActiveLearningWeights;
}

interface ScoredCandidate {
  readonly candidate: ActiveLearningCandidateCase;
  readonly components: {
    readonly uncertainty: number;
    readonly disagreement: number;
    readonly drift: number;
  };
  readonly composite: number;
  readonly reasons: ReadonlyArray<ActiveLearningSelectionReason>;
  readonly mandatoryOverride: boolean;
}

const scoreCandidate = (
  candidate: ActiveLearningCandidateCase,
  weights: ActiveLearningWeights,
): ScoredCandidate => {
  const components = {
    uncertainty: computeUncertaintyScore(candidate.panel),
    disagreement: computeDisagreementScore(candidate),
    drift: computeDriftScore(candidate.drift),
  };
  const composite = computeCompositeScore(components, weights);
  const reasons = collectReasons(candidate, components);
  const mandatoryOverride = MANDATORY_RISK_SET.has(candidate.riskCategory);
  return { candidate, components, composite, reasons, mandatoryOverride };
};

const compareScored = (a: ScoredCandidate, b: ScoredCandidate): number => {
  if (a.mandatoryOverride !== b.mandatoryOverride) {
    return a.mandatoryOverride ? -1 : 1;
  }
  if (a.composite !== b.composite) {
    return b.composite - a.composite;
  }
  return a.candidate.caseId.localeCompare(b.candidate.caseId, "en");
};

/**
 * Pure builder. Validates inputs, scores every candidate, and returns
 * the canonical queue artifact for the cycle. Mandatory-risk cases are
 * always queued first (capacity permitting) and are admitted even when
 * their composite score is 0 — the #2102 escalation rule for
 * regulated_data / financial_transaction always wins.
 */
export const buildActiveLearningQueueArtifact = (
  input: BuildActiveLearningQueueArtifactInput,
): ActiveLearningQueueArtifact => {
  const weights = input.weights ?? ACTIVE_LEARNING_DEFAULT_WEIGHTS;
  assertWeightsValid(weights);
  const capacity = input.capacity ?? ACTIVE_LEARNING_DEFAULT_CAPACITY;
  if (
    !Number.isFinite(capacity) ||
    !Number.isInteger(capacity) ||
    capacity < 0
  ) {
    throw new RangeError(
      `active-learning-sampler: capacity must be a non-negative integer; got ${capacity}`,
    );
  }
  if (typeof input.cycleId !== "string" || input.cycleId.length === 0) {
    throw new TypeError(
      "active-learning-sampler: cycleId must be a non-empty string",
    );
  }
  if (
    typeof input.generatedAt !== "string" ||
    Number.isNaN(Date.parse(input.generatedAt))
  ) {
    throw new TypeError(
      "active-learning-sampler: generatedAt must be an ISO-8601 date string",
    );
  }

  const seenCaseIds = new Set<string>();
  const scored: ScoredCandidate[] = [];
  for (const candidate of input.candidates) {
    assertCandidateValid(candidate);
    if (seenCaseIds.has(candidate.caseId)) {
      throw new Error(
        `active-learning-sampler: duplicate caseId "${candidate.caseId}"`,
      );
    }
    seenCaseIds.add(candidate.caseId);
    scored.push(scoreCandidate(candidate, weights));
  }
  scored.sort(compareScored);

  const selected = scored.slice(0, capacity);

  const perJudgeCounts: Record<JudgeCalibrationJudgeId, number> = {
    logic: 0,
    faithfulness: 0,
  };
  const perReasonCounts: Record<ActiveLearningSelectionReason, number> = {
    drift: 0,
    high_confidence_veto: 0,
    mandatory_risk_override: 0,
    uncertainty: 0,
    vote_split: 0,
  };
  let mandatoryOverrideCount = 0;
  const items: ActiveLearningQueueItem[] = selected.map((scoredCandidate) => {
    perJudgeCounts[scoredCandidate.candidate.judge] += 1;
    if (scoredCandidate.mandatoryOverride) {
      mandatoryOverrideCount += 1;
    }
    for (const reason of scoredCandidate.reasons) {
      if (SELECTION_REASON_SET.has(reason)) {
        perReasonCounts[reason] += 1;
      }
    }
    const item: ActiveLearningQueueItem = {
      caseId: scoredCandidate.candidate.caseId,
      judge: scoredCandidate.candidate.judge,
      scenarioKind: scoredCandidate.candidate.scenarioKind,
      riskCategory: scoredCandidate.candidate.riskCategory,
      observedAt: scoredCandidate.candidate.observedAt,
      agreementShape: scoredCandidate.candidate.agreementShape,
      score: {
        uncertainty: scoredCandidate.components.uncertainty,
        disagreement: scoredCandidate.components.disagreement,
        drift: scoredCandidate.components.drift,
        composite: scoredCandidate.composite,
      },
      reasons: scoredCandidate.reasons,
      mandatoryOverride: scoredCandidate.mandatoryOverride,
    };
    return item;
  });

  return {
    schemaVersion: ACTIVE_LEARNING_SAMPLER_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    cycleId: input.cycleId,
    capacity,
    weights,
    aggregate: {
      populationSize: scored.length,
      capacity,
      selectedCount: items.length,
      mandatoryOverrideCount,
      perJudgeCounts,
      perReasonCounts,
    },
    items,
  };
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export const activeLearningQueueArtifactPath = (runDir: string): string =>
  join(runDir, ACTIVE_LEARNING_QUEUE_ARTIFACT_FILENAME);

export const activeLearningGrowthLogPath = (runDir: string): string =>
  join(runDir, ACTIVE_LEARNING_GROWTH_LOG_ARTIFACT_FILENAME);

const atomicWrite = async (path: string, payload: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, payload, "utf8");
  await rename(tempPath, path);
};

export const writeActiveLearningQueueArtifact = async (input: {
  readonly artifact: ActiveLearningQueueArtifact;
  readonly runDir: string;
}): Promise<string> => {
  const outputPath = activeLearningQueueArtifactPath(input.runDir);
  await atomicWrite(outputPath, canonicalJson(input.artifact));
  return outputPath;
};

export const runActiveLearningSampler = async (
  input: BuildActiveLearningQueueArtifactInput & { readonly runDir: string },
): Promise<{
  readonly artifact: ActiveLearningQueueArtifact;
  readonly outputPath: string;
}> => {
  const artifact = buildActiveLearningQueueArtifact(input);
  const outputPath = await writeActiveLearningQueueArtifact({
    artifact,
    runDir: input.runDir,
  });
  return { artifact, outputPath };
};

// ---------------------------------------------------------------------------
// Growth-log + quarterly gate (Acceptance: ≥ 20 cases per quarter)
// ---------------------------------------------------------------------------

/** One persisted record in the active-learning growth log. */
export interface ActiveLearningGrowthRecord {
  readonly cycleId: string;
  readonly addedAt: string;
  readonly addedCaseIds: ReadonlyArray<string>;
}

/** Persisted, canonical-JSON growth log of cases added to the gold set. */
export interface ActiveLearningGrowthLog {
  readonly schemaVersion: typeof ACTIVE_LEARNING_SAMPLER_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly recordedAt: string;
  readonly records: ReadonlyArray<ActiveLearningGrowthRecord>;
}

export interface ActiveLearningQuarterlyGrowthSummary {
  readonly quarterKey: string;
  readonly quarterStart: string;
  readonly quarterEnd: string;
  readonly addedCases: number;
  readonly threshold: number;
  readonly deficit: number;
  readonly passed: boolean;
}

const QUARTER_MONTHS = [0, 3, 6, 9] as const;

const formatIsoTimestamp = (date: Date): string => date.toISOString();

const quarterStartForDate = (date: Date): Date => {
  const month = date.getUTCMonth();
  const startMonth =
    QUARTER_MONTHS[Math.floor(month / 3)] ?? QUARTER_MONTHS[0];
  return new Date(Date.UTC(date.getUTCFullYear(), startMonth, 1, 0, 0, 0, 0));
};

const quarterEndForDate = (date: Date): Date => {
  const start = quarterStartForDate(date);
  return new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1, 0, 0, 0, 0),
  );
};

const quarterKeyForDate = (date: Date): string => {
  const month = date.getUTCMonth();
  const quarter = Math.floor(month / 3) + 1;
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-Q${quarter}`;
};

/**
 * Build a quarterly summary covering the calendar quarter that contains
 * `asOfIsoTimestamp`. Counts every case added in that window, deduped
 * across cycles so a case re-queued mid-quarter still counts once.
 */
export const summariseActiveLearningQuarterlyGrowth = (input: {
  readonly log: ActiveLearningGrowthLog;
  readonly asOfIsoTimestamp: string;
  readonly threshold?: number;
}): ActiveLearningQuarterlyGrowthSummary => {
  const asOf = new Date(input.asOfIsoTimestamp);
  if (Number.isNaN(asOf.getTime())) {
    throw new TypeError(
      "active-learning-sampler: asOfIsoTimestamp must be an ISO-8601 date string",
    );
  }
  const start = quarterStartForDate(asOf);
  const end = quarterEndForDate(asOf);
  const threshold = input.threshold ?? ACTIVE_LEARNING_QUARTERLY_GROWTH_FLOOR;
  if (
    !Number.isFinite(threshold) ||
    !Number.isInteger(threshold) ||
    threshold < 0
  ) {
    throw new RangeError(
      `active-learning-sampler: threshold must be a non-negative integer; got ${threshold}`,
    );
  }

  const seen = new Set<string>();
  for (const record of input.log.records) {
    const at = new Date(record.addedAt);
    if (Number.isNaN(at.getTime())) {
      throw new TypeError(
        `active-learning-sampler: record "${record.cycleId}" has invalid addedAt`,
      );
    }
    if (at.getTime() < start.getTime() || at.getTime() >= end.getTime()) {
      continue;
    }
    for (const caseId of record.addedCaseIds) {
      seen.add(caseId);
    }
  }
  const addedCases = seen.size;
  return {
    quarterKey: quarterKeyForDate(asOf),
    quarterStart: formatIsoTimestamp(start),
    quarterEnd: formatIsoTimestamp(end),
    addedCases,
    threshold,
    deficit: Math.max(0, threshold - addedCases),
    passed: addedCases >= threshold,
  };
};

/**
 * CI-gate evaluator: throws on quarterly-deficit so the pipeline trips
 * loudly. Returns the summary for callers that prefer non-throwing
 * inspection. Either side of the gate sees the same arithmetic.
 */
export const evaluateActiveLearningQuarterlyGate = (input: {
  readonly log: ActiveLearningGrowthLog;
  readonly asOfIsoTimestamp: string;
  readonly threshold?: number;
}): ActiveLearningQuarterlyGrowthSummary => {
  const summary = summariseActiveLearningQuarterlyGrowth(input);
  if (!summary.passed) {
    throw new Error(
      `active-learning-sampler: quarterly growth gate failed — ${summary.addedCases}/${summary.threshold} cases added in ${summary.quarterKey} (deficit ${summary.deficit})`,
    );
  }
  return summary;
};

export const buildActiveLearningGrowthLog = (input: {
  readonly recordedAt: string;
  readonly records: ReadonlyArray<ActiveLearningGrowthRecord>;
}): ActiveLearningGrowthLog => {
  if (
    typeof input.recordedAt !== "string" ||
    Number.isNaN(Date.parse(input.recordedAt))
  ) {
    throw new TypeError(
      "active-learning-sampler: recordedAt must be an ISO-8601 date string",
    );
  }
  const seenCycleIds = new Set<string>();
  const sortedRecords: ActiveLearningGrowthRecord[] = [];
  for (const record of input.records) {
    if (typeof record.cycleId !== "string" || record.cycleId.length === 0) {
      throw new TypeError(
        "active-learning-sampler: every growth record must carry a non-empty cycleId",
      );
    }
    if (seenCycleIds.has(record.cycleId)) {
      throw new Error(
        `active-learning-sampler: duplicate growth-log cycleId "${record.cycleId}"`,
      );
    }
    seenCycleIds.add(record.cycleId);
    if (Number.isNaN(Date.parse(record.addedAt))) {
      throw new TypeError(
        `active-learning-sampler: growth record "${record.cycleId}" has invalid addedAt`,
      );
    }
    const sortedIds = [...record.addedCaseIds].sort((a, b) =>
      a.localeCompare(b, "en"),
    );
    sortedRecords.push({
      cycleId: record.cycleId,
      addedAt: record.addedAt,
      addedCaseIds: sortedIds,
    });
  }
  sortedRecords.sort((a, b) => {
    if (a.addedAt !== b.addedAt) return a.addedAt < b.addedAt ? -1 : 1;
    return a.cycleId.localeCompare(b.cycleId, "en");
  });
  return {
    schemaVersion: ACTIVE_LEARNING_SAMPLER_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    recordedAt: input.recordedAt,
    records: sortedRecords,
  };
};

export const writeActiveLearningGrowthLog = async (input: {
  readonly log: ActiveLearningGrowthLog;
  readonly runDir: string;
}): Promise<string> => {
  const outputPath = activeLearningGrowthLogPath(input.runDir);
  await atomicWrite(outputPath, canonicalJson(input.log));
  return outputPath;
};

// ---------------------------------------------------------------------------
// κ tracking on newly added cases (Acceptance: per Issue #2109)
// ---------------------------------------------------------------------------

export interface ActiveLearningKappaGateInput {
  readonly newPairedRatings: ReadonlyArray<CalibrationPairedRating>;
  readonly arbiters: ReadonlyArray<{
    readonly judge: JudgeCalibrationJudgeId;
    readonly arbiter: CalibrationReviewer;
  }>;
  readonly thresholds?: InterRaterGateThresholds;
}

export interface ActiveLearningKappaGateResult {
  readonly report: InterRaterAgreementReport;
  readonly passed: boolean;
}

/**
 * Re-applies the inter-rater agreement gate (Issue #2109) over the
 * paired ratings produced for the cases admitted via the active-
 * learning loop. Re-using the existing builder is deliberate: there is
 * one κ contract for the gold set, and it must apply identically to
 * cases added by hand and cases added by the loop.
 */
export const evaluateActiveLearningKappaGate = (
  input: ActiveLearningKappaGateInput,
): ActiveLearningKappaGateResult => {
  const thresholds = input.thresholds ?? INTER_RATER_GATE_THRESHOLDS;
  const report = buildInterRaterAgreementReport({
    ratings: input.newPairedRatings,
    arbiters: input.arbiters,
    thresholds,
  });
  return { report, passed: report.passed };
};
