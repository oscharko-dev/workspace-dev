import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type VisualScreenDescription,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { runValidationPipeline } from "./validation-pipeline.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");
const INTENT_PATH = join(
  FIXTURES_DIR,
  "simple-form.expected.business-intent-ir.json",
);
const VISUAL_PATH = join(FIXTURES_DIR, "simple-form.visual.json");
const EXPECTED_VALIDATION = join(
  FIXTURES_DIR,
  "issue-1364.expected.validation-report.json",
);
const EXPECTED_POLICY = join(
  FIXTURES_DIR,
  "issue-1364.expected.policy-report.json",
);
const EXPECTED_COVERAGE = join(
  FIXTURES_DIR,
  "issue-1364.expected.coverage-report.json",
);
const EXPECTED_VISUAL = join(
  FIXTURES_DIR,
  "issue-1364.expected.visual-sidecar-validation-report.json",
);

const APPROVE =
  process.env["FIGMAPIPE_TEST_INTELLIGENCE_GOLDEN_APPROVE"] === "1";
const ZERO = "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const baseCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: overrides.id ?? "tc",
  sourceJobId: "job-issue-1364",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: overrides.title ?? "Pay with valid IBAN",
  objective: overrides.objective ?? "Submit the payment form successfully",
  level: overrides.level ?? "system",
  type: overrides.type ?? "functional",
  priority: overrides.priority ?? "p1",
  riskCategory: overrides.riskCategory ?? "financial_transaction",
  technique: overrides.technique ?? "use_case",
  preconditions: overrides.preconditions ?? ["Test data: [REDACTED:IBAN]"],
  testData: overrides.testData ?? ["[REDACTED:IBAN]"],
  steps: overrides.steps ?? [
    { index: 1, action: "Open the Payment Details screen" },
    {
      index: 2,
      action: "Submit the form",
      expected: "Confirmation screen is displayed",
    },
  ],
  expectedResults: overrides.expectedResults ?? [
    "Confirmation screen is displayed",
  ],
  figmaTraceRefs: overrides.figmaTraceRefs ?? [{ screenId: "s-payment" }],
  assumptions: overrides.assumptions ?? [],
  openQuestions: overrides.openQuestions ?? [],
  qcMappingPreview: overrides.qcMappingPreview ?? { exportable: true },
  qualitySignals: overrides.qualitySignals ?? {
    coveredFieldIds: ["s-payment::field::n-iban"],
    coveredActionIds: ["s-payment::action::n-submit"],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.92,
  },
  reviewState: overrides.reviewState ?? "draft",
  audit: {
    jobId: "job-issue-1364",
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: "1.0.0",
    cacheHit: false,
    cacheKey: "fixture-key",
    inputHash: ZERO,
    promptHash: ZERO,
    schemaHash: ZERO,
  },
});

const buildList = (): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-issue-1364",
  testCases: [
    baseCase({
      id: "tc-positive",
      type: "functional",
      title: "Pay with valid IBAN",
    }),
    baseCase({
      id: "tc-negative",
      type: "negative",
      title: "Reject empty IBAN",
      qualitySignals: {
        coveredFieldIds: ["s-payment::field::n-iban"],
        coveredActionIds: ["s-payment::action::n-submit"],
        coveredValidationIds: ["s-payment::validation::n-iban::Required"],
        coveredNavigationIds: [],
        confidence: 0.9,
      },
    }),
    baseCase({
      id: "tc-validation",
      type: "validation",
      title: "Validate IBAN required rule",
      qualitySignals: {
        coveredFieldIds: ["s-payment::field::n-iban"],
        coveredActionIds: [],
        coveredValidationIds: ["s-payment::validation::n-iban::Required"],
        coveredNavigationIds: [],
        confidence: 0.9,
      },
    }),
    baseCase({
      id: "tc-boundary",
      type: "boundary",
      title: "IBAN length boundary",
      qualitySignals: {
        coveredFieldIds: ["s-payment::field::n-iban"],
        coveredActionIds: [],
        coveredValidationIds: [],
        coveredNavigationIds: [],
        confidence: 0.9,
      },
    }),
    baseCase({
      id: "tc-workflow",
      type: "navigation",
      title: "Submit and navigate to receipt",
    }),
    baseCase({
      id: "tc-a11y",
      type: "accessibility",
      title: "Form is keyboard accessible",
    }),
  ],
});

const updateOrAssert = async (path: string, actual: string): Promise<void> => {
  if (APPROVE) {
    await writeFile(path, `${actual}\n`, "utf8");
    return;
  }
  const expected = (await readFile(path, "utf8")).trimEnd();
  assert.equal(actual, expected, `golden mismatch at ${path}`);
};

test("golden: pipeline produces stable validation/policy/coverage/visual reports", async () => {
  const intent = JSON.parse(
    await readFile(INTENT_PATH, "utf8"),
  ) as BusinessTestIntentIr;
  const visual = JSON.parse(
    await readFile(VISUAL_PATH, "utf8"),
  ) as VisualScreenDescription[];

  const artifacts = runValidationPipeline({
    jobId: "job-issue-1364",
    generatedAt: GENERATED_AT,
    list: buildList(),
    intent,
    visual,
    primaryVisualDeployment: "llama-4-maverick-vision",
  });

  await updateOrAssert(
    EXPECTED_VALIDATION,
    canonicalJson(artifacts.validation),
  );
  await updateOrAssert(EXPECTED_POLICY, canonicalJson(artifacts.policy));
  await updateOrAssert(EXPECTED_COVERAGE, canonicalJson(artifacts.coverage));
  assert.notEqual(artifacts.visual, undefined);
  await updateOrAssert(EXPECTED_VISUAL, canonicalJson(artifacts.visual));
});
