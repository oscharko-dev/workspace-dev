# workspace-dev

[![npm version](https://img.shields.io/npm/v/workspace-dev?label=npm)](https://www.npmjs.com/package/workspace-dev)
[![GitHub release](https://img.shields.io/github/v/release/oscharko-dev/workspace-dev?display_name=tag)](https://github.com/oscharko-dev/workspace-dev/releases)
[![release publish](https://img.shields.io/github/actions/workflow/status/oscharko-dev/workspace-dev/changesets-release.yml?branch=main&label=release%20publish)](https://github.com/oscharko-dev/workspace-dev/actions/workflows/changesets-release.yml)
[![dev quality](https://img.shields.io/github/actions/workflow/status/oscharko-dev/workspace-dev/dev-quality-gate.yml?branch=dev&label=dev%20quality)](https://github.com/oscharko-dev/workspace-dev/actions/workflows/dev-quality-gate.yml)
[![Node >=22](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MIT License](https://img.shields.io/github/license/oscharko-dev/workspace-dev)](https://github.com/oscharko-dev/workspace-dev/blob/dev/LICENSE)

Autonomous local Workspace runtime for REST-based deterministic Figma-to-code generation.

`workspace-dev` runs directly in a customer project as a dev dependency and does **not** require the full Workspace Dev platform backend stack.

## Package and release channels

- npm distribution (authoritative): https://www.npmjs.com/package/workspace-dev
- GitHub release notes and signed evidence assets (SBOM/OpenVEX): https://github.com/oscharko-dev/workspace-dev/releases
- GitHub Packages is intentionally not used for `workspace-dev` distribution.

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

Optional token branding input:

- `brandTheme` (optional: `derived` or `sparkasse`; defaults to server runtime setting)
- `generationLocale` (optional BCP 47 locale string; defaults to server runtime setting, fallback `de-DE`)

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
- `.workspace-dev/jobs/<jobId>/generated-app/public/images/*` (when image export is enabled and image candidates exist)
- `.workspace-dev/icon-fallback-map.json` (auto-bootstrapped fallback icon mapping catalog)

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
- `--figma-bootstrap-depth <n>` (default `5`)
- `--figma-node-batch-size <n>` (default `6`)
- `--figma-node-fetch-concurrency <n>` (default `3`)
- `--figma-adaptive-batching <true|false>` (default `true`)
- `--figma-max-screen-candidates <n>` (default `40`)
- `--figma-screen-name-pattern <regex>` (default unset, case-insensitive include-filter for staged candidate names)
- `--no-cache` (default `false`, disables figma.source file-system cache)
- `--figma-cache-ttl-ms <ms>` (default `900000`)
- `--icon-map-file <path>` (default `<outputRoot>/icon-fallback-map.json`)
- `--export-images <true|false>` (default `true`; exports Figma image assets to `generated-app/public/images`)
- `--figma-screen-element-budget <n>` (default `1200`)
- `--figma-screen-element-max-depth <n>` (default `14`)
- `--brand <derived|sparkasse>` (default `derived`)
- `--generation-locale <locale>` (default `de-DE`)
- `--router <browser|hash>` (default `browser`)
- `--command-timeout-ms <ms>` (default `900000`)
- `--ui-validation <true|false>` (default `false`)
- `--install-prefer-offline <true|false>` (default `true`)
- `--skip-install <true|false>` (default `false`; expert mode, requires pre-existing `generated-app/node_modules`)
- `--preview <true|false>` (default `true`)
- `--perf-validation <true|false>` (default `false`, runs template `perf:assert` in `validate.project`)

### Environment variables

- `FIGMAPIPE_WORKSPACE_PORT`
- `FIGMAPIPE_WORKSPACE_HOST`
- `FIGMAPIPE_WORKSPACE_OUTPUT_ROOT`
- `FIGMAPIPE_WORKSPACE_FIGMA_TIMEOUT_MS`
- `FIGMAPIPE_WORKSPACE_FIGMA_RETRIES`
- `FIGMAPIPE_WORKSPACE_FIGMA_BOOTSTRAP_DEPTH`
- `FIGMAPIPE_WORKSPACE_FIGMA_NODE_BATCH_SIZE`
- `FIGMAPIPE_WORKSPACE_FIGMA_NODE_FETCH_CONCURRENCY`
- `FIGMAPIPE_WORKSPACE_FIGMA_ADAPTIVE_BATCHING`
- `FIGMAPIPE_WORKSPACE_FIGMA_MAX_SCREEN_CANDIDATES`
- `FIGMAPIPE_WORKSPACE_FIGMA_SCREEN_NAME_PATTERN`
- `FIGMAPIPE_WORKSPACE_NO_CACHE`
- `FIGMAPIPE_WORKSPACE_FIGMA_CACHE_TTL_MS`
- `FIGMAPIPE_WORKSPACE_ICON_MAP_FILE`
- `FIGMAPIPE_WORKSPACE_EXPORT_IMAGES`
- `FIGMAPIPE_WORKSPACE_FIGMA_SCREEN_ELEMENT_BUDGET`
- `FIGMAPIPE_WORKSPACE_FIGMA_SCREEN_ELEMENT_MAX_DEPTH`
- `FIGMAPIPE_WORKSPACE_BRAND`
- `FIGMAPIPE_WORKSPACE_GENERATION_LOCALE`
- `FIGMAPIPE_WORKSPACE_ROUTER`
- `FIGMAPIPE_WORKSPACE_COMMAND_TIMEOUT_MS`
- `FIGMAPIPE_WORKSPACE_ENABLE_UI_VALIDATION`
- `FIGMAPIPE_WORKSPACE_INSTALL_PREFER_OFFLINE`
- `FIGMAPIPE_WORKSPACE_SKIP_INSTALL`
- `FIGMAPIPE_WORKSPACE_ENABLE_PREVIEW`
- `FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION`
- `FIGMAPIPE_ENABLE_PERF_VALIDATION` (legacy alias)

When `skipInstall` is enabled and `generated-app/node_modules` is missing, `validate.project` fails fast with a deterministic error message.

### Router mode

Use `--router <browser|hash>` (or `FIGMAPIPE_WORKSPACE_ROUTER`) to control the generated `App.tsx` router:

- `browser` (default): clean URLs like `/dashboard`; deployment requires SPA rewrites so app routes resolve to `index.html`.
- `hash`: compatibility mode with URLs like `/#/dashboard`; no server-side rewrites are required.

For local preview (`/workspace/repros/:jobId/*`), generated BrowserRouter apps auto-resolve a matching `basename` so deep links continue to work under the preview path.

## Web performance workflow

Bundled template (`template/react-mui-app`) includes a baseline + assertion pipeline:

- `pnpm --dir template/react-mui-app run perf:baseline`
- `pnpm --dir template/react-mui-app run perf:assert`

Artifacts are written to `template/react-mui-app/artifacts/performance` by default.
Budget policy is configured in `template/react-mui-app/perf-budget.json`.
Detailed operating notes: `docs/react-web-performance.md`.

## React Compiler (template opt-in)

Generated template builds can enable React Compiler via environment variables:

- `VITE_ENABLE_REACT_COMPILER=true`
- optional `VITE_REACT_COMPILER_TARGET=18|19`

## Example API flow

```bash
curl -sS -X POST http://127.0.0.1:1983/workspace/submit \
  -H 'content-type: application/json' \
  -d '{
    "figmaFileKey":"demo-file-key",
    "figmaAccessToken":"figd_...",
    "brandTheme":"derived",
    "generationLocale":"en-US",
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
