import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type {
  WorkspaceJobStageName,
  WorkspaceRegenerationOverrideEntry,
} from "../contracts/index.js";
import { cleanFigmaForCodegen } from "../job-engine/figma-clean.js";
import { JobDiskTracker } from "../job-engine/disk-tracker.js";
import { STAGE_ARTIFACT_KEYS } from "../job-engine/pipeline/artifact-keys.js";
import { StageArtifactStore } from "../job-engine/pipeline/artifact-store.js";
import {
  createStageRuntimeContext,
  type PipelineExecutionContext,
} from "../job-engine/pipeline/context.js";
import { DEFAULT_PIPELINE_DEFINITION } from "../job-engine/pipeline/pipeline-selection.js";
import { ROCKET_PIPELINE_DEFINITION } from "../job-engine/pipeline/rocket-pipeline-definition.js";
import { createTemplateCopyFilter } from "../job-engine/template-copy-filter.js";
import { resolveRuntimeSettings } from "../job-engine/runtime.js";
import { createInitialStages, nowIso } from "../job-engine/stage-state.js";
import type { JobRecord, SubmissionJobInput } from "../job-engine/types.js";
import { copyDir } from "../job-engine/fs-helpers.js";
import { DefaultCodegenGenerateService } from "../job-engine/services/default-codegen-generate-service.js";
import { createValidateProjectService } from "../job-engine/services/validate-project-service.js";
import { applyIrOverrides } from "../job-engine/ir-overrides.js";
import { buildFigmaAnalysis } from "./figma-analysis.js";
import { generateArtifacts } from "./generator-core.js";
import { applyAppShellsToDesignIr } from "./ir-app-shells.js";
import { applyScreenVariantFamiliesToDesignIr } from "./ir-screen-variants.js";
import { figmaToDesignIrWithOptions } from "./ir.js";
import type { DesignIR } from "./types-ir.js";

interface GoldenArtifactSpec {
  name: string;
  kind: "json" | "text";
  actual: string;
  expected: string;
  actualRoot?: "job" | "project";
}

interface GoldenFixtureSpec {
  id: string;
  figmaJson: string;
  irOverridesFile?: string;
  artifacts?: GoldenArtifactSpec[];
  snapshotGeneratedFiles?: boolean;
  unsupportedNodeReport?: boolean;
  validation?: boolean;
}

interface GoldenFixtureManifest {
  version: number;
  pipelineId: "default" | "rocket";
  fixtures: GoldenFixtureSpec[];
}

type DefaultDemoSurface = "board" | "component" | "view";

interface DefaultDemoFixtureMetadata {
  surface: DefaultDemoSurface;
  scenario: string;
  coverage: string[];
  ossNeutral: boolean;
  syntheticData: boolean;
}

interface DefaultGoldenFixtureSpec extends GoldenFixtureSpec {
  demo?: DefaultDemoFixtureMetadata;
}

interface DefaultGoldenFixtureManifest extends GoldenFixtureManifest {
  pipelineId: "default";
  fixtures: DefaultGoldenFixtureSpec[];
  demoPack?: {
    id: string;
    title: string;
    domain: string;
    dataPolicy: string;
    customerData: boolean;
    proprietaryAssets: boolean;
  };
}

interface GeneratedFixtureArtifacts {
  jobDir?: string;
  projectDir: string;
  generatedPaths?: string[];
}

interface PreparedFixtureInput {
  figmaAnalysis: ReturnType<typeof buildFigmaAnalysis>;
  fixture: GoldenFixtureSpec;
  ir: DesignIR;
}

const MODULE_DIR =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, "../..");
const GOLDEN_ROOT = path.resolve(MODULE_DIR, "fixtures", "golden");
const DEFAULT_GOLDEN_ROOT = path.join(GOLDEN_ROOT, "default");
const ROCKET_GOLDEN_ROOT = path.join(GOLDEN_ROOT, "rocket");
const DEFAULT_PIPELINE_METADATA = {
  pipelineId: "default",
  pipelineDisplayName: "Default",
  templateBundleId: "react-tailwind-app",
  buildProfile: "default-rocket",
  deterministic: true,
} as const;
const ROCKET_PIPELINE_METADATA = {
  pipelineId: "rocket",
  pipelineDisplayName: "Rocket",
  templateBundleId: "react-mui-app",
  buildProfile: "default-rocket",
  deterministic: true,
} as const;

const normalizeText = (value: string): string => {
  return `${value.replace(/\r\n/g, "\n").trimEnd()}\n`;
};

const STABLE_TIMESTAMP_PLACEHOLDER = "<stable-timestamp>";
const STABLE_PATH_PLACEHOLDER = "<stable-path>";
const STABLE_NUMBER_PLACEHOLDER = "<stable-number>";

const normalizeDynamicJsonFields = (
  value: unknown,
  key = "",
  pathSegments: readonly string[] = [],
  artifactPath = "",
): unknown => {
  if (
    typeof value === "string" &&
    (key === "validatedAt" || key === "generatedAt")
  ) {
    return STABLE_TIMESTAMP_PLACEHOLDER;
  }

  if (artifactPath.endsWith("validation-summary.json")) {
    if (pathSegments.join(".") === "uiA11y.reportPath") {
      return STABLE_PATH_PLACEHOLDER;
    }
    if (
      pathSegments[0] === "uiA11y" &&
      pathSegments[1] === "artifacts" &&
      typeof value === "string"
    ) {
      return STABLE_PATH_PLACEHOLDER;
    }
    if (pathSegments.join(".") === "compositeQuality.performance.sourcePath") {
      return STABLE_PATH_PLACEHOLDER;
    }
    if (
      pathSegments[0] === "compositeQuality" &&
      pathSegments[1] === "performance" &&
      (pathSegments[2] === "samples" || pathSegments[2] === "aggregateMetrics") &&
      typeof value === "number"
    ) {
      return STABLE_NUMBER_PLACEHOLDER;
    }
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      normalizeDynamicJsonFields(
        entry,
        String(index),
        [...pathSegments, String(index)],
        artifactPath,
      ),
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        normalizeDynamicJsonFields(
          childValue,
          childKey,
          [...pathSegments, childKey],
          artifactPath,
        ),
      ]),
    );
  }
  return value;
};

const normalizeJson = (value: string, artifactPath: string): string => {
  return `${JSON.stringify(
    normalizeDynamicJsonFields(JSON.parse(value), "", [], artifactPath),
    null,
    2,
  )}\n`;
};

const normalizeArtifactContent = ({
  kind,
  value,
  artifactPath,
}: {
  kind: GoldenArtifactSpec["kind"];
  value: string;
  artifactPath: string;
}): string => {
  return kind === "json" ? normalizeJson(value, artifactPath) : normalizeText(value);
};

const shouldApproveGolden = (): boolean => {
  const raw = process.env.FIGMAPIPE_GOLDEN_APPROVE?.trim().toLowerCase();
  return raw === "1" || raw === "true";
};

const isCiRuntime = (): boolean => {
  const raw = process.env.CI?.trim().toLowerCase();
  if (!raw) {
    return false;
  }
  return raw !== "0" && raw !== "false";
};

const withTemporaryEnv = async (
  overrides: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> => {
  const previousEntries = Object.entries(overrides).map(([key]) => [
    key,
    process.env[key],
  ]);

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }

  try {
    await run();
  } finally {
    for (const [key, value] of previousEntries) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  }
};

const REQUIRED_DEFAULT_DEMO_COVERAGE = [
  "board",
  "component",
  "dense-table",
  "forms",
  "login-mfa",
  "mobile-navigation",
  "payment-authorization",
  "responsive",
  "risk-alert-modal",
  "token-heavy",
  "view",
] as const;

const FORBIDDEN_DEFAULT_DEMO_TEXT = [
  /alice johnson/i,
  /bob smith/i,
  /jane smith/i,
  /john@example\.com/i,
  /alice@example\.com/i,
  /bob@example\.com/i,
  /wireless headphones/i,
  /bluetooth speaker/i,
  /smart watch/i,
  /lbbw/i,
  /mui/i,
  /emotion/i,
  /rocket/i,
  /customer[-_\s]*board/i,
  /customer[-_\s]*profile/i,
  /customer-specific/i,
] as const;

const loadManifest = async ({
  expectedPipelineId,
  root,
}: {
  expectedPipelineId: GoldenFixtureManifest["pipelineId"];
  root: string;
}): Promise<GoldenFixtureManifest> => {
  const payload = JSON.parse(
    await readFile(path.join(root, "manifest.json"), "utf8"),
  ) as Partial<GoldenFixtureManifest>;
  assert.equal(
    payload.version,
    1,
    "Unsupported golden fixture manifest version.",
  );
  assert.equal(
    payload.pipelineId,
    expectedPipelineId,
    `Golden fixtures in '${root}' must be owned by the ${expectedPipelineId} pipeline.`,
  );
  assert.equal(
    Array.isArray(payload.fixtures),
    true,
    "Manifest must contain fixtures[].",
  );
  return payload as GoldenFixtureManifest;
};

const loadIrOverrides = async ({
  fixture,
  root,
}: {
  fixture: GoldenFixtureSpec;
  root: string;
}): Promise<WorkspaceRegenerationOverrideEntry[]> => {
  if (!fixture.irOverridesFile) {
    return [];
  }

  const overridesPath = path.join(root, fixture.irOverridesFile);
  const payload = JSON.parse(await readFile(overridesPath, "utf8")) as unknown;
  assert.equal(
    Array.isArray(payload),
    true,
    `Fixture '${fixture.id}' overrides must be an array.`,
  );
  return payload as WorkspaceRegenerationOverrideEntry[];
};

const assertDefaultDemoFixturePack = async ({
  manifest,
  root,
}: {
  manifest: DefaultGoldenFixtureManifest;
  root: string;
}): Promise<void> => {
  assert.deepEqual(manifest.demoPack, {
    id: "oss-neutral-financial-default-demo",
    title: "OSS-neutral financial default pipeline demo fixture pack",
    domain: "financial-services",
    dataPolicy: "synthetic-only",
    customerData: false,
    proprietaryAssets: false,
  });

  const covered = new Set<string>();
  const surfaces = new Set<DefaultDemoSurface>();
  let hasValidatedEvidenceFixture = false;
  let hasComponentGeneratingFixture = false;

  for (const fixture of manifest.fixtures) {
    assert.ok(
      fixture.demo,
      `Default fixture '${fixture.id}' must declare demo metadata.`,
    );
    assert.equal(
      fixture.demo.ossNeutral,
      true,
      `Default fixture '${fixture.id}' must be OSS-neutral.`,
    );
    assert.equal(
      fixture.demo.syntheticData,
      true,
      `Default fixture '${fixture.id}' must use synthetic data.`,
    );
    assert.notEqual(
      fixture.demo.scenario.trim(),
      "",
      `Default fixture '${fixture.id}' must describe its financial scenario.`,
    );
    surfaces.add(fixture.demo.surface);
    for (const coverage of fixture.demo.coverage) {
      covered.add(coverage);
    }
    if (fixture.validation === true) {
      hasValidatedEvidenceFixture = true;
    }
    if (fixture.demo.surface === "component") {
      const generatedFilesPath = path.join(
        root,
        fixture.id,
        "expected",
        "generated-files.json",
      );
      const generatedFiles = JSON.parse(
        await readFile(generatedFilesPath, "utf8"),
      ) as unknown;
      assert.equal(
        Array.isArray(generatedFiles),
        true,
        `Default component fixture '${fixture.id}' must snapshot generated files.`,
      );
      hasComponentGeneratingFixture = generatedFiles.some(
        (entry) =>
          typeof entry === "string" &&
          entry.startsWith("src/components/") &&
          entry.endsWith(".tsx"),
      );
    }

    const figmaJson = await readFile(
      path.join(root, fixture.figmaJson),
      "utf8",
    );
    for (const forbidden of FORBIDDEN_DEFAULT_DEMO_TEXT) {
      assert.equal(
        forbidden.test(figmaJson),
        false,
        `Default demo fixture '${fixture.id}' contains forbidden non-demo text matching ${forbidden}.`,
      );
    }
  }

  assert.deepEqual(
    [...surfaces].sort(),
    ["board", "component", "view"] satisfies DefaultDemoSurface[],
    "Default demo fixtures must cover board, component, and view generation surfaces.",
  );
  for (const required of REQUIRED_DEFAULT_DEMO_COVERAGE) {
    assert.equal(
      covered.has(required),
      true,
      `Default demo fixture pack must cover '${required}'.`,
    );
  }
  assert.equal(
    hasValidatedEvidenceFixture,
    true,
    "Default demo fixture pack must include at least one validation and quality-passport evidence fixture.",
  );
  assert.equal(
    hasComponentGeneratingFixture,
    true,
    "Default demo fixture pack must include a component fixture that snapshots generated component files.",
  );
};

const listFiles = async ({ root }: { root: string }): Promise<string[]> => {
  const result: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") {
          continue;
        }
        stack.push(entryPath);
        continue;
      }
      result.push(path.relative(root, entryPath).replace(/\\/g, "/"));
    }
  }

  return result.sort((left, right) => left.localeCompare(right));
};

const assertActualFileExists = async ({
  absolutePath,
  artifact,
  fixtureId,
  projectDir,
}: {
  absolutePath: string;
  artifact: GoldenArtifactSpec;
  fixtureId: string;
  projectDir: string;
}): Promise<void> => {
  try {
    await readFile(absolutePath, "utf8");
  } catch {
    const available = await listFiles({ root: projectDir });
    assert.fail(
      `Missing generated artifact for fixture '${fixtureId}': '${artifact.actual}'. Available files: ${available.join(", ") || "(none)"}`,
    );
  }
};

const prepareFixtureInput = async ({
  fixture,
  root,
}: {
  fixture: GoldenFixtureSpec;
  root: string;
}): Promise<PreparedFixtureInput> => {
  const figmaJsonPath = path.join(root, fixture.figmaJson);
  const figmaPayload = JSON.parse(await readFile(figmaJsonPath, "utf8"));

  const cleaned = cleanFigmaForCodegen({
    file: figmaPayload,
  });

  const baseIr = figmaToDesignIrWithOptions(cleaned.cleanedFile, {
    brandTheme: "derived",
  });
  const overrides = await loadIrOverrides({ fixture, root });
  const irWithOverrides =
    overrides.length > 0
      ? applyIrOverrides({
          ir: baseIr,
          overrides,
        }).ir
      : baseIr;
  const figmaAnalysis = buildFigmaAnalysis({ file: cleaned.cleanedFile });
  const irWithAppShells = applyAppShellsToDesignIr({
    ir: irWithOverrides,
    figmaAnalysis,
  });
  const ir = applyScreenVariantFamiliesToDesignIr({
    ir: irWithAppShells,
    figmaAnalysis,
  });

  return { figmaAnalysis, fixture, ir };
};

const createUnsupportedNodeReport = (ir: DesignIR): unknown => {
  const diagnostics = (ir.metrics?.nodeDiagnostics ?? []).filter(
    (entry) =>
      entry.category === "unsupported-board-component" ||
      entry.category === "classification-fallback" ||
      entry.category === "screen-candidate-rejection",
  );
  return {
    schemaVersion: "1.0.0",
    pipelineId: "default",
    unsupportedNodeCount: diagnostics.length,
    diagnostics,
    classificationFallbacks: [...(ir.metrics?.classificationFallbacks ?? [])],
  };
};

const createGoldenJobRecord = ({
  generatedProjectDir,
  jobDir,
  pipelineId,
  request,
  runtime,
}: {
  generatedProjectDir: string;
  jobDir: string;
  pipelineId: "default";
  request: SubmissionJobInput;
  runtime: ReturnType<typeof resolveRuntimeSettings>;
}): JobRecord => {
  const stages = createInitialStages();
  for (const stage of stages) {
    if (
      stage.name === "figma.source" ||
      stage.name === "ir.derive" ||
      stage.name === "template.prepare" ||
      stage.name === "codegen.generate"
    ) {
      stage.status = "completed";
      stage.startedAt = nowIso();
      stage.finishedAt = stage.startedAt;
    }
  }
  return {
    jobId: `golden-${pipelineId}-${request.figmaJsonPath ? path.basename(path.dirname(request.figmaJsonPath)) : "fixture"}`,
    status: "running",
    submittedAt: nowIso(),
    startedAt: nowIso(),
    request: {
      ...request,
      pipelineId,
      pipelineMetadata: DEFAULT_PIPELINE_METADATA,
    },
    stages,
    logs: [],
    artifacts: {
      outputRoot: path.dirname(path.dirname(jobDir)),
      jobDir,
      generatedProjectDir,
      figmaJsonFile: path.join(jobDir, "figma.json"),
      designIrFile: path.join(jobDir, "design-ir.json"),
      stageTimingsFile: path.join(jobDir, "stage-timings.json"),
      qualityPassportFile: path.join(
        generatedProjectDir,
        "quality-passport.json",
      ),
    },
    preview: { enabled: false },
    queue: {
      runningCount: 0,
      queuedCount: 0,
      maxConcurrentJobs: runtime.maxConcurrentJobs,
      maxQueuedJobs: runtime.maxQueuedJobs,
    },
    pipelineMetadata: DEFAULT_PIPELINE_METADATA,
  };
};

const createDefaultExecutionContext = async ({
  fixture,
  generatedProjectDir,
  jobDir,
}: {
  fixture: GoldenFixtureSpec;
  generatedProjectDir: string;
  jobDir: string;
}): Promise<PipelineExecutionContext> => {
  const runtime = resolveRuntimeSettings({
    commandTimeoutMs: 180_000,
    enableLintAutofix: false,
    enablePreview: false,
    enableUiValidation: false,
    enableUnitTestValidation: false,
    figmaMaxRetries: 1,
    figmaRequestTimeoutMs: 1_000,
    installPreferOffline: true,
    skipInstall: false,
  });
  const outputRoot = path.dirname(path.dirname(jobDir));
  const jobsRoot = path.dirname(jobDir);
  const reprosRoot = path.join(outputRoot, "repros");
  const request: SubmissionJobInput = {
    pipelineId: "default",
    figmaSourceMode: "local_json",
    figmaJsonPath: path.join(DEFAULT_GOLDEN_ROOT, fixture.figmaJson),
  };
  const job = createGoldenJobRecord({
    generatedProjectDir,
    jobDir,
    pipelineId: "default",
    request,
    runtime,
  });
  const artifactStore = new StageArtifactStore({ jobDir });
  const diskTracker = new JobDiskTracker({
    roots: [jobDir, path.join(reprosRoot, job.jobId)],
    limitBytes: runtime.maxJobDiskBytes,
    limits: runtime.pipelineDiagnosticLimits,
  });
  await diskTracker.sync();
  const templateRoot = path.join(
    REPO_ROOT,
    DEFAULT_PIPELINE_DEFINITION.template.path,
  );

  return {
    mode: "submission",
    job,
    input: request,
    pipelineMetadata: DEFAULT_PIPELINE_METADATA,
    runtime,
    resolvedPaths: {
      outputRoot,
      jobsRoot,
      reprosRoot,
    },
    resolvedWorkspaceRoot: REPO_ROOT,
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
      reproDir: path.join(reprosRoot, job.jobId),
      iconMapFilePath: path.join(outputRoot, "icon-map.json"),
      designSystemFilePath: path.join(outputRoot, "design-system.json"),
      irCacheDir: path.join(outputRoot, "cache", "ir"),
      templateRoot,
      templateCopyFilter: createTemplateCopyFilter({ templateRoot }),
    },
    artifactStore,
    diskTracker,
    resolvedBrandTheme: "derived",
    resolvedFigmaSourceMode: "local_json",
    resolvedFormHandlingMode: "react_hook_form",
    generationLocaleResolution: { locale: "en-US" },
    resolvedGenerationLocale: "en-US",
    appendDiagnostics: () => {
      // Golden tests assert persisted deterministic reports, not runtime diagnostics plumbing.
    },
    getCollectedDiagnostics: () => undefined,
    syncPublicJobProjection: async () => {
      // The public projection is covered by job-engine tests; goldens only need stage artifacts.
    },
  };
};

const generateRocketFixtureArtifacts = async ({
  figmaAnalysis,
  fixture,
  ir,
}: PreparedFixtureInput): Promise<GeneratedFixtureArtifacts> => {
  const projectDir = await mkdtemp(
    path.join(os.tmpdir(), `workspace-dev-golden-rocket-${fixture.id}-`),
  );
  await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    },
  });
  await writeFile(
    path.join(projectDir, "design-ir.json"),
    `${JSON.stringify(ir, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(projectDir, "figma-analysis.json"),
    `${JSON.stringify(figmaAnalysis, null, 2)}\n`,
    "utf8",
  );
  return { projectDir };
};

const generateDefaultFixtureArtifacts = async ({
  figmaAnalysis,
  fixture,
  ir,
}: PreparedFixtureInput): Promise<GeneratedFixtureArtifacts> => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), `workspace-dev-golden-default-${fixture.id}-`),
  );
  const jobDir = path.join(rootDir, "jobs", fixture.id);
  const projectDir = path.join(jobDir, "generated-app");
  await mkdir(jobDir, { recursive: true });
  await copyDir({
    sourceDir: path.join(REPO_ROOT, DEFAULT_PIPELINE_DEFINITION.template.path),
    targetDir: projectDir,
    filter: createTemplateCopyFilter({
      templateRoot: path.join(
        REPO_ROOT,
        DEFAULT_PIPELINE_DEFINITION.template.path,
      ),
    }),
  });

  const context = await createDefaultExecutionContext({
    fixture,
    generatedProjectDir: projectDir,
    jobDir,
  });
  await writeFile(
    context.paths.designIrFile,
    `${JSON.stringify(ir, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    context.paths.figmaAnalysisFile,
    `${JSON.stringify(figmaAnalysis, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(projectDir, "design-ir.json"),
    `${JSON.stringify(ir, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(projectDir, "figma-analysis.json"),
    `${JSON.stringify(figmaAnalysis, null, 2)}\n`,
    "utf8",
  );
  await context.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: context.paths.designIrFile,
  });
  await context.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: projectDir,
  });

  await DefaultCodegenGenerateService.execute(
    {
      boardKeySeed: fixture.id,
    },
    createStageRuntimeContext({
      executionContext: context,
      stage: "codegen.generate",
    }),
  );

  const codegenSummary = await context.artifactStore.getValue<{
    generatedPaths: string[];
  }>(STAGE_ARTIFACT_KEYS.codegenSummary);
  const generatedPaths = [...(codegenSummary?.generatedPaths ?? [])].sort(
    (left, right) => left.localeCompare(right),
  );
  await writeFile(
    path.join(projectDir, "generated-files.json"),
    `${JSON.stringify(generatedPaths, null, 2)}\n`,
    "utf8",
  );

  if (fixture.unsupportedNodeReport === true) {
    await writeFile(
      path.join(projectDir, "unsupported-nodes.json"),
      `${JSON.stringify(createUnsupportedNodeReport(ir), null, 2)}\n`,
      "utf8",
    );
  }

  if (fixture.validation === true) {
    await withTemporaryEnv(
      {
        FIGMAPIPE_PERF_STRICT: "false",
      },
      async () => {
        const service = createValidateProjectService();
        await service.execute(
          undefined,
          createStageRuntimeContext({
            executionContext: context,
            stage: "validate.project",
          }),
        );
      },
    );
    await cp(
      path.join(jobDir, "validation-summary.json"),
      path.join(projectDir, "validation-summary.json"),
    );
  }

  return { jobDir, projectDir, generatedPaths };
};

const defaultGeneratedFileArtifacts = ({
  fixture,
  generatedPaths,
}: {
  fixture: GoldenFixtureSpec;
  generatedPaths: readonly string[];
}): GoldenArtifactSpec[] => {
  if (fixture.snapshotGeneratedFiles !== true) {
    return [];
  }
  return generatedPaths.map((generatedPath) => ({
    name: `generated:${generatedPath}`,
    kind: generatedPath.endsWith(".json") ? "json" : "text",
    actual: generatedPath,
    expected: `${fixture.id}/expected/generated/${generatedPath}`,
  }));
};

const defaultFixtureArtifacts = ({
  fixture,
  generatedPaths,
}: {
  fixture: GoldenFixtureSpec;
  generatedPaths: readonly string[];
}): GoldenArtifactSpec[] => [
  {
    name: "design-ir",
    kind: "json",
    actual: "design-ir.json",
    expected: `${fixture.id}/expected/design-ir.json`,
  },
  {
    name: "figma-analysis",
    kind: "json",
    actual: "figma-analysis.json",
    expected: `${fixture.id}/expected/figma-analysis.json`,
  },
  {
    name: "generated-files",
    kind: "json",
    actual: "generated-files.json",
    expected: `${fixture.id}/expected/generated-files.json`,
  },
  ...(fixture.unsupportedNodeReport === true
    ? [
        {
          name: "unsupported-nodes",
          kind: "json" as const,
          actual: "unsupported-nodes.json",
          expected: `${fixture.id}/expected/unsupported-nodes.json`,
        },
      ]
    : []),
  ...(fixture.validation === true
    ? [
        {
          name: "validation-summary",
          kind: "json" as const,
          actual: "validation-summary.json",
          expected: `${fixture.id}/expected/validation-summary.json`,
        },
        {
          name: "quality-passport",
          kind: "json" as const,
          actual: "quality-passport.json",
          expected: `${fixture.id}/expected/quality-passport.json`,
        },
      ]
    : []),
  ...defaultGeneratedFileArtifacts({ fixture, generatedPaths }),
  ...(fixture.artifacts ?? []),
];

const resolveActualPath = ({
  artifact,
  generated,
}: {
  artifact: GoldenArtifactSpec;
  generated: GeneratedFixtureArtifacts;
}): string => {
  const root =
    artifact.actualRoot === "job" ? generated.jobDir : generated.projectDir;
  assert.ok(
    root,
    `Artifact '${artifact.name}' requested missing actual root '${artifact.actualRoot}'.`,
  );
  return path.join(root, artifact.actual);
};

const assertGeneratedArtifactsMatchSnapshots = async ({
  artifacts,
  expectedRoot,
  first,
  fixtureId,
  second,
}: {
  artifacts: readonly GoldenArtifactSpec[];
  expectedRoot: string;
  first: GeneratedFixtureArtifacts;
  fixtureId: string;
  second: GeneratedFixtureArtifacts;
}): Promise<void> => {
  for (const artifact of artifacts) {
    const actualPath = resolveActualPath({ artifact, generated: first });
    const secondActualPath = resolveActualPath({ artifact, generated: second });
    await assertActualFileExists({
      fixtureId,
      artifact,
      projectDir: first.projectDir,
      absolutePath: actualPath,
    });
    await assertActualFileExists({
      fixtureId,
      artifact,
      projectDir: second.projectDir,
      absolutePath: secondActualPath,
    });

    const actualRaw = await readFile(actualPath, "utf8");
    const secondActualRaw = await readFile(secondActualPath, "utf8");
    const normalizedActual = normalizeArtifactContent({
      kind: artifact.kind,
      value: actualRaw,
      artifactPath: artifact.actual,
    });
    const normalizedSecondActual = normalizeArtifactContent({
      kind: artifact.kind,
      value: secondActualRaw,
      artifactPath: artifact.actual,
    });

    assert.equal(
      normalizedActual,
      normalizedSecondActual,
      `Deterministic rerun mismatch for fixture '${fixtureId}', artifact '${artifact.name}' (${artifact.actual}).`,
    );

    if (artifact.actual === "src/App.tsx") {
      assert.equal(
        normalizedActual.includes("style={{"),
        false,
        `Golden App.tsx for fixture '${fixtureId}' still uses inline style.`,
      );
      assert.equal(
        normalizedActual.includes("onFocus={"),
        false,
        `Golden App.tsx for fixture '${fixtureId}' still uses DOM style mutation handlers.`,
      );
      assert.equal(
        normalizedActual.includes("onBlur={"),
        false,
        `Golden App.tsx for fixture '${fixtureId}' still uses DOM style mutation handlers.`,
      );
    }

    const expectedPath = path.join(expectedRoot, artifact.expected);

    if (shouldApproveGolden()) {
      await mkdir(path.dirname(expectedPath), { recursive: true });
      await writeFile(expectedPath, normalizedActual, "utf8");
      continue;
    }

    let expectedRaw: string;
    try {
      expectedRaw = await readFile(expectedPath, "utf8");
    } catch {
      assert.fail(
        `Missing expected golden file '${artifact.expected}' for fixture '${fixtureId}'. ` +
          "Run 'pnpm run test:golden:update' to approve snapshots.",
      );
    }

    const normalizedExpected = normalizeArtifactContent({
      kind: artifact.kind,
      value: expectedRaw,
      artifactPath: artifact.actual,
    });

    assert.equal(
      normalizedActual,
      normalizedExpected,
      `Golden diff for fixture '${fixtureId}', artifact '${artifact.name}' (${artifact.actual}). ` +
        "If intentional, run 'pnpm run test:golden:update'.",
    );
  }
};

const runRocketSuite = async (t: test.TestContext): Promise<void> => {
  const manifest = await loadManifest({
    expectedPipelineId: "rocket",
    root: ROCKET_GOLDEN_ROOT,
  });
  assert.equal(manifest.pipelineId, ROCKET_PIPELINE_DEFINITION.id);
  assert.deepEqual(
    ROCKET_PIPELINE_DEFINITION.buildSubmissionPlan({ mode: "submission" }).map(
      (entry) => entry.service.stageName,
    ),
    [
      "figma.source",
      "ir.derive",
      "template.prepare",
      "codegen.generate",
      "validate.project",
      "repro.export",
      "git.pr",
    ] satisfies WorkspaceJobStageName[],
  );
  assert.equal(
    ROCKET_PIPELINE_DEFINITION.template.bundleId,
    ROCKET_PIPELINE_METADATA.templateBundleId,
  );
  assert.equal(ROCKET_PIPELINE_DEFINITION.template.stack.styling, "mui");

  for (const fixture of manifest.fixtures) {
    await t.test(`rocket fixture ${fixture.id}`, async () => {
      const input = await prepareFixtureInput({
        fixture,
        root: ROCKET_GOLDEN_ROOT,
      });
      const first = await generateRocketFixtureArtifacts(input);
      const second = await generateRocketFixtureArtifacts(input);
      await assertGeneratedArtifactsMatchSnapshots({
        artifacts: fixture.artifacts ?? [],
        expectedRoot: ROCKET_GOLDEN_ROOT,
        first,
        fixtureId: fixture.id,
        second,
      });
    });
  }
};

const runDefaultSuite = async (t: test.TestContext): Promise<void> => {
  const manifest = (await loadManifest({
    expectedPipelineId: "default",
    root: DEFAULT_GOLDEN_ROOT,
  })) as DefaultGoldenFixtureManifest;
  await assertDefaultDemoFixturePack({ manifest, root: DEFAULT_GOLDEN_ROOT });
  assert.equal(manifest.pipelineId, DEFAULT_PIPELINE_DEFINITION.id);
  assert.deepEqual(
    DEFAULT_PIPELINE_DEFINITION.buildSubmissionPlan({ mode: "submission" }).map(
      (entry) => entry.service.stageName,
    ),
    [
      "figma.source",
      "ir.derive",
      "template.prepare",
      "codegen.generate",
      "validate.project",
      "repro.export",
      "git.pr",
    ] satisfies WorkspaceJobStageName[],
  );
  assert.equal(
    DEFAULT_PIPELINE_DEFINITION.template.bundleId,
    DEFAULT_PIPELINE_METADATA.templateBundleId,
  );
  assert.equal(DEFAULT_PIPELINE_DEFINITION.template.stack.styling, "tailwind");

  for (const fixture of manifest.fixtures) {
    await t.test(`default fixture ${fixture.id}`, async () => {
      const input = await prepareFixtureInput({
        fixture,
        root: DEFAULT_GOLDEN_ROOT,
      });
      const first = await generateDefaultFixtureArtifacts(input);
      const second = await generateDefaultFixtureArtifacts(input);
      assert.deepEqual(first.generatedPaths, second.generatedPaths);
      await assertGeneratedArtifactsMatchSnapshots({
        artifacts: defaultFixtureArtifacts({
          fixture,
          generatedPaths: first.generatedPaths ?? [],
        }),
        expectedRoot: DEFAULT_GOLDEN_ROOT,
        first,
        fixtureId: fixture.id,
        second,
      });
    });
  }
};

test("default pipeline overwrites the copied Playwright template for generated apps", async () => {
  const manifest = (await loadManifest({
    expectedPipelineId: "rocket",
    root: ROCKET_GOLDEN_ROOT,
  })) as GoldenFixtureManifest;
  const fixture = manifest.fixtures.find((entry) => entry.id === "simple-auth");

  if (!fixture) {
    throw new Error("Expected the rocket simple-auth fixture to exist.");
  }
  const input = await prepareFixtureInput({
    fixture,
    root: ROCKET_GOLDEN_ROOT,
  });
  const { projectDir } = await generateDefaultFixtureArtifacts(input);
  const validationContext = await createDefaultExecutionContext({
    fixture,
    generatedProjectDir: projectDir,
    jobDir: path.dirname(projectDir),
  });
  await validationContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: projectDir,
  });
  await validationContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: fixture.id,
    } satisfies GenerationDiffContext,
  });
  const validationService = createValidateProjectService();
  await validationService.execute(
    undefined,
    createStageRuntimeContext({
      executionContext: validationContext,
      stage: "validate.project",
    }),
  );
  const playwrightSpec = await readFile(
    path.join(projectDir, "e2e", "template.spec.ts"),
    "utf8",
  );

  assert.match(playwrightSpec, /getByTestId\("generated-app"\)/);
  assert.doesNotMatch(
    playwrightSpec,
    /React, TypeScript, Vite, and Tailwind ready for generated apps\./,
  );
  assert.doesNotMatch(playwrightSpec, /WorkspaceDev default template/);
  assert.doesNotMatch(playwrightSpec, /document\.querySelectorAll\("article"\)/);
});

test("golden fixtures: pipeline-specific figma json to generated app artifacts", async (t) => {
  const approveMode = shouldApproveGolden();
  if (approveMode && isCiRuntime()) {
    assert.fail("FIGMAPIPE_GOLDEN_APPROVE cannot be enabled in CI.");
  }

  await t.test("rocket", runRocketSuite);
  await t.test("default", runDefaultSuite);
});
