import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkspaceJobInput } from "../src/contracts/index.js";
import type { WorkspaceJobStageName } from "../src/contracts/index.js";
import { createInitialStages, nowIso } from "../src/job-engine/stage-state.js";
import { resolveRuntimeSettings } from "../src/job-engine/runtime.js";
import { createTemplateCopyFilter } from "../src/job-engine/template-copy-filter.js";
import { StageArtifactStore } from "../src/job-engine/pipeline/artifact-store.js";
import {
  createStageRuntimeContext,
  type PipelineExecutionContext,
  type StageRuntimeContext,
} from "../src/job-engine/pipeline/context.js";
import { FigmaSourceService } from "../src/job-engine/services/figma-source-service.js";
import { IrDeriveService } from "../src/job-engine/services/ir-derive-service.js";
import { TemplatePrepareService } from "../src/job-engine/services/template-prepare-service.js";
import { createCodegenGenerateService } from "../src/job-engine/services/codegen-generate-service.js";
import { createValidateProjectService } from "../src/job-engine/services/validate-project-service.js";
import type { JobRecord } from "../src/job-engine/types.js";
import { ensureTemplateValidationSeedNodeModules } from "../src/job-engine/test-validation-seed.js";
import { comparePngBuffers } from "../src/job-engine/visual-diff.js";
import { computeVisualQualityReport } from "../src/job-engine/visual-scoring.js";
import {
  assertVisualBrowserName,
  computeCrossBrowserConsistencyScore,
  DEFAULT_VISUAL_BROWSER,
  type CrossBrowserConsistencyResult,
  type CrossBrowserPairwiseDiff,
  isVisualBrowserName,
  normalizeVisualBrowserNames,
  type VisualBrowserName,
  VISUAL_BROWSER_NAMES,
} from "../src/job-engine/visual-browser-matrix.js";
import { captureFromProject } from "../src/job-engine/visual-capture.js";
import {
  computeVisualBenchmarkAggregateScore,
  enumerateFixtureScreens,
  enumerateFixtureScreenViewports,
  loadVisualBenchmarkFixtureInputs,
  loadVisualBenchmarkFixtureMetadata,
  resolveVisualBenchmarkFixturePaths,
  resolveVisualBenchmarkScreenPaths,
  resolveVisualBenchmarkScreenViewportPaths,
  toScreenIdToken,
  toStableJsonString,
  type VisualBenchmarkFixtureMetadata,
  type VisualBenchmarkFixtureOptions,
  type VisualBenchmarkFixtureScreenMetadata,
  type VisualBenchmarkFixtureMode,
  type VisualBenchmarkViewportSpec,
} from "./visual-benchmark.helpers.js";
import {
  applyVisualQualityConfigToReport,
  normalizeVisualQualityViewportWeights,
  resolveVisualQualityViewports,
  type VisualQualityConfig,
} from "./visual-quality-config.js";
import type { WorkspaceVisualQualityReport } from "../src/contracts/index.js";
import { PNG } from "pngjs";

const DEFAULT_WORKSPACE_ROOT = process.cwd();

export type BenchmarkBrowserName = VisualBrowserName;

export const BENCHMARK_BROWSER_NAMES =
  VISUAL_BROWSER_NAMES as readonly BenchmarkBrowserName[];

const DEFAULT_BENCHMARK_BROWSER: BenchmarkBrowserName = DEFAULT_VISUAL_BROWSER;

export interface VisualBenchmarkExecutionOptions extends VisualBenchmarkFixtureOptions {
  allowIncompleteVisualQuality?: boolean;
  qualityConfig?: VisualQualityConfig;
  storybookStaticDir?: string;
  viewportId?: string;
  referenceOverridePath?: string;
  referenceOverrideViewportId?: string;
  workspaceRoot?: string;
  browsers?: readonly BenchmarkBrowserName[];
  loadBrowser?: (
    browser: BenchmarkBrowserName,
  ) => Promise<PlaywrightBrowserType>;
}

export interface VisualBenchmarkFixtureExecutionResult {
  fixtureId: string;
  score: number;
}

export interface VisualBenchmarkFixtureExecutionArtifacts extends VisualBenchmarkFixtureExecutionResult {
  screenshotBuffer: Buffer;
  diffBuffer: Buffer | null;
  report: unknown | null;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
}

export interface VisualBenchmarkScreenViewportArtifact {
  viewportId: string;
  viewportLabel?: string;
  score: number;
  screenshotBuffer: Buffer;
  diffBuffer: Buffer | null;
  report: unknown | null;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
  browserArtifacts?: BrowserScreenViewportArtifact[];
  crossBrowserConsistency?: CrossBrowserConsistencyResult;
}

export interface BrowserScreenViewportArtifact extends VisualBenchmarkScreenViewportArtifact {
  browser: BenchmarkBrowserName;
}

export interface VisualBenchmarkFixtureScreenArtifact {
  screenId: string;
  screenName: string;
  nodeId: string;
  status?: "completed" | "skipped";
  skipReason?: string;
  warnings?: string[];
  score: number;
  weight?: number;
  screenshotBuffer: Buffer;
  diffBuffer: Buffer | null;
  report: unknown | null;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
  viewports?: VisualBenchmarkScreenViewportArtifact[];
  browserArtifacts?: BrowserScreenViewportArtifact[];
  crossBrowserConsistency?: CrossBrowserConsistencyResult;
}

export interface VisualBenchmarkFixtureRunResult {
  fixtureId: string;
  aggregateScore: number;
  screens: VisualBenchmarkFixtureScreenArtifact[];
  warnings?: string[];
  screenAggregateScore?: number;
  componentAggregateScore?: number;
  componentCoverage?: {
    comparedCount: number;
    skippedCount: number;
    coveragePercent: number;
    bySkipReason: Record<string, number>;
  };
  crossBrowserConsistency?: CrossBrowserConsistencyResult;
  browserBreakdown?: Partial<Record<BenchmarkBrowserName, number>>;
}

interface VisualQualityFrozenReferenceOverride {
  imagePath: string;
  metadataPath: string;
}

const DEFAULT_MOBILE_DEVICE_SCALE_FACTOR = 3;
const STORYBOOK_CAPTURE_PADDING = 16;
const STORYBOOK_ROOT_SELECTOR = "#storybook-root";
const STORYBOOK_DEFAULT_DIR_CANDIDATES = [
  path.join("storybook-static", "storybook-static"),
  "storybook-static",
] as const;
const DEFAULT_DIFF_IMAGE_PATH = "visual-quality/diff.png";

interface StorybookCaptureBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StorybookStaticServer {
  baseUrl: string;
  close: () => Promise<void>;
}

interface PlaywrightBrowserType {
  launch(options?: { headless?: boolean }): Promise<PlaywrightBrowser>;
}

interface PlaywrightBrowser {
  newContext(options?: {
    viewport?: { width: number; height: number };
    deviceScaleFactor?: number;
    screen?: { width: number; height: number };
    isMobile?: boolean;
    hasTouch?: boolean;
    userAgent?: string;
  }): Promise<PlaywrightBrowserContext>;
  close(): Promise<void>;
}

interface PlaywrightBrowserContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightPage {
  goto(
    url: string,
    options?: { timeout?: number; waitUntil?: string },
  ): Promise<unknown>;
  waitForLoadState(
    state: string,
    options?: { timeout?: number },
  ): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
  screenshot(options?: { fullPage?: boolean; type?: string }): Promise<Buffer>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const cloneJsonValue = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

const isErrno = (error: unknown): error is NodeJS.ErrnoException & Error => {
  return error instanceof Error && "code" in error;
};

const isStorybookMode = (metadata: VisualBenchmarkFixtureMetadata): boolean =>
  metadata.mode === "storybook_component";

const createTransparentPngBuffer = ({
  width,
  height,
}: {
  width: number;
  height: number;
}): Buffer => {
  const png = new PNG({ width, height });
  png.data.fill(0);
  return PNG.sync.write(png);
};

const PLACEHOLDER_SCREENSHOT_BUFFER = createTransparentPngBuffer({
  width: 1,
  height: 1,
});

const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await stat(targetPath);
    return true;
  } catch (error: unknown) {
    if (isErrno(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const resolveStorybookStaticDir = async ({
  options,
  workspaceRoot,
}: {
  options?: VisualBenchmarkExecutionOptions;
  workspaceRoot: string;
}): Promise<string> => {
  const requested = options?.storybookStaticDir;
  if (typeof requested === "string" && requested.trim().length > 0) {
    const resolved = path.isAbsolute(requested)
      ? requested
      : path.resolve(workspaceRoot, requested);
    if (!(await fileExists(resolved))) {
      throw new Error(
        `Storybook static dir '${resolved}' does not exist for visual benchmark execution.`,
      );
    }
    return resolved;
  }

  for (const candidate of STORYBOOK_DEFAULT_DIR_CANDIDATES) {
    const resolved = path.resolve(workspaceRoot, candidate);
    if (await fileExists(resolved)) {
      return resolved;
    }
  }

  throw new Error(
    `Unable to locate a Storybook static dir under '${workspaceRoot}'. Checked: ${STORYBOOK_DEFAULT_DIR_CANDIDATES.join(", ")}.`,
  );
};

const getContentTypeForExtension = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "application/javascript; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
};

const resolveStorybookRequestPath = ({
  buildDir,
  requestUrl,
  baseUrl,
}: {
  buildDir: string;
  requestUrl: string | undefined;
  baseUrl: string;
}): string => {
  const parsedUrl = new URL(requestUrl ?? "/", baseUrl);
  const pathname = decodeURIComponent(parsedUrl.pathname);
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(
      `Refusing to serve Storybook traversal path '${pathname}'.`,
    );
  }
  const safePathname =
    path.posix.normalize(pathname) === "/"
      ? "/index.html"
      : path.posix.normalize(pathname);
  const relativePath = safePathname.startsWith("/")
    ? safePathname.slice(1)
    : safePathname;
  const candidatePath = path.resolve(buildDir, relativePath);
  const resolvedBuildDir = path.resolve(buildDir);
  if (
    candidatePath !== resolvedBuildDir &&
    !candidatePath.startsWith(`${resolvedBuildDir}${path.sep}`)
  ) {
    throw new Error(`Refusing to serve Storybook path outside build root.`);
  }
  return candidatePath;
};

const waitForServerReady = async (
  url: string,
  timeoutMs: number,
): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error(`Storybook static server did not become ready at '${url}'.`);
};

const createStorybookStaticServer = async (
  buildDir: string,
): Promise<StorybookStaticServer> => {
  const server = createServer((req, res) => {
    let filePath: string;
    try {
      filePath = resolveStorybookRequestPath({
        buildDir,
        requestUrl: req.url,
        baseUrl: "http://127.0.0.1",
      });
    } catch (error: unknown) {
      res.writeHead(403);
      res.end(error instanceof Error ? error.message : "Forbidden");
      return;
    }

    readFile(filePath)
      .then((buffer) => {
        res.writeHead(200, {
          "Content-Type": getContentTypeForExtension(filePath),
        });
        res.end(buffer);
      })
      .catch((error: unknown) => {
        if (isErrno(error) && error.code === "ENOENT") {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
        res.writeHead(500);
        res.end("Internal Server Error");
      });
  });

  const address = await new Promise<{ port: number }>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const value = server.address();
      if (value === null || typeof value === "string") {
        reject(new Error("Failed to resolve Storybook static server port."));
        return;
      }
      resolve({ port: value.port });
    });
  });

  const baseUrl = `http://127.0.0.1:${address.port}`;
  await waitForServerReady(baseUrl, 10_000);
  return {
    baseUrl,
    close: async () =>
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
};

export const isBenchmarkBrowserName = (
  value: unknown,
): value is BenchmarkBrowserName => {
  return isVisualBrowserName(value);
};

export const assertBenchmarkBrowserName = (
  value: unknown,
): BenchmarkBrowserName => {
  return assertVisualBrowserName(value);
};

const loadBrowserByName = async (
  browserName: BenchmarkBrowserName,
): Promise<PlaywrightBrowserType> => {
  const playwright = (await import("@playwright/test")) as unknown as Record<
    BenchmarkBrowserName,
    PlaywrightBrowserType
  >;
  const browserType = playwright[browserName];
  if (browserType === undefined) {
    throw new Error(
      `Playwright does not export a '${browserName}' browser type.`,
    );
  }
  return browserType;
};

const resolveBenchmarkBrowsers = (
  requested: readonly BenchmarkBrowserName[] | undefined,
): BenchmarkBrowserName[] => {
  return normalizeVisualBrowserNames(requested) as BenchmarkBrowserName[];
};

const WAIT_FOR_FONTS_EXPRESSION = "document.fonts.ready.then(() => undefined)";
const WAIT_FOR_ANIMATIONS_EXPRESSION = [
  "new Promise(resolve => {",
  "  const allAnimations = document.getAnimations();",
  "  if (allAnimations.length === 0) { resolve(); return; }",
  "  Promise.allSettled(allAnimations.map(animation => animation.finished)).then(() => resolve());",
  "})",
].join("\n");

const STORYBOOK_CAPTURE_BOX_EXPRESSION = `(() => {
  const root = document.querySelector("${STORYBOOK_ROOT_SELECTOR}");
  if (!(root instanceof HTMLElement)) {
    return null;
  }
  const candidates = Array.from(root.children)
    .filter((child) => child instanceof HTMLElement)
    .map((child) => {
      const style = window.getComputedStyle(child);
      const rect = child.getBoundingClientRect();
      const hidden =
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0";
      if (hidden || rect.width <= 0 || rect.height <= 0) {
        return null;
      }
      return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        right: rect.right + window.scrollX,
        bottom: rect.bottom + window.scrollY,
      };
    })
    .filter((candidate) => candidate !== null);
  const sourceBoxes = candidates.length > 0
    ? candidates
    : (() => {
        const rect = root.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return [];
        }
        return [{
          left: rect.left + window.scrollX,
          top: rect.top + window.scrollY,
          right: rect.right + window.scrollX,
          bottom: rect.bottom + window.scrollY,
        }];
      })();
  if (sourceBoxes.length === 0) {
    return null;
  }
  const left = Math.min(...sourceBoxes.map((box) => box.left));
  const top = Math.min(...sourceBoxes.map((box) => box.top));
  const right = Math.max(...sourceBoxes.map((box) => box.right));
  const bottom = Math.max(...sourceBoxes.map((box) => box.bottom));
  return {
    x: Math.max(0, Math.floor(left - ${STORYBOOK_CAPTURE_PADDING})),
    y: Math.max(0, Math.floor(top - ${STORYBOOK_CAPTURE_PADDING})),
    width: Math.max(1, Math.ceil(right - left + ${STORYBOOK_CAPTURE_PADDING * 2})),
    height: Math.max(1, Math.ceil(bottom - top + ${STORYBOOK_CAPTURE_PADDING * 2})),
  };
})()`;

const cropPngBuffer = (
  buffer: Buffer,
  cropBox: StorybookCaptureBox,
): Buffer => {
  const source = PNG.sync.read(buffer);
  const safeX = Math.max(0, Math.min(cropBox.x, source.width - 1));
  const safeY = Math.max(0, Math.min(cropBox.y, source.height - 1));
  const safeWidth = Math.max(1, Math.min(cropBox.width, source.width - safeX));
  const safeHeight = Math.max(
    1,
    Math.min(cropBox.height, source.height - safeY),
  );
  const cropped = new PNG({ width: safeWidth, height: safeHeight });
  PNG.bitblt(source, cropped, safeX, safeY, safeWidth, safeHeight, 0, 0);
  return PNG.sync.write(cropped);
};

const normalizePngBufferToCanvas = ({
  buffer,
  canvasWidth,
  canvasHeight,
}: {
  buffer: Buffer;
  canvasWidth: number;
  canvasHeight: number;
}): { buffer: Buffer; warnings: string[] } => {
  const source = PNG.sync.read(buffer);
  const target = new PNG({ width: canvasWidth, height: canvasHeight });
  target.data.fill(0);
  const copyWidth = Math.min(source.width, canvasWidth);
  const copyHeight = Math.min(source.height, canvasHeight);
  const warnings: string[] = [];
  if (source.width > canvasWidth || source.height > canvasHeight) {
    warnings.push(
      `Normalized image clipped from ${String(source.width)}x${String(source.height)} into ${String(canvasWidth)}x${String(canvasHeight)} baseline canvas.`,
    );
  }
  PNG.bitblt(source, target, 0, 0, copyWidth, copyHeight, 0, 0);
  return {
    buffer: PNG.sync.write(target),
    warnings,
  };
};

const createSkippedStorybookScreenArtifact = ({
  screen,
  reason,
  warning,
}: {
  screen: VisualBenchmarkFixtureScreenMetadata;
  reason: string;
  warning: string;
}): VisualBenchmarkFixtureScreenArtifact => {
  const message = `${reason}: ${warning}`;
  return {
    screenId: screen.screenId,
    screenName: screen.storyTitle ?? screen.screenName,
    nodeId: screen.nodeId,
    status: "skipped",
    skipReason: reason,
    warnings: [warning],
    score: 0,
    ...(screen.weight !== undefined ? { weight: screen.weight } : {}),
    screenshotBuffer: PLACEHOLDER_SCREENSHOT_BUFFER,
    diffBuffer: null,
    report: {
      status: "not_requested",
      message,
      warnings: [warning],
    } satisfies WorkspaceVisualQualityReport,
    viewport: {
      width: screen.viewport.width,
      height: screen.viewport.height,
    },
  };
};

const isWorkspaceVisualQualityReport = (
  value: unknown,
): value is WorkspaceVisualQualityReport => {
  return typeof value === "object" && value !== null && "status" in value;
};

const recomputeVisualQualityFromBuffers = ({
  referenceBuffer,
  screenshotBuffer,
  viewport,
  qualityConfig,
  warning,
}: {
  referenceBuffer: Buffer;
  screenshotBuffer: Buffer;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
  qualityConfig?: VisualQualityConfig;
  warning: string;
}): { report: WorkspaceVisualQualityReport; diffBuffer: Buffer } => {
  const diffResult = comparePngBuffers({
    referenceBuffer,
    testBuffer: screenshotBuffer,
  });
  const recomputed = computeVisualQualityReport({
    diffResult,
    diffImagePath: DEFAULT_DIFF_IMAGE_PATH,
    viewport,
  });
  const report: WorkspaceVisualQualityReport = applyVisualQualityConfigToReport(
    {
      status: "completed",
      referenceSource: "frozen_fixture",
      capturedAt: new Date().toISOString(),
      overallScore: recomputed.overallScore,
      interpretation: recomputed.interpretation,
      dimensions: recomputed.dimensions,
      diffImagePath: recomputed.diffImagePath,
      hotspots: recomputed.hotspots,
      metadata: recomputed.metadata,
      warnings: [warning],
    },
    qualityConfig,
  );
  return {
    report,
    diffBuffer: diffResult.diffImageBuffer,
  };
};

const mergeOptionalRecords = (
  ...values: unknown[]
): Record<string, unknown> | undefined => {
  const merged: Record<string, unknown> = {};
  for (const value of values) {
    if (!isRecord(value)) {
      continue;
    }
    Object.assign(merged, cloneJsonValue(value));
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
};

const normalizeBenchmarkFigmaInput = ({
  fixtureId,
  figmaInput,
  metadata,
}: {
  fixtureId: string;
  figmaInput: unknown;
  metadata: VisualBenchmarkFixtureMetadata;
}): Record<string, unknown> => {
  if (!isRecord(figmaInput)) {
    throw new Error(
      `Benchmark fixture '${fixtureId}' figma.json must be an object.`,
    );
  }

  if (isRecord(figmaInput.document)) {
    return cloneJsonValue(figmaInput);
  }

  if (!isRecord(figmaInput.nodes)) {
    throw new Error(
      `Benchmark fixture '${fixtureId}' figma.json must expose either a top-level document or a nodes map.`,
    );
  }

  const nodeEntry = figmaInput.nodes[metadata.source.nodeId];
  if (!isRecord(nodeEntry) || !isRecord(nodeEntry.document)) {
    throw new Error(
      `Benchmark fixture '${fixtureId}' figma.json is missing node '${metadata.source.nodeId}' in nodes payload.`,
    );
  }

  const document = cloneJsonValue(nodeEntry.document);
  const components = mergeOptionalRecords(
    figmaInput.components,
    nodeEntry.components,
  );
  const componentSets = mergeOptionalRecords(
    figmaInput.componentSets,
    nodeEntry.componentSets,
  );
  const styles = mergeOptionalRecords(figmaInput.styles, nodeEntry.styles);

  return {
    ...(typeof figmaInput.editorType === "string"
      ? { editorType: figmaInput.editorType }
      : {}),
    ...(typeof figmaInput.lastModified === "string"
      ? { lastModified: figmaInput.lastModified }
      : {}),
    ...(typeof figmaInput.linkAccess === "string"
      ? { linkAccess: figmaInput.linkAccess }
      : {}),
    name: typeof figmaInput.name === "string" ? figmaInput.name : fixtureId,
    document: {
      id: `visual-benchmark-document-${fixtureId}`,
      type: "DOCUMENT",
      children: [
        {
          id: `visual-benchmark-canvas-${fixtureId}`,
          name: metadata.source.nodeName,
          type: "CANVAS",
          children: [document],
        },
      ],
    },
    ...(components ? { components } : {}),
    ...(componentSets ? { componentSets } : {}),
    ...(styles ? { styles } : {}),
  };
};

const createJobRecord = ({
  fixtureId,
  runtime,
  jobDir,
  figmaJsonPath,
  visualQualityViewportWidth,
  visualQualityViewportHeight,
  visualQualityDeviceScaleFactor,
  visualQualityBrowsers,
}: {
  fixtureId: string;
  runtime: ReturnType<typeof resolveRuntimeSettings>;
  jobDir: string;
  figmaJsonPath: string;
  visualQualityViewportWidth: number;
  visualQualityViewportHeight: number;
  visualQualityDeviceScaleFactor: number;
  visualQualityBrowsers: readonly BenchmarkBrowserName[];
}): JobRecord => {
  return {
    jobId: `visual-benchmark-${fixtureId}`,
    status: "queued",
    submittedAt: nowIso(),
    request: {
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth,
      visualQualityViewportHeight,
      visualQualityDeviceScaleFactor,
      visualQualityBrowsers: [...visualQualityBrowsers],
      enableUiValidation: false,
      enableUnitTestValidation: false,
      installPreferOffline: true,
      skipInstall: false,
      enableGitPr: false,
      figmaSourceMode: "local_json",
      figmaJsonPath,
      llmCodegenMode: "deterministic",
      brandTheme: "derived",
      generationLocale: "en-US",
      formHandlingMode: "react_hook_form",
    },
    stages: createInitialStages(),
    logs: [],
    artifacts: {
      outputRoot: path.dirname(path.dirname(jobDir)),
      jobDir,
    },
    preview: { enabled: false },
    queue: {
      runningCount: 0,
      queuedCount: 0,
      maxConcurrentJobs: runtime.maxConcurrentJobs,
      maxQueuedJobs: runtime.maxQueuedJobs,
    },
  };
};

const createExecutionContext = async ({
  fixtureId,
  figmaJsonPath,
  visualQualityViewportWidth,
  visualQualityViewportHeight,
  visualQualityDeviceScaleFactor,
  visualQualityBrowsers,
  workspaceRoot,
}: {
  fixtureId: string;
  figmaJsonPath: string;
  visualQualityViewportWidth: number;
  visualQualityViewportHeight: number;
  visualQualityDeviceScaleFactor: number;
  visualQualityBrowsers: readonly BenchmarkBrowserName[];
  workspaceRoot: string;
}): Promise<{
  executionContext: PipelineExecutionContext;
  rootDir: string;
  stageContextFor: (stage: WorkspaceJobStageName) => StageRuntimeContext;
}> => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), `workspace-dev-visual-benchmark-${fixtureId}-`),
  );
  const jobsRoot = path.join(rootDir, "jobs");
  const jobDir = path.join(jobsRoot, fixtureId);
  const generatedProjectDir = path.join(jobDir, "generated-app");
  await mkdir(jobDir, { recursive: true });
  await mkdir(generatedProjectDir, { recursive: true });
  const templateRoot = path.join(workspaceRoot, "template", "react-mui-app");
  const runtime = resolveRuntimeSettings({
    enablePreview: false,
    exportImages: false,
    installPreferOffline: true,
    skipInstall: false,
    enableUiValidation: false,
    enableVisualQualityValidation: true,
    visualQualityReferenceMode: "frozen_fixture",
    visualQualityViewportWidth,
    visualQualityViewportHeight,
    visualQualityDeviceScaleFactor,
    visualQualityBrowsers: [...visualQualityBrowsers],
    enableUnitTestValidation: false,
    figmaMaxRetries: 1,
    figmaRequestTimeoutMs: 1_000,
  });

  const artifactStore = new StageArtifactStore({ jobDir });
  const executionContext: PipelineExecutionContext = {
    mode: "submission",
    job: createJobRecord({
      fixtureId,
      runtime,
      jobDir,
      figmaJsonPath,
      visualQualityViewportWidth,
      visualQualityViewportHeight,
      visualQualityDeviceScaleFactor,
      visualQualityBrowsers,
    }),
    input: {
      figmaSourceMode: "local_json",
      figmaJsonPath,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth,
      visualQualityViewportHeight,
      visualQualityDeviceScaleFactor,
      visualQualityBrowsers: [...visualQualityBrowsers],
    },
    runtime,
    resolvedPaths: {
      workspaceRoot,
      outputRoot: rootDir,
      jobsRoot,
      reprosRoot: path.join(rootDir, "repros"),
    },
    resolvedWorkspaceRoot: workspaceRoot,
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
      reproDir: path.join(rootDir, "repros", fixtureId),
      iconMapFilePath: path.join(rootDir, "icon-map.json"),
      designSystemFilePath: path.join(rootDir, "design-system.json"),
      irCacheDir: path.join(rootDir, "cache", "ir"),
      templateRoot,
      templateCopyFilter: createTemplateCopyFilter({ templateRoot }),
    },
    artifactStore,
    resolvedBrandTheme: "derived",
    resolvedFigmaSourceMode: "local_json",
    resolvedFormHandlingMode: "react_hook_form",
    generationLocaleResolution: { locale: "en-US" },
    resolvedGenerationLocale: "en-US",
    appendDiagnostics: () => {
      // Benchmark execution does not persist diagnostics outside the temp job.
    },
    getCollectedDiagnostics: () => undefined,
    syncPublicJobProjection: async () => {
      // Benchmark execution stays local to the runner.
    },
  };

  return {
    executionContext,
    rootDir,
    stageContextFor: (stage) =>
      createStageRuntimeContext({ executionContext, stage }),
  };
};

const resolveViewportDeviceScaleFactor = (
  viewport: VisualBenchmarkViewportSpec,
): number => {
  if (viewport.deviceScaleFactor !== undefined) {
    return viewport.deviceScaleFactor;
  }
  return viewport.id === "mobile" ? DEFAULT_MOBILE_DEVICE_SCALE_FACTOR : 1;
};

const selectScreenViewports = ({
  fixtureId,
  screen,
  resolvedViewports,
  selectedViewportId,
}: {
  fixtureId: string;
  screen: VisualBenchmarkFixtureScreenMetadata;
  resolvedViewports: readonly VisualBenchmarkViewportSpec[];
  selectedViewportId: string | undefined;
}): VisualBenchmarkViewportSpec[] => {
  if (selectedViewportId === undefined) {
    return [...resolvedViewports];
  }
  const selectedViewport = resolvedViewports.find(
    (viewport) => viewport.id === selectedViewportId,
  );
  if (selectedViewport === undefined) {
    const availableViewportIds = resolvedViewports.map(
      (viewport) => viewport.id,
    );
    throw new Error(
      `Benchmark fixture '${fixtureId}' screen '${screen.screenId}' does not define viewport '${selectedViewportId}'. Available viewports: ${availableViewportIds.join(", ")}.`,
    );
  }
  return [selectedViewport];
};

const computeAggregateFromViewportArtifacts = ({
  viewportSpecs,
  viewportArtifacts,
}: {
  viewportSpecs: readonly VisualBenchmarkViewportSpec[];
  viewportArtifacts: readonly VisualBenchmarkScreenViewportArtifact[];
}): number => {
  if (viewportArtifacts.length === 0) {
    throw new Error(
      "computeAggregateFromViewportArtifacts requires at least one viewport result.",
    );
  }
  if (viewportArtifacts.length === 1) {
    return viewportArtifacts[0]!.score;
  }

  const normalizedViewports =
    normalizeVisualQualityViewportWeights(viewportSpecs);
  let weightedScore = 0;
  for (let index = 0; index < viewportArtifacts.length; index += 1) {
    const viewportArtifact = viewportArtifacts[index]!;
    const viewportSpec = normalizedViewports[index];
    if (viewportSpec === undefined) {
      throw new Error(
        "Viewport scoring configuration does not align with executed viewport artifacts.",
      );
    }
    weightedScore += viewportArtifact.score * (viewportSpec.weight ?? 0);
  }
  return Math.round(weightedScore * 100) / 100;
};

const resolveStorybookReferencePath = ({
  fixtureId,
  screen,
  viewportId,
  options,
}: {
  fixtureId: string;
  screen: VisualBenchmarkFixtureScreenMetadata;
  viewportId: string;
  options?: VisualBenchmarkExecutionOptions;
}): string => {
  if (viewportId !== "default") {
    return resolveVisualBenchmarkScreenViewportPaths(
      fixtureId,
      screen.screenId,
      viewportId,
      options,
    ).referencePngPath;
  }
  return resolveVisualBenchmarkScreenPaths(fixtureId, screen.screenId, options)
    .referencePngPath;
};

const executeStorybookComponentViewport = async ({
  fixtureId,
  screen,
  activeViewport,
  workspaceRoot,
  options,
  browser: browserName = DEFAULT_BENCHMARK_BROWSER,
}: {
  fixtureId: string;
  screen: VisualBenchmarkFixtureScreenMetadata;
  activeViewport: VisualBenchmarkViewportSpec;
  workspaceRoot: string;
  options?: VisualBenchmarkExecutionOptions;
  browser?: BenchmarkBrowserName;
}): Promise<VisualBenchmarkScreenViewportArtifact> => {
  const activeDeviceScaleFactor =
    resolveViewportDeviceScaleFactor(activeViewport);
  const storybookStaticDir = await resolveStorybookStaticDir({
    options,
    workspaceRoot,
  });
  const server = await createStorybookStaticServer(storybookStaticDir);
  const loadBrowser = options?.loadBrowser ?? loadBrowserByName;
  const browserType = await loadBrowser(browserName);
  const browser = await browserType.launch({ headless: true });
  const normalizedViewport = {
    width: screen.baselineCanvas?.width ?? activeViewport.width,
    height: screen.baselineCanvas?.height ?? activeViewport.height,
  };

  try {
    const context = await browser.newContext({
      viewport: {
        width: activeViewport.width,
        height: activeViewport.height,
      },
      deviceScaleFactor: activeDeviceScaleFactor,
    });
    try {
      const page = await context.newPage();
      const storyUrl = new URL("/iframe.html", server.baseUrl);
      storyUrl.searchParams.set("id", screen.entryId!);
      storyUrl.searchParams.set("viewMode", "story");
      await page.goto(storyUrl.toString(), {
        timeout: 30_000,
        waitUntil: "load",
      });
      await page.waitForLoadState("networkidle", { timeout: 30_000 });
      await page.evaluate(WAIT_FOR_FONTS_EXPRESSION);
      await page.evaluate(WAIT_FOR_ANIMATIONS_EXPRESSION);

      const captureBox = await page.evaluate<StorybookCaptureBox | null>(
        STORYBOOK_CAPTURE_BOX_EXPRESSION,
      );
      if (captureBox === null) {
        throw new Error(
          `Storybook story '${screen.entryId}' rendered no visible content under ${STORYBOOK_ROOT_SELECTOR}.`,
        );
      }

      const fullScreenshotBuffer = Buffer.from(
        await page.screenshot({
          fullPage: true,
          type: "png",
        }),
      );
      const croppedBuffer = cropPngBuffer(fullScreenshotBuffer, captureBox);
      const referenceBuffer = await readFile(
        resolveStorybookReferencePath({
          fixtureId,
          screen,
          viewportId: activeViewport.id,
          options,
        }),
      );
      const targetPixelWidth = Math.max(
        1,
        Math.round(normalizedViewport.width * activeDeviceScaleFactor),
      );
      const targetPixelHeight = Math.max(
        1,
        Math.round(normalizedViewport.height * activeDeviceScaleFactor),
      );
      const normalizedActual = normalizePngBufferToCanvas({
        buffer: croppedBuffer,
        canvasWidth: targetPixelWidth,
        canvasHeight: targetPixelHeight,
      });
      const normalizedReference = normalizePngBufferToCanvas({
        buffer: referenceBuffer,
        canvasWidth: targetPixelWidth,
        canvasHeight: targetPixelHeight,
      });
      const diffResult = comparePngBuffers({
        referenceBuffer: normalizedReference.buffer,
        testBuffer: normalizedActual.buffer,
      });
      const scoredReport = computeVisualQualityReport({
        diffResult,
        diffImagePath: DEFAULT_DIFF_IMAGE_PATH,
        viewport: {
          width: normalizedViewport.width,
          height: normalizedViewport.height,
          deviceScaleFactor: activeDeviceScaleFactor,
        },
      });
      const warnings = [
        ...normalizedActual.warnings,
        ...normalizedReference.warnings,
      ];
      const report: WorkspaceVisualQualityReport = {
        status: "completed",
        referenceSource: "frozen_fixture",
        capturedAt: new Date().toISOString(),
        overallScore: scoredReport.overallScore,
        interpretation: scoredReport.interpretation,
        dimensions: scoredReport.dimensions,
        diffImagePath: scoredReport.diffImagePath,
        hotspots: scoredReport.hotspots,
        metadata: scoredReport.metadata,
        ...(warnings.length > 0 ? { warnings } : {}),
      };

      return {
        viewportId: activeViewport.id,
        viewportLabel: activeViewport.label ?? activeViewport.id,
        score: report.overallScore,
        screenshotBuffer: normalizedActual.buffer,
        diffBuffer: diffResult.diffImageBuffer,
        report,
        viewport: {
          ...normalizedViewport,
          deviceScaleFactor: activeDeviceScaleFactor,
        },
      };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
};

interface MultiBrowserViewportResult {
  primary: VisualBenchmarkScreenViewportArtifact;
  browserArtifacts: BrowserScreenViewportArtifact[];
  crossBrowserConsistency: CrossBrowserConsistencyResult;
}

const executeStorybookComponentViewportMultiBrowser = async ({
  fixtureId,
  screen,
  activeViewport,
  workspaceRoot,
  options,
  browsers,
}: {
  fixtureId: string;
  screen: VisualBenchmarkFixtureScreenMetadata;
  activeViewport: VisualBenchmarkViewportSpec;
  workspaceRoot: string;
  options?: VisualBenchmarkExecutionOptions;
  browsers: readonly BenchmarkBrowserName[];
}): Promise<MultiBrowserViewportResult> => {
  if (browsers.length === 0) {
    throw new Error(
      `executeStorybookComponentViewportMultiBrowser requires at least one browser for screen '${screen.screenId}'.`,
    );
  }
  const captures = await Promise.all(
    browsers.map(async (browserName) => {
      const artifact = await executeStorybookComponentViewport({
        fixtureId,
        screen,
        activeViewport,
        workspaceRoot,
        options,
        browser: browserName,
      });
      return { browser: browserName, artifact };
    }),
  );

  const browserArtifacts: BrowserScreenViewportArtifact[] = captures.map(
    ({ browser, artifact }) => ({ ...artifact, browser }),
  );

  const consistency = computeCrossBrowserConsistencyScore(
    captures.map(({ browser, artifact }) => ({
      browser,
      screenshotBuffer: artifact.screenshotBuffer,
    })),
  );

  const primary = captures[0]!.artifact;
  return {
    primary,
    browserArtifacts,
    crossBrowserConsistency: consistency,
  };
};

const aggregateCrossBrowserConsistency = (
  perViewportResults: readonly CrossBrowserConsistencyResult[],
): CrossBrowserConsistencyResult | undefined => {
  if (perViewportResults.length === 0) {
    return undefined;
  }
  if (perViewportResults.length === 1) {
    return perViewportResults[0]!;
  }
  const first = perViewportResults[0]!;
  const combinedPairwise: CrossBrowserPairwiseDiff[] = perViewportResults
    .flatMap((entry) => entry.pairwiseDiffs)
    .map((pair) => ({ ...pair }));
  const combinedWarnings = perViewportResults.flatMap(
    (entry) => entry.warnings,
  );
  const worstConsistencyScore = perViewportResults.reduce(
    (acc, entry) => Math.min(acc, entry.consistencyScore),
    100,
  );
  return {
    browsers: [...first.browsers],
    pairwiseDiffs: combinedPairwise,
    consistencyScore: worstConsistencyScore,
    warnings: combinedWarnings,
  };
};

const executeStorybookComponentScreen = async ({
  fixtureId,
  screen,
  workspaceRoot,
  options,
}: {
  fixtureId: string;
  screen: VisualBenchmarkFixtureScreenMetadata;
  workspaceRoot: string;
  options?: VisualBenchmarkExecutionOptions;
}): Promise<VisualBenchmarkFixtureScreenArtifact> => {
  const missing: string[] = [];
  if (screen.entryId === undefined) {
    missing.push("entryId");
  }
  if (screen.referenceNodeId === undefined) {
    missing.push("referenceNodeId");
  }
  if (screen.referenceFileKey === undefined) {
    missing.push("referenceFileKey");
  }
  if (screen.captureStrategy !== "storybook_root_union") {
    missing.push("captureStrategy");
  }
  if (screen.baselineCanvas === undefined) {
    missing.push("baselineCanvas");
  }
  if (missing.length > 0) {
    return createSkippedStorybookScreenArtifact({
      screen,
      reason: "incomplete_mapping",
      warning: `Storybook component screen '${screen.screenId}' is missing required metadata: ${missing.join(", ")}.`,
    });
  }

  const resolvedViewports = enumerateFixtureScreenViewports(screen, []);
  const selectedViewports = selectScreenViewports({
    fixtureId,
    screen,
    resolvedViewports,
    selectedViewportId: options?.viewportId,
  });

  const missingReferences: string[] = [];
  for (const viewport of selectedViewports) {
    const referencePath = resolveStorybookReferencePath({
      fixtureId,
      screen,
      viewportId: viewport.id,
      options,
    });
    if (!(await fileExists(referencePath))) {
      missingReferences.push(viewport.id);
    }
  }
  if (missingReferences.length > 0) {
    return createSkippedStorybookScreenArtifact({
      screen,
      reason: "missing_reference_image",
      warning: `Storybook component screen '${screen.screenId}' is missing frozen references for viewport(s): ${missingReferences.join(", ")}.`,
    });
  }

  const browsers = resolveBenchmarkBrowsers(options?.browsers);
  const isMultiBrowser = browsers.length > 1;

  const multiBrowserResults = isMultiBrowser
    ? await Promise.all(
        selectedViewports.map((activeViewport) =>
          executeStorybookComponentViewportMultiBrowser({
            fixtureId,
            screen,
            activeViewport,
            workspaceRoot,
            options,
            browsers,
          }),
        ),
      )
    : null;

  const viewports: VisualBenchmarkScreenViewportArtifact[] =
    multiBrowserResults !== null
      ? multiBrowserResults.map((entry) => entry.primary)
      : await Promise.all(
          selectedViewports.map((activeViewport) =>
            executeStorybookComponentViewport({
              fixtureId,
              screen,
              activeViewport,
              workspaceRoot,
              options,
              browser: browsers[0],
            }),
          ),
        );
  const representativeViewport = viewports[0];
  if (representativeViewport === undefined) {
    return createSkippedStorybookScreenArtifact({
      screen,
      reason: "missing_story",
      warning: `Storybook component screen '${screen.screenId}' resolved no executable viewport artifacts.`,
    });
  }

  const reportWarnings = viewports.flatMap((viewport) => {
    const report = viewport.report;
    return isWorkspaceVisualQualityReport(report) &&
      Array.isArray(report.warnings)
      ? report.warnings
      : [];
  });

  const crossBrowserWarnings = (multiBrowserResults ?? []).flatMap((entry) =>
    entry.crossBrowserConsistency.warnings.map(
      (warning) => `${screen.screenId}@${entry.primary.viewportId}: ${warning}`,
    ),
  );
  const combinedWarnings = [...reportWarnings, ...crossBrowserWarnings];

  const aggregatedCrossBrowser: CrossBrowserConsistencyResult | undefined =
    multiBrowserResults !== null
      ? aggregateCrossBrowserConsistency(
          multiBrowserResults.map((entry) => entry.crossBrowserConsistency),
        )
      : undefined;

  const browserArtifacts: BrowserScreenViewportArtifact[] | undefined =
    multiBrowserResults !== null
      ? multiBrowserResults.flatMap((entry) => entry.browserArtifacts)
      : undefined;

  return {
    screenId: screen.screenId,
    screenName: screen.storyTitle ?? screen.screenName,
    nodeId: screen.nodeId,
    status: "completed",
    ...(screen.weight !== undefined ? { weight: screen.weight } : {}),
    ...(combinedWarnings.length > 0 ? { warnings: combinedWarnings } : {}),
    score: computeAggregateFromViewportArtifacts({
      viewportSpecs: selectedViewports,
      viewportArtifacts: viewports,
    }),
    screenshotBuffer: representativeViewport.screenshotBuffer,
    diffBuffer: representativeViewport.diffBuffer,
    report: representativeViewport.report,
    viewport: representativeViewport.viewport,
    viewports,
    ...(browserArtifacts !== undefined ? { browserArtifacts } : {}),
    ...(aggregatedCrossBrowser !== undefined
      ? { crossBrowserConsistency: aggregatedCrossBrowser }
      : {}),
  };
};

const executeVisualBenchmarkViewport = async ({
  fixtureId,
  metadata,
  figmaInput,
  screen,
  activeViewport,
  figmaJsonPath,
  workspaceRoot,
  options,
}: {
  fixtureId: string;
  metadata: VisualBenchmarkFixtureMetadata;
  figmaInput: unknown;
  screen: VisualBenchmarkFixtureScreenMetadata;
  activeViewport: VisualBenchmarkViewportSpec;
  figmaJsonPath: string;
  workspaceRoot: string;
  options?: VisualBenchmarkExecutionOptions;
}): Promise<VisualBenchmarkScreenViewportArtifact> => {
  const activeDeviceScaleFactor =
    resolveViewportDeviceScaleFactor(activeViewport);
  const browsers = resolveBenchmarkBrowsers(options?.browsers);

  const perScreenMetadata: VisualBenchmarkFixtureMetadata = {
    ...metadata,
    viewport: {
      width: activeViewport.width,
      height: activeViewport.height,
    },
    source: {
      ...metadata.source,
      nodeId: screen.nodeId,
      nodeName: screen.screenName,
    },
  };

  const { executionContext, rootDir, stageContextFor } =
    await createExecutionContext({
      fixtureId,
      figmaJsonPath,
      visualQualityViewportWidth: activeViewport.width,
      visualQualityViewportHeight: activeViewport.height,
      visualQualityDeviceScaleFactor: activeDeviceScaleFactor,
      visualQualityBrowsers: browsers,
      workspaceRoot,
    });
  const fixturePaths = resolveVisualBenchmarkFixturePaths(fixtureId, options);
  const screenViewportPaths = resolveVisualBenchmarkScreenViewportPaths(
    fixtureId,
    screen.screenId,
    activeViewport.id,
    options,
  );
  const referenceOverrideViewportId =
    typeof options?.referenceOverrideViewportId === "string" &&
    options.referenceOverrideViewportId.trim().length > 0
      ? options.referenceOverrideViewportId.trim()
      : options?.viewportId;
  const resolvedReferencePath =
    typeof options?.referenceOverridePath === "string" &&
    options.referenceOverridePath.trim().length > 0 &&
    (referenceOverrideViewportId === undefined ||
      referenceOverrideViewportId === activeViewport.id)
      ? options.referenceOverridePath.trim()
      : screenViewportPaths.referencePngPath;
  const metadataPath = path.join(
    fixturePaths.fixtureDir,
    ".benchmark-runtime",
    `reference-${toScreenIdToken(screen.screenId)}-${activeViewport.id}.metadata.json`,
  );
  const keepTemporaryArtifacts =
    process.env.WORKSPACEDEV_VISUAL_BENCHMARK_KEEP_TMP === "1";

  try {
    const localFigmaJsonPath = path.join(
      executionContext.paths.jobDir,
      "benchmark-local-figma.json",
    );
    await writeFile(
      localFigmaJsonPath,
      toStableJsonString(
        normalizeBenchmarkFigmaInput({
          fixtureId,
          figmaInput,
          metadata: perScreenMetadata,
        }),
      ),
      "utf8",
    );
    await mkdir(path.dirname(metadataPath), { recursive: true });
    await writeFile(
      metadataPath,
      toStableJsonString(perScreenMetadata),
      "utf8",
    );
    const visualQualityFrozenReference: VisualQualityFrozenReferenceOverride = {
      imagePath: resolvedReferencePath,
      metadataPath,
    };
    (
      executionContext.input as WorkspaceJobInput & {
        visualQualityFrozenReference?: VisualQualityFrozenReferenceOverride;
      }
    ).visualQualityFrozenReference = visualQualityFrozenReference;
    (
      executionContext.job.request as typeof executionContext.job.request & {
        visualQualityFrozenReference?: VisualQualityFrozenReferenceOverride;
      }
    ).visualQualityFrozenReference = visualQualityFrozenReference;
    await FigmaSourceService.execute(
      {
        figmaJsonPath: localFigmaJsonPath,
      },
      stageContextFor("figma.source"),
    );
    await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));
    await TemplatePrepareService.execute(
      undefined,
      stageContextFor("template.prepare"),
    );
    await createCodegenGenerateService().execute(
      {
        boardKeySeed: fixtureId,
      },
      stageContextFor("codegen.generate"),
    );
    await createValidateProjectService().execute(
      undefined,
      stageContextFor("validate.project"),
    );

    const visualQuality = executionContext.job.visualQuality;
    let diffBuffer: Buffer | null = null;
    let report: unknown | null = null;
    const visualQualityDir = path.join(
      executionContext.paths.jobDir,
      "visual-quality",
    );
    const captureResult = await captureFromProject({
      projectDir: path.join(
        executionContext.paths.jobDir,
        "generated-app",
        "dist",
      ),
      browser: browsers[0],
      config: {
        viewport: {
          width: activeViewport.width,
          height: activeViewport.height,
          deviceScaleFactor: activeDeviceScaleFactor,
        },
        waitForNetworkIdle: true,
        waitForFonts: true,
        waitForAnimations: true,
        stabilizeBeforeCapture: {
          enabled: true,
          maxAttempts: 6,
          intervalMs: 100,
          requireConsecutiveMatches: 2,
        },
        timeoutMs: 30_000,
        fullPage: false,
      },
      onLog: (message) => {
        options?.log?.(message);
      },
    });
    let screenshotBuffer: Buffer;
    try {
      screenshotBuffer = await readFile(
        path.join(visualQualityDir, "actual.png"),
      );
    } catch (error: unknown) {
      if (
        options?.allowIncompleteVisualQuality !== true &&
        !(isErrno(error) && error.code === "ENOENT")
      ) {
        throw error;
      }
      screenshotBuffer = Buffer.from(captureResult.screenshotBuffer);
    }
    try {
      diffBuffer = await readFile(
        path.join(visualQualityDir, "diff.png"),
      );
      report = JSON.parse(
        await readFile(
          path.join(visualQualityDir, "report.json"),
          "utf8",
        ),
      ) as unknown;
    } catch (error: unknown) {
      if (
        options?.allowIncompleteVisualQuality !== true &&
        !(isErrno(error) && error.code === "ENOENT")
      ) {
        throw error;
      }
    }
    if (isWorkspaceVisualQualityReport(report)) {
      report = applyVisualQualityConfigToReport(report, options?.qualityConfig);
    }
    let effectiveVisualQuality = isWorkspaceVisualQualityReport(report)
      ? report
      : visualQuality !== undefined
        ? applyVisualQualityConfigToReport(
            visualQuality,
            options?.qualityConfig,
          )
        : visualQuality;
    if (
      effectiveVisualQuality?.status !== "completed" ||
      typeof effectiveVisualQuality.overallScore !== "number"
    ) {
      try {
        const referenceBuffer = await readFile(resolvedReferencePath);
        const fallback = recomputeVisualQualityFromBuffers({
          referenceBuffer,
          screenshotBuffer,
          viewport: {
            width: activeViewport.width,
            height: activeViewport.height,
            deviceScaleFactor: activeDeviceScaleFactor,
          },
          qualityConfig: options?.qualityConfig,
          warning:
            "Visual quality report was incomplete; recomputed score from captured screenshot and frozen reference.",
        });
        report = fallback.report;
        diffBuffer = diffBuffer ?? fallback.diffBuffer;
        effectiveVisualQuality = fallback.report;
      } catch (error: unknown) {
        if (!(isErrno(error) && error.code === "ENOENT")) {
          throw error;
        }
        const fallbackWarning =
          `Frozen reference image is missing for '${fixtureId}' screen '${screen.screenId}' viewport '${activeViewport.id}'. ` +
          "Returning score 0 in incomplete mode so baseline refresh can proceed.";
        const fallbackReport: WorkspaceVisualQualityReport = {
          status: "completed",
          referenceSource: "frozen_fixture",
          capturedAt: new Date().toISOString(),
          overallScore: 0,
          warnings: [fallbackWarning],
          metadata: {
            viewport: {
              width: activeViewport.width,
              height: activeViewport.height,
              deviceScaleFactor: activeDeviceScaleFactor,
            },
          },
        };
        report = fallbackReport;
        effectiveVisualQuality = fallbackReport;
      }
    }
    if (
      effectiveVisualQuality?.status !== "completed" ||
      typeof effectiveVisualQuality.overallScore !== "number"
    ) {
      throw new Error(
        `Benchmark fixture '${fixtureId}' screen '${screen.screenId}' viewport '${activeViewport.id}' has no valid visual quality score after fallback recomputation.`,
      );
    }

    const viewport = effectiveVisualQuality.metadata?.viewport ?? {
      width: activeViewport.width,
      height: activeViewport.height,
      deviceScaleFactor: activeDeviceScaleFactor,
    };

    const browserArtifacts =
      effectiveVisualQuality?.perBrowser !== undefined
        ? (
            await Promise.all(
              effectiveVisualQuality.perBrowser.map(async (entry) => {
                if (!entry.actualImagePath) {
                  return null;
                }
                let browserReport: unknown | null = null;
                let browserDiffBuffer: Buffer | null = null;
                if (entry.reportPath) {
                  try {
                    browserReport = JSON.parse(
                      await readFile(entry.reportPath, "utf8"),
                    ) as unknown;
                  } catch (error: unknown) {
                    if (options?.allowIncompleteVisualQuality !== true) {
                      throw error;
                    }
                  }
                }
                if (entry.diffImagePath) {
                  try {
                    browserDiffBuffer = await readFile(entry.diffImagePath);
                  } catch (error: unknown) {
                    if (options?.allowIncompleteVisualQuality !== true) {
                      throw error;
                    }
                  }
                }
                const browserViewport =
                  isWorkspaceVisualQualityReport(browserReport) &&
                  browserReport.metadata !== undefined
                    ? browserReport.metadata.viewport
                    : viewport;
                let browserScreenshotBuffer: Buffer;
                try {
                  browserScreenshotBuffer = await readFile(entry.actualImagePath);
                } catch (error: unknown) {
                  if (options?.allowIncompleteVisualQuality === true) {
                    return null;
                  }
                  throw error;
                }
                return {
                  browser: entry.browser,
                  viewportId: activeViewport.id,
                  viewportLabel: activeViewport.label ?? activeViewport.id,
                  score: entry.overallScore,
                  screenshotBuffer: browserScreenshotBuffer,
                  diffBuffer: browserDiffBuffer,
                  report: browserReport,
                  viewport: {
                    width: browserViewport.width,
                    height: browserViewport.height,
                    ...(typeof browserViewport.deviceScaleFactor === "number"
                      ? { deviceScaleFactor: browserViewport.deviceScaleFactor }
                      : {}),
                  },
                } satisfies BrowserScreenViewportArtifact;
              }),
            )
          ).filter(
            (entry): entry is BrowserScreenViewportArtifact => entry !== null,
          )
        : undefined;

    const crossBrowserConsistency =
      effectiveVisualQuality?.crossBrowserConsistency !== undefined
        ? {
            browsers: [...effectiveVisualQuality.crossBrowserConsistency.browsers],
            consistencyScore:
              effectiveVisualQuality.crossBrowserConsistency.consistencyScore,
            warnings: [
              ...(effectiveVisualQuality.crossBrowserConsistency.warnings ?? []),
            ],
            pairwiseDiffs: await Promise.all(
              effectiveVisualQuality.crossBrowserConsistency.pairwiseDiffs.map(
                async (pair) => ({
                  browserA: pair.browserA,
                  browserB: pair.browserB,
                  diffPercent: pair.diffPercent,
                  diffBuffer:
                    pair.diffImagePath !== undefined
                      ? await readFile(pair.diffImagePath)
                      : null,
                }),
              ),
            ),
          }
        : undefined;

    return {
      viewportId: activeViewport.id,
      viewportLabel: activeViewport.label ?? activeViewport.id,
      score: effectiveVisualQuality.overallScore,
      screenshotBuffer,
      diffBuffer,
      report,
      viewport: {
        width: viewport.width,
        height: viewport.height,
        ...(typeof viewport.deviceScaleFactor === "number"
          ? { deviceScaleFactor: viewport.deviceScaleFactor }
          : {}),
      },
      ...(browserArtifacts && browserArtifacts.length > 0
        ? { browserArtifacts }
        : {}),
      ...(crossBrowserConsistency !== undefined
        ? { crossBrowserConsistency }
        : {}),
    };
  } finally {
    await rm(metadataPath, { force: true });
    await rm(path.dirname(metadataPath), {
      recursive: true,
      force: true,
    });
    if (!keepTemporaryArtifacts) {
      await rm(rootDir, { recursive: true, force: true });
    }
  }
};

const executeVisualBenchmarkScreen = async ({
  fixtureId,
  metadata,
  figmaInput,
  screen,
  figmaJsonPath,
  workspaceRoot,
  options,
}: {
  fixtureId: string;
  metadata: VisualBenchmarkFixtureMetadata;
  figmaInput: unknown;
  screen: VisualBenchmarkFixtureScreenMetadata;
  figmaJsonPath: string;
  workspaceRoot: string;
  options?: VisualBenchmarkExecutionOptions;
}): Promise<VisualBenchmarkFixtureScreenArtifact> => {
  if (isStorybookMode(metadata)) {
    return await executeStorybookComponentScreen({
      fixtureId,
      screen,
      workspaceRoot,
      options,
    });
  }

  const userConfiguredViewports = resolveVisualQualityViewports(
    options?.qualityConfig,
    fixtureId,
    { screenId: screen.screenId, screenName: screen.screenName },
  );
  const resolvedViewports = enumerateFixtureScreenViewports(
    screen,
    userConfiguredViewports ?? [],
  );
  const selectedViewports = selectScreenViewports({
    fixtureId,
    screen,
    resolvedViewports,
    selectedViewportId: options?.viewportId,
  });

  const viewports = await Promise.all(
    selectedViewports.map((activeViewport) =>
      executeVisualBenchmarkViewport({
        fixtureId,
        metadata,
        figmaInput,
        screen,
        activeViewport,
        figmaJsonPath,
        workspaceRoot,
        options,
      }),
    ),
  );

  const representativeViewport = viewports[0];
  if (representativeViewport === undefined) {
    throw new Error(
      `Benchmark fixture '${fixtureId}' screen '${screen.screenId}' did not produce any viewport artifacts.`,
    );
  }

  const reportWarnings = viewports.flatMap((viewportArtifact) => {
    const viewportReport = viewportArtifact.report;
    return isWorkspaceVisualQualityReport(viewportReport) &&
      Array.isArray(viewportReport.warnings)
      ? viewportReport.warnings
      : [];
  });
  const crossBrowserWarnings = viewports.flatMap((viewportArtifact) =>
    viewportArtifact.crossBrowserConsistency?.warnings.map(
      (warning) => `${screen.screenId}@${viewportArtifact.viewportId}: ${warning}`,
    ) ?? [],
  );
  const aggregatedCrossBrowser = aggregateCrossBrowserConsistency(
    viewports.flatMap((viewportArtifact) =>
      viewportArtifact.crossBrowserConsistency
        ? [viewportArtifact.crossBrowserConsistency]
        : [],
    ),
  );
  const browserArtifacts = viewports.flatMap(
    (viewportArtifact) => viewportArtifact.browserArtifacts ?? [],
  );
  const combinedWarnings = [...reportWarnings, ...crossBrowserWarnings];

  return {
    screenId: screen.screenId,
    screenName: screen.screenName,
    nodeId: screen.nodeId,
    status: "completed",
    score: computeAggregateFromViewportArtifacts({
      viewportSpecs: selectedViewports,
      viewportArtifacts: viewports,
    }),
    ...(screen.weight !== undefined ? { weight: screen.weight } : {}),
    ...(combinedWarnings.length > 0 ? { warnings: combinedWarnings } : {}),
    screenshotBuffer: representativeViewport.screenshotBuffer,
    diffBuffer: representativeViewport.diffBuffer,
    report: representativeViewport.report,
    viewport: representativeViewport.viewport,
    viewports,
    ...(browserArtifacts.length > 0 ? { browserArtifacts } : {}),
    ...(aggregatedCrossBrowser !== undefined
      ? { crossBrowserConsistency: aggregatedCrossBrowser }
      : {}),
  };
};

const computeAggregateFromScreens = (
  screens: readonly VisualBenchmarkFixtureScreenArtifact[],
): number => {
  const completedScreens = screens.filter(
    (screen) => screen.status !== "skipped",
  );
  if (completedScreens.length === 0) {
    return 0;
  }
  try {
    return computeVisualBenchmarkAggregateScore(completedScreens);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `executeVisualBenchmarkFixture requires at least one screen to aggregate: ${detail}`,
    );
  }
};

export const executeVisualBenchmarkFixture = async (
  fixtureId: string,
  options?: VisualBenchmarkExecutionOptions,
): Promise<VisualBenchmarkFixtureRunResult> => {
  const metadata = await loadVisualBenchmarkFixtureMetadata(fixtureId, options);
  const { figmaJsonPath } = resolveVisualBenchmarkFixturePaths(
    fixtureId,
    options,
  );
  const figmaInput = await loadVisualBenchmarkFixtureInputs(fixtureId, options);
  const workspaceRoot = options?.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;

  await ensureTemplateValidationSeedNodeModules();

  const screens = enumerateFixtureScreens(metadata);
  const screenArtifacts: VisualBenchmarkFixtureScreenArtifact[] = [];
  try {
    for (const screen of screens) {
      const artifact = await executeVisualBenchmarkScreen({
        fixtureId,
        metadata,
        figmaInput,
        screen,
        figmaJsonPath,
        workspaceRoot,
        options,
      });
      screenArtifacts.push(artifact);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Benchmark fixture '${fixtureId}' failed: ${detail}`);
  }

  const aggregateScore = computeAggregateFromScreens(screenArtifacts);
  const skippedScreens = screenArtifacts.filter(
    (screen) => screen.status === "skipped",
  );
  const completedScreens = screenArtifacts.filter(
    (screen) => screen.status !== "skipped",
  );
  const crossBrowserAccumulator = completedScreens.flatMap((screen) =>
    screen.crossBrowserConsistency !== undefined
      ? [screen.crossBrowserConsistency]
      : [],
  );
  const fixtureCrossBrowserConsistency = aggregateCrossBrowserConsistency(
    crossBrowserAccumulator,
  );
  const warnings = [
    ...skippedScreens.flatMap((screen) => screen.warnings ?? []),
    ...(fixtureCrossBrowserConsistency !== undefined
      ? fixtureCrossBrowserConsistency.warnings
      : []),
  ];
  const browserBreakdown = computeBrowserBreakdown(completedScreens);
  const componentCoverage = isStorybookMode(metadata)
    ? {
        comparedCount: completedScreens.length,
        skippedCount: skippedScreens.length,
        coveragePercent:
          screens.length === 0
            ? 0
            : Math.round((completedScreens.length / screens.length) * 10_000) /
              100,
        bySkipReason: skippedScreens.reduce<Record<string, number>>(
          (accumulator, screen) => {
            const key = screen.skipReason ?? "unknown";
            accumulator[key] = (accumulator[key] ?? 0) + 1;
            return accumulator;
          },
          {},
        ),
      }
    : undefined;

  return {
    fixtureId,
    aggregateScore,
    screens: screenArtifacts,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(metadata.mode === "generated_app_screen" || metadata.mode === undefined
      ? { screenAggregateScore: aggregateScore }
      : { componentAggregateScore: aggregateScore }),
    ...(componentCoverage !== undefined ? { componentCoverage } : {}),
    ...(fixtureCrossBrowserConsistency !== undefined
      ? { crossBrowserConsistency: fixtureCrossBrowserConsistency }
      : {}),
    ...(browserBreakdown !== undefined ? { browserBreakdown } : {}),
  };
};

const computeBrowserBreakdown = (
  completedScreens: readonly VisualBenchmarkFixtureScreenArtifact[],
): Partial<Record<BenchmarkBrowserName, number>> | undefined => {
  const sums: Partial<Record<BenchmarkBrowserName, number>> = {};
  const counts: Partial<Record<BenchmarkBrowserName, number>> = {};
  let sawAny = false;
  for (const screen of completedScreens) {
    const browserArtifacts = screen.browserArtifacts;
    if (browserArtifacts === undefined || browserArtifacts.length === 0) {
      continue;
    }
    sawAny = true;
    for (const artifact of browserArtifacts) {
      sums[artifact.browser] = (sums[artifact.browser] ?? 0) + artifact.score;
      counts[artifact.browser] = (counts[artifact.browser] ?? 0) + 1;
    }
  }
  if (!sawAny) {
    return undefined;
  }
  const averaged: Partial<Record<BenchmarkBrowserName, number>> = {};
  for (const browserName of BENCHMARK_BROWSER_NAMES) {
    const total = sums[browserName];
    const count = counts[browserName];
    if (total === undefined || count === undefined || count === 0) {
      continue;
    }
    averaged[browserName] = Math.round((total / count) * 100) / 100;
  }
  return averaged;
};

export const runVisualBenchmarkFixture = async (
  fixtureId: string,
  options?: VisualBenchmarkExecutionOptions,
): Promise<VisualBenchmarkFixtureExecutionResult> => {
  const result = await executeVisualBenchmarkFixture(fixtureId, options);
  return {
    fixtureId: result.fixtureId,
    score: result.aggregateScore,
  };
};

/**
 * Legacy single-screen execution wrapper used by visual-baseline.ts which
 * still consumes per-fixture (not per-screen) artifacts. This fans out to the
 * multi-screen executor and collapses to the first screen. Single-screen
 * fixtures (v1 metadata) produce byte-identical output to the pre-multi-screen
 * behaviour.
 */
export const executeVisualBenchmarkFixtureLegacy = async (
  fixtureId: string,
  options?: VisualBenchmarkExecutionOptions,
): Promise<VisualBenchmarkFixtureExecutionArtifacts> => {
  const result = await executeVisualBenchmarkFixture(fixtureId, options);
  const first = result.screens[0];
  if (first === undefined) {
    throw new Error(
      `Benchmark fixture '${fixtureId}' produced no screens in legacy execution.`,
    );
  }
  return {
    fixtureId: result.fixtureId,
    score: result.aggregateScore,
    screenshotBuffer: first.screenshotBuffer,
    diffBuffer: first.diffBuffer,
    report: first.report,
    viewport: first.viewport,
  };
};
