/**
 * Thin orchestration helpers that build + persist a traceability
 * matrix from an export-pipeline run (Issue #1373).
 *
 * The helpers are PURE composition: they invoke
 * `runAndPersistExportPipeline` (or a transfer run) unchanged and
 * then build + persist a `traceability-matrix.json` artifact in
 * the same destination directory. Existing pipelines continue to
 * emit their pre-#1373 artifact set byte-identically; this module
 * only adds a sibling artifact when the caller opts in.
 *
 * No new pipeline behaviour is introduced. The matrix carries the
 * type-level invariants `rawScreenshotsIncluded: false` and
 * `secretsIncluded: false` per the contract, and is written
 * atomically using the shared `${pid}.${randomUUID()}.tmp` rename
 * pattern.
 */

import {
  type BusinessTestIntentIr,
  type GeneratedTestCaseList,
  type QcMappingPreviewArtifact,
  type ReviewGateSnapshot,
  type TestCasePolicyReport,
  type TestCaseValidationReport,
  type TraceabilityMatrix,
  type TransferReportArtifact,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import {
  buildTraceabilityMatrix,
  writeTraceabilityMatrix,
  type WriteTraceabilityMatrixResult,
} from "./traceability-matrix.js";

/**
 * Build + persist a traceability matrix at the END of an
 * export-pipeline run. The caller has already invoked
 * `runAndPersistExportPipeline` and now passes the input artifacts
 * + the destination directory. The function never throws on a
 * missing OPTIONAL upstream report; the matrix surface is designed
 * to be useful in export-only mode (no transfer report) and in
 * transfer-aware mode (with one).
 */
export interface PersistExportTraceabilityMatrixInput {
  jobId: string;
  generatedAt: string;
  intent: BusinessTestIntentIr;
  list: GeneratedTestCaseList;
  qcMapping?: QcMappingPreviewArtifact;
  validation?: TestCaseValidationReport;
  policy?: TestCasePolicyReport;
  visual?: VisualSidecarValidationReport;
  reviewSnapshot?: ReviewGateSnapshot;
  transferReport?: TransferReportArtifact;
  exportProfile?: { id: string; version: string };
  policyProfile?: { id: string; version: string };
  /** Destination directory — typically the export-pipeline run dir. */
  destinationDir: string;
}

export interface PersistTraceabilityMatrixResult {
  matrix: TraceabilityMatrix;
  paths: WriteTraceabilityMatrixResult;
}

/**
 * Build + persist `traceability-matrix.json` for an export-pipeline
 * run. Composes `buildTraceabilityMatrix` and
 * `writeTraceabilityMatrix`. Pure additive: it does NOT touch any
 * other artifact in `destinationDir`.
 */
export const persistExportTraceabilityMatrix = async (
  input: PersistExportTraceabilityMatrixInput,
): Promise<PersistTraceabilityMatrixResult> => {
  const matrix = buildTraceabilityMatrix({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    intent: input.intent,
    list: input.list,
    ...(input.qcMapping !== undefined ? { qcMapping: input.qcMapping } : {}),
    ...(input.validation !== undefined ? { validation: input.validation } : {}),
    ...(input.policy !== undefined ? { policy: input.policy } : {}),
    ...(input.visual !== undefined ? { visual: input.visual } : {}),
    ...(input.reviewSnapshot !== undefined
      ? { reviewSnapshot: input.reviewSnapshot }
      : {}),
    ...(input.transferReport !== undefined
      ? { transferReport: input.transferReport }
      : {}),
    ...(input.exportProfile !== undefined
      ? { exportProfile: input.exportProfile }
      : {}),
    ...(input.policyProfile !== undefined
      ? { policyProfile: input.policyProfile }
      : {}),
  });
  const paths = await writeTraceabilityMatrix({
    matrix,
    destinationDir: input.destinationDir,
  });
  return { matrix, paths };
};

/**
 * Convenience alias for the transfer-pipeline path. Behaves
 * identically to {@link persistExportTraceabilityMatrix} — both
 * paths produce the same canonical artifact under the same
 * filename. The separate name is kept so a caller making the
 * transfer call can document intent in code: this matrix snapshot
 * was taken after entities were created in QC.
 */
export const persistTransferTraceabilityMatrix: (
  input: PersistExportTraceabilityMatrixInput,
) => Promise<PersistTraceabilityMatrixResult> = persistExportTraceabilityMatrix;
