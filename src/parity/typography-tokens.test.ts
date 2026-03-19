import assert from "node:assert/strict";
import test from "node:test";
import {
  matchFigmaStyleToVariant,
  buildTypographyScaleFromFigmaStyles,
  buildTypographyScaleFromAliases,
  completeTypographyScale
} from "./typography-tokens.js";
import type { FigmaTextStyleEntry } from "./typography-tokens.js";

test("matchFigmaStyleToVariant matches heading patterns", () => {
  assert.equal(matchFigmaStyleToVariant("Heading/H1"), "h1");
  assert.equal(matchFigmaStyleToVariant("heading/h2"), "h2");
  assert.equal(matchFigmaStyleToVariant("Heading 3"), "h3");
  assert.equal(matchFigmaStyleToVariant("heading-4"), "h4");
  assert.equal(matchFigmaStyleToVariant("H5 Title"), "h5");
  assert.equal(matchFigmaStyleToVariant("Typography/H6"), "h6");
});

test("matchFigmaStyleToVariant matches body patterns", () => {
  assert.equal(matchFigmaStyleToVariant("Body/Regular"), "body1");
  assert.equal(matchFigmaStyleToVariant("Body/Default"), "body1");
  assert.equal(matchFigmaStyleToVariant("Body 1"), "body1");
  assert.equal(matchFigmaStyleToVariant("body-medium"), "body1");
  assert.equal(matchFigmaStyleToVariant("Body/Small"), "body2");
  assert.equal(matchFigmaStyleToVariant("body 2"), "body2");
  assert.equal(matchFigmaStyleToVariant("body-secondary"), "body2");
});

test("matchFigmaStyleToVariant matches subtitle patterns", () => {
  assert.equal(matchFigmaStyleToVariant("Subtitle 1"), "subtitle1");
  assert.equal(matchFigmaStyleToVariant("subtitle/2"), "subtitle2");
  assert.equal(matchFigmaStyleToVariant("Subtitle-1"), "subtitle1");
});

test("matchFigmaStyleToVariant matches button, caption, overline", () => {
  assert.equal(matchFigmaStyleToVariant("Button"), "button");
  assert.equal(matchFigmaStyleToVariant("Button/Primary"), "button");
  assert.equal(matchFigmaStyleToVariant("Caption"), "caption");
  assert.equal(matchFigmaStyleToVariant("Overline"), "overline");
});

test("matchFigmaStyleToVariant returns undefined for unrecognized styles", () => {
  assert.equal(matchFigmaStyleToVariant("Fill/Primary"), undefined);
  assert.equal(matchFigmaStyleToVariant("Color/Red"), undefined);
  assert.equal(matchFigmaStyleToVariant("Random Style"), undefined);
});

test("buildTypographyScaleFromFigmaStyles maps style entries to partial scale", () => {
  const entries: FigmaTextStyleEntry[] = [
    { styleName: "Heading/H1", fontSizePx: 40, fontWeight: 800, lineHeightPx: 48, fontFamily: "Inter" },
    { styleName: "Body/Regular", fontSizePx: 16, fontWeight: 400, lineHeightPx: 24, fontFamily: "Inter" },
    { styleName: "Caption", fontSizePx: 12, fontWeight: 400, lineHeightPx: 18, fontFamily: "Inter" }
  ];

  const scale = buildTypographyScaleFromFigmaStyles(entries);
  assert.equal(scale.h1?.fontSizePx, 40);
  assert.equal(scale.h1?.fontWeight, 800);
  assert.equal(scale.h1?.lineHeightPx, 48);
  assert.equal(scale.h1?.fontFamily, "Inter");
  assert.equal(scale.body1?.fontSizePx, 16);
  assert.equal(scale.body1?.fontWeight, 400);
  assert.equal(scale.caption?.fontSizePx, 12);
  assert.equal(scale.h2, undefined);
});

test("buildTypographyScaleFromFigmaStyles converts letter spacing from px to em", () => {
  const entries: FigmaTextStyleEntry[] = [
    { styleName: "Overline", fontSizePx: 12, fontWeight: 500, lineHeightPx: 18, letterSpacingPx: 1.2 }
  ];
  const scale = buildTypographyScaleFromFigmaStyles(entries);
  assert.equal(typeof scale.overline?.letterSpacingEm, "number");
  assert.equal(Math.abs((scale.overline?.letterSpacingEm ?? 0) - 0.1) < 0.001, true);
});

test("buildTypographyScaleFromFigmaStyles skips duplicate variant names", () => {
  const entries: FigmaTextStyleEntry[] = [
    { styleName: "Heading/H1", fontSizePx: 40, fontWeight: 800, lineHeightPx: 48 },
    { styleName: "H1 Alt", fontSizePx: 36, fontWeight: 700, lineHeightPx: 44 }
  ];
  const scale = buildTypographyScaleFromFigmaStyles(entries);
  assert.equal(scale.h1?.fontSizePx, 40);
});

test("buildTypographyScaleFromFigmaStyles ignores unrecognized style names", () => {
  const entries: FigmaTextStyleEntry[] = [
    { styleName: "Random/Unknown", fontSizePx: 20, fontWeight: 400, lineHeightPx: 28 }
  ];
  const scale = buildTypographyScaleFromFigmaStyles(entries);
  assert.equal(Object.keys(scale).length, 0);
});

test("completeTypographyScale merges Figma style overrides with fallback scale", () => {
  const partialScale = buildTypographyScaleFromFigmaStyles([
    { styleName: "Heading/H1", fontSizePx: 48, fontWeight: 900, lineHeightPx: 56, fontFamily: "Playfair" },
    { styleName: "Body/Regular", fontSizePx: 18, fontWeight: 400, lineHeightPx: 28, fontFamily: "Inter" }
  ]);

  const completed = completeTypographyScale({
    partialScale,
    fontFamily: "Inter",
    headingSize: 32,
    bodySize: 16
  });

  assert.equal(completed.h1.fontSizePx, 48);
  assert.equal(completed.h1.fontWeight, 900);
  assert.equal(completed.h1.fontFamily, "Playfair");
  assert.equal(completed.body1.fontSizePx, 18);
  assert.equal(completed.body1.fontFamily, "Inter");
  assert.equal(Object.keys(completed).length, 13);
  assert.equal(completed.button.textTransform, "none");
});

test("completeTypographyScale falls back gracefully when no styles found", () => {
  const completed = completeTypographyScale({
    partialScale: undefined,
    fontFamily: "Roboto",
    headingSize: 28,
    bodySize: 14
  });

  const fromAliases = buildTypographyScaleFromAliases({
    fontFamily: "Roboto",
    headingSize: 28,
    bodySize: 14
  });

  assert.equal(completed.h1.fontSizePx, fromAliases.h1.fontSizePx);
  assert.equal(completed.body1.fontSizePx, fromAliases.body1.fontSizePx);
  assert.equal(completed.caption.fontSizePx, fromAliases.caption.fontSizePx);
});
