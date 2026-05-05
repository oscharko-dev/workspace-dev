import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
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
} from "../contracts/index.js";
import {
  BASELINE_ARCHETYPE_FIXTURE_IDS,
  loadBaselineArchetypeFixture,
} from "./baseline-fixtures.js";
import { canonicalJson } from "./content-hash.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import { synthesizeGeneratedTestCases } from "./validation-harness.js";

const buildTestAuditMetadata = (
  jobId: string,
): GeneratedTestCaseAuditMetadata => ({
  jobId,
  generatedAt: FAITHFULNESS_EVAL_FIXTURE_GENERATED_AT,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  redactionPolicyVersion: REDACTION_POLICY_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  cacheHit: false,
  cacheKey: "faithfulness-eval-test-cache-key",
  inputHash: "faithfulness-eval-test-input-hash",
  promptHash: "faithfulness-eval-test-prompt-hash",
  schemaHash: "faithfulness-eval-test-schema-hash",
});
import {
  FAITHFULNESS_EVAL_FIXTURE_GENERATED_AT,
  FAITHFULNESS_EVAL_PROFILE_ID,
  FAITHFULNESS_EVAL_REPORT_DIRNAME,
  FAITHFULNESS_EVAL_SCHEMA_VERSION,
  FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS,
  buildAllFaithfulnessEvalArtifacts,
  buildFaithfulnessEvalArtifact,
  computeFaithfulnessMetrics,
  degradeListForNoRepair,
  evaluateFaithfulnessVerdict,
  faithfulnessEvalReportFilename,
  injectHallucinatedTestCase,
  writeFaithfulnessEvalArtifact,
} from "./faithfulness-eval.js";

test("faithfulness-eval: thresholds are exported as a frozen production-baseline profile", () => {
  assert.equal(
    Object.isFrozen(FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS),
    true,
  );
  assert.equal(FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS.fieldCoverageRatio, 0.4);
  assert.equal(FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS.actionCoverageRatio, 0.5);
  assert.equal(FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS.traceFidelityScore, 0.95);
  assert.equal(FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS.hallucinatedIdRate, 0.0);
  assert.equal(FAITHFULNESS_EVAL_PROFILE_ID, "production-baseline");
  assert.equal(FAITHFULNESS_EVAL_SCHEMA_VERSION, "1.0.0");
});

test("faithfulness-eval: ships ≥ 5 fixture variants spanning forms, validations, and navigation", () => {
  assert.ok(
    BASELINE_ARCHETYPE_FIXTURE_IDS.length >= 5,
    `expected ≥5 baseline fixtures, got ${BASELINE_ARCHETYPE_FIXTURE_IDS.length}`,
  );
});

test("faithfulness-eval: every baseline archetype passes the production-baseline gate in repair mode", async () => {
  const artifacts = await buildAllFaithfulnessEvalArtifacts({
    mode: "with-repair",
  });
  assert.equal(artifacts.length, BASELINE_ARCHETYPE_FIXTURE_IDS.length);
  for (const artifact of artifacts) {
    assert.equal(artifact.mode, "with-repair");
    assert.equal(
      artifact.verdict.passed,
      true,
      `${artifact.archetypeId} unexpectedly failed: ${JSON.stringify(artifact.verdict.failures)}`,
    );
    assert.deepEqual(artifact.verdict.failures, []);
    assert.ok(
      artifact.metrics.fieldCoverageRatio >=
        FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS.fieldCoverageRatio,
    );
    assert.ok(
      artifact.metrics.actionCoverageRatio >=
        FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS.actionCoverageRatio,
    );
    assert.ok(
      artifact.metrics.traceFidelityScore >=
        FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS.traceFidelityScore,
    );
    assert.equal(artifact.metrics.hallucinatedIdRate, 0);
    assert.equal(
      artifact.metrics.totals.figmaTraceRefsWithNodeId,
      artifact.metrics.totals.figmaTraceRefCount,
    );
  }
});

test("faithfulness-eval: every baseline archetype fails the gate when forced into single-pass / no-repair mode", async () => {
  const artifacts = await buildAllFaithfulnessEvalArtifacts({
    mode: "no-repair",
  });
  for (const artifact of artifacts) {
    assert.equal(artifact.mode, "no-repair");
    assert.equal(
      artifact.verdict.passed,
      false,
      `${artifact.archetypeId} unexpectedly passed without repair`,
    );
    assert.ok(
      artifact.verdict.failures.length > 0,
      `${artifact.archetypeId} produced no failure reasons`,
    );
    const reasons = new Set(
      artifact.verdict.failures.map((failure) => failure.reason),
    );
    assert.ok(
      reasons.has("trace_fidelity_below_threshold"),
      `${artifact.archetypeId} should fail trace fidelity in no-repair mode`,
    );
  }
});

test("faithfulness-eval: hallucinated citations trigger the hallucinatedIdRate gate", async () => {
  const fixture = await loadBaselineArchetypeFixture("baseline-simple-form");
  const intent = deriveBusinessTestIntentIr({ figma: fixture.figma });
  const jobId = "faithfulness-eval-hallucination-test";
  const synthesised = synthesizeGeneratedTestCases({
    jobId,
    generatedAt: FAITHFULNESS_EVAL_FIXTURE_GENERATED_AT,
    intent,
    audit: buildTestAuditMetadata(jobId),
  });
  const polluted = injectHallucinatedTestCase({ list: synthesised });
  const knownFigmaNodeIds = fixture.figma.screens.flatMap((screen) =>
    screen.nodes.map((node) => node.nodeId),
  );
  const knownScreenIds = fixture.figma.screens.map((screen) => screen.screenId);
  const metrics = computeFaithfulnessMetrics({
    intent,
    generatedList: polluted,
    knownFigmaNodeIds,
    knownScreenIds,
  });
  assert.ok(
    metrics.hallucinatedIdRate > 0,
    `expected hallucinatedIdRate > 0, got ${metrics.hallucinatedIdRate}`,
  );
  assert.ok(metrics.totals.hallucinatedIdCount >= 1);
  const verdict = evaluateFaithfulnessVerdict(metrics);
  assert.equal(verdict.passed, false);
  const reasons = verdict.failures.map((failure) => failure.reason);
  assert.ok(reasons.includes("hallucinated_id_above_threshold"));
});

test("faithfulness-eval: degradeListForNoRepair strips trace nodeIds and trims coverage", async () => {
  const fixture = await loadBaselineArchetypeFixture("baseline-simple-form");
  const intent = deriveBusinessTestIntentIr({ figma: fixture.figma });
  const jobId = "faithfulness-eval-degrade-test";
  const synthesised = synthesizeGeneratedTestCases({
    jobId,
    generatedAt: FAITHFULNESS_EVAL_FIXTURE_GENERATED_AT,
    intent,
    audit: buildTestAuditMetadata(jobId),
  });
  const degraded = degradeListForNoRepair(synthesised);
  assert.ok(synthesised.testCases.length > degraded.testCases.length);
  for (const testCase of degraded.testCases) {
    for (const traceRef of testCase.figmaTraceRefs) {
      assert.equal(traceRef.nodeId, undefined);
    }
    assert.equal(testCase.qualitySignals.coveredActionIds.length, 0);
    assert.equal(testCase.qualitySignals.coveredValidationIds.length, 0);
    assert.equal(testCase.qualitySignals.coveredNavigationIds.length, 0);
  }
});

test("faithfulness-eval: artifact build is deterministic — same inputs produce byte-identical canonical JSON", async () => {
  for (const archetypeId of BASELINE_ARCHETYPE_FIXTURE_IDS) {
    const a = await buildFaithfulnessEvalArtifact({
      archetypeId,
      mode: "with-repair",
    });
    const b = await buildFaithfulnessEvalArtifact({
      archetypeId,
      mode: "with-repair",
    });
    assert.equal(canonicalJson(a), canonicalJson(b), archetypeId);
  }
});

test("faithfulness-eval: persists per-fixture report under the canonical eval-reports dir layout", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "faithfulness-eval-"));
  const archetypeId = "baseline-simple-form" as const;
  const artifact = await buildFaithfulnessEvalArtifact({
    archetypeId,
    mode: "with-repair",
  });
  const outputPath = await writeFaithfulnessEvalArtifact({
    artifact,
    outputDir: tempDir,
  });
  assert.equal(
    outputPath,
    join(tempDir, faithfulnessEvalReportFilename(archetypeId)),
  );
  const persisted = JSON.parse(await readFile(outputPath, "utf8"));
  assert.deepEqual(persisted, artifact);
  // Default dir layout is documented for the production runner.
  assert.equal(
    FAITHFULNESS_EVAL_REPORT_DIRNAME,
    "storybook-static/eval-reports",
  );
  assert.equal(
    faithfulnessEvalReportFilename(archetypeId),
    "faithfulness-simple-form.json",
  );
});

test("faithfulness-eval: empty IR slots produce a 1.0 ratio (no false negatives)", () => {
  const intent = {
    version: "1.0.0",
    source: { kind: "figma_local_json", contentHash: "x" },
    screens: [],
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
  } as unknown as Parameters<
    typeof computeFaithfulnessMetrics
  >[0]["intent"];
  const generatedList = {
    schemaVersion: "1.0.0",
    jobId: "empty",
    testCases: [],
  } as unknown as Parameters<
    typeof computeFaithfulnessMetrics
  >[0]["generatedList"];
  const metrics = computeFaithfulnessMetrics({
    intent,
    generatedList,
    knownFigmaNodeIds: [],
    knownScreenIds: [],
  });
  assert.equal(metrics.fieldCoverageRatio, 1);
  assert.equal(metrics.actionCoverageRatio, 1);
  assert.equal(metrics.validationCoverageRatio, 1);
  assert.equal(metrics.navigationCoverageRatio, 1);
  assert.equal(metrics.traceFidelityScore, 1);
  assert.equal(metrics.hallucinatedIdRate, 0);
  const verdict = evaluateFaithfulnessVerdict(metrics);
  assert.equal(verdict.passed, true);
});
