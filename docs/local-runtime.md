# Local Runtime

`workspace-dev` runs as a local-only runtime for deterministic generation and validation inside the current repository.

## Mode lock

Enforce mode lock (`rest|hybrid|local_json|figma_paste|figma_plugin` + `deterministic`) for all local runtime entry points.

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
