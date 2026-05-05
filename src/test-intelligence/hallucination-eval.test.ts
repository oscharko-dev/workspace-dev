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
import {
  DOCUMENTED_HALLUCINATION_PATTERNS,
  HALLUCINATION_EVAL_FIXTURE_GENERATED_AT,
  HALLUCINATION_EVAL_PROFILE_ID,
  HALLUCINATION_EVAL_REPORT_DIRNAME,
  HALLUCINATION_EVAL_SCHEMA_VERSION,
  HALLUCINATION_PRODUCTION_BASELINE_THRESHOLDS,
  buildAllHallucinationEvalArtifacts,
  buildHallucinationEvalArtifact,
  computeHallucinationMetrics,
  evaluateHallucinationVerdict,
  hallucinationEvalReportFilename,
  injectInventedActionStep,
  injectInventedButtonStateStep,
  injectInventedFieldStep,
  injectInventedScreenStep,
  injectInventedTraceNodeId,
  injectInventedValidationCitation,
  writeHallucinationEvalArtifact,
  type HallucinationPattern,
} from "./hallucination-eval.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import { synthesizeGeneratedTestCases } from "./validation-harness.js";

const buildTestAuditMetadata = (
  jobId: string,
): GeneratedTestCaseAuditMetadata => ({
  jobId,
  generatedAt: HALLUCINATION_EVAL_FIXTURE_GENERATED_AT,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  redactionPolicyVersion: REDACTION_POLICY_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  cacheHit: false,
  cacheKey: "hallucination-eval-test-cache-key",
  inputHash: "hallucination-eval-test-input-hash",
  promptHash: "hallucination-eval-test-prompt-hash",
  schemaHash: "hallucination-eval-test-schema-hash",
});

const synthesizeForFixture = async (
  archetypeId: (typeof BASELINE_ARCHETYPE_FIXTURE_IDS)[number],
  jobId: string,
) => {
  const fixture = await loadBaselineArchetypeFixture(archetypeId);
  const intent = deriveBusinessTestIntentIr({ figma: fixture.figma });
  const generatedList = synthesizeGeneratedTestCases({
    jobId,
    generatedAt: HALLUCINATION_EVAL_FIXTURE_GENERATED_AT,
    intent,
    audit: buildTestAuditMetadata(jobId),
  });
  const knownFigmaNodeIds = fixture.figma.screens.flatMap((screen) =>
    screen.nodes.map((node) => node.nodeId),
  );
  const knownScreenIds = fixture.figma.screens.map((screen) => screen.screenId);
  return { fixture, intent, generatedList, knownFigmaNodeIds, knownScreenIds };
};

test("hallucination-eval: thresholds are exported as a frozen production-baseline profile", () => {
  assert.equal(
    Object.isFrozen(HALLUCINATION_PRODUCTION_BASELINE_THRESHOLDS),
    true,
  );
  assert.equal(
    HALLUCINATION_PRODUCTION_BASELINE_THRESHOLDS.hallucinatedActionRate,
    0.0,
  );
  assert.equal(
    HALLUCINATION_PRODUCTION_BASELINE_THRESHOLDS.hallucinatedFieldRate,
    0.05,
  );
  assert.equal(HALLUCINATION_EVAL_PROFILE_ID, "production-baseline");
  assert.equal(HALLUCINATION_EVAL_SCHEMA_VERSION, "1.0.0");
});

test("hallucination-eval: documents at least 6 hallucination patterns covering button, validation, field, screen, trace-id, button-state", () => {
  assert.ok(
    DOCUMENTED_HALLUCINATION_PATTERNS.length >= 6,
    `expected ≥6 documented patterns, got ${DOCUMENTED_HALLUCINATION_PATTERNS.length}`,
  );
  const patternIds = new Set<HallucinationPattern>(
    DOCUMENTED_HALLUCINATION_PATTERNS.map((entry) => entry.pattern),
  );
  for (const required of [
    "invented_action",
    "invented_validation",
    "invented_field",
    "invented_screen",
    "invented_trace_node_id",
    "invented_button_state",
  ] as const) {
    assert.ok(
      patternIds.has(required),
      `documented patterns missing required pattern ${required}`,
    );
  }
});

test("hallucination-eval: every baseline archetype passes the production-baseline gate with the deterministic synthesiser", async () => {
  const artifacts = await buildAllHallucinationEvalArtifacts({
    mode: "faithful",
  });
  assert.equal(artifacts.length, BASELINE_ARCHETYPE_FIXTURE_IDS.length);
  for (const artifact of artifacts) {
    assert.equal(artifact.mode, "faithful");
    assert.equal(
      artifact.verdict.passed,
      true,
      `${artifact.archetypeId} unexpectedly failed: ${JSON.stringify(artifact.verdict.failures)} findings=${JSON.stringify(artifact.findings)}`,
    );
    assert.deepEqual(artifact.verdict.failures, []);
    assert.equal(
      artifact.metrics.hallucinatedActionRate,
      0,
      `${artifact.archetypeId} action rate must be 0`,
    );
    assert.equal(
      artifact.metrics.totals.hallucinatedActionReferenceCount,
      0,
      `${artifact.archetypeId} action hallucinations must be 0`,
    );
    assert.equal(
      artifact.metrics.totals.hallucinatedFieldReferenceCount,
      0,
      `${artifact.archetypeId} field hallucinations must be 0`,
    );
    assert.equal(
      artifact.metrics.totals.hallucinatedScreenReferenceCount,
      0,
      `${artifact.archetypeId} screen hallucinations must be 0`,
    );
    assert.equal(
      artifact.metrics.totals.hallucinatedTraceNodeIdReferenceCount,
      0,
      `${artifact.archetypeId} trace-nodeId hallucinations must be 0`,
    );
    assert.equal(
      artifact.metrics.totals.hallucinatedValidationCitationCount,
      0,
      `${artifact.archetypeId} validation hallucinations must be 0`,
    );
    assert.equal(
      artifact.metrics.totals.errorFindingCount,
      0,
      `${artifact.archetypeId} should produce 0 error findings`,
    );
  }
});

test("hallucination-eval: adversarial sub-suite — prompt-injection on the IR input does not raise the hallucination rate", async () => {
  const artifacts = await buildAllHallucinationEvalArtifacts({
    mode: "adversarial-prompt-injection",
  });
  assert.equal(artifacts.length, BASELINE_ARCHETYPE_FIXTURE_IDS.length);
  for (const artifact of artifacts) {
    assert.equal(artifact.mode, "adversarial-prompt-injection");
    assert.equal(
      artifact.metrics.hallucinatedActionRate,
      0,
      `${artifact.archetypeId} adversarial action rate must stay at 0`,
    );
    assert.equal(
      artifact.metrics.hallucinatedFieldRate,
      0,
      `${artifact.archetypeId} adversarial field rate must stay at 0`,
    );
    assert.equal(
      artifact.verdict.passed,
      true,
      `${artifact.archetypeId} adversarial verdict must pass: ${JSON.stringify(artifact.verdict.failures)}`,
    );
  }
});

test("hallucination-eval: invented action label triggers the action-rate hard gate", async () => {
  const ctx = await synthesizeForFixture(
    "baseline-simple-form",
    "hallucination-eval-invented-action",
  );
  const polluted = injectInventedActionStep({
    list: ctx.generatedList,
    inventedActionLabel: "Phantom Submit",
  });
  const { metrics, findings } = computeHallucinationMetrics({
    intent: ctx.intent,
    generatedList: polluted,
    knownFigmaNodeIds: ctx.knownFigmaNodeIds,
    knownScreenIds: ctx.knownScreenIds,
  });
  assert.ok(
    metrics.hallucinatedActionRate > 0,
    `expected hallucinatedActionRate > 0, got ${metrics.hallucinatedActionRate}`,
  );
  assert.ok(metrics.totals.hallucinatedActionReferenceCount >= 1);
  assert.ok(
    findings.some(
      (f) => f.pattern === "invented_action" && f.severity === "error",
    ),
  );
  const verdict = evaluateHallucinationVerdict(metrics);
  assert.equal(verdict.passed, false);
  assert.ok(
    verdict.failures.some(
      (f) => f.reason === "hallucinated_action_rate_above_threshold",
    ),
  );
});

test("hallucination-eval: invented field label trips the field-rate hard gate when above tolerance", async () => {
  const ctx = await synthesizeForFixture(
    "baseline-simple-form",
    "hallucination-eval-invented-field",
  );
  // Inject several invented field references to push the rate above
  // the 5 % tolerance band.
  let polluted = ctx.generatedList;
  for (let i = 0; i < 6; i += 1) {
    polluted = injectInventedFieldStep({
      list: polluted,
      inventedFieldLabel: `Phantom Field ${i}`,
    });
  }
  const { metrics, findings } = computeHallucinationMetrics({
    intent: ctx.intent,
    generatedList: polluted,
    knownFigmaNodeIds: ctx.knownFigmaNodeIds,
    knownScreenIds: ctx.knownScreenIds,
  });
  assert.ok(
    metrics.hallucinatedFieldRate >
      HALLUCINATION_PRODUCTION_BASELINE_THRESHOLDS.hallucinatedFieldRate,
    `expected hallucinatedFieldRate > 0.05, got ${metrics.hallucinatedFieldRate}`,
  );
  assert.ok(
    findings.some(
      (f) => f.pattern === "invented_field" && f.severity === "error",
    ),
  );
  const verdict = evaluateHallucinationVerdict(metrics);
  assert.equal(verdict.passed, false);
  assert.ok(
    verdict.failures.some(
      (f) => f.reason === "hallucinated_field_rate_above_threshold",
    ),
  );
});

test("hallucination-eval: invented validation citation is detected as an error finding", async () => {
  const ctx = await synthesizeForFixture(
    "baseline-simple-form",
    "hallucination-eval-invented-validation",
  );
  const polluted = injectInventedValidationCitation({
    list: ctx.generatedList,
    inventedValidationId: "v-phantom-rule",
  });
  const { metrics, findings } = computeHallucinationMetrics({
    intent: ctx.intent,
    generatedList: polluted,
    knownFigmaNodeIds: ctx.knownFigmaNodeIds,
    knownScreenIds: ctx.knownScreenIds,
  });
  assert.ok(metrics.totals.hallucinatedValidationCitationCount >= 1);
  assert.ok(
    findings.some(
      (f) =>
        f.pattern === "invented_validation" &&
        f.severity === "error" &&
        f.reference === "v-phantom-rule",
    ),
  );
});

test("hallucination-eval: invented screen reference is detected as an error finding", async () => {
  const ctx = await synthesizeForFixture(
    "baseline-simple-form",
    "hallucination-eval-invented-screen",
  );
  const polluted = injectInventedScreenStep({
    list: ctx.generatedList,
    inventedScreenName: "Phantom Dashboard",
  });
  const { metrics, findings } = computeHallucinationMetrics({
    intent: ctx.intent,
    generatedList: polluted,
    knownFigmaNodeIds: ctx.knownFigmaNodeIds,
    knownScreenIds: ctx.knownScreenIds,
  });
  assert.ok(metrics.totals.hallucinatedScreenReferenceCount >= 1);
  assert.ok(
    findings.some(
      (f) => f.pattern === "invented_screen" && f.severity === "error",
    ),
  );
});

test("hallucination-eval: invented trace nodeId is detected as an error finding", async () => {
  const ctx = await synthesizeForFixture(
    "baseline-simple-form",
    "hallucination-eval-invented-trace",
  );
  const polluted = injectInventedTraceNodeId({
    list: ctx.generatedList,
    inventedNodeId: "n-phantom-9999",
  });
  const { metrics, findings } = computeHallucinationMetrics({
    intent: ctx.intent,
    generatedList: polluted,
    knownFigmaNodeIds: ctx.knownFigmaNodeIds,
    knownScreenIds: ctx.knownScreenIds,
  });
  assert.ok(metrics.totals.hallucinatedTraceNodeIdReferenceCount >= 1);
  assert.ok(
    findings.some(
      (f) =>
        f.pattern === "invented_trace_node_id" &&
        f.severity === "error" &&
        f.reference === "n-phantom-9999",
    ),
  );
});

test("hallucination-eval: invented button state is surfaced as a warning, not an error", async () => {
  const ctx = await synthesizeForFixture(
    "baseline-simple-form",
    "hallucination-eval-button-state",
  );
  const polluted = injectInventedButtonStateStep({
    list: ctx.generatedList,
    buttonLabel: "Subscribe",
    buttonState: "disabled",
  });
  const { metrics, findings } = computeHallucinationMetrics({
    intent: ctx.intent,
    generatedList: polluted,
    knownFigmaNodeIds: ctx.knownFigmaNodeIds,
    knownScreenIds: ctx.knownScreenIds,
  });
  assert.ok(metrics.totals.buttonStateWarningCount >= 1);
  assert.ok(
    findings.some(
      (f) => f.pattern === "invented_button_state" && f.severity === "warning",
    ),
  );
  // Warnings must not trip the hard gate.
  const verdict = evaluateHallucinationVerdict(metrics);
  assert.equal(verdict.passed, true);
});

test("hallucination-eval: fuzzy tolerance accepts 1-character typos in field labels", async () => {
  const ctx = await synthesizeForFixture(
    "baseline-simple-form",
    "hallucination-eval-fuzzy",
  );
  const baseField =
    ctx.intent.detectedFields[0]?.label ?? "Email";
  // One-character delete: "Emai" vs "Email" → Levenshtein distance 1
  const typo = baseField.slice(0, -1);
  const polluted = injectInventedFieldStep({
    list: ctx.generatedList,
    inventedFieldLabel: typo,
  });
  const { metrics } = computeHallucinationMetrics({
    intent: ctx.intent,
    generatedList: polluted,
    knownFigmaNodeIds: ctx.knownFigmaNodeIds,
    knownScreenIds: ctx.knownScreenIds,
  });
  assert.equal(
    metrics.totals.hallucinatedFieldReferenceCount,
    0,
    `1-char typo "${typo}" should fuzzy-match "${baseField}"`,
  );
});

test("hallucination-eval: artifact build is deterministic — same inputs produce byte-identical canonical JSON", async () => {
  for (const archetypeId of BASELINE_ARCHETYPE_FIXTURE_IDS) {
    const a = await buildHallucinationEvalArtifact({
      archetypeId,
      mode: "faithful",
    });
    const b = await buildHallucinationEvalArtifact({
      archetypeId,
      mode: "faithful",
    });
    assert.equal(canonicalJson(a), canonicalJson(b), archetypeId);
  }
});

test("hallucination-eval: persists per-fixture report under the canonical eval-reports dir layout", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "hallucination-eval-"));
  const archetypeId = "baseline-simple-form" as const;
  const artifact = await buildHallucinationEvalArtifact({
    archetypeId,
    mode: "faithful",
  });
  const outputPath = await writeHallucinationEvalArtifact({
    artifact,
    outputDir: tempDir,
  });
  assert.equal(
    outputPath,
    join(tempDir, hallucinationEvalReportFilename(archetypeId)),
  );
  const persisted = JSON.parse(await readFile(outputPath, "utf8"));
  assert.deepEqual(persisted, artifact);
  assert.equal(
    HALLUCINATION_EVAL_REPORT_DIRNAME,
    "storybook-static/eval-reports",
  );
  assert.equal(
    hallucinationEvalReportFilename(archetypeId),
    "hallucination-simple-form.json",
  );
});

test("hallucination-eval: empty IR + empty test list yields zero rates and a passing verdict (no false negatives)", () => {
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
    typeof computeHallucinationMetrics
  >[0]["intent"];
  const generatedList = {
    schemaVersion: "1.0.0",
    jobId: "empty",
    testCases: [],
  } as unknown as Parameters<
    typeof computeHallucinationMetrics
  >[0]["generatedList"];
  const { metrics, findings } = computeHallucinationMetrics({
    intent,
    generatedList,
    knownFigmaNodeIds: [],
    knownScreenIds: [],
  });
  assert.equal(metrics.hallucinatedActionRate, 0);
  assert.equal(metrics.hallucinatedFieldRate, 0);
  assert.equal(metrics.hallucinatedScreenRate, 0);
  assert.equal(metrics.hallucinatedTraceNodeIdRate, 0);
  assert.equal(metrics.hallucinatedValidationRate, 0);
  assert.deepEqual(findings, []);
  const verdict = evaluateHallucinationVerdict(metrics);
  assert.equal(verdict.passed, true);
});

test("hallucination-eval: respects custom thresholds passed through evaluateHallucinationVerdict", () => {
  const metrics = {
    hallucinatedActionRate: 0.1,
    hallucinatedFieldRate: 0.0,
    hallucinatedValidationRate: 0,
    hallucinatedScreenRate: 0,
    hallucinatedTraceNodeIdRate: 0,
    totals: {
      actionReferenceCount: 10,
      hallucinatedActionReferenceCount: 1,
      fieldReferenceCount: 0,
      hallucinatedFieldReferenceCount: 0,
      validationCitationCount: 0,
      hallucinatedValidationCitationCount: 0,
      screenReferenceCount: 0,
      hallucinatedScreenReferenceCount: 0,
      traceNodeIdReferenceCount: 0,
      hallucinatedTraceNodeIdReferenceCount: 0,
      buttonStateReferenceCount: 0,
      buttonStateWarningCount: 0,
      errorFindingCount: 1,
      warningFindingCount: 0,
    },
  };
  const strictVerdict = evaluateHallucinationVerdict(metrics, {
    hallucinatedActionRate: 0,
    hallucinatedFieldRate: 0,
  });
  assert.equal(strictVerdict.passed, false);
  const lenientVerdict = evaluateHallucinationVerdict(metrics, {
    hallucinatedActionRate: 0.5,
    hallucinatedFieldRate: 0.5,
  });
  assert.equal(lenientVerdict.passed, true);
});
