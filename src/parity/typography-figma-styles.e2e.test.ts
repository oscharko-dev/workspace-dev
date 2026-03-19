import assert from "node:assert/strict";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";
import { DESIGN_TYPOGRAPHY_VARIANTS } from "./typography-tokens.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set – skipping real Figma E2E tests"
    : undefined;

let cachedFigmaFile: unknown;

const fetchFigmaFileOnce = async (): Promise<unknown> => {
  if (cachedFigmaFile) {
    return cachedFigmaFile;
  }
  const response = await fetch(`https://api.figma.com/v1/files/${FIGMA_FILE_KEY}?geometry=paths`, {
    headers: {
      "X-Figma-Token": FIGMA_ACCESS_TOKEN
    }
  });
  assert.equal(response.ok, true, `Figma API responded with status ${response.status}`);
  cachedFigmaFile = await response.json();
  return cachedFigmaFile;
};

test("E2E: typography scale derived from real Figma file has all 13 variants", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();

  const ir = figmaToDesignIrWithOptions(figmaFile);

  assert.equal(typeof ir.tokens, "object");
  assert.equal(typeof ir.tokens.typography, "object");

  const typography = ir.tokens.typography;
  for (const variant of DESIGN_TYPOGRAPHY_VARIANTS) {
    assert.equal(typeof typography[variant], "object", `Missing typography variant: ${variant}`);
    assert.equal(typeof typography[variant].fontSizePx, "number", `${variant}.fontSizePx is not a number`);
    assert.equal(typography[variant].fontSizePx >= 10, true, `${variant}.fontSizePx (${typography[variant].fontSizePx}) is below minimum 10`);
    assert.equal(typeof typography[variant].fontWeight, "number", `${variant}.fontWeight is not a number`);
    assert.equal(typography[variant].fontWeight >= 100, true, `${variant}.fontWeight below 100`);
    assert.equal(typography[variant].fontWeight <= 900, true, `${variant}.fontWeight above 900`);
    assert.equal(typeof typography[variant].lineHeightPx, "number", `${variant}.lineHeightPx is not a number`);
    assert.equal(
      typography[variant].lineHeightPx >= typography[variant].fontSizePx,
      true,
      `${variant}.lineHeightPx (${typography[variant].lineHeightPx}) is less than fontSizePx (${typography[variant].fontSizePx})`
    );
  }
});

test("E2E: typography scale has monotonically descending font sizes", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();

  const ir = figmaToDesignIrWithOptions(figmaFile);
  const typography = ir.tokens.typography;
  let previousSize = Number.POSITIVE_INFINITY;
  for (const variant of DESIGN_TYPOGRAPHY_VARIANTS) {
    const size = typography[variant].fontSizePx;
    assert.equal(
      size <= previousSize,
      true,
      `Font size for ${variant} (${size}) exceeds previous variant (${previousSize}) – scale must be monotonically descending`
    );
    previousSize = size;
  }
});

test("E2E: typography button and overline have correct special properties", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();

  const ir = figmaToDesignIrWithOptions(figmaFile);

  assert.equal(ir.tokens.typography.button.textTransform, "none");
  assert.equal(typeof ir.tokens.typography.overline.letterSpacingEm, "number");
});

test("E2E: typography derivation is deterministic across two runs", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();

  const ir1 = figmaToDesignIrWithOptions(figmaFile);
  const ir2 = figmaToDesignIrWithOptions(figmaFile);

  for (const variant of DESIGN_TYPOGRAPHY_VARIANTS) {
    assert.deepStrictEqual(
      ir1.tokens.typography[variant],
      ir2.tokens.typography[variant],
      `Typography variant ${variant} differs between two runs – determinism violated`
    );
  }
});

test("E2E: heading sizes exceed body sizes in derived typography", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();

  const ir = figmaToDesignIrWithOptions(figmaFile);
  const typography = ir.tokens.typography;
  assert.equal(
    typography.h1.fontSizePx >= typography.body1.fontSizePx,
    true,
    `h1 (${typography.h1.fontSizePx}) should be >= body1 (${typography.body1.fontSizePx})`
  );
  assert.equal(
    ir.tokens.headingSize >= ir.tokens.bodySize,
    true,
    `headingSize (${ir.tokens.headingSize}) should be >= bodySize (${ir.tokens.bodySize})`
  );
});
