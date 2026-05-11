/**
 * Review-gate handler (Issue #1365).
 *
 * Stateless, bearer-protected handler that mirrors the import-session
 * governance pattern (`validateImportSessionEventWriteAuth`):
 *
 *   - SHA-256 timing-safe bearer token comparison
 *   - case-insensitive `Bearer` scheme parse with whitespace tolerance
 *   - 503 when the server's bearer token is not configured (fail-closed)
 *   - 401 when no/invalid token is provided
 *   - 400 on malformed body
 *   - 404 on unknown action
 *   - 200 on a successful state transition
 *
 * The handler is invoked in-process (not via a public HTTP route) so the
 * public surface remains unchanged. Operators may bridge it into a
 * server route when ready, but that wiring is out of scope here.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import type {
  ReviewEvent,
  ReviewEventKind,
  ReviewGateSnapshot,
  TestIntelligenceReviewPrincipal,
} from "../contracts/index.js";
import type { RecordTransitionInput, ReviewStore } from "./review-store.js";

const BEARER_REALM = "workspace-dev-test-intelligence-review";
const LEGACY_REVIEW_PRINCIPAL_ID = "legacy-review-bearer";

export interface ReviewRequestEnvelope {
  /**
   * Configured server bearer token. When `undefined` the handler returns 503
   * for any write action so review writes fail-closed.
   */
  bearerToken: string | undefined;
  /**
   * Optional principal-bound bearer credentials. When present, matching
   * tokens derive the authoritative review actor from `principalId`.
   */
  reviewPrincipals?: readonly TestIntelligenceReviewPrincipal[];
  /** Raw `Authorization` header value, if any. */
  authorizationHeader: string | undefined;
  /**
   * HTTP-style verb. The handler accepts only `GET` and `POST`; any other
   * value is rejected with a 405 so callers cannot smuggle write semantics
   * through `PUT`/`DELETE`.
   */
  method: string;
  /** Action name (e.g. "approve", "reject", "review-started", "edit", "note"). */
  action: string;
  jobId: string;
  /** Optional target test case identifier (required for state transitions). */
  testCaseId?: string;
  /** ISO-8601 timestamp the caller intends to record on the event. */
  at: string;
  /** Optional actor handle (never an email or token). */
  actor?: string;
  /** Optional reviewer note. */
  note?: string;
  /** Optional flat metadata bag attached to the event. */
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ReviewRequestSuccessBody {
  ok: true;
  event: ReviewEvent;
  snapshot: ReviewGateSnapshot;
}

export interface ReviewRequestStateBody {
  ok: true;
  snapshot: ReviewGateSnapshot;
  events: ReviewEvent[];
}

export interface ReviewRequestErrorBody {
  ok: false;
  error: string;
  message: string;
  refusalCode?: string;
}

export interface ReviewResponse {
  statusCode: number;
  body:
    | ReviewRequestSuccessBody
    | ReviewRequestStateBody
    | ReviewRequestErrorBody;
  wwwAuthenticate?: string;
}

const ACTION_TO_KIND: Record<string, ReviewEventKind> = {
  "review-started": "review_started",
  approve: "approved",
  "primary-approve": "primary_approved",
  "secondary-approve": "secondary_approved",
  reject: "rejected",
  edit: "edited",
  export: "exported",
  note: "note",
};

const READ_ACTIONS = new Set(["state"]);

const isAsciiHorizontalWhitespace = (code: number): boolean =>
  code === 0x20 || code === 0x09;

const readBearerToken = (
  authorization: string | undefined,
): string | undefined => {
  if (typeof authorization !== "string" || authorization.length === 0) {
    return undefined;
  }
  if (!/^[Bb][Ee][Aa][Rr][Ee][Rr]/.test(authorization)) {
    return undefined;
  }
  let tokenStart = "Bearer".length;
  while (
    tokenStart < authorization.length &&
    isAsciiHorizontalWhitespace(authorization.charCodeAt(tokenStart))
  ) {
    tokenStart += 1;
  }
  if (tokenStart === "Bearer".length || tokenStart >= authorization.length) {
    return undefined;
  }
  let tokenEnd = authorization.length;
  while (
    tokenEnd > tokenStart &&
    isAsciiHorizontalWhitespace(authorization.charCodeAt(tokenEnd - 1))
  ) {
    tokenEnd -= 1;
  }
  return tokenEnd > tokenStart
    ? authorization.slice(tokenStart, tokenEnd)
    : undefined;
};

const tokensMatch = (expected: string, candidate: string): boolean => {
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const candidateDigest = createHash("sha256")
    .update(candidate, "utf8")
    .digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
};

const normalizeConfiguredToken = (
  token: string | undefined,
): string | undefined => {
  if (typeof token !== "string") return undefined;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const writeActionRequiresAuth = (action: string): boolean => {
  return !READ_ACTIONS.has(action);
};

const refusalCodeToHttpStatus = (code: string): number => {
  switch (code) {
    case "snapshot_missing":
    case "test_case_unknown":
      return 404;
    case "test_case_id_required":
    case "note_too_long":
    case "actor_too_long":
    case "kind_unknown":
    case "four_eyes_actor_required":
      return 400;
    case "transition_not_allowed":
    case "policy_blocks_approval":
    case "policy_requires_review":
    case "self_approval_refused":
    case "duplicate_principal_refused":
    case "primary_approval_required":
    case "four_eyes_not_required":
      return 409;
    default:
      return 400;
  }
};

const errorBody = (
  error: string,
  message: string,
  refusalCode?: string,
): ReviewRequestErrorBody => ({
  ok: false,
  error,
  message,
  ...(refusalCode !== undefined ? { refusalCode } : {}),
});

/** Validate bearer auth fail-closed and return a structured response. */
const validateAuth = (
  envelope: ReviewRequestEnvelope,
): { ok: true; principalId: string } | { ok: false; response: ReviewResponse } => {
  const configured = normalizeConfiguredToken(envelope.bearerToken);
  const principals = (envelope.reviewPrincipals ?? [])
    .map((principal) => ({
      principalId: principal.principalId.trim(),
      bearerToken: normalizeConfiguredToken(principal.bearerToken),
    }))
    .filter(
      (
        principal,
      ): principal is { principalId: string; bearerToken: string } =>
        principal.principalId.length > 0 &&
        principal.bearerToken !== undefined,
    );
  if (!configured && principals.length === 0) {
    return {
      ok: false,
      response: {
        statusCode: 503,
        body: errorBody(
          "AUTHENTICATION_UNAVAILABLE",
          "Review-gate writes are disabled until server bearer authentication is configured.",
        ),
      },
    };
  }
  const received = readBearerToken(envelope.authorizationHeader);
  if (received) {
    for (const principal of principals) {
      if (tokensMatch(principal.bearerToken, received)) {
        return { ok: true, principalId: principal.principalId };
      }
    }
    if (configured && tokensMatch(configured, received)) {
      return { ok: true, principalId: LEGACY_REVIEW_PRINCIPAL_ID };
    }
  }
  return {
    ok: false,
    response: {
      statusCode: 401,
      body: errorBody(
        "UNAUTHORIZED",
        "Review-gate writes require a valid Bearer token.",
      ),
      wwwAuthenticate: `Bearer realm="${BEARER_REALM}"`,
    },
  };
};

/** Handle one review-gate request. The handler is fully self-contained. */
export const handleReviewRequest = async (
  envelope: ReviewRequestEnvelope,
  store: ReviewStore,
): Promise<ReviewResponse> => {
  if (envelope.method !== "GET" && envelope.method !== "POST") {
    return {
      statusCode: 405,
      body: errorBody(
        "METHOD_NOT_ALLOWED",
        `Method ${envelope.method} is not allowed on review-gate routes.`,
      ),
    };
  }

  if (writeActionRequiresAuth(envelope.action)) {
    const auth = validateAuth(envelope);
    if (!auth.ok) return auth.response;
    envelope = {
      ...envelope,
      actor: auth.principalId,
    };
  }

  if (envelope.method === "GET") {
    if (envelope.action !== "state") {
      return {
        statusCode: 404,
        body: errorBody(
          "UNKNOWN_ACTION",
          `Unknown review-gate read action: ${envelope.action}`,
        ),
      };
    }
    const snapshot = await store.readSnapshot(envelope.jobId);
    if (!snapshot) {
      return {
        statusCode: 404,
        body: errorBody(
          "SNAPSHOT_MISSING",
          `No review-gate snapshot exists for job ${envelope.jobId}.`,
        ),
      };
    }
    const events = await store.listEvents(envelope.jobId);
    return {
      statusCode: 200,
      body: { ok: true, snapshot, events },
    };
  }

  const kind = ACTION_TO_KIND[envelope.action];
  if (!kind) {
    return {
      statusCode: 404,
      body: errorBody(
        "UNKNOWN_ACTION",
        `Unknown review-gate write action: ${envelope.action}`,
      ),
    };
  }

  const transitionInput: RecordTransitionInput = {
    jobId: envelope.jobId,
    kind,
    at: envelope.at,
    ...(envelope.testCaseId !== undefined
      ? { testCaseId: envelope.testCaseId }
      : {}),
    ...(envelope.actor !== undefined ? { actor: envelope.actor } : {}),
    ...(envelope.note !== undefined ? { note: envelope.note } : {}),
    ...(envelope.metadata !== undefined ? { metadata: envelope.metadata } : {}),
  };

  const result = await store.recordTransition(transitionInput);
  if (!result.ok) {
    return {
      statusCode: refusalCodeToHttpStatus(result.code),
      body: errorBody(
        "TRANSITION_REFUSED",
        `Review-gate ${envelope.action} refused: ${result.code}.`,
        result.code,
      ),
    };
  }
  return {
    statusCode: 200,
    body: { ok: true, event: result.event, snapshot: result.snapshot },
  };
};

/**
 * Map a free-form HTTP-like path to a `ReviewRequestEnvelope` skeleton.
 * Operators that bridge this handler into a real HTTP server can use the
 * helper to keep path conventions in lockstep across deployments.
 *
 * Path: `/workspace/test-intelligence/review/<jobId>/<action>` for job-level
 * actions and `/workspace/test-intelligence/review/<jobId>/<action>/<testCaseId>`
 * for per-test-case actions.
 */
export const parseReviewRoute = (
  pathname: string,
):
  | {
      ok: true;
      jobId: string;
      action: string;
      testCaseId?: string;
    }
  | { ok: false; reason: string } => {
  const prefix = "/workspace/test-intelligence/review/";
  if (!pathname.startsWith(prefix)) {
    return { ok: false, reason: "prefix_mismatch" };
  }
  const remainder = pathname.slice(prefix.length);
  const segments = remainder.split("/").filter((s) => s.length > 0);
  if (segments.length < 2 || segments.length > 3) {
    return { ok: false, reason: "segment_count_invalid" };
  }
  const [jobId, action, testCaseId] = segments as [
    string,
    string,
    string | undefined,
  ];
  if (jobId === "" || action === "") {
    return { ok: false, reason: "empty_segment" };
  }
  return testCaseId !== undefined
    ? { ok: true, jobId, action, testCaseId }
    : { ok: true, jobId, action };
};
