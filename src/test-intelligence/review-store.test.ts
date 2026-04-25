import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REVIEW_EVENTS_ARTIFACT_FILENAME,
  REVIEW_GATE_SCHEMA_VERSION,
  REVIEW_STATE_ARTIFACT_FILENAME,
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type TestCasePolicyReport,
} from "../contracts/index.js";
import { createFileSystemReviewStore } from "./review-store.js";

const ZERO = "0".repeat(64);
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "T",
  objective: "O",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "do", expected: "ok" }],
  expectedResults: ["ok"],
  figmaTraceRefs: [{ screenId: "s-1" }],
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
  reviewState: "auto_approved",
  audit: {
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    cacheHit: false,
    cacheKey: "k",
    inputHash: ZERO,
    promptHash: ZERO,
    schemaHash: ZERO,
  },
  ...overrides,
});

const wrap = (cases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: cases,
});

const policyWith = (
  decisions: TestCasePolicyReport["decisions"],
): TestCasePolicyReport => ({
  schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
  policyProfileId: "eu-banking-default",
  policyProfileVersion: "1.0.0",
  totalTestCases: decisions.length,
  approvedCount: decisions.filter((d) => d.decision === "approved").length,
  blockedCount: decisions.filter((d) => d.decision === "blocked").length,
  needsReviewCount: decisions.filter((d) => d.decision === "needs_review")
    .length,
  blocked: decisions.some((d) => d.decision === "blocked"),
  decisions,
  jobLevelViolations: [],
});

const withTempDir = async (
  name: string,
  fn: (dir: string) => Promise<void>,
): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), `${name}-`));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test("review-store: seed creates one event per test case + snapshot", async () => {
  await withTempDir("rev-seed", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    const snapshot = await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-a" }), buildCase({ id: "tc-b" })]),
      policy: policyWith([
        {
          testCaseId: "tc-a",
          decision: "approved",
          violations: [],
        },
        {
          testCaseId: "tc-b",
          decision: "needs_review",
          violations: [],
        },
      ]),
    });
    assert.equal(snapshot.perTestCase.length, 2);
    assert.equal(
      snapshot.perTestCase.find((e) => e.testCaseId === "tc-a")?.state,
      "approved",
    );
    assert.equal(
      snapshot.perTestCase.find((e) => e.testCaseId === "tc-b")?.state,
      "needs_review",
    );
    const events = await store.listEvents("job-1");
    assert.equal(events.length, 2);
    assert.equal(events[0]?.sequence, 1);
    assert.equal(events[1]?.sequence, 2);
  });
});

test("review-store: seed is idempotent on the same job", async () => {
  await withTempDir("rev-idempotent", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    const a = await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({})]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "approved", violations: [] },
      ]),
    });
    const b = await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({})]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "approved", violations: [] },
      ]),
    });
    assert.deepEqual(a, b);
  });
});

test("review-store: persists artifacts atomically with canonical names", async () => {
  await withTempDir("rev-persist", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({})]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
    });
    const eventsRaw = await readFile(
      join(dir, "job-1", REVIEW_EVENTS_ARTIFACT_FILENAME),
      "utf8",
    );
    const stateRaw = await readFile(
      join(dir, "job-1", REVIEW_STATE_ARTIFACT_FILENAME),
      "utf8",
    );
    assert.match(eventsRaw, new RegExp(REVIEW_GATE_SCHEMA_VERSION));
    assert.match(stateRaw, /"state":"needs_review"/);
  });
});

test("review-store: approve transition appends event and updates snapshot", async () => {
  await withTempDir("rev-approve", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({})]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
    });
    const result = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "approved",
      at: "2026-04-25T11:00:00.000Z",
      actor: "alice",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.event.fromState, "needs_review");
    assert.equal(result.event.toState, "approved");
    assert.equal(result.snapshot.approvedCount, 1);
    assert.deepEqual(result.snapshot.perTestCase[0]?.approvers, ["alice"]);
  });
});

test("review-store: rejects approval transition when policy is blocked", async () => {
  await withTempDir("rev-block", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({})]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "blocked", violations: [] },
      ]),
    });
    const result = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "approved",
      at: GENERATED_AT,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "policy_blocks_approval");
  });
});

test("review-store: rejects unknown test case id", async () => {
  await withTempDir("rev-unknown", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({})]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
    });
    const result = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-missing",
      kind: "approved",
      at: GENERATED_AT,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "test_case_unknown");
  });
});

test("review-store: refuses transition when snapshot missing", async () => {
  await withTempDir("rev-missing", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    const result = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "approved",
      at: GENERATED_AT,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "snapshot_missing");
  });
});

test("review-store: monotonic sequence across transitions", async () => {
  await withTempDir("rev-seq", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({})]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
    });
    await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "review_started",
      at: GENERATED_AT,
    });
    await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "approved",
      at: GENERATED_AT,
    });
    const events = await store.listEvents("job-1");
    const sequences = events.map((e) => e.sequence);
    assert.deepEqual(sequences, [1, 2, 3]);
  });
});

test("review-store: concurrent transitions on same job serialize correctly", async () => {
  await withTempDir("rev-concurrent", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([
        buildCase({ id: "tc-a" }),
        buildCase({ id: "tc-b" }),
        buildCase({ id: "tc-c" }),
      ]),
      policy: policyWith([
        { testCaseId: "tc-a", decision: "needs_review", violations: [] },
        { testCaseId: "tc-b", decision: "needs_review", violations: [] },
        { testCaseId: "tc-c", decision: "needs_review", violations: [] },
      ]),
    });
    await Promise.all([
      store.recordTransition({
        jobId: "job-1",
        testCaseId: "tc-a",
        kind: "approved",
        at: GENERATED_AT,
      }),
      store.recordTransition({
        jobId: "job-1",
        testCaseId: "tc-b",
        kind: "approved",
        at: GENERATED_AT,
      }),
      store.recordTransition({
        jobId: "job-1",
        testCaseId: "tc-c",
        kind: "rejected",
        at: GENERATED_AT,
      }),
    ]);
    const events = await store.listEvents("job-1");
    const sequences = events.map((e) => e.sequence);
    assert.deepEqual(
      sequences.slice().sort((a, b) => a - b),
      sequences,
    );
    const snapshot = await store.readSnapshot("job-1");
    assert.equal(snapshot?.approvedCount, 2);
    assert.equal(snapshot?.rejectedCount, 1);
  });
});

test("review-store: rejects oversize note", async () => {
  await withTempDir("rev-note", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({})]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
    });
    const result = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "note",
      at: GENERATED_AT,
      note: "a".repeat(2000),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "note_too_long");
  });
});
