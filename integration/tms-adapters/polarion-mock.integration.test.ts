/**
 * Polarion adapter integration test against the vendored mock server
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
import { startPolarionMockServer } from "../../fixtures/tms-adapters/polarion-mock-server/server.js";
import {
  createPolarionAdapter,
  runTmsPushPipeline,
} from "../../src/test-intelligence/tms-adapters/index.js";
import { createDefaultTmsHttpClient } from "../../src/test-intelligence/tms-adapters/default-http-client.js";

const buildPreview = (): QcMappingPreviewArtifact => ({
  schemaVersion: "1.0.0",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: "job-int-p1",
  generatedAt: "2026-05-11T00:00:00.000Z",
  profileId: "test",
  profileVersion: "1.0.0",
  entries: [
    {
      testCaseId: "tc-p1",
      externalIdCandidate: "ext-p1",
      testName: "Polarion test",
      objective: "verify",
      priority: "P0",
      riskCategory: "regulated",
      targetFolderPath: "/Subject/X",
      preconditions: ["pre"],
      testData: [],
      designSteps: [{ index: 1, action: "Step", expected: "Result" }],
      expectedResults: ["Result"],
      sourceTraceRefs: [],
      exportable: true,
      blockingReasons: [],
    },
  ],
});

test("polarion-adapter: end-to-end push then re-run dedupes via deterministic id", async () => {
  const mock = await startPolarionMockServer({
    knownProjectIds: ["mock-project"],
  });
  const tempDir = await mkdtemp(join(tmpdir(), "polarion-int-"));
  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      join(tempDir, QC_MAPPING_PREVIEW_ARTIFACT_FILENAME),
      JSON.stringify(buildPreview(), null, 2),
      "utf8",
    );
    const env = {
      WORKSPACE_TEST_SPACE_TMS_POLARION_BASE_URL: mock.baseUrl,
      WORKSPACE_TEST_SPACE_TMS_POLARION_TOKEN: "tok",
    };
    const http = createDefaultTmsHttpClient({ adapterId: "polarion", env });
    const adapter = createPolarionAdapter({ http });
    const result = await runTmsPushPipeline({
      adapter,
      endpointAlias: "mock-polarion",
      projectId: "mock-project",
      tenantId: "tenant-p",
      runDir: tempDir,
      runId: "run-p-1",
      credentials: { kind: "pat", token: "tok" },
      clock: { now: () => "2026-05-11T00:00:00.000Z" },
      dryRun: false,
    });
    assert.equal(result.report.refused, false);
    assert.equal(result.report.pushedCount, 1);
    // Re-run: the deterministic id triggers Polarion's 200 dedupe path.
    const result2 = await runTmsPushPipeline({
      adapter,
      endpointAlias: "mock-polarion",
      projectId: "mock-project",
      tenantId: "tenant-p",
      runDir: tempDir,
      runId: "run-p-1",
      credentials: { kind: "pat", token: "tok" },
      clock: { now: () => "2026-05-11T00:01:00.000Z" },
      dryRun: false,
    });
    assert.equal(result2.report.skippedDuplicateCount, 1);
    assert.equal(result2.report.pushedCount, 0);
  } finally {
    await mock.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});
