# OpenText / HP ALM adapter

**Adapter id:** `alm`  
**Module:** `src/test-intelligence/tms-adapters/alm-adapter.ts`  
**Issue:** [#2183](https://github.com/oscharko-dev/workspace-dev/issues/2183)

## What it does

Pushes test cases into an OpenText ALM (formerly HP ALM) v12+ tenant
via the REST API. Unlike Atlassian/Tricentis tools, ALM is
session-oriented: the adapter performs a Basic-auth handshake to mint
an `LWSSO_COOKIE_KEY` cookie, opens a QC session for `QCSession` +
`XSRF-TOKEN`, then threads those cookies through every subsequent
write.

| Method | Endpoint | Notes |
| --- | --- | --- |
| `connect` | `POST /authentication-point/authenticate` then `POST /qcbin/rest/site-session` | mints LWSSO + QCSession |
| `validateProject` | `GET /qcbin/rest/domains/{d}/projects/{p}` | fail-closed on 404 |
| `mapTestCase` | — | pure (no I/O) |
| `pushTestCase` | `GET .../tests?query={name[...]}` then `POST .../tests` | lookup-by-name dedupes via idempotency-prefixed name |
| `pushTestCaseBatch` | per-case (cap 50) | bulk endpoint TBD |
| `pollSyncStatus` | `GET .../tests/{id}` | round-trip evidence |
| `disconnect` | `POST /qcbin/rest/site-session/sign-out` | best-effort |

Idempotency: ALM has no native `Idempotency-Key` header, so the
adapter prefixes the test name with the SHA-256 first 12 chars of
`(tenantId, runId, testCaseId)` and looks up by that exact name
before issuing the create. A re-run finds the prior entity and
short-circuits to `skipped-dup`.

## Authentication

ALM accepts PAT or Bearer; OAuth 2.0 is NOT supported by the tenant
in v12.

```bash
# OpenText ALM 12.55+ Personal Access Token
WORKSPACE_TEST_SPACE_TMS_ALM_TOKEN

# OpenText ALM 16+ Bearer
WORKSPACE_TEST_SPACE_TMS_ALM_BEARER
```

The adapter sends the token as `Authorization: Bearer <token>` to the
authentication endpoint; ALM mints the LWSSO cookie in response. The
token is NEVER persisted to the report.

## Endpoint resolution

```bash
WORKSPACE_TEST_SPACE_TMS_ALM_BASE_URL=https://your-tenant.opentext.com
```

For multi-tenant ALM:

```bash
WORKSPACE_TEST_SPACE_TMS_ALM_PROD_BASE_URL=https://prod.opentext.com
WORKSPACE_TEST_SPACE_TMS_ALM_QA_BASE_URL=https://qa.opentext.com
```

## Project mapping

Pass `--project <domain>/<project>` (e.g. `DEFAULT/banking-checkout`).
The adapter rejects any other shape with `invalid_project_id`.

| ALM field | Workspace-dev source | Notes |
| --- | --- | --- |
| `name` | `[<idemPrefix>] entry.testName` | enforces idempotency lookup |
| `description` | HTML wrapping of `entry.objective` + preconditions + test data | escaped |
| `subtype-id` | constant `MANUAL` | |
| `priority` | `entry.priority` mapped to ALM `1-Low..5-Urgent` | P0→`5-Urgent`, P4→`1-Low` |
| `user-01` | `entry.riskCategory` | mapped onto the user-defined risk-category field |
| `owner-mode` | constant `test_owner` | |
| `designSteps[]` | `entry.designSteps` | `{ step-order, step-name, description, expected }` |

If your tenant overrides the `user-01` slot, fork the adapter and
adjust `buildAlmCreatePayload` in `alm-adapter.ts`.

## CLI

```bash
pnpm exec tsx src/cli.ts test-intelligence tms-push \
  --run-dir .workspace-dev/run-2026-05-11 \
  --tms alm \
  --project DEFAULT/banking-checkout \
  --tenant tenant-eu-west-1 \
  [--endpoint alm-prod] \
  [--batch-size 50] \
  [--dry-run]
```

## Failure modes

Standard for the family — see [xray.md](xray.md#failure-modes). ALM
specific:

- `invalid_project_id` (validation): the `--project` value did not
  match `<domain>/<project>`.
- `session_credentials_unbound`: a programmer error — the adapter
  returned a session without registering credentials. Should never
  occur in production.
- The `disconnect` sign-out call is best-effort: a tenant rejecting
  it does NOT fail the run, since the report is the source of truth.
