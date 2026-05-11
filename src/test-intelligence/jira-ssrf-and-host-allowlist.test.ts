import assert from "node:assert/strict";
import test from "node:test";

import { createJiraGatewayClient } from "./jira-gateway-client.js";

const base = {
  auth: { kind: "bearer" as const, token: "test-token" },
  userAgent: "workspace-dev/1.0",
  allowedHostPatterns: ["example.atlassian.net"],
};

test("jira-ssrf-and-host-allowlist: rejected hosts fail before network access", () => {
  const rejected = [
    "http://example.atlassian.net",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://192.168.0.1",
    "https://169.254.169.254",
    "https://100.64.0.1",
    "https://user:pass@example.atlassian.net", // pragma: allowlist secret
    "https://example.local",
    "https://xn--atlassan-9ib.net",
    "https://evil.example.com",
  ];
  for (const baseUrl of rejected) {
    assert.throws(
      () => createJiraGatewayClient({ ...base, baseUrl }),
      /not SSRF safe/,
      baseUrl,
    );
  }
});

test("jira-ssrf-and-host-allowlist: auth-specific public hosts are accepted only in their expected shape", () => {
  assert.doesNotThrow(() =>
    createJiraGatewayClient({
      ...base,
      baseUrl: "https://example.atlassian.net",
    }),
  );
  assert.doesNotThrow(() =>
    createJiraGatewayClient({
      ...base,
      auth: { kind: "basic" as const, email: "user@example.com", apiToken: "token" },
      baseUrl: "https://example.atlassian.net",
    }),
  );
  assert.doesNotThrow(() =>
    createJiraGatewayClient({
      ...base,
      auth: { kind: "oauth2_3lo" as const, accessToken: "oauth-token" },
      baseUrl: "https://api.atlassian.com/ex/jira/cloud-123",
    }),
  );
  assert.throws(() =>
    createJiraGatewayClient({
      ...base,
      auth: { kind: "oauth2_3lo" as const, accessToken: "oauth-token" },
      baseUrl: "https://example.atlassian.net",
    }),
  );
});
