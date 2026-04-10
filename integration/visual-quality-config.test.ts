import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_SCORING_WEIGHTS } from "../src/job-engine/visual-scoring.js";
import {
  applyVisualQualityConfigToReport,
  checkVisualQualityThreshold,
  DEFAULT_RESOLVED_REGRESSION_CONFIG,
  DEFAULT_VISUAL_QUALITY_VIEWPORTS,
  loadVisualQualityConfig,
  normalizeVisualQualityViewportWeights,
  parseVisualQualityConfig,
  recomputeVisualQualityScore,
  resolveVisualQualityRegressionConfig,
  resolveVisualQualityThresholds,
  resolveVisualQualityViewports,
  resolveVisualQualityWeights,
  VisualQualityViewportListSchema,
  VisualQualityViewportSchema,
  type VisualQualityViewport,
} from "./visual-quality-config.js";
import { resolveVisualBenchmarkCliResolution } from "./visual-benchmark.cli.js";

// ---------------------------------------------------------------------------
// parseVisualQualityConfig — valid configs
// ---------------------------------------------------------------------------

test("parseVisualQualityConfig accepts empty config", () => {
  const config = parseVisualQualityConfig({});
  assert.ok(config !== null);
});

test("parseVisualQualityConfig accepts full config with all fields", () => {
  const config = parseVisualQualityConfig({
    thresholds: { warn: 80, fail: 60 },
    weights: {
      layoutAccuracy: 0.3,
      colorFidelity: 0.25,
      typography: 0.2,
      componentStructure: 0.15,
      spacingAlignment: 0.1,
    },
    fixtures: {
      "simple-form": {
        thresholds: { warn: 70, fail: 50 },
        screens: {
          main: { thresholds: { warn: 60 } },
        },
      },
    },
  });
  assert.equal(config.thresholds?.warn, 80);
  assert.equal(config.thresholds?.fail, 60);
  assert.equal(config.weights?.layoutAccuracy, 0.3);
  assert.ok(config.fixtures?.["simple-form"]);
});

test("parseVisualQualityConfig accepts partial weights", () => {
  const config = parseVisualQualityConfig({
    weights: { layoutAccuracy: 0.5 },
  });
  assert.equal(config.weights?.layoutAccuracy, 0.5);
});

// ---------------------------------------------------------------------------
// parseVisualQualityConfig — invalid configs
// ---------------------------------------------------------------------------

test("parseVisualQualityConfig rejects weights summing != 1.0", () => {
  assert.throws(
    () =>
      parseVisualQualityConfig({
        weights: {
          layoutAccuracy: 0.5,
          colorFidelity: 0.5,
          typography: 0.5,
          componentStructure: 0.5,
          spacingAlignment: 0.5,
        },
      }),
    /weights must sum to 1.0/,
  );
});

test("parseVisualQualityConfig rejects weight > 1", () => {
  assert.throws(
    () =>
      parseVisualQualityConfig({
        weights: { layoutAccuracy: 1.5 },
      }),
    /Invalid visual quality config/,
  );
});

test("parseVisualQualityConfig rejects weight < 0", () => {
  assert.throws(
    () =>
      parseVisualQualityConfig({
        weights: { layoutAccuracy: -0.1 },
      }),
    /Invalid visual quality config/,
  );
});

test("parseVisualQualityConfig rejects warn < fail", () => {
  assert.throws(
    () =>
      parseVisualQualityConfig({
        thresholds: { warn: 50, fail: 80 },
      }),
    /warn threshold.*must be >= fail threshold/,
  );
});

test("parseVisualQualityConfig rejects invalid threshold values", () => {
  assert.throws(
    () =>
      parseVisualQualityConfig({
        thresholds: { warn: 150 },
      }),
    /Invalid visual quality config/,
  );
});

// ---------------------------------------------------------------------------
// loadVisualQualityConfig
// ---------------------------------------------------------------------------

test("loadVisualQualityConfig returns empty config when file doesn't exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vq-config-"));
  try {
    const config = await loadVisualQualityConfig({ fixtureRoot: root });
    assert.deepEqual(config, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadVisualQualityConfig reads and validates config file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vq-config-"));
  try {
    await writeFile(
      path.join(root, "visual-quality.config.json"),
      JSON.stringify({ thresholds: { warn: 90, fail: 70 } }),
      "utf8",
    );
    const config = await loadVisualQualityConfig({ fixtureRoot: root });
    assert.equal(config.thresholds?.warn, 90);
    assert.equal(config.thresholds?.fail, 70);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadVisualQualityConfig throws on invalid JSON content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vq-config-"));
  try {
    await writeFile(
      path.join(root, "visual-quality.config.json"),
      "not json",
      "utf8",
    );
    await assert.rejects(() => loadVisualQualityConfig({ fixtureRoot: root }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// resolveVisualQualityWeights
// ---------------------------------------------------------------------------

test("resolveVisualQualityWeights returns defaults when no config", () => {
  const weights = resolveVisualQualityWeights();
  assert.equal(weights.layoutAccuracy, 0.3);
  assert.equal(weights.colorFidelity, 0.25);
  assert.equal(weights.typography, 0.2);
  assert.equal(weights.componentStructure, 0.15);
  assert.equal(weights.spacingAlignment, 0.1);
});

test("resolveVisualQualityWeights merges partial weights", () => {
  const weights = resolveVisualQualityWeights({
    weights: { layoutAccuracy: 0.4, spacingAlignment: 0.0 },
  });
  assert.equal(weights.layoutAccuracy, 0.4);
  assert.equal(weights.colorFidelity, 0.25);
  assert.equal(weights.typography, 0.2);
  assert.equal(weights.componentStructure, 0.15);
  assert.equal(weights.spacingAlignment, 0.0);
});

test("resolveVisualQualityWeights throws when merged weights don't sum to 1.0", () => {
  assert.throws(
    () =>
      resolveVisualQualityWeights({
        weights: { layoutAccuracy: 0.8 },
      }),
    /sum to 1.0/,
  );
});

// ---------------------------------------------------------------------------
// resolveVisualQualityThresholds
// ---------------------------------------------------------------------------

test("resolveVisualQualityThresholds returns defaults with no config", () => {
  const thresholds = resolveVisualQualityThresholds();
  assert.equal(thresholds.warn, 80);
  assert.equal(thresholds.fail, undefined);
});

test("resolveVisualQualityThresholds uses global config", () => {
  const thresholds = resolveVisualQualityThresholds({
    thresholds: { warn: 90, fail: 70 },
  });
  assert.equal(thresholds.warn, 90);
  assert.equal(thresholds.fail, 70);
});

test("resolveVisualQualityThresholds fixture overrides global", () => {
  const thresholds = resolveVisualQualityThresholds(
    {
      thresholds: { warn: 90, fail: 70 },
      fixtures: {
        "simple-form": { thresholds: { warn: 75 } },
      },
    },
    "simple-form",
  );
  assert.equal(thresholds.warn, 75);
  assert.equal(thresholds.fail, 70);
});

test("resolveVisualQualityThresholds screen overrides fixture overrides global", () => {
  const thresholds = resolveVisualQualityThresholds(
    {
      thresholds: { warn: 90, fail: 70 },
      fixtures: {
        "simple-form": {
          thresholds: { warn: 75, fail: 50 },
          screens: {
            main: { thresholds: { warn: 60 } },
          },
        },
      },
    },
    "simple-form",
    { screenName: "main" },
  );
  assert.equal(thresholds.warn, 60);
  assert.equal(thresholds.fail, 50);
});

test("resolveVisualQualityThresholds uses screen nodeId as the primary key", () => {
  const thresholds = resolveVisualQualityThresholds(
    {
      thresholds: { warn: 90, fail: 70 },
      fixtures: {
        "simple-form": {
          thresholds: { warn: 80, fail: 60 },
          screens: {
            "Fixture Screen": { thresholds: { warn: 65, fail: 50 } },
            "1:65671": { thresholds: { warn: 55, fail: 45 } },
          },
        },
      },
    },
    "simple-form",
    { screenId: "1:65671", screenName: "Fixture Screen" },
  );
  assert.deepEqual(thresholds, { warn: 55, fail: 45 });
});

test("resolveVisualQualityThresholds ignores unmatched fixture", () => {
  const thresholds = resolveVisualQualityThresholds(
    {
      thresholds: { warn: 90, fail: 70 },
      fixtures: {
        "other-fixture": { thresholds: { warn: 50 } },
      },
    },
    "simple-form",
  );
  assert.equal(thresholds.warn, 90);
  assert.equal(thresholds.fail, 70);
});

test("resolveVisualQualityThresholds keeps V1 warn-only defaults when fail is unset", () => {
  const thresholds = resolveVisualQualityThresholds({
    thresholds: { warn: 88 },
  });
  assert.deepEqual(thresholds, { warn: 88, fail: undefined });
});

// ---------------------------------------------------------------------------
// checkVisualQualityThreshold
// ---------------------------------------------------------------------------

test("checkVisualQualityThreshold returns pass when score >= warn", () => {
  const result = checkVisualQualityThreshold(85, { warn: 80, fail: 60 });
  assert.equal(result.verdict, "pass");
  assert.equal(result.score, 85);
});

test("checkVisualQualityThreshold returns warn when fail <= score < warn", () => {
  const result = checkVisualQualityThreshold(70, { warn: 80, fail: 60 });
  assert.equal(result.verdict, "warn");
});

test("checkVisualQualityThreshold returns fail when score < fail", () => {
  const result = checkVisualQualityThreshold(50, { warn: 80, fail: 60 });
  assert.equal(result.verdict, "fail");
});

test("checkVisualQualityThreshold handles edge cases", () => {
  assert.equal(
    checkVisualQualityThreshold(80, { warn: 80, fail: 60 }).verdict,
    "pass",
  );
  assert.equal(
    checkVisualQualityThreshold(60, { warn: 80, fail: 60 }).verdict,
    "warn",
  );
  assert.equal(
    checkVisualQualityThreshold(59.99, { warn: 80, fail: 60 }).verdict,
    "fail",
  );
});

test("checkVisualQualityThreshold keeps warn-only semantics when fail is disabled", () => {
  assert.equal(checkVisualQualityThreshold(80, { warn: 80 }).verdict, "pass");
  assert.equal(
    checkVisualQualityThreshold(79.99, { warn: 80 }).verdict,
    "warn",
  );
  assert.equal(checkVisualQualityThreshold(5, { warn: 80 }).verdict, "warn");
});

// ---------------------------------------------------------------------------
// recomputeVisualQualityScore
// ---------------------------------------------------------------------------

test("recomputeVisualQualityScore with default weights matches original", () => {
  const dimensions = [
    { name: "Layout Accuracy", weight: 0.3, score: 95, details: "" },
    { name: "Color Fidelity", weight: 0.25, score: 90, details: "" },
    { name: "Typography", weight: 0.2, score: 85, details: "" },
    { name: "Component Structure", weight: 0.15, score: 80, details: "" },
    { name: "Spacing & Alignment", weight: 0.1, score: 75, details: "" },
  ];
  const score = recomputeVisualQualityScore(
    dimensions,
    DEFAULT_SCORING_WEIGHTS,
  );
  // 95*0.30 + 90*0.25 + 85*0.20 + 80*0.15 + 75*0.10
  // = 28.5 + 22.5 + 17 + 12 + 7.5 = 87.5
  assert.equal(score, 87.5);
});

test("recomputeVisualQualityScore with custom weights changes score", () => {
  const dimensions = [
    { name: "Layout Accuracy", weight: 0.3, score: 95, details: "" },
    { name: "Color Fidelity", weight: 0.25, score: 90, details: "" },
    { name: "Typography", weight: 0.2, score: 85, details: "" },
    { name: "Component Structure", weight: 0.15, score: 80, details: "" },
    { name: "Spacing & Alignment", weight: 0.1, score: 75, details: "" },
  ];
  const customWeights = {
    layoutAccuracy: 0.1,
    colorFidelity: 0.1,
    typography: 0.1,
    componentStructure: 0.1,
    spacingAlignment: 0.6,
  };
  const score = recomputeVisualQualityScore(dimensions, customWeights);
  // 95*0.10 + 90*0.10 + 85*0.10 + 80*0.10 + 75*0.60
  // = 9.5 + 9 + 8.5 + 8 + 45 = 80
  assert.equal(score, 80);
});

test("applyVisualQualityConfigToReport rewrites completed report weights and aggregate score", () => {
  const report = applyVisualQualityConfigToReport(
    {
      status: "completed",
      overallScore: 87.5,
      interpretation: "Good parity — small layout or color deviations",
      dimensions: [
        { name: "Layout Accuracy", weight: 0.3, score: 95, details: "" },
        { name: "Color Fidelity", weight: 0.25, score: 90, details: "" },
        { name: "Typography", weight: 0.2, score: 85, details: "" },
        { name: "Component Structure", weight: 0.15, score: 80, details: "" },
        { name: "Spacing & Alignment", weight: 0.1, score: 75, details: "" },
      ],
      diffImagePath: "visual-quality/diff.png",
      hotspots: [],
      metadata: {
        comparedAt: "2026-04-09T00:00:00.000Z",
        imageWidth: 1280,
        imageHeight: 720,
        totalPixels: 921600,
        diffPixelCount: 1024,
        configuredWeights: { ...DEFAULT_SCORING_WEIGHTS },
        viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
        versions: { packageVersion: "1.0.0", contractVersion: "1.0.0" },
      },
    },
    {
      weights: {
        layoutAccuracy: 0.1,
        colorFidelity: 0.1,
        typography: 0.1,
        componentStructure: 0.1,
        spacingAlignment: 0.6,
      },
    },
  );

  assert.equal(report.overallScore, 80);
  assert.equal(
    report.interpretation,
    "Good parity — small layout or color deviations",
  );
  assert.equal(report.dimensions?.[4]?.weight, 0.6);
  assert.equal(report.metadata?.configuredWeights.spacingAlignment, 0.6);
});

// ---------------------------------------------------------------------------
// CLI --quality-threshold flag
// ---------------------------------------------------------------------------

test("resolveVisualBenchmarkCliResolution parses --quality-threshold", () => {
  const result = resolveVisualBenchmarkCliResolution([
    "--quality-threshold",
    "85",
  ]);
  assert.equal(result.action, "benchmark");
  assert.equal(result.qualityThreshold, 85);
});

test("resolveVisualBenchmarkCliResolution accepts --quality-threshold with maintenance flag", () => {
  const result = resolveVisualBenchmarkCliResolution([
    "--update-baseline",
    "--quality-threshold",
    "90",
  ]);
  assert.equal(result.action, "maintenance");
  assert.equal(result.qualityThreshold, 90);
});

test("resolveVisualBenchmarkCliResolution rejects --quality-threshold without value", () => {
  assert.throws(
    () => resolveVisualBenchmarkCliResolution(["--quality-threshold"]),
    /requires a numeric value/,
  );
});

test("resolveVisualBenchmarkCliResolution rejects --quality-threshold > 100", () => {
  assert.throws(
    () => resolveVisualBenchmarkCliResolution(["--quality-threshold", "150"]),
    /between 0 and 100/,
  );
});

test("resolveVisualBenchmarkCliResolution rejects --quality-threshold with invalid value", () => {
  assert.throws(
    () => resolveVisualBenchmarkCliResolution(["--quality-threshold", "abc"]),
    /between 0 and 100/,
  );
});

// ---------------------------------------------------------------------------
// Issue #841 — regression config parsing and resolution
// ---------------------------------------------------------------------------

test("parseVisualQualityConfig accepts regression config section", () => {
  const config = parseVisualQualityConfig({
    regression: {
      maxScoreDropPercent: 10,
      neutralTolerance: 2,
      historySize: 30,
    },
  });
  assert.equal(config.regression?.maxScoreDropPercent, 10);
  assert.equal(config.regression?.neutralTolerance, 2);
  assert.equal(config.regression?.historySize, 30);
});

test("parseVisualQualityConfig accepts partial regression config", () => {
  const config = parseVisualQualityConfig({
    regression: { maxScoreDropPercent: 7 },
  });
  assert.equal(config.regression?.maxScoreDropPercent, 7);
  assert.equal(config.regression?.neutralTolerance, undefined);
  assert.equal(config.regression?.historySize, undefined);
});

test("parseVisualQualityConfig rejects negative maxScoreDropPercent", () => {
  assert.throws(
    () =>
      parseVisualQualityConfig({
        regression: { maxScoreDropPercent: -1 },
      }),
    /Invalid visual quality config/,
  );
});

test("parseVisualQualityConfig rejects maxScoreDropPercent > 100", () => {
  assert.throws(
    () =>
      parseVisualQualityConfig({
        regression: { maxScoreDropPercent: 101 },
      }),
    /Invalid visual quality config/,
  );
});

test("parseVisualQualityConfig rejects negative neutralTolerance", () => {
  assert.throws(
    () =>
      parseVisualQualityConfig({
        regression: { neutralTolerance: -0.5 },
      }),
    /Invalid visual quality config/,
  );
});

test("parseVisualQualityConfig rejects historySize <= 0", () => {
  assert.throws(
    () =>
      parseVisualQualityConfig({
        regression: { historySize: 0 },
      }),
    /Invalid visual quality config/,
  );
});

test("parseVisualQualityConfig rejects historySize > 1000", () => {
  assert.throws(
    () =>
      parseVisualQualityConfig({
        regression: { historySize: 1001 },
      }),
    /Invalid visual quality config/,
  );
});

test("parseVisualQualityConfig rejects non-integer historySize", () => {
  assert.throws(
    () =>
      parseVisualQualityConfig({
        regression: { historySize: 5.5 },
      }),
    /Invalid visual quality config/,
  );
});

test("resolveVisualQualityRegressionConfig returns defaults when config is undefined", () => {
  const resolved = resolveVisualQualityRegressionConfig(undefined);
  assert.deepEqual(resolved, DEFAULT_RESOLVED_REGRESSION_CONFIG);
});

test("resolveVisualQualityRegressionConfig returns defaults when regression section is empty", () => {
  const resolved = resolveVisualQualityRegressionConfig({});
  assert.deepEqual(resolved, DEFAULT_RESOLVED_REGRESSION_CONFIG);
});

test("resolveVisualQualityRegressionConfig merges user values with defaults", () => {
  const resolved = resolveVisualQualityRegressionConfig({
    regression: { maxScoreDropPercent: 8 },
  });
  assert.equal(resolved.maxScoreDropPercent, 8);
  assert.equal(
    resolved.neutralTolerance,
    DEFAULT_RESOLVED_REGRESSION_CONFIG.neutralTolerance,
  );
  assert.equal(
    resolved.historySize,
    DEFAULT_RESOLVED_REGRESSION_CONFIG.historySize,
  );
});

test("resolveVisualQualityRegressionConfig accepts full override", () => {
  const resolved = resolveVisualQualityRegressionConfig({
    regression: {
      maxScoreDropPercent: 12,
      neutralTolerance: 3,
      historySize: 50,
    },
  });
  assert.deepEqual(resolved, {
    maxScoreDropPercent: 12,
    neutralTolerance: 3,
    historySize: 50,
  });
});

test("committed visual-quality.config.json contains regression section with valid values", async () => {
  const config = await loadVisualQualityConfig();
  assert.ok(
    config.regression !== undefined,
    "regression section must be present",
  );
  assert.equal(typeof config.regression?.maxScoreDropPercent, "number");
  assert.equal(typeof config.regression?.neutralTolerance, "number");
  assert.equal(typeof config.regression?.historySize, "number");
});

// ---------------------------------------------------------------------------
// Issue #838 — VisualQualityViewportSchema
// ---------------------------------------------------------------------------

test("VisualQualityViewportSchema accepts a minimal valid viewport", () => {
  const parsed = VisualQualityViewportSchema.parse({
    id: "desktop",
    width: 1280,
    height: 800,
  });
  assert.equal(parsed.id, "desktop");
  assert.equal(parsed.width, 1280);
  assert.equal(parsed.height, 800);
});

test("VisualQualityViewportSchema accepts optional fields", () => {
  const parsed = VisualQualityViewportSchema.parse({
    id: "mobile",
    label: "Mobile",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    weight: 2,
  });
  assert.equal(parsed.label, "Mobile");
  assert.equal(parsed.deviceScaleFactor, 3);
  assert.equal(parsed.weight, 2);
});

test("VisualQualityViewportSchema rejects empty id", () => {
  assert.throws(() =>
    VisualQualityViewportSchema.parse({ id: "", width: 1280, height: 800 }),
  );
});

test("VisualQualityViewportSchema rejects missing id", () => {
  assert.throws(() =>
    VisualQualityViewportSchema.parse({ width: 1280, height: 800 }),
  );
});

test("VisualQualityViewportSchema rejects zero width", () => {
  assert.throws(() =>
    VisualQualityViewportSchema.parse({ id: "x", width: 0, height: 800 }),
  );
});

test("VisualQualityViewportSchema rejects negative width", () => {
  assert.throws(() =>
    VisualQualityViewportSchema.parse({ id: "x", width: -1, height: 800 }),
  );
});

test("VisualQualityViewportSchema rejects zero height", () => {
  assert.throws(() =>
    VisualQualityViewportSchema.parse({ id: "x", width: 1280, height: 0 }),
  );
});

test("VisualQualityViewportSchema rejects negative height", () => {
  assert.throws(() =>
    VisualQualityViewportSchema.parse({ id: "x", width: 1280, height: -10 }),
  );
});

test("VisualQualityViewportSchema rejects non-integer width", () => {
  assert.throws(() =>
    VisualQualityViewportSchema.parse({ id: "x", width: 1280.5, height: 800 }),
  );
});

test("VisualQualityViewportSchema rejects non-integer height", () => {
  assert.throws(() =>
    VisualQualityViewportSchema.parse({ id: "x", width: 1280, height: 800.5 }),
  );
});

test("VisualQualityViewportSchema rejects non-positive deviceScaleFactor", () => {
  assert.throws(() =>
    VisualQualityViewportSchema.parse({
      id: "x",
      width: 1280,
      height: 800,
      deviceScaleFactor: 0,
    }),
  );
  assert.throws(() =>
    VisualQualityViewportSchema.parse({
      id: "x",
      width: 1280,
      height: 800,
      deviceScaleFactor: -1,
    }),
  );
});

test("VisualQualityViewportSchema rejects non-positive weight", () => {
  assert.throws(() =>
    VisualQualityViewportSchema.parse({
      id: "x",
      width: 1280,
      height: 800,
      weight: 0,
    }),
  );
});

// ---------------------------------------------------------------------------
// Issue #838 — VisualQualityViewportListSchema
// ---------------------------------------------------------------------------

test("VisualQualityViewportListSchema accepts a single-viewport list", () => {
  const parsed = VisualQualityViewportListSchema.parse([
    { id: "desktop", width: 1280, height: 800 },
  ]);
  assert.equal(parsed.length, 1);
});

test("VisualQualityViewportListSchema accepts multi-viewport list with unique ids", () => {
  const parsed = VisualQualityViewportListSchema.parse([
    { id: "desktop", width: 1280, height: 800 },
    { id: "mobile", width: 390, height: 844 },
  ]);
  assert.equal(parsed.length, 2);
});

test("VisualQualityViewportListSchema rejects empty array", () => {
  assert.throws(() => VisualQualityViewportListSchema.parse([]));
});

test("VisualQualityViewportListSchema rejects duplicate ids", () => {
  assert.throws(
    () =>
      VisualQualityViewportListSchema.parse([
        { id: "desktop", width: 1280, height: 800 },
        { id: "desktop", width: 1440, height: 900 },
      ]),
    /unique/i,
  );
});

// ---------------------------------------------------------------------------
// Issue #838 — parseVisualQualityConfig extension (viewports on global/fixture/screen)
// ---------------------------------------------------------------------------

test("parseVisualQualityConfig accepts global viewports list", () => {
  const config = parseVisualQualityConfig({
    viewports: [
      { id: "desktop", width: 1280, height: 800 },
      { id: "mobile", width: 390, height: 844, deviceScaleFactor: 3 },
    ],
  });
  assert.equal(config.viewports?.length, 2);
});

test("parseVisualQualityConfig accepts fixture-level viewports override", () => {
  const config = parseVisualQualityConfig({
    viewports: [{ id: "desktop", width: 1280, height: 800 }],
    fixtures: {
      "simple-form": {
        viewports: [
          { id: "tablet", width: 768, height: 1024, deviceScaleFactor: 2 },
        ],
      },
    },
  });
  assert.equal(config.fixtures?.["simple-form"]?.viewports?.length, 1);
  assert.equal(config.fixtures?.["simple-form"]?.viewports?.[0]?.id, "tablet");
});

test("parseVisualQualityConfig accepts screen-level viewports override", () => {
  const config = parseVisualQualityConfig({
    fixtures: {
      "simple-form": {
        screens: {
          main: {
            viewports: [{ id: "desktop", width: 1920, height: 1080 }],
          },
        },
      },
    },
  });
  assert.equal(
    config.fixtures?.["simple-form"]?.screens?.["main"]?.viewports?.length,
    1,
  );
});

test("parseVisualQualityConfig rejects empty fixture viewports list", () => {
  assert.throws(() =>
    parseVisualQualityConfig({
      fixtures: { "simple-form": { viewports: [] } },
    }),
  );
});

test("parseVisualQualityConfig rejects duplicate viewport ids at global level", () => {
  assert.throws(() =>
    parseVisualQualityConfig({
      viewports: [
        { id: "desktop", width: 1280, height: 800 },
        { id: "desktop", width: 1440, height: 900 },
      ],
    }),
  );
});

// ---------------------------------------------------------------------------
// Issue #838 — DEFAULT_VISUAL_QUALITY_VIEWPORTS
// ---------------------------------------------------------------------------

test("DEFAULT_VISUAL_QUALITY_VIEWPORTS is non-empty and parseable", () => {
  assert.ok(DEFAULT_VISUAL_QUALITY_VIEWPORTS.length >= 1);
  for (const viewport of DEFAULT_VISUAL_QUALITY_VIEWPORTS) {
    VisualQualityViewportSchema.parse(viewport);
  }
});

// ---------------------------------------------------------------------------
// Issue #838 — resolveVisualQualityViewports precedence
// ---------------------------------------------------------------------------

test("resolveVisualQualityViewports returns undefined when no config", () => {
  assert.equal(
    resolveVisualQualityViewports(undefined, undefined, undefined),
    undefined,
  );
});

test("resolveVisualQualityViewports returns undefined for empty config", () => {
  assert.equal(
    resolveVisualQualityViewports({}, "simple-form", undefined),
    undefined,
  );
});

test("resolveVisualQualityViewports uses global config viewports when no fixture/screen override", () => {
  const result = resolveVisualQualityViewports(
    {
      viewports: [
        { id: "desktop", width: 1280, height: 800 },
        { id: "mobile", width: 390, height: 844 },
      ],
    },
    "simple-form",
    undefined,
  );
  assert.ok(result !== undefined);
  assert.deepEqual(
    result.map((viewport) => viewport.id),
    ["desktop", "mobile"],
  );
});

test("resolveVisualQualityViewports fixture override replaces global list", () => {
  const result = resolveVisualQualityViewports(
    {
      viewports: [{ id: "desktop", width: 1280, height: 800 }],
      fixtures: {
        "simple-form": {
          viewports: [
            { id: "tablet", width: 768, height: 1024 },
            { id: "mobile", width: 390, height: 844 },
          ],
        },
      },
    },
    "simple-form",
    undefined,
  );
  assert.ok(result !== undefined);
  assert.deepEqual(
    result.map((viewport) => viewport.id),
    ["tablet", "mobile"],
  );
});

test("resolveVisualQualityViewports screen override beats fixture override", () => {
  const result = resolveVisualQualityViewports(
    {
      viewports: [{ id: "desktop", width: 1280, height: 800 }],
      fixtures: {
        "simple-form": {
          viewports: [{ id: "fixture", width: 1024, height: 768 }],
          screens: {
            main: {
              viewports: [{ id: "screen", width: 1920, height: 1080 }],
            },
          },
        },
      },
    },
    "simple-form",
    { screenId: "main" },
  );
  assert.ok(result !== undefined);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, "screen");
});

test("resolveVisualQualityViewports screen lookup tries screenName when screenId does not match", () => {
  const result = resolveVisualQualityViewports(
    {
      fixtures: {
        "simple-form": {
          screens: {
            "Main Screen": {
              viewports: [{ id: "named", width: 1280, height: 800 }],
            },
          },
        },
      },
    },
    "simple-form",
    { screenName: "Main Screen" },
  );
  assert.ok(result !== undefined);
  assert.equal(result[0]?.id, "named");
});

test("resolveVisualQualityViewports prefers screenId over screenName when both match", () => {
  const result = resolveVisualQualityViewports(
    {
      fixtures: {
        "simple-form": {
          screens: {
            "1:65671": {
              viewports: [{ id: "by-id", width: 1280, height: 800 }],
            },
            "Main Screen": {
              viewports: [{ id: "by-name", width: 1280, height: 800 }],
            },
          },
        },
      },
    },
    "simple-form",
    { screenId: "1:65671", screenName: "Main Screen" },
  );
  assert.ok(result !== undefined);
  assert.equal(result[0]?.id, "by-id");
});

test("resolveVisualQualityViewports returned array is frozen", () => {
  const result = resolveVisualQualityViewports(
    { viewports: [{ id: "desktop", width: 1280, height: 800 }] },
    undefined,
    undefined,
  );
  assert.ok(result !== undefined);
  assert.throws(() => {
    (result as VisualQualityViewport[]).push({
      id: "extra",
      width: 100,
      height: 100,
    });
  }, /read.?only|frozen|extensible/i);
});

// ---------------------------------------------------------------------------
// Issue #838 — normalizeVisualQualityViewportWeights
// ---------------------------------------------------------------------------

test("normalizeVisualQualityViewportWeights assigns equal weights when none provided", () => {
  const result = normalizeVisualQualityViewportWeights([
    { id: "a", width: 100, height: 100 },
    { id: "b", width: 100, height: 100 },
    { id: "c", width: 100, height: 100 },
  ]);
  assert.equal(result.length, 3);
  for (const viewport of result) {
    assert.ok(
      Math.abs((viewport.weight ?? 0) - 1 / 3) < 1e-9,
      `Expected weight 1/3, got ${String(viewport.weight)}`,
    );
  }
});

test("normalizeVisualQualityViewportWeights assigns weight=1 for single viewport", () => {
  const result = normalizeVisualQualityViewportWeights([
    { id: "only", width: 100, height: 100 },
  ]);
  assert.equal(result[0]?.weight, 1);
});

test("normalizeVisualQualityViewportWeights normalizes all-weighted list to sum 1", () => {
  const result = normalizeVisualQualityViewportWeights([
    { id: "a", width: 100, height: 100, weight: 2 },
    { id: "b", width: 100, height: 100, weight: 3 },
    { id: "c", width: 100, height: 100, weight: 5 },
  ]);
  assert.equal(result.length, 3);
  assert.ok(Math.abs((result[0]?.weight ?? 0) - 0.2) < 1e-9);
  assert.ok(Math.abs((result[1]?.weight ?? 0) - 0.3) < 1e-9);
  assert.ok(Math.abs((result[2]?.weight ?? 0) - 0.5) < 1e-9);
});

test("normalizeVisualQualityViewportWeights throws when only some viewports have weights", () => {
  assert.throws(
    () =>
      normalizeVisualQualityViewportWeights([
        { id: "a", width: 100, height: 100, weight: 2 },
        { id: "b", width: 100, height: 100 },
      ]),
    /all|partial|some|missing/i,
  );
});

test("normalizeVisualQualityViewportWeights throws on empty input", () => {
  assert.throws(
    () => normalizeVisualQualityViewportWeights([]),
    /empty|at least/i,
  );
});

test("normalizeVisualQualityViewportWeights does not mutate input array", () => {
  const input: VisualQualityViewport[] = [
    { id: "a", width: 100, height: 100 },
    { id: "b", width: 100, height: 100 },
  ];
  const snapshot = JSON.parse(JSON.stringify(input)) as unknown;
  normalizeVisualQualityViewportWeights(input);
  assert.deepEqual(input, snapshot);
});

test("normalizeVisualQualityViewportWeights preserves non-weight fields", () => {
  const result = normalizeVisualQualityViewportWeights([
    {
      id: "desktop",
      label: "Desktop",
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
    },
    {
      id: "mobile",
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
    },
  ]);
  assert.equal(result[0]?.id, "desktop");
  assert.equal(result[0]?.label, "Desktop");
  assert.equal(result[0]?.deviceScaleFactor, 1);
  assert.equal(result[1]?.deviceScaleFactor, 3);
});

// ---------------------------------------------------------------------------
// Issue #838 — committed config omits global viewports
// ---------------------------------------------------------------------------

test("committed visual-quality.config.json omits global viewports", async () => {
  const config = await loadVisualQualityConfig();
  assert.equal(config.viewports, undefined);
});
