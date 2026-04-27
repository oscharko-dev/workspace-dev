import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import {
  EXPORT_REPORT_ARTIFACT_FILENAME,
  EXPORT_REPORT_SCHEMA_VERSION,
  GENERATED_TESTCASES_ARTIFACT_FILENAME,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  QC_MAPPING_PREVIEW_ARTIFACT_FILENAME,
  QC_MAPPING_PREVIEW_SCHEMA_VERSION,
  REVIEW_EVENTS_ARTIFACT_FILENAME,
  REVIEW_GATE_SCHEMA_VERSION,
  REVIEW_STATE_ARTIFACT_FILENAME,
  MULTI_SOURCE_RECONCILIATION_REPORT_SCHEMA_VERSION,
  MULTI_SOURCE_CONFLICT_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION,
  TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
} from "../contracts/index.js";

import {
  isSafeJobId,
  listInspectorTestIntelligenceJobs,
  readInspectorTestIntelligenceBundle,
} from "./inspector-bundle.js";

const ASSEMBLED_AT = "2026-04-25T12:00:00.000Z";

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await writeFile(path, JSON.stringify(value), "utf8");
};

const sampleGeneratedTestCases = (jobId: string): unknown => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId,
  testCases: [
    {
      id: "tc-1",
      sourceJobId: jobId,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      promptTemplateVersion: "1.0.0",
      title: "Sign in with valid credentials",
      objective: "Verify the happy-path login flow",
      level: "system",
      type: "functional",
      priority: "p1",
      riskCategory: "medium",
      technique: "equivalence_partitioning",
      preconditions: ["User has an active account"],
      testData: ["alice@example.test"],
      steps: [{ index: 1, action: "Open the login form" }],
      expectedResults: ["The user is authenticated"],
      figmaTraceRefs: [{ screenId: "screen-login" }],
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
      reviewState: "needs_review",
      audit: {
        jobId,
        generatedAt: ASSEMBLED_AT,
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
        promptTemplateVersion: "1.0.0",
        redactionPolicyVersion: "1.0.0",
        visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
        cacheHit: false,
        cacheKey: "ck-1",
        inputHash: "00",
        promptHash: "11",
        schemaHash: "22",
      },
    },
  ],
});

const sampleValidationReport = (jobId: string): unknown => ({
  schemaVersion: TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: ASSEMBLED_AT,
  jobId,
  totalTestCases: 1,
  errorCount: 0,
  warningCount: 0,
  blocked: false,
  issues: [],
});

const samplePolicyReport = (jobId: string): unknown => ({
  schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: ASSEMBLED_AT,
  jobId,
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
      violations: [],
    },
  ],
  jobLevelViolations: [],
});

const sampleCoverageReport = (jobId: string): unknown => ({
  schemaVersion: TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: ASSEMBLED_AT,
  jobId,
  policyProfileId: "eu-banking-default",
  totalTestCases: 1,
  fieldCoverage: { total: 1, covered: 1, ratio: 1, uncoveredIds: [] },
  actionCoverage: { total: 1, covered: 1, ratio: 1, uncoveredIds: [] },
  validationCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  navigationCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  traceCoverage: { total: 1, withTrace: 1, ratio: 1 },
  negativeCaseCount: 0,
  validationCaseCount: 0,
  boundaryCaseCount: 0,
  accessibilityCaseCount: 0,
  workflowCaseCount: 1,
  positiveCaseCount: 1,
  assumptionsRatio: 0,
  openQuestionsCount: 0,
  duplicatePairs: [],
});

const sampleVisualSidecarReport = (jobId: string): unknown => ({
  schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  generatedAt: ASSEMBLED_AT,
  jobId,
  totalScreens: 1,
  screensWithFindings: 0,
  blocked: false,
  records: [],
});

const sampleQcMappingPreview = (jobId: string): unknown => ({
  schemaVersion: QC_MAPPING_PREVIEW_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId,
  generatedAt: ASSEMBLED_AT,
  profileId: "opentext-alm-default",
  profileVersion: "1.0.0",
  entries: [],
});

const sampleExportReport = (jobId: string): unknown => ({
  schemaVersion: EXPORT_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId,
  generatedAt: ASSEMBLED_AT,
  profileId: "opentext-alm-default",
  profileVersion: "1.0.0",
  modelDeployments: { testGeneration: "gpt-oss-120b" },
  exportedTestCaseCount: 0,
  refused: true,
  refusalCodes: ["unapproved_test_cases_present"],
  artifacts: [],
  visualEvidenceHashes: [],
  rawScreenshotsIncluded: false,
});

const sampleReviewSnapshot = (jobId: string): unknown => ({
  schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId,
  generatedAt: ASSEMBLED_AT,
  perTestCase: [
    {
      testCaseId: "tc-1",
      state: "needs_review",
      policyDecision: "needs_review",
      lastEventId: "evt-1",
      lastEventAt: ASSEMBLED_AT,
      fourEyesEnforced: false,
      approvers: [],
    },
  ],
  approvedCount: 0,
  needsReviewCount: 1,
  rejectedCount: 0,
});

const sampleReviewEventsEnvelope = (jobId: string): unknown => ({
  schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId,
  events: [
    {
      schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      id: "evt-1",
      jobId,
      testCaseId: "tc-1",
      kind: "generated",
      at: ASSEMBLED_AT,
      sequence: 1,
      fromState: "generated",
      toState: "needs_review",
      metadata: { policyDecision: "needs_review" },
    },
  ],
  nextSequence: 2,
});

const sampleMultiSourceReconciliationReport = (jobId: string): unknown => ({
  version: MULTI_SOURCE_RECONCILIATION_REPORT_SCHEMA_VERSION,
  envelopeHash: "c".repeat(64),
  conflicts: [
    {
      conflictId: "conflict-1",
      kind: "field_label_mismatch",
      participatingSourceIds: ["figma-primary", "jira-primary"],
      normalizedValues: ["Login", "Sign in"],
      resolution: "deferred_to_reviewer",
      affectedScreenIds: ["screen-login"],
      detail: `Source mix conflict for ${jobId}.`,
    },
  ],
  unmatchedSources: [],
  contributingSourcesPerCase: [],
  policyApplied: "reviewer_decides",
  transcript: [],
});

const sampleConflictDecisionEnvelope = (jobId: string): unknown => ({
  version: "1.0.0",
  jobId,
  nextSequence: 2,
  events: [
    {
      schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      id: "evt-conflict-1",
      sequence: 1,
      jobId,
      conflictId: "conflict-1",
      action: "approve",
      at: ASSEMBLED_AT,
      actor: "alice",
      selectedSourceId: "jira-primary",
    },
  ],
});

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "ti-bundle-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("isSafeJobId", () => {
  test("accepts alphanumerics, dashes, underscores, dots", () => {
    assert.equal(isSafeJobId("job-1"), true);
    assert.equal(isSafeJobId("job_1"), true);
    assert.equal(isSafeJobId("job.1"), true);
    assert.equal(isSafeJobId("ABC123abc"), true);
  });

  test("rejects path traversal and slashes", () => {
    assert.equal(isSafeJobId(".."), false);
    assert.equal(isSafeJobId("."), false);
    assert.equal(isSafeJobId("../etc"), false);
    assert.equal(isSafeJobId("a/b"), false);
    assert.equal(isSafeJobId("a\\b"), false);
  });

  test("rejects empty and oversized ids", () => {
    assert.equal(isSafeJobId(""), false);
    assert.equal(isSafeJobId("a".repeat(129)), false);
  });
});

describe("readInspectorTestIntelligenceBundle", () => {
  test("returns ok=false when the job directory does not exist", async () => {
    const result = await readInspectorTestIntelligenceBundle({
      rootDir: workDir,
      jobId: "missing",
      assembledAt: ASSEMBLED_AT,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "job_not_found");
    }
  });

  test("returns an empty bundle when the dir exists but contains no artifacts", async () => {
    const jobId = "empty-job";
    await mkdir(join(workDir, jobId), { recursive: true });
    const result = await readInspectorTestIntelligenceBundle({
      rootDir: workDir,
      jobId,
      assembledAt: ASSEMBLED_AT,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.bundle.jobId, jobId);
      assert.equal(result.bundle.assembledAt, ASSEMBLED_AT);
      assert.equal(result.bundle.parseErrors.length, 0);
      assert.equal(result.bundle.generatedTestCases, undefined);
      assert.equal(result.bundle.reviewSnapshot, undefined);
    }
  });

  test("aggregates every artifact when all are present and well-formed", async () => {
    const jobId = "full-job";
    const dir = join(workDir, jobId);
    await mkdir(dir, { recursive: true });
    await Promise.all([
      writeJson(
        join(dir, GENERATED_TESTCASES_ARTIFACT_FILENAME),
        sampleGeneratedTestCases(jobId),
      ),
      writeJson(
        join(dir, TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME),
        sampleValidationReport(jobId),
      ),
      writeJson(
        join(dir, TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME),
        samplePolicyReport(jobId),
      ),
      writeJson(
        join(dir, TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME),
        sampleCoverageReport(jobId),
      ),
      writeJson(
        join(dir, VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME),
        sampleVisualSidecarReport(jobId),
      ),
      writeJson(
        join(dir, QC_MAPPING_PREVIEW_ARTIFACT_FILENAME),
        sampleQcMappingPreview(jobId),
      ),
      writeJson(
        join(dir, EXPORT_REPORT_ARTIFACT_FILENAME),
        sampleExportReport(jobId),
      ),
      writeJson(
        join(dir, REVIEW_STATE_ARTIFACT_FILENAME),
        sampleReviewSnapshot(jobId),
      ),
      writeJson(
        join(dir, REVIEW_EVENTS_ARTIFACT_FILENAME),
        sampleReviewEventsEnvelope(jobId),
      ),
    ]);

    const result = await readInspectorTestIntelligenceBundle({
      rootDir: workDir,
      jobId,
      assembledAt: ASSEMBLED_AT,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const { bundle } = result;
    assert.equal(bundle.parseErrors.length, 0);
    assert.equal(bundle.generatedTestCases?.testCases.length, 1);
    assert.equal(bundle.validationReport?.totalTestCases, 1);
    assert.equal(bundle.policyReport?.policyProfileId, "eu-banking-default");
    assert.equal(bundle.coverageReport?.totalTestCases, 1);
    assert.equal(bundle.visualSidecarReport?.totalScreens, 1);
    assert.equal(bundle.qcMappingPreview?.profileId, "opentext-alm-default");
    assert.equal(bundle.exportReport?.refused, true);
    assert.equal(bundle.reviewSnapshot?.needsReviewCount, 1);
    assert.equal(bundle.reviewEvents?.length, 1);
    assert.equal(bundle.reviewEvents?.[0]?.kind, "generated");
  });

  test("projects effective multi-source conflict state from the append-only log", async () => {
    const jobId = "source-mix-job";
    const dir = join(workDir, jobId);
    await mkdir(dir, { recursive: true });
    await Promise.all([
      writeJson(
        join(dir, MULTI_SOURCE_CONFLICT_REPORT_ARTIFACT_FILENAME),
        sampleMultiSourceReconciliationReport(jobId),
      ),
      writeJson(
        join(dir, "multi-source-conflict-decisions.json"),
        sampleConflictDecisionEnvelope(jobId),
      ),
      writeJson(join(dir, TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME), {
        schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        generatedAt: ASSEMBLED_AT,
        jobId,
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
                rule: "policy:multi-source-conflict-present",
                outcome: "multi_source_conflict_present",
                severity: "warning",
                reason: "multi-source conflict(s) conflict-1 affect this case",
              },
            ],
          },
        ],
        jobLevelViolations: [],
      }),
    ]);

    const result = await readInspectorTestIntelligenceBundle({
      rootDir: workDir,
      jobId,
      assembledAt: ASSEMBLED_AT,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const conflict = result.bundle.multiSourceReconciliation?.conflicts[0];
    assert.equal(conflict?.conflictId, "conflict-1");
    assert.equal(conflict?.effectiveState, "resolved");
    assert.equal(conflict?.resolvedBy, "alice");
    assert.equal(conflict?.resolvedAt, ASSEMBLED_AT);
    assert.equal(result.bundle.conflictDecisions?.["conflict-1"]?.state, "approved");
    assert.equal(result.bundle.policyReport?.decisions[0]?.decision, "approved");
    assert.deepEqual(result.bundle.policyReport?.decisions[0]?.violations, []);
  });

  test("surfaces parse errors instead of throwing on malformed JSON", async () => {
    const jobId = "broken-json";
    const dir = join(workDir, jobId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, GENERATED_TESTCASES_ARTIFACT_FILENAME),
      "{not-json",
      "utf8",
    );
    const result = await readInspectorTestIntelligenceBundle({
      rootDir: workDir,
      jobId,
      assembledAt: ASSEMBLED_AT,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.bundle.generatedTestCases, undefined);
    assert.equal(result.bundle.parseErrors.length, 1);
    assert.equal(result.bundle.parseErrors[0]?.reason, "invalid_json");
    assert.equal(result.bundle.parseErrors[0]?.artifact, "generatedTestCases");
  });

  test("surfaces schema mismatches without losing good artifacts", async () => {
    const jobId = "mixed";
    const dir = join(workDir, jobId);
    await mkdir(dir, { recursive: true });
    await writeJson(join(dir, TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME), {
      unrelated: "shape",
    });
    await writeJson(
      join(dir, REVIEW_STATE_ARTIFACT_FILENAME),
      sampleReviewSnapshot(jobId),
    );
    const result = await readInspectorTestIntelligenceBundle({
      rootDir: workDir,
      jobId,
      assembledAt: ASSEMBLED_AT,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.bundle.validationReport, undefined);
    assert.equal(result.bundle.reviewSnapshot?.jobId, jobId);
    assert.equal(result.bundle.parseErrors.length, 1);
    assert.equal(result.bundle.parseErrors[0]?.reason, "schema_mismatch");
  });
});

describe("listInspectorTestIntelligenceJobs", () => {
  test("returns an empty array when the root directory does not exist", async () => {
    const summaries = await listInspectorTestIntelligenceJobs(
      join(workDir, "missing"),
    );
    assert.deepEqual(summaries, []);
  });

  test("lists every safe job dir and reports artifact presence", async () => {
    const aDir = join(workDir, "job-a");
    const bDir = join(workDir, "job-b");
    await mkdir(aDir, { recursive: true });
    await mkdir(bDir, { recursive: true });
    await writeJson(
      join(aDir, GENERATED_TESTCASES_ARTIFACT_FILENAME),
      sampleGeneratedTestCases("job-a"),
    );
    await writeJson(
      join(bDir, REVIEW_STATE_ARTIFACT_FILENAME),
      sampleReviewSnapshot("job-b"),
    );

    const summaries = await listInspectorTestIntelligenceJobs(workDir);
    assert.equal(summaries.length, 2);
    assert.equal(summaries[0]?.jobId, "job-a");
    assert.equal(summaries[0]?.hasArtifacts.generatedTestCases, true);
    assert.equal(summaries[0]?.hasArtifacts.reviewSnapshot, false);
    assert.equal(summaries[1]?.jobId, "job-b");
    assert.equal(summaries[1]?.hasArtifacts.reviewSnapshot, true);
    assert.equal(summaries[1]?.hasArtifacts.generatedTestCases, false);
  });

  test("ignores entries whose names fail the safe-id filter", async () => {
    await mkdir(join(workDir, "job-ok"), { recursive: true });
    await mkdir(join(workDir, "weird name"), { recursive: true });
    const summaries = await listInspectorTestIntelligenceJobs(workDir);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.jobId, "job-ok");
  });
});
