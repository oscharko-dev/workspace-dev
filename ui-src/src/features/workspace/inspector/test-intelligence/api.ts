// ---------------------------------------------------------------------------
// Test Intelligence Inspector — API client (Issue #1367)
//
// Thin async helpers around the `/workspace/test-intelligence/...` routes.
// Returns structured outcomes so the page components can render empty,
// loading, failed, and partial-result states without try/catch noise.
//
// Every server response is validated by a runtime guard before assignment
// to its strict TS type — there are no `as`/`as unknown as` casts on the
// happy path. A schema mismatch surfaces as `INVALID_RESPONSE` so the UI
// can render an actionable error rather than crashing in a downstream
// component.
// ---------------------------------------------------------------------------

import { fetchJson } from "../../../../lib/http";
import {
  isReviewActionEnvelope,
  isReviewStateEnvelope,
  isTestIntelligenceBundle,
  isTestIntelligenceJobSummaryArray,
  type ReviewActionEnvelope,
  type ReviewStateEnvelope,
} from "./payload-guards";
import type {
  ReviewActionInput,
  TestIntelligenceBundle,
  TestIntelligenceJobSummary,
} from "./types";

const ROOT = "/workspace/test-intelligence";

export type FetchOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const errorOutcomeFromPayload = <T>(
  status: number,
  payload: unknown,
  fallback: string,
): FetchOutcome<T> => {
  const errorCode =
    isRecord(payload) && typeof payload["error"] === "string"
      ? payload["error"]
      : "REQUEST_FAILED";
  const message =
    isRecord(payload) && typeof payload["message"] === "string"
      ? payload["message"]
      : fallback;
  return { ok: false, status, error: errorCode, message };
};

const invalidResponse = <T>(
  status: number,
  target: string,
): FetchOutcome<T> => ({
  ok: false,
  status,
  error: "INVALID_RESPONSE",
  message: `Server returned an unexpected payload for ${target}.`,
});

export async function fetchTestIntelligenceJobs(): Promise<
  FetchOutcome<TestIntelligenceJobSummary[]>
> {
  const response = await fetchJson<{ jobs: TestIntelligenceJobSummary[] }>({
    url: `${ROOT}/jobs`,
  });
  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Failed to load test-intelligence jobs.",
    );
  }
  if (
    !isRecord(response.payload) ||
    !isTestIntelligenceJobSummaryArray(response.payload["jobs"])
  ) {
    return invalidResponse(response.status, "the jobs list");
  }
  return { ok: true, value: response.payload["jobs"] };
}

export async function fetchTestIntelligenceBundle(
  jobId: string,
): Promise<FetchOutcome<TestIntelligenceBundle>> {
  const response = await fetchJson<TestIntelligenceBundle>({
    url: `${ROOT}/jobs/${encodeURIComponent(jobId)}`,
  });
  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Failed to load test-intelligence bundle.",
    );
  }
  if (!isTestIntelligenceBundle(response.payload)) {
    return invalidResponse(response.status, "the test-intelligence bundle");
  }
  return { ok: true, value: response.payload };
}

export type ReviewStateFetchOk = ReviewStateEnvelope;

export async function fetchReviewState(
  jobId: string,
): Promise<FetchOutcome<ReviewStateFetchOk>> {
  const response = await fetchJson<ReviewStateEnvelope>({
    url: `${ROOT}/review/${encodeURIComponent(jobId)}/state`,
  });
  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Failed to load review-gate state.",
    );
  }
  if (!isReviewStateEnvelope(response.payload)) {
    return invalidResponse(response.status, "the review-gate state");
  }
  return { ok: true, value: response.payload };
}

export type ReviewActionResult = ReviewActionEnvelope;

export interface PostReviewActionInput extends ReviewActionInput {
  bearerToken: string;
}

export async function postReviewAction(
  input: PostReviewActionInput,
): Promise<FetchOutcome<ReviewActionResult>> {
  const segments = [
    "review",
    encodeURIComponent(input.jobId),
    encodeURIComponent(input.action),
  ];
  if (input.testCaseId !== undefined) {
    segments.push(encodeURIComponent(input.testCaseId));
  }
  const response = await fetchJson<ReviewActionEnvelope>({
    url: `${ROOT}/${segments.join("/")}`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.bearerToken}`,
      },
      body: JSON.stringify({
        at: new Date().toISOString(),
        ...(input.actor !== undefined ? { actor: input.actor } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      }),
    },
  });

  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Review action was rejected by the server.",
    );
  }
  if (!isReviewActionEnvelope(response.payload)) {
    return invalidResponse(response.status, "the review action");
  }
  return { ok: true, value: response.payload };
}
