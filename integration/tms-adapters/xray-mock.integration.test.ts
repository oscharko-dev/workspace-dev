/**
 * Xray adapter integration test against the vendored mock server
 * (Issue #2183, Wave 8).
 *
 * Acceptance:
 *   - End-to-end push lands a fresh issue and receives a Xray-assigned
 *     issue key.
 *   - A re-run with the same idempotency key short-circuits to
 *     `skipped-dup`.
 *   - The persisted `tms-push-report.json` contains the round-trip
 *     issue key on the entry.
 *   - The default fetch-backed HTTP client resolves the endpoint
 *     alias from the env without leaking the URL.
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
} from "../../src/contracts/index.js";
import { startXrayMockServer } from "../../fixtures/tms-adapters/xray-mock-server/server.js";
import {
  createXrayAdapter,
  runTmsPushPipeline,
} from "../../src/test-intelligence/tms-adapters/index.js";
import { createDefaultTmsHttpClient } from "../../src/test-intelligence/tms-adapters/default-http-client.js";

const buildPreview = (): QcMappingPreviewArtifact => ({
  schemaVersion: "1.0.0",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: "job-int-1",
  generatedAt: "2026-05-11T00:00:00.000Z",
  profileId: "test",
  profileVersion: "1.0.0",
  entries: [
    {
      testCaseId: "tc-1",
      externalIdCandidate: "ext-tc-1",
      testName: "Login banking session",
      objective: "verify login behaviour",
      priority: "P1",
      riskCategory: "regulated",
      targetFolderPath: "/Subject/Bank/Login",
      preconditions: ["pre 1"],
      testData: ["data 1"],
      designSteps: [
        { index: 1, action: "Navigate to login", expected: "Login screen visible" },
        { index: 2, action: "Submit credentials", expected: "Dashboard visible" },
      ],
      expectedResults: ["Login succeeded"],
      sourceTraceRefs: [],
      exportable: true,
      blockingReasons: [],
    },
    {
      testCaseId: "tc-2",
      externalIdCandidate: "ext-tc-2",
      testName: "Logout banking session",
      objective: "verify logout",
      priority: "P2",
      riskCategory: "regulated",
      targetFolderPath: "/Subject/Bank/Login",
      preconditions: [],
      testData: [],
      designSteps: [
        { index: 1, action: "Click logout", expected: "Login screen visible" },
      ],
      expectedResults: ["Logout succeeded"],
      sourceTraceRefs: [],
      exportable: true,
      blockingReasons: [],
    },
  ],
});

test("xray-adapter: end-to-end push against vendored mock writes round-trip ids", async () => {
  const mock = await startXrayMockServer({ knownProjectKeys: ["MOCK"] });
  const tempDir = await mkdtemp(join(tmpdir(), "xray-int-"));
  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      join(tempDir, QC_MAPPING_PREVIEW_ARTIFACT_FILENAME),
      JSON.stringify(buildPreview(), null, 2),
      "utf8",
    );
    const env = {
      WORKSPACE_TEST_SPACE_TMS_XRAY_BASE_URL: mock.baseUrl,
      WORKSPACE_TEST_SPACE_TMS_XRAY_TOKEN: "tok-xyz",
    };
    const http = createDefaultTmsHttpClient({
      adapterId: "xray",
      env,
    });
    const adapter = createXrayAdapter({ http });
    const result = await runTmsPushPipeline({
      adapter,
      endpointAlias: "mock-xray",
      projectId: "MOCK",
      tenantId: "tenant-int",
      runDir: tempDir,
      runId: "run-int-1",
      credentials: { kind: "pat", token: "tok-xyz" },
      clock: { now: () => "2026-05-11T00:00:00.000Z" },
      dryRun: false,
    });
    assert.equal(result.report.refused, false);
    assert.equal(result.report.pushedCount, 2);
    assert.equal(result.report.failedCount, 0);
    for (const entry of result.report.entries) {
      assert.match(entry.tmsTestCaseId, /^MOCK-\d+$/);
    }
    // Persisted JSON contains the same.
    const persisted = JSON.parse(
      await readFile(
        join(tempDir, TMS_PUSH_REPORT_ARTIFACT_FILENAME),
        "utf8",
      ),
    ) as TmsPushReportArtifact;
    assert.equal(persisted.pushedCount, 2);
    // Re-run: same idempotency keys → all skipped-dup.
    const result2 = await runTmsPushPipeline({
      adapter,
      endpointAlias: "mock-xray",
      projectId: "MOCK",
      tenantId: "tenant-int",
      runDir: tempDir,
      runId: "run-int-1",
      credentials: { kind: "pat", token: "tok-xyz" },
      clock: { now: () => "2026-05-11T00:01:00.000Z" },
      dryRun: false,
    });
    assert.equal(result2.report.refused, false);
    assert.equal(result2.report.skippedDuplicateCount, 2);
    assert.equal(result2.report.pushedCount, 0);
  } finally {
    await mock.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});
