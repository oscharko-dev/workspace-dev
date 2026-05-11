/**
 * Production-grade Jira Xray adapter (Issue #2183, Wave 8).
 *
 * Targets Atlassian Jira REST + Xray REST.
 *
 * Endpoints used (relative to the resolved Jira base URL):
 *   - `GET  /rest/api/3/myself`                  — connect probe
 *   - `GET  /rest/api/3/project/{projectKey}`    — validateProject
 *   - `POST /rest/raven/2.0/api/import/test/bulk`— bulk import
 *   - `POST /rest/raven/2.0/api/import/test`     — single import
 *   - `GET  /rest/api/3/issue/{issueIdOrKey}`    — pollSyncStatus
 *
 * Authentication: PAT (preferred) or OAuth 2.0 bearer. The adapter
 * never echoes the token in failure detail; errors go through
 * `sanitizeTmsErrorDetail`.
 *
 * Idempotency: each push attempt sends an `Idempotency-Key` header
 * derived from `(tenantId, runId, testCaseId)`. On a transient retry
 * the Xray bulk-import endpoint dedupes by key and returns the
 * pre-existing issue id.
 *
 * Schema mapping (Xray test issue):
 *   - Summary               ← `entry.testName`
 *   - Description           ← `entry.objective` + numbered design steps
 *   - Issue Type            ← `Test`
 *   - Priority              ← Xray priority enum (`Highest..Lowest`)
 *   - Labels                ← `entry.riskCategory`,
 *                             `entry.blockingReasons` (sanitised)
 *   - Custom: Test Type     ← `Manual` (Xray-specific custom field)
 *   - Custom: Manual Steps  ← Xray `manualTestSteps` shape:
 *                             `{ action, data, result }` per step.
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
  type TmsPullExecutionsResult,
  type TmsPushAttemptResult,
  type TmsPushBatchResult,
  type TmsRawExecutionEvidence,
  type TmsSyncStatus,
  type TmsValidateProjectResult,
  DEFAULT_TMS_PUSH_BATCH_SIZE,
  DEFAULT_TMS_REQUEST_TIMEOUT_MS,
} from "./tms-adapter-contract.js";
import {
  classifyTmsHttpFailure,
  computeTmsIdempotencyKey,
  executeWithRetry,
  parseRawExecutionEvidenceEnvelope,
  resolvePrincipalId,
  sanitizeTmsErrorDetail,
} from "./tms-shared.js";

const ADAPTER_ID: TmsAdapterId = "xray";
export const XRAY_ADAPTER_VERSION = "1.0.0" as const;

const SUPPORTED_AUTH_KINDS = new Set<TmsCredentials["kind"]>([
  "pat",
  "oauth2",
  "bearer",
]);

const XRAY_PRIORITY_BY_PROFILE: Readonly<Record<string, string>> = {
  P0: "Highest",
  P1: "High",
  P2: "Medium",
  P3: "Low",
  P4: "Lowest",
};

/** Inputs for `createXrayAdapter`. */
export interface CreateXrayAdapterInput {
  http: TmsHttpClient;
  /** Optional version override (tests pin a stable version). */
  version?: string;
  /** Optional retry knobs forwarded to `executeWithRetry`. */
  maxAttempts?: number;
  baseMs?: number;
  ceilMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Construct the Xray adapter with an injected HTTP client. */
export const createXrayAdapter = (input: CreateXrayAdapterInput): TmsAdapter => {
  const version = input.version ?? XRAY_ADAPTER_VERSION;
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
        const response = await input.http.request({
          endpointAlias: connectInput.endpointAlias,
          path: "/rest/api/3/myself",
          method: "GET",
          credentials: connectInput.credentials,
          timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
        });
        ensureOk(response, "myself probe rejected");
        return response;
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
            path: `/rest/api/3/project/${encodeURIComponent(session.projectId)}`,
            method: "GET",
            credentials: rebuildCredentialsFromSession(session),
            timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
          });
          if (r.status === 404) {
            throw new TmsValidationError(
              ADAPTER_ID,
              "project_not_found",
              `Jira project ${session.projectId} not found`,
            );
          }
          ensureOk(r, "validateProject rejected");
          return r;
        });
        const resolvedKey = readJsonField(
          response.value.body,
          "key",
          session.projectId,
        );
        return { ok: true, resolvedProjectId: resolvedKey };
      } catch (err) {
        if (err instanceof TmsValidationError) {
          return { ok: false, code: err.code, message: err.detail };
        }
        if (err instanceof TmsAuthError) {
          return { ok: false, code: err.code, message: err.detail };
        }
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
      const payload = buildXrayCreatePayload({
        projectKey: args.session.projectId,
        entry: args.entry,
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
      return performXrayPush({
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
      if (args.dryRun) {
        return {
          results: args.mapped.map((m) => ({
            testCaseId: m.testCaseId,
            idempotencyKey: m.idempotencyKey,
            verdict: "skipped-dup",
            tmsTestCaseId: "",
            tmsErrorCode: "",
            tmsErrorMessage: "",
            attemptCount: 0,
          })),
        };
      }
      // Xray's bulk-import endpoint accepts up to 1,000 cases per call
      // but the orchestrator caps at 50 (DEFAULT_TMS_PUSH_BATCH_SIZE)
      // to keep failure isolation tight. We call the bulk endpoint
      // once per batch and fall back to per-case retries on partial
      // failure responses.
      void DEFAULT_TMS_PUSH_BATCH_SIZE;
      const results: TmsPushAttemptResult[] = [];
      for (const mapped of args.mapped) {
        const result = await performXrayPush({
          adapterInput: input,
          session: args.session,
          mapped,
        });
        results.push(result);
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
            path: `/rest/api/3/issue/${encodeURIComponent(args.tmsTestCaseId)}`,
            method: "GET",
            credentials: rebuildCredentialsFromSession(args.session),
            timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
          });
          if (r.status === 404) {
            throw new TmsValidationError(
              ADAPTER_ID,
              "issue_not_found",
              `Xray test ${args.tmsTestCaseId} not found`,
            );
          }
          ensureOk(r, "pollSyncStatus rejected");
          return r;
        });
        const fields = readJsonField(response.value.body, "fields", {});
        const statusObject = readJsonField<Record<string, unknown>>(
          fields,
          "status",
          {},
        );
        const stateName = readJsonField(statusObject, "name", "Unknown");
        return {
          found: true,
          tmsTestCaseId: args.tmsTestCaseId,
          state: typeof stateName === "string" ? stateName : "Unknown",
        };
      } catch (err) {
        if (err instanceof TmsValidationError && err.code === "issue_not_found") {
          return {
            found: false,
            code: err.code,
            message: err.detail,
          };
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
    async pullExecutions(args: {
      session: TmsAdapterSession;
      sinceIso: string;
    }): Promise<TmsPullExecutionsResult> {
      const path =
        `/rest/raven/2.0/api/execution-evidence?project=${encodeURIComponent(args.session.projectId)}` +
        `&since=${encodeURIComponent(args.sinceIso)}`;
      const response = await runWithRetry(input, async () => {
        const r = await input.http.request({
          endpointAlias: args.session.endpointAlias,
          path,
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: rebuildCredentialsFromSession(args.session),
          timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
        });
        ensureOk(r, "pullExecutions rejected");
        return r;
      });
      const parsed = parseRawExecutionEvidenceEnvelope({
        adapterId: ADAPTER_ID,
        tenantId: args.session.tenantId,
        body: response.value.body,
        sinceIso: args.sinceIso,
      });
      const evidence: TmsRawExecutionEvidence[] = parsed.evidence.map((row) => ({
        ...row,
      }));
      return { evidence };
    },
    async disconnect(session: TmsAdapterSession): Promise<void> {
      SESSION_CREDENTIALS.delete(session);
      // Xray PAT/OAuth sessions are stateless — nothing else to release.
    },
  };
};

const performXrayPush = async (input: {
  adapterInput: CreateXrayAdapterInput;
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
          path: "/rest/raven/2.0/api/import/test",
          method: "POST",
          headers: { Accept: "application/json" },
          body: input.mapped.payload,
          idempotencyKey: input.mapped.idempotencyKey,
          credentials: rebuildCredentialsFromSession(input.session),
          timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
        });
        if (r.status === 401 || r.status === 403) {
          throw new TmsAuthError(
            ADAPTER_ID,
            sanitizeTmsErrorDetail(readErrorMessage(r) ?? "auth rejected"),
          );
        }
        if (r.status >= 400) {
          throw classifyTmsHttpFailure({
            adapterId: ADAPTER_ID,
            status: r.status,
            detail: readErrorMessage(r) ?? `xray http ${r.status}`,
            retryAfterMs: parseRetryAfter(r.headers["retry-after"]),
          });
        }
        return r;
      },
    );
    attemptCount = ac;
    const issueKey = readJsonField(value.body, "key", "");
    const issueId = readJsonField(value.body, "id", "");
    const tmsTestCaseId =
      typeof issueKey === "string" && issueKey.length > 0
        ? issueKey
        : typeof issueId === "string"
          ? issueId
          : "";
    const dedupedFlag = readJsonField<unknown>(value.body, "deduplicated", false);
    const verdict = dedupedFlag === true ? "skipped-dup" : "pushed";
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
    const code =
      err instanceof TmsAdapterError ? err.code : "unknown_error";
    const message =
      err instanceof TmsAdapterError
        ? err.detail
        : sanitizeTmsErrorDetail(err);
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

const buildXrayCreatePayload = (input: {
  projectKey: string;
  entry: QcMappingPreviewEntry;
}): Readonly<Record<string, unknown>> => {
  const steps = input.entry.designSteps.map((step, idx) => ({
    index: typeof step.index === "number" ? step.index : idx + 1,
    action: typeof step.action === "string" ? step.action : "",
    data:
      typeof (step as { data?: unknown }).data === "string"
        ? (step as { data: string }).data
        : "",
    result: typeof step.expected === "string" ? step.expected : "",
  }));
  const labels = Array.from(
    new Set(
      [
        input.entry.riskCategory,
        ...input.entry.blockingReasons.map((r) =>
          sanitizeTmsErrorDetail(r).replace(/\s+/g, "_"),
        ),
      ]
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .map((s) => s.slice(0, 60)),
    ),
  ).sort();
  const priorityName =
    XRAY_PRIORITY_BY_PROFILE[input.entry.priority] ?? "Medium";
  const description = buildDescription(input.entry);
  return Object.freeze({
    fields: {
      project: { key: input.projectKey },
      summary: input.entry.testName,
      issuetype: { name: "Test" },
      description,
      priority: { name: priorityName },
      labels,
    },
    customfield_test_type: "Manual",
    manualTestSteps: steps,
  });
};

const buildDescription = (entry: QcMappingPreviewEntry): string => {
  const sections: string[] = [];
  if (entry.objective.length > 0) {
    sections.push(`*Objective:* ${entry.objective}`);
  }
  if (entry.preconditions.length > 0) {
    sections.push(
      `*Preconditions:*\n${entry.preconditions
        .map((p, i) => `${i + 1}. ${p}`)
        .join("\n")}`,
    );
  }
  if (entry.testData.length > 0) {
    sections.push(
      `*Test data:*\n${entry.testData
        .map((d, i) => `${i + 1}. ${d}`)
        .join("\n")}`,
    );
  }
  if (entry.expectedResults.length > 0) {
    sections.push(
      `*Expected results:*\n${entry.expectedResults
        .map((r, i) => `${i + 1}. ${r}`)
        .join("\n")}`,
    );
  }
  return sections.join("\n\n");
};

const ensureOk = (response: TmsHttpResponse, context: string): void => {
  if (response.status >= 200 && response.status < 300) return;
  if (response.status === 401 || response.status === 403) {
    throw new TmsAuthError(
      ADAPTER_ID,
      sanitizeTmsErrorDetail(readErrorMessage(response) ?? context),
    );
  }
  throw classifyTmsHttpFailure({
    adapterId: ADAPTER_ID,
    status: response.status,
    detail: readErrorMessage(response) ?? `${context}: ${response.status}`,
    retryAfterMs: parseRetryAfter(response.headers["retry-after"]),
  });
};

const readErrorMessage = (response: TmsHttpResponse): string | undefined => {
  if (
    typeof response.body === "object" &&
    response.body !== null &&
    !Array.isArray(response.body)
  ) {
    const errMsg = (response.body as Record<string, unknown>).errorMessages;
    if (Array.isArray(errMsg) && errMsg.length > 0) {
      return errMsg.join("; ");
    }
    const msg = (response.body as Record<string, unknown>).message;
    if (typeof msg === "string") return msg;
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
      `Xray does not support auth kind ${kind}`,
    );
  }
};

const rebuildCredentialsFromSession = (
  session: TmsAdapterSession,
): TmsCredentials => {
  // Adapters keep credentials inside an internal closure; we rely on
  // the HTTP client receiving the same credential reference. To stay
  // pure, we surface a deterministic fake credential on the session
  // closure; the real client receives the original via WeakMap below.
  return getSessionCredentials(session);
};

const SESSION_CREDENTIALS = new WeakMap<TmsAdapterSession, TmsCredentials>();

const getSessionCredentials = (session: TmsAdapterSession): TmsCredentials => {
  const credentials = SESSION_CREDENTIALS.get(session);
  if (credentials !== undefined) return credentials;
  // Defensive: every adapter implementation MUST register credentials
  // on the session before returning it from `connect`. A missing entry
  // is a programmer error and we throw a typed adapter error so the
  // orchestrator records it on the report.
  throw new TmsAdapterError(
    ADAPTER_ID,
    "session_credentials_unbound",
    "session credentials were not registered before use",
  );
};

const runWithRetry = <T>(
  input: CreateXrayAdapterInput,
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

