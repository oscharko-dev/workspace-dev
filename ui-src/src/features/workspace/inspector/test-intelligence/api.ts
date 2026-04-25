// ---------------------------------------------------------------------------
// Test Intelligence Inspector — API client (Issue #1367)
//
// Thin async helpers around the `/workspace/test-intelligence/...` routes.
// Returns structured outcomes so the page components can render empty,
// loading, failed, and partial-result states without try/catch noise.
// ---------------------------------------------------------------------------

import { fetchJson } from "../../../../lib/http";
import type {
  ReviewActionInput,
  ReviewEvent,
  ReviewGateSnapshot,
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
  if (!isRecord(response.payload) || !Array.isArray(response.payload["jobs"])) {
    return {
      ok: false,
      status: response.status,
      error: "INVALID_RESPONSE",
      message: "Server returned an unexpected payload for the jobs list.",
    };
  }
  return {
    ok: true,
    value: response.payload["jobs"] as TestIntelligenceJobSummary[],
  };
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
  if (
    !isRecord(response.payload) ||
    typeof response.payload["jobId"] !== "string"
  ) {
    return {
      ok: false,
      status: response.status,
      error: "INVALID_RESPONSE",
      message:
        "Server returned an unexpected payload for the test-intelligence bundle.",
    };
  }
  return {
    ok: true,
    value: response.payload as unknown as TestIntelligenceBundle,
  };
}

export interface ReviewStateFetchOk {
  snapshot: ReviewGateSnapshot;
  events: ReviewEvent[];
}

export async function fetchReviewState(
  jobId: string,
): Promise<FetchOutcome<ReviewStateFetchOk>> {
  const response = await fetchJson<{
    snapshot: ReviewGateSnapshot;
    events: ReviewEvent[];
    ok: true;
  }>({
    url: `${ROOT}/review/${encodeURIComponent(jobId)}/state`,
  });
  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Failed to load review-gate state.",
    );
  }
  if (
    !isRecord(response.payload) ||
    !isRecord(response.payload["snapshot"]) ||
    !Array.isArray(response.payload["events"])
  ) {
    return {
      ok: false,
      status: response.status,
      error: "INVALID_RESPONSE",
      message:
        "Server returned an unexpected payload for the review-gate state.",
    };
  }
  return {
    ok: true,
    value: {
      snapshot: response.payload["snapshot"] as unknown as ReviewGateSnapshot,
      events: response.payload["events"] as unknown as ReviewEvent[],
    },
  };
}

export interface ReviewActionResult {
  ok: true;
  snapshot: ReviewGateSnapshot;
  event: ReviewEvent;
}

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
  const response = await fetchJson<ReviewActionResult>({
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
  if (
    !isRecord(response.payload) ||
    response.payload["ok"] !== true ||
    !isRecord(response.payload["snapshot"]) ||
    !isRecord(response.payload["event"])
  ) {
    return {
      ok: false,
      status: response.status,
      error: "INVALID_RESPONSE",
      message: "Server returned an unexpected payload for the review action.",
    };
  }
  return {
    ok: true,
    value: {
      ok: true,
      snapshot: response.payload["snapshot"] as unknown as ReviewGateSnapshot,
      event: response.payload["event"] as unknown as ReviewEvent,
    },
  };
}
