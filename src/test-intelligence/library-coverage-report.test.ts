import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LIBRARY_COVERAGE_REPORT_ARTIFACT_FILENAME,
  LIBRARY_COVERAGE_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type LibraryPrimitiveCoverageEntry,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildLibraryCoverageReport,
  isLibraryCoverageReport,
  writeLibraryCoverageReport,
} from "./library-coverage-report.js";

const baseEntry = (
  overrides: Partial<LibraryPrimitiveCoverageEntry> = {},
): LibraryPrimitiveCoverageEntry => ({
  primitiveId: "button.primary",
  libraryName: "figma-ds",
  libraryVersion: "2026.05.0",
  status: "implemented",
  testCaseCount: 4,
  ...overrides,
});

test("buildLibraryCoverageReport sorts deterministically and rolls counts", () => {
  const artifact = buildLibraryCoverageReport({
    releaseId: "figma-ds@2026.05.0",
    generatedAt: "2026-05-04T08:00:00.000Z",
    primitives: [
      baseEntry({ primitiveId: "checkbox", status: "stub", testCaseCount: 1 }),
      baseEntry({ primitiveId: "button.primary" }),
      baseEntry({ primitiveId: "modal.danger", status: "unimplemented", testCaseCount: 0 }),
      baseEntry({ primitiveId: "tooltip", status: "deprecated", testCaseCount: 0 }),
    ],
  });
  assert.equal(artifact.schemaVersion, LIBRARY_COVERAGE_REPORT_SCHEMA_VERSION);
  assert.equal(artifact.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.deepEqual(
    artifact.primitives.map((entry) => entry.primitiveId),
    ["button.primary", "checkbox", "modal.danger", "tooltip"],
  );
  assert.deepEqual(artifact.counts, {
    total: 4,
    deprecated: 1,
    implemented: 1,
    stub: 1,
    unimplemented: 1,
  });
});

test("buildLibraryCoverageReport rejects malformed inputs", () => {
  assert.throws(
    () =>
      buildLibraryCoverageReport({
        releaseId: "",
        generatedAt: "2026-05-04T08:00:00.000Z",
        primitives: [],
      }),
    /releaseId/,
  );
  assert.throws(
    () =>
      buildLibraryCoverageReport({
        releaseId: "rel-1",
        generatedAt: "yesterday",
        primitives: [],
      }),
    /generatedAt/,
  );
  assert.throws(
    () =>
      buildLibraryCoverageReport({
        releaseId: "rel-1",
        generatedAt: "2026-05-04T08:00:00.000Z",
        primitives: [baseEntry({ testCaseCount: -1 })],
      }),
    /invalid LibraryPrimitiveCoverageEntry/,
  );
});

test("isLibraryCoverageReport rejects schema drift and bad counts", () => {
  const ok = buildLibraryCoverageReport({
    releaseId: "figma-ds@2026.05.0",
    generatedAt: "2026-05-04T08:00:00.000Z",
    primitives: [baseEntry()],
  });
  assert.equal(isLibraryCoverageReport(ok), true);
  assert.equal(
    isLibraryCoverageReport({ ...ok, schemaVersion: "0.0.1" }),
    false,
  );
  assert.equal(
    isLibraryCoverageReport({
      ...ok,
      counts: { ...ok.counts, total: ok.counts.total + 1 },
    }),
    false,
  );
});

test("writeLibraryCoverageReport persists canonical JSON byte-stably", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "ti-libcov-"));
  try {
    const inputs = {
      releaseId: "figma-ds@2026.05.0",
      generatedAt: "2026-05-04T08:00:00.000Z",
      primitives: [baseEntry()],
    } as const;
    const first = await writeLibraryCoverageReport({ runDir, ...inputs });
    const second = await writeLibraryCoverageReport({ runDir, ...inputs });
    assert.equal(first.serialized, second.serialized);
    assert.ok(
      first.artifactPath.endsWith(LIBRARY_COVERAGE_REPORT_ARTIFACT_FILENAME),
    );
    const onDisk = await readFile(first.artifactPath, "utf8");
    assert.equal(onDisk, `${canonicalJson(first.artifact)}\n`);
    assert.equal(isLibraryCoverageReport(JSON.parse(onDisk)), true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("library-coverage-report: golden byte-identity for the canonical example", () => {
  const artifact = buildLibraryCoverageReport({
    releaseId: "figma-ds@2026.05.0",
    generatedAt: "2026-05-04T08:00:00.000Z",
    primitives: [baseEntry()],
  });
  const golden =
    '{"contractVersion":"1.6.0","counts":{"deprecated":0,"implemented":1,"stub":0,"total":1,"unimplemented":0},' +
    '"generatedAt":"2026-05-04T08:00:00.000Z","primitives":[' +
    '{"libraryName":"figma-ds","libraryVersion":"2026.05.0","primitiveId":"button.primary","status":"implemented","testCaseCount":4}' +
    '],"releaseId":"figma-ds@2026.05.0","schemaVersion":"1.0.0"}';
  assert.equal(canonicalJson(artifact), golden);
});
