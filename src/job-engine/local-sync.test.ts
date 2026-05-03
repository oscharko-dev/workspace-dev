import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobEngine, resolveRuntimeSettings } from "../job-engine.js";
import {
  applyLocalSyncPlan,
  LocalSyncError,
  planLocalSync,
  writeFileWithFinalComponentNoFollow,
} from "./local-sync.js";
import { ensureTemplateValidationSeedNodeModules } from "./test-validation-seed.js";

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
                fills: [
                  { type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } },
                ],
              },
              {
                id: "card-1",
                type: "FRAME",
                name: "Card",
                absoluteBoundingBox: { x: 20, y: 80, width: 400, height: 200 },
                fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
                cornerRadius: 8,
                children: [],
              },
            ],
          },
        ],
      },
    ],
  },
});

const sha256 = (content: string): string => {
  return createHash("sha256").update(content).digest("hex");
};

const writeLocalSyncBaseline = async ({
  outputRoot,
  scopePath,
  boardKey,
  targetPath,
  destinationRoot,
  files,
}: {
  outputRoot: string;
  scopePath: string;
  boardKey: string;
  targetPath: string;
  destinationRoot: string;
  files: Array<{
    path: string;
    content: string;
    sourceJobId?: string;
    jobId?: string;
  }>;
}): Promise<void> => {
  const baselinePath = path.join(
    outputRoot,
    "local-sync-baselines",
    ...scopePath.split("/"),
    "baseline.json",
  );
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await writeFile(
    baselinePath,
    `${JSON.stringify(
      {
        version: 1,
        boardKey,
        targetPath,
        scopePath,
        destinationRoot,
        updatedAt: "2026-03-23T10:00:00.000Z",
        files: files.map((entry) => ({
          path: entry.path,
          sha256: sha256(entry.content),
          sizeBytes: Buffer.byteLength(entry.content),
          syncedAt: "2026-03-23T10:00:00.000Z",
          jobId: entry.jobId ?? "job-prev",
          sourceJobId: entry.sourceJobId ?? "job-source-prev",
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
};

const waitForTerminalStatus = async ({
  getStatus,
  jobId,
  // Issue #1675 (audit-2026-05): restored to the pre-2026-05-01 baseline
  // now that #1665 (Playwright `webServer.command` rebuilt the app on
  // every launch) is fixed. The 600_000ms bump existed solely as a
  // safety net for the 30-min Playwright wall-clock #1665 now eliminates.
  timeoutMs = 300_000,
}: {
  getStatus: (
    jobId: string,
  ) => ReturnType<ReturnType<typeof createJobEngine>["getJob"]>;
  jobId: string;
  timeoutMs?: number;
}) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = getStatus(jobId);
    if (
      status &&
      (status.status === "completed" ||
        status.status === "failed" ||
        status.status === "canceled")
    ) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for terminal status for job ${jobId}`);
};

test.before(async () => {
  await ensureTemplateValidationSeedNodeModules();
});

test("planLocalSync rejects unsafe targetPath traversal", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-sync-plan-invalid-"),
  );
  const outputRoot = path.join(tempRoot, "runtime-output");
  const sourceRoot = path.join(tempRoot, "generated-project");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(
    path.join(sourceRoot, "App.tsx"),
    "export default function App() { return null; }\n",
    "utf8",
  );

  for (const targetPath of ["../escape", "sync\0escape"]) {
    await assert.rejects(
      () =>
        planLocalSync({
          generatedProjectDir: sourceRoot,
          workspaceRoot: tempRoot,
          outputRoot,
          targetPath,
          boardKey: "board-unsafe",
        }),
      (error: Error) => {
        return (
          error instanceof LocalSyncError &&
          error.code === "E_SYNC_TARGET_PATH_INVALID"
        );
      },
    );
  }
});

test("planLocalSync marks existing unmanaged files as untracked until a baseline exists", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-sync-plan-untracked-"),
  );
  const outputRoot = path.join(tempRoot, "runtime-output");
  const sourceRoot = path.join(tempRoot, "generated-project");
  await mkdir(path.join(sourceRoot, "src"), { recursive: true });
  await writeFile(path.join(sourceRoot, "README.md"), "# Generated\n", "utf8");
  await writeFile(
    path.join(sourceRoot, "src", "App.tsx"),
    "export const App = () => null;\n",
    "utf8",
  );

  const existingDestination = path.join(
    tempRoot,
    "sync-target",
    "board-123",
    "src",
  );
  await mkdir(existingDestination, { recursive: true });
  await writeFile(
    path.join(existingDestination, "App.tsx"),
    "manual-existing-content\n",
    "utf8",
  );

  const plan = await planLocalSync({
    generatedProjectDir: sourceRoot,
    workspaceRoot: tempRoot,
    outputRoot,
    targetPath: "sync-target",
    boardKey: "board-123",
  });

  assert.equal(plan.scopePath, "sync-target/board-123");
  assert.equal(
    plan.destinationRoot,
    path.join(tempRoot, "sync-target", "board-123"),
  );
  assert.equal(plan.summary.totalFiles, 2);
  assert.equal(plan.summary.selectedFiles, 1);
  assert.equal(plan.summary.createCount, 1);
  assert.equal(plan.summary.overwriteCount, 0);
  assert.equal(plan.summary.untrackedCount, 1);
  assert.equal(plan.summary.conflictCount, 0);

  const appEntry = plan.files.find(
    (entry) => entry.relativePath === "src/App.tsx",
  );
  const readmeEntry = plan.files.find(
    (entry) => entry.relativePath === "README.md",
  );
  assert.equal(appEntry?.status, "untracked");
  assert.equal(appEntry?.reason, "existing_without_baseline");
  assert.equal(appEntry?.decision, "skip");
  assert.equal(appEntry?.action, "overwrite");
  assert.equal(readmeEntry?.status, "create");
  assert.equal(readmeEntry?.decision, "write");
});

test("planLocalSync uses baseline tracking to distinguish safe overwrites from conflicts", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-sync-plan-conflict-"),
  );
  const outputRoot = path.join(tempRoot, "runtime-output");
  const sourceRoot = path.join(tempRoot, "generated-project");
  const targetPath = "sync-target";
  const boardKey = "board-conflict";
  const scopePath = `${targetPath}/${boardKey}`;
  const destinationRoot = path.join(tempRoot, scopePath);

  await mkdir(path.join(sourceRoot, "src"), { recursive: true });
  await writeFile(
    path.join(sourceRoot, "src", "App.tsx"),
    "export const App = () => <div>new</div>;\n",
    "utf8",
  );
  await writeFile(
    path.join(sourceRoot, "src", "Card.tsx"),
    "export const Card = () => <section>new</section>;\n",
    "utf8",
  );

  await mkdir(path.join(destinationRoot, "src"), { recursive: true });
  await writeFile(
    path.join(destinationRoot, "src", "App.tsx"),
    "export const App = () => <div>old</div>;\n",
    "utf8",
  );
  await writeFile(
    path.join(destinationRoot, "src", "Card.tsx"),
    "export const Card = () => <section>manual-edit</section>;\n",
    "utf8",
  );

  await writeLocalSyncBaseline({
    outputRoot,
    scopePath,
    boardKey,
    targetPath,
    destinationRoot,
    files: [
      {
        path: "src/App.tsx",
        content: "export const App = () => <div>old</div>;\n",
      },
      {
        path: "src/Card.tsx",
        content: "export const Card = () => <section>old</section>;\n",
      },
    ],
  });

  const plan = await planLocalSync({
    generatedProjectDir: sourceRoot,
    workspaceRoot: tempRoot,
    outputRoot,
    targetPath,
    boardKey,
  });

  assert.equal(plan.summary.overwriteCount, 1);
  assert.equal(plan.summary.conflictCount, 1);
  assert.equal(plan.summary.selectedFiles, 1);

  const appEntry = plan.files.find(
    (entry) => entry.relativePath === "src/App.tsx",
  );
  const cardEntry = plan.files.find(
    (entry) => entry.relativePath === "src/Card.tsx",
  );
  assert.equal(appEntry?.status, "overwrite");
  assert.equal(appEntry?.decision, "write");
  assert.equal(cardEntry?.status, "conflict");
  assert.equal(cardEntry?.reason, "destination_modified_since_sync");
  assert.equal(cardEntry?.decision, "skip");
});

test("applyLocalSyncPlan writes only selected files and updates baseline for written files", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-sync-apply-"),
  );
  const outputRoot = path.join(tempRoot, "runtime-output");
  const sourceRoot = path.join(tempRoot, "generated-project");
  const targetPath = "sync-target";
  const boardKey = "board-apply";
  const scopePath = `${targetPath}/${boardKey}`;
  const destinationRoot = path.join(tempRoot, scopePath);

  await mkdir(path.join(sourceRoot, "src"), { recursive: true });
  await writeFile(
    path.join(sourceRoot, "src", "App.tsx"),
    "export const App = () => <div>new</div>;\n",
    "utf8",
  );
  await writeFile(path.join(sourceRoot, "README.md"), "# New Readme\n", "utf8");

  await mkdir(path.join(destinationRoot, "src"), { recursive: true });
  await writeFile(
    path.join(destinationRoot, "src", "App.tsx"),
    "export const App = () => <div>old</div>;\n",
    "utf8",
  );

  await writeLocalSyncBaseline({
    outputRoot,
    scopePath,
    boardKey,
    targetPath,
    destinationRoot,
    files: [
      {
        path: "src/App.tsx",
        content: "export const App = () => <div>old</div>;\n",
      },
    ],
  });

  const plan = await planLocalSync({
    generatedProjectDir: sourceRoot,
    workspaceRoot: tempRoot,
    outputRoot,
    targetPath,
    boardKey,
  });

  const appliedPlan = await applyLocalSyncPlan({
    plan,
    jobId: "job-apply-1",
    sourceJobId: "job-source-1",
    fileDecisions: plan.files.map((entry) => ({
      path: entry.relativePath,
      decision: entry.relativePath === "src/App.tsx" ? "write" : "skip",
    })),
  });

  const appContent = await readFile(
    path.join(destinationRoot, "src", "App.tsx"),
    "utf8",
  );
  assert.equal(appContent, "export const App = () => <div>new</div>;\n");
  await assert.rejects(
    () => stat(path.join(destinationRoot, "README.md")),
    (error: Error & { code?: string }) => error.code === "ENOENT",
  );

  assert.equal(appliedPlan.summary.selectedFiles, 1);
  const baselinePath = path.join(
    outputRoot,
    "local-sync-baselines",
    ...scopePath.split("/"),
    "baseline.json",
  );
  const baselinePayload = JSON.parse(await readFile(baselinePath, "utf8")) as {
    files: Array<{ path: string; sha256: string }>;
  };
  assert.deepEqual(
    baselinePayload.files.map((entry) => entry.path),
    ["src/App.tsx"],
  );
  assert.equal(
    baselinePayload.files[0]?.sha256,
    sha256("export const App = () => <div>new</div>;\n"),
  );
});

test("planLocalSync marks deleted managed files as conflicts and already-matching unmanaged files as unchanged", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-sync-plan-deleted-"),
  );
  const outputRoot = path.join(tempRoot, "runtime-output");
  const sourceRoot = path.join(tempRoot, "generated-project");
  const targetPath = "sync-target";
  const boardKey = "board-deleted";
  const scopePath = `${targetPath}/${boardKey}`;
  const destinationRoot = path.join(tempRoot, scopePath);

  try {
    await mkdir(path.join(sourceRoot, "src"), { recursive: true });
    await writeFile(
      path.join(sourceRoot, "src", "App.tsx"),
      "export const App = () => <div>same</div>;\n",
      "utf8",
    );
    await writeFile(
      path.join(sourceRoot, "src", "Deleted.tsx"),
      "export const Deleted = () => null;\n",
      "utf8",
    );

    await mkdir(path.join(destinationRoot, "src"), { recursive: true });
    await writeFile(
      path.join(destinationRoot, "src", "App.tsx"),
      "export const App = () => <div>same</div>;\n",
      "utf8",
    );

    await writeLocalSyncBaseline({
      outputRoot,
      scopePath,
      boardKey,
      targetPath,
      destinationRoot,
      files: [
        {
          path: "src/Deleted.tsx",
          content: "export const Deleted = () => null;\n",
        },
      ],
    });

    const plan = await planLocalSync({
      generatedProjectDir: sourceRoot,
      workspaceRoot: tempRoot,
      outputRoot,
      targetPath,
      boardKey,
    });

    assert.equal(plan.summary.totalFiles, 2);
    assert.equal(plan.summary.conflictCount, 1);
    assert.equal(plan.summary.unchangedCount, 1);
    assert.equal(plan.summary.selectedFiles, 0);

    const unchangedEntry = plan.files.find(
      (entry) => entry.relativePath === "src/App.tsx",
    );
    const deletedEntry = plan.files.find(
      (entry) => entry.relativePath === "src/Deleted.tsx",
    );
    assert.equal(unchangedEntry?.status, "unchanged");
    assert.equal(unchangedEntry?.reason, "already_matches_generated");
    assert.equal(deletedEntry?.status, "conflict");
    assert.equal(deletedEntry?.reason, "destination_deleted_since_sync");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("planLocalSync rejects invalid baselines, generated symlinks, and unsafe destination parents", async (t) => {
  await t.test("invalid baseline snapshots fail fast", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "workspace-sync-plan-invalid-baseline-"),
    );
    const outputRoot = path.join(tempRoot, "runtime-output");
    const sourceRoot = path.join(tempRoot, "generated-project");
    const baselinePath = path.join(
      outputRoot,
      "local-sync-baselines",
      "sync-target",
      "board-invalid",
      "baseline.json",
    );

    try {
      await mkdir(sourceRoot, { recursive: true });
      await writeFile(
        path.join(sourceRoot, "App.tsx"),
        "export default function App() { return null; }\n",
        "utf8",
      );
      await mkdir(path.dirname(baselinePath), { recursive: true });
      await writeFile(baselinePath, '{"version":999}\n', "utf8");

      await assert.rejects(
        () =>
          planLocalSync({
            generatedProjectDir: sourceRoot,
            workspaceRoot: tempRoot,
            outputRoot,
            targetPath: "sync-target",
            boardKey: "board-invalid",
          }),
        (error: Error) =>
          error instanceof LocalSyncError &&
          error.code === "E_SYNC_BASELINE_INVALID",
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  await t.test("generated source symlinks are rejected", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "workspace-sync-plan-source-symlink-"),
    );
    const outputRoot = path.join(tempRoot, "runtime-output");
    const sourceRoot = path.join(tempRoot, "generated-project");
    const outsideFile = path.join(tempRoot, "outside.tsx");

    try {
      await mkdir(sourceRoot, { recursive: true });
      await writeFile(
        outsideFile,
        "export const Outside = () => null;\n",
        "utf8",
      );
      await symlink(outsideFile, path.join(sourceRoot, "Linked.tsx"));

      await assert.rejects(
        () =>
          planLocalSync({
            generatedProjectDir: sourceRoot,
            workspaceRoot: tempRoot,
            outputRoot,
            targetPath: "sync-target",
            boardKey: "board-symlink",
          }),
        (error: Error) =>
          error instanceof LocalSyncError &&
          error.code === "E_SYNC_SOURCE_SYMLINK",
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  await t.test(
    "destination parents must stay real directories inside the workspace root",
    async () => {
      const tempRoot = await mkdtemp(
        path.join(os.tmpdir(), "workspace-sync-plan-dest-parent-"),
      );
      const outputRoot = path.join(tempRoot, "runtime-output");
      const sourceRoot = path.join(tempRoot, "generated-project");
      const parentTarget = path.join(tempRoot, "sync-target");
      const symlinkTarget = path.join(tempRoot, "actual-target");

      try {
        await mkdir(sourceRoot, { recursive: true });
        await writeFile(
          path.join(sourceRoot, "App.tsx"),
          "export default function App() { return null; }\n",
          "utf8",
        );

        await writeFile(parentTarget, "not a directory\n", "utf8");
        await assert.rejects(
          () =>
            planLocalSync({
              generatedProjectDir: sourceRoot,
              workspaceRoot: tempRoot,
              outputRoot,
              targetPath: "sync-target/nested",
              boardKey: "board-parent-file",
            }),
          (error: Error) =>
            error instanceof LocalSyncError &&
            error.code === "E_SYNC_DESTINATION_CONFLICT",
        );

        await rm(parentTarget, { force: true });
        await mkdir(symlinkTarget, { recursive: true });
        await symlink(symlinkTarget, parentTarget, "dir");
        await assert.rejects(
          () =>
            planLocalSync({
              generatedProjectDir: sourceRoot,
              workspaceRoot: tempRoot,
              outputRoot,
              targetPath: "sync-target/nested",
              boardKey: "board-parent-symlink",
            }),
          (error: Error) =>
            error instanceof LocalSyncError &&
            error.code === "E_SYNC_DESTINATION_SYMLINK",
        );
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
  );
});

test("applyLocalSyncPlan validates file decisions before any writes occur", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-sync-apply-invalid-"),
  );
  const outputRoot = path.join(tempRoot, "runtime-output");
  const sourceRoot = path.join(tempRoot, "generated-project");
  const destinationRoot = path.join(tempRoot, "sync-target", "board-validate");

  try {
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(
      path.join(sourceRoot, "App.tsx"),
      "export const App = () => <div>same</div>;\n",
      "utf8",
    );
    await writeFile(
      path.join(sourceRoot, "New.tsx"),
      "export const NewFile = () => null;\n",
      "utf8",
    );
    await mkdir(destinationRoot, { recursive: true });
    await writeFile(
      path.join(destinationRoot, "App.tsx"),
      "export const App = () => <div>same</div>;\n",
      "utf8",
    );

    const plan = await planLocalSync({
      generatedProjectDir: sourceRoot,
      workspaceRoot: tempRoot,
      outputRoot,
      targetPath: "sync-target",
      boardKey: "board-validate",
    });

    const appPath = plan.files.find(
      (entry) => entry.relativePath === "App.tsx",
    )?.relativePath;
    const newPath = plan.files.find(
      (entry) => entry.relativePath === "New.tsx",
    )?.relativePath;
    assert.ok(appPath);
    assert.ok(newPath);

    const expectInvalid = async (
      fileDecisions: Array<{ path: string; decision: "write" | "skip" }>,
      matcher: RegExp,
    ) => {
      await assert.rejects(
        () =>
          applyLocalSyncPlan({
            plan,
            jobId: "job-invalid",
            sourceJobId: "source-invalid",
            fileDecisions,
          }),
        (error: Error) =>
          error instanceof LocalSyncError &&
          error.code === "E_SYNC_FILE_DECISIONS_INVALID" &&
          matcher.test(error.message),
      );
    };

    await t.test("empty paths are rejected", async () => {
      await expectInvalid(
        [
          { path: "", decision: "write" },
          { path: newPath ?? "New.tsx", decision: "write" },
        ],
        /must be non-empty/,
      );
    });

    await t.test("duplicate paths are rejected", async () => {
      await expectInvalid(
        [
          { path: newPath ?? "New.tsx", decision: "write" },
          { path: newPath ?? "New.tsx", decision: "skip" },
        ],
        /Duplicate file decision/,
      );
    });

    await t.test("missing decisions are rejected", async () => {
      await expectInvalid(
        [{ path: appPath ?? "App.tsx", decision: "skip" }],
        /Missing file decision/,
      );
    });

    await t.test("unchanged files cannot be written again", async () => {
      await expectInvalid(
        [
          { path: appPath ?? "App.tsx", decision: "write" },
          { path: newPath ?? "New.tsx", decision: "skip" },
        ],
        /cannot be written again/,
      );
    });

    await t.test("unknown paths are rejected", async () => {
      await expectInvalid(
        [
          { path: appPath ?? "App.tsx", decision: "skip" },
          { path: newPath ?? "New.tsx", decision: "write" },
          { path: "Unknown.tsx", decision: "skip" },
        ],
        /unknown path/,
      );
    });

    await t.test("at least one file must be selected for writing", async () => {
      await expectInvalid(
        [
          { path: appPath ?? "App.tsx", decision: "skip" },
          { path: newPath ?? "New.tsx", decision: "skip" },
        ],
        /Select at least one file/,
      );
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("writeFileWithFinalComponentNoFollow hardens final-component symlink writes when supported", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-sync-write-nofollow-"),
  );
  const targetPath = path.join(tempRoot, "target.txt");
  const linkPath = path.join(tempRoot, "linked.txt");

  try {
    await writeFile(targetPath, "before\n", "utf8");
    await symlink(targetPath, linkPath);

    if (typeof constants.O_NOFOLLOW === "number") {
      await assert.rejects(
        () =>
          writeFileWithFinalComponentNoFollow({
            filePath: linkPath,
            content: Buffer.from("after\n", "utf8"),
          }),
        (error: Error & { code?: string }) => typeof error.code === "string",
      );
      assert.equal(await readFile(targetPath, "utf8"), "before\n");
    } else {
      await writeFileWithFinalComponentNoFollow({
        filePath: linkPath,
        content: Buffer.from("after\n", "utf8"),
      });
      assert.equal(await readFile(targetPath, "utf8"), "after\n");
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("job-engine local sync persists a baseline and surfaces manual edits as conflicts", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-sync-engine-baseline-"),
  );
  const outputRoot = path.join(tempRoot, "runtime-output");
  const workspaceRoot = path.join(tempRoot, "workspace-root");
  await mkdir(workspaceRoot, { recursive: true });

  const figmaPath = path.join(workspaceRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot,
      jobsRoot: path.join(outputRoot, "jobs"),
      reprosRoot: path.join(outputRoot, "repros"),
      workspaceRoot,
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      enablePerfValidation: false,
      enableUiValidation: false,
      enableUnitTestValidation: false,
      installPreferOffline: true,
    }),
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    requestSourceMode: "local_json",
  });
  const sourceStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: sourceAccepted.jobId,
  });
  assert.equal(sourceStatus.status, "completed");

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "card-1", field: "cornerRadius", value: 16 }],
  });
  const regenStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: regenAccepted.jobId,
  });
  assert.equal(regenStatus.status, "completed");

  const firstPreview = await engine.previewLocalSync({
    jobId: regenAccepted.jobId,
    targetPath: "sync-output",
  });
  assert.ok(firstPreview.files.length > 0);
  assert.ok(firstPreview.files.every((entry) => entry.status === "create"));

  const sourceImportSession = (await engine.listImportSessions()).find(
    (session) => session.jobId === sourceAccepted.jobId,
  );
  assert.ok(sourceImportSession);
  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId: sourceImportSession.id,
      kind: "review_started",
      at: "",
    },
  });
  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId: sourceImportSession.id,
      kind: "approved",
      at: "",
    },
  });

  await engine.applyLocalSync({
    jobId: regenAccepted.jobId,
    confirmationToken: firstPreview.confirmationToken,
    confirmOverwrite: true,
    reviewerNote: "Approved during local sync.",
    fileDecisions: firstPreview.files.map((entry) => ({
      path: entry.path,
      decision: entry.decision,
    })),
  });

  const managedFile = firstPreview.files[0];
  assert.ok(managedFile);
  const managedDestinationPath = path.join(
    firstPreview.destinationRoot,
    ...managedFile.path.split("/"),
  );
  await writeFile(managedDestinationPath, "manual-edit-after-sync\n", "utf8");

  const secondPreview = await engine.previewLocalSync({
    jobId: regenAccepted.jobId,
    targetPath: "sync-output",
  });
  const conflictingEntry = secondPreview.files.find(
    (entry) => entry.path === managedFile.path,
  );
  assert.equal(conflictingEntry?.status, "conflict");
  assert.equal(conflictingEntry?.reason, "destination_modified_since_sync");
  assert.equal(conflictingEntry?.decision, "skip");
});

test("job-engine local sync rejects apply when the preview becomes stale", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-sync-engine-stale-"),
  );
  const outputRoot = path.join(tempRoot, "runtime-output");
  const workspaceRoot = path.join(tempRoot, "workspace-root");
  await mkdir(workspaceRoot, { recursive: true });

  const figmaPath = path.join(workspaceRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot,
      jobsRoot: path.join(outputRoot, "jobs"),
      reprosRoot: path.join(outputRoot, "repros"),
      workspaceRoot,
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      enablePerfValidation: false,
      enableUiValidation: false,
      enableUnitTestValidation: false,
      installPreferOffline: true,
    }),
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    requestSourceMode: "local_json",
  });
  const sourceStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: sourceAccepted.jobId,
  });
  assert.equal(sourceStatus.status, "completed");

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "card-1", field: "cornerRadius", value: 16 }],
  });
  const regenStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: regenAccepted.jobId,
  });
  assert.equal(regenStatus.status, "completed");

  const preview = await engine.previewLocalSync({
    jobId: regenAccepted.jobId,
    targetPath: "sync-output",
  });
  const sourceImportSession = (await engine.listImportSessions()).find(
    (session) => session.jobId === sourceAccepted.jobId,
  );
  assert.ok(sourceImportSession);
  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId: sourceImportSession.id,
      kind: "review_started",
      at: "",
    },
  });
  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId: sourceImportSession.id,
      kind: "approved",
      at: "",
    },
  });
  const firstPreviewFile = preview.files.find(
    (entry) => entry.decision === "write",
  );
  assert.ok(firstPreviewFile);
  const destinationPath = path.join(
    preview.destinationRoot,
    ...(firstPreviewFile?.path.split("/") ?? []),
  );
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, "manual-conflicting-file\n", "utf8");

  await assert.rejects(
    () =>
      engine.applyLocalSync({
        jobId: regenAccepted.jobId,
        confirmationToken: preview.confirmationToken,
        confirmOverwrite: true,
        reviewerNote: "Approved during stale preview test.",
        fileDecisions: preview.files.map((entry) => ({
          path: entry.path,
          decision: entry.decision,
        })),
      }),
    (error: Error & { code?: string }) => error.code === "E_SYNC_PREVIEW_STALE",
  );
});

test("job-engine local sync rejects unreviewed sessions before any writes occur", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-sync-engine-governance-"),
  );
  const outputRoot = path.join(tempRoot, "runtime-output");
  const workspaceRoot = path.join(tempRoot, "workspace-root");
  await mkdir(workspaceRoot, { recursive: true });

  const figmaPath = path.join(workspaceRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot,
      jobsRoot: path.join(outputRoot, "jobs"),
      reprosRoot: path.join(outputRoot, "repros"),
      workspaceRoot,
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      enablePerfValidation: false,
      enableUiValidation: false,
      enableUnitTestValidation: false,
      installPreferOffline: true,
    }),
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    requestSourceMode: "local_json",
  });
  const sourceStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: sourceAccepted.jobId,
  });
  assert.equal(sourceStatus.status, "completed");

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "card-1", field: "cornerRadius", value: 16 }],
  });
  const regenStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: regenAccepted.jobId,
  });
  assert.equal(regenStatus.status, "completed");

  const preview = await engine.previewLocalSync({
    jobId: regenAccepted.jobId,
    targetPath: "sync-output",
  });
  const firstPreviewFile = preview.files[0];
  assert.ok(firstPreviewFile);
  const sourceImportSession = (await engine.listImportSessions()).find(
    (session) => session.jobId === sourceAccepted.jobId,
  );
  assert.ok(sourceImportSession);

  await assert.rejects(
    () =>
      engine.applyLocalSync({
        jobId: regenAccepted.jobId,
        confirmationToken: preview.confirmationToken,
        confirmOverwrite: true,
        reviewerNote: "Approved during local sync apply.",
        fileDecisions: preview.files.map((entry) => ({
          path: entry.path,
          decision: entry.decision,
        })),
      }),
    (error: Error & { code?: string }) =>
      error.code === "E_SYNC_IMPORT_REVIEW_REQUIRED",
  );

  const sourceAuditTrail = await engine.listImportSessionEvents({
    sessionId: sourceImportSession.id,
  });
  assert.equal(
    sourceAuditTrail.some((event) => event.kind === "approved"),
    false,
  );
  assert.equal(
    sourceAuditTrail.some((event) => event.kind === "applied"),
    false,
  );
  const firstFilePath = path.join(
    preview.destinationRoot,
    ...String(firstPreviewFile?.path ?? "").split("/"),
  );
  await assert.rejects(
    () => stat(firstFilePath),
    (error: Error & { code?: string }) => error.code === "ENOENT",
  );
});

test("job-engine local sync ignores a forged stored approved status when event history never approved the session", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-sync-engine-tainted-"),
  );
  const outputRoot = path.join(tempRoot, "runtime-output");
  const workspaceRoot = path.join(tempRoot, "workspace-root");
  await mkdir(workspaceRoot, { recursive: true });

  const figmaPath = path.join(workspaceRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot,
      jobsRoot: path.join(outputRoot, "jobs"),
      reprosRoot: path.join(outputRoot, "repros"),
      workspaceRoot,
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      enablePerfValidation: false,
      enableUiValidation: false,
      enableUnitTestValidation: false,
      installPreferOffline: true,
    }),
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    requestSourceMode: "local_json",
  });
  const sourceStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: sourceAccepted.jobId,
  });
  assert.equal(sourceStatus.status, "completed");

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "card-1", field: "cornerRadius", value: 16 }],
  });
  const regenStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: regenAccepted.jobId,
  });
  assert.equal(regenStatus.status, "completed");

  const preview = await engine.previewLocalSync({
    jobId: regenAccepted.jobId,
    targetPath: "sync-output",
  });
  const sourceImportSession = (await engine.listImportSessions()).find(
    (session) => session.jobId === sourceAccepted.jobId,
  );
  assert.ok(sourceImportSession);

  const sessionsPath = path.join(
    outputRoot,
    "import-sessions",
    "import-sessions.json",
  );
  const envelope = JSON.parse(await readFile(sessionsPath, "utf8")) as {
    contractVersion: string;
    sessions: Array<Record<string, unknown>>;
  };
  const persistedSourceSession = envelope.sessions.find(
    (session) => session.id === sourceImportSession.id,
  );
  assert.ok(persistedSourceSession);
  persistedSourceSession.status = "approved";
  await writeFile(
    sessionsPath,
    `${JSON.stringify(envelope, null, 2)}\n`,
    "utf8",
  );

  const taintedSession = (await engine.listImportSessions()).find(
    (session) => session.id === sourceImportSession.id,
  );
  assert.equal(taintedSession?.status, "approved");

  await assert.rejects(
    () =>
      engine.applyLocalSync({
        jobId: regenAccepted.jobId,
        confirmationToken: preview.confirmationToken,
        confirmOverwrite: true,
        reviewerNote: "Approved during local sync apply.",
        fileDecisions: preview.files.map((entry) => ({
          path: entry.path,
          decision: entry.decision,
        })),
      }),
    (error: Error & { code?: string }) =>
      error.code === "E_SYNC_IMPORT_REVIEW_REQUIRED",
  );

  const sourceAuditTrail = await engine.listImportSessionEvents({
    sessionId: sourceImportSession.id,
  });
  assert.equal(
    sourceAuditTrail.some((event) => event.kind === "approved"),
    false,
  );
  assert.equal(
    sourceAuditTrail.some((event) => event.kind === "applied"),
    false,
  );
});

test("job-engine local sync applies for approved sessions without appending a fresh approved event", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-sync-engine-approved-"),
  );
  const outputRoot = path.join(tempRoot, "runtime-output");
  const workspaceRoot = path.join(tempRoot, "workspace-root");
  await mkdir(workspaceRoot, { recursive: true });

  const figmaPath = path.join(workspaceRoot, "figma-input.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot,
      jobsRoot: path.join(outputRoot, "jobs"),
      reprosRoot: path.join(outputRoot, "repros"),
      workspaceRoot,
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      enablePerfValidation: false,
      enableUiValidation: false,
      enableUnitTestValidation: false,
      installPreferOffline: true,
    }),
  });

  const sourceAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    requestSourceMode: "local_json",
  });
  const sourceStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: sourceAccepted.jobId,
  });
  assert.equal(sourceStatus.status, "completed");

  const regenAccepted = engine.submitRegeneration({
    sourceJobId: sourceAccepted.jobId,
    overrides: [{ nodeId: "card-1", field: "cornerRadius", value: 16 }],
  });
  const regenStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: regenAccepted.jobId,
  });
  assert.equal(regenStatus.status, "completed");

  const preview = await engine.previewLocalSync({
    jobId: regenAccepted.jobId,
    targetPath: "sync-output",
  });
  const sourceImportSession = (await engine.listImportSessions()).find(
    (session) => session.jobId === sourceAccepted.jobId,
  );
  assert.ok(sourceImportSession);
  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId: sourceImportSession.id,
      kind: "review_started",
      at: "",
    },
  });
  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId: sourceImportSession.id,
      kind: "approved",
      at: "",
      note: "Reviewed through the authenticated event route.",
    },
  });

  const applied = await engine.applyLocalSync({
    jobId: regenAccepted.jobId,
    confirmationToken: preview.confirmationToken,
    confirmOverwrite: true,
    reviewerNote: "Approved during local sync apply.",
    fileDecisions: preview.files.map((entry) => ({
      path: entry.path,
      decision: entry.decision,
    })),
  });
  assert.equal(applied.jobId, regenAccepted.jobId);

  const sourceAuditTrail = await engine.listImportSessionEvents({
    sessionId: sourceImportSession.id,
  });
  const approvedEvents = sourceAuditTrail.filter(
    (event) => event.kind === "approved",
  );
  const appliedEvent = sourceAuditTrail.findLast(
    (event) => event.kind === "applied",
  );
  assert.equal(approvedEvents.length, 1);
  assert.equal(
    approvedEvents[0]?.note,
    "Reviewed through the authenticated event route.",
  );
  assert.equal(appliedEvent?.note, "Approved during local sync apply.");
});
