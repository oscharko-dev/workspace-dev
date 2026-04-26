/**
 * Wave 1 POC evaluation gate (Issue #1366).
 *
 * Computes per-fixture metrics over the artifact bundle produced by
 * `runWave1Poc` and decides pass/fail against a threshold profile.
 *
 * Default thresholds are intentionally conservative for the Wave 1 POC:
 *
 *   - Trace coverage (fields, actions, validations) ≥ 1.0
 *   - QC mapping exportable fraction ≥ 1.0
 *   - Pairwise duplicate similarity strictly below 0.92 (matches the
 *     `eu-banking-default` policy threshold).
 *   - Each approved case must have ≥ 1 expected result.
 *   - Validation, policy, and visual sidecar gates must not block.
 *   - The export pipeline must not refuse.
 *
 * The gate is a pure function over in-memory artifacts so it can be
 * exercised both by the harness golden tests and by the standalone
 * `test:ti-eval` runner.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  CONTRACT_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  WAVE1_POC_EVAL_REPORT_ARTIFACT_FILENAME,
  WAVE1_POC_EVAL_REPORT_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type ReviewGateSnapshot,
  type Wave1PocEvalFailure,
  type Wave1PocEvalFixtureMetrics,
  type Wave1PocEvalFixtureReport,
  type Wave1PocEvalReport,
  type Wave1PocEvalThresholds,
  type Wave1PocFixtureId,
} from "../contracts/index.js";
import type { ExportPipelineArtifacts } from "./export-pipeline.js";
import type { ValidationPipelineArtifacts } from "./validation-pipeline.js";
import { canonicalJson } from "./content-hash.js";
import { detectDuplicateTestCases } from "./test-case-duplicate.js";

/**
 * Default thresholds applied by the Wave 1 POC evaluation gate.
 *
 * The `Issue #1379` fields (`minJobRubricScore`, `requireRubricPass`) are
 * intentionally OMITTED from the default so the persisted eval report
 * remains byte-stable for fixtures that do not opt into the rubric pass.
 * Operators that want to enforce a rubric threshold pass an explicit
 * thresholds object to `evaluateWave1Poc`.
 */
export const WAVE1_POC_DEFAULT_EVAL_THRESHOLDS: Wave1PocEvalThresholds =
  Object.freeze({
    minTraceCoverageFields: 1,
    minTraceCoverageActions: 1,
    minTraceCoverageValidations: 1,
    minQcMappingExportableFraction: 1,
    maxDuplicateSimilarity: 0.92,
    minExpectedResultsPerCase: 1,
    minApprovedCases: 1,
    requirePolicyPass: true,
    requireVisualSidecarPass: true,
  });

export interface EvaluateWave1PocFixtureInput {
  fixtureId: Wave1PocFixtureId;
  intent: BusinessTestIntentIr;
  generatedList: GeneratedTestCaseList;
  validation: ValidationPipelineArtifacts;
  reviewSnapshot: ReviewGateSnapshot;
  exportArtifacts: ExportPipelineArtifacts;
}

const computeFraction = (numerator: number, denominator: number): number => {
  if (denominator === 0) return 1;
  return numerator / denominator;
};

const setUnion = <T>(...sources: ReadonlyArray<ReadonlyArray<T>>): Set<T> => {
  const out = new Set<T>();
  for (const s of sources) for (const v of s) out.add(v);
  return out;
};

const approvedCaseIds = (snapshot: ReviewGateSnapshot): Set<string> => {
  const out = new Set<string>();
  for (const entry of snapshot.perTestCase) {
    if (
      entry.state === "approved" ||
      entry.state === "exported" ||
      entry.state === "transferred"
    ) {
      out.add(entry.testCaseId);
    }
  }
  return out;
};

const filterApproved = (
  list: GeneratedTestCaseList,
  approvedIds: ReadonlySet<string>,
): GeneratedTestCase[] => {
  return list.testCases.filter((c) => approvedIds.has(c.id));
};

const computeFixtureMetrics = (
  input: EvaluateWave1PocFixtureInput,
): Wave1PocEvalFixtureMetrics => {
  const approvedIds = approvedCaseIds(input.reviewSnapshot);
  const approvedCases = filterApproved(input.generatedList, approvedIds);

  const detectedFieldIds = new Set(
    input.intent.detectedFields.map((f) => f.id),
  );
  const detectedActionIds = new Set(
    input.intent.detectedActions.map((a) => a.id),
  );
  const detectedValidationIds = new Set(
    input.intent.detectedValidations.map((v) => v.id),
  );

  const coveredFieldIds = setUnion(
    ...approvedCases.map((c) => c.qualitySignals.coveredFieldIds),
  );
  const coveredActionIds = setUnion(
    ...approvedCases.map((c) => c.qualitySignals.coveredActionIds),
  );
  const coveredValidationIds = setUnion(
    ...approvedCases.map((c) => c.qualitySignals.coveredValidationIds),
  );

  const intersect = <T>(a: Set<T>, b: Set<T>): number => {
    let n = 0;
    for (const v of a) if (b.has(v)) n += 1;
    return n;
  };
  const coveredFields = intersect(detectedFieldIds, coveredFieldIds);
  const coveredActions = intersect(detectedActionIds, coveredActionIds);
  const coveredValidations = intersect(
    detectedValidationIds,
    coveredValidationIds,
  );

  const exportableApproved = approvedCases.filter(
    (c) => c.qcMappingPreview.exportable,
  ).length;

  const duplicates = detectDuplicateTestCases({
    testCases: input.generatedList.testCases,
    threshold: 0,
  });
  const maxObservedDuplicateSimilarity = duplicates.reduce(
    (m, p) => (p.similarity > m ? p.similarity : m),
    0,
  );

  let minObservedExpectedResultsPerCase: number;
  if (approvedCases.length === 0) {
    minObservedExpectedResultsPerCase = 0;
  } else {
    minObservedExpectedResultsPerCase = approvedCases.reduce(
      (m, c) => Math.min(m, c.expectedResults.length),
      Number.POSITIVE_INFINITY,
    );
  }

  const policyBlocked = input.validation.policy.blocked;
  const validationBlocked = input.validation.validation.blocked;
  const visualSidecarBlocked = input.validation.visual?.blocked === true;
  const exportRefused = input.exportArtifacts.refused;

  const rubricReport = input.validation.rubric;
  const jobRubricScore =
    rubricReport !== undefined && rubricReport.refusal === undefined
      ? rubricReport.aggregate.jobLevelRubricScore
      : undefined;
  const rubricRefused =
    rubricReport !== undefined ? rubricReport.refusal !== undefined : undefined;

  const metrics: Wave1PocEvalFixtureMetrics = {
    fixtureId: input.fixtureId,
    totalGeneratedCases: input.generatedList.testCases.length,
    approvedCases: approvedCases.length,
    blockedCases: input.validation.policy.blockedCount,
    needsReviewCases: input.validation.policy.needsReviewCount,
    detectedFields: detectedFieldIds.size,
    coveredFields,
    detectedActions: detectedActionIds.size,
    coveredActions,
    detectedValidations: detectedValidationIds.size,
    coveredValidations,
    exportableApprovedCases: exportableApproved,
    maxObservedDuplicateSimilarity,
    minObservedExpectedResultsPerCase,
    policyBlocked,
    validationBlocked,
    visualSidecarBlocked,
    exportRefused,
  };
  if (jobRubricScore !== undefined) metrics.jobRubricScore = jobRubricScore;
  if (rubricRefused !== undefined) metrics.rubricRefused = rubricRefused;
  return metrics;
};

const evaluateThresholds = (
  metrics: Wave1PocEvalFixtureMetrics,
  thresholds: Wave1PocEvalThresholds,
): Wave1PocEvalFailure[] => {
  const failures: Wave1PocEvalFailure[] = [];

  const fieldFraction = computeFraction(
    metrics.coveredFields,
    metrics.detectedFields,
  );
  if (fieldFraction < thresholds.minTraceCoverageFields) {
    failures.push({
      rule: "min_trace_coverage_fields",
      actual: fieldFraction,
      threshold: thresholds.minTraceCoverageFields,
      message: `Approved cases cover ${metrics.coveredFields}/${metrics.detectedFields} detected fields (fraction=${fieldFraction})`,
    });
  }
  const actionFraction = computeFraction(
    metrics.coveredActions,
    metrics.detectedActions,
  );
  if (actionFraction < thresholds.minTraceCoverageActions) {
    failures.push({
      rule: "min_trace_coverage_actions",
      actual: actionFraction,
      threshold: thresholds.minTraceCoverageActions,
      message: `Approved cases cover ${metrics.coveredActions}/${metrics.detectedActions} detected actions (fraction=${actionFraction})`,
    });
  }
  const validationFraction = computeFraction(
    metrics.coveredValidations,
    metrics.detectedValidations,
  );
  if (validationFraction < thresholds.minTraceCoverageValidations) {
    failures.push({
      rule: "min_trace_coverage_validations",
      actual: validationFraction,
      threshold: thresholds.minTraceCoverageValidations,
      message: `Approved cases cover ${metrics.coveredValidations}/${metrics.detectedValidations} detected validations (fraction=${validationFraction})`,
    });
  }

  const exportableFraction = computeFraction(
    metrics.exportableApprovedCases,
    metrics.approvedCases,
  );
  if (exportableFraction < thresholds.minQcMappingExportableFraction) {
    failures.push({
      rule: "min_qc_mapping_exportable_fraction",
      actual: exportableFraction,
      threshold: thresholds.minQcMappingExportableFraction,
      message: `Only ${metrics.exportableApprovedCases}/${metrics.approvedCases} approved cases are QC-mapping exportable (fraction=${exportableFraction})`,
    });
  }

  if (
    metrics.maxObservedDuplicateSimilarity >= thresholds.maxDuplicateSimilarity
  ) {
    failures.push({
      rule: "max_duplicate_similarity",
      actual: metrics.maxObservedDuplicateSimilarity,
      threshold: thresholds.maxDuplicateSimilarity,
      message: `Pairwise duplicate similarity reached ${metrics.maxObservedDuplicateSimilarity} (allowed strictly below ${thresholds.maxDuplicateSimilarity})`,
    });
  }

  if (
    metrics.minObservedExpectedResultsPerCase <
    thresholds.minExpectedResultsPerCase
  ) {
    failures.push({
      rule: "min_expected_results_per_case",
      actual: metrics.minObservedExpectedResultsPerCase,
      threshold: thresholds.minExpectedResultsPerCase,
      message: `At least one approved case has ${metrics.minObservedExpectedResultsPerCase} expected results (need ≥ ${thresholds.minExpectedResultsPerCase})`,
    });
  }

  if (metrics.approvedCases < thresholds.minApprovedCases) {
    failures.push({
      rule: "min_approved_cases",
      actual: metrics.approvedCases,
      threshold: thresholds.minApprovedCases,
      message: `Only ${metrics.approvedCases} cases approved (need ≥ ${thresholds.minApprovedCases})`,
    });
  }

  if (thresholds.requirePolicyPass && metrics.policyBlocked) {
    failures.push({
      rule: "policy_blocked",
      actual: 1,
      threshold: 0,
      message: "Policy gate blocked the run",
    });
  }
  if (metrics.validationBlocked) {
    failures.push({
      rule: "validation_blocked",
      actual: 1,
      threshold: 0,
      message: "Validation gate reported errors",
    });
  }
  if (thresholds.requireVisualSidecarPass && metrics.visualSidecarBlocked) {
    failures.push({
      rule: "visual_sidecar_blocked",
      actual: 1,
      threshold: 0,
      message: "Visual sidecar gate blocked the run",
    });
  }
  if (metrics.exportRefused) {
    failures.push({
      rule: "export_refused",
      actual: 1,
      threshold: 0,
      message: "Export pipeline refused to emit non-report artifacts",
    });
  }

  if (
    thresholds.minJobRubricScore !== undefined &&
    metrics.jobRubricScore !== undefined &&
    metrics.jobRubricScore < thresholds.minJobRubricScore
  ) {
    failures.push({
      rule: "min_job_rubric_score",
      actual: metrics.jobRubricScore,
      threshold: thresholds.minJobRubricScore,
      message: `Self-verify rubric job-level score ${metrics.jobRubricScore} is below threshold ${thresholds.minJobRubricScore}`,
    });
  }

  if (thresholds.requireRubricPass === true && metrics.rubricRefused === true) {
    failures.push({
      rule: "rubric_pass_refused",
      actual: 1,
      threshold: 0,
      message: "Self-verify rubric pass attached a refusal to its report",
    });
  }

  failures.sort((a, b) => (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
  return failures;
};

/** Evaluate a single fixture against the thresholds. */
export const evaluateWave1PocFixture = (
  input: EvaluateWave1PocFixtureInput,
  thresholds: Wave1PocEvalThresholds = WAVE1_POC_DEFAULT_EVAL_THRESHOLDS,
): Wave1PocEvalFixtureReport => {
  const metrics = computeFixtureMetrics(input);
  const failures = evaluateThresholds(metrics, thresholds);
  return {
    fixtureId: input.fixtureId,
    pass: failures.length === 0,
    metrics,
    failures,
  };
};

export interface EvaluateWave1PocInput {
  generatedAt: string;
  thresholds?: Wave1PocEvalThresholds;
  fixtures: ReadonlyArray<EvaluateWave1PocFixtureInput>;
}

/**
 * Evaluate a set of fixtures and return the aggregate report. The
 * report is byte-stable: fixtures are sorted by `fixtureId`, failures
 * are sorted by rule name, and `generatedAt` is caller-provided.
 */
export const evaluateWave1Poc = (
  input: EvaluateWave1PocInput,
): Wave1PocEvalReport => {
  const thresholds = input.thresholds ?? WAVE1_POC_DEFAULT_EVAL_THRESHOLDS;
  const fixtures = input.fixtures
    .map((f) => evaluateWave1PocFixture(f, thresholds))
    .sort((a, b) =>
      a.fixtureId < b.fixtureId ? -1 : a.fixtureId > b.fixtureId ? 1 : 0,
    );
  const pass = fixtures.every((f) => f.pass);
  return {
    schemaVersion: WAVE1_POC_EVAL_REPORT_SCHEMA_VERSION,
    contractVersion: CONTRACT_VERSION,
    testIntelligenceContractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    thresholds: { ...thresholds },
    fixtures,
    pass,
  };
};

export interface WriteWave1PocEvalReportInput {
  report: Wave1PocEvalReport;
  destinationDir: string;
}

/** Persist the eval report under `wave1-poc-eval-report.json` atomically. */
export const writeWave1PocEvalReport = async (
  input: WriteWave1PocEvalReportInput,
): Promise<string> => {
  await mkdir(input.destinationDir, { recursive: true });
  const path = join(
    input.destinationDir,
    WAVE1_POC_EVAL_REPORT_ARTIFACT_FILENAME,
  );
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, canonicalJson(input.report), "utf8");
  await rename(tmp, path);
  return path;
};
