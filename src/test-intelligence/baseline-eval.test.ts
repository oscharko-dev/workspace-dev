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
