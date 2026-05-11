import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkspaceServer } from "../server.js";

export const TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN =
  "test-import-session-event-bearer-token";

export const createTempWorkspaceLayout = async (): Promise<{
  root: string;
  workspaceRoot: string;
  outputRoot: string;
}> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-bdd-"));
  const workspaceRoot = path.join(root, "workspace");
  const outputRoot = path.join(root, "workspace-output");
  await mkdir(workspaceRoot, { recursive: true });
  return { root, workspaceRoot, outputRoot };
};

export const createLocalFigmaPayload = (): Record<string, unknown> => ({
  name: "Workspace Dev Demo",
  document: {
    id: "0:1",
    type: "DOCUMENT",
    children: [
      {
        id: "1:1",
        name: "Page 1",
        type: "CANVAS",
        children: [
          {
            id: "2:1",
            name: "Landing",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1024 },
            children: [
              { id: "3:1", name: "Header", type: "FRAME", children: [] },
              { id: "3:2", name: "Hero", type: "FRAME", children: [] },
            ],
          },
          {
            id: "2:2",
            name: "Checkout",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
            children: [
              { id: "4:1", name: "Container", type: "FRAME", children: [] },
            ],
          },
        ],
      },
    ],
  },
});

export const writeLocalFigmaPayload = async ({
  workspaceRoot,
  fileName = "figma-input.json",
}: {
  workspaceRoot: string;
  fileName?: string;
}): Promise<string> => {
  const filePath = path.join(workspaceRoot, fileName);
  await writeFile(
    filePath,
    `${JSON.stringify(createLocalFigmaPayload(), null, 2)}\n`,
    "utf8",
  );
  return filePath;
};

export const createFakeFigmaFetch = (): typeof fetch => {
  return async (input) => {
    const rawUrl =
      input instanceof URL
        ? input.href
        : typeof input === "string"
          ? input
          : input.url;
    const requestUrl = new URL(rawUrl);
    const isExpectedFigmaRequest =
      requestUrl.protocol === "https:" &&
      requestUrl.hostname === "api.figma.com" &&
      requestUrl.pathname.startsWith("/v1/files/");

    if (!isExpectedFigmaRequest) {
      return new Response(JSON.stringify({ error: "unexpected-url" }), {
        status: 404,
        headers: {
          "content-type": "application/json",
        },
      });
    }

    return new Response(JSON.stringify(createLocalFigmaPayload()), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };
};

export const createNeverEndingCancelableFetch = (): typeof fetch => {
  return async (_input, init) =>
    await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal instanceof AbortSignal) {
        signal.addEventListener(
          "abort",
          () => {
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      }
    });
};

export const createBddWorkspaceServer = async (
  options: Parameters<typeof createWorkspaceServer>[0] = {},
): Promise<Awaited<ReturnType<typeof createWorkspaceServer>>> => {
  return await createWorkspaceServer({
    port: 0,
    host: "127.0.0.1",
    enablePreview: false,
    // BDD harness exists for fast queue/HTTP/contract tests. Heavy
    // generated-app validation (Playwright, perf assertions, unit tests)
    // would dominate runtime — and the per-pipeline policy in
    // validate-project-service.ts respects these explicit opt-outs even on
    // the default pipeline (see PR #1646).
    enableUiValidation: false,
    enablePerfValidation: false,
    enableUnitTestValidation: false,
    installPreferOffline: true,
    ...options,
  });
};

export const waitForJobState = async ({
  server,
  jobId,
  acceptedStatuses,
  timeoutMs = 15_000,
}: {
  server: Awaited<ReturnType<typeof createWorkspaceServer>>;
  jobId: string;
  acceptedStatuses: readonly string[];
  timeoutMs?: number;
}): Promise<Record<string, unknown>> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await server.app.inject({
      method: "GET",
      url: `/workspace/jobs/${jobId}`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<Record<string, unknown>>();
    if (acceptedStatuses.includes(String(body.status))) {
      return body;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
  }

  throw new Error(
    `Timed out waiting for job ${jobId} to reach one of [${acceptedStatuses.join(", ")}].`,
  );
};

export const waitForJobTerminalState = async ({
  server,
  jobId,
  timeoutMs = 20_000,
}: {
  server: Awaited<ReturnType<typeof createWorkspaceServer>>;
  jobId: string;
  timeoutMs?: number;
}): Promise<Record<string, unknown>> => {
  return await waitForJobState({
    server,
    jobId,
    acceptedStatuses: ["completed", "partial", "failed", "canceled"],
    timeoutMs,
  });
};

export const submitRestJob = async ({
  server,
  figmaFileKey = "test-key",
}: {
  server: Awaited<ReturnType<typeof createWorkspaceServer>>;
  figmaFileKey?: string;
}): Promise<Record<string, unknown>> => {
  const response = await server.app.inject({
    method: "POST",
    url: "/workspace/submit",
    headers: { "content-type": "application/json" },
    payload: {
      figmaFileKey,
      figmaAccessToken: "figd_xxx",
      figmaSourceMode: "rest",
      llmCodegenMode: "deterministic",
    },
  });
  assert.equal(response.statusCode, 202);
  return response.json<Record<string, unknown>>();
};

export const submitLocalJsonJob = async ({
  server,
  figmaJsonPath,
}: {
  server: Awaited<ReturnType<typeof createWorkspaceServer>>;
  figmaJsonPath: string;
}): Promise<Record<string, unknown>> => {
  const response = await server.app.inject({
    method: "POST",
    url: "/workspace/submit",
    headers: { "content-type": "application/json" },
    payload: {
      figmaSourceMode: "local_json",
      figmaJsonPath,
      llmCodegenMode: "deterministic",
    },
  });
  assert.equal(response.statusCode, 202);
  return response.json<Record<string, unknown>>();
};

export const readFeatureScenarioNames = async (
  featurePath: string,
): Promise<string[]> => {
  const featureContent = await readFile(featurePath, "utf8");
  return featureContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Scenario:"))
    .map((line) => line.replace("Scenario:", "").trim());
};

export const cleanupWorkspace = async (root: string): Promise<void> => {
  await rm(root, { recursive: true, force: true });
};
