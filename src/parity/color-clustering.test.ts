/**
 * Unit tests for optimized color clustering algorithm.
 *
 * Validates that the spatial-grid-backed clustering produces correct results,
 * handles edge cases, and that parseHex caching behaves correctly.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/308
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseHex,
  parseHexCached,
  clearParseHexCache,
  colorDistance,
  colorDistanceCached,
  createSpatialColorGrid
} from "./ir-helpers.js";
import type { ColorSample } from "./ir-helpers.js";
import { emptyStyleSignals } from "./ir-helpers.js";
import {
  clusterSamples,
  COLOR_CLUSTER_MERGE_THRESHOLD,
  NEAR_DUPLICATE_DISTANCE
} from "./ir-palette.js";

const makeSample = (color: string, weight = 1, context: ColorSample["context"] = "decorative"): ColorSample => ({
  color,
  weight,
  context,
  styleSignals: emptyStyleSignals()
});

// ── parseHexCached ──────────────────────────────────────────────────────────

test("parseHexCached returns same result as parseHex", () => {
  clearParseHexCache();
  const colors = ["#ff0000", "#00ff00", "#0000ff", "#1f2937", "#d4001a", "#ffffff", "#000000"];
  for (const color of colors) {
    const expected = parseHex(color);
    const cached = parseHexCached(color);
    assert.deepEqual(cached, expected, `Mismatch for ${color}`);
  }
});

test("parseHexCached returns same object reference on repeated calls", () => {
  clearParseHexCache();
  const first = parseHexCached("#abcdef");
  const second = parseHexCached("#abcdef");
  assert.equal(first, second, "Cache should return the same object reference");
});

test("clearParseHexCache clears the cache", () => {
  const first = parseHexCached("#123456");
  clearParseHexCache();
  const second = parseHexCached("#123456");
  assert.notEqual(first, second, "After clearing, a new object should be created");
  assert.deepEqual(first, second, "Values should still be equal");
});

// ── colorDistanceCached ─────────────────────────────────────────────────────

test("colorDistanceCached matches colorDistance", () => {
  clearParseHexCache();
  const pairs: Array<[string, string]> = [
    ["#ff0000", "#00ff00"],
    ["#000000", "#ffffff"],
    ["#1f2937", "#d4001a"],
    ["#abcdef", "#abcdef"]
  ];
  for (const [a, b] of pairs) {
    const expected = colorDistance(a, b);
    const cached = colorDistanceCached(a, b);
    assert.ok(Math.abs(expected - cached) < 1e-10, `Distance mismatch for ${a} vs ${b}`);
  }
});

// ── SpatialColorGrid ────────────────────────────────────────────────────────

test("SpatialColorGrid: insert and findNearest for exact match", () => {
  const grid = createSpatialColorGrid<string>(0.12);
  grid.insert("red", "#ff0000");
  const found = grid.findNearest("#ff0000", 0.12);
  assert.equal(found, "red");
});

test("SpatialColorGrid: findNearest returns undefined when no match within distance", () => {
  const grid = createSpatialColorGrid<string>(0.12);
  grid.insert("red", "#ff0000");
  const found = grid.findNearest("#0000ff", 0.12);
  assert.equal(found, undefined, "Red and blue are far apart");
});

test("SpatialColorGrid: findNearest returns closest match among multiple entries", () => {
  const grid = createSpatialColorGrid<string>(0.15);
  grid.insert("dark-red", "#cc0000");
  grid.insert("green", "#00ff00");
  const found = grid.findNearest("#dd0000", 0.15);
  assert.equal(found, "dark-red", "Should find dark-red as nearest");
});

test("SpatialColorGrid: handles colors near cell boundaries", () => {
  const grid = createSpatialColorGrid<string>(0.12);
  // Two colors that are close but in different grid cells
  grid.insert("a", "#1e1e1e");
  const found = grid.findNearest("#202020", 0.12);
  assert.equal(found, "a", "Should find across cell boundaries via neighbor search");
});

// ── clusterSamples ──────────────────────────────────────────────────────────

test("clusterSamples: empty input returns empty output", () => {
  const result = clusterSamples([]);
  assert.equal(result.length, 0);
});

test("clusterSamples: single sample returns single cluster", () => {
  const result = clusterSamples([makeSample("#ff0000", 10)]);
  assert.equal(result.length, 1);
  assert.ok(result[0]!.totalWeight > 0);
});

test("clusterSamples: identical colors merge into one cluster", () => {
  const samples = [
    makeSample("#ff0000", 5),
    makeSample("#ff0000", 3),
    makeSample("#ff0000", 2)
  ];
  const result = clusterSamples(samples);
  assert.equal(result.length, 1);
  assert.ok(result[0]!.totalWeight >= 10, "Weight should be accumulated");
});

test("clusterSamples: distinct colors produce separate clusters", () => {
  const samples = [
    makeSample("#ff0000", 5),
    makeSample("#00ff00", 5),
    makeSample("#0000ff", 5)
  ];
  const result = clusterSamples(samples);
  assert.ok(result.length >= 3, `Expected at least 3 clusters, got ${result.length}`);
});

test("clusterSamples: near-duplicate colors are pre-filtered and merged", () => {
  // Colors within NEAR_DUPLICATE_DISTANCE=5 should be deduped before clustering
  const samples = [
    makeSample("#ff0000", 5),
    makeSample("#ff0001", 3),
    makeSample("#ff0002", 2)
  ];
  const result = clusterSamples(samples);
  assert.equal(result.length, 1, "Near-duplicates should merge into one cluster");
});

test("clusterSamples: similar colors within merge threshold are merged", () => {
  // These quantize to different buckets but are within COLOR_CLUSTER_MERGE_THRESHOLD
  const samples = [
    makeSample("#a01010", 5),
    makeSample("#a21212", 3)
  ];
  const result = clusterSamples(samples);
  assert.equal(result.length, 1, "Colors within merge threshold should merge");
});

test("clusterSamples: output is sorted by weight descending", () => {
  const samples = [
    makeSample("#ff0000", 1),
    makeSample("#00ff00", 10),
    makeSample("#0000ff", 5)
  ];
  const result = clusterSamples(samples);
  for (let i = 1; i < result.length; i++) {
    assert.ok(
      result[i - 1]!.totalWeight >= result[i]!.totalWeight,
      "Clusters should be sorted by weight descending"
    );
  }
});

test("clusterSamples: deterministic output across multiple runs", () => {
  const samples = Array.from({ length: 50 }, (_, i) => {
    const r = ((i * 37) % 256).toString(16).padStart(2, "0");
    const g = ((i * 73) % 256).toString(16).padStart(2, "0");
    const b = ((i * 113) % 256).toString(16).padStart(2, "0");
    return makeSample(`#${r}${g}${b}`, i + 1, i % 2 === 0 ? "button" : "surface");
  });

  const run1 = clusterSamples(samples);
  const run2 = clusterSamples(samples);

  assert.equal(run1.length, run2.length, "Cluster count must be deterministic");
  for (let i = 0; i < run1.length; i++) {
    assert.equal(run1[i]!.color, run2[i]!.color, `Cluster ${i} color must be deterministic`);
    assert.equal(run1[i]!.totalWeight, run2[i]!.totalWeight, `Cluster ${i} weight must be deterministic`);
  }
});

test("clusterSamples: large input does not degrade correctness", () => {
  // Generate 500 samples to exercise the spatial grid at scale
  const samples: ColorSample[] = [];
  for (let i = 0; i < 500; i++) {
    const r = (i % 256).toString(16).padStart(2, "0");
    const g = ((i * 3) % 256).toString(16).padStart(2, "0");
    const b = ((i * 7) % 256).toString(16).padStart(2, "0");
    samples.push(makeSample(`#${r}${g}${b}`, 1 + (i % 10)));
  }

  const result = clusterSamples(samples);
  assert.ok(result.length > 0, "Should produce clusters");
  assert.ok(result.length < samples.length, "Should merge some clusters");

  // Verify sorted order
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i - 1]!.totalWeight >= result[i]!.totalWeight);
  }
});

test("clusterSamples: context weights are preserved through merging", () => {
  // Use colors that quantize to the same COLOR_CLUSTER_STEP bucket
  // but are distinct enough to avoid NEAR_DUPLICATE_DISTANCE dedup
  const samples = [
    makeSample("#f00000", 5, "button"),
    makeSample("#f00a0a", 3, "heading")
  ];
  const result = clusterSamples(samples);
  assert.equal(result.length, 1);
  assert.ok(result[0]!.contexts.button > 0, "Button context weight should be preserved");
  assert.ok(result[0]!.contexts.heading > 0, "Heading context weight should be preserved");
});
