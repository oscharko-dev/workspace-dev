/**
 * Test-execution evidence loop (Issue #2186, W8-4).
 *
 * Closes the loop from generated test cases back into the calibration
 * corpus by ingesting **test-execution evidence** from the customer's
 * TMS. When a customer's QA team executes a test in Xray / ALM /
 * qTest / Polarion the resulting pass / fail / blocked / re-tested
 * verdict — optionally accompanied by a human reviewer verdict — is
 * pulled by the harness, validated against the tenant's
 * TMS-admin-owned Ed25519 signing key, and persisted under the
 * per-tenant calibration corpus.
 *
 * Hard invariants:
 *   - **Signature gate** (`G12_EXECUTION_EVIDENCE_SIGNED`): every
 *     evidence entry must verify against the tenant's configured TMS
 *     admin Ed25519 public key. Entries that fail verification are
 *     dropped at ingest and recorded on the per-pull report as
 *     `signature_invalid`.
 *   - **Tenant isolation**: the persistence directory is derived from
 *     the active tenant scope. Cross-tenant ingestion attempts throw
 *     {@link TenantIsolationViolation} (W6-2).
 *   - **Deterministic body canonicalisation**: the signed payload is
 *     the canonical JSON of the {@link ExecutionEvidenceBody} record
 *     with sorted keys so adapters and verifiers agree byte-for-byte.
 *   - **Per-entry idempotency**: the on-disk filename is derived from
 *     the canonical-body sha256 — re-ingesting the same evidence does
 *     not produce a second copy.
 *   - **Refusal-first**: a bad signature or stale `executedAt`
 *     timestamp NEVER corrupts the corpus; the entry is recorded on
 *     the per-pull report and skipped.
 *   - **Conflict surfacing**: an entry whose `reviewerVerdict` is
 *     `approved` but `executionVerdict` is `fail` (and the dual case)
 *     is flagged on the report so the human-review-queue (W6-5) can
 *     pick it up — neither verdict overrides the other silently.
 *
 * Downstream consumers:
 *   - Per-class ECE refit (W7-3) — the next quarterly refit cycle
 *     picks up the persisted evidence automatically by reading the
 *     same calibration-corpus directory.
 *   - Inter-rater κ corpus — `pass+rejected` and `fail+approved` rows
 *     surface on the conflict tab of the audit-dossier.
 *   - Adversarial corpus expansion (#2122) — `fail` entries become
 *     candidate adversarial cases when promoted by a reviewer.
 */

import {
  createPublicKey,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { TenantScope, TmsAdapterId } from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import { recordPersistentStoreRead } from "./tenant-isolation-guard.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Schema version pinned on every persisted evidence record + report. */
export const EXECUTION_EVIDENCE_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Sub-directory under `calibration-corpus/` that stores per-month
 * evidence partitions. Mirrors the W7-3 quarterly refit reader which
 * walks the corpus by glob.
 */
export const EXECUTION_EVIDENCE_CORPUS_DIRNAME =
  "execution-evidence" as const;

/** Canonical filename for the per-pull evidence report. */
export const EXECUTION_EVIDENCE_REPORT_FILENAME =
  "execution-evidence-report.json" as const;

/**
 * Hard-gate code emitted when an evidence entry lacks a valid
 * signature at ingest. The orchestrator records the gate violation on
 * the per-pull report and the audit-dossier surfaces it on the
 * regulator-facing evidence table.
 */
export const G12_EXECUTION_EVIDENCE_SIGNED =
  "G12_EXECUTION_EVIDENCE_SIGNED" as const;

/** Allowed execution-verdict values, mirrors the issue's contract. */
export const ALLOWED_EXECUTION_VERDICTS = [
  "pass",
  "fail",
  "blocked",
  "skipped",
] as const;

/** Allowed reviewer-verdict values, mirrors the issue's contract. */
export const ALLOWED_REVIEWER_VERDICTS = [
  "approved",
  "rejected",
  "revised",
] as const;

/** Maximum length of a reviewer-supplied rationale string (chars). */
export const MAX_REVIEWER_RATIONALE_CHARS = 4096;

/** Maximum length of a TMS-supplied case id (chars). */
export const MAX_TMS_CASE_ID_CHARS = 256;

/** Hard floor for `executedAt` values (rejects pre-epoch dates). */
export const EXECUTION_EVIDENCE_MIN_EXECUTED_AT = "1970-01-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Public types — mirror the issue's acceptance criteria.
// ---------------------------------------------------------------------------

/** Branded tenant id reused across the test-intelligence harness. */
export type TenantId = string & { readonly __tenantId: unique symbol };

/** Coerce a raw string into the {@link TenantId} brand. */
export const asTenantId = (raw: string): TenantId => raw as TenantId;

/** Execution verdict reported by the customer's TMS. */
export type ExecutionVerdict = (typeof ALLOWED_EXECUTION_VERDICTS)[number];

/** Reviewer verdict captured against the same case after execution. */
export type ReviewerVerdict = (typeof ALLOWED_REVIEWER_VERDICTS)[number];

/**
 * One labelled execution-evidence entry pulled from a customer TMS.
 *
 * The fields mirror the AC of Issue #2186 verbatim. Every entry is
 * Ed25519-signed by the customer's TMS admin signing key — the
 * harness NEVER trusts an unsigned entry.
 */
export interface ExecutionEvidence {
  readonly testCaseId: string;
  readonly tenantId: TenantId;
  readonly tmsAdapterId: TmsAdapterId;
  readonly tmsCaseId: string;
  readonly executionVerdict: ExecutionVerdict;
  readonly reviewerVerdict?: ReviewerVerdict;
  readonly reviewerRationale?: string;
  readonly executedAt: string;
  readonly attestationSignatureHex: string;
}

/**
 * Canonical signed body — the bytes the customer's TMS admin signs.
 * The signature covers exactly these fields, key-sorted and JSON-
 * canonicalised. `attestationSignatureHex` is NEVER part of the body.
 */
export interface ExecutionEvidenceBody {
  readonly testCaseId: string;
  readonly tenantId: TenantId;
  readonly tmsAdapterId: TmsAdapterId;
  readonly tmsCaseId: string;
  readonly executionVerdict: ExecutionVerdict;
  readonly reviewerVerdict?: ReviewerVerdict;
  readonly reviewerRationale?: string;
  readonly executedAt: string;
}

/** Reasons a single evidence entry may be rejected at ingest. */
export const EXECUTION_EVIDENCE_REJECTION_CODES = [
  "schema_invalid",
  "tenant_mismatch",
  "signature_invalid",
  "unknown_signing_key",
  "stale_executed_at",
] as const;

export type ExecutionEvidenceRejectionCode =
  (typeof EXECUTION_EVIDENCE_REJECTION_CODES)[number];

/** Conflict classes surfaced when reviewer + execution verdicts disagree. */
export const EXECUTION_EVIDENCE_CONFLICT_CODES = [
  "execution_fail_reviewer_approved",
  "execution_pass_reviewer_rejected",
] as const;

export type ExecutionEvidenceConflictCode =
  (typeof EXECUTION_EVIDENCE_CONFLICT_CODES)[number];

/** One rejected entry as it appears on the per-pull report. */
export interface ExecutionEvidenceRejectionEntry {
  readonly testCaseId: string;
  readonly tmsCaseId: string;
  readonly tmsAdapterId: TmsAdapterId;
  readonly code: ExecutionEvidenceRejectionCode;
  readonly detail: string;
}

/** One conflict row attached to the per-pull report. */
export interface ExecutionEvidenceConflictEntry {
  readonly testCaseId: string;
  readonly tmsAdapterId: TmsAdapterId;
  readonly tmsCaseId: string;
  readonly executionVerdict: ExecutionVerdict;
  readonly reviewerVerdict: ReviewerVerdict;
  readonly code: ExecutionEvidenceConflictCode;
  readonly evidencePath: string;
}

/** Per-verdict count summary. */
export interface ExecutionEvidenceVerdictCounts {
  readonly pass: number;
  readonly fail: number;
  readonly blocked: number;
  readonly skipped: number;
}

/**
 * Per-pull report artifact (`execution-evidence-report.json`). The
 * audit-dossier renderer (W6-1) surfaces this verbatim when present.
 */
export interface ExecutionEvidenceReport {
  readonly schemaVersion: typeof EXECUTION_EVIDENCE_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly tenantId: TenantId;
  readonly tmsAdapterId: TmsAdapterId;
  readonly projectId: string;
  readonly sinceIso: string;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly conflictCount: number;
  readonly verdictCounts: ExecutionEvidenceVerdictCounts;
  readonly reviewerConflictCounts: Readonly<
    Record<ExecutionEvidenceConflictCode, number>
  >;
  readonly rejections: readonly ExecutionEvidenceRejectionEntry[];
  readonly conflicts: readonly ExecutionEvidenceConflictEntry[];
  readonly signingKeyFingerprintSha256: string;
}

/**
 * Inputs to {@link ingestExecutionEvidence}.
 *
 * The function is deliberately context-light: the orchestrator wires
 * the tenant output root + verifying public key + clock so the module
 * itself stays free of singletons.
 */
export interface IngestExecutionEvidenceInput {
  readonly evidence: readonly ExecutionEvidence[];
  readonly context: ExecutionEvidenceIngestContext;
}

/** Shared ingest context — everything that's not the evidence batch. */
export interface ExecutionEvidenceIngestContext {
  /** Stable tenant id; must match every {@link ExecutionEvidence.tenantId}. */
  readonly tenantId: TenantId;
  /**
   * Path to the tenant directory laid down by `test-intelligence onboard`
   * (`<output-root>/tenants/<tenantId>/`). The module writes evidence
   * under `<tenantDir>/calibration-corpus/execution-evidence/<yyyy-MM>/`.
   */
  readonly tenantDir: string;
  /**
   * The TMS admin Ed25519 public key (SPKI PEM) the customer registered
   * during onboarding. Every evidence entry must verify against this
   * key. Operators rotate the key by re-signing the corpus offline.
   */
  readonly verifyingPublicKeyPem: string;
  /** TMS adapter id this batch was pulled from (for the report). */
  readonly tmsAdapterId: TmsAdapterId;
  /** Project id this batch was pulled for (for the report). */
  readonly projectId: string;
  /** ISO-8601 `--since` argument (for the report). */
  readonly sinceIso: string;
  /** Deterministic clock seam — defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /**
   * Optional active tenant scope. When set, the module records a
   * persistent-store read so the W6-2 isolation attestation captures
   * the ingest call. Cross-tenant ingestion still throws regardless of
   * whether the scope is set, because {@link tenantId} on the evidence
   * is matched against {@link context.tenantId}.
   */
  readonly tenantScope?: TenantScope;
}

/** Aggregated outcome of an ingest call. */
export interface IngestExecutionEvidenceResult {
  readonly accepted: number;
  readonly rejected: number;
  readonly report: ExecutionEvidenceReport;
  /** Absolute path of the persisted per-pull report. */
  readonly reportPath: string;
  /** Absolute paths of every persisted evidence entry, sorted. */
  readonly acceptedEvidencePaths: readonly string[];
}

// ---------------------------------------------------------------------------
// Public errors
// ---------------------------------------------------------------------------

/**
 * Hard-gate error thrown when the strict-signature option is enabled
 * AND at least one entry fails verification. The orchestrator records
 * the gate on the per-pull report and surfaces the failure to the
 * CLI exit code.
 *
 * The default ingest call is **non-strict**: bad signatures are
 * dropped with a report entry. The CLI's `--strict-signature` switch
 * promotes the gate to a hard CI failure.
 */
export class ExecutionEvidenceSignatureGateError extends Error {
  readonly code: typeof G12_EXECUTION_EVIDENCE_SIGNED = G12_EXECUTION_EVIDENCE_SIGNED;
  readonly rejectedCount: number;
  readonly rejections: readonly ExecutionEvidenceRejectionEntry[];
  constructor(rejections: readonly ExecutionEvidenceRejectionEntry[]) {
    super(
      `${G12_EXECUTION_EVIDENCE_SIGNED} failed: ${rejections.length} unsigned or tampered evidence entr${
        rejections.length === 1 ? "y" : "ies"
      } refused at ingest.`,
    );
    this.name = "ExecutionEvidenceSignatureGateError";
    this.rejectedCount = rejections.length;
    this.rejections = rejections;
  }
}

/** Catastrophic mismatch between evidence.tenantId and context.tenantId. */
export class ExecutionEvidenceTenantMismatchError extends Error {
  readonly expected: TenantId;
  readonly actual: TenantId;
  constructor(expected: TenantId, actual: TenantId) {
    super(
      `execution-evidence ingest tenant mismatch: expected "${expected}", got "${actual}"`,
    );
    this.name = "ExecutionEvidenceTenantMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the canonical body bytes the customer's TMS admin must sign.
 * Exposed so adapter tests can produce signed fixtures without
 * importing the rest of the module.
 */
export const buildExecutionEvidenceSigningBytes = (
  evidence: ExecutionEvidence,
): Buffer => {
  const body: ExecutionEvidenceBody = stripSignature(evidence);
  return Buffer.from(canonicalJson(body as unknown as Record<string, unknown>), "utf8");
};

/**
 * Compute the public-key fingerprint stamped on every report. The
 * fingerprint is the sha256 of the SPKI DER bytes — identical to the
 * fingerprint stamped on the audit-dossier signing key.
 */
export const computeVerifyingKeyFingerprint = (
  publicKeyPem: string,
): string => {
  const key = createPublicKey(publicKeyPem);
  const der = key.export({ format: "der", type: "spki" }) as Buffer;
  return sha256Hex(der.toString("base64"));
};

/**
 * Ingest a batch of execution-evidence entries from one TMS pull.
 *
 * The function is the single entry point for the CLI and any
 * orchestrator binding. It performs:
 *
 *   1. Schema + tenant validation.
 *   2. Per-entry Ed25519 signature verification.
 *   3. Persistence under
 *      `<tenantDir>/calibration-corpus/execution-evidence/<yyyy-MM>/<sha256>.json`.
 *   4. Conflict detection (`pass + rejected`, `fail + approved`).
 *   5. Atomic write of `execution-evidence-report.json` under the
 *      tenant directory's calibration-corpus root.
 *
 * The return value reports the accepted / rejected split per the AC.
 */
export const ingestExecutionEvidence = async (
  input: IngestExecutionEvidenceInput,
): Promise<IngestExecutionEvidenceResult> => {
  const { context } = input;
  const now = context.now ?? (() => new Date());

  if (context.tenantScope !== undefined) {
    recordPersistentStoreRead("test-execution-evidence-ingest", context.tenantScope);
  }

  const verifyingKey = createPublicKey(context.verifyingPublicKeyPem);
  if (verifyingKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError(
      "execution-evidence ingest: verifyingPublicKeyPem must be an Ed25519 SPKI PEM",
    );
  }
  const keyFingerprint = computeVerifyingKeyFingerprint(
    context.verifyingPublicKeyPem,
  );

  const evidenceDir = resolveEvidenceCorpusDir(context.tenantDir);
  const rejections: ExecutionEvidenceRejectionEntry[] = [];
  const conflicts: ExecutionEvidenceConflictEntry[] = [];
  const acceptedPaths: string[] = [];
  const verdictCounts: { pass: number; fail: number; blocked: number; skipped: number } = {
    pass: 0,
    fail: 0,
    blocked: 0,
    skipped: 0,
  };
  const reviewerConflictCounts: Record<ExecutionEvidenceConflictCode, number> = {
    execution_fail_reviewer_approved: 0,
    execution_pass_reviewer_rejected: 0,
  };

  for (const entry of input.evidence) {
    const schemaError = validateEvidenceShape(entry);
    if (schemaError !== undefined) {
      rejections.push({
        testCaseId: safeId(entry.testCaseId),
        tmsCaseId: safeId(entry.tmsCaseId),
        tmsAdapterId: entry.tmsAdapterId,
        code: "schema_invalid",
        detail: schemaError,
      });
      continue;
    }
    if (entry.tenantId !== context.tenantId) {
      rejections.push({
        testCaseId: entry.testCaseId,
        tmsCaseId: entry.tmsCaseId,
        tmsAdapterId: entry.tmsAdapterId,
        code: "tenant_mismatch",
        detail: `evidence tenantId "${entry.tenantId}" does not match context tenantId "${context.tenantId}"`,
      });
      continue;
    }
    if (entry.executedAt < EXECUTION_EVIDENCE_MIN_EXECUTED_AT) {
      rejections.push({
        testCaseId: entry.testCaseId,
        tmsCaseId: entry.tmsCaseId,
        tmsAdapterId: entry.tmsAdapterId,
        code: "stale_executed_at",
        detail: `executedAt "${entry.executedAt}" predates the hard floor "${EXECUTION_EVIDENCE_MIN_EXECUTED_AT}"`,
      });
      continue;
    }

    const verificationError = verifyEvidenceSignature(entry, verifyingKey);
    if (verificationError !== undefined) {
      rejections.push({
        testCaseId: entry.testCaseId,
        tmsCaseId: entry.tmsCaseId,
        tmsAdapterId: entry.tmsAdapterId,
        code: "signature_invalid",
        detail: verificationError,
      });
      continue;
    }

    const partition = monthPartition(entry.executedAt);
    const partitionDir = join(evidenceDir, partition);
    const body: ExecutionEvidenceBody = stripSignature(entry);
    const bodyDigest = sha256Hex(canonicalJson(body as unknown as Record<string, unknown>));
    const evidencePath = join(partitionDir, `${bodyDigest}.json`);
    const persistedRecord = {
      schemaVersion: EXECUTION_EVIDENCE_SCHEMA_VERSION,
      ingestedAt: now().toISOString(),
      signingKeyFingerprintSha256: keyFingerprint,
      evidence: entry,
    };
    await writeAtomicJson(evidencePath, persistedRecord);
    acceptedPaths.push(evidencePath);
    verdictCounts[entry.executionVerdict] += 1;

    const conflictCode = detectConflict(entry);
    if (conflictCode !== undefined && entry.reviewerVerdict !== undefined) {
      conflicts.push({
        testCaseId: entry.testCaseId,
        tmsAdapterId: entry.tmsAdapterId,
        tmsCaseId: entry.tmsCaseId,
        executionVerdict: entry.executionVerdict,
        reviewerVerdict: entry.reviewerVerdict,
        code: conflictCode,
        evidencePath,
      });
      reviewerConflictCounts[conflictCode] += 1;
    }
  }

  acceptedPaths.sort((a, b) => a.localeCompare(b));
  rejections.sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));
  conflicts.sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));

  const report: ExecutionEvidenceReport = {
    schemaVersion: EXECUTION_EVIDENCE_SCHEMA_VERSION,
    generatedAt: now().toISOString(),
    tenantId: context.tenantId,
    tmsAdapterId: context.tmsAdapterId,
    projectId: context.projectId,
    sinceIso: context.sinceIso,
    acceptedCount: acceptedPaths.length,
    rejectedCount: rejections.length,
    conflictCount: conflicts.length,
    verdictCounts,
    reviewerConflictCounts,
    rejections,
    conflicts,
    signingKeyFingerprintSha256: keyFingerprint,
  };

  const reportPath = join(
    context.tenantDir,
    "calibration-corpus",
    EXECUTION_EVIDENCE_REPORT_FILENAME,
  );
  await writeAtomicJson(reportPath, report);

  return {
    accepted: acceptedPaths.length,
    rejected: rejections.length,
    report,
    reportPath,
    acceptedEvidencePaths: acceptedPaths,
  };
};

/**
 * Walk the per-tenant evidence corpus and return every accepted
 * evidence body grouped by `(locale-blind) yyyy-MM` partition. Used
 * by the W7-3 quarterly refit reader, the audit-dossier (W6-1), and
 * the adversarial corpus promotion job — all three expect a
 * deterministic, sorted enumeration.
 *
 * `corpusDir` is the per-tenant calibration-corpus root
 * (`<tenantDir>/calibration-corpus/`). The function walks the
 * `execution-evidence/<yyyy-MM>/` partitions inside it. Callers that
 * have only the tenant directory can pass
 * `join(tenantDir, "calibration-corpus")`.
 */
export const loadPersistedExecutionEvidence = async (
  corpusDir: string,
): Promise<readonly PersistedExecutionEvidenceRecord[]> => {
  const root = resolve(corpusDir, EXECUTION_EVIDENCE_CORPUS_DIRNAME);
  const partitions = await readdirSafe(root);
  partitions.sort((a, b) => a.localeCompare(b));
  const out: PersistedExecutionEvidenceRecord[] = [];
  for (const partition of partitions) {
    const partitionDir = join(root, partition);
    const files = await readdirSafe(partitionDir);
    files.sort((a, b) => a.localeCompare(b));
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(partitionDir, file);
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedExecutionEvidenceRecord;
      out.push(parsed);
    }
  }
  return out;
};

/** Shape persisted under each evidence file. Stable schema version. */
export interface PersistedExecutionEvidenceRecord {
  readonly schemaVersion: typeof EXECUTION_EVIDENCE_SCHEMA_VERSION;
  readonly ingestedAt: string;
  readonly signingKeyFingerprintSha256: string;
  readonly evidence: ExecutionEvidence;
}

/**
 * Summarise the persisted corpus for the audit-dossier renderer. The
 * dossier surfaces this block under "Execution-evidence loop" when at
 * least one record exists.
 */
export interface ExecutionEvidenceDossierSummary {
  readonly schemaVersion: typeof EXECUTION_EVIDENCE_SCHEMA_VERSION;
  readonly totalEvidence: number;
  readonly verdictCounts: ExecutionEvidenceVerdictCounts;
  readonly reviewerConflictCounts: Readonly<
    Record<ExecutionEvidenceConflictCode, number>
  >;
  readonly tmsAdapterCounts: Readonly<Partial<Record<TmsAdapterId, number>>>;
  readonly distinctSigningKeyFingerprints: readonly string[];
  readonly earliestExecutedAt: string;
  readonly latestExecutedAt: string;
}

/**
 * Build the deterministic dossier summary from the persisted records.
 * The function never reads from any file — callers pass the records
 * loaded via {@link loadPersistedExecutionEvidence}.
 */
export const summarizeExecutionEvidenceForDossier = (
  records: readonly PersistedExecutionEvidenceRecord[],
): ExecutionEvidenceDossierSummary => {
  const verdictCounts: { pass: number; fail: number; blocked: number; skipped: number } = {
    pass: 0,
    fail: 0,
    blocked: 0,
    skipped: 0,
  };
  const reviewerConflictCounts: Record<ExecutionEvidenceConflictCode, number> = {
    execution_fail_reviewer_approved: 0,
    execution_pass_reviewer_rejected: 0,
  };
  const adapterCounts: Partial<Record<TmsAdapterId, number>> = {};
  const fingerprints = new Set<string>();
  let earliest = "";
  let latest = "";
  for (const record of records) {
    const v = record.evidence.executionVerdict;
    verdictCounts[v] += 1;
    const adapter = record.evidence.tmsAdapterId;
    adapterCounts[adapter] = (adapterCounts[adapter] ?? 0) + 1;
    fingerprints.add(record.signingKeyFingerprintSha256);
    const conflict = detectConflict(record.evidence);
    if (conflict !== undefined) reviewerConflictCounts[conflict] += 1;
    if (earliest === "" || record.evidence.executedAt < earliest) {
      earliest = record.evidence.executedAt;
    }
    if (latest === "" || record.evidence.executedAt > latest) {
      latest = record.evidence.executedAt;
    }
  }
  return {
    schemaVersion: EXECUTION_EVIDENCE_SCHEMA_VERSION,
    totalEvidence: records.length,
    verdictCounts,
    reviewerConflictCounts,
    tmsAdapterCounts: adapterCounts,
    distinctSigningKeyFingerprints: [...fingerprints].sort((a, b) =>
      a.localeCompare(b),
    ),
    earliestExecutedAt: earliest,
    latestExecutedAt: latest,
  };
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const stripSignature = (
  evidence: ExecutionEvidence,
): ExecutionEvidenceBody => {
  const body: Record<string, unknown> = {
    testCaseId: evidence.testCaseId,
    tenantId: evidence.tenantId,
    tmsAdapterId: evidence.tmsAdapterId,
    tmsCaseId: evidence.tmsCaseId,
    executionVerdict: evidence.executionVerdict,
    executedAt: evidence.executedAt,
  };
  if (evidence.reviewerVerdict !== undefined) {
    body["reviewerVerdict"] = evidence.reviewerVerdict;
  }
  if (evidence.reviewerRationale !== undefined) {
    body["reviewerRationale"] = evidence.reviewerRationale;
  }
  return body as unknown as ExecutionEvidenceBody;
};

const verifyEvidenceSignature = (
  evidence: ExecutionEvidence,
  key: KeyObject,
): string | undefined => {
  if (
    typeof evidence.attestationSignatureHex !== "string" ||
    evidence.attestationSignatureHex.length === 0
  ) {
    return "missing attestationSignatureHex";
  }
  if (!/^[0-9a-f]+$/i.test(evidence.attestationSignatureHex)) {
    return "attestationSignatureHex is not lower-case hex";
  }
  if (evidence.attestationSignatureHex.length !== 128) {
    return "attestationSignatureHex must be 64 bytes (128 hex chars)";
  }
  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(evidence.attestationSignatureHex, "hex");
  } catch {
    return "attestationSignatureHex is not valid hex";
  }
  const body = buildExecutionEvidenceSigningBytes(evidence);
  const ok = cryptoVerify(null, body, key, signatureBytes);
  if (!ok) return "signature verification failed";
  return undefined;
};

const validateEvidenceShape = (
  evidence: ExecutionEvidence,
): string | undefined => {
  // Adapters return strongly-typed objects, but external callers (CLI
  // env, third-party orchestrators) may hand us bytes-shaped-as-objects
  // that bypass the compiler — keep the runtime checks even though the
  // declared type narrows them.
  if ((evidence as unknown) === null || typeof evidence !== "object") {
    return "evidence must be a non-null object";
  }
  const raw = evidence as unknown as Record<string, unknown>;
  if (
    typeof raw["testCaseId"] !== "string" ||
    (raw["testCaseId"] as string).length === 0
  ) {
    return "testCaseId must be a non-empty string";
  }
  if (
    typeof raw["tenantId"] !== "string" ||
    (raw["tenantId"] as string).length === 0
  ) {
    return "tenantId must be a non-empty string";
  }
  if (
    typeof raw["tmsAdapterId"] !== "string" ||
    (raw["tmsAdapterId"] as string).length === 0
  ) {
    return "tmsAdapterId must be a non-empty string";
  }
  if (
    typeof raw["tmsCaseId"] !== "string" ||
    (raw["tmsCaseId"] as string).length === 0 ||
    (raw["tmsCaseId"] as string).length > MAX_TMS_CASE_ID_CHARS
  ) {
    return `tmsCaseId must be a 1..${MAX_TMS_CASE_ID_CHARS}-char string`;
  }
  if (
    !ALLOWED_EXECUTION_VERDICTS.includes(
      raw["executionVerdict"] as ExecutionVerdict,
    )
  ) {
    return `executionVerdict "${stringify(raw["executionVerdict"])}" is not allowed`;
  }
  if (
    raw["reviewerVerdict"] !== undefined &&
    !ALLOWED_REVIEWER_VERDICTS.includes(
      raw["reviewerVerdict"] as ReviewerVerdict,
    )
  ) {
    return `reviewerVerdict "${stringify(raw["reviewerVerdict"])}" is not allowed`;
  }
  if (
    raw["reviewerRationale"] !== undefined &&
    (typeof raw["reviewerRationale"] !== "string" ||
      (raw["reviewerRationale"] as string).length > MAX_REVIEWER_RATIONALE_CHARS)
  ) {
    return `reviewerRationale must be a string ≤ ${MAX_REVIEWER_RATIONALE_CHARS} chars`;
  }
  if (
    typeof raw["executedAt"] !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(
      raw["executedAt"] as string,
    )
  ) {
    return "executedAt must be an ISO-8601 UTC timestamp ending with Z";
  }
  if (typeof raw["attestationSignatureHex"] !== "string") {
    return "attestationSignatureHex must be a string";
  }
  return undefined;
};

const stringify = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  try {
    const serialised = JSON.stringify(value);
    return typeof serialised === "string" ? serialised : "(unserialisable)";
  } catch {
    return "(unserialisable)";
  }
};

const detectConflict = (
  evidence: ExecutionEvidence,
): ExecutionEvidenceConflictCode | undefined => {
  if (evidence.reviewerVerdict === undefined) return undefined;
  if (
    evidence.executionVerdict === "fail" &&
    evidence.reviewerVerdict === "approved"
  ) {
    return "execution_fail_reviewer_approved";
  }
  if (
    evidence.executionVerdict === "pass" &&
    evidence.reviewerVerdict === "rejected"
  ) {
    return "execution_pass_reviewer_rejected";
  }
  return undefined;
};

const monthPartition = (executedAtIso: string): string => {
  return executedAtIso.slice(0, 7); // YYYY-MM
};

const resolveEvidenceCorpusDir = (tenantDir: string): string =>
  resolve(tenantDir, "calibration-corpus", EXECUTION_EVIDENCE_CORPUS_DIRNAME);

const readdirSafe = async (path: string): Promise<string[]> => {
  try {
    return await readdir(path);
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw err;
  }
};

const writeAtomicJson = async (
  destinationPath: string,
  payload: unknown,
): Promise<void> => {
  await mkdir(dirname(destinationPath), { recursive: true });
  const stagedPath = `${destinationPath}.tmp`;
  const bytes = `${canonicalJson(payload as Record<string, unknown>)}\n`;
  await writeFile(stagedPath, bytes, { encoding: "utf8", mode: 0o644 });
  await rename(stagedPath, destinationPath);
};

const safeId = (raw: unknown): string => {
  if (typeof raw !== "string") return "(unknown)";
  if (raw.length === 0) return "(empty)";
  return raw.length > 128 ? `${raw.slice(0, 125)}...` : raw;
};
