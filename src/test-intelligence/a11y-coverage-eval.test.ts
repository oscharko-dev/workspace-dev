/**
 * Tests for the form-screen accessibility coverage eval (Issue #1905).
 *
 * The suite exercises:
 *   - per-screen `a11yCaseCoverage` accounting for the three target
 *     fixtures (`baseline-simple-form`, `baseline-complex-mask`,
 *     `validation-onboarding`);
 *   - the hard gate (`a11yCaseCoverage >= 1` per form screen) tripping
 *     when the candidate list lacks an anchored a11y case;
 *   - the soft target (4 cases per screen) producing a warning verdict
 *     while keeping the hard gate green;
 *   - canonical-JSON byte stability of the persisted artifacts;
 *   - the repair-instruction template rendering.
 *
 * The deterministic synthesiser (`synthesizeGeneratedTestCases`) emits
 * exactly one composite a11y case per form screen, so the default
 * artifact passes the hard gate but fails the soft target — both
 * directions of the verdict are covered without a live LLM.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import {
  A11Y_COVERAGE_EVAL_DEFAULT_SOFT_TARGET_PER_SCREEN,
  A11Y_COVERAGE_EVAL_HARD_THRESHOLD_PER_SCREEN,
  A11Y_COVERAGE_EVAL_PROFILE_ID,
  A11Y_COVERAGE_EVAL_REPORT_DIRNAME,
  A11Y_COVERAGE_EVAL_SCHEMA_VERSION,
  A11Y_COVERAGE_PRODUCTION_BASELINE_THRESHOLDS,
  A11Y_WCAG_22_AA_PILLAR_IDS,
  A11Y_WCAG_22_AA_PILLARS,
  a11yCoverageEvalReportFilename,
  buildA11yCoverageEvalArtifactForBaseline,
  buildA11yCoverageEvalArtifactForValidationFixture,
  buildA11yCoverageRepairInstruction,
  buildAllBaselineA11yCoverageEvalArtifacts,
  computeA11yCoverage,
  isFormScreenA11yCase,
  readA11yCoverageEvalArtifact,
  writeA11yCoverageEvalArtifact,
} from "./a11y-coverage-eval.js";
import { GENERATOR_FORM_SCREEN_A11Y_REPAIR_INSTRUCTION } from "./agent-role-profile.js";
import { canonicalJson } from "./content-hash.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import type { IntentDerivationFigmaInput } from "./intent-derivation.js";

const FIXTURES_DIR = path.join(
  new URL(".", import.meta.url).pathname,
  "fixtures",
);

const STABLE_AUDIT = {
  jobId: "job-1905",
  generatedAt: "2026-05-05T00:00:00.000Z",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  redactionPolicyVersion: REDACTION_POLICY_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  cacheHit: false,
  cacheKey: "k".repeat(64),
  inputHash: "i".repeat(64),
  promptHash: "p".repeat(64),
  schemaHash: "s".repeat(64),
} as GeneratedTestCase["audit"];

const buildCase = (input: {
  id: string;
  type: GeneratedTestCase["type"];
  screenId: string;
  fieldIds?: readonly string[];
}): GeneratedTestCase =>
  ({
    id: input.id,
    sourceJobId: "job-1905",
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    title: input.id,
    objective: input.id,
    level: "system",
    type: input.type,
    priority: "p2",
    riskCategory: "low",
    technique: "exploratory",
    preconditions: [],
    testData: [],
    steps: [{ index: 1, action: "noop" }],
    expectedResults: ["noop"],
    figmaTraceRefs: [{ screenId: input.screenId }],
    assumptions: [],
    openQuestions: [],
    qcMappingPreview: { exportable: true } as GeneratedTestCase["qcMappingPreview"],
    qualitySignals: {
      coveredFieldIds: [...(input.fieldIds ?? [])],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.9,
    } as GeneratedTestCase["qualitySignals"],
    reviewState: "draft",
    audit: STABLE_AUDIT,
  }) as GeneratedTestCase;

const buildList = (
  cases: readonly GeneratedTestCase[],
): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1905",
  testCases: [...cases],
});

const loadFigma = async (
  fixtureId: string,
): Promise<IntentDerivationFigmaInput> => {
  const raw = await readFile(
    path.join(FIXTURES_DIR, `${fixtureId}.figma.json`),
    "utf8",
  );
  return JSON.parse(raw) as IntentDerivationFigmaInput;
};

test("WCAG 2.2 AA pillar list is closed and stable", () => {
  assert.deepEqual(
    [...A11Y_WCAG_22_AA_PILLAR_IDS].sort(),
    [
      "color-contrast",
      "error-announcements",
      "focus-indicator",
      "keyboard-trap-freedom",
      "label-for-input",
      "tab-order",
    ],
  );
  for (const id of A11Y_WCAG_22_AA_PILLAR_IDS) {
    const pillar = A11Y_WCAG_22_AA_PILLARS[id];
    assert.ok(pillar.title.length > 0, `pillar ${id} has a title`);
    assert.match(pillar.successCriterion, /WCAG \d/u);
    assert.ok(pillar.description.length > 0);
  }
});

test("hard gate trips when the candidate list has no a11y case anchored to a form screen", async () => {
  const fixture = await loadFigma("baseline-simple-form");
  const intent = deriveBusinessTestIntentIr({ figma: fixture });
  const screenId = intent.detectedFields[0]?.screenId;
  assert.ok(screenId, "fixture must carry at least one detected field");
  const list = buildList([
    buildCase({
      id: "tc-functional-only",
      type: "functional",
      screenId,
      fieldIds: intent.detectedFields.map((f) => f.id),
    }),
  ]);
  const result = computeA11yCoverage({ intent, generatedList: list });
  assert.equal(result.verdict.passed, false);
  assert.equal(result.metrics.formScreensWithCoverage, 0);
  assert.equal(result.metrics.totalA11yCases, 0);
  const failure = result.verdict.failures.find(
    (f) => f.reason === "form_screen_missing_accessibility_case",
  );
  assert.ok(failure, "expected form_screen_missing_accessibility_case failure");
  assert.equal(failure.severity, "error");
  assert.equal(failure.threshold, A11Y_COVERAGE_EVAL_HARD_THRESHOLD_PER_SCREEN);
  assert.equal(result.repairInstructions.length, 1);
  const [instruction] = result.repairInstructions;
  assert.match(instruction.instruction, /accessibility test case for screen /u);
  assert.match(instruction.instruction, new RegExp(screenId));
});

test("hard gate passes for the deterministic synthesiser output of baseline-simple-form", async () => {
  const artifact = await buildA11yCoverageEvalArtifactForBaseline({
    archetypeId: "baseline-simple-form",
  });
  assert.equal(artifact.profileId, A11Y_COVERAGE_EVAL_PROFILE_ID);
  assert.equal(artifact.schemaVersion, A11Y_COVERAGE_EVAL_SCHEMA_VERSION);
  assert.ok(
    artifact.metrics.formScreenCount > 0,
    "baseline-simple-form must surface at least one form screen",
  );
  assert.equal(
    artifact.metrics.formScreensWithCoverage,
    artifact.metrics.formScreenCount,
    "synthesiser emits one a11y case per form screen → hard gate is green",
  );
  // Soft target requires >= 4 cases per screen; the synthesiser emits 1.
  assert.equal(artifact.metrics.formScreensMeetingSoftTarget, 0);
  // Hard gate verdict is `passed=true` (no error-severity failures).
  assert.equal(artifact.verdict.passed, true);
  // Soft-target failures surface as warnings.
  for (const failure of artifact.verdict.failures) {
    assert.equal(failure.reason, "form_screen_below_soft_target");
    assert.equal(failure.severity, "warning");
    assert.equal(
      failure.threshold,
      A11Y_COVERAGE_EVAL_DEFAULT_SOFT_TARGET_PER_SCREEN,
    );
  }
  for (const screen of artifact.perScreen) {
    assert.equal(screen.hardGatePassed, true);
    assert.equal(screen.expectedPillars.length, A11Y_WCAG_22_AA_PILLAR_IDS.length);
  }
});

test("hard gate passes for the synthesiser output of baseline-complex-mask", async () => {
  const artifact = await buildA11yCoverageEvalArtifactForBaseline({
    archetypeId: "baseline-complex-mask",
  });
  assert.ok(artifact.metrics.formScreenCount > 0);
  assert.equal(artifact.verdict.passed, true);
  for (const screen of artifact.perScreen) {
    assert.equal(screen.hardGatePassed, true);
    assert.ok(
      screen.matchedTestCaseIds.length >=
        A11Y_COVERAGE_EVAL_HARD_THRESHOLD_PER_SCREEN,
    );
  }
});

test("validation-onboarding fixture lands at least one a11y case after the synthesiser pass (Wave 2 + 3 simulation)", async () => {
  const figma = await loadFigma("validation-onboarding");
  const artifact = buildA11yCoverageEvalArtifactForValidationFixture({
    fixtureId: "validation-onboarding",
    figma,
  });
  assert.equal(artifact.source.kind, "validation-fixture");
  if (artifact.source.kind === "validation-fixture") {
    assert.equal(artifact.source.id, "validation-onboarding");
  }
  // Demo replay (Test-View-04, 2026-05-05) blocked on missing_accessibility_case
  // — after the synthesiser pass at least one a11y case anchors the form
  // screen for every screen carrying input fields.
  assert.ok(artifact.metrics.formScreenCount > 0);
  assert.ok(artifact.metrics.totalA11yCases >= 1);
  assert.equal(
    artifact.metrics.formScreensWithCoverage,
    artifact.metrics.formScreenCount,
  );
  assert.equal(artifact.verdict.passed, true);
});

test("isFormScreenA11yCase only matches anchored accessibility cases", () => {
  const screenId = "s-form";
  const a11yAnchored = buildCase({
    id: "tc-a11y",
    type: "accessibility",
    screenId,
  });
  const a11yElsewhere = buildCase({
    id: "tc-a11y-other",
    type: "accessibility",
    screenId: "s-other",
  });
  const functionalAnchored = buildCase({
    id: "tc-fn",
    type: "functional",
    screenId,
  });
  assert.equal(isFormScreenA11yCase(a11yAnchored, screenId), true);
  assert.equal(isFormScreenA11yCase(a11yElsewhere, screenId), false);
  assert.equal(isFormScreenA11yCase(functionalAnchored, screenId), false);
});

test("buildA11yCoverageRepairInstruction renders the canonical template", () => {
  const ri = buildA11yCoverageRepairInstruction({ screenId: "s-loan" });
  assert.equal(ri.testCaseId, "$job");
  assert.equal(ri.path, "qualitySignals.coveredScreenIds");
  assert.equal(
    ri.instruction,
    GENERATOR_FORM_SCREEN_A11Y_REPAIR_INSTRUCTION.replace("{screenId}", "s-loan"),
  );
  assert.match(ri.instruction, /s-loan/u);
});

test("computeA11yCoverage is deterministic and byte-stable", async () => {
  const artifactA = await buildA11yCoverageEvalArtifactForBaseline({
    archetypeId: "baseline-simple-form",
  });
  const artifactB = await buildA11yCoverageEvalArtifactForBaseline({
    archetypeId: "baseline-simple-form",
  });
  assert.equal(canonicalJson(artifactA), canonicalJson(artifactB));
});

test("buildAllBaselineA11yCoverageEvalArtifacts covers every baseline archetype", async () => {
  const artifacts = await buildAllBaselineA11yCoverageEvalArtifacts();
  assert.equal(artifacts.length, 7);
  const ids = artifacts
    .map((a) => (a.source.kind === "baseline-archetype" ? a.source.id : ""))
    .sort();
  assert.deepEqual(ids, [
    "baseline-ambiguous-rules",
    "baseline-calculation",
    "baseline-complex-mask",
    "baseline-multi-context",
    "baseline-optional-fields",
    "baseline-simple-form",
    "baseline-validation-heavy",
  ]);
});

test("writeA11yCoverageEvalArtifact persists canonical-JSON output and round-trips", async () => {
  const artifact = await buildA11yCoverageEvalArtifactForBaseline({
    archetypeId: "baseline-simple-form",
  });
  const dir = await mkdtemp(path.join(os.tmpdir(), "a11y-eval-"));
  try {
    const outputPath = await writeA11yCoverageEvalArtifact({
      artifact,
      outputDir: dir,
    });
    assert.equal(
      path.basename(outputPath),
      a11yCoverageEvalReportFilename(artifact.source),
    );
    const persisted = await readFile(outputPath, "utf8");
    assert.equal(persisted, canonicalJson(artifact));
    const roundTripped = await readA11yCoverageEvalArtifact(outputPath);
    assert.equal(canonicalJson(roundTripped), canonicalJson(artifact));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a11yCoverageEvalReportFilename strips the baseline- prefix and uses `a11y-<id>.json`", () => {
  assert.equal(
    a11yCoverageEvalReportFilename({
      kind: "baseline-archetype",
      id: "baseline-simple-form",
    }),
    "a11y-simple-form.json",
  );
  assert.equal(
    a11yCoverageEvalReportFilename({
      kind: "validation-fixture",
      id: "validation-onboarding",
    }),
    "a11y-validation-onboarding.json",
  );
});

test("default thresholds match documented production-baseline values", () => {
  assert.equal(
    A11Y_COVERAGE_PRODUCTION_BASELINE_THRESHOLDS.hardThresholdPerScreen,
    1,
  );
  assert.equal(
    A11Y_COVERAGE_PRODUCTION_BASELINE_THRESHOLDS.softTargetPerScreen,
    4,
  );
});

test("report directory constant is the documented eval-reports path", () => {
  assert.equal(
    A11Y_COVERAGE_EVAL_REPORT_DIRNAME,
    "storybook-static/eval-reports",
  );
});

// ---------------------------------------------------------------------------
// Issue #1951 — confirm the documented hard-gate severity stays at error so a
// downgrade requires a deliberate `customerProfile.policyOverrides` entry,
// not a silent default change in this module.
// ---------------------------------------------------------------------------

test("Issue #1951: hard-gate failure severity is `error` for production thresholds", async () => {
  const fixture = await loadFigma("baseline-simple-form");
  const intent = deriveBusinessTestIntentIr({ figma: fixture });
  const screenId = intent.detectedFields[0]?.screenId;
  assert.ok(screenId, "fixture must carry at least one detected field");
  const list = buildList([
    buildCase({
      id: "tc-functional-only",
      type: "functional",
      screenId,
      fieldIds: intent.detectedFields.map((f) => f.id),
    }),
  ]);
  const result = computeA11yCoverage({ intent, generatedList: list });
  const failure = result.verdict.failures.find(
    (f) => f.reason === "form_screen_missing_accessibility_case",
  );
  assert.ok(failure, "expected hard-gate failure");
  assert.equal(
    failure.severity,
    "error",
    "Issue #1951 requires the form-screen accessibility hard-gate to remain at error severity by default",
  );
  assert.equal(
    result.verdict.passed,
    false,
    "verdict.passed must reflect the error-severity failure",
  );
});
