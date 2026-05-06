import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  A11Y_JUDGE_PROMPT_TEMPLATE_VERSION,
  A11Y_VERDICT_SCHEMA_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type LlmGatewayCapabilities,
  type VisualSidecarCaptureInput,
} from "../contracts/index.js";
import { createMockLlmGatewayClientBundle } from "./llm-gateway-bundle.js";
import {
  buildA11yJudgeCriteria,
  createMemoryA11yJudgeCache,
  runA11yJudge,
} from "./a11y-judge.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import type { IntentDerivationFigmaInput } from "./intent-derivation.js";

const PNG_BASE64 = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082",
  "hex",
).toString("base64");

const VISUAL_CAPS: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: false,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: true,
};

const FIXTURES_DIR = path.join(
  new URL(".", import.meta.url).pathname,
  "fixtures",
);

const STABLE_AUDIT = {
  jobId: "job-1940",
  generatedAt: "2026-05-06T00:00:00.000Z",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  redactionPolicyVersion: REDACTION_POLICY_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  cacheHit: false,
  cacheKey: "k".repeat(64),
  inputHash: "i".repeat(64),
  promptHash: "p".repeat(64),
  schemaHash: "s".repeat(64),
} as GeneratedTestCase["audit"];

const loadFigma = async (
  fixtureId: string,
): Promise<IntentDerivationFigmaInput> => {
  const raw = await readFile(
    path.join(FIXTURES_DIR, `${fixtureId}.figma.json`),
    "utf8",
  );
  return JSON.parse(raw) as IntentDerivationFigmaInput;
};

const buildAccessibilityList = (screenId: string): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1940",
  testCases: [
    {
      id: "tc-a11y-1",
      sourceJobId: "job-1940",
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
      title: "Accessibility smoke for loan form",
      objective: "Cover the key accessibility behaviors of the loan form.",
      level: "system",
      type: "accessibility",
      priority: "p2",
      riskCategory: "medium",
      technique: "exploratory",
      preconditions: [],
      testData: [],
      steps: [{ index: 1, action: "Traverse the form with keyboard only." }],
      expectedResults: ["Focusable elements are reachable and labeled."],
      figmaTraceRefs: [{ screenId }],
      assumptions: [],
      openQuestions: [],
      qcMappingPreview: { exportable: true } as GeneratedTestCase["qcMappingPreview"],
      qualitySignals: {
        coveredFieldIds: [],
        coveredActionIds: [],
        coveredValidationIds: [],
        coveredNavigationIds: [],
        confidence: 0.8,
      } as GeneratedTestCase["qualitySignals"],
      reviewState: "draft",
      audit: STABLE_AUDIT,
    } as GeneratedTestCase,
  ],
});

const SAMPLE_CAPTURES: ReadonlyArray<VisualSidecarCaptureInput> = [
  {
    screenId: "1:1",
    screenName: "Loan form",
    mimeType: "image/png",
    base64Data: PNG_BASE64,
  },
];

test("runA11yJudge returns mixed covered/weak/not-covered verdicts across at least four WCAG criteria", async () => {
  const figma = await loadFigma("baseline-simple-form");
  const intent = deriveBusinessTestIntentIr({ figma });
  const screenId = intent.detectedFields[0]?.screenId;
  assert.ok(screenId, "fixture must expose a form screen");
  const generatedTestCases = buildAccessibilityList(screenId);
  const criteria = buildA11yJudgeCriteria({ intent, generatedTestCases });
  assert.ok(criteria.length >= 4, "fixture must yield at least four criteria");

  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "phi-4-multimodal-instruct",
      modelRevision: "phi-4-multimodal-instruct@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
    a11yJudge: {
      role: "a11y_judge",
      deployment: "phi-4-multimodal-instruct",
      modelRevision: "phi-4-multimodal-instruct@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          criteria: criteria.map((criterion, index) => ({
            criterionId: criterion.criterionId,
            verdict:
              index === 0
                ? "covered_passes"
                : index === 1
                  ? "covered_weakly"
                  : index === 2
                    ? "not_covered"
                    : "covered_passes",
            rationale:
              index === 0
                ? "The case explicitly checks keyboard traversal and labels."
                : index === 1
                  ? "The case mentions keyboard traversal but not explicit focus visibility assertions."
                  : index === 2
                    ? "No existing case verifies announced validation errors."
                    : "The existing case is adequate for this criterion.",
            ...(index === 1
              ? {
                  repairInstruction:
                    "Add an explicit assertion that the active control shows a visible focus ring on every tab stop.",
                }
              : {}),
          })),
        },
        finishReason: "stop",
        usage: { inputTokens: 12, outputTokens: 7 },
        modelDeployment: "phi-4-multimodal-instruct",
        modelRevision: "phi-4-multimodal-instruct@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
  });

  const result = await runA11yJudge({
    jobId: "job-1940-a11y",
    generatedAt: "2026-05-06T10:00:00Z",
    intent,
    captures: SAMPLE_CAPTURES,
    generatedTestCases,
    bundle,
  });

  assert.equal(result.cacheHit, false);
  assert.equal(result.verdict.schemaVersion, A11Y_VERDICT_SCHEMA_VERSION);
  assert.equal(
    result.verdict.contractVersion,
    TEST_INTELLIGENCE_CONTRACT_VERSION,
  );
  assert.equal(
    result.verdict.promptTemplateVersion,
    A11Y_JUDGE_PROMPT_TEMPLATE_VERSION,
  );
  assert.equal(result.verdict.verdict, "repair");
  assert.equal(result.verdict.criteria.length, criteria.length);
  assert.equal(
    result.verdict.criteria.filter((criterion) => criterion.verdict === "covered_weakly")
      .length,
    1,
  );
  assert.equal(
    result.verdict.criteria.filter((criterion) => criterion.verdict === "not_covered")
      .length,
    1,
  );
  assert.equal(result.verdict.findings.length, 2);
  assert.equal(result.verdict.repairInstructions.length, 2);
  assert.match(
    result.verdict.repairInstructions[0]?.instruction ?? "",
    /focus|accessibility|assert/i,
  );
});

test("runA11yJudge skips cleanly when no a11yJudge slot is configured and preserves cache stability", async () => {
  const figma = await loadFigma("baseline-simple-form");
  const intent = deriveBusinessTestIntentIr({ figma });
  const screenId = intent.detectedFields[0]?.screenId;
  assert.ok(screenId, "fixture must expose a form screen");
  const generatedTestCases = buildAccessibilityList(screenId);

  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "phi-4-multimodal-instruct",
      modelRevision: "phi-4-multimodal-instruct@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runA11yJudge({
    jobId: "job-1940-a11y-skip",
    generatedAt: "2026-05-06T10:00:00Z",
    intent,
    captures: SAMPLE_CAPTURES,
    generatedTestCases,
    bundle,
    cache: createMemoryA11yJudgeCache(),
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.equal(result.verdict.criteria.length, 0);
  assert.equal(result.verdict.findings.length, 0);
  assert.equal(result.verdict.repairInstructions.length, 0);
  assert.equal(result.verdict.refusal?.code, "a11y_judge_unconfigured");
});
