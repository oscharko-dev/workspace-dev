/**
 * Regression-Eval — baseline-drift detection on the seven archetype
 * fixtures (Issue #1907).
 *
 * Wave-2 / Wave-3 changes to the deterministic generator are expected
 * to shift case counts, coverage ratios, and eval outcomes. The
 * regression-eval pins a hand-approved snapshot per fixture and fails
 * CI when a candidate run drifts beyond the documented tolerances:
 *
 *   - coverage ratios (field/action/validation/navigation): ±0.05
 *   - case counts (per riskCategory and per 29119 technique): ±2
 *   - eval outcomes (faithfulness / hallucination / a11y): identical
 *     `passed` flag and identical sorted failure-reason set
 *
 * Approve workflow mirrors `FIGMAPIPE_GOLDEN_APPROVE` for golden
 * fixtures: setting `FIGMAPIPE_REGRESSION_APPROVE=true` rewrites every
 * snapshot from the current pipeline output. CI rejects the env var so
 * approved snapshots can only be produced locally and committed.
 *
 * Determinism / I/O surface:
 *   - `buildRegressionSnapshot`, `diffRegressionSnapshot`,
 *     `renderDriftReport` and the threshold/tolerance constants are
 *     pure functions over their inputs.
 *   - `loadRegressionSnapshot` / `writeRegressionSnapshot` are the only
 *     filesystem touches and are atomic (temp file + rename).
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCaseAuditMetadata,
  type GeneratedTestCaseList,
  type TestCaseRiskCategory,
  type TestCaseTechnique29119,
} from "../contracts/index.js";
import {
  BASELINE_ARCHETYPE_FIXTURE_IDS,
  type BaselineArchetypeFixtureId,
  loadBaselineArchetypeFixture,
} from "./baseline-fixtures.js";
import { canonicalJson } from "./content-hash.js";
import {
  computeFaithfulnessMetrics,
  evaluateFaithfulnessVerdict,
  type FaithfulnessGateFailureReason,
} from "./faithfulness-eval.js";
import {
  computeHallucinationMetrics,
  evaluateHallucinationVerdict,
  type HallucinationGateFailureReason,
} from "./hallucination-eval.js";
import {
  computeA11yCoverage,
  type A11yCoverageGateFailureReason,
} from "./a11y-coverage-eval.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import { synthesizeGeneratedTestCases } from "./validation-harness.js";

/** Schema version pinned on every persisted regression snapshot. */
export const REGRESSION_EVAL_SCHEMA_VERSION = "1.0.0" as const;

/** Stable, byte-stable timestamp baked into deterministic snapshots. */
export const REGRESSION_EVAL_FIXTURE_GENERATED_AT =
  "2026-05-05T00:00:00.000Z" as const;

/** Closed list of risk categories enumerated in every snapshot. */
export const REGRESSION_EVAL_RISK_CATEGORIES: ReadonlyArray<TestCaseRiskCategory> =
  Object.freeze([
    "low",
    "medium",
    "high",
    "regulated_data",
    "financial_transaction",
  ]);

/** Closed list of 29119-4 techniques enumerated in every snapshot. */
export const REGRESSION_EVAL_TECHNIQUES: ReadonlyArray<TestCaseTechnique29119> =
  Object.freeze([
    "equivalence_partitioning",
    "boundary_value_analysis",
    "decision_table",
    "state_transition",
    "use_case",
    "exploratory",
    "error_guessing",
    "syntax_testing",
    "classification_tree",
  ]);

/** Tolerance bands documented in Issue #1907. */
export const REGRESSION_EVAL_TOLERANCES = Object.freeze({
  coverageRatioAbsoluteDelta: 0.05,
  caseCountAbsoluteDelta: 2,
}) as Readonly<{
  coverageRatioAbsoluteDelta: number;
  caseCountAbsoluteDelta: number;
}>;

export type RegressionEvalTolerances = typeof REGRESSION_EVAL_TOLERANCES;

export interface RegressionCoverageRatios {
  readonly fieldCoverageRatio: number;
  readonly actionCoverageRatio: number;
  readonly validationCoverageRatio: number;
  readonly navigationCoverageRatio: number;
}

export type RegressionCaseCountsByRiskCategory = Readonly<
  Record<TestCaseRiskCategory, number>
>;

export type RegressionCaseCountsByTechnique = Readonly<
  Record<TestCaseTechnique29119, number>
>;

export interface RegressionCaseCounts {
  readonly total: number;
  readonly byRiskCategory: RegressionCaseCountsByRiskCategory;
  readonly byTechnique: RegressionCaseCountsByTechnique;
}

export interface RegressionEvalOutcome {
  readonly passed: boolean;
  /** Sorted, stable list of failure-reason codes; empty on pass. */
  readonly failureReasons: ReadonlyArray<string>;
}

export interface RegressionEvalOutcomes {
  readonly faithfulness: RegressionEvalOutcome;
  readonly hallucination: RegressionEvalOutcome;
  readonly a11yCoverage: RegressionEvalOutcome;
}

export interface RegressionSnapshot {
  readonly schemaVersion: typeof REGRESSION_EVAL_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly generatedAt: string;
  readonly archetypeId: BaselineArchetypeFixtureId;
  readonly archetype: string;
  readonly intent: string;
  readonly coverageRatios: RegressionCoverageRatios;
  readonly caseCounts: RegressionCaseCounts;
  readonly evalOutcomes: RegressionEvalOutcomes;
  readonly methodology: {
    readonly deterministic: true;
    readonly mode: "with-repair";
  };
}

const REGRESSION_BASELINES_DIRNAME = "regression-baselines" as const;

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");

const REGRESSION_BASELINES_DIR = join(
  FIXTURES_DIR,
  REGRESSION_BASELINES_DIRNAME,
);

/** Default destination for the menschen-lesbar drift report. */
export const REGRESSION_DRIFT_REPORT_DIRNAME =
  "storybook-static/eval-reports" as const;

export const regressionSnapshotFilename = (
  archetypeId: BaselineArchetypeFixtureId,
): string => `${archetypeId}.snapshot.json`;

export const regressionSnapshotPath = (
  archetypeId: BaselineArchetypeFixtureId,
): string =>
  join(REGRESSION_BASELINES_DIR, regressionSnapshotFilename(archetypeId));

export const regressionDriftReportFilename = (timestamp: string): string =>
  `regression-drift-${timestamp.replace(/[:.]/g, "-")}.md`;

export interface BuildRegressionSnapshotInput {
  readonly archetypeId: BaselineArchetypeFixtureId;
  readonly generatedAt?: string;
  /**
   * Optional override for the candidate test-case list. When omitted the
   * deterministic synthesiser is invoked. Tests use this to inject a
   * mutated list and verify the drift detector fires.
   */
  readonly listOverride?: GeneratedTestCaseList;
}

export const buildRegressionSnapshot = async (
  input: BuildRegressionSnapshotInput,
): Promise<RegressionSnapshot> => {
  const generatedAt =
    input.generatedAt ?? REGRESSION_EVAL_FIXTURE_GENERATED_AT;
  const fixture = await loadBaselineArchetypeFixture(input.archetypeId);
  const intent = deriveBusinessTestIntentIr({ figma: fixture.figma });
  const jobId = `regression-eval-${stripBaselinePrefix(input.archetypeId)}`;
  const list =
    input.listOverride ??
    synthesizeGeneratedTestCases({
      jobId,
      generatedAt,
      intent,
      audit: buildAuditMetadata({ jobId, generatedAt }),
    });
  const knownFigmaNodeIds = collectKnownFigmaNodeIds(fixture.figma.screens);
  const knownScreenIds = collectKnownScreenIds(fixture.figma.screens);

  const faithfulnessMetrics = computeFaithfulnessMetrics({
    intent,
    generatedList: list,
    knownFigmaNodeIds,
    knownScreenIds,
  });
  const faithfulnessVerdict = evaluateFaithfulnessVerdict(faithfulnessMetrics);

  const hallucinationOut = computeHallucinationMetrics({
    intent,
    generatedList: list,
    knownFigmaNodeIds,
    knownScreenIds,
  });
  const hallucinationVerdict = evaluateHallucinationVerdict(
    hallucinationOut.metrics,
  );

  const a11y = computeA11yCoverage({
    intent,
    generatedList: list,
  });

  return {
    schemaVersion: REGRESSION_EVAL_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt,
    archetypeId: input.archetypeId,
    archetype: fixture.summary.archetype,
    intent: fixture.summary.intent,
    coverageRatios: {
      fieldCoverageRatio: faithfulnessMetrics.fieldCoverageRatio,
      actionCoverageRatio: faithfulnessMetrics.actionCoverageRatio,
      validationCoverageRatio: faithfulnessMetrics.validationCoverageRatio,
      navigationCoverageRatio: faithfulnessMetrics.navigationCoverageRatio,
    },
    caseCounts: tallyCaseCounts(list),
    evalOutcomes: {
      faithfulness: toEvalOutcome(
        faithfulnessVerdict.passed,
        faithfulnessVerdict.failures.map(
          (f: { reason: FaithfulnessGateFailureReason }) => f.reason,
        ),
      ),
      hallucination: toEvalOutcome(
        hallucinationVerdict.passed,
        hallucinationVerdict.failures.map(
          (f: { reason: HallucinationGateFailureReason }) => f.reason,
        ),
      ),
      a11yCoverage: toEvalOutcome(
        a11y.verdict.passed,
        a11y.verdict.failures
          // Hard gate only: warning-severity failures are surfaced in
          // the underlying eval but do not flip the outcome bit, so
          // they must not flip the regression outcome either.
          .filter((f: { severity: "error" | "warning" }) => f.severity === "error")
          .map((f: { reason: A11yCoverageGateFailureReason }) => f.reason),
      ),
    },
    methodology: {
      deterministic: true,
      mode: "with-repair",
    },
  };
};

export const buildAllRegressionSnapshots = async (input?: {
  generatedAt?: string;
}): Promise<ReadonlyArray<RegressionSnapshot>> =>
  Promise.all(
    BASELINE_ARCHETYPE_FIXTURE_IDS.map((archetypeId) =>
      buildRegressionSnapshot({
        archetypeId,
        ...(input?.generatedAt !== undefined
          ? { generatedAt: input.generatedAt }
          : {}),
      }),
    ),
  );

export interface WriteRegressionSnapshotInput {
  readonly snapshot: RegressionSnapshot;
  readonly outputPath?: string;
}

export const writeRegressionSnapshot = async (
  input: WriteRegressionSnapshotInput,
): Promise<string> => {
  const outputPath =
    input.outputPath ?? regressionSnapshotPath(input.snapshot.archetypeId);
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${canonicalJson(input.snapshot)}\n`, "utf8");
  await rename(tempPath, outputPath);
  return outputPath;
};

export const loadRegressionSnapshot = async (
  archetypeId: BaselineArchetypeFixtureId,
): Promise<RegressionSnapshot> => {
  const raw = await readFile(regressionSnapshotPath(archetypeId), "utf8");
  return JSON.parse(raw) as RegressionSnapshot;
};

export type RegressionDriftDimension =
  | "schemaVersion"
  | "contractVersion"
  | "archetype"
  | "intent"
  | "coverageRatio"
  | "caseCount"
  | "evalOutcome";

export interface RegressionDriftFinding {
  readonly archetypeId: BaselineArchetypeFixtureId;
  readonly dimension: RegressionDriftDimension;
  /** Dot-path within the snapshot (e.g. `coverageRatios.fieldCoverageRatio`). */
  readonly path: string;
  readonly baseline: string;
  readonly candidate: string;
  /**
   * Absolute delta in the value's natural unit when defined (numeric
   * dimensions only). String/identity dimensions leave this undefined.
   */
  readonly absoluteDelta?: number;
  /**
   * Percentage delta relative to baseline. `null` when baseline is 0,
   * undefined for non-numeric dimensions.
   */
  readonly percentDelta?: number | null;
  readonly tolerance?: number;
}

export interface RegressionDriftDiff {
  readonly archetypeId: BaselineArchetypeFixtureId;
  readonly hasDrift: boolean;
  readonly findings: ReadonlyArray<RegressionDriftFinding>;
}

export interface DiffRegressionSnapshotInput {
  readonly baseline: RegressionSnapshot;
  readonly candidate: RegressionSnapshot;
  readonly tolerances?: RegressionEvalTolerances;
}

export const diffRegressionSnapshot = (
  input: DiffRegressionSnapshotInput,
): RegressionDriftDiff => {
  if (input.baseline.archetypeId !== input.candidate.archetypeId) {
    throw new Error(
      `diffRegressionSnapshot: archetypeId mismatch (baseline=${input.baseline.archetypeId} candidate=${input.candidate.archetypeId})`,
    );
  }
  const tolerances = input.tolerances ?? REGRESSION_EVAL_TOLERANCES;
  const findings: RegressionDriftFinding[] = [];

  const archetypeId = input.baseline.archetypeId;
  const recordIdentity = (
    dimension: RegressionDriftDimension,
    path: string,
    baseline: string,
    candidate: string,
  ): void => {
    if (baseline === candidate) return;
    findings.push({
      archetypeId,
      dimension,
      path,
      baseline,
      candidate,
    });
  };

  recordIdentity(
    "schemaVersion",
    "schemaVersion",
    input.baseline.schemaVersion,
    input.candidate.schemaVersion,
  );
  recordIdentity(
    "contractVersion",
    "contractVersion",
    input.baseline.contractVersion,
    input.candidate.contractVersion,
  );
  recordIdentity(
    "archetype",
    "archetype",
    input.baseline.archetype,
    input.candidate.archetype,
  );
  recordIdentity(
    "intent",
    "intent",
    input.baseline.intent,
    input.candidate.intent,
  );

  for (const key of Object.keys(input.baseline.coverageRatios) as Array<
    keyof RegressionCoverageRatios
  >) {
    const baselineValue = input.baseline.coverageRatios[key];
    const candidateValue = input.candidate.coverageRatios[key];
    pushIfOutOfTolerance({
      archetypeId,
      dimension: "coverageRatio",
      path: `coverageRatios.${key}`,
      baseline: baselineValue,
      candidate: candidateValue,
      tolerance: tolerances.coverageRatioAbsoluteDelta,
      findings,
    });
  }

  pushIfOutOfTolerance({
    archetypeId,
    dimension: "caseCount",
    path: "caseCounts.total",
    baseline: input.baseline.caseCounts.total,
    candidate: input.candidate.caseCounts.total,
    tolerance: tolerances.caseCountAbsoluteDelta,
    findings,
  });

  for (const category of REGRESSION_EVAL_RISK_CATEGORIES) {
    pushIfOutOfTolerance({
      archetypeId,
      dimension: "caseCount",
      path: `caseCounts.byRiskCategory.${category}`,
      baseline: input.baseline.caseCounts.byRiskCategory[category],
      candidate: input.candidate.caseCounts.byRiskCategory[category],
      tolerance: tolerances.caseCountAbsoluteDelta,
      findings,
    });
  }
  for (const technique of REGRESSION_EVAL_TECHNIQUES) {
    pushIfOutOfTolerance({
      archetypeId,
      dimension: "caseCount",
      path: `caseCounts.byTechnique.${technique}`,
      baseline: input.baseline.caseCounts.byTechnique[technique],
      candidate: input.candidate.caseCounts.byTechnique[technique],
      tolerance: tolerances.caseCountAbsoluteDelta,
      findings,
    });
  }

  for (const evalKey of [
    "faithfulness",
    "hallucination",
    "a11yCoverage",
  ] as const) {
    const baselineOutcome = input.baseline.evalOutcomes[evalKey];
    const candidateOutcome = input.candidate.evalOutcomes[evalKey];
    if (baselineOutcome.passed !== candidateOutcome.passed) {
      findings.push({
        archetypeId,
        dimension: "evalOutcome",
        path: `evalOutcomes.${evalKey}.passed`,
        baseline: String(baselineOutcome.passed),
        candidate: String(candidateOutcome.passed),
      });
    }
    const baselineReasons = [...baselineOutcome.failureReasons].sort();
    const candidateReasons = [...candidateOutcome.failureReasons].sort();
    if (
      baselineReasons.length !== candidateReasons.length ||
      baselineReasons.some((reason, index) => reason !== candidateReasons[index])
    ) {
      findings.push({
        archetypeId,
        dimension: "evalOutcome",
        path: `evalOutcomes.${evalKey}.failureReasons`,
        baseline: baselineReasons.join(",") || "(none)",
        candidate: candidateReasons.join(",") || "(none)",
      });
    }
  }

  return {
    archetypeId,
    hasDrift: findings.length > 0,
    findings,
  };
};

export interface RenderDriftReportInput {
  readonly diffs: ReadonlyArray<RegressionDriftDiff>;
  readonly generatedAt: string;
  readonly tolerances?: RegressionEvalTolerances;
}

export const renderDriftReport = (input: RenderDriftReportInput): string => {
  const tolerances = input.tolerances ?? REGRESSION_EVAL_TOLERANCES;
  const totalFindings = input.diffs.reduce(
    (sum, diff) => sum + diff.findings.length,
    0,
  );
  const driftedArchetypes = input.diffs.filter((diff) => diff.hasDrift);

  const lines: string[] = [];
  lines.push(`# Regression-Eval drift report`);
  lines.push("");
  lines.push(`- Generated at: \`${input.generatedAt}\``);
  lines.push(`- Snapshots compared: ${input.diffs.length}`);
  lines.push(`- Drifted archetypes: ${driftedArchetypes.length}`);
  lines.push(`- Total findings: ${totalFindings}`);
  lines.push("");
  lines.push("## Tolerances");
  lines.push("");
  lines.push(
    `- Coverage ratios: \`±${tolerances.coverageRatioAbsoluteDelta}\``,
  );
  lines.push(
    `- Case counts: \`±${tolerances.caseCountAbsoluteDelta}\` per category`,
  );
  lines.push(`- Eval outcomes: identical \`passed\` flag and failure-reason set`);
  lines.push("");

  if (driftedArchetypes.length === 0) {
    lines.push("## No drift detected");
    lines.push("");
    lines.push(
      "Every archetype matches its approved snapshot within the documented tolerances.",
    );
    return `${lines.join("\n")}\n`;
  }

  for (const diff of driftedArchetypes) {
    lines.push(`## ${diff.archetypeId}`);
    lines.push("");
    lines.push(
      "| Path | Before | After | Δ (abs) | Δ (%) | Tolerance |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const finding of diff.findings) {
      const absoluteDelta =
        finding.absoluteDelta !== undefined
          ? formatNumber(finding.absoluteDelta)
          : "—";
      const percentDelta =
        finding.percentDelta === undefined
          ? "—"
          : finding.percentDelta === null
            ? "n/a (baseline=0)"
            : `${formatNumber(finding.percentDelta)}%`;
      const toleranceCell =
        finding.tolerance !== undefined
          ? `±${formatNumber(finding.tolerance)}`
          : "exact match";
      lines.push(
        `| \`${finding.path}\` | \`${finding.baseline}\` | \`${finding.candidate}\` | ${absoluteDelta} | ${percentDelta} | ${toleranceCell} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Approve workflow");
  lines.push("");
  lines.push(
    "If the drift is intentional, re-pin the snapshots locally and commit the diff:",
  );
  lines.push("");
  lines.push("```sh");
  lines.push("FIGMAPIPE_REGRESSION_APPROVE=true pnpm run test:ti-regression");
  lines.push("```");
  lines.push("");
  lines.push(
    "CI rejects `FIGMAPIPE_REGRESSION_APPROVE` so approved snapshots only enter the repo via PR review.",
  );
  return `${lines.join("\n")}\n`;
};

export interface WriteDriftReportInput {
  readonly diffs: ReadonlyArray<RegressionDriftDiff>;
  readonly generatedAt: string;
  readonly outputDir?: string;
  readonly tolerances?: RegressionEvalTolerances;
}

export const writeDriftReport = async (
  input: WriteDriftReportInput,
): Promise<string> => {
  const dir = input.outputDir ?? REGRESSION_DRIFT_REPORT_DIRNAME;
  const outputPath = join(
    dir,
    regressionDriftReportFilename(input.generatedAt),
  );
  await mkdir(dirname(outputPath), { recursive: true });
  const body = renderDriftReport({
    diffs: input.diffs,
    generatedAt: input.generatedAt,
    ...(input.tolerances !== undefined ? { tolerances: input.tolerances } : {}),
  });
  const tempPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, body, "utf8");
  await rename(tempPath, outputPath);
  return outputPath;
};

export const isRegressionApproveModeEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  const raw = env.FIGMAPIPE_REGRESSION_APPROVE?.trim().toLowerCase();
  return raw === "1" || raw === "true";
};

export const isRegressionCiRuntime = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  const raw = env.CI?.trim().toLowerCase();
  if (!raw) return false;
  return raw !== "0" && raw !== "false";
};

const tallyCaseCounts = (list: GeneratedTestCaseList): RegressionCaseCounts => {
  const byRiskCategory = createZeroCountRecord<TestCaseRiskCategory>(
    REGRESSION_EVAL_RISK_CATEGORIES,
  );
  const byTechnique = createZeroCountRecord<TestCaseTechnique29119>(
    REGRESSION_EVAL_TECHNIQUES,
  );
  for (const testCase of list.testCases) {
    byRiskCategory[testCase.riskCategory] += 1;
    byTechnique[testCase.technique] += 1;
  }
  return {
    total: list.testCases.length,
    byRiskCategory: byRiskCategory as RegressionCaseCountsByRiskCategory,
    byTechnique: byTechnique as RegressionCaseCountsByTechnique,
  };
};

const createZeroCountRecord = <K extends string>(
  keys: ReadonlyArray<K>,
): Record<K, number> => {
  const record = {} as Record<K, number>;
  for (const key of keys) record[key] = 0;
  return record;
};

const toEvalOutcome = (
  passed: boolean,
  failureReasons: ReadonlyArray<string>,
): RegressionEvalOutcome => ({
  passed,
  failureReasons: [...failureReasons].sort(),
});

interface PushIfOutOfToleranceInput {
  readonly archetypeId: BaselineArchetypeFixtureId;
  readonly dimension: RegressionDriftDimension;
  readonly path: string;
  readonly baseline: number;
  readonly candidate: number;
  readonly tolerance: number;
  readonly findings: RegressionDriftFinding[];
}

const pushIfOutOfTolerance = (input: PushIfOutOfToleranceInput): void => {
  const absoluteDelta = roundTo(input.candidate - input.baseline);
  if (Math.abs(absoluteDelta) <= input.tolerance) return;
  const percentDelta =
    input.baseline === 0
      ? null
      : roundTo(((input.candidate - input.baseline) / input.baseline) * 100);
  input.findings.push({
    archetypeId: input.archetypeId,
    dimension: input.dimension,
    path: input.path,
    baseline: String(input.baseline),
    candidate: String(input.candidate),
    absoluteDelta,
    percentDelta,
    tolerance: input.tolerance,
  });
};

const collectKnownFigmaNodeIds = (
  screens: ReadonlyArray<{ readonly nodes: ReadonlyArray<{ readonly nodeId: string }> }>,
): ReadonlyArray<string> => {
  const ids = new Set<string>();
  for (const screen of screens) {
    for (const node of screen.nodes) ids.add(node.nodeId);
  }
  return [...ids].sort();
};

const collectKnownScreenIds = (
  screens: ReadonlyArray<{ readonly screenId: string }>,
): ReadonlyArray<string> => {
  return screens
    .map((screen) => screen.screenId)
    .slice()
    .sort();
};

const buildAuditMetadata = (input: {
  jobId: string;
  generatedAt: string;
}): GeneratedTestCaseAuditMetadata => ({
  jobId: input.jobId,
  generatedAt: input.generatedAt,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  redactionPolicyVersion: REDACTION_POLICY_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  cacheHit: false,
  cacheKey: "regression-eval-cache-key",
  inputHash: "regression-eval-input-hash",
  promptHash: "regression-eval-prompt-hash",
  schemaHash: "regression-eval-schema-hash",
});

const stripBaselinePrefix = (archetypeId: BaselineArchetypeFixtureId): string =>
  archetypeId.replace(/^baseline-/u, "");

const roundTo = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const formatNumber = (value: number): string => {
  if (Number.isInteger(value)) return value.toString();
  return value
    .toFixed(6)
    .replace(/\.0+$/u, "")
    .replace(/(\.\d*?)0+$/u, "$1");
};
