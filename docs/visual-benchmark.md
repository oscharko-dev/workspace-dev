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

The committed baseline lives at `integration/fixtures/visual-benchmark/baseline.json`.

Update it with:

```bash
pnpm benchmark:visual:update-baseline
```

This command:

1. runs the full benchmark
2. prints the current comparison table
3. overwrites `baseline.json` with the current real scores

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
| `pnpm benchmark:visual:update-fixtures`   | Refreshes frozen `figma.json` payloads from Figma |
| `pnpm benchmark:visual:update-references` | Regenerates committed `reference.png` files from the current benchmark output |
| `pnpm benchmark:visual:live`              | Compares frozen fixture data against live Figma responses |

## CI behavior

`.github/workflows/visual-benchmark.yml` runs `pnpm benchmark:visual` on pushes to `dev` and pull requests targeting `dev`.

The workflow installs Playwright Chromium and executes the same real benchmark runner used locally. It does not require `FIGMA_ACCESS_TOKEN` for the default benchmark path.
