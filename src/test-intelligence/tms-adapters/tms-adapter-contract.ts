/**
 * Production-grade TMS adapter contract (Issue #2183, Wave 8).
 *
 * The contract is the narrow surface every enterprise TMS adapter
 * (Jira Xray, OpenText/HP ALM, Tricentis qTest, Siemens Polarion)
 * implements. The orchestrator in `tms-push-pipeline.ts` drives the
 * adapter lifecycle and writes the per-run `tms-push-report.json`
 * artifact.
 *
 * The seven required methods are evaluated in this order on every push
 * run:
 *
 *   1. `connect`            — open a session with the TMS endpoint;
 *                             returns an opaque session handle.
 *   2. `validateProject`    — confirm the configured project id exists
 *                             on the tenant before any write.
 *   3. `mapTestCase`        — translate a provider-neutral
 *                             `QcMappingPreviewEntry` into the
 *                             TMS-specific payload shape. Pure (no I/O).
 *   4. `pushTestCase`       — push a single mapped case with idempotency
 *                             enforcement. Returns the per-case verdict
 *                             plus the assigned TMS test case id.
 *   5. `pushTestCaseBatch`  — bulk push N cases (default batch size 50).
 *                             Implementations MAY parallelise within
 *                             provider rate limits.
 *   6. `pollSyncStatus`     — read back the persisted state of a
 *                             previously pushed case (round-trip
 *                             evidence used by the audit dossier).
 *   7. `disconnect`         — close the session; idempotent.
 *
 * Hard invariants (enforced by the orchestrator + adapters jointly):
 *
 *   - No method returns a resolved URL. Adapters surface symbolic
 *     `endpointAlias` strings only.
 *   - No method returns raw response bodies. Failure detail is
 *     pre-redacted with `redactHighRiskSecrets` and length-bounded.
 *   - No method embeds credentials. Bearer/PAT tokens travel through
 *     the `TmsAdapterSession` opaque handle and never reach the report.
 *   - Every adapter implementation MUST be deterministic given a fixed
 *     clock + injected `TmsHttpClient` so tests can assert byte-stable
 *     report artifacts.
 *
 * The contract intentionally lives in the test-intelligence module
 * rather than `contracts/index.ts` because the operational shapes
 * (session handles, http client interfaces, error classes) are
 * implementation concerns. The persisted artifact contract
 * (`TmsPushReportArtifact`) lives in `contracts/index.ts` so external
 * consumers can read it without importing this module.
 */

import type {
  QcMappingPreviewEntry,
  TmsAdapterId,
  TmsAuthKind,
  TmsPushVerdict,
} from "../../contracts/index.js";

/**
 * Stable clock abstraction reused from the QC adapter family so push
 * report timestamps stay deterministic in tests.
 */
export interface TmsAdapterClock {
  now(): string;
}

/** Authentication credentials passed to `connect`. */
export type TmsCredentials =
  | { kind: "pat"; token: string; principalId?: string }
  | {
      kind: "oauth2";
      accessToken: string;
      refreshToken?: string;
      principalId?: string;
    }
  | { kind: "bearer"; token: string; principalId?: string };

/** Connect-time inputs supplied by the orchestrator. */
export interface TmsConnectInput {
  /**
   * Symbolic alias for the TMS endpoint (e.g. `xray-prod`,
   * `alm-eu-west-1`). Adapters resolve the actual URL through their
   * injected `TmsHttpClient`. NEVER carries the resolved URL.
   */
  endpointAlias: string;
  /** Project id inside the TMS (Jira key, ALM project name, etc.). */
  projectId: string;
  /** Stable tenant id used to derive idempotency keys. */
  tenantId: string;
  /** Authentication material — never persisted on the report. */
  credentials: TmsCredentials;
}

/**
 * Opaque session handle returned by `connect` and threaded through
 * subsequent calls. Adapters carry their own internal state inside the
 * handle (e.g. cookie jar, OAuth refresh state). The orchestrator
 * NEVER inspects the handle except to pass it back.
 */
export interface TmsAdapterSession {
  readonly endpointAlias: string;
  readonly projectId: string;
  readonly tenantId: string;
  /**
   * Stable principal id surfaced on the push report when the adapter
   * accepted the credentials. Empty string when the session was
   * created by an adapter that does not advertise a principal id.
   */
  readonly principalId: string;
  /** Adapter-internal opaque state — orchestrator never reads it. */
  readonly internal: Readonly<Record<string, unknown>>;
}

/** Outcome of `validateProject`. */
export type TmsValidateProjectResult =
  | { ok: true; resolvedProjectId: string }
  | {
      ok: false;
      /** Stable adapter-defined code, e.g. `project_not_found`. */
      code: string;
      /** Pre-redacted, length-bounded message. */
      message: string;
    };

/**
 * TMS-specific mapped payload preview produced by `mapTestCase`. The
 * shape stays opaque to the orchestrator — only the adapter knows how
 * to interpret it. The `idempotencyKey` is required so the orchestrator
 * can record it on the report without re-deriving it per adapter.
 */
export interface TmsMappedCase {
  testCaseId: string;
  /** SHA-256 hex of `(tenantId|runId|testCaseId)` derived by `mapTestCase`. */
  idempotencyKey: string;
  /** Adapter-specific payload sent to `pushTestCase`. */
  payload: Readonly<Record<string, unknown>>;
}

/** Push attempt result for a single case. */
export interface TmsPushAttemptResult {
  testCaseId: string;
  idempotencyKey: string;
  verdict: TmsPushVerdict;
  /** TMS-assigned id; empty for `failed`. */
  tmsTestCaseId: string;
  /** Adapter-defined error code; empty for non-failures. */
  tmsErrorCode: string;
  /** Pre-redacted, length-bounded message; empty for non-failures. */
  tmsErrorMessage: string;
  /** Number of HTTP attempts performed (1 + retries). */
  attemptCount: number;
}

/** Result of a `pushTestCaseBatch` call. */
export interface TmsPushBatchResult {
  /** Per-case results, in the same order as the input batch. */
  results: TmsPushAttemptResult[];
}

/**
 * Outcome of `pollSyncStatus`. Adapters that cannot read back the
 * pushed case (e.g. read-disabled tenant) MUST return
 * `{ found: false, code: "read_unsupported", ... }` rather than
 * throwing — the orchestrator records the absence as round-trip
 * evidence rather than as a failure.
 */
export type TmsSyncStatus =
  | {
      found: true;
      /** TMS-assigned id mirroring the push response. */
      tmsTestCaseId: string;
      /** Adapter-defined lifecycle state, e.g. `Active`, `Approved`. */
      state: string;
    }
  | { found: false; code: string; message: string };

/**
 * Provider-neutral HTTP client surface adapters depend on. Tests
 * inject a deterministic in-memory client; production injects a
 * `node:fetch`-backed implementation. The default factory in
 * `createTmsAdapter*` REQUIRES the caller to supply this — the
 * adapter NEVER attempts a network call without an explicit client.
 *
 * The client owns:
 *   - URL resolution from `endpointAlias`.
 *   - Bearer/PAT/OAuth header assembly.
 *   - Per-request `Idempotency-Key` header.
 *   - Connect timeouts + transport-level error mapping to
 *     `TmsTransportError`.
 *
 * Adapters layer business logic on top.
 */
export interface TmsHttpClient {
  request(input: TmsHttpRequest): Promise<TmsHttpResponse>;
}

/**
 * Single HTTP request issued by an adapter. The body is JSON-serialisable;
 * adapters that emit XML/multipart/WebDAV must wrap a typed buffer in
 * `bodyBytes` instead of `body`.
 */
export interface TmsHttpRequest {
  /** Symbolic alias resolved by the client to a full URL. */
  endpointAlias: string;
  /** Path segment relative to the resolved base URL. */
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Header map — must NOT include `Authorization`; the client adds it. */
  headers?: Readonly<Record<string, string>>;
  /** JSON-serialisable body. Mutually exclusive with `bodyBytes`. */
  body?: Readonly<Record<string, unknown>> | readonly unknown[];
  /** Pre-encoded payload (XML, WebDAV PROPFIND, multipart). */
  bodyBytes?: Uint8Array;
  /** Content-Type override when `bodyBytes` is set. */
  contentType?: string;
  /** Stable per-request idempotency key sent as `Idempotency-Key`. */
  idempotencyKey?: string;
  /** Authentication context applied by the client. */
  credentials: TmsCredentials;
  /** Timeout budget in milliseconds; client enforces it. */
  timeoutMs: number;
}

/**
 * Single HTTP response surfaced to an adapter. The client returns the
 * response body as a parsed JSON value when `application/json`, else as
 * raw bytes. The status is the HTTP status code (200..599).
 */
export interface TmsHttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  /** Parsed JSON body when applicable; absent otherwise. */
  body?: unknown;
  /** Raw bytes when the response was not JSON. */
  bodyBytes?: Uint8Array;
}

/**
 * Failure class adapter implementations may throw to mark a specific
 * failure category. The orchestrator records the class on the per-case
 * record. Anything else is mapped to `unknown_error`.
 */
export class TmsAdapterError extends Error {
  readonly adapterId: TmsAdapterId;
  readonly code: string;
  readonly detail: string;
  constructor(adapterId: TmsAdapterId, code: string, detail: string) {
    super(`TmsAdapterError(${adapterId}/${code}): ${detail}`);
    this.adapterId = adapterId;
    this.code = code;
    this.detail = detail;
    this.name = "TmsAdapterError";
  }
}

/**
 * Specialisation thrown by `TmsHttpClient` implementations on transport
 * faults (DNS, TLS, socket reset, body truncation). The orchestrator
 * retries transport errors with exponential backoff.
 */
export class TmsTransportError extends TmsAdapterError {
  constructor(adapterId: TmsAdapterId, detail: string) {
    super(adapterId, "transport_error", detail);
    this.name = "TmsTransportError";
  }
}

/**
 * Specialisation thrown by adapters when the configured credentials
 * are rejected by the TMS (HTTP 401/403). NEVER retried — fail fast.
 */
export class TmsAuthError extends TmsAdapterError {
  constructor(adapterId: TmsAdapterId, detail: string) {
    super(adapterId, "auth_failed", detail);
    this.name = "TmsAuthError";
  }
}

/**
 * Specialisation thrown by adapters when the TMS rejected the payload
 * with a 4xx validation error that no retry will fix. NEVER retried.
 */
export class TmsValidationError extends TmsAdapterError {
  constructor(adapterId: TmsAdapterId, code: string, detail: string) {
    super(adapterId, code, detail);
    this.name = "TmsValidationError";
  }
}

/**
 * Specialisation thrown by adapters when the TMS reported a 429 rate
 * limit. The orchestrator obeys `Retry-After` headers when present.
 */
export class TmsRateLimitError extends TmsAdapterError {
  readonly retryAfterMs: number;
  constructor(adapterId: TmsAdapterId, retryAfterMs: number, detail: string) {
    super(adapterId, "rate_limited", detail);
    this.retryAfterMs = retryAfterMs;
    this.name = "TmsRateLimitError";
  }
}

/**
 * Raw execution-evidence payload emitted by a TMS adapter's
 * `pullExecutions` method (Issue #2186, W8-4).
 *
 * The shape mirrors {@link ExecutionEvidence} in
 * `test-execution-evidence-ingest.ts` deliberately — the adapter is
 * responsible for translating the TMS-specific response into this
 * canonical, signature-bearing shape. The orchestrator then verifies
 * each entry against the tenant's TMS-admin Ed25519 key and persists
 * the accepted entries under the per-tenant calibration corpus.
 *
 * Hard invariants:
 *   - Every entry MUST carry a non-empty
 *     `attestationSignatureHex` (lower-case hex). Adapters MUST NOT
 *     synthesise signatures; they only forward the bytes the TMS or
 *     its trusted webhook signer attached to each row.
 *   - `tenantId` MUST equal the session tenant the adapter is
 *     connected as. Cross-tenant entries are dropped at ingest with
 *     `tenant_mismatch`.
 *   - `executedAt` MUST be ISO-8601 UTC ending with `Z`.
 */
export interface TmsRawExecutionEvidence {
  readonly testCaseId: string;
  readonly tenantId: string;
  readonly tmsAdapterId: TmsAdapterId;
  readonly tmsCaseId: string;
  readonly executionVerdict: "pass" | "fail" | "blocked" | "skipped";
  readonly reviewerVerdict?: "approved" | "rejected" | "revised";
  readonly reviewerRationale?: string;
  readonly executedAt: string;
  readonly attestationSignatureHex: string;
}

/** Result of a `pullExecutions` call. */
export interface TmsPullExecutionsResult {
  /** Per-entry list, in adapter-defined order. The orchestrator sorts. */
  readonly evidence: readonly TmsRawExecutionEvidence[];
}

/**
 * Provider-neutral adapter facade. Every method is async to keep the
 * lifecycle contract uniform across adapters.
 */
export interface TmsAdapter {
  readonly adapterId: TmsAdapterId;
  readonly version: string;
  /** Authentication kinds this adapter accepts. */
  readonly supportedAuthKinds: ReadonlySet<TmsAuthKind>;
  connect(input: TmsConnectInput): Promise<TmsAdapterSession>;
  validateProject(session: TmsAdapterSession): Promise<TmsValidateProjectResult>;
  mapTestCase(input: {
    session: TmsAdapterSession;
    runId: string;
    entry: QcMappingPreviewEntry;
  }): TmsMappedCase;
  pushTestCase(input: {
    session: TmsAdapterSession;
    mapped: TmsMappedCase;
    /** When true, the adapter MUST NOT issue any state-mutating call. */
    dryRun: boolean;
  }): Promise<TmsPushAttemptResult>;
  pushTestCaseBatch(input: {
    session: TmsAdapterSession;
    mapped: readonly TmsMappedCase[];
    dryRun: boolean;
  }): Promise<TmsPushBatchResult>;
  pollSyncStatus(input: {
    session: TmsAdapterSession;
    tmsTestCaseId: string;
  }): Promise<TmsSyncStatus>;
  /**
   * Pull execution evidence for cases previously pushed by this
   * adapter. The `sinceIso` argument is an ISO-8601 UTC timestamp;
   * adapters MUST return only entries whose `executedAt >= sinceIso`.
   *
   * Each returned entry carries a signature bytes-string that MUST
   * verify against the tenant's TMS-admin Ed25519 public key — the
   * orchestrator (`ingestExecutionEvidence`) refuses unsigned and
   * tampered entries (G12 hard gate).
   *
   * Adapters that cannot pull (e.g. read-disabled tenant) return an
   * empty `evidence` array. Network errors propagate as
   * {@link TmsTransportError} so the orchestrator can retry.
   */
  pullExecutions(input: {
    session: TmsAdapterSession;
    sinceIso: string;
  }): Promise<TmsPullExecutionsResult>;
  disconnect(session: TmsAdapterSession): Promise<void>;
}

/**
 * Default batch size used by the orchestrator and recommended to every
 * adapter. Issue #2183 mandates 50 cases per batch as the production
 * default. Adapters may chunk further internally if their TMS imposes
 * a smaller per-request limit.
 */
export const DEFAULT_TMS_PUSH_BATCH_SIZE = 50 as const;

/**
 * Default per-request timeout (10s). Applies to every individual HTTP
 * request the adapter issues; the orchestrator enforces a separate
 * end-to-end ceiling on long-running batch runs.
 */
export const DEFAULT_TMS_REQUEST_TIMEOUT_MS = 10_000 as const;

/**
 * Maximum sanitised failure detail length stamped on each push report
 * entry. Mirrors `MAX_FAILURE_DETAIL_LENGTH` in `qc-alm-api-transfer.ts`.
 */
export const MAX_TMS_FAILURE_DETAIL_LENGTH = 240 as const;
