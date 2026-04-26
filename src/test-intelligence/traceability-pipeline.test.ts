import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  TRACEABILITY_MATRIX_ARTIFACT_FILENAME,
  TRANSFER_REPORT_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type TransferReportArtifact,
} from "../contracts/index.js";
import {
  persistExportTraceabilityMatrix,
  persistTransferTraceabilityMatrix,
} from "./traceability-pipeline.js";

const ZERO = "0".repeat(64);

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-1",
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
  steps: [{ index: 1, action: "open", expected: "ok" }],
  expectedResults: ["ok"],
  figmaTraceRefs: [{ screenId: "screen-a" }],
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

const list = (cases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: cases,
});

const intent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: [
    {
      screenId: "screen-a",
      screenName: "Login",
      trace: { nodeId: "screen-a" },
    },
  ],
  detectedFields: [],
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

test("persistExportTraceabilityMatrix: writes traceability-matrix.json deterministically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wd-trace-pipeline-"));
  try {
    const { matrix, paths } = await persistExportTraceabilityMatrix({
      jobId: "job-1",
      generatedAt: "2026-04-26T00:00:00.000Z",
      intent: intent(),
      list: list([buildCase({})]),
      destinationDir: dir,
    });
    assert.equal(
      paths.artifactPath,
      join(dir, TRACEABILITY_MATRIX_ARTIFACT_FILENAME),
    );
    assert.equal(matrix.rows.length, 1);
    assert.equal(matrix.rawScreenshotsIncluded, false);
    assert.equal(matrix.secretsIncluded, false);

    // Re-running with the same input is byte-identical.
    const persistedA = await readFile(paths.artifactPath, "utf8");
    const second = await persistExportTraceabilityMatrix({
      jobId: "job-1",
      generatedAt: "2026-04-26T00:00:00.000Z",
      intent: intent(),
      list: list([buildCase({})]),
      destinationDir: dir,
    });
    const persistedB = await readFile(second.paths.artifactPath, "utf8");
    assert.equal(persistedA, persistedB);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("persistTransferTraceabilityMatrix: identical alias of the export helper", () => {
  assert.equal(
    persistTransferTraceabilityMatrix,
    persistExportTraceabilityMatrix,
  );
});

test("persistExportTraceabilityMatrix: with transferReport populates qcEntityId in the persisted matrix", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wd-trace-pipeline-"));
  try {
    const transferReport: TransferReportArtifact = {
      schemaVersion: TRANSFER_REPORT_SCHEMA_VERSION,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      reportId: "rep-1",
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
      ],
      createdCount: 1,
      skippedDuplicateCount: 0,
      failedCount: 0,
      refusedCount: 0,
      audit: {
        actor: "actor",
        authPrincipalId: "p",
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
    const { matrix } = await persistTransferTraceabilityMatrix({
      jobId: "job-1",
      generatedAt: "2026-04-26T00:00:00.000Z",
      intent: intent(),
      list: list([buildCase({})]),
      transferReport,
      destinationDir: dir,
    });
    assert.equal(matrix.rows[0]?.qcEntityId, "qc-9999");
    assert.equal(matrix.rows[0]?.transferOutcome, "created");
    assert.equal(matrix.totals.transferred, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("persistExportTraceabilityMatrix: empty list still emits a valid empty matrix", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wd-trace-pipeline-"));
  try {
    const { matrix, paths } = await persistExportTraceabilityMatrix({
      jobId: "job-1",
      generatedAt: "2026-04-26T00:00:00.000Z",
      intent: intent(),
      list: list([]),
      destinationDir: dir,
    });
    assert.equal(matrix.rows.length, 0);
    assert.equal(matrix.totals.rows, 0);
    const raw = await readFile(paths.artifactPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(Array.isArray(parsed["rows"]), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
