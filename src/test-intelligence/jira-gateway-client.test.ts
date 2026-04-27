import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildJiraAuthHeaders,
  probeJiraCapability,
} from "./jira-capability-probe.js";
import { createJiraGatewayClient } from "./jira-gateway-client.js";
import { createMockJiraGatewayClient } from "./jira-mock-gateway.js";
import type {
  JiraGatewayConfig,
  JiraFetchRequest,
} from "../contracts/index.js";

const DEFAULT_CONFIG: JiraGatewayConfig = {
  baseUrl: "https://example.atlassian.net",
  auth: { kind: "bearer", token: "test-token" },
  userAgent: "workspace-dev/1.0",
  allowedHostPatterns: ["example.atlassian.net"],
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
    return new Response(
      JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
      {
        status: 200,
      },
    );
  };

  const client = createJiraGatewayClient(
    { ...DEFAULT_CONFIG, maxRetries: 0 },
    { fetchImpl: mockFetch as any },
  );
  const result = await client.probeCapability();
  assert.ok(result.ok);
  assert.equal((result as any).capability.deploymentType, "Cloud");
  assert.ok(fetchedUrl.endsWith("/rest/api/3/serverInfo"));
});

test("JiraGatewayClient handles probe capability failure", async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response("", { status: 401 });
  };

  const client = createJiraGatewayClient(
    { ...DEFAULT_CONFIG, maxRetries: 0 },
    { fetchImpl: mockFetch as any },
  );
  const result = await client.probeCapability();
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.retryable, false);
    assert.equal(result.code, "jira_unauthorized");
  }
});

test("JiraGatewayClient caches non-retryable failed capability probe once per session", async () => {
  let calls = 0;
  const mockFetch = async (): Promise<Response> => {
    calls += 1;
    return new Response("", { status: 401 });
  };

  const client = createJiraGatewayClient(
    { ...DEFAULT_CONFIG, maxRetries: 0 },
    { fetchImpl: mockFetch as any },
  );
  const first = await client.fetchIssues({
    query: { kind: "jql", jql: "project=TEST", maxResults: 10 },
  });
  const second = await client.fetchIssues({
    query: { kind: "jql", jql: "project=TEST", maxResults: 10 },
  });

  assert.equal(calls, 1);
  assert.equal(first.diagnostic?.code, "jira_unauthorized");
  assert.equal(second.diagnostic?.code, "jira_unauthorized");
});

test("JiraGatewayClient retries retryable capability probe failures", async () => {
  let probeCalls = 0;
  let searchCalls = 0;
  const mockFetch = async (url: string): Promise<Response> => {
    if (url.endsWith("serverInfo")) {
      probeCalls += 1;
      if (probeCalls === 1) return new Response("", { status: 503 });
      return new Response(
        JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
        { status: 200 },
      );
    }
    searchCalls += 1;
    return new Response(JSON.stringify({ issues: [] }), { status: 200 });
  };

  const client = createJiraGatewayClient(
    { ...DEFAULT_CONFIG, maxRetries: 1 },
    { fetchImpl: mockFetch as any, sleep: async () => {} },
  );
  const result = await client.fetchIssues({
    query: { kind: "jql", jql: "project=TEST", maxResults: 10 },
  });

  assert.equal(probeCalls, 2);
  assert.equal(searchCalls, 1);
  assert.equal(result.retryable, false);
  assert.equal(result.diagnostic, undefined);
});

test("JiraGatewayClient fetches JQL", async () => {
  const mockFetch = async (url: string, init: any): Promise<Response> => {
    if (url.endsWith("serverInfo")) {
      return new Response(
        JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
        { status: 200 },
      );
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

  const client = createJiraGatewayClient(DEFAULT_CONFIG, {
    fetchImpl: mockFetch as any,
  });
  const result = await client.fetchIssues({
    query: { kind: "jql", jql: "project=TEST", maxResults: 10 },
  });

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].issueKey, "TEST-1");
  assert.equal(result.issues[0].summary, "Test issue");
  assert.equal(typeof result.issues[0].descriptionPlain, "string");
});

test("JiraGatewayClient caches successful capability probe once per session", async () => {
  let probeCalls = 0;
  let searchCalls = 0;
  const mockFetch = async (url: string): Promise<Response> => {
    if (url.endsWith("serverInfo")) {
      probeCalls += 1;
      return new Response(
        JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
        { status: 200 },
      );
    }
    searchCalls += 1;
    return new Response(JSON.stringify({ issues: [] }), { status: 200 });
  };

  const client = createJiraGatewayClient(DEFAULT_CONFIG, {
    fetchImpl: mockFetch as any,
  });
  await client.fetchIssues({
    query: { kind: "jql", jql: "project=TEST", maxResults: 10 },
  });
  await client.fetchIssues({
    query: { kind: "jql", jql: "project=TEST", maxResults: 10 },
  });

  assert.equal(probeCalls, 1);
  assert.equal(searchCalls, 2);
});

test("JiraGatewayClient pushes issue-key batches and field selection into the request", async () => {
  let searchBody: Record<string, unknown> | undefined;
  const mockFetch = async (
    url: string,
    init: RequestInit,
  ): Promise<Response> => {
    if (url.endsWith("serverInfo")) {
      return new Response(
        JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
        { status: 200 },
      );
    }
    searchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ issues: [] }), { status: 200 });
  };

  const client = createJiraGatewayClient(DEFAULT_CONFIG, {
    fetchImpl: mockFetch as any,
  });
  await client.fetchIssues({
    query: { kind: "issueKeys", issueKeys: ["PAY_1-1", "PAY-2"] },
    fieldSelection: {
      includeDescription: false,
      includeComments: true,
      customFieldAllowList: ["customfield_10001"],
      acceptanceCriterionFieldIds: ["customfield_10002"],
    },
  });

  assert.equal(searchBody?.["jql"], 'issueKey IN ("PAY_1-1","PAY-2")');
  assert.equal(searchBody?.["maxResults"], 2);
  assert.deepEqual(searchBody?.["fields"], [
    "summary",
    "issuetype",
    "status",
    "priority",
    "labels",
    "components",
    "fixVersions",
    "comment",
    "customfield_10001",
    "customfield_10002",
  ]);
});

test("JiraGatewayClient rejects invalid issue-key batches before search fetch", async () => {
  let calls = 0;
  const mockFetch = async (url: string): Promise<Response> => {
    calls += 1;
    if (url.endsWith("serverInfo")) {
      return new Response(
        JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ issues: [] }), { status: 200 });
  };

  const client = createJiraGatewayClient(DEFAULT_CONFIG, {
    fetchImpl: mockFetch as any,
  });
  const result = await client.fetchIssues({
    query: { kind: "issueKeys", issueKeys: ["PAY-1", "BAD); DROP"] },
  });

  assert.equal(result.retryable, false);
  assert.equal(result.diagnostic?.code, "jira_issue_key_invalid");
  assert.equal(
    calls,
    0,
    "validation must fail closed before capability probing",
  );
});

test("JiraGatewayClient rejects invalid request budgets before network", async () => {
  let calls = 0;
  const client = createJiraGatewayClient(DEFAULT_CONFIG, {
    fetchImpl: (async () => {
      calls += 1;
      return new Response("", { status: 200 });
    }) as typeof fetch,
  });

  const result = await client.fetchIssues({
    query: { kind: "jql", jql: "project=TEST", maxResults: 10 },
    maxWallClockMs: 0,
  });

  assert.equal(calls, 0);
  assert.equal(result.attempts, 0);
  assert.equal(result.diagnostic?.code, "jira_request_invalid");
});

test("JiraGatewayClient rejects invalid replay sourceId without throwing", async () => {
  let calls = 0;
  const client = createJiraGatewayClient(DEFAULT_CONFIG, {
    fetchImpl: (async () => {
      calls += 1;
      return new Response("", { status: 200 });
    }) as typeof fetch,
  });

  const result = await client.fetchIssues({
    query: { kind: "jql", jql: "project=TEST", maxResults: 10 },
    runDir: "/tmp/workspace-dev-test",
    sourceId: "../escape",
  });

  assert.equal(calls, 0);
  assert.equal(result.attempts, 0);
  assert.equal(result.diagnostic?.code, "jira_source_id_invalid");
});

test("JiraGatewayClient fails closed when Jira response issue cannot build IR", async () => {
  const mockFetch = async (url: string): Promise<Response> => {
    if (url.endsWith("serverInfo")) {
      return new Response(
        JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        issues: [
          {
            key: "bad key",
            fields: {
              issuetype: { name: "Task" },
              summary: "Invalid response issue",
              description: "Bad key should fail closed",
              status: { name: "Open" },
            },
          },
        ],
      }),
      { status: 200 },
    );
  };

  const client = createJiraGatewayClient(DEFAULT_CONFIG, {
    fetchImpl: mockFetch as any,
  });
  const result = await client.fetchIssues({
    query: { kind: "jql", jql: "project=TEST", maxResults: 10 },
  });

  assert.equal(result.issues.length, 0);
  assert.equal(result.retryable, false);
  assert.equal(result.diagnostic?.code, "jira_issue_ir_invalid");
  assert.match(result.diagnostic?.message ?? "", /jira_issue_key_invalid/);
});

test("JiraGatewayClient fetch rate limit retry", async () => {
  let attempts = 0;
  const mockFetch = async (url: string, init: any): Promise<Response> => {
    if (url.endsWith("serverInfo")) {
      return new Response(
        JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
        { status: 200 },
      );
    }
    attempts++;
    if (attempts === 1) {
      return new Response("", {
        status: 429,
        headers: new Headers({ "Retry-After": "1" }),
      });
    }
    return new Response(JSON.stringify({ issues: [] }), { status: 200 });
  };

  const sleep = async () => {};
  const client = createJiraGatewayClient(
    { ...DEFAULT_CONFIG, maxRetries: 3 },
    { fetchImpl: mockFetch as any, sleep },
  );

  const result = await client.fetchIssues({
    query: { kind: "jql", jql: "project=TEST", maxResults: 10 },
  });
  assert.equal(attempts, 2);
  assert.equal(result.retryable, false);
});

test("JiraGatewayClient refuses Retry-After that exceeds wall-clock budget", async () => {
  let attempts = 0;
  let sleeps = 0;
  const mockFetch = async (url: string): Promise<Response> => {
    if (url.endsWith("serverInfo")) {
      return new Response(
        JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
        { status: 200 },
      );
    }
    attempts++;
    return new Response("", {
      status: 429,
      headers: new Headers({
        "Retry-After": "30",
        "RateLimit-Reason": "jira-cost-based",
      }),
    });
  };

  const client = createJiraGatewayClient(
    { ...DEFAULT_CONFIG, maxRetries: 3, maxWallClockMs: 1_000 },
    {
      fetchImpl: mockFetch as any,
      sleep: async () => {
        sleeps += 1;
      },
    },
  );
  const result = await client.fetchIssues({
    query: { kind: "jql", jql: "project=TEST", maxResults: 10 },
  });

  assert.equal(attempts, 1);
  assert.equal(sleeps, 0);
  assert.equal(result.retryable, false);
  assert.equal(result.diagnostic?.code, "jira_rate_limited");
  assert.equal(result.diagnostic?.rateLimitReason, "jira-cost-based");
});

test("JiraGatewayClient fails closed on auth and oversized responses", async () => {
  for (const status of [401, 403] as const) {
    let searchCalls = 0;
    const authFetch = async (url: string): Promise<Response> => {
      if (url.endsWith("serverInfo")) {
        return new Response(
          JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
          { status: 200 },
        );
      }
      searchCalls++;
      return new Response("", { status });
    };
    const client = createJiraGatewayClient(
      { ...DEFAULT_CONFIG, maxRetries: 3 },
      { fetchImpl: authFetch as any },
    );
    const result = await client.fetchIssues({
      query: { kind: "jql", jql: "project=TEST", maxResults: 10 },
    });
    assert.equal(searchCalls, 1);
    assert.equal(result.retryable, false);
    assert.equal(
      result.diagnostic?.code,
      status === 401 ? "jira_unauthorized" : "jira_forbidden",
    );
  }

  const oversizedFetch = async (url: string): Promise<Response> => {
    if (url.endsWith("serverInfo")) {
      return new Response(
        JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({ issues: [], padding: "x".repeat(128) }),
      { status: 200 },
    );
  };
  const client = createJiraGatewayClient(
    { ...DEFAULT_CONFIG, maxResponseBytes: 32 },
    { fetchImpl: oversizedFetch as any },
  );
  const result = await client.fetchIssues({
    query: { kind: "jql", jql: "project=TEST", maxResults: 10 },
  });
  assert.equal(result.retryable, false);
  assert.equal(result.diagnostic?.code, "jira_response_too_large");
});

test("JiraGatewayClient persists redacted Jira IR list and replay mode issues zero fetch calls", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "jira-gateway-cache-"));
  const sourceId = "jira.src";
  let liveCalls = 0;
  const token = "Bearer secret-token-value";
  const mockFetch = async (url: string): Promise<Response> => {
    liveCalls += 1;
    if (url.endsWith("serverInfo")) {
      return new Response(
        JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        issues: [
          {
            key: "PAY-1",
            fields: {
              issuetype: { name: "Task" },
              summary: `Token in raw path ${token}`,
              description: "Replay me",
              status: { name: "Open" },
            },
          },
        ],
      }),
      { status: 200 },
    );
  };

  const request: JiraFetchRequest = {
    query: { kind: "jql", jql: "project=PAY", maxResults: 1 },
    runDir,
    sourceId,
  };
  const live = createJiraGatewayClient(DEFAULT_CONFIG, {
    fetchImpl: mockFetch as any,
  });
  const liveResult = await live.fetchIssues(request);
  assert.equal(liveResult.issues.length, 1);
  assert.equal(liveCalls, 2);

  await assert.rejects(
    () =>
      readFile(
        join(runDir, "sources", sourceId, "jira-api-response.json"),
        "utf8",
      ),
    /ENOENT/u,
  );
  const persisted = await readFile(
    join(runDir, "sources", sourceId, "jira-issue-ir-list.json"),
    "utf8",
  );
  assert.equal(persisted.includes(token), false);
  assert.equal(persisted.includes("[redacted-secret]"), true);

  let replayCalls = 0;
  const replay = createJiraGatewayClient(DEFAULT_CONFIG, {
    fetchImpl: async () => {
      replayCalls += 1;
      throw new Error("network must not run");
    },
  });
  const replayResult = await replay.fetchIssues({
    ...request,
    replayMode: true,
  });
  assert.equal(replayResult.cacheHit, true);
  assert.equal(replayResult.responseHash, liveResult.responseHash);
  assert.equal(replayResult.issues.length, 1);
  assert.equal(replayCalls, 0);
});

test("JiraGatewayClient replay mode fails closed when cached IR list is malformed", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "jira-gateway-invalid-cache-"));
  const sourceId = "jira.src";
  const sourceDir = join(runDir, "sources", sourceId);
  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    join(sourceDir, "jira-issue-ir-list.json"),
    JSON.stringify({
      version: "1.0.0",
      capability: {
        version: "10.0.0",
        deploymentType: "Cloud",
        adfSupported: true,
      },
      responseHash: "f".repeat(64),
      responseBytes: 128,
      issues: "not-an-array",
    }),
    "utf8",
  );

  let replayCalls = 0;
  const replay = createJiraGatewayClient(DEFAULT_CONFIG, {
    fetchImpl: async () => {
      replayCalls += 1;
      throw new Error("network must not run");
    },
  });
  const result = await replay.fetchIssues({
    query: { kind: "jql", jql: "project=PAY", maxResults: 1 },
    runDir,
    sourceId,
    replayMode: true,
  });

  assert.equal(replayCalls, 0);
  assert.equal(result.cacheHit, false);
  assert.equal(result.issues.length, 0);
  assert.equal(result.diagnostic?.code, "jira_replay_cache_miss");

  await writeFile(
    join(sourceDir, "jira-issue-ir-list.json"),
    JSON.stringify({
      version: "1.0.0",
      capability: {
        version: "10.0.0",
        deploymentType: "Cloud",
        adfSupported: true,
      },
      responseHash: "f".repeat(64),
      responseBytes: 128,
      issues: [{ not: "a JiraIssueIr" }],
    }),
    "utf8",
  );
  const malformedIssueResult = await replay.fetchIssues({
    query: { kind: "jql", jql: "project=PAY", maxResults: 1 },
    runDir,
    sourceId,
    replayMode: true,
  });

  assert.equal(replayCalls, 0);
  assert.equal(malformedIssueResult.cacheHit, false);
  assert.equal(malformedIssueResult.issues.length, 0);
  assert.equal(malformedIssueResult.diagnostic?.code, "jira_replay_cache_miss");
});

test("MockJiraGatewayClient returns deterministic static response", async () => {
  const staticResult = {
    issues: [],
    capability: {
      version: "mock",
      deploymentType: "Cloud" as const,
      adfSupported: true,
    },
    responseHash: "hash",
    retryable: false,
    attempts: 1,
  };
  const mock = createMockJiraGatewayClient({
    config: DEFAULT_CONFIG,
    staticResponse: staticResult,
  });

  const res = await mock.fetchIssues({
    query: { kind: "jql", jql: "project=MOCK", maxResults: 1 },
  });
  assert.equal(res.responseHash, "hash");
  assert.equal(mock.callCount(), 1);
});

test("JiraGatewayClient rejects SSRF vectors", () => {
  const invalidUrls = [
    "http://example.com", // not https
    "https://169.254.169.254",
    "https://172.16.0.1",
    "https://100.64.0.1",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://192.168.1.1",
    "https://localhost",
    "https://user:pass@example.com", // pragma: allowlist secret
    "https://example.com.local",
    "https://xn--atlassan-9ib.net",
  ];

  for (const url of invalidUrls) {
    assert.throws(
      () => createJiraGatewayClient({ ...DEFAULT_CONFIG, baseUrl: url }),
      { message: /not SSRF safe/ },
    );
  }
});

test("JiraGatewayClient validates auth-specific host shapes", () => {
  assert.doesNotThrow(() =>
    createJiraGatewayClient({
      ...DEFAULT_CONFIG,
      auth: { kind: "basic", email: "user@example.com", apiToken: "api-token" },
      baseUrl: "https://example.atlassian.net/rest/api/3",
    }),
  );
  assert.throws(() =>
    createJiraGatewayClient({
      ...DEFAULT_CONFIG,
      auth: { kind: "basic", email: "user@example.com", apiToken: "api-token" },
      baseUrl: "https://jira.example.com",
    }),
  );
  assert.doesNotThrow(() =>
    createJiraGatewayClient({
      ...DEFAULT_CONFIG,
      auth: { kind: "oauth2_3lo", accessToken: "oauth-token" },
      baseUrl: "https://api.atlassian.com/ex/jira/cloud-123",
    }),
  );
  assert.throws(() =>
    createJiraGatewayClient({
      ...DEFAULT_CONFIG,
      auth: { kind: "oauth2_3lo", accessToken: "oauth-token" },
      baseUrl: "https://example.atlassian.net",
    }),
  );
  assert.doesNotThrow(() =>
    createJiraGatewayClient({
      ...DEFAULT_CONFIG,
      baseUrl: "https://jira.example.com",
      allowedHostPatterns: ["jira.example.com"],
    }),
  );
  assert.throws(() =>
    createJiraGatewayClient({
      ...DEFAULT_CONFIG,
      baseUrl: "https://jira.example.com",
      allowedHostPatterns: ["other.example.com"],
    }),
  );
});
