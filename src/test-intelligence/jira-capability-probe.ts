import { sanitizeErrorMessage } from "../error-sanitization.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";
import type { JiraCapabilityProbe, JiraGatewayConfig } from "../contracts/index.js";

export type JiraCapabilityProbeResult =
  | { ok: true; capability: JiraCapabilityProbe }
  | { ok: false; code: string; message: string; retryable: boolean };

export const buildJiraAuthHeaders = (config: JiraGatewayConfig): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": config.userAgent,
  };
  if (config.auth.kind === "bearer") {
    headers["Authorization"] = `Bearer ${config.auth.token}`;
  } else if (config.auth.kind === "basic") {
    const encoded = Buffer.from(`${config.auth.email}:${config.auth.apiToken}`).toString("base64");
    headers["Authorization"] = `Basic ${encoded}`;
  } else {
    headers["Authorization"] = `Bearer ${config.auth.accessToken}`;
  }
  return headers;
};

const sanitizeError = (err: unknown, fallback: string): string => {
  return redactHighRiskSecrets(
    sanitizeErrorMessage({ error: err, fallback }),
    "[redacted-secret]"
  );
};

const stripRestApiSuffix = (baseUrl: string): string => {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return trimmed.replace(/\/rest\/api\/[23]$/u, "");
};

export const buildJiraRestUrl = (
  baseUrl: string,
  apiVersion: "2" | "3",
  endpoint: string,
): string => {
  const root = stripRestApiSuffix(baseUrl);
  const suffix = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${root}/rest/api/${apiVersion}${suffix}`;
};

export const probeJiraCapability = async ({
  config,
  fetchImpl,
}: {
  config: JiraGatewayConfig;
  fetchImpl: typeof fetch;
}): Promise<JiraCapabilityProbeResult> => {
  const headers = buildJiraAuthHeaders(config);

  let response: Response;
  let url = buildJiraRestUrl(config.baseUrl, "3", "serverInfo");
  let isV3 = true;

  try {
    response = await fetchImpl(url, { headers, method: "GET", redirect: "error" });
    if (response.status === 404) {
      isV3 = false;
      url = buildJiraRestUrl(config.baseUrl, "2", "serverInfo");
      response = await fetchImpl(url, { headers, method: "GET", redirect: "error" });
    }
  } catch (err) {
    return {
      ok: false,
      code: "jira_probe_transport_error",
      message: sanitizeError(err, "probe transport failed"),
      retryable: true,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      code: response.status === 401 ? "jira_unauthorized" : "jira_forbidden",
      message: `probe failed with ${response.status}`,
      retryable: false,
    };
  }

  if (response.status === 429) {
    return {
      ok: false,
      code: "jira_rate_limited",
      message: "probe rate limited",
      retryable: true,
    };
  }

  if (response.status >= 500) {
    return {
      ok: false,
      code: "jira_probe_server_error",
      message: `probe server error ${response.status}`,
      retryable: true,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      code: "jira_probe_failed",
      message: `probe failed with ${response.status}`,
      retryable: false,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    return {
      ok: false,
      code: "jira_probe_invalid_json",
      message: sanitizeError(err, "probe json parse failed"),
      retryable: false,
    };
  }

  if (typeof body !== "object" || body === null) {
    return {
      ok: false,
      code: "jira_probe_invalid_response",
      message: "probe response not an object",
      retryable: false,
    };
  }

  const record = body as Record<string, unknown>;
  const version = typeof record.version === "string" ? record.version : "unknown";
  const deploymentTypeRaw = typeof record.deploymentType === "string" ? record.deploymentType : "unknown";

  let deploymentType: JiraCapabilityProbe["deploymentType"] = "unknown";
  if (deploymentTypeRaw === "Cloud") deploymentType = "Cloud";
  else if (deploymentTypeRaw === "Server") deploymentType = "Server";
  else if (deploymentTypeRaw === "DataCenter") deploymentType = "DataCenter";

  // ADF is supported on Cloud (v3) generally, but let's assume v3 implies ADF
  // and v2 doesn't, unless there's a specific flag in serverInfo.
  const adfSupported = isV3;

  return {
    ok: true,
    capability: {
      version,
      deploymentType,
      adfSupported,
    },
  };
};
