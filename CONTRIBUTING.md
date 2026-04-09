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

## Mutation Testing

Run `pnpm run test:mutation` from the repository root to execute the scoped Stryker mutation suite for the critical issue modules.

The generated JSON and HTML reports are written to `artifacts/testing/mutation`, and CI uploads the same directory as a build artifact for inspection.

Mutation testing is intentionally limited to the current high-value modules and is tracked as a warn-only CI signal so release gating can consume the report without blocking on the score alone.

Current baseline mutation score: `62%` (derived from the verified `62.86%` run across `src/mode-lock.ts`, `src/schemas.ts`, `src/server/request-security.ts`, `src/job-engine/pipeline/orchestrator.ts`, and `src/parity/ir.ts`).

## Visual Benchmark Workflow

The visual benchmark suite measures how closely generated output matches committed reference screenshots. Use it to evaluate the visual impact of generator changes.

### Running benchmarks before/after changes

```bash
pnpm benchmark:visual
```

- Run `pnpm benchmark:visual` before and after making generator changes.
- Compare the ASCII table output to see score deltas per fixture.
- A delta > +1 indicates improvement; delta < -1 indicates degradation.
- The +/-1 neutral band absorbs small rendering variance.

### Expected workflow

1. Run `pnpm benchmark:visual` to establish a pre-change baseline.
2. Make generator changes.
3. Run `pnpm benchmark:visual` again to compare.
4. If scores degraded, investigate using the diff images in the job output.
5. If changes are intentional (e.g., improved layout), update the baseline:

```bash
pnpm benchmark:visual:update-baseline
```

### Adding new benchmark views

1. Create a new directory under `integration/fixtures/visual-benchmark/<fixture-id>/`.
2. Add a frozen `figma.json` payload (use `pnpm benchmark:visual:update-fixtures` to fetch from Figma, requires `FIGMA_ACCESS_TOKEN`).
3. Add `metadata.json` with source nodeId and viewport configuration.
4. Generate a `reference.png` with `pnpm benchmark:visual:update-references`.
5. Add a `manifest.json` pointing to the reference image and metadata.
6. The benchmark runner will automatically discover the new fixture.

### Updating references when Figma designs change

- `pnpm benchmark:visual:update-fixtures` — fetches fresh `figma.json` from live Figma (requires `FIGMA_ACCESS_TOKEN`).
- `pnpm benchmark:visual:update-references` — regenerates `reference.png` from current pipeline output (offline, no token needed).
- `pnpm benchmark:visual:update-baseline` — updates `baseline.json` with current scores.

See `docs/visual-quality-assessment.md` for detailed architecture and scoring documentation.

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
