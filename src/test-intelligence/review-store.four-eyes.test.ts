/**
 * Integration tests for the four-eyes review-gate enforcement (Issue #1376).
 *
 * The tests instantiate the file-system review store with the EU-banking
 * default four-eyes policy and exercise every acceptance-criterion path
 * surfaced in the issue:
 *
 *   - high-risk single-reviewer rejection
 *   - high-risk two-distinct-reviewer success → `approved`
 *   - self-approval rejection (same actor approving twice)
 *   - duplicate-principal rejection (same actor returning to approve)
 *   - approving one's own edit refusal
 *   - non-high-risk single-reviewer flow remains valid
 *   - visual-sidecar-driven enforcement (low_confidence triggers four-eyes)
 *   - re-edit invalidates the in-progress approval chain
 *   - rejected case in pending_secondary_approval
 *   - export-pipeline blocks an enforced case that did not collect two
 *     approvals (regression for AC "forged client-only state cannot
 *     bypass the gate")
 */

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
  VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type TestCasePolicyReport,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import { runExportPipeline } from "./export-pipeline.js";
import {
  EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
  resolveFourEyesPolicy,
} from "./four-eyes-policy.js";
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

test("four-eyes: snapshot stamps fourEyesEnforced + reasons for high-risk case", async () => {
  await withTempDir("four-eyes-seed", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    const snapshot = await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([
        buildCase({ id: "tc-fin", riskCategory: "financial_transaction" }),
        buildCase({ id: "tc-low", riskCategory: "low" }),
      ]),
      policy: policyWith([
        { testCaseId: "tc-fin", decision: "needs_review", violations: [] },
        { testCaseId: "tc-low", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    const fin = snapshot.perTestCase.find((e) => e.testCaseId === "tc-fin");
    const low = snapshot.perTestCase.find((e) => e.testCaseId === "tc-low");
    assert.equal(fin?.fourEyesEnforced, true);
    assert.deepEqual(fin?.fourEyesReasons, ["risk_category"]);
    assert.equal(low?.fourEyesEnforced, false);
    assert.equal(low?.fourEyesReasons, undefined);
  });
});

test("four-eyes: custom-context regulated escalation enforces when regulated_data is configured", async () => {
  await withTempDir("four-eyes-custom-context", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    const snapshot = await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-context", riskCategory: "low" })]),
      policy: policyWith([
        {
          testCaseId: "tc-context",
          decision: "needs_review",
          violations: [
            {
              rule: "policy:custom-context-risk-escalation",
              outcome: "custom_context_risk_escalation",
              severity: "warning",
              reason:
                "custom context entry custom-context-structured flagged data_class=PCI-DSS-3 as regulated_data",
            },
          ],
        },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    const entry = snapshot.perTestCase.find(
      (e) => e.testCaseId === "tc-context",
    );
    assert.equal(entry?.fourEyesEnforced, true);
    assert.deepEqual(entry?.fourEyesReasons, ["risk_category"]);
  });
});

test("four-eyes: multi-source conflict policy outcome stamps the dedicated enforcement reason", async () => {
  await withTempDir("four-eyes-multi-source-conflict", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    const snapshot = await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-conflict", riskCategory: "low" })]),
      policy: policyWith([
        {
          testCaseId: "tc-conflict",
          decision: "needs_review",
          violations: [
            {
              rule: "policy:multi-source-conflict-present",
              outcome: "multi_source_conflict_present",
              severity: "warning",
              reason: "multi-source conflict(s) abc affect this case",
            },
          ],
        },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    const entry = snapshot.perTestCase.find(
      (value) => value.testCaseId === "tc-conflict",
    );
    assert.equal(entry?.fourEyesEnforced, true);
    assert.deepEqual(entry?.fourEyesReasons, [
      "multi_source_conflict_present",
    ]);
  });
});

test("four-eyes: high-risk case cannot reach approved with a single approver", async () => {
  await withTempDir("four-eyes-single-rejected", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([
        buildCase({ id: "tc-1", riskCategory: "financial_transaction" }),
      ]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    const first = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.event.kind, "primary_approved");
    assert.equal(first.event.toState, "pending_secondary_approval");
    const entry = first.snapshot.perTestCase[0];
    assert.equal(entry?.state, "pending_secondary_approval");
    assert.equal(entry?.primaryReviewer, "alice");
    assert.equal(first.snapshot.approvedCount, 0);
    assert.equal(first.snapshot.pendingSecondaryApprovalCount, 1);
  });
});

test("four-eyes: two distinct approvers transition to approved with both identities recorded", async () => {
  await withTempDir("four-eyes-success", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-1", riskCategory: "regulated_data" })]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    const first = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "approved",
      at: "2026-04-25T11:00:00.000Z",
      actor: "alice",
    });
    assert.equal(first.ok, true);
    const second = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "approved",
      at: "2026-04-25T11:30:00.000Z",
      actor: "bob",
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.event.kind, "secondary_approved");
    assert.equal(second.event.toState, "approved");
    const entry = second.snapshot.perTestCase[0];
    assert.equal(entry?.state, "approved");
    assert.equal(entry?.primaryReviewer, "alice");
    assert.equal(entry?.primaryApprovalAt, "2026-04-25T11:00:00.000Z");
    assert.equal(entry?.secondaryReviewer, "bob");
    assert.equal(entry?.secondaryApprovalAt, "2026-04-25T11:30:00.000Z");
    assert.deepEqual(entry?.approvers, ["alice", "bob"]);
    assert.equal(second.snapshot.approvedCount, 1);
    assert.equal(second.snapshot.pendingSecondaryApprovalCount, 0);
  });
});

test("four-eyes: self-approval (same actor twice) is rejected with a structured code", async () => {
  await withTempDir("four-eyes-self", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-1", riskCategory: "regulated_data" })]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    const first = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    assert.equal(first.ok, true);
    const second = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "self_approval_refused");
  });
});

test("four-eyes: explicit secondary-approve action with same actor as primary is refused", async () => {
  await withTempDir("four-eyes-explicit-self", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-1", riskCategory: "high" })]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "primary_approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    const refused = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "secondary_approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.code, "self_approval_refused");
  });
});

test("four-eyes: duplicate explicit primary approval is refused with duplicate_principal_refused", async () => {
  await withTempDir("four-eyes-duplicate-primary", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-1", riskCategory: "high" })]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    const first = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "primary_approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    assert.equal(first.ok, true);
    const duplicate = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "primary_approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    assert.equal(duplicate.ok, false);
    if (duplicate.ok) return;
    assert.equal(duplicate.code, "duplicate_principal_refused");
  });
});

test("four-eyes: secondary_approved without a primary is refused", async () => {
  await withTempDir("four-eyes-skip-primary", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-1", riskCategory: "high" })]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    const refused = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "secondary_approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.code, "primary_approval_required");
  });
});

test("four-eyes: primary_approved without an actor is refused", async () => {
  await withTempDir("four-eyes-no-actor", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-1", riskCategory: "high" })]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    const refused = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "primary_approved",
      at: GENERATED_AT,
    });
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.code, "four_eyes_actor_required");
  });
});

test("four-eyes: explicit primary_approved on a non-enforced case is refused", async () => {
  await withTempDir("four-eyes-not-required", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-1", riskCategory: "low" })]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    const refused = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "primary_approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.code, "four_eyes_not_required");
  });
});

test("four-eyes: approving one's own edit is refused", async () => {
  await withTempDir("four-eyes-edit-self", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-1", riskCategory: "regulated_data" })]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "edited",
      at: GENERATED_AT,
      actor: "alice",
    });
    const refused = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.code, "self_approval_refused");
  });
});

test("four-eyes: non-high-risk case retains the one-reviewer flow from #1365", async () => {
  await withTempDir("four-eyes-low-risk", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-1", riskCategory: "low" })]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    const first = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.event.kind, "approved");
    assert.equal(first.event.toState, "approved");
    assert.equal(first.snapshot.approvedCount, 1);
  });
});

test("four-eyes: visual-sidecar low_confidence on the case's screen triggers four-eyes", async () => {
  await withTempDir("four-eyes-visual", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    const visualReport: VisualSidecarValidationReport = {
      schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
      generatedAt: GENERATED_AT,
      jobId: "job-1",
      totalScreens: 1,
      screensWithFindings: 1,
      blocked: false,
      records: [
        {
          screenId: "s-1",
          deployment: "llama-4-maverick-vision",
          outcomes: ["low_confidence"],
          issues: [],
          meanConfidence: 0.4,
        },
      ],
    };
    const snapshot = await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-1", riskCategory: "low" })]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
      visualReport,
    });
    const entry = snapshot.perTestCase[0];
    assert.equal(entry?.fourEyesEnforced, true);
    assert.deepEqual(entry?.fourEyesReasons, ["visual_low_confidence"]);
    const first = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.event.kind, "primary_approved");
  });
});

test("four-eyes: re-edit invalidates the in-progress approval chain", async () => {
  await withTempDir("four-eyes-reedit", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-1", riskCategory: "regulated_data" })]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    const editResult = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "edited",
      at: GENERATED_AT,
      actor: "carol",
    });
    assert.equal(editResult.ok, true);
    if (!editResult.ok) return;
    const entry = editResult.snapshot.perTestCase[0];
    assert.equal(entry?.state, "edited");
    assert.deepEqual(entry?.approvers, []);
    assert.equal(entry?.primaryReviewer, undefined);
    assert.equal(entry?.lastEditor, "carol");
    // alice must still be allowed to re-approve as primary because the
    // edit was made by carol; bob then completes the four-eyes round.
    const reprimary = await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-1",
      kind: "approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    assert.equal(reprimary.ok, true);
    if (!reprimary.ok) return;
    assert.equal(reprimary.event.toState, "pending_secondary_approval");
  });
});

test("four-eyes: snapshot persists fourEyesPolicy on disk", async () => {
  await withTempDir("four-eyes-persist", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([buildCase({ id: "tc-1", riskCategory: "high" })]),
      policy: policyWith([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: resolveFourEyesPolicy({
        fourEyesRequiredRiskCategories: ["high"],
        fourEyesVisualSidecarTriggerOutcomes: ["low_confidence"],
      }),
    });
    const reread = await store.readSnapshot("job-1");
    assert.deepEqual(reread?.fourEyesPolicy?.requiredRiskCategories, ["high"]);
    assert.deepEqual(reread?.fourEyesPolicy?.visualSidecarTriggerOutcomes, [
      "low_confidence",
    ]);
  });
});

test("four-eyes: export pipeline blocks an enforced case stuck at pending_secondary_approval", async () => {
  await withTempDir("four-eyes-export", async (dir) => {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    const tc = buildCase({
      id: "tc-fin",
      riskCategory: "financial_transaction",
    });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: wrap([tc]),
      policy: policyWith([
        { testCaseId: "tc-fin", decision: "needs_review", violations: [] },
      ]),
      fourEyesPolicy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    });
    await store.recordTransition({
      jobId: "job-1",
      testCaseId: "tc-fin",
      kind: "approved",
      at: GENERATED_AT,
      actor: "alice",
    });
    const snapshot = await store.readSnapshot("job-1");
    assert.equal(snapshot?.perTestCase[0]?.state, "pending_secondary_approval");
    const exportResult = runExportPipeline({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      intent: {
        version: "1.0.0",
        source: { kind: "figma_local_json", contentHash: ZERO },
        screens: [
          {
            screenId: "s-1",
            screenName: "Payment",
            trace: { nodeId: "s-1" },
          },
        ],
        detectedFields: [],
        detectedActions: [],
        detectedValidations: [],
        detectedNavigation: [],
        inferredBusinessObjects: [],
        risks: [],
        assumptions: [],
        openQuestions: [],
        piiIndicators: [],
        redactions: [],
      },
      list: wrap([tc]),
      validation: {
        schemaVersion: "1.0.0",
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        generatedAt: GENERATED_AT,
        jobId: "job-1",
        totalTestCases: 1,
        errorCount: 0,
        warningCount: 0,
        blocked: false,
        issues: [],
      },
      policy: policyWith([
        { testCaseId: "tc-fin", decision: "needs_review", violations: [] },
      ]),
      reviewSnapshot: snapshot!,
    });
    assert.equal(exportResult.refused, true);
    assert.deepEqual(exportResult.refusalCodes.sort(), [
      "no_approved_test_cases",
      "unapproved_test_cases_present",
    ]);
  });
});

test("four-eyes: export pipeline refuses forged approved state without two reviewers", () => {
  const tc = buildCase({
    id: "tc-fin",
    riskCategory: "financial_transaction",
  });
  const exportResult = runExportPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    intent: {
      version: "1.0.0",
      source: { kind: "figma_local_json", contentHash: ZERO },
      screens: [
        {
          screenId: "s-1",
          screenName: "Payment",
          trace: { nodeId: "s-1" },
        },
      ],
      detectedFields: [],
      detectedActions: [],
      detectedValidations: [],
      detectedNavigation: [],
      inferredBusinessObjects: [],
      risks: [],
      assumptions: [],
      openQuestions: [],
      piiIndicators: [],
      redactions: [],
    },
    list: wrap([tc]),
    validation: {
      schemaVersion: "1.0.0",
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      generatedAt: GENERATED_AT,
      jobId: "job-1",
      totalTestCases: 1,
      errorCount: 0,
      warningCount: 0,
      blocked: false,
      issues: [],
    },
    policy: policyWith([
      { testCaseId: "tc-fin", decision: "approved", violations: [] },
    ]),
    reviewSnapshot: {
      schemaVersion: "1.0.0",
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      approvedCount: 1,
      needsReviewCount: 0,
      rejectedCount: 0,
      pendingSecondaryApprovalCount: 0,
      perTestCase: [
        {
          testCaseId: "tc-fin",
          state: "approved",
          policyDecision: "approved",
          lastEventId: "forged-event",
          lastEventAt: GENERATED_AT,
          fourEyesEnforced: true,
          fourEyesReasons: ["risk_category"],
          approvers: ["alice"],
          primaryReviewer: "alice",
          primaryApprovalAt: GENERATED_AT,
        },
      ],
    },
  });
  assert.equal(exportResult.refused, true);
  assert.deepEqual(exportResult.refusalCodes, ["review_state_inconsistent"]);
});

test("four-eyes: export pipeline refuses forged approved state with missing secondary timestamp", () => {
  const tc = buildCase({
    id: "tc-fin",
    riskCategory: "financial_transaction",
  });
  const exportResult = runExportPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    intent: {
      version: "1.0.0",
      source: { kind: "figma_local_json", contentHash: ZERO },
      screens: [
        {
          screenId: "s-1",
          screenName: "Payment",
          trace: { nodeId: "s-1" },
        },
      ],
      detectedFields: [],
      detectedActions: [],
      detectedValidations: [],
      detectedNavigation: [],
      inferredBusinessObjects: [],
      risks: [],
      assumptions: [],
      openQuestions: [],
      piiIndicators: [],
      redactions: [],
    },
    list: wrap([tc]),
    validation: {
      schemaVersion: "1.0.0",
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      generatedAt: GENERATED_AT,
      jobId: "job-1",
      totalTestCases: 1,
      errorCount: 0,
      warningCount: 0,
      blocked: false,
      issues: [],
    },
    policy: policyWith([
      { testCaseId: "tc-fin", decision: "approved", violations: [] },
    ]),
    reviewSnapshot: {
      schemaVersion: "1.0.0",
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      approvedCount: 1,
      needsReviewCount: 0,
      rejectedCount: 0,
      pendingSecondaryApprovalCount: 0,
      perTestCase: [
        {
          testCaseId: "tc-fin",
          state: "approved",
          policyDecision: "approved",
          lastEventId: "forged-event",
          lastEventAt: GENERATED_AT,
          fourEyesEnforced: true,
          fourEyesReasons: ["risk_category"],
          approvers: ["alice", "bob"],
          primaryReviewer: "alice",
          primaryApprovalAt: GENERATED_AT,
          secondaryReviewer: "bob",
        },
      ],
    },
  });
  assert.equal(exportResult.refused, true);
  assert.deepEqual(exportResult.refusalCodes, ["review_state_inconsistent"]);
});
