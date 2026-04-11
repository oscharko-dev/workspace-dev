# Visual Benchmark — A/B Comparison Mode

A/B comparison mode runs the same Figma fixture set through two different
benchmark configurations and reports the visual quality delta side by side.
It is intended for evaluating generator optimizations and scoring trade-offs
without polluting the committed baseline.

The companion to the static [visual benchmark](visual-benchmark.md): where
benchmark mode compares the **current** run against the **committed
baseline**, A/B mode compares **two live runs** against each other.

## Running

```bash
pnpm benchmark:visual:ab \
  --config-a integration/fixtures/visual-benchmark-ab/strict.json \
  --config-b integration/fixtures/visual-benchmark-ab/loose.json
```

Each run uses the frozen fixtures under
`integration/fixtures/visual-benchmark/` (the same fixtures benchmark mode
uses), so the only thing that changes between Run A and Run B is the
quality/scoring configuration file you supply.

### CLI flags

| Flag                      | Required | Description                                                                                                                 |
| ------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--config-a <path>`       | yes      | Path to the JSON config file for run A                                                                                      |
| `--config-b <path>`       | yes      | Path to the JSON config file for run B                                                                                      |
| `--artifact-root <dir>`   | no       | Output root for run A, run B, and the comparison artifacts. Defaults to `artifacts/visual-benchmark-ab`.                    |
| `--neutral-tolerance <n>` | no       | Override the absolute score delta absorbed as neutral noise. Defaults to config B's `regression.neutralTolerance` (or `1`). |
| `--enforce-no-regression` | no       | Exit with code 1 when at least one comparison entry is classified as `degraded` after applying tolerance.                   |
| `--skip-three-way-diff`   | no       | Skip generating the `reference / A / B` PNG mosaics. The JSON comparison report is still produced.                          |

## Config file format

A/B configuration files are JSON. The schema is intentionally a thin wrapper
around the existing `visual-quality.config.json` schema so that it composes
with the rest of the visual quality system.

```json
{
  "label": "Strict",
  "description": "Tighter typography weight, fail threshold raised to 85",
  "qualityConfig": {
    "weights": {
      "layoutAccuracy": 0.25,
      "colorFidelity": 0.2,
      "typography": 0.3,
      "componentStructure": 0.15,
      "spacingAlignment": 0.1
    },
    "thresholds": {
      "warn": 85,
      "fail": 80
    },
    "regression": {
      "neutralTolerance": 1
    }
  },
  "browsers": ["chromium"],
  "viewportId": "desktop"
}
```

| Field                        | Type              | Notes                                                                                 |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| `label`                      | string (required) | Short name printed in the comparison table. Must differ between A and B.              |
| `description`                | string            | Optional human-readable explanation included in `comparison.json`.                    |
| `qualityConfig`              | object            | Same shape as `visual-quality.config.json`. Validated by the same Zod schema.         |
| `browsers`                   | string[]          | Optional override of the browser list for this side. `chromium`, `firefox`, `webkit`. |
| `viewportId`                 | string            | Optional single-viewport filter passed to the runner.                                 |
| `componentVisualCatalogFile` | string            | Optional path to a Storybook component catalog forwarded to the runner.               |
| `storybookStaticDir`         | string            | Optional Storybook static dir forwarded to the runner.                                |

Both labels must be distinct. The label is used to namespace warnings and to
build the comparison table headers.

### Comparability rule

A/B mode is only valid when both configs execute against the same effective
input surface. The following fields must either be omitted on both sides or
resolve to the same value in both configs:

- `browsers`
- `viewportId`
- `componentVisualCatalogFile`
- `storybookStaticDir`

Different values for any of those fields make the run non-comparable, because
Run A and Run B would no longer be rendering the same benchmark surface. Keep
those fields shared across both configs and restrict the A/B difference to the
quality/scoring settings inside `qualityConfig`.

The committed sample configs under
`integration/fixtures/visual-benchmark-ab/strict.json` and
`integration/fixtures/visual-benchmark-ab/loose.json` follow that rule: they
use the same browser list on both sides and leave the other execution-shaping
fields unset so they work across the frozen fixture corpus.

## Output layout

```
artifacts/visual-benchmark-ab/
  comparison.json          ← machine-readable diff between A and B
  comparison.txt           ← box-drawing comparison table (same content as stdout)
  config-a/
    last-run/...           ← exact same layout as `pnpm benchmark:visual`
  config-b/
    last-run/...
  three-way/
    <fixture-id>/
      <screen-token>/
        <viewport-id>.png  ← horizontal mosaic: reference | A | B
```

The per-run subdirectories are byte-for-byte equivalent to a normal
`pnpm benchmark:visual` artifact tree. Tools that already inspect
`artifacts/visual-benchmark/last-run/...` can be pointed at
`artifacts/visual-benchmark-ab/config-a/last-run/...` and behave identically.

## Comparison report

`comparison.json` contains:

- `configA` / `configB`: label, optional description, overall score
- `entries[]`: one row per `fixtureId + screenId + viewportId`, with
  `scoreA`, `scoreB`, `delta`, and `indicator` (`improved`, `degraded`,
  `neutral`, or `unavailable` when one side is missing), plus `threeWayDiff`
  metadata describing whether the mosaic was generated, skipped, or failed
- `overallDelta`: B − A on the overall current score
- `statistics`: `improvedCount`, `degradedCount`, `neutralCount`,
  `meanDelta`, `meanImprovement`, `bestImprovement`, `worstRegression`,
  `netChange`
- `warnings[]`: aggregated, prefixed with the originating config label

The same data is rendered as a Unicode box-drawing table on stdout, e.g.:

```text
┌─────────────────────────────────┬──────────┬──────────┬────────────┐
│ View                            │ Strict   │ Loose    │ B vs A     │
├─────────────────────────────────┼──────────┼──────────┼────────────┤
│ Simple Form / Form / Desktop    │       80 │       85 │ +5 ✅      │
│ Complex Dashboard / Desktop     │       72 │       71 │ -1 ➖      │
├─────────────────────────────────┼──────────┼──────────┼────────────┤
│ Overall Average                 │       76 │       78 │ +2         │
└─────────────────────────────────┴──────────┴──────────┴────────────┘
```

A statistical summary block follows the table:

```text
Statistical summary (Loose vs Strict):
  Compared entries:    5/5
  Improved (✅):       2
  Degraded (⚠️):       1
  Neutral (➖):        2
  Mean delta:          1.4
  Mean improvement:    4
  Best improvement:    5
  Worst regression:    -1
  Net change:          7
```

## Three-way diff images

For each comparison entry, A/B mode looks up:

1. The committed reference image at
   `<fixture>/screens/<token>/<viewport>.png` (or the legacy `reference.png`)
2. Run A's `actual.png` from `config-a/last-run/...`
3. Run B's `actual.png` from `config-b/last-run/...`

It composes them into a single horizontal PNG and writes it to
`three-way/<fixture-id>/<token>/<viewport>.png`. Sides that are entirely
missing (no manifest, no file) are replaced with neutral grey placeholders so
the mosaic still renders.

The composer **does not resample images**. It places each side at its native
size and centers shorter sides vertically. To prevent visually misleading
mosaics where a tiny image sits next to a huge one, the composer rejects
inputs whose largest/smallest dimension ratio exceeds **4×** (the
`DEFAULT_THREE_WAY_DIVERGENCE_LIMIT`). When this happens the entry is
recorded as `skipped` with reason `dimension-divergence`, and stdout shows
the per-entry skip reason. Callers that need to compose deliberately divergent
inputs can pass a higher `maxDimensionRatio` programmatically.

The persistence layer also distinguishes related failure modes for each entry,
surfaced in stdout as `Three-way diff: wrote N, skipped M` followed by
per-entry reasons:

- `all-inputs-missing` — neither the reference nor either side artifact
  could be read.
- `side-a-artifact-missing-on-disk` / `side-b-artifact-missing-on-disk` —
  the run wrote a manifest entry but the underlying `actual.png` is gone
  (partial-corruption signal). This is treated as a hard skip rather than
  silently substituting a placeholder.
- `dimension-divergence` — see above.
- `compose-failed` — any other error from PNG composition (logged with
  `detail`).

The same outcome is also attached to each `comparison.json` entry under
`threeWayDiff`, so downstream tooling can distinguish generated artifacts from
disabled, missing-input, and failed rows without scraping stdout.

Pass `--skip-three-way-diff` to disable this step entirely (e.g. in CI when
only the JSON comparison is needed).

## Determinism

- The same fixtures and the same configs always produce the same scores
  (the underlying scoring engine is pure given identical inputs).
- The comparison table sorts entries by `fixtureId, screenId, viewportId`
  before rendering.
- `comparison.json` is written with sorted object keys so identical inputs
  yield byte-identical files. This makes A/B reports straightforward to
  diff in code review or to commit as a snapshot for downstream tooling.
- Neither A nor B touches `baseline.json` or `history.json`. A/B mode is
  read-only with respect to the committed baseline.

## Concurrency

A and B run **strictly sequentially**, not in parallel. The underlying
benchmark runner spawns a Playwright browser, builds the generated template,
and writes intermediate state into temporary directories under `os.tmpdir()`.
Two parallel runs would compete for the same browser binary, the same
Playwright download lock, and the same per-fixture build cache, producing
flaky captures and non-deterministic scores. The `config-a/` and `config-b/`
artifact subdirectories isolate the _outputs_, not the intermediate runtime —
sequential execution is the deliberate, conservative choice. Expected
wall-clock cost is roughly `2 × pnpm benchmark:visual`.

## When to use A/B mode vs benchmark mode

- Use **benchmark mode** (`pnpm benchmark:visual`) to verify that the
  current build still meets the committed quality bar.
- Use **A/B mode** (`pnpm benchmark:visual:ab`) when you want to compare
  two configurations head-to-head — typically because you are tuning
  scoring weights and regression thresholds while keeping browser, viewport,
  catalog, and Storybook inputs fixed, and you want explicit per-screen
  evidence of the trade-offs before promoting one config to the committed
  baseline.
