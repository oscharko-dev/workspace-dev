import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PIPELINE_QUALITY_PASSPORT_ARTIFACT_FILENAME,
  PIPELINE_QUALITY_PASSPORT_SCHEMA_VERSION,
  type WorkspaceJobPipelineMetadata,
} from "../../contracts/index.js";
import {
  buildPipelineQualityPassport,
  projectQualityPassportMetadata,
  serializePipelineQualityPassport,
  writePipelineQualityPassport,
} from "./quality-passport.js";

const PIPELINE_METADATA: WorkspaceJobPipelineMetadata = {
  pipelineId: "default",
  pipelineDisplayName: "Default",
  templateBundleId: "react-tailwind-app",
  buildProfile: "default-rocket",
  deterministic: true,
};

test("buildPipelineQualityPassport normalizes deterministic evidence", () => {
  const passport = buildPipelineQualityPassport({
    pipelineMetadata: PIPELINE_METADATA,
    sourceMode: "figma_paste",
    scope: "selection",
    selectedNodeCount: 2,
    generatedFiles: [
      { path: "src/z.tsx", content: "z" },
      { path: "./src/App.tsx", content: "app" },
    ],
    validationStages: [
      { name: "validate.project", status: "completed" },
      { name: "figma.source", status: "completed" },
      { name: "codegen.generate", status: "completed" },
      { name: "ir.derive", status: "completed" },
      { name: "template.prepare", status: "completed" },
    ],
    tokenCoverage: { covered: 7, total: 10 },
    semanticCoverage: { covered: 4, total: 4 },
    warnings: [
      {
        code: "W_SEMANTIC_FALLBACK",
        severity: "warning",
        source: "semantic",
        message: "Used fallback component.",
      },
      {
        code: "W_SEMANTIC_FALLBACK",
        severity: "warning",
        source: "semantic",
        message: "Used fallback component.",
      },
      { code: "I_TOKEN", severity: "info", message: "Token inferred." },
      {
        code: "W_SECRET_TEXT",
        severity: "error",
        message: "Validation included bearer sk-do-not-emit in raw output.",
      },
    ],
    metadata: {
      llmApiKey: "sk-do-not-emit",
      nested: {
        bearer: "Bearer ghp_not_real",
        safe: "kept",
      },
    },
  });

  assert.equal(passport.schemaVersion, PIPELINE_QUALITY_PASSPORT_SCHEMA_VERSION);
  assert.equal(passport.pipelineId, "default");
  assert.deepEqual(
    passport.generatedFiles.map((file) => file.path),
    ["src/App.tsx", "src/z.tsx"],
  );
  assert.deepEqual(
    passport.validation.stages.map((stage) => stage.name),
    [
      "figma.source",
      "ir.derive",
      "template.prepare",
      "codegen.generate",
      "validate.project",
    ],
  );
  assert.equal(passport.validation.status, "passed");
  assert.deepEqual(passport.coverage.token, {
    status: "warning",
    covered: 7,
    total: 10,
    ratio: 0.7,
  });
  assert.deepEqual(passport.coverage.semantic, {
    status: "passed",
    covered: 4,
    total: 4,
    ratio: 1,
  });
  assert.equal(passport.warnings.length, 3);
  assert.deepEqual(passport.warnings[0], {
    code: "W_SECRET_TEXT",
    severity: "error",
    message: "Validation included [REDACTED] in raw output.",
  });
  assert.deepEqual(passport.metadata, {
    llmApiKey: "[REDACTED]",
    nested: {
      bearer: "[REDACTED]",
      safe: "kept",
    },
  });
});

test("serializePipelineQualityPassport emits canonical snapshot bytes", () => {
  const first = buildPipelineQualityPassport({
    pipelineMetadata: PIPELINE_METADATA,
    sourceMode: "local_json",
    scope: "board",
    generatedFiles: [
      { path: "b.ts", sizeBytes: 2, sha256: "b".repeat(64) },
      { path: "a.ts", sizeBytes: 1, sha256: "a".repeat(64) },
    ],
    validationStages: [{ name: "validate.project", status: "failed" }],
    tokenCoverage: { covered: 0, total: 0 },
    semanticCoverage: { covered: 1, total: 3 },
    metadata: { z: true, a: "stable" },
  });
  const second = buildPipelineQualityPassport({
    pipelineMetadata: PIPELINE_METADATA,
    sourceMode: "local_json",
    scope: "board",
    generatedFiles: [
      { path: "a.ts", sizeBytes: 1, sha256: "a".repeat(64) },
      { path: "b.ts", sizeBytes: 2, sha256: "b".repeat(64) },
    ],
    validationStages: [{ name: "validate.project", status: "failed" }],
    tokenCoverage: { covered: 0, total: 0 },
    semanticCoverage: { covered: 1, total: 3 },
    metadata: { a: "stable", z: true },
  });

  assert.equal(
    serializePipelineQualityPassport(first),
    serializePipelineQualityPassport(second),
  );
  assert.equal(first.validation.status, "failed");
  assert.equal(first.coverage.token.status, "not_run");
  assert.equal(first.coverage.semantic.status, "warning");
  assert.match(serializePipelineQualityPassport(first), /\n$/);
});

test("projectQualityPassportMetadata redacts secret-shaped fields and values", () => {
  assert.deepEqual(
    projectQualityPassportMetadata({
      fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
      authorization: "Bearer ghp_not_real",
      nested: [{ accessToken: "figd_not_real" }, { label: "public" }],
      count: Number.POSITIVE_INFINITY,
      omitted: undefined,
    }),
    {
      authorization: "[REDACTED]",
      count: null,
      fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
      nested: [{ accessToken: "[REDACTED]" }, { label: "public" }],
    },
  );
});

test("writePipelineQualityPassport writes canonical quality-passport.json", async () => {
  const destinationDir = await mkdtemp(
    join(tmpdir(), "workspace-quality-passport-"),
  );
  const passport = buildPipelineQualityPassport({
    pipelineMetadata: PIPELINE_METADATA,
    sourceMode: "local_json",
    scope: "node",
    generatedFiles: [],
    validationStages: [],
    tokenCoverage: { covered: 0, total: 0 },
    semanticCoverage: { covered: 0, total: 0 },
  });

  const path = await writePipelineQualityPassport({
    passport,
    destinationDir,
  });

  assert.equal(
    path,
    join(destinationDir, PIPELINE_QUALITY_PASSPORT_ARTIFACT_FILENAME),
  );
  assert.equal(
    await readFile(path, "utf8"),
    serializePipelineQualityPassport(passport),
  );
});

test("buildPipelineQualityPassport rejects unsafe generated file paths", () => {
  assert.throws(
    () =>
      buildPipelineQualityPassport({
        pipelineMetadata: PIPELINE_METADATA,
        sourceMode: "local_json",
        scope: "board",
        generatedFiles: [{ path: "../secret.txt", content: "x" }],
        validationStages: [],
        tokenCoverage: { covered: 0, total: 0 },
        semanticCoverage: { covered: 0, total: 0 },
      }),
    /safe relative path/,
  );
});

test("buildPipelineQualityPassport rejects duplicate generated file paths", () => {
  assert.throws(
    () =>
      buildPipelineQualityPassport({
        pipelineMetadata: PIPELINE_METADATA,
        sourceMode: "local_json",
        scope: "board",
        generatedFiles: [
          { path: "src/App.tsx", content: "first" },
          { path: "./src/App.tsx", content: "second" },
        ],
        validationStages: [],
        tokenCoverage: { covered: 0, total: 0 },
        semanticCoverage: { covered: 0, total: 0 },
      }),
    /appears more than once/,
  );
});

test("buildPipelineQualityPassport never serializes non-finite numeric evidence as null", () => {
  const passport = buildPipelineQualityPassport({
    pipelineMetadata: PIPELINE_METADATA,
    sourceMode: "local_json",
    scope: "board",
    selectedNodeCount: Number.NaN,
    generatedFiles: [],
    validationStages: [],
    tokenCoverage: { covered: Number.NaN, total: 10 },
    semanticCoverage: { covered: 1, total: Number.POSITIVE_INFINITY },
  });

  assert.equal(passport.scope.selectedNodeCount, 0);
  assert.deepEqual(passport.coverage.token, {
    status: "failed",
    covered: 0,
    total: 10,
    ratio: 0,
  });
  assert.deepEqual(passport.coverage.semantic, {
    status: "not_run",
    covered: 0,
    total: 0,
    ratio: 0,
  });

  const serialized = serializePipelineQualityPassport(passport);
  assert.doesNotMatch(serialized, /"selectedNodeCount":null/);
  assert.doesNotMatch(serialized, /"covered":null/);
  assert.doesNotMatch(serialized, /"total":null/);
  assert.doesNotMatch(serialized, /"ratio":null/);
});
