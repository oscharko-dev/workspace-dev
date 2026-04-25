/**
 * QC mapping preview builder (Issue #1365).
 *
 * Translates a set of generated test cases plus their policy decisions and
 * (optional) visual sidecar provenance into the deterministic QC mapping
 * preview structure consumed by the export pipeline. The mapping carries
 * all minimum fields demanded by the issue body:
 *
 *   - test name / objective
 *   - priority / risk category
 *   - preconditions / test data
 *   - ordered design steps + per-step expected results (already on case)
 *   - target folder path
 *   - external id candidate for later idempotent transfer
 *   - source trace metadata
 *   - visual provenance (deployment, fallback reason, confidence summary,
 *     ambiguity count, evidence hash) — never raw screenshots
 *
 * The builder is pure: same inputs always produce byte-identical output.
 */

import {
  OPENTEXT_ALM_REFERENCE_PROFILE_ID,
  OPENTEXT_ALM_REFERENCE_PROFILE_VERSION,
  QC_MAPPING_PREVIEW_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type OpenTextAlmExportProfile,
  type QcMappingPreviewArtifact,
  type QcMappingPreviewEntry,
  type QcMappingVisualProvenance,
  type TestCasePolicyDecisionRecord,
  type TestCasePolicyReport,
  type VisualSidecarValidationRecord,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import { sha256Hex } from "./content-hash.js";

const EXTERNAL_ID_DIGEST_LENGTH = 16;

const FOLDER_SEGMENT_REGEX = /[^A-Za-z0-9._-]+/g;

/** Built-in OpenText ALM reference export profile. */
export const OPENTEXT_ALM_REFERENCE_PROFILE: Readonly<OpenTextAlmExportProfile> =
  Object.freeze({
    id: OPENTEXT_ALM_REFERENCE_PROFILE_ID,
    version: OPENTEXT_ALM_REFERENCE_PROFILE_VERSION,
    description:
      "OpenText ALM reference export profile: deterministic XML with subject folder hierarchy derived from screen name + risk category, candidate ExternalId derived from job/case/profile triple, no screenshots, no API keys.",
    rootFolderPath: "/Subject",
    cdataDescription: true,
  });

/** Return a deep-cloned mutable copy of the built-in OpenText ALM profile. */
export const cloneOpenTextAlmReferenceProfile =
  (): OpenTextAlmExportProfile => ({
    id: OPENTEXT_ALM_REFERENCE_PROFILE.id,
    version: OPENTEXT_ALM_REFERENCE_PROFILE.version,
    description: OPENTEXT_ALM_REFERENCE_PROFILE.description,
    rootFolderPath: OPENTEXT_ALM_REFERENCE_PROFILE.rootFolderPath,
    cdataDescription: OPENTEXT_ALM_REFERENCE_PROFILE.cdataDescription,
  });

const sanitizeFolderSegment = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "Unspecified";
  const replaced = trimmed.replace(FOLDER_SEGMENT_REGEX, "-");
  // collapse runs of dashes and trim leading/trailing dashes
  const collapsed = replaced.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return collapsed.length > 0 ? collapsed : "Unspecified";
};

/**
 * Determine the QC subject folder path for a test case under the given
 * profile. The path always starts with `profile.rootFolderPath`, then
 * `<sanitized screen>/`, then `<risk-category>`. Cases without a screen
 * trace fall back to `_unmapped`.
 */
export const buildTargetFolderPath = (input: {
  profile: OpenTextAlmExportProfile;
  testCase: GeneratedTestCase;
  intent: BusinessTestIntentIr;
}): string => {
  const profileRoot = input.profile.rootFolderPath.replace(/\/+$/u, "");
  const screenIds = new Set(
    input.testCase.figmaTraceRefs.map((ref) => ref.screenId),
  );
  let screenSegment = "_unmapped";
  if (screenIds.size > 0) {
    const screenNames = input.intent.screens
      .filter((s) => screenIds.has(s.screenId))
      .map((s) => s.screenName)
      .sort();
    if (screenNames.length > 0) {
      screenSegment = sanitizeFolderSegment(screenNames[0] as string);
    }
  }
  const riskSegment = sanitizeFolderSegment(input.testCase.riskCategory);
  return `${profileRoot}/${screenSegment}/${riskSegment}`;
};

/**
 * Compute the deterministic candidate external id for a test case.
 *
 * The id is the first `EXTERNAL_ID_DIGEST_LENGTH` hex chars of
 * SHA-256(`${jobId}|${testCaseId}|${profileId}|${profileVersion}`).
 * Truncation is acceptable for an idempotency hint; collisions are
 * surfaced by upstream QC tooling.
 */
export const computeExternalIdCandidate = (input: {
  jobId: string;
  testCaseId: string;
  profile: Pick<OpenTextAlmExportProfile, "id" | "version">;
}): string => {
  const seed = `${input.jobId}|${input.testCaseId}|${input.profile.id}|${input.profile.version}`;
  return sha256Hex(seed).slice(0, EXTERNAL_ID_DIGEST_LENGTH);
};

const buildVisualProvenance = (
  testCase: GeneratedTestCase,
  visual: VisualSidecarValidationReport | undefined,
): QcMappingVisualProvenance | undefined => {
  if (!visual) return undefined;
  const screenIds = new Set(testCase.figmaTraceRefs.map((ref) => ref.screenId));
  if (screenIds.size === 0) return undefined;
  const matching: VisualSidecarValidationRecord[] = visual.records
    .filter((r) => screenIds.has(r.screenId))
    .slice()
    .sort((a, b) => a.screenId.localeCompare(b.screenId));
  if (matching.length === 0) return undefined;

  const deployments = Array.from(new Set(matching.map((m) => m.deployment)));
  const deployment: QcMappingVisualProvenance["deployment"] =
    deployments.length === 1
      ? (deployments[0] as QcMappingVisualProvenance["deployment"])
      : "mock";

  const fallbackReason: QcMappingVisualProvenance["fallbackReason"] =
    matching.some((m) => m.outcomes.includes("fallback_used"))
      ? "primary_unavailable"
      : matching.some((m) => m.outcomes.includes("primary_unavailable"))
        ? "primary_unavailable"
        : "none";

  let confidenceSum = 0;
  for (const m of matching) {
    confidenceSum += m.meanConfidence;
  }
  const confidenceMean =
    matching.length > 0 ? confidenceSum / matching.length : 0;

  let ambiguityCount = 0;
  for (const m of matching) {
    ambiguityCount += m.issues.length;
  }
  if (testCase.qualitySignals.ambiguity) {
    ambiguityCount += 1;
  }

  const provenanceSeed = matching
    .map(
      (m) =>
        `${m.screenId}|${m.deployment}|${m.outcomes.slice().sort().join(",")}|${m.meanConfidence.toFixed(6)}`,
    )
    .join("\n");
  const evidenceHash = sha256Hex(provenanceSeed);

  return {
    deployment,
    fallbackReason,
    confidenceMean,
    ambiguityCount,
    evidenceHash,
  };
};

const buildEntry = (input: {
  jobId: string;
  testCase: GeneratedTestCase;
  intent: BusinessTestIntentIr;
  profile: OpenTextAlmExportProfile;
  policyDecision: TestCasePolicyDecisionRecord | undefined;
  visual?: VisualSidecarValidationReport;
}): QcMappingPreviewEntry => {
  const folder = buildTargetFolderPath({
    profile: input.profile,
    testCase: input.testCase,
    intent: input.intent,
  });
  const externalIdCandidate = computeExternalIdCandidate({
    jobId: input.jobId,
    testCaseId: input.testCase.id,
    profile: { id: input.profile.id, version: input.profile.version },
  });
  const visualProvenance = buildVisualProvenance(input.testCase, input.visual);

  const blockingFromCase: string[] = (
    input.testCase.qcMappingPreview.blockingReasons ?? []
  ).slice();
  const blockingFromPolicy: string[] = (input.policyDecision?.violations ?? [])
    .filter((v) => v.severity === "error")
    .map((v) => `policy:${v.outcome}`);
  const blockingReasons = Array.from(
    new Set([...blockingFromCase, ...blockingFromPolicy]),
  ).sort();
  const exportable =
    input.testCase.qcMappingPreview.exportable && blockingReasons.length === 0;

  const entry: QcMappingPreviewEntry = {
    testCaseId: input.testCase.id,
    externalIdCandidate,
    testName: input.testCase.title,
    objective: input.testCase.objective,
    priority: input.testCase.priority,
    riskCategory: input.testCase.riskCategory,
    targetFolderPath: folder,
    preconditions: input.testCase.preconditions.slice(),
    testData: input.testCase.testData.slice(),
    designSteps: input.testCase.steps
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((step) => ({
        index: step.index,
        action: step.action,
        ...(step.data !== undefined ? { data: step.data } : {}),
        ...(step.expected !== undefined ? { expected: step.expected } : {}),
      })),
    expectedResults: input.testCase.expectedResults.slice(),
    sourceTraceRefs: input.testCase.figmaTraceRefs
      .slice()
      .sort((a, b) =>
        `${a.screenId}|${a.nodeId ?? ""}`.localeCompare(
          `${b.screenId}|${b.nodeId ?? ""}`,
        ),
      ),
    exportable,
    blockingReasons,
  };
  if (visualProvenance) entry.visualProvenance = visualProvenance;
  return entry;
};

export interface BuildQcMappingPreviewInput {
  jobId: string;
  generatedAt: string;
  list: GeneratedTestCaseList;
  intent: BusinessTestIntentIr;
  policy: TestCasePolicyReport;
  visual?: VisualSidecarValidationReport;
  profile?: OpenTextAlmExportProfile;
}

/** Build the deterministic QC mapping preview artifact. */
export const buildQcMappingPreview = (
  input: BuildQcMappingPreviewInput,
): QcMappingPreviewArtifact => {
  const profile = input.profile ?? cloneOpenTextAlmReferenceProfile();
  const decisions = new Map<string, TestCasePolicyDecisionRecord>();
  for (const d of input.policy.decisions) {
    decisions.set(d.testCaseId, d);
  }
  const entries = input.list.testCases
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((tc) =>
      buildEntry({
        jobId: input.jobId,
        testCase: tc,
        intent: input.intent,
        profile,
        policyDecision: decisions.get(tc.id),
        ...(input.visual !== undefined ? { visual: input.visual } : {}),
      }),
    );
  return {
    schemaVersion: QC_MAPPING_PREVIEW_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    profileId: profile.id,
    profileVersion: profile.version,
    entries,
  };
};
