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
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

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
  PRODUCTION_RUNNER_HARNESS_MODES,
  PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT,
  ProductionRunnerError,
  parseAndCanonicalizeCustomerProfile,
  runFigmaToQcTestCases,
  validateFinOpsBudgetEnvelope,
  type AgentHarnessTestDepth,
  type CustomerProfileInput,
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
  createLlmGatewayClientBundle,
  type LlmGatewayClientBundle,
} from "./test-intelligence/llm-gateway-bundle.js";
import {
  createLlmGatewayClient,
  type LlmGatewayClient,
} from "./test-intelligence/llm-gateway.js";

const TEST_INTELLIGENCE_RUN_MODES = [
  "deterministic_llm",
  "offline_eval",
  "dry_run",
] as const;

const TEST_INTELLIGENCE_GENERATOR_RECOMMENDED_DEPLOYMENT =
  "mistral-large-3";
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

export type TestIntelligenceRunMode =
  (typeof TEST_INTELLIGENCE_RUN_MODES)[number];

type TopologyInputSource = "cli" | "env" | "default";

type TopologyRoleStatus = "configured" | "disabled" | "skipped";

export interface TopologyInputSources {
  modelDeployment: TopologyInputSource;
  logicJudgeDeployment: TopologyInputSource;
  coveragePlannerDeployment: TopologyInputSource;
  riskRankerDeployment: TopologyInputSource;
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
  topologyInputSources: TopologyInputSources;
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
  modelApiKey: string | undefined;
  figmaToken: string | undefined;
  policyProfile: string | undefined;
  mode: TestIntelligenceRunMode;
  /** When true, opt into constructing the visual-sidecar bundle. */
  enableVisualSidecar: boolean;
  /** When true, skip the visual sidecar pass even if a bundle is configured. */
  noVisualSidecar: boolean;
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
  /**
   * Path to an optional JSON file (Issue #1946) conforming to the
   * {@link CustomerProfileInput} schema. The CLI enforces a hard 256 KiB
   * size cap and rejects the file with exit code 1 if the JSON is invalid
   * or the schema fails validation. The runner applies PII redaction +
   * prompt-injection scrub on all free-text fields before the profile
   * reaches the LLM gateway.
   */
  customerProfilePath: string | undefined;
  /** Optional ICT register reference forwarded to all CLI-created model clients. */
  ictRegisterRef?: string;
  /**
   * Generator diversity pass count (Issue #1936). `1` preserves the legacy
   * single-pass flow; `2` enables deterministic dual-pass generation.
   */
  diversityPasses: 1 | 2;
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
   * the production runner. `undefined` → runner default (10 MiB). Operators
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
  let modelApiKey: string | undefined =
    env.WORKSPACE_TEST_SPACE_MODEL_API_KEY?.trim() || undefined;
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
  let allowPolicyBlocked = parseBooleanFlagWithDefault(
    env.WORKSPACE_TEST_SPACE_ALLOW_POLICY_BLOCKED,
    true,
  );
  let customContextMarkdownPath: string | undefined;
  let customerEvalMarkdownPath: string | undefined;
  let customerProfilePath: string | undefined;
  let diversityPasses: 1 | 2 = 1;
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

    if (arg === "--figma-json-file") {
      const value = next?.trim();
      if (!value) {
        throw new TestIntelligenceRunOperatorError(
          "--figma-json-file requires a non-empty path",
        );
      }
      figmaJsonFile = value;
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
      if (value !== "1" && value !== "2") {
        throw new TestIntelligenceRunOperatorError(
          "--diversity-passes must be 1 or 2",
        );
      }
      diversityPasses = value === "2" ? 2 : 1;
      index += 1;
      continue;
    }

    throw new TestIntelligenceRunOperatorError(
      `Unknown flag for "test-intelligence run": ${arg}`,
    );
  }

  if (figmaUrl !== undefined && figmaJsonFile !== undefined) {
    throw new TestIntelligenceRunOperatorError(
      "--figma-url and --figma-json-file are mutually exclusive; pass exactly one",
    );
  }
  if (figmaUrl === undefined && figmaJsonFile === undefined) {
    throw new TestIntelligenceRunOperatorError(
      "One of --figma-url or --figma-json-file is required",
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
    modelApiKey,
    figmaToken,
    ...(ictRegisterRef !== undefined ? { ictRegisterRef } : {}),
    policyProfile,
    mode,
    enableVisualSidecar,
    noVisualSidecar,
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
    customerProfilePath,
    diversityPasses,
    coverageBaseline: {
      archetype: coverageBaselineArchetype,
      tenantId: coverageBaselineTenantId,
      runtimeRoot: coverageBaselineRuntimeRoot,
      mode: coverageBaselineMode,
    },
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

    throw new TestIntelligenceRunOperatorError(
      `Unknown flag for "test-intelligence doctor": ${arg}`,
    );
  }

  return {
    modelDeployment,
    logicJudgeDeployment,
    coveragePlannerDeployment,
    riskRankerDeployment,
    topologyInputSources,
  };
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
      "--model-api-key or WORKSPACE_TEST_SPACE_MODEL_API_KEY is required for mode=deterministic_llm",
    );
  }
  const apiKey = options.modelApiKey;
  const deployment = options.logicJudgeDeployment;
  return createLlmGatewayClient(
    {
      role: "logic_judge",
      compatibilityMode: "openai_chat",
      baseUrl: options.modelEndpoint,
      deployment,
      modelRevision: `${deployment}@cli-test-intelligence-run`,
      gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
      authMode: "api_key",
      ...(options.ictRegisterRef !== undefined
        ? { ictRegisterRef: options.ictRegisterRef }
        : {}),
      declaredCapabilities: {
        structuredOutputs: true,
        seedSupport: false,
        reasoningEffortSupport: false,
        maxOutputTokensSupport: true,
        streamingSupport: false,
        imageInputSupport: false,
      },
      timeoutMs: 240_000,
      maxRetries: 1,
      circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30_000 },
      // Azure AI Foundry's `gpt-oss-120b` returns empty content for any
      // wire `response_format` value; suppress the wire field while
      // keeping the in-process JSON-parse + schema validation path.
      // Mirrors the generator's setting because both share the same
      // upstream (see #1733/#1734); judges that point at a different
      // family inherit the safer "none" mode by default — operators
      // tune this via a follow-up flag if their judge supports
      // json_schema natively.
      wireStructuredOutputMode: "none",
    },
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
      "--model-api-key or WORKSPACE_TEST_SPACE_MODEL_API_KEY is required for mode=deterministic_llm",
    );
  }
  const apiKey = options.modelApiKey;
  const deployment = options.coveragePlannerDeployment;
  return createLlmGatewayClient(
    {
      role: "coverage_planner",
      compatibilityMode: "openai_chat",
      baseUrl: options.modelEndpoint,
      deployment,
      modelRevision: `${deployment}@cli-test-intelligence-run`,
      gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
      authMode: "api_key",
      ...(options.ictRegisterRef !== undefined
        ? { ictRegisterRef: options.ictRegisterRef }
        : {}),
      declaredCapabilities: {
        structuredOutputs: true,
        seedSupport: false,
        reasoningEffortSupport: false,
        maxOutputTokensSupport: true,
        streamingSupport: false,
        imageInputSupport: false,
      },
      timeoutMs: 60_000,
      maxRetries: 1,
      circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30_000 },
      wireStructuredOutputMode: "none",
    },
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
      "--model-api-key or WORKSPACE_TEST_SPACE_MODEL_API_KEY is required for mode=deterministic_llm",
    );
  }
  const apiKey = options.modelApiKey;
  const deployment = options.riskRankerDeployment;
  return createLlmGatewayClient(
    {
      role: "risk_ranker",
      compatibilityMode: "openai_chat",
      baseUrl: options.modelEndpoint,
      deployment,
      modelRevision: `${deployment}@cli-test-intelligence-run`,
      gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
      authMode: "api_key",
      declaredCapabilities: {
        structuredOutputs: true,
        seedSupport: false,
        reasoningEffortSupport: false,
        maxOutputTokensSupport: true,
        streamingSupport: false,
        imageInputSupport: false,
      },
      timeoutMs: 60_000,
      maxRetries: 1,
      circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30_000 },
      wireStructuredOutputMode: "none",
    },
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
      "--model-api-key or WORKSPACE_TEST_SPACE_MODEL_API_KEY is required for mode=deterministic_llm",
    );
  }

  const apiKey = options.modelApiKey;
  return createLlmGatewayClient(
    {
      role: "test_generation",
      compatibilityMode: "openai_chat",
      baseUrl: options.modelEndpoint,
      deployment: options.modelDeployment,
      modelRevision: `${options.modelDeployment}@cli-test-intelligence-run`,
      gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
      authMode: "api_key",
      ...(options.ictRegisterRef !== undefined
        ? { ictRegisterRef: options.ictRegisterRef }
        : {}),
      declaredCapabilities: {
        structuredOutputs: true,
        seedSupport: false,
        reasoningEffortSupport: false,
        maxOutputTokensSupport: true,
        streamingSupport: false,
        imageInputSupport: false,
      },
      timeoutMs: 240_000,
      maxRetries: 1,
      circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30_000 },
      // Azure AI Foundry's `gpt-oss-120b` returns empty content for any
      // wire `response_format` value; suppress the wire field while
      // keeping the in-process JSON-parse + schema validation path
      // (probed and recorded in #1733/#1734).
      wireStructuredOutputMode: "none",
    },
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
      "--model-api-key or WORKSPACE_TEST_SPACE_MODEL_API_KEY is required for mode=deterministic_llm",
    );
  }
  const visualEndpoint = requireVisualSidecarEnv(
    env,
    "WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT",
  );
  const visualPrimaryDeployment = requireVisualSidecarEnv(
    env,
    "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
  );
  const visualFallbackDeployment = requireVisualSidecarEnv(
    env,
    "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
  );
  const a11yJudgeDeployment =
    readTrimmedEnv(env, "WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT");
  const riskRankerDeployment = options.riskRankerDeployment;

  const bundle = createLlmGatewayClientBundle(
    {
      testGeneration: {
        role: "test_generation",
        compatibilityMode: "openai_chat",
        baseUrl: options.modelEndpoint,
        deployment: options.modelDeployment,
        modelRevision: `${options.modelDeployment}@cli-test-intelligence-run`,
        gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
        authMode: "api_key",
        ...(options.ictRegisterRef !== undefined
          ? { ictRegisterRef: options.ictRegisterRef }
          : {}),
        declaredCapabilities: {
          structuredOutputs: true,
          seedSupport: false,
          reasoningEffortSupport: false,
          maxOutputTokensSupport: true,
          streamingSupport: false,
          imageInputSupport: false,
        },
        timeoutMs: 240_000,
        maxRetries: 1,
        circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30_000 },
        wireStructuredOutputMode: "none",
      },
      visualPrimary: {
        role: "visual_primary",
        compatibilityMode: "openai_chat",
        baseUrl: visualEndpoint,
        deployment: visualPrimaryDeployment,
        modelRevision: `${visualPrimaryDeployment}@cli-test-intelligence-run`,
        gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
        authMode: "api_key",
        ...(options.ictRegisterRef !== undefined
          ? { ictRegisterRef: options.ictRegisterRef }
          : {}),
        declaredCapabilities: {
          structuredOutputs: true,
          seedSupport: false,
          reasoningEffortSupport: false,
          maxOutputTokensSupport: true,
          streamingSupport: false,
          imageInputSupport: true,
        },
        timeoutMs: 60_000,
        maxRetries: 1,
        circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30_000 },
      },
      visualFallback: {
        role: "visual_fallback",
        compatibilityMode: "openai_chat",
        baseUrl: visualEndpoint,
        deployment: visualFallbackDeployment,
        modelRevision: `${visualFallbackDeployment}@cli-test-intelligence-run`,
        gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
        authMode: "api_key",
        ...(options.ictRegisterRef !== undefined
          ? { ictRegisterRef: options.ictRegisterRef }
          : {}),
        declaredCapabilities: {
          structuredOutputs: true,
          seedSupport: false,
          reasoningEffortSupport: false,
          maxOutputTokensSupport: true,
          streamingSupport: false,
          imageInputSupport: true,
        },
        timeoutMs: 60_000,
        maxRetries: 1,
        circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30_000 },
      },
      ...(a11yJudgeDeployment !== undefined
        ? {
            a11yJudge: {
              role: "a11y_judge" as const,
              compatibilityMode: "openai_chat" as const,
              baseUrl: visualEndpoint,
              deployment: a11yJudgeDeployment,
              modelRevision: `${a11yJudgeDeployment}@cli-test-intelligence-run`,
              gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
              authMode: "api_key" as const,
              ...(options.ictRegisterRef !== undefined
                ? { ictRegisterRef: options.ictRegisterRef }
                : {}),
              declaredCapabilities: {
                structuredOutputs: true,
                seedSupport: false,
                reasoningEffortSupport: false,
                maxOutputTokensSupport: true,
                streamingSupport: false,
                imageInputSupport: true,
              },
              timeoutMs: 60_000,
              maxRetries: 1,
              circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30_000 },
            },
          }
        : {}),
      ...(options.coveragePlannerDeployment !== undefined
        ? {
            coveragePlanner: {
              role: "coverage_planner" as const,
              compatibilityMode: "openai_chat" as const,
              baseUrl: options.modelEndpoint,
              deployment: options.coveragePlannerDeployment,
              modelRevision: `${options.coveragePlannerDeployment}@cli-test-intelligence-run`,
              gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
              authMode: "api_key" as const,
              ...(options.ictRegisterRef !== undefined
                ? { ictRegisterRef: options.ictRegisterRef }
                : {}),
              declaredCapabilities: {
                structuredOutputs: true,
                seedSupport: false,
                reasoningEffortSupport: false,
                maxOutputTokensSupport: true,
                streamingSupport: false,
                imageInputSupport: false,
              },
              timeoutMs: 60_000,
              maxRetries: 1,
              circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30_000 },
              wireStructuredOutputMode: "none" as const,
            },
          }
        : {}),
      ...(riskRankerDeployment !== undefined
        ? {
            riskRanker: {
              role: "risk_ranker" as const,
              compatibilityMode: "openai_chat" as const,
              baseUrl: options.modelEndpoint,
              deployment: riskRankerDeployment,
              modelRevision: `${riskRankerDeployment}@cli-test-intelligence-run`,
              gatewayRelease: "azure-ai-foundry-cli-test-intelligence-run",
              authMode: "api_key" as const,
              declaredCapabilities: {
                structuredOutputs: true,
                seedSupport: false,
                reasoningEffortSupport: false,
                maxOutputTokensSupport: true,
                streamingSupport: false,
                imageInputSupport: false,
              },
              timeoutMs: 60_000,
              maxRetries: 1,
              circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30_000 },
              wireStructuredOutputMode: "none" as const,
            },
          }
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

const formatTopologyRoleName = (role: TopologyRoleReportEntry["role"]): string =>
  role.replaceAll("_", "-");

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
  const visualSidecarEnabled = options.enableVisualSidecar && !options.noVisualSidecar;
  const roles: TopologyRoleReportEntry[] = [];
  const errors: string[] = [];
  const strictModeEnabled =
    options.requireMultiAgentTopology === true ||
    isTruthyFlag(env.WORKSPACE_TEST_SPACE_REQUIRE_MULTI_AGENT_TOPOLOGY);
  const optionSources = options.topologyInputSources;

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
      skipReason: "matches generator deployment; legacy fallback collapses to a single model",
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
    if (INCOMPATIBLE_OPENAI_CHAT_DEPLOYMENTS.has(options.logicJudgeDeployment)) {
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
    disabledReason: "not configured; deterministic-only coverage planning remains active",
  });
  pushOptionalTextRole({
    role: "risk_ranker",
    deployment: options.riskRankerDeployment,
    source: optionSources?.riskRankerDeployment ?? "default",
    disabledReason: "not configured; deterministic-only risk ranking remains active",
  });

  const visualPrimaryDeployment = readTrimmedEnv(
    env,
    "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
  );
  const visualFallbackDeployment = readTrimmedEnv(
    env,
    "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
  );
  const a11yJudgeDeployment = readTrimmedEnv(
    env,
    "WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT",
  );
  const visualPrimarySource = deploymentSourceFromEnv(
    env,
    "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
  );
  const visualFallbackSource = deploymentSourceFromEnv(
    env,
    "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
  );
  const a11ySource = deploymentSourceFromEnv(
    env,
    "WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT",
  );

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
      if (
        INCOMPATIBLE_OPENAI_CHAT_DEPLOYMENTS.has(visualPrimaryDeployment)
      ) {
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
      if (
        INCOMPATIBLE_OPENAI_CHAT_DEPLOYMENTS.has(visualFallbackDeployment)
      ) {
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
        skipReason: "not configured; deterministic accessibility evaluation remains active",
      });
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
  env: NodeJS.ProcessEnv,
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
    options.modelDeployment === TEST_INTELLIGENCE_GENERATOR_RECOMMENDED_DEPLOYMENT
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

  const visualPrimaryDeployment = readTrimmedEnv(
    env,
    "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
  );
  const visualFallbackDeployment = readTrimmedEnv(
    env,
    "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
  );
  const a11yJudgeDeployment = readTrimmedEnv(
    env,
    "WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT",
  );
  const visualPrimarySource = deploymentSourceFromEnv(
    env,
    "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
  );
  const visualFallbackSource = deploymentSourceFromEnv(
    env,
    "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
  );
  const a11ySource = deploymentSourceFromEnv(
    env,
    "WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT",
  );

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
        fix: `set ${envVar}=${recommendedDeployment}`,
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
        fix: `set ${envVar}=${recommendedDeployment}`,
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
      fix: `set ${envVar}=${recommendedDeployment}`,
    });
  };

  pushVisualRole({
    role: "visual_primary",
    deployment: visualPrimaryDeployment,
    source: visualPrimarySource,
    recommendedDeployment: TEST_INTELLIGENCE_VISUAL_PRIMARY_RECOMMENDED_DEPLOYMENT,
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
  const env = runtime.env ?? process.env;
  const report = buildDoctorReport(options, env);
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
    return join(input.outputDir, formatTimestampForRunSubdir(input.generatedAt));
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
    runtime.loadCustomerEvalMarkdownFile ??
    defaultLoadCustomerEvalMarkdownFile;
  const loadCustomerProfileFile =
    runtime.loadCustomerProfileFile ?? defaultLoadCustomerProfileFile;

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
        `  finops budget : ${options.finopsBudgetPath ?? "(production default)"}`,
        `  ict ref       : ${options.ictRegisterRef ?? "(none)"}`,
        `  output subdir : ${outputRunSubdirMode ?? "(none)"}`,
        `  harness mode  : off (dry_run never reaches the harness)`,
        `  custom md ctx : ${customContextMarkdownBody !== undefined ? `loaded (${Buffer.byteLength(customContextMarkdownBody, "utf8")} bytes)` : "(none)"}`,
        `  customer eval : ${customerEvalMarkdownBody !== undefined ? `loaded (${Buffer.byteLength(customerEvalMarkdownBody, "utf8")} bytes)` : "(none)"}`,
        `  customer prof : ${customerProfileInput !== undefined ? `loaded (${customerProfileRawBytes} bytes)` : "(none)"}`,
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
      ...(riskRankerClient !== undefined ? { riskRanker: riskRankerClient } : {}),
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
    ...(customerProfileInput !== undefined
      ? { customerProfile: customerProfileInput }
      : {}),
    ...(options.diversityPasses === 2
      ? {
          generation: {
            diversityPasses: 2 as const,
          },
        }
      : {}),
  };

  let result: RunFigmaToQcTestCasesResult;
  try {
    result = await runner(runInput);
  } catch (err) {
    sink.stderr(`error: ${formatRunnerError(err)}\n`);
    return exitCodeForRunnerError(err);
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
    summaryLines.push("  policy status       : blocked (manual review required)");
  }
  if (finopsTotalsLine) summaryLines.push(finopsTotalsLine);
  if (evidenceDigestLine) summaryLines.push(evidenceDigestLine);
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
  --model-api-key <key>      default: env WORKSPACE_TEST_SPACE_MODEL_API_KEY
                             (never logged, never echoed)
  --ict-register-ref <ref>   ICT register reference forwarded to all CLI-created
                             model bindings. Default: env
                             WORKSPACE_TEST_SPACE_ICT_REGISTER_REF

Figma (URL mode only):
  --figma-token <token>      default: env FIGMA_ACCESS_TOKEN

FinOps:
  --finops-budget <path>     Path to a JSON FinOps budget envelope.
                             Default: production envelope

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
                             WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT
                             WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT
  --no-visual-sidecar        Skip the visual sidecar pass even when a
                             bundle is configured.
                             Mutually exclusive with
                             --enable-visual-sidecar.

Other:
  --policy-profile <id>      Optional policy profile id (default: built-in EU banking)
  --allow-policy-blocked     Do not fail with exit code 3 when policy blocked.
                             Emits a warning and marks the summary for manual review.
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

Always read from environment:
  WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT
  WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT
  WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT

Behavior:
  - Prints a deterministic, sanitized role-to-deployment matrix.
  - Never prints endpoints, API keys, or tokens.
  - Returns exit code 1 when the resolved topology contains an invalid role contract.
  - Returns exit code 0 for ok or warning-only topologies.
`;

export const TEST_INTELLIGENCE_HELP: string = `
workspace-dev test-intelligence

Usage:
  workspace-dev test-intelligence run [options]
  workspace-dev test-intelligence doctor [options]

Run "workspace-dev test-intelligence run --help" for the live-run flags.
Run "workspace-dev test-intelligence doctor --help" for the topology doctor flags.
`;
