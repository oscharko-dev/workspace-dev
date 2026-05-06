/**
 * `workspace-dev test-intelligence run` sub-command (Issue #1736).
 *
 * Drives the production runner exported by `src/test-intelligence` from the
 * official package CLI surface. Parses kebab-case flags, validates required
 * inputs and env vars, builds the same Azure-bound LLM gateway client the
 * production runner already uses, executes the figma_to_qc_test_cases
 * pipeline end-to-end, and writes the customer-format German Markdown to
 * the operator-supplied output directory.
 *
 * Modes:
 *   - `dry_run` (default): validate args + env + Figma source resolution but
 *     skip the LLM call. Writes nothing. Useful for CI smoke tests.
 *   - `deterministic_llm`: real LLM gateway client; writes Markdown.
 *   - `offline_eval`: reserved for the on-disk eval-harness wiring (#1737).
 *     Currently rejected with an explicit `not implemented` operator error.
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

import { mkdir, copyFile, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * CLI-side hard cap on the raw `--custom-context-markdown` file size
 * (Issue #1894). Matches the safety bound documented on the issue: any
 * file larger than this is rejected with exit code 1 before the CLI
 * even reads the body. The runner then enforces the tighter
 * canonical-Markdown limits from `custom-context-markdown.ts`.
 */
export const MAX_CUSTOM_CONTEXT_MARKDOWN_FILE_BYTES: number = 256 * 1024;

import { sanitizeErrorMessage } from "./error-sanitization.js";
import {
  DEFAULT_OUTPUT_ROOT,
  resolveTestIntelligenceEnabled,
} from "./server/constants.js";
import type { FinOpsBudgetEnvelope } from "./contracts/index.js";
import {
  PRODUCTION_RUNNER_HARNESS_MODES,
  PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT,
  ProductionRunnerError,
  runFigmaToQcTestCases,
  validateFinOpsBudgetEnvelope,
  type AgentHarnessTestDepth,
  type FigmaRestNode,
  type ProductionRunnerHarnessConfig,
  type ProductionRunnerHarnessMode,
  type ProductionRunnerSource,
  type RunFigmaToQcTestCasesInput,
  type RunFigmaToQcTestCasesResult,
} from "./test-intelligence/index.js";
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

export type TestIntelligenceRunMode =
  (typeof TEST_INTELLIGENCE_RUN_MODES)[number];

const isRunMode = (value: string): value is TestIntelligenceRunMode =>
  (TEST_INTELLIGENCE_RUN_MODES as ReadonlyArray<string>).includes(value);

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

/** Parsed, validated flags for the test-intelligence run command. */
export interface TestIntelligenceRunOptions {
  figmaUrl: string | undefined;
  figmaJsonFile: string | undefined;
  /** Output directory for customer Markdown. `undefined` → default derived from job id. */
  output: string | undefined;
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
  let modelEndpoint: string | undefined =
    env.WORKSPACE_TEST_SPACE_MODEL_ENDPOINT?.trim() || undefined;
  let modelDeployment: string =
    env.WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT?.trim() ||
    PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT;
  let logicJudgeDeployment: string | undefined =
    env.WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT?.trim() || undefined;
  let modelApiKey: string | undefined =
    env.WORKSPACE_TEST_SPACE_MODEL_API_KEY?.trim() || undefined;
  let figmaToken: string | undefined =
    env.FIGMA_ACCESS_TOKEN?.trim() || undefined;
  let policyProfile: string | undefined;
  let mode: TestIntelligenceRunMode = "dry_run";
  let enableVisualSidecar = isTruthyFlag(
    env.FIGMAPIPE_WORKSPACE_TI_ENABLE_VISUAL_SIDECAR,
  );
  let noVisualSidecar = false;
  let finopsBudgetPath: string | undefined;
  let harnessMode: ProductionRunnerHarnessMode = "off";
  let harnessTestDepth: AgentHarnessTestDepth = "standard";
  let harnessRoleStepId: string | undefined;
  let harnessMaxRepairIterations: number | undefined;
  let customContextMarkdownPath: string | undefined;

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

  return {
    figmaUrl,
    figmaJsonFile,
    output,
    modelEndpoint,
    modelDeployment,
    logicJudgeDeployment,
    modelApiKey,
    figmaToken,
    policyProfile,
    mode,
    enableVisualSidecar,
    noVisualSidecar,
    finopsBudgetPath,
    harnessMode,
    harnessTestDepth,
    harnessRoleStepId,
    harnessMaxRepairIterations,
    customContextMarkdownPath,
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
   * Override the file-system mkdir/copy step (tests). Default uses
   * `node:fs/promises`.
   */
  copyArtifactsToOutput?: (
    runnerCustomerMarkdownDir: string,
    outputDir: string,
  ) => Promise<number>;
  /**
   * Override the loader for `--custom-context-markdown` files (Issue #1894).
   * Default uses `stat` + `readFile` against the local filesystem and
   * enforces the 256 KiB hard cap before the body is returned. Tests
   * inject a deterministic loader to avoid touching the disk.
   */
  loadCustomContextMarkdownFile?: (filePath: string) => Promise<string>;
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

const defaultCopyArtifactsToOutput = async (
  customerMarkdownDir: string,
  outputDir: string,
): Promise<number> => {
  await mkdir(outputDir, { recursive: true });
  const entries = await readdir(customerMarkdownDir);
  let copied = 0;
  for (const name of entries) {
    await copyFile(join(customerMarkdownDir, name), join(outputDir, name));
    copied += 1;
  }
  return copied;
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
  const copyArtifactsToOutput =
    runtime.copyArtifactsToOutput ?? defaultCopyArtifactsToOutput;
  const loadCustomContextMarkdownFile =
    runtime.loadCustomContextMarkdownFile ??
    defaultLoadCustomContextMarkdownFile;

  const jobId = `ti-cli-${now()}`;
  const generatedAt = new Date(now()).toISOString();

  const outputDir =
    options.output !== undefined
      ? resolve(options.output)
      : resolve(join(DEFAULT_OUTPUT_ROOT, "jobs", jobId, "test-intelligence"));

  await mkdir(outputDir, { recursive: true });

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

  if (options.mode === "offline_eval") {
    sink.stderr(
      "error: --mode offline_eval is not implemented in the CLI yet (#1737 tracks the eval-harness wiring)\n",
    );
    return 1;
  }

  // Cross-flag validation: the multi-agent harness wraps the LLM call. In
  // dry_run no LLM call is dispatched, so requesting a harness mode is a
  // configuration mistake the operator should hear about loudly rather than
  // discover from a silent no-op.
  if (options.mode === "dry_run" && options.harnessMode !== "off") {
    sink.stderr(
      `error: --harness-mode ${options.harnessMode} requires --mode deterministic_llm; the harness wraps the LLM call and dry_run does not dispatch one\n`,
    );
    return 1;
  }

  const runnerOutputRoot = join(outputDir, "_runner-output");
  await mkdir(runnerOutputRoot, { recursive: true });

  if (options.mode === "dry_run") {
    sink.stdout(
      [
        "test-intelligence run (dry_run) — no LLM call dispatched",
        `  job id        : ${jobId}`,
        `  output dir    : ${outputDir}`,
        `  source kind   : ${resolved.source.kind}`,
        `  deployment    : ${options.modelDeployment}`,
        `  judge deploy  : ${options.logicJudgeDeployment ?? "(reuses generator deployment)"}`,
        `  policy profile: ${options.policyProfile ?? "(default)"}`,
        `  visual sidecar: ${
          options.noVisualSidecar
            ? "disabled (--no-visual-sidecar)"
            : options.enableVisualSidecar
              ? "enabled (--enable-visual-sidecar)"
              : "disabled (default; set --enable-visual-sidecar or FIGMAPIPE_WORKSPACE_TI_ENABLE_VISUAL_SIDECAR=1)"
        }`,
        `  finops budget : ${options.finopsBudgetPath ?? "(production default)"}`,
        `  harness mode  : off (dry_run never reaches the harness)`,
        `  custom md ctx : ${customContextMarkdownBody !== undefined ? `loaded (${Buffer.byteLength(customContextMarkdownBody, "utf8")} bytes)` : "(none)"}`,
        "",
      ].join("\n"),
    );
    return 0;
  }

  let llmClient: LlmGatewayClient;
  let llmBundle: LlmGatewayClientBundle | undefined;
  let logicJudgeClient: LlmGatewayClient | undefined;
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
    outputRoot: runnerOutputRoot,
    llm: {
      client: llmClient,
      ...(llmBundle !== undefined ? { bundle: llmBundle } : {}),
      ...(logicJudgeClient !== undefined
        ? { logicJudge: logicJudgeClient }
        : {}),
      maxOutputTokens: 32_000,
      maxWallClockMs: 240_000,
    },
    ...(finopsBudget !== undefined ? { finopsBudget } : {}),
    ...(options.policyProfile !== undefined
      ? { policyProfileId: options.policyProfile }
      : {}),
    ...(harnessConfig !== undefined ? { harness: harnessConfig } : {}),
    ...(customContextMarkdownBody !== undefined
      ? { customContextMarkdown: customContextMarkdownBody }
      : {}),
  };

  let result: RunFigmaToQcTestCasesResult;
  try {
    result = await runner(runInput);
  } catch (err) {
    sink.stderr(`error: ${formatRunnerError(err)}\n`);
    return exitCodeForRunnerError(err);
  }

  const customerMarkdownDir = dirname(result.customerMarkdownPaths.combined);
  let copiedFileCount: number;
  try {
    copiedFileCount = await copyArtifactsToOutput(
      customerMarkdownDir,
      outputDir,
    );
  } catch (err) {
    sink.stderr(
      `error: failed to copy customer Markdown to output dir: ${sanitizeErrorMessage({ error: err, fallback: "filesystem failure" })}\n`,
    );
    return 2;
  }

  if (result.blocked) {
    sink.stderr(
      `error: test cases blocked by policy gate (job ${result.jobId}); see ${result.artifactPaths.policyReport}\n`,
    );
    return 3;
  }

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
    `  output dir          : ${outputDir}`,
    `  test cases generated: ${result.generatedTestCases.testCases.length}`,
    `  customer files      : ${copiedFileCount}`,
    `  combined markdown   : ${join(outputDir, "testfaelle.md")}`,
  ];
  if (finopsTotalsLine) summaryLines.push(finopsTotalsLine);
  if (evidenceDigestLine) summaryLines.push(evidenceDigestLine);
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
  --output <dir>             Customer-format Markdown destination.
                             Default: ${DEFAULT_OUTPUT_ROOT}/jobs/<jobId>/test-intelligence

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
  --model-api-key <key>      default: env WORKSPACE_TEST_SPACE_MODEL_API_KEY
                             (never logged, never echoed)

Figma (URL mode only):
  --figma-token <token>      default: env FIGMA_ACCESS_TOKEN

FinOps:
  --finops-budget <path>     Path to a JSON FinOps budget envelope.
                             Default: production envelope

Custom supporting context (Issue #1894):
  --custom-context-markdown <path>
                             UTF-8 Markdown file (max 256 KiB) carrying
                             additional supporting context for the LLM.
                             The runner canonicalizes the body (PII redaction,
                             prompt-injection neutralization, link/HTML/MDX/
                             image refusal) before any LLM call. Oversize
                             files exit 1; missing files exit 1; canonical
                             rejection exits 2 with CUSTOM_CONTEXT_MARKDOWN_INVALID.

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
  --mode <m>                 deterministic_llm | offline_eval | dry_run
                             (default: dry_run)

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

Feature gate:
  FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1 must be set.

Exit codes:
  0  success
  1  operator/config error (includes missing feature gate, missing visual env,
                            and conflicting visual-sidecar flags)
  2  runner error (includes enforced-harness refusal mapped via runner)
  3  policy refusal / blocked
  4  budget exceeded
`;
