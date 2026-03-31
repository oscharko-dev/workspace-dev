import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  WorkspaceBrandTheme,
  WorkspaceFigmaSourceMode,
  WorkspaceFormHandlingMode,
  WorkspaceJobInput,
  WorkspaceJobStageName
} from "../../contracts/index.js";
import { parseCustomerProfileConfig } from "../../customer-profile.js";
import { resolveBoardKey } from "../../parity/board-key.js";
import type { DesignIR } from "../../parity/types-ir.js";
import { createStageRuntimeContext, type PipelineExecutionContext, type StageRuntimeContext } from "../pipeline/context.js";
import { loadPreviousSnapshot, saveCurrentSnapshot, type GenerationDiffContext } from "../generation-diff.js";
import { computeContentHash, computeOptionsHash, saveCachedIr } from "../ir-cache.js";
import { StageArtifactStore } from "../pipeline/artifact-store.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import { resolveRuntimeSettings } from "../runtime.js";
import { createInitialStages, nowIso } from "../stage-state.js";
import type { JobEngineRuntime, JobRecord } from "../types.js";
import { createCodegenGenerateService } from "./codegen-generate-service.js";
import { FigmaSourceService } from "./figma-source-service.js";
import { createGitPrService } from "./git-pr-service.js";
import { IrDeriveService } from "./ir-derive-service.js";
import { ReproExportService } from "./repro-export-service.js";
import { TemplatePrepareService } from "./template-prepare-service.js";
import { createValidateProjectService } from "./validate-project-service.js";

const createLocalFigmaPayload = () => ({
  name: "Stage Service Board",
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
            name: "Screen 1",
            absoluteBoundingBox: { x: 0, y: 0, width: 360, height: 240 },
            children: [
              {
                id: "title-1",
                type: "TEXT",
                name: "Title",
                characters: "Hello",
                absoluteBoundingBox: { x: 16, y: 16, width: 128, height: 20 }
              }
            ]
          }
        ]
      }
    ]
  }
});

const createMinimalIr = (): DesignIR =>
  ({
    sourceName: "test",
    screens: [
      {
        id: "screen-1",
        name: "Screen 1",
        route: "/",
        layoutMode: "VERTICAL",
        gap: 8,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: []
      }
    ],
    tokens: {
      palette: {
        primary: "#1976d2",
        secondary: "#9c27b0",
        background: "#ffffff",
        text: "#111111",
        success: "#2e7d32",
        warning: "#ed6c02",
        error: "#d32f2f",
        info: "#0288d1",
        divider: "#e0e0e0",
        action: {
          active: "#1976d2",
          hover: "#1976d21a",
          selected: "#1976d214",
          disabled: "#00000042",
          disabledBackground: "#0000001f",
          focus: "#1976d21f"
        }
      },
      borderRadius: 4,
      spacingBase: 8,
      fontFamily: "Roboto",
      headingSize: 24,
      bodySize: 14,
      typography: {}
    }
  }) as DesignIR;

const createCustomerProfileForStageServices = () => {
  const customerProfile = parseCustomerProfileConfig({
    input: {
      version: 1,
      families: [
        {
          id: "Components",
          tierPriority: 10,
          aliases: {
            figma: ["Components"],
            storybook: ["components"],
            code: ["@customer/components"]
          }
        }
      ],
      brandMappings: [
        {
          id: "sparkasse",
          aliases: ["sparkasse"],
          brandTheme: "sparkasse"
        }
      ],
      imports: {
        components: {
          Button: {
            family: "Components",
            package: "@customer/components",
            export: "PrimaryButton",
            importAlias: "CustomerButton"
          }
        }
      },
      fallbacks: {
        mui: {
          defaultPolicy: "deny",
          components: {
            Card: "allow"
          }
        }
      },
      template: {
        dependencies: {
          "@customer/components": "^1.2.3"
        },
        importAliases: {
          "@customer/ui": "@customer/components"
        }
      },
      strictness: {
        match: "warn",
        token: "off",
        import: "error"
      }
    }
  });
  if (!customerProfile) {
    throw new Error("Failed to create stage-service customer profile fixture.");
  }
  return customerProfile;
};

const createJobRecord = ({
  runtime,
  jobDir,
  requestOverrides
}: {
  runtime: JobEngineRuntime;
  jobDir: string;
  requestOverrides?: Partial<JobRecord["request"]>;
}): JobRecord => {
  return {
    jobId: "job-stage-test",
    status: "queued",
    submittedAt: nowIso(),
    request: {
      enableGitPr: false,
      figmaSourceMode: "local_json",
      llmCodegenMode: "deterministic",
      brandTheme: "derived",
      generationLocale: "en-US",
      formHandlingMode: "react_hook_form",
      ...requestOverrides
    },
    stages: createInitialStages(),
    logs: [],
    artifacts: {
      outputRoot: path.dirname(path.dirname(jobDir)),
      jobDir
    },
    preview: { enabled: false },
    queue: {
      runningCount: 0,
      queuedCount: 0,
      maxConcurrentJobs: runtime.maxConcurrentJobs,
      maxQueuedJobs: runtime.maxQueuedJobs
    }
  };
};

const createExecutionContext = async ({
  mode = "submission",
  input,
  runtimeOverrides,
  requestOverrides,
  rootDir,
  jobId = "job-stage-test"
}: {
  mode?: "submission" | "regeneration";
  input?: WorkspaceJobInput;
  runtimeOverrides?: Partial<Parameters<typeof resolveRuntimeSettings>[0]>;
  requestOverrides?: Partial<JobRecord["request"]>;
  rootDir?: string;
  jobId?: string;
}): Promise<{
  executionContext: PipelineExecutionContext;
  stageContextFor: (stage: WorkspaceJobStageName) => StageRuntimeContext;
}> => {
  const root = rootDir ?? (await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-service-")));
  const jobsRoot = path.join(root, "jobs");
  const jobDir = path.join(jobsRoot, jobId);
  const generatedProjectDir = path.join(jobDir, "generated-app");
  const runtime = resolveRuntimeSettings({
    enablePreview: false,
    skipInstall: true,
    enableUiValidation: false,
    enableUnitTestValidation: false,
    figmaMaxRetries: 1,
    figmaRequestTimeoutMs: 1_000,
    ...runtimeOverrides
  });
  await mkdir(jobDir, { recursive: true });
  await mkdir(generatedProjectDir, { recursive: true });

  const job = createJobRecord({
    runtime,
    jobDir,
    requestOverrides
  });
  const artifactStore = new StageArtifactStore({ jobDir });
  const resolvedBrandTheme = (job.request.brandTheme ?? "derived") as WorkspaceBrandTheme;
  const resolvedFigmaSourceMode = (job.request.figmaSourceMode ?? "local_json") as WorkspaceFigmaSourceMode;
  const resolvedFormHandlingMode = (job.request.formHandlingMode ?? "react_hook_form") as WorkspaceFormHandlingMode;

  const executionContext: PipelineExecutionContext = {
    mode,
    job,
    ...(input ? { input } : {}),
    runtime,
    resolvedPaths: {
      outputRoot: root,
      jobsRoot,
      reprosRoot: path.join(root, "repros")
    },
    resolvedWorkspaceRoot: root,
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    jobAbortController: new AbortController(),
    fetchWithCancellation: runtime.fetchImpl,
    paths: {
      jobDir,
      generatedProjectDir,
      figmaRawJsonFile: path.join(jobDir, "figma.raw.json"),
      figmaJsonFile: path.join(jobDir, "figma.json"),
      designIrFile: path.join(jobDir, "design-ir.json"),
      figmaAnalysisFile: path.join(jobDir, "figma-analysis.json"),
      stageTimingsFile: path.join(jobDir, "stage-timings.json"),
      reproDir: path.join(root, "repros", jobId),
      iconMapFilePath: path.join(root, "icon-map.json"),
      designSystemFilePath: path.join(root, "design-system.json"),
      irCacheDir: path.join(root, "cache", "ir"),
      templateRoot: path.join(root, "template"),
      templateCopyFilter: () => true
    },
    artifactStore,
    resolvedBrandTheme,
    resolvedFigmaSourceMode,
    resolvedFormHandlingMode,
    ...(runtime.customerProfile ? { resolvedCustomerProfile: runtime.customerProfile } : {}),
    generationLocaleResolution: { locale: "en-US" },
    resolvedGenerationLocale: "en-US",
    appendDiagnostics: () => {
      // no-op for service contract tests
    },
    getCollectedDiagnostics: () => undefined,
    syncPublicJobProjection: async () => {
      // no-op for service contract tests
    }
  };

  return {
    executionContext,
    stageContextFor: (stage) => createStageRuntimeContext({ executionContext, stage })
  };
};

const seedRegenerationArtifacts = async ({
  executionContext,
  sourceJobId,
  sourceIrFile,
  sourceAnalysisFile,
  overrides = []
}: {
  executionContext: PipelineExecutionContext;
  sourceJobId: string;
  sourceIrFile?: string;
  sourceAnalysisFile?: string;
  overrides?: Array<{ field: string; nodeId: string; value: unknown }>;
}): Promise<void> => {
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.regenerationSourceIr,
    stage: "ir.derive",
    value: {
      sourceJobId,
      ...(sourceIrFile ? { sourceIrFile } : {}),
      ...(sourceAnalysisFile ? { sourceAnalysisFile } : {})
    }
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.regenerationOverrides,
    stage: "ir.derive",
    value: overrides
  });
};

test("FigmaSourceService writes cleaned artifacts for local_json mode", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    }
  });
  const localPayloadPath = path.join(executionContext.paths.jobDir, "local-figma.json");
  await writeFile(localPayloadPath, `${JSON.stringify(createLocalFigmaPayload(), null, 2)}\n`, "utf8");

  await FigmaSourceService.execute(
    {
      figmaJsonPath: localPayloadPath
    },
    stageContextFor("figma.source")
  );

  assert.ok(await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaRaw));
  assert.ok(await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaCleaned));
  assert.ok(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.figmaFetchDiagnostics));
  assert.ok(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.figmaCleanedReport));
});

test("FigmaSourceService maps missing local_json path to E_FIGMA_LOCAL_JSON_PATH", async () => {
  const { stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    }
  });

  await assert.rejects(
    async () => {
      await FigmaSourceService.execute({}, stageContextFor("figma.source"));
    },
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "E_FIGMA_LOCAL_JSON_PATH"
  );
});

test("IrDeriveService writes design.ir and figma.analysis for cleaned local_json input", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    }
  });
  const localPayloadPath = path.join(executionContext.paths.jobDir, "local-figma.json");
  await writeFile(localPayloadPath, `${JSON.stringify(createLocalFigmaPayload(), null, 2)}\n`, "utf8");

  await FigmaSourceService.execute(
    {
      figmaJsonPath: localPayloadPath
    },
    stageContextFor("figma.source")
  );
  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));

  assert.equal(await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.designIr), executionContext.paths.designIrFile);
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaAnalysis),
    executionContext.paths.figmaAnalysisFile
  );
  assert.equal((await readFile(executionContext.paths.figmaAnalysisFile, "utf8")).includes("\"artifactVersion\": 1"), true);
});

test("IrDeriveService cache hits still write and register figma.analysis", async () => {
  const sharedRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-service-cache-"));
  const first = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    },
    rootDir: sharedRoot,
    jobId: "job-stage-cache-seed"
  });
  const second = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    },
    rootDir: sharedRoot,
    jobId: "job-stage-cache-hit"
  });
  const payload = createLocalFigmaPayload();
  const firstLocalPayloadPath = path.join(first.executionContext.paths.jobDir, "local-figma.json");
  const secondLocalPayloadPath = path.join(second.executionContext.paths.jobDir, "local-figma.json");
  await writeFile(firstLocalPayloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(secondLocalPayloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  await FigmaSourceService.execute(
    {
      figmaJsonPath: firstLocalPayloadPath
    },
    first.stageContextFor("figma.source")
  );
  const cleanedFile = JSON.parse(await readFile(first.executionContext.paths.figmaJsonFile, "utf8")) as unknown;
  await saveCachedIr({
    cacheDir: first.executionContext.paths.irCacheDir,
    contentHash: computeContentHash(cleanedFile),
    optionsHash: computeOptionsHash({
      screenElementBudget: first.executionContext.runtime.figmaScreenElementBudget,
      screenElementMaxDepth: first.executionContext.runtime.figmaScreenElementMaxDepth,
      brandTheme: first.executionContext.resolvedBrandTheme,
      figmaSourceMode: first.executionContext.resolvedFigmaSourceMode
    }),
    ttlMs: first.executionContext.runtime.irCacheTtlMs,
    ir: createMinimalIr(),
    onLog: () => {
      // no-op for cache seeding in tests
    }
  });

  await FigmaSourceService.execute(
    {
      figmaJsonPath: secondLocalPayloadPath
    },
    second.stageContextFor("figma.source")
  );
  await IrDeriveService.execute(undefined, second.stageContextFor("ir.derive"));

  assert.equal(await second.executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.designIr), second.executionContext.paths.designIrFile);
  assert.equal(
    await second.executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaAnalysis),
    second.executionContext.paths.figmaAnalysisFile
  );
  assert.equal((await readFile(second.executionContext.paths.designIrFile, "utf8")).includes("Screen 1"), true);
  assert.equal((await readFile(second.executionContext.paths.figmaAnalysisFile, "utf8")).includes("\"artifactVersion\": 1"), true);
});

test("IrDeriveService regeneration reads seeded artifacts and writes design.ir and figma.analysis", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    mode: "regeneration"
  });
  const sourceIrPath = path.join(executionContext.paths.jobDir, "source-ir.json");
  const sourceAnalysisPath = path.join(executionContext.paths.jobDir, "source-figma-analysis.json");
  await writeFile(sourceIrPath, `${JSON.stringify(createMinimalIr(), null, 2)}\n`, "utf8");
  await writeFile(
    sourceAnalysisPath,
    `${JSON.stringify({ artifactVersion: 1, sourceName: "test", summary: { topLevelFrameCount: 1 } }, null, 2)}\n`,
    "utf8"
  );
  await seedRegenerationArtifacts({
    executionContext,
    sourceJobId: "source-job",
    sourceIrFile: sourceIrPath,
    sourceAnalysisFile: sourceAnalysisPath
  });

  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));

  assert.equal(await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.designIr), executionContext.paths.designIrFile);
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaAnalysis),
    executionContext.paths.figmaAnalysisFile
  );
  assert.equal((await readFile(executionContext.paths.designIrFile, "utf8")).includes("Screen 1"), true);
  assert.equal((await readFile(executionContext.paths.figmaAnalysisFile, "utf8")).includes("\"artifactVersion\": 1"), true);
});

test("IrDeriveService maps missing source design IR to E_REGEN_SOURCE_IR_MISSING", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    mode: "regeneration"
  });
  await seedRegenerationArtifacts({
    executionContext,
    sourceJobId: "missing-source"
  });

  await assert.rejects(
    async () => {
      await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));
    },
    (error: unknown) =>
      error instanceof Error && "code" in error && (error as { code: string }).code === "E_REGEN_SOURCE_IR_MISSING"
  );
});

test("TemplatePrepareService copies template and stores generated.project artifact", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await mkdir(executionContext.paths.templateRoot, { recursive: true });
  await writeFile(path.join(executionContext.paths.templateRoot, "template.txt"), "template\n", "utf8");

  await TemplatePrepareService.execute(undefined, stageContextFor("template.prepare"));

  assert.equal(
    await readFile(path.join(executionContext.paths.generatedProjectDir, "template.txt"), "utf8"),
    "template\n"
  );
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generatedProject),
    executionContext.paths.generatedProjectDir
  );
});

test("TemplatePrepareService applies customer profile template dependencies and aliases when configured", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    runtimeOverrides: {
      customerProfile: createCustomerProfileForStageServices()
    }
  });
  await mkdir(executionContext.paths.templateRoot, { recursive: true });
  await writeFile(
    path.join(executionContext.paths.templateRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "generated-app",
        private: true,
        dependencies: {},
        devDependencies: {}
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.templateRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true
        },
        include: ["src", "vite.config.ts"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.templateRoot, "vite.config.ts"),
    `import { defineConfig } from "vitest/config";

const normalizedBasePath = "./";

export default defineConfig({
  base: normalizedBasePath,
  test: {
    globals: true
  }
});
`,
    "utf8"
  );

  await TemplatePrepareService.execute(undefined, stageContextFor("template.prepare"));

  const packageJson = JSON.parse(
    await readFile(path.join(executionContext.paths.generatedProjectDir, "package.json"), "utf8")
  ) as { dependencies?: Record<string, string> };
  assert.equal(packageJson.dependencies?.["@customer/components"], "^1.2.3");

  const tsconfig = JSON.parse(
    await readFile(path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"), "utf8")
  ) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
  assert.equal(tsconfig.compilerOptions?.baseUrl, ".");
  assert.deepEqual(tsconfig.compilerOptions?.paths?.["@customer/ui"], ["@customer/components"]);

  const viteConfig = await readFile(path.join(executionContext.paths.generatedProjectDir, "vite.config.ts"), "utf8");
  assert.equal(viteConfig.includes('"@customer/ui": "@customer/components"'), true);
});

test("TemplatePrepareService maps missing template to E_TEMPLATE_MISSING", async () => {
  const { stageContextFor } = await createExecutionContext({});

  await assert.rejects(
    async () => {
      await TemplatePrepareService.execute(undefined, stageContextFor("template.prepare"));
    },
    (error: unknown) =>
      error instanceof Error && "code" in error && (error as { code: string }).code === "E_TEMPLATE_MISSING"
  );
});

test("CodegenGenerateService reads design.ir and stores summary, manifest, metrics, and diff context", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  await writeFile(path.join(executionContext.paths.generatedProjectDir, "generation-metrics.json"), "{}\n", "utf8");
  const service = createCodegenGenerateService({
    exportImageAssetsFromFigmaFn: async () => ({ imageAssetMap: {} }),
    generateArtifactsStreamingFn: async function* () {
      yield { type: "progress", screenIndex: 1, screenCount: 1, screenName: "Screen 1" } as const;
      return { generatedPaths: ["generation-metrics.json"] };
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await service.execute(
    {
      boardKeySeed: "demo-board"
    },
    stageContextFor("codegen.generate")
  );

  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generatedProject),
    executionContext.paths.generatedProjectDir
  );
  assert.deepEqual(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.codegenSummary), {
    generatedPaths: ["generation-metrics.json"]
  });
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generationMetrics),
    path.join(executionContext.paths.generatedProjectDir, "generation-metrics.json")
  );
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.componentManifest),
    path.join(executionContext.paths.generatedProjectDir, "component-manifest.json")
  );
  assert.deepEqual(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.generationDiffContext), {
    boardKey: resolveBoardKey("demo-board")
  });
  assert.equal(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.generationDiff), undefined);
  assert.equal(await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generationDiffFile), undefined);
});

test("CodegenGenerateService accepts all streaming artifact event variants without special-case handling", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  await writeFile(path.join(executionContext.paths.generatedProjectDir, "generation-metrics.json"), "{}\n", "utf8");

  const generationSummary = {
    generatedPaths: [
      "src/theme/tokens.json",
      "src/theme/theme.ts",
      "src/ErrorBoundary.tsx",
      "src/screens/Screen.tsx",
      "src/App.tsx",
      "generation-metrics.json"
    ],
    generationMetrics: {
      fetchedNodes: 0,
      skippedHidden: 0,
      skippedPlaceholders: 0,
      screenElementCounts: [],
      truncatedScreens: [],
      degradedGeometryNodes: [],
      prototypeNavigationDetected: 0,
      prototypeNavigationResolved: 0,
      prototypeNavigationUnresolved: 0,
      prototypeNavigationRendered: 0
    },
    themeApplied: false,
    screenApplied: 0,
    screenTotal: 1,
    screenRejected: [],
    llmWarnings: [],
    mappingCoverage: {
      usedMappings: 0,
      fallbackNodes: 0,
      totalCandidateNodes: 0
    },
    mappingDiagnostics: {
      missingMappingCount: 0,
      contractMismatchCount: 0,
      disabledMappingCount: 0
    },
    mappingWarnings: []
  };

  const service = createCodegenGenerateService({
    exportImageAssetsFromFigmaFn: async () => ({ imageAssetMap: {} }),
    generateArtifactsStreamingFn: async function* () {
      yield {
        type: "theme",
        files: [
          { path: "src/theme/tokens.json", content: "{}" },
          { path: "src/theme/theme.ts", content: "export const theme = {};\n" }
        ]
      } as const;
      yield {
        type: "screen",
        screenName: "Screen 1",
        files: [{ path: "src/screens/Screen.tsx", content: "export function Screen() { return null; }\n" }]
      } as const;
      yield { type: "progress", screenIndex: 1, screenCount: 1, screenName: "Screen 1" } as const;
      yield { type: "app", file: { path: "src/App.tsx", content: "export default function App() { return null; }\n" } } as const;
      yield { type: "metrics", file: { path: "generation-metrics.json", content: "{}\n" } } as const;
      return generationSummary;
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await service.execute(
    {
      boardKeySeed: "demo-board"
    },
    stageContextFor("codegen.generate")
  );

  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generatedProject),
    executionContext.paths.generatedProjectDir
  );
  assert.deepEqual(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.codegenSummary), generationSummary);
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generationMetrics),
    path.join(executionContext.paths.generatedProjectDir, "generation-metrics.json")
  );
  assert.ok(
    executionContext.job.logs.some((entry) => entry.message.includes("Screen 1/1 completed: 'Screen 1'")),
    "progress events should still be logged"
  );
});

test("CodegenGenerateService maps invalid design.ir JSON to E_IR_EMPTY", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await writeFile(executionContext.paths.designIrFile, "{", "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  const service = createCodegenGenerateService({
    generateArtifactsStreamingFn: async function* () {
      return { generatedPaths: [] };
    }
  });

  await assert.rejects(
    async () => {
      await service.execute({ boardKeySeed: "demo-board" }, stageContextFor("codegen.generate"));
    },
    (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "E_IR_EMPTY"
  );
});

test("ValidateProjectService reads generated.project and writes validation.summary", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    runtimeOverrides: {
      commandStdoutMaxBytes: 12_345,
      commandStderrMaxBytes: 54_321
    }
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-abc1234567"
    } satisfies GenerationDiffContext
  });
  let calledInput:
    | {
        generatedProjectDir: string;
        jobDir?: string;
        commandStdoutMaxBytes?: number;
        commandStderrMaxBytes?: number;
      }
    | undefined;
  const service = createValidateProjectService({
    runProjectValidationFn: async (input) => {
      calledInput = {
        generatedProjectDir: input.generatedProjectDir,
        jobDir: input.jobDir,
        commandStdoutMaxBytes: input.commandStdoutMaxBytes,
        commandStderrMaxBytes: input.commandStderrMaxBytes
      };
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  assert.equal(calledInput?.generatedProjectDir, executionContext.paths.generatedProjectDir);
  assert.equal(calledInput?.jobDir, executionContext.paths.jobDir);
  assert.equal(calledInput?.commandStdoutMaxBytes, 12_345);
  assert.equal(calledInput?.commandStderrMaxBytes, 54_321);
  const summary = await executionContext.artifactStore.getValue<{ status: string }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "ok");
});

test("ValidateProjectService persists failed customer profile import policy before project validation", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    runtimeOverrides: {
      customerProfile: createCustomerProfileForStageServices()
    }
  });
  await mkdir(path.join(executionContext.paths.generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "generated-app",
        private: true,
        dependencies: {},
        devDependencies: {}
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true
        },
        include: ["src", "vite.config.ts"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "vite.config.ts"),
    `import { defineConfig } from "vitest/config";

const normalizedBasePath = "./";

export default defineConfig({
  base: normalizedBasePath,
  test: {
    globals: true
  }
});
`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "src", "App.tsx"),
    'import { Button } from "@mui/material";\nexport const App = () => <Button />;\n',
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-abc1234567"
    } satisfies GenerationDiffContext
  });

  let validationInvoked = false;
  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      validationInvoked = true;
    }
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    /Customer profile import policy failed/
  );

  assert.equal(validationInvoked, false);
  const summary = await executionContext.artifactStore.getValue<{
    status: string;
    customerProfile?: { import?: { issueCount?: number } };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "failed");
  assert.equal((summary?.customerProfile?.import?.issueCount ?? 0) > 0, true);
});

test("ValidateProjectService forwards aborted signal to project validation", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  executionContext.jobAbortController.abort();
  const service = createValidateProjectService({
    runProjectValidationFn: async (input) => {
      assert.equal(input.abortSignal?.aborted, true);
      throw new DOMException("aborted", "AbortError");
    }
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    (error: unknown) => error instanceof DOMException && error.name === "AbortError"
  );
});

test("ReproExportService copies dist output and writes repro.path", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    runtimeOverrides: { enablePreview: true }
  });
  const distDir = path.join(executionContext.paths.generatedProjectDir, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "<html></html>\n", "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });

  await ReproExportService.execute(undefined, stageContextFor("repro.export"));

  assert.equal(await readFile(path.join(executionContext.paths.reproDir, "index.html"), "utf8"), "<html></html>\n");
  assert.equal(await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.reproPath), executionContext.paths.reproDir);
});

test("GitPrService reads generation diff from the store and writes git.pr.status", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "codegen.generate",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiff,
    stage: "codegen.generate",
    value: {
      summary: "diff ready"
    }
  });
  let receivedGenerationDiff: unknown;
  const service = createGitPrService({
    runGitPrFlowFn: async (input) => {
      receivedGenerationDiff = input.generationDiff;
      return {
        status: "executed",
        prUrl: "https://example.invalid/pr/1",
        branchName: "feature/test",
        scopePath: "src",
        changedFiles: 3
      };
    }
  });

  await service.execute(
    {
      enableGitPr: true,
      repoUrl: "https://example.invalid/repo.git"
    },
    stageContextFor("git.pr")
  );

  assert.deepEqual(receivedGenerationDiff, { summary: "diff ready" });
  const gitStatus = await executionContext.artifactStore.getValue<{ status: string }>(STAGE_ARTIFACT_KEYS.gitPrStatus);
  assert.equal(gitStatus?.status, "executed");
});

test("ValidateProjectService recomputes generation diff after validation", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-abc1234567"
    } satisfies GenerationDiffContext
  });

  let diffCallArgs: { boardKey: string; jobId: string } | undefined;
  const updatedDiff = {
    boardKey: "test-board-abc1234567",
    currentJobId: "job-stage-test",
    previousJobId: null,
    generatedAt: new Date().toISOString(),
    added: ["src/App.tsx"],
    modified: [{ file: "src/App.tsx", previousHash: "aaa", currentHash: "bbb" }],
    removed: [],
    unchanged: [],
    summary: "1 file modified, 1 added"
  };

  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      // simulate lint --fix mutating a file
    },
    prepareGenerationDiffFn: async (input) => {
      diffCallArgs = { boardKey: input.boardKey, jobId: input.jobId };
      return {
        report: updatedDiff,
        snapshot: {
          boardKey: input.boardKey,
          jobId: input.jobId,
          generatedAt: new Date().toISOString(),
          files: []
        }
      };
    },
    writeGenerationDiffReportFn: async ({ jobDir }) => {
      return path.join(jobDir, "generation-diff.json");
    },
    saveCurrentSnapshotFn: async () => {
      // no-op for this contract test
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  assert.ok(diffCallArgs);
  assert.equal(diffCallArgs.boardKey, "test-board-abc1234567");
  assert.equal(diffCallArgs.jobId, "job-stage-test");

  const storedDiff = await executionContext.artifactStore.getValue<{ summary: string }>(STAGE_ARTIFACT_KEYS.generationDiff);
  assert.equal(storedDiff?.summary, "1 file modified, 1 added");

  const diffFilePath = await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generationDiffFile);
  assert.equal(diffFilePath, path.join(executionContext.paths.jobDir, "generation-diff.json"));
});

test("ValidateProjectService fails when generation diff context is missing", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => {}
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    /generation\.diff\.context/
  );
});

test("ValidateProjectService failure preserves the previous successful diff baseline", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-abc1234567"
    } satisfies GenerationDiffContext
  });
  await saveCurrentSnapshot({
    outputRoot: executionContext.resolvedPaths.outputRoot,
    snapshot: {
      boardKey: "test-board-abc1234567",
      jobId: "job-previous-success",
      generatedAt: new Date().toISOString(),
      files: [{ relativePath: "src/App.tsx", sha256: "aaa", sizeBytes: 1 }]
    }
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      throw new Error("lint failed");
    }
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    /lint failed/
  );

  const summary = await executionContext.artifactStore.getValue<{ status: string }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary, undefined);
  const preservedSnapshot = await loadPreviousSnapshot({
    outputRoot: executionContext.resolvedPaths.outputRoot,
    boardKey: "test-board-abc1234567"
  });
  assert.ok(preservedSnapshot !== null);
  assert.equal(preservedSnapshot.jobId, "job-previous-success");
});

test("ValidateProjectService fails fast when final diff persistence fails", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-abc1234567"
    } satisfies GenerationDiffContext
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => {},
    prepareGenerationDiffFn: async (input) => {
      return {
        report: {
          boardKey: input.boardKey,
          currentJobId: input.jobId,
          previousJobId: "job-previous-success",
          generatedAt: new Date().toISOString(),
          added: ["src/App.tsx"],
          modified: [],
          removed: [],
          unchanged: [],
          summary: "1 added"
        },
        snapshot: {
          boardKey: input.boardKey,
          jobId: input.jobId,
          generatedAt: new Date().toISOString(),
          files: []
        }
      };
    },
    writeGenerationDiffReportFn: async () => {
      throw new Error("disk full");
    }
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    /disk full/
  );

  assert.equal(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.validationSummary), undefined);
  assert.equal(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.generationDiff), undefined);
  assert.equal(await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generationDiffFile), undefined);
});

test("GitPrService receives the final validation-owned generation diff", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const boardKey = "test-board-final-diff";
  const generatedProjectDir = executionContext.paths.generatedProjectDir;
  const utilsFile = path.join(generatedProjectDir, "src", "utils.ts");

  await mkdir(path.dirname(utilsFile), { recursive: true });
  await writeFile(path.join(generatedProjectDir, "src", "App.tsx"), "export default function App() {}\n", "utf8");
  await writeFile(utilsFile, "export const add = (a: number, b: number) => a + b;\n", "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: { boardKey } satisfies GenerationDiffContext
  });
  await saveCurrentSnapshot({
    outputRoot: executionContext.resolvedPaths.outputRoot,
    snapshot: {
      boardKey,
      jobId: "job-previous-success",
      generatedAt: new Date().toISOString(),
      files: [{ relativePath: "src/utils.ts", sha256: "old-utils", sizeBytes: 1 }]
    }
  });

  const validateService = createValidateProjectService({
    runProjectValidationFn: async () => {
      await writeFile(utilsFile, "export const add = (a: number, b: number): number => a + b;\n", "utf8");
    }
  });
  await validateService.execute(undefined, stageContextFor("validate.project"));

  let receivedGenerationDiff: unknown;
  const gitPrService = createGitPrService({
    runGitPrFlowFn: async (input) => {
      receivedGenerationDiff = input.generationDiff;
      return {
        status: "executed",
        branchName: "feature/final-diff",
        scopePath: "src",
        changedFiles: 2
      };
    }
  });
  await gitPrService.execute(
    {
      enableGitPr: true,
      repoUrl: "https://example.invalid/repo.git"
    },
    stageContextFor("git.pr")
  );

  assert.ok(receivedGenerationDiff);
  assert.deepEqual(receivedGenerationDiff, {
    boardKey,
    currentJobId: executionContext.job.jobId,
    previousJobId: "job-previous-success",
    generatedAt: (receivedGenerationDiff as { generatedAt: string }).generatedAt,
    added: ["src/App.tsx"],
    modified: [
      {
        file: "src/utils.ts",
        previousHash: "old-utils",
        currentHash: (receivedGenerationDiff as { modified: Array<{ currentHash: string }> }).modified[0]?.currentHash
      }
    ],
    removed: [],
    unchanged: [],
    summary: "1 file modified, 1 added"
  });
});
