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
 *   - Visual sidecar (#1359 Wave 5): the runner does not yet capture
 *     screenshots or call `describeVisualScreens`.
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
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import {
  GENERATED_TESTCASES_ARTIFACT_FILENAME,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseAuditMetadata,
  type GeneratedTestCaseFigmaTrace,
  type GeneratedTestCaseList,
  type GeneratedTestCaseStep,
  type LlmGenerationRequest,
  type TestCaseLevel,
  type TestCasePolicyReport,
  type TestCasePriority,
  type TestCaseRiskCategory,
  type TestCaseTechnique29119,
  type TestCaseType,
  type TestCaseValidationReport,
  type TestCaseCoverageReport,
} from "../contracts/index.js";
import { sanitizeErrorMessage } from "../error-sanitization.js";
import { canonicalJson } from "./content-hash.js";
import { renderCustomerMarkdown } from "./customer-markdown-renderer.js";
import {
  fetchFigmaFileForTestIntelligence,
  FigmaRestFetchError,
  parseFigmaUrl,
  type FigmaRestFileSnapshot,
  type FigmaRestNode,
} from "./figma-rest-adapter.js";
import { normalizeFigmaFileToIntentInput } from "./figma-payload-normalizer.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import type { LlmGatewayClient } from "./llm-gateway.js";
import { compilePrompt } from "./prompt-compiler.js";
import { runValidationPipeline } from "./validation-pipeline.js";

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
] as const;

export type ProductionRunnerFailureClass =
  (typeof PRODUCTION_RUNNER_FAILURE_CLASSES)[number];

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
  /** Optional per-request token budget. */
  maxOutputTokens?: number;
  /** Optional per-request wall-clock budget (ms). */
  maxWallClockMs?: number;
  /** Optional caller-side AbortSignal. */
  abortSignal?: AbortSignal;
}

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
   * Optional override for the file name surfaced in customer Markdown
   * headers; defaults to `figmaFile.name` (or the file key if missing).
   */
  customerLabel?: string;
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
  artifactDir: string;
  artifactPaths: {
    intent: string;
    compiledPrompt: string;
    generatedTestCases: string;
    validationReport: string;
    policyReport: string;
    coverageReport: string;
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
  // 1. Resolve Figma source.
  const figmaFile = await resolveFigmaSource(input.source);

  // 2. Normalize REST file → IntentDerivationFigmaInput.
  const intentInput = normalizeFigmaFileToIntentInput({
    fileKey: figmaFile.fileKey,
    document: figmaFile.document as FigmaRestNode,
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
  const intent = deriveBusinessTestIntentIr({ figma: intentInput });

  // 4. Compile prompt.
  // TODO(#1359 Wave 5): once the visual sidecar runs in production, plumb
  //   describeVisualScreens output here. Today the production runner ships
  //   without screenshot capture; the visual sidecar binding records that
  //   no fixture image is bound.
  const compiled = compilePrompt({
    jobId: input.jobId,
    intent,
    modelBinding: {
      modelRevision: TEST_GENERATION_MODEL_REVISION,
      gatewayRelease: TEST_GENERATION_GATEWAY_RELEASE,
    },
    policyBundleVersion: POLICY_BUNDLE_VERSION,
    visualBinding: {
      schemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
      selectedDeployment: "llama-4-maverick-vision",
      fallbackReason: "none",
      screenCount: 0,
    },
  });

  // 5. Build the draft request: relax the response_schema to the simpler
  //    LlmDraftResponse shape so the model is not asked to fabricate
  //    audit metadata it cannot know.
  const draftSchema = buildDraftResponseSchema();
  const generationRequest: LlmGenerationRequest = {
    jobId: compiled.request.jobId,
    systemPrompt: compiled.request.systemPrompt,
    userPrompt: buildAugmentedUserPrompt(compiled.request.userPrompt, intent),
    responseSchema: draftSchema,
    responseSchemaName: "workspace-dev-production-runner-draft-list-v1",
    ...(input.llm.maxOutputTokens !== undefined
      ? { maxOutputTokens: input.llm.maxOutputTokens }
      : {}),
    ...(input.llm.maxWallClockMs !== undefined
      ? { maxWallClockMs: input.llm.maxWallClockMs }
      : {}),
    ...(input.llm.abortSignal !== undefined
      ? { abortSignal: input.llm.abortSignal }
      : {}),
  };
  const llmResult = await input.llm.client.generate(generationRequest);
  if (llmResult.outcome !== "success") {
    if (llmResult.errorClass === "refusal") {
      throw new ProductionRunnerError({
        failureClass: "LLM_REFUSAL",
        message: `LLM refused to produce test cases: ${llmResult.message}`,
        retryable: false,
      });
    }
    throw new ProductionRunnerError({
      failureClass: "LLM_GATEWAY_FAILED",
      message: `LLM gateway returned ${llmResult.errorClass}: ${llmResult.message}`,
      retryable: llmResult.retryable,
    });
  }

  const draftValidation = validateLlmDraftResponse(llmResult.content);
  if (!draftValidation.ok) {
    throw new ProductionRunnerError({
      failureClass: "LLM_RESPONSE_INVALID",
      message: `LLM response did not match the expected draft schema: ${draftValidation.message}`,
      retryable: false,
    });
  }
  const drafts = draftValidation.value.testCases;

  // 6. Stamp full GeneratedTestCase records.
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

  // 7. Validation pipeline.
  const validation = runValidationPipeline({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: generatedList,
    intent,
  });

  // 8. Persist artifacts.
  const artifactDir = join(
    input.outputRoot,
    "jobs",
    input.jobId,
    "test-intelligence",
  );
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
  const policyPath = join(
    artifactDir,
    TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  );
  const coveragePath = join(
    artifactDir,
    TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  );
  try {
    await Promise.all([
      writeAtomicJson(intentPath, intent),
      writeAtomicJson(compiledPromptPath, compiled.artifacts),
      writeAtomicJson(generatedPath, validation.generatedTestCases),
      writeAtomicJson(validationPath, validation.validation),
      writeAtomicJson(policyPath, validation.policy),
      writeAtomicJson(coveragePath, validation.coverage),
    ]);
  } catch (err) {
    throw new ProductionRunnerError({
      failureClass: "PERSIST_FAILED",
      message: `Could not persist test-intelligence artifacts: ${sanitizeErrorMessage({ error: err, fallback: "filesystem failure" })}`,
      retryable: false,
      cause: err,
    });
  }

  // 9. Customer Markdown.
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
  await writeAtomicText(combinedMarkdownPath, rendered.combinedMarkdown);
  const perCasePaths: string[] = [];
  for (const file of rendered.perCaseFiles) {
    const filePath = join(markdownDir, file.filename);
    await writeAtomicText(filePath, file.body);
    perCasePaths.push(filePath);
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
    artifactDir,
    artifactPaths: {
      intent: intentPath,
      compiledPrompt: compiledPromptPath,
      generatedTestCases: generatedPath,
      validationReport: validationPath,
      policyReport: policyPath,
      coverageReport: coveragePath,
    },
    customerMarkdownPaths: {
      combined: combinedMarkdownPath,
      perCase: perCasePaths,
    },
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

interface DraftValidationResult {
  ok: true;
  value: LlmDraftResponse;
}
interface DraftValidationFailure {
  ok: false;
  message: string;
}

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
  const drafts: ProductionRunnerLlmDraftCase[] = [];
  for (let i = 0; i < root.testCases.length; i += 1) {
    const candidate = root.testCases[i];
    const validated = validateDraftCase(candidate, `testCases[${i}]`);
    if (!validated.ok) return validated;
    drafts.push(validated.value);
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
  return { ok: true, value: draft };
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
  };
};

const buildAugmentedUserPrompt = (
  basePrompt: string,
  intent: BusinessTestIntentIr,
): string => {
  // We hand the model the IR section already (compilePrompt embeds it).
  // Append a short, structured directive that pins the relaxed output
  // shape so a chatty model still produces something the runner can parse.
  // Keep this deterministic: the same intent + base prompt yield the same
  // augmentation, which keeps the replay-cache identity meaningful.
  const screenSummary = intent.screens
    .map((s) => `- ${s.screenId}: ${s.screenName}`)
    .join("\n");
  return [
    basePrompt,
    "",
    "DELIVERABLE FORMAT:",
    "Respond ONLY with a JSON object of the form:",
    `{"testCases": [{"title": string, "objective": string, "type": one of [functional|negative|boundary|validation|navigation|regression|exploratory|accessibility], "priority": one of [p0|p1|p2|p3], "riskCategory": one of [low|medium|high|regulated_data|financial_transaction], "technique": one of [equivalence_partitioning|boundary_value_analysis|decision_table|state_transition|use_case|exploratory|error_guessing|syntax_testing|classification_tree], "preconditions": string[], "testData": string[], "steps": [{"index": number, "action": string, "expected": string}], "expectedResults": string[], "figmaTraceRefs": [{"screenId": string, "nodeName": string?}], "assumptions": string[], "openQuestions": string[]}]}`,
    "",
    "RULES:",
    "- Schreibe alle Inhalte (title, objective, steps, expected, ...) auf DEUTSCH.",
    "- Bilde Positiv- und Negativfälle ab. Pro relevanter Eingabe einen eigenen Testfall.",
    "- Nutze für screenId die genannten IDs aus dem IR.",
    "- Liefere mindestens einen Testfall pro Bildschirm.",
    "",
    "Verfügbare Bildschirme:",
    screenSummary,
  ].join("\n");
};

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
        additionalProperties: false,
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
        },
      },
    },
  },
});

const writeAtomicJson = async (
  destinationPath: string,
  payload: unknown,
): Promise<void> => {
  const serialized = canonicalJson(payload);
  const tmpPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, destinationPath);
};

const writeAtomicText = async (
  destinationPath: string,
  payload: string,
): Promise<void> => {
  const tmpPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, payload, "utf8");
  await rename(tmpPath, destinationPath);
};
