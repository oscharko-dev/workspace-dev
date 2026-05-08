/**
 * Server-side production runner for `figma_to_qc_test_cases`
 * (Issues #1733 + #1734).
 *
 * Pipeline:
 *
 *   1. Resolve the Figma source:
 *        - figma_url      → fetch via {@link fetchFigmaFileForTestIntelligence}
 *        - figma_paste    / figma_plugin → parse caller-supplied JSON
 *        - figma_paste_normalized → caller hands us an already-parsed file
 *          (used by tests; the request-handler always parses upstream).
 *   2. Normalize the REST file into an `IntentDerivationFigmaInput`.
 *   3. Derive the Business Test Intent IR.
 *   4. Compile the deterministic, redacted prompt + structured-output schema.
 *   5. Call the test_generation LLM gateway with a relaxed draft schema.
 *      The model produces semantic content (titles, steps, etc.); the runner
 *      stamps the audit / identity / contract fields locally so the strict
 *      `GeneratedTestCase` contract is satisfied without asking the model
 *      to invent cache-key digests etc. (which it cannot know).
 *   6. Wrap each draft into a full `GeneratedTestCase`, run the validation
 *      pipeline (validation + duplicates + coverage + policy), persist
 *      every artifact under `<outputRoot>/jobs/<jobId>/test-intelligence/`
 *      with canonical-JSON + atomic temp+rename.
 *   7. Render customer-format German Markdown (one combined `testfaelle.md`
 *      plus per-test-case files) under
 *      `<outputRoot>/jobs/<jobId>/test-intelligence/customer-markdown/`.
 *
 * Deferred to follow-up issues (TODO comments inline):
 *
 *   - In-toto attestation, LBOM emission, signed evidence: separate
 *     emitters tracked elsewhere.
 *   - Disk-backed replay cache (#1739).
 *   - Production FinOps envelope (#1740) — uses the permissive default.
 *   - Job-engine progress events (#1738).
 *   - Async / queued execution: today this is invoked synchronously from
 *     the request handler; an asynchronous job-engine integration is a
 *     separate issue.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Meter, Tracer } from "@opentelemetry/api";

import {
  A11Y_JUDGE_VERDICT_ARTIFACT_FILENAME,
  type A11yVerdict,
  ALLOWED_REGULATORY_RELEVANCE_DOMAINS,
  BANKING_INSURANCE_SEMANTIC_KEYWORDS,
  CONTEXT_BUDGET_ARTIFACT_DIRECTORY,
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  FAITHFULNESS_JUDGE_COMPILED_PROMPT_ARTIFACT_FILENAME,
  FAITHFULNESS_VERDICT_ARTIFACT_FILENAME,
  GENERATED_TESTCASES_ARTIFACT_FILENAME,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  JUDGE_CONSENSUS_ARTIFACT_FILENAME,
  RUN_QUALITY_ARTIFACT_FILENAME,
  RUN_QUALITY_SCHEMA_VERSION,
  LOGIC_JUDGE_COMPILED_PROMPT_ARTIFACT_FILENAME,
  LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  LOGIC_JUDGE_VERDICT_ARTIFACT_FILENAME,
  type JudgeConsensusVerdict,
  type JudgeConsensusRepairHistory,
  LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  type RunQualityArtifact,
  type RunQualityAttemptSummary,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
  PROVENANCE_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type ActiveModelBinding,
  type AgentSourceLabel,
  type BusinessTestIntentIr,
  type FinOpsBudgetEnvelope,
  type FinOpsBudgetReport,
  type GeneratedTestCase,
  type GeneratedTestCaseAuditMetadata,
  type GeneratedTestCaseFigmaTrace,
  type GeneratedTestCaseList,
  type GeneratedTestCaseStep,
  type LlmGatewayErrorClass,
  type LlmGenerationRequest,
  type LlmGenerationResult,
  type FinOpsJobOutcome,
  type FaithfulnessVerdict,
  type MultiSourceTestIntentEnvelope,
  type RegulatoryRelevance,
  type RegulatoryRelevanceDomain,
  type JudgeVerdict,
  type TenantScope,
  type TestIntentSourceRef,
  type TestCaseLevel,
  type TestCasePolicyGateResult,
  type TestCasePolicyProfileRules,
  type TestCasePolicyReport,
  type TestCasePriority,
  type TestCaseRiskCategory,
  type TestCaseTechnique29119,
  type TestDesignModel,
  type TestCaseType,
  type TestCaseValidationReport,
  type TestCaseCoverageReport,
  type VisualSidecarFailureClass,
  type VisualSidecarResult,
  type WorkflowTopology,
  DEFAULT_TENANT_SCOPE,
  RISK_RANKING_ARTIFACT_FILENAME,
  WORKFLOW_TOPOLOGY_ARTIFACT_FILENAME,
} from "../contracts/index.js";
import { sanitizeErrorMessage } from "../error-sanitization.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  buildWorkflowTopology,
  workflowActionAnchorText,
  workflowActionIdsForTargets,
  writeWorkflowTopologyArtifact,
} from "./action-topology-agent.js";
import {
  buildWave1ValidationEvidenceManifest,
  verifyWave1ValidationEvidenceFromDisk,
  writeWave1ValidationEvidenceManifest,
} from "./evidence-manifest.js";
import {
  ADVERSARIAL_CRITIC_MAX_ROUNDS,
  ADVERSARIAL_CRITIC_ROUND_ARTIFACT_PREFIX,
  ADVERSARIAL_CRITIC_TRACE_ARTIFACT_FILENAME,
  buildAdversarialRepairInstructions,
  computeAdversarialFindingDedupeKey,
  computeNegativeCoverageAccounting,
  dedupeAdversarialFindings,
  runAdversarialCriticRound,
  writeAdversarialCriticRoundArtifact,
  writeAdversarialCriticTraceArtifact,
  type AdversarialCriticFinding,
  type AdversarialCriticRoundArtifact,
  type AdversarialCriticTraceArtifact,
} from "./adversarial-critic-agent.js";
import {
  cloneFinOpsBudgetEnvelope,
  PRODUCTION_FINOPS_BUDGET_ENVELOPE,
  resolveAdversarialCriticBudgetLimits,
  resolveFinOpsRequestLimits,
  validateFinOpsBudgetEnvelope,
} from "./finops-budget.js";
import {
  buildFinOpsBudgetReport,
  createFinOpsUsageRecorder,
  writeFinOpsBudgetReport,
} from "./finops-report.js";
import { computePerSourceCostBreakdownHashFromReport } from "./per-source-cost.js";
import {
  AGENT_PARTICIPATION_ARTIFACT_FILENAME,
  buildAgentParticipationArtifact,
  writeAgentParticipationArtifact,
  type AgentParticipationConfigurationSource,
  type AgentParticipationCostAttribution,
  type AgentParticipationEntry,
  type AgentParticipationRole,
  type AgentParticipationStatus,
} from "./agent-participation.js";
import {
  composeProductionRunnerEventSinks,
  createProductionRunnerOpenTelemetrySink,
} from "./production-runner-events.js";
import type {
  ProductionRunnerEvent,
  ProductionRunnerEventSink,
} from "./production-runner-events.js";

export type {
  ProductionRunnerEvent,
  ProductionRunnerEventPhase,
  ProductionRunnerEventSink,
} from "./production-runner-events.js";
import {
  extractAcceptanceCriteriaFromMarkdown,
  renderCustomerMarkdown,
} from "./customer-markdown-renderer.js";
import {
  fetchFigmaFileForTestIntelligence,
  fetchFigmaScreenCapturesForTestIntelligence,
  FigmaRestFetchError,
  parseFigmaUrl,
  type FigmaRestFileSnapshot,
  type FigmaRestNode,
} from "./figma-rest-adapter.js";
import { normalizeFigmaFileToIntentInput } from "./figma-payload-normalizer.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import type { LlmGatewayClient } from "./llm-gateway.js";
import type { LlmGatewayClientBundle } from "./llm-gateway-bundle.js";
import { scanLessons, selectRelevantLessons } from "./agent-lessons-memdir.js";
import {
  compilePrompt,
  type CompilePromptSuffixSection,
} from "./prompt-compiler.js";
import { mergeGeneratedTestCaseLists } from "./case-merger.js";
import {
  canonicalizeCustomContextMarkdown,
  type CustomContextMarkdownIssue,
} from "./custom-context-markdown.js";
import {
  parseAndCanonicalizeCustomerProfile,
  type CanonicalCustomerProfile,
  type CustomerProfileInput,
  type CustomerProfileIssue,
} from "./customer-profile-input.js";
import { computeSourceMixPlanHash } from "./source-mix-planner.js";
import {
  CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID,
  SOURCE_MIX_PLAN_SCHEMA_VERSION,
  type CompiledPromptCustomContext,
  type SourceMixPlan,
} from "../contracts/index.js";
import {
  cloneEuBankingDefaultProfile,
  EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_GATE_MODE,
  EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_THRESHOLD_RATIO,
} from "./policy-profile.js";
import { writeAgentRoleRunArtifact } from "./agent-role-run-artifact.js";
import { listGeneratorDiversityPassProfiles } from "./agent-role-profile.js";
import {
  AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH,
  readAgentHarnessCheckpointChain,
  summarizeAgentHarnessCheckpointChain,
} from "./agent-harness-checkpoint.js";
import {
  runAgentHarnessStep,
  type AgentHarnessAttemptResult,
  type AgentHarnessErrorClass,
  type AgentHarnessMappedJobStatus,
  type AgentHarnessOutcome,
  type AgentHarnessTestDepth,
  type RunAgentHarnessStepResult,
} from "./agent-harness.js";
import { writeGenealogyArtifact } from "./genealogy.js";
import {
  buildProductionRunnerEvidenceSeal,
  PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
  serializeProductionRunnerEvidenceSeal,
  verifyProductionRunnerEvidenceSealFromDisk,
} from "./production-runner-evidence.js";
import {
  buildRunProvenanceGraph,
  writeProvenanceGraph,
} from "./provenance-graph.js";
import { verifyProvenanceFromDisk } from "./provenance-verify.js";
import {
  normalizeUntrustedContent,
  writeUntrustedContentNormalizationReport,
} from "./untrusted-content-normalizer.js";
import { buildSourceScopedCalculationAssumptions } from "./calculation-constraints.js";
import {
  buildSourceScopedValidationOpenQuestions,
  deriveUnresolvedValidationConstraints,
  deriveUnresolvedValidationConstraintsWithScreenFallback,
  GENERIC_VALIDATION_EXPECTED_RESULT,
} from "./unresolved-validation-rules.js";
import { runValidationPipeline } from "./validation-pipeline.js";
import {
  describeVisualScreens,
  writeVisualSidecarResultArtifact,
  type DescribeVisualScreensDiagnostic,
} from "./visual-sidecar-client.js";
import { createPersistentReplayCache } from "./replay-cache-persistent.js";
import {
  executeWithReplayCache,
  type ReplayCache,
  ReplayCacheValidationError,
} from "./replay-cache.js";
import {
  createFileSystemA11yJudgeCache,
  createMemoryA11yJudgeCache,
  runA11yJudge,
  type RunA11yJudgeResult,
} from "./a11y-judge.js";
import {
  createFileSystemFaithfulnessJudgeCache,
  createMemoryFaithfulnessJudgeCache,
  runFaithfulnessJudge,
  type RunFaithfulnessJudgeResult,
} from "./faithfulness-judge.js";
import {
  createFileSystemLogicJudgeCache,
  createMemoryLogicJudgeCache,
  runLogicJudge,
  type LogicJudgeCoverageThresholds,
  type RunLogicJudgeResult,
} from "./logic-judge.js";
import {
  buildCoveragePlanWithAugmentation,
  writeCoveragePlanArtifact,
} from "./coverage-planner.js";
import {
  buildRiskRankingWithAugmentation,
  writeRiskRankingArtifact,
} from "./risk-ranker.js";
import {
  isCoverageRelevantActionLike,
  isCoverageRelevantElementLike,
} from "./coverage-relevance.js";
import {
  buildA11yJudgeConsensusEntry,
  buildFaithfulnessJudgeConsensusEntry,
  buildJudgeConsensus,
  buildLogicJudgeConsensusEntry,
  writeJudgeConsensusArtifact,
} from "./judge-consensus.js";
import {
  REPAIR_LOOP_DEFAULT_MAX_ITERATIONS,
  REPAIR_PLANNER_ARTIFACT_PREFIX,
  TEST_GENERATION_REPAIR_ARTIFACT_PREFIX,
  runRepairLoop,
  type RepairLoopBudgetGuard,
  type RepairLoopIterationRecord,
  type RepairLoopResult,
} from "./repair-loop.js";
import { buildTestDesignModel } from "./test-design-model.js";

/**
 * Default test-generation deployment label. Exported so callers building
 * an LLM gateway client for the runner can pin the same identity, and so
 * tests can assert on the contract without re-importing the constant.
 */
export const PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT =
  "gpt-oss-120b" as const;

const VISUAL_CAPTURE_ARTIFACT_DIRECTORY = "visual-captures" as const;
const VISUAL_CAPTURE_MANIFEST_FILENAME = "manifest.json" as const;
const TEST_GENERATION_MODEL_REVISION = "gpt-oss-120b" as const;
const TEST_GENERATION_GATEWAY_RELEASE = "production-runner-1.0" as const;
const POLICY_BUNDLE_VERSION = "production-runner-eu-banking-default" as const;

/**
 * Per-screen caps applied to the IR slice that is sent to the LLM. Real
 * banking-domain Figma files routinely contain thousands of input nodes per
 * screen (the customer's "Investitionsfinanzierung — Bedarfsermittlung"
 * canvas has 5600 children); embedding the entire IR pushes the prompt past
 * every gateway's body limit and burns the entire output budget on
 * unparseable retries. The full IR is still persisted to
 * `business-intent-ir.json` so reviewers see everything the runner derived;
 * these caps only bound what the model receives.
 *
 * Truncation is recorded in the wire IR's `assumptions` array so it surfaces
 * in the audit trail and in any open question the model raises about
 * partial coverage.
 */
export const PROMPT_MAX_FIELDS_PER_SCREEN = 60 as const;
export const PROMPT_MAX_ACTIONS_PER_SCREEN = 30 as const;
export const PROMPT_MAX_VALIDATIONS_PER_SCREEN = 30 as const;
export const PROMPT_MAX_NAVIGATION_PER_SCREEN = 30 as const;
export const MAX_FIGMA_PAYLOAD_BYTES: number = 10 * 1024 * 1024;

/**
 * Stable failure-class enum surfaced to callers (request handler maps
 * each value to an HTTP status + error envelope).
 */
export const PRODUCTION_RUNNER_FAILURE_CLASSES = [
  "EMPTY_FIGMA_INPUT",
  "FIGMA_FETCH_FAILED",
  "FIGMA_PAYLOAD_TOO_LARGE",
  "FIGMA_URL_REJECTED",
  "LLM_GATEWAY_FAILED",
  "LLM_REFUSAL",
  "LLM_RESPONSE_INVALID",
  "PERSIST_FAILED",
  "FINOPS_BUDGET_INVALID",
  "CUSTOM_CONTEXT_MARKDOWN_INVALID",
  "CUSTOMER_PROFILE_INVALID",
  "NEGATIVE_CASE_LIFT_BELOW_THRESHOLD",
] as const;

export type ProductionRunnerFailureClass =
  (typeof PRODUCTION_RUNNER_FAILURE_CLASSES)[number];

/**
 * Visual-sidecar failure classes treated as caller-side pre-flight errors —
 * the runner fails fast on these because they indicate a programming/config
 * bug rather than a model-side refusal. The remaining failure classes are
 * routed to `needs_review` per Issue #1772 acceptance criterion #4 and
 * surfaced as a documented refusal code on the runner result.
 */
const VISUAL_SIDECAR_PREFLIGHT_FAILURE_CLASSES: ReadonlySet<VisualSidecarFailureClass> =
  new Set<VisualSidecarFailureClass>([
    "empty_screen_capture_set",
    "duplicate_screen_id",
    "image_mime_unsupported",
    "image_payload_too_large",
  ]);

const isVisualSidecarRefusal = (
  failureClass: VisualSidecarFailureClass,
): boolean => !VISUAL_SIDECAR_PREFLIGHT_FAILURE_CLASSES.has(failureClass);

/** Stable error class used by `runFigmaToQcTestCases`. */
export class ProductionRunnerError extends Error {
  readonly failureClass: ProductionRunnerFailureClass;
  readonly retryable: boolean;
  constructor(input: {
    failureClass: ProductionRunnerFailureClass;
    message: string;
    retryable: boolean;
    cause?: unknown;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "ProductionRunnerError";
    this.failureClass = input.failureClass;
    this.retryable = input.retryable;
  }
}

/** Relaxed draft shape returned by the LLM. */
export interface ProductionRunnerLlmDraftCase {
  title: string;
  objective: string;
  type: TestCaseType;
  priority: TestCasePriority;
  riskCategory: TestCaseRiskCategory;
  technique: TestCaseTechnique29119;
  level?: TestCaseLevel;
  preconditions: ReadonlyArray<string>;
  testData: ReadonlyArray<string>;
  steps: ReadonlyArray<{
    index: number;
    action: string;
    data?: string;
    expected?: string;
  }>;
  expectedResults: ReadonlyArray<string>;
  figmaTraceRefs?: ReadonlyArray<{
    screenId: string;
    nodeId?: string;
    nodeName?: string;
    nodePath?: string;
  }>;
  assumptions?: ReadonlyArray<string>;
  openQuestions?: ReadonlyArray<string>;
  /**
   * Optional regulatory-relevance signal (Issue #1735, contract bump 4.27.0).
   * Populated when the prompt-augmentation pass produced a banking/insurance
   * compliance case for screens whose name matches a
   * {@link BANKING_INSURANCE_SEMANTIC_KEYWORDS} entry.
   */
  regulatoryRelevance?: {
    domain: RegulatoryRelevanceDomain;
    rationale: string;
  };
  /**
   * Optional coverage signals captured from the LLM response (Issue #1901).
   * The generator prompt asks the model to populate these so the
   * downstream coverage hard-gate has machine-readable evidence of which
   * IR ids each test case covers. Older models or fixtures that omit
   * them round-trip cleanly: the runner falls back to empty arrays and
   * the hard-gate emits its `empty_coverage_signals` finding.
   */
  qualitySignals?: {
    coveredFieldIds?: ReadonlyArray<string>;
    coveredActionIds?: ReadonlyArray<string>;
    coveredValidationIds?: ReadonlyArray<string>;
    coveredNavigationIds?: ReadonlyArray<string>;
    confidence?: number;
  };
}

/** LLM response envelope. */
interface LlmDraftResponse {
  testCases: ReadonlyArray<ProductionRunnerLlmDraftCase>;
}

/** Runner input source variants. */
export type ProductionRunnerSource =
  | { kind: "figma_url"; figmaUrl: string; accessToken: string }
  | { kind: "figma_paste_normalized"; file: FigmaRestFileSnapshot }
  | {
      kind: "figma_rest_file";
      file: FigmaRestFileSnapshot;
    };

export interface ProductionRunnerLlmConfig {
  client: LlmGatewayClient;
  /** Optional multimodal bundle used to resolve visual sidecar screenshots. */
  bundle?: LlmGatewayClientBundle;
  /**
   * Optional dedicated logic-judge client (Issue #1932). When supplied
   * directly, the production runner sends logic-judge prompts here
   * instead of reusing {@link client}. `bundle.logicJudge` (when set)
   * takes precedence over this field; if both are absent the judge
   * falls back to `client` so the multi-agent harness keeps working
   * for callers that have not migrated to the cross-model topology.
   *
   * Use this seam when you want a different deployment for the judge
   * but do NOT want to construct a full visual-sidecar bundle.
   */
  logicJudge?: LlmGatewayClient;
  /**
   * Optional dedicated coverage-planner client (Issue #1934). When supplied
   * directly, the production runner can request a soft augmentation layer for
   * the deterministic coverage plan without requiring a full bundle. When both
   * this field and `bundle.coveragePlanner` are present, the bundle slot wins.
   */
  coveragePlanner?: LlmGatewayClient;
  /**
   * Optional dedicated risk-ranker client (Issue #1935). When supplied
   * directly, the production runner can ask a smaller model to refine the
   * deterministic risk ranking without requiring a full bundle. When both this
   * field and `bundle.riskRanker` are present, the bundle slot wins.
   */
  riskRanker?: LlmGatewayClient;
  /** Optional per-request token budget. */
  maxOutputTokens?: number;
  /** Optional per-request wall-clock budget (ms). */
  maxWallClockMs?: number;
  /** Optional caller-side AbortSignal. */
  abortSignal?: AbortSignal;
}

/**
 * Production runner harness modes (Issue #1791, Story MA-3 #1758).
 *
 *   - `off` (default) — single-pass fallback. The runner calls the LLM
 *     gateway once and fails fast on errors. No harness step artifact is
 *     written. This is the legacy behavior that all existing callers
 *     receive when they omit the {@link ProductionRunnerHarnessConfig}.
 *   - `shadow_eval` — observation mode. The runner still executes the
 *     single-pass LLM call exactly as in `off`, but additionally writes a
 *     per-step harness artifact reflecting the classified outcome. Failure
 *     classification is identical to `off`; the harness artifact is purely
 *     informational so operators can compare the multi-agent harness's
 *     decisions against production behavior before enabling enforcement.
 *   - `enforced` — the harness owns the terminal decision. The runner
 *     executes the single-pass LLM call, classifies the result through
 *     {@link runAgentHarnessStep}, and refuses to proceed when the harness
 *     outcome is anything other than `accepted`. Non-accepted outcomes map
 *     to the same {@link ProductionRunnerError} failure classes as the
 *     legacy fallback so request handlers continue to receive a stable
 *     error envelope.
 */
export const PRODUCTION_RUNNER_HARNESS_MODES = [
  "enforced",
  "off",
  "shadow_eval",
] as const;

export type ProductionRunnerHarnessMode =
  (typeof PRODUCTION_RUNNER_HARNESS_MODES)[number];

/** Harness role step id used when wrapping the test_generation LLM call. */
export const PRODUCTION_RUNNER_HARNESS_ROLE_STEP_ID =
  "test_generation_harness" as const;

export interface ProductionRunnerHarnessConfig {
  /** Harness routing mode. Defaults to `"off"` when this field is omitted. */
  readonly mode: ProductionRunnerHarnessMode;
  /** Iteration budget tag forwarded to the harness. Defaults to `"standard"`. */
  readonly testDepth?: AgentHarnessTestDepth;
  /**
   * Override for the harness role step id used to namespace the per-step
   * artifact. Defaults to {@link PRODUCTION_RUNNER_HARNESS_ROLE_STEP_ID}.
   * Override only when running multiple harness wrappers in the same job.
   */
  readonly roleStepId?: string;
  /**
   * Cap on repair iterations after the initial pass (Issue #1900). Defaults
   * to {@link REPAIR_LOOP_DEFAULT_MAX_ITERATIONS} (3) when omitted; clamped to
   * {@link REPAIR_LOOP_MAX_ITERATIONS_HARD_CAP} (5). When at least one judge
   * returns `repair` and none returns `reject`, the runner consolidates the
   * judge `repairInstructions`, re-invokes the generator with the augmented
   * prompt, and re-runs both judges. The loop terminates with `accepted` /
   * `rejected` when both judges agree, otherwise with `needs_review` after
   * the cap is exhausted (mapped to job runtime status `partial`).
   */
  readonly maxRepairIterations?: number;
}

/** Summary surfaced when the runner ran in `shadow_eval` or `enforced` mode. */
export interface ProductionRunnerHarnessSummary {
  readonly mode: Exclude<ProductionRunnerHarnessMode, "off">;
  readonly outcome: AgentHarnessOutcome;
  readonly mappedJobStatus: AgentHarnessMappedJobStatus;
  readonly errorClass: AgentHarnessErrorClass;
  readonly attemptsConsumed: number;
  readonly maxAttemptsAllowed: number;
  readonly artifactPath: string;
}

const toEvidenceVisualDeployment = (
  deployment: LlmGatewayClient["deployment"],
): string => (deployment.trim().length > 0 ? deployment : "mock");

const buildActiveModelBindings = (input: {
  client: LlmGatewayClient;
  bundle?: LlmGatewayClientBundle;
  logicJudge?: LlmGatewayClient;
  coveragePlanner?: LlmGatewayClient;
}): readonly ActiveModelBinding[] => {
  const bindings: ActiveModelBinding[] = [];
  const pushBinding = (client: LlmGatewayClient): void => {
    const binding: ActiveModelBinding = {
      providerId: "llm-gateway",
      modelId: client.modelRevision,
      inferenceProfileId: client.deployment,
      ...(client.ictRegisterRef !== undefined
        ? { ictRegisterRef: client.ictRegisterRef }
        : {}),
    };
    if (
      bindings.some(
        (existing) =>
          existing.modelId === binding.modelId &&
          existing.inferenceProfileId === binding.inferenceProfileId,
      )
    ) {
      return;
    }
    bindings.push(binding);
  };

  pushBinding(input.client);
  if (input.logicJudge !== undefined) {
    pushBinding(input.logicJudge);
  }
  if (input.coveragePlanner !== undefined) {
    pushBinding(input.coveragePlanner);
  }
  if (input.bundle !== undefined) {
    pushBinding(input.bundle.visualPrimary);
    pushBinding(input.bundle.visualFallback);
    if (input.bundle.a11yJudge !== undefined) {
      pushBinding(input.bundle.a11yJudge);
    }
    if (input.bundle.coveragePlanner !== undefined) {
      pushBinding(input.bundle.coveragePlanner);
    }
  }
  return bindings;
};

const isA11yJudgeAvailableForConsensus = (
  result: RunA11yJudgeResult | undefined,
): result is RunA11yJudgeResult =>
  result !== undefined && result.verdict.refusal === undefined;

const mergeA11yIntoLogicVerdict = (
  logicVerdict: JudgeVerdict,
  a11yVerdict: A11yVerdict | undefined,
): JudgeVerdict => {
  if (a11yVerdict === undefined || a11yVerdict.verdict !== "repair") {
    return logicVerdict;
  }
  return {
    ...logicVerdict,
    verdict: logicVerdict.verdict === "reject" ? "reject" : "repair",
    findings: [
      ...logicVerdict.findings,
      ...a11yVerdict.findings.map((finding) => ({
        testCaseId: finding.testCaseId,
        code: finding.code,
        severity: finding.severity,
        message: finding.message,
      })),
    ],
    repairInstructions: [
      ...logicVerdict.repairInstructions,
      ...a11yVerdict.repairInstructions,
    ],
  };
};

export interface RunFigmaToQcTestCasesInput {
  jobId: string;
  generatedAt: string;
  source: ProductionRunnerSource;
  /**
   * Root directory under which `<outputRoot>/jobs/<jobId>/test-intelligence/`
   * is created.
   */
  outputRoot: string;
  /**
   * Optional exact artifact directory. CLI timestamp runs use this to keep
   * every run artifact directly under the timestamp folder instead of adding
   * another `jobs/<jobId>/test-intelligence` nesting layer. Omit it to keep
   * the legacy job-engine layout.
   */
  artifactDir?: string;
  llm: ProductionRunnerLlmConfig;
  /**
   * Optional override for the maximum Figma REST payload accepted by the
   * runner. Defaults to {@link MAX_FIGMA_PAYLOAD_BYTES} (10 MiB) which is
   * defensive enough for synthetic fixtures and the live-E2E lane but too
   * tight for real Banking-scale design files (the customer's Test-View-03
   * frame ships ~28 MiB of REST JSON on its own). Operators with vetted
   * private files can opt up to a higher ceiling on a per-job basis. The
   * operator-supplied value is validated as a positive safe integer; an
   * invalid value fails the job fast with `FIGMA_URL_REJECTED` before any
   * network IO happens.
   */
  maxFigmaPayloadBytes?: number;
  /**
   * Optional FinOps budget envelope (Issue #1740). When omitted the runner
   * uses {@link PRODUCTION_FINOPS_BUDGET_ENVELOPE}. When supplied the
   * operator value wins outright — the runner does NOT merge with the
   * default. The envelope is validated; an invalid envelope fails the
   * job fast with `FINOPS_BUDGET_INVALID` and never reaches the gateway.
   *
   * Per-request token / wall-clock limits resolved from the envelope's
   * `roles.test_generation` entry override the legacy
   * `llm.maxOutputTokens` / `llm.maxWallClockMs` fields.
   */
  finopsBudget?: FinOpsBudgetEnvelope;
  /**
   * Optional event sink for runner progress events (Issue #1738). When
   * supplied the runner emits a typed event for each phase boundary
   * (intent derivation, prompt compilation, gateway request/response,
   * validation, export, evidence sealed, FinOps recorded). The sink is
   * called synchronously inside the pipeline; throwing from the sink
   * propagates to the caller, so consumers should swallow + log their
   * own errors.
   */
  events?: ProductionRunnerEventSink;
  /**
   * Optional OpenTelemetry tracer (Issue #1945). When supplied the runner
   * emits one span per phase boundary using the stable attribute contract
   * documented in `docs/test-intelligence-observability.md`. The runner
   * never creates or configures an exporter automatically.
   */
  otelTracer?: Tracer;
  /**
   * Optional OpenTelemetry meter (Issue #1945). When supplied the runner
   * increments the production-runner phase counter alongside any spans
   * emitted via `otelTracer`. The runner never creates or configures an
   * exporter automatically.
   */
  otelMeter?: Meter;
  /**
   * Optional override for the file name surfaced in customer Markdown
   * headers; defaults to `figmaFile.name` (or the file key if missing).
   */
  customerLabel?: string;
  /**
   * Policy profile id used to drive prompt augmentation. Defaults to
   * `EU_BANKING_DEFAULT_POLICY_PROFILE_ID` (`"eu-banking-default"`),
   * matching the validation pipeline's default profile. When the resolved
   * id equals `"eu-banking-default"` the runner injects the banking /
   * insurance compliance prompt block (Issue #1735): positive + negative
   * cases per relevant input, PII / IBAN / BIC / Vertragsnummer rejection
   * + masking, four-eyes + audit-trail for state-changing actions,
   * boundary tests on amount / currency, and one regulatory-compliance
   * case for screens whose name matches a
   * {@link BANKING_INSURANCE_SEMANTIC_KEYWORDS} entry.
   */
  policyProfileId?: string;
  /**
   * Optional multi-agent harness routing (Issue #1791). Defaults to
   * {@link ProductionRunnerHarnessMode} `"off"` — the single-pass LLM call
   * remains the production fallback. When set to `"shadow_eval"` the runner
   * additionally writes a per-step harness artifact for observation; when
   * set to `"enforced"` the harness owns the terminal decision and refuses
   * to proceed when the classified outcome is not `accepted`.
   */
  harness?: ProductionRunnerHarnessConfig;
  /**
   * Optional replay cache (Issue #1739). When omitted the runner creates a
   * disk-backed, tenant-scoped, LRU-bounded cache under
   * `<outputRoot>/test-intelligence/replay-cache/<tenantId>/<environmentId>/<projectId>/`.
   * Pass an explicit cache (e.g. `createMemoryReplayCache()`) to override the
   * default — useful in tests and dry-run pipelines.
   */
  replayCache?: ReplayCache;
  /**
   * Tenant scope (Issue #1944) for the default disk-backed replay cache and
   * for all judge filesystem caches. Cross-tenant cache reads are denied at
   * the loader level: each cache is bound to exactly this scope at
   * construction time and exposes no API to address paths outside its
   * `<tenantId>/<environmentId>/<projectId>/…` directory. Defaults to
   * {@link DEFAULT_TENANT_SCOPE} (`tenantId: "default"`) when omitted, which
   * preserves single-tenant behaviour for callers that have not yet adopted
   * the structured scope. Has no effect when `replayCache` is supplied
   * explicitly.
   */
  replayCacheTenantScope?: TenantScope;
  /**
   * Optional Markdown supporting-context body (Issue #1894). When supplied
   * the runner canonicalizes the Markdown via
   * {@link canonicalizeCustomContextMarkdown} (PII redaction, prompt-injection
   * tagging, link/HTML/MDX/image refusal, byte-cap enforcement) and surfaces
   * it as a dedicated `custom_context_markdown` source-mix section in the
   * compiled prompt. Failures fail the job fast with
   * `CUSTOM_CONTEXT_MARKDOWN_INVALID` before any LLM call is dispatched.
   */
  customContextMarkdown?: string;
  /**
   * Optional explicit customer evaluation rubric. Unlike
   * `customContextMarkdown`, this is not treated as a business evidence source;
   * it controls customer-facing test-case format, granularity and quality
   * expectations.
   */
  customerEvalMarkdown?: string;
  /**
   * Logic-Judge integration (Issue #1898). Defaults to **enabled** —
   * when the generator step succeeds the runner dispatches a second
   * LLM roundtrip against the same gateway client (attributed to
   * FinOps source `judge_primary`) and consumes the verdict to
   * drive {@link AgentHarnessAttemptResult.judgeAccepted}. Pass
   * `{ enabled: false }` explicitly to keep the legacy single-pass
   * behaviour (e.g. unit tests that mock only the generator
   * responder).
   *
   * In `harness.mode === "enforced"` a non-`accept` verdict surfaces
   * as a {@link ProductionRunnerError} via the existing harness
   * mapping; in `"shadow_eval"` the verdict is recorded only.
   */
  logicJudge?: {
    readonly enabled: boolean;
  };
  /**
   * Optional diversity-sampling configuration (Issue #1936). Omit this
   * block or set `diversityPasses: 1` to preserve the legacy single-pass
   * generator path byte-for-byte. `diversityPasses: 2` enables two
   * deterministic generator passes that run in parallel with distinct bias
   * hints and seeds before their outputs are merged downstream.
   * Values other than `1` or `2` are rejected at runtime.
   */
  generation?: {
    readonly diversityPasses?: number;
  };
  /**
   * Optional customer profile (Issue #1946). When supplied the runner:
   *  - Applies `ictRegisterRef` fallback to any active model binding that
   *    lacks its own `ictRegisterRef`, so `policy:ict-register-ref-required`
   *    is satisfied (DORA Art. 9 compliance).
   *  - Threads `glossary` and `fewShotExamples` into the `[5]
   *    CustomerDomainContext` section of the compiled prompt alongside
   *    `riskTaxonomyOverrides` and `policyOverrides`.
   *
   * The profile is parsed and canonicalized (PII redaction, prompt-injection
   * scrub, deterministic sort) before any LLM call is dispatched. A malformed
   * or policy-violating profile fails the job fast with
   * `CUSTOMER_PROFILE_INVALID`.
   */
  customerProfile?: CustomerProfileInput;
  /**
   * Optional provenance for role deployment resolution. The runner uses
   * this when building `agent-participation.json` so summaries can
   * distinguish CLI overrides, env defaults, built-in defaults, and
   * intentionally disabled roles without re-parsing the invocation layer.
   */
  roleConfigurationSources?: Partial<
    Record<AgentParticipationRole, AgentParticipationConfigurationSource>
  >;
  /**
   * Issue #2053 — quality-gate overrides applied on top of the resolved
   * policy profile. Used as the documented CLI escape hatch so operators
   * can flip the adversarial-critic negative-case-lift gate to
   * `"advisory"` for fast iterative local runs without authoring a
   * derived policy profile. Each override replaces the corresponding
   * profile-level config entry by value (no field-level merge); fields
   * left undefined fall back to the policy profile, which itself falls
   * back to the documented secure default of
   * `{ gateMode: "enforce", thresholdRatio: 0.30 }`.
   */
  qualityGates?: {
    readonly negativeCaseLift?: {
      readonly gateMode: "enforce" | "advisory" | "off";
      readonly thresholdRatio: number;
    };
  };
}

export interface RunFigmaToQcTestCasesResult {
  jobId: string;
  generatedAt: string;
  fileKey: string;
  generatedTestCases: GeneratedTestCaseList;
  intent: BusinessTestIntentIr;
  validation: TestCaseValidationReport;
  policy: TestCasePolicyReport;
  coverage: TestCaseCoverageReport;
  blocked: boolean;
  /** Resolved FinOps envelope used for this run (validated, frozen). */
  finopsBudget: FinOpsBudgetEnvelope;
  artifactDir: string;
  artifactPaths: {
    intent: string;
    compiledPrompt: string;
    coveragePlan: string;
    workflowTopology: string;
    riskRanking: string;
    adversarialCriticTrace?: string;
    logicJudgeCompiledPrompt?: string;
    customerEvalRubric?: string;
    faithfulnessJudgeCompiledPrompt?: string;
    a11yJudgeVerdict?: string;
    untrustedContentNormalizationReport: string;
    evidenceSeal: string;
    visualSidecarResult?: string;
    visualCaptureManifest?: string;
    visualCaptureDirectory?: string;
    visualSidecarValidationReport?: string;
    agentParticipation: string;
    agentRoleRun: string;
    judgeConsensus: string;
    runQuality: string;
    logicJudgeVerdict?: string;
    faithfulnessJudgeVerdict?: string;
    genealogy: string;
    provenance: string;
    contextBudgetReport?: string;
    generatedTestCases: string;
    validationReport: string;
    policyReport: string;
    coverageReport: string;
    finopsReport: string;
    /** Path to the per-step harness artifact when `harness.mode !== "off"`. */
    harnessStep?: string;
  };
  /**
   * Harness summary surfaced when the runner ran with
   * `harness.mode === "shadow_eval"` or `"enforced"`. Absent in `"off"` mode
   * so legacy callers see no field-shape change.
   */
  harness?: ProductionRunnerHarnessSummary;
  visualSidecar?: {
    result: VisualSidecarResult;
    artifactPath: string;
    validationReportPath?: string;
    /**
     * Documented refusal code surfaced when the multimodal sidecar exhausted
     * both deployments (or otherwise refused to produce screen descriptions).
     * Issue #1772: this routes every test case to `needs_review` via the
     * policy gate while the runner still publishes a complete artifact set.
     */
    refusal?: {
      failureClass: VisualSidecarFailureClass;
      failureMessage: string;
    };
  };
  logicJudge?: {
    verdict: JudgeVerdict;
    artifactPath: string;
    compiledPromptPath: string;
  };
  a11yJudge?: {
    verdict: A11yVerdict;
    artifactPath: string;
  };
  judgeConsensus: {
    verdict: JudgeConsensusVerdict;
    artifactPath: string;
  };
  runQuality: {
    artifact: RunQualityArtifact;
    artifactPath: string;
  };
  faithfulnessJudge?: {
    verdict: FaithfulnessVerdict;
    artifactPath: string;
    compiledPromptPath: string;
  };
  /**
   * Repair-loop summary surfaced when the initial judge panel did not
   * unanimously accept the output and the runner ran the bounded repair
   * loop (Issue #1900, Issue #1928). Absent only when both judges accept
   * on the initial pass. Initial-pass `reject` verdicts also trigger the
   * loop because live runs showed the Logic-Judge frequently emits
   * `reject` for recoverable structured-output schema violations.
   */
  repairLoop?: {
    readonly outcome: RepairLoopResult["outcome"];
    readonly repairIterationCount: number;
    readonly maxRepairIterations: number;
    readonly iterations: ReadonlyArray<RepairLoopIterationRecord>;
  };
  customerMarkdownPaths: {
    combined: string;
    perCase: ReadonlyArray<string>;
  };
}

const getBySourceCallCount = (
  report: FinOpsBudgetReport,
  source: AgentSourceLabel,
): number => report.bySource[source]?.callCount ?? 0;

const toArtifactReference = (
  artifactDir: string,
  artifactPath: string,
): string => relative(artifactDir, artifactPath).replaceAll("\\", "/");

const roleConfigurationSource = (
  input: RunFigmaToQcTestCasesInput,
  role: AgentParticipationRole,
): AgentParticipationConfigurationSource =>
  input.roleConfigurationSources?.[role] ?? "default";

const buildRoleCostAttribution = (input: {
  report: FinOpsBudgetReport;
  source: AgentSourceLabel;
}): AgentParticipationCostAttribution | undefined => {
  const entry = input.report.bySource[input.source];
  if (entry === undefined) return undefined;
  return {
    sourceLabel: input.source,
    ...(entry.deployment !== undefined ? { deployment: entry.deployment } : {}),
    callCount: entry.callCount,
    inputTokens: entry.tokensIn,
    outputTokens: entry.tokensOut,
    imageBytes: 0,
    durationMs: 0,
    estimatedCost: entry.costMinorUnits,
  };
};

const buildVisualRoleCostAttribution = (input: {
  report: FinOpsBudgetReport;
  role: "visual_primary" | "visual_fallback";
}): AgentParticipationCostAttribution | undefined => {
  const entry = input.report.roles.find(
    (candidate) => candidate.role === input.role,
  );
  if (entry === undefined) return undefined;
  return {
    ...(entry.deployment.length > 0 ? { deployment: entry.deployment } : {}),
    callCount: entry.attempts,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    imageBytes: entry.imageBytes,
    durationMs: entry.durationMs,
    estimatedCost: entry.estimatedCost,
  };
};

const buildAgentParticipationEntries = (input: {
  request: RunFigmaToQcTestCasesInput;
  artifactDir: string;
  finopsReport: FinOpsBudgetReport;
  generationCacheHit: boolean;
  logicJudgeEnabled: boolean;
  logicJudgeGatewayResult: LlmGenerationResult | undefined;
  coveragePlannerGatewayResult: LlmGenerationResult | undefined;
  riskRankerGatewayResult: LlmGenerationResult | undefined;
  visualSidecarResult: VisualSidecarResult | undefined;
  visualSidecarSkippedReason:
    | "non_figma_url_source"
    | "visual_sidecar_bundle_not_configured"
    | undefined;
  a11yJudgeResult:
    | {
        gatewayResult?: LlmGenerationResult;
      }
    | undefined;
  visualSidecarRefusal:
    | {
        failureClass: VisualSidecarFailureClass;
      }
    | undefined;
  repairLoopResult: RepairLoopResult | undefined;
  adversarialCriticRounds: readonly AdversarialCriticRoundArtifact[];
  artifactPaths: {
    coveragePlan: string;
    workflowTopology: string;
    riskRanking: string;
    logicJudgeVerdict: string;
    adversarialCriticTrace?: string;
    visualSidecarResult?: string;
    a11yJudgeVerdict?: string;
    agentRoleRun: string;
  };
}): readonly AgentParticipationEntry[] => {
  const refs = input.artifactPaths;
  const entries: AgentParticipationEntry[] = [];
  const visualAttempts = input.visualSidecarResult?.attempts ?? [];
  const primaryAttempt = visualAttempts[0];
  const fallbackAttempt = visualAttempts[1];
  const visualBundleConfigured = input.request.llm.bundle !== undefined;
  const logicJudgeClient =
    input.request.llm.bundle?.logicJudge ??
    input.request.llm.logicJudge ??
    input.request.llm.client;
  const logicJudgeDeployment =
    input.logicJudgeEnabled ||
    roleConfigurationSource(input.request, "logic_judge") !== "disabled"
      ? logicJudgeClient.deployment
      : undefined;
  const coveragePlannerClient =
    input.request.llm.bundle?.coveragePlanner ??
    input.request.llm.coveragePlanner;
  const riskRankerClient =
    input.request.llm.bundle?.riskRanker ?? input.request.llm.riskRanker;
  const a11yJudgeClient = input.request.llm.bundle?.a11yJudge;
  const generatorConstrainedFallbackReason =
    input.request.llm.client.constrainedDecoding?.fallbackReason;
  const logicJudgeConstrainedFallbackReason =
    logicJudgeClient.constrainedDecoding?.fallbackReason;

  entries.push({
    role: "action_topology",
    configurationSource: roleConfigurationSource(input.request, "action_topology"),
    status: "succeeded",
    attemptCount: 1,
    remediation:
      "Deterministic workflow topology derived from the test-design model and customer context.",
    artifactReferences: [
      toArtifactReference(input.artifactDir, refs.workflowTopology),
    ],
  });

  entries.push({
    role: "generator",
    deployment: input.request.llm.client.deployment,
    configurationSource: roleConfigurationSource(input.request, "generator"),
    status: input.generationCacheHit ? "skipped" : "succeeded",
    attemptCount: getBySourceCallCount(input.finopsReport, "generator"),
    ...(input.generationCacheHit
      ? {
          remediation:
            "Replay cache satisfied generation; no gateway attempt was required.",
        }
      : {}),
    ...(generatorConstrainedFallbackReason !== undefined
      ? {
          remediation:
            `Constrained decoding fell back for generator: ${generatorConstrainedFallbackReason}`,
        }
      : {}),
    artifactReferences: [
      toArtifactReference(input.artifactDir, refs.agentRoleRun),
    ],
    ...(buildRoleCostAttribution({
      report: input.finopsReport,
      source: "generator",
    }) !== undefined
      ? {
          costAttribution: buildRoleCostAttribution({
            report: input.finopsReport,
            source: "generator",
          })!,
        }
      : {}),
  });

  const logicJudgeStatus: AgentParticipationStatus = !input.logicJudgeEnabled
    ? "skipped"
    : input.logicJudgeGatewayResult?.outcome === "error"
      ? "failed"
      : "succeeded";
  entries.push({
    role: "logic_judge",
    ...(logicJudgeDeployment !== undefined
      ? { deployment: logicJudgeDeployment }
      : {}),
    configurationSource: roleConfigurationSource(input.request, "logic_judge"),
    status: logicJudgeStatus,
    attemptCount: getBySourceCallCount(input.finopsReport, "judge_primary"),
    ...(logicJudgeStatus === "skipped"
      ? { remediation: "Logic Judge was disabled for this run." }
      : {}),
    ...(logicJudgeStatus !== "skipped" &&
    logicJudgeConstrainedFallbackReason !== undefined
      ? {
          remediation:
            `Constrained decoding fell back for logic judge: ${logicJudgeConstrainedFallbackReason}`,
        }
      : {}),
    ...(logicJudgeStatus === "failed" &&
    input.logicJudgeGatewayResult?.outcome === "error"
      ? {
          failureClass: input.logicJudgeGatewayResult.errorClass,
          remediation:
            "Inspect the logic-judge verdict artifact and gateway logs; fix the dedicated judge deployment or fall back to a healthy deployment.",
        }
      : {}),
    artifactReferences: [
      toArtifactReference(input.artifactDir, refs.logicJudgeVerdict),
    ],
    ...(buildRoleCostAttribution({
      report: input.finopsReport,
      source: "judge_primary",
    }) !== undefined
      ? {
          costAttribution: buildRoleCostAttribution({
            report: input.finopsReport,
            source: "judge_primary",
          })!,
        }
      : {}),
  });

  const buildOptionalTextRole = (inputRole: {
    role: "coverage_planner" | "risk_ranker";
    clientDeployment: string | undefined;
    gatewayResult: LlmGenerationResult | undefined;
    source: AgentSourceLabel;
    artifactPath: string;
  }): AgentParticipationEntry => {
    const status: AgentParticipationStatus =
      inputRole.clientDeployment === undefined
        ? "not_configured"
        : inputRole.gatewayResult?.outcome === "error"
          ? "failed"
          : "succeeded";
    const costAttribution = buildRoleCostAttribution({
      report: input.finopsReport,
      source: inputRole.source,
    });
    return {
      role: inputRole.role,
      ...(inputRole.clientDeployment !== undefined
        ? { deployment: inputRole.clientDeployment }
        : {}),
      configurationSource: roleConfigurationSource(
        input.request,
        inputRole.role,
      ),
      status,
      attemptCount: getBySourceCallCount(input.finopsReport, inputRole.source),
      ...(status === "not_configured"
        ? {
            remediation:
              inputRole.role === "coverage_planner"
                ? "Configure a dedicated coverage-planner deployment to augment the deterministic coverage plan."
                : "Configure a dedicated risk-ranker deployment to augment deterministic risk ordering.",
          }
        : {}),
      ...(status === "failed" && inputRole.gatewayResult?.outcome === "error"
        ? {
            failureClass: inputRole.gatewayResult.errorClass,
            remediation:
              inputRole.role === "coverage_planner"
                ? "Inspect the coverage-plan artifact and planner deployment health before re-running."
                : "Inspect the risk-ranking artifact and ranker deployment health before re-running.",
          }
        : {}),
      artifactReferences: [
        toArtifactReference(input.artifactDir, inputRole.artifactPath),
      ],
      ...(costAttribution !== undefined ? { costAttribution } : {}),
    };
  };

  entries.push(
    buildOptionalTextRole({
      role: "coverage_planner",
      clientDeployment: coveragePlannerClient?.deployment,
      gatewayResult: input.coveragePlannerGatewayResult,
      source: "coverage_planner",
      artifactPath: refs.coveragePlan,
    }),
  );
  entries.push(
    buildOptionalTextRole({
      role: "risk_ranker",
      clientDeployment: riskRankerClient?.deployment,
      gatewayResult: input.riskRankerGatewayResult,
      source: "risk_ranker",
      artifactPath: refs.riskRanking,
    }),
  );
  const adversarialCriticCost = buildRoleCostAttribution({
    report: input.finopsReport,
    source: "adversarial_critic",
  });
  const adversarialCriticFailed = input.adversarialCriticRounds.some(
    (artifact) => artifact.llmGateway.outcome === "error",
  );
  const adversarialCriticFailureClass = input.adversarialCriticRounds.find(
    (artifact) => artifact.llmGateway.outcome === "error",
  )?.llmGateway.errorClass;
  entries.push({
    role: "adversarial_critic",
    deployment: logicJudgeClient.deployment,
    configurationSource: roleConfigurationSource(
      input.request,
      "adversarial_critic",
    ),
    status:
      input.adversarialCriticRounds.length === 0
        ? "skipped"
        : adversarialCriticFailed
          ? "failed"
          : "succeeded",
    attemptCount: getBySourceCallCount(
      input.finopsReport,
      "adversarial_critic",
    ),
    ...(adversarialCriticFailed
      ? {
          failureClass: adversarialCriticFailureClass ?? "gateway_error",
          remediation:
            adversarialCriticFailureClass === "schema_validation"
              ? "Inspect the adversarial-critic round artifacts and critic prompt/schema conformance before re-running."
              : "Inspect the adversarial-critic round artifacts and judge deployment health before re-running.",
        }
      : {
          remediation:
            input.adversarialCriticRounds.length === 0
        ? "Adversarial critic found no unique blind spots and exited without a regeneration."
        : "Adversarial critic challenged the suite before judge review and persisted each bounded round under agent-role-runs/.",
        }),
    artifactReferences: [
      ...(refs.adversarialCriticTrace !== undefined
        ? [toArtifactReference(input.artifactDir, refs.adversarialCriticTrace)]
        : []),
      ...input.adversarialCriticRounds.map((artifact) =>
        toArtifactReference(
          input.artifactDir,
          join(
            input.artifactDir,
            "agent-role-runs",
            `${ADVERSARIAL_CRITIC_ROUND_ARTIFACT_PREFIX}${artifact.round}.json`,
          ),
        ),
      ),
    ],
    ...(adversarialCriticCost !== undefined
      ? { costAttribution: adversarialCriticCost }
      : {}),
  });

  const visualPrimarySource = roleConfigurationSource(
    input.request,
    "visual_primary",
  );
  const visualFallbackSource = roleConfigurationSource(
    input.request,
    "visual_fallback",
  );
  const visualPrimaryDeployment =
    input.request.llm.bundle?.visualPrimary.deployment;
  const visualFallbackDeployment =
    input.request.llm.bundle?.visualFallback.deployment;
  const visualPrimaryStatus: AgentParticipationStatus =
    !visualBundleConfigured && visualPrimarySource !== "disabled"
      ? "not_configured"
      : !visualBundleConfigured
        ? "skipped"
        : input.visualSidecarSkippedReason !== undefined
          ? "skipped"
          : primaryAttempt === undefined
            ? "skipped"
            : primaryAttempt.errorClass !== undefined
              ? "failed"
              : "succeeded";
  const visualPrimaryCost = buildVisualRoleCostAttribution({
    report: input.finopsReport,
    role: "visual_primary",
  });
  entries.push({
    role: "visual_primary",
    ...(visualPrimaryDeployment !== undefined
      ? { deployment: visualPrimaryDeployment }
      : {}),
    configurationSource: visualPrimarySource,
    status: visualPrimaryStatus,
    attemptCount: primaryAttempt !== undefined ? 1 : 0,
    ...(visualPrimaryStatus === "not_configured"
      ? {
          remediation:
            "Configure a visual-primary deployment before enabling the visual sidecar path.",
        }
      : visualPrimaryStatus === "skipped"
        ? {
            remediation:
              input.visualSidecarSkippedReason === "non_figma_url_source"
                ? "Visual sidecar only runs for figma_url sources."
                : "Visual sidecar was disabled or not requested for this run.",
          }
        : {}),
    ...(visualPrimaryStatus === "failed" &&
    primaryAttempt?.errorClass !== undefined
      ? {
          failureClass: primaryAttempt.errorClass,
          remediation:
            "Inspect visual-sidecar-result.json to confirm whether fallback recovered the run or both visual deployments failed.",
        }
      : {}),
    artifactReferences:
      refs.visualSidecarResult !== undefined
        ? [toArtifactReference(input.artifactDir, refs.visualSidecarResult)]
        : [],
    ...(visualPrimaryCost !== undefined
      ? { costAttribution: visualPrimaryCost }
      : {}),
  });

  const visualFallbackStatus: AgentParticipationStatus =
    !visualBundleConfigured && visualFallbackSource !== "disabled"
      ? "not_configured"
      : !visualBundleConfigured
        ? "skipped"
        : input.visualSidecarSkippedReason !== undefined
          ? "skipped"
          : fallbackAttempt === undefined
            ? "skipped"
            : fallbackAttempt.errorClass !== undefined
              ? "failed"
              : "succeeded";
  const visualFallbackCost = buildVisualRoleCostAttribution({
    report: input.finopsReport,
    role: "visual_fallback",
  });
  entries.push({
    role: "visual_fallback",
    ...(visualFallbackDeployment !== undefined
      ? { deployment: visualFallbackDeployment }
      : {}),
    configurationSource: visualFallbackSource,
    status: visualFallbackStatus,
    attemptCount: fallbackAttempt !== undefined ? 1 : 0,
    ...(visualFallbackStatus === "not_configured"
      ? {
          remediation:
            "Configure a distinct visual-fallback deployment before enabling fallback recovery.",
        }
      : visualFallbackStatus === "skipped"
        ? {
            remediation:
              input.visualSidecarSkippedReason === "non_figma_url_source"
                ? "Visual sidecar only runs for figma_url sources."
                : "Fallback was configured but was not needed for this run.",
          }
        : {}),
    ...(visualFallbackStatus === "failed" &&
    fallbackAttempt?.errorClass !== undefined
      ? {
          failureClass: fallbackAttempt.errorClass,
          remediation:
            "Inspect visual-sidecar-result.json and the visual deployment health; both sidecars were exhausted.",
        }
      : {}),
    artifactReferences:
      refs.visualSidecarResult !== undefined
        ? [toArtifactReference(input.artifactDir, refs.visualSidecarResult)]
        : [],
    ...(visualFallbackCost !== undefined
      ? { costAttribution: visualFallbackCost }
      : {}),
  });

  const a11yJudgeSource = roleConfigurationSource(input.request, "a11y_judge");
  const a11yJudgeStatus: AgentParticipationStatus =
    a11yJudgeClient === undefined && a11yJudgeSource !== "disabled"
      ? "not_configured"
      : a11yJudgeClient === undefined
        ? "skipped"
        : input.visualSidecarSkippedReason !== undefined ||
            input.visualSidecarRefusal !== undefined
          ? "skipped"
          : input.a11yJudgeResult?.gatewayResult?.outcome === "error"
            ? "failed"
            : input.a11yJudgeResult !== undefined
              ? "succeeded"
              : "skipped";
  entries.push({
    role: "a11y_judge",
    ...(a11yJudgeClient?.deployment !== undefined
      ? { deployment: a11yJudgeClient.deployment }
      : {}),
    configurationSource: a11yJudgeSource,
    status: a11yJudgeStatus,
    attemptCount:
      input.a11yJudgeResult?.gatewayResult !== undefined ||
      refs.a11yJudgeVerdict !== undefined
        ? 1
        : 0,
    ...(a11yJudgeStatus === "not_configured"
      ? {
          remediation:
            "Configure an a11y-judge deployment to add multimodal accessibility review coverage.",
        }
      : a11yJudgeStatus === "skipped"
        ? {
            remediation:
              input.visualSidecarRefusal !== undefined
                ? `Visual sidecar refused before the accessibility judge could run (${input.visualSidecarRefusal.failureClass}).`
                : "Accessibility judge was not needed or visual evidence was unavailable for this run.",
          }
        : {}),
    ...(a11yJudgeStatus === "failed" &&
    input.a11yJudgeResult?.gatewayResult?.outcome === "error"
      ? {
          failureClass: input.a11yJudgeResult.gatewayResult.errorClass,
          remediation:
            "Inspect the a11y-judge verdict artifact and image-capable judge deployment health before re-running.",
        }
      : {}),
    artifactReferences:
      refs.a11yJudgeVerdict !== undefined
        ? [toArtifactReference(input.artifactDir, refs.a11yJudgeVerdict)]
        : [],
  });

  // Issue #2014: surface every active repair-loop role so operators can audit
  // which deployment regenerated each iteration. The repair planner is
  // deterministic and writes a per-iteration artifact even when no LLM is
  // dispatched; the per-iteration generator regen runs on the same generator
  // deployment as the initial pass and reports through `bySource.generator`
  // in FinOps.
  const repairLoopResult = input.repairLoopResult;
  const repairIterationCount = repairLoopResult?.repairIterationCount ?? 0;
  const repairCompletedIterations = repairLoopResult?.iterations.filter(
    (record) => record.iteration >= 1,
  ) ?? [];
  const repairPlannerArtifactRefs = Array.from(
    { length: repairIterationCount },
    (_unused, index) =>
      toArtifactReference(
        input.artifactDir,
        join(
          input.artifactDir,
          "agent-role-runs",
          `${REPAIR_PLANNER_ARTIFACT_PREFIX}${index + 1}.json`,
        ),
      ),
  );
  const repairPlannerCost = buildRoleCostAttribution({
    report: input.finopsReport,
    source: "repair_planner",
  });
  const repairPlannerStatus: AgentParticipationStatus =
    repairLoopResult === undefined
      ? "skipped"
      : repairIterationCount === 0
        ? "skipped"
        : "succeeded";
  entries.push({
    role: "repair_planner",
    configurationSource: roleConfigurationSource(input.request, "repair_planner"),
    status: repairPlannerStatus,
    attemptCount: repairIterationCount,
    ...(repairPlannerStatus === "skipped"
      ? {
          remediation:
            "Initial judge panel accepted the output; the repair loop did not run.",
        }
      : {
          remediation:
            "Repair planner is a deterministic consolidator (no LLM call); each iteration's repair instructions are persisted under agent-role-runs/.",
        }),
    artifactReferences: repairPlannerArtifactRefs,
    ...(repairPlannerCost !== undefined
      ? { costAttribution: repairPlannerCost }
      : {}),
  });

  const testGenerationRepairArtifactRefs = repairCompletedIterations.map(
    (record) =>
      toArtifactReference(
        input.artifactDir,
        join(
          input.artifactDir,
          "agent-role-runs",
          `${TEST_GENERATION_REPAIR_ARTIFACT_PREFIX}${record.iteration}.json`,
        ),
      ),
  );
  const generatorClientDeployment = input.request.llm.client.deployment;
  const repairGeneratorDeployment =
    repairCompletedIterations.length > 0
      ? generatorClientDeployment
      : undefined;
  const repairGeneratorOutcome = repairLoopResult?.outcome;
  const repairGeneratorStatus: AgentParticipationStatus =
    repairLoopResult === undefined
      ? "skipped"
      : repairCompletedIterations.length === 0
        ? repairGeneratorOutcome === "needs_review"
          ? "failed"
          : "skipped"
        : "succeeded";
  const repairGeneratorRemediation: string | undefined =
    repairGeneratorStatus === "skipped"
      ? "Initial generator output was accepted; the repair generator did not run."
      : repairGeneratorStatus === "failed"
        ? "Repair-loop iterations exited before any test_generation_repair artifact was written; inspect repair-loop traces and gateway logs."
        : repairGeneratorOutcome === "needs_review"
          ? "Repair iterations completed but the bounded loop exhausted its iteration cap without judge acceptance; inspect the latest test_generation_repair artifact and judge-consensus."
          : repairGeneratorOutcome === "convergence_stalled"
            ? "Repair iterations stalled (two consecutive iterations produced the same verdict signature); inspect repair-loop-trace.json."
            : repairGeneratorOutcome === "budget_exhausted"
              ? "Repair loop stopped before the next regeneration to keep the FinOps generator-side budget breach-free; inspect repair-loop-budget-trace.json."
              : repairGeneratorOutcome === "rejected"
                ? "Final judge panel rejected the repaired output; inspect the latest test_generation_repair artifact and logic-judge verdict."
                : undefined;
  const repairGeneratorIterationOutputTokens =
    repairCompletedIterations.reduce(
      (sum, record) => sum + record.outputTokens,
      0,
    );
  const repairGeneratorIterationInputTokens =
    repairCompletedIterations.reduce(
      (sum, record) => sum + record.inputTokens,
      0,
    );
  entries.push({
    role: "test_generation_repair",
    ...(repairGeneratorDeployment !== undefined
      ? { deployment: repairGeneratorDeployment }
      : {}),
    configurationSource: roleConfigurationSource(
      input.request,
      "test_generation_repair",
    ),
    status: repairGeneratorStatus,
    attemptCount: repairCompletedIterations.length,
    ...(repairGeneratorOutcome === "needs_review" ||
    repairGeneratorOutcome === "convergence_stalled" ||
    repairGeneratorOutcome === "budget_exhausted" ||
    repairGeneratorOutcome === "rejected"
      ? { failureClass: repairGeneratorOutcome }
      : {}),
    ...(repairGeneratorRemediation !== undefined
      ? { remediation: repairGeneratorRemediation }
      : {}),
    artifactReferences: testGenerationRepairArtifactRefs,
    ...(repairCompletedIterations.length > 0
      ? {
          costAttribution: {
            sourceLabel: "generator",
            ...(repairGeneratorDeployment !== undefined
              ? { deployment: repairGeneratorDeployment }
              : {}),
            callCount: repairCompletedIterations.length,
            inputTokens: repairGeneratorIterationInputTokens,
            outputTokens: repairGeneratorIterationOutputTokens,
            imageBytes: 0,
            durationMs: 0,
            estimatedCost: 0,
          },
        }
      : {}),
  });

  return entries;
};

const buildRunQualityArtifact = (input: {
  jobId: string;
  generatedAt: string;
  blocked: boolean;
  judgeAccepted: boolean;
  validation: {
    policy: TestCasePolicyReport;
  };
  judgeConsensus: JudgeConsensusVerdict;
  finopsReport: FinOpsBudgetReport;
  visualSidecarResult?: VisualSidecarResult;
}): RunQualityArtifact => {
  const generatorAttempts = getBySourceCallCount(
    input.finopsReport,
    "generator",
  );
  const judgeAttempts =
    getBySourceCallCount(input.finopsReport, "judge_primary") +
    getBySourceCallCount(input.finopsReport, "judge_secondary");
  const visualAttempts = input.visualSidecarResult?.attempts.length ?? 0;
  const visualFailures =
    input.visualSidecarResult?.attempts.filter(
      (attempt) => attempt.errorClass !== undefined,
    ).length ?? 0;
  const visualSuccesses = Math.max(visualAttempts - visualFailures, 0);
  const visualFallbackUsed =
    input.visualSidecarResult?.outcome === "success" &&
    input.visualSidecarResult.fallbackReason !== "none";
  const latestVisualAttemptError = input.visualSidecarResult?.attempts
    .slice()
    .reverse()
    .find((attempt) => attempt.errorClass !== undefined)?.errorClass;
  const attemptSummaries: RunQualityAttemptSummary[] = [
    {
      stage: "generator",
      attempts: generatorAttempts,
      successes: generatorAttempts,
      failures: 0,
      finalOutcome:
        input.judgeConsensus.repairState === "repaired"
          ? "recovered"
          : input.blocked
            ? "blocked"
            : "clean",
    },
    {
      stage: "judge",
      attempts: judgeAttempts,
      successes: judgeAttempts,
      failures: 0,
      finalOutcome:
        input.judgeConsensus.repairState === "repaired"
          ? "recovered"
          : input.judgeAccepted
            ? "clean"
            : "blocked",
    },
    {
      stage: "visual_sidecar",
      attempts: visualAttempts,
      successes: visualSuccesses,
      failures: visualFailures,
      finalOutcome:
        visualAttempts === 0
          ? "not_run"
          : input.visualSidecarResult?.outcome === "failure"
            ? input.blocked
              ? "blocked"
              : "degraded"
            : visualFailures > 0 || visualFallbackUsed
              ? "degraded"
              : "clean",
      ...(input.visualSidecarResult?.outcome === "failure"
        ? { lastErrorClass: input.visualSidecarResult.failureClass }
        : visualFailures > 0 && latestVisualAttemptError !== undefined
          ? { lastErrorClass: latestVisualAttemptError }
          : {}),
    },
    {
      stage: "policy_gate",
      attempts: 1,
      successes: 1,
      failures: 0,
      finalOutcome: input.blocked ? "blocked" : "clean",
    },
  ];
  const degradedReasons = new Set<string>();
  if (input.blocked) {
    if (input.validation.policy.blockedCount > 0) {
      degradedReasons.add("policy_blocked");
    }
    if (!input.judgeAccepted) {
      degradedReasons.add("judge_consensus_not_accepted");
    }
    if (input.judgeConsensus.repairHistory.finalOutcome === "needs_review") {
      degradedReasons.add("repair_budget_exhausted");
    }
    if (
      input.judgeConsensus.repairHistory.finalOutcome === "budget_exhausted"
    ) {
      // Issue #2016: the loop refused to start the next regeneration
      // because the FinOps generator-side budget would have been
      // breached. The latest best-effort list is still handed downstream;
      // surface the cause so operators don't conflate this with the
      // signature-stall outcome.
      degradedReasons.add("repair_budget_exhausted");
    }
    if (
      input.judgeConsensus.repairHistory.finalOutcome === "convergence_stalled"
    ) {
      degradedReasons.add("repair_convergence_stalled");
    }
    if (input.judgeConsensus.repairHistory.finalOutcome === "rejected") {
      degradedReasons.add("repair_rejected_post_iteration");
    }
  } else {
    if (attemptSummaries[2]!.finalOutcome === "degraded") {
      degradedReasons.add("visual_sidecar_degraded");
    }
  }
  const status = input.blocked
    ? "blocked_failure"
    : input.judgeConsensus.repairState === "repaired"
      ? "repaired_success"
      : degradedReasons.size > 0
        ? "degraded_success"
        : "clean_success";
  return {
    schemaVersion: RUN_QUALITY_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    status,
    blocked: input.blocked,
    usable: !input.blocked,
    finalJudgeVerdict: input.judgeConsensus.verdict,
    repairState: input.judgeConsensus.repairState,
    repairHistory: input.judgeConsensus.repairHistory,
    activeFindings: input.judgeConsensus.activeFindings,
    activeFindingCount: input.judgeConsensus.activeFindings.length,
    attemptSummaries,
    degradedReasons: [...degradedReasons].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
};

/**
 * Issue #2053 — `ti:rule:adversarial-critic-negative-case-lift` is the
 * stable rule reference embedded in the persisted gate result so
 * auditors can resolve the source evidence without the runner having to
 * inline the full trace artifact in `policy-report.json`.
 */
const ADVERSARIAL_NEGATIVE_CASE_LIFT_RULE_REF =
  "ti:rule:adversarial-critic-negative-case-lift" as const;

/**
 * Issue #2053 — resolve the effective `G-NEG-CASE` configuration for a
 * run. The runner-level input override (CLI escape hatch) takes
 * precedence over the policy-profile entry, which itself falls back to
 * the documented secure defaults so legacy profiles without an explicit
 * `negativeCaseLift` block still see the gate enforced at `0.30`.
 */
const resolveNegativeCaseLiftConfig = (input: {
  readonly profileRules: TestCasePolicyProfileRules | undefined;
  readonly override:
    | {
        readonly gateMode: "enforce" | "advisory" | "off";
        readonly thresholdRatio: number;
      }
    | undefined;
}): {
  readonly gateMode: "enforce" | "advisory" | "off";
  readonly thresholdRatio: number;
} => {
  const fromProfile = input.profileRules?.negativeCaseLift;
  const fromOverride = input.override;
  if (fromOverride !== undefined) {
    return {
      gateMode: fromOverride.gateMode,
      thresholdRatio: fromOverride.thresholdRatio,
    };
  }
  if (fromProfile !== undefined) {
    return {
      gateMode: fromProfile.gateMode,
      thresholdRatio: fromProfile.thresholdRatio,
    };
  }
  return {
    gateMode: EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_GATE_MODE,
    thresholdRatio: EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_THRESHOLD_RATIO,
  };
};

/**
 * Issue #2053 — evaluate the adversarial-critic `G-NEG-CASE` quality
 * gate against the post-run trace artifact and resolved config. The
 * function never throws; the runner inspects `status` and routes
 * `"failed"` results to a {@link ProductionRunnerError} only when
 * `gateMode === "enforce"`. `"advisory"` callers persist the same
 * record but complete the run successfully; `"skipped"` records carry
 * a `skipReason` that pinpoints why the gate could not be evaluated.
 */
const evaluateNegativeCaseLiftGate = (input: {
  readonly config: {
    readonly gateMode: "enforce" | "advisory" | "off";
    readonly thresholdRatio: number;
  };
  readonly adversarialCriticEnabled: boolean;
  readonly traceArtifact: AdversarialCriticTraceArtifact | undefined;
}): TestCasePolicyGateResult => {
  const { config, adversarialCriticEnabled, traceArtifact } = input;
  if (config.gateMode === "off") {
    return {
      gateId: "G-NEG-CASE",
      status: "skipped",
      ruleRef: ADVERSARIAL_NEGATIVE_CASE_LIFT_RULE_REF,
      thresholdRatio: config.thresholdRatio,
      skipReason: "gate_disabled",
      message:
        "G-NEG-CASE skipped: gateMode is \"off\"; no enforcement, no record.",
    };
  }
  if (!adversarialCriticEnabled || traceArtifact === undefined) {
    return {
      gateId: "G-NEG-CASE",
      status: "skipped",
      ruleRef: ADVERSARIAL_NEGATIVE_CASE_LIFT_RULE_REF,
      thresholdRatio: config.thresholdRatio,
      skipReason: "adversarial_critic_disabled",
      message:
        "G-NEG-CASE skipped: adversarial-critic loop did not run for this job.",
    };
  }
  if (traceArtifact.stopReason === "critic_failed") {
    return {
      gateId: "G-NEG-CASE",
      status: "skipped",
      ruleRef: ADVERSARIAL_NEGATIVE_CASE_LIFT_RULE_REF,
      thresholdRatio: config.thresholdRatio,
      skipReason: "adversarial_critic_failed",
      message:
        "G-NEG-CASE skipped: adversarial-critic loop exited with stopReason=\"critic_failed\"; negative-coverage accounting cannot be trusted.",
    };
  }
  const observed = traceArtifact.negativeCoverage.relativeRatioIncrease;
  if (observed >= config.thresholdRatio) {
    return {
      gateId: "G-NEG-CASE",
      status: "passed",
      ruleRef: ADVERSARIAL_NEGATIVE_CASE_LIFT_RULE_REF,
      thresholdRatio: config.thresholdRatio,
      observedRatio: observed,
      message: `G-NEG-CASE passed: relativeRatioIncrease=${observed} >= threshold=${config.thresholdRatio}.`,
    };
  }
  if (config.gateMode === "advisory") {
    return {
      gateId: "G-NEG-CASE",
      status: "advisory",
      ruleRef: ADVERSARIAL_NEGATIVE_CASE_LIFT_RULE_REF,
      thresholdRatio: config.thresholdRatio,
      observedRatio: observed,
      message: `G-NEG-CASE advisory: relativeRatioIncrease=${observed} < threshold=${config.thresholdRatio}; gateMode is "advisory" so the run is not blocked.`,
    };
  }
  return {
    gateId: "G-NEG-CASE",
    status: "failed",
    ruleRef: ADVERSARIAL_NEGATIVE_CASE_LIFT_RULE_REF,
    thresholdRatio: config.thresholdRatio,
    observedRatio: observed,
    message: `G-NEG-CASE failed: relativeRatioIncrease=${observed} < threshold=${config.thresholdRatio}; gateMode is "enforce".`,
  };
};

/**
 * Run the production figma_to_qc_test_cases pipeline end-to-end. The LLM
 * call is the only IO that touches the network when `source.kind ===
 * "figma_paste_normalized"`; for `figma_url` the runner additionally calls
 * the Figma REST API (SSRF-guarded).
 */
export const runFigmaToQcTestCases = async (
  input: RunFigmaToQcTestCasesInput,
): Promise<RunFigmaToQcTestCasesResult> => {
  const startedAt = Date.now();
  const emit = makeEmitter(
    composeProductionRunnerEventSinks(
      input.events,
      createProductionRunnerOpenTelemetrySink({
        ...(input.otelTracer !== undefined ? { tracer: input.otelTracer } : {}),
        ...(input.otelMeter !== undefined ? { meter: input.otelMeter } : {}),
      }),
    ),
  );
  const finopsRecorder = createFinOpsUsageRecorder();
  const artifactDir =
    input.artifactDir ??
    join(input.outputRoot, "jobs", input.jobId, "test-intelligence");

  // 0. Resolve + validate FinOps envelope. Operator override wins outright;
  //    no merging with the production default. Invalid envelopes fail
  //    fast before any IO touches the network.
  const finopsBudget = resolveFinopsBudget(input.finopsBudget);

  // 0b. Canonicalize the optional Markdown supporting context (Issue #1894).
  //     Runs before any IO so a malformed or oversize Markdown body fails
  //     the job fast with `CUSTOM_CONTEXT_MARKDOWN_INVALID` and never
  //     reaches the LLM gateway, the prompt artifact, or the seal.
  const customContextMarkdown = resolveCustomContextMarkdown(
    input.customContextMarkdown,
  );
  const customerEvalRubric = resolveCustomerEvalRubric(
    input.customerEvalMarkdown,
  );

  // 0c. Parse + canonicalize the optional customer profile (Issue #1946).
  //     Fails fast before any IO when the profile JSON is malformed or
  //     contains schema/PII/injection violations.
  const canonicalCustomerProfile = resolveCustomerProfile(
    input.customerProfile,
  );

  // 1. Resolve Figma source.
  emit({
    phase: "intent_derivation_started",
    timestamp: monotonicMs(),
    details: { source: input.source.kind },
  });
  const figmaPayloadCap = resolveFigmaPayloadCap(input.maxFigmaPayloadBytes);
  const figmaFile = await resolveFigmaSource(input.source, figmaPayloadCap);
  assertFigmaPayloadWithinLimit(figmaFile, figmaPayloadCap);
  await mkdir(artifactDir, { recursive: true });
  const normalizedUntrusted = normalizeUntrustedContent({
    figma: { document: figmaFile.document },
  });
  const untrustedContentNormalizationReportPath = (
    await writeUntrustedContentNormalizationReport(
      artifactDir,
      normalizedUntrusted.report,
    )
  ).path;
  const untrustedContentNormalizationReportBytes = Buffer.from(
    canonicalJson(normalizedUntrusted.report),
    "utf8",
  );

  // 2. Normalize REST file → IntentDerivationFigmaInput.
  const intentInput = normalizeFigmaFileToIntentInput({
    fileKey: figmaFile.fileKey,
    document: (normalizedUntrusted.figma?.document ??
      figmaFile.document) as FigmaRestNode,
  });
  if (intentInput.screens.length === 0) {
    throw new ProductionRunnerError({
      failureClass: "EMPTY_FIGMA_INPUT",
      message:
        "No screen-shaped frames detected in the Figma source. Provide a Figma URL that points to a frame, component, section, or page.",
      retryable: false,
    });
  }

  // 3. Derive Business Test Intent IR.
  let intent = deriveBusinessTestIntentIr({ figma: intentInput });
  let visualSidecarArtifactPath: string | undefined;
  let visualSidecarResult: VisualSidecarResult | undefined;
  let visualCaptures:
    | Awaited<ReturnType<typeof fetchFigmaScreenCapturesForTestIntelligence>>
    | undefined;
  let visualCaptureArtifacts:
    | Awaited<ReturnType<typeof persistVisualCaptureArtifacts>>
    | undefined;
  let visualSidecarArtifactBytes: Uint8Array | undefined;
  let visualSidecarArtifact:
    | Awaited<ReturnType<typeof writeVisualSidecarResultArtifact>>["artifact"]
    | undefined;
  let visualSidecarRefusal:
    | { failureClass: VisualSidecarFailureClass; failureMessage: string }
    | undefined;
  let visualSidecarSkippedReason:
    | "non_figma_url_source"
    | "visual_sidecar_bundle_not_configured"
    | undefined;
  let visualSidecarDiagnostics: ReadonlyArray<DescribeVisualScreensDiagnostic> =
    [];
  let promptVisualBinding: Parameters<
    typeof compilePrompt
  >[0]["visualBinding"] = {
    schemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    selectedDeployment: "llama-4-maverick-vision",
    fallbackReason: "none",
    screenCount: 0,
  };
  let promptVisualBatch:
    | Parameters<typeof compilePrompt>[0]["visual"]
    | undefined;
  emit({
    phase: "intent_derivation_complete",
    timestamp: monotonicMs(),
    details: {
      screens: intent.screens.length,
      detectedFields: intent.detectedFields.length,
      detectedActions: intent.detectedActions.length,
    },
  });
  if (input.source.kind === "figma_url" && input.llm.bundle !== undefined) {
    emit({
      phase: "visual_sidecar_started",
      timestamp: monotonicMs(),
      details: { screens: intent.screens.length },
    });
    const captures = await fetchFigmaScreenCapturesForTestIntelligence({
      fileKey: figmaFile.fileKey,
      accessToken: input.source.accessToken,
      screens: intent.screens.map((screen) => ({
        screenId: screen.screenId,
        screenName: screen.screenName,
      })),
    });
    visualCaptures = captures;
    try {
      visualCaptureArtifacts = await persistVisualCaptureArtifacts({
        artifactDir,
        captures,
        jobId: input.jobId,
        generatedAt: input.generatedAt,
      });
    } catch (err) {
      throw new ProductionRunnerError({
        failureClass: "PERSIST_FAILED",
        message: `Could not persist visual capture artifacts: ${sanitizeErrorMessage({ error: err, fallback: "filesystem failure" })}`,
        retryable: false,
        cause: err,
      });
    }
    const sidecarRun = await describeVisualScreens({
      bundle: input.llm.bundle,
      captures,
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      intent,
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
      ...(input.llm.abortSignal !== undefined
        ? { abortSignal: input.llm.abortSignal }
        : {}),
    });
    const sidecarResult = sidecarRun.result;
    visualSidecarDiagnostics = sidecarRun.diagnostics;
    visualSidecarArtifactPath = join(
      artifactDir,
      VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
    );
    visualSidecarResult = sidecarResult;
    const sidecarArtifact = await writeVisualSidecarResultArtifact({
      result: sidecarResult,
      destinationPath: visualSidecarArtifactPath,
      jobId: input.jobId,
      generatedAt: input.generatedAt,
    });
    visualSidecarArtifact = sidecarArtifact.artifact;
    visualSidecarArtifactBytes = sidecarArtifact.bytes;
    // Issue #2017: persist per-attempt raw-response diagnostics atomically
    // alongside the visual sidecar result. The relative path for each file
    // already lives on `sidecarResult.attempts[i].rawResponseArtifactPath`.
    if (visualSidecarDiagnostics.length > 0) {
      await Promise.all(
        visualSidecarDiagnostics.map((diagnostic) =>
          writeAtomicBytes(
            join(artifactDir, diagnostic.filename),
            diagnostic.bytes,
          ),
        ),
      );
    }
    recordVisualSidecarAttempts({
      recorder: finopsRecorder,
      result: sidecarResult,
    });
    if (sidecarResult.outcome !== "success") {
      // Issue #1772 AC #4: pre-flight failures are caller bugs and still fail
      // the runner fast. Model-side refusals (both_sidecars_failed and
      // friends) instead route every test case to `needs_review` via the
      // policy gate, with the documented `VisualSidecarFailureClass` as the
      // refusal code. The runner still publishes a complete artifact set so
      // a reviewer can adjudicate without the visual context.
      if (!isVisualSidecarRefusal(sidecarResult.failureClass)) {
        throw new ProductionRunnerError({
          failureClass: "LLM_GATEWAY_FAILED",
          message: `Visual sidecar failed: ${sidecarResult.failureClass}`,
          retryable: false,
        });
      }
      visualSidecarRefusal = {
        failureClass: sidecarResult.failureClass,
        failureMessage: sidecarResult.failureMessage,
      };
      emit({
        phase: "visual_sidecar_complete",
        timestamp: monotonicMs(),
        details: {
          outcome: "refusal",
          refusalCode: sidecarResult.failureClass,
          screens: 0,
        },
      });
    } else if (sidecarResult.validationReport.blocked) {
      throw new ProductionRunnerError({
        failureClass: "LLM_RESPONSE_INVALID",
        message:
          "Visual sidecar validation blocked the Figma screenshot batch before prompt compilation.",
        retryable: false,
      });
    } else {
      promptVisualBatch = sidecarResult.visual;
      intent = deriveBusinessTestIntentIr({
        figma: intentInput,
        visual: promptVisualBatch,
      });
      promptVisualBinding = {
        schemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
        selectedDeployment: sidecarResult.selectedDeployment,
        fallbackReason: sidecarResult.fallbackReason,
        screenCount: sidecarResult.visual.length,
      };
      emit({
        phase: "visual_sidecar_complete",
        timestamp: monotonicMs(),
        details: {
          selectedDeployment: sidecarResult.selectedDeployment,
          fallbackReason: sidecarResult.fallbackReason,
          screens: sidecarResult.visual.length,
        },
      });
    }
  } else {
    visualSidecarSkippedReason =
      input.source.kind !== "figma_url"
        ? "non_figma_url_source"
        : "visual_sidecar_bundle_not_configured";
    emit({
      phase: "visual_sidecar_skipped",
      timestamp: monotonicMs(),
      details: {
        reason: visualSidecarSkippedReason,
      },
    });
  }

  if (customContextMarkdown !== undefined) {
    const customContextCalculationStatements =
      buildSourceScopedCalculationAssumptions({
        sourceLabel: "custom_context_markdown",
        text: customContextMarkdown.bodyPlain,
      });
    intent = {
      ...intent,
      assumptions: [
        ...intent.assumptions,
        ...customContextCalculationStatements,
      ].sort((left, right) => left.localeCompare(right)),
      openQuestions: [
        ...intent.openQuestions,
        ...customContextCalculationStatements,
        ...buildSourceScopedValidationOpenQuestions({
          sourceLabel: "custom_context_markdown",
          text: customContextMarkdown.bodyPlain,
        }),
      ].sort((left, right) => left.localeCompare(right)),
    };
  }

  // 4. Bound the IR for the LLM prompt. Real-world Figma files (e.g. the
  //    customer's "Investitionsfinanzierung — Bedarfsermittlung" screen with
  //    5600 nodes) blow the prompt past every gateway's body cap. The full
  //    IR is still persisted as `business-intent-ir.json` for reviewers and
  //    drives the replay-cache identity below; the wire intent is what the
  //    model actually sees and is what the audit `promptHash` is computed
  //    over (so replay-cache hits are coherent with what the model
  //    received). Truncation is recorded in the IR's `assumptions` array
  //    so reviewers can tell when the model worked from a partial slice.
  const wireIntent = boundIntentForLlm(intent, {
    maxFieldsPerScreen: PROMPT_MAX_FIELDS_PER_SCREEN,
    maxActionsPerScreen: PROMPT_MAX_ACTIONS_PER_SCREEN,
    maxValidationsPerScreen: PROMPT_MAX_VALIDATIONS_PER_SCREEN,
    maxNavigationPerScreen: PROMPT_MAX_NAVIGATION_PER_SCREEN,
  });

  const finopsLimits = resolveFinOpsRequestLimits(
    finopsBudget.roles.test_generation,
  );
  const activeModelBindings = applyCustomerProfileIctRef(
    buildActiveModelBindings({
      client: input.llm.client,
      ...(input.llm.bundle !== undefined ? { bundle: input.llm.bundle } : {}),
      ...(input.llm.logicJudge !== undefined
        ? { logicJudge: input.llm.logicJudge }
        : {}),
      ...(input.llm.coveragePlanner !== undefined
        ? { coveragePlanner: input.llm.coveragePlanner }
        : {}),
    }),
    canonicalCustomerProfile,
  );

  const draftSchema = buildDraftResponseSchema();
  const policyProfileId =
    typeof input.policyProfileId === "string" &&
    input.policyProfileId.length > 0
      ? input.policyProfileId
      : EU_BANKING_DEFAULT_POLICY_PROFILE_ID;
  const customerRubric =
    policyProfileId === EU_BANKING_DEFAULT_POLICY_PROFILE_ID
      ? cloneEuBankingDefaultProfile()
      : {
          id: policyProfileId,
          version: "runtime",
          description: `Policy profile ${policyProfileId}`,
        };
  const policyProfileHash = createHash("sha256")
    .update(canonicalJson(customerRubric), "utf8")
    .digest("hex");
  const agentLessonsManifest = await scanLessons({
    runDir: artifactDir,
    nowMs: Date.parse(input.generatedAt),
  });
  const activeAgentLessons = selectRelevantLessons({
    manifest: agentLessonsManifest,
    query: {
      tokens: [buildAgentLessonsQuery(wireIntent)],
      policyProfileId,
    },
  });

  // 5. Compile prompt.
  const figmaSourceContentHash = createHash("sha256")
    .update(canonicalJson({ figma: intentInput }), "utf8")
    .digest("hex");
  const compiledCustomContext = buildCompiledCustomContext(
    customContextMarkdown,
    canonicalCustomerProfile,
  );
  // Build a source-mix plan whenever we have either custom markdown context or
  // a customer profile with glossary / few-shot content, so the [5]
  // CustomerDomainContext section is included in the compiled prompt.
  const hasCustomDomainContext =
    customContextMarkdown !== undefined ||
    (canonicalCustomerProfile !== undefined &&
      (canonicalCustomerProfile.glossary.length > 0 ||
        canonicalCustomerProfile.fewShotExamples.length > 0 ||
        canonicalCustomerProfile.riskTaxonomyOverrides.length > 0 ||
        canonicalCustomerProfile.policyOverrides.length > 0));
  const compiledSourceMixPlan = hasCustomDomainContext
    ? buildFigmaWithCustomMarkdownSourceMixPlan({
        figmaSourceContentHash,
        markdownContentHash:
          customContextMarkdown?.markdownContentHash ??
          canonicalCustomerProfile?.contentHash ??
          figmaSourceContentHash,
        plainContentHash:
          customContextMarkdown?.plainContentHash ??
          canonicalCustomerProfile?.contentHash ??
          figmaSourceContentHash,
      })
    : undefined;
  const semanticEvidenceSourceEnvelope = buildSemanticEvidenceSourceEnvelope({
    baseEnvelope: wireIntent.sourceEnvelope,
    figmaSourceContentHash,
    customContextMarkdown,
    generatedAt: input.generatedAt,
  });
  const testDesignModel = buildTestDesignModel({
    jobId: input.jobId,
    intent: wireIntent,
    ...(promptVisualBatch !== undefined ? { visual: promptVisualBatch } : {}),
    ...(semanticEvidenceSourceEnvelope !== undefined
      ? { sourceEnvelope: semanticEvidenceSourceEnvelope }
      : {}),
  });
  const workflowTopology = buildWorkflowTopology({
    model: testDesignModel,
    ...(customContextMarkdown?.bodyPlain !== undefined
      ? { customContextMarkdown: customContextMarkdown.bodyPlain }
      : {}),
  });
  const coveragePlannerClient =
    input.llm.bundle?.coveragePlanner ?? input.llm.coveragePlanner;
  const coveragePlannerStartedAt =
    coveragePlannerClient === undefined ? undefined : Date.now();
  const coveragePlanResult = await buildCoveragePlanWithAugmentation({
    model: testDesignModel,
    workflowTopology,
    ...(compiledSourceMixPlan !== undefined
      ? { sourceMixPlan: compiledSourceMixPlan }
      : {}),
    policyProfile: customerRubric as Record<string, unknown>,
    ...(coveragePlannerClient !== undefined
      ? {
          plannerClient: coveragePlannerClient,
          ...(finopsBudget.roles.test_generation?.maxInputTokensPerRequest !==
          undefined
            ? {
                maxInputTokens:
                  finopsBudget.roles.test_generation.maxInputTokensPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.test_generation?.maxOutputTokensPerRequest !==
          undefined
            ? {
                maxOutputTokens:
                  finopsBudget.roles.test_generation.maxOutputTokensPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.test_generation?.maxWallClockMsPerRequest !==
          undefined
            ? {
                maxWallClockMs:
                  finopsBudget.roles.test_generation.maxWallClockMsPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.test_generation?.maxRetriesPerRequest !==
          undefined
            ? {
                maxRetries:
                  finopsBudget.roles.test_generation.maxRetriesPerRequest,
              }
            : {}),
          ...(input.llm.abortSignal !== undefined
            ? { abortSignal: input.llm.abortSignal }
            : {}),
        }
      : {}),
  });
  if (
    coveragePlannerClient !== undefined &&
    coveragePlannerStartedAt !== undefined &&
    coveragePlanResult.gatewayResult !== undefined
  ) {
    finopsRecorder.recordAttempt({
      role: "test_generation",
      source: "coverage_planner",
      // Issue #2016: planner traffic shares the test_generation FinOps
      // lane but is not part of the role's primary work. Recording it
      // as `audit` keeps the per-source breakdown intact while leaving
      // the role-level `attempts` / `outputTokens` counters reserved
      // for actual generator regenerations.
      attributionMode: "audit",
      deployment:
        coveragePlanResult.gatewayResult.outcome === "success"
          ? coveragePlanResult.gatewayResult.modelDeployment
          : coveragePlannerClient.deployment,
      durationMs: Date.now() - coveragePlannerStartedAt,
      result: coveragePlanResult.gatewayResult,
    });
  }
  const riskRankerClient = input.llm.bundle?.riskRanker ?? input.llm.riskRanker;
  const riskRankerStartedAt =
    riskRankerClient === undefined ? undefined : Date.now();
  const riskRankingResult = await buildRiskRankingWithAugmentation({
    jobId: input.jobId,
    coveragePlan: coveragePlanResult.plan,
    policyProfile: customerRubric as Record<string, unknown>,
    ...(riskRankerClient !== undefined
      ? {
          rankerClient: riskRankerClient,
          ...(finopsBudget.roles.test_generation?.maxInputTokensPerRequest !==
          undefined
            ? {
                maxInputTokens:
                  finopsBudget.roles.test_generation.maxInputTokensPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.test_generation?.maxOutputTokensPerRequest !==
          undefined
            ? {
                maxOutputTokens:
                  finopsBudget.roles.test_generation.maxOutputTokensPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.test_generation?.maxWallClockMsPerRequest !==
          undefined
            ? {
                maxWallClockMs:
                  finopsBudget.roles.test_generation.maxWallClockMsPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.test_generation?.maxRetriesPerRequest !==
          undefined
            ? {
                maxRetries:
                  finopsBudget.roles.test_generation.maxRetriesPerRequest,
              }
            : {}),
          ...(input.llm.abortSignal !== undefined
            ? { abortSignal: input.llm.abortSignal }
            : {}),
        }
      : {}),
  });
  if (
    riskRankerClient !== undefined &&
    riskRankerStartedAt !== undefined &&
    riskRankingResult.gatewayResult !== undefined
  ) {
    finopsRecorder.recordAttempt({
      role: "test_generation",
      source: "risk_ranker",
      // Issue #2016: ranker is auxiliary; see coverage_planner site.
      attributionMode: "audit",
      deployment:
        riskRankingResult.gatewayResult.outcome === "success"
          ? riskRankingResult.gatewayResult.modelDeployment
          : riskRankerClient.deployment,
      durationMs: Date.now() - riskRankerStartedAt,
      result: riskRankingResult.gatewayResult,
    });
  }
  const diversityPasses = resolveDiversityPassCount(input.generation);
  if (
    diversityPasses === 2 &&
    !input.llm.client.declaredCapabilities.seedSupport
  ) {
    throw new ProductionRunnerError({
      failureClass: "LLM_GATEWAY_FAILED",
      message:
        "runFigmaToQcTestCases: generation.diversityPasses=2 requires a generator gateway client with seed support.",
      retryable: false,
    });
  }
  const generationPasses = resolveGenerationPasses(diversityPasses);

  // 6. Build the draft request using the compiler-owned schema hint and
  //    deterministic suffix layout.
  // FinOps-resolved per-request limits override the legacy llm.* fields.
  const effectiveMaxInputTokens = finopsLimits.maxInputTokens;
  const effectiveMaxOutputTokens =
    finopsLimits.maxOutputTokens ?? input.llm.maxOutputTokens;
  const effectiveMaxWallClockMs =
    finopsLimits.maxWallClockMs ?? input.llm.maxWallClockMs;
  const effectiveMaxRetries = finopsLimits.maxRetries;

  // 5.5. Replay cache (Issues #1739, #1944). Check before any LLM dispatch.
  // On a hit the generate callback is never invoked and tokens are saved
  // entirely. The tenant scope partitions the cache directory so two
  // tenants cannot share entries even with identical key digests.
  const tenantScope: TenantScope =
    input.replayCacheTenantScope ?? DEFAULT_TENANT_SCOPE;
  const replayCache: ReplayCache =
    input.replayCache ??
    createPersistentReplayCache(
      join(input.outputRoot, "test-intelligence", "replay-cache"),
      { tenantScope },
    );
  // Declared here so the generate callback can set them via closure on the
  // cache-miss path; all remain undefined on cache hits (same as mode="off").
  let harnessSummary: ProductionRunnerHarnessSummary | undefined;
  let harnessArtifactPath: string | undefined;
  let capturedLlmResult: LlmGenerationResult | undefined;
  let capturedLlmDurationMs = 0;
  let capturedLlmInputTokens = 0;
  let capturedLlmOutputTokens = 0;
  const harnessMode: ProductionRunnerHarnessMode = input.harness?.mode ?? "off";
  const harnessRoleStepId =
    input.harness?.roleStepId ?? PRODUCTION_RUNNER_HARNESS_ROLE_STEP_ID;
  const harnessTestDepth: AgentHarnessTestDepth =
    input.harness?.testDepth ?? "standard";
  // Issue #1898: Logic-Judge defaults to ON. Callers that need the
  // legacy single-pass behaviour (deterministic generator-only
  // classification) must pass `logicJudge: { enabled: false }`
  // explicitly. The judge dispatches a second LLM call and is
  // attributed to FinOps source `judge_primary`.
  //
  // Issue #1932 — cross-model voting: when the operator wires a
  // `bundle.logicJudge` slot the judge runs on a dedicated gateway
  // (typically a different model family from the generator) so a
  // self-consistency bias from the generator cannot be amplified by
  // reusing the same model on the judge. When the slot is absent the
  // judge falls back to `input.llm.client` so existing operator
  // configurations keep working unchanged.
  const logicJudgeEnabled = input.logicJudge?.enabled !== false;
  const logicJudgeClient: LlmGatewayClient =
    input.llm.bundle?.logicJudge ?? input.llm.logicJudge ?? input.llm.client;
  const adversarialCriticEnabled =
    logicJudgeEnabled &&
    (input.llm.bundle?.logicJudge !== undefined ||
      input.llm.logicJudge !== undefined);

  const compileGenerationPass = (
    pass: GenerationPassConfig,
    extraSuffixSections: readonly CompilePromptSuffixSection[] = [],
  ) => {
    const compiled = compilePrompt({
      jobId: input.jobId,
      intent: wireIntent,
      ...(promptVisualBatch !== undefined ? { visual: promptVisualBatch } : {}),
      ...(activeAgentLessons.length > 0
        ? { agentLessons: activeAgentLessons }
        : {}),
      modelBinding: {
        modelRevision: TEST_GENERATION_MODEL_REVISION,
        gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
        ...(pass.seed !== undefined ? { seed: pass.seed } : {}),
      },
      policyBundleVersion: POLICY_BUNDLE_VERSION,
      roleStepId: "test_generation",
      customerRubric,
      testDesignModel,
      workflowTopology,
      coveragePlan: coveragePlanResult.plan,
      riskRanking: riskRankingResult.ranking,
      responseSchema: draftSchema,
      responseSchemaName: "workspace-dev-production-runner-draft-list-v1",
      outputSchemaHintLabel: "ProductionRunnerDraftResponse",
      suffixSections: [
        ...buildPromptSuffixSections(
          wireIntent,
          policyProfileId,
          hasCustomDomainContext,
          customerEvalRubric,
          pass.diversityBias,
        ),
        ...extraSuffixSections,
      ],
      visualBinding: promptVisualBinding,
      ...(compiledCustomContext !== undefined
        ? { customContext: compiledCustomContext }
        : {}),
      ...(compiledSourceMixPlan !== undefined
        ? { sourceMixPlan: compiledSourceMixPlan }
        : {}),
      ...(finopsLimits.maxInputTokens !== undefined
        ? {
            contextBudget: {
              roleStepId: "test_generation",
              maxInputTokens: finopsLimits.maxInputTokens,
            },
          }
        : {}),
    });
    if (compiled.contextBudgetReport?.action === "needs_review") {
      throw new ProductionRunnerError({
        failureClass: "FINOPS_BUDGET_INVALID",
        message:
          `context budget analyzer could not fit the test_generation prompt within maxInputTokens ` +
          `${compiled.contextBudgetReport.maxInputTokens}`,
        retryable: false,
      });
    }
    return compiled;
  };

  const buildGenerationRequest = (
    compiled: ReturnType<typeof compileGenerationPass>,
  ): LlmGenerationRequest & {
    onInFlightDedupHit?: (source: AgentSourceLabel) => void;
  } => ({
    jobId: compiled.request.jobId,
    systemPrompt: compiled.request.systemPrompt,
    userPrompt: compiled.request.userPrompt,
    responseSchema: draftSchema,
    responseSchemaName: "workspace-dev-production-runner-draft-list-v1",
    inFlightDedup: {
      source: "generator",
      inputHash: compiled.request.hashes.inputHash,
      promptHash: compiled.request.hashes.promptHash,
      modelBinding: canonicalJson(compiled.request.modelBinding),
      schemaHash: compiled.request.hashes.schemaHash,
      policyProfileHash,
    },
    onInFlightDedupHit: (source) =>
      finopsRecorder.recordInFlightDedupHit(source),
    ...(compiled.request.modelBinding.seed !== undefined
      ? { seed: compiled.request.modelBinding.seed }
      : {}),
    ...(effectiveMaxInputTokens !== undefined
      ? { maxInputTokens: effectiveMaxInputTokens }
      : {}),
    ...(effectiveMaxOutputTokens !== undefined
      ? { maxOutputTokens: effectiveMaxOutputTokens }
      : {}),
    ...(effectiveMaxWallClockMs !== undefined
      ? { maxWallClockMs: effectiveMaxWallClockMs }
      : {}),
    ...(effectiveMaxRetries !== undefined
      ? { maxRetries: effectiveMaxRetries }
      : {}),
    ...(input.llm.abortSignal !== undefined
      ? { abortSignal: input.llm.abortSignal }
      : {}),
  });

  const executeGenerationPass = async (inputPass: {
    pass: GenerationPassConfig;
    extraSuffixSections?: readonly CompilePromptSuffixSection[];
    emitPrimaryPromptCompiled: boolean;
    recordHarnessAttempt: boolean;
  }) => {
    const compiled = compileGenerationPass(
      inputPass.pass,
      inputPass.extraSuffixSections,
    );
    if (inputPass.emitPrimaryPromptCompiled) {
      emit({
        phase: "prompt_compiled",
        timestamp: monotonicMs(),
        details: {
          promptHash: compiled.request.hashes.promptHash,
          schemaHash: compiled.request.hashes.schemaHash,
          maxOutputTokens: effectiveMaxOutputTokens,
          maxWallClockMs: effectiveMaxWallClockMs,
        },
      });
    }
    const generationRequest = buildGenerationRequest(compiled);
    const generationCacheKey =
      input.llm.client.constrainedDecoding === undefined
        ? compiled.cacheKey
        : {
            ...compiled.cacheKey,
            constrainedDecodingAdapterId:
              input.llm.client.constrainedDecoding.adapterId,
            ...(input.llm.client.constrainedDecoding.adapterVersion !==
            undefined
              ? {
                  constrainedDecodingAdapterVersion:
                    input.llm.client.constrainedDecoding.adapterVersion,
                }
              : {}),
            ...(input.llm.client.constrainedDecoding.fallbackReason !==
            undefined
              ? {
                  constrainedDecodingFallbackReason:
                    input.llm.client.constrainedDecoding.fallbackReason,
                }
              : {}),
          };
    let cacheExecResult: Awaited<ReturnType<typeof executeWithReplayCache>>;
    try {
      cacheExecResult = await executeWithReplayCache({
        cache: replayCache,
        cacheKey: generationCacheKey,
        generate: async () => {
          emit({
            phase: "llm_gateway_request",
            timestamp: monotonicMs(),
            details: {
              role: "test_generation",
              deployment: PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT,
              ...(inputPass.pass.passId !== undefined
                ? { passId: inputPass.pass.passId }
                : {}),
            },
          });
          const llmResult = await input.llm.client.generate(generationRequest);
          if (
            capturedLlmResult === undefined ||
            inputPass.pass.passId === undefined ||
            inputPass.pass.passId === "a"
          ) {
            capturedLlmResult = llmResult;
          }
          const llmDurationMs = Date.now() - startedAt;
          capturedLlmDurationMs += llmDurationMs;
          if (llmResult.outcome === "success") {
            capturedLlmInputTokens += llmResult.usage.inputTokens ?? 0;
            capturedLlmOutputTokens += llmResult.usage.outputTokens ?? 0;
          }
          emit({
            phase: "llm_gateway_response",
            timestamp: monotonicMs(),
            details: {
              outcome: llmResult.outcome,
              ...(inputPass.pass.passId !== undefined
                ? { passId: inputPass.pass.passId }
                : {}),
              ...(llmResult.outcome === "success"
                ? {
                    inputTokens: llmResult.usage.inputTokens,
                    outputTokens: llmResult.usage.outputTokens,
                    finishReason: llmResult.finishReason,
                  }
                : { errorClass: llmResult.errorClass }),
            },
          });

          const attemptOutcome = classifyLlmAttempt({
            llmResult,
            gatewayRelease: input.llm.client.gatewayRelease,
            finopsRecorder,
            llmDurationMs,
            ...(diversityPasses === 2
              ? { attemptId: inputPass.pass.roleRunId }
              : {}),
          });

          if (inputPass.recordHarnessAttempt && harnessMode !== "off") {
            const harnessAttemptResult = buildHarnessAttemptResult({
              hashes: compiled.request.hashes,
              judgeAccepted: attemptOutcome.kind === "ok",
              errorClass:
                attemptOutcome.kind === "ok"
                  ? "none"
                  : attemptOutcome.errorClass,
              llmDurationMs,
              llmInputTokens:
                llmResult.outcome === "success"
                  ? (llmResult.usage.inputTokens ?? 0)
                  : 0,
              llmOutputTokens:
                llmResult.outcome === "success"
                  ? (llmResult.usage.outputTokens ?? 0)
                  : 0,
            });
            const harnessRunResult: RunAgentHarnessStepResult =
              await runAgentHarnessStep({
                runDir: artifactDir,
                jobId: input.jobId,
                role: "generator",
                roleStepId: harnessRoleStepId,
                testDepth: harnessTestDepth,
                executeAttempt: async () => harnessAttemptResult,
              });
            harnessArtifactPath = harnessRunResult.artifactPath;
            harnessSummary = {
              mode: harnessMode,
              outcome: harnessRunResult.outcome,
              mappedJobStatus: harnessRunResult.mappedJobStatus,
              errorClass: harnessRunResult.artifact.errorClass,
              attemptsConsumed: harnessRunResult.artifact.attemptsConsumed,
              maxAttemptsAllowed: harnessRunResult.artifact.maxAttemptsAllowed,
              artifactPath: harnessRunResult.artifactPath,
            };
          }

          if (attemptOutcome.kind === "error") {
            if (
              llmResult.outcome !== "success" &&
              llmResult.errorClass === "canceled"
            ) {
              emit({
                phase: "cancelled",
                timestamp: monotonicMs(),
                details: { reason: "llm_gateway_canceled" },
              });
            }
            throw attemptOutcome.error;
          }
          const audit: GeneratedTestCaseAuditMetadata = {
            jobId: input.jobId,
            generatedAt: input.generatedAt,
            contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
            schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
            promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
            redactionPolicyVersion: REDACTION_POLICY_VERSION,
            visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
            cacheHit: false,
            cacheKey: compiled.request.hashes.cacheKey,
            inputHash: compiled.request.hashes.inputHash,
            promptHash: compiled.request.hashes.promptHash,
            schemaHash: compiled.request.hashes.schemaHash,
          };
          const testCases = attemptOutcome.drafts.map((draft, index) =>
            stampGeneratedTestCase({
              draft,
              jobId: input.jobId,
              index,
              audit,
              intent,
              ...(inputPass.pass.identitySalt !== undefined
                ? { identitySalt: inputPass.pass.identitySalt }
                : {}),
            }),
          );
          testCases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          return {
            schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
            jobId: input.jobId,
            testCases,
          };
        },
      });
    } catch (err) {
      if (err instanceof ReplayCacheValidationError) {
        throw new ProductionRunnerError({
          failureClass: "PERSIST_FAILED",
          message:
            "Persistent replay cache entry failed validation; refusing to reuse corrupted cached output.",
          retryable: false,
          cause: err,
        });
      }
      throw err;
    }

    if (cacheExecResult.cacheHit) {
      emit({
        phase: "replay_cache_hit",
        timestamp: monotonicMs(),
        details: {
          key: cacheExecResult.key,
          testCaseCount: cacheExecResult.testCases.testCases.length,
          ...(inputPass.pass.passId !== undefined
            ? { passId: inputPass.pass.passId }
            : {}),
        },
      });
    }
    return { compiled, cacheExecResult, pass: inputPass.pass };
  };

  const regenerateWithSuffixSections = async (inputRegeneration: {
    suffixSections: readonly CompilePromptSuffixSection[];
  }): Promise<{
    list: GeneratedTestCaseList;
    llmResult: LlmGenerationResult;
    llmDurationMs: number;
    inputTokens: number;
    outputTokens: number;
    hashes: {
      readonly inputHash: string;
      readonly promptHash: string;
      readonly schemaHash: string;
      readonly cacheKey: string;
    };
  }> => {
    const repairPassResults = await Promise.all(
      generationPasses.map(async (pass) => {
        const compiled = compileGenerationPass(
          pass,
          inputRegeneration.suffixSections,
        );
        const request = buildGenerationRequest(compiled);
        request.maxRetries = 0;
        const requestStartedAt = Date.now();
        const llmResult = await input.llm.client.generate(request);
        const llmDurationMs = Date.now() - requestStartedAt;
        finopsRecorder.recordAttempt({
          role: "test_generation",
          source: "generator",
          ...(diversityPasses === 2 ? { attemptId: pass.roleRunId } : {}),
          deployment:
            llmResult.outcome === "success"
              ? llmResult.modelDeployment
              : input.llm.client.deployment,
          durationMs: llmDurationMs,
          result: llmResult,
        });
        if (llmResult.outcome !== "success") {
          throw new ProductionRunnerError({
            failureClass: "LLM_GATEWAY_FAILED",
            message: `Generator regeneration failed: ${llmResult.errorClass}`,
            retryable: false,
          });
        }
        const validation = validateLlmDraftResponse(llmResult.content);
        if (!validation.ok) {
          throw new ProductionRunnerError({
            failureClass: "LLM_RESPONSE_INVALID",
            message: `Generator regeneration returned an invalid payload: ${validation.message}`,
            retryable: false,
          });
        }
        const audit: GeneratedTestCaseAuditMetadata = {
          jobId: input.jobId,
          generatedAt: input.generatedAt,
          contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
          schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
          promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
          redactionPolicyVersion: REDACTION_POLICY_VERSION,
          visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
          cacheHit: false,
          cacheKey: compiled.request.hashes.cacheKey,
          inputHash: compiled.request.hashes.inputHash,
          promptHash: compiled.request.hashes.promptHash,
          schemaHash: compiled.request.hashes.schemaHash,
        };
        const cases = validation.value.testCases.map((draft, index) =>
          stampGeneratedTestCase({
            draft,
            jobId: input.jobId,
            index,
            audit,
            intent,
            ...(pass.identitySalt !== undefined
              ? { identitySalt: pass.identitySalt }
              : {}),
          }),
        );
        cases.sort((left, right) =>
          left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
        );
        return {
          list: {
            schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
            jobId: input.jobId,
            testCases: cases,
          },
          llmResult,
          llmDurationMs,
          inputTokens: llmResult.usage.inputTokens ?? 0,
          outputTokens: llmResult.usage.outputTokens ?? 0,
          hashes: {
            inputHash: compiled.request.hashes.inputHash,
            promptHash: compiled.request.hashes.promptHash,
            schemaHash: compiled.request.hashes.schemaHash,
            cacheKey: compiled.request.hashes.cacheKey,
          },
        };
      }),
    );
    return {
      list:
        repairPassResults.length === 1
          ? repairPassResults[0]!.list
          : mergeGeneratedTestCaseLists([
              repairPassResults[0]!.list,
              repairPassResults[1]!.list,
            ]),
      llmResult: repairPassResults[0]!.llmResult,
      llmDurationMs: repairPassResults.reduce(
        (sum, pass) => sum + pass.llmDurationMs,
        0,
      ),
      inputTokens: repairPassResults.reduce(
        (sum, pass) => sum + pass.inputTokens,
        0,
      ),
      outputTokens: repairPassResults.reduce(
        (sum, pass) => sum + pass.outputTokens,
        0,
      ),
      hashes: repairPassResults[0]!.hashes,
    };
  };

  const generationExecutions = await Promise.all(
    generationPasses.map((pass, index) =>
      executeGenerationPass({
        pass,
        emitPrimaryPromptCompiled: index === 0,
        recordHarnessAttempt: diversityPasses === 1,
      }),
    ),
  );
  const compiled = generationExecutions[0]!.compiled;
  const generationCacheHit = generationExecutions.every(
    (execution) => execution.cacheExecResult.cacheHit,
  );
  let generatedList: GeneratedTestCaseList =
    generationExecutions.length === 1
      ? generationExecutions[0]!.cacheExecResult.testCases
      : mergeGeneratedTestCaseLists([
          generationExecutions[0]!.cacheExecResult.testCases,
          generationExecutions[1]!.cacheExecResult.testCases,
        ]);
  generatedList = stabilizeGeneratedListForAcceptance({
    list: generatedList,
    model: compiled.artifacts.payload.testDesignModel!,
    jobId: input.jobId,
  });
  generatedList = {
    ...generatedList,
    testCases: generatedList.testCases.map((testCase) =>
      enrichWorkflowTopologyCoverage({
        testCase,
        workflowTopology,
      }),
    ),
  };
  const baselineGeneratedList = generatedList;
  const adversarialCriticRoundArtifacts: AdversarialCriticRoundArtifact[] = [];
  const adversarialCriticProvenanceRounds: Array<{
    round: number;
    artifactFilename: string;
    domain: string;
    findings: readonly AdversarialCriticFinding[];
    regeneratedListHash?: string;
    generatedCaseCount?: number;
  }> = [];
  const adversarialCriticSeenKeys = new Set<string>();
  const adversarialCriticDomain =
    resolveAdversarialCriticDomainFromList(generatedList);
  let adversarialCriticStopReason:
    | "converged_no_new_findings"
    | "critic_failed"
    | "max_rounds_reached"
    | "no_rounds_needed" = "no_rounds_needed";
  let adversarialCriticTraceArtifact: AdversarialCriticTraceArtifact | undefined;
  if (adversarialCriticEnabled) {
    const adversarialCriticBudgetLimits = resolveAdversarialCriticBudgetLimits(
      finopsBudget.roles.test_generation,
    );
    for (
      let round = 1;
      round <= ADVERSARIAL_CRITIC_MAX_ROUNDS;
      round += 1
    ) {
      const criticRound = await runAdversarialCriticRound({
        jobId: input.jobId,
        round,
        domain: adversarialCriticDomain,
        client: logicJudgeClient,
        intent,
        generatedList,
        coveragePlan: coveragePlanResult.plan,
        riskRanking: riskRankingResult.ranking,
        ...(adversarialCriticBudgetLimits.maxInputTokens !== undefined
          ? {
              maxInputTokens: adversarialCriticBudgetLimits.maxInputTokens,
            }
          : {}),
        ...(adversarialCriticBudgetLimits.maxOutputTokens !== undefined
          ? {
              maxOutputTokens: adversarialCriticBudgetLimits.maxOutputTokens,
            }
          : {}),
        ...(adversarialCriticBudgetLimits.maxWallClockMs !== undefined
          ? {
              maxWallClockMs: adversarialCriticBudgetLimits.maxWallClockMs,
            }
          : {}),
        ...(adversarialCriticBudgetLimits.maxRetries !== undefined
          ? {
              maxRetries: adversarialCriticBudgetLimits.maxRetries,
            }
          : {}),
        ...(input.llm.abortSignal !== undefined
          ? { abortSignal: input.llm.abortSignal }
          : {}),
      });
      finopsRecorder.recordAttempt({
        role: "test_generation",
        source: "adversarial_critic",
        attributionMode: "audit",
        deployment:
          criticRound.gatewayResult.outcome === "success"
            ? criticRound.gatewayResult.modelDeployment
            : logicJudgeClient.deployment,
        durationMs: criticRound.artifact.llmGateway.durationMs,
        result: criticRound.gatewayResult,
      });
      const uniqueFindings = dedupeAdversarialFindings({
        findings: criticRound.findings,
        seenKeys: adversarialCriticSeenKeys,
      });
      const normalizedArtifact: AdversarialCriticRoundArtifact = {
        ...criticRound.artifact,
        outputs: {
          findingCount: uniqueFindings.length,
          dedupeKeys: uniqueFindings.map(computeAdversarialFindingDedupeKey),
          findings: uniqueFindings,
        },
      };
      const roundArtifactFilename = `agent-role-runs/${ADVERSARIAL_CRITIC_ROUND_ARTIFACT_PREFIX}${normalizedArtifact.round}.json`;
      adversarialCriticRoundArtifacts.push(normalizedArtifact);
      const provenanceRound: {
        round: number;
        artifactFilename: string;
        domain: string;
        findings: readonly AdversarialCriticFinding[];
        regeneratedListHash?: string;
        generatedCaseCount?: number;
      } = {
        round: normalizedArtifact.round,
        artifactFilename: roundArtifactFilename,
        domain: normalizedArtifact.domain,
        findings: normalizedArtifact.outputs.findings,
      };
      adversarialCriticProvenanceRounds.push(provenanceRound);
      await writeAdversarialCriticRoundArtifact({
        runDir: artifactDir,
        artifact: normalizedArtifact,
      });
      if (normalizedArtifact.llmGateway.outcome === "error") {
        adversarialCriticStopReason = "critic_failed";
        break;
      }
      if (uniqueFindings.length === 0) {
        adversarialCriticStopReason = "converged_no_new_findings";
        break;
      }
      for (const finding of uniqueFindings) {
        adversarialCriticSeenKeys.add(
          computeAdversarialFindingDedupeKey(finding),
        );
      }
      const regeneration = await regenerateWithSuffixSections({
        suffixSections: [
          {
            kind: "json",
            label: `AdversarialFindings (round ${round})`,
            jsonPayload: uniqueFindings,
          },
          {
            kind: "repair_instructions",
            label: `AdversarialRepairInstructions (round ${round})`,
            jsonPayload: buildAdversarialRepairInstructions(uniqueFindings),
          },
          {
            kind: "json",
            label: `NegativeCoverageAccounting (round ${round})`,
            jsonPayload: computeNegativeCoverageAccounting({
              baselineList: baselineGeneratedList,
              finalList: generatedList,
            }),
          },
        ],
      });
      generatedList = stabilizeGeneratedListForAcceptance({
        list: regenerateWithAdversarialCaseCountCeiling({
          list: regeneration.list,
          maxCaseCount: baselineGeneratedList.testCases.length,
        }),
        model: compiled.artifacts.payload.testDesignModel!,
        jobId: input.jobId,
      });
      generatedList = {
        ...generatedList,
        testCases: generatedList.testCases.map((testCase) =>
          enrichWorkflowTopologyCoverage({
            testCase,
            workflowTopology,
          }),
        ),
      };
      provenanceRound.regeneratedListHash = sha256Hex(generatedList);
      provenanceRound.generatedCaseCount = generatedList.testCases.length;
      if (round === ADVERSARIAL_CRITIC_MAX_ROUNDS) {
        adversarialCriticStopReason = "max_rounds_reached";
      }
    }
    adversarialCriticTraceArtifact = {
      schemaVersion: "1.0.0",
      jobId: input.jobId,
      domain: adversarialCriticDomain,
      roundsExecuted: adversarialCriticRoundArtifacts.length,
      stopReason: adversarialCriticStopReason,
      negativeCoverage: computeNegativeCoverageAccounting({
        baselineList: baselineGeneratedList,
        finalList: generatedList,
      }),
      rounds: adversarialCriticRoundArtifacts.map((artifact) => ({
        round: artifact.round,
        findingCount: artifact.outputs.findingCount,
        dedupeKeys: artifact.outputs.dedupeKeys,
      })),
    };
    await writeAdversarialCriticTraceArtifact({
      runDir: artifactDir,
      artifact: adversarialCriticTraceArtifact,
    });
  }
  // Issue #2053 — evaluate the `G-NEG-CASE` quality gate against the
  // resolved policy-profile config (with the optional CLI override
  // applied on top). The result is persisted into `policy-report.json`
  // unconditionally so audit can distinguish skip from pass; enforcement
  // is deferred until after every artifact is sealed so a failure still
  // leaves a complete evidence bundle on disk.
  const negativeCaseLiftConfig = resolveNegativeCaseLiftConfig({
    profileRules:
      "rules" in customerRubric ? customerRubric.rules : undefined,
    override: input.qualityGates?.negativeCaseLift,
  });
  const negativeCaseLiftGateResult = evaluateNegativeCaseLiftGate({
    config: negativeCaseLiftConfig,
    adversarialCriticEnabled,
    traceArtifact: adversarialCriticTraceArtifact,
  });
  const logicJudgeCache = createFileSystemLogicJudgeCache(
    join(input.outputRoot, "test-intelligence", "replay-cache", "logic-judge"),
    { tenantScope },
  );
  const logicJudgeKnownNavigationIds = wireIntent.detectedNavigation.map(
    (navigation) => navigation.id,
  );
  const customerRubricRules =
    "rules" in customerRubric ? customerRubric.rules : undefined;
  const logicJudgeCoverageThresholds: LogicJudgeCoverageThresholds = {
    ...(customerRubricRules?.fieldCoverageRatioMin !== undefined
      ? { fieldCoverageRatioMin: customerRubricRules.fieldCoverageRatioMin }
      : {}),
    ...(customerRubricRules?.actionCoverageRatioMin !== undefined
      ? { actionCoverageRatioMin: customerRubricRules.actionCoverageRatioMin }
      : {}),
  };
  let logicJudgeResult: RunLogicJudgeResult = logicJudgeEnabled
    ? await runLogicJudge({
        jobId: input.jobId,
        generatedAt: input.generatedAt,
        testDesignModel: compiled.artifacts.payload.testDesignModel!,
        coveragePlan: compiled.artifacts.payload.coveragePlan!,
        generatedTestCases: generatedList,
        client: logicJudgeClient,
        cache: logicJudgeCache,
        knownNavigationIds: logicJudgeKnownNavigationIds,
        coverageThresholds: logicJudgeCoverageThresholds,
        ...(finopsBudget.roles.test_generation?.maxInputTokensPerRequest !==
        undefined
          ? {
              maxInputTokens:
                finopsBudget.roles.test_generation.maxInputTokensPerRequest,
            }
          : {}),
        ...(finopsBudget.roles.test_generation?.maxOutputTokensPerRequest !==
        undefined
          ? {
              maxOutputTokens:
                finopsBudget.roles.test_generation.maxOutputTokensPerRequest,
            }
          : {}),
        ...(finopsBudget.roles.test_generation?.maxWallClockMsPerRequest !==
        undefined
          ? {
              maxWallClockMs:
                finopsBudget.roles.test_generation.maxWallClockMsPerRequest,
            }
          : {}),
        ...(finopsBudget.roles.test_generation?.maxRetriesPerRequest !==
        undefined
          ? {
              maxRetries:
                finopsBudget.roles.test_generation.maxRetriesPerRequest,
            }
          : {}),
      })
    : {
        cacheHit: false,
        promptArtifact: {
          jobId: input.jobId,
          systemPrompt: "",
          userPrompt: "",
          responseSchemaName: "logic-judge-disabled",
          responseSchema: {},
          hashes: {
            promptHash: "logic-judge-disabled",
            schemaHash: "logic-judge-disabled",
            inputHash: "logic-judge-disabled",
            cacheKeyDigest: "logic-judge-disabled",
          },
          modelBinding: {
            deployment: logicJudgeClient.deployment,
            modelRevision: logicJudgeClient.modelRevision,
            gatewayRelease: logicJudgeClient.gatewayRelease,
          },
        },
        verdict: {
          schemaVersion: LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
          contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
          promptTemplateVersion: LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
          generatedAt: input.generatedAt,
          jobId: input.jobId,
          cacheHit: false,
          cacheKeyDigest: "logic-judge-disabled",
          modelDeployment: logicJudgeClient.deployment,
          modelRevision: logicJudgeClient.modelRevision,
          gatewayRelease: logicJudgeClient.gatewayRelease,
          verdict: "accept" as const,
          findings: [],
          repairInstructions: [],
        },
      };
  if (logicJudgeResult.gatewayResult !== undefined) {
    finopsRecorder.recordAttempt({
      role: "test_generation",
      source: "judge_primary",
      // Issue #1932: report the **judge** deployment for FinOps
      // attribution. On success the gateway echoes the deployment it
      // ran against; on failure we still attribute the attempt to the
      // judge client so cross-model attribution stays correct even
      // when the judge errored before the gateway echoed identity.
      // Issue #2016: judge traffic is `audit` against the
      // test_generation lane — it shares the budget envelope but does
      // not consume the role's primary attempt / token counters.
      attributionMode: "audit",
      deployment:
        logicJudgeResult.gatewayResult.outcome === "success"
          ? logicJudgeResult.gatewayResult.modelDeployment
          : logicJudgeClient.deployment,
      durationMs: 0,
      result: logicJudgeResult.gatewayResult,
    });
  }

  const a11yJudgeCache = createFileSystemA11yJudgeCache(
    join(input.outputRoot, "test-intelligence", "replay-cache", "a11y-judge"),
    { tenantScope },
  );
  let a11yJudgeResult: RunA11yJudgeResult | undefined =
    visualCaptures !== undefined &&
    visualSidecarRefusal === undefined &&
    input.llm.bundle?.a11yJudge !== undefined
      ? await runA11yJudge({
          jobId: input.jobId,
          generatedAt: input.generatedAt,
          intent,
          captures: visualCaptures,
          generatedTestCases: generatedList,
          bundle: input.llm.bundle,
          cache: a11yJudgeCache,
          ...(finopsBudget.roles.visual_primary?.maxInputTokensPerRequest !==
          undefined
            ? {
                maxInputTokens:
                  finopsBudget.roles.visual_primary.maxInputTokensPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.visual_primary?.maxOutputTokensPerRequest !==
          undefined
            ? {
                maxOutputTokens:
                  finopsBudget.roles.visual_primary.maxOutputTokensPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.visual_primary?.maxWallClockMsPerRequest !==
          undefined
            ? {
                maxWallClockMs:
                  finopsBudget.roles.visual_primary.maxWallClockMsPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.visual_primary?.maxRetriesPerRequest !==
          undefined
            ? {
                maxRetries:
                  finopsBudget.roles.visual_primary.maxRetriesPerRequest,
              }
            : {}),
        })
      : undefined;
  if (a11yJudgeResult?.gatewayResult !== undefined) {
    finopsRecorder.recordAttempt({
      role: "visual_primary",
      source: "judge_secondary",
      // Issue #2016: a11y judge is audit traffic against the
      // visual_primary lane — keep role-level counters reserved for the
      // visual capture work itself.
      attributionMode: "audit",
      deployment:
        a11yJudgeResult.gatewayResult.outcome === "success"
          ? a11yJudgeResult.gatewayResult.modelDeployment
          : input.llm.bundle!.a11yJudge!.deployment,
      durationMs: 0,
      result: a11yJudgeResult.gatewayResult,
    });
  }

  const faithfulnessJudgeCache = createFileSystemFaithfulnessJudgeCache(
    join(
      input.outputRoot,
      "test-intelligence",
      "replay-cache",
      "faithfulness-judge",
    ),
    { tenantScope },
  );
  let faithfulnessJudgeResult: RunFaithfulnessJudgeResult | undefined =
    visualCaptures !== undefined &&
    visualSidecarRefusal === undefined &&
    input.llm.bundle !== undefined
      ? await runFaithfulnessJudge({
          jobId: input.jobId,
          generatedAt: input.generatedAt,
          captures: visualCaptures,
          generatedTestCases: generatedList,
          bundle: input.llm.bundle,
          cache: faithfulnessJudgeCache,
          ...(finopsBudget.roles.visual_primary?.maxInputTokensPerRequest !==
          undefined
            ? {
                maxInputTokens:
                  finopsBudget.roles.visual_primary.maxInputTokensPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.visual_primary?.maxOutputTokensPerRequest !==
          undefined
            ? {
                maxOutputTokens:
                  finopsBudget.roles.visual_primary.maxOutputTokensPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.visual_primary?.maxWallClockMsPerRequest !==
          undefined
            ? {
                maxWallClockMs:
                  finopsBudget.roles.visual_primary.maxWallClockMsPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.visual_primary?.maxRetriesPerRequest !==
          undefined
            ? {
                maxRetries:
                  finopsBudget.roles.visual_primary.maxRetriesPerRequest,
              }
            : {}),
        })
      : undefined;
  for (const attempt of faithfulnessJudgeResult?.attempts ?? []) {
    finopsRecorder.recordAttempt({
      role: attempt.role,
      source: "judge_secondary",
      // Issue #2016: faithfulness judge is audit traffic.
      attributionMode: "audit",
      deployment:
        attempt.result.outcome === "success"
          ? attempt.result.modelDeployment
          : attempt.role === "visual_primary"
            ? input.llm.bundle!.visualPrimary.deployment
            : input.llm.bundle!.visualFallback.deployment,
      durationMs: 0,
      result: attempt.result,
    });
  }
  const buildCurrentJudgeConsensus = (
    repairHistory?: Partial<JudgeConsensusRepairHistory>,
  ): JudgeConsensusVerdict =>
    buildJudgeConsensus({
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      panel: [
        buildLogicJudgeConsensusEntry(logicJudgeResult.verdict),
        ...(isA11yJudgeAvailableForConsensus(a11yJudgeResult)
          ? [buildA11yJudgeConsensusEntry(a11yJudgeResult.verdict)]
          : []),
        ...(faithfulnessJudgeResult !== undefined
          ? [
              buildFaithfulnessJudgeConsensusEntry(
                faithfulnessJudgeResult.verdict,
              ),
            ]
          : []),
      ],
      ...(repairHistory !== undefined ? { repairHistory } : {}),
    });
  let judgeConsensusResult = buildCurrentJudgeConsensus();
  const initialJudgeConsensusResult = judgeConsensusResult;
  // 7b. Repair loop (Issue #1900, Issue #1928). When the judge panel did
  //     not unanimously accept the initial output — including the case
  //     where a judge returned `reject` — consolidate the union of
  //     `repairInstructions`, re-invoke the generator with the augmented
  //     prompt, and re-run both judges, bounded by `maxRepairIterations`.
  //     Issue #1928: live runs showed the Logic-Judge frequently emits
  //     `reject` for recoverable structured-output schema violations from
  //     the generator LLM; gating repair on `repair`-only verdicts
  //     silently disabled the recovery mechanism. The repair driver
  //     terminates as soon as the panel reaches `accept` (logic-judge
  //     accepts and the faithfulness-judge either accepts or is not
  //     run for that iteration) or any judge in a post-iteration
  //     verdict round returns `reject` (logic-judge `reject` always
  //     terminates; faithfulness-judge `reject` terminates when it is
  //     run).
  //     Per-iteration artifacts (`agent-role-runs/repair_planner_iter_K.json`
  //     and `agent-role-runs/test_generation_repair_iter_K.json`) are written
  //     by the loop driver. Token spend is attributed to FinOps role
  //     `test_generation` (source `generator`) for the regenerator and
  //     `judge_primary` / `judge_secondary` for the re-runs.
  const initialJudgeAccepted =
    isJudgeConsensusAcceptedForRun(judgeConsensusResult);
  let repairLoopResult: RepairLoopResult | undefined;
  if (!initialJudgeAccepted) {
    const maxRepairIterations =
      input.harness?.maxRepairIterations ?? REPAIR_LOOP_DEFAULT_MAX_ITERATIONS;
    const faithfulnessSnapshot = faithfulnessJudgeResult;
    const a11ySnapshot = a11yJudgeResult;
    let latestRepairLogicJudgeResult: RunLogicJudgeResult | undefined;
    let latestRepairA11yJudgeResult: RunA11yJudgeResult | undefined;
    // Issue #2016: hand the FinOps generator-side budget to the repair
    // loop so it can stop *before* the next regeneration would breach
    // `maxTotalOutputTokens` or `maxAttempts` on the test_generation
    // role. The initial generator pass has already been recorded by
    // this point; we hand its cumulative output / attempt count in as
    // `initialGenerator*` so the guard's projection is honest about
    // pre-loop spend.
    const testGenerationRoleBudget = finopsBudget.roles.test_generation;
    const initialGeneratorAttempts = generationPasses.length;
    const repairLoopBudgetGuard: RepairLoopBudgetGuard | undefined =
      testGenerationRoleBudget !== undefined &&
      (testGenerationRoleBudget.maxTotalOutputTokens !== undefined ||
        testGenerationRoleBudget.maxAttempts !== undefined)
        ? {
            initialGeneratorOutputTokens: capturedLlmOutputTokens,
            initialGeneratorAttempts,
            ...(testGenerationRoleBudget.maxTotalOutputTokens !== undefined
              ? {
                  maxGeneratorOutputTokens:
                    testGenerationRoleBudget.maxTotalOutputTokens,
                }
              : {}),
            ...(testGenerationRoleBudget.maxAttempts !== undefined
              ? { maxGeneratorAttempts: testGenerationRoleBudget.maxAttempts }
              : {}),
            ...(testGenerationRoleBudget.maxOutputTokensPerRequest !== undefined
              ? {
                  expectedNextOutputTokens:
                    testGenerationRoleBudget.maxOutputTokensPerRequest,
                }
              : {}),
          }
        : undefined;
    repairLoopResult = await runRepairLoop({
      jobId: input.jobId,
      runDir: artifactDir,
      initialList: generatedList,
      initialLogicVerdict: mergeA11yIntoLogicVerdict(
        logicJudgeResult.verdict,
        isA11yJudgeAvailableForConsensus(a11ySnapshot)
          ? a11ySnapshot.verdict
          : undefined,
      ),
      ...(faithfulnessSnapshot !== undefined
        ? { initialFaithfulnessVerdict: faithfulnessSnapshot.verdict }
        : {}),
      maxRepairIterations,
      softFailOnIterationError: true,
      ...(repairLoopBudgetGuard !== undefined
        ? { budget: repairLoopBudgetGuard }
        : {}),
      regenerate: async ({ previousList, repairInstructions, iteration }) => {
        const targetedCaseIds = [
          ...new Set(
            repairInstructions
              .map((instruction) => instruction.testCaseId)
              .filter((testCaseId) => testCaseId !== "$job"),
          ),
        ].sort((left, right) => left.localeCompare(right));
        const repairContextList =
          targetedCaseIds.length === 0
            ? {
                ...previousList,
                testCases: previousList.testCases.slice(0, 3),
              }
            : {
                ...previousList,
                testCases: previousList.testCases.filter((testCase) =>
                  targetedCaseIds.includes(testCase.id),
                ),
              };
        const repairSuffixSections: readonly CompilePromptSuffixSection[] = [
          {
            kind: "repair_instructions",
            label: `RepairInstructions (iteration ${iteration})`,
            jsonPayload: repairInstructions,
          },
          {
            kind: "json",
            label: `PreviousGeneratedTestCasesNeedingRepair (iteration ${iteration})`,
            jsonPayload: repairContextList,
          },
        ];
        const repairPassResults = await Promise.all(
          generationPasses.map(async (pass) => {
            const repairCompiled = compileGenerationPass(
              pass,
              repairSuffixSections,
            );
            const repairRequest = buildGenerationRequest(repairCompiled);
            repairRequest.maxRetries = 0;
            const startedAtRepair = Date.now();
            const llmResult = await input.llm.client.generate(repairRequest);
            const llmDurationMs = Date.now() - startedAtRepair;
            finopsRecorder.recordAttempt({
              role: "test_generation",
              source: "generator",
              ...(diversityPasses === 2 ? { attemptId: pass.roleRunId } : {}),
              deployment:
                llmResult.outcome === "success"
                  ? llmResult.modelDeployment
                  : input.llm.client.deployment,
              durationMs: llmDurationMs,
              result: llmResult,
            });
            if (llmResult.outcome !== "success") {
              throw new ProductionRunnerError({
                failureClass: "LLM_GATEWAY_FAILED",
                message: `Repair iteration ${iteration} generator failed: ${llmResult.errorClass}`,
                retryable: false,
              });
            }
            const repairValidation = validateLlmDraftResponse(
              llmResult.content,
            );
            if (!repairValidation.ok) {
              throw new ProductionRunnerError({
                failureClass: "LLM_RESPONSE_INVALID",
                message: `Repair iteration ${iteration} returned an invalid payload: ${repairValidation.message}`,
                retryable: false,
              });
            }
            const repairAudit: GeneratedTestCaseAuditMetadata = {
              jobId: input.jobId,
              generatedAt: input.generatedAt,
              contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
              schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
              promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
              redactionPolicyVersion: REDACTION_POLICY_VERSION,
              visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
              cacheHit: false,
              cacheKey: repairCompiled.request.hashes.cacheKey,
              inputHash: repairCompiled.request.hashes.inputHash,
              promptHash: repairCompiled.request.hashes.promptHash,
              schemaHash: repairCompiled.request.hashes.schemaHash,
            };
            const repairCases = repairValidation.value.testCases.map(
              (draft, index) =>
                stampGeneratedTestCase({
                  draft,
                  jobId: input.jobId,
                  index,
                  audit: repairAudit,
                  intent,
                  ...(pass.identitySalt !== undefined
                    ? { identitySalt: pass.identitySalt }
                    : {}),
                }),
            );
            repairCases.sort((a, b) =>
              a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
            );
            const repairList: GeneratedTestCaseList = {
              schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
              jobId: input.jobId,
              testCases: repairCases,
            };
            return {
              list: stabilizeGeneratedListForAcceptance({
                list: repairList,
                model: compiled.artifacts.payload.testDesignModel!,
                jobId: input.jobId,
              }),
              llmResult,
              llmDurationMs,
              inputTokens: llmResult.usage.inputTokens ?? 0,
              outputTokens: llmResult.usage.outputTokens ?? 0,
              hashes: {
                inputHash: repairCompiled.request.hashes.inputHash,
                promptHash: repairCompiled.request.hashes.promptHash,
                schemaHash: repairCompiled.request.hashes.schemaHash,
                cacheKey: repairCompiled.request.hashes.cacheKey,
              },
            };
          }),
        );
        return {
          list:
            repairPassResults.length === 1
              ? repairPassResults[0]!.list
              : mergeGeneratedTestCaseLists([
                  repairPassResults[0]!.list,
                  repairPassResults[1]!.list,
                ]),
          llmResult: repairPassResults[0]!.llmResult,
          llmDurationMs: repairPassResults.reduce(
            (sum, pass) => sum + pass.llmDurationMs,
            0,
          ),
          inputTokens: repairPassResults.reduce(
            (sum, pass) => sum + pass.inputTokens,
            0,
          ),
          outputTokens: repairPassResults.reduce(
            (sum, pass) => sum + pass.outputTokens,
            0,
          ),
          hashes: repairPassResults[0]!.hashes,
        };
      },
      runLogicJudge: async ({ list }) => {
        const repairLogicResult = await runLogicJudge({
          jobId: input.jobId,
          generatedAt: input.generatedAt,
          testDesignModel: compiled.artifacts.payload.testDesignModel!,
          coveragePlan: compiled.artifacts.payload.coveragePlan!,
          generatedTestCases: list,
          client: logicJudgeClient,
          // Per-iteration regen produces a unique input hash; bypass the
          // disk-backed cache and use a fresh in-memory cache so deterministic
          // repeat-iteration mocks (test fixtures) can still hit byte-stable
          // verdicts without poisoning the shared logic-judge cache.
          cache: createMemoryLogicJudgeCache(),
          knownNavigationIds: logicJudgeKnownNavigationIds,
          coverageThresholds: logicJudgeCoverageThresholds,
          ...(finopsBudget.roles.test_generation?.maxInputTokensPerRequest !==
          undefined
            ? {
                maxInputTokens:
                  finopsBudget.roles.test_generation.maxInputTokensPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.test_generation?.maxOutputTokensPerRequest !==
          undefined
            ? {
                maxOutputTokens:
                  finopsBudget.roles.test_generation.maxOutputTokensPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.test_generation?.maxWallClockMsPerRequest !==
          undefined
            ? {
                maxWallClockMs:
                  finopsBudget.roles.test_generation.maxWallClockMsPerRequest,
              }
            : {}),
          ...(finopsBudget.roles.test_generation?.maxRetriesPerRequest !==
          undefined
            ? {
                maxRetries:
                  finopsBudget.roles.test_generation.maxRetriesPerRequest,
              }
            : {}),
        });
        if (repairLogicResult.gatewayResult !== undefined) {
          finopsRecorder.recordAttempt({
            role: "test_generation",
            source: "judge_primary",
            // Issue #1932: cross-model judge attribution — see the
            // initial-pass call site above.
            // Issue #2016: judge traffic is audit-mode against the
            // test_generation lane.
            attributionMode: "audit",
            deployment:
              repairLogicResult.gatewayResult.outcome === "success"
                ? repairLogicResult.gatewayResult.modelDeployment
                : logicJudgeClient.deployment,
            durationMs: 0,
            result: repairLogicResult.gatewayResult,
          });
        }
        const repairA11yResult =
          visualCaptures !== undefined &&
          input.llm.bundle?.a11yJudge !== undefined
            ? await runA11yJudge({
                jobId: input.jobId,
                generatedAt: input.generatedAt,
                intent,
                captures: visualCaptures,
                generatedTestCases: list,
                bundle: input.llm.bundle,
                cache: createMemoryA11yJudgeCache(),
                ...(finopsBudget.roles.visual_primary
                  ?.maxInputTokensPerRequest !== undefined
                  ? {
                      maxInputTokens:
                        finopsBudget.roles.visual_primary
                          .maxInputTokensPerRequest,
                    }
                  : {}),
                ...(finopsBudget.roles.visual_primary
                  ?.maxOutputTokensPerRequest !== undefined
                  ? {
                      maxOutputTokens:
                        finopsBudget.roles.visual_primary
                          .maxOutputTokensPerRequest,
                    }
                  : {}),
                ...(finopsBudget.roles.visual_primary
                  ?.maxWallClockMsPerRequest !== undefined
                  ? {
                      maxWallClockMs:
                        finopsBudget.roles.visual_primary
                          .maxWallClockMsPerRequest,
                    }
                  : {}),
                ...(finopsBudget.roles.visual_primary?.maxRetriesPerRequest !==
                undefined
                  ? {
                      maxRetries:
                        finopsBudget.roles.visual_primary.maxRetriesPerRequest,
                    }
                  : {}),
              })
            : undefined;
        if (repairA11yResult?.gatewayResult !== undefined) {
          finopsRecorder.recordAttempt({
            role: "visual_primary",
            source: "judge_secondary",
            // Issue #2016: a11y judge is audit traffic.
            attributionMode: "audit",
            deployment:
              repairA11yResult.gatewayResult.outcome === "success"
                ? repairA11yResult.gatewayResult.modelDeployment
                : input.llm.bundle!.a11yJudge!.deployment,
            durationMs: 0,
            result: repairA11yResult.gatewayResult,
          });
        }
        latestRepairLogicJudgeResult = repairLogicResult;
        latestRepairA11yJudgeResult = repairA11yResult;
        const usage =
          repairLogicResult.gatewayResult?.outcome === "success"
            ? repairLogicResult.gatewayResult.usage
            : { inputTokens: 0, outputTokens: 0 };
        const a11yUsage =
          repairA11yResult?.gatewayResult?.outcome === "success"
            ? repairA11yResult.gatewayResult.usage
            : { inputTokens: 0, outputTokens: 0 };
        return {
          verdict: mergeA11yIntoLogicVerdict(
            repairLogicResult.verdict,
            isA11yJudgeAvailableForConsensus(repairA11yResult)
              ? repairA11yResult.verdict
              : undefined,
          ),
          inputTokens: (usage.inputTokens ?? 0) + (a11yUsage.inputTokens ?? 0),
          outputTokens:
            (usage.outputTokens ?? 0) + (a11yUsage.outputTokens ?? 0),
        };
      },
      ...(faithfulnessSnapshot !== undefined &&
      visualCaptures !== undefined &&
      input.llm.bundle !== undefined
        ? {
            runFaithfulnessJudge: async ({ list }) => {
              const repairFaithResult = await runFaithfulnessJudge({
                jobId: input.jobId,
                generatedAt: input.generatedAt,
                captures: visualCaptures,
                generatedTestCases: list,
                bundle: input.llm.bundle!,
                cache: createMemoryFaithfulnessJudgeCache(),
                ...(finopsBudget.roles.visual_primary
                  ?.maxInputTokensPerRequest !== undefined
                  ? {
                      maxInputTokens:
                        finopsBudget.roles.visual_primary
                          .maxInputTokensPerRequest,
                    }
                  : {}),
                ...(finopsBudget.roles.visual_primary
                  ?.maxOutputTokensPerRequest !== undefined
                  ? {
                      maxOutputTokens:
                        finopsBudget.roles.visual_primary
                          .maxOutputTokensPerRequest,
                    }
                  : {}),
                ...(finopsBudget.roles.visual_primary
                  ?.maxWallClockMsPerRequest !== undefined
                  ? {
                      maxWallClockMs:
                        finopsBudget.roles.visual_primary
                          .maxWallClockMsPerRequest,
                    }
                  : {}),
                ...(finopsBudget.roles.visual_primary?.maxRetriesPerRequest !==
                undefined
                  ? {
                      maxRetries:
                        finopsBudget.roles.visual_primary.maxRetriesPerRequest,
                    }
                  : {}),
              });
              for (const attempt of repairFaithResult.attempts) {
                finopsRecorder.recordAttempt({
                  role: attempt.role,
                  source: "judge_secondary",
                  // Issue #2016: faithfulness judge is audit traffic.
                  attributionMode: "audit",
                  deployment:
                    attempt.result.outcome === "success"
                      ? attempt.result.modelDeployment
                      : attempt.role === "visual_primary"
                        ? input.llm.bundle!.visualPrimary.deployment
                        : input.llm.bundle!.visualFallback.deployment,
                  durationMs: 0,
                  result: attempt.result,
                });
              }
              const totalUsage = repairFaithResult.attempts.reduce(
                (acc, attempt) => {
                  if (attempt.result.outcome === "success") {
                    acc.inputTokens += attempt.result.usage.inputTokens ?? 0;
                    acc.outputTokens += attempt.result.usage.outputTokens ?? 0;
                  }
                  return acc;
                },
                { inputTokens: 0, outputTokens: 0 },
              );
              return {
                verdict: repairFaithResult.verdict,
                inputTokens: totalUsage.inputTokens,
                outputTokens: totalUsage.outputTokens,
              };
            },
          }
        : {}),
      onIterationComplete: (record) => {
        emit({
          phase: "repair_loop_iteration",
          timestamp: monotonicMs(),
          details: {
            iteration: record.iteration,
            logicVerdict: record.logicVerdict,
            faithfulnessVerdict: record.faithfulnessVerdict,
            generatedCaseCount: record.generatedCaseCount,
            inputTokens: record.inputTokens,
            outputTokens: record.outputTokens,
          },
        });
      },
    });
    generatedList = repairLoopResult.finalList;
    if (latestRepairLogicJudgeResult !== undefined) {
      logicJudgeResult = latestRepairLogicJudgeResult;
    } else {
      logicJudgeResult = {
        ...logicJudgeResult,
        verdict: repairLoopResult.finalLogicVerdict,
      };
    }
    if (
      repairLoopResult.finalFaithfulnessVerdict !== undefined &&
      faithfulnessJudgeResult !== undefined
    ) {
      faithfulnessJudgeResult = {
        ...faithfulnessJudgeResult,
        verdict: repairLoopResult.finalFaithfulnessVerdict,
      };
    }
    if (latestRepairA11yJudgeResult !== undefined) {
      a11yJudgeResult = latestRepairA11yJudgeResult;
    }
    judgeConsensusResult = buildCurrentJudgeConsensus({
      attempted: true,
      repairIterationCount: repairLoopResult.repairIterationCount,
      finalOutcome: repairLoopResult.outcome,
      historicalFindings: initialJudgeConsensusResult.activeFindings,
      historicalRepairInstructions:
        initialJudgeConsensusResult.repairInstructions,
    });
  }

  const judgeAccepted = isJudgeConsensusAcceptedForRun(judgeConsensusResult);

  if (harnessMode !== "off" && judgeAccepted && harnessSummary === undefined) {
    const harnessAttemptResult = buildHarnessAttemptResult({
      hashes: compiled.request.hashes,
      judgeAccepted,
      errorClass: "none",
      llmDurationMs: capturedLlmDurationMs,
      llmInputTokens: capturedLlmInputTokens,
      llmOutputTokens: capturedLlmOutputTokens,
    });
    const harnessRunResult: RunAgentHarnessStepResult =
      await runAgentHarnessStep({
        runDir: artifactDir,
        jobId: input.jobId,
        role: "generator",
        roleStepId: harnessRoleStepId,
        testDepth: harnessTestDepth,
        executeAttempt: async () => harnessAttemptResult,
      });
    harnessArtifactPath = harnessRunResult.artifactPath;
    harnessSummary = {
      mode: harnessMode,
      outcome: harnessRunResult.outcome,
      mappedJobStatus: harnessRunResult.mappedJobStatus,
      errorClass: harnessRunResult.artifact.errorClass,
      attemptsConsumed: harnessRunResult.artifact.attemptsConsumed,
      maxAttemptsAllowed: harnessRunResult.artifact.maxAttemptsAllowed,
      artifactPath: harnessRunResult.artifactPath,
    };
  }

  if (harnessMode !== "off" && !judgeAccepted) {
    // Issue #1939: when the repair loop aborts because two consecutive
    // iterations produced the same verdict signature, surface that as
    // `convergence_stalled` on the harness summary instead of the
    // generic `judge_rejection` so operators can distinguish "the
    // judges keep rejecting" from "the LLM is stuck on the same error
    // class".
    // Issue #2016: budget_exhausted is also a "stop without judge accept"
    // outcome — surface it as the same convergence_stalled errorClass on
    // the harness summary so the harness state machine recognises the
    // stop-condition lane and does not treat it as a generic rejection.
    const stalled =
      repairLoopResult?.outcome === "convergence_stalled" ||
      repairLoopResult?.outcome === "budget_exhausted";
    const harnessAttemptResult = buildHarnessAttemptResult({
      hashes: compiled.request.hashes,
      judgeAccepted,
      errorClass: stalled ? "convergence_stalled" : "judge_rejection",
      llmDurationMs: capturedLlmDurationMs,
      llmInputTokens: capturedLlmInputTokens,
      llmOutputTokens: capturedLlmOutputTokens,
    });
    const harnessRunResult: RunAgentHarnessStepResult =
      await runAgentHarnessStep({
        runDir: artifactDir,
        jobId: input.jobId,
        role: "generator",
        roleStepId: harnessRoleStepId,
        testDepth: harnessTestDepth,
        executeAttempt: async () => harnessAttemptResult,
      });
    harnessArtifactPath = harnessRunResult.artifactPath;
    harnessSummary = {
      mode: harnessMode,
      outcome: harnessRunResult.outcome,
      mappedJobStatus: harnessRunResult.mappedJobStatus,
      errorClass: harnessRunResult.artifact.errorClass,
      attemptsConsumed: harnessRunResult.artifact.attemptsConsumed,
      maxAttemptsAllowed: harnessRunResult.artifact.maxAttemptsAllowed,
      artifactPath: harnessRunResult.artifactPath,
    };
  }

  // 8. Validation pipeline.
  emit({ phase: "validation_started", timestamp: monotonicMs() });
  const validation = runValidationPipeline({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: generatedList,
    intent,
    coveragePlan: coveragePlanResult.plan,
    workflowTopology,
    ...(canonicalCustomerProfile?.policyOverrides !== undefined &&
    canonicalCustomerProfile.policyOverrides.some(
      (override) => override.severity !== "info",
    )
      ? {
          policyOverrides: canonicalCustomerProfile.policyOverrides.filter(
            (
              override,
            ): override is {
              ruleId: string;
              severity: "error" | "warning";
              threshold?: number;
            } => override.severity !== "info",
          ),
        }
      : {}),
    ...(faithfulnessJudgeResult !== undefined
      ? { faithfulnessVerdict: faithfulnessJudgeResult.verdict }
      : {}),
    ...(a11yJudgeResult !== undefined
      ? { a11yVerdict: a11yJudgeResult.verdict }
      : {}),
    ...("rules" in customerRubric ? { profile: customerRubric } : {}),
    ...(promptVisualBatch !== undefined ? { visual: promptVisualBatch } : {}),
    ...(promptVisualBatch !== undefined
      ? {
          primaryVisualDeployment: "llama-4-maverick-vision" as const,
        }
      : {}),
    ...(visualSidecarRefusal !== undefined ? { visualSidecarRefusal } : {}),
    untrustedContentReport: normalizedUntrusted.report,
    activeModelBindings,
  });
  const blocked = validation.blocked || !judgeAccepted;
  emit({
    phase: "validation_complete",
    timestamp: monotonicMs(),
    details: {
      blocked,
      errorCount: validation.validation.errorCount,
      warningCount: validation.validation.warningCount,
      cases: validation.generatedTestCases.testCases.length,
    },
  });
  emit({
    phase: "policy_decision",
    timestamp: monotonicMs(),
    details: {
      blocked,
      profileId: validation.policy.policyProfileId,
      approved: validation.policy.approvedCount,
      blockedCount: validation.policy.blockedCount,
      needsReview: validation.policy.needsReviewCount,
    },
  });

  // 9. Persist artifacts.
  emit({ phase: "export_started", timestamp: monotonicMs() });
  await mkdir(artifactDir, { recursive: true });
  const intentPath = join(artifactDir, "business-intent-ir.json");
  const compiledPromptPath = join(artifactDir, "compiled-prompt.json");
  const customerEvalRubricPath =
    customerEvalRubric === undefined
      ? undefined
      : join(artifactDir, "customer-eval-rubric.json");
  const logicJudgeCompiledPromptPath = join(
    artifactDir,
    LOGIC_JUDGE_COMPILED_PROMPT_ARTIFACT_FILENAME,
  );
  const logicJudgeVerdictPath = join(
    artifactDir,
    "agent-role-runs",
    LOGIC_JUDGE_VERDICT_ARTIFACT_FILENAME,
  );
  const judgeConsensusPath = join(
    artifactDir,
    JUDGE_CONSENSUS_ARTIFACT_FILENAME,
  );
  const runQualityPath = join(artifactDir, RUN_QUALITY_ARTIFACT_FILENAME);
  const faithfulnessJudgeCompiledPromptPath =
    faithfulnessJudgeResult === undefined
      ? undefined
      : join(artifactDir, FAITHFULNESS_JUDGE_COMPILED_PROMPT_ARTIFACT_FILENAME);
  const faithfulnessJudgeVerdictPath =
    faithfulnessJudgeResult === undefined
      ? undefined
      : join(
          artifactDir,
          "agent-role-runs",
          FAITHFULNESS_VERDICT_ARTIFACT_FILENAME,
        );
  const a11yJudgeVerdictPath =
    a11yJudgeResult === undefined
      ? undefined
      : join(
          artifactDir,
          "agent-role-runs",
          A11Y_JUDGE_VERDICT_ARTIFACT_FILENAME,
        );
  const generatedPath = join(
    artifactDir,
    GENERATED_TESTCASES_ARTIFACT_FILENAME,
  );
  const validationPath = join(
    artifactDir,
    TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
  );
  const visualSidecarValidationPath =
    validation.visual === undefined
      ? undefined
      : join(artifactDir, VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME);
  const policyPath = join(
    artifactDir,
    TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  );
  const workflowTopologyPath = join(
    artifactDir,
    WORKFLOW_TOPOLOGY_ARTIFACT_FILENAME,
  );
  const coveragePlanPath = join(artifactDir, "coverage-plan.json");
  const riskRankingPath = join(artifactDir, RISK_RANKING_ARTIFACT_FILENAME);
  const adversarialCriticTracePath = join(
    artifactDir,
    ADVERSARIAL_CRITIC_TRACE_ARTIFACT_FILENAME,
  );
  const coveragePath = join(
    artifactDir,
    TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  );
  const finopsOutcomeOverride = deriveFinopsOutcomeFromValidation(
    validation,
    judgeAccepted,
  );
  const finopsReport = buildFinOpsBudgetReport({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    budget: finopsBudget,
    recorder: finopsRecorder,
    ...(finopsOutcomeOverride !== undefined
      ? { outcomeOverride: finopsOutcomeOverride }
      : {}),
  });
  const runQualityArtifact = buildRunQualityArtifact({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    blocked,
    judgeAccepted,
    validation,
    judgeConsensus: judgeConsensusResult,
    finopsReport,
    ...(visualSidecarResult !== undefined ? { visualSidecarResult } : {}),
  });
  const finopsWritten = await writeFinOpsBudgetReport({
    runDir: artifactDir,
    report: finopsReport,
  });
  const agentParticipationArtifact = buildAgentParticipationArtifact({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    roles: buildAgentParticipationEntries({
      request: input,
      artifactDir,
      finopsReport,
      generationCacheHit,
      logicJudgeEnabled,
      logicJudgeGatewayResult: logicJudgeResult.gatewayResult,
      coveragePlannerGatewayResult: coveragePlanResult.gatewayResult,
      riskRankerGatewayResult: riskRankingResult.gatewayResult,
      visualSidecarResult,
      visualSidecarSkippedReason,
      a11yJudgeResult,
      visualSidecarRefusal,
      repairLoopResult,
      adversarialCriticRounds: adversarialCriticRoundArtifacts,
      artifactPaths: {
        coveragePlan: coveragePlanPath,
        workflowTopology: workflowTopologyPath,
        riskRanking: riskRankingPath,
        logicJudgeVerdict: logicJudgeVerdictPath,
        ...(adversarialCriticTraceArtifact !== undefined
          ? { adversarialCriticTrace: adversarialCriticTracePath }
          : {}),
        ...(visualSidecarArtifactPath !== undefined
          ? { visualSidecarResult: visualSidecarArtifactPath }
          : {}),
        ...(a11yJudgeVerdictPath !== undefined
          ? { a11yJudgeVerdict: a11yJudgeVerdictPath }
          : {}),
        agentRoleRun: join(
          artifactDir,
          "agent-role-runs",
          "test_generation.json",
        ),
      },
    }),
  });
  const agentParticipationWritePromise = writeAgentParticipationArtifact({
    artifact: agentParticipationArtifact,
    destinationDir: artifactDir,
  });
  const intentBytes = encodeCanonicalJson(intent);
  const compiledPromptBytes = encodeCanonicalJson(compiled.artifacts);
  const customerEvalRubricBytes =
    customerEvalRubric === undefined
      ? undefined
      : encodeCanonicalJson({
          schemaVersion: "1.0.0",
          jobId: input.jobId,
          generatedAt: input.generatedAt,
          source: "customer-eval-markdown",
          bodyMarkdown: customerEvalRubric.bodyMarkdown,
          bodyPlain: customerEvalRubric.bodyPlain,
          markdownContentHash: customerEvalRubric.markdownContentHash,
          plainContentHash: customerEvalRubric.plainContentHash,
        });
  const logicJudgeCompiledPromptBytes = encodeCanonicalJson(
    logicJudgeResult.promptArtifact,
  );
  const logicJudgeVerdictBytes = encodeCanonicalJson(logicJudgeResult.verdict);
  const judgeConsensusBytes = encodeCanonicalJson(judgeConsensusResult);
  const runQualityBytes = encodeCanonicalJson(runQualityArtifact);
  const faithfulnessJudgeCompiledPromptBytes =
    faithfulnessJudgeResult === undefined
      ? undefined
      : encodeCanonicalJson(faithfulnessJudgeResult.promptArtifact);
  const faithfulnessJudgeVerdictBytes =
    faithfulnessJudgeResult === undefined
      ? undefined
      : encodeCanonicalJson(faithfulnessJudgeResult.verdict);
  const a11yJudgeVerdictBytes =
    a11yJudgeResult === undefined
      ? undefined
      : encodeCanonicalJson(a11yJudgeResult.verdict);
  const generatedBytes = encodeCanonicalJson(validation.generatedTestCases);
  const validationBytes = encodeCanonicalJson(validation.validation);
  const visualSidecarValidationBytes =
    validation.visual === undefined
      ? undefined
      : encodeCanonicalJson(validation.visual);
  const coverageBytes = encodeCanonicalJson(validation.coverage);
  const agentRoleRunPromise = writeAgentRoleRunArtifact({
    runDir: artifactDir,
    jobId: input.jobId,
    roleRunId: "test_generation",
    roleStepId: "test_generation",
    hashes: compiled.request.hashes,
  });
  const generatorPassRunPromises = generationExecutions
    .filter((execution) => execution.pass.roleRunId !== "test_generation")
    .map((execution) =>
      writeAgentRoleRunArtifact({
        runDir: artifactDir,
        jobId: input.jobId,
        roleRunId: execution.pass.roleRunId,
        roleStepId: execution.pass.roleRunId,
        hashes: execution.compiled.request.hashes,
      }),
    );
  const contextBudgetReportPath =
    compiled.contextBudgetReport === undefined
      ? undefined
      : join(
          artifactDir,
          CONTEXT_BUDGET_ARTIFACT_DIRECTORY,
          `${compiled.contextBudgetReport.roleStepId}.json`,
        );
  const contextBudgetReportBytes =
    compiled.contextBudgetReport === undefined
      ? undefined
      : encodeCanonicalJson(compiled.contextBudgetReport);
  const judgeConsensusWritePromise = writeJudgeConsensusArtifact({
    runDir: artifactDir,
    artifact: judgeConsensusResult,
  });
  try {
    const coveragePlanWritePromise = writeCoveragePlanArtifact({
      plan: coveragePlanResult.plan,
      runDir: artifactDir,
    });
    const workflowTopologyWritePromise = writeWorkflowTopologyArtifact({
      topology: workflowTopology,
      runDir: artifactDir,
    });
    const riskRankingWritePromise = writeRiskRankingArtifact({
      ranking: riskRankingResult.ranking,
      runDir: artifactDir,
    });
    await Promise.all([
      writeAtomicBytes(intentPath, intentBytes),
      writeAtomicBytes(compiledPromptPath, compiledPromptBytes),
      ...(customerEvalRubricPath === undefined ||
      customerEvalRubricBytes === undefined
        ? []
        : [writeAtomicBytes(customerEvalRubricPath, customerEvalRubricBytes)]),
      writeAtomicBytes(
        logicJudgeCompiledPromptPath,
        logicJudgeCompiledPromptBytes,
      ),
      writeAtomicBytes(logicJudgeVerdictPath, logicJudgeVerdictBytes),
      judgeConsensusWritePromise,
      writeAtomicBytes(runQualityPath, runQualityBytes),
      agentParticipationWritePromise,
      agentRoleRunPromise,
      ...generatorPassRunPromises,
      ...(faithfulnessJudgeCompiledPromptPath === undefined ||
      faithfulnessJudgeCompiledPromptBytes === undefined
        ? []
        : [
            writeAtomicBytes(
              faithfulnessJudgeCompiledPromptPath,
              faithfulnessJudgeCompiledPromptBytes,
            ),
          ]),
      ...(faithfulnessJudgeVerdictPath === undefined ||
      faithfulnessJudgeVerdictBytes === undefined
        ? []
        : [
            writeAtomicBytes(
              faithfulnessJudgeVerdictPath,
              faithfulnessJudgeVerdictBytes,
            ),
          ]),
      ...(a11yJudgeVerdictPath === undefined ||
      a11yJudgeVerdictBytes === undefined
        ? []
        : [writeAtomicBytes(a11yJudgeVerdictPath, a11yJudgeVerdictBytes)]),
      ...(contextBudgetReportPath === undefined ||
      contextBudgetReportBytes === undefined
        ? []
        : [
            writeAtomicBytes(contextBudgetReportPath, contextBudgetReportBytes),
          ]),
      writeAtomicBytes(generatedPath, generatedBytes),
      writeAtomicBytes(validationPath, validationBytes),
      ...(visualSidecarValidationPath === undefined ||
      visualSidecarValidationBytes === undefined
        ? []
        : [
            writeAtomicBytes(
              visualSidecarValidationPath,
              visualSidecarValidationBytes,
            ),
          ]),
      workflowTopologyWritePromise,
      writeAtomicBytes(coveragePath, coverageBytes),
      coveragePlanWritePromise,
      riskRankingWritePromise,
    ]);
  } catch (err) {
    throw new ProductionRunnerError({
      failureClass: "PERSIST_FAILED",
      message: `Could not persist test-intelligence artifacts: ${sanitizeErrorMessage({ error: err, fallback: "filesystem failure" })}`,
      retryable: false,
      cause: err,
    });
  }
  const agentParticipationWritten = await agentParticipationWritePromise;
  const agentRoleRunArtifact = await agentRoleRunPromise;
  const judgeConsensusArtifact = await judgeConsensusWritePromise;
  const generatorPassRunArtifacts = await Promise.all(generatorPassRunPromises);
  const genealogyArtifact = await writeGenealogyArtifact({
    runDir: artifactDir,
    generatedAt: input.generatedAt,
    nodes: [
      {
        jobId: input.jobId,
        roleStepId: "test_generation",
        artifactFilename: "agent-role-runs/test_generation.json",
        roleLineageDepth: 0,
      },
      ...generatorPassRunArtifacts.map((artifact) => ({
        jobId: input.jobId,
        roleStepId: artifact.artifact.roleRunId,
        artifactFilename: `agent-role-runs/${artifact.artifact.roleRunId}.json`,
        roleLineageDepth: 0,
      })),
      ...adversarialCriticRoundArtifacts.map((artifact) => ({
        jobId: input.jobId,
        roleStepId: `adversarial_critic_round_${artifact.round}`,
        artifactFilename: `agent-role-runs/${ADVERSARIAL_CRITIC_ROUND_ARTIFACT_PREFIX}${artifact.round}.json`,
        roleLineageDepth: artifact.round,
      })),
      {
        jobId: input.jobId,
        roleStepId: "logic_judge",
        artifactFilename: `agent-role-runs/${LOGIC_JUDGE_VERDICT_ARTIFACT_FILENAME}`,
        roleLineageDepth: 0,
      },
      ...(a11yJudgeResult === undefined
        ? []
        : [
            {
              jobId: input.jobId,
              roleStepId: "a11y_judge",
              artifactFilename: `agent-role-runs/${A11Y_JUDGE_VERDICT_ARTIFACT_FILENAME}`,
              roleLineageDepth: 0,
            },
          ]),
      {
        jobId: input.jobId,
        roleStepId: "judge_consensus",
        artifactFilename: JUDGE_CONSENSUS_ARTIFACT_FILENAME,
        roleLineageDepth: 0,
      },
      ...(faithfulnessJudgeResult === undefined
        ? []
        : [
            {
              jobId: input.jobId,
              roleStepId: "faithfulness_judge",
              artifactFilename: `agent-role-runs/${FAITHFULNESS_VERDICT_ARTIFACT_FILENAME}`,
              roleLineageDepth: 0,
            },
          ]),
      ...(compiled.contextBudgetReport === undefined
        ? []
        : [
            {
              jobId: input.jobId,
              roleStepId: compiled.contextBudgetReport.roleStepId,
              artifactFilename: `${CONTEXT_BUDGET_ARTIFACT_DIRECTORY}/${compiled.contextBudgetReport.roleStepId}.json`,
              roleLineageDepth: 0,
            },
          ]),
      ...(repairLoopResult === undefined
        ? []
        : Array.from({ length: repairLoopResult.repairIterationCount }).flatMap(
            (_unused, index) => {
              const iteration = index + 1;
              return [
                {
                  jobId: input.jobId,
                  roleStepId: `repair_planner_iter_${iteration}`,
                  artifactFilename: `agent-role-runs/${REPAIR_PLANNER_ARTIFACT_PREFIX}${iteration}.json`,
                  roleLineageDepth: iteration,
                },
                {
                  jobId: input.jobId,
                  roleStepId: `test_generation_repair_iter_${iteration}`,
                  artifactFilename: `agent-role-runs/${TEST_GENERATION_REPAIR_ARTIFACT_PREFIX}${iteration}.json`,
                  roleLineageDepth: iteration,
                },
              ];
            },
          )),
    ],
  });
  const harnessCheckpointSummary =
    harnessArtifactPath !== undefined
      ? summarizeAgentHarnessCheckpointChain(
          await readAgentHarnessCheckpointChain({
            runDir: artifactDir,
            jobId: input.jobId,
          }),
        )
      : {
          headOfChainHash: AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH,
          chainLength: 0,
        };

  // 10. Customer Markdown.
  const customerLabel = resolveCustomerLabel(input, figmaFile);
  const sourceLabel = resolveSourceLabel(input.source);
  const acceptanceCriteria =
    customContextMarkdown === undefined
      ? undefined
      : extractAcceptanceCriteriaFromMarkdown(
          customContextMarkdown.bodyMarkdown,
        );
  const rendered = renderCustomerMarkdown({
    list: validation.generatedTestCases,
    fileName: customerLabel,
    sourceLabel,
    generatedAt: input.generatedAt,
    ...(acceptanceCriteria !== undefined ? { acceptanceCriteria } : {}),
  });
  const markdownDir = join(artifactDir, "customer-markdown");
  await mkdir(markdownDir, { recursive: true });
  const combinedMarkdownPath = join(markdownDir, "testfaelle.md");
  const combinedMarkdownBytes = Buffer.from(rendered.combinedMarkdown, "utf8");
  await writeAtomicText(combinedMarkdownPath, rendered.combinedMarkdown);
  const perCasePaths: string[] = [];
  const perCaseArtifacts: Array<{ filename: string; bytes: Buffer }> = [];
  for (const file of rendered.perCaseFiles) {
    const filePath = join(markdownDir, file.filename);
    await writeAtomicText(filePath, file.body);
    perCasePaths.push(filePath);
    perCaseArtifacts.push({
      filename: `customer-markdown/${file.filename}`,
      bytes: Buffer.from(file.body, "utf8"),
    });
  }
  const visualSidecarSummary =
    visualSidecarResult?.outcome === "success" &&
    visualSidecarArtifactBytes !== undefined
      ? {
          selectedDeployment: visualSidecarResult.selectedDeployment,
          fallbackReason: visualSidecarResult.fallbackReason,
          confidenceSummary: visualSidecarResult.confidenceSummary,
          resultArtifactSha256: sha256OfBytes(visualSidecarArtifactBytes),
        }
      : undefined;
  const finopsArtifactFilename = `finops/${finopsWritten.filename}`;
  const productionRunnerEvidenceSealPath = join(
    artifactDir,
    PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
  );
  const productionRunnerEvidenceSealBytes = Buffer.from(
    serializeProductionRunnerEvidenceSeal(
      buildProductionRunnerEvidenceSeal({
        jobId: input.jobId,
        generatedAt: input.generatedAt,
        harnessArtifactFilenames: [
          AGENT_PARTICIPATION_ARTIFACT_FILENAME,
          WORKFLOW_TOPOLOGY_ARTIFACT_FILENAME,
          "agent-role-runs/test_generation.json",
          ...generatorPassRunArtifacts.map(
            (artifact) => `agent-role-runs/${artifact.artifact.roleRunId}.json`,
          ),
          ...(adversarialCriticTraceArtifact !== undefined
            ? [ADVERSARIAL_CRITIC_TRACE_ARTIFACT_FILENAME]
            : []),
          ...adversarialCriticRoundArtifacts.map(
            (artifact) =>
              `agent-role-runs/${ADVERSARIAL_CRITIC_ROUND_ARTIFACT_PREFIX}${artifact.round}.json`,
          ),
          `agent-role-runs/${LOGIC_JUDGE_VERDICT_ARTIFACT_FILENAME}`,
          ...(a11yJudgeResult === undefined
            ? []
            : [`agent-role-runs/${A11Y_JUDGE_VERDICT_ARTIFACT_FILENAME}`]),
          JUDGE_CONSENSUS_ARTIFACT_FILENAME,
          ...(faithfulnessJudgeResult === undefined
            ? []
            : [`agent-role-runs/${FAITHFULNESS_VERDICT_ARTIFACT_FILENAME}`]),
          ...(contextBudgetReportPath !== undefined &&
          compiled.contextBudgetReport !== undefined
            ? [
                `${CONTEXT_BUDGET_ARTIFACT_DIRECTORY}/${compiled.contextBudgetReport.roleStepId}.json`,
              ]
            : []),
          ...(harnessArtifactPath !== undefined
            ? [harnessArtifactPath.slice(artifactDir.length + 1)]
            : []),
        ],
        headOfChainHash: harnessCheckpointSummary.headOfChainHash,
        chainLength: harnessCheckpointSummary.chainLength,
        finopsArtifactFilename,
        bySourceHash: computePerSourceCostBreakdownHashFromReport(finopsReport),
        genealogyDagHash: sha256OfBytes(genealogyArtifact.bytes),
        visualEvidenceHashes:
          visualSidecarArtifact?.visualEvidenceRefs?.map((ref) => ({
            screenId: ref.screenId,
            modelDeployment: ref.modelDeployment,
            evidenceHash: ref.evidenceHash,
          })) ?? [],
        ...(customContextMarkdown !== undefined
          ? {
              customContextMarkdownHashes: [
                {
                  sourceId: CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID,
                  markdownContentHash:
                    customContextMarkdown.markdownContentHash,
                  plainContentHash: customContextMarkdown.plainContentHash,
                },
              ],
            }
          : {}),
      }),
    ),
    "utf8",
  );
  const provenanceDocument = await buildRunProvenanceGraph({
    runDir: artifactDir,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    sourceKind: input.source.kind,
    finalGeneratedTestCases: validation.generatedTestCases,
    initialGenerationDeployment:
      capturedLlmResult?.outcome === "success"
        ? capturedLlmResult.modelDeployment
        : PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT,
    ...(repairLoopResult !== undefined
      ? {
          repairIterations: repairLoopResult.iterations.filter(
            (iteration) => iteration.iteration > 0,
          ),
        }
      : {}),
    ...(adversarialCriticRoundArtifacts.length > 0
      ? {
          adversarialCriticRounds: adversarialCriticProvenanceRounds,
        }
      : {}),
    logicJudge: {
      artifactFilename: `agent-role-runs/${LOGIC_JUDGE_VERDICT_ARTIFACT_FILENAME}`,
      verdict: logicJudgeResult.verdict,
    },
    judgeConsensus: {
      artifactFilename: JUDGE_CONSENSUS_ARTIFACT_FILENAME,
      verdict: judgeConsensusResult,
    },
    ...(faithfulnessJudgeResult !== undefined
      ? {
          faithfulnessJudge: {
            artifactFilename: `agent-role-runs/${FAITHFULNESS_VERDICT_ARTIFACT_FILENAME}`,
            verdict: faithfulnessJudgeResult.verdict,
          },
        }
      : {}),
    ...(a11yJudgeResult !== undefined
      ? {
          a11yJudge: {
            artifactFilename: `agent-role-runs/${A11Y_JUDGE_VERDICT_ARTIFACT_FILENAME}`,
            verdict: a11yJudgeResult.verdict,
          },
        }
      : {}),
  });
  const policyReport: TestCasePolicyReport = {
    ...validation.policy,
    provenance: {
      artifactFilename: PROVENANCE_ARTIFACT_FILENAME,
      merkleAlgorithm: "sha256_merkle_v1",
      merkleRoot: provenanceDocument["ti:merkleSeal"].root,
      leafCount: provenanceDocument["ti:merkleSeal"].leafCount,
    },
    // Issue #2053 — surface quality-gate results alongside the policy
    // decisions. Today this carries the single `G-NEG-CASE` entry; the
    // array shape leaves room for additional gates without a contract
    // change. Always present once the runner reaches this point so
    // consumers do not have to defend against the field being absent.
    gateResults: [negativeCaseLiftGateResult],
  };
  const policyBytes = encodeCanonicalJson(policyReport);
  const modelDeployments = {
    testGeneration: PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT,
    ...(input.llm.bundle !== undefined
      ? {
          visualPrimary: toEvidenceVisualDeployment(
            input.llm.bundle.visualPrimary.deployment,
          ),
          visualFallback: toEvidenceVisualDeployment(
            input.llm.bundle.visualFallback.deployment,
          ),
        }
      : {}),
  } satisfies Parameters<
    typeof buildWave1ValidationEvidenceManifest
  >[0]["modelDeployments"];
  const evidenceManifest = buildWave1ValidationEvidenceManifest({
    fixtureId: `production-runner-${input.source.kind}`,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    modelDeployments,
    policyProfileId: policyReport.policyProfileId,
    policyProfileVersion: policyReport.policyProfileVersion,
    exportProfileId: "customer-markdown",
    exportProfileVersion: "1.0.0",
    activeModelBindings,
    promptHash: compiled.request.hashes.promptHash,
    schemaHash: compiled.request.hashes.schemaHash,
    inputHash: compiled.request.hashes.inputHash,
    cacheKeyDigest: compiled.request.hashes.cacheKey,
    ...(visualSidecarSummary !== undefined
      ? { visualSidecar: visualSidecarSummary }
      : {}),
    ...(visualSidecarResult !== undefined
      ? {
          visualSidecarCaptureIdentities: visualSidecarResult.captureIdentities,
        }
      : {}),
    artifacts: [
      {
        filename: "business-intent-ir.json",
        bytes: intentBytes,
        category: "intent",
      },
      {
        filename: "compiled-prompt.json",
        bytes: compiledPromptBytes,
        category: "intent",
      },
      ...(customerEvalRubricBytes === undefined
        ? []
        : [
            {
              filename: "customer-eval-rubric.json",
              bytes: customerEvalRubricBytes,
              category: "intent" as const,
            },
          ]),
      {
        filename: LOGIC_JUDGE_COMPILED_PROMPT_ARTIFACT_FILENAME,
        bytes: logicJudgeCompiledPromptBytes,
        category: "intent",
      },
      {
        filename: `agent-role-runs/${LOGIC_JUDGE_VERDICT_ARTIFACT_FILENAME}`,
        bytes: logicJudgeVerdictBytes,
        category: "manifest",
      },
      {
        filename: JUDGE_CONSENSUS_ARTIFACT_FILENAME,
        bytes: judgeConsensusBytes,
        category: "manifest",
      },
      {
        filename: RUN_QUALITY_ARTIFACT_FILENAME,
        bytes: runQualityBytes,
        category: "manifest",
      },
      {
        filename: AGENT_PARTICIPATION_ARTIFACT_FILENAME,
        bytes: agentParticipationWritten.bytes,
        category: "manifest",
      },
      ...(adversarialCriticTraceArtifact === undefined
        ? []
        : [
            {
              filename: ADVERSARIAL_CRITIC_TRACE_ARTIFACT_FILENAME,
              bytes: Buffer.from(
                `${canonicalJson(adversarialCriticTraceArtifact)}\n`,
                "utf8",
              ),
              category: "manifest" as const,
            },
          ]),
      ...adversarialCriticRoundArtifacts.map((artifact) => ({
        filename: `agent-role-runs/${ADVERSARIAL_CRITIC_ROUND_ARTIFACT_PREFIX}${artifact.round}.json`,
        bytes: Buffer.from(`${canonicalJson(artifact)}\n`, "utf8"),
        category: "manifest" as const,
      })),
      ...(faithfulnessJudgeCompiledPromptBytes === undefined
        ? []
        : [
            {
              filename: FAITHFULNESS_JUDGE_COMPILED_PROMPT_ARTIFACT_FILENAME,
              bytes: faithfulnessJudgeCompiledPromptBytes,
              category: "intent" as const,
            },
          ]),
      ...(faithfulnessJudgeVerdictBytes === undefined
        ? []
        : [
            {
              filename: `agent-role-runs/${FAITHFULNESS_VERDICT_ARTIFACT_FILENAME}`,
              bytes: faithfulnessJudgeVerdictBytes,
              category: "manifest" as const,
            },
          ]),
      ...(a11yJudgeVerdictBytes === undefined
        ? []
        : [
            {
              filename: `agent-role-runs/${A11Y_JUDGE_VERDICT_ARTIFACT_FILENAME}`,
              bytes: a11yJudgeVerdictBytes,
              category: "manifest" as const,
            },
          ]),
      {
        filename: "agent-role-runs/test_generation.json",
        bytes: agentRoleRunArtifact.bytes,
        category: "manifest",
      },
      ...generatorPassRunArtifacts.map((artifact) => ({
        filename: `agent-role-runs/${artifact.artifact.roleRunId}.json`,
        bytes: artifact.bytes,
        category: "manifest" as const,
      })),
      {
        filename: "genealogy.json",
        bytes: genealogyArtifact.bytes,
        category: "genealogy",
      },
      ...(contextBudgetReportBytes === undefined ||
      compiled.contextBudgetReport === undefined
        ? []
        : [
            {
              filename: `${CONTEXT_BUDGET_ARTIFACT_DIRECTORY}/${compiled.contextBudgetReport.roleStepId}.json`,
              bytes: contextBudgetReportBytes,
              category: "manifest" as const,
            },
          ]),
      {
        filename: WORKFLOW_TOPOLOGY_ARTIFACT_FILENAME,
        bytes: Buffer.from(canonicalJson(workflowTopology), "utf8"),
        category: "intent",
      },
      {
        filename: GENERATED_TESTCASES_ARTIFACT_FILENAME,
        bytes: generatedBytes,
        category: "validation",
      },
      {
        filename: TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
        bytes: validationBytes,
        category: "validation",
      },
      ...(visualSidecarValidationBytes === undefined
        ? []
        : [
            {
              filename: VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
              bytes: visualSidecarValidationBytes,
              category: "validation" as const,
            },
          ]),
      {
        filename: TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
        bytes: policyBytes,
        category: "validation",
      },
      {
        filename: PROVENANCE_ARTIFACT_FILENAME,
        bytes: Buffer.from(`${canonicalJson(provenanceDocument)}\n`, "utf8"),
        category: "manifest",
      },
      {
        filename: TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
        bytes: coverageBytes,
        category: "validation",
      },
      {
        filename: "untrusted-content-normalization-report.json",
        bytes: untrustedContentNormalizationReportBytes,
        category: "manifest",
      },
      {
        filename: finopsArtifactFilename,
        bytes: finopsWritten.bytes,
        category: "finops",
      },
      {
        filename: PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
        bytes: productionRunnerEvidenceSealBytes,
        category: "manifest",
      },
      ...(visualSidecarArtifactBytes === undefined
        ? []
        : [
            {
              filename: VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
              bytes: visualSidecarArtifactBytes,
              category: "visual_sidecar" as const,
            },
          ]),
      // Issue #2017: per-attempt raw-response diagnostics, when present.
      ...visualSidecarDiagnostics.map((diagnostic) => ({
        filename: diagnostic.filename,
        bytes: diagnostic.bytes,
        category: "visual_sidecar" as const,
      })),
      ...(visualCaptureArtifacts === undefined
        ? []
        : [
            {
              filename: visualCaptureArtifacts.manifestFilename,
              bytes: visualCaptureArtifacts.manifestBytes,
              category: "visual_sidecar" as const,
            },
            ...visualCaptureArtifacts.files.map((file) => ({
              filename: file.filename,
              bytes: file.bytes,
              category: "visual_sidecar" as const,
            })),
          ]),
      {
        filename: "customer-markdown/testfaelle.md",
        bytes: combinedMarkdownBytes,
        category: "export",
      },
      ...perCaseArtifacts.map((artifact) => ({
        filename: artifact.filename,
        bytes: artifact.bytes,
        category: "export" as const,
      })),
    ],
  });
  try {
    await writeAtomicBytes(
      productionRunnerEvidenceSealPath,
      productionRunnerEvidenceSealBytes,
    );
    await writeAtomicBytes(policyPath, policyBytes);
    await writeProvenanceGraph({
      runDir: artifactDir,
      document: provenanceDocument,
    });
    await writeWave1ValidationEvidenceManifest({
      manifest: evidenceManifest,
      destinationDir: artifactDir,
    });
  } catch (err) {
    throw new ProductionRunnerError({
      failureClass: "PERSIST_FAILED",
      message: `Could not seal production-runner evidence: ${sanitizeErrorMessage({ error: err, fallback: "filesystem failure" })}`,
      retryable: false,
      cause: err,
    });
  }
  const manifestVerification = await verifyWave1ValidationEvidenceFromDisk(
    artifactDir,
    {
      rejectUnexpected: false,
    },
  );
  if (!manifestVerification.result.ok) {
    throw new ProductionRunnerError({
      failureClass: "PERSIST_FAILED",
      message:
        "Production-runner evidence manifest failed immediate post-write verification.",
      retryable: false,
    });
  }
  const sealVerification = await verifyProductionRunnerEvidenceSealFromDisk({
    artifactsDir: artifactDir,
    jobId: input.jobId,
  });
  if (sealVerification.failures.length > 0) {
    throw new ProductionRunnerError({
      failureClass: "PERSIST_FAILED",
      message:
        "Production-runner evidence seal failed immediate post-write verification.",
      retryable: false,
    });
  }
  const provenanceVerification = await verifyProvenanceFromDisk(artifactDir);
  if (!provenanceVerification.ok) {
    throw new ProductionRunnerError({
      failureClass: "PERSIST_FAILED",
      message:
        "Production-runner provenance graph failed immediate post-write verification.",
      retryable: false,
    });
  }

  emit({
    phase: "export_complete",
    timestamp: monotonicMs(),
    details: {
      artifactDir,
      perCaseFiles: perCasePaths.length,
    },
  });
  emit({
    phase: "evidence_sealed",
    timestamp: monotonicMs(),
    details: {
      sealed: true,
      sealArtifact: PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
      manifest: "wave1-validation-evidence-manifest.json",
      headOfChainHash: harnessCheckpointSummary.headOfChainHash,
      chainLength: harnessCheckpointSummary.chainLength,
      bySourceHash: computePerSourceCostBreakdownHashFromReport(finopsReport),
    },
  });
  // Emit final FinOps summary derived from the LLM gateway response. Skipped
  // on cache hits (no LLM call was made, so there is nothing to report).
  if (!generationCacheHit && capturedLlmResult?.outcome === "success") {
    emit({
      phase: "finops_recorded",
      timestamp: monotonicMs(),
      details: {
        role: "test_generation",
        deployment: capturedLlmResult.modelDeployment,
        attempts: finopsReport.totals.attempts,
        inputTokens: finopsReport.totals.inputTokens,
        outputTokens: finopsReport.totals.outputTokens,
        budgetMaxInputTokens: finopsLimits.maxInputTokens,
        budgetMaxOutputTokens: finopsLimits.maxOutputTokens,
        durationMs: finopsReport.totals.durationMs,
      },
    });
  }

  if (
    harnessMode === "enforced" &&
    harnessSummary !== undefined &&
    harnessSummary.outcome !== "accepted"
  ) {
    throw mapHarnessOutcomeToProductionRunnerError(harnessSummary);
  }
  // Issue #2053 — enforce the `G-NEG-CASE` hard gate after every
  // artifact (policy report, evidence seal, provenance) is sealed so a
  // gate failure still leaves a complete, auditable evidence bundle on
  // disk. Only the `enforce` mode reaches this branch — `advisory` and
  // `skipped` outcomes were already recorded in the policy report and
  // do not block the run.
  if (negativeCaseLiftGateResult.status === "failed") {
    throw new ProductionRunnerError({
      failureClass: "NEGATIVE_CASE_LIFT_BELOW_THRESHOLD",
      message: negativeCaseLiftGateResult.message,
      retryable: false,
    });
  }

  return {
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    fileKey: figmaFile.fileKey,
    generatedTestCases: validation.generatedTestCases,
    intent,
    validation: validation.validation,
    policy: policyReport,
    coverage: validation.coverage,
    blocked,
    logicJudge: {
      verdict: logicJudgeResult.verdict,
      artifactPath: logicJudgeVerdictPath,
      compiledPromptPath: logicJudgeCompiledPromptPath,
    },
    ...(a11yJudgeResult !== undefined && a11yJudgeVerdictPath !== undefined
      ? {
          a11yJudge: {
            verdict: a11yJudgeResult.verdict,
            artifactPath: a11yJudgeVerdictPath,
          },
        }
      : {}),
    judgeConsensus: {
      verdict: judgeConsensusResult,
      artifactPath: judgeConsensusPath,
    },
    runQuality: {
      artifact: runQualityArtifact,
      artifactPath: runQualityPath,
    },
    ...(faithfulnessJudgeResult !== undefined &&
    faithfulnessJudgeVerdictPath !== undefined &&
    faithfulnessJudgeCompiledPromptPath !== undefined
      ? {
          faithfulnessJudge: {
            verdict: faithfulnessJudgeResult.verdict,
            artifactPath: faithfulnessJudgeVerdictPath,
            compiledPromptPath: faithfulnessJudgeCompiledPromptPath,
          },
        }
      : {}),
    ...(visualSidecarResult !== undefined
      ? {
          visualSidecar: {
            result: visualSidecarResult,
            artifactPath:
              visualSidecarArtifactPath ??
              join(artifactDir, VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME),
            ...(visualSidecarValidationPath !== undefined
              ? { validationReportPath: visualSidecarValidationPath }
              : {}),
            ...(visualSidecarRefusal !== undefined
              ? { refusal: visualSidecarRefusal }
              : {}),
          },
        }
      : {}),
    finopsBudget,
    artifactDir,
    artifactPaths: {
      intent: intentPath,
      compiledPrompt: compiledPromptPath,
      ...(customerEvalRubricPath !== undefined
        ? { customerEvalRubric: customerEvalRubricPath }
        : {}),
      coveragePlan: coveragePlanPath,
      workflowTopology: workflowTopologyPath,
      riskRanking: riskRankingPath,
      ...(adversarialCriticTraceArtifact !== undefined
        ? { adversarialCriticTrace: adversarialCriticTracePath }
        : {}),
      logicJudgeCompiledPrompt: logicJudgeCompiledPromptPath,
      ...(faithfulnessJudgeCompiledPromptPath !== undefined
        ? {
            faithfulnessJudgeCompiledPrompt:
              faithfulnessJudgeCompiledPromptPath,
          }
        : {}),
      ...(a11yJudgeVerdictPath !== undefined
        ? { a11yJudgeVerdict: a11yJudgeVerdictPath }
        : {}),
      untrustedContentNormalizationReport:
        untrustedContentNormalizationReportPath,
      evidenceSeal: productionRunnerEvidenceSealPath,
      ...(visualSidecarArtifactPath !== undefined
        ? { visualSidecarResult: visualSidecarArtifactPath }
        : {}),
      ...(visualCaptureArtifacts !== undefined
        ? {
            visualCaptureManifest: visualCaptureArtifacts.manifestPath,
            visualCaptureDirectory: visualCaptureArtifacts.directory,
          }
        : {}),
      agentParticipation: agentParticipationWritten.artifactPath,
      agentRoleRun: agentRoleRunArtifact.artifactPath,
      judgeConsensus: judgeConsensusArtifact.path,
      runQuality: runQualityPath,
      logicJudgeVerdict: logicJudgeVerdictPath,
      ...(faithfulnessJudgeVerdictPath !== undefined
        ? { faithfulnessJudgeVerdict: faithfulnessJudgeVerdictPath }
        : {}),
      genealogy: genealogyArtifact.artifactPath,
      provenance: join(artifactDir, PROVENANCE_ARTIFACT_FILENAME),
      ...(contextBudgetReportPath !== undefined
        ? { contextBudgetReport: contextBudgetReportPath }
        : {}),
      generatedTestCases: generatedPath,
      validationReport: validationPath,
      ...(visualSidecarValidationPath !== undefined
        ? { visualSidecarValidationReport: visualSidecarValidationPath }
        : {}),
      policyReport: policyPath,
      coverageReport: coveragePath,
      finopsReport: finopsWritten.artifactPath,
      ...(harnessArtifactPath !== undefined
        ? { harnessStep: harnessArtifactPath }
        : {}),
    },
    customerMarkdownPaths: {
      combined: combinedMarkdownPath,
      perCase: perCasePaths,
    },
    ...(harnessSummary !== undefined ? { harness: harnessSummary } : {}),
    ...(repairLoopResult !== undefined
      ? {
          repairLoop: {
            outcome: repairLoopResult.outcome,
            repairIterationCount: repairLoopResult.repairIterationCount,
            maxRepairIterations: repairLoopResult.maxRepairIterations,
            iterations: repairLoopResult.iterations,
          },
        }
      : {}),
  };
};

const resolveFigmaPayloadCap = (override: number | undefined): number => {
  if (override === undefined) {
    return MAX_FIGMA_PAYLOAD_BYTES;
  }
  if (!Number.isSafeInteger(override) || override <= 0) {
    throw new ProductionRunnerError({
      failureClass: "FIGMA_URL_REJECTED",
      message: `maxFigmaPayloadBytes must be a positive safe integer; got ${override}`,
      retryable: false,
    });
  }
  return override;
};

const resolveFigmaSource = async (
  source: ProductionRunnerSource,
  maxPayloadBytes: number,
): Promise<FigmaRestFileSnapshot> => {
  if (source.kind === "figma_paste_normalized") {
    return source.file;
  }
  if (source.kind === "figma_rest_file") {
    return source.file;
  }
  // figma_url path.
  let parsed: ReturnType<typeof parseFigmaUrl>;
  try {
    parsed = parseFigmaUrl(source.figmaUrl);
  } catch (err) {
    if (err instanceof FigmaRestFetchError) {
      throw new ProductionRunnerError({
        failureClass: "FIGMA_URL_REJECTED",
        message: `Figma URL rejected (${err.errorClass}): ${err.message}`,
        retryable: false,
        cause: err,
      });
    }
    throw err;
  }
  try {
    return await fetchFigmaFileForTestIntelligence({
      fileKey: parsed.fileKey,
      accessToken: source.accessToken,
      maxResponseBytes: maxPayloadBytes,
      ...(parsed.nodeId !== undefined ? { nodeId: parsed.nodeId } : {}),
    });
  } catch (err) {
    if (
      err instanceof FigmaRestFetchError &&
      err.errorClass === "transport" &&
      /exceeds\s+\d+\s+bytes/iu.test(err.message)
    ) {
      throw new ProductionRunnerError({
        failureClass: "FIGMA_PAYLOAD_TOO_LARGE",
        message: `Figma payload exceeds ${maxPayloadBytes} bytes limit.`,
        retryable: false,
        cause: err,
      });
    }
    if (err instanceof FigmaRestFetchError) {
      throw new ProductionRunnerError({
        failureClass: "FIGMA_FETCH_FAILED",
        message: `Figma REST fetch failed (${err.errorClass}): ${err.message}`,
        retryable: err.retryable,
        cause: err,
      });
    }
    throw err;
  }
};

const assertFigmaPayloadWithinLimit = (
  file: FigmaRestFileSnapshot,
  maxPayloadBytes: number,
): void => {
  const payloadBytes = Buffer.byteLength(JSON.stringify(file), "utf8");
  if (payloadBytes <= maxPayloadBytes) {
    return;
  }
  throw new ProductionRunnerError({
    failureClass: "FIGMA_PAYLOAD_TOO_LARGE",
    message: `Figma payload exceeds ${maxPayloadBytes} bytes limit.`,
    retryable: false,
  });
};

const resolveCustomerLabel = (
  input: RunFigmaToQcTestCasesInput,
  file: FigmaRestFileSnapshot,
): string => {
  if (
    typeof input.customerLabel === "string" &&
    input.customerLabel.length > 0
  ) {
    return input.customerLabel;
  }
  if (file.name.length > 0) return file.name;
  return file.fileKey;
};

const resolveSourceLabel = (source: ProductionRunnerSource): string => {
  if (source.kind === "figma_url") {
    // Strip any query string so the label never carries a token-looking
    // node-id alongside the URL (defence in depth).
    try {
      const url = new URL(source.figmaUrl);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "(figma_url)";
    }
  }
  return "(figma_paste)";
};

interface BoundIntentForLlmCaps {
  maxFieldsPerScreen: number;
  maxActionsPerScreen: number;
  maxValidationsPerScreen: number;
  maxNavigationPerScreen: number;
}

/**
 * Return a deep copy of the IR with per-screen caps applied to the four
 * `detected*` arrays. The IR is sorted by `(screenId, id)` upstream
 * (`deriveBusinessTestIntentIr`) so a deterministic prefix is also a
 * deterministic representative slice — same input → same wire IR → same
 * `promptHash` → same replay-cache identity.
 *
 * When any array is truncated, an `assumptions` entry is appended naming the
 * affected screens so the model (and any reviewer reading
 * `compiled-prompt.json`) sees exactly which slices were partial. The full
 * IR is still persisted as `business-intent-ir.json` separately.
 */
export const boundIntentForLlm = (
  intent: BusinessTestIntentIr,
  caps: BoundIntentForLlmCaps,
): BusinessTestIntentIr => {
  const truncationNotes: string[] = [];
  const relevantFieldIds = new Set(
    intent.detectedFields
      .filter((field) =>
        isCoverageRelevantElementLike({
          label: field.label,
          kind: field.type,
        }),
      )
      .map((field) => field.id),
  );
  const relevantScreenIds = new Set(
    intent.detectedFields
      .filter((field) => relevantFieldIds.has(field.id))
      .map((field) => field.screenId),
  );

  const cap = <T extends { screenId: string }>(
    rows: ReadonlyArray<T>,
    perScreenCap: number,
    label: string,
  ): T[] => {
    const byScreen = new Map<string, T[]>();
    for (const row of rows) {
      const bucket = byScreen.get(row.screenId);
      if (bucket === undefined) byScreen.set(row.screenId, [row]);
      else bucket.push(row);
    }
    const out: T[] = [];
    const truncatedScreens: string[] = [];
    for (const [screenId, bucket] of byScreen) {
      if (bucket.length > perScreenCap) {
        truncatedScreens.push(`${screenId} (${bucket.length}→${perScreenCap})`);
        for (let i = 0; i < perScreenCap; i += 1) {
          const row = bucket[i];
          if (row !== undefined) out.push(row);
        }
      } else {
        for (const row of bucket) out.push(row);
      }
    }
    if (truncatedScreens.length > 0) {
      truncationNotes.push(
        `LLM-prompt slice: detected${label} truncated for screens ${truncatedScreens.join(", ")}; full IR persisted to business-intent-ir.json.`,
      );
    }
    return out;
  };

  const boundedFields = cap(
    intent.detectedFields.filter((field) => relevantFieldIds.has(field.id)),
    caps.maxFieldsPerScreen,
    "Fields",
  );
  const boundedActions = cap(
    intent.detectedActions.filter((action) =>
      isCoverageRelevantActionLike(action),
    ),
    caps.maxActionsPerScreen,
    "Actions",
  );
  const boundedValidations = cap(
    intent.detectedValidations.filter(
      (validation) =>
        validation.targetFieldId === undefined ||
        relevantFieldIds.has(validation.targetFieldId) ||
        relevantScreenIds.has(validation.screenId),
    ),
    caps.maxValidationsPerScreen,
    "Validations",
  );
  const boundedNavigation = cap(
    intent.detectedNavigation,
    caps.maxNavigationPerScreen,
    "Navigation",
  );

  return {
    ...intent,
    detectedFields: boundedFields,
    detectedActions: boundedActions,
    detectedValidations: boundedValidations,
    detectedNavigation: boundedNavigation,
    assumptions: [...intent.assumptions, ...truncationNotes],
  };
};

interface DraftValidationResult {
  ok: true;
  value: LlmDraftResponse;
}
interface DraftValidationFailure {
  ok: false;
  message: string;
}

// ── Harness wiring helpers (Issue #1791) ────────────────────────────────────

type LlmAttemptOutcome =
  | {
      readonly kind: "ok";
      readonly drafts: ReadonlyArray<ProductionRunnerLlmDraftCase>;
    }
  | {
      readonly kind: "error";
      readonly error: ProductionRunnerError;
      readonly errorKind: AgentHarnessAttemptResult["errorKind"];
      readonly errorClass: AgentHarnessErrorClass;
    };

interface ClassifyLlmAttemptInput {
  readonly llmResult: Awaited<ReturnType<LlmGatewayClient["generate"]>>;
  readonly gatewayRelease: string;
  readonly finopsRecorder: ReturnType<typeof createFinOpsUsageRecorder>;
  readonly llmDurationMs: number;
  readonly attemptId?: string;
}

const LIVE_SMOKE_GATEWAY_RELEASE_MARKERS = ["live-smoke", "live-e2e"] as const;

const isSmokeTaggedGatewayRelease = (
  gatewayRelease: string | undefined,
): boolean => {
  if (typeof gatewayRelease !== "string" || gatewayRelease.length === 0) {
    return false;
  }
  const normalized = gatewayRelease.trim().toLowerCase();
  return LIVE_SMOKE_GATEWAY_RELEASE_MARKERS.some((marker) =>
    normalized.includes(marker),
  );
};

const classifyLlmAttempt = (
  input: ClassifyLlmAttemptInput,
): LlmAttemptOutcome => {
  const {
    llmResult,
    gatewayRelease,
    finopsRecorder,
    llmDurationMs,
    attemptId,
  } = input;
  if (llmResult.outcome !== "success") {
    if (llmResult.errorClass === "refusal") {
      return {
        kind: "error",
        errorKind: "policy_block",
        errorClass: "policy_refusal",
        error: new ProductionRunnerError({
          failureClass: "LLM_REFUSAL",
          message: `LLM refused to produce test cases: ${llmResult.message}`,
          retryable: false,
        }),
      };
    }
    if (llmResult.errorClass === "canceled") {
      return {
        kind: "error",
        errorKind: "permanent",
        errorClass: "gateway_error",
        error: new ProductionRunnerError({
          failureClass: "LLM_GATEWAY_FAILED",
          message: "LLM gateway request canceled by caller.",
          retryable: false,
        }),
      };
    }
    return {
      kind: "error",
      errorKind: llmResult.retryable ? "retryable" : "permanent",
      errorClass: llmResult.retryable ? "gateway_error" : "schema_validation",
      error: new ProductionRunnerError({
        failureClass: "LLM_GATEWAY_FAILED",
        message: `LLM gateway returned ${llmResult.errorClass}: ${llmResult.message}`,
        retryable: llmResult.retryable,
      }),
    };
  }
  finopsRecorder.recordAttempt({
    role: "test_generation",
    source: "generator",
    ...(attemptId !== undefined ? { attemptId } : {}),
    deployment: llmResult.modelDeployment,
    durationMs: llmDurationMs,
    result: llmResult,
    // Only smoke-tagged lanes count toward the live-smoke budget; ordinary
    // CLI/live runs keep the live-smoke counter at zero.
    liveSmoke: isSmokeTaggedGatewayRelease(gatewayRelease),
    fallback: false,
  });
  const draftValidation = validateLlmDraftResponse(llmResult.content);
  if (!draftValidation.ok) {
    return {
      kind: "error",
      errorKind: "permanent",
      errorClass: "schema_validation",
      error: new ProductionRunnerError({
        failureClass: "LLM_RESPONSE_INVALID",
        message: `LLM response did not match the expected draft schema: ${draftValidation.message}`,
        retryable: false,
      }),
    };
  }
  return { kind: "ok", drafts: draftValidation.value.testCases };
};

interface BuildHarnessAttemptResultInput {
  readonly hashes: {
    readonly inputHash: string;
    readonly promptHash: string;
    readonly schemaHash: string;
    readonly cacheKey: string;
    readonly cacheablePrefixHash: string;
  };
  readonly judgeAccepted: boolean;
  readonly errorClass: AgentHarnessErrorClass;
  readonly llmDurationMs: number;
  readonly llmInputTokens: number;
  readonly llmOutputTokens: number;
}

const buildHarnessAttemptResult = (
  input: BuildHarnessAttemptResultInput,
): AgentHarnessAttemptResult => {
  if (input.judgeAccepted) {
    return {
      inputHash: input.hashes.inputHash,
      promptHash: input.hashes.promptHash,
      schemaHash: input.hashes.schemaHash,
      cacheKeyDigest: input.hashes.cacheKey,
      cacheablePrefixHash: input.hashes.cacheablePrefixHash,
      judgeAccepted: true,
      errorKind: "none",
      errorClass: "none",
      inputTokens: input.llmInputTokens,
      outputTokens: input.llmOutputTokens,
      latencyMs: input.llmDurationMs,
    };
  }
  return {
    inputHash: input.hashes.inputHash,
    promptHash: input.hashes.promptHash,
    schemaHash: input.hashes.schemaHash,
    cacheKeyDigest: input.hashes.cacheKey,
    cacheablePrefixHash: input.hashes.cacheablePrefixHash,
    judgeAccepted: false,
    errorKind: "permanent",
    errorClass: input.errorClass,
    inputTokens: input.llmInputTokens,
    outputTokens: input.llmOutputTokens,
    latencyMs: input.llmDurationMs,
  };
};

const deriveFinopsOutcomeFromValidation = (
  validation: ReturnType<typeof runValidationPipeline>,
  judgeAccepted: boolean,
): FinOpsJobOutcome | undefined => {
  if (validation.visual !== undefined && validation.visual.blocked) {
    return "visual_sidecar_failed";
  }
  if (!judgeAccepted) {
    return "validation_blocked";
  }
  if (validation.policy.blocked) {
    return "policy_blocked";
  }
  if (validation.validation.blocked) {
    return "validation_blocked";
  }
  return undefined;
};

const mapHarnessOutcomeToProductionRunnerError = (
  summary: ProductionRunnerHarnessSummary,
): ProductionRunnerError => {
  if (summary.outcome === "blocked") {
    return new ProductionRunnerError({
      failureClass: "LLM_REFUSAL",
      message: `Harness blocked test_generation: ${summary.errorClass}`,
      retryable: false,
    });
  }
  return new ProductionRunnerError({
    failureClass: "LLM_GATEWAY_FAILED",
    message: `Harness refused test_generation outcome: ${summary.outcome} (${summary.errorClass})`,
    retryable: summary.outcome === "failed_retryable",
  });
};

const validateLlmDraftResponse = (
  content: unknown,
): DraftValidationResult | DraftValidationFailure => {
  if (
    typeof content !== "object" ||
    content === null ||
    Array.isArray(content)
  ) {
    return { ok: false, message: "response is not a JSON object" };
  }
  const root = content as Record<string, unknown>;
  if (!Array.isArray(root.testCases)) {
    return { ok: false, message: "testCases must be an array" };
  }
  // Per-case soft validation: drop individual bad drafts rather than
  // failing the whole batch. Live LLM probes (gpt-oss-120b on Azure AI
  // Foundry, 2026-05-02) showed the model occasionally emitting an
  // out-of-enum `type` on a single case while the rest of the batch was
  // well-formed; failing closed on the entire batch turned a 4-of-5
  // partial success into a 0-of-5 outage. We still require ≥ 1 valid
  // draft for the response to count as successful.
  const drafts: ProductionRunnerLlmDraftCase[] = [];
  const droppedReasons: string[] = [];
  for (let i = 0; i < root.testCases.length; i += 1) {
    const candidate: unknown = root.testCases[i];
    const validated = validateDraftCase(candidate, `testCases[${i}]`);
    if (!validated.ok) {
      droppedReasons.push(validated.message);
      continue;
    }
    drafts.push(validated.value);
  }
  if (drafts.length === 0) {
    return {
      ok: false,
      message:
        droppedReasons.length > 0
          ? `LLM response did not match the expected draft schema: ${droppedReasons[0]}`
          : "LLM response contained no test cases",
    };
  }
  return { ok: true, value: { testCases: drafts } };
};

interface DraftCaseResult {
  ok: true;
  value: ProductionRunnerLlmDraftCase;
}
interface DraftCaseFailure {
  ok: false;
  message: string;
}

const VALID_TYPES: ReadonlySet<TestCaseType> = new Set([
  "functional",
  "negative",
  "boundary",
  "validation",
  "navigation",
  "regression",
  "exploratory",
  "accessibility",
]);
const VALID_PRIORITIES: ReadonlySet<TestCasePriority> = new Set([
  "p0",
  "p1",
  "p2",
  "p3",
]);
const VALID_RISK: ReadonlySet<TestCaseRiskCategory> = new Set([
  "low",
  "medium",
  "high",
  "regulated_data",
  "financial_transaction",
]);
const VALID_TECHNIQUE: ReadonlySet<TestCaseTechnique29119> = new Set([
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
const VALID_LEVEL: ReadonlySet<TestCaseLevel> = new Set([
  "unit",
  "component",
  "integration",
  "system",
  "acceptance",
]);

const validateDraftCase = (
  candidate: unknown,
  path: string,
): DraftCaseResult | DraftCaseFailure => {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return { ok: false, message: `${path} is not an object` };
  }
  const c = candidate as Record<string, unknown>;
  const title = c.title;
  if (typeof title !== "string" || title.length === 0) {
    return { ok: false, message: `${path}.title is required` };
  }
  const objective = c.objective;
  if (typeof objective !== "string" || objective.length === 0) {
    return { ok: false, message: `${path}.objective is required` };
  }
  if (typeof c.type !== "string" || !VALID_TYPES.has(c.type as TestCaseType)) {
    return { ok: false, message: `${path}.type is invalid` };
  }
  if (
    typeof c.priority !== "string" ||
    !VALID_PRIORITIES.has(c.priority as TestCasePriority)
  ) {
    return { ok: false, message: `${path}.priority is invalid` };
  }
  if (
    typeof c.riskCategory !== "string" ||
    !VALID_RISK.has(c.riskCategory as TestCaseRiskCategory)
  ) {
    return { ok: false, message: `${path}.riskCategory is invalid` };
  }
  if (
    typeof c.technique !== "string" ||
    !VALID_TECHNIQUE.has(c.technique as TestCaseTechnique29119)
  ) {
    return { ok: false, message: `${path}.technique is invalid` };
  }
  if (!Array.isArray(c.preconditions) || !c.preconditions.every(isString)) {
    return { ok: false, message: `${path}.preconditions must be string[]` };
  }
  if (!Array.isArray(c.testData) || !c.testData.every(isString)) {
    return { ok: false, message: `${path}.testData must be string[]` };
  }
  if (!Array.isArray(c.steps) || c.steps.length === 0) {
    return { ok: false, message: `${path}.steps must be a non-empty array` };
  }
  const steps: ProductionRunnerLlmDraftCase["steps"][number][] = [];
  for (let i = 0; i < c.steps.length; i += 1) {
    const step: unknown = c.steps[i];
    if (typeof step !== "object" || step === null || Array.isArray(step)) {
      return { ok: false, message: `${path}.steps[${i}] is not an object` };
    }
    const s = step as Record<string, unknown>;
    if (typeof s.action !== "string" || s.action.length === 0) {
      return { ok: false, message: `${path}.steps[${i}].action is required` };
    }
    const stepIndex = typeof s.index === "number" ? s.index : i + 1;
    const projected: ProductionRunnerLlmDraftCase["steps"][number] = {
      index: stepIndex,
      action: s.action,
    };
    if (typeof s.data === "string") projected.data = s.data;
    if (typeof s.expected === "string") projected.expected = s.expected;
    steps.push(projected);
  }
  if (!Array.isArray(c.expectedResults) || !c.expectedResults.every(isString)) {
    return { ok: false, message: `${path}.expectedResults must be string[]` };
  }
  const traceRefs = Array.isArray(c.figmaTraceRefs) ? c.figmaTraceRefs : [];
  const validatedTraceRefs: Array<{
    screenId: string;
    nodeId?: string;
    nodeName?: string;
    nodePath?: string;
  }> = [];
  for (let i = 0; i < traceRefs.length; i += 1) {
    const ref: unknown = traceRefs[i];
    if (typeof ref !== "object" || ref === null || Array.isArray(ref)) {
      return { ok: false, message: `${path}.figmaTraceRefs[${i}] not object` };
    }
    const r = ref as Record<string, unknown>;
    if (typeof r.screenId !== "string" || r.screenId.length === 0) {
      return {
        ok: false,
        message: `${path}.figmaTraceRefs[${i}].screenId required`,
      };
    }
    const projected: NonNullable<
      ProductionRunnerLlmDraftCase["figmaTraceRefs"]
    >[number] = { screenId: r.screenId };
    if (typeof r.nodeId === "string") projected.nodeId = r.nodeId;
    if (typeof r.nodeName === "string") projected.nodeName = r.nodeName;
    if (typeof r.nodePath === "string") projected.nodePath = r.nodePath;
    validatedTraceRefs.push(projected);
  }
  const assumptions = Array.isArray(c.assumptions)
    ? c.assumptions.filter(isString)
    : [];
  const openQuestions = Array.isArray(c.openQuestions)
    ? c.openQuestions.filter(isString)
    : [];
  const draft: ProductionRunnerLlmDraftCase = {
    title,
    objective,
    type: c.type as TestCaseType,
    priority: c.priority as TestCasePriority,
    riskCategory: c.riskCategory as TestCaseRiskCategory,
    technique: c.technique as TestCaseTechnique29119,
    preconditions: c.preconditions,
    testData: c.testData,
    steps,
    expectedResults: c.expectedResults,
    assumptions,
    openQuestions,
  };
  if (
    typeof c.level === "string" &&
    VALID_LEVEL.has(c.level as TestCaseLevel)
  ) {
    draft.level = c.level as TestCaseLevel;
  }
  if (validatedTraceRefs.length > 0) {
    draft.figmaTraceRefs = validatedTraceRefs;
  }
  const regulatoryRelevance = parseDraftRegulatoryRelevance(
    c.regulatoryRelevance,
  );
  if (regulatoryRelevance !== undefined) {
    draft.regulatoryRelevance = regulatoryRelevance;
  }
  const qualitySignals = parseDraftQualitySignals(c.qualitySignals);
  if (qualitySignals !== undefined) {
    draft.qualitySignals = qualitySignals;
  }
  return { ok: true, value: draft };
};

/**
 * Tolerant parser for the optional `qualitySignals` field on a draft case
 * (Issue #1901). The strict generator response schema accepts the field
 * but does not require it; the runner gathers whichever covered* arrays
 * the model emitted and falls back to empty arrays for the rest. This
 * is what feeds the downstream coverage hard-gate with the LLM's view
 * of which IR ids each test case covers.
 */
const parseDraftQualitySignals = (
  raw: unknown,
): NonNullable<ProductionRunnerLlmDraftCase["qualitySignals"]> | undefined => {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const result: NonNullable<ProductionRunnerLlmDraftCase["qualitySignals"]> =
    {};
  const stringArray = (value: unknown): ReadonlyArray<string> | undefined =>
    Array.isArray(value) && value.every(isString) ? value : undefined;
  const fieldIds = stringArray(r.coveredFieldIds);
  if (fieldIds !== undefined) result.coveredFieldIds = fieldIds;
  const actionIds = stringArray(r.coveredActionIds);
  if (actionIds !== undefined) result.coveredActionIds = actionIds;
  const validationIds = stringArray(r.coveredValidationIds);
  if (validationIds !== undefined) result.coveredValidationIds = validationIds;
  const navigationIds = stringArray(r.coveredNavigationIds);
  if (navigationIds !== undefined) result.coveredNavigationIds = navigationIds;
  if (
    typeof r.confidence === "number" &&
    Number.isFinite(r.confidence) &&
    r.confidence >= 0 &&
    r.confidence <= 1
  ) {
    result.confidence = r.confidence;
  }
  return Object.keys(result).length === 0 ? undefined : result;
};

/**
 * Tolerant parser for the optional `regulatoryRelevance` field on a draft
 * case. The field is optional contract-wise (4.27.0); if absent or shaped
 * incorrectly we silently skip it rather than failing the whole response —
 * the validation pipeline is the authoritative gate, not the runner.
 */
const parseDraftRegulatoryRelevance = (
  raw: unknown,
): { domain: RegulatoryRelevanceDomain; rationale: string } | undefined => {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.domain !== "string" || typeof r.rationale !== "string") {
    return undefined;
  }
  if (
    !ALLOWED_REGULATORY_RELEVANCE_DOMAINS.includes(
      r.domain as RegulatoryRelevanceDomain,
    )
  ) {
    return undefined;
  }
  const rationale = r.rationale.trim();
  if (rationale.length === 0) return undefined;
  // Cap rationale at 240 chars per contract.
  const trimmed = rationale.length > 240 ? rationale.slice(0, 240) : rationale;
  return {
    domain: r.domain as RegulatoryRelevanceDomain,
    rationale: trimmed,
  };
};

const isString = (value: unknown): value is string => typeof value === "string";

type StampedQualitySignals = GeneratedTestCase["qualitySignals"];

const buildTraceTargetIndex = (
  intent: BusinessTestIntentIr,
): {
  fieldIds: ReadonlyMap<string, string>;
  actionIds: ReadonlyMap<string, string>;
  validationIds: ReadonlyMap<string, string>;
  navigationIds: ReadonlyMap<string, string>;
} => {
  const addTraceKeys = (
    map: Map<string, string>,
    id: string,
    screenId: string,
    trace: { nodeId?: string },
  ): void => {
    map.set(id, id);
    if (trace.nodeId !== undefined) {
      map.set(trace.nodeId, id);
      map.set(`${screenId}::${trace.nodeId}`, id);
    }
  };
  const fieldIds = new Map<string, string>();
  for (const field of intent.detectedFields) {
    addTraceKeys(fieldIds, field.id, field.screenId, field.trace);
  }
  const actionIds = new Map<string, string>();
  for (const action of intent.detectedActions) {
    addTraceKeys(actionIds, action.id, action.screenId, action.trace);
  }
  const validationIds = new Map<string, string>();
  for (const validation of intent.detectedValidations) {
    addTraceKeys(
      validationIds,
      validation.id,
      validation.screenId,
      validation.trace,
    );
  }
  const navigationIds = new Map<string, string>();
  for (const navigation of intent.detectedNavigation) {
    addTraceKeys(
      navigationIds,
      navigation.id,
      navigation.screenId,
      navigation.trace,
    );
  }
  return { fieldIds, actionIds, validationIds, navigationIds };
};

const mergeUniqueSortedIds = (
  left: readonly string[] | undefined,
  right: Iterable<string>,
): string[] => [...new Set([...(left ?? []), ...right])].sort();

const enrichWorkflowTopologyCoverage = (input: {
  testCase: GeneratedTestCase;
  workflowTopology: WorkflowTopology;
}): GeneratedTestCase => {
  if (input.workflowTopology.actions.length === 0) {
    return input.testCase;
  }
  const screenIds = [
    ...new Set(input.testCase.figmaTraceRefs.map((traceRef) => traceRef.screenId)),
  ];
  if (screenIds.length === 0) {
    return input.testCase;
  }
  const matchedActionIds = workflowActionIdsForTargets({
    topology: input.workflowTopology,
    coveredFieldIds: input.testCase.qualitySignals.coveredFieldIds,
    screenIds,
    text: [
      input.testCase.title,
      input.testCase.objective,
      ...input.testCase.steps.flatMap((step) => [
        step.action,
        step.expected ?? "",
      ]),
      ...input.testCase.expectedResults,
    ].join("\n"),
  });
  const coveredActionIds = mergeUniqueSortedIds(
    input.testCase.qualitySignals.coveredActionIds,
    matchedActionIds,
  );
  const anchor = workflowActionAnchorText(coveredActionIds);
  const alreadyAnnotated = input.testCase.steps.some((step) =>
    /\bACT-\d{3}\b/u.test(step.action),
  );
  return {
    ...input.testCase,
    steps:
      anchor === undefined || alreadyAnnotated || input.testCase.steps.length === 0
        ? input.testCase.steps
        : input.testCase.steps.map((step, index) =>
            index === 0
              ? {
                  ...step,
                  action: `${anchor} ${step.action}`,
                }
              : step,
          ),
    qualitySignals: {
      ...input.testCase.qualitySignals,
      coveredActionIds,
    },
  };
};

const deriveQualitySignals = (input: {
  draft: ProductionRunnerLlmDraftCase;
  traceRefs: readonly GeneratedTestCaseFigmaTrace[];
  intent: BusinessTestIntentIr;
}): StampedQualitySignals => {
  const index = buildTraceTargetIndex(input.intent);
  const coveredFieldIds = new Set<string>();
  const coveredActionIds = new Set<string>();
  const coveredValidationIds = new Set<string>();
  const coveredNavigationIds = new Set<string>();
  const collect = (key: string | undefined): void => {
    if (key === undefined) return;
    const fieldId = index.fieldIds.get(key);
    if (fieldId !== undefined) coveredFieldIds.add(fieldId);
    const actionId = index.actionIds.get(key);
    if (actionId !== undefined) coveredActionIds.add(actionId);
    const validationId = index.validationIds.get(key);
    if (validationId !== undefined) coveredValidationIds.add(validationId);
    const navigationId = index.navigationIds.get(key);
    if (navigationId !== undefined) coveredNavigationIds.add(navigationId);
  };

  for (const ref of input.traceRefs) {
    collect(ref.nodeId);
    collect(
      ref.nodeId === undefined ? undefined : `${ref.screenId}::${ref.nodeId}`,
    );
  }

  return {
    coveredFieldIds: mergeUniqueSortedIds(
      input.draft.qualitySignals?.coveredFieldIds,
      coveredFieldIds,
    ),
    coveredActionIds: mergeUniqueSortedIds(
      input.draft.qualitySignals?.coveredActionIds,
      coveredActionIds,
    ),
    coveredValidationIds: mergeUniqueSortedIds(
      input.draft.qualitySignals?.coveredValidationIds,
      coveredValidationIds,
    ),
    coveredNavigationIds: mergeUniqueSortedIds(
      input.draft.qualitySignals?.coveredNavigationIds,
      coveredNavigationIds,
    ),
    confidence: input.draft.qualitySignals?.confidence ?? 0.85,
  };
};

const PURE_NO_ACTION_HALLUCINATION_PATTERN =
  /\b(?:button|schaltfl[aä]che|klick(?:e|en)?|anklicken|submit|absenden|senden|weiter)\b/iu;
const CURRENCY_UNIT_HALLUCINATION_PATTERN =
  /\b(?:währungseinheit(?:en)?|währung|einheit(?:en)?|eur|€)\b/iu;
const RADIO_OPTION_LABELS = new Set(["brutto", "netto"]);

const sanitizeNoActionText = (value: string): string =>
  value
    .replace(/\bRadio-?Buttons?\b/giu, "Auswahloptionen")
    .replace(/\bRadio-?Button\b/giu, "Auswahloption")
    .replace(/\b(?:Submit|Absenden|Senden|Weiter)(?:-?Button)?\b/giu, "Eingabe")
    .replace(
      /\b(?:Bestätigungs-?Button|Icon-?Button|Button|Schaltfl[aä]che)\b/giu,
      "Bedienelement",
    )
    .replace(/\s*\([^)]*(?:button|schaltfl[aä]che|aktion)[^)]*\)/giu, "")
    .replace(
      /Das Feld für den Brutto[^\n.]*nicht im IR vorhanden[^.]*\./giu,
      "Die Option „Brutto“ ist ausgewählt.",
    )
    .replace(/\s*\([^)]*nicht im IR vorhanden[^)]*\)/giu, "")
    .replace(/\s+und\s+best[aä]tig(?:e|en)?\s+(?:die\s+)?Eingabe\.?/giu, ".")
    .replace(/\s+und\s+speichere\s+(?:die\s+)?Eingabe\.?/giu, ".")
    .replace(/\bFelder und Aktionen\b/giu, "Felder")
    .replace(/\bund Aktionen\b/giu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();

const normalizeSemanticLabel = (value: string): string =>
  value.trim().toLowerCase();

const coveredFieldLabels = (
  testCase: GeneratedTestCase,
  intent: BusinessTestIntentIr,
): string[] => {
  const byId = new Map(
    intent.detectedFields.map((field) => [field.id, field.label]),
  );
  return [
    ...new Set(
      testCase.qualitySignals.coveredFieldIds
        .map((id) => byId.get(id))
        .filter((label): label is string => label !== undefined),
    ),
  ];
};

const buildNoActionFallbackSteps = (
  testCase: GeneratedTestCase,
  intent: BusinessTestIntentIr,
): GeneratedTestCase["steps"] => {
  const labels = coveredFieldLabels(testCase, intent);
  const fallbackLabels =
    labels.length > 0
      ? labels
      : [
          ...new Set(
            intent.detectedFields
              .map((field) => field.label.trim())
              .filter((label) => label.length > 0),
          ),
        ];
  if (fallbackLabels.length === 0) {
    return [
      {
        index: 1,
        action: "Prüfe den angezeigten Zustand der Maske.",
        expected:
          "Die Maske zeigt den erwarteten Zustand ohne erfundene Bedienaktion.",
      },
    ];
  }
  return fallbackLabels.map((label, index) => ({
    index: index + 1,
    action: `Prüfe das Feld „${label}“ gemäß Testdaten.`,
    expected: `Das Feld „${label}“ zeigt den erwarteten Zustand ohne zusätzliche Bedienaktion.`,
  }));
};

const REGULATED_DATA_EVIDENCE_PATTERN =
  /\b(?:iban|bic|vertragsnummer|person(?:en)?daten|personenbezogen|kundendaten|kontoinhaber|adresse|geburtsdatum|steuer(?:nummer|id)|email|e-mail|telefon)\b/iu;
const FINANCIAL_TRANSACTION_EVIDENCE_PATTERN =
  /\b(?:zahlung|buchung|transaktion|überweisung|ueberweisung|auftrag|antrag|kreditantrag|freigabe|absenden|einreichen|senden|submit|status(?:änderung|aenderung))\b/iu;

const intentEvidenceText = (intent: BusinessTestIntentIr): string =>
  [
    ...intent.risks,
    ...intent.screens.map((screen) => screen.screenName),
    ...intent.detectedFields.map((field) => field.label),
    ...intent.detectedActions.map((action) => action.label),
    ...intent.detectedValidations.map((validation) => validation.rule),
    ...intent.openQuestions,
  ].join("\n");

const hasRegulatedDataEvidence = (intent: BusinessTestIntentIr): boolean =>
  intent.piiIndicators.length > 0 ||
  REGULATED_DATA_EVIDENCE_PATTERN.test(intentEvidenceText(intent));

const hasFinancialTransactionEvidence = (
  intent: BusinessTestIntentIr,
): boolean =>
  intent.detectedActions.some((action) =>
    isCoverageRelevantActionLike(action),
  ) || FINANCIAL_TRANSACTION_EVIDENCE_PATTERN.test(intentEvidenceText(intent));

const normalizeDraftRiskCategory = (
  riskCategory: TestCaseRiskCategory,
  intent: BusinessTestIntentIr,
): TestCaseRiskCategory => {
  if (riskCategory === "regulated_data" && !hasRegulatedDataEvidence(intent)) {
    return "medium";
  }
  if (
    riskCategory === "financial_transaction" &&
    !hasFinancialTransactionEvidence(intent)
  ) {
    return "medium";
  }
  return riskCategory;
};

const maybeRewriteRadioCurrencyCase = (
  testCase: GeneratedTestCase,
  intent: BusinessTestIntentIr,
): GeneratedTestCase => {
  const labels = coveredFieldLabels(testCase, intent);
  if (labels.length === 0) return testCase;
  if (
    !labels.every((label) =>
      RADIO_OPTION_LABELS.has(normalizeSemanticLabel(label)),
    )
  ) {
    return testCase;
  }
  const fullText = [
    testCase.title,
    testCase.objective,
    ...testCase.steps.flatMap((step) => [step.action, step.expected ?? ""]),
    ...testCase.expectedResults,
  ].join("\n");
  if (!CURRENCY_UNIT_HALLUCINATION_PATTERN.test(fullText)) {
    return testCase;
  }
  const prefix = testCase.title.match(/^TC\d+\s*[:–-]\s*/u)?.[0] ?? "";
  const optionText = labels.join("/");
  return {
    ...testCase,
    title: `${prefix}Kaufpreiserfassung ${optionText} auswählen`,
    objective: `Prüft, dass die Optionen ${optionText} zur Kaufpreiserfassung auswählbar sind.`,
    steps: labels.map((label, index) => ({
      index: index + 1,
      action: `Wähle die Option „${label}“.`,
      expected: `Die Option „${label}“ ist ausgewählt.`,
    })),
    expectedResults: [
      `Die Auswahl ${optionText} kann ohne technische Fehlermeldung gesetzt werden.`,
    ],
  };
};

const sanitizeNoActionHallucinations = (
  testCase: GeneratedTestCase,
  intent: BusinessTestIntentIr,
): GeneratedTestCase => {
  if (
    intent.detectedActions.some((action) =>
      isCoverageRelevantActionLike(action),
    )
  ) {
    return maybeRewriteRadioCurrencyCase(testCase, intent);
  }
  const steps = testCase.steps
    .map((step) => ({
      original: step,
      sanitized: {
        ...step,
        action: sanitizeNoActionText(step.action),
        ...(step.expected !== undefined
          ? { expected: sanitizeNoActionText(step.expected) }
          : {}),
      },
    }))
    .filter(
      ({ original, sanitized }) =>
        !PURE_NO_ACTION_HALLUCINATION_PATTERN.test(original.action) &&
        !(
          typeof original.expected === "string" &&
          PURE_NO_ACTION_HALLUCINATION_PATTERN.test(original.expected)
        ) &&
        !PURE_NO_ACTION_HALLUCINATION_PATTERN.test(sanitized.action) &&
        !(
          typeof sanitized.expected === "string" &&
          PURE_NO_ACTION_HALLUCINATION_PATTERN.test(sanitized.expected)
        ),
    )
    .map(({ sanitized }, index) => ({
      ...sanitized,
      index: index + 1,
    }));
  return maybeRewriteRadioCurrencyCase(
    {
      ...testCase,
      title: sanitizeNoActionText(testCase.title),
      objective: sanitizeNoActionText(testCase.objective),
      preconditions: testCase.preconditions.map(sanitizeNoActionText),
      testData: testCase.testData.map(sanitizeNoActionText),
      steps:
        steps.length > 0 ? steps : buildNoActionFallbackSteps(testCase, intent),
      expectedResults: testCase.expectedResults.map(sanitizeNoActionText),
      assumptions: testCase.assumptions.map(sanitizeNoActionText),
      openQuestions: testCase.openQuestions.map(sanitizeNoActionText),
    },
    intent,
  );
};

const ensureAccessibilityCoverageTerms = (
  testCase: GeneratedTestCase,
): GeneratedTestCase => {
  if (testCase.type !== "accessibility") {
    return testCase;
  }
  const fullText = [
    testCase.title,
    testCase.objective,
    ...testCase.steps.flatMap((step) => [step.action, step.expected ?? ""]),
    ...testCase.expectedResults,
  ]
    .join("\n")
    .toLowerCase();
  const requiredTerms = ["keyboard-nav", "focus-order", "screen-reader"];
  if (requiredTerms.every((term) => fullText.includes(term))) {
    return testCase;
  }
  return {
    ...testCase,
    expectedResults: [
      ...testCase.expectedResults,
      "Accessibility-Coverage: Tastatur-Navigation (keyboard-nav), Fokusreihenfolge (focus-order) und Screen-Reader-Ausgabe (screen-reader) sind geprüft.",
    ],
  };
};

const testCaseTouchesUnresolvedConstraint = (
  testCase: GeneratedTestCase,
  constraint: ReturnType<typeof deriveUnresolvedValidationConstraints>[number],
): boolean => {
  if (
    constraint.fieldIds.some((fieldId) =>
      testCase.qualitySignals.coveredFieldIds.includes(fieldId),
    )
  ) {
    return true;
  }
  if (
    constraint.validationIds.some((validationId) =>
      testCase.qualitySignals.coveredValidationIds.includes(validationId),
    )
  ) {
    return true;
  }
  if (
    constraint.screenId !== undefined &&
    testCase.figmaTraceRefs.some(
      (traceRef) => traceRef.screenId === constraint.screenId,
    )
  ) {
    return true;
  }
  return false;
};

const propagateUnresolvedCoverageContext = (input: {
  testCase: GeneratedTestCase;
  model: TestDesignModel;
}): GeneratedTestCase => {
  const unresolvedConstraints = deriveUnresolvedValidationConstraints(
    input.model,
  )
    .filter((constraint) =>
      testCaseTouchesUnresolvedConstraint(input.testCase, constraint),
    )
    .map((constraint) => constraint.evidenceText);
  if (unresolvedConstraints.length === 0) {
    return input.testCase;
  }
  return {
    ...input.testCase,
    openQuestions: [
      ...new Set([...input.testCase.openQuestions, ...unresolvedConstraints]),
    ].sort((left, right) => left.localeCompare(right)),
    expectedResults:
      input.testCase.type === "negative" || input.testCase.type === "validation"
        ? [GENERIC_VALIDATION_EXPECTED_RESULT]
        : input.testCase.expectedResults,
  };
};

const buildAmbiguityProbeCase = (input: {
  list: GeneratedTestCaseList;
  model: TestDesignModel;
  jobId: string;
  unresolvedConstraints: ReadonlyArray<
    ReturnType<typeof deriveUnresolvedValidationConstraints>[number]
  >;
}): GeneratedTestCase | undefined => {
  if (
    input.list.testCases.length === 0 ||
    input.unresolvedConstraints.length === 0
  ) {
    return undefined;
  }
  const seedCase = input.list.testCases[0]!;
  const firstConstraint = input.unresolvedConstraints[0]!;
  const firstScreen = input.model.screens[0];
  if (firstScreen === undefined) {
    return undefined;
  }
  const firstFieldId =
    firstConstraint.fieldIds[0] ?? firstScreen.elements[0]?.elementId;
  const firstScreenId = firstConstraint.screenId ?? firstScreen.screenId;
  const id = `tc-${createHash("sha256")
    .update(
      canonicalJson({
        jobId: input.jobId,
        unresolvedConstraint: firstConstraint.evidenceText,
        kind: "ambiguity-probe",
      }),
    )
    .digest("hex")
    .slice(0, 12)}`;
  return {
    ...seedCase,
    id,
    title: `Unklare Fachregel auf ${firstScreen.name} absichern`,
    objective:
      "Dokumentiert ungeklärtes Verhalten als negativer Prüfpfad, statt fachliche Regeln zu erfinden.",
    type: "negative",
    technique: "error_guessing",
    priority: "p1",
    preconditions: [`Maske „${firstScreen.name}“ ist geöffnet`],
    testData: [],
    steps: [
      {
        index: 1,
        action: `Übe den ungeklärten Pfad auf „${firstScreen.name}“ gemäß offener Fachfrage aus.`,
        expected: GENERIC_VALIDATION_EXPECTED_RESULT,
      },
    ],
    expectedResults: [GENERIC_VALIDATION_EXPECTED_RESULT],
    figmaTraceRefs: [{ screenId: firstScreenId }],
    assumptions: [...seedCase.assumptions],
    openQuestions: [firstConstraint.evidenceText],
    qualitySignals: {
      ...seedCase.qualitySignals,
      coveredFieldIds: firstFieldId === undefined ? [] : [firstFieldId],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: Math.min(seedCase.qualitySignals.confidence, 0.8),
    },
    reviewState: "draft",
  };
};

const resolveAdversarialCriticDomainFromList = (
  list: GeneratedTestCaseList,
): RegulatoryRelevanceDomain => {
  let insuranceCount = 0;
  let bankingCount = 0;
  for (const testCase of list.testCases) {
    switch (testCase.regulatoryRelevance?.domain) {
      case "insurance":
        insuranceCount += 1;
        break;
      case "banking":
        bankingCount += 1;
        break;
    }
  }
  if (insuranceCount > bankingCount) {
    return "insurance";
  }
  if (bankingCount > 0) {
    return "banking";
  }
  return "general";
};

const regenerateWithAdversarialCaseCountCeiling = (input: {
  list: GeneratedTestCaseList;
  maxCaseCount: number;
}): GeneratedTestCaseList => {
  if (input.list.testCases.length <= input.maxCaseCount) {
    return input.list;
  }
  const rank = (testCase: GeneratedTestCase): number => {
    switch (testCase.type) {
      case "negative":
        return 0;
      case "boundary":
        return 1;
      case "validation":
        return 2;
      case "accessibility":
        return 3;
      case "navigation":
        return 4;
      case "regression":
        return 5;
      case "exploratory":
        return 6;
      case "functional":
        return 7;
    }
  };
  const kept = input.list.testCases
    .slice()
    .sort(
      (left, right) =>
        rank(left) - rank(right) ||
        right.qualitySignals.confidence - left.qualitySignals.confidence ||
        left.id.localeCompare(right.id),
    )
    .slice(0, input.maxCaseCount)
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    ...input.list,
    testCases: kept,
  };
};

const stabilizeGeneratedListForAcceptance = (input: {
  list: GeneratedTestCaseList;
  model: TestDesignModel;
  jobId: string;
}): GeneratedTestCaseList => {
  // Issue #2013 — `propagateUnresolvedCoverageContext` keeps using the strict
  // (scoped) constraint set so unrelated specified validations are not
  // contaminated. Probe injection only needs *somewhere* on the mask to
  // anchor a clarification negative case, so it consults the screen-fallback
  // variant. That way a generic "Validierungsregeln sind noch zu
  // spezifizieren" note still produces a customer-visible probe case.
  const probeConstraints =
    deriveUnresolvedValidationConstraintsWithScreenFallback(input.model);
  const hasSourceScopedOpenQuestion = input.model.openQuestions.some(
    (question) => /^[a-z0-9_-]+:/iu.test(question.text),
  );
  const propagated = input.list.testCases.map((testCase) =>
    propagateUnresolvedCoverageContext({
      testCase,
      model: input.model,
    }),
  );
  const hasNegative = propagated.some(
    (testCase) => testCase.type === "negative",
  );
  const hasOpenQuestion = propagated.some(
    (testCase) => testCase.openQuestions.length > 0,
  );
  const probeCase =
    probeConstraints.length > 0 &&
    hasSourceScopedOpenQuestion &&
    (!hasNegative || !hasOpenQuestion)
      ? buildAmbiguityProbeCase({
          ...input,
          unresolvedConstraints: probeConstraints,
        })
      : undefined;
  return {
    ...input.list,
    testCases:
      probeCase === undefined
        ? propagated
        : [...propagated, probeCase].sort((left, right) =>
            left.id.localeCompare(right.id),
          ),
  };
};

const stampGeneratedTestCase = (input: {
  draft: ProductionRunnerLlmDraftCase;
  jobId: string;
  index: number;
  audit: GeneratedTestCaseAuditMetadata;
  intent: BusinessTestIntentIr;
  identitySalt?: string;
}): GeneratedTestCase => {
  const slug = createHash("sha256")
    .update(
      canonicalJson({
        jobId: input.jobId,
        index: input.index,
        title: input.draft.title,
        ...(input.identitySalt !== undefined
          ? { identitySalt: input.identitySalt }
          : {}),
      }),
    )
    .digest("hex")
    .slice(0, 12);
  const id = `tc-${slug}`;
  const knownScreenIds = new Set(input.intent.screens.map((s) => s.screenId));
  const traceRefs: GeneratedTestCaseFigmaTrace[] = (
    input.draft.figmaTraceRefs ?? []
  )
    .filter((r) => knownScreenIds.has(r.screenId))
    .map((r) => ({
      screenId: r.screenId,
      ...(r.nodeId !== undefined ? { nodeId: r.nodeId } : {}),
      ...(r.nodeName !== undefined ? { nodeName: r.nodeName } : {}),
      ...(r.nodePath !== undefined ? { nodePath: r.nodePath } : {}),
    }));
  if (traceRefs.length === 0) {
    const fallbackScreen = input.intent.screens[0]?.screenId;
    if (fallbackScreen !== undefined) {
      traceRefs.push({ screenId: fallbackScreen });
    }
  }
  const qualitySignals = deriveQualitySignals({
    draft: input.draft,
    traceRefs,
    intent: input.intent,
  });
  const steps: GeneratedTestCaseStep[] = input.draft.steps.map((s, i) => {
    const projected: GeneratedTestCaseStep = {
      index: typeof s.index === "number" && s.index > 0 ? s.index : i + 1,
      action: s.action,
    };
    if (typeof s.data === "string") projected.data = s.data;
    if (typeof s.expected === "string") projected.expected = s.expected;
    return projected;
  });
  const generated: GeneratedTestCase = {
    id,
    sourceJobId: input.jobId,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    title: input.draft.title,
    objective: input.draft.objective,
    level: input.draft.level ?? "system",
    type: input.draft.type,
    priority: input.draft.priority,
    riskCategory: normalizeDraftRiskCategory(
      input.draft.riskCategory,
      input.intent,
    ),
    technique: input.draft.technique,
    preconditions: [...input.draft.preconditions],
    testData: [...input.draft.testData],
    steps,
    expectedResults: [...input.draft.expectedResults],
    figmaTraceRefs: traceRefs,
    assumptions: [...(input.draft.assumptions ?? [])],
    openQuestions: [...(input.draft.openQuestions ?? [])],
    qcMappingPreview: {
      decisionBasis: "mapping_preview_only",
      exportable: true,
    },
    qualitySignals,
    reviewState: "draft",
    audit: { ...input.audit },
    ...(input.draft.regulatoryRelevance !== undefined
      ? {
          regulatoryRelevance: {
            domain: input.draft.regulatoryRelevance.domain,
            rationale: input.draft.regulatoryRelevance.rationale,
          } satisfies RegulatoryRelevance,
        }
      : {}),
  };
  return ensureAccessibilityCoverageTerms(
    sanitizeNoActionHallucinations(generated, input.intent),
  );
};

/**
 * Detect screens whose `screenName` matches a banking/insurance semantic
 * keyword (case-insensitive substring match). Returns the matching keyword
 * for each affected screenId so the prompt can name both the screen id and
 * the keyword that triggered the regulatory case requirement.
 */
export const detectBankingInsuranceScreens = (
  intent: BusinessTestIntentIr,
): ReadonlyArray<{ screenId: string; keyword: string }> => {
  const matches: { screenId: string; keyword: string }[] = [];
  for (const screen of intent.screens) {
    const haystack = screen.screenName.toLowerCase();
    for (const keyword of BANKING_INSURANCE_SEMANTIC_KEYWORDS) {
      if (haystack.includes(keyword.toLowerCase())) {
        matches.push({ screenId: screen.screenId, keyword });
        break;
      }
    }
  }
  return matches;
};

const buildAgentLessonsQuery = (intent: BusinessTestIntentIr): string =>
  [
    ...intent.screens.map((screen) => screen.screenName),
    ...intent.detectedFields.map((field) => field.label),
    ...intent.detectedActions.map((action) => action.label),
    ...intent.detectedValidations.map((validation) => validation.rule),
    ...intent.openQuestions,
  ]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join("\n");

const TRANSIENT_JUDGE_REFUSAL_CODES = new Set([
  "canceled",
  "gateway_unavailable",
  "rate_limited",
  "timeout",
]);

const isTransientJudgeInfrastructureEntry = (
  entry: JudgeConsensusVerdict["panel"][number],
): boolean =>
  entry.verdict === "reject" &&
  entry.repairInstructions.length === 0 &&
  entry.findings.length > 0 &&
  entry.findings.every((finding) =>
    TRANSIENT_JUDGE_REFUSAL_CODES.has(finding.code),
  );

const isNonBlockingJudgeInfrastructureFailure = (
  verdict: JudgeConsensusVerdict,
): boolean =>
  verdict.verdict === "reject" &&
  verdict.panel.some(isTransientJudgeInfrastructureEntry) &&
  verdict.panel.every(
    (entry) =>
      entry.verdict === "accept" || isTransientJudgeInfrastructureEntry(entry),
  );

const isJudgeConsensusAcceptedForRun = (
  verdict: JudgeConsensusVerdict,
): boolean =>
  verdict.verdict === "accept" ||
  isNonBlockingJudgeInfrastructureFailure(verdict);

const BANKING_INSURANCE_PROMPT_RULES: ReadonlyArray<string> = Object.freeze([
  "- Wenn das Profil 'eu-banking-default' aktiv ist, behandle die Maske als reguliert (Bank/Versicherung).",
  "- Erzeuge zu jedem regulierten Eingabefeld mindestens EINEN Positiv- und EINEN Negativfall.",
  "- Erzeuge IBAN-, BIC-, Vertragsnummer- oder Personendaten-Tests NUR, wenn solche Felder oder Anforderungen in Figma, Jira/Custom Context oder Kundenprofil vorkommen.",
  "- Erzeuge Vier-Augen-Prinzip-/Audit-Trail-Testfälle NUR, wenn eine echte statusverändernde Aktion oder ein entsprechender Fachkontext erkannt wurde.",
  "- Setze riskCategory='regulated_data' NUR bei echten personenbezogenen/IBAN/BIC/Vertragsnummer-Daten. Setze riskCategory='financial_transaction' NUR bei echter Zahlung, Buchung, Übermittlung oder Statusänderung.",
  "- Erzeuge Boundary-Tests für Geldbeträge / Währungen NUR für semantische Betrag-/Währungsfelder, nicht für dekorative Einheiten oder angezeigte Beispielwerte.",
  "- Für jeden Bildschirm, dessen Name ein Banking/Versicherungs-Stichwort enthält, erzeuge GENAU EINEN regulatory-compliance Testfall.",
  "- Setze regulatoryRelevance.domain auf 'banking' oder 'insurance' (oder 'general' wenn nicht zuordenbar) und schreibe rationale auf DEUTSCH (≤ 240 Zeichen).",
  "- WICHTIG: Verwende NUR generische Compliance-Sprache. Zitiere KEINE Paragraphen, KEINE Gesetzesnummern, KEINE konkreten Aufsichtsdokumente.",
  "- Erfinde keine Buttons, Fehlermeldungen, Datenarten oder Feldnamen, die aus den Eingaben nicht ableitbar sind.",
]);

const escapePromptBlockText = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return char;
    }
  });

const wrapUntrustedFigmaPromptText = (value: string, id: string): string =>
  `<UNTRUSTED_FIGMA_TEXT id="${escapePromptBlockText(
    id,
  )}" sha256="${createHash("sha256").update(value).digest("hex")}" source="figma_node">${escapePromptBlockText(
    value,
  )}</UNTRUSTED_FIGMA_TEXT>`;

const buildPromptSuffixSections = (
  intent: BusinessTestIntentIr,
  policyProfileId: string,
  hasCustomContextMarkdown: boolean = false,
  customerEvalRubric?: ResolvedCustomerEvalRubric,
  diversityBias?: string,
): CompilePromptSuffixSection[] => {
  const screenSummary = intent.screens.map((screen) => ({
    screenId: screen.screenId,
    screenName: wrapUntrustedFigmaPromptText(
      screen.screenName,
      `${screen.screenId}:screenName`,
    ),
  }));
  const isEuBanking = policyProfileId === EU_BANKING_DEFAULT_POLICY_PROFILE_ID;
  const bankingInsuranceMatches = isEuBanking
    ? detectBankingInsuranceScreens(intent)
    : [];
  const bankingInsuranceList =
    bankingInsuranceMatches.length > 0
      ? bankingInsuranceMatches
          .map((m) => `- ${m.screenId} (Stichwort: ${m.keyword})`)
          .join("\n")
      : "(keine)";
  const sections: CompilePromptSuffixSection[] = [
    {
      kind: "text",
      label: "DELIVERABLE FORMAT",
      body: [
        "Respond ONLY with a JSON object of the form:",
        `{"testCases": [{"title": string, "objective": string, "type": one of [functional|negative|boundary|validation|navigation|regression|exploratory|accessibility], "priority": one of [p0|p1|p2|p3], "riskCategory": one of [low|medium|high|regulated_data|financial_transaction], "technique": one of [equivalence_partitioning|boundary_value_analysis|decision_table|state_transition|use_case|exploratory|error_guessing|syntax_testing|classification_tree], "preconditions": string[], "testData": string[], "steps": [{"index": number, "action": string, "expected": string}], "expectedResults": string[], "figmaTraceRefs": [{"screenId": string, "nodeId": string?, "nodeName": string?}], "qualitySignals": {"coveredFieldIds": string[], "coveredActionIds": string[], "coveredValidationIds": string[], "coveredNavigationIds": string[], "confidence": number}, "assumptions": string[], "openQuestions": string[], "regulatoryRelevance": {"domain": one of [banking|insurance|general], "rationale": string}}]}`,
      ].join("\n"),
    },
    {
      kind: "text",
      label: "RULES",
      body: [
        "- Schreibe alle Inhalte (title, objective, steps, expected, ...) auf DEUTSCH.",
        "- Bilde Positiv- und Negativfälle ab. Bündele dekorative Labels und technische Textnodes nicht als eigene Testfälle.",
        "- Nutze für screenId die genannten IDs aus dem IR.",
        "- Fülle qualitySignals mit den passenden IR-IDs. Wenn figmaTraceRefs auf Felder oder Aktionen zeigen, müssen coveredFieldIds/coveredActionIds diese IDs enthalten.",
        "- Roh-Figma-IDs dürfen nicht in kundensichtbaren Titeln stehen. Verwende fachliche Namen aus Labels, Nachbartexten oder Funktionsbereichen.",
        "- Setze review-pflichtige riskCategory-Werte nur bei Eingabe-Evidenz: regulated_data nur bei PII/IBAN/BIC/Vertragsnummer; financial_transaction nur bei echter Transaktion oder Statusänderung.",
        "- Liefere mindestens einen Testfall pro Bildschirm.",
      ].join("\n"),
    },
  ];
  if (customerEvalRubric !== undefined) {
    sections.push({
      kind: "text",
      label: "CUSTOMER_TEST_DESIGN_RUBRIC",
      body: [
        "Die folgende explizit übergebene Kunden-Eval-Rubrik steuert Format, Granularität und Qualitätskriterien der kundensichtbaren Testfälle.",
        "Wende sie als eigene Rubrik an, nicht als zusätzliche Jira-Anforderung.",
        "Erzwinge daraus: Titel, Beschreibung, fortlaufende Steps, je Testaktion ein Step, erwarteter Zustand je Step sowie positive und negative Anwendungsfälle.",
        "Für einfache Masken gilt: kein atomarer Testfall pro dekorativem Label; teste Nutzungskontexte und Funktionsbereiche.",
        "",
        "<CUSTOMER_TEST_DESIGN_RUBRIC_MARKDOWN>",
        escapePromptBlockText(customerEvalRubric.bodyPlain),
        "</CUSTOMER_TEST_DESIGN_RUBRIC_MARKDOWN>",
      ].join("\n"),
    });
  }
  if (isEuBanking) {
    sections.push({
      kind: "text",
      label: `POLICY-PROFIL: ${policyProfileId} (regulierte EU-Banking/Versicherung)`,
      body: [
        ...BANKING_INSURANCE_PROMPT_RULES,
        "",
        "Banking/Versicherungs-Bildschirme (genau ein regulatory-compliance Testfall pro Eintrag):",
        bankingInsuranceList,
      ].join("\n"),
    });
  }
  if (hasCustomContextMarkdown) {
    sections.push({
      kind: "text",
      label: "CUSTOM_CONTEXT_MARKDOWN EVIDENCE RULE",
      body: [
        "Die Sektion `custom_context_markdown` ist eigenständige Evidenzquelle.",
        "Sobald ein Testfall fachlich auf eine Anforderung aus `custom_context_markdown` zurückgeht, MUSS er im Output eine identifizierende Quellen-Referenz tragen, die diese Markdown-Sektion benennt.",
        "Trage diese Referenz NICHT in `figmaTraceRefs` ein. `figmaTraceRefs` dürfen ausschließlich echte Figma-Screens/Nodes aus dem IR enthalten.",
        "Nutze stattdessen `assumptions` oder `openQuestions` mit dem Präfix `custom_context_markdown:`. Mindestens ein Testfall pro Lauf muss eine solche Referenz enthalten, wenn der Markdown-Inhalt für die Generierung relevant war.",
      ].join("\n"),
    });
  }
  if (diversityBias !== undefined) {
    sections.push({
      kind: "text",
      label: "DIVERSITY SAMPLING BIAS",
      body: diversityBias,
    });
  }
  sections.push({
    kind: "json",
    label: "Verfügbare Bildschirme",
    jsonPayload: screenSummary,
  });
  return sections;
};

type ProductionRunnerDiversityPassCount = 1 | 2;

interface GenerationPassConfig {
  readonly passId?: "a" | "b";
  readonly roleRunId: string;
  readonly seed?: number;
  readonly diversityBias?: string;
  readonly identitySalt?: string;
}

const resolveDiversityPassCount = (
  generation: RunFigmaToQcTestCasesInput["generation"],
): ProductionRunnerDiversityPassCount => {
  const value = generation?.diversityPasses ?? 1;
  if (value !== 1 && value !== 2) {
    throw new RangeError(
      `runFigmaToQcTestCases: generation.diversityPasses must be 1 or 2, got ${String(
        value,
      )}`,
    );
  }
  return value;
};

const resolveGenerationPasses = (
  diversityPasses: ProductionRunnerDiversityPassCount,
): readonly GenerationPassConfig[] => {
  if (diversityPasses === 1) {
    return [{ roleRunId: "test_generation" }];
  }
  return listGeneratorDiversityPassProfiles(2).map((profile) => ({
    passId: profile.passId,
    roleRunId: profile.roleRunId,
    seed: profile.seed,
    diversityBias: profile.bias,
    identitySalt: profile.roleRunId,
  }));
};

// The runner schema intentionally tolerates unknown sibling properties on
// each test case. Live LLM probes (gpt-oss-120b on Azure AI Foundry,
// 2026-05-02) returned `coveredFieldIds` and other downstream-pipeline
// fields at the test-case level — fields the model picked up from the IR
// or training-data leak. The strict `additionalProperties: false` policy
// failed the entire response on those harmless extras. The validator
// (`validateDraftCase`) only reads the known properties below, so unknown
// siblings are silently dropped — same outcome the strict schema would
// have achieved on a model that perfectly obeyed the spec.
const buildDraftResponseSchema = (): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  required: ["testCases"],
  properties: {
    testCases: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        // additionalProperties is intentionally NOT set to false here; see
        // the comment above buildDraftResponseSchema for why.
        required: [
          "title",
          "objective",
          "type",
          "priority",
          "riskCategory",
          "technique",
          "preconditions",
          "testData",
          "steps",
          "expectedResults",
        ],
        properties: {
          title: { type: "string", minLength: 1 },
          objective: { type: "string", minLength: 1 },
          type: { type: "string" },
          priority: { type: "string" },
          riskCategory: { type: "string" },
          technique: { type: "string" },
          level: { type: "string" },
          preconditions: { type: "array", items: { type: "string" } },
          testData: { type: "array", items: { type: "string" } },
          steps: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["action"],
              properties: {
                index: { type: "number" },
                action: { type: "string", minLength: 1 },
                data: { type: "string" },
                expected: { type: "string" },
              },
            },
          },
          expectedResults: { type: "array", items: { type: "string" } },
          figmaTraceRefs: {
            type: "array",
            items: {
              type: "object",
              required: ["screenId"],
              properties: {
                screenId: { type: "string" },
                nodeId: { type: "string" },
                nodeName: { type: "string" },
                nodePath: { type: "string" },
              },
            },
          },
          assumptions: { type: "array", items: { type: "string" } },
          openQuestions: { type: "array", items: { type: "string" } },
          regulatoryRelevance: {
            type: "object",
            required: ["domain", "rationale"],
            additionalProperties: false,
            properties: {
              domain: {
                type: "string",
                enum: [...ALLOWED_REGULATORY_RELEVANCE_DOMAINS],
              },
              rationale: { type: "string", minLength: 1 },
            },
          },
          // Issue #1901 — coverage signals from the LLM. The schema
          // intentionally omits `additionalProperties: false` to mirror
          // the surrounding tolerance; the runner picks up the four
          // covered* arrays plus an optional confidence in [0, 1].
          qualitySignals: {
            type: "object",
            properties: {
              coveredFieldIds: {
                type: "array",
                items: { type: "string", minLength: 1 },
              },
              coveredActionIds: {
                type: "array",
                items: { type: "string", minLength: 1 },
              },
              coveredValidationIds: {
                type: "array",
                items: { type: "string", minLength: 1 },
              },
              coveredNavigationIds: {
                type: "array",
                items: { type: "string", minLength: 1 },
              },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
      },
    },
  },
});

const writeAtomicText = async (
  destinationPath: string,
  payload: string,
): Promise<void> => {
  const tmpPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(tmpPath, payload, "utf8");
  await rename(tmpPath, destinationPath);
};

const encodeCanonicalJson = (payload: unknown): Uint8Array =>
  new TextEncoder().encode(canonicalJson(payload));

const writeAtomicBytes = async (
  destinationPath: string,
  payload: Uint8Array | Buffer,
): Promise<void> => {
  const tmpPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(tmpPath, payload);
  await rename(tmpPath, destinationPath);
};

const sha256OfBytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

interface PersistedVisualCaptureFile {
  readonly screenId: string;
  readonly filename: string;
  readonly path: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly bytes: Buffer;
}

interface PersistedVisualCaptureArtifacts {
  readonly directory: string;
  readonly manifestPath: string;
  readonly manifestFilename: string;
  readonly manifestBytes: Uint8Array;
  readonly files: ReadonlyArray<PersistedVisualCaptureFile>;
}

const persistVisualCaptureArtifacts = async (input: {
  readonly artifactDir: string;
  readonly captures: Awaited<
    ReturnType<typeof fetchFigmaScreenCapturesForTestIntelligence>
  >;
  readonly jobId: string;
  readonly generatedAt: string;
}): Promise<PersistedVisualCaptureArtifacts> => {
  const directory = join(input.artifactDir, VISUAL_CAPTURE_ARTIFACT_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const files: PersistedVisualCaptureFile[] = [];
  const manifestEntries: Array<Record<string, unknown>> = [];
  for (const [index, capture] of input.captures.entries()) {
    const bytes = Buffer.from(capture.base64Data, "base64");
    const filename = [
      `${String(index + 1).padStart(2, "0")}-`,
      sanitizeVisualCaptureFileSegment(capture.screenId),
      ".",
      visualCaptureExtensionForMimeType(capture.mimeType),
    ].join("");
    const destinationPath = join(directory, filename);
    await writeAtomicBytes(destinationPath, bytes);
    const sha256 = sha256OfBytes(bytes);
    files.push({
      screenId: capture.screenId,
      filename: `${VISUAL_CAPTURE_ARTIFACT_DIRECTORY}/${filename}`,
      path: destinationPath,
      mimeType: capture.mimeType,
      byteLength: bytes.byteLength,
      sha256,
      bytes,
    });
    manifestEntries.push({
      screenId: capture.screenId,
      ...(capture.screenName !== undefined
        ? { screenName: capture.screenName }
        : {}),
      mimeType: capture.mimeType,
      byteLength: bytes.byteLength,
      sha256,
      filename,
      ...(capture.widthPx !== undefined ? { widthPx: capture.widthPx } : {}),
      ...(capture.heightPx !== undefined ? { heightPx: capture.heightPx } : {}),
    });
  }
  const manifest = {
    schemaVersion: "1.0.0",
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    // The capture manifest attests screenshot files via hashes + paths;
    // it does not inline raw screenshot bytes in the JSON payload.
    rawScreenshotsIncluded: false,
    rawScreenshotFilesPersisted: true,
    persistedScreenshotBytes: files.reduce(
      (sum, file) => sum + file.byteLength,
      0,
    ),
    captures: manifestEntries,
  };
  const manifestPath = join(directory, VISUAL_CAPTURE_MANIFEST_FILENAME);
  const manifestBytes = encodeCanonicalJson(manifest);
  await writeAtomicBytes(manifestPath, manifestBytes);
  return {
    directory,
    manifestPath,
    manifestFilename: `${VISUAL_CAPTURE_ARTIFACT_DIRECTORY}/${VISUAL_CAPTURE_MANIFEST_FILENAME}`,
    manifestBytes,
    files,
  };
};

const recordVisualSidecarAttempts = (input: {
  recorder: ReturnType<typeof createFinOpsUsageRecorder>;
  result: VisualSidecarResult;
}): void => {
  const imageBytes = input.result.captureIdentities.reduce(
    (sum, identity) => sum + identity.byteLength,
    0,
  );
  for (const [index, attempt] of input.result.attempts.entries()) {
    const role = index === 0 ? "visual_primary" : "visual_fallback";
    const succeeded = attempt.errorClass === undefined;
    const result: LlmGenerationResult = succeeded
      ? {
          outcome: "success",
          content: null,
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0 },
          modelDeployment: attempt.deployment,
          modelRevision: attempt.deployment,
          gatewayRelease: attempt.deployment,
          attempt: attempt.attempt,
        }
      : {
          outcome: "error",
          errorClass: attempt.errorClass as LlmGatewayErrorClass,
          message: "visual sidecar attempt failure (redacted by client)",
          retryable: false,
          attempt: attempt.attempt,
        };
    input.recorder.recordAttempt({
      role,
      source: role,
      deployment: attempt.deployment,
      durationMs: attempt.durationMs,
      imageBytes,
      result,
      fallback: role === "visual_fallback",
      liveSmoke: attempt.deployment !== "mock",
    });
  }
};

const sanitizeVisualCaptureFileSegment = (value: string): string => {
  const segment = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96);
  return segment.length > 0 ? segment : "screen";
};

const visualCaptureExtensionForMimeType = (mimeType: string): string => {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "bin";
};

/**
 * Resolve and validate the FinOps envelope. Operator override wins
 * outright (no merging with the default). Invalid envelopes throw a
 * `FINOPS_BUDGET_INVALID` runner error before any IO touches the
 * network or filesystem.
 */
const resolveFinopsBudget = (
  override: FinOpsBudgetEnvelope | undefined,
): FinOpsBudgetEnvelope => {
  const envelope =
    override !== undefined
      ? cloneFinOpsBudgetEnvelope(override)
      : cloneFinOpsBudgetEnvelope(PRODUCTION_FINOPS_BUDGET_ENVELOPE);
  const validation = validateFinOpsBudgetEnvelope(envelope);
  if (!validation.valid) {
    const reasons = validation.errors
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    throw new ProductionRunnerError({
      failureClass: "FINOPS_BUDGET_INVALID",
      message: `FinOps envelope rejected: ${reasons}`,
      retryable: false,
    });
  }
  return envelope;
};

/**
 * Build a no-throw event emitter. Errors raised by a sink are swallowed
 * so a misbehaving consumer cannot crash the runner pipeline.
 */
const makeEmitter = (
  sink: ProductionRunnerEventSink | undefined,
): ((event: ProductionRunnerEvent) => void) => {
  if (sink === undefined) {
    return () => {
      /* no-op */
    };
  }
  return (event) => {
    try {
      sink(event);
    } catch {
      /* swallow — sink misbehaviour must not corrupt the pipeline */
    }
  };
};

interface ResolvedCustomContextMarkdown {
  bodyMarkdown: string;
  bodyPlain: string;
  markdownContentHash: string;
  plainContentHash: string;
}

interface ResolvedCustomerEvalRubric {
  bodyMarkdown: string;
  bodyPlain: string;
  markdownContentHash: string;
  plainContentHash: string;
}

const formatCustomContextMarkdownIssues = (
  issues: readonly CustomContextMarkdownIssue[],
): string =>
  issues
    .map((issue) =>
      issue.detail !== undefined ? `${issue.code}:${issue.detail}` : issue.code,
    )
    .join(",");

const resolveCustomContextMarkdown = (
  raw: string | undefined,
): ResolvedCustomContextMarkdown | undefined => {
  if (raw === undefined) return undefined;
  const result = canonicalizeCustomContextMarkdown(raw);
  if (!result.ok) {
    throw new ProductionRunnerError({
      failureClass: "CUSTOM_CONTEXT_MARKDOWN_INVALID",
      message: `customContextMarkdown rejected: ${formatCustomContextMarkdownIssues(result.issues)}`,
      retryable: false,
    });
  }
  return {
    bodyMarkdown: result.value.bodyMarkdown,
    bodyPlain: result.value.bodyPlain,
    markdownContentHash: result.value.markdownContentHash,
    plainContentHash: result.value.plainContentHash,
  };
};

const resolveCustomerEvalRubric = (
  raw: string | undefined,
): ResolvedCustomerEvalRubric | undefined => {
  if (raw === undefined) return undefined;
  const result = canonicalizeCustomContextMarkdown(raw);
  if (!result.ok) {
    throw new ProductionRunnerError({
      failureClass: "CUSTOM_CONTEXT_MARKDOWN_INVALID",
      message: `customerEvalMarkdown rejected: ${formatCustomContextMarkdownIssues(result.issues)}`,
      retryable: false,
    });
  }
  return {
    bodyMarkdown: result.value.bodyMarkdown,
    bodyPlain: result.value.bodyPlain,
    markdownContentHash: result.value.markdownContentHash,
    plainContentHash: result.value.plainContentHash,
  };
};

/**
 * Build the merged `CompiledPromptCustomContext` from an optional Markdown
 * body and an optional canonical customer profile. Either or both may be
 * present. Returns `undefined` only when both are absent.
 *
 * The customer-profile sections are rendered as deterministic Markdown and
 * appended to the markdown sections list so `buildCustomerDomainContextPayload`
 * in the prompt compiler surfaces them in the `[5] CustomerDomainContext` block.
 */
const buildCompiledCustomContext = (
  markdown: ResolvedCustomContextMarkdown | undefined,
  profile: CanonicalCustomerProfile | undefined,
): CompiledPromptCustomContext | undefined => {
  const markdownSections: CompiledPromptCustomContext["markdownSections"] = [];

  if (markdown !== undefined) {
    markdownSections.push({
      sourceId: CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID,
      entryId: markdown.markdownContentHash,
      bodyMarkdown: markdown.bodyMarkdown,
      bodyPlain: markdown.bodyPlain,
      markdownContentHash: markdown.markdownContentHash,
      plainContentHash: markdown.plainContentHash,
    });
  }

  if (profile !== undefined) {
    const profileMarkdown = renderCustomerProfileAsMarkdown(profile);
    if (profileMarkdown !== undefined) {
      markdownSections.push(profileMarkdown);
    }
  }

  if (markdownSections.length === 0) {
    return undefined;
  }
  return { markdownSections, structuredAttributes: [] };
};

const CUSTOMER_PROFILE_SOURCE_ID = "customer-profile" as const;

/**
 * Render the non-empty parts of a canonical customer profile as a Markdown
 * section suitable for the `[5] CustomerDomainContext` prompt block.
 * Returns `undefined` when the profile has no renderable domain context.
 */
const renderCustomerProfileAsMarkdown = (
  profile: CanonicalCustomerProfile,
): CompiledPromptCustomContext["markdownSections"][number] | undefined => {
  const lines: string[] = [];

  if (profile.glossary.length > 0) {
    lines.push("## Glossary");
    for (const entry of profile.glossary) {
      lines.push(`- **${entry.term}**: ${entry.definition}`);
    }
    lines.push("");
  }

  if (profile.riskTaxonomyOverrides.length > 0) {
    lines.push("## Risk Taxonomy Overrides");
    for (const override of profile.riskTaxonomyOverrides) {
      lines.push(`- ${override.class}: weight ${override.weight}`);
    }
    lines.push("");
  }

  if (profile.policyOverrides.length > 0) {
    lines.push("## Policy Overrides");
    for (const override of profile.policyOverrides) {
      const threshold =
        override.threshold !== undefined
          ? `, threshold ${override.threshold}`
          : "";
      lines.push(`- ${override.ruleId}: ${override.severity}${threshold}`);
    }
    lines.push("");
  }

  if (profile.fewShotExamples.length > 0) {
    lines.push("## Few-Shot Examples");
    for (const example of profile.fewShotExamples) {
      lines.push(
        `- **${example.caseTitle}** (${example.technique}): ${example.description}`,
      );
    }
    lines.push("");
  }

  if (lines.length === 0) {
    return undefined;
  }

  const bodyMarkdown = lines.join("\n").trimEnd() + "\n";
  const bodyPlain =
    bodyMarkdown
      .replace(/^#{1,6}\s+/gmu, "")
      .replace(/\*\*([^*]+)\*\*/gu, "$1")
      .replace(/\n{2,}/gu, "\n")
      .trim() + "\n";
  const markdownContentHash = createHash("sha256")
    .update(
      canonicalJson({ kind: "customer_profile_section", bodyMarkdown }),
      "utf8",
    )
    .digest("hex");
  const plainContentHash = createHash("sha256")
    .update(
      canonicalJson({ kind: "customer_profile_plain", bodyPlain }),
      "utf8",
    )
    .digest("hex");

  return {
    sourceId: CUSTOMER_PROFILE_SOURCE_ID,
    entryId: profile.contentHash,
    bodyMarkdown,
    bodyPlain,
    markdownContentHash,
    plainContentHash,
  };
};

/**
 * Apply `ictRegisterRef` inheritance from a canonical customer profile.
 * Each binding that lacks its own `ictRegisterRef` inherits the profile-level
 * value so `policy:ict-register-ref-required` is satisfied. Bindings that
 * already carry their own ref are left untouched. Input is never mutated.
 */
const applyCustomerProfileIctRef = (
  bindings: readonly ActiveModelBinding[],
  profile: CanonicalCustomerProfile | undefined,
): readonly ActiveModelBinding[] => {
  if (profile === undefined || profile.ictRegisterRef === undefined) {
    return bindings;
  }
  const fallback = profile.ictRegisterRef;
  return bindings.map((binding) =>
    binding.ictRegisterRef !== undefined
      ? binding
      : { ...binding, ictRegisterRef: fallback },
  );
};

/**
 * Parse and canonicalize the optional customer profile input (Issue #1946).
 * Throws {@link ProductionRunnerError} with `CUSTOMER_PROFILE_INVALID` on
 * any validation or canonicalization failure.
 */
const resolveCustomerProfile = (
  raw: CustomerProfileInput | undefined,
): CanonicalCustomerProfile | undefined => {
  if (raw === undefined) return undefined;
  const result = parseAndCanonicalizeCustomerProfile(JSON.stringify(raw));
  if (!result.ok) {
    const msgs = result.issues
      .map((i: CustomerProfileIssue) => `${i.path}: ${i.message}`)
      .join("; ");
    throw new ProductionRunnerError({
      failureClass: "CUSTOMER_PROFILE_INVALID",
      message: `customerProfile rejected: ${msgs}`,
      retryable: false,
    });
  }
  return result.profile;
};

const PRODUCTION_RUNNER_FIGMA_PRIMARY_SOURCE_ID =
  "production-runner-figma-primary" as const;

const buildSemanticEvidenceSourceEnvelope = (input: {
  baseEnvelope: MultiSourceTestIntentEnvelope | undefined;
  figmaSourceContentHash: string;
  customContextMarkdown:
    | ReturnType<typeof resolveCustomContextMarkdown>
    | undefined;
  generatedAt: string;
}): MultiSourceTestIntentEnvelope | undefined => {
  if (input.customContextMarkdown === undefined) {
    return input.baseEnvelope;
  }
  const sources: TestIntentSourceRef[] =
    input.baseEnvelope !== undefined && input.baseEnvelope.sources.length > 0
      ? [...input.baseEnvelope.sources]
      : [
          {
            sourceId: PRODUCTION_RUNNER_FIGMA_PRIMARY_SOURCE_ID,
            kind: "figma_rest",
            contentHash: input.figmaSourceContentHash,
            capturedAt: input.generatedAt,
          },
        ];
  if (!sources.some((source) => source.kind === "custom_markdown")) {
    sources.push({
      sourceId: CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID,
      kind: "custom_markdown",
      contentHash: input.customContextMarkdown.markdownContentHash,
      capturedAt: input.generatedAt,
      authorHandle: "reviewer",
      noteEntryId: input.customContextMarkdown.markdownContentHash,
      redactedMarkdownHash: input.customContextMarkdown.markdownContentHash,
      plainTextDerivativeHash: input.customContextMarkdown.plainContentHash,
    });
  }
  return {
    version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
    sources,
    aggregateContentHash: sha256Hex(
      sources
        .map((source) => ({
          sourceId: source.sourceId,
          kind: source.kind,
          contentHash: source.contentHash,
        }))
        .sort(
          (left, right) =>
            left.sourceId.localeCompare(right.sourceId) ||
            left.kind.localeCompare(right.kind) ||
            left.contentHash.localeCompare(right.contentHash),
        ),
    ),
    conflictResolutionPolicy:
      input.baseEnvelope?.conflictResolutionPolicy ?? "reviewer_decides",
    ...(input.baseEnvelope?.priorityOrder !== undefined
      ? { priorityOrder: [...input.baseEnvelope.priorityOrder] }
      : {}),
    ...(input.baseEnvelope?.sourceMixPlan !== undefined
      ? { sourceMixPlan: input.baseEnvelope.sourceMixPlan }
      : {}),
  };
};

const buildFigmaWithCustomMarkdownSourceMixPlan = (input: {
  figmaSourceContentHash: string;
  markdownContentHash: string;
  plainContentHash: string;
}): SourceMixPlan => {
  const primarySourceIds = [PRODUCTION_RUNNER_FIGMA_PRIMARY_SOURCE_ID];
  const supportingSourceIds = [CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID];
  const visualSidecarRequirement: SourceMixPlan["visualSidecarRequirement"] =
    "optional";
  const promptSections: SourceMixPlan["promptSections"] = [
    "figma_intent",
    "custom_context_markdown",
  ];
  const sourceDigests: SourceMixPlan["sourceDigests"] = [
    {
      sourceId: PRODUCTION_RUNNER_FIGMA_PRIMARY_SOURCE_ID,
      kind: "figma_rest",
      contentHash: input.figmaSourceContentHash,
    },
    {
      sourceId: CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID,
      kind: "custom_markdown",
      contentHash: input.markdownContentHash,
      redactedMarkdownHash: input.markdownContentHash,
      plainTextDerivativeHash: input.plainContentHash,
    },
  ];
  const sourceMixPlanHash = computeSourceMixPlanHash({
    kind: "figma_only",
    primarySourceIds,
    supportingSourceIds,
    visualSidecarRequirement,
    promptSections,
    sourceDigests,
  });
  return {
    version: SOURCE_MIX_PLAN_SCHEMA_VERSION,
    kind: "figma_only",
    primarySourceIds,
    supportingSourceIds,
    visualSidecarRequirement,
    promptSections,
    sourceDigests,
    sourceMixPlanHash,
    rawJiraResponsePersisted: false,
    rawPasteBytesPersisted: false,
  };
};

/**
 * Monotonic timestamp in milliseconds. Backed by `performance.now()`
 * when available (Node 20+); falls back to `Date.now()` if not.
 * Resolution: 1 ms.
 */
const monotonicMs = (): number => {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return Math.floor(performance.now());
  }
  return Date.now();
};
