import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type TestCasePolicyReport,
} from "../contracts/index.js";
import {
  handleReviewRequest,
  parseReviewRoute,
  type ReviewRequestEnvelope,
} from "./review-handler.js";
import { createFileSystemReviewStore } from "./review-store.js";

const TOKEN = "secret-bearer-token";
const ALICE_TOKEN = "alice-secret-bearer-token";
const BOB_TOKEN = "bob-secret-bearer-token";
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
  steps: [{ index: 1, action: "do" }],
  expectedResults: [],
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

const seedStore = async (
  dir: string,
  decision: "approved" | "needs_review" | "blocked" = "needs_review",
) => {
  const store = createFileSystemReviewStore({ destinationDir: dir });
  await store.seedSnapshot({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: wrap([buildCase({})]),
    policy: policyWith([{ testCaseId: "tc-1", decision, violations: [] }]),
  });
  return store;
};

const baseEnvelope = (
  overrides: Partial<ReviewRequestEnvelope>,
): ReviewRequestEnvelope => ({
  bearerToken: TOKEN,
  authorizationHeader: `Bearer ${TOKEN}`,
  method: "POST",
  action: "approve",
  jobId: "job-1",
  testCaseId: "tc-1",
  at: GENERATED_AT,
  ...overrides,
});

const principalEnvelope = (
  principal: "alice" | "bob",
  overrides: Partial<ReviewRequestEnvelope> = {},
): ReviewRequestEnvelope => ({
  ...baseEnvelope({
    reviewPrincipals: [
      { principalId: "alice", bearerToken: ALICE_TOKEN },
      { principalId: "bob", bearerToken: BOB_TOKEN },
    ],
    authorizationHeader: `Bearer ${principal === "alice" ? ALICE_TOKEN : BOB_TOKEN}`,
    ...overrides,
  }),
});

const withTempDir = async (fn: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), "rev-handler-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test("handler: returns 503 when bearer token is not configured", async () => {
  await withTempDir(async (dir) => {
    const store = await seedStore(dir);
    const res = await handleReviewRequest(
      baseEnvelope({ bearerToken: undefined }),
      store,
    );
    assert.equal(res.statusCode, 503);
    assert.equal(
      (res.body as { ok: false; error: string }).error,
      "AUTHENTICATION_UNAVAILABLE",
    );
  });
});

test("handler: returns 401 when authorization header missing", async () => {
  await withTempDir(async (dir) => {
    const store = await seedStore(dir);
    const res = await handleReviewRequest(
      baseEnvelope({ authorizationHeader: undefined }),
      store,
    );
    assert.equal(res.statusCode, 401);
    assert.equal(
      res.wwwAuthenticate,
      'Bearer realm="workspace-dev-test-intelligence-review"',
    );
  });
});

test("handler: returns 401 when bearer token mismatches", async () => {
  await withTempDir(async (dir) => {
    const store = await seedStore(dir);
    const res = await handleReviewRequest(
      baseEnvelope({ authorizationHeader: "Bearer wrong-token" }),
      store,
    );
    assert.equal(res.statusCode, 401);
  });
});

test("handler: accepts case-insensitive scheme + whitespace", async () => {
  await withTempDir(async (dir) => {
    const store = await seedStore(dir);
    const res = await handleReviewRequest(
      baseEnvelope({
        authorizationHeader: `bEaReR \t ${TOKEN} \t`,
      }),
      store,
    );
    assert.equal(res.statusCode, 200);
  });
});

test("handler: approve transitions state and persists event", async () => {
  await withTempDir(async (dir) => {
    const store = await seedStore(dir);
    const res = await handleReviewRequest(
      baseEnvelope({ action: "approve", actor: "alice" }),
      store,
    );
    assert.equal(res.statusCode, 200);
    const body = res.body as { ok: true; snapshot: { approvedCount: number } };
    assert.equal(body.ok, true);
    assert.equal(body.snapshot.approvedCount, 1);
  });
});

test("handler: reject transitions state to rejected", async () => {
  await withTempDir(async (dir) => {
    const store = await seedStore(dir);
    const res = await handleReviewRequest(
      baseEnvelope({ action: "reject" }),
      store,
    );
    assert.equal(res.statusCode, 200);
    const body = res.body as { ok: true; event: { toState: string } };
    assert.equal(body.event.toState, "rejected");
  });
});

test("handler: refuses approval when policy is blocked", async () => {
  await withTempDir(async (dir) => {
    const store = await seedStore(dir, "blocked");
    const res = await handleReviewRequest(
      baseEnvelope({ action: "approve" }),
      store,
    );
    assert.equal(res.statusCode, 409);
  });
});

test("handler: GET state requires no auth and returns snapshot + events", async () => {
  await withTempDir(async (dir) => {
    const store = await seedStore(dir);
    const res = await handleReviewRequest(
      baseEnvelope({
        method: "GET",
        action: "state",
        bearerToken: undefined,
        authorizationHeader: undefined,
      }),
      store,
    );
    assert.equal(res.statusCode, 200);
    const body = res.body as {
      ok: true;
      snapshot: { jobId: string };
      events: { id: string }[];
    };
    assert.equal(body.snapshot.jobId, "job-1");
    assert.equal(body.events.length, 1);
  });
});

test("handler: GET state returns 404 when job missing", async () => {
  await withTempDir(async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    const res = await handleReviewRequest(
      baseEnvelope({
        method: "GET",
        action: "state",
        bearerToken: undefined,
        authorizationHeader: undefined,
      }),
      store,
    );
    assert.equal(res.statusCode, 404);
  });
});

test("handler: unknown write action returns 404", async () => {
  await withTempDir(async (dir) => {
    const store = await seedStore(dir);
    const res = await handleReviewRequest(
      baseEnvelope({ action: "delete-everything" }),
      store,
    );
    assert.equal(res.statusCode, 404);
  });
});

test("handler: PUT method returns 405", async () => {
  await withTempDir(async (dir) => {
    const store = await seedStore(dir);
    const res = await handleReviewRequest(
      baseEnvelope({ method: "PUT" }),
      store,
    );
    assert.equal(res.statusCode, 405);
  });
});

test("parseReviewRoute: extracts jobId/action/testCaseId from path", () => {
  const r = parseReviewRoute(
    "/workspace/test-intelligence/review/job-1/approve/tc-1",
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.jobId, "job-1");
  assert.equal(r.action, "approve");
  assert.equal(r.testCaseId, "tc-1");
});

test("parseReviewRoute: rejects unknown prefix", () => {
  const r = parseReviewRoute("/elsewhere/foo");
  assert.equal(r.ok, false);
});

test("parseReviewRoute: rejects too many segments", () => {
  const r = parseReviewRoute(
    "/workspace/test-intelligence/review/job/action/tc/extra",
  );
  assert.equal(r.ok, false);
});

const seedFourEyesStore = async (
  dir: string,
  riskCategory: "regulated_data" | "financial_transaction" | "high",
) => {
  const store = createFileSystemReviewStore({ destinationDir: dir });
  await store.seedSnapshot({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: wrap([buildCase({ riskCategory })]),
    policy: policyWith([
      { testCaseId: "tc-1", decision: "needs_review", violations: [] },
    ]),
    fourEyesPolicy: {
      requiredRiskCategories: [
        "financial_transaction",
        "high",
        "regulated_data",
      ],
      visualSidecarTriggerOutcomes: [],
    },
  });
  return store;
};

test("handler: approve action on a four-eyes case routes to primary then secondary", async () => {
  await withTempDir(async (dir) => {
    const store = await seedFourEyesStore(dir, "financial_transaction");
    const first = await handleReviewRequest(
      principalEnvelope("alice", { action: "approve", actor: "mallory" }),
      store,
    );
    assert.equal(first.statusCode, 200);
    const firstBody = first.body as {
      ok: true;
      event: { kind: string; toState: string };
      snapshot: { perTestCase: { state: string }[] };
    };
    assert.equal(firstBody.event.kind, "primary_approved");
    assert.equal(firstBody.event.toState, "pending_secondary_approval");
    assert.equal(
      (first.body as { ok: true; event: { actor?: string } }).event.actor,
      "alice",
    );
    assert.equal(
      firstBody.snapshot.perTestCase[0]?.state,
      "pending_secondary_approval",
    );
    const second = await handleReviewRequest(
      principalEnvelope("bob", { action: "approve" }),
      store,
    );
    assert.equal(second.statusCode, 200);
    const secondBody = second.body as {
      ok: true;
      event: { kind: string; toState: string };
    };
    assert.equal(secondBody.event.kind, "secondary_approved");
    assert.equal(secondBody.event.toState, "approved");
  });
});

test("handler: legacy bearer is one principal, so it cannot satisfy four-eyes twice", async () => {
  await withTempDir(async (dir) => {
    const store = await seedFourEyesStore(dir, "regulated_data");
    await handleReviewRequest(
      baseEnvelope({ action: "approve", actor: "alice" }),
      store,
    );
    const second = await handleReviewRequest(
      baseEnvelope({ action: "approve", actor: "alice" }),
      store,
    );
    assert.equal(second.statusCode, 409);
    const body = second.body as {
      ok: false;
      error: string;
      message: string;
      refusalCode?: string;
    };
    assert.equal(body.ok, false);
    assert.equal(body.refusalCode, "self_approval_refused");
    assert.match(body.message, /self_approval_refused/);
  });
});

test("handler: request body actor cannot impersonate the authenticated principal", async () => {
  await withTempDir(async (dir) => {
    const store = await seedFourEyesStore(dir, "regulated_data");
    const res = await handleReviewRequest(
      principalEnvelope("alice", { action: "primary-approve", actor: "bob" }),
      store,
    );
    assert.equal(res.statusCode, 200);
    const body = res.body as {
      ok: true;
      event: { actor?: string };
      snapshot: { perTestCase: { primaryReviewer?: string }[] };
    };
    assert.equal(body.event.actor, "alice");
    assert.equal(body.snapshot.perTestCase[0]?.primaryReviewer, "alice");
  });
});

test("handler: explicit primary-approve action is accepted on four-eyes cases", async () => {
  await withTempDir(async (dir) => {
    const store = await seedFourEyesStore(dir, "high");
    const res = await handleReviewRequest(
      principalEnvelope("alice", { action: "primary-approve" }),
      store,
    );
    assert.equal(res.statusCode, 200);
    const body = res.body as { ok: true; event: { kind: string } };
    assert.equal(body.event.kind, "primary_approved");
  });
});

test("handler: secondary-approve before primary returns 409 primary_approval_required", async () => {
  await withTempDir(async (dir) => {
    const store = await seedFourEyesStore(dir, "high");
    const res = await handleReviewRequest(
      principalEnvelope("bob", { action: "secondary-approve" }),
      store,
    );
    assert.equal(res.statusCode, 409);
    const body = res.body as { ok: false; message: string };
    assert.match(body.message, /primary_approval_required/);
  });
});

test("handler: primary-approve without any configured principal returns 503", async () => {
  await withTempDir(async (dir) => {
    const store = await seedFourEyesStore(dir, "regulated_data");
    const res = await handleReviewRequest(
      baseEnvelope({
        action: "primary-approve",
        bearerToken: undefined,
        authorizationHeader: undefined,
      }),
      store,
    );
    assert.equal(res.statusCode, 503);
  });
});
