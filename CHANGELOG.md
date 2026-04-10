# Changelog

All notable user-facing changes to `workspace-dev` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Contract-level surface changes remain tracked in `CONTRACT_CHANGELOG.md`.

## [Unreleased]

### Added

- Template web-performance pipeline:
  - `perf-budget.json` policy
  - `scripts/perf-runner.mjs`
  - scripts `perf:baseline` and `perf:assert`
- Field metric hook for CWV reporting in template app (`web-vitals` for INP/LCP/CLS).
- CI `performance-web` jobs in release workflows with artifact upload.
- Responsive viewport configuration for visual benchmark: declare per-fixture or per-screen viewport lists with `id/width/height/deviceScaleFactor/weight` in `visual-quality.config.json`. Default behavior is a single `desktop` viewport (1280x800) for byte-identical back-compat. Explicit viewports are honored by the `validate-project` service via `visualQualityViewportHeight` + `visualQualityDeviceScaleFactor` runtime fields. (#838)
- `--viewport <id>` CLI flag on `pnpm benchmark:visual` for future per-viewport filtering. Flag is parsed and validated today; runner integration follows. (#838)

### Changed

- Deterministic app generation now uses route-level lazy loading for non-initial screens (`React.lazy` + `Suspense`).
- Deterministic generated app shell defaults to `BrowserRouter` and supports runtime router mode override (`--router browser|hash`).
- Documented BrowserRouter rewrite requirements and hash compatibility mode in README router guidance.
- Added offline local Figma JSON ingestion mode (`figmaSourceMode=local_json`, `figmaJsonPath`) with strict submit-source exclusivity validation.
- `validate.project` can execute optional performance assertion when `FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION=true` (or `FIGMAPIPE_ENABLE_PERF_VALIDATION=true`).
- Hardened deterministic MUI icon import emission with tuple-based dedupe and stable ordering for reproducible outputs.
- Extended `WorkspaceVisualReferenceFixtureMetadata.viewport` with optional `deviceScaleFactor`. Back-compatible for v1/v2 fixtures. (#838)
- Composite score key in visual-benchmark runner is now `fixtureId::screenId::viewportId` with `"default"` fallback when viewportId is missing. Back-compatible for baseline v3 entries without viewportId. (#838)

## [1.0.0] - 2026-03-13

### Changed

- Promoted `workspace-dev` to standalone OSS package release line.
- Removed legacy CLI alias; only `workspace-dev` remains.
- Replaced monorepo-coupled template parity test with self-contained template integrity snapshots.
- Updated governance and contribution docs for standalone repository operations.

### Migration notes

- Replace all legacy CLI alias invocations with `workspace-dev`.
- No HTTP API contract changes in `/workspace` runtime endpoints.

## [0.3.0] - 2026-03-12

### Changed

- Switched generation runtime to parity-aligned deterministic pipeline:
  - `figma.source`
  - `ir.derive`
  - `template.prepare`
  - `codegen.generate`
  - `validate.project`
  - `repro.export`
  - optional `git.pr`
- Bundled Workspace Dev React + TypeScript + MUI v7 template into `workspace-dev`.
- Replaced simplified generator with parity deterministic IR + codegen core.
- Added optional Git/PR flow (`enableGitPr`) with contract-safe repo credential handling.
- UI now exposes explicit Git/PR toggle and keeps `Generate` CTA visible in header and form.
- Added no-store cache headers for UI and preview routes to avoid stale asset rendering.

## [0.2.0] - 2026-03-12

### Changed

- `workspace-dev` evolved from validator-only runtime to autonomous local generator.
- `POST /workspace/submit` now accepts jobs (`202`) and starts real local execution.
- Added async job polling endpoints (`/workspace/jobs/:id`, `/workspace/jobs/:id/result`).
- Added integrated local preview serving (`/workspace/repros/:id/*`).
- Updated UI to reduced but functional workspace flow with required inputs:
  - `figmaFileKey`
  - `figmaAccessToken`
  - `repoUrl`
  - `repoToken`
- Added deterministic local artifact pipeline:
  - Figma REST fetch
  - IR derivation
  - local code generation
  - local preview export

### Maintained constraints

- Mode lock remains strict:
  - `figmaSourceMode=rest`
  - `llmCodegenMode=deterministic`
- No MCP, no hybrid, no `llm_strict`.
- No dependency on Workspace Dev platform backend services.

## [0.1.1] - 2026-03-12

### Changed

- Hardened npm release readiness for `workspace-dev`:
  - release governance changelog
  - `sideEffects` metadata
  - CJS guard export paths with ESM migration guidance
  - package quality checks (`publint`, `attw`, `size-limit`)
  - package-local changesets + OIDC provenance publish

## [0.1.0] - 2026-03-11

### Added

- Initial `workspace-dev` package release for local mode-locked workspace validation.
- Public status and validation endpoints (`/workspace`, `/healthz`, `/workspace/submit`).
