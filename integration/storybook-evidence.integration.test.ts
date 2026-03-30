import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { getStorybookPublicArtifactFileNames } from "../src/storybook/public-extracts.js";

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
    const appTheme = createTheme({ palette: { primary: { main: "#ff0000" } } });
    export const Wrapped = () => jsx(ThemeProvider, { theme: appTheme, children: jsx(App, {}) });
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
    const appTheme = createTheme({ palette: { primary: { main: "#ff0000" } } });
    export const Wrapped = () => jsx(ThemeProvider, { theme: appTheme, children: jsx(App, {}) });
  `;

  const cssText = `
    :root {
      --fi-color-brand: #ff0000;
      --fi-color-surface: #ffffff;
      --fi-space-md: 16px;
      --fi-font-body: "Inter", sans-serif;
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

test("storybook evidence integration: CLI generates deterministic evidence from a synthetic build", async () => {
  const buildDir = await createIntegrationStorybookBuild();
  const generatorEntrypoint = path.resolve(process.cwd(), "src", "storybook", "generate-artifact.ts");
  const outputDirPath = path.join(buildDir, "reference-output");
  const fileNames = getStorybookPublicArtifactFileNames();

  const runGenerator = async (): Promise<{
    outputDir: string;
    writtenFiles: {
      tokens: string;
      themes: string;
      components: string;
    };
    entryCount: number;
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
      outputDir: string;
      writtenFiles: {
        tokens: string;
        themes: string;
        components: string;
      };
      entryCount: number;
      tokenCount: number;
      themeCount: number;
      componentCount: number;
    };
  };

  const firstSummary = await runGenerator();
  const firstTokensBytes = await readFile(firstSummary.writtenFiles.tokens, "utf8");
  const firstThemesBytes = await readFile(firstSummary.writtenFiles.themes, "utf8");
  const firstComponentsBytes = await readFile(firstSummary.writtenFiles.components, "utf8");
  const firstTokensArtifact = JSON.parse(firstTokensBytes) as {
    stats: {
      entryCount: number;
      tokenCount: number;
      byCategory: Record<string, number>;
    };
    tokens: Array<{
      id: string;
      name: string;
      category: string;
      values: string[];
    }>;
  };
  const firstThemesArtifact = JSON.parse(firstThemesBytes) as {
    stats: {
      entryCount: number;
      themeCount: number;
      markerCount: number;
      componentLinkedThemeCount: number;
    };
    themes: Array<{
      markers: string[];
      occurrenceCount: number;
      componentTitles: string[];
    }>;
  };
  const firstComponentsArtifact = JSON.parse(firstComponentsBytes) as {
    stats: {
      entryCount: number;
      componentCount: number;
      componentWithDesignReferenceCount: number;
      propKeyCount: number;
    };
    components: Array<{
      id: string;
      name: string;
      title: string;
      componentPath?: string;
      propKeys: string[];
      storyCount: number;
      hasDesignReference: boolean;
    }>;
  };

  assert.equal(firstSummary.outputDir, outputDirPath);
  assert.equal(path.basename(firstSummary.writtenFiles.tokens), fileNames.tokens);
  assert.equal(path.basename(firstSummary.writtenFiles.themes), fileNames.themes);
  assert.equal(path.basename(firstSummary.writtenFiles.components), fileNames.components);
  assert.equal(firstSummary.entryCount, 2);
  assert.equal(firstSummary.tokenCount, 4);
  assert.equal(firstSummary.themeCount, 1);
  assert.equal(firstSummary.componentCount, 1);

  assert.equal(firstTokensArtifact.stats.entryCount, 2);
  assert.equal(firstTokensArtifact.stats.tokenCount, 4);
  assert.equal(firstTokensArtifact.stats.byCategory.color, 2);
  assert.equal(firstTokensArtifact.stats.byCategory.spacing, 1);
  assert.equal(firstTokensArtifact.stats.byCategory.font, 1);
  assert.deepEqual(firstTokensArtifact.tokens, [
    { name: "--fi-color-brand", category: "color", values: ["#ff0000"] },
    { name: "--fi-color-surface", category: "color", values: ["#ffffff"] },
    { name: "--fi-font-body", category: "font", values: ["\"Inter\", sans-serif"] },
    { name: "--fi-space-md", category: "spacing", values: ["16px"] }
  ].map((token) => ({
    ...token,
    id: firstTokensArtifact.tokens.find((current) => current.name === token.name)?.id ?? ""
  })));

  assert.equal(firstThemesArtifact.stats.entryCount, 2);
  assert.equal(firstThemesArtifact.stats.themeCount, 1);
  assert.equal(firstThemesArtifact.stats.markerCount, 2);
  assert.equal(firstThemesArtifact.stats.componentLinkedThemeCount, 1);
  assert.deepEqual(firstThemesArtifact.themes[0]?.markers, ["createTheme", "ThemeProvider"]);
  assert.equal(firstThemesArtifact.themes[0]?.occurrenceCount, 2);
  assert.deepEqual(firstThemesArtifact.themes[0]?.componentTitles, ["ReactUI/Core/Tooltip"]);

  assert.equal(firstComponentsArtifact.stats.entryCount, 2);
  assert.equal(firstComponentsArtifact.stats.componentCount, 1);
  assert.equal(firstComponentsArtifact.stats.componentWithDesignReferenceCount, 1);
  assert.equal(firstComponentsArtifact.stats.propKeyCount, 2);
  assert.deepEqual(firstComponentsArtifact.components, [
    {
      id: firstComponentsArtifact.components[0]?.id ?? "",
      title: "ReactUI/Core/Tooltip",
      componentPath: "./src/core/Tooltip/Tooltip.tsx",
      propKeys: ["infos", "title"],
      storyCount: 1,
      hasDesignReference: true,
      name: "Tooltip"
    }
  ]);

  const serializedPublicArtifacts = JSON.stringify({
    tokens: firstTokensArtifact,
    themes: firstThemesArtifact,
    components: firstComponentsArtifact
  });
  for (const forbiddenSnippet of [
    "\"docs_text\"",
    "\"docs_image\"",
    "\"mdx_link\"",
    "\"bundlePath\"",
    "\"importPath\"",
    "\"buildRoot\"",
    "\"iframeBundlePath\"",
    "https://www.figma.com/design/demo",
    "Tokens sind Farbnamen, denen HEX-Werte zugeordnet sind."
  ]) {
    assert.equal(serializedPublicArtifacts.includes(forbiddenSnippet), false);
  }

  const secondSummary = await runGenerator();
  const secondTokensBytes = await readFile(firstSummary.writtenFiles.tokens, "utf8");
  const secondThemesBytes = await readFile(firstSummary.writtenFiles.themes, "utf8");
  const secondComponentsBytes = await readFile(firstSummary.writtenFiles.components, "utf8");

  assert.deepEqual(secondSummary, firstSummary);
  assert.equal(secondTokensBytes, firstTokensBytes);
  assert.equal(secondThemesBytes, firstThemesBytes);
  assert.equal(secondComponentsBytes, firstComponentsBytes);
});
