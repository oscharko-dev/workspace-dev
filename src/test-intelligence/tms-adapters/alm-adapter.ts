/**
 * Production-grade OpenText / HP ALM adapter (Issue #2183, Wave 8).
 *
 * Targets OpenText (formerly HP) ALM REST API v12 and later. Unlike
 * Atlassian/Tricentis tools, ALM is session-oriented: the caller
 * authenticates once, receives an `LWSSO_COOKIE_KEY` cookie, and
 * threads it through every subsequent request as `Cookie:` plus an
 * `X-XSRF-TOKEN` derived from the QC session. Disconnect explicitly
 * invalidates the cookie.
 *
 * Endpoints used (relative to the resolved ALM base URL):
 *   - `POST /authentication-point/authenticate` — Basic auth →
 *                                                 LWSSO cookie
 *   - `POST /qcbin/rest/site-session`           — open QC session
 *   - `GET  /qcbin/rest/domains/{d}/projects/{p}` — validateProject
 *   - `POST /qcbin/rest/domains/{d}/projects/{p}/tests` — create test
 *   - `POST /qcbin/rest/domains/{d}/projects/{p}/design-steps` — steps
 *   - `GET  /qcbin/rest/domains/{d}/projects/{p}/tests/{id}` — poll
 *   - `POST /qcbin/rest/site-session/sign-out`  — disconnect
 *
 * Authentication: PAT (preferred for ALM 12.55+) or Bearer token
 * (OpenText ALM 16+). The adapter calls `Basic` to mint the LWSSO
 * cookie, then transitions to cookie-based auth for the remainder of
 * the session. The configured token is the password supplied in the
 * Basic header; the adapter reads the username from the
 * `principalId` field on the credentials object (defaulting to
 * `tms-principal:default`).
 *
 * Idempotency: ALM has no native idempotency-key header, so the
 * adapter sends the key as `X-Tms-Idempotency-Key` AND prefixes the
 * `name` field with the SHA-256 first 12 chars so a re-run looks up
 * the prior entity by deterministic name and short-circuits.
 *
 * Schema mapping (ALM `test` entity v12+):
 *   - name              ← `entry.testName` (idempotency-prefixed)
 *   - description       ← `entry.objective` + design steps
 *   - subtype-id        ← `MANUAL` (default)
 *   - priority          ← ALM priority enum (`1-Low..5-Urgent`)
 *   - user-01           ← `entry.riskCategory`
 *   - parent-id         ← resolved folder id (mapping profile)
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

const ADAPTER_ID: TmsAdapterId = "alm";
export const ALM_ADAPTER_VERSION = "1.0.0" as const;

const SUPPORTED_AUTH_KINDS = new Set<TmsCredentials["kind"]>(["pat", "bearer"]);

const ALM_PRIORITY_BY_PROFILE: Readonly<Record<string, string>> = {
  P0: "5-Urgent",
  P1: "4-Very High",
  P2: "3-High",
  P3: "2-Medium",
  P4: "1-Low",
};

/**
 * ALM domain + project pair. Issue #2183 mandates ALM-specific
 * project ids be expressed as `domain/project`; the adapter parses
 * the `connectInput.projectId` field with this regex and refuses
 * malformed inputs at `connect` time.
 */
const ALM_PROJECT_ID_PATTERN = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/;

/** Inputs for `createAlmAdapter`. */
export interface CreateAlmAdapterInput {
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
const SESSION_COOKIES = new WeakMap<TmsAdapterSession, AlmSessionCookies>();

interface AlmSessionCookies {
  lwsso: string;
  qcSession: string;
  xsrfToken: string;
}

interface AlmDomainProject {
  domain: string;
  project: string;
}

const parseProjectId = (raw: string): AlmDomainProject => {
  const match = ALM_PROJECT_ID_PATTERN.exec(raw);
  if (!match) {
    throw new TmsValidationError(
      ADAPTER_ID,
      "invalid_project_id",
      `expected ALM project id in <domain>/<project> shape, received ${raw}`,
    );
  }
  return { domain: match[1]!, project: match[2]! };
};

/** Construct the ALM adapter with an injected HTTP client. */
export const createAlmAdapter = (input: CreateAlmAdapterInput): TmsAdapter => {
  const version = input.version ?? ALM_ADAPTER_VERSION;
  return {
    adapterId: ADAPTER_ID,
    version,
    supportedAuthKinds: SUPPORTED_AUTH_KINDS,
    async connect(connectInput: TmsConnectInput): Promise<TmsAdapterSession> {
      assertSupportedAuthKind(connectInput.credentials.kind);
      const { domain, project } = parseProjectId(connectInput.projectId);
      const principalId = resolvePrincipalId(
        connectInput.credentials.principalId,
      );
      // 1. Authenticate against the ALM LWSSO endpoint.
      const authResp = await runWithRetry(input, async () => {
        const r = await input.http.request({
          endpointAlias: connectInput.endpointAlias,
          path: "/authentication-point/authenticate",
          method: "POST",
          headers: { Accept: "application/xml" },
          credentials: connectInput.credentials,
          timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
        });
        if (r.status === 401 || r.status === 403) {
          throw new TmsAuthError(
            ADAPTER_ID,
            sanitizeTmsErrorDetail(
              readErrorMessage(r) ?? "ALM Basic auth rejected",
            ),
          );
        }
        if (r.status >= 400) {
          throw classifyTmsHttpFailure({
            adapterId: ADAPTER_ID,
            status: r.status,
            detail: readErrorMessage(r) ?? `ALM auth http ${r.status}`,
          });
        }
        return r;
      });
      const lwsso = readCookieFromHeaders(
        authResp.value.headers,
        "LWSSO_COOKIE_KEY",
      );
      if (lwsso === undefined) {
        throw new TmsAuthError(
          ADAPTER_ID,
          "ALM auth succeeded but no LWSSO_COOKIE_KEY cookie in response",
        );
      }
      // 2. Open a QC session (mints QCSession + XSRF cookies).
      const sessionResp = await runWithRetry(input, async () => {
        const r = await input.http.request({
          endpointAlias: connectInput.endpointAlias,
          path: "/qcbin/rest/site-session",
          method: "POST",
          headers: {
            Cookie: `LWSSO_COOKIE_KEY=${lwsso}`,
            Accept: "application/xml",
          },
          credentials: connectInput.credentials,
          timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
        });
        if (r.status >= 400) {
          throw classifyTmsHttpFailure({
            adapterId: ADAPTER_ID,
            status: r.status,
            detail: readErrorMessage(r) ?? `ALM site-session http ${r.status}`,
          });
        }
        return r;
      });
      const qcSession = readCookieFromHeaders(
        sessionResp.value.headers,
        "QCSession",
      );
      const xsrfToken =
        readCookieFromHeaders(sessionResp.value.headers, "XSRF-TOKEN") ?? "";
      if (qcSession === undefined) {
        throw new TmsAuthError(
          ADAPTER_ID,
          "ALM site-session succeeded but no QCSession cookie in response",
        );
      }
      const session: TmsAdapterSession = Object.freeze({
        endpointAlias: connectInput.endpointAlias,
        projectId: connectInput.projectId,
        tenantId: connectInput.tenantId,
        principalId,
        internal: Object.freeze({
          authKind: connectInput.credentials.kind,
          domain,
          project,
        }),
      });
      SESSION_CREDENTIALS.set(session, connectInput.credentials);
      SESSION_COOKIES.set(session, { lwsso, qcSession, xsrfToken });
      return session;
    },
    async validateProject(
      session: TmsAdapterSession,
    ): Promise<TmsValidateProjectResult> {
      try {
        const { domain, project } = readDomainProjectFromSession(session);
        const cookies = readCookies(session);
        const response = await runWithRetry(input, async () => {
          const r = await input.http.request({
            endpointAlias: session.endpointAlias,
            path: `/qcbin/rest/domains/${encodeURIComponent(
              domain,
            )}/projects/${encodeURIComponent(project)}`,
            method: "GET",
            headers: buildAuthedHeaders(cookies),
            credentials: readCredentials(session),
            timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
          });
          if (r.status === 404) {
            throw new TmsValidationError(
              ADAPTER_ID,
              "project_not_found",
              `ALM project ${project} in domain ${domain} not found`,
            );
          }
          if (r.status >= 400) {
            throw classifyTmsHttpFailure({
              adapterId: ADAPTER_ID,
              status: r.status,
              detail:
                readErrorMessage(r) ?? `ALM validateProject http ${r.status}`,
            });
          }
          return r;
        });
        // ALM returns either XML or JSON depending on Accept header.
        // We sent JSON-friendly headers above; fall back to the
        // requested project id when the body is empty.
        void response;
        return {
          ok: true,
          resolvedProjectId: `${domain}/${project}`,
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
      const payload = buildAlmCreatePayload({
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
      return performAlmPush({
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
          await performAlmPush({
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
        const { domain, project } = readDomainProjectFromSession(args.session);
        const cookies = readCookies(args.session);
        const response = await runWithRetry(input, async () => {
          const r = await input.http.request({
            endpointAlias: args.session.endpointAlias,
            path: `/qcbin/rest/domains/${encodeURIComponent(
              domain,
            )}/projects/${encodeURIComponent(project)}/tests/${encodeURIComponent(
              args.tmsTestCaseId,
            )}`,
            method: "GET",
            headers: buildAuthedHeaders(cookies),
            credentials: readCredentials(args.session),
            timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
          });
          if (r.status === 404) {
            throw new TmsValidationError(
              ADAPTER_ID,
              "test_not_found",
              `ALM test ${args.tmsTestCaseId} not found`,
            );
          }
          if (r.status >= 400) {
            throw classifyTmsHttpFailure({
              adapterId: ADAPTER_ID,
              status: r.status,
              detail: readErrorMessage(r) ?? `ALM poll http ${r.status}`,
            });
          }
          return r;
        });
        const state = readJsonField(response.value.body, "status", "Active");
        return {
          found: true,
          tmsTestCaseId: args.tmsTestCaseId,
          state: typeof state === "string" ? state : "Active",
        };
      } catch (err) {
        if (err instanceof TmsValidationError && err.code === "test_not_found") {
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
    async pullExecutions(args: {
      session: TmsAdapterSession;
      sinceIso: string;
    }): Promise<TmsPullExecutionsResult> {
      const { domain, project } = readDomainProjectFromSession(args.session);
      const cookies = readCookies(args.session);
      const path =
        `/qcbin/rest/domains/${encodeURIComponent(domain)}` +
        `/projects/${encodeURIComponent(project)}/execution-evidence?since=${encodeURIComponent(args.sinceIso)}`;
      const response = await runWithRetry(input, async () => {
        const r = await input.http.request({
          endpointAlias: args.session.endpointAlias,
          path,
          method: "GET",
          headers: buildAuthedHeaders(cookies),
          credentials: readCredentials(args.session),
          timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
        });
        if (r.status >= 400) {
          throw classifyTmsHttpFailure({
            adapterId: ADAPTER_ID,
            status: r.status,
            detail: readErrorMessage(r) ?? `ALM pullExecutions http ${r.status}`,
          });
        }
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
      const cookies = SESSION_COOKIES.get(session);
      if (cookies !== undefined) {
        try {
          await input.http.request({
            endpointAlias: session.endpointAlias,
            path: "/qcbin/rest/site-session/sign-out",
            method: "POST",
            headers: buildAuthedHeaders(cookies),
            credentials: readCredentials(session),
            timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
          });
        } catch {
          // Sign-out best-effort — the orchestrator must not fail a
          // run because the tenant rejected an idempotent close.
        }
      }
      SESSION_CREDENTIALS.delete(session);
      SESSION_COOKIES.delete(session);
    },
  };
};

const performAlmPush = async (input: {
  adapterInput: CreateAlmAdapterInput;
  session: TmsAdapterSession;
  mapped: TmsMappedCase;
}): Promise<TmsPushAttemptResult> => {
  let attemptCount = 0;
  try {
    const { domain, project } = readDomainProjectFromSession(input.session);
    const cookies = readCookies(input.session);
    // 1. Idempotency lookup by deterministic name prefix.
    const rawName = (input.mapped.payload as Record<string, unknown>)["name"];
    const lookupName = typeof rawName === "string" ? rawName : "";
    const lookup = await runWithRetry(input.adapterInput, async () => {
      const r = await input.adapterInput.http.request({
        endpointAlias: input.session.endpointAlias,
        path: `/qcbin/rest/domains/${encodeURIComponent(
          domain,
        )}/projects/${encodeURIComponent(
          project,
        )}/tests?query={name[${encodeURIComponent(lookupName)}]}&page-size=1`,
        method: "GET",
        headers: buildAuthedHeaders(cookies),
        credentials: readCredentials(input.session),
        timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
      });
      if (r.status >= 400) {
        throw classifyTmsHttpFailure({
          adapterId: ADAPTER_ID,
          status: r.status,
          detail: readErrorMessage(r) ?? `ALM lookup http ${r.status}`,
        });
      }
      return r;
    });
    attemptCount = lookup.attemptCount;
    const lookupHits = readJsonField<unknown>(lookup.value.body, "entities", []);
    if (Array.isArray(lookupHits) && lookupHits.length > 0) {
      const existingId = readJsonField(
        lookupHits[0],
        "id",
        "",
      );
      return {
        testCaseId: input.mapped.testCaseId,
        idempotencyKey: input.mapped.idempotencyKey,
        verdict: "skipped-dup",
        tmsTestCaseId: typeof existingId === "string" ? existingId : "",
        tmsErrorCode: "",
        tmsErrorMessage: "",
        attemptCount,
      };
    }
    // 2. Create the test entity.
    const create = await runWithRetry(input.adapterInput, async () => {
      attemptCount += 1;
      const r = await input.adapterInput.http.request({
        endpointAlias: input.session.endpointAlias,
        path: `/qcbin/rest/domains/${encodeURIComponent(
          domain,
        )}/projects/${encodeURIComponent(project)}/tests`,
        method: "POST",
        headers: {
          ...buildAuthedHeaders(cookies),
          "X-Tms-Idempotency-Key": input.mapped.idempotencyKey,
        },
        body: input.mapped.payload,
        idempotencyKey: input.mapped.idempotencyKey,
        credentials: readCredentials(input.session),
        timeoutMs: DEFAULT_TMS_REQUEST_TIMEOUT_MS,
      });
      if (r.status === 401 || r.status === 403) {
        throw new TmsAuthError(
          ADAPTER_ID,
          sanitizeTmsErrorDetail(readErrorMessage(r) ?? "ALM auth rejected"),
        );
      }
      if (r.status >= 400) {
        throw classifyTmsHttpFailure({
          adapterId: ADAPTER_ID,
          status: r.status,
          detail: readErrorMessage(r) ?? `ALM create http ${r.status}`,
        });
      }
      return r;
    });
    const newId = readJsonField(create.value.body, "id", "");
    if (typeof newId !== "string" || newId.length === 0) {
      throw new TmsValidationError(
        ADAPTER_ID,
        "create_response_missing_id",
        "ALM create succeeded but no id field in body",
      );
    }
    return {
      testCaseId: input.mapped.testCaseId,
      idempotencyKey: input.mapped.idempotencyKey,
      verdict: "pushed",
      tmsTestCaseId: newId,
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

const buildAlmCreatePayload = (input: {
  entry: QcMappingPreviewEntry;
  idempotencyKey: string;
}): Readonly<Record<string, unknown>> => {
  const idPrefix = input.idempotencyKey.slice(0, 12);
  const description = buildAlmDescription(input.entry);
  return Object.freeze({
    name: `[${idPrefix}] ${input.entry.testName}`,
    description,
    "subtype-id": "MANUAL",
    priority: ALM_PRIORITY_BY_PROFILE[input.entry.priority] ?? "3-High",
    "user-01": input.entry.riskCategory,
    "owner-mode": "test_owner",
    designSteps: input.entry.designSteps.map((step, idx) => ({
      "step-order": typeof step.index === "number" ? step.index : idx + 1,
      "step-name": `Step ${idx + 1}`,
      description: typeof step.action === "string" ? step.action : "",
      expected: typeof step.expected === "string" ? step.expected : "",
    })),
  });
};

const buildAlmDescription = (entry: QcMappingPreviewEntry): string => {
  const sections: string[] = [];
  if (entry.objective.length > 0) {
    sections.push(`<p><b>Objective:</b> ${escapeHtml(entry.objective)}</p>`);
  }
  if (entry.preconditions.length > 0) {
    sections.push(
      `<p><b>Preconditions:</b></p><ol>${entry.preconditions
        .map((p) => `<li>${escapeHtml(p)}</li>`)
        .join("")}</ol>`,
    );
  }
  if (entry.testData.length > 0) {
    sections.push(
      `<p><b>Test data:</b></p><ol>${entry.testData
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

const buildAuthedHeaders = (
  cookies: AlmSessionCookies,
): Readonly<Record<string, string>> =>
  Object.freeze({
    Cookie: `LWSSO_COOKIE_KEY=${cookies.lwsso}; QCSession=${cookies.qcSession}`,
    "X-XSRF-TOKEN": cookies.xsrfToken,
    Accept: "application/json",
    "Content-Type": "application/json",
  });

const readCookieFromHeaders = (
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined => {
  const setCookie = headers["set-cookie"] ?? headers["Set-Cookie"];
  if (typeof setCookie !== "string") return undefined;
  for (const cookie of setCookie.split(/,(?=\s*[A-Za-z0-9_-]+=)/)) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(`${name}=`)) {
      const value = trimmed.slice(name.length + 1).split(";", 1)[0];
      return value !== undefined ? value.trim() : undefined;
    }
  }
  return undefined;
};

const readErrorMessage = (response: TmsHttpResponse): string | undefined => {
  if (
    typeof response.body === "object" &&
    response.body !== null &&
    !Array.isArray(response.body)
  ) {
    const detail = (response.body as Record<string, unknown>)["Title"] ??
      (response.body as Record<string, unknown>)["title"] ??
      (response.body as Record<string, unknown>)["message"] ??
      (response.body as Record<string, unknown>)["StackTrace"];
    if (typeof detail === "string") return detail;
  }
  if (response.bodyBytes !== undefined) {
    try {
      return new TextDecoder("utf-8").decode(response.bodyBytes).slice(0, 240);
    } catch {
      return undefined;
    }
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
      `ALM does not support auth kind ${kind}`,
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

const readCookies = (session: TmsAdapterSession): AlmSessionCookies => {
  const c = SESSION_COOKIES.get(session);
  if (c === undefined) {
    throw new TmsAdapterError(
      ADAPTER_ID,
      "session_cookies_unbound",
      "session cookies were not registered before use",
    );
  }
  return c;
};

const readDomainProjectFromSession = (
  session: TmsAdapterSession,
): AlmDomainProject => {
  const internal = session.internal as Record<string, unknown>;
  const domain = internal["domain"];
  const project = internal["project"];
  if (typeof domain !== "string" || typeof project !== "string") {
    throw new TmsAdapterError(
      ADAPTER_ID,
      "session_invalid",
      "ALM session missing domain/project metadata",
    );
  }
  return { domain, project };
};

const runWithRetry = <T>(
  input: CreateAlmAdapterInput,
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
