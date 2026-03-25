import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StageArtifactStore } from "./artifact-store.js";

test("StageArtifactStore persists references across instances", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-store-"));
  const jobDir = path.join(root, "job");
  const artifactFile = path.join(jobDir, "artifact.json");
  await mkdir(jobDir, { recursive: true });

  const store = new StageArtifactStore({ jobDir });
  await store.setPath({
    key: "design.ir",
    stage: "ir.derive",
    absolutePath: artifactFile
  });
  await store.setValue({
    key: "status",
    stage: "validate.project",
    value: { ok: true }
  });

  const reloaded = new StageArtifactStore({ jobDir });
  assert.equal(await reloaded.getPath("design.ir"), artifactFile);
  assert.deepEqual(await reloaded.getValue<{ ok: boolean }>("status"), { ok: true });
  assert.equal((await reloaded.list()).length, 2);
});

test("StageArtifactStore rejects non-absolute paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-store-path-"));
  const store = new StageArtifactStore({ jobDir: root });

  await assert.rejects(
    async () => {
      await store.setPath({
        key: "design.ir",
        stage: "ir.derive",
        absolutePath: "relative/file.json"
      });
    },
    /absolute path/i
  );
});

test("StageArtifactStore require helpers return stored references and fail on missing artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-store-require-"));
  const store = new StageArtifactStore({ jobDir: root });
  const artifactPath = path.join(root, "artifact.json");
  await store.setPath({
    key: "design.ir",
    stage: "ir.derive",
    absolutePath: artifactPath
  });
  await store.setValue({
    key: "meta",
    stage: "codegen.generate",
    value: { ok: true }
  });

  assert.equal(await store.requirePath("design.ir"), artifactPath);
  assert.deepEqual(await store.requireValue<{ ok: boolean }>("meta"), { ok: true });
  await assert.rejects(async () => store.requirePath("missing.path"), /missing/i);
  await assert.rejects(async () => store.requireValue("missing.value"), /missing/i);
});

test("StageArtifactStore sanitizes reference filenames against key traversal patterns", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-store-key-"));
  const store = new StageArtifactStore({ jobDir: root });
  await store.setValue({
    key: "../outside/../artifact",
    stage: "figma.source",
    value: { ok: true }
  });

  const files = await readdir(path.join(root, ".stage-store", "refs"));
  assert.equal(files.some((name) => name.includes("..")), false);
  assert.equal(files.length, 1);
});
