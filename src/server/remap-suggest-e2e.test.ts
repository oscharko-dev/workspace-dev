/**
 * End-to-end test for the remap-suggest endpoint through the HTTP server.
 *
 * Uses local_json source mode with distinct fixtures for source and latest jobs.
 * Exercises the full HTTP route flow:
 *   POST /workspace/submit (job A) -> poll -> POST /workspace/submit (job B with changed nodes) -> poll
 *   -> POST /workspace/jobs/{jobA}/remap-suggest
 *
 * Covers:
 *   - Remap suggestions returned for unmapped nodes
 *   - Rejections returned for nodes that cannot be mapped
 *   - 405 for GET requests
 *   - 400 for missing latestJobId
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/466
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobEngine, resolveRuntimeSettings } from "../job-engine.js";
import { createWorkspaceRequestHandler } from "./request-handler.js";

/** Source fixture: has heading-1, card-1 with card-text child. */
const createSourceFigmaPayload = () => ({
  name: "Remap E2E Source Board",
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
            absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 800 },
            children: [
              {
                id: "heading-1",
                type: "TEXT",
                characters: "Hello Remap",
                absoluteBoundingBox: { x: 20, y: 20, width: 300, height: 40 },
                style: { fontSize: 32, fontWeight: 700, lineHeightPx: 40 },
                fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }]
              },
              {
                id: "card-1",
                type: "FRAME",
                name: "InfoCard",
                absoluteBoundingBox: { x: 20, y: 80, width: 400, height: 200 },
                fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
                cornerRadius: 8,
                children: [
                  {
                    id: "card-text",
                    type: "TEXT",
                    characters: "Card content",
                    absoluteBoundingBox: { x: 36, y: 96, width: 368, height: 24 },
                    style: { fontSize: 16, fontWeight: 400, lineHeightPx: 24 },
                    fills: [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2, a: 1 } }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
});

/** Latest fixture: heading-1 renamed, card-1 ID changed, card-text removed, new element added. */
const createLatestFigmaPayload = () => ({
  name: "Remap E2E Latest Board",
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
            absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 800 },
            children: [
              {
                id: "heading-new",
                type: "TEXT",
                characters: "Hello Remap v2",
                absoluteBoundingBox: { x: 20, y: 20, width: 300, height: 40 },
                style: { fontSize: 32, fontWeight: 700, lineHeightPx: 40 },
                fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }]
              },
              {
                id: "card-new",
                type: "FRAME",
                name: "InfoCard",
                absoluteBoundingBox: { x: 20, y: 80, width: 400, height: 200 },
                fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
                cornerRadius: 8,
                children: [
                  {
                    id: "card-body-new",
                    type: "TEXT",
                    characters: "Updated card",
                    absoluteBoundingBox: { x: 36, y: 96, width: 368, height: 24 },
                    style: { fontSize: 16, fontWeight: 400, lineHeightPx: 24 },
                    fills: [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2, a: 1 } }]
                  }
                ]
              },
              {
                id: "btn-new",
                type: "FRAME",
                name: "Submit",
                absoluteBoundingBox: { x: 20, y: 300, width: 120, height: 40 },
                fills: [{ type: "SOLID", color: { r: 0.2, g: 0.4, b: 0.9, a: 1 } }],
                cornerRadius: 4,
                children: []
              }
            ]
          }
        ]
      }
    ]
  }
});

const getPort = (): number => 20_000 + Math.floor(Math.random() * 10_000);

const jsonFetch = async (url: string, options?: RequestInit): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options?.headers as Record<string, string> | undefined)
    }
  });
  const body = (await response.json()) as unknown;
  return { status: response.status, body };
};

const pollForTerminal = async ({
  baseUrl,
  jobId,
  timeoutMs = 180_000
}: {
  baseUrl: string;
  jobId: string;
  timeoutMs?: number;
}): Promise<{ status: number; body: Record<string, unknown> }> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await jsonFetch(`${baseUrl}/workspace/jobs/${jobId}`);
    const body = result.body as Record<string, unknown>;
    const jobStatus = body.status as string;
    if (jobStatus === "completed" || jobStatus === "failed" || jobStatus === "canceled") {
      return { status: result.status, body };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for job ${jobId} to complete`);
};

test("e2e: remap-suggest returns suggestions and rejections for changed IR", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-remap-e2e-"));
  const workspaceRoot = path.join(tempRoot, "workspace-root");
  await mkdir(workspaceRoot, { recursive: true });
  const port = getPort();
  const host = "127.0.0.1";
  const baseUrl = `http://${host}:${port}`;

  // Write source and latest fixtures as separate files
  const sourceFigmaPath = path.join(workspaceRoot, "figma-source.json");
  const latestFigmaPath = path.join(workspaceRoot, "figma-latest.json");
  await writeFile(sourceFigmaPath, JSON.stringify(createSourceFigmaPayload()), "utf8");
  await writeFile(latestFigmaPath, JSON.stringify(createLatestFigmaPayload()), "utf8");

  const paths = {
    outputRoot: tempRoot,
    jobsRoot: path.join(tempRoot, "jobs"),
    reprosRoot: path.join(tempRoot, "repros"),
    workspaceRoot
  };

  const runtimeSettings = resolveRuntimeSettings({
    enablePreview: false,
    enableUiValidation: false,
    enableUnitTestValidation: false,
    installPreferOffline: true
  });

  const jobEngine = createJobEngine({
    resolveBaseUrl: () => baseUrl,
    paths,
    runtime: runtimeSettings
  });

  let resolvedPort = port;
  const handler = createWorkspaceRequestHandler({
    host,
    getResolvedPort: () => resolvedPort,
    startedAt: Date.now(),
    absoluteOutputRoot: tempRoot,
    defaults: { figmaSourceMode: "rest", llmCodegenMode: "deterministic" },
    runtime: { previewEnabled: false },
    jobEngine,
    moduleDir: path.resolve(import.meta.dirname ?? ".", "..")
  });

  const server = http.createServer(async (req, res) => {
    try {
      await handler(req, res);
    } catch {
      if (!res.writableEnded) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "INTERNAL_ERROR" }));
      }
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr !== null) {
        resolvedPort = addr.port;
      }
      resolve();
    });
  });

  try {
    // 1. Submit source job
    const sourceSubmit = await jsonFetch(`${baseUrl}/workspace/submit`, {
      method: "POST",
      body: JSON.stringify({
        figmaJsonPath: sourceFigmaPath,
        figmaSourceMode: "local_json"
      })
    });
    assert.equal(sourceSubmit.status, 202);
    const sourceJobId = (sourceSubmit.body as Record<string, unknown>).jobId as string;
    const sourceCompleted = await pollForTerminal({ baseUrl, jobId: sourceJobId });
    assert.equal(sourceCompleted.body.status, "completed");

    // 2. Submit latest job (different Figma file with changed nodes)
    const latestSubmit = await jsonFetch(`${baseUrl}/workspace/submit`, {
      method: "POST",
      body: JSON.stringify({
        figmaJsonPath: latestFigmaPath,
        figmaSourceMode: "local_json"
      })
    });
    assert.equal(latestSubmit.status, 202);
    const latestJobId = (latestSubmit.body as Record<string, unknown>).jobId as string;
    const latestCompleted = await pollForTerminal({ baseUrl, jobId: latestJobId });
    assert.equal(latestCompleted.body.status, "completed");

    // 3. Request remap suggestions for unmapped nodes
    const remapResult = await jsonFetch(
      `${baseUrl}/workspace/jobs/${sourceJobId}/remap-suggest`,
      {
        method: "POST",
        body: JSON.stringify({
          sourceJobId,
          latestJobId,
          unmappedNodeIds: ["heading-1", "card-1", "card-text"]
        })
      }
    );

    assert.equal(remapResult.status, 200);
    const remapBody = remapResult.body as Record<string, unknown>;
    assert.equal(remapBody.sourceJobId, sourceJobId);
    assert.equal(remapBody.latestJobId, latestJobId);

    const suggestions = remapBody.suggestions as Array<Record<string, unknown>>;
    const rejections = remapBody.rejections as Array<Record<string, unknown>>;

    assert.ok(Array.isArray(suggestions));
    assert.ok(Array.isArray(rejections));

    // Total should equal unmapped count
    assert.equal(suggestions.length + rejections.length, 3);

    // Verify each suggestion has required fields
    for (const suggestion of suggestions) {
      assert.ok(typeof suggestion.sourceNodeId === "string");
      assert.ok(typeof suggestion.targetNodeId === "string");
      assert.ok(typeof suggestion.rule === "string");
      assert.ok(typeof suggestion.confidence === "string");
      assert.ok(typeof suggestion.reason === "string");
      assert.ok(["high", "medium", "low"].includes(suggestion.confidence as string));
      assert.ok(["exact-id", "name-and-type", "name-fuzzy-and-type", "ancestry-and-type"].includes(suggestion.rule as string));
    }

    // Verify each rejection has required fields
    for (const rejection of rejections) {
      assert.ok(typeof rejection.sourceNodeId === "string");
      assert.ok(typeof rejection.reason === "string");
    }

    // Verify the message is non-empty
    assert.ok(typeof remapBody.message === "string");
    assert.ok((remapBody.message as string).length > 0);
  } finally {
    server.close();
  }
});

test("e2e: remap-suggest returns 405 for GET requests", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-remap-method-e2e-"));
  const workspaceRoot = path.join(tempRoot, "workspace-root");
  await mkdir(workspaceRoot, { recursive: true });
  const port = getPort();
  const host = "127.0.0.1";
  const baseUrl = `http://${host}:${port}`;

  const paths = {
    outputRoot: tempRoot,
    jobsRoot: path.join(tempRoot, "jobs"),
    reprosRoot: path.join(tempRoot, "repros"),
    workspaceRoot
  };

  const runtimeSettings = resolveRuntimeSettings({
    enablePreview: false,
    enableUiValidation: false,
    enableUnitTestValidation: false,
    installPreferOffline: true
  });

  const jobEngine = createJobEngine({
    resolveBaseUrl: () => baseUrl,
    paths,
    runtime: runtimeSettings
  });

  let resolvedPort = port;
  const handler = createWorkspaceRequestHandler({
    host,
    getResolvedPort: () => resolvedPort,
    startedAt: Date.now(),
    absoluteOutputRoot: tempRoot,
    defaults: { figmaSourceMode: "rest", llmCodegenMode: "deterministic" },
    runtime: { previewEnabled: false },
    jobEngine,
    moduleDir: path.resolve(import.meta.dirname ?? ".", "..")
  });

  const server = http.createServer(async (req, res) => {
    try {
      await handler(req, res);
    } catch {
      if (!res.writableEnded) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "INTERNAL_ERROR" }));
      }
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr !== null) {
        resolvedPort = addr.port;
      }
      resolve();
    });
  });

  try {
    const result = await jsonFetch(`${baseUrl}/workspace/jobs/any-job-id/remap-suggest`);
    assert.equal(result.status, 405);
    const body = result.body as Record<string, unknown>;
    assert.equal(body.error, "METHOD_NOT_ALLOWED");
  } finally {
    server.close();
  }
});

test("e2e: remap-suggest returns 400 when latestJobId is missing", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-remap-validation-e2e-"));
  const workspaceRoot = path.join(tempRoot, "workspace-root");
  await mkdir(workspaceRoot, { recursive: true });
  const port = getPort();
  const host = "127.0.0.1";
  const baseUrl = `http://${host}:${port}`;

  const paths = {
    outputRoot: tempRoot,
    jobsRoot: path.join(tempRoot, "jobs"),
    reprosRoot: path.join(tempRoot, "repros"),
    workspaceRoot
  };

  const runtimeSettings = resolveRuntimeSettings({
    enablePreview: false,
    enableUiValidation: false,
    enableUnitTestValidation: false,
    installPreferOffline: true
  });

  const jobEngine = createJobEngine({
    resolveBaseUrl: () => baseUrl,
    paths,
    runtime: runtimeSettings
  });

  let resolvedPort = port;
  const handler = createWorkspaceRequestHandler({
    host,
    getResolvedPort: () => resolvedPort,
    startedAt: Date.now(),
    absoluteOutputRoot: tempRoot,
    defaults: { figmaSourceMode: "rest", llmCodegenMode: "deterministic" },
    runtime: { previewEnabled: false },
    jobEngine,
    moduleDir: path.resolve(import.meta.dirname ?? ".", "..")
  });

  const server = http.createServer(async (req, res) => {
    try {
      await handler(req, res);
    } catch {
      if (!res.writableEnded) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "INTERNAL_ERROR" }));
      }
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr !== null) {
        resolvedPort = addr.port;
      }
      resolve();
    });
  });

  try {
    const result = await jsonFetch(`${baseUrl}/workspace/jobs/some-job-id/remap-suggest`, {
      method: "POST",
      body: JSON.stringify({
        sourceJobId: "some-job-id",
        unmappedNodeIds: ["node-1"]
      })
    });
    assert.equal(result.status, 400);
    const body = result.body as Record<string, unknown>;
    assert.equal(body.error, "VALIDATION_ERROR");
  } finally {
    server.close();
  }
});
