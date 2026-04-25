/**
 * OpenText ALM dry-run adapter (Issue #1368).
 *
 * Implements `QcAdapter` for the `opentext_alm` provider. The dry-run
 * path:
 *
 *   1. Validates the supplied mapping profile via the hand-rolled
 *      `validateQcMappingProfile` validator. A mismatched provider or any
 *      error-severity issue refuses the dry-run.
 *   2. Resolves the target folder via the injected resolver (default = a
 *      deterministic `simulated` resolver that performs no I/O). Resolver
 *      errors map to `folder_resolution_failed`.
 *   3. Walks each preview entry, computes per-case completeness against
 *      the profile's `requiredFields`, and emits a redacted planned-entity
 *      payload preview that mirrors what an `api_transfer` adapter would
 *      send — minus credentials, raw screenshots, or any URL.
 *   4. Cross-references the visual sidecar report, flagging cases whose
 *      mapping derives only from low-confidence sidecar observations.
 *
 * Determinism:
 *   - All wall-clock + id state is injected through `QcAdapterClock` and
 *     `QcAdapterIdSource`.
 *   - All collections are sorted before emission.
 *   - The report id is the first 16 hex chars of
 *     `sha256(jobId|provider|version|profile.id|profile.version|generatedAt)`
 *     when the default `defaultDryRunIdSource` is used.
 *
 * Hard invariants stamped at the type level:
 *   - `rawScreenshotsIncluded: false`
 *   - `credentialsIncluded: false`
 */

import {
  DRY_RUN_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type DryRunFolderResolution,
  type DryRunMappingCompletenessEntry,
  type DryRunMappingCompletenessSummary,
  type DryRunPlannedEntityPayload,
  type DryRunRefusalCode,
  type DryRunReportArtifact,
  type DryRunVisualEvidenceFlag,
  type GeneratedTestCaseFigmaTrace,
  type QcAdapterMode,
  type QcMappingPreviewArtifact,
  type QcMappingPreviewEntry,
  type QcMappingProfile,
  type QcMappingProfileIssue,
  type QcMappingProfileValidationResult,
  type VisualSidecarValidationOutcome,
  type VisualSidecarValidationRecord,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import { sha256Hex } from "./content-hash.js";
import {
  QcAdapterModeNotImplementedError,
  type QcAdapter,
  type QcAdapterClock,
  type QcAdapterDryRunInput,
  type QcAdapterIdSource,
  type QcFolderResolver,
  type QcFolderResolverResult,
} from "./qc-adapter.js";
import { validateQcMappingProfile } from "./qc-alm-mapping-profile.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";

const ADAPTER_VERSION = "1.0.0" as const;
const DEFAULT_VISUAL_CONFIDENCE_THRESHOLD = 0.6;
const REPORT_ID_LENGTH = 16;
const MAX_FOLDER_RESOLUTION_EVIDENCE_LENGTH = 240;
const FOLDER_PATH_REGEX = /^\/Subject(?:\/[A-Za-z0-9._-][A-Za-z0-9._ -]*)+$/;
const URL_EVIDENCE_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi;

/**
 * Default folder resolver. Performs NO I/O — it inspects the profile
 * structure and returns either `invalid_path` (caller-side bug) or
 * `simulated` so the dry-run report can document folder validation
 * deterministically without ever contacting the real QC tool.
 */
const defaultFolderResolver: QcFolderResolver = {
  assertReadOnly: true,
  resolve: ({ targetFolderPath }) => {
    if (!FOLDER_PATH_REGEX.test(targetFolderPath)) {
      return {
        state: "invalid_path",
        evidence: `simulated:invalid_path_segment_count=${targetFolderPath.split("/").length - 1}`,
      };
    }
    const segmentCount = targetFolderPath.split("/").length - 1;
    return {
      state: "simulated",
      evidence: `simulated:matched-segments=${segmentCount}`,
    };
  },
};

/** Default deterministic id source — first 16 hex chars of sha256(seed). */
const defaultDryRunIdSource: QcAdapterIdSource = {
  newReportId: (seed: string): string =>
    sha256Hex(seed).slice(0, REPORT_ID_LENGTH),
};

/**
 * Compute the redacted value an adapter would persist for a given QC
 * field. Only deterministic, non-credential fields are surfaced; numeric
 * counts replace any list-shaped value.
 */
const buildFieldValue = (
  field: string,
  preview: QcMappingPreviewEntry,
): string => {
  switch (field) {
    case "name":
      return preview.testName;
    case "description":
      return preview.objective;
    case "subtype-id":
    case "user-template-id":
      // The adapter does not carry tenant-specific values in a dry-run;
      // we surface a stable redacted token instead so the planned-payload
      // preview is byte-stable across operators.
      return `<${field}:redacted>`;
    case "owner":
      return "<owner:redacted>";
    case "external-id":
      return preview.externalIdCandidate;
    case "priority":
      return preview.priority;
    case "risk-category":
      return preview.riskCategory;
    default:
      return `<${field}:unspecified>`;
  }
};

const computeCompleteness = (
  profile: QcMappingProfile,
  preview: QcMappingPreviewArtifact,
): DryRunMappingCompletenessSummary => {
  const requiredFields = Array.from(new Set(profile.requiredFields)).sort();
  const perCase: DryRunMappingCompletenessEntry[] = preview.entries
    .slice()
    .sort((a, b) => a.testCaseId.localeCompare(b.testCaseId))
    .map((entry) => {
      const missing: string[] = [];
      for (const field of requiredFields) {
        const value = buildFieldValue(field, entry);
        if (
          value === "" ||
          value === `<${field}:unspecified>` ||
          // Per-case mapping is incomplete when the test case is itself
          // marked unexportable — even if every required field has a
          // placeholder, a non-exportable case still cannot transfer.
          !entry.exportable
        ) {
          missing.push(field);
        }
      }
      return {
        testCaseId: entry.testCaseId,
        externalIdCandidate: entry.externalIdCandidate,
        missingRequiredFields: missing.sort(),
        complete: missing.length === 0,
      };
    });

  const totalCases = perCase.length;
  const completeCases = perCase.filter((p) => p.complete).length;
  const incompleteCases = totalCases - completeCases;
  const missingFieldsAcrossCases = Array.from(
    new Set(perCase.flatMap((p) => p.missingRequiredFields)),
  ).sort();

  return {
    totalCases,
    completeCases,
    incompleteCases,
    missingFieldsAcrossCases,
    perCase,
  };
};

const buildPlannedPayloads = (
  profile: QcMappingProfile,
  preview: QcMappingPreviewArtifact,
): DryRunPlannedEntityPayload[] => {
  const requiredFields = Array.from(new Set(profile.requiredFields)).sort();
  return preview.entries
    .slice()
    .sort((a, b) => a.testCaseId.localeCompare(b.testCaseId))
    .map((entry) => ({
      testCaseId: entry.testCaseId,
      externalIdCandidate: entry.externalIdCandidate,
      testEntityType: profile.testEntityType,
      targetFolderPath: entry.targetFolderPath,
      fields: requiredFields.map((field) => ({
        name: field,
        value: buildFieldValue(field, entry),
      })),
      designStepCount: entry.designSteps.length,
    }));
};

const matchVisualRecords = (
  entry: QcMappingPreviewEntry,
  visual: VisualSidecarValidationReport | undefined,
): VisualSidecarValidationRecord[] => {
  if (!visual) return [];
  const screenIds = new Set(entry.sourceTraceRefs.map((r) => r.screenId));
  if (screenIds.size === 0) return [];
  return visual.records
    .filter((r) => screenIds.has(r.screenId))
    .slice()
    .sort((a, b) => a.screenId.localeCompare(b.screenId));
};

const buildVisualEvidenceFlags = (
  preview: QcMappingPreviewArtifact,
  visual: VisualSidecarValidationReport | undefined,
  threshold: number,
): DryRunVisualEvidenceFlag[] => {
  if (!visual) return [];
  const flags: DryRunVisualEvidenceFlag[] = [];
  for (const entry of preview.entries) {
    const matching = matchVisualRecords(entry, visual);
    if (matching.length === 0) continue;
    let confidenceSum = 0;
    for (const m of matching) confidenceSum += m.meanConfidence;
    const meanConfidence = confidenceSum / matching.length;
    if (meanConfidence >= threshold) continue;
    const ambiguity = Array.from(
      new Set(
        matching
          .flatMap((m) => m.outcomes)
          .filter(
            (o): o is VisualSidecarValidationOutcome =>
              o !== "ok" && o !== "fallback_used",
          ),
      ),
    ).sort();
    const screenIds = Array.from(
      new Set(matching.map((m) => m.screenId)),
    ).sort();
    const traceRefs: GeneratedTestCaseFigmaTrace[] = entry.sourceTraceRefs
      .filter((r) => screenIds.includes(r.screenId))
      .slice()
      .sort((a, b) =>
        `${a.screenId}|${a.nodeId ?? ""}`.localeCompare(
          `${b.screenId}|${b.nodeId ?? ""}`,
        ),
      );
    flags.push({
      testCaseId: entry.testCaseId,
      screenIds,
      sidecarConfidence: meanConfidence,
      ambiguityFlags: ambiguity,
      traceRefs,
      reason: "visual_only_low_confidence_mapping",
    });
  }
  return flags.sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));
};

const emptyCompleteness = (): DryRunMappingCompletenessSummary => ({
  totalCases: 0,
  completeCases: 0,
  incompleteCases: 0,
  missingFieldsAcrossCases: [],
  perCase: [],
});

const refusedFolderResolution = (
  profile: QcMappingProfile,
  evidence: string,
  state: DryRunFolderResolution["state"] = "missing",
): DryRunFolderResolution => ({
  state,
  path: profile.targetFolderPath,
  evidence: sanitizeFolderResolutionEvidence(evidence),
});

const sanitizeFolderResolutionEvidence = (evidence: string): string => {
  const redacted = redactHighRiskSecrets(evidence, "[REDACTED]")
    .replace(URL_EVIDENCE_PATTERN, "[REDACTED_URL]")
    .replace(/\s+/g, " ")
    .trim();
  if (redacted.length <= MAX_FOLDER_RESOLUTION_EVIDENCE_LENGTH) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_FOLDER_RESOLUTION_EVIDENCE_LENGTH)}...`;
};

const collectErrorIssueMessages = (
  validation: QcMappingProfileValidationResult,
): QcMappingProfileIssue[] =>
  validation.issues.filter((i) => i.severity === "error");

const buildReportId = (
  idSource: QcAdapterIdSource,
  jobId: string,
  profile: QcMappingProfile,
  generatedAt: string,
): string =>
  idSource.newReportId(
    `${jobId}|opentext_alm|${ADAPTER_VERSION}|${profile.id}|${profile.version}|${generatedAt}`,
  );

const buildRefusedReport = (
  reportId: string,
  jobId: string,
  generatedAt: string,
  profile: QcMappingProfile,
  validation: QcMappingProfileValidationResult,
  refusalCodes: DryRunRefusalCode[],
  folderResolution: DryRunFolderResolution,
): DryRunReportArtifact => ({
  schemaVersion: DRY_RUN_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  reportId,
  jobId,
  generatedAt,
  mode: "dry_run",
  adapter: { provider: "opentext_alm", version: ADAPTER_VERSION },
  profile: { id: profile.id, version: profile.version },
  refused: true,
  refusalCodes: Array.from(new Set(refusalCodes)).sort(),
  profileValidation: validation,
  completeness: emptyCompleteness(),
  folderResolution,
  plannedPayloads: [],
  visualEvidenceFlags: [],
  rawScreenshotsIncluded: false,
  credentialsIncluded: false,
});

const callResolver = async (
  resolver: QcFolderResolver,
  profile: QcMappingProfile,
): Promise<QcFolderResolverResult> => {
  const out = resolver.resolve({
    profile,
    targetFolderPath: profile.targetFolderPath,
  });
  return out instanceof Promise ? await out : out;
};

/** Concrete OpenText ALM dry-run adapter. */
export const openTextAlmDryRunAdapter: QcAdapter = {
  provider: "opentext_alm",
  version: ADAPTER_VERSION,
  validateProfile(profile: QcMappingProfile): QcMappingProfileValidationResult {
    return validateQcMappingProfile({
      profile,
      expectedProvider: "opentext_alm",
    });
  },
  async dryRun(input: QcAdapterDryRunInput): Promise<DryRunReportArtifact> {
    const mode: QcAdapterMode = input.mode;
    if (mode === "api_transfer") {
      throw new QcAdapterModeNotImplementedError(mode);
    }
    if (mode !== "dry_run") {
      throw new QcAdapterModeNotImplementedError(mode);
    }

    const generatedAt = input.clock.now();
    const idSource = input.idSource;
    const reportId = buildReportId(
      idSource,
      input.jobId,
      input.profile,
      generatedAt,
    );

    const validation = validateQcMappingProfile({
      profile: input.profile,
      expectedProvider: "opentext_alm",
    });

    const refusalCodes = new Set<DryRunRefusalCode>();
    if (input.profile.provider !== "opentext_alm") {
      refusalCodes.add("provider_mismatch");
    }
    if (!validation.ok) {
      refusalCodes.add("mapping_profile_invalid");
    }

    if (refusalCodes.size > 0) {
      const errorIssues = collectErrorIssueMessages(validation);
      const evidenceTokens = errorIssues
        .slice(0, 3)
        .map((i) => i.code)
        .sort();
      const evidence =
        evidenceTokens.length > 0
          ? `not-resolved:${evidenceTokens.join(",")}`
          : "not-resolved";
      return buildRefusedReport(
        reportId,
        input.jobId,
        generatedAt,
        input.profile,
        validation,
        Array.from(refusalCodes),
        refusedFolderResolution(input.profile, evidence),
      );
    }

    if (input.preview.entries.length === 0) {
      refusalCodes.add("no_mapped_test_cases");
      return buildRefusedReport(
        reportId,
        input.jobId,
        generatedAt,
        input.profile,
        validation,
        Array.from(refusalCodes),
        refusedFolderResolution(
          input.profile,
          "not-resolved:no_mapped_test_cases",
        ),
      );
    }

    const resolver = input.folderResolver ?? defaultFolderResolver;
    let folderResolution: DryRunFolderResolution;
    try {
      const resolved = await callResolver(resolver, input.profile);
      folderResolution = {
        state: resolved.state,
        path: input.profile.targetFolderPath,
        evidence: sanitizeFolderResolutionEvidence(resolved.evidence),
      };
    } catch {
      // Resolver-internal failures degrade to a non-refusal "missing"
      // state with a redacted evidence string so the report is still
      // emitted. Underlying error message is intentionally NOT surfaced
      // — it may carry transport metadata.
      folderResolution = refusedFolderResolution(
        input.profile,
        "resolver_threw",
      );
      refusalCodes.add("folder_resolution_failed");
    }

    if (
      folderResolution.state === "missing" ||
      folderResolution.state === "invalid_path"
    ) {
      refusalCodes.add("folder_resolution_failed");
    }

    if (refusalCodes.size > 0) {
      return buildRefusedReport(
        reportId,
        input.jobId,
        generatedAt,
        input.profile,
        validation,
        Array.from(refusalCodes),
        folderResolution,
      );
    }

    const completeness = computeCompleteness(input.profile, input.preview);
    const plannedPayloads = buildPlannedPayloads(input.profile, input.preview);
    const threshold =
      typeof input.visualConfidenceThreshold === "number"
        ? input.visualConfidenceThreshold
        : DEFAULT_VISUAL_CONFIDENCE_THRESHOLD;
    const visualEvidenceFlags = buildVisualEvidenceFlags(
      input.preview,
      input.visual,
      threshold,
    );

    return {
      schemaVersion: DRY_RUN_REPORT_SCHEMA_VERSION,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      reportId,
      jobId: input.jobId,
      generatedAt,
      mode: "dry_run",
      adapter: { provider: "opentext_alm", version: ADAPTER_VERSION },
      profile: { id: input.profile.id, version: input.profile.version },
      refused: false,
      refusalCodes: [],
      profileValidation: validation,
      completeness,
      folderResolution,
      plannedPayloads,
      visualEvidenceFlags,
      rawScreenshotsIncluded: false,
      credentialsIncluded: false,
    };
  },
};

/** Convenience factory — most callers don't need a separate identity. */
export const createOpenTextAlmDryRunAdapter = (): QcAdapter =>
  openTextAlmDryRunAdapter;

/**
 * Default deterministic clock backed by an explicit timestamp string.
 * Test code passes a fixed instant; production callers typically supply
 * `() => new Date().toISOString()`.
 */
export const createFixedClock = (instant: string): QcAdapterClock => ({
  now: () => instant,
});

/**
 * Default deterministic id source — first 16 hex chars of sha256(seed).
 * Exported so test fixtures can inspect / re-use the same shape.
 */
export const DEFAULT_DRY_RUN_ID_SOURCE: QcAdapterIdSource =
  defaultDryRunIdSource;

/**
 * Default folder resolver — performs NO I/O. Exposed so callers can
 * compose it with their own logic (e.g. wrap with telemetry-free logging).
 */
export const DEFAULT_FOLDER_RESOLVER: QcFolderResolver = defaultFolderResolver;
