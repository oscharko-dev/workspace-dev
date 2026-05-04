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
  isFetchSourcesResponse,
  isReviewActionEnvelope,
  isReviewStateEnvelope,
  isResolveConflictResponse,
  isTestIntelligenceBundle,
  isTestIntelligenceJobSummaryArray,
  type ReviewActionEnvelope,
  type ReviewStateEnvelope,
} from "./payload-guards";
import type {
  EvidenceVerifyResponse,
  FetchSourcesResponse,
  ResolveConflictInput,
  ResolveConflictResponse,
  ReviewActionInput,
  TestIntelligenceBundle,
  TestIntelligenceJobSummary,
} from "./types";

const ROOT = "/workspace/test-intelligence";
const WORKSPACE_ROOT = "/workspace";

export type FetchOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const EVIDENCE_VERIFY_CHECK_KINDS = new Set([
  "artifact_sha256",
  "manifest_metadata",
  "manifest_digest_witness",
  "visual_sidecar_evidence",
  "attestation_envelope",
  "attestation_signatures",
]);

const isEvidenceVerifyResponse = (
  value: unknown,
): value is EvidenceVerifyResponse => {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value["schemaVersion"] !== "string" ||
    typeof value["verifiedAt"] !== "string" ||
    typeof value["jobId"] !== "string" ||
    typeof value["ok"] !== "boolean" ||
    typeof value["manifestSha256"] !== "string" ||
    !Array.isArray(value["checks"]) ||
    !Array.isArray(value["failures"])
  ) {
    return false;
  }

  return value["checks"].every((entry) => {
    if (!isRecord(entry)) {
      return false;
    }
    if (
      typeof entry["kind"] !== "string" ||
      !EVIDENCE_VERIFY_CHECK_KINDS.has(entry["kind"]) ||
      typeof entry["ok"] !== "boolean" ||
      typeof entry["reference"] !== "string"
    ) {
      return false;
    }
    return (
      (entry["failureCode"] === undefined ||
        typeof entry["failureCode"] === "string") &&
      (entry["signingMode"] === undefined ||
        typeof entry["signingMode"] === "string")
    );
  }) && value["failures"].every((entry) => {
    return (
      isRecord(entry) &&
      typeof entry["code"] === "string" &&
      typeof entry["reference"] === "string" &&
      typeof entry["message"] === "string"
    );
  });
};

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

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

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

export async function fetchEvidenceVerifyStatus(
  jobId: string,
  bearerToken: string,
): Promise<FetchOutcome<EvidenceVerifyResponse>> {
  const response = await fetchJson<EvidenceVerifyResponse>({
    url: `${WORKSPACE_ROOT}/jobs/${encodeURIComponent(jobId)}/evidence/verify`,
    init: {
      headers: {
        authorization: `Bearer ${bearerToken}`,
      },
    },
  });
  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Failed to verify evidence artifacts.",
    );
  }
  if (!isEvidenceVerifyResponse(response.payload)) {
    return invalidResponse(response.status, "the evidence verification response");
  }
  return { ok: true, value: response.payload };
}

export async function fetchTestIntelligenceSources(
  jobId: string,
): Promise<FetchOutcome<FetchSourcesResponse>> {
  const response = await fetchJson<FetchSourcesResponse>({
    url: `${ROOT}/jobs/${encodeURIComponent(jobId)}/sources`,
  });
  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Failed to load multi-source references.",
    );
  }
  if (!isFetchSourcesResponse(response.payload)) {
    return invalidResponse(response.status, "the multi-source list");
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

export async function postConflictResolution(
  input: ResolveConflictInput & { bearerToken: string },
): Promise<FetchOutcome<ResolveConflictResponse>> {
  const response = await fetchJson<ResolveConflictResponse>({
    url: `${ROOT}/jobs/${encodeURIComponent(input.jobId)}/conflicts/${encodeURIComponent(input.conflictId)}/resolve`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.bearerToken}`,
      },
      body: JSON.stringify({
        action: input.action,
        ...(input.selectedSourceId !== undefined
          ? { selectedSourceId: input.selectedSourceId }
          : {}),
        ...(input.selectedNormalizedValue !== undefined
          ? { selectedNormalizedValue: input.selectedNormalizedValue }
          : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      }),
    },
  });
  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Conflict resolution was rejected by the server.",
    );
  }
  if (!isResolveConflictResponse(response.payload)) {
    return invalidResponse(response.status, "the conflict resolution response");
  }
  return { ok: true, value: response.payload };
}

export async function postJiraPasteSource(input: {
  jobId: string;
  bearerToken: string;
  format: "auto" | "adf_json" | "plain_text" | "markdown";
  body: string;
}): Promise<FetchOutcome<{ ok: true }>> {
  const response = await fetchJson<{ ok: true }>({
    url: `${ROOT}/sources/${encodeURIComponent(input.jobId)}/jira-paste`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.bearerToken}`,
      },
      body: JSON.stringify({ format: input.format, body: input.body }),
    },
  });
  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Jira paste source ingestion failed.",
    );
  }
  if (!isRecord(response.payload) || response.payload["ok"] !== true) {
    return invalidResponse(response.status, "the Jira paste response");
  }
  return { ok: true, value: { ok: true } };
}

export async function postWorkspaceSubmit(input: {
  figmaJsonPayload: string;
  sourceMode?: "figma_paste" | "figma_plugin" | "figma_url";
}): Promise<FetchOutcome<{ jobId: string }>> {
  const response = await fetchJson<{ jobId: string }>({
    url: `${WORKSPACE_ROOT}/submit`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        figmaSourceMode: input.sourceMode ?? "figma_paste",
        figmaJsonPayload: input.figmaJsonPayload,
        jobType: "figma_to_qc_test_cases",
        testIntelligenceMode: "dry_run",
        enableGitPr: false,
        llmCodegenMode: "deterministic",
      }),
    },
  });
  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Workspace submit failed.",
    );
  }
  if (
    !isRecord(response.payload) ||
    !isNonEmptyString(response.payload["jobId"])
  ) {
    return invalidResponse(response.status, "the workspace submit response");
  }
  return { ok: true, value: { jobId: response.payload["jobId"] } };
}

export async function postJiraFetchSource(input: {
  jobId: string;
  bearerToken: string;
  query:
    | { kind: "issueKeys"; issueKeys: string[] }
    | { kind: "jql"; jql: string; maxResults?: number };
}): Promise<FetchOutcome<{ ok: true }>> {
  const requestBody =
    input.query.kind === "jql"
      ? {
          jql: input.query.jql,
          ...(input.query.maxResults !== undefined
            ? { maxResults: input.query.maxResults }
            : {}),
        }
      : { issueKeys: input.query.issueKeys };
  const response = await fetchJson<{ ok: true }>({
    url: `${ROOT}/jobs/${encodeURIComponent(input.jobId)}/sources/jira-fetch`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.bearerToken}`,
      },
      body: JSON.stringify(requestBody),
    },
  });
  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Jira REST source ingestion failed.",
    );
  }
  if (!isRecord(response.payload) || response.payload["ok"] !== true) {
    return invalidResponse(response.status, "the Jira REST response");
  }
  return { ok: true, value: { ok: true } };
}

export async function postCustomContextSource(input: {
  jobId: string;
  bearerToken: string;
  markdown?: string;
  attributes?: Array<{ key: string; value: string }>;
}): Promise<
  FetchOutcome<{
    ok: true;
    canonicalMarkdown?: string;
    redactionCount: number;
  }>
> {
  const response = await fetchJson<unknown>({
    url: `${ROOT}/sources/${encodeURIComponent(input.jobId)}/custom-context`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.bearerToken}`,
      },
      body: JSON.stringify({
        ...(input.markdown !== undefined ? { markdown: input.markdown } : {}),
        ...(input.attributes !== undefined
          ? { attributes: input.attributes }
          : {}),
      }),
    },
  });
  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Custom context source ingestion failed.",
    );
  }
  if (!isRecord(response.payload) || response.payload["ok"] !== true) {
    return invalidResponse(response.status, "the custom context response");
  }
  const customContext = Array.isArray(response.payload["customContext"])
    ? response.payload["customContext"]
    : [];
  let canonicalMarkdown: string | undefined;
  let redactionCount = 0;
  for (const source of customContext) {
    if (!isRecord(source) || !Array.isArray(source["noteEntries"])) continue;
    for (const entry of source["noteEntries"]) {
      if (!isRecord(entry)) continue;
      if (typeof entry["bodyMarkdown"] === "string") {
        canonicalMarkdown = entry["bodyMarkdown"];
      }
      if (Array.isArray(entry["redactions"])) {
        redactionCount += entry["redactions"].length;
      }
    }
  }
  return {
    ok: true,
    value: {
      ok: true,
      ...(canonicalMarkdown !== undefined ? { canonicalMarkdown } : {}),
      redactionCount,
    },
  };
}

export interface JiraWriteStartInput {
  jobId: string;
  parentIssueKey: string;
  dryRun: boolean;
  outputPathMarkdown?: string;
  useDefaultOutputPath?: boolean;
}

export interface JiraSubTaskOutcome {
  testCaseId: string;
  externalId: string;
  outcome: "created" | "skipped_duplicate" | "failed" | "dry_run";
  jiraIssueKey?: string;
  failureClass?: string;
  retryable?: boolean;
  failureDetail?: string;
}

export interface JiraWriteStartResult {
  ok: boolean;
  refused: boolean;
  refusalCodes?: string[];
  totalCases: number;
  createdCount: number;
  skippedDuplicateCount: number;
  failedCount: number;
  dryRun: boolean;
  dryRunCount?: number;
  markdownOutputPath?: string;
  subtaskOutcomes?: JiraSubTaskOutcome[];
}

const JIRA_SUBTASK_OUTCOMES = new Set([
  "created",
  "skipped_duplicate",
  "failed",
  "dry_run",
]);

const isJiraSubTaskOutcome = (value: unknown): value is JiraSubTaskOutcome =>
  isRecord(value) &&
  typeof value["testCaseId"] === "string" &&
  typeof value["externalId"] === "string" &&
  typeof value["outcome"] === "string" &&
  JIRA_SUBTASK_OUTCOMES.has(value["outcome"]) &&
  (value["jiraIssueKey"] === undefined ||
    typeof value["jiraIssueKey"] === "string") &&
  (value["failureClass"] === undefined ||
    typeof value["failureClass"] === "string") &&
  (value["retryable"] === undefined ||
    typeof value["retryable"] === "boolean") &&
  (value["failureDetail"] === undefined ||
    typeof value["failureDetail"] === "string");

export interface JiraWriteConfig {
  outputPathMarkdown?: string;
  useDefaultOutputPath?: boolean;
}

const isJiraWriteStartResult = (
  value: unknown,
): value is JiraWriteStartResult =>
  isRecord(value) &&
  typeof value["ok"] === "boolean" &&
  typeof value["refused"] === "boolean" &&
  typeof value["totalCases"] === "number" &&
  typeof value["createdCount"] === "number" &&
  typeof value["skippedDuplicateCount"] === "number" &&
  typeof value["failedCount"] === "number" &&
  typeof value["dryRun"] === "boolean" &&
  (value["markdownOutputPath"] === undefined ||
    typeof value["markdownOutputPath"] === "string") &&
  (value["subtaskOutcomes"] === undefined ||
    (Array.isArray(value["subtaskOutcomes"]) &&
      value["subtaskOutcomes"].every(isJiraSubTaskOutcome)));

export async function startJiraWrite(
  input: JiraWriteStartInput,
  bearerToken: string,
): Promise<FetchOutcome<JiraWriteStartResult>> {
  const requestBody: Record<string, unknown> = {
    parentIssueKey: input.parentIssueKey,
    dryRun: input.dryRun,
  };
  if (input.outputPathMarkdown !== undefined) {
    requestBody["outputPathMarkdown"] = input.outputPathMarkdown;
  }
  if (input.useDefaultOutputPath !== undefined) {
    requestBody["useDefaultOutputPath"] = input.useDefaultOutputPath;
  }
  const response = await fetchJson<JiraWriteStartResult>({
    url: `${ROOT}/write/${encodeURIComponent(input.jobId)}/jira-subtasks`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify(requestBody),
    },
  });
  if (!response.ok) {
    if (isJiraWriteStartResult(response.payload)) {
      return { ok: true, value: response.payload };
    }
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Jira sub-task write request was rejected.",
    );
  }
  if (!isJiraWriteStartResult(response.payload)) {
    return invalidResponse(response.status, "the Jira write response");
  }
  return { ok: true, value: response.payload };
}

export async function getJiraWriteConfig(): Promise<
  FetchOutcome<JiraWriteConfig>
> {
  const response = await fetchJson<{ ok: true; config: JiraWriteConfig }>({
    url: `${ROOT}/write/config`,
  });
  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Failed to load Jira write config.",
    );
  }
  if (
    !isRecord(response.payload) ||
    response.payload["ok"] !== true ||
    !isRecord(response.payload["config"])
  ) {
    return invalidResponse(response.status, "the Jira write config");
  }
  const raw = response.payload["config"] as Record<string, unknown>;
  const config: JiraWriteConfig = {};
  if (typeof raw["outputPathMarkdown"] === "string") {
    config.outputPathMarkdown = raw["outputPathMarkdown"];
  }
  if (typeof raw["useDefaultOutputPath"] === "boolean") {
    config.useDefaultOutputPath = raw["useDefaultOutputPath"];
  }
  return { ok: true, value: config };
}

export async function saveJiraWriteConfig(
  config: JiraWriteConfig,
  bearerToken: string,
): Promise<FetchOutcome<{ ok: true }>> {
  const body: Record<string, unknown> = {};
  if (config.outputPathMarkdown !== undefined) {
    body["outputPathMarkdown"] = config.outputPathMarkdown;
  }
  if (config.useDefaultOutputPath !== undefined) {
    body["useDefaultOutputPath"] = config.useDefaultOutputPath;
  }
  const response = await fetchJson<{ ok: true }>({
    url: `${ROOT}/write/config`,
    init: {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify(body),
    },
  });
  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Failed to save Jira write config.",
    );
  }
  if (!isRecord(response.payload) || response.payload["ok"] !== true) {
    return invalidResponse(response.status, "the Jira write config save");
  }
  return { ok: true, value: { ok: true } };
}

export async function deleteInspectorSource(input: {
  jobId: string;
  sourceId: string;
  bearerToken: string;
}): Promise<FetchOutcome<{ ok: true }>> {
  const response = await fetchJson<{ ok: true }>({
    url: `${ROOT}/jobs/${encodeURIComponent(input.jobId)}/sources/${encodeURIComponent(input.sourceId)}`,
    init: {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.bearerToken}`,
      },
      body: "{}",
    },
  });
  if (!response.ok) {
    return errorOutcomeFromPayload(
      response.status,
      response.payload,
      "Source removal failed.",
    );
  }
  if (!isRecord(response.payload) || response.payload["ok"] !== true) {
    return invalidResponse(response.status, "the source removal response");
  }
  return { ok: true, value: { ok: true } };
}
