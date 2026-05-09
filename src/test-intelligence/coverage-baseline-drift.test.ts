import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  COVERAGE_BASELINE_AXES,
  COVERAGE_BASELINE_DRIFT_RULE_ID,
  COVERAGE_BASELINE_DRIFT_THRESHOLD,
  COVERAGE_BASELINE_SCHEMA_VERSION,
  COVERAGE_BASELINES_DIRNAME,
  buildCoverageBaselineRecord,
  buildCoverageDriftPolicyViolation,
  coverageBaselinePath,
  evaluateCoverageBaselineDrift,
  extractCoverageRatiosFromReport,
  loadCoverageBaseline,
  syncCoverageBaselineForJob,
  writeCoverageBaseline,
  type CoverageBaselineRatios,
  type CoverageBaselineRecord,
} from "./coverage-baseline-drift.js";
import { canonicalJson } from "./content-hash.js";

const GENERATED_AT = "2026-05-06T10:00:00.000Z";
const POLICY_PROFILE_ID = "eu-banking-default";
const TENANT_ID = "tenant-1";
const ARCHETYPE = "customer-self-service";

const buildRatios = (
  overrides: Partial<CoverageBaselineRatios> = {},
): CoverageBaselineRatios => ({
  fieldCoverage: 0.8,
  actionCoverage: 0.7,
  validationCoverage: 0.6,
  navigationCoverage: 0.5,
  ...overrides,
});

const setupTempRuntimeRoot = async (): Promise<string> => {
  return mkdtemp(join(tmpdir(), "coverage-baseline-"));
};

test("coverage-baseline-drift: threshold and axis surface are stable", () => {
  assert.equal(COVERAGE_BASELINE_DRIFT_THRESHOLD, 0.1);
  assert.equal(COVERAGE_BASELINE_SCHEMA_VERSION, "1.0.0");
  assert.equal(COVERAGE_BASELINES_DIRNAME, "coverage-baselines");
  assert.equal(
    COVERAGE_BASELINE_DRIFT_RULE_ID,
    "policy:coverage-drift-exceeded",
  );
  assert.deepEqual(
    [...COVERAGE_BASELINE_AXES].sort(),
    [
      "actionCoverage",
      "fieldCoverage",
      "navigationCoverage",
      "validationCoverage",
    ],
  );
});

test("coverage-baseline-drift: path is per-tenant under <runtimeRoot>/coverage-baselines/<tenantId>/<archetype>.json", () => {
  const path = coverageBaselinePath({
    runtimeRoot: "/var/lib/workspace-dev",
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
  });
  assert.equal(
    path,
    `/var/lib/workspace-dev/${COVERAGE_BASELINES_DIRNAME}/${TENANT_ID}/${ARCHETYPE}.json`,
  );
});

test("coverage-baseline-drift: path rejects traversal segments and empty inputs", () => {
  assert.throws(() =>
    coverageBaselinePath({
      runtimeRoot: "/var/lib/workspace-dev",
      tenantId: "../escape",
      archetype: ARCHETYPE,
    }),
  );
  assert.throws(() =>
    coverageBaselinePath({
      runtimeRoot: "/var/lib/workspace-dev",
      tenantId: TENANT_ID,
      archetype: "../escape",
    }),
  );
  assert.throws(() =>
    coverageBaselinePath({
      runtimeRoot: "",
      tenantId: TENANT_ID,
      archetype: ARCHETYPE,
    }),
  );
});

test("coverage-baseline-drift: extractCoverageRatiosFromReport pulls every tracked axis", () => {
  const ratios = extractCoverageRatiosFromReport({
    coverage: {
      fieldCoverage: { total: 5, covered: 4, ratio: 0.8, uncoveredIds: [] },
      actionCoverage: { total: 4, covered: 2, ratio: 0.5, uncoveredIds: [] },
      fieldLifecycleCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
      validationCoverage: {
        total: 2,
        covered: 1,
        ratio: 0.5,
        uncoveredIds: [],
      },
      navigationCoverage: {
        total: 3,
        covered: 3,
        ratio: 1,
        uncoveredIds: [],
      },
    },
  });
  assert.deepEqual(ratios, {
    fieldCoverage: 0.8,
    actionCoverage: 0.5,
    validationCoverage: 0.5,
    navigationCoverage: 1,
  });
});

test("coverage-baseline-drift: evaluation with no baseline returns seeded=true and no findings", () => {
  const evaluation = evaluateCoverageBaselineDrift({
    baseline: undefined,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    candidateRatios: buildRatios(),
  });
  assert.equal(evaluation.seeded, true);
  assert.equal(evaluation.exceeded, false);
  assert.equal(evaluation.findings.length, 0);
  assert.equal(evaluation.threshold, COVERAGE_BASELINE_DRIFT_THRESHOLD);
});

test("coverage-baseline-drift: in-tolerance candidate yields no findings", () => {
  const baseline: CoverageBaselineRecord = buildCoverageBaselineRecord({
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    ratios: buildRatios(),
  });
  const evaluation = evaluateCoverageBaselineDrift({
    baseline,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    candidateRatios: buildRatios({ fieldCoverage: 0.85 }),
  });
  assert.equal(evaluation.seeded, false);
  assert.equal(evaluation.exceeded, false);
  assert.equal(evaluation.findings.length, 0);
});

test("coverage-baseline-drift: drift > 10% on any axis trips the gate", () => {
  const baseline = buildCoverageBaselineRecord({
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    ratios: buildRatios(),
  });
  const evaluation = evaluateCoverageBaselineDrift({
    baseline,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    // fieldCoverage drops by 0.2, well past the 10% threshold.
    candidateRatios: buildRatios({ fieldCoverage: 0.6 }),
  });
  assert.equal(evaluation.exceeded, true);
  assert.equal(evaluation.findings.length, 1);
  const finding = evaluation.findings[0];
  assert.equal(finding?.axis, "fieldCoverage");
  assert.equal(finding?.absoluteDelta, -0.2);
  assert.equal(finding?.threshold, COVERAGE_BASELINE_DRIFT_THRESHOLD);
});

test("coverage-baseline-drift: drift exactly at threshold is tolerated", () => {
  const baseline = buildCoverageBaselineRecord({
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    ratios: buildRatios(),
  });
  const evaluation = evaluateCoverageBaselineDrift({
    baseline,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    candidateRatios: buildRatios({
      fieldCoverage: 0.7,
      actionCoverage: 0.6,
      validationCoverage: 0.5,
      navigationCoverage: 0.4,
    }),
  });
  assert.equal(evaluation.exceeded, false);
  assert.equal(evaluation.findings.length, 0);
});

test("coverage-baseline-drift: relativeDelta is null when baseline ratio is 0", () => {
  const baseline = buildCoverageBaselineRecord({
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    ratios: buildRatios({ navigationCoverage: 0 }),
  });
  const evaluation = evaluateCoverageBaselineDrift({
    baseline,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    candidateRatios: buildRatios({ navigationCoverage: 0.4 }),
  });
  assert.equal(evaluation.exceeded, true);
  const navFinding = evaluation.findings.find(
    (f) => f.axis === "navigationCoverage",
  );
  assert.equal(navFinding?.relativeDelta, null);
});

test("coverage-baseline-drift: drift on multiple axes is reported deterministically", () => {
  const baseline = buildCoverageBaselineRecord({
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    ratios: buildRatios(),
  });
  const evaluation = evaluateCoverageBaselineDrift({
    baseline,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    candidateRatios: buildRatios({
      fieldCoverage: 0.5,
      actionCoverage: 0.4,
    }),
  });
  assert.equal(evaluation.exceeded, true);
  assert.equal(evaluation.findings.length, 2);
});

test("coverage-baseline-drift: build...Violation emits warning + needs_review-class outcome", () => {
  const baseline = buildCoverageBaselineRecord({
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    ratios: buildRatios(),
  });
  const evaluation = evaluateCoverageBaselineDrift({
    baseline,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    candidateRatios: buildRatios({ fieldCoverage: 0.5 }),
  });
  const violation = buildCoverageDriftPolicyViolation(evaluation);
  assert.notEqual(violation, undefined);
  assert.equal(violation?.rule, COVERAGE_BASELINE_DRIFT_RULE_ID);
  assert.equal(violation?.outcome, "coverage_drift_exceeded");
  assert.equal(violation?.severity, "warning");
  assert.match(violation?.reason ?? "", /coverage drift exceeded/);
  assert.match(violation?.reason ?? "", /fieldCoverage/);
});

test("coverage-baseline-drift: build...Violation returns undefined when not exceeded", () => {
  const evaluation = evaluateCoverageBaselineDrift({
    baseline: buildCoverageBaselineRecord({
      tenantId: TENANT_ID,
      archetype: ARCHETYPE,
      policyProfileId: POLICY_PROFILE_ID,
      generatedAt: GENERATED_AT,
      ratios: buildRatios(),
    }),
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    candidateRatios: buildRatios(),
  });
  assert.equal(buildCoverageDriftPolicyViolation(evaluation), undefined);
});

test("coverage-baseline-drift: writeCoverageBaseline persists canonical JSON atomically", async () => {
  const runtimeRoot = await setupTempRuntimeRoot();
  const record = buildCoverageBaselineRecord({
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    ratios: buildRatios(),
  });
  const path = await writeCoverageBaseline({
    runtimeRoot,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    record,
  });
  const raw = await readFile(path, "utf8");
  const trimmed = raw.replace(/\n$/u, "");
  assert.equal(trimmed, canonicalJson(record));
  const parsed = JSON.parse(trimmed) as CoverageBaselineRecord;
  assert.equal(parsed.archetype, ARCHETYPE);
  assert.equal(parsed.tenantId, TENANT_ID);
  assert.equal(parsed.schemaVersion, COVERAGE_BASELINE_SCHEMA_VERSION);
});

test("coverage-baseline-drift: loadCoverageBaseline returns undefined when missing (first run)", async () => {
  const runtimeRoot = await setupTempRuntimeRoot();
  const baseline = await loadCoverageBaseline({
    runtimeRoot,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
  });
  assert.equal(baseline, undefined);
});

test("coverage-baseline-drift: loadCoverageBaseline rejects identity mismatch", async () => {
  const runtimeRoot = await setupTempRuntimeRoot();
  const path = coverageBaselinePath({
    runtimeRoot,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
  });
  const tampered: CoverageBaselineRecord = {
    schemaVersion: COVERAGE_BASELINE_SCHEMA_VERSION,
    tenantId: "different-tenant",
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    ratios: buildRatios(),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, canonicalJson(tampered), "utf8");
  await assert.rejects(
    () =>
      loadCoverageBaseline({
        runtimeRoot,
        tenantId: TENANT_ID,
        archetype: ARCHETYPE,
        policyProfileId: POLICY_PROFILE_ID,
      }),
    /tenantId mismatch/,
  );
});

test("coverage-baseline-drift: loadCoverageBaseline rejects schema-version drift", async () => {
  const runtimeRoot = await setupTempRuntimeRoot();
  const path = coverageBaselinePath({
    runtimeRoot,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    canonicalJson({
      schemaVersion: "0.0.0",
      tenantId: TENANT_ID,
      archetype: ARCHETYPE,
      policyProfileId: POLICY_PROFILE_ID,
      generatedAt: GENERATED_AT,
      ratios: buildRatios(),
    }),
    "utf8",
  );
  await assert.rejects(
    () =>
      loadCoverageBaseline({
        runtimeRoot,
        tenantId: TENANT_ID,
        archetype: ARCHETYPE,
        policyProfileId: POLICY_PROFILE_ID,
      }),
    /unsupported schema/,
  );
});

test("coverage-baseline-drift: syncCoverageBaselineForJob seeds on first run (no drift)", async () => {
  const runtimeRoot = await setupTempRuntimeRoot();
  const result = await syncCoverageBaselineForJob({
    runtimeRoot,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    candidateRatios: buildRatios(),
  });
  assert.equal(result.evaluation.seeded, true);
  assert.equal(result.evaluation.exceeded, false);
  assert.notEqual(result.persistedPath, undefined);

  // The seed must be readable on the next run.
  const baseline = await loadCoverageBaseline({
    runtimeRoot,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
  });
  assert.notEqual(baseline, undefined);
  assert.deepEqual(baseline?.ratios, buildRatios());
});

test("coverage-baseline-drift: syncCoverageBaselineForJob in check mode flags drift > 10%", async () => {
  const runtimeRoot = await setupTempRuntimeRoot();
  // Seed first.
  await syncCoverageBaselineForJob({
    runtimeRoot,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    candidateRatios: buildRatios(),
  });
  // Subsequent run with major drift on actionCoverage.
  const result = await syncCoverageBaselineForJob({
    runtimeRoot,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    candidateRatios: buildRatios({ actionCoverage: 0.4 }),
  });
  assert.equal(result.evaluation.seeded, false);
  assert.equal(result.evaluation.exceeded, true);
  assert.equal(result.persistedPath, undefined);
  assert.equal(
    result.evaluation.findings.some((f) => f.axis === "actionCoverage"),
    true,
  );
});

test("coverage-baseline-drift: syncCoverageBaselineForJob in update mode rebases (drift skipped)", async () => {
  const runtimeRoot = await setupTempRuntimeRoot();
  // Seed at low ratios.
  await syncCoverageBaselineForJob({
    runtimeRoot,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    candidateRatios: buildRatios({ fieldCoverage: 0.3 }),
  });
  // Re-baseline at higher ratios — drift should be skipped, baseline rewritten.
  const result = await syncCoverageBaselineForJob({
    runtimeRoot,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    candidateRatios: buildRatios({ fieldCoverage: 0.95 }),
    mode: "update",
  });
  assert.equal(result.evaluation.exceeded, false);
  assert.equal(result.evaluation.seeded, true);
  assert.notEqual(result.persistedPath, undefined);
  const baseline = await loadCoverageBaseline({
    runtimeRoot,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
  });
  assert.equal(baseline?.ratios.fieldCoverage, 0.95);
});

test("coverage-baseline-drift: syncCoverageBaselineForJob check mode does not rewrite when in tolerance", async () => {
  const runtimeRoot = await setupTempRuntimeRoot();
  await syncCoverageBaselineForJob({
    runtimeRoot,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    candidateRatios: buildRatios(),
  });
  const before = await readFile(
    coverageBaselinePath({
      runtimeRoot,
      tenantId: TENANT_ID,
      archetype: ARCHETYPE,
    }),
    "utf8",
  );
  const result = await syncCoverageBaselineForJob({
    runtimeRoot,
    tenantId: TENANT_ID,
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    candidateRatios: buildRatios({ fieldCoverage: 0.85 }),
  });
  assert.equal(result.evaluation.seeded, false);
  assert.equal(result.evaluation.exceeded, false);
  const after = await readFile(
    coverageBaselinePath({
      runtimeRoot,
      tenantId: TENANT_ID,
      archetype: ARCHETYPE,
    }),
    "utf8",
  );
  assert.equal(after, before);
});

test("coverage-baseline-drift: writeCoverageBaseline rejects record/path identity mismatch", async () => {
  const runtimeRoot = await setupTempRuntimeRoot();
  const record = buildCoverageBaselineRecord({
    tenantId: "tenant-A",
    archetype: ARCHETYPE,
    policyProfileId: POLICY_PROFILE_ID,
    generatedAt: GENERATED_AT,
    ratios: buildRatios(),
  });
  await assert.rejects(
    () =>
      writeCoverageBaseline({
        runtimeRoot,
        tenantId: "tenant-B",
        archetype: ARCHETYPE,
        record,
      }),
    /tenantId/,
  );
});

test("coverage-baseline-drift: evaluateCoverageBaselineDrift rejects negative threshold", () => {
  assert.throws(() =>
    evaluateCoverageBaselineDrift({
      baseline: undefined,
      tenantId: TENANT_ID,
      archetype: ARCHETYPE,
      policyProfileId: POLICY_PROFILE_ID,
      candidateRatios: buildRatios(),
      threshold: -0.01,
    }),
  );
});
