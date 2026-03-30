import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildStorybookThemeCatalog } from "./theme-catalog.js";
import type { StorybookEvidenceItem } from "./types.js";

const createUsage = () => ({
  canDriveTokens: true,
  canDriveProps: false,
  canDriveImports: false,
  canDriveStyling: true,
  canProvideMatchHints: false
});

const createThemeBundleEvidenceItem = (bundlePath: string): StorybookEvidenceItem => ({
  id: `theme:${bundlePath}`,
  type: "theme_bundle",
  reliability: "authoritative",
  source: {
    bundlePath
  },
  usage: createUsage(),
  summary: {
    themeMarkers: ["createTheme"]
  }
});

const createCssEvidenceItem = (stylesheetPath: string): StorybookEvidenceItem => ({
  id: `css:${stylesheetPath}`,
  type: "css",
  reliability: "authoritative",
  source: {
    stylesheetPath
  },
  usage: createUsage(),
  summary: {
    customProperties: ["--brand-warning"]
  }
});

test("buildStorybookThemeCatalog extracts MUI colorSchemes, spacing scales, fonts, and CSS aliases", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-catalog-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const bundlePath = "assets/theme.js";
  const stylesheetPath = "assets/theme.css";
  await writeFile(
    path.join(buildDir, bundlePath),
    `
      const baseTokens = { radius: 10 };
      const fonts = {
        regular: { family: "Brand Sans", weight: 400 },
        bold: { family: "Brand Sans Bold", weight: 700 }
      };
      const sharedTypography = {
        fontFamily: "Brand Sans, sans-serif",
        fontWeightRegular: 400,
        body1: { fontSize: 14, lineHeight: 1.5 },
        h1: { fontSize: 30, lineHeight: 1.2, fontFamily: fonts.bold.family }
      };
      const theme = extendTheme({
        spacing: [0, 4, 8, 16],
        shape: { borderRadius: baseTokens.radius },
        typography: sharedTypography,
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              "@font-face": [
                { fontFamily: fonts.regular.family, fontWeight: fonts.regular.weight, src: "url('ignored-font')" },
                { fontFamily: fonts.bold.family, fontWeight: fonts.bold.weight, src: "url('ignored-font')" }
              ]
            }
          }
        },
        colorSchemes: {
          light: {
            palette: {
              primary: { main: "#ff0000", contrastText: "#ffffff" },
              warning: { main: "#ffc900" },
              text: { primary: "#444444" }
            }
          },
          dark: {
            palette: {
              primary: { main: "#880000", contrastText: "#ffffff" },
              warning: { main: "#996600" },
              text: { primary: "#f0f0f0" }
            }
          }
        },
        zIndex: { drawer: 1200 }
      });
      export { theme };
    `,
    "utf8"
  );
  await writeFile(
    path.join(buildDir, stylesheetPath),
    `
      :root {
        --brand-warning: #ffc900;
      }
    `,
    "utf8"
  );

  const catalog = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [createThemeBundleEvidenceItem(bundlePath), createCssEvidenceItem(stylesheetPath)]
  });

  assert.deepEqual(
    catalog.themes.map((theme) => theme.context),
    ["dark", "light"]
  );

  const lightWarning = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.light.color.warning.main");
  assert.equal(lightWarning?.tokenType, "color");
  assert.deepEqual(lightWarning?.cssVariableNames, ["--brand-warning"]);

  const darkPrimary = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.dark.color.primary.main");
  assert.equal(darkPrimary?.tokenType, "color");

  const spacingScale = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.light.spacing.scale.2");
  assert.equal(spacingScale?.tokenType, "dimension");
  assert.deepEqual(spacingScale?.value, { value: 8, unit: "px" });

  const baseTypography = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.light.typography.base");
  assert.equal(baseTypography?.tokenType, "typography");

  const fontFamily = catalog.tokenGraph.find((token) => token.path.join(".") === "font.family.brand-sans");
  assert.equal(fontFamily?.tokenType, "fontFamily");

  const radius = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.light.radius.shape.border-radius");
  assert.equal(radius?.tokenType, "dimension");

  assert.equal(catalog.diagnostics.length, 0);
});

test("buildStorybookThemeCatalog surfaces hard diagnostics for dynamic spacing functions", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-diagnostics-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const bundlePath = "assets/dynamic-theme.js";
  await writeFile(
    path.join(buildDir, bundlePath),
    `
      const theme = createTheme({
        palette: {
          primary: { main: "#ff0000", contrastText: "#ffffff" },
          text: { primary: "#444444" }
        },
        typography: {
          fontFamily: "Brand Sans, sans-serif",
          body1: { fontSize: 14, lineHeight: 1.5 }
        },
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              "@font-face": [{ fontFamily: "Brand Sans", fontWeight: 400, src: "url('ignored-font')" }]
            }
          }
        },
        spacing: (factor) => \`\${factor * 0.25}rem\`
      });
      export { theme };
    `,
    "utf8"
  );

  const catalog = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [createThemeBundleEvidenceItem(bundlePath)]
  });

  assert.equal(catalog.themes.length, 1);
  assert.ok(
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "MUI_THEME_SPACING_DYNAMIC_UNSUPPORTED")
  );
  assert.equal(
    catalog.tokenGraph.some((token) => token.path.join(".") === "theme.default.spacing.base"),
    false
  );
});
