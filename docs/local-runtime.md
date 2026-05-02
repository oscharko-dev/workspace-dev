# Local Runtime

`workspace-dev` runs as a local-only runtime for deterministic generation and validation inside the current repository.

## Mode lock

Enforce mode lock (`rest|hybrid|local_json|figma_paste|figma_plugin` + `deterministic`) for all local runtime entry points.

## Figma MCP resolver cache scope

The Figma MCP resolver caches both completed payloads and in-flight de-duplication
promises in the runtime process. To preserve confidentiality boundaries when more
than one job runs concurrently against different Figma access tokens, the cache
key is scoped per token.

The cache key is `${fileKey}:${nodeId}:${version}:${tokenScope}`, where
`tokenScope` is the first 16 hex characters of `sha256(accessToken)` — opaque,
non-reversible, and never reconstructable back into the token. Jobs without an
access token use a distinct `anon` scope so anonymous and authenticated payloads
never share an entry.

A new payload resolved under token A is therefore never served to a job
authenticated under token B, even when both reference the same `fileKey:nodeId`.
Regression coverage lives in
`src/job-engine/figma-mcp-resolver.token-isolation.test.ts` (issue #1669,
audit-2026-05 Wave 8a).

## Test-intelligence visual sidecar smoke

The Figma-to-QC test-intelligence path is opt-in. Runtime routes remain disabled
unless both the startup option `testIntelligence.enabled=true` and
`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1` are set.

The Wave 1 visual sidecar smoke test is also disabled by default. It exercises
the role-separated model setup for screenshot understanding:

- `WORKSPACE_TEST_SPACE_MODEL_ENDPOINT`
- `WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT`
- `WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT`
- `WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT`
- `WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT`
- `WORKSPACE_TEST_SPACE_API_KEY` _or_ `WORKSPACE_TEST_SPACE_MODEL_API_KEY`
  (Issue #1660 alias; the live smoke accepts either, with
  `WORKSPACE_TEST_SPACE_API_KEY` taking precedence when both are set)

Run the operator-controlled smoke only from an environment that already has the
API key in process memory:

```bash
pnpm run test:ti-live-smoke
```

Expected role bindings are:

| Role                            | Deployment                |
| ------------------------------- | ------------------------- |
| Structured test-case generation | `gpt-oss-120b`            |
| Primary visual sidecar          | `llama-4-maverick-vision` |
| Fallback visual sidecar         | `phi-4-multimodal-poc`    |

The default CI path uses deterministic mocks and fixture captures instead of
live network calls. Evidence artifacts store deployment names, schema versions,
policy decisions, SHA-256 hashes, and confidence summaries. They must not store
raw screenshots, local filesystem paths, API keys, bearer tokens, or other
secret values.
