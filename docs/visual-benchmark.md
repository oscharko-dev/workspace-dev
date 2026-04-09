# Visual Benchmark

The visual benchmark system provides a fixed test set of Figma design views and a comparative runner that measures visual quality scores across benchmark runs.

## Running the benchmark

```bash
pnpm benchmark:visual
```

This runs the benchmark test suite, which loads all fixture reference images, computes visual quality scores via self-comparison, and validates the benchmark infrastructure.

## Updating the baseline

```bash
pnpm benchmark:visual:update-baseline
```

This computes current scores for all fixtures, compares them against the stored baseline, prints a comparison table, and writes the current scores as the new baseline.

## Interpreting results

The comparison table shows one row per fixture view and an overall average row:

```
┌─────────────────────────┬──────────┬──────────┬────────┐
│ View                    │ Baseline │ Current  │ Delta  │
├─────────────────────────┼──────────┼──────────┼────────┤
│ Simple Form             │ 100      │ 100      │ 0 ➖   │
│ Complex Dashboard       │ 100      │ 100      │ 0 ➖   │
├─────────────────────────┼──────────┼──────────┼────────┤
│ Overall Average         │ 100      │ 100      │ 0      │
└─────────────────────────┴──────────┴──────────┴────────┘
```

| Column   | Description                                  |
| -------- | -------------------------------------------- |
| View     | Display name derived from the fixture ID     |
| Baseline | Score from the last saved baseline            |
| Current  | Score from the current run                    |
| Delta    | Difference (current minus baseline)           |

Delta indicators:

- Positive delta with a checkmark means the score improved.
- Negative delta with a warning icon means the score degraded.
- Zero delta or no baseline uses a neutral indicator.

## Adding a new benchmark view

1. Create a directory under `integration/fixtures/visual-benchmark/` with a kebab-case name (e.g., `my-new-view/`).
2. Add `metadata.json` following the existing fixture format (version 1, fixtureId matching the directory name, Figma source coordinates, viewport dimensions).
3. Add `figma.json` with the Figma API node response for the view.
4. Add `reference.png` with the reference screenshot (valid PNG).
5. Run `pnpm benchmark:visual:update-baseline` to include the new fixture in the baseline.

## How it works in CI

The `.github/workflows/visual-benchmark.yml` workflow runs on pushes to `dev` and pull requests targeting `dev`. It installs dependencies, sets up Playwright, and runs `pnpm benchmark:visual`. The test suite validates that all fixtures load correctly and that the benchmark scoring infrastructure works as expected.

## Other maintenance commands

| Command                                       | Description                                              |
| --------------------------------------------- | -------------------------------------------------------- |
| `pnpm benchmark:visual:update-fixtures`       | Fetches latest Figma node data and updates figma.json    |
| `pnpm benchmark:visual:update-references`     | Fetches latest Figma exports and updates reference.png   |
| `pnpm benchmark:visual:live`                  | Runs a live audit comparing frozen fixtures against Figma |
