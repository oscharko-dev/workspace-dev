/**
 * Policy gate (Issue #1364).
 *
 * Evaluates a generated test case list against a `TestCasePolicyProfile`
 * and emits `TestCasePolicyDecisionRecord` rows. The gate composes:
 *
 * - per-case violations from the validation report (PII / missing trace
 *   / missing expected results / schema_invalid → `blocked`)
 * - per-case rules from the policy profile (regulated risk → review,
 *   ambiguity → review, low confidence → review, QC mapping not
 *   exportable → blocked, too many open questions / assumptions →
 *   review)
 * - job-level rules: required fields without negative/validation/boundary
 *   coverage; screens with form fields without an accessibility case;
 *   duplicate-pair fingerprints exceeding the profile threshold
 * - visual-sidecar outcomes (failure / fallback / low confidence /
 *   possible PII / prompt-injection-like text) propagated as
 *   `jobLevelViolations`
 *
 * The function is pure: it never reads files, never does network IO,
 * never mutates inputs, and emits decisions in stable order so that the
 * persisted artifact is byte-deterministic.
 */

import {
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type BusinessTestIntentIr,
  type CustomContextPolicySignal,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type TestCaseCoverageReport,
  type TestCasePolicyDecision,
  type TestCasePolicyDecisionRecord,
  type TestCasePolicyOutcome,
  type TestCasePolicyProfile,
  type TestCasePolicyReport,
  type TestCasePolicyViolation,
  type TestCaseRiskCategory,
  type TestCaseValidationIssue,
  type TestCaseValidationIssueCode,
  type TestCaseValidationReport,
  type VisualSidecarFailureClass,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import {
  filterSemanticContentOverridesForValidation,
  type SemanticContentOverrideMap,
} from "./semantic-content-sanitization.js";

export interface EvaluatePolicyGateInput {
  jobId: string;
  generatedAt: string;
  list: GeneratedTestCaseList;
  intent: BusinessTestIntentIr;
  profile: TestCasePolicyProfile;
  validation: TestCaseValidationReport;
  coverage: TestCaseCoverageReport;
  visual?: VisualSidecarValidationReport;
  /**
   * Active reviewer overrides for `semantic_suspicious_content` findings,
   * keyed by `testCaseId → set of validation issue paths`. When a finding's
   * `(testCaseId, path)` pair is present in the map, the corresponding
   * violation is recorded as a `warning`-severity decision rather than a
   * blocking `error`, the per-case decision is downgraded from `blocked` to
   * `needs_review`, and the violation `rule` is annotated with `:overridden`.
   * The validation report is preserved unchanged so audit history retains
   * the original finding.
   */
  semanticContentOverrides?: SemanticContentOverrideMap;
  /** Recognized custom supporting-context attributes that escalate risk. */
  customContextPolicySignals?: readonly CustomContextPolicySignal[];
  /**
   * Documented visual-sidecar refusal (Issue #1772). When the visual sidecar
   * dispatch exhausts both primary and fallback deployments (or otherwise
   * refuses to produce screen descriptions), the production runner records
   * the `VisualSidecarFailureClass` here. The gate then emits a per-case
   * `policy:visual-sidecar-refused` violation at warning severity, escalating
   * every test case to `needs_review` with a documented refusal code so
   * reviewers can adjudicate without the visual context.
   *
   * Pre-flight failure classes (caller errors such as `image_payload_too_large`
   * or `empty_screen_capture_set`) are NOT routed here — those still fail
   * the runner fast.
   */
  visualSidecarRefusal?: {
    failureClass: VisualSidecarFailureClass;
    failureMessage: string;
  };
}

/** Maximum strength among per-case decisions: blocked > needs_review > approved. */
const decisionRank: Record<TestCasePolicyDecision, number> = {
  approved: 0,
  needs_review: 1,
  blocked: 2,
};

const MULTI_SOURCE_CONFLICT_CASE_REASON_RE =
  /^multi-source conflict(?:\(s\))? (?<ids>.+) affect this case$/u;
const MULTI_SOURCE_CONFLICT_JOB_REASON_RE =
  /^multi-source conflict artifact present: (?<ids>.+)$/u;

const escalate = (
  current: TestCasePolicyDecision,
  candidate: TestCasePolicyDecision,
): TestCasePolicyDecision => {
  return decisionRank[candidate] > decisionRank[current] ? candidate : current;
};

const parseMultiSourceConflictIds = (
  reason: string,
): string[] | undefined => {
  const match =
    reason.match(MULTI_SOURCE_CONFLICT_CASE_REASON_RE) ??
    reason.match(MULTI_SOURCE_CONFLICT_JOB_REASON_RE);
  const ids = match?.groups?.ids;
  if (ids === undefined) return undefined;
  const values = ids
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return values.length > 0 ? values : undefined;
};

const sortedUnique = <T extends string>(values: readonly T[]): T[] =>
  Array.from(new Set(values)).sort();

const VALIDATION_ISSUE_TO_OUTCOME: Partial<
  Record<TestCaseValidationIssueCode, TestCasePolicyOutcome>
> = {
  schema_invalid: "schema_invalid",
  missing_trace: "missing_trace",
  trace_screen_unknown: "missing_trace",
  missing_expected_results: "missing_expected_results",
  test_data_pii_detected: "pii_in_test_data",
  preconditions_pii_detected: "pii_in_test_data",
  expected_results_pii_detected: "pii_in_test_data",
  test_data_unredacted_value: "pii_in_test_data",
  qc_mapping_blocking_reasons_missing: "qc_mapping_not_exportable",
  qc_mapping_exportable_inconsistent: "qc_mapping_not_exportable",
  duplicate_test_case_id: "duplicate_test_case",
  ambiguity_without_review_state: "ambiguity_review_required",
  open_questions_excessive: "open_questions_review_required",
  assumptions_excessive: "open_questions_review_required",
  semantic_suspicious_content: "semantic_suspicious_content",
};

const indexValidationByTestCase = (
  report: TestCaseValidationReport,
): Map<string, TestCaseValidationIssue[]> => {
  const out = new Map<string, TestCaseValidationIssue[]>();
  for (const issue of report.issues) {
    const id = issue.testCaseId;
    if (id === undefined) continue;
    const existing = out.get(id);
    if (existing === undefined) {
      out.set(id, [issue]);
    } else {
      existing.push(issue);
    }
  }
  return out;
};

const violationFromIssue = (
  issue: TestCaseValidationIssue,
  overridden: boolean,
): TestCasePolicyViolation | null => {
  const outcome = VALIDATION_ISSUE_TO_OUTCOME[issue.code];
  if (outcome === undefined) return null;
  const baseRule = `validation:${issue.code}`;
  const violation: TestCasePolicyViolation = {
    rule: overridden ? `${baseRule}:overridden` : baseRule,
    outcome,
    severity: overridden ? "warning" : issue.severity,
    reason: overridden
      ? `${issue.message} (reviewer override active)`
      : issue.message,
    path: issue.path,
  };
  return violation;
};

const isSemanticOverrideActive = (
  issue: TestCaseValidationIssue,
  overrides: SemanticContentOverrideMap | undefined,
): boolean => {
  if (overrides === undefined) return false;
  if (issue.code !== "semantic_suspicious_content") return false;
  const id = issue.testCaseId;
  if (id === undefined) return false;
  const paths = overrides.get(id);
  if (paths === undefined) return false;
  return paths.has(issue.path);
};

const evaluateCase = (
  testCase: GeneratedTestCase,
  intent: BusinessTestIntentIr,
  profile: TestCasePolicyProfile,
  caseIssues: TestCaseValidationIssue[],
  overrides: SemanticContentOverrideMap | undefined,
  customContextPolicySignals: readonly CustomContextPolicySignal[],
  visualSidecarRefusal: EvaluatePolicyGateInput["visualSidecarRefusal"],
): TestCasePolicyDecisionRecord => {
  let decision: TestCasePolicyDecision = "approved";
  const violations: TestCasePolicyViolation[] = [];

  if (visualSidecarRefusal !== undefined) {
    violations.push({
      rule: "policy:visual-sidecar-refused",
      outcome: "visual_sidecar_failure",
      severity: "warning",
      reason: `visual sidecar refused: ${visualSidecarRefusal.failureClass}: ${visualSidecarRefusal.failureMessage}`,
    });
    decision = escalate(decision, "needs_review");
  }

  for (const issue of caseIssues) {
    const overridden = isSemanticOverrideActive(issue, overrides);
    const v = violationFromIssue(issue, overridden);
    if (v === null) continue;
    violations.push(v);
    decision = escalate(
      decision,
      v.severity === "error" ? "blocked" : "needs_review",
    );
  }

  const intentReviewRisk = findIntentReviewRisk(intent, profile);
  const customContextReviewRisk = findCustomContextReviewRisk(
    customContextPolicySignals,
    profile,
  );
  const caseCarriesReviewRisk = profile.rules.reviewOnlyRiskCategories.includes(
    testCase.riskCategory,
  );
  const caseConflictIds = collectMultiSourceConflictIds(intent, testCase);

  // Risk-tag downgrade detection (Issue #1412): cross-reference the case's
  // declared `riskCategory` against the classification derivable from the
  // Business Test Intent IR for the screens referenced in the case's
  // `figmaTraceRefs`. When the intent classifies the screen as review-only
  // but the case declares a non-review category, this is a defense-in-depth
  // signal that an out-of-band caller may have submitted a forged low-risk
  // tag. Per-case violation is `warning` so the case escalates to
  // `needs_review` (the issue's specified posture); the matching job-level
  // violation is emitted in `evaluateJobLevel`.
  const enforceDowngrade =
    profile.rules.enforceRiskTagDowngradeDetection ?? true;
  const screenIntentRisk = enforceDowngrade
    ? deriveScreenIntentRisk(intent, testCase, profile)
    : undefined;
  if (
    enforceDowngrade &&
    screenIntentRisk !== undefined &&
    !caseCarriesReviewRisk
  ) {
    const screenIds = collectCaseScreenIds(testCase);
    violations.push({
      rule: "policy:risk-tag-downgrade-detected",
      outcome: "risk_tag_downgrade_detected",
      severity: "warning",
      reason: `case-level riskCategory "${testCase.riskCategory}" is below intent-derived classification "${screenIntentRisk}" for screen(s) ${formatScreenList(screenIds)}; treating as needs_review`,
    });
    decision = escalate(decision, "needs_review");
  }

  if (caseConflictIds.length > 0) {
    violations.push({
      rule: "policy:multi-source-conflict-present",
      outcome: "multi_source_conflict_present",
      severity: "warning",
      reason: `multi-source conflict(s) ${caseConflictIds.join(", ")} affect this case`,
    });
    decision = escalate(decision, "needs_review");
  }

  // Regulated risk → review even when no other findings. Intent-derived
  // regulated risk is treated as authoritative so a forged low case tag cannot
  // downgrade a regulated design flow.
  const riskCategory = caseCarriesReviewRisk
    ? testCase.riskCategory
    : (customContextReviewRisk ?? intentReviewRisk);
  if (riskCategory !== undefined) {
    violations.push({
      rule: "policy:regulated-risk-requires-review",
      outcome: "regulated_risk_review_required",
      severity: "warning",
      reason: `risk category "${riskCategory}" requires manual review under profile "${profile.id}"`,
    });
    decision = escalate(decision, "needs_review");
  }

  for (const signal of customContextPolicySignals) {
    if (!profile.rules.reviewOnlyRiskCategories.includes(signal.riskCategory)) {
      continue;
    }
    violations.push({
      rule: "policy:custom-context-risk-escalation",
      outcome: "custom_context_risk_escalation",
      severity: "warning",
      reason: signal.reason,
    });
    decision = escalate(decision, "needs_review");
  }

  // Ambiguity (independent of review state — covered above only when
  // mismatched, but a clean ambiguity note still requires review).
  if (testCase.qualitySignals.ambiguity !== undefined) {
    violations.push({
      rule: "policy:ambiguity-requires-review",
      outcome: "ambiguity_review_required",
      severity: "warning",
      reason: `case carries ambiguity note: ${testCase.qualitySignals.ambiguity.reason}`,
    });
    decision = escalate(decision, "needs_review");
  }

  // Low confidence → review.
  if (
    testCase.qualitySignals.confidence < profile.rules.minConfidence &&
    testCase.qualitySignals.confidence >= 0
  ) {
    violations.push({
      rule: "policy:low-confidence-requires-review",
      outcome: "low_confidence_review_required",
      severity: "warning",
      reason: `confidence ${testCase.qualitySignals.confidence} is below profile minimum ${profile.rules.minConfidence}`,
    });
    decision = escalate(decision, "needs_review");
  }

  // QC mapping not exportable → block.
  if (!testCase.qcMappingPreview.exportable) {
    violations.push({
      rule: "policy:qc-mapping-must-be-exportable",
      outcome: "qc_mapping_not_exportable",
      severity: "error",
      reason: "qcMappingPreview.exportable=false; case cannot reach export",
    });
    decision = escalate(decision, "blocked");
  }

  // Open questions / assumptions thresholds.
  if (testCase.openQuestions.length > profile.rules.maxOpenQuestionsPerCase) {
    violations.push({
      rule: "policy:open-questions-soft-cap",
      outcome: "open_questions_review_required",
      severity: "warning",
      reason: `openQuestions length ${testCase.openQuestions.length} exceeds profile cap ${profile.rules.maxOpenQuestionsPerCase}`,
    });
    decision = escalate(decision, "needs_review");
  }
  if (testCase.assumptions.length > profile.rules.maxAssumptionsPerCase) {
    violations.push({
      rule: "policy:assumptions-soft-cap",
      outcome: "open_questions_review_required",
      severity: "warning",
      reason: `assumptions length ${testCase.assumptions.length} exceeds profile cap ${profile.rules.maxAssumptionsPerCase}`,
    });
    decision = escalate(decision, "needs_review");
  }

  return {
    testCaseId: testCase.id,
    decision,
    violations,
  };
};

const collectCaseScreenIds = (testCase: GeneratedTestCase): Set<string> => {
  const ids = new Set<string>();
  for (const ref of testCase.figmaTraceRefs) {
    if (ref.screenId.length > 0) ids.add(ref.screenId);
  }
  return ids;
};

const formatScreenList = (screenIds: ReadonlySet<string>): string => {
  if (screenIds.size === 0) return "<none>";
  return [...screenIds]
    .sort()
    .map((id) => `"${id}"`)
    .join(", ");
};

/**
 * Derive the effective intent-IR risk classification for the screens that a
 * given test case references via its `figmaTraceRefs`. Issue #1412
 * defense-in-depth: PII indicators with a `screenId` are filtered to the
 * case's screens; PII indicators without a `screenId` are treated as global
 * (fail-closed). Top-level `intent.risks` strings are evaluated globally
 * because the IR does not yet model per-screen risk strings.
 *
 * Returns the strongest review-only risk derivable from the intent, or
 * `undefined` when no review-only category applies. Severity ordering
 * mirrors `findIntentReviewRisk` so the two helpers stay consistent.
 */
const deriveScreenIntentRisk = (
  intent: BusinessTestIntentIr,
  testCase: GeneratedTestCase,
  profile: TestCasePolicyProfile,
): TestCaseRiskCategory | undefined => {
  const caseScreenIds = collectCaseScreenIds(testCase);
  return findIntentReviewRiskForIndicators(intent, profile, (indicator) => {
    if (indicator.screenId === undefined) return true;
    return caseScreenIds.has(indicator.screenId);
  });
};

const findIntentReviewRiskForIndicators = (
  intent: BusinessTestIntentIr,
  profile: TestCasePolicyProfile,
  piiApplies: (
    indicator: BusinessTestIntentIr["piiIndicators"][number],
  ) => boolean,
): TestCaseRiskCategory | undefined => {
  const reviewSet = new Set(profile.rules.reviewOnlyRiskCategories);
  const normalizedRisks = intent.risks.map((risk) => risk.toLowerCase());

  for (const category of profile.rules.reviewOnlyRiskCategories) {
    if (normalizedRisks.includes(category)) return category;
  }

  if (
    intent.piiIndicators.some((indicator) => piiApplies(indicator)) &&
    reviewSet.has("regulated_data")
  ) {
    return "regulated_data";
  }
  if (
    normalizedRisks.some((risk) => /regulated|pii|personal.?data/.test(risk)) &&
    reviewSet.has("regulated_data")
  ) {
    return "regulated_data";
  }
  if (
    normalizedRisks.some((risk) =>
      /financial|payment|iban|transaction/.test(risk),
    ) &&
    reviewSet.has("financial_transaction")
  ) {
    return "financial_transaction";
  }
  return undefined;
};

const findIntentReviewRisk = (
  intent: BusinessTestIntentIr,
  profile: TestCasePolicyProfile,
): GeneratedTestCase["riskCategory"] | undefined => {
  return findIntentReviewRiskForIndicators(intent, profile, () => true);
};

const findCustomContextReviewRisk = (
  signals: readonly CustomContextPolicySignal[],
  profile: TestCasePolicyProfile,
): TestCaseRiskCategory | undefined => {
  const reviewSet = new Set(profile.rules.reviewOnlyRiskCategories);
  for (const signal of signals) {
    if (reviewSet.has(signal.riskCategory)) return signal.riskCategory;
  }
  return undefined;
};

const collectMultiSourceConflictIds = (
  intent: BusinessTestIntentIr,
  testCase: GeneratedTestCase,
): string[] => {
  const conflicts = intent.multiSourceConflicts ?? [];
  if (conflicts.length === 0) return [];
  const screenIds = collectCaseScreenIds(testCase);
  const coveredIds = new Set<string>([
    ...testCase.qualitySignals.coveredFieldIds,
    ...testCase.qualitySignals.coveredActionIds,
    ...testCase.qualitySignals.coveredValidationIds,
    ...testCase.qualitySignals.coveredNavigationIds,
  ]);
  return conflicts
    .filter((conflict) => {
      if (
        conflict.affectedElementIds?.some((elementId) => coveredIds.has(elementId))
      ) {
        return true;
      }
      if (
        conflict.affectedScreenIds?.some((screenId) => screenIds.has(screenId))
      ) {
        return true;
      }
      return conflict.affectedElementIds === undefined && conflict.affectedScreenIds === undefined;
    })
    .map((conflict) => conflict.conflictId)
    .sort();
};

const evaluateJobLevel = (
  list: GeneratedTestCaseList,
  intent: BusinessTestIntentIr,
  coverage: TestCaseCoverageReport,
  profile: TestCasePolicyProfile,
  visual?: VisualSidecarValidationReport,
  customContextPolicySignals: readonly CustomContextPolicySignal[] = [],
  visualSidecarRefusal?: EvaluatePolicyGateInput["visualSidecarRefusal"],
): TestCasePolicyViolation[] => {
  const violations: TestCasePolicyViolation[] = [];

  if (visualSidecarRefusal !== undefined) {
    violations.push({
      rule: "policy:visual-sidecar-refused",
      outcome: "visual_sidecar_failure",
      severity: "warning",
      reason: `visual sidecar refused: ${visualSidecarRefusal.failureClass}: ${visualSidecarRefusal.failureMessage}`,
    });
  }

  // Required-field coverage: each detected validation rule needs at least
  // one case of type=negative or type=validation that lists the rule's
  // target field id. Profile flag may turn the check off.
  if (profile.rules.requireNegativeOrValidationForValidationRules) {
    const validationRules = intent.detectedValidations;
    for (const rule of validationRules) {
      if (rule.targetFieldId === undefined) continue;
      const hasCovering = list.testCases.some((tc) => {
        if (tc.type !== "negative" && tc.type !== "validation") return false;
        if (
          tc.qualitySignals.coveredValidationIds.includes(rule.id) ||
          tc.qualitySignals.coveredFieldIds.includes(rule.targetFieldId ?? "")
        ) {
          return true;
        }
        return false;
      });
      if (!hasCovering) {
        violations.push({
          rule: "policy:required-field-needs-negative-or-validation",
          outcome: "missing_negative_or_validation_for_required_field",
          severity: "error",
          reason: `validation rule "${rule.id}" (field ${rule.targetFieldId ?? "<unknown>"}) has no covering negative/validation test case`,
        });
      }
    }
  }

  // Required-field boundary coverage.
  if (profile.rules.requireBoundaryCaseForRequiredFields) {
    const fieldIdsWithRequiredRules = new Set<string>();
    for (const v of intent.detectedValidations) {
      if (v.targetFieldId !== undefined && /required/i.test(v.rule)) {
        fieldIdsWithRequiredRules.add(v.targetFieldId);
      }
    }
    for (const fieldId of fieldIdsWithRequiredRules) {
      const hasBoundary = list.testCases.some(
        (tc) =>
          tc.type === "boundary" &&
          tc.qualitySignals.coveredFieldIds.includes(fieldId),
      );
      if (!hasBoundary) {
        violations.push({
          rule: "policy:required-field-needs-boundary-case",
          outcome: "missing_boundary_case",
          severity: "warning",
          reason: `required field "${fieldId}" has no covering boundary test case`,
        });
      }
    }
  }

  // Accessibility coverage when form fields are present.
  if (profile.rules.requireAccessibilityCaseWhenFormPresent) {
    const screensWithFields = new Set(
      intent.detectedFields.map((f) => f.screenId),
    );
    for (const screenId of screensWithFields) {
      const hasA11yCase = list.testCases.some(
        (tc) =>
          tc.type === "accessibility" &&
          tc.figmaTraceRefs.some((r) => r.screenId === screenId),
      );
      if (!hasA11yCase) {
        violations.push({
          rule: "policy:form-screen-needs-accessibility-case",
          outcome: "missing_accessibility_case",
          severity: "error",
          reason: `screen "${screenId}" carries form fields but has no covering accessibility test case`,
        });
      }
    }
  }

  // Duplicate fingerprint — coverage reports the pairs; the gate downgrades.
  for (const pair of coverage.duplicatePairs) {
    violations.push({
      rule: "policy:duplicate-test-case",
      outcome: "duplicate_test_case",
      severity: "warning",
      reason: `test cases "${pair.leftTestCaseId}" and "${pair.rightTestCaseId}" share similarity ${pair.similarity}; review for de-duplication`,
    });
  }

  const globalConflictIds = sortedUnique(
    (intent.multiSourceConflicts ?? []).map((conflict) => conflict.conflictId),
  );
  if (globalConflictIds.length > 0) {
    violations.push({
      rule: "policy:multi-source-conflict-present",
      outcome: "multi_source_conflict_present",
      severity: "warning",
      reason: `multi-source conflict artifact present: ${globalConflictIds.join(", ")}`,
    });
  }

  // Risk-tag downgrade detection (Issue #1412): emit a deduplicated set of
  // job-level violations describing the per-case drift between the declared
  // `riskCategory` and the intent-derived classification for the case's
  // screens. The per-case violation is already emitted by `evaluateCase`; the
  // job-level entries provide a stable audit summary keyed by `(testCaseId,
  // intentRisk, declaredRisk)` so review tooling can list the offenders
  // without scanning every decision row.
  if (profile.rules.enforceRiskTagDowngradeDetection ?? true) {
    const reviewSet = new Set(profile.rules.reviewOnlyRiskCategories);
    const seen = new Set<string>();
    for (const tc of list.testCases) {
      const intentRisk = deriveScreenIntentRisk(intent, tc, profile);
      if (intentRisk === undefined) continue;
      if (reviewSet.has(tc.riskCategory)) continue;
      const key = JSON.stringify([tc.id, intentRisk, tc.riskCategory]);
      if (seen.has(key)) continue;
      seen.add(key);
      const screenIds = collectCaseScreenIds(tc);
      violations.push({
        rule: "policy:risk-tag-downgrade-detected",
        outcome: "risk_tag_downgrade_detected",
        severity: "warning",
        reason: `case "${tc.id}" declared riskCategory "${tc.riskCategory}" but intent IR derives "${intentRisk}" for screen(s) ${formatScreenList(screenIds)}`,
      });
    }
  }

  // Visual-sidecar outcomes lift to job-level policy outcomes.
  if (visual !== undefined) {
    for (const record of visual.records) {
      for (const outcome of record.outcomes) {
        const mapped = mapVisualOutcome(outcome);
        if (mapped === null) continue;
        violations.push({
          rule: `policy:visual-sidecar:${outcome}`,
          outcome: mapped.outcome,
          severity: mapped.severity,
          reason: `screen "${record.screenId}" (${record.deployment}): ${outcome}`,
        });
      }
    }
  }

  for (const signal of customContextPolicySignals) {
    if (!profile.rules.reviewOnlyRiskCategories.includes(signal.riskCategory)) {
      continue;
    }
    violations.push({
      rule: "policy:custom-context-risk-escalation",
      outcome: "custom_context_risk_escalation",
      severity: "warning",
      reason: `${signal.reason} (source ${signal.sourceId}, entry ${signal.entryId}, hash ${signal.contentHash})`,
    });
  }

  return violations;
};

const mapVisualOutcome = (
  outcome:
    | "ok"
    | "schema_invalid"
    | "low_confidence"
    | "fallback_used"
    | "possible_pii"
    | "prompt_injection_like_text"
    | "conflicts_with_figma_metadata"
    | "primary_unavailable",
): { outcome: TestCasePolicyOutcome; severity: "error" | "warning" } | null => {
  switch (outcome) {
    case "ok":
      return null;
    case "schema_invalid":
    case "conflicts_with_figma_metadata":
      return { outcome: "visual_sidecar_failure", severity: "error" };
    case "fallback_used":
    case "primary_unavailable":
      return { outcome: "visual_sidecar_fallback_used", severity: "warning" };
    case "low_confidence":
      return { outcome: "visual_sidecar_low_confidence", severity: "warning" };
    case "possible_pii":
      return { outcome: "visual_sidecar_possible_pii", severity: "error" };
    case "prompt_injection_like_text":
      return {
        outcome: "visual_sidecar_prompt_injection_text",
        severity: "error",
      };
  }
};

/**
 * Run the policy gate and produce the persistable
 * `TestCasePolicyReport` artifact.
 */
export const evaluatePolicyGate = (
  input: EvaluatePolicyGateInput,
): TestCasePolicyReport => {
  const semanticContentOverrides =
    input.semanticContentOverrides === undefined
      ? undefined
      : filterSemanticContentOverridesForValidation(
          input.validation,
          input.semanticContentOverrides,
        );
  const validationByCase = indexValidationByTestCase(input.validation);
  const decisions: TestCasePolicyDecisionRecord[] = [];

  for (const tc of input.list.testCases) {
    const issues = validationByCase.get(tc.id) ?? [];
    decisions.push(
      evaluateCase(
        tc,
        input.intent,
        input.profile,
        issues,
        semanticContentOverrides,
        input.customContextPolicySignals ?? [],
        input.visualSidecarRefusal,
      ),
    );
  }

  const jobLevelViolations = evaluateJobLevel(
    input.list,
    input.intent,
    input.coverage,
    input.profile,
    input.visual,
    input.customContextPolicySignals ?? [],
    input.visualSidecarRefusal,
  );

  // Job-level violations of error severity propagate as job-level
  // blocking; per-case decisions remain unchanged so review tooling can
  // see the per-case story.
  let jobBlocked = decisions.some((d) => d.decision === "blocked");
  if (!jobBlocked) {
    jobBlocked = jobLevelViolations.some((v) => v.severity === "error");
  }

  let approved = 0;
  let blocked = 0;
  let needsReview = 0;
  for (const d of decisions) {
    if (d.decision === "approved") approved += 1;
    else if (d.decision === "blocked") blocked += 1;
    else needsReview += 1;
  }

  return {
    schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    policyProfileId: input.profile.id,
    policyProfileVersion: input.profile.version,
    totalTestCases: input.list.testCases.length,
    approvedCount: approved,
    blockedCount: blocked,
    needsReviewCount: needsReview,
    blocked: jobBlocked,
    decisions,
    jobLevelViolations,
  };
};

export const pruneResolvedMultiSourceConflictViolations = (
  input: {
    report: TestCasePolicyReport;
    isConflictResolved: (conflictId: string) => boolean;
  },
): TestCasePolicyReport => {
  const rewriteViolations = (
    violations: readonly TestCasePolicyViolation[],
    kind: "case" | "job",
  ): TestCasePolicyViolation[] => {
    const out: TestCasePolicyViolation[] = [];
    for (const violation of violations) {
      if (violation.outcome !== "multi_source_conflict_present") {
        out.push(violation);
        continue;
      }
      const conflictIds = parseMultiSourceConflictIds(violation.reason);
      if (conflictIds === undefined) {
        out.push(violation);
        continue;
      }
      const unresolvedConflictIds = conflictIds.filter(
        (conflictId) => !input.isConflictResolved(conflictId),
      );
      if (unresolvedConflictIds.length === 0) {
        continue;
      }
      const rewrittenReason =
        kind === "case"
          ? `multi-source conflict(s) ${unresolvedConflictIds.join(", ")} affect this case`
          : `multi-source conflict artifact present: ${unresolvedConflictIds.join(", ")}`;
      out.push({
        ...violation,
        reason: rewrittenReason,
      });
    }
    return out;
  };

  const decisions: TestCasePolicyDecisionRecord[] = [];
  let approvedCount = 0;
  let blockedCount = 0;
  let needsReviewCount = 0;

  for (const decision of input.report.decisions) {
    const violations = rewriteViolations(decision.violations, "case");
    let nextDecision: TestCasePolicyDecision = "approved";
    for (const violation of violations) {
      nextDecision = escalate(
        nextDecision,
        violation.severity === "error" ? "blocked" : "needs_review",
      );
    }
    decisions.push({
      ...decision,
      decision: nextDecision,
      violations,
    });
    if (nextDecision === "approved") approvedCount += 1;
    else if (nextDecision === "blocked") blockedCount += 1;
    else needsReviewCount += 1;
  }

  const jobLevelViolations = rewriteViolations(
    input.report.jobLevelViolations,
    "job",
  );
  const blocked =
    decisions.some((decision) => decision.decision === "blocked") ||
    jobLevelViolations.some((violation) => violation.severity === "error");

  return {
    ...input.report,
    approvedCount,
    blockedCount,
    needsReviewCount,
    blocked,
    decisions,
    jobLevelViolations,
  };
};
