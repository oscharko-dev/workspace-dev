import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobEngine, resolveRuntimeSettings } from "../job-engine.js";
import { toDeterministicScreenPath } from "../parity/generator-artifacts.js";
import { STAGE_ARTIFACT_KEYS } from "./pipeline/artifact-keys.js";
import { StageArtifactStore } from "./pipeline/artifact-store.js";

const waitForTerminalStatus = async ({
  getStatus,
  jobId,
  timeoutMs = 240_000
}: {
  getStatus: (jobId: string) => ReturnType<ReturnType<typeof createJobEngine>["getJob"]>;
  jobId: string;
  timeoutMs?: number;
}) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = getStatus(jobId);
    if (status && (status.status === "completed" || status.status === "failed" || status.status === "canceled")) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for job status");
};

const createLocalFigmaPayload = () => ({
  name: "Regen Test Board",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-1",
            type: "FRAME",
            name: "Test Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
            children: [
              {
                id: "title-1",
                type: "TEXT",
                characters: "Hello World",
                absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 30 },
                style: { fontSize: 24, fontWeight: 400, lineHeightPx: 32 },
                fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }]
              },
              {
                id: "box-1",
                type: "FRAME",
                name: "Container",
                absoluteBoundingBox: { x: 0, y: 40, width: 640, height: 200 },
                fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
                cornerRadius: 8,
                children: []
              }
            ]
          }
        ]
      }
    ]
  }
});

const createLocalFigmaPayloadWithCustomerButton = () => ({
  name: "Regen Storybook Match Board",
  lastModified: "2026-04-01T00:00:00Z",
  components: {
    "1:100": {
      key: "cmp-button",
      name: "Button/Primary",
      componentSetId: "1:200",
      remote: false
    }
  },
  componentSets: {
    "1:200": {
      key: "set-button",
      name: "Button",
      remote: false
    }
  },
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-1",
            type: "FRAME",
            name: "Customer Button Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
            children: [
              {
                id: "instance-button",
                type: "INSTANCE",
                name: "Button, Variant=Primary, Size=Large",
                componentId: "1:100",
                componentSetId: "1:200",
                componentProperties: {
                  Variant: {
                    type: "VARIANT",
                    value: "Primary"
                  },
                  Size: {
                    type: "VARIANT",
                    value: "Large"
                  }
                },
                absoluteBoundingBox: { x: 16, y: 16, width: 160, height: 48 },
                children: [
                  {
                    id: "instance-button-label",
                    type: "TEXT",
                    name: "Label",
                    characters: "Weiter",
                    absoluteBoundingBox: { x: 48, y: 28, width: 96, height: 20 },
                    style: { fontSize: 14, fontWeight: 600, lineHeightPx: 20 },
                    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
});

const createCustomerProfileFixture = ({
  packageName = "@customer/components",
  dependencyVersion = "^1.2.3",
  storybookLightTheme = "sparkasse-light",
  storybookDarkTheme,
  exportName = "PrimaryButton",
  importAlias = "CustomerButton",
  propMappings = {}
}: {
  packageName?: string;
  dependencyVersion?: string;
  storybookLightTheme?: string;
  storybookDarkTheme?: string;
  exportName?: string;
  importAlias?: string;
  propMappings?: Record<string, string>;
} = {}) => ({
  version: 1,
  families: [
    {
      id: "Components",
      tierPriority: 10,
      aliases: {
        figma: ["components"],
        storybook: ["components"],
        code: [packageName]
      }
    }
  ],
  brandMappings: [
    {
      id: "sparkasse",
      aliases: ["sparkasse"],
      brandTheme: "sparkasse",
      storybookThemes: {
        light: storybookLightTheme,
        ...(storybookDarkTheme ? { dark: storybookDarkTheme } : {})
      }
    }
  ],
  imports: {
    components: {
      Button: {
        family: "Components",
        package: packageName,
        export: exportName,
        importAlias,
        propMappings
      }
    },
    icons: {}
  },
  fallbacks: {
    mui: {
      defaultPolicy: "allow",
      components: {}
    },
    icons: {
      defaultPolicy: "deny",
      icons: {}
    }
  },
  template: {
    dependencies: {
      [packageName]: dependencyVersion
    },
    devDependencies: {},
    importAliases: {
      "@customer/ui": packageName
    }
  },
  strictness: {
    match: "warn",
    token: "warn",
    import: "error"
  }
});

const createSyntheticStorybookBuild = async (): Promise<string> => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-storybook-build-"));
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
        text: { primary: "#444444" },
        background: { default: "#fafafa", paper: "#ffffff" }
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

const createSyntheticStorybookBuildWithCustomerButton = async ({
  workspaceRoot
}: {
  workspaceRoot: string;
}): Promise<string> => {
  const buildDir = await mkdtemp(path.join(workspaceRoot, "storybook-static-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const indexJson = {
    v: 5,
    entries: {
      "components-button--primary": {
        id: "components-button--primary",
        title: "Components/Button",
        name: "Primary",
        importPath: "./src/components/Button/Button.stories.tsx",
        storiesImports: [],
        type: "story",
        tags: ["dev", "test"],
        componentPath: "./src/components/Button/Button.tsx"
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
      "./src/components/Button/Button.stories.tsx": n(() => c0(() => import("./Button.stories-test.js"), true ? __vite__mapDeps([1]) : void 0, import.meta.url), "./src/components/Button/Button.stories.tsx")
    };
  `;

  const storyBundle = `
    const meta = {
      title: "Components/Button",
      args: { variant: "contained", size: "large", children: "Continue" },
      argTypes: {
        variant: { control: { type: "select" } },
        size: { control: { type: "select" } },
        children: { control: { type: "select" } }
      }
    };
  `;

  const sharedThemeBundle = `
    const FONT_DATA = "data:application/font-ttf;base64,${"A".repeat(1500)}";
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
        warning: { main: "#ffc900" },
        text: { primary: "#444444" },
        background: { default: "#fafafa", paper: "#ffffff" }
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
  await writeFile(path.join(assetsDir, "Button.stories-test.js"), storyBundle, "utf8");
  await writeFile(path.join(assetsDir, "shared-theme.js"), sharedThemeBundle, "utf8");
  await writeFile(path.join(assetsDir, "iframe-test.css"), cssText, "utf8");

  return buildDir;
};

test("submitRegeneration throws when source job does not exist", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-notfound-"));
  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({ enablePreview: false })
  });

  assert.throws(
    () =>
      engine.submitRegeneration({
        sourceJobId: "nonexistent",
        overrides: []
      }),
    (error: Error & { code?: string }) => error.code === "E_REGEN_SOURCE_NOT_FOUND"
  );
});

test("submitRegeneration throws when source job is not completed", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-notcompleted-"));
  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1000,
      fetchImpl: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal instanceof AbortSignal) {
            signal.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            }, { once: true });
          }
        })
    })
  });

  // Submit a job that will hang (never completes)
  const accepted = engine.submitJob({ figmaFileKey: "abc", figmaAccessToken: "token" });

  assert.throws(
    () =>
      engine.submitRegeneration({
        sourceJobId: accepted.jobId,
        overrides: []
      }),
    (error: Error & { code?: string }) => error.code === "E_REGEN_SOURCE_NOT_COMPLETED"
  );

  // Cleanup - cancel the hanging job
  engine.cancelJob({ jobId: accepted.jobId });
});

test("submitJob completes when preview-disabled repro export and git.pr are skipped", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-preview-disabled-skip-contracts-"));
  const figmaPayload = createLocalFigmaPayload();
  const figmaPath = path.join(tempRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(figmaPayload), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false
    })
  });

  const accepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    enableGitPr: false
  });

  const status = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: accepted.jobId
  });

  assert.equal(status.status, "completed", `Job should complete, got: ${status.status} — ${status.error?.message ?? "no error"}`);
  assert.equal(status.error, undefined);
  assert.equal(status.gitPr?.status, "skipped");
  assert.equal(status.stages.find((stage) => stage.name === "repro.export")?.status, "skipped");
  assert.equal(status.stages.find((stage) => stage.name === "git.pr")?.status, "skipped");
});

test("submitRegeneration creates a queued job with lineage metadata from a completed source", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-lineage-"));
  const figmaPayload = createLocalFigmaPayload();
  const figmaPath = path.join(tempRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(figmaPayload), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false
    })
  });

  // First: create and complete a source job
  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json"
  });

  const sourceStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: sourceAccepted.jobId
  });
  assert.equal(sourceStatus.status, "completed", `Source job should complete, got: ${sourceStatus.status} — ${sourceStatus.error?.message ?? "no error"}`);

  // Now submit regeneration with overrides
  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [
      { nodeId: "title-1", field: "fontSize", value: 28 },
      { nodeId: "box-1", field: "cornerRadius", value: 16 }
    ],
    draftId: "test-draft-123",
    baseFingerprint: "fnv1a64:abc123"
  });

  assert.equal(regenAccepted.status, "queued");
  assert.equal(regenAccepted.sourceJobId, sourceAccepted.jobId);
  assert.ok(regenAccepted.jobId);

  // Wait for regeneration to complete
  const regenStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: regenAccepted.jobId
  });

  assert.equal(regenStatus.status, "completed", `Regen job should complete, got: ${regenStatus.status} — ${regenStatus.error?.message ?? "no error"}`);

  // Verify lineage metadata
  assert.ok(regenStatus.lineage, "Regeneration job should have lineage metadata");
  assert.equal(regenStatus.lineage?.sourceJobId, sourceAccepted.jobId);
  assert.equal(regenStatus.lineage?.overrideCount, 2);
  assert.equal(regenStatus.lineage?.draftId, "test-draft-123");
  assert.equal(regenStatus.lineage?.baseFingerprint, "fnv1a64:abc123");

  // Verify git.pr is skipped
  assert.equal(regenStatus.gitPr?.status, "skipped");

  // Verify figma.source is skipped
  const figmaStage = regenStatus.stages.find((s) => s.name === "figma.source");
  assert.equal(figmaStage?.status, "skipped");

  // Verify ir.derive completed (override application)
  const irStage = regenStatus.stages.find((s) => s.name === "ir.derive");
  assert.equal(irStage?.status, "completed");

  // Verify codegen completed
  const codegenStage = regenStatus.stages.find((s) => s.name === "codegen.generate");
  assert.equal(codegenStage?.status, "completed");

  // Source job should remain unchanged
  const sourceAfter = engine.getJob(sourceAccepted.jobId);
  assert.equal(sourceAfter?.status, "completed");
  assert.equal(sourceAfter?.lineage, undefined, "Source job should not have lineage");
});

test("submitRegeneration result endpoint includes lineage", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-result-"));
  const figmaPayload = createLocalFigmaPayload();
  const figmaPath = path.join(tempRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(figmaPayload), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false
    })
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json"
  });

  await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: sourceAccepted.jobId
  });

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "title-1", field: "fontSize", value: 32 }]
  });

  await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: regenAccepted.jobId
  });

  const result = engine.getJobResult(regenAccepted.jobId);
  assert.ok(result);
  assert.equal(result.status, "completed");
  assert.ok(result.lineage);
  assert.equal(result.lineage?.sourceJobId, sourceAccepted.jobId);
  assert.equal(result.lineage?.overrideCount, 1);
});

test("submitRegeneration reuses the source customerBrandId by default and honors explicit overrides", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-customer-brand-id-"));
  const figmaPath = path.join(tempRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false
    })
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    customerBrandId: "sparkasse-retail"
  });
  await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: sourceAccepted.jobId
  });

  const inheritedAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: []
  });
  assert.equal(engine.getJob(inheritedAccepted.jobId)?.request.customerBrandId, "sparkasse-retail");
  await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: inheritedAccepted.jobId
  });

  const overriddenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [],
    customerBrandId: "sparkasse-private"
  });
  assert.equal(engine.getJob(overriddenAccepted.jobId)?.request.customerBrandId, "sparkasse-private");
  await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: overriddenAccepted.jobId
  });
});

test("submitRegeneration reuses source componentMappings by default and honors explicit replacements", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-component-mappings-"));
  const figmaPath = path.join(tempRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false
    })
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    componentMappings: [
      {
        boardKey: " board-1 ",
        nodeId: " box-1 ",
        componentName: " Button ",
        importPath: " @mui/material/Button ",
        priority: 0,
        source: "local_override",
        enabled: true
      }
    ]
  });
  await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: sourceAccepted.jobId
  });

  const inheritedAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: []
  });
  assert.deepEqual(engine.getJob(inheritedAccepted.jobId)?.request.componentMappings, [
    {
      boardKey: "board-1",
      nodeId: "box-1",
      componentName: "Button",
      importPath: "@mui/material/Button",
      priority: 0,
      source: "local_override",
      enabled: true
    }
  ]);
  await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: inheritedAccepted.jobId
  });

  const overriddenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [],
    componentMappings: [
      {
        boardKey: " board-1 ",
        canonicalComponentName: " Button ",
        semanticType: " button ",
        componentName: " PatternButton ",
        importPath: " @pattern/ui ",
        priority: 1,
        source: "code_connect_import",
        enabled: false
      }
    ]
  });
  assert.deepEqual(engine.getJob(overriddenAccepted.jobId)?.request.componentMappings, [
    {
      boardKey: "board-1",
      canonicalComponentName: "Button",
      semanticType: "button",
      componentName: "PatternButton",
      importPath: "@pattern/ui",
      priority: 1,
      source: "code_connect_import",
      enabled: false
    }
  ]);
  await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: overriddenAccepted.jobId
  });
});

test("submitRegeneration reuses the stored customer profile snapshot even when the source profile file changes", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-customer-profile-reuse-"));
  const outputRoot = path.join(workspaceRoot, ".workspace-dev");
  const figmaPath = path.join(workspaceRoot, "figma-input.json");
  const customerProfileDir = path.join(workspaceRoot, "profiles");
  const customerProfilePath = path.join(customerProfileDir, "customer-profile.json");
  await mkdir(customerProfileDir, { recursive: true });
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");
  const templatePackageJson = JSON.parse(
    await readFile(path.join(process.cwd(), "template", "react-mui-app", "package.json"), "utf8")
  ) as { dependencies?: Record<string, string> };
  const muiMaterialVersion = templatePackageJson.dependencies?.["@mui/material"];
  assert.equal(typeof muiMaterialVersion, "string");
  await writeFile(
    customerProfilePath,
    JSON.stringify(createCustomerProfileFixture({ packageName: "@mui/material", dependencyVersion: muiMaterialVersion })),
    "utf8"
  );

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      workspaceRoot,
      outputRoot,
      jobsRoot: path.join(outputRoot, "jobs"),
      reprosRoot: path.join(outputRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false
    })
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    customerProfilePath: "profiles/customer-profile.json"
  });

  const sourceStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: sourceAccepted.jobId
  });
  assert.equal(sourceStatus.status, "completed", `Source job should complete, got: ${sourceStatus.status} — ${sourceStatus.error?.message ?? "no error"}`);

  // Overwrite the profile file on disk — regeneration must ignore this and use the stored snapshot
  await writeFile(
    customerProfilePath,
    JSON.stringify(createCustomerProfileFixture({ packageName: "@customer/components-updated", dependencyVersion: "^9.9.9" })),
    "utf8"
  );

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "title-1", field: "fontSize", value: 30 }]
  });

  const regenStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: regenAccepted.jobId
  });
  assert.equal(regenStatus.status, "completed", `Regen job should complete, got: ${regenStatus.status} — ${regenStatus.error?.message ?? "no error"}`);

  const generatedPackage = JSON.parse(
    await readFile(path.join(String(regenStatus.artifacts.generatedProjectDir), "package.json"), "utf8")
  ) as {
    dependencies?: Record<string, string>;
  };
  // Regeneration must use the stored snapshot (@mui/material), not the updated file (@customer/components-updated)
  assert.equal(generatedPackage.dependencies?.["@mui/material"], muiMaterialVersion);
  assert.equal(generatedPackage.dependencies?.["@customer/components-updated"], undefined);

  const regenArtifactStore = new StageArtifactStore({ jobDir: String(regenStatus.artifacts.jobDir) });
  const regenSnapshot = await regenArtifactStore.getValue<{
    origin: string;
    profile?: {
      template?: {
        dependencies?: Record<string, string>;
      };
    };
  }>(STAGE_ARTIFACT_KEYS.customerProfileResolved);
  assert.equal(regenSnapshot?.origin, "request");
  assert.ok(regenSnapshot?.profile?.template?.dependencies?.["@mui/material"] === muiMaterialVersion);
  assert.equal(regenSnapshot?.profile?.template?.dependencies?.["@customer/components-updated"], undefined);
});

test("submitRegeneration keeps storybook-first generated imports pinned to the stored customer profile snapshot", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-storybook-profile-import-reuse-"));
  const outputRoot = path.join(workspaceRoot, ".workspace-dev");
  const figmaPath = path.join(workspaceRoot, "figma-input.json");
  const customerProfilePath = path.join(workspaceRoot, "customer-profile.json");
  const templatePackageJson = JSON.parse(
    await readFile(path.join(process.cwd(), "template", "react-mui-app", "package.json"), "utf8")
  ) as {
    dependencies?: Record<string, string>;
  };
  const muiMaterialVersion = templatePackageJson.dependencies?.["@mui/material"];
  assert.equal(typeof muiMaterialVersion, "string");
  const storybookBuildDir = await createSyntheticStorybookBuildWithCustomerButton({
    workspaceRoot
  });
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayloadWithCustomerButton()), "utf8");
  await writeFile(
    customerProfilePath,
    JSON.stringify(
      createCustomerProfileFixture({
        packageName: "@mui/material",
        dependencyVersion: muiMaterialVersion,
        storybookLightTheme: "default",
        exportName: "Button",
        importAlias: "CustomerButton"
      })
    ),
    "utf8"
  );

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      workspaceRoot,
      outputRoot,
      jobsRoot: path.join(outputRoot, "jobs"),
      reprosRoot: path.join(outputRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false
    })
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    storybookStaticDir: storybookBuildDir,
    customerProfilePath,
    customerBrandId: "sparkasse"
  });
  const sourceStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: sourceAccepted.jobId
  });
  assert.equal(sourceStatus.status, "completed", `Source job should complete, got: ${sourceStatus.status} — ${sourceStatus.error?.message ?? "no error"}`);

  const sourceScreenContent = await readFile(
    path.join(String(sourceStatus.artifacts.generatedProjectDir), toDeterministicScreenPath("Customer Button Screen")),
    "utf8"
  );
  assert.ok(sourceScreenContent.includes("CustomerButton"));
  assert.ok(sourceScreenContent.includes("<CustomerButton"));
  assert.equal(sourceScreenContent.includes("UpdatedCustomerButton"), false);
  assert.equal(sourceScreenContent.includes("<Button"), false);

  await writeFile(
    customerProfilePath,
    JSON.stringify(
      createCustomerProfileFixture({
        packageName: "@mui/material",
        dependencyVersion: "^9.9.9",
        storybookLightTheme: "default",
        exportName: "IconButton",
        importAlias: "UpdatedCustomerButton"
      })
    ),
    "utf8"
  );

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "instance-button", field: "width", value: 200 }]
  });
  const regenStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: regenAccepted.jobId
  });
  assert.equal(regenStatus.status, "completed", `Regen job should complete, got: ${regenStatus.status} — ${regenStatus.error?.message ?? "no error"}`);

  const generatedPackage = JSON.parse(
    await readFile(path.join(String(regenStatus.artifacts.generatedProjectDir), "package.json"), "utf8")
  ) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(generatedPackage.dependencies?.["@mui/material"], muiMaterialVersion);

  const regenScreenContent = await readFile(
    path.join(String(regenStatus.artifacts.generatedProjectDir), toDeterministicScreenPath("Customer Button Screen")),
    "utf8"
  );
  assert.ok(regenScreenContent.includes("CustomerButton"));
  assert.ok(regenScreenContent.includes("<CustomerButton"));
  assert.equal(regenScreenContent.includes("UpdatedCustomerButton"), false);
  assert.equal(regenScreenContent.includes("IconButton"), false);
});

test("submitRegeneration consumes reused component.match_report mappings after source-job completion", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-storybook-match-report-reuse-"));
  const outputRoot = path.join(workspaceRoot, ".workspace-dev");
  const figmaPath = path.join(workspaceRoot, "figma-input.json");
  const customerProfilePath = path.join(workspaceRoot, "customer-profile.json");
  const templatePackageJson = JSON.parse(
    await readFile(path.join(process.cwd(), "template", "react-mui-app", "package.json"), "utf8")
  ) as {
    dependencies?: Record<string, string>;
  };
  const muiMaterialVersion = templatePackageJson.dependencies?.["@mui/material"];
  assert.equal(typeof muiMaterialVersion, "string");
  const storybookBuildDir = await createSyntheticStorybookBuildWithCustomerButton({
    workspaceRoot
  });
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayloadWithCustomerButton()), "utf8");
  await writeFile(
    customerProfilePath,
    JSON.stringify(
      createCustomerProfileFixture({
        packageName: "@mui/material",
        dependencyVersion: muiMaterialVersion,
        storybookLightTheme: "default",
        exportName: "Button",
        importAlias: "CustomerButton"
      })
    ),
    "utf8"
  );

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      workspaceRoot,
      outputRoot,
      jobsRoot: path.join(outputRoot, "jobs"),
      reprosRoot: path.join(outputRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false
    })
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    storybookStaticDir: storybookBuildDir,
    customerProfilePath,
    customerBrandId: "sparkasse"
  });
  const sourceStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: sourceAccepted.jobId
  });
  assert.equal(sourceStatus.status, "completed", `Source job should complete, got: ${sourceStatus.status} — ${sourceStatus.error?.message ?? "no error"}`);
  assert.equal(typeof sourceStatus.artifacts.componentMatchReportFile, "string");

  const sourceScreenContent = await readFile(
    path.join(String(sourceStatus.artifacts.generatedProjectDir), toDeterministicScreenPath("Customer Button Screen")),
    "utf8"
  );
  assert.ok(sourceScreenContent.includes("CustomerButton"));
  assert.ok(sourceScreenContent.includes("<CustomerButton"));

  const sourceComponentMatchReportPath = String(sourceStatus.artifacts.componentMatchReportFile);
  const sourceComponentMatchReport = JSON.parse(await readFile(sourceComponentMatchReportPath, "utf8")) as {
    artifact?: string;
    summary?: Record<string, unknown>;
    entries?: Array<Record<string, unknown>>;
  };
  assert.equal(sourceComponentMatchReport.artifact, "component.match_report");
  assert.ok(Array.isArray(sourceComponentMatchReport.entries));
  assert.ok((sourceComponentMatchReport.entries?.length ?? 0) > 0);
  const templateEntry = sourceComponentMatchReport.entries?.[0];
  assert.ok(templateEntry);

  const buttonEntry = JSON.parse(JSON.stringify(templateEntry)) as Record<string, unknown>;
  buttonEntry.libraryResolution = {
    status: "mui_fallback_allowed",
    reason: "profile_import_missing",
    storybookTier: "Components",
    profileFamily: "Components",
    componentKey: "Button"
  };

  const cardEntry = JSON.parse(JSON.stringify(templateEntry)) as Record<string, unknown>;
  cardEntry.figma = {
    familyKey: "card-family",
    familyName: "Card",
    nodeCount: 1,
    variantProperties: []
  };
  cardEntry.libraryResolution = {
    status: "resolved_import",
    reason: "profile_import_resolved",
    storybookTier: "Components",
    profileFamily: "Components",
    componentKey: "Card",
    import: {
      package: "@mui/material",
      exportName: "Card",
      localName: "StorybookCard"
    }
  };
  cardEntry.storybookFamily = {
    familyId: "family-card",
    title: "Components/Card",
    name: "Card",
    tier: "Components",
    storyCount: 1
  };
  cardEntry.storyVariant = {
    entryId: "components-card--default",
    storyName: "Default"
  };
  const cardResolvedApi = cardEntry.resolvedApi;
  if (typeof cardResolvedApi === "object" && cardResolvedApi !== null) {
    cardEntry.resolvedApi = {
      ...cardResolvedApi,
      componentKey: "Card",
      import: {
        package: "@mui/material",
        exportName: "Card",
        localName: "StorybookCard"
      }
    };
  }
  const cardResolvedProps = cardEntry.resolvedProps;
  if (typeof cardResolvedProps === "object" && cardResolvedProps !== null) {
    cardEntry.resolvedProps = {
      ...cardResolvedProps,
      status: "resolved",
      codegenCompatible: true,
      diagnostics: []
    };
  }

  sourceComponentMatchReport.entries = [buttonEntry, cardEntry];
  sourceComponentMatchReport.summary = {
    ...(sourceComponentMatchReport.summary ?? {}),
    totalFigmaFamilies: 2,
    matched: 2,
    ambiguous: 0,
    unmatched: 0,
    libraryResolution: {
      byStatus: {
        resolved_import: 1,
        mui_fallback_allowed: 1,
        mui_fallback_denied: 0,
        not_applicable: 0
      },
      byReason: {
        profile_import_resolved: 1,
        profile_import_missing: 1,
        profile_import_family_mismatch: 0,
        profile_family_unresolved: 0,
        match_ambiguous: 0,
        match_unmatched: 0
      }
    }
  };
  await writeFile(sourceComponentMatchReportPath, `${JSON.stringify(sourceComponentMatchReport, null, 2)}\n`, "utf8");

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "instance-button", field: "width", value: 220 }]
  });
  const regenStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: regenAccepted.jobId
  });
  assert.equal(regenStatus.status, "completed", `Regen job should complete, got: ${regenStatus.status} — ${regenStatus.error?.message ?? "no error"}`);

  const regenScreenContent = await readFile(
    path.join(String(regenStatus.artifacts.generatedProjectDir), toDeterministicScreenPath("Customer Button Screen")),
    "utf8"
  );
  assert.equal(regenScreenContent.includes("<CustomerButton"), false);
  assert.equal(regenScreenContent.includes("from \"@customer/components\""), false);
  assert.ok(regenScreenContent.includes("from \"@mui/material\""));
  assert.ok(regenScreenContent.includes("<Button"));
});

test("submitRegeneration fails with E_CUSTOMER_PROFILE_SNAPSHOT_MISSING when an explicit source snapshot is corrupt", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-customer-profile-corrupt-"));
  const outputRoot = path.join(workspaceRoot, ".workspace-dev");
  const figmaPath = path.join(workspaceRoot, "figma-input.json");
  const customerProfileDir = path.join(workspaceRoot, "profiles");
  const customerProfilePath = path.join(customerProfileDir, "customer-profile.json");
  await mkdir(customerProfileDir, { recursive: true });
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");
  const templatePackageJson = JSON.parse(
    await readFile(path.join(process.cwd(), "template", "react-mui-app", "package.json"), "utf8")
  ) as { dependencies?: Record<string, string> };
  const muiVersion = templatePackageJson.dependencies?.["@mui/material"];
  assert.equal(typeof muiVersion, "string");
  await writeFile(
    customerProfilePath,
    JSON.stringify(createCustomerProfileFixture({ packageName: "@mui/material", dependencyVersion: muiVersion })),
    "utf8"
  );

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      workspaceRoot,
      outputRoot,
      jobsRoot: path.join(outputRoot, "jobs"),
      reprosRoot: path.join(outputRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false
    })
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    customerProfilePath: "profiles/customer-profile.json"
  });
  const sourceStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: sourceAccepted.jobId
  });
  assert.equal(sourceStatus.status, "completed");

  const sourceArtifactStore = new StageArtifactStore({ jobDir: String(sourceStatus.artifacts.jobDir) });
  await sourceArtifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.customerProfileResolved,
    stage: "figma.source",
    value: "corrupt-snapshot"
  });

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "title-1", field: "fontSize", value: 32 }]
  });
  const regenStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: regenAccepted.jobId
  });

  assert.equal(regenStatus.status, "failed");
  assert.equal(regenStatus.error?.code, "E_CUSTOMER_PROFILE_SNAPSHOT_MISSING");
  assert.equal(regenStatus.error?.stage, "ir.derive");
  assert.match(regenStatus.error?.message ?? "", /customer profile snapshot is invalid/i);
});

test("queued regeneration jobs drain when a running job releases the only queue slot", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-queue-drain-"));
  const figmaPayload = createLocalFigmaPayload();
  const figmaPath = path.join(tempRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(figmaPayload), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      maxConcurrentJobs: 1,
      maxQueuedJobs: 2,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1_000,
      fetchImpl: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal instanceof AbortSignal) {
            signal.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            }, { once: true });
          }
        })
    })
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json"
  });
  const sourceStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: sourceAccepted.jobId
  });
  assert.equal(sourceStatus.status, "completed");

  const blockingAccepted = engine.submitJob({
    figmaFileKey: "queued-regen-blocker",
    figmaAccessToken: "token"
  });
  const blockingStartedAt = Date.now();
  while (Date.now() - blockingStartedAt < 5_000) {
    if (engine.getJob(blockingAccepted.jobId)?.status === "running") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(engine.getJob(blockingAccepted.jobId)?.status, "running");

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "title-1", field: "fontSize", value: 32 }]
  });
  assert.equal(engine.getJob(regenAccepted.jobId)?.status, "queued");

  engine.cancelJob({ jobId: blockingAccepted.jobId, reason: "release queue slot" });

  const blockingStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: blockingAccepted.jobId
  });
  assert.equal(blockingStatus.status, "canceled");

  const regenStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: regenAccepted.jobId
  });
  assert.equal(regenStatus.status, "completed", `Queued regeneration should drain, got ${regenStatus.status}`);
  assert.equal(regenStatus.lineage?.sourceJobId, sourceAccepted.jobId);
  assert.equal(regenStatus.lineage?.overrideCount, 1);
});

test("regeneration reuses Storybook artifacts from the source job after the original Storybook build is removed", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-storybook-reuse-"));
  const figmaPath = path.join(tempRoot, "figma-input.json");
  const customerProfilePath = path.join(tempRoot, "customer-profile.json");
  const storybookBuildDir = await createSyntheticStorybookBuild();
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");
  const templatePackageJson = JSON.parse(
    await readFile(path.join(process.cwd(), "template", "react-mui-app", "package.json"), "utf8")
  ) as { dependencies?: Record<string, string> };
  const muiVersion = templatePackageJson.dependencies?.["@mui/material"];
  assert.equal(typeof muiVersion, "string");
  await writeFile(
    customerProfilePath,
    JSON.stringify(createCustomerProfileFixture({ packageName: "@mui/material", dependencyVersion: muiVersion, storybookLightTheme: "default" })),
    "utf8"
  );

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false
    })
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    storybookStaticDir: storybookBuildDir,
    customerProfilePath,
    customerBrandId: "sparkasse"
  });
  const sourceStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: sourceAccepted.jobId
  });
  assert.equal(sourceStatus.status, "completed");
  assert.equal(typeof sourceStatus.artifacts.storybookTokensFile, "string");
  assert.equal(typeof sourceStatus.artifacts.storybookThemesFile, "string");
  assert.equal(typeof sourceStatus.artifacts.storybookComponentsFile, "string");

  const sourceTokensBytes = await readFile(String(sourceStatus.artifacts.storybookTokensFile), "utf8");
  const sourceThemesBytes = await readFile(String(sourceStatus.artifacts.storybookThemesFile), "utf8");
  const sourceComponentsBytes = await readFile(String(sourceStatus.artifacts.storybookComponentsFile), "utf8");

  await rm(storybookBuildDir, { recursive: true, force: true });

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "title-1", field: "fontSize", value: 32 }]
  });
  const regenStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: regenAccepted.jobId
  });

  assert.equal(regenStatus.status, "completed", `Expected completed regeneration, got ${regenStatus.status}`);
  assert.equal(typeof regenStatus.artifacts.storybookTokensFile, "string");
  assert.equal(typeof regenStatus.artifacts.storybookThemesFile, "string");
  assert.equal(typeof regenStatus.artifacts.storybookComponentsFile, "string");
  assert.equal(await readFile(String(regenStatus.artifacts.storybookTokensFile), "utf8"), sourceTokensBytes);
  assert.equal(await readFile(String(regenStatus.artifacts.storybookThemesFile), "utf8"), sourceThemesBytes);
  assert.equal(await readFile(String(regenStatus.artifacts.storybookComponentsFile), "utf8"), sourceComponentsBytes);
});

test("regeneration fails when a source job declared Storybook input but a reusable Storybook artifact is missing", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-storybook-missing-"));
  const figmaPath = path.join(tempRoot, "figma-input.json");
  const customerProfilePath = path.join(tempRoot, "customer-profile.json");
  const storybookBuildDir = await createSyntheticStorybookBuild();
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");
  const templatePackageJson = JSON.parse(
    await readFile(path.join(process.cwd(), "template", "react-mui-app", "package.json"), "utf8")
  ) as { dependencies?: Record<string, string> };
  const muiVersion = templatePackageJson.dependencies?.["@mui/material"];
  assert.equal(typeof muiVersion, "string");
  await writeFile(
    customerProfilePath,
    JSON.stringify(createCustomerProfileFixture({ packageName: "@mui/material", dependencyVersion: muiVersion, storybookLightTheme: "default" })),
    "utf8"
  );

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false
    })
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    storybookStaticDir: storybookBuildDir,
    customerProfilePath,
    customerBrandId: "sparkasse"
  });
  const sourceStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: sourceAccepted.jobId
  });
  assert.equal(sourceStatus.status, "completed");
  assert.equal(typeof sourceStatus.artifacts.storybookComponentsFile, "string");

  await rm(String(sourceStatus.artifacts.storybookComponentsFile), { force: true });

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "title-1", field: "fontSize", value: 20 }]
  });
  const regenStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: regenAccepted.jobId
  });

  assert.equal(regenStatus.status, "failed");
  assert.equal(regenStatus.error?.code, "E_STORYBOOK_ARTIFACTS_MISSING");
  assert.equal(regenStatus.error?.stage, "ir.derive");
  assert.match(regenStatus.error?.message ?? "", /storybook\.components/i);
});
