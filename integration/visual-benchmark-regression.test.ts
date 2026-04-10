import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_VISUAL_BENCHMARK_REGRESSION_CONFIG,
  detectVisualBenchmarkRegression,
  formatVisualBenchmarkTrendLine,
  formatVisualBenchmarkTrendSummaryBlock,
  type VisualBenchmarkRegressionConfig,
  type VisualBenchmarkScoreCandidate,
  type VisualBenchmarkTrendSummary,
} from "./visual-benchmark-regression.js";

const makeCandidate = (
  fixtureId: string,
  current: number,
  baseline: number | null,
  screenId = `${fixtureId}-screen`,
  screenName = `${fixtureId} screen`,
): VisualBenchmarkScoreCandidate => ({
  fixtureId,
  screenId,
  screenName,
  current,
  baseline,
});

// ---------------------------------------------------------------------------
// detectVisualBenchmarkRegression — no regression
// ---------------------------------------------------------------------------

test("detectVisualBenchmarkRegression returns no alerts when scores are stable", () => {
  const result = detectVisualBenchmarkRegression([
    makeCandidate("simple-form", 90, 90),
    makeCandidate("complex-dashboard", 82, 82),
  ]);
  assert.equal(result.alerts.length, 0);
  assert.equal(result.summaries.length, 2);
  assert.equal(result.summaries[0]?.direction, "neutral");
  assert.equal(result.summaries[1]?.direction, "neutral");
});

test("detectVisualBenchmarkRegression marks improvements as up", () => {
  const result = detectVisualBenchmarkRegression([
    makeCandidate("simple-form", 95, 88),
  ]);
  assert.equal(result.alerts.length, 0);
  assert.equal(result.summaries[0]?.direction, "up");
  assert.equal(result.summaries[0]?.delta, 7);
});

test("detectVisualBenchmarkRegression marks small drops as neutral within tolerance", () => {
  const result = detectVisualBenchmarkRegression(
    [makeCandidate("simple-form", 89, 90)],
    { maxScoreDropPercent: 5, neutralTolerance: 1 },
  );
  assert.equal(result.alerts.length, 0);
  assert.equal(result.summaries[0]?.direction, "neutral");
  assert.equal(result.summaries[0]?.withinTolerance, true);
});

test("detectVisualBenchmarkRegression marks drops beyond tolerance as down", () => {
  const result = detectVisualBenchmarkRegression(
    [makeCandidate("simple-form", 85, 90)],
    { maxScoreDropPercent: 10, neutralTolerance: 1 },
  );
  assert.equal(result.summaries[0]?.direction, "down");
  assert.equal(result.summaries[0]?.withinTolerance, false);
  // 5/90 * 100 = 5.56, below 10% threshold -> no alert
  assert.equal(result.alerts.length, 0);
});

// ---------------------------------------------------------------------------
// detectVisualBenchmarkRegression — regression alerts
// ---------------------------------------------------------------------------

test("detectVisualBenchmarkRegression emits alert when drop exceeds maxScoreDropPercent", () => {
  const result = detectVisualBenchmarkRegression(
    [makeCandidate("simple-form", 80, 90)],
    { maxScoreDropPercent: 5, neutralTolerance: 1 },
  );
  // drop = (90 - 80) / 90 * 100 = 11.11% > 5
  assert.equal(result.alerts.length, 1);
  const alert = result.alerts[0];
  assert.equal(alert?.code, "ALERT_VISUAL_QUALITY_DROP");
  assert.equal(alert?.severity, "warn");
  assert.ok(alert?.message.includes("simple-form"));
  assert.ok(alert?.message.includes("11.11"));
  assert.equal(alert?.threshold, 5);
  assert.equal(alert?.value, 11.11);
  assert.equal(result.summaries[0]?.screenId, "simple-form-screen");
  assert.equal(result.summaries[0]?.screenName, "simple-form screen");
});

test("detectVisualBenchmarkRegression does not alert when drop equals threshold exactly", () => {
  // drop = 5%, threshold = 5, alert only when drop > threshold
  const result = detectVisualBenchmarkRegression(
    [makeCandidate("simple-form", 95, 100)],
    { maxScoreDropPercent: 5, neutralTolerance: 1 },
  );
  assert.equal(result.alerts.length, 0);
});

test("detectVisualBenchmarkRegression alerts when raw drop percent exceeds threshold despite rounded display", () => {
  const result = detectVisualBenchmarkRegression(
    [makeCandidate("simple-form", 94.996, 100)],
    { maxScoreDropPercent: 5, neutralTolerance: 0 },
  );
  assert.equal(result.alerts.length, 1);
  assert.equal(result.summaries[0]?.dropPercent, 5);
  assert.equal(result.alerts[0]?.value, 5);
  assert.ok(result.alerts[0]?.message.includes("5%"));
});

test("detectVisualBenchmarkRegression emits alert per fixture with distinct messages", () => {
  const result = detectVisualBenchmarkRegression(
    [
      makeCandidate("simple-form", 50, 90),
      makeCandidate("complex-dashboard", 90, 90),
      makeCandidate("data-table", 20, 100),
    ],
    { maxScoreDropPercent: 5, neutralTolerance: 1 },
  );
  assert.equal(result.alerts.length, 2);
  const fixtureIds = result.alerts.map((alert) =>
    alert.message.includes("simple-form")
      ? "simple-form"
      : alert.message.includes("data-table")
        ? "data-table"
        : "unknown",
  );
  assert.deepEqual(fixtureIds.sort(), ["data-table", "simple-form"]);
});

test("detectVisualBenchmarkRegression does not alert on improvements even if large", () => {
  const result = detectVisualBenchmarkRegression(
    [makeCandidate("simple-form", 95, 50)],
    { maxScoreDropPercent: 5, neutralTolerance: 1 },
  );
  assert.equal(result.alerts.length, 0);
});

// ---------------------------------------------------------------------------
// detectVisualBenchmarkRegression — missing baseline
// ---------------------------------------------------------------------------

test("detectVisualBenchmarkRegression marks missing baseline as unavailable and emits no alert", () => {
  const result = detectVisualBenchmarkRegression([
    makeCandidate("new-fixture", 75, null),
  ]);
  assert.equal(result.alerts.length, 0);
  assert.equal(result.summaries[0]?.direction, "unavailable");
  assert.equal(result.summaries[0]?.baseline, null);
  assert.equal(result.summaries[0]?.delta, null);
  assert.equal(result.summaries[0]?.dropPercent, null);
  assert.equal(result.summaries[0]?.screenId, "new-fixture-screen");
});

test("detectVisualBenchmarkRegression handles baseline of zero gracefully", () => {
  const result = detectVisualBenchmarkRegression([
    makeCandidate("edge-zero", 10, 0),
  ]);
  assert.equal(result.summaries[0]?.dropPercent, null);
  assert.equal(result.alerts.length, 0);
});

// ---------------------------------------------------------------------------
// detectVisualBenchmarkRegression — environmental variance tolerance
// ---------------------------------------------------------------------------

test("detectVisualBenchmarkRegression does not alert when drop within neutralTolerance", () => {
  // absolute delta = 2, neutralTolerance = 3, so direction = neutral, no alert
  const result = detectVisualBenchmarkRegression(
    [makeCandidate("simple-form", 88, 90)],
    { maxScoreDropPercent: 1, neutralTolerance: 3 },
  );
  assert.equal(result.summaries[0]?.direction, "neutral");
  assert.equal(result.alerts.length, 0);
});

test("detectVisualBenchmarkRegression uses default config when not specified", () => {
  // default: maxScoreDropPercent=5, neutralTolerance=1
  const result = detectVisualBenchmarkRegression([
    makeCandidate("simple-form", 70, 100),
  ]);
  // drop = 30%, above 5 threshold
  assert.equal(result.alerts.length, 1);
  assert.equal(
    result.alerts[0]?.threshold,
    DEFAULT_VISUAL_BENCHMARK_REGRESSION_CONFIG.maxScoreDropPercent,
  );
});

// ---------------------------------------------------------------------------
// detectVisualBenchmarkRegression — config validation
// ---------------------------------------------------------------------------

test("detectVisualBenchmarkRegression rejects negative maxScoreDropPercent", () => {
  assert.throws(
    () =>
      detectVisualBenchmarkRegression([makeCandidate("simple-form", 90, 90)], {
        maxScoreDropPercent: -1,
        neutralTolerance: 1,
      }),
    /maxScoreDropPercent must be a non-negative finite number/,
  );
});

test("detectVisualBenchmarkRegression rejects NaN maxScoreDropPercent", () => {
  assert.throws(
    () =>
      detectVisualBenchmarkRegression([makeCandidate("simple-form", 90, 90)], {
        maxScoreDropPercent: Number.NaN,
        neutralTolerance: 1,
      }),
    /maxScoreDropPercent must be a non-negative finite number/,
  );
});

test("detectVisualBenchmarkRegression rejects maxScoreDropPercent > 100", () => {
  assert.throws(
    () =>
      detectVisualBenchmarkRegression([makeCandidate("simple-form", 90, 90)], {
        maxScoreDropPercent: 101,
        neutralTolerance: 1,
      }),
    /maxScoreDropPercent must not exceed 100/,
  );
});

test("detectVisualBenchmarkRegression rejects negative neutralTolerance", () => {
  assert.throws(
    () =>
      detectVisualBenchmarkRegression([makeCandidate("simple-form", 90, 90)], {
        maxScoreDropPercent: 5,
        neutralTolerance: -0.5,
      }),
    /neutralTolerance must be a non-negative finite number/,
  );
});

test("detectVisualBenchmarkRegression rejects non-finite current score", () => {
  assert.throws(
    () =>
      detectVisualBenchmarkRegression([
        makeCandidate("simple-form", Number.POSITIVE_INFINITY, 90),
      ]),
    /Current score for fixture 'simple-form' must be a finite number/,
  );
});

test("detectVisualBenchmarkRegression rejects non-finite baseline score", () => {
  assert.throws(
    () =>
      detectVisualBenchmarkRegression([
        { fixtureId: "simple-form", current: 90, baseline: Number.NaN },
      ]),
    /Baseline score for fixture 'simple-form' must be a finite number or null/,
  );
});

// ---------------------------------------------------------------------------
// formatVisualBenchmarkTrendLine
// ---------------------------------------------------------------------------

const summaryDown: VisualBenchmarkTrendSummary = {
  fixtureId: "simple-form",
  current: 87,
  baseline: 90,
  delta: -3,
  direction: "down",
  withinTolerance: false,
  dropPercent: 3.33,
};

const summaryUp: VisualBenchmarkTrendSummary = {
  fixtureId: "complex-dashboard",
  current: 85,
  baseline: 80,
  delta: 5,
  direction: "up",
  withinTolerance: false,
  dropPercent: -6.25,
};

const summaryNeutral: VisualBenchmarkTrendSummary = {
  fixtureId: "data-table",
  current: 91,
  baseline: 91,
  delta: 0,
  direction: "neutral",
  withinTolerance: true,
  dropPercent: 0,
};

const summaryUnavailable: VisualBenchmarkTrendSummary = {
  fixtureId: "new-fixture",
  current: 75,
  baseline: null,
  delta: null,
  direction: "unavailable",
  withinTolerance: true,
  dropPercent: null,
};

test("formatVisualBenchmarkTrendLine formats down direction with descending arrow", () => {
  const line = formatVisualBenchmarkTrendLine(summaryDown);
  assert.equal(line, "simple-form: 87 (\u21933 from baseline 90)");
});

test("formatVisualBenchmarkTrendLine formats up direction with ascending arrow", () => {
  const line = formatVisualBenchmarkTrendLine(summaryUp);
  assert.equal(line, "complex-dashboard: 85 (\u21915 from baseline 80)");
});

test("formatVisualBenchmarkTrendLine formats neutral direction", () => {
  const line = formatVisualBenchmarkTrendLine(summaryNeutral);
  assert.equal(line, "data-table: 91 (\u21920 from baseline 91)");
});

test("formatVisualBenchmarkTrendLine handles missing baseline", () => {
  const line = formatVisualBenchmarkTrendLine(summaryUnavailable);
  assert.equal(line, "new-fixture: 75 (no baseline)");
});

// ---------------------------------------------------------------------------
// formatVisualBenchmarkTrendSummaryBlock
// ---------------------------------------------------------------------------

test("formatVisualBenchmarkTrendSummaryBlock returns empty string for empty summaries", () => {
  assert.equal(formatVisualBenchmarkTrendSummaryBlock([]), "");
});

test("formatVisualBenchmarkTrendSummaryBlock renders header and indented lines", () => {
  const block = formatVisualBenchmarkTrendSummaryBlock([
    summaryDown,
    summaryUp,
  ]);
  const lines = block.split("\n");
  assert.equal(lines[0], "Trend (per fixture):");
  assert.equal(lines[1], "  simple-form: 87 (\u21933 from baseline 90)");
  assert.equal(lines[2], "  complex-dashboard: 85 (\u21915 from baseline 80)");
});

// ---------------------------------------------------------------------------
// Property-style: alert value equals dropPercent
// ---------------------------------------------------------------------------

test("alert.value always matches computed dropPercent when emitted", () => {
  const pairs: Array<[number, number]> = [
    [90, 95],
    [70, 100],
    [50, 80],
    [10, 60],
  ];
  for (const [current, baseline] of pairs) {
    const result = detectVisualBenchmarkRegression(
      [makeCandidate("simple-form", current, baseline)],
      { maxScoreDropPercent: 1, neutralTolerance: 0 },
    );
    if (result.alerts.length > 0) {
      assert.equal(
        result.alerts[0]?.value,
        result.summaries[0]?.dropPercent,
        `alert.value must match dropPercent for current=${String(current)} baseline=${String(baseline)}`,
      );
    }
  }
});
