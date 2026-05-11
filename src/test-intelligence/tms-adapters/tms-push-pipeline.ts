/**
 * TMS push orchestrator (Issue #2183, Wave 8).
 *
 * The orchestrator is the single entry point used by the CLI
 * `test-intelligence tms-push` subcommand. It composes:
 *
 *   1. Read `qc-mapping-preview.json` from the run dir.
 *   2. Load TMS credentials from the env (per-tenant secrets surface).
 *   3. `connect` → `validateProject` → bulk `pushTestCaseBatch` over
 *      batches of `DEFAULT_TMS_PUSH_BATCH_SIZE` (50) cases.
 *   4. Persist `tms-push-report.json` atomically under the run dir.
 *   5. `disconnect` (idempotent on every adapter).
 *
 * Hard invariants:
 *   - Refusal-first ordering: every gate that fires is recorded; the
 *     pipeline never short-circuits after the first violation.
 *   - Atomic JSON write: re-runs on the same `run-dir` cannot tear the
 *     report file (mirrors `qc-alm-api-transfer.ts`).
 *   - No credentials, URLs, or raw response bodies leak into the
 *     report — every failure detail goes through
 *     `sanitizeTmsErrorDetail`.
 *   - Determinism: with a fixed clock + injected http client, the
 *     produced `TmsPushReportArtifact` is byte-stable (apart from the
 *     `recordedAt` timestamp, which the caller pins).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ALLOWED_TMS_PUSH_REFUSAL_CODES,
  QC_MAPPING_PREVIEW_ARTIFACT_FILENAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TMS_PUSH_REPORT_SCHEMA_VERSION,
  type QcMappingPreviewArtifact,
  type QcMappingPreviewEntry,
  type TmsAdapterId,
  type TmsPushRefusalCode,
  type TmsPushReportArtifact,
  type TmsPushReportEntry,
  type TmsPushVerdict,
} from "../../contracts/index.js";
import {
  type TmsAdapter,
  type TmsAdapterClock,
  type TmsAdapterSession,
  type TmsCredentials,
  type TmsPushAttemptResult,
} from "./tms-adapter-contract.js";
import {
  buildTmsPushReportPath,
  chunkBatches,
  sanitizeTmsErrorDetail,
  writeTmsAtomicJson,
} from "./tms-shared.js";

/** Refusal-code set used for membership checks. */
const REFUSAL_CODES: ReadonlySet<TmsPushRefusalCode> = new Set(
  ALLOWED_TMS_PUSH_REFUSAL_CODES,
);

/** Inputs for `runTmsPushPipeline`. */
export interface RunTmsPushPipelineInput {
  /** Compiled adapter instance (xray, alm, qtest, polarion). */
  adapter: TmsAdapter;
  /** Symbolic TMS endpoint alias (never a resolved URL). */
  endpointAlias: string;
  /** TMS-specific project id (Jira key, ALM `domain/project`, etc.). */
  projectId: string;
  /** Stable tenant id used to derive idempotency keys. */
  tenantId: string;
  /** Run directory containing `qc-mapping-preview.json`. */
  runDir: string;
  /** Stable run id stamped on idempotency keys + the report. */
  runId: string;
  /** TMS credentials resolved from the env. */
  credentials: TmsCredentials;
  /** Stable clock injected so timestamps stay deterministic in tests. */
  clock: TmsAdapterClock;
  /** When true, no state-mutating call leaves the adapter. */
  dryRun: boolean;
  /** Optional batch size override; defaults to 50. */
  batchSize?: number;
}

/** Result of `runTmsPushPipeline`. */
export interface RunTmsPushPipelineResult {
  /** Persisted artifact (always emitted, even on full refusal). */
  report: TmsPushReportArtifact;
  /** Absolute path of the persisted report. */
  reportPath: string;
}

/**
 * Drive the full TMS push lifecycle. Always emits a
 * `tms-push-report.json` artifact under `runDir`, even on full
 * refusal — auditors need the negative result too.
 */
export const runTmsPushPipeline = async (
  input: RunTmsPushPipelineInput,
): Promise<RunTmsPushPipelineResult> => {
  const refusalCodes = new Set<TmsPushRefusalCode>();
  let entries: QcMappingPreviewEntry[] = [];
  let preview: QcMappingPreviewArtifact | undefined;
  // 1. Load mapping preview.
  try {
    preview = await loadMappingPreviewFromRunDir(input.runDir);
    entries = [...preview.entries].sort((a, b) =>
      a.testCaseId.localeCompare(b.testCaseId),
    );
    if (entries.length === 0) {
      refusalCodes.add("no_mapped_test_cases");
    }
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      refusalCodes.add("mapping_preview_missing");
    } else {
      refusalCodes.add("mapping_preview_unreadable");
    }
  }

  // 2. Connect + validateProject (only when we have inputs to push).
  let attemptResults: TmsPushAttemptResult[] = [];
  let session: TmsAdapterSession | undefined;
  if (refusalCodes.size === 0) {
    try {
      session = await input.adapter.connect({
        endpointAlias: input.endpointAlias,
        projectId: input.projectId,
        tenantId: input.tenantId,
        credentials: input.credentials,
      });
    } catch (err) {
      refusalCodes.add("connect_failed");
      attemptResults = entries.map((entry) =>
        toFailureAttempt(input.adapter.adapterId, entry, err),
      );
    }
    if (session !== undefined) {
      const activeSession = session;
      const validation = await input.adapter.validateProject(activeSession);
      if (!validation.ok) {
        refusalCodes.add("project_validation_failed");
        attemptResults = entries.map((entry) =>
          toFailureAttempt(
            input.adapter.adapterId,
            entry,
            new Error(`${validation.code}: ${validation.message}`),
          ),
        );
      } else {
        // 3. Map + push in batches.
        const batchSize = input.batchSize ?? 50;
        const mapped = entries.map((entry) =>
          input.adapter.mapTestCase({
            session: activeSession,
            runId: input.runId,
            entry,
          }),
        );
        const batches = chunkBatches(mapped, batchSize);
        for (const batch of batches) {
          const batchResult = await input.adapter.pushTestCaseBatch({
            session: activeSession,
            mapped: batch,
            dryRun: input.dryRun,
          });
          attemptResults.push(...batchResult.results);
        }
      }
      try {
        await input.adapter.disconnect(activeSession);
      } catch {
        // Disconnect is best-effort; the report is the source of truth.
      }
    }
  }

  // 4. Build the artifact.
  const reportEntries: TmsPushReportEntry[] = (
    refusalCodes.size > 0 && attemptResults.length === 0
      ? entries.map((entry) =>
          toFailureAttempt(
            input.adapter.adapterId,
            entry,
            new Error("refused before push"),
          ),
        )
      : attemptResults
  ).map((r) => toReportEntry(r, input.clock.now()));

  reportEntries.sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));

  const counts = countVerdicts(reportEntries);
  const report: TmsPushReportArtifact = {
    schemaVersion: TMS_PUSH_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    adapterId: input.adapter.adapterId,
    adapterVersion: input.adapter.version,
    tmsEndpointAlias: input.endpointAlias,
    tmsProjectId: input.projectId,
    runId: input.runId,
    tenantId: input.tenantId,
    generatedAt: input.clock.now(),
    refused: refusalCodes.size > 0,
    refusalCodes: Array.from(refusalCodes)
      .filter((c): c is TmsPushRefusalCode => REFUSAL_CODES.has(c))
      .sort(),
    dryRun: input.dryRun,
    entries: reportEntries,
    pushedCount: counts.pushed,
    skippedDuplicateCount: counts.skipped,
    failedCount: counts.failed,
    rawScreenshotsIncluded: false,
    credentialsIncluded: false,
    transferUrlIncluded: false,
  };

  // 5. Persist atomically.
  const reportPath = buildTmsPushReportPath(input.runDir);
  await writeTmsAtomicJson(reportPath, report);
  return { report, reportPath };
};

const toReportEntry = (
  attempt: TmsPushAttemptResult,
  recordedAt: string,
): TmsPushReportEntry => ({
  testCaseId: attempt.testCaseId,
  idempotencyKey: attempt.idempotencyKey,
  verdict: attempt.verdict,
  tmsTestCaseId: attempt.tmsTestCaseId,
  tmsErrorCode: attempt.tmsErrorCode,
  tmsErrorMessage: attempt.tmsErrorMessage,
  attemptCount: attempt.attemptCount,
  recordedAt,
});

const toFailureAttempt = (
  adapterId: TmsAdapterId,
  entry: QcMappingPreviewEntry,
  err: unknown,
): TmsPushAttemptResult => ({
  testCaseId: entry.testCaseId,
  idempotencyKey: "",
  verdict: "failed",
  tmsTestCaseId: "",
  tmsErrorCode: `${adapterId}_pipeline_refused`,
  tmsErrorMessage: sanitizeTmsErrorDetail(err),
  attemptCount: 0,
});

const countVerdicts = (
  entries: readonly TmsPushReportEntry[],
): { pushed: number; skipped: number; failed: number } => {
  let pushed = 0;
  let skipped = 0;
  let failed = 0;
  for (const entry of entries) {
    const verdict: TmsPushVerdict = entry.verdict;
    if (verdict === "pushed") pushed += 1;
    else if (verdict === "skipped-dup") skipped += 1;
    else failed += 1;
  }
  return { pushed, skipped, failed };
};

/**
 * Read and JSON-parse the mapping preview from `<runDir>/qc-mapping-preview.json`.
 * Throws on missing file or invalid JSON; the orchestrator translates
 * those into refusal codes.
 */
export const loadMappingPreviewFromRunDir = async (
  runDir: string,
): Promise<QcMappingPreviewArtifact> => {
  const path = join(runDir, QC_MAPPING_PREVIEW_ARTIFACT_FILENAME);
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { entries?: unknown }).entries)
  ) {
    throw new TypeError(
      `qc-mapping-preview.json at ${path} did not parse to an artifact shape`,
    );
  }
  return parsed as QcMappingPreviewArtifact;
};
