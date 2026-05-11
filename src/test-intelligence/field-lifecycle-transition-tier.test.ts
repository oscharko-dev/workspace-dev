/**
 * Tier classifier + property-based assertions (Issue #2168).
 *
 * The validator scope tightening replaces the legacy "every uncovered
 * transition is an error" rule with a deterministic tier table. These
 * tests pin the table contents that downstream artifacts (M0 benchmark,
 * coverage-report) depend on, and use `fast-check` to verify the
 * load-bearing property the issue spec requires:
 *
 *   "for any fixture with N fields × M transitions, only the
 *    mandatory-tier subset can produce `severity: error`."
 */

import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {
  ALLOWED_WORKFLOW_FIELD_LIFECYCLE_STATES,
  ALLOWED_WORKFLOW_FIELD_LIFECYCLE_TRIGGERS,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  WORKFLOW_TOPOLOGY_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type WorkflowFieldLifecycle,
  type WorkflowFieldLifecycleState,
  type WorkflowFieldLifecycleTransition,
  type WorkflowFieldLifecycleTrigger,
  type WorkflowTopology,
} from "../contracts/index.js";
import {
  classifyFieldLifecycleTransition,
  classifyFieldLifecycleTransitionPair,
  FIELD_LIFECYCLE_TRANSITION_TIER_TABLE,
  type FieldLifecycleTransitionTier,
} from "./field-lifecycle-transition-tier.js";
import { validateGeneratedTestCases } from "./test-case-validation.js";

const ZERO_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const buildIntent = (
  fieldIds: ReadonlyArray<string>,
): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO_HASH },
  screens: [
    {
      screenId: "s-payment",
      screenName: "Payment Details",
      trace: { nodeId: "s-payment" },
    },
  ],
  detectedFields: fieldIds.map((id, index) => ({
    id,
    screenId: "s-payment",
    trace: { nodeId: `n-${String(index)}` },
    provenance: "figma_node",
    confidence: 0.9,
    label: `Field ${String(index)}`,
    type: "text",
  })),
  detectedActions: [
    {
      id: "s-payment::action::n-submit",
      screenId: "s-payment",
      trace: { nodeId: "n-submit" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Pay",
      kind: "button",
    },
  ],
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
  overrides: Partial<GeneratedTestCase> = {},
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Cover anchored transitions",
  objective: "Anchor each declared field-lifecycle transition once",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "financial_transaction",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "Open payment screen" }],
  expectedResults: ["Confirmation displayed"],
  figmaTraceRefs: [{ screenId: "s-payment" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: ["s-payment::field::n-iban"],
    coveredActionIds: ["s-payment::action::n-submit"],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.85,
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
    inputHash: ZERO_HASH,
    promptHash: ZERO_HASH,
    schemaHash: ZERO_HASH,
  },
  ...overrides,
});

const buildList = (cases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: cases,
});

const buildTopology = (
  fieldLifecycles: WorkflowFieldLifecycle[],
): WorkflowTopology => ({
  schemaVersion: WORKFLOW_TOPOLOGY_SCHEMA_VERSION,
  jobId: "job-1",
  actions: [],
  states: [],
  transitions: [],
  fieldLifecycles,
  entryStates: [],
  exitStates: [],
});

test("classifier table is exhaustive over the canonical 6-state lifecycle", () => {
  const states = ALLOWED_WORKFLOW_FIELD_LIFECYCLE_STATES;
  assert.equal(
    FIELD_LIFECYCLE_TRANSITION_TIER_TABLE.length,
    states.length * states.length,
  );
  for (const from of states) {
    for (const to of states) {
      const tier = classifyFieldLifecycleTransitionPair(from, to);
      assert.ok(
        tier === "mandatory_negative_path" ||
          tier === "recommended_positive_path" ||
          tier === "state_transition_test_only",
        `unexpected tier "${tier}" for ${from}->${to}`,
      );
    }
  }
});

test("classifier matches the issue-spec mandatory_negative_path subset", () => {
  // Wave-A audit follow-up (2026-05-11): the mandatory subset is now the
  // realistic entry edge (`initial → in_progress`) plus the two
  // validation outcomes (`in_progress → validated/error`). The previous
  // 7-pair classifier was over-firing on skip-state entries
  // (`initial → validated/error/terminal`) that no production UI emits.
  const mandatoryPairs: ReadonlyArray<
    [WorkflowFieldLifecycleState, WorkflowFieldLifecycleState]
  > = [
    ["initial", "in_progress"],
    ["in_progress", "validated"],
    ["in_progress", "error"],
  ];
  for (const [from, to] of mandatoryPairs) {
    assert.equal(
      classifyFieldLifecycleTransitionPair(from, to),
      "mandatory_negative_path",
      `${from}->${to} must be mandatory_negative_path`,
    );
  }
});

test("classifier matches the issue-spec recommended_positive_path subset", () => {
  const recommendedPairs: ReadonlyArray<
    [WorkflowFieldLifecycleState, WorkflowFieldLifecycleState]
  > = [
    ["initial", "focused"], // Wave-A audit: demoted from mandatory
    ["focused", "in_progress"],
    ["focused", "validated"],
    ["focused", "error"],
    ["in_progress", "in_progress"],
    ["in_progress", "terminal"],
    ["validated", "terminal"],
    ["error", "in_progress"],
    ["error", "terminal"],
  ];
  for (const [from, to] of recommendedPairs) {
    assert.equal(
      classifyFieldLifecycleTransitionPair(from, to),
      "recommended_positive_path",
      `${from}->${to} must be recommended_positive_path`,
    );
  }
});

test("classifier marks every outgoing edge from `terminal` as state_transition_test_only", () => {
  for (const to of ALLOWED_WORKFLOW_FIELD_LIFECYCLE_STATES) {
    assert.equal(
      classifyFieldLifecycleTransitionPair("terminal", to),
      "state_transition_test_only",
      `terminal->${to} must be state_transition_test_only`,
    );
  }
});

test("classifyFieldLifecycleTransition matches classifyFieldLifecycleTransitionPair", () => {
  for (const from of ALLOWED_WORKFLOW_FIELD_LIFECYCLE_STATES) {
    for (const to of ALLOWED_WORKFLOW_FIELD_LIFECYCLE_STATES) {
      const transition: WorkflowFieldLifecycleTransition = {
        transitionId: "FLT-test",
        from,
        to,
        trigger: "user_focus",
      };
      assert.equal(
        classifyFieldLifecycleTransition(transition),
        classifyFieldLifecycleTransitionPair(from, to),
      );
    }
  }
});

const stateArb = fc.constantFrom<WorkflowFieldLifecycleState>(
  ...ALLOWED_WORKFLOW_FIELD_LIFECYCLE_STATES,
);
const triggerArb = fc.constantFrom<WorkflowFieldLifecycleTrigger>(
  ...ALLOWED_WORKFLOW_FIELD_LIFECYCLE_TRIGGERS,
);

const transitionArb = (
  transitionId: string,
): fc.Arbitrary<WorkflowFieldLifecycleTransition> =>
  fc.record({
    transitionId: fc.constant(transitionId),
    from: stateArb,
    to: stateArb,
    trigger: triggerArb,
  });

const lifecycleArb = (
  fieldIndex: number,
): fc.Arbitrary<WorkflowFieldLifecycle> =>
  fc
    .array(
      fc
        .nat({ max: 99 })
        .map((n) => `FLT-f${String(fieldIndex)}-${String(n).padStart(3, "0")}`),
      { minLength: 1, maxLength: 8 },
    )
    .chain((rawIds) => {
      const ids = Array.from(new Set(rawIds));
      return fc
        .tuple(...ids.map((id) => transitionArb(id)))
        .map((transitions) => ({
          fieldId: `s-payment::field::n-f${String(fieldIndex)}`,
          states: [
            "initial",
            "focused",
            "in_progress",
            "validated",
            "error",
            "terminal",
          ],
          transitions,
        }));
    });

test("Issue #2168 property: only mandatory-tier transitions can produce severity:error", () => {
  fc.assert(
    fc.property(
      fc
        .integer({ min: 1, max: 4 })
        .chain((fieldCount) =>
          fc
            .tuple(
              ...Array.from({ length: fieldCount }, (_, i) => lifecycleArb(i)),
            )
            .map((lifecycles) => lifecycles),
        ),
      (lifecycles) => {
        const allTransitions = lifecycles.flatMap(
          (lifecycle) => lifecycle.transitions,
        );
        const transitionIds = Array.from(
          new Set(allTransitions.map((t) => t.transitionId)),
        );
        // Pick a subset to "cover" so we still leave gaps. The
        // property must hold regardless of which subset is covered.
        const coveredIds = new Set(
          transitionIds.filter((_id, idx) => idx % 2 === 0),
        );
        const fieldIds = lifecycles.map((lifecycle) => lifecycle.fieldId);
        const intent = buildIntent(fieldIds);
        const steps = [...coveredIds].map((transitionId, idx) => ({
          index: idx + 1,
          action: `Cover ${transitionId}`,
          fieldLifecycleTransitionId: transitionId,
        }));
        const list = buildList([
          buildCase({
            steps:
              steps.length > 0
                ? steps
                : [{ index: 1, action: "Open payment screen" }],
            qualitySignals: {
              coveredFieldIds: fieldIds,
              coveredActionIds: ["s-payment::action::n-submit"],
              coveredValidationIds: [],
              coveredNavigationIds: [],
              confidence: 0.85,
            },
          }),
        ]);
        const topology = buildTopology(lifecycles);
        const report = validateGeneratedTestCases({
          jobId: "job-1",
          generatedAt: GENERATED_AT,
          list,
          intent,
          workflowTopology: topology,
        });
        const transitionErrorIssues = report.issues.filter(
          (issue) =>
            issue.code === "uncovered_field_lifecycle_transition" &&
            issue.severity === "error",
        );
        for (const issue of transitionErrorIssues) {
          // Locate the transition behind the message and confirm it is
          // mandatory_negative_path.
          const matching = allTransitions.find((t) =>
            issue.message.includes(`"${t.transitionId}"`),
          );
          assert.ok(
            matching !== undefined,
            `error issue ${issue.message} did not reference a known transition`,
          );
          assert.equal(
            classifyFieldLifecycleTransition(matching),
            "mandatory_negative_path",
          );
        }
        // Every non-mandatory uncovered transition must either stay
        // silent (state_transition_test_only without a state_transition
        // case) or surface as a warning.
        for (const transition of allTransitions) {
          if (coveredIds.has(transition.transitionId)) continue;
          const tier: FieldLifecycleTransitionTier =
            classifyFieldLifecycleTransition(transition);
          if (tier === "mandatory_negative_path") continue;
          const errorOccurrences = transitionErrorIssues.filter((issue) =>
            issue.message.includes(`"${transition.transitionId}"`),
          );
          assert.equal(errorOccurrences.length, 0);
        }
      },
    ),
    { numRuns: 64 },
  );
});

test("Issue #2168 property: covering every mandatory transition keeps the run unblocked", () => {
  fc.assert(
    fc.property(
      fc
        .integer({ min: 1, max: 3 })
        .chain((fieldCount) =>
          fc
            .tuple(
              ...Array.from({ length: fieldCount }, (_, i) => lifecycleArb(i)),
            )
            .map((lifecycles) => lifecycles),
        ),
      (lifecycles) => {
        const allTransitions = lifecycles.flatMap(
          (lifecycle) => lifecycle.transitions,
        );
        const mandatoryTransitionIds = allTransitions
          .filter(
            (transition) =>
              classifyFieldLifecycleTransition(transition) ===
              "mandatory_negative_path",
          )
          .map((transition) => transition.transitionId);
        const fieldIds = lifecycles.map((lifecycle) => lifecycle.fieldId);
        const intent = buildIntent(fieldIds);
        const steps =
          mandatoryTransitionIds.length === 0
            ? [{ index: 1, action: "Open payment screen" }]
            : mandatoryTransitionIds.map((transitionId, idx) => ({
                index: idx + 1,
                action: `Cover ${transitionId}`,
                fieldLifecycleTransitionId: transitionId,
              }));
        const list = buildList([
          buildCase({
            steps,
            qualitySignals: {
              coveredFieldIds: fieldIds,
              coveredActionIds: ["s-payment::action::n-submit"],
              coveredValidationIds: [],
              coveredNavigationIds: [],
              confidence: 0.85,
            },
          }),
        ]);
        const topology = buildTopology(lifecycles);
        const report = validateGeneratedTestCases({
          jobId: "job-1",
          generatedAt: GENERATED_AT,
          list,
          intent,
          workflowTopology: topology,
        });
        // Filter to only field-lifecycle-related issues so unrelated
        // semantic checks (PII, oracle, etc.) cannot influence the
        // assertion.
        const lifecycleErrors = report.issues.filter(
          (issue) =>
            issue.code === "uncovered_field_lifecycle_transition" &&
            issue.severity === "error",
        );
        assert.equal(lifecycleErrors.length, 0);
      },
    ),
    { numRuns: 64 },
  );
});
