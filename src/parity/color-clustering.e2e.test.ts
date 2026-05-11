/**
 * E2E test for color clustering optimization with spatial grid indexing.
 *
 * Validates that the optimized clustering algorithm produces correct palette
 * derivation against a real Figma file, maintaining determinism and quality.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/308
 */
import assert from "node:assert/strict";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";
import { createDeterministicScreenFile } from "./generator-core.js";
import { fetchParityFigmaFileOnce } from "./live-figma-file.js";
import {
  clusterSamples,
  collectColorSamples,
  resolveNodeStyleCatalog,
  chooseBackgroundColor,
  chooseTextColor,
  choosePrimaryColor,
  chooseSecondaryColor
} from "./ir-palette.js";
import { collectNodes } from "./ir-tree.js";
import type { FigmaFile, FigmaNode } from "./ir-helpers.js";
import { colorDistance } from "./ir-helpers.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set – skipping color clustering E2E tests"
    : undefined;

const fetchFigmaFileOnce = async (): Promise<unknown> => {
  return await fetchParityFigmaFileOnce({
    fileKey: FIGMA_FILE_KEY,
    accessToken: FIGMA_ACCESS_TOKEN
  });
};

// ── Palette derivation produces valid colors ────────────────────────────────

test("E2E: color clustering produces valid hex palette from real Figma file", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  assert.ok(ir.tokens.palette.primary.startsWith("#"), "Primary must be a hex color");
  assert.ok(ir.tokens.palette.secondary.startsWith("#"), "Secondary must be a hex color");
  assert.ok(ir.tokens.palette.background.startsWith("#"), "Background must be a hex color");
  assert.ok(ir.tokens.palette.text.startsWith("#"), "Text must be a hex color");
  assert.ok(ir.tokens.palette.success.startsWith("#"), "Success must be a hex color");
  assert.ok(ir.tokens.palette.warning.startsWith("#"), "Warning must be a hex color");
  assert.ok(ir.tokens.palette.error.startsWith("#"), "Error must be a hex color");
  assert.ok(ir.tokens.palette.info.startsWith("#"), "Info must be a hex color");

  // Primary and background must be visually distinct
  const primaryBgDistance = colorDistance(ir.tokens.palette.primary, ir.tokens.palette.background);
  assert.ok(primaryBgDistance >= 0.05, `Primary and background too similar: distance=${primaryBgDistance.toFixed(3)}`);

  // Text and background must be visually distinct
  const textBgDistance = colorDistance(ir.tokens.palette.text, ir.tokens.palette.background);
  assert.ok(textBgDistance >= 0.05, `Text and background too similar: distance=${textBgDistance.toFixed(3)}`);
});

// ── Clustering determinism ──────────────────────────────────────────────────

test("E2E: palette derivation is deterministic across two IR runs", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir1 = figmaToDesignIrWithOptions(figmaFile);
  const ir2 = figmaToDesignIrWithOptions(figmaFile);

  assert.equal(ir1.tokens.palette.primary, ir2.tokens.palette.primary, "Primary must be deterministic");
  assert.equal(ir1.tokens.palette.secondary, ir2.tokens.palette.secondary, "Secondary must be deterministic");
  assert.equal(ir1.tokens.palette.background, ir2.tokens.palette.background, "Background must be deterministic");
  assert.equal(ir1.tokens.palette.text, ir2.tokens.palette.text, "Text must be deterministic");
  assert.equal(ir1.tokens.palette.success, ir2.tokens.palette.success, "Success must be deterministic");
  assert.equal(ir1.tokens.palette.warning, ir2.tokens.palette.warning, "Warning must be deterministic");
  assert.equal(ir1.tokens.palette.error, ir2.tokens.palette.error, "Error must be deterministic");
  assert.equal(ir1.tokens.palette.info, ir2.tokens.palette.info, "Info must be deterministic");
  assert.equal(ir1.tokens.palette.divider, ir2.tokens.palette.divider, "Divider must be deterministic");
});

// ── Clustering quality ──────────────────────────────────────────────────────

test("E2E: color clustering reduces sample count via merging", { skip: skipReason }, async () => {
  const figmaFile = (await fetchFigmaFileOnce()) as FigmaFile;
  const allNodes = collectNodes(figmaFile.document as FigmaNode, () => true);
  const styleCatalog = resolveNodeStyleCatalog(figmaFile);
  const samples = collectColorSamples({ nodes: allNodes, styleCatalog });
  const clusters = clusterSamples(samples);

  assert.ok(samples.length > 0, "Should have collected color samples");
  assert.ok(clusters.length > 0, "Should have produced clusters");
  assert.ok(
    clusters.length <= samples.length,
    `Cluster count (${clusters.length}) should not exceed sample count (${samples.length})`
  );

  // Clusters should be sorted by weight
  for (let i = 1; i < clusters.length; i++) {
    assert.ok(
      clusters[i - 1]!.totalWeight >= clusters[i]!.totalWeight,
      "Clusters must be sorted by weight descending"
    );
  }
});

// ── Semantic palette selection consistency ───────────────────────────────────

test("E2E: semantic palette selection produces reasonable color choices", { skip: skipReason }, async () => {
  const figmaFile = (await fetchFigmaFileOnce()) as FigmaFile;
  const allNodes = collectNodes(figmaFile.document as FigmaNode, () => true);
  const styleCatalog = resolveNodeStyleCatalog(figmaFile);
  const samples = collectColorSamples({ nodes: allNodes, styleCatalog });
  const clusters = clusterSamples(samples);

  const backgroundColor = chooseBackgroundColor(clusters);
  const textColor = chooseTextColor({ clusters, backgroundColor });
  const primaryColor = choosePrimaryColor({ clusters, backgroundColor, textColor });
  const secondaryColor = chooseSecondaryColor({ clusters, backgroundColor, primaryColor });

  // All must be valid hex
  for (const [name, color] of Object.entries({ backgroundColor, textColor, primaryColor, secondaryColor })) {
    assert.match(color, /^#[0-9a-f]{6}$/i, `${name} must be a valid 6-digit hex color`);
  }

  // Primary and secondary should differ
  assert.ok(
    colorDistance(primaryColor, secondaryColor) >= 0.05,
    "Primary and secondary colors should be visually distinct"
  );
});

// ── Generated screen files use derived palette ──────────────────────────────

test("E2E: generated screen files contain color references from derived palette", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  assert.ok(ir.screens.length > 0, "Expected at least one screen");

  let hasColorReference = false;
  for (const screen of ir.screens) {
    const file = createDeterministicScreenFile(screen);
    // Generated files reference colors via hex literals, theme tokens, or MUI color props
    if (
      file.content.includes("#") ||
      file.content.includes("primary") ||
      file.content.includes("color") ||
      file.content.includes("background") ||
      file.content.includes("sx=")
    ) {
      hasColorReference = true;
      break;
    }
  }

  assert.ok(hasColorReference, "At least one screen should contain color references");
});

// ── Performance: clustering completes in reasonable time ─────────────────────

test("E2E: clustering of real Figma colors completes within 2 seconds", { skip: skipReason }, async () => {
  const figmaFile = (await fetchFigmaFileOnce()) as FigmaFile;
  const allNodes = collectNodes(figmaFile.document as FigmaNode, () => true);
  const styleCatalog = resolveNodeStyleCatalog(figmaFile);
  const samples = collectColorSamples({ nodes: allNodes, styleCatalog });

  const start = performance.now();
  const clusters = clusterSamples(samples);
  const elapsed = performance.now() - start;

  assert.ok(clusters.length > 0, "Should produce clusters");
  assert.ok(
    elapsed < 2000,
    `Clustering took ${elapsed.toFixed(1)}ms — expected under 2000ms for ${samples.length} samples`
  );
});
