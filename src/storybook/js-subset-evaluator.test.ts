import assert from "node:assert/strict";
import test from "node:test";
import {
  createEvaluationState,
  createJsEvaluationEnvironment,
  evaluateJsExpression,
  isJsStaticNumberValue,
  isJsStaticObjectValue,
  isJsStaticStringValue
} from "./js-subset-evaluator.js";

test("JS subset evaluator resolves local factory calls, member access, and spreads", () => {
  const bundleText = `
    const FONT_DATA = "data:application/font-ttf;base64,${"A".repeat(1500)}";
    const paletteRefs = {
      light: {
        "warning-01": "#ffc900",
        "warning-02": "#ffe36a"
      }
    };
    const baseTypography = {
      body1: { fontSize: 14, lineHeight: 1.5 }
    };
    const wrapNamed = ((fn, name) => fn);
    const createFont = wrapNamed((family, weight, src) => ({
      fontFamily: \`\${family}\`,
      fontWeight: weight,
      src: \`url('\${src}') format('truetype')\`
    }), "createFont");
    const regular = createFont("Brand Sans", 400, FONT_DATA);
    const mergedTheme = {
      ...baseTypography,
      warningColor: paletteRefs.light["warning-01"],
      font: regular
    };
  `;

  const env = createJsEvaluationEnvironment(bundleText);
  const state = createEvaluationState();
  const result = evaluateJsExpression({
    source: "mergedTheme",
    env,
    state
  });

  assert.ok(isJsStaticObjectValue(result));
  const warningColor = result.properties.get("warningColor");
  assert.ok(warningColor && isJsStaticStringValue(warningColor));
  assert.equal(warningColor?.value, "#ffc900");

  const body1 = result.properties.get("body1");
  assert.ok(body1 && isJsStaticObjectValue(body1));
  const fontSize = body1?.properties.get("fontSize");
  assert.ok(fontSize && isJsStaticNumberValue(fontSize));
  assert.equal(fontSize?.value, 14);

  const font = result.properties.get("font");
  assert.ok(font && isJsStaticObjectValue(font));
  const fontFamily = font?.properties.get("fontFamily");
  const fontWeight = font?.properties.get("fontWeight");
  const fontSrc = font?.properties.get("src");
  assert.ok(fontFamily && isJsStaticStringValue(fontFamily));
  assert.equal(fontFamily?.value, "Brand Sans");
  assert.ok(fontWeight && isJsStaticNumberValue(fontWeight));
  assert.equal(fontWeight?.value, 400);
  assert.equal(fontSrc?.kind, "unknown");

  assert.deepEqual(state.diagnostics, []);
});

test("JS subset evaluator surfaces unresolved expressions as diagnostics", () => {
  const env = createJsEvaluationEnvironment(`
    const palette = {
      primary: { main: externalColor.main }
    };
  `);
  const state = createEvaluationState();
  const result = evaluateJsExpression({
    source: "palette",
    env,
    state
  });

  assert.ok(isJsStaticObjectValue(result));
  const primary = result.properties.get("primary");
  assert.ok(primary && isJsStaticObjectValue(primary));
  assert.equal(primary?.properties.get("main")?.kind, "unknown");
});

test("JS subset evaluator detects local reference cycles", () => {
  const env = createJsEvaluationEnvironment(`
    const light = dark;
    const dark = light;
    const theme = { palette: { primary: { main: light } } };
  `);
  const state = createEvaluationState();
  const result = evaluateJsExpression({
    source: "theme",
    env,
    state
  });

  assert.ok(isJsStaticObjectValue(result));
  const palette = result.properties.get("palette");
  assert.ok(palette && isJsStaticObjectValue(palette));
  const primary = palette?.properties.get("primary");
  assert.ok(primary && isJsStaticObjectValue(primary));
  assert.equal(primary?.properties.get("main")?.kind, "unknown");
  assert.ok(state.diagnostics.some((diagnostic) => diagnostic.code === "JS_EVAL_CYCLE"));
});
