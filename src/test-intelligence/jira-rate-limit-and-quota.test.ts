import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createJiraGatewayClient } from "./jira-gateway-client.js";

const CONFIG = {
  baseUrl: "https://example.atlassian.net",
  auth: { kind: "bearer" as const, token: "test-token" },
  userAgent: "workspace-dev/1.0",
  allowedHostPatterns: ["example.atlassian.net"],
};

const serverInfo = new Response(
  JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
  { status: 200 },
);

test("jira-rate-limit-and-quota: numeric Retry-After retries within budget", async () => {
  let searchCalls = 0;
  let slept = 0;
  const client = createJiraGatewayClient(
    { ...CONFIG, maxRetries: 2, maxWallClockMs: 5_000 },
    {
      sleep: async (ms) => {
        slept += ms;
      },
      fetchImpl: (async (url: string) => {
        if (url.endsWith("serverInfo")) return serverInfo.clone();
        searchCalls += 1;
        if (searchCalls === 1) {
          return new Response("", {
            status: 429,
            headers: { "Retry-After": "1" },
          });
        }
        return new Response(JSON.stringify({ issues: [] }), { status: 200 });
      }) as typeof fetch,
    },
  );
  const result = await client.fetchIssues({
    query: { kind: "jql", jql: "project=PAY", maxResults: 1 },
  });
  assert.equal(result.retryable, false);
  assert.equal(searchCalls, 2);
  assert.equal(slept, 1_000);
});

test("jira-rate-limit-and-quota: malformed or over-budget Retry-After fails closed", async () => {
  for (const retryAfter of ["Wed, 21 Oct 2026 07:28:00 GMT", "30"]) {
    let searchCalls = 0;
    let sleeps = 0;
    const client = createJiraGatewayClient(
      { ...CONFIG, maxRetries: 2, maxWallClockMs: 1_000 },
      {
        sleep: async () => {
          sleeps += 1;
        },
        fetchImpl: (async (url: string) => {
          if (url.endsWith("serverInfo")) return serverInfo.clone();
          searchCalls += 1;
          return new Response("", {
            status: 429,
            headers: {
              "Retry-After": retryAfter,
              "RateLimit-Reason": "synthetic-quota",
            },
          });
        }) as typeof fetch,
      },
    );
    const result = await client.fetchIssues({
      query: { kind: "jql", jql: "project=PAY", maxResults: 1 },
    });
    assert.equal(searchCalls, 1);
    assert.equal(sleeps, 0);
    assert.equal(result.retryable, false);
    assert.equal(result.diagnostic?.code, "jira_rate_limited");
    assert.equal(result.diagnostic?.rateLimitReason, "synthetic-quota");
  }
});

test("jira-rate-limit-and-quota: oversized responses persist no partial Jira IR", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jira-quota-"));
  const sourceId = "jira-quota-source";
  try {
    const client = createJiraGatewayClient(
      { ...CONFIG, maxResponseBytes: 64 },
      {
        fetchImpl: (async (url: string) => {
          if (url.endsWith("serverInfo")) return serverInfo.clone();
          return new Response(
            JSON.stringify({ issues: [], padding: "x".repeat(1024) }),
            { status: 200 },
          );
        }) as typeof fetch,
      },
    );
    const result = await client.fetchIssues({
      query: { kind: "jql", jql: "project=PAY", maxResults: 1 },
      runDir: dir,
      sourceId,
    });
    assert.equal(result.diagnostic?.code, "jira_response_too_large");
    await assert.rejects(
      () => readFile(join(dir, "sources", sourceId, "jira-issue-ir.json"), "utf8"),
      /ENOENT/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
