import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobEngine, resolveRuntimeSettings } from "../job-engine.js";

const waitForTerminalStatus = async ({
  getStatus,
  jobId,
  timeoutMs = 120_000
}: {
  getStatus: (jobId: string) => ReturnType<ReturnType<typeof createJobEngine>["getJob"]>;
  jobId: string;
  timeoutMs?: number;
}) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = getStatus(jobId);
    if (status && (status.status === "completed" || status.status === "failed" || status.status === "canceled")) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for job ${jobId} status`);
};

const createLocalFigmaPayload = () => ({
  name: "Local JSON Board",
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
            name: "Local Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
            children: [{ id: "title", type: "TEXT", characters: "Hello", absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 20 } }]
          }
        ]
      }
    ]
  }
});

const createFastJobEngine = ({
  tempRoot,
  fetchImpl,
  enablePreview = false
}: {
  tempRoot: string;
  fetchImpl?: typeof fetch;
  enablePreview?: boolean;
}) =>
  createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1_000,
      ...(fetchImpl ? { fetchImpl } : {})
    })
  });

const submitCompletedLocalJsonJob = async ({
  engine,
  figmaJsonPath
}: {
  engine: ReturnType<typeof createJobEngine>;
  figmaJsonPath: string;
}) => {
  const accepted = engine.submitJob({
    figmaSourceMode: "local_json",
    figmaJsonPath
  });
  const status = await waitForTerminalStatus({
    getStatus: engine.getJob,
    jobId: accepted.jobId,
    timeoutMs: 180_000
  });
  assert.equal(status.status, "completed");
  return { accepted, status };
};

test("createJobEngine accepts jobs and exposes queued status", () => {
  const tempRoot = path.join(os.tmpdir(), "workspace-dev-engine-accept");
  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({ enablePreview: false, figmaMaxRetries: 1, figmaRequestTimeoutMs: 1000 })
  });

  const accepted = engine.submitJob({ figmaFileKey: "abc", figmaAccessToken: "token" });
  assert.equal(accepted.status, "queued");
  assert.equal(accepted.acceptedModes.figmaSourceMode, "rest");
  assert.equal(accepted.acceptedModes.llmCodegenMode, "deterministic");
  assert.equal(engine.getJob("unknown"), undefined);
  assert.equal(engine.getJobResult("unknown"), undefined);
});

test("createJobEngine supports hybrid mode with MCP enrichment loader output", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-hybrid-loader-"));
  const payload = createLocalFigmaPayload();
  const loaderCalls: Array<{ figmaFileKey: string; figmaAccessToken: string; jobDir: string }> = [];

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1_000,
      fetchImpl: async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }),
      figmaMcpEnrichmentLoader: async (input) => {
        loaderCalls.push({
          figmaFileKey: input.figmaFileKey,
          figmaAccessToken: input.figmaAccessToken,
          jobDir: input.jobDir
        });

        return {
          sourceMode: "hybrid",
          toolNames: ["figma-mcp"],
          nodeHints: [],
          metadataHints: [
            {
              nodeId: "missing-node",
              layerName: "Main Header",
              layerType: "FRAME",
              sourceTools: ["get_metadata"]
            }
          ],
          codeConnectMappings: [
            {
              nodeId: "missing-node",
              componentName: "Banner",
              source: "src/components/Banner.tsx",
              label: "React"
            }
          ],
          designSystemMappings: [
            {
              nodeId: "missing-node-secondary",
              componentName: "BannerSurface",
              source: "src/components/BannerSurface.tsx",
              label: "React",
              libraryKey: "demo-library"
            }
          ],
          variables: [
            {
              name: "color/primary",
              kind: "color",
              value: "#102030"
            }
          ],
          styleCatalog: [
            {
              name: "Heading 1",
              styleType: "TEXT",
              fontSizePx: 42,
              fontWeight: 700,
              lineHeightPx: 50,
              fontFamily: "Figma Sans"
            }
          ],
          assets: [
            {
              nodeId: "missing-node",
              source: "/figma/assets/banner.svg",
              kind: "image",
              purpose: "render"
            }
          ],
          screenshots: [
            {
              nodeId: "missing-node",
              url: "https://example.invalid/banner.png",
              purpose: "quality-gate"
            }
          ]
        };
      }
    })
  });

  const accepted = engine.submitJob({
    figmaSourceMode: "hybrid",
    figmaFileKey: "abc",
    figmaAccessToken: "token"
  });
  assert.equal(accepted.acceptedModes.figmaSourceMode, "hybrid");

  const status = await waitForTerminalStatus({
    getStatus: engine.getJob,
    jobId: accepted.jobId,
    timeoutMs: 20_000
  });
  assert.equal(status.status, "completed");
  assert.equal(loaderCalls.length, 1);
  assert.deepEqual(loaderCalls[0], {
    figmaFileKey: "abc",
    figmaAccessToken: "token",
    jobDir: String(status.artifacts.jobDir)
  });

  const designIr = JSON.parse(await readFile(String(status.artifacts.designIrFile), "utf8")) as {
    tokens?: {
      palette?: { primary?: string };
      typography?: { h1?: { fontSizePx?: number; fontFamily?: string } };
    };
    metrics?: {
      mcpCoverage?: {
        sourceMode?: string;
        variableCount?: number;
        styleEntryCount?: number;
        metadataHintCount?: number;
        codeConnectMappingCount?: number;
        designSystemMappingCount?: number;
        assetCount?: number;
        screenshotCount?: number;
        fallbackUsed?: boolean;
      };
    };
  };

  assert.equal(designIr.tokens?.palette?.primary, "#102030");
  assert.equal(designIr.tokens?.typography?.h1?.fontSizePx, 42);
  assert.equal(designIr.tokens?.typography?.h1?.fontFamily, "Figma Sans");
  assert.equal(designIr.metrics?.mcpCoverage?.sourceMode, "hybrid");
  assert.equal(designIr.metrics?.mcpCoverage?.variableCount, 1);
  assert.equal(designIr.metrics?.mcpCoverage?.styleEntryCount, 1);
  assert.equal(designIr.metrics?.mcpCoverage?.metadataHintCount, 1);
  assert.equal(designIr.metrics?.mcpCoverage?.codeConnectMappingCount, 1);
  assert.equal(designIr.metrics?.mcpCoverage?.designSystemMappingCount, 1);
  assert.equal(designIr.metrics?.mcpCoverage?.assetCount, 1);
  assert.equal(designIr.metrics?.mcpCoverage?.screenshotCount, 1);
  assert.equal(designIr.metrics?.mcpCoverage?.fallbackUsed, undefined);
  assert.equal(
    status.logs.some((entry) => entry.message.includes("MCP enrichment coverage (hybrid): variables=1, styles=1")),
    true
  );
});

test("createJobEngine falls back deterministically when hybrid mode has no MCP enrichment loader", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-hybrid-fallback-"));
  const payload = createLocalFigmaPayload();

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1_000,
      fetchImpl: async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
    })
  });

  const accepted = engine.submitJob({
    figmaSourceMode: "hybrid",
    figmaFileKey: "abc",
    figmaAccessToken: "token"
  });

  const status = await waitForTerminalStatus({
    getStatus: engine.getJob,
    jobId: accepted.jobId,
    timeoutMs: 20_000
  });
  assert.equal(status.status, "completed");
  assert.equal(
    status.logs.some((entry) => entry.message.includes("no figmaMcpEnrichmentLoader is configured")),
    true
  );

  const designIr = JSON.parse(await readFile(String(status.artifacts.designIrFile), "utf8")) as {
    metrics?: {
      mcpCoverage?: {
        sourceMode?: string;
        variableCount?: number;
        styleEntryCount?: number;
        codeConnectMappingCount?: number;
        designSystemMappingCount?: number;
        metadataHintCount?: number;
        assetCount?: number;
        fallbackUsed?: boolean;
        diagnostics?: Array<{ code?: string }>;
      };
    };
  };

  assert.equal(designIr.metrics?.mcpCoverage?.sourceMode, "hybrid");
  assert.equal(designIr.metrics?.mcpCoverage?.variableCount, 0);
  assert.equal(designIr.metrics?.mcpCoverage?.styleEntryCount, 0);
  assert.equal(designIr.metrics?.mcpCoverage?.codeConnectMappingCount, 0);
  assert.equal(designIr.metrics?.mcpCoverage?.designSystemMappingCount, 0);
  assert.equal(designIr.metrics?.mcpCoverage?.metadataHintCount, 0);
  assert.equal(designIr.metrics?.mcpCoverage?.assetCount, 0);
  assert.equal(designIr.metrics?.mcpCoverage?.fallbackUsed, true);
  assert.equal(designIr.metrics?.mcpCoverage?.diagnostics?.[0]?.code, "W_MCP_ENRICHMENT_SKIPPED");
});

test("createJobEngine rejects submit when queue backpressure cap is reached", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-backpressure-"));
  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      maxConcurrentJobs: 1,
      maxQueuedJobs: 1,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1_000,
      fetchImpl: async (_input, init) =>
        await new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;
          if (signal instanceof AbortSignal) {
            signal.addEventListener(
              "abort",
              () => {
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true }
            );
          }
        })
    })
  });

  const first = engine.submitJob({ figmaFileKey: "abc", figmaAccessToken: "token" });
  const second = engine.submitJob({ figmaFileKey: "def", figmaAccessToken: "token" });
  assert.equal(first.status, "queued");
  assert.equal(second.status, "queued");

  assert.throws(
    () => {
      engine.submitJob({ figmaFileKey: "ghi", figmaAccessToken: "token" });
    },
    (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "E_JOB_QUEUE_FULL"
  );

  engine.cancelJob({ jobId: first.jobId, reason: "cleanup" });
  engine.cancelJob({ jobId: second.jobId, reason: "cleanup" });
  await waitForTerminalStatus({ getStatus: engine.getJob, jobId: first.jobId, timeoutMs: 20_000 });
});

test("createJobEngine cancels queued jobs with terminal canceled state", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-cancel-queued-"));
  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      maxConcurrentJobs: 1,
      maxQueuedJobs: 2,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1_000,
      fetchImpl: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal instanceof AbortSignal) {
            signal.addEventListener(
              "abort",
              () => {
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true }
            );
          }
        })
    })
  });

  const running = engine.submitJob({ figmaFileKey: "abc", figmaAccessToken: "token" });
  const queued = engine.submitJob({ figmaFileKey: "def", figmaAccessToken: "token" });
  const canceled = engine.cancelJob({ jobId: queued.jobId, reason: "User canceled queued job." });

  assert.equal(canceled?.status, "canceled");
  assert.equal(canceled?.cancellation?.reason, "User canceled queued job.");
  assert.equal(engine.getJobResult(queued.jobId)?.cancellation?.reason, "User canceled queued job.");
  assert.equal(engine.cancelJob({ jobId: queued.jobId, reason: "ignored-after-terminal" })?.status, "canceled");

  engine.cancelJob({ jobId: running.jobId, reason: "cleanup" });
  const runningStatus = await waitForTerminalStatus({ getStatus: engine.getJob, jobId: running.jobId, timeoutMs: 20_000 });
  assert.equal(runningStatus.status, "canceled");
});

test("createJobEngine cancels running jobs and records cancellation reason", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-cancel-running-"));
  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      maxConcurrentJobs: 1,
      maxQueuedJobs: 2,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1_000,
      fetchImpl: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal instanceof AbortSignal) {
            signal.addEventListener(
              "abort",
              () => {
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true }
            );
          }
        })
    })
  });

  const accepted = engine.submitJob({ figmaFileKey: "abc", figmaAccessToken: "token" });
  const runningWaitStarted = Date.now();
  while (Date.now() - runningWaitStarted < 2_000) {
    const current = engine.getJob(accepted.jobId);
    if (current?.status === "running") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const canceledJob = engine.cancelJob({ jobId: accepted.jobId, reason: "Manual stop requested." });
  assert.equal(canceledJob?.cancellation?.reason, "Manual stop requested.");

  const status = await waitForTerminalStatus({ getStatus: engine.getJob, jobId: accepted.jobId, timeoutMs: 20_000 });
  assert.equal(status.status, "canceled");
  assert.equal(status.cancellation?.reason, "Manual stop requested.");
  assert.equal(engine.getJobResult(accepted.jobId)?.cancellation?.reason, "Manual stop requested.");
});

test("createJobEngine resolves request brandTheme and generationLocale with submit override precedence", () => {
  const tempRoot = path.join(os.tmpdir(), "workspace-dev-engine-brand-theme");
  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      brandTheme: "sparkasse",
      generationLocale: "de-DE",
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1000,
      fetchImpl: async () => {
        throw new Error("network down");
      }
    })
  });

  const defaultAccepted = engine.submitJob({ figmaFileKey: "abc", figmaAccessToken: "token" });
  const defaultRequest = engine.getJob(defaultAccepted.jobId)?.request;
  assert.equal(defaultRequest?.brandTheme, "sparkasse");
  assert.equal(defaultRequest?.generationLocale, "de-DE");
  assert.equal(defaultRequest?.formHandlingMode, "react_hook_form");

  const overrideAccepted = engine.submitJob({
    figmaFileKey: "abc",
    figmaAccessToken: "token",
    brandTheme: "derived",
    generationLocale: "en-US",
    formHandlingMode: "legacy_use_state"
  });
  const overrideRequest = engine.getJob(overrideAccepted.jobId)?.request;
  assert.equal(overrideRequest?.brandTheme, "derived");
  assert.equal(overrideRequest?.generationLocale, "en-US");
  assert.equal(overrideRequest?.formHandlingMode, "legacy_use_state");
});

test("createJobEngine falls back invalid submit generationLocale and emits deterministic warning log", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-generation-locale-fallback-"));
  const payload = {
    name: "Locale board",
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
              name: "Locale Screen",
              absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
              children: [{ id: "title", type: "TEXT", characters: "Hello", absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 20 } }]
            }
          ]
        }
      ]
    }
  };

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      skipInstall: true,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1_000,
      fetchImpl: async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
    })
  });

  const accepted = engine.submitJob({
    figmaFileKey: "abc",
    figmaAccessToken: "token",
    generationLocale: "invalid_locale"
  });
  const request = engine.getJob(accepted.jobId)?.request;
  assert.equal(request?.generationLocale, "de-DE");

  const status = await waitForTerminalStatus({ getStatus: engine.getJob, jobId: accepted.jobId, timeoutMs: 20_000 });
  assert.equal(
    status.logs.some((entry) =>
      entry.message.includes("Invalid generationLocale override 'invalid_locale' - falling back to 'de-DE'.")
    ),
    true
  );
});

test("createJobEngine marks jobs failed when figma source cannot be fetched", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-fail-"));
  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: true,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1000,
      fetchImpl: async () => {
        throw new Error("network down");
      }
    })
  });

  const accepted = engine.submitJob({ figmaFileKey: "abc", figmaAccessToken: "token" });
  const status = await waitForTerminalStatus({ getStatus: engine.getJob, jobId: accepted.jobId });
  assert.equal(status.status, "failed");
  assert.equal(status.error?.code, "E_FIGMA_NETWORK");
  assert.equal(status.error?.stage, "figma.source");
  assert.equal(engine.getJobResult(accepted.jobId)?.error?.code, "E_FIGMA_NETWORK");
});

test("createJobEngine supports local_json mode without Figma REST calls", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-local-json-"));
  const localJsonPath = path.join(tempRoot, "local-figma.json");
  await writeFile(localJsonPath, `${JSON.stringify(createLocalFigmaPayload(), null, 2)}\n`, "utf8");

  let fetchCalls = 0;
  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      skipInstall: true,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1000,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("unexpected fetch call");
      }
    })
  });

  const accepted = engine.submitJob({
    figmaSourceMode: "local_json",
    figmaJsonPath: localJsonPath
  });
  assert.equal(accepted.acceptedModes.figmaSourceMode, "local_json");

  const status = await waitForTerminalStatus({ getStatus: engine.getJob, jobId: accepted.jobId, timeoutMs: 20_000 });
  assert.equal(status.stages.find((stage) => stage.name === "figma.source")?.status, "completed");
  assert.equal(fetchCalls, 0);
  assert.equal(status.request.figmaSourceMode, "local_json");
  assert.equal(status.request.figmaJsonPath, localJsonPath);
  assert.equal(status.request.formHandlingMode, "react_hook_form");
});

test("createJobEngine fails local_json mode with path-aware figma payload validation errors", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-local-json-invalid-"));
  const localJsonPath = path.join(tempRoot, "local-figma-invalid.json");
  await writeFile(
    localJsonPath,
    `${JSON.stringify(
      {
        name: "Invalid local payload",
        document: {
          id: "0:0",
          type: "DOCUMENT",
          children: [
            {
              type: "CANVAS",
              children: []
            }
          ]
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      skipInstall: true,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1000
    })
  });

  const accepted = engine.submitJob({
    figmaSourceMode: "local_json",
    figmaJsonPath: localJsonPath
  });

  const status = await waitForTerminalStatus({ getStatus: engine.getJob, jobId: accepted.jobId, timeoutMs: 20_000 });
  assert.equal(status.status, "failed");
  assert.equal(status.error?.code, "E_FIGMA_PARSE");
  assert.equal(status.error?.stage, "figma.source");
  assert.equal(status.error?.message.includes("document.children[0].id"), true);
});

test("resolvePreviewAsset enforces safe job id/path and supports direct assets, empty-path fallback, and missing index handling", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-preview-"));
  const reproDir = path.join(tempRoot, "repros", "safe-job");
  await mkdir(reproDir, { recursive: true });
  await writeFile(path.join(reproDir, "index.html"), "<html>ok</html>\n", "utf8");
  await mkdir(path.join(reproDir, "assets"), { recursive: true });
  await writeFile(path.join(reproDir, "assets", "app.js"), "console.log('asset');\n", "utf8");

  const engine = createFastJobEngine({ tempRoot, enablePreview: true });

  const bad = await engine.resolvePreviewAsset("../unsafe", "index.html");
  assert.equal(bad, undefined);

  const escapedPath = await engine.resolvePreviewAsset("safe-job", "../outside.js");
  assert.equal(escapedPath, undefined);

  const indexFromEmptyPath = await engine.resolvePreviewAsset("safe-job", "");
  assert.ok(indexFromEmptyPath);
  assert.equal(indexFromEmptyPath?.contentType, "text/html; charset=utf-8");

  const directAsset = await engine.resolvePreviewAsset("safe-job", "assets/app.js");
  assert.ok(directAsset);
  assert.equal(directAsset?.contentType, "application/javascript; charset=utf-8");
  assert.equal(directAsset?.content.toString("utf8"), "console.log('asset');\n");

  const fallback = await engine.resolvePreviewAsset("safe-job", "missing.txt");
  assert.ok(fallback);
  assert.equal(fallback?.contentType, "text/html; charset=utf-8");
  assert.ok(fallback?.content.toString("utf8").includes("ok"));

  const missingIndex = await engine.resolvePreviewAsset("missing-job", "missing.txt");
  assert.equal(missingIndex, undefined);
});

test("createJobEngine stale-check and remap helpers cover missing, unreadable, and artifact-free cases", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-stale-remap-"));
  const figmaPath = path.join(tempRoot, "local-figma.json");
  await writeFile(figmaPath, `${JSON.stringify(createLocalFigmaPayload(), null, 2)}\n`, "utf8");

  const engine = createFastJobEngine({
    tempRoot,
    fetchImpl: async () => {
      throw new Error("network down");
    }
  });

  try {
    const noBoardAccepted = engine.submitJob({
      figmaSourceMode: "local_json",
      figmaJsonPath: "   "
    });
    const noBoard = await engine.checkStaleDraft({
      jobId: noBoardAccepted.jobId,
      draftNodeIds: []
    });
    assert.equal(noBoard.boardKey, null);
    assert.equal(noBoard.message, "Cannot determine board key for this job.");

    const missingJob = await engine.checkStaleDraft({
      jobId: "missing-job",
      draftNodeIds: ["title"]
    });
    assert.equal(missingJob.stale, false);
    assert.equal(missingJob.latestJobId, null);
    assert.equal(missingJob.sourceJobId, "missing-job");

    const first = await submitCompletedLocalJsonJob({
      engine,
      figmaJsonPath: figmaPath
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await submitCompletedLocalJsonJob({
      engine,
      figmaJsonPath: figmaPath
    });

    const latestSelf = await engine.checkStaleDraft({
      jobId: second.accepted.jobId,
      draftNodeIds: ["title"]
    });
    assert.equal(latestSelf.stale, false);
    assert.equal(latestSelf.latestJobId, null);
    assert.equal(latestSelf.carryForwardAvailable, false);

    const carryForward = await engine.checkStaleDraft({
      jobId: first.accepted.jobId,
      draftNodeIds: ["title"]
    });
    assert.equal(carryForward.stale, true);
    assert.equal(carryForward.latestJobId, second.accepted.jobId);
    assert.equal(carryForward.carryForwardAvailable, true);
    assert.deepEqual(carryForward.unmappedNodeIds, []);

    const unmapped = await engine.checkStaleDraft({
      jobId: first.accepted.jobId,
      draftNodeIds: ["title", "missing-node"]
    });
    assert.equal(unmapped.carryForwardAvailable, false);
    assert.deepEqual(unmapped.unmappedNodeIds, ["missing-node"]);
    assert.match(unmapped.message, /1 node\(s\) could not be resolved/);

    const missingSource = await engine.suggestRemaps({
      sourceJobId: "missing-job",
      latestJobId: second.accepted.jobId,
      unmappedNodeIds: ["missing-node"]
    });
    assert.equal(missingSource.suggestions.length, 0);
    assert.equal(missingSource.rejections.length, 1);
    assert.equal(missingSource.message, "Source job 'missing-job' not found.");

    const missingLatest = await engine.suggestRemaps({
      sourceJobId: first.accepted.jobId,
      latestJobId: "missing-job",
      unmappedNodeIds: ["missing-node"]
    });
    assert.equal(missingLatest.suggestions.length, 0);
    assert.equal(missingLatest.rejections.length, 1);
    assert.equal(missingLatest.message, "Latest job 'missing-job' not found.");

    const failedAccepted = engine.submitJob({
      figmaFileKey: "rest-fail",
      figmaAccessToken: "token"
    });
    const failedStatus = await waitForTerminalStatus({
      getStatus: engine.getJob,
      jobId: failedAccepted.jobId,
      timeoutMs: 20_000
    });
    assert.equal(failedStatus.status, "failed");

    const missingArtifacts = await engine.suggestRemaps({
      sourceJobId: failedAccepted.jobId,
      latestJobId: second.accepted.jobId,
      unmappedNodeIds: ["missing-node"]
    });
    assert.equal(missingArtifacts.suggestions.length, 0);
    assert.equal(missingArtifacts.message, "Could not read Design IR files for remap analysis.");

    const readableRemap = await engine.suggestRemaps({
      sourceJobId: first.accepted.jobId,
      latestJobId: second.accepted.jobId,
      unmappedNodeIds: ["title"]
    });
    assert.equal(readableRemap.sourceJobId, first.accepted.jobId);
    assert.equal(readableRemap.latestJobId, second.accepted.jobId);
    assert.equal(readableRemap.message.length > 0, true);

    await rm(String(second.status.artifacts.designIrFile), { force: true });

    const unreadableStale = await engine.checkStaleDraft({
      jobId: first.accepted.jobId,
      draftNodeIds: ["title"]
    });
    assert.equal(unreadableStale.stale, true);
    assert.equal(unreadableStale.latestJobId, second.accepted.jobId);
    assert.equal(unreadableStale.carryForwardAvailable, false);
    assert.deepEqual(unreadableStale.unmappedNodeIds, []);
    assert.equal(unreadableStale.message, `A newer job '${second.accepted.jobId}' exists for this board.`);

    const unreadableRemap = await engine.suggestRemaps({
      sourceJobId: first.accepted.jobId,
      latestJobId: second.accepted.jobId,
      unmappedNodeIds: ["title"]
    });
    assert.equal(unreadableRemap.suggestions.length, 0);
    assert.equal(unreadableRemap.rejections.length, 0);
    assert.equal(unreadableRemap.message, "Could not read Design IR files for remap analysis.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});

test("createJobEngine fails fast when cleaning removes all screen candidates", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-clean-empty-"));
  const payload = {
    name: "Hidden only board",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "hidden-screen",
              type: "FRAME",
              visible: false,
              children: []
            }
          ]
        }
      ]
    }
  };

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1000,
      fetchImpl: async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
    })
  });

  const accepted = engine.submitJob({ figmaFileKey: "abc", figmaAccessToken: "token" });
  const status = await waitForTerminalStatus({ getStatus: engine.getJob, jobId: accepted.jobId });
  assert.equal(status.status, "failed");
  assert.equal(status.error?.code, "E_FIGMA_CLEAN_EMPTY");
  assert.equal(status.error?.stage, "ir.derive");
  assert.equal(status.error?.diagnostics?.[0]?.code, "E_FIGMA_CLEAN_EMPTY");
  assert.equal(status.error?.diagnostics?.[0]?.severity, "error");
  assert.equal(status.error?.diagnostics?.[0]?.details?.screenCandidateCount, 0);
  assert.equal(
    String(status.error?.diagnostics?.[0]?.suggestion ?? "").includes("visible FRAME/COMPONENT"),
    true
  );

  const rawPath = path.join(status.artifacts.jobDir, "figma.raw.json");
  const cleanedPath = path.join(status.artifacts.jobDir, "figma.json");
  const stageTimingsPath = path.join(status.artifacts.jobDir, "stage-timings.json");
  const raw = await readFile(rawPath, "utf8");
  const cleaned = await readFile(cleanedPath, "utf8");
  const stageTimings = JSON.parse(await readFile(stageTimingsPath, "utf8")) as {
    diagnostics?: Array<{ code?: string }>;
  };

  assert.equal(raw.length > cleaned.length, true);
  assert.equal(cleaned.includes('"visible": false'), false);
  assert.equal(stageTimings.diagnostics?.some((entry) => entry.code === "E_FIGMA_CLEAN_EMPTY"), true);
});

test("createJobEngine surfaces truncation/classification warnings in failure diagnostics with figma links", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-diagnostics-warnings-"));
  const payload = {
    name: "Diagnostics board",
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
              name: "Main Screen",
              children: [
                {
                  id: "nested-1",
                  type: "FRAME",
                  name: "Layer Alpha",
                  children: [
                    {
                      id: "nested-2",
                      type: "FRAME",
                      name: "Layer Beta",
                      children: [{ id: "nested-3", type: "RECTANGLE", name: "Unknown Box", children: [] }]
                    }
                  ]
                },
                { id: "rect-1", type: "RECTANGLE", name: "Mystery Block", children: [] },
                { id: "rect-2", type: "RECTANGLE", name: "Mystery Block 2", children: [] }
              ]
            }
          ]
        }
      ]
    }
  };

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      skipInstall: true,
      figmaScreenElementBudget: 2,
      figmaScreenElementMaxDepth: 1,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1_000,
      fetchImpl: async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
    })
  });

  const accepted = engine.submitJob({ figmaFileKey: "abc123", figmaAccessToken: "token" });
  const status = await waitForTerminalStatus({ getStatus: engine.getJob, jobId: accepted.jobId, timeoutMs: 20_000 });
  assert.equal(status.status, "failed");
  assert.equal(status.error?.code, "E_VALIDATE_PROJECT");
  assert.equal(status.error?.diagnostics?.some((entry) => entry.code === "W_IR_CLASSIFICATION_FALLBACK"), true);
  assert.equal(status.error?.diagnostics?.some((entry) => entry.code === "W_IR_DEPTH_TRUNCATION"), true);
  assert.equal(
    status.error?.diagnostics?.some((entry) => entry.figmaUrl?.includes("https://www.figma.com/design/abc123?node-id=")),
    true
  );

  const stageTimingsPath = path.join(status.artifacts.jobDir, "stage-timings.json");
  const stageTimings = JSON.parse(await readFile(stageTimingsPath, "utf8")) as {
    diagnostics?: Array<{ code?: string }>;
  };
  assert.equal(stageTimings.diagnostics?.some((entry) => entry.code === "W_IR_CLASSIFICATION_FALLBACK"), true);
  assert.equal(stageTimings.diagnostics?.some((entry) => entry.code === "E_VALIDATE_PROJECT"), true);
});

test("createJobEngine surfaces budget truncation diagnostics with figma links", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-diagnostics-budget-"));
  const payload = {
    name: "Budget diagnostics board",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-budget-1",
              type: "FRAME",
              name: "Budget Screen",
              children: Array.from({ length: 140 }, (_, index) => ({
                id: `rect-${index + 1}`,
                type: "RECTANGLE",
                name: `Block ${index + 1}`,
                children: []
              }))
            }
          ]
        }
      ]
    }
  };

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      skipInstall: true,
      figmaScreenElementBudget: 2,
      figmaScreenElementMaxDepth: 14,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1_000,
      fetchImpl: async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
    })
  });

  const accepted = engine.submitJob({ figmaFileKey: "abc123", figmaAccessToken: "token" });
  const status = await waitForTerminalStatus({ getStatus: engine.getJob, jobId: accepted.jobId, timeoutMs: 20_000 });
  assert.equal(status.status, "failed");
  assert.equal(status.error?.code, "E_VALIDATE_PROJECT");
  assert.equal(
    status.error?.diagnostics?.some((entry) => entry.code === "W_IR_ELEMENT_BUDGET_TRUNCATION"),
    true
  );
  assert.equal(
    status.error?.diagnostics?.some((entry) => entry.figmaUrl?.includes("https://www.figma.com/design/abc123?node-id=")),
    true
  );
});

const createImageBoardPayload = () => ({
  name: "Image Board",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-image",
            type: "FRAME",
            name: "Image Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
            children: [
              {
                id: "image-node",
                type: "RECTANGLE",
                name: "Hero",
                fills: [{ type: "IMAGE" }],
                absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 180 },
                children: []
              }
            ]
          }
        ]
      }
    ]
  }
});

test("createJobEngine skips /v1/images export calls when exportImages=false", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-no-image-export-"));
  const payload = createImageBoardPayload();
  let imageEndpointCalls = 0;

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      exportImages: false,
      skipInstall: true,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1_000,
      fetchImpl: async (input) => {
        const rawUrl = typeof input === "string" ? input : input.toString();
        if (rawUrl.includes("/v1/images/")) {
          imageEndpointCalls += 1;
        }
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }
    })
  });

  const accepted = engine.submitJob({ figmaFileKey: "abc", figmaAccessToken: "token" });
  const status = await waitForTerminalStatus({ getStatus: engine.getJob, jobId: accepted.jobId, timeoutMs: 20_000 });
  assert.equal(imageEndpointCalls, 0);
  assert.equal(status.stages.find((stage) => stage.name === "codegen.generate")?.status, "completed");
});

test("createJobEngine continues codegen when image export warns on /v1/images failures", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-engine-image-export-warn-"));
  const payload = createImageBoardPayload();
  let imageEndpointCalls = 0;

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      exportImages: true,
      skipInstall: true,
      figmaMaxRetries: 1,
      figmaRequestTimeoutMs: 1_000,
      fetchImpl: async (input) => {
        const rawUrl = typeof input === "string" ? input : input.toString();
        if (rawUrl.includes("/v1/images/")) {
          imageEndpointCalls += 1;
          return new Response(JSON.stringify({ err: "upstream unavailable" }), {
            status: 500,
            headers: {
              "content-type": "application/json"
            }
          });
        }
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }
    })
  });

  const accepted = engine.submitJob({ figmaFileKey: "abc", figmaAccessToken: "token" });
  const status = await waitForTerminalStatus({ getStatus: engine.getJob, jobId: accepted.jobId, timeoutMs: 20_000 });
  assert.equal(imageEndpointCalls > 0, true);
  assert.equal(status.stages.find((stage) => stage.name === "codegen.generate")?.status, "completed");
  assert.ok(status.logs.some((entry) => entry.message.toLowerCase().includes("image asset export warning")));
});
