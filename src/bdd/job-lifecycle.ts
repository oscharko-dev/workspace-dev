import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  cleanupWorkspace,
  createBddWorkspaceServer,
  createFakeFigmaFetch,
  createNeverEndingCancelableFetch,
  createTempWorkspaceLayout,
  submitRestJob,
  waitForJobState,
  waitForJobTerminalState,
} from "./harness.js";

export const jobLifecycleScenarioNames = [
  "Submit a valid job request",
  "Reject an invalid submit payload",
  "Treat duplicate submit requests as separate jobs",
  "Report queued and running job states",
  "Report completed and failed terminal states",
  "Cancel queued and running jobs",
  "Return the existing terminal state when canceling a completed job",
] as const;

void test("bdd contract: Submit a valid job request", async () => {
  const { root, outputRoot } = await createTempWorkspaceLayout();
  const server = await createBddWorkspaceServer({
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const submitBody = await submitRestJob({ server });
    assert.equal(submitBody.status, "queued");
    assert.equal(typeof submitBody.jobId, "string");
    const acceptedModes = submitBody.acceptedModes as Record<string, unknown>;
    assert.equal(acceptedModes.figmaSourceMode, "rest");
    assert.equal(acceptedModes.llmCodegenMode, "deterministic");

    const terminal = await waitForJobTerminalState({
      server,
      jobId: String(submitBody.jobId),
      timeoutMs: 120_000,
    });
    assert.equal(terminal.status, "completed");
  } finally {
    await server.app.close();
    await cleanupWorkspace(root);
  }
});

void test("bdd contract: Reject an invalid submit payload", async () => {
  const { root, outputRoot } = await createTempWorkspaceLayout();
  const server = await createBddWorkspaceServer({
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "VALIDATION_ERROR");
    assert.ok(Array.isArray(body.issues));
  } finally {
    await server.app.close();
    await cleanupWorkspace(root);
  }
});

void test("bdd contract: Treat duplicate submit requests as separate jobs", async () => {
  const { root, outputRoot } = await createTempWorkspaceLayout();
  const server = await createBddWorkspaceServer({
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const firstSubmit = await submitRestJob({
      server,
      figmaFileKey: "duplicate-key",
    });
    const secondSubmit = await submitRestJob({
      server,
      figmaFileKey: "duplicate-key",
    });

    assert.equal(firstSubmit.status, "queued");
    assert.equal(secondSubmit.status, "queued");
    assert.notEqual(firstSubmit.jobId, secondSubmit.jobId);

    const [firstTerminal, secondTerminal] = await Promise.all([
      waitForJobTerminalState({
        server,
        jobId: String(firstSubmit.jobId),
        timeoutMs: 120_000,
      }),
      waitForJobTerminalState({
        server,
        jobId: String(secondSubmit.jobId),
        timeoutMs: 120_000,
      }),
    ]);

    assert.equal(firstTerminal.status, "completed");
    assert.equal(secondTerminal.status, "completed");
  } finally {
    await server.app.close();
    await cleanupWorkspace(root);
  }
});

void test("bdd contract: Report queued and running job states", async () => {
  const { root, outputRoot } = await createTempWorkspaceLayout();
  const server = await createBddWorkspaceServer({
    outputRoot,
    maxConcurrentJobs: 1,
    maxQueuedJobs: 1,
    fetchImpl: createNeverEndingCancelableFetch(),
  });
  let firstJobId = "";
  let secondJobId = "";

  try {
    const firstSubmit = await submitRestJob({
      server,
      figmaFileKey: "queue-1",
    });
    const secondSubmit = await submitRestJob({
      server,
      figmaFileKey: "queue-2",
    });
    firstJobId = String(firstSubmit.jobId);
    secondJobId = String(secondSubmit.jobId);

    const runningStatus = await waitForJobState({
      server,
      jobId: firstJobId,
      acceptedStatuses: ["running"],
    });
    const queuedStatus = await waitForJobState({
      server,
      jobId: secondJobId,
      acceptedStatuses: ["queued"],
    });

    assert.equal(runningStatus.status, "running");
    assert.equal(queuedStatus.status, "queued");
  } finally {
    if (firstJobId.length > 0) {
      await server.app.inject({
        method: "POST",
        url: `/workspace/jobs/${firstJobId}/cancel`,
        headers: { "content-type": "application/json" },
        payload: { reason: "cleanup" },
      });
    }
    if (secondJobId.length > 0) {
      await server.app.inject({
        method: "POST",
        url: `/workspace/jobs/${secondJobId}/cancel`,
        headers: { "content-type": "application/json" },
        payload: { reason: "cleanup" },
      });
    }
    await server.app.close();
    await cleanupWorkspace(root);
  }
});

void test("bdd contract: Report completed and failed terminal states", async () => {
  const completedLayout = await createTempWorkspaceLayout();
  const completedServer = await createBddWorkspaceServer({
    outputRoot: completedLayout.outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const completedSubmit = await submitRestJob({
      server: completedServer,
      figmaFileKey: "terminal-complete",
    });
    const completedTerminal = await waitForJobTerminalState({
      server: completedServer,
      jobId: String(completedSubmit.jobId),
      timeoutMs: 120_000,
    });
    assert.equal(completedTerminal.status, "completed");
  } finally {
    await completedServer.app.close();
    await cleanupWorkspace(completedLayout.root);
  }

  const failedLayout = await createTempWorkspaceLayout();
  const failedServer = await createBddWorkspaceServer({
    outputRoot: failedLayout.outputRoot,
    workDir: failedLayout.workspaceRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const missingPath = path.join(
      failedLayout.workspaceRoot,
      "missing-input.json",
    );
    const submitResponse = await failedServer.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "local_json",
        figmaJsonPath: missingPath,
        llmCodegenMode: "deterministic",
      },
    });

    assert.equal(submitResponse.statusCode, 202);
    const submitBody = submitResponse.json<Record<string, unknown>>();
    const failedTerminal = await waitForJobTerminalState({
      server: failedServer,
      jobId: String(submitBody.jobId),
      timeoutMs: 120_000,
    });
    assert.equal(failedTerminal.status, "failed");
  } finally {
    await failedServer.app.close();
    await cleanupWorkspace(failedLayout.root);
  }
});

void test("bdd contract: Cancel queued and running jobs", async () => {
  const { root, outputRoot } = await createTempWorkspaceLayout();
  const server = await createBddWorkspaceServer({
    outputRoot,
    maxConcurrentJobs: 1,
    maxQueuedJobs: 2,
    fetchImpl: createNeverEndingCancelableFetch(),
  });

  try {
    const firstSubmit = await submitRestJob({
      server,
      figmaFileKey: "cancel-1",
    });
    const secondSubmit = await submitRestJob({
      server,
      figmaFileKey: "cancel-2",
    });
    const firstJobId = String(firstSubmit.jobId);
    const secondJobId = String(secondSubmit.jobId);

    await waitForJobState({
      server,
      jobId: firstJobId,
      acceptedStatuses: ["running"],
    });
    await waitForJobState({
      server,
      jobId: secondJobId,
      acceptedStatuses: ["queued"],
    });

    const queuedCancelResponse = await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${secondJobId}/cancel`,
      headers: { "content-type": "application/json" },
      payload: { reason: "User canceled queued job." },
    });
    assert.equal(queuedCancelResponse.statusCode, 202);
    assert.equal(
      queuedCancelResponse.json<Record<string, unknown>>().status,
      "canceled",
    );

    const runningCancelResponse = await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${firstJobId}/cancel`,
      headers: { "content-type": "application/json" },
      payload: { reason: "User canceled running job." },
    });
    assert.equal(runningCancelResponse.statusCode, 202);

    const [firstTerminal, secondTerminal] = await Promise.all([
      waitForJobTerminalState({ server, jobId: firstJobId }),
      waitForJobTerminalState({ server, jobId: secondJobId }),
    ]);

    assert.equal(firstTerminal.status, "canceled");
    assert.equal(secondTerminal.status, "canceled");
  } finally {
    await server.app.close();
    await cleanupWorkspace(root);
  }
});

void test("bdd contract: Return the existing terminal state when canceling a completed job", async () => {
  const { root, outputRoot } = await createTempWorkspaceLayout();
  const server = await createBddWorkspaceServer({
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const submitBody = await submitRestJob({
      server,
      figmaFileKey: "cancel-complete",
    });
    const jobId = String(submitBody.jobId);
    const terminal = await waitForJobTerminalState({
      server,
      jobId,
      timeoutMs: 120_000,
    });
    assert.equal(terminal.status, "completed");

    const cancelResponse = await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${jobId}/cancel`,
      headers: { "content-type": "application/json" },
      payload: { reason: "too late" },
    });
    assert.equal(cancelResponse.statusCode, 202);
    const cancelBody = cancelResponse.json<Record<string, unknown>>();
    assert.equal(cancelBody.status, "completed");
  } finally {
    await server.app.close();
    await cleanupWorkspace(root);
  }
});
