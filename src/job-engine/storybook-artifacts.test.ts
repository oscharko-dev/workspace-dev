import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StageArtifactStore } from "./pipeline/artifact-store.js";
import { STAGE_ARTIFACT_KEYS } from "./pipeline/artifact-keys.js";
import { resolveRuntimeSettings } from "./runtime.js";
import {
  createJobStorybookArtifactPaths,
  generateStorybookArtifactsForJob,
  resolveStorybookStaticDir,
  reuseStorybookArtifactsFromSourceJob
} from "./storybook-artifacts.js";
import { STORYBOOK_PUBLIC_EXTENSION_KEY } from "../storybook/types.js";

const createSyntheticStorybookBuild = async (): Promise<string> => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-artifacts-"));
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

const createInvalidStorybookBuild = async (): Promise<string> => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-artifacts-invalid-"));
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
      "./src/core/Tooltip/stories/Tooltip.stories.tsx": n(() => c0(() => import("./Tooltip.stories-test.js"), true ? __vite__mapDeps([1]) : void 0, import.meta.url), "./src/core/Tooltip/stories/Tooltip.stories.tsx")
    };
  `;

  const storyBundle = `
    const meta = {
      title: "ReactUI/Core/Tooltip"
    };
  `;

  const incompleteThemeBundle = `
    const appTheme = createTheme({
      palette: {
        primary: { main: "#ff0000", contrastText: "#ffffff" },
        text: { primary: "#444444" }
      }
    });
    export const Wrapped = () => jsx(ThemeProvider, { theme: appTheme, children: jsx(App, {}) });
  `;

  await writeFile(path.join(buildDir, "index.json"), `${JSON.stringify(indexJson, null, 2)}\n`, "utf8");
  await writeFile(path.join(buildDir, "iframe.html"), iframeHtml, "utf8");
  await writeFile(path.join(assetsDir, "iframe-test.js"), iframeBundle, "utf8");
  await writeFile(path.join(assetsDir, "Tooltip.stories-test.js"), storyBundle, "utf8");
  await writeFile(path.join(assetsDir, "shared-theme.js"), incompleteThemeBundle, "utf8");

  return buildDir;
};

test("generateStorybookArtifactsForJob writes deterministic internal and public outputs", async () => {
  const buildDir = await createSyntheticStorybookBuild();
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-job-"));
  const jobDir = path.join(root, "jobs", "job-1");
  await mkdir(jobDir, { recursive: true });
  const artifactStore = new StageArtifactStore({ jobDir });
  const runtime = resolveRuntimeSettings({ enablePreview: false });

  const storybookArtifacts = await generateStorybookArtifactsForJob({
    storybookStaticDir: buildDir,
    jobDir,
    artifactStore,
    stage: "ir.derive",
    limits: runtime.pipelineDiagnosticLimits
  });

  const expectedPaths = createJobStorybookArtifactPaths({ jobDir });
  assert.deepEqual(storybookArtifacts.paths, expectedPaths);
  assert.equal(storybookArtifacts.catalogArtifact.artifact, "storybook.catalog");
  assert.equal(storybookArtifacts.evidenceArtifact.artifact, "storybook.evidence");
  assert.equal(await artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookCatalog), expectedPaths.catalogFile);
  assert.equal(await artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookEvidence), expectedPaths.evidenceFile);
  assert.equal(await artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookTokens), expectedPaths.tokensFile);
  assert.equal(await artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookThemes), expectedPaths.themesFile);
  assert.equal(await artifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookComponents), expectedPaths.componentsFile);

  const tokensArtifact = JSON.parse(await readFile(expectedPaths.tokensFile, "utf8")) as {
    $extensions?: Record<string, { artifact?: string }>;
  };
  const componentsArtifact = JSON.parse(await readFile(expectedPaths.componentsFile, "utf8")) as {
    artifact?: string;
    stats?: { componentCount?: number };
  };
  assert.equal(tokensArtifact.$extensions?.[STORYBOOK_PUBLIC_EXTENSION_KEY]?.artifact, "storybook.tokens");
  assert.equal(componentsArtifact.artifact, "storybook.components");
  assert.equal((componentsArtifact.stats?.componentCount ?? 0) > 0, true);
});

test("resolveStorybookStaticDir rejects traversal outside the workspace root", () => {
  const runtime = resolveRuntimeSettings({ enablePreview: false });
  const workspaceRoot = path.join(os.tmpdir(), "workspace-dev-storybook-root");

  assert.throws(
    () =>
      resolveStorybookStaticDir({
        storybookStaticDir: "../outside/storybook-static",
        resolvedWorkspaceRoot: workspaceRoot,
        limits: runtime.pipelineDiagnosticLimits
      }),
    /resolves outside the workspace root/
  );
});

test("generateStorybookArtifactsForJob fails when the Storybook build is incomplete", async () => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-incomplete-"));
  const jobDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-incomplete-job-"));
  const artifactStore = new StageArtifactStore({ jobDir });
  const runtime = resolveRuntimeSettings({ enablePreview: false });

  await assert.rejects(
    () =>
      generateStorybookArtifactsForJob({
        storybookStaticDir: buildDir,
        jobDir,
        artifactStore,
        stage: "ir.derive",
        limits: runtime.pipelineDiagnosticLimits
      }),
    /index\.json/
  );
});

test("generateStorybookArtifactsForJob fails with E_STORYBOOK_TOKEN_EXTRACTION_INVALID when fatal extraction diagnostics are present", async () => {
  const buildDir = await createInvalidStorybookBuild();
  const jobDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-invalid-job-"));
  const artifactStore = new StageArtifactStore({ jobDir });
  const runtime = resolveRuntimeSettings({ enablePreview: false });

  await assert.rejects(
    () =>
      generateStorybookArtifactsForJob({
        storybookStaticDir: buildDir,
        jobDir,
        artifactStore,
        stage: "ir.derive",
        limits: runtime.pipelineDiagnosticLimits
      }),
    (error: unknown) => {
      assert.equal(typeof error, "object");
      assert.equal((error as { code?: string }).code, "E_STORYBOOK_TOKEN_EXTRACTION_INVALID");
      assert.equal(
        Array.isArray((error as { diagnostics?: unknown[] }).diagnostics) &&
          ((error as { diagnostics?: unknown[] }).diagnostics?.length ?? 0) > 0,
        true
      );
      return true;
    }
  );
});

test("reuseStorybookArtifactsFromSourceJob copies all required artifacts and registers them in the target store", async () => {
  const buildDir = await createSyntheticStorybookBuild();
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-reuse-"));

  const sourceJobDir = path.join(root, "jobs", "source-job");
  await mkdir(sourceJobDir, { recursive: true });
  const sourceArtifactStore = new StageArtifactStore({ jobDir: sourceJobDir });

  await generateStorybookArtifactsForJob({
    storybookStaticDir: buildDir,
    jobDir: sourceJobDir,
    artifactStore: sourceArtifactStore,
    stage: "ir.derive",
    limits: resolveRuntimeSettings({ enablePreview: false }).pipelineDiagnosticLimits
  });

  const targetJobDir = path.join(root, "jobs", "target-job");
  await mkdir(targetJobDir, { recursive: true });
  const targetArtifactStore = new StageArtifactStore({ jobDir: targetJobDir });

  const targetPaths = await reuseStorybookArtifactsFromSourceJob({
    sourceArtifactStore,
    targetArtifactStore,
    sourceJobId: "source-job",
    sourceRequestedStorybookStaticDir: buildDir,
    targetJobDir,
    stage: "ir.derive"
  });

  const expectedTargetPaths = createJobStorybookArtifactPaths({ jobDir: targetJobDir });
  assert.deepEqual(targetPaths, expectedTargetPaths);

  assert.equal(await targetArtifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookCatalog), expectedTargetPaths.catalogFile);
  assert.equal(await targetArtifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookEvidence), expectedTargetPaths.evidenceFile);
  assert.equal(await targetArtifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookTokens), expectedTargetPaths.tokensFile);
  assert.equal(await targetArtifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookThemes), expectedTargetPaths.themesFile);
  assert.equal(await targetArtifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookComponents), expectedTargetPaths.componentsFile);

  const sourceTokens = await readFile(
    (await sourceArtifactStore.getPath(STAGE_ARTIFACT_KEYS.storybookTokens)) as string,
    "utf8"
  );
  const targetTokens = await readFile(expectedTargetPaths.tokensFile, "utf8");
  assert.equal(targetTokens, sourceTokens, "Reused token artifact should be byte-identical to source");
});

test("reuseStorybookArtifactsFromSourceJob throws when a required artifact is missing in the source store", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-reuse-missing-"));

  const sourceJobDir = path.join(root, "jobs", "source-job");
  await mkdir(sourceJobDir, { recursive: true });
  const sourceArtifactStore = new StageArtifactStore({ jobDir: sourceJobDir });

  const targetJobDir = path.join(root, "jobs", "target-job");
  await mkdir(targetJobDir, { recursive: true });
  const targetArtifactStore = new StageArtifactStore({ jobDir: targetJobDir });

  await assert.rejects(
    () =>
      reuseStorybookArtifactsFromSourceJob({
        sourceArtifactStore,
        targetArtifactStore,
        sourceJobId: "source-job",
        sourceRequestedStorybookStaticDir: "/fake/storybook-static",
        targetJobDir,
        stage: "ir.derive"
      }),
    /is missing/
  );
});

test("reuseStorybookArtifactsFromSourceJob skips optional artifacts without error when absent", async () => {
  const buildDir = await createSyntheticStorybookBuild();
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-reuse-opt-"));

  const sourceJobDir = path.join(root, "jobs", "source-job");
  await mkdir(sourceJobDir, { recursive: true });
  const sourceArtifactStore = new StageArtifactStore({ jobDir: sourceJobDir });

  await generateStorybookArtifactsForJob({
    storybookStaticDir: buildDir,
    jobDir: sourceJobDir,
    artifactStore: sourceArtifactStore,
    stage: "ir.derive",
    limits: resolveRuntimeSettings({ enablePreview: false }).pipelineDiagnosticLimits
  });

  assert.equal(
    await sourceArtifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaLibraryResolution),
    undefined,
    "Optional artifact figmaLibraryResolution should not be in source"
  );
  assert.equal(
    await sourceArtifactStore.getPath(STAGE_ARTIFACT_KEYS.componentMatchReport),
    undefined,
    "Optional artifact componentMatchReport should not be in source"
  );

  const targetJobDir = path.join(root, "jobs", "target-job");
  await mkdir(targetJobDir, { recursive: true });
  const targetArtifactStore = new StageArtifactStore({ jobDir: targetJobDir });

  const targetPaths = await reuseStorybookArtifactsFromSourceJob({
    sourceArtifactStore,
    targetArtifactStore,
    sourceJobId: "source-job",
    sourceRequestedStorybookStaticDir: buildDir,
    targetJobDir,
    stage: "ir.derive"
  });

  assert.equal(
    await targetArtifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaLibraryResolution),
    undefined,
    "Optional artifact should not appear in target when absent from source"
  );
  assert.equal(
    await targetArtifactStore.getPath(STAGE_ARTIFACT_KEYS.componentMatchReport),
    undefined,
    "Optional artifact should not appear in target when absent from source"
  );

  assert.ok(targetPaths.catalogFile, "Required artifact path should still be returned");
});

test("reuseStorybookArtifactsFromSourceJob copies optional figma.library_resolution artifacts when present", async () => {
  const buildDir = await createSyntheticStorybookBuild();
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-reuse-library-resolution-"));

  const sourceJobDir = path.join(root, "jobs", "source-job");
  await mkdir(sourceJobDir, { recursive: true });
  const sourceArtifactStore = new StageArtifactStore({ jobDir: sourceJobDir });

  const sourceArtifacts = await generateStorybookArtifactsForJob({
    storybookStaticDir: buildDir,
    jobDir: sourceJobDir,
    artifactStore: sourceArtifactStore,
    stage: "ir.derive",
    limits: resolveRuntimeSettings({ enablePreview: false }).pipelineDiagnosticLimits
  });
  await writeFile(
    sourceArtifacts.paths.figmaLibraryResolutionFile,
    '{ "artifact": "figma.library_resolution", "summary": { "total": 1 } }\n',
    "utf8"
  );
  await sourceArtifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
    stage: "ir.derive",
    absolutePath: sourceArtifacts.paths.figmaLibraryResolutionFile
  });

  const targetJobDir = path.join(root, "jobs", "target-job");
  await mkdir(targetJobDir, { recursive: true });
  const targetArtifactStore = new StageArtifactStore({ jobDir: targetJobDir });

  const targetPaths = await reuseStorybookArtifactsFromSourceJob({
    sourceArtifactStore,
    targetArtifactStore,
    sourceJobId: "source-job",
    sourceRequestedStorybookStaticDir: buildDir,
    targetJobDir,
    stage: "ir.derive"
  });

  assert.equal(
    await targetArtifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaLibraryResolution),
    targetPaths.figmaLibraryResolutionFile
  );
  assert.equal(
    await readFile(targetPaths.figmaLibraryResolutionFile, "utf8"),
    await readFile(sourceArtifacts.paths.figmaLibraryResolutionFile, "utf8")
  );
});

test("reuseStorybookArtifactsFromSourceJob copies optional component.match_report artifacts when present", async () => {
  const buildDir = await createSyntheticStorybookBuild();
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-reuse-component-match-report-"));

  const sourceJobDir = path.join(root, "jobs", "source-job");
  await mkdir(sourceJobDir, { recursive: true });
  const sourceArtifactStore = new StageArtifactStore({ jobDir: sourceJobDir });

  const sourceArtifacts = await generateStorybookArtifactsForJob({
    storybookStaticDir: buildDir,
    jobDir: sourceJobDir,
    artifactStore: sourceArtifactStore,
    stage: "ir.derive",
    limits: resolveRuntimeSettings({ enablePreview: false }).pipelineDiagnosticLimits
  });
  await writeFile(
    sourceArtifacts.paths.componentMatchReportFile,
    '{ "artifact": "component.match_report", "summary": { "matched": 1 } }\n',
    "utf8"
  );
  await sourceArtifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: sourceArtifacts.paths.componentMatchReportFile
  });

  const targetJobDir = path.join(root, "jobs", "target-job");
  await mkdir(targetJobDir, { recursive: true });
  const targetArtifactStore = new StageArtifactStore({ jobDir: targetJobDir });

  const targetPaths = await reuseStorybookArtifactsFromSourceJob({
    sourceArtifactStore,
    targetArtifactStore,
    sourceJobId: "source-job",
    sourceRequestedStorybookStaticDir: buildDir,
    targetJobDir,
    stage: "ir.derive"
  });

  assert.equal(
    await targetArtifactStore.getPath(STAGE_ARTIFACT_KEYS.componentMatchReport),
    targetPaths.componentMatchReportFile
  );
  assert.equal(
    await readFile(targetPaths.componentMatchReportFile, "utf8"),
    await readFile(sourceArtifacts.paths.componentMatchReportFile, "utf8")
  );
});
