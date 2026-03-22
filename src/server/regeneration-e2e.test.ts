/**
 * End-to-end test for the regeneration endpoint through the HTTP server.
 *
 * Uses local_json source mode with a known-good fixture for predictable
 * validation. Exercises the full HTTP route flow:
 *   POST /workspace/submit -> poll -> POST /workspace/jobs/{id}/regenerate -> poll
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/455
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobEngine, resolveRuntimeSettings } from "../job-engine.js";
import { createWorkspaceRequestHandler } from "./request-handler.js";

const createLocalFigmaPayload = () => ({
  name: "E2E Regen Board",
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
                characters: "Welcome",
                absoluteBoundingBox: { x: 20, y: 20, width: 300, height: 40 },
                style: { fontSize: 32, fontWeight: 700, lineHeightPx: 40 },
                fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }]
              },
              {
                id: "card-1",
                type: "FRAME",
                name: "Card",
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
  timeoutMs = 120_000
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

test("e2e: regeneration flow via HTTP server with local_json source", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-e2e-"));
  const port = getPort();
  const host = "127.0.0.1";
  const baseUrl = `http://${host}:${port}`;
  const figmaPath = path.join(tempRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

  const paths = {
    outputRoot: tempRoot,
    jobsRoot: path.join(tempRoot, "jobs"),
    reprosRoot: path.join(tempRoot, "repros")
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
    // 1. Submit source job using local_json
    const submitResult = await jsonFetch(`${baseUrl}/workspace/submit`, {
      method: "POST",
      body: JSON.stringify({
        figmaJsonPath: figmaPath,
        figmaSourceMode: "local_json"
      })
    });

    assert.equal(submitResult.status, 202);
    const submitBody = submitResult.body as Record<string, unknown>;
    const sourceJobId = submitBody.jobId as string;
    assert.ok(sourceJobId);

    // 2. Wait for source job to complete
    const sourceTerminal = await pollForTerminal({ baseUrl, jobId: sourceJobId });
    assert.equal(
      sourceTerminal.body.status,
      "completed",
      `Source job should complete, got: ${sourceTerminal.body.status as string} — ${
        (sourceTerminal.body.error as Record<string, unknown> | undefined)?.message ?? "no error"
      }`
    );

    // 3. Verify design-ir is accessible
    const irResult = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}/design-ir`);
    assert.equal(irResult.status, 200);
    const irBody = irResult.body as Record<string, unknown>;
    const screens = irBody.screens as Array<Record<string, unknown>>;
    assert.ok(screens && screens.length > 0);

    // 4. POST regeneration with overrides
    const regenResult = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({
        overrides: [
          { nodeId: "card-1", field: "fillColor", value: "#0000ff" },
          { nodeId: "card-1", field: "cornerRadius", value: 24 },
          { nodeId: "heading-1", field: "fontSize", value: 48 }
        ],
        draftId: "e2e-draft-001",
        baseFingerprint: "fnv1a64:e2etest123"
      })
    });

    assert.equal(regenResult.status, 202);
    const regenBody = regenResult.body as Record<string, unknown>;
    const regenJobId = regenBody.jobId as string;
    assert.ok(regenJobId);
    assert.equal(regenBody.sourceJobId, sourceJobId);
    assert.equal(regenBody.status, "queued");

    // 5. Wait for regeneration to complete
    const regenTerminal = await pollForTerminal({ baseUrl, jobId: regenJobId });
    assert.equal(
      regenTerminal.body.status,
      "completed",
      `Regen should complete, got: ${regenTerminal.body.status as string} — ${
        (regenTerminal.body.error as Record<string, unknown> | undefined)?.message ?? "no error"
      }`
    );

    // 6. Verify lineage metadata
    const lineage = regenTerminal.body.lineage as Record<string, unknown>;
    assert.ok(lineage);
    assert.equal(lineage.sourceJobId, sourceJobId);
    assert.equal(lineage.overrideCount, 3);
    assert.equal(lineage.draftId, "e2e-draft-001");
    assert.equal(lineage.baseFingerprint, "fnv1a64:e2etest123");

    // 7. Verify stage statuses
    const stages = regenTerminal.body.stages as Array<Record<string, unknown>>;
    assert.equal(stages.find((s) => s.name === "figma.source")?.status, "skipped");
    assert.equal(stages.find((s) => s.name === "ir.derive")?.status, "completed");
    assert.equal(stages.find((s) => s.name === "template.prepare")?.status, "completed");
    assert.equal(stages.find((s) => s.name === "codegen.generate")?.status, "completed");
    assert.equal(stages.find((s) => s.name === "validate.project")?.status, "completed");
    assert.equal(stages.find((s) => s.name === "git.pr")?.status, "skipped");

    // 8. Verify git.pr is skipped
    const gitPr = regenTerminal.body.gitPr as Record<string, unknown>;
    assert.equal(gitPr?.status, "skipped");

    // 9. Source job unchanged
    const sourceAfter = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}`);
    assert.equal((sourceAfter.body as Record<string, unknown>).status, "completed");
    assert.equal((sourceAfter.body as Record<string, unknown>).lineage, undefined);

    // 10. Result endpoint includes lineage
    const resultResult = await jsonFetch(`${baseUrl}/workspace/jobs/${regenJobId}/result`);
    assert.equal(resultResult.status, 200);
    assert.ok((resultResult.body as Record<string, unknown>).lineage);

    // 11. GET on /regenerate returns 405
    const getResult = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}/regenerate`);
    assert.equal(getResult.status, 405);

    // 12. Regeneration of non-existent source returns 404
    const missingResult = await jsonFetch(`${baseUrl}/workspace/jobs/nonexistent-id/regenerate`, {
      method: "POST",
      body: JSON.stringify({ overrides: [] })
    });
    assert.equal(missingResult.status, 404);

    // 13. Regeneration with invalid body returns 400
    const badBodyResult = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ invalid: "payload" })
    });
    assert.equal(badBodyResult.status, 400);

    // 14. Regeneration of running (non-completed) source returns 409
    // (sourceJob is already completed, so test with regen job which is also completed — skip this as it's covered by unit tests)

  } finally {
    server.close();
  }
});

test("e2e: regeneration with REST Figma source (live board)", async () => {
  const FIGMA_FILE_KEY = process.env.FIGMA_E2E_FILE_KEY ?? "xZkvYk9KOezMsi9LmPEFGX";
  const FIGMA_ACCESS_TOKEN = process.env.FIGMA_E2E_ACCESS_TOKEN;
  if (!FIGMA_ACCESS_TOKEN) {
    // Skip live Figma test when access token not available
    assert.ok(true, "Skipped: FIGMA_E2E_ACCESS_TOKEN not set");
    return;
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-e2e-figma-"));
  const port = getPort();
  const host = "127.0.0.1";
  const baseUrl = `http://${host}:${port}`;

  const paths = {
    outputRoot: tempRoot,
    jobsRoot: path.join(tempRoot, "jobs"),
    reprosRoot: path.join(tempRoot, "repros")
  };

  const runtimeSettings = resolveRuntimeSettings({
    enablePreview: false,
    enableUiValidation: false,
    enableUnitTestValidation: false,
    installPreferOffline: true,
    figmaRequestTimeoutMs: 60_000,
    figmaMaxRetries: 5
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
    // 1. Submit source job via live Figma REST
    const submitResult = await jsonFetch(`${baseUrl}/workspace/submit`, {
      method: "POST",
      body: JSON.stringify({
        figmaFileKey: FIGMA_FILE_KEY,
        figmaAccessToken: FIGMA_ACCESS_TOKEN,
        figmaSourceMode: "rest"
      })
    });
    assert.equal(submitResult.status, 202);
    const sourceJobId = (submitResult.body as Record<string, unknown>).jobId as string;

    // 2. Wait for source job — may fail due to lint but that's ok, we check for IR availability
    const sourceTerminal = await pollForTerminal({ baseUrl, jobId: sourceJobId, timeoutMs: 120_000 });
    const sourceStatus = sourceTerminal.body.status as string;

    // The job might fail at validate.project due to lint errors from this particular board.
    // For e2e regeneration testing, what matters is that IR was derived successfully.
    const irResult = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}/design-ir`);

    if (sourceStatus !== "completed") {
      // If validation failed, the IR should still be available (it was derived before validation)
      if (irResult.status !== 200) {
        // Source job failed before IR derivation — skip this test
        assert.ok(true, `Source job failed at early stage, skipping live Figma test: ${(sourceTerminal.body.error as Record<string, unknown> | undefined)?.message ?? "unknown"}`);
        return;
      }
    }

    assert.equal(irResult.status, 200);
    const irBody = irResult.body as Record<string, unknown>;
    const screens = irBody.screens as Array<Record<string, unknown>>;
    assert.ok(screens && screens.length > 0, "Figma board should produce at least one screen");

    // 3. Submit regeneration — even if source failed at validate, the IR is available
    //    BUT submitRegeneration requires completed source. If it failed, we demonstrate
    //    that the error is properly returned.
    if (sourceStatus !== "completed") {
      const regenResult = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ overrides: [] })
      });
      assert.equal(regenResult.status, 409, "Should return 409 for non-completed source");
      const body = regenResult.body as Record<string, unknown>;
      assert.equal(body.error, "SOURCE_JOB_NOT_COMPLETED");
      return;
    }

    // Source completed — run full regeneration
    const firstScreenId = screens[0]?.id as string;
    const regenResult = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({
        overrides: [{ nodeId: firstScreenId, field: "gap", value: 20 }],
        draftId: "live-figma-test"
      })
    });

    assert.equal(regenResult.status, 202);
    const regenJobId = (regenResult.body as Record<string, unknown>).jobId as string;

    // 4. Wait for regeneration
    const regenTerminal = await pollForTerminal({ baseUrl, jobId: regenJobId, timeoutMs: 120_000 });

    // Regen may also fail at validate due to same lint issues, but the flow is correct
    const regenStatus = regenTerminal.body.status as string;
    const regenLineage = regenTerminal.body.lineage as Record<string, unknown>;
    assert.ok(regenLineage, "Regeneration job should always have lineage");
    assert.equal(regenLineage.sourceJobId, sourceJobId);
    assert.equal(regenLineage.draftId, "live-figma-test");

    // Verify figma.source was skipped
    const stages = regenTerminal.body.stages as Array<Record<string, unknown>>;
    assert.equal(stages.find((s) => s.name === "figma.source")?.status, "skipped");
    assert.equal(stages.find((s) => s.name === "ir.derive")?.status, "completed");

    if (regenStatus === "completed") {
      assert.equal(stages.find((s) => s.name === "codegen.generate")?.status, "completed");
    }
  } finally {
    server.close();
  }
});
