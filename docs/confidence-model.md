# Generation Confidence Model

> Issue: #849 | Contract Version: 3.10.0

## Overview

The confidence model scores every generated job, screen, and component based on the strength of upstream evidence and downstream validation outcomes. Unlike quality scores (which measure output fidelity), confidence measures how certain the system is that the output is correct.

## Key Distinction: Confidence vs Quality

| Aspect          | Confidence                         | Quality Score                 |
| --------------- | ---------------------------------- | ----------------------------- |
| **Measures**    | System certainty about correctness | Output fidelity to design     |
| **Data source** | Pipeline signals and evidence      | Visual comparison and metrics |
| **Use case**    | Prioritize review effort           | Measure generation accuracy   |
| **Range**       | 0–100 (high/medium/low/very_low)   | 0–100 (visual + performance)  |
| **Failure**     | Low confidence ≠ failure           | Low quality = regression      |

## Signal Sources

The scoring model fuses 6 weighted signals:

| Signal                 | Weight | Source                 | Interpretation                                  |
| ---------------------- | ------ | ---------------------- | ----------------------------------------------- |
| `diagnostic_severity`  | 0.15   | Pipeline diagnostics   | Fewer errors/warnings → higher confidence       |
| `component_match_rate` | 0.25   | Component match report | More matched components → higher confidence     |
| `generation_integrity` | 0.15   | Generation metrics     | No truncation/degradation → higher confidence   |
| `visual_quality`       | 0.25   | Visual quality report  | Higher visual score → higher confidence         |
| `storybook_evidence`   | 0.10   | Storybook evidence     | More authoritative evidence → higher confidence |
| `validation_passed`    | 0.10   | Validation summary     | Build/lint/typecheck pass → higher confidence   |

When a signal source is unavailable (e.g., visual quality not enabled), it contributes a neutral 0.5 value.

## Confidence Levels

| Level      | Score Range | Recommended Action                                |
| ---------- | ----------- | ------------------------------------------------- |
| `high`     | ≥ 80        | Light review — focus on business logic            |
| `medium`   | 60–79       | Standard review — check flagged areas             |
| `low`      | 40–59       | Thorough review — multiple low-confidence signals |
| `very_low` | < 40        | Deep review — significant evidence gaps           |

## Explainable Contributors

Each confidence score includes a sorted list of contributors explaining why the score is what it is. Contributors are sorted by absolute impact (weight × |1 − value|), so the most influential signals appear first.

Example:

```json
{
  "signal": "component_match_rate",
  "impact": "negative",
  "weight": 0.25,
  "value": 0.35,
  "detail": "Component match rate is 35.0% (weighted average of per-component confidence scores)"
}
```

## Screen-Level Confidence

Screens with generation issues (truncation, depth limits) receive additional penalties on top of the job-level score:

- Truncated screens: −10 points per screen (capped)
- Depth-truncated screens: −10 points per screen (capped)

## Component-Level Confidence

Per-component confidence comes directly from the component match report's confidence scoring (0–100 scale), mapped to the same level thresholds.

## Low Confidence Summary

The `lowConfidenceSummary` field lists the top 3 negative contributors as human-readable strings, suitable for display in review UIs and reports.

## Pipeline Integration

Confidence is computed in the `validate.project` stage after all other validation gates. It is persisted as:

- **File artifact**: `confidence-report.json` (human-readable)
- **Value artifact**: `confidence.result` (structured data for projection)

The confidence report is included in:

- `WorkspaceJobStatus.confidence`
- `WorkspaceJobResult.confidence`
- `WorkspaceJobArtifacts.confidenceReportFile`
- Validation summary artifact

## KPI Integration

Confidence scores are tracked in the KPI model:

- `confidenceScoreAvg` / `confidenceScoreP50` on project snapshots
- `confidenceScoreAvg` on portfolio and trend buckets
- `confidenceScoreDelta` on baseline comparisons
- `ALERT_CONFIDENCE_DROP` / `ALERT_CONFIDENCE_LOW_SCREEN` alert codes

## Inspector UI

The Inspector UI displays confidence through:

- **Dashboard card**: Job confidence level, score, and low-confidence summary
- **Confidence overlay**: Screen gallery overlay coloring regions by confidence level
- **Signal breakdown**: Expandable table showing all contributor signals
