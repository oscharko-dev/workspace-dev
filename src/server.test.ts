import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { toDeterministicScreenPath } from "./parity/generator-artifacts.js";
import {
  DEFAULT_FIGMA_PASTE_MAX_BYTES,
  MAX_SUBMIT_BODY_BYTES,
  WORKSPACE_UI_CONTENT_SECURITY_POLICY,
} from "./server/constants.js";
import { createWorkspaceServer } from "./server.js";
import { TEST_INTELLIGENCE_ENV } from "./contracts/index.js";

const MODULE_DIR =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_NODE_MODULES_ROOT = path.resolve(
  MODULE_DIR,
  "../template/react-mui-app/node_modules",
);
const HEAVY_SERVER_JOB_TIMEOUT_MS = 60_000;
const allocateTestPort = (): number => 0;

async function withTestIntelligenceEnv<T>(
  value: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.env[TEST_INTELLIGENCE_ENV];
  if (value === undefined) {
    delete process.env[TEST_INTELLIGENCE_ENV];
  } else {
    process.env[TEST_INTELLIGENCE_ENV] = value;
  }
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env[TEST_INTELLIGENCE_ENV];
    } else {
      process.env[TEST_INTELLIGENCE_ENV] = previous;
    }
  }
}

const createTempWorkspaceLayout = async (): Promise<{
  root: string;
  workspaceRoot: string;
  outputRoot: string;
}> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-layout-"));
  const workspaceRoot = path.join(root, "workspace");
  return {
    root,
    workspaceRoot,
    outputRoot: path.join(root, "workspace-output"),
  };
};

const createLocalFigmaPayload = () => ({
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

const createFakeFigmaFetch = (): typeof fetch => {
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

    const payload = createLocalFigmaPayload();

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };
};

const createLowFidelityRecoveryFetch = (): typeof fetch => {
  const lowFidelityPayload = {
    name: "Sparkasse Recovery",
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
              name: "Sparkasse Recovery",
              absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1200 },
              children: [
                ...Array.from({ length: 12 }, (_, index) => ({
                  id: `instance-${index + 1}`,
                  type: "INSTANCE",
                  name: index % 3 === 0 ? "<Card>" : "<Button>",
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
                  name: "Sparkasse S",
                  absoluteBoundingBox: { x: 24, y: 24, width: 24, height: 24 },
                },
                {
                  id: "vector-dot",
                  type: "VECTOR",
                  name: "Ellipse 4",
                  absoluteBoundingBox: { x: 52, y: 24, width: 12, height: 12 },
                },
                {
                  id: "text-title",
                  type: "TEXT",
                  name: "Heading",
                  characters: "Finanzierungsplaner",
                  absoluteBoundingBox: {
                    x: 24,
                    y: 200,
                    width: 240,
                    height: 24,
                  },
                },
                {
                  id: "text-meta",
                  type: "TEXT",
                  name: "Meta",
                  characters: "Meyer Technology GmbH",
                  absoluteBoundingBox: {
                    x: 24,
                    y: 232,
                    width: 200,
                    height: 20,
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const authoritativeScreen = {
    id: "screen-recovery",
    type: "FRAME",
    name: "Sparkasse Recovery",
    absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1200 },
    children: [
      {
        id: "brand-bar",
        type: "FRAME",
        name: "Markenbühne",
        absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 88 },
        children: [
          {
            id: "brand-cluster",
            type: "FRAME",
            name: "Brand Cluster",
            absoluteBoundingBox: { x: 24, y: 16, width: 240, height: 56 },
            children: [
              {
                id: "brand-mark",
                type: "VECTOR",
                name: "Sparkasse S",
                absoluteBoundingBox: { x: 24, y: 20, width: 24, height: 24 },
                vectorPaths: ["M0 0H24V24H0Z"],
              },
              {
                id: "brand-title",
                type: "TEXT",
                name: "Brand Title",
                characters: "Sparkasse Musterstadt",
                absoluteBoundingBox: { x: 56, y: 16, width: 180, height: 24 },
              },
            ],
          },
          {
            id: "nav-start",
            type: "INSTANCE",
            name: "<Button>",
            absoluteBoundingBox: { x: 840, y: 24, width: 120, height: 32 },
            children: [
              {
                id: "nav-start-label",
                type: "TEXT",
                name: "Label",
                characters: "Startseite",
                absoluteBoundingBox: { x: 868, y: 28, width: 80, height: 20 },
              },
            ],
          },
          {
            id: "nav-search",
            type: "INSTANCE",
            name: "<Button>",
            absoluteBoundingBox: { x: 968, y: 24, width: 160, height: 32 },
            children: [
              {
                id: "nav-search-label",
                type: "TEXT",
                name: "Label",
                characters: "Personensuche",
                absoluteBoundingBox: { x: 996, y: 28, width: 116, height: 20 },
              },
            ],
          },
          {
            id: "nav-messenger",
            type: "INSTANCE",
            name: "<Button>",
            absoluteBoundingBox: { x: 1136, y: 24, width: 132, height: 32 },
            children: [
              {
                id: "nav-messenger-label",
                type: "TEXT",
                name: "Label",
                characters: "Messenger",
                absoluteBoundingBox: { x: 1164, y: 28, width: 84, height: 20 },
              },
            ],
          },
        ],
      },
      {
        id: "context-header",
        type: "FRAME",
        name: "Header + Titel",
        absoluteBoundingBox: { x: 0, y: 100, width: 1440, height: 80 },
        children: [
          {
            id: "context-left",
            type: "FRAME",
            name: "Context Left",
            absoluteBoundingBox: { x: 24, y: 108, width: 420, height: 64 },
            children: [
              {
                id: "context-title",
                type: "TEXT",
                name: "Title",
                characters: "Gewerbliche Finanzierung (12.03.2026)",
                absoluteBoundingBox: { x: 72, y: 116, width: 280, height: 24 },
              },
              {
                id: "context-subtitle",
                type: "TEXT",
                name: "Subtitle",
                characters: "Finanzierungsantrag: 1234567890",
                absoluteBoundingBox: { x: 72, y: 144, width: 220, height: 20 },
              },
            ],
          },
          {
            id: "context-summary-card",
            type: "INSTANCE",
            name: "<Card>",
            absoluteBoundingBox: { x: 780, y: 108, width: 320, height: 64 },
            children: [
              {
                id: "company-name",
                type: "TEXT",
                name: "Title",
                characters: "Meyer Technology GmbH",
                absoluteBoundingBox: { x: 812, y: 120, width: 180, height: 24 },
              },
            ],
          },
        ],
      },
      {
        id: "empty-state",
        type: "FRAME",
        name: "<Card>",
        absoluteBoundingBox: { x: 120, y: 220, width: 960, height: 240 },
        children: [
          {
            id: "empty-icon",
            type: "VECTOR",
            name: "ic_plus_circle_m",
            absoluteBoundingBox: { x: 560, y: 252, width: 64, height: 64 },
            vectorPaths: ["M0 0H64V64H0Z"],
          },
          {
            id: "empty-title",
            type: "TEXT",
            name: "Title",
            characters: "Kein Vorhaben hinzugefügt",
            absoluteBoundingBox: { x: 460, y: 340, width: 220, height: 28 },
          },
          {
            id: "empty-copy",
            type: "TEXT",
            name: "Body",
            characters:
              "Bitte fügen Sie ein Vorhaben über die Schaltfläche hinzu.",
            absoluteBoundingBox: { x: 388, y: 372, width: 360, height: 24 },
          },
          {
            id: "empty-cta",
            type: "INSTANCE",
            name: "<Button>",
            absoluteBoundingBox: { x: 420, y: 416, width: 320, height: 40 },
            children: [
              {
                id: "empty-cta-label",
                type: "TEXT",
                name: "Label",
                characters: "Vorhaben hinzufügen",
                absoluteBoundingBox: { x: 492, y: 426, width: 176, height: 20 },
              },
            ],
          },
        ],
      },
      {
        id: "actions-title",
        type: "TEXT",
        name: "Title",
        characters: "Aktionen zum Finanzierungsantrag",
        absoluteBoundingBox: { x: 120, y: 500, width: 320, height: 28 },
      },
      {
        id: "action-card",
        type: "INSTANCE",
        name: "<Button>",
        absoluteBoundingBox: { x: 120, y: 560, width: 472, height: 84 },
        children: [
          {
            id: "action-card-title",
            type: "TEXT",
            name: "Title",
            characters: "Sicherheiten verwalten",
            absoluteBoundingBox: { x: 196, y: 580, width: 180, height: 24 },
          },
          {
            id: "action-card-chip",
            type: "INSTANCE",
            name: "<Chip>",
            absoluteBoundingBox: { x: 196, y: 608, width: 148, height: 24 },
            children: [
              {
                id: "action-card-chip-label",
                type: "TEXT",
                name: "Chip",
                characters: "Bearbeitung gesperrt",
                absoluteBoundingBox: { x: 208, y: 612, width: 136, height: 16 },
              },
            ],
          },
        ],
      },
      {
        id: "document-card",
        type: "INSTANCE",
        name: "<Button>",
        absoluteBoundingBox: { x: 608, y: 560, width: 472, height: 84 },
        children: [
          {
            id: "document-card-title",
            type: "TEXT",
            name: "Title",
            characters: "Druckcenter",
            absoluteBoundingBox: { x: 684, y: 580, width: 120, height: 24 },
          },
        ],
      },
    ],
  };

  return async (input) => {
    const rawUrl =
      input instanceof URL
        ? input.href
        : typeof input === "string"
          ? input
          : input.url;
    const requestUrl = new URL(rawUrl);
    if (
      requestUrl.protocol === "https:" &&
      requestUrl.hostname === "api.figma.com" &&
      requestUrl.pathname.includes("/nodes")
    ) {
      return new Response(
        JSON.stringify({
          nodes: {
            "screen-recovery": {
              document: authoritativeScreen,
            },
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    return new Response(JSON.stringify(lowFidelityPayload), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };
};

const createNeverEndingCancelableFetch = (): typeof fetch => {
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

const waitForJobTerminalState = async ({
  server,
  jobId,
  timeoutMs = 10_000,
}: {
  server: Awaited<ReturnType<typeof createWorkspaceServer>>;
  jobId: string;
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

    if (
      body.status === "completed" ||
      body.status === "partial" ||
      body.status === "failed" ||
      body.status === "canceled"
    ) {
      return body;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
  }

  throw new Error(`Timed out waiting for terminal state of job ${jobId}`);
};

const createTempOutputRoot = async (): Promise<string> => {
  return await mkdtemp(path.join(os.tmpdir(), "workspace-dev-test-"));
};

const isPathWithinRoot = ({
  candidatePath,
  rootPath,
}: {
  candidatePath: string;
  rootPath: string;
}): boolean => {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedCandidate = path.resolve(candidatePath);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  );
};

const collectSymlinkTargets = async ({
  rootDir,
}: {
  rootDir: string;
}): Promise<string[]> => {
  const pendingDirs: string[] = [rootDir];
  const resolvedTargets: string[] = [];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop();
    if (!currentDir) {
      continue;
    }

    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pendingDirs.push(entryPath);
        continue;
      }
      if (!entry.isSymbolicLink()) {
        continue;
      }
      const target = await readlink(entryPath);
      resolvedTargets.push(path.resolve(path.dirname(entryPath), target));
    }
  }

  return resolvedTargets;
};

const extractUiAssetUrls = ({ html }: { html: string }): string[] => {
  const matches = [
    ...html.matchAll(/(?:src|href)=["'](\/workspace\/ui\/assets\/[^"']+)["']/g),
  ];
  const urls = new Set(
    matches
      .map((match) => match[1])
      .filter((entry): entry is string => Boolean(entry)),
  );
  return [...urls];
};

test("workspace server starts and responds on /workspace", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "GET",
      url: "/workspace",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.running, true);
    assert.equal(body.figmaSourceMode, "rest");
    assert.equal(body.llmCodegenMode, "deterministic");
    assert.equal(typeof body.port, "number");
    assert.ok(Number.isInteger(body.port));
    assert.ok((body.port as number) > 0);
    assert.equal(typeof body.uptimeMs, "number");
    assert.equal(typeof body.outputRoot, "string");
    assert.equal(body.previewEnabled, true);
  } finally {
    await server.app.close().catch((error) => {
      if (
        error instanceof Error &&
        error.message !== "Server is already stopped."
      ) {
        throw error;
      }
    });
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server wires Jira write bearer from public start options", async () => {
  await withTestIntelligenceEnv("1", async () => {
    const outputRoot = await createTempOutputRoot();
    const port = allocateTestPort();
    const server = await createWorkspaceServer({
      port,
      host: "127.0.0.1",
      outputRoot,
      fetchImpl: createFakeFigmaFetch(),
      testIntelligence: {
        enabled: true,
        allowJiraWrite: true,
        jiraWriteBearerToken: "jira-write-token",
      },
    });

    try {
      const response = await server.app.inject({
        method: "POST",
        url: "/workspace/test-intelligence/write/missing-job/jira-subtasks",
        headers: { authorization: "Bearer jira-write-token" },
        payload: {
          parentIssueKey: "PROJ-123",
          dryRun: true,
          useDefaultOutputPath: true,
        },
      });
      assert.equal(response.statusCode, 404);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "JOB_NOT_FOUND",
      );
    } finally {
      await server.app.close().catch((error) => {
        if (
          error instanceof Error &&
          error.message !== "Server is already stopped."
        ) {
          throw error;
        }
      });
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});

test("workspace server healthz endpoint", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "GET",
      url: "/healthz",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok", uptime: 0 });

    const readyResponse = await server.app.inject({
      method: "GET",
      url: "/readyz",
    });
    assert.equal(readyResponse.statusCode, 200);
    assert.deepEqual(readyResponse.json(), { status: "ok", uptime: 0 });
  } finally {
    await server.app.close().catch((error) => {
      if (
        error instanceof Error &&
        error.message !== "Server is already stopped."
      ) {
        throw error;
      }
    });
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server exposes draining readiness and rejects new mutating requests during shutdown", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    let finishInFlightRequest: (() => void) | undefined;
    const inFlightResponsePromise = new Promise<{
      statusCode: number | undefined;
      body: string;
    }>((resolve, reject) => {
      const request = httpRequest(
        `${server.url}/workspace/submit`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => {
            chunks.push(Buffer.from(chunk));
          });
          response.on("end", () => {
            resolve({
              statusCode: response.statusCode,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      request.on("error", reject);
      request.write("{");
      finishInFlightRequest = () => {
        request.end("}");
      };
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    const closePromise = server.app.close();

    const readyResponse = await fetch(`${server.url}/readyz`, {
      signal: AbortSignal.timeout(1_000),
    });
    assert.equal(readyResponse.status, 503);
    assert.deepEqual((await readyResponse.json()) as Record<string, unknown>, {
      status: "draining",
      uptime: 0,
    });

    const drainingSubmitResponse = await fetch(
      `${server.url}/workspace/submit`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(1_000),
      },
    );
    assert.equal(drainingSubmitResponse.status, 503);
    const drainingSubmitBody = (await drainingSubmitResponse.json()) as Record<
      string,
      unknown
    >;
    assert.equal(drainingSubmitBody.error, "SERVER_DRAINING");

    finishInFlightRequest?.();
    const inFlightResponse = await inFlightResponsePromise;
    assert.equal(inFlightResponse.statusCode, 400);
    const inFlightBody = JSON.parse(inFlightResponse.body) as Record<
      string,
      unknown
    >;
    assert.equal(inFlightBody.error, "VALIDATION_ERROR");

    await closePromise;

    await assert.rejects(
      () =>
        fetch(`${server.url}/workspace`, {
          signal: AbortSignal.timeout(1_000),
        }),
      /fetch failed|ECONNREFUSED/i,
    );
  } finally {
    await server.app.close().catch((error) => {
      if (
        error instanceof Error &&
        error.message !== "Server is already stopped."
      ) {
        throw error;
      }
    });
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server terminates stalled requests after the shutdown timeout", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    shutdownTimeoutMs: 50,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const stalledRequestPromise = new Promise<Error | undefined>((resolve) => {
      const request = httpRequest(`${server.url}/workspace/submit`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      });

      request.on("error", (error) => {
        resolve(error);
      });
      request.on("response", () => {
        resolve(undefined);
      });

      request.write("{");
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    const shutdownStartedAt = Date.now();
    await server.app.close();
    const shutdownElapsedMs = Date.now() - shutdownStartedAt;
    assert.ok(
      shutdownElapsedMs < 1_000,
      `Expected forced shutdown within 1s, got ${shutdownElapsedMs}ms`,
    );

    const stalledRequestError = await stalledRequestPromise;
    assert.ok(stalledRequestError instanceof Error);
  } finally {
    await server.app.close().catch((error) => {
      if (
        error instanceof Error &&
        error.message !== "Server is already stopped."
      ) {
        throw error;
      }
    });
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server propagates request IDs on success and error responses", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const successResponse = await server.app.inject({
      method: "GET",
      url: "/workspace",
    });
    assert.equal(successResponse.statusCode, 200);
    assert.match(
      successResponse.headers["x-request-id"] ?? "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const errorResponse = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-server-error-1",
      },
      payload: '{"figmaFileKey":',
    });

    assert.equal(errorResponse.statusCode, 400);
    assert.equal(errorResponse.headers["x-request-id"], "req-server-error-1");
    const errorBody = errorResponse.json<Record<string, unknown>>();
    assert.equal(errorBody.error, "INVALID_PAYLOAD");
    assert.equal(errorBody.requestId, "req-server-error-1");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server serves UI entrypoint on /workspace/ui and /workspace/:key", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const uiResponse = await server.app.inject({
      method: "GET",
      url: "/workspace/ui",
    });
    assert.equal(uiResponse.statusCode, 200);
    assert.match(uiResponse.headers["content-type"] ?? "", /text\/html/i);
    assert.equal(
      uiResponse.headers["content-security-policy"],
      WORKSPACE_UI_CONTENT_SECURITY_POLICY,
    );
    assert.match(uiResponse.body, /Workspace Dev/i);

    const workspacePathResponse = await server.app.inject({
      method: "GET",
      url: "/workspace/1BvardU9Dtxq2WBTzSRm2S",
    });
    assert.equal(workspacePathResponse.statusCode, 200);
    assert.match(
      workspacePathResponse.headers["content-type"] ?? "",
      /text\/html/i,
    );
    assert.equal(
      workspacePathResponse.headers["content-security-policy"],
      WORKSPACE_UI_CONTENT_SECURITY_POLICY,
    );

    const nestedUiRouteResponse = await server.app.inject({
      method: "GET",
      url: "/workspace/ui/visual-quality",
    });
    assert.equal(nestedUiRouteResponse.statusCode, 200);
    assert.match(
      nestedUiRouteResponse.headers["content-type"] ?? "",
      /text\/html/i,
    );
    assert.equal(
      nestedUiRouteResponse.headers["content-security-policy"],
      WORKSPACE_UI_CONTENT_SECURITY_POLICY,
    );
    assert.match(nestedUiRouteResponse.body, /Workspace Dev/i);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server serves UI static assets", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const uiResponse = await server.app.inject({
      method: "GET",
      url: "/workspace/ui",
    });
    assert.equal(uiResponse.statusCode, 200);
    assert.match(uiResponse.headers["content-type"] ?? "", /text\/html/i);

    const assetUrls = extractUiAssetUrls({ html: uiResponse.body });
    assert.ok(
      assetUrls.length > 0,
      "Expected UI entrypoint to reference bundled assets.",
    );
    assert.ok(
      assetUrls.some((url) => url.endsWith(".css")),
      "Expected at least one bundled CSS asset.",
    );
    assert.ok(
      assetUrls.some((url) => url.endsWith(".js")),
      "Expected at least one bundled JS asset.",
    );

    for (const url of assetUrls) {
      const assetResponse = await server.app.inject({
        method: "GET",
        url,
      });
      assert.equal(
        assetResponse.statusCode,
        200,
        `Expected ${url} to be served`,
      );
      assert.doesNotMatch(
        assetResponse.headers["content-type"] ?? "",
        /text\/html/i,
      );
      assert.notEqual(
        assetResponse.headers["content-security-policy"],
        WORKSPACE_UI_CONTENT_SECURITY_POLICY,
        `Expected ${url} to be served as an asset instead of the UI entrypoint.`,
      );
      if (url.endsWith(".css")) {
        assert.match(assetResponse.headers["content-type"] ?? "", /text\/css/i);
      }
      if (url.endsWith(".js")) {
        assert.match(
          assetResponse.headers["content-type"] ?? "",
          /javascript/i,
        );
      }
    }
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server reports unknown route with deterministic 404 envelope", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "GET",
      url: "/not-found",
    });

    assert.equal(response.statusCode, 404);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "NOT_FOUND");
    assert.match(String(body.message), /Unknown route/i);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server blocks mcp mode on submit", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "mcp",
        figmaFileKey: "test-key",
        figmaAccessToken: "figd_xxx",
        repoUrl: "https://github.com/example/repo.git",
        repoToken: "ghp_xxx",
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "MODE_LOCK_VIOLATION");
    assert.match(String(body.message), /mcp.*not available/i);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server accepts hybrid mode on submit", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "hybrid",
        figmaFileKey: "test-key",
        figmaAccessToken: "figd_xxx",
      },
    });

    assert.equal(response.statusCode, 202);
    const body = response.json<Record<string, unknown>>();
    const acceptedModes = body.acceptedModes as Record<string, unknown>;
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    assert.equal(acceptedModes.figmaSourceMode, "hybrid");
    assert.equal(acceptedModes.llmCodegenMode, "deterministic");
    assert.ok(jobId.length > 0);

    const terminal = await waitForJobTerminalState({
      server,
      jobId,
      timeoutMs: HEAVY_SERVER_JOB_TIMEOUT_MS,
    });
    assert.ok(terminal.status === "completed" || terminal.status === "failed");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server recovers low-fidelity hybrid screens with the built-in authoritative subtree loader", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createLowFidelityRecoveryFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "hybrid",
        figmaFileKey: "sparkasse-board",
        figmaAccessToken: "figd_demo",
      },
    });

    assert.equal(response.statusCode, 202);
    const body = response.json<Record<string, unknown>>();
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    assert.ok(jobId.length > 0);

    const terminal = await waitForJobTerminalState({
      server,
      jobId,
      timeoutMs: 120_000,
    });
    assert.equal(terminal.status, "completed");

    const generatedProjectDir = String(terminal.artifacts.generatedProjectDir);
    const screenContent = await readFile(
      path.join(
        generatedProjectDir,
        toDeterministicScreenPath("Sparkasse Recovery"),
      ),
      "utf8",
    );

    assert.ok(screenContent.includes('{"Sparkasse Musterstadt"}'));
    assert.ok(screenContent.includes('{"Startseite"}'));
    assert.ok(screenContent.includes('{"Personensuche"}'));
    assert.ok(screenContent.includes('{"Messenger"}'));
    assert.ok(
      screenContent.includes('{"Gewerbliche Finanzierung (12.03.2026)"}'),
    );
    assert.ok(screenContent.includes('{"Meyer Technology GmbH"}'));
    assert.ok(screenContent.includes('{"Kein Vorhaben hinzugefügt"}'));
    assert.ok(
      screenContent.includes(
        '{"Bitte fügen Sie ein Vorhaben über die Schaltfläche hinzu."}',
      ),
    );
    assert.ok(screenContent.includes('{"Aktionen zum Finanzierungsantrag"}'));
    assert.ok(screenContent.includes('{"Sicherheiten verwalten"}'));
    assert.ok(screenContent.includes('{"Druckcenter"}'));
    assert.equal(screenContent.includes("<Tabs "), false);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server rejects invalid JSON payloads", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: '{"figmaFileKey":',
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "INVALID_PAYLOAD");
    assert.match(String(body.message), /Invalid JSON payload/i);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server rejects submit requests without required fields", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "demo",
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "VALIDATION_ERROR");
    assert.ok(Array.isArray(body.issues));
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server rejects invalid llmCodegenMode at the submit schema boundary", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "demo",
        figmaAccessToken: "figd_xxx",
        llmCodegenMode: "hybrid",
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "VALIDATION_ERROR");
    assert.deepEqual(body.issues, [
      {
        path: "llmCodegenMode",
        message: "llmCodegenMode must equal 'deterministic'",
      },
    ]);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server rejects unsupported generationLocale at the submit schema boundary", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "demo",
        figmaAccessToken: "figd_xxx",
        generationLocale: "zz-ZZ",
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "VALIDATION_ERROR");
    assert.deepEqual(body.issues, [
      {
        path: "generationLocale",
        message: "generationLocale must be a valid supported locale",
      },
    ]);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server rejects ambiguous source inputs that mix rest and local_json fields", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "local_json",
        figmaJsonPath: "./figma.json",
        figmaFileKey: "demo",
        figmaAccessToken: "figd_xxx",
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "VALIDATION_ERROR");
    assert.ok(Array.isArray(body.issues));
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server accepts submit with 202 and job polling reaches completed", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const submitResponse = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });

    assert.equal(submitResponse.statusCode, 202);
    const submitBody = submitResponse.json<Record<string, unknown>>();
    const acceptedModes = submitBody.acceptedModes as Record<string, unknown>;
    assert.equal(submitBody.status, "queued");
    assert.equal(acceptedModes.figmaSourceMode, "rest");
    assert.equal(acceptedModes.llmCodegenMode, "deterministic");
    assert.equal(typeof submitBody.jobId, "string");

    const jobId = String(submitBody.jobId);
    const finalStatus = await waitForJobTerminalState({
      server,
      jobId,
      timeoutMs: 120_000,
    });
    const request = finalStatus.request as Record<string, unknown>;
    const preview = finalStatus.preview as Record<string, unknown>;
    assert.equal(finalStatus.status, "completed");
    assert.equal(request.repoToken, undefined);
    assert.equal(request.enableGitPr, false);
    assert.equal(request.brandTheme, "derived");
    assert.equal(request.generationLocale, "de-DE");
    assert.equal(request.formHandlingMode, "react_hook_form");
    assert.equal(preview.enabled, true);

    const generatedProjectDir = path.join(
      outputRoot,
      "jobs",
      jobId,
      "generated-app",
    );
    const symlinkTargets = await collectSymlinkTargets({
      rootDir: generatedProjectDir,
    });
    const hasTemplateNodeModulesSymlink = symlinkTargets.some((target) =>
      isPathWithinRoot({
        candidatePath: target,
        rootPath: TEMPLATE_NODE_MODULES_ROOT,
      }),
    );
    assert.equal(
      hasTemplateNodeModulesSymlink,
      false,
      "Generated app must not keep symlinks into template node_modules.",
    );
    const generatedRootEntries = await readdir(generatedProjectDir);
    assert.equal(
      generatedRootEntries.includes("artifacts"),
      false,
      "Generated app must not include template artifacts directory.",
    );

    const resultResponse = await server.app.inject({
      method: "GET",
      url: `/workspace/jobs/${jobId}/result`,
    });
    assert.equal(resultResponse.statusCode, 200);
    const resultBody = resultResponse.json<Record<string, unknown>>();
    assert.equal(resultBody.status, "completed");
    assert.match(String(resultBody.summary), /completed successfully/i);

    const previewResponse = await server.app.inject({
      method: "GET",
      url: `/workspace/repros/${jobId}/`,
    });
    assert.equal(previewResponse.statusCode, 200);
    assert.match(previewResponse.headers["content-type"] ?? "", /text\/html/i);
    assert.equal(
      previewResponse.headers["content-security-policy"],
      undefined,
      "repro route must omit CSP for iframe embedding",
    );
    assert.equal(
      previewResponse.headers["x-frame-options"],
      undefined,
      "repro route must omit x-frame-options for iframe embedding",
    );
    assert.equal(previewResponse.body.includes('<div id="root"></div>'), true);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server accepts local_json submit and completes without Figma REST fetches", async () => {
  const { root, workspaceRoot, outputRoot } = await createTempWorkspaceLayout();
  const port = allocateTestPort();
  await mkdir(workspaceRoot, { recursive: true });
  const localJsonPath = path.join(workspaceRoot, "local-figma.json");
  await writeFile(
    localJsonPath,
    `${JSON.stringify(createLocalFigmaPayload(), null, 2)}\n`,
    "utf8",
  );

  let fetchCalls = 0;
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    workDir: workspaceRoot,
    outputRoot,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("Unexpected network fetch in local_json mode.");
    },
  });

  try {
    const submitResponse = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "local_json",
        figmaJsonPath: localJsonPath,
        llmCodegenMode: "deterministic",
      },
    });

    assert.equal(submitResponse.statusCode, 202);
    const submitBody = submitResponse.json<Record<string, unknown>>();
    const acceptedModes = submitBody.acceptedModes as Record<string, unknown>;
    assert.equal(acceptedModes.figmaSourceMode, "local_json");
    assert.equal(acceptedModes.llmCodegenMode, "deterministic");

    const jobId = String(submitBody.jobId);
    const finalStatus = await waitForJobTerminalState({
      server,
      jobId,
      timeoutMs: 120_000,
    });
    const request = finalStatus.request as Record<string, unknown>;
    assert.equal(finalStatus.status, "completed");
    assert.equal(request.figmaSourceMode, "local_json");
    assert.equal(request.figmaJsonPath, localJsonPath);
    assert.equal(request.figmaFileKey, undefined);
    assert.equal(request.formHandlingMode, "react_hook_form");
    assert.equal(fetchCalls, 0);

    const cleanedFigmaPath = path.join(outputRoot, "jobs", jobId, "figma.json");
    const cleanedFigma = await readFile(cleanedFigmaPath, "utf8");
    assert.match(cleanedFigma, /Workspace Dev Demo/i);
  } finally {
    await server.app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace server fails validate.project when skipInstall=true and dependencies are missing", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    skipInstall: true,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const submitResponse = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });

    assert.equal(submitResponse.statusCode, 202);
    const submitBody = submitResponse.json<Record<string, unknown>>();
    const jobId = String(submitBody.jobId);
    const finalStatus = await waitForJobTerminalState({
      server,
      jobId,
      timeoutMs: 120_000,
    });
    const error = finalStatus.error as Record<string, unknown> | undefined;

    assert.equal(finalStatus.status, "partial");
    assert.equal(error?.stage, "validate.project");
    assert.match(
      String(error?.message),
      /skipInstall=true requires an existing node_modules directory/i,
    );
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server resolves submit brandTheme and generationLocale overrides over server defaults", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    brandTheme: "sparkasse",
    generationLocale: "de-DE",
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const submitResponse = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key",
        figmaAccessToken: "figd_xxx",
        brandTheme: "derived",
        generationLocale: " EN-us ",
        formHandlingMode: "legacy_use_state",
        figmaSourceMode: "rest",
        llmCodegenMode: " Deterministic ",
      },
    });

    assert.equal(submitResponse.statusCode, 202);
    const submitBody = submitResponse.json<Record<string, unknown>>();
    const jobId = String(submitBody.jobId);
    const finalStatus = await waitForJobTerminalState({
      server,
      jobId,
      timeoutMs: 120_000,
    });
    const request = finalStatus.request as Record<string, unknown>;

    assert.equal(finalStatus.status, "completed");
    assert.equal(request.brandTheme, "derived");
    assert.equal(request.generationLocale, "en-US");
    assert.equal(request.formHandlingMode, "legacy_use_state");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server applies hash router runtime mode to generated App shell", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    routerMode: "hash",
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const submitResponse = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });

    assert.equal(submitResponse.statusCode, 202);
    const submitBody = submitResponse.json<Record<string, unknown>>();
    const jobId = String(submitBody.jobId);
    const finalStatus = await waitForJobTerminalState({
      server,
      jobId,
      timeoutMs: 120_000,
    });
    assert.equal(finalStatus.status, "completed");

    const appPath = path.join(
      outputRoot,
      "jobs",
      jobId,
      "generated-app",
      "src",
      "App.tsx",
    );
    const appContent = await readFile(appPath, "utf8");
    assert.ok(appContent.includes("HashRouter"));
    assert.equal(appContent.includes("BrowserRouter"), false);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server exposes listening address metadata and clears it after close", async () => {
  const outputRoot = await createTempOutputRoot();
  const server = await createWorkspaceServer({
    port: 0,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  const addressesBeforeClose = server.app.addresses();
  assert.equal(addressesBeforeClose.length > 0, true);
  assert.equal(addressesBeforeClose[0]?.port, server.port);

  await server.app.close();

  const addressesAfterClose = server.app.addresses();
  assert.equal(addressesAfterClose.length, 0);
  await rm(outputRoot, { recursive: true, force: true });
});

test("workspace server close is idempotent after shutdown", async () => {
  const outputRoot = await createTempOutputRoot();
  const server = await createWorkspaceServer({
    port: 0,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });
  await server.app.close();
  await server.app.close();
  await rm(outputRoot, { recursive: true, force: true });
});

test("workspace server returns JOB_NOT_FOUND for unknown job ids", async () => {
  const outputRoot = await createTempOutputRoot();
  const server = await createWorkspaceServer({
    port: 0,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "GET",
      url: "/workspace/jobs/does-not-exist",
    });

    assert.equal(response.statusCode, 404);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "JOB_NOT_FOUND");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server cancels queued jobs through POST /workspace/jobs/:id/cancel", async () => {
  const outputRoot = await createTempOutputRoot();
  const server = await createWorkspaceServer({
    port: 0,
    host: "127.0.0.1",
    outputRoot,
    maxConcurrentJobs: 1,
    maxQueuedJobs: 2,
    fetchImpl: createNeverEndingCancelableFetch(),
  });

  try {
    const firstSubmit = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key-1",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });
    assert.equal(firstSubmit.statusCode, 202);
    const firstJobId = String(
      firstSubmit.json<Record<string, unknown>>().jobId,
    );

    const secondSubmit = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key-2",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });
    assert.equal(secondSubmit.statusCode, 202);
    const secondJobId = String(
      secondSubmit.json<Record<string, unknown>>().jobId,
    );

    const cancelResponse = await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${secondJobId}/cancel`,
      headers: { "content-type": "application/json" },
      payload: {
        reason: "User canceled queued job.",
      },
    });
    assert.equal(cancelResponse.statusCode, 202);
    const canceledBody = cancelResponse.json<Record<string, unknown>>();
    assert.equal(canceledBody.status, "canceled");

    const canceledStatus = await waitForJobTerminalState({
      server,
      jobId: secondJobId,
      timeoutMs: 20_000,
    });
    assert.equal(canceledStatus.status, "canceled");

    await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${firstJobId}/cancel`,
      headers: { "content-type": "application/json" },
      payload: {
        reason: "cleanup",
      },
    });
    const firstTerminal = await waitForJobTerminalState({
      server,
      jobId: firstJobId,
      timeoutMs: 20_000,
    });
    assert.equal(firstTerminal.status, "canceled");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server returns 429 backpressure when queue limit is reached", async () => {
  const outputRoot = await createTempOutputRoot();
  const server = await createWorkspaceServer({
    port: 0,
    host: "127.0.0.1",
    outputRoot,
    maxConcurrentJobs: 1,
    maxQueuedJobs: 1,
    fetchImpl: createNeverEndingCancelableFetch(),
  });

  try {
    const firstSubmit = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key-1",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });
    assert.equal(firstSubmit.statusCode, 202);
    const firstJobId = String(
      firstSubmit.json<Record<string, unknown>>().jobId,
    );

    const secondSubmit = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key-2",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });
    assert.equal(secondSubmit.statusCode, 202);
    const secondJobId = String(
      secondSubmit.json<Record<string, unknown>>().jobId,
    );

    const thirdSubmit = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key-3",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });
    assert.equal(thirdSubmit.statusCode, 429);
    const backpressureBody = thirdSubmit.json<Record<string, unknown>>();
    assert.equal(backpressureBody.error, "QUEUE_BACKPRESSURE");

    await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${firstJobId}/cancel`,
      headers: { "content-type": "application/json" },
      payload: {
        reason: "cleanup",
      },
    });
    await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${secondJobId}/cancel`,
      headers: { "content-type": "application/json" },
      payload: {
        reason: "cleanup",
      },
    });

    const firstTerminal = await waitForJobTerminalState({
      server,
      jobId: firstJobId,
      timeoutMs: 20_000,
    });
    assert.equal(firstTerminal.status, "canceled");

    const secondTerminal = await waitForJobTerminalState({
      server,
      jobId: secondJobId,
      timeoutMs: 20_000,
    });
    assert.equal(secondTerminal.status, "canceled");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server returns 429 rate limiting with Retry-After on repeated submits", async () => {
  const outputRoot = await createTempOutputRoot();
  const server = await createWorkspaceServer({
    port: 0,
    host: "127.0.0.1",
    outputRoot,
    rateLimitPerMinute: 1,
    fetchImpl: createNeverEndingCancelableFetch(),
  });

  try {
    const firstSubmit = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key-1",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });
    assert.equal(firstSubmit.statusCode, 202);
    const firstJobId = String(
      firstSubmit.json<Record<string, unknown>>().jobId,
    );

    const secondSubmit = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key-2",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });
    assert.equal(secondSubmit.statusCode, 429);
    assert.match(secondSubmit.headers["retry-after"] ?? "", /^\d+$/);
    assert.equal(
      secondSubmit.json<Record<string, unknown>>().error,
      "RATE_LIMIT_EXCEEDED",
    );

    await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${firstJobId}/cancel`,
      headers: { "content-type": "application/json" },
      payload: {
        reason: "cleanup",
      },
    });
    const terminal = await waitForJobTerminalState({
      server,
      jobId: firstJobId,
      timeoutMs: 20_000,
    });
    assert.equal(terminal.status, "canceled");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// figma_paste mode integration tests
// ---------------------------------------------------------------------------

test("workspace server accepts figma_paste submit and returns 202 with jobId", async () => {
  const { root, workspaceRoot, outputRoot } = await createTempWorkspaceLayout();
  const port = allocateTestPort();
  await mkdir(workspaceRoot, { recursive: true });
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    workDir: workspaceRoot,
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const payload = JSON.stringify(createLocalFigmaPayload());
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: payload,
      },
    });

    assert.equal(response.statusCode, 202);
    const body = response.json<Record<string, unknown>>();
    assert.ok(typeof body.jobId === "string" && body.jobId.length > 0);
    const terminal = await waitForJobTerminalState({
      server,
      jobId: String(body.jobId),
      timeoutMs: 30_000,
    });
    assert.equal(terminal.status, "completed");
  } finally {
    await server.app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace server accepts figma_plugin submit and returns 202 with jobId", async () => {
  const { root, workspaceRoot, outputRoot } = await createTempWorkspaceLayout();
  const port = allocateTestPort();
  await mkdir(workspaceRoot, { recursive: true });
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    workDir: workspaceRoot,
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const payload = JSON.stringify({
      kind: "workspace-dev/figma-selection@1",
      pluginVersion: "0.1.0",
      copiedAt: "2026-04-12T18:00:00.000Z",
      selections: [
        {
          document: { id: "1:2", type: "FRAME", name: "Card" },
          components: {},
          componentSets: {},
          styles: {},
        },
      ],
    });
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_plugin",
        figmaJsonPayload: payload,
      },
    });

    assert.equal(response.statusCode, 202);
    const body = response.json<Record<string, unknown>>();
    assert.ok(typeof body.jobId === "string" && body.jobId.length > 0);
    const terminal = await waitForJobTerminalState({
      server,
      jobId: String(body.jobId),
      timeoutMs: 30_000,
    });
    assert.equal(terminal.status, "completed");
    assert.ok(typeof terminal.artifacts?.figmaJsonFile === "string");
    const figmaJson = await readFile(
      terminal.artifacts?.figmaJsonFile as string,
      "utf8",
    );
    const parsed = JSON.parse(figmaJson) as Record<string, unknown>;
    assert.ok(parsed.document !== undefined);
  } finally {
    await server.app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace server accepts a whole-view-sized figma_paste submit under the route caps", async () => {
  const { root, workspaceRoot, outputRoot } = await createTempWorkspaceLayout();
  const port = allocateTestPort();
  await mkdir(workspaceRoot, { recursive: true });
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    workDir: workspaceRoot,
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const payload = JSON.stringify({
      ...createLocalFigmaPayload(),
      name: "Whole View",
      filler: "a".repeat(5 * 1024 * 1024),
    });
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: payload,
      },
    });

    assert.equal(response.statusCode, 202);
    const body = response.json<Record<string, unknown>>();
    assert.ok(typeof body.jobId === "string" && body.jobId.length > 0);
    const terminal = await waitForJobTerminalState({
      server,
      jobId: String(body.jobId),
      timeoutMs: 30_000,
    });
    assert.equal(terminal.status, "completed");
  } finally {
    await server.app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace server returns 400 UNSUPPORTED_FORMAT on figma_plugin with unknown envelope kind", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-plugin-unsupported-format",
      },
      payload: {
        figmaSourceMode: "figma_plugin",
        figmaJsonPayload: JSON.stringify({
          kind: "workspace-dev/figma-selection@99",
          pluginVersion: "0.1.0",
          copiedAt: "2026-04-12T18:00:00.000Z",
          selections: [
            {
              document: { id: "1:2", type: "FRAME", name: "Card" },
              components: {},
              componentSets: {},
              styles: {},
            },
          ],
        }),
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "UNSUPPORTED_FORMAT");
    assert.equal(body.requestId, "req-plugin-unsupported-format");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server returns 400 SCHEMA_MISMATCH on figma_paste with malformed JSON payload", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-schema-json",
      },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: "{ not: valid json }",
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "SCHEMA_MISMATCH");
    assert.equal(body.requestId, "req-schema-json");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server returns 400 SCHEMA_MISMATCH on figma_paste with structurally invalid payload", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-schema-structural",
      },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: JSON.stringify({ name: "bad-payload" }),
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "SCHEMA_MISMATCH");
    assert.equal(body.requestId, "req-schema-structural");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server returns 400 TOO_LARGE on figma_paste with oversize payload", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    // Between the 6 MiB figma-paste cap and the 8 MiB transport cap → schema
    // rejects with TOO_LARGE (HTTP 400).
    const oversizePayload = "x".repeat(DEFAULT_FIGMA_PASTE_MAX_BYTES + 1);
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-schema-too-large",
      },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: oversizePayload,
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "TOO_LARGE");
    assert.equal(body.requestId, "req-schema-too-large");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server returns 413 TOO_LARGE when submit body exceeds transport cap", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    // Build a raw body that exceeds MAX_SUBMIT_BODY_BYTES (8 MiB).
    const filler = "x".repeat(MAX_SUBMIT_BODY_BYTES + 1024);
    const rawPayload = JSON.stringify({
      figmaSourceMode: "figma_paste",
      figmaJsonPayload: filler,
    });
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-oversize-body",
      },
      payload: rawPayload,
    });

    assert.equal(response.statusCode, 413);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "TOO_LARGE");
    assert.equal(body.maxBytes, MAX_SUBMIT_BODY_BYTES);
    assert.equal(body.requestId, "req-oversize-body");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server preserves 1 MiB body cap on non-submit write routes", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    // 1.5 MiB body on a non-submit write route must still be rejected
    // with the legacy VALIDATION_ERROR/400 envelope (regression guard for #998).
    const filler = "x".repeat(1_500_000);
    const rawPayload = JSON.stringify({ draftNodeIds: [filler] });
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/jobs/job-does-not-exist/stale-check",
      headers: { "content-type": "application/json" },
      payload: rawPayload,
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "VALIDATION_ERROR");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server cleans up figma_paste temp files when submit hits queue backpressure", async () => {
  const outputRoot = await createTempOutputRoot();
  const server = await createWorkspaceServer({
    port: 0,
    host: "127.0.0.1",
    outputRoot,
    maxConcurrentJobs: 1,
    maxQueuedJobs: 1,
    fetchImpl: createNeverEndingCancelableFetch(),
  });

  try {
    const firstSubmit = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key-1",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });
    assert.equal(firstSubmit.statusCode, 202);
    const firstJobId = String(
      firstSubmit.json<Record<string, unknown>>().jobId,
    );

    const secondSubmit = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key-2",
        figmaAccessToken: "figd_xxx",
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });
    assert.equal(secondSubmit.statusCode, 202);
    const secondJobId = String(
      secondSubmit.json<Record<string, unknown>>().jobId,
    );

    const thirdSubmit = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: JSON.stringify(createLocalFigmaPayload()),
      },
    });
    assert.equal(thirdSubmit.statusCode, 429);
    assert.equal(
      thirdSubmit.json<Record<string, unknown>>().error,
      "QUEUE_BACKPRESSURE",
    );

    const pasteTempDir = path.join(outputRoot, "tmp-figma-paste");
    const tempEntries = await readdir(pasteTempDir).catch(() => []);
    assert.deepEqual(tempEntries, []);

    await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${firstJobId}/cancel`,
      headers: { "content-type": "application/json" },
      payload: {
        reason: "cleanup",
      },
    });
    await server.app.inject({
      method: "POST",
      url: `/workspace/jobs/${secondJobId}/cancel`,
      headers: { "content-type": "application/json" },
      payload: {
        reason: "cleanup",
      },
    });

    const firstTerminal = await waitForJobTerminalState({
      server,
      jobId: firstJobId,
      timeoutMs: 20_000,
    });
    assert.equal(firstTerminal.status, "canceled");

    const secondTerminal = await waitForJobTerminalState({
      server,
      jobId: secondJobId,
      timeoutMs: 20_000,
    });
    assert.equal(secondTerminal.status, "canceled");
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server startup sweeps only stale tmp-figma-paste JSON files", async () => {
  const outputRoot = await createTempOutputRoot();
  const pasteTempDir = path.join(outputRoot, "tmp-figma-paste");
  const stalePath = path.join(pasteTempDir, "stale.json");
  const freshPath = path.join(pasteTempDir, "fresh.json");

  await mkdir(pasteTempDir, { recursive: true });
  await writeFile(stalePath, '{"kind":"stale"}\n', "utf8");
  await writeFile(freshPath, '{"kind":"fresh"}\n', "utf8");

  const staleDate = new Date(Date.now() - 48 * 60 * 60_000);
  const freshDate = new Date(Date.now() - 60 * 60_000);
  await utimes(stalePath, staleDate, staleDate);
  await utimes(freshPath, freshDate, freshDate);

  const server = await createWorkspaceServer({
    port: allocateTestPort(),
    host: "127.0.0.1",
    outputRoot,
    figmaPasteTempTtlMs: 24 * 60 * 60_000,
  });

  try {
    const tempEntries = await readdir(pasteTempDir);
    assert.deepEqual(tempEntries.sort(), ["fresh.json"]);
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("workspace server existing modes still work after figma_paste addition", async () => {
  const outputRoot = await createTempOutputRoot();
  const port = allocateTestPort();
  const server = await createWorkspaceServer({
    port,
    host: "127.0.0.1",
    outputRoot,
    fetchImpl: createFakeFigmaFetch(),
  });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "hybrid",
        figmaFileKey: "test-key",
        figmaAccessToken: "figd_xxx",
      },
    });

    assert.equal(response.statusCode, 202);
    const body = response.json<Record<string, unknown>>();
    const acceptedModes = body.acceptedModes as Record<string, unknown>;
    assert.equal(acceptedModes.figmaSourceMode, "hybrid");
    await waitForJobTerminalState({
      server,
      jobId: String(body.jobId),
      timeoutMs: 30_000,
    });
  } finally {
    await server.app.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
});
