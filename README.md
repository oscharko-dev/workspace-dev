# workspace-dev

[![npm version](https://img.shields.io/npm/v/workspace-dev?label=npm)](https://www.npmjs.com/package/workspace-dev)
[![GitHub release](https://img.shields.io/github/v/release/oscharko-dev/workspace-dev?display_name=tag)](https://github.com/oscharko-dev/workspace-dev/releases)
[![release publish](https://img.shields.io/github/actions/workflow/status/oscharko-dev/workspace-dev/changesets-release.yml?branch=main&label=release%20publish)](https://github.com/oscharko-dev/workspace-dev/actions/workflows/changesets-release.yml)
[![dev quality](https://img.shields.io/github/actions/workflow/status/oscharko-dev/workspace-dev/dev-quality-gate.yml?branch=dev&label=dev%20quality)](https://github.com/oscharko-dev/workspace-dev/actions/workflows/dev-quality-gate.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/oscharko-dev/workspace-dev/badge)](https://securityscorecards.dev/viewer/?uri=github.com/oscharko-dev/workspace-dev)
[![Node >=22](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MIT License](https://img.shields.io/github/license/oscharko-dev/workspace-dev)](https://github.com/oscharko-dev/workspace-dev/blob/dev/LICENSE)

Autonomous local Workspace runtime for deterministic Figma-to-code generation via REST, local JSON, or inline paste/plugin payloads.

`workspace-dev` runs directly in a customer project as a dev dependency and does **not** require the full Workspace Dev platform backend stack.

## Package and release channels

- npm distribution (authoritative): https://www.npmjs.com/package/workspace-dev
- GitHub release notes and release evidence assets (SBOM): https://github.com/oscharko-dev/workspace-dev/releases
- GitHub Packages is intentionally not used for `workspace-dev` distribution.

## Versioning strategy

- Pin the npm package version in your own `package.json` when you depend on `workspace-dev`.
- Use `CONTRACT_VERSION` for compatibility audits and contract-specific integration reviews, not for dependency pinning.
- Package version policy and the relationship to `CONTRACT_VERSION` are documented in `VERSIONING.md`.
- `CHANGELOG.md` tracks package release history, while `CONTRACT_CHANGELOG.md` tracks public contract history.
- npm and GitHub Releases are the authoritative sources for published package versions.

## Migration

Use the [contract migration guide](docs/migration-guide.md) when upgrading across
`CONTRACT_VERSION` bumps. It covers programmatic version detection, contract
semver policy, downstream package pinning, and a breaking-change migration
checklist.

Existing customer integrations that depend on the current React + MUI generator,
customer profiles, or storybook-first component mappings should submit jobs with
`pipelineId: "rocket"` explicitly. The current build ships both the OSS
`default` React + TypeScript + Tailwind pipeline and the `rocket` compatibility
pipeline; plain omitted-`pipelineId` jobs resolve to `default`. Legacy
omitted-`pipelineId` requests with Rocket-specific inputs follow the deprecated
compatibility fallback documented in the migration guide.

## Repository branch flow

- `dev` is the active development branch for feature work and contributor pull requests.
- `dev-gate` is the protected quality gate branch; only `dev` may merge into `dev-gate`.
- `main` is the release branch; only `dev-gate` may merge into `main`.

Governance, release authority, maintainer responsibilities, and succession
expectations are documented in [GOVERNANCE.md](GOVERNANCE.md).

## Prerequisites

- Node.js `>=22.0.0`
- npm `>=10` or pnpm `>=10`
- TypeScript `>=5.0.0` for typed package consumption

## Installation

```bash
npm install --save-dev workspace-dev
```

Enterprise and air-gapped install path: [docs/enterprise-quickstart.md](docs/enterprise-quickstart.md)

Container deployment path: [docs/container-deployment.md](docs/container-deployment.md)
Troubleshooting: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

> **Safe defaults**: This repo enforces `ignore-scripts=true` and `save-exact=true` via the root `.npmrc`.
> If a dependency requires lifecycle scripts, add it explicitly with `npm install --ignore-scripts=false <pkg>` and document the exception in your PR.

For projects that import `workspace-dev` types or compile against the published package declarations, use TypeScript `>=5.0.0`. The published dual ESM/CJS type surface is validated only for TypeScript 5+ consumers.

## Quickstart

```bash
npx workspace-dev start
```

Default runtime URL: `http://127.0.0.1:1983/workspace`

- UI: `http://127.0.0.1:1983/workspace/ui`
- Inspector intent metrics: `http://127.0.0.1:1983/workspace/ui/inspector/intent-metrics`
- Deep link by file key: `http://127.0.0.1:1983/workspace/<figmaFileKey>`

## Public API entrypoints

The package currently exposes two public entrypoints:

- `workspace-dev` — primary runtime entrypoint for `createWorkspaceServer`, contract types, mode-lock helpers, visual quality helpers, and advanced isolation helpers.
- `workspace-dev/contracts` — contract-focused types and runtime constants for consumers that only need versioned contract data.

For most consumers, `createWorkspaceServer` and the exported contract types are the intended day-to-day surface.
Generated API reference: [docs/api/README.md](docs/api/README.md).

## Programmatic API

Use the root `workspace-dev` entrypoint when you want to start and stop the local runtime from your own Node.js process.

```ts
import { createWorkspaceServer } from "workspace-dev";
import type { WorkspaceStartOptions } from "workspace-dev/contracts";

const options: WorkspaceStartOptions = {
    host: "127.0.0.1",
    port: 1983,
    outputRoot: ".workspace-dev",
    logFormat: "json",
};

const server = await createWorkspaceServer(options);
console.log(server.url);

// Later, when your host process is done with the runtime:
await server.app.close();
```

Use `validateModeLock` before accepting user-supplied mode overrides so invalid combinations fail fast with the same supported-mode wording as the runtime.

```ts
import { validateModeLock } from "workspace-dev";

const accepted = validateModeLock({
    figmaSourceMode: "local_json",
    llmCodegenMode: "deterministic",
});

if (!accepted.valid) {
    throw new Error(accepted.errors.join("\n"));
}

const rejected = validateModeLock({
    figmaSourceMode: "mcp",
    llmCodegenMode: "hybrid",
});

console.log(rejected.valid); // false
console.log(rejected.errors);
```

Use the contracts subpath when you only need versioned types and constants without the runtime server factory.

```ts
import {
    CONTRACT_VERSION,
    type WorkspaceFigmaSourceMode,
    type WorkspaceJobInput,
    type WorkspaceStartOptions,
} from "workspace-dev/contracts";

const contractVersion: string = CONTRACT_VERSION;

const preferredMode: WorkspaceFigmaSourceMode = "local_json";

const startOptions: WorkspaceStartOptions = {
    host: "127.0.0.1",
    port: 1983,
};

const job: WorkspaceJobInput = {
    figmaSourceMode: preferredMode,
    llmCodegenMode: "deterministic",
    figmaJsonPath: "fixtures/example/figma.json",
};

console.log({ contractVersion, startOptions, job });
```

### Advanced isolation lifecycle API

The root `workspace-dev` entrypoint also intentionally exports an advanced
isolation lifecycle API from `src/isolation.ts`.

Per-project helpers:

- `createProjectInstance`
- `getProjectInstance`
- `removeProjectInstance`
- `listProjectInstances`
- `ProjectInstance`

Process-level lifecycle controls:

- `removeAllInstances`
- `registerIsolationProcessCleanup`
- `unregisterIsolationProcessCleanup`

Stability annotations:

- `createWorkspaceServer` and contract types are the core stable surface for typical package consumers.
- The isolation lifecycle API is a stable advanced surface for embedders that need to orchestrate multiple isolated `workspace-dev` child processes from one host process.
- The isolation helpers are not experimental or internal-only today; any future relocation behind a dedicated subpath would require an explicit compatibility plan and semver-governed rollout.

Operational constraints for the advanced isolation surface:

- The parent-process instance registry is owned inside one Node.js process and is not safe to share across `worker_threads` or other concurrent mutation models.
- Cleanup hooks are opt-in and best-effort; call `registerIsolationProcessCleanup()` only when your host process wants `workspace-dev` to tear down active child instances during process shutdown.
- If you only need one local runtime, prefer `createWorkspaceServer` instead of managing isolated child processes directly.

## Figma-to-QC test intelligence (opt-in)

`workspace-dev` ships an opt-in subsurface that derives candidate QC test cases
from a Figma design through a deterministic pipeline with a reviewer-driven
gate, export-only QC artifacts, and a per-job evidence manifest. The subsurface
is local-first, fail-closed, and emits machine-verifiable evidence for every
step.

Both gates must hold to enable it: set
`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1` and pass
`testIntelligence.enabled: true` in `WorkspaceStartOptions`. The bundled CI
gate (`pnpm run test:ti-eval`) uses a deterministic mock LLM and fixture
captures and performs no outbound network calls.

The full operator guide is in [docs/test-intelligence.md](docs/test-intelligence.md).
For compliance positioning (DORA, GDPR, EU AI Act), see [COMPLIANCE.md](COMPLIANCE.md).

### Multi-Source test intent (Wave 4, opt-in)

Wave 4 extends the test-intelligence subsurface with additional source kinds
beyond Figma: Jira REST API, paste-only Jira ingestion (air-gap safe), and
reviewer-supplied Markdown/structured-attribute custom context. The source-mix
is governed by a second, nested feature gate:

```bash
export FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1
export FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE=1
```

```ts
testIntelligence: { enabled: true, multiSourceEnabled: true }
```

At least one primary source (`figma_*` or `jira_*`) is always required; the
gate fails closed before any source artifact is persisted if the predicate is
not satisfied.

| Source kind                                          | Description                                             |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `figma_local_json` \| `figma_plugin` \| `figma_rest` | Figma design sources (Wave 1 baseline)                  |
| `jira_rest`                                          | Jira Cloud / Data Center / OAuth 2.0 REST API           |
| `jira_paste`                                         | Paste-only Jira input — no outbound API calls required  |
| `custom_text` \| `custom_structured`                 | Reviewer Markdown / key-value context (supporting only) |

- Public API reference: [docs/api/test-intelligence-multi-source.md](docs/api/test-intelligence-multi-source.md)
- Jira setup runbook: [docs/runbooks/jira-source-setup.md](docs/runbooks/jira-source-setup.md)
- Air-gap deployment: [docs/runbooks/multi-source-air-gap.md](docs/runbooks/multi-source-air-gap.md)
- Migration from single-source: [docs/migration/wave-4-additive.md](docs/migration/wave-4-additive.md)
- DORA mapping: [docs/dora/multi-source.md](docs/dora/multi-source.md)
- EU AI Act human oversight: [docs/eu-ai-act/human-oversight.md](docs/eu-ai-act/human-oversight.md)
- GDPR DPIA addenda: [docs/dpia/jira-source.md](docs/dpia/jira-source.md), [docs/dpia/custom-context-source.md](docs/dpia/custom-context-source.md)

## Repository layout

The published package is intentionally small; this repository is broader because
it contains the verification surface needed to keep generation deterministic and
release-ready.

- `src/` - runtime, CLI, contracts, deterministic generator, and backend tests
- `ui-src/` - inspector/workspace UI source and UI tests
- `template/` - generator scaffolding and the generated-app template baseline that ships in the npm package; it is not a consumer runtime dependency loaded by `createWorkspaceServer`
- `integration/` - release-gate and end-to-end verification fixtures
- `docs/` - deeper implementation and operations references
- `plugin/` - Figma plugin source for clipboard export flows

If you only need the consumable product surface, `package.json.files` defines
the authoritative publish boundary.
The published package ships the compiled runtime from `dist/`, the docs listed
in `package.json.files`, and the `template/` scaffold used to materialize the
generated app baseline. Repository-only verification fixtures, test suites, and
template `node_modules` do not ship. Template-local browser validation files may
ship when a template exposes an explicit validation script that depends on them.

## Frontend stack

The workspace UI is implemented as a Vite + React + TypeScript + Tailwind app:

- Vite 8 build output is emitted into `dist/ui`
- Runtime serves `index.html` and hashed bundles under `/workspace/ui/assets/*`
- API contracts are versioned (`/workspace`, `/healthz`, `/readyz`, `/workspace/submit`, `/workspace/jobs/*`)
- UI HTML responses enforce a strict CSP (`style-src 'self'`); dynamic colors are applied via CSS custom properties set through the React DOM API, so no `unsafe-inline` exception is required

Useful scripts:

- `pnpm run ui:dev`
- `pnpm run ui:build`
- `pnpm run ui:typecheck`
- `pnpm run ui:lint`
- `pnpm run ui:test`
- `pnpm run ui:test:e2e` (Chromium-only deterministic inspector flow via local fixture rewrite, no Figma token required in CI; includes the Issue #1094 representative misclassification-rate gate at `<5%`)
- `pnpm run ui:test:e2e:matrix` (Chromium + Firefox + WebKit + mobile device project matrix)
- `pnpm run test:dast-smoke` (live HTTP security smoke for headers, same-origin behavior, and traversal rejection)
- `pnpm run test:load` (live HTTP load/backpressure smoke for queued submit and regenerate traffic against small in-memory queue caps; writes JSON evidence to `artifacts/testing/load-smoke/`)
- `pnpm run test:golden`
- `pnpm run test:golden:update`

Linting is standardized on ESLint v9 flat config:

- Root/backend config: `eslint.config.js`
- UI config: `ui-src/eslint.config.js`
- Template app config: `template/react-mui-app/eslint.config.js`

`pnpm run lint:ts-style` and `pnpm run ui:lint` both enforce `--max-warnings=0`.

## Inspector intent metrics

The inspector exposes a local diagnostics route at
`/workspace/ui/inspector/intent-metrics` for Issue #1094 telemetry. It reads
the same browser-local snapshot that powers the SmartBanner classification
audit:

- total classifications by `intent x confidence bucket`
- total SmartBanner corrections by `from -> to`
- recent local event buffer and current storage version
- current misclassification rate against the `<5%` target from Issue #991

The diagnostics are local-only and air-gap-safe. No external telemetry is sent,
and CI enforces the representative E2E misclassification ceiling through the
Playwright inspector suite.

## Golden fixture tests

Golden end-to-end fixtures validate deterministic output from `figma.json -> design-ir -> generated source` using curated local fixtures in `src/parity/fixtures/golden`.

- `pnpm run test:golden` compares generated artifacts against committed expected files.
- `pnpm run test:golden:update` updates expected golden files intentionally via `FIGMAPIPE_GOLDEN_APPROVE=true`.

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
- `llm_strict`

## Required submit input

- `figmaSourceMode=rest`:
    - `figmaFileKey`
    - `figmaAccessToken`
- `figmaSourceMode=hybrid`:
    - `figmaFileKey`
    - `figmaAccessToken`
    - Workspace Dev will attempt authoritative screen-subtree recovery when the direct REST geometry payload is detected as low-fidelity.
- `figmaSourceMode=figma_paste`:
    - `figmaJsonPayload`
- `figmaSourceMode=figma_plugin`:
    - `figmaJsonPayload`
- `figmaSourceMode=local_json`:
    - `figmaJsonPath` (local filesystem path to exported Figma JSON)

`figma_paste` and `figma_plugin` default to a `6 MiB` payload cap and use a larger
`8 MiB` submit transport limit only on `POST /workspace/submit`. The
`WORKSPACE_FIGMA_PASTE_MAX_BYTES` override is still bounded by the submit
transport budget.
This mode is also the offline/firewall handoff path: export JSON from Figma,
then submit the JSON text as `figmaJsonPayload` (no multipart upload required).
For plugin-envelope handoff, confirm the detected plugin import in the inspector
so the client submits `figmaSourceMode=figma_plugin`.

See [docs/figma-import.md](docs/figma-import.md) for the end-to-end onboarding,
plugin install, Inspector paste-zone reference, example payloads, FAQ, and
troubleshooting.

Optional Git/PR input:

- `enableGitPr` (default `false`)
- `repoUrl` (required only when `enableGitPr=true`)
- `repoToken` (required only when `enableGitPr=true`)
- `projectName` (optional)
- `targetPath` (optional, defaults to `figma-generated`)

Optional storybook-first input:

- `storybookStaticDir` (optional local filesystem path to a Storybook static build; relative paths resolve from the workspace root)

Optional customer profile input:

- `customerProfilePath` (optional local filesystem path; relative paths resolve from the workspace root)

Customer profile input belongs to the `rocket` compatibility pipeline. Existing
clients should include `pipelineId: "rocket"` alongside `customerProfilePath`
when submitting jobs. The OSS `default` pipeline fails closed for
Rocket-specific inputs such as customer profiles, customer brand IDs, and
component mappings; the runtime returns `PIPELINE_INPUT_UNSUPPORTED` instead of
silently generating with the wrong pipeline.

Optional inspector policy input:

- `/.workspace-inspector-policy.json` (optional repo-root JSON file for inspector quality, token, and a11y policy overrides)

Example:

```json
{
    "quality": {
        "maxAcceptableNodes": 80,
        "riskSeverityOverrides": {
            "large-subtree": "high"
        }
    },
    "tokens": {
        "autoAcceptConfidence": 95
    },
    "a11y": {
        "wcagLevel": "AAA",
        "disabledRules": ["missing-h1"]
    }
}
```

See [docs/figma-import.md - Quality and governance](docs/figma-import.md#quality-and-governance)
for the review stepper, audit trail, and full inspector policy field reference.

Optional token branding input:

- `brandTheme` (optional: `derived` or `sparkasse`; defaults to server runtime setting)
- `generationLocale` (optional BCP 47 locale string; defaults to server runtime setting, fallback `de-DE`)
- `formHandlingMode` (optional: `react_hook_form` or `legacy_use_state`; defaults to `react_hook_form`)

With `enableGitPr=false`, generation is local-only.

## Runtime API

- `GET /workspace` - runtime status
- `GET /healthz` - liveness probe (`200` with `{ status, uptime }` during startup, ready, and drain)
- `GET /readyz` - readiness probe (`200` only when ready; `503` during startup and drain)
- `GET /workspace/inspector-policy` - repo-backed inspector policy loader payload (`{ policy, validation, warning? }`)
- `GET /workspace/:figmaFileKey` - deep-link to workspace UI for a Figma file key
- `POST /workspace/submit` - start autonomous generation (`202 Accepted`)
- `GET /workspace/jobs/:id` - job polling (stages/logs/artifacts)
- `GET /workspace/jobs/:id/result` - compact result payload, including the Inspector quality-passport summary when validation evidence exists
- `POST /workspace/jobs/:id/cancel` - request cancellation for queued/running jobs
- `POST /workspace/jobs/:id/regenerate` - create a regeneration job from a completed source job. Regeneration inherits the source job pipeline; providing a different `pipelineId` is rejected with `PIPELINE_INPUT_UNSUPPORTED`.
- `POST /workspace/jobs/:id/sync` - local sync flow for completed regeneration jobs (`mode: dry_run` then `mode: apply`)
- `GET /workspace/jobs/:id/files` - paginated listing of generated source files (see below)
- `GET /workspace/repros/:id/` - generated local preview

### File listing pagination

`GET /workspace/jobs/:id/files` returns a bounded page of the generated project's source files. Responses are always bounded to at most `limit` files (maximum 1000). When `nextCursor` is present in the response, more files exist and clients must page to retrieve them all.

| Query param | Type   | Default | Notes                                                                                   |
| ----------- | ------ | ------- | --------------------------------------------------------------------------------------- |
| `dir`       | string | -       | Optional directory filter, restricted to the generated project (validated server-side). |
| `limit`     | number | `500`   | Page size. Clamped to `[1, 1000]`; non-numeric values fall back to the default.         |
| `cursor`    | string | -       | Opaque continuation token. Pass the `nextCursor` from the previous response.            |

Response shape:

```json
{
    "jobId": "…",
    "files": [{ "path": "src/App.tsx", "sizeBytes": 1234 }],
    "nextCursor": "src/App.tsx"
}
```

`nextCursor` is omitted on the last page. Clients iterate until it is absent.

## Runtime security behavior

- See `THREAT_MODEL.md` for the package trust boundaries, attack surfaces, mitigations, and residual risks that back the controls below.
- Default local development over `http://127.0.0.1` or `http://localhost` does not emit `Strict-Transport-Security`.
- Set `FIGMAPIPE_WORKSPACE_ENABLE_HSTS=true` only when the browser-facing deployment is HTTPS-only, such as behind a trusted TLS-terminating proxy. The runtime then emits `Strict-Transport-Security: max-age=31536000`.
- Same-origin-only write routes do not emit permissive `Access-Control-Allow-Origin` headers for untrusted origins.
- UI traversal probes such as `../`, encoded separators, null bytes, and Windows-style backslashes are rejected before any UI asset or SPA fallback is served.

## Operational Hardening

- Keep the default loopback bind (`127.0.0.1:1983`) unless you have an explicit reason to expand the trust boundary. The default `WorkspaceStartOptions.host` and CLI `--host` value are both `127.0.0.1`.
- Treat non-loopback or reverse-proxied browser-facing deployments as an explicit exposure expansion. Use HTTPS in front of the runtime, scope network access narrowly, and enable `FIGMAPIPE_WORKSPACE_ENABLE_HSTS=true` only when the browser-facing origin is HTTPS-only behind a trusted TLS terminator.
- `local_json` is the preferred air-gap and firewall-friendly source mode for programmatic or operational smoke tests. It consumes a local `figmaJsonPath`, avoids outbound Figma REST and MCP fetches, and pairs cleanly with loopback-only runtime deployment.
- For browser-based clipboard and inspector flows on remote hosts, use HTTPS rather than plain HTTP. Browsers treat `http://127.0.0.1` as a secure context, but remote hosts and reverse proxies do not get that exception.
- Use `package.json.files` as the publish contract when auditing what ships to npm. The repository contains broader test, fixture, and generator-development surfaces than the installed consumer package.

### Local sync flow

`POST /workspace/jobs/:id/sync` supports two request modes:

- Dry-run:
    - `{"mode":"dry_run","targetPath"?:string}`
    - Returns per-file plan, summary, destination metadata, and a short-lived `confirmationToken`.
- Apply:
    - `{"mode":"apply","confirmationToken":string,"confirmOverwrite":true}`
    - Requires explicit confirmation and a valid dry-run token; performs writes and returns applied summary.

Sync writes to `<workspaceRoot>/<targetPath>/<boardKey>/...` and is rejected for non-regeneration jobs or non-completed jobs.

## Output layout

By default, generated files are written under:

- `.workspace-dev/jobs/<jobId>/generated-app`
- `.workspace-dev/jobs/<jobId>/generated-app/quality-passport.json`
- `.workspace-dev/jobs/<jobId>/figma.json`
- `.workspace-dev/jobs/<jobId>/design-ir.json`
- `.workspace-dev/repros/<jobId>/` (includes `quality-passport.json` when validation produced passport evidence)
- `.workspace-dev/jobs/<jobId>/repo/` (only when `enableGitPr=true`)
- `.workspace-dev/jobs/<jobId>/generated-app/public/images/*` (when image export is enabled and image candidates exist)
- `.workspace-dev/icon-fallback-map.json` (auto-bootstrapped fallback icon mapping catalog)

## CLI

```bash
workspace-dev start [options]
workspace-dev scan-design-system [options]
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
- `--design-system-file <path>` (default `<outputRoot>/design-system.json`; optional design-system mapping for deterministic codegen)
- `--shutdown-timeout <ms>` (default `10000`, max graceful drain time before remaining connections are terminated)
- `--export-images <true|false>` (default `true`; exports Figma image assets to `generated-app/public/images`)
- `--figma-screen-element-budget <n>` (default `1200`)
- `--figma-screen-element-max-depth <n>` (default `14`)
- `--brand <derived|sparkasse>` (default `derived`)
- `--generation-locale <locale>` (default `de-DE`)
- `--router <browser|hash>` (default `browser`)
- `--command-timeout-ms <ms>` (default `900000`)
- `--pipeline-diagnostic-max-count <n>` (default `25`)
- `--pipeline-diagnostic-text-max-length <n>` (default `320`)
- `--pipeline-diagnostic-details-max-keys <n>` (default `30`)
- `--pipeline-diagnostic-details-max-items <n>` (default `20`)
- `--pipeline-diagnostic-details-max-depth <n>` (default `4`)
- `--ui-validation <true|false>` (default `false`)
- `--install-prefer-offline <true|false>` (default `true`)
- `--skip-install <true|false>` (default `false`; expert mode, requires pre-existing `generated-app/node_modules`)
- `--max-concurrent-jobs <n>` (default `1`; concurrent running job cap)
- `--max-queued-jobs <n>` (default `20`; queued job cap before submit backpressure)
- `--rate-limit <n>` (default `10`; max job submissions and import-session event writes per minute per client IP, with separate budgets per route family; `0` disables the limiter)
- `--log-format <text|json>` (default `text`; operational runtime log output format)
- `--lint-autofix <true|false>` (default `true`; runs `pnpm lint --fix` before final `pnpm lint`)
- `--preview <true|false>` (default `true`)
- `--perf-validation <true|false>` (default `false`, runs template `perf:assert` in `validate.project`)

### scan-design-system command

Generate an initial design-system mapping config by scanning project imports:

```bash
workspace-dev scan-design-system [options]
```

Options:

- `--project-root <path>` (default `process.cwd()`)
- `--output <path>` (default `<project-root>/.workspace-dev/design-system.json`)
- `--library <pkg>` (optional override for inferred package)
- `--force` (overwrite existing output file)

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
- `FIGMAPIPE_WORKSPACE_DESIGN_SYSTEM_FILE`
- `FIGMAPIPE_WORKSPACE_EXPORT_IMAGES`
- `FIGMAPIPE_WORKSPACE_FIGMA_SCREEN_ELEMENT_BUDGET`
- `FIGMAPIPE_WORKSPACE_FIGMA_SCREEN_ELEMENT_MAX_DEPTH`
- `FIGMAPIPE_WORKSPACE_BRAND`
- `FIGMAPIPE_WORKSPACE_GENERATION_LOCALE`
- `FIGMAPIPE_WORKSPACE_ROUTER`
- `FIGMAPIPE_WORKSPACE_COMMAND_TIMEOUT_MS`
- `FIGMAPIPE_WORKSPACE_PIPELINE_DIAGNOSTIC_MAX_COUNT`
- `FIGMAPIPE_WORKSPACE_PIPELINE_DIAGNOSTIC_TEXT_MAX_LENGTH`
- `FIGMAPIPE_WORKSPACE_PIPELINE_DIAGNOSTIC_DETAILS_MAX_KEYS`
- `FIGMAPIPE_WORKSPACE_PIPELINE_DIAGNOSTIC_DETAILS_MAX_ITEMS`
- `FIGMAPIPE_WORKSPACE_PIPELINE_DIAGNOSTIC_DETAILS_MAX_DEPTH`
- `FIGMAPIPE_WORKSPACE_ENABLE_UI_VALIDATION`
- `FIGMAPIPE_WORKSPACE_INSTALL_PREFER_OFFLINE`
- `FIGMAPIPE_WORKSPACE_SKIP_INSTALL`
- `FIGMAPIPE_WORKSPACE_MAX_CONCURRENT_JOBS`
- `FIGMAPIPE_WORKSPACE_MAX_QUEUED_JOBS`
- `FIGMAPIPE_WORKSPACE_RATE_LIMIT_PER_MINUTE`
- `FIGMAPIPE_WORKSPACE_LOG_FORMAT`
- `FIGMAPIPE_WORKSPACE_ENABLE_LINT_AUTOFIX`
- `FIGMAPIPE_WORKSPACE_ENABLE_PREVIEW`
- `FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION`
- `FIGMAPIPE_ENABLE_PERF_VALIDATION` (legacy alias)

When `skipInstall` is enabled and `generated-app/node_modules` is missing, `validate.project` fails fast with a deterministic error message.
When lint auto-fix is enabled, `validate.project` runs `pnpm lint --fix` before final `pnpm lint` and logs changed lint-relevant files.
When `lint`, `typecheck`, or `build` fail, `validate.project` applies conservative auto-corrections (TypeScript codefix + organize imports) and retries validation up to 3 attempts.

### Router mode

Use `--router <browser|hash>` (or `FIGMAPIPE_WORKSPACE_ROUTER`) to control the generated `App.tsx` router:

- `browser` (default): clean URLs like `/dashboard`; deployment requires SPA rewrites so app routes resolve to `index.html`.
- `hash`: compatibility mode with URLs like `/#/dashboard`; no server-side rewrites are required.

For local preview (`/workspace/repros/:jobId/*`), generated BrowserRouter apps auto-resolve a matching `basename` so deep links continue to work under the preview path.

## Web performance workflow

Bundled templates include baseline + assertion pipelines:

- `pnpm --dir template/react-mui-app run perf:baseline`
- `pnpm --dir template/react-mui-app run perf:assert`
- `pnpm --dir template/react-tailwind-app run perf:baseline`
- `pnpm --dir template/react-tailwind-app run perf:assert`

Approved release baselines live beside each template, including `template/react-mui-app/perf-baseline.json` and `template/react-tailwind-app/perf-baseline.json`.
Runtime performance reports are written to `template/<template-name>/artifacts/performance`.
Budget policy is configured in each template's `perf-budget.json`.
The dev quality gate keeps these assertions warn-only for iteration speed; release and publish workflows treat them as blocking.
Detailed operating notes: `docs/react-web-performance.md`.

## React Compiler (template opt-in)

Generated template builds can enable React Compiler via environment variables:

- `VITE_ENABLE_REACT_COMPILER=true`
- optional `VITE_REACT_COMPILER_TARGET=18|19`

Template linting also enforces compiler-safe React patterns through `eslint-plugin-react-compiler`.

## Example API flow

```bash
curl -sS -X POST http://127.0.0.1:1983/workspace/submit \
  -H 'content-type: application/json' \
  -d '{
    "figmaFileKey":"demo-file-key",
    "figmaAccessToken":"figd_...",
    "brandTheme":"derived",
    "generationLocale":"en-US",
    "formHandlingMode":"react_hook_form",
    "enableGitPr": false,
    "figmaSourceMode":"rest",
    "llmCodegenMode":"deterministic"
  }'
```

Local JSON submit mode:

```bash
curl -sS -X POST http://127.0.0.1:1983/workspace/submit \
  -H 'content-type: application/json' \
  -d '{
    "pipelineId":"rocket",
    "figmaSourceMode":"local_json",
    "figmaJsonPath":"./fixtures/figma-export.json",
    "customerProfilePath":"./profiles/customer-profile.json",
    "enableGitPr": false,
    "llmCodegenMode":"deterministic"
  }'
```

Offline/firewall JSON upload mode (`figma_paste`, same endpoint):

```bash
curl -sS -X POST http://127.0.0.1:1983/workspace/submit \
  -H 'content-type: application/json' \
  -d "$(jq -n --rawfile figma ./fixtures/figma-export.json '{
    figmaSourceMode: \"figma_paste\",
    figmaJsonPayload: $figma,
    enableGitPr: false,
    llmCodegenMode: \"deterministic\"
  }')"
```

Inspector firewall flow:

1. Export JSON from Figma on a machine with Figma access.
2. Transfer the `.json` file into the firewall-protected WorkspaceDev environment.
3. In Inspector, use **Upload JSON file** (or paste/drop) and continue with the normal confirm/import flow.

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
