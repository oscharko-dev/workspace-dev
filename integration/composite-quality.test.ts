import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  COMPOSITE_QUALITY_PR_COMMENT_MARKER,
  DEFAULT_COMPOSITE_QUALITY_HISTORY_SIZE,
  DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
  appendCompositeQualityHistoryEntry,
  buildCompositeQualityReport,
  computeCompositeQualityScore,
  computePerformanceScore,
  loadCompositeQualityHistory,
  loadLighthouseSamplesFromPerfReport,
  loadVisualBenchmarkScoreFromLastRun,
  parseCompositeQualityHistory,
  renderCompositeQualityMarkdown,
  resolveCompositeQualityHistoryPath,
  resolveCompositeQualityWeights,
  saveCompositeQualityHistory,
  type CompositeLighthouseSampleMetrics,
  type CompositeQualityHistory,
  type CompositeQualityReport,
  type PerformanceScoreBreakdown,
} from "./composite-quality.js";

const createTempRoot = async (): Promise<string> =>
  mkdtemp(path.join(os.tmpdir(), "composite-quality-"));

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const makeLighthouseReport = (overrides?: {
  performanceScore?: number;
  fcp?: number;
  lcp?: number;
  cls?: number;
  tbt?: number;
  si?: number;
}): Record<string, unknown> => ({
  categories: {
    performance: { score: overrides?.performanceScore ?? 0.72 },
  },
  audits: {
    "first-contentful-paint": { numericValue: overrides?.fcp ?? 1800 },
    "largest-contentful-paint": { numericValue: overrides?.lcp ?? 2500 },
    "cumulative-layout-shift": { numericValue: overrides?.cls ?? 0.05 },
    "total-blocking-time": { numericValue: overrides?.tbt ?? 120 },
    "speed-index": { numericValue: overrides?.si ?? 3400 },
  },
});

const makeLegacyWrappedLighthouseReport = (overrides?: {
  performanceScore?: number;
  fcp?: number;
  lcp?: number;
  cls?: number;
  tbt?: number;
  si?: number;
}): Record<string, unknown> => ({
  report: {
    lhr: makeLighthouseReport(overrides),
  },
});

test("resolveCompositeQualityWeights returns defaults for null/undefined", () => {
  assert.deepEqual(
    resolveCompositeQualityWeights(undefined),
    DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
  );
  assert.deepEqual(
    resolveCompositeQualityWeights(null),
    DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
  );
  assert.deepEqual(
    resolveCompositeQualityWeights({}),
    DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
  );
});

test("resolveCompositeQualityWeights normalizes custom ratios to sum 1", () => {
  const weights = resolveCompositeQualityWeights({
    visual: 0.7,
    performance: 0.3,
  });
  assert.equal(weights.visual, 0.7);
  assert.equal(weights.performance, 0.3);
  assert.equal(weights.visual + weights.performance, 1);
});

test("resolveCompositeQualityHistoryPath uses canonical composite artifact location", () => {
  assert.equal(
    resolveCompositeQualityHistoryPath("artifacts"),
    path.join(
      "artifacts",
      "composite-quality",
      "composite-quality-history.json",
    ),
  );
});

test("resolveCompositeQualityWeights normalizes fractional pairs that don't sum to 1", () => {
  const weights = resolveCompositeQualityWeights({
    visual: 0.4,
    performance: 0.4,
  });
  assert.equal(weights.visual, 0.5);
  assert.equal(weights.performance, 0.5);
});

test("resolveCompositeQualityWeights derives complement when only one provided", () => {
  const w1 = resolveCompositeQualityWeights({ visual: 0.25 });
  assert.equal(w1.visual, 0.25);
  assert.equal(w1.performance, 0.75);

  const w2 = resolveCompositeQualityWeights({ performance: 0.1 });
  assert.equal(w2.visual, 0.9);
  assert.equal(w2.performance, 0.1);
});

test("resolveCompositeQualityWeights rejects invalid inputs", () => {
  assert.throws(
    () => resolveCompositeQualityWeights({ visual: Number.NaN }),
    /composite-quality/,
  );
  assert.throws(
    () => resolveCompositeQualityWeights({ visual: Number.POSITIVE_INFINITY }),
    /composite-quality/,
  );
  assert.throws(
    () => resolveCompositeQualityWeights({ visual: -0.1 }),
    /composite-quality/,
  );
  assert.throws(
    () => resolveCompositeQualityWeights({ visual: 1.5 }),
    /0\.\.1/,
  );
  assert.throws(
    () => resolveCompositeQualityWeights({ visual: 0, performance: 0 }),
    /positive value/,
  );
});

test("computeCompositeQualityScore handles both-null case", () => {
  const result = computeCompositeQualityScore(
    null,
    null,
    DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
  );
  assert.equal(result.score, null);
  assert.deepEqual(result.includedDimensions, []);
  assert.match(result.explanation, /no scores/);
});

test("computeCompositeQualityScore visual-only fallback", () => {
  const result = computeCompositeQualityScore(
    85,
    null,
    DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
  );
  assert.equal(result.score, 85);
  assert.deepEqual(result.includedDimensions, ["visual"]);
  assert.match(result.explanation, /visual-only/);
});

test("computeCompositeQualityScore performance-only fallback", () => {
  const result = computeCompositeQualityScore(
    null,
    72,
    DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
  );
  assert.equal(result.score, 72);
  assert.deepEqual(result.includedDimensions, ["performance"]);
  assert.match(result.explanation, /performance-only/);
});

test("computeCompositeQualityScore uses weighted sum with defaults", () => {
  const result = computeCompositeQualityScore(
    85,
    72,
    DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
  );
  // 0.6 * 85 + 0.4 * 72 = 51 + 28.8 = 79.8
  assert.equal(result.score, 79.8);
  assert.deepEqual(result.includedDimensions, ["visual", "performance"]);
  assert.match(result.explanation, /0\.6.*85.*0\.4.*72.*79\.8/);
});

test("computeCompositeQualityScore respects custom weights", () => {
  const result = computeCompositeQualityScore(85, 72, {
    visual: 0.2,
    performance: 0.8,
  });
  // 0.2 * 85 + 0.8 * 72 = 17 + 57.6 = 74.6
  assert.equal(result.score, 74.6);
});

test("visual improvement with perf regression is reflected in composite", () => {
  const before = computeCompositeQualityScore(80, 80, {
    visual: 0.6,
    performance: 0.4,
  });
  // Visual up +10, perf down -15 (net change reflects both)
  const after = computeCompositeQualityScore(90, 65, {
    visual: 0.6,
    performance: 0.4,
  });
  assert.equal(before.score, 80);
  // 0.6 * 90 + 0.4 * 65 = 54 + 26 = 80
  assert.equal(after.score, 80);
  // Same composite despite opposing directions — verify the AC bidirectionally
  const perfDegraded = computeCompositeQualityScore(80, 50, {
    visual: 0.6,
    performance: 0.4,
  });
  // 0.6 * 80 + 0.4 * 50 = 48 + 20 = 68
  assert.equal(perfDegraded.score, 68);
  assert.ok(
    perfDegraded.score !== null && before.score !== null,
    "scores should be defined",
  );
  assert.ok(
    perfDegraded.score < before.score,
    "perf degradation reduces composite",
  );
  const visualImproved = computeCompositeQualityScore(95, 80, {
    visual: 0.6,
    performance: 0.4,
  });
  // 0.6 * 95 + 0.4 * 80 = 57 + 32 = 89
  assert.equal(visualImproved.score, 89);
  assert.ok(
    visualImproved.score !== null && before.score !== null,
    "scores should be defined",
  );
  assert.ok(
    visualImproved.score > before.score,
    "visual improvement raises composite",
  );
});

test("computeCompositeQualityScore rejects out-of-range scores", () => {
  assert.throws(
    () =>
      computeCompositeQualityScore(-1, 50, DEFAULT_COMPOSITE_QUALITY_WEIGHTS),
    /0\.\.100/,
  );
  assert.throws(
    () =>
      computeCompositeQualityScore(50, 101, DEFAULT_COMPOSITE_QUALITY_WEIGHTS),
    /0\.\.100/,
  );
  assert.throws(
    () =>
      computeCompositeQualityScore(
        Number.NaN,
        50,
        DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
      ),
    /finite/,
  );
});

test("loadLighthouseSamplesFromPerfReport supports legacy report.lhr JSON", async () => {
  const root = await createTempRoot();

  try {
    const artifactDir = path.join(root, "artifacts", "performance");
    await mkdir(artifactDir, { recursive: true });
    await writeJson(
      path.join(artifactDir, "lighthouse-home-mobile.json"),
      makeLegacyWrappedLighthouseReport({
        performanceScore: 0.81,
        fcp: 1500,
        lcp: 2100,
        cls: 0.02,
        tbt: 75,
        si: 2800,
      }),
    );
    await writeJson(path.join(artifactDir, "perf-assert-report.json"), {
      samples: [
        {
          profile: "mobile",
          route: "/",
          artifacts: {
            lighthouseReport: "lighthouse-home-mobile.json",
          },
        },
      ],
    });

    const result = await loadLighthouseSamplesFromPerfReport({ artifactDir });

    assert.equal(result.warnings.length, 0);
    assert.equal(result.samples.length, 1);
    assert.deepEqual(result.samples[0], {
      profile: "mobile",
      route: "/",
      performanceScore: 81,
      fcp_ms: 1500,
      lcp_ms: 2100,
      cls: 0.02,
      tbt_ms: 75,
      speed_index_ms: 2800,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadCompositeQualityHistory falls back to the legacy history filename", async () => {
  const root = await createTempRoot();

  try {
    const historyPath = resolveCompositeQualityHistoryPath(root);
    const legacyHistoryPath = path.join(path.dirname(historyPath), "history.json");

    await mkdir(path.dirname(legacyHistoryPath), { recursive: true });
    await writeJson(legacyHistoryPath, {
      version: 1,
      entries: [
        {
          runAt: "2026-04-12T00:00:00.000Z",
          weights: { visual: 0.6, performance: 0.4 },
          visualScore: 91,
          performanceScore: 87,
          compositeScore: 89.4,
        },
      ],
    });

    const history = await loadCompositeQualityHistory(historyPath);

    assert.deepEqual(history, {
      version: 1,
      entries: [
        {
          runAt: "2026-04-12T00:00:00.000Z",
          weights: { visual: 0.6, performance: 0.4 },
          visualScore: 91,
          performanceScore: 87,
          compositeScore: 89.4,
        },
      ],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("computePerformanceScore empty samples returns null score + warning", () => {
  const result = computePerformanceScore([]);
  assert.equal(result.score, null);
  assert.equal(result.sampleCount, 0);
  assert.deepEqual(result.samples, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /no lighthouse samples/);
});

test("computePerformanceScore averages valid samples", () => {
  const samples: CompositeLighthouseSampleMetrics[] = [
    {
      profile: "mobile",
      route: "/",
      performanceScore: 80,
      fcp_ms: 1500,
      lcp_ms: 2200,
      cls: 0.02,
      tbt_ms: 100,
      speed_index_ms: 3000,
    },
    {
      profile: "desktop",
      route: "/",
      performanceScore: 90,
      fcp_ms: 1000,
      lcp_ms: 1500,
      cls: 0,
      tbt_ms: 50,
      speed_index_ms: 2000,
    },
  ];
  const result = computePerformanceScore(samples);
  assert.equal(result.score, 85);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.aggregateMetrics.fcp_ms, 1250);
  assert.equal(result.aggregateMetrics.lcp_ms, 1850);
  assert.equal(result.aggregateMetrics.cls, 0.01);
  assert.equal(result.aggregateMetrics.tbt_ms, 75);
  assert.equal(result.aggregateMetrics.speed_index_ms, 2500);
  assert.deepEqual(result.warnings, []);
});

test("computePerformanceScore tolerates missing metrics with warnings", () => {
  const samples: CompositeLighthouseSampleMetrics[] = [
    {
      profile: "mobile",
      route: "/",
      performanceScore: 80,
      fcp_ms: 1500,
      lcp_ms: null,
      cls: null,
      tbt_ms: 100,
      speed_index_ms: null,
    },
  ];
  const result = computePerformanceScore(samples);
  assert.equal(result.score, 80);
  assert.equal(result.aggregateMetrics.lcp_ms, null);
  assert.equal(result.aggregateMetrics.cls, null);
  assert.equal(result.aggregateMetrics.speed_index_ms, null);
  assert.ok(result.warnings.some((w) => w.includes("missing LCP")));
  assert.ok(result.warnings.some((w) => w.includes("missing CLS")));
  assert.ok(result.warnings.some((w) => w.includes("missing Speed Index")));
});

test("computePerformanceScore is deterministic", () => {
  const samples: CompositeLighthouseSampleMetrics[] = [
    {
      profile: "mobile",
      route: "/",
      performanceScore: 70,
      fcp_ms: 1000,
      lcp_ms: 1500,
      cls: 0.01,
      tbt_ms: 80,
      speed_index_ms: 2000,
    },
  ];
  const first = computePerformanceScore(samples);
  const second = computePerformanceScore(samples);
  assert.deepEqual(first, second);
});

test("loadLighthouseSamplesFromPerfReport extracts FCP/LCP/CLS/TBT/Speed Index", async () => {
  const root = await createTempRoot();
  try {
    const artifactDir = path.join(root, "artifacts", "performance");
    const lhrPath = path.join(artifactDir, "lighthouse-mobile-home.json");
    const perfReportPath = path.join(artifactDir, "perf-assert-report.json");
    await writeJson(
      lhrPath,
      makeLighthouseReport({
        performanceScore: 0.85,
        fcp: 1200,
        lcp: 2000,
        cls: 0.02,
        tbt: 60,
        si: 2500,
      }),
    );
    await writeJson(perfReportPath, {
      mode: "assert",
      generatedAt: "2026-04-12T00:00:00.000Z",
      durationMs: 1000,
      config: {},
      aggregate: {},
      baselineStatus: "compared",
      checks: { budgets: [], regression: [] },
      counts: { samples: 1, failedBudgets: 0, failedRegression: 0 },
      samples: [
        {
          profile: "mobile",
          route: "/",
          url: "http://localhost:4173/",
          metrics: {},
          audits: { performance_score: 0.85 },
          artifacts: { lighthouseReport: lhrPath },
        },
      ],
    });
    const result = await loadLighthouseSamplesFromPerfReport({ artifactDir });
    assert.equal(result.sourcePath, perfReportPath);
    assert.equal(result.samples.length, 1);
    assert.deepEqual(result.samples[0], {
      profile: "mobile",
      route: "/",
      performanceScore: 85,
      fcp_ms: 1200,
      lcp_ms: 2000,
      cls: 0.02,
      tbt_ms: 60,
      speed_index_ms: 2500,
    });
    assert.deepEqual(result.warnings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadLighthouseSamplesFromPerfReport missing report returns empty + warning", async () => {
  const root = await createTempRoot();
  try {
    const artifactDir = path.join(root, "artifacts", "performance");
    await mkdir(artifactDir, { recursive: true });
    const result = await loadLighthouseSamplesFromPerfReport({ artifactDir });
    assert.equal(result.sourcePath, null);
    assert.deepEqual(result.samples, []);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0]!, /not found/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadLighthouseSamplesFromPerfReport skips malformed LHR but continues", async () => {
  const root = await createTempRoot();
  try {
    const artifactDir = path.join(root, "artifacts", "performance");
    const goodLhrPath = path.join(artifactDir, "lighthouse-mobile-home.json");
    const badLhrPath = path.join(artifactDir, "lighthouse-desktop-home.json");
    const perfReportPath = path.join(artifactDir, "perf-assert-report.json");
    await writeJson(goodLhrPath, makeLighthouseReport({ fcp: 999 }));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(badLhrPath, "{this is not json}", "utf8");
    await writeJson(perfReportPath, {
      samples: [
        {
          profile: "mobile",
          route: "/",
          artifacts: { lighthouseReport: goodLhrPath },
        },
        {
          profile: "desktop",
          route: "/",
          artifacts: { lighthouseReport: badLhrPath },
        },
        {
          profile: "mobile",
          route: "/missing",
          artifacts: {
            lighthouseReport: path.join(artifactDir, "nonexistent.json"),
          },
        },
      ],
    });
    const result = await loadLighthouseSamplesFromPerfReport({ artifactDir });
    assert.equal(result.samples.length, 1);
    assert.equal(result.samples[0]?.fcp_ms, 999);
    assert.ok(result.warnings.some((w) => w.includes("malformed")));
    assert.ok(result.warnings.some((w) => w.includes("failed to read")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadLighthouseSamplesFromPerfReport handles missing artifact paths", async () => {
  const root = await createTempRoot();
  try {
    const artifactDir = path.join(root, "artifacts", "performance");
    const perfReportPath = path.join(artifactDir, "perf-assert-report.json");
    await writeJson(perfReportPath, {
      samples: [
        {
          profile: "mobile",
          route: "/",
          // no artifacts field
        },
      ],
    });
    const result = await loadLighthouseSamplesFromPerfReport({ artifactDir });
    assert.deepEqual(result.samples, []);
    assert.ok(
      result.warnings.some((w) => w.includes("artifacts.lighthouseReport")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadLighthouseSamplesFromPerfReport falls back to perf-baseline.json", async () => {
  const root = await createTempRoot();
  try {
    const artifactDir = path.join(root, "artifacts", "performance");
    const lhrPath = path.join(artifactDir, "lighthouse-mobile-home.json");
    const baselinePath = path.join(artifactDir, "perf-baseline.json");
    await writeJson(lhrPath, makeLighthouseReport());
    await writeJson(baselinePath, {
      samples: [
        {
          profile: "mobile",
          route: "/",
          artifacts: { lighthouseReport: lhrPath },
        },
      ],
    });
    const result = await loadLighthouseSamplesFromPerfReport({ artifactDir });
    assert.equal(result.sourcePath, baselinePath);
    assert.equal(result.samples.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadVisualBenchmarkScoreFromLastRun reads valid file", async () => {
  const root = await createTempRoot();
  try {
    const lastRunPath = path.join(root, "last-run.json");
    await writeJson(lastRunPath, {
      version: 1,
      ranAt: "2026-04-10T10:00:00.000Z",
      scores: [{ fixtureId: "foo", score: 91 }],
      overallCurrent: 91.5,
    });
    const result = await loadVisualBenchmarkScoreFromLastRun(lastRunPath);
    assert.ok(result !== null);
    assert.equal(result.overallScore, 91.5);
    assert.equal(result.ranAt, "2026-04-10T10:00:00.000Z");
    assert.equal(result.source, lastRunPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadVisualBenchmarkScoreFromLastRun falls through score sources", async () => {
  const root = await createTempRoot();
  try {
    const lastRunPath = path.join(root, "last-run.json");
    await writeJson(lastRunPath, {
      version: 1,
      ranAt: "2026-04-10T10:00:00.000Z",
      scores: [{ fixtureId: "foo", score: 77 }],
    });
    const result = await loadVisualBenchmarkScoreFromLastRun(lastRunPath);
    assert.ok(result !== null);
    assert.equal(result.overallScore, 77);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadVisualBenchmarkScoreFromLastRun missing file returns null", async () => {
  const result = await loadVisualBenchmarkScoreFromLastRun(
    "/nonexistent/path/last-run.json",
  );
  assert.equal(result, null);
});

test("loadVisualBenchmarkScoreFromLastRun throws on malformed", async () => {
  const root = await createTempRoot();
  try {
    const lastRunPath = path.join(root, "last-run.json");
    await writeFile(lastRunPath, "{not json}", "utf8");
    await assert.rejects(
      () => loadVisualBenchmarkScoreFromLastRun(lastRunPath),
      /malformed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadVisualBenchmarkScoreFromLastRun throws when no score extractable", async () => {
  const root = await createTempRoot();
  try {
    const lastRunPath = path.join(root, "last-run.json");
    await writeJson(lastRunPath, {
      version: 1,
      ranAt: "2026-04-10T10:00:00.000Z",
      scores: [],
    });
    await assert.rejects(
      () => loadVisualBenchmarkScoreFromLastRun(lastRunPath),
      /usable score/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("history round-trip: save, load, append, trim", async () => {
  const root = await createTempRoot();
  try {
    const historyPath = resolveCompositeQualityHistoryPath(path.join(root, "artifacts"));
    assert.equal(path.basename(historyPath), "composite-quality-history.json");
    assert.match(
      historyPath,
      /artifacts[\\/]+composite-quality[\\/]+composite-quality-history\.json$/,
    );

    // Initially, no file
    const initial = await loadCompositeQualityHistory(historyPath);
    assert.equal(initial, null);

    // Append and save
    let history = appendCompositeQualityHistoryEntry(null, {
      runAt: "2026-04-12T10:00:00.000Z",
      weights: DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
      visualScore: 85,
      performanceScore: 72,
      compositeScore: 79.8,
    });
    await saveCompositeQualityHistory(historyPath, history);

    // Load it back
    const loaded = await loadCompositeQualityHistory(historyPath);
    assert.ok(loaded !== null);
    assert.equal(loaded.version, 1);
    assert.equal(loaded.entries.length, 1);
    assert.equal(loaded.entries[0]?.compositeScore, 79.8);

    // Append another and save
    history = appendCompositeQualityHistoryEntry(loaded, {
      runAt: "2026-04-12T11:00:00.000Z",
      weights: DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
      visualScore: 90,
      performanceScore: null,
      compositeScore: 90,
    });
    assert.equal(history.entries.length, 2);
    await saveCompositeQualityHistory(historyPath, history);

    // Trim to max
    let trimmed: CompositeQualityHistory | null = null;
    for (let i = 0; i < 5; i += 1) {
      trimmed = appendCompositeQualityHistoryEntry(
        trimmed,
        {
          runAt: `2026-04-12T12:0${String(i)}:00.000Z`,
          weights: DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
          visualScore: i,
          performanceScore: i,
          compositeScore: i,
        },
        3,
      );
    }
    assert.equal(trimmed?.entries.length, 3);
    assert.equal(trimmed?.entries[0]?.visualScore, 2);
    assert.equal(trimmed?.entries[2]?.visualScore, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("appendCompositeQualityHistoryEntry validates maxEntries bounds", () => {
  assert.throws(
    () =>
      appendCompositeQualityHistoryEntry(
        null,
        {
          runAt: "2026-04-12T10:00:00.000Z",
          weights: DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
          visualScore: null,
          performanceScore: null,
          compositeScore: null,
        },
        0,
      ),
    /positive integer/,
  );
  assert.throws(
    () =>
      appendCompositeQualityHistoryEntry(
        null,
        {
          runAt: "2026-04-12T10:00:00.000Z",
          weights: DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
          visualScore: null,
          performanceScore: null,
          compositeScore: null,
        },
        10_000,
      ),
    /must not exceed/,
  );
});

test("parseCompositeQualityHistory rejects invalid shapes", () => {
  assert.throws(() => parseCompositeQualityHistory("[]"), /must be an object/);
  assert.throws(
    () => parseCompositeQualityHistory('{"version":2,"entries":[]}'),
    /version must be 1/,
  );
  assert.throws(
    () => parseCompositeQualityHistory('{"version":1,"entries":{}}'),
    /entries must be an array/,
  );
});

test("DEFAULT_COMPOSITE_QUALITY_HISTORY_SIZE is exported", () => {
  assert.equal(DEFAULT_COMPOSITE_QUALITY_HISTORY_SIZE, 20);
});

test("buildCompositeQualityReport assembles full report", () => {
  const perfBreakdown: PerformanceScoreBreakdown = {
    score: 72,
    sampleCount: 1,
    samples: [
      {
        profile: "mobile",
        route: "/",
        performanceScore: 72,
        fcp_ms: 1800,
        lcp_ms: 2500,
        cls: 0.05,
        tbt_ms: 120,
        speed_index_ms: 3400,
      },
    ],
    aggregateMetrics: {
      fcp_ms: 1800,
      lcp_ms: 2500,
      cls: 0.05,
      tbt_ms: 120,
      speed_index_ms: 3400,
    },
    warnings: [],
  };
  const report = buildCompositeQualityReport({
    visual: {
      overallScore: 85,
      ranAt: "2026-04-12T10:00:00.000Z",
      source: "artifacts/visual-benchmark/last-run.json",
    },
    performance: perfBreakdown,
    weights: DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
    generatedAt: "2026-04-12T11:00:00.000Z",
  });
  assert.equal(report.version, 1);
  assert.equal(report.generatedAt, "2026-04-12T11:00:00.000Z");
  assert.equal(report.visual?.score, 85);
  assert.equal(report.performance?.score, 72);
  assert.equal(report.composite.score, 79.8);
  assert.deepEqual(report.composite.includedDimensions, [
    "visual",
    "performance",
  ]);
  assert.deepEqual(report.warnings, []);
});

test("buildCompositeQualityReport handles visual-only input", () => {
  const report = buildCompositeQualityReport({
    visual: {
      overallScore: 85,
      ranAt: "2026-04-12T10:00:00.000Z",
      source: "artifacts/visual-benchmark/last-run.json",
    },
    performance: null,
    weights: DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
    generatedAt: "2026-04-12T11:00:00.000Z",
  });
  assert.equal(report.visual?.score, 85);
  assert.equal(report.performance, null);
  assert.equal(report.composite.score, 85);
  assert.deepEqual(report.composite.includedDimensions, ["visual"]);
  assert.ok(report.warnings.some((w) => w.includes("performance")));
});

test("buildCompositeQualityReport handles performance-only input", () => {
  const report = buildCompositeQualityReport({
    visual: null,
    performance: {
      score: 72,
      sampleCount: 1,
      samples: [],
      aggregateMetrics: {
        fcp_ms: null,
        lcp_ms: null,
        cls: null,
        tbt_ms: null,
        speed_index_ms: null,
      },
      warnings: [],
    },
    weights: DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
    generatedAt: "2026-04-12T11:00:00.000Z",
  });
  assert.equal(report.visual, null);
  assert.equal(report.composite.score, 72);
  assert.deepEqual(report.composite.includedDimensions, ["performance"]);
  assert.ok(report.warnings.some((w) => w.includes("visual")));
});

test("buildCompositeQualityReport handles neither side", () => {
  const report = buildCompositeQualityReport({
    visual: null,
    performance: null,
    weights: DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
    generatedAt: "2026-04-12T11:00:00.000Z",
  });
  assert.equal(report.composite.score, null);
  assert.deepEqual(report.composite.includedDimensions, []);
});

test("buildCompositeQualityReport surfaces performance warnings", () => {
  const report = buildCompositeQualityReport({
    visual: null,
    performance: {
      score: null,
      sampleCount: 0,
      samples: [],
      aggregateMetrics: {
        fcp_ms: null,
        lcp_ms: null,
        cls: null,
        tbt_ms: null,
        speed_index_ms: null,
      },
      warnings: ["no lighthouse samples provided"],
    },
    weights: DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
    generatedAt: "2026-04-12T11:00:00.000Z",
  });
  assert.ok(
    report.warnings.some((w) => w.includes("no lighthouse samples provided")),
  );
});

test("renderCompositeQualityMarkdown includes marker and headline", () => {
  const report: CompositeQualityReport = buildCompositeQualityReport({
    visual: {
      overallScore: 85,
      ranAt: "2026-04-12T10:00:00.000Z",
      source: "artifacts/visual-benchmark/last-run.json",
    },
    performance: {
      score: 72,
      sampleCount: 2,
      samples: [
        {
          profile: "mobile",
          route: "/",
          performanceScore: 70,
          fcp_ms: 1800,
          lcp_ms: 2500,
          cls: 0.05,
          tbt_ms: 120,
          speed_index_ms: 3400,
        },
        {
          profile: "desktop",
          route: "/",
          performanceScore: 74,
          fcp_ms: 1200,
          lcp_ms: 1900,
          cls: 0.01,
          tbt_ms: 50,
          speed_index_ms: 2100,
        },
      ],
      aggregateMetrics: {
        fcp_ms: 1500,
        lcp_ms: 2200,
        cls: 0.03,
        tbt_ms: 85,
        speed_index_ms: 2750,
      },
      warnings: [],
    },
    weights: DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
    generatedAt: "2026-04-12T11:00:00.000Z",
  });
  const markdown = renderCompositeQualityMarkdown(report);
  assert.ok(markdown.startsWith(COMPOSITE_QUALITY_PR_COMMENT_MARKER));
  assert.match(markdown, /Combined Visual \+ Performance Quality/);
  assert.match(markdown, /79\.8/);
  assert.match(markdown, /visual 60%/);
  assert.match(markdown, /performance 40%/);
  assert.match(markdown, /\| mobile \| \//);
  assert.match(markdown, /\| desktop \| \//);
  assert.match(markdown, /FCP \/ LCP \/ CLS \/ TBT \/ Speed Index/);
});

test("renderCompositeQualityMarkdown handles null pieces gracefully", () => {
  const report = buildCompositeQualityReport({
    visual: null,
    performance: null,
    weights: DEFAULT_COMPOSITE_QUALITY_WEIGHTS,
    generatedAt: "2026-04-12T11:00:00.000Z",
  });
  const markdown = renderCompositeQualityMarkdown(report);
  assert.ok(markdown.startsWith(COMPOSITE_QUALITY_PR_COMMENT_MARKER));
  assert.match(markdown, /Visual score source: not available/);
  assert.match(markdown, /Performance source: not available/);
  assert.match(markdown, /—/);
});
