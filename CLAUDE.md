# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autonomous local workspace runtime for deterministic Figma-to-code generation via `rest`, `hybrid`, or `local_json` input modes. Ships as an npm package (`workspace-dev`) with a CLI entry point. Node.js >=22 required. Air-gap compatible in `local_json` mode. Zero runtime dependencies — everything is devDependencies only.

## Common Commands

```bash
pnpm run build                # Build lib (tsup) + UI (Vite)
pnpm run typecheck             # TypeScript check (lib + UI)
pnpm run test                  # All tests (unit + integration + UI)
pnpm run lint:ts-style         # ESLint on src (excludes tests)
pnpm run lint:boundaries       # Architecture boundary enforcement

# Run a single test file
tsx --test src/some-file.test.ts

# UI development
pnpm run ui:dev                # Vite dev server for UI
pnpm run ui:test               # Vitest for UI unit tests
pnpm run ui:test:e2e           # Playwright E2E tests

# Specialised tests
pnpm run test:bdd              # BDD contract scenarios
pnpm run test:property-based   # Fuzz/property-based tests
pnpm run test:coverage         # Coverage with threshold checks
pnpm run test:golden           # Golden fixture parity tests

# Full quality gate (CI equivalent)
pnpm run release:quality-gates
```

## Architecture

### Dual codebase
- **Library + CLI** — TypeScript in `src/`, built with tsup to ESM + CJS dual output in `dist/`.
- **UI** — React 19 + Vite 8 + Tailwind v4 in `ui-src/`, built to `dist/ui/` and served by the main server at `/workspace/ui/`.

### Key modules (`src/`)
| Module | Purpose |
|---|---|
| `contracts/index.ts` | Public API types (CONTRACT_VERSION). The `./contracts` subpath export. |
| `server.ts` / `server/` | HTTP server on Node built-in `http` — routes for `/workspace`, `/workspace/ui`, job submission, job status, repro assets. Localhost-only (`127.0.0.1:1983`). |
| `job-engine.ts` / `job-engine/` | Job pipeline orchestration — see "Pipeline stages" below. |
| `job-engine/pipeline/` | Pipeline kernel: `PipelineOrchestrator`, `StageArtifactStore`, execution context. Stages exchange data via artifact keys, not direct imports. |
| `parity/` | Deterministic codegen: IR derivation (`ir.ts`), file generation (`generator-core.ts`), LLM client (`llm.ts`). Golden fixtures in `parity/fixtures/golden/`. |
| `mode-lock.ts` | Hard enforcement — only `figmaSourceMode=rest|hybrid|local_json` and `llmCodegenMode=deterministic` are allowed. Blocked modes fail with `MODE_LOCK_VIOLATION`. |
| `isolation.ts` | Per-project child-process isolation (`fork()`) with deterministic cleanup. |
| `cli.ts` | CLI argument parsing; binary is `workspace-dev`. |

### Pipeline stages (7 services in `job-engine/services/`)

Stages run in order; each declares `reads[]`/`writes[]` artifact keys.

1. **figma.source** — Fetch via Figma REST, load local JSON, or hybrid (REST geometry + optional MCP metadata merge).
2. **ir.derive** — Normalize to deterministic design IR. Supports regeneration from seeded `regeneration.source_ir` + `regeneration.overrides` artifacts. IR cache with TTL.
3. **template.prepare** — Copy seed template (`template/react-mui-app/`, React 19 + MUI v7 + Vite 8).
4. **codegen.generate** — Emit components, routes, assets, and manifest/diff.
5. **validate.project** — Install, lint, typecheck, build the generated project. Optional `test`, `validate:ui`, and `perf:assert` gates.
6. **repro.export** — Write generated app and job artifacts to `.workspace-dev/jobs/<jobId>/`.
7. **git.pr** — Optional git/PR automation (skipped in regeneration plan).

Execution plans: `submission` (all 7 stages) and `regeneration` (skips figma.source + git.pr; ir.derive reads seeded artifacts).

### Artifact model

Output lives under `.workspace-dev/` in the project directory:
- `.workspace-dev/jobs/<jobId>/figma.json` — cleaned Figma source
- `.workspace-dev/jobs/<jobId>/design-ir.json` — derived IR
- `.workspace-dev/jobs/<jobId>/generated-app/*` — generated project files
- `.workspace-dev/jobs/<jobId>/.stage-store/*` — artifact reference index (per-key refs)

### Template app

`template/react-mui-app/` is a self-contained React 19 + MUI v7 + Vite 8 app with its own `pnpm-lock.yaml`, ESLint config, Vitest tests, and perf baselines. It ships in the npm package as the seed for generated projects.

### Build entries (tsup)
Main lib, CLI, isolated-server-entry, and contracts — each a separate entry point.

### Branching & release
- `dev` — active default development branch.
- `dev-gate` — development quality gate; only `dev` may merge into `dev-gate`.
- `main` — production/release branch; only `dev-gate` may merge into `main`.
- Versioning via **Changesets** (`@changesets/cli`).

## Testing

Tests use the **Node.js native test runner** via `tsx --test`. UI tests use Vitest + Playwright. Coverage via `c8` with enforced thresholds.

- **Golden fixtures** (`src/parity/fixtures/golden/`) — deterministic end-to-end parity tests. To approve updated fixtures: `FIGMAPIPE_GOLDEN_APPROVE=true pnpm run test:golden`.
- **BDD contract** (`src/bdd-contract.test.ts`) — behavioral specification scenarios.
- **Property-based** (`src/mode-lock.fuzz.test.ts`) — fast-check fuzz tests.

## Contract Changes

Any public API change in `src/contracts/` requires:
1. An entry in `CONTRACT_CHANGELOG.md`.
2. Snapshot updates in `src/contract-version.test.ts` when runtime exports change.

## Lint & Quality

- ESLint v9 runs on native flat config:
  - `eslint.config.js` for `src/**`
  - `ui-src/eslint.config.js` for `ui-src/src/**`
  - `template/react-mui-app/eslint.config.js` for the shipped template app
- Type-aware linting uses `@typescript-eslint/strict-type-checked` with additional unsafe/async guards (`no-explicit-any`, `no-floating-promises`, `no-misused-promises`, `no-unnecessary-condition`, `await-thenable`, `no-unsafe-*`, `consistent-type-imports`).
- `lint:boundaries` — enforces package boundaries: blocks imports from internal `services/*`, `workspace/*`, `infra/*`, `quality/*`, and `scripts/*` paths, selected package-level/internal APIs, forbidden Node builtins, stage-service cross-coupling, and any runtime dependencies in `package.json`.
- `lint:no-telemetry` — enforces zero telemetry.
- `lint:size` — published bundle size limits (53 KB index.js, 5 KB contracts) plus a local UI Shiki worker budget guard.
- `lint:publint` / `lint:types-publish` — package correctness for npm distribution.

## TypeScript

Strict mode with `isolatedDeclarations`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Target ES2023, module `node20`, module resolution `node16`.
