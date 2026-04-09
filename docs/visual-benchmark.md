# Visual Benchmark

The visual benchmark provides a fixed five-fixture test set for comparing generator output against committed reference screenshots.

Default benchmark runs are offline:

- they use frozen `figma.json` fixtures from `integration/fixtures/visual-benchmark`
- they generate a fresh project for each fixture
- they build the generated app
- they capture the rendered output in headless Chromium
- they compute a visual quality score against the committed reference image

## Running the benchmark

```bash
pnpm benchmark:visual
```

This command runs the real benchmark runner, not the benchmark test suite.

The output is a comparison table with one row per fixture plus an overall average:

```text
┌─────────────────────────┬──────────┬──────────┬────────┐
│ View                    │ Baseline │ Current  │ Delta  │
├─────────────────────────┼──────────┼──────────┼────────┤
│ Simple Form             │ 85       │ 88       │ +3 ✅  │
│ Complex Dashboard       │ 72       │ 71       │ -1 ➖  │
├─────────────────────────┼──────────┼──────────┼────────┤
│ Overall Average         │ 78.5     │ 79.5     │ +1     │
└─────────────────────────┴──────────┴──────────┴────────┘
```

## Baseline management

The committed visual baseline consists of:

- `reference.png` in each fixture directory
- `metadata.json` in each fixture directory
- `integration/fixtures/visual-benchmark/baseline.json` for deterministic score tracking

Use the dedicated baseline CLI for day-to-day maintenance:

```bash
pnpm visual:baseline update
pnpm visual:baseline update --fixture simple-form
pnpm visual:baseline approve --screen simple-form
pnpm visual:baseline status
pnpm visual:baseline diff
```

`pnpm visual:baseline update` runs the selected fixture benchmarks, saves the latest `actual.png`/`diff.png`/`report.json` artifacts under `artifacts/visual-benchmark/last-run/<fixture-id>/`, updates the committed `reference.png`, refreshes fixture `metadata.json`, and syncs the tracked score baseline.

`pnpm visual:baseline approve --screen <fixture-id>` promotes the last persisted `actual.png` for that fixture to the committed `reference.png` without rerunning the full suite.

`pnpm visual:baseline status` shows the current committed baseline state per fixture, including capture date and age in days.

`pnpm visual:baseline diff` summarizes pending diffs from the persisted last-run artifacts without rerunning the benchmark.

The legacy compatibility command below still exists and delegates to the same baseline update flow:

```bash
pnpm benchmark:visual:update-baseline
```

## Interpreting deltas

- `improved`: delta greater than `+1`
- `degraded`: delta less than `-1`
- `neutral`: delta within `±1`

The `±1` neutral band is intentional. It absorbs small rendering variance so deterministic reruns do not oscillate between improved and degraded.

## Fixture layout

Each benchmark fixture directory under `integration/fixtures/visual-benchmark/<fixture-id>/` contains:

- `figma.json`: frozen Figma input for the view
- `metadata.json`: frozen reference metadata including capture size
- `reference.png`: committed reference screenshot
- `manifest.json`: fixture-local manifest used by `validate.project` to locate the frozen reference

The committed fixture set contains exactly five benchmark views:

- `simple-form`
- `complex-dashboard`
- `data-table`
- `navigation-sidebar`
- `design-system-showcase`

## Maintenance commands

`pnpm benchmark:visual:update-fixtures` and `pnpm benchmark:visual:live` refresh data from live Figma and require `FIGMA_ACCESS_TOKEN`.

`pnpm benchmark:visual:update-references` is offline. It regenerates each committed `reference.png` from the current benchmark pipeline output.

| Command                                   | Description |
| ----------------------------------------- | ----------- |
| `pnpm visual:baseline update`             | Run benchmark, persist last-run artifacts, update committed references, metadata, and score baseline |
| `pnpm visual:baseline approve --screen`   | Promote a persisted last-run `actual.png` to the committed reference for one fixture |
| `pnpm visual:baseline status`             | Show per-fixture baseline status including capture age and pending diffs |
| `pnpm visual:baseline diff`               | Summarize pending diffs from persisted last-run artifacts |
| `pnpm benchmark:visual:update-fixtures`   | Refreshes frozen `figma.json` payloads from Figma |
| `pnpm benchmark:visual:update-references` | Regenerates committed `reference.png` files from the current benchmark output |
| `pnpm benchmark:visual:update-baseline`   | Compatibility shim for `pnpm visual:baseline update` |
| `pnpm benchmark:visual:live`              | Compares frozen fixture data against live Figma responses |

## CI behavior

`.github/workflows/visual-benchmark.yml` runs `pnpm benchmark:visual` on pushes to `dev` and pull requests targeting `dev`.

The workflow installs Playwright Chromium and executes the same real benchmark runner used locally. It does not require `FIGMA_ACCESS_TOKEN` for the default benchmark path.

## Further reading

For comprehensive documentation on the visual quality assessment system including architecture, scoring dimensions, score interpretation, and CI integration details, see [Visual Quality Assessment](visual-quality-assessment.md).
