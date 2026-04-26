/**
 * Controlled OpenText ALM API transfer pipeline (Issue #1372 — Wave 3).
 *
 * Wave 3 introduces the `api_transfer` mode for the QC adapter. The
 * pipeline is fail-closed: every gate must be satisfied before a single
 * write leaves the process. Gates are evaluated in deterministic order
 * and EVERY violated gate is recorded so an operator can address them
 * all in one cycle:
 *
 *   1. Feature gate (`testIntelligenceFeatureEnabled`).
 *   2. Admin/startup gate (`allowApiTransfer === true`).
 *   3. Bearer token configured (and matched).
 *   4. Mapping profile valid + provider matches.
 *   5. Dry-run report present + `refused === false` for the same
 *      `(profileId, profileVersion)` tuple.
 *   6. At least one approved test case is present.
 *   7. No unapproved / policy-blocked / schema-invalid / visual-blocked
 *      / four-eyes-pending cases remain.
 *   8. Visual sidecar evidence is present for every visual-driven case.
 *
 * After all gates pass:
 *
 *   - The injected `QcApiTransferClient` is asked to resolve the target
 *     folder (idempotent — the resolver MUST return the same folder id
 *     for the same path on every call).
 *   - For each approved+exported case (sorted by `testCaseId` for
 *     determinism), the client `lookupByExternalId` is called first.
 *     Hits short-circuit to `skipped_duplicate`. Misses fall through to
 *     `createTestEntity` + sequential `createDesignStep` calls (sorted
 *     by `step.index`).
 *   - On any per-case failure the adapter records the failure class
 *     and continues with the next case (so a transient outage on one
 *     case does not strand the rest).
 *   - After every record is processed the pipeline appends one
 *     `transferred` review event per successfully created/skipped case
 *     so the audit trail closes.
 *   - `transfer-report.json` and `qc-created-entities.json` are written
 *     atomically under the run dir.
 *
 * Hard invariants (stamped at the type level on every artifact):
 *
 *   - `rawScreenshotsIncluded: false`
 *   - `credentialsIncluded: false`
 *   - `transferUrlIncluded: false`
 *
 * Production-readiness baseline (Wave 2 addendum, 2026-04-26):
 *
 *   - All inputs are validated before any side effect.
 *   - The pipeline never logs URLs, tokens, or raw response bodies.
 *   - Failure detail strings are sanitised through the same
 *     `redactHighRiskSecrets` + URL-strip used by the dry-run report.
 *   - Wall-clock timestamps are injected so tests + production runs
 *     produce byte-identical artifacts under fixed clocks.
 *   - Atomic writes use `${pid}.${randomUUID()}.tmp` so concurrent
 *     transfers on the same artifactRoot cannot tear a JSON file.
 */

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  ALLOWED_TRANSFER_FAILURE_CLASSES,
  ALLOWED_TRANSFER_REFUSAL_CODES,
  QC_CREATED_ENTITIES_ARTIFACT_FILENAME,
  QC_CREATED_ENTITIES_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TRANSFER_REPORT_ARTIFACT_FILENAME,
  TRANSFER_REPORT_SCHEMA_VERSION,
  type DryRunReportArtifact,
  type FourEyesEnforcementReason,
  type QcAdapterMode,
  type QcAdapterProvider,
  type QcCreatedEntitiesArtifact,
  type QcCreatedEntity,
  type QcMappingPreviewArtifact,
  type QcMappingPreviewEntry,
  type QcMappingProfile,
  type ReviewGateSnapshot,
  type ReviewSnapshot,
  type TestCasePolicyDecision,
  type TestIntelligenceTransferPrincipal,
  type TransferAuditMetadata,
  type TransferEntityRecord,
  type TransferEvidenceReferences,
  type TransferFailureClass,
  type TransferRefusalCode,
  type TransferReportArtifact,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";
import { sha256Hex } from "./content-hash.js";
import {
  type QcAdapterClock,
  type QcAdapterIdSource,
  type QcFolderResolver,
  type QcFolderResolverResult,
} from "./qc-adapter.js";
import { validateQcMappingProfile } from "./qc-alm-mapping-profile.js";

const ADAPTER_VERSION = "1.0.0" as const;
const ADAPTER_PROVIDER: QcAdapterProvider = "opentext_alm";
const REPORT_ID_LENGTH = 16;
const MAX_FAILURE_DETAIL_LENGTH = 240;
const URL_DETAIL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const FOLDER_PATH_REGEX = /^\/Subject(?:\/[A-Za-z0-9._-][A-Za-z0-9._ -]*)+$/;
const TRANSFER_REFUSAL_CODES: ReadonlySet<TransferRefusalCode> = new Set(
  ALLOWED_TRANSFER_REFUSAL_CODES,
);
const TRANSFER_FAILURE_CLASSES: ReadonlySet<TransferFailureClass> = new Set(
  ALLOWED_TRANSFER_FAILURE_CLASSES,
);
const FOUR_EYES_TERMINAL_STATES = new Set([
  "approved",
  "exported",
  "transferred",
]);
const TRANSFERABLE_STATES = new Set(["exported", "transferred"]);
/** Default principal id surfaced in audit metadata when only a legacy bearer token is configured. */
const DEFAULT_TRANSFER_PRINCIPAL_ID = "transfer-principal:default";
/** Refusal-only audit principal id used when the bearer gate did not match. */
const ANONYMOUS_TRANSFER_PRINCIPAL_ID = "transfer-principal:anonymous";

/**
 * Stable principal id surfaced in the audit metadata when no token has been
 * configured yet. Distinct from {@link ANONYMOUS_TRANSFER_PRINCIPAL_ID} so an
 * operator can tell "no token set" apart from "wrong token submitted".
 */
const UNCONFIGURED_TRANSFER_PRINCIPAL_ID = "transfer-principal:unconfigured";

/* ------------------------------------------------------------------ */
/*  Public client interfaces                                            */
/* ------------------------------------------------------------------ */

/**
 * Resolved coordinates of the target folder on the QC tenant. The
 * adapter records `qcFolderId` on the created-entities artifact so a
 * follow-up run can short-circuit to it.
 */
export interface QcApiFolderHandle {
  qcFolderId: string;
  resolvedPath: string;
}

/** Outcome of an idempotency lookup against the tenant. */
export type QcApiLookupResult =
  | { kind: "missing" }
  | { kind: "found"; qcEntityId: string };

/** Outcome of a `createTestEntity` call against the tenant. */
export interface QcApiCreatedEntity {
  qcEntityId: string;
}

/**
 * Per-design-step body sent to the tenant. Adapters MUST persist these
 * in the order supplied (deterministic; sorted by `index` upstream).
 */
export interface QcApiDesignStepRequest {
  index: number;
  action: string;
  expected: string;
  data?: string;
}

/**
 * Provider-neutral API client wrapping the actual HTTP transport so
 * tests inject a mocked client. The default factory in
 * {@link createOpenTextAlmApiTransferOrchestrator} requires the caller
 * to supply this — the pipeline NEVER attempts a network call without
 * an explicit client.
 *
 * Every method MUST be idempotent in the absence of partial-failure
 * recovery: callers may re-invoke the pipeline on the same approved
 * set, and the adapter relies on lookup-before-create to avoid
 * duplicate entities. Rate-limit retries / circuit-breaker handling
 * are the client's responsibility — the orchestrator surfaces a typed
 * error class only.
 */
export interface QcApiTransferClient {
  /** Resolve (or create) the target folder. Read-only; never deletes. */
  resolveFolder(input: {
    profile: QcMappingProfile;
    targetFolderPath: string;
    bearerToken: string;
  }): Promise<QcApiFolderHandle> | QcApiFolderHandle;
  /**
   * Look up an existing entity by external id + resolved folder. The
   * client MUST scope the lookup to the resolved folder id so that
   * external-id collisions across folders do not silently match.
   */
  lookupByExternalId(input: {
    profile: QcMappingProfile;
    folder: QcApiFolderHandle;
    externalIdCandidate: string;
    bearerToken: string;
  }): Promise<QcApiLookupResult> | QcApiLookupResult;
  /** Create a single test entity. Returns the assigned QC id. */
  createTestEntity(input: {
    profile: QcMappingProfile;
    folder: QcApiFolderHandle;
    entry: QcMappingPreviewEntry;
    bearerToken: string;
  }): Promise<QcApiCreatedEntity> | QcApiCreatedEntity;
  /**
   * Create a single design step. Adapters that expose a bulk endpoint
   * are expected to wrap the bulk call so the per-step failure surface
   * stays granular.
   */
  createDesignStep(input: {
    profile: QcMappingProfile;
    qcEntityId: string;
    step: QcApiDesignStepRequest;
    bearerToken: string;
  }): Promise<void> | void;
}

/**
 * Typed failure class an adapter implementation may throw to mark a
 * specific failure category. The orchestrator records the class on the
 * per-case record. Anything else is mapped to `unknown`.
 */
export class QcApiTransferError extends Error {
  readonly failureClass: TransferFailureClass;
  readonly detail: string;
  constructor(failureClass: TransferFailureClass, detail: string) {
    super(`QcApiTransferError(${failureClass}): ${detail}`);
    this.failureClass = TRANSFER_FAILURE_CLASSES.has(failureClass)
      ? failureClass
      : "unknown";
    this.detail = detail;
    this.name = "QcApiTransferError";
  }
}

/* ------------------------------------------------------------------ */
/*  Orchestrator input + result                                         */
/* ------------------------------------------------------------------ */

export interface RunOpenTextAlmApiTransferInput {
  jobId: string;
  /** ISO-8601 UTC timestamp at the moment of the run; injected for determinism. */
  generatedAt: string;
  /** Mapping profile used by the run (must match the dry-run report's profile). */
  profile: QcMappingProfile;
  /** Approved + mapped cases. Source of truth for `externalIdCandidate`. */
  preview: QcMappingPreviewArtifact;
  /** Dry-run report produced by the same `profile`; binds the run to a validation. */
  dryRun?: DryRunReportArtifact;
  /** Review-gate snapshot. Only `exported` cases are eligible for transfer. */
  reviewSnapshot: ReviewGateSnapshot;
  /** Visual sidecar validation report; required when any case is visual-driven. */
  visual?: VisualSidecarValidationReport;
  /** Whether the test-intelligence feature gate is enabled. Fail-closed when false. */
  featureEnabled: boolean;
  /** Whether the admin gate is enabled. Fail-closed when false. */
  allowApiTransfer: boolean;
  /** Configured bearer token (legacy single-principal). May be undefined. */
  configuredBearerToken?: string;
  /** Configured principal-bound credentials. */
  transferPrincipals?: TestIntelligenceTransferPrincipal[];
  /** Bearer token supplied by the caller of the transfer endpoint. */
  callerBearerToken?: string;
  /** API client wrapping the actual HTTP transport. Required for any write. */
  client: QcApiTransferClient;
  /** Stable clock; injected so transfer reports stay deterministic. */
  clock: QcAdapterClock;
  /** Stable id source; injected so report ids stay deterministic. */
  idSource: QcAdapterIdSource;
  /** Optional folder resolver; defaults to delegating to {@link QcApiTransferClient.resolveFolder}. */
  folderResolver?: QcFolderResolver;
  /** Optional run dir under which the artifacts are persisted. */
  artifactRoot?: string;
  /** Optional sink that records `transferred` review events. */
  reviewEventSink?: TransferReviewEventSink;
  /** Optional opaque actor handle persisted on the audit metadata. */
  actor?: string;
  /** Optional hash-only upstream artifact references for audit lineage. */
  evidenceReferences?: Partial<TransferEvidenceReferences>;
}

/** Adapter for appending review events without depending on `ReviewStore`. */
export interface TransferReviewEventSink {
  appendTransferred(input: {
    jobId: string;
    testCaseId: string;
    actor: string;
    at: string;
    qcEntityId: string;
    externalIdCandidate: string;
  }): Promise<void> | void;
}

export interface RunOpenTextAlmApiTransferResult {
  /** Persisted transfer-report artifact (always emitted). */
  report: TransferReportArtifact;
  /** Persisted qc-created-entities artifact (only when at least one entity persisted). */
  createdEntities: QcCreatedEntitiesArtifact;
  /** Absolute path of the persisted transfer-report. Undefined when no `artifactRoot`. */
  reportPath?: string;
  /** Absolute path of the persisted qc-created-entities. Undefined when no `artifactRoot`. */
  createdEntitiesPath?: string;
  /** True when the pipeline refused to perform any write. */
  refused: boolean;
  /** Sorted, deduplicated refusal codes that fired. */
  refusalCodes: TransferRefusalCode[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                              */
/* ------------------------------------------------------------------ */

const sortedUnique = <T extends string>(values: Iterable<T>): T[] =>
  Array.from(new Set(values)).sort();

const sanitizeFailureDetail = (raw: unknown): string => {
  const text =
    typeof raw === "string"
      ? raw
      : raw instanceof Error
        ? raw.message
        : "transport_error";
  const cleaned = redactHighRiskSecrets(text, "[REDACTED]")
    .replace(URL_DETAIL_PATTERN, "[REDACTED_URL]")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return "transport_error";
  if (cleaned.length <= MAX_FAILURE_DETAIL_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_FAILURE_DETAIL_LENGTH)}...`;
};

const tokensMatchTimingSafe = (
  expected: string,
  candidate: string,
): boolean => {
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const candidateDigest = createHash("sha256")
    .update(candidate, "utf8")
    .digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
};

const normalizeToken = (token: string | undefined): string | undefined => {
  if (typeof token !== "string") return undefined;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

interface AuthOutcome {
  bearerTokenAccepted: boolean;
  authPrincipalId: string;
  bearerTokenMissing: boolean;
}

const evaluateAuthGate = (
  configuredBearerToken: string | undefined,
  principals: readonly TestIntelligenceTransferPrincipal[] | undefined,
  callerBearerToken: string | undefined,
): AuthOutcome => {
  const candidates: { principalId: string; bearerToken: string }[] = [];
  for (const principal of principals ?? []) {
    const token = normalizeToken(principal.bearerToken);
    const principalId =
      typeof principal.principalId === "string"
        ? principal.principalId.trim()
        : "";
    if (!token || principalId.length === 0) continue;
    candidates.push({ principalId, bearerToken: token });
  }
  const legacy = normalizeToken(configuredBearerToken);
  if (legacy) {
    candidates.push({
      principalId: DEFAULT_TRANSFER_PRINCIPAL_ID,
      bearerToken: legacy,
    });
  }
  if (candidates.length === 0) {
    return {
      bearerTokenAccepted: false,
      authPrincipalId: UNCONFIGURED_TRANSFER_PRINCIPAL_ID,
      bearerTokenMissing: true,
    };
  }
  const received = normalizeToken(callerBearerToken);
  if (!received) {
    return {
      bearerTokenAccepted: false,
      authPrincipalId: ANONYMOUS_TRANSFER_PRINCIPAL_ID,
      bearerTokenMissing: false,
    };
  }
  for (const candidate of candidates) {
    if (tokensMatchTimingSafe(candidate.bearerToken, received)) {
      return {
        bearerTokenAccepted: true,
        authPrincipalId: candidate.principalId,
        bearerTokenMissing: false,
      };
    }
  }
  return {
    bearerTokenAccepted: false,
    authPrincipalId: ANONYMOUS_TRANSFER_PRINCIPAL_ID,
    bearerTokenMissing: false,
  };
};

const buildReportId = (
  idSource: QcAdapterIdSource,
  jobId: string,
  profile: QcMappingProfile,
  generatedAt: string,
): string =>
  idSource
    .newReportId(
      `${jobId}|${ADAPTER_PROVIDER}|${ADAPTER_VERSION}|${profile.id}|${profile.version}|${generatedAt}|api_transfer`,
    )
    .slice(0, REPORT_ID_LENGTH);

const buildSnapshotIndex = (
  snapshot: ReviewGateSnapshot,
): Map<string, ReviewSnapshot> => {
  const map = new Map<string, ReviewSnapshot>();
  for (const entry of snapshot.perTestCase) {
    map.set(entry.testCaseId, entry);
  }
  return map;
};

const isFourEyesPending = (entry: ReviewSnapshot): boolean => {
  if (!entry.fourEyesEnforced) return false;
  return !FOUR_EYES_TERMINAL_STATES.has(entry.state);
};

const collectVisualScreenIds = (
  visual: VisualSidecarValidationReport,
): Set<string> => {
  const ids = new Set<string>();
  for (const record of visual.records) {
    ids.add(record.screenId);
  }
  return ids;
};

const refusalSummary = (
  codes: Iterable<TransferRefusalCode>,
): TransferRefusalCode[] =>
  sortedUnique(
    Array.from(codes).filter((c): c is TransferRefusalCode =>
      TRANSFER_REFUSAL_CODES.has(c),
    ),
  );

const writeAtomicJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
};

const sanitizeFolderEvidence = (raw: string): string => {
  const cleaned = redactHighRiskSecrets(raw, "[REDACTED]")
    .replace(URL_DETAIL_PATTERN, "[REDACTED_URL]")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return "resolver_returned_empty_evidence";
  if (cleaned.length <= MAX_FAILURE_DETAIL_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_FAILURE_DETAIL_LENGTH)}...`;
};

const hasBlockingPolicyDecision = (decision: TestCasePolicyDecision): boolean =>
  decision === "blocked";

const isSha256Hex = (value: unknown): value is string =>
  typeof value === "string" && SHA256_HEX_PATTERN.test(value);

const hasDotOnlyFolderSegment = (path: string): boolean =>
  path.split("/").some((segment) => segment === "." || segment === "..");

const isValidFolderPath = (path: string): boolean =>
  FOLDER_PATH_REGEX.test(path) && !hasDotOnlyFolderSegment(path);

const isFolderPathUnderRoot = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}/`);

const dryRunPayloadsMatchPreview = (
  dryRun: DryRunReportArtifact,
  preview: QcMappingPreviewArtifact,
): boolean => {
  if (dryRun.plannedPayloads.length !== preview.entries.length) return false;
  const plannedById = new Map(
    dryRun.plannedPayloads.map((payload) => [payload.testCaseId, payload]),
  );
  for (const entry of preview.entries) {
    const planned = plannedById.get(entry.testCaseId);
    if (!planned) return false;
    if (planned.externalIdCandidate !== entry.externalIdCandidate) return false;
    if (planned.targetFolderPath !== entry.targetFolderPath) return false;
    if (planned.designStepCount !== entry.designSteps.length) return false;
  }
  return true;
};

const visualEvidenceHashForEntry = (
  entry: QcMappingPreviewEntry,
  visual: VisualSidecarValidationReport,
): string | undefined => {
  const screenIds = new Set(entry.sourceTraceRefs.map((ref) => ref.screenId));
  if (screenIds.size === 0) return undefined;
  const matching = visual.records
    .filter((record) => screenIds.has(record.screenId))
    .slice()
    .sort((a, b) => a.screenId.localeCompare(b.screenId));
  if (matching.length === 0) return undefined;
  const provenanceSeed = matching
    .map(
      (record) =>
        `${record.screenId}|${record.deployment}|${record.outcomes
          .slice()
          .sort()
          .join(",")}|${record.meanConfidence.toFixed(6)}`,
    )
    .join("\n");
  return sha256Hex(provenanceSeed);
};

/* ------------------------------------------------------------------ */
/*  Orchestrator                                                        */
/* ------------------------------------------------------------------ */

const buildAuditMetadata = (input: {
  authPrincipalId: string;
  bearerTokenAccepted: boolean;
  fourEyesReasons: FourEyesEnforcementReason[];
  dryRunReportId: string;
  actor: string | undefined;
  evidenceReferences: TransferEvidenceReferences;
}): TransferAuditMetadata => ({
  actor:
    input.actor && input.actor.length > 0 ? input.actor : input.authPrincipalId,
  authPrincipalId: input.authPrincipalId,
  bearerTokenAccepted: input.bearerTokenAccepted,
  fourEyesReasons: sortedUnique(input.fourEyesReasons),
  dryRunReportId: input.dryRunReportId,
  evidenceReferences: input.evidenceReferences,
});

const buildEmptyReport = (
  input: RunOpenTextAlmApiTransferInput,
  reportId: string,
  refusalCodes: TransferRefusalCode[],
  audit: TransferAuditMetadata,
): TransferReportArtifact => ({
  schemaVersion: TRANSFER_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  reportId,
  jobId: input.jobId,
  generatedAt: input.generatedAt,
  mode: "api_transfer" as QcAdapterMode,
  adapter: { provider: ADAPTER_PROVIDER, version: ADAPTER_VERSION },
  profile: { id: input.profile.id, version: input.profile.version },
  refused: true,
  refusalCodes: refusalSummary(refusalCodes),
  records: [],
  createdCount: 0,
  skippedDuplicateCount: 0,
  failedCount: 0,
  refusedCount: 0,
  audit,
  rawScreenshotsIncluded: false,
  credentialsIncluded: false,
  transferUrlIncluded: false,
});

const buildEmptyCreatedEntities = (
  input: RunOpenTextAlmApiTransferInput,
): QcCreatedEntitiesArtifact => ({
  schemaVersion: QC_CREATED_ENTITIES_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: input.jobId,
  generatedAt: input.generatedAt,
  profileId: input.profile.id,
  profileVersion: input.profile.version,
  entities: [],
  transferUrlIncluded: false,
});

const callFolderResolver = async (
  resolver: QcFolderResolver,
  profile: QcMappingProfile,
  targetFolderPath: string,
): Promise<QcFolderResolverResult> => {
  const out = resolver.resolve({
    profile: { ...profile, targetFolderPath },
    targetFolderPath,
  });
  return out instanceof Promise ? await out : out;
};

const buildEvidenceReferences = (
  input: RunOpenTextAlmApiTransferInput,
): TransferEvidenceReferences => {
  const overrides = input.evidenceReferences;
  const visualSidecarEvidenceHashes = sortedUnique([
    ...input.preview.entries
      .map((entry) => entry.visualProvenance?.evidenceHash)
      .filter(isSha256Hex),
  ]);
  const out: TransferEvidenceReferences = {
    qcMappingPreviewHash: sha256Hex(input.preview),
    dryRunReportHash: input.dryRun ? sha256Hex(input.dryRun) : "",
    visualSidecarReportHash: input.visual ? sha256Hex(input.visual) : "",
    visualSidecarEvidenceHashes,
  };
  if (isSha256Hex(overrides?.generationOutputHash)) {
    out.generationOutputHash = overrides.generationOutputHash;
  }
  if (isSha256Hex(overrides?.reconciledIntentIrHash)) {
    out.reconciledIntentIrHash = overrides.reconciledIntentIrHash;
  }
  return out;
};

const collectGateRefusals = (
  input: RunOpenTextAlmApiTransferInput,
  auth: AuthOutcome,
): {
  refusalCodes: Set<TransferRefusalCode>;
  fourEyesReasons: Set<FourEyesEnforcementReason>;
  dryRunReportId: string;
} => {
  const refusalCodes = new Set<TransferRefusalCode>();
  const fourEyesReasons = new Set<FourEyesEnforcementReason>();

  if (!input.featureEnabled) refusalCodes.add("feature_disabled");
  if (!input.allowApiTransfer) refusalCodes.add("admin_gate_disabled");
  if (auth.bearerTokenMissing || !auth.bearerTokenAccepted) {
    refusalCodes.add("bearer_token_missing");
  }

  const validation = validateQcMappingProfile({
    profile: input.profile,
    expectedProvider: ADAPTER_PROVIDER,
  });
  if (!validation.ok) refusalCodes.add("mapping_profile_invalid");
  if (input.profile.provider !== ADAPTER_PROVIDER) {
    refusalCodes.add("provider_mismatch");
  }
  if (!isValidFolderPath(input.profile.targetFolderPath)) {
    refusalCodes.add("folder_resolution_failed");
  }
  for (const entry of input.preview.entries) {
    if (
      !isValidFolderPath(entry.targetFolderPath) ||
      !isFolderPathUnderRoot(
        entry.targetFolderPath,
        input.profile.targetFolderPath,
      )
    ) {
      refusalCodes.add("folder_resolution_failed");
    }
  }

  const dryRun = input.dryRun;
  let dryRunReportId = "";
  if (!dryRun) {
    refusalCodes.add("dry_run_missing");
  } else {
    dryRunReportId = dryRun.reportId;
    if (
      dryRun.jobId !== input.jobId ||
      dryRun.mode !== "dry_run" ||
      dryRun.adapter.provider !== ADAPTER_PROVIDER ||
      input.preview.profileId !== input.profile.id ||
      input.preview.profileVersion !== input.profile.version ||
      dryRun.profile.id !== input.profile.id ||
      dryRun.profile.version !== input.profile.version
    ) {
      refusalCodes.add("dry_run_missing");
    }
    if (dryRun.refused) refusalCodes.add("dry_run_refused");
    if (
      dryRun.folderResolution.state !== "resolved" &&
      dryRun.folderResolution.state !== "simulated"
    ) {
      refusalCodes.add("dry_run_refused");
    }
    if (dryRun.completeness.incompleteCases > 0) {
      refusalCodes.add("dry_run_refused");
    }
    if (!dryRunPayloadsMatchPreview(dryRun, input.preview)) {
      refusalCodes.add("dry_run_refused");
    }
  }

  if (input.preview.entries.length === 0) {
    refusalCodes.add("no_mapped_test_cases");
  }

  const snapshotIndex = buildSnapshotIndex(input.reviewSnapshot);
  let approvedCount = 0;
  let unapprovedPresent = false;
  let policyBlockedPresent = false;
  let schemaInvalidPresent = false;
  let visualSidecarBlockedPresent = false;
  let visualEvidenceMissingPresent = false;
  let fourEyesPendingPresent = false;
  let inconsistent = false;

  for (const entry of input.preview.entries) {
    const snapshot = snapshotIndex.get(entry.testCaseId);
    if (!snapshot) {
      inconsistent = true;
      continue;
    }
    if (hasBlockingPolicyDecision(snapshot.policyDecision)) {
      policyBlockedPresent = true;
      continue;
    }
    if (!entry.exportable) {
      schemaInvalidPresent = true;
      continue;
    }
    if (
      entry.visualProvenance &&
      !isSha256Hex(entry.visualProvenance.evidenceHash)
    ) {
      visualEvidenceMissingPresent = true;
      continue;
    }
    if (isFourEyesPending(snapshot)) {
      fourEyesPendingPresent = true;
      for (const reason of snapshot.fourEyesReasons ?? []) {
        fourEyesReasons.add(reason);
      }
      continue;
    }
    if (TRANSFERABLE_STATES.has(snapshot.state)) {
      approvedCount += 1;
      for (const reason of snapshot.fourEyesReasons ?? []) {
        fourEyesReasons.add(reason);
      }
    } else {
      unapprovedPresent = true;
    }
  }

  if (input.visual) {
    if (input.visual.blocked) {
      visualSidecarBlockedPresent = true;
    }
    if (input.visual.jobId !== input.jobId) {
      visualEvidenceMissingPresent = true;
    }
    const visualScreens = collectVisualScreenIds(input.visual);
    for (const entry of input.preview.entries) {
      const snapshot = snapshotIndex.get(entry.testCaseId);
      if (!snapshot) continue;
      if (!TRANSFERABLE_STATES.has(snapshot.state)) continue;
      const referenced = entry.sourceTraceRefs.filter((ref) =>
        visualScreens.has(ref.screenId),
      );
      if (entry.sourceTraceRefs.length === 0) {
        if (entry.visualProvenance) {
          visualEvidenceMissingPresent = true;
        }
        continue;
      }
      if (referenced.length === 0 && entry.visualProvenance) {
        visualEvidenceMissingPresent = true;
      }
      if (
        entry.visualProvenance &&
        visualEvidenceHashForEntry(entry, input.visual) !==
          entry.visualProvenance.evidenceHash
      ) {
        visualEvidenceMissingPresent = true;
      }
    }
  } else {
    for (const entry of input.preview.entries) {
      if (entry.visualProvenance) {
        visualEvidenceMissingPresent = true;
        break;
      }
    }
  }

  if (visualSidecarBlockedPresent) refusalCodes.add("visual_sidecar_blocked");
  if (visualEvidenceMissingPresent) {
    refusalCodes.add("visual_sidecar_evidence_missing");
  }
  if (unapprovedPresent) refusalCodes.add("unapproved_test_cases_present");
  if (policyBlockedPresent) refusalCodes.add("policy_blocked_cases_present");
  if (schemaInvalidPresent) refusalCodes.add("schema_invalid_cases_present");
  if (fourEyesPendingPresent) refusalCodes.add("four_eyes_pending");
  if (inconsistent) refusalCodes.add("review_state_inconsistent");
  if (
    approvedCount === 0 &&
    !refusalCodes.has("no_mapped_test_cases") &&
    !refusalCodes.has("review_state_inconsistent") &&
    !unapprovedPresent &&
    !policyBlockedPresent &&
    !schemaInvalidPresent &&
    !fourEyesPendingPresent
  ) {
    refusalCodes.add("no_approved_test_cases");
  }

  return { refusalCodes, fourEyesReasons, dryRunReportId };
};

const persistArtifacts = async (
  artifactRoot: string | undefined,
  report: TransferReportArtifact,
  createdEntities: QcCreatedEntitiesArtifact,
): Promise<{ reportPath?: string; createdEntitiesPath?: string }> => {
  if (!artifactRoot) return {};
  await mkdir(artifactRoot, { recursive: true });
  const reportPath = join(artifactRoot, TRANSFER_REPORT_ARTIFACT_FILENAME);
  const createdEntitiesPath = join(
    artifactRoot,
    QC_CREATED_ENTITIES_ARTIFACT_FILENAME,
  );
  await writeAtomicJson(reportPath, report);
  await writeAtomicJson(createdEntitiesPath, createdEntities);
  return { reportPath, createdEntitiesPath };
};

const sortPreviewEntries = (
  preview: QcMappingPreviewArtifact,
  snapshotIndex: Map<string, ReviewSnapshot>,
): QcMappingPreviewEntry[] =>
  preview.entries
    .filter((entry) => {
      const snap = snapshotIndex.get(entry.testCaseId);
      return (
        snap !== undefined &&
        TRANSFERABLE_STATES.has(snap.state) &&
        entry.exportable &&
        snap.policyDecision !== "blocked" &&
        !isFourEyesPending(snap)
      );
    })
    .slice()
    .sort(
      (a, b) =>
        a.targetFolderPath.localeCompare(b.targetFolderPath) ||
        a.testCaseId.localeCompare(b.testCaseId),
    );

const sortedDesignSteps = (
  entry: QcMappingPreviewEntry,
): QcApiDesignStepRequest[] =>
  entry.designSteps
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((step) => {
      const out: QcApiDesignStepRequest = {
        index: step.index,
        action: step.action,
        expected: step.expected ?? "",
      };
      if (step.data !== undefined) out.data = step.data;
      return out;
    });

interface AttemptResult {
  record: TransferEntityRecord;
  created?: QcCreatedEntity;
}

const attemptTransfer = async (
  client: QcApiTransferClient,
  profile: QcMappingProfile,
  folder: QcApiFolderHandle,
  entry: QcMappingPreviewEntry,
  bearerToken: string,
  recordedAt: string,
): Promise<AttemptResult> => {
  let lookup: QcApiLookupResult;
  try {
    const out = client.lookupByExternalId({
      profile,
      folder,
      externalIdCandidate: entry.externalIdCandidate,
      bearerToken,
    });
    lookup = out instanceof Promise ? await out : out;
  } catch (error) {
    return {
      record: {
        testCaseId: entry.testCaseId,
        externalIdCandidate: entry.externalIdCandidate,
        targetFolderPath: entry.targetFolderPath,
        outcome: "failed",
        qcEntityId: "",
        designStepsCreated: 0,
        recordedAt,
        failureClass:
          error instanceof QcApiTransferError ? error.failureClass : "unknown",
        failureDetail: sanitizeFailureDetail(error),
      },
    };
  }
  if (lookup.kind === "found") {
    const designStepCount = entry.designSteps.length;
    return {
      record: {
        testCaseId: entry.testCaseId,
        externalIdCandidate: entry.externalIdCandidate,
        targetFolderPath: entry.targetFolderPath,
        outcome: "skipped_duplicate",
        qcEntityId: lookup.qcEntityId,
        designStepsCreated: 0,
        recordedAt,
      },
      created: {
        testCaseId: entry.testCaseId,
        externalIdCandidate: entry.externalIdCandidate,
        qcEntityId: lookup.qcEntityId,
        targetFolderPath: entry.targetFolderPath,
        createdAt: recordedAt,
        designStepCount,
        preExisting: true,
      },
    };
  }
  let createdEntity: QcApiCreatedEntity;
  try {
    const out = client.createTestEntity({
      profile,
      folder,
      entry,
      bearerToken,
    });
    createdEntity = out instanceof Promise ? await out : out;
  } catch (error) {
    return {
      record: {
        testCaseId: entry.testCaseId,
        externalIdCandidate: entry.externalIdCandidate,
        targetFolderPath: entry.targetFolderPath,
        outcome: "failed",
        qcEntityId: "",
        designStepsCreated: 0,
        recordedAt,
        failureClass:
          error instanceof QcApiTransferError ? error.failureClass : "unknown",
        failureDetail: sanitizeFailureDetail(error),
      },
    };
  }
  let designStepsCreated = 0;
  for (const step of sortedDesignSteps(entry)) {
    try {
      const out = client.createDesignStep({
        profile,
        qcEntityId: createdEntity.qcEntityId,
        step,
        bearerToken,
      });
      if (out instanceof Promise) await out;
      designStepsCreated += 1;
    } catch (error) {
      return {
        record: {
          testCaseId: entry.testCaseId,
          externalIdCandidate: entry.externalIdCandidate,
          targetFolderPath: entry.targetFolderPath,
          outcome: "failed",
          qcEntityId: createdEntity.qcEntityId,
          designStepsCreated,
          recordedAt,
          failureClass:
            error instanceof QcApiTransferError
              ? error.failureClass
              : "unknown",
          failureDetail: sanitizeFailureDetail(error),
        },
      };
    }
  }
  return {
    record: {
      testCaseId: entry.testCaseId,
      externalIdCandidate: entry.externalIdCandidate,
      targetFolderPath: entry.targetFolderPath,
      outcome: "created",
      qcEntityId: createdEntity.qcEntityId,
      designStepsCreated,
      recordedAt,
    },
    created: {
      testCaseId: entry.testCaseId,
      externalIdCandidate: entry.externalIdCandidate,
      qcEntityId: createdEntity.qcEntityId,
      targetFolderPath: entry.targetFolderPath,
      createdAt: recordedAt,
      designStepCount: entry.designSteps.length,
      preExisting: false,
    },
  };
};

/**
 * Run the controlled OpenText ALM API transfer pipeline (Issue #1372).
 *
 * The function returns even on refusal — the caller is expected to
 * inspect `result.refused` + `result.refusalCodes` and surface them to
 * the operator. Throwing is reserved for programmer errors (missing
 * client, invalid clock).
 */
export const runOpenTextAlmApiTransfer = async (
  input: RunOpenTextAlmApiTransferInput,
): Promise<RunOpenTextAlmApiTransferResult> => {
  // Runtime guards: the function is part of the public surface, so
  // misuse from non-TypeScript callers must surface a clear error
  // rather than a NullPointerException-style throw deep in the chain.
  const guardInput = input as Partial<RunOpenTextAlmApiTransferInput>;
  if (!guardInput.client) {
    throw new TypeError(
      "runOpenTextAlmApiTransfer: input.client is required (no implicit transport).",
    );
  }
  if (!guardInput.clock || typeof guardInput.clock.now !== "function") {
    throw new TypeError("runOpenTextAlmApiTransfer: input.clock is required.");
  }
  if (
    !guardInput.idSource ||
    typeof guardInput.idSource.newReportId !== "function"
  ) {
    throw new TypeError(
      "runOpenTextAlmApiTransfer: input.idSource is required.",
    );
  }
  if (typeof input.jobId !== "string" || input.jobId.length === 0) {
    throw new TypeError("runOpenTextAlmApiTransfer: input.jobId is required.");
  }

  const reportId = buildReportId(
    input.idSource,
    input.jobId,
    input.profile,
    input.generatedAt,
  );
  const auth = evaluateAuthGate(
    input.configuredBearerToken,
    input.transferPrincipals,
    input.callerBearerToken,
  );
  const { refusalCodes, fourEyesReasons, dryRunReportId } = collectGateRefusals(
    input,
    auth,
  );

  const audit = buildAuditMetadata({
    authPrincipalId: auth.authPrincipalId,
    bearerTokenAccepted: auth.bearerTokenAccepted,
    fourEyesReasons: Array.from(fourEyesReasons),
    dryRunReportId,
    actor: input.actor,
    evidenceReferences: buildEvidenceReferences(input),
  });

  if (refusalCodes.size > 0) {
    const report = buildEmptyReport(
      input,
      reportId,
      Array.from(refusalCodes),
      audit,
    );
    const createdEntities = buildEmptyCreatedEntities(input);
    const persisted = await persistArtifacts(
      input.artifactRoot,
      report,
      createdEntities,
    );
    return {
      report,
      createdEntities,
      ...persisted,
      refused: true,
      refusalCodes: report.refusalCodes,
    };
  }

  const snapshotIndex = buildSnapshotIndex(input.reviewSnapshot);
  const eligible = sortPreviewEntries(input.preview, snapshotIndex);

  // Resolve every distinct target folder before creating any test entity.
  // This preserves the external-id + folder-path idempotency boundary and
  // keeps folder failures fail-closed with no partial tenant writes.
  const folderByPath = new Map<string, QcApiFolderHandle>();
  try {
    const targetFolderPaths = sortedUnique(
      eligible.map((entry) => entry.targetFolderPath),
    );
    for (const targetFolderPath of targetFolderPaths) {
      if (input.folderResolver) {
        const resolverOut = await callFolderResolver(
          input.folderResolver,
          input.profile,
          targetFolderPath,
        );
        if (
          resolverOut.state !== "resolved" &&
          resolverOut.state !== "simulated"
        ) {
          void sanitizeFolderEvidence(resolverOut.evidence);
          throw new QcApiTransferError(
            "validation_rejected",
            "folder_resolution_failed",
          );
        }
        const folderSeed = `${input.profile.id}|${input.profile.version}|${targetFolderPath}`;
        folderByPath.set(targetFolderPath, {
          qcFolderId: `simulated:${sha256Hex(folderSeed).slice(0, 16)}`,
          resolvedPath: targetFolderPath,
        });
        continue;
      }
      const out = input.client.resolveFolder({
        profile: { ...input.profile, targetFolderPath },
        targetFolderPath,
        bearerToken: input.callerBearerToken ?? "",
      });
      folderByPath.set(
        targetFolderPath,
        out instanceof Promise ? await out : out,
      );
    }
  } catch (error) {
    const failureRefusal = new Set<TransferRefusalCode>([
      "folder_resolution_failed",
    ]);
    const report = buildEmptyReport(
      input,
      reportId,
      Array.from(failureRefusal),
      audit,
    );
    const createdEntities = buildEmptyCreatedEntities(input);
    const persisted = await persistArtifacts(
      input.artifactRoot,
      report,
      createdEntities,
    );
    void error;
    return {
      report,
      createdEntities,
      ...persisted,
      refused: true,
      refusalCodes: refusalSummary(["folder_resolution_failed"]),
    };
  }

  const records: TransferEntityRecord[] = [];
  const created: QcCreatedEntity[] = [];

  for (const entry of eligible) {
    const folderHandle = folderByPath.get(entry.targetFolderPath);
    if (!folderHandle) {
      throw new Error(
        `runOpenTextAlmApiTransfer: missing resolved folder for ${entry.targetFolderPath}`,
      );
    }
    const recordedAt = input.clock.now();
    const attempt = await attemptTransfer(
      input.client,
      input.profile,
      folderHandle,
      entry,
      input.callerBearerToken ?? "",
      recordedAt,
    );
    records.push(attempt.record);
    if (attempt.created) created.push(attempt.created);
  }

  // Append `transferred` review events for every successful create OR
  // skipped-duplicate so re-runs preserve the audit lineage.
  if (input.reviewEventSink) {
    for (const record of records) {
      if (
        record.outcome !== "created" &&
        record.outcome !== "skipped_duplicate"
      ) {
        continue;
      }
      try {
        const sinkOut = input.reviewEventSink.appendTransferred({
          jobId: input.jobId,
          testCaseId: record.testCaseId,
          actor: audit.authPrincipalId,
          at: record.recordedAt,
          qcEntityId: record.qcEntityId,
          externalIdCandidate: record.externalIdCandidate,
        });
        if (sinkOut instanceof Promise) await sinkOut;
      } catch {
        // Sink failures must not back-out the actual transfer that
        // already happened on the tenant. Surface as a failure detail
        // on the per-case record so the operator notices, but DO NOT
        // change the outcome — the QC entity still exists.
        record.failureDetail =
          record.failureDetail ?? "review_event_sink_failed";
      }
    }
  }

  records.sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));
  created.sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));

  const createdCount = records.filter((r) => r.outcome === "created").length;
  const skippedDuplicateCount = records.filter(
    (r) => r.outcome === "skipped_duplicate",
  ).length;
  const failedCount = records.filter((r) => r.outcome === "failed").length;
  const refusedCount = records.filter((r) => r.outcome === "refused").length;

  const report: TransferReportArtifact = {
    schemaVersion: TRANSFER_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    reportId,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    mode: "api_transfer",
    adapter: { provider: ADAPTER_PROVIDER, version: ADAPTER_VERSION },
    profile: { id: input.profile.id, version: input.profile.version },
    refused: false,
    refusalCodes: [],
    records,
    createdCount,
    skippedDuplicateCount,
    failedCount,
    refusedCount,
    audit,
    rawScreenshotsIncluded: false,
    credentialsIncluded: false,
    transferUrlIncluded: false,
  };

  const createdEntities: QcCreatedEntitiesArtifact = {
    schemaVersion: QC_CREATED_ENTITIES_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    profileId: input.profile.id,
    profileVersion: input.profile.version,
    entities: created,
    transferUrlIncluded: false,
  };

  const persisted = await persistArtifacts(
    input.artifactRoot,
    report,
    createdEntities,
  );

  return {
    report,
    createdEntities,
    ...persisted,
    refused: false,
    refusalCodes: [],
  };
};

/* ------------------------------------------------------------------ */
/*  Operator rollback / cleanup guidance                                */
/* ------------------------------------------------------------------ */

/**
 * Operator-facing rollback guidance for a transfer report. Returned as a
 * structured object (no IO) so a UI surface can render it without
 * re-deriving from the report. The object never carries credentials or
 * URLs — the operator looks them up from their out-of-band runbook.
 *
 * Use the guidance ONLY in test/staging tenants. Production rollbacks
 * must go through the operator's change-management process; this helper
 * is informational, not a `delete` API.
 */
export interface TransferRollbackGuidance {
  jobId: string;
  reportId: string;
  generatedAt: string;
  /** Forward-looking: per-entity removal hints for created or partial entities. */
  removalHints: TransferRollbackHint[];
  /** Per-entity audit hints for `skipped_duplicate` outcomes. */
  auditHints: TransferRollbackHint[];
  /** Generic guidance applicable to every test-environment rollback. */
  generalNotes: string[];
}

export interface TransferRollbackHint {
  testCaseId: string;
  externalIdCandidate: string;
  qcEntityId: string;
  targetFolderPath: string;
}

const TEST_ENVIRONMENT_ROLLBACK_NOTES: readonly string[] = [
  "Only run rollback against a non-production OpenText ALM tenant.",
  "Use the operator runbook to delete entities by qcEntityId; do NOT delete by external-id alone.",
  "After deletion, preserve the transfer report and append an operator reconciliation note through the review/audit system.",
  "Verify the audit log on the tenant records the operator that authorised the rollback.",
];

/**
 * Build operator-facing rollback/cleanup guidance for a transfer report.
 *
 * The function is pure and IO-free. It only reads from the report and
 * returns a structured object that an operator UI can render.
 */
export const buildTransferRollbackGuidance = (
  report: TransferReportArtifact,
): TransferRollbackGuidance => {
  const removalHints: TransferRollbackHint[] = report.records
    .filter(
      (r) =>
        r.outcome === "created" ||
        (r.outcome === "failed" && r.qcEntityId.length > 0),
    )
    .map((r) => ({
      testCaseId: r.testCaseId,
      externalIdCandidate: r.externalIdCandidate,
      qcEntityId: r.qcEntityId,
      targetFolderPath: r.targetFolderPath,
    }))
    .sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));
  const auditHints: TransferRollbackHint[] = report.records
    .filter((r) => r.outcome === "skipped_duplicate")
    .map((r) => ({
      testCaseId: r.testCaseId,
      externalIdCandidate: r.externalIdCandidate,
      qcEntityId: r.qcEntityId,
      targetFolderPath: r.targetFolderPath,
    }))
    .sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));
  return {
    jobId: report.jobId,
    reportId: report.reportId,
    generatedAt: report.generatedAt,
    removalHints,
    auditHints,
    generalNotes: TEST_ENVIRONMENT_ROLLBACK_NOTES.slice(),
  };
};

/** Discriminated marker for callers to assert that mode === "api_transfer". */
export const isApiTransferMode = (
  mode: QcAdapterMode,
): mode is "api_transfer" => mode === "api_transfer";

/* ------------------------------------------------------------------ */
/*  Test sink + default unconfigured client                             */
/* ------------------------------------------------------------------ */

/**
 * Refusing client used when the orchestrator must short-circuit before
 * any side effect — for example, when the feature gate is disabled and
 * the operator never wired a real client. Every method throws a
 * `QcApiTransferError("permission_denied", "no_client_configured")` so
 * the orchestrator's per-case error handling fails closed.
 */
export const NO_CLIENT_CONFIGURED_ERROR_DETAIL =
  "no_client_configured" as const;

export const createUnconfiguredQcApiTransferClient =
  (): QcApiTransferClient => {
    const refuse = (): never => {
      throw new QcApiTransferError(
        "permission_denied",
        NO_CLIENT_CONFIGURED_ERROR_DETAIL,
      );
    };
    return {
      resolveFolder: refuse,
      lookupByExternalId: refuse,
      createTestEntity: refuse,
      createDesignStep: refuse,
    };
  };
