/**
 * Unit tests for the TMS push orchestrator (Issue #2183).
 *
 * Acceptance:
 *   - Refusal-only run (missing mapping preview) produces an artifact
 *     with `refused: true` + `refusalCodes: ["mapping_preview_missing"]`.
 *   - Empty preview triggers `no_mapped_test_cases`.
 *   - Successful run sorts entries by testCaseId and counts verdicts.
 *   - `--dry-run` never issues a push, but still writes the report.
 *   - The artifact contains required hard-invariant flags
 *     (`rawScreenshotsIncluded: false`, `credentialsIncluded: false`,
 *      `transferUrlIncluded: false`).
 *   - Atomic write: the persisted file is parseable JSON.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  QC_MAPPING_PREVIEW_ARTIFACT_FILENAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TMS_PUSH_REPORT_ARTIFACT_FILENAME,
  type QcMappingPreviewArtifact,
  type TmsPushReportArtifact,
} from "../../contracts/index.js";
import { runTmsPushPipeline } from "./tms-push-pipeline.js";
import {
  type TmsAdapter,
  type TmsAdapterClock,
  type TmsAdapterSession,
  type TmsConnectInput,
  type TmsMappedCase,
  type TmsPushAttemptResult,
  type TmsPushBatchResult,
  type TmsSyncStatus,
  type TmsValidateProjectResult,
} from "./tms-adapter-contract.js";

const FIXED_TIMESTAMP = "2026-05-11T00:00:00.000Z";
const fixedClock: TmsAdapterClock = { now: () => FIXED_TIMESTAMP };

const buildFakeAdapter = (overrides: {
  pushResults: (mapped: readonly TmsMappedCase[]) => TmsPushAttemptResult[];
  validateOk?: boolean;
}): TmsAdapter => ({
  adapterId: "xray",
  version: "1.0.0",
  supportedAuthKinds: new Set(["pat"]),
  async connect(input: TmsConnectInput): Promise<TmsAdapterSession> {
    return Object.freeze({
      endpointAlias: input.endpointAlias,
      projectId: input.projectId,
      tenantId: input.tenantId,
      principalId: "test-principal",
      internal: {},
    });
  },
  async validateProject(): Promise<TmsValidateProjectResult> {
    if (overrides.validateOk === false) {
      return { ok: false, code: "project_not_found", message: "missing" };
    }
    return { ok: true, resolvedProjectId: "MOCK" };
  },
  mapTestCase(args): TmsMappedCase {
    return {
      testCaseId: args.entry.testCaseId,
      idempotencyKey: `idem-${args.entry.testCaseId}`,
      payload: { name: args.entry.testName },
    };
  },
  async pushTestCase(args): Promise<TmsPushAttemptResult> {
    return overrides.pushResults([args.mapped])[0]!;
  },
  async pushTestCaseBatch(args): Promise<TmsPushBatchResult> {
    return { results: overrides.pushResults(args.mapped) };
  },
  async pollSyncStatus(): Promise<TmsSyncStatus> {
    return { found: false, code: "n/a", message: "test stub" };
  },
  async disconnect(): Promise<void> {
    /* no-op */
  },
});

const writePreview = async (
  runDir: string,
  preview: QcMappingPreviewArtifact,
): Promise<void> => {
  await mkdir(runDir, { recursive: true });
  await writeFile(
    join(runDir, QC_MAPPING_PREVIEW_ARTIFACT_FILENAME),
    JSON.stringify(preview, null, 2),
    "utf8",
  );
};

const buildPreview = (entries: { testCaseId: string }[]): QcMappingPreviewArtifact => ({
  schemaVersion: "1.0.0",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: "job-1",
  generatedAt: FIXED_TIMESTAMP,
  profileId: "test",
  profileVersion: "1.0.0",
  entries: entries.map((e) => ({
    testCaseId: e.testCaseId,
    externalIdCandidate: `ext-${e.testCaseId}`,
    testName: `Test ${e.testCaseId}`,
    objective: "verify",
    priority: "P2",
    riskCategory: "regulated",
    targetFolderPath: "/Subject/X",
    preconditions: [],
    testData: [],
    designSteps: [],
    expectedResults: [],
    sourceTraceRefs: [],
    exportable: true,
    blockingReasons: [],
  })),
});

test("tms-push-pipeline: refused on missing mapping preview", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "tms-pipeline-"));
  try {
    const adapter = buildFakeAdapter({
      pushResults: () => [],
    });
    const result = await runTmsPushPipeline({
      adapter,
      endpointAlias: "xray-test",
      projectId: "MOCK",
      tenantId: "t",
      runDir: tempDir,
      runId: "run-1",
      credentials: { kind: "pat", token: "x" },
      clock: fixedClock,
      dryRun: false,
    });
    assert.equal(result.report.refused, true);
    assert.deepEqual(result.report.refusalCodes, ["mapping_preview_missing"]);
    // Persisted artifact is parseable JSON.
    const persisted = JSON.parse(
      await readFile(
        join(tempDir, TMS_PUSH_REPORT_ARTIFACT_FILENAME),
        "utf8",
      ),
    ) as TmsPushReportArtifact;
    assert.equal(persisted.refused, true);
    assert.equal(persisted.adapterId, "xray");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("tms-push-pipeline: refused on empty preview", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "tms-pipeline-"));
  try {
    await writePreview(tempDir, buildPreview([]));
    const adapter = buildFakeAdapter({ pushResults: () => [] });
    const result = await runTmsPushPipeline({
      adapter,
      endpointAlias: "xray-test",
      projectId: "MOCK",
      tenantId: "t",
      runDir: tempDir,
      runId: "run-1",
      credentials: { kind: "pat", token: "x" },
      clock: fixedClock,
      dryRun: false,
    });
    assert.equal(result.report.refused, true);
    assert.deepEqual(result.report.refusalCodes, ["no_mapped_test_cases"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("tms-push-pipeline: pushed entries sorted by testCaseId, counts correct", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "tms-pipeline-"));
  try {
    await writePreview(
      tempDir,
      buildPreview([{ testCaseId: "c-3" }, { testCaseId: "a-1" }, { testCaseId: "b-2" }]),
    );
    const adapter = buildFakeAdapter({
      pushResults: (mapped) =>
        mapped.map((m, i) => ({
          testCaseId: m.testCaseId,
          idempotencyKey: m.idempotencyKey,
          verdict: i === 0 ? "pushed" : i === 1 ? "skipped-dup" : "failed",
          tmsTestCaseId: i === 2 ? "" : `id-${m.testCaseId}`,
          tmsErrorCode: i === 2 ? "boom" : "",
          tmsErrorMessage: i === 2 ? "fail" : "",
          attemptCount: 1,
        })),
    });
    const result = await runTmsPushPipeline({
      adapter,
      endpointAlias: "xray-test",
      projectId: "MOCK",
      tenantId: "t",
      runDir: tempDir,
      runId: "run-1",
      credentials: { kind: "pat", token: "x" },
      clock: fixedClock,
      dryRun: false,
    });
    const ids = result.report.entries.map((e) => e.testCaseId);
    assert.deepEqual(ids, ["a-1", "b-2", "c-3"]);
    assert.equal(result.report.refused, false);
    assert.equal(result.report.pushedCount, 1);
    assert.equal(result.report.skippedDuplicateCount, 1);
    assert.equal(result.report.failedCount, 1);
    assert.equal(result.report.rawScreenshotsIncluded, false);
    assert.equal(result.report.credentialsIncluded, false);
    assert.equal(result.report.transferUrlIncluded, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("tms-push-pipeline: validateProject failure records project_validation_failed", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "tms-pipeline-"));
  try {
    await writePreview(tempDir, buildPreview([{ testCaseId: "tc-1" }]));
    const adapter = buildFakeAdapter({
      validateOk: false,
      pushResults: () => [],
    });
    const result = await runTmsPushPipeline({
      adapter,
      endpointAlias: "xray-test",
      projectId: "MISSING",
      tenantId: "t",
      runDir: tempDir,
      runId: "run-1",
      credentials: { kind: "pat", token: "x" },
      clock: fixedClock,
      dryRun: false,
    });
    assert.equal(result.report.refused, true);
    assert.deepEqual(result.report.refusalCodes, [
      "project_validation_failed",
    ]);
    assert.equal(result.report.failedCount, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("tms-push-pipeline: dryRun reports skipped-dup verdicts", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "tms-pipeline-"));
  try {
    await writePreview(tempDir, buildPreview([{ testCaseId: "tc-1" }]));
    const adapter = buildFakeAdapter({
      pushResults: (mapped) =>
        mapped.map((m) => ({
          testCaseId: m.testCaseId,
          idempotencyKey: m.idempotencyKey,
          verdict: "skipped-dup",
          tmsTestCaseId: "",
          tmsErrorCode: "",
          tmsErrorMessage: "",
          attemptCount: 0,
        })),
    });
    const result = await runTmsPushPipeline({
      adapter,
      endpointAlias: "xray-test",
      projectId: "MOCK",
      tenantId: "t",
      runDir: tempDir,
      runId: "run-1",
      credentials: { kind: "pat", token: "x" },
      clock: fixedClock,
      dryRun: true,
    });
    assert.equal(result.report.dryRun, true);
    assert.equal(result.report.skippedDuplicateCount, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
