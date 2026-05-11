# Siemens Polarion adapter

**Adapter id:** `polarion`  
**Module:** `src/test-intelligence/tms-adapters/polarion-adapter.ts`  
**Issue:** [#2183](https://github.com/oscharko-dev/workspace-dev/issues/2183)

## What it does

Pushes test cases into a Siemens Polarion ALM tenant via the
JSON:API REST surface. Polarion is intentionally two-protocol:

- **REST** for work-item CRUD (this adapter's primary surface).
- **WebDAV** for binary attachments (optional companion client).

When the optional `polarionWebDav` client is omitted, attachment
upload is skipped silently and the per-case verdict still records
`pushed`. Operators that need attachments must wire WebDAV
explicitly; see [WebDAV credentials](#webdav-credentials) below.

| Method | Endpoint | Notes |
| --- | --- | --- |
| `connect` | `GET /polarion/rest/v1/projects?page[size]=1` | bearer probe |
| `validateProject` | `GET /polarion/rest/v1/projects/{id}` | fail-closed on 404 |
| `mapTestCase` | — | pure (no I/O) |
| `pushTestCase` | `POST /polarion/rest/v1/projects/{id}/workitems` | dedupes via deterministic `data.id` (200 → `skipped-dup`, 201 → `pushed`) |
| `pushTestCaseBatch` | per-case (cap 50) | bulk endpoint TBD |
| `pollSyncStatus` | `GET .../workitems/{id}` | reads `attributes.status` |
| `disconnect` | — | stateless |

## Authentication

```bash
# Polarion 21+ Personal Access Token (preferred)
WORKSPACE_TEST_SPACE_TMS_POLARION_TOKEN

# Generic Bearer
WORKSPACE_TEST_SPACE_TMS_POLARION_BEARER
```

OAuth 2.0 is NOT supported by Polarion's REST surface.

## Endpoint resolution

```bash
WORKSPACE_TEST_SPACE_TMS_POLARION_BASE_URL=https://your-tenant.polarion.com
```

## WebDAV credentials

Polarion's attachment surface lives at
`PUT /polarion/dav/{projectId}/{workItemId}/{filename}` and uses the
same Bearer token. To enable attachment writes, supply a
`PolarionWebDavClient` to `createPolarionAdapter`:

```ts
import { createPolarionAdapter } from "./tms-adapters/polarion-adapter.js";

const adapter = createPolarionAdapter({
  http,
  polarionWebDav: createMyPolarionWebDavClient(),
});
```

The default CLI does NOT wire a WebDAV client — operators that need
attachments must call the adapter from a custom entry point. The
Wave 8 CLI focuses on text-only push to keep the surface narrow.

## Project mapping

Pass `--project <id>` (Polarion project ids are short string slugs
exposed via the project listing endpoint).

| Polarion field | Workspace-dev source | Notes |
| --- | --- | --- |
| `data.id` | first 12 hex chars of idempotency key | enforces dedupe |
| `data.type` | constant `workitems` | |
| `data.attributes.title` | `entry.testName` | |
| `data.attributes.type` | constant `testcase` | |
| `data.attributes.description` | `{ type: "text/html", value: <html> }` | |
| `data.attributes.severity` | priority mapped to `must_have/should_have/nice_to_have` | P0,P1→must_have; P2→should_have; P3,P4→nice_to_have |
| `data.attributes.status` | constant `proposed` | reviewer transitions to `approved` |
| `data.attributes.testSteps[]` | `entry.designSteps` | `{ order, action, expectedResult }` |

## CLI

```bash
pnpm exec tsx src/cli.ts test-intelligence tms-push \
  --run-dir .workspace-dev/run-2026-05-11 \
  --tms polarion \
  --project banking-project \
  --tenant tenant-eu-west-1 \
  [--endpoint polarion-prod] \
  [--batch-size 50] \
  [--dry-run]
```

## Failure modes

Standard for the family — see [xray.md](xray.md#failure-modes).
Polarion specific:

- HTTP 200 from `POST .../workitems` is treated as `skipped-dup`
  (Polarion's documented idempotent dedupe path). HTTP 201 is `pushed`.
- The deterministic `data.id` is the SHA-256 first 12 chars of the
  idempotency key — keep your `(tenantId, runId, testCaseId)` triples
  stable across re-runs to preserve dedupe.
