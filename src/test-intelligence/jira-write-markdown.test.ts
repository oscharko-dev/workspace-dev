/**
 * Tests for the Jira sub-task markdown artifact writer (Issue #1482).
 *
 * Verifies the per-test-case file set, dry-run surfacing in
 * `manifest.md`, errors.md presence/absence semantics, safeId
 * determinism, and the no-secrets invariant.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fc from "fast-check";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type GeneratedTestCase,
  type JiraSubTaskRecord,
} from "../contracts/index.js";
import {
  buildJiraWriteMarkdownSafeId,
  writeJiraSubtaskMarkdownArtifacts,
} from "./jira-write-markdown.js";

const JOB_ID = "job-1482";
const PARENT_KEY = "PROJ-101";
const GENERATED_AT = "2026-04-27T10:00:00.000Z";

const fixedClock = { now: () => GENERATED_AT };

const buildTestCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: JOB_ID,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Pay with valid IBAN",
  objective: "Ensure a valid IBAN is accepted by the payment form.",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "regulated_data",
  technique: "use_case",
  preconditions: ["Logged-in user"],
  testData: ["IBAN: <redacted>"],
  steps: [
    { index: 1, action: "Open payment screen", expected: "Form is shown" },
    {
      index: 2,
      action: "Enter IBAN and submit",
      expected: "Confirmation page",
    },
  ],
  expectedResults: ["Payment is recorded with status confirmed."],
  figmaTraceRefs: [],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: {
    targetFolderPath: "/Subject/Demo",
    externalIdCandidate: "ext-tc-1",
    designStepCount: 2,
    exportable: true,
  },
  qualitySignals: { confidence: 0.9, ambiguities: [] },
  reviewState: "approved",
  audit: {
    reasoning: ["covers the IBAN happy path"],
    promptHash: "x".repeat(64),
    schemaHash: "y".repeat(64),
    modelDeployment: "gpt-oss-120b",
    finishReason: "stop",
    inputTokens: 100,
    outputTokens: 50,
  },
  ...overrides,
});

const withTempDir = async (
  body: (dir: string) => Promise<void>,
): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), "jira-write-md-"));
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const goodRecord = (id: string, issueKey: string): JiraSubTaskRecord => ({
  testCaseId: id,
  externalId: "0".repeat(64),
  outcome: "created",
  jiraIssueKey: issueKey,
});

const failedRecord = (
  id: string,
  detail: string = "transport blew up",
  retryable: boolean = true,
): JiraSubTaskRecord => ({
  testCaseId: id,
  externalId: "1".repeat(64),
  outcome: "failed",
  failureClass: "transport_error",
  retryable,
  failureDetail: detail,
});

const dryRunRecord = (id: string): JiraSubTaskRecord => ({
  testCaseId: id,
  externalId: "2".repeat(64),
  outcome: "dry_run",
});

/* ------------------------------------------------------------------ */
/*  Happy path                                                            */
/* ------------------------------------------------------------------ */

test("happy path produces manifest, summary, request/response/testcase per case", async () => {
  await withTempDir(async (outputDir) => {
    const cases = [
      buildTestCase({ id: "tc-a" }),
      buildTestCase({ id: "tc-b" }),
    ];
    const records = [
      goodRecord("tc-a", "PROJ-200"),
      goodRecord("tc-b", "PROJ-201"),
    ];
    const result = await writeJiraSubtaskMarkdownArtifacts({
      jobId: JOB_ID,
      parentIssueKey: PARENT_KEY,
      subtaskOutcomes: records,
      dryRun: false,
      outputDir,
      testCases: cases,
      clock: fixedClock,
    });
    assert.equal(result.errorsPath, null);
    assert.ok(result.manifestPath.endsWith("manifest.md"));
    assert.ok(result.summaryPath.endsWith("summary.md"));
    const files = await readdir(outputDir);
    for (const id of ["tc-a", "tc-b"]) {
      const safeId = buildJiraWriteMarkdownSafeId(id);
      assert.ok(files.includes(`jira-request-${safeId}.md`));
      assert.ok(files.includes(`jira-response-${safeId}.md`));
      assert.ok(files.includes(`testcase-${safeId}.md`));
    }
    assert.equal(Object.keys(result.requestPaths).length, 2);
  });
});

/* ------------------------------------------------------------------ */
/*  dryRun surfacing                                                      */
/* ------------------------------------------------------------------ */

test("dryRun=true surfaces in manifest.md content", async () => {
  await withTempDir(async (outputDir) => {
    const cases = [buildTestCase({ id: "tc-a" })];
    const records = [dryRunRecord("tc-a")];
    const result = await writeJiraSubtaskMarkdownArtifacts({
      jobId: JOB_ID,
      parentIssueKey: PARENT_KEY,
      subtaskOutcomes: records,
      dryRun: true,
      outputDir,
      testCases: cases,
      clock: fixedClock,
    });
    const manifest = await readFile(result.manifestPath, "utf8");
    assert.match(manifest, /Dry Run: true/);
    assert.match(manifest, /Dry-Run Outcomes: 1/);
    const summary = await readFile(result.summaryPath, "utf8");
    assert.match(summary, /Dry-run completed/);
  });
});

test("dryRun=false surfaces in manifest.md content", async () => {
  await withTempDir(async (outputDir) => {
    const cases = [buildTestCase({ id: "tc-a" })];
    const records = [goodRecord("tc-a", "PROJ-300")];
    const result = await writeJiraSubtaskMarkdownArtifacts({
      jobId: JOB_ID,
      parentIssueKey: PARENT_KEY,
      subtaskOutcomes: records,
      dryRun: false,
      outputDir,
      testCases: cases,
      clock: fixedClock,
    });
    const manifest = await readFile(result.manifestPath, "utf8");
    assert.match(manifest, /Dry Run: false/);
  });
});

/* ------------------------------------------------------------------ */
/*  errors.md absence semantics                                           */
/* ------------------------------------------------------------------ */

test("errors.md absent when no failures occurred", async () => {
  await withTempDir(async (outputDir) => {
    const cases = [buildTestCase({ id: "tc-a" })];
    const records = [goodRecord("tc-a", "PROJ-400")];
    const result = await writeJiraSubtaskMarkdownArtifacts({
      jobId: JOB_ID,
      parentIssueKey: PARENT_KEY,
      subtaskOutcomes: records,
      dryRun: false,
      outputDir,
      testCases: cases,
      clock: fixedClock,
    });
    assert.equal(result.errorsPath, null);
    const files = await readdir(outputDir);
    assert.ok(!files.includes("errors.md"));
  });
});

test("errors.md present when at least one case failed", async () => {
  await withTempDir(async (outputDir) => {
    const cases = [
      buildTestCase({ id: "tc-a" }),
      buildTestCase({ id: "tc-b" }),
    ];
    const records = [
      goodRecord("tc-a", "PROJ-500"),
      failedRecord("tc-b", "network blew up"),
    ];
    const result = await writeJiraSubtaskMarkdownArtifacts({
      jobId: JOB_ID,
      parentIssueKey: PARENT_KEY,
      subtaskOutcomes: records,
      dryRun: false,
      outputDir,
      testCases: cases,
      clock: fixedClock,
    });
    assert.notEqual(result.errorsPath, null);
    const errorsPath = result.errorsPath;
    assert.ok(errorsPath !== null);
    const errors = await readFile(errorsPath, "utf8");
    assert.match(errors, /tc-b/);
    assert.match(errors, /transport_error/);
    assert.match(errors, /Retryable: true/);
    const responsePath = result.responsePaths["tc-b"];
    assert.ok(responsePath);
    const response = await readFile(responsePath, "utf8");
    assert.match(response, /Retryable: true/);
  });
});

/* ------------------------------------------------------------------ */
/*  safeId determinism                                                    */
/* ------------------------------------------------------------------ */

test("safeId is deterministic across calls", () => {
  const a = buildJiraWriteMarkdownSafeId("tc-1");
  const b = buildJiraWriteMarkdownSafeId("tc-1");
  assert.equal(a, b);
  assert.equal(a.length, 16);
  assert.match(a, /^[a-f0-9]{16}$/u);
});

test("safeId differs across distinct ids", () => {
  const a = buildJiraWriteMarkdownSafeId("tc-1");
  const b = buildJiraWriteMarkdownSafeId("tc-2");
  assert.notEqual(a, b);
});

/* ------------------------------------------------------------------ */
/*  No-secrets property                                                   */
/* ------------------------------------------------------------------ */

test("property: no Bearer/Authorization token leaks into any markdown file", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc
        .string({ minLength: 8, maxLength: 64 })
        .filter((s) => s.trim().length > 0),
      async (failureDetail) => {
        await withTempDir(async (outputDir) => {
          const tokenSeed = `Bearer abc-secret-${failureDetail}-XYZ`;
          const cases = [
            buildTestCase({
              id: "tc-prop",
              testData: [`IBAN: ${tokenSeed}`],
              steps: [
                {
                  index: 1,
                  action: `submit ${tokenSeed}`,
                  expected: "ok",
                },
              ],
            }),
          ];
          const records = [
            failedRecord("tc-prop", `request failed ${tokenSeed}`),
          ];
          await writeJiraSubtaskMarkdownArtifacts({
            jobId: JOB_ID,
            parentIssueKey: PARENT_KEY,
            subtaskOutcomes: records,
            dryRun: false,
            outputDir,
            testCases: cases,
            clock: fixedClock,
          });
          const files = await readdir(outputDir);
          for (const file of files) {
            if (!file.endsWith(".md")) continue;
            const text = await readFile(join(outputDir, file), "utf8");
            assert.ok(
              !/Bearer\s+[A-Za-z0-9_.+/=:-]{16,}/.test(text),
              `Bearer-shaped token leaked into ${file}: ${text.slice(0, 200)}`,
            );
          }
        });
      },
    ),
    { numRuns: 12 },
  );
});

test("URL stripper redacts http/https URLs from failure detail", async () => {
  await withTempDir(async (outputDir) => {
    const cases = [buildTestCase({ id: "tc-url" })];
    const records = [
      failedRecord(
        "tc-url",
        "request to https://leaky.example.com/api/secret failed",
      ),
    ];
    const result = await writeJiraSubtaskMarkdownArtifacts({
      jobId: JOB_ID,
      parentIssueKey: PARENT_KEY,
      subtaskOutcomes: records,
      dryRun: false,
      outputDir,
      testCases: cases,
      clock: fixedClock,
    });
    assert.ok(result.errorsPath !== null);
    const errors = await readFile(result.errorsPath, "utf8");
    assert.doesNotMatch(errors, /leaky\.example\.com/u);
    assert.match(errors, /\[redacted-url\]/);
  });
});
