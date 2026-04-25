/**
 * Golden test for the OpenText ALM dry-run report (Issue #1368).
 *
 * Builds a deterministic input bundle with two mapped test cases and a
 * matching low-confidence visual sidecar record, runs the dry-run
 * adapter, and asserts byte-identity against
 * `fixtures/dry-run/issue-1368.expected.dry-run-report.json`.
 *
 * Re-record by running with `FIGMAPIPE_TEST_INTELLIGENCE_GOLDEN_APPROVE=1`.
 */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import { canonicalJson } from "./content-hash.js";
import { buildQcMappingPreview } from "./qc-mapping.js";
import {
  createFixedClock,
  createOpenTextAlmDryRunAdapter,
  DEFAULT_DRY_RUN_ID_SOURCE,
} from "./qc-alm-dry-run.js";
import { cloneOpenTextAlmDefaultMappingProfile } from "./qc-alm-mapping-profile.js";

const FIXTURES_DIR = join(
  new URL(".", import.meta.url).pathname,
  "fixtures",
  "dry-run",
);
const FIXTURE_NAME = "issue-1368.expected.dry-run-report.json";

const APPROVE =
  process.env["FIGMAPIPE_TEST_INTELLIGENCE_GOLDEN_APPROVE"] === "1";

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
  id: "tc-base",
  sourceJobId: "job-1368-golden",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "T",
  objective: "O",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "regulated_data",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "Open form", expected: "Form visible" }],
  expectedResults: ["OK"],
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
    jobId: "job-1368-golden",
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
  jobId: "job-1368-golden",
  testCases: cases,
});

const emptyPolicy = (count: number): TestCasePolicyReport => ({
  schemaVersion: "1.0.0",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1368-golden",
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

const buildPreview = (
  cases: GeneratedTestCase[],
  visual: VisualSidecarValidationReport,
): QcMappingPreviewArtifact =>
  buildQcMappingPreview({
    jobId: "job-1368-golden",
    generatedAt: GENERATED_AT,
    list: buildList(cases),
    intent: buildIntent(),
    policy: emptyPolicy(cases.length),
    visual,
  });

const buildVisual = (): VisualSidecarValidationReport => ({
  schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1368-golden",
  totalScreens: 1,
  screensWithFindings: 1,
  blocked: false,
  records: [
    {
      screenId: "s-payment",
      deployment: "llama-4-maverick-vision",
      outcomes: ["low_confidence"],
      issues: [],
      meanConfidence: 0.42,
    },
  ],
});

test("golden: dry-run adapter emits byte-identical dry-run-report.json", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const visual = buildVisual();
  const cases = [
    buildCase({
      id: "tc-pay-1",
      title: "Pay with valid IBAN",
      objective: "Confirm valid IBAN is accepted",
    }),
    buildCase({
      id: "tc-pay-2",
      title: "Reject invalid IBAN",
      objective: "Confirm invalid IBAN is rejected",
    }),
  ];
  const result = await adapter.dryRun({
    jobId: "job-1368-golden",
    mode: "dry_run",
    profile: cloneOpenTextAlmDefaultMappingProfile(),
    preview: buildPreview(cases, visual),
    visual,
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });

  assert.equal(result.refused, false);
  const serialized = canonicalJson(result);

  await mkdir(FIXTURES_DIR, { recursive: true });
  const path = join(FIXTURES_DIR, FIXTURE_NAME);
  if (APPROVE) {
    await writeFile(path, serialized, "utf8");
    return;
  }
  const expected = await readFile(path, "utf8");
  assert.equal(
    serialized,
    expected,
    `golden ${FIXTURE_NAME} drifted — re-run with FIGMAPIPE_TEST_INTELLIGENCE_GOLDEN_APPROVE=1`,
  );
});
