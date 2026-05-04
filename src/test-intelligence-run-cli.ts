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

import { mkdir, copyFile, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { sanitizeErrorMessage } from "./error-sanitization.js";
import {
  DEFAULT_OUTPUT_ROOT,
  resolveTestIntelligenceEnabled,
} from "./server/constants.js";
import type { FinOpsBudgetEnvelope } from "./contracts/index.js";
import {
  PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT,
  ProductionRunnerError,
  runFigmaToQcTestCases,
  validateFinOpsBudgetEnvelope,
  type FigmaRestNode,
  type ProductionRunnerSource,
  type RunFigmaToQcTestCasesInput,
  type RunFigmaToQcTestCasesResult,
} from "./test-intelligence/index.js";
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

/** Parsed, validated flags for the test-intelligence run command. */
export interface TestIntelligenceRunOptions {
  figmaUrl: string | undefined;
  figmaJsonFile: string | undefined;
  /** Output directory for customer Markdown. `undefined` → default derived from job id. */
  output: string | undefined;
  modelEndpoint: string | undefined;
  modelDeployment: string;
  modelApiKey: string | undefined;
  figmaToken: string | undefined;
  policyProfile: string | undefined;
  mode: TestIntelligenceRunMode;
  /** When true, skip the visual sidecar pass even if a bundle is configured. */
  noVisualSidecar: boolean;
  /** Path to a JSON FinOps budget envelope to apply. `undefined` → production default. */
  finopsBudgetPath: string | undefined;
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
  let modelApiKey: string | undefined =
    env.WORKSPACE_TEST_SPACE_MODEL_API_KEY?.trim() || undefined;
  let figmaToken: string | undefined =
    env.FIGMA_ACCESS_TOKEN?.trim() || undefined;
  let policyProfile: string | undefined;
  let mode: TestIntelligenceRunMode = "dry_run";
  let noVisualSidecar = false;
  let finopsBudgetPath: string | undefined;

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

  return {
    figmaUrl,
    figmaJsonFile,
    output,
    modelEndpoint,
    modelDeployment,
    modelApiKey,
    figmaToken,
    policyProfile,
    mode,
    noVisualSidecar,
    finopsBudgetPath,
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
  /** Wall-clock provider for deterministic job ids in tests. */
  now?: () => number;
  /**
   * Environment variable map for the feature gate check. Defaults to
   * `process.env`. Inject in tests to avoid touching process state.
   */
  env?: NodeJS.ProcessEnv;
}

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

const defaultLoadFigmaJsonFile = async (filePath: string): Promise<unknown> => {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text) as unknown;
};

const defaultLoadJsonFile = async (filePath: string): Promise<unknown> => {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text) as unknown;
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

  if (options.mode === "offline_eval") {
    sink.stderr(
      "error: --mode offline_eval is not implemented in the CLI yet (#1737 tracks the eval-harness wiring)\n",
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
        `  policy profile: ${options.policyProfile ?? "(default)"}`,
        `  visual sidecar: ${options.noVisualSidecar ? "disabled (--no-visual-sidecar)" : "enabled when bundle configured"}`,
        `  finops budget : ${options.finopsBudgetPath ?? "(production default)"}`,
        "",
      ].join("\n"),
    );
    return 0;
  }

  let llmClient: LlmGatewayClient;
  try {
    llmClient =
      runtime.buildLlmClient?.(options) ?? buildLiveLlmGatewayClient(options);
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
  const runInput: RunFigmaToQcTestCasesInput = {
    jobId,
    generatedAt,
    source: resolved.source,
    outputRoot: runnerOutputRoot,
    llm: {
      client: llmClient,
      maxOutputTokens: 32_000,
      maxWallClockMs: 240_000,
    },
    ...(finopsBudget !== undefined ? { finopsBudget } : {}),
    ...(options.policyProfile !== undefined
      ? { policyProfileId: options.policyProfile }
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
  --model-api-key <key>      default: env WORKSPACE_TEST_SPACE_MODEL_API_KEY
                             (never logged, never echoed)

Figma (URL mode only):
  --figma-token <token>      default: env FIGMA_ACCESS_TOKEN

FinOps:
  --finops-budget <path>     Path to a JSON FinOps budget envelope.
                             Default: production envelope

Visual sidecar:
  --no-visual-sidecar        Skip the visual sidecar pass even when a
                             bundle is configured (default: enabled)

Other:
  --policy-profile <id>      Optional policy profile id (default: built-in EU banking)
  --mode <m>                 deterministic_llm | offline_eval | dry_run
                             (default: dry_run)

Feature gate:
  FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1 must be set.

Exit codes:
  0  success
  1  operator/config error (includes missing feature gate)
  2  runner error
  3  policy refusal / blocked
  4  budget exceeded
`;
