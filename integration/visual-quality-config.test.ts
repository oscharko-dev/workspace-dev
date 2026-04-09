import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_SCORING_WEIGHTS } from "../src/job-engine/visual-scoring.js";
import {
  checkVisualQualityThreshold,
  loadVisualQualityConfig,
  parseVisualQualityConfig,
  recomputeVisualQualityScore,
  resolveVisualQualityThresholds,
  resolveVisualQualityWeights,
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
      layoutAccuracy: 0.30,
      colorFidelity: 0.25,
      typography: 0.20,
      componentStructure: 0.15,
      spacingAlignment: 0.10,
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
  assert.equal(config.weights?.layoutAccuracy, 0.30);
  assert.ok(config.fixtures?.["simple-form"]);
});

test("parseVisualQualityConfig accepts partial weights", () => {
  const config = parseVisualQualityConfig({
    weights: { layoutAccuracy: 0.50 },
  });
  assert.equal(config.weights?.layoutAccuracy, 0.50);
});

// ---------------------------------------------------------------------------
// parseVisualQualityConfig — invalid configs
// ---------------------------------------------------------------------------

test("parseVisualQualityConfig rejects weights summing != 1.0", () => {
  assert.throws(
    () =>
      parseVisualQualityConfig({
        weights: {
          layoutAccuracy: 0.50,
          colorFidelity: 0.50,
          typography: 0.50,
          componentStructure: 0.50,
          spacingAlignment: 0.50,
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
  assert.equal(weights.layoutAccuracy, 0.30);
  assert.equal(weights.colorFidelity, 0.25);
  assert.equal(weights.typography, 0.20);
  assert.equal(weights.componentStructure, 0.15);
  assert.equal(weights.spacingAlignment, 0.10);
});

test("resolveVisualQualityWeights merges partial weights", () => {
  const weights = resolveVisualQualityWeights({
    weights: { layoutAccuracy: 0.40, spacingAlignment: 0.00 },
  });
  assert.equal(weights.layoutAccuracy, 0.40);
  assert.equal(weights.colorFidelity, 0.25);
  assert.equal(weights.typography, 0.20);
  assert.equal(weights.componentStructure, 0.15);
  assert.equal(weights.spacingAlignment, 0.00);
});

test("resolveVisualQualityWeights throws when merged weights don't sum to 1.0", () => {
  assert.throws(
    () =>
      resolveVisualQualityWeights({
        weights: { layoutAccuracy: 0.80 },
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
  assert.equal(thresholds.fail, 60);
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
    "main",
  );
  assert.equal(thresholds.warn, 60);
  assert.equal(thresholds.fail, 50);
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

// ---------------------------------------------------------------------------
// recomputeVisualQualityScore
// ---------------------------------------------------------------------------

test("recomputeVisualQualityScore with default weights matches original", () => {
  const dimensions = [
    { name: "Layout Accuracy", weight: 0.30, score: 95, details: "" },
    { name: "Color Fidelity", weight: 0.25, score: 90, details: "" },
    { name: "Typography", weight: 0.20, score: 85, details: "" },
    { name: "Component Structure", weight: 0.15, score: 80, details: "" },
    { name: "Spacing & Alignment", weight: 0.10, score: 75, details: "" },
  ];
  const score = recomputeVisualQualityScore(dimensions, DEFAULT_SCORING_WEIGHTS);
  // 95*0.30 + 90*0.25 + 85*0.20 + 80*0.15 + 75*0.10
  // = 28.5 + 22.5 + 17 + 12 + 7.5 = 87.5
  assert.equal(score, 87.5);
});

test("recomputeVisualQualityScore with custom weights changes score", () => {
  const dimensions = [
    { name: "Layout Accuracy", weight: 0.30, score: 95, details: "" },
    { name: "Color Fidelity", weight: 0.25, score: 90, details: "" },
    { name: "Typography", weight: 0.20, score: 85, details: "" },
    { name: "Component Structure", weight: 0.15, score: 80, details: "" },
    { name: "Spacing & Alignment", weight: 0.10, score: 75, details: "" },
  ];
  const customWeights = {
    layoutAccuracy: 0.10,
    colorFidelity: 0.10,
    typography: 0.10,
    componentStructure: 0.10,
    spacingAlignment: 0.60,
  };
  const score = recomputeVisualQualityScore(dimensions, customWeights);
  // 95*0.10 + 90*0.10 + 85*0.10 + 80*0.10 + 75*0.60
  // = 9.5 + 9 + 8.5 + 8 + 45 = 80
  assert.equal(score, 80);
});

// ---------------------------------------------------------------------------
// CLI --quality-threshold flag
// ---------------------------------------------------------------------------

test("resolveVisualBenchmarkCliResolution parses --quality-threshold", () => {
  const result = resolveVisualBenchmarkCliResolution(["--quality-threshold", "85"]);
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
