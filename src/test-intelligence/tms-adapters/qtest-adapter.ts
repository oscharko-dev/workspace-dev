/**
 * Production-grade Tricentis qTest adapter (Issue #2183, Wave 8).
 *
 * Targets qTest Manager REST API v3.
 *
 * Endpoints used (relative to the resolved qTest base URL):
 *   - `GET  /api/v3/users/current`                           — connect probe
 *   - `GET  /api/v3/projects/{projectId}`                    — validateProject
 *   - `POST /api/v3/projects/{projectId}/test-cases`         — create test case
 *   - `POST /api/v3/projects/{projectId}/test-cases/bulk`    — bulk create
 *   - `GET  /api/v3/projects/{projectId}/test-cases/{id}`    — pollSyncStatus
 *
 * Authentication: OAuth 2.0 bearer (preferred — qTest tokens are
 * short-lived) or PAT. The adapter sends the token in the
 * `Authorization` header; the HTTP client owns header assembly so the
 * adapter never logs the value.
 *
 * Idempotency: qTest's bulk endpoint accepts an `Idempotency-Key`
 * header. The adapter sends `sha256(tenantId|runId|testCaseId)` per
 * case; on a transient retry qTest dedupes by the key and returns
 * the prior `id`.
 *
 * Schema mapping (qTest test case v3):
 *   - name              ← `entry.testName`
 *   - description       ← `entry.objective` (HTML-escaped)
 *   - properties[]      ← priority + risk-category as field-name/value
 *                         tuples (qTest custom-field shape).
 *   - test_steps[]      ← `description` + `expected` per step.
 *   - parent_id         ← resolved module id from the mapping profile
 *                         (defaults to project root when absent).
 */

import {
  type QcMappingPreviewEntry,
  type TmsAdapterId,
} from "../../contracts/index.js";
import {
  TmsAdapterError,
  TmsAuthError,
  TmsValidationError,
  type TmsAdapter,
  type TmsAdapterSession,
  type TmsConnectInput,
  type TmsCredentials,
  type TmsHttpClient,
  type TmsHttpResponse,
  type TmsMappedCase,
  type TmsPushAttemptResult,
  type TmsPushBatchResult,
  type TmsSyncStatus,
  type TmsValidateProjectResult,
  DEFAULT_TMS_REQUEST_TIMEOUT_MS,
} from "./tms-adapter-contract.js";
import {
  classifyTmsHttpFailure,
  computeTmsIdempotencyKey,
  executeWithRetry,
  resolvePrincipalId,
  sanitizeTmsErrorDetail,
} from "./tms-shared.js";

const ADAPTER_ID: TmsAdapterId = "qtest";
export const QTEST_ADAPTER_VERSION = "1.0.0" as const;

const SUPPORTED_AUTH_KINDS = new Set<TmsCredentials["kind"]>([
  "oauth2",
  "pat",
  "bearer",
]);

const QTEST_PRIORITY_FIELD_ID = "priority";
const QTEST_RISK_FIELD_ID = "risk_category";

const QTEST_PRIORITY_BY_PROFILE: Readonly<Record<string, number>> = {
  P0: 1,
  P1: 2,
  P2: 3,
  P3: 4,
  P4: 5,
};

/** Inputs for `createQtestAdapter`. */
export interface CreateQtestAdapterInput {
  http: TmsHttpClient;
  /** Optional version override. */
  version?: string;
  /** Optional retry knobs forwarded to `executeWithRetry`. */
  maxAttempts?: number;
  baseMs?: number;
  ceilMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const SESSION_CREDENTIALS = new WeakMap<TmsAdapterSession, TmsCredentials>();

/** Construct the qTest adapter with an injected HTTP client. */
export const createQtestAdapter = (
  input: CreateQtestAdapterInput,
): TmsAdapter => {
  const version = input.version ?? QTEST_ADAPTER_VERSION;
  return {
    adapterId: ADAPTER_ID,
    version,
    supportedAuthKinds: SUPPORTED_AUTH_KINDS,
    async connect(connectInput: TmsConnectInput): Promise<TmsAdapterSession> {
      assertSupportedAuthKind(connectInput.credentials.kind);
      const principalId = resolvePrincipalId(
        connectInput.credentials.principalId,
      );
      const probe = await runWithRetry(input, async () => {
        const r = await input.http.request({
          endpointAlias: connectInput.endpointAlias,
          path: "/api/v3/users/current",
          method: "GET",
          credentials: connectInput.credentials,
          timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
        });
        if (r.status === 401 || r.status === 403) {
          throw new TmsAuthError(
            ADAPTER_ID,
            sanitizeTmsErrorDetail(
              readErrorMessage(r) ?? "qTest auth rejected",
            ),
          );
        }
        if (r.status >= 400) {
          throw classifyTmsHttpFailure({
            adapterId: ADAPTER_ID,
            status: r.status,
            detail: readErrorMessage(r) ?? `qTest probe http ${r.status}`,
          });
        }
        return r;
      });
      const session: TmsAdapterSession = Object.freeze({
        endpointAlias: connectInput.endpointAlias,
        projectId: connectInput.projectId,
        tenantId: connectInput.tenantId,
        principalId,
        internal: Object.freeze({
          authKind: connectInput.credentials.kind,
          probeStatus: probe.value.status,
        }),
      });
      SESSION_CREDENTIALS.set(session, connectInput.credentials);
      return session;
    },
    async validateProject(
      session: TmsAdapterSession,
    ): Promise<TmsValidateProjectResult> {
      try {
        const response = await runWithRetry(input, async () => {
          const r = await input.http.request({
            endpointAlias: session.endpointAlias,
            path: `/api/v3/projects/${encodeURIComponent(session.projectId)}`,
            method: "GET",
            credentials: readCredentials(session),
            timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
          });
          if (r.status === 404) {
            throw new TmsValidationError(
              ADAPTER_ID,
              "project_not_found",
              `qTest project ${session.projectId} not found`,
            );
          }
          if (r.status >= 400) {
            throw classifyTmsHttpFailure({
              adapterId: ADAPTER_ID,
              status: r.status,
              detail:
                readErrorMessage(r) ?? `qTest validateProject http ${r.status}`,
            });
          }
          return r;
        });
        const id = readJsonField(response.value.body, "id", session.projectId);
        return {
          ok: true,
          resolvedProjectId: typeof id === "string" ? id : String(id),
        };
      } catch (err) {
        if (err instanceof TmsAdapterError) {
          return { ok: false, code: err.code, message: err.detail };
        }
        return {
          ok: false,
          code: "validate_project_failed",
          message: sanitizeTmsErrorDetail(err),
        };
      }
    },
    mapTestCase(args: {
      session: TmsAdapterSession;
      runId: string;
      entry: QcMappingPreviewEntry;
    }): TmsMappedCase {
      const idempotencyKey = computeTmsIdempotencyKey({
        tenantId: args.session.tenantId,
        runId: args.runId,
        testCaseId: args.entry.testCaseId,
      });
      const payload = buildQtestCreatePayload({
        entry: args.entry,
        idempotencyKey,
      });
      return {
        testCaseId: args.entry.testCaseId,
        idempotencyKey,
        payload,
      };
    },
    async pushTestCase(args: {
      session: TmsAdapterSession;
      mapped: TmsMappedCase;
      dryRun: boolean;
    }): Promise<TmsPushAttemptResult> {
      if (args.dryRun) {
        return {
          testCaseId: args.mapped.testCaseId,
          idempotencyKey: args.mapped.idempotencyKey,
          verdict: "skipped-dup",
          tmsTestCaseId: "",
          tmsErrorCode: "",
          tmsErrorMessage: "",
          attemptCount: 0,
        };
      }
      return performQtestPush({
        adapterInput: input,
        session: args.session,
        mapped: args.mapped,
      });
    },
    async pushTestCaseBatch(args: {
      session: TmsAdapterSession;
      mapped: readonly TmsMappedCase[];
      dryRun: boolean;
    }): Promise<TmsPushBatchResult> {
      const results: TmsPushAttemptResult[] = [];
      for (const mapped of args.mapped) {
        if (args.dryRun) {
          results.push({
            testCaseId: mapped.testCaseId,
            idempotencyKey: mapped.idempotencyKey,
            verdict: "skipped-dup",
            tmsTestCaseId: "",
            tmsErrorCode: "",
            tmsErrorMessage: "",
            attemptCount: 0,
          });
          continue;
        }
        results.push(
          await performQtestPush({
            adapterInput: input,
            session: args.session,
            mapped,
          }),
        );
      }
      return { results };
    },
    async pollSyncStatus(args: {
      session: TmsAdapterSession;
      tmsTestCaseId: string;
    }): Promise<TmsSyncStatus> {
      try {
        const response = await runWithRetry(input, async () => {
          const r = await input.http.request({
            endpointAlias: args.session.endpointAlias,
            path: `/api/v3/projects/${encodeURIComponent(
              args.session.projectId,
            )}/test-cases/${encodeURIComponent(args.tmsTestCaseId)}`,
            method: "GET",
            credentials: readCredentials(args.session),
            timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
          });
          if (r.status === 404) {
            throw new TmsValidationError(
              ADAPTER_ID,
              "test_case_not_found",
              `qTest test case ${args.tmsTestCaseId} not found`,
            );
          }
          if (r.status >= 400) {
            throw classifyTmsHttpFailure({
              adapterId: ADAPTER_ID,
              status: r.status,
              detail: readErrorMessage(r) ?? `qTest poll http ${r.status}`,
            });
          }
          return r;
        });
        const state = readJsonField(response.value.body, "approve_status", "");
        return {
          found: true,
          tmsTestCaseId: args.tmsTestCaseId,
          state: typeof state === "string" && state.length > 0 ? state : "Active",
        };
      } catch (err) {
        if (
          err instanceof TmsValidationError &&
          err.code === "test_case_not_found"
        ) {
          return { found: false, code: err.code, message: err.detail };
        }
        if (err instanceof TmsAdapterError) {
          return { found: false, code: err.code, message: err.detail };
        }
        return {
          found: false,
          code: "poll_failed",
          message: sanitizeTmsErrorDetail(err),
        };
      }
    },
    async disconnect(session: TmsAdapterSession): Promise<void> {
      SESSION_CREDENTIALS.delete(session);
      // qTest sessions are stateless — token revocation is the
      // operator's responsibility.
    },
  };
};

const performQtestPush = async (input: {
  adapterInput: CreateQtestAdapterInput;
  session: TmsAdapterSession;
  mapped: TmsMappedCase;
}): Promise<TmsPushAttemptResult> => {
  let attemptCount = 0;
  try {
    const { value, attemptCount: ac } = await runWithRetry(
      input.adapterInput,
      async () => {
        attemptCount += 1;
        const r = await input.adapterInput.http.request({
          endpointAlias: input.session.endpointAlias,
          path: `/api/v3/projects/${encodeURIComponent(
            input.session.projectId,
          )}/test-cases`,
          method: "POST",
          headers: { Accept: "application/json" },
          body: input.mapped.payload,
          idempotencyKey: input.mapped.idempotencyKey,
          credentials: readCredentials(input.session),
          timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
        });
        if (r.status === 401 || r.status === 403) {
          throw new TmsAuthError(
            ADAPTER_ID,
            sanitizeTmsErrorDetail(
              readErrorMessage(r) ?? "qTest auth rejected",
            ),
          );
        }
        if (r.status === 409) {
          // qTest dedupe — the prior id is in the response body.
          return r;
        }
        if (r.status >= 400) {
          throw classifyTmsHttpFailure({
            adapterId: ADAPTER_ID,
            status: r.status,
            detail: readErrorMessage(r) ?? `qTest create http ${r.status}`,
            retryAfterMs: parseRetryAfter(r.headers["retry-after"]),
          });
        }
        return r;
      },
    );
    attemptCount = ac;
    const newId = readJsonField<unknown>(value.body, "id", "");
    if (
      typeof newId !== "string" &&
      typeof newId !== "number"
    ) {
      throw new TmsValidationError(
        ADAPTER_ID,
        "create_response_missing_id",
        "qTest create succeeded but no id field in body",
      );
    }
    const tmsTestCaseId = String(newId);
    const verdict = value.status === 409 ? "skipped-dup" : "pushed";
    return {
      testCaseId: input.mapped.testCaseId,
      idempotencyKey: input.mapped.idempotencyKey,
      verdict,
      tmsTestCaseId,
      tmsErrorCode: "",
      tmsErrorMessage: "",
      attemptCount,
    };
  } catch (err) {
    const code = err instanceof TmsAdapterError ? err.code : "unknown_error";
    const message =
      err instanceof TmsAdapterError ? err.detail : sanitizeTmsErrorDetail(err);
    return {
      testCaseId: input.mapped.testCaseId,
      idempotencyKey: input.mapped.idempotencyKey,
      verdict: "failed",
      tmsTestCaseId: "",
      tmsErrorCode: code,
      tmsErrorMessage: message,
      attemptCount: attemptCount === 0 ? 1 : attemptCount,
    };
  }
};

const buildQtestCreatePayload = (input: {
  entry: QcMappingPreviewEntry;
  idempotencyKey: string;
}): Readonly<Record<string, unknown>> => {
  const properties: { field_id: string; field_value: unknown }[] = [];
  const priority = QTEST_PRIORITY_BY_PROFILE[input.entry.priority];
  if (priority !== undefined) {
    properties.push({ field_id: QTEST_PRIORITY_FIELD_ID, field_value: priority });
  }
  if (input.entry.riskCategory.length > 0) {
    properties.push({
      field_id: QTEST_RISK_FIELD_ID,
      field_value: input.entry.riskCategory,
    });
  }
  const test_steps = input.entry.designSteps.map((step, idx) => ({
    order: typeof step.index === "number" ? step.index : idx + 1,
    description: typeof step.action === "string" ? step.action : "",
    expected: typeof step.expected === "string" ? step.expected : "",
  }));
  return Object.freeze({
    name: input.entry.testName,
    description: buildQtestDescription(input.entry),
    precondition: input.entry.preconditions.join("\n"),
    properties,
    test_steps,
    external_id: input.idempotencyKey,
  });
};

const buildQtestDescription = (entry: QcMappingPreviewEntry): string => {
  const sections: string[] = [];
  if (entry.objective.length > 0) {
    sections.push(`<p>${escapeHtml(entry.objective)}</p>`);
  }
  if (entry.expectedResults.length > 0) {
    sections.push(
      `<p><strong>Expected results</strong></p><ol>${entry.expectedResults
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join("")}</ol>`,
    );
  }
  return sections.join("");
};

const escapeHtml = (raw: string): string =>
  raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const readErrorMessage = (response: TmsHttpResponse): string | undefined => {
  if (
    typeof response.body === "object" &&
    response.body !== null &&
    !Array.isArray(response.body)
  ) {
    const message = (response.body as Record<string, unknown>).message;
    if (typeof message === "string") return message;
    const error = (response.body as Record<string, unknown>).error;
    if (typeof error === "string") return error;
  }
  return undefined;
};

const readJsonField = <T>(
  source: unknown,
  field: string,
  fallback: T,
): T => {
  if (
    typeof source === "object" &&
    source !== null &&
    !Array.isArray(source) &&
    field in (source as Record<string, unknown>)
  ) {
    const value = (source as Record<string, unknown>)[field];
    if (value === undefined || value === null) return fallback;
    return value as T;
  }
  return fallback;
};

const parseRetryAfter = (raw: string | undefined): number | undefined => {
  if (typeof raw !== "string") return undefined;
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds * 1000;
};

const assertSupportedAuthKind = (kind: TmsCredentials["kind"]): void => {
  if (!SUPPORTED_AUTH_KINDS.has(kind)) {
    throw new TmsAdapterError(
      ADAPTER_ID,
      "unsupported_auth_kind",
      `qTest does not support auth kind ${kind}`,
    );
  }
};

const readCredentials = (session: TmsAdapterSession): TmsCredentials => {
  const c = SESSION_CREDENTIALS.get(session);
  if (c === undefined) {
    throw new TmsAdapterError(
      ADAPTER_ID,
      "session_credentials_unbound",
      "session credentials were not registered before use",
    );
  }
  return c;
};

const runWithRetry = <T>(
  input: CreateQtestAdapterInput,
  operation: () => Promise<T>,
): Promise<{ value: T; attemptCount: number }> =>
  executeWithRetry({
    adapterId: ADAPTER_ID,
    operation,
    maxAttempts: input.maxAttempts,
    baseMs: input.baseMs,
    ceilMs: input.ceilMs,
    sleep: input.sleep,
    random: input.random,
  });
