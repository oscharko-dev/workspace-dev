---
"workspace-dev": minor
---

Add production-grade TMS adapters for Jira Xray, OpenText/HP ALM,
Tricentis qTest, and Siemens Polarion (Issue #2183, Wave 8).

- New `src/test-intelligence/tms-adapters/` module exposing the
  provider-neutral `TmsAdapter` contract (`connect`, `validateProject`,
  `mapTestCase`, `pushTestCase`, `pushTestCaseBatch`, `pollSyncStatus`,
  `disconnect`) plus four adapter implementations and a default
  `node:fetch`-backed `TmsHttpClient`.
- Each adapter handles per-TMS authentication (PAT, OAuth 2.0, Bearer),
  exponential-backoff retry with jitter for transport + rate-limit
  errors (auth + validation errors fail fast), `Idempotency-Key`-based
  dedupe, and TMS-specific schema mapping (folder hierarchy, custom
  fields, test types, priority enums). Default batch size is 50 cases
  per `pushTestCaseBatch`.
- New CLI subcommand `workspace-dev test-intelligence tms-push
  --run-dir <path> --tms <xray|alm|qtest|polarion> --project <id>
  [--endpoint <alias>] [--tenant <id>] [--run-id <id>]
  [--batch-size <n>] [--dry-run]` that drives the full lifecycle and
  writes a per-run `tms-push-report.json` with per-case verdicts,
  TMS-assigned ids (round-trip evidence), and sanitised failure detail.
- Per-tenant credentials read from
  `WORKSPACE_TEST_SPACE_TMS_<NAME>_TOKEN` /
  `WORKSPACE_TEST_SPACE_TMS_<NAME>_OAUTH_ACCESS_TOKEN` /
  `WORKSPACE_TEST_SPACE_TMS_<NAME>_BEARER` (NAME ∈ {XRAY, ALM, QTEST,
  POLARION}). The adapters NEVER persist or echo the token, the
  resolved URL, or raw response bodies.
- Vendored mock TMS servers under `fixtures/tms-adapters/` for
  offline integration testing of every adapter (`startXrayMockServer`,
  `startAlmMockServer`, `startQtestMockServer`,
  `startPolarionMockServer`).
- Per-adapter operator documentation under
  `docs/test-intelligence/tms-adapters/<adapter>.md` covering
  authentication, endpoint resolution, schema mapping, and failure
  modes.
- New persisted contract `TmsPushReportArtifact` (schema 1.0.0,
  filename `tms-push-report.json`) plus the `TmsAdapterId` /
  `TmsAuthKind` / `TmsPushVerdict` / `TmsPushRefusalCode` value sets.
- Polarion's two-protocol surface (REST + WebDAV) is supported via an
  optional `PolarionWebDavClient` injected at adapter construction;
  the default CLI omits WebDAV so attachment writes are skipped
  silently and the per-case verdict still records `pushed`. Operators
  that need attachments must call the adapter from a custom entry
  point.

Hard invariants on every emitted artifact:
`rawScreenshotsIncluded: false`, `credentialsIncluded: false`,
`transferUrlIncluded: false`.
