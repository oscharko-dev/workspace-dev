/**
 * Semantic + structural validation for generated test cases (Issue #1364).
 *
 * The structural shape is already enforced by
 * `validateGeneratedTestCaseList` in `generated-test-case-schema.ts`. This
 * module layers semantic checks on top:
 *
 * - ordered, sequential, non-empty steps
 * - mandatory expected results
 * - trace refs that resolve to known intent screens
 * - QC mapping consistency (`exportable=false` => non-empty `blockingReasons`)
 * - PII pattern leakage in `testData`, `preconditions`, `expectedResults`
 * - cross-case duplicate ids
 * - quality-signal coverage ids that reference known intent ids
 *
 * The output is a `TestCaseValidationReport` with a deterministic ordering
 * suitable for byte-stable persistence.
 */

import {
  TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type TestCaseValidationIssue,
  type TestCaseValidationIssueCode,
  type TestCaseValidationReport,
  type TestCaseValidationSeverity,
} from "../contracts/index.js";
import { validateGeneratedTestCaseList } from "./generated-test-case-schema.js";
import { detectPii } from "./pii-detection.js";
import { detectSuspiciousContent } from "./semantic-content-sanitization.js";

const TITLE_MAX_LENGTH = 200;
const OBJECTIVE_MAX_LENGTH = 1000;
const STEP_ACTION_MAX_LENGTH = 500;
const ASSUMPTIONS_HARD_LIMIT = 25;
const OPEN_QUESTIONS_HARD_LIMIT = 25;

/** Input bundle for `validateGeneratedTestCases`. */
export interface ValidateGeneratedTestCasesInput {
  jobId: string;
  generatedAt: string;
  list: GeneratedTestCaseList;
  intent: BusinessTestIntentIr;
}

/** Per-issue helper to keep deterministic insertion order. */
const pushIssue = (
  issues: TestCaseValidationIssue[],
  data: {
    testCaseId?: string;
    path: string;
    code: TestCaseValidationIssueCode;
    severity: TestCaseValidationSeverity;
    message: string;
  },
): void => {
  const issue: TestCaseValidationIssue = {
    path: data.path,
    code: data.code,
    severity: data.severity,
    message: data.message,
  };
  if (data.testCaseId !== undefined) {
    issue.testCaseId = data.testCaseId;
  }
  issues.push(issue);
};

const collectIntentIds = (
  intent: BusinessTestIntentIr,
): {
  screens: Set<string>;
  fields: Set<string>;
  actions: Set<string>;
  validations: Set<string>;
  navigation: Set<string>;
} => {
  return {
    screens: new Set(intent.screens.map((s) => s.screenId)),
    fields: new Set(intent.detectedFields.map((f) => f.id)),
    actions: new Set(intent.detectedActions.map((a) => a.id)),
    validations: new Set(intent.detectedValidations.map((v) => v.id)),
    navigation: new Set(intent.detectedNavigation.map((n) => n.id)),
  };
};

const validateStructural = (
  list: unknown,
  issues: TestCaseValidationIssue[],
): boolean => {
  const result = validateGeneratedTestCaseList(list);
  if (result.valid) return true;
  for (const error of result.errors) {
    pushIssue(issues, {
      path: error.path,
      code: "schema_invalid",
      severity: "error",
      message: error.message,
    });
  }
  return false;
};

const validateCase = (
  testCase: GeneratedTestCase,
  index: number,
  intentIds: ReturnType<typeof collectIntentIds>,
  issues: TestCaseValidationIssue[],
): void => {
  const basePath = `$.testCases[${index}]`;
  const id = testCase.id;

  if (testCase.title.trim().length === 0) {
    pushIssue(issues, {
      testCaseId: id,
      path: `${basePath}.title`,
      code: "title_empty",
      severity: "error",
      message: "title must not be whitespace-only",
    });
  } else if (testCase.title.length > TITLE_MAX_LENGTH) {
    pushIssue(issues, {
      testCaseId: id,
      path: `${basePath}.title`,
      code: "title_empty",
      severity: "error",
      message: `title exceeds ${TITLE_MAX_LENGTH} characters`,
    });
  }
  if (testCase.objective.trim().length === 0) {
    pushIssue(issues, {
      testCaseId: id,
      path: `${basePath}.objective`,
      code: "objective_empty",
      severity: "error",
      message: "objective must not be whitespace-only",
    });
  } else if (testCase.objective.length > OBJECTIVE_MAX_LENGTH) {
    pushIssue(issues, {
      testCaseId: id,
      path: `${basePath}.objective`,
      code: "objective_empty",
      severity: "error",
      message: `objective exceeds ${OBJECTIVE_MAX_LENGTH} characters`,
    });
  }

  validateStepsSemantics(testCase, basePath, issues);
  validateExpectedResults(testCase, basePath, issues);
  validateTraceRefs(testCase, basePath, intentIds, issues);
  validateQcMapping(testCase, basePath, issues);
  validateQualitySignalsCoverage(testCase, basePath, intentIds, issues);
  validatePiiInTextFields(testCase, basePath, issues);
  validateSemanticSuspiciousContent(testCase, basePath, issues);
  validateAssumptionsAndQuestions(testCase, basePath, issues);
  validateAmbiguityReviewState(testCase, basePath, issues);
};

const validateSemanticSuspiciousContent = (
  testCase: GeneratedTestCase,
  basePath: string,
  issues: TestCaseValidationIssue[],
): void => {
  const id = testCase.id;
  const scanString = (value: string | undefined, path: string): void => {
    if (typeof value !== "string" || value.length === 0) return;
    const match = detectSuspiciousContent(value);
    if (match === null) return;
    pushIssue(issues, {
      testCaseId: id,
      path,
      code: "semantic_suspicious_content",
      severity: "error",
      message: `${match.category}: ${match.reason}; matched snippet "${match.matchedSnippet}"`,
    });
  };
  const scanList = (
    values: readonly string[] | undefined,
    prefix: string,
  ): void => {
    if (values === undefined) return;
    for (let i = 0; i < values.length; i++) {
      scanString(values[i], `${prefix}[${i}]`);
    }
  };
  for (let i = 0; i < testCase.steps.length; i++) {
    const step = testCase.steps[i];
    if (step === undefined) continue;
    scanString(step.action, `${basePath}.steps[${i}].action`);
    scanString(step.expected, `${basePath}.steps[${i}].expected`);
  }
  scanList(testCase.expectedResults, `${basePath}.expectedResults`);
  scanList(testCase.preconditions, `${basePath}.preconditions`);
  scanList(testCase.testData, `${basePath}.testData`);
};

const validateStepsSemantics = (
  testCase: GeneratedTestCase,
  basePath: string,
  issues: TestCaseValidationIssue[],
): void => {
  const id = testCase.id;
  const steps = testCase.steps;
  const indices: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step === undefined) continue;
    if (step.action.trim().length === 0) {
      pushIssue(issues, {
        testCaseId: id,
        path: `${basePath}.steps[${i}].action`,
        code: "step_action_empty",
        severity: "error",
        message: "step action must not be whitespace-only",
      });
    } else if (step.action.length > STEP_ACTION_MAX_LENGTH) {
      pushIssue(issues, {
        testCaseId: id,
        path: `${basePath}.steps[${i}].action`,
        code: "step_action_too_long",
        severity: "warning",
        message: `step action exceeds ${STEP_ACTION_MAX_LENGTH} characters`,
      });
    }
    indices.push(step.index);
  }
  // Duplicate-index detection.
  const seen = new Set<number>();
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (v === undefined) continue;
    if (seen.has(v)) {
      pushIssue(issues, {
        testCaseId: id,
        path: `${basePath}.steps[${i}].index`,
        code: "duplicate_step_index",
        severity: "error",
        message: `duplicate step index ${v}`,
      });
    }
    seen.add(v);
  }
  // Ordered + sequential 1..N.
  for (let i = 1; i < indices.length; i++) {
    const prev = indices[i - 1];
    const cur = indices[i];
    if (prev === undefined || cur === undefined) continue;
    if (cur < prev) {
      pushIssue(issues, {
        testCaseId: id,
        path: `${basePath}.steps[${i}].index`,
        code: "steps_unordered",
        severity: "error",
        message: `step index ${cur} appears after ${prev}; steps must be in ascending order`,
      });
    }
  }
  if (indices.length > 0) {
    const sorted = [...indices].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i + 1) {
        pushIssue(issues, {
          testCaseId: id,
          path: `${basePath}.steps`,
          code: "steps_indices_non_sequential",
          severity: "error",
          message: `step indices must form a contiguous 1..N sequence; saw [${sorted.join(", ")}]`,
        });
        break;
      }
    }
  }
};

const validateExpectedResults = (
  testCase: GeneratedTestCase,
  basePath: string,
  issues: TestCaseValidationIssue[],
): void => {
  const stepHasExpected = testCase.steps.some(
    (s) => typeof s.expected === "string" && s.expected.trim().length > 0,
  );
  const topLevelHasExpected = testCase.expectedResults.some(
    (e) => e.trim().length > 0,
  );
  if (!stepHasExpected && !topLevelHasExpected) {
    pushIssue(issues, {
      testCaseId: testCase.id,
      path: `${basePath}.expectedResults`,
      code: "missing_expected_results",
      severity: "error",
      message:
        "test case must declare at least one expected result (top-level or per-step)",
    });
  }
};

const validateTraceRefs = (
  testCase: GeneratedTestCase,
  basePath: string,
  intentIds: ReturnType<typeof collectIntentIds>,
  issues: TestCaseValidationIssue[],
): void => {
  if (testCase.figmaTraceRefs.length === 0) {
    pushIssue(issues, {
      testCaseId: testCase.id,
      path: `${basePath}.figmaTraceRefs`,
      code: "missing_trace",
      severity: "error",
      message:
        "test case must reference at least one Figma trace; untraced cases cannot be exported",
    });
    return;
  }
  for (let i = 0; i < testCase.figmaTraceRefs.length; i++) {
    const ref = testCase.figmaTraceRefs[i];
    if (ref === undefined) continue;
    if (!intentIds.screens.has(ref.screenId)) {
      pushIssue(issues, {
        testCaseId: testCase.id,
        path: `${basePath}.figmaTraceRefs[${i}].screenId`,
        code: "trace_screen_unknown",
        severity: "error",
        message: `trace screenId "${ref.screenId}" does not exist in the Business Test Intent IR`,
      });
    }
  }
};

const validateQcMapping = (
  testCase: GeneratedTestCase,
  basePath: string,
  issues: TestCaseValidationIssue[],
): void => {
  const mapping = testCase.qcMappingPreview;
  if (!mapping.exportable) {
    const reasons = mapping.blockingReasons ?? [];
    if (reasons.length === 0) {
      pushIssue(issues, {
        testCaseId: testCase.id,
        path: `${basePath}.qcMappingPreview.blockingReasons`,
        code: "qc_mapping_blocking_reasons_missing",
        severity: "error",
        message:
          "qcMappingPreview.exportable=false requires non-empty blockingReasons",
      });
    } else if (reasons.some((r) => r.trim().length === 0)) {
      pushIssue(issues, {
        testCaseId: testCase.id,
        path: `${basePath}.qcMappingPreview.blockingReasons`,
        code: "qc_mapping_blocking_reasons_missing",
        severity: "error",
        message: "blockingReasons must not contain empty strings",
      });
    }
  } else if (
    mapping.blockingReasons !== undefined &&
    mapping.blockingReasons.length > 0
  ) {
    pushIssue(issues, {
      testCaseId: testCase.id,
      path: `${basePath}.qcMappingPreview`,
      code: "qc_mapping_exportable_inconsistent",
      severity: "error",
      message:
        "qcMappingPreview.exportable=true must not declare blockingReasons",
    });
  }
};

const validateQualitySignalsCoverage = (
  testCase: GeneratedTestCase,
  basePath: string,
  intentIds: ReturnType<typeof collectIntentIds>,
  issues: TestCaseValidationIssue[],
): void => {
  const qs = testCase.qualitySignals;
  if (qs.confidence < 0 || qs.confidence > 1) {
    pushIssue(issues, {
      testCaseId: testCase.id,
      path: `${basePath}.qualitySignals.confidence`,
      code: "quality_signals_confidence_out_of_range",
      severity: "error",
      message: "confidence must be in [0, 1]",
    });
  }
  const checkIds = (
    ids: string[],
    field:
      | "coveredFieldIds"
      | "coveredActionIds"
      | "coveredValidationIds"
      | "coveredNavigationIds",
    pool: Set<string>,
  ): void => {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id === undefined) continue;
      if (!pool.has(id)) {
        pushIssue(issues, {
          testCaseId: testCase.id,
          path: `${basePath}.qualitySignals.${field}[${i}]`,
          code: "quality_signals_coverage_unknown_id",
          severity: "warning",
          message: `${field} references unknown intent id "${id}"`,
        });
      }
    }
  };
  checkIds(qs.coveredFieldIds, "coveredFieldIds", intentIds.fields);
  checkIds(qs.coveredActionIds, "coveredActionIds", intentIds.actions);
  checkIds(
    qs.coveredValidationIds,
    "coveredValidationIds",
    intentIds.validations,
  );
  checkIds(
    qs.coveredNavigationIds,
    "coveredNavigationIds",
    intentIds.navigation,
  );
};

const validatePiiInTextFields = (
  testCase: GeneratedTestCase,
  basePath: string,
  issues: TestCaseValidationIssue[],
): void => {
  const id = testCase.id;
  const scan = (
    values: string[],
    fieldPath: string,
    code: TestCaseValidationIssueCode,
    leakCode: TestCaseValidationIssueCode,
  ): void => {
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value === undefined) continue;
      if (looksLikeRedactionToken(value)) {
        // Token like "[REDACTED:EMAIL]" — already redacted upstream; OK.
        continue;
      }
      const match = detectPii(value);
      if (match !== null) {
        pushIssue(issues, {
          testCaseId: id,
          path: `${fieldPath}[${i}]`,
          code,
          severity: "error",
          message: `${match.kind} detected in ${fieldPath}; original PII must never be persisted`,
        });
        continue;
      }
      // Heuristic for un-redacted IBAN-or-PAN-shape leftovers that are
      // common in mock data — strict regex; all true positives are caught
      // by `detectPii` first, so this is purely defense-in-depth for
      // suspicious unredacted shapes.
      if (looksLikeUnredactedSensitive(value)) {
        pushIssue(issues, {
          testCaseId: id,
          path: `${fieldPath}[${i}]`,
          code: leakCode,
          severity: "warning",
          message: `${fieldPath} value looks unredacted; verify upstream redaction policy`,
        });
      }
    }
  };
  scan(
    testCase.testData,
    `${basePath}.testData`,
    "test_data_pii_detected",
    "test_data_unredacted_value",
  );
  scan(
    testCase.preconditions,
    `${basePath}.preconditions`,
    "preconditions_pii_detected",
    "test_data_unredacted_value",
  );
  scan(
    testCase.expectedResults,
    `${basePath}.expectedResults`,
    "expected_results_pii_detected",
    "test_data_unredacted_value",
  );
};

const REDACTION_TOKEN_RE = /\[REDACTED:[A-Z_]+\]/;

const looksLikeRedactionToken = (value: string): boolean => {
  return REDACTION_TOKEN_RE.test(value);
};

const UNREDACTED_LONG_DIGIT_RUN = /\b\d{12,}\b/;

const looksLikeUnredactedSensitive = (value: string): boolean => {
  return UNREDACTED_LONG_DIGIT_RUN.test(value);
};

const validateAssumptionsAndQuestions = (
  testCase: GeneratedTestCase,
  basePath: string,
  issues: TestCaseValidationIssue[],
): void => {
  if (testCase.assumptions.length > ASSUMPTIONS_HARD_LIMIT) {
    pushIssue(issues, {
      testCaseId: testCase.id,
      path: `${basePath}.assumptions`,
      code: "assumptions_excessive",
      severity: "warning",
      message: `assumptions length ${testCase.assumptions.length} exceeds soft limit ${ASSUMPTIONS_HARD_LIMIT}`,
    });
  }
  if (testCase.openQuestions.length > OPEN_QUESTIONS_HARD_LIMIT) {
    pushIssue(issues, {
      testCaseId: testCase.id,
      path: `${basePath}.openQuestions`,
      code: "open_questions_excessive",
      severity: "warning",
      message: `openQuestions length ${testCase.openQuestions.length} exceeds soft limit ${OPEN_QUESTIONS_HARD_LIMIT}`,
    });
  }
};

const validateAmbiguityReviewState = (
  testCase: GeneratedTestCase,
  basePath: string,
  issues: TestCaseValidationIssue[],
): void => {
  if (
    testCase.qualitySignals.ambiguity !== undefined &&
    testCase.reviewState === "auto_approved"
  ) {
    pushIssue(issues, {
      testCaseId: testCase.id,
      path: `${basePath}.reviewState`,
      code: "ambiguity_without_review_state",
      severity: "error",
      message:
        "test case carries an ambiguity note but is marked auto_approved; ambiguous cases must require manual review",
    });
  }
};

/**
 * Validate a generated test case list against schema, semantics, and the
 * intent IR. Always resolves; the report carries `blocked=true` when any
 * `error`-severity issue is recorded.
 */
export const validateGeneratedTestCases = (
  input: ValidateGeneratedTestCasesInput,
): TestCaseValidationReport => {
  const issues: TestCaseValidationIssue[] = [];

  if (!validateStructural(input.list, issues)) {
    return finalizeReport({
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      totalTestCases: 0,
      issues,
    });
  }

  const intentIds = collectIntentIds(input.intent);
  const seenIds = new Map<string, number>();
  const list = input.list;

  for (let i = 0; i < list.testCases.length; i++) {
    const tc = list.testCases[i];
    if (tc === undefined) continue;
    if (seenIds.has(tc.id)) {
      pushIssue(issues, {
        testCaseId: tc.id,
        path: `$.testCases[${i}].id`,
        code: "duplicate_test_case_id",
        severity: "error",
        message: `test case id "${tc.id}" appears at indices ${seenIds.get(tc.id)} and ${i}`,
      });
    } else {
      seenIds.set(tc.id, i);
    }
    validateCase(tc, i, intentIds, issues);
  }

  return finalizeReport({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    totalTestCases: list.testCases.length,
    issues,
  });
};

const finalizeReport = (input: {
  jobId: string;
  generatedAt: string;
  totalTestCases: number;
  issues: TestCaseValidationIssue[];
}): TestCaseValidationReport => {
  const errorCount = input.issues.filter((i) => i.severity === "error").length;
  const warningCount = input.issues.length - errorCount;
  return {
    schemaVersion: TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    totalTestCases: input.totalTestCases,
    errorCount,
    warningCount,
    blocked: errorCount > 0,
    issues: input.issues,
  };
};
