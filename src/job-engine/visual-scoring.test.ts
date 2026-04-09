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
  assert.equal(report.interpretation, "Excellent parity — minor sub-pixel or anti-aliasing differences");
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

  assert.ok(report.overallScore < 20, `Expected overall < 20, got ${String(report.overallScore)}`);
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
    layoutAccuracy: 0.50,
    colorFidelity: 0.10,
    typography: 0.10,
    componentStructure: 0.20,
    spacingAlignment: 0.10,
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
            layoutAccuracy: 0.50,
            colorFidelity: 0.50,
            typography: 0.50,
            componentStructure: 0.50,
            spacingAlignment: 0.50,
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
        assert.match(error.message, /hotspotCount must be a finite integer greater than or equal to 0/i);
        return true;
      },
    );
  }
});

test("DEFAULT_SCORING_WEIGHTS and DEFAULT_SCORING_CONFIG have expected values", () => {
  assert.deepEqual(DEFAULT_SCORING_WEIGHTS, {
    layoutAccuracy: 0.30,
    colorFidelity: 0.25,
    typography: 0.20,
    componentStructure: 0.15,
    spacingAlignment: 0.10,
  });

  assert.deepEqual(DEFAULT_SCORING_CONFIG, {
    weights: {
      layoutAccuracy: 0.30,
      colorFidelity: 0.25,
      typography: 0.20,
      componentStructure: 0.15,
      spacingAlignment: 0.10,
    },
    hotspotCount: 5,
  });

  const sum =
    DEFAULT_SCORING_WEIGHTS.layoutAccuracy +
    DEFAULT_SCORING_WEIGHTS.colorFidelity +
    DEFAULT_SCORING_WEIGHTS.typography +
    DEFAULT_SCORING_WEIGHTS.componentStructure +
    DEFAULT_SCORING_WEIGHTS.spacingAlignment;
  assert.ok(Math.abs(sum - 1.0) < 0.001, `Weights should sum to 1.0, got ${String(sum)}`);
});
