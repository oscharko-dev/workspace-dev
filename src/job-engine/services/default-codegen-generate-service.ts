import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildComponentManifest } from "../../parity/component-manifest.js";
import type { ScreenArtifactIdentity } from "../../parity/generator-artifacts.js";
import {
  createDefaultLayoutReportFile,
  createDefaultAccessibilityReportFile,
  createDefaultSemanticComponentReportFile,
  createDefaultTailwindScreenFiles,
} from "../../parity/default-tailwind-emitter.js";
import {
  createDesignTokenCssFile,
  createDesignTokenReportFile,
  DESIGN_TOKENS_JSON_PATH,
} from "../../parity/design-token-compiler.js";
import type { GeneratedFile } from "../../parity/types.js";
import type { DesignIR, ScreenElementIR } from "../../parity/types-ir.js";
import { resolveBoardKey } from "../../parity/board-key.js";
import { pruneDesignIrToSelectedNodeIds } from "../scoped-design-ir.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import {
  isDesignIRShape,
  validatedJsonParse,
} from "../pipeline/pipeline-schemas.js";
import type { StageService } from "../pipeline/stage-service.js";
import { createPipelineError } from "../errors.js";
import type {
  CodegenGenerateStageInput,
  CodegenGenerateSummary,
} from "./codegen-generate-types.js";
import type { GenerationDiffContext } from "../generation-diff.js";

const GENERATED_APP_TEST_PATH = "src/App.test.tsx";

const collectElements = (
  elements: readonly ScreenElementIR[] | undefined,
): ScreenElementIR[] => {
  const collected: ScreenElementIR[] = [];
  const visit = (element: ScreenElementIR): void => {
    collected.push(element);
    for (const child of element.children ?? []) {
      visit(child);
    }
  };
  for (const element of elements ?? []) {
    visit(element);
  }
  return collected;
};

const toSafeImportName = (screenName: string, index: number): string => {
  const words = screenName
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .split(/[\s_-]+/)
    .filter(Boolean);
  const candidate = words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("");
  const base = /^[A-Z]/.test(candidate) ? candidate : `Screen${candidate}`;
  return `${base || "GeneratedScreen"}${String(index + 1)}`;
};

const escapeString = (value: string): string => JSON.stringify(value);

const createAppFile = (
  screenFiles: readonly { importName: string; importPath: string }[],
): GeneratedFile => {
  const imports = screenFiles
    .map((screen) => `import ${screen.importName} from "./${screen.importPath.replace(/\.tsx$/u, "")}";`)
    .join("\n");
  const renderedScreens =
    screenFiles.length === 0
      ? '      <p className="text-sm text-slate-600">No screens were emitted for this design.</p>'
      : screenFiles
          .map((screen) => `      <${screen.importName} />`)
          .join("\n");
  return {
    path: "src/App.tsx",
    content: `${imports ? `${imports}\n` : ""}import "./theme/tokens.css";

export default function App() {
  return (
    <div data-testid="generated-app" className="min-h-screen bg-[var(--color-background)] text-[var(--color-text)]">
${renderedScreens}
    </div>
  );
}
`,
  };
};

const createAppTestFile = (sourceName: string): GeneratedFile => ({
  path: GENERATED_APP_TEST_PATH,
  content: `import { render, screen } from "@testing-library/react";
import App from "./App.tsx";

test(${escapeString(`renders generated ${sourceName || "workspace"} app`)}, () => {
  render(<App />);

  expect(screen.getByTestId("generated-app")).toBeInTheDocument();
});
`,
});

const writeGeneratedFile = async (
  rootDir: string,
  file: GeneratedFile,
): Promise<void> => {
  const root = path.resolve(rootDir);
  const absolutePath = path.resolve(rootDir, file.path);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Generated file path escapes generated project root: ${file.path}`);
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.content, "utf8");
};

const writeJsonFile = async ({
  filePath,
  payload,
}: {
  filePath: string;
  payload: unknown;
}): Promise<void> => {
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
};

const createGenerationMetrics = (ir: DesignIR): Record<string, unknown> => ({
  fetchedNodes: ir.metrics?.fetchedNodes ?? 0,
  skippedHidden: ir.metrics?.skippedHidden ?? 0,
  skippedPlaceholders: ir.metrics?.skippedPlaceholders ?? 0,
  screenElementCounts: ir.screens.map((screen) => ({
    screenId: screen.id,
    screenName: screen.name,
    elements: collectElements(screen.children).length,
  })),
  truncatedScreens: [...(ir.metrics?.truncatedScreens ?? [])],
  ...(ir.metrics?.depthTruncatedScreens
    ? { depthTruncatedScreens: [...ir.metrics.depthTruncatedScreens] }
    : {}),
  ...(ir.metrics?.classificationFallbacks
    ? { classificationFallbacks: [...ir.metrics.classificationFallbacks] }
    : {}),
  degradedGeometryNodes: [...(ir.metrics?.degradedGeometryNodes ?? [])],
  prototypeNavigationDetected: ir.metrics?.prototypeNavigationDetected ?? 0,
  prototypeNavigationResolved: ir.metrics?.prototypeNavigationResolved ?? 0,
  prototypeNavigationUnresolved: ir.metrics?.prototypeNavigationUnresolved ?? 0,
  prototypeNavigationRendered: 0,
  ...(ir.metrics?.nodeDiagnostics
    ? { nodeDiagnostics: [...ir.metrics.nodeDiagnostics] }
    : {}),
  ...(ir.metrics?.mcpCoverage
    ? { mcpCoverage: { ...ir.metrics.mcpCoverage } }
    : {}),
  ...(ir.metrics?.generatedSourceValidation
    ? { generatedSourceValidation: { ...ir.metrics.generatedSourceValidation } }
    : {}),
});

export const DefaultCodegenGenerateService: StageService<CodegenGenerateStageInput> = {
  stageName: "codegen.generate",
  execute: async (input, context) => {
    const designIrPath = await context.artifactStore.requirePath(
      STAGE_ARTIFACT_KEYS.designIr,
    );
    let ir: DesignIR;
    try {
      ir = validatedJsonParse({
        raw: await readFile(designIrPath, "utf8"),
        guard: isDesignIRShape,
        schema: "DesignIR",
        filePath: designIrPath,
      });
    } catch (error) {
      throw createPipelineError({
        code: "E_IR_EMPTY",
        stage: "codegen.generate",
        message: "Design IR is missing before code generation.",
        cause: error,
        limits: context.runtime.pipelineDiagnosticLimits,
      });
    }

    if (
      context.mode === "submission" &&
      Array.isArray(context.input?.selectedNodeIds) &&
      context.input.selectedNodeIds.length > 0
    ) {
      ir = pruneDesignIrToSelectedNodeIds({
        ir,
        selectedNodeIds: context.input.selectedNodeIds,
      });
      await writeFile(designIrPath, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
      await context.artifactStore.setPath({
        key: STAGE_ARTIFACT_KEYS.designIr,
        stage: "codegen.generate",
        absolutePath: designIrPath,
      });
    }

    await mkdir(path.join(context.paths.generatedProjectDir, "src", "theme"), {
      recursive: true,
    });
    await mkdir(path.join(context.paths.generatedProjectDir, "src", "generated"), {
      recursive: true,
    });
    await mkdir(path.join(context.paths.generatedProjectDir, "src", "pages"), {
      recursive: true,
    });
    await mkdir(
      path.join(context.paths.generatedProjectDir, "src", "components"),
      { recursive: true },
    );

    const generatedFiles: GeneratedFile[] = [
      {
        path: DESIGN_TOKENS_JSON_PATH,
        content: `${JSON.stringify(ir.tokens, null, 2)}\n`,
      },
      createDesignTokenCssFile(ir, {
        pipelineId: context.pipelineMetadata.pipelineId,
      }),
      createDesignTokenReportFile(ir, {
        pipelineId: context.pipelineMetadata.pipelineId,
      }),
      createDefaultAccessibilityReportFile(ir.screens),
      createDefaultLayoutReportFile(ir.screens),
      createDefaultSemanticComponentReportFile(ir.screens),
    ];

    const pageImports: Array<{ importName: string; importPath: string }> = [];
    const identitiesByScreenId = new Map<string, ScreenArtifactIdentity>();
    const screenFiles = createDefaultTailwindScreenFiles(ir.screens);
    for (const [index, screenFile] of screenFiles.entries()) {
      const screen = ir.screens[index]!;
      generatedFiles.push(screenFile.file, ...screenFile.componentFiles);
      const importName = toSafeImportName(screen.name, index);
      const importPath = screenFile.file.path.replace(/^src\//u, "");
      pageImports.push({
        importName,
        importPath,
      });
      identitiesByScreenId.set(screen.id, {
        componentName: importName,
        filePath: screenFile.file.path,
        routePath: `/${path.basename(screenFile.file.path, ".tsx")}`,
      });
      for (const warning of screenFile.warnings) {
        context.log({
          level: "warn",
          message: warning.message,
        });
      }
      for (const diagnostic of screenFile.semanticDiagnostics) {
        context.log({
          level: "warn",
          message: diagnostic.message,
        });
      }
    }

    generatedFiles.push(createAppFile(pageImports));
    generatedFiles.push(createAppTestFile(ir.sourceName));

    for (const file of generatedFiles) {
      await writeGeneratedFile(context.paths.generatedProjectDir, file);
    }

    const generationMetricsPath = path.join(
      context.paths.generatedProjectDir,
      "generation-metrics.json",
    );
    const generationMetrics = createGenerationMetrics(ir);
    await writeJsonFile({
      filePath: generationMetricsPath,
      payload: generationMetrics,
    });

    const manifestPath = path.join(
      context.paths.generatedProjectDir,
      "component-manifest.json",
    );
    const manifest = await buildComponentManifest({
      projectDir: context.paths.generatedProjectDir,
      screens: ir.screens,
      identitiesByScreenId,
    });
    await writeJsonFile({
      filePath: manifestPath,
      payload: manifest,
    });

    await context.artifactStore.setPath({
      key: STAGE_ARTIFACT_KEYS.generatedProject,
      stage: "codegen.generate",
      absolutePath: context.paths.generatedProjectDir,
    });
    await context.artifactStore.setPath({
      key: STAGE_ARTIFACT_KEYS.generationMetrics,
      stage: "codegen.generate",
      absolutePath: generationMetricsPath,
    });
    await context.artifactStore.setPath({
      key: STAGE_ARTIFACT_KEYS.componentManifest,
      stage: "codegen.generate",
      absolutePath: manifestPath,
    });

    const generatedPaths = [
      ...generatedFiles.map((file) => file.path),
      "generation-metrics.json",
      "component-manifest.json",
    ].sort((left, right) => left.localeCompare(right));
    const generationSummary: CodegenGenerateSummary = {
      generatedPaths,
      generationMetrics,
      themeApplied: true,
      screenApplied: ir.screens.length,
      screenTotal: ir.screens.length,
      screenRejected: [],
      llmWarnings: [],
    };
    await context.artifactStore.setValue({
      key: STAGE_ARTIFACT_KEYS.codegenSummary,
      stage: "codegen.generate",
      value: generationSummary,
    });
    const diffContext: GenerationDiffContext = {
      boardKey: resolveBoardKey(input.boardKeySeed),
    };
    await context.artifactStore.setValue({
      key: STAGE_ARTIFACT_KEYS.generationDiffContext,
      stage: "codegen.generate",
      value: diffContext,
    });
    await context.syncPublicJobProjection();
    context.log({
      level: "info",
      message: `Generated default React/TypeScript/Tailwind artifacts for ${ir.screens.length} screen(s).`,
    });
  },
};
