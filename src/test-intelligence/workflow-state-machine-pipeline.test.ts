/**
 * Validation-pipeline integration test for the workflow state-machine
 * gate (Issue #2111).
 *
 * Asserts:
 *
 *   - The pipeline runs unchanged when neither the registry nor the
 *     case-claims input is supplied (existing fixtures stay byte-stable).
 *   - When the registry is supplied without claims, the gate runs and
 *     emits an empty-coverage report; the pipeline `blocked` flag is
 *     unaffected.
 *   - When happy-path step claims are supplied, the gate is non-blocking
 *     and the artifact is persisted under the canonical filename.
 *   - When an adversarial sequence is supplied, the gate flips the
 *     pipeline `blocked` flag.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import {
  runAndPersistValidationPipeline,
  runValidationPipeline,
} from "./validation-pipeline.js";
import { buildDefaultWorkflowStateMachineRegistry } from "./workflow-state-machine-catalog.js";
import { WORKFLOW_STATE_MACHINE_REPORT_ARTIFACT_FILENAME } from "./workflow-state-machine-validator.js";

const ZERO = "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-05-09T10:00:00.000Z";

const buildIntent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: [
    {
      screenId: "s-login",
      screenName: "Login",
      trace: { nodeId: "s-login" },
    },
  ],
  detectedFields: [
    {
      id: "s-login::field::n-username",
      screenId: "s-login",
      trace: { nodeId: "n-username" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Username",
      type: "text",
    },
  ],
  detectedActions: [
    {
      id: "s-login::action::n-submit",
      screenId: "s-login",
      trace: { nodeId: "n-submit" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Login",
      kind: "button",
    },
  ],
  detectedValidations: [
    {
      id: "s-login::validation::n-username::Required",
      screenId: "s-login",
      trace: { nodeId: "n-username" },
      provenance: "figma_node",
      confidence: 0.85,
      rule: "Required",
      targetFieldId: "s-login::field::n-username",
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

const buildCase = (id: string): GeneratedTestCase => ({
  id,
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Login happy path",
  objective: "Customer logs in with valid credentials",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [
    { index: 1, action: "Enter credentials" },
    { index: 2, action: "Submit credentials" },
  ],
  expectedResults: ["Session active"],
  figmaTraceRefs: [{ screenId: "s-login" }],
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
});

const buildList = (): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: [buildCase("tc-1")],
});

void test("pipeline ignores state-machine inputs when nothing is supplied", () => {
  const artifacts = runValidationPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList(),
    intent: buildIntent(),
  });
  assert.equal(artifacts.workflowStateMachineReport, undefined);
});

void test("pipeline emits a state-machine report when the registry is supplied", () => {
  const registry = buildDefaultWorkflowStateMachineRegistry();
  const artifacts = runValidationPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList(),
    intent: buildIntent(),
    workflowStateMachineRegistry: registry,
    workflowStateMachineCaseClaims: [],
  });
  assert.ok(artifacts.workflowStateMachineReport !== undefined);
  // No claims means no per-case findings — the gate must be non-blocking
  // even though other unrelated pipeline gates (policy, etc.) may flip
  // the job-level `blocked` for unrelated reasons.
  assert.equal(artifacts.workflowStateMachineReport?.blocked, false);
  assert.equal(artifacts.workflowStateMachineReport?.totalCases, 0);
});

void test("pipeline persists the workflow-state-machine artifact under the canonical filename", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wsm-pipeline-"));
  try {
    const registry = buildDefaultWorkflowStateMachineRegistry();
    const result = await runAndPersistValidationPipeline({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: buildList(),
      intent: buildIntent(),
      workflowStateMachineRegistry: registry,
      workflowStateMachineCaseClaims: [
        {
          testCaseId: "tc-1",
          stateMachineId: "login",
          steps: [
            { stepIndex: 1, transitionId: "login.t01.enter_credentials" },
            { stepIndex: 2, transitionId: "login.t02.validate_credentials" },
            { stepIndex: 3, transitionId: "login.t04.request_sca" },
            { stepIndex: 4, transitionId: "login.t05.complete_sca" },
            { stepIndex: 5, transitionId: "login.t06.activate_session" },
          ],
        },
      ],
      destinationDir: directory,
    });
    assert.ok(result.paths.workflowStateMachineReportPath !== undefined);
    assert.equal(
      result.paths.workflowStateMachineReportPath,
      join(directory, WORKFLOW_STATE_MACHINE_REPORT_ARTIFACT_FILENAME),
    );
    const persisted = JSON.parse(
      await readFile(result.paths.workflowStateMachineReportPath, "utf8"),
    ) as { blocked: boolean; perCase: Array<{ testCaseId: string }> };
    assert.equal(persisted.blocked, false);
    assert.equal(persisted.perCase[0]?.testCaseId, "tc-1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("workflow state-machine gate flips workflowStateMachineReport.blocked on a hard-infeasibility", () => {
  const registry = buildDefaultWorkflowStateMachineRegistry();
  const artifacts = runValidationPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList(),
    intent: buildIntent(),
    workflowStateMachineRegistry: registry,
    workflowStateMachineCaseClaims: [
      {
        testCaseId: "tc-1",
        stateMachineId: "login",
        // Starting from `login.t06.activate_session` is hard-infeasible:
        // its `from` is `sca_completed` which is not an entry state.
        steps: [{ stepIndex: 1, transitionId: "login.t06.activate_session" }],
      },
    ],
  });
  assert.equal(artifacts.workflowStateMachineReport?.blocked, true);
  // Job-level `blocked` is OR-folded with the gate's blocked flag.
  assert.equal(artifacts.blocked, true);
});

void test("pipeline gate does not flip blocked when only warnings fire", () => {
  const registry = buildDefaultWorkflowStateMachineRegistry();
  const artifacts = runValidationPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList(),
    intent: buildIntent(),
    workflowStateMachineRegistry: registry,
    workflowStateMachineCaseClaims: [
      {
        testCaseId: "tc-1",
        stateMachineId: "login",
        // Skipping SCA mid-flow is bridgeable by intermediate transitions
        // → warning severity, no error → gate stays non-blocking.
        steps: [
          { stepIndex: 1, transitionId: "login.t01.enter_credentials" },
          { stepIndex: 2, transitionId: "login.t06.activate_session" },
        ],
      },
    ],
  });
  assert.equal(artifacts.workflowStateMachineReport?.blocked, false);
  // The case must surface a warning with the bridging path.
  const issue = artifacts.workflowStateMachineReport?.issues.find(
    (current) => current.code === "missing_intermediate_step",
  );
  assert.ok(issue !== undefined);
  assert.equal(issue?.severity, "warning");
});
