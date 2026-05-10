/**
 * Wave 1 Validation harness (Issue #1366).
 *
 * Runs the full Figma-to-Test chain end-to-end against an air-gapped
 * mock LLM, persists every artifact in a deterministic `runDir`, builds
 * an evidence manifest, and returns the in-memory bundle so callers can
 * gate further work on the run result.
 *
 * The 10 chain steps exercised here mirror the issue spec one-for-one:
 *
 *   1. Load a local Figma fixture + companion visual sidecar.
 *   2. Derive Business Test Intent IR (deterministic, redacted).
 *   3. PII redaction is performed inside derivation; the harness asserts
 *      no original PII substrings survive into persisted artifacts.
 *   4. Compile a redacted prompt request.
 *   5. Issue the request through a deterministic mock LLM bundle —
 *      `gpt-oss-120b-mock` for test_generation,
 *      `llama-4-maverick-vision` (mocked) for visual_sidecar_primary.
 *      The structured output is byte-stable per fixture.
 *   6. Parse the structured output into a `GeneratedTestCaseList`.
 *   7. Run the validation pipeline (validation + duplicates + coverage +
 *      policy + visual sidecar gate). Persist all reports.
 *   8. Seed the file-system review store from the policy report and
 *      record an `approved` event for every case the policy auto-approved.
 *   9. Run the export pipeline against the resulting review snapshot.
 *      Refused runs still emit `export-report.json` documenting why.
 *  10. Build and persist the evidence manifest with sha256 hashes of
 *      every emitted artifact, plus the prompt/schema/model identities.
 *
 * The harness is the SOLE entry point used by the `test:ti-eval` gate
 * and by the integration tests; all determinism guarantees flow from it.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS,
  ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES,
  DEDUPE_REPORT_ARTIFACT_FILENAME,
  EXPORT_REPORT_ARTIFACT_FILENAME,
  EXPORT_TESTCASES_ALM_XML_ARTIFACT_FILENAME,
  EXPORT_TESTCASES_CSV_ARTIFACT_FILENAME,
  EXPORT_TESTCASES_JSON_ARTIFACT_FILENAME,
  FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  FINOPS_ARTIFACT_DIRECTORY,
  FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME,
  GENERATED_TESTCASES_ARTIFACT_FILENAME,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  LBOM_ARTIFACT_DIRECTORY,
  LBOM_ARTIFACT_FILENAME,
  QC_MAPPING_PREVIEW_ARTIFACT_FILENAME,
  REDACTION_POLICY_VERSION,
  REVIEW_EVENTS_ARTIFACT_FILENAME,
  REVIEW_GATE_SCHEMA_VERSION,
  REVIEW_STATE_ARTIFACT_FILENAME,
  SELF_VERIFY_RUBRIC_ARTIFACT_DIRECTORY,
  SELF_VERIFY_RUBRIC_REPORT_ARTIFACT_FILENAME,
  SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME,
  TEST_DATA_ORACLE_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  TRACEABILITY_MATRIX_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
  type ActiveModelBinding,
  type BusinessTestIntentIr,
  type CompiledPromptArtifacts,
  type CompiledPromptRequest,
  type FinOpsBudgetEnvelope,
  type FinOpsBudgetReport,
  type FinOpsCostRateMap,
  type FinOpsJobOutcome,
  type FinOpsRole,
  type FaithfulnessStepVerdict,
  type FaithfulnessVerdict,
  type FourEyesEnforcementReason,
  type FourEyesPolicy,
  type GeneratedTestCase,
  type GeneratedTestCaseAuditMetadata,
  type GeneratedTestCaseList,
  type LlmGatewayErrorClass,
  type LlmGenerationRequest,
  type LlmGenerationResult,
  type ReviewEvent,
  type ReviewGateSnapshot,
  type ReviewSnapshot,
  type ReviewState,
  type TestCaseLevel,
  type TestCasePolicyDecision,
  type TestCasePolicyProfile,
  type TestCasePriority,
  type TestCaseRiskCategory,
  type TestCaseTechnique29119,
  type TestCaseType,
  type VisualScreenDescription,
  type VisualSidecarAttempt,
  type VisualSidecarCaptureInput,
  type VisualSidecarFallbackReason,
  type VisualSidecarFailure,
  type VisualSidecarResult,
  type VisualSidecarValidationReport,
  type SelfVerifyRubricReport,
  type Wave1ValidationAttestationSigningMode,
  type Wave1ValidationAttestationSummary,
  type Wave1ValidationEvidenceManifest,
  type Wave1ValidationFixtureId,
  type Wave1ValidationLbomDocument,
  type Wave1ValidationLbomSummary,
} from "../contracts/index.js";
import { deriveGeneratedTestCaseClassification } from "./test-case-classification.js";
import type { ExportPipelineArtifacts } from "./export-pipeline.js";
import type { ValidationPipelineArtifacts } from "./validation-pipeline.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  buildWave1ValidationEvidenceManifest,
  computeWave1ValidationEvidenceManifestDigest,
  writeWave1ValidationEvidenceManifest,
} from "./evidence-manifest.js";
import {
  buildSignedWave1ValidationAttestation,
  buildUnsignedWave1ValidationAttestationEnvelope,
  buildWave1ValidationAttestationStatement,
  listWave1ValidationAttestationArtifactPaths,
  persistWave1ValidationAttestation,
  summarizeWave1ValidationAttestation,
  type Wave1ValidationAttestationSigner,
} from "./evidence-attestation.js";
import { runAndPersistExportPipeline } from "./export-pipeline.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import type { LlmGatewayClient } from "./llm-gateway.js";
import type { LlmGatewayClientBundle } from "./llm-gateway-bundle.js";
import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import { loadWave1ValidationFixture } from "./validation-fixtures.js";
import {
  assertNoImagePayloadToTestGeneration,
  describeVisualScreens,
  writeVisualSidecarResultArtifact,
  type DescribeVisualScreensDiagnostic,
} from "./visual-sidecar-client.js";
import { cloneOpenTextAlmReferenceProfile } from "./qc-mapping.js";
import { compilePrompt } from "./prompt-compiler.js";
import type { ComplianceRiskOverride } from "./policy-gate.js";
import { cloneEuBankingDefaultProfile } from "./policy-profile.js";
import {
  formatOracleValueAsTestDataEntry,
  resolveTestData,
  type OracleResolution,
} from "./test-data-oracle.js";
import { writeAgentRoleRunArtifact } from "./agent-role-run-artifact.js";
import {
  cloneFourEyesPolicy,
  evaluateFourEyesEnforcement,
} from "./four-eyes-policy.js";
import {
  seedReviewStateFromPolicy,
  transitionReviewState,
} from "./review-state-machine.js";
import {
  runValidationPipeline,
  runValidationPipelineWithSelfVerify,
} from "./validation-pipeline.js";
import {
  GENERIC_VALIDATION_EXPECTED_RESULT,
  isUnresolvedValidationText,
} from "./unresolved-validation-rules.js";
import { type SelfVerifyRubricReplayCache } from "./self-verify-rubric.js";
import { executeWithReplayCache, type ReplayCache } from "./replay-cache.js";
import {
  buildFinOpsBudgetReport,
  createFinOpsUsageRecorder,
  writeFinOpsBudgetReport,
  type FinOpsUsageRecorder,
  type WriteFinOpsBudgetReportResult,
} from "./finops-report.js";
import { computePerSourceCostBreakdownHashFromReport } from "./per-source-cost.js";
import {
  buildLbomDocument,
  summarizeLbomArtifact,
  validateLbomDocument,
  writeLbomArtifact,
} from "./lbom-emitter.js";
import {
  ML_BOM_ARTIFACT_DIRECTORY,
  ML_BOM_ARTIFACT_FILENAME,
  buildMlBomDocument,
  summarizeMlBomArtifact,
  validateMlBomDocument,
  writeMlBomArtifact,
  type MlBomDocument,
  type MlBomModelBinding,
  type MlBomSummary,
} from "./ml-bom.js";
import {
  DEFAULT_FINOPS_BUDGET_ENVELOPE,
  resolveFinOpsRequestLimits,
  validateFinOpsBudgetEnvelope,
} from "./finops-budget.js";
import { writeGenealogyArtifact } from "./genealogy.js";

const TEST_GENERATION_DEPLOYMENT = "gpt-oss-120b-mock";
const TEST_GENERATION_MODEL_REVISION = "gpt-oss-120b-2026-04-25";
const TEST_GENERATION_GATEWAY_RELEASE = "wave1-validation-mock";
const VISUAL_PRIMARY_DEPLOYMENT = "llama-4-maverick-vision";
const VISUAL_FALLBACK_DEPLOYMENT = "phi-4-multimodal-instruct";
const POLICY_BUNDLE_VERSION = "wave1-validation";
export const BUSINESS_INTENT_IR_ARTIFACT_FILENAME =
  "business-intent-ir.json" as const;
export const COMPILED_PROMPT_ARTIFACT_FILENAME =
  "compiled-prompt.json" as const;
export const GATEWAY_REQUEST_AUDIT_ARTIFACT_FILENAME =
  "gateway-request-audit.json" as const;

interface GatewayRequestAuditArtifact {
  schemaVersion: "1.0.0";
  jobId: string;
  role: "test_generation";
  deployment: string;
  modelRevision: string;
  gatewayRelease: string;
  requestCount: number;
  imageInputCounts: number[];
  imagePayloadSent: false;
  promptHash: string;
  schemaHash: string;
  inputHash: string;
  cacheKeyDigest: string;
}

export interface RunWave1ValidationInput {
  fixtureId: Wave1ValidationFixtureId;
  jobId: string;
  /** ISO-8601 timestamp stamped onto every artifact. */
  generatedAt: string;
  /** Run directory (created recursively). */
  runDir: string;
  /** Optional override for the eu-banking-default profile. */
  policyProfile?: TestCasePolicyProfile;
  /**
   * Optional in-memory captures driving the multimodal visual sidecar
   * (Issue #1386). When supplied (alongside `bundle`), the harness runs
   * `describeVisualScreens` to produce `VisualScreenDescription[]` from
   * the captures instead of reading the on-disk `*.visual.json` fixture.
   * Pre-flight + sidecar routing + validation gate run end-to-end.
   *
   * The default fixture-driven path (omit this field) remains byte-stable.
   */
  visualCaptures?: ReadonlyArray<VisualSidecarCaptureInput>;
  /**
   * Optional gateway bundle. Required when `visualCaptures` is supplied;
   * its `visualPrimary` and `visualFallback` clients carry the deployment
   * identity that the resulting evidence manifest attests. The bundle
   * must NOT declare `imageInputSupport` on `testGeneration`; the visual
   * sidecar client and the harness independently assert this.
   */
  bundle?: LlmGatewayClientBundle;
  /**
   * Optional per-job FinOps budget envelope (Issue #1371). When omitted,
   * the harness applies the permissive default envelope so the FinOps
   * budget report still publishes per-role usage, but no breach is raised.
   */
  finopsBudget?: FinOpsBudgetEnvelope;
  /**
   * Optional cost-rate map. The currency label is stamped onto the
   * persisted FinOps report; the per-role rates are multiplied with
   * observed token counts to produce `estimatedCost`.
   */
  finopsCostRates?: FinOpsCostRateMap;
  /**
   * Optional replay cache for the generated test-case list. Cache hits skip
   * the test-generation gateway call and are surfaced in the FinOps report.
   */
  replayCache?: ReplayCache;
  /**
   * Optional four-eyes policy override (Issue #1376). When omitted, the
   * harness retains the deterministic Wave 1 single-reviewer flow so
   * fixture replays remain byte-identical. When provided, the harness
   * stamps `fourEyesEnforced` per case and emits two distinct
   * deterministic approval events for cases that match the policy.
   */
  fourEyesPolicy?: FourEyesPolicy;
  /**
   * Optional signing mode for the in-toto v1 attestation (Issue #1377).
   * Defaults to `"unsigned"` so the air-gapped fixture-only path remains
   * byte-stable and never invokes a signer. When set to `"sigstore"`,
   * `attestationSigner` MUST be supplied.
   */
  attestationSigningMode?: Wave1ValidationAttestationSigningMode;
  /**
   * Operator-supplied signer used when `attestationSigningMode` is
   * `"sigstore"`. The harness invokes the signer exactly once per run,
   * never logs the signer's secret material, and only records the
   * `signerReference` in the audit timeline.
   */
  attestationSigner?: Wave1ValidationAttestationSigner;
  /**
   * Opt-in self-verify rubric pass (Issue #1379). When omitted the
   * harness skips the rubric pass entirely and the run remains
   * byte-identical to the pre-#1379 baseline. When set to
   * `{ enabled: true }`, the harness threads the rubric pass through
   * the validation pipeline (between `testcase.validate` and
   * `testcase.policy`) and persists `<runDir>/testcases/self-verify-rubric.json`.
   * The deterministic validation default uses a synthesized perfect-score mock
   * responder so fixture replays remain byte-stable.
   */
  selfVerifyRubric?: Wave1ValidationSelfVerifyRubricInput;
}

/**
 * Optional rubric-pass inputs accepted by `runWave1Validation` (Issue #1379).
 *
 * `client`, when supplied, MUST carry role `test_generation` per the
 * non-goal "no use of a second model different from the generator". When
 * omitted, the harness builds a deterministic perfect-score mock client
 * inline so fixture replays stay byte-stable.
 */
export interface Wave1ValidationSelfVerifyRubricInput {
  enabled: true;
  /** Optional override; defaults to a synthesized perfect-score mock client. */
  client?: LlmGatewayClient;
  /** Optional rubric replay cache. */
  cache?: SelfVerifyRubricReplayCache;
  /** Forwarded to `LlmGenerationRequest.maxOutputTokens`. */
  maxOutputTokens?: number;
  /** Forwarded to `LlmGenerationRequest.maxWallClockMs`. */
  maxWallClockMs?: number;
  /** Forwarded to `LlmGenerationRequest.maxRetries`. */
  maxRetries?: number;
  /** Forwarded to `LlmGenerationRequest.maxInputTokens`. */
  maxInputTokens?: number;
  /**
   * Optional override for the rubric-mock responder. When omitted the
   * harness uses `synthesizePerfectRubricResponse` (every dimension and
   * visual subscore returns 1.0) so the deterministic validation fixture
   * replays remain byte-stable.
   */
  mockResponder?: (
    request: LlmGenerationRequest,
    attempt: number,
  ) => LlmGenerationResult | Promise<LlmGenerationResult>;
}

export interface Wave1ValidationRunResult {
  fixtureId: Wave1ValidationFixtureId;
  jobId: string;
  generatedAt: string;
  runDir: string;
  intent: BusinessTestIntentIr;
  visual: VisualScreenDescription[];
  compiledPrompt: {
    request: CompiledPromptRequest;
    artifacts: CompiledPromptArtifacts;
  };
  generatedList: GeneratedTestCaseList;
  validation: ValidationPipelineArtifacts;
  reviewSnapshot: ReviewGateSnapshot;
  exportArtifacts: ExportPipelineArtifacts;
  manifest: Wave1ValidationEvidenceManifest;
  /**
   * Sorted list of artifact filenames the manifest attests, for callers
   * that want to assert on artifact identity without re-reading the
   * manifest.
   */
  artifactFilenames: string[];
  /**
   * When `visualCaptures` was supplied, the structured outcome of the
   * multimodal sidecar pipeline. `undefined` for the legacy fixture-only
   * path so existing call sites remain typed.
   */
  visualSidecar?: VisualSidecarResult;
  /**
   * FinOps budget report (Issue #1371) — always emitted by the harness so
   * downstream operators can read per-role token usage, cache-hit status,
   * and any budget breach without re-deriving from individual artifacts.
   */
  finopsReport: FinOpsBudgetReport;
  /**
   * Absolute path to the persisted `finops/budget-report.json` artifact.
   * Always set so verification + inspector code can read it without
   * recomputing the layout.
   */
  finopsArtifactPath: string;
  /**
   * Audit-timeline summary of the in-toto attestation produced by this
   * run (Issue #1377). Always present; carries the active signing
   * mode, the non-secret signer reference (when signed), and the
   * SHA-256 of the persisted envelope and bundle.
   */
  attestation: Wave1ValidationAttestationSummary;
  /**
   * Per-job CycloneDX 1.6 ML-BOM (Issue #1378). The harness always emits
   * the LBOM under `<runDir>/lbom/ai-bom.cdx.json` so an operator can
   * inventory the model chain, the curated few-shot bundle, and the
   * active policy profile that produced the run's structured test cases.
   */
  lbom: Wave1ValidationLbomDocument;
  /** Audit-timeline summary of the per-job LBOM artifact. */
  lbomSummary: Wave1ValidationLbomSummary;
  /** Absolute path of the persisted `lbom/ai-bom.cdx.json` artifact. */
  lbomArtifactPath: string;
  /**
   * Release-scoped CycloneDX 1.7 ML-BOM persisted under
   * `<runDir>/evidence/ml-bom/cyclonedx-1.7-ml-bom.json`.
   */
  mlBom: MlBomDocument;
  /** Audit-timeline summary of the release-scoped ML-BOM artifact. */
  mlBomSummary: MlBomSummary;
  /** Absolute path of the persisted release-scoped ML-BOM artifact. */
  mlBomArtifactPath: string;
  /**
   * Self-verify rubric report (Issue #1379) when the opt-in pass ran
   * for this run. Mirrors `validation.rubric` for callers that prefer a
   * top-level handle.
   */
  selfVerifyRubric?: SelfVerifyRubricReport;
  /**
   * Absolute path of the persisted `<runDir>/testcases/self-verify-rubric.json`
   * artifact when the rubric pass ran. `undefined` when the pass was
   * not enabled.
   */
  selfVerifyRubricArtifactPath?: string;
}

export class Wave1ValidationVisualSidecarFailureError extends Error {
  readonly visualSidecar: VisualSidecarFailure;
  readonly artifactPath: string;

  constructor(input: {
    visualSidecar: VisualSidecarFailure;
    artifactPath: string;
  }) {
    super(
      `runWave1Validation: multimodal visual sidecar failed (${input.visualSidecar.failureClass}: ${input.visualSidecar.failureMessage}). The harness refuses to proceed because both visual sidecars are exhausted.`,
    );
    this.name = "Wave1ValidationVisualSidecarFailureError";
    this.visualSidecar = input.visualSidecar;
    this.artifactPath = input.artifactPath;
  }
}

export class Wave1ValidationFinOpsBudgetExceededError extends Error {
  readonly report: FinOpsBudgetReport;
  readonly artifactPath: string;

  constructor(input: { report: FinOpsBudgetReport; artifactPath: string }) {
    super(
      `runWave1Validation: FinOps budget exceeded (${input.report.breaches.map((b) => b.rule).join(", ")})`,
    );
    this.name = "Wave1ValidationFinOpsBudgetExceededError";
    this.report = input.report;
    this.artifactPath = input.artifactPath;
  }
}

/**
 * Maximum case-title length permitted by the test-case schema validator
 * (`TITLE_MAX_LENGTH = 200` in `test-case-validation.ts`).
 *
 * The synthesizer composes titles from interpolated `field.label` /
 * `action.label` strings. For most labels the result fits comfortably,
 * but realistic banking and insurance designs carry long
 * INFORMATIVE_LABEL disclaimers (Wartezeit-Hinweis, DSGVO-Hinweis,
 * Tipping-Off-Hinweis, MiFID-Risiko-Aufklaerung) whose `text` is
 * 140-180+ chars. Without this clamp the resulting `Submit valid …`
 * title overflows the schema limit and the entire pipeline blocks on
 * `validation:schema_invalid` even though the case payload is otherwise
 * well-formed. Surfaced by the Eingabemasken K0 measurement run on
 * `eingabemaske-bu-antrag` (Wartezeit-Hinweis = 175 chars).
 */
const SYNTHESIZED_TITLE_MAX_LENGTH = 200;
const SYNTHESIZED_TITLE_ELLIPSIS = "...";

/**
 * Clamp a synthesized case title to {@link SYNTHESIZED_TITLE_MAX_LENGTH}
 * with a trailing ellipsis when truncation occurred. The function never
 * returns a string longer than the schema limit and never returns an
 * empty string for non-empty input, so downstream `title_empty` /
 * `schema_invalid` validation errors caused purely by length are
 * eliminated.
 */
const clampSynthesizedTitle = (raw: string): string => {
  if (raw.length <= SYNTHESIZED_TITLE_MAX_LENGTH) return raw;
  const cut = raw.slice(
    0,
    SYNTHESIZED_TITLE_MAX_LENGTH - SYNTHESIZED_TITLE_ELLIPSIS.length,
  );
  return `${cut.trimEnd()}${SYNTHESIZED_TITLE_ELLIPSIS}`;
};

/**
 * Pick the strongest review-only category from compliance overrides
 * applicable to a given screen, or `undefined` when no review-only
 * override matches. Mirrors the policy-gate's
 * `resolveComplianceRiskOverride` so the synthesizer's tag and the
 * gate's screen-classification stay aligned (Issue #2030 follow-up,
 * K1-measurement-driven).
 */
const SYNTHESIZED_RISK_OVERRIDE_PRIORITY: ReadonlyArray<TestCaseRiskCategory> = [
  "regulated_data",
  "financial_transaction",
];
const pickComplianceOverride = (
  screenId: string,
  overrides: ReadonlyArray<ComplianceRiskOverride> | undefined,
): TestCaseRiskCategory | undefined => {
  if (overrides === undefined || overrides.length === 0) return undefined;
  const matching = overrides.filter(
    (o) => o.screenId === undefined || o.screenId === screenId,
  );
  if (matching.length === 0) return undefined;
  for (const category of SYNTHESIZED_RISK_OVERRIDE_PRIORITY) {
    if (matching.some((o) => o.riskCategory === category)) return category;
  }
  return undefined;
};

/**
 * Resolve the per-case riskCategory for a synthesized test case.
 *
 * Resolution order (mirrors the policy-gate's `findIntentReviewRisk`
 * fallback chain so the case-tag agrees with the screen-level
 * classification used in downgrade detection):
 *
 *   1. Strong signal from `field.label` / `action.label` keyword match
 *      via {@link deriveRiskCategoryForLabel}. Returns immediately when
 *      a review-only category is found.
 *   2. Fallback to the compliance-sidecar override applicable to the
 *      case's screen (job-wide if `screenId === undefined`).
 *   3. Default to `"low"`.
 *
 * The override path is the K1-measurement-driven addition: fields whose
 * labels do NOT carry a regulatory keyword still inherit the regulatory
 * classification of the screen they live on, so they ship with the
 * correct riskCategory upfront and the policy gate stops emitting
 * `policy:risk-tag-downgrade-detected` warnings on them.
 */
const resolveSynthesizedRiskCategory = (
  label: string | undefined,
  screenId: string,
  complianceOverrides: ReadonlyArray<ComplianceRiskOverride> | undefined,
): TestCaseRiskCategory => {
  if (label !== undefined) {
    const fromLabel = deriveRiskCategoryForLabel(label);
    if (fromLabel !== "low") return fromLabel;
  }
  const fromOverride = pickComplianceOverride(screenId, complianceOverrides);
  if (fromOverride !== undefined) return fromOverride;
  return "low";
};

/**
 * Build a deterministic `GeneratedTestCaseList` from a Business Test
 * Intent IR. The function is the source of truth for what a "good"
 * Wave 1 mock-LLM response looks like for a given intent: it covers
 * each detected field, action, validation, and navigation edge with at
 * least one targeted case, plus one accessibility case per screen with
 * form fields. The output is fully redacted (the IR already carries
 * `[REDACTED:*]` placeholders) and trace-stamped.
 *
 * Exported so the eval-gate tests can compute "expected" coverage
 * without re-running the harness end-to-end.
 */
export const synthesizeGeneratedTestCases = (input: {
  jobId: string;
  generatedAt: string;
  intent: BusinessTestIntentIr;
  audit: GeneratedTestCaseAuditMetadata;
  /**
   * Optional compliance-sidecar overrides (Issue #2030 follow-up).
   * Forwarded into the per-case riskCategory resolution so cases on
   * regulated screens whose field labels do NOT carry a regulatory
   * keyword still inherit the screen-level classification declared by
   * the sidecar. The same overrides MUST be passed to
   * {@link runValidationPipeline} so the synthesizer tag and the
   * policy-gate classification agree.
   */
  complianceOverrides?: ReadonlyArray<ComplianceRiskOverride>;
  /**
   * Optional opt-in for the deterministic test-data oracle (#2071).
   * When `true`, every per-field synthesized case ships with concrete
   * boundary values resolved from `field.validations[*]` via
   * {@link resolveTestData}; rules the oracle cannot resolve surface
   * as case-level `openQuestions[*]` instead of inventing data. When
   * omitted (default `false`), `testData` stays empty — the seven
   * MA-0 baseline-eval snapshots and any other caller that does not
   * pass this flag are byte-stable.
   */
  useTestDataOracle?: boolean;
  /**
   * Wall-clock anchor for time-relative oracle rules (`Date <= today`,
   * `Date >= today + 1 day`). Defaults to the 2026-05-09 fixture
   * anchor for deterministic snapshots; override per call to pin the
   * oracle to the run's `generatedAt`.
   */
  oracleNow?: Date;
}): GeneratedTestCaseList => {
  const cases: GeneratedTestCase[] = [];

  const screenIdsWithFields = new Set(
    input.intent.detectedFields.map((f) => f.screenId),
  );
  const validationsByField = new Map<string, string[]>();
  const ruleStringsByField = new Map<string, string[]>();
  for (const v of input.intent.detectedValidations) {
    if (v.targetFieldId === undefined) continue;
    const existing = validationsByField.get(v.targetFieldId) ?? [];
    existing.push(v.id);
    validationsByField.set(v.targetFieldId, existing);
    const ruleList = ruleStringsByField.get(v.targetFieldId) ?? [];
    ruleList.push(v.rule);
    ruleStringsByField.set(v.targetFieldId, ruleList);
  }

  // #2071 deterministic test-data oracle. The resolver is invoked
  // per-field once and its `valid` / `invalid` partitions are reused
  // across the four field-case types (functional / negative /
  // validation / boundary). The oracle is opt-in via
  // `input.useTestDataOracle`; when disabled the synthesizer ships
  // `testData: []` for every case so pre-#2071 snapshots stay byte
  // stable.
  const ORACLE_DEFAULT_ANCHOR = new Date("2026-05-09T00:00:00.000Z");
  const oracleNow = input.oracleNow ?? ORACLE_DEFAULT_ANCHOR;
  const oracleByField = new Map<string, OracleResolution>();
  if (input.useTestDataOracle === true) {
    for (const field of input.intent.detectedFields) {
      const rules = ruleStringsByField.get(field.id) ?? [];
      oracleByField.set(
        field.id,
        resolveTestData({
          fieldLabel: field.label,
          validations: rules,
          ...(field.defaultValue !== undefined
            ? { defaultValue: field.defaultValue }
            : {}),
          now: oracleNow,
        }),
      );
    }
  }
  const oracleValidTestData = (fieldId: string, fieldLabel: string): string[] => {
    const r = oracleByField.get(fieldId);
    if (r === undefined || !r.resolvable) return [];
    return r.valid.map((v) => formatOracleValueAsTestDataEntry(fieldLabel, v));
  };
  const oracleInvalidTestData = (
    fieldId: string,
    fieldLabel: string,
  ): string[] => {
    const r = oracleByField.get(fieldId);
    if (r === undefined || !r.resolvable) return [];
    return r.invalid.map((v) =>
      formatOracleValueAsTestDataEntry(fieldLabel, v),
    );
  };
  const oracleAllTestData = (
    fieldId: string,
    fieldLabel: string,
  ): string[] => [
    ...oracleValidTestData(fieldId, fieldLabel),
    ...oracleInvalidTestData(fieldId, fieldLabel),
  ];
  const oracleOpenQuestion = (fieldId: string): string | undefined => {
    const r = oracleByField.get(fieldId);
    if (r === undefined || r.resolvable) return undefined;
    return r.openQuestion;
  };

  for (const field of input.intent.detectedFields) {
    cases.push(
      buildSyntheticCase({
        idSuffix: `field-functional-${stableSlug(field.id)}`,
        title: clampSynthesizedTitle(
          `Submit valid ${field.label} on ${field.screenId}`,
        ),
        objective: `Confirm the ${field.label} field accepts a valid value.`,
        type: "functional",
        priority: "p1",
        riskCategory: resolveSynthesizedRiskCategory(
          field.label,
          field.screenId,
          input.complianceOverrides,
        ),
        technique: "use_case",
        coveredFieldIds: [field.id],
        coveredActionIds: actionIdsForScreen(input.intent, field.screenId),
        coveredValidationIds: [],
        coveredNavigationIds: [],
        screenId: field.screenId,
        ...(field.trace.nodeId !== undefined
          ? { traceNodeId: field.trace.nodeId }
          : {}),
        ...(field.trace.nodeName !== undefined
          ? { traceNodeName: field.trace.nodeName }
          : {}),
        steps: [
          {
            index: 1,
            action: `Open the ${input.intent.screens.find((s) => s.screenId === field.screenId)?.screenName ?? field.screenId} screen`,
          },
          {
            index: 2,
            action: `Provide a valid ${field.label} value`,
          },
          {
            index: 3,
            action: "Submit the form",
            expected: "The next screen is reachable",
          },
        ],
        expectedResults: [
          `${field.label} is accepted`,
          "The next screen is reachable",
        ],
        testData: oracleValidTestData(field.id, field.label),
        ...(oracleOpenQuestion(field.id) !== undefined
          ? {
              openQuestions: [
                oracleOpenQuestion(field.id) as string,
              ],
            }
          : {}),
        ...stampAudit(input),
      }),
    );

    const validationIds = validationsByField.get(field.id) ?? [];
    if (validationIds.length > 0) {
      const validationRules = input.intent.detectedValidations
        .filter((validation) => validation.targetFieldId === field.id)
        .map((validation) => validation.rule);
      const unresolvedValidationQuestions =
        buildUnresolvedValidationQuestionsForField({
          fieldLabel: field.label,
          validationRules,
        });
      const hasUnresolvedValidationRules =
        unresolvedValidationQuestions.length > 0;
      cases.push(
        buildSyntheticCase({
          idSuffix: `field-negative-${stableSlug(field.id)}`,
          title: clampSynthesizedTitle(
            hasUnresolvedValidationRules
              ? `Capture unresolved validation behavior for ${field.label} on ${field.screenId}`
              : `Reject empty ${field.label} on ${field.screenId}`,
          ),
          objective: hasUnresolvedValidationRules
            ? `Document the validation behavior for ${field.label} once the final validation scenario is specified.`
            : `Confirm the form rejects an empty ${field.label}.`,
          type: "negative",
          priority: "p1",
          riskCategory: resolveSynthesizedRiskCategory(
          field.label,
          field.screenId,
          input.complianceOverrides,
        ),
          technique: "equivalence_partitioning",
          coveredFieldIds: [field.id],
          coveredActionIds: actionIdsForScreen(input.intent, field.screenId),
          coveredValidationIds: validationIds,
          coveredNavigationIds: [],
          screenId: field.screenId,
          ...(field.trace.nodeId !== undefined
            ? { traceNodeId: field.trace.nodeId }
            : {}),
          ...(field.trace.nodeName !== undefined
            ? { traceNodeName: field.trace.nodeName }
            : {}),
          steps: [
            { index: 1, action: `Open the ${field.screenId} screen` },
            {
              index: 2,
              action: hasUnresolvedValidationRules
                ? `Exercise the ${field.label} validation scenario defined by the finalized specification`
                : `Leave ${field.label} empty`,
            },
            {
              index: 3,
              action: hasUnresolvedValidationRules
                ? "Observe the resulting validation behavior"
                : "Submit the form",
              expected: hasUnresolvedValidationRules
                ? GENERIC_VALIDATION_EXPECTED_RESULT
                : "An inline validation error is shown",
            },
          ],
          expectedResults: hasUnresolvedValidationRules
            ? [GENERIC_VALIDATION_EXPECTED_RESULT]
            : [
                `${field.label} is required`,
                "Submit is blocked until the rule is satisfied",
              ],
          ...(hasUnresolvedValidationRules
            ? { openQuestions: unresolvedValidationQuestions }
            : {}),
          testData: hasUnresolvedValidationRules
            ? []
            : oracleInvalidTestData(field.id, field.label),
          ...stampAudit(input),
        }),
      );
      cases.push(
        buildSyntheticCase({
          idSuffix: `field-validation-${stableSlug(field.id)}`,
          title: clampSynthesizedTitle(
            hasUnresolvedValidationRules
              ? `Capture unresolved validation rules for ${field.label} on ${field.screenId}`
              : `Validate ${field.label} rules on ${field.screenId}`,
          ),
          objective: hasUnresolvedValidationRules
            ? `Capture generic validation behavior for ${field.label} without inventing exact messages or thresholds.`
            : `Confirm validation messages for ${field.label}.`,
          type: "validation",
          priority: "p1",
          riskCategory: resolveSynthesizedRiskCategory(
          field.label,
          field.screenId,
          input.complianceOverrides,
        ),
          technique: "decision_table",
          coveredFieldIds: [field.id],
          coveredActionIds: [],
          coveredValidationIds: validationIds,
          coveredNavigationIds: [],
          screenId: field.screenId,
          ...(field.trace.nodeId !== undefined
            ? { traceNodeId: field.trace.nodeId }
            : {}),
          ...(field.trace.nodeName !== undefined
            ? { traceNodeName: field.trace.nodeName }
            : {}),
          steps: [
            { index: 1, action: `Open the ${field.screenId} screen` },
            {
              index: 2,
              action: hasUnresolvedValidationRules
                ? `Exercise the ${field.label} validation path using the finalized specification`
                : `Provide an invalid ${field.label} value`,
              expected: hasUnresolvedValidationRules
                ? GENERIC_VALIDATION_EXPECTED_RESULT
                : "Inline validation error displayed",
            },
          ],
          expectedResults: hasUnresolvedValidationRules
            ? [GENERIC_VALIDATION_EXPECTED_RESULT]
            : ["Each validation rule is mapped to a clear message"],
          ...(hasUnresolvedValidationRules
            ? { openQuestions: unresolvedValidationQuestions }
            : {}),
          testData: hasUnresolvedValidationRules
            ? []
            : oracleInvalidTestData(field.id, field.label),
          ...stampAudit(input),
        }),
      );
      if (!hasUnresolvedValidationRules) {
        cases.push(
          buildSyntheticCase({
            idSuffix: `field-boundary-${stableSlug(field.id)}`,
            title: clampSynthesizedTitle(
              `Boundary lengths for ${field.label} on ${field.screenId}`,
            ),
            objective: `Probe the boundary lengths of the ${field.label} field.`,
            type: "boundary",
            priority: "p2",
            riskCategory: resolveSynthesizedRiskCategory(
          field.label,
          field.screenId,
          input.complianceOverrides,
        ),
            technique: "boundary_value_analysis",
            coveredFieldIds: [field.id],
            coveredActionIds: [],
            coveredValidationIds: [],
            coveredNavigationIds: [],
            screenId: field.screenId,
            ...(field.trace.nodeId !== undefined
              ? { traceNodeId: field.trace.nodeId }
              : {}),
            ...(field.trace.nodeName !== undefined
              ? { traceNodeName: field.trace.nodeName }
              : {}),
            steps: [
              { index: 1, action: `Open the ${field.screenId} screen` },
              {
                index: 2,
                action: `Enter the minimum boundary value into ${field.label}`,
                expected: "Field accepts the minimum boundary value",
              },
              {
                index: 3,
                action: `Enter the maximum boundary value into ${field.label}`,
                expected: "Field accepts the maximum boundary value",
              },
            ],
            expectedResults: [
              "Min/max boundaries behave consistently with the validation rules",
            ],
            testData: oracleAllTestData(field.id, field.label),
            ...stampAudit(input),
          }),
        );
      }
    }
  }

  for (const action of input.intent.detectedActions) {
    cases.push(
      buildSyntheticCase({
        idSuffix: `action-${stableSlug(action.id)}`,
        title: clampSynthesizedTitle(
          `Trigger ${action.label} on ${action.screenId}`,
        ),
        objective: `Confirm the ${action.label} control performs its action.`,
        type: "functional",
        priority: "p1",
        // Action cases preserve the pre-#2030 default of `low` when no
        // compliance override applies. Passing `undefined` for the
        // label deliberately skips `deriveRiskCategoryForLabel` so an
        // action label like "Submit Loss Amount" does NOT silently
        // elevate baselines via the financial_transaction keyword
        // path. The override path still elevates actions on regulated
        // screens when the sidecar declares `regulatedRiskOverride`.
        riskCategory: resolveSynthesizedRiskCategory(
          undefined,
          action.screenId,
          input.complianceOverrides,
        ),
        technique: "use_case",
        coveredFieldIds: [],
        coveredActionIds: [action.id],
        coveredValidationIds: [],
        coveredNavigationIds: [],
        screenId: action.screenId,
        ...(action.trace.nodeId !== undefined
          ? { traceNodeId: action.trace.nodeId }
          : {}),
        ...(action.trace.nodeName !== undefined
          ? { traceNodeName: action.trace.nodeName }
          : {}),
        steps: [
          { index: 1, action: `Open the ${action.screenId} screen` },
          {
            index: 2,
            action: `Activate the ${action.label} control`,
            expected: "The control performs its action",
          },
        ],
        expectedResults: [`${action.label} performs its declared action`],
        ...stampAudit(input),
      }),
    );
  }

  for (const nav of input.intent.detectedNavigation) {
    cases.push(
      buildSyntheticCase({
        idSuffix: `navigation-${stableSlug(nav.id)}`,
        title: clampSynthesizedTitle(
          `Navigate from ${nav.screenId} to ${nav.targetScreenId}`,
        ),
        objective: `Confirm the navigation edge from ${nav.screenId} to ${nav.targetScreenId}.`,
        type: "navigation",
        priority: "p2",
        riskCategory: resolveSynthesizedRiskCategory(
          undefined,
          nav.screenId,
          input.complianceOverrides,
        ),
        technique: "state_transition",
        coveredFieldIds: [],
        coveredActionIds: [],
        coveredValidationIds: [],
        coveredNavigationIds: [nav.id],
        screenId: nav.screenId,
        ...(nav.trace.nodeId !== undefined
          ? { traceNodeId: nav.trace.nodeId }
          : {}),
        ...(nav.trace.nodeName !== undefined
          ? { traceNodeName: nav.trace.nodeName }
          : {}),
        steps: [
          { index: 1, action: `Open the ${nav.screenId} screen` },
          {
            index: 2,
            action: `Trigger the navigation to ${nav.targetScreenId}`,
            expected: `The ${nav.targetScreenId} screen is shown`,
          },
        ],
        expectedResults: [`${nav.targetScreenId} is reachable`],
        ...stampAudit(input),
      }),
    );
  }

  const a11yScreens = Array.from(screenIdsWithFields).sort();
  for (const screenId of a11yScreens) {
    const fieldIds = input.intent.detectedFields
      .filter((f) => f.screenId === screenId)
      .map((f) => f.id);
    cases.push(
      buildSyntheticCase({
        idSuffix: `a11y-${stableSlug(screenId)}`,
        title: clampSynthesizedTitle(`Accessibility check for ${screenId}`),
        objective: `Confirm keyboard and screen-reader accessibility on ${screenId}.`,
        type: "accessibility",
        priority: "p2",
        riskCategory: resolveSynthesizedRiskCategory(
          undefined,
          screenId,
          input.complianceOverrides,
        ),
        technique: "exploratory",
        coveredFieldIds: fieldIds,
        coveredActionIds: actionIdsForScreen(input.intent, screenId),
        coveredValidationIds: [],
        coveredNavigationIds: [],
        screenId,
        traceNodeId: screenId,
        steps: [
          { index: 1, action: `Open the ${screenId} screen` },
          {
            index: 2,
            action: "Tab through every focusable control",
            expected: "Every control is reachable via keyboard",
          },
          {
            index: 3,
            action:
              "Verify focus order and visible focus indicator while tabbing",
            expected:
              "Focus order stays logical and every control shows a visible focus state",
          },
          {
            index: 4,
            action: "Inspect labels and ARIA attributes with a screen reader",
            expected:
              "Each control announces a meaningful label and validation updates are announced via aria-live",
          },
        ],
        expectedResults: [
          "All controls reachable via keyboard",
          "Focus order stays logical with visible focus indicators",
          "Each control announces a meaningful label and validation updates are announced via aria-live",
        ],
        ...stampAudit(input),
      }),
    );
  }

  cases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: input.jobId,
    testCases: cases,
  };
};

const stableSlug = (input: string): string => {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
};

/**
 * Build a deterministic rubric mock LLM gateway client used by the
 * Wave 1 Validation harness when `selfVerifyRubric: { enabled: true }` is set
 * without an explicit `client`. Test case ids are passed in by the
 * harness via closure capture (NOT parsed back out of the prompt) so
 * the responder is robust to any future change in prompt rendering and
 * works for callers that supply non-default test case id schemes.
 *
 * Each test case receives a perfect 1.0 across all six rubric
 * dimensions, plus the four visual subscores when `visualPresent` is
 * true. This keeps fixture replays byte-stable while still exercising
 * the full validation + parsing path.
 */
const buildWave1ValidationRubricMockClient = (input: {
  expectedTestCaseIds: ReadonlyArray<string>;
  visualPresent: boolean;
  responder?: (
    request: LlmGenerationRequest,
    attempt: number,
  ) => LlmGenerationResult | Promise<LlmGenerationResult>;
}): LlmGatewayClient => {
  const defaultResponder = (
    request: LlmGenerationRequest,
  ): LlmGenerationResult => {
    if (
      request.responseSchemaName !== SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME
    ) {
      return {
        outcome: "error",
        errorClass: "schema_invalid",
        message:
          "Wave1Validation rubric mock: unexpected responseSchemaName on rubric request",
        retryable: false,
        attempt: 1,
      };
    }
    return synthesizePerfectWave1ValidationRubricResponse({
      expectedTestCaseIds: input.expectedTestCaseIds,
      visualPresent: input.visualPresent,
    });
  };
  return createMockLlmGatewayClient({
    role: "test_generation",
    deployment: TEST_GENERATION_DEPLOYMENT,
    modelRevision: TEST_GENERATION_MODEL_REVISION,
    gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
    responder: input.responder ?? defaultResponder,
  });
};

/**
 * Synthesize a perfect-score rubric response for the supplied test
 * case ids. Pure: identical inputs produce byte-identical responses,
 * which is what guarantees the rubric replay-cache hit path documented
 * on Issue #1379 stays byte-stable for the fixture suite.
 */
const synthesizePerfectWave1ValidationRubricResponse = (input: {
  expectedTestCaseIds: ReadonlyArray<string>;
  visualPresent: boolean;
}): LlmGenerationResult => {
  const sortedDimensions = [...ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS].sort();
  const sortedSubscores = [
    ...ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES,
  ].sort();
  const caseEvaluations = input.expectedTestCaseIds.map((id) => {
    const evaluation: Record<string, unknown> = {
      testCaseId: id,
      dimensions: sortedDimensions.map((dimension) => ({
        dimension,
        score: 1,
      })),
      citations: [
        {
          ruleId: "wave1.synth.default",
          message:
            "Synthesized perfect score for the deterministic Wave 1 Validation fixture",
        },
      ],
    };
    if (input.visualPresent) {
      evaluation["visualSubscores"] = sortedSubscores.map((subscore) => ({
        subscore,
        score: 1,
      }));
    }
    return evaluation;
  });
  return {
    outcome: "success",
    content: { caseEvaluations },
    finishReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0 },
    modelDeployment: TEST_GENERATION_DEPLOYMENT,
    modelRevision: TEST_GENERATION_MODEL_REVISION,
    gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
    attempt: 1,
  };
};

/**
 * Substring keywords that mark a synthesized field-case as
 * `financial_transaction` for the policy gate's review-only set
 * (Issue #2030 follow-up; calibrated against the Eingabemasken K1
 * measurement; see `scripts/measure-eingabemasken.ts`).
 *
 * Each keyword is lowercased and matched as a `String.includes`
 * substring against `field.label`. The list is conservatively curated
 * to avoid collisions with the seven MA-0 baseline archetype labels —
 * adding tokens like `principal`, `rate`, `term`, `payment`, `policy`,
 * `incident`, `passport`, `price` or `total` would change baseline
 * eval snapshots, so those tokens are deliberately excluded. If you add
 * a keyword here, run `pnpm test` and update
 * `src/test-intelligence/fixtures/eval-baseline-*.json` snapshots in
 * the same commit.
 */
const FINANCIAL_TRANSACTION_KEYWORDS: ReadonlyArray<string> = [
  // Pre-#2030: SEPA / payment (eu-banking-default baseline)
  "iban",
  "bic",
  "amount",
  "authoriz",
  "authoris",
  "authentication code",
  // #2030 follow-up: SEPA + general EUR amount in German
  "betrag",
  "monatliche rate",
  "monthly installment",
  // #2030 follow-up: MiFID II securities order entry
  "isin",
  "limit-preis",
  "limit price",
  "stueck",
  "order-typ",
  "order type",
  "gueltigkeitsdauer",
  "time-in-force",
  // #2030 follow-up: consumer credit (CCD / BDSG)
  "kreditbetrag",
  "effektivzins",
  "annuit",
  "debt-to-income",
  "dti-quote",
  // #2030 follow-up: insurance pricing / quote
  "praemie",
  "premium",
  "deckungssumme",
  "selbstbehalt",
  // #2030 follow-up: income / cost flows
  "jahresbrutto",
  "annual gross",
  "nettoeinkommen",
  "net income",
  "monthly net",
  "wohnkosten",
  "housing cost",
  // #2030 follow-up: pension / annuity
  "rente",
  "monatsrente",
  // #2030 follow-up: percentage / sum constraints (LV-Bezugsberechtigung)
  "quote in prozent",
  "quote-percent",
];

/**
 * Substring keywords that mark a synthesized field-case as
 * `regulated_data`. Same conventions and same baseline-collision
 * exclusions as {@link FINANCIAL_TRANSACTION_KEYWORDS}.
 */
const REGULATED_DATA_KEYWORDS: ReadonlyArray<string> = [
  // Pre-#2030: PII baseline
  "tax id",
  "email",
  "phone",
  "name",
  "postcode",
  "[redacted",
  // #2030 follow-up: address / identity (German)
  "plz",
  "strasse",
  "anschrift",
  "geburts",
  "staatsang",
  "videoident",
  "postident",
  "ident-verfahren",
  "identifikation",
  // #2030 follow-up: KYC / GwG / FATCA compliance flags
  "pep",
  "fatca",
  "us-person",
  "beneficial owner",
  "wirtschaftlich berechtigt",
  "datenschutz",
  "agb akzeptiert",
  // #2030 follow-up: SCHUFA / creditworthiness
  "schufa",
  "bonität",
  "bonita",
  // #2030 follow-up: MiFID II compliance documentation
  "mifid",
  "kostenausweis",
  "geeignetheit",
  "anlegerprofil",
  "anlageziel",
  "anlagedauer",
  "risikoklasse",
  "risikobereitschaft",
  "risikohinweis",
  "verlusttragfaehig",
  "asset-allokation",
  "aufklaerung",
  // #2030 follow-up: insurance underwriting / claim (VVG / IDD)
  "schaden",
  "unfall",
  "kennzeichen",
  "halter",
  "versicher",
  "polizei",
  "aktenzeichen",
  "verletzt",
  "gutachter",
  "skizze",
  "schadenart",
  // #2030 follow-up: life insurance / inheritance (VVG / ErbStG)
  "bezugsart",
  "beguenstigt",
  "beneficiary",
  "verhaeltnis",
  // #2030 follow-up: BU / health (Art. 9 GDPR)
  "vorerkrankung",
  "behandlung",
  "krankenhaus",
  "medikament",
  "gesundheit",
  "diagnose",
  "hobbys mit erhoehtem risiko",
  "high-risk hobby",
  "wartezeit",
  "anzeigepflicht",
  "vorvertraglich",
  "wahrheitsgemaess",
  // #2030 follow-up: AML / GwG-Section-43
  "gwg",
  "geldwaesche",
  "verdacht",
  "sachverhalt",
  "sanktion",
  "sanctions",
  "tipping-off",
  "fiu",
  "meldepflicht",
  "beteiligte",
  // #2030 follow-up: cyber / DORA / NIS2
  "isms",
  "iso 27001",
  "mfa",
  "edr",
  "vpn",
  "pen-test",
  "penetration",
  "incident-response",
  " irp",
  " bcp",
  " drp",
  "dsfa",
  "dpia",
  "auftragsverarbeiter",
  "datenklassifizierung",
  "ict-risk",
  "ict-budget",
  "nis2",
  "dora",
  // #2030 follow-up: EAA / WCAG accessibility
  "wcag",
  "aria-",
  "aria=",
  "tab-index",
  "screen-reader",
  "focus-management",
];

const deriveRiskCategoryForLabel = (label: string): TestCaseRiskCategory => {
  const normalised = label.toLowerCase();
  for (const keyword of FINANCIAL_TRANSACTION_KEYWORDS) {
    if (normalised.includes(keyword)) return "financial_transaction";
  }
  for (const keyword of REGULATED_DATA_KEYWORDS) {
    if (normalised.includes(keyword)) return "regulated_data";
  }
  return "low";
};

const actionIdsForScreen = (
  intent: BusinessTestIntentIr,
  screenId: string,
): string[] => {
  return intent.detectedActions
    .filter((a) => a.screenId === screenId)
    .map((a) => a.id);
};

const stampAudit = (input: {
  audit: GeneratedTestCaseAuditMetadata;
}): { audit: GeneratedTestCaseAuditMetadata } => {
  return { audit: { ...input.audit } };
};

interface BuildSyntheticCaseInput {
  idSuffix: string;
  title: string;
  objective: string;
  type: TestCaseType;
  priority: TestCasePriority;
  riskCategory: TestCaseRiskCategory;
  technique: TestCaseTechnique29119;
  coveredFieldIds: string[];
  coveredActionIds: string[];
  coveredValidationIds: string[];
  coveredNavigationIds: string[];
  screenId: string;
  traceNodeId?: string;
  traceNodeName?: string;
  steps: GeneratedTestCase["steps"];
  expectedResults: string[];
  openQuestions?: string[];
  /**
   * Optional test-data oracle output (#2071). When omitted, the case
   * is built with `testData: []` (pre-#2071 behaviour). When provided,
   * the synthesizer ships the oracle-resolved boundary values as
   * `testData[*]` strings; provenance is encoded inline so reviewers
   * see which validation rule each value derives from.
   */
  testData?: string[];
  audit: GeneratedTestCaseAuditMetadata;
}

const buildSyntheticCase = (
  input: BuildSyntheticCaseInput,
): GeneratedTestCase => {
  const id = `tc-${input.idSuffix}`;
  const level: TestCaseLevel = "system";
  const figmaTraceRefs: GeneratedTestCase["figmaTraceRefs"] = [
    {
      screenId: input.screenId,
      ...(input.traceNodeId !== undefined ? { nodeId: input.traceNodeId } : {}),
      ...(input.traceNodeName !== undefined
        ? { nodeName: input.traceNodeName }
        : {}),
    },
  ];
  const classification = deriveGeneratedTestCaseClassification({
    type: input.type,
    title: input.title,
    objective: input.objective,
    expectedResults: input.expectedResults,
    steps: input.steps,
  });
  return {
    id,
    sourceJobId: input.audit.jobId,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    title: input.title,
    objective: input.objective,
    level,
    type: input.type,
    polarity: classification.polarity,
    category: classification.category,
    priority: input.priority,
    riskCategory: input.riskCategory,
    technique: input.technique,
    preconditions: [],
    testData: input.testData?.slice() ?? [],
    steps: input.steps,
    expectedResults: input.expectedResults,
    figmaTraceRefs,
    assumptions: [],
    openQuestions: input.openQuestions?.slice() ?? [],
    qcMappingPreview: {
      decisionBasis: "mapping_preview_only",
      exportable: true,
    },
    qualitySignals: {
      coveredFieldIds: input.coveredFieldIds.slice().sort(),
      coveredActionIds: input.coveredActionIds.slice().sort(),
      coveredValidationIds: input.coveredValidationIds.slice().sort(),
      coveredNavigationIds: input.coveredNavigationIds.slice().sort(),
      confidence: 0.9,
    },
    reviewState: "auto_approved",
    audit: input.audit,
  };
};

const buildAuditMetadata = (input: {
  jobId: string;
  generatedAt: string;
  cacheKeyDigest: string;
  inputHash: string;
  promptHash: string;
  schemaHash: string;
}): GeneratedTestCaseAuditMetadata => ({
  jobId: input.jobId,
  generatedAt: input.generatedAt,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  redactionPolicyVersion: REDACTION_POLICY_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  cacheHit: false,
  cacheKey: input.cacheKeyDigest,
  inputHash: input.inputHash,
  promptHash: input.promptHash,
  schemaHash: input.schemaHash,
});

const buildHarnessFaithfulnessVerdict = (input: {
  jobId: string;
  generatedAt: string;
  cacheKeyDigest: string;
  list: GeneratedTestCaseList;
  deployment: string;
  modelRevision: string;
  gatewayRelease: string;
  fallbackReason: VisualSidecarFallbackReason;
}): FaithfulnessVerdict => {
  const stepVerdicts: FaithfulnessStepVerdict[] = [];
  for (const testCase of input.list.testCases) {
    for (const step of testCase.steps) {
      stepVerdicts.push({
        testCaseId: testCase.id,
        stepIndex: step.index,
        verdict: "match",
        message: "Deterministic Wave 1 harness fixture matched the visual evidence.",
      });
    }
  }
  return {
    schemaVersion: FAITHFULNESS_VERDICT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    promptTemplateVersion: FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    cacheHit: false,
    cacheKeyDigest: input.cacheKeyDigest,
    modelDeployment: input.deployment,
    modelRevision: input.modelRevision,
    gatewayRelease: input.gatewayRelease,
    fallbackReason: input.fallbackReason,
    score: 1,
    verdict: "accept",
    hallucinations: [],
    mismatches: [],
    stepVerdicts,
  };
};

const buildUnresolvedValidationQuestionsForField = (input: {
  fieldLabel: string;
  validationRules: readonly string[];
}): string[] => {
  const unresolvedRules = input.validationRules.filter((rule) =>
    isUnresolvedValidationText(rule),
  );
  if (unresolvedRules.length === 0) return [];
  return [
    `Validation rules for "${input.fieldLabel}" are unresolved in the source and must be clarified before exact error text, thresholds, or boundary behavior can be asserted.`,
    ...unresolvedRules.map((rule) => `Source statement: ${rule}`),
  ];
};

/** Run a single Wave 1 Validation fixture end-to-end. */
export const runWave1Validation = async (
  input: RunWave1ValidationInput,
): Promise<Wave1ValidationRunResult> => {
  await mkdir(input.runDir, { recursive: true });

  // FinOps recorder (Issue #1371). Aggregates per-role usage and produces a
  // budget-report.json artifact at the end of the run, regardless of whether
  // the operator supplied a budget envelope. The default envelope is
  // permissive so absence of an envelope cannot accidentally trigger a
  // breach.
  const finopsRecorder = createFinOpsUsageRecorder(input.finopsCostRates);
  const finopsBudget = input.finopsBudget ?? DEFAULT_FINOPS_BUDGET_ENVELOPE;
  const finopsBudgetValidation = validateFinOpsBudgetEnvelope(finopsBudget);
  if (!finopsBudgetValidation.valid) {
    throw new RangeError(
      `runWave1Validation: invalid FinOps budget envelope (${finopsBudgetValidation.errors.map((e) => `${e.path}: ${e.message}`).join("; ")})`,
    );
  }
  let finopsTerminalOutcome: FinOpsJobOutcome | undefined;

  // 1. Load fixture.
  const fixture = await loadWave1ValidationFixture(input.fixtureId);

  // 1b. Optional: run multimodal visual sidecar. When `visualCaptures` is
  //     supplied along with a `bundle`, the harness asks the visual
  //     sidecar client for `VisualScreenDescription[]` instead of using
  //     the fixture's pre-baked sidecar JSON. The captures are decoded
  //     in-memory only — only their SHA-256 identities reach disk.
  let sidecarVisual: VisualScreenDescription[] | undefined;
  let sidecarResult: VisualSidecarResult | undefined;
  let sidecarArtifactBytes: Uint8Array | undefined;
  let sidecarDiagnostics: ReadonlyArray<DescribeVisualScreensDiagnostic> = [];
  if (input.visualCaptures !== undefined && input.visualCaptures.length > 0) {
    if (input.bundle === undefined) {
      throw new RangeError(
        "runWave1Validation: visualCaptures requires bundle (an LlmGatewayClientBundle) to route the multimodal request",
      );
    }
    if (input.bundle.testGeneration.declaredCapabilities.imageInputSupport) {
      throw new RangeError(
        "runWave1Validation: bundle.testGeneration must not declare imageInputSupport=true",
      );
    }
    // The intent built from Figma alone is enough for the sidecar gate
    // to detect screen-id conflicts; the harness re-derives intent below
    // with the sidecar's visual array as the authoritative observation.
    const intentForSidecar = deriveBusinessTestIntentIr({
      figma: fixture.figma,
    });
    const sidecarRun = await describeVisualScreens({
      bundle: input.bundle,
      captures: input.visualCaptures,
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      intent: intentForSidecar,
      primaryDeployment: VISUAL_PRIMARY_DEPLOYMENT,
      requestLimits: {
        visualPrimary: resolveFinOpsRequestLimits(
          finopsBudget.roles.visual_primary,
        ),
        visualFallback: resolveFinOpsRequestLimits(
          finopsBudget.roles.visual_fallback,
        ),
      },
      maxImageBytesPerRequest: {
        ...(finopsBudget.roles.visual_primary?.maxImageBytesPerRequest !==
        undefined
          ? {
              visualPrimary:
                finopsBudget.roles.visual_primary.maxImageBytesPerRequest,
            }
          : {}),
        ...(finopsBudget.roles.visual_fallback?.maxImageBytesPerRequest !==
        undefined
          ? {
              visualFallback:
                finopsBudget.roles.visual_fallback.maxImageBytesPerRequest,
            }
          : {}),
      },
    });
    sidecarResult = sidecarRun.result;
    sidecarDiagnostics = sidecarRun.diagnostics;
    const sidecarArtifactPath = join(
      input.runDir,
      VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
    );
    const written = await writeVisualSidecarResultArtifact({
      result: sidecarResult,
      destinationPath: sidecarArtifactPath,
      jobId: input.jobId,
      generatedAt: input.generatedAt,
    });
    sidecarArtifactBytes = written.bytes;
    // Issue #2017: persist per-attempt raw-response diagnostics next to
    // the visual sidecar result so the harness's evidence manifest can
    // reference them by relative filename.
    for (const diagnostic of sidecarDiagnostics) {
      const diagnosticPath = join(input.runDir, diagnostic.filename);
      await mkdir(dirname(diagnosticPath), { recursive: true });
      await writeAtomic(diagnosticPath, diagnostic.bytes);
    }
    recordVisualSidecarAttempts({
      recorder: finopsRecorder,
      attempts: sidecarResult.attempts,
      captureIdentities: sidecarResult.captureIdentities,
    });
    if (sidecarResult.outcome === "success") {
      await assertFinOpsBudgetOpen({
        recorder: finopsRecorder,
        budget: finopsBudget,
        jobId: input.jobId,
        generatedAt: input.generatedAt,
        runDir: input.runDir,
        ...(input.finopsCostRates !== undefined
          ? { costRates: input.finopsCostRates }
          : {}),
      });
      sidecarVisual = sidecarResult.visual;
    } else {
      if (isFinOpsBudgetSidecarFailure(sidecarResult)) {
        recordVisualImageBudgetBreach({
          recorder: finopsRecorder,
          budget: finopsBudget,
          sidecar: sidecarResult,
        });
      }
      finopsTerminalOutcome = isFinOpsBudgetSidecarFailure(sidecarResult)
        ? "budget_exceeded"
        : "visual_sidecar_failed";
      const finopsFailureWritten = await writeFinOpsBudgetReportForFailure({
        recorder: finopsRecorder,
        budget: finopsBudget,
        jobId: input.jobId,
        generatedAt: input.generatedAt,
        runDir: input.runDir,
        outcome: finopsTerminalOutcome,
        ...(input.finopsCostRates !== undefined
          ? { costRates: input.finopsCostRates }
          : {}),
      });
      await writeVisualSidecarFailureEvidenceManifest({
        fixtureId: input.fixtureId,
        jobId: input.jobId,
        generatedAt: input.generatedAt,
        runDir: input.runDir,
        bundle: input.bundle,
        intent: intentForSidecar,
        sidecarResult,
        sidecarArtifactBytes,
        sidecarDiagnostics,
        finopsReportBytes: finopsFailureWritten.bytes,
        policyProfile: input.policyProfile ?? cloneEuBankingDefaultProfile(),
      });
      throw new Wave1ValidationVisualSidecarFailureError({
        visualSidecar: sidecarResult,
        artifactPath: sidecarArtifactPath,
      });
    }
  }

  // 2. Derive Business Test Intent IR. (Step 3 — PII redaction — happens
  //    inside derivation; the harness later asserts the absence of raw
  //    PII substrings in persisted artifacts via tests.)
  const visualForDerivation = sidecarVisual ?? fixture.visual;
  const intent = deriveBusinessTestIntentIr({
    figma: fixture.figma,
    visual: visualForDerivation,
  });

  // 4. Compile prompt.
  const visualBindingDeployment =
    sidecarResult?.outcome === "success"
      ? sidecarResult.selectedDeployment
      : VISUAL_PRIMARY_DEPLOYMENT;
  const visualBindingFallbackReason =
    sidecarResult?.outcome === "success"
      ? sidecarResult.fallbackReason
      : "none";
  const compiled = compilePrompt({
    jobId: input.jobId,
    intent,
    visual: visualForDerivation,
    modelBinding: {
      modelRevision: TEST_GENERATION_MODEL_REVISION,
      gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
    },
    policyBundleVersion: POLICY_BUNDLE_VERSION,
    visualBinding: {
      schemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
      selectedDeployment: visualBindingDeployment,
      fallbackReason: visualBindingFallbackReason,
      screenCount: visualForDerivation.length,
      ...(fixture.visualImageSha256 !== undefined
        ? { fixtureImageHash: fixture.visualImageSha256 }
        : {}),
    },
  });

  // Build the audit stamp the synthesised list will carry on every case.
  const audit = buildAuditMetadata({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    cacheKeyDigest: compiled.request.hashes.cacheKey,
    inputHash: compiled.request.hashes.inputHash,
    promptHash: compiled.request.hashes.promptHash,
    schemaHash: compiled.request.hashes.schemaHash,
  });
  const activeModelBindings = buildActiveModelBindings(input.bundle);

  const expectedList = synthesizeGeneratedTestCases({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    intent,
    audit,
  });

  // 5. Issue the request through a deterministic mock LLM. The
  //    responder hands back the already-synthesised list as the
  //    structured-output `content`. The mock client rejects image
  //    payloads at runtime via its image-payload guard; the harness
  //    additionally asserts after the call that NO image inputs were
  //    seen (the structured generator must never receive images).
  const mockClient = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: TEST_GENERATION_DEPLOYMENT,
    modelRevision: TEST_GENERATION_MODEL_REVISION,
    gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
    responder: (
      _request: LlmGenerationRequest,
      attempt: number,
    ): LlmGenerationResult => ({
      outcome: "success",
      content: expectedList,
      finishReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
      modelDeployment: TEST_GENERATION_DEPLOYMENT,
      modelRevision: TEST_GENERATION_MODEL_REVISION,
      gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
      attempt,
    }),
  });

  const generationRequest: LlmGenerationRequest = {
    jobId: compiled.request.jobId,
    systemPrompt: compiled.request.systemPrompt,
    userPrompt: compiled.request.userPrompt,
    responseSchema: compiled.request.responseSchema,
    responseSchemaName: compiled.request.responseSchemaName,
    ...resolveFinOpsRequestLimits(finopsBudget.roles.test_generation),
  };
  const generateTestCases = async (): Promise<GeneratedTestCaseList> => {
    const result = await mockClient.generate(generationRequest);
    if (isFinOpsBudgetGatewayFailure(result)) {
      recordGatewayBudgetBreach({
        recorder: finopsRecorder,
        result,
        role: "test_generation",
      });
      await assertFinOpsBudgetOpen({
        recorder: finopsRecorder,
        budget: finopsBudget,
        jobId: input.jobId,
        generatedAt: input.generatedAt,
        runDir: input.runDir,
        ...(input.finopsCostRates !== undefined
          ? { costRates: input.finopsCostRates }
          : {}),
      });
    }
    // Record the test_generation attempt deterministically. The mock client
    // returns immediately with `usage: {0, 0}`; recording `durationMs: 0`
    // keeps the FinOps report byte-stable. `liveSmoke: false` because the
    // harness always uses the mock client for the structured generator.
    finopsRecorder.recordAttempt({
      role: "test_generation",
      source: "generator",
      deployment: TEST_GENERATION_DEPLOYMENT,
      durationMs: 0,
      result,
      liveSmoke: false,
      fallback: false,
    });
    if (result.outcome !== "success") {
      finopsTerminalOutcome = "gateway_failed";
      await writeFinOpsBudgetReportForFailure({
        recorder: finopsRecorder,
        budget: finopsBudget,
        jobId: input.jobId,
        generatedAt: input.generatedAt,
        runDir: input.runDir,
        outcome: finopsTerminalOutcome,
        ...(input.finopsCostRates !== undefined
          ? { costRates: input.finopsCostRates }
          : {}),
      });
      throw new Error(
        `runWave1Validation: mock LLM returned a failure (${result.errorClass}: ${result.message})`,
      );
    }
    await assertFinOpsBudgetOpen({
      recorder: finopsRecorder,
      budget: finopsBudget,
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      runDir: input.runDir,
      ...(input.finopsCostRates !== undefined
        ? { costRates: input.finopsCostRates }
        : {}),
    });
    return result.content as GeneratedTestCaseList;
  };

  const cacheResult =
    input.replayCache !== undefined
      ? await executeWithReplayCache({
          cache: input.replayCache,
          cacheKey: compiled.cacheKey,
          generate: async () => {
            finopsRecorder.recordCacheMiss({ role: "test_generation" });
            return generateTestCases();
          },
        })
      : undefined;
  if (cacheResult?.cacheHit === true) {
    finopsRecorder.recordCacheHit({
      role: "test_generation",
      source: "generator",
      deployment: TEST_GENERATION_DEPLOYMENT,
    });
  }

  // 6. Parse / accept the structured output. The mock returns the
  //    already-typed list; in a live setting the gateway wire format
  //    would be JSON we would re-parse here.
  const generatedList = cacheResult?.testCases ?? (await generateTestCases());

  // Defence-in-depth: confirm the recorded request the mock saw did
  // not carry image inputs. The mock strips bytes during recording, but
  // it preserves shape — `recordedRequests()[0].imageInputs` would be a
  // non-empty array if the caller had attached images. The same
  // assertion runs against the supplied bundle's testGeneration client
  // when one is available, so the live-gateway path is also covered.
  const recordedRequests = mockClient.recordedRequests();
  for (const request of recordedRequests) {
    if (request.imageInputs !== undefined && request.imageInputs.length > 0) {
      throw new Error(
        "runWave1Validation: the test_generation gateway must never receive image payloads",
      );
    }
  }
  if (input.bundle !== undefined) {
    const bundleRecords = extractRecordedRequests(input.bundle);
    if (bundleRecords !== undefined) {
      assertNoImagePayloadToTestGeneration({
        bundle: input.bundle,
        recordedRequests: bundleRecords,
      });
    }
  }

  const gatewayRequestAudit: GatewayRequestAuditArtifact = {
    schemaVersion: "1.0.0",
    jobId: input.jobId,
    role: "test_generation",
    deployment: TEST_GENERATION_DEPLOYMENT,
    modelRevision: TEST_GENERATION_MODEL_REVISION,
    gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
    requestCount: recordedRequests.length,
    imageInputCounts: recordedRequests.map(
      (request) => request.imageInputs?.length ?? 0,
    ),
    imagePayloadSent: false,
    promptHash: compiled.request.hashes.promptHash,
    schemaHash: compiled.request.hashes.schemaHash,
    inputHash: compiled.request.hashes.inputHash,
    cacheKeyDigest: compiled.request.hashes.cacheKey,
  };

  const intentBytes = utf8(canonicalJson(intent));
  const compiledPromptBytes = utf8(canonicalJson(compiled.artifacts));
  const gatewayRequestAuditBytes = utf8(canonicalJson(gatewayRequestAudit));
  const agentRoleRunPromise = writeAgentRoleRunArtifact({
    runDir: input.runDir,
    jobId: input.jobId,
    roleRunId: "test_generation",
    roleStepId: "test_generation",
    roleLineageDepth: 0,
    hashes: compiled.request.hashes,
  });
  await Promise.all([
    writeAtomic(
      join(input.runDir, BUSINESS_INTENT_IR_ARTIFACT_FILENAME),
      intentBytes,
    ),
    writeAtomic(
      join(input.runDir, COMPILED_PROMPT_ARTIFACT_FILENAME),
      compiledPromptBytes,
    ),
    writeAtomic(
      join(input.runDir, GATEWAY_REQUEST_AUDIT_ARTIFACT_FILENAME),
      gatewayRequestAuditBytes,
    ),
    agentRoleRunPromise.then(() => undefined),
  ]);
  const agentRoleRunArtifact = await agentRoleRunPromise;

  // 7. Validation pipeline + persist its artifacts. When the opt-in
  //    self-verify rubric pass (Issue #1379) is enabled the harness
  //    threads the rubric pass through the validation pipeline; when
  //    omitted the synchronous pre-#1379 pipeline runs unchanged.
  const profile = input.policyProfile ?? cloneEuBankingDefaultProfile();
  const faithfulnessVerdict =
    visualForDerivation.length > 0
      ? buildHarnessFaithfulnessVerdict({
          jobId: input.jobId,
          generatedAt: input.generatedAt,
          cacheKeyDigest: compiled.request.hashes.cacheKey,
          list: generatedList,
          deployment: visualBindingDeployment,
          modelRevision: `${visualBindingDeployment}@wave1-validation-mock`,
          gatewayRelease: POLICY_BUNDLE_VERSION,
          fallbackReason: visualBindingFallbackReason,
        })
      : undefined;
  let validation: ValidationPipelineArtifacts;
  if (input.selfVerifyRubric?.enabled === true) {
    const expectedRubricIds = generatedList.testCases.map((c) => c.id);
    const rubricVisualPresent = visualForDerivation.length > 0;
    const rubricClient =
      input.selfVerifyRubric.client ??
      buildWave1ValidationRubricMockClient({
        expectedTestCaseIds: expectedRubricIds,
        visualPresent: rubricVisualPresent,
        ...(input.selfVerifyRubric.mockResponder !== undefined
          ? { responder: input.selfVerifyRubric.mockResponder }
          : {}),
      });
    if (rubricClient.role !== "test_generation") {
      throw new RangeError(
        "runWave1Validation: selfVerifyRubric.client must declare role test_generation",
      );
    }
    validation = await runValidationPipelineWithSelfVerify({
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      list: generatedList,
      intent,
      visual: visualForDerivation,
      profile,
      primaryVisualDeployment: VISUAL_PRIMARY_DEPLOYMENT,
      ...(faithfulnessVerdict !== undefined ? { faithfulnessVerdict } : {}),
      selfVerify: {
        enabled: true,
        client: rubricClient,
        modelBinding: {
          deployment: rubricClient.deployment,
          modelRevision: rubricClient.modelRevision,
          gatewayRelease: rubricClient.gatewayRelease,
        },
        policyBundleVersion: POLICY_BUNDLE_VERSION,
        ...(input.selfVerifyRubric.cache !== undefined
          ? { cache: input.selfVerifyRubric.cache }
          : {}),
        ...(input.selfVerifyRubric.maxOutputTokens !== undefined
          ? { maxOutputTokens: input.selfVerifyRubric.maxOutputTokens }
          : {}),
        ...(input.selfVerifyRubric.maxWallClockMs !== undefined
          ? { maxWallClockMs: input.selfVerifyRubric.maxWallClockMs }
          : {}),
        ...(input.selfVerifyRubric.maxRetries !== undefined
          ? { maxRetries: input.selfVerifyRubric.maxRetries }
          : {}),
        ...(input.selfVerifyRubric.maxInputTokens !== undefined
          ? { maxInputTokens: input.selfVerifyRubric.maxInputTokens }
          : {}),
      },
      activeModelBindings,
    });
  } else {
    validation = runValidationPipeline({
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      list: generatedList,
      intent,
      visual: visualForDerivation,
      profile,
      primaryVisualDeployment: VISUAL_PRIMARY_DEPLOYMENT,
      ...(faithfulnessVerdict !== undefined ? { faithfulnessVerdict } : {}),
      activeModelBindings,
    });
  }
  const validationDir = input.runDir;
  // Serialize/persist directly so the harness controls the on-disk
  // byte stream that the manifest will later attest. We mirror what
  // `writeValidationPipelineArtifacts` does internally but keep the
  // bytes in memory so the manifest can hash them without re-reading.
  const generatedTestCasesBytes = utf8(
    canonicalJson(validation.generatedTestCases),
  );
  const validationReportBytes = utf8(canonicalJson(validation.validation));
  const policyReportBytes = utf8(canonicalJson(validation.policy));
  const coverageReportBytes = utf8(canonicalJson(validation.coverage));
  const testDataOracleReportBytes =
    validation.testDataOracleReport !== undefined
      ? utf8(canonicalJson(validation.testDataOracleReport))
      : undefined;
  const visualReportBytes =
    validation.visual !== undefined
      ? utf8(canonicalJson(validation.visual))
      : undefined;
  const rubricReportBytes =
    validation.rubric !== undefined
      ? utf8(canonicalJson(validation.rubric))
      : undefined;
  const rubricArtifactPath =
    rubricReportBytes !== undefined
      ? join(
          validationDir,
          SELF_VERIFY_RUBRIC_ARTIFACT_DIRECTORY,
          SELF_VERIFY_RUBRIC_REPORT_ARTIFACT_FILENAME,
        )
      : undefined;
  await Promise.all([
    writeAtomic(
      join(validationDir, GENERATED_TESTCASES_ARTIFACT_FILENAME),
      generatedTestCasesBytes,
    ),
    writeAtomic(
      join(validationDir, TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME),
      validationReportBytes,
    ),
    writeAtomic(
      join(validationDir, TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME),
      policyReportBytes,
    ),
    writeAtomic(
      join(validationDir, TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME),
      coverageReportBytes,
    ),
    ...(testDataOracleReportBytes !== undefined
      ? [
          writeAtomic(
            join(validationDir, TEST_DATA_ORACLE_REPORT_ARTIFACT_FILENAME),
            testDataOracleReportBytes,
          ),
        ]
      : []),
    ...(visualReportBytes !== undefined
      ? [
          writeAtomic(
            join(
              validationDir,
              VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
            ),
            visualReportBytes,
          ),
        ]
      : []),
    ...(rubricReportBytes !== undefined && rubricArtifactPath !== undefined
      ? [
          (async () => {
            await mkdir(dirname(rubricArtifactPath), { recursive: true });
            await writeAtomic(rubricArtifactPath, rubricReportBytes);
          })(),
        ]
      : []),
  ]);

  // 8. Seed review state and approve every case the policy did not
  //    BLOCK. Wave 1 Validation determinism requires byte-identical events,
  //    so the harness deliberately bypasses the file-system review
  //    store (whose `randomUUID()` event ids would defeat replay) and
  //    seeds + transitions in-memory using `transitionReviewState`.
  //    Event ids are derived from a stable hash of `(jobId, sequence)`
  //    so two runs of the same fixture produce identical event logs.
  const decisionsById = new Map<string, TestCasePolicyDecision>();
  for (const record of validation.policy.decisions) {
    decisionsById.set(record.testCaseId, record.decision);
  }
  const review = buildDeterministicReviewBundle({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: validation.generatedTestCases,
    decisionsById,
    ...(input.fourEyesPolicy ? { fourEyesPolicy: input.fourEyesPolicy } : {}),
    ...(validation.visual ? { visualReport: validation.visual } : {}),
  });
  const snapshot = review.snapshot;
  const reviewEventsBytes = utf8(canonicalJson(review.envelope));
  const reviewStateBytes = utf8(canonicalJson(snapshot));
  await writeAtomic(
    join(input.runDir, REVIEW_EVENTS_ARTIFACT_FILENAME),
    reviewEventsBytes,
  );
  await writeAtomic(
    join(input.runDir, REVIEW_STATE_ARTIFACT_FILENAME),
    reviewStateBytes,
  );

  // 9. Export pipeline. Persist directly into the run dir so every
  //    export artifact lands at the basename level the manifest attests.
  const exportProfile = cloneOpenTextAlmReferenceProfile();
  const exportRun = await runAndPersistExportPipeline({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    intent,
    list: validation.generatedTestCases,
    validation: validation.validation,
    policy: validation.policy,
    ...(validation.visual !== undefined ? { visual: validation.visual } : {}),
    reviewSnapshot: snapshot,
    profile: exportProfile,
    testGenerationDeployment: TEST_GENERATION_DEPLOYMENT,
    destinationDir: input.runDir,
  });
  // The export pipeline's `writeExportPipelineArtifacts` already wrote
  // every artifact byte stream atomically; collect their on-disk bytes
  // for the manifest below.
  const exportArtifactBytes = await collectExportBytes(
    input.runDir,
    exportRun.artifacts,
  );

  // 9b. Build + persist the FinOps budget report (Issue #1371). The
  //     report is byte-stable for the same recorder + budget input so it
  //     plugs cleanly into the manifest's SHA-256 attestation. We build
  //     it BEFORE the manifest so its bytes can be hashed in step 10.
  const finopsReport = buildFinOpsBudgetReport({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    budget: finopsBudget,
    recorder: finopsRecorder,
    ...(input.finopsCostRates !== undefined
      ? { costRates: input.finopsCostRates }
      : {}),
    ...(finopsTerminalOutcome !== undefined
      ? { outcomeOverride: finopsTerminalOutcome }
      : deriveFinopsOutcomeFromValidation(validation, exportRun.artifacts) !==
          undefined
        ? {
            outcomeOverride: deriveFinopsOutcomeFromValidation(
              validation,
              exportRun.artifacts,
            ) as FinOpsJobOutcome,
          }
        : {}),
  });
  const finopsWritten = await writeFinOpsBudgetReport({
    report: finopsReport,
    runDir: input.runDir,
  });

  // 9c. Build + persist the per-job LBOM (CycloneDX 1.6 ML-BOM, Issue
  //     #1378). The LBOM enumerates the model chain, the curated
  //     few-shot bundle, and the active policy profile that produced
  //     this job's structured test cases. The artifact is always emitted
  //     so the manifest entry is stable across fixture replays.
  const manifestVisualPrimary =
    input.bundle === undefined
      ? VISUAL_PRIMARY_DEPLOYMENT
      : toManifestVisualDeployment(input.bundle.visualPrimary.deployment);
  const manifestVisualFallback =
    input.bundle === undefined
      ? undefined
      : toManifestVisualDeployment(input.bundle.visualFallback.deployment);
  const lbomVisualModelBindings =
    input.bundle === undefined
      ? undefined
      : {
          visual_primary: {
            modelRevision: input.bundle.visualPrimary.modelRevision,
            gatewayRelease: input.bundle.visualPrimary.gatewayRelease,
            compatibilityMode: input.bundle.visualPrimary.compatibilityMode,
            licenseStatus: "unknown",
          },
          visual_fallback: {
            modelRevision: input.bundle.visualFallback.modelRevision,
            gatewayRelease: input.bundle.visualFallback.gatewayRelease,
            compatibilityMode: input.bundle.visualFallback.compatibilityMode,
            licenseStatus: "unknown",
          },
        };
  const lbomWeightsSha256 =
    input.bundle === undefined
      ? undefined
      : {
          ...(input.bundle.visualPrimary.modelWeightsSha256 !== undefined
            ? {
                visual_primary: input.bundle.visualPrimary.modelWeightsSha256,
              }
            : {}),
          ...(input.bundle.visualFallback.modelWeightsSha256 !== undefined
            ? {
                visual_fallback: input.bundle.visualFallback.modelWeightsSha256,
              }
            : {}),
        };
  const lbomDocument = buildLbomDocument({
    fixtureId: input.fixtureId,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    modelDeployments: {
      testGeneration: TEST_GENERATION_DEPLOYMENT,
      visualPrimary: manifestVisualPrimary,
      ...(manifestVisualFallback !== undefined
        ? { visualFallback: manifestVisualFallback }
        : { visualFallback: VISUAL_FALLBACK_DEPLOYMENT }),
    },
    policyProfile: profile,
    exportProfile: { id: exportProfile.id, version: exportProfile.version },
    hashes: {
      promptHash: compiled.request.hashes.promptHash,
      schemaHash: compiled.request.hashes.schemaHash,
      inputHash: compiled.request.hashes.inputHash,
      cacheKeyDigest: compiled.request.hashes.cacheKey,
    },
    testGenerationBinding: {
      modelRevision: TEST_GENERATION_MODEL_REVISION,
      gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
      compatibilityMode: "openai_chat",
      licenseStatus: "unknown",
    },
    ...(lbomVisualModelBindings !== undefined
      ? { visualModelBindings: lbomVisualModelBindings }
      : {}),
    ...(lbomWeightsSha256 !== undefined
      ? { weightsSha256: lbomWeightsSha256 }
      : {}),
    ...(sidecarResult !== undefined ? { visualSidecar: sidecarResult } : {}),
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
  });
  const lbomValidation = validateLbomDocument(lbomDocument);
  if (!lbomValidation.valid) {
    const summary = lbomValidation.issues
      .slice(0, 5)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `runWave1Validation: refusing to persist invalid LBOM (${summary})`,
    );
  }
  const lbomWritten = await writeLbomArtifact({
    document: lbomDocument,
    runDir: input.runDir,
  });
  const lbomSummary = summarizeLbomArtifact({
    document: lbomDocument,
    bytes: lbomWritten.bytes,
  });
  const mlBomDocument = buildMlBomDocument({
    generatedAt: input.generatedAt,
    signingMode: input.attestationSigningMode ?? "unsigned",
    policyProfile: profile,
    modelBindings: buildMlBomModelBindings(input.bundle),
  });
  const mlBomValidation = validateMlBomDocument(mlBomDocument);
  if (!mlBomValidation.valid) {
    const summary = mlBomValidation.issues
      .slice(0, 5)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `runWave1Validation: refusing to persist invalid release ML-BOM (${summary})`,
    );
  }
  const mlBomWritten = await writeMlBomArtifact({
    document: mlBomDocument,
    runDir: input.runDir,
  });
  const mlBomSummary = summarizeMlBomArtifact({
    document: mlBomDocument,
    bytes: mlBomWritten.bytes,
  });
  const genealogyWritten = await writeGenealogyArtifact({
    runDir: input.runDir,
    generatedAt: input.generatedAt,
    nodes: [
      {
        jobId: input.jobId,
        roleStepId: "test_generation",
        artifactFilename: "agent-role-runs/test_generation.json",
        roleLineageDepth: 0,
      },
    ],
  });

  // 10. Build evidence manifest. The manifest records the on-disk
  //     bytes for every artifact emitted above.
  const visualSidecarSummary =
    sidecarResult?.outcome === "success" && sidecarArtifactBytes !== undefined
      ? {
          selectedDeployment: sidecarResult.selectedDeployment,
          fallbackReason: sidecarResult.fallbackReason,
          confidenceSummary: sidecarResult.confidenceSummary,
          resultArtifactSha256: sha256OfBytes(sidecarArtifactBytes),
        }
      : undefined;
  const manifest = buildWave1ValidationEvidenceManifest({
    fixtureId: input.fixtureId,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    modelDeployments: {
      testGeneration: TEST_GENERATION_DEPLOYMENT,
      visualPrimary: manifestVisualPrimary,
      ...(manifestVisualFallback !== undefined
        ? { visualFallback: manifestVisualFallback }
        : {}),
    },
    policyProfileId: profile.id,
    policyProfileVersion: profile.version,
    exportProfileId: exportProfile.id,
    exportProfileVersion: exportProfile.version,
    activeModelBindings,
    promptHash: compiled.request.hashes.promptHash,
    schemaHash: compiled.request.hashes.schemaHash,
    inputHash: compiled.request.hashes.inputHash,
    cacheKeyDigest: compiled.request.hashes.cacheKey,
    ...(visualSidecarSummary !== undefined
      ? { visualSidecar: visualSidecarSummary }
      : {}),
    ...(sidecarResult !== undefined
      ? {
          visualSidecarCaptureIdentities: sidecarResult.captureIdentities,
        }
      : {}),
    artifacts: [
      {
        filename: BUSINESS_INTENT_IR_ARTIFACT_FILENAME,
        bytes: intentBytes,
        category: "intent",
      },
      {
        filename: COMPILED_PROMPT_ARTIFACT_FILENAME,
        bytes: compiledPromptBytes,
        category: "intent",
      },
      {
        filename: GATEWAY_REQUEST_AUDIT_ARTIFACT_FILENAME,
        bytes: gatewayRequestAuditBytes,
        category: "manifest",
      },
      {
        filename: "agent-role-runs/test_generation.json",
        bytes: agentRoleRunArtifact.bytes,
        category: "manifest",
      },
      {
        filename: GENERATED_TESTCASES_ARTIFACT_FILENAME,
        bytes: generatedTestCasesBytes,
        category: "validation",
      },
      {
        filename: TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
        bytes: validationReportBytes,
        category: "validation",
      },
      {
        filename: TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
        bytes: policyReportBytes,
        category: "validation",
      },
      {
        filename: TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
        bytes: coverageReportBytes,
        category: "validation",
      },
      ...(testDataOracleReportBytes !== undefined
        ? [
            {
              filename: TEST_DATA_ORACLE_REPORT_ARTIFACT_FILENAME,
              bytes: testDataOracleReportBytes,
              category: "validation" as const,
            },
          ]
        : []),
      ...(visualReportBytes !== undefined
        ? [
            {
              filename: VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
              bytes: visualReportBytes,
              category: "validation" as const,
            },
          ]
        : []),
      ...(sidecarArtifactBytes !== undefined
        ? [
            {
              filename: VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
              bytes: sidecarArtifactBytes,
              category: "visual_sidecar" as const,
            },
          ]
        : []),
      // Issue #2017: per-attempt raw-response diagnostics, when present.
      ...sidecarDiagnostics.map((diagnostic) => ({
        filename: diagnostic.filename,
        bytes: diagnostic.bytes,
        category: "visual_sidecar" as const,
      })),
      {
        filename: REVIEW_EVENTS_ARTIFACT_FILENAME,
        bytes: reviewEventsBytes,
        category: "review",
      },
      {
        filename: REVIEW_STATE_ARTIFACT_FILENAME,
        bytes: reviewStateBytes,
        category: "review",
      },
      ...exportArtifactBytes,
      {
        filename: `${FINOPS_ARTIFACT_DIRECTORY}/${FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME}`,
        bytes: finopsWritten.bytes,
        category: "finops",
      },
      {
        filename: `${LBOM_ARTIFACT_DIRECTORY}/${LBOM_ARTIFACT_FILENAME}`,
        bytes: lbomWritten.bytes,
        category: "lbom",
      },
      {
        filename: `${ML_BOM_ARTIFACT_DIRECTORY}/${ML_BOM_ARTIFACT_FILENAME}`,
        bytes: mlBomWritten.bytes,
        category: "ml_bom",
      },
      {
        filename: "genealogy.json",
        bytes: genealogyWritten.bytes,
        category: "genealogy",
      },
      ...(rubricReportBytes !== undefined
        ? [
            {
              filename: `${SELF_VERIFY_RUBRIC_ARTIFACT_DIRECTORY}/${SELF_VERIFY_RUBRIC_REPORT_ARTIFACT_FILENAME}`,
              bytes: rubricReportBytes,
              category: "self_verify_rubric" as const,
            },
          ]
        : []),
    ],
  });
  await writeWave1ValidationEvidenceManifest({
    manifest,
    destinationDir: input.runDir,
  });

  const attestationSigningMode: Wave1ValidationAttestationSigningMode =
    input.attestationSigningMode ?? "unsigned";
  if (
    attestationSigningMode === "sigstore" &&
    input.attestationSigner === undefined
  ) {
    throw new Error(
      'runWave1Validation: attestationSigningMode="sigstore" requires an attestationSigner',
    );
  }
  if (
    attestationSigningMode === "unsigned" &&
    input.attestationSigner !== undefined
  ) {
    throw new Error(
      'runWave1Validation: attestationSigner must not be supplied when attestationSigningMode="unsigned"',
    );
  }
  const manifestSha256 = computeWave1ValidationEvidenceManifestDigest(manifest);
  const attestationStatement = buildWave1ValidationAttestationStatement({
    manifest,
    manifestSha256,
    bySourceHash: computePerSourceCostBreakdownHashFromReport(finopsReport),
    signingMode: attestationSigningMode,
  });
  let attestationEnvelope;
  let attestationBundle;
  let signerReference: string | undefined;
  if (attestationSigningMode === "sigstore" && input.attestationSigner) {
    const signed = await buildSignedWave1ValidationAttestation({
      statement: attestationStatement,
      signer: input.attestationSigner,
    });
    attestationEnvelope = signed.envelope;
    attestationBundle = signed.bundle;
    signerReference = input.attestationSigner.signerReference;
  } else {
    attestationEnvelope =
      buildUnsignedWave1ValidationAttestationEnvelope(attestationStatement);
  }
  const persistedAttestation = await persistWave1ValidationAttestation({
    envelope: attestationEnvelope,
    ...(attestationBundle !== undefined ? { bundle: attestationBundle } : {}),
    runDir: input.runDir,
  });
  // Reference the path lister so verifier-driven callers can stay in
  // sync with the harness layout without duplicating constants.
  void listWave1ValidationAttestationArtifactPaths(attestationSigningMode);
  const attestationSummary = summarizeWave1ValidationAttestation({
    signingMode: attestationSigningMode,
    ...(signerReference !== undefined ? { signerReference } : {}),
    persisted: persistedAttestation,
  });

  return {
    fixtureId: input.fixtureId,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    runDir: input.runDir,
    intent,
    visual: visualForDerivation,
    compiledPrompt: {
      request: compiled.request,
      artifacts: compiled.artifacts,
    },
    generatedList: validation.generatedTestCases,
    validation,
    reviewSnapshot: snapshot,
    exportArtifacts: exportRun.artifacts,
    manifest,
    artifactFilenames: manifest.artifacts.map((a) => a.filename),
    ...(sidecarResult !== undefined ? { visualSidecar: sidecarResult } : {}),
    finopsReport,
    finopsArtifactPath: finopsWritten.artifactPath,
    attestation: attestationSummary,
    lbom: lbomDocument,
    lbomSummary,
    lbomArtifactPath: lbomWritten.artifactPath,
    mlBom: mlBomDocument,
    mlBomSummary,
    mlBomArtifactPath: mlBomWritten.artifactPath,
    ...(validation.rubric !== undefined
      ? { selfVerifyRubric: validation.rubric }
      : {}),
    ...(rubricArtifactPath !== undefined
      ? { selfVerifyRubricArtifactPath: rubricArtifactPath }
      : {}),
  };
};

/**
 * Translate the per-attempt VisualSidecarAttempt records into FinOps
 * observations. Per-attempt durations are taken verbatim from the sidecar
 * client; they are deterministic when the caller passes a deterministic
 * `clock` to `describeVisualScreens` (the harness inherits whatever
 * timing source the client uses).
 */
const recordVisualSidecarAttempts = (input: {
  recorder: FinOpsUsageRecorder;
  attempts: ReadonlyArray<VisualSidecarAttempt>;
  captureIdentities: VisualSidecarResult["captureIdentities"];
}): void => {
  const imageBytes = input.captureIdentities.reduce(
    (sum, identity) => sum + identity.byteLength,
    0,
  );
  for (let i = 0; i < input.attempts.length; i += 1) {
    const attempt = input.attempts[i] as VisualSidecarAttempt;
    // Issue #1959: role is derived from the orchestration order — the
    // primary client is always called first, the fallback (if any)
    // second. The previous implementation gated on hardcoded deployment
    // literals (`mistral-document-ai-2512`, `phi-4-multimodal-instruct`,
    // `llama-4-maverick-vision`); after the visual-primary swap to an
    // operator-supplied id, that mapping mis-attributed live calls.
    const role: FinOpsRole = roleFromVisualDeployment(i === 0);
    const succeeded = attempt.errorClass === undefined;
    const result: LlmGenerationResult = succeeded
      ? {
          outcome: "success",
          content: null,
          finishReason: "stop",
          // Visual sidecars do not report token usage; track image bytes
          // separately and keep token counters at 0.
          usage: { inputTokens: 0, outputTokens: 0 },
          modelDeployment: attempt.deployment,
          modelRevision: attempt.deployment,
          gatewayRelease: attempt.deployment,
          attempt: attempt.attempt,
        }
      : {
          outcome: "error",
          errorClass: (attempt.errorClass ??
            "transport") as LlmGatewayErrorClass,
          message: "visual sidecar attempt failure (redacted by client)",
          retryable: false,
          attempt: attempt.attempt,
        };
    input.recorder.recordAttempt({
      role,
      source: role === "visual_primary" ? "visual_primary" : "visual_fallback",
      deployment: attempt.deployment,
      durationMs: attempt.durationMs,
      imageBytes,
      result,
      fallback: role === "visual_fallback",
      liveSmoke: attempt.deployment !== "mock",
    });
  }
};

const roleFromVisualDeployment = (isFirstAttempt: boolean): FinOpsRole =>
  isFirstAttempt ? "visual_primary" : "visual_fallback";

/**
 * Map validation/export pipeline outcomes onto FinOps job-outcome literals.
 * Returns `undefined` when nothing terminal happened (the job ran cleanly
 * to completion).
 */
const deriveFinopsOutcomeFromValidation = (
  validation: ValidationPipelineArtifacts,
  exportArtifacts: ExportPipelineArtifacts,
): FinOpsJobOutcome | undefined => {
  if (validation.visual !== undefined && validation.visual.blocked) {
    return "visual_sidecar_failed";
  }
  if (validation.policy.blocked) {
    return "policy_blocked";
  }
  if (validation.validation.blocked) {
    return "validation_blocked";
  }
  if (exportArtifacts.refused) {
    return "export_refused";
  }
  return undefined;
};

const isFinOpsBudgetGatewayFailure = (result: LlmGenerationResult): boolean => {
  if (result.outcome !== "error") return false;
  if (result.errorClass === "input_budget_exceeded") return true;
  return (
    result.errorClass === "schema_invalid" &&
    /max(InputTokens|OutputTokens|WallClockMs|Retries)/.test(result.message)
  );
};

const isFinOpsBudgetSidecarFailure = (
  result: VisualSidecarFailure,
): boolean => {
  return (
    result.failureClass === "image_payload_too_large" &&
    result.failureMessage.includes("FinOps")
  );
};

const recordVisualImageBudgetBreach = (input: {
  recorder: FinOpsUsageRecorder;
  budget: FinOpsBudgetEnvelope;
  sidecar: VisualSidecarFailure;
}): void => {
  const observed = input.sidecar.captureIdentities.reduce(
    (total, identity) => total + identity.byteLength,
    0,
  );
  for (const role of ["visual_primary", "visual_fallback"] as const) {
    const threshold = input.budget.roles[role]?.maxImageBytesPerRequest;
    if (threshold !== undefined && observed > threshold) {
      input.recorder.recordBudgetBreach({
        rule: "max_image_bytes",
        role,
        observed,
        threshold,
        message: `${role} decoded image bytes ${observed} exceeds maxImageBytesPerRequest ${threshold}`,
      });
      return;
    }
  }
};

const recordGatewayBudgetBreach = (input: {
  recorder: FinOpsUsageRecorder;
  result: LlmGenerationResult;
  role: FinOpsRole;
}): void => {
  if (input.result.outcome !== "error") return;
  const message = input.result.message;
  const inputMatch =
    /estimated input tokens (\d+) exceeds maxInputTokens (\d+)/.exec(message);
  if (inputMatch !== null) {
    input.recorder.recordBudgetBreach({
      rule: "max_input_tokens",
      role: input.role,
      observed: Number.parseInt(inputMatch[1] as string, 10),
      threshold: Number.parseInt(inputMatch[2] as string, 10),
      message,
    });
    return;
  }
  const outputMatch =
    /reported output tokens (\d+) exceeds maxOutputTokens (\d+)/.exec(message);
  if (outputMatch !== null) {
    input.recorder.recordBudgetBreach({
      rule: "max_output_tokens",
      role: input.role,
      observed: Number.parseInt(outputMatch[1] as string, 10),
      threshold: Number.parseInt(outputMatch[2] as string, 10),
      message,
    });
    return;
  }
  const wallClockMatch = /maxWallClockMs (\d+)ms/.exec(message);
  if (wallClockMatch !== null) {
    const threshold = Number.parseInt(wallClockMatch[1] as string, 10);
    input.recorder.recordBudgetBreach({
      rule: "max_wall_clock_ms",
      role: input.role,
      observed: threshold,
      threshold,
      message,
    });
  }
};

const assertFinOpsBudgetOpen = async (input: {
  recorder: FinOpsUsageRecorder;
  budget: FinOpsBudgetEnvelope;
  jobId: string;
  generatedAt: string;
  runDir: string;
  costRates?: FinOpsCostRateMap;
}): Promise<void> => {
  const report = buildFinOpsBudgetReport({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    budget: input.budget,
    recorder: input.recorder,
    ...(input.costRates !== undefined ? { costRates: input.costRates } : {}),
  });
  if (report.breaches.length === 0) return;
  const written = await writeFinOpsBudgetReport({
    report: { ...report, outcome: "budget_exceeded" },
    runDir: input.runDir,
  });
  throw new Wave1ValidationFinOpsBudgetExceededError({
    report: { ...report, outcome: "budget_exceeded" },
    artifactPath: written.artifactPath,
  });
};

/**
 * Persist a partial FinOps report when the harness aborts before reaching
 * the normal finalisation step (e.g. visual-sidecar failure or
 * test_generation gateway error). The artifact still lands at
 * `<runDir>/finops/budget-report.json` so an operator can read what was
 * recorded before the abort.
 */
const writeFinOpsBudgetReportForFailure = async (input: {
  recorder: FinOpsUsageRecorder;
  budget: FinOpsBudgetEnvelope;
  jobId: string;
  generatedAt: string;
  runDir: string;
  outcome: FinOpsJobOutcome;
  costRates?: FinOpsCostRateMap;
}): Promise<WriteFinOpsBudgetReportResult> => {
  const report = buildFinOpsBudgetReport({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    budget: input.budget,
    recorder: input.recorder,
    outcomeOverride: input.outcome,
    ...(input.costRates !== undefined ? { costRates: input.costRates } : {}),
  });
  return writeFinOpsBudgetReport({
    report,
    runDir: input.runDir,
  });
};

const collectExportBytes = async (
  exportDir: string,
  artifacts: ExportPipelineArtifacts,
): Promise<
  Array<{
    filename: string;
    bytes: Uint8Array;
    category: "dedupe_report" | "export" | "traceability_matrix";
  }>
> => {
  const out: Array<{
    filename: string;
    bytes: Uint8Array;
    category: "dedupe_report" | "export" | "traceability_matrix";
  }> = [];
  const reportPath = join(exportDir, EXPORT_REPORT_ARTIFACT_FILENAME);
  out.push({
    filename: EXPORT_REPORT_ARTIFACT_FILENAME,
    bytes: await readFile(reportPath),
    category: "export",
  });
  if (!artifacts.refused) {
    const candidates: Array<{
      filename: string;
      category: "dedupe_report" | "export" | "traceability_matrix";
    }> = [
      { filename: EXPORT_TESTCASES_JSON_ARTIFACT_FILENAME, category: "export" },
      { filename: EXPORT_TESTCASES_CSV_ARTIFACT_FILENAME, category: "export" },
      {
        filename: EXPORT_TESTCASES_ALM_XML_ARTIFACT_FILENAME,
        category: "export",
      },
      { filename: QC_MAPPING_PREVIEW_ARTIFACT_FILENAME, category: "export" },
      {
        filename: DEDUPE_REPORT_ARTIFACT_FILENAME,
        category: "dedupe_report",
      },
      {
        filename: TRACEABILITY_MATRIX_ARTIFACT_FILENAME,
        category: "traceability_matrix",
      },
    ];
    for (const { filename, category } of candidates) {
      const path = join(exportDir, filename);
      out.push({
        filename,
        bytes: await readFile(path),
        category,
      });
    }
  }
  return out;
};

// Issue #1692 (audit-2026-05 Wave 3): hoist a single `TextEncoder` to module
// scope so per-call `new TextEncoder()` allocations are eliminated. The
// pattern matches `qc-xlsx-writer.ts` and `export-pipeline.ts`.
const UTF8_ENCODER = new TextEncoder();
const utf8 = (value: string): Uint8Array => UTF8_ENCODER.encode(value);

const sha256OfBytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

type ManifestVisualDeployment = NonNullable<
  Wave1ValidationEvidenceManifest["modelDeployments"]["visualPrimary"]
>;

const toManifestVisualDeployment = (
  deployment: string,
): ManifestVisualDeployment => {
  switch (deployment) {
    case VISUAL_PRIMARY_DEPLOYMENT:
      return VISUAL_PRIMARY_DEPLOYMENT;
    case VISUAL_FALLBACK_DEPLOYMENT:
      return VISUAL_FALLBACK_DEPLOYMENT;
    default:
      return "mock";
  }
};

const buildMlBomModelBindings = (
  bundle?: LlmGatewayClientBundle,
): readonly [MlBomModelBinding, MlBomModelBinding, MlBomModelBinding] => [
  {
    role: "test_generation",
    deployment: bundle?.testGeneration.deployment ?? TEST_GENERATION_DEPLOYMENT,
    modelRevision:
      bundle?.testGeneration.modelRevision ?? TEST_GENERATION_MODEL_REVISION,
    gatewayRelease:
      bundle?.testGeneration.gatewayRelease ?? TEST_GENERATION_GATEWAY_RELEASE,
    operatorEndpointReference:
      bundle?.testGeneration.operatorEndpointReference ??
      `mock://${TEST_GENERATION_DEPLOYMENT}/[redacted]`,
    compatibilityMode:
      bundle?.testGeneration.compatibilityMode ?? "openai_chat",
    ...(bundle?.testGeneration.modelWeightsSha256 !== undefined
      ? {
          modelWeightsSha256: bundle.testGeneration.modelWeightsSha256,
        }
      : {}),
  },
  {
    role: "visual_primary",
    deployment: bundle?.visualPrimary.deployment ?? VISUAL_PRIMARY_DEPLOYMENT,
    modelRevision:
      bundle?.visualPrimary.modelRevision ??
      "llama-4-maverick-vision-2026-04-25",
    gatewayRelease:
      bundle?.visualPrimary.gatewayRelease ?? TEST_GENERATION_GATEWAY_RELEASE,
    operatorEndpointReference:
      bundle?.visualPrimary.operatorEndpointReference ??
      `mock://${VISUAL_PRIMARY_DEPLOYMENT}/[redacted]`,
    compatibilityMode:
      bundle?.visualPrimary.compatibilityMode ?? "openai_responses",
    ...(bundle?.visualPrimary.modelWeightsSha256 !== undefined
      ? {
          modelWeightsSha256: bundle.visualPrimary.modelWeightsSha256,
        }
      : {}),
  },
  {
    role: "visual_fallback",
    deployment: bundle?.visualFallback.deployment ?? VISUAL_FALLBACK_DEPLOYMENT,
    modelRevision:
      bundle?.visualFallback.modelRevision ??
      "phi-4-multimodal-instruct-2026-04-25",
    gatewayRelease:
      bundle?.visualFallback.gatewayRelease ?? TEST_GENERATION_GATEWAY_RELEASE,
    operatorEndpointReference:
      bundle?.visualFallback.operatorEndpointReference ??
      `mock://${VISUAL_FALLBACK_DEPLOYMENT}/[redacted]`,
    compatibilityMode:
      bundle?.visualFallback.compatibilityMode ?? "openai_responses",
    ...(bundle?.visualFallback.modelWeightsSha256 !== undefined
      ? {
          modelWeightsSha256: bundle.visualFallback.modelWeightsSha256,
        }
      : {}),
  },
];

const buildActiveModelBindings = (
  bundle?: LlmGatewayClientBundle,
): readonly [ActiveModelBinding, ActiveModelBinding, ActiveModelBinding] => [
  {
    providerId: "llm-gateway",
    modelId:
      bundle?.testGeneration.modelRevision ?? TEST_GENERATION_MODEL_REVISION,
    inferenceProfileId:
      bundle?.testGeneration.deployment ?? TEST_GENERATION_DEPLOYMENT,
    ictRegisterRef:
      bundle?.testGeneration.ictRegisterRef ??
      `mock-ict:${bundle?.testGeneration.deployment ?? TEST_GENERATION_DEPLOYMENT}`,
  },
  {
    providerId: "llm-gateway",
    modelId:
      bundle?.visualPrimary.modelRevision ??
      "llama-4-maverick-vision-2026-04-25",
    inferenceProfileId:
      bundle?.visualPrimary.deployment ?? VISUAL_PRIMARY_DEPLOYMENT,
    ictRegisterRef:
      bundle?.visualPrimary.ictRegisterRef ??
      `mock-ict:${bundle?.visualPrimary.deployment ?? VISUAL_PRIMARY_DEPLOYMENT}`,
  },
  {
    providerId: "llm-gateway",
    modelId:
      bundle?.visualFallback.modelRevision ??
      "phi-4-multimodal-instruct-2026-04-25",
    inferenceProfileId:
      bundle?.visualFallback.deployment ?? VISUAL_FALLBACK_DEPLOYMENT,
    ictRegisterRef:
      bundle?.visualFallback.ictRegisterRef ??
      `mock-ict:${bundle?.visualFallback.deployment ?? VISUAL_FALLBACK_DEPLOYMENT}`,
  },
];

const writeVisualSidecarFailureEvidenceManifest = async (input: {
  fixtureId: Wave1ValidationFixtureId;
  jobId: string;
  generatedAt: string;
  runDir: string;
  bundle: LlmGatewayClientBundle;
  intent: BusinessTestIntentIr;
  sidecarResult: VisualSidecarFailure;
  sidecarArtifactBytes: Uint8Array;
  /** Issue #2017: per-attempt raw-response diagnostics to weave into the manifest. */
  sidecarDiagnostics: ReadonlyArray<DescribeVisualScreensDiagnostic>;
  finopsReportBytes: Uint8Array;
  policyProfile: TestCasePolicyProfile;
}): Promise<void> => {
  const exportProfile = cloneOpenTextAlmReferenceProfile();
  const failureHash = (field: string): string =>
    sha256Hex({
      field,
      fixtureId: input.fixtureId,
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      intent: input.intent,
      visualSidecar: input.sidecarResult,
    });
  const failureHashes = {
    promptHash: failureHash("promptHash:not-generated"),
    schemaHash: failureHash("schemaHash:not-generated"),
    inputHash: failureHash("inputHash:visual-sidecar-failure"),
    cacheKeyDigest: failureHash("cacheKeyDigest:not-generated"),
  };
  // Issue #1378 — even on a refused run, emit a per-job LBOM so an
  // operator can audit the model chain that was attempted before the
  // sidecar exhaustion. The LBOM is built with failure-mode identity
  // hashes (the prompt was never compiled) and recorded under the same
  // `lbom/ai-bom.cdx.json` path the success path uses.
  const lbomDocument = buildLbomDocument({
    fixtureId: input.fixtureId,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    modelDeployments: {
      testGeneration: TEST_GENERATION_DEPLOYMENT,
      visualPrimary: toManifestVisualDeployment(
        input.bundle.visualPrimary.deployment,
      ),
      visualFallback: toManifestVisualDeployment(
        input.bundle.visualFallback.deployment,
      ),
    },
    policyProfile: input.policyProfile,
    exportProfile: { id: exportProfile.id, version: exportProfile.version },
    hashes: failureHashes,
    testGenerationBinding: {
      modelRevision: TEST_GENERATION_MODEL_REVISION,
      gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
      compatibilityMode: "openai_chat",
      licenseStatus: "unknown",
    },
    visualModelBindings: {
      visual_primary: {
        modelRevision: input.bundle.visualPrimary.modelRevision,
        gatewayRelease: input.bundle.visualPrimary.gatewayRelease,
        compatibilityMode: input.bundle.visualPrimary.compatibilityMode,
        licenseStatus: "unknown",
      },
      visual_fallback: {
        modelRevision: input.bundle.visualFallback.modelRevision,
        gatewayRelease: input.bundle.visualFallback.gatewayRelease,
        compatibilityMode: input.bundle.visualFallback.compatibilityMode,
        licenseStatus: "unknown",
      },
    },
    weightsSha256: {
      ...(input.bundle.visualPrimary.modelWeightsSha256 !== undefined
        ? { visual_primary: input.bundle.visualPrimary.modelWeightsSha256 }
        : {}),
      ...(input.bundle.visualFallback.modelWeightsSha256 !== undefined
        ? { visual_fallback: input.bundle.visualFallback.modelWeightsSha256 }
        : {}),
    },
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
  });
  const lbomValidation = validateLbomDocument(lbomDocument);
  if (!lbomValidation.valid) {
    const summary = lbomValidation.issues
      .slice(0, 5)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `runWave1Validation: refusing to persist invalid failure-mode LBOM (${summary})`,
    );
  }
  const lbomWritten = await writeLbomArtifact({
    document: lbomDocument,
    runDir: input.runDir,
  });
  const mlBomDocument = buildMlBomDocument({
    generatedAt: input.generatedAt,
    signingMode: "unsigned",
    policyProfile: input.policyProfile,
    modelBindings: buildMlBomModelBindings(input.bundle),
  });
  const mlBomValidation = validateMlBomDocument(mlBomDocument);
  if (!mlBomValidation.valid) {
    const summary = mlBomValidation.issues
      .slice(0, 5)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `runWave1Validation: refusing to persist invalid failure-mode release ML-BOM (${summary})`,
    );
  }
  const mlBomWritten = await writeMlBomArtifact({
    document: mlBomDocument,
    runDir: input.runDir,
  });
  const manifest = buildWave1ValidationEvidenceManifest({
    fixtureId: input.fixtureId,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    modelDeployments: {
      testGeneration: TEST_GENERATION_DEPLOYMENT,
      visualPrimary: toManifestVisualDeployment(
        input.bundle.visualPrimary.deployment,
      ),
      visualFallback: toManifestVisualDeployment(
        input.bundle.visualFallback.deployment,
      ),
    },
    policyProfileId: input.policyProfile.id,
    policyProfileVersion: input.policyProfile.version,
    exportProfileId: exportProfile.id,
    exportProfileVersion: exportProfile.version,
    activeModelBindings: buildActiveModelBindings(input.bundle),
    promptHash: failureHashes.promptHash,
    schemaHash: failureHashes.schemaHash,
    inputHash: failureHashes.inputHash,
    cacheKeyDigest: failureHashes.cacheKeyDigest,
    visualSidecarCaptureIdentities: input.sidecarResult.captureIdentities,
    artifacts: [
      {
        filename: VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
        bytes: input.sidecarArtifactBytes,
        category: "visual_sidecar",
      },
      // Issue #2017: per-attempt raw-response diagnostics, when present.
      ...input.sidecarDiagnostics.map((diagnostic) => ({
        filename: diagnostic.filename,
        bytes: diagnostic.bytes,
        category: "visual_sidecar" as const,
      })),
      {
        filename: `${FINOPS_ARTIFACT_DIRECTORY}/${FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME}`,
        bytes: input.finopsReportBytes,
        category: "finops",
      },
      {
        filename: `${LBOM_ARTIFACT_DIRECTORY}/${LBOM_ARTIFACT_FILENAME}`,
        bytes: lbomWritten.bytes,
        category: "lbom",
      },
      {
        filename: `${ML_BOM_ARTIFACT_DIRECTORY}/${ML_BOM_ARTIFACT_FILENAME}`,
        bytes: mlBomWritten.bytes,
        category: "ml_bom",
      },
    ],
  });
  await writeWave1ValidationEvidenceManifest({
    manifest,
    destinationDir: input.runDir,
  });
};

/**
 * Best-effort extraction of recorded requests from a bundle's
 * `testGeneration` client. Returns `undefined` for live gateway clients
 * which do not expose a recording surface — in that case the only
 * defence against image-payload leakage is the gateway's static
 * declaredCapabilities check (which the helper also performs).
 */
const extractRecordedRequests = (
  bundle: LlmGatewayClientBundle,
): ReadonlyArray<LlmGenerationRequest> | undefined => {
  const candidate =
    bundle.testGeneration as LlmGatewayClientBundle["testGeneration"] & {
      recordedRequests?: () => ReadonlyArray<LlmGenerationRequest>;
    };
  if (typeof candidate.recordedRequests === "function") {
    return candidate.recordedRequests();
  }
  return undefined;
};

const writeAtomic = async (
  destinationPath: string,
  bytes: Uint8Array,
): Promise<void> => {
  const tmp = `${destinationPath}.${process.pid}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, destinationPath);
};

/**
 * Persisted shape of `review-events.json` produced by the file-system
 * review store. Mirrored here so the harness can write a deterministic
 * envelope without depending on the store's `randomUUID()` source.
 */
interface PersistedReviewEventsEnvelope {
  schemaVersion: typeof REVIEW_GATE_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  jobId: string;
  events: ReviewEvent[];
  nextSequence: number;
}

interface DeterministicReviewBundle {
  envelope: PersistedReviewEventsEnvelope;
  snapshot: ReviewGateSnapshot;
}

const deterministicEventId = (
  jobId: string,
  testCaseId: string,
  sequence: number,
  kind: ReviewEvent["kind"],
): string => {
  return sha256Hex({ jobId, testCaseId, sequence, kind });
};

const computeReviewCounts = (
  perTestCase: ReadonlyArray<ReviewSnapshot>,
): {
  approvedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  pendingSecondaryApprovalCount: number;
} => {
  let approvedCount = 0;
  let needsReviewCount = 0;
  let rejectedCount = 0;
  let pendingSecondaryApprovalCount = 0;
  for (const entry of perTestCase) {
    if (
      entry.state === "approved" ||
      entry.state === "exported" ||
      entry.state === "transferred"
    ) {
      approvedCount += 1;
    } else if (entry.state === "needs_review" || entry.state === "edited") {
      needsReviewCount += 1;
    } else if (entry.state === "pending_secondary_approval") {
      pendingSecondaryApprovalCount += 1;
    } else if (entry.state === "rejected") {
      rejectedCount += 1;
    }
  }
  return {
    approvedCount,
    needsReviewCount,
    rejectedCount,
    pendingSecondaryApprovalCount,
  };
};

/** Deterministic primary approver actor used by the harness fixture. */
const VALIDATION_PRIMARY_REVIEWER = "wave1-validation-harness";
/**
 * Deterministic secondary approver actor used by the harness fixture
 * when four-eyes is enforced. Distinct from the primary so the harness
 * exercises the two-distinct-principal branch end-to-end.
 */
const VALIDATION_SECONDARY_REVIEWER = "wave1-validation-harness-secondary";

/**
 * Wave 1 Validation convention: seed every test case from the policy decision,
 * then approve every case the policy did not BLOCK. Cases the policy
 * marked `blocked` remain in `needs_review` so a future deliberate-fail
 * fixture can demonstrate the export-refusal path.
 *
 * Wave 2 (#1376): when a `fourEyesPolicy` is supplied, cases whose risk
 * category or visual-sidecar signals trigger enforcement are approved
 * by two distinct deterministic principals so the export pipeline still
 * sees them in `approved` state. Cases without enforcement keep the
 * single-reviewer flow byte-identical to Wave 1.
 *
 * The function is pure and deterministic — event ids are derived from
 * `sha256({jobId, testCaseId, sequence, kind})` so two runs of the same
 * fixture produce byte-identical event logs.
 */
const buildDeterministicReviewBundle = (input: {
  jobId: string;
  generatedAt: string;
  list: GeneratedTestCaseList;
  decisionsById: ReadonlyMap<string, TestCasePolicyDecision>;
  fourEyesPolicy?: FourEyesPolicy;
  visualReport?: VisualSidecarValidationReport;
}): DeterministicReviewBundle => {
  const events: ReviewEvent[] = [];
  const perTestCase: ReviewSnapshot[] = [];
  let sequence = 1;
  const policyMetadata = input.fourEyesPolicy
    ? cloneFourEyesPolicy(input.fourEyesPolicy)
    : undefined;

  for (const tc of input.list.testCases) {
    const decision: TestCasePolicyDecision =
      input.decisionsById.get(tc.id) ?? "needs_review";
    const seedState: ReviewState = seedReviewStateFromPolicy(decision);
    const enforcement = input.fourEyesPolicy
      ? evaluateFourEyesEnforcement({
          testCase: tc,
          policy: input.fourEyesPolicy,
          ...(input.visualReport ? { visualReport: input.visualReport } : {}),
        })
      : { enforced: false, reasons: [] as FourEyesEnforcementReason[] };
    const seedEventId = deterministicEventId(
      input.jobId,
      tc.id,
      sequence,
      "generated",
    );
    events.push({
      schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      id: seedEventId,
      jobId: input.jobId,
      testCaseId: tc.id,
      kind: "generated",
      at: input.generatedAt,
      sequence,
      fromState: "generated",
      toState: seedState,
      metadata: { policyDecision: decision },
    });
    sequence += 1;

    let currentState: ReviewState = seedState;
    let lastEventId = seedEventId;
    let approvers: string[] = [];
    let primaryReviewer: string | undefined;
    let primaryApprovalAt: string | undefined;
    let secondaryReviewer: string | undefined;
    let secondaryApprovalAt: string | undefined;
    if (seedState !== "approved" && decision !== "blocked") {
      if (enforcement.enforced) {
        // Primary approval.
        const primaryTransition = transitionReviewState({
          from: currentState,
          kind: "primary_approved",
          policyDecision: decision,
        });
        if (primaryTransition.ok) {
          const primaryEventId = deterministicEventId(
            input.jobId,
            tc.id,
            sequence,
            "primary_approved",
          );
          events.push({
            schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
            contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
            id: primaryEventId,
            jobId: input.jobId,
            testCaseId: tc.id,
            kind: "primary_approved",
            at: input.generatedAt,
            sequence,
            fromState: currentState,
            toState: primaryTransition.to,
            actor: VALIDATION_PRIMARY_REVIEWER,
          });
          currentState = primaryTransition.to;
          lastEventId = primaryEventId;
          sequence += 1;
          approvers = [VALIDATION_PRIMARY_REVIEWER];
          primaryReviewer = VALIDATION_PRIMARY_REVIEWER;
          primaryApprovalAt = input.generatedAt;

          // Secondary approval — fail-closed if the state machine refuses.
          const secondaryTransition = transitionReviewState({
            from: currentState,
            kind: "secondary_approved",
            policyDecision: decision,
          });
          if (secondaryTransition.ok) {
            const secondaryEventId = deterministicEventId(
              input.jobId,
              tc.id,
              sequence,
              "secondary_approved",
            );
            events.push({
              schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
              contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
              id: secondaryEventId,
              jobId: input.jobId,
              testCaseId: tc.id,
              kind: "secondary_approved",
              at: input.generatedAt,
              sequence,
              fromState: currentState,
              toState: secondaryTransition.to,
              actor: VALIDATION_SECONDARY_REVIEWER,
            });
            currentState = secondaryTransition.to;
            lastEventId = secondaryEventId;
            sequence += 1;
            approvers = [
              VALIDATION_PRIMARY_REVIEWER,
              VALIDATION_SECONDARY_REVIEWER,
            ].sort();
            secondaryReviewer = VALIDATION_SECONDARY_REVIEWER;
            secondaryApprovalAt = input.generatedAt;
          }
        }
      } else {
        const transition = transitionReviewState({
          from: currentState,
          kind: "approved",
          policyDecision: decision,
        });
        if (transition.ok) {
          const approveEventId = deterministicEventId(
            input.jobId,
            tc.id,
            sequence,
            "approved",
          );
          approvers = [VALIDATION_PRIMARY_REVIEWER];
          events.push({
            schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
            contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
            id: approveEventId,
            jobId: input.jobId,
            testCaseId: tc.id,
            kind: "approved",
            at: input.generatedAt,
            sequence,
            fromState: currentState,
            toState: transition.to,
            actor: VALIDATION_PRIMARY_REVIEWER,
          });
          currentState = transition.to;
          lastEventId = approveEventId;
          sequence += 1;
        }
      }
    }

    const entry: ReviewSnapshot = {
      testCaseId: tc.id,
      state: currentState,
      policyDecision: decision,
      lastEventId,
      lastEventAt: input.generatedAt,
      fourEyesEnforced: enforcement.enforced,
      approvers,
      ...(enforcement.reasons.length > 0
        ? { fourEyesReasons: enforcement.reasons.slice() }
        : {}),
      ...(primaryReviewer !== undefined ? { primaryReviewer } : {}),
      ...(primaryApprovalAt !== undefined ? { primaryApprovalAt } : {}),
      ...(secondaryReviewer !== undefined ? { secondaryReviewer } : {}),
      ...(secondaryApprovalAt !== undefined ? { secondaryApprovalAt } : {}),
    };
    perTestCase.push(entry);
  }

  perTestCase.sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));
  const counts = computeReviewCounts(perTestCase);
  const snapshot: ReviewGateSnapshot = {
    schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    perTestCase,
    ...counts,
    ...(policyMetadata ? { fourEyesPolicy: policyMetadata } : {}),
  };
  const envelope: PersistedReviewEventsEnvelope = {
    schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    events,
    nextSequence: sequence,
  };
  return { envelope, snapshot };
};
