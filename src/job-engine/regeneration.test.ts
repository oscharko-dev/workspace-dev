import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for job status");
};

const createLocalFigmaPayload = () => ({
  name: "Regen Test Board",
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
            name: "Test Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
            children: [
              {
                id: "title-1",
                type: "TEXT",
                characters: "Hello World",
                absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 30 },
                style: { fontSize: 24, fontWeight: 400, lineHeightPx: 32 },
                fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }]
              },
              {
                id: "box-1",
                type: "FRAME",
                name: "Container",
                absoluteBoundingBox: { x: 0, y: 40, width: 640, height: 200 },
                fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
                cornerRadius: 8,
                children: []
              }
            ]
          }
        ]
      }
    ]
  }
});

test("submitRegeneration throws when source job does not exist", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-notfound-"));
  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({ enablePreview: false })
  });

  assert.throws(
    () =>
      engine.submitRegeneration({
        sourceJobId: "nonexistent",
        overrides: []
      }),
    (error: Error & { code?: string }) => error.code === "E_REGEN_SOURCE_NOT_FOUND"
  );
});

test("submitRegeneration throws when source job is not completed", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-notcompleted-"));
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
      fetchImpl: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal instanceof AbortSignal) {
            signal.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            }, { once: true });
          }
        })
    })
  });

  // Submit a job that will hang (never completes)
  const accepted = engine.submitJob({ figmaFileKey: "abc", figmaAccessToken: "token" });

  assert.throws(
    () =>
      engine.submitRegeneration({
        sourceJobId: accepted.jobId,
        overrides: []
      }),
    (error: Error & { code?: string }) => error.code === "E_REGEN_SOURCE_NOT_COMPLETED"
  );

  // Cleanup - cancel the hanging job
  engine.cancelJob({ jobId: accepted.jobId });
});

test("submitRegeneration creates a queued job with lineage metadata from a completed source", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-lineage-"));
  const figmaPayload = createLocalFigmaPayload();
  const figmaPath = path.join(tempRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(figmaPayload), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false
    })
  });

  // First: create and complete a source job
  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json"
  });

  const sourceStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: sourceAccepted.jobId
  });
  assert.equal(sourceStatus.status, "completed", `Source job should complete, got: ${sourceStatus.status} — ${sourceStatus.error?.message ?? "no error"}`);

  // Now submit regeneration with overrides
  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [
      { nodeId: "box-1", field: "fillColor", value: "#00ff00" },
      { nodeId: "box-1", field: "cornerRadius", value: 16 }
    ],
    draftId: "test-draft-123",
    baseFingerprint: "fnv1a64:abc123"
  });

  assert.equal(regenAccepted.status, "queued");
  assert.equal(regenAccepted.sourceJobId, sourceAccepted.jobId);
  assert.ok(regenAccepted.jobId);

  // Wait for regeneration to complete
  const regenStatus = await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: regenAccepted.jobId
  });

  assert.equal(regenStatus.status, "completed", `Regen job should complete, got: ${regenStatus.status} — ${regenStatus.error?.message ?? "no error"}`);

  // Verify lineage metadata
  assert.ok(regenStatus.lineage, "Regeneration job should have lineage metadata");
  assert.equal(regenStatus.lineage?.sourceJobId, sourceAccepted.jobId);
  assert.equal(regenStatus.lineage?.overrideCount, 2);
  assert.equal(regenStatus.lineage?.draftId, "test-draft-123");
  assert.equal(regenStatus.lineage?.baseFingerprint, "fnv1a64:abc123");

  // Verify git.pr is skipped
  assert.equal(regenStatus.gitPr?.status, "skipped");

  // Verify figma.source is skipped
  const figmaStage = regenStatus.stages.find((s) => s.name === "figma.source");
  assert.equal(figmaStage?.status, "skipped");

  // Verify ir.derive completed (override application)
  const irStage = regenStatus.stages.find((s) => s.name === "ir.derive");
  assert.equal(irStage?.status, "completed");

  // Verify codegen completed
  const codegenStage = regenStatus.stages.find((s) => s.name === "codegen.generate");
  assert.equal(codegenStage?.status, "completed");

  // Source job should remain unchanged
  const sourceAfter = engine.getJob(sourceAccepted.jobId);
  assert.equal(sourceAfter?.status, "completed");
  assert.equal(sourceAfter?.lineage, undefined, "Source job should not have lineage");
});

test("submitRegeneration result endpoint includes lineage", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-regen-result-"));
  const figmaPayload = createLocalFigmaPayload();
  const figmaPath = path.join(tempRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(figmaPayload), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros")
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false
    })
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json"
  });

  await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: sourceAccepted.jobId
  });

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "title-1", field: "fontSize", value: 32 }]
  });

  await waitForTerminalStatus({
    getStatus: (id) => engine.getJob(id),
    jobId: regenAccepted.jobId
  });

  const result = engine.getJobResult(regenAccepted.jobId);
  assert.ok(result);
  assert.equal(result.status, "completed");
  assert.ok(result.lineage);
  assert.equal(result.lineage?.sourceJobId, sourceAccepted.jobId);
  assert.equal(result.lineage?.overrideCount, 1);
});
