import assert from "node:assert/strict";
import test from "node:test";

import type { GeneratedTestCase, GeneratedTestCaseList } from "../contracts/index.js";
import { serializeConsolidatedFindings } from "./finding-consolidator.js";
import {
  applyRepairPlan,
  buildRepairPlan,
  computeGeneratedTestCaseRepairHash,
  serializeRepairPlan,
} from "./repair-planner.js";

const makeCase = (input: {
  id: string;
  type?: GeneratedTestCase["type"];
  reviewState?: GeneratedTestCase["reviewState"];
}): GeneratedTestCase => ({
  id: input.id,
  sourceJobId: "job-1786",
  contractVersion: "1.6.0",
  schemaVersion: "1.0.0",
  promptTemplateVersion: "prompt-v1",
  title: input.id,
  objective: "Objective",
  level: "system",
  type: input.type ?? "functional",
  priority: "p1",
  riskCategory: "medium",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "Open screen" }],
  expectedResults: ["Screen opens"],
  figmaTraceRefs: [{ screenId: "screen-1" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.75,
  },
  reviewState: input.reviewState ?? "draft",
  audit: {
    jobId: "job-1786",
    generatedAt: "2026-05-03T00:00:00.000Z",
    contractVersion: "1.6.0",
    schemaVersion: "1.0.0",
    promptTemplateVersion: "prompt-v1",
    redactionPolicyVersion: "redaction-v1",
    visualSidecarSchemaVersion: "1.0.0",
    cacheHit: false,
    cacheKey: "cache-key",
    inputHash: "a".repeat(64),
    promptHash: "b".repeat(64),
    schemaHash: "c".repeat(64),
  },
});

const makeList = (...testCases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: "1.0.0",
  jobId: "job-1786",
  testCases,
});

const acceptedCaseIds = new Set(["tc-accepted"]);

const findings = [
  {
    schemaVersion: "1.0.0" as const,
    findingId: "repair-gap-1",
    fingerprint: "f".repeat(64),
    source: "gap" as const,
    severity: "major" as const,
    kind: "missing_negative_case",
    summary:
      "Negative-path coverage is incomplete for surviving adversarial checks.",
    repairTarget: "test_data" as const,
    sourceRefs: ["rule:missing-required"],
    ruleRefs: ["mut-negative"],
    relatedFindingIds: ["gap-missing-negative_case", "mut-negative"],
    preferredCaseTypes: ["functional"],
  },
  {
    schemaVersion: "1.0.0" as const,
    findingId: "repair-accepted-1",
    fingerprint: "e".repeat(64),
    source: "validator" as const,
    severity: "major" as const,
    kind: "traceability_missing",
    summary: "Accepted case should not be modified.",
    repairTarget: "metadata" as const,
    testCaseId: "tc-accepted",
    sourceRefs: [],
    ruleRefs: ["traceability_missing"],
    relatedFindingIds: ["validator:traceability_missing:tc-accepted"],
  },
];

test("AT-019 equivalent: repair planner is deterministic and keeps accepted cases sticky", () => {
  const list = makeList(
    makeCase({ id: "tc-accepted", reviewState: "auto_approved" }),
    makeCase({ id: "tc-edit" }),
  );
  const planA = buildRepairPlan({ list, findings, acceptedCaseIds });
  const planB = buildRepairPlan({
    list,
    findings: JSON.parse(serializeConsolidatedFindings(findings)),
    acceptedCaseIds,
  });

  assert.equal(serializeRepairPlan(planA), serializeRepairPlan(planB));
  assert.equal(planA.outcome, "needs_review");
  assert.equal(planA.refusals[0]?.code, "repair_case_sticky_accepted");

  const applied = applyRepairPlan({ list, plan: planA, acceptedCaseIds });
  assert.equal(applied.list.testCases[0]?.id, "tc-accepted");
  assert.deepEqual(applied.list.testCases[0], list.testCases[0]);
  assert.deepEqual(applied.list.testCases[1]?.testData, [
    "Negative-path coverage is incomplete for surviving adversarial checks.",
  ]);
});

test("repair planner refuses hash mismatches with repair_hash_mismatch_refused", () => {
  const original = makeCase({ id: "tc-edit" });
  const list = makeList(original);
  const plan = buildRepairPlan({
    list,
    findings: [findings[0]!],
  });
  const mutated: GeneratedTestCase = {
    ...original,
    objective: "Objective changed after planning",
  };
  const result = applyRepairPlan({
    list: makeList(mutated),
    plan,
  });

  assert.equal(computeGeneratedTestCaseRepairHash(mutated) === plan.items[0]?.guard.expectedCurrentHash, false);
  assert.equal(result.outcome, "needs_review");
  assert.equal(result.refusals[0]?.code, "repair_hash_mismatch_refused");
  assert.equal(result.list.testCases[0]?.objective, mutated.objective);
});
