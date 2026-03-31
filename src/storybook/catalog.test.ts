import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildStorybookCatalogArtifact,
  getStorybookCatalogOutputFileName,
  writeStorybookCatalogArtifact
} from "./catalog.js";

const createCatalogFixtureBuild = async (): Promise<string> => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-catalog-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const indexJson = {
    v: 5,
    entries: {
      "reactui-tooltip--docs": {
        id: "reactui-tooltip--docs",
        title: "ReactUI/Core/Tooltip",
        name: "Docs",
        importPath: "./docs/reactui/Tooltip/Tooltip.mdx",
        storiesImports: ["./src/core/Tooltip/stories/Tooltip.stories.tsx"],
        type: "docs",
        tags: ["dev", "test", "attached-mdx"]
      },
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
      "components-button--default": {
        id: "components-button--default",
        title: "Components/Inputs/Button",
        name: "Default",
        importPath: "./docs/material-ui/Button/Button.stories.tsx",
        storiesImports: [],
        type: "story",
        tags: ["dev", "test"],
        componentPath: "@mui/material"
      },
      "if-components-button--docs": {
        id: "if-components-button--docs",
        title: "IF-Components/Button",
        name: "Docs",
        importPath: "./docs/if-components/Button.mdx",
        storiesImports: [],
        type: "docs",
        tags: ["dev", "test", "unattached-mdx"]
      },
      "osplus-neo-components-dialog--docs": {
        id: "osplus-neo-components-dialog--docs",
        title: "OSPlus_neo-Components/Dialog",
        name: "Docs",
        importPath: "./docs/osplus/Dialog.mdx",
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
      "./docs/if-components/Button.mdx": n(() => c0(() => import("./if-button-docs.js"), true ? __vite__mapDeps([1]) : void 0, import.meta.url), "./docs/if-components/Button.mdx"),
      "./docs/material-ui/Button/Button.stories.tsx": n(() => c0(() => import("./button-stories.js"), true ? __vite__mapDeps([2]) : void 0, import.meta.url), "./docs/material-ui/Button/Button.stories.tsx"),
      "./docs/osplus/Dialog.mdx": n(() => c0(() => import("./osplus-dialog-docs.js"), true ? __vite__mapDeps([3]) : void 0, import.meta.url), "./docs/osplus/Dialog.mdx"),
      "./docs/reactui/Tooltip/Tooltip.mdx": n(() => c0(() => import("./tooltip-docs.js"), true ? __vite__mapDeps([4]) : void 0, import.meta.url), "./docs/reactui/Tooltip/Tooltip.mdx"),
      "./src/core/Tooltip/stories/Tooltip.stories.tsx": n(() => c0(() => import("./tooltip-stories.js"), true ? __vite__mapDeps([5]) : void 0, import.meta.url), "./src/core/Tooltip/stories/Tooltip.stories.tsx")
    };
  `;

  const tooltipStoryBundle = `
    const unresolvedValue = getRuntimeValue();
    const controlType = "select";
    const meta = {
      title: "ReactUI/Core/Tooltip",
      args: {
        title: "Einfach",
        infos: "Ohne Infos",
        dynamicValue: unresolvedValue
      },
      argTypes: {
        title: { control: { type: controlType }, description: "Tooltip title" },
        infos: { control: { type: "text" } },
        onOpen: { action: "opened", mapping: unresolvedValue }
      },
      parameters: {
        design: {
          type: "figma",
          url: "https://www.figma.com/design/demo-tooltip"
        }
      }
    };
  `;

  const buttonStoryBundle = `
    const meta = {
      title: "Components/Inputs/Button",
      args: { variant: "primary" },
      argTypes: {
        variant: { control: { type: "radio" } }
      }
    };
  `;

  const tooltipDocsBundle = `
    function content() {
      return e.jsxs(e.Fragment, {
        children: [
          e.jsxs("p", {
            children: [
              "Verwandte Doku unter ",
              e.jsx("a", { href: "/docs/if-components-button--docs", children: "IF Button" }),
              " sowie ",
              e.jsx("a", { href: "https://example.com/design", children: "extern" })
            ]
          }),
          e.jsx("img", { src: "static/assets/images/Tooltip.png", alt: "Tooltip" }),
          e.jsx("p", { children: "Tooltip Hinweise" })
        ]
      });
    }
  `;

  const ifButtonDocsBundle = `
    function content() {
      return e.jsx("p", { children: "IF Button docs" });
    }
  `;

  const osplusDialogDocsBundle = `
    function content() {
      return e.jsx("p", { children: "OSPlus Dialog docs" });
    }
  `;

  const themeBundle = `
    const theme = createTheme({
      palette: { primary: { main: "#ff0000" } },
      spacing: 8
    });
    export const Wrapped = () => jsx(ThemeProvider, { theme, children: jsx(App, {}) });
  `;

  const cssText = `
    :root {
      --fi-space-base: 8px;
    }
  `;

  await writeFile(path.join(buildDir, "index.json"), `${JSON.stringify(indexJson, null, 2)}\n`, "utf8");
  await writeFile(path.join(buildDir, "iframe.html"), iframeHtml, "utf8");
  await writeFile(path.join(assetsDir, "iframe-test.js"), iframeBundle, "utf8");
  await writeFile(path.join(assetsDir, "tooltip-stories.js"), tooltipStoryBundle, "utf8");
  await writeFile(path.join(assetsDir, "button-stories.js"), buttonStoryBundle, "utf8");
  await writeFile(path.join(assetsDir, "tooltip-docs.js"), tooltipDocsBundle, "utf8");
  await writeFile(path.join(assetsDir, "if-button-docs.js"), ifButtonDocsBundle, "utf8");
  await writeFile(path.join(assetsDir, "osplus-dialog-docs.js"), osplusDialogDocsBundle, "utf8");
  await writeFile(path.join(assetsDir, "shared-theme.js"), themeBundle, "utf8");
  await writeFile(path.join(assetsDir, "iframe-test.css"), cssText, "utf8");

  return buildDir;
};

test("buildStorybookCatalogArtifact captures normalized entries, families, and docs-only tiers deterministically", async () => {
  const buildDir = await createCatalogFixtureBuild();

  const firstArtifact = await buildStorybookCatalogArtifact({ buildDir });
  const secondArtifact = await buildStorybookCatalogArtifact({ buildDir });

  assert.deepEqual(firstArtifact, secondArtifact);
  assert.equal(firstArtifact.stats.entryCount, 5);
  assert.equal(firstArtifact.stats.familyCount, 4);
  assert.deepEqual(firstArtifact.stats.byEntryType, {
    docs: 3,
    story: 2
  });
  assert.deepEqual(firstArtifact.stats.byDocsAttachment, {
    attached: 1,
    not_applicable: 2,
    unattached: 2
  });
  assert.deepEqual(firstArtifact.stats.docsOnlyTiers, ["IF-Components", "OSPlus_neo-Components"]);
  assert.equal(firstArtifact.stats.byReferencedSignal.args, 2);
  assert.equal(firstArtifact.stats.byReferencedSignal.argTypes, 2);
  assert.equal(firstArtifact.stats.byReferencedSignal.css, 5);
  assert.equal(firstArtifact.stats.byReferencedSignal.themeBundles, 5);

  const tooltipStory = firstArtifact.entries.find((entry) => entry.id === "reactui-tooltip--default");
  assert.ok(tooltipStory);
  assert.equal(tooltipStory?.tier, "ReactUI");
  assert.equal(tooltipStory?.docsAttachment, "not_applicable");
  assert.equal(tooltipStory?.componentPath, "./src/core/Tooltip/Tooltip.tsx");
  assert.deepEqual(tooltipStory?.metadata.args, {
    infos: "Ohne Infos",
    title: "Einfach"
  });
  assert.deepEqual(tooltipStory?.metadata.argTypes, {
    infos: {
      control: {
        type: "text"
      }
    },
    onOpen: {
      action: "opened"
    },
    title: {
      control: {
        type: "select"
      },
      description: "Tooltip title"
    }
  });
  assert.deepEqual(tooltipStory?.metadata.designUrls, ["https://www.figma.com/design/demo-tooltip"]);
  assert.equal(tooltipStory?.signalReferences.componentPath.length, 1);
  assert.equal(tooltipStory?.signalReferences.args.length, 1);
  assert.equal(tooltipStory?.signalReferences.argTypes.length, 1);
  assert.equal(tooltipStory?.signalReferences.designLinks.length, 1);
  assert.equal(tooltipStory?.signalReferences.css.length, 1);
  assert.equal(tooltipStory?.signalReferences.themeBundles.length, 1);

  const tooltipDocs = firstArtifact.entries.find((entry) => entry.id === "reactui-tooltip--docs");
  assert.ok(tooltipDocs);
  assert.equal(tooltipDocs?.docsAttachment, "attached");
  assert.deepEqual(tooltipDocs?.metadata.mdxLinks.external, ["https://example.com/design"]);
  assert.equal(tooltipDocs?.metadata.mdxLinks.internal.length, 1);
  assert.equal(tooltipDocs?.metadata.mdxLinks.internal[0]?.path, "/docs/if-components-button--docs");
  assert.equal(tooltipDocs?.metadata.mdxLinks.internal[0]?.entryId, "if-components-button--docs");
  assert.equal(tooltipDocs?.metadata.mdxLinks.internal[0]?.familyTitle, "IF-Components/Button");

  const ifButtonDocs = firstArtifact.entries.find((entry) => entry.id === "if-components-button--docs");
  assert.ok(ifButtonDocs);
  assert.equal(ifButtonDocs?.isDocsOnlyTier, true);
  assert.equal(ifButtonDocs?.docsAttachment, "unattached");

  const buttonFamily = firstArtifact.families.find((family) => family.title === "Components/Inputs/Button");
  assert.ok(buttonFamily);
  assert.equal(buttonFamily?.componentPath, "@mui/material");
  assert.equal(buttonFamily?.storyCount, 1);
  assert.deepEqual(buttonFamily?.propKeys, ["variant"]);

  const tooltipFamily = firstArtifact.families.find((family) => family.title === "ReactUI/Core/Tooltip");
  assert.ok(tooltipFamily);
  assert.equal(tooltipFamily?.hasDesignReference, true);
  assert.deepEqual(tooltipFamily?.metadata.designUrls, ["https://www.figma.com/design/demo-tooltip"]);
  assert.deepEqual(tooltipFamily?.metadata.mdxLinks.external, ["https://example.com/design"]);
  assert.equal(tooltipFamily?.metadata.mdxLinks.internal[0]?.entryId, "if-components-button--docs");
});

test("writeStorybookCatalogArtifact emits stable JSON into the build directory by default", async () => {
  const buildDir = await createCatalogFixtureBuild();
  const artifact = await buildStorybookCatalogArtifact({ buildDir });

  const firstOutputPath = await writeStorybookCatalogArtifact({
    buildDir,
    artifact
  });
  const firstBytes = await readFile(firstOutputPath, "utf8");
  const secondOutputPath = await writeStorybookCatalogArtifact({
    buildDir,
    artifact
  });
  const secondBytes = await readFile(secondOutputPath, "utf8");

  assert.equal(firstOutputPath, path.join(buildDir, getStorybookCatalogOutputFileName()));
  assert.equal(secondOutputPath, firstOutputPath);
  assert.equal(firstBytes, secondBytes);
  assert.ok(firstBytes.includes("\"artifact\": \"storybook.catalog\""));
});
