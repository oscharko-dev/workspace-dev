import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  COVERAGE_PLAN_SCHEMA_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TECHNIQUE_QUOTA_REPORT_ARTIFACT_FILENAME,
  TECHNIQUE_QUOTA_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type CoveragePlan,
  type GeneratedTestCase,
} from "../contracts/index.js";
import {
  buildPerScreenFieldCounts,
  buildTechniqueQuotaReport,
  collectTechniqueQuotaDeficits,
  computeTierElasticEquivalencePartitioningQuota,
  resolveTechniqueQuotas,
  writeTechniqueQuotaReport,
} from "./technique-quota.js";

const ZERO = "0".repeat(64);
const GENERATED_AT = "2026-05-08T18:17:37.630Z";

const buildCase = (
  overrides: Partial<GeneratedTestCase> & {
    id: string;
    technique: GeneratedTestCase["technique"];
    screenId: string;
  },
): GeneratedTestCase => ({
  id: overrides.id,
  sourceJobId: "job-K0",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: `case ${overrides.id}`,
  objective: "objective",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "do" }],
  expectedResults: [],
  figmaTraceRefs: [{ screenId: overrides.screenId }],
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
  reviewState: "draft",
  audit: {
    jobId: "job-K0",
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: "1.0.0",
    cacheHit: false,
    cacheKey: "k",
    inputHash: ZERO,
    promptHash: ZERO,
    schemaHash: ZERO,
  },
  ...overrides,
});

const buildPlan = (input: {
  screenId: string;
  fieldCount: number;
  plannerEpMin?: number;
  extras?: ReadonlyArray<{
    technique: import("../contracts/index.js").TestCaseTechnique29119;
    minCount: number;
  }>;
}): CoveragePlan => {
  const techniqueQuotas: CoveragePlan["perScreen"][number]["techniqueQuotas"] =
    [
      ...(input.plannerEpMin !== undefined
        ? [
            {
              technique: "equivalence_partitioning" as const,
              minCount: input.plannerEpMin,
            },
          ]
        : []),
      ...(input.extras ?? []),
    ];
  const perElement = Array.from({ length: input.fieldCount }, (_, idx) => ({
    screenId: input.screenId,
    elementId: `${input.screenId}.field-${idx + 1}`,
    mustHaveCase: true,
    riskClass: "low" as const,
  }));
  return {
    schemaVersion: COVERAGE_PLAN_SCHEMA_VERSION,
    jobId: "job-K0",
    perScreen: [{ screenId: input.screenId, techniqueQuotas }],
    perElement,
    minimumCases: [],
    recommendedCases: [],
    techniques: [],
    mutationKillRateTarget: 0.85,
  };
};

test("tier-elastic formula: <=4 fields → max(4, 2*fields), 5–8 → ceil(1.5*fields), >=9 → fields", () => {
  for (const [fc, expected] of [
    [0, { quota: 0, label: /max\(4/ }],
    [1, { quota: 4, label: /max\(4/ }],
    [3, { quota: 6, label: /max\(4/ }],
    [4, { quota: 8, label: /max\(4/ }],
    [5, { quota: 8, label: /ceil\(1\.5\*fields\)/ }],
    [7, { quota: 11, label: /ceil\(1\.5\*fields\)/ }],
    [8, { quota: 12, label: /ceil\(1\.5\*fields\)/ }],
    [9, { quota: 9, label: /fields>=9/ }],
    [12, { quota: 12, label: /fields>=9/ }],
  ] as const) {
    const result = computeTierElasticEquivalencePartitioningQuota(fc);
    assert.equal(
      result.quota,
      expected.quota,
      `fieldCount=${fc} → expected ${expected.quota}, got ${result.quota}`,
    );
    assert.match(result.formula, expected.label);
  }
});

test("buildPerScreenFieldCounts derives unique element counts from CoveragePlan.perElement", () => {
  const plan = buildPlan({ screenId: "1:11309", fieldCount: 9 });
  const counts = buildPerScreenFieldCounts(plan);
  assert.equal(counts.size, 1);
  assert.equal(counts.get("1:11309"), 9);
});

test("Issue #2068: K0 evidence — 9 fields × tier-elastic mode resolves EP quota to 9", () => {
  const plan = buildPlan({
    screenId: "1:11309",
    fieldCount: 9,
    plannerEpMin: 12,
  });
  const cases = Array.from({ length: 10 }, (_, idx) =>
    buildCase({
      id: `tc-ep-${idx + 1}`,
      technique: "equivalence_partitioning",
      screenId: "1:11309",
    }),
  );
  const deficits = collectTechniqueQuotaDeficits(cases, plan, {
    mode: "tier-elastic",
  });
  assert.deepEqual(deficits, [], "K0 should pass under tier-elastic mode");
});

test("Issue #2068: fixed mode preserves the planner's 12-EP minimum verbatim", () => {
  const plan = buildPlan({
    screenId: "1:11309",
    fieldCount: 9,
    plannerEpMin: 12,
  });
  const cases = Array.from({ length: 10 }, (_, idx) =>
    buildCase({
      id: `tc-ep-${idx + 1}`,
      technique: "equivalence_partitioning",
      screenId: "1:11309",
    }),
  );
  const deficits = collectTechniqueQuotaDeficits(cases, plan, {
    mode: "fixed",
  });
  assert.equal(deficits.length, 1);
  assert.equal(deficits[0]?.minCount, 12);
  assert.equal(deficits[0]?.actual, 10);
  assert.equal(deficits[0]?.missing, 2);
});

test("Issue #2068: tier-elastic mode never synthesises an EP row when the planner publishes none", () => {
  // Conservative scope (issue #2068): the formula replaces an existing
  // EP quota, it does not invent one. When the planner emits no EP row
  // for a screen, the gate stays silent there — preserving byte-for-byte
  // behaviour with the pre-#2068 audit baseline on screens that the
  // planner deemed irrelevant for EP coverage.
  const plan = buildPlan({ screenId: "s-small", fieldCount: 3 });
  const resolved = resolveTechniqueQuotas(plan, { mode: "tier-elastic" });
  assert.deepEqual(resolved, []);
});

test("Issue #2068: non-EP planner quotas are preserved in tier-elastic mode", () => {
  const plan = buildPlan({
    screenId: "s-1",
    fieldCount: 7,
    plannerEpMin: 12,
    extras: [{ technique: "boundary_value_analysis", minCount: 3 }],
  });
  const resolved = resolveTechniqueQuotas(plan, { mode: "tier-elastic" });
  const bva = resolved.find(
    (row) => row.technique === "boundary_value_analysis",
  );
  assert.equal(bva?.requiredCount, 3);
  assert.equal(bva?.formula, "fixed:planner-quota");
});

test("Issue #2068: technique-quota report is sorted, deterministic, and tracks pass/deficit counts", () => {
  const plan = buildPlan({
    screenId: "s-1",
    fieldCount: 7,
    plannerEpMin: 12,
    extras: [{ technique: "boundary_value_analysis", minCount: 1 }],
  });
  const cases = [
    buildCase({
      id: "tc-ep-1",
      technique: "equivalence_partitioning",
      screenId: "s-1",
    }),
  ];
  const report = buildTechniqueQuotaReport({
    generatedAt: GENERATED_AT,
    jobId: "job-K0",
    policyProfileId: "eu-banking-default",
    cases,
    coveragePlan: plan,
    policy: { mode: "tier-elastic" },
  });
  assert.equal(report.schemaVersion, TECHNIQUE_QUOTA_REPORT_SCHEMA_VERSION);
  assert.equal(report.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(report.mode, "tier-elastic");
  assert.equal(report.screenCount, 1);
  // EP row deficits: required=11 (ceil(1.5*7)), actual=1; BVA deficit: 1 vs 0
  assert.equal(report.entries.length, 2);
  assert.deepEqual(
    [...report.entries].map((entry) => entry.technique),
    ["boundary_value_analysis", "equivalence_partitioning"],
  );
  const epEntry = report.entries.find(
    (entry) => entry.technique === "equivalence_partitioning",
  );
  assert.equal(epEntry?.requiredCount, 11);
  assert.equal(epEntry?.actualCount, 1);
  assert.equal(epEntry?.status, "deficit");
  assert.equal(epEntry?.fieldCount, 7);
  assert.equal(report.deficitCount, 2);
  assert.equal(report.passCount, 0);
});

test("Issue #2068: undefined policy defaults to tier-elastic (legacy callers stay safe)", () => {
  const plan = buildPlan({
    screenId: "1:11309",
    fieldCount: 9,
    plannerEpMin: 12,
  });
  const cases = Array.from({ length: 9 }, (_, idx) =>
    buildCase({
      id: `tc-ep-${idx + 1}`,
      technique: "equivalence_partitioning",
      screenId: "1:11309",
    }),
  );
  const deficits = collectTechniqueQuotaDeficits(cases, plan);
  assert.deepEqual(deficits, []);
});

test("writeTechniqueQuotaReport persists a byte-deterministic JSON artifact", async () => {
  const plan = buildPlan({
    screenId: "s-1",
    fieldCount: 9,
    plannerEpMin: 12,
  });
  const report = buildTechniqueQuotaReport({
    generatedAt: GENERATED_AT,
    jobId: "job-K0",
    policyProfileId: "eu-banking-default",
    cases: [],
    coveragePlan: plan,
    policy: { mode: "tier-elastic" },
  });
  const dir = await mkdtemp(join(tmpdir(), "technique-quota-"));
  try {
    const result = await writeTechniqueQuotaReport({
      runDir: dir,
      artifact: report,
    });
    assert.equal(
      result.path,
      join(dir, TECHNIQUE_QUOTA_REPORT_ARTIFACT_FILENAME),
    );
    const persisted = JSON.parse(await readFile(result.path, "utf8"));
    assert.equal(persisted.schemaVersion, TECHNIQUE_QUOTA_REPORT_SCHEMA_VERSION);
    assert.equal(persisted.entries.length, 1);
    assert.equal(persisted.entries[0].technique, "equivalence_partitioning");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
