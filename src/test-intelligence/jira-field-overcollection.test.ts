import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createJiraGatewayClient } from "./jira-gateway-client.js";

const BASE_CONFIG = {
  baseUrl: "https://example.atlassian.net",
  auth: { kind: "bearer" as const, token: "test-token" },
  userAgent: "workspace-dev/1.0",
  allowedHostPatterns: ["example.atlassian.net"],
};

test("jira-field-overcollection: default profile neither requests nor persists excluded Jira fields", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "jira-overcollection-"));
  const sourceId = "jira-overcollection";
  let requestedFields: string[] = [];

  const client = createJiraGatewayClient(BASE_CONFIG, {
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (url.endsWith("serverInfo")) {
        return new Response(
          JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
          { status: 200 },
        );
      }

      const body = JSON.parse(String(init?.body)) as { fields?: string[] };
      requestedFields = Array.isArray(body.fields) ? body.fields : [];

      const fullFields = {
        summary: "Transfer approval",
        description: "Synthetic description",
        issuetype: { name: "Story" },
        status: { name: "Open" },
        priority: { name: "High" },
        labels: ["finance"],
        components: [{ name: "Payments" }],
        fixVersions: [{ name: "2026.Q2" }],
        comment: {
          comments: [{ body: "secret reviewer note" }],
        },
        attachment: [
          { filename: "wire.pdf", content: "https://files.example.test/file" },
        ],
        issuelinks: [{ id: "1001" }],
        names: { customfield_10001: "Raw Field Name" },
        schema: { customfield_10001: { type: "string" } },
        avatarUrls: { "48x48": "https://avatar.example.test/u.png" },
        creator: { accountId: "abc123" },
        self: "https://example.atlassian.net/rest/api/3/issue/PAY-1",
        customfield_10001: "not allow-listed",
      };

      const filteredFields = Object.fromEntries(
        Object.entries(fullFields).filter(([key]) => requestedFields.includes(key)),
      );

      return new Response(
        JSON.stringify({
          issues: [
            {
              key: "PAY-1",
              fields: filteredFields,
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  });

  const result = await client.fetchIssues({
    query: { kind: "jql", jql: "project = PAY", maxResults: 1 },
    runDir,
    sourceId,
  });

  assert.equal(result.issues.length, 1);
  assert.deepEqual(requestedFields.sort(), [
    "components",
    "description",
    "fixVersions",
    "issuetype",
    "labels",
    "priority",
    "status",
    "summary",
  ]);

  const cacheArtifact = await readFile(
    join(runDir, "sources", sourceId, "jira-api-response.json"),
    "utf8",
  );
  const irArtifact = await readFile(
    join(runDir, "sources", sourceId, "jira-issue-ir.json"),
    "utf8",
  );

  for (const leaked of [
    "secret reviewer note",
    "wire.pdf",
    "https://files.example.test/file",
    "Raw Field Name",
    "avatar.example.test",
    "abc123",
    "rest/api/3/issue/PAY-1",
    "not allow-listed",
  ]) {
    assert.equal(cacheArtifact.includes(leaked), false, leaked);
    assert.equal(irArtifact.includes(leaked), false, leaked);
  }
});
