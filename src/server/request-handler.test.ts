import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApp, type WorkspaceServerApp } from "./app-inject.js";
import { createWorkspaceRequestHandler } from "./request-handler.js";
import { LocalSyncError } from "../job-engine/local-sync.js";
import type { JobEngine } from "../job-engine.js";
import type {
  WorkspaceRuntimeLogInput,
  WorkspaceRuntimeLogger,
} from "../logging.js";

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

async function createRequestHandlerApp({
  jobEngine = createStubJobEngine(),
  moduleDir = path.resolve(import.meta.dirname ?? ".", ".."),
  rateLimitPerMinute = 10,
  logger = createStubLogger(),
}: {
  jobEngine?: JobEngine;
  moduleDir?: string;
  rateLimitPerMinute?: number;
  logger?: WorkspaceRuntimeLogger;
} = {}): Promise<{
  app: WorkspaceServerApp;
  close: () => Promise<void>;
  tempRoot: string;
}> {
  const host = "127.0.0.1";
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-request-handler-"),
  );
  let resolvedPort = 0;
  const handler = createWorkspaceRequestHandler({
    host,
    getResolvedPort: () => resolvedPort,
    startedAt: Date.now(),
    absoluteOutputRoot: tempRoot,
    defaults: { figmaSourceMode: "rest", llmCodegenMode: "deterministic" },
    runtime: {
      previewEnabled: false,
      rateLimitPerMinute,
      logger,
    },
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
    close: async () => {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
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

  const createPrScenarios = [
    ["E_PR_JOB_NOT_FOUND", 404, "JOB_NOT_FOUND"],
    ["E_PR_JOB_NOT_COMPLETED", 409, "JOB_NOT_COMPLETED"],
    ["E_PR_NOT_REGENERATION_JOB", 409, "NOT_REGENERATION_JOB"],
    ["E_PR_NO_GENERATED_PROJECT", 409, "NO_GENERATED_PROJECT"],
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
  } finally {
    await close();
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
      "submit rejects malformed llmCodegenMode before mode lock or submitJob",
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
        figmaSourceMode: "figma_paste",
        figmaJsonPayload: JSON.stringify(badEnvelope),
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json<Record<string, unknown>>();
    assert.ok(
      body.error === "VALIDATION_ERROR" || body.error === "SCHEMA_MISMATCH",
      `Expected VALIDATION_ERROR or SCHEMA_MISMATCH but got ${body.error}`,
    );

    assert.equal(submitJob.mock.callCount(), 0);
  } finally {
    await close();
  }
});
