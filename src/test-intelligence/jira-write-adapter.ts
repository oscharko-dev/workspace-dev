/**
 * Jira sub-task write workflow (Issue #1482 — Wave 5).
 *
 * Wave 5 introduces an opt-in `jira_subtasks` write mode that takes a
 * set of approved test cases for a job and creates Jira sub-tasks under
 * a specified parent issue. The pipeline is fail-closed: every gate
 * must be satisfied before a single write leaves the process. Gates
 * are evaluated in deterministic order and EVERY violated gate is
 * recorded so an operator can address them all in one cycle:
 *
 *   1. Feature gate (`featureEnabled === true`).
 *   2. Admin/startup gate (`adminEnabled === true`).
 *   3. Bearer token configured + non-blank.
 *   4. `parentIssueKey` valid (`isValidJiraIssueKey`).
 *   5. At least one approved test case.
 *   6. No policy-blocked cases.
 *   7. No schema-invalid cases.
 *   8. Visual sidecar not blocked.
 *
 * After all gates pass:
 *
 *   - The injected `JiraWriteClient` is asked first to look up the
 *     existing sub-task by `externalId` (a SHA-256 of
 *     `(jobId, testCaseId, parentIssueKey)`). Lookup hits short-circuit
 *     to `skipped_duplicate`. Misses fall through to `createSubTask`.
 *   - Per-case failures are isolated: a transient outage on one case
 *     does NOT abort the rest. Failure detail strings are sanitised
 *     through the same `redactHighRiskSecrets` + URL-strip pattern used
 *     by the QC API transfer pipeline.
 *   - When `dryRun=true`, the client is never invoked and every case
 *     records `outcome="dry_run"`.
 *
 * Hard invariants (stamped at the type level on every artifact):
 *
 *   - `rawScreenshotsIncluded: false`
 *   - `credentialsIncluded: false`
 *
 * Air-gapped baseline:
 *
 *   - All inputs are validated before any side effect.
 *   - The pipeline never logs request/response bodies, URLs, or tokens.
 *   - Atomic writes use `${pid}.${randomUUID()}.tmp` so concurrent
 *     writes on the same artifact root cannot tear a JSON file.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  ALLOWED_JIRA_WRITE_FAILURE_CLASSES,
  ALLOWED_JIRA_WRITE_REFUSAL_CODES,
  JIRA_CREATED_SUBTASKS_ARTIFACT_FILENAME,
  JIRA_CREATED_SUBTASKS_SCHEMA_VERSION,
  JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY,
  JIRA_WRITE_REPORT_ARTIFACT_FILENAME,
  JIRA_WRITE_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type GeneratedTestCaseList,
  type JiraCreatedSubtasksArtifact,
  type JiraGatewayConfig,
  type JiraSubTaskRecord,
  type JiraWriteAuditMetadata,
  type JiraWriteFailureClass,
  type JiraWriteMode,
  type JiraWriteRefusalCode,
  type JiraWriteReportArtifact,
  type ReviewGateSnapshot,
  type ReviewSnapshot,
  type TestCasePolicyReport,
  type TestCaseValidationReport,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import { sanitizeErrorMessage } from "../error-sanitization.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";
import {
  buildJiraAuthHeaders,
  buildJiraRestUrl,
} from "./jira-capability-probe.js";
import { isValidJiraIssueKey, sanitizeJqlFragment } from "./jira-issue-ir.js";
import {
  writeJiraSubtaskMarkdownArtifacts,
  type JiraWriteMarkdownResult,
} from "./jira-write-markdown.js";

/* ------------------------------------------------------------------ */
/*  Constants                                                            */
/* ------------------------------------------------------------------ */

const MAX_FAILURE_DETAIL_LENGTH = 240;
const URL_DETAIL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi;
const MAX_SUMMARY_LENGTH = 240;
const MAX_DESCRIPTION_LENGTH = 8 * 1024;
const DEFAULT_PRINCIPAL_ID = "jira-write-principal:default";
const UNCONFIGURED_PRINCIPAL_ID = "jira-write-principal:unconfigured";
const NO_CLIENT_ERROR_DETAIL = "jira_write_client_unconfigured";
const REFUSAL_CODES: ReadonlySet<JiraWriteRefusalCode> = new Set(
  ALLOWED_JIRA_WRITE_REFUSAL_CODES,
);
const FAILURE_CLASSES: ReadonlySet<JiraWriteFailureClass> = new Set(
  ALLOWED_JIRA_WRITE_FAILURE_CLASSES,
);

/* ------------------------------------------------------------------ */
/*  Public client interfaces                                             */
/* ------------------------------------------------------------------ */

/**
 * Fields supplied to the Jira sub-task create call. Adapters MUST send
 * the `externalId` to Jira in a way that can be looked up later by
 * {@link JiraWriteClient.lookupSubtaskByExternalId} (the live HTTP
 * client uses a label of the form `ti-external-id:<externalId>`).
 */
export interface JiraSubTaskFields {
  summary: string;
  description: string;
  externalId: string;
  testCaseId: string;
  jobId: string;
}

/** Outcome of an idempotency lookup against the tenant. */
export type JiraSubTaskLookupResult =
  | { found: true; issueKey: string }
  | {
      found: false;
      errorClass?: JiraWriteFailureClass;
      detail?: string;
    };

/** Outcome of a single sub-task create call. */
export type JiraSubTaskCreateResult =
  | { ok: true; issueKey: string }
  | { ok: false; errorClass: JiraWriteFailureClass; detail: string };

/**
 * Provider-neutral Jira write client. The orchestrator never attempts
 * a network call without an explicit client. The phantom
 * `assertNoSecrets` literal-`true` field stops a caller from passing a
 * raw `JiraGatewayClient` here by accident — the contract is that the
 * client implementation has already arranged its credentials.
 */
export interface JiraWriteClient {
  readonly assertNoSecrets: true;
  lookupSubtaskByExternalId(input: {
    parentIssueKey: string;
    externalId: string;
  }): Promise<JiraSubTaskLookupResult> | JiraSubTaskLookupResult;
  createSubTask(input: {
    parentIssueKey: string;
    fields: JiraSubTaskFields;
  }): Promise<JiraSubTaskCreateResult> | JiraSubTaskCreateResult;
}

/* ------------------------------------------------------------------ */
/*  Unconfigured sentinel client                                          */
/* ------------------------------------------------------------------ */

/**
 * Stable sentinel client returned when no Jira write client has been
 * wired. Every method refuses with `provider_not_implemented`. Used by
 * inspector handlers and tests.
 */
export const createUnconfiguredJiraWriteClient = (): JiraWriteClient => ({
  assertNoSecrets: true,
  lookupSubtaskByExternalId: () => ({ found: false }) as const,
  createSubTask: () =>
    ({
      ok: false,
      errorClass: "provider_not_implemented",
      detail: NO_CLIENT_ERROR_DETAIL,
    }) as const,
});

/* ------------------------------------------------------------------ */
/*  Live HTTP client                                                     */
/* ------------------------------------------------------------------ */

export interface CreateJiraWriteClientInput {
  config: JiraGatewayConfig;
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
}

const labelForExternalId = (externalId: string): string =>
  `ti-external-id:${externalId}`;

const labelForJob = (jobId: string): string => `ti-job:${jobId}`;

const classifyHttpStatus = (status: number): JiraWriteFailureClass => {
  if (status === 401) return "auth_failed";
  if (status === 403) return "permission_denied";
  if (status === 400 || status === 422) return "validation_rejected";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "unknown";
};

const isRetryableFailureClass = (
  failureClass: JiraWriteFailureClass,
): boolean =>
  failureClass === "transport_error" ||
  failureClass === "rate_limited" ||
  failureClass === "server_error";

const isRetryableHttpStatus = (status: number): boolean =>
  status === 429 || status >= 500;

const resolveMaxRetries = (config: JiraGatewayConfig): number => {
  const raw = config.maxRetries ?? 3;
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.trunc(raw));
};

const DEFAULT_RETRY_DELAYS_MS = [250, 750, 1_500] as const;

const delayForAttempt = (
  response: Response | undefined,
  retryIndex: number,
): number => {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter !== undefined && retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, 30_000);
    }
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(Math.max(0, retryAt - Date.now()), 30_000);
    }
  }
  const fallback = 1_500;
  return (
    DEFAULT_RETRY_DELAYS_MS[
      Math.min(retryIndex, DEFAULT_RETRY_DELAYS_MS.length - 1)
    ] ?? fallback
  );
};

const sanitizeFailureDetail = (raw: unknown): string => {
  const text =
    typeof raw === "string"
      ? raw
      : raw instanceof Error
        ? sanitizeErrorMessage({ error: raw, fallback: "transport_error" })
        : "transport_error";
  const cleaned = redactHighRiskSecrets(text, "[redacted-secret]")
    .replace(URL_DETAIL_PATTERN, "[redacted-url]")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return "transport_error";
  if (cleaned.length <= MAX_FAILURE_DETAIL_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_FAILURE_DETAIL_LENGTH)}...`;
};

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
};

const buildAdfDescription = (description: string): unknown => ({
  type: "doc",
  version: 1,
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: description }],
    },
  ],
});

/**
 * Live HTTP Jira write client. POSTs to `/rest/api/3/issue` for create
 * and queries `/rest/api/3/search` for lookup. Never logs request /
 * response bodies, URLs, or auth headers. Uses native `fetch` and
 * native `crypto` only — zero new runtime deps.
 */
export const createJiraWriteClient = (
  input: CreateJiraWriteClientInput,
): JiraWriteClient => {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep =
    input.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const maxRetries = resolveMaxRetries(input.config);
  const headers = buildJiraAuthHeaders(input.config);
  const sendHeaders: Record<string, string> = {
    ...headers,
    "Content-Type": "application/json",
  };

  const sendJiraRequest = async (
    url: string,
    init: RequestInit,
    options: { retry: boolean },
  ): Promise<
    | { ok: true; response: Response }
    | { ok: false; errorClass: JiraWriteFailureClass; detail: string }
  > => {
    const maxAttempts = options.retry ? maxRetries + 1 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(url, init);
      } catch (error) {
        if (attempt < maxAttempts) {
          await sleep(delayForAttempt(undefined, attempt - 1));
          continue;
        }
        return {
          ok: false,
          errorClass: "transport_error",
          detail: sanitizeFailureDetail(error),
        };
      }
      if (response.ok) return { ok: true, response };
      if (isRetryableHttpStatus(response.status) && attempt < maxAttempts) {
        await sleep(delayForAttempt(response, attempt - 1));
        continue;
      }
      return {
        ok: false,
        errorClass: classifyHttpStatus(response.status),
        detail: `jira_status_${response.status}`,
      };
    }
    return {
      ok: false,
      errorClass: "transport_error",
      detail: "jira_retry_exhausted",
    };
  };

  const lookupSubtaskByExternalId = async (params: {
    parentIssueKey: string;
    externalId: string;
  }): Promise<JiraSubTaskLookupResult> => {
    if (!isValidJiraIssueKey(params.parentIssueKey)) {
      return { found: false };
    }
    const sanitizedParent = sanitizeJqlFragment(params.parentIssueKey);
    if (!sanitizedParent.ok) {
      return { found: false };
    }
    const sanitizedLabel = sanitizeJqlFragment(
      labelForExternalId(params.externalId),
    );
    if (!sanitizedLabel.ok) {
      return { found: false };
    }
    const jql = `parent=${sanitizedParent.sanitized} AND labels="${sanitizedLabel.sanitized}"`;
    const url = `${buildJiraRestUrl(input.config.baseUrl, "3", "search")}?jql=${encodeURIComponent(jql)}&maxResults=1&fields=key`;
    const result = await sendJiraRequest(
      url,
      {
        method: "GET",
        headers: sendHeaders,
        redirect: "error",
      },
      {
        retry: true,
      },
    );
    if (!result.ok) {
      return {
        found: false,
        errorClass: result.errorClass,
        detail: result.detail,
      };
    }
    let body: unknown;
    try {
      body = await result.response.json();
    } catch {
      return {
        found: false,
        errorClass: "validation_rejected",
        detail: "invalid_lookup_response",
      };
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !Array.isArray((body as { issues?: unknown }).issues)
    ) {
      return {
        found: false,
        errorClass: "validation_rejected",
        detail: "invalid_lookup_response",
      };
    }
    const issues = (body as { issues: unknown[] }).issues;
    if (issues.length === 0) return { found: false };
    const first = issues[0];
    if (
      typeof first !== "object" ||
      first === null ||
      typeof (first as { key?: unknown }).key !== "string"
    ) {
      return {
        found: false,
        errorClass: "validation_rejected",
        detail: "invalid_lookup_issue_key",
      };
    }
    const issueKey = (first as { key: string }).key;
    if (!isValidJiraIssueKey(issueKey)) {
      return {
        found: false,
        errorClass: "validation_rejected",
        detail: "invalid_lookup_issue_key",
      };
    }
    return { found: true, issueKey };
  };

  const createSubTask = async (params: {
    parentIssueKey: string;
    fields: JiraSubTaskFields;
  }): Promise<JiraSubTaskCreateResult> => {
    if (!isValidJiraIssueKey(params.parentIssueKey)) {
      return {
        ok: false,
        errorClass: "validation_rejected",
        detail: "invalid_parent_issue_key",
      };
    }
    const url = buildJiraRestUrl(input.config.baseUrl, "3", "issue");
    const requestBody = {
      fields: {
        summary: truncate(params.fields.summary, MAX_SUMMARY_LENGTH),
        description: buildAdfDescription(
          truncate(params.fields.description, MAX_DESCRIPTION_LENGTH),
        ),
        issuetype: { name: "Sub-task" },
        parent: { key: params.parentIssueKey },
        labels: [
          labelForExternalId(params.fields.externalId),
          labelForJob(params.fields.jobId),
        ],
      },
    };
    const result = await sendJiraRequest(
      url,
      {
        method: "POST",
        headers: sendHeaders,
        body: JSON.stringify(requestBody),
        redirect: "error",
      },
      {
        retry: false,
      },
    );
    if (!result.ok) {
      return {
        ok: false,
        errorClass: result.errorClass,
        detail: result.detail,
      };
    }
    let body: unknown;
    try {
      body = await result.response.json();
    } catch (error) {
      return {
        ok: false,
        errorClass: "validation_rejected",
        detail: sanitizeFailureDetail(error),
      };
    }
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as { key?: unknown }).key !== "string"
    ) {
      return {
        ok: false,
        errorClass: "validation_rejected",
        detail: "missing_issue_key_in_response",
      };
    }
    const issueKey = (body as { key: string }).key;
    if (!isValidJiraIssueKey(issueKey)) {
      return {
        ok: false,
        errorClass: "validation_rejected",
        detail: "invalid_issue_key_in_response",
      };
    }
    return { ok: true, issueKey };
  };

  return {
    assertNoSecrets: true,
    lookupSubtaskByExternalId,
    createSubTask,
  };
};

/* ------------------------------------------------------------------ */
/*  Orchestrator input + result                                          */
/* ------------------------------------------------------------------ */

/** Stable wall-clock source so tests can produce byte-identical artifacts. */
export interface JiraWriteClock {
  now(): string;
}

export interface RunJiraSubtaskWriteInput {
  jobId: string;
  parentIssueKey: string;
  mode: JiraWriteMode;
  dryRun: boolean;
  /** User-configured markdown output directory. Optional. */
  outputPathMarkdown?: string;
  /** When `true`, fall back to `<runDir>/jira-write` for markdown. */
  useDefaultOutputPath?: boolean;
  approvedTestCases: GeneratedTestCaseList;
  policyReport: TestCasePolicyReport;
  validationReport: TestCaseValidationReport;
  visualSidecarValidation?: VisualSidecarValidationReport;
  reviewGateSnapshot: ReviewGateSnapshot;
  /** Artifact root for this job. JSON reports + markdown artifacts live below. */
  runDir: string;
  bearerToken?: string;
  featureEnabled: boolean;
  adminEnabled: boolean;
  clock?: JiraWriteClock;
  /** Optional opaque actor handle persisted in audit metadata. */
  actor?: string;
}

export interface RunJiraSubtaskWriteResult {
  refusalCodes: JiraWriteRefusalCode[];
  refused: boolean;
  dryRun: boolean;
  subtaskOutcomes: JiraSubTaskRecord[];
  totalCases: number;
  createdCount: number;
  skippedDuplicateCount: number;
  failedCount: number;
  dryRunCount: number;
  reportArtifactPath: string;
  createdSubtasksArtifactPath: string;
  markdownOutputPath: string;
  markdownArtifacts?: JiraWriteMarkdownResult;
  rawScreenshotsIncluded: false;
  credentialsIncluded: false;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                              */
/* ------------------------------------------------------------------ */

const sortedUnique = <T extends string>(values: Iterable<T>): T[] =>
  Array.from(new Set(values)).sort();

const refusalSummary = (
  codes: Iterable<JiraWriteRefusalCode>,
): JiraWriteRefusalCode[] =>
  sortedUnique(
    Array.from(codes).filter((c): c is JiraWriteRefusalCode =>
      REFUSAL_CODES.has(c),
    ),
  );

const writeAtomicJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
};

const stringHashSha256Hex = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

/**
 * Stable idempotency key. The composition pattern uses `|` separators
 * so that none of the three identifiers can shape the digest by being
 * a prefix/suffix of another (Jira issue keys are uppercase letters +
 * digits + dashes, so `|` is unambiguous).
 */
export const computeJiraSubtaskExternalId = (input: {
  jobId: string;
  testCaseId: string;
  parentIssueKey: string;
}): string =>
  stringHashSha256Hex(
    `${input.jobId}|${input.testCaseId}|${input.parentIssueKey}`,
  );

const buildSnapshotIndex = (
  snapshot: ReviewGateSnapshot,
): Map<string, ReviewSnapshot> => {
  const map = new Map<string, ReviewSnapshot>();
  for (const entry of snapshot.perTestCase) {
    map.set(entry.testCaseId, entry);
  }
  return map;
};

const APPROVED_STATES = new Set(["approved", "exported", "transferred"]);

const isApprovedTestCase = (snapshot: ReviewSnapshot | undefined): boolean => {
  if (snapshot === undefined) return false;
  if (snapshot.policyDecision === "blocked") return false;
  return APPROVED_STATES.has(snapshot.state);
};

const buildSubtaskFields = (
  testCase: GeneratedTestCaseList["testCases"][number],
  externalId: string,
  jobId: string,
): JiraSubTaskFields => {
  const stepLines = testCase.steps.map(
    (step, idx) =>
      `${idx + 1}. ${step.action}${step.expected ? ` => ${step.expected}` : ""}`,
  );
  const expectedLines = testCase.expectedResults.map(
    (line, idx) => `${idx + 1}. ${line}`,
  );
  const sections: string[] = [
    `Test Case: ${testCase.id}`,
    `Title: ${testCase.title}`,
    `Objective: ${testCase.objective}`,
  ];
  if (testCase.preconditions.length > 0) {
    sections.push(`Preconditions:\n${testCase.preconditions.join("\n")}`);
  }
  if (stepLines.length > 0) {
    sections.push(`Steps:\n${stepLines.join("\n")}`);
  }
  if (expectedLines.length > 0) {
    sections.push(`Expected Results:\n${expectedLines.join("\n")}`);
  }
  return {
    summary: `[${testCase.id}] ${testCase.title}`,
    description: sections.join("\n\n"),
    externalId,
    testCaseId: testCase.id,
    jobId,
  };
};

/* ------------------------------------------------------------------ */
/*  Gate evaluation                                                      */
/* ------------------------------------------------------------------ */

interface GateOutcome {
  refusalCodes: Set<JiraWriteRefusalCode>;
  bearerConfigured: boolean;
}

const collectGateRefusals = (input: RunJiraSubtaskWriteInput): GateOutcome => {
  const refusalCodes = new Set<JiraWriteRefusalCode>();

  if (!input.featureEnabled) refusalCodes.add("feature_gate_disabled");
  if (!input.adminEnabled) refusalCodes.add("admin_gate_disabled");

  const trimmedToken =
    typeof input.bearerToken === "string" ? input.bearerToken.trim() : "";
  const bearerConfigured = trimmedToken.length > 0;
  if (!bearerConfigured) refusalCodes.add("bearer_token_missing");

  if (!isValidJiraIssueKey(input.parentIssueKey)) {
    refusalCodes.add("invalid_parent_issue_key");
  }

  const snapshotIndex = buildSnapshotIndex(input.reviewGateSnapshot);
  let approvedCount = 0;
  for (const testCase of input.approvedTestCases.testCases) {
    const snapshot = snapshotIndex.get(testCase.id);
    if (isApprovedTestCase(snapshot)) approvedCount += 1;
  }
  if (approvedCount === 0) refusalCodes.add("no_approved_test_cases");

  if (input.policyReport.blocked || input.policyReport.blockedCount > 0) {
    refusalCodes.add("policy_blocked_cases_present");
  } else {
    for (const decision of input.policyReport.decisions) {
      if (decision.decision === "blocked") {
        refusalCodes.add("policy_blocked_cases_present");
        break;
      }
    }
  }

  if (input.validationReport.blocked || input.validationReport.errorCount > 0) {
    refusalCodes.add("schema_invalid_cases_present");
  }

  if (input.visualSidecarValidation && input.visualSidecarValidation.blocked) {
    refusalCodes.add("visual_sidecar_blocked");
  }

  return { refusalCodes, bearerConfigured };
};

/* ------------------------------------------------------------------ */
/*  Artifact builders                                                    */
/* ------------------------------------------------------------------ */

const buildAuditMetadata = (input: {
  bearerConfigured: boolean;
  adminEnabled: boolean;
  dryRun: boolean;
  mode: JiraWriteMode;
  actor: string | undefined;
}): JiraWriteAuditMetadata => ({
  principalId:
    input.actor && input.actor.length > 0
      ? input.actor
      : input.bearerConfigured
        ? DEFAULT_PRINCIPAL_ID
        : UNCONFIGURED_PRINCIPAL_ID,
  bearerConfigured: input.bearerConfigured,
  adminEnabled: input.adminEnabled,
  dryRun: input.dryRun,
  mode: input.mode,
});

const buildReport = (input: {
  jobId: string;
  parentIssueKey: string;
  generatedAt: string;
  refused: boolean;
  refusalCodes: JiraWriteRefusalCode[];
  totalCases: number;
  createdCount: number;
  skippedDuplicateCount: number;
  failedCount: number;
  dryRunCount: number;
  audit: JiraWriteAuditMetadata;
}): JiraWriteReportArtifact => ({
  schemaVersion: JIRA_WRITE_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: input.jobId,
  parentIssueKey: input.parentIssueKey,
  generatedAt: input.generatedAt,
  refused: input.refused,
  refusalCodes: input.refusalCodes,
  totalCases: input.totalCases,
  createdCount: input.createdCount,
  skippedDuplicateCount: input.skippedDuplicateCount,
  failedCount: input.failedCount,
  dryRunCount: input.dryRunCount,
  audit: input.audit,
  rawScreenshotsIncluded: false,
  credentialsIncluded: false,
});

const buildCreatedArtifact = (input: {
  jobId: string;
  parentIssueKey: string;
  generatedAt: string;
  subtasks: JiraSubTaskRecord[];
}): JiraCreatedSubtasksArtifact => ({
  schemaVersion: JIRA_CREATED_SUBTASKS_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: input.jobId,
  parentIssueKey: input.parentIssueKey,
  generatedAt: input.generatedAt,
  subtasks: input.subtasks,
  rawScreenshotsIncluded: false,
  credentialsIncluded: false,
});

const sanitizeFailureClass = (
  candidate: JiraWriteFailureClass,
): JiraWriteFailureClass =>
  FAILURE_CLASSES.has(candidate) ? candidate : "unknown";

const buildRecordCreated = (
  testCaseId: string,
  externalId: string,
  issueKey: string,
): JiraSubTaskRecord => ({
  testCaseId,
  externalId,
  outcome: "created",
  jiraIssueKey: issueKey,
});

const buildRecordSkipped = (
  testCaseId: string,
  externalId: string,
  issueKey: string,
): JiraSubTaskRecord => ({
  testCaseId,
  externalId,
  outcome: "skipped_duplicate",
  jiraIssueKey: issueKey,
});

const buildRecordFailed = (
  testCaseId: string,
  externalId: string,
  errorClass: JiraWriteFailureClass,
  detail: string,
): JiraSubTaskRecord => {
  const failureClass = sanitizeFailureClass(errorClass);
  return {
    testCaseId,
    externalId,
    outcome: "failed",
    failureClass,
    retryable: isRetryableFailureClass(failureClass),
    failureDetail: sanitizeFailureDetail(detail),
  };
};

const buildRecordDryRun = (
  testCaseId: string,
  externalId: string,
): JiraSubTaskRecord => ({
  testCaseId,
  externalId,
  outcome: "dry_run",
});

/* ------------------------------------------------------------------ */
/*  Per-case attempt                                                     */
/* ------------------------------------------------------------------ */

const attemptWrite = async (
  client: JiraWriteClient,
  parentIssueKey: string,
  externalId: string,
  testCase: GeneratedTestCaseList["testCases"][number],
  jobId: string,
): Promise<JiraSubTaskRecord> => {
  let lookup: JiraSubTaskLookupResult;
  try {
    const out = client.lookupSubtaskByExternalId({
      parentIssueKey,
      externalId,
    });
    lookup = out instanceof Promise ? await out : out;
  } catch (error) {
    return buildRecordFailed(
      testCase.id,
      externalId,
      "transport_error",
      error instanceof Error ? error.message : "lookup_failed",
    );
  }
  if (lookup.found) {
    return buildRecordSkipped(testCase.id, externalId, lookup.issueKey);
  }
  if (lookup.errorClass !== undefined) {
    return buildRecordFailed(
      testCase.id,
      externalId,
      lookup.errorClass,
      lookup.detail ?? "lookup_failed",
    );
  }
  const fields = buildSubtaskFields(testCase, externalId, jobId);
  let createResult: JiraSubTaskCreateResult;
  try {
    const out = client.createSubTask({ parentIssueKey, fields });
    createResult = out instanceof Promise ? await out : out;
  } catch (error) {
    return buildRecordFailed(
      testCase.id,
      externalId,
      "transport_error",
      error instanceof Error ? error.message : "create_failed",
    );
  }
  if (!createResult.ok) {
    return buildRecordFailed(
      testCase.id,
      externalId,
      createResult.errorClass,
      createResult.detail,
    );
  }
  return buildRecordCreated(testCase.id, externalId, createResult.issueKey);
};

/* ------------------------------------------------------------------ */
/*  Orchestrator                                                         */
/* ------------------------------------------------------------------ */

const resolveMarkdownOutputDir = (input: RunJiraSubtaskWriteInput): string => {
  const trimmed =
    typeof input.outputPathMarkdown === "string"
      ? input.outputPathMarkdown.trim()
      : "";
  if (input.useDefaultOutputPath || trimmed.length === 0) {
    return join(input.runDir, JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY);
  }
  return trimmed;
};

const sortByTestCaseId = <T extends { id: string }>(items: T[]): T[] =>
  items.slice().sort((a, b) => a.id.localeCompare(b.id));

const sortRecordsByTestCaseId = (
  records: JiraSubTaskRecord[],
): JiraSubTaskRecord[] =>
  records.slice().sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));

/**
 * Run the Jira sub-task write pipeline. Fail-closed across eight gates;
 * idempotent per-case via SHA-256 externalId; per-case failure isolated.
 */
export const runJiraSubtaskWrite = async (
  input: RunJiraSubtaskWriteInput,
  client: JiraWriteClient,
): Promise<RunJiraSubtaskWriteResult> => {
  const generatedAt = (
    input.clock ?? { now: () => new Date().toISOString() }
  ).now();
  const reportDir = join(input.runDir, JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY);
  const reportPath = join(reportDir, JIRA_WRITE_REPORT_ARTIFACT_FILENAME);
  const createdPath = join(reportDir, JIRA_CREATED_SUBTASKS_ARTIFACT_FILENAME);
  const markdownDir = resolveMarkdownOutputDir(input);

  const gate = collectGateRefusals(input);
  const audit = buildAuditMetadata({
    bearerConfigured: gate.bearerConfigured,
    adminEnabled: input.adminEnabled,
    dryRun: input.dryRun,
    mode: input.mode,
    actor: input.actor,
  });

  if (gate.refusalCodes.size > 0) {
    const refusalCodes = refusalSummary(gate.refusalCodes);
    const report = buildReport({
      jobId: input.jobId,
      parentIssueKey: input.parentIssueKey,
      generatedAt,
      refused: true,
      refusalCodes,
      totalCases: input.approvedTestCases.testCases.length,
      createdCount: 0,
      skippedDuplicateCount: 0,
      failedCount: 0,
      dryRunCount: 0,
      audit,
    });
    const created = buildCreatedArtifact({
      jobId: input.jobId,
      parentIssueKey: input.parentIssueKey,
      generatedAt,
      subtasks: [],
    });
    await writeAtomicJson(reportPath, report);
    await writeAtomicJson(createdPath, created);
    const markdownArtifacts = await writeJiraSubtaskMarkdownArtifacts({
      jobId: input.jobId,
      parentIssueKey: input.parentIssueKey,
      subtaskOutcomes: [],
      dryRun: input.dryRun,
      outputDir: markdownDir,
      testCases: [],
      refusalCodes,
      ...(input.clock ? { clock: input.clock } : {}),
    });
    return {
      refusalCodes,
      refused: true,
      dryRun: input.dryRun,
      subtaskOutcomes: [],
      totalCases: input.approvedTestCases.testCases.length,
      createdCount: 0,
      skippedDuplicateCount: 0,
      failedCount: 0,
      dryRunCount: 0,
      reportArtifactPath: reportPath,
      createdSubtasksArtifactPath: createdPath,
      markdownOutputPath: markdownDir,
      markdownArtifacts,
      rawScreenshotsIncluded: false,
      credentialsIncluded: false,
    };
  }

  const snapshotIndex = buildSnapshotIndex(input.reviewGateSnapshot);
  const sortedCases = sortByTestCaseId(
    input.approvedTestCases.testCases,
  ).filter((testCase) => isApprovedTestCase(snapshotIndex.get(testCase.id)));

  const records: JiraSubTaskRecord[] = [];
  for (const testCase of sortedCases) {
    const externalId = computeJiraSubtaskExternalId({
      jobId: input.jobId,
      testCaseId: testCase.id,
      parentIssueKey: input.parentIssueKey,
    });
    if (input.dryRun) {
      records.push(buildRecordDryRun(testCase.id, externalId));
      continue;
    }
    const record = await attemptWrite(
      client,
      input.parentIssueKey,
      externalId,
      testCase,
      input.jobId,
    );
    records.push(record);
  }

  const sortedRecords = sortRecordsByTestCaseId(records);
  const createdCount = sortedRecords.filter(
    (r) => r.outcome === "created",
  ).length;
  const skippedDuplicateCount = sortedRecords.filter(
    (r) => r.outcome === "skipped_duplicate",
  ).length;
  const failedCount = sortedRecords.filter(
    (r) => r.outcome === "failed",
  ).length;
  const dryRunCount = sortedRecords.filter(
    (r) => r.outcome === "dry_run",
  ).length;
  const totalCases = input.approvedTestCases.testCases.length;

  const report = buildReport({
    jobId: input.jobId,
    parentIssueKey: input.parentIssueKey,
    generatedAt,
    refused: false,
    refusalCodes: [],
    totalCases,
    createdCount,
    skippedDuplicateCount,
    failedCount,
    dryRunCount,
    audit,
  });
  const created = buildCreatedArtifact({
    jobId: input.jobId,
    parentIssueKey: input.parentIssueKey,
    generatedAt,
    subtasks: sortedRecords,
  });
  await writeAtomicJson(reportPath, report);
  await writeAtomicJson(createdPath, created);

  const markdownArtifacts = await writeJiraSubtaskMarkdownArtifacts({
    jobId: input.jobId,
    parentIssueKey: input.parentIssueKey,
    subtaskOutcomes: sortedRecords,
    dryRun: input.dryRun,
    outputDir: markdownDir,
    testCases: sortedCases,
    ...(input.clock ? { clock: input.clock } : {}),
  });

  return {
    refusalCodes: [],
    refused: false,
    dryRun: input.dryRun,
    subtaskOutcomes: sortedRecords,
    totalCases,
    createdCount,
    skippedDuplicateCount,
    failedCount,
    dryRunCount,
    reportArtifactPath: reportPath,
    createdSubtasksArtifactPath: createdPath,
    markdownOutputPath: markdownDir,
    markdownArtifacts,
    rawScreenshotsIncluded: false,
    credentialsIncluded: false,
  };
};

/** Stable error detail surfaced by the unconfigured client. */
export const NO_JIRA_WRITE_CLIENT_ERROR_DETAIL: string = NO_CLIENT_ERROR_DETAIL;
