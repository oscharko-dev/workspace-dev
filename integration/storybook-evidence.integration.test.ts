import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { getStorybookCatalogOutputFileName } from "../src/storybook/catalog.js";
import { getStorybookPublicArtifactFileNames } from "../src/storybook/public-extracts.js";
import { STORYBOOK_PUBLIC_EXTENSION_KEY } from "../src/storybook/types.js";

const execFile = promisify(execFileCallback);

const createIntegrationStorybookBuild = async (): Promise<string> => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-evidence-integration-"));
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
          e.jsxs(p, {
            children: [
              "Weitere Details unter ",
              e.jsx("a", { href: "/docs/base-colors-sk-theme--docs", children: "SK-Theme" }),
              " sowie ",
              e.jsx("a", { href: "https://example.com/design", children: "extern" })
            ]
          }),
          e.jsx("img", { src: "static/assets/images/Base/Color_Tokens_1.png", alt: "Tokens" })
        ]
      });
    }
  `;

  const sharedThemeBundle = `
    const FONT_DATA = "data:application/font-ttf;base64,${"A".repeat(1500)}";
    const paletteRefs = { light: { "warning-01": "#ffc900" } };
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
  await writeFile(path.join(assetsDir, "shared-theme.js"), sharedThemeBundle, "utf8");
  await writeFile(path.join(assetsDir, "iframe-test.css"), cssText, "utf8");

  return buildDir;
};

test("storybook public artifact integration: CLI generates deterministic sanitized artifacts from a synthetic build", async () => {
  const buildDir = await createIntegrationStorybookBuild();
  const generatorEntrypoint = path.resolve(process.cwd(), "src", "storybook", "generate-artifact.ts");
  const outputDirPath = path.join(buildDir, "reference-output");
  const fileNames = getStorybookPublicArtifactFileNames();

  const runGenerator = async (): Promise<{
    catalogEntryCount: number;
    catalogFamilyCount: number;
    catalogPath: string;
    outputDir: string;
    writtenFiles: {
      tokens: string;
      themes: string;
      components: string;
    };
    tokenCount: number;
    themeCount: number;
    componentCount: number;
  }> => {
    const { stdout, stderr } = await execFile(
      "pnpm",
      ["exec", "tsx", generatorEntrypoint, buildDir, outputDirPath],
      {
        cwd: process.cwd()
      }
    );

    assert.equal(stderr, "");
    return JSON.parse(stdout) as {
      catalogEntryCount: number;
      catalogFamilyCount: number;
      catalogPath: string;
      outputDir: string;
      writtenFiles: {
        tokens: string;
        themes: string;
        components: string;
      };
      tokenCount: number;
      themeCount: number;
      componentCount: number;
    };
  };

  const firstSummary = await runGenerator();
  const catalogFileName = getStorybookCatalogOutputFileName();
  const firstCatalogBytes = await readFile(path.join(buildDir, catalogFileName), "utf8");
  const firstTokensBytes = await readFile(path.join(outputDirPath, fileNames.tokens), "utf8");
  const firstThemesBytes = await readFile(path.join(outputDirPath, fileNames.themes), "utf8");
  const firstComponentsBytes = await readFile(path.join(outputDirPath, fileNames.components), "utf8");
  const firstCatalogArtifact = JSON.parse(firstCatalogBytes) as {
    artifact: string;
    stats: {
      docsOnlyTiers: string[];
      entryCount: number;
      familyCount: number;
    };
  };
  const firstTokensArtifact = JSON.parse(firstTokensBytes) as {
    $extensions: {
      [STORYBOOK_PUBLIC_EXTENSION_KEY]: {
        stats: {
          tokenCount: number;
          errorCount: number;
        };
      };
    };
    theme: {
      default: {
        color: {
          primary: {
            main: {
              $type: string;
            };
          };
        };
        spacing: {
          base: {
            $type: string;
          };
        };
      };
    };
  };
  const firstThemesArtifact = JSON.parse(firstThemesBytes) as {
    modifiers: {
      theme: {
        default: string;
        contexts: Record<string, Array<{ $ref: string }>>;
      };
    };
    sets: Record<string, { sources: Array<{ $ref: string }> }>;
  };
  const firstComponentsArtifact = JSON.parse(firstComponentsBytes) as {
    stats: {
      componentCount: number;
      componentWithDesignReferenceCount: number;
      propKeyCount: number;
    };
    components: Array<{
      title: string;
      propKeys: string[];
    }>;
  };

  assert.equal(firstSummary.outputDir, outputDirPath);
  assert.equal(firstSummary.catalogPath, path.join(buildDir, catalogFileName));
  assert.equal(firstSummary.catalogEntryCount, 2);
  assert.equal(firstSummary.catalogFamilyCount, 2);
  assert.deepEqual(firstSummary.writtenFiles, {
    tokens: path.join(outputDirPath, fileNames.tokens),
    themes: path.join(outputDirPath, fileNames.themes),
    components: path.join(outputDirPath, fileNames.components)
  });
  assert.ok(firstSummary.tokenCount >= 8);
  assert.equal(firstSummary.themeCount, 1);
  assert.equal(firstSummary.componentCount, 1);
  assert.equal(firstCatalogArtifact.artifact, "storybook.catalog");
  assert.equal(firstCatalogArtifact.stats.entryCount, 2);
  assert.equal(firstCatalogArtifact.stats.familyCount, 2);
  assert.deepEqual(firstCatalogArtifact.stats.docsOnlyTiers, ["Base"]);

  assert.equal(
    firstTokensArtifact.$extensions[STORYBOOK_PUBLIC_EXTENSION_KEY].stats.errorCount,
    0
  );
  assert.ok(firstTokensArtifact.$extensions[STORYBOOK_PUBLIC_EXTENSION_KEY].stats.tokenCount >= 8);
  assert.equal(firstTokensArtifact.theme.default.color.primary.main.$type, "color");
  assert.equal(firstTokensArtifact.theme.default.spacing.base.$type, "dimension");
  assert.equal(firstThemesArtifact.modifiers.theme.default, "default");
  assert.deepEqual(firstThemesArtifact.modifiers.theme.contexts.default, [{ $ref: "#/sets/default" }]);
  assert.deepEqual(firstThemesArtifact.sets.default, {
    sources: [{ $ref: "./tokens.json#/theme/default" }]
  });
  assert.equal(firstComponentsArtifact.stats.componentCount, 1);
  assert.equal(firstComponentsArtifact.stats.componentWithDesignReferenceCount, 1);
  assert.equal(firstComponentsArtifact.stats.propKeyCount, 2);
  assert.equal(firstComponentsArtifact.components[0]?.title, "ReactUI/Core/Tooltip");
  assert.deepEqual(firstComponentsArtifact.components[0]?.propKeys, ["infos", "title"]);

  const secondSummary = await runGenerator();
  const secondCatalogBytes = await readFile(path.join(buildDir, catalogFileName), "utf8");
  const secondTokensBytes = await readFile(path.join(outputDirPath, fileNames.tokens), "utf8");
  const secondThemesBytes = await readFile(path.join(outputDirPath, fileNames.themes), "utf8");
  const secondComponentsBytes = await readFile(path.join(outputDirPath, fileNames.components), "utf8");

  assert.deepEqual(secondSummary, firstSummary);
  assert.equal(secondCatalogBytes, firstCatalogBytes);
  assert.equal(secondTokensBytes, firstTokensBytes);
  assert.equal(secondThemesBytes, firstThemesBytes);
  assert.equal(secondComponentsBytes, firstComponentsBytes);
  assert.equal(firstCatalogBytes.includes("bundlePath"), false);
  assert.equal(firstCatalogBytes.includes("iframeBundlePath"), false);
  assert.equal(firstCatalogBytes.includes("buildRoot"), false);
  assert.equal(firstTokensBytes.includes("bundlePath"), false);
  assert.equal(firstTokensBytes.includes("importPath"), false);
  assert.equal(firstTokensBytes.includes("iframeBundlePath"), false);
  assert.equal(firstTokensBytes.includes("buildRoot"), false);
  assert.equal(firstTokensBytes.includes("static/assets/images"), false);
  assert.equal(firstThemesBytes.includes("bundlePath"), false);
  assert.equal(firstComponentsBytes.includes("importPath"), false);
});

test(
  "storybook public artifact integration: local customer build smoke test stays sanitized",
  {
    skip: process.env.CI === "true"
  },
  async (context) => {
    const localBuildDir = path.resolve(process.cwd(), "storybook-static", "storybook-static");
    try {
      await access(path.join(localBuildDir, "index.json"));
    } catch {
      context.skip("Local Storybook build is not available in this worktree.");
      return;
    }

    const generatorEntrypoint = path.resolve(process.cwd(), "src", "storybook", "generate-artifact.ts");
    const outputDirPath = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-local-smoke-"));
    const fileNames = getStorybookPublicArtifactFileNames();
    const catalogFileName = getStorybookCatalogOutputFileName();
    const { stdout, stderr } = await execFile(
      "pnpm",
      ["exec", "tsx", generatorEntrypoint, localBuildDir, outputDirPath],
      {
        cwd: process.cwd()
      }
    );

    assert.equal(stderr, "");
    const summary = JSON.parse(stdout) as {
      catalogEntryCount: number;
      catalogFamilyCount: number;
      catalogPath: string;
      tokenCount: number;
      themeCount: number;
      componentCount: number;
    };
    const catalogBytes = await readFile(path.join(localBuildDir, catalogFileName), "utf8");
    const catalogArtifact = JSON.parse(catalogBytes) as {
      stats: {
        docsOnlyTiers: string[];
        entryCount: number;
      };
    };
    const tokensBytes = await readFile(path.join(outputDirPath, fileNames.tokens), "utf8");
    const themesBytes = await readFile(path.join(outputDirPath, fileNames.themes), "utf8");
    const componentsBytes = await readFile(path.join(outputDirPath, fileNames.components), "utf8");

    assert.equal(summary.catalogPath, path.join(localBuildDir, catalogFileName));
    assert.equal(summary.catalogEntryCount, 499);
    assert.ok(summary.catalogFamilyCount > 0);
    assert.ok(summary.tokenCount > 0);
    assert.ok(summary.themeCount > 0);
    assert.ok(summary.componentCount > 0);
    assert.equal(catalogArtifact.stats.entryCount, 499);
    assert.ok(catalogArtifact.stats.docsOnlyTiers.includes("IF-Components"));
    assert.ok(catalogArtifact.stats.docsOnlyTiers.includes("OSPlus_neo-Components"));
    assert.equal(catalogBytes.includes("bundlePath"), false);
    assert.equal(catalogBytes.includes("iframeBundlePath"), false);
    assert.equal(catalogBytes.includes("buildRoot"), false);
    assert.equal(tokensBytes.includes("bundlePath"), false);
    assert.equal(tokensBytes.includes("importPath"), false);
    assert.equal(tokensBytes.includes("buildRoot"), false);
    assert.equal(tokensBytes.includes("iframeBundlePath"), false);
    assert.equal(tokensBytes.includes("static/assets/images"), false);
    assert.equal(tokensBytes.includes("data:application/font"), false);
    assert.equal(themesBytes.includes("bundlePath"), false);
    assert.equal(componentsBytes.includes("importPath"), false);
  }
);
