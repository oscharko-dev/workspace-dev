import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ALLOWED_INTENT_DELTA_CHANGE_TYPES,
  ALLOWED_INTENT_DELTA_KINDS,
  INTENT_DELTA_REPORT_ARTIFACT_FILENAME,
  INTENT_DELTA_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type BusinessTestIntentIr,
  type DetectedAction,
  type DetectedField,
  type DetectedNavigation,
  type DetectedValidation,
  type VisualScreenDescription,
} from "../contracts/index.js";
import {
  computeIntentDelta,
  INTENT_DELTA_DEFAULT_CONFIDENCE_DRIFT,
  writeIntentDeltaReport,
} from "./intent-delta.js";

const baseField = (overrides: Partial<DetectedField>): DetectedField => ({
  id: "screen-a::field::node-1",
  screenId: "screen-a",
  trace: { nodeId: "node-1", nodeName: "Email" },
  provenance: "figma_node",
  confidence: 0.9,
  label: "Email",
  type: "text",
  ...overrides,
});

const baseAction = (overrides: Partial<DetectedAction>): DetectedAction => ({
  id: "screen-a::action::btn-1",
  screenId: "screen-a",
  trace: { nodeId: "btn-1", nodeName: "Submit" },
  provenance: "figma_node",
  confidence: 0.9,
  label: "Submit",
  kind: "button",
  ...overrides,
});

const baseValidation = (
  overrides: Partial<DetectedValidation>,
): DetectedValidation => ({
  id: "screen-a::validation::node-1::required",
  screenId: "screen-a",
  trace: { nodeId: "node-1" },
  provenance: "figma_node",
  confidence: 0.85,
  rule: "required",
  ...overrides,
});

const baseNavigation = (
  overrides: Partial<DetectedNavigation>,
): DetectedNavigation => ({
  id: "screen-a::nav::btn-1",
  screenId: "screen-a",
  trace: { nodeId: "btn-1" },
  provenance: "figma_node",
  confidence: 0.8,
  targetScreenId: "screen-b",
  ...overrides,
});

const baseIr = (
  overrides: Partial<BusinessTestIntentIr>,
): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: "0".repeat(64) },
  screens: [
    {
      screenId: "screen-a",
      screenName: "Login",
      trace: { nodeId: "screen-a", nodeName: "Login" },
    },
  ],
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
  ...overrides,
});

test("computeIntentDelta: identical IRs produce empty entries + zero totals", () => {
  const ir = baseIr({ detectedFields: [baseField({})] });
  const delta = computeIntentDelta({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: ir,
    current: ir,
  });
  assert.equal(delta.entries.length, 0);
  assert.deepEqual(delta.totals, {
    added: 0,
    removed: 0,
    changed: 0,
    confidenceDropped: 0,
    ambiguityIncreased: 0,
  });
  assert.equal(delta.priorIntentHash, delta.currentIntentHash);
  assert.equal(delta.rawScreenshotsIncluded, false);
  assert.equal(delta.secretsIncluded, false);
});

test("computeIntentDelta: detects added/removed/changed fields, actions, validations, navigation, screens", () => {
  const prior = baseIr({
    screens: [
      {
        screenId: "screen-a",
        screenName: "Login",
        trace: { nodeId: "screen-a" },
      },
      {
        screenId: "screen-removed",
        screenName: "Old",
        trace: { nodeId: "screen-removed" },
      },
    ],
    detectedFields: [baseField({ label: "Email" })],
    detectedActions: [baseAction({ label: "Submit" })],
    detectedValidations: [baseValidation({ rule: "required" })],
    detectedNavigation: [baseNavigation({ targetScreenId: "screen-b" })],
  });
  const current = baseIr({
    screens: [
      {
        screenId: "screen-a",
        screenName: "Sign in",
        trace: { nodeId: "screen-a" },
      },
      {
        screenId: "screen-new",
        screenName: "New",
        trace: { nodeId: "screen-new" },
      },
    ],
    detectedFields: [
      baseField({ label: "Email address" }),
      baseField({ id: "screen-a::field::node-2", label: "Password" }),
    ],
    detectedActions: [],
    detectedValidations: [
      baseValidation({
        id: "screen-a::validation::node-1::email",
        rule: "email",
      }),
    ],
    detectedNavigation: [baseNavigation({ targetScreenId: "screen-c" })],
  });

  const delta = computeIntentDelta({
    jobId: "job-2",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior,
    current,
  });

  // Stable shape — kinds + change-types lookups are deterministic.
  const grouped = new Map<string, number>();
  for (const e of delta.entries) {
    const key = `${e.kind}:${e.changeType}:${e.elementId}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  // Screen renames trigger `changed` for screen-a; added screen-new; removed screen-removed.
  assert.equal(grouped.get("screen:changed:screen-a"), 1);
  assert.equal(grouped.get("screen:added:screen-new"), 1);
  assert.equal(grouped.get("screen:removed:screen-removed"), 1);
  // Field label change.
  assert.equal(grouped.get("field:changed:screen-a::field::node-1"), 1);
  // New field added.
  assert.equal(grouped.get("field:added:screen-a::field::node-2"), 1);
  // Submit action removed.
  assert.equal(grouped.get("action:removed:screen-a::action::btn-1"), 1);
  // Validation removed (id changed because rule is part of id) + new validation added.
  assert.equal(
    grouped.get("validation:removed:screen-a::validation::node-1::required"),
    1,
  );
  assert.equal(
    grouped.get("validation:added:screen-a::validation::node-1::email"),
    1,
  );
  // Navigation changed (targetScreenId different).
  assert.equal(grouped.get("navigation:changed:screen-a::nav::btn-1"), 1);

  // Totals tally with entry counts.
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const e of delta.entries) {
    if (e.changeType === "added") added += 1;
    else if (e.changeType === "removed") removed += 1;
    else if (e.changeType === "changed") changed += 1;
  }
  assert.equal(delta.totals.added, added);
  assert.equal(delta.totals.removed, removed);
  assert.equal(delta.totals.changed, changed);
});

test("computeIntentDelta: deterministic sort by (kind, elementId, changeType)", () => {
  const prior = baseIr({
    detectedFields: [
      baseField({ id: "screen-a::field::z", label: "Z" }),
      baseField({ id: "screen-a::field::a", label: "A" }),
    ],
  });
  const current = baseIr({
    detectedFields: [
      baseField({ id: "screen-a::field::a", label: "A2" }),
      baseField({ id: "screen-a::field::m", label: "M" }),
    ],
  });
  const delta = computeIntentDelta({
    jobId: "job-3",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior,
    current,
  });
  const ordered = delta.entries.map(
    (e) => `${e.kind}|${e.elementId}|${e.changeType}`,
  );
  const sorted = ordered.slice().sort();
  assert.deepEqual(ordered, sorted);
});

test("computeIntentDelta: visual fixture hash change surfaces as visual_screen changed", () => {
  const ir = baseIr({});
  const delta = computeIntentDelta({
    jobId: "job-4",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: ir,
    current: ir,
    options: {
      priorFixtureHashes: { "screen-a": "a".repeat(64) },
      currentFixtureHashes: { "screen-a": "b".repeat(64) },
    },
  });
  const visualEntries = delta.entries.filter((e) => e.kind === "visual_screen");
  assert.equal(visualEntries.length, 1);
  const entry = visualEntries[0];
  assert.equal(entry?.changeType, "changed");
  assert.equal(entry?.screenId, "screen-a");
  assert.notEqual(entry?.priorHash, entry?.currentHash);
});

test("computeIntentDelta: visual confidence drop surfaces as confidence_dropped", () => {
  const baseDesc = (mean: number): VisualScreenDescription => ({
    screenId: "screen-a",
    sidecarDeployment: "mock",
    regions: [],
    confidenceSummary: { min: mean, max: mean, mean },
  });
  const delta = computeIntentDelta({
    jobId: "job-5",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: baseIr({}),
    current: baseIr({}),
    options: {
      priorVisual: [baseDesc(0.95)],
      currentVisual: [baseDesc(0.6)],
    },
  });
  const drop = delta.entries.find((e) => e.changeType === "confidence_dropped");
  assert.ok(drop, "expected confidence_dropped entry");
  assert.equal(drop?.kind, "visual_screen");
  assert.equal(drop?.screenId, "screen-a");
  assert.match(drop?.detail ?? "", /0\.950 -> 0\.600/);
  assert.equal(delta.totals.confidenceDropped, 1);
});

test("computeIntentDelta: visual ambiguity increase surfaces as ambiguity_increased", () => {
  const desc = (count: number): VisualScreenDescription => ({
    screenId: "screen-a",
    sidecarDeployment: "mock",
    regions: Array.from({ length: count }, (_, i) => ({
      regionId: `r-${i}`,
      confidence: 0.9,
      ambiguity: { reason: `ambiguity-${i}` },
    })),
    confidenceSummary: { min: 0.9, max: 0.9, mean: 0.9 },
  });
  const delta = computeIntentDelta({
    jobId: "job-6",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: baseIr({}),
    current: baseIr({}),
    options: { priorVisual: [desc(1)], currentVisual: [desc(3)] },
  });
  const amb = delta.entries.find((e) => e.changeType === "ambiguity_increased");
  assert.ok(amb);
  assert.equal(amb?.kind, "visual_screen");
  assert.match(amb?.detail ?? "", /1 -> 3/);
  assert.equal(delta.totals.ambiguityIncreased, 1);
});

test("computeIntentDelta: identical visual sidecars produce zero visual entries", () => {
  const desc: VisualScreenDescription = {
    screenId: "screen-a",
    sidecarDeployment: "mock",
    regions: [],
    confidenceSummary: { min: 0.9, max: 0.9, mean: 0.9 },
  };
  const delta = computeIntentDelta({
    jobId: "job-7",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: baseIr({}),
    current: baseIr({}),
    options: { priorVisual: [desc], currentVisual: [desc] },
  });
  const visualEntries = delta.entries.filter((e) => e.kind === "visual_screen");
  assert.equal(visualEntries.length, 0);
});

test("computeIntentDelta: rejects out-of-range confidence drift threshold", () => {
  assert.throws(
    () =>
      computeIntentDelta({
        jobId: "job-8",
        generatedAt: "2026-04-26T00:00:00.000Z",
        prior: baseIr({}),
        current: baseIr({}),
        options: { visualConfidenceDriftThreshold: 1.5 },
      }),
    RangeError,
  );
  assert.throws(
    () =>
      computeIntentDelta({
        jobId: "job-9",
        generatedAt: "2026-04-26T00:00:00.000Z",
        prior: baseIr({}),
        current: baseIr({}),
        options: { visualConfidenceDriftThreshold: -0.01 },
      }),
    RangeError,
  );
});

test("computeIntentDelta: schemaVersion + contractVersion stamped + invariants false", () => {
  const delta = computeIntentDelta({
    jobId: "job-10",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: baseIr({}),
    current: baseIr({}),
  });
  assert.equal(delta.schemaVersion, INTENT_DELTA_REPORT_SCHEMA_VERSION);
  assert.equal(delta.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(delta.rawScreenshotsIncluded, false);
  assert.equal(delta.secretsIncluded, false);
});

test("computeIntentDelta: only allowed kinds and change types appear in entries", () => {
  const delta = computeIntentDelta({
    jobId: "job-11",
    generatedAt: "2026-04-26T00:00:00.000Z",
    prior: baseIr({ detectedFields: [baseField({})] }),
    current: baseIr({ detectedFields: [baseField({ label: "X" })] }),
  });
  for (const e of delta.entries) {
    assert.ok(
      ALLOWED_INTENT_DELTA_KINDS.includes(e.kind),
      `kind ${e.kind} not in allowlist`,
    );
    assert.ok(
      ALLOWED_INTENT_DELTA_CHANGE_TYPES.includes(e.changeType),
      `changeType ${e.changeType} not in allowlist`,
    );
  }
});

test("writeIntentDeltaReport: persists deterministic canonical JSON atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wd-intent-delta-"));
  try {
    const report = computeIntentDelta({
      jobId: "job-write-1",
      generatedAt: "2026-04-26T00:00:00.000Z",
      prior: baseIr({ detectedFields: [baseField({})] }),
      current: baseIr({ detectedFields: [baseField({ label: "Other" })] }),
    });
    const result = await writeIntentDeltaReport({
      report,
      destinationDir: dir,
    });
    assert.equal(
      result.artifactPath,
      join(dir, INTENT_DELTA_REPORT_ARTIFACT_FILENAME),
    );
    const persisted = await readFile(result.artifactPath, "utf8");
    const parsed = JSON.parse(persisted) as Record<string, unknown>;
    assert.equal(parsed["schemaVersion"], INTENT_DELTA_REPORT_SCHEMA_VERSION);
    // Re-write with same input → byte-identical.
    const second = await writeIntentDeltaReport({
      report,
      destinationDir: dir,
    });
    const second2 = await readFile(second.artifactPath, "utf8");
    assert.equal(persisted, second2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("INTENT_DELTA_DEFAULT_CONFIDENCE_DRIFT is a stable in-range constant", () => {
  assert.equal(typeof INTENT_DELTA_DEFAULT_CONFIDENCE_DRIFT, "number");
  assert.ok(INTENT_DELTA_DEFAULT_CONFIDENCE_DRIFT > 0);
  assert.ok(INTENT_DELTA_DEFAULT_CONFIDENCE_DRIFT <= 1);
});
