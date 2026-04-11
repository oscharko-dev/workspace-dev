import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../../package.json" with { type: "json" };
import { CONTRACT_VERSION } from "../contracts/index.js";
import { PNG } from "pngjs";
import { comparePngBuffers } from "./visual-diff.js";
import {
  DEFAULT_SCORING_CONFIG,
  DEFAULT_SCORING_WEIGHTS,
  computeVisualQualityReport,
  interpretScore,
} from "./visual-scoring.js";
import type { VisualDiffResult } from "./visual-diff.js";

const createSolidPng = (
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a: number = 255,
): Buffer => {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }
  return PNG.sync.write(png);
};

const createHalfRedHalfBluePng = (width: number, height: number): Buffer => {
  const png = new PNG({ width, height });
  const halfWidth = Math.floor(width / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      if (x < halfWidth) {
        png.data[idx] = 255;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
      } else {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 255;
      }
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
};

const FIXED_TIMESTAMP = "2026-04-09T00:00:00.000Z";

test("computeVisualQualityReport returns score 100 for identical images", () => {
  const red = createSolidPng(90, 100, 255, 0, 0);
  const diffResult = comparePngBuffers({
    referenceBuffer: red,
    testBuffer: red,
  });

  const report = computeVisualQualityReport({
    diffResult,
    comparedAt: FIXED_TIMESTAMP,
  });

  assert.equal(report.overallScore, 100);
  assert.equal(
    report.interpretation,
    "Excellent parity — minor sub-pixel or anti-aliasing differences",
  );
  for (const dim of report.dimensions) {
    assert.equal(dim.score, 100, `Dimension ${dim.name} should be 100`);
  }
  assert.equal(report.hotspots.length, 0);
  assert.equal(report.diffImagePath, "");
  assert.equal(report.metadata.comparedAt, FIXED_TIMESTAMP);
  assert.equal(report.metadata.imageWidth, 90);
  assert.equal(report.metadata.imageHeight, 100);
  assert.equal(report.metadata.totalPixels, 9000);
  assert.equal(report.metadata.diffPixelCount, 0);
  assert.deepEqual(report.metadata.viewport, {
    width: 90,
    height: 100,
    deviceScaleFactor: 1,
  });
  assert.deepEqual(report.metadata.versions, {
    packageVersion: packageJson.version,
    contractVersion: CONTRACT_VERSION,
  });
});

test("computeVisualQualityReport returns low score for totally different images", () => {
  const red = createSolidPng(90, 100, 255, 0, 0);
  const blue = createSolidPng(90, 100, 0, 0, 255);
  const diffResult = comparePngBuffers({
    referenceBuffer: red,
    testBuffer: blue,
  });

  const report = computeVisualQualityReport({
    diffResult,
    comparedAt: FIXED_TIMESTAMP,
  });

  assert.ok(
    report.overallScore < 20,
    `Expected overall < 20, got ${String(report.overallScore)}`,
  );
  assert.ok(report.hotspots.length > 0, "Expected at least one hotspot");
  for (const hotspot of report.hotspots) {
    assert.equal(hotspot.severity, "critical");
  }
});

test("computeVisualQualityReport produces score in moderate range for partially different images", () => {
  const halfRedBlue = createHalfRedHalfBluePng(90, 100);
  const allRed = createSolidPng(90, 100, 255, 0, 0);
  const diffResult = comparePngBuffers({
    referenceBuffer: halfRedBlue,
    testBuffer: allRed,
  });

  const report = computeVisualQualityReport({
    diffResult,
    comparedAt: FIXED_TIMESTAMP,
  });

  assert.ok(
    report.overallScore >= 30 && report.overallScore <= 80,
    `Expected score between 30-80, got ${String(report.overallScore)}`,
  );
});

test("computeVisualQualityReport is deterministic for the same input", () => {
  const red = createSolidPng(90, 100, 255, 0, 0);
  const blue = createSolidPng(90, 100, 0, 0, 255);
  const diffResult = comparePngBuffers({
    referenceBuffer: red,
    testBuffer: blue,
  });

  const report1 = computeVisualQualityReport({
    diffResult,
    comparedAt: FIXED_TIMESTAMP,
  });
  const report2 = computeVisualQualityReport({
    diffResult,
    comparedAt: FIXED_TIMESTAMP,
  });

  assert.deepEqual(report1, report2);
});

test("computeVisualQualityReport respects custom weights", () => {
  const red = createSolidPng(90, 100, 255, 0, 0);
  const blue = createSolidPng(90, 100, 0, 0, 255);
  const diffResult = comparePngBuffers({
    referenceBuffer: red,
    testBuffer: blue,
  });

  const customWeights = {
    layoutAccuracy: 0.5,
    colorFidelity: 0.1,
    typography: 0.1,
    componentStructure: 0.2,
    spacingAlignment: 0.1,
  };

  const defaultReport = computeVisualQualityReport({
    diffResult,
    comparedAt: FIXED_TIMESTAMP,
  });
  const customReport = computeVisualQualityReport({
    diffResult,
    config: { weights: customWeights },
    comparedAt: FIXED_TIMESTAMP,
  });

  assert.notEqual(defaultReport.overallScore, customReport.overallScore);
  assert.deepEqual(customReport.metadata.configuredWeights, customWeights);
});

test("computeVisualQualityReport emits diff image path and explicit viewport metadata", () => {
  const red = createSolidPng(20, 10, 255, 0, 0);
  const blue = createSolidPng(20, 10, 0, 0, 255);
  const diffResult = comparePngBuffers({
    referenceBuffer: red,
    testBuffer: blue,
  });

  const report = computeVisualQualityReport({
    diffResult,
    comparedAt: FIXED_TIMESTAMP,
    diffImagePath: "/tmp/visual-audit/diff.png",
    viewport: {
      width: 1280,
      height: 720,
      deviceScaleFactor: 2,
    },
  });

  assert.equal(report.diffImagePath, "/tmp/visual-audit/diff.png");
  assert.deepEqual(report.metadata.viewport, {
    width: 1280,
    height: 720,
    deviceScaleFactor: 2,
  });
  assert.deepEqual(report.metadata.versions, {
    packageVersion: packageJson.version,
    contractVersion: CONTRACT_VERSION,
  });
});

test("interpretScore returns correct interpretation for each range", () => {
  assert.equal(
    interpretScore(95),
    "Excellent parity — minor sub-pixel or anti-aliasing differences",
  );
  assert.equal(
    interpretScore(90),
    "Excellent parity — minor sub-pixel or anti-aliasing differences",
  );
  assert.equal(
    interpretScore(75),
    "Good parity — small layout or color deviations",
  );
  assert.equal(
    interpretScore(70),
    "Good parity — small layout or color deviations",
  );
  assert.equal(
    interpretScore(55),
    "Moderate deviations — visible differences in structure or styling",
  );
  assert.equal(
    interpretScore(50),
    "Moderate deviations — visible differences in structure or styling",
  );
  assert.equal(
    interpretScore(30),
    "Significant deviations — major layout or component mismatches",
  );
  assert.equal(
    interpretScore(0),
    "Significant deviations — major layout or component mismatches",
  );
});

test("computeVisualQualityReport detects hotspots ranked by severity", () => {
  const halfRedBlue = createHalfRedHalfBluePng(90, 100);
  const allRed = createSolidPng(90, 100, 255, 0, 0);
  const diffResult = comparePngBuffers({
    referenceBuffer: halfRedBlue,
    testBuffer: allRed,
  });

  const report = computeVisualQualityReport({
    diffResult,
    comparedAt: FIXED_TIMESTAMP,
  });

  assert.ok(report.hotspots.length > 0, "Expected at least one hotspot");
  for (let i = 1; i < report.hotspots.length; i++) {
    const prev = report.hotspots[i - 1];
    const curr = report.hotspots[i];
    assert.ok(prev !== undefined);
    assert.ok(curr !== undefined);
    assert.ok(
      prev.deviationPercent >= curr.deviationPercent,
      `Hotspot ${String(i - 1)} (${String(prev.deviationPercent)}) should have >= deviation than hotspot ${String(i)} (${String(curr.deviationPercent)})`,
    );
    assert.equal(prev.rank, i);
    assert.equal(curr.rank, i + 1);
  }
});

test("computeVisualQualityReport handles empty regions gracefully", () => {
  const emptyRegionResult: VisualDiffResult = {
    diffImageBuffer: Buffer.alloc(0),
    similarityScore: 75,
    diffPixelCount: 250,
    totalPixels: 1000,
    regions: [],
    width: 100,
    height: 10,
  };

  const report = computeVisualQualityReport({
    diffResult: emptyRegionResult,
    comparedAt: FIXED_TIMESTAMP,
  });

  assert.equal(report.overallScore, 75);
  assert.equal(report.hotspots.length, 0);
  assert.equal(report.dimensions.length, 5);
  for (const dim of report.dimensions) {
    assert.equal(dim.score, 75, `Dimension ${dim.name} should fall back to 75`);
  }
});

test("resolveScoringConfig rejects weights that do not sum to 1", () => {
  const red = createSolidPng(10, 10, 255, 0, 0);
  const diffResult = comparePngBuffers({
    referenceBuffer: red,
    testBuffer: red,
  });

  assert.throws(
    () =>
      computeVisualQualityReport({
        diffResult,
        config: {
          weights: {
            layoutAccuracy: 0.5,
            colorFidelity: 0.5,
            typography: 0.5,
            componentStructure: 0.5,
            spacingAlignment: 0.5,
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /weights must sum to 1\.0/i);
      return true;
    },
  );
});

test("resolveScoringConfig rejects non-finite or out-of-range weights", () => {
  const red = createSolidPng(10, 10, 255, 0, 0);
  const diffResult = comparePngBuffers({
    referenceBuffer: red,
    testBuffer: red,
  });

  for (const [weights, expectedMessage] of [
    [
      {
        layoutAccuracy: Number.NaN,
        colorFidelity: 0.25,
        typography: 0.2,
        componentStructure: 0.15,
        spacingAlignment: 0.1,
      },
      /layoutAccuracy.*finite/i,
    ],
    [
      {
        layoutAccuracy: 1.1,
        colorFidelity: 0.25,
        typography: 0.2,
        componentStructure: 0.15,
        spacingAlignment: 0.1,
      },
      /layoutAccuracy.*between 0 and 1/i,
    ],
    [
      {
        layoutAccuracy: 0.3,
        colorFidelity: -0.25,
        typography: 0.2,
        componentStructure: 0.15,
        spacingAlignment: 0.6,
      },
      /colorFidelity.*between 0 and 1/i,
    ],
  ] as const) {
    assert.throws(
      () =>
        computeVisualQualityReport({
          diffResult,
          config: { weights },
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, expectedMessage);
        return true;
      },
    );
  }
});

test("resolveScoringConfig rejects invalid hotspotCount values", () => {
  const red = createSolidPng(10, 10, 255, 0, 0);
  const blue = createSolidPng(10, 10, 0, 0, 255);
  const diffResult = comparePngBuffers({
    referenceBuffer: red,
    testBuffer: blue,
  });

  for (const hotspotCount of [Number.NaN, -1, 1.5]) {
    assert.throws(
      () =>
        computeVisualQualityReport({
          diffResult,
          config: { hotspotCount },
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(
          error.message,
          /hotspotCount must be a finite integer greater than or equal to 0/i,
        );
        return true;
      },
    );
  }
});

test("DEFAULT_SCORING_WEIGHTS and DEFAULT_SCORING_CONFIG have expected values", () => {
  assert.deepEqual(DEFAULT_SCORING_WEIGHTS, {
    layoutAccuracy: 0.3,
    colorFidelity: 0.25,
    typography: 0.2,
    componentStructure: 0.15,
    spacingAlignment: 0.1,
  });

  assert.deepEqual(DEFAULT_SCORING_CONFIG, {
    weights: {
      layoutAccuracy: 0.3,
      colorFidelity: 0.25,
      typography: 0.2,
      componentStructure: 0.15,
      spacingAlignment: 0.1,
    },
    hotspotCount: 5,
  });

  const sum =
    DEFAULT_SCORING_WEIGHTS.layoutAccuracy +
    DEFAULT_SCORING_WEIGHTS.colorFidelity +
    DEFAULT_SCORING_WEIGHTS.typography +
    DEFAULT_SCORING_WEIGHTS.componentStructure +
    DEFAULT_SCORING_WEIGHTS.spacingAlignment;
  assert.ok(
    Math.abs(sum - 1.0) < 0.001,
    `Weights should sum to 1.0, got ${String(sum)}`,
  );
});

// -----------------------------------------------------------------------------
// Group 1 — Anti-aliasing regression test
// Welle 3 DoD: "der Score darf kleine Anti-Aliasing-Unterschiede nicht
// übergewichten." A 1-pixel shift on text-like content (~0.5% deviation per
// region) must still score as "Excellent parity" (>= 90).
// -----------------------------------------------------------------------------

const buildNearIdenticalDiffResult = (): VisualDiffResult => ({
  diffImageBuffer: Buffer.alloc(0),
  similarityScore: 99.5,
  diffPixelCount: 50,
  totalPixels: 10000,
  width: 100,
  height: 100,
  regions: [
    {
      name: "header",
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      diffPixelCount: 10,
      totalPixels: 2000,
      deviationPercent: 0.5,
    },
    {
      name: "content-left",
      x: 0,
      y: 20,
      width: 33,
      height: 60,
      diffPixelCount: 10,
      totalPixels: 1980,
      deviationPercent: 0.5,
    },
    {
      name: "content-center",
      x: 33,
      y: 20,
      width: 33,
      height: 60,
      diffPixelCount: 10,
      totalPixels: 1980,
      deviationPercent: 0.5,
    },
    {
      name: "content-right",
      x: 66,
      y: 20,
      width: 34,
      height: 60,
      diffPixelCount: 10,
      totalPixels: 2040,
      deviationPercent: 0.5,
    },
    {
      name: "footer",
      x: 0,
      y: 80,
      width: 100,
      height: 20,
      diffPixelCount: 10,
      totalPixels: 2000,
      deviationPercent: 0.5,
    },
  ],
});

test("anti-aliasing regression: sub-pixel deviation scores >= 90", () => {
  const report = computeVisualQualityReport({
    diffResult: buildNearIdenticalDiffResult(),
    comparedAt: FIXED_TIMESTAMP,
  });

  assert.ok(
    report.overallScore >= 90,
    `Anti-aliasing-level deviations must score >= 90, got ${String(report.overallScore)}`,
  );
});

test("anti-aliasing regression: sub-pixel deviation interpretation starts with 'Excellent parity'", () => {
  const report = computeVisualQualityReport({
    diffResult: buildNearIdenticalDiffResult(),
    comparedAt: FIXED_TIMESTAMP,
  });

  assert.ok(
    report.interpretation.startsWith("Excellent parity"),
    `Expected interpretation to start with "Excellent parity", got "${report.interpretation}"`,
  );
});

// -----------------------------------------------------------------------------
// Group 2 — Single-pixel image edge cases
// -----------------------------------------------------------------------------

test("computeVisualQualityReport scores 100 for identical 1x1 images", () => {
  const pixel = createSolidPng(1, 1, 128, 64, 32);
  const diffResult = comparePngBuffers({
    referenceBuffer: pixel,
    testBuffer: pixel,
  });

  const report = computeVisualQualityReport({
    diffResult,
    comparedAt: FIXED_TIMESTAMP,
  });

  assert.equal(report.overallScore, 100);
  assert.equal(report.metadata.imageWidth, 1);
  assert.equal(report.metadata.imageHeight, 1);
  assert.equal(report.metadata.totalPixels, 1);
});

test("computeVisualQualityReport falls back to similarity score for 1x1 totally different image", () => {
  const totallyDifferentDiffResult: VisualDiffResult = {
    diffImageBuffer: Buffer.alloc(0),
    similarityScore: 0,
    diffPixelCount: 1,
    totalPixels: 1,
    width: 1,
    height: 1,
    regions: [],
  };

  const report = computeVisualQualityReport({
    diffResult: totallyDifferentDiffResult,
    comparedAt: FIXED_TIMESTAMP,
  });

  assert.equal(
    report.overallScore,
    0,
    `Empty-region fallback on a fully different 1x1 image must equal similarity (0), got ${String(report.overallScore)}`,
  );
  assert.equal(report.hotspots.length, 0);
  for (const dim of report.dimensions) {
    assert.equal(
      dim.score,
      0,
      `Dimension ${dim.name} should fall back to similarity (0)`,
    );
  }
});

// -----------------------------------------------------------------------------
// Group 3 — Hotspot tie-breaking stability
// Two regions with identical deviationPercent must be ranked in a stable
// (input-preserving) order across repeated calls.
// -----------------------------------------------------------------------------

test("computeVisualQualityReport produces stable hotspot ordering for tied deviations", () => {
  const tiedDiffResult: VisualDiffResult = {
    diffImageBuffer: Buffer.alloc(0),
    similarityScore: 70,
    diffPixelCount: 600,
    totalPixels: 2000,
    width: 100,
    height: 20,
    regions: [
      {
        name: "alpha",
        x: 0,
        y: 0,
        width: 50,
        height: 20,
        diffPixelCount: 300,
        totalPixels: 1000,
        deviationPercent: 30.0,
      },
      {
        name: "bravo",
        x: 50,
        y: 0,
        width: 50,
        height: 20,
        diffPixelCount: 300,
        totalPixels: 1000,
        deviationPercent: 30.0,
      },
    ],
  };

  let firstRegion: string | undefined;
  let secondRegion: string | undefined;

  for (let i = 0; i < 10; i++) {
    const report = computeVisualQualityReport({
      diffResult: tiedDiffResult,
      comparedAt: FIXED_TIMESTAMP,
    });
    assert.equal(report.hotspots.length, 2, "Expected exactly two hotspots");
    const top = report.hotspots[0];
    const second = report.hotspots[1];
    assert.ok(top !== undefined);
    assert.ok(second !== undefined);
    if (i === 0) {
      firstRegion = top.region;
      secondRegion = second.region;
    } else {
      assert.equal(
        top.region,
        firstRegion,
        `Top hotspot region drifted between runs: ${String(firstRegion)} -> ${top.region}`,
      );
      assert.equal(
        second.region,
        secondRegion,
        `Second hotspot region drifted between runs: ${String(secondRegion)} -> ${second.region}`,
      );
    }
  }

  assert.equal(
    firstRegion,
    "alpha",
    "First-in ties should come out first (stable sort)",
  );
  assert.equal(secondRegion, "bravo");
});

// -----------------------------------------------------------------------------
// Group 4 — Severity classifier monotonicity + boundary behavior
// Uses a shared deviation table [0, 1, 4, 4.9, 5, 10, 19.9, 20, 35, 49.9, 50,
// 75, 100] with one region per deviation and hotspotCount: 13.
// -----------------------------------------------------------------------------

const SEVERITY_DEVIATIONS = [
  0, 1, 4, 4.9, 5, 10, 19.9, 20, 35, 49.9, 50, 75, 100,
] as const;

const buildSeverityDiffResult = (): VisualDiffResult => {
  const regions: VisualDiffResult["regions"] = SEVERITY_DEVIATIONS.map(
    (deviation, index) => ({
      name: `region-${String(index).padStart(2, "0")}`,
      x: 0,
      y: index,
      width: 10,
      height: 1,
      diffPixelCount: Math.round((deviation / 100) * 10),
      totalPixels: 10,
      deviationPercent: deviation,
    }),
  );

  return {
    diffImageBuffer: Buffer.alloc(0),
    similarityScore: 50,
    diffPixelCount: 500,
    totalPixels: 1000,
    width: 10,
    height: SEVERITY_DEVIATIONS.length,
    regions,
  };
};

const buildSeverityByDeviation = (): Map<number, string> => {
  const report = computeVisualQualityReport({
    diffResult: buildSeverityDiffResult(),
    config: { hotspotCount: 13 },
    comparedAt: FIXED_TIMESTAMP,
  });
  const map = new Map<number, string>();
  for (const hotspot of report.hotspots) {
    map.set(hotspot.deviationPercent, hotspot.severity);
  }
  return map;
};

test("computeVisualQualityReport excludes zero-deviation regions from hotspots", () => {
  const report = computeVisualQualityReport({
    diffResult: buildSeverityDiffResult(),
    config: { hotspotCount: 13 },
    comparedAt: FIXED_TIMESTAMP,
  });

  // 13 input regions, 1 with deviation 0 → should be filtered out.
  assert.equal(
    report.hotspots.length,
    12,
    `Zero-deviation regions must be excluded; got ${String(report.hotspots.length)} hotspots`,
  );
  for (const hotspot of report.hotspots) {
    assert.ok(
      hotspot.deviationPercent > 0,
      `Hotspot ${hotspot.region} has non-positive deviation ${String(hotspot.deviationPercent)}`,
    );
  }
});

test("computeVisualQualityReport severities are monotonically non-increasing when ordered by deviation desc", () => {
  const report = computeVisualQualityReport({
    diffResult: buildSeverityDiffResult(),
    config: { hotspotCount: 13 },
    comparedAt: FIXED_TIMESTAMP,
  });
  const severityRank: Record<string, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  };

  for (let i = 1; i < report.hotspots.length; i++) {
    const prev = report.hotspots[i - 1];
    const curr = report.hotspots[i];
    assert.ok(prev !== undefined);
    assert.ok(curr !== undefined);
    const prevRank = severityRank[prev.severity];
    const currRank = severityRank[curr.severity];
    assert.ok(prevRank !== undefined);
    assert.ok(currRank !== undefined);
    assert.ok(
      prevRank >= currRank,
      `Severity regressed: ${prev.severity}(${String(prev.deviationPercent)}) -> ${curr.severity}(${String(curr.deviationPercent)})`,
    );
    assert.ok(
      prev.deviationPercent >= curr.deviationPercent,
      `Deviation ordering regressed: ${String(prev.deviationPercent)} < ${String(curr.deviationPercent)}`,
    );
  }
});

test("classifySeverity: 4.9% is low and 5% is medium (lower boundary)", () => {
  const severities = buildSeverityByDeviation();
  assert.equal(severities.get(4.9), "low", "4.9% must be low");
  assert.equal(
    severities.get(5),
    "medium",
    "5% must be medium (inclusive boundary)",
  );
});

test("classifySeverity: 19.9% is medium and 20% is high (middle boundary)", () => {
  const severities = buildSeverityByDeviation();
  assert.equal(severities.get(19.9), "medium", "19.9% must be medium");
  assert.equal(
    severities.get(20),
    "high",
    "20% must be high (inclusive boundary)",
  );
});

test("classifySeverity: 49.9% is high and 50% is critical (upper boundary)", () => {
  const severities = buildSeverityByDeviation();
  assert.equal(severities.get(49.9), "high", "49.9% must be high");
  assert.equal(
    severities.get(50),
    "critical",
    "50% must be critical (inclusive boundary)",
  );
});

test("classifySeverity: interior points 1%, 100% match expected severity", () => {
  const severities = buildSeverityByDeviation();
  assert.equal(severities.get(1), "low", "1% must be low");
  assert.equal(severities.get(100), "critical", "100% must be critical");
});

// -----------------------------------------------------------------------------
// Group 5 — Weight-invariant property test
// Identical images must always score 100 regardless of weight distribution.
// Randomized with a seeded LCG for determinism.
// -----------------------------------------------------------------------------

const buildIdenticalDiffResult = (): VisualDiffResult => ({
  diffImageBuffer: Buffer.alloc(0),
  similarityScore: 100,
  diffPixelCount: 0,
  totalPixels: 10000,
  width: 100,
  height: 100,
  regions: [
    {
      name: "header",
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      diffPixelCount: 0,
      totalPixels: 2000,
      deviationPercent: 0,
    },
    {
      name: "content-left",
      x: 0,
      y: 20,
      width: 33,
      height: 60,
      diffPixelCount: 0,
      totalPixels: 1980,
      deviationPercent: 0,
    },
    {
      name: "content-center",
      x: 33,
      y: 20,
      width: 33,
      height: 60,
      diffPixelCount: 0,
      totalPixels: 1980,
      deviationPercent: 0,
    },
    {
      name: "content-right",
      x: 66,
      y: 20,
      width: 34,
      height: 60,
      diffPixelCount: 0,
      totalPixels: 2040,
      deviationPercent: 0,
    },
    {
      name: "footer",
      x: 0,
      y: 80,
      width: 100,
      height: 20,
      diffPixelCount: 0,
      totalPixels: 2000,
      deviationPercent: 0,
    },
  ],
});

const scoreWithWeights = (weightsArray: readonly number[]): number => {
  const [layout, color, typography, component, spacing] = weightsArray;
  assert.ok(layout !== undefined);
  assert.ok(color !== undefined);
  assert.ok(typography !== undefined);
  assert.ok(component !== undefined);
  assert.ok(spacing !== undefined);

  const report = computeVisualQualityReport({
    diffResult: buildIdenticalDiffResult(),
    config: {
      weights: {
        layoutAccuracy: layout,
        colorFidelity: color,
        typography,
        componentStructure: component,
        spacingAlignment: spacing,
      },
    },
    comparedAt: FIXED_TIMESTAMP,
  });
  return report.overallScore;
};

test("weight invariance: default weight distribution scores identical images at 100", () => {
  const score = scoreWithWeights([
    DEFAULT_SCORING_WEIGHTS.layoutAccuracy,
    DEFAULT_SCORING_WEIGHTS.colorFidelity,
    DEFAULT_SCORING_WEIGHTS.typography,
    DEFAULT_SCORING_WEIGHTS.componentStructure,
    DEFAULT_SCORING_WEIGHTS.spacingAlignment,
  ]);
  assert.equal(score, 100);
});

test("weight invariance: all-layout (1,0,0,0,0) scores identical images at 100", () => {
  assert.equal(scoreWithWeights([1, 0, 0, 0, 0]), 100);
});

test("weight invariance: all-color (0,1,0,0,0) scores identical images at 100", () => {
  assert.equal(scoreWithWeights([0, 1, 0, 0, 0]), 100);
});

test("weight invariance: 30 seeded random normalized weight distributions all score 100", () => {
  let seed = 12345;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const normalize = (values: readonly number[]): number[] => {
    const sum = values.reduce((acc, v) => acc + v, 0);
    if (sum === 0) {
      // Degenerate case — avoid divide-by-zero by returning a uniform split.
      return values.map(() => 1 / values.length);
    }
    return values.map((v) => v / sum);
  };

  for (let i = 0; i < 30; i++) {
    const raw = [next(), next(), next(), next(), next()];
    const normalized = normalize(raw);

    // Sanity: normalized weights sum to ~1 (within resolver tolerance).
    const sum = normalized.reduce((acc, v) => acc + v, 0);
    assert.ok(
      Math.abs(sum - 1.0) < 0.001,
      `[random-${String(i)}] normalized weights must sum to 1.0, got ${String(sum)}`,
    );

    const score = scoreWithWeights(normalized);
    assert.equal(
      score,
      100,
      `[random-${String(i)}] Identical images must score 100 for normalized weights [${normalized.map(String).join(", ")}], got ${String(score)}`,
    );
  }
});

// -----------------------------------------------------------------------------
// Group 6a — Category classification kill test
// Exercises every branch in classifyCategory: header/footer → spacing,
// content-left/center/right → layout, anything else → color.
// -----------------------------------------------------------------------------

test("hotspot category reflects region name: header/footer -> spacing, content-* -> layout, other -> color", () => {
  const categoryDiffResult: VisualDiffResult = {
    diffImageBuffer: Buffer.alloc(0),
    similarityScore: 60,
    diffPixelCount: 400,
    totalPixels: 1000,
    width: 100,
    height: 100,
    regions: [
      {
        name: "header",
        x: 0,
        y: 0,
        width: 100,
        height: 10,
        diffPixelCount: 70,
        totalPixels: 1000,
        deviationPercent: 70.0,
      },
      {
        name: "footer",
        x: 0,
        y: 90,
        width: 100,
        height: 10,
        diffPixelCount: 60,
        totalPixels: 1000,
        deviationPercent: 60.0,
      },
      {
        name: "content-left",
        x: 0,
        y: 10,
        width: 33,
        height: 80,
        diffPixelCount: 50,
        totalPixels: 1000,
        deviationPercent: 50.0,
      },
      {
        name: "content-center",
        x: 33,
        y: 10,
        width: 33,
        height: 80,
        diffPixelCount: 40,
        totalPixels: 1000,
        deviationPercent: 40.0,
      },
      {
        name: "content-right",
        x: 66,
        y: 10,
        width: 34,
        height: 80,
        diffPixelCount: 30,
        totalPixels: 1000,
        deviationPercent: 30.0,
      },
      {
        name: "sidebar",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        diffPixelCount: 20,
        totalPixels: 1000,
        deviationPercent: 20.0,
      },
    ],
  };

  const report = computeVisualQualityReport({
    diffResult: categoryDiffResult,
    config: { hotspotCount: 6 },
    comparedAt: FIXED_TIMESTAMP,
  });

  const categoryByName = new Map<string, string>();
  for (const hotspot of report.hotspots) {
    categoryByName.set(hotspot.region, hotspot.category);
  }

  assert.equal(categoryByName.get("header"), "spacing", "header -> spacing");
  assert.equal(categoryByName.get("footer"), "spacing", "footer -> spacing");
  assert.equal(
    categoryByName.get("content-left"),
    "layout",
    "content-left -> layout",
  );
  assert.equal(
    categoryByName.get("content-center"),
    "layout",
    "content-center -> layout",
  );
  assert.equal(
    categoryByName.get("content-right"),
    "layout",
    "content-right -> layout",
  );
  assert.equal(
    categoryByName.get("sidebar"),
    "color",
    "unknown region name -> color (fallback)",
  );
});

// -----------------------------------------------------------------------------
// Group 6 — Determinism: 5 identical calls produce byte-identical JSON reports
// -----------------------------------------------------------------------------

test("computeVisualQualityReport produces byte-identical JSON across 5 repeated calls on identical input", () => {
  const fixedDiffResult: VisualDiffResult = {
    diffImageBuffer: Buffer.alloc(0),
    similarityScore: 42.5,
    diffPixelCount: 575,
    totalPixels: 1000,
    width: 40,
    height: 25,
    regions: [
      {
        name: "header",
        x: 0,
        y: 0,
        width: 40,
        height: 5,
        diffPixelCount: 50,
        totalPixels: 200,
        deviationPercent: 25.0,
      },
      {
        name: "content-left",
        x: 0,
        y: 5,
        width: 13,
        height: 15,
        diffPixelCount: 80,
        totalPixels: 195,
        deviationPercent: 41.03,
      },
      {
        name: "content-center",
        x: 13,
        y: 5,
        width: 13,
        height: 15,
        diffPixelCount: 90,
        totalPixels: 195,
        deviationPercent: 46.15,
      },
      {
        name: "content-right",
        x: 26,
        y: 5,
        width: 14,
        height: 15,
        diffPixelCount: 100,
        totalPixels: 210,
        deviationPercent: 47.62,
      },
      {
        name: "footer",
        x: 0,
        y: 20,
        width: 40,
        height: 5,
        diffPixelCount: 60,
        totalPixels: 200,
        deviationPercent: 30.0,
      },
    ],
  };

  const snapshots: string[] = [];
  for (let i = 0; i < 5; i++) {
    const report = computeVisualQualityReport({
      diffResult: fixedDiffResult,
      comparedAt: FIXED_TIMESTAMP,
      diffImagePath: "/tmp/visual-audit/fixed.png",
      viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
    });
    snapshots.push(JSON.stringify(report));
  }

  const first = snapshots[0];
  assert.ok(first !== undefined);
  for (let i = 1; i < snapshots.length; i++) {
    assert.equal(
      snapshots[i],
      first,
      `Run ${String(i)} produced a different JSON snapshot than run 0`,
    );
  }
});
