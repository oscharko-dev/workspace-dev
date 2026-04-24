import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  cleanupWorkspace,
  createBddWorkspaceServer,
  createNeverEndingCancelableFetch,
  createTempWorkspaceLayout,
  submitLocalJsonJob,
  submitRestJob,
  waitForJobTerminalState,
  writeLocalFigmaPayload,
} from "./harness.js";

export const advancedFlowScenarioNames = [
  "Regenerate from a completed source job with lineage",
  "Return a sync dry-run plan with a confirmation token",
  "Require approval and single-use confirmation tokens for sync apply",
  "Return queue backpressure when capacity is exhausted",
  "Return rate limiting with Retry-After",
] as const;

const createCompletedLocalJsonSource = async () => {
  const layout = await createTempWorkspaceLayout();
  const figmaJsonPath = await writeLocalFigmaPayload({
    workspaceRoot: layout.workspaceRoot,
  });
  const server = await createBddWorkspaceServer({
    workDir: layout.workspaceRoot,
    outputRoot: layout.outputRoot,
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  const submitBody = await submitLocalJsonJob({ server, figmaJsonPath });
  const sourceJobId = String(submitBody.jobId);
  const sourceTerminal = await waitForJobTerminalState({
    server,
    jobId: sourceJobId,
    timeoutMs: 120_000,
  });
  assert.equal(sourceTerminal.status, "completed");

  return { ...layout, server, sourceJobId };
};

void test("bdd contract: Regenerate from a completed source job with lineage", async () => {
  const { root, server, sourceJobId } = await createCompletedLocalJsonSource();

  try {
    const regenerateResponse = await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${sourceJobId}/regenerate`,
      headers: { "content-type": "application/json" },
      payload: {
        overrides: [
          { nodeId: "3:2", field: "width", value: 480 },
          { nodeId: "3:2", field: "cornerRadius", value: 24 },
        ],
        draftId: "bdd-draft-001",
        baseFingerprint: "fnv1a64:bddseed",
      },
    });

    assert.equal(regenerateResponse.statusCode, 202);
    const regenerateBody = regenerateResponse.json<Record<string, unknown>>();
    assert.equal(regenerateBody.status, "queued");
    assert.equal(regenerateBody.sourceJobId, sourceJobId);

    const regenerationJobId = String(regenerateBody.jobId);
    const regenerationTerminal = await waitForJobTerminalState({
      server,
      jobId: regenerationJobId,
      timeoutMs: 120_000,
    });

    assert.equal(regenerationTerminal.status, "completed");
    const lineage = regenerationTerminal.lineage as Record<string, unknown>;
    assert.equal(lineage.sourceJobId, sourceJobId);
    assert.equal(lineage.overrideCount, 2);
    assert.equal(lineage.draftId, "bdd-draft-001");
    assert.equal(lineage.baseFingerprint, "fnv1a64:bddseed");
  } finally {
    await server.app.close();
    await cleanupWorkspace(root);
  }
});

void test("bdd contract: Return a sync dry-run plan with a confirmation token", async () => {
  const { root, server, sourceJobId } = await createCompletedLocalJsonSource();

  try {
    const regenerateResponse = await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${sourceJobId}/regenerate`,
      headers: { "content-type": "application/json" },
      payload: {
        overrides: [{ nodeId: "3:2", field: "width", value: 420 }],
      },
    });
    assert.equal(regenerateResponse.statusCode, 202);

    const regenerationJobId = String(
      regenerateResponse.json<Record<string, unknown>>().jobId,
    );
    const regenerationTerminal = await waitForJobTerminalState({
      server,
      jobId: regenerationJobId,
      timeoutMs: 120_000,
    });
    assert.equal(regenerationTerminal.status, "completed");

    const dryRunResponse = await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${regenerationJobId}/sync`,
      headers: { "content-type": "application/json" },
      payload: {
        mode: "dry_run",
        targetPath: "sync-preview",
      },
    });

    assert.equal(dryRunResponse.statusCode, 200);
    const dryRunBody = dryRunResponse.json<Record<string, unknown>>();
    assert.equal(dryRunBody.jobId, regenerationJobId);
    assert.equal(dryRunBody.sourceJobId, sourceJobId);
    assert.equal(dryRunBody.targetPath, "sync-preview");
    assert.equal(typeof dryRunBody.confirmationToken, "string");
    assert.ok(String(dryRunBody.confirmationToken).length > 0);

    const files = dryRunBody.files as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(files));
    assert.ok(files.length > 0);
    assert.equal(typeof dryRunBody.destinationRoot, "string");
  } finally {
    await server.app.close();
    await cleanupWorkspace(root);
  }
});

void test("bdd contract: Require approval and single-use confirmation tokens for sync apply", async () => {
  const { root, server, sourceJobId } = await createCompletedLocalJsonSource();

  try {
    const regenerateResponse = await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${sourceJobId}/regenerate`,
      headers: { "content-type": "application/json" },
      payload: {
        overrides: [{ nodeId: "3:2", field: "width", value: 430 }],
      },
    });
    assert.equal(regenerateResponse.statusCode, 202);

    const regenerationJobId = String(
      regenerateResponse.json<Record<string, unknown>>().jobId,
    );
    const regenerationTerminal = await waitForJobTerminalState({
      server,
      jobId: regenerationJobId,
      timeoutMs: 120_000,
    });
    assert.equal(regenerationTerminal.status, "completed");

    const dryRunResponse = await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${regenerationJobId}/sync`,
      headers: { "content-type": "application/json" },
      payload: {
        mode: "dry_run",
        targetPath: "sync-apply",
      },
    });
    assert.equal(dryRunResponse.statusCode, 200);
    const dryRunBody = dryRunResponse.json<Record<string, unknown>>();
    const confirmationToken = String(dryRunBody.confirmationToken);
    const files = dryRunBody.files as Array<Record<string, unknown>>;

    const missingTokenResponse = await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${regenerationJobId}/sync`,
      headers: { "content-type": "application/json" },
      payload: {
        mode: "apply",
        confirmOverwrite: true,
        fileDecisions: files.map((entry) => ({
          path: entry.path,
          decision: entry.decision,
        })),
      },
    });
    assert.equal(missingTokenResponse.statusCode, 400);
    assert.equal(
      missingTokenResponse.json<Record<string, unknown>>().error,
      "VALIDATION_ERROR",
    );

    const blockedApplyResponse = await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${regenerationJobId}/sync`,
      headers: { "content-type": "application/json" },
      payload: {
        mode: "apply",
        confirmationToken,
        confirmOverwrite: true,
        reviewerNote: "Approve during BDD sync apply.",
        fileDecisions: files.map((entry) => ({
          path: entry.path,
          decision: entry.decision,
        })),
      },
    });
    assert.equal(blockedApplyResponse.statusCode, 409);
    assert.equal(
      blockedApplyResponse.json<Record<string, unknown>>().error,
      "SYNC_IMPORT_REVIEW_REQUIRED",
    );

    const importSessionsResponse = await server.app.inject({
      method: "GET",
      url: "/workspace/import-sessions",
    });
    assert.equal(importSessionsResponse.statusCode, 200);
    const importSessions = (importSessionsResponse.json<
      Record<string, unknown>
    >().sessions ?? []) as Array<Record<string, unknown>>;
    const sourceImportSession = importSessions.find(
      (session) => session.jobId === sourceJobId,
    );
    assert.ok(sourceImportSession);

    const approveResponse = await server.app.inject({
      method: "POST",
      url: `/workspace/import-sessions/${String(sourceImportSession.id)}/approve`,
      headers: {
        authorization: `Bearer ${TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN}`,
        "content-type": "application/json",
      },
      payload: {},
    });
    assert.equal(approveResponse.statusCode, 200);
    assert.equal(
      approveResponse.json<Record<string, unknown>>().kind,
      "approved",
    );

    const applyResponse = await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${regenerationJobId}/sync`,
      headers: { "content-type": "application/json" },
      payload: {
        mode: "apply",
        confirmationToken,
        confirmOverwrite: true,
        reviewerNote: "Approve during BDD sync apply.",
        fileDecisions: files.map((entry) => ({
          path: entry.path,
          decision: entry.decision,
        })),
      },
    });
    assert.equal(applyResponse.statusCode, 200);
    const applyBody = applyResponse.json<Record<string, unknown>>();
    const firstFile = files[0];
    const writtenFilePath = path.join(
      String(dryRunBody.destinationRoot),
      ...(typeof firstFile?.path === "string" ? firstFile.path : "").split("/"),
    );
    await stat(writtenFilePath);
    assert.equal(
      (applyBody.summary as Record<string, unknown>).totalFiles,
      (dryRunBody.summary as Record<string, unknown>).totalFiles,
    );

    const replayResponse = await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${regenerationJobId}/sync`,
      headers: { "content-type": "application/json" },
      payload: {
        mode: "apply",
        confirmationToken,
        confirmOverwrite: true,
        fileDecisions: files.map((entry) => ({
          path: entry.path,
          decision: entry.decision,
        })),
      },
    });
    assert.equal(replayResponse.statusCode, 409);
    assert.equal(
      replayResponse.json<Record<string, unknown>>().error,
      "SYNC_CONFIRMATION_INVALID",
    );
  } finally {
    await server.app.close();
    await cleanupWorkspace(root);
  }
});

void test("bdd contract: Return queue backpressure when capacity is exhausted", async () => {
  const { root, outputRoot } = await createTempWorkspaceLayout();
  const server = await createBddWorkspaceServer({
    outputRoot,
    maxConcurrentJobs: 1,
    maxQueuedJobs: 1,
    fetchImpl: createNeverEndingCancelableFetch(),
  });

  try {
    const firstSubmit = await submitRestJob({
      server,
      figmaFileKey: "backpressure-1",
    });
    const secondSubmit = await submitRestJob({
      server,
      figmaFileKey: "backpressure-2",
    });
    const thirdResponse = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "backpressure-3",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });

    assert.equal(thirdResponse.statusCode, 429);
    assert.equal(
      thirdResponse.json<Record<string, unknown>>().error,
      "QUEUE_BACKPRESSURE",
    );

    await Promise.all([
      server.app.inject({
        method: "POST",
        url: `/workspace/jobs/${String(firstSubmit.jobId)}/cancel`,
        headers: { "content-type": "application/json" },
        payload: { reason: "cleanup" },
      }),
      server.app.inject({
        method: "POST",
        url: `/workspace/jobs/${String(secondSubmit.jobId)}/cancel`,
        headers: { "content-type": "application/json" },
        payload: { reason: "cleanup" },
      }),
    ]);

    await Promise.all([
      waitForJobTerminalState({ server, jobId: String(firstSubmit.jobId) }),
      waitForJobTerminalState({ server, jobId: String(secondSubmit.jobId) }),
    ]);
  } finally {
    await server.app.close();
    await cleanupWorkspace(root);
  }
});

void test("bdd contract: Return rate limiting with Retry-After", async () => {
  const { root, outputRoot } = await createTempWorkspaceLayout();
  const server = await createBddWorkspaceServer({
    outputRoot,
    rateLimitPerMinute: 1,
    fetchImpl: createNeverEndingCancelableFetch(),
  });

  try {
    const firstSubmit = await submitRestJob({
      server,
      figmaFileKey: "rate-limit-1",
    });
    const secondResponse = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "rate-limit-2",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });

    assert.equal(secondResponse.statusCode, 429);
    assert.match(secondResponse.headers["retry-after"] ?? "", /^\d+$/);
    assert.equal(
      secondResponse.json<Record<string, unknown>>().error,
      "RATE_LIMIT_EXCEEDED",
    );

    await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${String(firstSubmit.jobId)}/cancel`,
      headers: { "content-type": "application/json" },
      payload: { reason: "cleanup" },
    });
    await waitForJobTerminalState({
      server,
      jobId: String(firstSubmit.jobId),
    });
  } finally {
    await server.app.close();
    await cleanupWorkspace(root);
  }
});
