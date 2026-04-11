import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import {
  DEFAULT_THREE_WAY_DIVERGENCE_LIMIT,
  ThreeWayDiffDimensionDivergenceError,
  compareVisualBenchmarkResults,
  composeThreeWayDiff,
  formatVisualBenchmarkAbStatistics,
  formatVisualBenchmarkAbTable,
  parseVisualBenchmarkAbConfig,
  persistVisualBenchmarkAbResult,
  persistVisualBenchmarkAbThreeWayDiffs,
  runVisualBenchmarkAb,
  type VisualBenchmarkAbConfig,
} from "./visual-benchmark-ab.js";
import type {
  VisualBenchmarkResult,
  VisualBenchmarkRunOptions,
} from "./visual-benchmark-runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildEmptyResult = (
  overrides: Partial<VisualBenchmarkResult> = {},
): VisualBenchmarkResult => ({
  deltas: [],
  overallBaseline: null,
  overallCurrent: 0,
  overallDelta: null,
  alerts: [],
  trendSummaries: [],
  ...overrides,
});

const buildResultWithDeltas = (
  current: number,
  deltas: Array<{
    fixtureId: string;
    screenId?: string;
    screenName?: string;
    viewportId?: string;
    viewportLabel?: string;
    current: number;
  }>,
): VisualBenchmarkResult =>
  buildEmptyResult({
    overallCurrent: current,
    deltas: deltas.map((entry) => ({
      fixtureId: entry.fixtureId,
      ...(entry.screenId !== undefined ? { screenId: entry.screenId } : {}),
      ...(entry.screenName !== undefined
        ? { screenName: entry.screenName }
        : {}),
      ...(entry.viewportId !== undefined
        ? { viewportId: entry.viewportId }
        : {}),
      ...(entry.viewportLabel !== undefined
        ? { viewportLabel: entry.viewportLabel }
        : {}),
      baseline: null,
      current: entry.current,
      delta: null,
      indicator: "unavailable",
    })),
  });

const buildSolidPng = (
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
): Buffer => {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = color.r;
    png.data[i + 1] = color.g;
    png.data[i + 2] = color.b;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
};

const buildPngHeaderOnly = (width: number, height: number): Buffer => {
  const buffer = Buffer.alloc(24, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
    buffer,
    0,
  );
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

// ---------------------------------------------------------------------------
// parseVisualBenchmarkAbConfig
// ---------------------------------------------------------------------------

test("parseVisualBenchmarkAbConfig accepts a minimal valid config", () => {
  const config = parseVisualBenchmarkAbConfig({ label: "Strict" });
  assert.equal(config.label, "Strict");
  assert.equal(config.qualityConfig, undefined);
});

test("parseVisualBenchmarkAbConfig rejects empty label", () => {
  assert.throws(
    () => parseVisualBenchmarkAbConfig({ label: "" }),
    /Invalid A\/B config/i,
  );
});

test("parseVisualBenchmarkAbConfig rejects unknown top-level fields", () => {
  assert.throws(
    () => parseVisualBenchmarkAbConfig({ label: "Strict", extra: "value" }),
    /Invalid A\/B config/i,
  );
});

test("parseVisualBenchmarkAbConfig rejects invalid browser names", () => {
  assert.throws(
    () =>
      parseVisualBenchmarkAbConfig({
        label: "Strict",
        browsers: ["chromium", "internet-explorer"],
      }),
    /Unknown browser/i,
  );
});

test("parseVisualBenchmarkAbConfig deduplicates browser list", () => {
  const config = parseVisualBenchmarkAbConfig({
    label: "Strict",
    browsers: ["chromium", "chromium", "firefox"],
  });
  assert.deepEqual(config.browsers, ["chromium", "firefox"]);
});

test("parseVisualBenchmarkAbConfig validates qualityConfig content", () => {
  assert.throws(
    () =>
      parseVisualBenchmarkAbConfig({
        label: "Strict",
        qualityConfig: {
          weights: {
            layoutAccuracy: 0.5,
            colorFidelity: 0.5,
            typography: 0.5,
            componentStructure: 0.5,
            spacingAlignment: 0.5,
          },
        },
      }),
    /Scoring weights must sum to 1\.0/i,
  );
});

test("parseVisualBenchmarkAbConfig rejects componentVisualCatalogFile outside the workspace root", () => {
  assert.throws(
    () =>
      parseVisualBenchmarkAbConfig({
        label: "Strict",
        componentVisualCatalogFile: path.resolve(os.tmpdir(), "catalog.json"),
      }),
    /componentVisualCatalogFile resolves outside the workspace root/i,
  );
});

test("parseVisualBenchmarkAbConfig rejects storybookStaticDir outside the workspace root", () => {
  assert.throws(
    () =>
      parseVisualBenchmarkAbConfig({
        label: "Strict",
        storybookStaticDir: path.resolve(os.tmpdir(), "storybook-static"),
      }),
    /storybookStaticDir resolves outside the workspace root/i,
  );
});

// ---------------------------------------------------------------------------
// compareVisualBenchmarkResults
// ---------------------------------------------------------------------------

test("compareVisualBenchmarkResults aligns scores by fixture/screen/viewport key", () => {
  const resultA = buildResultWithDeltas(80, [
    { fixtureId: "simple-form", screenId: "1:65671", current: 88 },
    { fixtureId: "complex-dashboard", screenId: "2:10001", current: 72 },
  ]);
  const resultB = buildResultWithDeltas(82, [
    { fixtureId: "simple-form", screenId: "1:65671", current: 91 },
    { fixtureId: "complex-dashboard", screenId: "2:10001", current: 73 },
  ]);
  const result = compareVisualBenchmarkResults({
    configA: { label: "A", result: resultA },
    configB: { label: "B", result: resultB },
  });
  assert.equal(result.entries.length, 2);
  const simpleForm = result.entries.find((e) => e.fixtureId === "simple-form");
  assert.ok(simpleForm);
  assert.equal(simpleForm.scoreA, 88);
  assert.equal(simpleForm.scoreB, 91);
  assert.equal(simpleForm.delta, 3);
  assert.equal(simpleForm.indicator, "improved");
  const dashboard = result.entries.find(
    (e) => e.fixtureId === "complex-dashboard",
  );
  assert.ok(dashboard);
  assert.equal(dashboard.delta, 1);
  assert.equal(dashboard.indicator, "neutral");
  assert.equal(result.overallDelta, 2);
});

test("compareVisualBenchmarkResults reports degraded indicator beyond tolerance", () => {
  const resultA = buildResultWithDeltas(85, [
    { fixtureId: "simple-form", screenId: "1:65671", current: 88 },
  ]);
  const resultB = buildResultWithDeltas(80, [
    { fixtureId: "simple-form", screenId: "1:65671", current: 80 },
  ]);
  const result = compareVisualBenchmarkResults({
    configA: { label: "A", result: resultA },
    configB: { label: "B", result: resultB },
    neutralTolerance: 1,
  });
  assert.equal(result.entries[0]!.indicator, "degraded");
  assert.equal(result.statistics.degradedCount, 1);
  assert.equal(result.statistics.improvedCount, 0);
  assert.equal(result.statistics.worstRegression, -8);
});

test("compareVisualBenchmarkResults marks entries unavailable when missing on one side", () => {
  const resultA = buildResultWithDeltas(80, [
    { fixtureId: "simple-form", screenId: "1:65671", current: 88 },
    { fixtureId: "data-table", screenId: "2:10002", current: 91 },
  ]);
  const resultB = buildResultWithDeltas(80, [
    { fixtureId: "simple-form", screenId: "1:65671", current: 87 },
  ]);
  const result = compareVisualBenchmarkResults({
    configA: { label: "A", result: resultA },
    configB: { label: "B", result: resultB },
  });
  assert.equal(result.entries.length, 2);
  const dataTable = result.entries.find((e) => e.fixtureId === "data-table");
  assert.ok(dataTable);
  assert.equal(dataTable.scoreA, 91);
  assert.equal(dataTable.scoreB, null);
  assert.equal(dataTable.delta, null);
  assert.equal(dataTable.indicator, "unavailable");
  assert.equal(result.statistics.unavailableCount, 1);
});

test("compareVisualBenchmarkResults computes statistics across multiple entries", () => {
  const resultA = buildResultWithDeltas(70, [
    { fixtureId: "simple-form", screenId: "1:65671", current: 80 },
    { fixtureId: "complex-dashboard", screenId: "2:10001", current: 70 },
    { fixtureId: "data-table", screenId: "2:10002", current: 90 },
    { fixtureId: "navigation-sidebar", screenId: "2:10003", current: 60 },
  ]);
  const resultB = buildResultWithDeltas(73, [
    { fixtureId: "simple-form", screenId: "1:65671", current: 85 },
    { fixtureId: "complex-dashboard", screenId: "2:10001", current: 75 },
    { fixtureId: "data-table", screenId: "2:10002", current: 90 },
    { fixtureId: "navigation-sidebar", screenId: "2:10003", current: 50 },
  ]);
  const result = compareVisualBenchmarkResults({
    configA: { label: "A", result: resultA },
    configB: { label: "B", result: resultB },
    neutralTolerance: 1,
  });
  assert.equal(result.statistics.improvedCount, 2);
  assert.equal(result.statistics.degradedCount, 1);
  assert.equal(result.statistics.neutralCount, 1);
  assert.equal(result.statistics.bestImprovement, 5);
  assert.equal(result.statistics.worstRegression, -10);
  // +5 + +5 + 0 + (-10) = 0
  assert.equal(result.statistics.netChange, 0);
  assert.equal(result.statistics.meanDelta, 0);
  // average of positive deltas only: (5 + 5) / 2 = 5
  assert.equal(result.statistics.meanImprovement, 5);
  assert.equal(result.overallDelta, 3);
});

test("compareVisualBenchmarkResults keeps best/worst stats empty for neutral-only rows", () => {
  const resultA = buildResultWithDeltas(80, [
    { fixtureId: "simple-form", screenId: "1:65671", current: 80 },
  ]);
  const resultB = buildResultWithDeltas(80, [
    { fixtureId: "simple-form", screenId: "1:65671", current: 84 },
  ]);
  const result = compareVisualBenchmarkResults({
    configA: { label: "A", result: resultA },
    configB: { label: "B", result: resultB },
    neutralTolerance: 5,
  });
  assert.equal(result.entries[0]!.indicator, "neutral");
  assert.equal(result.statistics.improvedCount, 0);
  assert.equal(result.statistics.degradedCount, 0);
  assert.equal(result.statistics.bestImprovement, null);
  assert.equal(result.statistics.worstRegression, null);
});

test("compareVisualBenchmarkResults sorts entries deterministically", () => {
  const resultA = buildResultWithDeltas(80, [
    {
      fixtureId: "simple-form",
      screenId: "1:65671",
      viewportId: "tablet",
      current: 84,
    },
    {
      fixtureId: "simple-form",
      screenId: "1:65671",
      viewportId: "desktop",
      current: 88,
    },
    {
      fixtureId: "complex-dashboard",
      screenId: "2:10001",
      viewportId: "desktop",
      current: 72,
    },
  ]);
  const resultB = buildResultWithDeltas(82, [
    {
      fixtureId: "simple-form",
      screenId: "1:65671",
      viewportId: "desktop",
      current: 89,
    },
    {
      fixtureId: "simple-form",
      screenId: "1:65671",
      viewportId: "tablet",
      current: 86,
    },
    {
      fixtureId: "complex-dashboard",
      screenId: "2:10001",
      viewportId: "desktop",
      current: 73,
    },
  ]);
  const first = compareVisualBenchmarkResults({
    configA: { label: "A", result: resultA },
    configB: { label: "B", result: resultB },
  });
  const second = compareVisualBenchmarkResults({
    configA: { label: "A", result: resultA },
    configB: { label: "B", result: resultB },
  });
  assert.deepEqual(
    first.entries.map(
      (e) => `${e.fixtureId}::${e.screenId ?? ""}::${e.viewportId ?? ""}`,
    ),
    [
      "complex-dashboard::2:10001::desktop",
      "simple-form::1:65671::desktop",
      "simple-form::1:65671::tablet",
    ],
  );
  assert.deepEqual(first, second);
});

test("compareVisualBenchmarkResults aggregates warnings labelled by config", () => {
  const resultA = buildResultWithDeltas(80, [
    { fixtureId: "simple-form", screenId: "1:65671", current: 80 },
  ]);
  resultA.warnings = ["Stale baseline"];
  const resultB = buildResultWithDeltas(80, [
    { fixtureId: "simple-form", screenId: "1:65671", current: 81 },
  ]);
  resultB.warnings = ["Storybook coverage skipped"];
  const result = compareVisualBenchmarkResults({
    configA: { label: "A", result: resultA },
    configB: { label: "B", result: resultB },
  });
  assert.deepEqual(result.warnings, [
    "[A] Stale baseline",
    "[B] Storybook coverage skipped",
  ]);
});

test("compareVisualBenchmarkResults rejects viewport ids that would escape artifact paths", () => {
  const resultA = buildResultWithDeltas(80, [
    {
      fixtureId: "simple-form",
      screenId: "1:65671",
      viewportId: "../outside",
      current: 80,
    },
  ]);
  const resultB = buildResultWithDeltas(82, [
    {
      fixtureId: "simple-form",
      screenId: "1:65671",
      viewportId: "../outside",
      current: 82,
    },
  ]);
  assert.throws(
    () =>
      compareVisualBenchmarkResults({
        configA: { label: "A", result: resultA },
        configB: { label: "B", result: resultB },
      }),
    /viewport/i,
  );
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

test("formatVisualBenchmarkAbTable renders header columns and overall row", () => {
  const result = compareVisualBenchmarkResults({
    configA: {
      label: "Strict",
      result: buildResultWithDeltas(80, [
        {
          fixtureId: "simple-form",
          screenId: "1:65671",
          screenName: "Form",
          current: 80,
        },
      ]),
    },
    configB: {
      label: "Loose",
      result: buildResultWithDeltas(85, [
        {
          fixtureId: "simple-form",
          screenId: "1:65671",
          screenName: "Form",
          current: 85,
        },
      ]),
    },
  });
  const table = formatVisualBenchmarkAbTable(result);
  assert.match(table, /Strict/);
  assert.match(table, /Loose/);
  assert.match(table, /Simple Form/);
  assert.match(table, /Overall Average/);
  assert.match(table, /\+5/);
});

test("formatVisualBenchmarkAbStatistics includes all summary lines", () => {
  const result = compareVisualBenchmarkResults({
    configA: {
      label: "A",
      result: buildResultWithDeltas(80, [
        { fixtureId: "simple-form", screenId: "1:65671", current: 80 },
      ]),
    },
    configB: {
      label: "B",
      result: buildResultWithDeltas(85, [
        { fixtureId: "simple-form", screenId: "1:65671", current: 85 },
      ]),
    },
  });
  const summary = formatVisualBenchmarkAbStatistics(result);
  assert.match(summary, /Compared entries/);
  assert.match(summary, /Improved/);
  assert.match(summary, /Degraded/);
  assert.match(summary, /Mean delta/);
  assert.match(summary, /Net change/);
});

// ---------------------------------------------------------------------------
// composeThreeWayDiff
// ---------------------------------------------------------------------------

test("composeThreeWayDiff returns a buffer that combines three images", () => {
  const ref = buildSolidPng(40, 30, { r: 0, g: 0, b: 0 });
  const a = buildSolidPng(50, 40, { r: 255, g: 0, b: 0 });
  const b = buildSolidPng(60, 50, { r: 0, g: 255, b: 0 });
  const composed = composeThreeWayDiff({
    reference: ref,
    outputA: a,
    outputB: b,
  });
  const png = PNG.sync.read(composed);
  assert.equal(png.width, 40 + 16 + 50 + 16 + 60);
  assert.equal(png.height, 50);
});

test("composeThreeWayDiff fills missing sides with placeholder", () => {
  const ref = buildSolidPng(20, 20, { r: 0, g: 0, b: 0 });
  const composed = composeThreeWayDiff({
    reference: ref,
    outputA: null,
    outputB: null,
  });
  const png = PNG.sync.read(composed);
  // ref width 20 + gap 16 + placeholder 20 + gap 16 + placeholder 20 = 92
  assert.equal(png.width, 92);
  assert.equal(png.height, 20);
});

test("composeThreeWayDiff throws when all inputs are null", () => {
  assert.throws(
    () =>
      composeThreeWayDiff({ reference: null, outputA: null, outputB: null }),
    /requires at least one/i,
  );
});

test("composeThreeWayDiff rejects oversized PNG inputs before decoding", () => {
  assert.throws(
    () =>
      composeThreeWayDiff({
        reference: buildPngHeaderOnly(4096, 4096),
        outputA: buildSolidPng(8, 8, { r: 0, g: 0, b: 0 }),
        outputB: buildSolidPng(8, 8, { r: 255, g: 255, b: 255 }),
      }),
    /pixel limit/i,
  );
});

test("composeThreeWayDiff rejects wildly divergent dimensions with a typed error", () => {
  // ref is 200x200, outputA is 10x10 → ratio 20x, far above the default 4x limit
  const ref = buildSolidPng(200, 200, { r: 0, g: 0, b: 0 });
  const a = buildSolidPng(10, 10, { r: 255, g: 0, b: 0 });
  const b = buildSolidPng(200, 200, { r: 0, g: 255, b: 0 });
  let caught: unknown;
  try {
    composeThreeWayDiff({ reference: ref, outputA: a, outputB: b });
  } catch (error) {
    caught = error;
  }
  assert.ok(
    caught instanceof ThreeWayDiffDimensionDivergenceError,
    "expected a ThreeWayDiffDimensionDivergenceError",
  );
  const error = caught as ThreeWayDiffDimensionDivergenceError;
  assert.equal(error.maxRatio, DEFAULT_THREE_WAY_DIVERGENCE_LIMIT);
  assert.ok(error.observedRatio >= 20);
  assert.equal(error.dimensions.length, 3);
});

test("composeThreeWayDiff allows divergent inputs when the caller raises maxDimensionRatio", () => {
  const ref = buildSolidPng(200, 200, { r: 0, g: 0, b: 0 });
  const a = buildSolidPng(10, 10, { r: 255, g: 0, b: 0 });
  const b = buildSolidPng(200, 200, { r: 0, g: 255, b: 0 });
  const composed = composeThreeWayDiff({
    reference: ref,
    outputA: a,
    outputB: b,
    maxDimensionRatio: 1000,
  });
  const png = PNG.sync.read(composed);
  assert.equal(png.width, 200 + 16 + 10 + 16 + 200);
  assert.equal(png.height, 200);
});

test("composeThreeWayDiff allows borderline divergence within the default limit", () => {
  // ratio = 200/50 = 4, exactly at the limit (≤, not <)
  const ref = buildSolidPng(200, 200, { r: 0, g: 0, b: 0 });
  const a = buildSolidPng(50, 50, { r: 255, g: 0, b: 0 });
  const b = buildSolidPng(100, 100, { r: 0, g: 255, b: 0 });
  // Should NOT throw — 4x is the boundary, observedRatio === maxDimensionRatio
  const composed = composeThreeWayDiff({
    reference: ref,
    outputA: a,
    outputB: b,
  });
  assert.ok(composed.length > 0);
});

// ---------------------------------------------------------------------------
// runVisualBenchmarkAb
// ---------------------------------------------------------------------------

test("runVisualBenchmarkAb invokes runBenchmark twice with isolated artifact roots", async () => {
  const seenSides: string[] = [];
  const seenRoots: string[] = [];
  const configA: VisualBenchmarkAbConfig = { label: "Strict" };
  const configB: VisualBenchmarkAbConfig = { label: "Loose" };
  const result = await runVisualBenchmarkAb(
    {
      configA,
      configB,
      artifactRoot: "/tmp/test-ab",
    },
    {
      runBenchmark: async (
        side: "a" | "b",
        opts: VisualBenchmarkRunOptions,
      ) => {
        seenSides.push(side);
        seenRoots.push(opts.artifactRoot ?? "");
        return buildResultWithDeltas(side === "a" ? 80 : 84, [
          {
            fixtureId: "simple-form",
            screenId: "1:65671",
            current: side === "a" ? 80 : 86,
          },
        ]);
      },
    },
  );
  assert.deepEqual(seenSides, ["a", "b"]);
  assert.deepEqual(seenRoots, [
    path.join("/tmp/test-ab", "config-a"),
    path.join("/tmp/test-ab", "config-b"),
  ]);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]!.delta, 6);
  assert.equal(result.statistics.improvedCount, 1);
});

test("runVisualBenchmarkAb forwards shared benchmark options from both configs", async () => {
  const seen: VisualBenchmarkRunOptions[] = [];
  const configA: VisualBenchmarkAbConfig = {
    label: "Default",
    qualityConfig: { thresholds: { warn: 80 } },
    browsers: ["chromium"],
    viewportId: "desktop",
  };
  const configB: VisualBenchmarkAbConfig = {
    label: "Strict",
    qualityConfig: { thresholds: { warn: 90 } },
    browsers: ["chromium"],
    viewportId: "desktop",
  };
  await runVisualBenchmarkAb(
    {
      configA,
      configB,
      artifactRoot: "/tmp/test-ab-2",
    },
    {
      runBenchmark: async (_side, opts) => {
        seen.push(opts);
        return buildEmptyResult();
      },
    },
  );
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.qualityConfig?.thresholds?.warn, 80);
  assert.equal(seen[1]!.qualityConfig?.thresholds?.warn, 90);
  assert.deepEqual(seen[0]!.browsers, ["chromium"]);
  assert.deepEqual(seen[1]!.browsers, ["chromium"]);
  assert.equal(seen[0]!.viewportId, "desktop");
  assert.equal(seen[1]!.viewportId, "desktop");
});

test("runVisualBenchmarkAb rejects identical labels", async () => {
  await assert.rejects(
    async () =>
      runVisualBenchmarkAb(
        {
          configA: { label: "Same" },
          configB: { label: "Same" },
        },
        {
          runBenchmark: async () => buildEmptyResult(),
        },
      ),
    /distinct labels/i,
  );
});

test("runVisualBenchmarkAb rejects mismatched execution-shaping inputs", async () => {
  await assert.rejects(
    async () =>
      runVisualBenchmarkAb(
        {
          configA: { label: "A", browsers: ["chromium"] },
          configB: { label: "B", browsers: ["firefox"] },
        },
        {
          runBenchmark: async () => buildEmptyResult(),
        },
      ),
    /same browsers/i,
  );
});

test("runVisualBenchmarkAb resolves neutralTolerance from config B regression", async () => {
  let observedToleranceWasSet = false;
  const result = await runVisualBenchmarkAb(
    {
      configA: { label: "A" },
      configB: {
        label: "B",
        qualityConfig: {
          regression: { neutralTolerance: 5 },
        },
      },
    },
    {
      runBenchmark: async (side) => {
        observedToleranceWasSet = true;
        return buildResultWithDeltas(80, [
          {
            fixtureId: "simple-form",
            screenId: "1:65671",
            current: side === "a" ? 80 : 84,
          },
        ]);
      },
    },
  );
  assert.ok(observedToleranceWasSet);
  // delta is +4, within neutralTolerance=5 → neutral
  assert.equal(result.entries[0]!.indicator, "neutral");
  assert.equal(result.statistics.bestImprovement, null);
  assert.equal(result.statistics.worstRegression, null);
});

// ---------------------------------------------------------------------------
// persistVisualBenchmarkAbResult
// ---------------------------------------------------------------------------

test("persistVisualBenchmarkAbResult writes comparison.json and comparison.txt deterministically", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vb-ab-persist-"));
  try {
    const result = compareVisualBenchmarkResults({
      configA: {
        label: "A",
        result: buildResultWithDeltas(80, [
          { fixtureId: "simple-form", screenId: "1:65671", current: 80 },
        ]),
      },
      configB: {
        label: "B",
        result: buildResultWithDeltas(82, [
          { fixtureId: "simple-form", screenId: "1:65671", current: 82 },
        ]),
      },
    });
    const table = formatVisualBenchmarkAbTable(result);
    const paths = await persistVisualBenchmarkAbResult({
      result,
      artifactRoot: tmpRoot,
      table,
    });
    assert.equal(
      paths.comparisonJsonPath,
      path.join(tmpRoot, "comparison.json"),
    );
    const jsonContent = await readFile(paths.comparisonJsonPath, "utf8");
    const parsed = JSON.parse(jsonContent);
    assert.equal(parsed.configA.label, "A");
    assert.equal(parsed.configB.label, "B");
    assert.ok(Array.isArray(parsed.entries));
    const txt = await readFile(paths.comparisonTablePath!, "utf8");
    assert.match(txt, /Overall Average/);
    // Determinism: write twice, contents must be byte-identical
    await persistVisualBenchmarkAbResult({
      result,
      artifactRoot: tmpRoot,
      table,
    });
    const jsonContent2 = await readFile(paths.comparisonJsonPath, "utf8");
    assert.equal(jsonContent, jsonContent2);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// persistVisualBenchmarkAbThreeWayDiffs (filesystem integration)
// ---------------------------------------------------------------------------

test("persistVisualBenchmarkAbThreeWayDiffs writes a PNG when both sides have artifacts", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vb-ab-3way-"));
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "vb-ab-fixtures-"));
  try {
    const fixtureId = "simple-form";
    const screenId = "1:65671";
    const viewportId = "desktop";
    // Build fake fixture reference
    const referenceDir = path.join(
      fixtureRoot,
      fixtureId,
      "screens",
      screenId.replace(/:/g, "_"),
    );
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(referenceDir, { recursive: true });
    await writeFile(
      path.join(referenceDir, `${viewportId}.png`),
      buildSolidPng(20, 20, { r: 0, g: 0, b: 0 }),
    );
    // Build fake side A and side B last-run artifacts
    const buildSideArtifact = async (sideRoot: string): Promise<void> => {
      const screenToken = screenId.replace(/:/g, "_");
      const lastRunDir = path.join(
        sideRoot,
        "last-run",
        fixtureId,
        "screens",
        screenToken,
        viewportId,
      );
      await mkdir(lastRunDir, { recursive: true });
      await writeFile(
        path.join(lastRunDir, "actual.png"),
        buildSolidPng(20, 20, { r: 200, g: 200, b: 200 }),
      );
      await writeFile(
        path.join(lastRunDir, "manifest.json"),
        JSON.stringify({
          version: 2,
          fixtureId,
          screenId,
          viewportId,
          score: 80,
          ranAt: "2026-04-11T00:00:00.000Z",
          viewport: { width: 20, height: 20 },
        }),
      );
    };
    await buildSideArtifact(path.join(tmpRoot, "config-a"));
    await buildSideArtifact(path.join(tmpRoot, "config-b"));
    const result = compareVisualBenchmarkResults({
      configA: {
        label: "A",
        result: buildResultWithDeltas(80, [
          {
            fixtureId,
            screenId,
            viewportId,
            current: 80,
          },
        ]),
      },
      configB: {
        label: "B",
        result: buildResultWithDeltas(82, [
          {
            fixtureId,
            screenId,
            viewportId,
            current: 82,
          },
        ]),
      },
    });
    const persistResult = await persistVisualBenchmarkAbThreeWayDiffs({
      result,
      artifactRoot: tmpRoot,
      fixtureOptions: { fixtureRoot },
    });
    assert.equal(persistResult.written.length, 1);
    assert.equal(persistResult.skipped.length, 0);
    const record = persistResult.written[0]!;
    assert.equal(record.fixtureId, fixtureId);
    assert.equal(record.screenId, screenId);
    assert.equal(record.viewportId, viewportId);
    assert.ok(record.diffImagePath.endsWith(".png"));
    const composed = await readFile(
      path.resolve(process.cwd(), record.diffImagePath),
    );
    const png = PNG.sync.read(composed);
    // 20 + 16 + 20 + 16 + 20 = 92
    assert.equal(png.width, 92);
    assert.equal(png.height, 20);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("persistVisualBenchmarkAbThreeWayDiffs uses screen reference.png when viewportId is absent", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vb-ab-3way-screen-"));
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "vb-ab-screen-ref-"));
  try {
    const fixtureId = "simple-form";
    const screenId = "1:65671";
    const screenToken = screenId.replace(/:/g, "_");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const referenceDir = path.join(
      fixtureRoot,
      fixtureId,
      "screens",
      screenToken,
    );
    await mkdir(referenceDir, { recursive: true });
    await writeFile(
      path.join(referenceDir, "reference.png"),
      buildSolidPng(20, 20, { r: 0, g: 0, b: 0 }),
    );
    const buildSideArtifact = async (sideRoot: string): Promise<void> => {
      const lastRunDir = path.join(
        sideRoot,
        "last-run",
        fixtureId,
        "screens",
        screenToken,
      );
      await mkdir(lastRunDir, { recursive: true });
      await writeFile(
        path.join(lastRunDir, "actual.png"),
        buildSolidPng(20, 20, { r: 150, g: 150, b: 150 }),
      );
      await writeFile(
        path.join(lastRunDir, "manifest.json"),
        JSON.stringify({
          version: 2,
          fixtureId,
          screenId,
          score: 80,
          ranAt: "2026-04-11T00:00:00.000Z",
          viewport: { width: 20, height: 20 },
        }),
      );
    };
    await buildSideArtifact(path.join(tmpRoot, "config-a"));
    await buildSideArtifact(path.join(tmpRoot, "config-b"));
    const result = compareVisualBenchmarkResults({
      configA: {
        label: "A",
        result: buildResultWithDeltas(80, [
          { fixtureId, screenId, current: 80 },
        ]),
      },
      configB: {
        label: "B",
        result: buildResultWithDeltas(82, [
          { fixtureId, screenId, current: 82 },
        ]),
      },
    });
    const persistResult = await persistVisualBenchmarkAbThreeWayDiffs({
      result,
      artifactRoot: tmpRoot,
      fixtureOptions: { fixtureRoot },
    });
    assert.equal(persistResult.written.length, 1);
    assert.equal(persistResult.skipped.length, 0);
    assert.ok(
      persistResult.written[0]!.referenceImagePath?.endsWith(
        `${path.sep}${fixtureId}${path.sep}screens${path.sep}${screenToken}${path.sep}reference.png`,
      ),
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("persistVisualBenchmarkAbThreeWayDiffs surfaces side-A artifact-missing-on-disk skips", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vb-ab-3way-missing-"));
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "vb-ab-fixtures-missing-"),
  );
  try {
    const fixtureId = "simple-form";
    const screenId = "1:65671";
    const viewportId = "desktop";
    const referenceDir = path.join(
      fixtureRoot,
      fixtureId,
      "screens",
      screenId.replace(/:/g, "_"),
    );
    const { mkdir, writeFile, unlink } = await import("node:fs/promises");
    await mkdir(referenceDir, { recursive: true });
    await writeFile(
      path.join(referenceDir, `${viewportId}.png`),
      buildSolidPng(20, 20, { r: 0, g: 0, b: 0 }),
    );
    // Build BOTH sides, then delete the actual.png from side A only.
    const buildSideArtifact = async (sideRoot: string): Promise<string> => {
      const screenToken = screenId.replace(/:/g, "_");
      const lastRunDir = path.join(
        sideRoot,
        "last-run",
        fixtureId,
        "screens",
        screenToken,
        viewportId,
      );
      await mkdir(lastRunDir, { recursive: true });
      const actualPath = path.join(lastRunDir, "actual.png");
      await writeFile(
        actualPath,
        buildSolidPng(20, 20, { r: 200, g: 200, b: 200 }),
      );
      await writeFile(
        path.join(lastRunDir, "manifest.json"),
        JSON.stringify({
          version: 2,
          fixtureId,
          screenId,
          viewportId,
          score: 80,
          ranAt: "2026-04-11T00:00:00.000Z",
          viewport: { width: 20, height: 20 },
        }),
      );
      return actualPath;
    };
    const sideAActual = await buildSideArtifact(path.join(tmpRoot, "config-a"));
    await buildSideArtifact(path.join(tmpRoot, "config-b"));
    // Simulate a partially-corrupt artifact tree: manifest exists, actual.png
    // does not.
    await unlink(sideAActual);
    const result = compareVisualBenchmarkResults({
      configA: {
        label: "A",
        result: buildResultWithDeltas(80, [
          { fixtureId, screenId, viewportId, current: 80 },
        ]),
      },
      configB: {
        label: "B",
        result: buildResultWithDeltas(82, [
          { fixtureId, screenId, viewportId, current: 82 },
        ]),
      },
    });
    const persistResult = await persistVisualBenchmarkAbThreeWayDiffs({
      result,
      artifactRoot: tmpRoot,
      fixtureOptions: { fixtureRoot },
    });
    assert.equal(persistResult.written.length, 0);
    assert.equal(persistResult.skipped.length, 1);
    const skipped = persistResult.skipped[0]!;
    assert.equal(skipped.fixtureId, fixtureId);
    assert.equal(skipped.screenId, screenId);
    assert.equal(skipped.viewportId, viewportId);
    assert.equal(skipped.reason, "side-a-artifact-missing-on-disk");
    assert.ok(skipped.detail && skipped.detail.endsWith("actual.png"));
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("persistVisualBenchmarkAbThreeWayDiffs reports all-inputs-missing when nothing can be loaded", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vb-ab-3way-empty-"));
  try {
    const result = compareVisualBenchmarkResults({
      configA: {
        label: "A",
        result: buildResultWithDeltas(80, [
          { fixtureId: "simple-form", screenId: "1:65671", current: 80 },
        ]),
      },
      configB: {
        label: "B",
        result: buildResultWithDeltas(82, [
          { fixtureId: "simple-form", screenId: "1:65671", current: 82 },
        ]),
      },
    });
    const persistResult = await persistVisualBenchmarkAbThreeWayDiffs({
      result,
      artifactRoot: tmpRoot,
    });
    assert.equal(persistResult.written.length, 0);
    assert.equal(persistResult.skipped.length, 1);
    assert.equal(persistResult.skipped[0]!.reason, "all-inputs-missing");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("persistVisualBenchmarkAbThreeWayDiffs surfaces dimension-divergence skips", async () => {
  const tmpRoot = await mkdtemp(
    path.join(os.tmpdir(), "vb-ab-3way-divergent-"),
  );
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "vb-ab-fixtures-divergent-"),
  );
  try {
    const fixtureId = "simple-form";
    const screenId = "1:65671";
    const viewportId = "desktop";
    const referenceDir = path.join(
      fixtureRoot,
      fixtureId,
      "screens",
      screenId.replace(/:/g, "_"),
    );
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(referenceDir, { recursive: true });
    // Reference is 200x200, but side A is 5x5 → ratio 40x, far above the limit.
    await writeFile(
      path.join(referenceDir, `${viewportId}.png`),
      buildSolidPng(200, 200, { r: 0, g: 0, b: 0 }),
    );
    const buildSideArtifact = async (
      sideRoot: string,
      width: number,
      height: number,
    ): Promise<void> => {
      const screenToken = screenId.replace(/:/g, "_");
      const lastRunDir = path.join(
        sideRoot,
        "last-run",
        fixtureId,
        "screens",
        screenToken,
        viewportId,
      );
      await mkdir(lastRunDir, { recursive: true });
      await writeFile(
        path.join(lastRunDir, "actual.png"),
        buildSolidPng(width, height, { r: 200, g: 200, b: 200 }),
      );
      await writeFile(
        path.join(lastRunDir, "manifest.json"),
        JSON.stringify({
          version: 2,
          fixtureId,
          screenId,
          viewportId,
          score: 80,
          ranAt: "2026-04-11T00:00:00.000Z",
          viewport: { width, height },
        }),
      );
    };
    await buildSideArtifact(path.join(tmpRoot, "config-a"), 5, 5);
    await buildSideArtifact(path.join(tmpRoot, "config-b"), 200, 200);
    const result = compareVisualBenchmarkResults({
      configA: {
        label: "A",
        result: buildResultWithDeltas(80, [
          { fixtureId, screenId, viewportId, current: 80 },
        ]),
      },
      configB: {
        label: "B",
        result: buildResultWithDeltas(82, [
          { fixtureId, screenId, viewportId, current: 82 },
        ]),
      },
    });
    const persistResult = await persistVisualBenchmarkAbThreeWayDiffs({
      result,
      artifactRoot: tmpRoot,
      fixtureOptions: { fixtureRoot },
    });
    assert.equal(persistResult.written.length, 0);
    assert.equal(persistResult.skipped.length, 1);
    assert.equal(persistResult.skipped[0]!.reason, "dimension-divergence");
    assert.ok(
      persistResult.skipped[0]!.detail &&
        /diverge beyond/i.test(persistResult.skipped[0]!.detail),
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
