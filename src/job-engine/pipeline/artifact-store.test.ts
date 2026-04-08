import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StageArtifactStore } from "./artifact-store.js";
import { SchemaValidationError } from "./pipeline-schemas.js";

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

test("StageArtifactStore getValue with passing validator returns value", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-store-validator-"));
  const store = new StageArtifactStore({ jobDir: root });
  await store.setValue({ key: "status", stage: "ir.derive", value: { ok: true } });
  const validator = (v: unknown): v is { ok: boolean } =>
    typeof v === "object" && v !== null && "ok" in v && typeof (v as Record<string, unknown>).ok === "boolean";
  const result = await store.getValue<{ ok: boolean }>("status", validator);
  assert.deepEqual(result, { ok: true });
});

test("StageArtifactStore getValue with failing validator throws SchemaValidationError", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-store-validator-fail-"));
  const store = new StageArtifactStore({ jobDir: root });
  await store.setValue({ key: "status", stage: "ir.derive", value: "not-an-object" });
  const validator = (v: unknown): v is { ok: boolean } =>
    typeof v === "object" && v !== null && "ok" in v;
  await assert.rejects(
    async () => store.getValue<{ ok: boolean }>("status", validator),
    (error: unknown) => {
      assert.ok(error instanceof SchemaValidationError);
      assert.ok(error.message.includes("failed schema validation"));
      return true;
    }
  );
});

test("StageArtifactStore requireValue with passing validator returns value", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-store-require-validator-"));
  const store = new StageArtifactStore({ jobDir: root });
  await store.setValue({ key: "meta", stage: "codegen.generate", value: { ok: true } });
  const validator = (v: unknown): v is { ok: boolean } =>
    typeof v === "object" && v !== null && "ok" in v && typeof (v as Record<string, unknown>).ok === "boolean";
  const result = await store.requireValue<{ ok: boolean }>("meta", validator);
  assert.deepEqual(result, { ok: true });
});

test("StageArtifactStore requireValue with failing validator throws SchemaValidationError", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-store-require-validator-fail-"));
  const store = new StageArtifactStore({ jobDir: root });
  await store.setValue({ key: "meta", stage: "codegen.generate", value: 42 });
  const validator = (v: unknown): v is { ok: boolean } =>
    typeof v === "object" && v !== null && "ok" in v;
  await assert.rejects(
    async () => store.requireValue<{ ok: boolean }>("meta", validator),
    (error: unknown) => {
      assert.ok(error instanceof SchemaValidationError);
      return true;
    }
  );
});
