import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  computeGenerationDiff,
  formatDiffForPrDescription,
  loadPreviousSnapshot,
  runGenerationDiff,
  saveCurrentSnapshot,
  type FileHashEntry,
  type GenerationHashSnapshot
} from "./generation-diff.js";

test("computeGenerationDiff returns all added for first generation", () => {
  const files: FileHashEntry[] = [
    { relativePath: "src/App.tsx", sha256: "aaa", sizeBytes: 100 },
    { relativePath: "src/theme.ts", sha256: "bbb", sizeBytes: 50 }
  ];

  const report = computeGenerationDiff({
    boardKey: "test-board-abc1234567",
    currentJobId: "job-1",
    previousSnapshot: null,
    currentFiles: files
  });

  assert.equal(report.added.length, 2);
  assert.equal(report.modified.length, 0);
  assert.equal(report.removed.length, 0);
  assert.equal(report.unchanged.length, 0);
  assert.equal(report.previousJobId, null);
  assert.ok(report.summary.includes("2 files added"));
});

test("computeGenerationDiff detects modified, added, removed, unchanged", () => {
  const previous: GenerationHashSnapshot = {
    boardKey: "test-board-abc1234567",
    jobId: "job-1",
    generatedAt: new Date().toISOString(),
    files: [
      { relativePath: "src/App.tsx", sha256: "aaa", sizeBytes: 100 },
      { relativePath: "src/OldScreen.tsx", sha256: "ccc", sizeBytes: 200 },
      { relativePath: "src/theme.ts", sha256: "ddd", sizeBytes: 50 }
    ]
  };

  const current: FileHashEntry[] = [
    { relativePath: "src/App.tsx", sha256: "aaa-modified", sizeBytes: 120 },
    { relativePath: "src/NewScreen.tsx", sha256: "eee", sizeBytes: 300 },
    { relativePath: "src/theme.ts", sha256: "ddd", sizeBytes: 50 }
  ];

  const report = computeGenerationDiff({
    boardKey: "test-board-abc1234567",
    currentJobId: "job-2",
    previousSnapshot: previous,
    currentFiles: current
  });

  assert.equal(report.previousJobId, "job-1");
  assert.deepEqual(report.added, ["src/NewScreen.tsx"]);
  assert.equal(report.modified.length, 1);
  assert.equal(report.modified[0]?.file, "src/App.tsx");
  assert.deepEqual(report.removed, ["src/OldScreen.tsx"]);
  assert.deepEqual(report.unchanged, ["src/theme.ts"]);
  assert.ok(report.summary.includes("1 file modified"));
  assert.ok(report.summary.includes("1 added"));
  assert.ok(report.summary.includes("1 removed"));
  assert.ok(report.summary.includes("1 unchanged"));
});

test("computeGenerationDiff returns no changes when identical", () => {
  const files: FileHashEntry[] = [
    { relativePath: "src/App.tsx", sha256: "aaa", sizeBytes: 100 }
  ];
  const previous: GenerationHashSnapshot = {
    boardKey: "board-abc1234567",
    jobId: "job-1",
    generatedAt: new Date().toISOString(),
    files
  };

  const report = computeGenerationDiff({
    boardKey: "board-abc1234567",
    currentJobId: "job-2",
    previousSnapshot: previous,
    currentFiles: files
  });

  assert.equal(report.added.length, 0);
  assert.equal(report.modified.length, 0);
  assert.equal(report.removed.length, 0);
  assert.equal(report.unchanged.length, 1);
  assert.ok(report.summary.includes("1 unchanged"));
});

test("saveCurrentSnapshot and loadPreviousSnapshot round-trip", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gendiff-roundtrip-"));

  const snapshot: GenerationHashSnapshot = {
    boardKey: "board-abc1234567",
    jobId: "job-1",
    generatedAt: new Date().toISOString(),
    files: [
      { relativePath: "src/App.tsx", sha256: "abc123", sizeBytes: 100 }
    ]
  };

  await saveCurrentSnapshot({ outputRoot: tempDir, snapshot });
  const loaded = await loadPreviousSnapshot({ outputRoot: tempDir, boardKey: "board-abc1234567" });

  assert.ok(loaded !== null);
  assert.equal(loaded.boardKey, "board-abc1234567");
  assert.equal(loaded.jobId, "job-1");
  assert.equal(loaded.files.length, 1);
  assert.equal(loaded.files[0]?.relativePath, "src/App.tsx");
});

test("loadPreviousSnapshot returns null when no snapshot exists", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gendiff-nosnapshot-"));
  const result = await loadPreviousSnapshot({ outputRoot: tempDir, boardKey: "nonexistent-123abc" });
  assert.equal(result, null);
});

test("runGenerationDiff creates diff report file and updates snapshot", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-gendiff-full-"));
  const projectDir = path.join(tempDir, "generated-app");
  const jobDir = path.join(tempDir, "job");
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  await mkdir(jobDir, { recursive: true });
  await writeFile(path.join(projectDir, "src", "App.tsx"), "export default function App() {}", "utf8");
  await writeFile(path.join(projectDir, "package.json"), '{"name": "test"}', "utf8");

  const report = await runGenerationDiff({
    generatedProjectDir: projectDir,
    jobDir,
    outputRoot: tempDir,
    boardKey: "test-board-abc1234567",
    jobId: "job-1"
  });

  assert.ok(report.added.length > 0);
  assert.equal(report.previousJobId, null);

  const reportFile = await readFile(path.join(jobDir, "generation-diff.json"), "utf8");
  const parsed = JSON.parse(reportFile) as { added: string[] };
  assert.ok(parsed.added.length > 0);

  // Run again to verify comparison with previous snapshot
  const jobDir2 = path.join(tempDir, "job2");
  await mkdir(jobDir2, { recursive: true });
  await writeFile(path.join(projectDir, "src", "NewScreen.tsx"), "export default function NewScreen() {}", "utf8");

  const report2 = await runGenerationDiff({
    generatedProjectDir: projectDir,
    jobDir: jobDir2,
    outputRoot: tempDir,
    boardKey: "test-board-abc1234567",
    jobId: "job-2"
  });

  assert.equal(report2.previousJobId, "job-1");
  assert.ok(report2.added.includes("src/NewScreen.tsx"));
  assert.ok(report2.unchanged.length > 0);
});

test("formatDiffForPrDescription includes diff sections", () => {
  const report = computeGenerationDiff({
    boardKey: "test-board-abc1234567",
    currentJobId: "job-2",
    previousSnapshot: {
      boardKey: "test-board-abc1234567",
      jobId: "job-1",
      generatedAt: new Date().toISOString(),
      files: [
        { relativePath: "src/App.tsx", sha256: "aaa", sizeBytes: 100 },
        { relativePath: "src/Old.tsx", sha256: "bbb", sizeBytes: 50 }
      ]
    },
    currentFiles: [
      { relativePath: "src/App.tsx", sha256: "aaa-changed", sizeBytes: 120 },
      { relativePath: "src/New.tsx", sha256: "ccc", sizeBytes: 200 }
    ]
  });

  const formatted = formatDiffForPrDescription(report);

  assert.ok(formatted.includes("### Generation Diff Report"));
  assert.ok(formatted.includes("**Summary:**"));
  assert.ok(formatted.includes("**Added files:**"));
  assert.ok(formatted.includes("`src/New.tsx`"));
  assert.ok(formatted.includes("**Modified files:**"));
  assert.ok(formatted.includes("`src/App.tsx`"));
  assert.ok(formatted.includes("**Removed files:**"));
  assert.ok(formatted.includes("`src/Old.tsx`"));
  assert.ok(formatted.includes("Previous job: `job-1`"));
});

test("formatDiffForPrDescription truncates long file lists", () => {
  const addedFiles: FileHashEntry[] = [];
  for (let i = 0; i < 25; i++) {
    addedFiles.push({ relativePath: `src/Screen${i}.tsx`, sha256: `hash-${i}`, sizeBytes: 100 });
  }

  const report = computeGenerationDiff({
    boardKey: "test-board-abc1234567",
    currentJobId: "job-1",
    previousSnapshot: null,
    currentFiles: addedFiles
  });

  const formatted = formatDiffForPrDescription(report);
  assert.ok(formatted.includes("... and 5 more"));
});
