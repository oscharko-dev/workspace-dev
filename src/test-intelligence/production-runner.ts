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
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import {
  ALLOWED_REGULATORY_RELEVANCE_DOMAINS,
  BANKING_INSURANCE_SEMANTIC_KEYWORDS,
  CONTEXT_BUDGET_ARTIFACT_DIRECTORY,
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  GENERATED_TESTCASES_ARTIFACT_FILENAME,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type AgentSourceLabel,
  type BusinessTestIntentIr,
  type FinOpsBudgetEnvelope,
  type GeneratedTestCase,
  type GeneratedTestCaseAuditMetadata,
  type GeneratedTestCaseFigmaTrace,
  type GeneratedTestCaseList,
  type GeneratedTestCaseStep,
  type LlmGenerationRequest,
  type RegulatoryRelevance,
  type RegulatoryRelevanceDomain,
  type TestCaseLevel,
  type TestCasePolicyReport,
  type TestCasePriority,
  type TestCaseRiskCategory,
  type TestCaseTechnique29119,
  type TestCaseType,
  type TestCaseValidationReport,
  type TestCaseCoverageReport,
  type VisualSidecarFailureClass,
  type VisualSidecarResult,
} from "../contracts/index.js";
import { sanitizeErrorMessage } from "../error-sanitization.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildWave1PocEvidenceManifest,
  verifyWave1PocEvidenceFromDisk,
  writeWave1PocEvidenceManifest,
} from "./evidence-manifest.js";
import {
  cloneFinOpsBudgetEnvelope,
  PRODUCTION_FINOPS_BUDGET_ENVELOPE,
  resolveFinOpsRequestLimits,
  validateFinOpsBudgetEnvelope,
} from "./finops-budget.js";
import {
  buildFinOpsBudgetReport,
  createFinOpsUsageRecorder,
  writeFinOpsBudgetReport,
} from "./finops-report.js";
import { computePerSourceCostBreakdownHashFromReport } from "./per-source-cost.js";
import type {
  ProductionRunnerEvent,
  ProductionRunnerEventSink,
} from "./production-runner-events.js";

export type {
  ProductionRunnerEvent,
  ProductionRunnerEventPhase,
  ProductionRunnerEventSink,
} from "./production-runner-events.js";
import { renderCustomerMarkdown } from "./customer-markdown-renderer.js";
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
import {
  compilePrompt,
  type CompilePromptSuffixSection,
} from "./prompt-compiler.js";
import { cloneEuBankingDefaultProfile } from "./policy-profile.js";
import { writeAgentRoleRunArtifact } from "./agent-role-run-artifact.js";
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
  normalizeUntrustedContent,
  writeUntrustedContentNormalizationReport,
} from "./untrusted-content-normalizer.js";
import { runValidationPipeline } from "./validation-pipeline.js";
import {
  describeVisualScreens,
  writeVisualSidecarResultArtifact,
} from "./visual-sidecar-client.js";

/**
 * Default test-generation deployment label. Exported so callers building
 * an LLM gateway client for the runner can pin the same identity, and so
 * tests can assert on the contract without re-importing the constant.
 */
export const PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT =
  "gpt-oss-120b" as const;
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

/**
 * Stable failure-class enum surfaced to callers (request handler maps
 * each value to an HTTP status + error envelope).
 */
export const PRODUCTION_RUNNER_FAILURE_CLASSES = [
  "EMPTY_FIGMA_INPUT",
  "FIGMA_FETCH_FAILED",
  "FIGMA_URL_REJECTED",
  "LLM_GATEWAY_FAILED",
  "LLM_REFUSAL",
  "LLM_RESPONSE_INVALID",
  "PERSIST_FAILED",
  "FINOPS_BUDGET_INVALID",
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
): "llama-4-maverick-vision" | "phi-4-multimodal-poc" | "mock" => {
  switch (deployment) {
    case "llama-4-maverick-vision":
      return "llama-4-maverick-vision";
    case "phi-4-multimodal-poc":
      return "phi-4-multimodal-poc";
    default:
      return "mock";
  }
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
  llm: ProductionRunnerLlmConfig;
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
    untrustedContentNormalizationReport: string;
    evidenceSeal: string;
    visualSidecarResult?: string;
    visualSidecarValidationReport?: string;
    agentRoleRun: string;
    genealogy: string;
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
  customerMarkdownPaths: {
    combined: string;
    perCase: ReadonlyArray<string>;
  };
}

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
  const emit = makeEmitter(input.events);
  const finopsRecorder = createFinOpsUsageRecorder();
  const artifactDir = join(
    input.outputRoot,
    "jobs",
    input.jobId,
    "test-intelligence",
  );

  // 0. Resolve + validate FinOps envelope. Operator override wins outright;
  //    no merging with the production default. Invalid envelopes fail
  //    fast before any IO touches the network.
  const finopsBudget = resolveFinopsBudget(input.finopsBudget);

  // 1. Resolve Figma source.
  emit({
    phase: "intent_derivation_started",
    timestamp: monotonicMs(),
    details: { source: input.source.kind },
  });
  const figmaFile = await resolveFigmaSource(input.source);
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
  let visualSidecarArtifactBytes: Uint8Array | undefined;
  let visualSidecarArtifact:
    | Awaited<ReturnType<typeof writeVisualSidecarResultArtifact>>["artifact"]
    | undefined;
  let visualSidecarRefusal:
    | { failureClass: VisualSidecarFailureClass; failureMessage: string }
    | undefined;
  let promptVisualBinding: Parameters<typeof compilePrompt>[0]["visualBinding"] = {
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
    const sidecarResult = await describeVisualScreens({
      bundle: input.llm.bundle,
      captures,
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      intent,
      requestLimits: {
        visualPrimary: resolveFinOpsRequestLimits(finopsBudget.roles.visual_primary),
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
    emit({
      phase: "visual_sidecar_skipped",
      timestamp: monotonicMs(),
      details: {
        reason:
          input.source.kind !== "figma_url"
            ? "non_figma_url_source"
            : "visual_sidecar_bundle_not_configured",
      },
    });
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

  // 5. Compile prompt.
  const compiled = compilePrompt({
    jobId: input.jobId,
    intent: wireIntent,
    ...(promptVisualBatch !== undefined ? { visual: promptVisualBatch } : {}),
    modelBinding: {
      modelRevision: TEST_GENERATION_MODEL_REVISION,
      gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
    },
    policyBundleVersion: POLICY_BUNDLE_VERSION,
    roleStepId: "test_generation",
    customerRubric,
    responseSchema: draftSchema,
    responseSchemaName: "workspace-dev-production-runner-draft-list-v1",
    outputSchemaHintLabel: "ProductionRunnerDraftResponse",
    suffixSections: buildPromptSuffixSections(wireIntent, policyProfileId),
    visualBinding: promptVisualBinding,
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

  // 6. Build the draft request using the compiler-owned schema hint and
  //    deterministic suffix layout.
  // FinOps-resolved per-request limits override the legacy llm.* fields.
  const effectiveMaxInputTokens = finopsLimits.maxInputTokens;
  const effectiveMaxOutputTokens =
    finopsLimits.maxOutputTokens ?? input.llm.maxOutputTokens;
  const effectiveMaxWallClockMs =
    finopsLimits.maxWallClockMs ?? input.llm.maxWallClockMs;
  const effectiveMaxRetries = finopsLimits.maxRetries;
  const generationRequest: LlmGenerationRequest & {
    onInFlightDedupHit?: (source: AgentSourceLabel) => void;
  } = {
    jobId: compiled.request.jobId,
    systemPrompt: compiled.request.systemPrompt,
    userPrompt: compiled.request.userPrompt,
    responseSchema: draftSchema,
    responseSchemaName: "workspace-dev-production-runner-draft-list-v1",
    inFlightDedup: {
      source: "generator",
      promptHash: compiled.request.hashes.promptHash,
      modelBinding: canonicalJson(compiled.request.modelBinding),
      schemaHash: compiled.request.hashes.schemaHash,
      policyProfileHash,
    },
    onInFlightDedupHit: (source) =>
      finopsRecorder.recordInFlightDedupHit(source),
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
  };
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
  emit({
    phase: "llm_gateway_request",
    timestamp: monotonicMs(),
    details: {
      role: "test_generation",
      deployment: PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT,
    },
  });
  const llmResult = await input.llm.client.generate(generationRequest);
  const llmDurationMs = Date.now() - startedAt;
  emit({
    phase: "llm_gateway_response",
    timestamp: monotonicMs(),
    details: {
      outcome: llmResult.outcome,
      ...(llmResult.outcome === "success"
        ? {
            inputTokens: llmResult.usage.inputTokens,
            outputTokens: llmResult.usage.outputTokens,
            finishReason: llmResult.finishReason,
          }
        : { errorClass: llmResult.errorClass }),
    },
  });

  // 6. Classify the LLM attempt into a harness-shaped envelope before
  // throwing, so `harness.mode === "shadow_eval"` / `"enforced"` can record
  // a per-step artifact even on failure.
  const attemptOutcome = classifyLlmAttempt({
    llmResult,
    finopsRecorder,
    llmDurationMs,
  });

  const harnessMode: ProductionRunnerHarnessMode = input.harness?.mode ?? "off";
  let harnessSummary: ProductionRunnerHarnessSummary | undefined;
  let harnessArtifactPath: string | undefined;
  if (harnessMode !== "off") {
    const harnessRoleStepId =
      input.harness?.roleStepId ?? PRODUCTION_RUNNER_HARNESS_ROLE_STEP_ID;
    const harnessTestDepth: AgentHarnessTestDepth =
      input.harness?.testDepth ?? "standard";
    const harnessAttemptResult = buildHarnessAttemptResult({
      hashes: compiled.request.hashes,
      attemptOutcome,
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
        // The callback is deterministic across attempts because we are
        // wrapping a single LLM result. The harness loop terminates after
        // attempt 1 for `accepted` / `permanent` / `policy_block`, and
        // after the role's `maxAttempts` cap for `retryable` results.
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
    throw attemptOutcome.error;
  }
  if (
    harnessMode === "enforced" &&
    harnessSummary !== undefined &&
    harnessSummary.outcome !== "accepted"
  ) {
    throw mapHarnessOutcomeToProductionRunnerError(harnessSummary);
  }
  const drafts = attemptOutcome.drafts;

  // 7. Stamp full GeneratedTestCase records.
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
  const testCases = drafts.map((draft, index) =>
    stampGeneratedTestCase({ draft, jobId: input.jobId, index, audit, intent }),
  );
  testCases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const generatedList: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: input.jobId,
    testCases,
  };

  // 8. Validation pipeline.
  emit({ phase: "validation_started", timestamp: monotonicMs() });
  const validation = runValidationPipeline({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: generatedList,
    intent,
    ...(promptVisualBatch !== undefined ? { visual: promptVisualBatch } : {}),
    ...(promptVisualBatch !== undefined
      ? {
          primaryVisualDeployment: "llama-4-maverick-vision" as const,
        }
      : {}),
    ...(visualSidecarRefusal !== undefined
      ? { visualSidecarRefusal }
      : {}),
    untrustedContentReport: normalizedUntrusted.report,
  });
  emit({
    phase: "validation_complete",
    timestamp: monotonicMs(),
    details: {
      blocked: validation.blocked,
      errorCount: validation.validation.errorCount,
      warningCount: validation.validation.warningCount,
      cases: validation.generatedTestCases.testCases.length,
    },
  });
  emit({
    phase: "policy_decision",
    timestamp: monotonicMs(),
    details: {
      blocked: validation.blocked,
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
      : join(
          artifactDir,
          VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
        );
  const policyPath = join(
    artifactDir,
    TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  );
  const coveragePath = join(
    artifactDir,
    TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  );
  const finopsReport = buildFinOpsBudgetReport({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    budget: finopsBudget,
    recorder: finopsRecorder,
  });
  const finopsWritten = await writeFinOpsBudgetReport({
    runDir: artifactDir,
    report: finopsReport,
  });
  const intentBytes = encodeCanonicalJson(intent);
  const compiledPromptBytes = encodeCanonicalJson(compiled.artifacts);
  const generatedBytes = encodeCanonicalJson(validation.generatedTestCases);
  const validationBytes = encodeCanonicalJson(validation.validation);
  const visualSidecarValidationBytes =
    validation.visual === undefined
      ? undefined
      : encodeCanonicalJson(validation.visual);
  const policyBytes = encodeCanonicalJson(validation.policy);
  const coverageBytes = encodeCanonicalJson(validation.coverage);
  const agentRoleRunPromise = writeAgentRoleRunArtifact({
    runDir: artifactDir,
    jobId: input.jobId,
    roleRunId: "test_generation",
    roleStepId: "test_generation",
    hashes: compiled.request.hashes,
  });
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
  try {
    await Promise.all([
      writeAtomicBytes(intentPath, intentBytes),
      writeAtomicBytes(compiledPromptPath, compiledPromptBytes),
      agentRoleRunPromise,
      ...(contextBudgetReportPath === undefined ||
      contextBudgetReportBytes === undefined
        ? []
        : [writeAtomicBytes(contextBudgetReportPath, contextBudgetReportBytes)]),
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
      writeAtomicBytes(policyPath, policyBytes),
      writeAtomicBytes(coveragePath, coverageBytes),
    ]);
  } catch (err) {
    throw new ProductionRunnerError({
      failureClass: "PERSIST_FAILED",
      message: `Could not persist test-intelligence artifacts: ${sanitizeErrorMessage({ error: err, fallback: "filesystem failure" })}`,
      retryable: false,
      cause: err,
    });
  }
  const agentRoleRunArtifact = await agentRoleRunPromise;
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
  const rendered = renderCustomerMarkdown({
    list: validation.generatedTestCases,
    fileName: customerLabel,
    sourceLabel,
    generatedAt: input.generatedAt,
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
          "agent-role-runs/test_generation.json",
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
      }),
    ),
    "utf8",
  );
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
  } satisfies Parameters<typeof buildWave1PocEvidenceManifest>[0]["modelDeployments"];
  const evidenceManifest = buildWave1PocEvidenceManifest({
    fixtureId: `production-runner-${input.source.kind}`,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    modelDeployments,
    policyProfileId: validation.policy.policyProfileId,
    policyProfileVersion: validation.policy.policyProfileVersion,
    exportProfileId: "customer-markdown",
    exportProfileVersion: "1.0.0",
    promptHash: compiled.request.hashes.promptHash,
    schemaHash: compiled.request.hashes.schemaHash,
    inputHash: compiled.request.hashes.inputHash,
    cacheKeyDigest: compiled.request.hashes.cacheKey,
    ...(visualSidecarSummary !== undefined
      ? { visualSidecar: visualSidecarSummary }
      : {}),
    ...(visualSidecarResult !== undefined
      ? {
          visualSidecarCaptureIdentities:
            visualSidecarResult.captureIdentities,
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
      {
        filename: "agent-role-runs/test_generation.json",
        bytes: agentRoleRunArtifact.bytes,
        category: "manifest",
      },
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
    await writeWave1PocEvidenceManifest({
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
  const manifestVerification = await verifyWave1PocEvidenceFromDisk(artifactDir, {
    rejectUnexpected: false,
  });
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
      manifest: "wave1-poc-evidence-manifest.json",
      headOfChainHash: harnessCheckpointSummary.headOfChainHash,
      chainLength: harnessCheckpointSummary.chainLength,
      bySourceHash: computePerSourceCostBreakdownHashFromReport(finopsReport),
    },
  });
  // Emit final FinOps summary derived from the LLM gateway response. The
  // dedicated FinOps recorder runs separately for in-process callers; this
  // synthetic event lets a UI render a useful cost summary without
  // wiring the full recorder.
  if (llmResult.outcome === "success") {
    emit({
      phase: "finops_recorded",
      timestamp: monotonicMs(),
      details: {
        role: "test_generation",
        deployment: llmResult.modelDeployment,
        attempts: finopsReport.totals.attempts,
        inputTokens: finopsReport.totals.inputTokens,
        outputTokens: finopsReport.totals.outputTokens,
        budgetMaxInputTokens: finopsLimits.maxInputTokens,
        budgetMaxOutputTokens: finopsLimits.maxOutputTokens,
        durationMs: finopsReport.totals.durationMs,
      },
    });
  }

  return {
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    fileKey: figmaFile.fileKey,
    generatedTestCases: validation.generatedTestCases,
    intent,
    validation: validation.validation,
    policy: validation.policy,
    coverage: validation.coverage,
    blocked: validation.blocked,
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
      untrustedContentNormalizationReport:
        untrustedContentNormalizationReportPath,
      evidenceSeal: productionRunnerEvidenceSealPath,
      ...(visualSidecarArtifactPath !== undefined
        ? { visualSidecarResult: visualSidecarArtifactPath }
        : {}),
      agentRoleRun: agentRoleRunArtifact.artifactPath,
      genealogy: genealogyArtifact.artifactPath,
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
  };
};

const resolveFigmaSource = async (
  source: ProductionRunnerSource,
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
      ...(parsed.nodeId !== undefined ? { nodeId: parsed.nodeId } : {}),
    });
  } catch (err) {
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
    intent.detectedFields,
    caps.maxFieldsPerScreen,
    "Fields",
  );
  const boundedActions = cap(
    intent.detectedActions,
    caps.maxActionsPerScreen,
    "Actions",
  );
  const boundedValidations = cap(
    intent.detectedValidations,
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
  readonly finopsRecorder: ReturnType<typeof createFinOpsUsageRecorder>;
  readonly llmDurationMs: number;
}

const classifyLlmAttempt = (
  input: ClassifyLlmAttemptInput,
): LlmAttemptOutcome => {
  const { llmResult, finopsRecorder, llmDurationMs } = input;
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
    deployment: llmResult.modelDeployment,
    durationMs: llmDurationMs,
    result: llmResult,
    liveSmoke: llmResult.modelDeployment !== "mock",
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
  readonly attemptOutcome: LlmAttemptOutcome;
  readonly llmDurationMs: number;
  readonly llmInputTokens: number;
  readonly llmOutputTokens: number;
}

const buildHarnessAttemptResult = (
  input: BuildHarnessAttemptResultInput,
): AgentHarnessAttemptResult => {
  const judgeAccepted = input.attemptOutcome.kind === "ok";
  if (judgeAccepted) {
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
    errorKind: input.attemptOutcome.errorKind,
    errorClass: input.attemptOutcome.errorClass,
    inputTokens: input.llmInputTokens,
    outputTokens: input.llmOutputTokens,
    latencyMs: input.llmDurationMs,
  };
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
    const candidate = root.testCases[i];
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
    const step = c.steps[i];
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
    const ref = traceRefs[i];
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
    preconditions: c.preconditions as string[],
    testData: c.testData as string[],
    steps,
    expectedResults: c.expectedResults as string[],
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
  return { ok: true, value: draft };
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

const stampGeneratedTestCase = (input: {
  draft: ProductionRunnerLlmDraftCase;
  jobId: string;
  index: number;
  audit: GeneratedTestCaseAuditMetadata;
  intent: BusinessTestIntentIr;
}): GeneratedTestCase => {
  const slug = createHash("sha256")
    .update(
      canonicalJson({
        jobId: input.jobId,
        index: input.index,
        title: input.draft.title,
      }),
    )
    .digest("hex")
    .slice(0, 12);
  const id = `tc-${slug}`;
  const traceRefs: GeneratedTestCaseFigmaTrace[] = (
    input.draft.figmaTraceRefs ?? []
  ).map((r) => ({
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
  const steps: GeneratedTestCaseStep[] = input.draft.steps.map((s, i) => {
    const projected: GeneratedTestCaseStep = {
      index: typeof s.index === "number" && s.index > 0 ? s.index : i + 1,
      action: s.action,
    };
    if (typeof s.data === "string") projected.data = s.data;
    if (typeof s.expected === "string") projected.expected = s.expected;
    return projected;
  });
  return {
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
    riskCategory: input.draft.riskCategory,
    technique: input.draft.technique,
    preconditions: [...input.draft.preconditions],
    testData: [...input.draft.testData],
    steps,
    expectedResults: [...input.draft.expectedResults],
    figmaTraceRefs: traceRefs,
    assumptions: [...(input.draft.assumptions ?? [])],
    openQuestions: [...(input.draft.openQuestions ?? [])],
    qcMappingPreview: { exportable: true },
    qualitySignals: {
      coveredFieldIds: [],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.85,
    },
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

const BANKING_INSURANCE_PROMPT_RULES: ReadonlyArray<string> = Object.freeze([
  "- Wenn das Profil 'eu-banking-default' aktiv ist, behandle die Maske als reguliert (Bank/Versicherung).",
  "- Erzeuge zu jedem regulierten Eingabefeld mindestens EINEN Positiv- und EINEN Negativfall.",
  "- Erzeuge mindestens EINEN Negativfall, der ungültige IBAN, BIC, Vertragsnummer oder Personenbezogene Daten ablehnt UND maskiert.",
  "- Erzeuge mindestens EINEN Testfall, der für statusverändernde Aktionen Vier-Augen-Prinzip + Audit-Trail prüft (riskCategory='financial_transaction', priority='p0').",
  "- Erzeuge Boundary-Tests für Geldbeträge / Währungen (Mindest-/Maximalwerte, Dezimalpräzision).",
  "- Für jeden Bildschirm, dessen Name ein Banking/Versicherungs-Stichwort enthält, erzeuge GENAU EINEN regulatory-compliance Testfall.",
  "- Setze regulatoryRelevance.domain auf 'banking' oder 'insurance' (oder 'general' wenn nicht zuordenbar) und schreibe rationale auf DEUTSCH (≤ 240 Zeichen).",
  "- WICHTIG: Verwende NUR generische Compliance-Sprache. Zitiere KEINE Paragraphen, KEINE Gesetzesnummern, KEINE konkreten Aufsichtsdokumente.",
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
      case "\"":
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
        `{"testCases": [{"title": string, "objective": string, "type": one of [functional|negative|boundary|validation|navigation|regression|exploratory|accessibility], "priority": one of [p0|p1|p2|p3], "riskCategory": one of [low|medium|high|regulated_data|financial_transaction], "technique": one of [equivalence_partitioning|boundary_value_analysis|decision_table|state_transition|use_case|exploratory|error_guessing|syntax_testing|classification_tree], "preconditions": string[], "testData": string[], "steps": [{"index": number, "action": string, "expected": string}], "expectedResults": string[], "figmaTraceRefs": [{"screenId": string, "nodeName": string?}], "assumptions": string[], "openQuestions": string[], "regulatoryRelevance": {"domain": one of [banking|insurance|general], "rationale": string}}]}`,
      ].join("\n"),
    },
    {
      kind: "text",
      label: "RULES",
      body: [
        "- Schreibe alle Inhalte (title, objective, steps, expected, ...) auf DEUTSCH.",
        "- Bilde Positiv- und Negativfälle ab. Pro relevanter Eingabe einen eigenen Testfall.",
        "- Nutze für screenId die genannten IDs aus dem IR.",
        "- Liefere mindestens einen Testfall pro Bildschirm.",
      ].join("\n"),
    },
  ];
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
  sections.push({
    kind: "json",
    label: "Verfügbare Bildschirme",
    jsonPayload: screenSummary,
  });
  return sections;
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
