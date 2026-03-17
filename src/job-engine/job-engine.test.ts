import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobEngine, resolveRuntimeSettings } from "../job-engine.js";

const waitForTerminalStatus = async ({
  getStatus,
  jobId,
  timeoutMs = 5000
}: {
  getStatus: (jobId: string) => ReturnType<ReturnType<typeof createJobEngine>["getJob"]>;
  jobId: string;
  timeoutMs?: number;
}) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = getStatus(jobId);
    if (status && (status.status === "completed" || status.status === "failed")) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for job status");
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

  const overrideAccepted = engine.submitJob({
    figmaFileKey: "abc",
    figmaAccessToken: "token",
    brandTheme: "derived",
    generationLocale: "en-US"
  });
  const overrideRequest = engine.getJob(overrideAccepted.jobId)?.request;
  assert.equal(overrideRequest?.brandTheme, "derived");
  assert.equal(overrideRequest?.generationLocale, "en-US");
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
});

test("resolvePreviewAsset enforces safe job id/path and supports index fallback", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-preview-"));
  const reproDir = path.join(tempRoot, "repros", "safe-job");
  await mkdir(reproDir, { recursive: true });
  await writeFile(path.join(reproDir, "index.html"), "<html>ok</html>\n", "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({ enablePreview: true, figmaMaxRetries: 1, figmaRequestTimeoutMs: 1000 })
  });

  const bad = await engine.resolvePreviewAsset("../unsafe", "index.html");
  assert.equal(bad, undefined);

  const fallback = await engine.resolvePreviewAsset("safe-job", "missing.txt");
  assert.ok(fallback);
  assert.equal(fallback?.contentType, "text/html; charset=utf-8");
  assert.ok(fallback?.content.toString("utf8").includes("ok"));
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

  const rawPath = path.join(status.artifacts.jobDir, "figma.raw.json");
  const cleanedPath = path.join(status.artifacts.jobDir, "figma.json");
  const raw = await readFile(rawPath, "utf8");
  const cleaned = await readFile(cleanedPath, "utf8");

  assert.equal(raw.length > cleaned.length, true);
  assert.equal(cleaned.includes('"visible": false'), false);
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
