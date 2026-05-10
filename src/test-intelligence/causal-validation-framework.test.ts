/**
 * Unit + property tests for the causal-validation framework
 * (Issue #2180). Cover deterministic pair generation, the oracle-fed
 * value variation contract, the assertion-evaluation logic, and the
 * persisted report shape.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CAUSAL_VALIDATION_REPORT_ARTIFACT_FILENAME,
  CAUSAL_VALIDATION_REPORT_SCHEMA_VERSION,
  CAUSAL_VALIDATION_TOKEN_BUDGET_RATIO_CAP,
  type GeneratedTestCase,
  type TestDesignModel,
} from "../contracts/index.js";
import {
  buildCausalHypothesisRegistry,
  semanticFieldId,
  type CausalHypothesis,
} from "./causal-hypothesis-registry.js";
import {
  assertWithinTokenBudget,
  deriveCounterfactualPairs,
  evaluateCounterfactualPairs,
  summarizeCausalCoverage,
  type CounterfactualPair,
} from "./causal-validation-framework.js";
import {
  buildActiveDatasetInvariantRegistry,
  type DomainInvariant,
} from "./domain-invariant-registry.js";

const NOW = new Date("2026-05-10T00:00:00.000Z");
const JOB_ID = "job-causal-1";
const GENERATED_AT = "2026-05-10T08:00:00.000Z";
const SEED = "issue-2180-test-seed";

const buildModel = (): TestDesignModel => ({
  schemaVersion: "1.0.0",
  jobId: JOB_ID,
  sourceHash:
    "0000000000000000000000000000000000000000000000000000000000000000",
  screens: [
    {
      screenId: "s-loan",
      name: "Loan calculator",
      elements: [
        { elementId: "e-vat", label: "VAT rate", kind: "select" },
        { elementId: "e-price", label: "Kaufpreis", kind: "number_input" },
        {
          elementId: "e-financing-need",
          label: "Finanzierungsbedarf",
          kind: "result_display",
        },
      ],
      actions: [],
      validations: [
        {
          validationId: "v-price",
          rule: "Numeric in range 1000..50000",
          targetElementId: "e-price",
        },
      ],
      calculations: [],
      visualRefs: [],
      sourceRefs: [],
    },
  ],
  businessRules: [],
  calculationConstraints: [],
  assumptions: [],
  openQuestions: [],
  riskSignals: [],
});

const buildEmptyAnchorCase = (): GeneratedTestCase => ({
  id: "tc-anchor-1",
  sourceJobId: JOB_ID,
  contractVersion: "1.30.0",
  schemaVersion: "1.3.0",
  promptTemplateVersion: "1.7.1",
  title: "Submit loan",
  objective: "Submit a loan application",
  level: "system",
  type: "functional",
  priority: "p2",
  riskCategory: "financial_transaction",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "Open the loan form" }],
  expectedResults: ["Confirmation displayed"],
  figmaTraceRefs: [{ screenId: "s-loan" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.8,
  },
  reviewState: "auto_approved",
  audit: {
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    contractVersion: "1.30.0",
    schemaVersion: "1.3.0",
    promptTemplateVersion: "1.7.1",
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: "1.1.0",
    cacheHit: false,
    cacheKey: "k",
    inputHash: "0".repeat(64),
    promptHash: "0".repeat(64),
    schemaHash: "0".repeat(64),
  },
});

const buildHypotheses = (
  invariants: readonly DomainInvariant[],
  model: TestDesignModel,
): readonly CausalHypothesis[] =>
  buildCausalHypothesisRegistry({ invariants, model });

test("deriveCounterfactualPairs: generates pairs whose values come from the oracle", async () => {
  const model = buildModel();
  const invariants = buildActiveDatasetInvariantRegistry().list();
  const hypotheses = buildHypotheses(invariants, model);
  assert.ok(hypotheses.length > 0);
  const pairs = await deriveCounterfactualPairs({
    cases: [buildEmptyAnchorCase()],
    invariants,
    model,
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    hypotheses,
    now: NOW,
    seed: SEED,
  });
  assert.ok(pairs.length > 0, "expected at least one counterfactual pair");
  for (const pair of pairs) {
    assert.notEqual(pair.causalDelta.valueA, pair.causalDelta.valueB);
    assert.equal(pair.variantA.id, `${pair.pairId}-variant-A`);
    assert.equal(pair.variantB.id, `${pair.pairId}-variant-B`);
    assert.deepEqual(
      pair.variantA.expectedResults,
      pair.variantB.expectedResults,
    );
    assert.equal(pair.variantA.preconditions.length >= 3, true);
    assert.ok(
      pair.variantA.testData.some((entry) =>
        entry.includes("synthesized"),
      ) || pair.variantA.testData.some((entry) =>
        entry.includes("from rule"),
      ),
      "variantA testData must reference oracle provenance",
    );
  }
});

test("deriveCounterfactualPairs: deterministic across replays (byte-equal)", async () => {
  const model = buildModel();
  const invariants = buildActiveDatasetInvariantRegistry().list();
  const hypotheses = buildHypotheses(invariants, model);
  const a = await deriveCounterfactualPairs({
    cases: [buildEmptyAnchorCase()],
    invariants,
    model,
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    hypotheses,
    now: NOW,
    seed: SEED,
  });
  const b = await deriveCounterfactualPairs({
    cases: [buildEmptyAnchorCase()],
    invariants,
    model,
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    hypotheses,
    now: NOW,
    seed: SEED,
  });
  assert.deepEqual(a, b);
});

test("deriveCounterfactualPairs: different seeds produce different pairIds", async () => {
  const model = buildModel();
  const invariants = buildActiveDatasetInvariantRegistry().list();
  const hypotheses = buildHypotheses(invariants, model);
  const a = await deriveCounterfactualPairs({
    cases: [buildEmptyAnchorCase()],
    invariants,
    model,
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    hypotheses,
    now: NOW,
    seed: "seed-A",
  });
  const b = await deriveCounterfactualPairs({
    cases: [buildEmptyAnchorCase()],
    invariants,
    model,
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    hypotheses,
    now: NOW,
    seed: "seed-B",
  });
  assert.equal(a.length, b.length);
  assert.notEqual(a[0]?.pairId, b[0]?.pairId);
});

test("deriveCounterfactualPairs: rejects empty seed", async () => {
  const model = buildModel();
  const invariants = buildActiveDatasetInvariantRegistry().list();
  const hypotheses = buildHypotheses(invariants, model);
  await assert.rejects(
    deriveCounterfactualPairs({
      cases: [],
      invariants,
      model,
      jobId: JOB_ID,
      generatedAt: GENERATED_AT,
      hypotheses,
      now: NOW,
      seed: "  ",
    }),
    /seed must be a non-empty string/,
  );
});

test("deriveCounterfactualPairs: skips hypotheses whose cause field has no oracle-resolvable validation", async () => {
  const model = buildModel();
  // VAT field has no validation rules → INV-VAT-01 hypothesis is skipped.
  const invariants = buildActiveDatasetInvariantRegistry().list();
  const hypotheses = buildHypotheses(invariants, model);
  const pairs = await deriveCounterfactualPairs({
    cases: [],
    invariants,
    model,
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    hypotheses,
    now: NOW,
    seed: SEED,
  });
  // Only the price → financing-need hypothesis (INV-FINANCING-NEED-01) has
  // a resolvable validation rule.
  assert.ok(
    pairs.every((p) => p.hypothesisId === "H-INV-FINANCING-NEED-01-001"),
    "VAT hypothesis must be skipped when cause field has no validation rule",
  );
});

test("deriveCounterfactualPairs: respects maxPairsPerHypothesis cap", async () => {
  const model = buildModel();
  const invariants = buildActiveDatasetInvariantRegistry().list();
  const hypotheses = buildHypotheses(invariants, model);
  const pairs = await deriveCounterfactualPairs({
    cases: [],
    invariants,
    model,
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    hypotheses,
    now: NOW,
    seed: SEED,
    maxPairsPerHypothesis: 1,
  });
  // The price hypothesis can produce up to 5 pairs from BVA values; with
  // cap=1 we expect exactly one pair per resolved hypothesis.
  for (const hypothesisId of new Set(pairs.map((p) => p.hypothesisId))) {
    const count = pairs.filter((p) => p.hypothesisId === hypothesisId).length;
    assert.equal(count, 1);
  }
});

test("evaluateCounterfactualPairs: empty pair list yields zeroed report with correct shape", () => {
  const report = evaluateCounterfactualPairs({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    hypotheses: [],
    pairs: [],
  });
  assert.equal(report.schemaVersion, CAUSAL_VALIDATION_REPORT_SCHEMA_VERSION);
  assert.equal(
    report.artifactFilename,
    CAUSAL_VALIDATION_REPORT_ARTIFACT_FILENAME,
  );
  assert.equal(report.tokenBudgetRatioCap, CAUSAL_VALIDATION_TOKEN_BUDGET_RATIO_CAP);
  assert.equal(report.hypothesesEvaluated, 0);
  assert.equal(report.pairsGenerated, 0);
  assert.equal(report.pairsViolated, 0);
  assert.equal(report.causalCoverageRatio, 0);
  assert.deepEqual(report.hypotheses, []);
  assert.deepEqual(report.pairs, []);
});

test("evaluateCounterfactualPairs: counts no-effect violations when valueA == valueB", () => {
  const hypothesis: CausalHypothesis = {
    hypothesisId: "H-MANUAL-001",
    cause: semanticFieldId("s-loan", "e-vat"),
    effect: semanticFieldId("s-loan", "e-financing-need"),
    relationship: "no-effect",
    source: { kind: "operator-declared", declaredAt: "2026-05-10T08:00:00.000Z" },
  };
  const variantA = buildEmptyAnchorCase();
  const variantB = { ...buildEmptyAnchorCase(), id: "tc-anchor-2" };
  const violatingPair: CounterfactualPair = {
    pairId: "cf-test-001",
    hypothesisId: hypothesis.hypothesisId,
    variantA,
    variantB,
    causalDelta: {
      fieldId: hypothesis.cause,
      valueA: "19",
      valueB: "19", // same — no counterfactual delta → violation
    },
    expectedEffectInvariant: "Financing-need is identical across A and B.",
  };
  const report = evaluateCounterfactualPairs({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    hypotheses: [hypothesis],
    pairs: [violatingPair],
  });
  assert.equal(report.pairsGenerated, 1);
  assert.equal(report.pairsViolated, 1);
  assert.equal(report.causalCoverageRatio, 0);
  assert.equal(report.hypotheses[0]?.satisfied, false);
});

test("evaluateCounterfactualPairs: round-trips coverage ratio to six decimals", () => {
  const hypothesis: CausalHypothesis = {
    hypothesisId: "H-MANUAL-002",
    cause: semanticFieldId("s-loan", "e-vat"),
    effect: semanticFieldId("s-loan", "e-financing-need"),
    relationship: "no-effect",
    source: { kind: "operator-declared", declaredAt: "2026-05-10T08:00:00.000Z" },
  };
  const variantA = buildEmptyAnchorCase();
  const variantB = { ...buildEmptyAnchorCase(), id: "tc-anchor-2" };
  const pairs: CounterfactualPair[] = [];
  // 7 satisfying pairs + 0 violating pairs (no-effect satisfied iff valueA != valueB).
  for (let i = 0; i < 7; i += 1) {
    pairs.push({
      pairId: `cf-test-${String(i).padStart(3, "0")}`,
      hypothesisId: hypothesis.hypothesisId,
      variantA,
      variantB,
      causalDelta: {
        fieldId: hypothesis.cause,
        valueA: "19",
        valueB: `${i + 1}`,
      },
      expectedEffectInvariant: "Financing-need is identical across A and B.",
    });
  }
  const report = evaluateCounterfactualPairs({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    hypotheses: [hypothesis],
    pairs,
  });
  assert.equal(report.pairsGenerated, 7);
  assert.equal(report.pairsViolated, 0);
  assert.equal(report.causalCoverageRatio, 1);
});

test("summarizeCausalCoverage: projects to the policy-report KPI block", async () => {
  const model = buildModel();
  const invariants = buildActiveDatasetInvariantRegistry().list();
  const hypotheses = buildHypotheses(invariants, model);
  const pairs = await deriveCounterfactualPairs({
    cases: [buildEmptyAnchorCase()],
    invariants,
    model,
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    hypotheses,
    now: NOW,
    seed: SEED,
  });
  const report = evaluateCounterfactualPairs({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    hypotheses,
    pairs,
  });
  const summary = summarizeCausalCoverage(report);
  assert.equal(summary.artifactFilename, report.artifactFilename);
  assert.equal(summary.hypothesesEvaluated, report.hypothesesEvaluated);
  assert.equal(summary.pairsGenerated, report.pairsGenerated);
  assert.equal(summary.pairsViolated, report.pairsViolated);
  assert.equal(summary.causalCoverageRatio, report.causalCoverageRatio);
});

test("assertWithinTokenBudget: zero additional tokens always fits", () => {
  const result = assertWithinTokenBudget({
    baselineTokens: 100_000,
    additionalTokens: 0,
  });
  assert.equal(result.withinBudget, true);
  assert.equal(result.ratio, 0);
});

test("assertWithinTokenBudget: enforces the configured cap", () => {
  const result = assertWithinTokenBudget({
    baselineTokens: 100,
    additionalTokens: 31, // > 30%
  });
  assert.equal(result.withinBudget, false);
  assert.equal(result.ratio, 0.31);
});

test("assertWithinTokenBudget: zero baseline + non-zero additional fails closed", () => {
  const result = assertWithinTokenBudget({
    baselineTokens: 0,
    additionalTokens: 1,
  });
  assert.equal(result.withinBudget, false);
});
