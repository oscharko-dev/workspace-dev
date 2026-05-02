import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as net from "node:net";
import path from "node:path";

import {
  createLlmCircuitBreaker,
  type LlmCircuitBreaker,
  type LlmCircuitClock,
} from "./llm-circuit-breaker.js";
import {
  buildJiraAuthHeaders,
  buildJiraRestUrl,
  probeJiraCapability,
} from "./jira-capability-probe.js";
import {
  buildJiraIssueIr,
  sanitizeJqlFragment,
  writeJiraIssueIr,
  type BuildJiraIssueIrInput,
  type JiraAdfSource,
} from "./jira-issue-ir.js";
import { createHash } from "node:crypto";

import { canonicalJson } from "./content-hash.js";
import { sanitizeErrorMessage } from "../error-sanitization.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";
import { DEFAULT_JIRA_FIELD_SELECTION_PROFILE } from "../contracts/index.js";
import type {
  JiraCapabilityProbe,
  JiraFetchRequest,
  JiraFetchResult,
  JiraGatewayConfig,
  JiraGatewayDiagnostic,
  JiraIssueIr,
} from "../contracts/index.js";

export interface JiraGatewayUsageEvent {
  sourceId?: string;
  requestKind: JiraFetchRequest["query"]["kind"];
  attempts: number;
  cacheHit: boolean;
  responseBytes: number;
  responseHash: string;
  diagnosticCode?: string;
  rateLimitReason?: string;
}

export interface JiraGatewayRuntime {
  fetchImpl?: typeof fetch;
  clock?: LlmCircuitClock;
  sleep?: (ms: number) => Promise<void>;
  retryBackoffMs?: ReadonlyArray<number>;
  onUsageEvent?: (event: JiraGatewayUsageEvent) => void;
}

export interface JiraGatewayClient {
  readonly config: JiraGatewayConfig;
  getCircuitBreaker(): LlmCircuitBreaker;
  fetchIssues(request: JiraFetchRequest): Promise<JiraFetchResult>;
  probeCapability(): Promise<
    | { ok: true; capability: JiraCapabilityProbe }
    | { ok: false; code: string; message: string; retryable: boolean }
  >;
}

interface JiraApiCacheEntry {
  version: "1.0.0";
  capability: JiraCapabilityProbe;
  responseHash: string;
  responseBytes: number;
  issues: JiraIssueIr[];
}

interface AttemptResult extends JiraFetchResult {
  responseBytes: number;
  retryDelayMs?: number;
}

const DEFAULT_BACKOFF_MS: ReadonlyArray<number> = [100, 200, 400, 800, 1600];
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const JIRA_ISSUE_IR_LIST_ARTIFACT_FILENAME = "jira-issue-ir-list.json";
const SOURCE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/u;
const JIRA_ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]+-[1-9][0-9]*$/u;
const CUSTOM_FIELD_ID_RE = /^customfield_[0-9]{5,12}$/u;
const DETERMINISTIC_CAPTURED_AT = "1970-01-01T00:00:00.000Z";

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

const diagnostic = ({
  code,
  message,
  retryable,
  status,
  rateLimitReason,
}: {
  code: string;
  message: string;
  retryable: boolean;
  status?: number;
  rateLimitReason?: string;
}): JiraGatewayDiagnostic => {
  const redacted = redactHighRiskSecrets(message, "[redacted-secret]");
  return {
    code,
    message: redacted,
    retryable,
    ...(status !== undefined ? { status } : {}),
    ...(rateLimitReason !== undefined
      ? {
          rateLimitReason: redactHighRiskSecrets(
            rateLimitReason,
            "[redacted-secret]",
          ),
        }
      : {}),
  };
};

const isJiraGatewayDiagnostic = (
  value: Record<string, unknown> | JiraGatewayDiagnostic,
): value is JiraGatewayDiagnostic =>
  typeof (value as JiraGatewayDiagnostic).code === "string" &&
  typeof (value as JiraGatewayDiagnostic).message === "string" &&
  typeof (value as JiraGatewayDiagnostic).retryable === "boolean";

const sanitizeError = (err: unknown, fallback: string): string =>
  redactHighRiskSecrets(
    sanitizeErrorMessage({ error: err, fallback }),
    "[redacted-secret]",
  );

const isHostAllowed = (
  host: string,
  patterns: readonly string[] | undefined,
): boolean => {
  if (patterns === undefined || patterns.length === 0) return false;
  return patterns.some((pattern) => {
    const normalized = pattern.toLowerCase();
    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(1);
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === normalized;
  });
};

const isBlockedIpHost = (host: string): boolean => {
  const unbracketed = host.replace(/^\[/u, "").replace(/\]$/u, "");
  if (net.isIPv6(unbracketed)) return true;
  if (!net.isIPv4(unbracketed)) return false;

  const parts = unbracketed.split(".").map((part) => Number.parseInt(part, 10));
  const first = parts[0];
  const second = parts[1];
  if (first === undefined || second === undefined) return true;
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  return false;
};

const isSsrfSafeConfig = (config: JiraGatewayConfig): boolean => {
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username.length > 0 || url.password.length > 0) return false;

  const host = url.hostname.toLowerCase();
  if (host.includes("xn--")) return false;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return false;
  }
  if (isBlockedIpHost(host)) return false;

  if (config.auth.kind === "basic") {
    return host.endsWith(".atlassian.net");
  }
  if (config.auth.kind === "oauth2_3lo") {
    return (
      host === "api.atlassian.com" &&
      /^\/ex\/jira\/[^/]+\/?$/u.test(url.pathname)
    );
  }
  return isHostAllowed(host, config.allowedHostPatterns);
};

const validatePositiveSafeInteger = (
  value: number | undefined,
  name: string,
): JiraGatewayDiagnostic | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    return diagnostic({
      code: "jira_request_invalid",
      message: `${name} must be a positive safe integer`,
      retryable: false,
    });
  }
  return undefined;
};

const validateNonNegativeSafeInteger = (
  value: number | undefined,
  name: string,
): JiraGatewayDiagnostic | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    return diagnostic({
      code: "jira_request_invalid",
      message: `${name} must be a non-negative safe integer`,
      retryable: false,
    });
  }
  return undefined;
};

const validateAuth = (
  config: JiraGatewayConfig,
): JiraGatewayDiagnostic | undefined => {
  if (config.userAgent.trim().length === 0) {
    return diagnostic({
      code: "jira_config_invalid",
      message: "userAgent must be non-empty",
      retryable: false,
    });
  }
  if (config.auth.kind === "bearer" && config.auth.token.trim().length === 0) {
    return diagnostic({
      code: "jira_config_invalid",
      message: "bearer token must be non-empty",
      retryable: false,
    });
  }
  if (config.auth.kind === "basic") {
    if (
      config.auth.email.trim().length === 0 ||
      config.auth.apiToken.trim().length === 0
    ) {
      return diagnostic({
        code: "jira_config_invalid",
        message: "basic email and apiToken must be non-empty",
        retryable: false,
      });
    }
  }
  if (
    config.auth.kind === "oauth2_3lo" &&
    config.auth.accessToken.trim().length === 0
  ) {
    return diagnostic({
      code: "jira_config_invalid",
      message: "oauth2_3lo accessToken must be non-empty",
      retryable: false,
    });
  }
  return undefined;
};

const issueListArtifactPath = (
  request: JiraFetchRequest,
): string | undefined => {
  if (request.runDir === undefined || request.sourceId === undefined) {
    return undefined;
  }
  if (!SOURCE_ID_RE.test(request.sourceId)) {
    throw new TypeError(
      "JiraFetchRequest sourceId must match ^[A-Za-z0-9._-]{1,64}$",
    );
  }
  return path.join(
    request.runDir,
    "sources",
    request.sourceId,
    JIRA_ISSUE_IR_LIST_ARTIFACT_FILENAME,
  );
};

const validateReplayRequest = (
  request: JiraFetchRequest,
): JiraGatewayDiagnostic | undefined => {
  if (request.runDir !== undefined && request.runDir.length === 0) {
    return diagnostic({
      code: "jira_request_invalid",
      message: "runDir must be non-empty when provided",
      retryable: false,
    });
  }
  if (request.sourceId !== undefined && !SOURCE_ID_RE.test(request.sourceId)) {
    return diagnostic({
      code: "jira_source_id_invalid",
      message: "sourceId must match ^[A-Za-z0-9._-]{1,64}$",
      retryable: false,
    });
  }
  return undefined;
};

const sanitizeArtifactValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return redactHighRiskSecrets(value, "[redacted-secret]");
  }
  if (Array.isArray(value))
    return value.map((item) => sanitizeArtifactValue(item));
  if (typeof value !== "object" || value === null) return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = sanitizeArtifactValue(child);
  }
  return output;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isJiraIssueIr = (value: unknown): value is JiraIssueIr => {
  if (!isRecord(value)) return false;
  return (
    value["version"] === "1.0.0" &&
    typeof value["issueKey"] === "string" &&
    typeof value["issueType"] === "string" &&
    typeof value["summary"] === "string" &&
    typeof value["descriptionPlain"] === "string" &&
    Array.isArray(value["acceptanceCriteria"]) &&
    isStringArray(value["labels"]) &&
    isStringArray(value["components"]) &&
    isStringArray(value["fixVersions"]) &&
    typeof value["status"] === "string" &&
    (value["priority"] === undefined ||
      typeof value["priority"] === "string") &&
    Array.isArray(value["customFields"]) &&
    Array.isArray(value["comments"]) &&
    Array.isArray(value["attachments"]) &&
    Array.isArray(value["links"]) &&
    Array.isArray(value["piiIndicators"]) &&
    Array.isArray(value["redactions"]) &&
    isRecord(value["dataMinimization"]) &&
    typeof value["capturedAt"] === "string" &&
    typeof value["contentHash"] === "string"
  );
};

const readIssueListEntry = async (
  artifactPath: string,
): Promise<JiraApiCacheEntry> => {
  const raw = await readFile(artifactPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Jira IR replay entry must be an object");
  }
  const candidate = parsed as Partial<JiraApiCacheEntry>;
  if (
    candidate.version !== "1.0.0" ||
    typeof candidate.responseHash !== "string" ||
    typeof candidate.responseBytes !== "number" ||
    typeof candidate.capability !== "object" ||
    !Array.isArray(candidate.issues) ||
    !candidate.issues.every(isJiraIssueIr)
  ) {
    throw new TypeError("Jira IR replay entry is malformed");
  }
  return candidate as JiraApiCacheEntry;
};

const writeIssueListArtifact = async ({
  request,
  capability,
  responseHash,
  responseBytes,
  issues,
}: {
  request: JiraFetchRequest;
  capability: JiraCapabilityProbe;
  responseHash: string;
  responseBytes: number;
  issues: readonly JiraIssueIr[];
}): Promise<void> => {
  if (request.runDir === undefined || request.sourceId === undefined) return;
  if (!SOURCE_ID_RE.test(request.sourceId)) {
    throw new TypeError(
      "JiraFetchRequest sourceId must match ^[A-Za-z0-9._-]{1,64}$",
    );
  }
  const dir = path.join(request.runDir, "sources", request.sourceId);
  await mkdir(dir, { recursive: true });
  const artifactPath = path.join(dir, JIRA_ISSUE_IR_LIST_ARTIFACT_FILENAME);
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(
    tempPath,
    canonicalJson({
      version: "1.0.0",
      capability,
      responseHash,
      responseBytes,
      issues,
    }),
    "utf8",
  );
  await rename(tempPath, artifactPath);

  if (issues.length === 1) {
    await writeJiraIssueIr({
      runDir: request.runDir,
      sourceId: request.sourceId,
      ir: issues[0]!,
    });
  }
};

const resolveApiVersion = (capability: JiraCapabilityProbe): "2" | "3" =>
  capability.deploymentType === "Cloud" ? "3" : "2";

const buildSearchBody = (
  request: JiraFetchRequest,
): Record<string, unknown> | JiraGatewayDiagnostic => {
  const searchBody: Record<string, unknown> = {};
  if (request.query.kind === "jql") {
    const sanitizedJql = sanitizeJqlFragment(request.query.jql);
    if (!sanitizedJql.ok) {
      return diagnostic({
        code: "jira_request_invalid",
        message: `invalid JQL fragment (${sanitizedJql.code})`,
        retryable: false,
      });
    }
    const maxResultsError = validatePositiveSafeInteger(
      request.query.maxResults,
      "query.maxResults",
    );
    if (maxResultsError !== undefined) return maxResultsError;
    searchBody.jql = sanitizedJql.sanitized;
    searchBody.maxResults = request.query.maxResults;
  } else {
    if (request.query.issueKeys.length === 0) {
      return diagnostic({
        code: "jira_issue_key_invalid",
        message: "issueKeys must contain at least one key",
        retryable: false,
      });
    }
    const invalid = request.query.issueKeys.find(
      (key) => key.length > 64 || !JIRA_ISSUE_KEY_RE.test(key),
    );
    if (invalid !== undefined) {
      return diagnostic({
        code: "jira_issue_key_invalid",
        message: `invalid issue key ${invalid.slice(0, 64)}`,
        retryable: false,
      });
    }
    searchBody.jql = `issueKey IN (${request.query.issueKeys.map((key) => `"${key}"`).join(",")})`;
    searchBody.maxResults = request.query.issueKeys.length;
  }

  if (request.expand !== undefined) searchBody.expand = [...request.expand];
  const fieldSelection = {
    includeDescription:
      request.fieldSelection?.includeDescription ??
      DEFAULT_JIRA_FIELD_SELECTION_PROFILE.includeDescription,
    includeComments:
      request.fieldSelection?.includeComments ??
      DEFAULT_JIRA_FIELD_SELECTION_PROFILE.includeComments,
    includeAttachments:
      request.fieldSelection?.includeAttachments ??
      DEFAULT_JIRA_FIELD_SELECTION_PROFILE.includeAttachments,
    includeLinks:
      request.fieldSelection?.includeLinks ??
      DEFAULT_JIRA_FIELD_SELECTION_PROFILE.includeLinks,
    customFieldAllowList:
      request.fieldSelection?.customFieldAllowList ??
      DEFAULT_JIRA_FIELD_SELECTION_PROFILE.customFieldAllowList,
    acceptanceCriterionFieldIds:
      request.fieldSelection?.acceptanceCriterionFieldIds ??
      DEFAULT_JIRA_FIELD_SELECTION_PROFILE.acceptanceCriterionFieldIds,
  };
  for (const fieldId of [
    ...fieldSelection.customFieldAllowList,
    ...fieldSelection.acceptanceCriterionFieldIds,
  ]) {
    if (!CUSTOM_FIELD_ID_RE.test(fieldId)) {
      return diagnostic({
        code: "jira_field_selection_profile_invalid",
        message: `invalid Jira custom field id ${fieldId.slice(0, 64)}`,
        retryable: false,
      });
    }
  }
  const fields = [
    "summary",
    "issuetype",
    "status",
    "priority",
    "labels",
    "components",
    "fixVersions",
  ];
  if (fieldSelection.includeDescription) fields.push("description");
  if (fieldSelection.includeComments) fields.push("comment");
  if (fieldSelection.includeAttachments) fields.push("attachment");
  if (fieldSelection.includeLinks) fields.push("issuelinks");
  fields.push(...fieldSelection.customFieldAllowList);
  fields.push(...fieldSelection.acceptanceCriterionFieldIds);
  searchBody.fields = [...new Set(fields)];
  return searchBody;
};

const parseIssues = ({
  rawResponse,
  capability,
  request,
}: {
  rawResponse: unknown;
  capability: JiraCapabilityProbe;
  request: JiraFetchRequest;
}): AttemptResult => {
  if (
    typeof rawResponse !== "object" ||
    rawResponse === null ||
    !("issues" in rawResponse) ||
    !Array.isArray((rawResponse as Record<string, unknown>)["issues"])
  ) {
    return {
      issues: [],
      capability,
      responseHash: "",
      retryable: false,
      attempts: 1,
      responseBytes: 0,
      diagnostic: diagnostic({
        code: "jira_response_invalid",
        message: "Jira search response does not contain an issues array",
        retryable: false,
      }),
    };
  }

  const data = rawResponse as {
    issues: Array<{ key?: string; fields?: Record<string, unknown> }>;
  };
  const issues: JiraIssueIr[] = [];
  const capturedAt = request.capturedAt ?? DETERMINISTIC_CAPTURED_AT;
  // Issue #1688 (audit-2026-05 Wave 3): canonicalise once and reuse for both
  // the hash and the byte-length. Previously we paid two full
  // canonicalJson(data) traversals + two large-string allocations per Jira
  // call (~8 MB peak heap at the 4 MB DEFAULT_MAX_RESPONSE_BYTES ceiling).
  const canonicalResponse = canonicalJson(data);
  const responseHash = createHash("sha256")
    .update(canonicalResponse)
    .digest("hex");
  const responseBytes = Buffer.byteLength(canonicalResponse, "utf8");

  for (const rawIssue of data.issues) {
    const fields = rawIssue.fields ?? {};
    const descriptionField = fields["description"];
    let description: JiraAdfSource = { kind: "absent" };
    if (typeof descriptionField === "string") {
      description = { kind: "plain", text: descriptionField };
    } else if (
      descriptionField !== null &&
      typeof descriptionField === "object"
    ) {
      description = { kind: "adf", json: JSON.stringify(descriptionField) };
    }

    const customFields = Object.entries(fields)
      .filter(
        ([key, value]) =>
          key.startsWith("customfield_") &&
          value !== null &&
          value !== undefined,
      )
      .map(([key, value]) => ({
        id: key,
        name: key,
        value: typeof value === "string" ? value : JSON.stringify(value),
      }));

    const issuetype = fields["issuetype"] as { name?: string } | undefined;
    const status = fields["status"] as { name?: string } | undefined;
    const priority = fields["priority"] as { name?: string } | undefined;

    const input: BuildJiraIssueIrInput = {
      issueKey: rawIssue.key ?? "UNKNOWN-1",
      issueType:
        typeof issuetype?.name === "string"
          ? issuetype.name.toLowerCase()
          : "other",
      summary:
        typeof fields["summary"] === "string"
          ? fields["summary"]
          : "No Summary",
      description,
      status: typeof status?.name === "string" ? status.name : "Open",
      ...(typeof priority?.name === "string"
        ? { priority: priority.name }
        : {}),
      labels: Array.isArray(fields["labels"])
        ? fields["labels"].map((label) => String(label))
        : [],
      components: Array.isArray(fields["components"])
        ? fields["components"].map((component) =>
            String((component as { name?: string }).name),
          )
        : [],
      fixVersions: Array.isArray(fields["fixVersions"])
        ? fields["fixVersions"].map((version) =>
            String((version as { name?: string }).name),
          )
        : [],
      customFields,
      capturedAt,
      ...(request.fieldSelection !== undefined
        ? { fieldSelection: request.fieldSelection }
        : {}),
    };

    const built = buildJiraIssueIr(input);
    if (!built.ok) {
      return {
        issues: [],
        capability,
        responseHash,
        retryable: false,
        attempts: 1,
        responseBytes,
        diagnostic: diagnostic({
          code: "jira_issue_ir_invalid",
          message: `${built.code}${built.path !== undefined ? ` at ${built.path}` : ""}`,
          retryable: false,
        }),
      };
    }
    issues.push(built.ir);
  }

  return {
    issues,
    capability,
    responseHash,
    retryable: false,
    attempts: 1,
    responseBytes,
  };
};

export const createJiraGatewayClient = (
  config: JiraGatewayConfig,
  runtime: JiraGatewayRuntime = {},
): JiraGatewayClient => {
  const configError =
    validateAuth(config) ??
    validatePositiveSafeInteger(config.maxWallClockMs, "maxWallClockMs") ??
    validateNonNegativeSafeInteger(config.maxRetries, "maxRetries") ??
    validatePositiveSafeInteger(config.maxResponseBytes, "maxResponseBytes");
  if (configError !== undefined) {
    throw new Error(configError.message);
  }
  if (!isSsrfSafeConfig(config)) {
    throw new Error(
      "JiraGatewayConfig baseUrl is not SSRF safe or invalid for auth kind",
    );
  }

  const fetchImpl = runtime.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const sleep = runtime.sleep ?? defaultSleep;
  const clock = runtime.clock ?? { now: () => Date.now() };
  const backoff = runtime.retryBackoffMs ?? DEFAULT_BACKOFF_MS;
  const breaker = createLlmCircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    ...(runtime.clock !== undefined ? { clock: runtime.clock } : {}),
  });

  let cachedCapabilityResult:
    | Awaited<ReturnType<JiraGatewayClient["probeCapability"]>>
    | undefined;

  const getOrProbeCapability = async (): ReturnType<
    JiraGatewayClient["probeCapability"]
  > => {
    if (cachedCapabilityResult !== undefined) return cachedCapabilityResult;
    const result = await probeJiraCapability({ config, fetchImpl });
    if (result.ok || !result.retryable) cachedCapabilityResult = result;
    return result;
  };

  const executeFetch = async ({
    request,
    attempt,
    startedAt,
    perAttemptBudgetMs,
  }: {
    request: JiraFetchRequest;
    attempt: number;
    startedAt: number;
    /**
     * Issue #1666 (audit-2026-05): cumulative wall-clock budget remaining
     * after the prior attempts have consumed their share. The per-attempt
     * abort timer is capped at the minimum of this value and the
     * configured `maxWallClockMs` so the second attempt cannot get a
     * fresh full budget.
     */
    perAttemptBudgetMs?: number;
  }): Promise<AttemptResult> => {
    const searchBody = buildSearchBody(request);
    if (isJiraGatewayDiagnostic(searchBody)) {
      return {
        issues: [],
        capability: {
          version: "unknown",
          deploymentType: "unknown",
          adfSupported: false,
        },
        responseHash: "",
        retryable: false,
        attempts: attempt,
        responseBytes: 0,
        diagnostic: searchBody,
      };
    }

    const capabilityResult = await getOrProbeCapability();
    if (!capabilityResult.ok) {
      return {
        issues: [],
        capability: {
          version: "unknown",
          deploymentType: "unknown",
          adfSupported: false,
        },
        responseHash: "",
        retryable: capabilityResult.retryable,
        attempts: attempt,
        responseBytes: 0,
        diagnostic: diagnostic({
          code: capabilityResult.code,
          message: capabilityResult.message,
          retryable: capabilityResult.retryable,
        }),
      };
    }

    const requestedBudget =
      request.maxWallClockMs ?? config.maxWallClockMs ?? 30000;
    // Issue #1666: cap the per-attempt timer at the cumulative remaining
    // budget so a third attempt cannot consume a fresh full budget after
    // the first two already burned 90 % of it.
    const maxWallClockMs =
      perAttemptBudgetMs !== undefined && perAttemptBudgetMs > 0
        ? Math.min(perAttemptBudgetMs, requestedBudget)
        : requestedBudget;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), maxWallClockMs);
    const url = buildJiraRestUrl(
      config.baseUrl,
      resolveApiVersion(capabilityResult.capability),
      "search",
    );

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          ...buildJiraAuthHeaders(config),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(searchBody),
        redirect: "error",
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === "AbortError";
      return {
        issues: [],
        capability: capabilityResult.capability,
        responseHash: "",
        retryable: !isAbort,
        attempts: attempt,
        responseBytes: 0,
        diagnostic: diagnostic({
          code: isAbort ? "jira_timeout" : "jira_transport_error",
          message: sanitizeError(
            err,
            isAbort ? "Jira request timed out" : "Jira transport error",
          ),
          retryable: !isAbort,
        }),
      };
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      return {
        issues: [],
        capability: capabilityResult.capability,
        responseHash: "",
        retryable: false,
        attempts: attempt,
        responseBytes: 0,
        diagnostic: diagnostic({
          code:
            response.status === 401 ? "jira_unauthorized" : "jira_forbidden",
          message: `Jira request failed with ${response.status}`,
          retryable: false,
          status: response.status,
        }),
      };
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const reason = response.headers.get("RateLimit-Reason") ?? undefined;
      const retryAfterMs =
        retryAfter !== null && /^[0-9]+$/u.test(retryAfter)
          ? Number.parseInt(retryAfter, 10) * 1000
          : undefined;
      const elapsed = clock.now() - startedAt;
      const remaining =
        (request.maxWallClockMs ?? config.maxWallClockMs ?? 30000) - elapsed;
      return {
        issues: [],
        capability: capabilityResult.capability,
        responseHash: "",
        retryable: retryAfterMs !== undefined && retryAfterMs < remaining,
        attempts: attempt,
        responseBytes: 0,
        ...(retryAfterMs !== undefined && retryAfterMs < remaining
          ? { retryDelayMs: retryAfterMs }
          : {}),
        diagnostic: diagnostic({
          code: "jira_rate_limited",
          message: "Jira request was rate limited",
          retryable: retryAfterMs !== undefined && retryAfterMs < remaining,
          status: response.status,
          ...(reason !== undefined ? { rateLimitReason: reason } : {}),
        }),
      };
    }

    if (response.status >= 500) {
      return {
        issues: [],
        capability: capabilityResult.capability,
        responseHash: "",
        retryable: true,
        attempts: attempt,
        responseBytes: 0,
        diagnostic: diagnostic({
          code: "jira_server_error",
          message: `Jira server error ${response.status}`,
          retryable: true,
          status: response.status,
        }),
      };
    }

    if (response.status >= 400) {
      return {
        issues: [],
        capability: capabilityResult.capability,
        responseHash: "",
        retryable: false,
        attempts: attempt,
        responseBytes: 0,
        diagnostic: diagnostic({
          code: "jira_request_failed",
          message: `Jira request failed with ${response.status}`,
          retryable: false,
          status: response.status,
        }),
      };
    }

    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      return {
        issues: [],
        capability: capabilityResult.capability,
        responseHash: "",
        retryable: true,
        attempts: attempt,
        responseBytes: 0,
        diagnostic: diagnostic({
          code: "jira_response_read_failed",
          message: sanitizeError(err, "Jira response read failed"),
          retryable: true,
        }),
      };
    }

    const responseBytes = Buffer.byteLength(text, "utf8");
    if (
      responseBytes > (config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)
    ) {
      return {
        issues: [],
        capability: capabilityResult.capability,
        responseHash: "",
        retryable: false,
        attempts: attempt,
        responseBytes,
        diagnostic: diagnostic({
          code: "jira_response_too_large",
          message: "Jira response exceeded maxResponseBytes",
          retryable: false,
        }),
      };
    }

    let rawResponse: unknown;
    try {
      rawResponse = sanitizeArtifactValue(JSON.parse(text));
    } catch (err) {
      return {
        issues: [],
        capability: capabilityResult.capability,
        responseHash: "",
        retryable: false,
        attempts: attempt,
        responseBytes,
        diagnostic: diagnostic({
          code: "jira_response_invalid_json",
          message: sanitizeError(err, "Jira response JSON parse failed"),
          retryable: false,
        }),
      };
    }

    const parsed = parseIssues({
      rawResponse,
      capability: capabilityResult.capability,
      request,
    });
    parsed.attempts = attempt;
    parsed.responseBytes = responseBytes;

    if (parsed.diagnostic === undefined) {
      await writeIssueListArtifact({
        request,
        capability: capabilityResult.capability,
        responseHash: parsed.responseHash,
        responseBytes,
        issues: parsed.issues,
      });
    }

    return parsed;
  };

  const fetchIssues = async (
    request: JiraFetchRequest,
  ): Promise<JiraFetchResult> => {
    const requestError =
      validatePositiveSafeInteger(request.maxWallClockMs, "maxWallClockMs") ??
      validateNonNegativeSafeInteger(request.maxRetries, "maxRetries") ??
      validateReplayRequest(request);
    if (requestError !== undefined) {
      const result: JiraFetchResult = {
        issues: [],
        capability: {
          version: "unknown",
          deploymentType: "unknown",
          adfSupported: false,
        },
        responseHash: "",
        retryable: false,
        attempts: 0,
        cacheHit: false,
        diagnostic: requestError,
      };
      runtime.onUsageEvent?.({
        ...(request.sourceId !== undefined
          ? { sourceId: request.sourceId }
          : {}),
        requestKind: request.query.kind,
        attempts: 0,
        cacheHit: false,
        responseBytes: 0,
        responseHash: "",
        diagnosticCode: requestError.code,
      });
      return result;
    }

    const artifactPath = issueListArtifactPath(request);
    if (request.replayMode === true) {
      if (artifactPath === undefined) {
        return {
          issues: [],
          capability: {
            version: "unknown",
            deploymentType: "unknown",
            adfSupported: false,
          },
          responseHash: "",
          retryable: false,
          attempts: 0,
          cacheHit: false,
          diagnostic: diagnostic({
            code: "jira_replay_cache_unconfigured",
            message: "replayMode requires runDir and sourceId",
            retryable: false,
          }),
        };
      }
      try {
        const entry = await readIssueListEntry(artifactPath);
        const result: JiraFetchResult = {
          issues: entry.issues,
          capability: entry.capability,
          responseHash: entry.responseHash,
          retryable: false,
          attempts: 0,
          cacheHit: true,
        };
        runtime.onUsageEvent?.({
          ...(request.sourceId !== undefined
            ? { sourceId: request.sourceId }
            : {}),
          requestKind: request.query.kind,
          attempts: 0,
          cacheHit: true,
          responseBytes: entry.responseBytes,
          responseHash: entry.responseHash,
        });
        return result;
      } catch (err) {
        const result: JiraFetchResult = {
          issues: [],
          capability: {
            version: "unknown",
            deploymentType: "unknown",
            adfSupported: false,
          },
          responseHash: "",
          retryable: false,
          attempts: 0,
          cacheHit: false,
          diagnostic: diagnostic({
            code: "jira_replay_cache_miss",
            message: sanitizeError(err, "Jira replay cache miss"),
            retryable: false,
          }),
        };
        runtime.onUsageEvent?.({
          ...(request.sourceId !== undefined
            ? { sourceId: request.sourceId }
            : {}),
          requestKind: request.query.kind,
          attempts: 0,
          cacheHit: false,
          responseBytes: 0,
          responseHash: "",
          ...(result.diagnostic !== undefined
            ? { diagnosticCode: result.diagnostic.code }
            : {}),
        });
        return result;
      }
    }

    const effectiveRetries =
      request.maxRetries !== undefined
        ? Math.min(config.maxRetries ?? 3, request.maxRetries)
        : (config.maxRetries ?? 3);
    const maxAttempts = Math.max(1, effectiveRetries + 1);
    const startedAt = clock.now();
    let lastResult: AttemptResult | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const decision = breaker.beforeRequest();
      if (!decision.allowRequest) {
        lastResult = {
          issues: [],
          capability: {
            version: "unknown",
            deploymentType: "unknown",
            adfSupported: false,
          },
          responseHash: "",
          retryable: false,
          attempts: attempt,
          responseBytes: 0,
          diagnostic: diagnostic({
            code: "jira_circuit_open",
            message: `circuit breaker is ${decision.snapshot.state}`,
            retryable: false,
          }),
        };
        break;
      }

      // Issue #1666 (audit-2026-05): compute the cumulative remaining
      // budget BEFORE the attempt and pass it as the per-attempt cap.
      // Previously every attempt got a fresh `maxWallClockMs` timer, so
      // a 3-attempt run could consume ~3× the declared budget. Now the
      // attempt-N timer is capped at `totalBudget - elapsed`, so the
      // total wall-clock can never exceed the declared budget.
      const totalBudget =
        request.maxWallClockMs ?? config.maxWallClockMs ?? 30000;
      const elapsedBeforeAttempt = clock.now() - startedAt;
      const perAttemptBudgetMs = totalBudget - elapsedBeforeAttempt;
      if (perAttemptBudgetMs <= 0) {
        // The accumulated wall-clock has already breached the budget
        // before this attempt could fire. Surface the dedicated
        // `jira_total_budget_exceeded` diagnostic so operators can
        // distinguish it from `jira_retry_budget_exceeded` (which
        // covers only the retry-sleep overshoot).
        const diag = diagnostic({
          code: "jira_total_budget_exceeded",
          message: `Jira cumulative wall-clock exceeded maxWallClockMs (${totalBudget}ms)`,
          retryable: false,
        });
        lastResult = {
          issues: [],
          capability: {
            version: "unknown",
            deploymentType: "unknown",
            adfSupported: false,
          },
          responseHash: "",
          retryable: false,
          attempts: attempt,
          responseBytes: 0,
          diagnostic: diag,
        };
        break;
      }

      const result = await executeFetch({
        request,
        attempt,
        startedAt,
        perAttemptBudgetMs,
      });
      lastResult = result;

      if (result.issues.length > 0 || !result.retryable) {
        if (result.retryable) breaker.recordTransientFailure();
        else breaker.recordNonTransientOutcome();
        break;
      }

      breaker.recordTransientFailure();
      if (attempt >= maxAttempts) break;

      const waitMs =
        result.retryDelayMs ??
        backoff[Math.min(attempt - 1, backoff.length - 1)] ??
        0;
      if (clock.now() - startedAt + waitMs >= totalBudget) {
        result.retryable = false;
        result.diagnostic = diagnostic({
          code: "jira_retry_budget_exceeded",
          message: "Jira retry wait would exceed maxWallClockMs",
          retryable: false,
        });
        break;
      }
      if (waitMs > 0) await sleep(waitMs);
    }

    const result = lastResult ?? {
      issues: [],
      capability: {
        version: "unknown",
        deploymentType: "unknown",
        adfSupported: false,
      },
      responseHash: "",
      retryable: false,
      attempts: 0,
      responseBytes: 0,
      diagnostic: diagnostic({
        code: "jira_no_attempts",
        message: "no Jira attempts executed",
        retryable: false,
      }),
    };
    runtime.onUsageEvent?.({
      ...(request.sourceId !== undefined ? { sourceId: request.sourceId } : {}),
      requestKind: request.query.kind,
      attempts: result.attempts,
      cacheHit: false,
      responseBytes: result.responseBytes,
      responseHash: result.responseHash,
      ...(result.diagnostic?.code !== undefined
        ? { diagnosticCode: result.diagnostic.code }
        : {}),
      ...(result.diagnostic?.rateLimitReason !== undefined
        ? { rateLimitReason: result.diagnostic.rateLimitReason }
        : {}),
    });

    return {
      issues: result.issues,
      capability: result.capability,
      responseHash: result.responseHash,
      retryable: result.retryable,
      attempts: result.attempts,
      ...(result.diagnostic !== undefined
        ? { diagnostic: result.diagnostic }
        : {}),
      cacheHit: false,
    };
  };

  return {
    config,
    getCircuitBreaker: () => breaker,
    fetchIssues,
    probeCapability: getOrProbeCapability,
  };
};
