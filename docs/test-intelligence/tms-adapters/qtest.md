# Tricentis qTest adapter

**Adapter id:** `qtest`  
**Module:** `src/test-intelligence/tms-adapters/qtest-adapter.ts`  
**Issue:** [#2183](https://github.com/oscharko-dev/workspace-dev/issues/2183)

## What it does

Pushes test cases into a Tricentis qTest Manager v3 tenant.

| Method | Endpoint | Notes |
| --- | --- | --- |
| `connect` | `GET /api/v3/users/current` | bearer probe |
| `validateProject` | `GET /api/v3/projects/{id}` | fail-closed on 404 |
| `mapTestCase` | — | pure (no I/O) |
| `pushTestCase` | `POST /api/v3/projects/{id}/test-cases` | dedupes via `Idempotency-Key` (qTest returns 409 with prior id) |
| `pushTestCaseBatch` | per-case (cap 50) | bulk endpoint TBD |
| `pollSyncStatus` | `GET /api/v3/projects/{id}/test-cases/{id}` | reads `approve_status` |
| `disconnect` | — | stateless |

## Authentication

qTest tokens are short-lived; OAuth 2.0 is the recommended flow.

```bash
# qTest OAuth 2.0 access token (preferred)
WORKSPACE_TEST_SPACE_TMS_QTEST_OAUTH_ACCESS_TOKEN
WORKSPACE_TEST_SPACE_TMS_QTEST_OAUTH_REFRESH_TOKEN  # optional companion

# qTest PAT
WORKSPACE_TEST_SPACE_TMS_QTEST_TOKEN

# Plain bearer
WORKSPACE_TEST_SPACE_TMS_QTEST_BEARER
```

## Endpoint resolution

```bash
WORKSPACE_TEST_SPACE_TMS_QTEST_BASE_URL=https://your-tenant.qtestnet.com
```

## Project mapping

Pass `--project <numeric-id>` (qTest project ids are integers exposed
via the project listing endpoint).

| qTest field | Workspace-dev source | Notes |
| --- | --- | --- |
| `name` | `entry.testName` | |
| `description` | HTML-escaped objective + expected results | |
| `precondition` | `entry.preconditions` joined with `\n` | |
| `properties[]` | priority + risk-category as `{ field_id, field_value }` | qTest custom fields |
| `test_steps[]` | `entry.designSteps` | `{ order, description, expected }` |
| `external_id` | idempotency key | round-trip lookup |

## CLI

```bash
pnpm exec tsx src/cli.ts test-intelligence tms-push \
  --run-dir .workspace-dev/run-2026-05-11 \
  --tms qtest \
  --project 1234 \
  --tenant tenant-eu-west-1 \
  [--endpoint qtest-prod] \
  [--batch-size 50] \
  [--dry-run]
```

## Failure modes

Standard for the family — see [xray.md](xray.md#failure-modes). qTest
specific:

- HTTP 409 from `POST .../test-cases` is treated as `skipped-dup`
  (qTest's documented dedupe behaviour). The prior id appears in the
  response body and is recorded on the report.
