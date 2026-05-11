# Runbook — Jira Source Setup (Wave 4)

**Audience:** Platform operators and workspace-dev integrators setting up
Jira as a primary multi-source test-intent input.

**Prerequisite:** The parent test-intelligence gate must already be enabled.
See `docs/test-intelligence.md` §1 for the full enablement procedure.

**Estimated setup time:** ≤ 30 minutes against a Jira Cloud sandbox tenant
or Jira Data Center test instance.

---

## 1. Prerequisites

Before starting:

- `workspace-dev` installed at a known version (see `COMPATIBILITY.md`).
- The parent test-intelligence gate enabled:
    - `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1` in the environment.
    - `testIntelligence.enabled: true` in `WorkspaceStartOptions`.
- Node.js 22.x or 24.x (see `COMPATIBILITY.md` runtime matrix).
- Access to a Jira Cloud, Jira Data Center, or Jira Server instance with
  sufficient permissions to read issues in your target project.

---

## 2. Enable the multi-source gate

Add the multi-source environment variable:

```bash
export FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1
export FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE=1
```

Add the startup option:

```ts
const options: WorkspaceStartOptions = {
    testIntelligence: {
        enabled: true,
        multiSourceEnabled: true,
        // ... reviewer principals, other options
    },
};
```

The gate fails closed if either predicate is missing. The diagnostic code is
one of `ALLOWED_MULTI_SOURCE_MODE_GATE_REFUSAL_CODES`:
`test_intelligence_disabled`, `multi_source_env_disabled`,
`multi_source_startup_option_disabled`, or `llm_codegen_mode_locked`.

---

## 3. Authentication options

### 3.1 Jira Cloud — API token (recommended for automation)

1. Sign in to `https://id.atlassian.com/manage-profile/security/api-tokens`.
2. Click **Create API token**. Give it a descriptive name, e.g.
   `workspace-dev-ti-jira-[env]`.
3. Copy the token value. It will not be shown again.
4. Set in the environment (never in source code or config files):

```bash
export WORKSPACE_TI_JIRA_API_TOKEN="<token>"
export WORKSPACE_TI_JIRA_EMAIL="your-automation-account@example.com"
```

5. Pass the same shape to the gateway client in the hosting integration. The
   helper is currently an internal in-repo integration point; the published npm
   package exposes stable contracts and HTTP routes, not a public Jira gateway
   client subpath.

```ts
const jiraClient = createJiraGatewayClient({
    baseUrl: "https://your-org.atlassian.net",
    userAgent: "workspace-dev/1.0.0 (contact: ti-ops@example.invalid)",
    auth: {
        kind: "basic",
        email: process.env.WORKSPACE_TI_JIRA_EMAIL ?? "",
        apiToken: process.env.WORKSPACE_TI_JIRA_API_TOKEN ?? "",
    },
});
```

The token and email are never persisted to disk. They are used only in HTTP
`Authorization` headers and are redacted by `redactHighRiskSecrets` before
any log or error surface.

### 3.2 Jira Cloud — OAuth 2.0 (3LO)

For user-context access using OAuth 2.0 three-legged authorization:

1. Register an OAuth 2.0 app at `https://developer.atlassian.com/console`.
2. Select the **Jira API** scope. Request only the scopes listed in
   §4 (least-privilege scopes).
3. Complete the authorization code flow in your application and obtain an
   access token.
4. The gateway URL shape for Jira Cloud OAuth 2.0 is:
   `https://api.atlassian.com/ex/jira/<cloudId>` (where `cloudId` is the
   Atlassian cloud identifier for your instance). Atlassian's full REST API
   requests include `/rest/api/3/<resource>` after that prefix; workspace-dev's
   gateway appends that suffix internally.

```ts
const jiraClient = createJiraGatewayClient({
    baseUrl: `https://api.atlassian.com/ex/jira/${process.env.ATLASSIAN_CLOUD_ID}`,
    userAgent: "workspace-dev/1.0.0 (contact: ti-ops@example.invalid)",
    auth: {
        kind: "oauth2_3lo",
        accessToken: process.env.JIRA_OAUTH_ACCESS_TOKEN ?? "",
    },
});
```

OAuth 2.0 access tokens expire; refresh them before constructing or replacing
the gateway client. The workspace-dev gateway client does not manage token
refresh.

### 3.3 Jira Data Center — Personal Access Token (PAT)

For Jira Data Center 8.14+ and Jira Server 9+:

1. In Jira, go to **Profile → Personal Access Tokens → Create token**.
2. Set an appropriate expiry date.
3. Set in the environment:

```bash
export WORKSPACE_TI_JIRA_PAT="<token>"
```

4. Pass to the gateway client:

```ts
const jiraClient = createJiraGatewayClient({
    baseUrl: "https://jira.your-org.internal",
    userAgent: "workspace-dev/1.0.0 (contact: ti-ops@example.invalid)",
    auth: {
        kind: "bearer",
        token: process.env.WORKSPACE_TI_JIRA_PAT ?? "",
    },
    allowedHostPatterns: ["jira.your-org.internal"],
});
```

For Jira Data Center installations with self-signed or private CA
certificates, configure Node.js's `NODE_EXTRA_CA_CERTS` environment variable
before starting the runtime.

---

## 4. Least-privilege scope checklist

Only request the following Jira API scopes. Do not use admin scopes.

| Scope                      | Jira Cloud REST API v3                         | Required for                                                              |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| `read:jira-work`           | `GET /rest/api/3/issue/{issueIdOrKey}`         | Read issue fields                                                         |
| `read:jira-work`           | `GET /rest/api/3/issue/{issueIdOrKey}/comment` | Read comments (if `includeComments: true`)                                |
| No additional scope needed | —                                              | Attachment content is never fetched; only metadata (filename + MIME type) |

Do **not** request:

- `write:jira-work` — workspace-dev never writes to Jira.
- `manage:jira-project` — not required.
- `admin:jira` — not required. workspace-dev does not introspect Jira token
  scopes; least-privilege scope assignment is an operator responsibility. The
  SSRF guard enforces host boundaries, not OAuth scope policy.
- `read:jira-user` — account IDs are redacted to `@user` stubs before
  IR placement; human-readable user data is not needed.

### 4.1 Field-selection profile checklist

The `DEFAULT_JIRA_FIELD_SELECTION_PROFILE` excludes comments, attachments,
linked issues, and unknown custom fields. In-repo gateway integrations can
override `JiraFetchRequest.fieldSelection` only when required:

```ts
await jiraClient.fetchIssues({
    query: { kind: "issueKeys", issueKeys: ["PAY-42"] },
    fieldSelection: {
        includeComments: false, // default: false
        includeAttachments: false, // default: false (metadata only if true)
        includeLinks: false, // default: false
        customFieldAllowList: [], // default: [] (empty = exclude unknown)
        // To opt in to specific custom fields:
        // customFieldAllowList: ["customfield_10001", "customfield_10002"],
    },
});
```

The Inspector `jira-fetch` HTTP route currently exposes `issueKey`,
`issueKeys`, `jql`, `maxResults`, and `replayMode`; custom field-selection is
an internal gateway request option for hosting integrations.

Every opt-in is recorded in `JiraIssueIr.dataMinimization` so auditors can
verify what was collected per job.

---

## 5. Host allow-list and SSRF protection

The gateway client enforces a host allow-list. Only the host(s) explicitly
configured in `baseUrl` are permitted. All other hosts — including
redirects to different domains — are rejected with `ssrf_disallowed_host`.

For Jira Cloud:

```bash
# Allowed: your configured Atlassian subdomain only
# Pattern: https://your-org.atlassian.net
# NOT allowed: other *.atlassian.net subdomains, external redirects
```

For a sandbox environment where the Jira URL is not the production URL, use
a separate `createJiraGatewayClient` instance with the sandbox `baseUrl`.

**Never configure a wildcard allow-list.** The host allow-list is a
security control that prevents SSRF via Jira redirect or metadata endpoint
attacks.

---

## 6. Token rotation cadence

| Auth method                       | Recommended rotation                             |
| --------------------------------- | ------------------------------------------------ |
| Jira Cloud API token              | 90 days or on personnel change                   |
| Jira Cloud OAuth 2.0 access token | Per-session (managed by your token refresh flow) |
| Jira Data Center PAT              | 90 days or when the user's account is revoked    |

Rotate tokens by:

1. Creating a new token in the Jira admin console.
2. Updating the environment variable on all affected hosts.
3. Restarting the workspace-dev runtime.
4. Revoking the old token.

Do not rotate the token by simply overwriting the environment variable on a
running instance; restart the runtime to pick up the new value.

---

## 7. End-to-end setup verification (sandbox)

This worked example uses a Jira Cloud sandbox tenant. Adapt `baseUrl` and
issue key for your environment.

**Step 1 — Start the runtime with Jira enabled:**

```bash
export FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1
export FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE=1
export WORKSPACE_TI_JIRA_EMAIL="sandbox-bot@example.com"
export WORKSPACE_TI_JIRA_API_TOKEN="<sandbox-api-token>"
export WORKSPACE_TI_REVIEW_BEARER_TOKEN="<reviewer-token>"

node -e "
  const { createWorkspaceServer } = require('workspace-dev');
  createWorkspaceServer({
    host: '127.0.0.1',
    port: 1983,
    outputRoot: '.workspace-dev',
    testIntelligence: {
      enabled: true,
      multiSourceEnabled: true,
      reviewBearerToken: process.env.WORKSPACE_TI_REVIEW_BEARER_TOKEN,
    },
  }).then(s => s.listen());
"
```

**Step 2 — Submit a multi-source envelope with a Jira source:**

```bash
# Jira-only job: issue PAY-42 from the sandbox tenant
curl -s -X POST http://127.0.0.1:1983/workspace/test-intelligence/sources/job-001/jira-paste \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <reviewer-token>" \
  -d '{
    "format": "auto",
    "body": "Key: PAY-42\nSummary: Sandbox payment approval test\nStatus: Open\nDescription: User submits a SEPA payment of EUR 100.00 to IBAN DE89370400440532013000.\nAcceptance Criteria:\n1. Payment confirmation screen appears within 5 seconds.\n2. Confirmation email is sent."
  }'
```

Expected response (HTTP 200):

```json
{
    "ok": true,
    "jobId": "job-001",
    "sourceId": "jira-paste-1f3870be-a7d3c7f4d9e2",
    "sourceRef": {
        "sourceId": "jira-paste-1f3870be-a7d3c7f4d9e2",
        "kind": "jira_paste",
        "canonicalIssueKey": "PAY-42",
        "contentHash": "<sha256>"
    },
    "artifacts": {
        "jiraIssueIr": "sources/jira-paste-1f3870be-a7d3c7f4d9e2/jira-issue-ir.json",
        "pasteProvenance": "sources/jira-paste-1f3870be-a7d3c7f4d9e2/paste-provenance.json",
        "rawPastePersisted": false
    }
}
```

Record `sourceId` and `artifacts.jiraIssueIr` from the response. The
`sourceId` is generated by the server and must not be derived from the issue
key.

**Step 3 — Verify the IR artifact:**

```bash
SOURCE_ID="jira-paste-1f3870be-a7d3c7f4d9e2" # from the response
cat ".workspace-dev/job-001/sources/${SOURCE_ID}/jira-issue-ir.json" | \
  python3 -m json.tool | grep -E '"issueKey"|"summary"|"piiIndicators"'
```

Check that:

- `issueKey` matches `PAY-42`.
- `summary` is present and PII-redacted (IBAN numbers replaced with `[iban]`).
- `piiIndicators` is non-empty if any PII was detected.

**Step 4 — Check the multi-source gate status:**

```bash
curl -s http://127.0.0.1:1983/workspace/test-intelligence/jobs/job-001 | \
  python3 -m json.tool | grep -E '"multiSourceEnabled"|"sourceKinds"'
```

---

## 8. Jira-only operation

When only Jira sources are present (no Figma input):

- Figma artifacts, screenshots, and visual sidecar output are not required.
- The visual sidecar pipeline is skipped; `visual-sidecar-result.json` is not emitted.
- Source ingestion writes only `sources/<sourceId>/jira-issue-ir.json` and
  `sources/<sourceId>/paste-provenance.json`; no `multi-source-conflicts.json`
  is required for a single Jira paste source.
- The LLM test-case generator (`gpt-oss-120b`) receives the Jira IR as the
  sole structured input alongside the prompt template. The generator never
  receives Jira API credentials or raw Jira content.

Jira-only jobs are fully production-supported and do not require a Figma
access token or Figma plugin.

---

## 9. ADF and rate-limit handling

Jira Cloud REST API v3 returns Atlassian Document Format (ADF) in rich text
fields such as issue `description`, issue `environment`, comments, worklogs,
and `textarea` custom fields. workspace-dev parses only the fields selected by
the gateway request, converts them to bounded plain text in memory, and
persists only the redacted Jira IR.

Jira Cloud enforces rate limits on its REST API. The gateway client respects
the `Retry-After` header when present and preserves the redacted
`RateLimit-Reason` diagnostic for operators. Atlassian may also send
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and beta
rate-limit variants; monitor those at the gateway or proxy layer. The per-job
API call budget (`MAX_JIRA_API_REQUESTS_PER_JOB = 20`) limits blast radius.

When the rate limit is exceeded, the gateway returns `rate_limited` as the
error class. The LLM circuit-breaker records this as a non-transient failure
for the current job but does not affect other jobs.

---

## 10. Troubleshooting

| Symptom                                     | Likely cause                                                 | Resolution                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `multi_source_env_disabled` refusal         | `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE` not set  | Set the env var and restart                                                                       |
| `primary_source_required` on custom-context | No Jira or Figma source exists for the job                   | Submit a Jira paste or configure a Figma source first                                             |
| `ssrf_disallowed_host`                      | Configured `baseUrl` does not match the actual Jira API host | Check `baseUrl` matches your Jira Cloud subdomain exactly                                         |
| `jira_issue_key_invalid`                    | Issue key format invalid                                     | Key must match `^[A-Z][A-Z0-9]+-[1-9][0-9]*$` and be ≤ 64 chars                                   |
| `adf_payload_too_large`                     | ADF JSON exceeds 1 MiB                                       | The Jira issue has an unusually large description; use paste mode with only the relevant sections |
| 401 from paste route                        | Bearer token mismatch                                        | Verify `WORKSPACE_TI_REVIEW_BEARER_TOKEN` matches the token in `Authorization: Bearer <token>`    |
| 503 from paste route                        | Bearer token not configured                                  | Set `reviewBearerToken` or `reviewPrincipals` in `WorkspaceStartOptions.testIntelligence`         |

---

## 11. See also

- `docs/test-intelligence.md` §14 — Wave 4 multi-source gate
- `docs/runbooks/multi-source-air-gap.md` — paste-only deployment
- `docs/dpia/jira-source.md` — DPIA addendum (data categories and redaction)
- `docs/dora/multi-source.md` — DORA Art. 28 ICT third-party risk
- `COMPATIBILITY.md` — multi-source source-mix matrix
