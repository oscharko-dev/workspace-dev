import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildStorybookPublicArtifacts } from "./public-extracts.js";
import { STORYBOOK_PUBLIC_EXTENSION_KEY } from "./types.js";

const createMiniStorybookBuild = async (): Promise<string> => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-public-extracts-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const indexJson = {
    v: 5,
    entries: {
      "reactui-tooltip--default": {
        id: "reactui-tooltip--default",
        title: "ReactUI/Core/Tooltip",
        name: "Default",
        importPath: "./src/core/Tooltip/stories/Tooltip.stories.tsx",
        storiesImports: [],
        type: "story",
        tags: ["dev", "test"],
        componentPath: "./src/core/Tooltip/Tooltip.tsx"
      },
      "base-colors--docs": {
        id: "base-colors--docs",
        title: "Base/Colors/Color Tokens",
        name: "Docs",
        importPath: "./docs/Base/Colors/colors.mdx",
        storiesImports: ["./src/core/Tooltip/stories/Tooltip.stories.tsx"],
        type: "docs",
        tags: ["dev", "test", "attached-mdx"]
      },
      "if-components-button--docs": {
        id: "if-components-button--docs",
        title: "IF-Components/Button",
        name: "Docs",
        importPath: "./docs/IF-Components/Button.mdx",
        storiesImports: [],
        type: "docs",
        tags: ["dev", "test", "unattached-mdx"]
      }
    }
  };

  const iframeHtml = `
    <!doctype html>
    <html>
      <body>
        <script type="module" crossorigin src="./assets/iframe-test.js"></script>
      </body>
    </html>
  `;

  const iframeBundle = `
    const gq0 = {
      "./docs/IF-Components/Button.mdx": n(() => c0(() => import("./if-button-test.js"), true ? __vite__mapDeps([3]) : void 0, import.meta.url), "./docs/IF-Components/Button.mdx"),
      "./docs/Base/Colors/colors.mdx": n(() => c0(() => import("./colors-test.js"), true ? __vite__mapDeps([1]) : void 0, import.meta.url), "./docs/Base/Colors/colors.mdx"),
      "./src/core/Tooltip/stories/Tooltip.stories.tsx": n(() => c0(() => import("./Tooltip.stories-test.js"), true ? __vite__mapDeps([2]) : void 0, import.meta.url), "./src/core/Tooltip/stories/Tooltip.stories.tsx")
    };
  `;

  const storyBundle = `
    const meta = {
      title: "ReactUI/Core/Tooltip",
      args: { title: "Einfach", infos: "Ohne Infos" },
      argTypes: {
        title: { control: { type: "select" } },
        infos: { control: { type: "select" } }
      },
      parameters: {
        design: {
          type: "figma",
          url: "https://www.figma.com/design/demo"
        }
      }
    };
  `;

  const docsBundle = `
    function content() {
      return e.jsxs(e.Fragment, {
        children: [
          e.jsx(h1, { children: "Color Tokens" }),
          e.jsx(p, { children: "Tokens sind Farbnamen, denen HEX-Werte zugeordnet sind." }),
          e.jsx("img", { src: "static/assets/images/Base/Color_Tokens_1.png", alt: "Tokens" })
        ]
      });
    }
  `;

  const docsOnlyBundle = `
    function content() {
      return e.jsx(p, { children: "IF Button docs" });
    }
  `;

  const themeBundle = `
    const FONT_DATA = "data:application/font-ttf;base64,${"A".repeat(1500)}";
    const paletteRefs = { light: { "warning-01": "#ffc900", "warning-02": "#ffe36a" } };
    const keepName = ((fn, name) => fn);
    const createFont = keepName((family, weight, src) => ({
      fontFamily: \`\${family}\`,
      fontWeight: weight,
      src: \`url('\${src}') format('truetype')\`
    }), "createFont");
    const regular = createFont("Brand Sans", 400, FONT_DATA);
    const bold = createFont("Brand Sans Bold", 700, FONT_DATA);
    const appTheme = createTheme({
      spacing: 8,
      shape: { borderRadius: 12 },
      palette: {
        primary: { main: "#ff0000", contrastText: "#ffffff" },
        warning: { main: paletteRefs.light["warning-01"] },
        text: { primary: "#444444" }
      },
      typography: {
        fontFamily: "Brand Sans, sans-serif",
        fontSize: 16,
        body1: { fontSize: 14, lineHeight: 1.5, fontFamily: "Brand Sans" },
        h1: { fontSize: 30, lineHeight: 1.2, fontFamily: "Brand Sans Bold" }
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            "@font-face": [regular],
            fallbacks: [{ "@font-face": [bold] }]
          }
        }
      },
      zIndex: { drawer: 1200 }
    });
    export const Wrapped = () => jsx(ThemeProvider, { theme: appTheme, children: jsx(App, {}) });
  `;

  const cssText = `
    :root {
      --fi-space-base: 8px;
    }
  `;

  await writeFile(path.join(buildDir, "index.json"), `${JSON.stringify(indexJson, null, 2)}\n`, "utf8");
  await writeFile(path.join(buildDir, "iframe.html"), iframeHtml, "utf8");
  await writeFile(path.join(assetsDir, "iframe-test.js"), iframeBundle, "utf8");
  await writeFile(path.join(assetsDir, "Tooltip.stories-test.js"), storyBundle, "utf8");
  await writeFile(path.join(assetsDir, "colors-test.js"), docsBundle, "utf8");
  await writeFile(path.join(assetsDir, "if-button-test.js"), docsOnlyBundle, "utf8");
  await writeFile(path.join(assetsDir, "shared-theme.js"), themeBundle, "utf8");
  await writeFile(path.join(assetsDir, "iframe-test.css"), cssText, "utf8");

  return buildDir;
};

test("buildStorybookPublicArtifacts extracts DTCG-aligned tokens, themes, and sanitized components", async () => {
  const buildDir = await createMiniStorybookBuild();
  const artifacts = await buildStorybookPublicArtifacts({ buildDir });

  const tokenMetadata = artifacts.tokensArtifact.$extensions[STORYBOOK_PUBLIC_EXTENSION_KEY];
  assert.equal(tokenMetadata.version, 3);
  assert.equal(tokenMetadata.stats.themeCount, 1);
  assert.ok(tokenMetadata.stats.tokenCount >= 8);
  assert.equal(tokenMetadata.stats.errorCount, 0);
  assert.deepEqual(Object.keys(tokenMetadata.provenance).sort(), ["color", "font", "radius", "spacing", "typography", "z-index"]);
  assert.deepEqual(tokenMetadata.provenance.color, [
    {
      type: "theme_bundle",
      reliability: "authoritative",
      themeMarkers: ["createTheme", "ThemeProvider"]
    }
  ]);

  const tokenTheme = artifacts.tokensArtifact.theme as Record<string, unknown>;
  const defaultTheme = tokenTheme.default as Record<string, unknown>;
  const colorGroup = defaultTheme.color as Record<string, unknown>;
  const spacingGroup = defaultTheme.spacing as Record<string, unknown>;
  const typographyGroup = defaultTheme.typography as Record<string, unknown>;
  const fontGroup = artifacts.tokensArtifact.font as Record<string, unknown>;
  const fontFamilyGroup = fontGroup.family as Record<string, unknown>;

  assert.equal(((((colorGroup.primary as Record<string, unknown>).main as Record<string, unknown>).$type) as string), "color");
  assert.equal(((((spacingGroup.base as Record<string, unknown>).$type) as string)), "dimension");
  assert.equal(((((typographyGroup.body1 as Record<string, unknown>).$type) as string)), "typography");
  assert.equal(((((fontFamilyGroup["brand-sans"] as Record<string, unknown>).$type) as string)), "fontFamily");

  const themeMetadata = artifacts.themesArtifact.$extensions[STORYBOOK_PUBLIC_EXTENSION_KEY];
  assert.equal(themeMetadata.version, 3);
  assert.equal(themeMetadata.stats.themeCount, 1);
  assert.equal(artifacts.themesArtifact.modifiers.theme.default, "default");
  assert.deepEqual(artifacts.themesArtifact.modifiers.theme.contexts.default, [{ $ref: "#/sets/default" }]);
  assert.deepEqual(artifacts.themesArtifact.sets.default, {
    sources: [{ $ref: "./tokens.json#/theme/default" }]
  });
  assert.deepEqual(themeMetadata.provenance, {
    default: {
      color: [
        {
          type: "theme_bundle",
          reliability: "authoritative",
          themeMarkers: ["createTheme", "ThemeProvider"]
        }
      ],
      font: [
        {
          type: "theme_bundle",
          reliability: "authoritative",
          themeMarkers: ["createTheme", "ThemeProvider"]
        }
      ],
      radius: [
        {
          type: "theme_bundle",
          reliability: "authoritative",
          themeMarkers: ["createTheme", "ThemeProvider"]
        }
      ],
      spacing: [
        {
          type: "css",
          reliability: "authoritative",
          customProperties: ["--fi-space-base"]
        },
        {
          type: "theme_bundle",
          reliability: "authoritative",
          themeMarkers: ["createTheme", "ThemeProvider"]
        }
      ],
      typography: [
        {
          type: "theme_bundle",
          reliability: "authoritative",
          themeMarkers: ["createTheme", "ThemeProvider"]
        }
      ],
      "z-index": [
        {
          type: "theme_bundle",
          reliability: "authoritative",
          themeMarkers: ["createTheme", "ThemeProvider"]
        }
      ]
    }
  });

  assert.equal(artifacts.componentsArtifact.stats.componentCount, 1);
  assert.equal(artifacts.componentsArtifact.stats.componentWithDesignReferenceCount, 1);
  assert.equal(artifacts.componentsArtifact.components[0]?.title, "ReactUI/Core/Tooltip");
  assert.deepEqual(artifacts.componentsArtifact.components[0]?.propKeys, ["infos", "title"]);

  const serializedTokens = JSON.stringify(artifacts.tokensArtifact);
  const serializedThemes = JSON.stringify(artifacts.themesArtifact);
  const serializedComponents = JSON.stringify(artifacts.componentsArtifact);
  assert.equal(serializedComponents.includes("importPath"), false);
  assert.equal(serializedComponents.includes("storiesImports"), false);
  assert.equal(serializedComponents.includes("bundlePath"), false);
  assert.equal(serializedComponents.includes("iframeBundlePath"), false);
  assert.equal(serializedComponents.includes("buildRoot"), false);
  assert.equal(serializedComponents.includes("componentPath"), false);
  assert.equal(serializedTokens.includes("bundlePath"), false);
  assert.equal(serializedTokens.includes("importPath"), false);
  assert.equal(serializedTokens.includes("buildRoot"), false);
  assert.equal(serializedTokens.includes("data:application/font-ttf"), false);
  assert.equal(serializedTokens.includes("ignored-font"), false);
  assert.equal(serializedThemes.includes("bundlePath"), false);
  assert.equal(serializedThemes.includes("importPath"), false);
  assert.equal(serializedThemes.includes("buildRoot"), false);
});
