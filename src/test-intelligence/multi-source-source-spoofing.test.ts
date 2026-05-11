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
import { handleReviewRequest } from "./review-handler.js";
import { createFileSystemReviewStore } from "./review-store.js";
import { validateMultiSourceTestIntentEnvelope } from "./multi-source-envelope.js";

const GENERATED_AT = "2026-04-27T10:00:00.000Z";
const ZERO = "0".repeat(64);

const testCase = (): GeneratedTestCase => ({
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
  riskCategory: "high",
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
});

const list = (): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: [testCase()],
});

const policy = (): TestCasePolicyReport => ({
  schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
  policyProfileId: "eu-banking-default",
  policyProfileVersion: "1.0.0",
  totalTestCases: 1,
  approvedCount: 0,
  blockedCount: 0,
  needsReviewCount: 1,
  blocked: false,
  decisions: [{ testCaseId: "tc-1", decision: "needs_review", violations: [] }],
  jobLevelViolations: [],
});

test("multi-source-source-spoofing: authenticated principal overrides body actor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "source-spoofing-"));
  try {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: list(),
      policy: policy(),
      fourEyesPolicy: {
        requiredRiskCategories: ["high"],
        visualSidecarTriggerOutcomes: [],
      },
    });
    const res = await handleReviewRequest(
      {
        bearerToken: undefined,
        reviewPrincipals: [
          { principalId: "alice", bearerToken: "alice-token" },
          { principalId: "bob", bearerToken: "bob-token" },
        ],
        authorizationHeader: "Bearer bob-token",
        method: "POST",
        action: "primary-approve",
        jobId: "job-1",
        testCaseId: "tc-1",
        at: GENERATED_AT,
        actor: "mallory",
      },
      store,
    );
    assert.equal(res.statusCode, 200);
    const body = res.body as {
      ok: true;
      event: { actor?: string };
      snapshot: { perTestCase: Array<{ primaryReviewer?: string }> };
    };
    assert.equal(body.event.actor, "bob");
    assert.equal(body.snapshot.perTestCase[0]?.primaryReviewer, "bob");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("multi-source-source-spoofing: forged sourceId and contentHash are refused by envelope validation", () => {
  const validation = validateMultiSourceTestIntentEnvelope({
    version: "1.0.0",
    sources: [
      {
        sourceId: "../escape",
        kind: "figma_local_json",
        contentHash: "not-a-hash",
        capturedAt: "2026-04-27T10:00:00.000Z",
      },
    ],
    aggregateContentHash: "0".repeat(64),
    conflictResolutionPolicy: "reviewer_decides",
  });
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.issues.some((issue) => issue.code === "invalid_source_id"), true);
    assert.equal(validation.issues.some((issue) => issue.code === "invalid_content_hash"), true);
  }
});
