# Contributing to workspace-dev

Thank you for your interest in contributing.

## Development Setup

```bash
git clone https://github.com/oscharko-dev/workspace-dev.git
cd workspace-dev
pnpm install
pnpm test
pnpm typecheck
pnpm lint:boundaries
```

## Pull Request Process

1. Create a feature branch from `dev`.
2. Make changes in this repository root.
3. Add or update tests for behavior changes.
4. If public contracts change (`src/contracts/`), add an entry to `CONTRACT_CHANGELOG.md`.
5. Ensure `pnpm test`, `pnpm typecheck`, and `pnpm lint:boundaries` pass.
6. Open a PR targeting `dev` with clear change rationale.
7. Maintainers promote vetted changes through `dev -> dev-gate -> main`.

## Boundary Rules

`workspace-dev` must not import from internal modules (`services/*`, `workspace/`, `infra/`, `scripts/`).
All public types must be defined in `src/contracts/`.

## Contract Change Rules

Any public API change requires:

1. `CONTRACT_CHANGELOG.md` entry
2. Snapshot updates in `src/contract-version.test.ts` when runtime exports change
3. Passing tests and type checks

## Adding new validated fields

Request validation in `src/schemas.ts` uses project-local lightweight validators
instead of a runtime schema dependency so the package stays air-gap compatible.

When adding a new validated request field:

1. Update the schema's `allowedKeys` set so strict unknown-property rejection remains intact.
2. Add parsing and normalization near related fields, reusing shared helpers such as `parseStringField` when possible.
3. Keep validation messages and issue paths consistent with the shapes emitted through `formatZodError`.
4. Add or update schema tests for valid input, invalid input, and unexpected-property rejection.
