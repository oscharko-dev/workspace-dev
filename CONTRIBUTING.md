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

Mutation testing is intentionally limited to the current high-value modules and is enforced as a CI-blocking quality gate.

Current baseline mutation score: `68%` (CI fails below this threshold across `src/mode-lock.ts`, `src/schemas.ts`, `src/server/request-security.ts`, `src/job-engine/pipeline/orchestrator.ts`, `src/job-engine/visual-scoring.ts`, and `src/parity/ir.ts`).

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
pnpm visual:baseline update
```

### Adding new benchmark views

1. Create a new directory under `integration/fixtures/visual-benchmark/<fixture-id>/`.
2. Add a frozen `figma.json` payload (use `pnpm benchmark:visual:update-fixtures` to fetch from Figma, requires `FIGMA_ACCESS_TOKEN`).
3. Add `metadata.json` with source nodeId and viewport configuration.
4. Generate a `reference.png` with `pnpm benchmark:visual:update-references`.
5. Add a `manifest.json` pointing to the reference image and metadata.
6. The benchmark runner will automatically discover the new fixture.

### Updating references when Figma designs change

- `pnpm visual:baseline update` — reruns the selected fixtures, persists last-run visual artifacts, refreshes committed `reference.png`, updates fixture `metadata.json`, and syncs `baseline.json`.
- `pnpm visual:baseline approve --screen <fixture-id>` — promotes one persisted last-run image to the committed reference without rerunning the full suite.
- `pnpm visual:baseline status` — shows per-fixture baseline state, capture age, and pending diffs.
- `pnpm visual:baseline diff` — summarizes pending diffs from persisted last-run artifacts.
- `pnpm benchmark:visual:update-fixtures` — fetches fresh `figma.json` from live Figma (requires `FIGMA_ACCESS_TOKEN`).
- `pnpm benchmark:visual:update-references` — regenerates `reference.png` from current pipeline output (offline, no token needed).
- `pnpm benchmark:visual:update-baseline` — compatibility shim for `pnpm visual:baseline update`.

### Choosing the correct live audit

- `pnpm visual:audit live --fixture <fixture-id> --json` is the operator-facing live audit for Issue `#842`. It compares current live Figma against both the frozen reference and the most recent persisted last-run generated output under `artifacts/visual-benchmark/last-run/...`.
- `Design Drift Detected` means live Figma moved away from the frozen reference while the last generated output still matches live Figma.
- `Generator Regression` means live Figma still matches the frozen reference but the last generated output drifted away.
- `lastKnownGoodAt` comes from the persisted last-run artifact timestamp when that artifact still represents a good generated state. If no comparable persisted artifact exists and the audit must fall back to a fresh render, that fallback run time is used only for that run.
- `pnpm benchmark:visual:live` remains the maintenance audit for frozen fixtures and references vs live Figma. Use it when checking fixture freshness, not when classifying drift vs regression.

See `docs/visual-quality-assessment.md` for detailed architecture and scoring documentation.

## Boundary Rules

`workspace-dev` must not import from internal modules (`services/*`, `workspace/`, `infra/`, `scripts/`).
All contract-versioned public types must be defined in `src/contracts/`.
Semver-governed runtime types exported from the root `workspace-dev` entrypoint
may live outside `src/contracts/` when they model runtime behavior rather than
the versioned contract schema.

## Contract Change Rules

Public contract changes require:

1. `CONTRACT_CHANGELOG.md` entry
2. `CONTRACT_VERSION` bump
3. Passing tests and type checks

Public package/root-entrypoint API changes require:

1. Explicit package semver treatment through Changesets and release notes
2. Snapshot updates in `src/contract-version.test.ts` when runtime exports change
3. Passing tests and type checks

For avoidance of doubt:

- Existing exports from the root `workspace-dev` entrypoint are public API.
- Changing the runtime barrel in `src/index.ts` is not an internal refactor when it affects exported names.
- Clarifying docs for an already-exported runtime symbol does not require a package or contract bump unless the underlying API itself changes.

## Adding new validated fields

Request validation in `src/schemas.ts` uses project-local lightweight validators
instead of a runtime schema dependency so the package stays air-gap compatible.

When adding a new validated request field:

1. Update the schema's `allowedKeys` set so strict unknown-property rejection remains intact.
2. Add parsing and normalization near related fields, reusing shared helpers such as `parseStringField` when possible.
3. Keep validation messages and issue paths consistent with the shapes emitted through `formatZodError`.
4. Add or update schema tests for valid input, invalid input, and unexpected-property rejection.
