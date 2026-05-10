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
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type ActiveModelBinding,
  type A11yVerdict,
  type BusinessTestIntentIr,
  type CoveragePlan,
  type CustomContextPolicySignal,
  type FaithfulnessEvaluationSummary,
  type FaithfulnessTierReport,
  type FaithfulnessVerdict,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type JudgeRefusalPolicy,
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
import { buildFaithfulnessTierReport } from "./faithfulness-tier-report.js";
import {
  FORM_SCREEN_A11Y_REQUIRED_CRITERIA,
  listCoveredFormScreenA11yCriteria,
} from "./a11y-coverage-eval.js";
import {
  buildCoverageDriftPolicyViolation,
  type CoverageBaselineDriftEvaluation,
} from "./coverage-baseline-drift.js";
import {
  partitionSemanticContentOverridesForValidation,
  type InvalidSemanticContentOverrideMap,
  type OverrideAuthorityProvider,
  type SemanticContentOverrideMap,
} from "./semantic-content-sanitization.js";
import { collectUncoveredP0Elements } from "./p0-risk-coverage.js";
import { collectTechniqueQuotaDeficits } from "./technique-quota.js";
import type { UntrustedContentNormalizationReport } from "./untrusted-content-normalizer.js";

export interface EvaluatePolicyGateInput {
  jobId: string;
  generatedAt: string;
  list: GeneratedTestCaseList;
  intent: BusinessTestIntentIr;
  profile: TestCasePolicyProfile;
  validation: TestCaseValidationReport;
  coverage: TestCaseCoverageReport;
  coveragePlan?: CoveragePlan;
  visual?: VisualSidecarValidationReport;
  a11yVerdict?: A11yVerdict;
  policyOverrides?: ReadonlyArray<{
    ruleId: string;
    severity: "error" | "warning";
    threshold?: number;
  }>;
  faithfulnessVerdict?: FaithfulnessVerdict;
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
  /**
   * Caller-supplied authority provider used to verify signed semantic
   * content overrides before the policy gate may honor them.
   */
  overrideAuthorityProvider?: OverrideAuthorityProvider;
  /** Recognized custom supporting-context attributes that escalate risk. */
  customContextPolicySignals?: readonly CustomContextPolicySignal[];
  /**
   * Documented visual-sidecar refusal (Issue #1772). When the visual sidecar
   * dispatch exhausts both primary and fallback deployments (or otherwise
   * refuses to produce screen descriptions), the production runner records
   * the `VisualSidecarFailureClass` here. Issue #2069 splits the outcomes:
   * `both_sidecars_failed` now emits a blocking job-level
   * `policy:visual-sidecar:both_failed` error, while successful fallback
   * recovery remains informational under
   * `policy:visual-sidecar:fallback_used`. The gate only escalates per-case
   * decisions when the run explicitly marks visual verification as required.
   *
   * Pre-flight failure classes (caller errors such as `image_payload_too_large`
   * or `empty_screen_capture_set`) are NOT routed here — those still fail
   * the runner fast.
   */
  visualSidecarRefusal?: {
    failureClass: VisualSidecarFailureClass;
    failureMessage: string;
  };
  /** When true, visual-sidecar refusal is applied to each case decision. */
  visualVerificationRequired?: boolean;
  /** Optional pre-LLM untrusted-content normalization outcome. */
  untrustedContentReport?: UntrustedContentNormalizationReport;
  /**
   * Optional summary of the active model bindings used by the job. When
   * supplied under `eu-banking-default`, every binding must carry an
   * operator-managed `ictRegisterRef`.
   */
  activeModelBindings?: readonly ActiveModelBinding[];
  /**
   * Optional runtime coverage-baseline drift evaluation (Issue #1950).
   * When the evaluation reports `exceeded === true`, the gate emits a
   * job-level `policy:coverage-drift-exceeded` violation at warning
   * severity. The decision class is `needs_review` — operator-actionable
   * but not auto-blocking, so a single bad day cannot brick production.
   *
   * The runtime store and `--coverage-baseline-update` CLI flag are
   * documented in `docs/runbooks/coverage-baseline-rebaseline.md`.
   */
  coverageBaselineDrift?: CoverageBaselineDriftEvaluation;
  /**
   * Optional fixture- or screen-scoped compliance overrides
   * (Issue #2030 follow-up, K0-measurement-driven).
   *
   * The Eingabemasken K0 measurement showed that the policy gate is
   * blind to MiFID II / GwG-Section-43 / FATCA / EAA / DORA regulatory
   * context unless the field-level PII detector picks it up by literal
   * pattern (IBAN, tax-id, email, phone). Realistic banking masks like
   * a MiFID-II securities order, a BU health questionnaire, or an
   * EAA-A11y-variant carry no PII pattern at the field-label level
   * even though they ARE regulated. Without this hook the gate emits
   * zero `policy:regulated-risk-requires-review` warnings on those
   * masks.
   *
   * Each override declares the regulated risk classification a fixture
   * (or a specific screen within a fixture) should take when the
   * intent-derived classification chain returns `undefined`. Overrides
   * NEVER weaken an already-derived classification; they only act as a
   * fallback floor when nothing else fires.
   *
   * The override values come from the per-fixture compliance sidecar
   * (`<fixtureId>.compliance.json` `regulatedRiskOverride` field) and
   * are surfaced on the violation's `reason` so auditors can trace the
   * elevation back to the regulation pack.
   */
  complianceOverrides?: ReadonlyArray<ComplianceRiskOverride>;
}

/**
 * Compliance-sidecar-derived screen-level risk override
 * (Issue #2030 follow-up). When `screenId` is `undefined` the override
 * applies job-wide; otherwise it applies only to test cases whose
 * `figmaTraceRefs` cover the named screen.
 */
export interface ComplianceRiskOverride {
  screenId?: string;
  riskCategory: TestCaseRiskCategory;
  /** Optional human-readable rationale; surfaced in policy reasons. */
  rationale?: string;
}

export const CROSS_MODAL_FAITHFULNESS_RULE =
  "policy:cross-modal-faithfulness-score" as const;
export const CROSS_MODAL_FAITHFULNESS_MISSING_RULE =
  "policy:cross-modal-faithfulness:evaluation-missing" as const;
export const DEFAULT_CROSS_MODAL_FAITHFULNESS_THRESHOLD = 0.8;
const CROSS_MODAL_FAITHFULNESS_GRAY_ZONE = 0.05;

/** Issue #2116 — job-level rule id raised when the cross-modal-faithfulness
 * gate fell back to the verdict's case-level `score` because the verdict
 * carried no `stepVerdicts`. Severity is `warning` by default and
 * escalates to `error` when the active profile sets
 * `requirePerStepFaithfulness: true`.
 *
 * The companion `policy:cross-modal-faithfulness:evaluation-missing`
 * rule is raised when no verdict was supplied at all. Refusals still
 * flow through `policy:judge_refused` so operators retain their
 * existing tunable severity policy for provider-side refusals. */
export const CROSS_MODAL_FAITHFULNESS_FALLBACK_RULE =
  "policy:cross-modal-faithfulness:case-level-fallback" as const;

/**
 * Resolve the per-run {@link FaithfulnessTierReport} that the
 * cross-modal-faithfulness gate consulted (Issue #2066). Returns
 * `undefined` when the verdict is missing, refused, or carries no
 * `stepVerdicts` (legacy schema 1.0.0 — the gate falls back to the
 * verdict's case-level `score`).
 *
 * Pure: callers persist the artifact via `writeFaithfulnessTierReport`.
 */
export const resolveFaithfulnessTierReport = (
  verdict: FaithfulnessVerdict | undefined,
  list: GeneratedTestCaseList,
  policyOverrides: EvaluatePolicyGateInput["policyOverrides"],
): FaithfulnessTierReport | undefined => {
  if (verdict === undefined || verdict.refusal !== undefined) {
    return undefined;
  }
  if (verdict.stepVerdicts === undefined || verdict.stepVerdicts.length === 0) {
    return undefined;
  }
  const threshold =
    resolvePolicyThresholdOverride(
      policyOverrides,
      CROSS_MODAL_FAITHFULNESS_RULE,
    ) ?? DEFAULT_CROSS_MODAL_FAITHFULNESS_THRESHOLD;
  return buildFaithfulnessTierReport({
    generatedAt: verdict.generatedAt,
    jobId: verdict.jobId,
    verdict,
    list,
    aggregateThreshold: threshold,
  });
};

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

const severityToDecision = (
  severity: "error" | "warning" | "info",
): TestCasePolicyDecision => {
  switch (severity) {
    case "error":
      return "blocked";
    case "warning":
      return "needs_review";
    case "info":
      return "approved";
  }
};

const resolveVisualSidecarRefusalViolation = (
  visualSidecarRefusal: NonNullable<EvaluatePolicyGateInput["visualSidecarRefusal"]>,
): TestCasePolicyViolation => {
  if (visualSidecarRefusal.failureClass === "both_sidecars_failed") {
    return {
      rule: "policy:visual-sidecar:both_failed",
      outcome: "visual_sidecar_both_failed",
      severity: "error",
      reason:
        `visual sidecar refused: ${visualSidecarRefusal.failureClass}: ` +
        visualSidecarRefusal.failureMessage,
    };
  }
  return {
    rule: "policy:visual-sidecar-refused",
    outcome: "visual_sidecar_failure",
    severity: "warning",
    reason:
      `visual sidecar refused: ${visualSidecarRefusal.failureClass}: ` +
      visualSidecarRefusal.failureMessage,
  };
};

const resolveJudgeRefusalPolicy = (
  profile: TestCasePolicyProfile,
  judge: "faithfulness" | "a11y",
): JudgeRefusalPolicy =>
  profile.rules.judgeRefusalPolicy?.[judge] ?? "fail_open";

const judgeRefusalPolicyToSeverity = (
  policy: JudgeRefusalPolicy,
): "error" | "warning" | "info" => {
  switch (policy) {
    case "fail_closed":
      return "error";
    case "needs_review":
      return "warning";
    case "fail_open":
      return "info";
  }
};

const buildJudgeRefusalViolations = (
  profile: TestCasePolicyProfile,
  faithfulnessVerdict: FaithfulnessVerdict | undefined,
  a11yVerdict: A11yVerdict | undefined,
): {
  jobLevel: TestCasePolicyViolation[];
  caseLevel: TestCasePolicyViolation[];
} => {
  const jobLevel: TestCasePolicyViolation[] = [];
  const caseLevel: TestCasePolicyViolation[] = [];
  const judges = [
    ["faithfulness", faithfulnessVerdict],
    ["a11y", a11yVerdict],
  ] as const;
  for (const [judge, verdict] of judges) {
    const refusal = verdict?.refusal;
    if (refusal === undefined) continue;
    const policy = resolveJudgeRefusalPolicy(profile, judge);
    const violation: TestCasePolicyViolation = {
      rule: "policy:judge_refused",
      outcome: "judge_refused",
      severity: judgeRefusalPolicyToSeverity(policy),
      reason:
        `${judge} judge refused under ${policy}: ` +
        `${refusal.code}: ${refusal.message}`,
      path: `$.${judge}Verdict.refusal`,
    };
    jobLevel.push(violation);
    if (policy === "needs_review") {
      caseLevel.push(violation);
    }
  }
  return { jobLevel, caseLevel };
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

const formatModelBindingIdentity = (binding: ActiveModelBinding): string => {
  const deployment =
    binding.inferenceProfileId !== undefined
      ? `@${binding.inferenceProfileId}`
      : "";
  return `${binding.providerId}/${binding.modelId}${deployment}`;
};

const evaluateActiveModelBindings = (
  profile: TestCasePolicyProfile,
  activeModelBindings: readonly ActiveModelBinding[] | undefined,
): TestCasePolicyViolation[] => {
  if (profile.id !== EU_BANKING_DEFAULT_POLICY_PROFILE_ID) {
    return [];
  }
  if (activeModelBindings === undefined || activeModelBindings.length === 0) {
    return [];
  }

  const missing = activeModelBindings.filter(
    (binding) => binding.ictRegisterRef === undefined,
  );
  if (missing.length === 0) {
    return [];
  }

  return [
    {
      rule: "policy:ict-register-ref-required",
      outcome: "ict_register_ref_required",
      severity: "error",
      reason:
        `refusal code ict_register_ref_required: active model binding(s) ` +
        `${missing.map(formatModelBindingIdentity).join(", ")} missing ictRegisterRef under profile "${profile.id}"`,
    },
  ];
};

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
  unsupported_unresolved_validation_detail: "open_questions_review_required",
  needs_open_question_clarification: "open_questions_review_required",
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

const invalidSemanticOverrideReason = (
  issue: TestCaseValidationIssue,
  invalidOverrides: InvalidSemanticContentOverrideMap | undefined,
): string | undefined => {
  if (issue.code !== "semantic_suspicious_content") return undefined;
  const id = issue.testCaseId;
  if (id === undefined) return undefined;
  return invalidOverrides?.get(id)?.get(issue.path);
};

const evaluateCase = (
  testCase: GeneratedTestCase,
  intent: BusinessTestIntentIr,
  profile: TestCasePolicyProfile,
  caseIssues: TestCaseValidationIssue[],
  overrides: SemanticContentOverrideMap | undefined,
  invalidOverrides: InvalidSemanticContentOverrideMap | undefined,
  customContextPolicySignals: readonly CustomContextPolicySignal[],
  visualSidecarRefusal: EvaluatePolicyGateInput["visualSidecarRefusal"],
  visualVerificationRequired: boolean,
  untrustedContentReport: UntrustedContentNormalizationReport | undefined,
  judgeRefusalViolations: readonly TestCasePolicyViolation[],
  faithfulnessViolation: TestCasePolicyViolation | undefined,
  complianceOverrides: ReadonlyArray<ComplianceRiskOverride> | undefined,
): TestCasePolicyDecisionRecord => {
  let decision: TestCasePolicyDecision = "approved";
  const violations: TestCasePolicyViolation[] = [];

  if (visualSidecarRefusal !== undefined && visualVerificationRequired) {
    const violation =
      resolveVisualSidecarRefusalViolation(visualSidecarRefusal);
    violations.push(violation);
    decision = escalate(decision, severityToDecision(violation.severity));
  }

  if (untrustedContentReport?.outcome === "needs_review") {
    violations.push({
      rule: "policy:untrusted-content-normalization",
      outcome: "ambiguity_review_required",
      severity: "warning",
      reason: summarizeUntrustedContentNeedsReview(untrustedContentReport),
    });
    decision = escalate(decision, "needs_review");
  }

  for (const violation of judgeRefusalViolations) {
    violations.push(violation);
    decision = escalate(decision, severityToDecision(violation.severity));
  }

  for (const issue of caseIssues) {
    const invalidOverride = invalidSemanticOverrideReason(issue, invalidOverrides);
    if (invalidOverride !== undefined) {
      violations.push({
        rule: "policy:override_invalid",
        outcome: "semantic_suspicious_content",
        severity: "error",
        reason: `semantic content override rejected: ${invalidOverride}`,
        path: issue.path,
      });
      decision = escalate(decision, "blocked");
    }
    const overridden = isSemanticOverrideActive(issue, overrides);
    const v = violationFromIssue(issue, overridden);
    if (v === null) continue;
    violations.push(v);
    decision = escalate(decision, severityToDecision(v.severity));
  }

  if (faithfulnessViolation !== undefined) {
    violations.push(faithfulnessViolation);
    decision = escalate(
      decision,
      severityToDecision(faithfulnessViolation.severity),
    );
  }

  const intentReviewRisk = findIntentReviewRisk(
    intent,
    profile,
    complianceOverrides,
  );
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
    ? deriveScreenIntentRisk(intent, testCase, profile, complianceOverrides)
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
  complianceOverrides?: ReadonlyArray<ComplianceRiskOverride>,
): TestCaseRiskCategory | undefined => {
  const caseScreenIds = collectCaseScreenIds(testCase);
  const intentRisk = findIntentReviewRiskForIndicators(
    intent,
    profile,
    (indicator) => {
      if (indicator.screenId === undefined) return true;
      return caseScreenIds.has(indicator.screenId);
    },
  );
  if (intentRisk !== undefined) return intentRisk;
  // Issue #2030 follow-up: when no intent-derived classification fires,
  // fall back to the compliance-sidecar override declared for any of the
  // case's screens (or job-wide). The override never WEAKENS an
  // already-derived classification.
  return resolveComplianceRiskOverride(
    caseScreenIds,
    complianceOverrides,
    profile,
  );
};

/**
 * Pick the strongest review-only compliance-override that applies to the
 * given screens. Returns `undefined` when no override matches or none of
 * the matching overrides carry a profile-recognized review-only category.
 *
 * Match rules:
 *   - `override.screenId === undefined`            -> applies job-wide
 *   - `override.screenId` ∈ `caseScreenIds`        -> applies to this case
 *
 * Strength rules: when multiple overrides match, the function returns the
 * first override whose `riskCategory` appears in the profile's
 * `reviewOnlyRiskCategories` list, in profile order. This keeps the
 * resolution deterministic and aligned with `findIntentReviewRiskForIndicators`.
 */
const resolveComplianceRiskOverride = (
  caseScreenIds: ReadonlySet<string>,
  overrides: ReadonlyArray<ComplianceRiskOverride> | undefined,
  profile: TestCasePolicyProfile,
): TestCaseRiskCategory | undefined => {
  if (overrides === undefined || overrides.length === 0) return undefined;
  const matching = overrides.filter(
    (o) =>
      o.screenId === undefined ||
      caseScreenIds.has(o.screenId),
  );
  if (matching.length === 0) return undefined;
  const matchedCategories = new Set(matching.map((o) => o.riskCategory));
  for (const category of profile.rules.reviewOnlyRiskCategories) {
    if (matchedCategories.has(category)) return category;
  }
  return undefined;
};

/**
 * Job-wide variant of {@link resolveComplianceRiskOverride}. Returns the
 * strongest review-only category declared by ANY override (regardless of
 * `screenId`), used by {@link findIntentReviewRisk} as a fallback when the
 * intent IR carries no PII / risk indicators on the whole job.
 */
const resolveJobWideComplianceRiskOverride = (
  overrides: ReadonlyArray<ComplianceRiskOverride> | undefined,
  profile: TestCasePolicyProfile,
): TestCaseRiskCategory | undefined => {
  if (overrides === undefined || overrides.length === 0) return undefined;
  const matchedCategories = new Set(overrides.map((o) => o.riskCategory));
  for (const category of profile.rules.reviewOnlyRiskCategories) {
    if (matchedCategories.has(category)) return category;
  }
  return undefined;
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
  complianceOverrides?: ReadonlyArray<ComplianceRiskOverride>,
): GeneratedTestCase["riskCategory"] | undefined => {
  const intentRisk = findIntentReviewRiskForIndicators(
    intent,
    profile,
    () => true,
  );
  if (intentRisk !== undefined) return intentRisk;
  // Issue #2030 follow-up: fall back to the compliance-sidecar
  // declarations for the whole job. This drives
  // `policy:regulated-risk-requires-review` on regulated masks
  // (MiFID II / GwG / FATCA / EAA) where no PII pattern fires.
  return resolveJobWideComplianceRiskOverride(complianceOverrides, profile);
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
  coveragePlan?: CoveragePlan,
  visual?: VisualSidecarValidationReport,
  customContextPolicySignals: readonly CustomContextPolicySignal[] = [],
  visualSidecarRefusal?: EvaluatePolicyGateInput["visualSidecarRefusal"],
  untrustedContentReport?: UntrustedContentNormalizationReport,
  activeModelBindings?: readonly ActiveModelBinding[],
  coverageBaselineDrift?: CoverageBaselineDriftEvaluation,
  a11yVerdict?: A11yVerdict,
  complianceOverrides?: ReadonlyArray<ComplianceRiskOverride>,
): TestCasePolicyViolation[] => {
  const violations = evaluateActiveModelBindings(profile, activeModelBindings);
  const formScreenIds = collectFormScreenIds(intent);

  const coverageDriftViolation =
    coverageBaselineDrift === undefined
      ? undefined
      : buildCoverageDriftPolicyViolation(coverageBaselineDrift);
  if (coverageDriftViolation !== undefined) {
    violations.push(coverageDriftViolation);
  }

  for (const deficit of collectTechniqueQuotaDeficits(
    list.testCases,
    coveragePlan,
    profile.rules.techniqueCoverageMinimum,
  )) {
    violations.push({
      rule: "policy:technique-coverage-minimum",
      outcome: "technique_quota_breach",
      severity: "error",
      reason:
        `screen "${deficit.screenId}" requires at least ${deficit.minCount} ` +
        `"${deficit.technique}" case(s) but only ${deficit.actual} are anchored to that screen`,
    });
  }

  for (const uncovered of collectUncoveredP0Elements(
    list.testCases,
    coveragePlan,
  )) {
    violations.push({
      rule: "policy:p0-risk-element-uncovered",
      outcome: "p0_risk_element_uncovered",
      severity: "error",
      reason:
        `p0 risk-class element "${uncovered.elementId}" (riskClass ` +
        `"${uncovered.riskClass}") on screen "${uncovered.screenId}" has no ` +
        `covering test case in qualitySignals.coveredFieldIds or coveredActionIds`,
    });
  }

  if (visualSidecarRefusal !== undefined) {
    violations.push(resolveVisualSidecarRefusalViolation(visualSidecarRefusal));
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
    for (const screenId of formScreenIds) {
      const coveredCriteria = collectCoveredFormScreenA11yCriteria(
        list,
        screenId,
      );
      if (coveredCriteria.length === 0) {
        violations.push({
          rule: "policy:form-screen-needs-accessibility-case",
          outcome: "missing_accessibility_case",
          severity: "error",
          reason: `screen "${screenId}" carries form fields but has no covering accessibility test case`,
        });
        continue;
      }
      const missingCriteria = FORM_SCREEN_A11Y_REQUIRED_CRITERIA.filter(
        (criterion) => !coveredCriteria.includes(criterion),
      );
      if (missingCriteria.length > 0) {
        violations.push({
          rule: "policy:form-screen-needs-accessibility-case",
          outcome: "missing_accessibility_case",
          severity: "error",
          reason:
            `screen "${screenId}" carries form fields but is missing ` +
            `accessibility coverage for ${missingCriteria.join(", ")}`,
        });
      }
    }
  }

  if (profile.rules.requireAccessibilityCaseWhenFormPresent) {
    violations.push(...evaluateA11yJudgeVerdict(formScreenIds, a11yVerdict));
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
      const intentRisk = deriveScreenIntentRisk(
        intent,
        tc,
        profile,
        complianceOverrides,
      );
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

  if (untrustedContentReport?.outcome === "needs_review") {
    violations.push({
      rule: "policy:untrusted-content-normalization",
      outcome: "ambiguity_review_required",
      severity: "warning",
      reason: summarizeUntrustedContentNeedsReview(untrustedContentReport),
    });
  }

  return violations;
};

const buildPolicyOverrideMap = (
  policyOverrides: EvaluatePolicyGateInput["policyOverrides"],
): ReadonlyMap<string, "error" | "warning"> =>
  new Map(
    policyOverrides?.map((override) => [override.ruleId, override.severity]) ??
      [],
  );

const resolvePolicyThresholdOverride = (
  policyOverrides: EvaluatePolicyGateInput["policyOverrides"],
  ruleId: string,
): number | undefined => {
  for (const override of policyOverrides ?? []) {
    if (override.ruleId === ruleId && override.threshold !== undefined) {
      return override.threshold;
    }
  }
  return undefined;
};

const applyPolicyOverrideViolations = (
  violations: readonly TestCasePolicyViolation[],
  overrideMap: ReadonlyMap<string, "error" | "warning">,
): TestCasePolicyViolation[] =>
  violations.map((violation) => {
    if (
      violation.rule === "policy:judge_refused" ||
      violation.rule === CROSS_MODAL_FAITHFULNESS_MISSING_RULE
    ) {
      return violation;
    }
    const severity = overrideMap.get(violation.rule);
    if (severity === undefined || severity === violation.severity) {
      return violation;
    }
    return { ...violation, severity };
  });

const decisionFromViolations = (
  violations: readonly TestCasePolicyViolation[],
): TestCasePolicyDecision => {
  let decision: TestCasePolicyDecision = "approved";
  for (const violation of violations) {
    decision = escalate(decision, severityToDecision(violation.severity));
  }
  return decision;
};

const summarizeUntrustedContentNeedsReview = (
  report: UntrustedContentNormalizationReport,
): string => {
  const carriers = report.needsReviewReasons
    .map((reason) => `${reason.carrier}(${reason.count})`)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
  return `untrusted-content normalization flagged critical carriers before prompt compilation: ${carriers}`;
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
): {
  outcome: TestCasePolicyOutcome;
  severity: "error" | "warning" | "info";
} | null => {
  switch (outcome) {
    case "ok":
      return null;
    case "schema_invalid":
    case "conflicts_with_figma_metadata":
      return { outcome: "visual_sidecar_failure", severity: "error" };
    case "fallback_used":
    case "primary_unavailable":
      return {
        outcome: "visual_sidecar_fallback_used_succeeded",
        severity: "info",
      };
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

interface FaithfulnessGateResolution {
  readonly score: number;
  readonly tierReport: FaithfulnessTierReport | undefined;
  readonly evaluation: FaithfulnessEvaluationSummary;
}

/**
 * Issue #2116 — classify how the cross-modal-faithfulness gate
 * evaluated `verdict` against `list`.
 *
 * Returns the evaluation mode, whether per-step strictness is required,
 * the score the threshold check should consume, and (when the verdict
 * carried per-step evidence) the persistable {@link FaithfulnessTierReport}.
 *
 * `mode === "missing"` when no verdict was supplied OR the verdict was
 * refused — in both cases the gate has no evidence to reason against.
 *
 * Pure: no IO, no mutation.
 */
const resolveFaithfulnessGateScore = (
  verdict: FaithfulnessVerdict | undefined,
  list: GeneratedTestCaseList,
  threshold: number,
  requirePerStepFaithfulness: boolean,
): FaithfulnessGateResolution => {
  if (verdict === undefined) {
    return {
      score: 0,
      tierReport: undefined,
      evaluation: {
        mode: "missing",
        requirePerStepFaithfulness,
        reason: "no faithfulness verdict was supplied to the policy gate",
        stepVerdictCount: 0,
      },
    };
  }
  if (verdict.refusal !== undefined) {
    return {
      score: 0,
      tierReport: undefined,
      evaluation: {
        mode: "missing",
        requirePerStepFaithfulness,
        reason:
          `faithfulness judge refused (code=${verdict.refusal.code}); ` +
          `no per-step or case-level evidence available`,
        stepVerdictCount: 0,
      },
    };
  }
  if (
    verdict.stepVerdicts === undefined ||
    verdict.stepVerdicts.length === 0
  ) {
    return {
      score: verdict.score,
      tierReport: undefined,
      evaluation: {
        mode: "case_level_fallback",
        requirePerStepFaithfulness,
        reason:
          "verdict carried no stepVerdicts; gate fell back to verdict.score " +
          verdict.score.toFixed(6),
        stepVerdictCount: 0,
      },
    };
  }
  const tierReport = buildFaithfulnessTierReport({
    generatedAt: verdict.generatedAt,
    jobId: verdict.jobId,
    verdict,
    list,
    aggregateThreshold: threshold,
  });
  return {
    score: tierReport.aggregateScore,
    tierReport,
    evaluation: {
      mode: "per_step",
      requirePerStepFaithfulness,
      reason:
        `gate reasoned over ${verdict.stepVerdicts.length} per-step ` +
        `verdict(s); aggregate score ${tierReport.aggregateScore.toFixed(6)}`,
      stepVerdictCount: verdict.stepVerdicts.length,
    },
  };
};

interface FaithfulnessScoreViolationResult {
  readonly violations: readonly TestCasePolicyViolation[];
  readonly tierReport: FaithfulnessTierReport | undefined;
  readonly evaluation: FaithfulnessEvaluationSummary;
}

/**
 * Build the cross-modal-faithfulness job-level violations for a run
 * (Issue #2066, Issue #2116).
 *
 * Three rule families compose the result:
 *
 *   1. {@link CROSS_MODAL_FAITHFULNESS_MISSING_RULE} — error severity;
 *      raised whenever the gate had no verdict at all.
 *   2. {@link CROSS_MODAL_FAITHFULNESS_FALLBACK_RULE} — warning by
 *      default, escalated to error when
 *      `requirePerStepFaithfulness === true`.
 *   3. {@link CROSS_MODAL_FAITHFULNESS_RULE} — the original score-vs-threshold
 *      check; only meaningful when there IS a score to compare.
 *
 * The `evaluation` summary is always returned so the caller can attach
 * it to {@link TestCasePolicyReport.faithfulnessEvaluation}.
 */
const buildFaithfulnessScoreViolation = (
  verdict: FaithfulnessVerdict | undefined,
  list: GeneratedTestCaseList,
  threshold: number,
  requirePerStepFaithfulness: boolean,
  enforceMissingVerdict: boolean,
): FaithfulnessScoreViolationResult => {
  const resolution = resolveFaithfulnessGateScore(
    verdict,
    list,
    threshold,
    requirePerStepFaithfulness,
  );
  const violations: TestCasePolicyViolation[] = [];
  const evaluation = resolution.evaluation;

  if (evaluation.mode === "missing") {
    if (verdict === undefined && enforceMissingVerdict) {
      violations.push({
        rule: CROSS_MODAL_FAITHFULNESS_MISSING_RULE,
        outcome: "cross_modal_faithfulness_evaluation_missing",
        severity: "error",
        reason: evaluation.reason,
      });
    }
    return { violations, tierReport: resolution.tierReport, evaluation };
  }

  if (evaluation.mode === "case_level_fallback") {
    const fallbackSeverity: "error" | "warning" = requirePerStepFaithfulness
      ? "error"
      : "warning";
    const strictnessNote = requirePerStepFaithfulness
      ? "; profile requires per-step faithfulness"
      : "; profile permits case-level fallback";
    violations.push({
      rule: CROSS_MODAL_FAITHFULNESS_FALLBACK_RULE,
      outcome: "cross_modal_faithfulness_case_level_fallback",
      severity: fallbackSeverity,
      reason: `cross-modal faithfulness fallback: ${evaluation.reason}${strictnessNote}`,
    });
  }

  const score = resolution.score;
  const grayZoneFloor = Math.max(
    0,
    threshold - CROSS_MODAL_FAITHFULNESS_GRAY_ZONE,
  );
  if (score < threshold) {
    const severity: "error" | "warning" =
      score >= grayZoneFloor ? "warning" : "error";
    const band =
      severity === "warning"
        ? `gray zone [${grayZoneFloor.toFixed(2)}, ${threshold.toFixed(2)})`
        : `below gray-zone floor ${grayZoneFloor.toFixed(2)}`;
    violations.push({
      rule: CROSS_MODAL_FAITHFULNESS_RULE,
      outcome: "cross_modal_faithfulness_score_below_threshold",
      severity,
      reason:
        `cross-modal faithfulness score ${score.toFixed(6)} is below ` +
        `threshold ${threshold.toFixed(2)} (${band})`,
    });
  }

  return { violations, tierReport: resolution.tierReport, evaluation };
};

const collectFormScreenIds = (intent: BusinessTestIntentIr): readonly string[] =>
  sortedUnique(intent.detectedFields.map((field) => field.screenId));

const collectCoveredFormScreenA11yCriteria = (
  list: GeneratedTestCaseList,
  screenId: string,
): ReadonlyArray<(typeof FORM_SCREEN_A11Y_REQUIRED_CRITERIA)[number]> => {
  const covered = new Set<(typeof FORM_SCREEN_A11Y_REQUIRED_CRITERIA)[number]>();
  for (const testCase of list.testCases) {
    if (
      testCase.type !== "accessibility" ||
      !testCase.figmaTraceRefs.some((traceRef) => traceRef.screenId === screenId)
    ) {
      continue;
    }
    for (const criterion of listCoveredFormScreenA11yCriteria(testCase)) {
      covered.add(criterion);
    }
  }
  return [...covered].sort();
};

const evaluateA11yJudgeVerdict = (
  formScreenIds: readonly string[],
  verdict: A11yVerdict | undefined,
): TestCasePolicyViolation[] => {
  if (verdict === undefined || verdict.refusal !== undefined) {
    return [];
  }
  const eligibleScreens = new Set(formScreenIds);
  const violations: TestCasePolicyViolation[] = [];
  for (const criterion of verdict.criteria) {
    if (!eligibleScreens.has(criterion.screenId)) {
      continue;
    }
    if (criterion.verdict === "covered_passes") {
      continue;
    }
    violations.push({
      rule: "policy:form-screen-needs-accessibility-case",
      outcome:
        criterion.verdict === "not_covered"
          ? "a11y_criterion_not_covered"
          : "a11y_criterion_covered_weakly",
      severity: criterion.verdict === "not_covered" ? "error" : "warning",
      reason:
        `screen "${criterion.screenId}" (${criterion.screenName}) ` +
        `${criterion.successCriterion} is ${criterion.verdict}; ` +
        `${criterion.pillarId}: ${criterion.rationale}`,
    });
  }
  return violations;
};

/**
 * Run the policy gate and produce the persistable
 * `TestCasePolicyReport` artifact.
 */
export const evaluatePolicyGate = (
  input: EvaluatePolicyGateInput,
): TestCasePolicyReport => {
  const overrideAssessment =
    input.semanticContentOverrides === undefined
      ? undefined
      : partitionSemanticContentOverridesForValidation(
          input.validation,
          input.semanticContentOverrides,
          input.overrideAuthorityProvider,
        );
  const semanticContentOverrides = overrideAssessment?.valid;
  const invalidSemanticContentOverrides = overrideAssessment?.invalid;
  const validationByCase = indexValidationByTestCase(input.validation);
  const decisions: TestCasePolicyDecisionRecord[] = [];
  const faithfulnessThreshold =
    resolvePolicyThresholdOverride(
      input.policyOverrides,
      CROSS_MODAL_FAITHFULNESS_RULE,
    ) ?? DEFAULT_CROSS_MODAL_FAITHFULNESS_THRESHOLD;
  const requirePerStepFaithfulness =
    input.profile.rules.requirePerStepFaithfulness ?? false;
  const faithfulness = buildFaithfulnessScoreViolation(
    input.faithfulnessVerdict,
    input.list,
    faithfulnessThreshold,
    requirePerStepFaithfulness,
    input.visual !== undefined,
  );
  // The score-below-threshold violation is attached to every test case
  // decision (legacy behaviour from Issue #2066). Fallback / missing
  // violations are emitted at the job level only — they describe the
  // gate's evidence path, not a per-case finding.
  const faithfulnessScoreViolation = faithfulness.violations.find(
    (violation) =>
      violation.outcome === "cross_modal_faithfulness_score_below_threshold",
  );
  const judgeRefusalViolations = buildJudgeRefusalViolations(
    input.profile,
    input.faithfulnessVerdict,
    input.a11yVerdict,
  );

  for (const tc of input.list.testCases) {
    const issues = validationByCase.get(tc.id) ?? [];
    decisions.push(
      evaluateCase(
        tc,
        input.intent,
        input.profile,
        issues,
        semanticContentOverrides,
        invalidSemanticContentOverrides,
        input.customContextPolicySignals ?? [],
        input.visualSidecarRefusal,
        input.visualVerificationRequired ?? false,
        input.untrustedContentReport,
        judgeRefusalViolations.caseLevel,
        faithfulnessScoreViolation,
        input.complianceOverrides,
      ),
    );
  }

  const overrideMap = buildPolicyOverrideMap(input.policyOverrides);
  const jobLevelViolations = applyPolicyOverrideViolations(
    [
      ...evaluateJobLevel(
        input.list,
        input.intent,
        input.coverage,
        input.profile,
        input.coveragePlan,
        input.visual,
        input.customContextPolicySignals ?? [],
        input.visualSidecarRefusal,
        input.untrustedContentReport,
        input.activeModelBindings,
        input.coverageBaselineDrift,
        input.a11yVerdict,
        input.complianceOverrides,
      ),
      ...judgeRefusalViolations.jobLevel,
      ...faithfulness.violations,
    ],
    overrideMap,
  );

  const overriddenDecisions = decisions.map((decision) => {
    const violations = applyPolicyOverrideViolations(
      decision.violations,
      overrideMap,
    );
    return {
      ...decision,
      decision: decisionFromViolations(violations),
      violations,
    };
  });

  // Job-level violations of error severity propagate as job-level
  // blocking; per-case decisions remain unchanged so review tooling can
  // see the per-case story.
  let jobBlocked = overriddenDecisions.some((d) => d.decision === "blocked");
  if (!jobBlocked) {
    jobBlocked = jobLevelViolations.some((v) => v.severity === "error");
  }

  let approved = 0;
  let blocked = 0;
  let needsReview = 0;
  for (const d of overriddenDecisions) {
    if (d.decision === "approved") approved += 1;
    else if (d.decision === "blocked") blocked += 1;
    else needsReview += 1;
  }

  const faithfulnessEvaluation =
    input.faithfulnessVerdict === undefined && input.visual === undefined
      ? undefined
      : faithfulness.evaluation;

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
    decisions: overriddenDecisions,
    jobLevelViolations,
    ...(faithfulnessEvaluation !== undefined ? { faithfulnessEvaluation } : {}),
  };
};

/** Issue #2116 — re-export of {@link FaithfulnessEvaluationMode} so
 * downstream consumers (drift-canary, benchmark scorecards) can type
 * their report fields without re-importing the contracts module. */
export type { FaithfulnessEvaluationMode } from "../contracts/index.js";

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
      nextDecision = escalate(nextDecision, severityToDecision(violation.severity));
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
