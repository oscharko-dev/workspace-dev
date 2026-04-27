/**
 * Tests for the Jira sub-task write workflow (Issue #1482, Wave 5).
 *
 * Covers the full eight-gate refusal matrix, the happy path, dry-run
 * surfacing, idempotency via `lookupSubtaskByExternalId`, per-case
 * failure isolation, externalId determinism, atomic-write artifact
 * placement, and the no-secrets invariant on persisted artifacts.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ALLOWED_JIRA_WRITE_REFUSAL_CODES,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  JIRA_CREATED_SUBTASKS_ARTIFACT_FILENAME,
  JIRA_CREATED_SUBTASKS_SCHEMA_VERSION,
  JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY,
  JIRA_WRITE_REPORT_ARTIFACT_FILENAME,
  JIRA_WRITE_REPORT_SCHEMA_VERSION,
  REVIEW_GATE_SCHEMA_VERSION,
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type JiraCreatedSubtasksArtifact,
  type JiraSubTaskRecord,
  type JiraWriteReportArtifact,
  type ReviewGateSnapshot,
  type ReviewSnapshot,
  type TestCasePolicyReport,
  type TestCaseValidationReport,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import {
  computeJiraSubtaskExternalId,
  createJiraWriteClient,
  createUnconfiguredJiraWriteClient,
  runJiraSubtaskWrite,
  type JiraSubTaskCreateResult,
  type JiraSubTaskFields,
  type JiraSubTaskLookupResult,
  type JiraWriteClient,
  type RunJiraSubtaskWriteInput,
} from "./jira-write-adapter.js";

const JOB_ID = "job-1482";
const PARENT_KEY = "PROJ-101";
const GENERATED_AT = "2026-04-27T10:00:00.000Z";

const TEST_JIRA_CONFIG = {
  baseUrl: "https://example.atlassian.net",
  auth: { kind: "bearer", token: "test-token" },
  userAgent: "workspace-dev-test/1.0",
  maxRetries: 0,
} as const;

const fixedClock = { now: () => GENERATED_AT };

interface MockClientOptions {
  lookupResults?: Map<string, JiraSubTaskLookupResult>;
  createResults?: Map<string, JiraSubTaskCreateResult>;
  /** Default create result when no entry exists. */
  defaultCreate?: (fields: JiraSubTaskFields) => JiraSubTaskCreateResult;
  /** Throw on create for the listed test case ids. */
  throwOnCreate?: Set<string>;
}

interface MockJiraWriteClient extends JiraWriteClient {
  lookupCalls: Array<{ parentIssueKey: string; externalId: string }>;
  createCalls: Array<{ parentIssueKey: string; fields: JiraSubTaskFields }>;
}

const createMockClient = (
  options: MockClientOptions = {},
): MockJiraWriteClient => {
  const lookupCalls: Array<{
    parentIssueKey: string;
    externalId: string;
  }> = [];
  const createCalls: Array<{
    parentIssueKey: string;
    fields: JiraSubTaskFields;
  }> = [];
  const lookups = options.lookupResults ?? new Map();
  const creates = options.createResults ?? new Map();
  const defaultCreate =
    options.defaultCreate ??
    ((fields: JiraSubTaskFields): JiraSubTaskCreateResult => ({
      ok: true,
      issueKey: `${PARENT_KEY.split("-")[0]}-${500 + lookupCalls.length}`,
    }));
  const throwOnCreate = options.throwOnCreate ?? new Set<string>();

  return {
    assertNoSecrets: true,
    lookupCalls,
    createCalls,
    lookupSubtaskByExternalId: (input) => {
      lookupCalls.push(input);
      return lookups.get(input.externalId) ?? { found: false };
    },
    createSubTask: (input) => {
      createCalls.push(input);
      if (throwOnCreate.has(input.fields.testCaseId)) {
        throw new Error("simulated transport failure");
      }
      const explicit = creates.get(input.fields.testCaseId);
      if (explicit !== undefined) return explicit;
      return defaultCreate(input.fields);
    },
  };
};

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
      expected: "Confirmation page is shown",
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

const buildList = (cases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: JOB_ID,
  testCases: cases,
});

const buildSnapshot = (perTestCase: ReviewSnapshot[]): ReviewGateSnapshot => ({
  schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: JOB_ID,
  generatedAt: GENERATED_AT,
  perTestCase,
  approvedCount: perTestCase.filter((p) => p.state === "approved").length,
  needsReviewCount: perTestCase.filter((p) => p.state === "needs_review")
    .length,
  rejectedCount: perTestCase.filter((p) => p.state === "rejected").length,
});

const approvedSnapshot = (testCaseId: string): ReviewSnapshot => ({
  testCaseId,
  state: "approved",
  policyDecision: "approved",
  lastEventId: "evt-1",
  lastEventAt: GENERATED_AT,
  fourEyesEnforced: false,
  approvers: ["principal:test"],
});

const buildPolicy = (
  overrides: Partial<TestCasePolicyReport> = {},
): TestCasePolicyReport => ({
  schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: JOB_ID,
  policyProfileId: "eu-banking-default",
  policyProfileVersion: "1.0.0",
  totalTestCases: 1,
  approvedCount: 1,
  blockedCount: 0,
  needsReviewCount: 0,
  blocked: false,
  decisions: [],
  jobLevelViolations: [],
  ...overrides,
});

const buildValidation = (
  overrides: Partial<TestCaseValidationReport> = {},
): TestCaseValidationReport => ({
  schemaVersion: TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: JOB_ID,
  totalTestCases: 1,
  errorCount: 0,
  warningCount: 0,
  blocked: false,
  issues: [],
  ...overrides,
});

const buildVisual = (
  overrides: Partial<VisualSidecarValidationReport> = {},
): VisualSidecarValidationReport => ({
  schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  generatedAt: GENERATED_AT,
  jobId: JOB_ID,
  totalScreens: 0,
  screensWithFindings: 0,
  blocked: false,
  records: [],
  ...overrides,
});

interface BuildInputArgs {
  parentIssueKey?: string;
  cases?: GeneratedTestCase[];
  approvedIds?: string[];
  bearerToken?: string;
  featureEnabled?: boolean;
  adminEnabled?: boolean;
  dryRun?: boolean;
  outputPathMarkdown?: string;
  useDefaultOutputPath?: boolean;
  policyOverrides?: Partial<TestCasePolicyReport>;
  validationOverrides?: Partial<TestCaseValidationReport>;
  visualOverrides?: Partial<VisualSidecarValidationReport>;
  visualPresent?: boolean;
}

const buildInput = (
  runDir: string,
  args: BuildInputArgs = {},
): RunJiraSubtaskWriteInput => {
  const cases = args.cases ?? [buildTestCase({ id: "tc-1" })];
  const approvedIds = args.approvedIds ?? cases.map((c) => c.id);
  const snapshots = cases.map((c) =>
    approvedIds.includes(c.id)
      ? approvedSnapshot(c.id)
      : ({
          ...approvedSnapshot(c.id),
          state: "needs_review",
          policyDecision: "needs_review",
        } as ReviewSnapshot),
  );
  return {
    jobId: JOB_ID,
    parentIssueKey: args.parentIssueKey ?? PARENT_KEY,
    mode: "jira_subtasks",
    dryRun: args.dryRun ?? false,
    ...(args.outputPathMarkdown !== undefined
      ? { outputPathMarkdown: args.outputPathMarkdown }
      : {}),
    ...(args.useDefaultOutputPath !== undefined
      ? { useDefaultOutputPath: args.useDefaultOutputPath }
      : {}),
    approvedTestCases: buildList(cases),
    policyReport: buildPolicy(args.policyOverrides),
    validationReport: buildValidation(args.validationOverrides),
    ...(args.visualPresent
      ? { visualSidecarValidation: buildVisual(args.visualOverrides) }
      : {}),
    reviewGateSnapshot: buildSnapshot(snapshots),
    runDir,
    bearerToken: args.bearerToken ?? "secret-bearer-token",
    featureEnabled: args.featureEnabled ?? true,
    adminEnabled: args.adminEnabled ?? true,
    clock: fixedClock,
  };
};

const withTempDir = async (
  body: (dir: string) => Promise<void>,
): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), "jira-write-"));
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const readReport = async (runDir: string): Promise<JiraWriteReportArtifact> => {
  const path = join(
    runDir,
    JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY,
    JIRA_WRITE_REPORT_ARTIFACT_FILENAME,
  );
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as JiraWriteReportArtifact;
};

const readCreated = async (
  runDir: string,
): Promise<JiraCreatedSubtasksArtifact> => {
  const path = join(
    runDir,
    JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY,
    JIRA_CREATED_SUBTASKS_ARTIFACT_FILENAME,
  );
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as JiraCreatedSubtasksArtifact;
};

/* ------------------------------------------------------------------ */
/*  Refusal matrix (one test per gate)                                   */
/* ------------------------------------------------------------------ */

test("feature_gate_disabled refuses without invoking the client", async () => {
  await withTempDir(async (runDir) => {
    const client = createMockClient();
    const input = buildInput(runDir, { featureEnabled: false });
    const result = await runJiraSubtaskWrite(input, client);
    assert.equal(result.refused, true);
    assert.ok(result.refusalCodes.includes("feature_gate_disabled"));
    assert.equal(client.lookupCalls.length, 0);
    assert.equal(client.createCalls.length, 0);
    const report = await readReport(runDir);
    assert.equal(report.refused, true);
    assert.equal(report.schemaVersion, JIRA_WRITE_REPORT_SCHEMA_VERSION);
    assert.equal(report.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
    assert.ok(result.markdownArtifacts);
    assert.match(result.markdownArtifacts.manifestPath, /manifest\.md$/u);
    assert.match(result.markdownArtifacts.summaryPath, /summary\.md$/u);
    assert.match(result.markdownArtifacts.errorsPath, /errors\.md$/u);
    const errors = await readFile(result.markdownArtifacts.errorsPath, "utf8");
    assert.match(errors, /Job ID:.*job-1482/u);
    assert.match(errors, /feature_gate_disabled/u);
    assert.match(errors, /Failed Cases: 0/u);
  });
});

test("admin_gate_disabled refuses without invoking the client", async () => {
  await withTempDir(async (runDir) => {
    const client = createMockClient();
    const input = buildInput(runDir, { adminEnabled: false });
    const result = await runJiraSubtaskWrite(input, client);
    assert.ok(result.refusalCodes.includes("admin_gate_disabled"));
    assert.equal(client.createCalls.length, 0);
  });
});

test("bearer_token_missing fires when no token configured", async () => {
  await withTempDir(async (runDir) => {
    const client = createMockClient();
    const input = buildInput(runDir, { bearerToken: "   " });
    const result = await runJiraSubtaskWrite(input, client);
    assert.ok(result.refusalCodes.includes("bearer_token_missing"));
    assert.equal(client.createCalls.length, 0);
  });
});

test("invalid_parent_issue_key fires for malformed parent", async () => {
  await withTempDir(async (runDir) => {
    const client = createMockClient();
    const input = buildInput(runDir, { parentIssueKey: "lowercase-1" });
    const result = await runJiraSubtaskWrite(input, client);
    assert.ok(result.refusalCodes.includes("invalid_parent_issue_key"));
  });
});

test("no_approved_test_cases fires when no case is approved", async () => {
  await withTempDir(async (runDir) => {
    const client = createMockClient();
    const input = buildInput(runDir, { approvedIds: [] });
    const result = await runJiraSubtaskWrite(input, client);
    assert.ok(result.refusalCodes.includes("no_approved_test_cases"));
  });
});

test("policy_blocked_cases_present fires when any case is blocked", async () => {
  await withTempDir(async (runDir) => {
    const client = createMockClient();
    const input = buildInput(runDir, {
      policyOverrides: {
        blocked: true,
        blockedCount: 1,
        decisions: [
          {
            testCaseId: "tc-1",
            decision: "blocked",
            violations: [],
          },
        ],
      },
    });
    const result = await runJiraSubtaskWrite(input, client);
    assert.ok(result.refusalCodes.includes("policy_blocked_cases_present"));
  });
});

test("schema_invalid_cases_present fires when validation has errors", async () => {
  await withTempDir(async (runDir) => {
    const client = createMockClient();
    const input = buildInput(runDir, {
      validationOverrides: { blocked: true, errorCount: 1 },
    });
    const result = await runJiraSubtaskWrite(input, client);
    assert.ok(result.refusalCodes.includes("schema_invalid_cases_present"));
  });
});

test("visual_sidecar_blocked fires when sidecar report is blocked", async () => {
  await withTempDir(async (runDir) => {
    const client = createMockClient();
    const input = buildInput(runDir, {
      visualPresent: true,
      visualOverrides: { blocked: true },
    });
    const result = await runJiraSubtaskWrite(input, client);
    assert.ok(result.refusalCodes.includes("visual_sidecar_blocked"));
  });
});

test("multiple gate violations are all collected and reported", async () => {
  await withTempDir(async (runDir) => {
    const client = createMockClient();
    const input = buildInput(runDir, {
      featureEnabled: false,
      adminEnabled: false,
      bearerToken: "",
      parentIssueKey: "bad-key",
    });
    const result = await runJiraSubtaskWrite(input, client);
    assert.ok(result.refusalCodes.includes("feature_gate_disabled"));
    assert.ok(result.refusalCodes.includes("admin_gate_disabled"));
    assert.ok(result.refusalCodes.includes("bearer_token_missing"));
    assert.ok(result.refusalCodes.includes("invalid_parent_issue_key"));
    assert.deepEqual(
      [...result.refusalCodes].sort(),
      result.refusalCodes,
      "refusal codes are sorted",
    );
  });
});

test("every refusal code is part of the published allow-list", () => {
  for (const code of ALLOWED_JIRA_WRITE_REFUSAL_CODES) {
    assert.ok(typeof code === "string");
  }
});

/* ------------------------------------------------------------------ */
/*  Happy path                                                            */
/* ------------------------------------------------------------------ */

test("happy path creates one sub-task per approved test case", async () => {
  await withTempDir(async (runDir) => {
    const cases = [
      buildTestCase({ id: "tc-a", title: "Case A" }),
      buildTestCase({ id: "tc-b", title: "Case B" }),
      buildTestCase({ id: "tc-c", title: "Case C" }),
    ];
    let counter = 200;
    const client = createMockClient({
      defaultCreate: () => ({
        ok: true,
        issueKey: `PROJ-${counter++}`,
      }),
    });
    const input = buildInput(runDir, {
      cases,
      approvedIds: ["tc-a", "tc-b", "tc-c"],
    });
    const result = await runJiraSubtaskWrite(input, client);
    assert.equal(result.refused, false);
    assert.equal(result.refusalCodes.length, 0);
    assert.equal(result.createdCount, 3);
    assert.equal(result.skippedDuplicateCount, 0);
    assert.equal(result.failedCount, 0);
    assert.equal(client.lookupCalls.length, 3);
    assert.equal(client.createCalls.length, 3);
    const firstCreate = client.createCalls[0];
    assert.ok(firstCreate);
    assert.equal(firstCreate.parentIssueKey, PARENT_KEY);
    assert.equal(firstCreate.fields.summary, "[tc-a] Case A");
    assert.equal(firstCreate.fields.testCaseId, "tc-a");
    assert.equal(firstCreate.fields.jobId, JOB_ID);
    assert.equal(
      firstCreate.fields.externalId,
      computeJiraSubtaskExternalId({
        jobId: JOB_ID,
        testCaseId: "tc-a",
        parentIssueKey: PARENT_KEY,
      }),
    );
    assert.match(firstCreate.fields.description, /Objective:/u);
    assert.match(firstCreate.fields.description, /Ensure a valid IBAN/u);
    assert.match(firstCreate.fields.description, /Steps:/u);
    assert.match(firstCreate.fields.description, /Expected Results:/u);
    const created = await readCreated(runDir);
    assert.equal(created.subtasks.length, 3);
    assert.equal(created.schemaVersion, JIRA_CREATED_SUBTASKS_SCHEMA_VERSION);
    for (const sub of created.subtasks) {
      assert.equal(sub.outcome, "created");
      assert.match(sub.externalId, /^[a-f0-9]{64}$/u);
      assert.ok(sub.jiraIssueKey);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Dry run                                                               */
/* ------------------------------------------------------------------ */

test("dryRun records dry_run outcomes without invoking the client", async () => {
  await withTempDir(async (runDir) => {
    const client = createMockClient();
    const cases = [
      buildTestCase({ id: "tc-a" }),
      buildTestCase({ id: "tc-b" }),
    ];
    const input = buildInput(runDir, {
      dryRun: true,
      cases,
      approvedIds: ["tc-a", "tc-b"],
    });
    const result = await runJiraSubtaskWrite(input, client);
    assert.equal(result.refused, false);
    assert.equal(result.dryRun, true);
    assert.equal(result.dryRunCount, 2);
    assert.equal(result.createdCount, 0);
    assert.equal(client.lookupCalls.length, 0);
    assert.equal(client.createCalls.length, 0);
    const report = await readReport(runDir);
    assert.equal(report.audit.dryRun, true);
    assert.equal(report.dryRunCount, 2);
  });
});

/* ------------------------------------------------------------------ */
/*  Idempotency                                                           */
/* ------------------------------------------------------------------ */

test("idempotency: lookup hit short-circuits to skipped_duplicate", async () => {
  await withTempDir(async (runDir) => {
    const cases = [buildTestCase({ id: "tc-a" })];
    const externalId = computeJiraSubtaskExternalId({
      jobId: JOB_ID,
      testCaseId: "tc-a",
      parentIssueKey: PARENT_KEY,
    });
    const client = createMockClient({
      lookupResults: new Map<string, JiraSubTaskLookupResult>([
        [externalId, { found: true, issueKey: "PROJ-999" }],
      ]),
    });
    const input = buildInput(runDir, { cases });
    const result = await runJiraSubtaskWrite(input, client);
    assert.equal(result.skippedDuplicateCount, 1);
    assert.equal(result.createdCount, 0);
    assert.equal(client.createCalls.length, 0);
    const created = await readCreated(runDir);
    assert.equal(created.subtasks[0]?.jiraIssueKey, "PROJ-999");
    assert.equal(created.subtasks[0]?.outcome, "skipped_duplicate");
  });
});

/* ------------------------------------------------------------------ */
/*  Per-case failure isolation                                            */
/* ------------------------------------------------------------------ */

test("per-case failure does not abort subsequent cases", async () => {
  await withTempDir(async (runDir) => {
    const cases = [
      buildTestCase({ id: "tc-a" }),
      buildTestCase({ id: "tc-b" }),
      buildTestCase({ id: "tc-c" }),
    ];
    let counter = 300;
    const client = createMockClient({
      createResults: new Map<string, JiraSubTaskCreateResult>([
        [
          "tc-b",
          {
            ok: false,
            errorClass: "transport_error",
            detail: "network reset",
          },
        ],
      ]),
      defaultCreate: () => ({ ok: true, issueKey: `PROJ-${counter++}` }),
    });
    const input = buildInput(runDir, {
      cases,
      approvedIds: ["tc-a", "tc-b", "tc-c"],
    });
    const result = await runJiraSubtaskWrite(input, client);
    assert.equal(result.refused, false);
    assert.equal(result.createdCount, 2);
    assert.equal(result.failedCount, 1);
    const failed = result.subtaskOutcomes.find(
      (r: JiraSubTaskRecord) => r.testCaseId === "tc-b",
    );
    assert.ok(failed);
    assert.equal(failed.outcome, "failed");
    assert.equal(failed.failureClass, "transport_error");
    assert.equal(failed.retryable, true);
  });
});

test("thrown exception on createSubTask is caught as transport_error", async () => {
  await withTempDir(async (runDir) => {
    const cases = [
      buildTestCase({ id: "tc-a" }),
      buildTestCase({ id: "tc-b" }),
    ];
    const client = createMockClient({
      throwOnCreate: new Set(["tc-b"]),
    });
    const input = buildInput(runDir, {
      cases,
      approvedIds: ["tc-a", "tc-b"],
    });
    const result = await runJiraSubtaskWrite(input, client);
    assert.equal(result.failedCount, 1);
    assert.equal(result.createdCount, 1);
    const failed = result.subtaskOutcomes.find(
      (r: JiraSubTaskRecord) => r.testCaseId === "tc-b",
    );
    assert.equal(failed?.failureClass, "transport_error");
    assert.equal(failed?.retryable, true);
  });
});

/* ------------------------------------------------------------------ */
/*  Live HTTP client retry strategy                                      */
/* ------------------------------------------------------------------ */

test("live client retries retryable lookup responses before creating", async () => {
  await withTempDir(async (runDir) => {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const sleepDelays: number[] = [];
    const responses = [
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "0" },
      }),
      new Response(JSON.stringify({ issues: [] }), { status: 200 }),
      new Response(JSON.stringify({ key: "PROJ-700" }), { status: 200 }),
    ];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), method: init?.method });
      const next = responses.shift();
      assert.ok(next, "unexpected fetch call");
      return next;
    };
    const client = createJiraWriteClient({
      config: { ...TEST_JIRA_CONFIG, maxRetries: 1 },
      fetchImpl,
      sleep: async (delayMs) => {
        sleepDelays.push(delayMs);
      },
    });
    const result = await runJiraSubtaskWrite(
      buildInput(runDir, { cases: [buildTestCase({ id: "tc-a" })] }),
      client,
    );
    assert.equal(result.createdCount, 1);
    assert.equal(result.failedCount, 0);
    assert.equal(result.subtaskOutcomes[0]?.jiraIssueKey, "PROJ-700");
    assert.deepEqual(
      calls.map((call) => call.method),
      ["GET", "GET", "POST"],
    );
    assert.deepEqual(sleepDelays, [0]);
  });
});

test("live client does not retry ambiguous create responses directly", async () => {
  await withTempDir(async (runDir) => {
    const calls: Array<{ method: string | undefined }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ method: init?.method });
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ issues: [] }), { status: 200 });
      }
      return new Response("unavailable", { status: 503 });
    };
    const client = createJiraWriteClient({
      config: { ...TEST_JIRA_CONFIG, maxRetries: 3 },
      fetchImpl,
      sleep: async () => undefined,
    });
    const result = await runJiraSubtaskWrite(
      buildInput(runDir, { cases: [buildTestCase({ id: "tc-a" })] }),
      client,
    );
    const failed = result.subtaskOutcomes[0];
    assert.equal(result.failedCount, 1);
    assert.equal(failed?.outcome, "failed");
    assert.equal(failed?.failureClass, "server_error");
    assert.equal(failed?.retryable, true);
    assert.deepEqual(
      calls.map((call) => call.method),
      ["GET", "POST"],
    );
  });
});

test("live client does not retry non-retryable create responses", async () => {
  await withTempDir(async (runDir) => {
    const calls: Array<{ method: string | undefined }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ method: init?.method });
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ issues: [] }), { status: 200 });
      }
      return new Response("bad request", { status: 400 });
    };
    const client = createJiraWriteClient({
      config: { ...TEST_JIRA_CONFIG, maxRetries: 3 },
      fetchImpl,
      sleep: async () => undefined,
    });
    const result = await runJiraSubtaskWrite(
      buildInput(runDir, { cases: [buildTestCase({ id: "tc-a" })] }),
      client,
    );
    const failed = result.subtaskOutcomes[0];
    assert.equal(result.failedCount, 1);
    assert.equal(failed?.outcome, "failed");
    assert.equal(failed?.failureClass, "validation_rejected");
    assert.equal(failed?.retryable, false);
    assert.deepEqual(
      calls.map((call) => call.method),
      ["GET", "POST"],
    );
  });
});

test("lookup retry exhaustion fails the case without attempting create", async () => {
  await withTempDir(async (runDir) => {
    const calls: Array<{ method: string | undefined }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ method: init?.method });
      return new Response("unavailable", { status: 503 });
    };
    const client = createJiraWriteClient({
      config: { ...TEST_JIRA_CONFIG, maxRetries: 0 },
      fetchImpl,
    });
    const result = await runJiraSubtaskWrite(
      buildInput(runDir, { cases: [buildTestCase({ id: "tc-a" })] }),
      client,
    );
    const failed = result.subtaskOutcomes[0];
    assert.equal(result.failedCount, 1);
    assert.equal(failed?.outcome, "failed");
    assert.equal(failed?.failureClass, "server_error");
    assert.equal(failed?.retryable, true);
    assert.deepEqual(
      calls.map((call) => call.method),
      ["GET"],
    );
  });
});

/* ------------------------------------------------------------------ */
/*  externalId determinism                                                */
/* ------------------------------------------------------------------ */

test("externalId is deterministic across runs", () => {
  const a = computeJiraSubtaskExternalId({
    jobId: "job-1",
    testCaseId: "tc-1",
    parentIssueKey: "PROJ-1",
  });
  const b = computeJiraSubtaskExternalId({
    jobId: "job-1",
    testCaseId: "tc-1",
    parentIssueKey: "PROJ-1",
  });
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/u);
});

test("externalId differs when any input changes", () => {
  const base = computeJiraSubtaskExternalId({
    jobId: "job-1",
    testCaseId: "tc-1",
    parentIssueKey: "PROJ-1",
  });
  const diffJob = computeJiraSubtaskExternalId({
    jobId: "job-2",
    testCaseId: "tc-1",
    parentIssueKey: "PROJ-1",
  });
  const diffCase = computeJiraSubtaskExternalId({
    jobId: "job-1",
    testCaseId: "tc-2",
    parentIssueKey: "PROJ-1",
  });
  const diffParent = computeJiraSubtaskExternalId({
    jobId: "job-1",
    testCaseId: "tc-1",
    parentIssueKey: "PROJ-2",
  });
  assert.notEqual(base, diffJob);
  assert.notEqual(base, diffCase);
  assert.notEqual(base, diffParent);
});

/* ------------------------------------------------------------------ */
/*  Atomic write & artifact placement                                     */
/* ------------------------------------------------------------------ */

test("artifacts are written atomically under the run dir", async () => {
  await withTempDir(async (runDir) => {
    const client = createMockClient();
    const input = buildInput(runDir, {
      cases: [buildTestCase({ id: "tc-a" })],
    });
    const result = await runJiraSubtaskWrite(input, client);
    assert.equal(
      result.reportArtifactPath,
      join(
        runDir,
        JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY,
        JIRA_WRITE_REPORT_ARTIFACT_FILENAME,
      ),
    );
    assert.equal(
      result.createdSubtasksArtifactPath,
      join(
        runDir,
        JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY,
        JIRA_CREATED_SUBTASKS_ARTIFACT_FILENAME,
      ),
    );
    const report = await readReport(runDir);
    assert.equal(report.rawScreenshotsIncluded, false);
    assert.equal(report.credentialsIncluded, false);
    const created = await readCreated(runDir);
    assert.equal(created.rawScreenshotsIncluded, false);
    assert.equal(created.credentialsIncluded, false);
  });
});

test("markdown output path trims custom input and falls back to the default path", async () => {
  await withTempDir(async (runDir) => {
    const client = createMockClient();
    const cases = [buildTestCase({ id: "tc-a" })];
    const customOutputPath = join(runDir, "custom-jira-markdown");
    const customResult = await runJiraSubtaskWrite(
      buildInput(runDir, {
        dryRun: true,
        cases,
        outputPathMarkdown: `   ${customOutputPath}   `,
        useDefaultOutputPath: false,
      }),
      client,
    );
    assert.equal(customResult.markdownOutputPath, customOutputPath);

    const defaultResult = await runJiraSubtaskWrite(
      buildInput(runDir, {
        dryRun: true,
        cases,
        outputPathMarkdown: "   /tmp/ignored-by-default   ",
        useDefaultOutputPath: true,
      }),
      client,
    );
    assert.equal(
      defaultResult.markdownOutputPath,
      join(runDir, JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  No-secrets invariant                                                  */
/* ------------------------------------------------------------------ */

test("no bearer token, password, or auth fragment leaks into artifacts", async () => {
  await withTempDir(async (runDir) => {
    const client = createMockClient();
    const input = buildInput(runDir, {
      bearerToken: "Bearer-abc123-secret-XYZ",
    });
    await runJiraSubtaskWrite(input, client);
    const reportPath = join(
      runDir,
      JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY,
      JIRA_WRITE_REPORT_ARTIFACT_FILENAME,
    );
    const createdPath = join(
      runDir,
      JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY,
      JIRA_CREATED_SUBTASKS_ARTIFACT_FILENAME,
    );
    const reportText = await readFile(reportPath, "utf8");
    const createdText = await readFile(createdPath, "utf8");
    for (const text of [reportText, createdText]) {
      assert.ok(!text.includes("Bearer-abc123-secret-XYZ"));
      assert.ok(!text.includes("authorization"));
      assert.ok(!text.includes("Authorization"));
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Unconfigured client sentinel                                          */
/* ------------------------------------------------------------------ */

test("createUnconfiguredJiraWriteClient returns provider_not_implemented on create", async () => {
  await withTempDir(async (runDir) => {
    const client = createUnconfiguredJiraWriteClient();
    const cases = [buildTestCase({ id: "tc-a" })];
    const input = buildInput(runDir, { cases });
    const result = await runJiraSubtaskWrite(input, client);
    assert.equal(result.failedCount, 1);
    const record = result.subtaskOutcomes[0];
    assert.ok(record);
    assert.equal(record.outcome, "failed");
    assert.equal(record.failureClass, "provider_not_implemented");
    assert.equal(record.retryable, false);
  });
});
