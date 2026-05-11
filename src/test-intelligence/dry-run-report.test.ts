/**
 * Tests for the deterministic shape of `DryRunReportArtifact` (Issue #1368).
 *
 * Pins the schema version stamp, the two hard `false` invariants, and
 * deterministic id stability across two runs with identical clocks +
 * id sources. Also covers visual sidecar flow-through into the report.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  DRY_RUN_REPORT_ARTIFACT_FILENAME,
  DRY_RUN_REPORT_SCHEMA_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type QcMappingPreviewArtifact,
  type TestCasePolicyReport,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { buildQcMappingPreview } from "./qc-mapping.js";
import {
  createFixedClock,
  createOpenTextAlmDryRunAdapter,
  DEFAULT_DRY_RUN_ID_SOURCE,
} from "./qc-alm-dry-run.js";
import { cloneOpenTextAlmDefaultMappingProfile } from "./qc-alm-mapping-profile.js";

const ZERO = "0".repeat(64);
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const buildIntent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: [
    {
      screenId: "s-payment",
      screenName: "Payment Details",
      trace: { nodeId: "s-payment" },
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
});

const buildCase = (id: string): GeneratedTestCase => ({
  id,
  sourceJobId: "job-1368-shape",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: `Case ${id}`,
  objective: `Objective for ${id}`,
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "regulated_data",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "do" }],
  expectedResults: [],
  figmaTraceRefs: [{ screenId: "s-payment" }],
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
  reviewState: "auto_approved",
  audit: {
    jobId: "job-1368-shape",
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    cacheHit: false,
    cacheKey: "k",
    inputHash: ZERO,
    promptHash: ZERO,
    schemaHash: ZERO,
  },
});

const emptyPolicy = (count: number): TestCasePolicyReport => ({
  schemaVersion: "1.0.0",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1368-shape",
  policyProfileId: "eu-banking-default",
  policyProfileVersion: "1.0.0",
  totalTestCases: count,
  approvedCount: 0,
  blockedCount: 0,
  needsReviewCount: 0,
  blocked: false,
  decisions: [],
  jobLevelViolations: [],
});

const buildList = (cases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1368-shape",
  testCases: cases,
});

const buildPreview = (
  cases: GeneratedTestCase[],
  visual?: VisualSidecarValidationReport,
): QcMappingPreviewArtifact =>
  buildQcMappingPreview({
    jobId: "job-1368-shape",
    generatedAt: GENERATED_AT,
    list: buildList(cases),
    intent: buildIntent(),
    policy: emptyPolicy(cases.length),
    ...(visual !== undefined ? { visual } : {}),
  });

test("dry-run-report: filename and schema-version constants are stable", () => {
  assert.equal(DRY_RUN_REPORT_ARTIFACT_FILENAME, "dry-run-report.json");
  assert.equal(DRY_RUN_REPORT_SCHEMA_VERSION, "1.0.0");
});

test("dry-run-report: schemaVersion + contractVersion stamped on every report", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const result = await adapter.dryRun({
    jobId: "job-1368-shape",
    mode: "dry_run",
    profile: cloneOpenTextAlmDefaultMappingProfile(),
    preview: buildPreview([buildCase("tc-a")]),
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  assert.equal(result.schemaVersion, DRY_RUN_REPORT_SCHEMA_VERSION);
  assert.equal(result.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(result.mode, "dry_run");
  assert.equal(result.adapter.provider, "opentext_alm");
  assert.equal(result.adapter.version, "1.0.0");
});

test("dry-run-report: hard invariants — rawScreenshotsIncluded + credentialsIncluded are false", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const result = await adapter.dryRun({
    jobId: "job-1368-shape",
    mode: "dry_run",
    profile: cloneOpenTextAlmDefaultMappingProfile(),
    preview: buildPreview([buildCase("tc-a")]),
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  assert.equal(result.rawScreenshotsIncluded, false);
  assert.equal(result.credentialsIncluded, false);
  // Defence-in-depth: no credential-shaped pattern leaks into the
  // serialized report.
  const serialized = canonicalJson(result);
  assert.doesNotMatch(serialized, /Bearer [A-Za-z0-9._-]{8,}/);
  assert.doesNotMatch(serialized, /api[-_ ]?key/i);
  assert.doesNotMatch(serialized, /password/i);
});

test("dry-run-report: deterministic reportId across two runs with identical inputs", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  const preview = buildPreview([buildCase("tc-a"), buildCase("tc-b")]);
  const a = await adapter.dryRun({
    jobId: "job-1368-shape",
    mode: "dry_run",
    profile,
    preview,
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  const b = await adapter.dryRun({
    jobId: "job-1368-shape",
    mode: "dry_run",
    profile,
    preview,
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  assert.equal(a.reportId, b.reportId);
  assert.match(a.reportId, /^[0-9a-f]{16}$/);
  // Full byte-stability of the canonical serialization.
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test("dry-run-report: distinct generatedAt yields distinct reportId", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  const preview = buildPreview([buildCase("tc-a")]);
  const a = await adapter.dryRun({
    jobId: "job-1368-shape",
    mode: "dry_run",
    profile,
    preview,
    clock: createFixedClock("2026-04-25T10:00:00.000Z"),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  const b = await adapter.dryRun({
    jobId: "job-1368-shape",
    mode: "dry_run",
    profile,
    preview,
    clock: createFixedClock("2026-04-25T10:00:01.000Z"),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  assert.notEqual(a.reportId, b.reportId);
});

test("dry-run-report: visual sidecar evidence flow-through is sorted by testCaseId", async () => {
  const visual: VisualSidecarValidationReport = {
    schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    generatedAt: GENERATED_AT,
    jobId: "job-1368-shape",
    totalScreens: 1,
    screensWithFindings: 1,
    blocked: false,
    records: [
      {
        screenId: "s-payment",
        deployment: "llama-4-maverick-vision",
        outcomes: ["low_confidence", "possible_pii"],
        issues: [],
        meanConfidence: 0.4,
      },
    ],
  };
  const adapter = createOpenTextAlmDryRunAdapter();
  const result = await adapter.dryRun({
    jobId: "job-1368-shape",
    mode: "dry_run",
    profile: cloneOpenTextAlmDefaultMappingProfile(),
    preview: buildPreview(
      [buildCase("tc-zebra"), buildCase("tc-alpha")],
      visual,
    ),
    visual,
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  assert.equal(result.visualEvidenceFlags.length, 2);
  // Sorted by testCaseId for byte-stability.
  assert.deepEqual(
    result.visualEvidenceFlags.map((f) => f.testCaseId),
    ["tc-alpha", "tc-zebra"],
  );
  for (const flag of result.visualEvidenceFlags) {
    assert.equal(flag.reason, "visual_only_low_confidence_mapping");
    // ambiguityFlags must be sorted and contain the non-ok / non-fallback outcomes only.
    assert.deepEqual(flag.ambiguityFlags.slice().sort(), flag.ambiguityFlags);
  }
});
