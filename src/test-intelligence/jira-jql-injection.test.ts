import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { createJiraGatewayClient } from "./jira-gateway-client.js";

const BASE_CONFIG = {
  baseUrl: "https://example.atlassian.net",
  auth: { kind: "bearer" as const, token: "test-token" },
  userAgent: "workspace-dev/1.0",
  allowedHostPatterns: ["example.atlassian.net"],
};

test("jira-jql-injection: curated malicious JQL fragments are rejected before fetch", async () => {
  const payloads = [
    "project = PAY; DROP TABLE issues",
    "project = PAY -- comment",
    "project = PAY OR 1=1",
    "project = PAY AND 1=1",
    "project = PAY\r\nOR 1=1",
    "project = `PAY`",
  ];

  for (const jql of payloads) {
    let calls = 0;
    const client = createJiraGatewayClient(BASE_CONFIG, {
      fetchImpl: (async () => {
        calls += 1;
        return new Response(JSON.stringify({ issues: [] }), { status: 200 });
      }) as typeof fetch,
    });

    const result = await client.fetchIssues({
      query: { kind: "jql", jql, maxResults: 10 },
    });

    assert.equal(result.retryable, false, jql);
    assert.equal(result.diagnostic?.code, "jira_request_invalid", jql);
    assert.equal(calls, 0, `fetch must not run for rejected JQL: ${jql}`);
  }
});

test("jira-jql-injection: property rejects injection vectors with deterministic seed", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(
        fc.constant("project = PAY; DROP TABLE issues"),
        fc.constant("project = PAY -- hidden"),
        fc.constant("project = PAY OR 1=1"),
        fc.constant("project = PAY AND 1=1"),
        fc.constant("project = `PAY`"),
        fc.stringMatching(/^project = PAY[\r\n\t].+$/),
        fc.string({ minLength: 513, maxLength: 700 }).map((value) => `project = ${value}`),
      ),
      async (jql) => {
        let calls = 0;
        const client = createJiraGatewayClient(BASE_CONFIG, {
          fetchImpl: (async () => {
            calls += 1;
            return new Response(JSON.stringify({ issues: [] }), { status: 200 });
          }) as typeof fetch,
        });
        const result = await client.fetchIssues({
          query: { kind: "jql", jql, maxResults: 10 },
        });
        assert.equal(result.diagnostic?.code, "jira_request_invalid");
        assert.equal(calls, 0);
      },
    ),
    { seed: 20260427, numRuns: 256 },
  );
});
