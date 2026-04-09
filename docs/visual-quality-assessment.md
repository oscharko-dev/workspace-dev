# Visual Quality Assessment

The visual quality assessment system provides automated visual comparison of generated output against reference screenshots. It captures a screenshot of each generated project, diffs it pixel-by-pixel against a reference image, and produces a multi-dimensional quality score. Results are written as artifacts alongside the job output.

For benchmark-specific details (fixture management, baseline tracking, CI workflow), see [docs/visual-benchmark.md](./visual-benchmark.md).

## Usage Guide

### Enabling Per-Job Visual Quality Reports

To enable visual quality validation for a job, submit with the following options:

- `enableVisualQualityValidation: true` activates the visual quality pipeline for that job.
- `visualQualityReferenceMode` controls where the reference image comes from. Set to `"figma_api"` to fetch a live export from Figma, or `"frozen_fixture"` to use a committed reference screenshot. Defaults to `"figma_api"` for normal jobs.
- `visualQualityViewportWidth` sets the browser viewport width in pixels. Defaults to `1280`.

When the pipeline completes, a `visual-quality/` directory is written inside the job directory containing four files:

| File | Contents |
|------|----------|
| `reference.png` | The reference image used for comparison |
| `actual.png` | The captured screenshot of the generated output |
| `diff.png` | Pixel difference overlay highlighting deviations |
| `report.json` | Full scoring report with dimension scores, hotspots, and region data |

### Running the Visual Benchmark Suite

```bash
pnpm benchmark:visual
```

This runs the five-fixture benchmark using frozen fixtures from `integration/fixtures/visual-benchmark/`. No Figma token is required. The output is an ASCII comparison table showing baseline scores, current scores, and deltas for each fixture.

### Interpreting Quality Scores and Diff Images

See the [Score Interpretation](#score-interpretation) section below for detailed guidance on what scores mean and when to act. Diff images use pixelmatch highlighting where red pixels indicate deviations from the reference.

### Updating Baselines After Intentional Changes

```bash
pnpm visual:baseline update
pnpm visual:baseline update --fixture simple-form
pnpm visual:baseline approve --screen simple-form
```

These commands manage the committed visual baseline end-to-end:

- `update` reruns the selected fixtures, persists `actual.png` / `diff.png` / `report.json` under `artifacts/visual-benchmark/last-run/<fixture-id>/`, updates committed `reference.png`, refreshes fixture `metadata.json`, and syncs `baseline.json`.
- `approve` promotes a persisted last-run `actual.png` for one fixture to the committed `reference.png` without rerunning the full suite.

The tracked score baseline lives at `integration/fixtures/visual-benchmark/baseline.json` and now follows a deterministic schema:

```json
{
  "version": 2,
  "scores": [
    { "fixtureId": "simple-form", "score": 88 }
  ]
}
```

### Updating Frozen Fixtures and References

Three maintenance commands handle fixture data:

| Command | Description | Requires Token |
|---------|-------------|----------------|
| `pnpm visual:baseline update` | Refresh committed references, metadata, and deterministic score baseline | No |
| `pnpm visual:baseline approve --screen <fixture-id>` | Promote one persisted last-run image to the committed reference | No |
| `pnpm visual:baseline status` | Show per-fixture baseline state, capture age, and pending diffs | No |
| `pnpm visual:baseline diff` | Summarize pending diffs from persisted last-run artifacts | No |
| `pnpm benchmark:visual:update-references` | Regenerates `reference.png` files from the current pipeline (offline) | No |
| `pnpm benchmark:visual:update-fixtures` | Fetches fresh `figma.json` payloads from live Figma | Yes (`FIGMA_ACCESS_TOKEN`) |
| `pnpm benchmark:visual:live` | Audits drift between frozen fixtures and live Figma data | Yes (`FIGMA_ACCESS_TOKEN`) |

## Architecture

### Component Overview

The visual quality pipeline is a four-stage process from reference input through to final report:

```text
Figma API / frozen figma.json
        |
        v
visual-capture.ts --- headless Chromium (Playwright)
        |
        v  screenshotBuffer (PNG)
visual-diff.ts --- pixelmatch + pngjs
        |
        v  VisualDiffResult
visual-scoring.ts --- 5-dimension weighted scoring
        |
        v  VisualQualityReport
validate-project-service.ts --- writes to jobDir/visual-quality/
        |
        v
visual-benchmark-runner.ts --- delta vs. baseline.json
        |
        v
stdout / CI artifact
```

### Key Source Files

| File | Purpose |
|------|---------|
| `src/job-engine/visual-capture.ts` | Screenshot capture via headless Playwright Chromium; starts a local static file server per job |
| `src/job-engine/visual-diff.ts` | Pixel-by-pixel PNG diff using pixelmatch + pngjs; splits image into 5 named regions |
| `src/job-engine/visual-scoring.ts` | Turns a `VisualDiffResult` into a weighted `VisualQualityReport` with 5 dimension scores and hotspots |
| `src/job-engine/visual-quality-reference.ts` | Loads reference images from Figma API or frozen fixture files |
| `src/job-engine/services/validate-project-service.ts` | Orchestrates visual quality within the validation pipeline |
| `integration/visual-benchmark-runner.ts` | Orchestrates all fixtures, loads/saves `baseline.json`, computes deltas |
| `integration/visual-benchmark.execution.ts` | Runs the full pipeline for one fixture |
| `integration/visual-benchmark.helpers.ts` | Fixture I/O utilities |
| `integration/visual-benchmark.update.ts` | Maintenance: refresh fixtures, regenerate references, live drift audit |
| `integration/visual-benchmark.cli.ts` | CLI entry point |

### Integration with the Validation Pipeline

The `validate.project` stage in the pipeline handles visual quality. When `enableVisualQualityValidation` is true, the service executes the following steps:

1. Loads the reference image. The source depends on `visualQualityReferenceMode`: `"figma_api"` fetches a live export from Figma, while `"frozen_fixture"` reads a committed `reference.png`.
2. Captures a screenshot of the generated project using `captureFromProject`.
3. Computes a pixel diff using `comparePngBuffers`.
4. Generates a `VisualQualityReport` using `computeVisualQualityReport`.
5. Writes `reference.png`, `actual.png`, `diff.png`, and `report.json` to `<jobDir>/visual-quality/`.

The report is attached to `job.visualQuality` and persisted as a stage artifact.

### Data Flow

**1. Capture.** `captureFromProject` starts a local HTTP server serving the generated project files, launches headless Chromium via Playwright, navigates to the served page, and waits for network idle, font loading, and animations to settle. It then calls `page.screenshot({ fullPage: true, type: "png" })`. The default viewport is 1280x720 at scale 1.

**2. Diff.** `comparePngBuffers` runs pixelmatch with a threshold of 0.1 and antialiasing detection disabled. The image is partitioned into five regions: header (top 20% of height), content-left/center/right (middle 60% of height, split into thirds by width), and footer (bottom 20% of height). Each region receives its own deviation percentage. The overall similarity score is computed as `Math.round((1 - diffPixels / totalPixels) * 10000) / 100`, yielding a value between 0 and 100 with two-decimal precision.

**3. Score.** `computeVisualQualityReport` applies five weighted dimensions to the region scores (see [Scoring Dimensions](#scoring-dimensions) below). The overall score is `sum(dimensionScore * weight)`, producing a value in the range 0 to 100.

**4. Report.** The results are written to disk as four files in the `visual-quality/` subdirectory and attached to the job projection for downstream consumption.

## Score Interpretation

### Overall Score Ranges

| Score Range | Interpretation | Action |
|-------------|---------------|--------|
| 90 or above | Excellent parity --- minor sub-pixel or anti-aliasing differences | No action needed |
| 70--89 | Good parity --- small layout or color deviations | Review diff image for acceptability |
| 50--69 | Moderate deviations --- visible differences in structure or styling | Investigate cause; likely needs generator fix |
| Below 50 | Significant deviations --- major layout or component mismatches | Requires immediate investigation |

### Scoring Dimensions

The overall score is a weighted composite of five dimensions. Weights sum to 1.0; the runtime validates this and throws if the sum deviates by more than 0.001.

| Dimension | Weight | Source | Description |
|-----------|--------|--------|-------------|
| Layout Accuracy | 0.30 | Area-weighted average of all 5 region scores | How well the overall spatial layout matches the reference |
| Color Fidelity | 0.25 | Overall `similarityScore` directly | How closely pixel colors match across the full image |
| Typography | 0.20 | Weighted average of the 3 content-* region scores | Text rendering accuracy in the main content area |
| Component Structure | 0.15 | `100 - stdDev * 2` across all region scores | Cross-region consistency --- low variance means uniform quality |
| Spacing and Alignment | 0.10 | Average of header + footer region scores | Edge-area accuracy indicating margin/padding fidelity |

If no regions are available for a given dimension (for example, if the image is too small to partition), the overall `similarityScore` is used as a fallback.

### Image Regions

The diff engine partitions the captured image into five named regions:

| Region | Position | Purpose |
|--------|----------|---------|
| header | Top 20% of height, full width | Navigation, app bar |
| content-left | Middle 60% of height, left third of width | Sidebar, primary content |
| content-center | Middle 60% of height, center third of width | Main content area |
| content-right | Middle 60% of height, right third of width | Secondary content, panels |
| footer | Bottom 20% of height, full width | Footer, status bar |

### Deviation Hotspots

The report includes the top N regions ranked by deviation percentage (default: 5). Each hotspot is assigned a severity level and a category:

| Severity | Deviation % | Meaning |
|----------|-------------|---------|
| low | Below 5% | Minor rendering differences |
| medium | 5--20% | Noticeable but potentially acceptable |
| high | 20--50% | Significant visual differences |
| critical | 50% or above | Major rendering failure |

Hotspot categories are assigned by region name: header and footer regions are categorized as "spacing", content-* regions as "layout", and any others as "color".

### Common Deviation Patterns

| Pattern | Likely Cause | Resolution |
|---------|-------------|------------|
| High deviation in header/footer only | Margin or padding differences | Check CSS spacing in generated output |
| Uniform moderate deviation across all regions | Font rendering differences | May be platform-dependent; check font loading |
| High deviation in one content region | Component rendering issue | Inspect the specific component in that area |
| Low overall score with low standard deviation | Consistent color shift | Check theme colors, opacity values |
| High Component Structure score but low Layout | Consistent but wrong layout | Check grid/flex container settings |

### When to Accept vs. Investigate

- **Accept**: score is 90 or above, or the benchmark delta is within the neutral band (plus or minus 1 point from baseline).
- **Investigate**: score dropped more than 1 point from baseline, or any hotspot is flagged as "high" or "critical".
- **Benchmark neutral band**: the plus-or-minus 1 neutral band in benchmark deltas absorbs small rendering variance so deterministic reruns do not oscillate between improved and degraded.

## Benchmark Mode

### Fixed Fixture Set

The benchmark uses five frozen fixtures stored at `integration/fixtures/visual-benchmark/`. See [docs/visual-benchmark.md](./visual-benchmark.md) for full details on fixture layout and maintenance.

| Fixture | Description |
|---------|-------------|
| `simple-form` | Basic form layout |
| `complex-dashboard` | Multi-panel dashboard |
| `data-table` | Data table view |
| `navigation-sidebar` | Sidebar navigation layout |
| `design-system-showcase` | Design system component showcase |

Each fixture directory contains:

- `figma.json` --- frozen Figma API payload
- `metadata.json` --- source nodeId, viewport, export scale
- `reference.png` --- committed reference screenshot
- `manifest.json` --- paths to reference image and metadata

### Benchmark Deltas

| Indicator | Condition | Meaning |
|-----------|-----------|---------|
| improved | Delta greater than +1 | Score went up meaningfully |
| degraded | Delta less than -1 | Score went down meaningfully |
| neutral | Absolute delta is 1 or less | Within rendering variance |

### Command Reference

| Command | Description | Requires Token |
|---------|-------------|----------------|
| `pnpm benchmark:visual` | Run benchmark, compare to baseline, print table | No |
| `pnpm visual:baseline update` | Refresh committed references, metadata, and `baseline.json` | No |
| `pnpm visual:baseline approve --screen <fixture-id>` | Promote one persisted last-run image to the committed reference | No |
| `pnpm visual:baseline status` | Show per-fixture baseline state and capture age | No |
| `pnpm visual:baseline diff` | Summarize pending diffs from persisted last-run artifacts | No |
| `pnpm benchmark:visual:update-baseline` | Compatibility shim for `pnpm visual:baseline update` | No |
| `pnpm benchmark:visual:update-references` | Regenerate `reference.png` from current pipeline | No |
| `pnpm benchmark:visual:update-fixtures` | Refresh `figma.json` from live Figma | Yes |
| `pnpm benchmark:visual:live` | Audit drift vs. live Figma | Yes |

## CI Integration

### Current Behavior (V1 --- Report Only)

The visual benchmark runs in CI via `.github/workflows/visual-benchmark.yml`:

- **Triggers**: push to `dev`, pull requests targeting `dev`, and `workflow_dispatch`.
- **Runner**: `ubuntu-latest` with Node 22 and a 30-minute timeout.
- **Steps**: checkout, `pnpm install`, Playwright Chromium install, then `pnpm benchmark:visual`.
- **No Figma token required** --- the workflow uses frozen fixtures exclusively.
- **No fail-on-degradation gate** --- the workflow prints the comparison table but does not exit non-zero on regressions. This is intentional for V1 (report-only mode).

### Where to Find Reports

- **Local**: the `<jobDir>/visual-quality/` directory contains `reference.png`, `actual.png`, `diff.png`, and `report.json`.
- **Baseline maintenance cache**: `artifacts/visual-benchmark/last-run/<fixture-id>/` stores the most recent benchmark `actual.png`, `diff.png`, and `report.json` used by `visual:baseline diff` and `visual:baseline approve`.
- **CI**: benchmark output is printed to the workflow log as an ASCII table.
- **Benchmark baseline**: `integration/fixtures/visual-benchmark/baseline.json`.

### Comparing Scores Across Branches

1. Run `pnpm benchmark:visual` on each branch.
2. Compare the ASCII table output or the scores in `baseline.json`.
3. A delta greater than +1 indicates improvement; a delta less than -1 indicates degradation.
4. Use `pnpm visual:baseline update` on the branch with the desired output to refresh the committed visual baseline.
