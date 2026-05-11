/**
 * qTest adapter integration test against the vendored mock server
 * (Issue #2183, Wave 8).
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  QC_MAPPING_PREVIEW_ARTIFACT_FILENAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type QcMappingPreviewArtifact,
} from "../../src/contracts/index.js";
import { startQtestMockServer } from "../../fixtures/tms-adapters/qtest-mock-server/server.js";
import {
  createQtestAdapter,
  runTmsPushPipeline,
} from "../../src/test-intelligence/tms-adapters/index.js";
import { createDefaultTmsHttpClient } from "../../src/test-intelligence/tms-adapters/default-http-client.js";

const buildPreview = (): QcMappingPreviewArtifact => ({
  schemaVersion: "1.0.0",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: "job-int-q1",
  generatedAt: "2026-05-11T00:00:00.000Z",
  profileId: "test",
  profileVersion: "1.0.0",
  entries: [
    {
      testCaseId: "tc-q1",
      externalIdCandidate: "ext-q1",
      testName: "Login banking session",
      objective: "verify",
      priority: "P1",
      riskCategory: "regulated",
      targetFolderPath: "/Subject/Bank/Login",
      preconditions: [],
      testData: [],
      designSteps: [{ index: 1, action: "Step", expected: "Result" }],
      expectedResults: ["Result"],
      sourceTraceRefs: [],
      exportable: true,
      blockingReasons: [],
    },
  ],
});

test("qtest-adapter: end-to-end push against vendored mock returns numeric id", async () => {
  const mock = await startQtestMockServer({ knownProjectIds: ["mock-project"] });
  const tempDir = await mkdtemp(join(tmpdir(), "qtest-int-"));
  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      join(tempDir, QC_MAPPING_PREVIEW_ARTIFACT_FILENAME),
      JSON.stringify(buildPreview(), null, 2),
      "utf8",
    );
    const env = {
      WORKSPACE_TEST_SPACE_TMS_QTEST_BASE_URL: mock.baseUrl,
      WORKSPACE_TEST_SPACE_TMS_QTEST_OAUTH_ACCESS_TOKEN: "tok",
    };
    const http = createDefaultTmsHttpClient({ adapterId: "qtest", env });
    const adapter = createQtestAdapter({ http });
    const result = await runTmsPushPipeline({
      adapter,
      endpointAlias: "mock-qtest",
      projectId: "mock-project",
      tenantId: "tenant-q",
      runDir: tempDir,
      runId: "run-q-1",
      credentials: { kind: "oauth2", accessToken: "tok" },
      clock: { now: () => "2026-05-11T00:00:00.000Z" },
      dryRun: false,
    });
    assert.equal(result.report.refused, false);
    assert.equal(result.report.pushedCount, 1);
    assert.match(result.report.entries[0]!.tmsTestCaseId, /^\d+$/);
  } finally {
    await mock.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});
