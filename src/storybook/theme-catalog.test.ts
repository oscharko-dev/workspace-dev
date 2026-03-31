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

const createStoryArgsEvidenceItem = ({
  bundlePath,
  keys = []
}: {
  bundlePath: string;
  keys?: string[];
}): StorybookEvidenceItem => ({
  id: `args:${bundlePath}`,
  type: "story_args",
  reliability: "authoritative",
  source: {
    entryIds: ["story-1"],
    entryType: "story",
    bundlePath
  },
  usage: {
    canDriveTokens: true,
    canDriveProps: true,
    canDriveImports: false,
    canDriveStyling: true,
    canProvideMatchHints: true
  },
  summary: {
    keys
  }
});

const createStoryArgTypesEvidenceItem = ({
  bundlePath,
  keys = []
}: {
  bundlePath: string;
  keys?: string[];
}): StorybookEvidenceItem => ({
  id: `argtypes:${bundlePath}`,
  type: "story_argTypes",
  reliability: "authoritative",
  source: {
    entryIds: ["story-1"],
    entryType: "story",
    bundlePath
  },
  usage: {
    canDriveTokens: true,
    canDriveProps: true,
    canDriveImports: false,
    canDriveStyling: true,
    canProvideMatchHints: true
  },
  summary: {
    keys
  }
});

const createReferenceOnlyEvidenceItem = ({
  id,
  type
}: {
  id: string;
  type: "docs_image" | "docs_text" | "mdx_link";
}): StorybookEvidenceItem => ({
  id,
  type,
  reliability: "reference_only",
  source: {
    entryId: "docs-1",
    entryType: "docs",
    title: "Docs"
  },
  usage: {
    canDriveTokens: false,
    canDriveProps: false,
    canDriveImports: false,
    canDriveStyling: false,
    canProvideMatchHints: true
  },
  summary:
    type === "docs_image"
      ? { imagePath: "static/assets/tokens.png" }
      : type === "docs_text"
        ? { text: "Reference only." }
        : { linkTarget: "https://example.com/reference" }
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

test("buildStorybookThemeCatalog merges complementary authoritative theme bundles for one context", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-merge-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const colorsBundlePath = "assets/theme-colors.js";
  const layoutBundlePath = "assets/theme-layout.js";
  await writeFile(
    path.join(buildDir, colorsBundlePath),
    `
      const theme = createTheme({
        palette: {
          primary: { main: "#112233", contrastText: "#ffffff" },
          text: { primary: "#222222" }
        }
      });
      export { theme };
    `,
    "utf8"
  );
  await writeFile(
    path.join(buildDir, layoutBundlePath),
    `
      const theme = createTheme({
        spacing: 8,
        typography: {
          fontFamily: "Brand Sans, sans-serif",
          body1: { fontSize: 14, lineHeight: 1.5 }
        },
        components: {
          MuiButton: {
            styleOverrides: {
              root: {
                padding: 12,
                backgroundColor: "#334455"
              }
            }
          },
          MuiCssBaseline: {
            styleOverrides: {
              "@font-face": [{ fontFamily: "Brand Sans", fontWeight: 400, src: "url('ignored-font')" }]
            }
          }
        },
        shape: { borderRadius: 10 },
        zIndex: { drawer: 1200 }
      });
      export { theme };
    `,
    "utf8"
  );

  const catalog = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [createThemeBundleEvidenceItem(colorsBundlePath), createThemeBundleEvidenceItem(layoutBundlePath)]
  });

  assert.deepEqual(catalog.themes.map((theme) => theme.id), ["default"]);
  assert.equal(
    catalog.tokenGraph.some((token) => token.path.join(".") === "theme.default.color.primary.main"),
    true
  );
  assert.equal(
    catalog.tokenGraph.some((token) => token.path.join(".") === "theme.default.spacing.base"),
    true
  );
  assert.equal(
    catalog.tokenGraph.some((token) => token.path.join(".") === "theme.default.typography.body1"),
    true
  );
  assert.equal(
    catalog.tokenGraph.some((token) => token.path.join(".") === "theme.default.spacing.components.mui-button.style-overrides.root.padding"),
    true
  );
  assert.equal(
    catalog.tokenGraph.some((token) => token.path.join(".") === "theme.default.radius.shape.border-radius"),
    true
  );
  assert.equal(
    catalog.tokenGraph.some((token) => token.path.join(".") === "theme.default.z-index.drawer"),
    true
  );
  assert.equal(
    catalog.tokenGraph.some((token) => token.path.join(".") === "theme.default.font.family.brand-sans"),
    true
  );
  assert.equal(catalog.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length, 0);
});

test("buildStorybookThemeCatalog backfills missing classes from story args and argTypes without overriding canonical tokens", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-story-backfill-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const themeBundlePath = "assets/theme-base.js";
  const storyArgsBundlePath = "assets/story-args.js";
  const storyArgTypesBundlePath = "assets/story-argtypes.js";
  await writeFile(
    path.join(buildDir, themeBundlePath),
    `
      const theme = createTheme({
        palette: {
          primary: { main: "#ff0000", contrastText: "#ffffff" },
          text: { primary: "#222222" }
        }
      });
      export { theme };
    `,
    "utf8"
  );
  await writeFile(
    path.join(buildDir, storyArgsBundlePath),
    `
      const meta = {
        args: {
          spacing: 12,
          backgroundColor: "#abcdef"
        }
      };
      export default meta;
    `,
    "utf8"
  );
  await writeFile(
    path.join(buildDir, storyArgTypesBundlePath),
    `
      const meta = {
        argTypes: {
          fontFamily: {
            defaultValue: "Brand Sans"
          }
        }
      };
      export default meta;
    `,
    "utf8"
  );

  const catalog = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [
      createThemeBundleEvidenceItem(themeBundlePath),
      createStoryArgsEvidenceItem({
        bundlePath: storyArgsBundlePath,
        keys: ["spacing", "backgroundColor"]
      }),
      createStoryArgTypesEvidenceItem({
        bundlePath: storyArgTypesBundlePath,
        keys: ["fontFamily"]
      })
    ]
  });

  const spacingToken = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.spacing.stories.spacing");
  assert.equal(spacingToken?.tokenType, "dimension");
  assert.equal(spacingToken?.completeness.isBackfilled, true);
  assert.deepEqual(spacingToken?.provenance, [
    {
      type: "story_args",
      reliability: "authoritative",
      entryIds: ["story-1"],
      entryType: "story",
      keys: ["backgroundColor", "spacing"]
    }
  ]);

  const fontAliasToken = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.font.family.brand-sans");
  assert.equal(fontAliasToken?.tokenType, "fontFamily");
  assert.equal(fontAliasToken?.completeness.isBackfilled, false);
  assert.equal(catalog.diagnostics.some((diagnostic) => diagnostic.code === "MUI_THEME_SPACING_MISSING"), false);
  assert.equal(
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "MUI_THEME_TYPOGRAPHY_OR_FONT_MISSING"),
    false
  );
});

test("buildStorybookThemeCatalog rejects dynamic story backfill values and keeps the missing-class failure explicit", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-story-dynamic-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const themeBundlePath = "assets/theme-base.js";
  const storyArgsBundlePath = "assets/story-dynamic.js";
  await writeFile(
    path.join(buildDir, themeBundlePath),
    `
      const theme = createTheme({
        palette: {
          primary: { main: "#ff0000", contrastText: "#ffffff" },
          text: { primary: "#222222" }
        }
      });
      export { theme };
    `,
    "utf8"
  );
  await writeFile(
    path.join(buildDir, storyArgsBundlePath),
    `
      const meta = {
        args: {
          spacing: window.__dynamicSpacing
        }
      };
      export default meta;
    `,
    "utf8"
  );

  const catalog = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [
      createThemeBundleEvidenceItem(themeBundlePath),
      createStoryArgsEvidenceItem({
        bundlePath: storyArgsBundlePath,
        keys: ["spacing"]
      })
    ]
  });

  assert.equal(
    catalog.tokenGraph.some((token) => token.path.join(".") === "theme.default.spacing.stories.spacing"),
    false
  );
  assert.equal(
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "STORYBOOK_BACKFILL_VALUE_UNRESOLVED"),
    true
  );
  assert.equal(
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "MUI_THEME_SPACING_MISSING"),
    true
  );
});

test("buildStorybookThemeCatalog emits fatal diagnostics when no authoritative token evidence exists", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-no-authoritative-"));
  const catalog = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [createReferenceOnlyEvidenceItem({ id: "docs-image", type: "docs_image" })]
  });

  assert.equal(catalog.themes.length, 0);
  assert.equal(catalog.tokenGraph.length, 0);
  assert.deepEqual(
    catalog.diagnostics.map((diagnostic) => diagnostic.code),
    ["STORYBOOK_AUTHORITATIVE_TOKEN_EVIDENCE_MISSING"]
  );
});

test("buildStorybookThemeCatalog emits fatal diagnostics when required theme classes stay unresolved", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-missing-required-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const bundlePath = "assets/theme-incomplete.js";
  await writeFile(
    path.join(buildDir, bundlePath),
    `
      const theme = createTheme({
        palette: {
          primary: { main: "#ff0000", contrastText: "#ffffff" },
          text: { primary: "#222222" }
        }
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
  assert.equal(
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "MUI_THEME_SPACING_MISSING"),
    true
  );
  assert.equal(
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "MUI_THEME_TYPOGRAPHY_OR_FONT_MISSING"),
    true
  );
});

test("buildStorybookThemeCatalog ignores reference_only docs evidence for token extraction", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-reference-only-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const bundlePath = "assets/theme-complete.js";
  await writeFile(
    path.join(buildDir, bundlePath),
    `
      const theme = createTheme({
        spacing: 8,
        palette: {
          primary: { main: "#ff0000", contrastText: "#ffffff" },
          text: { primary: "#222222" }
        },
        typography: {
          fontFamily: "Brand Sans, sans-serif",
          body1: { fontSize: 14, lineHeight: 1.5 }
        }
      });
      export { theme };
    `,
    "utf8"
  );

  const baseline = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [createThemeBundleEvidenceItem(bundlePath)]
  });
  const withReferenceOnlyEvidence = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [
      createThemeBundleEvidenceItem(bundlePath),
      createReferenceOnlyEvidenceItem({ id: "docs-image", type: "docs_image" }),
      createReferenceOnlyEvidenceItem({ id: "docs-text", type: "docs_text" }),
      createReferenceOnlyEvidenceItem({ id: "docs-link", type: "mdx_link" })
    ]
  });

  assert.deepEqual(withReferenceOnlyEvidence.themes, baseline.themes);
  assert.deepEqual(withReferenceOnlyEvidence.tokenGraph, baseline.tokenGraph);
  assert.deepEqual(withReferenceOnlyEvidence.diagnostics, baseline.diagnostics);
});
