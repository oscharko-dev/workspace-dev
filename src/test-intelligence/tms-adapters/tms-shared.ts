/**
 * Shared TMS adapter utilities (Issue #2183, Wave 8).
 *
 * Pure helpers reused by every adapter and the push orchestrator:
 *
 *   - `computeTmsIdempotencyKey` — `sha256(tenantId|runId|testCaseId)`.
 *     Stable per-tuple so re-running on the same approved set NEVER
 *     creates duplicate cases on the TMS.
 *   - `loadTmsCredentialsFromEnv` — reads
 *     `WORKSPACE_TEST_SPACE_TMS_<NAME>_TOKEN` (PAT/bearer) or
 *     `WORKSPACE_TEST_SPACE_TMS_<NAME>_OAUTH_ACCESS_TOKEN` (OAuth).
 *     The function NEVER logs or returns the token in error messages.
 *   - `sanitizeTmsErrorDetail` — `redactHighRiskSecrets` + URL strip +
 *     length cap, mirroring `sanitizeFailureDetail` in
 *     `qc-alm-api-transfer.ts` so push-report failure detail strings
 *     stay byte-stable across the QC family.
 *   - `chunkBatches` — split an iterable into fixed-size batches.
 *   - `executeWithRetry` — exponential backoff with jitter for
 *     `TmsTransportError` and `TmsRateLimitError`. Auth + validation
 *     errors are NEVER retried (fail-fast).
 *   - `buildTmsPushReportPath` — locate the canonical
 *     `tms-push-report.json` inside the run dir.
 *
 * Hard invariants:
 *   - Pure deterministic helpers. The only random source is
 *     `executeWithRetry`'s jitter, and it accepts an injected RNG so
 *     tests pin it to a deterministic stream.
 *   - All helpers refuse empty/whitespace-only string inputs to keep
 *     the failure mode loud.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  ALLOWED_TMS_AUTH_KINDS,
  TMS_PUSH_REPORT_ARTIFACT_FILENAME,
  type TmsAdapterId,
  type TmsAuthKind,
} from "../../contracts/index.js";
import { redactHighRiskSecrets } from "../../secret-redaction.js";
import {
  MAX_TMS_FAILURE_DETAIL_LENGTH,
  TmsAuthError,
  TmsRateLimitError,
  TmsTransportError,
  TmsValidationError,
  type TmsCredentials,
} from "./tms-adapter-contract.js";

const URL_DETAIL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi;

/** Default base for the exponential-backoff schedule (ms). */
export const DEFAULT_TMS_RETRY_BASE_MS = 250 as const;

/** Default cap on a single backoff sleep (ms) — 8s. */
export const DEFAULT_TMS_RETRY_CEIL_MS = 8_000 as const;

/** Default attempt budget (initial + retries). */
export const DEFAULT_TMS_RETRY_ATTEMPTS = 4 as const;

/**
 * Canonical environment-variable suffix per adapter. The full name is
 * `WORKSPACE_TEST_SPACE_TMS_<NAME>_TOKEN` for PAT/bearer and
 * `WORKSPACE_TEST_SPACE_TMS_<NAME>_OAUTH_ACCESS_TOKEN` for OAuth 2.0.
 */
export const TMS_ADAPTER_ENV_NAMES: Readonly<Record<TmsAdapterId, string>> = {
  alm: "ALM",
  polarion: "POLARION",
  qtest: "QTEST",
  xray: "XRAY",
};

const TMS_AUTH_KIND_SET: ReadonlySet<TmsAuthKind> = new Set(
  ALLOWED_TMS_AUTH_KINDS,
);

/**
 * Compute the deterministic per-case idempotency key. The TMS treats
 * the same key as the same case, so a re-run with the same `(tenantId,
 * runId, testCaseId)` triple short-circuits to `skipped-dup`.
 */
export const computeTmsIdempotencyKey = (input: {
  tenantId: string;
  runId: string;
  testCaseId: string;
}): string => {
  const tenantId = requireNonEmpty(input.tenantId, "tenantId");
  const runId = requireNonEmpty(input.runId, "runId");
  const testCaseId = requireNonEmpty(input.testCaseId, "testCaseId");
  return createHash("sha256")
    .update(`${tenantId}|${runId}|${testCaseId}`, "utf8")
    .digest("hex");
};

const requireNonEmpty = (value: string, field: string): string => {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return trimmed;
};

/**
 * Sanitise a TMS-supplied failure detail before persisting it on the
 * push report. Mirrors `qc-alm-api-transfer.ts#sanitizeFailureDetail`
 * so failure strings are byte-stable across the QC family.
 */
export const sanitizeTmsErrorDetail = (raw: unknown): string => {
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
  if (cleaned.length <= MAX_TMS_FAILURE_DETAIL_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_TMS_FAILURE_DETAIL_LENGTH)}...`;
};

/** Split an iterable into fixed-size batches in declaration order. */
export const chunkBatches = <T>(items: readonly T[], size: number): T[][] => {
  if (size <= 0) {
    throw new RangeError("chunkBatches: size must be a positive integer");
  }
  if (items.length === 0) return [];
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
};

/** Inputs for `executeWithRetry`. */
export interface ExecuteWithRetryInput<T> {
  /** Stable adapter discriminator used in error wrapping. */
  adapterId: TmsAdapterId;
  /** Async operation. Returning a value short-circuits retry. */
  operation: () => Promise<T>;
  /** Optional max attempts (1 + retries). Defaults to 4. */
  maxAttempts?: number | undefined;
  /** Optional base backoff (ms). Defaults to 250. */
  baseMs?: number | undefined;
  /** Optional ceiling on a single backoff sleep. Defaults to 8000. */
  ceilMs?: number | undefined;
  /** Optional sleep injection — tests pass a fake. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Optional random source — tests pass a deterministic stream. */
  random?: (() => number) | undefined;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Run `operation` with exponential backoff + jitter on
 * `TmsTransportError` and `TmsRateLimitError`. Auth + validation errors
 * propagate immediately. The total attempt count is bounded by
 * `maxAttempts` — every retry waits between `baseMs` and `min(ceilMs,
 * baseMs * 2^attempt)` ms, with a uniform jitter in `[0, 1)`.
 *
 * `TmsRateLimitError.retryAfterMs` overrides the computed sleep when
 * the server set `Retry-After`.
 *
 * Returns `{ value, attemptCount }` so the orchestrator can stamp the
 * per-case attempt count on the report.
 */
export const executeWithRetry = async <T>(
  input: ExecuteWithRetryInput<T>,
): Promise<{ value: T; attemptCount: number }> => {
  const maxAttempts = input.maxAttempts ?? DEFAULT_TMS_RETRY_ATTEMPTS;
  const baseMs = input.baseMs ?? DEFAULT_TMS_RETRY_BASE_MS;
  const ceilMs = input.ceilMs ?? DEFAULT_TMS_RETRY_CEIL_MS;
  const sleep = input.sleep ?? defaultSleep;
  const random = input.random ?? Math.random;
  if (maxAttempts < 1) {
    throw new RangeError("executeWithRetry: maxAttempts must be >= 1");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await input.operation();
      return { value, attemptCount: attempt };
    } catch (err) {
      lastError = err;
      // Non-retryable: fail fast.
      if (err instanceof TmsAuthError || err instanceof TmsValidationError) {
        throw err;
      }
      const isTransport = err instanceof TmsTransportError;
      const isRateLimit = err instanceof TmsRateLimitError;
      if (!isTransport && !isRateLimit) {
        // Unknown class — wrap as transport so the report records it
        // under a stable failure_class. NEVER retried for unknowns to
        // avoid amplifying mystery faults.
        throw err;
      }
      if (attempt === maxAttempts) {
        throw err;
      }
      const backoff = computeBackoffMs({
        attempt,
        baseMs,
        ceilMs,
        random,
      });
      const sleepMs = isRateLimit
        ? Math.min(ceilMs, Math.max(backoff, err.retryAfterMs))
        : backoff;
      await sleep(sleepMs);
    }
  }
  // Unreachable — the loop always returns or throws.
  throw lastError instanceof Error
    ? lastError
    : new TmsTransportError(input.adapterId, "executeWithRetry: exhausted");
};

const computeBackoffMs = (input: {
  attempt: number;
  baseMs: number;
  ceilMs: number;
  random: () => number;
}): number => {
  const exponential = input.baseMs * 2 ** (input.attempt - 1);
  const capped = Math.min(input.ceilMs, exponential);
  const jitter = input.random() * input.baseMs;
  return Math.min(input.ceilMs, Math.floor(capped + jitter));
};

/** Inputs for `loadTmsCredentialsFromEnv`. */
export interface LoadTmsCredentialsFromEnvInput {
  adapterId: TmsAdapterId;
  /** Process env reference, injected so tests can pin it. */
  env: NodeJS.ProcessEnv;
  /** Optional principal id surfaced on the session handle. */
  principalId?: string;
}

/** Outcome of `loadTmsCredentialsFromEnv`. */
export type LoadTmsCredentialsResult =
  | { ok: true; credentials: TmsCredentials }
  | {
      ok: false;
      code: "credentials_missing" | "credentials_invalid";
      message: string;
    };

/**
 * Read TMS credentials from the environment. The function NEVER
 * returns the token in error messages, NEVER logs the env-var values,
 * and refuses to surface the resolved token through any field other
 * than the typed `TmsCredentials`.
 *
 * Env-var lookup order, first non-empty wins:
 *   1. `WORKSPACE_TEST_SPACE_TMS_<NAME>_OAUTH_ACCESS_TOKEN` → `oauth2`
 *   2. `WORKSPACE_TEST_SPACE_TMS_<NAME>_TOKEN`              → `pat`
 *   3. `WORKSPACE_TEST_SPACE_TMS_<NAME>_BEARER`             → `bearer`
 */
export const loadTmsCredentialsFromEnv = (
  input: LoadTmsCredentialsFromEnvInput,
): LoadTmsCredentialsResult => {
  const envSuffix = TMS_ADAPTER_ENV_NAMES[input.adapterId];
  const oauthName = `WORKSPACE_TEST_SPACE_TMS_${envSuffix}_OAUTH_ACCESS_TOKEN`;
  const patName = `WORKSPACE_TEST_SPACE_TMS_${envSuffix}_TOKEN`;
  const bearerName = `WORKSPACE_TEST_SPACE_TMS_${envSuffix}_BEARER`;

  const oauth = nonEmptyEnv(input.env, oauthName);
  if (oauth !== undefined) {
    const refreshName = `WORKSPACE_TEST_SPACE_TMS_${envSuffix}_OAUTH_REFRESH_TOKEN`;
    const refresh = nonEmptyEnv(input.env, refreshName);
    return {
      ok: true,
      credentials: {
        kind: "oauth2",
        accessToken: oauth,
        ...(refresh !== undefined ? { refreshToken: refresh } : {}),
        ...(input.principalId !== undefined
          ? { principalId: input.principalId }
          : {}),
      },
    };
  }

  const pat = nonEmptyEnv(input.env, patName);
  if (pat !== undefined) {
    return {
      ok: true,
      credentials: {
        kind: "pat",
        token: pat,
        ...(input.principalId !== undefined
          ? { principalId: input.principalId }
          : {}),
      },
    };
  }

  const bearer = nonEmptyEnv(input.env, bearerName);
  if (bearer !== undefined) {
    return {
      ok: true,
      credentials: {
        kind: "bearer",
        token: bearer,
        ...(input.principalId !== undefined
          ? { principalId: input.principalId }
          : {}),
      },
    };
  }

  return {
    ok: false,
    code: "credentials_missing",
    message: `no credentials configured: set one of ${oauthName}, ${patName}, ${bearerName}`,
  };
};

const nonEmptyEnv = (
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined => {
  const raw = env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** Resolve the canonical `tms-push-report.json` path under a run dir. */
export const buildTmsPushReportPath = (runDir: string): string => {
  const trimmed = requireNonEmpty(runDir, "runDir");
  return join(trimmed, TMS_PUSH_REPORT_ARTIFACT_FILENAME);
};

/**
 * Atomic JSON write helper. Mirrors the pattern used by
 * `qc-alm-api-transfer.ts#writeAtomicJson` so concurrent push runs on
 * the same artifactRoot cannot tear a JSON file.
 */
export const writeTmsAtomicJson = async (
  path: string,
  value: unknown,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
};

/** Type-narrowing helper used by adapter implementations. */
export const isSupportedAuthKind = (kind: string): kind is TmsAuthKind =>
  TMS_AUTH_KIND_SET.has(kind as TmsAuthKind);

/**
 * Build a base64url HTTP Basic auth header for adapters that require
 * `Basic` (e.g. OpenText ALM session endpoint). Accepts `username` +
 * the credential token; the function never logs the token.
 */
export const buildBasicAuthHeader = (input: {
  username: string;
  token: string;
}): string => {
  const username = requireNonEmpty(input.username, "username");
  const token = requireNonEmpty(input.token, "token");
  const encoded = Buffer.from(`${username}:${token}`, "utf8").toString(
    "base64",
  );
  return `Basic ${encoded}`;
};

/**
 * Coerce an unknown HTTP response status to a typed failure class so
 * adapters can throw consistent errors without scattering switch
 * statements. The mapping mirrors the table in
 * `qc-alm-api-transfer.ts`:
 *
 *   - 401, 403          → `TmsAuthError`
 *   - 400, 404, 409, 422 → `TmsValidationError`
 *   - 429               → `TmsRateLimitError`
 *   - 5xx, transport    → `TmsTransportError`
 */
export const classifyTmsHttpFailure = (input: {
  adapterId: TmsAdapterId;
  status: number;
  detail: string;
  retryAfterMs?: number | undefined;
  code?: string | undefined;
}): TmsAuthError | TmsValidationError | TmsRateLimitError | TmsTransportError => {
  const detail = sanitizeTmsErrorDetail(input.detail);
  const code =
    input.code !== undefined && input.code.length > 0
      ? input.code
      : `http_${input.status}`;
  if (input.status === 401 || input.status === 403) {
    return new TmsAuthError(input.adapterId, detail);
  }
  if (input.status === 429) {
    return new TmsRateLimitError(
      input.adapterId,
      input.retryAfterMs ?? 0,
      detail,
    );
  }
  if (
    input.status === 400 ||
    input.status === 404 ||
    input.status === 409 ||
    input.status === 422
  ) {
    return new TmsValidationError(input.adapterId, code, detail);
  }
  return new TmsTransportError(input.adapterId, detail);
};

/**
 * Stable principal id surfaced on a session handle when the adapter
 * accepted credentials but the caller did not name a principal.
 */
export const DEFAULT_TMS_PRINCIPAL_ID = "tms-principal:default" as const;

/**
 * Build a session principal id, preferring the caller-supplied id and
 * falling back to the adapter default. Trims whitespace; refuses
 * empty strings to keep the failure mode loud.
 */
export const resolvePrincipalId = (raw: string | undefined): string => {
  if (typeof raw !== "string") return DEFAULT_TMS_PRINCIPAL_ID;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_TMS_PRINCIPAL_ID;
};
