import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson } from "./content-hash.js";
import {
  BASELINE_EVAL_FIXTURE_GENERATED_AT,
  baselineEvalFixtureFilename,
  buildAllBaselineArchetypeEvalArtifacts,
  buildBaselineArchetypeEvalArtifact,
  diffBaselineArchetypeEvalArtifact,
  readBaselineArchetypeEvalArtifact,
  writeBaselineArchetypeEvalArtifact,
} from "./baseline-eval.js";
import { BASELINE_ARCHETYPE_FIXTURE_IDS } from "./baseline-fixtures.js";

test("baseline-eval: registers a canonical eval-baseline file for each archetype", async () => {
  assert.equal(BASELINE_ARCHETYPE_FIXTURE_IDS.length, 7);
  const filenames = BASELINE_ARCHETYPE_FIXTURE_IDS.map((archetypeId) =>
    baselineEvalFixtureFilename(archetypeId),
  );
  assert.deepEqual(filenames, [
    "eval-baseline-simple-form.json",
    "eval-baseline-calculation.json",
    "eval-baseline-optional-fields.json",
    "eval-baseline-multi-context.json",
    "eval-baseline-ambiguous-rules.json",
    "eval-baseline-complex-mask.json",
    "eval-baseline-validation-heavy.json",
  ]);
});

test("baseline-eval: checked-in eval baselines match the deterministic builder", async () => {
  for (const archetypeId of BASELINE_ARCHETYPE_FIXTURE_IDS) {
    const built = await buildBaselineArchetypeEvalArtifact({
      archetypeId,
      generatedAt: BASELINE_EVAL_FIXTURE_GENERATED_AT,
    });
    const persisted = await readBaselineArchetypeEvalArtifact(archetypeId);
    assert.deepEqual(persisted, built, archetypeId);
  }
});

test("baseline-eval: every checked-in artifact is canonical JSON", async () => {
  for (const archetypeId of BASELINE_ARCHETYPE_FIXTURE_IDS) {
    const artifact = await readBaselineArchetypeEvalArtifact(archetypeId);
    const filePath = join(
      new URL(".", import.meta.url).pathname,
      "fixtures",
      baselineEvalFixtureFilename(archetypeId),
    );
    const raw = await readFile(filePath, "utf8");
    assert.equal(raw, canonicalJson(artifact));
  }
});

test("baseline-eval: write helper is byte-stable on the second write", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "baseline-eval-"));
  const artifact = await buildBaselineArchetypeEvalArtifact({
    archetypeId: "baseline-simple-form",
    generatedAt: BASELINE_EVAL_FIXTURE_GENERATED_AT,
  });
  const outputPath = join(tempDir, "eval-baseline-simple-form.json");
  await writeBaselineArchetypeEvalArtifact({ artifact, outputPath });
  const first = await readFile(outputPath, "utf8");
  await writeBaselineArchetypeEvalArtifact({ artifact, outputPath });
  const second = await readFile(outputPath, "utf8");
  assert.equal(first, second);
});

test("baseline-eval: persisted metric surface stays fully populated", async () => {
  const artifacts = await buildAllBaselineArchetypeEvalArtifacts({
    generatedAt: BASELINE_EVAL_FIXTURE_GENERATED_AT,
  });
  assert.equal(artifacts.length, 7);
  for (const artifact of artifacts) {
    assert.equal(artifact.generatedAt, BASELINE_EVAL_FIXTURE_GENERATED_AT);
    assert.ok(artifact.intent.length > 0);
    assert.ok(artifact.archetype.length > 0);
    assert.ok(artifact.metrics.traceabilityCoverage.totalCases > 0);
    assert.equal(artifact.metrics.tokensIn > 0, true);
    assert.equal(artifact.metrics.tokensOut > 0, true);
    assert.equal(
      artifact.metrics.humanAcceptanceRateSnapshot.sampleSize > 0,
      true,
    );
  }
});

test("baseline-eval: diff against an identical artifact reports zero deltas", async () => {
  const artifact = await readBaselineArchetypeEvalArtifact(
    "baseline-simple-form",
  );
  const diff = diffBaselineArchetypeEvalArtifact({
    baseline: artifact,
    candidate: artifact,
  });
  assert.equal(diff.archetypeId, "baseline-simple-form");
  assert.equal(diff.schemaVersionMatch, true);
  assert.equal(diff.contractVersionMatch, true);
  assert.equal(diff.intentMatch, true);
  assert.equal(diff.archetypeMatch, true);
  assert.deepEqual(diff.traceability, {
    addedTestCaseIds: [],
    removedTestCaseIds: [],
    changedTestCaseIds: [],
  });
  for (const key of Object.keys(diff.metrics) as Array<
    keyof typeof diff.metrics
  >) {
    assert.equal(diff.metrics[key].delta, 0, key);
    assert.equal(diff.metrics[key].baseline, diff.metrics[key].candidate, key);
  }
});

test("baseline-eval: diff surfaces scalar-metric, traceability, and contract drift", async () => {
  const baseline = await readBaselineArchetypeEvalArtifact(
    "baseline-simple-form",
  );
  const candidate = JSON.parse(JSON.stringify(baseline)) as typeof baseline;
  candidate.generatedAt = "2026-06-01T00:00:00.000Z";
  candidate.schemaVersion = "9.9.9" as typeof candidate.schemaVersion;
  candidate.intent = `${baseline.intent} (revised)`;
  candidate.metrics.coveragePositiveCount =
    baseline.metrics.coveragePositiveCount + 4;
  candidate.metrics.coverageNegativeCount =
    baseline.metrics.coverageNegativeCount - 1;
  candidate.metrics.duplicateRate = baseline.metrics.duplicateRate + 0.125;
  candidate.metrics.finOpsSpendMinorUnits =
    baseline.metrics.finOpsSpendMinorUnits + 250;
  candidate.metrics.latencyMs = baseline.metrics.latencyMs + 35;
  candidate.metrics.humanAcceptanceRateSnapshot = {
    ...baseline.metrics.humanAcceptanceRateSnapshot,
    approvedCount:
      baseline.metrics.humanAcceptanceRateSnapshot.approvedCount + 1,
    rate: 1,
  };
  candidate.metrics.traceabilityCoverage = {
    ...baseline.metrics.traceabilityCoverage,
    totalCases: baseline.metrics.traceabilityCoverage.totalCases + 1,
    sourceRefPresenceRate: 0.5,
    perCase: [
      ...baseline.metrics.traceabilityCoverage.perCase
        .slice(1)
        .map((row) => ({ ...row, sourceRefCount: row.sourceRefCount + 1 })),
      {
        testCaseId: "tc-new-from-candidate",
        sourceRefCount: 2,
        intentRefCount: 1,
        visualRefCount: 0,
      },
    ],
  };

  const diff = diffBaselineArchetypeEvalArtifact({ baseline, candidate });

  assert.equal(diff.schemaVersionMatch, false);
  assert.equal(diff.contractVersionMatch, true);
  assert.equal(diff.intentMatch, false);
  assert.equal(diff.archetypeMatch, true);
  assert.equal(diff.baselineGeneratedAt, baseline.generatedAt);
  assert.equal(diff.candidateGeneratedAt, candidate.generatedAt);
  assert.equal(diff.metrics.coveragePositiveCount.delta, 4);
  assert.equal(diff.metrics.coverageNegativeCount.delta, -1);
  assert.equal(diff.metrics.duplicateRate.delta, 0.125);
  assert.equal(diff.metrics.finOpsSpendMinorUnits.delta, 250);
  assert.equal(diff.metrics.latencyMs.delta, 35);
  assert.equal(diff.metrics.humanAcceptanceApprovedCount.delta, 1);
  assert.equal(diff.metrics.traceabilityTotalCases.delta, 1);
  assert.deepEqual(diff.traceability.addedTestCaseIds.sort(), [
    "tc-new-from-candidate",
  ]);
  assert.deepEqual(diff.traceability.removedTestCaseIds.sort(), [
    baseline.metrics.traceabilityCoverage.perCase[0]!.testCaseId,
  ]);
  assert.equal(diff.traceability.changedTestCaseIds.length > 0, true);
});

test("baseline-eval: diff throws when archetype ids do not match", async () => {
  const baseline = await readBaselineArchetypeEvalArtifact(
    "baseline-simple-form",
  );
  const candidate = await readBaselineArchetypeEvalArtifact(
    "baseline-calculation",
  );
  assert.throws(
    () =>
      diffBaselineArchetypeEvalArtifact({
        baseline,
        candidate,
      }),
    /archetypeId mismatch/u,
  );
});
