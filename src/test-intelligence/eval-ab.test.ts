import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson } from "./content-hash.js";
import {
  buildAllEvalAbArtifacts,
  buildEvalAbArtifact,
  EVAL_AB_FIXTURE_GENERATED_AT,
  evalAbFixtureFilename,
  readEvalAbArtifact,
  resolveEvalAbWinningPipeline,
  writeEvalAbArtifact,
} from "./eval-ab.js";
import { BASELINE_ARCHETYPE_FIXTURE_IDS } from "./baseline-fixtures.js";

test("eval-ab: registers a canonical eval-ab file for each archetype", () => {
  assert.equal(BASELINE_ARCHETYPE_FIXTURE_IDS.length, 7);
  assert.deepEqual(
    BASELINE_ARCHETYPE_FIXTURE_IDS.map((archetypeId) =>
      evalAbFixtureFilename(archetypeId),
    ),
    [
      "eval-ab-simple-form.json",
      "eval-ab-calculation.json",
      "eval-ab-optional-fields.json",
      "eval-ab-multi-context.json",
      "eval-ab-ambiguous-rules.json",
      "eval-ab-complex-mask.json",
      "eval-ab-validation-heavy.json",
    ],
  );
});

test("eval-ab: checked-in artifacts match the deterministic builder", async () => {
  for (const archetypeId of BASELINE_ARCHETYPE_FIXTURE_IDS) {
    const built = await buildEvalAbArtifact({
      archetypeId,
      generatedAt: EVAL_AB_FIXTURE_GENERATED_AT,
    });
    const persisted = await readEvalAbArtifact(archetypeId);
    assert.deepEqual(persisted, built, archetypeId);
  }
});

test("eval-ab: every checked-in artifact is canonical JSON", async () => {
  for (const archetypeId of BASELINE_ARCHETYPE_FIXTURE_IDS) {
    const artifact = await readEvalAbArtifact(archetypeId);
    const filePath = join(
      new URL(".", import.meta.url).pathname,
      "fixtures",
      evalAbFixtureFilename(archetypeId),
    );
    const raw = await readFile(filePath, "utf8");
    assert.equal(raw, canonicalJson(artifact));
  }
});

test("eval-ab: harness wins on required metrics for every archetype", async () => {
  const artifacts = await buildAllEvalAbArtifacts({
    generatedAt: EVAL_AB_FIXTURE_GENERATED_AT,
  });
  assert.equal(artifacts.length, 7);
  for (const artifact of artifacts) {
    const harness = artifact.pipelines.find(
      (pipeline) => pipeline.pipelineId === "multi_agent_harness",
    );
    const singlePass = artifact.pipelines.find(
      (pipeline) => pipeline.pipelineId === "single_pass",
    );
    assert.ok(harness);
    assert.ok(singlePass);
    if (harness === undefined || singlePass === undefined) continue;

    assert.equal(artifact.summary.winningPipeline, "multi_agent_harness");
    assert.equal(artifact.summary.winsOnRequiredMetrics, true);
    assert.ok(harness.metrics.coverageDelta.deltaVsSinglePass > 0);
    assert.ok(harness.metrics.duplicateRateDelta.deltaVsSinglePass < 0);
    assert.ok(
      harness.metrics.genericExpectedResultDelta.deltaVsSinglePass < 0,
    );
    assert.ok(harness.metrics.finOpsSpendDelta.deltaVsSinglePass < 0);
    assert.ok(
      harness.humanCalibration.overallMeanAbsoluteError <
        singlePass.humanCalibration.overallMeanAbsoluteError,
    );
  }
});

test("eval-ab: write helper is byte-stable on the second write", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "eval-ab-"));
  const artifact = await buildEvalAbArtifact({
    archetypeId: "baseline-simple-form",
    generatedAt: EVAL_AB_FIXTURE_GENERATED_AT,
  });
  const outputPath = join(tempDir, "eval-ab-simple-form.json");
  await writeEvalAbArtifact({ artifact, outputPath });
  const first = await readFile(outputPath, "utf8");
  await writeEvalAbArtifact({ artifact, outputPath });
  const second = await readFile(outputPath, "utf8");
  assert.equal(first, second);
});

test("eval-ab: winner resolution can report a single-pass win", async () => {
  const artifact = await buildEvalAbArtifact({
    archetypeId: "baseline-simple-form",
    generatedAt: EVAL_AB_FIXTURE_GENERATED_AT,
  });
  const harness = artifact.pipelines.find(
    (pipeline) => pipeline.pipelineId === "multi_agent_harness",
  );
  const singlePass = artifact.pipelines.find(
    (pipeline) => pipeline.pipelineId === "single_pass",
  );
  assert.ok(harness);
  assert.ok(singlePass);
  if (harness === undefined || singlePass === undefined) return;

  const winner = resolveEvalAbWinningPipeline({
    multiAgentHarness: {
      ...harness,
      metrics: {
        coverageDelta: { value: 8, deltaVsSinglePass: -2 },
        duplicateRateDelta: { value: 0.22, deltaVsSinglePass: 0.05 },
        genericExpectedResultDelta: { value: 0.61, deltaVsSinglePass: 0.1 },
        finOpsSpendDelta: { value: 17, deltaVsSinglePass: 4 },
      },
    },
    singlePass,
    humanCalibrationErrorDelta: 0.15,
  });

  assert.equal(winner, "single_pass");
});
