/**
 * Read-only Inspector bundle assembler (Issue #1367).
 *
 * Aggregates the on-disk Wave 1 + Wave 2 test-intelligence artifacts for a
 * single jobId into one composite read view that the Inspector UI consumes.
 * The bundle is a UI affordance only: it never mutates any artifact, never
 * re-opens a sealed run, and never embeds raw screenshot bytes (the source
 * artifacts already enforce that invariant).
 *
 * Directory layout (matches the on-disk emitters):
 *
 *   <rootDir>/<jobId>/
 *     generated-testcases.json                  (validation pipeline)
 *     validation-report.json                    (validation pipeline)
 *     policy-report.json                        (policy gate)
 *     coverage-report.json                      (coverage report)
 *     visual-sidecar-validation-report.json     (optional, sidecar gate)
 *     qc-mapping-preview.json                   (optional, export pipeline)
 *     export-report.json                        (optional, export pipeline)
 *     review-state.json                         (review store snapshot)
 *     review-events.json                        (review store event log)
 *
 * Missing artifacts produce `undefined` fields rather than failing — the
 * Inspector renders empty / partial-result states for any combination.
 * Malformed JSON / type-guard mismatches are surfaced as `parseErrors`
 * so the UI can show "this artifact could not be parsed" without losing
 * the rest of the bundle.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  EXPORT_REPORT_ARTIFACT_FILENAME,
  EXPORT_REPORT_SCHEMA_VERSION,
  GENERATED_TESTCASES_ARTIFACT_FILENAME,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  QC_MAPPING_PREVIEW_ARTIFACT_FILENAME,
  QC_MAPPING_PREVIEW_SCHEMA_VERSION,
  REVIEW_EVENTS_ARTIFACT_FILENAME,
  REVIEW_GATE_SCHEMA_VERSION,
  REVIEW_STATE_ARTIFACT_FILENAME,
  TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION,
  TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
  TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  type ExportReportArtifact,
  type GeneratedTestCaseList,
  type QcMappingPreviewArtifact,
  type ReviewEvent,
  type ReviewGateSnapshot,
  type TestCaseCoverageReport,
  type TestCasePolicyReport,
  type TestCaseValidationReport,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";

/** Stable identifier of a single artifact slot in the bundle. */
export type InspectorBundleArtifactKind =
  | "generatedTestCases"
  | "validationReport"
  | "policyReport"
  | "coverageReport"
  | "visualSidecarReport"
  | "qcMappingPreview"
  | "exportReport"
  | "reviewSnapshot"
  | "reviewEvents";

/** Single parse error attached to an artifact slot. */
export interface InspectorBundleParseError {
  artifact: InspectorBundleArtifactKind;
  filename: string;
  reason: "invalid_json" | "schema_mismatch" | "io_error";
  message: string;
}

/**
 * Composite UI-facing read of a single test-intelligence job.
 *
 * Every artifact slot is independently optional. The Inspector renders the
 * union of what is present plus a placeholder for what is missing, so the
 * shape is stable across Wave 1 (validation only) and Wave 2 (review +
 * export) layouts.
 */
export interface InspectorTestIntelligenceBundle {
  jobId: string;
  /** ISO-8601 timestamp at which the bundle was assembled (server clock). */
  assembledAt: string;
  generatedTestCases?: GeneratedTestCaseList;
  validationReport?: TestCaseValidationReport;
  policyReport?: TestCasePolicyReport;
  coverageReport?: TestCaseCoverageReport;
  visualSidecarReport?: VisualSidecarValidationReport;
  qcMappingPreview?: QcMappingPreviewArtifact;
  exportReport?: ExportReportArtifact;
  reviewSnapshot?: ReviewGateSnapshot;
  reviewEvents?: ReviewEvent[];
  /** Per-artifact parse errors. Empty when every present file parsed cleanly. */
  parseErrors: InspectorBundleParseError[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isFlatMetadata = (
  value: unknown,
): value is Record<string, string | number | boolean | null> => {
  if (!isRecord(value)) return false;
  for (const entry of Object.values(value)) {
    if (
      entry !== null &&
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean"
    ) {
      return false;
    }
  }
  return true;
};

const isGeneratedTestCaseList = (
  value: unknown,
): value is GeneratedTestCaseList => {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === GENERATED_TEST_CASE_SCHEMA_VERSION &&
    typeof value["jobId"] === "string" &&
    Array.isArray(value["testCases"])
  );
};

const isValidationReport = (
  value: unknown,
): value is TestCaseValidationReport => {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION &&
    value["contractVersion"] === TEST_INTELLIGENCE_CONTRACT_VERSION &&
    typeof value["jobId"] === "string" &&
    typeof value["totalTestCases"] === "number" &&
    typeof value["errorCount"] === "number" &&
    typeof value["warningCount"] === "number" &&
    typeof value["blocked"] === "boolean" &&
    Array.isArray(value["issues"])
  );
};

const isPolicyReport = (value: unknown): value is TestCasePolicyReport => {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === TEST_CASE_POLICY_REPORT_SCHEMA_VERSION &&
    value["contractVersion"] === TEST_INTELLIGENCE_CONTRACT_VERSION &&
    typeof value["jobId"] === "string" &&
    typeof value["policyProfileId"] === "string" &&
    typeof value["policyProfileVersion"] === "string" &&
    typeof value["totalTestCases"] === "number" &&
    typeof value["approvedCount"] === "number" &&
    typeof value["blockedCount"] === "number" &&
    typeof value["needsReviewCount"] === "number" &&
    typeof value["blocked"] === "boolean" &&
    Array.isArray(value["decisions"]) &&
    Array.isArray(value["jobLevelViolations"])
  );
};

const isCoverageReport = (value: unknown): value is TestCaseCoverageReport => {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION &&
    value["contractVersion"] === TEST_INTELLIGENCE_CONTRACT_VERSION &&
    typeof value["jobId"] === "string" &&
    typeof value["policyProfileId"] === "string" &&
    typeof value["totalTestCases"] === "number" &&
    isRecord(value["fieldCoverage"]) &&
    isRecord(value["actionCoverage"]) &&
    isRecord(value["validationCoverage"]) &&
    isRecord(value["navigationCoverage"]) &&
    isRecord(value["traceCoverage"]) &&
    Array.isArray(value["duplicatePairs"])
  );
};

const isVisualSidecarReport = (
  value: unknown,
): value is VisualSidecarValidationReport => {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] ===
      VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION &&
    value["contractVersion"] === TEST_INTELLIGENCE_CONTRACT_VERSION &&
    value["visualSidecarSchemaVersion"] === VISUAL_SIDECAR_SCHEMA_VERSION &&
    typeof value["jobId"] === "string" &&
    typeof value["totalScreens"] === "number" &&
    typeof value["screensWithFindings"] === "number" &&
    typeof value["blocked"] === "boolean" &&
    Array.isArray(value["records"])
  );
};

const isQcMappingPreview = (
  value: unknown,
): value is QcMappingPreviewArtifact => {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === QC_MAPPING_PREVIEW_SCHEMA_VERSION &&
    value["contractVersion"] === TEST_INTELLIGENCE_CONTRACT_VERSION &&
    typeof value["jobId"] === "string" &&
    typeof value["profileId"] === "string" &&
    typeof value["profileVersion"] === "string" &&
    Array.isArray(value["entries"])
  );
};

const isExportReport = (value: unknown): value is ExportReportArtifact => {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === EXPORT_REPORT_SCHEMA_VERSION &&
    value["contractVersion"] === TEST_INTELLIGENCE_CONTRACT_VERSION &&
    typeof value["jobId"] === "string" &&
    typeof value["profileId"] === "string" &&
    typeof value["profileVersion"] === "string" &&
    typeof value["refused"] === "boolean" &&
    Array.isArray(value["refusalCodes"]) &&
    Array.isArray(value["artifacts"]) &&
    Array.isArray(value["visualEvidenceHashes"]) &&
    value["rawScreenshotsIncluded"] === false
  );
};

const isReviewGateSnapshot = (value: unknown): value is ReviewGateSnapshot => {
  if (!isRecord(value)) return false;
  return (
    value["schemaVersion"] === REVIEW_GATE_SCHEMA_VERSION &&
    value["contractVersion"] === TEST_INTELLIGENCE_CONTRACT_VERSION &&
    typeof value["jobId"] === "string" &&
    typeof value["generatedAt"] === "string" &&
    typeof value["approvedCount"] === "number" &&
    typeof value["needsReviewCount"] === "number" &&
    typeof value["rejectedCount"] === "number" &&
    Array.isArray(value["perTestCase"])
  );
};

const isReviewEvent = (value: unknown): value is ReviewEvent => {
  if (!isRecord(value)) return false;
  if (
    value["schemaVersion"] !== REVIEW_GATE_SCHEMA_VERSION ||
    value["contractVersion"] !== TEST_INTELLIGENCE_CONTRACT_VERSION ||
    typeof value["id"] !== "string" ||
    typeof value["jobId"] !== "string" ||
    typeof value["kind"] !== "string" ||
    typeof value["at"] !== "string" ||
    typeof value["sequence"] !== "number" ||
    !Number.isInteger(value["sequence"])
  ) {
    return false;
  }
  if (
    value["testCaseId"] !== undefined &&
    typeof value["testCaseId"] !== "string"
  ) {
    return false;
  }
  if (value["actor"] !== undefined && typeof value["actor"] !== "string") {
    return false;
  }
  if (value["note"] !== undefined && typeof value["note"] !== "string") {
    return false;
  }
  if (value["metadata"] !== undefined && !isFlatMetadata(value["metadata"])) {
    return false;
  }
  return true;
};

const isReviewEventsEnvelope = (
  value: unknown,
): value is { events: ReviewEvent[] } => {
  if (!isRecord(value)) return false;
  if (
    value["schemaVersion"] !== REVIEW_GATE_SCHEMA_VERSION ||
    value["contractVersion"] !== TEST_INTELLIGENCE_CONTRACT_VERSION ||
    typeof value["jobId"] !== "string" ||
    typeof value["nextSequence"] !== "number" ||
    !Array.isArray(value["events"])
  ) {
    return false;
  }
  return value["events"].every(isReviewEvent);
};

interface ReadResult<T> {
  parsed?: T;
  error?: InspectorBundleParseError;
  missing?: boolean;
}

const isEnoent = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: string }).code === "ENOENT";

const readJsonArtifact = async <T>(
  filePath: string,
  filename: string,
  artifact: InspectorBundleArtifactKind,
  validate: (value: unknown) => value is T,
): Promise<ReadResult<T>> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (isEnoent(err)) {
      return { missing: true };
    }
    return {
      error: {
        artifact,
        filename,
        reason: "io_error",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      error: {
        artifact,
        filename,
        reason: "invalid_json",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  if (!validate(parsed)) {
    return {
      error: {
        artifact,
        filename,
        reason: "schema_mismatch",
        message: `${filename} did not match its expected schema.`,
      },
    };
  }

  return { parsed };
};

/** Resolve `<rootDir>/<jobId>` if the directory exists; otherwise undefined. */
const resolveJobDir = async (
  rootDir: string,
  jobId: string,
): Promise<string | undefined> => {
  const candidate = join(rootDir, jobId);
  try {
    const stats = await stat(candidate);
    return stats.isDirectory() ? candidate : undefined;
  } catch (err) {
    if (isEnoent(err)) return undefined;
    throw err;
  }
};

export interface ReadInspectorBundleInput {
  /** Test-intelligence root directory (e.g. `<outputRoot>/test-intelligence`). */
  rootDir: string;
  jobId: string;
  /** Server-clock ISO-8601 timestamp stamped on the assembled bundle. */
  assembledAt: string;
}

export type ReadInspectorBundleResult =
  | { ok: true; bundle: InspectorTestIntelligenceBundle }
  | { ok: false; reason: "job_not_found" };

/**
 * Read every artifact for one job and return the composite bundle.
 *
 * - If the job directory does not exist at all, returns `{ ok: false }`
 *   so the caller can return 404.
 * - If the directory exists but contains zero recognised artifacts,
 *   returns `{ ok: true }` with an empty bundle so the UI shows the
 *   "no artifacts yet" empty state.
 */
export const readInspectorTestIntelligenceBundle = async (
  input: ReadInspectorBundleInput,
): Promise<ReadInspectorBundleResult> => {
  const jobDir = await resolveJobDir(input.rootDir, input.jobId);
  if (!jobDir) {
    return { ok: false, reason: "job_not_found" };
  }

  const [
    testCases,
    validation,
    policy,
    coverage,
    visual,
    mapping,
    exportReport,
    reviewSnapshot,
    reviewEventsEnvelope,
  ] = await Promise.all([
    readJsonArtifact(
      join(jobDir, GENERATED_TESTCASES_ARTIFACT_FILENAME),
      GENERATED_TESTCASES_ARTIFACT_FILENAME,
      "generatedTestCases",
      isGeneratedTestCaseList,
    ),
    readJsonArtifact(
      join(jobDir, TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME),
      TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
      "validationReport",
      isValidationReport,
    ),
    readJsonArtifact(
      join(jobDir, TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME),
      TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
      "policyReport",
      isPolicyReport,
    ),
    readJsonArtifact(
      join(jobDir, TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME),
      TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
      "coverageReport",
      isCoverageReport,
    ),
    readJsonArtifact(
      join(jobDir, VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME),
      VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
      "visualSidecarReport",
      isVisualSidecarReport,
    ),
    readJsonArtifact(
      join(jobDir, QC_MAPPING_PREVIEW_ARTIFACT_FILENAME),
      QC_MAPPING_PREVIEW_ARTIFACT_FILENAME,
      "qcMappingPreview",
      isQcMappingPreview,
    ),
    readJsonArtifact(
      join(jobDir, EXPORT_REPORT_ARTIFACT_FILENAME),
      EXPORT_REPORT_ARTIFACT_FILENAME,
      "exportReport",
      isExportReport,
    ),
    readJsonArtifact(
      join(jobDir, REVIEW_STATE_ARTIFACT_FILENAME),
      REVIEW_STATE_ARTIFACT_FILENAME,
      "reviewSnapshot",
      isReviewGateSnapshot,
    ),
    readJsonArtifact(
      join(jobDir, REVIEW_EVENTS_ARTIFACT_FILENAME),
      REVIEW_EVENTS_ARTIFACT_FILENAME,
      "reviewEvents",
      isReviewEventsEnvelope,
    ),
  ]);

  const parseErrors: InspectorBundleParseError[] = [];
  const collect = (result: ReadResult<unknown>): void => {
    if (result.error) {
      parseErrors.push(result.error);
    }
  };
  collect(testCases);
  collect(validation);
  collect(policy);
  collect(coverage);
  collect(visual);
  collect(mapping);
  collect(exportReport);
  collect(reviewSnapshot);
  collect(reviewEventsEnvelope);

  const bundle: InspectorTestIntelligenceBundle = {
    jobId: input.jobId,
    assembledAt: input.assembledAt,
    parseErrors,
    ...(testCases.parsed ? { generatedTestCases: testCases.parsed } : {}),
    ...(validation.parsed ? { validationReport: validation.parsed } : {}),
    ...(policy.parsed ? { policyReport: policy.parsed } : {}),
    ...(coverage.parsed ? { coverageReport: coverage.parsed } : {}),
    ...(visual.parsed ? { visualSidecarReport: visual.parsed } : {}),
    ...(mapping.parsed ? { qcMappingPreview: mapping.parsed } : {}),
    ...(exportReport.parsed ? { exportReport: exportReport.parsed } : {}),
    ...(reviewSnapshot.parsed ? { reviewSnapshot: reviewSnapshot.parsed } : {}),
    ...(reviewEventsEnvelope.parsed
      ? { reviewEvents: reviewEventsEnvelope.parsed.events }
      : {}),
  };

  return { ok: true, bundle };
};

/** Lightweight summary entry used by the Inspector job list. */
export interface InspectorTestIntelligenceJobSummary {
  jobId: string;
  /** Whether each artifact slot has at least one parseable file on disk. */
  hasArtifacts: Record<InspectorBundleArtifactKind, boolean>;
}

/**
 * List every job directory under `rootDir` whose name passes the safe-id
 * filter and report which artifact slots are present. Used by the Inspector
 * UI's job picker. Does NOT validate artifact contents; it only checks
 * `existsSync`-equivalent semantics so the index is fast.
 */
export const listInspectorTestIntelligenceJobs = async (
  rootDir: string,
): Promise<InspectorTestIntelligenceJobSummary[]> => {
  let entries: string[];
  try {
    entries = await readdir(rootDir);
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }

  const summaries: InspectorTestIntelligenceJobSummary[] = [];
  for (const entry of entries) {
    if (!isSafeJobId(entry)) continue;
    const jobDir = join(rootDir, entry);
    let stats;
    try {
      stats = await stat(jobDir);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;

    let dirEntries: string[];
    try {
      dirEntries = await readdir(jobDir);
    } catch {
      continue;
    }
    if (!isStringArray(dirEntries)) continue;
    const present = new Set(dirEntries);

    summaries.push({
      jobId: entry,
      hasArtifacts: {
        generatedTestCases: present.has(GENERATED_TESTCASES_ARTIFACT_FILENAME),
        validationReport: present.has(
          TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME,
        ),
        policyReport: present.has(TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME),
        coverageReport: present.has(
          TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME,
        ),
        visualSidecarReport: present.has(
          VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME,
        ),
        qcMappingPreview: present.has(QC_MAPPING_PREVIEW_ARTIFACT_FILENAME),
        exportReport: present.has(EXPORT_REPORT_ARTIFACT_FILENAME),
        reviewSnapshot: present.has(REVIEW_STATE_ARTIFACT_FILENAME),
        reviewEvents: present.has(REVIEW_EVENTS_ARTIFACT_FILENAME),
      },
    });
  }

  summaries.sort((a, b) => a.jobId.localeCompare(b.jobId));
  return summaries;
};

const SAFE_JOB_ID = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * Conservative jobId validator. The HTTP route layer applies the same check
 * so server-side path traversal is blocked before any file-system call.
 */
export const isSafeJobId = (value: string): boolean => {
  return SAFE_JOB_ID.test(value) && value !== "." && value !== "..";
};
