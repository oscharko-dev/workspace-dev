import assert from "node:assert/strict";
import test from "node:test";
import {
  createBddWorkspaceServer,
  createFakeFigmaFetch,
  createTempWorkspaceLayout,
  cleanupWorkspace,
  submitLocalJsonJob,
  waitForJobTerminalState,
  writeLocalFigmaPayload,
} from "./harness.js";

export const securityContractScenarioNames = [
  "Reject protected write routes without same-origin browser metadata",
  "Reject path traversal attempts on job artifact file-listing and file routes",
] as const;

const protectedWriteRoutes = [
  {
    url: "/workspace/submit",
    payload: {
      figmaFileKey: "security-key",
      figmaAccessToken: "figd_xxx",
      figmaSourceMode: "rest",
      llmCodegenMode: "deterministic",
    },
  },
  {
    url: "/workspace/jobs/job-1/cancel",
    payload: {
      reason: "cleanup",
    },
  },
  {
    url: "/workspace/jobs/job-1/sync",
    payload: {
      mode: "dry_run",
    },
  },
  {
    url: "/workspace/jobs/job-1/regenerate",
    payload: {
      overrides: [],
    },
  },
  {
    url: "/workspace/jobs/job-1/create-pr",
    payload: {
      repoUrl: "https://github.com/oscharko-dev/workspace-dev.git",
      repoToken: "ghp_test_token",
    },
  },
] as const;

void test(
  "bdd contract: Reject protected write routes without same-origin browser metadata",
  async () => {
    const { root, outputRoot } = await createTempWorkspaceLayout();
    const server = await createBddWorkspaceServer({
      outputRoot,
      fetchImpl: createFakeFigmaFetch(),
    });

    try {
      const crossSiteOrigin = "http://workspace-dev.internal";

      for (const route of protectedWriteRoutes) {
        const crossSiteResponse = await server.app.inject({
          method: "POST",
          url: route.url,
          headers: {
            origin: crossSiteOrigin,
            "sec-fetch-site": "cross-site",
            "content-type": "application/json",
          },
          payload: route.payload,
        });

        assert.equal(crossSiteResponse.statusCode, 403);
        assert.equal(
          crossSiteResponse.json<Record<string, unknown>>().error,
          "FORBIDDEN_REQUEST_ORIGIN",
        );

        const missingMetadataResponse = await server.app.inject({
          method: "POST",
          url: route.url,
          headers: {
            "sec-fetch-site": "same-origin",
            "content-type": "application/json",
          },
          payload: route.payload,
        });

        assert.equal(missingMetadataResponse.statusCode, 403);
        assert.equal(
          missingMetadataResponse.json<Record<string, unknown>>().error,
          "FORBIDDEN_REQUEST_ORIGIN",
        );
      }
    } finally {
      await server.app.close();
      await cleanupWorkspace(root);
    }
  },
);

const createCompletedLocalJsonSource = async () => {
  const layout = await createTempWorkspaceLayout();
  const figmaJsonPath = await writeLocalFigmaPayload({
    workspaceRoot: layout.workspaceRoot,
  });
  const server = await createBddWorkspaceServer({
    workDir: layout.workspaceRoot,
    outputRoot: layout.outputRoot,
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

void test(
  "bdd contract: Reject path traversal attempts on job artifact file-listing and file routes",
  async () => {
    const { root, server, sourceJobId } = await createCompletedLocalJsonSource();

    try {
      const traversalFileResponse = await server.app.inject({
        method: "GET",
        url: `/workspace/jobs/${sourceJobId}/files/${encodeURIComponent(
          "src/../../etc/passwd.ts",
        )}`,
      });
      assert.equal(traversalFileResponse.statusCode, 403);
      assert.equal(
        traversalFileResponse.json<Record<string, unknown>>().error,
        "FORBIDDEN_PATH",
      );

      const traversalDirResponse = await server.app.inject({
        method: "GET",
        url: `/workspace/jobs/${sourceJobId}/files?dir=${encodeURIComponent(
          "../..",
        )}`,
      });
      assert.equal(traversalDirResponse.statusCode, 403);
      assert.equal(
        traversalDirResponse.json<Record<string, unknown>>().error,
        "FORBIDDEN_PATH",
      );
    } finally {
      await server.app.close();
      await cleanupWorkspace(root);
    }
  },
);
