import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { STAGE_ARTIFACT_KEYS } from "./artifact-keys.js";
import { StageArtifactStore } from "./artifact-store.js";
import { SchemaValidationError } from "./pipeline-schemas.js";

test("StageArtifactStore persists references across instances", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-"),
  );
  const jobDir = path.join(root, "job");
  const artifactFile = path.join(jobDir, "artifact.json");
  await mkdir(jobDir, { recursive: true });

  const store = new StageArtifactStore({ jobDir });
  await store.setPath({
    key: "design.ir",
    stage: "ir.derive",
    absolutePath: artifactFile,
  });
  await store.setValue({
    key: "status",
    stage: "validate.project",
    value: { ok: true },
  });

  const reloaded = new StageArtifactStore({ jobDir });
  assert.equal(await reloaded.getPath("design.ir"), artifactFile);
  assert.deepEqual(await reloaded.getValue<{ ok: boolean }>("status"), {
    ok: true,
  });
  assert.equal((await reloaded.list()).length, 2);
});

test("StageArtifactStore rejects non-absolute paths", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-path-"),
  );
  const store = new StageArtifactStore({ jobDir: root });

  await assert.rejects(async () => {
    await store.setPath({
      key: "design.ir",
      stage: "ir.derive",
      absolutePath: "relative/file.json",
    });
  }, /absolute path/i);
});

test("StageArtifactStore require helpers return stored references and fail on missing artifacts", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-require-"),
  );
  const store = new StageArtifactStore({ jobDir: root });
  const artifactPath = path.join(root, "artifact.json");
  await store.setPath({
    key: "design.ir",
    stage: "ir.derive",
    absolutePath: artifactPath,
  });
  await store.setValue({
    key: "meta",
    stage: "codegen.generate",
    value: { ok: true },
  });

  assert.equal(await store.requirePath("design.ir"), artifactPath);
  assert.deepEqual(await store.requireValue<{ ok: boolean }>("meta"), {
    ok: true,
  });
  await assert.rejects(
    async () => store.requirePath("missing.path"),
    /missing/i,
  );
  await assert.rejects(
    async () => store.requireValue("missing.value"),
    /missing/i,
  );
});

test("StageArtifactStore sanitizes reference filenames against key traversal patterns", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-key-"),
  );
  const store = new StageArtifactStore({ jobDir: root });
  await store.setValue({
    key: "../outside/../artifact",
    stage: "figma.source",
    value: { ok: true },
  });

  const files = await readdir(path.join(root, ".stage-store", "refs"));
  assert.equal(
    files.some((name) => name.includes("..")),
    false,
  );
  assert.equal(files.length, 1);
});

test("StageArtifactStore getValue with passing validator returns value", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-validator-"),
  );
  const store = new StageArtifactStore({ jobDir: root });
  await store.setValue({
    key: "status",
    stage: "ir.derive",
    value: { ok: true },
  });
  const validator = (v: unknown): v is { ok: boolean } =>
    typeof v === "object" &&
    v !== null &&
    "ok" in v &&
    typeof (v as Record<string, unknown>).ok === "boolean";
  const result = await store.getValue<{ ok: boolean }>("status", validator);
  assert.deepEqual(result, { ok: true });
});

test("StageArtifactStore getValue with failing validator throws SchemaValidationError", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-validator-fail-"),
  );
  const store = new StageArtifactStore({ jobDir: root });
  await store.setValue({
    key: "status",
    stage: "ir.derive",
    value: "not-an-object",
  });
  const validator = (v: unknown): v is { ok: boolean } =>
    typeof v === "object" && v !== null && "ok" in v;
  await assert.rejects(
    async () => store.getValue<{ ok: boolean }>("status", validator),
    (error: unknown) => {
      assert.ok(error instanceof SchemaValidationError);
      assert.ok(error.message.includes("failed schema validation"));
      return true;
    },
  );
});

test("StageArtifactStore requireValue with passing validator returns value", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-require-validator-"),
  );
  const store = new StageArtifactStore({ jobDir: root });
  await store.setValue({
    key: "meta",
    stage: "codegen.generate",
    value: { ok: true },
  });
  const validator = (v: unknown): v is { ok: boolean } =>
    typeof v === "object" &&
    v !== null &&
    "ok" in v &&
    typeof (v as Record<string, unknown>).ok === "boolean";
  const result = await store.requireValue<{ ok: boolean }>("meta", validator);
  assert.deepEqual(result, { ok: true });
});

test("StageArtifactStore requireValue with failing validator throws SchemaValidationError", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-require-validator-fail-"),
  );
  const store = new StageArtifactStore({ jobDir: root });
  await store.setValue({ key: "meta", stage: "codegen.generate", value: 42 });
  const validator = (v: unknown): v is { ok: boolean } =>
    typeof v === "object" && v !== null && "ok" in v;
  await assert.rejects(
    async () => store.requireValue<{ ok: boolean }>("meta", validator),
    (error: unknown) => {
      assert.ok(error instanceof SchemaValidationError);
      return true;
    },
  );
});

test("StageArtifactStore concurrent ensureLoaded calls share a single load", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-concurrent-"),
  );
  const seeder = new StageArtifactStore({ jobDir: root });
  await seeder.setValue({
    key: "status",
    stage: "ir.derive",
    value: { ok: true },
  });
  await seeder.setPath({
    key: "design.ir",
    stage: "ir.derive",
    absolutePath: path.join(root, "ir.json"),
  });

  const store = new StageArtifactStore({ jobDir: root });
  const [listA, refA, listB] = await Promise.all([
    store.list(),
    store.getReference("status"),
    store.list(),
  ]);
  assert.equal(listA.length, 2);
  assert.equal(listB.length, 2);
  assert.ok(refA);
  assert.equal(refA.kind, "value");
});

test("StageArtifactStore ignores .tmp leftover files from torn writes", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-torn-"),
  );
  const store = new StageArtifactStore({ jobDir: root });
  const artifactPath = path.join(root, "artifact.json");
  await store.setPath({
    key: "design.ir",
    stage: "ir.derive",
    absolutePath: artifactPath,
  });

  const refsDir = path.join(root, ".stage-store", "refs");
  await writeFile(
    path.join(refsDir, "stale.json.tmp"),
    "partial data not json",
    "utf8",
  );

  const reloaded = new StageArtifactStore({ jobDir: root });
  const list = await reloaded.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].key, "design.ir");
});

test("StageArtifactStore first-run load leaves corruption diagnostic null", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-first-run-"),
  );
  const store = new StageArtifactStore({ jobDir: root });
  assert.deepEqual(await store.list(), []);
  assert.equal(store.getCorruptionDiagnostic(), null);
});

test("StageArtifactStore records corruption diagnostic when index.json is invalid JSON", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-corrupt-"),
  );
  const storeRoot = path.join(root, ".stage-store");
  await mkdir(path.join(storeRoot, "refs"), { recursive: true });
  await writeFile(path.join(storeRoot, "index.json"), "not json", "utf8");

  const store = new StageArtifactStore({ jobDir: root });
  const list = await store.list();
  assert.deepEqual(list, []);
  const diagnostic = store.getCorruptionDiagnostic();
  assert.ok(diagnostic !== null);
  assert.match(diagnostic, /index load failed/i);
});

test("StageArtifactStore reconciles ref files when index.json is missing", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-reconcile-"),
  );
  const seeder = new StageArtifactStore({ jobDir: root });
  await seeder.setPath({
    key: "design.ir",
    stage: "ir.derive",
    absolutePath: path.join(root, "ir.json"),
  });
  await seeder.setValue({
    key: "status",
    stage: "ir.derive",
    value: { ok: true },
  });

  await unlink(path.join(root, ".stage-store", "index.json"));

  const reloaded = new StageArtifactStore({ jobDir: root });
  const list = await reloaded.list();
  assert.ok(list.length >= 1);
  const diagnostic = reloaded.getCorruptionDiagnostic();
  assert.ok(diagnostic !== null);

  await rm(root, { recursive: true, force: true });
});

test("StageArtifactStore supports concurrent writes and reads on a single instance", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-concurrent-access-"),
  );
  const store = new StageArtifactStore({ jobDir: root });

  await Promise.all([
    store.setValue({
      key: STAGE_ARTIFACT_KEYS.validationSummary,
      stage: "validate.project",
      value: { status: "ok" },
    }),
    store.setValue({
      key: STAGE_ARTIFACT_KEYS.codegenSummary,
      stage: "codegen.generate",
      value: { generatedPaths: ["src/App.tsx"] },
    }),
  ]);

  const [validationSummary, codegenSummary, references] = await Promise.all([
    store.getValue<{ status: string }>(
      STAGE_ARTIFACT_KEYS.validationSummary,
    ),
    store.getValue<{ generatedPaths: string[] }>(
      STAGE_ARTIFACT_KEYS.codegenSummary,
    ),
    store.list(),
  ]);
  assert.deepEqual(validationSummary, { status: "ok" });
  assert.deepEqual(codegenSummary, { generatedPaths: ["src/App.tsx"] });
  assert.equal(references.length, 2);
});

test("StageArtifactStore surfaces refs-dir filesystem conflicts without leaving committed refs", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-stage-store-refs-conflict-"),
  );
  const storeRoot = path.join(root, ".stage-store");
  const refsPath = path.join(storeRoot, "refs");
  await mkdir(storeRoot, { recursive: true });
  await writeFile(refsPath, "not-a-directory", "utf8");

  try {
    const store = new StageArtifactStore({ jobDir: root });
    await assert.rejects(
      async () => {
        await store.setValue({
          key: STAGE_ARTIFACT_KEYS.validationSummary,
          stage: "validate.project",
          value: { status: "ok" },
        });
      },
      (error: unknown) => {
        assert.ok(error instanceof Error);
        return /EEXIST|ENOTDIR/i.test(String(error));
      },
    );

    await unlink(refsPath);
    await mkdir(refsPath, { recursive: true });
    const reloaded = new StageArtifactStore({ jobDir: root });
    assert.equal(
      await reloaded.getValue(STAGE_ARTIFACT_KEYS.validationSummary),
      undefined,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
