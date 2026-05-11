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

test("buildStorybookThemeCatalog extracts MUI colorSchemes, spacing scales, and fonts while failing closed on ambiguous CSS aliases", async () => {
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
  assert.equal(catalog.diagnostics.some((diagnostic) => diagnostic.code === "STORYBOOK_CSS_THEME_SCOPE_AMBIGUOUS"), false);
});

test("buildStorybookThemeCatalog promotes canonical spacing.base from authoritative CSS variables", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-css-base-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const bundlePath = "assets/theme.js";
  const stylesheetPath = "assets/theme.css";
  await writeFile(
    path.join(buildDir, bundlePath),
    `
      const theme = createTheme({
        shape: { borderRadius: 14 },
        palette: {
          primary: { main: "#ff0000", contrastText: "#ffffff" },
          text: { primary: "#444444" },
          background: { default: "#fafafa", paper: "#ffffff" }
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
        }
      });
      export { theme };
    `,
    "utf8"
  );
  await writeFile(
    path.join(buildDir, stylesheetPath),
    `
      :root {
        --fi-space-base: 12px;
      }
    `,
    "utf8"
  );

  const catalog = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [createThemeBundleEvidenceItem(bundlePath), createCssEvidenceItem(stylesheetPath)]
  });

  const spacingBase = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.spacing.base");
  assert.equal(spacingBase?.tokenType, "dimension");
  assert.deepEqual(spacingBase?.value, { value: 12, unit: "px" });
  assert.deepEqual(spacingBase?.cssVariableNames, ["--fi-space-base"]);
  assert.equal(
    catalog.tokenGraph.some((token) => token.path.join(".") === "theme.default.spacing.css.fi-space-base"),
    true
  );
});

test("buildStorybookThemeCatalog derives background tokens from authoritative Storybook surfaces when palette.background is absent", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-background-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const bundlePath = "assets/theme-background.js";
  await writeFile(
    path.join(buildDir, bundlePath),
    `
      const theme = createTheme({
        palette: {
          primary: { main: "#ff0000", contrastText: "#ffffff" },
          text: { primary: "#444444" },
          supplementary: {
            light: "#ffffff",
            main: "#fafafa",
            dark: "#f0f0f0"
          }
        },
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              body: {
                backgroundColor: "#f0f0f0"
              }
            }
          }
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

  assert.deepEqual(
    catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.color.background.default")?.value,
    {
      colorSpace: "srgb",
      components: [0.9411764705882353, 0.9411764705882353, 0.9411764705882353]
    }
  );
  assert.deepEqual(
    catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.color.background.paper")?.value,
    {
      colorSpace: "srgb",
      components: [1, 1, 1]
    }
  );
});

test("buildStorybookThemeCatalog derives MUI default spacing and shape foundations when createTheme omits them", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-default-foundations-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const bundlePath = "assets/theme-default-foundations.js";
  await writeFile(
    path.join(buildDir, bundlePath),
    `
      const theme = createTheme({
        palette: {
          primary: { main: "#ff0000", contrastText: "#ffffff" },
          text: { primary: "#444444" },
          background: { default: "#fafafa", paper: "#ffffff" }
        },
        typography: {
          fontFamily: "Brand Sans",
          body1: { fontSize: 14, lineHeight: 1.5 }
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

  assert.deepEqual(
    catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.spacing.base")?.value,
    {
      value: 8,
      unit: "px"
    }
  );
  assert.deepEqual(
    catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.radius.shape.border-radius")?.value,
    {
      value: 4,
      unit: "px"
    }
  );
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

test("buildStorybookThemeCatalog skips lower-priority duplicate theme bundles that conflict with the selected context theme", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-duplicate-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const primaryBundlePath = "assets/iframe-preview-theme.js";
  const duplicateBundlePath = "assets/SelectableFITabelle-theme.js";
  await writeFile(
    path.join(buildDir, primaryBundlePath),
    `
      const previewTheme = createTheme({
        spacing: 8,
        shape: { borderRadius: 12 },
        palette: {
          primary: { main: "#ff0000" },
          info: { main: "#00acd3" },
          success: { main: "#009864" }
        },
        typography: {
          fontFamily: "Brand Sans",
          body1: { fontSize: 14, lineHeight: 1.5 }
        },
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              body: { backgroundColor: "#ffffff" }
            }
          }
        },
        zIndex: { drawer: 1200 }
      });
      export { previewTheme };
    `,
    "utf8"
  );
  await writeFile(
    path.join(buildDir, duplicateBundlePath),
    `
      const dynamicSpacing = (...args) => args.length;
      const dynamicShape = getShape();
      const localTheme = createTheme({
        spacing: dynamicSpacing,
        shape: dynamicShape,
        palette: {
          info: { main: "#304ffe" },
          success: { main: "#4caf50" }
        },
        typography: {
          fontFamily: "Local Sans"
        }
      });
      export { localTheme };
    `,
    "utf8"
  );

  const catalog = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [createThemeBundleEvidenceItem(primaryBundlePath), createThemeBundleEvidenceItem(duplicateBundlePath)]
  });

  assert.deepEqual(catalog.themes.map((theme) => theme.id), ["default"]);
  assert.equal(
    catalog.diagnostics.some(
      (diagnostic) => diagnostic.code === "STORYBOOK_THEME_BUNDLE_SKIPPED" && diagnostic.bundlePath === duplicateBundlePath
    ),
    true
  );
  assert.equal(
    catalog.diagnostics.some((diagnostic) =>
      diagnostic.code === "MUI_THEME_RADIUS_UNRESOLVED" || diagnostic.code === "MUI_THEME_SPACING_DYNAMIC_UNSUPPORTED"
    ),
    false
  );
  assert.equal(
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "STORYBOOK_TOKEN_CONFLICT"),
    false
  );

  const infoMain = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.color.info.main");
  const successMain = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.color.success.main");
  assert.deepEqual(infoMain?.value, {
    colorSpace: "srgb",
    components: [0, 0.6745098039215687, 0.8274509803921568]
  });
  assert.deepEqual(successMain?.value, {
    colorSpace: "srgb",
    components: [0, 0.596078431372549, 0.39215686274509803]
  });
});

test("buildStorybookThemeCatalog prefers canonical palette keys over case-only aliases", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-palette-aliases-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const bundlePath = "assets/theme-palette-aliases.js";
  await writeFile(
    path.join(buildDir, bundlePath),
    `
      const theme = createTheme({
        spacing: 8,
        shape: { borderRadius: 12 },
        palette: {
          info: { main: "#00acd3" },
          INFO: { main: "#304ffe" },
          success: { main: "#009864" },
          SUCCESS: { main: "#4caf50" }
        },
        typography: {
          fontFamily: "Brand Sans"
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

  assert.equal(
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "STORYBOOK_TOKEN_CONFLICT"),
    false
  );
  assert.deepEqual(
    catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.color.info.main")?.value,
    {
      colorSpace: "srgb",
      components: [0, 0.6745098039215687, 0.8274509803921568]
    }
  );
  assert.deepEqual(
    catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.color.success.main")?.value,
    {
      colorSpace: "srgb",
      components: [0, 0.596078431372549, 0.39215686274509803]
    }
  );
});

test("buildStorybookThemeCatalog prefers MUI default foundations over story backfill while recovering missing fonts from argTypes", async () => {
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

  const spacingToken = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.spacing.base");
  assert.equal(spacingToken?.tokenType, "dimension");
  assert.equal(spacingToken?.completeness.isBackfilled, true);
  assert.deepEqual(spacingToken?.provenance, [
    {
      type: "theme_bundle",
      reliability: "authoritative",
      themeMarkers: ["createTheme"]
    }
  ]);
  assert.equal(
    catalog.tokenGraph.some((token) => token.path.join(".") === "theme.default.spacing.stories.spacing"),
    false
  );

  const fontAliasToken = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.font.family.brand-sans");
  assert.equal(fontAliasToken?.tokenType, "fontFamily");
  assert.equal(fontAliasToken?.completeness.isBackfilled, false);
  assert.equal(catalog.diagnostics.some((diagnostic) => diagnostic.code === "MUI_THEME_SPACING_MISSING"), false);
  assert.equal(
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "MUI_THEME_TYPOGRAPHY_OR_FONT_MISSING"),
    false
  );
});

test("buildStorybookThemeCatalog resolves non-palette colorSchemes overrides for spacing, typography, shape, components, and zIndex", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-color-schemes-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const bundlePath = "assets/theme-color-schemes.js";
  await writeFile(
    path.join(buildDir, bundlePath),
    `
      const theme = extendTheme({
        spacing: 8,
        shape: { borderRadius: 10 },
        typography: {
          fontFamily: "Brand Sans",
          body1: { fontSize: 14, lineHeight: 1.5 }
        },
        components: {
          MuiButton: {
            styleOverrides: {
              root: {
                padding: "8px"
              }
            }
          }
        },
        zIndex: { drawer: 1200 },
        colorSchemes: {
          light: {
            palette: {
              primary: { main: "#ff0000", contrastText: "#ffffff" },
              text: { primary: "#222222" },
              background: { default: "#ffffff", paper: "#ffffff" }
            },
            spacing: 12,
            shape: { borderRadius: 18 },
            typography: {
              fontFamily: "Brand Sans",
              body1: { fontSize: 18, lineHeight: 1.7 }
            },
            components: {
              MuiButton: {
                styleOverrides: {
                  root: {
                    padding: "12px"
                  }
                }
              }
            },
            zIndex: { drawer: 1400 }
          }
        }
      });
      export { theme };
    `,
    "utf8"
  );

  const catalog = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [
      {
        ...createThemeBundleEvidenceItem(bundlePath),
        summary: {
          themeMarkers: ["extendTheme"]
        }
      }
    ]
  });

  const spacingBase = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.light.spacing.base");
  const typographyBody = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.light.typography.body1");
  const radius = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.light.radius.shape.border-radius");
  const buttonPadding = catalog.tokenGraph.find(
    (token) => token.path.join(".") === "theme.light.spacing.components.mui-button.style-overrides.root.padding"
  );
  const drawerZIndex = catalog.tokenGraph.find((token) => token.path.join(".") === "theme.light.z-index.drawer");

  assert.equal(JSON.stringify(spacingBase?.value), JSON.stringify({ value: 12, unit: "px" }));
  assert.equal(JSON.stringify(typographyBody?.value), JSON.stringify({
    fontFamily: "{font.family.brand-sans}",
    fontSize: { value: 18, unit: "px" },
    lineHeight: 1.7
  }));
  assert.equal(JSON.stringify(radius?.value), JSON.stringify({ value: 18, unit: "px" }));
  assert.equal(JSON.stringify(buttonPadding?.value), JSON.stringify({ value: 12, unit: "px" }));
  assert.equal(drawerZIndex?.value, 1400);
});

test("buildStorybookThemeCatalog fails closed when css and story backfill scope is ambiguous across theme bundles", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-ambiguous-scope-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const bundleOnePath = "assets/theme-one.js";
  const bundleTwoPath = "assets/theme-two.js";
  const stylesheetPath = "assets/theme.css";
  const storyArgsBundlePath = "assets/story-args.js";

  await writeFile(
    path.join(buildDir, bundleOnePath),
    `
      const theme = createTheme({
        palette: {
          primary: { main: "#ff0000", contrastText: "#ffffff" },
          text: { primary: "#111111" },
          background: { default: "#ffffff", paper: "#ffffff" }
        },
        typography: {
          fontFamily: "Brand Sans",
          body1: { fontSize: 14, lineHeight: 1.5 }
        }
      });
      export { theme };
    `,
    "utf8"
  );
  await writeFile(
    path.join(buildDir, bundleTwoPath),
    `
      const theme = extendTheme({
        colorSchemes: {
          dark: {
            palette: {
              primary: { main: "#0000ff", contrastText: "#ffffff" },
              text: { primary: "#222222" },
              background: { default: "#111111", paper: "#222222" }
            }
          }
        },
        typography: {
          fontFamily: "Brand Sans",
          body1: { fontSize: 14, lineHeight: 1.5 }
        }
      });
      export { theme };
    `,
    "utf8"
  );
  await writeFile(
    path.join(buildDir, stylesheetPath),
    `
      :root {
        --fi-space-base: 12px;
      }
    `,
    "utf8"
  );
  await writeFile(
    path.join(buildDir, storyArgsBundlePath),
    `
      const meta = {
        args: {
          spacing: 12
        }
      };
      export default meta;
    `,
    "utf8"
  );

  const catalog = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [
      createThemeBundleEvidenceItem(bundleOnePath),
      createThemeBundleEvidenceItem(bundleTwoPath),
      createCssEvidenceItem(stylesheetPath),
      createStoryArgsEvidenceItem({
        bundlePath: storyArgsBundlePath,
        keys: ["spacing"]
      })
    ]
  });

  assert.equal(catalog.diagnostics.some((diagnostic) => diagnostic.code === "STORYBOOK_CSS_THEME_SCOPE_AMBIGUOUS"), true);
  assert.equal(
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "STORYBOOK_BACKFILL_THEME_SCOPE_AMBIGUOUS"),
    true
  );
  assert.equal(catalog.tokenGraph.some((token) => token.path.join(".") === "theme.light.spacing.base"), false);
  assert.equal(
    catalog.tokenGraph.some((token) => token.path.join(".").startsWith("theme.light.spacing.stories")),
    false
  );
});

test("buildStorybookThemeCatalog fails closed for CSS and story backfill when a single bundle yields multiple themes", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-single-bundle-ambiguous-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const bundlePath = "assets/theme-modes.js";
  const stylesheetPath = "assets/theme.css";
  const storyArgsBundlePath = "assets/story.js";
  await writeFile(
    path.join(buildDir, bundlePath),
    `
      const theme = extendTheme({
        spacing: 8,
        colorSchemes: {
          light: {
            palette: {
              primary: { main: "#ff0000", contrastText: "#ffffff" },
              text: { primary: "#444444" }
            }
          },
          dark: {
            palette: {
              primary: { main: "#880000", contrastText: "#ffffff" },
              text: { primary: "#f0f0f0" }
            }
          }
        }
      });
      export { theme };
    `,
    "utf8"
  );
  await writeFile(
    path.join(buildDir, stylesheetPath),
    `
      :root {
        --fi-space-base: 12px;
      }
    `,
    "utf8"
  );
  await writeFile(
    path.join(buildDir, storyArgsBundlePath),
    `
      const meta = {
        args: {
          spacing: 12
        }
      };
      export default meta;
    `,
    "utf8"
  );

  const catalog = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [
      createThemeBundleEvidenceItem(bundlePath),
      createCssEvidenceItem(stylesheetPath),
      createStoryArgsEvidenceItem({
        bundlePath: storyArgsBundlePath,
        keys: ["spacing"]
      })
    ]
  });

  assert.equal(catalog.diagnostics.some((diagnostic) => diagnostic.code === "STORYBOOK_CSS_THEME_SCOPE_AMBIGUOUS"), true);
  assert.equal(
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "STORYBOOK_BACKFILL_THEME_SCOPE_AMBIGUOUS"),
    true
  );
  assert.equal(catalog.tokenGraph.some((token) => token.path.join(".").startsWith("theme.light.spacing.css")), false);
  assert.equal(catalog.tokenGraph.some((token) => token.path.join(".").startsWith("theme.dark.spacing.css")), false);
  assert.equal(catalog.tokenGraph.some((token) => token.path.join(".").startsWith("theme.light.spacing.stories")), false);
  assert.equal(catalog.tokenGraph.some((token) => token.path.join(".").startsWith("theme.dark.spacing.stories")), false);
});

test("buildStorybookThemeCatalog emits conflict diagnostics for repeated story args with conflicting values", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-story-conflict-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const themeBundlePath = "assets/theme-base.js";
  const storyArgsBundlePath = "assets/story-conflict.js";
  await writeFile(
    path.join(buildDir, themeBundlePath),
    `
      const theme = createTheme({
        palette: {
          primary: { main: "#ff0000", contrastText: "#ffffff" },
          text: { primary: "#222222" },
          background: { default: "#ffffff", paper: "#ffffff" }
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
          spacing: 8
        }
      };
      export const Variant = {
        args: {
          spacing: 12
        }
      };
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
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "STORYBOOK_BACKFILL_VALUE_CONFLICT"),
    true
  );
  assert.equal(
    catalog.tokenGraph.some((token) => token.path.join(".") === "theme.default.spacing.stories.spacing"),
    false
  );
  assert.equal(
    catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.spacing.base")?.tokenType,
    "dimension"
  );
});

test("buildStorybookThemeCatalog emits conflict diagnostics for repeated story argTypes defaults with conflicting values", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-argtypes-conflict-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const themeBundlePath = "assets/theme-base.js";
  const storyArgTypesBundlePath = "assets/story-argtypes-conflict.js";
  await writeFile(
    path.join(buildDir, themeBundlePath),
    `
      const theme = createTheme({
        palette: {
          primary: { main: "#ff0000", contrastText: "#ffffff" },
          text: { primary: "#222222" },
          background: { default: "#ffffff", paper: "#ffffff" }
        }
      });
      export { theme };
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
      export const Variant = {
        argTypes: {
          fontFamily: {
            defaultValue: "Brand Serif"
          }
        }
      };
    `,
    "utf8"
  );

  const catalog = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [
      createThemeBundleEvidenceItem(themeBundlePath),
      createStoryArgTypesEvidenceItem({
        bundlePath: storyArgTypesBundlePath,
        keys: ["fontFamily"]
      })
    ]
  });

  assert.equal(
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "STORYBOOK_BACKFILL_VALUE_CONFLICT"),
    true
  );
  assert.equal(
    catalog.tokenGraph.some((token) => token.path.join(".") === "theme.default.font.family.brand-serif"),
    false
  );
  assert.equal(
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "MUI_THEME_TYPOGRAPHY_OR_FONT_MISSING"),
    true
  );
});

test("buildStorybookThemeCatalog ignores semantic color argType conflicts that are not tokenizable", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-color-semantic-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const themeBundlePath = "assets/theme-base.js";
  const storyArgTypesBundlePath = "assets/story-argtypes-color-conflict.js";
  await writeFile(
    path.join(buildDir, themeBundlePath),
    `
      const theme = createTheme({
        palette: {
          primary: { main: "#ff0000", contrastText: "#ffffff" },
          text: { primary: "#222222" }
        },
        spacing: 8,
        typography: {
          fontFamily: "Brand Sans"
        }
      });
      export { theme };
    `,
    "utf8"
  );
  await writeFile(
    path.join(buildDir, storyArgTypesBundlePath),
    `
      const meta = {
        argTypes: {
          color: {
            defaultValue: "primary"
          }
        }
      };
      export const Variant = {
        argTypes: {
          color: {
            defaultValue: "secondary"
          }
        }
      };
    `,
    "utf8"
  );

  const catalog = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: [
      createThemeBundleEvidenceItem(themeBundlePath),
      createStoryArgTypesEvidenceItem({
        bundlePath: storyArgTypesBundlePath,
        keys: ["color"]
      })
    ]
  });

  assert.equal(
    catalog.diagnostics.some((diagnostic) => diagnostic.code === "STORYBOOK_BACKFILL_VALUE_CONFLICT"),
    false
  );
});

test("buildStorybookThemeCatalog rejects dynamic story backfill values while retaining MUI default spacing foundations", async () => {
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
    catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.spacing.base")?.tokenType,
    "dimension"
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

test("buildStorybookThemeCatalog emits fatal diagnostics only for required theme classes that remain unresolved after MUI defaults", async () => {
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
    false
  );
  assert.equal(
    catalog.tokenGraph.find((token) => token.path.join(".") === "theme.default.spacing.base")?.tokenType,
    "dimension"
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

test("buildStorybookThemeCatalog extracts named CSS colors and HSL values from authoritative palette entries", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-theme-named-colors-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const bundlePath = "assets/theme-named-colors.js";
  await writeFile(
    path.join(buildDir, bundlePath),
    `
      const theme = createTheme({
        spacing: 8,
        palette: {
          primary: { main: "#ff0000", contrastText: "white" },
          secondary: { main: "hsl(240, 100%, 50%)", contrastText: "black" },
          text: { primary: "#222222" },
          background: { default: "ivory", paper: "white" }
        },
        typography: {
          fontFamily: "Brand Sans",
          body1: { fontSize: 14, lineHeight: 1.5 }
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

  const contrastText = catalog.tokenGraph.find(
    (token) => token.path.join(".") === "theme.default.color.primary.contrast-text"
  );
  assert.equal(contrastText?.tokenType, "color");
  assert.deepEqual(contrastText?.value, {
    colorSpace: "srgb",
    components: [1, 1, 1]
  });

  const secondaryMain = catalog.tokenGraph.find(
    (token) => token.path.join(".") === "theme.default.color.secondary.main"
  );
  assert.equal(secondaryMain?.tokenType, "color");
  assert.ok(secondaryMain?.value);
  const secondaryValue = secondaryMain?.value as { colorSpace: string; components: number[] };
  assert.equal(secondaryValue.colorSpace, "srgb");
  assert.ok(secondaryValue.components[2]! > 0.99, "blue channel should be ~1.0 for hsl(240, 100%, 50%)");
  assert.ok(secondaryValue.components[0]! < 0.01, "red channel should be ~0 for hsl(240, 100%, 50%)");

  const blackToken = catalog.tokenGraph.find(
    (token) => token.path.join(".") === "theme.default.color.secondary.contrast-text"
  );
  assert.equal(blackToken?.tokenType, "color");
  assert.deepEqual(blackToken?.value, {
    colorSpace: "srgb",
    components: [0, 0, 0]
  });

  const bgDefault = catalog.tokenGraph.find(
    (token) => token.path.join(".") === "theme.default.color.background.default"
  );
  assert.equal(bgDefault?.tokenType, "color");

  assert.equal(catalog.diagnostics.filter((d) => d.severity === "error").length, 0);
});
