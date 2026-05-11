import assert from "node:assert/strict";
import test from "node:test";

import {
  FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  FAITHFULNESS_TIER_REPORT_SCHEMA_VERSION,
  FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type FaithfulnessVerdict,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import {
  buildFaithfulnessTierReport,
  classifyFaithfulnessStepTier,
  stepPassesTierThreshold,
} from "./faithfulness-tier-report.js";

const ZERO = "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-05-08T18:17:37.630Z";

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Open the form and submit",
  objective: "Submit form",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [
    { index: 1, action: "Open the form" },
    { index: 2, action: "Submit", expected: "Receipt rendered" },
  ],
  expectedResults: ["Receipt rendered"],
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
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: "1.0.0",
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

const buildVerdict = (
  overrides: Partial<FaithfulnessVerdict> = {},
): FaithfulnessVerdict => ({
  schemaVersion: FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
  cacheHit: false,
  cacheKeyDigest: ZERO,
  modelDeployment: "llama-4-maverick-vision",
  modelRevision: "llama-4-maverick-vision@test",
  gatewayRelease: "mock",
  fallbackReason: "none",
  score: 0,
  verdict: "accept",
  hallucinations: [],
  mismatches: [],
  ...overrides,
});

test("classifyFaithfulnessStepTier flags numeric data as concrete_data", () => {
  const tier = classifyFaithfulnessStepTier({
    index: 1,
    action: "Enter amount",
    data: "100",
  });
  assert.equal(tier.tier, "concrete_data");
  assert.match(tier.tierReason, /numeric/u);
});

test("classifyFaithfulnessStepTier flags label-only steps without data", () => {
  const tier = classifyFaithfulnessStepTier({
    index: 1,
    action: "Open the form",
  });
  assert.equal(tier.tier, "label_only");
});

test("stepPassesTierThreshold enforces label_only `match` strictness", () => {
  assert.equal(stepPassesTierThreshold("label_only", "match"), true);
  assert.equal(
    stepPassesTierThreshold("label_only", "evidence_partial"),
    true,
  );
  assert.equal(stepPassesTierThreshold("label_only", "mismatch"), false);
});

test("stepPassesTierThreshold enforces concrete_data 0.80 floor", () => {
  assert.equal(stepPassesTierThreshold("concrete_data", "match"), true);
  assert.equal(
    stepPassesTierThreshold("concrete_data", "evidence_partial"),
    true,
  );
  assert.equal(stepPassesTierThreshold("concrete_data", "mismatch"), false);
});

test("buildFaithfulnessTierReport aggregates evidence_partial above 0.80", () => {
  const list = buildList([
    buildCase({
      steps: [
        { index: 1, action: "Open the form" },
        { index: 2, action: "See the welcome heading" },
      ],
    }),
  ]);
  const verdict = buildVerdict({
    stepVerdicts: [
      {
        testCaseId: "tc-1",
        stepIndex: 1,
        verdict: "evidence_partial",
        message: "label visible; description below the fold",
      },
      {
        testCaseId: "tc-1",
        stepIndex: 2,
        verdict: "evidence_partial",
        message: "heading visible; supporting copy below the fold",
      },
    ],
  });
  const report = buildFaithfulnessTierReport({
    generatedAt: GENERATED_AT,
    jobId: "job-1",
    verdict,
    list,
  });
  assert.equal(report.schemaVersion, FAITHFULNESS_TIER_REPORT_SCHEMA_VERSION);
  assert.equal(report.aggregateScore, 0.85);
  assert.equal(report.aggregatePasses, true);
  assert.equal(report.evidencePartialCount, 2);
  assert.equal(report.matchCount, 0);
  assert.equal(report.mismatchCount, 0);
  for (const entry of report.entries) {
    assert.equal(entry.tier, "label_only");
    assert.equal(entry.passesThreshold, true);
  }
});

test("buildFaithfulnessTierReport tags concrete-data steps and rejects mismatches", () => {
  const list = buildList([
    buildCase({
      steps: [
        { index: 1, action: "Enter amount", data: "100", expected: "Field accepts" },
      ],
    }),
  ]);
  const verdict = buildVerdict({
    stepVerdicts: [
      {
        testCaseId: "tc-1",
        stepIndex: 1,
        verdict: "mismatch",
        message: "amount field rendered red instead of accepted",
      },
    ],
  });
  const report = buildFaithfulnessTierReport({
    generatedAt: GENERATED_AT,
    jobId: "job-1",
    verdict,
    list,
  });
  assert.equal(report.aggregateScore, 0);
  assert.equal(report.aggregatePasses, false);
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0]?.tier, "concrete_data");
  assert.equal(report.entries[0]?.passesThreshold, false);
});

test("buildFaithfulnessTierReport defaults absent step verdicts to match", () => {
  const list = buildList([
    buildCase({
      steps: [
        { index: 1, action: "Open the form" },
        { index: 2, action: "Submit" },
      ],
    }),
  ]);
  // Only step 1 has a verdict; step 2 should default to `match`.
  const verdict = buildVerdict({
    stepVerdicts: [
      {
        testCaseId: "tc-1",
        stepIndex: 1,
        verdict: "evidence_partial",
        message: "label visible",
      },
    ],
  });
  const report = buildFaithfulnessTierReport({
    generatedAt: GENERATED_AT,
    jobId: "job-1",
    verdict,
    list,
  });
  assert.equal(report.entries.length, 2);
  assert.equal(report.entries[0]?.verdict, "evidence_partial");
  assert.equal(report.entries[1]?.verdict, "match");
  // (0.85 + 1) / 2 = 0.925
  assert.equal(report.aggregateScore, 0.925);
  assert.equal(report.aggregatePasses, true);
});

test("buildFaithfulnessTierReport refuses to build from a refused verdict", () => {
  const list = buildList([buildCase({})]);
  const verdict = buildVerdict({
    verdict: "reject",
    refusal: { code: "schema_invalid_response", message: "schema invalid" },
  });
  assert.throws(
    () =>
      buildFaithfulnessTierReport({
        generatedAt: GENERATED_AT,
        jobId: "job-1",
        verdict,
        list,
      }),
    /refused verdict/u,
  );
});

test("buildFaithfulnessTierReport unblocks K0-shape: five label-only evidence_partial steps clear 0.80", () => {
  const list = buildList([
    buildCase({
      steps: [
        { index: 1, action: "Open the loan application" },
        { index: 2, action: "See introductory paragraph" },
        { index: 3, action: "Confirm the disclosure copy is displayed" },
        { index: 4, action: "Read the privacy notice" },
        { index: 5, action: "See the success message" },
      ],
    }),
  ]);
  const verdict = buildVerdict({
    stepVerdicts: [1, 2, 3, 4, 5].map((stepIndex) => ({
      testCaseId: "tc-1",
      stepIndex,
      verdict: "evidence_partial" as const,
      message: "label matches; description not fully visible in screenshot",
    })),
  });
  const report = buildFaithfulnessTierReport({
    generatedAt: GENERATED_AT,
    jobId: "job-1",
    verdict,
    list,
  });
  assert.ok(
    report.aggregateScore >= 0.8,
    `aggregateScore ${report.aggregateScore} should clear the 0.80 floor`,
  );
  assert.equal(report.aggregatePasses, true);
});

test("Issue #2170: classifyFaithfulnessStepTier promotes label-only steps of a state_transition case to the state_transition tier", () => {
  const tier = classifyFaithfulnessStepTier(
    { index: 1, action: "Move to confirmation step" },
    "state_transition",
  );
  assert.equal(tier.tier, "state_transition");
  assert.match(tier.tierReason, /state_transition technique/u);
});

test("Issue #2170: classifyFaithfulnessStepTier keeps concrete-data steps strict even on a state_transition case", () => {
  const tier = classifyFaithfulnessStepTier(
    { index: 1, action: "Enter amount", data: "250" },
    "state_transition",
  );
  assert.equal(tier.tier, "concrete_data");
});

test("Issue #2170: state_transition tier accepts evidence_partial at the 0.65 floor", () => {
  assert.equal(stepPassesTierThreshold("state_transition", "match"), true);
  assert.equal(
    stepPassesTierThreshold("state_transition", "evidence_partial"),
    true,
    "evidence_partial (0.85) clears the state_transition 0.65 floor",
  );
  assert.equal(
    stepPassesTierThreshold("state_transition", "mismatch"),
    false,
  );
});

test("Issue #2170: label_only evidence_partial threshold tightens to 0.85", () => {
  // The verdict score for evidence_partial is 0.85 — exactly at the
  // tightened threshold, so it still passes.
  assert.equal(
    stepPassesTierThreshold("label_only", "evidence_partial"),
    true,
  );
});

test("Issue #2170: tier report flags partial-majority cases at >= 60 % evidence_partial", () => {
  const list = buildList([
    buildCase({
      id: "tc-majority",
      steps: [
        { index: 1, action: "Open the form" },
        { index: 2, action: "See the welcome heading" },
        { index: 3, action: "See the disclosure copy" },
        { index: 4, action: "Submit the form", expected: "Receipt rendered" },
      ],
    }),
    buildCase({
      id: "tc-minority",
      steps: [
        { index: 1, action: "Open the dashboard" },
        { index: 2, action: "See the balance heading" },
      ],
    }),
  ]);
  const verdict = buildVerdict({
    stepVerdicts: [
      // tc-majority: 3/4 evidence_partial = 75 % → flagged.
      { testCaseId: "tc-majority", stepIndex: 1, verdict: "evidence_partial", message: "label visible" },
      { testCaseId: "tc-majority", stepIndex: 2, verdict: "evidence_partial", message: "heading visible" },
      { testCaseId: "tc-majority", stepIndex: 3, verdict: "evidence_partial", message: "disclosure visible" },
      { testCaseId: "tc-majority", stepIndex: 4, verdict: "match", message: "receipt visible" },
      // tc-minority: 1/2 evidence_partial = 50 % → NOT flagged.
      { testCaseId: "tc-minority", stepIndex: 1, verdict: "match", message: "dashboard rendered" },
      { testCaseId: "tc-minority", stepIndex: 2, verdict: "evidence_partial", message: "heading visible" },
    ],
  });
  const report = buildFaithfulnessTierReport({
    generatedAt: GENERATED_AT,
    jobId: "job-1",
    verdict,
    list,
  });
  assert.deepEqual(report.partialMajorityCaseIds, ["tc-majority"]);
});

test("Issue #2170: tier report partialMajorityCaseIds is sorted ascending by id", () => {
  const list = buildList([
    buildCase({
      id: "tc-zeta",
      steps: [{ index: 1, action: "Open zeta" }],
    }),
    buildCase({
      id: "tc-alpha",
      steps: [{ index: 1, action: "Open alpha" }],
    }),
  ]);
  const verdict = buildVerdict({
    stepVerdicts: [
      { testCaseId: "tc-zeta", stepIndex: 1, verdict: "evidence_partial", message: "z" },
      { testCaseId: "tc-alpha", stepIndex: 1, verdict: "evidence_partial", message: "a" },
    ],
  });
  const report = buildFaithfulnessTierReport({
    generatedAt: GENERATED_AT,
    jobId: "job-1",
    verdict,
    list,
  });
  assert.deepEqual(report.partialMajorityCaseIds, ["tc-alpha", "tc-zeta"]);
});

test("Issue #2170: state_transition case with evidence_partial steps still clears the 0.80 aggregate floor", () => {
  const list = buildList([
    buildCase({
      id: "tc-workflow",
      technique: "state_transition",
      steps: [
        { index: 1, action: "Begin enrolment workflow" },
        { index: 2, action: "Move to KYC step" },
        { index: 3, action: "Complete enrolment" },
      ],
    }),
  ]);
  const verdict = buildVerdict({
    stepVerdicts: [
      { testCaseId: "tc-workflow", stepIndex: 1, verdict: "evidence_partial", message: "intermediate frame" },
      { testCaseId: "tc-workflow", stepIndex: 2, verdict: "evidence_partial", message: "intermediate frame" },
      { testCaseId: "tc-workflow", stepIndex: 3, verdict: "match", message: "final frame visible" },
    ],
  });
  const report = buildFaithfulnessTierReport({
    generatedAt: GENERATED_AT,
    jobId: "job-1",
    verdict,
    list,
  });
  assert.equal(report.aggregatePasses, true);
  for (const entry of report.entries) {
    assert.equal(entry.tier, "state_transition");
    assert.equal(entry.passesThreshold, true);
  }
});

test("Issue #2116: persisted tier report carries evaluationMode='per_step'", () => {
  const list = buildList([
    buildCase({
      steps: [
        {
          index: 1,
          action: "Enter amount",
          data: "100",
          expected: "Field accepts",
        },
        { index: 2, action: "See receipt" },
      ],
    }),
  ]);
  const verdict = buildVerdict({
    stepVerdicts: [
      {
        testCaseId: "tc-1",
        stepIndex: 1,
        verdict: "match",
        message: "amount accepted",
      },
      {
        testCaseId: "tc-1",
        stepIndex: 2,
        verdict: "match",
        message: "receipt visible",
      },
    ],
  });
  const report = buildFaithfulnessTierReport({
    generatedAt: GENERATED_AT,
    jobId: "job-1",
    verdict,
    list,
  });
  assert.equal(
    report.evaluationMode,
    "per_step",
    "tier reports are only built for per-step runs; the field pins that fact onto the artifact",
  );
});
