import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  INTENT_DELTA_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type IntentDeltaReport,
  type VisualSidecarValidationReport,
  VISUAL_SIDECAR_SCHEMA_VERSION,
} from "../contracts/index.js";
import {
  classifyTestCaseDelta,
  TEST_CASE_DELTA_DEFAULT_VISUAL_CONFIDENCE_FLOOR,
  TEST_CASE_DELTA_REPORT_ARTIFACT_FILENAME,
  writeTestCaseDeltaReport,
} from "./test-case-delta.js";

const ZERO = "0".repeat(64);

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-x",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "title",
  objective: "obj",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "do something", expected: "ok" }],
  expectedResults: ["ok"],
  figmaTraceRefs: [{ screenId: "screen-a" }],
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
    jobId: "job-1",
    generatedAt: "2026-04-25T10:00:00.000Z",
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

const list = (cases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: cases,
});

const intentWithScreens = (screenIds: string[]): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: screenIds.map((id) => ({
    screenId: id,
    screenName: id,
    trace: { nodeId: id },
  })),
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
});

const emptyDelta: IntentDeltaReport = {
  schemaVersion: INTENT_DELTA_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: "job-1",
  generatedAt: "2026-04-26T00:00:00.000Z",
  priorIntentHash: ZERO,
  currentIntentHash: ZERO,
  entries: [],
  totals: {
    added: 0,
    removed: 0,
    changed: 0,
    confidenceDropped: 0,
    ambiguityIncreased: 0,
  },
  rawScreenshotsIncluded: false,
  secretsIncluded: false,
};

test("new case (id absent in prior) gets `new` verdict + absent_in_prior reason", () => {
  const out = classifyTestCaseDelta({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: list([]),
    current: list([buildCase({ id: "tc-1" })]),
    currentIntent: intentWithScreens(["screen-a"]),
    intentDelta: emptyDelta,
  });
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0]?.verdict, "new");
  assert.deepEqual(out.rows[0]?.reasons, ["absent_in_prior"]);
  assert.equal(out.totals.new, 1);
});

test("identical case (same fingerprint, no IR delta touch) gets `unchanged`", () => {
  const tc = buildCase({ id: "tc-1" });
  const out = classifyTestCaseDelta({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: list([tc]),
    current: list([tc]),
    currentIntent: intentWithScreens(["screen-a"]),
    intentDelta: emptyDelta,
  });
  assert.equal(out.rows[0]?.verdict, "unchanged");
  assert.deepEqual(out.rows[0]?.reasons, []);
  assert.equal(out.totals.unchanged, 1);
});

test("fingerprint change yields `changed` + fingerprint_changed reason", () => {
  const prior = buildCase({ id: "tc-1", title: "Old title" });
  const current = buildCase({ id: "tc-1", title: "New title" });
  const out = classifyTestCaseDelta({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: list([prior]),
    current: list([current]),
    currentIntent: intentWithScreens(["screen-a"]),
    intentDelta: emptyDelta,
  });
  assert.equal(out.rows[0]?.verdict, "changed");
  assert.ok(out.rows[0]?.reasons.includes("fingerprint_changed"));
  assert.notEqual(
    out.rows[0]?.priorFingerprintHash,
    out.rows[0]?.currentFingerprintHash,
  );
});

test("trace screen changed in IR delta yields `changed` even with stable fingerprint", () => {
  const tc = buildCase({ id: "tc-1" });
  const delta: IntentDeltaReport = {
    ...emptyDelta,
    entries: [
      {
        kind: "field",
        changeType: "changed",
        elementId: "screen-a::field::node-1",
        screenId: "screen-a",
        priorHash: "1".repeat(64),
        currentHash: "2".repeat(64),
      },
    ],
    totals: { ...emptyDelta.totals, changed: 1 },
  };
  const out = classifyTestCaseDelta({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: list([tc]),
    current: list([tc]),
    currentIntent: intentWithScreens(["screen-a"]),
    intentDelta: delta,
  });
  assert.equal(out.rows[0]?.verdict, "changed");
  assert.ok(out.rows[0]?.reasons.includes("trace_screen_changed"));
});

test("prior case whose every trace screen is absent from current IR is `obsolete` (NOT removed from QC)", () => {
  const prior = buildCase({
    id: "tc-1",
    figmaTraceRefs: [{ screenId: "screen-removed" }],
  });
  const out = classifyTestCaseDelta({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: list([prior]),
    current: list([]),
    currentIntent: intentWithScreens(["screen-a"]),
    intentDelta: {
      ...emptyDelta,
      entries: [
        {
          kind: "screen",
          changeType: "removed",
          elementId: "screen-removed",
          screenId: "screen-removed",
          priorHash: "3".repeat(64),
        },
      ],
      totals: { ...emptyDelta.totals, removed: 1 },
    },
  });
  assert.equal(out.rows[0]?.verdict, "obsolete");
  assert.ok(out.rows[0]?.reasons.includes("trace_screen_removed"));
  assert.equal(out.totals.obsolete, 1);
});

test("low visual confidence escalates `unchanged` to `requires_review`", () => {
  const tc = buildCase({ id: "tc-1" });
  const visual: VisualSidecarValidationReport = {
    schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    generatedAt: "2026-04-26T00:00:00.000Z",
    jobId: "job-1",
    totalScreens: 1,
    screensWithFindings: 1,
    blocked: false,
    records: [
      {
        screenId: "screen-a",
        deployment: "mock",
        outcomes: ["low_confidence"],
        issues: [],
        meanConfidence: 0.3,
      },
    ],
  };
  const out = classifyTestCaseDelta({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: list([tc]),
    current: list([tc]),
    currentIntent: intentWithScreens(["screen-a"]),
    intentDelta: emptyDelta,
    visual,
  });
  assert.equal(out.rows[0]?.verdict, "requires_review");
  assert.ok(out.rows[0]?.reasons.includes("visual_confidence_dropped"));
  assert.equal(out.totals.requiresReview, 1);
});

test("visual conflict outcome escalates to `requires_review` with reconciliation_conflict", () => {
  const tc = buildCase({ id: "tc-1" });
  const visual: VisualSidecarValidationReport = {
    schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    generatedAt: "2026-04-26T00:00:00.000Z",
    jobId: "job-1",
    totalScreens: 1,
    screensWithFindings: 1,
    blocked: false,
    records: [
      {
        screenId: "screen-a",
        deployment: "mock",
        outcomes: ["conflicts_with_figma_metadata"],
        issues: [],
        meanConfidence: 0.95,
      },
    ],
  };
  const out = classifyTestCaseDelta({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: list([tc]),
    current: list([tc]),
    currentIntent: intentWithScreens(["screen-a"]),
    intentDelta: emptyDelta,
    visual,
  });
  assert.equal(out.rows[0]?.verdict, "requires_review");
  assert.ok(out.rows[0]?.reasons.includes("reconciliation_conflict"));
});

test("obsolete verdict is NOT downgraded by visual escalation (obsolete dominates)", () => {
  const prior = buildCase({
    id: "tc-1",
    figmaTraceRefs: [{ screenId: "screen-removed" }],
  });
  const visual: VisualSidecarValidationReport = {
    schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    generatedAt: "2026-04-26T00:00:00.000Z",
    jobId: "job-1",
    totalScreens: 1,
    screensWithFindings: 1,
    blocked: false,
    records: [
      {
        screenId: "screen-removed",
        deployment: "mock",
        outcomes: ["low_confidence"],
        issues: [],
        meanConfidence: 0.1,
      },
    ],
  };
  const out = classifyTestCaseDelta({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: list([prior]),
    current: list([]),
    currentIntent: intentWithScreens(["screen-a"]),
    intentDelta: emptyDelta,
    visual,
  });
  assert.equal(out.rows[0]?.verdict, "obsolete");
});

test("rows are sorted by testCaseId for deterministic output", () => {
  const out = classifyTestCaseDelta({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: list([]),
    current: list([
      buildCase({ id: "tc-z" }),
      buildCase({ id: "tc-a" }),
      buildCase({ id: "tc-m" }),
    ]),
    currentIntent: intentWithScreens(["screen-a"]),
    intentDelta: emptyDelta,
  });
  const ids = out.rows.map((r) => r.testCaseId);
  assert.deepEqual(ids, ["tc-a", "tc-m", "tc-z"]);
});

test("visualConfidenceThreshold range guard rejects invalid values", () => {
  assert.throws(
    () =>
      classifyTestCaseDelta({
        jobId: "job-1",
        generatedAt: "2026-04-26T00:00:00.000Z",
        prior: list([]),
        current: list([]),
        currentIntent: intentWithScreens([]),
        visualConfidenceThreshold: 1.1,
      }),
    RangeError,
  );
});

test("default visual confidence floor is in (0, 1]", () => {
  assert.ok(TEST_CASE_DELTA_DEFAULT_VISUAL_CONFIDENCE_FLOOR > 0);
  assert.ok(TEST_CASE_DELTA_DEFAULT_VISUAL_CONFIDENCE_FLOOR <= 1);
});

test("invariant flags are stamped at runtime", () => {
  const out = classifyTestCaseDelta({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: list([]),
    current: list([]),
    currentIntent: intentWithScreens([]),
  });
  assert.equal(out.rawScreenshotsIncluded, false);
  assert.equal(out.secretsIncluded, false);
});

test("writeTestCaseDeltaReport persists deterministic canonical JSON atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wd-tc-delta-"));
  try {
    const report = classifyTestCaseDelta({
      jobId: "job-1",
      generatedAt: "2026-04-26T00:00:00.000Z",
      prior: list([buildCase({ id: "tc-1", title: "A" })]),
      current: list([buildCase({ id: "tc-1", title: "B" })]),
      currentIntent: intentWithScreens(["screen-a"]),
      intentDelta: emptyDelta,
    });
    const result = await writeTestCaseDeltaReport({
      report,
      destinationDir: dir,
    });
    assert.equal(
      result.artifactPath,
      join(dir, TEST_CASE_DELTA_REPORT_ARTIFACT_FILENAME),
    );
    const a = await readFile(result.artifactPath, "utf8");
    const b = await readFile(
      (await writeTestCaseDeltaReport({ report, destinationDir: dir }))
        .artifactPath,
      "utf8",
    );
    assert.equal(a, b);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
