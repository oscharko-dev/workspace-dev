import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobEngine, resolveRuntimeSettings } from "../job-engine.js";
import { applyLocalSyncPlan, LocalSyncError, planLocalSync } from "./local-sync.js";

const createLocalFigmaPayload = () => ({
  name: "Local Sync Test Board",
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
                children: []
              }
            ]
          }
        ]
      }
    ]
  }
});

const waitForTerminalStatus = async ({
  getStatus,
  jobId,
  timeoutMs = 120_000
}: {
  getStatus: (jobId: string) => ReturnType<ReturnType<typeof createJobEngine>["getJob"]>;
  jobId: string;
  timeoutMs?: number;
}) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = getStatus(jobId);
    if (status && (status.status === "completed" || status.status === "failed" || status.status === "canceled")) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for terminal status for job ${jobId}`);
};

test("planLocalSync rejects unsafe targetPath traversal", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-sync-plan-invalid-"));
  const sourceRoot = path.join(tempRoot, "generated-project");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(path.join(sourceRoot, "App.tsx"), "export default function App() { return null; }\n", "utf8");

  await assert.rejects(
    () =>
      planLocalSync({
        generatedProjectDir: sourceRoot,
        workspaceRoot: tempRoot,
        targetPath: "../escape",
        boardKey: "board-unsafe"
      }),
    (error: Error) => {
      return error instanceof LocalSyncError && error.code === "E_SYNC_TARGET_PATH_INVALID";
    }
  );
});

test("planLocalSync computes create/overwrite write plan under scoped destination", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-sync-plan-"));
  const sourceRoot = path.join(tempRoot, "generated-project");
  await mkdir(path.join(sourceRoot, "src"), { recursive: true });
  await writeFile(path.join(sourceRoot, "README.md"), "# Generated\n", "utf8");
  await writeFile(path.join(sourceRoot, "src", "App.tsx"), "export const App = () => null;\n", "utf8");

  const existingDestination = path.join(tempRoot, "sync-target", "board-123", "src");
  await mkdir(existingDestination, { recursive: true });
  await writeFile(path.join(existingDestination, "App.tsx"), "old-content\n", "utf8");

  const plan = await planLocalSync({
    generatedProjectDir: sourceRoot,
    workspaceRoot: tempRoot,
    targetPath: "sync-target",
    boardKey: "board-123"
  });

  assert.equal(plan.scopePath, "sync-target/board-123");
  assert.equal(plan.destinationRoot, path.join(tempRoot, "sync-target", "board-123"));
  assert.equal(plan.summary.totalFiles, 2);
  assert.equal(plan.summary.createCount, 1);
  assert.equal(plan.summary.overwriteCount, 1);
  assert.ok(plan.summary.totalBytes > 0);

  const appEntry = plan.files.find((entry) => entry.relativePath === "src/App.tsx");
  const readmeEntry = plan.files.find((entry) => entry.relativePath === "README.md");
  assert.equal(appEntry?.action, "overwrite");
  assert.equal(readmeEntry?.action, "create");
});

test("applyLocalSyncPlan writes planned files only when apply is executed", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-sync-apply-"));
  const sourceRoot = path.join(tempRoot, "generated-project");
  await mkdir(path.join(sourceRoot, "src"), { recursive: true });
  await writeFile(path.join(sourceRoot, "src", "App.tsx"), "export const App = () => null;\n", "utf8");

  const plan = await planLocalSync({
    generatedProjectDir: sourceRoot,
    workspaceRoot: tempRoot,
    targetPath: "sync-target",
    boardKey: "board-apply"
  });

  const destinationPath = path.join(plan.destinationRoot, "src", "App.tsx");

  await assert.rejects(() => stat(destinationPath), (error: Error & { code?: string }) => error.code === "ENOENT");

  await applyLocalSyncPlan({ plan });

  const written = await readFile(destinationPath, "utf8");
  assert.equal(written, "export const App = () => null;\n");
});

test("job-engine local sync enforces regeneration-only + tokened apply confirmation", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-sync-engine-"));
  const outputRoot = path.join(tempRoot, "runtime-output");
  const workspaceRoot = path.join(tempRoot, "workspace-root");
  await mkdir(workspaceRoot, { recursive: true });

  const figmaPath = path.join(tempRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot,
      jobsRoot: path.join(outputRoot, "jobs"),
      reprosRoot: path.join(outputRoot, "repros"),
      workspaceRoot
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      enableUiValidation: false,
      enableUnitTestValidation: false,
      installPreferOffline: true
    })
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json"
  });
  const sourceStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: sourceAccepted.jobId
  });
  assert.equal(sourceStatus.status, "completed");

  await assert.rejects(
    () => engine.previewLocalSync({ jobId: sourceAccepted.jobId }),
    (error: Error & { code?: string }) => error.code === "E_SYNC_REGEN_REQUIRED"
  );

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "card-1", field: "cornerRadius", value: 16 }]
  });
  const regenStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: regenAccepted.jobId
  });
  assert.equal(regenStatus.status, "completed");

  const preview = await engine.previewLocalSync({
    jobId: regenAccepted.jobId,
    targetPath: "sync-output"
  });
  assert.equal(preview.jobId, regenAccepted.jobId);
  assert.equal(preview.sourceJobId, sourceAccepted.jobId);
  assert.ok(preview.confirmationToken.length > 0);
  assert.ok(preview.summary.totalFiles > 0);
  assert.ok(preview.files.length > 0);

  const firstPreviewFile = preview.files[0];
  assert.ok(firstPreviewFile);
  const destinationPath = path.join(preview.destinationRoot, ...(firstPreviewFile.path.split("/")));
  await assert.rejects(() => stat(destinationPath), (error: Error & { code?: string }) => error.code === "ENOENT");

  await assert.rejects(
    () =>
      engine.applyLocalSync({
        jobId: regenAccepted.jobId,
        confirmationToken: preview.confirmationToken,
        confirmOverwrite: false
      }),
    (error: Error & { code?: string }) => error.code === "E_SYNC_CONFIRMATION_REQUIRED"
  );

  const applyResult = await engine.applyLocalSync({
    jobId: regenAccepted.jobId,
    confirmationToken: preview.confirmationToken,
    confirmOverwrite: true
  });
  assert.equal(applyResult.jobId, regenAccepted.jobId);
  assert.equal(applyResult.scopePath, preview.scopePath);
  assert.equal(applyResult.summary.totalFiles, preview.summary.totalFiles);
  assert.ok(typeof applyResult.appliedAt === "string" && applyResult.appliedAt.length > 0);

  const writtenStat = await stat(destinationPath);
  assert.ok(writtenStat.isFile());

  await assert.rejects(
    () =>
      engine.applyLocalSync({
        jobId: regenAccepted.jobId,
        confirmationToken: preview.confirmationToken,
        confirmOverwrite: true
      }),
    (error: Error & { code?: string }) => error.code === "E_SYNC_CONFIRMATION_INVALID"
  );
});
