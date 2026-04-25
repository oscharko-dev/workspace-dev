/**
 * OpenText ALM dry-run adapter tests (Issue #1368).
 *
 * Covers the full acceptance matrix:
 *   - valid profile produces successful report
 *   - missing required fields produce actionable diagnostics
 *   - invalid target folder path → folder_resolution_failed
 *   - provider mismatch on the profile
 *   - regression that no write call fires (resolver spy)
 *   - visual sidecar low-confidence flow-through
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
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
import { buildQcMappingPreview } from "./qc-mapping.js";
import {
  createFixedClock,
  createOpenTextAlmDryRunAdapter,
  DEFAULT_DRY_RUN_ID_SOURCE,
  DEFAULT_FOLDER_RESOLVER,
} from "./qc-alm-dry-run.js";
import { cloneOpenTextAlmDefaultMappingProfile } from "./qc-alm-mapping-profile.js";
import type { QcFolderResolver } from "./qc-adapter.js";

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

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: "job-1368",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Pay with valid IBAN",
  objective: "Ensure a valid IBAN is accepted by the payment form.",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "regulated_data",
  technique: "use_case",
  preconditions: ["Logged-in user"],
  testData: ["IBAN: <redacted>"],
  steps: [
    { index: 1, action: "Open payment form", expected: "Form is visible" },
    { index: 2, action: "Submit", expected: "Payment accepted" },
  ],
  expectedResults: ["Confirmation displayed"],
  figmaTraceRefs: [{ screenId: "s-payment", nodeId: "n-submit" }],
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
    jobId: "job-1368",
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
  ...overrides,
});

const buildList = (cases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1368",
  testCases: cases,
});

const emptyPolicy = (): TestCasePolicyReport => ({
  schemaVersion: "1.0.0",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1368",
  policyProfileId: "eu-banking-default",
  policyProfileVersion: "1.0.0",
  totalTestCases: 0,
  approvedCount: 0,
  blockedCount: 0,
  needsReviewCount: 0,
  blocked: false,
  decisions: [],
  jobLevelViolations: [],
});

const buildPreview = (
  cases: GeneratedTestCase[],
  visual?: VisualSidecarValidationReport,
): QcMappingPreviewArtifact =>
  buildQcMappingPreview({
    jobId: "job-1368",
    generatedAt: GENERATED_AT,
    list: buildList(cases),
    intent: buildIntent(),
    policy: { ...emptyPolicy(), totalTestCases: cases.length },
    ...(visual !== undefined ? { visual } : {}),
  });

const visualReport = (
  meanConfidence: number,
  outcomes: VisualSidecarValidationReport["records"][number]["outcomes"] = [
    "ok",
  ],
): VisualSidecarValidationReport => ({
  schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1368",
  totalScreens: 1,
  screensWithFindings: meanConfidence < 0.6 ? 1 : 0,
  blocked: false,
  records: [
    {
      screenId: "s-payment",
      deployment: "llama-4-maverick-vision",
      outcomes,
      issues: [],
      meanConfidence,
    },
  ],
});

test("qc-alm-dry-run: valid profile produces a successful report", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const preview = buildPreview([buildCase({})]);
  const result = await adapter.dryRun({
    jobId: "job-1368",
    mode: "dry_run",
    profile: cloneOpenTextAlmDefaultMappingProfile(),
    preview,
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  assert.equal(result.refused, false);
  assert.deepEqual(result.refusalCodes, []);
  assert.equal(result.profileValidation.ok, true);
  assert.equal(result.completeness.totalCases, 1);
  assert.equal(result.completeness.completeCases, 1);
  assert.equal(result.completeness.incompleteCases, 0);
  assert.equal(result.folderResolution.state, "simulated");
  assert.equal(result.plannedPayloads.length, 1);
  assert.equal(result.plannedPayloads[0]?.testEntityType, "MANUAL");
  // Hard invariants stamped at the type level.
  assert.equal(result.rawScreenshotsIncluded, false);
  assert.equal(result.credentialsIncluded, false);
});

test("qc-alm-dry-run: missing profile fields refuse with mapping_profile_invalid + diagnostics", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.baseUrlAlias = "";
  profile.requiredFields = [];
  const result = await adapter.dryRun({
    jobId: "job-1368",
    mode: "dry_run",
    profile,
    preview: buildPreview([buildCase({})]),
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  assert.equal(result.refused, true);
  assert.ok(result.refusalCodes.includes("mapping_profile_invalid"));
  // Diagnostics carry pointer paths so a UI can attach them to the form.
  const codes = new Set(result.profileValidation.issues.map((i) => i.code));
  assert.ok(codes.has("missing_base_url_alias"));
  assert.ok(codes.has("missing_required_fields"));
  for (const issue of result.profileValidation.issues) {
    assert.match(issue.path, /^\/[A-Za-z]/);
  }
  assert.equal(result.plannedPayloads.length, 0);
});

test("qc-alm-dry-run: invalid target folder path refuses with folder_resolution_failed", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  // Force the resolver path to walk an already-validator-acceptable but
  // resolver-rejected shape: profile validation would block first if we
  // used a non-/Subject path. Instead, replace the resolver with one that
  // claims invalid_path so we hit the resolver branch deterministically.
  const result = await adapter.dryRun({
    jobId: "job-1368",
    mode: "dry_run",
    profile,
    preview: buildPreview([buildCase({})]),
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
    folderResolver: {
      assertReadOnly: true,
      resolve: () => ({
        state: "invalid_path",
        evidence: "resolver:bad-segment",
      }),
    },
  });
  assert.equal(result.refused, true);
  assert.ok(result.refusalCodes.includes("folder_resolution_failed"));
  assert.equal(result.folderResolution.state, "invalid_path");
});

test("qc-alm-dry-run: provider mismatch refuses with provider_mismatch", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.provider = "xray";
  const result = await adapter.dryRun({
    jobId: "job-1368",
    mode: "dry_run",
    profile,
    preview: buildPreview([buildCase({})]),
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  assert.equal(result.refused, true);
  assert.ok(result.refusalCodes.includes("provider_mismatch"));
});

test("qc-alm-dry-run: missing-mapped-cases refuses without folder resolution", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const result = await adapter.dryRun({
    jobId: "job-1368",
    mode: "dry_run",
    profile: cloneOpenTextAlmDefaultMappingProfile(),
    preview: buildPreview([]),
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  assert.equal(result.refused, true);
  assert.ok(result.refusalCodes.includes("no_mapped_test_cases"));
  assert.equal(result.plannedPayloads.length, 0);
});

test("qc-alm-dry-run: REGRESSION — folder resolver is read-only and not invoked for write-shaped paths", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const writeShapedCalls: string[] = [];
  const recordingResolver: QcFolderResolver = {
    assertReadOnly: true,
    resolve: (input) => {
      // Any caller that ever attaches an HTTP client to this resolver MUST
      // funnel through this single point. We assert the input shape never
      // carries write-shaped intent — there's no `mode: "create"` etc.
      const keys = Object.keys(input);
      for (const k of keys) {
        const v = (input as Record<string, unknown>)[k];
        if (typeof v === "string" && /\b(POST|PUT|DELETE|PATCH)\b/.test(v)) {
          writeShapedCalls.push(k);
        }
      }
      return { state: "simulated", evidence: "resolver:noop" };
    },
  };
  const result = await adapter.dryRun({
    jobId: "job-1368",
    mode: "dry_run",
    profile: cloneOpenTextAlmDefaultMappingProfile(),
    preview: buildPreview([buildCase({})]),
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
    folderResolver: recordingResolver,
  });
  assert.equal(result.refused, false);
  assert.equal(writeShapedCalls.length, 0);
  // The default and recording resolvers MUST share the assertReadOnly flag.
  assert.equal(DEFAULT_FOLDER_RESOLVER.assertReadOnly, true);
  assert.equal(recordingResolver.assertReadOnly, true);
});

test("qc-alm-dry-run: low-confidence visual sidecar flags the affected case", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const visual = visualReport(0.4, ["low_confidence"]);
  const result = await adapter.dryRun({
    jobId: "job-1368",
    mode: "dry_run",
    profile: cloneOpenTextAlmDefaultMappingProfile(),
    preview: buildPreview([buildCase({})], visual),
    visual,
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  assert.equal(result.refused, false);
  assert.equal(result.visualEvidenceFlags.length, 1);
  const flag = result.visualEvidenceFlags[0];
  assert.ok(flag);
  assert.equal(flag.testCaseId, "tc-1");
  assert.equal(flag.reason, "visual_only_low_confidence_mapping");
  assert.deepEqual(flag.screenIds, ["s-payment"]);
  assert.ok(flag.sidecarConfidence < 0.6);
  assert.ok(flag.ambiguityFlags.includes("low_confidence"));
  assert.equal(flag.traceRefs[0]?.screenId, "s-payment");
});

test("qc-alm-dry-run: high-confidence visual sidecar produces no flags", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const visual = visualReport(0.91, ["ok"]);
  const result = await adapter.dryRun({
    jobId: "job-1368",
    mode: "dry_run",
    profile: cloneOpenTextAlmDefaultMappingProfile(),
    preview: buildPreview([buildCase({})], visual),
    visual,
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  assert.equal(result.visualEvidenceFlags.length, 0);
});

test("qc-alm-dry-run: visualConfidenceThreshold override works", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const visual = visualReport(0.7, ["ok"]);
  const result = await adapter.dryRun({
    jobId: "job-1368",
    mode: "dry_run",
    profile: cloneOpenTextAlmDefaultMappingProfile(),
    preview: buildPreview([buildCase({})], visual),
    visual,
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
    visualConfidenceThreshold: 0.95,
  });
  assert.equal(result.visualEvidenceFlags.length, 1);
});

test("qc-alm-dry-run: completeness reflects unexportable cases as incomplete", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const cases = [
    buildCase({ id: "tc-ok" }),
    buildCase({
      id: "tc-blocked",
      qcMappingPreview: {
        exportable: false,
        blockingReasons: ["regulated_risk_review_required"],
      },
    }),
  ];
  const result = await adapter.dryRun({
    jobId: "job-1368",
    mode: "dry_run",
    profile: cloneOpenTextAlmDefaultMappingProfile(),
    preview: buildPreview(cases),
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  assert.equal(result.refused, false);
  assert.equal(result.completeness.totalCases, 2);
  assert.equal(result.completeness.completeCases, 1);
  assert.equal(result.completeness.incompleteCases, 1);
  const incomplete = result.completeness.perCase.find(
    (c) => c.testCaseId === "tc-blocked",
  );
  assert.ok(incomplete);
  assert.ok((incomplete?.missingRequiredFields.length ?? 0) > 0);
});

test("qc-alm-dry-run: resolver throwing degrades to folder_resolution_failed without exposing message", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const result = await adapter.dryRun({
    jobId: "job-1368",
    mode: "dry_run",
    profile: cloneOpenTextAlmDefaultMappingProfile(),
    preview: buildPreview([buildCase({})]),
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
    folderResolver: {
      assertReadOnly: true,
      resolve: () => {
        throw new Error("resolver-internal token=abc123");
      },
    },
  });
  assert.equal(result.refused, true);
  assert.ok(result.refusalCodes.includes("folder_resolution_failed"));
  // The error message is intentionally NOT surfaced to evidence.
  assert.equal(result.folderResolution.evidence, "resolver_threw");
  assert.doesNotMatch(JSON.stringify(result), /token=abc123/);
});
