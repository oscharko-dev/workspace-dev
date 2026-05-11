import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { copyDir, pathExists, resolveAbsoluteOutputRoot } from "./fs-helpers.js";

test("resolveAbsoluteOutputRoot derives jobs and repros roots from the output root", () => {
  const resolved = resolveAbsoluteOutputRoot({ outputRoot: "/workspace/output" });

  assert.deepEqual(resolved, {
    outputRoot: "/workspace/output",
    jobsRoot: "/workspace/output/jobs",
    reprosRoot: "/workspace/output/repros"
  });
});

test("pathExists reports existing and missing paths", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-fs-helpers-"));
  const filePath = path.join(tmpDir, "existing.txt");
  const missingPath = path.join(tmpDir, "missing.txt");

  try {
    await writeFile(filePath, "hello\n", "utf8");

    assert.equal(await pathExists(filePath), true);
    assert.equal(await pathExists(missingPath), false);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("copyDir copies recursively, creates parent directories, and respects the filter", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-copy-dir-"));
  const sourceDir = path.join(tmpDir, "source");
  const targetDir = path.join(tmpDir, "deep", "nested", "target");
  const keepFile = path.join(sourceDir, "keep.txt");
  const skipFile = path.join(sourceDir, "skip.txt");
  const nestedDir = path.join(sourceDir, "nested");
  const nestedFile = path.join(nestedDir, "nested-keep.txt");

  try {
    await mkdir(nestedDir, { recursive: true });
    await writeFile(keepFile, "keep\n", "utf8");
    await writeFile(skipFile, "skip\n", "utf8");
    await writeFile(nestedFile, "nested\n", "utf8");

    await copyDir({
      sourceDir,
      targetDir,
      filter: (sourcePath) => !sourcePath.endsWith(`${path.sep}skip.txt`)
    });

    assert.equal(await pathExists(targetDir), true);
    assert.equal(await readFile(path.join(targetDir, "keep.txt"), "utf8"), "keep\n");
    assert.equal(await readFile(path.join(targetDir, "nested", "nested-keep.txt"), "utf8"), "nested\n");
    assert.equal(await pathExists(path.join(targetDir, "skip.txt")), false);
    assert.equal(await stat(path.join(tmpDir, "deep", "nested")).then((value) => value.isDirectory()), true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
