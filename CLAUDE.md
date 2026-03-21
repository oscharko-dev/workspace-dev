# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autonomous local workspace runtime for REST-based deterministic Figma-to-code generation. Ships as an npm package (`workspace-dev`) with a CLI entry point. Node.js >=22 required. Air-gap compatible — zero external HTTP dependencies at runtime.

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
| `job-engine.ts` / `job-engine/` | Job pipeline: figma.source → ir.derive → template.prepare → codegen.generate → validate.project → repro.export → git.pr |
| `parity/` | Deterministic codegen: IR derivation (`ir.ts`), file generation (`generator-core.ts`), LLM client (`llm.ts`). |
| `mode-lock.ts` | Hard enforcement — only `figmaSourceMode=rest` and `llmCodegenMode=deterministic` are allowed. |
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

- ESLint with strict TypeScript rules (`type-imports`, `no-explicit-any`, `no-floating-promises`, `exactOptionalPropertyTypes`).
- `lint:boundaries` — prevents imports from `services/*`, `workspace/*`, `infra/*`.
- `lint:no-telemetry` — enforces zero telemetry.
- `lint:size` — bundle size limits (53 KB index.js, 5 KB contracts).
- `lint:publint` / `lint:types-publish` — package correctness for npm distribution.

## TypeScript

Strict mode with `isolatedDeclarations`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Target ES2023, module resolution `node20`.
