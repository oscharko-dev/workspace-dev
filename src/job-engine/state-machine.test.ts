import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import fc from "fast-check";
import type { WorkspaceJobRetryStage, WorkspaceJobStageName } from "../contracts/index.js";
import {
  createJobEngine as createJobEngineBase,
  resolveRuntimeSettings,
} from "../job-engine.js";
import { ensureTemplateValidationSeedNodeModules } from "./test-validation-seed.js";

const RETRY_STAGE_ORDER: WorkspaceJobRetryStage[] = [
  "figma.source",
  "ir.derive",
  "template.prepare",
  "codegen.generate",
];

const RETRY_STAGE_RANK = new Map(
  RETRY_STAGE_ORDER.map((stage, index) => [stage, index]),
);

const waitForTerminalStatus = async ({
  getStatus,
  jobId,
  timeoutMs = 120_000,
}: {
  getStatus: (
    jobId: string,
  ) => ReturnType<ReturnType<typeof createJobEngineBase>["getJob"]>;
  jobId: string;
  timeoutMs?: number;
}) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = getStatus(jobId);
    if (
      status &&
      (status.status === "completed" ||
        status.status === "partial" ||
        status.status === "failed" ||
        status.status === "canceled")
    ) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for job ${jobId} to reach a terminal state.`,
  );
};

const waitForStatus = async ({
  getStatus,
  jobId,
  expectedStatus,
  timeoutMs = 15_000,
}: {
  getStatus: (
    jobId: string,
  ) => ReturnType<ReturnType<typeof createJobEngineBase>["getJob"]>;
  jobId: string;
  expectedStatus: "queued" | "running";
  timeoutMs?: number;
}) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = getStatus(jobId);
    if (status?.status === expectedStatus) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for job ${jobId} status '${expectedStatus}'.`,
  );
};

const createLocalFigmaPayload = () => ({
  name: "Lifecycle Board",
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
            name: "Lifecycle Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
            children: [
              {
                id: "title-1",
                type: "TEXT",
                characters: "Lifecycle Heading",
                absoluteBoundingBox: { x: 24, y: 24, width: 240, height: 24 },
              },
            ],
          },
        ],
      },
    ],
  },
});

const createPartialFigmaPayload = () => {
  const payload = createLocalFigmaPayload();
  payload.document.children[0]!.children[0]!.children.push({
    id: "unsupported-instance",
    type: "INSTANCE",
    name: "<UnsupportedWidget>",
    absoluteBoundingBox: { x: 24, y: 60, width: 80, height: 80 },
    children: [],
  });
  return payload;
};

const createLowFidelityFigmaPayload = () => ({
  name: "Low Fidelity Board",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-recovery",
            type: "FRAME",
            name: "Recovery Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1200 },
            children: [
              ...Array.from({ length: 12 }, (_, index) => ({
                id: `instance-${index + 1}`,
                type: "INSTANCE",
                name: index % 2 === 0 ? "<Card>" : "<Button>",
                absoluteBoundingBox: {
                  x: (index % 3) * 220,
                  y: Math.floor(index / 3) * 120,
                  width: 200,
                  height: 96,
                },
                children: [],
              })),
              {
                id: "vector-logo",
                type: "VECTOR",
                name: "Logo",
                absoluteBoundingBox: { x: 24, y: 24, width: 24, height: 24 },
              },
              {
                id: "title",
                type: "TEXT",
                name: "Heading",
                characters: "Finanzierungsplaner",
                absoluteBoundingBox: { x: 24, y: 200, width: 240, height: 24 },
              },
            ],
          },
        ],
      },
    ],
  },
});

const createFastJobEngine = ({
  tempRoot,
  maxConcurrentJobs = 2,
  maxQueuedJobs = 4,
  fetchImpl,
  skipInstall = false,
}: {
  tempRoot: string;
  maxConcurrentJobs?: number;
  maxQueuedJobs?: number;
  fetchImpl?: typeof fetch;
  skipInstall?: boolean;
}) =>
  createJobEngineBase({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros"),
      workspaceRoot: tempRoot,
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enablePerfValidation: false,
      enableUiValidation: false,
      enableUnitTestValidation: false,
      skipInstall,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1_000,
      maxConcurrentJobs,
      maxQueuedJobs,
      ...(fetchImpl ? { fetchImpl } : {}),
    }),
  });

const isRetryStageBefore = ({
  candidate,
  retryStage,
}: {
  candidate: WorkspaceJobRetryStage;
  retryStage: WorkspaceJobRetryStage;
}): boolean =>
  (RETRY_STAGE_RANK.get(candidate) ?? 0) < (RETRY_STAGE_RANK.get(retryStage) ?? 0);

const submitRetryablePartialSource = async ({
  engine,
  figmaJsonPath,
}: {
  engine: ReturnType<typeof createJobEngineBase>;
  figmaJsonPath: string;
}) => {
  const accepted = engine.submitJob({
    figmaSourceMode: "local_json",
    figmaJsonPath,
    storybookStaticDir: "storybook-static/build",
  });
  const status = await waitForTerminalStatus({
    getStatus: engine.getJob,
    jobId: accepted.jobId,
  });
  assert.equal(status.status, "partial");
  assert.ok(status.error?.stage);
  assert.ok(RETRY_STAGE_RANK.has(status.error.stage as WorkspaceJobRetryStage));
  return { accepted, status };
};

test.before(async () => {
  await ensureTemplateValidationSeedNodeModules();
});

test("state-machine: low-fidelity diagnostics stay verbatim and detached in public projections", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-state-machine-low-fidelity-"),
  );

  try {
    const engine = createFastJobEngine({
      tempRoot,
      fetchImpl: async () =>
        new Response(JSON.stringify(createLowFidelityFigmaPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const accepted = engine.submitJob({
      figmaSourceMode: "rest",
      figmaFileKey: "abc",
      figmaAccessToken: "token",
    });

    const publicJob = await waitForTerminalStatus({
      getStatus: engine.getJob,
      jobId: accepted.jobId,
    });
    const result = engine.getJobResult(accepted.jobId);

    assert.equal(publicJob.status, "failed");
    assert.equal(publicJob.error?.code, "E_FIGMA_LOW_FIDELITY_SOURCE");
    assert.equal(publicJob.error?.stage, "figma.source");
    assert.deepEqual(result?.error?.diagnostics, publicJob.error?.diagnostics);

    const originalDiagnostic = structuredClone(
      publicJob.error?.diagnostics?.[0],
    );
    assert.ok(originalDiagnostic);
    assert.equal(originalDiagnostic.code, "E_FIGMA_LOW_FIDELITY_SOURCE");

    if (publicJob.error?.diagnostics?.[0]) {
      publicJob.error.diagnostics[0].message = "mutated by test";
    }
    if (result?.error?.diagnostics?.[0]) {
      result.error.diagnostics[0].message = "mutated by result";
    }

    const freshProjection = engine.getJob(accepted.jobId);
    const freshResult = engine.getJobResult(accepted.jobId);
    assert.deepEqual(freshProjection?.error?.diagnostics?.[0], originalDiagnostic);
    assert.deepEqual(freshResult?.error?.diagnostics?.[0], originalDiagnostic);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("state-machine: queued regeneration cancel keeps lineage and source immutability", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-state-machine-regen-cancel-"),
  );
  const figmaJsonPath = path.join(tempRoot, "source.json");

  try {
    await writeFile(
      figmaJsonPath,
      JSON.stringify(createLocalFigmaPayload()),
      "utf8",
    );

    const engine = createFastJobEngine({
      tempRoot,
      maxConcurrentJobs: 1,
      skipInstall: false,
      fetchImpl: async (_resource, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    });

    const sourceAccepted = engine.submitJob({
      figmaSourceMode: "local_json",
      figmaJsonPath,
    });
    const sourceStatus = await waitForTerminalStatus({
      getStatus: engine.getJob,
      jobId: sourceAccepted.jobId,
    });
    assert.equal(sourceStatus.status, "completed");

    const blocker = engine.submitJob({
      figmaSourceMode: "rest",
      figmaFileKey: "blocker",
      figmaAccessToken: "token",
    });
    await waitForStatus({
      getStatus: engine.getJob,
      jobId: blocker.jobId,
      expectedStatus: "running",
    });

    const regeneration = engine.submitRegeneration({
      sourceJobId: sourceAccepted.jobId,
      overrides: [{ nodeId: "title-1", field: "fontSize", value: 30 }],
      draftId: "draft-1717",
      baseFingerprint: "fnv1a64:issue1717",
    });
    await waitForStatus({
      getStatus: engine.getJob,
      jobId: regeneration.jobId,
      expectedStatus: "queued",
    });

    const canceled = engine.cancelJob({
      jobId: regeneration.jobId,
      reason: "operator canceled queued regeneration",
    });

    assert.equal(canceled?.status, "canceled");
    assert.equal(canceled?.lineage?.kind, "regeneration");
    assert.equal(canceled?.lineage?.sourceJobId, sourceAccepted.jobId);
    assert.equal(canceled?.lineage?.overrideCount, 1);
    assert.equal(canceled?.cancellation?.reason, "operator canceled queued regeneration");
    assert.equal(canceled?.currentStage, undefined);
    assert.equal(
      canceled?.stages.every((stage) => stage.status === "skipped"),
      true,
    );

    const sourceAfter = engine.getJob(sourceAccepted.jobId);
    assert.equal(sourceAfter?.status, "completed");
    assert.equal(sourceAfter?.lineage, undefined);

    engine.cancelJob({ jobId: blocker.jobId, reason: "cleanup" });
    await waitForTerminalStatus({
      getStatus: engine.getJob,
      jobId: blocker.jobId,
      timeoutMs: 20_000,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("state-machine: queued retry cancel retains retry lineage and detached retryTargets", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-state-machine-retry-cancel-"),
  );
  const figmaJsonPath = path.join(tempRoot, "partial.json");

  try {
    await writeFile(
      figmaJsonPath,
      JSON.stringify(createPartialFigmaPayload()),
      "utf8",
    );

    const engine = createFastJobEngine({
      tempRoot,
      maxConcurrentJobs: 1,
      skipInstall: false,
      fetchImpl: async (_resource, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    });

    const { accepted: partialAccepted, status: partialStatus } =
      await submitRetryablePartialSource({
        engine,
        figmaJsonPath,
      });

    const blocker = engine.submitJob({
      figmaSourceMode: "rest",
      figmaFileKey: "blocker",
      figmaAccessToken: "token",
    });
    await waitForStatus({
      getStatus: engine.getJob,
      jobId: blocker.jobId,
      expectedStatus: "running",
    });

    const retryAccepted = engine.submitRetry({
      sourceJobId: partialAccepted.jobId,
      retryStage: "codegen.generate",
      retryTargets: ["src/generated/App.tsx"],
    });
    await waitForStatus({
      getStatus: engine.getJob,
      jobId: retryAccepted.jobId,
      expectedStatus: "queued",
    });

    const canceled = engine.cancelJob({
      jobId: retryAccepted.jobId,
      reason: "operator canceled queued retry",
    });

    assert.equal(canceled?.status, "canceled");
    assert.equal(canceled?.lineage?.kind, "retry");
    assert.equal(canceled?.lineage?.sourceJobId, partialAccepted.jobId);
    assert.equal(canceled?.lineage?.retryStage, "codegen.generate");
    assert.deepEqual(canceled?.lineage?.retryTargets, [
      "src/generated/App.tsx",
    ]);

    if (canceled?.lineage?.retryTargets) {
      canceled.lineage.retryTargets[0] = "mutated-by-test";
    }

    const freshProjection = engine.getJob(retryAccepted.jobId);
    assert.deepEqual(freshProjection?.lineage?.retryTargets, [
      "src/generated/App.tsx",
    ]);

    const sourceAfter = engine.getJob(partialAccepted.jobId);
    assert.equal(sourceAfter?.status, "partial");
    assert.equal(sourceAfter?.lineage, undefined);

    engine.cancelJob({ jobId: blocker.jobId, reason: "cleanup" });
    await waitForTerminalStatus({
      getStatus: engine.getJob,
      jobId: blocker.jobId,
      timeoutMs: 20_000,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("state-machine: retry from a partial source reuses prior stages without mutating the source", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-state-machine-partial-retry-"),
  );
  const figmaJsonPath = path.join(tempRoot, "partial.json");

  try {
    await writeFile(
      figmaJsonPath,
      JSON.stringify(createPartialFigmaPayload()),
      "utf8",
    );

    const engine = createFastJobEngine({ tempRoot, skipInstall: false });
    const { accepted: sourceAccepted, status: sourceStatus } =
      await submitRetryablePartialSource({
        engine,
        figmaJsonPath,
      });

    const retryStage = sourceStatus.error?.stage as
      | WorkspaceJobRetryStage
      | undefined;
    assert.ok(retryStage);

    const retryAccepted = engine.submitRetry({
      sourceJobId: sourceAccepted.jobId,
      retryStage,
    });
    const retryStatus = await waitForTerminalStatus({
      getStatus: engine.getJob,
      jobId: retryAccepted.jobId,
    });

    assert.equal(retryStatus.lineage?.kind, "retry");
    assert.equal(retryStatus.lineage?.sourceJobId, sourceAccepted.jobId);
    assert.equal(retryStatus.lineage?.retryStage, retryStage);

    for (const stage of RETRY_STAGE_ORDER) {
      if (!isRetryStageBefore({ candidate: stage, retryStage })) {
        continue;
      }
      const projection = retryStatus.stages.find((entry) => entry.name === stage);
      assert.equal(
        projection?.status,
        "skipped",
        `expected retry to reuse stage '${stage}' before '${retryStage}'`,
      );
      assert.match(
        projection?.message ?? "",
        /Reusing persisted artifacts from retry source/,
      );
    }

    const sourceAfter = engine.getJob(sourceAccepted.jobId);
    assert.equal(sourceAfter?.status, "partial");
    assert.equal(sourceAfter?.lineage, undefined);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

type ModelTerminalStatus = "completed" | "partial" | "failed" | "canceled";

interface ModelJob {
  kind: "retry" | "regeneration";
  status: ModelTerminalStatus;
  sourceStatus: "completed" | "partial" | "failed";
  cancellationReason?: string;
  retryStage?: WorkspaceJobRetryStage;
  retryTargets?: string[];
}

interface ModelState {
  jobs: ModelJob[];
}

const applyLifecycleOperation = (
  state: ModelState,
  operation:
    | "cancel_queued_retry"
    | "cancel_running_regeneration"
    | "retry_failed"
    | "retry_partial"
    | "regenerate_completed",
): ModelState => {
  switch (operation) {
    case "cancel_queued_retry":
      return {
        jobs: [
          ...state.jobs,
          {
            kind: "retry",
            status: "canceled",
            sourceStatus: "failed",
            cancellationReason: "queued retry canceled",
            retryStage: "codegen.generate",
            retryTargets: ["src/generated/App.tsx"],
          },
        ],
      };
    case "cancel_running_regeneration":
      return {
        jobs: [
          ...state.jobs,
          {
            kind: "regeneration",
            status: "canceled",
            sourceStatus: "completed",
            cancellationReason: "running regeneration canceled",
          },
        ],
      };
    case "retry_failed":
      return {
        jobs: [
          ...state.jobs,
          {
            kind: "retry",
            status: "failed",
            sourceStatus: "failed",
            retryStage: "figma.source",
          },
        ],
      };
    case "retry_partial":
      return {
        jobs: [
          ...state.jobs,
          {
            kind: "retry",
            status: "partial",
            sourceStatus: "partial",
            retryStage: "template.prepare",
          },
        ],
      };
    case "regenerate_completed":
      return {
        jobs: [
          ...state.jobs,
          {
            kind: "regeneration",
            status: "completed",
            sourceStatus: "completed",
          },
        ],
      };
  }
};

const assertLifecycleInvariants = (state: ModelState): void => {
  for (const job of state.jobs) {
    assert.ok(
      ["completed", "partial", "failed", "canceled"].includes(job.status),
    );
    if (job.kind === "regeneration") {
      assert.equal(job.sourceStatus, "completed");
      assert.equal(job.retryStage, undefined);
    }
    if (job.kind === "retry") {
      assert.ok(
        job.sourceStatus === "failed" || job.sourceStatus === "partial",
      );
      if (job.retryTargets) {
        assert.equal(job.retryStage, "codegen.generate");
      }
    }
    if (job.status === "canceled") {
      assert.equal(typeof job.cancellationReason, "string");
      assert.ok(job.cancellationReason.length > 0);
    }
  }
};

test("state-machine: random cancel/retry/regenerate sequences satisfy the documented invariants", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.constantFrom(
          "cancel_queued_retry",
          "cancel_running_regeneration",
          "retry_failed",
          "retry_partial",
          "regenerate_completed",
        ),
        { minLength: 1, maxLength: 20 },
      ),
      (operations) => {
        let state: ModelState = { jobs: [] };
        for (const operation of operations) {
          state = applyLifecycleOperation(state, operation);
          assertLifecycleInvariants(state);
        }
        assertLifecycleInvariants(state);
      },
    ),
    {
      numRuns: 100,
    },
  );
});
