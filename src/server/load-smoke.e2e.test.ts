import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  cleanupWorkspace,
  createBddWorkspaceServer,
  createNeverEndingCancelableFetch,
  createTempWorkspaceLayout,
  writeLocalFigmaPayload,
} from "../bdd/harness.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ARTIFACT_DIR = path.join(
  PACKAGE_ROOT,
  "artifacts",
  "testing",
  "load-smoke",
);

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

interface QueueSnapshot {
  runningCount?: number;
  queuedCount?: number;
  maxConcurrentJobs?: number;
  maxQueuedJobs?: number;
  position?: number;
}

interface ScenarioSummary {
  scenario: string;
  acceptedJobs: number;
  queuedJobsObserved: number;
  backpressure: {
    submit: number;
    regenerate: number;
  };
  observedQueuePositions: number[];
  observations: Array<Record<string, unknown>>;
}

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const requestJson = async ({
  baseUrl,
  path: requestPath,
  method,
  body,
}: {
  baseUrl: string;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
}): Promise<JsonResponse> => {
  const response = await fetch(new URL(requestPath, baseUrl), {
    method,
    headers: {
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
};

const waitForJobStatus = async ({
  baseUrl,
  jobId,
  acceptedStatuses,
  timeoutMs = 20_000,
}: {
  baseUrl: string;
  jobId: string;
  acceptedStatuses: readonly string[];
  timeoutMs?: number;
}): Promise<Record<string, unknown>> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await requestJson({
      baseUrl,
      path: `/workspace/jobs/${jobId}`,
      method: "GET",
    });
    const status = String(response.body.status);
    if (acceptedStatuses.includes(status)) {
      return response.body;
    }
    await sleep(120);
  }

  throw new Error(
    `Timed out waiting for job ${jobId} to reach one of [${acceptedStatuses.join(", ")}].`,
  );
};

const extractQueueSnapshot = (
  jobBody: Record<string, unknown>,
): QueueSnapshot => {
  const queue = jobBody.queue;
  return typeof queue === "object" && queue !== null
    ? (queue as QueueSnapshot)
    : {};
};

const cancelAndWaitForCanceled = async ({
  baseUrl,
  jobId,
}: {
  baseUrl: string;
  jobId: string;
}): Promise<void> => {
  const cancelResponse = await requestJson({
    baseUrl,
    path: `/workspace/jobs/${jobId}/cancel`,
    method: "POST",
    body: { reason: "load-smoke cleanup" },
  });
  assert.equal(cancelResponse.status, 202);
  const canceled = await waitForJobStatus({
    baseUrl,
    jobId,
    acceptedStatuses: ["canceled"],
  });
  assert.equal(canceled.status, "canceled");
};

const writeScenarioArtifact = async ({
  fileName,
  summary,
}: {
  fileName: string;
  summary: ScenarioSummary;
}): Promise<void> => {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(
    path.join(ARTIFACT_DIR, fileName),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
};

test("runtime load smoke covers submit queue saturation over real HTTP routes", async () => {
  const observations: Array<Record<string, unknown>> = [];
  const layout = await createTempWorkspaceLayout();
  let server: Awaited<ReturnType<typeof createBddWorkspaceServer>> | undefined;
  const acceptedJobIds: string[] = [];
  const summary: ScenarioSummary = {
    scenario: "submit-backpressure",
    acceptedJobs: 0,
    queuedJobsObserved: 0,
    backpressure: {
      submit: 0,
      regenerate: 0,
    },
    observedQueuePositions: [],
    observations,
  };
  let failureMessage: string | undefined;

  try {
    server = await createBddWorkspaceServer({
      workDir: layout.workspaceRoot,
      outputRoot: layout.outputRoot,
      maxConcurrentJobs: 1,
      maxQueuedJobs: 1,
      rateLimitPerMinute: 0,
      shutdownTimeoutMs: 1_000,
      fetchImpl: createNeverEndingCancelableFetch(),
    });

    const firstSubmit = await requestJson({
      baseUrl: server.url,
      path: "/workspace/submit",
      method: "POST",
      body: {
        figmaFileKey: "load-submit-running",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });
    assert.equal(firstSubmit.status, 202);
    const firstJobId = String(firstSubmit.body.jobId);
    acceptedJobIds.push(firstJobId);
    observations.push({
      step: "first-submit",
      statusCode: firstSubmit.status,
      jobId: firstJobId,
      bodyStatus: firstSubmit.body.status,
    });

    const runningJob = await waitForJobStatus({
      baseUrl: server.url,
      jobId: firstJobId,
      acceptedStatuses: ["running"],
    });
    assert.equal(runningJob.status, "running");

    const [secondSubmit, thirdSubmit] = await Promise.all([
      requestJson({
        baseUrl: server.url,
        path: "/workspace/submit",
        method: "POST",
        body: {
          figmaFileKey: "load-submit-queued",
          figmaAccessToken: "figd_xxx",
          figmaSourceMode: "rest",
          llmCodegenMode: "deterministic",
        },
      }),
      requestJson({
        baseUrl: server.url,
        path: "/workspace/submit",
        method: "POST",
        body: {
          figmaFileKey: "load-submit-overflow",
          figmaAccessToken: "figd_xxx",
          figmaSourceMode: "rest",
          llmCodegenMode: "deterministic",
        },
      }),
    ]);

    observations.push({
      step: "second-submit",
      statusCode: secondSubmit.status,
      jobId: secondSubmit.body.jobId,
      bodyStatus: secondSubmit.body.status,
      error: secondSubmit.body.error,
    });
    observations.push({
      step: "third-submit",
      statusCode: thirdSubmit.status,
      jobId: thirdSubmit.body.jobId,
      bodyStatus: thirdSubmit.body.status,
      error: thirdSubmit.body.error,
    });

    const responses = [secondSubmit, thirdSubmit];
    const acceptedResponses = responses.filter(
      (response) => response.status === 202,
    );
    const backpressureResponses = responses.filter(
      (response) => response.status === 429,
    );

    assert.equal(acceptedResponses.length, 1);
    assert.equal(backpressureResponses.length, 1);
    assert.equal(backpressureResponses[0]?.body.error, "QUEUE_BACKPRESSURE");

    const queuedJobId = String(acceptedResponses[0]?.body.jobId);
    acceptedJobIds.push(queuedJobId);
    const queuedJob = await waitForJobStatus({
      baseUrl: server.url,
      jobId: queuedJobId,
      acceptedStatuses: ["queued"],
    });
    assert.equal(queuedJob.status, "queued");

    const queuedQueue = extractQueueSnapshot(queuedJob);
    assert.equal(queuedQueue.runningCount, 1);
    assert.equal(queuedQueue.queuedCount, 1);
    assert.equal(queuedQueue.maxConcurrentJobs, 1);
    assert.equal(queuedQueue.maxQueuedJobs, 1);
    assert.equal(queuedQueue.position, 1);

    summary.acceptedJobs = acceptedJobIds.length;
    summary.queuedJobsObserved = 1;
    summary.backpressure.submit = 1;
    summary.observedQueuePositions = [1];

    await Promise.all(
      acceptedJobIds.map(async (jobId) => {
        await cancelAndWaitForCanceled({ baseUrl: server.url, jobId });
      }),
    );
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (summary.acceptedJobs === 0) {
      summary.acceptedJobs = acceptedJobIds.length;
    }
    if (failureMessage !== undefined) {
      observations.push({
        step: "failure",
        message: failureMessage,
      });
    }
    await writeScenarioArtifact({
      fileName: "submit-backpressure.json",
      summary,
    });
    if (server !== undefined) {
      await server.app.close();
    }
    await cleanupWorkspace(layout.root);
  }
});

test("runtime load smoke covers mixed submit and regenerate queue saturation over real HTTP routes", async () => {
  const observations: Array<Record<string, unknown>> = [];
  const layout = await createTempWorkspaceLayout();
  const sourceFigmaJsonPath = await writeLocalFigmaPayload({
    workspaceRoot: layout.workspaceRoot,
    fileName: "load-source.json",
  });
  let server: Awaited<ReturnType<typeof createBddWorkspaceServer>> | undefined;
  const acceptedJobIds: string[] = [];
  const summary: ScenarioSummary = {
    scenario: "mixed-submit-regenerate-backpressure",
    acceptedJobs: 0,
    queuedJobsObserved: 0,
    backpressure: {
      submit: 0,
      regenerate: 0,
    },
    observedQueuePositions: [],
    observations,
  };
  let failureMessage: string | undefined;

  try {
    server = await createBddWorkspaceServer({
      workDir: layout.workspaceRoot,
      outputRoot: layout.outputRoot,
      maxConcurrentJobs: 1,
      maxQueuedJobs: 2,
      rateLimitPerMinute: 0,
      shutdownTimeoutMs: 1_000,
      fetchImpl: createNeverEndingCancelableFetch(),
    });

    const sourceSubmit = await requestJson({
      baseUrl: server.url,
      path: "/workspace/submit",
      method: "POST",
      body: {
        figmaSourceMode: "local_json",
        figmaJsonPath: sourceFigmaJsonPath,
        llmCodegenMode: "deterministic",
      },
    });
    assert.equal(sourceSubmit.status, 202);
    const sourceJobId = String(sourceSubmit.body.jobId);
    observations.push({
      step: "source-submit",
      statusCode: sourceSubmit.status,
      jobId: sourceJobId,
      bodyStatus: sourceSubmit.body.status,
    });

    const sourceCompleted = await waitForJobStatus({
      baseUrl: server.url,
      jobId: sourceJobId,
      acceptedStatuses: ["completed"],
      timeoutMs: 1_800_000,
    });
    assert.equal(sourceCompleted.status, "completed");

    const activeSubmit = await requestJson({
      baseUrl: server.url,
      path: "/workspace/submit",
      method: "POST",
      body: {
        figmaFileKey: "load-mixed-running",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });
    assert.equal(activeSubmit.status, 202);
    const activeJobId = String(activeSubmit.body.jobId);
    acceptedJobIds.push(activeJobId);
    observations.push({
      step: "active-submit",
      statusCode: activeSubmit.status,
      jobId: activeJobId,
      bodyStatus: activeSubmit.body.status,
    });

    const activeRunning = await waitForJobStatus({
      baseUrl: server.url,
      jobId: activeJobId,
      acceptedStatuses: ["running"],
    });
    assert.equal(activeRunning.status, "running");

    const [queuedSubmit, queuedRegenerate] = await Promise.all([
      requestJson({
        baseUrl: server.url,
        path: "/workspace/submit",
        method: "POST",
        body: {
          figmaFileKey: "load-mixed-queued-submit",
          figmaAccessToken: "figd_xxx",
          figmaSourceMode: "rest",
          llmCodegenMode: "deterministic",
        },
      }),
      requestJson({
        baseUrl: server.url,
        path: `/workspace/jobs/${sourceJobId}/regenerate`,
        method: "POST",
        body: {
          overrides: [{ nodeId: "3:2", field: "width", value: 480 }],
        },
      }),
    ]);

    assert.equal(queuedSubmit.status, 202);
    assert.equal(queuedRegenerate.status, 202);
    assert.equal(queuedSubmit.body.status, "queued");
    assert.equal(queuedRegenerate.body.status, "queued");
    assert.equal(queuedRegenerate.body.sourceJobId, sourceJobId);

    const queuedSubmitId = String(queuedSubmit.body.jobId);
    const queuedRegenerateId = String(queuedRegenerate.body.jobId);
    acceptedJobIds.push(queuedSubmitId, queuedRegenerateId);
    observations.push({
      step: "queued-submit",
      statusCode: queuedSubmit.status,
      jobId: queuedSubmitId,
      bodyStatus: queuedSubmit.body.status,
    });
    observations.push({
      step: "queued-regenerate",
      statusCode: queuedRegenerate.status,
      jobId: queuedRegenerateId,
      bodyStatus: queuedRegenerate.body.status,
      sourceJobId: queuedRegenerate.body.sourceJobId,
    });

    const queuedStatuses = await Promise.all([
      waitForJobStatus({
        baseUrl: server.url,
        jobId: queuedSubmitId,
        acceptedStatuses: ["queued"],
      }),
      waitForJobStatus({
        baseUrl: server.url,
        jobId: queuedRegenerateId,
        acceptedStatuses: ["queued"],
      }),
    ]);

    const queuePositions = queuedStatuses
      .map((status) => extractQueueSnapshot(status).position)
      .filter((position): position is number => typeof position === "number")
      .sort((left, right) => left - right);

    assert.deepEqual(queuePositions, [1, 2]);
    for (const queuedStatus of queuedStatuses) {
      const queue = extractQueueSnapshot(queuedStatus);
      assert.equal(queue.runningCount, 1);
      assert.equal(queue.queuedCount, 2);
      assert.equal(queue.maxConcurrentJobs, 1);
      assert.equal(queue.maxQueuedJobs, 2);
    }

    const [overflowSubmit, overflowRegenerate] = await Promise.all([
      requestJson({
        baseUrl: server.url,
        path: "/workspace/submit",
        method: "POST",
        body: {
          figmaFileKey: "load-mixed-overflow-submit",
          figmaAccessToken: "figd_xxx",
          figmaSourceMode: "rest",
          llmCodegenMode: "deterministic",
        },
      }),
      requestJson({
        baseUrl: server.url,
        path: `/workspace/jobs/${sourceJobId}/regenerate`,
        method: "POST",
        body: {
          overrides: [{ nodeId: "3:1", field: "width", value: 360 }],
        },
      }),
    ]);

    observations.push({
      step: "overflow-submit",
      statusCode: overflowSubmit.status,
      error: overflowSubmit.body.error,
      queue: overflowSubmit.body.queue,
    });
    observations.push({
      step: "overflow-regenerate",
      statusCode: overflowRegenerate.status,
      error: overflowRegenerate.body.error,
      queue: overflowRegenerate.body.queue,
    });

    assert.equal(overflowSubmit.status, 429);
    assert.equal(overflowRegenerate.status, 429);
    assert.equal(overflowSubmit.body.error, "QUEUE_BACKPRESSURE");
    assert.equal(overflowRegenerate.body.error, "QUEUE_BACKPRESSURE");

    const overflowQueues = [
      overflowSubmit.body.queue,
      overflowRegenerate.body.queue,
    ].filter(
      (value): value is QueueSnapshot =>
        typeof value === "object" && value !== null,
    );
    for (const overflowQueue of overflowQueues) {
      assert.equal(overflowQueue.runningCount, 1);
      assert.equal(overflowQueue.queuedCount, 2);
      assert.equal(overflowQueue.maxConcurrentJobs, 1);
      assert.equal(overflowQueue.maxQueuedJobs, 2);
    }

    summary.acceptedJobs = acceptedJobIds.length;
    summary.queuedJobsObserved = 2;
    summary.backpressure.submit = 1;
    summary.backpressure.regenerate = 1;
    summary.observedQueuePositions = queuePositions;

    await Promise.all(
      acceptedJobIds.map(async (jobId) => {
        await cancelAndWaitForCanceled({ baseUrl: server.url, jobId });
      }),
    );
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (summary.acceptedJobs === 0) {
      summary.acceptedJobs = acceptedJobIds.length;
    }
    if (failureMessage !== undefined) {
      observations.push({
        step: "failure",
        message: failureMessage,
      });
    }
    await writeScenarioArtifact({
      fileName: "mixed-submit-regenerate-backpressure.json",
      summary,
    });
    if (server !== undefined) {
      await server.app.close();
    }
    await cleanupWorkspace(layout.root);
  }
});
