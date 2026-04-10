# Visual Benchmark

The visual benchmark provides a fixed five-fixture test set for comparing generator output against committed reference screenshots.
Storage and comparisons are screen-aware: score records are keyed by `fixtureId + screenId`, with optional `screenName` metadata for display and migration. The current committed fixture set still maps one screen to each fixture, so the CLI output continues to read like a five-row fixture benchmark today.

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

The output is a comparison table with one row per benchmark screen plus an overall average. In the current fixture set that still means one row per fixture:

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
- `integration/fixtures/visual-benchmark/baseline.json` for deterministic score tracking at fixture-plus-screen granularity

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

`baseline.json` is persisted as schema `version: 3`:

```json
{
  "version": 3,
  "scores": [
    {
      "fixtureId": "simple-form",
      "screenId": "1:65671",
      "screenName": "Bedarfsermittlung; Netto + Betriebsmittel; alle Cluster eingeklappt  ID-003.1_v1",
      "score": 88
    }
  ]
}
```

Older baseline files (`version: 1` and `version: 2`) are still accepted on read. They are normalized in memory and rewritten as `version: 3` on the next baseline mutation path.

The legacy compatibility command below still exists and delegates to the same baseline update flow:

```bash
pnpm benchmark:visual:update-baseline
```

## Interpreting deltas

- `improved`: delta greater than `+neutralTolerance`
- `degraded`: delta less than `-neutralTolerance`
- `neutral`: delta within `±neutralTolerance`

The default `neutralTolerance` is `1` point when the config does not override it.
It is resolved from
`integration/fixtures/visual-benchmark/visual-quality.config.json > regression > neutralTolerance`.
The same setting is used for benchmark delta classification, regression trend direction, and baseline maintenance commands such as `visual:baseline status` and `visual:baseline diff`. This band absorbs small rendering variance so deterministic reruns do not oscillate between improved and degraded and prevents false-positive regression alerts from environmental noise.

## Responsive viewport validation

Fixtures can declare one or more viewports (desktop, tablet, mobile) to capture and
score the same screen at different widths and device pixel ratios. Viewports are
configured in `integration/fixtures/visual-benchmark/visual-quality.config.json`:

```json
{
  "viewports": [
    { "id": "desktop", "width": 1280, "height": 800, "deviceScaleFactor": 1 },
    { "id": "tablet", "width": 768, "height": 1024, "deviceScaleFactor": 2 },
    { "id": "mobile", "width": 390, "height": 844, "deviceScaleFactor": 3 }
  ]
}
```

Resolution precedence, most specific wins: `screen-level > fixture-level > global > default`.
The default is a single `desktop` viewport at `1280x800` with `deviceScaleFactor: 1`,
which keeps single-viewport fixtures byte-identical to pre-#838 behavior.

Current build supports per-viewport config resolution and passes the effective
viewport to the `validate-project` pipeline via `visualQualityViewportHeight` and
`visualQualityDeviceScaleFactor` runtime fields. The multi-viewport execution loop
is scheduled as a follow-up; today a run uses the first resolved viewport.

The `--viewport <id>` CLI flag on `pnpm benchmark:visual` is parsed and validated
for future per-viewport filtering. Runner integration follows.

Reference images live at `<fixture>/screens/<screenToken>/<viewportId>.png` when
multi-viewport is configured; legacy `reference.png` is used otherwise.

## Historical trend analysis and regression detection

After each benchmark run the runner emits a per-fixture trend summary alongside
the comparison table:

```text
Trend (per fixture):
  simple-form: 87 (↓3 from baseline 90)
  complex-dashboard: 82 (↑2 from baseline 80)
  data-table: 91 (→0 from baseline 91)
```

Internally those trend comparisons are scoped by `fixtureId + screenId`. The block header still says `Trend (per fixture)` because the committed benchmark set currently contains one screen per fixture.

When a fixture's current score drops more than `maxScoreDropPercent` below its
committed baseline, the runner emits an `ALERT_VISUAL_QUALITY_DROP` alert:

```text
1 visual quality regression alert(s):
  ⚠️ ALERT_VISUAL_QUALITY_DROP: Visual quality dropped 11.11% for fixture 'simple-form' (baseline 90 -> current 80).
```

Alerts are returned on `VisualBenchmarkResult.alerts` as `KpiAlert` objects so
downstream KPI pipelines can ingest them without custom translation.

### Regression configuration

Tune regression behavior in `integration/fixtures/visual-benchmark/visual-quality.config.json`:

```json
{
  "regression": {
    "maxScoreDropPercent": 5,
    "neutralTolerance": 1,
    "historySize": 20
  }
}
```

- `maxScoreDropPercent` (default `5`): percentage drop above which an
  `ALERT_VISUAL_QUALITY_DROP` alert is emitted. A drop equal to the threshold
  does NOT alert — only drops strictly greater than the threshold do.
- `neutralTolerance` (default `1`): absolute point delta absorbed as
  environmental variance. Applies to both improvement and degradation
  indicators and to the regression detector's "down" classification.
- `historySize` (default `20`, max `1000`): ring buffer size for
  `integration/fixtures/visual-benchmark/history.json` which tracks the last
  N benchmark runs.

### History file

`integration/fixtures/visual-benchmark/history.json` is a committed ring buffer
of the last N benchmark runs. It is updated on every benchmark execution path,
including ordinary `pnpm benchmark:visual` runs and baseline-maintenance flows
that persist fresh scores. The file remains bounded by `historySize`, so the
oldest entry is dropped once the ring buffer limit is exceeded.

History loaders remain backward-compatible with legacy `version: 1` files that
only stored fixture-level scores. Those files are normalized in memory to the
current screen-aware model and rewritten as `version: 2` on the next save.

Schema:

```json
{
  "version": 2,
  "entries": [
    {
      "runAt": "2026-04-10T00:00:00.000Z",
      "scores": [
        {
          "fixtureId": "complex-dashboard",
          "screenId": "2:10001",
          "screenName": "Dashboard — KPI Overview, Charts, Activity Feed",
          "score": 82
        },
        {
          "fixtureId": "data-table",
          "screenId": "2:10002",
          "screenName": "Data Table — Sortable Columns, Pagination, Filters",
          "score": 91
        },
        {
          "fixtureId": "design-system-showcase",
          "screenId": "2:10004",
          "screenName": "Design System — Buttons, Inputs, Cards, Typography Scale",
          "score": 84
        },
        {
          "fixtureId": "navigation-sidebar",
          "screenId": "2:10003",
          "screenName": "Navigation Sidebar — Menu Items, Nested Groups, Icons",
          "score": 78
        },
        {
          "fixtureId": "simple-form",
          "screenId": "1:65671",
          "screenName": "Bedarfsermittlung; Netto + Betriebsmittel; alle Cluster eingeklappt  ID-003.1_v1",
          "score": 88
        }
      ]
    }
  ]
}
```

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

| Command                                   | Description                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm visual:baseline update`             | Run benchmark, persist last-run artifacts, update committed references, metadata, and score baseline |
| `pnpm visual:baseline approve --screen`   | Promote a persisted last-run `actual.png` to the committed reference for one fixture                 |
| `pnpm visual:baseline status`             | Show per-fixture baseline status including capture age and pending diffs                             |
| `pnpm visual:baseline diff`               | Summarize pending diffs from persisted last-run artifacts                                            |
| `pnpm benchmark:visual:update-fixtures`   | Refreshes frozen `figma.json` payloads from Figma                                                    |
| `pnpm benchmark:visual:update-references` | Regenerates committed `reference.png` files from the current benchmark output                        |
| `pnpm benchmark:visual:update-baseline`   | Compatibility shim for `pnpm visual:baseline update`                                                 |
| `pnpm benchmark:visual:live`              | Compares frozen fixture data against live Figma responses                                            |

## CI behavior

`.github/workflows/visual-benchmark.yml` runs `pnpm benchmark:visual` on pushes to `dev` and pull requests targeting `dev`.

The workflow installs Playwright Chromium and executes the same real benchmark runner used locally. It does not require `FIGMA_ACCESS_TOKEN` for the default benchmark path.

## Further reading

For comprehensive documentation on the visual quality assessment system including architecture, scoring dimensions, score interpretation, and CI integration details, see [Visual Quality Assessment](visual-quality-assessment.md).
