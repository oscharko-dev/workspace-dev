# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autonomous local workspace runtime for deterministic Figma-to-code generation via REST or local JSON input. Ships as an npm package (`workspace-dev`) with a CLI entry point. Node.js >=22 required. Air-gap compatible in `local_json` mode.

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
| `server.ts` / `server/` | HTTP server on Node built-in `http` — routes for `/workspace`, `/workspace/ui`, job submission, job status, repro assets. |
| `job-engine.ts` / `job-engine/` | Job pipeline: figma.source → ir.derive → template.prepare → codegen.generate → validate.project → repro.export → git.pr, with optional generated-project `test`, `validate:ui`, and `perf:assert` validation steps. |
| `parity/` | Deterministic codegen: IR derivation (`ir.ts`), file generation (`generator-core.ts`), LLM client (`llm.ts`). |
| `mode-lock.ts` | Hard enforcement — only `figmaSourceMode=rest|local_json` and `llmCodegenMode=deterministic` are allowed. |
| `isolation.ts` | Per-project child-process isolation with deterministic cleanup. |
| `cli.ts` | CLI argument parsing; binary is `workspace-dev`. |

### Build entries (tsup)
Main lib, CLI, isolated-server-entry, and contracts — each a separate entry point.

### Branching & release
- `main` — production/release branch.
- `dev-gate` — development quality gate; PRs target here first.
- Versioning via **Changesets** (`@changesets/cli`).

## Testing

Tests use the **Node.js native test runner** via `tsx --test`. UI tests use Vitest + Playwright. Coverage via `c8` with enforced thresholds.

## Lint & Quality

- ESLint v9 runs on native flat config:
  - `eslint.config.js` for `src/**`
  - `ui-src/eslint.config.js` for `ui-src/src/**`
  - `template/react-mui-app/eslint.config.js` for the shipped template app
- Type-aware linting uses `@typescript-eslint/strict-type-checked` with additional unsafe/async guards (`no-explicit-any`, `no-floating-promises`, `no-misused-promises`, `no-unnecessary-condition`, `await-thenable`, `no-unsafe-*`, `consistent-type-imports`).
- `lint:boundaries` — prevents imports from `services/*`, `workspace/*`, `infra/*`.
- `lint:no-telemetry` — enforces zero telemetry.
- `lint:size` — published bundle size limits (53 KB index.js, 5 KB contracts) plus a local UI Shiki worker budget guard.
- `lint:publint` / `lint:types-publish` — package correctness for npm distribution.

## TypeScript

Strict mode with `isolatedDeclarations`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Target ES2023, module `node20`, module resolution `node16`.
