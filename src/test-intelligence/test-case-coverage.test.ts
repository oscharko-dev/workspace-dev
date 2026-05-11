import assert from "node:assert/strict";
import test from "node:test";
import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  WORKFLOW_TOPOLOGY_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type WorkflowTopology,
} from "../contracts/index.js";
import { computeCoverageReport } from "./test-case-coverage.js";

const ZERO = "0000000000000000000000000000000000000000000000000000000000000000";

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "title",
  objective: "obj",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "do", expected: "ok" }],
  expectedResults: ["ok"],
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
    generatedAt: "2026-04-25T10:00:00.000Z",
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

const buildIntent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: [{ screenId: "s-1", screenName: "Form", trace: { nodeId: "s-1" } }],
  detectedFields: [
    {
      id: "f-1",
      screenId: "s-1",
      trace: { nodeId: "n1" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Email",
      type: "text",
    },
    {
      id: "f-2",
      screenId: "s-1",
      trace: { nodeId: "n2" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "IBAN",
      type: "text",
    },
  ],
  detectedActions: [
    {
      id: "a-1",
      screenId: "s-1",
      trace: { nodeId: "na1" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Submit",
      kind: "button",
    },
  ],
  detectedValidations: [
    {
      id: "v-1",
      screenId: "s-1",
      trace: { nodeId: "n2" },
      provenance: "figma_node",
      confidence: 0.85,
      rule: "Required",
      targetFieldId: "f-2",
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

const buildWorkflowTopology = (): WorkflowTopology => ({
  schemaVersion: WORKFLOW_TOPOLOGY_SCHEMA_VERSION,
  jobId: "job-1",
  actions: [
    {
      actionId: "ACT-001",
      screenId: "s-1",
      label: "Eingeben Email",
      kind: "enter_value",
      targetIds: ["f-1"],
      sourceRefs: [],
    },
    {
      actionId: "ACT-002",
      screenId: "s-1",
      label: "Eingeben IBAN",
      kind: "enter_value",
      targetIds: ["f-2"],
      sourceRefs: [],
    },
  ],
  states: [
    { stateId: "STATE-001", screenId: "s-1", label: "Start", sourceRefs: [] },
    { stateId: "STATE-002", screenId: "s-1", label: "Done", sourceRefs: [] },
  ],
  transitions: [
    {
      transitionId: "TRANS-001",
      from: "STATE-001",
      to: "STATE-002",
      guard: "when the workflow continues on the same screen",
      actions: ["ACT-001", "ACT-002"],
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
      fieldId: "f-1",
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
          transitionId: "FLT-field0001",
          from: "initial",
          to: "focused",
          trigger: "user_focus",
        },
        {
          transitionId: "FLT-field0002",
          from: "focused",
          to: "in_progress",
          trigger: "user_input",
        },
        {
          transitionId: "FLT-field0003",
          from: "in_progress",
          to: "validated",
          trigger: "validation_pass",
        },
        {
          transitionId: "FLT-field0004",
          from: "in_progress",
          to: "error",
          trigger: "validation_fail",
        },
        {
          transitionId: "FLT-field0005",
          from: "validated",
          to: "terminal",
          trigger: "form_commit",
        },
      ],
    },
  ],
});

test("coverage buckets reflect intent ids covered by accepted cases", () => {
  const cases = [
    buildCase({
      id: "tc-1",
      type: "functional",
      qualitySignals: {
        coveredFieldIds: ["f-1"],
        coveredActionIds: ["a-1"],
        coveredValidationIds: [],
        coveredNavigationIds: [],
        confidence: 0.9,
      },
    }),
    buildCase({
      id: "tc-2",
      type: "negative",
      qualitySignals: {
        coveredFieldIds: ["f-2"],
        coveredActionIds: [],
        coveredValidationIds: ["v-1"],
        coveredNavigationIds: [],
        confidence: 0.9,
      },
    }),
  ];
  const report = computeCoverageReport({
    jobId: "job-1",
    generatedAt: "2026-04-25T10:00:00.000Z",
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: cases,
    },
    intent: buildIntent(),
    duplicateSimilarityThreshold: 0.92,
  });
  assert.equal(report.fieldCoverage.total, 2);
  assert.equal(report.fieldCoverage.covered, 2);
  assert.equal(report.fieldCoverage.ratio, 1);
  assert.deepEqual(report.fieldCoverage.uncoveredIds, []);
  assert.equal(report.actionCoverage.covered, 1);
  assert.equal(report.validationCoverage.covered, 1);
  assert.equal(report.traceCoverage.withTrace, 2);
  assert.equal(report.negativeCaseCount, 1);
  assert.equal(report.positiveCaseCount, 1);
});

test("uncovered ids are sorted deterministically", () => {
  const intent = buildIntent();
  const report = computeCoverageReport({
    jobId: "job-1",
    generatedAt: "2026-04-25T10:00:00.000Z",
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: [],
    },
    intent,
    duplicateSimilarityThreshold: 0.92,
  });
  assert.deepEqual(report.fieldCoverage.uncoveredIds, ["f-1", "f-2"]);
  assert.equal(report.fieldCoverage.ratio, 0);
});

test("workflow topology overrides the action universe for action coverage", () => {
  const report = computeCoverageReport({
    jobId: "job-1",
    generatedAt: "2026-04-25T10:00:00.000Z",
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: [
        buildCase({
          qualitySignals: {
            coveredFieldIds: ["f-1"],
            coveredActionIds: ["ACT-001"],
            coveredValidationIds: [],
            coveredNavigationIds: [],
            confidence: 0.9,
          },
        }),
      ],
    },
    intent: {
      ...buildIntent(),
      detectedActions: [],
    },
    workflowTopology: buildWorkflowTopology(),
    duplicateSimilarityThreshold: 0.92,
  });

  assert.equal(report.actionCoverage.total, 2);
  assert.equal(report.actionCoverage.covered, 1);
  assert.equal(report.actionCoverage.ratio, 0.5);
  assert.deepEqual(report.actionCoverage.uncoveredIds, ["ACT-002"]);
});

test("workflow topology field lifecycles define the lifecycle coverage universe", () => {
  const report = computeCoverageReport({
    jobId: "job-1",
    generatedAt: "2026-04-25T10:00:00.000Z",
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: [
        buildCase({
          id: "tc-pos",
          qualitySignals: {
            coveredFieldIds: ["f-1"],
            coveredActionIds: ["ACT-001"],
            coveredValidationIds: [],
            coveredNavigationIds: [],
            confidence: 0.9,
          },
          steps: [
            {
              index: 1,
              action: "Focus field",
              fieldLifecycleTransitionId: "FLT-field0001",
            },
            {
              index: 2,
              action: "Enter field value",
              fieldLifecycleTransitionId: "FLT-field0002",
            },
            {
              index: 3,
              action: "Validate field value",
              fieldLifecycleTransitionId: "FLT-field0003",
            },
            {
              index: 4,
              action: "Submit form",
              expected: "ok",
              fieldLifecycleTransitionId: "FLT-field0005",
            },
          ],
        }),
        buildCase({
          id: "tc-neg",
          type: "negative",
          qualitySignals: {
            coveredFieldIds: ["f-1"],
            coveredActionIds: [],
            coveredValidationIds: ["v-1"],
            coveredNavigationIds: [],
            confidence: 0.9,
          },
          steps: [
            {
              index: 1,
              action: "Trigger validation error",
              expected: "Validation error",
              fieldLifecycleTransitionId: "FLT-field0004",
            },
          ],
          expectedResults: ["Validation error"],
        }),
      ],
    },
    intent: buildIntent(),
    workflowTopology: buildFieldLifecycleWorkflowTopology(),
    duplicateSimilarityThreshold: 0.92,
  });

  assert.equal(report.fieldLifecycleCoverage.total, 5);
  assert.equal(report.fieldLifecycleCoverage.covered, 5);
  assert.equal(report.fieldLifecycleCoverage.ratio, 1);
  assert.deepEqual(report.fieldLifecycleCoverage.uncoveredIds, []);
});

test("decorative technical labels and icon actions are excluded from mandatory coverage totals", () => {
  const intent: BusinessTestIntentIr = {
    ...buildIntent(),
    detectedFields: [
      ...buildIntent().detectedFields,
      {
        id: "f-decor-textfield",
        screenId: "s-1",
        trace: { nodeId: "n-textfield" },
        provenance: "figma_node",
        confidence: 0.5,
        label: "<TextField>",
        type: "text",
      },
      {
        id: "f-decor-select",
        screenId: "s-1",
        trace: { nodeId: "n-select" },
        provenance: "figma_node",
        confidence: 0.5,
        label: "<Select>",
        type: "text",
      },
      {
        id: "f-decor-text",
        screenId: "s-1",
        trace: { nodeId: "n-text" },
        provenance: "figma_node",
        confidence: 0.5,
        label: "Text",
        type: "text",
      },
      {
        id: "f-decor-currency",
        screenId: "s-1",
        trace: { nodeId: "n-eur" },
        provenance: "figma_node",
        confidence: 0.5,
        label: "EUR",
        type: "text",
      },
      {
        id: "f-decor-value",
        screenId: "s-1",
        trace: { nodeId: "n-value" },
        provenance: "figma_node",
        confidence: 0.5,
        label: "45.000,00 €",
        type: "text",
      },
      {
        id: "f-decor-helper",
        screenId: "s-1",
        trace: { nodeId: "n-helper" },
        provenance: "figma_node",
        confidence: 0.5,
        label: "Die MwSt. ist nicht Teil des Finanzierungsbedarfs.",
        type: "text",
      },
      {
        id: "f-decor-heading",
        screenId: "s-1",
        trace: { nodeId: "n-heading" },
        provenance: "figma_node",
        confidence: 0.5,
        label: "Ermittlung des Finanzierungsbedarfs",
        type: "text",
      },
    ],
    detectedActions: [
      ...buildIntent().detectedActions,
      {
        id: "a-decor-icon",
        screenId: "s-1",
        trace: { nodeId: "n-icon" },
        provenance: "figma_node",
        confidence: 0.2,
        label: "<Icon>",
        kind: "icon",
        labelConfidence: 0,
      },
    ],
  };
  const report = computeCoverageReport({
    jobId: "job-1",
    generatedAt: "2026-04-25T10:00:00.000Z",
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: [],
    },
    intent,
    duplicateSimilarityThreshold: 0.92,
  });
  assert.equal(report.fieldCoverage.total, 4);
  assert.deepEqual(report.fieldCoverage.uncoveredIds, [
    "f-1",
    "f-2",
    "f-decor-heading",
    "f-decor-helper",
  ]);
  assert.equal(report.actionCoverage.total, 1);
  assert.deepEqual(report.actionCoverage.uncoveredIds, ["a-1"]);
});

test("semantic helper copy and headings remain in mandatory coverage totals", () => {
  const report = computeCoverageReport({
    jobId: "job-1",
    generatedAt: "2026-04-25T10:00:00.000Z",
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: [],
    },
    intent: {
      ...buildIntent(),
      detectedFields: [
        ...buildIntent().detectedFields,
        {
          id: "f-helper-copy",
          screenId: "s-1",
          trace: { nodeId: "n-helper-copy" },
          provenance: "figma_node",
          confidence: 0.7,
          label: "Die Angabe muss mit den Vertragsdaten uebereinstimmen.",
          type: "text",
        },
        {
          id: "f-page-heading",
          screenId: "s-1",
          trace: { nodeId: "n-page-heading" },
          provenance: "figma_node",
          confidence: 0.7,
          label: "Ermittlung des Finanzierungsbedarfs",
          type: "text",
        },
      ],
    },
    duplicateSimilarityThreshold: 0.92,
  });

  assert.equal(report.fieldCoverage.total, 4);
  assert.deepEqual(report.fieldCoverage.uncoveredIds, [
    "f-1",
    "f-2",
    "f-helper-copy",
    "f-page-heading",
  ]);
});

test("rubric score is rounded and clamped", () => {
  const report = computeCoverageReport({
    jobId: "job-1",
    generatedAt: "2026-04-25T10:00:00.000Z",
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: [],
    },
    intent: buildIntent(),
    duplicateSimilarityThreshold: 0.92,
    rubricScore: 0.123456789,
  });
  assert.equal(report.rubricScore, 0.123457);
});

test("rubric score out of range throws", () => {
  assert.throws(
    () =>
      computeCoverageReport({
        jobId: "job-1",
        generatedAt: "2026-04-25T10:00:00.000Z",
        policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
        list: {
          schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
          jobId: "job-1",
          testCases: [],
        },
        intent: buildIntent(),
        duplicateSimilarityThreshold: 0.92,
        rubricScore: 1.5,
      }),
    RangeError,
  );
});
