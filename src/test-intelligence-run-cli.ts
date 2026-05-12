/**
 * `workspace-dev test-intelligence run` sub-command (Issue #1736).
 *
 * Drives the production runner exported by `src/test-intelligence` from the
 * official package CLI surface. Parses kebab-case flags, validates required
 * inputs and env vars, builds the same Azure-bound LLM gateway client the
 * production runner already uses, executes the figma_to_qc_test_cases
 * pipeline end-to-end, and writes all run artifacts, including the
 * customer-format German Markdown, to the operator-supplied output directory.
 *
 * Modes:
 *   - `deterministic_llm` (default): real LLM gateway client; writes Markdown.
 *   - `offline_eval`: currently routed through the same deterministic path.
 *     This keeps behavior stable while the dedicated offline harness is still
 *     shipping.
 *   - `dry_run`: validate args + env + Figma source resolution but skip the
 *     LLM call. Useful for CI smoke tests.
 *
 * Feature gates (both required at command start):
 *   FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1
 *
 * Exit codes:
 *   0  success
 *   1  operator/config error (missing flag, bad value, missing env, gate off)
 *   2  runner error (LLM / Figma / persist / validation)
 *   3  policy refusal (LLM_REFUSAL or runner blocked=true)
 *   4  budget exceeded (mapped from gateway `budget_exceeded` outcome)
 */

import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

/**
 * CLI-side hard cap on the raw `--custom-context-markdown` file size
 * (Issue #1894). Matches the safety bound documented on the issue: any
 * file larger than this is rejected with exit code 1 before the CLI
 * even reads the body. The runner then enforces the tighter
 * canonical-Markdown limits from `custom-context-markdown.ts`.
 */
export const MAX_CUSTOM_CONTEXT_MARKDOWN_FILE_BYTES: number = 256 * 1024;

/** Same operator-side cap for the explicit customer eval rubric Markdown. */
export const MAX_CUSTOMER_EVAL_MARKDOWN_FILE_BYTES: number = 256 * 1024;

import { sanitizeErrorMessage } from "./error-sanitization.js";
import {
  DEFAULT_OUTPUT_ROOT,
  resolveTestIntelligenceEnabled,
} from "./server/constants.js";
import type {
  FinOpsBudgetEnvelope,
  TestCasePolicyReport,
} from "./contracts/index.js";
import {
  MAX_CUSTOMER_PROFILE_BYTES,
  MAX_TENANT_BUNDLE_BYTES,
  MAX_FIGMA_PAYLOAD_BYTES,
  MAX_FIGMA_PAYLOAD_BYTES_CEILING,
  PRODUCTION_RUNNER_HARNESS_MODES,
  PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT,
  ProductionRunnerError,
  generateAuditDossier,
  parseAndCanonicalizeCustomerProfile,
  parseAndCanonicalizeTenantBundle,
  runFigmaToQcTestCases,
  resolveAuditDossierDefaults,
  validateFinOpsBudgetEnvelope,
  verifyAuditDossierBundle,
  verifyProvenanceFromDisk,
  verifySealBundle,
  renderSealVerificationJsonReport,
  renderSealVerificationTextReport,
  type SealVerificationReport,
  type AgentHarnessTestDepth,
  type CustomerProfileInput,
  type TenantBundleInput,
  type FigmaRestNode,
  type ProductionRunnerHarnessConfig,
  type ProductionRunnerHarnessMode,
  type ProductionRunnerSource,
  type RunFigmaToQcTestCasesInput,
  type RunFigmaToQcTestCasesResult,
} from "./test-intelligence/index.js";
import {
  augmentPolicyReportWithCoverageDrift,
  COVERAGE_BASELINE_DRIFT_THRESHOLD,
  COVERAGE_BASELINES_DIRNAME,
  extractCoverageRatiosFromReport,
  syncCoverageBaselineForJob,
  type SyncCoverageBaselineForJobResult,
} from "./test-intelligence/coverage-baseline-drift.js";
import { canonicalJson } from "./test-intelligence/content-hash.js";
import {
  parseComplianceFrameworksFlag,
  resolveActiveFrameworks,
  type ComplianceFrameworkId,
} from "./test-intelligence/compliance-rules.js";
import {
  annotateTestCases,
  COMPLIANCE_ANNOTATION_ARTIFACT_FILENAME,
} from "./test-intelligence/compliance-annotator-agent.js";
import {
  buildComplianceCoverageReport,
  COMPLIANCE_COVERAGE_REPORT_ARTIFACT_FILENAME,
} from "./test-intelligence/compliance-coverage-report.js";
import {
  buildSubprocessorRegister,
  SUBPROCESSOR_REGISTER_ARTIFACT_FILENAME,
} from "./test-intelligence/subprocessor-register.js";
import { type LlmGatewayClientBundle } from "./test-intelligence/llm-gateway-bundle.js";
import { type LlmGatewayClient } from "./test-intelligence/llm-gateway.js";
import {
  buildProductionRoleClientConfig,
  createProductionRoleClient,
  createProductionTopologyClientBundle,
} from "./test-intelligence/production-topology-clients.js";

const TEST_INTELLIGENCE_RUN_MODES = [
  "deterministic_llm",
  "offline_eval",
  "dry_run",
] as const;

const TEST_INTELLIGENCE_GENERATOR_RECOMMENDED_DEPLOYMENT = "mistral-large-3";
const TEST_INTELLIGENCE_GENERATOR_LEGACY_DEPLOYMENT = "gpt-oss-120b";
const TEST_INTELLIGENCE_LOGIC_JUDGE_RECOMMENDED_DEPLOYMENT = "gpt-oss-120b";
const TEST_INTELLIGENCE_VISUAL_PRIMARY_RECOMMENDED_DEPLOYMENT =
  "llama-4-maverick-vision";
const TEST_INTELLIGENCE_VISUAL_FALLBACK_RECOMMENDED_DEPLOYMENT =
  "phi-4-multimodal-instruct";
const TEST_INTELLIGENCE_COVERAGE_PLANNER_RECOMMENDED_DEPLOYMENT =
  "phi-4-mini-instruct";
const TEST_INTELLIGENCE_RISK_RANKER_RECOMMENDED_DEPLOYMENT = "phi-4";
const TEST_INTELLIGENCE_A11Y_JUDGE_RECOMMENDED_DEPLOYMENT =
  "phi-4-multimodal-instruct";

const TOPOLOGY_PREFLIGHT_REPORT_FILENAME = "topology-preflight-report.json";
const INCOMPATIBLE_OPENAI_CHAT_DEPLOYMENTS = new Set([
  "mistral-document-ai-2512",
]);
const DEPRECATED_TOPOLOGY_DEPLOYMENT_ENV_ALIASES = [
  {
    role: "generator" as const,
    canonicalEnv: "WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT",
    deprecatedEnv: "WORKSPACE_AZURE_AI_FOUNDRY_TEST_GENERATION_DEPLOYMENT",
  },
  {
    role: "visual_primary" as const,
    canonicalEnv: "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
    deprecatedEnv: "WORKSPACE_AZURE_AI_FOUNDRY_VISUAL_PRIMARY_DEPLOYMENT",
  },
  {
    role: "visual_fallback" as const,
    canonicalEnv: "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
    deprecatedEnv: "WORKSPACE_AZURE_AI_FOUNDRY_VISUAL_FALLBACK_DEPLOYMENT",
  },
] as const;

export type TestIntelligenceRunMode =
  (typeof TEST_INTELLIGENCE_RUN_MODES)[number];

type TopologyInputSource = "cli" | "env" | "default";

type TopologyRoleStatus = "configured" | "disabled" | "skipped";

export interface TopologyInputSources {
  modelDeployment: TopologyInputSource;
  logicJudgeDeployment: TopologyInputSource;
  coveragePlannerDeployment: TopologyInputSource;
  riskRankerDeployment: TopologyInputSource;
  visualPrimaryDeployment: TopologyInputSource;
  visualFallbackDeployment: TopologyInputSource;
  a11yJudgeDeployment: TopologyInputSource;
}

interface TopologyRoleReportEntry {
  role:
    | "generator"
    | "logic_judge"
    | "visual_primary"
    | "visual_fallback"
    | "coverage_planner"
    | "risk_ranker"
    | "a11y_judge";
  deployment: string | null;
  source: TopologyInputSource;
  status: TopologyRoleStatus;
  skipReason?: string;
}

interface TopologyPreflightReport {
  schemaVersion: "topology-preflight-report.v1";
  jobId: string;
  generatedAt: string;
  strictModeEnabled: boolean;
  visualSidecarEnabled: boolean;
  roles: ReadonlyArray<TopologyRoleReportEntry>;
}

type DoctorRoleStatus = "ok" | "warning" | "error";

export interface TestIntelligenceDoctorOptions {
  modelDeployment: string;
  logicJudgeDeployment: string | undefined;
  coveragePlannerDeployment: string | undefined;
  riskRankerDeployment: string | undefined;
  visualPrimaryDeployment: string | undefined;
  visualFallbackDeployment: string | undefined;
  a11yJudgeDeployment: string | undefined;
  topologyInputSources: TopologyInputSources;
}

export interface TestIntelligenceVerifyProvenanceOptions {
  runDir: string;
}

export interface TestIntelligenceAuditDossierOptions {
  runDir: string;
  outputDir: string;
  signKeyPath: string;
}

export interface TestIntelligenceAuditVerifyOptions {
  bundle: string;
}

export interface TestIntelligenceVerifySealOptions {
  /** Directory, .tar, .tar.gz/.tgz, or .zip path. */
  bundle: string;
  /** Optional path to a key file (raw bytes) for HMAC verification. */
  keyPath?: string;
  /** Optional expected HMAC hex string. */
  expectedHmacHex?: string;
  /** Optional expected Merkle root hex string. */
  expectedMerkleRootHex?: string;
  /** When true, emit JSON instead of human-readable text. */
  json?: boolean;
  /** Optional path to write the JSON report to (defaults to stdout). */
  outputPath?: string;
}

interface DoctorRoleReportEntry {
  role: TopologyRoleReportEntry["role"];
  deployment: string | null;
  source: TopologyInputSource;
  status: DoctorRoleStatus;
  summary: string;
  fix?: string;
}

interface TestIntelligenceDoctorReport {
  overallStatus: DoctorRoleStatus;
  roles: ReadonlyArray<DoctorRoleReportEntry>;
}

const isRunMode = (value: string): value is TestIntelligenceRunMode =>
  (TEST_INTELLIGENCE_RUN_MODES as ReadonlyArray<string>).includes(value);

export type TestIntelligenceOutputRunSubdirMode = "timestamp" | "job-id";

/**
 * CLI-side enumeration of {@link AgentHarnessTestDepth}. Mirrors the type
 * declared in `agent-harness.ts`; kept local because the contract module does
 * not expose a runtime constant for it. Add new depths in both places.
 */
const AGENT_HARNESS_TEST_DEPTHS = ["standard", "exhaustive"] as const;

const isHarnessMode = (value: string): value is ProductionRunnerHarnessMode =>
  (PRODUCTION_RUNNER_HARNESS_MODES as ReadonlyArray<string>).includes(value);

const isHarnessTestDepth = (value: string): value is AgentHarnessTestDepth =>
  (AGENT_HARNESS_TEST_DEPTHS as ReadonlyArray<string>).includes(value);

const isTruthyFlag = (value: string | undefined): boolean => {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
};

const parseBooleanFlagWithDefault = (
  value: string | undefined,
  defaultValue: boolean,
): boolean => {
  if (value === undefined) return defaultValue;
  return isTruthyFlag(value);
};

/**
 * Parse a positive-safe-integer environment variable. Returns
 * `undefined` when the variable is unset or empty so the runner falls
 * back to its built-in default; throws
 * {@link TestIntelligenceRunOperatorError} on a malformed value so the
 * CLI emits a clean operator-facing error and exits 1.
 */
const parsePositiveIntegerEnv = (
  value: string | undefined,
): number | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TestIntelligenceRunOperatorError(
      `expected positive integer; got "${value}"`,
    );
  }
  return parsed;
};

/** Parsed, validated flags for the test-intelligence run command. */
export interface TestIntelligenceRunOptions {
  figmaUrl: string | undefined;
  figmaJsonFile: string | undefined;
  /** Output directory for run artifacts. `undefined` → default derived from job id. */
  output: string | undefined;
  /**
   * Optional run-output subdirectory mode. When `--output` is supplied and this
   * is omitted, the CLI defaults to `timestamp` so repeated local runs never
   * overwrite one another.
   */
  outputRunSubdir?: TestIntelligenceOutputRunSubdirMode;
  modelEndpoint: string | undefined;
  modelDeployment: string;
  /**
   * Optional dedicated deployment for the cross-model logic judge
   * (Issue #1932). When set, the production runner sends logic-judge
   * prompts to this deployment so a self-consistency bias from the
   * generator cannot be amplified by reusing the same model on the
   * judge. When `undefined`, the runner falls back to
   * `modelDeployment` (legacy single-model behaviour).
   *
   * Default source order:
   *   1. `--logic-judge-deployment <name>` flag.
   *   2. `WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT` env var.
   *   3. `undefined` (judge reuses the generator deployment).
   */
  logicJudgeDeployment: string | undefined;
  /**
   * Optional dedicated deployment for the Coverage-Planner augmentation
   * (Issue #1934). When set, the runner may ask this model to strengthen the
   * deterministic coverage plan before prompt compilation. When `undefined`,
   * planning stays deterministic-only.
   */
  coveragePlannerDeployment: string | undefined;
  /**
   * Optional dedicated deployment for the Risk-Ranker augmentation
   * (Issue #1935). When set, the runner may ask this model to refine the
   * deterministic risk ordering before prompt compilation. When `undefined`,
   * ranking stays deterministic-only.
   */
  riskRankerDeployment?: string | undefined;
  /**
   * Optional dedicated deployment for the visual-primary role (Issue #1996).
   * When set, the visual sidecar uses this deployment instead of consulting
   * only the environment.
   */
  visualPrimaryDeployment?: string | undefined;
  /**
   * Optional dedicated deployment for the visual-fallback role (Issue #1996).
   * When set, the visual sidecar uses this deployment instead of consulting
   * only the environment.
   */
  visualFallbackDeployment?: string | undefined;
  modelApiKey: string | undefined;
  figmaToken: string | undefined;
  policyProfile: string | undefined;
  mode: TestIntelligenceRunMode;
  /** When true, opt into constructing the visual-sidecar bundle. */
  enableVisualSidecar: boolean;
  /** When true, skip the visual sidecar pass even if a bundle is configured. */
  noVisualSidecar: boolean;
  /**
   * Issue #2041 — opt into the mutation-killing-eval pass. Defaults to off
   * for fast iterative runs and on for benchmark runs (the operator
   * passes `--enable-mutation-eval` or sets the env override). Forwarded
   * to the runner as `mutationEval.enabled`.
   */
  enableMutationEval: boolean;
  /** Path to a JSON FinOps budget envelope to apply. `undefined` → production default. */
  finopsBudgetPath: string | undefined;
  /**
   * When true, the CLI validates the resolved role matrix before dispatching
   * any expensive LLM call and refuses known topology degradations.
   */
  requireMultiAgentTopology?: boolean;
  /**
   * Path to an optional UTF-8 Markdown file (Issue #1894) that supplies
   * custom supporting context to the production runner. The CLI loads the
   * file, enforces a hard 256 KiB size cap, and forwards the raw bytes to
   * {@link runFigmaToQcTestCases} via `customContextMarkdown`. The runner
   * canonicalizes the body (PII redaction, prompt-injection neutralization,
   * size enforcement, link/HTML/MDX/image refusal) before it ever reaches
   * the LLM gateway.
   */
  customContextMarkdownPath: string | undefined;
  /**
   * Explicit customer-provided evaluation rubric Markdown. This is loaded and
   * forwarded separately from custom Jira/domain context so the runner can use
   * it as format/granularity guidance instead of treating it as another
   * business requirement source.
   */
  customerEvalMarkdownPath?: string;
  /** Render calibrated per-case confidence in customer markdown. */
  showConfidence?: boolean;
  /**
   * Path to an optional JSON file (Issue #1946) conforming to the
   * {@link CustomerProfileInput} schema. The CLI enforces a hard 256 KiB
   * size cap and rejects the file with exit code 1 if the JSON is invalid
   * or the schema fails validation. The runner applies PII redaction +
   * prompt-injection scrub on all free-text fields before the profile
   * reaches the LLM gateway.
   */
  customerProfilePath: string | undefined;
  /**
   * Path to an optional JSON file (Issue #2184) conforming to the
   * `TenantBundleInput` schema (BYO-rubric / BYO-guidelines). The CLI
   * enforces a hard 256 KiB size cap and rejects the file with exit
   * code 1 if the JSON is invalid, contains unknown top-level fields,
   * or violates the resolver's hard safety floors. When supplied, the
   * runner emits `tenant-bundle-resolved.json` alongside the other
   * artifacts so the audit dossier and replay paths can reconstruct
   * the effective merged config without re-reading the source file.
   */
  tenantBundlePath?: string | undefined;
  /**
   * Optional dedicated deployment for the accessibility-judge role
   * (Issue #1996). When unset, the runner keeps the deterministic-only
   * accessibility path unless an env default is present.
   */
  a11yJudgeDeployment?: string | undefined;
  /** Optional ICT register reference forwarded to all CLI-created model clients. */
  ictRegisterRef?: string;
  /**
   * Generator pass count override (Issues #1936, #2070). `1` preserves the
   * legacy single-pass flow; `2` keeps the dual-pass diversity merge; `3`
   * enables structural self-consistency voting.
   */
  diversityPasses: 1 | 2 | 3;
  /**
   * Multi-agent harness routing mode (Issue #1791). Defaults to `"off"`,
   * which preserves the legacy single-pass LLM behavior. `"shadow_eval"` runs
   * the harness alongside the call and emits a per-step harness artifact for
   * observation only. `"enforced"` lets the harness own the terminal decision
   * and refuses to proceed when the classified outcome is not `accepted`.
   * Only takes effect when `mode === "deterministic_llm"`.
   */
  harnessMode: ProductionRunnerHarnessMode;
  /**
   * Iteration-budget tag forwarded to the harness. Defaults to `"standard"`.
   * Only consulted when `harnessMode !== "off"`.
   */
  harnessTestDepth: AgentHarnessTestDepth;
  /**
   * Override for the harness role-step id used to namespace the per-step
   * artifact. `undefined` → runner uses its built-in default. Set this only
   * when running multiple harness wrappers in the same job.
   */
  harnessRoleStepId: string | undefined;
  /**
   * Cap on repair iterations after the initial pass (Issue #1900).
   * `undefined` → runner default (3). Clamped to the runner's hard cap.
   * Only takes effect when `mode === "deterministic_llm"` and the judge
   * panel produces a `repair` verdict.
   */
  harnessMaxRepairIterations: number | undefined;
  /**
   * Optional override for the Figma REST payload cap (bytes) consumed by
   * the production runner. `undefined` → runner default (128 MiB). Operators
   * working against real Banking-scale design files (~28 MiB JSON for a
   * single fully-expanded frame) supply a higher value here on a per-job
   * basis. Validated as a positive safe integer; out-of-range values are
   * rejected before any network IO.
   */
  maxFigmaPayloadBytes: number | undefined;
  /**
   * When true, a policy-blocked result does not fail the command.
   * Artifacts are still emitted for review and the summary marks the
   * policy status explicitly.
   */
  allowPolicyBlocked?: boolean;
  /**
   * Optional explicit list of compliance frameworks to evaluate
   * (Issue #2042). When `undefined`, the active set is derived from
   * the policy profile via
   * {@link resolveActiveFrameworks}. The CLI parses
   * `--compliance-frameworks <csv>` into this list.
   */
  complianceFrameworks?: readonly ComplianceFrameworkId[];
  /**
   * Coverage-baseline drift configuration (Issue #1950).
   *
   * When `archetype` is set, the post-run helper compares the candidate
   * coverage ratios against the per-tenant runtime baseline at
   * `<runtimeRoot>/coverage-baselines/<tenantId>/<archetype>.json`.
   *   - `mode === "check"` (default): seeds the baseline on first run
   *     and reports drift on subsequent runs without modifying the pin.
   *   - `mode === "update"` (set by `--coverage-baseline-update`):
   *     atomically rewrites the baseline with the candidate ratios so
   *     operators can manually re-baseline after an intentional change.
   *
   * `archetype` is `undefined` when no baseline-related flag was passed,
   * which preserves the legacy behaviour (no runtime baseline check).
   * The whole field is optional so call-sites that construct
   * `TestIntelligenceRunOptions` manually (test fixtures pre-dating
   * Issue #1950) compile without churn — `runTestIntelligenceCommand`
   * treats an absent `coverageBaseline` as "feature disabled".
   */
  coverageBaseline?: {
    archetype: string | undefined;
    tenantId: string;
    runtimeRoot: string | undefined;
    mode: "check" | "update";
  };
  /**
   * Internal provenance for deployment sources so topology-preflight
   * reporting can distinguish CLI overrides from env defaults.
   */
  topologyInputSources?: TopologyInputSources;
}

/**
 * Pure parser for the `test-intelligence run` flag set. Reads env defaults
 * from the supplied lookup so unit tests can pin them without poking
 * `process.env`.
 */
export const parseTestIntelligenceRunArgs = (
  args: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = process.env,
): TestIntelligenceRunOptions => {
  let figmaUrl: string | undefined;
  let figmaJsonFile: string | undefined;
  let figmaJsonFileFlag: "--figma-json-file" | "--figma-payload" | undefined;
  let output: string | undefined;
  let outputRunSubdir: TestIntelligenceOutputRunSubdirMode | undefined;
  let modelEndpoint: string | undefined =
    env.WORKSPACE_TEST_SPACE_MODEL_ENDPOINT?.trim() || undefined;
  let modelDeployment: string =
    env.WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT?.trim() ||
    PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT;
  let logicJudgeDeployment: string | undefined =
    env.WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT?.trim() || undefined;
  let coveragePlannerDeployment: string | undefined =
    env.WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT?.trim() || undefined;
  let riskRankerDeployment: string | undefined =
    env.WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT?.trim() || undefined;
  let visualPrimaryDeployment: string | undefined =
    env.WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT?.trim() ||
    TEST_INTELLIGENCE_VISUAL_PRIMARY_RECOMMENDED_DEPLOYMENT;
  let visualFallbackDeployment: string | undefined =
    env.WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT?.trim() ||
    TEST_INTELLIGENCE_VISUAL_FALLBACK_RECOMMENDED_DEPLOYMENT;
  let a11yJudgeDeployment: string | undefined =
    env.WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT?.trim() || undefined;
  let modelApiKey: string | undefined = resolveModelApiKeyFromEnv(env);
  let figmaToken: string | undefined =
    env.FIGMA_ACCESS_TOKEN?.trim() || undefined;
  let ictRegisterRef: string | undefined =
    env.WORKSPACE_TEST_SPACE_ICT_REGISTER_REF?.trim() || undefined;
  let ictRegisterRefFromFlag = false;
  let policyProfile: string | undefined;
  let mode: TestIntelligenceRunMode = "deterministic_llm";
  let enableVisualSidecar = isTruthyFlag(
    env.FIGMAPIPE_WORKSPACE_TI_ENABLE_VISUAL_SIDECAR,
  );
  let noVisualSidecar = false;
  let enableMutationEval = isTruthyFlag(
    env.FIGMAPIPE_WORKSPACE_TI_ENABLE_MUTATION_EVAL,
  );
  let finopsBudgetPath: string | undefined;
  let requireMultiAgentTopology = isTruthyFlag(
    env.WORKSPACE_TEST_SPACE_REQUIRE_MULTI_AGENT_TOPOLOGY,
  );
  let harnessMode: ProductionRunnerHarnessMode = "off";
  let harnessTestDepth: AgentHarnessTestDepth = "standard";
  let harnessRoleStepId: string | undefined;
  let harnessMaxRepairIterations: number | undefined;
  let maxFigmaPayloadBytes: number | undefined = parsePositiveIntegerEnv(
    env.WORKSPACE_TEST_SPACE_MAX_FIGMA_PAYLOAD_BYTES,
  );
  if (
    maxFigmaPayloadBytes !== undefined &&
    maxFigmaPayloadBytes > MAX_FIGMA_PAYLOAD_BYTES_CEILING
  ) {
    throw new TestIntelligenceRunOperatorError(
      `WORKSPACE_TEST_SPACE_MAX_FIGMA_PAYLOAD_BYTES=${maxFigmaPayloadBytes} exceeds the security hard ceiling of ${MAX_FIGMA_PAYLOAD_BYTES_CEILING} bytes (128 MiB). Streaming larger payloads is tracked as a follow-up; until then 128 MiB is the audited safe ceiling.`,
    );
  }
  let allowPolicyBlocked = parseBooleanFlagWithDefault(
    env.WORKSPACE_TEST_SPACE_ALLOW_POLICY_BLOCKED,
    true,
  );
  let customContextMarkdownPath: string | undefined;
  let customerEvalMarkdownPath: string | undefined;
  let showConfidence = false;
  let customerProfilePath: string | undefined;
  let tenantBundlePath: string | undefined;
  let diversityPasses: 1 | 2 | 3 = 1;
  let complianceFrameworks: readonly ComplianceFrameworkId[] | undefined;
  let coverageBaselineArchetype: string | undefined;
  let coverageBaselineTenantId: string =
    env.WORKSPACE_TEST_SPACE_TENANT_ID?.trim() || "default";
  let coverageBaselineRuntimeRoot: string | undefined;
  let coverageBaselineMode: "check" | "update" = "check";
  const topologyInputSources: TopologyInputSources = {
    modelDeployment:
      readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT") !==
      undefined
        ? "env"
        : "default",
    logicJudgeDeployment:
      readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT") !==
      undefined
        ? "env"
        : "default",
    coveragePlannerDeployment:
      readTrimmedEnv(
        env,
        "WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT",
      ) !== undefined
        ? "env"
        : "default",
    riskRankerDeployment:
      readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT") !==
      undefined
        ? "env"
        : "default",
    visualPrimaryDeployment:
      readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT") !==
      undefined
        ? "env"
        : "default",
    visualFallbackDeployment:
      readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT") !==
      undefined
        ? "env"
        : "default",
    a11yJudgeDeployment:
      readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT") !==
      undefined
        ? "env"
        : "default",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--figma-url") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--figma-url requires a non-empty URL",
        );
      }
      figmaUrl = value;
      index += 1;
      continue;
    }

    if (arg === "--figma-json-file" || arg === "--figma-payload") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          `${arg} requires a non-empty path`,
        );
      }
      if (figmaJsonFile !== undefined) {
        throw new TestIntelligenceRunOperatorError(
          figmaJsonFileFlag === arg
            ? `${arg} may be specified at most once`
            : "--figma-json-file and --figma-payload are aliases; specify only one",
        );
      }
      figmaJsonFile = value;
      figmaJsonFileFlag = arg as "--figma-json-file" | "--figma-payload";
      index += 1;
      continue;
    }

    if (arg === "--output") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--output requires a non-empty directory path",
        );
      }
      output = value;
      index += 1;
      continue;
    }

    if (arg === "--output-run-subdir") {
      const value = next?.trim();
      if (value !== "job-id" && value !== "timestamp") {
        throw new TestIntelligenceRunOperatorError(
          '--output-run-subdir must be "timestamp" or "job-id"',
        );
      }
      if (outputRunSubdir !== undefined) {
        throw new TestIntelligenceRunOperatorError(
          "--output-run-subdir may be specified at most once",
        );
      }
      outputRunSubdir = value;
      index += 1;
      continue;
    }

    if (arg === "--model-endpoint") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--model-endpoint requires a non-empty URL",
        );
      }
      modelEndpoint = value;
      index += 1;
      continue;
    }

    if (arg === "--model-deployment") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--model-deployment requires a non-empty deployment name",
        );
      }
      modelDeployment = value;
      topologyInputSources.modelDeployment = "cli";
      index += 1;
      continue;
    }

    if (arg === "--logic-judge-deployment") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--logic-judge-deployment requires a non-empty deployment name",
        );
      }
      logicJudgeDeployment = value;
      topologyInputSources.logicJudgeDeployment = "cli";
      index += 1;
      continue;
    }

    if (arg === "--coverage-planner-deployment") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--coverage-planner-deployment requires a non-empty deployment name",
        );
      }
      coveragePlannerDeployment = value;
      topologyInputSources.coveragePlannerDeployment = "cli";
      index += 1;
      continue;
    }

    if (arg === "--risk-ranker-deployment") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--risk-ranker-deployment requires a non-empty deployment name",
        );
      }
      riskRankerDeployment = value;
      topologyInputSources.riskRankerDeployment = "cli";
      index += 1;
      continue;
    }

    if (arg === "--visual-primary-deployment") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--visual-primary-deployment requires a non-empty deployment name",
        );
      }
      visualPrimaryDeployment = value;
      topologyInputSources.visualPrimaryDeployment = "cli";
      index += 1;
      continue;
    }

    if (arg === "--visual-fallback-deployment") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--visual-fallback-deployment requires a non-empty deployment name",
        );
      }
      visualFallbackDeployment = value;
      topologyInputSources.visualFallbackDeployment = "cli";
      index += 1;
      continue;
    }

    if (arg === "--a11y-judge-deployment") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--a11y-judge-deployment requires a non-empty deployment name",
        );
      }
      a11yJudgeDeployment = value;
      topologyInputSources.a11yJudgeDeployment = "cli";
      index += 1;
      continue;
    }

    if (arg === "--model-api-key") {
      const value = next;
      if (typeof value !== "string" || value.length === 0) {
        throw new TestIntelligenceRunOperatorError(
          "--model-api-key requires a non-empty key",
        );
      }
      modelApiKey = value;
      index += 1;
      continue;
    }

    if (arg === "--figma-token") {
      const value = next;
      if (typeof value !== "string" || value.length === 0) {
        throw new TestIntelligenceRunOperatorError(
          "--figma-token requires a non-empty token",
        );
      }
      figmaToken = value;
      index += 1;
      continue;
    }

    if (arg === "--ict-register-ref") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--ict-register-ref requires a non-empty reference",
        );
      }
      if (ictRegisterRefFromFlag) {
        throw new TestIntelligenceRunOperatorError(
          "--ict-register-ref may be specified at most once",
        );
      }
      ictRegisterRef = value;
      ictRegisterRefFromFlag = true;
      index += 1;
      continue;
    }

    if (arg === "--policy-profile") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--policy-profile requires a non-empty id",
        );
      }
      policyProfile = value;
      index += 1;
      continue;
    }

    if (arg === "--compliance-frameworks") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--compliance-frameworks requires a comma-separated framework list",
        );
      }
      try {
        complianceFrameworks = parseComplianceFrameworksFlag(value);
      } catch (err) {
        throw new TestIntelligenceRunOperatorError(
          err instanceof Error ? err.message : String(err),
        );
      }
      index += 1;
      continue;
    }

    if (arg === "--mode") {
      const value = next?.trim();
      if (!value || !isRunMode(value)) {
        throw new TestIntelligenceRunOperatorError(
          `--mode must be one of ${TEST_INTELLIGENCE_RUN_MODES.join("|")}`,
        );
      }
      mode = value;
      index += 1;
      continue;
    }

    if (arg === "--enable-visual-sidecar") {
      enableVisualSidecar = true;
      continue;
    }

    if (arg === "--no-visual-sidecar") {
      noVisualSidecar = true;
      continue;
    }

    if (arg === "--enable-mutation-eval") {
      enableMutationEval = true;
      continue;
    }

    if (arg === "--no-mutation-eval") {
      enableMutationEval = false;
      continue;
    }

    if (arg === "--finops-budget") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--finops-budget requires a non-empty file path",
        );
      }
      finopsBudgetPath = value;
      index += 1;
      continue;
    }

    if (arg === "--require-multi-agent-topology") {
      requireMultiAgentTopology = true;
      continue;
    }

    if (arg === "--harness-mode") {
      const value = next?.trim();
      if (!value || !isHarnessMode(value)) {
        throw new TestIntelligenceRunOperatorError(
          `--harness-mode must be one of ${PRODUCTION_RUNNER_HARNESS_MODES.join("|")}`,
        );
      }
      harnessMode = value;
      index += 1;
      continue;
    }

    if (arg === "--harness-test-depth") {
      const value = next?.trim();
      if (!value || !isHarnessTestDepth(value)) {
        throw new TestIntelligenceRunOperatorError(
          `--harness-test-depth must be one of ${AGENT_HARNESS_TEST_DEPTHS.join("|")}`,
        );
      }
      harnessTestDepth = value;
      index += 1;
      continue;
    }

    if (arg === "--harness-role-step-id") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--harness-role-step-id requires a non-empty id",
        );
      }
      harnessRoleStepId = value;
      index += 1;
      continue;
    }

    if (arg === "--harness-max-repair-iterations") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--harness-max-repair-iterations requires a non-negative integer",
        );
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new TestIntelligenceRunOperatorError(
          `--harness-max-repair-iterations must be a non-negative integer; got ${value}`,
        );
      }
      harnessMaxRepairIterations = parsed;
      index += 1;
      continue;
    }

    if (arg === "--max-figma-payload-bytes") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--max-figma-payload-bytes requires a positive integer (bytes)",
        );
      }
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new TestIntelligenceRunOperatorError(
          `--max-figma-payload-bytes must be a positive integer; got ${value}`,
        );
      }
      if (parsed > MAX_FIGMA_PAYLOAD_BYTES_CEILING) {
        throw new TestIntelligenceRunOperatorError(
          `--max-figma-payload-bytes ${parsed} exceeds the security hard ceiling of ${MAX_FIGMA_PAYLOAD_BYTES_CEILING} bytes (128 MiB). Streaming larger payloads is tracked as a follow-up; until then 128 MiB is the audited safe ceiling.`,
        );
      }
      maxFigmaPayloadBytes = parsed;
      index += 1;
      continue;
    }

    if (arg === "--allow-policy-blocked") {
      allowPolicyBlocked = true;
      continue;
    }

    if (arg === "--custom-context-markdown") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--custom-context-markdown requires a non-empty file path",
        );
      }
      if (customContextMarkdownPath !== undefined) {
        throw new TestIntelligenceRunOperatorError(
          "--custom-context-markdown may be specified at most once",
        );
      }
      customContextMarkdownPath = value;
      index += 1;
      continue;
    }

    if (arg === "--customer-eval-markdown") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--customer-eval-markdown requires a non-empty file path",
        );
      }
      if (customerEvalMarkdownPath !== undefined) {
        throw new TestIntelligenceRunOperatorError(
          "--customer-eval-markdown may be specified at most once",
        );
      }
      customerEvalMarkdownPath = value;
      index += 1;
      continue;
    }

    if (arg === "--show-confidence") {
      showConfidence = true;
      continue;
    }

    if (arg === "--customer-profile") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--customer-profile requires a non-empty file path",
        );
      }
      if (customerProfilePath !== undefined) {
        throw new TestIntelligenceRunOperatorError(
          "--customer-profile may be specified at most once",
        );
      }
      customerProfilePath = value;
      index += 1;
      continue;
    }

    if (arg === "--tenant-bundle") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--tenant-bundle requires a non-empty file path",
        );
      }
      if (tenantBundlePath !== undefined) {
        throw new TestIntelligenceRunOperatorError(
          "--tenant-bundle may be specified at most once",
        );
      }
      tenantBundlePath = value;
      index += 1;
      continue;
    }

    if (arg === "--coverage-baseline-archetype") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--coverage-baseline-archetype requires a non-empty id",
        );
      }
      if (!/^[A-Za-z0-9._-]+$/u.test(value)) {
        throw new TestIntelligenceRunOperatorError(
          `--coverage-baseline-archetype must match [A-Za-z0-9._-]+; got "${value}"`,
        );
      }
      coverageBaselineArchetype = value;
      index += 1;
      continue;
    }

    if (arg === "--coverage-baseline-tenant") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--coverage-baseline-tenant requires a non-empty id",
        );
      }
      if (!/^[A-Za-z0-9._-]+$/u.test(value)) {
        throw new TestIntelligenceRunOperatorError(
          `--coverage-baseline-tenant must match [A-Za-z0-9._-]+; got "${value}"`,
        );
      }
      coverageBaselineTenantId = value;
      index += 1;
      continue;
    }

    if (arg === "--coverage-baseline-runtime-root") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--coverage-baseline-runtime-root requires a non-empty path",
        );
      }
      coverageBaselineRuntimeRoot = value;
      index += 1;
      continue;
    }

    if (arg === "--coverage-baseline-update") {
      coverageBaselineMode = "update";
      continue;
    }

    if (arg === "--diversity-passes") {
      const value = next?.trim();
      if (value !== "1" && value !== "2" && value !== "3") {
        throw new TestIntelligenceRunOperatorError(
          "--diversity-passes must be 1, 2, or 3",
        );
      }
      diversityPasses = value === "3" ? 3 : value === "2" ? 2 : 1;
      index += 1;
      continue;
    }

    throw new TestIntelligenceRunOperatorError(
      `Unknown flag for "test-intelligence run": ${arg}`,
    );
  }

  if (figmaUrl !== undefined && figmaJsonFile !== undefined) {
    throw new TestIntelligenceRunOperatorError(
      "--figma-url and --figma-json-file/--figma-payload are mutually exclusive; pass exactly one",
    );
  }
  if (figmaUrl === undefined && figmaJsonFile === undefined) {
    throw new TestIntelligenceRunOperatorError(
      "One of --figma-url or --figma-json-file/--figma-payload is required",
    );
  }
  if (enableVisualSidecar && noVisualSidecar) {
    throw new TestIntelligenceRunOperatorError(
      "--enable-visual-sidecar and --no-visual-sidecar are mutually exclusive",
    );
  }
  if (
    coverageBaselineMode === "update" &&
    coverageBaselineArchetype === undefined
  ) {
    throw new TestIntelligenceRunOperatorError(
      "--coverage-baseline-update requires --coverage-baseline-archetype <id>",
    );
  }

  return {
    figmaUrl,
    figmaJsonFile,
    output,
    ...(outputRunSubdir !== undefined ? { outputRunSubdir } : {}),
    modelEndpoint,
    modelDeployment,
    logicJudgeDeployment,
    coveragePlannerDeployment,
    riskRankerDeployment,
    visualPrimaryDeployment,
    visualFallbackDeployment,
    modelApiKey,
    figmaToken,
    ...(ictRegisterRef !== undefined ? { ictRegisterRef } : {}),
    policyProfile,
    mode,
    enableVisualSidecar,
    noVisualSidecar,
    enableMutationEval,
    finopsBudgetPath,
    requireMultiAgentTopology,
    harnessMode,
    harnessTestDepth,
    harnessRoleStepId,
    harnessMaxRepairIterations,
    maxFigmaPayloadBytes,
    allowPolicyBlocked,
    customContextMarkdownPath,
    ...(customerEvalMarkdownPath !== undefined
      ? { customerEvalMarkdownPath }
      : {}),
    ...(showConfidence ? { showConfidence: true } : {}),
    customerProfilePath,
    ...(tenantBundlePath !== undefined ? { tenantBundlePath } : {}),
    a11yJudgeDeployment,
    diversityPasses,
    coverageBaseline: {
      archetype: coverageBaselineArchetype,
      tenantId: coverageBaselineTenantId,
      runtimeRoot: coverageBaselineRuntimeRoot,
      mode: coverageBaselineMode,
    },
    ...(complianceFrameworks !== undefined ? { complianceFrameworks } : {}),
    topologyInputSources,
  };
};

/**
 * Pure parser for `workspace-dev test-intelligence doctor`. Mirrors the
 * deployment/env resolution from the live run path while intentionally
 * ignoring endpoints and credentials so the output remains safe to paste.
 */
export const parseTestIntelligenceDoctorArgs = (
  args: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = process.env,
): TestIntelligenceDoctorOptions => {
  let modelDeployment: string =
    env.WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT?.trim() ||
    PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT;
  let logicJudgeDeployment: string | undefined =
    env.WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT?.trim() || undefined;
  let coveragePlannerDeployment: string | undefined =
    env.WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT?.trim() || undefined;
  let riskRankerDeployment: string | undefined =
    env.WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT?.trim() || undefined;
  let visualPrimaryDeployment: string | undefined =
    env.WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT?.trim() ||
    TEST_INTELLIGENCE_VISUAL_PRIMARY_RECOMMENDED_DEPLOYMENT;
  let visualFallbackDeployment: string | undefined =
    env.WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT?.trim() ||
    TEST_INTELLIGENCE_VISUAL_FALLBACK_RECOMMENDED_DEPLOYMENT;
  let a11yJudgeDeployment: string | undefined =
    env.WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT?.trim() || undefined;
  const topologyInputSources: TopologyInputSources = {
    modelDeployment:
      readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT") !==
      undefined
        ? "env"
        : "default",
    logicJudgeDeployment:
      readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT") !==
      undefined
        ? "env"
        : "default",
    coveragePlannerDeployment:
      readTrimmedEnv(
        env,
        "WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT",
      ) !== undefined
        ? "env"
        : "default",
    riskRankerDeployment:
      readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT") !==
      undefined
        ? "env"
        : "default",
    visualPrimaryDeployment:
      readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT") !==
      undefined
        ? "env"
        : "default",
    visualFallbackDeployment:
      readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT") !==
      undefined
        ? "env"
        : "default",
    a11yJudgeDeployment:
      readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT") !==
      undefined
        ? "env"
        : "default",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--model-deployment") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--model-deployment requires a non-empty deployment name",
        );
      }
      modelDeployment = value;
      topologyInputSources.modelDeployment = "cli";
      index += 1;
      continue;
    }

    if (arg === "--logic-judge-deployment") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--logic-judge-deployment requires a non-empty deployment name",
        );
      }
      logicJudgeDeployment = value;
      topologyInputSources.logicJudgeDeployment = "cli";
      index += 1;
      continue;
    }

    if (arg === "--coverage-planner-deployment") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--coverage-planner-deployment requires a non-empty deployment name",
        );
      }
      coveragePlannerDeployment = value;
      topologyInputSources.coveragePlannerDeployment = "cli";
      index += 1;
      continue;
    }

    if (arg === "--risk-ranker-deployment") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--risk-ranker-deployment requires a non-empty deployment name",
        );
      }
      riskRankerDeployment = value;
      topologyInputSources.riskRankerDeployment = "cli";
      index += 1;
      continue;
    }

    if (arg === "--visual-primary-deployment") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--visual-primary-deployment requires a non-empty deployment name",
        );
      }
      visualPrimaryDeployment = value;
      topologyInputSources.visualPrimaryDeployment = "cli";
      index += 1;
      continue;
    }

    if (arg === "--visual-fallback-deployment") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--visual-fallback-deployment requires a non-empty deployment name",
        );
      }
      visualFallbackDeployment = value;
      topologyInputSources.visualFallbackDeployment = "cli";
      index += 1;
      continue;
    }

    if (arg === "--a11y-judge-deployment") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--a11y-judge-deployment requires a non-empty deployment name",
        );
      }
      a11yJudgeDeployment = value;
      topologyInputSources.a11yJudgeDeployment = "cli";
      index += 1;
      continue;
    }

    throw new TestIntelligenceRunOperatorError(
      `Unknown flag for "test-intelligence doctor": ${arg}`,
    );
  }

  return {
    modelDeployment,
    logicJudgeDeployment,
    coveragePlannerDeployment,
    riskRankerDeployment,
    visualPrimaryDeployment,
    visualFallbackDeployment,
    a11yJudgeDeployment,
    topologyInputSources,
  };
};

export const parseTestIntelligenceVerifyProvenanceArgs = (
  argv: readonly string[],
): TestIntelligenceVerifyProvenanceOptions => {
  if (argv.length === 1 && !argv[0]!.startsWith("--")) {
    return { runDir: argv[0]! };
  }
  if (argv.length === 2 && argv[0] === "--run-dir") {
    return { runDir: argv[1]! };
  }
  if (argv.length === 2 && argv[0] === "--verify-provenance") {
    return { runDir: argv[1]! };
  }
  throw new TestIntelligenceRunOperatorError(
    "usage: workspace-dev test-intelligence verify-provenance <run-dir> or workspace-dev test-intelligence --verify-provenance <run-dir>",
  );
};

export const parseTestIntelligenceAuditDossierArgs = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): TestIntelligenceAuditDossierOptions => {
  let runDir: string | undefined;
  let outputDir: string | undefined;
  let signKeyPath =
    env.WORKSPACE_TEST_SPACE_AUDIT_SIGN_KEY?.trim() || undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1]?.trim();
    if (arg === "--run-dir") {
      if (!next) {
        throw new TestIntelligenceRunOperatorError(
          "--run-dir requires a non-empty path",
        );
      }
      runDir = next;
      index += 1;
      continue;
    }
    if (arg === "--output") {
      if (!next) {
        throw new TestIntelligenceRunOperatorError(
          "--output requires a non-empty directory path",
        );
      }
      outputDir = next;
      index += 1;
      continue;
    }
    if (arg === "--sign-key") {
      if (!next) {
        throw new TestIntelligenceRunOperatorError(
          "--sign-key requires a non-empty private-key path",
        );
      }
      signKeyPath = next;
      index += 1;
      continue;
    }
    throw new TestIntelligenceRunOperatorError(
      `Unknown flag for "test-intelligence audit-dossier": ${arg}`,
    );
  }

  if (!runDir) {
    throw new TestIntelligenceRunOperatorError(
      "usage: workspace-dev test-intelligence audit-dossier --run-dir <path> --output <dir> [--sign-key <path>]",
    );
  }
  if (!outputDir) {
    throw new TestIntelligenceRunOperatorError(
      "usage: workspace-dev test-intelligence audit-dossier --run-dir <path> --output <dir> [--sign-key <path>]",
    );
  }
  if (!signKeyPath) {
    throw new TestIntelligenceRunOperatorError(
      "Audit dossier signing key is required via --sign-key or WORKSPACE_TEST_SPACE_AUDIT_SIGN_KEY.",
    );
  }
  return { runDir, outputDir, signKeyPath };
};

export const parseTestIntelligenceAuditVerifyArgs = (
  argv: readonly string[],
): TestIntelligenceAuditVerifyOptions => {
  if (argv.length === 1 && !argv[0]!.startsWith("--")) {
    return { bundle: argv[0]! };
  }
  if (argv.length === 2 && argv[0] === "--bundle") {
    return { bundle: argv[1]! };
  }
  throw new TestIntelligenceRunOperatorError(
    "usage: workspace-dev test-intelligence audit-verify <bundle-prefix-or-json> or workspace-dev test-intelligence audit-verify --bundle <bundle-prefix-or-json>",
  );
};

export const parseTestIntelligenceVerifySealArgs = (
  argv: readonly string[],
): TestIntelligenceVerifySealOptions => {
  let bundle: string | undefined;
  let keyPath: string | undefined;
  let expectedHmacHex: string | undefined;
  let expectedMerkleRootHex: string | undefined;
  let json = false;
  let outputPath: string | undefined;

  if (argv.length === 1 && !argv[0]!.startsWith("--")) {
    return { bundle: argv[0]! };
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1]?.trim();
    if (arg === "--bundle") {
      if (!next) {
        throw new TestIntelligenceRunOperatorError(
          "--bundle requires a non-empty path",
        );
      }
      bundle = next;
      index += 1;
      continue;
    }
    if (arg === "--key") {
      if (!next) {
        throw new TestIntelligenceRunOperatorError(
          "--key requires a non-empty path",
        );
      }
      keyPath = next;
      index += 1;
      continue;
    }
    if (arg === "--expected-hmac") {
      if (!next || !/^[0-9a-fA-F]{64}$/.test(next)) {
        throw new TestIntelligenceRunOperatorError(
          "--expected-hmac requires a 64-character hex string",
        );
      }
      expectedHmacHex = next.toLowerCase();
      index += 1;
      continue;
    }
    if (arg === "--expected-merkle-root") {
      if (!next || !/^[0-9a-fA-F]{64}$/.test(next)) {
        throw new TestIntelligenceRunOperatorError(
          "--expected-merkle-root requires a 64-character hex string",
        );
      }
      expectedMerkleRootHex = next.toLowerCase();
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--output") {
      if (!next) {
        throw new TestIntelligenceRunOperatorError(
          "--output requires a non-empty path",
        );
      }
      outputPath = next;
      index += 1;
      continue;
    }
    throw new TestIntelligenceRunOperatorError(
      `Unknown flag for "test-intelligence verify-seal": ${arg}`,
    );
  }
  if (!bundle) {
    throw new TestIntelligenceRunOperatorError(
      "usage: workspace-dev test-intelligence verify-seal --bundle <path> [--key <path>] [--expected-hmac <hex>] [--expected-merkle-root <hex>] [--json] [--output <path>]",
    );
  }
  return {
    bundle,
    ...(keyPath !== undefined ? { keyPath } : {}),
    ...(expectedHmacHex !== undefined ? { expectedHmacHex } : {}),
    ...(expectedMerkleRootHex !== undefined ? { expectedMerkleRootHex } : {}),
    json,
    ...(outputPath !== undefined ? { outputPath } : {}),
  };
};

const SUPPORTED_SEAL_ARCHIVE_SUFFIXES = [
  ".tar.gz",
  ".tgz",
  ".tar",
  ".zip",
] as const;

const matchedArchiveSuffix = (
  bundlePath: string,
): (typeof SUPPORTED_SEAL_ARCHIVE_SUFFIXES)[number] | undefined => {
  const lowered = bundlePath.toLowerCase();
  return SUPPORTED_SEAL_ARCHIVE_SUFFIXES.find((suffix) =>
    lowered.endsWith(suffix),
  );
};

interface ChildResult {
  readonly code: number;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
}

const runChild = (
  command: string,
  args: readonly string[],
  cwd: string,
  options: { readonly captureStdout?: boolean } = {},
): Promise<ChildResult> =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", options.captureStdout ? "pipe" : "ignore", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
    }
    if (options.captureStdout && child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
    }
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code, signal) => {
      // A signal-terminated child reports `code === null`. Treat that
      // as a non-zero exit so callers do not silently accept a
      // signal-killed `tar`/`unzip` extraction as success.
      const normalizedCode = code !== null ? code : signal !== null ? 128 : 1;
      resolvePromise({ code: normalizedCode, signal, stderr, stdout });
    });
  });

/**
 * Reject archive entries that try to escape the destination directory:
 * absolute paths, `..` segments, drive letters, or paths that contain
 * embedded null bytes. Mirrors the containment check the seal verifier
 * applies to seal-referenced artifact filenames so a malicious
 * tarball/zipfile cannot trigger a zip-slip / tar-escape.
 */
const isUnsafeArchiveEntryPath = (entryPath: string): boolean => {
  if (typeof entryPath !== "string" || entryPath.length === 0) return true;
  if (entryPath.includes("\0")) return true;
  const trimmed = entryPath.replaceAll("\\", "/").trim();
  if (trimmed.startsWith("/") || /^[a-zA-Z]:/.test(trimmed)) return true;
  // Fast pre-check on raw segments before normalization (handles
  // entries like `foo/../bar/../../etc/passwd`).
  for (const segment of trimmed.split("/")) {
    if (segment === "..") return true;
  }
  return false;
};

const enforceSafeArchiveEntries = async (
  command: string,
  listArgs: readonly string[],
  archive: string,
): Promise<void> => {
  const result = await runChild(command, listArgs, ".", {
    captureStdout: true,
  });
  if (result.code !== 0) {
    throw new TestIntelligenceRunOperatorError(
      `${command} failed to enumerate '${archive}' (exit ${String(result.code)}): ${result.stderr.trim() || "no stderr"}.`,
    );
  }
  const entries = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const entry of entries) {
    if (isUnsafeArchiveEntryPath(entry)) {
      throw new TestIntelligenceRunOperatorError(
        `Refusing to extract '${archive}': unsafe archive entry '${entry}'.`,
      );
    }
  }
};

/**
 * Reject archives that contain symlinks or hardlinks before
 * extraction. POSIX `tar -tvf` (verbose listing) and `unzip -l` /
 * `-Z` emit a leading mode column where `l` means symlink and `h`
 * means hardlink. A malicious archive can chain `l`/`h` entries with
 * relative-looking names to redirect a later entry's writes outside
 * the destination directory ("zip slip via symlink"); pre-flight
 * rejection is the primary defense.
 */
const enforceNoSymlinkOrHardlinkEntries = async (
  command: string,
  listArgs: readonly string[],
  archive: string,
): Promise<void> => {
  const result = await runChild(command, listArgs, ".", {
    captureStdout: true,
  });
  if (result.code !== 0) {
    throw new TestIntelligenceRunOperatorError(
      `${command} failed to enumerate '${archive}' (exit ${String(result.code)}): ${result.stderr.trim() || "no stderr"}.`,
    );
  }
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const firstChar = trimmed.charAt(0);
    if (firstChar === "l" || firstChar === "h") {
      throw new TestIntelligenceRunOperatorError(
        `Refusing to extract '${archive}': archive contains a symlink or hardlink entry. Repackage the bundle without link entries.`,
      );
    }
  }
};

/**
 * Walk the extracted bundle and reject any symlink the archiver may
 * have created despite the pre-flight check (defense-in-depth against
 * a verbose-listing format we did not anticipate). A symlink left in
 * place could be followed by a later compromised process.
 */
const enforceNoSymlinksUnderDirectory = async (root: string): Promise<void> => {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const info = await lstat(abs);
      if (info.isSymbolicLink()) {
        throw new TestIntelligenceRunOperatorError(
          `Refusing to verify '${root}': symlink '${abs}' present after extraction.`,
        );
      }
      if (info.isDirectory()) stack.push(abs);
    }
  }
};

/**
 * Extract a bundle archive into a fresh temp directory using the
 * universally available POSIX `tar` / `unzip` binaries. Keeps the
 * verifier zero-dependency for `bun build --compile` packaging while
 * working anywhere `tar` and `unzip` are on PATH (macOS, Linux CI,
 * most auditor laptops). The caller is responsible for the returned
 * directory's lifecycle via `cleanup()`.
 */
export const extractSealBundleArchive = async (
  bundlePath: string,
): Promise<{
  readonly directory: string;
  readonly cleanup: () => Promise<void>;
}> => {
  const suffix = matchedArchiveSuffix(bundlePath);
  if (suffix === undefined) {
    throw new TestIntelligenceRunOperatorError(
      `Unsupported bundle archive format. Supported: ${SUPPORTED_SEAL_ARCHIVE_SUFFIXES.join(", ")}, or a directory.`,
    );
  }
  const directory = await mkdtemp(join(tmpdir(), "ti-seal-verify-"));
  const absoluteBundle = resolve(bundlePath);
  try {
    if (suffix === ".zip") {
      await enforceSafeArchiveEntries(
        "unzip",
        ["-Z1", absoluteBundle],
        absoluteBundle,
      );
      // Long-format zip listing reveals the entry mode in column 1
      // (`l` for symlink). `-Z` without `-1` emits the verbose form.
      await enforceNoSymlinkOrHardlinkEntries(
        "unzip",
        ["-Z", absoluteBundle],
        absoluteBundle,
      );
      const result = await runChild(
        "unzip",
        ["-q", absoluteBundle, "-d", directory],
        directory,
      );
      if (result.code !== 0) {
        throw new TestIntelligenceRunOperatorError(
          `unzip failed (exit ${String(result.code)}): ${result.stderr.trim() || "no stderr"}. Install \`unzip\` or extract the bundle manually and pass the directory.`,
        );
      }
    } else {
      const listArgs =
        suffix === ".tar" ? ["-tf", absoluteBundle] : ["-tzf", absoluteBundle];
      await enforceSafeArchiveEntries("tar", listArgs, absoluteBundle);
      // Verbose tar listing emits a Unix-style mode column where the
      // first character is `l` for symlink and `h` for hardlink.
      const verboseListArgs =
        suffix === ".tar"
          ? ["-tvf", absoluteBundle]
          : ["-tvzf", absoluteBundle];
      await enforceNoSymlinkOrHardlinkEntries(
        "tar",
        verboseListArgs,
        absoluteBundle,
      );
      const tarArgs =
        suffix === ".tar"
          ? ["-xf", absoluteBundle, "-C", directory]
          : ["-xzf", absoluteBundle, "-C", directory];
      const result = await runChild("tar", tarArgs, directory);
      if (result.code !== 0) {
        throw new TestIntelligenceRunOperatorError(
          `tar failed (exit ${String(result.code)}): ${result.stderr.trim() || "no stderr"}. Install GNU/BSD \`tar\` or extract the bundle manually and pass the directory.`,
        );
      }
    }
    // Defense-in-depth: walk the extracted tree and refuse any
    // symlink that slipped past pre-flight (e.g. a verbose listing
    // format we didn't anticipate).
    await enforceNoSymlinksUnderDirectory(directory);
    return {
      directory,
      cleanup: async () => {
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
};

const loadOptionalKey = async (
  keyPath: string | undefined,
): Promise<Uint8Array | undefined> => {
  if (keyPath === undefined) return undefined;
  try {
    const bytes = await readFile(keyPath);
    if (bytes.length === 0) {
      throw new TestIntelligenceRunOperatorError(
        `--key file '${keyPath}' is empty`,
      );
    }
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } catch (error) {
    if (error instanceof TestIntelligenceRunOperatorError) throw error;
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      throw new TestIntelligenceRunOperatorError(
        `--key file not found: ${keyPath}`,
      );
    }
    throw error;
  }
};

export const runTestIntelligenceVerifySealCommand = async (
  options: TestIntelligenceVerifySealOptions,
  sink: TestIntelligenceRunSink,
): Promise<number> => {
  let workingDir: string;
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const bundleStat = await stat(options.bundle).catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        throw new TestIntelligenceRunOperatorError(
          `bundle path not found: ${options.bundle}`,
        );
      }
      throw error;
    });
    if (bundleStat.isDirectory()) {
      workingDir = resolve(options.bundle);
    } else if (bundleStat.isFile()) {
      const extracted = await extractSealBundleArchive(options.bundle);
      workingDir = extracted.directory;
      cleanup = extracted.cleanup;
    } else {
      throw new TestIntelligenceRunOperatorError(
        `bundle path is neither a directory nor a regular file: ${options.bundle}`,
      );
    }
    const key = await loadOptionalKey(options.keyPath);
    const report: SealVerificationReport = await verifySealBundle({
      bundleDir: workingDir,
      ...(key !== undefined ? { key } : {}),
      ...(options.expectedHmacHex !== undefined
        ? { expectedHmacHex: options.expectedHmacHex }
        : {}),
      ...(options.expectedMerkleRootHex !== undefined
        ? { expectedMerkleRootHex: options.expectedMerkleRootHex }
        : {}),
    });
    const rendered = options.json
      ? renderSealVerificationJsonReport(report)
      : renderSealVerificationTextReport(report);
    if (options.outputPath) {
      await writeFile(options.outputPath, rendered, "utf8");
    } else {
      sink.stdout(rendered);
    }
    if (!report.ok) {
      sink.stderr(
        [
          `error: seal verification failed for ${report.bundlePath}`,
          ...report.failures.map(
            (failure) =>
              `  - [${failure.code}] ${failure.reference}: ${failure.message}`,
          ),
          "",
        ].join("\n"),
      );
      return 2;
    }
    return 0;
  } catch (error) {
    if (error instanceof TestIntelligenceRunOperatorError) {
      sink.stderr(`error: ${error.message}\n`);
      return 1;
    }
    sink.stderr(
      `error: ${sanitizeErrorMessage({
        error,
        fallback: "Failed to verify seal bundle.",
      })}\n`,
    );
    return 2;
  } finally {
    if (cleanup) {
      await cleanup().catch(() => {});
    }
  }
};

/** Stable operator-config error surfaced as exit code 1. */
export class TestIntelligenceRunOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestIntelligenceRunOperatorError";
  }
}

/** Output sink injected so tests can capture stdout/stderr deterministically. */
export interface TestIntelligenceRunSink {
  stdout(message: string): void;
  stderr(message: string): void;
}

/** Runner factory wired to a real or mock production-runner pipeline. */
export type TestIntelligenceRunRunner = (
  input: RunFigmaToQcTestCasesInput,
) => Promise<RunFigmaToQcTestCasesResult>;

/** Optional injection seam for tests. */
export interface TestIntelligenceRunRuntime {
  runner?: TestIntelligenceRunRunner;
  /**
   * Override the LLM gateway client builder. When omitted, the live
   * Azure-bound `createLlmGatewayClient` is used in `deterministic_llm` mode
   * (matching the production-runner identity).
   */
  buildLlmClient?: (options: TestIntelligenceRunOptions) => LlmGatewayClient;
  /**
   * Override the logic-judge gateway-client builder (Issue #1932).
   * When omitted, the live Azure-bound `buildLiveLogicJudgeClient`
   * path is used; it returns `undefined` when no logic-judge
   * deployment is configured.
   */
  buildLogicJudgeClient?: (
    options: TestIntelligenceRunOptions,
  ) => LlmGatewayClient | undefined;
  /** Override the coverage-planner client builder (Issue #1934). */
  buildCoveragePlannerClient?: (
    options: TestIntelligenceRunOptions,
  ) => LlmGatewayClient | undefined;
  /** Override the risk-ranker client builder (Issue #1935). */
  buildRiskRankerClient?: (
    options: TestIntelligenceRunOptions,
  ) => LlmGatewayClient | undefined;
  /**
   * Override the visual-sidecar bundle builder. When omitted, the live
   * Azure-bound `createLlmGatewayClientBundle` path is used when
   * `enableVisualSidecar === true`.
   */
  buildLlmBundle?: (
    options: TestIntelligenceRunOptions,
    env: NodeJS.ProcessEnv,
  ) => LlmGatewayClientBundle;
  /**
   * Override the JSON-file loader (tests). Default loads UTF-8 from disk
   * with strict JSON.parse.
   */
  loadFigmaJsonFile?: (filePath: string) => Promise<unknown>;
  /**
   * Override the generic JSON loader used for the FinOps budget file and
   * post-run artifact reads. Default: `readFile` + `JSON.parse`.
   */
  loadJsonFile?: (filePath: string) => Promise<unknown>;
  /**
   * Override the loader for `--custom-context-markdown` files (Issue #1894).
   * Default uses `stat` + `readFile` against the local filesystem and
   * enforces the 256 KiB hard cap before the body is returned. Tests
   * inject a deterministic loader to avoid touching the disk.
   */
  loadCustomContextMarkdownFile?: (filePath: string) => Promise<string>;
  /**
   * Override the loader for `--customer-eval-markdown` files. Same I/O
   * discipline as custom context, but forwarded to the runner as rubric
   * guidance rather than business evidence.
   */
  loadCustomerEvalMarkdownFile?: (filePath: string) => Promise<string>;
  /**
   * Override the loader for `--customer-profile` files (Issue #1946).
   * Default uses `stat` + `readFile` against the local filesystem and
   * enforces the 256 KiB hard cap before the body is returned. Tests
   * inject a deterministic loader to avoid touching the disk.
   */
  loadCustomerProfileFile?: (filePath: string) => Promise<string>;
  /**
   * Override the loader for `--tenant-bundle` files (Issue #2184). Same
   * I/O discipline as `--customer-profile`: 256 KiB hard cap enforced
   * by `stat` before read; rejects non-files and oversize inputs with
   * `TestIntelligenceRunOperatorError`. Tests inject a deterministic
   * loader to avoid touching the disk.
   */
  loadTenantBundleFile?: (filePath: string) => Promise<string>;
  /** Wall-clock provider for deterministic job ids in tests. */
  now?: () => number;
  /**
   * Environment variable map for the feature gate check. Defaults to
   * `process.env`. Inject in tests to avoid touching process state.
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * Build the live Azure-bound logic-judge gateway client (Issue #1932).
 * Returns `undefined` when no logic-judge deployment is configured so
 * the runner falls back to the generator deployment (legacy
 * single-model behaviour, preserved for callers that have not
 * migrated to the cross-model topology).
 *
 * The judge is bound to the same endpoint and api key as the
 * generator so operators only need to configure a single Azure AI
 * Foundry resource — the role separation is enforced via the
 * gateway's role tag, not via separate credentials.
 */
export const buildLiveLogicJudgeClient = (
  options: TestIntelligenceRunOptions,
): LlmGatewayClient | undefined => {
  if (
    options.logicJudgeDeployment === undefined ||
    options.logicJudgeDeployment === options.modelDeployment
  ) {
    return undefined;
  }
  if (!options.modelEndpoint) {
    throw new TestIntelligenceRunOperatorError(
      "--model-endpoint or WORKSPACE_TEST_SPACE_MODEL_ENDPOINT is required for mode=deterministic_llm",
    );
  }
  if (!options.modelApiKey) {
    throw new TestIntelligenceRunOperatorError(
      "--model-api-key or WORKSPACE_TEST_SPACE_LLM_API_KEY is required for mode=deterministic_llm",
    );
  }
  const apiKey = options.modelApiKey;
  const deployment = options.logicJudgeDeployment;
  return createProductionRoleClient(
    buildProductionRoleClientConfig({
      role: "logic_judge",
      endpoint: options.modelEndpoint,
      deployment,
      modelRevisionSuffix: "cli-test-intelligence-run",
      gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
      ...(options.ictRegisterRef !== undefined
        ? { ictRegisterRef: options.ictRegisterRef }
        : {}),
    }),
    {
      apiKeyProvider: () => apiKey,
    },
  );
};

/**
 * Build the optional live Coverage-Planner gateway client (Issue #1934).
 * Returns `undefined` when no planner deployment is configured so the runner
 * stays deterministic-only.
 */
export const buildLiveCoveragePlannerClient = (
  options: TestIntelligenceRunOptions,
): LlmGatewayClient | undefined => {
  if (options.coveragePlannerDeployment === undefined) {
    return undefined;
  }
  if (!options.modelEndpoint) {
    throw new TestIntelligenceRunOperatorError(
      "--model-endpoint or WORKSPACE_TEST_SPACE_MODEL_ENDPOINT is required for mode=deterministic_llm",
    );
  }
  if (!options.modelApiKey) {
    throw new TestIntelligenceRunOperatorError(
      "--model-api-key or WORKSPACE_TEST_SPACE_LLM_API_KEY is required for mode=deterministic_llm",
    );
  }
  const apiKey = options.modelApiKey;
  const deployment = options.coveragePlannerDeployment;
  return createProductionRoleClient(
    buildProductionRoleClientConfig({
      role: "coverage_planner",
      endpoint: options.modelEndpoint,
      deployment,
      modelRevisionSuffix: "cli-test-intelligence-run",
      gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
      ...(options.ictRegisterRef !== undefined
        ? { ictRegisterRef: options.ictRegisterRef }
        : {}),
    }),
    {
      apiKeyProvider: () => apiKey,
    },
  );
};

/**
 * Build the optional live Risk-Ranker gateway client (Issue #1935).
 * Returns `undefined` when no ranker deployment is configured so the runner
 * keeps deterministic-only ranking.
 */
export const buildLiveRiskRankerClient = (
  options: TestIntelligenceRunOptions,
): LlmGatewayClient | undefined => {
  if (options.riskRankerDeployment === undefined) {
    return undefined;
  }
  if (!options.modelEndpoint) {
    throw new TestIntelligenceRunOperatorError(
      "--model-endpoint or WORKSPACE_TEST_SPACE_MODEL_ENDPOINT is required for mode=deterministic_llm",
    );
  }
  if (!options.modelApiKey) {
    throw new TestIntelligenceRunOperatorError(
      "--model-api-key or WORKSPACE_TEST_SPACE_LLM_API_KEY is required for mode=deterministic_llm",
    );
  }
  const apiKey = options.modelApiKey;
  const deployment = options.riskRankerDeployment;
  return createProductionRoleClient(
    buildProductionRoleClientConfig({
      role: "risk_ranker",
      endpoint: options.modelEndpoint,
      deployment,
      modelRevisionSuffix: "cli-test-intelligence-run",
      gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
      ...(options.ictRegisterRef !== undefined
        ? { ictRegisterRef: options.ictRegisterRef }
        : {}),
    }),
    {
      apiKeyProvider: () => apiKey,
    },
  );
};

const readTrimmedEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
): string | undefined => {
  const value = env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolveModelApiKeyFromEnv = (
  env: NodeJS.ProcessEnv,
): string | undefined => {
  return readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_LLM_API_KEY");
};

/**
 * Build the live Azure-bound LLM gateway client identical to the production
 * runner. Centralised here so the CLI does not introduce a second
 * implementation. Throws `TestIntelligenceRunOperatorError` when required
 * inputs are missing so the operator gets a clean message.
 */
export const buildLiveLlmGatewayClient = (
  options: TestIntelligenceRunOptions,
): LlmGatewayClient => {
  if (!options.modelEndpoint) {
    throw new TestIntelligenceRunOperatorError(
      "--model-endpoint or WORKSPACE_TEST_SPACE_MODEL_ENDPOINT is required for mode=deterministic_llm",
    );
  }
  if (!options.modelApiKey) {
    throw new TestIntelligenceRunOperatorError(
      "--model-api-key or WORKSPACE_TEST_SPACE_LLM_API_KEY is required for mode=deterministic_llm",
    );
  }

  const apiKey = options.modelApiKey;
  return createProductionRoleClient(
    buildProductionRoleClientConfig({
      role: "test_generation",
      endpoint: options.modelEndpoint,
      deployment: options.modelDeployment,
      modelRevisionSuffix: "cli-test-intelligence-run",
      gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
      ...(options.ictRegisterRef !== undefined
        ? { ictRegisterRef: options.ictRegisterRef }
        : {}),
    }),
    {
      apiKeyProvider: () => apiKey,
    },
  );
};

const requireVisualSidecarEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
): string => {
  const value = env[key]?.trim();
  if (value) {
    return value;
  }
  throw new TestIntelligenceRunOperatorError(
    "--enable-visual-sidecar requires WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT, WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT, WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
  );
};

const requireVisualSidecarDeployments = (
  options: Pick<
    TestIntelligenceRunOptions,
    | "visualPrimaryDeployment"
    | "visualFallbackDeployment"
    | "a11yJudgeDeployment"
  >,
  env: NodeJS.ProcessEnv,
): {
  visualPrimaryDeployment: string;
  visualFallbackDeployment: string;
  a11yJudgeDeployment: string | undefined;
} => {
  const visualPrimaryDeployment = options.visualPrimaryDeployment;
  const visualFallbackDeployment = options.visualFallbackDeployment;
  const missing: string[] = [];
  if (
    readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT") ===
    undefined
  ) {
    missing.push("WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT");
  }
  if (visualPrimaryDeployment === undefined) {
    missing.push(
      "--visual-primary-deployment or WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
    );
  }
  if (visualFallbackDeployment === undefined) {
    missing.push(
      "--visual-fallback-deployment or WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
    );
  }
  if (missing.length > 0) {
    throw new TestIntelligenceRunOperatorError(
      `--enable-visual-sidecar requires ${missing.join(", ")}`,
    );
  }
  return {
    visualPrimaryDeployment: visualPrimaryDeployment as string,
    visualFallbackDeployment: visualFallbackDeployment as string,
    a11yJudgeDeployment: options.a11yJudgeDeployment,
  };
};

export const buildLiveVisualSidecarBundle = (
  options: TestIntelligenceRunOptions,
  env: NodeJS.ProcessEnv = process.env,
): LlmGatewayClientBundle => {
  if (!options.modelEndpoint) {
    throw new TestIntelligenceRunOperatorError(
      "--model-endpoint or WORKSPACE_TEST_SPACE_MODEL_ENDPOINT is required for mode=deterministic_llm",
    );
  }
  const apiKey = options.modelApiKey;
  if (!apiKey) {
    throw new TestIntelligenceRunOperatorError(
      "--model-api-key or WORKSPACE_TEST_SPACE_LLM_API_KEY is required for mode=deterministic_llm",
    );
  }
  const visualEndpoint = requireVisualSidecarEnv(
    env,
    "WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT",
  );
  const {
    visualPrimaryDeployment,
    visualFallbackDeployment,
    a11yJudgeDeployment,
  } = requireVisualSidecarDeployments(options, env);
  const bundle = createProductionTopologyClientBundle(
    {
      endpoint: options.modelEndpoint,
      visualEndpoint,
      deployment: options.modelDeployment,
      visualPrimaryDeployment,
      visualFallbackDeployment,
      ...(options.logicJudgeDeployment !== undefined
        ? { logicJudgeDeployment: options.logicJudgeDeployment }
        : {}),
      ...(a11yJudgeDeployment !== undefined ? { a11yJudgeDeployment } : {}),
      ...(options.coveragePlannerDeployment !== undefined
        ? { coveragePlannerDeployment: options.coveragePlannerDeployment }
        : {}),
      ...(options.riskRankerDeployment !== undefined
        ? { riskRankerDeployment: options.riskRankerDeployment }
        : {}),
      ...(options.ictRegisterRef !== undefined
        ? { ictRegisterRef: options.ictRegisterRef }
        : {}),
      modelRevisionSuffix: "cli-test-intelligence-run",
      gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
      ...(options.policyProfile !== undefined
        ? { policyProfileId: options.policyProfile }
        : {}),
    },
    {
      apiKeyProvider: () => apiKey,
    },
  );
  return bundle;
};

const defaultLoadFigmaJsonFile = async (filePath: string): Promise<unknown> => {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text) as unknown;
};

const defaultLoadJsonFile = async (filePath: string): Promise<unknown> => {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text) as unknown;
};

const deploymentSourceFromEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
): TopologyInputSource =>
  readTrimmedEnv(env, key) !== undefined ? "env" : "default";

const collectDeprecatedTopologyAliasErrors = (
  env: NodeJS.ProcessEnv,
): string[] => {
  const errors: string[] = [];
  for (const alias of DEPRECATED_TOPOLOGY_DEPLOYMENT_ENV_ALIASES) {
    const deprecatedValue = readTrimmedEnv(env, alias.deprecatedEnv);
    if (deprecatedValue === undefined) continue;
    const canonicalValue = readTrimmedEnv(env, alias.canonicalEnv);
    if (canonicalValue === undefined) {
      errors.push(
        `${formatTopologyRoleName(alias.role)} uses deprecated env alias ${alias.deprecatedEnv}; migrate to ${alias.canonicalEnv} before strict multi-agent runs`,
      );
      continue;
    }
    if (canonicalValue !== deprecatedValue) {
      errors.push(
        `${formatTopologyRoleName(alias.role)} has conflicting deployment env vars (${alias.canonicalEnv}=${canonicalValue}, ${alias.deprecatedEnv}=${deprecatedValue}); remove the deprecated alias before strict multi-agent runs`,
      );
    }
  }
  return errors;
};

const formatTopologyRoleName = (
  role: TopologyRoleReportEntry["role"],
): string => role.replaceAll("_", "-");

const formatTopologyRoleLine = (entry: TopologyRoleReportEntry): string => {
  const deployment =
    entry.deployment !== null
      ? `${entry.deployment} [${entry.source}]`
      : `${entry.source} (none)`;
  if (entry.status === "configured") {
    return `  ${formatTopologyRoleName(entry.role)}: ${deployment}`;
  }
  return `  ${formatTopologyRoleName(entry.role)}: ${entry.status} (${entry.skipReason ?? deployment})`;
};

const formatDoctorRoleLine = (entry: DoctorRoleReportEntry): string => {
  const deployment =
    entry.deployment !== null
      ? `${entry.deployment} [${entry.source}]`
      : `${entry.source} (none)`;
  const lines = [
    `  ${formatTopologyRoleName(entry.role)}: ${entry.status} - ${deployment}`,
    `    summary: ${entry.summary}`,
  ];
  if (entry.fix) {
    lines.push(`    fix: ${entry.fix}`);
  }
  return lines.join("\n");
};

const doctorStatusRank = (status: DoctorRoleStatus): number =>
  status === "error" ? 2 : status === "warning" ? 1 : 0;

const joinFixes = (envFix: string, cliFix?: string): string =>
  cliFix ? `${envFix} or ${cliFix}` : envFix;

const buildTopologyPreflightReport = ({
  options,
  env,
  jobId,
  generatedAt,
}: {
  options: TestIntelligenceRunOptions;
  env: NodeJS.ProcessEnv;
  jobId: string;
  generatedAt: string;
}): {
  report: TopologyPreflightReport;
  errors: string[];
} => {
  const visualSidecarEnabled =
    options.enableVisualSidecar && !options.noVisualSidecar;
  const roles: TopologyRoleReportEntry[] = [];
  const errors: string[] = [];
  const strictModeEnabled =
    options.requireMultiAgentTopology === true ||
    isTruthyFlag(env.WORKSPACE_TEST_SPACE_REQUIRE_MULTI_AGENT_TOPOLOGY);
  const optionSources = options.topologyInputSources;
  if (strictModeEnabled) {
    errors.push(...collectDeprecatedTopologyAliasErrors(env));
    if (!visualSidecarEnabled) {
      errors.push(
        "visual sidecar must be enabled when strict multi-agent topology is required",
      );
    }
  }

  roles.push({
    role: "generator",
    deployment: options.modelDeployment,
    source: optionSources?.modelDeployment ?? "default",
    status: "configured",
  });
  if (options.modelDeployment.trim().length === 0) {
    errors.push("generator deployment must be non-empty");
  }
  if (INCOMPATIBLE_OPENAI_CHAT_DEPLOYMENTS.has(options.modelDeployment)) {
    errors.push(
      `generator deployment "${options.modelDeployment}" is incompatible with the openai_chat role contract`,
    );
  }

  if (options.logicJudgeDeployment === undefined) {
    roles.push({
      role: "logic_judge",
      deployment: null,
      source: optionSources?.logicJudgeDeployment ?? "default",
      status: "disabled",
      skipReason: "not configured; legacy fallback reuses generator deployment",
    });
    if (strictModeEnabled) {
      errors.push(
        "logic-judge deployment must be configured and differ from the generator when strict multi-agent topology is required",
      );
    }
  } else if (options.logicJudgeDeployment === options.modelDeployment) {
    roles.push({
      role: "logic_judge",
      deployment: options.logicJudgeDeployment,
      source: optionSources?.logicJudgeDeployment ?? "default",
      status: "disabled",
      skipReason:
        "matches generator deployment; legacy fallback collapses to a single model",
    });
    if (strictModeEnabled) {
      errors.push(
        "logic-judge deployment must differ from the generator when strict multi-agent topology is required",
      );
    }
  } else {
    roles.push({
      role: "logic_judge",
      deployment: options.logicJudgeDeployment,
      source: optionSources?.logicJudgeDeployment ?? "default",
      status: "configured",
    });
    if (
      INCOMPATIBLE_OPENAI_CHAT_DEPLOYMENTS.has(options.logicJudgeDeployment)
    ) {
      errors.push(
        `logic-judge deployment "${options.logicJudgeDeployment}" is incompatible with the openai_chat role contract`,
      );
    }
  }

  const pushOptionalTextRole = ({
    role,
    deployment,
    source,
    disabledReason,
  }: {
    role: "coverage_planner" | "risk_ranker";
    deployment: string | undefined;
    source: TopologyInputSource;
    disabledReason: string;
  }): void => {
    if (deployment === undefined) {
      roles.push({
        role,
        deployment: null,
        source,
        status: "disabled",
        skipReason: disabledReason,
      });
      if (strictModeEnabled) {
        errors.push(
          `${formatTopologyRoleName(role)} deployment must be configured when strict multi-agent topology is required`,
        );
      }
      return;
    }
    roles.push({
      role,
      deployment,
      source,
      status: "configured",
    });
    if (INCOMPATIBLE_OPENAI_CHAT_DEPLOYMENTS.has(deployment)) {
      errors.push(
        `${formatTopologyRoleName(role)} deployment "${deployment}" is incompatible with the openai_chat role contract`,
      );
    }
  };

  pushOptionalTextRole({
    role: "coverage_planner",
    deployment: options.coveragePlannerDeployment,
    source: optionSources?.coveragePlannerDeployment ?? "default",
    disabledReason:
      "not configured; deterministic-only coverage planning remains active",
  });
  pushOptionalTextRole({
    role: "risk_ranker",
    deployment: options.riskRankerDeployment,
    source: optionSources?.riskRankerDeployment ?? "default",
    disabledReason:
      "not configured; deterministic-only risk ranking remains active",
  });

  const visualPrimaryDeployment = options.visualPrimaryDeployment;
  const visualFallbackDeployment = options.visualFallbackDeployment;
  const a11yJudgeDeployment = options.a11yJudgeDeployment;
  const visualPrimarySource =
    optionSources?.visualPrimaryDeployment ??
    deploymentSourceFromEnv(
      env,
      "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
    );
  const visualFallbackSource =
    optionSources?.visualFallbackDeployment ??
    deploymentSourceFromEnv(
      env,
      "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
    );
  const a11ySource =
    optionSources?.a11yJudgeDeployment ??
    deploymentSourceFromEnv(env, "WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT");

  if (!visualSidecarEnabled) {
    roles.push({
      role: "visual_primary",
      deployment: visualPrimaryDeployment ?? null,
      source: visualPrimarySource,
      status: "skipped",
      skipReason: "visual sidecar disabled",
    });
    roles.push({
      role: "visual_fallback",
      deployment: visualFallbackDeployment ?? null,
      source: visualFallbackSource,
      status: "skipped",
      skipReason: "visual sidecar disabled",
    });
    roles.push({
      role: "a11y_judge",
      deployment: a11yJudgeDeployment ?? null,
      source: a11ySource,
      status: "skipped",
      skipReason: "visual sidecar disabled",
    });
  } else {
    if (visualPrimaryDeployment === undefined) {
      roles.push({
        role: "visual_primary",
        deployment: null,
        source: visualPrimarySource,
        status: "disabled",
        skipReason: "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT is unset",
      });
      errors.push(
        "visual-primary deployment must be configured when visual sidecar is enabled",
      );
    } else {
      roles.push({
        role: "visual_primary",
        deployment: visualPrimaryDeployment,
        source: visualPrimarySource,
        status: "configured",
      });
      if (INCOMPATIBLE_OPENAI_CHAT_DEPLOYMENTS.has(visualPrimaryDeployment)) {
        errors.push(
          `visual-primary deployment "${visualPrimaryDeployment}" is incompatible with the chat-completion visual sidecar role contract`,
        );
      }
    }

    if (visualFallbackDeployment === undefined) {
      roles.push({
        role: "visual_fallback",
        deployment: null,
        source: visualFallbackSource,
        status: "disabled",
        skipReason: "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT is unset",
      });
      errors.push(
        "visual-fallback deployment must be configured when visual sidecar is enabled",
      );
    } else {
      roles.push({
        role: "visual_fallback",
        deployment: visualFallbackDeployment,
        source: visualFallbackSource,
        status: "configured",
      });
      if (INCOMPATIBLE_OPENAI_CHAT_DEPLOYMENTS.has(visualFallbackDeployment)) {
        errors.push(
          `visual-fallback deployment "${visualFallbackDeployment}" is incompatible with the chat-completion visual sidecar role contract`,
        );
      }
    }

    if (
      visualPrimaryDeployment !== undefined &&
      visualFallbackDeployment !== undefined &&
      visualPrimaryDeployment === visualFallbackDeployment
    ) {
      errors.push(
        "visual-primary and visual-fallback deployments must differ when visual sidecar is enabled",
      );
    }

    if (a11yJudgeDeployment === undefined) {
      roles.push({
        role: "a11y_judge",
        deployment: null,
        source: a11ySource,
        status: "disabled",
        skipReason:
          "not configured; deterministic accessibility evaluation remains active",
      });
      if (strictModeEnabled) {
        errors.push(
          "a11y-judge deployment must be configured when strict multi-agent topology is required",
        );
      }
    } else {
      roles.push({
        role: "a11y_judge",
        deployment: a11yJudgeDeployment,
        source: a11ySource,
        status: "configured",
      });
      if (INCOMPATIBLE_OPENAI_CHAT_DEPLOYMENTS.has(a11yJudgeDeployment)) {
        errors.push(
          `a11y-judge deployment "${a11yJudgeDeployment}" is incompatible with the chat-completion visual sidecar role contract`,
        );
      }
    }
  }

  return {
    report: {
      schemaVersion: "topology-preflight-report.v1",
      jobId,
      generatedAt,
      strictModeEnabled,
      visualSidecarEnabled,
      roles,
    },
    errors,
  };
};

const writeTopologyPreflightReport = async (
  reportPath: string,
  report: TopologyPreflightReport,
): Promise<void> => {
  const tempPath = `${reportPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${canonicalJson(report)}\n`, "utf8");
  await rename(tempPath, reportPath);
};

const buildDoctorReport = (
  options: TestIntelligenceDoctorOptions,
): TestIntelligenceDoctorReport => {
  const roles: DoctorRoleReportEntry[] = [];
  const pushRole = (entry: DoctorRoleReportEntry): void => {
    roles.push(entry);
  };

  if (INCOMPATIBLE_OPENAI_CHAT_DEPLOYMENTS.has(options.modelDeployment)) {
    pushRole({
      role: "generator",
      deployment: options.modelDeployment,
      source: options.topologyInputSources.modelDeployment,
      status: "error",
      summary: `deployment "${options.modelDeployment}" is incompatible with the openai_chat generator role contract`,
      fix: joinFixes(
        `set WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT=${TEST_INTELLIGENCE_GENERATOR_RECOMMENDED_DEPLOYMENT}`,
        `pass --model-deployment ${TEST_INTELLIGENCE_GENERATOR_RECOMMENDED_DEPLOYMENT}`,
      ),
    });
  } else if (
    options.modelDeployment ===
    TEST_INTELLIGENCE_GENERATOR_RECOMMENDED_DEPLOYMENT
  ) {
    pushRole({
      role: "generator",
      deployment: options.modelDeployment,
      source: options.topologyInputSources.modelDeployment,
      status: "ok",
      summary: "matches the runbook recommendation for the generator role",
    });
  } else if (
    options.modelDeployment === TEST_INTELLIGENCE_GENERATOR_LEGACY_DEPLOYMENT
  ) {
    pushRole({
      role: "generator",
      deployment: options.modelDeployment,
      source: options.topologyInputSources.modelDeployment,
      status: "warning",
      summary:
        "uses the legacy generator deployment; the runbook recommends mistral-large-3 for the production topology",
      fix: joinFixes(
        `set WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT=${TEST_INTELLIGENCE_GENERATOR_RECOMMENDED_DEPLOYMENT}`,
        `pass --model-deployment ${TEST_INTELLIGENCE_GENERATOR_RECOMMENDED_DEPLOYMENT}`,
      ),
    });
  } else {
    pushRole({
      role: "generator",
      deployment: options.modelDeployment,
      source: options.topologyInputSources.modelDeployment,
      status: "warning",
      summary: `deployment "${options.modelDeployment}" is valid but differs from the runbook recommendation ${TEST_INTELLIGENCE_GENERATOR_RECOMMENDED_DEPLOYMENT}`,
      fix: joinFixes(
        `set WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT=${TEST_INTELLIGENCE_GENERATOR_RECOMMENDED_DEPLOYMENT}`,
        `pass --model-deployment ${TEST_INTELLIGENCE_GENERATOR_RECOMMENDED_DEPLOYMENT}`,
      ),
    });
  }

  if (options.logicJudgeDeployment === undefined) {
    pushRole({
      role: "logic_judge",
      deployment: null,
      source: options.topologyInputSources.logicJudgeDeployment,
      status: "warning",
      summary:
        "unset; the live run falls back to the generator deployment and loses cross-model voting",
      fix: joinFixes(
        `set WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT=${TEST_INTELLIGENCE_LOGIC_JUDGE_RECOMMENDED_DEPLOYMENT}`,
        `pass --logic-judge-deployment ${TEST_INTELLIGENCE_LOGIC_JUDGE_RECOMMENDED_DEPLOYMENT}`,
      ),
    });
  } else if (
    INCOMPATIBLE_OPENAI_CHAT_DEPLOYMENTS.has(options.logicJudgeDeployment)
  ) {
    pushRole({
      role: "logic_judge",
      deployment: options.logicJudgeDeployment,
      source: options.topologyInputSources.logicJudgeDeployment,
      status: "error",
      summary: `deployment "${options.logicJudgeDeployment}" is incompatible with the openai_chat logic-judge role contract`,
      fix: joinFixes(
        `set WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT=${TEST_INTELLIGENCE_LOGIC_JUDGE_RECOMMENDED_DEPLOYMENT}`,
        `pass --logic-judge-deployment ${TEST_INTELLIGENCE_LOGIC_JUDGE_RECOMMENDED_DEPLOYMENT}`,
      ),
    });
  } else if (options.logicJudgeDeployment === options.modelDeployment) {
    pushRole({
      role: "logic_judge",
      deployment: options.logicJudgeDeployment,
      source: options.topologyInputSources.logicJudgeDeployment,
      status: "warning",
      summary:
        "matches the generator deployment; the topology collapses to a single model",
      fix: joinFixes(
        `set WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT=${TEST_INTELLIGENCE_LOGIC_JUDGE_RECOMMENDED_DEPLOYMENT}`,
        `pass --logic-judge-deployment ${TEST_INTELLIGENCE_LOGIC_JUDGE_RECOMMENDED_DEPLOYMENT}`,
      ),
    });
  } else if (
    options.logicJudgeDeployment ===
    TEST_INTELLIGENCE_LOGIC_JUDGE_RECOMMENDED_DEPLOYMENT
  ) {
    pushRole({
      role: "logic_judge",
      deployment: options.logicJudgeDeployment,
      source: options.topologyInputSources.logicJudgeDeployment,
      status: "ok",
      summary: "matches the runbook recommendation for cross-model judging",
    });
  } else {
    pushRole({
      role: "logic_judge",
      deployment: options.logicJudgeDeployment,
      source: options.topologyInputSources.logicJudgeDeployment,
      status: "warning",
      summary: `deployment "${options.logicJudgeDeployment}" is valid but differs from the runbook recommendation ${TEST_INTELLIGENCE_LOGIC_JUDGE_RECOMMENDED_DEPLOYMENT}`,
      fix: joinFixes(
        `set WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT=${TEST_INTELLIGENCE_LOGIC_JUDGE_RECOMMENDED_DEPLOYMENT}`,
        `pass --logic-judge-deployment ${TEST_INTELLIGENCE_LOGIC_JUDGE_RECOMMENDED_DEPLOYMENT}`,
      ),
    });
  }

  const pushOptionalTextDoctorRole = ({
    role,
    deployment,
    source,
    recommendedDeployment,
    envVar,
    cliFlag,
    unsetSummary,
  }: {
    role: "coverage_planner" | "risk_ranker";
    deployment: string | undefined;
    source: TopologyInputSource;
    recommendedDeployment: string;
    envVar: string;
    cliFlag: string;
    unsetSummary: string;
  }): void => {
    if (deployment === undefined) {
      pushRole({
        role,
        deployment: null,
        source,
        status: "warning",
        summary: unsetSummary,
        fix: joinFixes(
          `set ${envVar}=${recommendedDeployment}`,
          `pass ${cliFlag} ${recommendedDeployment}`,
        ),
      });
      return;
    }
    if (INCOMPATIBLE_OPENAI_CHAT_DEPLOYMENTS.has(deployment)) {
      pushRole({
        role,
        deployment,
        source,
        status: "error",
        summary: `deployment "${deployment}" is incompatible with the openai_chat ${formatTopologyRoleName(role)} role contract`,
        fix: joinFixes(
          `set ${envVar}=${recommendedDeployment}`,
          `pass ${cliFlag} ${recommendedDeployment}`,
        ),
      });
      return;
    }
    if (deployment === recommendedDeployment) {
      pushRole({
        role,
        deployment,
        source,
        status: "ok",
        summary: `matches the runbook recommendation for ${formatTopologyRoleName(role)}`,
      });
      return;
    }
    pushRole({
      role,
      deployment,
      source,
      status: "warning",
      summary: `deployment "${deployment}" is valid but differs from the runbook recommendation ${recommendedDeployment}`,
      fix: joinFixes(
        `set ${envVar}=${recommendedDeployment}`,
        `pass ${cliFlag} ${recommendedDeployment}`,
      ),
    });
  };

  pushOptionalTextDoctorRole({
    role: "coverage_planner",
    deployment: options.coveragePlannerDeployment,
    source: options.topologyInputSources.coveragePlannerDeployment,
    recommendedDeployment:
      TEST_INTELLIGENCE_COVERAGE_PLANNER_RECOMMENDED_DEPLOYMENT,
    envVar: "WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT",
    cliFlag: "--coverage-planner-deployment",
    unsetSummary:
      "unset; coverage planning stays deterministic-only instead of using the recommended LLM augmentation",
  });
  pushOptionalTextDoctorRole({
    role: "risk_ranker",
    deployment: options.riskRankerDeployment,
    source: options.topologyInputSources.riskRankerDeployment,
    recommendedDeployment: TEST_INTELLIGENCE_RISK_RANKER_RECOMMENDED_DEPLOYMENT,
    envVar: "WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT",
    cliFlag: "--risk-ranker-deployment",
    unsetSummary:
      "unset; risk ranking stays deterministic-only instead of using the recommended LLM augmentation",
  });

  const visualPrimaryDeployment = options.visualPrimaryDeployment;
  const visualFallbackDeployment = options.visualFallbackDeployment;
  const a11yJudgeDeployment = options.a11yJudgeDeployment;
  const visualPrimarySource =
    options.topologyInputSources.visualPrimaryDeployment;
  const visualFallbackSource =
    options.topologyInputSources.visualFallbackDeployment;
  const a11ySource = options.topologyInputSources.a11yJudgeDeployment;

  const pushVisualRole = ({
    role,
    deployment,
    source,
    recommendedDeployment,
    envVar,
    unsetSummary,
  }: {
    role: "visual_primary" | "visual_fallback" | "a11y_judge";
    deployment: string | undefined;
    source: TopologyInputSource;
    recommendedDeployment: string;
    envVar: string;
    unsetSummary: string;
  }): void => {
    if (deployment === undefined) {
      pushRole({
        role,
        deployment: null,
        source,
        status: role === "a11y_judge" ? "warning" : "error",
        summary: unsetSummary,
        fix: joinFixes(
          `set ${envVar}=${recommendedDeployment}`,
          `pass ${role === "visual_primary" ? "--visual-primary-deployment" : role === "visual_fallback" ? "--visual-fallback-deployment" : "--a11y-judge-deployment"} ${recommendedDeployment}`,
        ),
      });
      return;
    }
    if (INCOMPATIBLE_OPENAI_CHAT_DEPLOYMENTS.has(deployment)) {
      pushRole({
        role,
        deployment,
        source,
        status: "error",
        summary: `deployment "${deployment}" is incompatible with the chat-completion ${formatTopologyRoleName(role)} role contract`,
        fix: joinFixes(
          `set ${envVar}=${recommendedDeployment}`,
          `pass ${role === "visual_primary" ? "--visual-primary-deployment" : role === "visual_fallback" ? "--visual-fallback-deployment" : "--a11y-judge-deployment"} ${recommendedDeployment}`,
        ),
      });
      return;
    }
    if (deployment === recommendedDeployment) {
      pushRole({
        role,
        deployment,
        source,
        status: "ok",
        summary: `matches the runbook recommendation for ${formatTopologyRoleName(role)}`,
      });
      return;
    }
    pushRole({
      role,
      deployment,
      source,
      status: "warning",
      summary: `deployment "${deployment}" is valid but differs from the runbook recommendation ${recommendedDeployment}`,
      fix: joinFixes(
        `set ${envVar}=${recommendedDeployment}`,
        `pass ${role === "visual_primary" ? "--visual-primary-deployment" : role === "visual_fallback" ? "--visual-fallback-deployment" : "--a11y-judge-deployment"} ${recommendedDeployment}`,
      ),
    });
  };

  pushVisualRole({
    role: "visual_primary",
    deployment: visualPrimaryDeployment,
    source: visualPrimarySource,
    recommendedDeployment:
      TEST_INTELLIGENCE_VISUAL_PRIMARY_RECOMMENDED_DEPLOYMENT,
    envVar: "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
    unsetSummary:
      "unset; the visual-sidecar primary role is required by the runbook",
  });
  pushVisualRole({
    role: "visual_fallback",
    deployment: visualFallbackDeployment,
    source: visualFallbackSource,
    recommendedDeployment:
      TEST_INTELLIGENCE_VISUAL_FALLBACK_RECOMMENDED_DEPLOYMENT,
    envVar: "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
    unsetSummary:
      "unset; the visual-sidecar fallback role is required by the runbook",
  });
  pushVisualRole({
    role: "a11y_judge",
    deployment: a11yJudgeDeployment,
    source: a11ySource,
    recommendedDeployment: TEST_INTELLIGENCE_A11Y_JUDGE_RECOMMENDED_DEPLOYMENT,
    envVar: "WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT",
    unsetSummary:
      "unset; deterministic accessibility evaluation remains active instead of the recommended LLM-augmented a11y judge",
  });

  if (
    visualPrimaryDeployment !== undefined &&
    visualFallbackDeployment !== undefined &&
    visualPrimaryDeployment === visualFallbackDeployment
  ) {
    const fallbackRole = roles.find((role) => role.role === "visual_fallback");
    if (fallbackRole && doctorStatusRank(fallbackRole.status) < 2) {
      fallbackRole.status = "warning";
      fallbackRole.summary =
        "matches the visual-primary deployment; the runbook recommends a different fallback deployment for diversity";
      fallbackRole.fix = `set WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT=${TEST_INTELLIGENCE_VISUAL_FALLBACK_RECOMMENDED_DEPLOYMENT}`;
    }
  }

  const overallStatus: DoctorRoleStatus = roles.some(
    (role) => role.status === "error",
  )
    ? "error"
    : roles.some((role) => role.status === "warning")
      ? "warning"
      : "ok";

  return {
    overallStatus,
    roles,
  };
};

export const runTestIntelligenceDoctorCommand = async (
  options: TestIntelligenceDoctorOptions,
  sink: TestIntelligenceRunSink,
  runtime: { env?: NodeJS.ProcessEnv } = {},
): Promise<number> => {
  void runtime;
  const report = buildDoctorReport(options);
  sink.stdout(
    [
      "test-intelligence topology doctor",
      `overall status: ${report.overallStatus}`,
      ...report.roles.map(formatDoctorRoleLine),
      "",
    ].join("\n"),
  );
  return report.overallStatus === "error" ? 1 : 0;
};

export const runTestIntelligenceVerifyProvenanceCommand = async (
  options: TestIntelligenceVerifyProvenanceOptions,
  sink: TestIntelligenceRunSink,
): Promise<number> => {
  const result = await verifyProvenanceFromDisk(resolve(options.runDir));
  if (!result.ok) {
    sink.stderr(
      [
        `error: provenance verification failed for ${result.runDir}`,
        ...result.failures.map(
          (failure: { code: string; reference: string; message: string }) =>
            `  - [${failure.code}] ${failure.reference}: ${failure.message}`,
        ),
        "",
      ].join("\n"),
    );
    return 2;
  }
  sink.stdout(
    [
      "test-intelligence provenance verified",
      `  run dir    : ${result.runDir}`,
      `  merkle root: ${result.merkleRoot ?? ""}`,
      `  leaf count : ${result.leafCount ?? 0}`,
      "",
    ].join("\n"),
  );
  return 0;
};

export const runTestIntelligenceAuditDossierCommand = async (
  options: TestIntelligenceAuditDossierOptions,
  sink: TestIntelligenceRunSink,
  runtime: { env?: NodeJS.ProcessEnv } = {},
): Promise<number> => {
  try {
    const defaults = await resolveAuditDossierDefaults();
    const result = await generateAuditDossier({
      runDir: resolve(options.runDir),
      outputDir: resolve(options.outputDir),
      signKeyPath: resolve(options.signKeyPath),
      gitSha: defaults.gitSha,
      benchmarkProtocolVersion: defaults.benchmarkProtocolVersion,
      harnessVersion: defaults.harnessVersion,
      ...(runtime.env?.WORKSPACE_TEST_SPACE_ICT_REGISTER_REF?.trim()
        ? {
            ictRegisterRef:
              runtime.env.WORKSPACE_TEST_SPACE_ICT_REGISTER_REF.trim(),
          }
        : {}),
    });
    sink.stdout(
      [
        "test-intelligence audit dossier generated",
        `  run id      : ${result.runId}`,
        `  manifest    : ${result.manifestPath}`,
        `  signature   : ${result.signaturePath}`,
        `  pdf         : ${result.pdfPath}`,
        `  merkle proof: ${result.merkleProofPath}`,
        "",
      ].join("\n"),
    );
    return 0;
  } catch (error) {
    sink.stderr(
      `error: ${sanitizeErrorMessage({
        error,
        fallback: "Failed to generate audit dossier.",
      })}\n`,
    );
    return 2;
  }
};

export const runTestIntelligenceAuditVerifyCommand = async (
  options: TestIntelligenceAuditVerifyOptions,
  sink: TestIntelligenceRunSink,
): Promise<number> => {
  try {
    const result = await verifyAuditDossierBundle(options.bundle);
    if (!result.ok) {
      sink.stderr(
        [
          `error: audit dossier verification failed for ${result.bundlePrefix}`,
          ...result.failures.map(
            (failure) =>
              `  - [${failure.code}] ${failure.reference}: ${failure.message}`,
          ),
          "",
        ].join("\n"),
      );
      return 2;
    }
    sink.stdout(
      [
        "test-intelligence audit dossier verified",
        `  bundle prefix : ${result.bundlePrefix}`,
        `  run id        : ${result.runId ?? ""}`,
        `  merkle root   : ${result.merkleRoot ?? ""}`,
        `  key fp sha256 : ${result.keyFingerprintSha256 ?? ""}`,
        "",
      ].join("\n"),
    );
    return 0;
  } catch (error) {
    sink.stderr(
      `error: ${sanitizeErrorMessage({
        error,
        fallback: "Failed to verify audit dossier bundle.",
      })}\n`,
    );
    return 2;
  }
};

/**
 * Default `--custom-context-markdown` loader. Stats the file before reading
 * to enforce the 256 KiB hard cap so an oversize file never lands in the
 * Node Buffer pool. Throws {@link TestIntelligenceRunOperatorError} on the
 * documented failure modes (missing file, oversize file) so the caller can
 * emit a clean operator-facing message and exit 1.
 */
const defaultLoadCustomContextMarkdownFile = async (
  filePath: string,
): Promise<string> => {
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(filePath);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      throw new TestIntelligenceRunOperatorError(
        `--custom-context-markdown file not found: ${filePath}`,
      );
    }
    throw err;
  }
  if (!stats.isFile()) {
    throw new TestIntelligenceRunOperatorError(
      `--custom-context-markdown path is not a regular file: ${filePath}`,
    );
  }
  if (stats.size > MAX_CUSTOM_CONTEXT_MARKDOWN_FILE_BYTES) {
    throw new TestIntelligenceRunOperatorError(
      `--custom-context-markdown file exceeds ${MAX_CUSTOM_CONTEXT_MARKDOWN_FILE_BYTES} bytes (got ${stats.size}); shrink the source or split it across runs`,
    );
  }
  return readFile(filePath, "utf8");
};

const defaultLoadCustomerEvalMarkdownFile = async (
  filePath: string,
): Promise<string> => {
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(filePath);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      throw new TestIntelligenceRunOperatorError(
        `--customer-eval-markdown file not found: ${filePath}`,
      );
    }
    throw err;
  }
  if (!stats.isFile()) {
    throw new TestIntelligenceRunOperatorError(
      `--customer-eval-markdown path is not a regular file: ${filePath}`,
    );
  }
  if (stats.size > MAX_CUSTOMER_EVAL_MARKDOWN_FILE_BYTES) {
    throw new TestIntelligenceRunOperatorError(
      `--customer-eval-markdown file exceeds ${MAX_CUSTOMER_EVAL_MARKDOWN_FILE_BYTES} bytes (got ${stats.size}); shrink the source or split it across runs`,
    );
  }
  return readFile(filePath, "utf8");
};

/**
 * Default `--customer-profile` loader. Stats the file before reading to
 * enforce the {@link MAX_CUSTOMER_PROFILE_BYTES} hard cap so an oversize file
 * never lands in the Node Buffer pool. Throws
 * {@link TestIntelligenceRunOperatorError} on the documented failure modes
 * (missing file, oversize file) so the caller can emit a clean
 * operator-facing message and exit 1.
 */
const defaultLoadCustomerProfileFile = async (
  filePath: string,
): Promise<string> => {
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(filePath);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      throw new TestIntelligenceRunOperatorError(
        `--customer-profile file not found: ${filePath}`,
      );
    }
    throw err;
  }
  if (!stats.isFile()) {
    throw new TestIntelligenceRunOperatorError(
      `--customer-profile path is not a regular file: ${filePath}`,
    );
  }
  if (stats.size > MAX_CUSTOMER_PROFILE_BYTES) {
    throw new TestIntelligenceRunOperatorError(
      `--customer-profile file exceeds ${MAX_CUSTOMER_PROFILE_BYTES} bytes (got ${stats.size}); shrink the file`,
    );
  }
  return readFile(filePath, "utf8");
};

/**
 * Default `--tenant-bundle` loader (Issue #2184). Same I/O discipline
 * as the customer-profile loader: stats the file first to enforce the
 * {@link MAX_TENANT_BUNDLE_BYTES} hard cap before any bytes land in
 * the Node Buffer pool.
 */
const defaultLoadTenantBundleFile = async (
  filePath: string,
): Promise<string> => {
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(filePath);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      throw new TestIntelligenceRunOperatorError(
        `--tenant-bundle file not found: ${filePath}`,
      );
    }
    throw err;
  }
  if (!stats.isFile()) {
    throw new TestIntelligenceRunOperatorError(
      `--tenant-bundle path is not a regular file: ${filePath}`,
    );
  }
  if (stats.size > MAX_TENANT_BUNDLE_BYTES) {
    throw new TestIntelligenceRunOperatorError(
      `--tenant-bundle file exceeds ${MAX_TENANT_BUNDLE_BYTES} bytes (got ${stats.size}); shrink the bundle`,
    );
  }
  return readFile(filePath, "utf8");
};

interface ResolvedSource {
  source: ProductionRunnerSource;
  customerLabel?: string;
}

const resolveSource = async (
  options: TestIntelligenceRunOptions,
  loadFigmaJsonFile: (filePath: string) => Promise<unknown>,
): Promise<ResolvedSource> => {
  if (options.figmaJsonFile !== undefined) {
    const absolutePath = resolve(options.figmaJsonFile);
    const parsed = await loadFigmaJsonFile(absolutePath);
    const file = coerceFigmaRestFileSnapshot(parsed, absolutePath);
    return { source: { kind: "figma_paste_normalized", file } };
  }
  if (options.figmaUrl !== undefined) {
    if (!options.figmaToken) {
      throw new TestIntelligenceRunOperatorError(
        "--figma-token or FIGMA_ACCESS_TOKEN is required for --figma-url ingestion",
      );
    }
    return {
      source: {
        kind: "figma_url",
        figmaUrl: options.figmaUrl,
        accessToken: options.figmaToken,
      },
    };
  }
  // Unreachable: parseTestIntelligenceRunArgs enforces exactly-one source.
  throw new TestIntelligenceRunOperatorError(
    "Internal error: no Figma source resolved",
  );
};

interface FigmaRestFileSnapshotShape {
  fileKey: string;
  name: string;
  document: FigmaRestNode;
}

const coerceFigmaRestNode = (raw: unknown, filePath: string): FigmaRestNode => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TestIntelligenceRunOperatorError(
      `--figma-json-file ${filePath}: "document" is not a JSON object`,
    );
  }
  const node = raw as Record<string, unknown>;
  if (typeof node.id !== "string" || node.id.length === 0) {
    throw new TestIntelligenceRunOperatorError(
      `--figma-json-file ${filePath}: document is missing required string "id"`,
    );
  }
  if (typeof node.type !== "string" || node.type.length === 0) {
    throw new TestIntelligenceRunOperatorError(
      `--figma-json-file ${filePath}: document is missing required string "type"`,
    );
  }
  // Trust nested children/properties; the runner's normalizer is tolerant of
  // unknown keys and the IR derivation is the structural authority.
  return raw as FigmaRestNode;
};

const coerceFigmaRestFileSnapshot = (
  payload: unknown,
  filePath: string,
): FigmaRestFileSnapshotShape => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new TestIntelligenceRunOperatorError(
      `--figma-json-file ${filePath}: top-level value is not a JSON object`,
    );
  }
  const obj = payload as Record<string, unknown>;
  const fileKey = obj.fileKey;
  const name = obj.name;
  const document = obj.document;
  if (typeof fileKey !== "string" || fileKey.length === 0) {
    throw new TestIntelligenceRunOperatorError(
      `--figma-json-file ${filePath}: missing required string "fileKey"`,
    );
  }
  if (typeof name !== "string") {
    throw new TestIntelligenceRunOperatorError(
      `--figma-json-file ${filePath}: missing required string "name"`,
    );
  }
  return { fileKey, name, document: coerceFigmaRestNode(document, filePath) };
};

const formatRunnerError = (err: unknown): string => {
  if (err instanceof ProductionRunnerError) {
    return `[${err.failureClass}] ${sanitizeErrorMessage({ error: err, fallback: err.message })}`;
  }
  return sanitizeErrorMessage({
    error: err,
    fallback: "test-intelligence run failed",
  });
};

/**
 * Map a runner-or-other error to a stable CLI exit code.
 * - 3 = policy refusal (LLM_REFUSAL) or runner blocked
 * - 4 = budget exceeded (gateway `budget_exceeded` mapped to LLM_GATEWAY_FAILED)
 * - 2 = anything else from the runner
 */
const exitCodeForRunnerError = (err: unknown): number => {
  if (err instanceof ProductionRunnerError) {
    if (err.failureClass === "LLM_REFUSAL") return 3;
    if (err.failureClass === "LLM_GATEWAY_FAILED") {
      // Heuristic: gateway "budget_exceeded" surface includes this token in
      // the runner-wrapped message body. Sanitisation leaves the literal in
      // place, so the lookup is safe.
      if (/budget_exceeded/iu.test(err.message)) return 4;
      return 2;
    }
    return 2;
  }
  return 2;
};

const safeReadFinopsTotals = async (
  finopsReportPath: string,
  loadJsonFile: (p: string) => Promise<unknown>,
): Promise<string> => {
  try {
    const raw = await loadJsonFile(finopsReportPath);
    if (
      typeof raw !== "object" ||
      raw === null ||
      typeof (raw as Record<string, unknown>).totals !== "object"
    ) {
      return "";
    }
    const totals = (raw as Record<string, unknown>).totals as Record<
      string,
      unknown
    >;
    const tokensIn =
      typeof totals.inputTokens === "number" ? String(totals.inputTokens) : "?";
    const tokensOut =
      typeof totals.outputTokens === "number"
        ? String(totals.outputTokens)
        : "?";
    const costPart =
      typeof totals.estimatedCost === "number"
        ? ` (est. cost: ${totals.estimatedCost})`
        : "";
    return `  finops tokens in/out    : ${tokensIn}/${tokensOut}${costPart}`;
  } catch {
    return "";
  }
};

const safeReadEvidenceDigest = async (
  evidenceSealPath: string,
  loadJsonFile: (p: string) => Promise<unknown>,
): Promise<string> => {
  try {
    const raw = await loadJsonFile(evidenceSealPath);
    if (typeof raw !== "object" || raw === null) return "";
    const predicate = (raw as Record<string, unknown>).predicate;
    if (typeof predicate !== "object" || predicate === null) return "";
    const sha256 = (predicate as Record<string, unknown>).manifestSha256;
    if (typeof sha256 !== "string" || sha256.length === 0) return "";
    return `  evidence manifest digest: ${sha256.slice(0, 16)}…`;
  } catch {
    return "";
  }
};

const writeJsonArtifactAtomically = async (
  destinationPath: string,
  payload: unknown,
): Promise<void> => {
  const tempPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${canonicalJson(payload)}\n`, "utf8");
  await rename(tempPath, destinationPath);
};

interface RunComplianceCoverageEvaluationInput {
  readonly result: RunFigmaToQcTestCasesResult;
  readonly policyProfileId: string;
  readonly explicitFrameworks: readonly ComplianceFrameworkId[] | undefined;
}

/**
 * Runs the deterministic compliance annotator + coverage report
 * (Issue #2042) and persists the two artifacts next to the runner's
 * other outputs. Returns a single-line summary suitable for the
 * operator log.
 */
const runComplianceCoverageEvaluation = async (
  input: RunComplianceCoverageEvaluationInput,
): Promise<string> => {
  const { result, policyProfileId, explicitFrameworks } = input;
  const activeFrameworks = resolveActiveFrameworks(
    explicitFrameworks,
    policyProfileId,
  );

  // Issue #2174 — cross-link the per-run subprocessor register so every
  // annotation that names a subprocessor cites the canonical
  // `subprocessorId`. The runner already wrote
  // `subprocessor-register.json` to the artifact directory; we
  // recompute the same canonical artifact here (deterministic, same
  // bytes) so the annotator can reference its identity without an
  // extra file read.
  const subprocessorRegister = buildSubprocessorRegister({
    generatedAt: result.generatedAt,
  });

  const annotations = annotateTestCases({
    jobId: result.jobId,
    generatedAt: result.generatedAt,
    testCases: result.generatedTestCases.testCases,
    activeFrameworks,
    subprocessorRegister,
    subprocessorRegisterArtifactFilename:
      SUBPROCESSOR_REGISTER_ARTIFACT_FILENAME,
  });

  const coverage = buildComplianceCoverageReport({
    annotations,
    totalTestCases: result.generatedTestCases.testCases.length,
  });

  const annotationsPath = join(
    result.artifactDir,
    COMPLIANCE_ANNOTATION_ARTIFACT_FILENAME,
  );
  const coveragePath = join(
    result.artifactDir,
    COMPLIANCE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  );

  // The runner creates `artifactDir` for any real run. Some test
  // injection paths supply a fictitious directory; in that case we
  // emit a single-line note instead of failing the whole command —
  // the compliance report is non-blocking by design.
  try {
    await writeJsonArtifactAtomically(annotationsPath, annotations);
    await writeJsonArtifactAtomically(coveragePath, coverage);
  } catch (err) {
    if (isMissingDirectoryError(err)) {
      return `  compliance coverage : skipped (artifact directory unavailable)`;
    }
    throw err;
  }

  const errorFlag = coverage.hasUncoveredErrorRule ? " [uncovered error]" : "";
  return (
    `  compliance coverage : ${activeFrameworks.length} frameworks · ` +
    `${(coverage.overallCoverageRatio * 100).toFixed(1)}% covered ` +
    `(${coveragePath})${errorFlag}`
  );
};

const isMissingDirectoryError = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
};

interface RunCoverageBaselineSyncInput {
  readonly result: RunFigmaToQcTestCasesResult;
  readonly coverageBaseline: {
    readonly archetype: string;
    readonly tenantId: string;
    readonly mode: "check" | "update";
    readonly runtimeRoot: string;
  };
}

/**
 * Runs the post-run coverage-baseline sync (Issue #1950). Seeds the
 * baseline on first run, evaluates drift on subsequent runs, or
 * re-baselines when {@link RunCoverageBaselineSyncInput.coverageBaseline.mode}
 * is `"update"`. When drift trips the gate, the persisted policy report
 * is augmented atomically with a `policy:coverage-drift-exceeded`
 * job-level violation. Returns a summary line for the operator log.
 */
const runCoverageBaselineSync = async (
  input: RunCoverageBaselineSyncInput,
): Promise<string> => {
  const { result, coverageBaseline } = input;
  const candidateRatios = extractCoverageRatiosFromReport({
    coverage: result.coverage,
  });
  const sync: SyncCoverageBaselineForJobResult =
    await syncCoverageBaselineForJob({
      runtimeRoot: coverageBaseline.runtimeRoot,
      tenantId: coverageBaseline.tenantId,
      archetype: coverageBaseline.archetype,
      policyProfileId: result.policy.policyProfileId,
      generatedAt: result.generatedAt,
      candidateRatios,
      mode: coverageBaseline.mode,
    });

  if (sync.evaluation.exceeded) {
    const augmented = augmentPolicyReportWithCoverageDrift(
      result.policy,
      sync.evaluation,
    );
    await rewritePolicyReportArtifact(
      result.artifactPaths.policyReport,
      augmented,
    );
  }

  return formatCoverageBaselineSummaryLine(coverageBaseline, sync);
};

const rewritePolicyReportArtifact = async (
  policyReportPath: string,
  policy: TestCasePolicyReport,
): Promise<void> => {
  const tempPath = `${policyReportPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${canonicalJson(policy)}\n`, "utf8");
  await rename(tempPath, policyReportPath);
};

const formatCoverageBaselineSummaryLine = (
  config: RunCoverageBaselineSyncInput["coverageBaseline"],
  sync: SyncCoverageBaselineForJobResult,
): string => {
  const baselineFile = join(
    config.runtimeRoot,
    COVERAGE_BASELINES_DIRNAME,
    config.tenantId,
    `${config.archetype}.json`,
  );
  if (config.mode === "update") {
    return `  coverage baseline    : updated (${baselineFile})`;
  }
  if (sync.evaluation.seeded) {
    return `  coverage baseline    : seeded (first run; ${baselineFile})`;
  }
  if (sync.evaluation.exceeded) {
    const axes = sync.evaluation.findings
      .map((f) => f.axis)
      .sort()
      .join(", ");
    return (
      `  coverage baseline    : drift exceeded ` +
      `${(sync.evaluation.threshold * 100).toFixed(0)}% on [${axes}] ` +
      `(needs_review; ${baselineFile})`
    );
  }
  return (
    `  coverage baseline    : within tolerance ` +
    `(±${(COVERAGE_BASELINE_DRIFT_THRESHOLD * 100).toFixed(0)}%; ${baselineFile})`
  );
};

const formatTimestampForRunSubdir = (generatedAt: string): string =>
  generatedAt.replaceAll(":", "-").replaceAll(".", "-");

const resolveOutputRunSubdirMode = (
  options: TestIntelligenceRunOptions,
): TestIntelligenceOutputRunSubdirMode | undefined =>
  options.outputRunSubdir ??
  (options.output !== undefined ? "timestamp" : undefined);

const resolveRunOutputDir = (input: {
  readonly outputDir: string;
  readonly mode: TestIntelligenceOutputRunSubdirMode | undefined;
  readonly jobId: string;
  readonly generatedAt: string;
}): string => {
  if (input.mode === "job-id") {
    return join(input.outputDir, input.jobId);
  }
  if (input.mode === "timestamp") {
    return join(
      input.outputDir,
      formatTimestampForRunSubdir(input.generatedAt),
    );
  }
  return input.outputDir;
};

/**
 * Public entry point used by `cli.ts` and by the contract tests. Accepts a
 * parsed options object and an optional runtime injection seam. Returns the
 * intended exit code; the caller is responsible for `process.exit`.
 */
export const runTestIntelligenceCommand = async (
  options: TestIntelligenceRunOptions,
  sink: TestIntelligenceRunSink,
  runtime: TestIntelligenceRunRuntime = {},
): Promise<number> => {
  const env = runtime.env ?? process.env;

  if (!resolveTestIntelligenceEnabled(env)) {
    sink.stderr(
      `error: FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1 must be set to use "workspace-dev test-intelligence run"\n`,
    );
    return 1;
  }

  const now = runtime.now ?? Date.now;
  const loadFigmaJsonFile =
    runtime.loadFigmaJsonFile ?? defaultLoadFigmaJsonFile;
  const loadJsonFile = runtime.loadJsonFile ?? defaultLoadJsonFile;
  const loadCustomContextMarkdownFile =
    runtime.loadCustomContextMarkdownFile ??
    defaultLoadCustomContextMarkdownFile;
  const loadCustomerEvalMarkdownFile =
    runtime.loadCustomerEvalMarkdownFile ?? defaultLoadCustomerEvalMarkdownFile;
  const loadCustomerProfileFile =
    runtime.loadCustomerProfileFile ?? defaultLoadCustomerProfileFile;
  const loadTenantBundleFile =
    runtime.loadTenantBundleFile ?? defaultLoadTenantBundleFile;

  const nowMs = now();
  const jobId = `ti-cli-${nowMs}`;
  const generatedAt = new Date(nowMs).toISOString();

  const outputDir =
    options.output !== undefined
      ? resolve(options.output)
      : resolve(join(DEFAULT_OUTPUT_ROOT, "jobs", jobId, "test-intelligence"));
  const outputRunSubdirMode = resolveOutputRunSubdirMode(options);
  const runOutputDir = resolveRunOutputDir({
    outputDir,
    mode: outputRunSubdirMode,
    jobId,
    generatedAt,
  });

  await mkdir(runOutputDir, { recursive: true });

  // Load and validate the operator-supplied FinOps budget, if any.
  let finopsBudget: FinOpsBudgetEnvelope | undefined;
  if (options.finopsBudgetPath !== undefined) {
    const absolutePath = resolve(options.finopsBudgetPath);
    let rawBudget: unknown;
    try {
      rawBudget = await loadJsonFile(absolutePath);
    } catch (err) {
      sink.stderr(
        `error: failed to read --finops-budget file: ${sanitizeErrorMessage({ error: err, fallback: "filesystem failure" })}\n`,
      );
      return 1;
    }
    let validation: ReturnType<typeof validateFinOpsBudgetEnvelope>;
    try {
      validation = validateFinOpsBudgetEnvelope(
        rawBudget as FinOpsBudgetEnvelope,
      );
    } catch (err) {
      sink.stderr(
        `error: --finops-budget file is invalid: ${sanitizeErrorMessage({ error: err, fallback: "malformed envelope" })}\n`,
      );
      return 1;
    }
    if (!validation.valid) {
      const msgs = validation.errors
        .map((e) => `${e.path}: ${e.message}`)
        .join("; ");
      sink.stderr(`error: --finops-budget file is invalid: ${msgs}\n`);
      return 1;
    }
    finopsBudget = rawBudget as FinOpsBudgetEnvelope;
  }

  let resolved: ResolvedSource;
  try {
    resolved = await resolveSource(options, loadFigmaJsonFile);
  } catch (err) {
    if (err instanceof TestIntelligenceRunOperatorError) {
      sink.stderr(`error: ${err.message}\n`);
      return 1;
    }
    sink.stderr(
      `error: failed to load Figma source: ${sanitizeErrorMessage({ error: err, fallback: "unknown" })}\n`,
    );
    return 1;
  }

  const { report: topologyPreflightReport, errors: topologyPreflightErrors } =
    buildTopologyPreflightReport({
      options,
      env,
      jobId,
      generatedAt,
    });
  const topologyPreflightEnabled =
    options.requireMultiAgentTopology === true ||
    isTruthyFlag(env.WORKSPACE_TEST_SPACE_REQUIRE_MULTI_AGENT_TOPOLOGY);
  const topologyPreflightPath = join(
    outputDir,
    TOPOLOGY_PREFLIGHT_REPORT_FILENAME,
  );
  if (topologyPreflightEnabled && topologyPreflightErrors.length > 0) {
    sink.stderr(
      [
        "error: strict multi-agent topology preflight failed:",
        ...topologyPreflightErrors.map((message) => `  - ${message}`),
        `  report path: ${topologyPreflightPath}`,
        "",
      ].join("\n"),
    );
    return 1;
  }
  if (topologyPreflightEnabled) {
    try {
      await writeTopologyPreflightReport(
        topologyPreflightPath,
        topologyPreflightReport,
      );
    } catch (err) {
      sink.stderr(
        `error: failed to write topology preflight artifact: ${sanitizeErrorMessage({ error: err, fallback: "filesystem failure" })}\n`,
      );
      return 2;
    }
    sink.stdout(
      [
        "topology preflight passed",
        `  report path: ${topologyPreflightPath}`,
        ...topologyPreflightReport.roles.map(formatTopologyRoleLine),
        "",
      ].join("\n"),
    );
  }

  // Load `--custom-context-markdown` (Issue #1894). The CLI enforces the
  // 256 KiB hard cap and rejects missing files with exit code 1 before any
  // network IO. The runner re-validates the canonical Markdown body and
  // fails with `CUSTOM_CONTEXT_MARKDOWN_INVALID` (exit 2) if PII redaction
  // or prompt-injection neutralization rejects the content.
  let customContextMarkdownBody: string | undefined;
  if (options.customContextMarkdownPath !== undefined) {
    const absolutePath = resolve(options.customContextMarkdownPath);
    try {
      customContextMarkdownBody =
        await loadCustomContextMarkdownFile(absolutePath);
    } catch (err) {
      if (err instanceof TestIntelligenceRunOperatorError) {
        sink.stderr(`error: ${err.message}\n`);
        return 1;
      }
      sink.stderr(
        `error: failed to read --custom-context-markdown file: ${sanitizeErrorMessage({ error: err, fallback: "filesystem failure" })}\n`,
      );
      return 1;
    }
  }

  let customerEvalMarkdownBody: string | undefined;
  if (options.customerEvalMarkdownPath !== undefined) {
    const absolutePath = resolve(options.customerEvalMarkdownPath);
    try {
      customerEvalMarkdownBody =
        await loadCustomerEvalMarkdownFile(absolutePath);
    } catch (err) {
      if (err instanceof TestIntelligenceRunOperatorError) {
        sink.stderr(`error: ${err.message}\n`);
        return 1;
      }
      sink.stderr(
        `error: failed to read --customer-eval-markdown file: ${sanitizeErrorMessage({ error: err, fallback: "filesystem failure" })}\n`,
      );
      return 1;
    }
  }

  // Load `--customer-profile` (Issue #1946). Same discipline as
  // `--custom-context-markdown`: 256 KiB hard cap enforced before read,
  // JSON parsed immediately, schema validated, operator error on any failure.
  let customerProfileInput: CustomerProfileInput | undefined;
  let customerProfileRawBytes = 0;
  if (options.customerProfilePath !== undefined) {
    const absolutePath = resolve(options.customerProfilePath);
    let rawJson: string;
    try {
      rawJson = await loadCustomerProfileFile(absolutePath);
    } catch (err) {
      if (err instanceof TestIntelligenceRunOperatorError) {
        sink.stderr(`error: ${err.message}\n`);
        return 1;
      }
      sink.stderr(
        `error: failed to read --customer-profile file: ${sanitizeErrorMessage({ error: err, fallback: "filesystem failure" })}\n`,
      );
      return 1;
    }
    customerProfileRawBytes = Buffer.byteLength(rawJson, "utf8");
    const parseResult = parseAndCanonicalizeCustomerProfile(rawJson);
    if (!parseResult.ok) {
      const msgs = parseResult.issues
        .map((i) => `${i.path}: ${i.message}`)
        .join("; ");
      sink.stderr(`error: --customer-profile file is invalid: ${msgs}\n`);
      return 1;
    }
    // Store the raw parsed JSON object (not the canonical form) so the
    // runner can re-canonicalize through its own pipeline consistently.
    customerProfileInput = JSON.parse(rawJson) as CustomerProfileInput;
  }

  // Load `--tenant-bundle` (Issue #2184). Same discipline: 256 KiB cap
  // enforced before read, JSON parsed immediately, schema validated.
  // The runner re-canonicalizes through its own pipeline, so we forward
  // the raw parsed object here and let the runner reject any drift.
  let tenantBundleInput: TenantBundleInput | undefined;
  let tenantBundleRawBytes = 0;
  if (options.tenantBundlePath !== undefined) {
    const absolutePath = resolve(options.tenantBundlePath);
    let rawJson: string;
    try {
      rawJson = await loadTenantBundleFile(absolutePath);
    } catch (err) {
      if (err instanceof TestIntelligenceRunOperatorError) {
        sink.stderr(`error: ${err.message}\n`);
        return 1;
      }
      sink.stderr(
        `error: failed to read --tenant-bundle file: ${sanitizeErrorMessage({ error: err, fallback: "filesystem failure" })}\n`,
      );
      return 1;
    }
    tenantBundleRawBytes = Buffer.byteLength(rawJson, "utf8");
    const bundleParse = parseAndCanonicalizeTenantBundle(rawJson);
    if (!bundleParse.ok) {
      const msgs = bundleParse.issues
        .map((i) => `${i.path}: ${i.message}`)
        .join("; ");
      sink.stderr(`error: --tenant-bundle file is invalid: ${msgs}\n`);
      return 1;
    }
    tenantBundleInput = JSON.parse(rawJson) as TenantBundleInput;
  }

  const runtimeMode =
    options.mode === "offline_eval" ? "deterministic_llm" : options.mode;
  if (options.mode === "offline_eval") {
    sink.stderr(
      "warning: --mode offline_eval is routed to deterministic_llm in this release\n",
    );
  }

  const allowPolicyBlocked = options.allowPolicyBlocked ?? true;

  // Cross-flag validation: the multi-agent harness wraps the LLM call. In
  // dry_run no LLM call is dispatched, so requesting a harness mode is a
  // configuration mistake the operator should hear about loudly rather than
  // discover from a silent no-op.
  if (runtimeMode === "dry_run" && options.harnessMode !== "off") {
    sink.stderr(
      `error: --harness-mode ${options.harnessMode} requires --mode deterministic_llm; the harness wraps the LLM call and dry_run does not dispatch one\n`,
    );
    return 1;
  }

  if (runtimeMode === "dry_run") {
    sink.stdout(
      [
        "test-intelligence run (dry_run) — no LLM call dispatched",
        `  job id        : ${jobId}`,
        `  output dir    : ${runOutputDir}`,
        ...(runOutputDir === outputDir
          ? []
          : [`  output base   : ${outputDir}`]),
        `  source kind   : ${resolved.source.kind}`,
        `  deployment    : ${options.modelDeployment}`,
        `  judge deploy  : ${options.logicJudgeDeployment ?? "(reuses generator deployment)"}`,
        `  planner deploy: ${options.coveragePlannerDeployment ?? "(disabled; deterministic-only)"}`,
        `  ranker deploy : ${options.riskRankerDeployment ?? "(disabled; deterministic-only)"}`,
        `  policy profile: ${options.policyProfile ?? "(default)"}`,
        `  visual sidecar: ${
          options.noVisualSidecar
            ? "disabled (--no-visual-sidecar)"
            : options.enableVisualSidecar
              ? "enabled (--enable-visual-sidecar)"
              : "disabled (default; set --enable-visual-sidecar or FIGMAPIPE_WORKSPACE_TI_ENABLE_VISUAL_SIDECAR=1)"
        }`,
        "  resolved roles:",
        ...topologyPreflightReport.roles.map(formatTopologyRoleLine),
        `  finops budget : ${options.finopsBudgetPath ?? "(production default)"}`,
        `  ict ref       : ${options.ictRegisterRef ?? "(none)"}`,
        `  output subdir : ${outputRunSubdirMode ?? "(none)"}`,
        `  harness mode  : off (dry_run never reaches the harness)`,
        `  custom md ctx : ${customContextMarkdownBody !== undefined ? `loaded (${Buffer.byteLength(customContextMarkdownBody, "utf8")} bytes)` : "(none)"}`,
        `  customer eval : ${customerEvalMarkdownBody !== undefined ? `loaded (${Buffer.byteLength(customerEvalMarkdownBody, "utf8")} bytes)` : "(none)"}`,
        `  customer prof : ${customerProfileInput !== undefined ? `loaded (${customerProfileRawBytes} bytes)` : "(none)"}`,
        `  tenant bundle : ${tenantBundleInput !== undefined ? `loaded (${tenantBundleRawBytes} bytes)` : "(none)"}`,
        "",
      ].join("\n"),
    );
    return 0;
  }

  let llmClient: LlmGatewayClient;
  let llmBundle: LlmGatewayClientBundle | undefined;
  let logicJudgeClient: LlmGatewayClient | undefined;
  let coveragePlannerClient: LlmGatewayClient | undefined;
  let riskRankerClient: LlmGatewayClient | undefined;
  try {
    if (options.enableVisualSidecar) {
      llmBundle =
        runtime.buildLlmBundle?.(options, env) ??
        buildLiveVisualSidecarBundle(options, env);
      llmClient = llmBundle.testGeneration;
    } else {
      llmClient =
        runtime.buildLlmClient?.(options) ?? buildLiveLlmGatewayClient(options);
    }
    // Issue #1932: build a dedicated logic-judge client when the
    // operator pinned a different deployment than the generator.
    // Returns `undefined` when no logic-judge deployment is set, so
    // the runner falls back to the generator client (legacy
    // single-model behaviour).
    logicJudgeClient =
      runtime.buildLogicJudgeClient !== undefined
        ? runtime.buildLogicJudgeClient(options)
        : buildLiveLogicJudgeClient(options);
    coveragePlannerClient =
      runtime.buildCoveragePlannerClient !== undefined
        ? runtime.buildCoveragePlannerClient(options)
        : buildLiveCoveragePlannerClient(options);
    riskRankerClient =
      runtime.buildRiskRankerClient !== undefined
        ? runtime.buildRiskRankerClient(options)
        : buildLiveRiskRankerClient(options);
  } catch (err) {
    if (err instanceof TestIntelligenceRunOperatorError) {
      sink.stderr(`error: ${err.message}\n`);
      return 1;
    }
    sink.stderr(
      `error: failed to build LLM gateway client: ${sanitizeErrorMessage({ error: err, fallback: "unknown" })}\n`,
    );
    return 1;
  }

  const runner = runtime.runner ?? runFigmaToQcTestCases;

  // Build the harness configuration only when explicitly requested. Omitting
  // the field preserves the runner's documented `"off"` default and keeps
  // the wire shape identical to the legacy single-pass invocation for
  // operators who never opt in.
  const harnessConfig: ProductionRunnerHarnessConfig | undefined =
    options.harnessMode === "off"
      ? undefined
      : {
          mode: options.harnessMode,
          testDepth: options.harnessTestDepth,
          ...(options.harnessRoleStepId !== undefined
            ? { roleStepId: options.harnessRoleStepId }
            : {}),
          ...(options.harnessMaxRepairIterations !== undefined
            ? { maxRepairIterations: options.harnessMaxRepairIterations }
            : {}),
        };
  const visualParticipationSource =
    options.enableVisualSidecar && !options.noVisualSidecar
      ? undefined
      : ("disabled" as const);

  const runInput: RunFigmaToQcTestCasesInput = {
    jobId,
    generatedAt,
    source: resolved.source,
    outputRoot: runOutputDir,
    artifactDir: runOutputDir,
    llm: {
      client: llmClient,
      ...(llmBundle !== undefined ? { bundle: llmBundle } : {}),
      ...(logicJudgeClient !== undefined
        ? { logicJudge: logicJudgeClient }
        : {}),
      ...(coveragePlannerClient !== undefined
        ? { coveragePlanner: coveragePlannerClient }
        : {}),
      ...(riskRankerClient !== undefined
        ? { riskRanker: riskRankerClient }
        : {}),
      maxWallClockMs: 240_000,
    },
    ...(finopsBudget !== undefined ? { finopsBudget } : {}),
    ...(options.maxFigmaPayloadBytes !== undefined
      ? { maxFigmaPayloadBytes: options.maxFigmaPayloadBytes }
      : {}),
    ...(options.policyProfile !== undefined
      ? { policyProfileId: options.policyProfile }
      : {}),
    ...(harnessConfig !== undefined ? { harness: harnessConfig } : {}),
    ...(customContextMarkdownBody !== undefined
      ? { customContextMarkdown: customContextMarkdownBody }
      : {}),
    ...(customerEvalMarkdownBody !== undefined
      ? { customerEvalMarkdown: customerEvalMarkdownBody }
      : {}),
    ...(options.showConfidence === true ? { showConfidence: true } : {}),
    ...(customerProfileInput !== undefined
      ? { customerProfile: customerProfileInput }
      : {}),
    ...(tenantBundleInput !== undefined
      ? { tenantBundle: tenantBundleInput }
      : {}),
    ...(options.diversityPasses > 1
      ? {
          generation: {
            diversityPasses: options.diversityPasses,
          },
        }
      : {}),
    ...(options.enableMutationEval ? { mutationEval: { enabled: true } } : {}),
    roleConfigurationSources: {
      generator: options.topologyInputSources?.modelDeployment ?? "default",
      logic_judge:
        options.topologyInputSources?.logicJudgeDeployment ?? "default",
      judge_secondary:
        options.topologyInputSources?.logicJudgeDeployment ?? "default",
      coverage_planner:
        options.topologyInputSources?.coveragePlannerDeployment ?? "default",
      risk_ranker:
        options.topologyInputSources?.riskRankerDeployment ?? "default",
      visual_primary:
        visualParticipationSource ??
        options.topologyInputSources?.visualPrimaryDeployment ??
        "default",
      visual_fallback:
        visualParticipationSource ??
        options.topologyInputSources?.visualFallbackDeployment ??
        "default",
      a11y_judge:
        visualParticipationSource ??
        options.topologyInputSources?.a11yJudgeDeployment ??
        "default",
    },
  };

  let result: RunFigmaToQcTestCasesResult;
  try {
    result = await runner(runInput);
  } catch (err) {
    sink.stderr(`error: ${formatRunnerError(err)}\n`);
    return exitCodeForRunnerError(err);
  }

  // Compliance coverage report (Issue #2042). Runs after the producer
  // emits its `GeneratedTestCaseList` so the deterministic annotator
  // can scan every case against the active rule pack. Persisted next
  // to the run's other artifacts; failures here are treated as
  // operator errors (exit code 2) so a malformed framework input
  // surfaces immediately.
  let complianceCoverageSummary: string;
  try {
    complianceCoverageSummary = await runComplianceCoverageEvaluation({
      result,
      policyProfileId: result.policy.policyProfileId,
      explicitFrameworks: options.complianceFrameworks,
    });
  } catch (err) {
    sink.stderr(
      `error: compliance coverage evaluation failed: ${sanitizeErrorMessage({ error: err, fallback: "compliance pipeline failure" })}\n`,
    );
    return 2;
  }

  // Coverage-baseline drift gate (Issue #1950): seeds the per-tenant
  // baseline on first run, evaluates drift on subsequent runs, and
  // re-baselines when `--coverage-baseline-update` is passed. The
  // augmented policy report is rewritten atomically when drift trips
  // the gate so downstream consumers see the
  // `policy:coverage-drift-exceeded` job-level violation.
  let coverageBaselineSummary: string | undefined;
  if (options.coverageBaseline?.archetype !== undefined) {
    try {
      coverageBaselineSummary = await runCoverageBaselineSync({
        result,
        coverageBaseline: {
          archetype: options.coverageBaseline.archetype,
          tenantId: options.coverageBaseline.tenantId,
          mode: options.coverageBaseline.mode,
          runtimeRoot:
            options.coverageBaseline.runtimeRoot ??
            join(runOutputDir, "test-intelligence"),
        },
      });
    } catch (err) {
      sink.stderr(
        `error: coverage-baseline sync failed: ${sanitizeErrorMessage({ error: err, fallback: "filesystem failure" })}\n`,
      );
      return 2;
    }
  }

  const customerMarkdownFileCount =
    1 + result.customerMarkdownPaths.perCase.length;

  const finopsTotalsLine = await safeReadFinopsTotals(
    result.artifactPaths.finopsReport,
    loadJsonFile,
  );
  const evidenceDigestLine = await safeReadEvidenceDigest(
    result.artifactPaths.evidenceSeal,
    loadJsonFile,
  );

  const summaryLines = [
    "test-intelligence run completed",
    `  job id              : ${result.jobId}`,
    `  output dir          : ${runOutputDir}`,
    `  artifact dir        : ${result.artifactDir}`,
    `  test cases generated: ${result.generatedTestCases.testCases.length}`,
    `  customer md files   : ${customerMarkdownFileCount}`,
    `  combined markdown   : ${result.customerMarkdownPaths.combined}`,
  ];
  if (result.blocked) {
    const blockedMessage = `warning: test cases blocked by policy gate (job ${result.jobId}); see ${result.artifactPaths.policyReport}\n`;
    sink.stderr(blockedMessage);
    if (!allowPolicyBlocked) {
      return 3;
    }
    summaryLines.push(
      "  policy status       : blocked (manual review required)",
    );
  }
  if (finopsTotalsLine) summaryLines.push(finopsTotalsLine);
  if (evidenceDigestLine) summaryLines.push(evidenceDigestLine);
  summaryLines.push(complianceCoverageSummary);
  if (coverageBaselineSummary !== undefined) {
    summaryLines.push(coverageBaselineSummary);
  }
  if (result.harness !== undefined) {
    const h = result.harness;
    summaryLines.push(
      `  multi-agent harness : mode=${h.mode} outcome=${h.outcome} status=${h.mappedJobStatus} attempts=${h.attemptsConsumed}/${h.maxAttemptsAllowed}`,
      `  harness artifact    : ${h.artifactPath}`,
    );
  }
  summaryLines.push("");

  sink.stdout(summaryLines.join("\n"));
  return 0;
};

export const TEST_INTELLIGENCE_RUN_HELP: string = `
workspace-dev test-intelligence run - drive the figma_to_qc_test_cases pipeline

Usage:
  workspace-dev test-intelligence run [options]

Source (exactly one required):
  --figma-url <url>          Figma file URL (deep-linkable; node-id supported)
  --figma-json-file <path>   Local Figma REST JSON (FigmaRestFileSnapshot shape)
  --figma-payload <path>     Alias of --figma-json-file. Use for sovereign-cloud
                             / air-gap deployments where the Figma payload was
                             pre-fetched on a connected machine via
                             "workspace-dev test-intelligence figma-export"
                             (Issue #2187).

Output:
  --output <dir>             Run-artifact destination.
                             Default: ${DEFAULT_OUTPUT_ROOT}/jobs/<jobId>/test-intelligence
                             When supplied explicitly, the CLI writes each run
                             into <output>/<timestamp>/ by default.
  --output-run-subdir timestamp|job-id
                             Write all run artifacts into <output>/<timestamp>/
                             or <output>/<jobId>/ so repeated runs do not
                             overwrite previous output. Default for explicit
                             --output: timestamp.

LLM (defaults from environment):
  --model-endpoint <url>     default: env WORKSPACE_TEST_SPACE_MODEL_ENDPOINT
  --model-deployment <name>  default: env WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT
                             (falls back to "gpt-oss-120b")
  --logic-judge-deployment <name>
                             Optional dedicated deployment for the
                             cross-model logic judge (Issue #1932).
                             Default: env WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT
                             (falls back to the generator deployment
                             for legacy single-model runs).
                             Recommended: pin a different model
                             family from the generator
                             (e.g. mistral-large-3 generator with
                             gpt-oss-120b judge) so a self-consistency
                             bias from the generator is not amplified
                             by reusing the same model on the judge.
  --coverage-planner-deployment <name>
                             Optional dedicated deployment for the
                             Coverage-Planner augmentation (Issue #1934).
                             Default: env
                             WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT
                             (falls back to deterministic-only planning
                             when unset).
  --risk-ranker-deployment <name>
                             Optional dedicated deployment for the
                             Risk-Ranker augmentation (Issue #1935).
                             Default: env
                             WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT
                             (falls back to deterministic-only ranking
                             when unset).
  --model-api-key <key>      default: env WORKSPACE_TEST_SPACE_LLM_API_KEY
                             (never logged, never echoed)
  --ict-register-ref <ref>   ICT register reference forwarded to all CLI-created
                             model bindings. Default: env
                             WORKSPACE_TEST_SPACE_ICT_REGISTER_REF

Figma (URL mode only):
  --figma-token <token>      default: env FIGMA_ACCESS_TOKEN

FinOps:
  --finops-budget <path>     Path to a JSON FinOps budget envelope.
                             Default: production envelope

Figma payload:
  --max-figma-payload-bytes <n>
                             Override the maximum Figma REST payload (in
                             bytes) the runner will accept. Soft default
                             ${MAX_FIGMA_PAYLOAD_BYTES} (128 MiB). Hard
                             ceiling ${MAX_FIGMA_PAYLOAD_BYTES_CEILING}
                             (128 MiB) — values above this ceiling are
                             rejected at parse time as a security
                             precaution against memory-pressure / DoS
                             from oversized payloads (validated again at
                             runtime, defense in depth). Operators with
                             vetted private files (e.g. tier-1 banking
                             masks) opt up on a per-job basis. Also
                             settable via env
                             WORKSPACE_TEST_SPACE_MAX_FIGMA_PAYLOAD_BYTES.
                             The resolved cap and the actual payload
                             bytes ingested are stamped onto the FinOps
                             budget report (\`figmaPayload\` field) for
                             audit trail.

Topology preflight:
  --require-multi-agent-topology
                             Fail closed when the resolved role matrix
                             degrades into a legacy single-model
                             topology. Also enabled by env
                             WORKSPACE_TEST_SPACE_REQUIRE_MULTI_AGENT_TOPOLOGY=1.

Custom supporting context (Issue #1894):
  --custom-context-markdown <path>
                             UTF-8 Markdown file (max 256 KiB) carrying
                             additional supporting context for the LLM.
                             The runner canonicalizes the body (PII redaction,
                             prompt-injection neutralization, link/HTML/MDX/
                             image refusal) before any LLM call. Oversize
                             files exit 1; missing files exit 1; canonical
                             rejection exits 2 with CUSTOM_CONTEXT_MARKDOWN_INVALID.
  --customer-eval-markdown <path>
                             UTF-8 Markdown file (max 256 KiB) carrying the
                             customer's test-case evaluation rubric. Loaded as
                             rubric/format guidance, not as Jira context.

Visual sidecar:
  --enable-visual-sidecar    Build and attach the visual-sidecar bundle
                             (default: off; env override:
                             FIGMAPIPE_WORKSPACE_TI_ENABLE_VISUAL_SIDECAR=1)
                             Requires:
                             WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT
                             and resolved primary/fallback deployments.
  --visual-primary-deployment <name>
                             Optional dedicated deployment for the
                             visual-primary role (Issue #1996).
                             Default: env
                             WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT
                             (falls back to disabled when unset).
  --visual-fallback-deployment <name>
                             Optional dedicated deployment for the
                             visual-fallback role (Issue #1996).
                             Default: env
                             WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT
                             (falls back to disabled when unset).
  --a11y-judge-deployment <name>
                             Optional dedicated deployment for the
                             LLM-augmented accessibility judge
                             (Issue #1996).
                             Default: env
                             WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT
                             (falls back to deterministic-only a11y
                             evaluation when unset).
  --no-visual-sidecar        Skip the visual sidecar pass even when a
                             bundle is configured.
                             Mutually exclusive with
                             --enable-visual-sidecar.

Mutation-killing eval (Issue #2041):
  --enable-mutation-eval     Run the mutation-killing eval after the
                             validation pipeline; persist
                             mutation-report.json and embed the
                             mutationKillRate summary in policy-report.json.
                             Default: off (env override:
                             FIGMAPIPE_WORKSPACE_TI_ENABLE_MUTATION_EVAL=1).
                             The evaluator is fully deterministic and
                             never calls the LLM gateway, so it consumes
                             no token budget.
  --no-mutation-eval         Force-disable mutation eval even when the
                             environment override is set.

Other:
  --policy-profile <id>      Optional policy profile id (default: built-in EU banking)
  --compliance-frameworks <csv>
                             Optional comma-separated list of compliance
                             frameworks evaluated by the deterministic
                             compliance annotator (Issue #2042). Known
                             values: PSD2,MIFID_II,IDD,SOLVENCY_II,DORA,
                             EU_AI_ACT,GDPR. When omitted, the active set
                             is derived from the policy profile.
  --allow-policy-blocked     Do not fail with exit code 3 when policy blocked.
                             Emits a warning and marks the summary for manual review.
  --show-confidence          Render per-case calibrated confidence in
                             customer-markdown/testfaelle.md. Default: off
                             for customer view, on only for technical renderers.
  --mode <m>                 deterministic_llm | offline_eval | dry_run
                             (default: deterministic_llm; offline_eval is
                             currently routed via deterministic_llm)

Multi-agent harness (Issue #1791):
  --harness-mode <m>         off | shadow_eval | enforced
                             (default: off — legacy single-pass LLM)
                             shadow_eval: writes a per-step harness artifact
                                          alongside the LLM call (observation-only).
                             enforced:    harness owns the terminal decision and
                                          fails the run when outcome != accepted.
                             Requires --mode deterministic_llm.
  --harness-test-depth <d>   standard | exhaustive (default: standard)
                             Iteration-budget tag forwarded to the harness.
  --harness-role-step-id <id>
                             Override the harness role-step id used to namespace
                             the per-step artifact. Defaults to the runner's
                             built-in id; only set this when wrapping multiple
                             harness steps inside the same job.

Coverage-baseline drift (Issue #1950):
  --coverage-baseline-archetype <id>
                             Stable identifier for the coverage-baseline
                             group. When set, the post-run helper compares
                             the candidate coverage ratios against the
                             persisted baseline at
                             <runtime-root>/coverage-baselines/<tenant>/<archetype>.json.
                             First run per archetype seeds the baseline.
                             Drift > 10 % on any of fieldCoverage,
                             actionCoverage, validationCoverage, or
                             navigationCoverage emits a
                             policy:coverage-drift-exceeded job-level
                             violation (warning severity → needs_review).
  --coverage-baseline-tenant <id>
                             Tenant scope segment (default: env
                             WORKSPACE_TEST_SPACE_TENANT_ID, then "default").
  --coverage-baseline-runtime-root <path>
                             Override the baseline runtime root (default:
                             <output-root>/test-intelligence).
  --coverage-baseline-update Operator re-baseline. Atomically rewrites the
                             baseline with the candidate ratios; drift
                             evaluation is skipped this run. Requires
                             --coverage-baseline-archetype.

Feature gate:
  FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1 must be set.

Exit codes:
  0  success
  1  operator/config error (includes missing feature gate, missing visual env,
                            and conflicting visual-sidecar flags)
  2  runner error (includes enforced-harness refusal mapped via runner)
  3  policy refusal / blocked (set --allow-policy-blocked to continue on blocked jobs)
  4  budget exceeded
`;

export const TEST_INTELLIGENCE_DOCTOR_HELP: string = `
workspace-dev test-intelligence doctor - inspect the local Test Intelligence topology

Usage:
  workspace-dev test-intelligence doctor [options]

Deployments (defaults from environment):
  --model-deployment <name>             default: env WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT
  --logic-judge-deployment <name>       default: env WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT
  --coverage-planner-deployment <name>  default: env WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT
  --risk-ranker-deployment <name>       default: env WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT
  --visual-primary-deployment <name>    default: env WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT
  --visual-fallback-deployment <name>   default: env WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT
  --a11y-judge-deployment <name>        default: env WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT

Behavior:
  - Prints a deterministic, sanitized role-to-deployment matrix.
  - Never prints endpoints, API keys, or tokens.
  - Returns exit code 1 when the resolved topology contains an invalid role contract.
  - Returns exit code 0 for ok or warning-only topologies.
`;

export const TEST_INTELLIGENCE_VERIFY_PROVENANCE_HELP: string = `
workspace-dev test-intelligence verify-provenance - verify provenance.jsonld against a run directory

Usage:
  workspace-dev test-intelligence verify-provenance <run-dir>
  workspace-dev test-intelligence --verify-provenance <run-dir>

Behavior:
  - Recomputes the provenance Merkle root from the on-disk JSON-LD graph.
  - Verifies every attested artifact hash referenced by the graph.
  - Confirms policy-report.json carries the same Merkle root summary.
  - Returns exit code 0 on success, 1 on operator misuse, 2 on tamper/mismatch.
`;

export const TEST_INTELLIGENCE_AUDIT_DOSSIER_HELP: string = `
workspace-dev test-intelligence audit-dossier - generate a signed audit-dossier bundle from one run directory

Usage:
  workspace-dev test-intelligence audit-dossier --run-dir <path> --output <dir> [--sign-key <path>]

Behavior:
  - Requires a signing key via --sign-key or WORKSPACE_TEST_SPACE_AUDIT_SIGN_KEY.
  - Writes <run-id>-audit-dossier.{json,sig,pdf,merkle.txt} into the output directory.
  - Fails closed when required source artifacts are missing or malformed.
  - Never copies raw prompts, screenshots, or PII into the bundle; hashes and summary counts only.
`;

export const TEST_INTELLIGENCE_AUDIT_VERIFY_HELP: string = `
workspace-dev test-intelligence audit-verify - verify an audit-dossier bundle

Usage:
  workspace-dev test-intelligence audit-verify <bundle-prefix-or-json>
  workspace-dev test-intelligence audit-verify --bundle <bundle-prefix-or-json>

Behavior:
  - Verifies the detached Ed25519 signature against the canonical JSON manifest.
  - Recomputes the Merkle proof text from the manifest's provenance leaf hashes.
  - Returns exit code 0 on success, 1 on operator misuse, 2 on tamper/mismatch.
`;

export const TEST_INTELLIGENCE_VERIFY_SEAL_HELP: string = `
workspace-dev test-intelligence verify-seal - verify a production-runner reproducibility seal independently of the original run dir

Usage:
  workspace-dev test-intelligence verify-seal --bundle <path>
                                            [--key <path>]
                                            [--expected-hmac <hex>]
                                            [--expected-merkle-root <hex>]
                                            [--json]
                                            [--output <path>]

Bundle path (positional or --bundle):
  - Directory containing production-runner-evidence-seal.json (an existing run dir).
  - .tar / .tar.gz / .tgz archive containing the run dir.
  - .zip archive containing the run dir.
    Tar/zip extraction shells out to the universally available POSIX
    \`tar\` / \`unzip\` binaries; install them or extract the bundle
    manually and pass the resulting directory.

Verifier checks:
  - SHA-256 of every artifact matches the seal manifest.
  - Merkle root reconstructed from artifact hashes matches the supplied
    --expected-merkle-root (when provided).
  - HMAC over the canonical seal manifest is computed against the
    operator-supplied key (or against a default deterministic key if
    --key is omitted) and compared with --expected-hmac (when provided).
  - Provenance graph (provenance.jsonld) cross-links resolve consistently.
  - Region attestations are internally consistent with the FinOps
    deployment record.

Reports:
  - One line per artifact tagged OK / TAMPERED / MISSING / EXTRA.
  - Cross-check section with finops_bySource_hash / genealogy_dag_hash /
    provenance_graph / region_attestations status.
  - --json / --output emit a machine-readable canonical-JSON summary.

Exit codes:
  0 on full match, 1 on operator misuse, 2 on any tamper / mismatch.
`;

export const TEST_INTELLIGENCE_HELP: string = `
workspace-dev test-intelligence

Usage:
  workspace-dev test-intelligence run [options]
  workspace-dev test-intelligence doctor [options]
  workspace-dev test-intelligence audit-dossier --run-dir <path> --output <dir>
  workspace-dev test-intelligence audit-verify <bundle-prefix-or-json>
  workspace-dev test-intelligence verify-provenance <run-dir>
  workspace-dev test-intelligence verify-seal --bundle <path> [--key <path>]
  workspace-dev test-intelligence review <list|get|decide> [options]
  workspace-dev test-intelligence calibration-refit [options]
  workspace-dev test-intelligence tms-push --run-dir <path> --tms <id> --project <id>
  workspace-dev test-intelligence onboard --tenant-id <id> --legal-name <name> --policy-profile <id> --output-root <dir>
  workspace-dev test-intelligence onboard --doctor --tenant-id <id> --output-root <dir>

Run "workspace-dev test-intelligence run --help" for the live-run flags.
Run "workspace-dev test-intelligence doctor --help" for the topology doctor flags.
Run "workspace-dev test-intelligence audit-dossier --help" for bundle generation.
Run "workspace-dev test-intelligence audit-verify --help" for bundle verification.
Run "workspace-dev test-intelligence verify-provenance --help" for provenance verification.
Run "workspace-dev test-intelligence verify-seal --help" for self-contained seal verification.
Run "workspace-dev test-intelligence review --help" for the human-oversight queue (Issue #2179).
Run "workspace-dev test-intelligence calibration-refit --help" for the self-improving calibration loop (Issue #2182).
Run "workspace-dev test-intelligence tms-push --help" for the production-grade TMS adapters (Issue #2183).
Run "workspace-dev test-intelligence onboard --help" for the self-service customer onboarding CLI (Issue #2185).
`;
