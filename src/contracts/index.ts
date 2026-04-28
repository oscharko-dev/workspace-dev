/**
 * workspace-dev — Public contracts for autonomous REST + deterministic generation.
 *
 * These types define the public API surface for workspace-dev consumers.
 * They must not import from internal services.
 *
 * Contract version: 4.21.0
 * See CONTRACT_CHANGELOG.md for contract change history and VERSIONING.md for
 * package-versus-contract versioning policy.
 */

/**
 * Runtime source-of-truth list of allowed Figma source modes.
 * Keep this array and `WorkspaceFigmaSourceMode` in lockstep;
 * `submit-mode-parity.test.ts` enforces that compile-time and
 * runtime agree.
 */
export const ALLOWED_FIGMA_SOURCE_MODES = [
  "rest",
  "hybrid",
  "local_json",
  "figma_paste",
  "figma_plugin",
] as const;

/** Allowed Figma source modes for workspace-dev. */
export type WorkspaceFigmaSourceMode =
  (typeof ALLOWED_FIGMA_SOURCE_MODES)[number];

/** Source modes used to record replayable import sessions. */
export type WorkspaceImportSessionSourceMode =
  | WorkspaceFigmaSourceMode
  | "figma_url";

/** Import intent detected by the client-side paste classifier. */
export type WorkspaceImportIntent =
  | "FIGMA_JSON_NODE_BATCH"
  | "FIGMA_JSON_DOC"
  | "FIGMA_PLUGIN_ENVELOPE"
  | "RAW_CODE_OR_TEXT"
  | "UNKNOWN";

/** Structural classification of a per-paste delta diff. */
export type WorkspacePasteDeltaStrategy =
  | "baseline_created"
  | "no_changes"
  | "delta"
  | "structural_break";

/** Import mode for a Figma paste. `"auto"` lets the server pick delta vs full based on diff threshold. */
export type WorkspaceImportMode = "full" | "delta" | "auto";

export type WorkspaceImportSessionScope = "all" | "partial";

/** Summary of the per-paste delta computation. Surfaced on JobResult when Figma paste import is used. */
export interface WorkspacePasteDeltaSummary {
  /** Mode ultimately used by the server. `auto_*` variants are returned when the client asked for "auto". */
  mode: "full" | "delta" | "auto_resolved_to_full" | "auto_resolved_to_delta";
  /** Structural classification of the tree diff. */
  strategy: WorkspacePasteDeltaStrategy;
  /** Total nodes observed in the current paste. */
  totalNodes: number;
  /** Nodes whose subtree hash matched the prior manifest (eligible for reuse). */
  nodesReused: number;
  /** Nodes that required reprocessing (added + updated + all descendants of updated). */
  nodesReprocessed: number;
  /** Diff ratio used to choose mode when `auto`. 0 = identical, 1 = all new. */
  structuralChangeRatio: number;
  /** Stable per-component identity key (sha256 prefix). Useful for correlating future pastes. */
  pasteIdentityKey: string;
  /** True when the server had no prior manifest for this identity (first paste). */
  priorManifestMissing: boolean;
}

/**
 * Runtime source-of-truth list of allowed codegen modes.
 * Keep this array and `WorkspaceLlmCodegenMode` in lockstep;
 * `submit-mode-parity.test.ts` enforces that compile-time and
 * runtime agree.
 */
export const ALLOWED_LLM_CODEGEN_MODES = ["deterministic"] as const;

/** Allowed codegen modes for workspace-dev. */
export type WorkspaceLlmCodegenMode =
  (typeof ALLOWED_LLM_CODEGEN_MODES)[number];

/**
 * Runtime source-of-truth for allowed workspace-dev job types.
 * Keep this array and `WorkspaceJobType` in lockstep.
 */
export const ALLOWED_WORKSPACE_JOB_TYPES = [
  "figma_to_code",
  "figma_to_qc_test_cases",
] as const;

/** Allowed job types for workspace-dev submissions. */
export type WorkspaceJobType = (typeof ALLOWED_WORKSPACE_JOB_TYPES)[number];

/**
 * Runtime source-of-truth for allowed test-intelligence modes.
 *
 * Test intelligence is an opt-in, local-first feature that is SEPARATE from
 * the `llmCodegenMode` namespace used by the deterministic code generation
 * pipeline. The two mode namespaces are intentionally isolated: changes to
 * this array must never affect `ALLOWED_LLM_CODEGEN_MODES`.
 */
export const ALLOWED_TEST_INTELLIGENCE_MODES = [
  "deterministic_llm",
  "offline_eval",
  "dry_run",
] as const;

/** Allowed test-intelligence modes. */
export type WorkspaceTestIntelligenceMode =
  (typeof ALLOWED_TEST_INTELLIGENCE_MODES)[number];

/**
 * Bearer credential bound to a single review principal.
 *
 * Used by the test-intelligence review gate when four-eyes review is
 * enforced (#1376). The token authenticates the caller; the
 * `principalId` is the server-owned reviewer identity persisted on
 * review events and snapshots. Never reuse one token for multiple
 * principals.
 */
export interface TestIntelligenceReviewPrincipal {
  /** Opaque, non-secret reviewer principal id persisted in review audit logs. */
  principalId: string;
  /** Bearer token accepted for this principal's review-gate write requests. */
  bearerToken: string;
}

/**
 * Principal-bound credentials used by the controlled OpenText ALM API
 * transfer pipeline (#1372). The token authenticates the caller; the
 * `principalId` is the server-owned operator identity persisted in
 * `transfer-report.json` so audit lineage survives token rotation.
 * Never reuse one token for multiple principals.
 */
export interface TestIntelligenceTransferPrincipal {
  /** Opaque, non-secret operator principal id persisted in transfer audit logs. */
  principalId: string;
  /** Bearer token accepted for this principal's API transfer requests. */
  bearerToken: string;
}

/** Contract version for the opt-in test-intelligence surface. */
export const TEST_INTELLIGENCE_CONTRACT_VERSION = "1.5.0" as const;

/** Schema version for generated test case payloads. */
export const GENERATED_TEST_CASE_SCHEMA_VERSION = "1.0.0" as const;

/** Prompt template version for the test-intelligence prompt family. */
export const TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION = "1.0.0" as const;

/** Visual sidecar schema version consumed by the prompt compiler (Issue #1386). */
export const VISUAL_SIDECAR_SCHEMA_VERSION = "1.0.0" as const;

/** Redaction policy bundle version applied before prompt compilation. */
export const REDACTION_POLICY_VERSION = "1.0.0" as const;

/** Environment variable name that gates test-intelligence features at startup. */
export const TEST_INTELLIGENCE_ENV =
  "FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE" as const;

/**
 * Environment variable name for the Wave 4 multi-source ingestion gate
 * (Issue #1431). Strictly nested behind {@link TEST_INTELLIGENCE_ENV}; the
 * resolver requires both gates _and_ the parent startup option to be enabled
 * before a job may compose more than one test-design source.
 */
export const TEST_INTELLIGENCE_MULTISOURCE_ENV =
  "FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE" as const;

/**
 * Schema version for the {@link MultiSourceTestIntentEnvelope} aggregate
 * (Issue #1431). Bumped on any breaking change to the envelope shape, the
 * source-ref shape, or the aggregate-hash construction.
 */
export const MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION =
  "1.0.0" as const;

/** Schema version for persisted custom-context supporting source artifacts. */
export const CUSTOM_CONTEXT_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical filename for a persisted custom-context supporting source. */
export const CUSTOM_CONTEXT_ARTIFACT_FILENAME = "custom-context.json" as const;

/** Stable source id for Markdown-authored custom context. */
export const CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID =
  "custom-context-markdown" as const;

/** Stable source id for structured-attribute custom context. */
export const CUSTOM_CONTEXT_STRUCTURED_SOURCE_ID =
  "custom-context-structured" as const;

/** Version stamp for persisted role-separated LLM gateway evidence artifacts. */
export const LLM_GATEWAY_CONTRACT_VERSION = "1.0.0" as const;

/** Schema version for the persisted `llm-capabilities.json` evidence artifact. */
export const LLM_CAPABILITIES_SCHEMA_VERSION = "1.1.0" as const;

/** Canonical filename for the persisted LLM gateway capability probe artifact. */
export const LLM_CAPABILITIES_ARTIFACT_FILENAME =
  "llm-capabilities.json" as const;

/**
 * Schema version for the persisted test-case validation report artifact (Issue #1364).
 * Bumped when `TestCaseValidationReport` changes shape.
 */
export const TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Schema version for the persisted policy decision report artifact (Issue #1364). */
export const TEST_CASE_POLICY_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Schema version for the persisted coverage / quality-signals report artifact (Issue #1364). */
export const TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Schema version for the persisted visual-sidecar validation report artifact (Issue #1364 / #1386). */
export const VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical filename for the persisted test-case payload accepted into review/export. */
export const GENERATED_TESTCASES_ARTIFACT_FILENAME =
  "generated-testcases.json" as const;

/** Canonical filename for the persisted validation diagnostics artifact. */
export const TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME =
  "validation-report.json" as const;

/** Canonical filename for the persisted policy-gate decision artifact. */
export const TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME =
  "policy-report.json" as const;

/** Canonical filename for the persisted coverage / quality-signals artifact. */
export const TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME =
  "coverage-report.json" as const;

/** Canonical filename for the persisted visual-sidecar validation artifact. */
export const VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME =
  "visual-sidecar-validation-report.json" as const;

/**
 * Schema version for the persisted self-verify rubric pass artifact (Issue #1379).
 *
 * Bumped on any breaking change to the per-case evaluation shape, the
 * job-level aggregate shape, the rubric-dimension union, or the JSON
 * response shape consumed by the rubric prompt.
 */
export const SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Canonical filename for the persisted self-verify rubric report
 * (Issue #1379). The artifact is emitted under
 * `<runDir>/testcases/self-verify-rubric.json` when the opt-in pass runs.
 */
export const SELF_VERIFY_RUBRIC_REPORT_ARTIFACT_FILENAME =
  "self-verify-rubric.json" as const;

/**
 * Run-dir-relative subdirectory under which the self-verify rubric artifact
 * is persisted. Sibling to the validation reports so consumers can locate
 * the test-case quality signals next to the cases they describe.
 */
export const SELF_VERIFY_RUBRIC_ARTIFACT_DIRECTORY = "testcases" as const;

/**
 * Prompt template version stamp for the rubric-only prompt family. Bumped
 * on any change to the system prompt, user-prompt preamble, or the JSON
 * response schema; the version stamp participates in the rubric replay-cache
 * key so any template change forces a cache miss.
 */
export const SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION = "1.0.0" as const;

/** Stable JSON schema name attached to the structured rubric response. */
export const SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME =
  "SelfVerifyRubricReport" as const;

/** Schema version for the persisted review-gate state and event-log artifacts (Issue #1365). */
export const REVIEW_GATE_SCHEMA_VERSION = "1.0.0" as const;

/** Schema version for the persisted QC mapping preview artifact (Issue #1365). */
export const QC_MAPPING_PREVIEW_SCHEMA_VERSION = "1.0.0" as const;

/** Schema version for the persisted export-report artifact (Issue #1365). */
export const EXPORT_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Schema version stamp embedded in the OpenText ALM reference XML export (Issue #1365). */
export const ALM_EXPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical filename for the persisted review-gate event log. */
export const REVIEW_EVENTS_ARTIFACT_FILENAME = "review-events.json" as const;

/** Canonical filename for the persisted review-gate snapshot. */
export const REVIEW_STATE_ARTIFACT_FILENAME = "review-state.json" as const;

/** Canonical filename for the persisted JSON export of approved test cases. */
export const EXPORT_TESTCASES_JSON_ARTIFACT_FILENAME =
  "testcases.json" as const;

/** Canonical filename for the persisted CSV export of approved test cases. */
export const EXPORT_TESTCASES_CSV_ARTIFACT_FILENAME = "testcases.csv" as const;

/** Canonical filename for the optional persisted XLSX export of approved test cases. */
export const EXPORT_TESTCASES_XLSX_ARTIFACT_FILENAME =
  "testcases.xlsx" as const;

/** Canonical filename for the persisted OpenText ALM reference XML export. */
export const EXPORT_TESTCASES_ALM_XML_ARTIFACT_FILENAME =
  "testcases.alm.xml" as const;

/** Canonical filename for the persisted QC mapping preview artifact. */
export const QC_MAPPING_PREVIEW_ARTIFACT_FILENAME =
  "qc-mapping-preview.json" as const;

/** Canonical filename for the persisted export-report artifact. */
export const EXPORT_REPORT_ARTIFACT_FILENAME = "export-report.json" as const;

/** Built-in OpenText ALM reference export profile id (Wave 1). */
export const OPENTEXT_ALM_REFERENCE_PROFILE_ID =
  "opentext-alm-default" as const;

/** Version stamp for the built-in OpenText ALM reference export profile. */
export const OPENTEXT_ALM_REFERENCE_PROFILE_VERSION = "1.0.0" as const;

/** XML namespace embedded in the OpenText ALM reference export root element. */
export const ALM_EXPORT_XML_NAMESPACE =
  "https://workspace-dev.local/schema/alm-export/v1" as const;

/**
 * Built-in policy profile id for the default EU-banking compliance gate.
 * Operators may install additional profiles by version stamp; this id is the
 * one Wave 1 ships with.
 */
export const EU_BANKING_DEFAULT_POLICY_PROFILE_ID =
  "eu-banking-default" as const;

/** Version stamp for the built-in `eu-banking-default` policy profile. */
export const EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION = "1.0.0" as const;

/**
 * Allowed test-case validation issue codes (Issue #1364).
 * The list is the runtime source of truth; new codes plug in here without
 * altering call sites. Adding a new code is a minor (additive) bump.
 */
export const ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES = [
  "schema_invalid",
  "missing_trace",
  "trace_screen_unknown",
  "missing_expected_results",
  "steps_unordered",
  "steps_indices_non_sequential",
  "step_action_empty",
  "step_action_too_long",
  "duplicate_step_index",
  "duplicate_test_case_id",
  "title_empty",
  "objective_empty",
  "risk_category_invalid_for_intent",
  "qc_mapping_blocking_reasons_missing",
  "qc_mapping_exportable_inconsistent",
  "quality_signals_confidence_out_of_range",
  "quality_signals_coverage_unknown_id",
  "test_data_pii_detected",
  "test_data_unredacted_value",
  "preconditions_pii_detected",
  "expected_results_pii_detected",
  "assumptions_excessive",
  "open_questions_excessive",
  "ambiguity_without_review_state",
  "semantic_suspicious_content",
] as const;

export type TestCaseValidationIssueCode =
  (typeof ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES)[number];

/** Severity surfaced for a single validation issue. */
export type TestCaseValidationSeverity = "error" | "warning";

/** Single semantic / structural validation issue. */
export interface TestCaseValidationIssue {
  testCaseId?: string;
  path: string;
  code: TestCaseValidationIssueCode;
  severity: TestCaseValidationSeverity;
  message: string;
}

/** Aggregate validation outcome across one job's generated test cases. */
export interface TestCaseValidationReport {
  schemaVersion: typeof TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  generatedAt: string;
  jobId: string;
  totalTestCases: number;
  errorCount: number;
  warningCount: number;
  /** Whether the report blocks downstream review/export (any error => true). */
  blocked: boolean;
  issues: TestCaseValidationIssue[];
}

/**
 * Allowed policy-gate decisions (Issue #1364).
 *
 * - `approved` — case may proceed to review/export as-is.
 * - `blocked` — case must not reach review or export.
 * - `needs_review` — case must be reviewed manually before export.
 */
export const ALLOWED_TEST_CASE_POLICY_DECISIONS = [
  "approved",
  "blocked",
  "needs_review",
] as const;
export type TestCasePolicyDecision =
  (typeof ALLOWED_TEST_CASE_POLICY_DECISIONS)[number];

/**
 * Allowed policy outcome codes attached to a single decision row.
 * Visual-sidecar codes (`visual_*`) come from the multimodal sidecar
 * gating per the Issue #1364 / #1386 update.
 */
export const ALLOWED_TEST_CASE_POLICY_OUTCOMES = [
  "missing_trace",
  "missing_expected_results",
  "pii_in_test_data",
  "missing_negative_or_validation_for_required_field",
  "missing_accessibility_case",
  "missing_boundary_case",
  "schema_invalid",
  "duplicate_test_case",
  "regulated_risk_review_required",
  "ambiguity_review_required",
  "qc_mapping_not_exportable",
  "low_confidence_review_required",
  "open_questions_review_required",
  "visual_sidecar_failure",
  "visual_sidecar_fallback_used",
  "visual_sidecar_low_confidence",
  "visual_sidecar_possible_pii",
  "visual_sidecar_prompt_injection_text",
  "semantic_suspicious_content",
  "risk_tag_downgrade_detected",
  "custom_context_risk_escalation",
  "multi_source_conflict_present",
] as const;
export type TestCasePolicyOutcome =
  (typeof ALLOWED_TEST_CASE_POLICY_OUTCOMES)[number];

/** Single policy-rule violation surfaced for a generated test case. */
export interface TestCasePolicyViolation {
  rule: string;
  outcome: TestCasePolicyOutcome;
  severity: TestCaseValidationSeverity;
  reason: string;
  /** JSON-pointer-style path inside the test case if applicable. */
  path?: string;
}

/** Per-test-case policy decision row. */
export interface TestCasePolicyDecisionRecord {
  testCaseId: string;
  decision: TestCasePolicyDecision;
  violations: TestCasePolicyViolation[];
}

/** Aggregate policy report across one job's generated test cases. */
export interface TestCasePolicyReport {
  schemaVersion: typeof TEST_CASE_POLICY_REPORT_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  generatedAt: string;
  jobId: string;
  policyProfileId: string;
  policyProfileVersion: string;
  totalTestCases: number;
  approvedCount: number;
  blockedCount: number;
  needsReviewCount: number;
  /** Whether ANY case was blocked (downstream export gate). */
  blocked: boolean;
  decisions: TestCasePolicyDecisionRecord[];
  /** Job-level policy violations (e.g., job-wide duplicate fingerprint). */
  jobLevelViolations: TestCasePolicyViolation[];
}

/** Tunable knobs of a policy profile (defaults shown for `eu-banking-default`). */
export interface TestCasePolicyProfileRules {
  /** Risk categories that always require manual review. */
  reviewOnlyRiskCategories: TestCaseRiskCategory[];
  /** Risk categories that block export when missing trace/expected/PII checks fail. */
  strictRiskCategories: TestCaseRiskCategory[];
  /** Whether a screen with form fields requires at least one accessibility case. */
  requireAccessibilityCaseWhenFormPresent: boolean;
  /** Whether each detected validation rule requires at least one negative/validation case. */
  requireNegativeOrValidationForValidationRules: boolean;
  /** Whether each required field requires at least one boundary case. */
  requireBoundaryCaseForRequiredFields: boolean;
  /** Min generator-side confidence; below this threshold => needs_review. */
  minConfidence: number;
  /** Max Jaccard similarity above which two cases are flagged as duplicates. */
  duplicateSimilarityThreshold: number;
  /** Max open-question count per case before review is required. */
  maxOpenQuestionsPerCase: number;
  /** Max assumption count per case before review is required. */
  maxAssumptionsPerCase: number;
  /**
   * Whether the policy gate must cross-reference each generated test case's
   * declared `riskCategory` against the risk classification derivable from the
   * Business Test Intent IR for the screens referenced in the case's
   * `figmaTraceRefs`. When enabled (the secure default), any case that
   * declares a risk category outside `reviewOnlyRiskCategories` while the
   * intent IR derives a review-only classification for one of its screens
   * raises a `risk_tag_downgrade_detected` outcome at both per-case and
   * job-level. The case is escalated to `needs_review` (defense-in-depth
   * against an out-of-band caller submitting forged low-risk tags).
   *
   * Optional for backward compatibility. Treat `undefined` as `true`.
   */
  enforceRiskTagDowngradeDetection?: boolean;
}

/** Built-in policy profile shape. Profiles are identified by `id`+`version`. */
export interface TestCasePolicyProfile {
  id: string;
  version: string;
  description: string;
  rules: TestCasePolicyProfileRules;
}

/** Per-element coverage breakdown. */
export interface TestCaseCoverageBucket {
  /** Total IR elements of this kind across the job. */
  total: number;
  /** Element ids covered by at least one accepted test case. */
  covered: number;
  /** Coverage ratio in [0, 1]; 0 when total=0 (no elements => no gap). */
  ratio: number;
  /** Element ids that have no covering test case. */
  uncoveredIds: string[];
}

/** Coverage/quality signals across one job's generated test cases. */
export interface TestCaseCoverageReport {
  schemaVersion: typeof TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  generatedAt: string;
  jobId: string;
  policyProfileId: string;
  totalTestCases: number;
  fieldCoverage: TestCaseCoverageBucket;
  actionCoverage: TestCaseCoverageBucket;
  validationCoverage: TestCaseCoverageBucket;
  navigationCoverage: TestCaseCoverageBucket;
  traceCoverage: { total: number; withTrace: number; ratio: number };
  negativeCaseCount: number;
  validationCaseCount: number;
  boundaryCaseCount: number;
  accessibilityCaseCount: number;
  workflowCaseCount: number;
  positiveCaseCount: number;
  /** Avg assumptions per case. */
  assumptionsRatio: number;
  /** Total open questions across all cases. */
  openQuestionsCount: number;
  /** Test-case pairs sharing >= duplicate threshold. */
  duplicatePairs: TestCaseDuplicatePair[];
  /** Optional 0..1 rubric score from a downstream rater (Wave 2). */
  rubricScore?: number;
}

/* ------------------------------------------------------------------ */
/*  Self-verify rubric pass (Issue #1379)                              */
/* ------------------------------------------------------------------ */

/**
 * Allowed scoring dimensions evaluated by the self-verify rubric pass
 * (Issue #1379). Each dimension is scored in `[0, 1]` per test case;
 * the per-case rubric score is the arithmetic mean of the supplied
 * dimensions (and visual subscores when present). The discriminant is
 * the runtime source of truth — adding a new dimension is a minor
 * (additive) bump per the contract versioning rules.
 */
export const ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS = [
  "schema_conformance",
  "source_trace_completeness",
  "assumption_open_question_marking",
  "expected_result_coverage",
  "negative_boundary_presence",
  "duplication_flag_consistency",
] as const;

/** Single rubric scoring dimension. */
export type SelfVerifyRubricDimension =
  (typeof ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS)[number];

/**
 * Allowed multimodal visual subscores layered onto the rubric pass when
 * a validated `VisualScreenDescription` batch is supplied alongside the
 * test cases (Issue #1379, multimodal addendum 2026-04-24). The four
 * subscores are: visible-control coverage, state/validation coverage,
 * ambiguity handling, and the unsupported-visual-claims penalty (the
 * latter is interpreted as `1 - penalty` so all subscores remain in
 * `[0, 1]` where higher is better).
 */
export const ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES = [
  "visible_control_coverage",
  "state_validation_coverage",
  "ambiguity_handling",
  "unsupported_visual_claims",
] as const;

/** Single multimodal visual subscore kind. */
export type SelfVerifyRubricVisualSubscoreKind =
  (typeof ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES)[number];

/**
 * Allowed refusal codes reported by the self-verify rubric pass when the
 * pass cannot publish a complete per-case evaluation. The code is
 * load-bearing: callers that gate on rubric output check this code and
 * fall back to the unscored coverage path. No two refusal codes overlap.
 */
export const ALLOWED_SELF_VERIFY_RUBRIC_REFUSAL_CODES = [
  "feature_disabled",
  "gateway_failure",
  "model_binding_mismatch",
  "schema_invalid_response",
  "score_out_of_range",
  "missing_test_case_score",
  "extra_test_case_score",
  "duplicate_test_case_score",
  "image_payload_attempted",
] as const;

/** Single rubric pass refusal classification. */
export type SelfVerifyRubricRefusalCode =
  (typeof ALLOWED_SELF_VERIFY_RUBRIC_REFUSAL_CODES)[number];

/** Single dimension score in the persisted rubric report. */
export interface SelfVerifyRubricDimensionScore {
  dimension: SelfVerifyRubricDimension;
  /** Score in `[0, 1]`; rounded to 6 digits in the persisted artifact. */
  score: number;
}

/** Single visual subscore in the persisted rubric report. */
export interface SelfVerifyRubricVisualSubscore {
  subscore: SelfVerifyRubricVisualSubscoreKind;
  /** Score in `[0, 1]`; rounded to 6 digits in the persisted artifact. */
  score: number;
}

/**
 * Short, structured rule citation attached to a per-case evaluation. The
 * citation surfaces the rubric rule the rater applied and a short
 * audit-grade message. No chain-of-thought is persisted — `message` is
 * a single sentence the rater produced when grading the case.
 */
export interface SelfVerifyRubricRuleCitation {
  /** Stable rule identifier (e.g. `"schema_conformance.required_fields"`). */
  ruleId: string;
  /** Audit-grade short message; sanitized + truncated by the parser. */
  message: string;
}

/** Per-test-case rubric evaluation row. */
export interface SelfVerifyRubricCaseEvaluation {
  testCaseId: string;
  /** Sorted by dimension name for byte stability. */
  dimensions: SelfVerifyRubricDimensionScore[];
  /** Visual subscores when the rubric pass had a visual sidecar input. */
  visualSubscores?: SelfVerifyRubricVisualSubscore[];
  /** Sorted by `ruleId` for byte stability. Empty array when no rule fired. */
  citations: SelfVerifyRubricRuleCitation[];
  /**
   * Aggregate per-case rubric score in `[0, 1]`. Arithmetic mean of the
   * dimensions and visual subscores; rounded to 6 digits in the artifact.
   */
  rubricScore: number;
}

/** Job-level aggregate of the rubric pass. */
export interface SelfVerifyRubricAggregateScores {
  /** Mean of the per-case `rubricScore` values across the job. */
  jobLevelRubricScore: number;
  /** Job-level mean per rubric dimension; sorted by dimension name. */
  dimensionScores: SelfVerifyRubricDimensionScore[];
  /** Job-level mean per visual subscore when the rubric pass scored visuals. */
  visualSubscores?: SelfVerifyRubricVisualSubscore[];
}

/** Refusal record emitted when the rubric pass cannot publish scores. */
export interface SelfVerifyRubricRefusal {
  code: SelfVerifyRubricRefusalCode;
  /** Sanitized + truncated message; no secrets, no chain-of-thought. */
  message: string;
}

/**
 * Persisted self-verify rubric pass artifact (Issue #1379).
 *
 * Sibling to `validation-report.json` and `coverage-report.json` under
 * `<runDir>/testcases/self-verify-rubric.json`. Always byte-stable: per
 * case evaluations are sorted by `testCaseId`, dimension lists are
 * sorted by dimension name, and citations are sorted by rule id.
 *
 * When a `refusal` is present, `caseEvaluations` is empty and the
 * `aggregate` carries `0` job/dimension scores; downstream policy gates
 * MUST treat the refusal as a soft signal (it does not by itself block
 * a job) and surface it on the inspector for operator review.
 */
export interface SelfVerifyRubricReport {
  schemaVersion: typeof SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  promptTemplateVersion: typeof SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION;
  generatedAt: string;
  jobId: string;
  policyProfileId: string;
  /** Whether the rubric replay cache served the result without invoking the LLM. */
  cacheHit: boolean;
  /** Hex-encoded SHA-256 digest of the rubric replay-cache key. */
  cacheKeyDigest: string;
  /** Identity stamps of the deployment that produced (or would have produced) the scores. */
  modelDeployment: string;
  modelRevision: string;
  gatewayRelease: string;
  /** Set when the pass refused to publish scores. */
  refusal?: SelfVerifyRubricRefusal;
  /** Sorted by `testCaseId` for byte stability. Empty when `refusal` is set. */
  caseEvaluations: SelfVerifyRubricCaseEvaluation[];
  aggregate: SelfVerifyRubricAggregateScores;
}

/**
 * Replay-cache key for the self-verify rubric pass. The key carries a
 * hard discriminator (`passKind`) so it can never collide with the
 * test-generation replay cache key, even when other identity fields
 * happen to match.
 */
export interface SelfVerifyRubricReplayCacheKey {
  passKind: "self_verify_rubric";
  /** SHA-256 of the rubric input (test cases + intent + visual descriptions). */
  inputHash: string;
  /** SHA-256 of the rubric prompt + response schema identity. */
  promptHash: string;
  /** SHA-256 of the rubric response JSON schema. */
  schemaHash: string;
  /** Deployment identity used for the rubric pass. */
  modelDeployment: string;
  /** Gateway compatibility mode; Issue #1379 pins this to `openai_chat`. */
  compatibilityMode: LlmGatewayCompatibilityMode;
  modelRevision: string;
  gatewayRelease: string;
  policyBundleVersion: string;
  redactionPolicyVersion: typeof REDACTION_POLICY_VERSION;
  promptTemplateVersion: typeof SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION;
  rubricSchemaVersion: typeof SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION;
  seed?: number;
}

/** Stored cache entry for a rubric report. */
export interface SelfVerifyRubricReplayCacheEntry {
  key: string;
  storedAt: string;
  report: SelfVerifyRubricReport;
}

/** Cache lookup outcome consumed by the rubric pass orchestration layer. */
export type SelfVerifyRubricReplayCacheLookupResult =
  | { hit: true; entry: SelfVerifyRubricReplayCacheEntry }
  | { hit: false; key: string };

/** Pair of generated test case ids exceeding the similarity threshold. */
export interface TestCaseDuplicatePair {
  leftTestCaseId: string;
  rightTestCaseId: string;
  similarity: number;
}

/**
 * Allowed visual-sidecar policy outcome codes (Issue #1364 / #1386).
 *
 * These mirror the visual-sidecar policy outcomes attached to the policy
 * report when the multimodal sidecar misbehaves or is downgraded.
 */
export const ALLOWED_VISUAL_SIDECAR_VALIDATION_OUTCOMES = [
  "ok",
  "schema_invalid",
  "low_confidence",
  "fallback_used",
  "possible_pii",
  "prompt_injection_like_text",
  "conflicts_with_figma_metadata",
  "primary_unavailable",
] as const;
export type VisualSidecarValidationOutcome =
  (typeof ALLOWED_VISUAL_SIDECAR_VALIDATION_OUTCOMES)[number];

/** Single per-screen visual-sidecar validation row. */
export interface VisualSidecarValidationRecord {
  screenId: string;
  deployment: "llama-4-maverick-vision" | "phi-4-multimodal-poc" | "mock";
  outcomes: VisualSidecarValidationOutcome[];
  /** Issues found while structurally validating the description. */
  issues: TestCaseValidationIssue[];
  /** Mean confidence reported by the sidecar (0..1). */
  meanConfidence: number;
}

/** Aggregate visual-sidecar validation report across a job. */
export interface VisualSidecarValidationReport {
  schemaVersion: typeof VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  visualSidecarSchemaVersion: typeof VISUAL_SIDECAR_SCHEMA_VERSION;
  generatedAt: string;
  jobId: string;
  totalScreens: number;
  screensWithFindings: number;
  /** Whether any record carries a non-`ok`/non-`fallback_used` outcome that blocks generation. */
  blocked: boolean;
  records: VisualSidecarValidationRecord[];
}

/**
 * Allowed gateway roles. Each role is bound to a single deployment to keep the
 * structured test-case generator (`gpt-oss-120b`) strictly separated from the
 * multimodal visual sidecars (`llama-4-maverick-vision`, `phi-4-multimodal-poc`).
 */
export const ALLOWED_LLM_GATEWAY_ROLES = [
  "test_generation",
  "visual_primary",
  "visual_fallback",
] as const;
export type LlmGatewayRole = (typeof ALLOWED_LLM_GATEWAY_ROLES)[number];

/**
 * Wire-protocol compatibility modes. `openai_chat` is the only mode shipped in
 * Wave 1; the array is the source of truth so future modes (`openai_responses`,
 * `custom_adapter`) plug in without changing the call sites.
 */
export const ALLOWED_LLM_GATEWAY_COMPATIBILITY_MODES = ["openai_chat"] as const;
export type LlmGatewayCompatibilityMode =
  (typeof ALLOWED_LLM_GATEWAY_COMPATIBILITY_MODES)[number];

/** Authentication strategy for outbound requests to the LLM gateway. */
export const ALLOWED_LLM_GATEWAY_AUTH_MODES = [
  "api_key",
  "bearer_token",
  "none",
] as const;
export type LlmGatewayAuthMode =
  (typeof ALLOWED_LLM_GATEWAY_AUTH_MODES)[number];

/**
 * Disjoint failure classes surfaced by `LlmGatewayClient.generate`. Refusals,
 * schema-invalid responses, and image-payload guard rejections are NOT
 * retryable; transport, timeout, and rate-limit failures are.
 */
export const ALLOWED_LLM_GATEWAY_ERROR_CLASSES = [
  "refusal",
  "schema_invalid",
  "incomplete",
  "timeout",
  "rate_limited",
  "transport",
  "image_payload_rejected",
  "input_budget_exceeded",
  "response_too_large",
] as const;
export type LlmGatewayErrorClass =
  (typeof ALLOWED_LLM_GATEWAY_ERROR_CLASSES)[number];

/**
 * Capability flags declared by the gateway operator and verified at probe
 * time. Streaming is disabled by default in Wave 1 — the Figma-to-test
 * pipeline consumes only the final structured JSON envelope.
 */
export interface LlmGatewayCapabilities {
  structuredOutputs: boolean;
  seedSupport: boolean;
  reasoningEffortSupport: boolean;
  maxOutputTokensSupport: boolean;
  streamingSupport: boolean;
  imageInputSupport: boolean;
}

/** Per-capability probe verdict carried in the persisted artifact. */
export type LlmCapabilityProbeOutcome =
  | "supported"
  | "unsupported"
  | "untested"
  | "probe_failed";

/** Probe rows can cover declared capability flags plus the mandatory text-chat baseline. */
export type LlmCapabilityProbeCapability =
  | keyof LlmGatewayCapabilities
  | "textChat";

/** One probe row in `llm-capabilities.json`. */
export interface LlmCapabilityProbeRecord {
  capability: LlmCapabilityProbeCapability;
  declared: boolean;
  outcome: LlmCapabilityProbeOutcome;
  detail?: string;
}

/**
 * Persistable capabilities artifact. Contains identity (role, deployment,
 * gateway release, model revision, optional model-weights SHA-256) and the
 * declared/observed capabilities. NEVER contains tokens, headers, or
 * reasoning traces.
 */
export interface LlmCapabilitiesArtifact {
  schemaVersion: typeof LLM_CAPABILITIES_SCHEMA_VERSION;
  contractVersion: typeof LLM_GATEWAY_CONTRACT_VERSION;
  generatedAt: string;
  jobId: string;
  role: LlmGatewayRole;
  compatibilityMode: LlmGatewayCompatibilityMode;
  deployment: string;
  modelRevision: string;
  gatewayRelease: string;
  modelWeightsSha256?: string;
  capabilities: LlmGatewayCapabilities;
  probes: LlmCapabilityProbeRecord[];
}

/** Tunable circuit-breaker thresholds for an LLM gateway client. */
export interface LlmGatewayCircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

/**
 * Construction-time configuration for an LLM gateway client.
 *
 * API tokens are NEVER in this object. Operators inject a token reader via
 * the runtime factory; the reader is invoked once per request and the value
 * is held only for the duration of that request.
 */
export interface LlmGatewayClientConfig {
  role: LlmGatewayRole;
  compatibilityMode: LlmGatewayCompatibilityMode;
  baseUrl: string;
  deployment: string;
  modelRevision: string;
  gatewayRelease: string;
  modelWeightsSha256?: string;
  authMode: LlmGatewayAuthMode;
  declaredCapabilities: LlmGatewayCapabilities;
  timeoutMs: number;
  maxRetries: number;
  circuitBreaker: LlmGatewayCircuitBreakerConfig;
  /**
   * Hard upper bound on the gateway response body, in bytes. The transport
   * counts decoded bytes during read and aborts the stream the moment the
   * running total exceeds this cap; the failure surfaces as
   * `errorClass: "response_too_large"` with `retryable: false` (Issue #1414).
   * The cap is enforced both via the `Content-Length` header (pre-read
   * short-circuit) and via streaming byte accounting (so a missing or
   * mendacious header still cannot exhaust memory). Defaults to
   * `8 * 1024 * 1024` (8 MiB) when omitted; positive integer values up to
   * `Number.MAX_SAFE_INTEGER` are accepted, anything else throws at
   * client construction. The mock gateway has no transport and ignores
   * this field.
   */
  maxResponseBytes?: number;
}

/** Image payload accepted by visual sidecars. Rejected for `test_generation`. */
export interface LlmImageInput {
  mimeType: string;
  base64Data: string;
}

/** Reasoning-effort hint forwarded only when `reasoningEffortSupport` is true. */
export type LlmReasoningEffort = "low" | "medium" | "high";

/** Wire-shaped request handed to a gateway client. */
export interface LlmGenerationRequest {
  jobId: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema?: Record<string, unknown>;
  responseSchemaName?: string;
  imageInputs?: ReadonlyArray<LlmImageInput>;
  seed?: number;
  reasoningEffort?: LlmReasoningEffort;
  /**
   * Optional client-side input-token budget. Gateway clients estimate the
   * outgoing prompt size (system + user prompt + structured-output schema +
   * any image payloads) and reject the request before transport with
   * `errorClass: "input_budget_exceeded"` (`retryable: false`) when the
   * estimate exceeds this cap (Issue #1415). Operators set the cap to bound
   * cost and to keep maliciously expanded Figma metadata from reaching the
   * gateway. Negative or non-integer values are rejected as `schema_invalid`.
   */
  maxInputTokens?: number;
  maxOutputTokens?: number;
  /**
   * Optional per-request wall-clock budget. When set, the request times out
   * after `maxWallClockMs` instead of the client config's `timeoutMs` if
   * smaller, AND the resulting timeout failure is surfaced with
   * `retryable: false` (FinOps fail-closed semantics — Issue #1371).
   */
  maxWallClockMs?: number;
  /**
   * Optional per-request retry cap. When set, the gateway uses
   * `min(config.maxRetries, request.maxRetries)` so an operator can bound
   * retry blast radius for an individual job without rebuilding the client
   * (Issue #1371).
   */
  maxRetries?: number;
}

/** Provider finish reasons normalized to a single set. */
export type LlmFinishReason =
  | "stop"
  | "length"
  | "content_filter"
  | "tool_calls"
  | "other";

/** Success outcome — never includes reasoning/CoT traces. */
export interface LlmGenerationSuccess {
  outcome: "success";
  content: unknown;
  rawTextContent?: string;
  finishReason: LlmFinishReason;
  usage: { inputTokens?: number; outputTokens?: number };
  modelDeployment: string;
  modelRevision: string;
  gatewayRelease: string;
  attempt: number;
}

/** Failure outcome with a redacted message and an explicit retryable flag. */
export interface LlmGenerationFailure {
  outcome: "error";
  errorClass: LlmGatewayErrorClass;
  message: string;
  retryable: boolean;
  attempt: number;
}

/** Discriminated union returned by `LlmGatewayClient.generate`. */
export type LlmGenerationResult = LlmGenerationSuccess | LlmGenerationFailure;

/** Theme brand policy applied during IR token derivation. */
export type WorkspaceBrandTheme = "derived" | "sparkasse";

/** Router mode for generated React application shells. */
export type WorkspaceRouterMode = "browser" | "hash";

/** Supported visual quality reference sources. */
export type WorkspaceVisualQualityReferenceMode =
  | "figma_api"
  | "frozen_fixture";

/** Supported browser engines for visual quality capture. */
export type WorkspaceVisualBrowserName = "chromium" | "firefox" | "webkit";

/** Explicit frozen visual reference files used by validate.project. */
export interface WorkspaceVisualQualityFrozenReference {
  imagePath: string;
  metadataPath: string;
}

/** Optional overrides for the combined visual/performance quality weights. */
export interface WorkspaceCompositeQualityWeightsInput {
  visual?: number;
  performance?: number;
}

/** Normalized weights for the combined visual/performance quality score. */
export interface WorkspaceCompositeQualityWeights {
  visual: number;
  performance: number;
}

/** Output format for operational runtime logs. */
export type WorkspaceLogFormat = "text" | "json";

/** Form handling mode for generated interactive forms. */
export type WorkspaceFormHandlingMode = "react_hook_form" | "legacy_use_state";

/** Source that produced a manual or imported component mapping rule. */
export type WorkspaceComponentMappingSource =
  | "local_override"
  | "code_connect_import";

/** Submit-time or regeneration-time component mapping override rule. */
export interface WorkspaceComponentMappingRule {
  id?: number;
  boardKey: string;
  nodeId?: string;
  nodeNamePattern?: string;
  canonicalComponentName?: string;
  storybookTier?: string;
  figmaLibrary?: string;
  semanticType?: string;
  componentName: string;
  importPath: string;
  propContract?: Record<string, unknown>;
  priority: number;
  source: WorkspaceComponentMappingSource;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Runtime status values for asynchronous workspace jobs. */
export type WorkspaceJobRuntimeStatus =
  | "queued"
  | "running"
  | "partial"
  | "completed"
  | "failed"
  | "canceled";

/** Stage status values for each pipeline stage. */
export type WorkspaceJobStageStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

/** Structured stage names exposed by workspace-dev. */
export type WorkspaceJobStageName =
  | "figma.source"
  | "ir.derive"
  | "template.prepare"
  | "codegen.generate"
  | "validate.project"
  | "repro.export"
  | "git.pr";

/** Retryable stage boundaries supported by persisted-artifact retry jobs. */
export type WorkspaceJobRetryStage =
  | "figma.source"
  | "ir.derive"
  | "template.prepare"
  | "codegen.generate";

/** Inspector-facing terminal outcome for a job. */
export type WorkspaceJobOutcome = "success" | "partial" | "failed";

/** Backend fallback mode surfaced to the inspector. */
export type WorkspaceJobFallbackMode = "none" | "rest" | "hybrid_rest";

/** Stable pipeline identifiers understood by workspace-dev. */
export type WorkspacePipelineId = "default" | "rocket" | (string & {});

/** Input scope resolved before pipeline selection. */
export type WorkspacePipelineScope = "board" | "node" | "selection";

/** Visibility class for a pipeline included in the current package profile. */
export type WorkspacePipelineVisibility = "oss" | "customer" | "internal";

/** Public stack identity for a pipeline template bundle. */
export interface WorkspacePipelineStackDescriptor {
  framework: string;
  language: string;
  styling: string;
  bundler: string;
}

/** Public template identity for a pipeline included in the current package profile. */
export interface WorkspacePipelineTemplateMetadata {
  bundleId: string;
  path: string;
  stack: WorkspacePipelineStackDescriptor;
}

/** Structured request-time pipeline selection failures. */
export const ALLOWED_PIPELINE_REQUEST_ERROR_CODES = [
  "INVALID_PIPELINE",
  "PIPELINE_UNAVAILABLE",
  "PIPELINE_SOURCE_MODE_UNSUPPORTED",
  "PIPELINE_SCOPE_UNSUPPORTED",
] as const;

/** Request-time pipeline selection error code. */
export type WorkspacePipelineRequestErrorCode =
  (typeof ALLOWED_PIPELINE_REQUEST_ERROR_CODES)[number];

/** Public descriptor for a pipeline included in the current package profile. */
export interface WorkspacePipelineDescriptor {
  id: WorkspacePipelineId;
  displayName: string;
  description: string;
  visibility?: WorkspacePipelineVisibility;
  deterministic?: true;
  template?: WorkspacePipelineTemplateMetadata;
  supportedSourceModes: WorkspaceFigmaSourceMode[];
  supportedScopes: WorkspacePipelineScope[];
}

/** Pipeline identity stamped onto job lifecycle records and public projections. */
export interface WorkspaceJobPipelineMetadata {
  pipelineId: WorkspacePipelineId;
  pipelineDisplayName: string;
  templateBundleId: string;
  buildProfile: string;
  deterministic: true;
}

/** Configuration for starting a workspace-dev server instance. */
export interface WorkspaceStartOptions {
  /** Host to bind to. Default: "127.0.0.1" */
  host?: string;
  /** Port to bind to. Default: 1983 */
  port?: number;
  /** Project-specific working directory. Default: process.cwd() */
  workDir?: string;
  /** Output root relative to workDir or as absolute path. Default: ".workspace-dev" */
  outputRoot?: string;
  /** Startup cleanup TTL for stale tmp-figma-paste JSON files in milliseconds. Default: 86400000 */
  figmaPasteTempTtlMs?: number;
  /** Figma request timeout in milliseconds. Default: 30000 */
  figmaRequestTimeoutMs?: number;
  /** Figma retry attempts. Default: 3 */
  figmaMaxRetries?: number;
  /** Consecutive transient failures before the Figma REST circuit breaker opens. Default: 3 */
  figmaCircuitBreakerFailureThreshold?: number;
  /** Duration in milliseconds that the Figma REST circuit breaker stays open before a probe request is allowed. Default: 30000 */
  figmaCircuitBreakerResetTimeoutMs?: number;
  /** Bootstrap depth for large-board staged fetch. Default: 5 */
  figmaBootstrapDepth?: number;
  /** Candidate node batch size for staged fetch. Default: 6 */
  figmaNodeBatchSize?: number;
  /** Number of concurrent staged /nodes fetch workers. Default: 3 */
  figmaNodeFetchConcurrency?: number;
  /** Enable adaptive node batch splitting on repeated oversized responses. Default: true */
  figmaAdaptiveBatchingEnabled?: boolean;
  /** Maximum staged screen candidates to fetch. Default: 40 */
  figmaMaxScreenCandidates?: number;
  /** Optional case-insensitive regex used to include staged screen candidates by name. */
  figmaScreenNamePattern?: string;
  /** Enable file-system cache for figma.source fetches. Default: true */
  figmaCacheEnabled?: boolean;
  /** Cache TTL for figma.source entries in milliseconds. Default: 900000 */
  figmaCacheTtlMs?: number;
  /** Maximum Figma JSON response bytes accepted before parse fallback/failure. Default: 67108864 */
  maxJsonResponseBytes?: number;
  /** Maximum IR cache entry count before eviction. Default: 50 */
  maxIrCacheEntries?: number;
  /** Maximum IR cache bytes retained on disk before eviction. Default: 134217728 */
  maxIrCacheBytes?: number;
  /** Path to icon fallback mapping file (JSON). Default: <outputRoot>/icon-fallback-map.json */
  iconMapFilePath?: string;
  /** Path to design-system mapping file (JSON). Default: <outputRoot>/design-system.json */
  designSystemFilePath?: string;
  /** Enable Figma image asset export to generated-app/public/images. Default: true */
  exportImages?: boolean;
  /** Maximum IR elements per screen before deterministic truncation. Default: 1200 */
  figmaScreenElementBudget?: number;
  /** Configured baseline depth limit for dynamic IR child traversal. Default: 14 */
  figmaScreenElementMaxDepth?: number;
  /** Token brand policy used when deriving IR tokens. Default: "derived" */
  brandTheme?: WorkspaceBrandTheme;
  /** Optional Sparkasse design-token file used only when `brandTheme="sparkasse"`; when omitted, built-in defaults are used. */
  sparkasseTokensFilePath?: string;
  /** Locale used for deterministic select-option number derivation. Default: "de-DE" */
  generationLocale?: string;
  /** Router mode for generated App.tsx shell. Default: "browser" */
  routerMode?: WorkspaceRouterMode;
  /** Timeout for external commands (pnpm/git) in milliseconds. Default: 900000 */
  commandTimeoutMs?: number;
  /** Maximum retained stdout bytes per external command before truncation/spooling. Default: 1048576 */
  commandStdoutMaxBytes?: number;
  /** Maximum retained stderr bytes per external command before truncation/spooling. Default: 1048576 */
  commandStderrMaxBytes?: number;
  /** Maximum structured diagnostics retained per pipeline error. Default: 25 */
  pipelineDiagnosticMaxCount?: number;
  /** Maximum message/suggestion characters retained per structured diagnostic. Default: 320 */
  pipelineDiagnosticTextMaxLength?: number;
  /** Maximum object keys retained per structured diagnostic details object. Default: 30 */
  pipelineDiagnosticDetailsMaxKeys?: number;
  /** Maximum array items retained per structured diagnostic details array. Default: 20 */
  pipelineDiagnosticDetailsMaxItems?: number;
  /** Maximum nesting depth retained when sanitizing structured diagnostic details. Default: 4 */
  pipelineDiagnosticDetailsMaxDepth?: number;
  /** Maximum validation retry attempts for lint/typecheck/build correction loops. Default: 3 */
  maxValidationAttempts?: number;
  /** Run lint auto-fix during validate.project before lint/typecheck/build. Default: true */
  enableLintAutofix?: boolean;
  /** Run perf validation during validate.project. Default: false */
  enablePerfValidation?: boolean;
  /** Run static UI validation in validate.project. Default: false */
  enableUiValidation?: boolean;
  /** Run visual quality validation in validate.project. Default: false */
  enableVisualQualityValidation?: boolean;
  /** Reference source for visual quality validation. Default: "figma_api" when enabled */
  visualQualityReferenceMode?: WorkspaceVisualQualityReferenceMode;
  /** Viewport width used when capturing generated output for visual quality validation. Default: 1280 */
  visualQualityViewportWidth?: number;
  /** Viewport height used when capturing generated output for visual quality validation. Default: 800 */
  visualQualityViewportHeight?: number;
  /** Device pixel ratio used when capturing generated output for visual quality validation. Default: 1 */
  visualQualityDeviceScaleFactor?: number;
  /** Browser engines used when capturing generated output for visual quality validation. Default: ["chromium"] */
  visualQualityBrowsers?: WorkspaceVisualBrowserName[];
  /** Weight overrides used when computing the combined visual/performance quality score. Default: visual 0.6, performance 0.4 */
  compositeQualityWeights?: WorkspaceCompositeQualityWeightsInput;
  /** Run generated-project unit tests in validate.project. Default: false */
  enableUnitTestValidation?: boolean;
  /** Make generated-project unit test failures non-fatal. When true, test results are recorded but failures do not throw. Default: false */
  unitTestIgnoreFailure?: boolean;
  /** Prefer offline package resolution during generated-project install. Default: true */
  installPreferOffline?: boolean;
  /** Skip package installation in validate.project; requires existing node_modules. Default: false */
  skipInstall?: boolean;
  /** Maximum number of jobs that may run concurrently. Default: 1 */
  maxConcurrentJobs?: number;
  /** Maximum number of queued jobs waiting for execution before backpressure rejects submit. Default: 20 */
  maxQueuedJobs?: number;
  /** Maximum retained job log entries. Default: 300 */
  logLimit?: number;
  /** Maximum on-disk bytes for job-owned roots before the pipeline fails. Default: 536870912 */
  maxJobDiskBytes?: number;
  /** Output format for operational runtime logs. Default: "text" */
  logFormat?: WorkspaceLogFormat;
  /** Maximum accepted job submissions and import-session event writes per minute for a single client IP, enforced separately per route family. Use 0 to disable. Default: 10 */
  rateLimitPerMinute?: number;
  /** Maximum graceful shutdown drain time in milliseconds before remaining connections are terminated. Default: 10000 */
  shutdownTimeoutMs?: number;
  /**
   * Bearer token accepted for `POST /workspace/import-sessions/:id/events`.
   * When omitted, import-session event writes fail closed.
   */
  importSessionEventBearerToken?: string;
  /** Enable local preview export and serving. Default: true */
  enablePreview?: boolean;
  /** Optional custom fetch implementation (for tests or custom runtimes). */
  fetchImpl?: typeof fetch;
  /**
   * @deprecated Reserved for backward compatibility with callers that reuse
   * submit-time option objects. Isolated child startup ignores this field and
   * it does not define any server-start target-root behavior.
   */
  targetPath?: string;
  /**
   * Opt-in startup feature gate for Figma-to-QC test case generation.
   *
   * Test intelligence is SEPARATE from the Figma-to-code mode lock and is
   * local-first by design. The feature is reachable only when both this
   * startup option and the `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1`
   * environment variable are enabled; otherwise, submitting a
   * `figma_to_qc_test_cases` job fails closed with a `503 Feature Disabled`
   * response and performs no side effects.
   *
   * A future-facing optional subpath export `workspace-dev/test-intelligence`
   * is planned to expose the full test-intelligence surface without
   * importing it from the root entry point; that export is not wired in
   * this wave.
   */
  testIntelligence?: {
    /** Whether test-intelligence features may be invoked at runtime. Default: false. */
    enabled: boolean;
    /**
     * Whether the Wave 4 multi-source ingestion gate (Issue #1431) is
     * permitted at runtime. Default: false. Strictly nested inside
     * {@link enabled}: even when this flag is true, multi-source
     * ingestion still fails closed unless `enabled === true` _and_ the
     * `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE` /
     * `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE` environment
     * gates are both set. Operators may flip this off at startup to
     * halt multi-source ingestion without redeploying.
     */
    multiSourceEnabled?: boolean;
    /**
     * Bearer token accepted by the Inspector test-intelligence review-gate
     * write routes (`POST /workspace/test-intelligence/review/...`). When
     * omitted or blank, review writes fail closed with `503` until the
     * operator configures a token. Reads do not require this token. This
     * legacy token is treated as one authenticated principal; configure
     * `reviewPrincipals` for true two-distinct-principal four-eyes approval.
     */
    reviewBearerToken?: string;
    /**
     * Principal-bound review credentials. When configured, approval actor
     * identity is derived from the matching bearer token rather than from
     * the request body, preventing forged reviewer identities (#1376).
     */
    reviewPrincipals?: TestIntelligenceReviewPrincipal[];
    /**
     * Optional override for the directory under which per-job
     * test-intelligence artifacts are stored and read by the Inspector
     * UI. When omitted, defaults to `<outputRoot>/test-intelligence`.
     * The directory is treated as opaque storage; missing artifacts
     * surface as empty UI states rather than errors.
     */
    artifactRoot?: string;
    /**
     * Risk categories for which the review gate must enforce four-eyes
     * approval (#1376). When omitted, defaults to
     * `DEFAULT_FOUR_EYES_REQUIRED_RISK_CATEGORIES`. Values outside the
     * `TestCaseRiskCategory` taxonomy are ignored. An empty array
     * disables risk-driven enforcement (visual-sidecar triggers still
     * apply unless `fourEyesVisualSidecarTriggerOutcomes` is also
     * empty).
     */
    fourEyesRequiredRiskCategories?: TestCaseRiskCategory[];
    /**
     * Visual-sidecar validation outcomes that trigger four-eyes review
     * for any case whose Figma trace references a screen carrying the
     * outcome (#1376, 2026-04-24 multimodal addendum). Defaults to
     * `DEFAULT_FOUR_EYES_VISUAL_SIDECAR_TRIGGERS`.
     */
    fourEyesVisualSidecarTriggerOutcomes?: VisualSidecarValidationOutcome[];
    /**
     * Whether the controlled OpenText ALM API transfer pipeline (#1372)
     * is allowed at runtime. Defaults to `false` (fail-closed). Even
     * when `true`, every other gate (feature flag, bearer token, dry-run
     * report, four-eyes, policy) must still pass before any write
     * leaves the process. Operators may flip this off to halt transfer
     * without redeploying.
     */
    allowApiTransfer?: boolean;
    /**
     * Bearer token accepted by the controlled OpenText ALM API transfer
     * pipeline (#1372) when `allowApiTransfer=true`. When omitted or
     * blank, every transfer attempt fails closed with
     * `bearer_token_missing`. The token is matched against the
     * caller-supplied bearer using a SHA-256 timing-safe compare so
     * incorrect lengths do not leak via timing. The token is treated as
     * a single authenticated principal; configure `transferPrincipals`
     * for multi-principal idempotent transfer audit trails.
     */
    transferBearerToken?: string;
    /**
     * Principal-bound transfer credentials (#1372). When configured,
     * the principal id of the matching token is recorded in
     * `transfer-report.json` audit metadata, enabling per-operator
     * audit lineage on top of the bearer-token check.
     */
    transferPrincipals?: TestIntelligenceTransferPrincipal[];
    /**
     * Whether the Jira sub-task write pipeline (#1482) is allowed at
     * runtime. Defaults to `false` (fail-closed). Even when `true`,
     * every other gate (feature flag, bearer token, parent issue key,
     * approved cases, policy/visual sidecar clear) must still pass
     * before any write leaves the process. Operators may flip this off
     * to halt Jira writes without redeploying.
     */
    allowJiraWrite?: boolean;
    /**
     * Bearer token used by the Jira sub-task write pipeline (#1482).
     * Fail-closed when omitted: every Jira write attempt refuses with
     * `bearer_token_missing`. The token is supplied to the configured
     * `JiraWriteClient` and is never persisted into emitted artifacts.
     */
    jiraWriteBearerToken?: string;
  };
}

/** Status of a running workspace-dev instance. */
export interface WorkspaceStatus {
  running: boolean;
  url: string;
  host: string;
  port: number;
  figmaSourceMode: WorkspaceFigmaSourceMode;
  llmCodegenMode: WorkspaceLlmCodegenMode;
  uptimeMs: number;
  outputRoot: string;
  previewEnabled: boolean;
  availablePipelines?: WorkspacePipelineDescriptor[];
  defaultPipelineId?: WorkspacePipelineId;
  /**
   * Whether the test-intelligence Inspector surface is reachable. True only
   * when both `WorkspaceStartOptions.testIntelligence.enabled` and
   * `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1` are satisfied. The Inspector
   * UI uses this flag to gate the "Test Intelligence" navigation entry.
   */
  testIntelligenceEnabled?: boolean;
  /**
   * Whether the Wave 4 multi-source ingestion gate (Issue #1431) is
   * reachable. True only when {@link testIntelligenceEnabled} is true,
   * `WorkspaceStartOptions.testIntelligence.multiSourceEnabled` is true,
   * and `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE=1` is set.
   * Independent of mode-lock isolation, which is enforced per request.
   */
  testIntelligenceMultiSourceEnabled?: boolean;
  /**
   * Whether the Inspector can reach a configured Jira REST gateway for
   * Jira API source ingestion. False means Jira paste remains the available
   * air-gapped Jira source path.
   */
  testIntelligenceJiraGatewayConfigured?: boolean;
}

/** Submission payload accepted by workspace-dev. */
export interface WorkspaceJobInput {
  pipelineId?: WorkspacePipelineId;
  figmaFileKey?: string;
  figmaNodeId?: string;
  figmaAccessToken?: string;
  figmaJsonPath?: string;
  figmaJsonPayload?: string;
  /** Optional import mode for Figma paste. `"auto"` lets the server pick delta vs full based on diff threshold. */
  importMode?: WorkspaceImportMode;
  /** Optional server-side generation scope. When present, only the selected IR nodes are kept for output generation. */
  selectedNodeIds?: string[];
  storybookStaticDir?: string;
  customerProfilePath?: string;
  customerBrandId?: string;
  componentMappings?: WorkspaceComponentMappingRule[];
  enableVisualQualityValidation?: boolean;
  visualQualityReferenceMode?: WorkspaceVisualQualityReferenceMode;
  visualQualityViewportWidth?: number;
  visualQualityViewportHeight?: number;
  visualQualityDeviceScaleFactor?: number;
  visualQualityBrowsers?: WorkspaceVisualBrowserName[];
  visualQualityFrozenReference?: WorkspaceVisualQualityFrozenReference;
  compositeQualityWeights?: WorkspaceCompositeQualityWeightsInput;
  /** @deprecated Use visual quality settings instead. */
  visualAudit?: WorkspaceVisualAuditInput;
  repoUrl?: string;
  repoToken?: string;
  enableGitPr?: boolean;
  figmaSourceMode?: WorkspaceFigmaSourceMode;
  llmCodegenMode?: WorkspaceLlmCodegenMode;
  projectName?: string;
  targetPath?: string;
  brandTheme?: WorkspaceBrandTheme;
  generationLocale?: string;
  formHandlingMode?: WorkspaceFormHandlingMode;
  /**
   * Optional job-type discriminator. When omitted, the submission is treated
   * as `figma_to_code`. Setting `figma_to_qc_test_cases` requires both the
   * `WorkspaceStartOptions.testIntelligence.enabled` startup flag and the
   * `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1` environment variable. When the
   * gates are not satisfied, the server returns `503 Feature Disabled`.
   */
  jobType?: WorkspaceJobType;
  /**
   * Optional test-intelligence mode namespace. Only relevant when
   * `jobType="figma_to_qc_test_cases"`. Values are validated independently
   * of `llmCodegenMode`, which remains locked to `deterministic`.
   */
  testIntelligenceMode?: WorkspaceTestIntelligenceMode;
  importIntent?: WorkspaceImportIntent;
  originalIntent?: WorkspaceImportIntent;
  intentCorrected?: boolean;
}

/** Public subset of request metadata stored for a job (secrets excluded). */
export interface WorkspaceJobRequestMetadata {
  pipelineId?: WorkspacePipelineId;
  pipelineMetadata?: WorkspaceJobPipelineMetadata;
  figmaFileKey?: string;
  figmaNodeId?: string;
  figmaJsonPath?: string;
  selectedNodeIds?: string[];
  storybookStaticDir?: string;
  customerProfilePath?: string;
  customerBrandId?: string;
  componentMappings?: WorkspaceComponentMappingRule[];
  enableVisualQualityValidation: boolean;
  visualQualityReferenceMode?: WorkspaceVisualQualityReferenceMode;
  visualQualityViewportWidth?: number;
  visualQualityViewportHeight?: number;
  visualQualityDeviceScaleFactor?: number;
  visualQualityBrowsers?: WorkspaceVisualBrowserName[];
  visualQualityFrozenReference?: WorkspaceVisualQualityFrozenReference;
  compositeQualityWeights?: WorkspaceCompositeQualityWeightsInput;
  /** @deprecated Compatibility alias for legacy callers. */
  visualAudit?: WorkspaceVisualAuditInput;
  repoUrl?: string;
  enableGitPr: boolean;
  figmaSourceMode: WorkspaceFigmaSourceMode;
  llmCodegenMode: WorkspaceLlmCodegenMode;
  projectName?: string;
  targetPath?: string;
  brandTheme: WorkspaceBrandTheme;
  generationLocale: string;
  formHandlingMode: WorkspaceFormHandlingMode;
  importMode?: WorkspaceImportMode;
  importIntent?: WorkspaceImportIntent;
  originalIntent?: WorkspaceImportIntent;
  intentCorrected?: boolean;
  requestSourceMode?: WorkspaceImportSessionSourceMode;
}

export type WorkspaceImportSessionStatus =
  | "imported"
  | "reviewing"
  | "approved"
  | "applied"
  | "rejected";

export type WorkspaceImportSessionEventKind =
  | "imported"
  | "review_started"
  | "approved"
  | "applied"
  | "rejected"
  | "apply_blocked"
  | "note";

export interface WorkspaceImportSessionEvent {
  id: string;
  sessionId: string;
  kind: WorkspaceImportSessionEventKind;
  at: string;
  actor?: string;
  note?: string;
  metadata?: Record<string, string | number | boolean | null>;
  sequence?: number;
}

export interface WorkspaceImportSessionEventsResponse {
  events: WorkspaceImportSessionEvent[];
}

export interface WorkspaceImportSession {
  id: string;
  jobId: string;
  sourceMode: WorkspaceImportSessionSourceMode;
  fileKey: string;
  nodeId: string;
  nodeName: string;
  importedAt: string;
  nodeCount: number;
  fileCount: number;
  selectedNodes: string[];
  scope: WorkspaceImportSessionScope;
  componentMappings: number;
  version?: string;
  pasteIdentityKey: string | null;
  replayable: boolean;
  replayDisabledReason?: string;
  userId?: string;
  qualityScore?: number;
  status?: WorkspaceImportSessionStatus;
  reviewRequired?: boolean;
}

export interface WorkspaceImportSessionsResponse {
  sessions: WorkspaceImportSession[];
}

export interface WorkspaceImportSessionReimportAccepted extends WorkspaceSubmitAccepted {
  sessionId: string;
  sourceJobId?: string;
}

export interface WorkspaceImportSessionDeleteResult {
  sessionId: string;
  deleted: true;
  jobId?: string;
}

/** Submit response for accepted jobs. */
export interface WorkspaceSubmitAccepted {
  jobId: string;
  status: "queued";
  pipelineId: WorkspacePipelineId;
  pipelineMetadata: WorkspaceJobPipelineMetadata;
  acceptedModes: {
    figmaSourceMode: WorkspaceFigmaSourceMode;
    llmCodegenMode: WorkspaceLlmCodegenMode;
  };
  importIntent?: WorkspaceImportIntent;
  /**
   * Per-paste delta summary computed at submit time for Figma paste imports.
   * Present only when `figmaSourceMode === "figma_paste" | "figma_plugin"` and diff succeeded.
   */
  pasteDeltaSummary?: WorkspacePasteDeltaSummary;
}

/** Stage details for each job stage. */
export interface WorkspaceJobStage {
  name: WorkspaceJobStageName;
  status: WorkspaceJobStageStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  message?: string;
}

/** Structured job log line. */
export interface WorkspaceJobLog {
  at: string;
  level: "debug" | "info" | "warn" | "error";
  stage?: WorkspaceJobStageName;
  message: string;
}

/** Severity levels emitted for structured job diagnostics. */
export type WorkspaceJobDiagnosticSeverity = "error" | "warning" | "info";

/** JSON-safe diagnostic payload values attached to structured job diagnostics. */
export type WorkspaceJobDiagnosticValue =
  | string
  | number
  | boolean
  | null
  | WorkspaceJobDiagnosticValue[]
  | { [key: string]: WorkspaceJobDiagnosticValue };

/** Structured diagnostic entry emitted for job, stage, or node-level issues. */
export interface WorkspaceJobDiagnostic {
  code: string;
  message: string;
  suggestion: string;
  stage: WorkspaceJobStageName;
  severity: WorkspaceJobDiagnosticSeverity;
  figmaNodeId?: string;
  figmaUrl?: string;
  details?: Record<string, WorkspaceJobDiagnosticValue>;
}

/** Retry target surfaced for failed-stage retries and failed generated files. */
export interface WorkspaceJobRetryTarget {
  kind: "stage" | "generated_file";
  stage: WorkspaceJobRetryStage;
  targetId: string;
  displayName?: string;
  filePath?: string;
  emittedScreenId?: string;
}

/** Inspector-facing metadata for a single pipeline stage. */
export interface WorkspaceJobInspectorStage {
  stage: WorkspaceJobStageName;
  status: WorkspaceJobStageStatus;
  retryable?: boolean;
  code?: string;
  message?: string;
  retryAfterMs?: number;
  fallbackMode?: WorkspaceJobFallbackMode;
  retryTargets?: WorkspaceJobRetryTarget[];
}

/** Inspector-facing backend result contract for recovery-aware paste flows. */
export interface WorkspaceJobInspector {
  pipelineId: WorkspacePipelineId;
  pipelineMetadata: WorkspaceJobPipelineMetadata;
  outcome?: WorkspaceJobOutcome;
  fallbackMode?: WorkspaceJobFallbackMode;
  /** Successful MCP read-tool calls consumed by this job. */
  mcpCallsConsumed?: number;
  retryableStages?: WorkspaceJobRetryStage[];
  retryTargets?: WorkspaceJobRetryTarget[];
  stages: WorkspaceJobInspectorStage[];
}

/** Artifact paths emitted by autonomous job execution. */
export interface WorkspaceJobArtifacts {
  outputRoot: string;
  jobDir: string;
  generatedProjectDir?: string;
  designIrFile?: string;
  figmaAnalysisFile?: string;
  businessTestIntentIrFile?: string;
  llmCapabilitiesEvidenceDir?: string;
  figmaJsonFile?: string;
  storybookTokensFile?: string;
  storybookThemesFile?: string;
  storybookComponentsFile?: string;
  componentVisualCatalogFile?: string;
  figmaLibraryResolutionFile?: string;
  componentMatchReportFile?: string;
  generationMetricsFile?: string;
  componentManifestFile?: string;
  validationSummaryFile?: string;
  stageTimingsFile?: string;
  generationDiffFile?: string;
  visualAuditReferenceImageFile?: string;
  visualAuditActualImageFile?: string;
  visualAuditDiffImageFile?: string;
  visualAuditReportFile?: string;
  visualQualityReportFile?: string;
  compositeQualityReportFile?: string;
  confidenceReportFile?: string;
  reproDir?: string;
}

/** Describes a modified file in the generation diff report. */
export interface WorkspaceGenerationDiffModifiedFile {
  file: string;
  previousHash: string;
  currentHash: string;
}

/** Generation diff report comparing current generation with the previous run. */
export interface WorkspaceGenerationDiffReport {
  boardKey: string;
  currentJobId: string;
  previousJobId: string | null;
  generatedAt: string;
  added: string[];
  modified: WorkspaceGenerationDiffModifiedFile[];
  removed: string[];
  unchanged: string[];
  summary: string;
}

/** Configuration for the optional visual audit capture flow. */
export interface WorkspaceVisualCaptureConfig {
  viewport?: {
    width?: number;
    height?: number;
    deviceScaleFactor?: number;
  };
  waitForNetworkIdle?: boolean;
  waitForFonts?: boolean;
  waitForAnimations?: boolean;
  timeoutMs?: number;
  fullPage?: boolean;
}

/** Configuration for the optional visual audit diff flow. */
export interface WorkspaceVisualDiffConfig {
  threshold?: number;
  includeAntialiasing?: boolean;
  alpha?: number;
}

/** Region definition used for visual diff breakdowns. */
export interface WorkspaceVisualDiffRegion {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Region result returned as part of a visual audit. */
export interface WorkspaceVisualAuditRegionResult extends WorkspaceVisualDiffRegion {
  diffPixelCount: number;
  totalPixels: number;
  deviationPercent: number;
}

/** Input payload for the optional visual audit flow. */
export interface WorkspaceVisualAuditInput {
  baselineImagePath: string;
  capture?: WorkspaceVisualCaptureConfig;
  diff?: WorkspaceVisualDiffConfig;
  regions?: WorkspaceVisualDiffRegion[];
}

/** Runtime status for the optional visual audit flow. */
export type WorkspaceVisualAuditStatus =
  | "not_requested"
  | "ok"
  | "warn"
  | "failed";

/** Computed output for the optional visual audit flow. */
export interface WorkspaceVisualAuditResult {
  status: WorkspaceVisualAuditStatus;
  baselineImagePath?: string;
  referenceImagePath?: string;
  actualImagePath?: string;
  diffImagePath?: string;
  reportPath?: string;
  similarityScore?: number;
  diffPixelCount?: number;
  totalPixels?: number;
  regions?: WorkspaceVisualAuditRegionResult[];
  warnings?: string[];
}

/** Frozen fixture metadata used for visual quality reference images. */
export interface WorkspaceVisualReferenceFixtureMetadata {
  capturedAt: string;
  source: {
    fileKey: string;
    nodeId: string;
    nodeName: string;
    lastModified: string;
  };
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
}

/** Scoring weights for the visual quality composite score. */
export interface WorkspaceVisualScoringWeights {
  layoutAccuracy: number;
  colorFidelity: number;
  typography: number;
  componentStructure: number;
  spacingAlignment: number;
}

/** Per-dimension score in a visual quality report. */
export interface WorkspaceVisualDimensionScore {
  name: string;
  weight: number;
  score: number;
  details: string;
}

/** Deviation hotspot identified in a visual quality comparison. */
export interface WorkspaceVisualDeviationHotspot {
  rank: number;
  region: string;
  x: number;
  y: number;
  width: number;
  height: number;
  deviationPercent: number;
  severity: "low" | "medium" | "high" | "critical";
  category: "layout" | "color" | "typography" | "component" | "spacing";
}

/** Metadata about a visual quality comparison run. */
export interface WorkspaceVisualComparisonMetadata {
  comparedAt: string;
  imageWidth: number;
  imageHeight: number;
  totalPixels: number;
  diffPixelCount: number;
  configuredWeights: WorkspaceVisualScoringWeights;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  versions: {
    packageVersion: string;
    contractVersion: string;
  };
}

export interface WorkspaceVisualCrossBrowserPairwiseDiff {
  browserA: WorkspaceVisualBrowserName;
  browserB: WorkspaceVisualBrowserName;
  diffPercent: number;
  diffImagePath?: string;
}

export interface WorkspaceVisualCrossBrowserConsistency {
  browsers: WorkspaceVisualBrowserName[];
  consistencyScore: number;
  pairwiseDiffs: WorkspaceVisualCrossBrowserPairwiseDiff[];
  warnings?: string[];
}

export interface WorkspaceVisualPerBrowserResult {
  browser: WorkspaceVisualBrowserName;
  overallScore: number;
  actualImagePath?: string;
  diffImagePath?: string;
  reportPath?: string;
  warnings?: string[];
}

export interface WorkspaceVisualComponentCoverage {
  comparedCount: number;
  skippedCount: number;
  coveragePercent: number;
  bySkipReason: Record<string, number>;
}

export interface WorkspaceVisualQualityComponentEntry {
  componentId: string;
  componentName: string;
  status: "compared" | "skipped";
  score?: number;
  diffImagePath?: string;
  reportPath?: string;
  skipReason?: string;
  storyEntryId?: string;
  referenceNodeId?: string;
  warnings?: string[];
}

/** Full visual quality report produced by the scoring system. */
export interface WorkspaceVisualQualityReport {
  status: "completed" | "failed" | "not_requested";
  referenceSource?: WorkspaceVisualQualityReferenceMode;
  capturedAt?: string;
  overallScore?: number;
  interpretation?: string;
  dimensions?: WorkspaceVisualDimensionScore[];
  componentAggregateScore?: number;
  componentCoverage?: WorkspaceVisualComponentCoverage;
  components?: WorkspaceVisualQualityComponentEntry[];
  diffImagePath?: string;
  hotspots?: WorkspaceVisualDeviationHotspot[];
  metadata?: WorkspaceVisualComparisonMetadata;
  browserBreakdown?: Partial<Record<WorkspaceVisualBrowserName, number>>;
  crossBrowserConsistency?: WorkspaceVisualCrossBrowserConsistency;
  perBrowser?: WorkspaceVisualPerBrowserResult[];
  warnings?: string[];
  message?: string;
}

/** Supported Lighthouse profiles in the combined visual/performance quality report. */
export type WorkspaceCompositeQualityLighthouseProfile = "mobile" | "desktop";

/** Per-sample Lighthouse metrics captured for the combined visual/performance quality report. */
export interface WorkspaceCompositeQualityLighthouseSample {
  profile: WorkspaceCompositeQualityLighthouseProfile;
  route: string;
  performanceScore: number | null;
  fcp_ms: number | null;
  lcp_ms: number | null;
  cls: number | null;
  tbt_ms: number | null;
  speed_index_ms: number | null;
}

/** Aggregated Lighthouse metrics included in the combined visual/performance quality report. */
export interface WorkspaceCompositeQualityPerformanceAggregateMetrics {
  fcp_ms: number | null;
  lcp_ms: number | null;
  cls: number | null;
  tbt_ms: number | null;
  speed_index_ms: number | null;
}

/** Performance breakdown included in the combined visual/performance quality report. */
export interface WorkspaceCompositeQualityPerformanceBreakdown {
  sourcePath?: string;
  score: number | null;
  sampleCount: number;
  samples: WorkspaceCompositeQualityLighthouseSample[];
  aggregateMetrics: WorkspaceCompositeQualityPerformanceAggregateMetrics;
  warnings: string[];
}

/** Dimensions that may contribute to the combined visual/performance quality score. */
export type WorkspaceCompositeQualityDimension = "visual" | "performance";

/** Combined visual + performance quality report surfaced by validate.project. */
export interface WorkspaceCompositeQualityReport {
  status: "completed" | "failed" | "not_requested";
  generatedAt?: string;
  weights?: WorkspaceCompositeQualityWeights;
  visual?: {
    score: number;
    ranAt: string;
    source: string;
  } | null;
  performance?: WorkspaceCompositeQualityPerformanceBreakdown | null;
  composite?: {
    score: number | null;
    includedDimensions: WorkspaceCompositeQualityDimension[];
    explanation: string;
  };
  warnings?: string[];
  message?: string;
}

/** PR execution status attached to completed jobs when Git PR integration is enabled. */
export interface WorkspaceGitPrStatus {
  status: "executed" | "skipped";
  reason?: string;
  prUrl?: string;
  branchName?: string;
  scopePath?: string;
  changedFiles?: string[];
}

/** Error information for failed jobs. */
export interface WorkspaceJobError {
  code: string;
  stage: WorkspaceJobStageName;
  message: string;
  retryable?: boolean;
  retryAfterMs?: number;
  fallbackMode?: WorkspaceJobFallbackMode;
  retryTargets?: WorkspaceJobRetryTarget[];
  diagnostics?: WorkspaceJobDiagnostic[];
}

/** Queue snapshot attached to job payloads for queue-state visibility. */
export interface WorkspaceJobQueueState {
  runningCount: number;
  queuedCount: number;
  maxConcurrentJobs: number;
  maxQueuedJobs: number;
  position?: number;
}

/** Cancellation metadata attached to jobs with cancel intent and terminal reason. */
export interface WorkspaceJobCancellation {
  requestedAt: string;
  reason: string;
  requestedBy: "api";
  completedAt?: string;
}

/** Full job status payload for polling endpoint. */
export interface WorkspaceJobStatus {
  jobId: string;
  pipelineId: WorkspacePipelineId;
  pipelineMetadata: WorkspaceJobPipelineMetadata;
  status: WorkspaceJobRuntimeStatus;
  outcome?: WorkspaceJobOutcome;
  currentStage?: WorkspaceJobStageName;
  submittedAt: string;
  startedAt?: string;
  finishedAt?: string;
  request: WorkspaceJobRequestMetadata;
  stages: WorkspaceJobStage[];
  logs: WorkspaceJobLog[];
  artifacts: WorkspaceJobArtifacts;
  preview: {
    enabled: boolean;
    url?: string;
  };
  queue: WorkspaceJobQueueState;
  pasteDeltaSummary?: WorkspacePasteDeltaSummary;
  cancellation?: WorkspaceJobCancellation;
  lineage?: WorkspaceJobLineage;
  generationDiff?: WorkspaceGenerationDiffReport;
  visualAudit?: WorkspaceVisualAuditResult;
  visualQuality?: WorkspaceVisualQualityReport;
  compositeQuality?: WorkspaceCompositeQualityReport;
  confidence?: WorkspaceJobConfidence;
  gitPr?: WorkspaceGitPrStatus;
  inspector?: WorkspaceJobInspector;
  error?: WorkspaceJobError;
}

/** Compact result payload for terminal-state inspection. */
export interface WorkspaceJobResult {
  jobId: string;
  pipelineId: WorkspacePipelineId;
  pipelineMetadata: WorkspaceJobPipelineMetadata;
  status: WorkspaceJobRuntimeStatus;
  outcome?: WorkspaceJobOutcome;
  summary: string;
  artifacts: WorkspaceJobArtifacts;
  preview: {
    enabled: boolean;
    url?: string;
  };
  pasteDeltaSummary?: WorkspacePasteDeltaSummary;
  lineage?: WorkspaceJobLineage;
  cancellation?: WorkspaceJobCancellation;
  generationDiff?: WorkspaceGenerationDiffReport;
  visualAudit?: WorkspaceVisualAuditResult;
  visualQuality?: WorkspaceVisualQualityReport;
  compositeQuality?: WorkspaceCompositeQualityReport;
  confidence?: WorkspaceJobConfidence;
  gitPr?: WorkspaceGitPrStatus;
  inspector?: WorkspaceJobInspector;
  error?: WorkspaceJobError;
}

/** Version information for the workspace-dev package. */
export interface WorkspaceVersionInfo {
  version: string;
  contractVersion: string;
}

/** Structured override entry for regeneration from Inspector drafts. */
export interface WorkspaceRegenerationOverrideEntry {
  nodeId: string;
  field: string;
  value:
    | string
    | number
    | boolean
    | { top: number; right: number; bottom: number; left: number };
}

/**
 * Submission payload for regeneration from a completed source job with IR overrides.
 *
 * Customer profile handling: regeneration reuses the source job's persisted
 * customer-profile snapshot (`STAGE_ARTIFACT_KEYS.customerProfileResolved`).
 * This interface intentionally exposes no `customerProfilePath` field — the
 * profile is not overridable at regeneration time. To regenerate against a
 * different profile, submit a new job.
 */
export interface WorkspaceRegenerationInput {
  sourceJobId: string;
  overrides: WorkspaceRegenerationOverrideEntry[];
  draftId?: string;
  baseFingerprint?: string;
  customerBrandId?: string;
  componentMappings?: WorkspaceComponentMappingRule[];
}

/** Submit response for accepted regeneration jobs. */
export interface WorkspaceRegenerationAccepted {
  jobId: string;
  sourceJobId: string;
  status: "queued";
  pipelineId: WorkspacePipelineId;
  pipelineMetadata: WorkspaceJobPipelineMetadata;
  acceptedModes: {
    figmaSourceMode: WorkspaceFigmaSourceMode;
    llmCodegenMode: WorkspaceLlmCodegenMode;
  };
}

/** Submission payload for retrying a failed or partial job from a persisted stage boundary. */
export interface WorkspaceRetryInput {
  sourceJobId: string;
  retryStage: WorkspaceJobRetryStage;
  retryTargets?: string[];
}

/** Submit response for accepted retry jobs. */
export interface WorkspaceRetryAccepted {
  jobId: string;
  sourceJobId: string;
  retryStage: WorkspaceJobRetryStage;
  status: "queued";
  pipelineId: WorkspacePipelineId;
  pipelineMetadata: WorkspaceJobPipelineMetadata;
  acceptedModes: {
    figmaSourceMode: WorkspaceFigmaSourceMode;
    llmCodegenMode: WorkspaceLlmCodegenMode;
  };
}

/** Lineage metadata linking a regeneration job to its source. */
export interface WorkspaceJobLineage {
  sourceJobId: string;
  kind?: "regeneration" | "retry" | "delta";
  pipelineMetadata?: WorkspaceJobPipelineMetadata;
  draftId?: string;
  baseFingerprint?: string;
  overrideCount: number;
  retryStage?: WorkspaceJobRetryStage;
  retryTargets?: string[];
}

/** Supported local sync execution modes. */
export type WorkspaceLocalSyncMode = "dry_run" | "apply";

/** File action the sync planner intends to perform for a path. */
export type WorkspaceLocalSyncFileAction = "create" | "overwrite" | "none";
/** File status reported by the sync planner after comparing generated, baseline, and destination states. */
export type WorkspaceLocalSyncFileStatus =
  | "create"
  | "overwrite"
  | "conflict"
  | "untracked"
  | "unchanged";
/** Reason explaining why a file received its planned sync status. */
export type WorkspaceLocalSyncFileReason =
  | "new_file"
  | "managed_destination_unchanged"
  | "destination_modified_since_sync"
  | "destination_deleted_since_sync"
  | "existing_without_baseline"
  | "already_matches_generated";
/** User decision applied to a single file in local sync preview/apply flows. */
export type WorkspaceLocalSyncFileDecision = "write" | "skip";

/** Dry-run request payload for previewing a local sync plan. */
export interface WorkspaceLocalSyncDryRunRequest {
  mode: "dry_run";
  targetPath?: string;
}

/** User decision for a single planned file during local sync apply. */
export interface WorkspaceLocalSyncFileDecisionEntry {
  path: string;
  decision: WorkspaceLocalSyncFileDecision;
}

/** Apply request payload for executing a previously previewed local sync plan. */
export interface WorkspaceLocalSyncApplyRequest {
  mode: "apply";
  confirmationToken: string;
  confirmOverwrite: boolean;
  fileDecisions: WorkspaceLocalSyncFileDecisionEntry[];
  reviewerNote?: string;
}

/** Union of supported local sync request payloads. */
export type WorkspaceLocalSyncRequest =
  | WorkspaceLocalSyncDryRunRequest
  | WorkspaceLocalSyncApplyRequest;

/** Planned file entry returned by local sync preview/apply flows. */
export interface WorkspaceLocalSyncFilePlanEntry {
  path: string;
  action: WorkspaceLocalSyncFileAction;
  status: WorkspaceLocalSyncFileStatus;
  reason: WorkspaceLocalSyncFileReason;
  decision: WorkspaceLocalSyncFileDecision;
  selectedByDefault: boolean;
  sizeBytes: number;
  message: string;
}

/** Aggregate counts and byte sizes for a planned local sync run. */
export interface WorkspaceLocalSyncSummary {
  totalFiles: number;
  selectedFiles: number;
  createCount: number;
  overwriteCount: number;
  conflictCount: number;
  untrackedCount: number;
  unchangedCount: number;
  totalBytes: number;
  selectedBytes: number;
}

/** Dry-run response payload describing a local sync plan before apply. */
export interface WorkspaceLocalSyncDryRunResult {
  jobId: string;
  sourceJobId: string;
  boardKey: string;
  targetPath: string;
  scopePath: string;
  destinationRoot: string;
  files: WorkspaceLocalSyncFilePlanEntry[];
  summary: WorkspaceLocalSyncSummary;
  confirmationToken: string;
  confirmationExpiresAt: string;
}

/** Apply response payload describing the executed local sync plan. */
export interface WorkspaceLocalSyncApplyResult {
  jobId: string;
  sourceJobId: string;
  boardKey: string;
  targetPath: string;
  scopePath: string;
  destinationRoot: string;
  files: WorkspaceLocalSyncFilePlanEntry[];
  summary: WorkspaceLocalSyncSummary;
  appliedAt: string;
}

/** Input payload for creating a PR from a completed regeneration job. */
export interface WorkspaceCreatePrInput {
  repoUrl: string;
  repoToken: string;
  targetPath?: string;
  reviewerNote?: string;
}

/** Result payload returned after PR creation from a regenerated job. */
export interface WorkspaceCreatePrResult {
  jobId: string;
  sourceJobId: string;
  gitPr: WorkspaceGitPrStatus;
}

/** Prerequisites check result for PR creation from a regenerated job. */
export interface WorkspaceGitPrPrerequisites {
  available: boolean;
  missing: string[];
}

/** User decision for handling a stale draft. */
export type WorkspaceStaleDraftDecision =
  | "continue"
  | "discard"
  | "carry-forward";

/** Result of a stale-draft check for a given job. */
export interface WorkspaceStaleDraftCheckResult {
  /** Whether the draft's source job is stale (a newer completed job exists for the same board key). */
  stale: boolean;
  /** The job ID of the latest completed job for the same board key (if stale). */
  latestJobId: string | null;
  /** The job ID the draft was created from. */
  sourceJobId: string;
  /** Board key shared by source and latest jobs. */
  boardKey: string | null;
  /** Whether carry-forward is available (all draft node IDs exist in the latest job's IR). */
  carryForwardAvailable: boolean;
  /** Node IDs from the draft that could not be resolved in the latest job's IR. */
  unmappedNodeIds: string[];
  /** Human-readable explanation of the stale state. */
  message: string;
}

// ---------------------------------------------------------------------------
// Remap suggestion types for guided stale-draft override remapping (#466)
// ---------------------------------------------------------------------------

/** User decision for handling a stale draft — extended with remap option. */
export type WorkspaceStaleDraftDecisionExtended =
  | WorkspaceStaleDraftDecision
  | "remap";

/** Confidence level for a remap suggestion. */
export type WorkspaceRemapConfidence = "high" | "medium" | "low";

/** Rule that produced a remap suggestion. */
export type WorkspaceRemapRule =
  | "exact-id"
  | "name-and-type"
  | "name-fuzzy-and-type"
  | "ancestry-and-type";

/** A single remap suggestion mapping a source node to a candidate target node. */
export interface WorkspaceRemapSuggestion {
  /** The original node ID from the stale draft override. */
  sourceNodeId: string;
  /** The original node name (from the source IR). */
  sourceNodeName: string;
  /** The element type of the source node. */
  sourceNodeType: string;
  /** The suggested target node ID in the latest IR. */
  targetNodeId: string;
  /** The target node name in the latest IR. */
  targetNodeName: string;
  /** The element type of the target node. */
  targetNodeType: string;
  /** The rule that produced this suggestion. */
  rule: WorkspaceRemapRule;
  /** Confidence level of the suggestion. */
  confidence: WorkspaceRemapConfidence;
  /** Human-readable reason for the suggestion. */
  reason: string;
}

/** A source node for which no remap could be determined. */
export interface WorkspaceRemapRejection {
  /** The unmappable node ID from the stale draft. */
  sourceNodeId: string;
  /** The original node name (from the source IR). */
  sourceNodeName: string;
  /** The element type of the source node. */
  sourceNodeType: string;
  /** Human-readable reason why remapping was not possible. */
  reason: string;
}

/** Input payload for the remap-suggest endpoint. */
export interface WorkspaceRemapSuggestInput {
  /** The stale source job ID whose draft overrides need remapping. */
  sourceJobId: string;
  /** The latest job ID to remap into. */
  latestJobId: string;
  /** Node IDs from the draft that need remapping (those not found in the latest IR). */
  unmappedNodeIds: string[];
}

/** Result of the remap-suggest endpoint. */
export interface WorkspaceRemapSuggestResult {
  sourceJobId: string;
  latestJobId: string;
  suggestions: WorkspaceRemapSuggestion[];
  rejections: WorkspaceRemapRejection[];
  message: string;
}

/** A user decision on a single remap suggestion. */
export interface WorkspaceRemapDecisionEntry {
  sourceNodeId: string;
  targetNodeId: string | null;
  accepted: boolean;
}

// ---------------------------------------------------------------------------
// Generation confidence model types (#849)
// ---------------------------------------------------------------------------

/** Confidence level for a generated job, screen, or component. */
export type WorkspaceConfidenceLevel = "high" | "medium" | "low" | "very_low";

/** A single explainable contributor to a confidence score. */
export interface WorkspaceConfidenceContributor {
  signal: string;
  impact: "positive" | "negative" | "neutral";
  weight: number;
  value: number;
  detail: string;
}

/** Per-component confidence assessment. */
export interface WorkspaceComponentConfidence {
  componentId: string;
  componentName: string;
  level: WorkspaceConfidenceLevel;
  score: number;
  contributors: WorkspaceConfidenceContributor[];
}

/** Per-screen confidence assessment. */
export interface WorkspaceScreenConfidence {
  screenId: string;
  screenName: string;
  level: WorkspaceConfidenceLevel;
  score: number;
  contributors: WorkspaceConfidenceContributor[];
  components: WorkspaceComponentConfidence[];
}

/** Job-level confidence report produced by the scoring model. */
export interface WorkspaceJobConfidence {
  status: "completed" | "failed" | "not_requested";
  generatedAt?: string;
  level?: WorkspaceConfidenceLevel;
  score?: number;
  contributors?: WorkspaceConfidenceContributor[];
  screens?: WorkspaceScreenConfidence[];
  lowConfidenceSummary?: string[];
  message?: string;
}

/**
 * Business Test Intent IR surface (Issue #1361).
 *
 * The IR is the sanitized, test-design-oriented input that the downstream
 * test-case generator consumes. Raw Figma payloads must never reach prompt
 * compilation — PII-like mock values are detected and replaced with opaque
 * redaction tokens before any artifact is persisted.
 */

/** Schema version for `BusinessTestIntentIr` artifacts. */
export const BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Known PII-like categories detected in mock form data and Jira payloads.
 *
 * Wave 4.B (Issue #1432) extended this union with three Jira-aware
 * categories: `internal_hostname` (corporate hostname patterns surfaced
 * inside ADF text), `jira_mention` (Confluence/Jira `@user` mentions and
 * raw account ids), and `customer_name_placeholder` (full-name-shaped
 * values pulled from common Jira customer-facing custom-field names).
 *
 * Adding new union members is treated as a minor contract bump per
 * `CONTRACT_CHANGELOG.md`'s versioning rules — consumers reading the IR
 * may receive previously-unseen `kind` values.
 */
export type PiiKind =
  | "iban"
  | "bic"
  | "pan"
  | "tax_id"
  | "email"
  | "phone"
  | "full_name"
  | "internal_hostname"
  | "jira_mention"
  | "customer_name_placeholder";

/** Where a detected element came from during reconciliation. */
export type IntentProvenance = "figma_node" | "visual_sidecar" | "reconciled";

/**
 * Location within the input that held a PII-like match.
 *
 * Wave 4.B (Issue #1432) extends this union with Jira-IR-specific
 * locations so adversarial-fixture and audit code can attribute every
 * indicator back to the exact field it was sourced from.
 */
export type PiiMatchLocation =
  | "field_label"
  | "field_default_value"
  | "screen_text"
  | "action_label"
  | "trace_node_name"
  | "trace_node_path"
  | "screen_name"
  | "screen_path"
  | "validation_rule"
  | "navigation_target"
  | "jira_summary"
  | "jira_description"
  | "jira_acceptance_criterion"
  | "jira_comment_body"
  | "jira_custom_field_name"
  | "jira_custom_field_value"
  | "jira_attachment_filename"
  | "jira_link_relationship"
  | "jira_label"
  | "jira_component"
  | "custom_context_markdown"
  | "custom_context_attribute";

/**
 * Reference to the Figma node that produced an intent element.
 *
 * Wave 4 (Issue #1431) extends this trace with an optional array of
 * contributing {@link TestIntentSourceRef} entries so a single trace may
 * record multiple sources that agreed on (or conflicted over) a field.
 * The legacy `nodeId` / `nodeName` / `nodePath` fields keep working for
 * single-source Figma traces.
 */
export interface IntentTraceRef {
  nodeId?: string;
  nodeName?: string;
  nodePath?: string;
  /**
   * Contributing source references for this trace (Issue #1431).
   * Optional — omitted for legacy single-source Figma jobs to keep
   * artifacts byte-stable. When present, each entry MUST match an entry
   * in the surrounding {@link MultiSourceTestIntentEnvelope.sources}
   * array by `sourceId`.
   */
  sourceRefs?: TestIntentSourceRef[];
}

/** Ambiguity note attached to a detected element or PII indicator. */
export interface IntentAmbiguity {
  reason: string;
}

/** PII indicator attached to a detected element. Original values are never persisted. */
export interface PiiIndicator {
  id: string;
  kind: PiiKind;
  confidence: number;
  matchLocation: PiiMatchLocation;
  redacted: string;
  screenId?: string;
  elementId?: string;
  traceRef?: IntentTraceRef;
}

/** Record describing a single redaction decision. */
export interface IntentRedaction {
  id: string;
  indicatorId: string;
  kind: PiiKind;
  reason: string;
  replacement: string;
}

/**
 * Input field inferred from a screen.
 *
 * Wave 4 (Issue #1431) adds the optional `sourceRefs` array so the
 * derivation pipeline can record every source that contributed to this
 * field. The legacy singular `trace` and `provenance` fields keep
 * working unchanged for single-source jobs.
 */
export interface DetectedField {
  id: string;
  screenId: string;
  trace: IntentTraceRef;
  provenance: IntentProvenance;
  confidence: number;
  label: string;
  type: string;
  defaultValue?: string;
  ambiguity?: IntentAmbiguity;
  /** Contributing sources (Issue #1431). Optional, additive. */
  sourceRefs?: TestIntentSourceRef[];
}

/**
 * Action/control inferred from a screen (e.g. Submit button).
 *
 * Wave 4 (Issue #1431) adds the optional `sourceRefs` array; see
 * {@link DetectedField} for backward-compat semantics.
 */
export interface DetectedAction {
  id: string;
  screenId: string;
  trace: IntentTraceRef;
  provenance: IntentProvenance;
  confidence: number;
  label: string;
  kind: string;
  ambiguity?: IntentAmbiguity;
  /** Contributing sources (Issue #1431). Optional, additive. */
  sourceRefs?: TestIntentSourceRef[];
}

/**
 * Validation rule inferred from design hints.
 *
 * Wave 4 (Issue #1431) adds the optional `sourceRefs` array; see
 * {@link DetectedField} for backward-compat semantics.
 */
export interface DetectedValidation {
  id: string;
  screenId: string;
  trace: IntentTraceRef;
  provenance: IntentProvenance;
  confidence: number;
  rule: string;
  targetFieldId?: string;
  ambiguity?: IntentAmbiguity;
  /** Contributing sources (Issue #1431). Optional, additive. */
  sourceRefs?: TestIntentSourceRef[];
}

/**
 * Navigation edge inferred from prototype links or equivalent.
 *
 * Wave 4 (Issue #1431) adds the optional `sourceRefs` array; see
 * {@link DetectedField} for backward-compat semantics.
 */
export interface DetectedNavigation {
  id: string;
  screenId: string;
  trace: IntentTraceRef;
  provenance: IntentProvenance;
  confidence: number;
  targetScreenId: string;
  triggerElementId?: string;
  ambiguity?: IntentAmbiguity;
  /** Contributing sources (Issue #1431). Optional, additive. */
  sourceRefs?: TestIntentSourceRef[];
}

/**
 * Business-object cluster inferred across one or more fields.
 *
 * Wave 4 (Issue #1431) adds the optional `sourceRefs` array; see
 * {@link DetectedField} for backward-compat semantics.
 */
export interface InferredBusinessObject {
  id: string;
  screenId: string;
  trace: IntentTraceRef;
  provenance: IntentProvenance;
  confidence: number;
  name: string;
  fieldIds: string[];
  ambiguity?: IntentAmbiguity;
  /** Contributing sources (Issue #1431). Optional, additive. */
  sourceRefs?: TestIntentSourceRef[];
}

/** Per-screen slice of the intent. */
export interface BusinessTestIntentScreen {
  screenId: string;
  screenName: string;
  screenPath?: string;
  trace: IntentTraceRef;
}

/**
 * Metadata about the input that produced the IR.
 *
 * Wave 4 (Issue #1431) generalises this single-source descriptor into a
 * discriminated union of seven source kinds carried inside the
 * {@link MultiSourceTestIntentEnvelope}. The legacy `source` field on
 * {@link BusinessTestIntentIr} is kept additive for one minor cycle so
 * single-source Figma jobs that have not opted into the multi-source gate
 * keep producing bit-identical artifacts.
 */
export interface BusinessTestIntentIrSource {
  kind: "figma_local_json" | "figma_plugin" | "figma_rest" | "hybrid";
  contentHash: string;
}

/**
 * Redacted, deterministic test-design IR for a job.
 *
 * Wave 4 (Issue #1431) introduces an additive {@link sourceEnvelope} field
 * carrying the multi-source aggregate. The legacy {@link source} singleton
 * is preserved for backward-compat: single-source Figma jobs that have not
 * opted into the multi-source gate keep emitting it as-is.
 */
export interface BusinessTestIntentIr {
  version: typeof BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION;
  source: BusinessTestIntentIrSource;
  screens: BusinessTestIntentScreen[];
  detectedFields: DetectedField[];
  detectedActions: DetectedAction[];
  detectedValidations: DetectedValidation[];
  detectedNavigation: DetectedNavigation[];
  inferredBusinessObjects: InferredBusinessObject[];
  risks: string[];
  assumptions: string[];
  openQuestions: string[];
  piiIndicators: PiiIndicator[];
  redactions: IntentRedaction[];
  /**
   * Aggregate envelope of contributing test-design sources (Issue #1431).
   *
   * Optional and additive: omitted for legacy single-source Figma jobs to
   * preserve byte-stable artifacts and replay-cache hits. Populated only
   * when both the parent {@link TEST_INTELLIGENCE_ENV} gate and the
   * {@link TEST_INTELLIGENCE_MULTISOURCE_ENV} gate are enabled, and the
   * parent test-intelligence startup option allows multi-source ingestion.
   */
  sourceEnvelope?: MultiSourceTestIntentEnvelope;
  /**
   * Additive conflict/report payload emitted by the deterministic multi-source
   * reconciliation engine (Issue #1436). Omitted for legacy single-source
   * jobs so existing artifacts remain byte-stable.
   */
  multiSourceConflicts?: MultiSourceConflict[];
}

/**
 * Source kinds recognised by the multi-source Test Intent ingestion
 * pipeline (Issue #1431). The first three are existing Figma kinds; the
 * remaining four are introduced by Wave 4 issues 4.B–4.E. `custom_markdown`
 * is added by Issue #1441 as a dedicated Markdown supporting source kind.
 */
export const ALLOWED_TEST_INTENT_SOURCE_KINDS = [
  "figma_local_json",
  "figma_plugin",
  "figma_rest",
  "jira_rest",
  "jira_paste",
  "custom_text",
  "custom_structured",
  "custom_markdown",
] as const;

/** Discriminated source-kind alias derived from {@link ALLOWED_TEST_INTENT_SOURCE_KINDS}. */
export type TestIntentSourceKind =
  (typeof ALLOWED_TEST_INTENT_SOURCE_KINDS)[number];

/**
 * Primary source kinds — at least one of these must be present in any
 * envelope. A custom-only envelope must fail validation with
 * `primary_source_required` (Issue #1431, source-mix hardening addendum).
 */
export const PRIMARY_TEST_INTENT_SOURCE_KINDS = [
  "figma_local_json",
  "figma_plugin",
  "figma_rest",
  "jira_rest",
  "jira_paste",
] as const;

/** Subset alias for primary source kinds. */
export type PrimaryTestIntentSourceKind =
  (typeof PRIMARY_TEST_INTENT_SOURCE_KINDS)[number];

/**
 * Supporting (non-primary) source kinds — may only appear alongside at
 * least one primary source. `custom_markdown` is a dedicated Markdown
 * supporting source kind (Issue #1441); it always carries
 * `redactedMarkdownHash` + `plainTextDerivativeHash` and never requires
 * `inputFormat` since its format is intrinsically Markdown.
 */
export const SUPPORTING_TEST_INTENT_SOURCE_KINDS = [
  "custom_text",
  "custom_structured",
  "custom_markdown",
] as const;

/** Subset alias for supporting source kinds. */
export type SupportingTestIntentSourceKind =
  (typeof SUPPORTING_TEST_INTENT_SOURCE_KINDS)[number];

/**
 * Conflict-resolution policy discriminant carried on every envelope.
 *
 * - `priority` — apply {@link MultiSourceTestIntentEnvelope.priorityOrder}
 *   when sources disagree on a field. The aggregate hash MUST encode the
 *   priority order so swapping it forces a cache miss.
 * - `reviewer_decides` — surface conflicts to the reviewer and keep both
 *   variants until the reviewer chooses one.
 * - `keep_both` — emit independent test cases per source without merging.
 */
export const ALLOWED_CONFLICT_RESOLUTION_POLICIES = [
  "priority",
  "reviewer_decides",
  "keep_both",
] as const;

/** Conflict-resolution policy alias. */
export type ConflictResolutionPolicy =
  (typeof ALLOWED_CONFLICT_RESOLUTION_POLICIES)[number];

/**
 * Recognised input formats for `custom_text` / `custom_structured` sources
 * (Markdown-aware addendum, 2026-04-26). Markdown is treated as
 * user-provided supporting evidence and is NEVER trusted as instructions
 * to the model or runtime.
 */
export const ALLOWED_TEST_INTENT_CUSTOM_INPUT_FORMATS = [
  "plain_text",
  "markdown",
  "structured_json",
] as const;

/** Custom input-format alias. */
export type TestIntentCustomInputFormat =
  (typeof ALLOWED_TEST_INTENT_CUSTOM_INPUT_FORMATS)[number];

/**
 * Reference to a single contributing source inside a
 * {@link MultiSourceTestIntentEnvelope}. References are stable per envelope
 * and never carry raw source bytes — only redacted hashes and structured
 * provenance hints.
 */
export interface TestIntentSourceRef {
  /** Stable identifier per envelope, e.g. `"src.0"`, `"src.1"`. */
  sourceId: string;
  /** Discriminated source kind. */
  kind: TestIntentSourceKind;
  /** SHA-256 of the canonicalised source bytes (lowercase hex, 64 chars). */
  contentHash: string;
  /** ISO-8601 UTC capture timestamp (millisecond precision, `Z` suffix). */
  capturedAt: string;
  /**
   * Opaque, non-PII operator handle for paste/custom sources. Never store
   * raw email addresses or full names — callers MUST redact before set.
   */
  authorHandle?: string;
  /**
   * Input format for `custom_text` / `custom_structured`. Required for
   * those kinds, MUST be omitted for primary kinds.
   */
  inputFormat?: TestIntentCustomInputFormat;
  /**
   * Note-entry id for Markdown-authored custom sources (Markdown
   * addendum). Lets provenance references identify the source row in the
   * reviewer note store. Optional, ignored for non-Markdown sources.
   */
  noteEntryId?: string;
  /**
   * Markdown section path (heading / table / list context) for Markdown
   * custom sources, e.g. `"# Risks > ## PII handling"`. Optional and
   * ignored for non-Markdown sources.
   */
  markdownSectionPath?: string;
  /**
   * Canonical Jira issue key for `jira_rest` / `jira_paste` sources, e.g.
   * `"PAY-1234"`. When both REST and paste sources carry the same key, the
   * validator reports `duplicate_jira_paste_collision` so downstream Wave 4.D
   * routing can resolve the paste collision explicitly.
   */
  canonicalIssueKey?: string;
  /**
   * SHA-256 hash of the canonical redacted Markdown for Markdown-authored
   * custom sources. Raw Markdown is never stored in the envelope.
   */
  redactedMarkdownHash?: string;
  /**
   * SHA-256 hash of the deterministic plain-text derivative produced from the
   * redacted Markdown. This lets prompt-isolation code audit what evidence was
   * made available without treating Markdown as instructions.
   */
  plainTextDerivativeHash?: string;
}

/** PII-redacted Markdown note persisted as custom supporting context. */
export interface CustomContextNoteEntry {
  entryId: string;
  authorHandle: string;
  capturedAt: string;
  inputFormat: "markdown";
  /** Canonical allowlist Markdown after PII redaction. */
  bodyMarkdown: string;
  /** Deterministic plain-text derivative of {@link bodyMarkdown}. */
  bodyPlain: string;
  markdownContentHash: string;
  plainContentHash: string;
  piiIndicators: PiiIndicator[];
  redactions: IntentRedaction[];
}

/** Validated machine-checkable custom supporting attributes. */
export interface CustomContextStructuredEntry {
  entryId: string;
  authorHandle: string;
  capturedAt: string;
  attributes: Array<{ key: string; value: string }>;
  contentHash: string;
  piiIndicators: PiiIndicator[];
  redactions: IntentRedaction[];
}

/** Persisted custom-context source artifact. */
export interface CustomContextSource {
  version: typeof CUSTOM_CONTEXT_SCHEMA_VERSION;
  sourceKind: "custom_text" | "custom_structured";
  noteEntries: CustomContextNoteEntry[];
  structuredEntries: CustomContextStructuredEntry[];
  aggregateContentHash: string;
}

/** Recognized custom attribute and its intended downstream consumer. */
export interface SuggestedCustomContextAttribute {
  key: string;
  label: string;
  downstreamConsumer: string;
  description: string;
}

/** Curated structured-attribute schema surfaced to API and UI consumers. */
export const SUGGESTED_CUSTOM_CONTEXT_ATTRIBUTES: readonly SuggestedCustomContextAttribute[] =
  [
    {
      key: "regulatory_scope",
      label: "regulatoryScope",
      downstreamConsumer: "policy_gate.risk_classifier",
      description: "Regulatory scope hints such as PSD2 or GDPR.",
    },
    {
      key: "test_environment",
      label: "testEnvironment",
      downstreamConsumer: "prompt_context",
      description: "Target execution environment such as preprod-eu.",
    },
    {
      key: "data_class",
      label: "dataClass",
      downstreamConsumer: "policy_gate.risk_classifier",
      description: "Sensitive data classification such as PCI-DSS-3.",
    },
    {
      key: "priority_hint",
      label: "priorityHint",
      downstreamConsumer: "prompt_context",
      description: "Reviewer priority hint for generated coverage.",
    },
    {
      key: "feature_flag",
      label: "featureFlag",
      downstreamConsumer: "prompt_context.qc_export",
      description: "Feature flag context such as NEW_CHECKOUT=on.",
    },
    {
      key: "non_functional_profile",
      label: "nonFunctionalProfile",
      downstreamConsumer: "prompt_context",
      description: "Non-functional testing profile such as latency or a11y.",
    },
  ];

/** Policy signal derived from recognized custom structured attributes. */
export interface CustomContextPolicySignal {
  sourceId: string;
  entryId: string;
  attributeKey: string;
  attributeValue: string;
  riskCategory: TestCaseRiskCategory;
  reason: string;
  contentHash: string;
}

/**
 * Forward reference for source-mix orchestration owned by Issue #1441. Wave
 * 4.A validates the shape only; pipeline routing and reconciliation remain in
 * the downstream source-mix issue.
 */
export interface MultiSourceTestIntentSourceMixPlanRef {
  /** Stable hash of the source-mix plan payload owned by Issue #1441. */
  planHash: string;
  /** Ownership marker for downstream orchestration. */
  ownerIssue: "#1441";
}

/**
 * Aggregate envelope of contributing sources (Issue #1431).
 *
 * The envelope is a pure value object; ingestion logic, reconciliation,
 * and orchestration live in downstream Wave 4 issues (4.B / 4.C / 4.D /
 * 4.E / 4.F / 4.H). The envelope guarantees:
 *
 *   1. At least one source.
 *   2. At least one primary source (primary-source-required rule).
 *   3. Stable {@link aggregateContentHash} that is invariant under source
 *      reordering when {@link conflictResolutionPolicy} is not `priority`,
 *      and changes when source content actually changes.
 *   4. When `conflictResolutionPolicy="priority"`, a non-empty
 *      {@link priorityOrder} listing every source kind present in the
 *      envelope (no extras).
 */
export interface MultiSourceTestIntentEnvelope {
  /** Schema version stamp. */
  version: typeof MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION;
  /** Ordered list of contributing sources (length ≥ 1). */
  sources: TestIntentSourceRef[];
  /**
   * Stable aggregate hash of the contributing sources. Computed via
   * `sha256Hex` of the canonical-sorted (`contentHash`, `kind`) pairs by
   * default, with the `priorityOrder` mixed in when the resolution policy
   * is `priority`.
   */
  aggregateContentHash: string;
  /** Resolution discriminant for cross-source disagreement. */
  conflictResolutionPolicy: ConflictResolutionPolicy;
  /**
   * Required when {@link conflictResolutionPolicy} is `priority`: an
   * ordered, deduplicated list of source kinds covering every kind that
   * appears in {@link sources}. The list participates in the aggregate
   * hash so a different priority order produces a different hash.
   */
  priorityOrder?: TestIntentSourceKind[];
  /** Optional source-mix plan hook owned by Issue #1441. */
  sourceMixPlan?: MultiSourceTestIntentSourceMixPlanRef;
}

/** Schema version for `multi-source-conflicts.json` (Issue #1436). */
export const MULTI_SOURCE_RECONCILIATION_REPORT_SCHEMA_VERSION =
  "1.0.0" as const;

/** Canonical filename for the deterministic multi-source conflict artifact. */
export const MULTI_SOURCE_CONFLICT_REPORT_ARTIFACT_FILENAME =
  "multi-source-conflicts.json" as const;

/** Kinds of cross-source disagreement recognized by Issue #1436. */
export type MultiSourceConflictKind =
  | "field_label_mismatch"
  | "validation_rule_mismatch"
  | "risk_category_mismatch"
  | "test_data_example_mismatch"
  | "duplicate_acceptance_criterion"
  | "paste_collision";

/** One deterministic conflict row emitted by the reconciliation engine. */
export interface MultiSourceConflict {
  /** SHA-256 of `{ kind, sourceRefs, normalizedValues }`. */
  conflictId: string;
  kind: MultiSourceConflictKind;
  participatingSourceIds: string[];
  /** Sorted, redacted, canonical values that disagreed. */
  normalizedValues: string[];
  resolution:
    | "auto_priority"
    | "deferred_to_reviewer"
    | "kept_both"
    | "unresolved";
  /** Stable IR ids affected by this conflict, when known. */
  affectedElementIds?: string[];
  /** Stable screen ids affected by this conflict, when known. */
  affectedScreenIds?: string[];
  /** Optional sanitized detail suitable for reviewer inspection. */
  detail?: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

/** Stable transcript row describing one merge decision taken by the engine. */
export interface MultiSourceReconciliationTranscriptEntry {
  decisionId: string;
  sourceIds: string[];
  action:
    | "accepted"
    | "merged"
    | "conflict_recorded"
    | "alternative_emitted"
    | "source_unmatched";
  rationale: string;
  affectedElementIds: string[];
}

/** Aggregate deterministic conflict artifact emitted for a reconciled run. */
export interface MultiSourceReconciliationReport {
  version: typeof MULTI_SOURCE_RECONCILIATION_REPORT_SCHEMA_VERSION;
  envelopeHash: string;
  conflicts: MultiSourceConflict[];
  /** Sources that were present but contributed no accepted or conflict rows. */
  unmatchedSources: string[];
  /**
   * Stable conceptual-case mapping used by downstream reviewers. Each id is a
   * deterministic synthetic case key produced by the reconciliation engine.
   */
  contributingSourcesPerCase: Array<{
    testCaseId: string;
    sourceIds: string[];
  }>;
  policyApplied: ConflictResolutionPolicy;
  transcript: MultiSourceReconciliationTranscriptEntry[];
}

/**
 * Refusal codes emitted by the multi-source envelope validator
 * (Issue #1431). Stable, locale-independent strings safe to ship to
 * automation.
 */
export const ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES = [
  "envelope_missing",
  "envelope_version_mismatch",
  "sources_empty",
  "duplicate_source_id",
  "invalid_source_id",
  "invalid_source_kind",
  "invalid_content_hash",
  "invalid_captured_at",
  "invalid_author_handle",
  "primary_source_required",
  "duplicate_jira_paste_collision",
  "custom_input_format_required",
  "custom_input_format_invalid",
  "primary_source_input_format_invalid",
  "markdown_metadata_only_for_custom",
  "markdown_hash_required",
  "markdown_hash_only_for_markdown",
  "jira_issue_key_invalid",
  "jira_issue_key_only_for_jira",
  "invalid_conflict_resolution_policy",
  "priority_order_required",
  "priority_order_invalid_kind",
  "priority_order_incomplete",
  "priority_order_duplicate",
  "aggregate_hash_mismatch",
  "source_mix_plan_invalid",
] as const;

/** Refusal code alias for the multi-source envelope validator. */
export type MultiSourceEnvelopeRefusalCode =
  (typeof ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES)[number];

/**
 * A single validation issue surfaced by the multi-source envelope
 * validator. `path` is a JS property-path-like locator (e.g.
 * `"sources[2].contentHash"`).
 */
export interface MultiSourceEnvelopeIssue {
  code: MultiSourceEnvelopeRefusalCode;
  path?: string;
  detail?: string;
}

/**
 * Result of multi-source envelope validation (Issue #1431). Hand-rolled
 * to keep workspace-dev free of external schema libraries.
 */
export type MultiSourceEnvelopeValidationResult =
  | { ok: true; envelope: MultiSourceTestIntentEnvelope }
  | { ok: false; issues: MultiSourceEnvelopeIssue[] };

/**
 * Refusal codes for the multi-source mode gate (Issue #1431). The gate
 * enforces three nested invariants before any multi-source ingestion is
 * permitted:
 *
 *   1. Parent test-intelligence env + startup option enabled.
 *   2. Multi-source env + startup option enabled.
 *   3. `llmCodegenMode === "deterministic"`.
 *
 * Any failed check fails closed with zero side effects and surfaces a
 * structured diagnostic.
 */
export const ALLOWED_MULTI_SOURCE_MODE_GATE_REFUSAL_CODES = [
  "test_intelligence_disabled",
  "multi_source_env_disabled",
  "multi_source_startup_option_disabled",
  "llm_codegen_mode_locked",
] as const;

/** Refusal-code alias for the multi-source mode gate. */
export type MultiSourceModeGateRefusalCode =
  (typeof ALLOWED_MULTI_SOURCE_MODE_GATE_REFUSAL_CODES)[number];

/** Inputs accepted by `evaluateMultiSourceModeGate`. */
export interface MultiSourceModeGateInput {
  testIntelligenceEnvEnabled: boolean;
  testIntelligenceStartupEnabled: boolean;
  multiSourceEnvEnabled: boolean;
  multiSourceStartupEnabled: boolean;
  llmCodegenMode?: string;
}

/** Single refusal entry on a {@link MultiSourceModeGateDecision}. */
export interface MultiSourceModeGateRefusal {
  code: MultiSourceModeGateRefusalCode;
  detail: string;
}

/** Decision produced by `evaluateMultiSourceModeGate`. */
export interface MultiSourceModeGateDecision {
  allowed: boolean;
  refusals: MultiSourceModeGateRefusal[];
}

/**
 * Jira issue intermediate representation (Issue #1432, Wave 4.B).
 *
 * The Jira IR is the canonical, PII-redacted, deterministically-hashed
 * surface produced from raw Jira issue payloads — independent of whether
 * the payload arrived via REST (Wave 4.C) or copy-paste (Wave 4.D). Wave
 * 4.F's reconciliation engine and the LLM prompt compiler consume only
 * this IR; raw Jira payloads, raw ADF rich-text, attachment bytes, user
 * account IDs, internal hostnames, and Jira `self`/avatar/download URLs
 * MUST never reach a persisted artifact or a model prompt.
 *
 * The IR is data-minimized by default: comments, attachments, linked
 * issues, and unknown custom fields are excluded unless the caller
 * explicitly opts each field group in. Every inclusion / exclusion /
 * cap / redaction decision is recorded in {@link JiraIssueIrDataMinimization}
 * so audits can prove what was collected and why.
 */

/** Schema version stamp for the {@link JiraIssueIr} artifact. */
export const JIRA_ISSUE_IR_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Run-dir-relative subdirectory under which per-source Jira IR artifacts
 * are persisted, namespaced by {@link TestIntentSourceRef.sourceId}.
 *
 * Layout: `<runDir>/sources/<sourceId>/jira-issue-ir.json`.
 */
export const JIRA_ISSUE_IR_ARTIFACT_DIRECTORY = "sources" as const;

/** Canonical filename for the persisted Jira IR artifact. */
export const JIRA_ISSUE_IR_ARTIFACT_FILENAME = "jira-issue-ir.json" as const;

/**
 * Hard pre-parse byte cap on the serialized ADF JSON document. Inputs
 * exceeding this are rejected with `jira_adf_payload_too_large` before
 * any tree traversal — the parser MUST NOT allocate proportional to the
 * payload above this bound.
 */
export const MAX_JIRA_ADF_INPUT_BYTES = 1_048_576 as const;

/**
 * Hard cap on the UTF-8 byte length of {@link JiraIssueIr.descriptionPlain}
 * after ADF normalization + PII redaction. Over-cap descriptions are
 * truncated and the truncation is recorded in {@link JiraIssueIrDataMinimization.descriptionTruncated}.
 */
export const MAX_JIRA_DESCRIPTION_PLAIN_BYTES = 32_768 as const;

/**
 * Hard cap on the UTF-8 byte length of any single normalized + redacted
 * Jira comment body. Over-cap comments are truncated and counted in
 * {@link JiraIssueIrDataMinimization.commentsCapped}.
 */
export const MAX_JIRA_COMMENT_BODY_BYTES = 4_096 as const;

/**
 * Hard cap on the number of Jira comments persisted in a single IR.
 * Over-cap comments are dropped and counted in
 * {@link JiraIssueIrDataMinimization.commentsDropped}.
 */
export const MAX_JIRA_COMMENT_COUNT = 50 as const;

/**
 * Hard cap on the number of Jira attachments persisted in a single IR.
 * Attachment bytes are NEVER persisted — only metadata.
 */
export const MAX_JIRA_ATTACHMENT_COUNT = 50 as const;

/** Hard cap on the number of Jira linked-issue refs persisted in a single IR. */
export const MAX_JIRA_LINK_COUNT = 50 as const;

/** Hard cap on the number of custom fields persisted in a single IR. */
export const MAX_JIRA_CUSTOM_FIELD_COUNT = 50 as const;

/** Hard cap on the UTF-8 byte length of a single normalized + redacted custom-field value. */
export const MAX_JIRA_CUSTOM_FIELD_VALUE_BYTES = 2_048 as const;

/**
 * Allow-listed Jira issue type discriminants. Anything outside this set
 * collapses to `"other"` so the IR cannot be tricked into smuggling a
 * free-form issue-type string into the prompt or downstream prompts.
 */
export const ALLOWED_JIRA_ISSUE_TYPES = [
  "story",
  "task",
  "bug",
  "epic",
  "subtask",
  "other",
] as const;

/** Discriminated alias for {@link ALLOWED_JIRA_ISSUE_TYPES}. */
export type JiraIssueType = (typeof ALLOWED_JIRA_ISSUE_TYPES)[number];

/**
 * Allow-listed Atlassian Document Format node `type` discriminants. The
 * parser fails closed on any node whose `type` is not in this set
 * (`jira_adf_unknown_node_type`).
 */
export const ALLOWED_JIRA_ADF_NODE_TYPES = [
  "doc",
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "rule",
  "panel",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "mediaSingle",
  "mediaGroup",
  "media",
  "text",
  "hardBreak",
  "mention",
  "emoji",
  "inlineCard",
  "status",
  "date",
] as const;

/** Discriminated alias for {@link ALLOWED_JIRA_ADF_NODE_TYPES}. */
export type JiraAdfNodeType = (typeof ALLOWED_JIRA_ADF_NODE_TYPES)[number];

/**
 * Allow-listed Atlassian Document Format `mark.type` discriminants. Marks
 * carry inline annotation (e.g. `strong`, `link`) on `text` nodes. Marks
 * outside this set are rejected with `jira_adf_unknown_mark_type`.
 */
export const ALLOWED_JIRA_ADF_MARK_TYPES = [
  "strong",
  "em",
  "code",
  "strike",
  "underline",
  "link",
  "subsup",
  "textColor",
] as const;

/** Discriminated alias for {@link ALLOWED_JIRA_ADF_MARK_TYPES}. */
export type JiraAdfMarkType = (typeof ALLOWED_JIRA_ADF_MARK_TYPES)[number];

/**
 * Refusal codes emitted by the ADF parser (`parseJiraAdfDocument`). The
 * parser never throws — it returns a discriminated union and these codes
 * are stable, locale-independent strings safe to ship to automation.
 */
export const ALLOWED_JIRA_ADF_REJECTION_CODES = [
  "jira_adf_payload_too_large",
  "jira_adf_input_not_string",
  "jira_adf_input_not_json",
  "jira_adf_root_not_object",
  "jira_adf_root_type_invalid",
  "jira_adf_unknown_node_type",
  "jira_adf_unknown_mark_type",
  "jira_adf_node_shape_invalid",
  "jira_adf_text_node_invalid",
  "jira_adf_max_depth_exceeded",
  "jira_adf_max_node_count_exceeded",
] as const;

/** Discriminated alias for {@link ALLOWED_JIRA_ADF_REJECTION_CODES}. */
export type JiraAdfRejectionCode =
  (typeof ALLOWED_JIRA_ADF_REJECTION_CODES)[number];

/**
 * Refusal codes emitted by the Jira IR builder (`buildJiraIssueIr`) and
 * by the Jira-issue-key / JQL-fragment validators. Stable and
 * locale-independent.
 */
export const ALLOWED_JIRA_IR_REFUSAL_CODES = [
  "jira_issue_key_invalid",
  "jira_issue_key_too_long",
  "jira_issue_type_invalid",
  "jira_summary_invalid",
  "jira_description_invalid",
  "jira_acceptance_criterion_invalid",
  "jira_comment_invalid",
  "jira_attachment_invalid",
  "jira_link_invalid",
  "jira_custom_field_invalid",
  "jira_custom_field_id_invalid",
  "jira_status_invalid",
  "jira_priority_invalid",
  "jira_field_selection_profile_invalid",
  "jira_captured_at_invalid",
  "jira_field_unknown_excluded",
  "jira_jql_fragment_disallowed_token",
  "jira_jql_fragment_control_character",
  "jira_jql_fragment_too_long",
] as const;

/** Discriminated alias for {@link ALLOWED_JIRA_IR_REFUSAL_CODES}. */
export type JiraIrRefusalCode = (typeof ALLOWED_JIRA_IR_REFUSAL_CODES)[number];

/** Single normalized acceptance criterion derived from a Jira issue. */
export interface JiraAcceptanceCriterion {
  /** Stable per-issue id, e.g. `"ac.0"`, `"ac.1"`. */
  id: string;
  /** Plain-text criterion body, PII-redacted. */
  text: string;
  /** Original Jira field id this criterion was sourced from (e.g. `"customfield_10042"`). */
  sourceFieldId?: string;
}

/** Single PII-redacted Jira comment carried into the IR (opt-in only). */
export interface JiraComment {
  /** Stable per-issue id, e.g. `"comment.0"`. */
  id: string;
  /**
   * Opaque non-PII author handle (never raw email, full name, or Jira
   * accountId). Resolution is the caller's responsibility before the
   * comment reaches the builder.
   */
  authorHandle?: string;
  /** ISO-8601 UTC timestamp of the original Jira comment. */
  createdAt: string;
  /** PII-redacted comment body. May be truncated to the configured byte cap. */
  body: string;
  /** True when the body was truncated to fit {@link MAX_JIRA_COMMENT_BODY_BYTES}. */
  bodyTruncated: boolean;
}

/**
 * Metadata reference to a Jira attachment. The IR NEVER carries
 * attachment bytes — only the redacted filename, MIME type, and byte
 * size. Download URLs are stripped by the builder.
 */
export interface JiraAttachmentRef {
  /** Stable per-issue id, e.g. `"attachment.0"`. */
  id: string;
  /** PII-redacted attachment filename. */
  filename: string;
  /** Reported MIME type, normalised to lowercase. */
  mimeType?: string;
  /** Reported byte size, if known. */
  byteSize?: number;
}

/** Reference to another Jira issue linked from this one (opt-in). */
export interface JiraLinkRef {
  /** Stable per-issue id, e.g. `"link.0"`. */
  id: string;
  /** Validated Jira issue key of the linked issue. */
  targetIssueKey: string;
  /** Normalized link relationship label (e.g. `"blocks"`, `"relates_to"`). */
  relationship: string;
}

/** Single PII-redacted custom field included in the IR (opt-in only). */
export interface JiraIssueIrCustomField {
  /** Jira custom-field id (e.g. `"customfield_10042"`). */
  id: string;
  /** PII-redacted custom-field display name. */
  nameRedacted: string;
  /** PII-redacted, byte-capped, normalized scalar value. */
  valuePlain: string;
  /** True when the value was truncated to fit {@link MAX_JIRA_CUSTOM_FIELD_VALUE_BYTES}. */
  valueTruncated: boolean;
}

/**
 * Field-selection profile applied by the Jira IR builder. The default is
 * data-minimized: comments, attachments, linked issues, and custom fields
 * are excluded unless the caller opts each group in. Unknown custom-field
 * ids are always excluded — there is no opt-in path for "all custom
 * fields".
 */
export interface JiraFieldSelectionProfile {
  /** Include the description body (default `true`). */
  includeDescription: boolean;
  /** Include comments (default `false`). */
  includeComments: boolean;
  /** Include attachment metadata (default `false`). */
  includeAttachments: boolean;
  /** Include linked-issue refs (default `false`). */
  includeLinks: boolean;
  /**
   * Allow-list of Jira custom-field ids whose values are persisted on
   * the IR. Anything outside this list is excluded and counted in
   * {@link JiraIssueIrDataMinimization.unknownCustomFieldsExcluded}.
   */
  customFieldAllowList: readonly string[];
  /**
   * Allow-list of Jira custom-field ids interpreted as acceptance
   * criteria. The builder reads these fields, parses them as ADF when
   * appropriate, and emits {@link JiraAcceptanceCriterion} entries.
   */
  acceptanceCriterionFieldIds: readonly string[];
}

/**
 * Default Jira field selection profile — data-minimized by default. No
 * comments, no attachments, no linked issues, no unknown custom fields.
 * Description is included; acceptance criteria require explicit
 * configuration.
 */
export const DEFAULT_JIRA_FIELD_SELECTION_PROFILE: JiraFieldSelectionProfile =
  Object.freeze({
    includeDescription: true,
    includeComments: false,
    includeAttachments: false,
    includeLinks: false,
    customFieldAllowList: Object.freeze([]) as readonly string[],
    acceptanceCriterionFieldIds: Object.freeze([]) as readonly string[],
  });

/**
 * Audit metadata recording how the data-minimization profile was applied
 * to a single IR build. Lets reviewers verify that opt-in field groups
 * were turned on intentionally, that over-large bodies were capped before
 * persistence, and that unknown custom fields were excluded by default.
 */
export interface JiraIssueIrDataMinimization {
  /** True when the description body was included on the IR. */
  descriptionIncluded: boolean;
  /** True when the description body was truncated to fit the byte cap. */
  descriptionTruncated: boolean;
  /** True when comments were included on the IR (opt-in). */
  commentsIncluded: boolean;
  /** Count of comments dropped because the count cap was exceeded. */
  commentsDropped: number;
  /** Count of comments whose body was truncated to fit the byte cap. */
  commentsCapped: number;
  /** True when attachment metadata was included on the IR (opt-in). */
  attachmentsIncluded: boolean;
  /** Count of attachments dropped because the count cap was exceeded. */
  attachmentsDropped: number;
  /** True when linked-issue refs were included on the IR (opt-in). */
  linksIncluded: boolean;
  /** Count of links dropped because the count cap was exceeded. */
  linksDropped: number;
  /** Count of custom fields included via the explicit allow-list. */
  customFieldsIncluded: number;
  /** Count of custom fields excluded because they were not on the allow-list. */
  unknownCustomFieldsExcluded: number;
  /** Count of custom-field values truncated to fit the per-field byte cap. */
  customFieldsCapped: number;
}

/**
 * Canonical, PII-redacted, deterministically-hashed Jira issue IR. Wave
 * 4.F's reconciliation engine and the LLM prompt compiler consume only
 * this IR — raw Jira payloads never reach prompt compilation.
 *
 * Hard invariants enforced by the builder:
 *
 *   1. `issueKey` is validated (`^[A-Z][A-Z0-9_]+-[1-9][0-9]*$`, ≤ 64 chars).
 *   2. `descriptionPlain`, `summary`, comment bodies, custom-field values,
 *      attachment filenames, and link relationships are all PII-redacted
 *      before persistence.
 *   3. No Jira `self` URL, account id, avatar URL, attachment download
 *      URL, or raw `names`/`schema` map is present anywhere on the IR.
 *   4. `contentHash` is the SHA-256 of the canonical JSON serialization
 *      of the IR with `contentHash` itself stripped.
 *   5. Audit/data-minimization metadata is always present.
 */
export interface JiraIssueIr {
  /** Schema version stamp. */
  version: typeof JIRA_ISSUE_IR_SCHEMA_VERSION;
  /** Validated Jira issue key, e.g. `"PAY-1234"`. */
  issueKey: string;
  /** Allow-listed issue type discriminant. Free-form types collapse to `"other"`. */
  issueType: JiraIssueType;
  /** PII-redacted summary line. */
  summary: string;
  /** PII-redacted plain-text description, capped at {@link MAX_JIRA_DESCRIPTION_PLAIN_BYTES}. */
  descriptionPlain: string;
  /** Acceptance criteria parsed from explicitly configured custom fields. */
  acceptanceCriteria: JiraAcceptanceCriterion[];
  /** Sorted, deduplicated, PII-redacted labels. */
  labels: string[];
  /** Sorted, deduplicated, PII-redacted component names. */
  components: string[];
  /** Sorted, deduplicated fix-version names. */
  fixVersions: string[];
  /** Issue status name (e.g. `"In Progress"`). */
  status: string;
  /** Optional priority name (e.g. `"High"`). */
  priority?: string;
  /** Allow-listed custom fields with PII-redacted values (opt-in). */
  customFields: JiraIssueIrCustomField[];
  /** PII-redacted comments (opt-in only). */
  comments: JiraComment[];
  /** Attachment metadata only — NEVER bytes (opt-in only). */
  attachments: JiraAttachmentRef[];
  /** Linked-issue refs (opt-in only). */
  links: JiraLinkRef[];
  /** PII indicators surfaced during redaction. */
  piiIndicators: PiiIndicator[];
  /** Redaction records corresponding to {@link piiIndicators}. */
  redactions: IntentRedaction[];
  /** Data-minimization audit metadata. */
  dataMinimization: JiraIssueIrDataMinimization;
  /** ISO-8601 UTC timestamp at which the IR was built (`Z` suffix). */
  capturedAt: string;
  /** SHA-256 of the canonical IR with `contentHash` stripped. Lowercase, 64 hex. */
  contentHash: string;
}

/** Visual-sidecar description produced by a multimodal vision model (Issue #1386). */
export interface VisualScreenDescription {
  screenId: string;
  sidecarDeployment:
    | "llama-4-maverick-vision"
    | "phi-4-multimodal-poc"
    | "mock";
  regions: Array<{
    regionId: string;
    confidence: number;
    label?: string;
    controlType?: string;
    visibleText?: string;
    stateHints?: string[];
    validationHints?: string[];
    ambiguity?: IntentAmbiguity;
  }>;
  confidenceSummary: { min: number; max: number; mean: number };
  screenName?: string;
  capturedAt?: string;
  piiFlags?: Array<{
    regionId: string;
    kind: PiiKind;
    confidence: number;
  }>;
}

/**
 * Generated test case surface (Issue #1362).
 *
 * The generator-side artifacts described below model the JSON the LLM is
 * asked to produce, the redacted compiled prompt request that is persisted
 * in evidence, and the replay-cache key used to short-circuit identical
 * jobs without ever reaching the gateway.
 */

/** ISO/IEC/IEEE 29119-4 technique tags supported by the generator. */
export type TestCaseTechnique29119 =
  | "equivalence_partitioning"
  | "boundary_value_analysis"
  | "decision_table"
  | "state_transition"
  | "use_case"
  | "exploratory"
  | "error_guessing"
  | "syntax_testing"
  | "classification_tree";

/** Coarse-grain test level. */
export type TestCaseLevel =
  | "unit"
  | "component"
  | "integration"
  | "system"
  | "acceptance";

/** Coarse-grain test type. */
export type TestCaseType =
  | "functional"
  | "negative"
  | "boundary"
  | "validation"
  | "navigation"
  | "regression"
  | "exploratory"
  | "accessibility";

/** Risk band attached to a generated test case. */
export type TestCaseRiskCategory =
  | "low"
  | "medium"
  | "high"
  | "regulated_data"
  | "financial_transaction";

/** Priority band attached to a generated test case. */
export type TestCasePriority = "p0" | "p1" | "p2" | "p3";

/** Review state at the moment the test case is emitted. */
export type GeneratedTestCaseReviewState =
  | "draft"
  | "auto_approved"
  | "needs_review"
  | "rejected";

/** Single ordered step inside a generated test case. */
export interface GeneratedTestCaseStep {
  index: number;
  action: string;
  data?: string;
  expected?: string;
}

/** Reference back to a Figma trace path that motivated a test case. */
export interface GeneratedTestCaseFigmaTrace {
  screenId: string;
  nodeId?: string;
  nodeName?: string;
  nodePath?: string;
}

/** QC/ALM mapping preview emitted alongside the test case. */
export interface GeneratedTestCaseQcMapping {
  /** Canonical test-case folder hint inside QC/ALM. */
  folderHint?: string;
  /** Canonical mapping profile id this preview was rendered for. */
  mappingProfileId?: string;
  /** Whether the case is exportable as-is under the mapping profile. */
  exportable: boolean;
  /** Human-readable reasons when exportable=false. */
  blockingReasons?: string[];
}

/** Quality signal fields attached to each generated test case. */
export interface GeneratedTestCaseQualitySignals {
  coveredFieldIds: string[];
  coveredActionIds: string[];
  coveredValidationIds: string[];
  coveredNavigationIds: string[];
  /** 0..1 — generator-side confidence in the produced case. */
  confidence: number;
  /** Optional ambiguity note. */
  ambiguity?: IntentAmbiguity;
}

/**
 * Per-test-case rubric quality signal emitted by the self-verify pass
 * (Issue #1379). The signal is reported via the `self-verify-rubric.json`
 * artifact rather than mutated onto the cached `GeneratedTestCase` so
 * the strict generated-test-case JSON schema and the replay-cache
 * identity remain byte-stable. Each row mirrors one
 * `SelfVerifyRubricCaseEvaluation` from the rubric report and is
 * surfaced on the inspector + the audit-timeline as a quality signal of
 * the underlying test case.
 */
export interface TestCaseQualitySignalRubric {
  testCaseId: string;
  /** 0..1 aggregate rubric score for this case (rounded to 6 digits). */
  rubricScore: number;
}

/** Audit metadata attached to a generated test case. */
export interface GeneratedTestCaseAuditMetadata {
  jobId: string;
  generatedAt: string;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  schemaVersion: typeof GENERATED_TEST_CASE_SCHEMA_VERSION;
  promptTemplateVersion: typeof TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION;
  redactionPolicyVersion: typeof REDACTION_POLICY_VERSION;
  visualSidecarSchemaVersion: typeof VISUAL_SIDECAR_SCHEMA_VERSION;
  /** Whether the artifact came from a replay-cache hit. */
  cacheHit: boolean;
  cacheKey: string;
  inputHash: string;
  promptHash: string;
  schemaHash: string;
}

/** Single generated test case. */
export interface GeneratedTestCase {
  id: string;
  sourceJobId: string;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  schemaVersion: typeof GENERATED_TEST_CASE_SCHEMA_VERSION;
  promptTemplateVersion: typeof TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION;
  title: string;
  objective: string;
  level: TestCaseLevel;
  type: TestCaseType;
  priority: TestCasePriority;
  riskCategory: TestCaseRiskCategory;
  technique: TestCaseTechnique29119;
  preconditions: string[];
  testData: string[];
  steps: GeneratedTestCaseStep[];
  expectedResults: string[];
  figmaTraceRefs: GeneratedTestCaseFigmaTrace[];
  assumptions: string[];
  openQuestions: string[];
  qcMappingPreview: GeneratedTestCaseQcMapping;
  qualitySignals: GeneratedTestCaseQualitySignals;
  reviewState: GeneratedTestCaseReviewState;
  audit: GeneratedTestCaseAuditMetadata;
}

/** Wrapper produced by the generator for a single job. */
export interface GeneratedTestCaseList {
  schemaVersion: typeof GENERATED_TEST_CASE_SCHEMA_VERSION;
  jobId: string;
  testCases: GeneratedTestCase[];
}

/** Reason a fallback visual sidecar deployment was selected, if any. */
export type VisualSidecarFallbackReason =
  | "primary_unavailable"
  | "primary_quota_exceeded"
  | "primary_disabled"
  | "policy_downgrade"
  | "none";

/**
 * Schema version for the persisted multimodal visual sidecar result
 * artifact emitted by the visual sidecar client (Issue #1386). Bumped
 * independently from `VISUAL_SIDECAR_SCHEMA_VERSION` (which describes the
 * sidecar's per-screen output) because this version covers the wrapping
 * envelope plus capture identities, attempts, and failure classes.
 */
export const VISUAL_SIDECAR_RESULT_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical filename for the persisted visual sidecar result artifact. */
export const VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME =
  "visual-sidecar-result.json" as const;

/**
 * Allowed failure classes for the visual sidecar client. The classes are
 * disjoint and policy-readable: a downstream policy gate can refuse a job
 * by inspecting the failure class without reading sanitized free-form
 * messages.
 */
export const ALLOWED_VISUAL_SIDECAR_FAILURE_CLASSES = [
  "primary_unavailable",
  "primary_quota_exceeded",
  "both_sidecars_failed",
  "schema_invalid_response",
  "image_payload_too_large",
  "image_mime_unsupported",
  "duplicate_screen_id",
  "empty_screen_capture_set",
] as const;

/** Discriminant of a `VisualSidecarFailure`. */
export type VisualSidecarFailureClass =
  (typeof ALLOWED_VISUAL_SIDECAR_FAILURE_CLASSES)[number];

/**
 * Allowed input MIME types for visual sidecar captures. SVG is intentionally
 * NOT in the allowlist because SVG is XML and exposes a parser/injection
 * surface that the multimodal sidecar should never have to evaluate.
 */
export const ALLOWED_VISUAL_SIDECAR_INPUT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/** Discriminant of an allowed visual sidecar input MIME type. */
export type VisualSidecarInputMimeType =
  (typeof ALLOWED_VISUAL_SIDECAR_INPUT_MIME_TYPES)[number];

/**
 * Maximum decoded byte size of a single visual sidecar capture. The bound
 * is enforced AFTER base64 decoding (i.e. on the actual image bytes the
 * gateway would forward). Five MiB matches the conservative ceiling Azure
 * OpenAI imposes on multimodal payloads.
 */
export const MAX_VISUAL_SIDECAR_INPUT_BYTES: number = 5 * 1024 * 1024;

/**
 * In-memory capture handed to the visual sidecar client. The bytes never
 * touch disk: only the SHA-256 hash is persisted into the result artifact.
 */
export interface VisualSidecarCaptureInput {
  /** Stable identifier matching a `BusinessTestIntentScreen.screenId`. */
  screenId: string;
  /** MIME type of the encoded bytes. Must be in the allowlist. */
  mimeType: VisualSidecarInputMimeType;
  /** Base64-encoded image bytes. Decoded length must be <= the byte bound. */
  base64Data: string;
  /** Optional human-readable label. */
  screenName?: string;
  /** Optional ISO-8601 capture timestamp (sourced from a screenshot pipeline). */
  capturedAt?: string;
}

/**
 * Identity record for a single capture, persisted alongside the sidecar
 * result. Carries no image bytes — only a SHA-256 of the decoded bytes
 * plus the byte length. Re-validating a result against the original
 * captures requires re-hashing, never re-loading raw screenshot bytes.
 */
export interface VisualSidecarCaptureIdentity {
  screenId: string;
  mimeType: VisualSidecarInputMimeType;
  byteLength: number;
  /** SHA-256 hex of the decoded image bytes (NOT of the base64 string). */
  sha256: string;
}

/**
 * Single attempt against a sidecar deployment. Composes with the gateway
 * surface so the policy gate can correlate attempts with the gateway's
 * own circuit-breaker telemetry without a translation layer.
 */
export interface VisualSidecarAttempt {
  /** Sidecar deployment that was attempted. */
  deployment: "llama-4-maverick-vision" | "phi-4-multimodal-poc" | "mock";
  /** Sequence index, 1-based across both primary and fallback attempts. */
  attempt: number;
  /** Wall-clock duration of the attempt in milliseconds. */
  durationMs: number;
  /** Error class when the attempt failed. Absent on a success. */
  errorClass?: LlmGatewayErrorClass | "schema_invalid_response";
}

/**
 * Successful sidecar outcome — primary or fallback. The downstream
 * `VisualScreenDescription[]` is structurally validated by the existing
 * `validateVisualSidecar` gate; this type carries the validation report
 * verbatim so the caller can persist or refuse on it.
 */
export interface VisualSidecarSuccess {
  outcome: "success";
  /** Deployment that produced the descriptions. */
  selectedDeployment:
    | "llama-4-maverick-vision"
    | "phi-4-multimodal-poc"
    | "mock";
  fallbackReason: VisualSidecarFallbackReason;
  visual: VisualScreenDescription[];
  captureIdentities: VisualSidecarCaptureIdentity[];
  attempts: VisualSidecarAttempt[];
  /** Aggregated confidence summary across every screen description. */
  confidenceSummary: { min: number; max: number; mean: number };
  /**
   * Verbatim validation report produced by `validateVisualSidecar`. The
   * client does NOT silently strip findings — when the report says
   * `blocked: true`, the success surfaces the report so the caller can
   * persist it for the policy gate to inspect.
   */
  validationReport: VisualSidecarValidationReport;
}

/**
 * Failure outcome — both primary and fallback exhausted, or pre-flight
 * rejected the captures. The `failureClass` is policy-readable so
 * upstream gates can decide between "retry later" and "refuse the job".
 */
export interface VisualSidecarFailure {
  outcome: "failure";
  failureClass: VisualSidecarFailureClass;
  /** Sanitized human-readable message — never carries tokens or PII. */
  failureMessage: string;
  attempts: VisualSidecarAttempt[];
  captureIdentities: VisualSidecarCaptureIdentity[];
}

/** Discriminated union returned by `describeVisualScreens`. */
export type VisualSidecarResult = VisualSidecarSuccess | VisualSidecarFailure;

/**
 * Persisted form of the visual sidecar result. Carries schema/contract
 * stamps and the hard `rawScreenshotsIncluded: false` literal so that any
 * downstream consumer can verify the artifact never re-introduced raw
 * screenshot bytes.
 */
export interface VisualSidecarResultArtifact {
  schemaVersion: typeof VISUAL_SIDECAR_RESULT_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  visualSidecarSchemaVersion: typeof VISUAL_SIDECAR_SCHEMA_VERSION;
  jobId: string;
  generatedAt: string;
  result: VisualSidecarResult;
  /** Hard invariant — image bytes are never embedded in this artifact. */
  rawScreenshotsIncluded: false;
}

/**
 * Identity of the visual sidecar that produced a `VisualScreenDescription`
 * batch. The compiler hashes this object into the replay-cache key so that
 * a fallback model swap forces a cache miss.
 */
export interface CompiledPromptVisualBinding {
  schemaVersion: typeof VISUAL_SIDECAR_SCHEMA_VERSION;
  selectedDeployment:
    | "llama-4-maverick-vision"
    | "phi-4-multimodal-poc"
    | "mock";
  fallbackReason: VisualSidecarFallbackReason;
  /** Hex digest of the screenshot/fixture used for visual analysis, if any. */
  fixtureImageHash?: string;
  /** Number of screens covered by the visual binding. */
  screenCount: number;
}

/** Identity of the structured-test-case generator gateway/model pair. */
export interface CompiledPromptModelBinding {
  modelRevision: string;
  gatewayRelease: string;
  /** Optional deterministic seed the model accepts (provider-dependent). */
  seed?: number;
}

/** Hash bundle attached to a compiled prompt. */
export interface CompiledPromptHashes {
  inputHash: string;
  promptHash: string;
  schemaHash: string;
  cacheKey: string;
}

/** Sanitized custom supporting context visible to prompt compilation. */
export interface CompiledPromptCustomContext {
  markdownSections: Array<{
    sourceId: string;
    entryId: string;
    bodyMarkdown: string;
    bodyPlain: string;
    markdownContentHash: string;
    plainContentHash: string;
  }>;
  structuredAttributes: Array<{
    sourceId: string;
    entryId: string;
    key: string;
    value: string;
    contentHash: string;
  }>;
}

/** Persisted, fully-redacted artifact form of a compiled prompt. */
export interface CompiledPromptArtifacts {
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  promptTemplateVersion: typeof TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION;
  schemaVersion: typeof GENERATED_TEST_CASE_SCHEMA_VERSION;
  redactionPolicyVersion: typeof REDACTION_POLICY_VERSION;
  jobId: string;
  systemPrompt: string;
  userPrompt: string;
  /** Redacted JSON payload that the model will reason over. */
  payload: {
    intent: BusinessTestIntentIr;
    visual: VisualScreenDescription[];
    customContext?: CompiledPromptCustomContext;
    sourceMixPlan?: SourceMixPlan;
  };
  hashes: CompiledPromptHashes;
  visualBinding: CompiledPromptVisualBinding;
  modelBinding: CompiledPromptModelBinding;
  policyBundleVersion: string;
}

/** Wire-shaped request handed to the LLM gateway client. */
export interface CompiledPromptRequest {
  jobId: string;
  modelBinding: CompiledPromptModelBinding;
  systemPrompt: string;
  userPrompt: string;
  /** JSON schema the gateway must enforce on the response (structured output). */
  responseSchema: Record<string, unknown>;
  /** Stable schema name used by some gateways. */
  responseSchemaName: string;
  hashes: CompiledPromptHashes;
}

/** Replay-cache key — the only deterministic-bit-identical replay anchor. */
export interface ReplayCacheKey {
  inputHash: string;
  promptHash: string;
  schemaHash: string;
  modelRevision: string;
  gatewayRelease: string;
  policyBundleVersion: string;
  redactionPolicyVersion: typeof REDACTION_POLICY_VERSION;
  visualSidecarSchemaVersion: typeof VISUAL_SIDECAR_SCHEMA_VERSION;
  visualSelectedDeployment: CompiledPromptVisualBinding["selectedDeployment"];
  visualFallbackReason: VisualSidecarFallbackReason;
  fixtureImageHash?: string;
  promptTemplateVersion: typeof TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION;
  seed?: number;
  sourceMixPlanHash?: string;
}

/** Stored cache entry. */
export interface ReplayCacheEntry {
  key: string;
  storedAt: string;
  testCases: GeneratedTestCaseList;
}

/** Cache lookup outcome consumed by the orchestration layer. */
export type ReplayCacheLookupResult =
  | { hit: true; entry: ReplayCacheEntry }
  | { hit: false; key: string };

/**
 * Review gate + export-only QC artifact surface (Issue #1365 / #1376).
 *
 * The review gate persists per-test-case lifecycle decisions made by a
 * reviewer (or by the policy gate, when policy auto-approves) so that
 * downstream export operations can refuse to produce QC/ALM artifacts
 * for cases that have not been approved. Wave 1 (#1365) ships:
 *
 *   - in-memory state machine (`generated → needs_review → approved |
 *     rejected | edited → exported → transferred`),
 *   - file-system review store (event log + snapshot),
 *   - bearer-protected handler that mirrors the import-session
 *     governance pattern (`validateImportSessionEventWriteAuth`),
 *   - deterministic export pipeline emitting `testcases.json`,
 *     `testcases.csv`, `testcases.alm.xml`, `qc-mapping-preview.json`,
 *     `export-report.json`, plus optional `testcases.xlsx`.
 *
 * Wave 2 (#1376) adds server-side four-eyes enforcement for cases whose
 * risk category is configured as high-risk OR whose multimodal visual
 * sidecar workflow surfaced low-confidence / fallback / PII /
 * prompt-injection / Figma-conflict signals. When four-eyes is
 * enforced, two distinct authenticated principals must approve before
 * the case may transition to `approved`. The intermediate state
 * `pending_secondary_approval` records the first approval; export and
 * ALM transfer paths refuse cases that did not reach `approved`.
 *
 * No production QC/ALM API write is performed; the surface only
 * persists artifacts to disk for downstream operators to upload.
 */

/**
 * Allowed lifecycle states for a generated test case under review.
 *
 * `pending_secondary_approval` (added in #1376) is the intermediate
 * state a four-eyes-enforced case occupies after the first approval and
 * before the second distinct approval. Cases not subject to four-eyes
 * skip this state entirely.
 */
export const ALLOWED_REVIEW_STATES = [
  "generated",
  "needs_review",
  "pending_secondary_approval",
  "approved",
  "rejected",
  "edited",
  "exported",
  "transferred",
] as const;
export type ReviewState = (typeof ALLOWED_REVIEW_STATES)[number];

/**
 * Allowed event kinds appended to the review-gate event log.
 *
 * `primary_approved` and `secondary_approved` (added in #1376) are
 * emitted in lockstep with four-eyes enforcement: the first distinct
 * approver records `primary_approved`; the second distinct approver
 * records `secondary_approved`. Clients may also continue to send the
 * generic `approved` kind — when the snapshot indicates four-eyes is
 * enforced, the store routes the request to the correct primary or
 * secondary event kind based on current state, which keeps wire-level
 * audit clarity without forcing UI rewrites.
 */
export const ALLOWED_REVIEW_EVENT_KINDS = [
  "generated",
  "review_started",
  "approved",
  "primary_approved",
  "secondary_approved",
  "rejected",
  "edited",
  "exported",
  "transferred",
  "note",
] as const;
export type ReviewEventKind = (typeof ALLOWED_REVIEW_EVENT_KINDS)[number];

/**
 * Reasons four-eyes review is enforced for a single test case (#1376).
 *
 * Multiple reasons may apply (e.g. a `regulated_data` case whose visual
 * sidecar reported low confidence). Reasons are reported deterministic-
 * sorted on the `ReviewSnapshot.fourEyesReasons` field.
 */
export const ALLOWED_FOUR_EYES_ENFORCEMENT_REASONS = [
  "risk_category",
  "visual_low_confidence",
  "visual_fallback_used",
  "visual_possible_pii",
  "visual_prompt_injection",
  "visual_metadata_conflict",
  "multi_source_conflict_present",
] as const;
export type FourEyesEnforcementReason =
  (typeof ALLOWED_FOUR_EYES_ENFORCEMENT_REASONS)[number];

/**
 * Default risk categories that require four-eyes review (#1376).
 *
 * The list spans the existing `TestCaseRiskCategory` taxonomy. Issue
 * #1376 names the operator-facing risk classes as
 * `payment / authorization / identity / regulatory`; those map onto the
 * existing taxonomy as `financial_transaction` (payment) +
 * `regulated_data` (identity, regulatory) + `high` (authorization /
 * elevated-impact). Operators may override with
 * `WorkspaceStartOptions.testIntelligence.fourEyesRequiredRiskCategories`.
 */
export const DEFAULT_FOUR_EYES_REQUIRED_RISK_CATEGORIES: readonly TestCaseRiskCategory[] =
  ["financial_transaction", "regulated_data", "high"];

/**
 * Default visual-sidecar validation outcomes that trigger four-eyes
 * enforcement (#1376, 2026-04-24 multimodal addendum).
 *
 * When ANY screen referenced by a test case carries one of these
 * outcomes in `VisualSidecarValidationReport`, the case is enforced as
 * four-eyes regardless of risk category.
 */
export const DEFAULT_FOUR_EYES_VISUAL_SIDECAR_TRIGGERS: readonly VisualSidecarValidationOutcome[] =
  [
    "low_confidence",
    "fallback_used",
    "possible_pii",
    "prompt_injection_like_text",
    "conflicts_with_figma_metadata",
  ];

/**
 * Operator-tunable four-eyes policy (#1376).
 *
 * Resolved at startup from `WorkspaceStartOptions.testIntelligence`
 * fields; the resolved policy is consulted at review-snapshot seed time
 * to stamp `fourEyesEnforced` per test case.
 */
export interface FourEyesPolicy {
  /** Risk categories that always require four-eyes. Sorted, deduplicated. */
  requiredRiskCategories: readonly TestCaseRiskCategory[];
  /**
   * Visual-sidecar validation outcomes that trigger four-eyes regardless
   * of risk category. Sorted, deduplicated.
   */
  visualSidecarTriggerOutcomes: readonly VisualSidecarValidationOutcome[];
}

/** Allowed reasons the export pipeline may refuse to emit QC artifacts. */
export const ALLOWED_EXPORT_REFUSAL_CODES = [
  "no_approved_test_cases",
  "unapproved_test_cases_present",
  "policy_blocked_cases_present",
  "schema_invalid_cases_present",
  "visual_sidecar_blocked",
  "review_state_inconsistent",
] as const;
export type ExportRefusalCode = (typeof ALLOWED_EXPORT_REFUSAL_CODES)[number];

/** Single immutable event appended to the review-gate event log. */
export interface ReviewEvent {
  schemaVersion: typeof REVIEW_GATE_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  /** Globally unique opaque identifier; generated server-side. */
  id: string;
  jobId: string;
  /** Unset when the event is job-level (e.g. seed). */
  testCaseId?: string;
  kind: ReviewEventKind;
  /** ISO-8601 UTC timestamp at the moment of persistence. */
  at: string;
  /** Optional opaque actor handle; never an email or token. */
  actor?: string;
  /** Optional human-readable note (length-bounded by the store). */
  note?: string;
  fromState?: ReviewState;
  toState?: ReviewState;
  /** Monotonic 1-based per-job sequence; gap-free. */
  sequence: number;
  /** Flat metadata (no nested objects). */
  metadata?: Record<string, string | number | boolean | null>;
}

/** Per-test-case review-state snapshot. */
export interface ReviewSnapshot {
  testCaseId: string;
  state: ReviewState;
  policyDecision: TestCasePolicyDecision;
  /** Identifier of the most recent event affecting this case. */
  lastEventId: string;
  lastEventAt: string;
  /**
   * Whether the resolved four-eyes policy requires two distinct
   * authenticated principals before this case may reach `approved`.
   * When `true`, the export pipeline refuses cases not in `approved`,
   * `exported`, or `transferred` state (#1376).
   */
  fourEyesEnforced: boolean;
  /**
   * Set of distinct reviewer actors that have approved this case in
   * sequence. Sorted, deduplicated. For four-eyes-enforced cases the
   * first entry is the primary approver, the second the secondary.
   */
  approvers: string[];
  /**
   * Reasons four-eyes is enforced (#1376). Empty when
   * `fourEyesEnforced=false`. Sorted deterministic. Optional for
   * backward compatibility; consumers should treat absence as
   * "no recorded reasons" (i.e. older snapshots before #1376 shipped).
   */
  fourEyesReasons?: FourEyesEnforcementReason[];
  /**
   * Identity of the first distinct approver, recorded when a four-eyes
   * case transitions out of `needs_review`/`edited`. Optional for
   * non-enforced cases and for snapshots written before any approval.
   */
  primaryReviewer?: string;
  /** ISO-8601 UTC timestamp at which the primary approval was recorded. */
  primaryApprovalAt?: string;
  /**
   * Identity of the second distinct approver, recorded when a four-eyes
   * case transitions from `pending_secondary_approval` to `approved`.
   */
  secondaryReviewer?: string;
  /** ISO-8601 UTC timestamp at which the secondary approval was recorded. */
  secondaryApprovalAt?: string;
  /**
   * Identity of the actor who recorded the most recent `edited` event
   * for this case, if any. Used by the four-eyes gate to refuse
   * approvals submitted by the same principal that authored the edit
   * (self-approval refusal).
   */
  lastEditor?: string;
}

/** Aggregate per-job review-gate snapshot. */
export interface ReviewGateSnapshot {
  schemaVersion: typeof REVIEW_GATE_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  jobId: string;
  generatedAt: string;
  /** Sorted by `testCaseId` for deterministic emission. */
  perTestCase: ReviewSnapshot[];
  /** Number of cases currently in `approved` (or `exported`/`transferred`) state. */
  approvedCount: number;
  /** Number of cases currently in `needs_review` state. */
  needsReviewCount: number;
  /** Number of cases currently in `rejected` state. */
  rejectedCount: number;
  /**
   * Number of cases currently awaiting a second distinct approver
   * (state = `pending_secondary_approval`). Optional for backward
   * compatibility; consumers must treat absence as `0` (#1376).
   */
  pendingSecondaryApprovalCount?: number;
  /**
   * Resolved four-eyes policy that produced this snapshot. Optional for
   * backward compatibility. When present, both arrays are sorted /
   * deduplicated (#1376).
   */
  fourEyesPolicy?: FourEyesPolicy;
}

/** Visual provenance attached to a QC mapping preview entry (Issue #1386). */
export interface QcMappingVisualProvenance {
  deployment:
    | "llama-4-maverick-vision"
    | "phi-4-multimodal-poc"
    | "mock"
    | "none";
  fallbackReason: VisualSidecarFallbackReason;
  confidenceMean: number;
  ambiguityCount: number;
  /**
   * SHA-256 hex of the derived validation-record identity tuple
   * `(screenId|deployment|sortedOutcomes|roundedConfidence)`. This is not a
   * raw screenshot hash and does not include request headers or secrets.
   */
  evidenceHash: string;
}

/** Single per-test-case mapping preview row consumed by QC/ALM operators. */
export interface QcMappingPreviewEntry {
  testCaseId: string;
  /** Deterministic candidate external id used for idempotent later transfer. */
  externalIdCandidate: string;
  testName: string;
  objective: string;
  priority: TestCasePriority;
  riskCategory: TestCaseRiskCategory;
  /** Forward-slash-separated folder path under the profile root. */
  targetFolderPath: string;
  preconditions: string[];
  testData: string[];
  designSteps: GeneratedTestCaseStep[];
  expectedResults: string[];
  /** Subset of figmaTraceRefs sufficient for round-trip provenance. */
  sourceTraceRefs: GeneratedTestCaseFigmaTrace[];
  exportable: boolean;
  blockingReasons: string[];
  visualProvenance?: QcMappingVisualProvenance;
}

/** Aggregate QC mapping preview artifact. */
export interface QcMappingPreviewArtifact {
  schemaVersion: typeof QC_MAPPING_PREVIEW_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  jobId: string;
  generatedAt: string;
  profileId: string;
  profileVersion: string;
  /** Sorted by `testCaseId` for deterministic emission. */
  entries: QcMappingPreviewEntry[];
}

/** Operator-tunable knobs of an OpenText ALM reference export profile. */
export interface OpenTextAlmExportProfile {
  id: string;
  version: string;
  description: string;
  /** Folder path prepended to every per-case `targetFolderPath`. */
  rootFolderPath: string;
  /**
   * Whether to wrap the test-case description in a CDATA block so that
   * embedded markup survives ALM round-trips.
   */
  cdataDescription: boolean;
}

/** Allowed content types declared on an exported artifact record. */
export const ALLOWED_EXPORT_ARTIFACT_CONTENT_TYPES = [
  "application/json",
  "text/csv",
  "application/xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;
export type ExportArtifactContentType =
  (typeof ALLOWED_EXPORT_ARTIFACT_CONTENT_TYPES)[number];

/** Single artifact bookkeeping row inside `export-report.json`. */
export interface ExportArtifactRecord {
  filename: string;
  /** SHA-256 hex of the on-disk byte stream. */
  sha256: string;
  bytes: number;
  contentType: ExportArtifactContentType;
}

/** Aggregate export-report artifact. */
export interface ExportReportArtifact {
  schemaVersion: typeof EXPORT_REPORT_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  jobId: string;
  generatedAt: string;
  profileId: string;
  profileVersion: string;
  /** Identity of the deployments behind the run. */
  modelDeployments: {
    testGeneration: string;
    visualPrimary?:
      | "llama-4-maverick-vision"
      | "phi-4-multimodal-poc"
      | "mock"
      | "none";
    visualFallback?:
      | "llama-4-maverick-vision"
      | "phi-4-multimodal-poc"
      | "mock"
      | "none";
  };
  exportedTestCaseCount: number;
  /** True when the pipeline refused to emit any non-report artifact. */
  refused: boolean;
  refusalCodes: ExportRefusalCode[];
  /** Sorted by filename for deterministic emission. */
  artifacts: ExportArtifactRecord[];
  /** Sorted, de-duplicated. */
  visualEvidenceHashes: string[];
  /** Hard invariant: raw screenshots are never embedded into export artifacts. */
  rawScreenshotsIncluded: false;
}

/* ------------------------------------------------------------------ */
/*  Wave 1 POC evidence manifest + evaluation report (Issue #1366)     */
/* ------------------------------------------------------------------ */

/** Schema version for the Wave 1 POC evidence manifest envelope. */
export const WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION = "1.0.0" as const;

/** Filename used for the Wave 1 POC evidence manifest artifact. */
export const WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME =
  "wave1-poc-evidence-manifest.json";

/** Filename used for the Wave 1 POC evidence manifest digest witness. */
export const WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME =
  "wave1-poc-evidence-manifest.sha256";

/** Schema version for the Wave 1 POC evaluation report envelope. */
export const WAVE1_POC_EVAL_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Filename used for the Wave 1 POC evaluation report artifact. */
export const WAVE1_POC_EVAL_REPORT_ARTIFACT_FILENAME =
  "wave1-poc-eval-report.json";

/**
 * Allowed Wave 1 POC fixture identifiers.
 *
 * `poc-onboarding` — synthetic onboarding-style sign-up flow.
 * `poc-payment-auth` — synthetic payment + 3-D Secure authorisation flow.
 *
 * Both fixtures are public, contain only synthetic data, and ship with a
 * companion visual sidecar fixture so the Figma → Visual Sidecar →
 * Business Test Intent IR → structured generation chain is exercised
 * end-to-end against an air-gapped mock LLM.
 */
export const WAVE1_POC_FIXTURE_IDS = [
  "poc-onboarding",
  "poc-payment-auth",
] as const;

/** Identifier of a Wave 1 POC fixture. */
export type Wave1PocFixtureId = (typeof WAVE1_POC_FIXTURE_IDS)[number];

/** Categorisation of an artifact attested by the evidence manifest. */
export type Wave1PocEvidenceArtifactCategory =
  | "intent"
  | "validation"
  | "review"
  | "export"
  | "manifest"
  | "visual_sidecar"
  | "finops"
  | "attestation"
  | "signature"
  | "lbom"
  | "self_verify_rubric"
  | "intent_delta"
  | "dedupe_report"
  | "traceability_matrix"
  | "multi_source_reconciliation"
  | "source_ir"
  | "source_provenance"
  | "multi_source_conflicts"
  | "production_readiness_eval";

/** Single artifact attested by the Wave 1 POC evidence manifest. */
export interface Wave1PocEvidenceArtifact {
  /** Relative filename inside the run directory. */
  filename: string;
  /** SHA-256 of the on-disk byte stream. */
  sha256: string;
  /** Byte length on disk at manifest creation time. */
  bytes: number;
  category: Wave1PocEvidenceArtifactCategory;
}

/**
 * Result of `verifyWave1PocEvidenceManifest` against a directory of artifacts.
 * Determines whether ALL attested artifacts still hash to the values stored
 * in the manifest. Any mismatch fails the verification fail-closed.
 */
export interface Wave1PocEvidenceVerificationResult {
  ok: boolean;
  /** Filenames listed in the manifest that are missing on disk. */
  missing: string[];
  /** Filenames whose on-disk SHA-256 differs from the manifest. */
  mutated: string[];
  /** Filenames whose on-disk byte length differs from the manifest. */
  resized: string[];
  /** Filenames present on disk but not attested by the manifest. */
  unexpected: string[];
  /**
   * Manifest self-attestation result when the manifest carries a
   * `manifestIntegrity` block, or when a current-version manifest is missing
   * the block and therefore fails closed.
   */
  manifestIntegrity?: Wave1PocEvidenceManifestIntegrityVerification;
}

/** Self-attestation stamped into the Wave 1 evidence manifest. */
export interface Wave1PocEvidenceManifestIntegrity {
  algorithm: "sha256";
  /** SHA-256 of canonical manifest JSON with `manifestIntegrity` omitted. */
  hash: string;
}

/** Structured verification result for the manifest self-attestation. */
export interface Wave1PocEvidenceManifestIntegrityVerification {
  algorithm: "sha256";
  actualHash: string;
  expectedHash?: string;
  ok: boolean;
}

/** Visual-sidecar summary duplicated into the Wave 1 evidence manifest. */
export interface Wave1PocEvidenceVisualSidecarSummary {
  selectedDeployment:
    | "llama-4-maverick-vision"
    | "phi-4-multimodal-poc"
    | "mock";
  fallbackReason: VisualSidecarFallbackReason;
  confidenceSummary: { min: number; max: number; mean: number };
  /** SHA-256 hex of the persisted `visual-sidecar-result.json` artifact. */
  resultArtifactSha256: string;
}

/**
 * Wave 1 POC evidence manifest. Frozen, deterministic, byte-identical
 * across runs of the same fixture and mock output. Lists every artifact
 * the harness emits with its SHA-256 hash and byte length, plus the
 * contract / template / schema / policy / model identities used during
 * the run. The manifest itself is also written to disk; verifying its
 * integrity is performed against the stored copy plus the artifact bytes.
 *
 * Two negative invariants are stamped explicitly so they appear in the
 * evidence audit trail rather than being inferred from absence:
 *
 *   - `rawScreenshotsIncluded: false` — no raw screenshot bytes are ever
 *     embedded in any exported artifact.
 *   - `imagePayloadSentToTestGeneration: false` — the structured-test-case
 *     generator deployment (e.g. `gpt-oss-120b`) never received an image
 *     payload during the run; image-bearing payloads only flow into the
 *     visual sidecar role.
 */
export interface Wave1PocEvidenceManifest {
  schemaVersion: typeof WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION;
  /** workspace-dev contract version that produced the artifacts. */
  contractVersion: string;
  /** Test-intelligence subsurface contract version. */
  testIntelligenceContractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  /** Identifier of the fixture exercised. */
  fixtureId: Wave1PocFixtureId;
  jobId: string;
  generatedAt: string;
  /** Versions used to compile the prompt and validate the output. */
  promptTemplateVersion: typeof TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION;
  generatedTestCaseSchemaVersion: typeof GENERATED_TEST_CASE_SCHEMA_VERSION;
  visualSidecarSchemaVersion: typeof VISUAL_SIDECAR_SCHEMA_VERSION;
  redactionPolicyVersion: typeof REDACTION_POLICY_VERSION;
  /** Policy profile identity used by the validation pipeline. */
  policyProfileId: string;
  policyProfileVersion: string;
  /** OpenText ALM (or override) export profile identity. */
  exportProfileId: string;
  exportProfileVersion: string;
  /** Identities of the deployments behind the run. */
  modelDeployments: {
    testGeneration: string;
    visualPrimary?:
      | "llama-4-maverick-vision"
      | "phi-4-multimodal-poc"
      | "mock"
      | "none";
    visualFallback?:
      | "llama-4-maverick-vision"
      | "phi-4-multimodal-poc"
      | "mock"
      | "none";
  };
  /** Replay-cache identity hashes for the run (mirrors compiled prompt). */
  promptHash: string;
  schemaHash: string;
  inputHash: string;
  cacheKeyDigest: string;
  /** Direct visual-sidecar evidence summary when the opt-in sidecar path ran. */
  visualSidecar?: Wave1PocEvidenceVisualSidecarSummary;
  /**
   * Self-attestation over the canonical manifest metadata and artifact list.
   * New manifests stamp this field; it remains optional so legacy manifests can
   * still be parsed and verified with their existing digest witness.
   */
  manifestIntegrity?: Wave1PocEvidenceManifestIntegrity;
  /** Sorted-by-filename, de-duplicated artifact list. */
  artifacts: Wave1PocEvidenceArtifact[];
  /**
   * Per-source provenance records added when the multi-source pipeline ran.
   * Present only when `multiSourceEnabled` is `true`. Each entry records the
   * SHA-256 + bytes of the per-source IR artifact under
   * `<runDir>/sources/<sourceId>/`. Never includes raw Jira API responses,
   * raw paste bytes, or PII.
   */
  sourceProvenanceRecords?: MultiSourceSourceProvenanceRecord[];
  /** `true` when the Wave 4 multi-source pipeline produced this manifest. */
  multiSourceEnabled?: boolean;
  /** Hard invariant: no raw screenshot bytes leak into export artifacts. */
  rawScreenshotsIncluded: false;
  /**
   * Hard invariant: the structured-test-case generator deployment never
   * received an image payload during the run.
   */
  imagePayloadSentToTestGeneration: false;
  /** Hard invariant on multi-source manifests: raw Jira responses not persisted. */
  rawJiraResponsePersisted?: false;
  /** Hard invariant on multi-source manifests: raw paste bytes not persisted. */
  rawPasteBytesPersisted?: false;
}

/**
 * Numeric thresholds applied by the Wave 1 POC evaluation gate. Each
 * threshold is enforced on a per-fixture basis. Fractions are in `[0, 1]`.
 */
export interface Wave1PocEvalThresholds {
  /** Fraction of detected fields covered by at least one approved test case. */
  minTraceCoverageFields: number;
  /** Fraction of detected actions covered by at least one approved test case. */
  minTraceCoverageActions: number;
  /** Fraction of detected validations covered by at least one approved test case. */
  minTraceCoverageValidations: number;
  /** Fraction of approved cases whose `qcMappingPreview.exportable` is true. */
  minQcMappingExportableFraction: number;
  /**
   * Maximum allowed pairwise duplicate similarity across all generated cases.
   * Computed by `detectDuplicateTestCases` on case fingerprints.
   */
  maxDuplicateSimilarity: number;
  /** Minimum number of `expectedResults` entries required per approved case. */
  minExpectedResultsPerCase: number;
  /** Minimum number of approved cases required after the review gate. */
  minApprovedCases: number;
  /** Validation pipeline must not block. */
  requirePolicyPass: boolean;
  /** Visual sidecar gate must not block (when sidecar is present). */
  requireVisualSidecarPass: boolean;
  /**
   * Optional minimum job-level self-verify rubric score in `[0, 1]`
   * (Issue #1379). When set, the eval gate fails the run if the rubric
   * pass produced a `jobLevelRubricScore` strictly below this threshold.
   * When omitted, the rubric job-level score is informational only.
   */
  minJobRubricScore?: number;
  /**
   * When `true`, the eval gate also fails when the self-verify rubric
   * pass attached a `refusal` to its report. Defaulted to `false` so
   * the eval gate stays byte-stable for fixtures that do not exercise
   * the opt-in pass.
   */
  requireRubricPass?: boolean;
}

/** Failure record describing a single threshold breach. */
export interface Wave1PocEvalFailure {
  rule:
    | "min_trace_coverage_fields"
    | "min_trace_coverage_actions"
    | "min_trace_coverage_validations"
    | "min_qc_mapping_exportable_fraction"
    | "max_duplicate_similarity"
    | "min_expected_results_per_case"
    | "min_approved_cases"
    | "policy_blocked"
    | "visual_sidecar_blocked"
    | "validation_blocked"
    | "export_refused"
    | "min_job_rubric_score"
    | "rubric_pass_refused";
  /** Numeric or boolean observed value (encoded as number for comparators). */
  actual: number;
  /** Numeric or boolean threshold that was breached. */
  threshold: number;
  message: string;
}

/** Per-fixture metrics computed by the Wave 1 POC evaluation gate. */
export interface Wave1PocEvalFixtureMetrics {
  fixtureId: Wave1PocFixtureId;
  totalGeneratedCases: number;
  approvedCases: number;
  blockedCases: number;
  needsReviewCases: number;
  detectedFields: number;
  coveredFields: number;
  detectedActions: number;
  coveredActions: number;
  detectedValidations: number;
  coveredValidations: number;
  exportableApprovedCases: number;
  maxObservedDuplicateSimilarity: number;
  minObservedExpectedResultsPerCase: number;
  policyBlocked: boolean;
  validationBlocked: boolean;
  visualSidecarBlocked: boolean;
  exportRefused: boolean;
  /**
   * Optional job-level self-verify rubric score (Issue #1379). Only
   * present when the rubric pass ran for the fixture. Mirrors the value
   * stored on `coverage-report.json#rubricScore` (rounded to 6 digits).
   */
  jobRubricScore?: number;
  /**
   * Whether the rubric pass attached a `refusal` to its report
   * (Issue #1379). `true` when the LLM gateway refused, the response
   * failed schema validation, or the per-case score set was incomplete.
   */
  rubricRefused?: boolean;
}

/** Per-fixture evaluation outcome. */
export interface Wave1PocEvalFixtureReport {
  fixtureId: Wave1PocFixtureId;
  pass: boolean;
  metrics: Wave1PocEvalFixtureMetrics;
  failures: Wave1PocEvalFailure[];
}

/**
 * Aggregate evaluation report covering one or more fixtures. This artifact
 * is byte-stable: fixtures and failures are sorted, hashes are not embedded,
 * and timestamps are caller-provided.
 */
export interface Wave1PocEvalReport {
  schemaVersion: typeof WAVE1_POC_EVAL_REPORT_SCHEMA_VERSION;
  contractVersion: string;
  testIntelligenceContractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  generatedAt: string;
  thresholds: Wave1PocEvalThresholds;
  fixtures: Wave1PocEvalFixtureReport[];
  pass: boolean;
}

/* ------------------------------------------------------------------ */
/*  Wave 1 POC in-toto attestation + Sigstore signing (Issue #1377)    */
/* ------------------------------------------------------------------ */

/**
 * Schema version for the in-toto v1 attestation envelope produced per
 * job by the Wave 1 POC harness. Bumped on any breaking change to the
 * statement payload, predicate shape, or DSSE encoding.
 */
export const WAVE1_POC_ATTESTATION_SCHEMA_VERSION = "1.0.0" as const;

/** in-toto v1 statement type URI. */
export const WAVE1_POC_ATTESTATION_STATEMENT_TYPE =
  "https://in-toto.io/Statement/v1" as const;

/**
 * Predicate type URI identifying the Wave 1 POC evidence shape. Bumped
 * in lockstep with the schema version when the predicate fields change.
 */
export const WAVE1_POC_ATTESTATION_PREDICATE_TYPE =
  "https://workspace-dev.figmapipe.dev/test-intelligence/wave1-poc-evidence/v1" as const;

/**
 * DSSE `payloadType` stamped onto every in-toto attestation. The pre-
 * authentication encoding (PAE) hashes this value alongside the payload
 * bytes so it is bound to the signature.
 */
export const WAVE1_POC_ATTESTATION_PAYLOAD_TYPE =
  "application/vnd.in-toto+json" as const;

/** Filename of the persisted in-toto DSSE envelope. */
export const WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME =
  "wave1-poc-attestation.intoto.json" as const;

/** Filename of the persisted Sigstore bundle when signing is enabled. */
export const WAVE1_POC_ATTESTATION_BUNDLE_FILENAME =
  "wave1-poc-attestation.bundle.json" as const;

/** Subdirectory under a run dir where attestation envelopes are persisted. */
export const WAVE1_POC_ATTESTATIONS_DIRECTORY =
  "evidence/attestations" as const;

/** Subdirectory under a run dir where Sigstore signature bundles are persisted. */
export const WAVE1_POC_SIGNATURES_DIRECTORY = "evidence/signatures" as const;

/** Sigstore bundle media type — pinned to the v0.3 envelope shape. */
export const WAVE1_POC_ATTESTATION_BUNDLE_MEDIA_TYPE =
  "application/vnd.dev.sigstore.bundle.v0.3+json" as const;

/**
 * Allowed signing modes for the Wave 1 POC attestation.
 *
 * - `unsigned` (default) — emit DSSE envelope with empty `signatures`,
 *   no Sigstore bundle. Always works air-gapped without network access.
 * - `sigstore` — emit DSSE envelope with one or more signatures and a
 *   Sigstore bundle alongside. The signer is operator-supplied; the
 *   built-in key-bound signer uses ECDSA P-256 from `node:crypto` so
 *   tests and verifiers run without external network calls. A keyless
 *   flow (Fulcio + Rekor) plugs into the same signer interface but is
 *   never invoked by default.
 */
export const ALLOWED_WAVE1_POC_ATTESTATION_SIGNING_MODES = [
  "unsigned",
  "sigstore",
] as const;

/** Discriminant of the active signing mode. */
export type Wave1PocAttestationSigningMode =
  (typeof ALLOWED_WAVE1_POC_ATTESTATION_SIGNING_MODES)[number];

/** Subject record inside the in-toto v1 statement. */
export interface Wave1PocAttestationSubject {
  /** Relative artifact path inside the run directory (no leading slash). */
  name: string;
  /** Subject digest map. Always populated with at least `sha256`. */
  digest: { sha256: string };
}

/**
 * Visual-sidecar identity carried into the attestation predicate so an
 * auditor can verify the multimodal chain of custody (Issue #1386
 * addendum to #1377). Mirrors the fields already attested on the
 * evidence manifest but pinned to the predicate version.
 */
export interface Wave1PocAttestationVisualSidecarIdentity {
  selectedDeployment:
    | "llama-4-maverick-vision"
    | "phi-4-multimodal-poc"
    | "mock";
  fallbackReason: VisualSidecarFallbackReason;
  visualPrimary?:
    | "llama-4-maverick-vision"
    | "phi-4-multimodal-poc"
    | "mock"
    | "none";
  visualFallback?:
    | "llama-4-maverick-vision"
    | "phi-4-multimodal-poc"
    | "mock"
    | "none";
  resultArtifactSha256: string;
}

/**
 * Predicate body of the Wave 1 POC attestation. The predicate carries
 * pipeline-identity facts (model deployments, prompt template, schema,
 * policy, export profile) plus the manifest's own SHA-256 so the
 * statement attests both the artifact subjects and the metadata
 * envelope used to produce them. No secrets, prompts, or response
 * bodies are embedded — only identity hashes and version stamps.
 */
export interface Wave1PocAttestationPredicate {
  schemaVersion: typeof WAVE1_POC_ATTESTATION_SCHEMA_VERSION;
  contractVersion: string;
  testIntelligenceContractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  fixtureId: Wave1PocFixtureId;
  jobId: string;
  generatedAt: string;
  /** Versions stamped by the harness at run time. */
  promptTemplateVersion: typeof TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION;
  generatedTestCaseSchemaVersion: typeof GENERATED_TEST_CASE_SCHEMA_VERSION;
  visualSidecarSchemaVersion: typeof VISUAL_SIDECAR_SCHEMA_VERSION;
  redactionPolicyVersion: typeof REDACTION_POLICY_VERSION;
  /** Policy bundle identity (validation gate). */
  policyProfileId: string;
  policyProfileVersion: string;
  /** Export profile identity (export-only QC pipeline). */
  exportProfileId: string;
  exportProfileVersion: string;
  /** Replay-cache identity hashes. */
  promptHash: string;
  schemaHash: string;
  inputHash: string;
  cacheKeyDigest: string;
  /** Identity of every model role active during the run. */
  modelDeployments: {
    testGeneration: string;
    visualPrimary?:
      | "llama-4-maverick-vision"
      | "phi-4-multimodal-poc"
      | "mock"
      | "none";
    visualFallback?:
      | "llama-4-maverick-vision"
      | "phi-4-multimodal-poc"
      | "mock"
      | "none";
  };
  /** Visual-sidecar chain-of-custody identity (when present). */
  visualSidecar?: Wave1PocAttestationVisualSidecarIdentity;
  /** Active signing mode; mirrored from the run input for auditability. */
  signingMode: Wave1PocAttestationSigningMode;
  /** SHA-256 of the canonical evidence manifest the attestation covers. */
  manifestSha256: string;
  /** Filename of the manifest artifact (relative to the run dir). */
  manifestFilename: typeof WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME;
  /** Hard invariant — no raw screenshot bytes attested. */
  rawScreenshotsIncluded: false;
  /** Hard invariant — no API keys / bearer tokens attested. */
  secretsIncluded: false;
  /** Hard invariant — test_generation never received an image payload. */
  imagePayloadSentToTestGeneration: false;
}

/** in-toto v1 statement envelope (the DSSE payload after base64 decode). */
export interface Wave1PocAttestationStatement {
  _type: typeof WAVE1_POC_ATTESTATION_STATEMENT_TYPE;
  predicateType: typeof WAVE1_POC_ATTESTATION_PREDICATE_TYPE;
  /** Sorted-by-name, de-duplicated subject list. */
  subject: Wave1PocAttestationSubject[];
  predicate: Wave1PocAttestationPredicate;
}

/** A single signature attached to a DSSE envelope. */
export interface Wave1PocAttestationSignature {
  /** Stable, non-secret identifier for the signing key. */
  keyid: string;
  /** Base64 (RFC 4648 §4) encoded signature bytes. */
  sig: string;
}

/**
 * DSSE envelope (canonical form). When `signatures` is empty the
 * envelope represents an unsigned attestation. When populated, each
 * signature is an ECDSA P-256 signature over the PAE-encoded
 * (payloadType, payload) tuple, base64-encoded into `sig`.
 */
export interface Wave1PocAttestationDsseEnvelope {
  /** Base64 (RFC 4648 §4) encoded `Wave1PocAttestationStatement` JSON. */
  payload: string;
  payloadType: typeof WAVE1_POC_ATTESTATION_PAYLOAD_TYPE;
  signatures: Wave1PocAttestationSignature[];
}

/**
 * Public-key verification material. Used by the key-bound Sigstore
 * signing flow (and by air-gapped verifiers that pin a single signer
 * key). The PEM-encoded public key MUST be a SubjectPublicKeyInfo over
 * the prime256v1 (P-256) curve.
 */
export interface Wave1PocAttestationPublicKeyMaterial {
  /** Stable, non-secret signer reference (matches `Wave1PocAttestationSignature.keyid`). */
  hint: string;
  /** PEM-encoded SubjectPublicKeyInfo for the matching public key. */
  publicKeyPem: string;
  /** Signing algorithm used to produce the DSSE signatures. */
  algorithm: "ecdsa-p256-sha256";
}

/**
 * X.509 certificate-chain verification material. Used by the Sigstore
 * keyless signing flow: the leaf certificate carries the OIDC-bound
 * subject identity and is signed by Fulcio. Verifiers reconstruct the
 * public key from the leaf certificate, then validate it through the
 * chain to a trust root the operator pins.
 *
 * The repo does not vendor Fulcio root certificates — operators wire
 * the trust root themselves. The cert-chain shape is provided here as
 * a load-bearing type so the Sigstore bundle media type can carry
 * keyless signatures end-to-end without breaking changes.
 */
export interface Wave1PocAttestationCertificateChainMaterial {
  /** Stable, non-secret signer reference (matches `Wave1PocAttestationSignature.keyid`). */
  hint: string;
  /**
   * PEM-encoded certificate chain, leaf first. The leaf certificate's
   * subject public key is used to verify the DSSE signature. Operators
   * wiring full Sigstore keyless flow include the Fulcio-issued leaf
   * (with the OIDC subject as a SAN extension) and any intermediate(s)
   * up to a trust root.
   */
  certificateChainPem: string;
  /** Signing algorithm used to produce the DSSE signatures. */
  algorithm: "ecdsa-p256-sha256";
  /**
   * Optional Rekor transparency-log inclusion proof reference. When
   * present, a verifier MAY consult its trusted Rekor instance to
   * confirm the entry is logged. The repo never fetches Rekor by
   * default; the field is opaque metadata.
   */
  rekorLogIndex?: number;
}

/**
 * Sigstore bundle verification material. Discriminated by which form
 * the operator wires: `publicKey` for key-bound signing (the repo's
 * default), `x509CertificateChain` for keyless signing (operator-
 * supplied integration with Fulcio + Rekor).
 */
export type Wave1PocAttestationVerificationMaterial =
  | { publicKey: Wave1PocAttestationPublicKeyMaterial }
  | {
      x509CertificateChain: Wave1PocAttestationCertificateChainMaterial;
    };

/** Sigstore-shaped bundle persisted alongside a signed attestation. */
export interface Wave1PocAttestationBundle {
  mediaType: typeof WAVE1_POC_ATTESTATION_BUNDLE_MEDIA_TYPE;
  /**
   * The DSSE envelope this bundle witnesses. Identical bytes to the
   * `evidence/attestations/...` artifact; duplication is intentional so
   * the bundle is self-contained.
   */
  dsseEnvelope: Wave1PocAttestationDsseEnvelope;
  /** Verification material — public key OR x509 certificate chain. */
  verificationMaterial: Wave1PocAttestationVerificationMaterial;
}

/**
 * Audit-timeline summary surfaced on the harness result. Carries only
 * non-secret identifiers and digests so callers can render signing
 * provenance without re-reading on-disk artifacts.
 */
export interface Wave1PocAttestationSummary {
  signingMode: Wave1PocAttestationSigningMode;
  /** Stable signer identifier (matches `keyid`). `undefined` when unsigned. */
  signerReference?: string;
  /** Relative path of the persisted in-toto envelope. */
  attestationFilename: string;
  /** SHA-256 of the canonical envelope bytes. */
  attestationSha256: string;
  /** Relative path of the Sigstore bundle. `undefined` when unsigned. */
  bundleFilename?: string;
  /** SHA-256 of the canonical bundle bytes. `undefined` when unsigned. */
  bundleSha256?: string;
}

/**
 * Failure record produced by `verifyWave1PocAttestation`. Each failure
 * names the specific subject / signature / metadata field that failed
 * so an auditor can pinpoint the mismatch without re-running the
 * harness.
 */
export interface Wave1PocAttestationVerificationFailure {
  /** Stable failure code. */
  code:
    | "envelope_unparseable"
    | "envelope_payload_type_mismatch"
    | "envelope_payload_decode_failed"
    | "statement_unparseable"
    | "statement_type_mismatch"
    | "statement_predicate_type_mismatch"
    | "statement_predicate_invalid"
    | "subject_missing_artifact"
    | "subject_digest_mismatch"
    | "subject_unattested_artifact"
    | "signing_mode_mismatch"
    | "signature_required"
    | "signature_unsigned_envelope_carries_signatures"
    | "signature_invalid_keyid"
    | "signature_invalid_encoding"
    | "signature_unverified"
    | "bundle_missing"
    | "bundle_envelope_mismatch"
    | "bundle_public_key_missing"
    | "manifest_sha256_mismatch";
  /** Subject / artifact / field that triggered the failure. */
  reference: string;
  /** Human-readable diagnostic. Never includes secrets. */
  message: string;
}

/** Result of `verifyWave1PocAttestation`. */
export interface Wave1PocAttestationVerificationResult {
  ok: boolean;
  signingMode: Wave1PocAttestationSigningMode;
  /** Number of signatures present (0 for unsigned). */
  signatureCount: number;
  /** True iff every present signature verified against `publicKey`. */
  signaturesVerified: boolean;
  /** Structured failure list — empty when `ok === true`. */
  failures: Wave1PocAttestationVerificationFailure[];
}

/* ------------------------------------------------------------------ */
/*  QC adapter + dry-run report (Issue #1368)                          */
/* ------------------------------------------------------------------ */

/** Schema version for the persisted dry-run report artifact (Issue #1368). */
export const DRY_RUN_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical filename for the persisted dry-run report artifact. */
export const DRY_RUN_REPORT_ARTIFACT_FILENAME = "dry-run-report.json" as const;

/**
 * Allowed transfer modes recognised by the QC adapter façade.
 *
 * - `export_only` — produce on-disk artifacts; no QC API touched.
 * - `dry_run` — validate target mapping (folder, fields, schema) without
 *   creating tests in the QC tool.
 * - `api_transfer` — controlled OpenText ALM write path implemented by the
 *   Wave 3 transfer orchestrator. The dry-run adapter still throws
 *   `mode_not_implemented` when called directly with this mode.
 */
export const ALLOWED_QC_ADAPTER_MODES = [
  "export_only",
  "dry_run",
  "api_transfer",
] as const;
export type QcAdapterMode = (typeof ALLOWED_QC_ADAPTER_MODES)[number];

/**
 * Allowed QC adapter provider discriminators. Wave 2 ships `opentext_alm`;
 * the rest are stub identifiers reserved so future adapters plug in
 * without contract churn.
 */
export const ALLOWED_QC_ADAPTER_PROVIDERS = [
  "opentext_alm",
  "opentext_octane",
  "opentext_valueedge",
  "xray",
  "testrail",
  "azure_devops_test_plans",
  "qtest",
  "custom",
] as const;
export type QcAdapterProvider = (typeof ALLOWED_QC_ADAPTER_PROVIDERS)[number];

/**
 * Allowed mapping-profile validation issue codes (Issue #1368). Tracks the
 * `ValidationIssue[]` style used elsewhere in test-intelligence.
 */
export const ALLOWED_QC_MAPPING_PROFILE_ISSUE_CODES = [
  "missing_base_url_alias",
  "invalid_base_url_alias",
  "missing_domain",
  "missing_project",
  "missing_target_folder_path",
  "invalid_target_folder_path",
  "missing_test_entity_type",
  "unsupported_test_entity_type",
  "missing_required_fields",
  "duplicate_required_field",
  "missing_design_step_mapping",
  "design_step_mapping_field_invalid",
  "credential_like_field_present",
  "provider_mismatch",
  "profile_id_mismatch",
] as const;
export type QcMappingProfileIssueCode =
  (typeof ALLOWED_QC_MAPPING_PROFILE_ISSUE_CODES)[number];

/**
 * Allowed reasons the QC adapter may refuse to produce a dry-run report.
 *
 * `provider_not_implemented` (Issue #1374) is appended at the end so the
 * ordinal positions of prior codes stay byte-stable for callers that pin
 * to a known index. The code is emitted by the dry-run-only stub adapter
 * for non-ALM providers that have no real implementation yet.
 */
export const ALLOWED_DRY_RUN_REFUSAL_CODES = [
  "no_mapped_test_cases",
  "mapping_profile_invalid",
  "provider_mismatch",
  "mode_not_implemented",
  "folder_resolution_failed",
  "provider_not_implemented",
] as const;
export type DryRunRefusalCode = (typeof ALLOWED_DRY_RUN_REFUSAL_CODES)[number];

/**
 * Allowed QC provider operations (Issue #1374).
 *
 * Each builtin provider descriptor advertises which of these operations its
 * adapter implements. The registry uses the matrix to surface "what does
 * this provider support" without coupling to a concrete adapter:
 *
 *   - `validate_profile` — pure structural validator runs against the
 *     supplied mapping profile.
 *   - `resolve_target_folder` — adapter knows how to validate a target
 *     folder path against its provider (read-only resolver).
 *   - `dry_run` — adapter can produce a `DryRunReportArtifact` (potentially
 *     a fail-closed stub).
 *   - `export_only` — adapter can emit export-only artifacts.
 *   - `api_transfer` — adapter can perform controlled API writes.
 *   - `register_custom` — caller may register a custom adapter under this
 *     provider id (only true for the reserved `custom` slot).
 */
export const ALLOWED_QC_PROVIDER_OPERATIONS = [
  "validate_profile",
  "resolve_target_folder",
  "dry_run",
  "export_only",
  "api_transfer",
  "register_custom",
] as const;
export type QcProviderOperation =
  (typeof ALLOWED_QC_PROVIDER_OPERATIONS)[number];

/** Allowed states of a target-folder resolution attempt under `dry_run`. */
export const ALLOWED_DRY_RUN_FOLDER_RESOLUTION_STATES = [
  "resolved",
  "missing",
  "simulated",
  "invalid_path",
] as const;
export type DryRunFolderResolutionState =
  (typeof ALLOWED_DRY_RUN_FOLDER_RESOLUTION_STATES)[number];

/** Provider-neutral mapping profile shape consumed by all QC adapters. */
export interface QcMappingProfile {
  /** Profile identity (e.g. `opentext-alm-default`). */
  id: string;
  version: string;
  /** QC provider this profile targets. */
  provider: QcAdapterProvider;
  /**
   * Symbolic alias for the base URL of the target QC tenant. Adapters
   * resolve the actual URL from operator-supplied secrets at call time;
   * the alias never carries credentials and never embeds userinfo.
   */
  baseUrlAlias: string;
  /** Tenant domain (e.g. `DEFAULT`). */
  domain: string;
  /** Tenant project (e.g. `payments-checkout`). */
  project: string;
  /** Forward-slash-separated `/Subject/...` folder path used as default root. */
  targetFolderPath: string;
  /** Test entity type string accepted by the QC tool (e.g. `MANUAL`). */
  testEntityType: string;
  /** Required field names enforced on each mapped case. Sorted, deduped. */
  requiredFields: string[];
  /**
   * Per-design-step field mapping. The keys are the GeneratedTestCaseStep
   * fields that participate in the QC step entity (`action`, `expected`,
   * `data`); the values are the QC field names they map to.
   */
  designStepMapping: {
    action: string;
    expected: string;
    data?: string;
  };
}

/** Single mapping-profile validation issue. */
export interface QcMappingProfileIssue {
  path: string;
  code: QcMappingProfileIssueCode;
  severity: TestCaseValidationSeverity;
  message: string;
}

/** Aggregate mapping-profile validation result. */
export interface QcMappingProfileValidationResult {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  issues: QcMappingProfileIssue[];
}

/**
 * Capability matrix for a QC provider (Issue #1374).
 *
 * Each flag mirrors a `QcProviderOperation`. Wave 3 ships only the
 * `opentext_alm` provider with the full matrix `true`; the other six
 * builtin providers advertise dry-run + validate only and refuse writes.
 * The reserved `custom` slot is published with every flag `false` until a
 * caller registers a concrete adapter.
 *
 * The shape is a closed product type so a future operation cannot be
 * silently introduced without a contract bump — every consumer reading the
 * matrix today is guaranteed to see exactly these six fields.
 */
export interface QcProviderCapabilities {
  /** Adapter exposes a structural `validateProfile` pass. */
  validateProfile: boolean;
  /** Adapter knows how to validate a target folder path (read-only). */
  resolveTargetFolder: boolean;
  /** Adapter can emit a `DryRunReportArtifact` (concrete or fail-closed stub). */
  dryRun: boolean;
  /** Adapter can emit export-only artifacts (CSV/XLSX/XML). */
  exportOnly: boolean;
  /** Adapter can perform controlled API writes against the live tool. */
  apiTransfer: boolean;
  /** Caller may register a concrete custom adapter under this provider id. */
  registerCustom: boolean;
}

/**
 * Descriptor for a builtin or custom-registered QC provider (Issue #1374).
 *
 * Descriptors are returned by the registry so a UI or operator audit can
 * answer "which providers are wired up and what can they do?" without
 * loading any adapter implementation. They carry no credentials, no URLs,
 * and no runtime mutable state.
 */
export interface QcProviderDescriptor {
  /** Provider discriminator from `ALLOWED_QC_ADAPTER_PROVIDERS`. */
  provider: QcAdapterProvider;
  /** Short human-readable label, e.g. `"OpenText ALM"`. */
  label: string;
  /** Semver-shaped descriptor version, bumped when the matrix changes. */
  version: string;
  /** True for the eight in-tree descriptors; false for caller-registered slots. */
  builtin: boolean;
  /** Capability matrix advertised for this provider. */
  capabilities: QcProviderCapabilities;
  /**
   * Optional pointer to the mapping-profile factory id a caller can use to
   * seed a fresh profile (e.g. `opentext-alm-default`). Absent when the
   * provider has no in-tree default profile yet.
   */
  mappingProfileSeedId?: string;
}

/** Per-test-case completeness row inside the dry-run report. */
export interface DryRunMappingCompletenessEntry {
  testCaseId: string;
  externalIdCandidate: string;
  /** Required field names whose mapped value was missing on the case. */
  missingRequiredFields: string[];
  /** True when every required field is populated AND the entry is exportable. */
  complete: boolean;
}

/** Aggregate mapping completeness summary. */
export interface DryRunMappingCompletenessSummary {
  totalCases: number;
  completeCases: number;
  incompleteCases: number;
  /** Distinct missing-field names across all cases, sorted. */
  missingFieldsAcrossCases: string[];
  perCase: DryRunMappingCompletenessEntry[];
}

/** Outcome of attempting to resolve a target folder under `dry_run`. */
export interface DryRunFolderResolution {
  state: DryRunFolderResolutionState;
  path: string;
  /**
   * Free-form, redacted evidence string supplied by the resolver (e.g.
   * `"simulated:matched-segments=3"`). Never includes a URL or token.
   */
  evidence: string;
}

/** Per-test-case planned ALM entity payload preview (REDACTED). */
export interface DryRunPlannedEntityPayload {
  testCaseId: string;
  externalIdCandidate: string;
  testEntityType: string;
  targetFolderPath: string;
  /** Mapped QC fields (deterministic, redacted, no credentials). */
  fields: { name: string; value: string }[];
  /** Number of design steps in the planned payload. */
  designStepCount: number;
  /**
   * Mean visual-sidecar confidence (0..1) across matching screen records,
   * rounded to 4 decimals for byte-stability. Issue #1374 multimodal
   * addendum (2026-04-24). Absent (no key set) when the case has no
   * matching visual records or when emitted by the dry-run stub adapter.
   */
  visualConfidence?: number;
  /**
   * Sorted, de-duplicated set of non-`ok` outcome codes contributing to the
   * matching visual records. Surfaces ambiguity reasons (`low_confidence`,
   * `schema_invalid`, etc.) without re-emitting the raw issue text. Absent
   * when no records match. Issue #1374.
   */
  visualAmbiguityFlags?: VisualSidecarValidationOutcome[];
  /**
   * True when at least one matching visual record carries the
   * `fallback_used` outcome — i.e. the secondary multimodal deployment
   * produced the description the case relies on. Absent when no records
   * match. Issue #1374.
   */
  visualFallbackUsed?: boolean;
  /**
   * Sorted by `screenId`, `modelDeployment`, then `evidenceHash`.
   * Each ref carries a derivative identity hash that lets a reviewer
   * correlate the planned payload back to the per-screen validation record
   * without re-importing raw screenshot bytes. Absent when no records match.
   * Issue #1374.
   *
   * Field semantics:
   *   - `screenId` — matching `VisualSidecarValidationRecord.screenId`.
   *   - `modelDeployment` — sourced verbatim from
   *     `VisualSidecarValidationRecord.deployment`. The contract historically
   *     uses the field name `deployment` on the record; this ref re-exposes
   *     it under `modelDeployment` to align with the broader replay-cache
   *     idiom (see `SelfVerifyRubricReplayCacheKey.modelDeployment`).
   *   - `evidenceHash` — `sha256` hex of the canonical validation-record
   *     identity tuple `(screenId|deployment|sortedOutcomes|roundedConfidence)`.
   *     Note this is NOT a hash of screenshot bytes — the dry-run adapter
   *     never receives image bytes. The `VisualSidecarCaptureIdentity.sha256`
   *     (image-byte hash) lives only on the upstream
   *     `VisualSidecarSuccess` artifact, which dry-run does not consume.
   */
  visualEvidenceRefs?: {
    screenId: string;
    modelDeployment: string;
    evidenceHash: string;
  }[];
}

/**
 * Visual evidence flag attached to a mapped case when the case's mapping
 * derives from low-confidence visual-only sidecar observations (Issue
 * #1386 / #1368).
 */
export interface DryRunVisualEvidenceFlag {
  testCaseId: string;
  /** Originating screen ids in the visual sidecar that drive the flag. */
  screenIds: string[];
  /** Mean sidecar confidence across the matching screen records (0..1). */
  sidecarConfidence: number;
  /** Per-screen ambiguity outcome counts contributing to the flag. */
  ambiguityFlags: VisualSidecarValidationOutcome[];
  /** Stable trace references — figmaTraceRefs subset that drove the mapping. */
  traceRefs: GeneratedTestCaseFigmaTrace[];
  /**
   * Explicit reason classification:
   *   - `visual_only_low_confidence_mapping` — mapping derives only from
   *     sidecar observations whose confidence is below the configured
   *     threshold; reviewer must validate before transfer.
   */
  reason: "visual_only_low_confidence_mapping";
}

/** Aggregate dry-run report artifact. */
export interface DryRunReportArtifact {
  schemaVersion: typeof DRY_RUN_REPORT_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  /** Deterministic id derived from job + adapter + profile + clock. */
  reportId: string;
  jobId: string;
  generatedAt: string;
  mode: QcAdapterMode;
  adapter: { provider: QcAdapterProvider; version: string };
  profile: { id: string; version: string };
  /** True iff the adapter refused to produce a usable report. */
  refused: boolean;
  refusalCodes: DryRunRefusalCode[];
  profileValidation: QcMappingProfileValidationResult;
  completeness: DryRunMappingCompletenessSummary;
  folderResolution: DryRunFolderResolution;
  /** Sorted by `testCaseId`. Empty when the report is refused. */
  plannedPayloads: DryRunPlannedEntityPayload[];
  /** Sorted by `testCaseId`. */
  visualEvidenceFlags: DryRunVisualEvidenceFlag[];
  /** Hard invariant: raw screenshots are never embedded into dry-run payloads. */
  rawScreenshotsIncluded: false;
  /** Hard invariant: credentials are never embedded into dry-run payloads. */
  credentialsIncluded: false;
}

/* ------------------------------------------------------------------ */
/*  QC adapter API transfer report (Issue #1372 — Wave 3)              */
/* ------------------------------------------------------------------ */

/**
 * Controlled OpenText ALM API transfer surface (Issue #1372).
 *
 * Wave 3 introduces the production-capable `api_transfer` mode for the
 * QC adapter. Unlike `dry_run` (no I/O) or `export_only` (artifact write
 * only), `api_transfer` performs real writes against an OpenText ALM
 * tenant — but only after every Wave 1/2 gate has been satisfied:
 *
 *   1. Feature gate (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1`).
 *   2. Admin/startup gate (`allowApiTransfer=true`).
 *   3. Bearer token configured + accepted on the server-side caller.
 *   4. Test cases reached `approved` (or already `exported`/`transferred`).
 *   5. Policy decisions are not `blocked`.
 *   6. Dry-run report for the same profile reports `refused: false`.
 *   7. Visual-sidecar evidence present for visual-driven cases (#1386).
 *   8. Four-eyes approval recorded when enforced (#1376).
 *
 * Transfer is idempotent: re-running on the same approved set never
 * creates duplicates (lookup by `externalIdCandidate` + `targetFolderPath`).
 *
 * Hard invariants stamped at the type level on every emitted artifact:
 *   - `rawScreenshotsIncluded: false`
 *   - `credentialsIncluded: false`
 *   - `transferUrlIncluded: false`
 */

/** Schema version for the persisted transfer-report artifact (Issue #1372). */
export const TRANSFER_REPORT_SCHEMA_VERSION = "1.1.0" as const;

/** Canonical filename for the persisted transfer-report artifact. */
export const TRANSFER_REPORT_ARTIFACT_FILENAME =
  "transfer-report.json" as const;

/** Schema version for the persisted qc-created-entities artifact (Issue #1372). */
export const QC_CREATED_ENTITIES_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical filename for the persisted qc-created-entities artifact. */
export const QC_CREATED_ENTITIES_ARTIFACT_FILENAME =
  "qc-created-entities.json" as const;

/**
 * Allowed reasons the QC adapter may refuse to perform an API transfer.
 *
 * These are evaluated in fail-closed order — the first refusal stops the
 * pipeline before any state-mutating call leaves the process. The
 * `transfer-report.json` artifact records every refusal that fired so
 * the operator can address them all in one cycle.
 */
export const ALLOWED_TRANSFER_REFUSAL_CODES = [
  "feature_disabled",
  "admin_gate_disabled",
  "bearer_token_missing",
  "mapping_profile_invalid",
  "provider_mismatch",
  "no_mapped_test_cases",
  "no_approved_test_cases",
  "unapproved_test_cases_present",
  "policy_blocked_cases_present",
  "schema_invalid_cases_present",
  "visual_sidecar_blocked",
  "visual_sidecar_evidence_missing",
  "review_state_inconsistent",
  "four_eyes_pending",
  "dry_run_refused",
  "dry_run_missing",
  "folder_resolution_failed",
  "mode_not_implemented",
] as const;
export type TransferRefusalCode =
  (typeof ALLOWED_TRANSFER_REFUSAL_CODES)[number];

/**
 * Per-test-case outcome of an API transfer attempt. Discriminated so
 * report consumers can sort + count without re-deriving the state.
 *
 * - `created` — the entity did not exist; create call succeeded.
 * - `skipped_duplicate` — the entity already exists for this
 *   `externalIdCandidate` + folder; no write performed.
 * - `failed` — adapter or transport error. When `qcEntityId` is
 *   non-empty, the tenant may contain a partially created entity and the
 *   rollback guidance must include it for operator cleanup.
 * - `refused` — pipeline-level refusal (e.g. unapproved); no call
 *   was attempted.
 */
export const ALLOWED_TRANSFER_ENTITY_OUTCOMES = [
  "created",
  "skipped_duplicate",
  "failed",
  "refused",
] as const;
export type TransferEntityOutcome =
  (typeof ALLOWED_TRANSFER_ENTITY_OUTCOMES)[number];

/**
 * Allowed failure classes for a per-entity transfer failure. Mirrors the
 * gateway taxonomy so transport faults stay distinguishable from
 * server-side validation faults.
 */
export const ALLOWED_TRANSFER_FAILURE_CLASSES = [
  "transport_error",
  "auth_failed",
  "permission_denied",
  "validation_rejected",
  "conflict_unresolved",
  "rate_limited",
  "server_error",
  "unknown",
] as const;
export type TransferFailureClass =
  (typeof ALLOWED_TRANSFER_FAILURE_CLASSES)[number];

/** Hash-only evidence references that bind transfer to upstream artifacts. */
export interface TransferEvidenceReferences {
  /** SHA-256 hex of the QC mapping preview consumed by transfer. */
  qcMappingPreviewHash: string;
  /** SHA-256 hex of the dry-run report consumed by transfer. */
  dryRunReportHash: string;
  /** SHA-256 hex of the visual-sidecar validation report, when present. */
  visualSidecarReportHash: string;
  /** Sorted hash-only references to sidecar evidence used by mapped cases. */
  visualSidecarEvidenceHashes: string[];
  /** Optional SHA-256 hex of the generated test-case artifact. */
  generationOutputHash?: string;
  /** Optional SHA-256 hex of the reconciled intent IR artifact. */
  reconciledIntentIrHash?: string;
}

/** Audit metadata describing the operator/principal that authorised the run. */
export interface TransferAuditMetadata {
  /** Opaque actor handle; never an email or token. */
  actor: string;
  /** Stable id for the operator-supplied bearer-token principal. */
  authPrincipalId: string;
  /**
   * Whether the operator-supplied bearer token matched a configured
   * principal. `true` is required for the transfer to proceed.
   */
  bearerTokenAccepted: boolean;
  /** Reasons four-eyes review applied to one or more cases (sorted, deduped). */
  fourEyesReasons: FourEyesEnforcementReason[];
  /** Identity of the dry-run report consumed; binds the run to a validation. */
  dryRunReportId: string;
  /** Hash-only upstream artifact references; never raw prompts, screenshots, or credentials. */
  evidenceReferences: TransferEvidenceReferences;
}

/** Per-entity record inside the transfer report. */
export interface TransferEntityRecord {
  testCaseId: string;
  externalIdCandidate: string;
  targetFolderPath: string;
  outcome: TransferEntityOutcome;
  /**
   * Resolved QC entity id when the outcome is `created`, `skipped_duplicate`,
   * or a failed attempt left a partial tenant entity. Empty for `refused`.
   */
  qcEntityId: string;
  /** Number of design steps the adapter created for this entity. */
  designStepsCreated: number;
  /** Wall-clock timestamp at which the adapter recorded the outcome. */
  recordedAt: string;
  /** Failure class when `outcome === "failed"`; absent otherwise. */
  failureClass?: TransferFailureClass;
  /** Sanitised, length-bounded failure detail; never carries URLs/tokens. */
  failureDetail?: string;
}

/** Single created QC entity row in `qc-created-entities.json`. */
export interface QcCreatedEntity {
  testCaseId: string;
  externalIdCandidate: string;
  qcEntityId: string;
  /** Forward-slash-separated folder path under the profile root. */
  targetFolderPath: string;
  /** ISO-8601 UTC timestamp at which the entity was first created. */
  createdAt: string;
  /** Number of design steps persisted alongside the entity. */
  designStepCount: number;
  /**
   * `true` when the entity already existed on a prior transfer run for
   * the same `(externalIdCandidate, targetFolderPath)` tuple. Idempotent
   * re-runs preserve this flag so audit logs document the lineage.
   */
  preExisting: boolean;
}

/** Aggregate `qc-created-entities.json` artifact (Issue #1372). */
export interface QcCreatedEntitiesArtifact {
  schemaVersion: typeof QC_CREATED_ENTITIES_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  jobId: string;
  generatedAt: string;
  profileId: string;
  profileVersion: string;
  /** Sorted by `testCaseId` for deterministic emission. */
  entities: QcCreatedEntity[];
  /** Hard invariant: never carries the resolved transfer URL. */
  transferUrlIncluded: false;
}

/** Aggregate `transfer-report.json` artifact (Issue #1372). */
export interface TransferReportArtifact {
  schemaVersion: typeof TRANSFER_REPORT_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  /** Deterministic id derived from job + adapter + profile + clock. */
  reportId: string;
  jobId: string;
  generatedAt: string;
  mode: QcAdapterMode;
  adapter: { provider: QcAdapterProvider; version: string };
  profile: { id: string; version: string };
  /** True iff the pipeline refused to perform any write. */
  refused: boolean;
  refusalCodes: TransferRefusalCode[];
  /** Sorted by `testCaseId`. Empty when refused before any attempt. */
  records: TransferEntityRecord[];
  /** Number of records whose outcome is `created`. */
  createdCount: number;
  /** Number of records whose outcome is `skipped_duplicate`. */
  skippedDuplicateCount: number;
  /** Number of records whose outcome is `failed`. */
  failedCount: number;
  /** Number of records whose outcome is `refused`. */
  refusedCount: number;
  /** Audit metadata for the run. */
  audit: TransferAuditMetadata;
  /** Hard invariant: raw screenshots are never embedded into transfer payloads. */
  rawScreenshotsIncluded: false;
  /** Hard invariant: credentials are never embedded into transfer payloads. */
  credentialsIncluded: false;
  /** Hard invariant: never carries the resolved transfer URL. */
  transferUrlIncluded: false;
}

/**
 * Jira Write Workflow contract surface (Issue #1482, Wave 5).
 *
 * Approved test cases may be written back to Jira as sub-tasks of a
 * specified parent issue. The pipeline is opt-in and fail-closed across
 * eight stacked gates (feature flag, admin gate, bearer token, valid
 * `parentIssueKey`, at least one approved case, no policy-blocked
 * cases, no schema-invalid cases, no visual-sidecar-blocked cases). All
 * gate violations are collected and reported in
 * `jira-write-report.json` so an operator can address them in one cycle.
 *
 * Idempotency is enforced via a stable `externalId` derived from the
 * `(jobId, testCaseId, parentIssueKey)` triple; lookups against the
 * tenant short-circuit duplicates to `skipped_duplicate`.
 *
 * Hard invariants stamped at the type level on every emitted artifact:
 *   - `rawScreenshotsIncluded: false`
 *   - `credentialsIncluded: false`
 *
 * Markdown artifacts are written separately (per test case) and never
 * embed bearer tokens, raw screenshots, or base64 image data.
 */

/** Schema version for the persisted Jira write report artifact (Issue #1482). */
export const JIRA_WRITE_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical filename for the Jira write report artifact. */
export const JIRA_WRITE_REPORT_ARTIFACT_FILENAME =
  "jira-write-report.json" as const;

/** Sub-directory under the run dir where Jira write artifacts are persisted. */
export const JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY = "jira-write" as const;

/** Schema version for the persisted Jira created sub-tasks artifact (Issue #1482). */
export const JIRA_CREATED_SUBTASKS_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical filename for the Jira created sub-tasks artifact. */
export const JIRA_CREATED_SUBTASKS_ARTIFACT_FILENAME =
  "jira-created-subtasks.json" as const;

/**
 * Allowed Jira write modes. Only `jira_subtasks` is shipped in Wave 5;
 * the array is the source of truth so future modes plug in without
 * changing call sites.
 */
export const ALLOWED_JIRA_WRITE_MODE_VALUES = ["jira_subtasks"] as const;
export type JiraWriteMode = (typeof ALLOWED_JIRA_WRITE_MODE_VALUES)[number];

/**
 * Allowed reasons the Jira write pipeline may refuse to perform any
 * sub-task creation. Evaluated in fail-closed order; every fired refusal
 * is recorded so operators can address them all in one cycle.
 */
export const ALLOWED_JIRA_WRITE_REFUSAL_CODES = [
  "feature_gate_disabled",
  "admin_gate_disabled",
  "bearer_token_missing",
  "invalid_parent_issue_key",
  "no_approved_test_cases",
  "policy_blocked_cases_present",
  "schema_invalid_cases_present",
  "visual_sidecar_blocked",
] as const;
export type JiraWriteRefusalCode =
  (typeof ALLOWED_JIRA_WRITE_REFUSAL_CODES)[number];

/**
 * Per-case outcome of a Jira sub-task write attempt.
 *
 * - `created` — sub-task did not exist; Jira create call succeeded.
 * - `skipped_duplicate` — sub-task already exists for this `externalId`
 *   on the parent; no write performed.
 * - `failed` — adapter or transport error; pipeline continued with
 *   subsequent cases (per-case failure isolation).
 * - `dry_run` — pipeline was invoked with `dryRun=true`; no Jira call
 *   was attempted.
 */
export const ALLOWED_JIRA_WRITE_ENTITY_OUTCOMES = [
  "created",
  "skipped_duplicate",
  "failed",
  "dry_run",
] as const;
export type JiraWriteEntityOutcome =
  (typeof ALLOWED_JIRA_WRITE_ENTITY_OUTCOMES)[number];

/**
 * Allowed failure classes for a per-case Jira write failure. Mirrors the
 * Jira gateway taxonomy so transport faults stay distinguishable from
 * server-side validation faults.
 */
export const ALLOWED_JIRA_WRITE_FAILURE_CLASSES = [
  "transport_error",
  "auth_failed",
  "permission_denied",
  "validation_rejected",
  "rate_limited",
  "server_error",
  "provider_not_implemented",
  "unknown",
] as const;
export type JiraWriteFailureClass =
  (typeof ALLOWED_JIRA_WRITE_FAILURE_CLASSES)[number];

/**
 * Per-test-case sub-task record persisted in `jira-created-subtasks.json`
 * and embedded in the audit-shaped `jira-write-report.json`.
 */
export interface JiraSubTaskRecord {
  /** Generated test case identifier this sub-task corresponds to. */
  testCaseId: string;
  /** Stable idempotency key SHA-256(`jobId|testCaseId|parentIssueKey`). */
  externalId: string;
  outcome: JiraWriteEntityOutcome;
  /** Resolved Jira issue key for the created or pre-existing sub-task. */
  jiraIssueKey?: string;
  /** Failure classification when `outcome === "failed"`. */
  failureClass?: JiraWriteFailureClass;
  /**
   * Whether the failed sub-task attempt is safe to retry later. Present only
   * for failed outcomes so persisted status can distinguish transient
   * transport/rate-limit/server failures from permanent validation/auth faults.
   */
  retryable?: boolean;
  /** Sanitised, length-bounded failure detail; never carries URLs/tokens. */
  failureDetail?: string;
}

/** Aggregate `jira-created-subtasks.json` artifact (Issue #1482). */
export interface JiraCreatedSubtasksArtifact {
  schemaVersion: typeof JIRA_CREATED_SUBTASKS_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  jobId: string;
  parentIssueKey: string;
  generatedAt: string;
  /** Sorted by `testCaseId` for deterministic emission. */
  subtasks: JiraSubTaskRecord[];
  /** Hard invariant: raw screenshots are never embedded in Jira write payloads. */
  rawScreenshotsIncluded: false;
  /** Hard invariant: credentials are never embedded in Jira write payloads. */
  credentialsIncluded: false;
}

/** Audit metadata persisted alongside the Jira write report. */
export interface JiraWriteAuditMetadata {
  /** Stable opaque principal id; never an email or token. */
  principalId: string;
  /** Whether a bearer token was configured for the run. */
  bearerConfigured: boolean;
  /** Whether the admin gate (`allowJiraWrite`) was enabled. */
  adminEnabled: boolean;
  /** Whether the run was a dry-run (no live Jira calls). */
  dryRun: boolean;
  /** Mode used by this run; only `jira_subtasks` is shipped in Wave 5. */
  mode: JiraWriteMode;
}

/** Aggregate `jira-write-report.json` artifact (Issue #1482). */
export interface JiraWriteReportArtifact {
  schemaVersion: typeof JIRA_WRITE_REPORT_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  jobId: string;
  parentIssueKey: string;
  generatedAt: string;
  /** True iff the pipeline refused to perform any write. */
  refused: boolean;
  /** Sorted, deduplicated refusal codes that fired. */
  refusalCodes: JiraWriteRefusalCode[];
  /** Total number of approved test cases supplied to the pipeline. */
  totalCases: number;
  /** Number of records whose outcome is `created`. */
  createdCount: number;
  /** Number of records whose outcome is `skipped_duplicate`. */
  skippedDuplicateCount: number;
  /** Number of records whose outcome is `failed`. */
  failedCount: number;
  /** Number of records whose outcome is `dry_run`. */
  dryRunCount: number;
  /** Audit metadata for the run. */
  audit: JiraWriteAuditMetadata;
  /** Hard invariant: raw screenshots are never embedded in Jira write payloads. */
  rawScreenshotsIncluded: false;
  /** Hard invariant: credentials are never embedded in Jira write payloads. */
  credentialsIncluded: false;
}

/**
 * FinOps budget + operational controls for test-intelligence LLM jobs (Issue #1371).
 *
 * The FinOps surface lets an operator bound an LLM job's input/output token
 * usage, wall-clock duration, retry count, image payload size, and replay-cache
 * miss rate per role (`test_generation`, `visual_primary`, `visual_fallback`),
 * and persist a deterministic per-job `budget-report.json` under the job's
 * `finops/` artifact directory. The artifact is local-only by default and
 * never carries secrets, raw prompts, or image bytes.
 *
 * Hard invariants:
 *   - Cache hits report zero token usage AND zero LLM call attempts.
 *   - Wall-clock budget breach is FAIL CLOSED (`retryable: false`).
 *   - Token / wall-clock budget breach STOPS the job before downstream work.
 *   - The artifact records SHA-256 hashes of identity inputs only — never
 *     prompt text, response content, or token strings.
 */

/** Schema version for the persisted FinOps budget report artifact (Issue #1371). */
export const FINOPS_BUDGET_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Subdirectory under a run dir where FinOps artifacts are persisted. */
export const FINOPS_ARTIFACT_DIRECTORY = "finops" as const;

/** Canonical filename for the FinOps budget report artifact. */
export const FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME =
  "budget-report.json" as const;

/**
 * Per-role discriminant used inside the FinOps surface. Mirrors the gateway
 * roles but is exported as its own list so policy gates can iterate roles
 * without depending on the gateway surface.
 */
export const ALLOWED_FINOPS_ROLES = [
  "test_generation",
  "visual_primary",
  "visual_fallback",
  "jira_api_requests",
  "jira_paste_ingest",
  "custom_context_ingest",
] as const;

/** Discriminant of an allowed FinOps role. */
export type FinOpsRole = (typeof ALLOWED_FINOPS_ROLES)[number];

/** Allowed budget breach reasons. Discriminated for policy-readable diagnostics. */
export const ALLOWED_FINOPS_BUDGET_BREACH_REASONS = [
  "max_input_tokens",
  "max_output_tokens",
  "max_wall_clock_ms",
  "max_retries",
  "max_attempts",
  "max_image_bytes",
  "max_total_input_tokens",
  "max_total_output_tokens",
  "max_total_wall_clock_ms",
  "max_replay_cache_miss_rate",
  "max_fallback_attempts",
  "max_live_smoke_calls",
  "max_estimated_cost",
  "jira_api_quota_exceeded",
  "jira_paste_quota_exceeded",
  "custom_context_quota_exceeded",
] as const;

/** Discriminant of a FinOps budget breach reason. */
export type FinOpsBudgetBreachReason =
  (typeof ALLOWED_FINOPS_BUDGET_BREACH_REASONS)[number];

/** Allowed terminal outcomes for a FinOps-tracked job. */
export const ALLOWED_FINOPS_JOB_OUTCOMES = [
  "completed",
  "completed_cache_hit",
  "budget_exceeded",
  "policy_blocked",
  "validation_blocked",
  "visual_sidecar_failed",
  "export_refused",
  "gateway_failed",
] as const;

/** Discriminant of the terminal job outcome the FinOps report records. */
export type FinOpsJobOutcome = (typeof ALLOWED_FINOPS_JOB_OUTCOMES)[number];

/**
 * Per-role budget envelope. Every limit is optional; `undefined` means the
 * limit is not enforced for that role. Counters compare with `>` (strict
 * exceedance) — a usage that exactly equals a limit is allowed.
 */
export interface FinOpsRoleBudget {
  /** Cap on the gateway's pre-flight `estimateInputTokens` (per-request). */
  maxInputTokensPerRequest?: number;
  /** Cap on `max_completion_tokens` forwarded to the gateway (per-request). */
  maxOutputTokensPerRequest?: number;
  /** Aggregate input-token cap across every request the role makes. */
  maxTotalInputTokens?: number;
  /** Aggregate output-token cap across every request the role makes. */
  maxTotalOutputTokens?: number;
  /** Per-request wall-clock cap. Maps to `LlmGenerationRequest.maxWallClockMs`. */
  maxWallClockMsPerRequest?: number;
  /** Aggregate wall-clock cap across every request the role makes. */
  maxTotalWallClockMs?: number;
  /** Per-request retry cap. Maps to `LlmGenerationRequest.maxRetries`. */
  maxRetriesPerRequest?: number;
  /**
   * Maximum number of gateway attempts the role may make in total
   * (success-or-failure). Useful when the live smoke surface should
   * fire only N times.
   */
  maxAttempts?: number;
  /** Cap on the decoded image bytes per request (visual roles only). */
  maxImageBytesPerRequest?: number;
  /**
   * Maximum number of fallback-deployment attempts the visual role may make.
   * Enforced against `visual_fallback` only; ignored for other roles.
   */
  maxFallbackAttempts?: number;
  /**
   * Maximum number of live-smoke calls the role may make. Enforced when
   * the operator wires a live-smoke counter into the recorder; otherwise
   * treated as not-configured.
   */
  maxLiveSmokeCalls?: number;
  /**
   * Aggregate byte-ingest cap per job for non-LLM source-ingestion roles
   * (`jira_paste_ingest`, `custom_context_ingest`). Ignored for LLM roles.
   */
  maxIngestBytesPerJob?: number;
}

/**
 * Aggregate budget envelope for a job. The envelope is rendered into the
 * FinOps report verbatim so an operator can read the limits applied without
 * cross-referencing source code.
 */
export interface FinOpsBudgetEnvelope {
  /** Stable identifier for the budget profile (operator-supplied). */
  budgetId: string;
  /** Free-form version label for the budget profile. */
  budgetVersion: string;
  /** Aggregate wall-clock cap across the entire job, all roles combined. */
  maxJobWallClockMs?: number;
  /**
   * Maximum permitted replay-cache miss rate over the job (`misses / total`).
   * `undefined` disables the check. Range `[0, 1]`.
   */
  maxReplayCacheMissRate?: number;
  /**
   * Optional per-job estimated cost cap (currency-agnostic — the recorder
   * accepts caller-supplied per-1000-token rates). `undefined` disables the
   * check.
   */
  maxEstimatedCost?: number;
  /** Per-role budget records. Missing roles are unconstrained. */
  roles: {
    test_generation?: FinOpsRoleBudget;
    visual_primary?: FinOpsRoleBudget;
    visual_fallback?: FinOpsRoleBudget;
    jira_api_requests?: FinOpsRoleBudget;
    jira_paste_ingest?: FinOpsRoleBudget;
    custom_context_ingest?: FinOpsRoleBudget;
  };
  /**
   * Per-source quota caps for non-LLM ingestion roles. Checked before any
   * ingestion begins; breach emits the source-specific breach reason and
   * fails fast without writing any artifact.
   */
  sourceQuotas?: {
    /** Maximum Jira REST API calls per job. Default: `MAX_JIRA_API_REQUESTS_PER_JOB`. */
    maxJiraApiRequestsPerJob?: number;
    /** Maximum raw paste bytes per job. Default: `MAX_JIRA_PASTE_BYTES_PER_JOB`. */
    maxJiraPasteBytesPerJob?: number;
    /** Maximum custom-context input bytes per job. Default: `MAX_CUSTOM_CONTEXT_BYTES_PER_JOB`. */
    maxCustomContextBytesPerJob?: number;
  };
}

/**
 * Per-attempt cost-rate input. Operators can supply a flat per-1000-token
 * rate and a per-attempt fixed cost; the recorder multiplies usage to
 * produce `estimatedCost`. Cost is currency-agnostic (the operator chooses
 * the unit, e.g. USD or "internal credits"), and the report stamps the
 * caller-supplied label so consumers know what the number means.
 */
export interface FinOpsCostRate {
  /** Cost per 1000 input tokens. */
  inputTokenCostPer1k?: number;
  /** Cost per 1000 output tokens. */
  outputTokenCostPer1k?: number;
  /** Fixed per-attempt cost (e.g. minimum-charge / API-call premium). */
  fixedCostPerAttempt?: number;
}

/** Per-role cost rate map. Roles with no rate produce `estimatedCost = 0`. */
export interface FinOpsCostRateMap {
  /** Operator-supplied label describing the unit (e.g. "USD"). */
  currencyLabel: string;
  rates: {
    test_generation?: FinOpsCostRate;
    visual_primary?: FinOpsCostRate;
    visual_fallback?: FinOpsCostRate;
    jira_api_requests?: FinOpsCostRate;
    jira_paste_ingest?: FinOpsCostRate;
    custom_context_ingest?: FinOpsCostRate;
  };
}

/**
 * Per-role usage record. Aggregated across every gateway attempt the role
 * made during the job. Cache hits do NOT increment any counter except
 * `cacheHits`.
 */
export interface FinOpsRoleUsage {
  role: FinOpsRole;
  /** Deployment label observed (e.g. `gpt-oss-120b-mock`). Empty string when no attempt was made. */
  deployment: string;
  /** Total LLM call attempts (success + failure). Cache hits do NOT increment. */
  attempts: number;
  /** Successful attempts. */
  successes: number;
  /** Failure attempts (any error class). */
  failures: number;
  /** Sum of input tokens reported by the gateway across all successful attempts. */
  inputTokens: number;
  /** Sum of output tokens reported by the gateway across all successful attempts. */
  outputTokens: number;
  /** Sum of decoded image-input bytes per request (visual roles only; 0 elsewhere). */
  imageBytes: number;
  /** Number of replay-cache hits attributed to this role. */
  cacheHits: number;
  /** Number of replay-cache misses attributed to this role. */
  cacheMisses: number;
  /** Number of attempts that selected a fallback deployment. */
  fallbackAttempts: number;
  /** Number of attempts that hit a non-mock gateway (live-smoke counter). */
  liveSmokeCalls: number;
  /** Sum of wall-clock duration across attempts, in milliseconds. */
  durationMs: number;
  /** Last finish reason observed (success path) — `undefined` if no success. */
  lastFinishReason?: LlmFinishReason;
  /** Last error class observed (failure path) — `undefined` if no failure. */
  lastErrorClass?: LlmGatewayErrorClass | "schema_invalid_response";
  /** Estimated cost contribution from this role (currency-agnostic). */
  estimatedCost: number;
  /**
   * Total bytes ingested by non-LLM ingest roles (`jira_paste_ingest`,
   * `custom_context_ingest`). Always `0` for LLM and visual roles.
   */
  ingestBytes: number;
}

/**
 * Single budget breach record. Multiple breaches may be stamped on a
 * single report; the consumer can pick the first by `rule` order.
 */
export interface FinOpsBudgetBreach {
  rule: FinOpsBudgetBreachReason;
  /** Affected role, or `undefined` for job-level rules. */
  role?: FinOpsRole;
  /** Numeric observed value (encoded as number for comparators). */
  observed: number;
  /** Numeric threshold that was breached. */
  threshold: number;
  /** Sanitized human-readable message — never carries tokens or PII. */
  message: string;
}

/**
 * FinOps budget report artifact. Persisted under
 * `<runDir>/finops/budget-report.json`. The artifact is byte-stable per job
 * (sorted role list, deterministic breach order). Cache-hit jobs report no
 * gateway usage; the `outcome` reflects this verbatim.
 *
 * Negative invariants stamped explicitly so absence cannot be inferred:
 *   - `secretsIncluded: false`
 *   - `rawPromptsIncluded: false`
 *   - `rawScreenshotsIncluded: false`
 */
export interface FinOpsBudgetReport {
  schemaVersion: typeof FINOPS_BUDGET_REPORT_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  jobId: string;
  generatedAt: string;
  /** Verbatim copy of the budget envelope applied to this job. */
  budget: FinOpsBudgetEnvelope;
  /** Caller-supplied currency label. `undefined` when no rate map was supplied. */
  currencyLabel?: string;
  /** Sorted by `role`. Always lists every role, even when usage is zero. */
  roles: FinOpsRoleUsage[];
  /** Aggregate counters across every role. */
  totals: {
    inputTokens: number;
    outputTokens: number;
    attempts: number;
    successes: number;
    failures: number;
    cacheHits: number;
    cacheMisses: number;
    fallbackAttempts: number;
    liveSmokeCalls: number;
    durationMs: number;
    imageBytes: number;
    estimatedCost: number;
    /** `cacheHits / (cacheHits + cacheMisses)` clamped to `[0, 1]`. NaN → 0. */
    replayCacheHitRate: number;
    /** `cacheMisses / (cacheHits + cacheMisses)` clamped to `[0, 1]`. NaN → 0. */
    replayCacheMissRate: number;
  };
  /** Sorted by `(rule, role)`. Empty when no budget was breached. */
  breaches: FinOpsBudgetBreach[];
  /** Terminal job outcome the report attests. */
  outcome: FinOpsJobOutcome;
  /** Hard invariant — secrets are never embedded in this artifact. */
  secretsIncluded: false;
  /** Hard invariant — raw prompt or response text is never embedded. */
  rawPromptsIncluded: false;
  /** Hard invariant — image bytes are never embedded. */
  rawScreenshotsIncluded: false;
}

/**
 * Per-job LLM Bill of Materials (CycloneDX 1.6 ML-BOM, Issue #1378).
 *
 * The LBOM is emitted alongside the existing evidence manifest so an
 * operator can inventory the model chain, the curated few-shot bundle,
 * and the active policy profile that produced a given set of test cases.
 * Unlike the package SBOM (CycloneDX 1.5, generated by
 * `scripts/generate-cyclonedx.mjs`), the LBOM is per-job and lives under
 * the run directory.
 *
 * Hard invariants are stamped as CycloneDX metadata properties:
 *   - `workspace-dev:secretsIncluded = false` — no API keys, bearer
 *     tokens, or signer material.
 *   - `workspace-dev:rawPromptsIncluded = false` — no system or user
 *     prompt text. Only hash digests participate.
 *   - `workspace-dev:rawScreenshotsIncluded = false` — no decoded image
 *     bytes. Capture identity is recorded as SHA-256 only.
 *
 * The artifact validates against the CycloneDX 1.6 schema family
 * (CycloneDX 1.6 + JSF + SPDX-encoded license identifiers) in CI. Runtime
 * persistence still uses the zero-runtime-dependency structural validator
 * in `src/test-intelligence/lbom-emitter.ts`.
 */

/** CycloneDX spec version targeted by the per-job LBOM. */
export const LBOM_CYCLONEDX_SPEC_VERSION = "1.6" as const;

/** Schema version for the persisted per-job LBOM artifact. */
export const LBOM_ARTIFACT_SCHEMA_VERSION = "1.0.0" as const;

/** Subdirectory under a run dir where the per-job LBOM is persisted. */
export const LBOM_ARTIFACT_DIRECTORY = "lbom" as const;

/** Canonical filename for the per-job LBOM artifact. */
export const LBOM_ARTIFACT_FILENAME = "ai-bom.cdx.json" as const;

/**
 * Allowed roles for an LBOM machine-learning-model component. Mirrors the
 * gateway role surface so a single artifact can describe the entire model
 * chain that produced a job's test cases.
 */
export const ALLOWED_LBOM_MODEL_ROLES = [
  "test_generation",
  "visual_primary",
  "visual_fallback",
] as const;

/** Discriminant of an LBOM model role. */
export type LbomModelRole = (typeof ALLOWED_LBOM_MODEL_ROLES)[number];

/** Discriminant of an LBOM data-component kind. */
export type LbomDataKind = "few_shot_bundle" | "policy_profile";

/** Hash entry on a CycloneDX 1.6 component. */
export interface LbomHash {
  /** Hash algorithm — workspace-dev only emits `SHA-256`. */
  alg: "SHA-256";
  /** Lowercase hex digest. */
  content: string;
}

/** Property entry on a CycloneDX 1.6 component (or root metadata). */
export interface LbomProperty {
  name: string;
  value: string;
}

/** External reference entry on a CycloneDX 1.6 component. */
export interface LbomExternalReference {
  type:
    | "documentation"
    | "vcs"
    | "evidence"
    | "model-card"
    | "configuration"
    | "license";
  url: string;
}

/** License entry — workspace-dev exclusively emits SPDX identifiers. */
export interface LbomLicenseEntry {
  license: { id: string };
}

/** CycloneDX 1.6 modelCard.modelParameters surface as emitted by workspace-dev. */
export interface LbomModelParameters {
  task: string;
  architectureFamily?: string;
  modelArchitecture?: string;
}

/** CycloneDX 1.6 modelCard.considerations surface as emitted by workspace-dev. */
export interface LbomModelConsiderations {
  users?: string[];
  useCases?: string[];
  technicalLimitations?: string[];
  performanceTradeoffs?: string[];
  ethicalConsiderations?: Array<{
    name: string;
    mitigationStrategy?: string;
  }>;
  fairnessAssessments?: string[];
}

/**
 * CycloneDX 1.6 modelCard.quantitativeAnalysis.performanceMetrics entry.
 * Values are encoded as strings per the CycloneDX 1.6 spec.
 */
export interface LbomPerformanceMetric {
  type: string;
  value: string;
  slice?: string;
  confidenceInterval?: { lowerBound: string; upperBound: string };
}

/** CycloneDX 1.6 modelCard surface as emitted by workspace-dev. */
export interface LbomModelCard {
  modelParameters?: LbomModelParameters;
  quantitativeAnalysis?: { performanceMetrics: LbomPerformanceMetric[] };
  considerations?: LbomModelConsiderations;
  properties?: LbomProperty[];
}

/** CycloneDX 1.6 component entry — model variant. */
export interface LbomModelComponent {
  type: "machine-learning-model";
  "bom-ref": string;
  name: string;
  version: string;
  description: string;
  publisher?: string;
  group?: string;
  hashes?: LbomHash[];
  licenses?: LbomLicenseEntry[];
  externalReferences?: LbomExternalReference[];
  properties: LbomProperty[];
  modelCard: LbomModelCard;
}

/** CycloneDX 1.6 component entry — data variant (bundle / policy). */
export interface LbomDataComponent {
  type: "data";
  "bom-ref": string;
  name: string;
  version: string;
  description: string;
  hashes: LbomHash[];
  properties: LbomProperty[];
}

/** CycloneDX 1.6 dependency edge. */
export interface LbomDependency {
  ref: string;
  dependsOn: string[];
}

/** CycloneDX 1.6 metadata.tools entry. */
export interface LbomToolComponent {
  type: "application";
  name: string;
  version: string;
  publisher: string;
  description: string;
}

/** CycloneDX 1.6 metadata.component entry — the BOM subject. */
export interface LbomSubjectComponent {
  type: "application";
  "bom-ref": string;
  name: string;
  version: string;
  description: string;
  properties: LbomProperty[];
}

/** CycloneDX 1.6 metadata block as emitted by workspace-dev. */
export interface LbomMetadata {
  timestamp: string;
  tools: { components: LbomToolComponent[] };
  component: LbomSubjectComponent;
  properties: LbomProperty[];
}

/**
 * Per-job LLM Bill of Materials document (CycloneDX 1.6 ML-BOM, Issue #1378).
 *
 * The shape mirrors the CycloneDX 1.6 JSON spec for fields workspace-dev
 * actually populates. Optional CycloneDX fields workspace-dev does not use
 * are intentionally omitted from the type to keep emission and validation
 * aligned with what callers can audit.
 */
export interface Wave1PocLbomDocument {
  bomFormat: "CycloneDX";
  specVersion: typeof LBOM_CYCLONEDX_SPEC_VERSION;
  /** CycloneDX-required document version. workspace-dev always emits `1`. */
  version: 1;
  /** RFC-4122 UUID URN, deterministic from job identity. */
  serialNumber: string;
  metadata: LbomMetadata;
  components: Array<LbomModelComponent | LbomDataComponent>;
  dependencies: LbomDependency[];
}

/** Validation issue surfaced by `validateLbomDocument`. */
export interface LbomValidationIssue {
  /** Dotted JSON path of the offending field. */
  path: string;
  /** Stable diagnostic code consumers can switch on. */
  code:
    | "missing_required_field"
    | "invalid_value"
    | "invalid_hash"
    | "invalid_type"
    | "invalid_serial_number"
    | "invalid_timestamp"
    | "duplicate_bom_ref"
    | "unknown_dependency_ref"
    | "raw_prompt_leak"
    | "raw_screenshot_leak"
    | "secret_leak";
  message: string;
}

/** Result of `validateLbomDocument`. */
export interface LbomValidationResult {
  valid: boolean;
  issues: LbomValidationIssue[];
}

/**
 * Audit-timeline summary of the per-job LBOM emit. Carries the on-disk
 * filename, byte length, the canonical SHA-256 (matches the manifest
 * attestation), and a count of components by kind so a verifier can spot
 * "only one model row" regression without re-parsing the artifact.
 */
export interface Wave1PocLbomSummary {
  schemaVersion: typeof LBOM_ARTIFACT_SCHEMA_VERSION;
  /** Relative filename inside the run directory (`lbom/ai-bom.cdx.json`). */
  filename: string;
  /** Byte length of the persisted canonical JSON. */
  bytes: number;
  /** SHA-256 of the persisted canonical JSON (hex, lowercase). */
  sha256: string;
  /** Component-kind counts. */
  componentCounts: {
    models: number;
    data: number;
  };
  /** Whether the visual sidecar fallback path was taken in the run. */
  visualFallbackUsed: boolean;
}

/**
 * Schema version for the `EvidenceVerifyResponse` envelope returned by
 * `GET /workspace/jobs/:jobId/evidence/verify` (Issue #1380). Bump when a
 * backwards-incompatible field shape change ships.
 */
export const EVIDENCE_VERIFY_RESPONSE_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Stable failure-code surface for evidence verification. Re-uses the
 * existing `Wave1PocAttestationVerificationFailureCode` literals where
 * applicable so a single auditor can route on a unified vocabulary.
 */
export type EvidenceVerifyFailureCode =
  | "manifest_unparseable"
  | "manifest_metadata_invalid"
  | "manifest_digest_witness_invalid"
  | "artifact_missing"
  | "artifact_mutated"
  | "artifact_resized"
  | "unexpected_artifact"
  | "visual_sidecar_evidence_missing"
  | "envelope_unparseable"
  | "envelope_payload_type_mismatch"
  | "envelope_payload_decode_failed"
  | "statement_unparseable"
  | "statement_type_mismatch"
  | "statement_predicate_type_mismatch"
  | "statement_predicate_invalid"
  | "subject_missing_artifact"
  | "subject_digest_mismatch"
  | "subject_unattested_artifact"
  | "signing_mode_mismatch"
  | "signature_required"
  | "signature_unsigned_envelope_carries_signatures"
  | "signature_invalid_keyid"
  | "signature_invalid_encoding"
  | "signature_unverified"
  | "bundle_missing"
  | "bundle_envelope_mismatch"
  | "bundle_public_key_missing"
  | "manifest_sha256_mismatch";

/** Stable check-kind labels surfaced in the `EvidenceVerifyResponse.checks` array. */
export type EvidenceVerifyCheckKind =
  | "artifact_sha256"
  | "manifest_metadata"
  | "manifest_digest_witness"
  | "visual_sidecar_evidence"
  | "attestation_envelope"
  | "attestation_signatures";

/**
 * One row in the `checks` array. Carries enough context for an auditor
 * to identify which artifact / check passed or failed and (when failed)
 * why. Sorted deterministically so the response body is byte-stable
 * across consecutive verifications of the same on-disk run.
 */
export interface EvidenceVerifyCheck {
  kind: EvidenceVerifyCheckKind;
  /** Safe manifest-relative artifact filename or stable check identifier. */
  reference: string;
  ok: boolean;
  /** Failure code when `ok === false`. Omitted when `ok === true`. */
  failureCode?: EvidenceVerifyFailureCode;
  /** Optional structured detail attached to attestation checks. */
  signingMode?: Wave1PocAttestationSigningMode;
}

/** One row in the `failures` array. Flat, sorted by reference + code. */
export interface EvidenceVerifyFailure {
  code: EvidenceVerifyFailureCode;
  /** Safe manifest-relative artifact filename or stable check identifier. */
  reference: string;
  /** Operator-readable diagnostic. Never includes absolute paths or secrets. */
  message: string;
}

/**
 * Response body returned by `GET /workspace/jobs/:jobId/evidence/verify`
 * with HTTP status 200. Status 200 means "verification completed",
 * regardless of pass/fail outcome — `ok` carries the verdict. The body
 * never contains absolute paths, bearer tokens, prompt bodies, raw
 * test-case payloads, env values, or signer secret material; only safe
 * manifest-relative filenames, SHA-256 digests, and identity stamps appear.
 */
export interface EvidenceVerifyResponse {
  schemaVersion: typeof EVIDENCE_VERIFY_RESPONSE_SCHEMA_VERSION;
  /** ISO-8601 timestamp the verification completed at. */
  verifiedAt: string;
  jobId: string;
  /** Overall verdict: true iff `failures.length === 0`. */
  ok: boolean;
  /** SHA-256 of the canonical manifest bytes (computed in memory). */
  manifestSha256: string;
  /** Mirrors `manifest.schemaVersion` when readable. */
  manifestSchemaVersion?: string;
  /** Mirrors `manifest.testIntelligenceContractVersion` when readable. */
  testIntelligenceContractVersion?: string;
  /** Model deployment names per role from the manifest. */
  modelDeployments?: {
    testGeneration: string;
    visualPrimary?: string;
    visualFallback?: string;
  };
  /** Visual sidecar metadata when the manifest carries it. */
  visualSidecar?: {
    selectedDeployment?: string;
    fallbackUsed: boolean;
    resultArtifactSha256?: string;
  };
  /** Attestation summary when an attestation envelope is on disk. */
  attestation?: {
    present: boolean;
    signingMode: Wave1PocAttestationSigningMode;
    signatureCount: number;
    signaturesVerified: boolean;
  };
  /** Per-artifact + per-check verification results. */
  checks: EvidenceVerifyCheck[];
  /** Flat list of every failed check, sorted by `reference`+`code`. */
  failures: EvidenceVerifyFailure[];
}

/* ============================================================
 * Delta + deduplication + traceability matrix (Issue #1373).
 *
 * Wave 3 introduces three additive, fail-closed surfaces:
 *
 *   1. Intent delta — pure compare of two `BusinessTestIntentIr`
 *      artifacts producing an `IntentDeltaReport` covering screens,
 *      fields, actions, validations, navigation, and the visual
 *      addendum (visual fixture hash, `VisualScreenDescription`
 *      hash, confidence/ambiguity drift).
 *   2. Dedupe report — the existing lexical fingerprint path
 *      (`detectDuplicateTestCases`) extended with a pluggable
 *      `EmbeddingProvider` (caller-supplied; default `null` =
 *      lexical-only / air-gapped) and an OPTIONAL injected
 *      cross-job/QC-folder probe. Both extensions are off by
 *      default so the air-gapped flow is preserved.
 *   3. Traceability matrix — joins Figma node → IR element →
 *      generated test case → QC mapping preview → transferred QC
 *      id (when transfer-report present) → visual sidecar →
 *      reconciliation/policy/validation outcomes.
 *
 * Every persisted artifact stamps the type-level hard invariants
 * `rawScreenshotsIncluded: false` and `secretsIncluded: false`
 * so a downstream consumer can verify they were produced under
 * the air-gapped/zero-secret-leak contract.
 * ============================================================ */

/** Schema version for the persisted intent-delta artifact (Issue #1373). */
export const INTENT_DELTA_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Schema version for the persisted test-case delta report artifact (Issue #1373). */
export const TEST_CASE_DELTA_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical filename for the persisted intent-delta artifact. */
export const INTENT_DELTA_REPORT_ARTIFACT_FILENAME =
  "intent-delta-report.json" as const;

/** Canonical filename for the persisted test-case delta artifact. */
export const TEST_CASE_DELTA_REPORT_ARTIFACT_FILENAME =
  "test-case-delta-report.json" as const;

/** Schema version for the persisted dedupe artifact (Issue #1373). */
export const DEDUPE_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical filename for the persisted dedupe artifact. */
export const DEDUPE_REPORT_ARTIFACT_FILENAME = "dedupe-report.json" as const;

/** Schema version for the persisted traceability-matrix artifact (Issue #1373). */
export const TRACEABILITY_MATRIX_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical filename for the persisted traceability-matrix artifact. */
export const TRACEABILITY_MATRIX_ARTIFACT_FILENAME =
  "traceability-matrix.json" as const;

/**
 * Allowed kinds of delta entries inside the intent-delta report.
 * Sorted, additive — additional kinds may be appended in future
 * minors.
 */
export const ALLOWED_INTENT_DELTA_KINDS = [
  "screen",
  "field",
  "action",
  "validation",
  "navigation",
  "visual_screen",
] as const;
export type IntentDeltaKind = (typeof ALLOWED_INTENT_DELTA_KINDS)[number];

/**
 * Allowed change types on a single delta entry.
 *
 * - `added` — present in current, absent in prior.
 * - `removed` — present in prior, absent in current.
 * - `changed` — present in both, but the canonical-hash differs.
 * - `confidence_dropped` — visual confidence (mean) fell more than
 *   the configured drift threshold.
 * - `ambiguity_increased` — visual ambiguity / open-question count
 *   grew between revisions.
 */
export const ALLOWED_INTENT_DELTA_CHANGE_TYPES = [
  "added",
  "removed",
  "changed",
  "confidence_dropped",
  "ambiguity_increased",
] as const;
export type IntentDeltaChangeType =
  (typeof ALLOWED_INTENT_DELTA_CHANGE_TYPES)[number];

/** Single delta entry inside `IntentDeltaReport.entries`. */
export interface IntentDeltaEntry {
  kind: IntentDeltaKind;
  changeType: IntentDeltaChangeType;
  /** Stable identifier inside the IR (e.g. `screenId`, `field.id`). */
  elementId: string;
  /** Owning screen id, when the entry is screen-scoped. */
  screenId?: string;
  /** SHA-256 hex of the prior canonical projection, when present. */
  priorHash?: string;
  /** SHA-256 hex of the current canonical projection, when present. */
  currentHash?: string;
  /** Optional sanitized human-readable detail (no PII, no tokens). */
  detail?: string;
}

/** Hard-invariant intent-delta report artifact (Issue #1373). */
export interface IntentDeltaReport {
  schemaVersion: typeof INTENT_DELTA_REPORT_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  jobId: string;
  generatedAt: string;
  /** SHA-256 of the canonical prior IR (anchors the comparison). */
  priorIntentHash: string;
  /** SHA-256 of the canonical current IR (anchors the comparison). */
  currentIntentHash: string;
  /** Sorted-by-(kind,elementId,changeType) deterministic entries. */
  entries: IntentDeltaEntry[];
  /** Aggregate counts, computed deterministically from `entries`. */
  totals: {
    added: number;
    removed: number;
    changed: number;
    confidenceDropped: number;
    ambiguityIncreased: number;
  };
  /** Hard invariant: image bytes are NEVER embedded into this artifact. */
  rawScreenshotsIncluded: false;
  /** Hard invariant: tokens / credentials are NEVER embedded. */
  secretsIncluded: false;
}

/**
 * Per-test-case verdict produced by the test-case delta classifier.
 *
 * - `new` — case id present in current generation, absent from
 *   prior generation.
 * - `unchanged` — case id present in both with identical
 *   fingerprint AND no upstream IR delta touching its trace screens.
 * - `changed` — case id present in both, fingerprint differs OR
 *   an IR delta touches one of the case's `figmaTraceRefs`.
 * - `obsolete` — case id present in prior generation but EVERY
 *   trace screen is absent from the current IR. Reported only —
 *   never destructively removed from QC (per Issue #1373 AC3).
 * - `requires_review` — visual confidence dropped below threshold
 *   OR a reconciliation conflict surfaced.
 */
export const ALLOWED_TEST_CASE_DELTA_VERDICTS = [
  "new",
  "unchanged",
  "changed",
  "obsolete",
  "requires_review",
] as const;
export type TestCaseDeltaVerdict =
  (typeof ALLOWED_TEST_CASE_DELTA_VERDICTS)[number];

/**
 * Allowed reasons attached to a test-case delta verdict. Sorted,
 * additive. Multiple reasons may apply to the same verdict.
 */
export const ALLOWED_TEST_CASE_DELTA_REASONS = [
  "absent_in_current",
  "absent_in_prior",
  "fingerprint_changed",
  "trace_screen_changed",
  "trace_screen_removed",
  "visual_ambiguity_increased",
  "visual_confidence_dropped",
  "reconciliation_conflict",
] as const;
export type TestCaseDeltaReason =
  (typeof ALLOWED_TEST_CASE_DELTA_REASONS)[number];

/** Single per-case classification row. */
export interface TestCaseDeltaRow {
  testCaseId: string;
  verdict: TestCaseDeltaVerdict;
  /** Sorted, deduplicated reasons that fired. */
  reasons: TestCaseDeltaReason[];
  /** Sorted figma screen ids implicated by this row. */
  affectedScreenIds: string[];
  /** SHA-256 hex of the prior fingerprint when present. */
  priorFingerprintHash?: string;
  /** SHA-256 hex of the current fingerprint when present. */
  currentFingerprintHash?: string;
}

/** Aggregate test-case delta report (always paired with `IntentDeltaReport`). */
export interface TestCaseDeltaReport {
  schemaVersion: typeof TEST_CASE_DELTA_REPORT_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  jobId: string;
  generatedAt: string;
  rows: TestCaseDeltaRow[];
  totals: {
    new: number;
    unchanged: number;
    changed: number;
    obsolete: number;
    requiresReview: number;
  };
  rawScreenshotsIncluded: false;
  secretsIncluded: false;
}

/**
 * Allowed similarity sources for a duplicate finding inside the
 * dedupe report.
 *
 * - `lexical` — Jaccard over the existing lexical fingerprint
 *   (`buildTestCaseFingerprint`). Always available.
 * - `embedding` — cosine similarity over a caller-supplied
 *   embedding vector. Only fires when an `EmbeddingProvider` is
 *   injected.
 * - `external_lookup` — duplicate of an existing entity in an
 *   external QC folder, surfaced via an injected probe. Only
 *   fires when the optional probe is configured.
 */
export const ALLOWED_DEDUPE_SIMILARITY_SOURCES = [
  "lexical",
  "embedding",
  "external_lookup",
] as const;
export type DedupeSimilaritySource =
  (typeof ALLOWED_DEDUPE_SIMILARITY_SOURCES)[number];

/** Single internal duplicate finding (within the current job). */
export interface DedupeInternalFinding {
  source: Exclude<DedupeSimilaritySource, "external_lookup">;
  leftTestCaseId: string;
  rightTestCaseId: string;
  /** Similarity in [0, 1], rounded to 6 digits. */
  similarity: number;
}

/** Single external duplicate finding (against an external QC folder). */
export interface DedupeExternalFinding {
  source: "external_lookup";
  testCaseId: string;
  externalIdCandidate: string;
  /** Resolved folder path of the existing entity in the target system. */
  matchedFolderPath?: string;
  /**
   * Stable opaque identifier of the matched entity in the target
   * system. Treated as opaque — never logged or persisted alongside
   * any URL or token.
   */
  matchedEntityId?: string;
}

/**
 * Allowed informational outcomes of an external dedup probe.
 *
 * - `disabled` — caller did not configure an `externalProbe`.
 * - `unconfigured` — probe was supplied but reported its own
 *   `unconfigured` verdict (e.g. air-gapped client). Fail-closed.
 * - `partial_failure` — at least one external lookup succeeded, but
 *   one or more cases could not be checked. Fail-closed.
 * - `executed` — probe ran and returned per-case verdicts.
 */
export const ALLOWED_DEDUPE_EXTERNAL_PROBE_STATES = [
  "disabled",
  "unconfigured",
  "partial_failure",
  "executed",
] as const;
export type DedupeExternalProbeState =
  (typeof ALLOWED_DEDUPE_EXTERNAL_PROBE_STATES)[number];

/** Per-case verdict computed from the dedupe pipeline. */
export interface DedupeCaseVerdict {
  testCaseId: string;
  /**
   * `true` when the case has at least one internal duplicate
   * finding above the configured threshold OR an external
   * lookup match.
   */
  isDuplicate: boolean;
  /** Sorted-and-deduplicated list of similarity sources that fired. */
  matchedSources: DedupeSimilaritySource[];
  /** Highest similarity observed for this case across internal sources. */
  maxInternalSimilarity: number;
}

/** Aggregate dedupe report artifact (Issue #1373). */
export interface TestCaseDedupeReport {
  schemaVersion: typeof DEDUPE_REPORT_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  jobId: string;
  generatedAt: string;
  /** Threshold above which lexical similarity is reported (0..1). */
  lexicalThreshold: number;
  /** Threshold above which embedding similarity is reported (0..1). */
  embeddingThreshold?: number;
  /** Whether the embedding path participated in the run. */
  embeddingProvider: { configured: boolean; identifier?: string };
  externalProbe: {
    state: DedupeExternalProbeState;
    /** Number of test cases probed; zero on `disabled`/`unconfigured`. */
    cases: number;
    /** Sanitized informational note when the probe declined to run. */
    note?: string;
  };
  internalFindings: DedupeInternalFinding[];
  externalFindings: DedupeExternalFinding[];
  perCase: DedupeCaseVerdict[];
  totals: {
    duplicates: number;
    internalLexical: number;
    internalEmbedding: number;
    externalMatches: number;
  };
  rawScreenshotsIncluded: false;
  secretsIncluded: false;
}

/**
 * Single row inside the traceability matrix. Joins the lifecycle
 * of one generated test case across its Figma source, IR
 * elements, QC mapping, transfer outcome, visual sidecar
 * observations, and validation/policy outcomes.
 */
export interface TraceabilityMatrixRow {
  testCaseId: string;
  /** Title at the moment the matrix was built. */
  title: string;
  /** Sorted Figma screen ids that motivated the case. */
  figmaScreenIds: string[];
  /**
   * Sorted Figma node ids that motivated the case. Empty when no
   * trace ref carries a node id.
   */
  figmaNodeIds: string[];
  /** Sorted IR field ids covered by this case. */
  intentFieldIds: string[];
  /** Sorted IR action ids covered by this case. */
  intentActionIds: string[];
  /** Sorted IR validation ids covered by this case. */
  intentValidationIds: string[];
  /** Sorted IR navigation ids covered by this case. */
  intentNavigationIds: string[];
  /** Deterministic external-id candidate for the QC mapping. */
  externalIdCandidate?: string;
  /** Resolved target QC folder path under the export profile. */
  qcFolderPath?: string;
  /** Resolved QC entity id when the case was transferred. */
  qcEntityId?: string;
  /** Outcome of the transfer pipeline for this case, when known. */
  transferOutcome?: TransferEntityOutcome;
  /** Per-screen visual sidecar observations relevant to this case. */
  visualObservations: TraceabilityVisualObservation[];
  /** Per-step traceability rows derived from generated and QC design steps. */
  steps: TraceabilityStepRow[];
  /** Reconciliation decisions: one row per IR element with explicit provenance. */
  reconciliationDecisions: TraceabilityReconciliationDecision[];
  /** Per-case validation outcome — `error` if any error issue was raised. */
  validationOutcome: "ok" | "warning" | "error";
  /** Per-case policy decision (mirrors `TestCasePolicyDecisionRecord.decision`). */
  policyDecision?: TestCasePolicyDecision;
  /** Per-case sorted, deduplicated policy outcome codes that fired. */
  policyOutcomes: TestCasePolicyOutcome[];
  /** Review-state snapshot at the moment the matrix was built. */
  reviewState?: ReviewState;
}

/** Single ordered step row inside a traceability matrix row. */
export interface TraceabilityStepRow {
  stepIndex: number;
  action: string;
  expected?: string;
  /** Sorted Figma screen ids inherited from the test-case trace refs. */
  figmaScreenIds: string[];
  /** Sorted Figma node ids inherited from the test-case trace refs. */
  figmaNodeIds: string[];
  /** Matching QC design-step index when the mapping preview carries one. */
  qcDesignStepIndex?: number;
  /** Per-screen visual sidecar observations available for the step's case. */
  visualObservations: TraceabilityVisualObservation[];
  /** Per-case validation outcome at the time this step row was built. */
  validationOutcome: "ok" | "warning" | "error";
  /** Per-case policy decision at the time this step row was built. */
  policyDecision?: TestCasePolicyDecision;
  /** Per-case sorted, deduplicated policy outcomes at the time this step row was built. */
  policyOutcomes: TestCasePolicyOutcome[];
}

/** Single per-screen visual observation row inside the matrix. */
export interface TraceabilityVisualObservation {
  screenId: string;
  deployment: "llama-4-maverick-vision" | "phi-4-multimodal-poc" | "mock";
  /** Sorted, deduplicated outcome codes that fired on the screen. */
  outcomes: VisualSidecarValidationOutcome[];
  meanConfidence: number;
}

/** Single reconciliation decision row inside the matrix. */
export interface TraceabilityReconciliationDecision {
  screenId: string;
  elementId: string;
  /** IR provenance after reconciliation. */
  provenance: IntentProvenance;
  confidence: number;
  /** Sanitized ambiguity reason, when present. */
  ambiguity?: string;
}

/** Aggregate traceability-matrix artifact (Issue #1373). */
export interface TraceabilityMatrix {
  schemaVersion: typeof TRACEABILITY_MATRIX_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  jobId: string;
  generatedAt: string;
  /** Identity of the export profile in play, when one is supplied. */
  exportProfile?: { id: string; version: string };
  /** Identity of the policy profile in play, when one is supplied. */
  policyProfile?: { id: string; version: string };
  rows: TraceabilityMatrixRow[];
  totals: {
    rows: number;
    transferred: number;
    failed: number;
    skippedDuplicate: number;
    refused: number;
  };
  rawScreenshotsIncluded: false;
  secretsIncluded: false;
}

/**
 * Jira capability probe result.
 */
export interface JiraCapabilityProbe {
  version: string;
  deploymentType: "Cloud" | "Server" | "DataCenter" | "unknown";
  adfSupported: boolean;
}

/**
 * Client configuration for the Jira REST gateway (Wave 4.C).
 */
export interface JiraGatewayConfig {
  baseUrl: string;
  auth:
    | { kind: "bearer"; token: string }
    | { kind: "basic"; email: string; apiToken: string }
    | { kind: "oauth2_3lo"; accessToken: string };
  userAgent: string;
  maxWallClockMs?: number;
  maxRetries?: number;
  maxResponseBytes?: number;
  /**
   * Exact hostnames or `*.example.com` suffix patterns allowed for Bearer
   * token/Data Center calls. Cloud Basic and OAuth gateway hosts are validated
   * by auth-mode-specific rules; Data Center endpoints must be allow-listed.
   */
  allowedHostPatterns?: readonly string[];
}

/**
 * Outbound fetch request shape for the Jira gateway.
 */
export interface JiraFetchRequest {
  query:
    | { kind: "jql"; jql: string; maxResults: number }
    | { kind: "issueKeys"; issueKeys: string[] };
  expand?: ReadonlyArray<"renderedFields" | "names" | "schema">;
  linkExpansionDepth?: 0 | 1 | 2;
  fieldSelection?: Partial<JiraFieldSelectionProfile>;
  maxWallClockMs?: number;
  maxRetries?: number;
  /** Enables deterministic on-disk gateway artifacts under `<runDir>/sources/<sourceId>/`. */
  runDir?: string;
  /** Source namespace used for replay/cache artifacts when `runDir` is set. */
  sourceId?: string;
  /** When true, load the persisted redacted Jira IR list and issue zero outbound fetches. */
  replayMode?: boolean;
  /** Deterministic capture timestamp for generated IR; defaults to Unix epoch. */
  capturedAt?: string;
}

/** Structured diagnostic emitted by the Jira gateway failure path. */
export interface JiraGatewayDiagnostic {
  code: string;
  message: string;
  retryable: boolean;
  status?: number;
  rateLimitReason?: string;
}

/**
 * Result returned by the Jira gateway.
 */
export interface JiraFetchResult {
  issues: JiraIssueIr[];
  capability: JiraCapabilityProbe;
  responseHash: string;
  retryable: boolean;
  attempts: number;
  diagnostic?: JiraGatewayDiagnostic;
  cacheHit?: boolean;
}

// ── Wave 4.I Production-Readiness Constants ──────────────────────────────────

/**
 * Maximum Jira REST API calls allowed per production-readiness job.
 * Enforced before any outbound fetch; breach emits `jira_api_quota_exceeded`.
 */
export const MAX_JIRA_API_REQUESTS_PER_JOB = 20 as const;

/**
 * Maximum raw paste bytes allowed per production-readiness job.
 * Enforced before Jira paste ingest begins; breach emits `jira_paste_quota_exceeded`.
 */
export const MAX_JIRA_PASTE_BYTES_PER_JOB = 524288 as const;

/**
 * Maximum custom-context input bytes allowed per production-readiness job.
 * Enforced before custom-context ingest begins; breach emits
 * `custom_context_quota_exceeded`.
 */
export const MAX_CUSTOM_CONTEXT_BYTES_PER_JOB = 262144 as const;

/** Schema version for `Wave4ProductionReadinessEvalReport`. */
export const WAVE4_PRODUCTION_READINESS_EVAL_REPORT_SCHEMA_VERSION =
  "1.0.0" as const;

/** On-disk filename for `Wave4ProductionReadinessEvalReport`. */
export const WAVE4_PRODUCTION_READINESS_EVAL_REPORT_ARTIFACT_FILENAME =
  "wave4-production-readiness-eval-report.json" as const;

/** Source-mix identifier. Each distinct combination of source kinds is one mix. */
export type Wave4SourceMixId =
  | "figma_only"
  | "jira_rest_only"
  | "jira_paste_only"
  | "figma_plus_jira_rest"
  | "figma_plus_jira_paste"
  | "jira_rest_plus_custom"
  | "figma_plus_jira_plus_custom"
  | "all_sources_with_conflict"
  | "custom_markdown_only"
  | "figma_plus_jira_plus_custom_markdown"
  | "custom_markdown_adversarial";

/** Pass/fail thresholds for the Wave 4 production-readiness eval gate. */
export interface Wave4ProductionReadinessEvalThresholds {
  /** Required provenance-field coverage across all sources (0–1). Default 1.0. */
  minSourceProvenance: number;
  /** Required source-attribution coverage on every test case (0–1). Default 1.0. */
  minTestCaseSourceAttribution: number;
  /** Minimum conflict-detection recall on the payment-with-conflict fixture (0–1). Default 0.95. */
  minConflictDetectionRecall: number;
  /** Maximum allowed outbound fetch calls in the air-gap fixture. Default 0. */
  maxAirgapFetchCalls: number;
}

/** Per-source-mix coverage entry emitted by the eval gate. */
export interface Wave4SourceMixCoverageEntry {
  mixId: Wave4SourceMixId;
  fixtureId: string;
  pass: boolean;
  /** Provenance coverage ratio (0–1). */
  sourceProvenanceCoverage: number;
  /** Source-attribution coverage ratio across test cases (0–1). */
  testCaseAttributionCoverage: number;
  conflictDetectionRecall?: number;
  airgapFetchCalls?: number;
  failureReasons: string[];
}

/**
 * Per-source provenance record in the evidence manifest.
 * One entry per source-IR artifact emitted under `<runDir>/sources/<sourceId>/`.
 */
export interface MultiSourceSourceProvenanceRecord {
  sourceId: string;
  kind: TestIntentSourceKind;
  contentHash: string;
  bytes: number;
  /** Author handle (reviewer-supplied for paste/custom sources). */
  authorHandle?: string;
  /** ISO-8601 capture timestamp. */
  capturedAt?: string;
}

/**
 * Evaluation report produced by the Wave 4 production-readiness gate.
 * Written to `<runDir>/wave4-production-readiness-eval-report.json`.
 */
export interface Wave4ProductionReadinessEvalReport {
  version: typeof WAVE4_PRODUCTION_READINESS_EVAL_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  thresholds: Wave4ProductionReadinessEvalThresholds;
  passed: boolean;
  overallSourceProvenanceCoverage: number;
  overallTestCaseAttributionCoverage: number;
  sourceMixCoverage: Wave4SourceMixCoverageEntry[];
  markdownCustomContextCoverage: {
    totalMarkdownSources: number;
    sourcesWithProvenance: number;
    coverageRatio: number;
  };
  failureReasons: string[];
  rawScreenshotsIncluded: false;
  secretsIncluded: false;
  rawJiraResponsePersisted: false;
  rawPasteBytesPersisted: false;
}

// ---------------------------------------------------------------------------
// Source-mix planner contracts (Issue #1441, Wave 4.K)
// ---------------------------------------------------------------------------

/** Schema version for persisted `source-mix-plan.json` artifacts. */
export const SOURCE_MIX_PLAN_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical filename for the deterministic source-mix plan artifact. */
export const SOURCE_MIX_PLAN_ARTIFACT_FILENAME =
  "source-mix-plan.json" as const;

/**
 * All supported source-mix identifiers. Each value represents a distinct
 * combination of primary and supporting source kinds that the planner accepts.
 * The planner rejects any combination not listed here with
 * `unsupported_source_mix`.
 */
export const ALLOWED_TEST_INTENT_SOURCE_MIX_KINDS = [
  "figma_only",
  "jira_rest_only",
  "jira_paste_only",
  "figma_jira_rest",
  "figma_jira_paste",
  "figma_jira_mixed",
  "jira_mixed",
] as const;

/** Discriminated union of all supported source-mix kinds (Issue #1441). */
export type TestIntentSourceMixKind =
  (typeof ALLOWED_TEST_INTENT_SOURCE_MIX_KINDS)[number];

/**
 * Prompt section tag identifying the role of a compiled source segment in the
 * LLM user prompt. The planner populates {@link SourceMixPlan.promptSections}
 * with the ordered list of sections that the prompt compiler must emit.
 *
 * - `figma_intent` — redacted Figma Business Test Intent IR.
 * - `jira_requirements` — one or more normalized Jira Issue IRs.
 * - `custom_context` — structured-attribute and/or plain-text custom context.
 * - `custom_context_markdown` — Markdown custom context (dedicated kind).
 * - `reconciliation_report` — cross-source conflict and field-provenance summary.
 */
export type SourceMixPlanPromptSection =
  | "figma_intent"
  | "jira_requirements"
  | "custom_context"
  | "custom_context_markdown"
  | "reconciliation_report";

/**
 * Redacted source fingerprint material sealed into a source-mix plan.
 *
 * The planner records hashes only, never raw Jira responses, paste bytes, or
 * Markdown editor input. For Markdown context, the redacted Markdown and
 * plain-text derivative hashes are included so `sourceMixPlanHash` changes
 * when sanitized supporting evidence changes.
 */
export interface SourceMixPlanSourceDigest {
  /** Source ID from the multi-source envelope. */
  sourceId: string;
  /** Source kind from the multi-source envelope. */
  kind: TestIntentSourceKind;
  /** Canonical source content hash from the multi-source envelope. */
  contentHash: string;
  /** Canonical Jira issue key, when the source is Jira-backed. */
  canonicalIssueKey?: string;
  /** Redacted Markdown hash for Markdown supporting context. */
  redactedMarkdownHash?: string;
  /** Plain-text derivative hash for Markdown supporting context. */
  plainTextDerivativeHash?: string;
}

/**
 * Deterministic plan produced by the source-mix planner (Issue #1441).
 *
 * The plan captures which source combinations were selected for a job, what
 * visual-sidecar requirement applies, and in what order the prompt compiler
 * must emit role-tagged source sections. It also carries hash-only source
 * fingerprints so the `sourceMixPlanHash` changes when source content changes,
 * including redacted Markdown supporting context. The `sourceMixPlanHash`
 * participates in the replay-cache key so a different source mix always forces
 * a cache miss.
 *
 * Negative invariants (TYPE-LEVEL `false`):
 * - `figmaSourceRequired` is `false` on Jira-only and custom-enriched-Jira plans.
 * - `visualSidecarRequired` is `false` whenever `visualSidecarRequirement` is
 *   `"not_applicable"`.
 * - `rawJiraResponsePersisted` is always `false` — only normalized IRs are stored.
 * - `rawPasteBytesPersisted` is always `false` — only normalized hashes are stored.
 */
export interface SourceMixPlan {
  /** Schema version stamp. */
  version: typeof SOURCE_MIX_PLAN_SCHEMA_VERSION;
  /** Discriminated mix kind derived from the source envelope. */
  kind: TestIntentSourceMixKind;
  /** Ordered source IDs classified as primary sources. */
  primarySourceIds: string[];
  /** Ordered source IDs classified as supporting sources. */
  supportingSourceIds: string[];
  /**
   * Whether the job requires a visual sidecar pass.
   * - `required` — at least one Figma source is present and visual captures are expected.
   * - `optional` — Figma is present but no capture set was supplied.
   * - `not_applicable` — Jira-only or custom-only; must be `false` at runtime.
   */
  visualSidecarRequirement: "required" | "optional" | "not_applicable";
  /**
   * Ordered list of prompt sections the compiler must emit for this plan.
   * The compiler must emit each listed section and MUST NOT emit unlisted sections.
   */
  promptSections: SourceMixPlanPromptSection[];
  /** Hash-only source fingerprints included in `sourceMixPlanHash` when emitted by the planner. */
  sourceDigests?: SourceMixPlanSourceDigest[];
  /**
   * SHA-256 of the canonical plan payload (computed before this field is set,
   * so the hash covers `kind`, `primarySourceIds`, `supportingSourceIds`,
   * `visualSidecarRequirement`, `promptSections`, and `sourceDigests`).
   */
  sourceMixPlanHash: string;
  /** Hard invariant: only normalized IRs are stored, never raw Jira API responses. */
  rawJiraResponsePersisted: false;
  /** Hard invariant: only redacted hashes are stored, never raw paste bytes. */
  rawPasteBytesPersisted: false;
}

/**
 * Refusal codes emitted by the source-mix planner when it rejects an envelope.
 * All refusals are fail-closed; no partial artifact is written.
 */
export const ALLOWED_SOURCE_MIX_PLANNER_REFUSAL_CODES = [
  "primary_source_required",
  "unsupported_source_mix",
  "duplicate_source_id",
  "duplicate_jira_issue_key",
  "custom_markdown_hash_required",
  "custom_markdown_input_format_invalid",
  "source_mix_plan_hash_mismatch",
  "mode_gate_not_satisfied",
] as const;

/** Refusal code alias for the source-mix planner. */
export type SourceMixPlannerRefusalCode =
  (typeof ALLOWED_SOURCE_MIX_PLANNER_REFUSAL_CODES)[number];

/** A single validation issue surfaced by the source-mix planner. */
export interface SourceMixPlannerIssue {
  code: SourceMixPlannerRefusalCode;
  path?: string;
  detail?: string;
}

/** Result of source-mix planning (Issue #1441). */
export type SourceMixPlannerResult =
  | { ok: true; plan: SourceMixPlan }
  | { ok: false; issues: SourceMixPlannerIssue[] };

/**
 * Current contract version constant.
 * Must be bumped according to CONTRACT_CHANGELOG.md rules.
 * Package version alignment is documented in VERSIONING.md.
 */
export const CONTRACT_VERSION = "4.21.0" as const;
