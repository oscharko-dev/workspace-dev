import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { getStorybookEvidenceOutputFileName } from "../src/storybook/evidence.js";

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
    const appTheme = createTheme({ palette: { primary: { main: "#ff0000" } } });
    export const Wrapped = () => jsx(ThemeProvider, { theme: appTheme, children: jsx(App, {}) });
  `;

  const cssText = `
    :root {
      --fi-color-brand: #ff0000;
      --fi-color-surface: #ffffff;
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
  const artifactPath = path.join(buildDir, getStorybookEvidenceOutputFileName());

  const runGenerator = async (): Promise<{
    outputPath: string;
    evidenceCount: number;
    entryCount: number;
  }> => {
    const { stdout, stderr } = await execFile("pnpm", ["exec", "tsx", generatorEntrypoint, buildDir], {
      cwd: process.cwd()
    });

    assert.equal(stderr, "");
    return JSON.parse(stdout) as {
      outputPath: string;
      evidenceCount: number;
      entryCount: number;
    };
  };

  const firstSummary = await runGenerator();
  const firstBytes = await readFile(artifactPath, "utf8");
  const firstArtifact = JSON.parse(firstBytes) as {
    stats: {
      entryCount: number;
      byType: Record<string, number>;
    };
    evidence: Array<{
      type: string;
      reliability: string;
      usage: {
        canDriveTokens: boolean;
        canDriveProps: boolean;
        canDriveImports: boolean;
        canDriveStyling: boolean;
      };
    }>;
  };

  assert.equal(firstSummary.outputPath, artifactPath);
  assert.equal(firstSummary.entryCount, 2);
  assert.equal(firstArtifact.stats.entryCount, 2);
  assert.equal(firstArtifact.stats.byType.story_componentPath, 1);
  assert.equal(firstArtifact.stats.byType.story_argTypes, 1);
  assert.equal(firstArtifact.stats.byType.story_args, 1);
  assert.equal(firstArtifact.stats.byType.story_design_link, 1);
  assert.equal(firstArtifact.stats.byType.theme_bundle, 1);
  assert.equal(firstArtifact.stats.byType.css, 1);
  assert.equal(firstArtifact.stats.byType.mdx_link, 2);
  assert.equal(firstArtifact.stats.byType.docs_image, 1);
  assert.ok(firstArtifact.stats.byType.docs_text > 0);

  for (const evidenceItem of firstArtifact.evidence.filter((item) => item.type === "docs_image")) {
    assert.equal(evidenceItem.reliability, "reference_only");
    assert.equal(evidenceItem.usage.canDriveTokens, false);
    assert.equal(evidenceItem.usage.canDriveProps, false);
    assert.equal(evidenceItem.usage.canDriveImports, false);
    assert.equal(evidenceItem.usage.canDriveStyling, false);
  }

  const secondSummary = await runGenerator();
  const secondBytes = await readFile(artifactPath, "utf8");

  assert.deepEqual(secondSummary, firstSummary);
  assert.equal(secondBytes, firstBytes);
});
