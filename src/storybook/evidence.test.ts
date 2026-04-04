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

const createMiniStorybookBuild = async ({
  componentPath = "./src/core/Tooltip/Tooltip.tsx",
  internalDocsLink = "/docs/base-colors-sk-theme--docs"
}: {
  componentPath?: string;
  internalDocsLink?: string;
} = {}): Promise<string> => {
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
        componentPath
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
              e.jsx("a", { href: "${internalDocsLink}", children: "SK-Theme" }),
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

  const componentPath = firstArtifact.evidence.find((item) => item.type === "story_componentPath");
  assert.ok(componentPath);
  assert.equal(componentPath?.summary.componentPath, "src/core/Tooltip/Tooltip.tsx");

  const internalDocsLink = firstArtifact.evidence.find(
    (item) => item.type === "mdx_link" && item.summary.linkTarget?.startsWith("/docs/")
  );
  assert.ok(internalDocsLink);
  assert.equal(internalDocsLink?.summary.linkTarget, "/docs/base-colors-sk-theme--docs");
});

test("every evidence item is classified as authoritative or reference_only with no derived items", async () => {
  const buildDir = await createMiniStorybookBuild();
  const artifact = await buildStorybookEvidenceArtifact({ buildDir });

  for (const item of artifact.evidence) {
    assert.ok(
      item.reliability === "authoritative" || item.reliability === "reference_only",
      `Evidence item '${item.id}' has unexpected reliability '${item.reliability}'`
    );
  }

  assert.ok(artifact.stats.byReliability.authoritative > 0);
  assert.ok(artifact.stats.byReliability.reference_only > 0);
  assert.equal(artifact.stats.byReliability.derived, 0);
});

test("docs_image and docs_text never drive tokens, props, imports, or styling", async () => {
  const buildDir = await createMiniStorybookBuild();
  const artifact = await buildStorybookEvidenceArtifact({ buildDir });

  const referenceOnlyItems = artifact.evidence.filter(
    (item) => item.type === "docs_image" || item.type === "docs_text"
  );
  assert.ok(referenceOnlyItems.length > 0);

  for (const item of referenceOnlyItems) {
    assert.equal(item.reliability, "reference_only");
    assert.equal(item.usage.canDriveTokens, false, `${item.type} must not drive tokens`);
    assert.equal(item.usage.canDriveProps, false, `${item.type} must not drive props`);
    assert.equal(item.usage.canDriveImports, false, `${item.type} must not drive imports`);
    assert.equal(item.usage.canDriveStyling, false, `${item.type} must not drive styling`);
    assert.equal(item.usage.canProvideMatchHints, true, `${item.type} must provide match hints`);
  }
});

test("authoritative evidence types can drive their designated capabilities", async () => {
  const buildDir = await createMiniStorybookBuild();
  const artifact = await buildStorybookEvidenceArtifact({ buildDir });

  const componentPath = artifact.evidence.find((item) => item.type === "story_componentPath");
  assert.ok(componentPath);
  assert.equal(componentPath.reliability, "authoritative");
  assert.equal(componentPath.usage.canDriveImports, true);

  const argTypes = artifact.evidence.find((item) => item.type === "story_argTypes");
  assert.ok(argTypes);
  assert.equal(argTypes.reliability, "authoritative");
  assert.equal(argTypes.usage.canDriveTokens, true);
  assert.equal(argTypes.usage.canDriveProps, true);

  const themeBundle = artifact.evidence.find((item) => item.type === "theme_bundle");
  assert.ok(themeBundle);
  assert.equal(themeBundle.reliability, "authoritative");
  assert.equal(themeBundle.usage.canDriveTokens, true);
  assert.equal(themeBundle.usage.canDriveStyling, true);

  const css = artifact.evidence.find((item) => item.type === "css");
  assert.ok(css);
  assert.equal(css.reliability, "authoritative");
  assert.equal(css.usage.canDriveTokens, true);
  assert.equal(css.usage.canDriveStyling, true);
});

test("provider-only bundles do not become authoritative theme_bundle evidence", async () => {
  const buildDir = await createMiniStorybookBuild();
  await writeFile(
    path.join(buildDir, "assets", "provider-only.js"),
    `
      export const Wrapped = () => jsx(ThemeProvider, { theme: appTheme, children: jsx(App, {}) });
    `,
    "utf8"
  );

  const artifact = await buildStorybookEvidenceArtifact({ buildDir });
  assert.equal(artifact.stats.byType.theme_bundle, 1);
  assert.equal(
    artifact.evidence.some((item) => item.type === "theme_bundle" && item.source.bundlePath === "assets/provider-only.js"),
    false
  );
});

test("artifact stats match actual evidence counts by type and reliability", async () => {
  const buildDir = await createMiniStorybookBuild();
  const artifact = await buildStorybookEvidenceArtifact({ buildDir });

  let totalByType = 0;
  for (const count of Object.values(artifact.stats.byType)) {
    totalByType += count;
  }
  assert.equal(totalByType, artifact.stats.evidenceCount);

  let totalByReliability = 0;
  for (const count of Object.values(artifact.stats.byReliability)) {
    totalByReliability += count;
  }
  assert.equal(totalByReliability, artifact.stats.evidenceCount);
  assert.equal(artifact.evidence.length, artifact.stats.evidenceCount);
});

test("evidence IDs are unique and stable across builds", async () => {
  const buildDir = await createMiniStorybookBuild();
  const firstArtifact = await buildStorybookEvidenceArtifact({ buildDir });
  const secondArtifact = await buildStorybookEvidenceArtifact({ buildDir });

  const firstIds = firstArtifact.evidence.map((item) => item.id);
  const uniqueIds = new Set(firstIds);
  assert.equal(uniqueIds.size, firstIds.length, "Evidence IDs must be unique");

  const secondIds = secondArtifact.evidence.map((item) => item.id);
  assert.deepEqual(firstIds, secondIds, "Evidence IDs must be stable across builds");
});

test("evidence IDs stay canonical across equivalent componentPath and internal docs link variants", async () => {
  const windowsBuildDir = await createMiniStorybookBuild({
    componentPath: ".\\src\\core\\Tooltip\\Tooltip.tsx",
    internalDocsLink: "/docs/base-colors-sk-theme--docs?viewMode=docs#tokens"
  });
  const posixBuildDir = await createMiniStorybookBuild({
    componentPath: "./src/core/Tooltip/Tooltip.tsx",
    internalDocsLink: "/docs/base-colors-sk-theme--docs"
  });

  const windowsArtifact = await buildStorybookEvidenceArtifact({ buildDir: windowsBuildDir });
  const posixArtifact = await buildStorybookEvidenceArtifact({ buildDir: posixBuildDir });

  const { buildRoot: _windowsBuildRoot, ...windowsComparable } = windowsArtifact;
  const { buildRoot: _posixBuildRoot, ...posixComparable } = posixArtifact;

  assert.deepEqual(windowsComparable, posixComparable);
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

test("writeStorybookEvidenceArtifact supports explicit output paths outside the Storybook build directory", async () => {
  const buildDir = await createMiniStorybookBuild();
  const artifact = await buildStorybookEvidenceArtifact({ buildDir });
  const outputFilePath = path.join(buildDir, "artifacts", "storybook", getStorybookEvidenceOutputFileName());

  const writtenPath = await writeStorybookEvidenceArtifact({
    buildDir,
    artifact,
    outputFilePath
  });
  const writtenBytes = await readFile(writtenPath, "utf8");

  assert.equal(writtenPath, outputFilePath);
  assert.ok(writtenBytes.includes("\"artifact\": \"storybook.evidence\""));
});
