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
- GitHub release notes and signed evidence assets (SBOM): https://github.com/oscharko-dev/workspace-dev/releases
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

## Repository branch flow

- `dev` is the active development branch.
- `dev-gate` is the protected quality gate branch.
- `main` is the release branch.
- See [GOVERNANCE.md](GOVERNANCE.md) for the full `dev -> dev-gate -> main`
  promotion policy and [`THREAT_MODEL.md`](THREAT_MODEL.md) for the trust
  boundaries that inform runtime and release controls.

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
- `figmaSourceMode=hybrid`
- `figmaSourceMode=local_json`
- `figmaSourceMode=figma_paste`
- `figmaSourceMode=figma_plugin`
- `llmCodegenMode=deterministic`

Not available:

- MCP (`figmaSourceMode=mcp`)
- `figmaSourceMode=mcp` is blocked in the package runtime
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

## Public API entrypoints

- Root runtime entrypoint: `workspace-dev`
- Contract surface: `workspace-dev/contracts`
- Generated API docs: [docs/api/README.md](docs/api/README.md)
- Troubleshooting: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- Figma direct import:
  [docs/figma-import.md - Quality and governance](docs/figma-import.md#quality-and-governance)
- Default pipeline authoring:
  [docs/default-pipeline/pipeline-authoring-and-migration.md](docs/default-pipeline/pipeline-authoring-and-migration.md)
- Default demo guide:
  [docs/default-pipeline/default-demo-guide.md](docs/default-pipeline/default-demo-guide.md)
- Multi-source API:
  [docs/api/test-intelligence-multi-source.md](docs/api/test-intelligence-multi-source.md)
- Jira setup runbook:
  [docs/runbooks/jira-source-setup.md](docs/runbooks/jira-source-setup.md)
- Multi-source air-gap runbook:
  [docs/runbooks/multi-source-air-gap.md](docs/runbooks/multi-source-air-gap.md)

## Programmatic API

TypeScript `>=5.0.0` for typed package consumption is required. The published dual ESM/CJS type surface is validated only for TypeScript 5+ consumers.

```ts
import { createWorkspaceServer } from "workspace-dev";
import { validateModeLock } from "workspace-dev";
import type { WorkspaceStartOptions } from "workspace-dev/contracts";
import type { WorkspaceJobInput, WorkspaceFigmaSourceMode } from "workspace-dev/contracts";

const options: WorkspaceStartOptions = {
  host: "127.0.0.1",
  port: 1983,
  figmaSourceMode: "rest",
  llmCodegenMode: "deterministic",
};

validateModeLock({
  figmaSourceMode: "mcp",
  llmCodegenMode: "deterministic",
});

await createWorkspaceServer(options);
```

Use `workspace-dev/contracts` for contract-typed request and artifact
structures, including `type WorkspaceJobInput`, `type WorkspaceFigmaSourceMode`,
and `CONTRACT_VERSION`.

### Advanced isolation lifecycle API

`ProjectInstance` is a stable advanced surface for embedders and orchestration
hosts; it is not experimental or internal-only today.

Per-project helpers:

- `createProjectInstance`
- `getProjectInstance`
- `listProjectInstances`
- `removeProjectInstance`
- `removeAllInstances`

Process-level lifecycle controls:

- `registerIsolationProcessCleanup`
- `unregisterIsolationProcessCleanup`

Typical consumers should still prefer `createWorkspaceServer` unless they need
fine-grained isolation orchestration.

## Runtime API

- `GET /workspace` - runtime status
- `GET /healthz` - health check
- `GET /workspace/:figmaFileKey` - deep-link to workspace UI for a Figma file key
- `POST /workspace/submit` - start autonomous generation (`202 Accepted`)
- `GET /workspace/jobs/:id` - job polling (stages/logs/artifacts)
- `GET /workspace/jobs/:id/result` - compact result payload
- `GET /workspace/repros/:id/` - generated local preview
- `GET /workspace/inspector-policy` - repo-backed inspector policy loader payload (`{ policy, validation, warning? }`)

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

## Operational Hardening

- The default loopback bind (`127.0.0.1:1983`) is the recommended local
  runtime posture.
- `local_json` is the preferred air-gap and firewall-friendly source mode.
- Repository-only verification fixtures, test suites, template `node_modules`, and template build output do not ship in the published package.

## Versioning strategy

- Pin the npm package version in your own `package.json`.
- Use `CONTRACT_VERSION` for compatibility audits.
- `CHANGELOG.md` tracks package release history.
- `CONTRACT_CHANGELOG.md` tracks public contract history.
- See `VERSIONING.md` for the package-versus-contract policy.

## Migration

See the [contract migration guide](docs/migration-guide.md).

Legacy omitted-`pipelineId` requests with Rocket-specific inputs follow the deprecated compatibility fallback documented in the migration guide. The omitted-`pipelineId` Rocket auto-selection path is a temporary compatibility bridge and may be removed in a future package-major release.

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
