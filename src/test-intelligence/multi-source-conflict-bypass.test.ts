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
import { createFileSystemReviewStore } from "./review-store.js";

const GENERATED_AT = "2026-04-27T10:00:00.000Z";
const ZERO = "0".repeat(64);

const buildCase = (): GeneratedTestCase => ({
  id: "tc-conflict",
  sourceJobId: "job-conflict",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Conflict case",
  objective: "Resolve multi-source conflict",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "review" }],
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
    jobId: "job-conflict",
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
  jobId: "job-conflict",
  testCases: [buildCase()],
});

const conflictPolicy = (): TestCasePolicyReport => ({
  schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-conflict",
  policyProfileId: "eu-banking-default",
  policyProfileVersion: "1.0.0",
  totalTestCases: 1,
  approvedCount: 0,
  blockedCount: 0,
  needsReviewCount: 1,
  blocked: false,
  decisions: [
    {
      testCaseId: "tc-conflict",
      decision: "needs_review",
      violations: [
        {
          rule: "policy:multi-source-conflict-present",
          outcome: "multi_source_conflict_present",
          severity: "warning",
          reason: "multi-source conflict(s) conflict-1 affect this case",
        },
      ],
    },
  ],
  jobLevelViolations: [],
});

test("multi-source-conflict-bypass: conflict-present cases cannot be auto-approved or skip four-eyes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "conflict-bypass-"));
  try {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    const seeded = await store.seedSnapshot({
      jobId: "job-conflict",
      generatedAt: GENERATED_AT,
      list: list(),
      policy: conflictPolicy(),
      fourEyesPolicy: {
        requiredRiskCategories: [],
        visualSidecarTriggerOutcomes: [],
      },
    });
    const entry = seeded.perTestCase[0];
    assert.equal(entry?.state, "needs_review");
    assert.equal(entry?.policyDecision, "needs_review");
    assert.equal(entry?.fourEyesEnforced, true);
    assert.deepEqual(entry?.fourEyesReasons, [
      "multi_source_conflict_present",
    ]);

    const secondaryFirst = await store.recordTransition({
      jobId: "job-conflict",
      testCaseId: "tc-conflict",
      kind: "secondary_approved",
      at: GENERATED_AT,
      actor: "bob",
    });
    assert.equal(secondaryFirst.ok, false);
    if (!secondaryFirst.ok) {
      assert.equal(secondaryFirst.code, "primary_approval_required");
    }

    const first = await store.recordTransition({
      jobId: "job-conflict",
      testCaseId: "tc-conflict",
      kind: "approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.snapshot.perTestCase[0]?.state, "pending_secondary_approval");
    assert.equal(first.snapshot.approvedCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
