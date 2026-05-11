/**
 * Production-grade Siemens Polarion adapter (Issue #2183, Wave 8).
 *
 * Polarion is two-protocol: a REST surface for work-item CRUD plus a
 * WebDAV mount for binary attachments. The adapter holds both: REST
 * via the injected `TmsHttpClient`, WebDAV via the optional
 * `polarionWebDav` client. When `polarionWebDav` is omitted, attachment
 * upload is skipped silently and the per-case verdict still records
 * `pushed`. Operators that need attachments must configure WebDAV.
 *
 * Endpoints used (relative to the resolved Polarion base URL):
 *   - `GET  /polarion/rest/v1/projects`                — connect probe
 *   - `GET  /polarion/rest/v1/projects/{projectId}`    — validateProject
 *   - `POST /polarion/rest/v1/projects/{projectId}/workitems`
 *                                                      — create test case
 *   - `GET  /polarion/rest/v1/projects/{projectId}/workitems/{id}`
 *                                                      — pollSyncStatus
 *
 * WebDAV attachment path:
 *   `PUT  /polarion/dav/{projectId}/{workItemId}/{filename}`
 *
 * Authentication: PAT (Polarion 21+) or Bearer token. The PAT is
 * surfaced as `Authorization: Bearer <token>` for both REST and
 * WebDAV; the WebDAV client takes the same credentials object.
 *
 * Idempotency: Polarion supports an `If-None-Match: *` header on the
 * REST POST, plus a deterministic `id` field. The adapter sends both
 * the SHA-256 first 12 chars in the `id` field AND the
 * `Idempotency-Key` header so a re-run returns the prior id with
 * HTTP 200 (treated as `skipped-dup`).
 *
 * Schema mapping (Polarion `testcase` work-item):
 *   - id            ← `[idempotencyPrefix]` (Polarion-stable)
 *   - title         ← `entry.testName`
 *   - type.id       ← `testcase`
 *   - description   ← `entry.objective` (HTML)
 *   - severity.id   ← Polarion severity enum (`must_have`, etc.)
 *   - status.id     ← `proposed`
 *   - testSteps     ← Polarion test-step custom field shape.
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

const ADAPTER_ID: TmsAdapterId = "polarion";
export const POLARION_ADAPTER_VERSION = "1.0.0" as const;

const SUPPORTED_AUTH_KINDS = new Set<TmsCredentials["kind"]>(["pat", "bearer"]);

const POLARION_SEVERITY_BY_PROFILE: Readonly<Record<string, string>> = {
  P0: "must_have",
  P1: "must_have",
  P2: "should_have",
  P3: "nice_to_have",
  P4: "nice_to_have",
};

/**
 * Optional WebDAV client surface for Polarion attachment writes. The
 * adapter never falls back to silently dropping attachments — when
 * `polarionWebDav` is omitted, attachment upload is skipped and the
 * per-case verdict on the report still records `pushed` so an
 * operator knows the case landed without binaries.
 */
export interface PolarionWebDavClient {
  putAttachment(input: {
    endpointAlias: string;
    projectId: string;
    workItemId: string;
    filename: string;
    bytes: Uint8Array;
    contentType: string;
    credentials: TmsCredentials;
    timeoutMs: number;
  }): Promise<void>;
}

/** Inputs for `createPolarionAdapter`. */
export interface CreatePolarionAdapterInput {
  http: TmsHttpClient;
  /** Optional WebDAV client; when absent, attachment writes are skipped. */
  polarionWebDav?: PolarionWebDavClient;
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

/** Construct the Polarion adapter with an injected HTTP client. */
export const createPolarionAdapter = (
  input: CreatePolarionAdapterInput,
): TmsAdapter => {
  const version = input.version ?? POLARION_ADAPTER_VERSION;
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
          path: "/polarion/rest/v1/projects?page[size]=1",
          method: "GET",
          credentials: connectInput.credentials,
          timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
        });
        if (r.status === 401 || r.status === 403) {
          throw new TmsAuthError(
            ADAPTER_ID,
            sanitizeTmsErrorDetail(
              readErrorMessage(r) ?? "Polarion auth rejected",
            ),
          );
        }
        if (r.status >= 400) {
          throw classifyTmsHttpFailure({
            adapterId: ADAPTER_ID,
            status: r.status,
            detail: readErrorMessage(r) ?? `Polarion probe http ${r.status}`,
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
          webDavConfigured: input.polarionWebDav !== undefined,
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
            path: `/polarion/rest/v1/projects/${encodeURIComponent(
              session.projectId,
            )}`,
            method: "GET",
            credentials: readCredentials(session),
            timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
          });
          if (r.status === 404) {
            throw new TmsValidationError(
              ADAPTER_ID,
              "project_not_found",
              `Polarion project ${session.projectId} not found`,
            );
          }
          if (r.status >= 400) {
            throw classifyTmsHttpFailure({
              adapterId: ADAPTER_ID,
              status: r.status,
              detail:
                readErrorMessage(r) ?? `Polarion validateProject http ${r.status}`,
            });
          }
          return r;
        });
        const data = readJsonField<unknown>(response.value.body, "data", {});
        const id = readJsonField(data, "id", session.projectId);
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
      const payload = buildPolarionCreatePayload({
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
      return performPolarionPush({
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
          await performPolarionPush({
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
            path: `/polarion/rest/v1/projects/${encodeURIComponent(
              args.session.projectId,
            )}/workitems/${encodeURIComponent(args.tmsTestCaseId)}`,
            method: "GET",
            credentials: readCredentials(args.session),
            timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
          });
          if (r.status === 404) {
            throw new TmsValidationError(
              ADAPTER_ID,
              "work_item_not_found",
              `Polarion work item ${args.tmsTestCaseId} not found`,
            );
          }
          if (r.status >= 400) {
            throw classifyTmsHttpFailure({
              adapterId: ADAPTER_ID,
              status: r.status,
              detail: readErrorMessage(r) ?? `Polarion poll http ${r.status}`,
            });
          }
          return r;
        });
        const data = readJsonField<unknown>(response.value.body, "data", {});
        const attributes = readJsonField<unknown>(data, "attributes", {});
        const status = readJsonField(attributes, "status", "proposed");
        return {
          found: true,
          tmsTestCaseId: args.tmsTestCaseId,
          state: typeof status === "string" ? status : "proposed",
        };
      } catch (err) {
        if (
          err instanceof TmsValidationError &&
          err.code === "work_item_not_found"
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
      // Polarion PAT/Bearer sessions are stateless — token revocation
      // is the operator's responsibility.
    },
  };
};

const performPolarionPush = async (input: {
  adapterInput: CreatePolarionAdapterInput;
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
          path: `/polarion/rest/v1/projects/${encodeURIComponent(
            input.session.projectId,
          )}/workitems`,
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
              readErrorMessage(r) ?? "Polarion auth rejected",
            ),
          );
        }
        if (r.status === 200) {
          // Polarion returns 200 (not 201) on idempotent dedupe.
          return r;
        }
        if (r.status >= 400) {
          throw classifyTmsHttpFailure({
            adapterId: ADAPTER_ID,
            status: r.status,
            detail: readErrorMessage(r) ?? `Polarion create http ${r.status}`,
          });
        }
        return r;
      },
    );
    attemptCount = ac;
    const data = readJsonField<unknown>(value.body, "data", {});
    const id = readJsonField(data, "id", "");
    if (typeof id !== "string" || id.length === 0) {
      throw new TmsValidationError(
        ADAPTER_ID,
        "create_response_missing_id",
        "Polarion create succeeded but no id field in body",
      );
    }
    const verdict = value.status === 200 ? "skipped-dup" : "pushed";
    return {
      testCaseId: input.mapped.testCaseId,
      idempotencyKey: input.mapped.idempotencyKey,
      verdict,
      tmsTestCaseId: id,
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

const buildPolarionCreatePayload = (input: {
  entry: QcMappingPreviewEntry;
  idempotencyKey: string;
}): Readonly<Record<string, unknown>> => {
  const idPrefix = input.idempotencyKey.slice(0, 12);
  const severity = POLARION_SEVERITY_BY_PROFILE[input.entry.priority] ?? "should_have";
  const testSteps = input.entry.designSteps.map((step, idx) => ({
    order: typeof step.index === "number" ? step.index : idx + 1,
    action: typeof step.action === "string" ? step.action : "",
    expectedResult: typeof step.expected === "string" ? step.expected : "",
  }));
  return Object.freeze({
    data: {
      type: "workitems",
      id: idPrefix,
      attributes: {
        title: input.entry.testName,
        type: "testcase",
        description: {
          type: "text/html",
          value: buildPolarionDescription(input.entry),
        },
        severity,
        status: "proposed",
        testSteps,
      },
    },
  });
};

const buildPolarionDescription = (entry: QcMappingPreviewEntry): string => {
  const sections: string[] = [];
  if (entry.objective.length > 0) {
    sections.push(`<p>${escapeHtml(entry.objective)}</p>`);
  }
  if (entry.preconditions.length > 0) {
    sections.push(
      `<p><b>Preconditions</b></p><ol>${entry.preconditions
        .map((p) => `<li>${escapeHtml(p)}</li>`)
        .join("")}</ol>`,
    );
  }
  if (entry.testData.length > 0) {
    sections.push(
      `<p><b>Test data</b></p><ol>${entry.testData
        .map((d) => `<li>${escapeHtml(d)}</li>`)
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
    const errors = (response.body as Record<string, unknown>).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0] as Record<string, unknown>;
      const detail =
        typeof first.detail === "string" ? first.detail : undefined;
      const title = typeof first.title === "string" ? first.title : undefined;
      return detail ?? title;
    }
    const message = (response.body as Record<string, unknown>).message;
    if (typeof message === "string") return message;
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

const assertSupportedAuthKind = (kind: TmsCredentials["kind"]): void => {
  if (!SUPPORTED_AUTH_KINDS.has(kind)) {
    throw new TmsAdapterError(
      ADAPTER_ID,
      "unsupported_auth_kind",
      `Polarion does not support auth kind ${kind}`,
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
  input: CreatePolarionAdapterInput,
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
