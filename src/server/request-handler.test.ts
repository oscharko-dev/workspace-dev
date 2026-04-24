import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp, type WorkspaceServerApp } from "./app-inject.js";
import { createWorkspaceRequestHandler } from "./request-handler.js";
import { DEFAULT_FIGMA_PASTE_MAX_SELECTION_COUNT } from "../clipboard-envelope.js";
import { DEFAULT_FIGMA_PASTE_MAX_ROOT_COUNT } from "../figma-payload-validation.js";
import { LocalSyncError } from "../job-engine/local-sync.js";
import type { JobEngine } from "../job-engine.js";
import type {
  WorkspaceRuntimeLogInput,
  WorkspaceRuntimeLogger,
} from "../logging.js";
import { TEST_INTELLIGENCE_ENV } from "../contracts/index.js";

const pasteFixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../integration/fixtures/figma-paste-pipeline",
);

function readPasteFixture<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(path.join(pasteFixtureRoot, relativePath), "utf8"),
  ) as T;
}

function createCodedError(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Error & { code: string } {
  return Object.assign(new Error(message), { code, ...extra });
}

function createStubJobEngine(overrides: Partial<JobEngine> = {}): JobEngine {
  return {
    submitJob: () =>
      ({
        jobId: "job-accepted",
        status: "queued",
        acceptedModes: {
          figmaSourceMode: "rest",
          llmCodegenMode: "deterministic",
        },
      }) as ReturnType<JobEngine["submitJob"]>,
    submitRegeneration: () =>
      ({
        jobId: "regen-job",
        sourceJobId: "source-job",
        status: "queued",
        acceptedModes: {
          figmaSourceMode: "rest",
          llmCodegenMode: "deterministic",
        },
      }) as ReturnType<JobEngine["submitRegeneration"]>,
    submitRetry: () =>
      ({
        jobId: "retry-job",
        sourceJobId: "source-job",
        retryStage: "codegen.generate",
        status: "queued",
        acceptedModes: {
          figmaSourceMode: "rest",
          llmCodegenMode: "deterministic",
        },
      }) as ReturnType<JobEngine["submitRetry"]>,
    createPrFromJob: async () =>
      ({
        status: "executed",
        branchName: "auto/figma/demo",
        scopePath: "generated/demo",
        changedFiles: [],
      }) as Awaited<ReturnType<JobEngine["createPrFromJob"]>>,
    previewLocalSync: async () =>
      ({
        confirmationToken: "preview-token",
        files: [],
        summary: { totalFiles: 0 },
      }) as Awaited<ReturnType<JobEngine["previewLocalSync"]>>,
    applyLocalSync: async () =>
      ({
        applied: true,
      }) as Awaited<ReturnType<JobEngine["applyLocalSync"]>>,
    cancelJob: () =>
      ({
        jobId: "job-1",
        status: "canceled",
        cancellation: { reason: "cleanup" },
      }) as ReturnType<JobEngine["cancelJob"]>,
    cancelAllJobs: () => [],
    shutdown: async () => ({ completed: true, remainingJobIds: [] }),
    getJob: () => undefined,
    getJobResult: () => undefined,
    getJobRecord: () => undefined,
    resolvePreviewAsset: () => undefined,
    checkStaleDraft: async () =>
      ({
        stale: false,
        sourceJobId: "job-1",
        latestJobId: null,
      }) as Awaited<ReturnType<JobEngine["checkStaleDraft"]>>,
    suggestRemaps: async () =>
      ({
        sourceJobId: "job-a",
        latestJobId: "job-b",
        suggestions: [],
        rejections: [],
        message: "No remaps",
      }) as Awaited<ReturnType<JobEngine["suggestRemaps"]>>,
    listImportSessions: async () => [],
    reimportImportSession: async ({ sessionId }) =>
      ({
        jobId: "reimport-job",
        sessionId,
        sourceJobId: "source-job",
        status: "queued",
        acceptedModes: {
          figmaSourceMode: "hybrid",
          llmCodegenMode: "deterministic",
        },
      }) as Awaited<ReturnType<JobEngine["reimportImportSession"]>>,
    deleteImportSession: async ({ sessionId }) =>
      ({
        sessionId,
        deleted: true,
        jobId: "job-accepted",
      }) as Awaited<ReturnType<JobEngine["deleteImportSession"]>>,
    listImportSessionEvents: async () =>
      [] as Awaited<ReturnType<JobEngine["listImportSessionEvents"]>>,
    approveImportSession: async ({ sessionId }) =>
      ({
        id: "approved-event-id",
        sessionId,
        kind: "approved",
        at: "2026-04-15T10:00:00.000Z",
      }) as Awaited<ReturnType<JobEngine["approveImportSession"]>>,
    appendImportSessionEvent: async ({ event }) =>
      ({
        id: event.id.length > 0 ? event.id : "generated-event-id",
        sessionId: event.sessionId,
        kind: event.kind,
        at: event.at.length > 0 ? event.at : "2026-04-15T10:00:00.000Z",
        ...(event.actor !== undefined ? { actor: event.actor } : {}),
        ...(event.note !== undefined ? { note: event.note } : {}),
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
      }) as Awaited<ReturnType<JobEngine["appendImportSessionEvent"]>>,
    ...overrides,
  } as unknown as JobEngine;
}

function createStubLogger(
  overrides: Partial<WorkspaceRuntimeLogger> = {},
): WorkspaceRuntimeLogger {
  return {
    log: () => {},
    ...overrides,
  };
}

const TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN =
  "test-import-session-event-bearer-token";

const createImportSessionEventAuthHeaders = (
  token: string = TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

async function createRequestHandlerApp({
  jobEngine = createStubJobEngine(),
  moduleDir = path.resolve(import.meta.dirname ?? ".", ".."),
  rateLimitPerMinute = 10,
  logger = createStubLogger(),
  importSessionEventBearerToken,
  testIntelligenceEnabled,
  workspaceRoot,
  outputRoot,
  getServerLifecycleState,
}: {
  jobEngine?: JobEngine;
  moduleDir?: string;
  rateLimitPerMinute?: number;
  logger?: WorkspaceRuntimeLogger;
  importSessionEventBearerToken?: string;
  testIntelligenceEnabled?: boolean;
  workspaceRoot?: string;
  outputRoot?: string;
  getServerLifecycleState?: () => "starting" | "ready" | "draining" | "stopped";
} = {}): Promise<{
  app: WorkspaceServerApp;
  baseUrl: string;
  close: () => Promise<void>;
  tempRoot: string;
}> {
  const host = "127.0.0.1";
  const tempRoot =
    outputRoot ??
    (await mkdtemp(path.join(os.tmpdir(), "workspace-dev-request-handler-")));
  const ownsTempRoot = outputRoot === undefined;
  const resolvedWorkspaceRoot = workspaceRoot ?? tempRoot;
  let resolvedPort = 0;
  const handler = createWorkspaceRequestHandler({
    host,
    getResolvedPort: () => resolvedPort,
    startedAt: Date.now(),
    absoluteOutputRoot: tempRoot,
    workspaceRoot: resolvedWorkspaceRoot,
    defaults: { figmaSourceMode: "rest", llmCodegenMode: "deterministic" },
    runtime: {
      previewEnabled: false,
      rateLimitPerMinute,
      importSessionEventBearerToken,
      ...(testIntelligenceEnabled === undefined
        ? {}
        : { testIntelligenceEnabled }),
      logger,
    },
    ...(getServerLifecycleState ? { getServerLifecycleState } : {}),
    jobEngine,
    moduleDir,
  });

  const server = createServer((request, response) => {
    void handler(request, response).catch(() => {
      if (!response.writableEnded) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "INTERNAL_ERROR" }));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, host, () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolvedPort = address.port;
      }
      resolve();
    });
  });

  const app = buildApp({ server, host, port: resolvedPort });
  return {
    app,
    baseUrl: `http://${host}:${resolvedPort}`,
    close: async () => {
      await app.close();
      if (ownsTempRoot) {
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
    tempRoot,
  };
}

test("request handler returns UI_ASSETS_UNAVAILABLE when UI assets cannot be resolved", async () => {
  const { app, close, tempRoot } = await createRequestHandlerApp({
    moduleDir: path.join(os.tmpdir(), "workspace-dev-missing-ui-assets"),
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/workspace/ui/assets/main.js",
    });

    assert.equal(response.statusCode, 503);
    const body = response.json<Record<string, unknown>>();
    assert.deepEqual(body, {
      error: "UI_ASSETS_UNAVAILABLE",
      message: "workspace-dev UI assets are not available in this runtime.",
      requestId: response.headers["x-request-id"],
    });
  } finally {
    await close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("request handler returns null inspector policy when the file is absent", async () => {
  const { app, close } = await createRequestHandlerApp();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/workspace/inspector-policy",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json<Record<string, unknown>>(), {
      policy: null,
      validation: {
        state: "absent",
        diagnostics: [],
      },
    });
  } finally {
    await close();
  }
});

test("request handler returns the parsed inspector policy when the file is valid", async () => {
  const { app, close, tempRoot } = await createRequestHandlerApp();

  try {
    await writeFile(
      path.join(tempRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({
        quality: {
          maxAcceptableNodes: 8,
          riskSeverityOverrides: {
            "large-subtree": "high",
          },
        },
        tokens: {
          autoAcceptConfidence: 95,
        },
        a11y: {
          wcagLevel: "AAA",
          disabledRules: ["missing-h1"],
        },
        governance: {
          minQualityScoreToApply: 70,
          securitySensitivePatterns: ["password", "(auth)", "C++"],
          requireNoteOnOverride: false,
        },
      }),
      "utf8",
    );

    const response = await app.inject({
      method: "GET",
      url: "/workspace/inspector-policy",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json<Record<string, unknown>>(), {
      policy: {
        quality: {
          maxAcceptableNodes: 8,
          riskSeverityOverrides: {
            "large-subtree": "high",
          },
        },
        tokens: {
          autoAcceptConfidence: 95,
        },
        a11y: {
          wcagLevel: "AAA",
          disabledRules: ["missing-h1"],
        },
        governance: {
          minQualityScoreToApply: 70,
          securitySensitivePatterns: ["password", "(auth)", "C++"],
          requireNoteOnOverride: false,
        },
      },
      validation: {
        state: "loaded",
        diagnostics: [],
      },
    });
  } finally {
    await close();
  }
});

test("request handler lists persisted import sessions", async () => {
  const listImportSessions = test.mock.fn(
    async () =>
      [
        {
          id: "session-1",
          jobId: "job-1",
          sourceMode: "figma_url",
          fileKey: "file-key",
          nodeId: "1:2",
          nodeName: "Checkout",
          importedAt: "2026-04-15T10:00:00.000Z",
          nodeCount: 12,
          fileCount: 3,
          selectedNodes: [],
          scope: "all",
          componentMappings: 2,
          pasteIdentityKey: null,
          replayable: true,
        },
      ] as Awaited<ReturnType<JobEngine["listImportSessions"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ listImportSessions }),
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/workspace/import-sessions",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(listImportSessions.mock.callCount(), 1);
    assert.deepEqual(response.json<Record<string, unknown>>(), {
      sessions: [
        {
          id: "session-1",
          jobId: "job-1",
          sourceMode: "figma_url",
          fileKey: "file-key",
          nodeId: "1:2",
          nodeName: "Checkout",
          importedAt: "2026-04-15T10:00:00.000Z",
          nodeCount: 12,
          fileCount: 3,
          selectedNodes: [],
          scope: "all",
          componentMappings: 2,
          pasteIdentityKey: null,
          replayable: true,
        },
      ],
    });
  } finally {
    await close();
  }
});

test("request handler reimports persisted import sessions via POST", async () => {
  const reimportImportSession = test.mock.fn(
    async ({ sessionId }) =>
      ({
        jobId: "job-reimport",
        sessionId,
        sourceJobId: "job-1",
        status: "queued",
        acceptedModes: {
          figmaSourceMode: "hybrid",
          llmCodegenMode: "deterministic",
        },
      }) as Awaited<ReturnType<JobEngine["reimportImportSession"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ reimportImportSession }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/reimport",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: {},
    });

    assert.equal(response.statusCode, 202);
    assert.equal(reimportImportSession.mock.callCount(), 1);
    assert.deepEqual(reimportImportSession.mock.calls[0]?.arguments[0], {
      sessionId: "session-1",
    });
  } finally {
    await close();
  }
});

test("request handler POST /reimport returns 401 when bearer auth is missing", async () => {
  const reimportImportSession = test.mock.fn(
    async ({ sessionId }) =>
      ({
        jobId: "job-reimport",
        sessionId,
        sourceJobId: "job-1",
        status: "queued",
        acceptedModes: {
          figmaSourceMode: "hybrid",
          llmCodegenMode: "deterministic",
        },
      }) as Awaited<ReturnType<JobEngine["reimportImportSession"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ reimportImportSession }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/reimport",
      headers: { "content-type": "application/json" },
      payload: {},
    });

    assert.equal(response.statusCode, 401);
    assert.equal(
      response.headers["www-authenticate"],
      'Bearer realm="workspace-dev"',
    );
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "UNAUTHORIZED");
    assert.equal(reimportImportSession.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler POST /reimport returns 401 for invalid bearer tokens", async () => {
  const reimportImportSession = test.mock.fn(
    async ({ sessionId }) =>
      ({
        jobId: "job-reimport",
        sessionId,
        sourceJobId: "job-1",
        status: "queued",
        acceptedModes: {
          figmaSourceMode: "hybrid",
          llmCodegenMode: "deterministic",
        },
      }) as Awaited<ReturnType<JobEngine["reimportImportSession"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ reimportImportSession }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/reimport",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders("wrong-token"),
      },
      payload: {},
    });

    assert.equal(response.statusCode, 401);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "UNAUTHORIZED");
    assert.equal(reimportImportSession.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler POST /reimport returns 503 when server bearer auth is not configured", async () => {
  const reimportImportSession = test.mock.fn(
    async ({ sessionId }) =>
      ({
        jobId: "job-reimport",
        sessionId,
        sourceJobId: "job-1",
        status: "queued",
        acceptedModes: {
          figmaSourceMode: "hybrid",
          llmCodegenMode: "deterministic",
        },
      }) as Awaited<ReturnType<JobEngine["reimportImportSession"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ reimportImportSession }),
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/reimport",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: {},
    });

    assert.equal(response.statusCode, 503);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "AUTHENTICATION_UNAVAILABLE");
    assert.equal(reimportImportSession.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler POST /reimport rejects cookie-based auth", async () => {
  const reimportImportSession = test.mock.fn(
    async ({ sessionId }) =>
      ({
        jobId: "job-reimport",
        sessionId,
        sourceJobId: "job-1",
        status: "queued",
        acceptedModes: {
          figmaSourceMode: "hybrid",
          llmCodegenMode: "deterministic",
        },
      }) as Awaited<ReturnType<JobEngine["reimportImportSession"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ reimportImportSession }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/reimport",
      headers: {
        "content-type": "application/json",
        cookie: "workspace_import_session_event_auth=forbidden",
      },
      payload: {},
    });

    assert.equal(response.statusCode, 401);
    assert.equal(reimportImportSession.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler deletes persisted import sessions via DELETE", async () => {
  const deleteImportSession = test.mock.fn(
    async ({ sessionId }) =>
      ({
        sessionId,
        deleted: true,
        jobId: "job-1",
      }) as Awaited<ReturnType<JobEngine["deleteImportSession"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ deleteImportSession }),
  });

  try {
    const response = await app.inject({
      method: "DELETE",
      url: "/workspace/import-sessions/session-1",
      headers: { "content-type": "application/json" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(deleteImportSession.mock.callCount(), 1);
    assert.deepEqual(deleteImportSession.mock.calls[0]?.arguments[0], {
      sessionId: "session-1",
    });
  } finally {
    await close();
  }
});

const makeListedImportSession = (id: string) =>
  ({
    id,
    jobId: "job-1",
    sourceMode: "figma_url",
    fileKey: "file-key",
    nodeId: "1:2",
    nodeName: "Checkout",
    importedAt: "2026-04-15T10:00:00.000Z",
    nodeCount: 12,
    fileCount: 3,
    selectedNodes: [],
    scope: "all",
    componentMappings: 2,
    pasteIdentityKey: null,
    replayable: true,
  }) as Awaited<ReturnType<JobEngine["listImportSessions"]>>[number];

test("request handler GET /events returns the audit trail for an existing session", async () => {
  const listImportSessions = test.mock.fn(async () => [
    makeListedImportSession("session-1"),
  ]);
  const listImportSessionEvents = test.mock.fn(
    async () =>
      [
        {
          id: "event-1",
          sessionId: "session-1",
          kind: "imported",
          at: "2026-04-15T10:00:00.000Z",
        },
      ] as Awaited<ReturnType<JobEngine["listImportSessionEvents"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions,
      listImportSessionEvents,
    }),
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/workspace/import-sessions/session-1/events",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(listImportSessionEvents.mock.callCount(), 1);
    assert.deepEqual(listImportSessionEvents.mock.calls[0]?.arguments[0], {
      sessionId: "session-1",
    });
    assert.deepEqual(response.json<Record<string, unknown>>(), {
      events: [
        {
          id: "event-1",
          sessionId: "session-1",
          kind: "imported",
          at: "2026-04-15T10:00:00.000Z",
        },
      ],
    });
  } finally {
    await close();
  }
});

test("request handler GET /events returns 404 for an unknown session", async () => {
  const listImportSessionEvents = test.mock.fn(
    async () => [] as Awaited<ReturnType<JobEngine["listImportSessionEvents"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [],
      listImportSessionEvents,
    }),
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/workspace/import-sessions/missing-session/events",
    });

    assert.equal(response.statusCode, 404);
    assert.equal(listImportSessionEvents.mock.callCount(), 0);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "E_IMPORT_SESSION_NOT_FOUND");
  } finally {
    await close();
  }
});

test("request handler GET /approve returns 405", async () => {
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine(),
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/workspace/import-sessions/session-1/approve",
    });

    assert.equal(response.statusCode, 405);
    assert.equal(
      response.json<Record<string, unknown>>().error,
      "METHOD_NOT_ALLOWED",
    );
  } finally {
    await close();
  }
});

test("request handler POST /approve forwards browser approval to jobEngine", async () => {
  const approveImportSession = test.mock.fn(
    async ({ sessionId }) =>
      ({
        id: "approved-event-id",
        sessionId,
        kind: "approved",
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["approveImportSession"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      approveImportSession,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/approve",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: {},
    });

    assert.equal(response.statusCode, 200);
    assert.equal(approveImportSession.mock.callCount(), 1);
    assert.deepEqual(approveImportSession.mock.calls[0]?.arguments[0], {
      sessionId: "session-1",
    });
    assert.deepEqual(response.json<Record<string, unknown>>(), {
      id: "approved-event-id",
      sessionId: "session-1",
      kind: "approved",
      at: "2026-04-15T10:05:00.000Z",
    });
  } finally {
    await close();
  }
});

test("request handler POST /approve returns 409 for invalid approval history", async () => {
  const approveImportSession = test.mock.fn(async () => {
    const error = new Error(
      "Import session 'session-1' has invalid governance history.",
    );
    (error as Error & { code: string }).code =
      "E_IMPORT_SESSION_INVALID_TRANSITION";
    throw error;
  });
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      approveImportSession,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/approve",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: {},
    });

    assert.equal(response.statusCode, 409);
    assert.equal(
      response.json<Record<string, unknown>>().error,
      "E_IMPORT_SESSION_INVALID_TRANSITION",
    );
  } finally {
    await close();
  }
});

test("request handler POST /approve returns 401 when bearer auth is missing", async () => {
  const approveImportSession = test.mock.fn(
    async ({ sessionId }) =>
      ({
        id: "approved-event-id",
        sessionId,
        kind: "approved",
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["approveImportSession"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      approveImportSession,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/approve",
      headers: { "content-type": "application/json" },
      payload: {},
    });

    assert.equal(response.statusCode, 401);
    assert.equal(
      response.headers["www-authenticate"],
      'Bearer realm="workspace-dev"',
    );
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "UNAUTHORIZED");
    assert.equal(approveImportSession.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler POST /approve returns 401 for invalid bearer tokens", async () => {
  const approveImportSession = test.mock.fn(
    async ({ sessionId }) =>
      ({
        id: "approved-event-id",
        sessionId,
        kind: "approved",
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["approveImportSession"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      approveImportSession,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/approve",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders("wrong-token"),
      },
      payload: {},
    });

    assert.equal(response.statusCode, 401);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "UNAUTHORIZED");
    assert.equal(approveImportSession.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler POST /approve returns 503 when server bearer auth is not configured", async () => {
  const approveImportSession = test.mock.fn(
    async ({ sessionId }) =>
      ({
        id: "approved-event-id",
        sessionId,
        kind: "approved",
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["approveImportSession"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      approveImportSession,
    }),
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/approve",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: {},
    });

    assert.equal(response.statusCode, 503);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "AUTHENTICATION_UNAVAILABLE");
    assert.equal(approveImportSession.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler POST /approve rejects cookie-based auth", async () => {
  const approveImportSession = test.mock.fn(
    async ({ sessionId }) =>
      ({
        id: "approved-event-id",
        sessionId,
        kind: "approved",
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["approveImportSession"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      approveImportSession,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/approve",
      headers: {
        "content-type": "application/json",
        cookie: "workspace_import_session_event_auth=forbidden",
      },
      payload: {},
    });

    assert.equal(response.statusCode, 401);
    assert.equal(approveImportSession.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler POST /events ignores client actor and timestamp fields", async () => {
  const appendImportSessionEvent = test.mock.fn(
    async ({ event }) =>
      ({
        id: "stored-event",
        sessionId: event.sessionId,
        kind: event.kind,
        at: "2026-04-15T10:05:00.000Z",
        ...(event.actor !== undefined ? { actor: event.actor } : {}),
        ...(event.note !== undefined ? { note: event.note } : {}),
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
      }) as Awaited<ReturnType<JobEngine["appendImportSessionEvent"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      appendImportSessionEvent,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: {
        kind: "approved",
        actor: "reviewer@example.com",
        at: "1999-12-31T23:59:59.000Z",
        note: "looks good",
        metadata: { qualityScore: 90, reason: null, ok: true },
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(appendImportSessionEvent.mock.callCount(), 1);
    const callArg = appendImportSessionEvent.mock.calls[0]?.arguments[0];
    assert.equal(callArg?.event.sessionId, "session-1");
    assert.equal(callArg?.event.kind, "approved");
    assert.equal(callArg?.event.actor, undefined);
    assert.equal(callArg?.event.at, "");
    assert.equal(callArg?.event.note, "looks good");
    assert.deepEqual(callArg?.event.metadata, {
      qualityScore: 90,
      reason: null,
      ok: true,
    });

    assert.deepEqual(response.json<Record<string, unknown>>(), {
      id: "stored-event",
      sessionId: "session-1",
      kind: "approved",
      at: "2026-04-15T10:05:00.000Z",
      note: "looks good",
      metadata: { qualityScore: 90, reason: null, ok: true },
    });
  } finally {
    await close();
  }
});

test("request handler rejects cookie-based auth on POST /events", async () => {
  const appendImportSessionEvent = test.mock.fn(
    async ({ event }) =>
      ({
        id: "stored-event",
        sessionId: event.sessionId,
        kind: event.kind,
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["appendImportSessionEvent"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      appendImportSessionEvent,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: {
        "content-type": "application/json",
        cookie: "workspace_import_session_event_auth=forbidden",
      },
      payload: { kind: "approved" },
    });

    assert.equal(response.statusCode, 401);
    assert.equal(appendImportSessionEvent.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler POST /events returns 401 before reading the body when auth is missing", async () => {
  const capturedLogs: WorkspaceRuntimeLogInput[] = [];
  const appendImportSessionEvent = test.mock.fn(
    async ({ event }) =>
      ({
        id: "stored-event",
        sessionId: event.sessionId,
        kind: event.kind,
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["appendImportSessionEvent"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      appendImportSessionEvent,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
    logger: createStubLogger({
      log: (input) => {
        capturedLogs.push(input);
      },
    }),
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: { "content-type": "application/json" },
      payload: "{not-json",
    });

    assert.equal(response.statusCode, 401);
    assert.equal(
      response.headers["www-authenticate"],
      'Bearer realm="workspace-dev"',
    );
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "UNAUTHORIZED");
    assert.equal(
      JSON.stringify(body).includes(TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN),
      false,
    );
    assert.equal(
      JSON.stringify(capturedLogs).includes(
        TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
      ),
      false,
    );
    assert.equal(appendImportSessionEvent.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler POST /events returns 401 with no side effects when auth is invalid", async () => {
  const appendImportSessionEvent = test.mock.fn(
    async ({ event }) =>
      ({
        id: "stored-event",
        sessionId: event.sessionId,
        kind: event.kind,
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["appendImportSessionEvent"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      appendImportSessionEvent,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders("wrong-token"),
      },
      payload: { kind: "approved" },
    });

    assert.equal(response.statusCode, 401);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "UNAUTHORIZED");
    assert.equal(appendImportSessionEvent.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler POST /events returns 401 before reading the body when auth is invalid", async () => {
  const appendImportSessionEvent = test.mock.fn(
    async ({ event }) =>
      ({
        id: "stored-event",
        sessionId: event.sessionId,
        kind: event.kind,
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["appendImportSessionEvent"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      appendImportSessionEvent,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders("wrong-token"),
      },
      payload: "{not-json",
    });

    assert.equal(response.statusCode, 401);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "UNAUTHORIZED");
    assert.equal(appendImportSessionEvent.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler POST /events returns 503 when server auth is not configured", async () => {
  const appendImportSessionEvent = test.mock.fn(
    async ({ event }) =>
      ({
        id: "stored-event",
        sessionId: event.sessionId,
        kind: event.kind,
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["appendImportSessionEvent"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      appendImportSessionEvent,
    }),
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: { kind: "approved" },
    });

    assert.equal(response.statusCode, 503);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "AUTHENTICATION_UNAVAILABLE");
    assert.equal(appendImportSessionEvent.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler POST /events rate limits before parsing the body or appending the event", async () => {
  const appendImportSessionEvent = test.mock.fn(
    async ({ event }) =>
      ({
        id: "stored-event",
        sessionId: event.sessionId,
        kind: event.kind,
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["appendImportSessionEvent"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      appendImportSessionEvent,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
    rateLimitPerMinute: 1,
  });

  try {
    const accepted = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: { kind: "approved" },
    });
    assert.equal(accepted.statusCode, 201);

    const limited = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: "{",
    });
    assert.equal(limited.statusCode, 429);
    assert.match(limited.headers["retry-after"] ?? "", /^\d+$/);
    assert.equal(
      limited.json<Record<string, unknown>>().error,
      "RATE_LIMIT_EXCEEDED",
    );
    assert.equal(appendImportSessionEvent.mock.callCount(), 1);
  } finally {
    await close();
  }
});

test("request handler POST /approve rate limits before invoking approveImportSession", async () => {
  const approveImportSession = test.mock.fn(
    async ({ sessionId }) =>
      ({
        id: "approved-event-id",
        sessionId,
        kind: "approved",
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["approveImportSession"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      approveImportSession,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
    rateLimitPerMinute: 1,
  });

  try {
    const accepted = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/approve",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: {},
    });
    assert.equal(accepted.statusCode, 200);

    const limited = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/approve",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: {},
    });
    assert.equal(limited.statusCode, 429);
    assert.match(limited.headers["retry-after"] ?? "", /^\d+$/);
    assert.equal(
      limited.json<Record<string, unknown>>().error,
      "RATE_LIMIT_EXCEEDED",
    );
    assert.equal(approveImportSession.mock.callCount(), 1);
  } finally {
    await close();
  }
});

test("request handler POST /reimport rate limits before invoking reimportImportSession", async () => {
  const reimportImportSession = test.mock.fn(
    async ({ sessionId }) =>
      ({
        jobId: "job-reimport",
        sessionId,
        sourceJobId: "job-1",
        status: "queued",
        acceptedModes: {
          figmaSourceMode: "hybrid",
          llmCodegenMode: "deterministic",
        },
      }) as Awaited<ReturnType<JobEngine["reimportImportSession"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ reimportImportSession }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
    rateLimitPerMinute: 1,
  });

  try {
    const accepted = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/reimport",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: {},
    });
    assert.equal(accepted.statusCode, 202);

    const limited = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/reimport",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: {},
    });
    assert.equal(limited.statusCode, 429);
    assert.match(limited.headers["retry-after"] ?? "", /^\d+$/);
    assert.equal(
      limited.json<Record<string, unknown>>().error,
      "RATE_LIMIT_EXCEEDED",
    );
    assert.equal(reimportImportSession.mock.callCount(), 1);
  } finally {
    await close();
  }
});

test("request handler keeps import-session event writes out of the submission rate limit budget", async () => {
  const appendImportSessionEvent = test.mock.fn(
    async ({ event }) =>
      ({
        id: "stored-event",
        sessionId: event.sessionId,
        kind: event.kind,
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["appendImportSessionEvent"]>>,
  );
  const submitJob = test.mock.fn(() => {
    return {
      jobId: "job-accepted",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      appendImportSessionEvent,
      submitJob,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
    rateLimitPerMinute: 1,
  });

  try {
    const eventAccepted = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: { kind: "approved" },
    });
    assert.equal(eventAccepted.statusCode, 201);

    const submitAccepted = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      payload: {
        figmaFileKey: "file-key",
        figmaAccessToken: "token",
      },
    });
    assert.equal(submitAccepted.statusCode, 202);
    assert.equal(appendImportSessionEvent.mock.callCount(), 1);
    assert.equal(submitJob.mock.callCount(), 1);
  } finally {
    await close();
  }
});

test("request handler POST /events rejects invalid bodies with 422", async (t) => {
  const appendImportSessionEvent = test.mock.fn(
    async ({ event }) =>
      ({
        id: "stored-event",
        sessionId: event.sessionId,
        kind: event.kind,
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["appendImportSessionEvent"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      appendImportSessionEvent,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const scenarios = [
      {
        name: "missing kind",
        payload: { note: "missing kind" },
        expectedPath: "kind",
      },
      {
        name: "unknown kind",
        payload: { kind: "mystery" },
        expectedPath: "kind",
      },
      {
        name: "nested metadata",
        payload: {
          kind: "note",
          metadata: { nested: { inner: true } },
        },
        expectedPath: "metadata",
      },
    ] as const;

    for (const scenario of scenarios) {
      await t.test(scenario.name, async () => {
        const response = await app.inject({
          method: "POST",
          url: "/workspace/import-sessions/session-1/events",
          headers: {
            "content-type": "application/json",
            ...createImportSessionEventAuthHeaders(),
          },
          payload: scenario.payload,
        });

        assert.equal(response.statusCode, 422);
        const body = response.json<Record<string, unknown>>();
        assert.equal(body.error, "VALIDATION_ERROR");
        assert.equal(Array.isArray(body.issues), true);
        assert.equal(
          (body.issues as Array<Record<string, unknown>>)[0]?.path,
          scenario.expectedPath,
        );
      });
    }

    assert.equal(appendImportSessionEvent.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler POST /events returns 404 when the engine reports an unknown session", async () => {
  const appendImportSessionEvent = test.mock.fn(async () => {
    const error = new Error("Import session 'session-1' not found.");
    (error as Error & { code: string }).code = "E_IMPORT_SESSION_NOT_FOUND";
    throw error;
  });
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      appendImportSessionEvent,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: { kind: "applied" },
    });

    assert.equal(response.statusCode, 404);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "E_IMPORT_SESSION_NOT_FOUND");
  } finally {
    await close();
  }
});

test("request handler POST /events returns 409 for invalid governed transitions", async () => {
  const appendImportSessionEvent = test.mock.fn(async () => {
    const error = new Error(
      "Import session 'session-1' cannot append 'approved' while status is 'imported'.",
    );
    (error as Error & { code: string }).code =
      "E_IMPORT_SESSION_INVALID_TRANSITION";
    throw error;
  });
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
      appendImportSessionEvent,
    }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: { kind: "approved" },
    });

    assert.equal(response.statusCode, 409);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "E_IMPORT_SESSION_INVALID_TRANSITION");
  } finally {
    await close();
  }
});

test("request handler rejects DELETE on /events as an unknown write route", async () => {
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      listImportSessions: async () => [makeListedImportSession("session-1")],
    }),
  });

  try {
    const response = await app.inject({
      method: "DELETE",
      url: "/workspace/import-sessions/session-1/events",
      headers: { "content-type": "application/json" },
    });

    assert.equal(response.statusCode, 404);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "NOT_FOUND");
  } finally {
    await close();
  }
});

test("request handler returns rejected inspector policy diagnostics and logs an error", async (t) => {
  const capturedLogs: WorkspaceRuntimeLogInput[] = [];
  const logger = createStubLogger({
    log: (input) => {
      capturedLogs.push(input);
    },
  });
  const { app, close, tempRoot } = await createRequestHandlerApp({
    logger,
  });

  try {
    const invalidScenarios = [
      {
        name: "invalid json",
        contents: "{not-valid-json",
      },
      {
        name: "invalid shape",
        contents: JSON.stringify({
          quality: {
            bandThresholds: {
              excellent: "bad",
            },
          },
        }),
      },
    ] as const;

    for (const scenario of invalidScenarios) {
      await t.test(scenario.name, async () => {
        capturedLogs.length = 0;
        await writeFile(
          path.join(tempRoot, ".workspace-inspector-policy.json"),
          scenario.contents,
          "utf8",
        );

        const response = await app.inject({
          method: "GET",
          url: "/workspace/inspector-policy",
          headers: {
            "x-request-id": `req-inspector-policy-${scenario.name.replace(/\s+/g, "-")}`,
          },
        });

        assert.equal(response.statusCode, 200);
        const body = response.json<Record<string, unknown>>();
        assert.equal(body.policy, null);
        assert.equal(
          (body.validation as { state?: string } | undefined)?.state,
          "rejected",
        );
        assert.equal(typeof body.warning, "string");
        assert.ok(
          Array.isArray(
            (body.validation as { diagnostics?: unknown[] } | undefined)
              ?.diagnostics,
          ),
        );

        const warningLog = capturedLogs.find(
          (entry) => entry.event === "workspace.inspector_policy.invalid",
        );
        assert.equal(warningLog?.level, "error");
        assert.equal(warningLog?.method, "GET");
        assert.equal(warningLog?.path, "/workspace/inspector-policy");
        assert.equal(warningLog?.statusCode, 200);
        assert.match(
          String(warningLog?.message ?? ""),
          /Inspector policy '.workspace-inspector-policy.json'/,
        );
      });
    }
  } finally {
    await close();
  }
});

test("request handler returns salvaged inspector policy and logs dropped governance patterns", async () => {
  const capturedLogs: WorkspaceRuntimeLogInput[] = [];
  const logger = createStubLogger({
    log: (input) => {
      capturedLogs.push(input);
    },
  });
  const { app, close, tempRoot } = await createRequestHandlerApp({
    logger,
  });

  try {
    await writeFile(
      path.join(tempRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({
        governance: {
          minQualityScoreToApply: 70,
          securitySensitivePatterns: ["password", "auth.", "(auth)", "^admin$"],
          requireNoteOnOverride: false,
        },
      }),
      "utf8",
    );

    const response = await app.inject({
      method: "GET",
      url: "/workspace/inspector-policy",
      headers: {
        "x-request-id": "req-inspector-policy-dropped-patterns",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json<Record<string, unknown>>(), {
      policy: {
        governance: {
          minQualityScoreToApply: 70,
          securitySensitivePatterns: ["password", "(auth)"],
          requireNoteOnOverride: false,
        },
      },
      validation: {
        state: "degraded",
        diagnostics: [
          {
            severity: "warning",
            code: "regex_like_pattern_dropped",
            path: "governance.securitySensitivePatterns[1]",
            message:
              "Dropped regex-like governance pattern; only literal string matches are allowed.",
            valuePreview: '"auth."',
          },
          {
            severity: "warning",
            code: "regex_like_pattern_dropped",
            path: "governance.securitySensitivePatterns[3]",
            message:
              "Dropped regex-like governance pattern; only literal string matches are allowed.",
            valuePreview: '"^admin$"',
          },
        ],
      },
      warning:
        'Inspector policy \'.workspace-inspector-policy.json\' dropped regex-style governance.securitySensitivePatterns entries: [1] "auth.", [3] "^admin$".',
    });

    const warningLog = capturedLogs.find(
      (entry) => entry.event === "workspace.inspector_policy.invalid",
    );
    assert.equal(warningLog?.level, "warn");
    assert.equal(warningLog?.method, "GET");
    assert.equal(warningLog?.path, "/workspace/inspector-policy");
    assert.equal(warningLog?.statusCode, 200);
    assert.match(String(warningLog?.message ?? ""), /\[1\] "auth\."/);
    assert.match(String(warningLog?.message ?? ""), /\[3\] "\^admin\$"/);
  } finally {
    await close();
  }
});

test("request handler returns unknown-key diagnostics alongside regex-drop warnings", async () => {
  const capturedLogs: WorkspaceRuntimeLogInput[] = [];
  const logger = createStubLogger({
    log: (input) => {
      capturedLogs.push(input);
    },
  });
  const { app, close, tempRoot } = await createRequestHandlerApp({
    logger,
  });

  try {
    await writeFile(
      path.join(tempRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({
        governance: {
          securitySensitivePatterns: ["auth", "^admin$"],
          typoGovField: true,
        },
      }),
      "utf8",
    );

    const response = await app.inject({
      method: "GET",
      url: "/workspace/inspector-policy",
      headers: {
        "x-request-id": "req-inspector-policy-unknown-and-regex",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json<Record<string, unknown>>(), {
      policy: {
        governance: {
          securitySensitivePatterns: ["auth"],
        },
      },
      validation: {
        state: "degraded",
        diagnostics: [
          {
            severity: "warning",
            code: "unknown_key_ignored",
            path: "governance.typoGovField",
            message: "Ignored unknown inspector policy key.",
          },
          {
            severity: "warning",
            code: "regex_like_pattern_dropped",
            path: "governance.securitySensitivePatterns[1]",
            message:
              "Dropped regex-like governance pattern; only literal string matches are allowed.",
            valuePreview: '"^admin$"',
          },
        ],
      },
      warning:
        "Inspector policy '.workspace-inspector-policy.json' ignored unknown keys: \"governance.typoGovField\". Inspector policy '.workspace-inspector-policy.json' dropped regex-style governance.securitySensitivePatterns entries: [1] \"^admin$\".",
    });

    const warningLog = capturedLogs.find(
      (entry) => entry.event === "workspace.inspector_policy.invalid",
    );
    assert.equal(warningLog?.level, "warn");
    assert.match(String(warningLog?.message ?? ""), /ignored unknown keys/);
    assert.match(String(warningLog?.message ?? ""), /dropped regex-style/);
  } finally {
    await close();
  }
});

test("request handler validates cancel bodies before calling cancelJob", async (t) => {
  const cancelJob = test.mock.fn(() => undefined);
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ cancelJob }),
  });

  try {
    const scenarios = [
      {
        name: "rejects non-object bodies",
        payload: JSON.stringify("bad-body"),
        expectedPath: "(root)",
        expectedMessage:
          "Cancel request must be an object when body is provided.",
      },
      {
        name: "rejects unknown properties",
        payload: { unexpected: true },
        expectedPath: "unexpected",
        expectedMessage: "Unexpected property 'unexpected'.",
      },
      {
        name: "rejects blank reasons",
        payload: { reason: "   " },
        expectedPath: "reason",
        expectedMessage: "reason must be a non-empty string when provided.",
      },
    ] as const;

    for (const scenario of scenarios) {
      await t.test(scenario.name, async () => {
        const response = await app.inject({
          method: "POST",
          url: "/workspace/jobs/job-1/cancel",
          headers: { "content-type": "application/json" },
          payload: scenario.payload,
        });

        assert.equal(response.statusCode, 400);
        const body = response.json<Record<string, unknown>>();
        assert.equal(body.error, "VALIDATION_ERROR");
        assert.equal(Array.isArray(body.issues), true);
        assert.deepEqual((body.issues as Array<Record<string, unknown>>)[0], {
          path: scenario.expectedPath,
          message: scenario.expectedMessage,
        });
      });
    }

    assert.equal(cancelJob.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler isolates import-session write budgets by session for the same client IP", async () => {
  const appendImportSessionEvent = test.mock.fn(
    async ({ event }) =>
      ({
        id: "stored-event",
        sessionId: event.sessionId,
        kind: event.kind,
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["appendImportSessionEvent"]>>,
  );
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ appendImportSessionEvent }),
    importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
    rateLimitPerMinute: 1,
  });

  try {
    const firstSessionAccepted = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: { kind: "approved" },
    });
    assert.equal(firstSessionAccepted.statusCode, 201);

    const firstSessionLimited = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: { kind: "approved" },
    });
    assert.equal(firstSessionLimited.statusCode, 429);

    const secondSessionAccepted = await app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-2/events",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: { kind: "approved" },
    });
    assert.equal(secondSessionAccepted.statusCode, 201);
    assert.equal(appendImportSessionEvent.mock.callCount(), 2);
  } finally {
    await close();
  }
});

test("request handler preserves active import-session write buckets across handler recreation", async () => {
  const outputRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-request-handler-rate-limit-"),
  );
  const firstAppendImportSessionEvent = test.mock.fn(
    async ({ event }) =>
      ({
        id: "stored-event",
        sessionId: event.sessionId,
        kind: event.kind,
        at: "2026-04-15T10:05:00.000Z",
      }) as Awaited<ReturnType<JobEngine["appendImportSessionEvent"]>>,
  );
  let firstApp: Awaited<ReturnType<typeof createRequestHandlerApp>> | undefined;
  let secondApp:
    | Awaited<ReturnType<typeof createRequestHandlerApp>>
    | undefined;

  try {
    firstApp = await createRequestHandlerApp({
      jobEngine: createStubJobEngine({
        appendImportSessionEvent: firstAppendImportSessionEvent,
      }),
      importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
      rateLimitPerMinute: 1,
      outputRoot,
    });

    const accepted = await firstApp.app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: { kind: "approved" },
    });
    assert.equal(accepted.statusCode, 201);
    await firstApp.close();
    firstApp = undefined;

    const secondAppendImportSessionEvent = test.mock.fn(
      async ({ event }) =>
        ({
          id: "stored-event",
          sessionId: event.sessionId,
          kind: event.kind,
          at: "2026-04-15T10:05:00.000Z",
        }) as Awaited<ReturnType<JobEngine["appendImportSessionEvent"]>>,
    );
    secondApp = await createRequestHandlerApp({
      jobEngine: createStubJobEngine({
        appendImportSessionEvent: secondAppendImportSessionEvent,
      }),
      importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN,
      rateLimitPerMinute: 1,
      outputRoot,
    });

    const limited = await secondApp.app.inject({
      method: "POST",
      url: "/workspace/import-sessions/session-1/events",
      headers: {
        "content-type": "application/json",
        ...createImportSessionEventAuthHeaders(),
      },
      payload: { kind: "approved" },
    });
    assert.equal(limited.statusCode, 429);
    assert.match(limited.headers["retry-after"] ?? "", /^\d+$/);
    assert.equal(
      limited.json<Record<string, unknown>>().error,
      "RATE_LIMIT_EXCEEDED",
    );
    assert.equal(firstAppendImportSessionEvent.mock.callCount(), 1);
    assert.equal(secondAppendImportSessionEvent.mock.callCount(), 0);
  } finally {
    if (firstApp) {
      await firstApp.close();
    }
    if (secondApp) {
      await secondApp.close();
    }
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("request handler rate limits submit before parsing the body or calling submitJob", async () => {
  const submitJob = test.mock.fn(() => {
    return {
      jobId: "job-accepted",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
    rateLimitPerMinute: 1,
  });

  try {
    const accepted = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      payload: {
        figmaFileKey: "file-key",
        figmaAccessToken: "token",
      },
    });
    assert.equal(accepted.statusCode, 202);

    const limited = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    assert.equal(limited.statusCode, 429);
    assert.match(limited.headers["retry-after"] ?? "", /^\d+$/);
    assert.equal(
      limited.json<Record<string, unknown>>().error,
      "RATE_LIMIT_EXCEEDED",
    );
    assert.equal(submitJob.mock.callCount(), 1);
  } finally {
    await close();
  }
});

test("request handler submit preserves unicode escapes from the streaming parser", async () => {
  let capturedInput: Record<string, unknown> | undefined;
  const submitJob = test.mock.fn((input: Record<string, unknown>) => {
    capturedInput = input;
    return {
      jobId: "job-accepted",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload:
        '{"figmaFileKey":"\\u0061\\uD834\\uDD1E","figmaAccessToken":"token"}',
    });

    assert.equal(response.statusCode, 202);
    assert.equal(submitJob.mock.callCount(), 1);
    assert.equal(capturedInput?.figmaFileKey, "a𝄞");
  } finally {
    await close();
  }
});

test("request handler emits and echoes request IDs for successful responses", async () => {
  const { app, close } = await createRequestHandlerApp();

  try {
    const generatedResponse = await app.inject({
      method: "GET",
      url: "/workspace",
    });
    assert.equal(generatedResponse.statusCode, 200);
    assert.match(
      generatedResponse.headers["x-request-id"] ?? "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const echoedResponse = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: {
        "x-request-id": "req-upstream-healthz",
      },
    });
    assert.equal(echoedResponse.statusCode, 200);
    assert.equal(
      echoedResponse.headers["x-request-id"],
      "req-upstream-healthz",
    );
  } finally {
    await close();
  }
});

test("request handler reports lifecycle-aware health and readiness states", async () => {
  const scenarios = [
    {
      lifecycleState: "starting" as const,
      expectedHealthStatus: 200,
      expectedReadyStatus: 503,
      status: "starting",
    },
    {
      lifecycleState: "ready" as const,
      expectedHealthStatus: 200,
      expectedReadyStatus: 200,
      status: "ok",
    },
    {
      lifecycleState: "draining" as const,
      expectedHealthStatus: 200,
      expectedReadyStatus: 503,
      status: "draining",
    },
  ];

  for (const scenario of scenarios) {
    const { app, close } = await createRequestHandlerApp({
      getServerLifecycleState: () => scenario.lifecycleState,
    });

    try {
      const healthResponse = await app.inject({
        method: "GET",
        url: "/healthz",
      });
      assert.equal(healthResponse.statusCode, scenario.expectedHealthStatus);
      assert.deepEqual(healthResponse.json(), {
        status: scenario.status,
        uptime: 0,
      });

      const readyResponse = await app.inject({
        method: "GET",
        url: "/readyz",
      });
      assert.equal(readyResponse.statusCode, scenario.expectedReadyStatus);
      assert.deepEqual(readyResponse.json(), {
        status: scenario.status,
        uptime: 0,
      });
    } finally {
      await close();
    }
  }
});

test("request handler rejects mutating requests while draining and keeps read endpoints available", async () => {
  const { app, close } = await createRequestHandlerApp({
    getServerLifecycleState: () => "draining",
  });

  try {
    const readResponse = await app.inject({
      method: "GET",
      url: "/workspace",
    });
    assert.equal(readResponse.statusCode, 200);

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: {
        "content-type": "application/json",
      },
      payload: "{}",
    });
    assert.equal(response.statusCode, 503);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "SERVER_DRAINING");
    assert.equal(
      body.message,
      "Server is draining and not accepting new requests.",
    );
    assert.equal(typeof body.requestId, "string");
  } finally {
    await close();
  }
});

test("request handler rejects unsafe or oversized client-provided request IDs and generates a new UUID", async (t) => {
  const unsafeIds = [
    { name: "JSON-breaking characters", value: 'req","injected":"value' },
    { name: "oversized (129 chars)", value: "a".repeat(129) },
    { name: "spaces", value: "req id with spaces" },
    { name: "angle brackets", value: "req-<script>alert(1)</script>" },
    { name: "backtick", value: "req-`echo`-injection" },
    { name: "semicolons", value: "req;DROP TABLE logs;--" },
    { name: "equals and ampersand", value: "req=1&evil=2" },
  ];
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  for (const scenario of unsafeIds) {
    await t.test(`discards ${scenario.name}`, async () => {
      const { app, close } = await createRequestHandlerApp();

      try {
        const response = await app.inject({
          method: "GET",
          url: "/healthz",
          headers: {
            "x-request-id": scenario.value,
          },
        });

        assert.equal(response.statusCode, 200);
        assert.match(
          response.headers["x-request-id"] ?? "",
          uuidPattern,
          `Expected a generated UUID for unsafe input: ${scenario.name}`,
        );
        assert.notEqual(response.headers["x-request-id"], scenario.value);
      } finally {
        await close();
      }
    });
  }

  await t.test("accepts safe request IDs with allowed characters", async () => {
    const { app, close } = await createRequestHandlerApp();

    try {
      const safeIds = [
        "req-upstream-123",
        "trace_id:abc-def/ghi",
        "a".repeat(128),
        "my.service.request-42",
      ];

      for (const safeId of safeIds) {
        const response = await app.inject({
          method: "GET",
          url: "/healthz",
          headers: {
            "x-request-id": safeId,
          },
        });

        assert.equal(response.statusCode, 200);
        assert.equal(response.headers["x-request-id"], safeId);
      }
    } finally {
      await close();
    }
  });
});

test("request handler injects requestId into validation, security, and internal-error envelopes", async (t) => {
  await t.test("validation errors include requestId", async () => {
    const { app, close } = await createRequestHandlerApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/workspace/submit",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-validation-1",
        },
        payload: "{",
      });

      assert.equal(response.statusCode, 400);
      assert.equal(response.headers["x-request-id"], "req-validation-1");
      assert.equal(
        response.json<Record<string, unknown>>().requestId,
        "req-validation-1",
      );
    } finally {
      await close();
    }
  });

  await t.test("security errors include requestId", async () => {
    const { app, close } = await createRequestHandlerApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/workspace/submit",
        headers: {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
          "content-type": "application/json",
          "x-request-id": "req-security-1",
        },
        payload: JSON.stringify({
          figmaFileKey: "file-key",
          figmaAccessToken: "secret-token",
        }),
      });

      assert.equal(response.statusCode, 403);
      assert.equal(response.headers["x-request-id"], "req-security-1");
      assert.equal(
        response.json<Record<string, unknown>>().requestId,
        "req-security-1",
      );
    } finally {
      await close();
    }
  });

  await t.test("internal errors include requestId", async () => {
    const { app, close } = await createRequestHandlerApp({
      jobEngine: createStubJobEngine({
        submitJob: () => {
          throw new Error("submit failure");
        },
      }),
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/workspace/submit",
        headers: {
          "x-request-id": "req-internal-1",
        },
        payload: {
          figmaFileKey: "file-key",
          figmaAccessToken: "token",
        },
      });

      assert.equal(response.statusCode, 500);
      assert.equal(response.headers["x-request-id"], "req-internal-1");
      assert.equal(
        response.json<Record<string, unknown>>().requestId,
        "req-internal-1",
      );
    } finally {
      await close();
    }
  });
});

test("request handler emits request-scoped audit logs for covered write routes", async () => {
  const capturedLogs: WorkspaceRuntimeLogInput[] = [];
  const logger = createStubLogger({
    log: (input) => {
      capturedLogs.push(input);
    },
  });
  const { app, close } = await createRequestHandlerApp({
    logger,
    rateLimitPerMinute: 1,
  });

  try {
    const submitResponse = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: {
        "x-request-id": "req-submit-1",
      },
      payload: {
        figmaFileKey: "file-key",
        figmaAccessToken: "token",
        importIntent: "FIGMA_JSON_DOC",
        originalIntent: "RAW_CODE_OR_TEXT",
        intentCorrected: true,
      },
    });
    assert.equal(submitResponse.statusCode, 202);

    const cancelResponse = await app.inject({
      method: "POST",
      url: "/workspace/jobs/job-1/cancel",
      headers: {
        "x-request-id": "req-cancel-1",
      },
      payload: {
        reason: "cleanup",
      },
    });
    assert.equal(cancelResponse.statusCode, 202);

    const rateLimitedResponse = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: {
        "x-request-id": "req-rate-1",
      },
      payload: {
        figmaFileKey: "file-key",
        figmaAccessToken: "token",
      },
    });
    assert.equal(rateLimitedResponse.statusCode, 429);

    const rejectedResponse = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
        "x-request-id": "req-rejected-1",
      },
      payload: JSON.stringify({
        figmaFileKey: "file-key",
        figmaAccessToken: "token",
      }),
    });
    assert.equal(rejectedResponse.statusCode, 403);

    const submitLog = capturedLogs.find(
      (entry) => entry.event === "workspace.submit.accepted",
    );
    assert.deepEqual(submitLog, {
      level: "info",
      message:
        "Submission accepted as job 'job-accepted'. importIntent=FIGMA_JSON_DOC originalIntent=RAW_CODE_OR_TEXT (user-corrected)",
      requestId: "req-submit-1",
      event: "workspace.submit.accepted",
      method: "POST",
      path: "/workspace/submit",
      jobId: "job-accepted",
      statusCode: 202,
    });

    const cancelLog = capturedLogs.find(
      (entry) => entry.event === "workspace.cancel.accepted",
    );
    assert.deepEqual(cancelLog, {
      level: "info",
      message: "Cancellation accepted for job 'job-1'.",
      requestId: "req-cancel-1",
      event: "workspace.cancel.accepted",
      method: "POST",
      path: "/workspace/jobs/job-1/cancel",
      jobId: "job-1",
      statusCode: 202,
    });

    const rateLimitLog = capturedLogs.find(
      (entry) => entry.event === "security.request.rate_limited",
    );
    assert.equal(rateLimitLog?.level, "warn");
    assert.equal(rateLimitLog?.requestId, "req-rate-1");
    assert.equal(rateLimitLog?.event, "security.request.rate_limited");
    assert.equal(rateLimitLog?.method, "POST");
    assert.equal(rateLimitLog?.path, "/workspace/submit");
    assert.equal(rateLimitLog?.statusCode, 429);
    assert.match(
      String(rateLimitLog?.message ?? ""),
      /^Too many job submissions from this client\. Retry after \d+ seconds\.$/,
    );

    const rejectedLog = capturedLogs.find(
      (entry) => entry.event === "security.request.rejected_origin",
    );
    assert.deepEqual(rejectedLog, {
      level: "warn",
      message:
        "Cross-site browser requests to workspace-dev write routes are blocked.",
      requestId: "req-rejected-1",
      event: "security.request.rejected_origin",
      method: "POST",
      path: "/workspace/submit",
      statusCode: 403,
    });
  } finally {
    await close();
  }
});

test("request handler shares the submission rate limit between submit and regenerate routes", async () => {
  const submitJob = test.mock.fn(() => {
    return {
      jobId: "job-accepted",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });
  const submitRegeneration = test.mock.fn(() => {
    return {
      jobId: "regen-job",
      sourceJobId: "source-job",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitRegeneration"]>;
  });
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob, submitRegeneration }),
    rateLimitPerMinute: 1,
  });

  try {
    const accepted = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      payload: {
        figmaFileKey: "file-key",
        figmaAccessToken: "token",
      },
    });
    assert.equal(accepted.statusCode, 202);

    const limited = await app.inject({
      method: "POST",
      url: "/workspace/jobs/source-job/regenerate",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    assert.equal(limited.statusCode, 429);
    assert.match(limited.headers["retry-after"] ?? "", /^\d+$/);
    assert.equal(
      limited.json<Record<string, unknown>>().error,
      "RATE_LIMIT_EXCEEDED",
    );
    assert.equal(submitJob.mock.callCount(), 1);
    assert.equal(submitRegeneration.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler shares the submission rate limit between regenerate and retry-stage routes", async () => {
  const submitRegeneration = test.mock.fn(() => {
    return {
      jobId: "regen-job",
      sourceJobId: "source-job",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitRegeneration"]>;
  });
  const submitRetry = test.mock.fn(() => {
    return {
      jobId: "retry-job",
      sourceJobId: "source-job",
      retryStage: "codegen.generate",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitRetry"]>;
  });
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitRegeneration, submitRetry }),
    rateLimitPerMinute: 1,
  });

  try {
    const accepted = await app.inject({
      method: "POST",
      url: "/workspace/jobs/source-job/regenerate",
      payload: { overrides: [] },
    });
    assert.equal(accepted.statusCode, 202);

    const limited = await app.inject({
      method: "POST",
      url: "/workspace/jobs/source-job/retry-stage",
      payload: { retryStage: "codegen.generate" },
    });
    assert.equal(limited.statusCode, 429);
    assert.match(limited.headers["retry-after"] ?? "", /^\d+$/);
    assert.equal(
      limited.json<Record<string, unknown>>().error,
      "RATE_LIMIT_EXCEEDED",
    );
    assert.equal(submitRegeneration.mock.callCount(), 1);
    assert.equal(submitRetry.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler forwards normalized componentMappings on submit and regenerate", async () => {
  const submitJob = test.mock.fn(() => {
    return {
      jobId: "job-accepted",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });
  const submitRegeneration = test.mock.fn(() => {
    return {
      jobId: "regen-job",
      sourceJobId: "source-job",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitRegeneration"]>;
  });
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob, submitRegeneration }),
  });

  try {
    const submitResponse = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "file-key",
        figmaAccessToken: "token",
        componentMappings: [
          {
            boardKey: " board-1 ",
            nodeId: " button-node-1 ",
            componentName: " ManualButton ",
            importPath: " @manual/ui ",
            priority: 0,
            source: "local_override",
            enabled: true,
          },
        ],
      },
    });
    assert.equal(submitResponse.statusCode, 202);
    assert.equal(submitJob.mock.callCount(), 1);
    assert.deepEqual(submitJob.mock.calls[0]?.arguments[0]?.componentMappings, [
      {
        boardKey: "board-1",
        nodeId: "button-node-1",
        componentName: "ManualButton",
        importPath: "@manual/ui",
        priority: 0,
        source: "local_override",
        enabled: true,
      },
    ]);

    const regenerateResponse = await app.inject({
      method: "POST",
      url: "/workspace/jobs/source-job/regenerate",
      headers: { "content-type": "application/json" },
      payload: {
        overrides: [],
        componentMappings: [
          {
            boardKey: " board-1 ",
            canonicalComponentName: " Button ",
            semanticType: " button ",
            componentName: " PatternButton ",
            importPath: " @pattern/ui ",
            priority: 1,
            source: "code_connect_import",
            enabled: false,
          },
        ],
      },
    });
    assert.equal(regenerateResponse.statusCode, 202);
    assert.equal(submitRegeneration.mock.callCount(), 1);
    assert.deepEqual(
      submitRegeneration.mock.calls[0]?.arguments[0]?.componentMappings,
      [
        {
          boardKey: "board-1",
          canonicalComponentName: "Button",
          semanticType: "button",
          componentName: "PatternButton",
          importPath: "@pattern/ui",
          priority: 1,
          source: "code_connect_import",
          enabled: false,
        },
      ],
    );
  } finally {
    await close();
  }
});

test("request handler forwards selectedNodeIds on scoped submit requests", async () => {
  const submitJob = test.mock.fn(() => {
    return {
      jobId: "job-selected",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "hybrid",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "hybrid",
        figmaFileKey: "file-key",
        figmaAccessToken: "token",
        selectedNodeIds: ["frame-1", " child-2 "],
      },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(submitJob.mock.callCount(), 1);
    assert.deepEqual(submitJob.mock.calls[0]?.arguments[0]?.selectedNodeIds, [
      "frame-1",
      "child-2",
    ]);
  } finally {
    await close();
  }
});

test("request handler forwards retry-stage requests to jobEngine.submitRetry", async () => {
  const submitRetry = test.mock.fn(() => {
    return {
      jobId: "retry-job",
      sourceJobId: "source-job",
      retryStage: "codegen.generate",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitRetry"]>;
  });
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitRetry }),
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/jobs/source-job/retry-stage",
      payload: {
        retryStage: "codegen.generate",
        retryTargets: [" src/App.tsx ", "src/screens/Home.tsx"],
      },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(submitRetry.mock.callCount(), 1);
    assert.deepEqual(submitRetry.mock.calls[0]?.arguments[0], {
      sourceJobId: "source-job",
      retryStage: "codegen.generate",
      retryTargets: ["src/App.tsx", "src/screens/Home.tsx"],
    });
    assert.deepEqual(response.json<Record<string, unknown>>(), {
      jobId: "retry-job",
      sourceJobId: "source-job",
      retryStage: "codegen.generate",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
      },
    });
  } finally {
    await close();
  }
});

test("request handler forwards reviewerNote on local sync apply requests", async () => {
  const applyLocalSync = test.mock.fn(async () => {
    return {
      jobId: "job-1",
      sourceJobId: "source-job-1",
      boardKey: "board-key-1",
      targetPath: "apps/generated",
      scopePath: "apps/generated/board-key-1",
      destinationRoot: "/tmp/workspace/apps/generated/board-key-1",
      files: [],
      summary: {
        totalFiles: 0,
        selectedFiles: 0,
        createCount: 0,
        overwriteCount: 0,
        conflictCount: 0,
        untrackedCount: 0,
        unchangedCount: 0,
        totalBytes: 0,
        selectedBytes: 0,
      },
      appliedAt: "2026-04-16T10:00:00.000Z",
    } as Awaited<ReturnType<JobEngine["applyLocalSync"]>>;
  });
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ applyLocalSync }),
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/jobs/job-1/sync",
      payload: {
        mode: "apply",
        confirmationToken: "token-123",
        confirmOverwrite: true,
        fileDecisions: [{ path: "src/App.tsx", decision: "write" }],
        reviewerNote: "Approved during local sync.",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(applyLocalSync.mock.calls[0]?.arguments[0], {
      jobId: "job-1",
      confirmationToken: "token-123",
      confirmOverwrite: true,
      fileDecisions: [{ path: "src/App.tsx", decision: "write" }],
      reviewerNote: "Approved during local sync.",
    });
  } finally {
    await close();
  }
});

test("request handler maps local sync errors to deterministic HTTP envelopes", async (t) => {
  const dryRunScenarios = [
    {
      code: "E_SYNC_JOB_NOT_FOUND",
      statusCode: 404,
      error: "JOB_NOT_FOUND",
    },
    {
      code: "E_SYNC_TARGET_PATH_INVALID",
      statusCode: 400,
      error: "INVALID_TARGET_PATH",
      useLocalSyncError: true,
    },
    {
      code: "E_SYNC_GENERATED_DIR_MISSING",
      statusCode: 404,
      error: "SYNC_GENERATED_OUTPUT_NOT_FOUND",
      useLocalSyncError: true,
    },
  ] as const;

  for (const scenario of dryRunScenarios) {
    await t.test(`sync dry_run maps ${scenario.code}`, async () => {
      const previewLocalSync = async (): Promise<never> => {
        if (scenario.useLocalSyncError) {
          throw new LocalSyncError(scenario.code, `${scenario.code} message`);
        }
        throw createCodedError(scenario.code, `${scenario.code} message`);
      };

      const { app, close } = await createRequestHandlerApp({
        jobEngine: createStubJobEngine({ previewLocalSync }),
      });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/workspace/jobs/job-1/sync",
          payload: {
            mode: "dry_run",
            targetPath: "apps/generated",
          },
        });

        assert.equal(response.statusCode, scenario.statusCode);
        assert.equal(
          response.json<Record<string, unknown>>().error,
          scenario.error,
        );
      } finally {
        await close();
      }
    });
  }

  const applyScenarios = [
    ["E_SYNC_JOB_NOT_COMPLETED", 409, "SYNC_JOB_NOT_COMPLETED"],
    ["E_SYNC_REGEN_REQUIRED", 409, "SYNC_REGEN_REQUIRED"],
    ["E_SYNC_CONFIRMATION_REQUIRED", 409, "SYNC_CONFIRMATION_REQUIRED"],
    ["E_SYNC_CONFIRMATION_INVALID", 409, "SYNC_CONFIRMATION_INVALID"],
    ["E_SYNC_CONFIRMATION_EXPIRED", 409, "SYNC_CONFIRMATION_EXPIRED"],
    ["E_SYNC_PREVIEW_STALE", 409, "SYNC_PREVIEW_STALE"],
    ["E_SYNC_IMPORT_REVIEW_REQUIRED", 409, "SYNC_IMPORT_REVIEW_REQUIRED"],
    ["E_SYNC_FILE_DECISIONS_INVALID", 400, "SYNC_FILE_DECISIONS_INVALID"],
  ] as const;

  for (const [code, statusCode, expectedError] of applyScenarios) {
    await t.test(`sync apply maps ${code}`, async () => {
      const applyLocalSync = async (): Promise<never> => {
        if (code === "E_SYNC_FILE_DECISIONS_INVALID") {
          throw new LocalSyncError(code, `${code} message`);
        }
        throw createCodedError(code, `${code} message`);
      };

      const { app, close } = await createRequestHandlerApp({
        jobEngine: createStubJobEngine({ applyLocalSync }),
      });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/workspace/jobs/job-1/sync",
          payload: {
            mode: "apply",
            confirmationToken: "token-123",
            confirmOverwrite: true,
            fileDecisions: [{ path: "src/App.tsx", decision: "write" }],
          },
        });

        assert.equal(response.statusCode, statusCode);
        assert.equal(
          response.json<Record<string, unknown>>().error,
          expectedError,
        );
      } finally {
        await close();
      }
    });
  }

  const unsafeCodes = [
    "E_SYNC_DESTINATION_UNSAFE",
    "E_SYNC_DESTINATION_SYMLINK",
    "E_SYNC_DESTINATION_CONFLICT",
    "E_SYNC_SOURCE_SYMLINK",
  ] as const;

  for (const code of unsafeCodes) {
    await t.test(
      `sync apply maps ${code} to unsafe destination envelope`,
      async () => {
        const applyLocalSync = async (): Promise<never> => {
          throw new LocalSyncError(code, `${code} message`);
        };

        const { app, close } = await createRequestHandlerApp({
          jobEngine: createStubJobEngine({ applyLocalSync }),
        });

        try {
          const response = await app.inject({
            method: "POST",
            url: "/workspace/jobs/job-1/sync",
            payload: {
              mode: "apply",
              confirmationToken: "token-123",
              confirmOverwrite: true,
              fileDecisions: [{ path: "src/App.tsx", decision: "write" }],
            },
          });

          assert.equal(response.statusCode, 400);
          assert.equal(
            response.json<Record<string, unknown>>().error,
            "SYNC_DESTINATION_UNSAFE",
          );
        } finally {
          await close();
        }
      },
    );
  }
});

test("request handler maps regeneration and create-pr job-engine failures", async (t) => {
  const regenerationScenarios = [
    {
      code: "E_JOB_QUEUE_FULL",
      statusCode: 429,
      error: "QUEUE_BACKPRESSURE",
      extra: { queue: { runningCount: 1, queuedCount: 2 } },
    },
    {
      code: "E_REGEN_SOURCE_NOT_FOUND",
      statusCode: 404,
      error: "SOURCE_JOB_NOT_FOUND",
    },
    {
      code: "E_REGEN_SOURCE_NOT_COMPLETED",
      statusCode: 409,
      error: "SOURCE_JOB_NOT_COMPLETED",
    },
  ] as const;

  for (const scenario of regenerationScenarios) {
    await t.test(`regenerate maps ${scenario.code}`, async () => {
      const submitRegeneration = (): never => {
        throw createCodedError(
          scenario.code,
          `${scenario.code} message`,
          scenario.extra ?? {},
        );
      };
      const { app, close } = await createRequestHandlerApp({
        jobEngine: createStubJobEngine({ submitRegeneration }),
      });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/workspace/jobs/source-job/regenerate",
          payload: {
            overrides: [
              { nodeId: "node-1", field: "fillColor", value: "#ff0000" },
            ],
          },
        });

        assert.equal(response.statusCode, scenario.statusCode);
        assert.equal(
          response.json<Record<string, unknown>>().error,
          scenario.error,
        );
      } finally {
        await close();
      }
    });
  }

  const retryScenarios = [
    {
      code: "E_JOB_QUEUE_FULL",
      statusCode: 429,
      error: "QUEUE_BACKPRESSURE",
      extra: { queue: { runningCount: 1, queuedCount: 2 } },
    },
    {
      code: "E_RETRY_SOURCE_NOT_FOUND",
      statusCode: 404,
      error: "SOURCE_JOB_NOT_FOUND",
    },
    {
      code: "E_RETRY_SOURCE_NOT_FAILED",
      statusCode: 409,
      error: "SOURCE_JOB_NOT_RETRYABLE",
    },
    {
      code: "E_RETRY_STAGE_INVALID",
      statusCode: 400,
      error: "INVALID_RETRY_STAGE",
    },
    {
      code: "E_RETRY_TARGETS_INVALID",
      statusCode: 400,
      error: "INVALID_RETRY_TARGETS",
    },
  ] as const;

  for (const scenario of retryScenarios) {
    await t.test(`retry-stage maps ${scenario.code}`, async () => {
      const submitRetry = (): never => {
        throw createCodedError(
          scenario.code,
          `${scenario.code} message`,
          scenario.extra ?? {},
        );
      };
      const { app, close } = await createRequestHandlerApp({
        jobEngine: createStubJobEngine({ submitRetry }),
      });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/workspace/jobs/source-job/retry-stage",
          payload: {
            retryStage: "codegen.generate",
            retryTargets: ["src/App.tsx"],
          },
        });

        assert.equal(response.statusCode, scenario.statusCode);
        assert.equal(
          response.json<Record<string, unknown>>().error,
          scenario.error,
        );
      } finally {
        await close();
      }
    });
  }

  const createPrScenarios = [
    ["E_PR_JOB_NOT_FOUND", 404, "JOB_NOT_FOUND"],
    ["E_PR_JOB_NOT_COMPLETED", 409, "JOB_NOT_COMPLETED"],
    ["E_PR_NOT_REGENERATION_JOB", 409, "NOT_REGENERATION_JOB"],
    ["E_PR_NO_GENERATED_PROJECT", 409, "NO_GENERATED_PROJECT"],
    ["E_PR_IMPORT_REVIEW_REQUIRED", 409, "IMPORT_REVIEW_REQUIRED"],
  ] as const;

  for (const [code, statusCode, expectedError] of createPrScenarios) {
    await t.test(`create-pr maps ${code}`, async () => {
      const createPrFromJob = async (): Promise<never> => {
        throw createCodedError(code, `${code} message`);
      };

      const { app, close } = await createRequestHandlerApp({
        jobEngine: createStubJobEngine({ createPrFromJob }),
      });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/workspace/jobs/job-1/create-pr",
          payload: {
            repoUrl: "https://github.com/acme/repo.git",
            repoToken: "secret-token",
          },
        });

        assert.equal(response.statusCode, statusCode);
        assert.equal(
          response.json<Record<string, unknown>>().error,
          expectedError,
        );
      } finally {
        await close();
      }
    });
  }
});

test("request handler forwards reviewerNote on create-pr requests", async () => {
  const createPrFromJob = test.mock.fn(async () => {
    return {
      jobId: "job-1",
      sourceJobId: "source-job-1",
      gitPr: {
        status: "executed",
        branchName: "auto/figma/demo",
        scopePath: "generated/demo",
        changedFiles: [],
      },
    } as Awaited<ReturnType<JobEngine["createPrFromJob"]>>;
  });
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ createPrFromJob }),
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/jobs/job-1/create-pr",
      payload: {
        repoUrl: "https://github.com/acme/repo.git",
        repoToken: "secret-token",
        reviewerNote: "Approved for PR creation.",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(createPrFromJob.mock.calls[0]?.arguments[0], {
      jobId: "job-1",
      prInput: {
        repoUrl: "https://github.com/acme/repo.git",
        repoToken: "secret-token",
        reviewerNote: "Approved for PR creation.",
      },
    });
  } finally {
    await close();
  }
});

test("request handler returns INTERNAL_ERROR for invalid component manifest JSON", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-component-manifest-"),
  );
  const manifestPath = path.join(tempRoot, "component-manifest.json");
  await writeFile(manifestPath, "{ invalid json", "utf8");

  const getJobRecord = () =>
    ({
      jobId: "job-1",
      status: "completed",
      artifacts: {
        componentManifestFile: manifestPath,
      },
    }) as ReturnType<JobEngine["getJobRecord"]>;

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ getJobRecord }),
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/workspace/jobs/job-1/component-manifest",
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json<Record<string, unknown>>(), {
      error: "INTERNAL_ERROR",
      message: "Failed to parse component manifest for job 'job-1'.",
      requestId: response.headers["x-request-id"],
    });
  } finally {
    await close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("request handler GET job routes expose results and reject POST-only actions", async (t) => {
  const getJobResult = (jobId: string) =>
    jobId === "job-1"
      ? ({
          jobId,
          status: "completed",
        } as ReturnType<JobEngine["getJobResult"]>)
      : undefined;

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ getJobResult }),
  });

  try {
    const resultResponse = await app.inject({
      method: "GET",
      url: "/workspace/jobs/job-1/result",
    });
    assert.equal(resultResponse.statusCode, 200);
    assert.deepEqual(resultResponse.json<Record<string, unknown>>(), {
      jobId: "job-1",
      status: "completed",
    });

    const missingResult = await app.inject({
      method: "GET",
      url: "/workspace/jobs/missing/result",
    });
    assert.equal(missingResult.statusCode, 404);

    const postOnlyRoutes = [
      [
        "/workspace/jobs/job-1/cancel",
        "Use POST for cancellation route '/workspace/jobs/job-1/cancel'.",
      ],
      [
        "/workspace/jobs/job-1/regenerate",
        "Use POST for regeneration route '/workspace/jobs/job-1/regenerate'.",
      ],
      [
        "/workspace/jobs/job-1/sync",
        "Use POST for local sync route '/workspace/jobs/job-1/sync'.",
      ],
      [
        "/workspace/jobs/job-1/create-pr",
        "Use POST for PR creation route '/workspace/jobs/job-1/create-pr'.",
      ],
      [
        "/workspace/jobs/job-1/stale-check",
        "Use POST for stale-check route '/workspace/jobs/job-1/stale-check'.",
      ],
      [
        "/workspace/jobs/job-1/remap-suggest",
        "Use POST for remap-suggest route '/workspace/jobs/job-1/remap-suggest'.",
      ],
    ] as const;

    for (const [url, message] of postOnlyRoutes) {
      await t.test(url, async () => {
        const response = await app.inject({
          method: "GET",
          url,
        });

        assert.equal(response.statusCode, 405);
        assert.deepEqual(response.json<Record<string, unknown>>(), {
          error: "METHOD_NOT_ALLOWED",
          message,
          requestId: response.headers["x-request-id"],
        });
      });
    }
  } finally {
    await close();
  }
});

test("request handler serves design IR and component manifest success and missing-artifact variants", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-request-handler-artifacts-"),
  );
  const designIrPath = path.join(tempRoot, "design-ir.json");
  const figmaAnalysisPath = path.join(tempRoot, "figma-analysis.json");
  const manifestPath = path.join(tempRoot, "component-manifest.json");
  await writeFile(
    designIrPath,
    JSON.stringify({ screens: [] }, null, 2),
    "utf8",
  );
  await writeFile(
    figmaAnalysisPath,
    JSON.stringify(
      { artifactVersion: 1, sourceName: "Board", summary: {} },
      null,
      2,
    ),
    "utf8",
  );
  const figmaAnalysisSpoofedPath = path.join(
    tempRoot,
    "figma-analysis-spoofed.json",
  );
  await writeFile(
    figmaAnalysisSpoofedPath,
    JSON.stringify(
      {
        artifactVersion: 1,
        sourceName: "Board",
        summary: {},
        jobId: "spoofed-id",
      },
      null,
      2,
    ),
    "utf8",
  );
  const manifestPayload = {
    screens: [
      {
        screenId: "screen-1",
        screenName: "Offers",
        file: "src/screens/Offers.tsx",
        components: [
          {
            irNodeId: "offers-root",
            irNodeName: "Offers Root",
            irNodeType: "FRAME",
            file: "src/screens/Offers.tsx",
            startLine: 10,
            endLine: 30,
          },
          {
            irNodeId: "offer-card-a",
            irNodeName: "Offer Card",
            irNodeType: "INSTANCE",
            file: "src/components/OffersPattern1.tsx",
            startLine: 5,
            endLine: 18,
            extractedComponent: true,
          },
          {
            irNodeId: "offer-form",
            irNodeName: "Offer Form",
            irNodeType: "FRAME",
            file: "src/context/OffersPatternContext.tsx",
            startLine: 3,
            endLine: 8,
          },
        ],
      },
    ],
  };
  await writeFile(
    manifestPath,
    JSON.stringify(manifestPayload, null, 2),
    "utf8",
  );

  const records: Record<string, ReturnType<JobEngine["getJobRecord"]>> = {
    "job-design-ir-ok": {
      jobId: "job-design-ir-ok",
      status: "completed",
      artifacts: {
        designIrFile: designIrPath,
      },
    } as ReturnType<JobEngine["getJobRecord"]>,
    "job-design-ir-pending": {
      jobId: "job-design-ir-pending",
      status: "queued",
      artifacts: {},
    } as ReturnType<JobEngine["getJobRecord"]>,
    "job-design-ir-running-artifact": {
      jobId: "job-design-ir-running-artifact",
      status: "running",
      artifacts: {
        designIrFile: designIrPath,
      },
    } as ReturnType<JobEngine["getJobRecord"]>,
    "job-figma-analysis-ok": {
      jobId: "job-figma-analysis-ok",
      status: "completed",
      artifacts: {
        figmaAnalysisFile: figmaAnalysisPath,
      },
    } as ReturnType<JobEngine["getJobRecord"]>,
    "job-figma-analysis-spoofed-jobid": {
      jobId: "job-figma-analysis-spoofed-jobid",
      status: "completed",
      artifacts: {
        figmaAnalysisFile: figmaAnalysisSpoofedPath,
      },
    } as ReturnType<JobEngine["getJobRecord"]>,
    "job-figma-analysis-pending": {
      jobId: "job-figma-analysis-pending",
      status: "queued",
      artifacts: {},
    } as ReturnType<JobEngine["getJobRecord"]>,
    "job-figma-analysis-running-artifact": {
      jobId: "job-figma-analysis-running-artifact",
      status: "running",
      artifacts: {
        figmaAnalysisFile: figmaAnalysisPath,
      },
    } as ReturnType<JobEngine["getJobRecord"]>,
    "job-figma-analysis-missing-artifact": {
      jobId: "job-figma-analysis-missing-artifact",
      status: "completed",
      artifacts: {},
    } as ReturnType<JobEngine["getJobRecord"]>,
    "job-figma-analysis-missing-file": {
      jobId: "job-figma-analysis-missing-file",
      status: "completed",
      artifacts: {
        figmaAnalysisFile: path.join(tempRoot, "missing-figma-analysis.json"),
      },
    } as ReturnType<JobEngine["getJobRecord"]>,
    "job-design-ir-missing-artifact": {
      jobId: "job-design-ir-missing-artifact",
      status: "completed",
      artifacts: {},
    } as ReturnType<JobEngine["getJobRecord"]>,
    "job-design-ir-missing-file": {
      jobId: "job-design-ir-missing-file",
      status: "completed",
      artifacts: {
        designIrFile: path.join(tempRoot, "missing-design-ir.json"),
      },
    } as ReturnType<JobEngine["getJobRecord"]>,
    "job-manifest-ok": {
      jobId: "job-manifest-ok",
      status: "completed",
      artifacts: {
        componentManifestFile: manifestPath,
      },
    } as ReturnType<JobEngine["getJobRecord"]>,
    "job-manifest-running-artifact": {
      jobId: "job-manifest-running-artifact",
      status: "running",
      artifacts: {
        componentManifestFile: manifestPath,
      },
    } as ReturnType<JobEngine["getJobRecord"]>,
    "job-manifest-missing-artifact": {
      jobId: "job-manifest-missing-artifact",
      status: "completed",
      artifacts: {},
    } as ReturnType<JobEngine["getJobRecord"]>,
    "job-manifest-missing-file": {
      jobId: "job-manifest-missing-file",
      status: "completed",
      artifacts: {
        componentManifestFile: path.join(
          tempRoot,
          "missing-component-manifest.json",
        ),
      },
    } as ReturnType<JobEngine["getJobRecord"]>,
  };

  const getJobRecord = (jobId: string) => records[jobId];
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ getJobRecord }),
  });

  try {
    await t.test(
      "design-ir success normalizes missing sourceName and tokens to null",
      async () => {
        const response = await app.inject({
          method: "GET",
          url: "/workspace/jobs/job-design-ir-ok/design-ir",
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json<Record<string, unknown>>(), {
          jobId: "job-design-ir-ok",
          sourceName: null,
          screens: [],
          tokens: null,
        });
      },
    );

    await t.test("design-ir pending jobs return 409", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/workspace/jobs/job-design-ir-pending/design-ir",
      });

      assert.equal(response.statusCode, 409);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "JOB_NOT_COMPLETED",
      );
    });

    await t.test(
      "design-ir running jobs return the artifact once it exists",
      async () => {
        const response = await app.inject({
          method: "GET",
          url: "/workspace/jobs/job-design-ir-running-artifact/design-ir",
        });

        assert.equal(response.statusCode, 200);
        assert.equal(
          response.json<Record<string, unknown>>().jobId,
          "job-design-ir-running-artifact",
        );
      },
    );

    await t.test("design-ir missing artifact returns 404", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/workspace/jobs/job-design-ir-missing-artifact/design-ir",
      });

      assert.equal(response.statusCode, 404);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "DESIGN_IR_NOT_FOUND",
      );
    });

    await t.test("design-ir missing file on disk returns 404", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/workspace/jobs/job-design-ir-missing-file/design-ir",
      });

      assert.equal(response.statusCode, 404);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "DESIGN_IR_NOT_FOUND",
      );
    });

    await t.test("figma analysis success returns parsed payload", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/workspace/jobs/job-figma-analysis-ok/figma-analysis",
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json<Record<string, unknown>>(), {
        jobId: "job-figma-analysis-ok",
        artifactVersion: 1,
        sourceName: "Board",
        summary: {},
      });
    });

    await t.test("figma analysis pending jobs return 409", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/workspace/jobs/job-figma-analysis-pending/figma-analysis",
      });

      assert.equal(response.statusCode, 409);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "JOB_NOT_COMPLETED",
      );
    });

    await t.test(
      "figma analysis running jobs return the artifact once it exists",
      async () => {
        const response = await app.inject({
          method: "GET",
          url: "/workspace/jobs/job-figma-analysis-running-artifact/figma-analysis",
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json<Record<string, unknown>>(), {
          jobId: "job-figma-analysis-running-artifact",
          artifactVersion: 1,
          sourceName: "Board",
          summary: {},
        });
      },
    );

    await t.test("figma analysis missing artifact returns 404", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/workspace/jobs/job-figma-analysis-missing-artifact/figma-analysis",
      });

      assert.equal(response.statusCode, 404);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "FIGMA_ANALYSIS_NOT_FOUND",
      );
    });

    await t.test(
      "figma analysis jobId cannot be overridden by file content",
      async () => {
        const response = await app.inject({
          method: "GET",
          url: "/workspace/jobs/job-figma-analysis-spoofed-jobid/figma-analysis",
        });

        assert.equal(response.statusCode, 200);
        const payload = response.json<Record<string, unknown>>();
        assert.equal(payload.jobId, "job-figma-analysis-spoofed-jobid");
        assert.notEqual(payload.jobId, "spoofed-id");
      },
    );

    await t.test("figma analysis missing file returns 404", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/workspace/jobs/job-figma-analysis-missing-file/figma-analysis",
      });

      assert.equal(response.statusCode, 404);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "FIGMA_ANALYSIS_NOT_FOUND",
      );
    });

    await t.test(
      "component manifest success returns parsed payload",
      async () => {
        const response = await app.inject({
          method: "GET",
          url: "/workspace/jobs/job-manifest-ok/component-manifest",
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json<Record<string, unknown>>(), {
          jobId: "job-manifest-ok",
          ...manifestPayload,
        });
      },
    );

    await t.test(
      "component manifest running jobs return the artifact once it exists",
      async () => {
        const response = await app.inject({
          method: "GET",
          url: "/workspace/jobs/job-manifest-running-artifact/component-manifest",
        });

        assert.equal(response.statusCode, 200);
        assert.equal(
          response.json<Record<string, unknown>>().jobId,
          "job-manifest-running-artifact",
        );
      },
    );

    await t.test(
      "component manifest missing artifact returns 404",
      async () => {
        const response = await app.inject({
          method: "GET",
          url: "/workspace/jobs/job-manifest-missing-artifact/component-manifest",
        });

        assert.equal(response.statusCode, 404);
        assert.equal(
          response.json<Record<string, unknown>>().error,
          "COMPONENT_MANIFEST_NOT_FOUND",
        );
      },
    );

    await t.test("component manifest missing file returns 404", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/workspace/jobs/job-manifest-missing-file/component-manifest",
      });

      assert.equal(response.statusCode, 404);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "COMPONENT_MANIFEST_NOT_FOUND",
      );
    });
  } finally {
    await close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("request handler file listing and file reads enforce filters and path safety", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-request-handler-files-"),
  );
  const projectDir = path.join(tempRoot, "generated-project");
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  await mkdir(path.join(projectDir, "src", "screens"), { recursive: true });
  await mkdir(path.join(projectDir, "node_modules"), { recursive: true });
  await mkdir(path.join(projectDir, "dist"), { recursive: true });
  await writeFile(
    path.join(projectDir, "src", "App.tsx"),
    "export const App = () => null;\n",
    "utf8",
  );
  await writeFile(
    path.join(projectDir, "src", "screens", "Home.tsx"),
    "export const Home = () => 'home';\n",
    "utf8",
  );
  await writeFile(
    path.join(projectDir, "styles.css"),
    "body { margin: 0; }\n",
    "utf8",
  );
  await writeFile(path.join(projectDir, ".hidden.ts"), "hidden\n", "utf8");
  await writeFile(path.join(projectDir, "README.md"), "# ignored\n", "utf8");
  await writeFile(
    path.join(projectDir, "node_modules", "ignored.ts"),
    "ignored\n",
    "utf8",
  );
  await writeFile(
    path.join(projectDir, "dist", "ignored.ts"),
    "ignored\n",
    "utf8",
  );
  await symlink(
    path.join(projectDir, "src", "App.tsx"),
    path.join(projectDir, "src", "Linked.tsx"),
  );

  const getJobRecord = (jobId: string) =>
    jobId === "job-1"
      ? ({
          jobId,
          status: "completed",
          artifacts: {
            generatedProjectDir: projectDir,
          },
        } as ReturnType<JobEngine["getJobRecord"]>)
      : ({
          jobId,
          status: "completed",
          artifacts: {
            generatedProjectDir: path.join(
              tempRoot,
              "missing-generated-project",
            ),
          },
        } as ReturnType<JobEngine["getJobRecord"]>);

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ getJobRecord }),
  });

  try {
    await t.test(
      "directory listing skips blocked directories, dotfiles, symlinks, and unsupported extensions",
      async () => {
        const response = await app.inject({
          method: "GET",
          url: "/workspace/jobs/job-1/files",
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(
          response.json<{ files: Array<{ path: string }> }>().files,
          [
            {
              path: "src/App.tsx",
              sizeBytes: Buffer.byteLength("export const App = () => null;\n"),
            },
            {
              path: "src/screens/Home.tsx",
              sizeBytes: Buffer.byteLength(
                "export const Home = () => 'home';\n",
              ),
            },
            {
              path: "styles.css",
              sizeBytes: Buffer.byteLength("body { margin: 0; }\n"),
            },
          ],
        );
      },
    );

    await t.test("invalid directory filters are rejected", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/workspace/jobs/job-1/files?dir=../escape",
      });

      assert.equal(response.statusCode, 403);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "FORBIDDEN_PATH",
      );
    });

    await t.test("file reads return content for valid paths", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/workspace/jobs/job-1/files/src/App.tsx",
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body, "export const App = () => null;\n");
    });

    await t.test(
      "file reads normalize valid Windows-style relative paths to the same file",
      async () => {
        const posixResponse = await app.inject({
          method: "GET",
          url: "/workspace/jobs/job-1/files/src/screens/Home.tsx",
        });
        const windowsResponse = await app.inject({
          method: "GET",
          url: `/workspace/jobs/job-1/files/${encodeURIComponent("src\\screens\\Home.tsx")}`,
        });

        assert.equal(posixResponse.statusCode, 200);
        assert.equal(windowsResponse.statusCode, 200);
        assert.equal(windowsResponse.body, posixResponse.body);
      },
    );

    await t.test(
      "directory listing normalizes valid Windows-style dir filters to the same target",
      async () => {
        const posixResponse = await app.inject({
          method: "GET",
          url: "/workspace/jobs/job-1/files?dir=src/screens",
        });
        const windowsResponse = await app.inject({
          method: "GET",
          url: `/workspace/jobs/job-1/files?dir=${encodeURIComponent("src\\screens")}`,
        });

        assert.equal(posixResponse.statusCode, 200);
        assert.equal(windowsResponse.statusCode, 200);
        assert.deepEqual(
          windowsResponse.json<{
            jobId: string;
            files: Array<{ path: string; sizeBytes: number }>;
          }>(),
          posixResponse.json<{
            jobId: string;
            files: Array<{ path: string; sizeBytes: number }>;
          }>(),
        );
      },
    );

    await t.test("symlink file reads are rejected", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/workspace/jobs/job-1/files/src/Linked.tsx",
      });

      assert.equal(response.statusCode, 403);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "FORBIDDEN_PATH",
      );
    });

    await t.test("missing file reads return 404", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/workspace/jobs/job-1/files/src/Missing.tsx",
      });

      assert.equal(response.statusCode, 404);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "FILE_NOT_FOUND",
      );
    });

    await t.test(
      "missing generated project directories return empty listings",
      async () => {
        const response = await app.inject({
          method: "GET",
          url: "/workspace/jobs/job-missing/files",
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(
          response.json<{
            jobId: string;
            files: Array<{ path: string; sizeBytes: number }>;
          }>(),
          {
            jobId: "job-missing",
            files: [],
          },
        );
      },
    );

    await t.test(
      "running jobs expose generated files once the project directory exists",
      async () => {
        const { app: runningApp, close: closeRunning } =
          await createRequestHandlerApp({
            jobEngine: createStubJobEngine({
              getJobRecord: () =>
                ({
                  jobId: "job-running",
                  status: "running",
                  artifacts: {
                    generatedProjectDir: projectDir,
                  },
                }) as ReturnType<JobEngine["getJobRecord"]>,
            }),
          });

        try {
          const response = await runningApp.inject({
            method: "GET",
            url: "/workspace/jobs/job-running/files",
          });

          assert.equal(response.statusCode, 200);
          assert.deepEqual(
            response.json<{ files: Array<{ path: string }> }>().files,
            [
              {
                path: "src/App.tsx",
                sizeBytes: Buffer.byteLength(
                  "export const App = () => null;\n",
                ),
              },
              {
                path: "src/screens/Home.tsx",
                sizeBytes: Buffer.byteLength(
                  "export const Home = () => 'home';\n",
                ),
              },
              {
                path: "styles.css",
                sizeBytes: Buffer.byteLength("body { margin: 0; }\n"),
              },
            ],
          );
        } finally {
          await closeRunning();
        }
      },
    );
  } finally {
    await close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("request handler file listing pages deterministically at the 1000-file cap", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-request-handler-files-page-"),
  );
  const projectDir = path.join(tempRoot, "generated-project");
  await mkdir(path.join(projectDir, "src", "nested"), { recursive: true });
  await writeFile(
    path.join(projectDir, "src", "App.tsx"),
    "export const App = () => null;\n",
    "utf8",
  );
  await writeFile(
    path.join(projectDir, "src", "styles.css"),
    "body { margin: 0; }\n",
    "utf8",
  );
  for (let index = 0; index <= 1000; index += 1) {
    const suffix = String(index).padStart(4, "0");
    await writeFile(
      path.join(projectDir, "src", "nested", `file-${suffix}.tsx`),
      `export const File${suffix} = () => null;\n`,
      "utf8",
    );
  }

  const expectedPaths = [
    "src/App.tsx",
    "src/styles.css",
    ...Array.from(
      { length: 1001 },
      (_, index) => `src/nested/file-${String(index).padStart(4, "0")}.tsx`,
    ),
  ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  const getJobRecord = () =>
    ({
      jobId: "job-1",
      status: "completed",
      artifacts: {
        generatedProjectDir: projectDir,
      },
    }) as ReturnType<JobEngine["getJobRecord"]>;

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ getJobRecord }),
  });

  try {
    const firstPageResponse = await app.inject({
      method: "GET",
      url: "/workspace/jobs/job-1/files?limit=1000",
    });

    assert.equal(firstPageResponse.statusCode, 200);
    const firstPage = firstPageResponse.json<{
      jobId: string;
      files: Array<{ path: string; sizeBytes: number }>;
      nextCursor?: string;
    }>();
    assert.equal(firstPage.files.length, 1000);
    assert.equal(firstPage.nextCursor, expectedPaths[999]);
    assert.deepEqual(
      firstPage.files.map((entry) => entry.path),
      expectedPaths.slice(0, 1000),
    );

    const secondPageResponse = await app.inject({
      method: "GET",
      url: `/workspace/jobs/job-1/files?limit=1000&cursor=${encodeURIComponent(
        firstPage.nextCursor ?? "",
      )}`,
    });

    assert.equal(secondPageResponse.statusCode, 200);
    const secondPage = secondPageResponse.json<{
      jobId: string;
      files: Array<{ path: string; sizeBytes: number }>;
      nextCursor?: string;
    }>();
    assert.deepEqual(
      secondPage.files.map((entry) => entry.path),
      [expectedPaths[1000], expectedPaths[1001], expectedPaths[1002]],
    );
    assert.equal(secondPage.nextCursor, undefined);
  } finally {
    await close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("request handler file listing falls back to lstat for unknown dirent types", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-request-handler-files-unknown-"),
  );
  const projectDir = path.join(tempRoot, "generated-project");
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    path.join(projectDir, "keep.tsx"),
    "export const Keep = () => null;\n",
    "utf8",
  );

  const fifoPath = path.join(projectDir, "pipe.tsx");
  execFileSync("mkfifo", [fifoPath]);

  const getJobRecord = () =>
    ({
      jobId: "job-1",
      status: "completed",
      artifacts: {
        generatedProjectDir: projectDir,
      },
    }) as ReturnType<JobEngine["getJobRecord"]>;

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ getJobRecord }),
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/workspace/jobs/job-1/files",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response
        .json<{
          jobId: string;
          files: Array<{ path: string; sizeBytes: number }>;
        }>()
        .files.map((entry) => entry.path),
      ["keep.tsx"],
    );
  } finally {
    await close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("request handler file listing handles a wide root directory without materializing every child", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-request-handler-files-wide-"),
  );
  const projectDir = path.join(tempRoot, "generated-project");
  await mkdir(projectDir, { recursive: true });

  for (let index = 0; index <= 1000; index += 1) {
    const suffix = String(index).padStart(4, "0");
    await writeFile(
      path.join(projectDir, `root-${suffix}.tsx`),
      `export const Root${suffix} = () => null;\n`,
      "utf8",
    );
  }

  const expectedPaths = Array.from(
    { length: 1001 },
    (_, index) => `root-${String(index).padStart(4, "0")}.tsx`,
  );

  const getJobRecord = () =>
    ({
      jobId: "job-1",
      status: "completed",
      artifacts: {
        generatedProjectDir: projectDir,
      },
    }) as ReturnType<JobEngine["getJobRecord"]>;

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ getJobRecord }),
  });

  try {
    const firstPageResponse = await app.inject({
      method: "GET",
      url: "/workspace/jobs/job-1/files?limit=1000",
    });

    assert.equal(firstPageResponse.statusCode, 200);
    const firstPage = firstPageResponse.json<{
      jobId: string;
      files: Array<{ path: string; sizeBytes: number }>;
      nextCursor?: string;
    }>();
    assert.equal(firstPage.files.length, 1000);
    assert.equal(firstPage.nextCursor, expectedPaths[999]);
    assert.deepEqual(
      firstPage.files.map((entry) => entry.path),
      expectedPaths.slice(0, 1000),
    );

    const secondPageResponse = await app.inject({
      method: "GET",
      url: `/workspace/jobs/job-1/files?limit=1000&cursor=${encodeURIComponent(
        firstPage.nextCursor ?? "",
      )}`,
    });

    assert.equal(secondPageResponse.statusCode, 200);
    const secondPage = secondPageResponse.json<{
      jobId: string;
      files: Array<{ path: string; sizeBytes: number }>;
      nextCursor?: string;
    }>();
    assert.deepEqual(
      secondPage.files.map((entry) => entry.path),
      [expectedPaths[1000]],
    );
    assert.equal(secondPage.nextCursor, undefined);
  } finally {
    await close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("request handler preview routes inject inspect bridge into HTML and pass through non-HTML assets", async () => {
  const resolvePreviewAsset = async (_jobId: string, previewPath: string) => {
    if (previewPath === "index.html") {
      return {
        content: Buffer.from(
          "<html><head><title>Preview</title></head></html>",
          "utf8",
        ),
        contentType: "text/html; charset=utf-8",
      };
    }
    if (previewPath === "assets/app.js") {
      return {
        content: Buffer.from("console.log('preview');\n", "utf8"),
        contentType: "application/javascript",
      };
    }
    return undefined;
  };

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ resolvePreviewAsset }),
  });

  try {
    const htmlResponse = await app.inject({
      method: "GET",
      url: "/workspace/repros/job-1/",
    });
    assert.equal(htmlResponse.statusCode, 200);
    assert.equal(
      htmlResponse.body.includes("data-workspace-dev-inspect"),
      true,
    );
    assert.equal(htmlResponse.body.includes("</html>"), true);
    assert.equal(htmlResponse.headers["x-frame-options"], undefined);
    assert.equal(htmlResponse.headers["content-security-policy"], undefined);
    assert.equal(htmlResponse.headers["x-content-type-options"], "nosniff");

    const assetResponse = await app.inject({
      method: "GET",
      url: "/workspace/repros/job-1/assets/app.js",
    });
    assert.equal(assetResponse.statusCode, 200);
    assert.equal(assetResponse.body, "console.log('preview');\n");
    assert.equal(assetResponse.headers["x-frame-options"], undefined);
    assert.equal(assetResponse.headers["content-security-policy"], undefined);

    const missingResponse = await app.inject({
      method: "GET",
      url: "/workspace/repros/job-1/missing.js",
    });
    assert.equal(missingResponse.statusCode, 404);
    assert.equal(
      missingResponse.json<Record<string, unknown>>().error,
      "PREVIEW_NOT_FOUND",
    );

    const traversalResponse = await app.inject({
      method: "GET",
      url: "/workspace/repros/job-1/%2e%2e%2fsibling%2findex.html",
    });
    assert.equal(traversalResponse.statusCode, 404);
    assert.equal(
      traversalResponse.json<Record<string, unknown>>().error,
      "PREVIEW_NOT_FOUND",
    );

    const nullByteResponse = await app.inject({
      method: "GET",
      url: "/workspace/repros/job-1/assets%00app.js",
    });
    assert.equal(nullByteResponse.statusCode, 404);
    assert.equal(
      nullByteResponse.json<Record<string, unknown>>().error,
      "PREVIEW_NOT_FOUND",
    );
  } finally {
    await close();
  }
});

test("request handler serves phase-2 preview assets from generated dist before repro export", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-phase2-"));
  const projectDir = path.join(tempRoot, "generated-app");
  const distDir = path.join(projectDir, "dist");
  const assetsDir = path.join(distDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  await writeFile(
    path.join(distDir, "index.html"),
    '<!doctype html><html><body><div data-ir-id="screen-root">Preview</div><script src="assets/app.js"></script></body></html>',
    "utf8",
  );
  await writeFile(
    path.join(assetsDir, "app.js"),
    "console.log('phase-2-preview');\n",
    "utf8",
  );

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      getJobRecord: () =>
        ({
          jobId: "job-1",
          status: "running",
          artifacts: {
            generatedProjectDir: projectDir,
          },
        }) as ReturnType<JobEngine["getJobRecord"]>,
    }),
  });

  try {
    const htmlResponse = await app.inject({
      method: "GET",
      url: "/workspace/jobs/job-1/preview/",
    });
    assert.equal(htmlResponse.statusCode, 200);
    assert.equal(
      htmlResponse.body.includes("data-workspace-dev-inspect"),
      true,
    );
    assert.equal(htmlResponse.headers["x-frame-options"], undefined);

    const assetResponse = await app.inject({
      method: "GET",
      url: "/workspace/jobs/job-1/preview/assets/app.js",
    });
    assert.equal(assetResponse.statusCode, 200);
    assert.equal(assetResponse.body, "console.log('phase-2-preview');\n");

    const traversalResponse = await app.inject({
      method: "GET",
      url: "/workspace/jobs/job-1/preview/%2e%2e%2fsibling%2findex.html",
    });
    assert.equal(traversalResponse.statusCode, 404);
    assert.equal(
      traversalResponse.json<Record<string, unknown>>().error,
      "PREVIEW_NOT_FOUND",
    );
  } finally {
    await close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("request handler returns a pending phase-2 preview shell while dist is unavailable", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-phase2-"));
  const projectDir = path.join(tempRoot, "generated-app");
  await mkdir(projectDir, { recursive: true });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      getJobRecord: () =>
        ({
          jobId: "job-1",
          status: "running",
          artifacts: {
            generatedProjectDir: projectDir,
          },
        }) as ReturnType<JobEngine["getJobRecord"]>,
    }),
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/workspace/jobs/job-1/preview/",
    });
    assert.equal(response.statusCode, 202);
    assert.equal(
      response.body.includes("Building the generated preview"),
      true,
    );
    assert.equal(response.headers["x-frame-options"], undefined);
  } finally {
    await close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("request handler blocks browser cross-site write requests and requires JSON content type", async (t) => {
  const submitJob = test.mock.fn(() => ({
    jobId: "job-secure",
    status: "queued",
    acceptedModes: {
      figmaSourceMode: "rest",
      llmCodegenMode: "deterministic",
    },
  }));
  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  const port = app.addresses()[0]?.port ?? 0;
  const sameOriginHeaders = {
    origin: `http://127.0.0.1:${port}`,
    "sec-fetch-site": "same-origin",
  };

  const routes = [
    {
      url: "/workspace/submit",
      payload: {
        figmaFileKey: "file-key",
        figmaAccessToken: "secret-token",
        figmaSourceMode: "rest",
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

  try {
    for (const route of routes) {
      await t.test(`${route.url} rejects text/plain writes`, async () => {
        const response = await app.inject({
          method: "POST",
          url: route.url,
          headers: {
            ...sameOriginHeaders,
            "content-type": "text/plain",
          },
          payload: JSON.stringify(route.payload),
        });

        assert.equal(response.statusCode, 415);
        assert.equal(
          response.json<Record<string, unknown>>().error,
          "UNSUPPORTED_MEDIA_TYPE",
        );
      });

      await t.test(
        `${route.url} rejects cross-site browser writes`,
        async () => {
          const response = await app.inject({
            method: "POST",
            url: route.url,
            headers: {
              origin: "https://evil.example",
              "sec-fetch-site": "cross-site",
              "content-type": "application/json",
            },
            payload: JSON.stringify(route.payload),
          });

          assert.equal(response.statusCode, 403);
          assert.equal(
            response.json<Record<string, unknown>>().error,
            "FORBIDDEN_REQUEST_ORIGIN",
          );
        },
      );

      await t.test(
        `${route.url} rejects browser writes without same-origin metadata`,
        async () => {
          const response = await app.inject({
            method: "POST",
            url: route.url,
            headers: {
              "sec-fetch-site": "same-origin",
              "content-type": "application/json",
            },
            payload: JSON.stringify(route.payload),
          });

          assert.equal(response.statusCode, 403);
          assert.equal(
            response.json<Record<string, unknown>>().error,
            "FORBIDDEN_REQUEST_ORIGIN",
          );
        },
      );
    }

    const allowedResponse = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: {
        ...sameOriginHeaders,
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        figmaFileKey: "file-key",
        figmaAccessToken: "secret-token",
        figmaSourceMode: "rest",
      }),
    });

    assert.equal(allowedResponse.statusCode, 202);
    assert.equal(allowedResponse.headers["x-content-type-options"], "nosniff");
    assert.equal(allowedResponse.headers["x-frame-options"], "SAMEORIGIN");
    assert.equal(allowedResponse.headers["cache-control"], "no-store");
  } finally {
    await close();
  }

  assert.equal(submitJob.mock.callCount(), 1);
});

test("request handler preserves 404 semantics for unknown POST routes", async () => {
  const { app, close } = await createRequestHandlerApp();

  try {
    for (const url of ["/workspace/unknown", "/workspace/jobs/job-1/result"]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
          "content-type": "text/plain",
        },
        payload: "ignored",
      });

      assert.equal(response.statusCode, 404);
      assert.equal(response.json<Record<string, unknown>>().error, "NOT_FOUND");
    }
  } finally {
    await close();
  }
});

test("request handler rejects OPTIONS on protected write routes without CORS headers", async (t) => {
  const { app, close } = await createRequestHandlerApp();

  try {
    const protectedRoutes = [
      "/workspace/submit",
      "/workspace/jobs/job-1/regenerate",
    ] as const;

    for (const url of protectedRoutes) {
      await t.test(url, async () => {
        const response = await app.inject({
          method: "OPTIONS",
          url,
          headers: {
            origin: "https://portal.example",
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type",
          },
        });

        assert.equal(response.statusCode, 405);
        assert.equal(response.headers.allow, "POST");
        assert.equal(
          response.headers["content-type"],
          "application/json; charset=utf-8",
        );
        assert.equal(response.headers["x-content-type-options"], "nosniff");
        assert.equal(response.headers["x-frame-options"], "SAMEORIGIN");
        assert.equal(
          response.headers["access-control-allow-origin"],
          undefined,
        );
        assert.equal(
          response.headers["access-control-allow-methods"],
          undefined,
        );
        assert.equal(
          response.headers["access-control-allow-headers"],
          undefined,
        );
        assert.equal(response.headers["access-control-max-age"], undefined);

        assert.deepEqual(response.json<Record<string, unknown>>(), {
          error: "METHOD_NOT_ALLOWED",
          message: `Write route '${url}' only supports POST and does not support cross-origin browser preflight requests.`,
          requestId: response.headers["x-request-id"],
        });
      });
    }
  } finally {
    await close();
  }
});

test("request handler preserves 404 semantics for unknown OPTIONS routes", async () => {
  const { app, close } = await createRequestHandlerApp();

  try {
    for (const url of ["/workspace/unknown", "/workspace/jobs/job-1/result"]) {
      const response = await app.inject({
        method: "OPTIONS",
        url,
        headers: {
          origin: "https://portal.example",
          "access-control-request-method": "POST",
        },
      });

      assert.equal(response.statusCode, 404);
      assert.equal(response.json<Record<string, unknown>>().error, "NOT_FOUND");
      assert.equal(response.headers.allow, undefined);
    }
  } finally {
    await close();
  }
});

test("request handler stale-check, remap-suggest, submit, and cancel routes cover normalization, validation, and fallback errors", async (t) => {
  const checkStaleDraft = test.mock.fn(
    async ({
      jobId,
      draftNodeIds,
    }: {
      jobId: string;
      draftNodeIds: string[];
    }) => ({
      stale: draftNodeIds.length > 0,
      sourceJobId: jobId,
      latestJobId: draftNodeIds.length > 0 ? "job-newer" : null,
    }),
  );
  const suggestRemaps = test.mock.fn(
    async ({
      sourceJobId,
      latestJobId,
      unmappedNodeIds,
    }: {
      sourceJobId: string;
      latestJobId: string;
      unmappedNodeIds: string[];
    }) => ({
      sourceJobId,
      latestJobId,
      suggestions: unmappedNodeIds.map((sourceNodeId) => ({
        sourceNodeId,
        targetNodeId: `${sourceNodeId}-target`,
      })),
      rejections: [],
      message: "ok",
    }),
  );
  const submitJob = test.mock.fn(() => {
    throw createCodedError("E_JOB_QUEUE_FULL", "queue full", {
      queue: "saturated",
    });
  });
  const cancelJob = test.mock.fn(
    ({ jobId, reason }: { jobId: string; reason?: string }) =>
      jobId === "known-job"
        ? ({
            jobId,
            status: "canceled",
            cancellation: { reason },
          } as ReturnType<JobEngine["cancelJob"]>)
        : undefined,
  );

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      checkStaleDraft,
      suggestRemaps,
      submitJob,
      cancelJob,
    }),
  });

  try {
    await t.test("stale-check filters non-string draft node ids", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/workspace/jobs/job-1/stale-check",
        payload: {
          draftNodeIds: ["node-a", 42, "node-b", null],
        },
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(checkStaleDraft.mock.calls[0]?.arguments[0], {
        jobId: "job-1",
        draftNodeIds: ["node-a", "node-b"],
      });
    });

    await t.test("stale-check invalid JSON returns 400", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/workspace/jobs/job-1/stale-check",
        headers: { "content-type": "application/json" },
        payload: "{",
      });

      assert.equal(response.statusCode, 400);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "VALIDATION_ERROR",
      );
    });

    await t.test("stale-check generic errors return 500", async () => {
      const failingCheck = async (): Promise<never> => {
        throw new Error("stale failure");
      };
      const scoped = await createRequestHandlerApp({
        jobEngine: createStubJobEngine({ checkStaleDraft: failingCheck }),
      });

      try {
        const response = await scoped.app.inject({
          method: "POST",
          url: "/workspace/jobs/job-1/stale-check",
          payload: {},
        });

        assert.equal(response.statusCode, 500);
        assert.equal(
          response.json<Record<string, unknown>>().error,
          "INTERNAL_ERROR",
        );
      } finally {
        await scoped.close();
      }
    });

    await t.test(
      "remap-suggest defaults sourceJobId and filters unmapped node ids",
      async () => {
        const response = await app.inject({
          method: "POST",
          url: "/workspace/jobs/job-2/remap-suggest",
          payload: {
            latestJobId: "job-3",
            unmappedNodeIds: ["node-x", 12, "node-y"],
          },
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(suggestRemaps.mock.calls[0]?.arguments[0], {
          sourceJobId: "job-2",
          latestJobId: "job-3",
          unmappedNodeIds: ["node-x", "node-y"],
        });
      },
    );

    await t.test("remap-suggest invalid JSON returns 400", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/workspace/jobs/job-2/remap-suggest",
        headers: { "content-type": "application/json" },
        payload: "{",
      });

      assert.equal(response.statusCode, 400);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "VALIDATION_ERROR",
      );
    });

    await t.test("remap-suggest generic errors return 500", async () => {
      const failingSuggest = async (): Promise<never> => {
        throw new Error("remap failure");
      };
      const scoped = await createRequestHandlerApp({
        jobEngine: createStubJobEngine({ suggestRemaps: failingSuggest }),
      });

      try {
        const response = await scoped.app.inject({
          method: "POST",
          url: "/workspace/jobs/job-2/remap-suggest",
          payload: {
            latestJobId: "job-3",
            unmappedNodeIds: [],
          },
        });

        assert.equal(response.statusCode, 500);
        assert.equal(
          response.json<Record<string, unknown>>().error,
          "INTERNAL_ERROR",
        );
      } finally {
        await scoped.close();
      }
    });

    await t.test(
      "submit rejects figmaSourceMode not available in workspace-dev with MODE_LOCK_VIOLATION",
      async () => {
        const submitJob = test.mock.fn(
          (_input: Parameters<JobEngine["submitJob"]>[0]) => {
            return {
              jobId: "job-accepted",
              status: "queued",
              acceptedModes: {
                figmaSourceMode: "rest",
                llmCodegenMode: "deterministic",
              },
            } as ReturnType<JobEngine["submitJob"]>;
          },
        );
        const scoped = await createRequestHandlerApp({
          jobEngine: createStubJobEngine({ submitJob }),
        });

        try {
          const response = await scoped.app.inject({
            method: "POST",
            url: "/workspace/submit",
            headers: { "content-type": "application/json" },
            payload: {
              figmaSourceMode: "mcp",
              figmaFileKey: "file-key",
              figmaAccessToken: "token",
            },
          });

          assert.equal(response.statusCode, 400);
          const body = response.json<Record<string, unknown>>();
          assert.equal(body.error, "MODE_LOCK_VIOLATION");
          assert.equal(typeof body.message, "string");
          assert.ok((body.message as string).length > 0);
          assert.ok(body.allowedModes !== undefined);
          assert.equal(submitJob.mock.callCount(), 0);
        } finally {
          await scoped.close();
        }
      },
    );

    await t.test(
      "submit rejects invalid generationLocale before submitJob",
      async () => {
        const submitJob = test.mock.fn(
          (_input: Parameters<JobEngine["submitJob"]>[0]) => {
            return {
              jobId: "job-accepted",
              status: "queued",
              acceptedModes: {
                figmaSourceMode: "rest",
                llmCodegenMode: "deterministic",
              },
            } as ReturnType<JobEngine["submitJob"]>;
          },
        );
        const scoped = await createRequestHandlerApp({
          jobEngine: createStubJobEngine({ submitJob }),
        });

        try {
          const response = await scoped.app.inject({
            method: "POST",
            url: "/workspace/submit",
            headers: { "content-type": "application/json" },
            payload: {
              figmaFileKey: "file-key",
              figmaAccessToken: "token",
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
          assert.equal(submitJob.mock.callCount(), 0);
        } finally {
          await scoped.close();
        }
      },
    );

    await t.test(
      "submit canonicalizes generationLocale and llmCodegenMode before submitJob",
      async () => {
        const submitJob = test.mock.fn(
          (_input: Parameters<JobEngine["submitJob"]>[0]) => {
            return {
              jobId: "job-accepted",
              status: "queued",
              acceptedModes: {
                figmaSourceMode: "rest",
                llmCodegenMode: "deterministic",
              },
            } as ReturnType<JobEngine["submitJob"]>;
          },
        );
        const scoped = await createRequestHandlerApp({
          jobEngine: createStubJobEngine({ submitJob }),
        });

        try {
          const response = await scoped.app.inject({
            method: "POST",
            url: "/workspace/submit",
            headers: { "content-type": "application/json" },
            payload: {
              figmaFileKey: "file-key",
              figmaAccessToken: "token",
              storybookStaticDir: " ./storybook-static/customer ",
              customerProfilePath: " ./profiles/acme.json ",
              generationLocale: " EN-us ",
              llmCodegenMode: " Deterministic ",
            },
          });

          assert.equal(response.statusCode, 202);
          assert.equal(submitJob.mock.callCount(), 1);
          const input = submitJob.mock.calls[0]?.arguments[0];
          assert.equal(input?.generationLocale, "en-US");
          assert.equal(input?.llmCodegenMode, "deterministic");
          assert.equal(input?.figmaSourceMode, "rest");
          assert.equal(
            input?.storybookStaticDir,
            "./storybook-static/customer",
          );
          assert.equal(input?.customerProfilePath, "./profiles/acme.json");
        } finally {
          await scoped.close();
        }
      },
    );

    await t.test(
      "submit omits queue payload when queue metadata is not an object",
      async () => {
        const response = await app.inject({
          method: "POST",
          url: "/workspace/submit",
          payload: {
            figmaFileKey: "file-key",
            figmaAccessToken: "token",
          },
        });

        assert.equal(response.statusCode, 429);
        const body = response.json<Record<string, unknown>>();
        assert.equal(body.error, "QUEUE_BACKPRESSURE");
        assert.equal("queue" in body, false);
      },
    );

    await t.test("submit generic errors return 500", async () => {
      const failingSubmit = () => {
        throw new Error("submit failure");
      };
      const scoped = await createRequestHandlerApp({
        jobEngine: createStubJobEngine({ submitJob: failingSubmit }),
      });

      try {
        const response = await scoped.app.inject({
          method: "POST",
          url: "/workspace/submit",
          payload: {
            figmaFileKey: "file-key",
            figmaAccessToken: "token",
          },
        });

        assert.equal(response.statusCode, 500);
        assert.equal(
          response.json<Record<string, unknown>>().error,
          "INTERNAL_ERROR",
        );
      } finally {
        await scoped.close();
      }
    });

    await t.test(
      "submit sanitizes PANs without over-redacting non-pan numeric values",
      async () => {
        const failingSubmit = () => {
          throw new Error(
            "submit failure with pan 4242424242424242 and timestamp 1712345678901",
          );
        };
        const scoped = await createRequestHandlerApp({
          jobEngine: createStubJobEngine({ submitJob: failingSubmit }),
        });

        try {
          const response = await scoped.app.inject({
            method: "POST",
            url: "/workspace/submit",
            payload: {
              figmaFileKey: "file-key",
              figmaAccessToken: "token",
            },
          });

          assert.equal(response.statusCode, 500);
          const body = response.json<Record<string, unknown>>();
          assert.equal(body.error, "INTERNAL_ERROR");
          assert.equal(
            body.message,
            "submit failure with pan [redacted-pan] and timestamp 1712345678901",
          );
        } finally {
          await scoped.close();
        }
      },
    );

    await t.test(
      "cancel trims reasons and returns 404 for unknown jobs",
      async () => {
        const success = await app.inject({
          method: "POST",
          url: "/workspace/jobs/known-job/cancel",
          payload: {
            reason: "  cleanup requested  ",
          },
        });
        assert.equal(success.statusCode, 202);
        assert.equal(
          cancelJob.mock.calls[0]?.arguments[0]?.reason,
          "cleanup requested",
        );

        const missing = await app.inject({
          method: "POST",
          url: "/workspace/jobs/missing-job/cancel",
          payload: {},
        });
        assert.equal(missing.statusCode, 404);
        assert.equal(
          missing.json<Record<string, unknown>>().error,
          "JOB_NOT_FOUND",
        );
      },
    );
  } finally {
    await close();
  }
});

// --- Issue #582: Safe URI decoding regression tests ---

test("malformed percent-encoded job ID returns 400 INVALID_PATH_ENCODING on GET status", async () => {
  const { app, close } = await createRequestHandlerApp();
  try {
    const res = await app.inject({
      method: "GET",
      url: "/workspace/jobs/bad%2job/result",
    });
    assert.equal(res.statusCode, 400);
    assert.equal(
      res.json<Record<string, unknown>>().error,
      "INVALID_PATH_ENCODING",
    );
  } finally {
    await close();
  }
});

test("malformed percent-encoded job ID returns 400 on POST cancel", async () => {
  const { app, close } = await createRequestHandlerApp();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/workspace/jobs/bad%2job/cancel",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    assert.equal(res.statusCode, 400);
    assert.equal(
      res.json<Record<string, unknown>>().error,
      "INVALID_PATH_ENCODING",
    );
  } finally {
    await close();
  }
});

test("malformed percent-encoded file path returns 400 on GET file content", async () => {
  const { app, close, tempRoot } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      getJobRecord: () =>
        ({
          status: "completed",
          artifacts: { generatedProjectDir: tempRoot },
        }) as ReturnType<JobEngine["getJobRecord"]>,
    }),
  });
  try {
    const res = await app.inject({
      method: "GET",
      url: "/workspace/jobs/job-1/files/src%2FApp%2.tsx",
    });
    assert.equal(res.statusCode, 400);
    assert.equal(
      res.json<Record<string, unknown>>().error,
      "INVALID_PATH_ENCODING",
    );
  } finally {
    await close();
  }
});

test("malformed percent-encoded repro job ID returns 400", async () => {
  const { app, close } = await createRequestHandlerApp();
  try {
    const res = await app.inject({
      method: "GET",
      url: "/workspace/repros/bad%2id/index.html",
    });
    assert.equal(res.statusCode, 400);
    assert.equal(
      res.json<Record<string, unknown>>().error,
      "INVALID_PATH_ENCODING",
    );
  } finally {
    await close();
  }
});

test("malformed percent-encoded repro preview path returns 400", async () => {
  const { app, close } = await createRequestHandlerApp();
  try {
    const res = await app.inject({
      method: "GET",
      url: "/workspace/repros/job-1/assets%2",
    });
    assert.equal(res.statusCode, 400);
    assert.equal(
      res.json<Record<string, unknown>>().error,
      "INVALID_PATH_ENCODING",
    );
  } finally {
    await close();
  }
});

// --- Issue #582: Windows path normalization regression tests ---

test("backslash traversal in file path returns 403", async () => {
  const { app, close, tempRoot } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      getJobRecord: () =>
        ({
          status: "completed",
          artifacts: { generatedProjectDir: tempRoot },
        }) as ReturnType<JobEngine["getJobRecord"]>,
    }),
  });
  try {
    const res = await app.inject({
      method: "GET",
      url: `/workspace/jobs/job-1/files/${encodeURIComponent("..\\..\\etc\\passwd")}`,
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await close();
  }
});

test("backslash-based blocked prefix (node_modules) in file path returns 403", async () => {
  const { app, close, tempRoot } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      getJobRecord: () =>
        ({
          status: "completed",
          artifacts: { generatedProjectDir: tempRoot },
        }) as ReturnType<JobEngine["getJobRecord"]>,
    }),
  });
  try {
    const res = await app.inject({
      method: "GET",
      url: `/workspace/jobs/job-1/files/${encodeURIComponent("node_modules\\react\\index.ts")}`,
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await close();
  }
});

test("Windows absolute path (C:\\) in file path returns 403", async () => {
  const { app, close, tempRoot } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      getJobRecord: () =>
        ({
          status: "completed",
          artifacts: { generatedProjectDir: tempRoot },
        }) as ReturnType<JobEngine["getJobRecord"]>,
    }),
  });
  try {
    const res = await app.inject({
      method: "GET",
      url: `/workspace/jobs/job-1/files/${encodeURIComponent("C:\\Windows\\System32\\cmd.ts")}`,
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await close();
  }
});

test("backslash-based blocked prefix in directory listing ?dir= returns 403", async () => {
  const { app, close, tempRoot } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      getJobRecord: () =>
        ({
          status: "completed",
          artifacts: { generatedProjectDir: tempRoot },
        }) as ReturnType<JobEngine["getJobRecord"]>,
    }),
  });
  try {
    const res = await app.inject({
      method: "GET",
      url: `/workspace/jobs/job-1/files?dir=${encodeURIComponent("node_modules\\react")}`,
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await close();
  }
});

test("request handler serves screenshot artifacts for jobs that captured a Figma preview", async () => {
  const jobDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-screenshot-"),
  );
  await mkdir(path.join(jobDir, ".stage-store"), { recursive: true });
  await writeFile(
    path.join(jobDir, ".stage-store", "index.json"),
    `${JSON.stringify(
      [
        {
          key: "figma.hybrid.enrichment",
          stage: "figma.source",
          kind: "value",
          updatedAt: "2026-04-14T08:00:00.000Z",
          value: {
            sourceMode: "hybrid",
            nodeHints: [],
            toolNames: ["get_screenshot"],
            screenshots: [
              {
                nodeId: "1:2",
                url: "https://cdn.figma.com/screenshots/card.png",
              },
            ],
          },
        },
      ],
      null,
      2,
    )}\n`,
    "utf8",
  );

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({
      getJobRecord: () =>
        ({
          jobId: "job-1",
          status: "running",
          artifacts: {
            jobDir,
          },
        }) as ReturnType<JobEngine["getJobRecord"]>,
    }),
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/workspace/jobs/job-1/screenshot",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json<Record<string, unknown>>(), {
      jobId: "job-1",
      screenshotUrl: "https://cdn.figma.com/screenshots/card.png",
      url: "https://cdn.figma.com/screenshots/card.png",
    });
  } finally {
    await close();
    await rm(jobDir, { recursive: true, force: true });
  }
});

test("request handler normalizes figma_url submissions into node-scoped hybrid jobs", async () => {
  const originalToken = process.env.FIGMA_ACCESS_TOKEN;
  process.env.FIGMA_ACCESS_TOKEN = "figd_test_token";

  let capturedInput: Record<string, unknown> | undefined;
  const submitJob = test.mock.fn((input: Record<string, unknown>) => {
    capturedInput = input;
    return {
      jobId: "url-job",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "hybrid",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_url",
        figmaJsonPayload: JSON.stringify({
          figmaFileKey: "ABC123fileKey",
          nodeId: "1-2",
        }),
      },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(submitJob.mock.callCount(), 1);
    assert.ok(capturedInput);
    assert.equal(capturedInput.figmaSourceMode, "hybrid");
    assert.equal(capturedInput.figmaFileKey, "ABC123fileKey");
    assert.equal(capturedInput.figmaNodeId, "1:2");
    assert.equal(capturedInput.figmaAccessToken, "figd_test_token");
    assert.equal(capturedInput.figmaJsonPayload, undefined);
  } finally {
    await close();
    if (originalToken === undefined) {
      delete process.env.FIGMA_ACCESS_TOKEN;
    } else {
      process.env.FIGMA_ACCESS_TOKEN = originalToken;
    }
  }
});

// ---------------------------------------------------------------------------
// Clipboard envelope normalization in figma_paste submit path
// ---------------------------------------------------------------------------

test("request handler accepts a valid ClipboardEnvelope via figma_paste and normalizes it", async () => {
  let capturedInput: Record<string, unknown> | undefined;
  const submitJob = test.mock.fn((input: Record<string, unknown>) => {
    capturedInput = input;
    return {
      jobId: "envelope-job",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "local_json",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });

  const { app, close, tempRoot } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const envelope = readPasteFixture<Record<string, unknown>>(
      "envelopes/single-selection-envelope.json",
    );

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: JSON.stringify(envelope),
        importIntent: "FIGMA_PLUGIN_ENVELOPE",
      },
    });

    assert.equal(response.statusCode, 202);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.jobId, "envelope-job");

    // submitJob was called with local_json mode (envelope was normalized + written to disk)
    assert.equal(submitJob.mock.callCount(), 1);
    assert.ok(capturedInput);
    assert.equal(capturedInput.figmaSourceMode, "local_json");
    assert.ok(
      typeof capturedInput.figmaJsonPath === "string",
      "Expected figmaJsonPath to be a string path",
    );

    // The written file should contain the normalized Figma document structure
    const { readFile } = await import("node:fs/promises");
    const writtenContent = await readFile(
      capturedInput.figmaJsonPath as string,
      "utf8",
    );
    const parsed = JSON.parse(writtenContent) as Record<string, unknown>;
    assert.ok(
      parsed.document !== undefined,
      "Normalized file should have a document field",
    );
    const doc = parsed.document as Record<string, unknown>;
    assert.equal(doc.type, "DOCUMENT");
    assert.equal(doc.id, "0:0");
    assert.ok(Array.isArray(doc.children), "Document should have children");
    assert.equal((doc.children as unknown[]).length, 1);
  } finally {
    await close();
  }
});

test("request handler rejects invalid ClipboardEnvelope via figma_paste with SCHEMA_MISMATCH", async () => {
  const submitJob = test.mock.fn(() => {
    throw new Error("submitJob should not be called");
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const badEnvelope = readPasteFixture<Record<string, unknown>>(
      "envelopes/invalid-empty-selections-envelope.json",
    );

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: JSON.stringify(badEnvelope),
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "SCHEMA_MISMATCH");

    assert.equal(submitJob.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler rejects overly complex figma_paste envelopes before temp-file writes", async () => {
  const submitJob = test.mock.fn(() => {
    throw new Error("submitJob should not be called");
  });

  const { app, close, tempRoot } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const envelope = {
      kind: "workspace-dev/figma-selection@1",
      pluginVersion: "1.0.0",
      copiedAt: "2026-04-18T12:00:00.000Z",
      selections: Array.from(
        { length: DEFAULT_FIGMA_PASTE_MAX_SELECTION_COUNT + 1 },
        (_, index) => ({
          document: {
            id: `selection-${index}`,
            type: "FRAME",
            name: `Selection ${index + 1}`,
          },
          components: {},
          componentSets: {},
          styles: {},
        }),
      ),
    };

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: JSON.stringify(envelope),
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "TOO_LARGE");
    assert.equal(submitJob.mock.callCount(), 0);

    const pasteTempDir = path.join(tempRoot, "tmp-figma-paste");
    const tempEntries = await readdir(pasteTempDir).catch(() => []);
    assert.deepEqual(tempEntries, []);
  } finally {
    await close();
  }
});

test("request handler rejects overly complex figma_plugin envelopes before temp-file writes", async () => {
  const submitJob = test.mock.fn(() => {
    throw new Error("submitJob should not be called");
  });

  const { app, close, tempRoot } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const envelope = {
      kind: "workspace-dev/figma-selection@1",
      pluginVersion: "1.0.0",
      copiedAt: "2026-04-18T12:00:00.000Z",
      selections: Array.from(
        { length: DEFAULT_FIGMA_PASTE_MAX_SELECTION_COUNT + 1 },
        (_, index) => ({
          document: {
            id: `selection-${index}`,
            type: "FRAME",
            name: `Selection ${index + 1}`,
          },
          components: {},
          componentSets: {},
          styles: {},
        }),
      ),
    };

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_plugin",
        figmaJsonPayload: JSON.stringify(envelope),
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "TOO_LARGE");
    assert.equal(submitJob.mock.callCount(), 0);

    const pasteTempDir = path.join(tempRoot, "tmp-figma-paste");
    const tempEntries = await readdir(pasteTempDir).catch(() => []);
    assert.deepEqual(tempEntries, []);
  } finally {
    await close();
  }
});

test("request handler rejects overly complex raw figma_paste documents before temp-file writes", async () => {
  const submitJob = test.mock.fn(() => {
    throw new Error("submitJob should not be called");
  });

  const { app, close, tempRoot } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const payload = {
      name: "Too many roots",
      document: {
        id: "0:0",
        type: "DOCUMENT",
        children: Array.from(
          { length: DEFAULT_FIGMA_PASTE_MAX_ROOT_COUNT + 1 },
          (_, index) => ({
            id: `1:${index + 1}`,
            type: "CANVAS",
            name: `Root ${index + 1}`,
            children: [],
          }),
        ),
      },
    };

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: JSON.stringify(payload),
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "TOO_LARGE");
    assert.equal(submitJob.mock.callCount(), 0);

    const pasteTempDir = path.join(tempRoot, "tmp-figma-paste");
    const tempEntries = await readdir(pasteTempDir).catch(() => []);
    assert.deepEqual(tempEntries, []);
  } finally {
    await close();
  }
});

test("request handler rejects unknown ClipboardEnvelope version via figma_paste with UNSUPPORTED_CLIPBOARD_KIND", async () => {
  const submitJob = test.mock.fn(() => {
    throw new Error("submitJob should not be called");
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const unknownEnvelope = readPasteFixture<Record<string, unknown>>(
      "envelopes/unsupported-version-envelope.json",
    );

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: JSON.stringify(unknownEnvelope),
        importIntent: "FIGMA_PLUGIN_ENVELOPE",
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "UNSUPPORTED_CLIPBOARD_KIND");
    assert.equal(submitJob.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler rejects unknown ClipboardEnvelope version via figma_plugin with UNSUPPORTED_FORMAT", async () => {
  const submitJob = test.mock.fn(() => {
    throw new Error("submitJob should not be called");
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const unknownEnvelope = readPasteFixture<Record<string, unknown>>(
      "envelopes/unsupported-version-envelope.json",
    );

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_plugin",
        figmaJsonPayload: JSON.stringify(unknownEnvelope),
        importIntent: "FIGMA_PLUGIN_ENVELOPE",
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "UNSUPPORTED_FORMAT");
    assert.equal(submitJob.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler does not expose the removed figma-import route", async () => {
  const { app, close } = await createRequestHandlerApp();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/workspace/figma-import",
      headers: { "content-type": "application/json" },
      payload: { kind: "workspace-dev/figma-selection@1" },
    });

    assert.equal(response.statusCode, 404);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "NOT_FOUND");
  } finally {
    await close();
  }
});

test("request handler does not advertise CORS preflight for the removed figma-import route", async () => {
  const { app, close } = await createRequestHandlerApp();

  try {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/workspace/figma-import",
      headers: {
        origin: "https://www.figma.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

    assert.equal(response.statusCode, 404);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "NOT_FOUND");
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Issue #987 — figma_plugin source mode & ingress telemetry
// ---------------------------------------------------------------------------

test("request handler accepts a valid ClipboardEnvelope via figma_plugin and normalizes it", async () => {
  let capturedInput: Record<string, unknown> | undefined;
  const submitJob = test.mock.fn((input: Record<string, unknown>) => {
    capturedInput = input;
    return {
      jobId: "envelope-plugin-job",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "local_json",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const envelope = readPasteFixture<Record<string, unknown>>(
      "envelopes/whole-view-envelope.json",
    );

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_plugin",
        figmaJsonPayload: JSON.stringify(envelope),
        importIntent: "FIGMA_PLUGIN_ENVELOPE",
      },
    });

    assert.equal(response.statusCode, 202);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.jobId, "envelope-plugin-job");

    // figma_plugin is converted to local_json (same as figma_paste)
    assert.equal(submitJob.mock.callCount(), 1);
    assert.ok(capturedInput);
    assert.equal(capturedInput.figmaSourceMode, "local_json");
    assert.ok(
      typeof capturedInput.figmaJsonPath === "string",
      "Expected figmaJsonPath to be a string path",
    );

    // The written file should contain the normalized Figma document structure
    const { readFile } = await import("node:fs/promises");
    const writtenContent = await readFile(
      capturedInput.figmaJsonPath as string,
      "utf8",
    );
    const parsed = JSON.parse(writtenContent) as Record<string, unknown>;
    assert.ok(
      parsed.document !== undefined,
      "Normalized file should have a document field",
    );
    const doc = parsed.document as Record<string, unknown>;
    assert.equal(doc.type, "DOCUMENT");
    assert.equal(doc.id, "0:0");
    assert.ok(Array.isArray(doc.children), "Document should have children");
    assert.equal((doc.children as unknown[]).length, 1);
  } finally {
    await close();
  }
});

test("request handler accepts raw Figma document JSON via figma_plugin", async () => {
  let capturedInput: Record<string, unknown> | undefined;
  const submitJob = test.mock.fn((input: Record<string, unknown>) => {
    capturedInput = input;
    return {
      jobId: "raw-plugin-job",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "local_json",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const rawFigmaDoc = {
      document: {
        id: "0:0",
        type: "DOCUMENT",
        name: "Doc",
        children: [{ id: "1:1", type: "FRAME", name: "Frame1" }],
      },
      components: {},
      componentSets: {},
      styles: {},
    };

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_plugin",
        figmaJsonPayload: JSON.stringify(rawFigmaDoc),
      },
    });

    assert.equal(response.statusCode, 202);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.jobId, "raw-plugin-job");

    assert.equal(submitJob.mock.callCount(), 1);
    assert.ok(capturedInput);
    assert.equal(capturedInput.figmaSourceMode, "local_json");
    assert.ok(
      typeof capturedInput.figmaJsonPath === "string",
      "Expected figmaJsonPath to be a string path",
    );

    // Raw doc should pass through as-is (not an envelope)
    const { readFile } = await import("node:fs/promises");
    const writtenContent = await readFile(
      capturedInput.figmaJsonPath as string,
      "utf8",
    );
    const parsed = JSON.parse(writtenContent) as Record<string, unknown>;
    assert.ok(parsed.document !== undefined);
    const doc = parsed.document as Record<string, unknown>;
    assert.equal(doc.type, "DOCUMENT");
    assert.equal(doc.id, "0:0");
    assert.equal(doc.name, "Doc");
  } finally {
    await close();
  }
});

test("request handler rejects invalid figma_plugin payload with SCHEMA_MISMATCH", async () => {
  const submitJob = test.mock.fn(() => {
    throw new Error("submitJob should not be called");
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const badEnvelope = {
      kind: "workspace-dev/figma-selection@1",
      pluginVersion: "0.1.0",
      copiedAt: "2026-04-12T18:00:00.000Z",
      selections: [],
    };

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_plugin",
        figmaJsonPayload: JSON.stringify(badEnvelope),
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.error, "SCHEMA_MISMATCH");
    assert.equal(submitJob.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler rejects oversized figma_plugin payload with TOO_LARGE", async () => {
  const submitJob = test.mock.fn(() => {
    throw new Error("submitJob should not be called");
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const oversizedPayload = "x".repeat(6 * 1024 * 1024 + 1);

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_plugin",
        figmaJsonPayload: oversizedPayload,
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    // Schema validation extracts TOO_LARGE prefix into a first-class error code
    assert.equal(body.error, "TOO_LARGE");
    assert.equal(submitJob.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test("request handler ingress metrics code path executes without errors for figma_paste submissions", async () => {
  let capturedInput: Record<string, unknown> | undefined;
  const submitJob = test.mock.fn((input: Record<string, unknown>) => {
    capturedInput = input;
    return {
      jobId: "metrics-job",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "local_json",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const envelope = {
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
    };

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: JSON.stringify(envelope),
        importIntent: "FIGMA_PLUGIN_ENVELOPE",
      },
    });

    // Confirms the ingress metrics computation (payloadBytes, nodeCount,
    // normalizationMs, payloadSha256) executed without throwing.
    assert.equal(response.statusCode, 202);
    const body = response.json<Record<string, unknown>>();
    assert.equal(body.jobId, "metrics-job");
    assert.equal(submitJob.mock.callCount(), 1);
    assert.ok(capturedInput);
    assert.equal(capturedInput.figmaSourceMode, "local_json");
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Token decisions endpoint (Issue #993)
// ---------------------------------------------------------------------------

test("token-decisions endpoint persists decisions, normalizes input, and reads them back", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-token-decisions-"),
  );
  const jobDir = path.join(tempRoot, "job-7");
  await mkdir(jobDir, { recursive: true });

  const getJobRecord = (jobId: string) =>
    jobId === "job-7"
      ? ({
          jobId,
          status: "completed",
          artifacts: {
            jobDir,
          },
        } as ReturnType<JobEngine["getJobRecord"]>)
      : undefined;

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ getJobRecord }),
  });

  try {
    await t.test(
      "GET on never-written decisions returns an empty snapshot",
      async () => {
        const response = await app.inject({
          method: "GET",
          url: "/workspace/jobs/job-7/token-decisions",
        });
        assert.equal(response.statusCode, 200);
        const body = response.json<Record<string, unknown>>();
        assert.equal(body.jobId, "job-7");
        assert.equal(body.updatedAt, null);
        assert.deepEqual(body.acceptedTokenNames, []);
        assert.deepEqual(body.rejectedTokenNames, []);
      },
    );

    await t.test(
      "POST persists sanitized decisions and writes token-decisions.json on disk",
      async () => {
        const response = await app.inject({
          method: "POST",
          url: "/workspace/jobs/job-7/token-decisions",
          payload: {
            acceptedTokenNames: [
              "color/primary",
              " color/primary ",
              "spacing/lg",
              "",
            ],
            rejectedTokenNames: ["spacing/xl", "spacing/xl", "radius/sm"],
          },
        });

        assert.equal(response.statusCode, 200);
        const body = response.json<Record<string, unknown>>();
        assert.equal(body.jobId, "job-7");
        assert.deepEqual(body.acceptedTokenNames, [
          "color/primary",
          "spacing/lg",
        ]);
        assert.deepEqual(body.rejectedTokenNames, ["spacing/xl", "radius/sm"]);
        assert.ok(typeof body.updatedAt === "string");

        const { readFile } = await import("node:fs/promises");
        const persisted = JSON.parse(
          await readFile(path.join(jobDir, "token-decisions.json"), "utf8"),
        ) as Record<string, unknown>;
        assert.equal(persisted.jobId, "job-7");
        assert.deepEqual(persisted.acceptedTokenNames, [
          "color/primary",
          "spacing/lg",
        ]);
      },
    );

    await t.test("GET returns the persisted snapshot after POST", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/workspace/jobs/job-7/token-decisions",
      });
      assert.equal(response.statusCode, 200);
      const body = response.json<Record<string, unknown>>();
      assert.deepEqual(body.acceptedTokenNames, [
        "color/primary",
        "spacing/lg",
      ]);
      assert.deepEqual(body.rejectedTokenNames, ["spacing/xl", "radius/sm"]);
      assert.ok(typeof body.updatedAt === "string");
    });

    await t.test(
      "POST rejects non-array payload fields with VALIDATION_ERROR",
      async () => {
        const response = await app.inject({
          method: "POST",
          url: "/workspace/jobs/job-7/token-decisions",
          payload: {
            acceptedTokenNames: "not-an-array",
            rejectedTokenNames: [],
          },
        });
        assert.equal(response.statusCode, 400);
        assert.equal(
          response.json<Record<string, unknown>>().error,
          "VALIDATION_ERROR",
        );
      },
    );

    await t.test(
      "POST rejects a token that appears in both accepted and rejected",
      async () => {
        const response = await app.inject({
          method: "POST",
          url: "/workspace/jobs/job-7/token-decisions",
          payload: {
            acceptedTokenNames: ["color/primary"],
            rejectedTokenNames: ["color/primary"],
          },
        });
        assert.equal(response.statusCode, 400);
        const body = response.json<Record<string, unknown>>();
        assert.equal(body.error, "VALIDATION_ERROR");
        const issues = body.issues as
          | Array<Record<string, unknown>>
          | undefined;
        assert.ok(Array.isArray(issues));
        assert.equal(issues[0]?.path, "color/primary");
      },
    );

    await t.test("POST invalid JSON returns 400", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/workspace/jobs/job-7/token-decisions",
        headers: { "content-type": "application/json" },
        payload: "{",
      });
      assert.equal(response.statusCode, 400);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "VALIDATION_ERROR",
      );
    });

    await t.test("POST to unknown job returns 404", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/workspace/jobs/job-missing/token-decisions",
        payload: {
          acceptedTokenNames: [],
          rejectedTokenNames: [],
        },
      });
      assert.equal(response.statusCode, 404);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "JOB_NOT_FOUND",
      );
    });

    await t.test("GET on unknown job returns 404", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/workspace/jobs/job-missing/token-decisions",
      });
      assert.equal(response.statusCode, 404);
      assert.equal(
        response.json<Record<string, unknown>>().error,
        "JOB_NOT_FOUND",
      );
    });
  } finally {
    await close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Issue #988 Wave 2 — figma paste/plugin ingress payload fidelity
// ---------------------------------------------------------------------------

test("figma_paste submit preserves requestSourceMode alongside converted figmaSourceMode", async () => {
  let capturedInput: Record<string, unknown> | undefined;
  const submitJob = test.mock.fn((input: Record<string, unknown>) => {
    capturedInput = input;
    return {
      jobId: "paste-request-mode-job",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "local_json",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const envelope = {
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
    };

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: JSON.stringify(envelope),
        importIntent: "FIGMA_PLUGIN_ENVELOPE",
      },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(submitJob.mock.callCount(), 1);
    assert.ok(capturedInput);
    assert.equal(capturedInput.figmaSourceMode, "local_json");
    assert.equal(capturedInput.requestSourceMode, "figma_paste");
  } finally {
    await close();
  }
});

test("figma_plugin submit preserves requestSourceMode alongside converted figmaSourceMode", async () => {
  let capturedInput: Record<string, unknown> | undefined;
  const submitJob = test.mock.fn((input: Record<string, unknown>) => {
    capturedInput = input;
    return {
      jobId: "plugin-request-mode-job",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "local_json",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const envelope = {
      kind: "workspace-dev/figma-selection@1",
      pluginVersion: "0.1.0",
      copiedAt: "2026-04-12T18:00:00.000Z",
      selections: [
        {
          document: { id: "3:4", type: "FRAME", name: "Plugin Card" },
          components: {},
          componentSets: {},
          styles: {},
        },
      ],
    };

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_plugin",
        figmaJsonPayload: JSON.stringify(envelope),
        importIntent: "FIGMA_PLUGIN_ENVELOPE",
      },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(submitJob.mock.callCount(), 1);
    assert.ok(capturedInput);
    assert.equal(capturedInput.figmaSourceMode, "local_json");
    assert.equal(capturedInput.requestSourceMode, "figma_plugin");
  } finally {
    await close();
  }
});

test("figma_paste normalizes a 3-selection ClipboardEnvelope into 3 CANVAS children on disk", async () => {
  let capturedInput: Record<string, unknown> | undefined;
  const submitJob = test.mock.fn((input: Record<string, unknown>) => {
    capturedInput = input;
    return {
      jobId: "paste-multi-job",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "local_json",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const envelope = readPasteFixture<Record<string, unknown>>(
      "envelopes/composite-selection-envelope.json",
    );

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: JSON.stringify(envelope),
        importIntent: "FIGMA_PLUGIN_ENVELOPE",
      },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(submitJob.mock.callCount(), 1);
    assert.ok(capturedInput);
    assert.equal(capturedInput.figmaSourceMode, "local_json");
    const figmaJsonPath = capturedInput.figmaJsonPath;
    assert.ok(
      typeof figmaJsonPath === "string" && figmaJsonPath.length > 0,
      "Expected figmaJsonPath to be a non-empty string",
    );

    const { readFile } = await import("node:fs/promises");
    const writtenContent = await readFile(figmaJsonPath, "utf8");
    const parsed = JSON.parse(writtenContent) as Record<string, unknown>;
    const doc = parsed.document as Record<string, unknown>;
    assert.equal(doc.type, "DOCUMENT");
    assert.equal(doc.id, "0:0");
    const children = doc.children as Array<Record<string, unknown>>;
    assert.equal(children.length, 3);

    const expectedNames = ["Frame A", "Frame B", "Frame C"];
    for (let i = 0; i < children.length; i += 1) {
      const canvas = children[i]!;
      assert.equal(canvas.type, "CANVAS", `child ${i} should be CANVAS`);
      assert.equal(canvas.name, expectedNames[i]);
      const canvasChildren = canvas.children as Array<Record<string, unknown>>;
      assert.equal(canvasChildren.length, 1);
      assert.equal(canvasChildren[0]!.type, "FRAME");
      assert.equal(canvasChildren[0]!.name, expectedNames[i]);
    }
  } finally {
    await close();
  }
});

test("figma_paste writes raw non-envelope Figma document JSON byte-for-byte to disk", async () => {
  let capturedInput: Record<string, unknown> | undefined;
  const submitJob = test.mock.fn((input: Record<string, unknown>) => {
    capturedInput = input;
    return {
      jobId: "paste-raw-job",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "local_json",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const rawFigmaDoc = readPasteFixture<Record<string, unknown>>(
      "envelopes/raw-figma-document.json",
    );
    const rawPayload = JSON.stringify(rawFigmaDoc);

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: rawPayload,
      },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(submitJob.mock.callCount(), 1);
    assert.ok(capturedInput);
    assert.equal(capturedInput.figmaSourceMode, "local_json");
    const figmaJsonPath = capturedInput.figmaJsonPath;
    assert.ok(typeof figmaJsonPath === "string" && figmaJsonPath.length > 0);

    const { readFile } = await import("node:fs/promises");
    const writtenContent = await readFile(figmaJsonPath, "utf8");
    assert.equal(
      writtenContent,
      rawPayload,
      "Raw non-envelope payload must be written byte-for-byte without normalization",
    );
  } finally {
    await close();
  }
});

test("figma_plugin normalizes a 3-selection ClipboardEnvelope into 3 CANVAS children on disk", async () => {
  let capturedInput: Record<string, unknown> | undefined;
  const submitJob = test.mock.fn((input: Record<string, unknown>) => {
    capturedInput = input;
    return {
      jobId: "plugin-multi-job",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "local_json",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const envelope = {
      kind: "workspace-dev/figma-selection@1",
      pluginVersion: "0.1.0",
      copiedAt: "2026-04-12T18:00:00.000Z",
      selections: [
        {
          document: { id: "20:1", type: "FRAME", name: "Plugin A" },
          components: {},
          componentSets: {},
          styles: {},
        },
        {
          document: { id: "20:2", type: "FRAME", name: "Plugin B" },
          components: {},
          componentSets: {},
          styles: {},
        },
        {
          document: { id: "20:3", type: "FRAME", name: "Plugin C" },
          components: {},
          componentSets: {},
          styles: {},
        },
      ],
    };

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_plugin",
        figmaJsonPayload: JSON.stringify(envelope),
        importIntent: "FIGMA_PLUGIN_ENVELOPE",
      },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(submitJob.mock.callCount(), 1);
    assert.ok(capturedInput);
    assert.equal(capturedInput.figmaSourceMode, "local_json");
    assert.equal(capturedInput.requestSourceMode, "figma_plugin");
    const figmaJsonPath = capturedInput.figmaJsonPath;
    assert.ok(typeof figmaJsonPath === "string" && figmaJsonPath.length > 0);

    const { readFile } = await import("node:fs/promises");
    const writtenContent = await readFile(figmaJsonPath, "utf8");
    const parsed = JSON.parse(writtenContent) as Record<string, unknown>;
    const doc = parsed.document as Record<string, unknown>;
    assert.equal(doc.type, "DOCUMENT");
    assert.equal(doc.id, "0:0");
    const children = doc.children as Array<Record<string, unknown>>;
    assert.equal(children.length, 3);
    for (let i = 0; i < children.length; i += 1) {
      assert.equal(children[i]!.type, "CANVAS");
      const canvasChildren = children[i]!.children as Array<
        Record<string, unknown>
      >;
      assert.equal(canvasChildren.length, 1);
      assert.equal(canvasChildren[0]!.type, "FRAME");
    }
  } finally {
    await close();
  }
});

test("figma_paste forwards pasteDeltaSeed to submitJob when roots are extractable", async () => {
  let capturedInput: Record<string, unknown> | undefined;
  const submitJob = test.mock.fn((input: Record<string, unknown>) => {
    capturedInput = input;
    return {
      jobId: "paste-seed-job",
      status: "queued",
      acceptedModes: {
        figmaSourceMode: "local_json",
        llmCodegenMode: "deterministic",
      },
    } as ReturnType<JobEngine["submitJob"]>;
  });

  const { app, close } = await createRequestHandlerApp({
    jobEngine: createStubJobEngine({ submitJob }),
  });

  try {
    const envelope = {
      kind: "workspace-dev/figma-selection@1",
      pluginVersion: "0.1.0",
      copiedAt: "2026-04-12T18:00:00.000Z",
      selections: [
        {
          document: { id: "30:1", type: "FRAME", name: "Seed Card" },
          components: {},
          componentSets: {},
          styles: {},
        },
      ],
    };

    const response = await app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: JSON.stringify(envelope),
        importIntent: "FIGMA_PLUGIN_ENVELOPE",
      },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(submitJob.mock.callCount(), 1);
    assert.ok(capturedInput);
    const seed = capturedInput.pasteDeltaSeed as
      | Record<string, unknown>
      | undefined;
    assert.ok(seed, "Expected pasteDeltaSeed to be forwarded to submitJob");
    assert.equal(typeof seed.pasteIdentityKey, "string");
    assert.ok((seed.pasteIdentityKey as string).length > 0);
    assert.equal(seed.requestedMode, "auto");
    assert.ok(
      typeof seed.provisionalSummary === "object" &&
        seed.provisionalSummary !== null,
      "Expected provisionalSummary in pasteDeltaSeed",
    );
  } finally {
    await close();
  }
});

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

test("submit figma_to_qc_test_cases returns 503 FEATURE_DISABLED when both gates are off", async () => {
  await withTestIntelligenceEnv(undefined, async () => {
    const submitJob = test.mock.fn();
    const { app, close } = await createRequestHandlerApp({
      jobEngine: createStubJobEngine({
        submitJob: submitJob as unknown as JobEngine["submitJob"],
      }),
      testIntelligenceEnabled: false,
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/workspace/submit",
        payload: {
          figmaFileKey: "file-key",
          figmaAccessToken: "token",
          jobType: "figma_to_qc_test_cases",
        },
      });
      assert.equal(response.statusCode, 503);
      const body = response.json<Record<string, unknown>>();
      assert.equal(body.error, "FEATURE_DISABLED");
      assert.equal(submitJob.mock.callCount(), 0);
    } finally {
      await close();
    }
  });
});

test("submit figma_to_qc_test_cases fails closed before figma_url normalization when gates are off", async () => {
  await withTestIntelligenceEnv(undefined, async () => {
    const submitJob = test.mock.fn();
    const { app, close } = await createRequestHandlerApp({
      jobEngine: createStubJobEngine({
        submitJob: submitJob as unknown as JobEngine["submitJob"],
      }),
      testIntelligenceEnabled: false,
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/workspace/submit",
        payload: {
          figmaSourceMode: "figma_url",
          jobType: "figma_to_qc_test_cases",
        },
      });
      assert.equal(response.statusCode, 503);
      const body = response.json<Record<string, unknown>>();
      assert.equal(body.error, "FEATURE_DISABLED");
      assert.equal(submitJob.mock.callCount(), 0);
    } finally {
      await close();
    }
  });
});

test("submit figma_to_qc_test_cases returns 503 FEATURE_DISABLED when only env gate is on", async () => {
  await withTestIntelligenceEnv("1", async () => {
    const submitJob = test.mock.fn();
    const { app, close } = await createRequestHandlerApp({
      jobEngine: createStubJobEngine({
        submitJob: submitJob as unknown as JobEngine["submitJob"],
      }),
      testIntelligenceEnabled: false,
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/workspace/submit",
        payload: {
          figmaFileKey: "file-key",
          figmaAccessToken: "token",
          jobType: "figma_to_qc_test_cases",
        },
      });
      assert.equal(response.statusCode, 503);
      const body = response.json<Record<string, unknown>>();
      assert.equal(body.error, "FEATURE_DISABLED");
      assert.equal(submitJob.mock.callCount(), 0);
    } finally {
      await close();
    }
  });
});

test("submit figma_to_qc_test_cases returns 503 FEATURE_DISABLED when only startup gate is on", async () => {
  await withTestIntelligenceEnv(undefined, async () => {
    const submitJob = test.mock.fn();
    const { app, close } = await createRequestHandlerApp({
      jobEngine: createStubJobEngine({
        submitJob: submitJob as unknown as JobEngine["submitJob"],
      }),
      testIntelligenceEnabled: true,
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/workspace/submit",
        payload: {
          figmaFileKey: "file-key",
          figmaAccessToken: "token",
          jobType: "figma_to_qc_test_cases",
        },
      });
      assert.equal(response.statusCode, 503);
      const body = response.json<Record<string, unknown>>();
      assert.equal(body.error, "FEATURE_DISABLED");
      assert.equal(submitJob.mock.callCount(), 0);
    } finally {
      await close();
    }
  });
});

test("submit figma_to_qc_test_cases does not enter codegen pipeline when both gates are on", async () => {
  await withTestIntelligenceEnv("1", async () => {
    const submitJob = test.mock.fn();
    const { app, close } = await createRequestHandlerApp({
      jobEngine: createStubJobEngine({
        submitJob: submitJob as unknown as JobEngine["submitJob"],
      }),
      testIntelligenceEnabled: true,
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/workspace/submit",
        payload: {
          figmaFileKey: "file-key",
          figmaAccessToken: "token",
          jobType: "figma_to_qc_test_cases",
          testIntelligenceMode: "dry_run",
        },
      });
      assert.notEqual(response.statusCode, 503);
      assert.equal(response.statusCode, 501);
      const body = response.json<Record<string, unknown>>();
      assert.equal(body.error, "NOT_IMPLEMENTED");
      assert.equal(submitJob.mock.callCount(), 0);
    } finally {
      await close();
    }
  });
});

test("submit figma_to_code path is unaffected when test-intelligence gates are on", async () => {
  await withTestIntelligenceEnv("1", async () => {
    const submitJob = test.mock.fn(
      () =>
        ({
          jobId: "job-accepted",
          status: "queued",
          acceptedModes: {
            figmaSourceMode: "rest",
            llmCodegenMode: "deterministic",
          },
        }) as ReturnType<JobEngine["submitJob"]>,
    );
    const { app, close } = await createRequestHandlerApp({
      jobEngine: createStubJobEngine({ submitJob }),
      testIntelligenceEnabled: true,
    });
    try {
      const implicit = await app.inject({
        method: "POST",
        url: "/workspace/submit",
        payload: {
          figmaFileKey: "file-key",
          figmaAccessToken: "token",
        },
      });
      assert.equal(implicit.statusCode, 202);

      const explicit = await app.inject({
        method: "POST",
        url: "/workspace/submit",
        payload: {
          figmaFileKey: "file-key",
          figmaAccessToken: "token",
          jobType: "figma_to_code",
        },
      });
      assert.equal(explicit.statusCode, 202);
      assert.equal(submitJob.mock.callCount(), 2);
    } finally {
      await close();
    }
  });
});
