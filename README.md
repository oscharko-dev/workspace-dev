# workspace-dev

Autonomous local Workspace runtime for REST-based deterministic Figma-to-code generation.

`workspace-dev` runs directly in a customer project as a dev dependency and does **not** require the full Workspace Dev platform backend stack.

## Prerequisites

- Node.js `>=22.0.0`
- npm `>=10` or pnpm `>=10`

## Installation

```bash
npm install --save-dev workspace-dev
```

## Quickstart

```bash
npx workspace-dev start
```

Default runtime URL: `http://127.0.0.1:1983/workspace`

- UI: `http://127.0.0.1:1983/workspace/ui`
- Deep link by file key: `http://127.0.0.1:1983/workspace/<figmaFileKey>`

## Frontend stack

The workspace UI is implemented as a Vite + React + TypeScript + Tailwind app:

- Vite 8 build output is emitted into `dist/ui`
- Runtime serves `index.html` and hashed bundles under `/workspace/ui/assets/*`
- API contracts remain unchanged (`/workspace`, `/healthz`, `/workspace/submit`, `/workspace/jobs/*`)

Useful scripts:

- `pnpm run ui:dev`
- `pnpm run ui:build`
- `pnpm run ui:typecheck`
- `pnpm run ui:lint`
- `pnpm run ui:test`
- `pnpm run ui:test:e2e`

## Scope and mode lock

`workspace-dev` enforces:

- `figmaSourceMode=rest`
- `llmCodegenMode=deterministic`

Not available:

- MCP (`figmaSourceMode=mcp`)
- Hybrid modes
- `llm_strict`

## Required submit input

- `figmaFileKey`
- `figmaAccessToken`

Optional Git/PR input:

- `enableGitPr` (default `false`)
- `repoUrl` (required only when `enableGitPr=true`)
- `repoToken` (required only when `enableGitPr=true`)
- `projectName` (optional)
- `targetPath` (optional, defaults to `figma-generated`)

With `enableGitPr=false`, generation is local-only.

## Runtime API

- `GET /workspace` - runtime status
- `GET /healthz` - health check
- `GET /workspace/:figmaFileKey` - deep-link to workspace UI for a Figma file key
- `POST /workspace/submit` - start autonomous generation (`202 Accepted`)
- `GET /workspace/jobs/:id` - job polling (stages/logs/artifacts)
- `GET /workspace/jobs/:id/result` - compact result payload
- `GET /workspace/repros/:id/` - generated local preview

## Output layout

By default, generated files are written under:

- `.workspace-dev/jobs/<jobId>/generated-app`
- `.workspace-dev/jobs/<jobId>/figma.json`
- `.workspace-dev/jobs/<jobId>/design-ir.json`
- `.workspace-dev/repros/<jobId>/`
- `.workspace-dev/jobs/<jobId>/repo/` (only when `enableGitPr=true`)

## CLI

```bash
workspace-dev start [options]
```

### Options

- `--port <port>` (default `1983`)
- `--host <host>` (default `127.0.0.1`)
- `--output-root <path>` (default `.workspace-dev`)
- `--figma-timeout-ms <ms>` (default `30000`)
- `--figma-retries <count>` (default `3`)
- `--preview <true|false>` (default `true`)
- `--perf-validation <true|false>` (default `false`, runs template `perf:assert` in `validate.project`)

### Environment variables

- `FIGMAPIPE_WORKSPACE_PORT`
- `FIGMAPIPE_WORKSPACE_HOST`
- `FIGMAPIPE_WORKSPACE_OUTPUT_ROOT`
- `FIGMAPIPE_WORKSPACE_FIGMA_TIMEOUT_MS`
- `FIGMAPIPE_WORKSPACE_FIGMA_RETRIES`
- `FIGMAPIPE_WORKSPACE_ENABLE_PREVIEW`
- `FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION`
- `FIGMAPIPE_ENABLE_PERF_VALIDATION` (legacy alias)

## Web performance workflow

Bundled template (`template/react-mui-app`) includes a baseline + assertion pipeline:

- `pnpm --dir template/react-mui-app run perf:baseline`
- `pnpm --dir template/react-mui-app run perf:assert`

Artifacts are written to `template/react-mui-app/artifacts/performance` by default.
Budget policy is configured in `template/react-mui-app/perf-budget.json`.
Detailed operating notes: `docs/react-web-performance.md`.

## Example API flow

```bash
curl -sS -X POST http://127.0.0.1:1983/workspace/submit \
  -H 'content-type: application/json' \
  -d '{
    "figmaFileKey":"demo-file-key",
    "figmaAccessToken":"figd_...",
    "enableGitPr": false,
    "figmaSourceMode":"rest",
    "llmCodegenMode":"deterministic"
  }'
```

Then poll:

```bash
curl -sS http://127.0.0.1:1983/workspace/jobs/<jobId>
```

## Security notes

- Tokens are used in process memory for runtime execution.
- Token-like values are redacted in public job logs and error surfaces.
- If `enableGitPr=true`, a temporary authenticated clone is created under `.workspace-dev/jobs/<jobId>/repo/` during execution; treat the output root as sensitive local state.
- Local runtime defaults to `127.0.0.1`.

## Migration note (v1.0.0)

- The legacy CLI alias was removed.
- Use `workspace-dev` exclusively:

```bash
npx workspace-dev start
```
