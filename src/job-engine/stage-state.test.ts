import assert from "node:assert/strict";
import test from "node:test";
import {
  cloneCompositeQuality,
  cloneJobConfidence,
  createInitialStages,
  pushRuntimeLog,
  toAcceptedModes,
  toPublicJob,
  updateStage,
} from "./stage-state.js";
import type { JobRecord } from "./types.js";

const PIPELINE_METADATA = {
  pipelineId: "rocket",
  pipelineDisplayName: "Rocket",
  templateBundleId: "react-mui-app",
  buildProfile: "rocket",
  deterministic: true,
} as const;

const createJob = (jobId: string): JobRecord => ({
  jobId,
  status: "queued",
  submittedAt: new Date().toISOString(),
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
    outputRoot: "/tmp/output",
    jobDir: "/tmp/job",
  },
  preview: { enabled: false },
  queue: {
    runningCount: 0,
    queuedCount: 0,
    maxConcurrentJobs: 1,
    maxQueuedJobs: 1,
    position: 0,
  },
});

test("pushRuntimeLog persists debug entries to the job log stream", () => {
  const runtimeEntries: Array<{ level: string; message: string; stage?: string }> = [];
  const job = createJob("job-debug-log");

  const entry = pushRuntimeLog({
    job,
    logger: {
      log: (input) => {
        runtimeEntries.push({
          level: input.level,
          message: input.message,
          ...(input.stage ? { stage: input.stage } : {}),
        });
      },
    },
    level: "debug",
    stage: "figma.source",
    message: "debug trace",
  });

  assert.equal(entry.level, "debug");
  assert.equal(job.logs.length, 1);
  assert.equal(job.logs[0]?.level, "debug");
  assert.equal(job.logs[0]?.message, "debug trace");
  assert.deepEqual(runtimeEntries, [
    {
      level: "debug",
      message: "debug trace",
      stage: "figma.source",
    },
  ]);
});

test("pushRuntimeLog honors configured logLimit", () => {
  const job = createJob("job-log-limit");

  for (const message of ["one", "two", "three"]) {
    pushRuntimeLog({
      job,
      logger: { log: () => {} },
      level: "info",
      message,
      logLimit: 2,
    });
  }

  assert.deepEqual(
    job.logs.map((entry) => entry.message),
    ["two", "three"],
  );
});

test("toAcceptedModes normalizes supported figma source modes and defaults to rest", () => {
  assert.deepEqual(toAcceptedModes(), {
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic",
  });
  assert.deepEqual(toAcceptedModes({ figmaSourceMode: "  HYBRID  " }), {
    figmaSourceMode: "hybrid",
    llmCodegenMode: "deterministic",
  });
  assert.deepEqual(toAcceptedModes({ figmaSourceMode: "local_json" }), {
    figmaSourceMode: "local_json",
    llmCodegenMode: "deterministic",
  });
});

test("updateStage records lifecycle timestamps and ignores missing stages", () => {
  const job = createJob("job-update-stage");
  const stage = job.stages.find((entry) => entry.name === "ir.derive");
  assert.ok(stage);

  updateStage({
    job,
    stage: "ir.derive",
    status: "running",
  });
  assert.equal(stage?.status, "running");
  assert.equal(typeof stage?.startedAt, "string");

  updateStage({
    job,
    stage: "ir.derive",
    status: "completed",
    message: "done",
  });
  assert.equal(stage?.status, "completed");
  assert.equal(typeof stage?.completedAt, "string");
  assert.equal(typeof stage?.durationMs, "number");
  assert.equal((stage?.durationMs ?? -1) >= 0, true);
  assert.equal(stage?.message, "done");

  updateStage({
    job,
    stage: "validate.project",
    status: "skipped",
  });
  const skippedStage = job.stages.find((entry) => entry.name === "validate.project");
  assert.equal(skippedStage?.status, "skipped");
  assert.equal(typeof skippedStage?.completedAt, "string");
  assert.equal(skippedStage?.message, undefined);

  const missingStageJob = createJob("job-missing-stage");
  missingStageJob.stages = missingStageJob.stages.filter(
    (entry) => entry.name !== "git.pr",
  );
  const before = missingStageJob.stages.map((entry) => ({ ...entry }));
  updateStage({
    job: missingStageJob,
    stage: "git.pr",
    status: "failed",
    message: "not used",
  });
  assert.deepEqual(missingStageJob.stages, before);
});

test("cloneCompositeQuality and cloneJobConfidence deep copy nested collections", () => {
  const compositeQuality = {
    status: "completed" as const,
    generatedAt: "2026-04-20T00:00:00.000Z",
    weights: {
      visual: 0.6,
      performance: 0.4,
    },
    performance: {
      sourcePath: "lighthouse.json",
      score: 92,
      sampleCount: 1,
      samples: [
        {
          profile: "mobile" as const,
          route: "/",
          performanceScore: 91,
          fcp_ms: 100,
          lcp_ms: 200,
          cls: 0.01,
          tbt_ms: 10,
          speed_index_ms: 120,
        },
      ],
      aggregateMetrics: {
        fcp_ms: 100,
        lcp_ms: 200,
        cls: 0.01,
        tbt_ms: 10,
        speed_index_ms: 120,
      },
      warnings: ["slow route"],
    },
    composite: {
      score: 90,
      includedDimensions: ["visual", "performance"] as const,
      explanation: "balanced",
    },
    warnings: ["check route"],
  };
  const confidence = {
    status: "completed" as const,
    generatedAt: "2026-04-20T00:00:00.000Z",
    level: "high" as const,
    score: 98,
    contributors: [
      {
        signal: "stable-ui",
        impact: "positive" as const,
        weight: 1,
        value: 1,
        detail: "matched",
      },
    ],
    screens: [
      {
        screenId: "screen-1",
        screenName: "Screen 1",
        level: "high" as const,
        score: 99,
        contributors: [
          {
            signal: "screen-match",
            impact: "positive" as const,
            weight: 1,
            value: 1,
            detail: "matched",
          },
        ],
        components: [
          {
            componentId: "component-1",
            componentName: "Button",
            level: "high" as const,
            score: 97,
            contributors: [
              {
                signal: "mapped",
                impact: "positive" as const,
                weight: 1,
                value: 1,
                detail: "mapped",
              },
            ],
          },
        ],
      },
    ],
    lowConfidenceSummary: ["review copy"],
  };

  const compositeClone = cloneCompositeQuality(compositeQuality);
  const confidenceClone = cloneJobConfidence(confidence);

  compositeClone.performance!.samples[0]!.route = "/changed";
  compositeClone.performance!.warnings.push("new warning");
  compositeClone.composite!.includedDimensions.push("visual");
  compositeClone.warnings!.push("new composite warning");
  confidenceClone.contributors![0]!.signal = "changed";
  confidenceClone.screens![0]!.contributors[0]!.signal = "changed";
  confidenceClone.screens![0]!.components[0]!.contributors[0]!.signal = "changed";
  confidenceClone.lowConfidenceSummary!.push("changed");

  assert.equal(compositeQuality.performance?.samples[0]?.route, "/");
  assert.deepEqual(compositeQuality.performance?.warnings, ["slow route"]);
  assert.deepEqual(compositeQuality.composite?.includedDimensions, [
    "visual",
    "performance",
  ]);
  assert.deepEqual(compositeQuality.warnings, ["check route"]);
  assert.equal(confidence.contributors?.[0]?.signal, "stable-ui");
  assert.equal(confidence.screens?.[0]?.contributors[0]?.signal, "screen-match");
  assert.equal(
    confidence.screens?.[0]?.components[0]?.contributors[0]?.signal,
    "mapped",
  );
  assert.deepEqual(confidence.lowConfidenceSummary, ["review copy"]);
});

test("toPublicJob deep copies nested stage-state projections", () => {
  const job = createJob("job-public-copy");
  job.status = "completed";
  job.currentStage = "validate.project";
  job.outcome = "success";
  job.startedAt = "2026-04-20T00:00:00.000Z";
  job.finishedAt = "2026-04-20T00:05:00.000Z";
  job.request.projectName = "workspace";
  job.logs.push({
    at: "2026-04-20T00:00:00.000Z",
    level: "info",
    message: "log line",
    stage: "ir.derive",
  });
  job.pasteDeltaSummary = {
    mode: "full",
    strategy: "no_changes",
    totalNodes: 1,
    nodesReused: 1,
    nodesReprocessed: 0,
    structuralChangeRatio: 0,
    pasteIdentityKey: "paste-key",
    priorManifestMissing: false,
  };
  job.compositeQuality = {
    status: "completed",
    generatedAt: "2026-04-20T00:00:00.000Z",
    weights: {
      visual: 0.6,
      performance: 0.4,
    },
    performance: {
      sourcePath: "lighthouse.json",
      score: 92,
      sampleCount: 1,
      samples: [
        {
          profile: "mobile",
          route: "/",
          performanceScore: 91,
          fcp_ms: 100,
          lcp_ms: 200,
          cls: 0.01,
          tbt_ms: 10,
          speed_index_ms: 120,
        },
      ],
      aggregateMetrics: {
        fcp_ms: 100,
        lcp_ms: 200,
        cls: 0.01,
        tbt_ms: 10,
        speed_index_ms: 120,
      },
      warnings: ["slow route"],
    },
    composite: {
      score: 90,
      includedDimensions: ["visual", "performance"],
      explanation: "balanced",
    },
    warnings: ["check route"],
  };
  job.confidence = {
    status: "completed",
    generatedAt: "2026-04-20T00:00:00.000Z",
    level: "high",
    score: 98,
    contributors: [
      {
        signal: "stable-ui",
        impact: "positive",
        weight: 1,
        value: 1,
        detail: "matched",
      },
    ],
    screens: [
      {
        screenId: "screen-1",
        screenName: "Screen 1",
        level: "high",
        score: 99,
        contributors: [
          {
            signal: "screen-match",
            impact: "positive",
            weight: 1,
            value: 1,
            detail: "matched",
          },
        ],
        components: [
          {
            componentId: "component-1",
            componentName: "Button",
            level: "high",
            score: 97,
            contributors: [
              {
                signal: "mapped",
                impact: "positive",
                weight: 1,
                value: 1,
                detail: "mapped",
              },
            ],
          },
        ],
      },
    ],
    lowConfidenceSummary: ["review copy"],
  };
  job.inspector = {
    pipelineId: "rocket",
    stages: [
      {
        stage: "ir.derive",
        status: "completed",
        retryTargets: [
          {
            kind: "stage",
            stage: "ir.derive",
            targetId: "retry-1",
          },
        ],
      },
    ],
    retryableStages: ["ir.derive"],
    retryTargets: [
      {
        kind: "stage",
        stage: "ir.derive",
        targetId: "retry-2",
      },
    ],
  };
  job.error = {
    code: "E_TEST",
    stage: "ir.derive",
    message: "boom",
    retryTargets: [
      {
        kind: "stage",
        stage: "ir.derive",
        targetId: "retry-3",
      },
    ],
  };

  const publicJob = toPublicJob(job);
  assert.equal(publicJob.pipelineId, "rocket");
  assert.deepEqual(publicJob.pipelineMetadata, PIPELINE_METADATA);
  assert.equal(publicJob.request.pipelineId, "rocket");
  assert.deepEqual(publicJob.request.pipelineMetadata, PIPELINE_METADATA);
  assert.equal(publicJob.inspector?.pipelineId, "rocket");
  assert.deepEqual(publicJob.inspector?.pipelineMetadata, PIPELINE_METADATA);
  publicJob.stages[0]!.message = "changed";
  publicJob.logs[0]!.message = "changed";
  publicJob.pasteDeltaSummary!.mode = "delta";
  publicJob.compositeQuality!.performance!.samples[0]!.route = "/changed";
  publicJob.compositeQuality!.composite!.includedDimensions.push("visual");
  publicJob.confidence!.contributors![0]!.signal = "changed";
  publicJob.confidence!.screens![0]!.components[0]!.contributors[0]!.signal =
    "changed";
  publicJob.inspector!.retryTargets![0]!.targetId = "changed";
  publicJob.inspector!.stages[0]!.retryTargets![0]!.targetId = "changed";
  publicJob.inspector!.pipelineMetadata.templateBundleId = "changed";
  publicJob.error!.retryTargets![0]!.targetId = "changed";

  assert.equal(job.request.pipelineMetadata, undefined);
  assert.equal(job.inspector?.pipelineMetadata, undefined);
  assert.equal(job.stages[0]?.message, undefined);
  assert.equal(job.logs[0]?.message, "log line");
  assert.equal(job.pasteDeltaSummary?.mode, "full");
  assert.equal(job.compositeQuality?.performance?.samples[0]?.route, "/");
  assert.deepEqual(job.compositeQuality?.composite?.includedDimensions, [
    "visual",
    "performance",
  ]);
  assert.equal(job.confidence?.contributors?.[0]?.signal, "stable-ui");
  assert.equal(
    job.confidence?.screens?.[0]?.components[0]?.contributors[0]?.signal,
    "mapped",
  );
  assert.equal(job.inspector?.retryTargets?.[0]?.targetId, "retry-2");
  assert.equal(job.inspector?.stages[0]?.retryTargets?.[0]?.targetId, "retry-1");
  assert.equal(job.error?.retryTargets?.[0]?.targetId, "retry-3");
});
