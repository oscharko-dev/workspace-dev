import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";

import { buildArtifactReport, findSingleTarballPath } from "./verify-reproducible-build.mjs";

test("findSingleTarballPath returns the only packed tarball", async () => {
  const packDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-pack-test-"));

  try {
    const tarballPath = path.join(packDir, "workspace-dev-1.0.0.tgz");
    await writeFile(tarballPath, "packed", "utf8");

    await assert.doesNotReject(findSingleTarballPath(packDir));
    assert.strictEqual(await findSingleTarballPath(packDir), tarballPath);
  } finally {
    await rm(packDir, { recursive: true, force: true });
  }
});

test("findSingleTarballPath rejects pack directories without exactly one tarball", async () => {
  const emptyPackDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-pack-empty-"));
  const multiPackDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-pack-multi-"));

  try {
    await writeFile(path.join(multiPackDir, "workspace-dev-1.0.0.tgz"), "first", "utf8");
    await writeFile(path.join(multiPackDir, "workspace-dev-1.0.1.tgz"), "second", "utf8");

    await assert.rejects(findSingleTarballPath(emptyPackDir), /Expected exactly one \.tgz/);
    await assert.rejects(findSingleTarballPath(multiPackDir), /Expected exactly one \.tgz/);
  } finally {
    await rm(emptyPackDir, { recursive: true, force: true });
    await rm(multiPackDir, { recursive: true, force: true });
  }
});

test("buildArtifactReport records dist and tarball reproducibility evidence", () => {
  const report = buildArtifactReport({
    generatedAt: "2026-04-17T00:00:00.000Z",
    distHashes: [{ file: "dist/index.js", sha256: "abc123" }],
    tarballs: {
      first: { file: "workspace-dev-1.0.0.tgz", sha256: "tar123" },
      second: { file: "workspace-dev-1.0.0.tgz", sha256: "tar123" }
    }
  });

  assert.deepStrictEqual(report, {
    generatedAt: "2026-04-17T00:00:00.000Z",
    dist: {
      reproducible: true,
      files: [{ file: "dist/index.js", sha256: "abc123" }]
    },
    tarball: {
      reproducible: true,
      first: { file: "workspace-dev-1.0.0.tgz", sha256: "tar123" },
      second: { file: "workspace-dev-1.0.0.tgz", sha256: "tar123" }
    }
  });
});
