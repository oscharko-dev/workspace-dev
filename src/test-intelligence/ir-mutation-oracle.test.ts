import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_DESIGN_MODEL_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type TestDesignModel,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  computeIrMutationCoverageStrength,
  IR_MUTATION_COVERAGE_STRENGTH_REPORT_ARTIFACT_FILENAME,
  IR_MUTATION_COVERAGE_STRENGTH_REPORT_SCHEMA_VERSION,
  writeIrMutationCoverageStrengthArtifact,
} from "./ir-mutation-oracle.js";

const ZERO_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-05-03T12:00:00.000Z";

const buildModel = (): TestDesignModel => ({
  schemaVersion: TEST_DESIGN_MODEL_SCHEMA_VERSION,
  jobId: "job-1783",
  sourceHash: ZERO_HASH,
  screens: [
    {
      screenId: "quote",
      name: "Quote",
      elements: [
        { elementId: "email", label: "Email", kind: "text" },
        { elementId: "amount", label: "Amount", kind: "number" },
        { elementId: "customer-type", label: "Customer Type", kind: "text" },
        { elementId: "credit-score", label: "Credit Score", kind: "number" },
      ],
      actions: [
        {
          actionId: "continue",
          label: "Continue",
          kind: "submit",
          targetScreenId: "summary",
        },
      ],
      validations: [
        {
          validationId: "email-required",
          rule: "Email is required",
          targetElementId: "email",
        },
        {
          validationId: "amount-range",
          rule: "Amount must be between 100 and 10000",
          targetElementId: "amount",
        },
      ],
      calculations: [
        {
          calculationId: "manual-review-decision",
          name: "Manual Review Decision",
          inputElementIds: ["credit-score", "amount"],
        },
      ],
      visualRefs: ["visual:quote:form"],
      sourceRefs: ["figma-quote"],
    },
    {
      screenId: "summary",
      name: "Summary",
      elements: [{ elementId: "status", label: "Status", kind: "text" }],
      actions: [],
      validations: [],
      calculations: [],
      visualRefs: ["visual:summary:status"],
      sourceRefs: ["figma-summary"],
    },
  ],
  businessRules: [
    {
      ruleId: "customer-type-class",
      description: "Customer Type: Accept retail or business applicants",
      screenId: "quote",
      sourceRefs: ["jira-quote"],
    },
  ],
  assumptions: [],
  openQuestions: [],
  riskSignals: [],
});

const buildCase = (
  id: string,
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id,
  sourceJobId: "job-1783",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Generated case",
  objective: "Exercise the quote flow",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "medium",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "Open quote screen" }],
  expectedResults: ["Quote screen is visible"],
  figmaTraceRefs: [{ screenId: "quote" }],
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
    jobId: "job-1783",
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: "1.0.0",
    cacheHit: false,
    cacheKey: id,
    inputHash: ZERO_HASH,
    promptHash: ZERO_HASH,
    schemaHash: ZERO_HASH,
  },
  ...overrides,
});

const buildList = (testCases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1783",
  testCases,
});

test("computeIrMutationCoverageStrength covers all five mutation kinds deterministically", () => {
  const report = computeIrMutationCoverageStrength({
    model: buildModel(),
    list: buildList([
      buildCase("tc-required", {
        type: "validation",
        title: "Reject missing email",
        objective: "Verify the Email field stays required",
        testData: ["Submit without email"],
        expectedResults: ["A required error is shown for Email"],
        qualitySignals: {
          coveredFieldIds: ["email"],
          coveredActionIds: [],
          coveredValidationIds: ["email-required"],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
      buildCase("tc-boundary", {
        type: "boundary",
        technique: "boundary_value_analysis",
        title: "Reject amount below minimum",
        testData: ["Amount = 99"],
        expectedResults: ["Amount must stay within the allowed range"],
        qualitySignals: {
          coveredFieldIds: ["amount"],
          coveredActionIds: [],
          coveredValidationIds: ["amount-range"],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
      buildCase("tc-transition", {
        type: "navigation",
        title: "Continue navigates to summary",
        steps: [
          { index: 1, action: "Open quote screen" },
          { index: 2, action: "Click Continue" },
        ],
        expectedResults: ["Summary screen is shown after Continue"],
        qualitySignals: {
          coveredFieldIds: [],
          coveredActionIds: ["continue"],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
      buildCase("tc-equivalence", {
        type: "negative",
        technique: "equivalence_partitioning",
        title: "Reject unsupported customer type",
        testData: ["Customer Type = VIP"],
        expectedResults: ["Unsupported customer type is rejected"],
        qualitySignals: {
          coveredFieldIds: ["customer-type"],
          coveredActionIds: [],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
      buildCase("tc-decision", {
        type: "functional",
        technique: "decision_table",
        title: "Route low credit score to manual review",
        testData: ["Credit Score = 400", "Amount = 9000"],
        expectedResults: ["Manual review decision is triggered"],
        qualitySignals: {
          coveredFieldIds: ["credit-score", "amount"],
          coveredActionIds: [],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
    ]),
  });

  assert.equal(report.schemaVersion, IR_MUTATION_COVERAGE_STRENGTH_REPORT_SCHEMA_VERSION);
  assert.equal(report.mutationCount, 5);
  assert.equal(report.killedMutations, 5);
  assert.equal(report.mutationKillRate, 1);
  const killedByKind = new Map(
    report.perMutation.map((mutation) => [
      mutation.mutationKind,
      mutation.killedByTestCaseIds,
    ]),
  );
  assert.deepEqual(
    [...killedByKind.keys()].sort(),
    [
      "drop_state_transition",
      "flip_required",
      "invert_decision_rule",
      "shrink_boundary",
      "swap_equivalence_class",
    ],
  );
  assert.deepEqual(killedByKind.get("drop_state_transition"), ["tc-transition"]);
  assert.deepEqual(killedByKind.get("flip_required"), ["tc-required"]);
  assert.deepEqual(killedByKind.get("invert_decision_rule"), ["tc-decision"]);
  assert.deepEqual(killedByKind.get("shrink_boundary"), ["tc-boundary"]);
  assert.deepEqual(killedByKind.get("swap_equivalence_class"), ["tc-equivalence"]);
  assert.deepEqual(report.survivingMutationsForRepair, []);

  const second = computeIrMutationCoverageStrength({
    model: buildModel(),
    list: buildList([
      buildCase("tc-required", {
        type: "validation",
        title: "Reject missing email",
        objective: "Verify the Email field stays required",
        testData: ["Submit without email"],
        expectedResults: ["A required error is shown for Email"],
        qualitySignals: {
          coveredFieldIds: ["email"],
          coveredActionIds: [],
          coveredValidationIds: ["email-required"],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
      buildCase("tc-boundary", {
        type: "boundary",
        technique: "boundary_value_analysis",
        title: "Reject amount below minimum",
        testData: ["Amount = 99"],
        expectedResults: ["Amount must stay within the allowed range"],
        qualitySignals: {
          coveredFieldIds: ["amount"],
          coveredActionIds: [],
          coveredValidationIds: ["amount-range"],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
      buildCase("tc-transition", {
        type: "navigation",
        title: "Continue navigates to summary",
        steps: [
          { index: 1, action: "Open quote screen" },
          { index: 2, action: "Click Continue" },
        ],
        expectedResults: ["Summary screen is shown after Continue"],
        qualitySignals: {
          coveredFieldIds: [],
          coveredActionIds: ["continue"],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
      buildCase("tc-equivalence", {
        type: "negative",
        technique: "equivalence_partitioning",
        title: "Reject unsupported customer type",
        testData: ["Customer Type = VIP"],
        expectedResults: ["Unsupported customer type is rejected"],
        qualitySignals: {
          coveredFieldIds: ["customer-type"],
          coveredActionIds: [],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
      buildCase("tc-decision", {
        type: "functional",
        technique: "decision_table",
        title: "Route low credit score to manual review",
        testData: ["Credit Score = 400", "Amount = 9000"],
        expectedResults: ["Manual review decision is triggered"],
        qualitySignals: {
          coveredFieldIds: ["credit-score", "amount"],
          coveredActionIds: [],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
    ]),
  });
  assert.deepEqual(second, report);
  assert.equal(canonicalJson(second), canonicalJson(report));
});

test("computeIrMutationCoverageStrength treats navigation-only coverage as a transition kill", () => {
  const report = computeIrMutationCoverageStrength({
    model: buildModel(),
    list: buildList([
      buildCase("tc-navigation-only", {
        type: "navigation",
        title: "Continue navigates to summary",
        qualitySignals: {
          coveredFieldIds: [],
          coveredActionIds: [],
          coveredValidationIds: [],
          coveredNavigationIds: ["quote::nav::continue::summary"],
          confidence: 0.9,
        },
      }),
    ]),
  });

  const transitionMutation = report.perMutation.find(
    (mutation) => mutation.mutationKind === "drop_state_transition",
  );
  assert.deepEqual(transitionMutation?.killedByTestCaseIds, [
    "tc-navigation-only",
  ]);
});

test("computeIrMutationCoverageStrength does not kill by substring-only token overlap", () => {
  const report = computeIrMutationCoverageStrength({
    model: buildModel(),
    list: buildList([
      buildCase("tc-substring-trap", {
        type: "negative",
        technique: "equivalence_partitioning",
        title: "Prototype screen stays valid",
        objective: "Exercise a generic prototype flow",
        testData: ["Segment = enterprise"],
        expectedResults: ["Prototype remains visible"],
        qualitySignals: {
          coveredFieldIds: ["customer-type"],
          coveredActionIds: [],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
    ]),
  });

  const equivalenceMutation = report.perMutation.find(
    (mutation) => mutation.mutationKind === "swap_equivalence_class",
  );
  assert.deepEqual(equivalenceMutation?.killedByTestCaseIds, []);
});

test("computeIrMutationCoverageStrength surfaces surviving mutations for repair when three cases kill none", () => {
  const report = computeIrMutationCoverageStrength({
    model: buildModel(),
    list: buildList([
      buildCase("tc-generic-1", {
        title: "Open quote screen",
        objective: "Baseline smoke coverage",
      }),
      buildCase("tc-generic-2", {
        title: "Enter contact details",
        objective: "Capture customer details",
        qualitySignals: {
          coveredFieldIds: ["email"],
          coveredActionIds: [],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
      buildCase("tc-generic-3", {
        title: "Submit quote",
        objective: "Complete the happy path",
        qualitySignals: {
          coveredFieldIds: ["amount", "credit-score"],
          coveredActionIds: ["continue"],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
    ]),
  });

  assert.equal(report.mutationCount, 5);
  assert.equal(report.killedMutations, 0);
  assert.equal(report.mutationKillRate, 0);
  assert.equal(report.survivingMutationsForRepair.length, 5);
  assert.deepEqual(
    report.perMutation.map((mutation) => mutation.killedByTestCaseIds),
    [[], [], [], [], []],
  );
});

test("writeIrMutationCoverageStrengthArtifact persists canonical bytes", async () => {
  const report = computeIrMutationCoverageStrength({
    model: buildModel(),
    list: buildList([]),
  });
  const tmpDir = await mkdtemp(join(tmpdir(), "ir-mutation-oracle-"));
  try {
    const written = await writeIrMutationCoverageStrengthArtifact({
      report,
      runDir: tmpDir,
    });
    assert.equal(
      written.artifactPath,
      join(tmpDir, IR_MUTATION_COVERAGE_STRENGTH_REPORT_ARTIFACT_FILENAME),
    );
    const raw = await readFile(written.artifactPath, "utf8");
    assert.equal(raw, canonicalJson(report));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
