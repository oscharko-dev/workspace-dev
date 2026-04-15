/**
 * Service-level parity for FigmaSourceService under figma_paste vs local_json.
 *
 * After the paste handler in `src/server/request-handler.ts` normalizes a
 * clipboard payload, the job is submitted as `local_json` with `figmaJsonPath`
 * pointing at a tmp file containing the same JSON. This test asserts that
 * FigmaSourceService, when given identical input bytes from two different
 * paths, produces identical `figma.raw.json` and `figma.json` outputs.
 *
 * This guards the CORE Wave 3 acceptance criterion at the service boundary so
 * regressions are caught without full-server setup.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  WorkspaceBrandTheme,
  WorkspaceFigmaSourceMode,
  WorkspaceFormHandlingMode,
  WorkspaceJobStageName,
} from "../../contracts/index.js";
import { StageArtifactStore } from "../pipeline/artifact-store.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import {
  createStageRuntimeContext,
  type PipelineExecutionContext,
  type StageRuntimeContext,
} from "../pipeline/context.js";
import { resolveRuntimeSettings } from "../runtime.js";
import { createInitialStages, nowIso } from "../stage-state.js";
import type { JobRecord } from "../types.js";
import { FigmaSourceService } from "./figma-source-service.js";

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  "src/parity/fixtures/golden/prototype-navigation/figma.json",
);

interface StageHarness {
  executionContext: PipelineExecutionContext;
  stageContextFor: (stage: WorkspaceJobStageName) => StageRuntimeContext;
}

const buildStageHarness = async ({
  rootLabel,
  jobId,
}: {
  rootLabel: string;
  jobId: string;
}): Promise<StageHarness> => {
  const root = await mkdtemp(path.join(os.tmpdir(), rootLabel));
  const jobsRoot = path.join(root, "jobs");
  const jobDir = path.join(jobsRoot, jobId);
  const generatedProjectDir = path.join(jobDir, "generated-app");
  await mkdir(jobDir, { recursive: true });
  await mkdir(generatedProjectDir, { recursive: true });

  const runtime = resolveRuntimeSettings({
    enablePreview: false,
    skipInstall: true,
    enableUiValidation: false,
    enableUnitTestValidation: false,
    figmaMaxRetries: 1,
    figmaRequestTimeoutMs: 1_000,
  });

  const job: JobRecord = {
    jobId,
    status: "queued",
    submittedAt: nowIso(),
    request: {
      enableVisualQualityValidation: false,
      enableGitPr: false,
      figmaSourceMode: "local_json",
      llmCodegenMode: "deterministic",
      brandTheme: "derived",
      generationLocale: "en-US",
      formHandlingMode: "react_hook_form",
    },
    stages: createInitialStages(),
    logs: [],
    artifacts: {
      outputRoot: root,
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

  const artifactStore = new StageArtifactStore({ jobDir });
  const resolvedBrandTheme = "derived" as WorkspaceBrandTheme;
  const resolvedFigmaSourceMode = "local_json" as WorkspaceFigmaSourceMode;
  const resolvedFormHandlingMode = "react_hook_form" as WorkspaceFormHandlingMode;

  const executionContext: PipelineExecutionContext = {
    mode: "submission",
    job,
    runtime,
    resolvedPaths: {
      outputRoot: root,
      jobsRoot,
      reprosRoot: path.join(root, "repros"),
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
      templateCopyFilter: () => true,
    },
    artifactStore,
    resolvedBrandTheme,
    resolvedFigmaSourceMode,
    resolvedFormHandlingMode,
    generationLocaleResolution: { locale: "en-US" },
    resolvedGenerationLocale: "en-US",
    appendDiagnostics: () => {
      // no-op
    },
    getCollectedDiagnostics: () => undefined,
    syncPublicJobProjection: async () => {
      // no-op
    },
  };

  return {
    executionContext,
    stageContextFor: (stage) =>
      createStageRuntimeContext({ executionContext, stage }),
  };
};

const runFigmaSourceForPath = async ({
  rootLabel,
  jobId,
  inputPath,
}: {
  rootLabel: string;
  jobId: string;
  inputPath: string;
}): Promise<{ raw: string; cleaned: string }> => {
  const harness = await buildStageHarness({ rootLabel, jobId });
  await FigmaSourceService.execute(
    { figmaJsonPath: inputPath },
    harness.stageContextFor("figma.source"),
  );

  const rawPath = await harness.executionContext.artifactStore.getPath(
    STAGE_ARTIFACT_KEYS.figmaRaw,
  );
  const cleanedPath = await harness.executionContext.artifactStore.getPath(
    STAGE_ARTIFACT_KEYS.figmaCleaned,
  );
  assert.ok(rawPath, "figma.raw artifact path must be registered");
  assert.ok(cleanedPath, "figma.cleaned artifact path must be registered");

  const raw = await readFile(rawPath, "utf8");
  const cleaned = await readFile(cleanedPath, "utf8");
  return { raw, cleaned };
};

test(
  "FigmaSourceService emits identical figma.raw.json and figma.json for local_json and paste-derived input",
  { timeout: 30_000 },
  async () => {
    const fixtureContent = await readFile(FIXTURE_PATH, "utf8");

    // Path A: simulate local_json — job references the fixture directly inside
    // its job directory (matching how a caller would colocate a fixture).
    const localHarnessBase = await mkdtemp(
      path.join(os.tmpdir(), "figma-paste-parity-localsrc-"),
    );
    const localInputPath = path.join(localHarnessBase, "local-figma.json");
    await writeFile(localInputPath, fixtureContent, "utf8");

    // Path B: simulate paste — handler wrote the normalized payload to a
    // `tmp-figma-paste/<uuid>.json` file before forwarding as local_json.
    const pasteTempDir = await mkdtemp(
      path.join(os.tmpdir(), "figma-paste-parity-pastesrc-"),
    );
    const pasteInputPath = path.join(pasteTempDir, "paste-payload.json");
    await writeFile(pasteInputPath, fixtureContent, "utf8");

    const localResult = await runFigmaSourceForPath({
      rootLabel: "figma-paste-parity-local-",
      jobId: "job-parity-local",
      inputPath: localInputPath,
    });
    const pasteResult = await runFigmaSourceForPath({
      rootLabel: "figma-paste-parity-paste-",
      jobId: "job-parity-paste",
      inputPath: pasteInputPath,
    });

    // Byte-for-byte equivalence on the raw payload (the service copies the
    // input JSON into figma.raw.json with no transformation).
    assert.equal(
      localResult.raw,
      pasteResult.raw,
      "figma.raw.json must be byte-identical across local_json and figma_paste",
    );

    // Structural equivalence on the cleaned payload — the cleaner is a pure
    // function of the raw input, so identical bytes in → identical bytes out.
    assert.equal(
      localResult.cleaned,
      pasteResult.cleaned,
      "figma.json (cleaned) must be byte-identical across local_json and figma_paste",
    );
  },
);
