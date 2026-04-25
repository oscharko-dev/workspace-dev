/**
 * Coverage / quality-signals report (Issue #1364).
 *
 * Computes the persisted `coverage-report.json` shape from a generated
 * test case list and the upstream Business Test Intent IR. The report
 * surfaces:
 *
 * - field/action/validation/navigation coverage buckets
 * - trace coverage (cases with at least one Figma trace)
 * - per-type counters: positive/negative/validation/boundary/workflow/accessibility
 * - assumption ratio + open-question count
 * - duplicate pairs above the similarity threshold
 *
 * The shape is byte-stable: arrays are sorted and ratios are rounded to
 * six digits so two equivalent inputs serialize identically.
 */

import {
  TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type TestCaseCoverageBucket,
  type TestCaseCoverageReport,
  type TestCaseDuplicatePair,
} from "../contracts/index.js";
import { detectDuplicateTestCases } from "./test-case-duplicate.js";

export interface ComputeCoverageReportInput {
  jobId: string;
  generatedAt: string;
  policyProfileId: string;
  list: GeneratedTestCaseList;
  intent: BusinessTestIntentIr;
  duplicateSimilarityThreshold: number;
  /** Optional 0..1 rubric score from a downstream rater. */
  rubricScore?: number;
}

export const computeCoverageReport = (
  input: ComputeCoverageReportInput,
): TestCaseCoverageReport => {
  const cases = input.list.testCases;

  const fieldCoverage = computeBucket(
    input.intent.detectedFields.map((f) => f.id),
    collectCovered(cases, (c) => c.qualitySignals.coveredFieldIds),
  );
  const actionCoverage = computeBucket(
    input.intent.detectedActions.map((a) => a.id),
    collectCovered(cases, (c) => c.qualitySignals.coveredActionIds),
  );
  const validationCoverage = computeBucket(
    input.intent.detectedValidations.map((v) => v.id),
    collectCovered(cases, (c) => c.qualitySignals.coveredValidationIds),
  );
  const navigationCoverage = computeBucket(
    input.intent.detectedNavigation.map((n) => n.id),
    collectCovered(cases, (c) => c.qualitySignals.coveredNavigationIds),
  );

  const totalCases = cases.length;
  const withTrace = cases.filter((c) => c.figmaTraceRefs.length > 0).length;
  const traceCoverage = {
    total: totalCases,
    withTrace,
    ratio: totalCases === 0 ? 0 : roundTo(withTrace / totalCases, 6),
  };

  const counters = countByType(cases);
  const assumptionsTotal = cases.reduce(
    (acc, c) => acc + c.assumptions.length,
    0,
  );
  const openQuestionsCount = cases.reduce(
    (acc, c) => acc + c.openQuestions.length,
    0,
  );
  const assumptionsRatio =
    totalCases === 0 ? 0 : roundTo(assumptionsTotal / totalCases, 6);

  const duplicatePairs: TestCaseDuplicatePair[] = detectDuplicateTestCases({
    testCases: cases,
    threshold: input.duplicateSimilarityThreshold,
  });

  const report: TestCaseCoverageReport = {
    schemaVersion: TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    policyProfileId: input.policyProfileId,
    totalTestCases: totalCases,
    fieldCoverage,
    actionCoverage,
    validationCoverage,
    navigationCoverage,
    traceCoverage,
    negativeCaseCount: counters.negative,
    validationCaseCount: counters.validation,
    boundaryCaseCount: counters.boundary,
    accessibilityCaseCount: counters.accessibility,
    workflowCaseCount: counters.workflow,
    positiveCaseCount: counters.positive,
    assumptionsRatio,
    openQuestionsCount,
    duplicatePairs,
  };
  if (input.rubricScore !== undefined) {
    if (input.rubricScore < 0 || input.rubricScore > 1) {
      throw new RangeError("rubricScore must be in [0, 1]");
    }
    report.rubricScore = roundTo(input.rubricScore, 6);
  }
  return report;
};

const computeBucket = (
  totalIds: string[],
  coveredIds: Set<string>,
): TestCaseCoverageBucket => {
  const total = totalIds.length;
  const allIds = new Set(totalIds);
  let covered = 0;
  for (const id of coveredIds) {
    if (allIds.has(id)) covered += 1;
  }
  const uncovered: string[] = [];
  for (const id of totalIds) {
    if (!coveredIds.has(id)) uncovered.push(id);
  }
  uncovered.sort();
  return {
    total,
    covered,
    ratio: total === 0 ? 0 : roundTo(covered / total, 6),
    uncoveredIds: uncovered,
  };
};

const collectCovered = (
  cases: ReadonlyArray<GeneratedTestCase>,
  pick: (c: GeneratedTestCase) => string[],
): Set<string> => {
  const out = new Set<string>();
  for (const c of cases) {
    for (const id of pick(c)) {
      out.add(id);
    }
  }
  return out;
};

interface Counters {
  positive: number;
  negative: number;
  validation: number;
  boundary: number;
  workflow: number;
  accessibility: number;
}

const countByType = (cases: ReadonlyArray<GeneratedTestCase>): Counters => {
  const counters: Counters = {
    positive: 0,
    negative: 0,
    validation: 0,
    boundary: 0,
    workflow: 0,
    accessibility: 0,
  };
  for (const c of cases) {
    switch (c.type) {
      case "negative":
        counters.negative += 1;
        break;
      case "validation":
        counters.validation += 1;
        break;
      case "boundary":
        counters.boundary += 1;
        break;
      case "navigation":
        // Navigation cases double as workflow signals.
        counters.workflow += 1;
        break;
      case "accessibility":
        counters.accessibility += 1;
        break;
      case "functional":
      case "regression":
        counters.positive += 1;
        break;
      case "exploratory":
        // Exploratory cases are workflow-like by definition.
        counters.workflow += 1;
        break;
    }
  }
  return counters;
};

const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
