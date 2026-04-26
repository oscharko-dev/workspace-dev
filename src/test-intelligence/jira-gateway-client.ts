import { createLlmCircuitBreaker, type LlmCircuitBreaker, type LlmCircuitClock } from "./llm-circuit-breaker.js";
import { buildJiraAuthHeaders, probeJiraCapability } from "./jira-capability-probe.js";
import { buildJiraIssueIr, type BuildJiraIssueIrInput, type JiraAdfSource } from "./jira-issue-ir.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import type { JiraGatewayConfig, JiraFetchRequest, JiraFetchResult, JiraIssueIr, JiraCapabilityProbe } from "../contracts/index.js";
import * as net from "node:net";

export interface JiraGatewayRuntime {
  fetchImpl?: typeof fetch;
  clock?: LlmCircuitClock;
  sleep?: (ms: number) => Promise<void>;
  retryBackoffMs?: ReadonlyArray<number>;
}

export interface JiraGatewayClient {
  readonly config: JiraGatewayConfig;
  getCircuitBreaker(): LlmCircuitBreaker;
  fetchIssues(request: JiraFetchRequest): Promise<JiraFetchResult>;
  probeCapability(): Promise<{ ok: true; capability: JiraCapabilityProbe } | { ok: false; code: string; message: string; retryable: boolean }>;
}

const DEFAULT_BACKOFF_MS = [100, 200, 400, 800, 1600];
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024; // 4 MiB



const isSsrfSafeUrl = (urlString: string, authKind: string): boolean => {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  // No embedded credentials
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();

  // IP address blocks for SSRF prevention
  if (net.isIPv4(host)) {
    const parts = host.split(".").map((n) => parseInt(n, 10));
    // 0.0.0.0/8
    if (parts[0] === 0) return false;
    // 10.0.0.0/8
    if (parts[0] === 10) return false;
    // 127.0.0.0/8
    if (parts[0] === 127) return false;
    // 169.254.0.0/16
    if (parts[0] === 169 && parts[1] !== undefined && parts[1] === 254) return false;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] !== undefined && parts[1] >= 16 && parts[1] <= 31) return false;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] !== undefined && parts[1] === 168) return false;
  }

  // IPv6 loopback / link-local roughly
  if (net.isIPv6(host) || host.includes("::")) return false;

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return false;
  }

  if (authKind === "basic" && !host.endsWith(".atlassian.net")) {
    return false; // Cloud Basic expects atlassian.net
  }
  if (authKind === "oauth2_3lo" && host !== "api.atlassian.com") {
    return false; // OAuth2 expects api.atlassian.com/ex/jira/...
  }

  return true;
};

export const createJiraGatewayClient = (
  config: JiraGatewayConfig,
  runtime: JiraGatewayRuntime = {}
): JiraGatewayClient => {
  if (!isSsrfSafeUrl(config.baseUrl, config.auth.kind)) {
    throw new Error(`JiraGatewayConfig baseUrl is not SSRF safe or invalid for auth kind: ${config.baseUrl}`);
  }

  const fetchImpl = runtime.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const sleep = runtime.sleep ?? (async (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))));
  const backoff = runtime.retryBackoffMs ?? DEFAULT_BACKOFF_MS;
  const breaker = createLlmCircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    ...(runtime.clock ? { clock: runtime.clock } : {}),
  });

  let cachedCapability: JiraCapabilityProbe | undefined;

  const getOrProbeCapability = async (): Promise<{ ok: true; capability: JiraCapabilityProbe } | { ok: false; code: string; message: string; retryable: boolean }> => {
    if (cachedCapability) return { ok: true, capability: cachedCapability };
    const result = await probeJiraCapability({ config, fetchImpl });
    if (result.ok) {
      cachedCapability = result.capability;
    }
    return result;
  };

  const executeFetch = async (
    request: JiraFetchRequest,
    attempt: number
  ): Promise<JiraFetchResult> => {
    const capResult = await getOrProbeCapability();
    if (!capResult.ok) {
      return {
        issues: [],
        capability: { version: "unknown", deploymentType: "unknown", adfSupported: false },
        responseHash: "",
        retryable: capResult.retryable,
        attempts: attempt,
      };
    }

    const headers = buildJiraAuthHeaders(config);
    const baseUrl = config.baseUrl.endsWith("/") ? config.baseUrl.slice(0, -1) : config.baseUrl;
    const apiPath = capResult.capability.deploymentType === "Cloud" ? "3" : "2";

    const url = `${baseUrl}/rest/api/${apiPath}/search`;
    const searchBody: Record<string, unknown> = {};
    if (request.query.kind === "jql") {
      searchBody.jql = request.query.jql;
      searchBody.maxResults = request.query.maxResults;
    } else {
      searchBody.jql = `issueKey IN (${request.query.issueKeys.join(",")})`;
    }

    if (request.expand) searchBody.expand = [...request.expand];
    if (request.fieldSelection) {
      const fields = ["summary", "issuetype", "status", "priority", "labels", "components", "fixVersions"];
      if (request.fieldSelection.includeDescription) fields.push("description");
      if (request.fieldSelection.includeComments) fields.push("comment");
      if (request.fieldSelection.includeAttachments) fields.push("attachment");
      if (request.fieldSelection.includeLinks) fields.push("issuelinks");
      if (request.fieldSelection.customFieldAllowList) fields.push(...request.fieldSelection.customFieldAllowList);
      if (request.fieldSelection.acceptanceCriterionFieldIds) fields.push(...request.fieldSelection.acceptanceCriterionFieldIds);
      searchBody.fields = fields;
    }

    const maxWallClockMs = request.maxWallClockMs ?? config.maxWallClockMs ?? 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), maxWallClockMs);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(searchBody),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === "AbortError";
      return {
        issues: [],
        capability: capResult.capability,
        responseHash: "",
        retryable: !isAbort,
        attempts: attempt,
      };
    }

    try {
      if (response.status === 401 || response.status === 403) {
        return { issues: [], capability: capResult.capability, responseHash: "", retryable: false, attempts: attempt };
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter) {
          const waitSecs = parseInt(retryAfter, 10);
          if (!isNaN(waitSecs) && waitSecs > 0) {
            await sleep(waitSecs * 1000);
          }
        }
        return { issues: [], capability: capResult.capability, responseHash: "", retryable: true, attempts: attempt };
      }

      if (response.status >= 500) {
        return { issues: [], capability: capResult.capability, responseHash: "", retryable: true, attempts: attempt };
      }

      if (response.status >= 400) {
        return { issues: [], capability: capResult.capability, responseHash: "", retryable: false, attempts: attempt };
      }

      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > (config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)) {
        return { issues: [], capability: capResult.capability, responseHash: "", retryable: false, attempts: attempt };
      }

      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== "object" || parsed === null || !("issues" in parsed) || !Array.isArray((parsed as Record<string, unknown>).issues)) {
        return { issues: [], capability: capResult.capability, responseHash: "", retryable: false, attempts: attempt };
      }
      const data = parsed as { issues: Array<{ key?: string; fields?: Record<string, unknown> }> };

      const issuesIr: JiraIssueIr[] = [];
      const capturedAt = new Date().toISOString();

      for (const rawIssue of data.issues) {
        const fields = rawIssue.fields || {};
        
        const descriptionField = fields.description;
        let description: JiraAdfSource = { kind: "absent" };
        if (typeof descriptionField === "string") {
          description = { kind: "plain", text: descriptionField };
        } else if (descriptionField && typeof descriptionField === "object") {
          description = { kind: "adf", json: JSON.stringify(descriptionField) };
        }

        const customFieldsInput = [];
        for (const [k, v] of Object.entries(fields)) {
          if (k.startsWith("customfield_") && v !== null && v !== undefined) {
             const valStr = typeof v === "string" ? v : JSON.stringify(v);
             customFieldsInput.push({ id: k, name: k, value: valStr });
          }
        }

        const issuetype = fields.issuetype as { name?: string } | undefined;
        const status = fields.status as { name?: string } | undefined;
        const priority = fields.priority as { name?: string } | undefined;

        const input: BuildJiraIssueIrInput = {
          issueKey: rawIssue.key || "UNKNOWN-1",
          issueType: issuetype?.name || "other",
          summary: typeof fields.summary === "string" ? fields.summary : "No Summary",
          description,
          status: status?.name || "Open",
          ...(priority?.name ? { priority: priority.name } : {}),
          labels: Array.isArray(fields.labels) ? fields.labels.map((l: unknown) => String(l)) : [],
          components: Array.isArray(fields.components) ? fields.components.map((c: unknown) => String((c as { name?: string }).name)) : [],
          fixVersions: Array.isArray(fields.fixVersions) ? fields.fixVersions.map((v: unknown) => String((v as { name?: string }).name)) : [],
          customFields: customFieldsInput,
          capturedAt,
          ...(request.fieldSelection ? { fieldSelection: request.fieldSelection } : {}),
        };

        const result = buildJiraIssueIr(input);
        if (result.ok) {
          issuesIr.push(result.ir);
        }
      }

      return {
        issues: issuesIr,
        capability: capResult.capability,
        responseHash: sha256Hex(canonicalJson(data)),
        retryable: false,
        attempts: attempt,
      };
    } catch {
      return {
        issues: [],
        capability: capResult.capability,
        responseHash: "",
        retryable: true,
        attempts: attempt,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const fetchIssues = async (request: JiraFetchRequest): Promise<JiraFetchResult> => {
    const effectiveRetries = Math.min(config.maxRetries ?? 3, request.maxWallClockMs ? 1 : (config.maxRetries ?? 3));
    const maxAttempts = effectiveRetries + 1;
    let lastResult: JiraFetchResult | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const decision = breaker.beforeRequest();
      if (!decision.allowRequest) {
        return {
          issues: [],
          capability: { version: "unknown", deploymentType: "unknown", adfSupported: false },
          responseHash: "",
          retryable: false,
          attempts: attempt,
        };
      }

      const result = await executeFetch(request, attempt);
      lastResult = result;

      if (result.issues.length > 0 || !result.retryable) {
        if (!result.retryable && result.issues.length === 0) {
          breaker.recordNonTransientOutcome();
        } else {
          breaker.recordSuccess();
        }
        return result;
      }

      breaker.recordTransientFailure();
      
      if (attempt < maxAttempts) {
        const waitMs = backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0;
        if (waitMs > 0) await sleep(waitMs);
      }
    }

    return lastResult ?? {
      issues: [],
      capability: { version: "unknown", deploymentType: "unknown", adfSupported: false },
      responseHash: "",
      retryable: false,
      attempts: 0,
    };
  };

  return {
    config,
    getCircuitBreaker: () => breaker,
    fetchIssues,
    probeCapability: getOrProbeCapability,
  };
};
