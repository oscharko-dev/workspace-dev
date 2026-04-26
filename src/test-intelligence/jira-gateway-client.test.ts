import assert from "node:assert/strict";
import test from "node:test";
import { buildJiraAuthHeaders, probeJiraCapability } from "./jira-capability-probe.js";
import { createJiraGatewayClient } from "./jira-gateway-client.js";
import { createMockJiraGatewayClient } from "./jira-mock-gateway.js";
import type { JiraGatewayConfig, JiraFetchRequest } from "../contracts/index.js";

const DEFAULT_CONFIG: JiraGatewayConfig = {
  baseUrl: "https://example.atlassian.net",
  auth: { kind: "bearer", token: "test-token" },
  userAgent: "workspace-dev/1.0",
};

test("buildJiraAuthHeaders generates Bearer header", () => {
  const headers = buildJiraAuthHeaders({
    ...DEFAULT_CONFIG,
    auth: { kind: "bearer", token: "test-token" },
  });
  assert.equal(headers["Authorization"], "Bearer test-token");
});

test("buildJiraAuthHeaders generates Basic header", () => {
  const headers = buildJiraAuthHeaders({
    ...DEFAULT_CONFIG,
    auth: { kind: "basic", email: "user@example.com", apiToken: "secret" },
  });
  const expected = Buffer.from("user@example.com:secret").toString("base64");
  assert.equal(headers["Authorization"], `Basic ${expected}`);
});

test("buildJiraAuthHeaders generates OAuth2 header", () => {
  const headers = buildJiraAuthHeaders({
    ...DEFAULT_CONFIG,
    auth: { kind: "oauth2_3lo", accessToken: "oauth-token" },
  });
  assert.equal(headers["Authorization"], "Bearer oauth-token");
});

test("JiraGatewayClient probes capability successfully", async () => {
  let fetchedUrl = "";
  const mockFetch = async (url: string, init: any): Promise<Response> => {
    fetchedUrl = url;
    return new Response(JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }), {
      status: 200,
    });
  };

  const client = createJiraGatewayClient(DEFAULT_CONFIG, { fetchImpl: mockFetch as any });
  const result = await client.probeCapability();
  assert.ok(result.ok);
  assert.equal((result as any).capability.deploymentType, "Cloud");
  assert.ok(fetchedUrl.endsWith("/rest/api/3/serverInfo"));
});

test("JiraGatewayClient handles probe capability failure", async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response("", { status: 401 });
  };

  const client = createJiraGatewayClient(DEFAULT_CONFIG, { fetchImpl: mockFetch as any });
  const result = await client.probeCapability();
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.retryable, false);
    assert.equal(result.code, "jira_unauthorized");
  }
});

test("JiraGatewayClient fetches JQL", async () => {
  const mockFetch = async (url: string, init: any): Promise<Response> => {
    if (url.endsWith("serverInfo")) {
      return new Response(JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }), { status: 200 });
    }
    const responseBody = {
      issues: [
        {
          key: "TEST-1",
          fields: {
            issuetype: { name: "Bug" },
            summary: "Test issue",
            description: "Test description",
            status: { name: "Open" },
          },
        },
      ],
    };
    return new Response(JSON.stringify(responseBody), { status: 200 });
  };

  const client = createJiraGatewayClient(DEFAULT_CONFIG, { fetchImpl: mockFetch as any });
  const result = await client.fetchIssues({ query: { kind: "jql", jql: "project=TEST", maxResults: 10 } });
  
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].issueKey, "TEST-1");
  assert.equal(result.issues[0].summary, "Test issue");
  assert.equal(typeof result.issues[0].descriptionPlain, "string");
});

test("JiraGatewayClient fetch rate limit retry", async () => {
  let attempts = 0;
  const mockFetch = async (url: string, init: any): Promise<Response> => {
    if (url.endsWith("serverInfo")) {
      return new Response(JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }), { status: 200 });
    }
    attempts++;
    if (attempts === 1) {
      return new Response("", { status: 429, headers: new Headers({ "Retry-After": "1" }) });
    }
    return new Response(JSON.stringify({ issues: [] }), { status: 200 });
  };

  const sleep = async () => {};
  const client = createJiraGatewayClient({ ...DEFAULT_CONFIG, maxRetries: 3 }, { fetchImpl: mockFetch as any, sleep });
  
  const result = await client.fetchIssues({ query: { kind: "jql", jql: "project=TEST", maxResults: 10 } });
  assert.equal(attempts, 2);
  assert.equal(result.retryable, false);
});

test("MockJiraGatewayClient returns deterministic static response", async () => {
  const staticResult = {
    issues: [],
    capability: { version: "mock", deploymentType: "Cloud" as const, adfSupported: true },
    responseHash: "hash",
    retryable: false,
    attempts: 1,
  };
  const mock = createMockJiraGatewayClient({
    config: DEFAULT_CONFIG,
    staticResponse: staticResult,
  });

  const res = await mock.fetchIssues({ query: { kind: "jql", jql: "project=MOCK", maxResults: 1 } });
  assert.equal(res.responseHash, "hash");
  assert.equal(mock.callCount(), 1);
});

test("JiraGatewayClient rejects SSRF vectors", () => {
  const invalidUrls = [
    "http://example.com", // not https
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://192.168.1.1",
    "https://localhost",
    "https://user:pass@example.com",
    "https://example.com.local",
  ];

  for (const url of invalidUrls) {
    assert.throws(
      () => createJiraGatewayClient({ ...DEFAULT_CONFIG, baseUrl: url }),
      { message: /not SSRF safe/ }
    );
  }
});
