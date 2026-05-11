import { writeFile } from "node:fs/promises";

import {
  BASELINE_EVAL_FIXTURE_GENERATED_AT,
  baselineEvalFixturePath,
  buildBaselineArchetypeEvalArtifact,
} from "../src/test-intelligence/baseline-eval.js";
import { BASELINE_ARCHETYPE_FIXTURE_IDS } from "../src/test-intelligence/baseline-fixtures.js";
import { canonicalJson } from "../src/test-intelligence/content-hash.js";

for (const archetypeId of BASELINE_ARCHETYPE_FIXTURE_IDS) {
  const artifact = await buildBaselineArchetypeEvalArtifact({
    archetypeId,
    generatedAt: BASELINE_EVAL_FIXTURE_GENERATED_AT,
  });
  await writeFile(baselineEvalFixturePath(archetypeId), canonicalJson(artifact));
  console.log(`updated ${archetypeId}`);
}
