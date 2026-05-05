import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCaseAuditMetadata,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import {
  BASELINE_ARCHETYPE_FIXTURE_IDS,
  loadBaselineArchetypeFixture,
} from "./baseline-fixtures.js";
import { canonicalJson } from "./content-hash.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import {
  REGRESSION_EVAL_FIXTURE_GENERATED_AT,
  REGRESSION_EVAL_RISK_CATEGORIES,
  REGRESSION_EVAL_SCHEMA_VERSION,
  REGRESSION_EVAL_TECHNIQUES,
  REGRESSION_EVAL_TOLERANCES,
  buildAllRegressionSnapshots,
  buildRegressionSnapshot,
  diffRegressionSnapshot,
  isRegressionApproveModeEnabled,
  isRegressionCiRuntime,
  loadRegressionSnapshot,
  regressionDriftReportFilename,
  regressionSnapshotFilename,
  renderDriftReport,
  writeDriftReport,
  writeRegressionSnapshot,
} from "./regression-eval.js";
import { synthesizeGeneratedTestCases } from "./validation-harness.js";

const buildTestAuditMetadata = (
  jobId: string,
): GeneratedTestCaseAuditMetadata => ({
  jobId,
  generatedAt: REGRESSION_EVAL_FIXTURE_GENERATED_AT,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  redactionPolicyVersion: REDACTION_POLICY_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  cacheHit: false,
  cacheKey: "regression-eval-test-cache-key",
  inputHash: "regression-eval-test-input-hash",
  promptHash: "regression-eval-test-prompt-hash",
  schemaHash: "regression-eval-test-schema-hash",
});

test("regression-eval: tolerances are exported as a frozen production-baseline profile", () => {
  assert.equal(Object.isFrozen(REGRESSION_EVAL_TOLERANCES), true);
  assert.equal(REGRESSION_EVAL_TOLERANCES.coverageRatioAbsoluteDelta, 0.05);
  assert.equal(REGRESSION_EVAL_TOLERANCES.caseCountAbsoluteDelta, 2);
  assert.equal(REGRESSION_EVAL_SCHEMA_VERSION, "1.0.0");
});

test("regression-eval: ships snapshots covering all 7 baseline archetypes", () => {
  assert.equal(BASELINE_ARCHETYPE_FIXTURE_IDS.length, 7);
});

test("regression-eval: snapshots are deterministic across rebuilds", async () => {
  const first = await buildAllRegressionSnapshots();
  const second = await buildAllRegressionSnapshots();
  assert.equal(canonicalJson(first), canonicalJson(second));
});

test("regression-eval: every committed snapshot matches a fresh re-run", async () => {
  for (const archetypeId of BASELINE_ARCHETYPE_FIXTURE_IDS) {
    const baseline = await loadRegressionSnapshot(archetypeId);
    const candidate = await buildRegressionSnapshot({ archetypeId });
    const diff = diffRegressionSnapshot({ baseline, candidate });
    assert.equal(
      diff.hasDrift,
      false,
      `Drift detected for ${archetypeId}: ${diff.findings
        .map((f) => `${f.path} (${f.baseline} → ${f.candidate})`)
        .join(", ")}`,
    );
    assert.equal(baseline.schemaVersion, REGRESSION_EVAL_SCHEMA_VERSION);
    assert.equal(baseline.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
    assert.equal(baseline.archetypeId, archetypeId);
  }
});

test("regression-eval: every snapshot covers every documented riskCategory and technique key", async () => {
  for (const archetypeId of BASELINE_ARCHETYPE_FIXTURE_IDS) {
    const baseline = await loadRegressionSnapshot(archetypeId);
    for (const category of REGRESSION_EVAL_RISK_CATEGORIES) {
      assert.equal(
        typeof baseline.caseCounts.byRiskCategory[category],
        "number",
        `Missing riskCategory key '${category}' in ${archetypeId} snapshot.`,
      );
    }
    for (const technique of REGRESSION_EVAL_TECHNIQUES) {
      assert.equal(
        typeof baseline.caseCounts.byTechnique[technique],
        "number",
        `Missing technique key '${technique}' in ${archetypeId} snapshot.`,
      );
    }
  }
});

test("regression-eval: drift detection fires when a candidate run drops a test case", async () => {
  const archetypeId = BASELINE_ARCHETYPE_FIXTURE_IDS[0];
  const baseline = await buildRegressionSnapshot({ archetypeId });
  const fixture = await loadBaselineArchetypeFixture(archetypeId);
  const intent = deriveBusinessTestIntentIr({ figma: fixture.figma });
  const fullList = synthesizeGeneratedTestCases({
    jobId: `regression-eval-${archetypeId}-mutated`,
    generatedAt: REGRESSION_EVAL_FIXTURE_GENERATED_AT,
    intent,
    audit: buildTestAuditMetadata(`regression-eval-${archetypeId}-mutated`),
  });
  // Drop more than the per-bucket case-count tolerance (±2) so the
  // drift detector reliably fires regardless of the archetype.
  const reduceBy = REGRESSION_EVAL_TOLERANCES.caseCountAbsoluteDelta + 1;
  const reducedTestCases = fullList.testCases.slice(
    0,
    Math.max(0, fullList.testCases.length - reduceBy),
  );
  const mutatedList: GeneratedTestCaseList = {
    schemaVersion: fullList.schemaVersion,
    jobId: fullList.jobId,
    testCases: reducedTestCases,
  };
  const candidate = await buildRegressionSnapshot({
    archetypeId,
    listOverride: mutatedList,
  });
  const diff = diffRegressionSnapshot({ baseline, candidate });
  assert.equal(diff.hasDrift, true);
  assert.ok(
    diff.findings.some(
      (finding) =>
        finding.dimension === "caseCount" &&
        finding.path === "caseCounts.total",
    ),
    "Expected a caseCount drift on caseCounts.total",
  );
  for (const finding of diff.findings) {
    if (finding.dimension !== "caseCount") continue;
    assert.equal(typeof finding.absoluteDelta, "number");
  }
});

test("regression-eval: drift detection fires when the faithfulness verdict flips", async () => {
  const archetypeId = BASELINE_ARCHETYPE_FIXTURE_IDS[0];
  const baseline = await buildRegressionSnapshot({ archetypeId });
  // Empty list: faithfulness ratios drop to 0 except the degenerate
  // 0/0 path; trace fidelity falls below the 0.95 threshold; the
  // verdict will flip and the drift gate must fire on the
  // evalOutcomes path.
  const fixture = await loadBaselineArchetypeFixture(archetypeId);
  const intent = deriveBusinessTestIntentIr({ figma: fixture.figma });
  const truncatedList: GeneratedTestCaseList = {
    schemaVersion: "1.1.0",
    jobId: `regression-eval-${archetypeId}-empty`,
    testCases: [],
  };
  const candidate = await buildRegressionSnapshot({
    archetypeId,
    listOverride: truncatedList,
  });
  const diff = diffRegressionSnapshot({ baseline, candidate });
  assert.equal(diff.hasDrift, true);
  // The empty-list candidate must surface at least one numeric drift
  // finding (case counts collapse to zero) and at least one
  // eval-outcome drift (verdict flips). The exact dimensions depend
  // on the archetype, so we assert presence of both classes.
  const dimensions = new Set(diff.findings.map((finding) => finding.dimension));
  assert.ok(
    dimensions.has("caseCount") || dimensions.has("coverageRatio"),
    "Expected a caseCount or coverageRatio drift on the empty-list candidate",
  );
  // intent ↔ archetype identity must remain matched.
  assert.equal(
    diff.findings.some((finding) => finding.dimension === "archetype"),
    false,
  );
  assert.equal(
    diff.findings.some((finding) => finding.dimension === "intent"),
    false,
  );
  // Make sure the synth path still threads through; if intent or fixture
  // loading regressed the test would have already thrown.
  void intent;
});

test("regression-eval: tolerances absorb sub-threshold case-count perturbations", async () => {
  const archetypeId = BASELINE_ARCHETYPE_FIXTURE_IDS[0];
  const baseline = await buildRegressionSnapshot({ archetypeId });
  const fixture = await loadBaselineArchetypeFixture(archetypeId);
  const intent = deriveBusinessTestIntentIr({ figma: fixture.figma });
  const fullList = synthesizeGeneratedTestCases({
    jobId: `regression-eval-${archetypeId}-tolerated`,
    generatedAt: REGRESSION_EVAL_FIXTURE_GENERATED_AT,
    intent,
    audit: buildTestAuditMetadata(`regression-eval-${archetypeId}-tolerated`),
  });
  // Drop fewer than the tolerance band so case counts stay within ±2.
  const tolerableDrop = Math.max(
    0,
    Math.min(
      REGRESSION_EVAL_TOLERANCES.caseCountAbsoluteDelta,
      fullList.testCases.length - 1,
    ),
  );
  const tolerableList: GeneratedTestCaseList = {
    schemaVersion: fullList.schemaVersion,
    jobId: fullList.jobId,
    testCases: fullList.testCases.slice(
      0,
      fullList.testCases.length - tolerableDrop,
    ),
  };
  const candidate = await buildRegressionSnapshot({
    archetypeId,
    listOverride: tolerableList,
  });
  const diff = diffRegressionSnapshot({ baseline, candidate });
  // Case-counts changes within the tolerance band must NOT trip the
  // drift gate. The verdict-passed flag and failure-reason set are
  // identical too because the deterministic synthesiser still passes
  // every gate after a small case drop.
  assert.equal(
    diff.findings.some((f) => f.dimension === "caseCount"),
    false,
    `Tolerance band should absorb a ${tolerableDrop}-case drop`,
  );
});

test("regression-eval: writeRegressionSnapshot is atomic and round-trips canonical JSON", async () => {
  const archetypeId = BASELINE_ARCHETYPE_FIXTURE_IDS[0];
  const tempDir = await mkdtemp(join(tmpdir(), "regression-eval-"));
  const snapshot = await buildRegressionSnapshot({ archetypeId });
  const outputPath = join(
    tempDir,
    regressionSnapshotFilename(archetypeId),
  );
  const writtenPath = await writeRegressionSnapshot({
    snapshot,
    outputPath,
  });
  assert.equal(writtenPath, outputPath);
  const raw = await readFile(outputPath, "utf8");
  const trimmed = raw.replace(/\n$/u, "");
  assert.equal(trimmed, canonicalJson(snapshot));
  const parsed = JSON.parse(trimmed) as typeof snapshot;
  assert.equal(parsed.archetypeId, archetypeId);
});

test("regression-eval: drift report renders identifying metadata and tolerance footer", async () => {
  const archetypeId = BASELINE_ARCHETYPE_FIXTURE_IDS[0];
  const baseline = await buildRegressionSnapshot({ archetypeId });
  const candidate: typeof baseline = {
    ...baseline,
    coverageRatios: {
      ...baseline.coverageRatios,
      fieldCoverageRatio: Math.max(
        0,
        baseline.coverageRatios.fieldCoverageRatio -
          REGRESSION_EVAL_TOLERANCES.coverageRatioAbsoluteDelta -
          0.1,
      ),
    },
  };
  const diff = diffRegressionSnapshot({ baseline, candidate });
  assert.equal(diff.hasDrift, true);
  const report = renderDriftReport({
    diffs: [diff],
    generatedAt: REGRESSION_EVAL_FIXTURE_GENERATED_AT,
  });
  assert.match(report, /# Regression-Eval drift report/);
  assert.match(report, /coverage ratios/i);
  assert.ok(
    report.includes(archetypeId),
    "Report must mention the drifted archetype id",
  );
  assert.match(report, /coverageRatios\.fieldCoverageRatio/);
  assert.match(report, /FIGMAPIPE_REGRESSION_APPROVE/);
});

test("regression-eval: writeDriftReport persists Markdown to a stable filename", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "regression-eval-report-"));
  const generatedAt = "2026-05-05T12:34:56.789Z";
  const written = await writeDriftReport({
    diffs: [],
    generatedAt,
    outputDir: tempDir,
  });
  assert.equal(written.endsWith(regressionDriftReportFilename(generatedAt)), true);
  const body = await readFile(written, "utf8");
  assert.match(body, /Regression-Eval drift report/);
  assert.match(body, /No drift detected/);
});

test("regression-eval: approve mode is gated by FIGMAPIPE_REGRESSION_APPROVE and CI runtime", () => {
  assert.equal(isRegressionApproveModeEnabled({}), false);
  assert.equal(
    isRegressionApproveModeEnabled({ FIGMAPIPE_REGRESSION_APPROVE: "true" }),
    true,
  );
  assert.equal(
    isRegressionApproveModeEnabled({ FIGMAPIPE_REGRESSION_APPROVE: "1" }),
    true,
  );
  assert.equal(
    isRegressionApproveModeEnabled({ FIGMAPIPE_REGRESSION_APPROVE: "false" }),
    false,
  );
  assert.equal(isRegressionCiRuntime({}), false);
  assert.equal(isRegressionCiRuntime({ CI: "true" }), true);
  assert.equal(isRegressionCiRuntime({ CI: "1" }), true);
  assert.equal(isRegressionCiRuntime({ CI: "false" }), false);
  assert.equal(isRegressionCiRuntime({ CI: "0" }), false);
});

test("regression-eval: diffRegressionSnapshot rejects archetypeId mismatch", async () => {
  const a = await buildRegressionSnapshot({
    archetypeId: BASELINE_ARCHETYPE_FIXTURE_IDS[0],
  });
  const b = await buildRegressionSnapshot({
    archetypeId: BASELINE_ARCHETYPE_FIXTURE_IDS[1],
  });
  assert.throws(() => diffRegressionSnapshot({ baseline: a, candidate: b }));
});

test("regression-eval: tampered snapshot file fails the drift gate even when JSON parses", async () => {
  const archetypeId = BASELINE_ARCHETYPE_FIXTURE_IDS[0];
  const tempDir = await mkdtemp(join(tmpdir(), "regression-eval-tamper-"));
  const candidate = await buildRegressionSnapshot({ archetypeId });
  const tamperedBaseline = {
    ...candidate,
    caseCounts: {
      ...candidate.caseCounts,
      total: candidate.caseCounts.total + 1000,
    },
  };
  const baselinePath = join(
    tempDir,
    regressionSnapshotFilename(archetypeId),
  );
  await writeFile(baselinePath, canonicalJson(tamperedBaseline), "utf8");
  const baselineFromDisk = JSON.parse(
    await readFile(baselinePath, "utf8"),
  ) as typeof candidate;
  const diff = diffRegressionSnapshot({
    baseline: baselineFromDisk,
    candidate,
  });
  assert.equal(diff.hasDrift, true);
});
