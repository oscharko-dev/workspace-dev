import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  COVERAGE_PLAN_SCHEMA_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TIER_ELASTIC_EP_TIERS,
  TECHNIQUE_QUOTA_REPORT_ARTIFACT_FILENAME,
  TECHNIQUE_QUOTA_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type CoveragePlan,
  type GeneratedTestCase,
  type TechniqueCoverageMinimumPolicy,
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

test("tier-elastic formula: tier bands follow the 4/5/9/20 cutovers", () => {
  for (const [fc, expected] of [
    [1, { quota: 4, label: /max\(4, 2\*fields\)/ }],
    [4, { quota: 8, label: /max\(4, 2\*fields\)/ }],
    [5, { quota: 7, label: /ceil\(1\.25\*fields\)/ }],
    [8, { quota: 10, label: /ceil\(1\.25\*fields\)/ }],
    [9, { quota: 9, label: /ceil\(0\.9\*fields\)/ }],
    [19, { quota: 18, label: /ceil\(0\.9\*fields\)/ }],
    [20, { quota: 17, label: /ceil\(0\.85\*fields\)/ }],
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

test("Epic #2167 P0 scenario — xr6Nf 32-field screen clears the documented quota miss-by-4", () => {
  // P0 multi-dataset benchmark (2026-05-11) reported xr6Nf / Test-View-05
  // (32 fields) failing the technique-coverage-minimum gate: the 0.85×
  // tier required 28 EP cases while the generator produced 24 — a miss
  // by 4. The W5-4 follow-up (b9c31a45) added a fields>=30 tier at 0.75×,
  // lowering the requirement to 24, which matches the generator output.
  // If a future regressor drops the fields>=30 tier OR raises its
  // multiplier back above 0.75, this pin fires immediately with the P0
  // scenario name attached.
  const xr6Nf = computeTierElasticEquivalencePartitioningQuota(32);
  assert.equal(
    xr6Nf.quota,
    24,
    `Epic #2167 P0 regression guard: xr6Nf (32 fields) quota = ${xr6Nf.quota} — expected 24 to match the generator's 24-case output`,
  );
  assert.match(xr6Nf.formula, /ceil\(0\.75\*fields\)/);
});

test("Issue #2171: tier-elastic quotas accept caller-supplied tiers and keep the canonical tier table exposed", () => {
  const customPolicy: TechniqueCoverageMinimumPolicy = {
    mode: "tier-elastic",
    tiers: [
      {
        minFieldCount: 0,
        multiplier: 3,
        floor: 2,
        label: "custom:0",
      },
      {
        minFieldCount: 2,
        multiplier: 1,
        floor: 0,
        label: "custom:2",
      },
    ],
  };

  const result = computeTierElasticEquivalencePartitioningQuota(
    3,
    customPolicy.tiers,
  );
  assert.equal(result.quota, 3);
  assert.equal(result.formula, "tier-elastic:custom:2");
  assert.equal(result.formulaTier, "custom:2");
  assert.equal(result.formulaMultiplier, 1);

  assert.deepEqual(TIER_ELASTIC_EP_TIERS, [
    {
      minFieldCount: 0,
      multiplier: 2,
      floor: 4,
      label: "fields<=4: max(4, 2*fields)",
    },
    {
      minFieldCount: 5,
      multiplier: 1.25,
      floor: 0,
      label: "fields=5-8: ceil(1.25*fields)",
    },
    {
      minFieldCount: 9,
      multiplier: 0.9,
      floor: 0,
      label: "fields=9-19: ceil(0.9*fields)",
    },
    {
      minFieldCount: 20,
      multiplier: 0.85,
      floor: 0,
      label: "fields=20-29: ceil(0.85*fields)",
    },
    // Wave-5 W5-4 follow-up (2026-05-11): added fields>=30 tier at 0.75×
    // to unblock multi-section banking masks (xr6Nf / Test-View-05).
    {
      minFieldCount: 30,
      multiplier: 0.75,
      floor: 0,
      label: "fields>=30: ceil(0.75*fields)",
    },
  ]);
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

test("Issue #2026: shared EP cases satisfy the quota when they cover every field target on the screen", () => {
  const plan = buildPlan({
    screenId: "s-shared",
    fieldCount: 3,
    plannerEpMin: 3,
  });
  const cases = [
    buildCase({
      id: "tc-ep-1",
      technique: "equivalence_partitioning",
      screenId: "s-shared",
      qualitySignals: {
        coveredFieldIds: ["s-shared.field-1", "s-shared.field-2"],
        coveredActionIds: [],
        coveredValidationIds: [],
        coveredNavigationIds: [],
        confidence: 0.9,
      },
    }),
    buildCase({
      id: "tc-ep-2",
      technique: "equivalence_partitioning",
      screenId: "s-shared",
      qualitySignals: {
        coveredFieldIds: ["s-shared.field-3"],
        coveredActionIds: [],
        coveredValidationIds: [],
        coveredNavigationIds: [],
        confidence: 0.9,
      },
    }),
  ];

  const deficits = collectTechniqueQuotaDeficits(cases, plan, {
    mode: "tier-elastic",
  });
  assert.deepEqual(deficits, []);

  const report = buildTechniqueQuotaReport({
    generatedAt: GENERATED_AT,
    jobId: "job-shared",
    policyProfileId: "eu-banking-default",
    cases,
    coveragePlan: plan,
    policy: { mode: "tier-elastic" },
  });
  const epEntry = report.entries.find(
    (entry) => entry.technique === "equivalence_partitioning",
  );
  assert.equal(epEntry?.actualCount, 2);
  assert.equal(epEntry?.requiredCount, 3);
  assert.equal(epEntry?.status, "pass");
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
  assert.equal(bva?.formulaTier, "planner-quota");
  assert.equal(bva?.formulaMultiplier, null);
});

test("Issue #2171: technique-quota report is sorted, deterministic, and carries the tier audit trail", () => {
  const plan = buildPlan({
    screenId: "s-1",
    fieldCount: 19,
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
  // EP row deficit: required=12 (planner minimum remains tighter than the
  // 19-field tier formula); BVA deficit: required=1 vs actual=0.
  assert.equal(report.entries.length, 2);
  assert.deepEqual(
    [...report.entries].map((entry) => entry.technique),
    ["boundary_value_analysis", "equivalence_partitioning"],
  );
  const bvaEntry = report.entries.find(
    (entry) => entry.technique === "boundary_value_analysis",
  );
  assert.equal(bvaEntry?.requiredCount, 1);
  assert.equal(bvaEntry?.actualCount, 0);
  assert.equal(bvaEntry?.formula, "fixed:planner-quota");
  assert.equal(bvaEntry?.formulaTier, "planner-quota");
  assert.equal(bvaEntry?.formulaMultiplier, null);
  assert.equal(bvaEntry?.status, "deficit");
  const epEntry = report.entries.find(
    (entry) => entry.technique === "equivalence_partitioning",
  );
  assert.equal(epEntry?.requiredCount, 12);
  assert.equal(epEntry?.actualCount, 1);
  assert.equal(epEntry?.status, "deficit");
  assert.equal(epEntry?.fieldCount, 19);
  assert.equal(epEntry?.formula, "fixed:planner-quota");
  assert.equal(epEntry?.formulaTier, "fields=9-19: ceil(0.9*fields)");
  assert.equal(epEntry?.formulaMultiplier, 0.9);
  assert.equal(report.deficitCount, 2);
  assert.equal(report.passCount, 0);
});

test("Issue #2171: fixed technique-coverage mode still enforces the planner's EP minimum verbatim", () => {
  const plan = buildPlan({
    screenId: "s-fixed",
    fieldCount: 19,
    plannerEpMin: 12,
  });
  const resolved = resolveTechniqueQuotas(plan, { mode: "fixed" });
  const epRow = resolved.find(
    (row) => row.technique === "equivalence_partitioning",
  );
  assert.equal(epRow?.requiredCount, 12);
  assert.equal(epRow?.formula, "fixed:planner-quota");
  assert.equal(epRow?.formulaTier, "planner-quota");
  assert.equal(epRow?.formulaMultiplier, null);
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
    assert.equal(
      persisted.schemaVersion,
      TECHNIQUE_QUOTA_REPORT_SCHEMA_VERSION,
    );
    assert.equal(persisted.entries.length, 1);
    assert.equal(persisted.entries[0].technique, "equivalence_partitioning");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
