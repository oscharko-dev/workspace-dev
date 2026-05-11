/**
 * OpenText / HP ALM adapter integration test against the vendored
 * mock server (Issue #2183, Wave 8).
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
import { startAlmMockServer } from "../../fixtures/tms-adapters/alm-mock-server/server.js";
import {
  createAlmAdapter,
  runTmsPushPipeline,
} from "../../src/test-intelligence/tms-adapters/index.js";
import { createDefaultTmsHttpClient } from "../../src/test-intelligence/tms-adapters/default-http-client.js";

const buildPreview = (): QcMappingPreviewArtifact => ({
  schemaVersion: "1.0.0",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: "job-int-a1",
  generatedAt: "2026-05-11T00:00:00.000Z",
  profileId: "test",
  profileVersion: "1.0.0",
  entries: [
    {
      testCaseId: "tc-a1",
      externalIdCandidate: "ext-a1",
      testName: "ALM test",
      objective: "verify",
      priority: "P3",
      riskCategory: "regulated",
      targetFolderPath: "/Subject/X",
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

test("alm-adapter: end-to-end push against vendored mock writes id and dedupes", async () => {
  const mock = await startAlmMockServer({
    knownProjects: [{ domain: "DEFAULT", project: "mock-project" }],
  });
  const tempDir = await mkdtemp(join(tmpdir(), "alm-int-"));
  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      join(tempDir, QC_MAPPING_PREVIEW_ARTIFACT_FILENAME),
      JSON.stringify(buildPreview(), null, 2),
      "utf8",
    );
    const env = {
      WORKSPACE_TEST_SPACE_TMS_ALM_BASE_URL: mock.baseUrl,
      WORKSPACE_TEST_SPACE_TMS_ALM_TOKEN: "tok",
    };
    const http = createDefaultTmsHttpClient({ adapterId: "alm", env });
    const adapter = createAlmAdapter({ http });
    const result = await runTmsPushPipeline({
      adapter,
      endpointAlias: "mock-alm",
      projectId: "DEFAULT/mock-project",
      tenantId: "tenant-a",
      runDir: tempDir,
      runId: "run-a-1",
      credentials: { kind: "pat", token: "tok" },
      clock: { now: () => "2026-05-11T00:00:00.000Z" },
      dryRun: false,
    });
    assert.equal(result.report.refused, false);
    assert.equal(result.report.pushedCount, 1);
    assert.match(result.report.entries[0]!.tmsTestCaseId, /^\d+$/);
    // Re-run: lookup by name finds the entity → skipped-dup.
    const result2 = await runTmsPushPipeline({
      adapter,
      endpointAlias: "mock-alm",
      projectId: "DEFAULT/mock-project",
      tenantId: "tenant-a",
      runDir: tempDir,
      runId: "run-a-1",
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
