import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  HARNESS_ARTIFACT_MANIFEST_ARTIFACT_FILENAME,
  HARNESS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
} from "../contracts/index.js";
import {
  buildHarnessArtifactManifest,
  hasHarnessArtifactManifest,
  isHarnessArtifactManifest,
  readHarnessArtifactManifest,
  verifyHarnessArtifactManifest,
  writeHarnessArtifactManifest,
} from "./harness-artifact-manifest.js";
import { writeAgentIterationsArtifact } from "./agent-iterations.js";
import { writeLibraryCoverageReport } from "./library-coverage-report.js";
import { writeCacheBreakEventsLog } from "./cache-break-events-log.js";
import {
  CACHE_BREAK_EVENTS_LOG_SCHEMA_VERSION,
} from "../contracts/index.js";

const HASH_A = "a".repeat(64);

const seedRunDir = async (): Promise<string> => {
  const runDir = await mkdtemp(join(tmpdir(), "ti-har-manifest-"));
  await writeAgentIterationsArtifact({
    runDir,
    jobId: "job-1",
    generatedAt: "2026-05-04T08:00:00.000Z",
    iterations: [
      {
        iteration: 0,
        roleStepId: "test_repair",
        startedAt: "2026-05-04T08:00:00.000Z",
        completedAt: "2026-05-04T08:00:30.000Z",
        outcome: "needs_repair",
        findingsCount: 1,
        parentHash: HASH_A,
      },
    ],
  });
  await writeLibraryCoverageReport({
    runDir,
    releaseId: "figma-ds@2026.05.0",
    generatedAt: "2026-05-04T08:00:00.000Z",
    primitives: [
      {
        primitiveId: "button.primary",
        libraryName: "figma-ds",
        libraryVersion: "2026.05.0",
        status: "implemented",
        testCaseCount: 1,
      },
    ],
  });
  await writeCacheBreakEventsLog({
    runDir,
    entries: [
      {
        schemaVersion: CACHE_BREAK_EVENTS_LOG_SCHEMA_VERSION,
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        jobId: "job-1",
        roleStepId: "test_generation",
        querySource: "judge_primary",
        ts: "2026-05-04T08:00:00.000Z",
        parentHash: HASH_A,
        cacheReadTokens: 0,
        cacheCreationTokens: 100,
      },
    ],
  });
  return runDir;
};

test("buildHarnessArtifactManifest hashes every present artifact and skips missing ones", async () => {
  const runDir = await seedRunDir();
  try {
    const built = await buildHarnessArtifactManifest({
      jobId: "job-1",
      generatedAt: "2026-05-04T08:05:00.000Z",
      runDir,
    });
    assert.equal(
      built.manifest.schemaVersion,
      HARNESS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    );
    assert.equal(
      built.manifest.contractVersion,
      TEST_INTELLIGENCE_CONTRACT_VERSION,
    );
    assert.deepEqual(
      built.manifest.entries.map((entry) => entry.filename),
      [
        "agent-iterations.json",
        "cache-break-events.jsonl",
        "library-coverage-report.json",
      ],
    );
    for (const entry of built.manifest.entries) {
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
      assert.equal(entry.schemaVersion, "1.0.0");
      assert.ok(entry.sizeBytes > 0);
    }
    assert.match(built.manifest.digest, /^[0-9a-f]{64}$/);
    assert.equal(isHarnessArtifactManifest(built.manifest), true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("buildHarnessArtifactManifest is byte-stable across calls with same inputs", async () => {
  const runDir = await seedRunDir();
  try {
    const first = await buildHarnessArtifactManifest({
      jobId: "job-1",
      generatedAt: "2026-05-04T08:05:00.000Z",
      runDir,
    });
    const second = await buildHarnessArtifactManifest({
      jobId: "job-1",
      generatedAt: "2026-05-04T08:05:00.000Z",
      runDir,
    });
    assert.equal(first.serialized, second.serialized);
    assert.equal(first.manifest.digest, second.manifest.digest);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("writeHarnessArtifactManifest persists atomically and round-trips through readers", async () => {
  const runDir = await seedRunDir();
  try {
    const written = await writeHarnessArtifactManifest({
      jobId: "job-1",
      generatedAt: "2026-05-04T08:05:00.000Z",
      runDir,
    });
    assert.ok(
      written.artifactPath.endsWith(
        HARNESS_ARTIFACT_MANIFEST_ARTIFACT_FILENAME,
      ),
    );
    const onDisk = await readFile(written.artifactPath, "utf8");
    assert.equal(onDisk, written.serialized);
    assert.equal(await hasHarnessArtifactManifest(runDir), true);
    const loaded = await readHarnessArtifactManifest(runDir);
    assert.deepEqual(loaded, written.manifest);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("verifyHarnessArtifactManifest reproduces every hash offline", async () => {
  const runDir = await seedRunDir();
  try {
    const written = await writeHarnessArtifactManifest({
      jobId: "job-1",
      generatedAt: "2026-05-04T08:05:00.000Z",
      runDir,
    });
    const result = await verifyHarnessArtifactManifest({
      runDir,
      manifest: written.manifest,
    });
    assert.equal(result.ok, true);
    assert.equal(result.mismatches.length, 0);
    assert.equal(result.digestMatches, true);
    assert.equal(result.recomputedDigest, written.manifest.digest);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("verifyHarnessArtifactManifest reports tampered artifacts", async () => {
  const runDir = await seedRunDir();
  try {
    const written = await writeHarnessArtifactManifest({
      jobId: "job-1",
      generatedAt: "2026-05-04T08:05:00.000Z",
      runDir,
    });
    // Tamper with one of the artifacts on disk.
    await writeFile(
      join(runDir, "library-coverage-report.json"),
      "tampered\n",
      "utf8",
    );
    const result = await verifyHarnessArtifactManifest({
      runDir,
      manifest: written.manifest,
    });
    assert.equal(result.ok, false);
    assert.equal(result.mismatches.length, 1);
    assert.equal(result.mismatches[0]?.filename, "library-coverage-report.json");
    assert.match(
      result.mismatches[0]?.reason ?? "",
      /size_mismatch|sha256_mismatch/,
    );
    assert.equal(result.digestMatches, false);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("verifyHarnessArtifactManifest reports missing artifacts", async () => {
  const runDir = await seedRunDir();
  try {
    const written = await writeHarnessArtifactManifest({
      jobId: "job-1",
      generatedAt: "2026-05-04T08:05:00.000Z",
      runDir,
    });
    await rm(join(runDir, "agent-iterations.json"));
    const result = await verifyHarnessArtifactManifest({
      runDir,
      manifest: written.manifest,
    });
    assert.equal(result.ok, false);
    const mismatch = result.mismatches.find(
      (entry) => entry.filename === "agent-iterations.json",
    );
    assert.ok(mismatch !== undefined);
    assert.equal(mismatch!.reason, "missing");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("isHarnessArtifactManifest rejects payloads with stale digest", async () => {
  const runDir = await seedRunDir();
  try {
    const built = await buildHarnessArtifactManifest({
      jobId: "job-1",
      generatedAt: "2026-05-04T08:05:00.000Z",
      runDir,
    });
    const tampered = { ...built.manifest, digest: "0".repeat(64) };
    assert.equal(isHarnessArtifactManifest(tampered), false);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("readHarnessArtifactManifest tolerates missing manifest", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "ti-har-manifest-empty-"));
  try {
    assert.equal(await hasHarnessArtifactManifest(runDir), false);
    assert.equal(await readHarnessArtifactManifest(runDir), undefined);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
