/**
 * Unit tests for the `test-intelligence tms-push` CLI (Issue #2183).
 *
 * Acceptance:
 *   - Missing `--run-dir` exits with operator error.
 *   - Unknown `--tms` value exits with operator error.
 *   - Missing credentials in env exits 1.
 *   - Successful run writes `tms-push-report.json` and exits 0.
 *   - `--dry-run` propagates to the pipeline.
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
} from "./contracts/index.js";
import {
  parseTestIntelligenceTmsPushArgs,
  runTestIntelligenceTmsPushCommand,
  TestIntelligenceTmsPushOperatorError,
} from "./test-intelligence-tms-push-cli.js";
import {
  type TmsAdapter,
  type TmsHttpClient,
  type TmsHttpRequest,
  type TmsHttpResponse,
} from "./test-intelligence/tms-adapters/tms-adapter-contract.js";

const buildPreview = (): QcMappingPreviewArtifact => ({
  schemaVersion: "1.0.0",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: "job-1",
  generatedAt: "2026-05-11T00:00:00.000Z",
  profileId: "test",
  profileVersion: "1.0.0",
  entries: [
    {
      testCaseId: "tc-1",
      externalIdCandidate: "ext-tc-1",
      testName: "T1",
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
    },
  ],
});

const collectSink = (): {
  stdout: string[];
  stderr: string[];
  sink: { stdout(s: string): void; stderr(s: string): void };
} => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    sink: {
      stdout: (s) => stdout.push(s),
      stderr: (s) => stderr.push(s),
    },
  };
};

const buildFakeHttp = (): TmsHttpClient => ({
  async request(req: TmsHttpRequest): Promise<TmsHttpResponse> {
    void req;
    return { status: 200, headers: {}, body: { id: "id" } };
  },
});

const buildPushedAdapter = (): TmsAdapter => ({
  adapterId: "xray",
  version: "1.0.0",
  supportedAuthKinds: new Set(["pat"]),
  async connect(input) {
    return Object.freeze({
      endpointAlias: input.endpointAlias,
      projectId: input.projectId,
      tenantId: input.tenantId,
      principalId: "test",
      internal: {},
    });
  },
  async validateProject() {
    return { ok: true, resolvedProjectId: "MOCK" };
  },
  mapTestCase(args) {
    return {
      testCaseId: args.entry.testCaseId,
      idempotencyKey: `idem-${args.entry.testCaseId}`,
      payload: { name: args.entry.testName },
    };
  },
  async pushTestCase(args) {
    return {
      testCaseId: args.mapped.testCaseId,
      idempotencyKey: args.mapped.idempotencyKey,
      verdict: "pushed",
      tmsTestCaseId: "MOCK-1",
      tmsErrorCode: "",
      tmsErrorMessage: "",
      attemptCount: 1,
    };
  },
  async pushTestCaseBatch(args) {
    return {
      results: args.mapped.map((m) => ({
        testCaseId: m.testCaseId,
        idempotencyKey: m.idempotencyKey,
        verdict: args.dryRun ? "skipped-dup" : "pushed",
        tmsTestCaseId: args.dryRun ? "" : "MOCK-1",
        tmsErrorCode: "",
        tmsErrorMessage: "",
        attemptCount: args.dryRun ? 0 : 1,
      })),
    };
  },
  async pollSyncStatus() {
    return { found: false, code: "n/a", message: "stub" };
  },
  async disconnect() {},
});

test("parseTestIntelligenceTmsPushArgs: requires --run-dir", () => {
  assert.throws(
    () => parseTestIntelligenceTmsPushArgs([]),
    TestIntelligenceTmsPushOperatorError,
  );
});

test("parseTestIntelligenceTmsPushArgs: rejects unknown --tms value", () => {
  assert.throws(
    () =>
      parseTestIntelligenceTmsPushArgs([
        "--run-dir",
        "/tmp/x",
        "--tms",
        "gizmo",
        "--project",
        "MOCK",
      ]),
    /alm\|polarion\|qtest\|xray/,
  );
});

test("parseTestIntelligenceTmsPushArgs: rejects unknown flags", () => {
  assert.throws(
    () =>
      parseTestIntelligenceTmsPushArgs([
        "--run-dir",
        "/tmp/x",
        "--tms",
        "xray",
        "--project",
        "MOCK",
        "--bogus",
        "x",
      ]),
    /Unknown flag/,
  );
});

test("parseTestIntelligenceTmsPushArgs: parses minimal required flags", () => {
  const opts = parseTestIntelligenceTmsPushArgs([
    "--run-dir",
    "/tmp/x",
    "--tms",
    "xray",
    "--project",
    "MOCK",
  ]);
  assert.equal(opts.runDir, "/tmp/x");
  assert.equal(opts.tms, "xray");
  assert.equal(opts.projectId, "MOCK");
  assert.equal(opts.endpointAlias, "xray-default");
  assert.equal(opts.batchSize, 50);
  assert.equal(opts.dryRun, false);
});

test("runTestIntelligenceTmsPushCommand: missing credentials → exit 1", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "tms-cli-"));
  try {
    const opts = parseTestIntelligenceTmsPushArgs([
      "--run-dir",
      tempDir,
      "--tms",
      "xray",
      "--project",
      "MOCK",
    ]);
    const { sink, stderr } = collectSink();
    const code = await runTestIntelligenceTmsPushCommand({
      options: opts,
      sink,
      env: {},
    });
    assert.equal(code, 1);
    assert.match(stderr.join(""), /credentials/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runTestIntelligenceTmsPushCommand: writes report and exits 0 on success", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "tms-cli-"));
  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      join(tempDir, QC_MAPPING_PREVIEW_ARTIFACT_FILENAME),
      JSON.stringify(buildPreview(), null, 2),
      "utf8",
    );
    const opts = parseTestIntelligenceTmsPushArgs([
      "--run-dir",
      tempDir,
      "--tms",
      "xray",
      "--project",
      "MOCK",
    ]);
    const { sink, stdout } = collectSink();
    const code = await runTestIntelligenceTmsPushCommand({
      options: opts,
      sink,
      env: { WORKSPACE_TEST_SPACE_TMS_XRAY_TOKEN: "tok" },
      clock: { now: () => "2026-05-11T00:00:00.000Z" },
      adapterFactory: buildPushedAdapter,
      httpFactory: buildFakeHttp,
    });
    assert.equal(code, 0, stdout.join(""));
    const persisted = JSON.parse(
      await readFile(
        join(tempDir, TMS_PUSH_REPORT_ARTIFACT_FILENAME),
        "utf8",
      ),
    ) as TmsPushReportArtifact;
    assert.equal(persisted.refused, false);
    assert.equal(persisted.pushedCount, 1);
    assert.equal(persisted.entries.length, 1);
    assert.equal(persisted.entries[0]!.tmsTestCaseId, "MOCK-1");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runTestIntelligenceTmsPushCommand: --dry-run propagates", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "tms-cli-"));
  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      join(tempDir, QC_MAPPING_PREVIEW_ARTIFACT_FILENAME),
      JSON.stringify(buildPreview(), null, 2),
      "utf8",
    );
    const opts = parseTestIntelligenceTmsPushArgs([
      "--run-dir",
      tempDir,
      "--tms",
      "xray",
      "--project",
      "MOCK",
      "--dry-run",
    ]);
    const { sink } = collectSink();
    const code = await runTestIntelligenceTmsPushCommand({
      options: opts,
      sink,
      env: { WORKSPACE_TEST_SPACE_TMS_XRAY_TOKEN: "tok" },
      clock: { now: () => "2026-05-11T00:00:00.000Z" },
      adapterFactory: buildPushedAdapter,
      httpFactory: buildFakeHttp,
    });
    assert.equal(code, 0);
    const persisted = JSON.parse(
      await readFile(
        join(tempDir, TMS_PUSH_REPORT_ARTIFACT_FILENAME),
        "utf8",
      ),
    ) as TmsPushReportArtifact;
    assert.equal(persisted.dryRun, true);
    assert.equal(persisted.skippedDuplicateCount, 1);
    assert.equal(persisted.pushedCount, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
