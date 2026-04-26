import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  QC_CREATED_ENTITIES_SCHEMA_VERSION,
  QC_MAPPING_PREVIEW_SCHEMA_VERSION,
  REVIEW_GATE_SCHEMA_VERSION,
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  TRACEABILITY_MATRIX_ARTIFACT_FILENAME,
  TRACEABILITY_MATRIX_SCHEMA_VERSION,
  TRANSFER_REPORT_SCHEMA_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type QcMappingPreviewArtifact,
  type ReviewGateSnapshot,
  type TestCasePolicyReport,
  type TestCaseValidationReport,
  type TransferReportArtifact,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import {
  buildTraceabilityMatrix,
  writeTraceabilityMatrix,
} from "./traceability-matrix.js";

const ZERO = "0".repeat(64);

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-x",
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
  steps: [{ index: 1, action: "open screen" }],
  expectedResults: ["ok"],
  figmaTraceRefs: [{ screenId: "screen-a", nodeId: "node-1" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: ["screen-a::field::node-1"],
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

const list = (cases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: cases,
});

const intentWithFields = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: [
    {
      screenId: "screen-a",
      screenName: "Login",
      trace: { nodeId: "screen-a", nodeName: "Login" },
    },
  ],
  detectedFields: [
    {
      id: "screen-a::field::node-1",
      screenId: "screen-a",
      trace: { nodeId: "node-1", nodeName: "Email" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Email",
      type: "text",
    },
  ],
  detectedActions: [],
  detectedValidations: [],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: [],
  piiIndicators: [],
  redactions: [],
});

test("buildTraceabilityMatrix: minimal export-only mode joins Figma → IR → coverage", () => {
  const matrix = buildTraceabilityMatrix({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    intent: intentWithFields(),
    list: list([buildCase({ id: "tc-1" })]),
  });
  assert.equal(matrix.schemaVersion, TRACEABILITY_MATRIX_SCHEMA_VERSION);
  assert.equal(matrix.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(matrix.rawScreenshotsIncluded, false);
  assert.equal(matrix.secretsIncluded, false);
  assert.equal(matrix.rows.length, 1);
  const row = matrix.rows[0];
  assert.equal(row?.testCaseId, "tc-1");
  assert.deepEqual(row?.figmaScreenIds, ["screen-a"]);
  assert.deepEqual(row?.figmaNodeIds, ["node-1"]);
  assert.deepEqual(row?.intentFieldIds, ["screen-a::field::node-1"]);
  assert.equal(row?.reconciliationDecisions.length, 1);
  assert.equal(
    row?.reconciliationDecisions[0]?.elementId,
    "screen-a::field::node-1",
  );
  assert.equal(row?.reconciliationDecisions[0]?.provenance, "figma_node");
  assert.equal(row?.transferOutcome, undefined);
  assert.equal(matrix.totals.rows, 1);
  assert.equal(matrix.totals.transferred, 0);
});

test("buildTraceabilityMatrix: with qcMapping populates externalIdCandidate + qcFolderPath", () => {
  const qcMapping: QcMappingPreviewArtifact = {
    schemaVersion: QC_MAPPING_PREVIEW_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    profileId: "opentext-alm-default",
    profileVersion: "1.0.0",
    entries: [
      {
        testCaseId: "tc-1",
        externalIdCandidate: "abcd1234",
        testName: "title",
        objective: "obj",
        priority: "p1",
        riskCategory: "low",
        targetFolderPath: "/Subject/Login/low",
        preconditions: [],
        testData: [],
        designSteps: [{ index: 1, action: "open screen" }],
        expectedResults: ["ok"],
        sourceTraceRefs: [{ screenId: "screen-a" }],
        exportable: true,
        blockingReasons: [],
      },
    ],
  };
  const matrix = buildTraceabilityMatrix({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    intent: intentWithFields(),
    list: list([buildCase({ id: "tc-1" })]),
    qcMapping,
  });
  const row = matrix.rows[0];
  assert.equal(row?.externalIdCandidate, "abcd1234");
  assert.equal(row?.qcFolderPath, "/Subject/Login/low");
});

test("buildTraceabilityMatrix: transfer-aware mode populates qcEntityId + transferOutcome", () => {
  const transfer: TransferReportArtifact = {
    schemaVersion: TRANSFER_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    reportId: "rep-001",
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    mode: "api_transfer",
    adapter: { provider: "opentext_alm", version: "1.0.0" },
    profile: { id: "opentext-alm-default", version: "1.0.0" },
    refused: false,
    refusalCodes: [],
    records: [
      {
        testCaseId: "tc-1",
        externalIdCandidate: "abcd1234",
        targetFolderPath: "/Subject/Login/low",
        outcome: "created",
        qcEntityId: "qc-9999",
        designStepsCreated: 1,
        recordedAt: "2026-04-26T00:00:00.000Z",
      },
      {
        testCaseId: "tc-2",
        externalIdCandidate: "efgh5678",
        targetFolderPath: "/Subject/Login/low",
        outcome: "skipped_duplicate",
        qcEntityId: "qc-1",
        designStepsCreated: 0,
        recordedAt: "2026-04-26T00:00:00.000Z",
      },
    ],
    createdCount: 1,
    skippedDuplicateCount: 1,
    failedCount: 0,
    refusedCount: 0,
    audit: {
      actor: "actor",
      authPrincipalId: "transfer-principal:test",
      bearerTokenAccepted: true,
      fourEyesReasons: [],
      dryRunReportId: "drid",
      evidenceReferences: {
        qcMappingPreviewHash: ZERO,
        dryRunReportHash: ZERO,
        visualSidecarReportHash: ZERO,
        visualSidecarEvidenceHashes: [],
      },
    },
    rawScreenshotsIncluded: false,
    credentialsIncluded: false,
    transferUrlIncluded: false,
  };
  const matrix = buildTraceabilityMatrix({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    intent: intentWithFields(),
    list: list([buildCase({ id: "tc-1" }), buildCase({ id: "tc-2" })]),
    transferReport: transfer,
  });
  const tc1 = matrix.rows.find((r) => r.testCaseId === "tc-1");
  const tc2 = matrix.rows.find((r) => r.testCaseId === "tc-2");
  assert.equal(tc1?.qcEntityId, "qc-9999");
  assert.equal(tc1?.transferOutcome, "created");
  assert.equal(tc2?.transferOutcome, "skipped_duplicate");
  assert.equal(matrix.totals.transferred, 1);
  assert.equal(matrix.totals.skippedDuplicate, 1);
  assert.equal(matrix.totals.failed, 0);
});

test("buildTraceabilityMatrix: visual sidecar observations attached only for matching screens", () => {
  const visual: VisualSidecarValidationReport = {
    schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    generatedAt: "2026-04-26T00:00:00.000Z",
    jobId: "job-1",
    totalScreens: 2,
    screensWithFindings: 1,
    blocked: false,
    records: [
      {
        screenId: "screen-a",
        deployment: "mock",
        outcomes: ["ok"],
        issues: [],
        meanConfidence: 0.92,
      },
      {
        screenId: "screen-other",
        deployment: "mock",
        outcomes: ["low_confidence"],
        issues: [],
        meanConfidence: 0.4,
      },
    ],
  };
  const matrix = buildTraceabilityMatrix({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    intent: intentWithFields(),
    list: list([buildCase({ id: "tc-1" })]),
    visual,
  });
  const row = matrix.rows[0];
  assert.equal(row?.visualObservations.length, 1);
  assert.equal(row?.visualObservations[0]?.screenId, "screen-a");
  assert.equal(row?.visualObservations[0]?.meanConfidence, 0.92);
});

test("buildTraceabilityMatrix: validation report aggregates to per-case error/warning/ok", () => {
  const validation: TestCaseValidationReport = {
    schemaVersion: TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: "2026-04-26T00:00:00.000Z",
    jobId: "job-1",
    totalTestCases: 3,
    errorCount: 1,
    warningCount: 1,
    blocked: true,
    issues: [
      {
        testCaseId: "tc-err",
        path: "/steps/0/action",
        code: "missing_trace",
        severity: "error",
        message: "missing trace",
      },
      {
        testCaseId: "tc-warn",
        path: "/steps/0/action",
        code: "missing_trace",
        severity: "warning",
        message: "warn",
      },
    ],
  };
  const matrix = buildTraceabilityMatrix({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    intent: intentWithFields(),
    list: list([
      buildCase({ id: "tc-err" }),
      buildCase({ id: "tc-warn" }),
      buildCase({ id: "tc-ok" }),
    ]),
    validation,
  });
  const lookup = (id: string) =>
    matrix.rows.find((r) => r.testCaseId === id)?.validationOutcome;
  assert.equal(lookup("tc-err"), "error");
  assert.equal(lookup("tc-warn"), "warning");
  assert.equal(lookup("tc-ok"), "ok");
});

test("buildTraceabilityMatrix: policy report populates policyDecision + sorted policyOutcomes", () => {
  const policy: TestCasePolicyReport = {
    schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: "2026-04-26T00:00:00.000Z",
    jobId: "job-1",
    policyProfileId: "eu-banking-default",
    policyProfileVersion: "1.0.0",
    totalTestCases: 1,
    approvedCount: 0,
    blockedCount: 0,
    needsReviewCount: 1,
    blocked: false,
    decisions: [
      {
        testCaseId: "tc-1",
        decision: "needs_review",
        violations: [
          {
            rule: "regulated",
            outcome: "regulated_risk_review_required",
            severity: "warning",
            reason: "x",
          },
          {
            rule: "ambig",
            outcome: "ambiguity_review_required",
            severity: "warning",
            reason: "x",
          },
          {
            rule: "ambig-2",
            outcome: "ambiguity_review_required",
            severity: "warning",
            reason: "y",
          },
        ],
      },
    ],
    jobLevelViolations: [],
  };
  const matrix = buildTraceabilityMatrix({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    intent: intentWithFields(),
    list: list([buildCase({ id: "tc-1" })]),
    policy,
  });
  const row = matrix.rows[0];
  assert.equal(row?.policyDecision, "needs_review");
  // Sorted + deduplicated.
  assert.deepEqual(row?.policyOutcomes, [
    "ambiguity_review_required",
    "regulated_risk_review_required",
  ]);
});

test("buildTraceabilityMatrix: review snapshot populates reviewState", () => {
  const reviewSnapshot: ReviewGateSnapshot = {
    schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    perTestCase: [
      {
        testCaseId: "tc-1",
        state: "approved",
        policyDecision: "approved",
        lastEventId: "e-1",
        lastEventAt: "2026-04-26T00:00:00.000Z",
        fourEyesEnforced: false,
        approvers: ["alice"],
      },
    ],
    approvedCount: 1,
    needsReviewCount: 0,
    rejectedCount: 0,
  };
  const matrix = buildTraceabilityMatrix({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    intent: intentWithFields(),
    list: list([buildCase({ id: "tc-1" })]),
    reviewSnapshot,
  });
  assert.equal(matrix.rows[0]?.reviewState, "approved");
});

test("buildTraceabilityMatrix: rows sorted by testCaseId for determinism", () => {
  const matrix = buildTraceabilityMatrix({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    intent: intentWithFields(),
    list: list([
      buildCase({ id: "tc-z" }),
      buildCase({ id: "tc-a" }),
      buildCase({ id: "tc-m" }),
    ]),
  });
  assert.deepEqual(
    matrix.rows.map((r) => r.testCaseId),
    ["tc-a", "tc-m", "tc-z"],
  );
});

test("buildTraceabilityMatrix: exportProfile + policyProfile passed through", () => {
  const matrix = buildTraceabilityMatrix({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    intent: intentWithFields(),
    list: list([]),
    exportProfile: { id: "opentext-alm-default", version: "1.0.0" },
    policyProfile: { id: "eu-banking-default", version: "1.0.0" },
  });
  assert.deepEqual(matrix.exportProfile, {
    id: "opentext-alm-default",
    version: "1.0.0",
  });
  assert.deepEqual(matrix.policyProfile, {
    id: "eu-banking-default",
    version: "1.0.0",
  });
});

test("buildTraceabilityMatrix: ambiguity strings are sanitised (whitespace collapsed + clipped)", () => {
  const intent: BusinessTestIntentIr = {
    ...intentWithFields(),
    detectedFields: [
      {
        id: "screen-a::field::node-1",
        screenId: "screen-a",
        trace: { nodeId: "node-1", nodeName: "Email" },
        provenance: "reconciled",
        confidence: 0.6,
        label: "Email",
        type: "text",
        ambiguity: { reason: "  multi\nline\twhitespace   " },
      },
    ],
  };
  const matrix = buildTraceabilityMatrix({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    intent,
    list: list([buildCase({ id: "tc-1" })]),
  });
  const decision = matrix.rows[0]?.reconciliationDecisions[0];
  assert.ok(decision);
  assert.equal(decision?.ambiguity, "multi line whitespace");
  assert.equal(decision?.provenance, "reconciled");
});

test("buildTraceabilityMatrix: unknown coverage ids are dropped (no orphan reconciliation rows)", () => {
  const matrix = buildTraceabilityMatrix({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    intent: intentWithFields(),
    list: list([
      buildCase({
        id: "tc-1",
        qualitySignals: {
          coveredFieldIds: ["screen-a::field::node-1", "missing::field::id"],
          coveredActionIds: ["missing::action"],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
    ]),
  });
  const decisions = matrix.rows[0]?.reconciliationDecisions ?? [];
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]?.elementId, "screen-a::field::node-1");
});

test("writeTraceabilityMatrix persists deterministic canonical JSON atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wd-trace-"));
  try {
    const matrix = buildTraceabilityMatrix({
      jobId: "job-1",
      generatedAt: "2026-04-26T00:00:00.000Z",
      intent: intentWithFields(),
      list: list([buildCase({ id: "tc-1" })]),
    });
    const r = await writeTraceabilityMatrix({
      matrix,
      destinationDir: dir,
    });
    assert.equal(
      r.artifactPath,
      join(dir, TRACEABILITY_MATRIX_ARTIFACT_FILENAME),
    );
    const a = await readFile(r.artifactPath, "utf8");
    const r2 = await writeTraceabilityMatrix({
      matrix,
      destinationDir: dir,
    });
    const b = await readFile(r2.artifactPath, "utf8");
    assert.equal(a, b);
    // Smoke: parses to valid object.
    const parsed = JSON.parse(a) as Record<string, unknown>;
    assert.equal(parsed["schemaVersion"], TRACEABILITY_MATRIX_SCHEMA_VERSION);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("QC_CREATED_ENTITIES_SCHEMA_VERSION reachable (sanity link)", () => {
  // Sanity assertion to keep the import live; the matrix builder
  // references created-entities indirectly via TransferReportArtifact.
  assert.equal(typeof QC_CREATED_ENTITIES_SCHEMA_VERSION, "string");
});
