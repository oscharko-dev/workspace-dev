/**
 * Judge-Calibration-Eval (Issue #1906).
 *
 * Measures how reliable the Logic-Judge (Issue #1898) and the
 * Faithfulness-Judge (Issue #1899) are against a small, hand-curated
 * human-labeled calibration set. Without this gate, a "strict" judge
 * could reject harmless cases or a "lenient" judge could let
 * hallucinated cases through with no objective signal.
 *
 * The module is pure: it takes pairs of `(predictedVerdict,
 * predictedFindingCodes)` and `(humanVerdict, humanFindingCodes)` and
 * computes accuracy, false-positive rate, false-negative rate, and
 * finding precision / recall. The fixture loader reads two sibling
 * JSON files per case under
 * `src/test-intelligence/fixtures/judge-calibration/`:
 *
 *   - `<id>.input.json` — the judge input (TestDesignModel /
 *     CoveragePlan / GeneratedTestCaseList for the logic judge,
 *     captures + GeneratedTestCases for the faithfulness judge).
 *     Carried verbatim so a live runner can replay the case against a
 *     real LLM gateway.
 *   - `<id>.gold.json` — the human-labeled verdict + finding codes
 *     plus the recorded `mockJudgeResponse` baseline used by the CI
 *     test. The mock response models a *realistic* judge output (some
 *     correct, some divergent) so the calibration math actually
 *     exercises FPR / FNR / precision / recall — a uniformly correct
 *     mock would make the gate vacuous.
 *
 * Hard gates per judge:
 *   - `accuracy >= 0.85`
 *   - `falsePositiveRate <= 0.10` (judge says accept while human says
 *     repair/reject — critical, lets hallucinations through)
 *   - `falseNegativeRate <= 0.20` (judge says reject while human says
 *     accept — tolerated, costs only repair iterations)
 *
 * Drift tracking: each run appends a row to
 * `storybook-static/eval-reports/judge-calibration-history.json` with
 * the judge id, run timestamp, and headline metrics so model-update
 * regressions become visible in the deployed Storybook bundle.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_FAITHFULNESS_VERDICTS,
  ALLOWED_LOGIC_JUDGE_VERDICTS,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

/** Schema version pinned on every persisted calibration eval artifact. */
export const JUDGE_CALIBRATION_EVAL_SCHEMA_VERSION = "1.0.0" as const;

/** Stable, byte-stable timestamp baked into deterministic eval artifacts. */
export const JUDGE_CALIBRATION_EVAL_FIXTURE_GENERATED_AT =
  "2026-05-05T00:00:00.000Z" as const;

/** Closed list of judge ids the calibration eval covers. */
export const JUDGE_CALIBRATION_JUDGE_IDS = ["logic", "faithfulness"] as const;

/** Discriminated alias for {@link JUDGE_CALIBRATION_JUDGE_IDS}. */
export type JudgeCalibrationJudgeId =
  (typeof JUDGE_CALIBRATION_JUDGE_IDS)[number];

/** Closed list of scenario kinds curated into the calibration set. */
export const JUDGE_CALIBRATION_SCENARIO_KINDS = [
  "happy",
  "adversarial",
  "edge",
] as const;

export type JudgeCalibrationScenarioKind =
  (typeof JUDGE_CALIBRATION_SCENARIO_KINDS)[number];

/**
 * Closed runtime alias unifying logic-judge and faithfulness-judge
 * terminal verdicts. Both contracts share the `accept | repair | reject`
 * tri-state by construction (`ALLOWED_LOGIC_JUDGE_VERDICTS` ===
 * `ALLOWED_FAITHFULNESS_VERDICTS`); guarded by a runtime assertion so a
 * future contract divergence is caught at import time.
 */
export const JUDGE_CALIBRATION_VERDICT_LABELS = [
  "accept",
  "repair",
  "reject",
] as const;

export type JudgeCalibrationVerdictLabel =
  (typeof JUDGE_CALIBRATION_VERDICT_LABELS)[number];

const assertVerdictAlphabetsAlign = (): void => {
  const expected = new Set<string>(JUDGE_CALIBRATION_VERDICT_LABELS);
  for (const label of ALLOWED_LOGIC_JUDGE_VERDICTS) {
    if (!expected.has(label)) {
      throw new Error(
        `judge-calibration: ALLOWED_LOGIC_JUDGE_VERDICTS drifted (saw ${label})`,
      );
    }
  }
  for (const label of ALLOWED_FAITHFULNESS_VERDICTS) {
    if (!expected.has(label)) {
      throw new Error(
        `judge-calibration: ALLOWED_FAITHFULNESS_VERDICTS drifted (saw ${label})`,
      );
    }
  }
};
assertVerdictAlphabetsAlign();

/** Hard-gate thresholds shipped with the suite. */
export const JUDGE_CALIBRATION_HARD_THRESHOLDS = Object.freeze({
  accuracy: 0.85,
  falsePositiveRate: 0.1,
  falseNegativeRate: 0.2,
}) as Readonly<{
  accuracy: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
}>;

export type JudgeCalibrationThresholds =
  typeof JUDGE_CALIBRATION_HARD_THRESHOLDS;

/** One human-labeled gold verdict colocated with a fixture. */
export interface JudgeCalibrationGold {
  readonly fixtureId: string;
  readonly judge: JudgeCalibrationJudgeId;
  readonly scenarioKind: JudgeCalibrationScenarioKind;
  readonly humanVerdict: JudgeCalibrationVerdictLabel;
  readonly humanFindingCodes: ReadonlyArray<string>;
  readonly rationale: string;
  /**
   * Recorded judge prediction baseline used by the CI test. The live
   * runner overrides this with a real LLM call; the recorded baseline
   * lets the suite stay deterministic and byte-stable in CI without
   * burning gateway calls.
   */
  readonly mockJudgeResponse: {
    readonly predictedVerdict: JudgeCalibrationVerdictLabel;
    readonly predictedFindingCodes: ReadonlyArray<string>;
  };
}

/** A judge-shaped input replayed verbatim into a live runner. */
export interface JudgeCalibrationInput {
  readonly judge: JudgeCalibrationJudgeId;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface LoadedJudgeCalibrationFixture {
  readonly id: string;
  readonly judge: JudgeCalibrationJudgeId;
  readonly input: JudgeCalibrationInput;
  readonly gold: JudgeCalibrationGold;
}

/** One predicted-vs-human pair fed to the calibration math. */
export interface JudgeCalibrationSample {
  readonly fixtureId: string;
  readonly judge: JudgeCalibrationJudgeId;
  readonly scenarioKind: JudgeCalibrationScenarioKind;
  readonly humanVerdict: JudgeCalibrationVerdictLabel;
  readonly humanFindingCodes: ReadonlyArray<string>;
  readonly predictedVerdict: JudgeCalibrationVerdictLabel;
  readonly predictedFindingCodes: ReadonlyArray<string>;
}

export interface JudgeCalibrationDivergence {
  readonly fixtureId: string;
  readonly humanVerdict: JudgeCalibrationVerdictLabel;
  readonly predictedVerdict: JudgeCalibrationVerdictLabel;
  readonly missingFindingCodes: ReadonlyArray<string>;
  readonly extraFindingCodes: ReadonlyArray<string>;
}

export interface JudgeCalibrationConfusionMatrix {
  readonly correct: number;
  readonly /** judge says accept, human said repair/reject */ falsePositive: number;
  readonly /** judge says reject, human said accept */ falseNegative: number;
  readonly /** judge says repair while human says accept (over-strict, recoverable) */ overRepair: number;
  readonly /** judge says repair while human says reject (under-strict on a clear reject) */ underReject: number;
  readonly /** judge says accept and human says accept */ trueAccept: number;
  readonly /** judge says reject and human says reject */ trueReject: number;
  readonly /** judge says repair and human says repair */ trueRepair: number;
}

export interface JudgeCalibrationMetrics {
  readonly sampleCount: number;
  readonly accuracy: number;
  readonly falsePositiveRate: number;
  readonly falseNegativeRate: number;
  readonly findingPrecision: number;
  readonly findingRecall: number;
  readonly perScenarioAccuracy: Readonly<
    Record<JudgeCalibrationScenarioKind, number>
  >;
  readonly perScenarioSampleCount: Readonly<
    Record<JudgeCalibrationScenarioKind, number>
  >;
  readonly confusionMatrix: JudgeCalibrationConfusionMatrix;
  readonly findingCounts: Readonly<{
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
    humanTotal: number;
    predictedTotal: number;
  }>;
  readonly divergences: ReadonlyArray<JudgeCalibrationDivergence>;
}

export type JudgeCalibrationGateFailureReason =
  | "accuracy_below_threshold"
  | "false_positive_rate_above_threshold"
  | "false_negative_rate_above_threshold";

export interface JudgeCalibrationGateFailure {
  readonly reason: JudgeCalibrationGateFailureReason;
  readonly threshold: number;
  readonly observed: number;
}

export interface JudgeCalibrationVerdict {
  readonly passed: boolean;
  readonly failures: ReadonlyArray<JudgeCalibrationGateFailure>;
}

const SCENARIO_KIND_INITIAL: Record<JudgeCalibrationScenarioKind, number> = {
  happy: 0,
  adversarial: 0,
  edge: 0,
};

const round6 = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 1 : round6(numerator / denominator);

const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : round6(numerator / denominator);

/**
 * Compute headline calibration metrics over a set of `(predicted,
 * human)` pairs. Pure function — identical inputs produce byte-identical
 * outputs. Counts are scoped to one judge by the caller via
 * {@link partitionSamplesByJudge}.
 */
export const computeJudgeCalibrationMetrics = (
  samples: ReadonlyArray<JudgeCalibrationSample>,
): JudgeCalibrationMetrics => {
  const sorted = [...samples].sort((a, b) =>
    a.fixtureId.localeCompare(b.fixtureId, "en"),
  );
  let correct = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let overRepair = 0;
  let underReject = 0;
  let trueAccept = 0;
  let trueReject = 0;
  let trueRepair = 0;

  let humanRejectOrRepair = 0;
  let humanAccept = 0;

  let findingTruePositive = 0;
  let findingFalsePositive = 0;
  let findingFalseNegative = 0;
  let findingHumanTotal = 0;
  let findingPredictedTotal = 0;

  const perScenarioCorrect: Record<JudgeCalibrationScenarioKind, number> = {
    ...SCENARIO_KIND_INITIAL,
  };
  const perScenarioSampleCount: Record<JudgeCalibrationScenarioKind, number> = {
    ...SCENARIO_KIND_INITIAL,
  };

  const divergences: JudgeCalibrationDivergence[] = [];

  for (const sample of sorted) {
    perScenarioSampleCount[sample.scenarioKind] += 1;
    const isCorrect = sample.predictedVerdict === sample.humanVerdict;
    if (isCorrect) {
      correct += 1;
      perScenarioCorrect[sample.scenarioKind] += 1;
      if (sample.humanVerdict === "accept") trueAccept += 1;
      else if (sample.humanVerdict === "reject") trueReject += 1;
      else trueRepair += 1;
    } else if (
      sample.predictedVerdict === "accept" &&
      sample.humanVerdict !== "accept"
    ) {
      falsePositive += 1;
    } else if (
      sample.predictedVerdict === "reject" &&
      sample.humanVerdict === "accept"
    ) {
      falseNegative += 1;
    } else if (
      sample.predictedVerdict === "repair" &&
      sample.humanVerdict === "accept"
    ) {
      overRepair += 1;
    } else if (
      sample.predictedVerdict === "repair" &&
      sample.humanVerdict === "reject"
    ) {
      underReject += 1;
    } else {
      // predicted=reject, human=repair — treated as over-strict
      // (recoverable: caller can re-run repair). Counted as "underReject"
      // for symmetry with the over-repair bucket above.
      underReject += 1;
    }

    if (sample.humanVerdict === "accept") humanAccept += 1;
    else humanRejectOrRepair += 1;

    const human = new Set(sample.humanFindingCodes);
    const predicted = new Set(sample.predictedFindingCodes);
    findingHumanTotal += human.size;
    findingPredictedTotal += predicted.size;
    let sampleTp = 0;
    let sampleFp = 0;
    let sampleFn = 0;
    for (const code of predicted) {
      if (human.has(code)) sampleTp += 1;
      else sampleFp += 1;
    }
    for (const code of human) {
      if (!predicted.has(code)) sampleFn += 1;
    }
    findingTruePositive += sampleTp;
    findingFalsePositive += sampleFp;
    findingFalseNegative += sampleFn;

    if (!isCorrect || sampleFp > 0 || sampleFn > 0) {
      const missing = [...human].filter((code) => !predicted.has(code)).sort();
      const extra = [...predicted].filter((code) => !human.has(code)).sort();
      divergences.push({
        fixtureId: sample.fixtureId,
        humanVerdict: sample.humanVerdict,
        predictedVerdict: sample.predictedVerdict,
        missingFindingCodes: missing,
        extraFindingCodes: extra,
      });
    }
  }

  const sampleCount = sorted.length;
  const accuracy = ratio(correct, sampleCount);
  const falsePositiveRate = rate(falsePositive, humanRejectOrRepair);
  const falseNegativeRate = rate(falseNegative, humanAccept);
  const findingPrecision = ratio(
    findingTruePositive,
    findingTruePositive + findingFalsePositive,
  );
  const findingRecall = ratio(
    findingTruePositive,
    findingTruePositive + findingFalseNegative,
  );

  const perScenarioAccuracy: Record<JudgeCalibrationScenarioKind, number> = {
    happy: ratio(perScenarioCorrect.happy, perScenarioSampleCount.happy),
    adversarial: ratio(
      perScenarioCorrect.adversarial,
      perScenarioSampleCount.adversarial,
    ),
    edge: ratio(perScenarioCorrect.edge, perScenarioSampleCount.edge),
  };

  return {
    sampleCount,
    accuracy,
    falsePositiveRate,
    falseNegativeRate,
    findingPrecision,
    findingRecall,
    perScenarioAccuracy,
    perScenarioSampleCount,
    confusionMatrix: {
      correct,
      falsePositive,
      falseNegative,
      overRepair,
      underReject,
      trueAccept,
      trueReject,
      trueRepair,
    },
    findingCounts: {
      truePositive: findingTruePositive,
      falsePositive: findingFalsePositive,
      falseNegative: findingFalseNegative,
      humanTotal: findingHumanTotal,
      predictedTotal: findingPredictedTotal,
    },
    divergences,
  };
};

/**
 * Apply hard-gate thresholds and return a structured verdict listing
 * every threshold violation. Defaults to the production thresholds.
 */
export const evaluateJudgeCalibrationVerdict = (
  metrics: JudgeCalibrationMetrics,
  thresholds: JudgeCalibrationThresholds = JUDGE_CALIBRATION_HARD_THRESHOLDS,
): JudgeCalibrationVerdict => {
  const failures: JudgeCalibrationGateFailure[] = [];
  if (metrics.accuracy < thresholds.accuracy) {
    failures.push({
      reason: "accuracy_below_threshold",
      threshold: thresholds.accuracy,
      observed: metrics.accuracy,
    });
  }
  if (metrics.falsePositiveRate > thresholds.falsePositiveRate) {
    failures.push({
      reason: "false_positive_rate_above_threshold",
      threshold: thresholds.falsePositiveRate,
      observed: metrics.falsePositiveRate,
    });
  }
  if (metrics.falseNegativeRate > thresholds.falseNegativeRate) {
    failures.push({
      reason: "false_negative_rate_above_threshold",
      threshold: thresholds.falseNegativeRate,
      observed: metrics.falseNegativeRate,
    });
  }
  return { passed: failures.length === 0, failures };
};

/** Partition samples by judge id (logic vs faithfulness). */
export const partitionSamplesByJudge = (
  samples: ReadonlyArray<JudgeCalibrationSample>,
): Readonly<Record<JudgeCalibrationJudgeId, ReadonlyArray<JudgeCalibrationSample>>> => {
  const buckets: Record<
    JudgeCalibrationJudgeId,
    JudgeCalibrationSample[]
  > = {
    logic: [],
    faithfulness: [],
  };
  for (const sample of samples) {
    buckets[sample.judge].push(sample);
  }
  return Object.freeze({
    logic: Object.freeze([...buckets.logic]),
    faithfulness: Object.freeze([...buckets.faithfulness]),
  });
};

/** Default fixtures directory relative to the repo root. */
export const JUDGE_CALIBRATION_FIXTURE_DIRNAME =
  "src/test-intelligence/fixtures/judge-calibration" as const;

const FIXTURES_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "fixtures", "judge-calibration");
})();

export const resolveJudgeCalibrationFixturePath = (
  fixtureId: string,
  kind: "input" | "gold",
): string => join(FIXTURES_ROOT, `${fixtureId}.${kind}.json`);

const isVerdictLabel = (value: unknown): value is JudgeCalibrationVerdictLabel =>
  typeof value === "string" &&
  (JUDGE_CALIBRATION_VERDICT_LABELS as ReadonlyArray<string>).includes(value);

const isJudgeId = (value: unknown): value is JudgeCalibrationJudgeId =>
  typeof value === "string" &&
  (JUDGE_CALIBRATION_JUDGE_IDS as ReadonlyArray<string>).includes(value);

const isScenarioKind = (
  value: unknown,
): value is JudgeCalibrationScenarioKind =>
  typeof value === "string" &&
  (JUDGE_CALIBRATION_SCENARIO_KINDS as ReadonlyArray<string>).includes(value);

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const parseGold = (raw: unknown, fixtureId: string): JudgeCalibrationGold => {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`gold ${fixtureId}: expected object, got ${typeof raw}`);
  }
  const value = raw as Record<string, unknown>;
  if (value["fixtureId"] !== fixtureId) {
    throw new Error(
      `gold ${fixtureId}: fixtureId mismatch (got ${String(value["fixtureId"])})`,
    );
  }
  if (!isJudgeId(value["judge"])) {
    throw new Error(`gold ${fixtureId}: invalid judge`);
  }
  if (!isScenarioKind(value["scenarioKind"])) {
    throw new Error(`gold ${fixtureId}: invalid scenarioKind`);
  }
  if (!isVerdictLabel(value["humanVerdict"])) {
    throw new Error(`gold ${fixtureId}: invalid humanVerdict`);
  }
  if (!isStringArray(value["humanFindingCodes"])) {
    throw new Error(`gold ${fixtureId}: invalid humanFindingCodes`);
  }
  if (typeof value["rationale"] !== "string") {
    throw new Error(`gold ${fixtureId}: invalid rationale`);
  }
  const mock = value["mockJudgeResponse"];
  if (typeof mock !== "object" || mock === null) {
    throw new Error(`gold ${fixtureId}: invalid mockJudgeResponse`);
  }
  const mockObj = mock as Record<string, unknown>;
  if (!isVerdictLabel(mockObj["predictedVerdict"])) {
    throw new Error(`gold ${fixtureId}: invalid mockJudgeResponse.predictedVerdict`);
  }
  if (!isStringArray(mockObj["predictedFindingCodes"])) {
    throw new Error(
      `gold ${fixtureId}: invalid mockJudgeResponse.predictedFindingCodes`,
    );
  }
  return {
    fixtureId,
    judge: value["judge"],
    scenarioKind: value["scenarioKind"],
    humanVerdict: value["humanVerdict"],
    humanFindingCodes: [...value["humanFindingCodes"]],
    rationale: value["rationale"],
    mockJudgeResponse: {
      predictedVerdict: mockObj["predictedVerdict"],
      predictedFindingCodes: [...mockObj["predictedFindingCodes"]],
    },
  };
};

const parseInput = (
  raw: unknown,
  fixtureId: string,
): JudgeCalibrationInput => {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`input ${fixtureId}: expected object, got ${typeof raw}`);
  }
  const value = raw as Record<string, unknown>;
  if (!isJudgeId(value["judge"])) {
    throw new Error(`input ${fixtureId}: invalid judge`);
  }
  const inner = value["input"];
  if (typeof inner !== "object" || inner === null) {
    throw new Error(`input ${fixtureId}: missing nested input object`);
  }
  return {
    judge: value["judge"],
    input: inner as Record<string, unknown>,
  };
};

/** Load a single fixture pair from the fixtures directory. */
export const loadJudgeCalibrationFixture = async (
  fixtureId: string,
): Promise<LoadedJudgeCalibrationFixture> => {
  const inputRaw = await readFile(
    resolveJudgeCalibrationFixturePath(fixtureId, "input"),
    "utf8",
  );
  const goldRaw = await readFile(
    resolveJudgeCalibrationFixturePath(fixtureId, "gold"),
    "utf8",
  );
  const input = parseInput(JSON.parse(inputRaw), fixtureId);
  const gold = parseGold(JSON.parse(goldRaw), fixtureId);
  if (input.judge !== gold.judge) {
    throw new Error(
      `judge-calibration ${fixtureId}: input.judge=${input.judge} != gold.judge=${gold.judge}`,
    );
  }
  return {
    id: fixtureId,
    judge: gold.judge,
    input,
    gold,
  };
};

/**
 * Closed list of curated calibration fixtures shipped with the suite.
 *
 * The list is the source-of-truth for the runner, the unit test, and
 * the docs cross-link. Adding a fixture means: drop both JSON files
 * into the fixtures directory and append the id (with its judge label)
 * here. Order is alphabetical by id within each judge bucket.
 */
export const JUDGE_CALIBRATION_FIXTURE_INDEX: ReadonlyArray<{
  readonly id: string;
  readonly judge: JudgeCalibrationJudgeId;
  readonly scenarioKind: JudgeCalibrationScenarioKind;
}> = Object.freeze([
  // Logic-judge calibration set (10 cases: 4 happy + 3 adversarial + 3 edge)
  {
    id: "logic-happy-loan-form-accept",
    judge: "logic",
    scenarioKind: "happy",
  },
  {
    id: "logic-happy-multi-screen-accept",
    judge: "logic",
    scenarioKind: "happy",
  },
  {
    id: "logic-happy-payment-accept",
    judge: "logic",
    scenarioKind: "happy",
  },
  {
    id: "logic-happy-onboarding-accept",
    judge: "logic",
    scenarioKind: "happy",
  },
  {
    id: "logic-adversarial-empty-coverage",
    judge: "logic",
    scenarioKind: "adversarial",
  },
  {
    id: "logic-adversarial-hallucinated-id",
    judge: "logic",
    scenarioKind: "adversarial",
  },
  {
    id: "logic-adversarial-weak-trace",
    judge: "logic",
    scenarioKind: "adversarial",
  },
  {
    id: "logic-edge-narrow-coverage-breadth",
    judge: "logic",
    scenarioKind: "edge",
  },
  {
    id: "logic-edge-missing-a11y-case",
    judge: "logic",
    scenarioKind: "edge",
  },
  {
    id: "logic-edge-single-step-tc",
    judge: "logic",
    scenarioKind: "edge",
  },
  // Faithfulness-judge calibration set (10 cases: 4 happy + 3 adversarial + 3 edge)
  {
    id: "faithfulness-happy-login-screen",
    judge: "faithfulness",
    scenarioKind: "happy",
  },
  {
    id: "faithfulness-happy-checkout-screen",
    judge: "faithfulness",
    scenarioKind: "happy",
  },
  {
    id: "faithfulness-happy-settings-screen",
    judge: "faithfulness",
    scenarioKind: "happy",
  },
  {
    id: "faithfulness-happy-search-screen",
    judge: "faithfulness",
    scenarioKind: "happy",
  },
  {
    id: "faithfulness-adversarial-phantom-button",
    judge: "faithfulness",
    scenarioKind: "adversarial",
  },
  {
    id: "faithfulness-adversarial-label-mismatch",
    judge: "faithfulness",
    scenarioKind: "adversarial",
  },
  {
    id: "faithfulness-adversarial-invented-screen",
    judge: "faithfulness",
    scenarioKind: "adversarial",
  },
  {
    id: "faithfulness-edge-low-contrast",
    judge: "faithfulness",
    scenarioKind: "edge",
  },
  {
    id: "faithfulness-edge-cropped-control",
    judge: "faithfulness",
    scenarioKind: "edge",
  },
  {
    id: "faithfulness-edge-numeric-format",
    judge: "faithfulness",
    scenarioKind: "edge",
  },
]);

/** Materialize a calibration sample from a loaded fixture (using the recorded mock). */
export const buildSampleFromFixture = (
  fixture: LoadedJudgeCalibrationFixture,
): JudgeCalibrationSample => ({
  fixtureId: fixture.id,
  judge: fixture.judge,
  scenarioKind: fixture.gold.scenarioKind,
  humanVerdict: fixture.gold.humanVerdict,
  humanFindingCodes: [...fixture.gold.humanFindingCodes].sort(),
  predictedVerdict: fixture.gold.mockJudgeResponse.predictedVerdict,
  predictedFindingCodes: [
    ...fixture.gold.mockJudgeResponse.predictedFindingCodes,
  ].sort(),
});

/** Load every fixture in {@link JUDGE_CALIBRATION_FIXTURE_INDEX}. */
export const loadAllJudgeCalibrationFixtures =
  async (): Promise<ReadonlyArray<LoadedJudgeCalibrationFixture>> => {
    const out: LoadedJudgeCalibrationFixture[] = [];
    for (const entry of JUDGE_CALIBRATION_FIXTURE_INDEX) {
      const fixture = await loadJudgeCalibrationFixture(entry.id);
      if (fixture.judge !== entry.judge) {
        throw new Error(
          `judge-calibration index ${entry.id}: judge mismatch (index=${entry.judge}, fixture=${fixture.judge})`,
        );
      }
      if (fixture.gold.scenarioKind !== entry.scenarioKind) {
        throw new Error(
          `judge-calibration index ${entry.id}: scenarioKind mismatch (index=${entry.scenarioKind}, fixture=${fixture.gold.scenarioKind})`,
        );
      }
      out.push(fixture);
    }
    return out;
  };

export interface JudgeCalibrationEvalArtifact {
  readonly schemaVersion: typeof JUDGE_CALIBRATION_EVAL_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly generatedAt: string;
  readonly judge: JudgeCalibrationJudgeId;
  readonly thresholds: JudgeCalibrationThresholds;
  readonly metrics: JudgeCalibrationMetrics;
  readonly verdict: JudgeCalibrationVerdict;
  readonly samples: ReadonlyArray<JudgeCalibrationSample>;
  readonly methodology: {
    readonly deterministic: true;
    readonly source: "human-labeled-calibration-set";
  };
}

export interface BuildJudgeCalibrationEvalArtifactInput {
  readonly judge: JudgeCalibrationJudgeId;
  readonly samples: ReadonlyArray<JudgeCalibrationSample>;
  readonly generatedAt?: string;
  readonly thresholds?: JudgeCalibrationThresholds;
}

export const buildJudgeCalibrationEvalArtifact = (
  input: BuildJudgeCalibrationEvalArtifactInput,
): JudgeCalibrationEvalArtifact => {
  const thresholds = input.thresholds ?? JUDGE_CALIBRATION_HARD_THRESHOLDS;
  const generatedAt =
    input.generatedAt ?? JUDGE_CALIBRATION_EVAL_FIXTURE_GENERATED_AT;
  for (const sample of input.samples) {
    if (sample.judge !== input.judge) {
      throw new Error(
        `buildJudgeCalibrationEvalArtifact: sample ${sample.fixtureId} judge mismatch (sample=${sample.judge}, requested=${input.judge})`,
      );
    }
  }
  const samples = [...input.samples].sort((a, b) =>
    a.fixtureId.localeCompare(b.fixtureId, "en"),
  );
  const metrics = computeJudgeCalibrationMetrics(samples);
  const verdict = evaluateJudgeCalibrationVerdict(metrics, thresholds);
  return {
    schemaVersion: JUDGE_CALIBRATION_EVAL_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt,
    judge: input.judge,
    thresholds,
    metrics,
    verdict,
    samples,
    methodology: {
      deterministic: true,
      source: "human-labeled-calibration-set",
    },
  };
};

/** Default destination directory for calibration eval reports. */
export const JUDGE_CALIBRATION_EVAL_REPORT_DIRNAME =
  "storybook-static/eval-reports" as const;

export const judgeCalibrationEvalReportFilename = (
  judge: JudgeCalibrationJudgeId,
): string => `judge-calibration-${judge}.json`;

export const JUDGE_CALIBRATION_HISTORY_FILENAME =
  "judge-calibration-history.json" as const;

export interface WriteJudgeCalibrationEvalArtifactInput {
  readonly artifact: JudgeCalibrationEvalArtifact;
  readonly outputDir?: string;
}

const writeAtomic = async (
  outputPath: string,
  content: string,
): Promise<void> => {
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, outputPath);
};

export const writeJudgeCalibrationEvalArtifact = async (
  input: WriteJudgeCalibrationEvalArtifactInput,
): Promise<string> => {
  const dir = input.outputDir ?? JUDGE_CALIBRATION_EVAL_REPORT_DIRNAME;
  const outputPath = join(
    dir,
    judgeCalibrationEvalReportFilename(input.artifact.judge),
  );
  await writeAtomic(outputPath, canonicalJson(input.artifact));
  return outputPath;
};

export const readJudgeCalibrationEvalArtifact = async (
  filePath: string,
): Promise<JudgeCalibrationEvalArtifact> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as JudgeCalibrationEvalArtifact;
};

/** One persisted row in the drift history. */
export interface JudgeCalibrationHistoryEntry {
  readonly recordedAt: string;
  readonly judge: JudgeCalibrationJudgeId;
  readonly accuracy: number;
  readonly falsePositiveRate: number;
  readonly falseNegativeRate: number;
  readonly findingPrecision: number;
  readonly findingRecall: number;
  readonly sampleCount: number;
  readonly passed: boolean;
}

export interface JudgeCalibrationHistoryFile {
  readonly schemaVersion: typeof JUDGE_CALIBRATION_EVAL_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly entries: ReadonlyArray<JudgeCalibrationHistoryEntry>;
}

/** Maximum number of history rows kept on disk. */
export const JUDGE_CALIBRATION_HISTORY_MAX_ENTRIES = 200 as const;

const isHistoryEntry = (value: unknown): value is JudgeCalibrationHistoryEntry => {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry["recordedAt"] === "string" &&
    isJudgeId(entry["judge"]) &&
    typeof entry["accuracy"] === "number" &&
    typeof entry["falsePositiveRate"] === "number" &&
    typeof entry["falseNegativeRate"] === "number" &&
    typeof entry["findingPrecision"] === "number" &&
    typeof entry["findingRecall"] === "number" &&
    typeof entry["sampleCount"] === "number" &&
    typeof entry["passed"] === "boolean"
  );
};

const readHistoryFile = async (
  filePath: string,
): Promise<JudgeCalibrationHistoryFile> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return {
        schemaVersion: JUDGE_CALIBRATION_EVAL_SCHEMA_VERSION,
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        entries: [],
      };
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`judge-calibration history: invalid root at ${filePath}`);
  }
  const root = parsed as Record<string, unknown>;
  const entriesRaw = root["entries"];
  const entries: JudgeCalibrationHistoryEntry[] = [];
  if (Array.isArray(entriesRaw)) {
    for (const candidate of entriesRaw) {
      if (isHistoryEntry(candidate)) entries.push(candidate);
    }
  }
  return {
    schemaVersion: JUDGE_CALIBRATION_EVAL_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    entries,
  };
};

export interface AppendJudgeCalibrationHistoryInput {
  readonly artifact: JudgeCalibrationEvalArtifact;
  readonly recordedAt: string;
  readonly outputDir?: string;
  readonly maxEntries?: number;
}

/**
 * Append a new history entry for the given judge artifact, keep at most
 * `maxEntries` rows, and re-write atomically. Returns the absolute path
 * to the persisted history file.
 */
export const appendJudgeCalibrationHistoryEntry = async (
  input: AppendJudgeCalibrationHistoryInput,
): Promise<string> => {
  const dir = input.outputDir ?? JUDGE_CALIBRATION_EVAL_REPORT_DIRNAME;
  const outputPath = join(dir, JUDGE_CALIBRATION_HISTORY_FILENAME);
  const max = input.maxEntries ?? JUDGE_CALIBRATION_HISTORY_MAX_ENTRIES;
  const existing = await readHistoryFile(outputPath);
  const nextEntry: JudgeCalibrationHistoryEntry = {
    recordedAt: input.recordedAt,
    judge: input.artifact.judge,
    accuracy: input.artifact.metrics.accuracy,
    falsePositiveRate: input.artifact.metrics.falsePositiveRate,
    falseNegativeRate: input.artifact.metrics.falseNegativeRate,
    findingPrecision: input.artifact.metrics.findingPrecision,
    findingRecall: input.artifact.metrics.findingRecall,
    sampleCount: input.artifact.metrics.sampleCount,
    passed: input.artifact.verdict.passed,
  };
  const merged = [...existing.entries, nextEntry];
  const trimmed = merged.slice(Math.max(0, merged.length - max));
  const file: JudgeCalibrationHistoryFile = {
    schemaVersion: JUDGE_CALIBRATION_EVAL_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    entries: trimmed,
  };
  await writeAtomic(outputPath, canonicalJson(file));
  return outputPath;
};

