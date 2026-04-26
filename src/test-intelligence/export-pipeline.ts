/**
 * Export-only QC artifact pipeline (Issue #1365).
 *
 * Glues together:
 *   - QC mapping preview builder (`qc-mapping`)
 *   - CSV writer (`qc-csv-writer`)
 *   - OpenText ALM reference XML writer (`qc-alm-xml-writer`)
 *   - Optional OOXML xlsx writer (`qc-xlsx-writer`)
 *   - Review-gate snapshot (only `approved`-state cases reach export)
 *
 * The pipeline is fail-closed: if ANY blocking precondition is unmet
 * (no approved cases, residual unapproved/blocked/schema-invalid cases,
 * blocked visual sidecar, inconsistent review state), the pipeline
 * refuses to emit any non-report artifact and writes only
 * `export-report.json` documenting the refusal codes.
 *
 * No production QC/ALM API call is performed — the pipeline only writes
 * deterministic on-disk artifacts. Operators bridge the artifacts to
 * their QC tool of choice out-of-band.
 */

import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  EXPORT_REPORT_ARTIFACT_FILENAME,
  EXPORT_REPORT_SCHEMA_VERSION,
  EXPORT_TESTCASES_ALM_XML_ARTIFACT_FILENAME,
  EXPORT_TESTCASES_CSV_ARTIFACT_FILENAME,
  EXPORT_TESTCASES_JSON_ARTIFACT_FILENAME,
  EXPORT_TESTCASES_XLSX_ARTIFACT_FILENAME,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  QC_MAPPING_PREVIEW_ARTIFACT_FILENAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type BusinessTestIntentIr,
  type ExportArtifactRecord,
  type ExportRefusalCode,
  type ExportReportArtifact,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type OpenTextAlmExportProfile,
  type QcMappingPreviewArtifact,
  type ReviewGateSnapshot,
  type TestCasePolicyReport,
  type TestCaseValidationReport,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  buildQcMappingPreview,
  cloneOpenTextAlmReferenceProfile,
} from "./qc-mapping.js";
import { renderQcAlmXml } from "./qc-alm-xml-writer.js";
import { renderQcCsv } from "./qc-csv-writer.js";
import { renderQcXlsx } from "./qc-xlsx-writer.js";
import {
  effectiveSemanticContentBlock,
  filterSemanticContentOverridesForValidation,
  type SemanticContentOverrideMap,
} from "./semantic-content-sanitization.js";

const utf8Encoder = new TextEncoder();

export interface RunExportPipelineInput {
  jobId: string;
  generatedAt: string;
  intent: BusinessTestIntentIr;
  list: GeneratedTestCaseList;
  validation: TestCaseValidationReport;
  policy: TestCasePolicyReport;
  visual?: VisualSidecarValidationReport;
  reviewSnapshot: ReviewGateSnapshot;
  /** Override the built-in OpenText ALM reference profile. */
  profile?: OpenTextAlmExportProfile;
  /** Whether to emit the optional `testcases.xlsx` artifact. */
  enableXlsx?: boolean;
  /** Identity of the structured-test-case generator deployment. */
  testGenerationDeployment?: string;
  /**
   * Active reviewer overrides for semantic suspicious-content findings. The
   * raw validation report remains audit-preserving; export uses this map only
   * to compute whether validation is still effectively blocking.
   */
  semanticContentOverrides?: SemanticContentOverrideMap;
}

export interface ExportPipelineArtifacts {
  /** Sorted, exportable list of test cases (state = approved/exported). */
  exportedTestCases: GeneratedTestCase[];
  /** Final review-gate snapshot after `exported` transitions are applied. */
  reviewSnapshot: ReviewGateSnapshot;
  /** QC mapping preview (always emitted unless refusal occurred upstream). */
  preview: QcMappingPreviewArtifact;
  /** Persistable export-report artifact. */
  report: ExportReportArtifact;
  /** Rendered byte buffers, populated only when `report.refused === false`. */
  payloads: {
    json?: Uint8Array;
    csv?: Uint8Array;
    almXml?: Uint8Array;
    xlsx?: Uint8Array;
    qcMappingPreview?: Uint8Array;
  };
  /** True when the pipeline refused to emit any non-report artifact. */
  refused: boolean;
  refusalCodes: ExportRefusalCode[];
}

const buildArtifactRecord = (
  filename: string,
  payload: Uint8Array,
  contentType: ExportArtifactRecord["contentType"],
): ExportArtifactRecord => {
  return {
    filename,
    sha256: sha256Hex(Buffer.from(payload).toString("binary")),
    bytes: payload.length,
    contentType,
  };
};

const detectRefusalCodes = (
  input: RunExportPipelineInput,
): ExportRefusalCode[] => {
  const codes = new Set<ExportRefusalCode>();
  const validationBlocked =
    input.semanticContentOverrides === undefined
      ? input.validation.blocked
      : effectiveSemanticContentBlock(
          input.validation,
          filterSemanticContentOverridesForValidation(
            input.validation,
            input.semanticContentOverrides,
          ),
        );
  if (validationBlocked) {
    codes.add("schema_invalid_cases_present");
  }
  if (input.policy.blocked) {
    codes.add("policy_blocked_cases_present");
  }
  if (input.visual?.blocked === true) {
    codes.add("visual_sidecar_blocked");
  }
  if (input.reviewSnapshot.approvedCount === 0) {
    codes.add("no_approved_test_cases");
  }
  // Per-case consistency: any case present in the generated list whose
  // review snapshot state is NOT in {approved, exported, transferred,
  // rejected} blocks the pipeline.
  const reviewById = new Map(
    input.reviewSnapshot.perTestCase.map((entry) => [entry.testCaseId, entry]),
  );
  let unapprovedNonRejectedPresent = false;
  let unknownReviewState = false;
  let inconsistentFourEyesApproval = false;
  for (const tc of input.list.testCases) {
    const snapshot = reviewById.get(tc.id);
    if (!snapshot) {
      unknownReviewState = true;
      continue;
    }
    if (
      snapshot.state !== "approved" &&
      snapshot.state !== "exported" &&
      snapshot.state !== "transferred" &&
      snapshot.state !== "rejected"
    ) {
      unapprovedNonRejectedPresent = true;
    }
    if (
      snapshot.fourEyesEnforced &&
      (snapshot.state === "approved" ||
        snapshot.state === "exported" ||
        snapshot.state === "transferred")
    ) {
      const primary = snapshot.primaryReviewer;
      const secondary = snapshot.secondaryReviewer;
      if (
        primary === undefined ||
        secondary === undefined ||
        primary === secondary ||
        snapshot.primaryApprovalAt === undefined ||
        snapshot.secondaryApprovalAt === undefined ||
        !snapshot.approvers.includes(primary) ||
        !snapshot.approvers.includes(secondary)
      ) {
        inconsistentFourEyesApproval = true;
      }
    }
  }
  if (unapprovedNonRejectedPresent) {
    codes.add("unapproved_test_cases_present");
  }
  if (unknownReviewState || inconsistentFourEyesApproval) {
    codes.add("review_state_inconsistent");
  }
  return Array.from(codes).sort();
};

const buildExportedTestCases = (
  list: GeneratedTestCaseList,
  reviewSnapshot: ReviewGateSnapshot,
  preview: QcMappingPreviewArtifact,
): GeneratedTestCase[] => {
  const exportableIds = new Set(
    reviewSnapshot.perTestCase
      .filter(
        (e) =>
          e.state === "approved" ||
          e.state === "exported" ||
          e.state === "transferred",
      )
      .map((e) => e.testCaseId),
  );
  const previewById = new Map(preview.entries.map((e) => [e.testCaseId, e]));
  return list.testCases
    .filter((tc) => exportableIds.has(tc.id))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((tc) => {
      const previewEntry = previewById.get(tc.id);
      const updated: GeneratedTestCase = {
        ...tc,
        qcMappingPreview: {
          ...tc.qcMappingPreview,
          exportable:
            previewEntry?.exportable ?? tc.qcMappingPreview.exportable,
          ...(previewEntry?.blockingReasons.length
            ? { blockingReasons: previewEntry.blockingReasons.slice() }
            : tc.qcMappingPreview.blockingReasons !== undefined
              ? { blockingReasons: tc.qcMappingPreview.blockingReasons.slice() }
              : {}),
        },
      };
      return updated;
    });
};

const stampSnapshotAsExported = (
  snapshot: ReviewGateSnapshot,
  exportedIds: ReadonlySet<string>,
  generatedAt: string,
): ReviewGateSnapshot => {
  const next = snapshot.perTestCase.map((entry) =>
    entry.state === "approved" && exportedIds.has(entry.testCaseId)
      ? { ...entry, state: "exported" as const, lastEventAt: generatedAt }
      : entry,
  );
  let approvedCount = 0;
  let needsReviewCount = 0;
  let rejectedCount = 0;
  let pendingSecondaryApprovalCount = 0;
  for (const e of next) {
    if (
      e.state === "approved" ||
      e.state === "exported" ||
      e.state === "transferred"
    ) {
      approvedCount += 1;
    } else if (e.state === "needs_review" || e.state === "edited") {
      needsReviewCount += 1;
    } else if (e.state === "pending_secondary_approval") {
      pendingSecondaryApprovalCount += 1;
    } else if (e.state === "rejected") {
      rejectedCount += 1;
    }
  }
  return {
    ...snapshot,
    perTestCase: next,
    approvedCount,
    needsReviewCount,
    rejectedCount,
    pendingSecondaryApprovalCount,
  };
};

const buildRefusedReport = (
  input: RunExportPipelineInput,
  refusalCodes: ExportRefusalCode[],
  preview: QcMappingPreviewArtifact,
): ExportReportArtifact => {
  return {
    schemaVersion: EXPORT_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    profileId: preview.profileId,
    profileVersion: preview.profileVersion,
    modelDeployments: {
      testGeneration: input.testGenerationDeployment ?? "unknown",
    },
    exportedTestCaseCount: 0,
    refused: true,
    refusalCodes,
    artifacts: [],
    visualEvidenceHashes: [],
    rawScreenshotsIncluded: false,
  };
};

/** Run the export pipeline as a pure transform. No filesystem IO. */
export const runExportPipeline = (
  input: RunExportPipelineInput,
): ExportPipelineArtifacts => {
  const profile = input.profile ?? cloneOpenTextAlmReferenceProfile();
  const preview = buildQcMappingPreview({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    list: input.list,
    intent: input.intent,
    policy: input.policy,
    profile,
    ...(input.visual !== undefined ? { visual: input.visual } : {}),
  });

  const refusalCodes = detectRefusalCodes(input);
  if (refusalCodes.length > 0) {
    return {
      exportedTestCases: [],
      reviewSnapshot: input.reviewSnapshot,
      preview,
      report: buildRefusedReport(input, refusalCodes, preview),
      payloads: {},
      refused: true,
      refusalCodes,
    };
  }

  const exportedTestCases = buildExportedTestCases(
    input.list,
    input.reviewSnapshot,
    preview,
  );

  const exportableList: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: input.jobId,
    testCases: exportedTestCases,
  };

  const exportedIds = new Set(exportedTestCases.map((tc) => tc.id));

  const filteredPreview: QcMappingPreviewArtifact = {
    ...preview,
    entries: preview.entries.filter((e) => exportedIds.has(e.testCaseId)),
  };

  const jsonStr = canonicalJson(exportableList);
  const csvStr = renderQcCsv(filteredPreview.entries);
  const almXmlStr = renderQcAlmXml({ preview: filteredPreview, profile });
  const previewJsonStr = canonicalJson(filteredPreview);

  const json = utf8Encoder.encode(jsonStr);
  const csv = utf8Encoder.encode(csvStr);
  const almXml = utf8Encoder.encode(almXmlStr);
  const previewJson = utf8Encoder.encode(previewJsonStr);

  const artifacts: ExportArtifactRecord[] = [
    buildArtifactRecord(
      EXPORT_TESTCASES_JSON_ARTIFACT_FILENAME,
      json,
      "application/json",
    ),
    buildArtifactRecord(
      EXPORT_TESTCASES_CSV_ARTIFACT_FILENAME,
      csv,
      "text/csv",
    ),
    buildArtifactRecord(
      EXPORT_TESTCASES_ALM_XML_ARTIFACT_FILENAME,
      almXml,
      "application/xml",
    ),
    buildArtifactRecord(
      QC_MAPPING_PREVIEW_ARTIFACT_FILENAME,
      previewJson,
      "application/json",
    ),
  ];

  let xlsxBytes: Uint8Array | undefined;
  if (input.enableXlsx === true) {
    const xlsxBuffer = renderQcXlsx(filteredPreview.entries);
    xlsxBytes = new Uint8Array(
      xlsxBuffer.buffer,
      xlsxBuffer.byteOffset,
      xlsxBuffer.byteLength,
    );
    artifacts.push(
      buildArtifactRecord(
        EXPORT_TESTCASES_XLSX_ARTIFACT_FILENAME,
        xlsxBytes,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    );
  }

  artifacts.sort((a, b) => a.filename.localeCompare(b.filename));

  const visualEvidenceHashes = Array.from(
    new Set(
      filteredPreview.entries
        .map((e) => e.visualProvenance?.evidenceHash)
        .filter((h): h is string => typeof h === "string" && h.length > 0),
    ),
  ).sort();

  const updatedSnapshot = stampSnapshotAsExported(
    input.reviewSnapshot,
    exportedIds,
    input.generatedAt,
  );

  const report: ExportReportArtifact = {
    schemaVersion: EXPORT_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    profileId: profile.id,
    profileVersion: profile.version,
    modelDeployments: {
      testGeneration: input.testGenerationDeployment ?? "unknown",
      ...(input.visual !== undefined && input.visual.records.length > 0
        ? buildVisualDeploymentSummary(input.visual)
        : {}),
    },
    exportedTestCaseCount: exportedTestCases.length,
    refused: false,
    refusalCodes: [],
    artifacts,
    visualEvidenceHashes,
    rawScreenshotsIncluded: false,
  };

  const payloads: ExportPipelineArtifacts["payloads"] = {
    json,
    csv,
    almXml,
    qcMappingPreview: previewJson,
  };
  if (xlsxBytes) payloads.xlsx = xlsxBytes;

  return {
    exportedTestCases,
    reviewSnapshot: updatedSnapshot,
    preview: filteredPreview,
    report,
    payloads,
    refused: false,
    refusalCodes: [],
  };
};

type VisualDeployment = NonNullable<
  ExportReportArtifact["modelDeployments"]["visualPrimary"]
>;

const buildVisualDeploymentSummary = (
  visual: VisualSidecarValidationReport,
): {
  visualPrimary?: VisualDeployment;
  visualFallback?: VisualDeployment;
} => {
  const deployments = Array.from(
    new Set(visual.records.map((r) => r.deployment)),
  ) as VisualDeployment[];
  const fallbackUsed = visual.records.some((r) =>
    r.outcomes.includes("fallback_used"),
  );
  const out: {
    visualPrimary?: VisualDeployment;
    visualFallback?: VisualDeployment;
  } = {};
  const primary = deployments[0];
  const fallback = deployments[1];
  if (primary !== undefined) {
    out.visualPrimary = primary;
  }
  if (fallback !== undefined) {
    out.visualFallback = fallback;
  } else if (fallbackUsed) {
    out.visualFallback = "none";
  }
  return out;
};

export interface WriteExportPipelineArtifactsInput {
  artifacts: ExportPipelineArtifacts;
  destinationDir: string;
}

export interface WriteExportPipelineArtifactsResult {
  exportReportPath: string;
  testcasesJsonPath?: string;
  testcasesCsvPath?: string;
  testcasesXlsxPath?: string;
  testcasesAlmXmlPath?: string;
  qcMappingPreviewPath?: string;
}

const writeAtomic = async (
  destinationPath: string,
  bytes: Uint8Array,
): Promise<void> => {
  const tmp = `${destinationPath}.${process.pid}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, destinationPath);
};

const ensureSizeMatches = async (
  destinationPath: string,
  expectedBytes: number,
): Promise<void> => {
  const fileStat = await stat(destinationPath);
  if (fileStat.size !== expectedBytes) {
    throw new Error(
      `export-pipeline: byte mismatch on persist for ${destinationPath} (expected ${expectedBytes}, got ${fileStat.size})`,
    );
  }
};

/** Persist the export-pipeline artifacts. Refused runs only emit `export-report.json`. */
export const writeExportPipelineArtifacts = async (
  input: WriteExportPipelineArtifactsInput,
): Promise<WriteExportPipelineArtifactsResult> => {
  await mkdir(input.destinationDir, { recursive: true });

  const reportPath = join(
    input.destinationDir,
    EXPORT_REPORT_ARTIFACT_FILENAME,
  );
  const reportBytes = utf8Encoder.encode(canonicalJson(input.artifacts.report));
  await writeAtomic(reportPath, reportBytes);
  await ensureSizeMatches(reportPath, reportBytes.length);

  const result: WriteExportPipelineArtifactsResult = {
    exportReportPath: reportPath,
  };

  if (input.artifacts.refused) {
    return result;
  }

  const writes: Promise<void>[] = [];

  if (input.artifacts.payloads.json) {
    const path = join(
      input.destinationDir,
      EXPORT_TESTCASES_JSON_ARTIFACT_FILENAME,
    );
    writes.push(writeAtomic(path, input.artifacts.payloads.json));
    result.testcasesJsonPath = path;
  }
  if (input.artifacts.payloads.csv) {
    const path = join(
      input.destinationDir,
      EXPORT_TESTCASES_CSV_ARTIFACT_FILENAME,
    );
    writes.push(writeAtomic(path, input.artifacts.payloads.csv));
    result.testcasesCsvPath = path;
  }
  if (input.artifacts.payloads.almXml) {
    const path = join(
      input.destinationDir,
      EXPORT_TESTCASES_ALM_XML_ARTIFACT_FILENAME,
    );
    writes.push(writeAtomic(path, input.artifacts.payloads.almXml));
    result.testcasesAlmXmlPath = path;
  }
  if (input.artifacts.payloads.xlsx) {
    const path = join(
      input.destinationDir,
      EXPORT_TESTCASES_XLSX_ARTIFACT_FILENAME,
    );
    writes.push(writeAtomic(path, input.artifacts.payloads.xlsx));
    result.testcasesXlsxPath = path;
  }
  if (input.artifacts.payloads.qcMappingPreview) {
    const path = join(
      input.destinationDir,
      QC_MAPPING_PREVIEW_ARTIFACT_FILENAME,
    );
    writes.push(writeAtomic(path, input.artifacts.payloads.qcMappingPreview));
    result.qcMappingPreviewPath = path;
  }

  await Promise.all(writes);

  return result;
};

/** Convenience wrapper: run the pipeline and persist in one call. */
export const runAndPersistExportPipeline = async (
  input: RunExportPipelineInput & { destinationDir: string },
): Promise<{
  artifacts: ExportPipelineArtifacts;
  paths: WriteExportPipelineArtifactsResult;
}> => {
  const artifacts = runExportPipeline(input);
  const paths = await writeExportPipelineArtifacts({
    artifacts,
    destinationDir: input.destinationDir,
  });
  return { artifacts, paths };
};
