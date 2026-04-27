import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import fc from "fast-check";

import { redactHighRiskSecrets } from "../secret-redaction.js";
import { createJiraGatewayClient } from "./jira-gateway-client.js";

const CONFIG = {
  baseUrl: "https://example.atlassian.net",
  auth: { kind: "bearer" as const, token: "test-token" },
  userAgent: "workspace-dev/1.0",
  allowedHostPatterns: ["example.atlassian.net"],
  maxRetries: 0,
};

test("jira-token-leakage: Jira response tokens are redacted from every persisted Jira artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jira-token-leakage-"));
  const sourceId = "jira-token-source";
  try {
    const fixture = JSON.parse(
      await readFile(
        new URL(
          "./fixtures/adversarial-jira-token-leak.response.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown;
    const client = createJiraGatewayClient(CONFIG, {
      fetchImpl: (async (url: string) => {
        if (url.endsWith("serverInfo")) {
          return new Response(
            JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(fixture), { status: 200 });
      }) as typeof fetch,
    });

    const result = await client.fetchIssues({
      query: { kind: "jql", jql: "project=PAY", maxResults: 1 },
      runDir: dir,
      sourceId,
    });

    assert.equal(result.issues.length, 1);
    const sourceDir = join(dir, "sources", sourceId);
    const persisted = await Promise.all([
      readFile(join(sourceDir, "jira-api-response.json"), "utf8"),
      readFile(join(sourceDir, "jira-issue-ir-list.json"), "utf8"),
      readFile(join(sourceDir, "jira-issue-ir.json"), "utf8"),
    ]);
    for (const raw of persisted) {
      assert.equal(raw.includes("jira-token-value-123"), false);
      assert.equal(raw.includes("dXNlcjpzZWNyZXQ="), false);
      assert.equal(raw.includes("oauth-token-value-456"), false);
      assert.equal(raw.includes("[redacted-secret]"), true);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("jira-token-leakage: property redacts supported secret shapes deterministically", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(
        "Bearer jira-token-value-123",
        "Authorization: Basic dXNlcjpzZWNyZXQ=",
        "access_token=oauth-token-value-456",
        "client_secret=synthetic-client-secret",
      ),
      (secret) => {
        const redacted = redactHighRiskSecrets(
          `diagnostic ${secret}`,
          "[redacted-secret]",
        );
        assert.equal(redacted.includes(secret), false);
        assert.equal(redacted.includes("[redacted-secret]"), true);
      },
    ),
    { seed: 20260427, numRuns: 256 },
  );
});
