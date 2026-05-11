import assert from "node:assert/strict";
import test from "node:test";
import type { DesignIR } from "./types.js";
import {
  compileDesignTokenArtifacts,
  DESIGN_TOKEN_CSS_PATH,
  DESIGN_TOKEN_REPORT_PATH,
} from "./design-token-compiler.js";
import { buildTypographyScaleFromAliases } from "./typography-tokens.js";

const createTokenCompilerIr = (): DesignIR => ({
  sourceName: "Token Board",
  tokens: {
    palette: {
      primary: "#0055cc",
      secondary: "#00aa55",
      background: "#ffffff",
      text: "#101828",
      success: "#16a34a",
      warning: "#d97706",
      error: "#dc2626",
      info: "#0288d1",
      divider: "#1018281f",
      action: {
        active: "#1018288a",
        hover: "#0055cc0a",
        selected: "#0055cc14",
        disabled: "#10182842",
        disabledBackground: "#1018281f",
        focus: "#0055cc1f",
      },
    },
    borderRadius: 12,
    spacingBase: 8,
    fontFamily: "Inter",
    headingSize: 32,
    bodySize: 16,
    typography: buildTypographyScaleFromAliases({
      fontFamily: "Inter",
      headingSize: 32,
      bodySize: 16,
    }),
    tokenSource: {
      palette: "variables",
      typography: "styles",
      spacing: "variables",
      borderRadius: "variables",
      fontFamily: "variables",
    },
  },
  tokenArtifacts: {
    cssCustomProperties: `:root {
  --border-width-heavy: 4px;
  --color-primary: #003f99;
  --shadow-card: 0 8px 24px rgba(15, 23, 42, 0.18);
  --z-index-overlay: 1600;
}`,
    conflicts: [
      {
        kind: "value_override",
        name: "color-primary",
        figmaValue: "#0055cc",
        existingValue: "#111111",
        resolution: "figma",
      },
    ],
    libraryKeys: ["library-main"],
    modeAlternatives: {
      "color-primary": {
        Light: "#0055cc",
        Dark: "#66a3ff",
      },
    },
    unmappedVariables: ["feature/darkMode"],
  },
  themeAnalysis: {
    darkModeDetected: true,
    signals: {
      luminance: true,
      naming: true,
      lightDarkPair: true,
    },
    darkPaletteHints: {
      primary: "#66a3ff",
      background: {
        default: "#0b1220",
        paper: "#101828",
      },
      text: {
        primary: "#f8fafc",
      },
      divider: "#f8fafc1f",
    },
  },
  screens: [
    {
      id: "screen-1",
      name: "Dashboard",
      layoutMode: "VERTICAL",
      gap: 16,
      padding: {
        top: 16,
        right: 16,
        bottom: 16,
        left: 16,
      },
      children: [
        {
          id: "card-1",
          name: "Metric Card",
          nodeType: "FRAME",
          type: "card",
          elevation: 3,
          opacity: 0.9,
          strokeColor: "#1018281f",
          strokeWidth: 1,
          children: [
            {
              id: "title-1",
              name: "Title",
              nodeType: "TEXT",
              type: "text",
              text: "Revenue",
            },
          ],
        },
        {
          id: "modal-1",
          name: "Confirmation Modal",
          nodeType: "FRAME",
          type: "container",
          children: [],
        },
      ],
    },
  ],
});

test("compileDesignTokenArtifacts emits deterministic CSS variables and canonical token report", () => {
  const ir = createTokenCompilerIr();
  const first = compileDesignTokenArtifacts(ir);
  const second = compileDesignTokenArtifacts(ir);

  assert.equal(first.cssCustomProperties, second.cssCustomProperties);
  assert.deepEqual(first.tokenReport, second.tokenReport);
  assert.ok(first.cssCustomProperties.includes(":root {"));
  assert.ok(first.cssCustomProperties.includes("  --color-primary: #003f99;"));
  assert.equal(first.cssCustomProperties.includes("  --color-primary: #0055cc;"), false);
  assert.ok(first.cssCustomProperties.includes("  --border-width-heavy: 4px;"));
  assert.ok(first.cssCustomProperties.includes("  --shadow-card: 0 8px 24px rgba(15, 23, 42, 0.18);"));
  assert.ok(first.cssCustomProperties.includes("  --z-index-overlay: 1600;"));
  assert.ok(first.cssCustomProperties.includes("  --spacing-md: 16px;"));
  assert.ok(first.cssCustomProperties.includes("  --radius-md: 12px;"));
  assert.ok(first.cssCustomProperties.includes("  --border-width-default: 1px;"));
  assert.ok(first.cssCustomProperties.includes("  --shadow-elevation-3:"));
  assert.ok(first.cssCustomProperties.includes("  --opacity-90: 0.9;"));
  assert.ok(first.cssCustomProperties.includes("  --z-index-modal: 1300;"));
  assert.ok(first.cssCustomProperties.includes("[data-theme=\"dark\"] {"));
  assert.ok(first.cssCustomProperties.includes("  --color-background: #0b1220;"));

  assert.equal(first.tokenReport.schemaVersion, "1.0.0");
  assert.equal(first.tokenReport.pipelineId, "default");
  assert.equal(first.tokenReport.artifacts.cssCustomProperties, DESIGN_TOKEN_CSS_PATH);
  assert.equal(first.tokenReport.artifacts.tokenReport, DESIGN_TOKEN_REPORT_PATH);
  assert.equal(first.tokenReport.darkMode.detected, true);
  assert.equal(first.tokenReport.darkMode.selector, "[data-theme=\"dark\"]");
  assert.equal(first.tokenReport.categories.colors.source, "variables");
  assert.equal(first.tokenReport.categories.typography.source, "styles");
  assert.equal(first.tokenReport.categories.shadows.mapped, 1);
  assert.equal(first.tokenReport.categories.opacity.mapped, 1);
  assert.equal(first.tokenReport.categories.zIndex.mapped, 1);
  assert.equal(first.tokenReport.categories.borders.source, "figma");
  assert.equal(first.tokenReport.categories.shadows.source, "figma");
  assert.equal(first.tokenReport.categories.zIndex.source, "figma");
  assert.equal(first.tokenReport.conflicts.length, 1);
  assert.deepEqual(first.tokenReport.libraryKeys, ["library-main"]);
  assert.deepEqual(first.tokenReport.unmappedVariables, ["feature/darkMode"]);
  assert.deepEqual(first.tokenReport.modeAlternatives, {
    "color-primary": {
      Dark: "#66a3ff",
      Light: "#0055cc",
    },
  });
  assert.equal(first.tokenReport.tokenCoverage > 0.9, true);
});

test("compileDesignTokenArtifacts canonicalizes semantically identical mode alternatives", () => {
  const firstIr = createTokenCompilerIr();
  const secondIr = createTokenCompilerIr();
  firstIr.tokenArtifacts = {
    ...firstIr.tokenArtifacts,
    modeAlternatives: {
      "color-secondary": {
        Light: "#00aa55",
        Dark: "#60d394",
      },
      "color-primary": {
        Light: "#0055cc",
        Dark: "#66a3ff",
      },
    },
  };
  secondIr.tokenArtifacts = {
    ...secondIr.tokenArtifacts,
    modeAlternatives: {
      "color-primary": {
        Dark: "#66a3ff",
        Light: "#0055cc",
      },
      "color-secondary": {
        Dark: "#60d394",
        Light: "#00aa55",
      },
    },
  };

  assert.equal(
    JSON.stringify(compileDesignTokenArtifacts(firstIr).tokenReport),
    JSON.stringify(compileDesignTokenArtifacts(secondIr).tokenReport),
  );
});

test("compileDesignTokenArtifacts reports deterministic fallbacks when authoritative token sources are absent", () => {
  const ir = createTokenCompilerIr();
  ir.tokens.tokenSource = {
    palette: "clustering",
    typography: "clustering",
    spacing: "clustering",
    borderRadius: "clustering",
    fontFamily: "clustering",
  };
  ir.tokenArtifacts = undefined;
  ir.screens[0]!.children = [];
  ir.themeAnalysis = {
    darkModeDetected: false,
    signals: {
      luminance: false,
      naming: false,
      lightDarkPair: false,
    },
  };

  const result = compileDesignTokenArtifacts(ir);
  const fallbackKinds = result.tokenReport.fallbacks.map((fallback) => fallback.kind);

  assert.equal(result.cssCustomProperties.includes("[data-theme=\"dark\"]"), false);
  assert.equal(result.tokenReport.darkMode.detected, false);
  assert.equal(result.tokenReport.categories.colors.source, "clustering");
  assert.equal(fallbackKinds.includes("colors"), true);
  assert.equal(fallbackKinds.includes("typography"), true);
  assert.equal(fallbackKinds.includes("spacing"), true);
  assert.equal(fallbackKinds.includes("radius"), true);
  assert.equal(fallbackKinds.includes("shadows"), true);
  assert.equal(fallbackKinds.includes("opacity"), true);
  assert.equal(fallbackKinds.includes("zIndex"), true);
});
