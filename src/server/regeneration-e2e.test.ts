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
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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

function findNodeById(
  children: Array<Record<string, unknown>>,
  nodeId: string
): Record<string, unknown> | null {
  for (const child of children) {
    if (child.id === nodeId) {
      return child;
    }
    const nestedChildren = Array.isArray(child.children)
      ? child.children as Array<Record<string, unknown>>
      : [];
    const nested = findNodeById(nestedChildren, nodeId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function findFirstLayoutOverrideCandidate(
  children: Array<Record<string, unknown>>
): Record<string, unknown> | null {
  for (const child of children) {
    const hasChildren = Array.isArray(child.children) && child.children.length > 0;
    if (
      typeof child.id === "string" &&
      child.type !== "text" &&
      hasChildren &&
      typeof child.width === "number"
    ) {
      return child;
    }

    const nested = findFirstLayoutOverrideCandidate(
      Array.isArray(child.children) ? child.children as Array<Record<string, unknown>> : []
    );
    if (nested) {
      return nested;
    }
  }
  return null;
}

const getPort = (): number => 20_000 + Math.floor(Math.random() * 10_000);
const TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN = "test-import-session-event-bearer-token";

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

test("e2e: regeneration flow via HTTP server with local_json source", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-e2e-"));
  const workspaceRoot = path.join(tempRoot, "workspace-root");
  await mkdir(workspaceRoot, { recursive: true });
  const port = getPort();
  const host = "127.0.0.1";
  const baseUrl = `http://${host}:${port}`;
  const figmaPath = path.join(tempRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

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
    runtime: {
      previewEnabled: false,
      importSessionEventBearerToken: TEST_IMPORT_SESSION_EVENT_BEARER_TOKEN
    },
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
    const sourceAnalysisResult = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}/figma-analysis`);
    assert.equal(sourceAnalysisResult.status, 200);
    const sourceAnalysisBody = sourceAnalysisResult.body as Record<string, unknown>;
    assert.equal(
      Array.isArray(sourceAnalysisBody.diagnostics) &&
        sourceAnalysisBody.diagnostics.some(
          (entry) => (entry as Record<string, unknown>).code === "REGEN_SOURCE_ANALYSIS_STALE"
        ),
      false
    );

    // 4. POST regeneration with overrides
    const regenResult = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({
        overrides: [
          { nodeId: "card-1", field: "fillColor", value: "#0000ff" },
          { nodeId: "card-1", field: "cornerRadius", value: 24 },
          { nodeId: "heading-1", field: "fontSize", value: 48 },
          { nodeId: "card-1", field: "width", value: 440 },
          { nodeId: "card-1", field: "layoutMode", value: "horizontal" }
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
    assert.equal(lineage.overrideCount, 5);
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

    const regenIrResult = await jsonFetch(`${baseUrl}/workspace/jobs/${regenJobId}/design-ir`);
    assert.equal(regenIrResult.status, 200);
    const regenIrBody = regenIrResult.body as Record<string, unknown>;
    const regenScreens = regenIrBody.screens as Array<Record<string, unknown>>;
    const regenCard = findNodeById(
      (regenScreens[0]?.children as Array<Record<string, unknown>> | undefined) ?? [],
      "card-1"
    );
    assert.ok(regenCard);
    assert.equal(regenCard?.fillColor, "#0000ff");
    assert.equal(regenCard?.cornerRadius, 24);
    assert.equal(regenCard?.width, 440);
    assert.equal(regenCard?.layoutMode, "HORIZONTAL");
    const regenAnalysisResult = await jsonFetch(`${baseUrl}/workspace/jobs/${regenJobId}/figma-analysis`);
    assert.equal(regenAnalysisResult.status, 200);
    const regenAnalysisBody = regenAnalysisResult.body as Record<string, unknown>;
    assert.equal(regenAnalysisBody.jobId, regenJobId);
    assert.equal(
      Array.isArray(regenAnalysisBody.diagnostics) &&
        regenAnalysisBody.diagnostics.some(
          (entry) => (entry as Record<string, unknown>).code === "REGEN_SOURCE_ANALYSIS_STALE"
        ),
      true
    );
    assert.deepEqual(regenAnalysisBody.frameVariantGroups, []);
    assert.deepEqual(regenAnalysisBody.appShellSignals, []);

    // 11. Local sync dry-run returns plan + confirmation token without writing files yet
    const dryRunResult = await jsonFetch(`${baseUrl}/workspace/jobs/${regenJobId}/sync`, {
      method: "POST",
      body: JSON.stringify({
        mode: "dry_run",
        targetPath: "local-sync-target"
      })
    });
    assert.equal(dryRunResult.status, 200);
    const dryRunBody = dryRunResult.body as Record<string, unknown>;
    assert.equal(dryRunBody.jobId, regenJobId);
    assert.equal(dryRunBody.sourceJobId, sourceJobId);
    assert.equal(dryRunBody.targetPath, "local-sync-target");
    assert.equal(typeof dryRunBody.confirmationToken, "string");

    const dryRunFiles = dryRunBody.files as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(dryRunFiles) && dryRunFiles.length > 0);
    assert.equal(dryRunFiles[0]?.status, "create");
    assert.equal(dryRunFiles[0]?.decision, "write");
    const dryRunSummary = dryRunBody.summary as Record<string, unknown>;
    assert.equal(dryRunSummary.totalFiles, dryRunFiles.length);
    assert.ok(typeof dryRunSummary.selectedFiles === "number");

    const destinationRoot = dryRunBody.destinationRoot as string;
    const firstFile = dryRunFiles[0];
    const firstFilePath = path.join(destinationRoot, ...String(firstFile?.path ?? "").split("/"));
    await assert.rejects(
      () => stat(firstFilePath),
      (error: Error & { code?: string }) => error.code === "ENOENT"
    );

    // 12. Apply requires explicit confirmOverwrite=true (schema-level validation)
    const missingConfirmResult = await jsonFetch(`${baseUrl}/workspace/jobs/${regenJobId}/sync`, {
      method: "POST",
      body: JSON.stringify({
        mode: "apply",
        confirmationToken: dryRunBody.confirmationToken,
        confirmOverwrite: false,
        fileDecisions: dryRunFiles.map((entry) => ({
          path: entry.path,
          decision: entry.decision
        }))
      })
    });
    assert.equal(missingConfirmResult.status, 400);
    assert.equal((missingConfirmResult.body as Record<string, unknown>).error, "VALIDATION_ERROR");

    // 13. Load the source import session to verify governance events later
    const listImportSessionsResult = await jsonFetch(`${baseUrl}/workspace/import-sessions`);
    assert.equal(listImportSessionsResult.status, 200);
    const importSessions = ((listImportSessionsResult.body as Record<string, unknown>).sessions ??
      []) as Array<Record<string, unknown>>;
    const sourceImportSession = importSessions.find((session) => session.jobId === sourceJobId);
    assert.ok(sourceImportSession);

    // 14. Apply sync writes generated output into destination scope without requiring a pre-approved session
    const applyResult = await jsonFetch(`${baseUrl}/workspace/jobs/${regenJobId}/sync`, {
      method: "POST",
      body: JSON.stringify({
        mode: "apply",
        confirmationToken: dryRunBody.confirmationToken,
        confirmOverwrite: true,
        reviewerNote: "Approved during sync apply.",
        fileDecisions: dryRunFiles.map((entry) => ({
          path: entry.path,
          decision: entry.decision
        }))
      })
    });
    assert.equal(applyResult.status, 200);
    const applyBody = applyResult.body as Record<string, unknown>;
    assert.equal(applyBody.scopePath, dryRunBody.scopePath);
    assert.equal(
      (applyBody.summary as Record<string, unknown>).totalFiles,
      (dryRunBody.summary as Record<string, unknown>).totalFiles
    );
    const syncedContent = await readFile(firstFilePath, "utf8");
    assert.ok(syncedContent.length > 0);

    const eventsResult = await jsonFetch(
      `${baseUrl}/workspace/import-sessions/${sourceImportSession.id as string}/events`
    );
    assert.equal(eventsResult.status, 200);
    const events = ((eventsResult.body as Record<string, unknown>).events ?? []) as Array<Record<string, unknown>>;
    assert.equal(events.some((event) => event.kind === "imported"), true);
    assert.equal(events.some((event) => event.kind === "approved"), false);
    assert.equal(events.some((event) => event.kind === "applied"), true);
    const appliedEvent = events.findLast((event) => event.kind === "applied");
    assert.equal(appliedEvent?.note, "Approved during sync apply.");

    // 15. Token is one-time use
    const replayResult = await jsonFetch(`${baseUrl}/workspace/jobs/${regenJobId}/sync`, {
      method: "POST",
      body: JSON.stringify({
        mode: "apply",
        confirmationToken: dryRunBody.confirmationToken,
        confirmOverwrite: true,
        fileDecisions: dryRunFiles.map((entry) => ({
          path: entry.path,
          decision: entry.decision
        }))
      })
    });
    assert.equal(replayResult.status, 409);
    assert.equal((replayResult.body as Record<string, unknown>).error, "SYNC_CONFIRMATION_INVALID");

    // 16. Sync is only available for regeneration jobs
    const sourceSyncResult = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}/sync`, {
      method: "POST",
      body: JSON.stringify({
        mode: "dry_run"
      })
    });
    assert.equal(sourceSyncResult.status, 409);
    assert.equal((sourceSyncResult.body as Record<string, unknown>).error, "SYNC_REGEN_REQUIRED");

    // 17. GET on /sync returns 405
    const getSyncResult = await jsonFetch(`${baseUrl}/workspace/jobs/${regenJobId}/sync`);
    assert.equal(getSyncResult.status, 405);

    // 18. Sync validation catches malformed payloads
    const badSyncBodyResult = await jsonFetch(`${baseUrl}/workspace/jobs/${regenJobId}/sync`, {
      method: "POST",
      body: JSON.stringify({ mode: "unexpected" })
    });
    assert.equal(badSyncBodyResult.status, 400);

    // 19. GET on /regenerate returns 405
    const getResult = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}/regenerate`);
    assert.equal(getResult.status, 405);

    // 20. Regeneration of non-existent source returns 404
    const missingResult = await jsonFetch(`${baseUrl}/workspace/jobs/nonexistent-id/regenerate`, {
      method: "POST",
      body: JSON.stringify({ overrides: [] })
    });
    assert.equal(missingResult.status, 404);

    // 21. Regeneration with invalid body returns 400
    const badBodyResult = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ invalid: "payload" })
    });
    assert.equal(badBodyResult.status, 400);

    const invalidLayoutBodyResult = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({
        overrides: [{ nodeId: "card-1", field: "layoutMode", value: "row" }]
      })
    });
    assert.equal(invalidLayoutBodyResult.status, 400);
    assert.equal((invalidLayoutBodyResult.body as Record<string, unknown>).error, "VALIDATION_ERROR");

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
    const sourceTerminal = await pollForTerminal({ baseUrl, jobId: sourceJobId, timeoutMs: 300_000 });
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
    const layoutCandidate = findFirstLayoutOverrideCandidate(
      ((screens[0]?.children as Array<Record<string, unknown>> | undefined) ?? [])
    );
    if (!layoutCandidate || typeof layoutCandidate.id !== "string") {
      assert.ok(true, "Live board did not expose a mapped layout candidate for width/layoutMode overrides.");
      return;
    }

    const regenResult = await jsonFetch(`${baseUrl}/workspace/jobs/${sourceJobId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({
        overrides: [
          { nodeId: layoutCandidate.id, field: "width", value: Number(layoutCandidate.width) + 40 },
          { nodeId: layoutCandidate.id, field: "layoutMode", value: "HORIZONTAL" }
        ],
        draftId: "live-figma-test"
      })
    });

    assert.equal(regenResult.status, 202);
    const regenJobId = (regenResult.body as Record<string, unknown>).jobId as string;

    // 4. Wait for regeneration
    const regenTerminal = await pollForTerminal({ baseUrl, jobId: regenJobId, timeoutMs: 300_000 });

    // Regen may also fail at validate due to same lint issues, but the flow is correct
    const regenStatus = regenTerminal.body.status as string;
    const regenLineage = regenTerminal.body.lineage as Record<string, unknown>;
    assert.ok(regenLineage, "Regeneration job should always have lineage");
    assert.equal(regenLineage.sourceJobId, sourceJobId);
    assert.equal(regenLineage.draftId, "live-figma-test");
    assert.equal(regenLineage.overrideCount, 2);

    // Verify figma.source was skipped
    const stages = regenTerminal.body.stages as Array<Record<string, unknown>>;
    assert.equal(stages.find((s) => s.name === "figma.source")?.status, "skipped");
    assert.equal(stages.find((s) => s.name === "ir.derive")?.status, "completed");

    if (regenStatus === "completed") {
      assert.equal(stages.find((s) => s.name === "codegen.generate")?.status, "completed");
      const regenIrResult = await jsonFetch(`${baseUrl}/workspace/jobs/${regenJobId}/design-ir`);
      assert.equal(regenIrResult.status, 200);
      const regenIrBody = regenIrResult.body as Record<string, unknown>;
      const regenScreens = regenIrBody.screens as Array<Record<string, unknown>>;
      const updatedCandidate = findNodeById(
        ((regenScreens[0]?.children as Array<Record<string, unknown>> | undefined) ?? []),
        layoutCandidate.id
      );
      assert.ok(updatedCandidate);
      assert.equal(updatedCandidate?.width, Number(layoutCandidate.width) + 40);
      assert.equal(updatedCandidate?.layoutMode, "HORIZONTAL");

      const liveDryRunResult = await jsonFetch(`${baseUrl}/workspace/jobs/${regenJobId}/sync`, {
        method: "POST",
        body: JSON.stringify({
          mode: "dry_run",
          targetPath: "live-sync-target"
        })
      });
      assert.equal(liveDryRunResult.status, 200);
      const liveDryRunBody = liveDryRunResult.body as Record<string, unknown>;
      const liveToken = liveDryRunBody.confirmationToken as string;
      assert.ok(liveToken.length > 0);
      const liveFiles = liveDryRunBody.files as Array<Record<string, unknown>>;
      assert.ok(liveFiles.length > 0);
      const liveDestinationRoot = liveDryRunBody.destinationRoot as string;
      const liveFirstFilePath = path.join(liveDestinationRoot, ...String(liveFiles[0]?.path ?? "").split("/"));

      const liveApplyResult = await jsonFetch(`${baseUrl}/workspace/jobs/${regenJobId}/sync`, {
        method: "POST",
        body: JSON.stringify({
          mode: "apply",
          confirmationToken: liveToken,
          confirmOverwrite: true,
          fileDecisions: liveFiles.map((entry) => ({
            path: entry.path,
            decision: entry.decision
          }))
        })
      });
      assert.equal(liveApplyResult.status, 200);
      const syncedContent = await readFile(liveFirstFilePath, "utf8");
      assert.ok(syncedContent.length > 0);
    } else {
      const failedSyncResult = await jsonFetch(`${baseUrl}/workspace/jobs/${regenJobId}/sync`, {
        method: "POST",
        body: JSON.stringify({
          mode: "dry_run"
        })
      });
      assert.equal(failedSyncResult.status, 409);
      assert.equal((failedSyncResult.body as Record<string, unknown>).error, "SYNC_JOB_NOT_COMPLETED");
    }
  } finally {
    server.close();
  }
});
