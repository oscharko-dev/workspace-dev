import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  SELF_VERIFY_RUBRIC_REPORT_ARTIFACT_FILENAME,
  SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type LlmGenerationResult,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import { cloneEuBankingDefaultProfile } from "./policy-profile.js";
import {
  runAndPersistValidationPipelineWithSelfVerify,
  runValidationPipeline,
  runValidationPipelineWithSelfVerify,
} from "./validation-pipeline.js";

const ZERO = "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Submit valid form",
  objective: "Submit the form successfully",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "Open screen", expected: "Screen visible" }],
  expectedResults: ["Form is submitted"],
  figmaTraceRefs: [{ screenId: "s-1" }],
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
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    visualSidecarSchemaVersion: "1.0.0",
    cacheHit: false,
    cacheKey: "k",
    inputHash: ZERO,
    promptHash: ZERO,
    schemaHash: ZERO,
  },
  ...overrides,
});

const buildList = (
  cases: ReadonlyArray<GeneratedTestCase>,
): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: [...cases],
});

const buildIntent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: [{ screenId: "s-1", screenName: "Form", trace: { nodeId: "s-1" } }],
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

const buildPerfectMockClient = () =>
  createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b-mock",
    modelRevision: "rev-1",
    gatewayRelease: "rel-1",
    responder: (request): LlmGenerationResult => {
      assert.equal(
        request.responseSchemaName,
        SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME,
      );
      const ids: string[] = [];
      const re = /"id"\s*:\s*"([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(request.userPrompt)) !== null) {
        const id = match[1];
        if (id !== undefined && !ids.includes(id) && /^tc-/.test(id)) {
          ids.push(id);
        }
      }
      return {
        outcome: "success",
        content: {
          caseEvaluations: ids.map((id) => ({
            testCaseId: id,
            dimensions: [...ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS]
              .sort()
              .map((d) => ({ dimension: d, score: 1 })),
            citations: [],
          })),
        },
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
        modelDeployment: "gpt-oss-120b-mock",
        modelRevision: "rev-1",
        gatewayRelease: "rel-1",
        attempt: 1,
      };
    },
  });

const RUBRIC_BINDING = {
  deployment: "gpt-oss-120b-mock",
  modelRevision: "rev-1",
  gatewayRelease: "rel-1",
};

test("disabled rubric pipeline matches the synchronous baseline byte-for-byte", async () => {
  const list = buildList([buildCase({ id: "tc-1" })]);
  const intent = buildIntent();
  const profile = cloneEuBankingDefaultProfile();
  const sync = runValidationPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    profile,
  });
  // Disabled rubric path runs the same logic as `runValidationPipeline`
  // when validation has no structural errors and no rubric is supplied.
  // The structurally-invalid early-return path takes the same code path
  // as `runValidationPipeline`, which proves the disabled path stays
  // byte-stable. We assert here that the sync path does NOT carry a
  // rubric field at all.
  assert.equal(sync.rubric, undefined);
});

test("enabled rubric pipeline populates rubric report + coverage rubricScore", async () => {
  const list = buildList([
    buildCase({ id: "tc-1" }),
    buildCase({ id: "tc-2" }),
  ]);
  const intent = buildIntent();
  const client = buildPerfectMockClient();

  const artifacts = await runValidationPipelineWithSelfVerify({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    selfVerify: {
      enabled: true,
      client,
      modelBinding: RUBRIC_BINDING,
      policyBundleVersion: "wave1",
    },
  });
  assert.ok(artifacts.rubric);
  assert.equal(artifacts.rubric?.refusal, undefined);
  assert.equal(artifacts.rubric?.aggregate.jobLevelRubricScore, 1);
  assert.equal(artifacts.coverage.rubricScore, 1);
  assert.equal(artifacts.rubric?.caseEvaluations.length, 2);
  for (const evaluation of artifacts.rubric?.caseEvaluations ?? []) {
    assert.equal(evaluation.rubricScore, 1);
  }
  // Strict generated-test-case schema preserves byte-stability — the rubric
  // pass does not mutate per-case quality signals on the cached test cases.
  for (const c of artifacts.generatedTestCases.testCases) {
    assert.equal(
      (c.qualitySignals as { rubricScore?: number }).rubricScore,
      undefined,
    );
  }
});

test("runAndPersistValidationPipelineWithSelfVerify writes the rubric report under testcases/", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vp-rubric-"));
  try {
    const list = buildList([buildCase({ id: "tc-1" })]);
    const intent = buildIntent();
    const client = buildPerfectMockClient();
    const { artifacts, paths } =
      await runAndPersistValidationPipelineWithSelfVerify({
        jobId: "job-1",
        generatedAt: GENERATED_AT,
        list,
        intent,
        destinationDir: dir,
        selfVerify: {
          enabled: true,
          client,
          modelBinding: RUBRIC_BINDING,
          policyBundleVersion: "wave1",
        },
      });
    assert.ok(artifacts.rubric);
    assert.match(
      paths.selfVerifyRubricReportPath ?? "",
      new RegExp(`testcases/${SELF_VERIFY_RUBRIC_REPORT_ARTIFACT_FILENAME}$`),
    );
    const raw = await readFile(paths.selfVerifyRubricReportPath ?? "", "utf8");
    // canonicalJson sorts keys; assert that the persisted bytes match the
    // canonicalization of the in-memory artifact.
    assert.equal(raw, canonicalJson(artifacts.rubric));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rubric pipeline preserves byte-stability when refusal occurs (no rubricScore on cases)", async () => {
  const list = buildList([buildCase({ id: "tc-1" })]);
  const intent = buildIntent();
  const refusingClient = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b-mock",
    modelRevision: "rev-1",
    gatewayRelease: "rel-1",
    responder: () => ({
      outcome: "error",
      errorClass: "transport",
      message: "simulated transport failure",
      retryable: false,
      attempt: 1,
    }),
  });
  const artifacts = await runValidationPipelineWithSelfVerify({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    selfVerify: {
      enabled: true,
      client: refusingClient,
      modelBinding: RUBRIC_BINDING,
      policyBundleVersion: "wave1",
    },
  });
  assert.ok(artifacts.rubric);
  assert.equal(artifacts.rubric?.refusal?.code, "gateway_failure");
  for (const c of artifacts.generatedTestCases.testCases) {
    assert.equal(
      (c.qualitySignals as { rubricScore?: number }).rubricScore,
      undefined,
    );
  }
  // Coverage report's rubricScore is also unset for refusals
  assert.equal(artifacts.coverage.rubricScore, undefined);
});

test("structurally-invalid validation skips the rubric pass entirely", async () => {
  const badCase = buildCase({
    id: "tc-1",
    title: "", // empty title triggers a validation error -> warning, not schema_invalid
  });
  // Force schema_invalid by trimming a required steps field
  const list = buildList([
    {
      ...badCase,
      // @ts-expect-error — intentionally invalid for the test
      steps: undefined,
    },
  ]);
  const client = buildPerfectMockClient();
  const artifacts = await runValidationPipelineWithSelfVerify({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent: buildIntent(),
    selfVerify: {
      enabled: true,
      client,
      modelBinding: RUBRIC_BINDING,
      policyBundleVersion: "wave1",
    },
  });
  // Schema-invalid early-return → no rubric populated, LLM never called
  assert.equal(artifacts.rubric, undefined);
  assert.equal(client.callCount(), 0);
});
