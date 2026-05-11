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
 * - suspicious payload shapes in generated strings that reach QC artifacts
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
  type WorkflowFieldLifecycleState,
  type WorkflowFieldLifecycleTrigger,
  type WorkflowTopology,
} from "../contracts/index.js";
import {
  evaluateInvariants,
  type DomainInvariantEvaluation,
  type DomainInvariantRegistry,
} from "./domain-invariant-registry.js";
import {
  detectExactNearDuplicateText,
  detectIntraClassRedundancy,
  type IntraClassBoundaryClassifier,
  type IntraClassRedundancyOutcome,
} from "./equivalence-class-fingerprint.js";
import { classifyFieldLifecycleTransition } from "./field-lifecycle-transition-tier.js";
import { validateGeneratedTestCaseList } from "./generated-test-case-schema.js";
import { detectPii } from "./pii-detection.js";
import { detectSuspiciousContent } from "./semantic-content-sanitization.js";
import { buildTestDesignModel } from "./test-design-model.js";
import {
  buildTestDataOracleGovernanceContext,
  projectTestDataOracleCase,
  type OracleProvenanceContext,
  type TestDataOracleCaseProjection,
  type TestDataOracleGovernanceContext,
} from "./test-data-oracle-governance.js";
import {
  detectOpenQuestionClarificationClaim,
  detectUnsupportedExactValidationClaim,
} from "./unresolved-validation-rules.js";

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
  workflowTopology?: WorkflowTopology;
  /**
   * Optional domain-invariant registry (Issue #2040). When supplied, every
   * generated case is evaluated against the registry and `forall`-matched
   * invariants that return `holds === false` produce
   * `domain_invariant_violation` issues at the per-case path. The
   * evaluation result is exposed through {@link InvariantValidationOutcome}
   * so callers can thread it into the coverage report.
   */
  invariantRegistry?: DomainInvariantRegistry;
  /**
   * Optional first-pass boundary classifier (Issue #2123 / #2099) used by
   * the intra-equivalence-class redundancy check. When supplied, the
   * classifier is consulted only for ambiguous boundary cases and can
   * VETO a deterministic redundancy verdict by returning `"keep"`. The
   * deterministic logic always vetoes a model `"redundant"` verdict —
   * the model never upgrades a `keep` decision to a redundancy warning.
   * Air-gapped pipelines should leave this undefined.
   */
  intraClassBoundaryClassifier?: IntraClassBoundaryClassifier;
  /**
   * Maximum character-distance budget for the auxiliary
   * exact-near-duplicate text check (Issue #2123). Defaults to `2`
   * (Levenshtein-2) to match the contract preserved from the legacy
   * Jaccard detector; profiles may widen the budget if their
   * canonicalisation tolerates it. Set to `0` to disable.
   */
  exactNearDuplicateTextDistance?: number;
}

/** Combined validation report + invariant evaluation (Issue #2040). */
export interface InvariantValidationOutcome {
  report: TestCaseValidationReport;
  invariantEvaluation?: DomainInvariantEvaluation;
  /**
   * Per-job intra-equivalence-class redundancy outcome (Issue #2123).
   * Populated whenever the run produced at least one accepted case;
   * `redundancyRatio` is `0` for empty inputs.
   */
  intraClassRedundancy?: IntraClassRedundancyOutcome;
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
  workflowTopology?: WorkflowTopology,
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
    actions: new Set([
      ...intent.detectedActions.map((a) => a.id),
      ...(workflowTopology?.actions.map((action) => action.actionId) ?? []),
    ]),
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
  workflowTopology: WorkflowTopology | undefined,
  model: ReturnType<typeof buildTestDesignModel>,
  oracleContext: TestDataOracleGovernanceContext,
  issues: TestCaseValidationIssue[],
): void => {
  const basePath = `$.testCases[${index}]`;
  const id = testCase.id;
  const oracleProjection = projectTestDataOracleCase({
    testCase,
    context: oracleContext,
  });

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

  validateStepsSemantics(testCase, basePath, workflowTopology, issues);
  validateExpectedResults(testCase, basePath, issues);
  validateTraceRefs(testCase, basePath, intentIds, issues);
  validateQcMapping(testCase, basePath, issues);
  validateQualitySignalsCoverage(testCase, basePath, intentIds, issues);
  validatePiiInTextFields(
    testCase,
    basePath,
    issues,
    oracleProjection.oracleProvenanceContext,
  );
  validateSemanticSuspiciousContent(testCase, basePath, issues);
  validateAssumptionsAndQuestions(testCase, basePath, issues);
  validateAmbiguityReviewState(testCase, basePath, issues);
  validateUnsupportedUnresolvedValidationDetails(
    testCase,
    basePath,
    model,
    issues,
  );
  validateNeedsOpenQuestionClarification(testCase, basePath, model, issues);
  validateTestDataOracleGovernance(
    testCase,
    basePath,
    oracleProjection,
    issues,
  );
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
    scanString(step.data, `${basePath}.steps[${i}].data`);
    scanString(step.expected, `${basePath}.steps[${i}].expected`);
  }
  scanList(testCase.expectedResults, `${basePath}.expectedResults`);
  scanList(testCase.preconditions, `${basePath}.preconditions`);
  scanList(testCase.testData, `${basePath}.testData`);
};

const validateStepsSemantics = (
  testCase: GeneratedTestCase,
  basePath: string,
  workflowTopology: WorkflowTopology | undefined,
  issues: TestCaseValidationIssue[],
): void => {
  const id = testCase.id;
  const steps = testCase.steps;
  const lifecycleTransitionIds = new Set(
    workflowTopology?.fieldLifecycles.flatMap((lifecycle) =>
      lifecycle.transitions.map((transition) => transition.transitionId),
    ) ?? [],
  );
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
    if (lifecycleTransitionIds.size > 0) {
      if (
        typeof step.fieldLifecycleTransitionId !== "string" ||
        step.fieldLifecycleTransitionId.trim().length === 0
      ) {
        pushIssue(issues, {
          testCaseId: id,
          path: `${basePath}.steps[${i}].fieldLifecycleTransitionId`,
          code: "missing_field_lifecycle_transition",
          severity: "error",
          message:
            "step must reference a workflow-topology field lifecycle transition id",
        });
      } else if (!lifecycleTransitionIds.has(step.fieldLifecycleTransitionId)) {
        pushIssue(issues, {
          testCaseId: id,
          path: `${basePath}.steps[${i}].fieldLifecycleTransitionId`,
          code: "unknown_field_lifecycle_transition",
          severity: "error",
          message: `fieldLifecycleTransitionId "${step.fieldLifecycleTransitionId}" does not exist in workflowTopology.fieldLifecycles`,
        });
      }
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

/**
 * Issue #2168 — tier-aware field-lifecycle transition coverage.
 *
 * The legacy implementation emitted a blocking
 * `uncovered_field_lifecycle_transition` error for EVERY uncovered
 * transition, which over-fired 30–139× per dataset on the M0 multi-dataset
 * benchmark and blocked G4 across the suite. The new implementation
 * classifies each transition into one of three tiers (see
 * {@link classifyFieldLifecycleTransition}) and emits:
 *
 * - `uncovered_field_lifecycle_transition` (`error`) for
 *   `mandatory_negative_path` transitions only — the entry transitions
 *   out of `initial` and the `validation_pass` / `validation_fail`
 *   outcomes that anchor negative-path coverage.
 * - `uncovered_field_lifecycle_transition_recommended` (`warning`) for
 *   `recommended_positive_path` transitions (positive-path completion).
 * - `uncovered_field_lifecycle_transition_recommended` (`warning`) for
 *   `state_transition_test_only` transitions ONLY when the run carries
 *   at least one `technique === "state_transition"` test case;
 *   otherwise the transition is silently ignored.
 *
 * Epic #2167 Q0 follow-up (2026-05-11): mandatory tier coverage is
 * aggregated at the `(screenId, trigger)` level rather than per
 * `(field, transition)`. The previous per-instance check demanded one
 * anchored test step for every (field × mandatory transition) pair,
 * which is mathematically impossible on multi-section banking masks —
 * a 31-field xr6Nf screen would need 62 anchored steps for full
 * mandatory coverage while the generator's bounded test-case quota
 * produces 20-25 steps. The ISO 29119 interpretation is that a
 * validation pipeline is shared screen-level infrastructure: one test
 * step exercising `validation_pass` on any field of the screen
 * exercises the pipeline for all similar fields. The
 * `(screen, trigger)` aggregation matches that semantic.
 *
 * The `recommended_positive_path` and `state_transition_test_only`
 * tiers stay per-transition (they fire as warnings, so over-firing
 * does not block the run, and per-transition granularity keeps the
 * audit trail granular for non-mandatory paths).
 */
const validateFieldLifecycleCoverage = (
  list: GeneratedTestCaseList,
  workflowTopology: WorkflowTopology | undefined,
  issues: TestCaseValidationIssue[],
): void => {
  const lifecycles = workflowTopology?.fieldLifecycles ?? [];
  if (lifecycles.length === 0) {
    return;
  }
  const allTransitions = lifecycles.flatMap((lifecycle) =>
    lifecycle.transitions.map((transition) => ({
      transition,
      fieldId: lifecycle.fieldId,
    })),
  );
  if (allTransitions.length === 0) {
    return;
  }
  const coveredTransitionIds = new Set<string>();
  for (const testCase of list.testCases) {
    for (const step of testCase.steps) {
      if (typeof step.fieldLifecycleTransitionId === "string") {
        coveredTransitionIds.add(step.fieldLifecycleTransitionId);
      }
    }
  }
  const hasStateTransitionTestCase = list.testCases.some(
    (testCase) => testCase.technique === "state_transition",
  );
  // Mandatory tier: aggregate by (screenId, trigger). One uncovered
  // group → one error, not one per (field × transition) pair. The
  // current mandatory tier maps each trigger to exactly one (from, to)
  // pair (validation_pass → in_progress→validated, validation_fail →
  // in_progress→error, user_input → initial→in_progress), so the
  // key intentionally omits from/to — it would be redundant. `from`
  // and `to` are still carried on the group for the error message.
  type MandatoryGroupKey = string;
  type MandatoryGroup = {
    readonly screenId: string;
    readonly trigger: WorkflowFieldLifecycleTrigger;
    readonly from: WorkflowFieldLifecycleState;
    readonly to: WorkflowFieldLifecycleState;
    transitionIds: string[];
  };
  const mandatoryGroups = new Map<MandatoryGroupKey, MandatoryGroup>();
  for (const { transition, fieldId } of allTransitions) {
    const tier = classifyFieldLifecycleTransition(transition);
    if (tier !== "mandatory_negative_path") continue;
    const screenId = extractScreenIdFromFieldId(fieldId);
    const key = `${screenId}::${transition.trigger}`;
    const existing = mandatoryGroups.get(key);
    if (existing === undefined) {
      mandatoryGroups.set(key, {
        screenId,
        trigger: transition.trigger,
        from: transition.from,
        to: transition.to,
        transitionIds: [transition.transitionId],
      });
    } else {
      existing.transitionIds.push(transition.transitionId);
    }
  }
  for (const group of mandatoryGroups.values()) {
    const covered = group.transitionIds.some((id) =>
      coveredTransitionIds.has(id),
    );
    if (covered) continue;
    const transitionCount = group.transitionIds.length;
    pushIssue(issues, {
      path: "$.testCases",
      code: "uncovered_field_lifecycle_transition",
      severity: "error",
      message:
        `workflowTopology.fieldLifecycles screen "${group.screenId}" ` +
        `mandatory_negative_path trigger "${group.trigger}" ` +
        `(${group.from} → ${group.to}) has no anchored test case step ` +
        `across ${transitionCount} field-lifecycle transition${transitionCount === 1 ? "" : "s"}: ` +
        `${group.transitionIds
          .slice(0, 3)
          .map((id) => `"${id}"`)
          .join(
            ", ",
          )}${transitionCount > 3 ? `, +${transitionCount - 3} more` : ""}`,
    });
  }
  // Recommended-tier + state-transition tier stay per-transition
  // (warnings only, granular audit trail).
  for (const { transition } of allTransitions) {
    if (coveredTransitionIds.has(transition.transitionId)) {
      continue;
    }
    const tier = classifyFieldLifecycleTransition(transition);
    if (tier === "mandatory_negative_path") {
      continue;
    }
    if (tier === "recommended_positive_path") {
      pushIssue(issues, {
        path: "$.testCases",
        code: "uncovered_field_lifecycle_transition_recommended",
        severity: "warning",
        message:
          `workflowTopology.fieldLifecycles transition "${transition.transitionId}" ` +
          `(${transition.from} → ${transition.to}, trigger ${transition.trigger}) ` +
          `is recommended_positive_path and has no anchored test case step`,
      });
      continue;
    }
    if (!hasStateTransitionTestCase) {
      continue;
    }
    pushIssue(issues, {
      path: "$.testCases",
      code: "uncovered_field_lifecycle_transition_recommended",
      severity: "warning",
      message:
        `workflowTopology.fieldLifecycles transition "${transition.transitionId}" ` +
        `(${transition.from} → ${transition.to}, trigger ${transition.trigger}) ` +
        `is state_transition_test_only and has no anchored test case step ` +
        `(required because the run carries a state_transition technique case)`,
    });
  }
};

/**
 * Extract the screen identifier from a {@link WorkflowFieldLifecycle.fieldId}.
 *
 * Convention (`action-topology-agent.ts`): `<screenId>::field::<nodeId>`.
 * Falls back to the whole fieldId when the separator is missing, so legacy
 * fixtures and non-Figma topologies degrade to per-field grouping (the
 * pre-Q0 behaviour) instead of crashing.
 */
const extractScreenIdFromFieldId = (fieldId: string): string => {
  const separator = "::field::";
  const index = fieldId.indexOf(separator);
  return index > 0 ? fieldId.slice(0, index) : fieldId;
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
  oracleProvenanceContext?: OracleProvenanceContext,
): void => {
  const id = testCase.id;
  const scan = (
    values: string[],
    fieldPath: string,
    code: TestCaseValidationIssueCode,
    leakCode: TestCaseValidationIssueCode,
    provenanceContext?: OracleProvenanceContext,
  ): void => {
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value === undefined) continue;
      if (provenanceContext?.byTestDataIndex[i]?.synthetic === true) {
        continue;
      }
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
    oracleProvenanceContext,
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

const validateUnsupportedUnresolvedValidationDetails = (
  testCase: GeneratedTestCase,
  basePath: string,
  model: ReturnType<typeof buildTestDesignModel>,
  issues: TestCaseValidationIssue[],
): void => {
  const claim = detectUnsupportedExactValidationClaim({
    testCase,
    model,
  });
  if (claim === undefined) return;
  pushIssue(issues, {
    testCaseId: testCase.id,
    path: `${basePath}.${claim.path}`,
    code: "unsupported_unresolved_validation_detail",
    severity: "error",
    message: claim.message,
  });
};

const validateNeedsOpenQuestionClarification = (
  testCase: GeneratedTestCase,
  basePath: string,
  model: ReturnType<typeof buildTestDesignModel>,
  issues: TestCaseValidationIssue[],
): void => {
  if (
    detectUnsupportedExactValidationClaim({
      testCase,
      model,
    }) !== undefined
  ) {
    return;
  }
  const claim = detectOpenQuestionClarificationClaim({
    testCase,
    model,
  });
  if (claim === undefined) return;
  pushIssue(issues, {
    testCaseId: testCase.id,
    path: `${basePath}.${claim.path}`,
    code: "needs_open_question_clarification",
    severity: "warning",
    message: claim.message,
  });
};

const validateTestDataOracleGovernance = (
  testCase: GeneratedTestCase,
  basePath: string,
  projection: TestDataOracleCaseProjection,
  issues: TestCaseValidationIssue[],
): void => {
  if (
    projection.oracleResolvedFields.length === 0 &&
    projection.oracleUnresolvedFields.length === 0
  ) {
    return;
  }
  const governedLabels = [
    ...projection.oracleResolvedFields.map((field) => field.fieldLabel),
    ...projection.oracleUnresolvedFields.map((field) => field.fieldLabel),
  ];
  const actualGovernedTestData = testCase.testData.filter((entry) =>
    governedLabels.some((label) => entry.startsWith(`${label}:`)),
  );
  const expectedTestData = [...projection.authoritativeTestData];
  if (
    expectedTestData.length !== actualGovernedTestData.length ||
    expectedTestData.some(
      (entry, index) => entry !== actualGovernedTestData[index],
    )
  ) {
    pushIssue(issues, {
      testCaseId: testCase.id,
      path: `${basePath}.testData`,
      code: "test_data_oracle_violation",
      severity: "error",
      message:
        "testData for oracle-governed fields must exactly match the deterministic test-data oracle output",
    });
  }
  for (const openQuestion of projection.authoritativeOpenQuestions) {
    if (testCase.openQuestions.includes(openQuestion)) continue;
    pushIssue(issues, {
      testCaseId: testCase.id,
      path: `${basePath}.openQuestions`,
      code: "test_data_oracle_violation",
      severity: "error",
      message:
        "oracle-unresolved fields must surface a deterministic open question instead of concrete test data",
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
): TestCaseValidationReport =>
  validateGeneratedTestCasesWithInvariants(input).report;

/**
 * Variant of {@link validateGeneratedTestCases} that also returns the
 * domain-invariant evaluation (Issue #2040). Use this when the caller
 * needs the per-case `exercises` mapping or the job-level coverage ratio
 * — e.g. the production validation pipeline that surfaces both the
 * `domain_invariant_violation` issues and the `invariantCoverage` field
 * on the coverage report.
 */
export const validateGeneratedTestCasesWithInvariants = (
  input: ValidateGeneratedTestCasesInput,
): InvariantValidationOutcome => {
  const issues: TestCaseValidationIssue[] = [];
  const model = buildTestDesignModel({
    jobId: input.jobId,
    intent: input.intent,
  });

  if (!validateStructural(input.list, issues)) {
    return {
      report: finalizeReport({
        jobId: input.jobId,
        generatedAt: input.generatedAt,
        totalTestCases: 0,
        issues,
      }),
    };
  }

  const intentIds = collectIntentIds(input.intent, input.workflowTopology);
  const oracleContext = buildTestDataOracleGovernanceContext({
    intent: input.intent,
    generatedAt: input.generatedAt,
  });
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
    validateCase(
      tc,
      i,
      intentIds,
      input.workflowTopology,
      model,
      oracleContext,
      issues,
    );
    if ((tc.audit.truncatedInstructionCount ?? 0) > 0) {
      pushIssue(issues, {
        testCaseId: tc.id,
        path: `$.testCases[${i}].audit.truncatedInstructionCount`,
        code: "truncated_repair_instruction",
        severity: "warning",
        message: `repair instructions were truncated ${String(tc.audit.truncatedInstructionCount)} time(s) before regeneration; inspect judge artifacts if the fix intent looks incomplete`,
      });
    }
  }
  validateFieldLifecycleCoverage(list, input.workflowTopology, issues);

  let invariantEvaluation: DomainInvariantEvaluation | undefined;
  if (input.invariantRegistry !== undefined) {
    invariantEvaluation = evaluateInvariants({
      registry: input.invariantRegistry,
      testCases: list.testCases,
      context: { intent: input.intent, model },
    });
    const indexById = new Map<string, number>();
    for (let i = 0; i < list.testCases.length; i++) {
      const tc = list.testCases[i];
      if (tc === undefined) continue;
      indexById.set(tc.id, i);
    }
    for (const violation of invariantEvaluation.violations) {
      const idx = indexById.get(violation.testCaseId);
      const basePath = idx === undefined ? "$" : `$.testCases[${idx}]`;
      pushIssue(issues, {
        testCaseId: violation.testCaseId,
        path: `${basePath}.${violation.path}`,
        code: "domain_invariant_violation",
        severity: violation.severity,
        message: `${violation.invariantId}: ${violation.message}`,
      });
    }
  }

  const indexById = new Map<string, number>();
  for (let i = 0; i < list.testCases.length; i++) {
    const tc = list.testCases[i];
    if (tc === undefined) continue;
    indexById.set(tc.id, i);
  }
  const intraClassRedundancy = detectIntraClassRedundancy({
    testCases: list.testCases,
    ...(input.intraClassBoundaryClassifier !== undefined
      ? { boundaryClassifier: input.intraClassBoundaryClassifier }
      : {}),
  });
  for (const finding of intraClassRedundancy.findings) {
    const idx = indexById.get(finding.redundantTestCaseId);
    const basePath = idx === undefined ? "$" : `$.testCases[${idx}]`;
    pushIssue(issues, {
      testCaseId: finding.redundantTestCaseId,
      path: `${basePath}.qualitySignals`,
      code: "intra_equivalence_class_redundancy",
      severity: "warning",
      message:
        `case adds no distinct coverage relative to ${finding.representativeTestCaseId} ` +
        `within equivalence class (technique=${finding.technique}, ` +
        `risk=${finding.riskClass}, polarity=${finding.oraclePolarity}); ` +
        `verified by ${finding.source}`,
    });
  }

  const textDistance = input.exactNearDuplicateTextDistance ?? 2;
  if (textDistance > 0) {
    const textFindings = detectExactNearDuplicateText({
      testCases: list.testCases,
      distance: textDistance,
    });
    for (const finding of textFindings) {
      const idx = indexById.get(finding.rightTestCaseId);
      const basePath = idx === undefined ? "$" : `$.testCases[${idx}]`;
      pushIssue(issues, {
        testCaseId: finding.rightTestCaseId,
        path: `${basePath}.title`,
        code: "exact_near_duplicate_text",
        severity: "warning",
        message:
          `text differs from ${finding.leftTestCaseId} by only ` +
          `${finding.characterDistance} character(s) — confirm cosmetic ` +
          `near-duplicates are intentional`,
      });
    }
  }

  return {
    report: finalizeReport({
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      totalTestCases: list.testCases.length,
      issues,
    }),
    ...(invariantEvaluation !== undefined ? { invariantEvaluation } : {}),
    intraClassRedundancy,
  };
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
