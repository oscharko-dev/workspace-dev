# Jira Xray adapter

**Adapter id:** `xray`  
**Module:** `src/test-intelligence/tms-adapters/xray-adapter.ts`  
**Issue:** [#2183](https://github.com/oscharko-dev/workspace-dev/issues/2183)

## What it does

Pushes approved + mapped test cases from a workspace-dev run into a
Jira Xray tenant via Jira REST + Xray REST. Implements the
production-grade `TmsAdapter` contract from
[`tms-adapter-contract.ts`](../../../src/test-intelligence/tms-adapters/tms-adapter-contract.ts):

| Method | Endpoint | Notes |
| --- | --- | --- |
| `connect` | `GET /rest/api/3/myself` | bearer probe |
| `validateProject` | `GET /rest/api/3/project/{key}` | fail-closed on 404 |
| `mapTestCase` | — | pure (no I/O) |
| `pushTestCase` | `POST /rest/raven/2.0/api/import/test` | dedupes via `Idempotency-Key` |
| `pushTestCaseBatch` | per-case (cap 50) | bulk endpoint TBD |
| `pollSyncStatus` | `GET /rest/api/3/issue/{key}` | round-trip evidence |
| `disconnect` | — | stateless |

Idempotency: each push attempt sends an `Idempotency-Key` header
derived from `sha256(tenantId|runId|testCaseId)`. A retried request
returns the prior issue id with `deduplicated: true`, which the
adapter records as `skipped-dup` on the report.

## Authentication

Set ONE of the following environment variables (the loader uses the
first non-empty value, in the order shown):

```bash
# Jira PAT (preferred — Atlassian Personal Access Token)
WORKSPACE_TEST_SPACE_TMS_XRAY_TOKEN

# Jira OAuth 2.0 access token (rotates more frequently)
WORKSPACE_TEST_SPACE_TMS_XRAY_OAUTH_ACCESS_TOKEN
WORKSPACE_TEST_SPACE_TMS_XRAY_OAUTH_REFRESH_TOKEN  # optional companion

# Plain bearer (least preferred)
WORKSPACE_TEST_SPACE_TMS_XRAY_BEARER
```

The adapter NEVER prints, persists, or echoes the token in the push
report or CLI output.

## Endpoint resolution

Set the Jira base URL via:

```bash
WORKSPACE_TEST_SPACE_TMS_XRAY_BASE_URL=https://your-tenant.atlassian.net
```

When you operate multiple Xray endpoints (e.g. EU + US), suffix the
alias instead:

```bash
WORKSPACE_TEST_SPACE_TMS_XRAY_PROD_EU_BASE_URL=https://eu.your-tenant.atlassian.net
# then push with --endpoint xray-prod-eu
```

## Project mapping

| Xray field | Workspace-dev source | Notes |
| --- | --- | --- |
| `fields.project.key` | CLI `--project` | Jira project key (e.g. `BANK`) |
| `fields.summary` | `entry.testName` | |
| `fields.description` | `entry.objective` + numbered design steps | Wiki markup |
| `fields.issuetype.name` | constant `Test` | |
| `fields.priority.name` | `entry.priority` mapped to Xray `Highest..Lowest` | P0→Highest, P4→Lowest |
| `fields.labels` | `entry.riskCategory` + sanitised `blockingReasons` | sorted, deduped, capped at 60 chars |
| `customfield_test_type` | constant `Manual` | Xray-specific custom field |
| `manualTestSteps[]` | `entry.designSteps` | `{ index, action, data, result }` |

If your tenant uses a non-default Test Type custom field id, fork the
adapter and replace `customfield_test_type` — the field name lives at
`xray-adapter.ts:308` (`buildXrayCreatePayload`).

## CLI

```bash
pnpm exec tsx src/cli.ts test-intelligence tms-push \
  --run-dir .workspace-dev/run-2026-05-11 \
  --tms xray \
  --project BANK \
  --tenant tenant-eu-west-1 \
  [--endpoint xray-prod-eu] \
  [--batch-size 50] \
  [--dry-run]
```

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | push completed, report written |
| 1 | operator/config error (missing flag, no credentials) |
| 2 | pipeline refused (e.g. project not found) — report still written |

## Failure modes

| HTTP status | Adapter class | Retried? |
| --- | --- | --- |
| 401, 403 | `TmsAuthError` | NO (fail fast) |
| 400, 404, 409, 422 | `TmsValidationError` | NO (fail fast) |
| 429 | `TmsRateLimitError` | YES (obeys `Retry-After`) |
| 5xx, transport | `TmsTransportError` | YES (exponential backoff + jitter) |

The orchestrator records every per-case failure with the sanitised
`tmsErrorCode` + `tmsErrorMessage` so an auditor can see exactly what
the tenant rejected without leaking URLs or tokens.

## Round-trip evidence

The persisted `tms-push-report.json` includes the assigned Xray issue
key for every `pushed` and `skipped-dup` entry:

```json
{
  "adapterId": "xray",
  "entries": [
    { "testCaseId": "tc-1", "verdict": "pushed", "tmsTestCaseId": "BANK-1234" },
    { "testCaseId": "tc-2", "verdict": "skipped-dup", "tmsTestCaseId": "BANK-1235" }
  ]
}
```

Auditors call `pollSyncStatus` to confirm the issue still exists in
the tenant.
