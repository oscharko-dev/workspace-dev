import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import fc from "fast-check";

import {
  COVERAGE_PLAN_ARTIFACT_FILENAME,
  COVERAGE_PLAN_SCHEMA_VERSION,
  DEFAULT_MUTATION_KILL_RATE_TARGET,
  MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
  SOURCE_MIX_PLAN_SCHEMA_VERSION,
  TEST_DESIGN_MODEL_SCHEMA_VERSION,
  type MultiSourceTestIntentEnvelope,
  type TestDesignModel,
  type TestIntentSourceRef,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  buildCoveragePlan,
  buildCoveragePlanWithAugmentation,
  writeCoveragePlanArtifact,
} from "./coverage-planner.js";
import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import { planSourceMix } from "./source-mix-planner.js";

const ISO = "2026-05-03T09:00:00.000Z";
const HEX = (seed: string): string => sha256Hex({ seed });

const figmaRef = (sourceId: string): TestIntentSourceRef => ({
  sourceId,
  kind: "figma_local_json",
  contentHash: HEX(sourceId),
  capturedAt: ISO,
});

const jiraRef = (sourceId: string): TestIntentSourceRef => ({
  sourceId,
  kind: "jira_rest",
  contentHash: HEX(sourceId),
  capturedAt: ISO,
  canonicalIssueKey: "PAY-42",
});

const markdownRef = (sourceId: string): TestIntentSourceRef => ({
  sourceId,
  kind: "custom_markdown",
  contentHash: HEX(sourceId),
  capturedAt: ISO,
  redactedMarkdownHash: HEX(`${sourceId}:md`),
  plainTextDerivativeHash: HEX(`${sourceId}:plain`),
});

const buildSourceEnvelope = (
  sources: readonly TestIntentSourceRef[],
): MultiSourceTestIntentEnvelope => ({
  version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
  sources: [...sources],
  aggregateContentHash: HEX(sources.map((source) => source.sourceId).join("|")),
  conflictResolutionPolicy: "reviewer_decides",
});

const buildModel = (): TestDesignModel => ({
  schemaVersion: TEST_DESIGN_MODEL_SCHEMA_VERSION,
  jobId: "job-1767",
  sourceHash: HEX("model"),
  screens: [
    {
      screenId: "loan",
      name: "Loan Quote",
      elements: [
        { elementId: "principal", label: "Principal", kind: "number" },
        { elementId: "rate", label: "Rate", kind: "number" },
        { elementId: "term", label: "Term", kind: "number" },
      ],
      actions: [
        {
          actionId: "calculate",
          label: "Calculate",
          kind: "submit",
          targetScreenId: "summary",
        },
      ],
      validations: [
        {
          validationId: "loan-boundary",
          rule: "Amount must be between 100 and 10000",
          targetElementId: "principal",
        },
      ],
      calculations: [
        {
          calculationId: "monthly-payment",
          name: "Monthly Payment",
          inputElementIds: ["principal", "rate", "term"],
        },
      ],
      visualRefs: ["visual:loan:principal"],
      sourceRefs: ["figma-primary"],
    },
    {
      screenId: "summary",
      name: "Summary",
      elements: [{ elementId: "status", label: "Status", kind: "text" }],
      actions: [],
      validations: [],
      calculations: [],
      visualRefs: [],
      sourceRefs: ["figma-primary", "jira-42"],
    },
  ],
  businessRules: [
    {
      ruleId: "rule-boundary",
      description: "Principal: Amount must be between 100 and 10000",
      screenId: "loan",
      sourceRefs: ["figma-primary", "jira-42"],
    },
    {
      ruleId: "rule-decision",
      description: "Summary: If the credit score is low, require manual review",
      screenId: "summary",
      sourceRefs: ["jira-42"],
    },
    {
      ruleId: "rule-partition",
      description: "Email: Accept valid email addresses",
      sourceRefs: ["jira-42"],
    },
  ],
  assumptions: [],
  openQuestions: [
    {
      openQuestionId: "oq-1",
      text: "Should the summary screen expose a manual-review warning?",
    },
  ],
  riskSignals: [
    {
      riskSignalId: "risk-1",
      text: "PII indicator iban detected in field_default_value",
      screenId: "loan",
      sourceRefs: ["figma-primary"],
    },
    {
      riskSignalId: "risk-2",
      text: "Multi-source validation_rule_mismatch: required vs optional",
      screenId: "summary",
      sourceRefs: ["figma-primary", "jira-42"],
    },
  ],
});

test("buildCoveragePlan selects deterministic techniques from model evidence", () => {
  const sourceMixResult = planSourceMix(
    buildSourceEnvelope([
      figmaRef("figma-primary"),
      jiraRef("jira-42"),
      markdownRef("notes-1"),
    ]),
  );
  assert.equal(sourceMixResult.ok, true);
  if (!sourceMixResult.ok) return;

  const plan = buildCoveragePlan({
    model: buildModel(),
    sourceMixPlan: sourceMixResult.plan,
  });

  assert.equal(plan.schemaVersion, COVERAGE_PLAN_SCHEMA_VERSION);
  assert.equal(plan.jobId, "job-1767");
  assert.equal(
    plan.mutationKillRateTarget,
    DEFAULT_MUTATION_KILL_RATE_TARGET,
  );
  assert.deepEqual(plan.techniques, [
    "initial_state",
    "equivalence_partitioning",
    "boundary_value",
    "decision_table",
    "state_transition",
    "pairwise",
    "error_guessing",
  ]);
  assert.ok(
    plan.minimumCases.some(
      (requirement) =>
        requirement.reasonCode === "screen_baseline" &&
        requirement.screenId === "loan",
    ),
  );
  assert.ok(
    plan.minimumCases.some(
      (requirement) =>
        requirement.reasonCode === "action_transition" &&
        requirement.targetIds.includes("summary"),
    ),
  );
  assert.ok(
    plan.minimumCases.some(
      (requirement) =>
        requirement.reasonCode === "rule_boundary" &&
        requirement.technique === "boundary_value",
    ),
  );
  assert.ok(
    plan.minimumCases.some(
      (requirement) =>
        requirement.reasonCode === "rule_decision" &&
        requirement.technique === "decision_table",
    ),
  );
  assert.ok(
    plan.recommendedCases.some(
      (requirement) =>
        requirement.reasonCode === "screen_pairwise" &&
        requirement.screenId === "loan",
    ),
  );
  assert.ok(
    plan.recommendedCases.some(
      (requirement) =>
        requirement.reasonCode === "supporting_context_probe" &&
        requirement.sourceRefs.includes("notes-1"),
    ),
  );
});

test("buildCoveragePlan is canonical-json stable and persists exact bytes", async () => {
  const sourceMixResult = planSourceMix(
    buildSourceEnvelope([figmaRef("figma-primary"), jiraRef("jira-42")]),
  );
  assert.equal(sourceMixResult.ok, true);
  if (!sourceMixResult.ok) return;

  const plan = buildCoveragePlan({
    model: buildModel(),
    sourceMixPlan: sourceMixResult.plan,
  });

  const tmpDir = await mkdtemp(join(tmpdir(), "coverage-plan-test-"));
  try {
    const written = await writeCoveragePlanArtifact({ plan, runDir: tmpDir });
    assert.equal(written.artifactPath, join(tmpDir, COVERAGE_PLAN_ARTIFACT_FILENAME));
    const raw = await readFile(written.artifactPath, "utf8");
    assert.equal(raw, canonicalJson(plan));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("buildCoveragePlan rejects out-of-range mutation targets", () => {
  assert.throws(
    () =>
      buildCoveragePlan({
        model: buildModel(),
        mutationKillRateTarget: 1.2,
      }),
    /mutationKillRateTarget must be in \[0, 1\]/,
  );
  assert.throws(
    () =>
      buildCoveragePlan({
        model: buildModel(),
        mutationKillRateTarget: Number.NaN,
      }),
    /mutationKillRateTarget must be in \[0, 1\]/,
  );
  assert.throws(
    () =>
      buildCoveragePlan({
        model: buildModel(),
        mutationKillRateTarget: "0.5" as unknown as number,
      }),
    /mutationKillRateTarget must be in \[0, 1\]/,
  );
});

test("property: repeated coverage planning yields identical canonical bytes", () => {
  fc.assert(
    fc.property(fc.boolean(), (includeMarkdown) => {
      const sources: TestIntentSourceRef[] = [
        figmaRef("figma-primary"),
        jiraRef("jira-42"),
      ];
      if (includeMarkdown) {
        sources.push(markdownRef("notes-1"));
      }
      const sourceMixResult = planSourceMix(buildSourceEnvelope(sources));
      assert.equal(sourceMixResult.ok, true);
      if (!sourceMixResult.ok) return;

      const first = buildCoveragePlan({
        model: buildModel(),
        sourceMixPlan: sourceMixResult.plan,
      });
      const second = buildCoveragePlan({
        model: buildModel(),
        sourceMixPlan: sourceMixResult.plan,
      });
      assert.equal(canonicalJson(first), canonicalJson(second));
    }),
    { numRuns: 80 },
  );
});

test("property: source-mix supporting context changes the recommended plan", () => {
  fc.assert(
    fc.property(fc.boolean(), (includeMarkdown) => {
      const baseSources = [figmaRef("figma-primary"), jiraRef("jira-42")];
      const sources = includeMarkdown
        ? [...baseSources, markdownRef("notes-1")]
        : baseSources;
      const sourceMixResult = planSourceMix(buildSourceEnvelope(sources));
      assert.equal(sourceMixResult.ok, true);
      if (!sourceMixResult.ok) return;

      const plan = buildCoveragePlan({
        model: buildModel(),
        sourceMixPlan: sourceMixResult.plan,
      });
      assert.equal(
        plan.recommendedCases.some(
          (requirement) => requirement.reasonCode === "supporting_context_probe",
        ),
        includeMarkdown,
      );
    }),
    { numRuns: 50 },
  );
});

test("buildCoveragePlan exposes structured per-screen quotas and per-element targets", () => {
  const plan = buildCoveragePlan({
    model: buildModel(),
  });

  const loanScreen = plan.perScreen.find((screen) => screen.screenId === "loan");
  assert.ok(loanScreen);
  assert.equal(
    loanScreen.techniqueQuotas.some(
      (quota) =>
        quota.technique === "boundary_value_analysis" && quota.minCount >= 1,
    ),
    true,
  );
  assert.equal(
    loanScreen.techniqueQuotas.some(
      (quota) => quota.technique === "state_transition" && quota.minCount >= 1,
    ),
    true,
  );

  const principal = plan.perElement.find(
    (element) => element.elementId === "principal",
  );
  assert.deepEqual(principal, {
    screenId: "loan",
    elementId: "principal",
    mustHaveCase: true,
    riskClass: "financial_transaction",
  });
});

test("buildCoveragePlanWithAugmentation raises quotas and risk classes from an optional planner client", async () => {
  const planner = createMockLlmGatewayClient({
    role: "coverage_planner",
    deployment: "phi-4-mini-instruct",
    modelRevision: "phi-4-mini-instruct@test",
    gatewayRelease: "mock",
    responder: (_request, attempt) => ({
      outcome: "success",
      content: {
        perScreen: [
          {
            screenId: "loan",
            techniqueQuotas: {
              boundary_value_analysis: 3,
              error_guessing: 2,
            },
          },
        ],
        perElement: [
          {
            screenId: "loan",
            elementId: "term",
            mustHaveCase: true,
            riskClass: "regulated_data",
          },
        ],
      },
      finishReason: "stop",
      usage: { inputTokens: 21, outputTokens: 13 },
      modelDeployment: "phi-4-mini-instruct",
      modelRevision: "phi-4-mini-instruct@test",
      gatewayRelease: "mock",
      attempt,
    }),
  });

  const result = await buildCoveragePlanWithAugmentation({
    model: buildModel(),
    plannerClient: planner,
  });

  assert.equal(result.usedAugmentation, true);
  const loanScreen = result.plan.perScreen.find(
    (screen) => screen.screenId === "loan",
  );
  assert.equal(
    loanScreen?.techniqueQuotas.some(
      (quota) =>
        quota.technique === "boundary_value_analysis" && quota.minCount === 3,
    ),
    true,
  );
  const term = result.plan.perElement.find((element) => element.elementId === "term");
  assert.equal(term?.riskClass, "regulated_data");
  assert.equal(planner.callCount(), 1);
});
