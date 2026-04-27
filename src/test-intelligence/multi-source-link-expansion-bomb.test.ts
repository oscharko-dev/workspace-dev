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
  maxRetries: 0,
};

test("multi-source-link-expansion-bomb: Jira links are not recursively expanded or persisted by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jira-link-bomb-"));
  const sourceId = "jira-link-bomb";
  let searchBody: Record<string, unknown> | undefined;
  try {
    const client = createJiraGatewayClient(CONFIG, {
      fetchImpl: (async (url: string, init?: RequestInit) => {
        if (url.endsWith("serverInfo")) {
          return new Response(
            JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
            { status: 200 },
          );
        }
        searchBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            issues: [
              {
                key: "PAY-1444",
                fields: {
                  issuetype: { name: "Task" },
                  summary: "Synthetic link expansion bomb",
                  description: "Links must not expand recursively.",
                  status: { name: "Open" },
                  issuelinks: Array.from({ length: 1_000 }, (_, index) => ({
                    outwardIssue: { key: `PAY-${index + 2000}` },
                  })),
                },
              },
            ],
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    const result = await client.fetchIssues({
      query: { kind: "jql", jql: "project=PAY", maxResults: 1 },
      runDir: dir,
      sourceId,
    });

    assert.equal(result.issues.length, 1);
    assert.equal((searchBody?.["fields"] as string[]).includes("issuelinks"), false);
    assert.equal(searchBody?.["expand"], undefined);
    const ir = await readFile(
      join(dir, "sources", sourceId, "jira-issue-ir.json"),
      "utf8",
    );
    assert.equal(ir.includes("PAY-2000"), false);
    assert.equal(ir.includes("issuelinks"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
