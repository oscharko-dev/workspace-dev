import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildStorybookEvidenceArtifact,
  getStorybookEvidenceOutputFileName,
  writeStorybookEvidenceArtifact
} from "./evidence.js";

const createMiniStorybookBuild = async (): Promise<string> => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-evidence-"));
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
  await writeFile(path.join(assetsDir, "iframe-test.css"), cssText, "utf8");

  return buildDir;
};

test("buildStorybookEvidenceArtifact assigns reliability and usage gates deterministically", async () => {
  const buildDir = await createMiniStorybookBuild();

  const firstArtifact = await buildStorybookEvidenceArtifact({ buildDir });
  const secondArtifact = await buildStorybookEvidenceArtifact({ buildDir });

  assert.deepEqual(firstArtifact, secondArtifact);
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

  const docsImage = firstArtifact.evidence.find((item) => item.type === "docs_image");
  assert.ok(docsImage);
  assert.equal(docsImage?.reliability, "reference_only");
  assert.equal(docsImage?.usage.canDriveTokens, false);
  assert.equal(docsImage?.usage.canDriveProps, false);
  assert.equal(docsImage?.usage.canDriveImports, false);
  assert.equal(docsImage?.usage.canDriveStyling, false);
  assert.equal(docsImage?.usage.canProvideMatchHints, true);
});

test("writeStorybookEvidenceArtifact emits byte-identical JSON across repeated writes", async () => {
  const buildDir = await createMiniStorybookBuild();
  const artifact = await buildStorybookEvidenceArtifact({ buildDir });

  const firstOutputPath = await writeStorybookEvidenceArtifact({ buildDir, artifact });
  const firstBytes = await readFile(firstOutputPath, "utf8");
  const secondOutputPath = await writeStorybookEvidenceArtifact({ buildDir, artifact });
  const secondBytes = await readFile(secondOutputPath, "utf8");

  assert.equal(firstOutputPath, path.join(buildDir, getStorybookEvidenceOutputFileName()));
  assert.equal(secondOutputPath, firstOutputPath);
  assert.equal(firstBytes, secondBytes);
});
